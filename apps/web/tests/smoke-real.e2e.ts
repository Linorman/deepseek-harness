// Real-host smoke: spawn `clocky web` with a configured real model, walk the full flow
// list in a real chromium, screenshot every screen into .artifacts/ for the
// figma comparison pass. Self-skips without DEEPSEEK_API_KEY or
// CLOCKY_LOCAL_MODEL_BASE_URL (repo e2e convention); vitest.web.config.ts loads
// the repo-root .env before this file
// runs (the CLI only auto-loads .env from its cwd — a temp dir here, so
// sessions never land in the repo's .sessions).
//
// Selector convention: CSS Modules hash as [hash]_[local], so class-substring
// selectors are unreliable — anchor on data-* attributes (data-variant /
// data-sample) or visible text. The one [class*=] use below
// (frame/handle) rides local names that survive hashing as suffixes; prefer
// data-* for anything new.
//
// Flow order matters: chat rounds first (the bash round reuses the first
// send's session), geometry and theme after, reload recovery last. Tests run
// sequentially in-file.
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { REPO_ROOT, connectFreshWorkspace, newEnglishPage, probeFreePort, requireDist, saveFailureShot } from './support.ts'

const WEB_SURFACE_PROMPT = fileURLToPath(new URL('./snapshots/web-runtime-context/web-surface-prompt.expected.md', import.meta.url))
const PRODUCT_AUTH_CREDENTIAL = 'clocky-web-smoke-product-credential'
const PRODUCT_AUTH_COOKIE_NAME = 'clocky_product_auth'
const PRODUCT_AUTH_PROVIDER = pathToFileURL(fileURLToPath(new URL('../../../packages/host/product-principal-digest/src/index.ts', import.meta.url))).href
const PRODUCT_AUTH_DIGEST = createHash('sha256').update(PRODUCT_AUTH_CREDENTIAL, 'utf8').digest('hex')

interface ProductAuthSession {
  readonly header: string
  readonly token: string
}

let productAuth: ProductAuthSession | undefined

function repoTempDir(prefix: string): string {
  const parent = join(REPO_ROOT, '.tmp', 'web-smoke')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  return mkdtempSync(join(parent, prefix))
}

/** Authenticate the HTTP smoke caller through the same bootstrap boundary as the browser. */
async function bootstrapProductAuth(baseUrl: string): Promise<ProductAuthSession> {
  const response = await fetch(`${baseUrl}/api/bootstrap`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(productAuth === undefined ? {} : { cookie: productAuth.header }),
    },
    body: JSON.stringify({ credential: PRODUCT_AUTH_CREDENTIAL }),
  })
  if (response.status !== 204) {
    throw new Error(`product authentication bootstrap failed over HTTP ${String(response.status)}: ${await response.text()}`)
  }
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  if (cookie === undefined) throw new Error('product authentication bootstrap returned no session cookie')
  const separator = cookie.indexOf('=')
  const token = separator < 1 ? '' : cookie.slice(separator + 1)
  if (cookie.slice(0, separator) !== PRODUCT_AUTH_COOKIE_NAME || token.length === 0) {
    throw new Error('product authentication bootstrap returned an invalid session cookie')
  }
  return { header: cookie, token }
}

function productAuthPatchLines(): string[] {
  return [
    '- id: product-principal-local',
    '  disabled: true',
    '- insert:',
    '    - id: web-smoke-product-principal',
    `      name: ${JSON.stringify(PRODUCT_AUTH_PROVIDER)}`,
    '      config:',
    '        providerName: local',
    `        credentialSha256: ${PRODUCT_AUTH_DIGEST}`,
    '        principalId: web-smoke-user',
    '        subject: web-smoke-user',
    '',
  ]
}

function writeProductAuthPatch(workspace: string): string {
  const patchPath = join(workspace, 'clocky-product-auth.patch.yml')
  writeFileSync(patchPath, productAuthPatchLines().join('\n'))
  return patchPath
}

