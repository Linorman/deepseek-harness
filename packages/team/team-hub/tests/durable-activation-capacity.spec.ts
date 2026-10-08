/** Stored startup capacity must agree with participant identities and published epochs. */
import { describe, expect, it } from 'vitest'
import { liveActivationCapacity } from '@clocky/clocky-team'
import { teamProjectionFromData } from '../src/fold.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, fenceTestActivation, participant, participantChanged, quiesceTestActivation,
  task, taskChanged, taskLease, taskCreatorActivationId, taskCreatorId,
  taskCreatorSessionId, teamId, teamPhase } from './fixtures.ts'

function fixture() {
  const member = participant({ id: taskCreatorId, role: 'coordinator', phase: 'active' })
  const reservation = { id: 'startup-capacity', provider: 'in-process', sessionId: taskCreatorSessionId, reservedAt: 15 }
  const prefix = [createdTeam({ budgets: { maxLiveActivations: 1 } }), teamPhase(),
    ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
      participantChanged({ participant: { ...member, phase }, createdAt: 12 + index })),
    participantChanged({ participant: { ...member, activationReservation: reservation }, createdAt: 15 }),
  ]
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process', reservationId: reservation.id }
  return { member, reservation, prefix, binding,
    bound: [...prefix, { type: 'activation/changed', binding, createdAt: 16 }] }
}

describe('durable startup capacity', () => {
  it('rejects checkpoint loss of admission identity and tighter ceilings than occupied capacity', () => {
    const f = fixture()
    const valid = checkpointFor(f.bound)
    expect(() => teamProjectionFromData(valid)).not.toThrow()
    expect(() => teamProjectionFromData({ ...valid, tasks: [task()] })).not.toThrow()
    expect(() => teamProjectionFromData({ ...valid, participants: [f.member] })).toThrow(/startup identity/)
    expect(() => teamProjectionFromData({ ...valid, budgets: { maxLiveActivations: 0 } })).toThrow(/exceed/)
  })

  it.each(['json', 'sqlite'] as const)('restores reservations once, and rejects binding or release without exact ownership (%s)', async (backend) => {
    const f = fixture()
    const ctx = await recover(backend, f.bound)
    const state = await ctx.teams.getTeam({ teamId })
    expect(liveActivationCapacity(state.participants, state.activations, state.tasks)).toBe(1)
    for (const reservationId of [undefined, 'foreign-startup']) {
      const binding = { ...f.binding, reservationId }
      const invalid = await recover(backend, [...f.prefix, { type: 'activation/changed', binding, createdAt: 16 }])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
    }
    const released = await recover(backend, [...f.bound, participantChanged({
      participant: { ...f.member, activationReservation: { ...f.reservation, releasedAt: 17 } }, createdAt: 17,
    })])
    await expect(released.teams.getTeam({ teamId })).rejects.toThrow(/Bound startup/)
  })

  it.each(['json', 'sqlite'] as const)('rejects two Participants sharing one startup identity (%s)', async (backend) => {
    const f = fixture()
    const member = participant({ id: 'second-capacity-worker' })
    const rows = [createdTeam({ budgets: { maxLiveActivations: 2 } }), ...f.prefix.slice(1),
      ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
        participantChanged({ participant: { ...member, phase }, createdAt: 16 + index })),
      participantChanged({ participant: { ...member, phase: 'active',
        activationReservation: { ...f.reservation, reservedAt: 19 } }, createdAt: 19 }),
    ]
    const invalid = await recover(backend, rows)
    await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow(/share one startup/)
  })
})

it('requires zero-capacity members to retain only released or quiesced startup responsibility', () => {
  const f = fixture()
  const grant = { operations: ['activate'] as const, workspaceModes: ['shared'] as const,
    readScopes: [], writeScopes: [], budgets: { maxLiveActivations: 0 } }
  const bounded = participant({ ...f.member, authorityGrant: grant, activationReservation: f.reservation })
  const data = checkpointFor(f.bound)
  expect(() => teamProjectionFromData({ ...data, participants: [bounded] })).toThrow('zero live authority retains startup capacity')
  const quiesced = { ...data.activations[0]!, activation: { ...data.activations[0]!.activation, status: 'offline' as const },
    quiescedAt: 16, quiescenceSource: 'quiesced' as const, quiescedWakeChannelIds: [] }
  expect(() => teamProjectionFromData({ ...data, participants: [bounded], activations: [quiesced] })).not.toThrow()
  const unbound = checkpointFor(f.prefix)
  expect(() => teamProjectionFromData({ ...unbound,
    participants: [participant({ ...bounded, activationReservation: { ...f.reservation, releasedAt: 15 } })] })).not.toThrow()
})

