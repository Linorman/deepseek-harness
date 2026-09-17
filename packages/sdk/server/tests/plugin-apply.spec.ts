import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Loader from '@clocky/cordis-plugin-loader'
import AgentDefaultModelConfig from '@clocky/clocky-agent-default-model'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import * as InProcessRuntime from '@clocky/clocky-agent-runtime-in-process'
import * as agentCore from '@clocky/clocky-agent-spine-demo'
import * as LlmPiAi from '@clocky/clocky-llm-pi-ai'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as TeamActivationController from '@clocky/clocky-team-activation-controller'
import * as TeamAgentClient from '@clocky/clocky-team-agent-client'
import * as DirectChannel from '@clocky/clocky-team-channel-direct'
import TeamChannelAdmission from '@clocky/clocky-team-channel-admission'
import TeamHub from '@clocky/clocky-team-hub'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import * as TeamLinkLocal from '@clocky/clocky-team-link-local'
import * as TeamRun from '@clocky/clocky-team-run'
import * as TeamHumanActor from '@clocky/clocky-team-human-actor'
import * as jsonrpc from '../src/index.ts'
import { SDK_TEST_CREDENTIAL, installTestProductPrincipals } from './product-auth.ts'

/**
 * Mount the real namespace plugin with in-memory stdio and exit hooks. Covers
 * the full transport/server path, response-before-exit shutdown exactly once,
 * and bare-fiber disposal without process exit.
 */

/** One ordered frame, write completion, or exit observation. */
type WireEvent =
  | { kind: 'frame'; frame: Record<string, unknown> }
  | { kind: 'write-complete'; ids: (string | number)[] }
  | { kind: 'root-disposed' }
  | { kind: 'exit'; code: number }

interface ApplyHarness {
  ctx: Context
  /** The plugin fiber used by the bare-dispose case. */
  fiber: Awaited<ReturnType<Context['plugin']>>
  /** Frames, write completions, and exits in observation order. */
  events: WireEvent[]
  outputErrors: Error[]
  send(frame: Record<string, unknown>): void
  sendRaw(text: string): void
  frames(): Record<string, unknown>[]
  exits(): number[]
  waitForFrame(predicate: (frame: Record<string, unknown>) => boolean, description: string): Promise<Record<string, unknown>>
  dispose(): Promise<void>
}

/** Poll asynchronous output for up to five seconds. */
async function waitFor<T>(get: () => T | undefined, description: string): Promise<T> {
  const deadline = Date.now() + 5000
  for (;;) {
    const value = get()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** Drain asynchronous work before a negative assertion. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25))
}

/** Allocate SDK fixture storage beneath the project's scratch directory. */
async function freshStorageRoot(prefix: string): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  return await mkdtemp(join(parent, prefix))
}