function waitForReadyLine(child: ChildProcess): Promise<string> {
  return new Promise((resolveReady, reject) => {
    let out = ''
    const timer = setTimeout(() => { reject(new Error(`clocky web not ready in 90s; output:\n${out}`)) }, 90_000)
    const onData = (chunk: Buffer): void => {
      out += chunk.toString()
      const match = /clocky web: (http:\/\/[^\s]+)/.exec(out)
      if (match?.[1] !== undefined) {
        clearTimeout(timer)
        resolveReady(match[1])
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`clocky web exited early (code ${code}); output:\n${out}`))
    })
  })
}

/** Write the generic mock route and explicit model selection used by CLI smoke calls. */
function writeMockModelPatch(workspace: string, baseURL: string): string {
  const patchPath = join(workspace, 'clocky-web-test.patch.yml')
  writeFileSync(patchPath, [
    ...productAuthPatchLines(),
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      test-provider:',
    '        apiKeyEnv: CLOCKY_TEST_API_KEY',
    '        api: openai-completions',
    `        baseURL: ${baseURL}`,
    '        compat:',
    '          maxTokensField: max_tokens',
    '        models:',
    '          - id: test-model',
    '- id: agent-default-model',
    '  config:',
    '    provider: test-provider',
    '    model: test-model',
    '',
  ].join('\n'))
  return patchPath
}

/** Write a no-secret route patch for the local OpenAI-compatible model server. */
function writeLocalModelPatch(workspace: string, baseURL: string, model: string): string {
  const patchPath = join(workspace, 'clocky-local-model.patch.yml')
  writeFileSync(patchPath, [
    ...productAuthPatchLines(),
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      local-vllm:',
    '        apiKeyEnv: CLOCKY_LOCAL_MODEL_API_KEY',
    '        api: openai-completions',
    `        baseURL: ${JSON.stringify(baseURL)}`,
    '        compat:',
    '          supportsDeveloperRole: false',
    '          supportsReasoningEffort: true',
    '          maxTokensField: max_tokens',
    ...(process.env.CLOCKY_LOCAL_MODEL_REASONING_EFFORT === undefined ? [] : [
      `        reasoning: ${JSON.stringify(process.env.CLOCKY_LOCAL_MODEL_REASONING_EFFORT)}`,
    ]),
    '        defaultContextWindow: 131072',
    '        defaultMaxTokens: 5120',
    '        models:',
    `          - id: ${JSON.stringify(model)}`,
    '            contextWindow: 131072',
    '            maxTokens: 5120',
    '            reasoningEfforts:',
    '              off:',
    '              minimal: low',
    '              low: low',
    '              medium: medium',
    '              high: xhigh',
    '              xhigh: xhigh',
    '              max: xhigh',
    '- id: agent-default-model',
    '  config:',
    '    provider: local-vllm',
    `    model: ${JSON.stringify(model)}`,
    '',
  ].join('\n'))
  return patchPath
}

async function rpc<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(productAuth === undefined ? {} : { cookie: productAuth.header }),
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `smoke-${method}`,
      method,
      payload,
    }),
  })
  if (!response.ok) throw new Error(`${method} failed over HTTP ${response.status}: ${await response.text()}`)
  const body = await response.json() as {
    result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  }
  if (!body.result.ok) throw new Error(`${method} failed: ${body.result.error.code}: ${body.result.error.message}`)
  return body.result.value
}

interface TeamState {
  participants: { id: string; role: string }[]
  activations: { sessionId: string; activation: { participantId: string } }[]
}

interface TeamStartResult {
  state: TeamState
  envelopeId: string
}

/** Resolve the coordinator transcript created by the product Team start operation. */
function coordinatorSessionId(state: TeamState): string {
  const coordinator = state.participants.find(participant => participant.role === 'coordinator')
  if (coordinator === undefined) throw new Error('Team start returned no coordinator participant')
  const activation = state.activations.find(binding => binding.activation.participantId === coordinator.id)
  if (activation === undefined) throw new Error('Team start returned no coordinator activation')
  return activation.sessionId
}