it('rejects membership changes during cancellation unless they release unpublished startup responsibility', () => {
  const f = fixture()
  const data = checkpointFor(f.bound)
  const cancellation = { type: 'team/cancellation', createdAt: 17, cancellation: { teamId, idempotencyKey: 'cancel',
    actor: { kind: 'system', name: 'owner' }, reason: { code: 'cancelled', message: 'Cancellation requested' }, requestedAt: 17 } }
  expect(() => checkpointFor([...f.bound, cancellation,
    participantChanged({ participant: { ...data.participants[0], phase: 'left' }, createdAt: 18 })]))
    .toThrow('Closure participant mutation is not an unpublished-start release')
})

it.each(['json', 'sqlite'] as const)('refuses to publish %s quiescence while an owned workspace remains live', async (backend) => {
  const f = fixture()
  const initial = task({ createdAt: 17 })
  const lease = taskLease({ participantId: taskCreatorId, activationId: taskCreatorActivationId,
    assignedAt: 18, renewedAt: 18, durationMs: 60000, expiresAt: 60018 })
  const assigned = task({ ...initial, phase: 'assigned', revision: 2, attemptCount: 1, lease })
  const running = task({ ...assigned, phase: 'running', revision: 3, lease: { ...lease, startedAt: 19 } })
  const allocation = { id: 'quiescence-capacity-allocation', revision: 1, teamId, taskId: initial.id,
    attemptId: lease.attemptId, assignedRevision: lease.assignedRevision, participantId: taskCreatorId,
    activationId: taskCreatorActivationId, sessionId: taskCreatorSessionId, provider: 'workspace-local',
    mode: 'shared', baseVersion: 'base-a', lifecycle: 'reserved', reservedAt: 20, updatedAt: 20 }
  const records = [...f.bound, taskChanged({ task: initial, createdAt: 17 }),
    taskChanged({ task: assigned, createdAt: 18 }), taskChanged({ task: running, createdAt: 19 }),
    { type: 'workspace-allocation/changed', allocation, createdAt: 20 }]
  const ctx = await recover(backend, records)
  const before = await ctx.teams.getTeam({ teamId })
  const input = { teamId, activationId: taskCreatorActivationId, participantId: taskCreatorId,
    sessionId: taskCreatorSessionId, provider: 'in-process', expectedCursor: before.team.cursor }
  await expect(quiesceTestActivation(ctx, input)).rejects.toMatchObject({ code: 'TEAM_NOT_QUIESCENT' })
  await expect(fenceTestActivation(ctx, input)).rejects.toMatchObject({ code: 'TEAM_NOT_QUIESCENT' })
  const after = await ctx.teams.getTeam({ teamId })
  expect(after.team.cursor).toBe(before.team.cursor)
  expect(after.workspaceAllocations).toEqual(before.workspaceAllocations)
  expect(after.tasks).toEqual(before.tasks)
})

it.each([['json', 'stopping', 'reserved'], ['json', 'offline', 'reserved'],
  ['sqlite', 'stopping', 'reserved'], ['sqlite', 'offline', 'reserved'],
  ['json', 'stopping', 'release-requested'], ['sqlite', 'stopping', 'release-requested']] as const)
