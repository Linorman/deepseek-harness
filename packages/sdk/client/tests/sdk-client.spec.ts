/**
 * SDK client against a real scripted runtime subprocess
 * (`tests/fake-runtime.ts`, protocol-only — the only faked boundary is the
 * model-owning runtime itself). Covers the turn loop, notification routing
 * and session-tree scoping, error surfaces, timeouts, and the dispose ladder.
 */

import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Clocky,
  HarnessTeam,
  HarnessClient,
  JsonRpcResponseError,
  parseActivationStatusNotification,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
  type ContentBlock,
} from '../src/index.ts'
import { normalizeInput, resolveObjective } from '../src/api.ts'

const fakeRuntime = fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))
const TEST_CREDENTIAL = 'sdk-client-test-credential'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

type LaunchOverrides = Partial<ConstructorParameters<typeof HarnessClient>[0]>

/** Launch options running the fake runtime on the current node (type stripping). */
function fakeLaunch(env: Record<string, string> = {}, extra: LaunchOverrides = {}) {
  return {
    command: process.execPath,
    args: [fakeRuntime],
    env: { ...process.env as Record<string, string>, ...env },
    ...extra,
  }
}

function harnessWith(env: Record<string, string> = {}, extra: LaunchOverrides = {}): Clocky {
  const harness = new Clocky({
    launch: fakeLaunch(env, extra), credential: TEST_CREDENTIAL, provider: 'test-provider', model: 'test-model',
  })
  cleanups.push(() => harness.close())
  return harness
}