/** Start one product Team and return its durable coordinator Session id for transcript assertions. */
async function startTeam(baseUrl: string, text: string, cwd?: string): Promise<string> {
  const started = await rpc<TeamStartResult>(baseUrl, 'team.start', {
    objective: text,
    text,
    idempotencyKey: crypto.randomUUID(),
    ...cwd === undefined ? {} : { cwd },
  })
  return coordinatorSessionId(started.state)
}

interface HistoryPage {
  events: { event: { type: string; data: unknown } }[]
  hasMore: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasAssistantMarker(page: HistoryPage, marker: string): boolean {
  return page.events.some(({ event }) => {
    if (event.type !== 'assistant/message' || !isRecord(event.data) || !isRecord(event.data.message)) return false
    const content = event.data.message.content
    if (!Array.isArray(content)) return false
    return content.some(block =>
      isRecord(block) && block.type === 'text' && typeof block.text === 'string' && block.text.includes(marker))
  })
}

async function history(baseUrl: string, sessionId: string): Promise<HistoryPage> {
  return rpc<HistoryPage>(baseUrl, 'session.history', { sessionId, maxMessages: 10 })
}

async function waitForAssistantMarker(baseUrl: string, sessionId: string, marker: string): Promise<void> {
  await expect.poll(async () => hasAssistantMarker(await history(baseUrl, sessionId), marker), {
    timeout: 120_000,
  }).toBe(true)
}

/** Real-host smoke screenshot: evidence for the figma comparison, not a failure artifact. */
async function screen(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(REPO_ROOT, '.artifacts', `w5-${name}.png`) })
}

/** First column track (px string) of the frame grid. */
async function firstTrack(page: Page): Promise<string> {
  return (await page.locator('[class*="frame"]').evaluate(
    el => getComputedStyle(el).gridTemplateColumns)).split(' ')[0]!
}

/** Last column track (details) as a number of pixels. */
async function detailsTrack(page: Page): Promise<number> {
  const cols = await page.locator('[class*="frame"]').evaluate(
    el => getComputedStyle(el).gridTemplateColumns)
  return Number(cols.split(' ').pop()!.replace('px', ''))
}

// Readiness gate: `clocky web` serves every production manifest plugin; until every UI
// plugin's client bundle exists and exports apply, the loader fail-louds and
// the frame never appears.
const UI_PLUGIN_DIRS = [
  'connection', 'runtime', 'ui-theme', 'locale', 'ui-layout', 'ui-sidebar',
  'ui-settings', 'ui-settings-general', 'ui-settings-models', 'ui-conversation',
  'ui-model-selection', 'ui-user-questions', 'ui-trajectory', '../session-query/session-log-export',
]
const ROUND_DONE_MARKER = 'WEB_ROUND_DONE'
const notReady = UI_PLUGIN_DIRS.filter((dir) => {
  const bundle = join(REPO_ROOT, 'packages/client', dir, 'lib/client.js')
  return !existsSync(bundle) || !readFileSync(bundle, 'utf8').includes('exports.apply')
})
if (notReady.length > 0) console.warn(`[smoke-real] skipped — client bundles not ready: ${notReady.join(', ')}`)