/** Mount the real plugin on a minimal harness with in-memory stdio and exit. */
async function mountPlugin(
  storageDir: string,
  options: {
    writeDelayMs?: number
    failFlush?: boolean
    beforeServer?: (ctx: Context) => Promise<void> | void
  } = {},
): Promise<ApplyHarness> {
  const ctx = new Context()
  await installTestProductPrincipals(ctx)
  await ctx.plugin(agentCore, { workspaceContext: false })
  await ctx.plugin(LlmPiAi, {
    providers: {
      'test-provider': {
        apiKeyEnv: 'TEST_API_KEY',
        api: 'openai-completions',
        baseURL: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:9',
        models: ['apply-model', 'dsagent-model', 'x'].map(id => ({ id, maxTokens: 8192 })),
      },
    },
  })
  await ctx.plugin(JsonlSessionPersistence, { root: storageDir })
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'apply-model' })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(storageDir, 'team-hub') })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(TeamHumanActor)
  await ctx.plugin(DirectChannel)
  await ctx.plugin(TeamChannelAdmission)
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(InProcessRuntime, { providerName: 'in-process' })
  await ctx.plugin(TeamActivationController)
  await ctx.plugin(TeamLinkRegistry)
  await ctx.plugin(TeamLinkLocal, {
    providerName: 'local', pageSize: 32, disposalTimeoutMs: 100, notificationRetryDelayMs: 1,
  })
  await ctx.plugin(TeamAgentClient, { reconnectDelayMs: 1, disposalTimeoutMs: 100 })
  await ctx.plugin(TeamRun)
  await new Promise(resolve => setTimeout(resolve, 50))
  await options.beforeServer?.(ctx)

  const input = new PassThrough()
  const events: WireEvent[] = []
  const outputErrors: Error[] = []
  let pendingOutput = ''
  // Record frame admission separately from write completion so delayed output
  // tests the flush barrier.
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const ids: (string | number)[] = []
      pendingOutput += chunk.toString('utf8')
      for (;;) {
        const newline = pendingOutput.indexOf('\n')
        if (newline < 0) break
        const line = pendingOutput.slice(0, newline).trim()
        pendingOutput = pendingOutput.slice(newline + 1)
        if (line) {
          const frame = JSON.parse(line) as Record<string, unknown>
          events.push({ kind: 'frame', frame })
          if (typeof frame.id === 'string' || typeof frame.id === 'number') ids.push(frame.id)
        }
      }
      const complete = (): void => {
        if (options.failFlush === true && chunk.length === 0) {
          callback(new Error('flush callback failed'))
          return
        }
        events.push({ kind: 'write-complete', ids })
        callback()
      }
      if ((options.writeDelayMs ?? 0) > 0) setTimeout(complete, options.writeDelayMs)
      else complete()
    },
  })
  output.on('error', (error: Error) => { outputErrors.push(error) })
  const exit = (code: number): void => { events.push({ kind: 'exit', code }) }

  ctx.effect(() => () => { events.push({ kind: 'root-disposed' }) }, 'jsonrpc test root-disposal witness')
  const fiber = await ctx.plugin(jsonrpc, { input, output, exit })

  const frames = (): Record<string, unknown>[] =>
    events.flatMap(event => event.kind === 'frame' ? [event.frame] : [])
  return {
    ctx,
    fiber,
    events,
    outputErrors,
    send: (frame) => { input.write(`${JSON.stringify(frame)}\n`) },
    sendRaw: (text) => { input.write(text) },
    frames,
    exits: () => events.flatMap(event => event.kind === 'exit' ? [event.code] : []),
    waitForFrame: (predicate, description) => waitFor(() => frames().find(predicate), description),
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
  vi.unstubAllEnvs()
})