/** Complete wire target for the SDK activation lifecycle helpers. */
function activationTarget(overrides: Partial<{
  activationId: string
  teamId: string
  participantId: string
  sessionId: string
}> = {}) {
  return {
    activationId: 'activation-client',
    teamId: 'team-client',
    participantId: 'participant-client',
    sessionId: 'session-client',
    ...overrides,
  }
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

describe('Clocky', () => {
  it('requires an explicit objective for image-only Team input', () => {
    const image = [{
      type: 'image' as const,
      attachment: { attachmentId: 'sha256:image' as never, mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 },
    }] satisfies ContentBlock[]
    expect(() => resolveObjective(image, image, undefined)).toThrow('objective is required when Team input contains no text')
    expect(resolveObjective(image, image, 'Inspect the screenshot.')).toBe('Inspect the screenshot.')
  })

  it('runs a Team end to end and reuses the runtime across completed Teams', async () => {
    const harness = harnessWith({ FAKE_TEXT: 'turn answer' })
    const first = await harness.run('say hi')
    expect(first.finalResponse).toBe('turn answer')
    expect(first.events.map(event => event.type)).toEqual([
      'agent/inbox/spliced', 'turn/start', 'assistant/chunk', 'assistant/message', 'turn/end',
    ])

    // Same subprocess, second Team: ids differ, protocol state is reusable.
    const second = await harness.run([{ type: 'text', text: 'again' }])
    expect(second.teamId).not.toBe(first.teamId)
    await harness.close()
  })

  it('sends the configured cwd/provider/model/maxTokens in the handshake exactly once', async () => {
    const dir = await tempDir('sdk-client-init-')
    const recordFile = join(dir, 'init.jsonl')
    const harness = new Clocky({
      launch: fakeLaunch({ FAKE_RECORD_INIT: recordFile }),
      credential: TEST_CREDENTIAL,
      cwd: dir,
      provider: 'custom-provider',
      model: 'custom-model',
      maxTokens: 4096,
    })
    cleanups.push(() => harness.close())
    await harness.run('one')
    await harness.run('two')
    await harness.close()
    const records = (await readFile(recordFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as object)
    expect(records).toEqual([{
      credential: TEST_CREDENTIAL,
      cwd: dir,
      provider: 'custom-provider',
      model: 'custom-model',
      maxTokens: 4096,
    }])
  })

  it('resolves a relative launch cwd to an absolute workspace before the handshake', async () => {
    // vitest workers forbid chdir, so derive a RELATIVE path from the real
    // process cwd to a temp worker dir; resolution is lexical either way.
    const dir = await mkdtemp(join(process.cwd(), '.clocky-sdk-client-relcwd-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const recordFile = join(dir, 'init.jsonl')
    const inner = join(dir, 'worker')
    await mkdir(inner)
    const relativeCwd = relative(process.cwd(), inner)
    expect(isAbsolute(relativeCwd)).toBe(false)
    const harness = new Clocky({
      launch: fakeLaunch({ FAKE_RECORD_INIT: recordFile, FAKE_ECHO_CWD_IN_INIT: '1' }, { cwd: relativeCwd }),
      credential: TEST_CREDENTIAL,
      provider: 'test-provider', model: 'test-model',
    })
    cleanups.push(() => harness.close())
    await harness.start()
    const identity = await harness.client.initialize({ credential: TEST_CREDENTIAL, cwd: inner, provider: 'p', model: 'm' })
    await harness.close()
    // The child spawned under the temp worker dir (its physical cwd)...
    expect(identity.serverInfo.version).toBe(await realpath(inner))
    // ...and the handshake wire cwd went out ABSOLUTE, so the child cannot
    // re-resolve a relative string into dir/worker/worker.
    const records = (await readFile(recordFile, 'utf8')).trim().split('\n')
      .map(line => (JSON.parse(line) as { cwd: string }).cwd)
    expect(records).toEqual([resolvePath(relativeCwd), inner])
  })

  it('propagates a JSON-RPC error response from initialize and closes the runtime', async () => {
    const harness = harnessWith({ FAKE_INIT_ERROR: '1' })
    const failure = await harness.run('boom').then(
      () => { throw new Error('run unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(JsonRpcResponseError)
    expect(failure).toMatchObject({ code: 7, message: 'scripted init failure', data: { hint: 'fake' } })
    // The failed handshake reset lets a later start retry instead of wedging.
    await expect(harness.run('later')).rejects.toThrow()
  })

  it('redacts a handshake credential from a reflected initialization error', async () => {
    const credential = 'credential-never-visible-in-sdk-error'
    const client = new HarnessClient(fakeLaunch({ FAKE_INIT_ECHO_CREDENTIAL: '1' }))
    cleanups.push(() => client.close())

    const failure: unknown = await client.initialize({
      credential,
      cwd: process.cwd(),
      provider: 'test-provider',
      model: 'test-model',
    }).then(
      () => { throw new Error('initialization unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(JsonRpcResponseError)
    expect(failure).toMatchObject({ message: 'credential=[REDACTED]', data: { credential: '[REDACTED]' } })
    expect(JSON.stringify(failure)).not.toContain(credential)
    await client.close()
  })

  it('does not pass a configured handshake credential through the child environment or command line', async () => {
    const credential = 'credential-must-not-reach-child-process'
    const harness = new Clocky({
      launch: fakeLaunch({ SDK_PRODUCT_CREDENTIAL: credential, FAKE_ECHO_ENV: 'SDK_PRODUCT_CREDENTIAL' }),
      credential,
      provider: 'test-provider',
      model: 'test-model',
    })
    cleanups.push(() => harness.close())

    const result = await harness.run('check child environment')
    expect(result.finalResponse).toContain('SDK_PRODUCT_CREDENTIAL=')
    expect(result.finalResponse).not.toContain(credential)
    await harness.close()

    const client = new HarnessClient({ command: process.execPath, args: [fakeRuntime, credential] })
    await expect(client.initialize({ credential, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' }))
      .rejects.toThrow('command and arguments must not contain the product credential')
    expect(client.pid).toBeUndefined()
  })

  it('rejects a second initialization credential without sending it to the existing child', async () => {
    const firstCredential = 'first-sdk-connection-credential'
    const replacementCredential = 'replacement-sdk-connection-credential'
    const client = new HarnessClient(fakeLaunch())
    cleanups.push(() => client.close())

    await client.initialize({ credential: firstCredential, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    await expect(client.initialize({ credential: replacementCredential, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' }))
      .rejects.toThrow('launched with another product credential')
    await expect(client.initialize({ credential: firstCredential, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' }))
      .resolves.toMatchObject({ serverInfo: { name: 'clocky-sdk-runtime' } })
    await client.close()
  })

  it('retries a failed handshake with a fresh runtime process', async () => {
    const dir = await tempDir('sdk-client-retry-')
    const marker = join(dir, 'first-boot-failed')
    const harness = harnessWith({ FAKE_INIT_ERROR_ONCE_FILE: marker, FAKE_TEXT: 'second boot answer' })
    const firstClient = harness.client
    // First start: the scripted runtime fails the handshake and is reaped.
    await expect(harness.start()).rejects.toThrow('scripted first-boot failure')
    // Retry spawns a NEW subprocess through a fresh client (close is permanent).
    const result = await harness.run('again')
    expect(harness.client).not.toBe(firstClient)
    expect(result.finalResponse).toBe('second boot answer')
    await harness.close()
    // close() is terminal: a handshake failure after it must not respawn.
    await expect(harness.run('after-close')).rejects.toThrow(TransportClosedError)
  })

  it('does not replace a failed runtime client after its owning Clocky instance is terminal', async () => {
    const harness = new Clocky({
      launch: fakeLaunch(), credential: TEST_CREDENTIAL, provider: 'test-provider', model: 'test-model',
    }) as unknown as {
      clientInstance: { start(): void; initialize(): Promise<unknown>; close(): Promise<void> }
      closed: boolean
      start(): Promise<void>
    }
    const client = {
      start: () => undefined,
      initialize: () => Promise.reject(new Error('terminal handshake failure')),
      close: () => Promise.resolve(),
    }
    harness.clientInstance = client
    harness.closed = true
    await expect(harness.start()).rejects.toThrow('terminal handshake failure')
    expect(harness.clientInstance).toBe(client)
  })

  it('rejects a malformed initialize result as a protocol error', async () => {
    const harness = harnessWith({ FAKE_MALFORMED: '1' })
    await expect(harness.run('bad')).rejects.toThrow(SdkProtocolError)
  })

  it('supports await using disposal', async () => {
    let captured: Clocky
    {
      await using harness = new Clocky({
        launch: fakeLaunch(), credential: TEST_CREDENTIAL, provider: 'test-provider', model: 'test-model',
      })
      captured = harness
      const result = await harness.run('scoped')
      expect(result.finalResponse).toBe('hello from fake runtime')
    }
    // After scope exit the runtime is closed: reuse fails loudly.
    await expect(captured.run('after')).rejects.toThrow(TransportClosedError)
  })

  it('forwards top-level Team inspection entrypoints after one shared handshake', async () => {
    const client = {
      start: vi.fn(),
      initialize: vi.fn(async () => ({ serverInfo: { name: 'fake', version: '1' } })),
      close: vi.fn(async () => undefined),
      resumeTeam: vi.fn(async () => ({ teamId: 'team-forward', coordinatorSessionId: 'coordinator-forward' })),
      listTeams: vi.fn(async () => ({ items: [] })),
      getTeam: vi.fn(async () => ({ state: {} })),
      listTeamMembers: vi.fn(async () => ({ items: [] })),
      listTeamTasks: vi.fn(async () => ({ items: [] })),
      getTeamQuiescence: vi.fn(async () => ({ value: {} })),
      getTeamMetrics: vi.fn(async () => ({})),
      readTeamAudit: vi.fn(async () => ({ teamId: 'team-forward', items: [] })),
    }
    const harness = new Clocky({ launch: fakeLaunch(), credential: TEST_CREDENTIAL, provider: 'provider', model: 'model' })
    ;(harness as unknown as { clientInstance: typeof client }).clientInstance = client

    const resumed = await harness.resumeTeam({ teamId: 'team-forward', expectedCursor: 7 })
    await harness.listTeams()
    await harness.getTeam('team-forward')
    await harness.listTeamMembers('team-forward')
    await harness.listTeamTasks('team-forward')
    await harness.teamQuiescence('team-forward')
    await harness.teamMetrics()
    await harness.teamAudit({ teamId: 'team-forward' })
    await harness.close()

    expect(resumed).toMatchObject({ id: 'team-forward', coordinatorSessionId: 'coordinator-forward' })
    expect(client.initialize).toHaveBeenCalledOnce()
    expect(client.resumeTeam).toHaveBeenCalledWith({ teamId: 'team-forward', expectedCursor: 7 })
    expect(client.listTeams).toHaveBeenCalledWith({})
    expect(client.getTeam).toHaveBeenCalledWith({ teamId: 'team-forward' })
    expect(client.listTeamMembers).toHaveBeenCalledWith({ teamId: 'team-forward' })
    expect(client.listTeamTasks).toHaveBeenCalledWith({ teamId: 'team-forward' })
    expect(client.getTeamQuiescence).toHaveBeenCalledWith({ teamId: 'team-forward' })
    expect(client.getTeamMetrics).toHaveBeenCalledWith()
    expect(client.readTeamAudit).toHaveBeenCalledWith({ teamId: 'team-forward' })
    expect(client.close).toHaveBeenCalledOnce()
  })
})

describe('HarnessClient', () => {
  it('publishes its spawned runtime pid only after the first protocol request starts the child', async () => {
    const client = new HarnessClient(fakeLaunch())
    cleanups.push(() => client.close())
    expect(client.pid).toBeUndefined()
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    expect(client.pid).toEqual(expect.any(Number))
    expect(client.pid).toBeGreaterThan(0)
    await client.close()
  })

  it('times out a hung request at the per-call bound', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_HANG_PROMPT: '1' }))
    cleanups.push(() => client.close())
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    await expect(client.request('team/create', { objective: 'Hi.', contentBlocks: normalizeInput('hi') }, 200))
      .rejects.toThrow(RequestTimeoutError)
    await client.close()
  })

  it('a timed-out request leaves no pending transport state', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_HANG_PROMPT: '1' }))
    cleanups.push(() => client.close())
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    for (let round = 0; round < 3; round++) {
      await expect(client.request('team/create', { objective: 'X.', contentBlocks: normalizeInput('x') }, 50))
        .rejects.toThrow(RequestTimeoutError)
    }
    // Abandonment removed each pending entry at its timeout; a hung method
    // retains nothing per call. (Private map read is the observable here —
    // no wire surface reports transport bookkeeping.)
    const transport = (client as unknown as { transport: { pending: Map<string, unknown> } }).transport
    expect(transport.pending.size).toBe(0)
    await client.close()
  })

  it('applies the client-wide request timeout when no per-call bound is given', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_HANG_PROMPT: '1' }, { requestTimeoutMs: 400 }))
    cleanups.push(() => client.close())
    // The bound applies from send, so it holds regardless of runtime boot time.
    await expect(client.createTeam({ objective: 'Hi.', contentBlocks: normalizeInput('hi') })).rejects.toThrow(RequestTimeoutError)
    await client.close()
  })

  it('rejects a malformed Team creation result as a protocol error', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_MALFORMED: '1' }))
    cleanups.push(() => client.close())
    await expect(client.createTeam({ objective: 'Hi.', contentBlocks: normalizeInput('hi') })).rejects.toThrow(SdkProtocolError)
    await client.close()
  })

  it('validates and sends an actor-free detached Team archive request', async () => {
    const client = new HarnessClient(fakeLaunch())
    cleanups.push(() => client.close())
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    await expect(client.archiveTeam({ teamId: 'detached-terminal', expectedCursor: 3 })).resolves.toEqual({ teamId: 'detached-terminal', archivedAt: 7 })
    await expect(client.archiveTeam({
      teamId: 'detached-terminal', expectedCursor: 3, actor: 'forged',
    } as never)).rejects.toThrow(SdkProtocolError)
    await client.close()
  })

  it('reads and acknowledges a principal inbox through the initialized stdio SDK', async () => {
    const harness = harnessWith()
    await expect(harness.inboxRead({ afterCursor: 4, limit: 2 })).resolves.toEqual({ items: [], displayCursor: 4, cursor: 6 })
    await expect(harness.inboxWatch({ afterCursor: 6 })).resolves.toMatchObject({ cursor: 6 })
    await expect(harness.inboxAcknowledge({ throughCursor: 4 })).resolves.toEqual({ displayCursor: 4 })
    await expect(harness.client.inboxRead({ principalId: 'other' } as never)).rejects.toThrow(SdkProtocolError)
    await expect(harness.client.inboxAcknowledge({ throughCursor: -1 })).rejects.toThrow(SdkProtocolError)
  })

  it('discovers channel capabilities and preserves explicit summary selection through both SDK layers', async () => {
    const harness = harnessWith()
    await harness.start()
    const catalog = await harness.client.getTeamChannelCatalog()
    expect(catalog.summary).toMatchObject({ allowedPolicies: ['summarized-window'], maxHistorySpan: 32 })
    const input = { channelId: 'summary-channel', expectedCursor: 8, coveredSequenceRange: { from: 3, to: 5 }, idempotencyKey: 'chosen-range' }
    const saved = await harness.client.summarizeTeamChannel(input)
    expect(saved.value).toMatchObject({ coveredSequenceRange: input.coveredSequenceRange, idempotencyKey: input.idempotencyKey })
    await expect(harness.client.getTeamChannelCatalog({ actor: 'forged' } as never)).rejects.toThrow(SdkProtocolError)
    await expect(harness.client.summarizeTeamChannel({ ...input, actor: 'forged' } as never)).rejects.toThrow(SdkProtocolError)
    await expect(harness.client.summarizeTeamChannel({ ...input, coveredSequenceRange: { from: 5, to: 3 } })).rejects.toThrow(SdkProtocolError)
    const team = await harness.createTeam('channel capabilities')
    expect(await team.channelCatalog()).toEqual(catalog)
    expect(await team.summarizeChannel(input)).toEqual(saved)
    await harness.close()
  })

  it('sends ordered channel media and reads an exact Envelope attachment through both SDK layers', async () => {
    const harness = harnessWith()
    await harness.start()
    const input = { channelId: 'media-channel', expectedCursor: 2, audience: ['peer'], delivery: 'turn' as const,
      content: [{ type: 'text' as const, text: 'Before' }, { type: 'image' as const, mediaType: 'image/png' as const, data: 'cGl4' }, { type: 'text' as const, text: 'After' }] }
    await expect(harness.client.inputTeamChannel({ ...input, actor: 'forged' } as never)).rejects.toThrow(SdkProtocolError)
    const posted = await harness.client.inputTeamChannel(input)
    expect(posted.value.payload.content).toMatchObject([{ type: 'text', text: 'Before' }, { type: 'image', attachment: { attachmentId: 'fixture-image' } }, { type: 'text', text: 'After' }])
    const selection = { teamId: 'team-1', channelId: 'media-channel', envelopeId: posted.value.id, envelopeSequence: posted.value.sequence, attachmentId: 'fixture-image' }
    await expect(harness.client.readTeamChannelAttachment(selection)).resolves.toMatchObject({ attachment: { attachmentId: 'fixture-image' }, data: 'cGl4' })
    await expect(harness.client.readTeamChannelAttachment({ ...selection, actor: 'forged' } as never)).rejects.toThrow(SdkProtocolError)
    await expect(harness.client.readTeamChannelAttachment({ ...selection, envelopeSequence: -1 })).rejects.toThrow(SdkProtocolError)
    await expect(harness.client.readTeamChannelAttachment({ teamId: selection.teamId, channelId: selection.channelId, envelopeId: selection.envelopeId, attachmentId: selection.attachmentId } as never)).rejects.toThrow(SdkProtocolError)
    const team = await harness.createTeam('channel media')
    expect(await team.inputChannel(input)).toEqual(posted)
    await expect(team.channelAttachment({ channelId: 'media-channel', envelopeId: posted.value.id, envelopeSequence: posted.value.sequence, attachmentId: 'fixture-image' }))
      .resolves.toMatchObject({ data: 'cGl4' })
    await harness.close()
  })

  it('pages channel projections through stdio and pins the high-level Team identity', async () => {
    const harness = harnessWith()
    await harness.start()
    const first = await harness.client.listTeamChannels({ teamId: 'team-1', limit: 1 })
    expect(first.items.map(channel => channel.manifest.id)).toEqual(['listed-0'])
    expect(first.nextCursor).toBe(0)
    await expect(harness.client.listTeamChannels({ teamId: 'team-1', actor: 'forged' } as never)).rejects.toThrow(SdkProtocolError)
    await expect(harness.client.listTeamChannels({ teamId: 'team-1', limit: 0 })).rejects.toThrow(SdkProtocolError)
    const team = await harness.createTeam('list channels')
    const next = await team.channels({ afterCursor: first.nextCursor, limit: 2, teamId: 'forged-team' } as never)
    expect(next.items.map(channel => channel.manifest.id)).toEqual(['listed-1', 'listed-2'])
    expect(next.items.every(channel => channel.manifest.teamId === team.id)).toBe(true)
    expect(next.nextCursor).toBeUndefined()
    await harness.close()
  })

  it('reads pending channel admission through the initialized stdio client and Team handle', async () => {
    const harness = harnessWith()
    await harness.start()
    await expect(harness.client.getTeamChannelAdmission({ teamId: 'team-1', channelId: 'pending-channel' }))
      .resolves.toMatchObject({ value: { channel: { phase: 'pending' }, invitations: [{ status: 'pending' }] } })
    await expect(harness.client.getTeamChannelAdmission({ teamId: 'team-1', channelId: 'pending-channel', actor: 'forged' } as never))
      .rejects.toThrow(SdkProtocolError)
    const team = await harness.createTeam('inspect admission')
    await expect(team.admission('pending-channel')).resolves.toMatchObject({ value: { channel: { manifest: { teamId: team.id, id: 'pending-channel' } } } })
    await harness.close()
  })

  it('reads a visible Team artifact through the low-level and Team-handle SDK APIs', async () => {
    const harness = harnessWith()
    await harness.start()
    await expect(harness.client.readTeamArtifact({ teamId: 'team-1', artifactId: 'artifact-1' })).resolves.toEqual({
      artifact: { id: 'artifact-1', provider: 'local', kind: 'report', uri: 'artifact://report', visibility: 'team' },
      bytes: 4,
      data: 'dGVzdA==',
    })
    const team = await harness.createTeam('artifact')
    await expect(team.readArtifact('artifact-1')).resolves.toMatchObject({ bytes: 4, data: 'dGVzdA==' })
    await harness.close()
  })

  it('rejects malformed results from every low-level Team route', async () => {
    const client = new HarnessClient(fakeLaunch())
    const request = vi.spyOn(client, 'request').mockResolvedValue({})
    const invite = {
      teamId: 'team', expectedCursor: 1, kind: 'local-agent' as const, displayName: 'Worker', role: 'reviewer', capabilities: [],
    }
    const channelOpen = {
      teamId: 'team', expectedCursor: 1, adapter: { type: 'direct', version: 3 }, participants: [], limits: {},
    }
    const channelPost = {
      channelId: 'channel', expectedCursor: 1, audience: null, kind: 'message', payload: {}, delivery: 'turn' as const,
    }
    const taskCreate = {
      teamId: 'team', expectedCursor: 1, idempotencyKey: 'sdk-client-task-create', subject: 'Task', description: 'Do the task.', blockedBy: [], requiredCapabilities: [],
      priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared' as const, budget: {}, reviewPolicy: { kind: 'none' as const }, maxAttempts: 1,
    }
    const malformed = async (operation: Promise<unknown>): Promise<void> => {
      await expect(operation).rejects.toThrow(SdkProtocolError)
    }

    await malformed(client.listTeams())
    await malformed(client.getTeam({ teamId: 'team' }))
    await malformed(client.updateTeamGoal({ teamId: 'team', expectedRevision: 1, objective: 'Update the objective.' }))
    await malformed(client.transitionTeamGoal({ teamId: 'team', expectedRevision: 2, phase: 'paused' }))
    await malformed(client.getTeamQuiescence({ teamId: 'team' }))
    await malformed(client.getTeamMetrics())
    await malformed(client.inboxRespond({ teamId: 'team', actionId: 'action', expectedUpdatedAt: 1, idempotencyKey: 'answer', answer: { kind: 'approval', outcome: 'rejected' } }))
    await malformed(client.inboxRead({}))
    await malformed(client.inboxWatch({ afterCursor: 4, limit: 2 }))
    await malformed(client.inboxAcknowledge({ throughCursor: 4 }))
    await malformed(client.readTeamAudit({ teamId: 'team' }))
    await malformed(client.readTeamArtifact({ teamId: 'team', artifactId: 'artifact' }))
    await malformed(client.getTeamChannelAdmission({ teamId: 'team', channelId: 'channel' }))
    await malformed(client.listTeamChannels({ teamId: 'team' }))
    await malformed(client.inputTeamChannel({ channelId: 'channel', expectedCursor: 1, audience: null, delivery: 'turn', content: [{ type: 'text', text: 'hello' }] }))
    await malformed(client.readTeamChannelAttachment({ teamId: 'team', channelId: 'channel', envelopeId: 'envelope', envelopeSequence: 1, attachmentId: 'attachment' }))
    await malformed(client.listTeamMembers({ teamId: 'team' }))
    await malformed(client.inviteTeamMember(invite))
    await malformed(client.activateTeamMember({ teamId: 'team', participantId: 'participant', expectedCursor: 1 }))
    await malformed(client.removeTeamMember({ teamId: 'team', participantId: 'participant', expectedCursor: 1 }))
    await malformed(client.interruptTeamMember({ teamId: 'team', participantId: 'participant', expectedCursor: 1 }))
    await malformed(client.openTeamChannel(channelOpen))
    await malformed(client.postTeamChannel(channelPost))
    await malformed(client.readTeamChannel({ channelId: 'channel' }))
    await malformed(client.closeTeamChannel({ channelId: 'channel', expectedCursor: 1 }))
    await malformed(client.watchTeamChannel({ channelId: 'channel' }))
    await malformed(client.listTeamTasks({ teamId: 'team' }))
    await malformed(client.createTeamTask(taskCreate))
    await malformed(client.getTeamTask({ teamId: 'team', taskId: 'task' }))
    await malformed(client.updateTeamTask({ teamId: 'team', taskId: 'task', expectedRevision: 1, subject: 'Changed' }))
    await malformed(client.cancelTeamTask({ teamId: 'team', taskId: 'task', expectedRevision: 1 }))
    await malformed(client.deleteTeamTask({ teamId: 'team', taskId: 'task', expectedRevision: 1 }))
    await malformed(client.reviewTeamTask({
      teamId: 'team', taskId: 'task', expectedRevision: 1, decision: 'accepted', reason: 'Looks good.',
    }))
    await malformed(client.watchTeamTasks({ teamId: 'team' }))
    await malformed(client.resumeTeam({ teamId: 'team', expectedCursor: 1 }))
    await malformed(client.waitForTeamFinal({ teamId: 'team' }))
    await malformed(client.cancelTeam({ teamId: 'team' }))
    await malformed(client.archiveTeam({ teamId: 'team', expectedCursor: 1 }))

    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'team/list', 'team/get', 'team/goal-update', 'team/goal-transition', 'team/quiescence', 'team/metrics', 'team/inbox-respond', 'team/inbox-read', 'team/inbox-watch', 'team/inbox-acknowledge', 'team/audit-read', 'team/artifact-read', 'team/channel-admission', 'team/channel-list', 'team/channel-input', 'team/channel-attachment', 'team/member-list',
      'team/member-invite', 'team/member-activate', 'team/member-remove', 'team/member-interrupt', 'team/channel-open',
      'team/channel-post', 'team/channel-read', 'team/channel-close', 'team/channel-watch', 'team/task-list', 'team/task-create',
      'team/task-get', 'team/task-update', 'team/task-cancel', 'team/task-delete', 'team/task-review', 'team/task-watch',
      'team/resume', 'team/wait-final', 'team/cancel', 'team/archive',
    ])
  })

  it('fails pending requests with exit code and stderr tail when the runtime dies', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_EXIT_BEFORE_INIT: '1', FAKE_STDERR: 'fatal: scripted death' }))
    cleanups.push(() => client.close())
    const failure = await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' }).then(
      () => { throw new Error('initialize unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(TransportClosedError)
    expect(String(failure)).toContain('exit code: 3')
    expect(String(failure)).toContain('fatal: scripted death')
    // Requests after death fail immediately with the same context.
    await expect(client.request('initialize', {})).rejects.toThrow('exit code: 3')
  })

  it('flushes an unterminated stderr line into the tail at close', async () => {
    const client = new HarnessClient(fakeLaunch({ FAKE_STDERR_NO_NEWLINE: 'no trailing newline', FAKE_EXIT_BEFORE_INIT: '1' }))
    cleanups.push(() => client.close())
    const failure = await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' }).then(
      () => { throw new Error('initialize unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(String(failure)).toContain('no trailing newline')
  })

  it('fails fast when the command does not exist', async () => {
    const client = new HarnessClient({ command: join(tmpdir(), 'clocky-no-such-runtime-bin') })
    cleanups.push(() => client.close())
    await expect(client.request('initialize', {}, 1_000)).rejects.toThrow(TransportClosedError)
  })

  it('close() is idempotent, reaps the child, and fails later use', async () => {
    const client = new HarnessClient(fakeLaunch())
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    await Promise.all([client.close(), client.close()])
    expect(() => { client.start() }).toThrow(TransportClosedError)
    await expect(client.request('anything')).rejects.toThrow(TransportClosedError)
    // Close with no child ever spawned is a no-op.
    const untouched = new HarnessClient(fakeLaunch())
    await untouched.close()
  })

  it('escalates through SIGTERM when the runtime ignores EOF', async () => {
    const dir = await tempDir('sdk-client-ladder-')
    const sigtermFile = join(dir, 'sigterm.txt')
    const client = new HarnessClient(fakeLaunch(
      { FAKE_IGNORE_EOF: '1', FAKE_SIGTERM_FILE: sigtermFile },
      { shutdownTimeoutMs: 100, disposeEofGraceMs: 100, disposeGraceMs: 1_000 },
    ))
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    await client.close()
    if (process.platform === 'win32') {
      await expect(stat(sigtermFile)).rejects.toMatchObject({ code: 'ENOENT' })
    } else {
      expect((await stat(sigtermFile)).isFile()).toBe(true)
    }
  })

  it('escalates to SIGKILL when the runtime traps SIGTERM too', async () => {
    const client = new HarnessClient(fakeLaunch(
      { FAKE_IGNORE_EOF: '1', FAKE_TRAP_SIGTERM: '1' },
      { shutdownTimeoutMs: 100, disposeEofGraceMs: 100, disposeGraceMs: 300 },
    ))
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    // Resolves (does not hang or reject): the SIGKILL rung reaped the child.
    await client.close()
  })

  it('delivers notifications to unfiltered and filtered subscriptions in wire order', async () => {
    const client = new HarnessClient(fakeLaunch())
    cleanups.push(() => client.close())
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })

    const all = client.subscribe()
    const idleOnly = client.subscribe(n => n.method === 'session.status' && n.params.status === 'idle')
    const firstPending = all.next()
    await client.createTeam({ objective: 'Go.', contentBlocks: normalizeInput('go') })

    const first = await firstPending
    expect(first.method).toBe('session.event')
    const idle = await idleOnly.next()
    expect(idle.method).toBe('session.status')
    expect(idleOnly.tryNext()).toBeUndefined()

    // A bare unbounded request with omitted params sends `{}` on the wire.
    const identity = await client.request('initialize') as { serverInfo: { name: string } }
    expect(identity.serverInfo.name).toBe('clocky-sdk-runtime')

    // Async iteration consumes queued items and then parks.
    const collected: string[] = []
    for await (const notification of all) {
      collected.push(notification.method)
      if (notification.method === 'session.status' && notification.params.status === 'idle') break
    }
    expect(collected.at(-1)).toBe('session.status')

    all.close()
    idleOnly.close()
    await expect(all.next()).rejects.toThrow('notification subscription closed')
    await client.close()
  })

  it('contains a throwing filter to its own subscription', async () => {
    const client = new HarnessClient(fakeLaunch())
    cleanups.push(() => client.close())
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })

    const broken = client.subscribe(() => { throw new Error('filter exploded') })
    // A non-Error throw is normalized rather than crashing dispatch.
    const brokenNonError = client.subscribe(() => { throw 'string boom' })
    const healthy = client.subscribe(n => n.method === 'session.status' && n.params.status === 'idle')
    await client.createTeam({ objective: 'Go.', contentBlocks: normalizeInput('go') })

    // The sibling subscription and the read loop are undisturbed.
    expect((await healthy.next()).method).toBe('session.status')
    // Each broken subscription failed with ITS OWN error and detached.
    await expect(broken.next()).rejects.toThrow('filter exploded')
    await expect(brokenNonError.next()).rejects.toThrow('string boom')
    healthy.close()
    await client.close()
  })

  it('close() drops queued notifications; runtime death keeps them drainable', async () => {
    const client = new HarnessClient(fakeLaunch())
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    const closed = client.subscribe()
    const drainable = client.subscribe()
    await client.createTeam({ objective: 'Go.', contentBlocks: normalizeInput('go') })
    expect(closed.tryNext()).toBeDefined()
    closed.close()
    // Manual close drops the rest of the queue outright.
    expect(closed.tryNext()).toBeUndefined()
    await expect(closed.next()).rejects.toThrow('notification subscription closed')
    // Runtime teardown, by contrast, only stops FUTURE delivery: what was
    // already delivered before close() stays drainable.
    await client.close()
    expect(drainable.tryNext()).toBeDefined()
  })

  it('subscriptions created after termination are born failed', async () => {
    const client = new HarnessClient(fakeLaunch())
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    await client.close()
    // No producer can ever feed this subscription; next() must not park forever.
    await expect(client.subscribe().next()).rejects.toThrow(TransportClosedError)

    const dead = new HarnessClient(fakeLaunch({ FAKE_EXIT_BEFORE_INIT: '1' }))
    cleanups.push(() => dead.close())
    await dead.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' }).catch(() => {})
    await expect(dead.subscribe().next()).rejects.toThrow(TransportClosedError)
  })

  it('closes subscriptions with the runtime and rejects parked waiters', async () => {
    const client = new HarnessClient(fakeLaunch())
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    const subscription = client.subscribe()
    const parked = subscription.next()
    await client.close()
    await expect(parked).rejects.toThrow(TransportClosedError)
  })

  it('opens, observes, interrupts, queries, and disposes an exact activation without closing the runtime', async () => {
    const client = new HarnessClient(fakeLaunch())
    cleanups.push(() => client.close())
    await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    const target = activationTarget()
    const notifications = client.subscribe()

    const opened = await client.openActivation({ target, seed: { kind: 'fresh' } })
    expect(opened).toEqual({ ...target, status: 'idle', statusSequence: 0 })
    const openingNotification = parseActivationStatusNotification(await notifications.next())
    expect(openingNotification).toEqual({ state: opened })
    expect(await client.getActivationStatus({ target })).toEqual(opened)
    await expect(client.enrollActivationLink({
      target,
      binding: { ...target, provider: 'sdk' },
      enrollment: {
        provider: 'websocket',
        endpoint: 'wss://team.example.test/team-link',
        capability: 'opaque-capability',
      },
    })).resolves.toBeUndefined()

    await client.interruptActivation({ target, cause: { kind: 'parent' } })
    expect(parseActivationStatusNotification(await notifications.next())).toEqual({
      state: { ...target, status: 'running', statusSequence: 1 },
    })
    const disposed = await client.disposeActivation({ target })
    expect(disposed).toEqual({ ...target, status: 'offline', statusSequence: 2 })
    expect(parseActivationStatusNotification(await notifications.next())).toEqual({ state: disposed })

    // Activation disposal is local: the same process still accepts new product Teams.
    await expect(client.createTeam({ objective: 'Still alive.', contentBlocks: normalizeInput('still alive') }))
      .resolves.toMatchObject({ teamId: expect.any(String) as unknown })
    notifications.close()
    await client.close()
  })

  it('rejects malformed activation request, response, acknowledgement, and notification payloads', async () => {
    const invalid = new HarnessClient(fakeLaunch())
    cleanups.push(() => invalid.close())
    await expect(invalid.openActivation({
      target: activationTarget({ sessionId: '' }),
      seed: { kind: 'fresh' },
    })).rejects.toThrow(SdkProtocolError)
    await expect(invalid.createTeam({ objective: '', contentBlocks: normalizeInput('invalid Team') })).rejects.toThrow(SdkProtocolError)
    await expect(invalid.enrollActivationLink({
      target: activationTarget(),
      binding: { ...activationTarget(), provider: '' },
      enrollment: { provider: 'websocket', endpoint: 'wss://team.example.test/team-link', capability: 'opaque-capability' },
    })).rejects.toThrow(SdkProtocolError)

    const malformedOpen = new HarnessClient(fakeLaunch({ FAKE_ACTIVATION_MALFORMED_OPEN_RESULT: '1' }))
    cleanups.push(() => malformedOpen.close())
    await malformedOpen.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    await expect(malformedOpen.openActivation({ target: activationTarget(), seed: { kind: 'fresh' } })).rejects.toThrow(SdkProtocolError)

    const malformedInterrupt = new HarnessClient(fakeLaunch({ FAKE_ACTIVATION_MALFORMED_INTERRUPT_RESULT: '1' }))
    cleanups.push(() => malformedInterrupt.close())
    await malformedInterrupt.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    await malformedInterrupt.openActivation({ target: activationTarget(), seed: { kind: 'fresh' } })
    await expect(malformedInterrupt.interruptActivation({ target: activationTarget(), cause: { kind: 'user' } }))
      .rejects.toThrow(SdkProtocolError)

    const malformedDispose = new HarnessClient(fakeLaunch({ FAKE_ACTIVATION_MALFORMED_DISPOSE_RESULT: '1' }))
    cleanups.push(() => malformedDispose.close())
    await malformedDispose.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    await malformedDispose.openActivation({ target: activationTarget(), seed: { kind: 'fresh' } })
    await expect(malformedDispose.disposeActivation({ target: activationTarget() })).rejects.toThrow(SdkProtocolError)

    const malformedEnrollment = new HarnessClient(fakeLaunch({ FAKE_ACTIVATION_MALFORMED_LINK_ENROLL_RESULT: '1' }))
    cleanups.push(() => malformedEnrollment.close())
    await malformedEnrollment.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' })
    await expect(malformedEnrollment.enrollActivationLink({
      target: activationTarget(),
      binding: { ...activationTarget(), provider: 'sdk' },
      enrollment: { provider: 'websocket', endpoint: 'wss://team.example.test/team-link', capability: 'opaque-capability' },
    })).rejects.toThrow(SdkProtocolError)

    expect(parseActivationStatusNotification({ method: 'session.status', params: {} })).toBeUndefined()
    expect(() => parseActivationStatusNotification({ method: 'activation.status', params: { state: { activationId: 'bad' } } }))
      .toThrow(SdkProtocolError)
  })
})

