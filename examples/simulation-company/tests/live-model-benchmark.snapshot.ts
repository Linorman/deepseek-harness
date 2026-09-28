import { createServer } from 'node:http'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'

const execute = promisify(execFile)
describe.each(['json', 'sqlite'])('%s live sample', (backend) => {
  it.each(['complete', 'calls', 'tokens', 'missing-usage', 'overrun', 'no-key'] as const)('live-model sample reports %s through HTTP and durable owners', async (mode) => {
    let calls = 0
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of request as AsyncIterable<Buffer>) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          max_tokens?: number
          max_completion_tokens?: number
          reasoning_effort?: string
          thinking?: { type: string }
          tools: { function: { name: string } }[]
        }
        expect(body.max_tokens ?? body.max_completion_tokens).toBe(128)
        expect(body.reasoning_effort).toBe(mode === 'complete' ? 'high' : undefined)
        expect(body.thinking).toEqual(mode === 'complete' ? { type: 'enabled' } : undefined)
        expect(body.tools.map(tool => tool.function.name)).toContain('simulation_submit')
        const index = calls++
        const name = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const emit = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`)
        emit({ id: `call-${index}`, object: 'chat.completion.chunk', model: 'sample-model', choices: [{ index: 0,
          delta: { role: 'assistant', tool_calls: [{ index: 0, id: `tool-${index}`, type: 'function',
            function: { name, arguments: index === 1 ? '{"proposals":[]}' : '{}' } }] }, finish_reason: null }] })
        emit({ id: `call-${index}`, object: 'chat.completion.chunk', model: 'sample-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          ...mode === 'missing-usage' ? {} : { usage: { prompt_tokens: mode === 'overrun' ? 2000 : 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 }, total_tokens: mode === 'overrun' ? 2005 : 15 } } })
        response.end('data: [DONE]\n\n')
      })().catch((error: unknown) => { response.destroy(error instanceof Error ? error : new Error(String(error))) })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing test server address')
    await mkdir(resolve('.tmp'), { recursive: true })
    const directory = await mkdtemp(resolve('.tmp/simulation-live-test-'))
    try {
      const args = ['--import', 'tsx/esm', 'scripts/benchmark-simulation.ts', '--backend', backend, '--workload', 'live-model',
        '--entities', '1', '--operations', '1', '--duration-ms', '15000', '--timeout-ms', '60000', '--sample-every', '1',
        '--entity-batch-size', '1', '--replay-page-size', '1000', '--output', directory,
        '--endpoint', `http://127.0.0.1:${address.port}/v1`, '--model', 'sample-model', '--context-window', '8192',
        '--reasoning-effort', mode === 'complete' ? 'high' : 'off', '--thinking-format', mode === 'complete' ? 'deepseek' : 'openai',
        '--max-output-tokens', '128', '--tokens-per-request', '1000', '--token-budget', mode === 'tokens' || mode === 'overrun' ? '1000' : '10000',
        '--max-model-calls', mode === 'calls' ? '1' : '3']
      let stdout: string
      try { ({ stdout } = await execute(process.execPath, args, { env: { ...process.env, SIMULATION_MODEL_API_KEY: mode === 'no-key' ? '' : 'test-only' } })) }
      catch (error: unknown) {
        if (!(error instanceof Error) || !('stdout' in error) || typeof error.stdout !== 'string') throw error
        stdout = error.stdout
      }
      const summary = JSON.parse(stdout) as { report: string; status: string }
      if (mode === 'complete') expect(summary.status, await readFile(resolve(dirname(summary.report), 'stderr.log'), 'utf8')).toBe('measured')
      expect({ status: summary.status, calls }).toMatchSnapshot()
      const report = JSON.parse(await readFile(summary.report, 'utf8')) as { coldRecovery?: { replayEqual: boolean }; result?: unknown }
      if (mode === 'complete') {
        expect(summary.status, await readFile(resolve(dirname(summary.report), 'stderr.log'), 'utf8')).toBe('measured')
        expect(calls).toBe(3)
        expect(report.coldRecovery).toMatchObject({ replayEqual: true, modelCalls: 0, publications: 0 })
        expect(report.result).toMatchObject({ completed: 1, modelCalls: 3, reportedTokens: 45, syntheticUsage: false, unknownUsage: false,
          reasoningEffort: 'high', thinkingFormat: 'deepseek' })
      } else {
        expect(summary.status).toBe('failed')
        expect(calls).toBe(mode === 'no-key' ? 0 : 1)
        expect(report.coldRecovery).toBeUndefined()
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolveClose, reject) => server.close((error) => { if (error) reject(error); else resolveClose() }))
      await rm(directory, { recursive: true, force: true })
    }
  })
})
