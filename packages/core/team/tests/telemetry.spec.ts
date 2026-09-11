import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createMessage } from '@clocky/clocky-llm'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import { channelIdSchema, teamSnapshotSchema } from '../src/schema.ts'
import {
  TeamTelemetryCoordinator,
  type TeamTelemetryRecord,
  type TeamTelemetrySink,
} from '../src/telemetry.ts'

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