describe('HarnessTeam forwarding', () => {
  it('forwards every Team inspection and lifecycle helper with the stable Team identity', async () => {
    const start = vi.fn(async () => undefined)
    const client = {
      resumeTeam: vi.fn(async () => ({ teamId: 'team-forward', coordinatorSessionId: 'coordinator-forward' })),
      getTeam: vi.fn(async () => ({ state: { team: { cursor: 41 } } })),
      listTeamMembers: vi.fn(async () => ({ items: [] })),
      listTeamTasks: vi.fn(async () => ({ items: [] })),
      updateTeamGoal: vi.fn(async () => ({ state: {} })),
      transitionTeamGoal: vi.fn(async () => ({ state: {} })),
      getTeamQuiescence: vi.fn(async () => ({ value: {} })),
      getTeamMetrics: vi.fn(async () => ({})),
      readTeamAudit: vi.fn(async () => ({ teamId: 'team-forward', items: [] })),
      readTeamArtifact: vi.fn(async () => ({ artifact: {}, bytes: 0, data: '' })),
      inviteTeamMember: vi.fn(async () => ({ value: {} })),
      activateTeamMember: vi.fn(async () => ({ value: {} })),
      removeTeamMember: vi.fn(async () => ({ value: {} })),
      interruptTeamMember: vi.fn(async () => ({ value: {} })),
      openTeamChannel: vi.fn(async () => ({ value: {} })),
      postTeamChannel: vi.fn(async () => ({ value: {} })),
      readTeamChannel: vi.fn(async () => ({ value: {} })),
      closeTeamChannel: vi.fn(async () => ({ value: {} })),
      watchTeamChannel: vi.fn(async () => ({ value: {} })),
      createTeamTask: vi.fn(async () => ({ value: {} })),
      getTeamTask: vi.fn(async () => ({ value: {} })),
      updateTeamTask: vi.fn(async () => ({ value: {} })),
      cancelTeamTask: vi.fn(async () => ({ value: {} })),
      deleteTeamTask: vi.fn(async () => ({ value: {} })),
      reviewTeamTask: vi.fn(async () => ({ value: {} })),
      watchTeamTasks: vi.fn(async () => ({ value: {} })),
      waitForTeamFinal: vi.fn(async () => ({ teamId: 'team-forward', channelId: 'channel', envelopeId: 'envelope', text: 'done' })),
      cancelTeam: vi.fn(async () => ({ phase: 'cancelled' as const })),
      archiveTeam: vi.fn(async () => ({ teamId: 'team-forward', archivedAt: 42 })),
    }
    const harness = { start, client } as unknown as Clocky
    const team = new HarnessTeam(harness, 'team-forward', 'coordinator-forward')

    await team.resume({ expectedCursor: 12 })
    await team.state()
    await team.updateGoal({ teamId: 'forged-goal-team', expectedRevision: 1, objective: 'Update the objective.' } as never)
    await team.transitionGoal({ teamId: 'forged-transition-team', expectedRevision: 2, phase: 'paused' } as never)
    await team.members({ afterCursor: 2, limit: 3, teamId: 'forged-members-team' } as never)
    await team.members()
    await team.tasks({ afterCursor: 4, limit: 5, teamId: 'forged-tasks-team' } as never)
    await team.tasks()
    await team.quiescence()
    await team.metrics()
    await team.audit({ channelId: 'channel', afterCursor: 6, limit: 7, teamId: 'forged-audit-team' } as never)
    await team.readArtifact('artifact')
    await team.inviteMember({ teamId: 'forged-invite-team', expectedCursor: 1, kind: 'local-agent', displayName: 'Worker', role: 'reviewer', capabilities: [] } as never)
    await team.activateMember({ teamId: 'forged-activate-team', participantId: 'participant', expectedCursor: 1 } as never)
    await team.removeMember({ teamId: 'forged-remove-team', participantId: 'participant', expectedCursor: 1 } as never)
    await team.interruptMember({ teamId: 'forged-interrupt-team', participantId: 'participant', expectedCursor: 1 } as never)
    await team.openChannel({ teamId: 'forged-channel-team', expectedCursor: 1, adapter: { type: 'direct', version: 3 }, participants: [], limits: {} } as never)
    await team.postChannel({ channelId: 'channel', expectedCursor: 1, audience: null, kind: 'message', payload: {}, delivery: 'turn' })
    await team.channel('channel', 8, 9)
    await team.channel('channel')
    await team.closeChannel({ channelId: 'channel', expectedCursor: 1 })
    await team.watchChannel('channel', 10)
    await team.watchChannel('channel')
    await team.createTask({
      expectedCursor: 1, idempotencyKey: 'sdk-team-task-create', subject: 'Task', description: 'Do the task.', blockedBy: [], requiredCapabilities: [], priority: 0,
      readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
    })
    await team.task('task')
    await team.updateTask({ taskId: 'task', expectedRevision: 1, subject: 'Changed' })
    await team.cancelTask({ taskId: 'task', expectedRevision: 1 })
    await team.deleteTask({ taskId: 'task', expectedRevision: 1 })
    await team.reviewTask({ taskId: 'task', expectedRevision: 1, decision: 'accepted', reason: 'Looks good.' })
    await team.watchTasks(11)
    await team.watchTasks()
    await team.waitForFinal()
    await team.cancel()
    await team.archive()

    expect(client.listTeamMembers).toHaveBeenCalledWith({ teamId: 'team-forward', afterCursor: 2, limit: 3 })
    expect(client.listTeamTasks).toHaveBeenCalledWith({ teamId: 'team-forward', afterCursor: 4, limit: 5 })
    expect(client.updateTeamGoal).toHaveBeenCalledWith({ teamId: 'team-forward', expectedRevision: 1, objective: 'Update the objective.' })
    expect(client.transitionTeamGoal).toHaveBeenCalledWith({ teamId: 'team-forward', expectedRevision: 2, phase: 'paused' })
    expect(client.readTeamAudit).toHaveBeenCalledWith({ teamId: 'team-forward', channelId: 'channel', afterCursor: 6, limit: 7 })
    expect(client.readTeamChannel).toHaveBeenCalledWith({ channelId: 'channel', afterCursor: 8, limit: 9 })
    expect(client.watchTeamChannel).toHaveBeenCalledWith({ channelId: 'channel', afterCursor: 10 })
    expect(client.watchTeamTasks).toHaveBeenCalledWith({ teamId: 'team-forward', afterCursor: 11 })
    expect(client.archiveTeam).toHaveBeenCalledWith({ teamId: 'team-forward', expectedCursor: 41 })
    expect(start).toHaveBeenCalled()
  })

  it('keeps every task mutation pinned to the handle Team when runtime values carry another teamId', async () => {
    const start = vi.fn(async () => undefined)
    const client = {
      createTeamTask: vi.fn(async () => ({ value: {} })),
      updateTeamTask: vi.fn(async () => ({ value: {} })),
      cancelTeamTask: vi.fn(async () => ({ value: {} })),
      deleteTeamTask: vi.fn(async () => ({ value: {} })),
      reviewTeamTask: vi.fn(async () => ({ value: {} })),
    }
    const team = new HarnessTeam({ start, client } as unknown as Clocky, 'team-bound', 'coordinator-bound')

    await team.createTask({
      teamId: 'team-untrusted', expectedCursor: 1, idempotencyKey: 'sdk-task-bound-create', subject: 'Task', description: 'Do the task.',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
    } as never)
    await team.updateTask({ teamId: 'team-untrusted', taskId: 'task', expectedRevision: 1, subject: 'Changed' } as never)
    await team.cancelTask({ teamId: 'team-untrusted', taskId: 'task', expectedRevision: 1 } as never)
    await team.deleteTask({ teamId: 'team-untrusted', taskId: 'task', expectedRevision: 1 } as never)
    await team.reviewTask({ teamId: 'team-untrusted', taskId: 'task', expectedRevision: 1, decision: 'accepted', reason: 'Reviewed.' } as never)

    expect(client.createTeamTask).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-bound' }))
    expect(client.updateTeamTask).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-bound' }))
    expect(client.cancelTeamTask).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-bound' }))
    expect(client.deleteTeamTask).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-bound' }))
    expect(client.reviewTeamTask).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-bound' }))
    expect(start).toHaveBeenCalledTimes(5)
  })
})