describe('clocky web keyless CLI smoke', () => {
  it('listens on 127.0.0.1 by default', async () => {
    requireDist()
    const sessionsDir = repoTempDir('clocky-web-keyless-')
    const tsxLoader = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx')).href
    const child = spawn(
      process.execPath,
      ['--import', tsxLoader, join(REPO_ROOT, 'apps/cli/src/bin.ts'), 'web', '--no-open', '--port', '0'],
      {
        cwd: sessionsDir,
        env: {
          ...process.env,
          DEEPSEEK_API_KEY: 'keyless-web-no-call',
          CLOCKY_HOME: join(sessionsDir, '.clocky'),
          CLOCKY_AGENTS_HOME: join(sessionsDir, '.agents'),
          TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    try {
      const readyUrl = await waitForReadyLine(child)
      expect(readyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect((await fetch(readyUrl)).status).toBe(200)
    } finally {
      const closed = child.exitCode === null
        ? new Promise<void>((resolveClose) => { child.once('close', () => { resolveClose() }) })
        : Promise.resolve()
      if (child.exitCode === null) child.kill('SIGTERM')
      await closed
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  })

  it('routes web runtime context and workspace instructions through the real CLI request', async () => {
    requireDist()
    const workspace = repoTempDir('clocky-web-workspace-')
    mkdirSync(join(workspace, '.git'))
    writeFileSync(join(workspace, 'AGENTS.md'), 'web-workspace-context-probe\n')

    interface NativeProviderRequest {
      messages?: { role?: string; content?: string }[]
      tools?: { function?: { name?: string } }[]
    }
    let resolveProviderRequests!: (requests: NativeProviderRequest[]) => void
    const requests: NativeProviderRequest[] = []
    const providerRequests = new Promise<NativeProviderRequest[]>((resolve) => {
      resolveProviderRequests = resolve
    })
    const provider = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        const parsed = JSON.parse(body) as NativeProviderRequest
        if ((parsed.tools?.length ?? 0) > 0) requests.push(parsed)
        if (requests.length === 1) resolveProviderRequests(requests)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end([
          'data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}',
          'data: {"choices":[{"delta":{"content":"done"}}]}',
          'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
          'data: [DONE]',
          '',
        ].join('\n\n'))
      })
    })
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
    const address = provider.address()
    if (address === null || typeof address === 'string') throw new Error('mock provider did not bind a TCP port')
    const tsxLoader = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx')).href
    const child = spawn(
      process.execPath,
      [
        '--import', tsxLoader, join(REPO_ROOT, 'apps/cli/src/bin.ts'), 'web',
        '--patch', writeMockModelPatch(workspace, `http://127.0.0.1:${address.port}`),
        '--no-open', '--port', '0',
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          CLOCKY_TEST_API_KEY: 'keyless-web-workspace',
          CLOCKY_HOME: join(workspace, '.clocky'),
          CLOCKY_AGENTS_HOME: join(workspace, '.agents'),
          TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    try {
      const baseUrl = await waitForReadyLine(child)
      productAuth = await bootstrapProductAuth(baseUrl)
      await startTeam(baseUrl, 'go', workspace)
      const capturedRequests = await Promise.race([
        providerRequests,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => { reject(new Error('provider request not received in 10s')) }, 10_000).unref()
        }),
      ])
      const captured = capturedRequests[0]
      if (captured === undefined) {
        throw new Error('provider did not receive the workspace projection request')
      }
      const workspaceMessage = captured.messages?.find(message =>
        message.role === 'user' && message.content?.includes('web-workspace-context-probe'))
      const systemMessage = captured.messages?.find(message => message.role === 'system')
      const expectedWebSection = readFileSync(WEB_SURFACE_PROMPT, 'utf8').trimEnd()
        .replace('{{webUrl}}', baseUrl)
      expect(systemMessage?.content).toContain(expectedWebSection)
      expect(workspaceMessage).toMatchInlineSnapshot(`
        {
          "content": "<system-reminder>
        The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.

        Instructions from: AGENTS.md

        web-workspace-context-probe

        </system-reminder>",
          "role": "user",
        }
      `)
      expect(captured.tools?.map(tool => tool.function?.name)
        .filter(name => name === 'web_search' || name === 'web_fetch'))
        .toMatchInlineSnapshot(`
          [
            "web_search",
          ]
        `)
    } finally {
      const closed = child.exitCode === null
        ? new Promise<void>((resolveClose) => { child.once('close', () => { resolveClose() }) })
        : Promise.resolve()
      if (child.exitCode === null) child.kill('SIGTERM')
      await closed
      await new Promise<void>(resolveClose => provider.close(() => { resolveClose() }))
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('retries a partial transport failure through the shipped Web composition', async () => {
    requireDist()
    const workspace = repoTempDir('clocky-web-retry-')
    const promptMarker = 'WEB_RETRY_REQUEST'
    const recoveredMarker = 'WEB_RETRY_RECOVERED'
    let mainAttempts = 0
    const provider = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        const parsed = JSON.parse(body) as { max_tokens?: number; messages?: unknown[] }
        const titleRequest = parsed.max_tokens === 64
        const mainRequest = !titleRequest && body.includes(promptMarker)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        if (!mainRequest) {
          response.end([
            'data: {"choices":[{"delta":{"content":"Web retry title"}}]}',
            'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
            'data: [DONE]',
            '',
          ].join('\n\n'))
          return
        }
        mainAttempts++
        if (mainAttempts === 1) {
          response.write('data: {"choices":[{"delta":{"content":"WEB_RETRY_DISCARDED"}}]}\n\n')
          setTimeout(() => { response.destroy() }, 20)
          return
        }
        response.end([
          `data: {"choices":[{"delta":{"content":"${recoveredMarker}"}}]}`,
          'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
          'data: [DONE]',
          '',
        ].join('\n\n'))
      })
    })
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
    const address = provider.address()
    if (address === null || typeof address === 'string') throw new Error('mock provider did not bind a TCP port')
    const tsxLoader = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx')).href
    const child = spawn(
      process.execPath,
      [
        '--import', tsxLoader, join(REPO_ROOT, 'apps/cli/src/bin.ts'), 'web',
        '--patch', writeMockModelPatch(workspace, `http://127.0.0.1:${address.port}`),
        '--no-open', '--port', '0',
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          CLOCKY_TEST_API_KEY: 'keyless-web-retry',
          CLOCKY_HOME: join(workspace, '.clocky'),
          TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    try {
      const baseUrl = await waitForReadyLine(child)
      productAuth = await bootstrapProductAuth(baseUrl)
      const coordinatorSession = await startTeam(baseUrl, promptMarker, workspace)
      let page: HistoryPage | undefined
      await expect.poll(async () => {
        page = await history(baseUrl, coordinatorSession)
        return hasAssistantMarker(page, recoveredMarker)
      }, { timeout: 20_000 }).toBe(true)
      if (page === undefined) throw new Error('retry history was not observed')
      const retry = page.events.find(({ event }) => event.type === 'llm/retry')?.event
      expect(mainAttempts).toBe(2)
      expect(retry?.data).toMatchObject({
        turn: 1,
        step: 1,
        retry: 1,
        maxRetries: 5,
        failure: { code: 'TRANSPORT' },
      })
      expect(JSON.stringify(page.events)).toContain('WEB_RETRY_DISCARDED')
    } finally {
      const closed = child.exitCode === null
        ? new Promise<void>((resolveClose) => { child.once('close', () => { resolveClose() }) })
        : Promise.resolve()
      if (child.exitCode === null) child.kill('SIGTERM')
      await closed
      await new Promise<void>(resolveClose => provider.close(() => { resolveClose() }))
      rmSync(workspace, { recursive: true, force: true })
    }
  }, 30_000)

  it('CLOCKY_TOOLS_MODE=code collapses the provider wire tools to run_code with the SDK prompt section', async () => {
    requireDist()
    const workspace = repoTempDir('clocky-web-code-mode-')

    interface CodeModeProviderRequest {
      messages?: { role?: string; content?: string }[]
      tools?: { function?: { name?: string } }[]
    }
    let resolveProviderRequest!: (request: CodeModeProviderRequest) => void
    const providerRequest = new Promise<CodeModeProviderRequest>((resolve) => {
      resolveProviderRequest = resolve
    })
    const provider = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        resolveProviderRequest(JSON.parse(body) as CodeModeProviderRequest)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end([
          'data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}',
          'data: {"choices":[{"delta":{"content":"done"}}]}',
          'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
          'data: [DONE]',
          '',
        ].join('\n\n'))
      })
    })
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
    const address = provider.address()
    if (address === null || typeof address === 'string') throw new Error('mock provider did not bind a TCP port')
    const tsxLoader = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx')).href
    const child = spawn(
      process.execPath,
      [
        '--import', tsxLoader, join(REPO_ROOT, 'apps/cli/src/bin.ts'), 'web',
        '--patch', writeMockModelPatch(workspace, `http://127.0.0.1:${address.port}`),
        '--no-open', '--port', '0',
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          CLOCKY_TEST_API_KEY: 'keyless-web-code-mode',
          CLOCKY_TOOLS_MODE: 'code',
          CLOCKY_HOME: join(workspace, '.clocky'),
          CLOCKY_AGENTS_HOME: join(workspace, '.agents'),
          TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    try {
      const baseUrl = await waitForReadyLine(child)
      productAuth = await bootstrapProductAuth(baseUrl)
      await startTeam(baseUrl, 'go', workspace)
      const captured = await Promise.race([
        providerRequest,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => { reject(new Error('provider request not received in 10s')) }, 10_000).unref()
        }),
      ])
      expect(captured.tools?.map(tool => tool.function?.name)).toEqual(['run_code'])
      const system = captured.messages?.find(message => message.role === 'system')
      expect(system?.content).toContain('## Writing code for run_code')
      expect(system?.content).toContain('declare const tools')
    } finally {
      const closed = child.exitCode === null
        ? new Promise<void>((resolveClose) => { child.once('close', () => { resolveClose() }) })
        : Promise.resolve()
      if (child.exitCode === null) child.kill('SIGTERM')
      await closed
      await new Promise<void>(resolveClose => provider.close(() => { resolveClose() }))
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

const localModelBaseURL = process.env.CLOCKY_LOCAL_MODEL_BASE_URL
const localModelId = process.env.CLOCKY_LOCAL_MODEL_ID ?? 'Qwen3.8-27B-AWQ-4bit'
const useLocalModel = localModelBaseURL !== undefined && localModelBaseURL.length > 0
const hasRealModel = useLocalModel || Boolean(process.env.DEEPSEEK_API_KEY)

describe.skipIf(!hasRealModel || notReady.length > 0)('web smoke (real host, configured model)', () => {
  let child: ChildProcess
  let sessionsDir: string
  let baseUrl: string
  let browser: Browser
  let page: Page
  let localModelPatch: string | undefined
  const pageErrors: string[] = []

  beforeAll(async () => {
    requireDist()
    sessionsDir = repoTempDir('clocky-web-w5-')
    localModelPatch = useLocalModel && localModelBaseURL !== undefined
      ? writeLocalModelPatch(sessionsDir, localModelBaseURL, localModelId)
      : writeProductAuthPatch(sessionsDir)
    const port = await probeFreePort()
    // tsx boot mirrors the runtime half of the root clocky script. Isolate
    // the host-level Harness and shared-agent homes inside the temp world; tsx
    // also needs the repo's loader and tsconfig paths pointed at explicitly.
    const tsxLoader = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx')).href
    child = spawn(
      process.execPath,
      [
        '--import', tsxLoader, join(REPO_ROOT, 'apps/cli/src/bin.ts'), 'web',
        ...(localModelPatch === undefined ? [] : ['--patch', localModelPatch]),
        // Launcher flags come first: the first token the launcher does not own
        // starts the web app's own arguments.
        '--no-open',
        '--port', String(port),
      ],
      {
        cwd: sessionsDir,
        env: {
          ...process.env,
          CLOCKY_HOME: join(sessionsDir, '.clocky'),
          CLOCKY_AGENTS_HOME: join(sessionsDir, '.agents'),
          TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
          ...(useLocalModel ? {
            CLOCKY_LOCAL_MODEL_BASE_URL: localModelBaseURL,
            CLOCKY_LOCAL_MODEL_ID: localModelId,
            CLOCKY_LOCAL_MODEL_API_KEY: process.env.CLOCKY_LOCAL_MODEL_API_KEY ?? 'EMPTY',
          } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    baseUrl = (await waitForReadyLine(child)).replace('0.0.0.0', '127.0.0.1')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.on('pageerror', e => pageErrors.push(String(e)))
    productAuth = await bootstrapProductAuth(baseUrl)
    await page.context().addCookies([{
      name: PRODUCT_AUTH_COOKIE_NAME,
      value: productAuth.token,
      url: baseUrl,
    }])
    await page.goto(baseUrl, { waitUntil: 'load' })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    if (child !== undefined && child.exitCode === null) {
      const gone = new Promise<void>(resolveExit => child.once('exit', () => { resolveExit() }))
      child.kill('SIGTERM')
      await Promise.race([gone, new Promise(r => setTimeout(r, 10_000).unref())])
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    if (sessionsDir !== undefined) rmSync(sessionsDir, { recursive: true, force: true })
  })

  it('cold start: loading page settles into the three-column frame', async () => {
    onTestFailed(() => saveFailureShot(page, 'w5-cold-start'))
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    expect(await page.locator('text=Failed to load plugins').count()).toBe(0)
    const template = await page.locator('[class*="frame"]').evaluate(el => getComputedStyle(el).gridTemplateColumns)
    expect(template.split(' ').length).toBe(3)
    await screen(page, '01-cold-start')
  })

  it('empty-state first send completes a real Team model round', async () => {
    onTestFailed(() => saveFailureShot(page, 'w5-first-round'))
    // This scenario spawns its own server against a fresh $CLOCKY_HOME with the
    // configured provider credential, so no onboarding step mounts and the page
    // is immediately interactive. The shipped Web surface starts with a Team
    // draft; the first send owns Team creation and coordinator activation.
    await connectFreshWorkspace(page, sessionsDir)
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })
    await screen(page, '02-empty-state')
    const prompt = `Please answer this request carefully: explain event sourcing in two sentences, ending with exactly ${ROUND_DONE_MARKER}.`
    await input.fill(prompt)
    await input.press('Enter')
    // The first send must keep the Team roster and coordinator transcript
    // mounted; a near-empty body reveals a duplicate runtime bundle with
    // incompatible scope tags.
    await page.waitForFunction(() => document.body.innerText.length > 50, undefined, { timeout: 15_000 })
    expect(pageErrors).toEqual([])
    await expect.poll(async () => (await rpc<{ items: { id: string }[] }>(baseUrl, 'team.list', {})).items.length, {
      timeout: 30_000,
    }).toBe(1)
    const teams = await rpc<{ items: { id: string; goal: { objective: string } }[] }>(baseUrl, 'team.list', {})
    const team = teams.items[0]
    if (team === undefined) throw new Error('created Web Team was not listed')
    expect(team.goal.objective).toContain(ROUND_DONE_MARKER)
    let sessionId: string | undefined
    await expect.poll(async () => {
      const teamState = await rpc<TeamState>(baseUrl, 'team.get', { teamId: team.id })
      const coordinator = teamState.participants.find(participant => participant.role === 'coordinator')
      const activation = coordinator === undefined
        ? undefined
        : teamState.activations.find(binding => binding.activation.participantId === coordinator.id)
      sessionId = activation?.sessionId
      return sessionId
    }, { timeout: 30_000 }).toEqual(expect.any(String))
    if (sessionId === undefined) throw new Error('created Web Team coordinator activation did not settle')
    await waitForAssistantMarker(baseUrl, sessionId, ROUND_DONE_MARKER)
    await page.locator('p').filter({ hasText: ROUND_DONE_MARKER }).waitFor({ timeout: 10_000 })
    await screen(page, '04-round-complete')
  }, 150_000)

  it('view tabs: Chat and Trajectory switch', async () => {
    onTestFailed(() => saveFailureShot(page, 'w5-tabs'))
    await page.locator('button', { hasText: /Trajectory/i }).first().click()
    await screen(page, '05-trajectory-tab')
    await page.getByLabel('Trajectory timeline').waitFor()
    await expect.poll(() => page.getByRole('tab', { name: 'Waterfall' }).count()).toBe(0)
    await page.locator('button', { hasText: /^Chat$/i }).first().click()
    await screen(page, '07-back-to-chat')
  })

  it('bash differential rendering: tool row click leaves the default details column closed', async () => {
    onTestFailed(() => saveFailureShot(page, 'w5-tool-details'))
    const input = page.locator('textarea').first()
    await input.fill('请用 bash 工具运行命令 echo w5marker 然后告诉我结果')
    await input.press('Enter')
    // Wait for the tool ROW, not response text (the reply echoes any marker).
    // Bash renders through the third-party sample registration. Match that
    // exact row: other clickable variants (for example Think disclosure)
    // may precede the tool call in document order.
    const toolRow = page.locator('[data-sample="bash"]')
    await toolRow.waitFor({ timeout: 120_000 })
    await screen(page, '08-bash-round')
    expect(await detailsTrack(page)).toBe(0)
    await toolRow.click()
    // Tool rows do not drive layout.openDetails; the default column stays closed.
    expect(await detailsTrack(page)).toBe(0)
    await screen(page, '09-details-closed')
  }, 150_000)

  it('sidebar drag widens the column and resets across reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'w5-drag'))
    const before = await firstTrack(page)
    const handle = page.locator('[class*="handle"]').first()
    const box = await handle.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 300)
    await page.mouse.down()
    await page.mouse.move(box!.x + 70, box!.y + 300, { steps: 6 })
    await page.mouse.up()
    const after = await firstTrack(page)
    expect(after).not.toBe(before)
    await screen(page, '10-sidebar-dragged')
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    expect(await firstTrack(page)).toBe(before)
  })

  it('dark mode: the body attribute cascades the token sheets', async () => {
    onTestFailed(() => saveFailureShot(page, 'w5-dark'))
    // The body attribute is the documented cascade mechanism; the Settings
    // gesture is owned by settings-chrome.e2e.ts — drive the attribute
    // directly here.
    const dark = await page.evaluate(() => {
      document.body.setAttribute('data-ds-dark-theme', '')
      return getComputedStyle(document.body).backgroundColor
    })
    await screen(page, '11-dark-mode')
    const light = await page.evaluate(() => {
      document.body.removeAttribute('data-ds-dark-theme')
      return getComputedStyle(document.body).backgroundColor
    })
    expect(dark).not.toBe(light)
  })

  it('reload recovery: history replays after a fresh boot', async () => {
    onTestFailed(() => saveFailureShot(page, 'w5-reload'))
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The current Team selection is browser-local state, so a fresh runtime
    // starts at the Team draft. Re-open the durable Team before asserting its
    // coordinator transcript recovery.
    let teams: { id: string; goal: { objective: string } }[] = []
    await expect.poll(async () => {
      const result = await rpc<{ items: { id: string; goal: { objective: string } }[] }>(baseUrl, 'team.list', {})
      teams = result.items
      return teams.length
    }, { timeout: 30_000 }).toBe(1)
    const team = teams[0]
    if (team === undefined) throw new Error('reloaded Web Team was not listed')
    await page.getByText(team.goal.objective, { exact: true }).click()
    await page.locator('p').filter({ hasText: ROUND_DONE_MARKER }).waitFor({ timeout: 30_000 })
    await screen(page, '12-reload-recovery')
  })

  it('stayed clean: no page errors across every flow', () => {
    expect(pageErrors).toEqual([])
  })
})