/** Keyless SSE endpoint for completing a prompt turn. */
async function mockCompletionServer(): Promise<{ url: string; requests: unknown[] }> {
  const requests: unknown[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":"done"}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, requests }
}

describe('clocky-sdk-jsonrpc-server plugin apply', () => {
  it('serves initialize over the injected stdio pair', async () => {
    const storageDir = await freshStorageRoot('clocky-jsonrpc-apply-init-')
    vi.stubEnv('TEST_API_KEY', 'test-key')
    const harness = await mountPlugin(storageDir)
    try {
      harness.send({ jsonrpc: '2.0', id: 'init-1', method: 'initialize', params: { credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'test-provider', model: 'apply-model' } })

      const response = await harness.waitForFrame(frame => frame.id === 'init-1', 'initialize response')
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 'init-1',
        result: { serverInfo: { name: 'clocky-sdk-runtime', version: '0.0.1' } },
      })
      expect(harness.exits()).toEqual([])
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not answer initialize until async sibling Loader entries settle', async () => {
    const storageDir = await freshStorageRoot('clocky-jsonrpc-apply-readiness-')
    vi.stubEnv('TEST_API_KEY', 'test-key')
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const ready = new Promise<void>((resolve) => { release = resolve })
    let delayedEntry: Promise<string> | undefined
    const harness = await mountPlugin(storageDir, {
      beforeServer: async (ctx) => {
        await ctx.plugin(Loader)
        ctx.loader.builtins['delayed-readiness'] = {
          async apply() {
            markStarted()
            await ready
          },
        }
        delayedEntry = ctx.loader.create({ name: 'cordis:delayed-readiness' })
        await started
      },
    })
    try {
      const initialize = {
        jsonrpc: '2.0',
        id: 'init-delayed',
        method: 'initialize',
        params: { credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'test-provider', model: 'apply-model' },
      }
      const probe = { jsonrpc: '2.0', id: 'probe-during-delay', method: 'nope/unknown' }
      harness.sendRaw(`${JSON.stringify(initialize)}\n${JSON.stringify(probe)}\n`)

      // The transport processes independent requests concurrently. Receiving
      // this later probe proves the preceding initialize handler has reached
      // its Loader wait, without relying on a scheduler delay.
      await harness.waitForFrame(frame => frame.id === 'probe-during-delay', 'probe while initialize waits')
      expect(harness.frames().some(frame => frame.id === 'init-delayed')).toBe(false)

      release()
      await delayedEntry
      const response = await harness.waitForFrame(frame => frame.id === 'init-delayed', 'initialize response after Loader settlement')
      expect(response).toMatchObject({
        id: 'init-delayed',
        result: { serverInfo: { name: 'clocky-sdk-runtime' } },
      })
    } finally {
      release()
      await Promise.allSettled(delayedEntry === undefined ? [] : [delayedEntry])
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('creates a Team, admits its first human Envelope, and forwards coordinator notifications', async () => {
    const storageDir = await freshStorageRoot('clocky-jsonrpc-apply-prompt-')
    const llmServer = await mockCompletionServer()
    vi.stubEnv('TEST_API_KEY', 'test-key')
    vi.stubEnv('TEST_BASE_URL', llmServer.url)
    const harness = await mountPlugin(storageDir)
    try {
      harness.send({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'test-provider', model: 'dsagent-model', maxTokens: 321 },
      })
      await harness.waitForFrame(frame => frame.id === 1, 'initialize response')

      harness.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'team/create',
        params: { objective: 'Fix it.', contentBlocks: [{ type: 'text', text: 'fix it' }] },
      })
      const response = await harness.waitForFrame(frame => frame.id === 2, 'Team creation response')
      const created = response.result as { teamId: string; coordinatorSessionId: string; envelopeId: string }
      expect(created).toMatchObject({
        teamId: expect.any(String) as unknown,
        coordinatorSessionId: expect.any(String) as unknown,
        envelopeId: expect.any(String) as unknown,
      })
      await harness.waitForFrame(
        frame => frame.method === 'session.status'
          && (frame.params as { sessionId?: string; status?: string } | undefined)?.sessionId === created.coordinatorSessionId
          && (frame.params as { status?: string } | undefined)?.status === 'idle',
        'idle coordinator status',
      )

      expect(llmServer.requests).toHaveLength(1)
      const body = llmServer.requests[0] as { model: string; messages: { role: string }[]; max_completion_tokens?: number }
      expect(body.model).toBe('dsagent-model')
      expect(body.max_completion_tokens).toBe(321)
      expect(body.messages.at(-1)?.role).toBe('user')

      // Notifications use the same transport and arrive as id-less frames.
      const notifications = harness.frames().filter(frame => frame.id === undefined)
      expect(notifications.some(frame => frame.method === 'session.event')).toBe(true)
      expect(notifications.findLast(frame => frame.method === 'session.status')).toMatchObject({
        jsonrpc: '2.0',
        params: { sessionId: created.coordinatorSessionId, status: 'idle' },
      })

      await vi.waitFor(async () => {
        const state = await harness.ctx.teams.getTeam({ teamId: created.teamId as never })
        expect(state.activations.some(binding => binding.activation.status === 'idle')).toBe(true)
      })
      harness.send({ jsonrpc: '2.0', id: 'missing-plan', method: 'team/workflow-plan-inspect',
        params: { teamId: created.teamId, planId: 'missing' } })
      const missingPlan = await harness.waitForFrame(frame => frame.id === 'missing-plan', 'missing workflow inspection')
      expect(missingPlan.error).toMatchObject({ message: expect.stringContaining('not found') as unknown })
      harness.send({ jsonrpc: '2.0', id: 'missing-action', method: 'team/action-read',
        params: { teamId: created.teamId, actionId: 'missing' } })
      const missingAction = await harness.waitForFrame(frame => frame.id === 'missing-action', 'bounded missing action')
      expect(missingAction.error).toMatchObject({ message: expect.stringContaining('missing') as unknown })
      harness.send({ jsonrpc: '2.0', id: 'selection', method: 'team/selection', params: { teamId: created.teamId, includeMetadata: true } })
      const selected = await harness.waitForFrame(frame => frame.id === 'selection', 'bounded Team selection')
      expect(selected.result).toMatchObject({ selection: { team: { id: created.teamId },
        coordinator: { kind: 'bound', binding: { sessionId: created.coordinatorSessionId } } } })
      expect(selected.result).not.toHaveProperty('state')
      expect(selected.result).toMatchObject({ selection: { metadata: { kind: 'available', goal: { teamId: created.teamId } } } })
      expect(llmServer.requests).toHaveLength(1)
      const state = await harness.ctx.teams.getTeam({ teamId: created.teamId as never })
      const human = state.participants.find(participant => participant.role === 'human')
      const coordinator = state.participants.find(participant => participant.role === 'coordinator')
      const channelId = state.channelIds[0]
      if (human === undefined || coordinator === undefined || channelId === undefined) {
        throw new Error('SDK Team creation did not retain its default human/coordinator channel')
      }
      harness.send({ jsonrpc: '2.0', id: 'member-session', method: 'team/member-session',
        params: { teamId: created.teamId, participantId: coordinator.id } })
      const memberSession = await harness.waitForFrame(frame => frame.id === 'member-session', 'published member Session')
      expect(memberSession.result).toMatchObject({ binding: { sessionId: created.coordinatorSessionId,
        activation: { teamId: created.teamId, participantId: coordinator.id } } })
      expect(llmServer.requests).toHaveLength(1)
      harness.send({ jsonrpc: '2.0', id: 'member-inspect', method: 'team/member-inspect',
        params: { teamId: created.teamId, participantId: coordinator.id, limit: 1 } })
      const memberInspection = await harness.waitForFrame(frame => frame.id === 'member-inspect', 'member detail')
      expect(memberInspection.result).toMatchObject({ detail: { record: { id: coordinator.id, teamId: created.teamId }, startCursor: -1 } })

      harness.send({ jsonrpc: '2.0', id: 'browse', method: 'team/browse',
        params: { teamId: created.teamId, kind: 'members', limit: 1 } })
      const browsed = await harness.waitForFrame(frame => frame.id === 'browse', 'member display summaries')
      expect(browsed.result).toMatchObject({ page: { kind: 'members', teamId: created.teamId,
        items: [{ id: human.id, displayName: { truncated: false } }] } })
      expect(browsed.result).not.toHaveProperty('state')
      expect(llmServer.requests).toHaveLength(1)

      const inspect = vi.spyOn(harness.ctx.teams, 'inspectTask').mockResolvedValue({
        teamId: state.team.id, taskId: 'inspection-task' as never, revision: 2, teamCursor: state.team.cursor,
        section: 'attempts', startCursor: -1, total: 0, scanned: 0, items: [],
      })
      harness.send({ jsonrpc: '2.0', id: 'task-inspect', method: 'team/task-inspect',
        params: { teamId: created.teamId, taskId: 'inspection-task', section: 'attempts', expectedRevision: 2, limit: 1 } })
      const inspected = await harness.waitForFrame(frame => frame.id === 'task-inspect', 'bounded task inspection')
      expect(inspected.result).toMatchObject({ inspection: { section: 'attempts', revision: 2, items: [] } })
      expect(inspect).toHaveBeenCalledWith({ teamId: created.teamId, taskId: 'inspection-task', section: 'attempts', expectedRevision: 2, limit: 1 })
      inspect.mockRestore()

      const channel = await harness.ctx.teams.getChannel({ channelId })
      harness.send({
        jsonrpc: '2.0',
        id: 4,
        method: 'team/channel-post',
        params: {
          channelId,
          expectedCursor: channel.cursor,
          audience: [coordinator.id],
          kind: 'message',
          payload: { content: [{ type: 'text', text: 'SDK authenticated channel post.' }] },
          delivery: 'context',
        },
      })
      await expect(harness.waitForFrame(frame => frame.id === 4, 'human channel-post response')).resolves.toMatchObject({
        result: { value: { senderId: human.id, channelId } },
      })
      harness.send({ jsonrpc: '2.0', id: 3, method: 'team/cancel', params: { teamId: created.teamId } })
      await expect(harness.waitForFrame(frame => frame.id === 3, 'Team cancellation response')).resolves.toMatchObject({ result: { phase: 'cancelled' } })
      const terminal = await harness.ctx.teams.getTeam({ teamId: created.teamId as never })
      harness.send({
        jsonrpc: '2.0', id: 6, method: 'team/task-create',
        params: {
          teamId: created.teamId,
          expectedCursor: terminal.team.cursor,
          idempotencyKey: 'sdk-terminal-task-mutation',
          subject: 'Rejected terminal mutation',
          description: 'The Hub must reject this after cancellation.',
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
      })
      await expect(harness.waitForFrame(frame => frame.id === 6, 'terminal task mutation rejection')).resolves.toMatchObject({
        error: { code: -32_603, message: 'Human task actor is invalid for this command' },
      })
      harness.send({
        jsonrpc: '2.0', id: 5, method: 'team/archive',
        params: { teamId: created.teamId, expectedCursor: terminal.team.cursor },
      })
      const archived = await harness.waitForFrame(frame => frame.id === 5, 'human terminal archive response')
      const archiveResult = archived.result
      if (typeof archiveResult !== 'object' || archiveResult === null || Array.isArray(archiveResult)) {
        throw new Error('SDK terminal archive response has no result object')
      }
      const archiveRecord = archiveResult as Record<string, unknown>
      expect(archiveRecord).toMatchObject({ teamId: created.teamId })
      expect(archiveRecord['archivedAt']).toBeTypeOf('number')
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('answers shutdown before exiting 0 exactly once, even against a racing second shutdown', async () => {
    const storageDir = await freshStorageRoot('clocky-jsonrpc-apply-shutdown-')
    const harness = await mountPlugin(storageDir, { writeDelayMs: 10 })
    try {
      harness.send({ jsonrpc: '2.0', id: 'init-shutdown', method: 'initialize', params: { credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'test-provider', model: 'apply-model' } })
      await harness.waitForFrame(frame => frame.id === 'init-shutdown', 'authenticated initialization before shutdown')
      // One chunk makes the two deferred exit callbacks race.
      const first = { jsonrpc: '2.0', id: 'sd-1', method: 'shutdown' }
      const second = { jsonrpc: '2.0', id: 'sd-2', method: 'shutdown' }
      harness.sendRaw(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`)

      await waitFor(() => harness.exits().length > 0 ? true : undefined, 'exit recorder call')
      expect(harness.exits()).toEqual([0])

      // Both response writes and the flush barrier complete before exit.
      const exitIndex = harness.events.findIndex(event => event.kind === 'exit')
      const firstResponse = harness.events.findIndex(event => event.kind === 'frame' && event.frame.id === 'sd-1')
      const secondResponse = harness.events.findIndex(event => event.kind === 'frame' && event.frame.id === 'sd-2')
      const firstComplete = harness.events.findIndex(event => event.kind === 'write-complete' && event.ids.includes('sd-1'))
      const secondComplete = harness.events.findIndex(event => event.kind === 'write-complete' && event.ids.includes('sd-2'))
      const flushComplete = harness.events.findIndex(event => event.kind === 'write-complete' && event.ids.length === 0)
      const rootDisposed = harness.events.findIndex(event => event.kind === 'root-disposed')
      expect(firstResponse).toBeGreaterThanOrEqual(0)
      expect(secondResponse).toBeGreaterThanOrEqual(0)
      expect(firstComplete).toBeGreaterThan(firstResponse)
      expect(secondComplete).toBeGreaterThan(secondResponse)
      expect(flushComplete).toBeGreaterThan(firstComplete)
      expect(flushComplete).toBeGreaterThan(secondComplete)
      expect(rootDisposed).toBeGreaterThan(flushComplete)
      expect(exitIndex).toBeGreaterThan(rootDisposed)

      await settle()
      expect(harness.exits()).toEqual([0])
      expect(harness.events.filter(event => event.kind === 'root-disposed')).toHaveLength(1)

      const before = harness.frames().length
      harness.send({ jsonrpc: '2.0', id: 'after-exit', method: 'initialize', params: { credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'test-provider', model: 'x' } })
      await settle()
      expect(harness.frames().length).toBe(before)
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('still disposes and exits once when the flush callback fails', async () => {
    const storageDir = await freshStorageRoot('clocky-jsonrpc-apply-flush-failure-')
    const harness = await mountPlugin(storageDir, { failFlush: true })
    try {
      harness.send({ jsonrpc: '2.0', id: 'init-flush-failure', method: 'initialize', params: { credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'test-provider', model: 'apply-model' } })
      await harness.waitForFrame(frame => frame.id === 'init-flush-failure', 'authenticated initialization before shutdown')
      harness.send({ jsonrpc: '2.0', id: 'sd-fail', method: 'shutdown' })

      await waitFor(() => harness.exits().length > 0 ? true : undefined, 'exit after flush failure')
      await settle()
      expect(harness.exits()).toEqual([0])
      expect(harness.events.filter(event => event.kind === 'root-disposed')).toHaveLength(1)
      expect(harness.outputErrors.map(error => error.message)).toEqual(['flush callback failed'])

      const before = harness.frames().length
      harness.send({ jsonrpc: '2.0', id: 'after-flush-failure', method: 'initialize', params: { credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'test-provider', model: 'x' } })
      await settle()
      expect(harness.frames().length).toBe(before)
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('stops serving on a bare fiber dispose (HMR-style unload) without calling exit', async () => {
    const storageDir = await freshStorageRoot('clocky-jsonrpc-apply-dispose-')
    const harness = await mountPlugin(storageDir)
    try {
      harness.send({ jsonrpc: '2.0', id: 'init-dispose', method: 'initialize', params: { credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'test-provider', model: 'apply-model' } })
      await harness.waitForFrame(frame => frame.id === 'init-dispose', 'authenticated initialization before disposal')
      // Prove the handler-rejection path is live before disposal.
      harness.send({ jsonrpc: '2.0', id: 'probe-1', method: 'nope/unknown' })
      const error = await harness.waitForFrame(frame => frame.id === 'probe-1', 'error response for unknown method')
      expect(error.error).toMatchObject({
        code: -32603,
        message: 'unknown SDK runtime method: nope/unknown',
      })

      await harness.fiber.dispose()
      expect(harness.events.some(event => event.kind === 'root-disposed')).toBe(false)

      const before = harness.frames().length
      harness.send({ jsonrpc: '2.0', id: 'probe-2', method: 'initialize', params: { credential: SDK_TEST_CREDENTIAL, cwd: storageDir, provider: 'test-provider', model: 'x' } })
      await settle()
      expect(harness.frames().length).toBe(before)
      expect(harness.exits()).toEqual([])
    } finally {
      await harness.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})
