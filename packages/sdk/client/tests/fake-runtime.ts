#!/usr/bin/env node
/**
 * Scripted stand-in for Clocky SDK runtime, driven entirely by
 * env vars — no model, no network, no harness imports. Speaks the runtime's
 * newline-delimited JSON-RPC protocol on stdio: answers `initialize`,
 * Team product methods, activation placement methods, and `shutdown`.
 *
 * Script vocabulary (all optional):
 * - `FAKE_TEXT`: assistant text for each turn (default `hello from fake runtime`).
 * - `FAKE_REASON_KIND`: the coordinator `turn/end` reason kind (default `completed`).
 * - `FAKE_ECHO_CWD`: prefix the assistant text with the process cwd.
 * - `FAKE_ECHO_ENV`: comma-separated env names to echo as `name=value` lines in the assistant text.
 * - `FAKE_MALFORMED`: `initialize` returns `{}` (no serverInfo); `team/create` returns `{}`.
 * - `FAKE_MALFORMED_PROMPT`: `initialize` is normal; only `team/create` returns `{}`.
 * - `FAKE_INIT_ERROR`: `initialize` answers a JSON-RPC error response with code 7.
 * - `FAKE_INIT_ECHO_CREDENTIAL`: `initialize` reflects its credential in a scripted error (client redaction probe).
 * - `FAKE_INIT_ERROR_ONCE_FILE`: fail `initialize` (code 7) only when this
 *   marker file does NOT exist yet, creating it — so the first runtime
 *   process fails the handshake and a respawned one succeeds (retry probe).
 * - `FAKE_ECHO_CWD_IN_INIT`: reply `serverInfo.version` = this process's cwd
 *   (wire-visible spawn-cwd probe).
 * - `FAKE_MALFORMED_EVENT`: the turn's `session.event` carries a number as
 *   the event; `FAKE_MALFORMED_MESSAGE`: assistant/message content is not an
 *   array; `FAKE_MESSAGE_WITHOUT_DATA`: assistant/message with no data
 *   member; `FAKE_MALFORMED_REASON`: `session.finished` reason is a bare
 *   string (wire-validation probes).
 * - `FAKE_EMPTY_MESSAGE`: the turn streams a text chunk, then records an empty
 *   assistant/message for a usage-only max-tokens step.
 * - `FAKE_HANG_INIT`: never answer `initialize` (mid-handshake cancel probe).
 * - `FAKE_INIT_READY` + `FAKE_INIT_GO`: touch the READY file when `initialize`
 *   arrives, then poll for the GO file before answering (deterministic
 *   cancel-during-handshake window).
 * - `FAKE_HANG_PROMPT`: never answer `team/create` (for timeout/dispose tests).
 * - `FAKE_STREAM_THEN_MALFORMED`: stream a text chunk for Team creation, then
 *   answer `{}` — same-pipe ordering makes the chunk arrive
 *   before the protocol failure (partial-output retention probe).
 * - `FAKE_IGNORE_EOF` + `FAKE_SIGTERM_FILE`: keep running after stdin EOF; touch the file on SIGTERM (ladder probe).
 * - `FAKE_TRAP_SIGTERM`: with `FAKE_IGNORE_EOF`, survive SIGTERM too (SIGKILL-rung probe).
 * - `FAKE_EXIT_BEFORE_INIT`: exit 3 immediately (spawn-then-die probe).
 * - `FAKE_STDERR`: write this line to stderr at boot (diagnostics-tail probe).
 * - `FAKE_STDERR_NO_NEWLINE`: write this to stderr WITHOUT a newline (buffer-flush probe).
 * - `FAKE_RECORD_INIT`: append each `initialize` params JSON to this file (handshake probe).
 * - `FAKE_ACTIVATION_MALFORMED_OPEN_RESULT`: `activation/open` returns a malformed state.
 * - `FAKE_ACTIVATION_MALFORMED_NOTIFICATION`: activation methods emit a malformed status notification.
 * - `FAKE_ACTIVATION_MALFORMED_INTERRUPT_RESULT`: `activation/interrupt` returns a non-empty acknowledgement.
 * - `FAKE_ACTIVATION_MALFORMED_DISPOSE_RESULT`: `activation/dispose` returns a malformed state.
 */