describe('wire payload validation', () => {
  it('preserves valid channel views and rejects the shared invalid wire corpus', async () => {
    const corpus = JSON.parse(await readFile(
      new URL('../../protocol/tests/fixtures/team-channel-view-cases.json', import.meta.url),
      'utf8',
    )) as { readonly name: string; readonly valid: boolean; readonly event: Record<string, unknown> }[]
    for (const entry of corpus) {
      const harness = harnessWith({ FAKE_SESSION_EVENT_JSON: JSON.stringify(entry.event) })
      try {
        if (entry.valid) {
          const result = await harness.run(entry.name)
          expect(result.events.find(event => event.type === 'team/channel-view'), entry.name).toEqual(entry.event)
        } else {
          await expect(harness.run(entry.name), entry.name).rejects.toThrow(SdkProtocolError)
        }
      } finally {
        await harness.close()
      }
    }
  })

  it('rejects a non-object session.event envelope as a protocol error', async () => {
    const harness = harnessWith({ FAKE_MALFORMED_EVENT: '1' })
    await expect(harness.run('bad-event')).rejects.toThrow(SdkProtocolError)
  })

  it('rejects an assistant/message without a content array as a protocol error', async () => {
    const harness = harnessWith({ FAKE_MALFORMED_MESSAGE: '1' })
    await expect(harness.run('bad-message')).rejects.toThrow(SdkProtocolError)
  })

  it('rejects an assistant/message without a data member as a protocol error', async () => {
    const harness = harnessWith({ FAKE_MESSAGE_WITHOUT_DATA: '1' })
    await expect(harness.run('no-data')).rejects.toThrow(SdkProtocolError)
  })

})

