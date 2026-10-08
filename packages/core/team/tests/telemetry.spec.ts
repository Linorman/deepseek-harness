import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { CallId, createMessage, createToolResultMessage, createUserMessage } from '@clocky/clocky-llm'
import type { JsonObject } from '../src/types.ts'
import type {} from '@clocky/clocky-agent'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import { channelIdSchema, channelClosedRecordSchema, teamEnvelopeSchema, teamSnapshotSchema } from '../src/schema.ts'
import {
  TeamTelemetryCoordinator,
  TeamTelemetryBackend,
  type TeamTelemetryRecord,
  type TeamTelemetrySink,
} from '../src/telemetry.ts'

declare module '@clocky/clocky-session/types' {
  interface SessionEventMap {
    /** Opaque plugin payload used to exercise telemetry's bounded correlation walk. */
    'test/team-telemetry': JsonObject
  }
}

class FakeTelemetrySink implements TeamTelemetrySink {
  readonly records: TeamTelemetryRecord[] = []
  readonly flush = vi.fn()
  readonly shutdown = vi.fn(async () => {})
  throwOnEmit = false

  emit(record: TeamTelemetryRecord): void {
    if (this.throwOnEmit) throw new Error('sink rejected record')
    this.records.push(record)
  }
}

function team(): ReturnType<typeof teamSnapshotSchema.parse> {
  return teamSnapshotSchema.parse({
    id: 'team-1', depth: 0, maxTeamDepth: 2,
    goal: { teamId: 'team-1', revision: 1, objective: 'observe', phase: 'active', budgets: {} },
    phase: 'active', cursor: 3, createdAt: 1, updatedAt: 3,
  })
}

describe('TeamTelemetryCoordinator', () => {
  it('correlates Team, channel, and model records without changing source payloads', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const sink = new FakeTelemetrySink()
    const coordinator = new TeamTelemetryCoordinator(ctx, sink)
    const sourceTeam = team()

    ctx.emit('team/changed', { type: 'team/created', team: sourceTeam })
    ctx.emit('channel/changed', {
      channelId: channelIdSchema.parse('channel-1'),
      record: { type: 'channel/phase', sequence: 4, createdAt: 4, phase: 'active' } as never,
    })
    const session = ctx.sessions.create(SessionId('session-1'), {
      meta: {
        cwd: '/tmp/team',
        teamId: 'team-1',
        participantId: 'participant-1',
      },
    })
    session.append('turn/start', { turn: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    session.append('session/end-seed', {})

    expect(sink.records.map(record => record.channel)).toEqual(['team', 'channel', 'session', 'session', 'session'])
    expect(sink.records[0]?.attributes).toMatchObject({
      'event.type': 'team/created', 'team.id': 'team-1', 'source.cursor': 3,
    })
    expect(sink.records[1]?.attributes).toMatchObject({
      'event.type': 'channel/phase', 'channel.id': 'channel-1', 'source.cursor': 4,
    })
    expect(sink.records[2]?.attributes).toMatchObject({
      'event.type': 'turn/start', 'session.id': 'session-1', 'team.id': 'team-1', 'span.kind': 'lifecycle',
    })
    expect(sink.records[3]?.attributes).toMatchObject({
      'event.type': 'assistant/message', 'participant.id': 'participant-1',
      'model.provider': 'mock', 'model.name': 'mock', 'span.kind': 'model',
    })
    expect(sink.records[3]?.body).toEqual(session.events[1]?.data)
    expect(sink.records[4]?.attributes['span.kind']).toBe('lifecycle')
    await ctx.fiber.dispose()
    expect(sink.shutdown).toHaveBeenCalledOnce()
    void coordinator
  })

  it('contains sink and redaction failures per record and forwards flush hints', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const sink = new FakeTelemetrySink()
    sink.throwOnEmit = true
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    new TeamTelemetryCoordinator(ctx, sink)
    ctx.on('team-telemetry/record', (_record, next) => {
      throw new Error('redaction failed')
      return next()
    })
    ctx.emit('team/changed', { type: 'team/created', team: team() })
    const session = ctx.sessions.create(SessionId('flush-session'), { meta: {} })
    await ctx.parallel('session/flush', session)
    expect(sink.records).toHaveLength(0)
    expect(sink.flush).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})

it('hands detached source facts to a real backend service and drains its lifetime through the coordinator', async () => {
  class Backend extends TeamTelemetryBackend {
    constructor(ctx: Context, private readonly sink: FakeTelemetrySink) { super(ctx) }
    emit(record: TeamTelemetryRecord): void { this.sink.emit(record) }
    async shutdown(): Promise<void> { await this.sink.shutdown() }
  }
  const ctx = new Context()
  const sink = new FakeTelemetrySink()
  const backend = new Backend(ctx, sink)
  new TeamTelemetryCoordinator(ctx, backend)
  const source = { type: 'team/created' as const, team: team() }
  ctx.emit('team/changed', source)
  expect(sink.records[0]?.body).toEqual(source)
  expect(sink.records[0]?.body).not.toBe(source)
  await ctx.fiber.dispose()
  expect(sink.shutdown).toHaveBeenCalledOnce()
})


it.each(['closed', 'expired', 'failed'] as const)('exports the authoritative closed channel phase %s as its severity', async (phase) => {
  const ctx = new Context()
  const sink = new FakeTelemetrySink()
  new TeamTelemetryCoordinator(ctx, sink)
  try {
    const record = channelClosedRecordSchema.parse({ type: 'channel/closed', sequence: 5, createdAt: 7,
      phase, reason: 'Provider channel outcome' })
    ctx.emit('channel/changed', { channelId: channelIdSchema.parse('closed'), record })
    expect(sink.records).toHaveLength(1)
    expect(sink.records[0]).toMatchObject({ severity: phase === 'failed' ? 'error' : 'info',
      attributes: { 'source.cursor': 5 }, body: record })
  } finally { await ctx.fiber.dispose() }
})


it('correlates bounded opaque plugin facts without interpreting arrays, scalars or deeply nested identities', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const sink = new FakeTelemetrySink()
  new TeamTelemetryCoordinator(ctx, sink)
  try {
    const session = ctx.sessions.create(SessionId('correlation-session'), { meta: { agentPreset: 'fixture' } })
    const payload = { id: 'unscoped', traceId: 7, source: null, message: [{ teamId: 'array-not-walked' }], binding: 'scalar',
      team: { id: 'team', participant: { id: 'participant', activation: { id: 'activation', channel: { id: 'too-deep' } } } },
      channel: { id: 'channel' }, envelope: { id: 'envelope' }, task: { id: 'task' }, attempt: { id: 'attempt' } }
    session.append('test/team-telemetry', payload)
    expect(sink.records.at(-1)?.attributes).toMatchObject({ 'session.id': 'correlation-session', 'agent.preset': 'fixture',
      'team.id': 'team', 'participant.id': 'participant', 'activation.id': 'activation', 'channel.id': 'channel',
      'envelope.id': 'envelope', 'task.id': 'task', 'attempt.id': 'attempt', 'trace.id': 7, 'span.kind': 'lifecycle' })
    expect(sink.records.at(-1)?.body).toEqual(payload)
    expect(Object.values(sink.records.at(-1)!.attributes)).not.toContain('too-deep')
    expect(Object.values(sink.records.at(-1)!.attributes)).not.toContain('array-not-walked')
  } finally { await ctx.fiber.dispose() }
})

it('exports real tool/input/failed-turn Session events with explicit span kinds and failure severity', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const sink = new FakeTelemetrySink()
  new TeamTelemetryCoordinator(ctx, sink)
  try {
    const session = ctx.sessions.create(SessionId('severity-session'), { meta: { cwd: process.cwd(), agentPreset: 'fixture' } })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Input' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' })
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [] })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('call'), name: 'fixture', arguments: '{}' })
    session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: CallId('call'),
      content: [{ type: 'text', text: 'Refused' }], isError: true }) }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'Failed turn' } } })
    expect(sink.records.map(record => [record.attributes['span.kind'], record.severity]))
      .toEqual([['input', 'info'], ['input', 'info'], ['tool', 'info'], ['tool', 'error'], ['lifecycle', 'error']])
  } finally { await ctx.fiber.dispose() }
})

