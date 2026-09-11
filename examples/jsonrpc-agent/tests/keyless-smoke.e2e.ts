import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const binScript = fileURLToPath(new URL('../../../packages/examples/jsonrpc-demo/src/bin.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../cordis.yml', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const productCredential = 'jsonrpc-keyless-product-credential'

function waitForLine(
  lines: string[],
  predicate: (value: Record<string, unknown>) => boolean,
  stderr: () => string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000
    const poll = (): void => {
      while (lines.length > 0) {
        const line = lines.shift()!
        if (!line.trim()) continue
        try {
          const value = JSON.parse(line) as Record<string, unknown>
          if (predicate(value)) {
            resolve(value)
            return
          }
        } catch {
          reject(new Error(`non-JSON stdout from JSON-RPC agent runtime: ${line}`))
          return
        }
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for JSON-RPC response; stderr=${stderr()}`))
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })
}

describe('jsonrpc-agent keyless smoke', () => {
  it('creates a Team, routes coordinator input, and rejects an unauthenticated Team write without mutation', async () => {
    const root = await mkdtemp(join(repoRoot, '.tmp-jsonrpc-agent-smoke-'))
    const modelRequests: Record<string, unknown>[] = []
    const modelServer = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        modelRequests.push(JSON.parse(body) as Record<string, unknown>)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n')
        response.write('data: {"choices":[{"delta":{"content":"done"}}]}\n\n')
        response.write('data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n')
        response.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve))
    const address = modelServer.address()
    if (address === null || typeof address === 'string') throw new Error('model server did not bind a TCP port')
    const testConfigPath = join(root, 'cordis.yml')
    const config = await readFile(configPath, 'utf8')
    const sdkProviderPath = join(repoRoot, 'examples/jsonrpc-agent/tests/fixtures/sdk-product-principal.ts')
    await writeFile(testConfigPath, config
      .replace("name: './tests/fixtures/sdk-product-principal.ts'", `name: ${JSON.stringify(sdkProviderPath)}`)
      .replace('baseURL: http://127.0.0.1:9', `baseURL: http://127.0.0.1:${address.port}`))
    // The line-predicate protocol driving below is the genuinely custom part;
    // execa owns spawn, the deadline, and exit settlement around it.
    const child = execa(process.execPath, [
      '--import',
      'tsx',
      binScript,
      testConfigPath,
    ], {
      cwd: repoRoot,
      env: {
        TEST_API_KEY: 'keyless-smoke-no-call',
        CLOCKY_CWD: root,
        CLOCKY_SESSION_ROOT: join(root, '.sessions'),
      },
      timeout: 35_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    const lines: string[] = []
    let stdoutBuffer = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      const parts = stdoutBuffer.split('\n')
      stdoutBuffer = parts.pop() ?? ''
      lines.push(...parts)
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { credential: productCredential, cwd: root, provider: 'test-provider', model: 'test-model', maxTokens: 1234 },
      })}\n`)
      const initialized = await waitForLine(lines, value => value.id === 1, () => stderr)
      expect(initialized).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { serverInfo: { name: 'clocky-sdk-runtime' } },
      })

      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'team/create',
        params: { objective: 'Inspect tools.', contentBlocks: [{ type: 'text', text: 'inspect tools' }] },
      })}\n`)
      const created = await waitForLine(lines, value => value.id === 2, () => stderr)
      expect(created).toMatchObject({
        jsonrpc: '2.0',
        id: 2,
        result: {
          teamId: expect.any(String) as unknown,
          coordinatorSessionId: expect.any(String) as unknown,
          envelopeId: expect.any(String) as unknown,
        },
      })
      const creation = created.result as { teamId: string; coordinatorSessionId: string }
      const turnEnd = await waitForLine(lines, (value) => {
        if (value.method !== 'session.event') return false
        const params = value.params as Record<string, unknown> | undefined
        const event = params?.event as Record<string, unknown> | undefined
        return params?.sessionId === creation.coordinatorSessionId && event?.type === 'turn/end'
      }, () => stderr)
      expect(turnEnd).toMatchObject({
        jsonrpc: '2.0',
        method: 'session.event',
        params: {
          sessionId: creation.coordinatorSessionId,
          event: {
            type: 'turn/end',
            data: { reason: { kind: 'max-tokens' } },
          },
        },
      })
      const coordinatorRequest = modelRequests.find((request) => {
        const tools = request.tools as { function?: { name?: string } }[] | undefined
        return tools?.some(tool => tool.function?.name === 'team_final') ?? false
      })
      const tools = coordinatorRequest?.tools as { function?: { name?: string } }[]
      expect(coordinatorRequest?.max_completion_tokens).toBe(1234)
      expect(tools.map(tool => tool.function?.name)).toContain('team_final')

      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'team/task-list',
        params: { teamId: creation.teamId },
      })}\n`)
      const tasksBefore = await waitForLine(lines, value => value.id === 3, () => stderr)
      expect(tasksBefore).toMatchObject({
        jsonrpc: '2.0',
        id: 3,
        result: { items: expect.any(Array) as unknown },
      })

      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'team/task-create',
        params: {
          teamId: creation.teamId,
          expectedCursor: 0,
          idempotencyKey: 'keyless-smoke-untrusted-task',
          subject: 'Untrusted task',
          description: 'This write must never reach the Team journal.',
          blockedBy: [],
          requiredCapabilities: [],
          priority: 0,
          readScopes: [],
          writeScopes: [],
          workspaceMode: 'shared',
          budget: {},
          reviewPolicy: { kind: 'none' },
          maxAttempts: 1,
        },
      })}\n`)
      const rejected = await waitForLine(lines, value => value.id === 4, () => stderr)
      expect(rejected).toMatchObject({
        jsonrpc: '2.0',
        id: 4,
        error: {
          code: -32_002,
          data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' },
        },
      })

      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'team/task-list',
        params: { teamId: creation.teamId },
      })}\n`)
      const tasksAfter = await waitForLine(lines, value => value.id === 5, () => stderr)
      expect(tasksAfter.result).toEqual(tasksBefore.result)
    } finally {
      // No-op after exit; reject: false settles on every outcome, so cleanup never races teardown.
      child.kill('SIGKILL')
      await child
      await new Promise<void>(resolve => modelServer.close(() => { resolve() }))
      await rm(root, { recursive: true, force: true })
    }
  }, 40_000)
})