('keeps a repeated %s recovery fence idempotent from %s with %s workspace', async (backend, status, stage) => {
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const recovery = { kind: 'sdk-local-cold-replace', version: 1, runtimeProvider: 'sdk', profile: 'local-sdk-v1',
    agent: { provider: 'mock', model: 'mock', maxTokens: 32 },
    process: { hostId: 'host-a', pid: 42, started: 'start-a', processGroupId: 42 } }
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'sdk', recovery }
  const initial = task({ createdAt: 16 })
  const created = task({ ...initial, createCommand: { ...initial.createCommand, creator: {
    teamId, participantId: taskCreatorId, activationId: taskCreatorActivationId, sessionId: taskCreatorSessionId, provider: 'sdk',
  } } })
  const lease = taskLease({ participantId: taskCreatorId, activationId: taskCreatorActivationId,
    assignedAt: 17, renewedAt: 17, durationMs: 60000, expiresAt: 60017 })
  const assigned = task({ ...created, phase: 'assigned', revision: 2, attemptCount: 1, lease })
  const running = task({ ...assigned, phase: 'running', revision: 3, lease: { ...lease, startedAt: 18 } })
  const allocation = { id: 'recovery-fence-allocation', revision: 1, teamId, taskId: created.id,
    attemptId: lease.attemptId, assignedRevision: lease.assignedRevision, participantId: taskCreatorId,
    activationId: taskCreatorActivationId, sessionId: taskCreatorSessionId, provider: 'workspace-local',
    mode: 'shared', baseVersion: 'base-a', lifecycle: 'reserved', reservedAt: 19, updatedAt: 19 }
  const intentAt = stage === 'release-requested' ? 21 : 20
  const intent = { teamId, actor: { kind: 'system', name: 'team-run' },
    reason: { code: 'STOP', message: 'Stop the Team before release.' },
    idempotencyKey: 'recovery-fence-capacity', requestedAt: intentAt }
  const activeRows = [createdTeam(), teamPhase(),
    participantChanged({ participant: member, createdAt: 12 }),
    participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 }),
    { type: 'activation/changed', binding, createdAt: 15 },
    taskChanged({ task: created, createdAt: 16 }), taskChanged({ task: assigned, createdAt: 17 }),
    taskChanged({ task: running, createdAt: 18 }),
    { type: 'workspace-allocation/changed', allocation, createdAt: 19 }]
  const releasedBeforeFence = { ...allocation, revision: 2, lifecycle: 'release-requested', releaseRequestedAt: 20, updatedAt: 20 }
  const rows = [...activeRows,
    ...(stage === 'release-requested' ? [{ type: 'workspace-allocation/changed', allocation: releasedBeforeFence, createdAt: 20 }] : []),
    { type: 'team/cancellation', cancellation: intent, createdAt: intentAt },
    { type: 'team/phase', phase: 'quiescing', createdAt: intentAt + 1 },
    { type: 'activation/changed', binding: { ...binding,
      activation: { ...binding.activation, status } }, createdAt: intentAt + 2 }]
  const withoutIntent = await recover(backend, activeRows)
  const active = await withoutIntent.teams.getTeam({ teamId })
  await expect(fenceTestActivation(withoutIntent, { teamId, activationId: taskCreatorActivationId,
    participantId: taskCreatorId, sessionId: taskCreatorSessionId, provider: 'sdk',
    expectedCursor: active.team.cursor })).rejects.toMatchObject({ code: 'TEAM_NOT_QUIESCENT' })
  expect((await withoutIntent.teams.getTeam({ teamId })).team.cursor).toBe(active.team.cursor)
  const ctx = await recover(backend, rows)
  const before = await ctx.teams.getTeam({ teamId })
  const input = { teamId, activationId: taskCreatorActivationId, participantId: taskCreatorId,
    sessionId: taskCreatorSessionId, provider: 'sdk', expectedCursor: before.team.cursor }
  const first = await fenceTestActivation(ctx, input)
  expect(first.workspaceAllocations[0]).toMatchObject({ lifecycle: 'release-requested', revision: 2 })
  expect(first.activations[0]).toMatchObject({ activation: { status }, fencedAt: first.team.updatedAt })
  const repeated = await fenceTestActivation(ctx, { ...input, expectedCursor: first.team.cursor })
  expect(repeated.team.cursor).toBe(first.team.cursor)
  expect(repeated.workspaceAllocations).toEqual(first.workspaceAllocations)
  expect(repeated.activations).toEqual(first.activations)
})