it('exports policy refusal as warning and the actual Envelope WAL cursor and timestamp', async () => {
  const ctx = new Context()
  const sink = new FakeTelemetrySink()
  new TeamTelemetryCoordinator(ctx, sink)
  try {
    const owner = team()
    ctx.emit('team/changed', { type: 'policy/denied', teamId: owner.id, hook: 'task-assign', code: 'REFUSED',
      message: 'Not allowed', cursor: 4, createdAt: 5 })
    expect(sink.records.at(-1)).toMatchObject({ severity: 'warn', time: 5, attributes: { 'source.cursor': 4 } })
    ctx.emit('channel/changed', { channelId: channelIdSchema.parse('channel'), record: { type: 'channel/envelope', envelope: teamEnvelopeSchema.parse({
      id: 'envelope', teamId: owner.id, channelId: 'channel', senderId: 'sender', kind: 'message', audience: null,
      payload: {}, delivery: 'turn', priority: 'normal', sequence: 8, createdAt: 9,
    }), deliveryIntents: [] } })
    expect(sink.records.at(-1)).toMatchObject({ severity: 'info', time: 9,
      attributes: { 'source.cursor': 8, 'envelope.id': 'envelope' } })
  } finally { await ctx.fiber.dispose() }
})

it('contains unrenderable backend capture and shutdown failures without interrupting source events', async () => {
  const ctx = new Context()
  const sink = new FakeTelemetrySink()
  const failure = { [Symbol.toPrimitive]() { throw new Error('Not renderable') } }
  sink.emit = () => { throw failure }
  sink.shutdown.mockRejectedValue(failure)
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  new TeamTelemetryCoordinator(ctx, sink)
  expect(() => { ctx.emit('team/changed', { type: 'team/created', team: team() }) }).not.toThrow()
  await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
  expect(warn).toHaveBeenCalledWith('team telemetry: capture failed: [unrenderable thrown value]')
  expect(warn).toHaveBeenCalledWith('team telemetry: backend shutdown failed: [unrenderable thrown value]')
})