describe('stderr tail bound', () => {
  it('keeps only the newest lines up to the limit', async () => {
    const manyLines = Array.from({ length: 450 }, (_, i) => `line-${i}`).join('\n')
    const client = new HarnessClient(fakeLaunch({ FAKE_STDERR: manyLines, FAKE_EXIT_BEFORE_INIT: '1' }))
    cleanups.push(() => client.close())
    const failure = await client.initialize({ credential: TEST_CREDENTIAL, cwd: process.cwd(), provider: 'p', model: 'm' }).then(
      () => { throw new Error('initialize unexpectedly succeeded') },
      (error: unknown) => error,
    )
    const text = String(failure)
    // The tail is bounded to the newest 400 lines: the oldest are dropped.
    expect(text).toContain('line-449')
    expect(text).not.toContain('line-0\n')
  })
})

describe('pure helpers', () => {
  it('normalizeInput wraps strings and passes blocks through', () => {
    expect(normalizeInput('x')).toEqual([{ type: 'text', text: 'x' }])
    const blocks = [{ type: 'text' as const, text: 'y' }]
    expect(normalizeInput(blocks)).toBe(blocks)
  })

  it('derives a text objective and preserves an explicit objective', () => {
    const blocks = [{ type: 'text' as const, text: 'first' }, { type: 'text' as const, text: 'second' }]
    expect(resolveObjective(blocks, blocks, undefined)).toBe('first\nsecond')
    expect(resolveObjective(blocks, blocks, '  Custom objective.  ')).toBe('Custom objective.')
  })
})