import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { createInterface } from 'node:readline'

const env = process.env

if (env.FAKE_STDERR !== undefined) process.stderr.write(`${env.FAKE_STDERR}\n`)
if (env.FAKE_STDERR_NO_NEWLINE !== undefined) process.stderr.write(env.FAKE_STDERR_NO_NEWLINE)
if (env.FAKE_EXIT_BEFORE_INIT !== undefined) process.exit(3)

if (env.FAKE_IGNORE_EOF !== undefined) {
  // Simulate a runtime that never quiesces from EOF so the dispose ladder
  // must escalate; record which rung fired.
  process.stdin.resume()
  process.stdin.on('end', () => { setInterval(() => {}, 1_000) })
  process.on('SIGTERM', () => {
    if (env.FAKE_SIGTERM_FILE !== undefined) writeFileSync(env.FAKE_SIGTERM_FILE, 'sigterm\n')
    if (env.FAKE_TRAP_SIGTERM === undefined) process.exit(0)
  })
}

function write(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function notify(method: string, params: object): void {
  write({ jsonrpc: '2.0', method, params })
}

let seq = 0
function event(sessionId: string, type: string, data: object): void {
  notify('session.event', { sessionId, event: { type, seq: seq++, time: 0, data } })
}

function assistantText(): string {
  const parts: string[] = []
  if (env.FAKE_ECHO_CWD !== undefined) parts.push(`cwd=${process.cwd()}`)
  for (const name of (env.FAKE_ECHO_ENV ?? '').split(',').filter(entry => entry.length > 0)) {
    parts.push(`${name}=${env[name] ?? ''}`)
  }
  parts.push(env.FAKE_TEXT ?? 'hello from fake runtime')
  return parts.join('\n')
}

function runTurn(sessionId: string): void {
  const text = assistantText()
  if (env.FAKE_SESSION_EVENT_JSON !== undefined) {
    notify('session.event', { sessionId, event: JSON.parse(env.FAKE_SESSION_EVENT_JSON) as unknown })
    return
  }
  if (env.FAKE_MALFORMED_EVENT !== undefined) {
    notify('session.event', { sessionId, event: 42 })
    return
  }
  event(sessionId, 'turn/start', { turn: 0 })
  event(sessionId, 'assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text } })
  if (env.FAKE_MALFORMED_MESSAGE !== undefined) {
    event(sessionId, 'assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: 'fake-malformed-message',
        role: 'assistant',
        content: 'not-an-array',
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    })
    return
  }
  if (env.FAKE_MESSAGE_WITHOUT_DATA !== undefined) {
    notify('session.event', { sessionId, event: { type: 'assistant/message', seq: seq++, time: 0 } })
    return
  }
  event(sessionId, 'assistant/message', {
    turn: 0,
    step: 0,
    message: {
      id: `fake-assistant-${seq}`,
      role: 'assistant',
      // Model the usage-only message recorded after a max-tokens step that
      // assembled no output blocks.
      content: env.FAKE_EMPTY_MESSAGE !== undefined ? [] : [{ type: 'text', text }],
      source: { kind: 'model', provider: 'fake', model: 'fake' },
    },
  })
  const reasonKind = env.FAKE_REASON_KIND ?? 'completed'
  event(sessionId, 'turn/end', { turn: 0, reason: { kind: reasonKind } })
}

interface FakeTeam {
  readonly coordinatorSessionId: string
  readonly channelId: string
  readonly envelopeId: string
}

let teamSerial = 0
const teams = new Map<string, FakeTeam>()

interface FakeActivationState {
  activationId: string
  teamId: string
  participantId: string
  sessionId: string
  status: 'starting' | 'running' | 'idle' | 'stopping' | 'offline'
  statusSequence: number
}

const activations = new Map<string, FakeActivationState>()

function activationTargetOf(params: Record<string, unknown> | undefined): Omit<FakeActivationState, 'status' | 'statusSequence'> {
  const target = params?.target as Record<string, unknown> | undefined
  return {
    activationId: typeof target?.activationId === 'string' ? target.activationId : '',
    teamId: typeof target?.teamId === 'string' ? target.teamId : '',
    participantId: typeof target?.participantId === 'string' ? target.participantId : '',
    sessionId: typeof target?.sessionId === 'string' ? target.sessionId : '',
  }
}

function activationState(params: Record<string, unknown> | undefined): FakeActivationState {
  const target = activationTargetOf(params)
  const existing = activations.get(target.activationId)
  if (existing !== undefined) return existing
  const state: FakeActivationState = { ...target, status: 'idle', statusSequence: 0 }
  activations.set(state.activationId, state)
  return state
}

function notifyActivation(state: FakeActivationState): void {
  if (env.FAKE_ACTIVATION_MALFORMED_NOTIFICATION !== undefined) {
    notify('activation.status', { state: { activationId: state.activationId, status: 'unknown' } })
    return
  }
  notify('activation.status', { state })
}

const reader = createInterface({ input: process.stdin })
reader.on('line', (line) => {
  if (line.trim().length === 0) return
  const frame = JSON.parse(line) as { id?: string | number; method?: string; params?: Record<string, unknown> }
  if (frame.method === undefined || frame.id === undefined) return
  const respond = (result: object): void => { write({ jsonrpc: '2.0', id: frame.id, result }) }
  switch (frame.method) {
    case 'initialize':
      if (env.FAKE_RECORD_INIT !== undefined) appendFileSync(env.FAKE_RECORD_INIT, `${JSON.stringify(frame.params)}\n`)
      if (env.FAKE_HANG_INIT !== undefined) return
      if (env.FAKE_INIT_READY !== undefined && env.FAKE_INIT_GO !== undefined) {
        writeFileSync(env.FAKE_INIT_READY, 'ready\n')
        const go = env.FAKE_INIT_GO
        const id = frame.id
        const poll = setInterval(() => {
          if (!existsSync(go)) return
          clearInterval(poll)
          write({ jsonrpc: '2.0', id, result: { serverInfo: { name: 'clocky-sdk-runtime', version: '0.0.1' } } })
        }, 5)
        return
      }
      if (env.FAKE_INIT_ERROR !== undefined) {
        write({ jsonrpc: '2.0', id: frame.id, error: { code: 7, message: 'scripted init failure', data: { hint: 'fake' } } })
        return
      }
      if (env.FAKE_INIT_ECHO_CREDENTIAL !== undefined) {
        const credential = typeof frame.params?.credential === 'string' ? frame.params.credential : ''
        write({ jsonrpc: '2.0', id: frame.id, error: { code: 7, message: `credential=${credential}`, data: { credential } } })
        return
      }
      if (env.FAKE_INIT_ERROR_ONCE_FILE !== undefined && !existsSync(env.FAKE_INIT_ERROR_ONCE_FILE)) {
        writeFileSync(env.FAKE_INIT_ERROR_ONCE_FILE, 'failed-once\n')
        write({ jsonrpc: '2.0', id: frame.id, error: { code: 7, message: 'scripted first-boot failure' } })
        return
      }
      if (env.FAKE_MALFORMED !== undefined) {
        respond({})
        return
      }
      if (env.FAKE_ECHO_CWD_IN_INIT !== undefined) {
        respond({ serverInfo: { name: 'clocky-sdk-runtime', version: process.cwd() } })
        return
      }
      respond({ serverInfo: { name: 'clocky-sdk-runtime', version: '0.0.1' } })
      return
    case 'team/create': {
      const teamId = `fake-team-${++teamSerial}`
      const coordinatorSessionId = `${teamId}-coordinator`
      const team: FakeTeam = {
        coordinatorSessionId,
        channelId: `${teamId}-channel`,
        envelopeId: `${teamId}-input`,
      }
      event(coordinatorSessionId, 'agent/inbox/spliced', {
        target: 'next-turn',
        start: 0,
        inserted: [{
          id: team.envelopeId,
          role: 'user',
          content: [],
          source: { kind: 'user' },
        }],
      })
      notify('session.status', { sessionId: coordinatorSessionId, status: 'running' })
      if (env.FAKE_STREAM_THEN_MALFORMED !== undefined) {
        event(coordinatorSessionId, 'assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'streamed then cut short' } })
        respond({})
        return
      }
      if (env.FAKE_HANG_PROMPT !== undefined) return
      if (env.FAKE_MALFORMED !== undefined || env.FAKE_MALFORMED_PROMPT !== undefined) {
        respond({})
        return
      }
      teams.set(teamId, team)
      runTurn(coordinatorSessionId)
      notify('session.status', { sessionId: coordinatorSessionId, status: 'idle' })
      respond({ teamId, coordinatorSessionId, envelopeId: team.envelopeId })
      return
    }
    case 'team/wait-final': {
      const teamId = typeof frame.params?.teamId === 'string' ? frame.params.teamId : ''
      const team = teams.get(teamId)
      if (team === undefined) {
        write({ jsonrpc: '2.0', id: frame.id, error: { code: -32_002, message: `unknown team: ${teamId}` } })
        return
      }
      respond({ teamId, channelId: team.channelId, envelopeId: `${teamId}-final`, text: assistantText() })
      return
    }
    case 'team/inbox-read':
    case 'team/inbox-watch':
      respond({ items: [], displayCursor: 4, cursor: 6 })
      return
    case 'team/inbox-acknowledge':
      respond({ displayCursor: frame.params?.throughCursor })
      return
    case 'team/channel-input': {
      const source = frame.params?.content
      const content = Array.isArray(source) ? source.map((part: unknown) => {
        const value = part as Record<string, unknown>
        return value.type === 'text' ? value : { type: 'image', attachment: {
          attachmentId: 'fixture-image', mediaType: 'image/png', bytes: 3, width: 1, height: 1,
        } }
      }) : []
      respond({ value: { id: 'media-envelope', teamId: 'team-1', channelId: frame.params?.channelId, sequence: 3, senderId: 'human',
        audience: frame.params?.audience, kind: 'message', payload: { content }, delivery: frame.params?.delivery, priority: 'normal', createdAt: 1 } })
      return
    }
    case 'team/channel-attachment':
      respond({ attachment: { attachmentId: frame.params?.attachmentId, mediaType: 'image/png', bytes: 3, width: 1, height: 1 }, data: 'cGl4' })
      return
    case 'team/channel-catalog':
      respond({ adapters: [{ type: 'consult', version: 1 }], viewPolicies: [{ type: 'summarized-window', version: 1 }],
        summary: { allowedPolicies: ['summarized-window'], maxSourceEnvelopes: 8, maxSourceBytes: 65536, maxSummaryBytes: 1024, maxHistorySpan: 32 } })
      return
    case 'team/channel-summarize':
      respond({ value: { type: 'channel/summary', sequence: 9, createdAt: 2,
        coveredSequenceRange: frame.params?.coveredSequenceRange, sourceFingerprint: `sha256:${'0'.repeat(64)}`,
        sourceEnvelopeIds: ['summary-source'], text: 'Saved summary.', policy: { type: 'summarized-window', version: 1 },
        idempotencyKey: frame.params?.idempotencyKey } })
      return
    case 'team/channel-list': {
      const start = Number(frame.params?.afterCursor ?? -1) + 1
      const limit = Math.min(Number(frame.params?.limit ?? 2), 2)
      const all = Array.from({ length: 3 }, (_, index) => ({ manifest: { id: `listed-${index}`, teamId: frame.params?.teamId,
        adapter: { type: 'direct', version: 4 }, participants: [], limits: {} }, phase: 'pending', cursor: 0 }))
      respond({ items: all.slice(start, start + limit), ...start + limit < all.length ? { nextCursor: start + limit - 1 } : {} })
      return
    }
    case 'team/channel-admission':
      respond({ value: {
        expectedNext: { kind: 'none' }, protocolStatus: { kind: 'other' },
        channel: { manifest: { id: frame.params?.channelId, teamId: frame.params?.teamId, adapter: { type: 'direct', version: 4 },
          participants: [{ id: 'endpoint-1', role: 'human' }], limits: {} }, phase: 'pending', cursor: 0 },
        invitations: [{ participantId: 'endpoint-1', role: 'human', visibility: 'channel', required: true, deadline: 9,
          endpoint: { kind: 'human' }, revision: 1, manifestFingerprint: `sha256:${'0'.repeat(64)}`, status: 'pending' }],
      } })
      return
    case 'team/artifact-read':
      respond({
        artifact: { id: 'artifact-1', provider: 'local', kind: 'report', uri: 'artifact://report', visibility: 'team' },
        bytes: 4,
        data: 'dGVzdA==',
      })
      return
    case 'team/cancel': {
      const teamId = typeof frame.params?.teamId === 'string' ? frame.params.teamId : ''
      teams.delete(teamId)
      respond({ phase: 'cancelled' })
      return
    }
    case 'team/archive': {
      const teamId = typeof frame.params?.teamId === 'string' ? frame.params.teamId : ''
      respond({ teamId, archivedAt: 7 })
      return
    }
    case 'activation/open': {
      const state = activationState(frame.params)
      notifyActivation(state)
      if (env.FAKE_ACTIVATION_MALFORMED_OPEN_RESULT !== undefined) {
        respond({ state: { activationId: state.activationId } })
        return
      }
      respond({ state })
      return
    }
    case 'activation/link-enroll': {
      if (env.FAKE_ACTIVATION_MALFORMED_LINK_ENROLL_RESULT !== undefined) {
        respond({ unexpected: true })
        return
      }
      respond({})
      return
    }
    case 'activation/status': {
      const state = activationState(frame.params)
      respond({ state })
      return
    }
    case 'activation/interrupt': {
      const state = activationState(frame.params)
      const next: FakeActivationState = { ...state, status: 'running', statusSequence: state.statusSequence + 1 }
      activations.set(next.activationId, next)
      notifyActivation(next)
      if (env.FAKE_ACTIVATION_MALFORMED_INTERRUPT_RESULT !== undefined) {
        respond({ unexpected: true })
        return
      }
      respond({})
      return
    }
    case 'activation/dispose': {
      const state = activationState(frame.params)
      const next: FakeActivationState = { ...state, status: 'offline', statusSequence: state.statusSequence + 1 }
      activations.set(next.activationId, next)
      notifyActivation(next)
      if (env.FAKE_ACTIVATION_MALFORMED_DISPOSE_RESULT !== undefined) {
        respond({ state: { activationId: next.activationId } })
        return
      }
      respond({ state: next })
      return
    }
    case 'shutdown':
      respond({})
      // An EOF-ignoring fake also refuses the protocol exit, so the client's
      // dispose ladder (not this cooperative path) must reap it.
      if (env.FAKE_IGNORE_EOF === undefined) setImmediate(() => process.exit(0))
      return
    default:
      write({ jsonrpc: '2.0', id: frame.id, error: { code: -32603, message: `unknown method: ${frame.method}` } })
  }
})
