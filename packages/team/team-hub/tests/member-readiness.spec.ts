/** Readiness pages retain authorization, complete byte limits and requested order on both stores. */
import { expect, it } from 'vitest'
import type { Context } from '@clocky/cordis'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema, teamMemberReadinessPageSchema } from '@clocky/clocky-team'
import type { TeamHumanActorProof, TeamHumanActorScope, TeamMemberReadinessInput } from '@clocky/clocky-team'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, teamId, teamPhase, task, taskChanged, taskLease, taskCreatorId, taskCreatorActivationId, taskCreatorSessionId } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('reads a finite member selection without journal changes (%s)', async (backend) => {
  const human = participant({ id: 'human-reader', kind: 'human', owner: { kind: 'product-principal', principalId: 'reader' } })
  const members = Array.from({ length: 7 }, (_, index) => participant({ id: `service-${index}`, kind: 'service' }))
  const records = [createdTeam(), teamPhase(), ...[human, ...members].flatMap((member, memberIndex) =>
    (['invited', 'provisioning', 'active'] as const).map((phase, index) => participantChanged({
      participant: { ...member, phase }, createdAt: 12 + memberIndex * 3 + index,
    })))]
  const ctx = await recover(backend, records, undefined, teamId, [], records.length - 1, [],
    { recoveryPageSize: 2, maxSelectionBytes: 900 })
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  ctx.teams.registerHumanActorProofSource({ name: 'readiness-test', resolveHumanActorProof: proof => scopes.get(proof) })
  const read = async (input: TeamMemberReadinessInput) => {
    const actor = Object.freeze({}) as TeamHumanActorProof
    const bound = { teamId, operation: 'member-readiness-read' as const, fence: { kind: 'read' as const }, payload: jsonObjectSchema.parse(input) }
    scopes.set(actor, { teamId, participantId: human.id, operation: bound.operation, fence: bound.fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
    try { return await ctx.teams.getMemberReadiness({ ...input, actor }) }
    finally { scopes.delete(actor) }
  }
  const before = await ctx.teams.getTeam({ teamId })
  const ids = members.map(member => member.id)
  const received: string[] = []
  let afterCursor = 0
  let pages = 0
  while (received.length < ids.length) {
    const page = await read({ teamId, participantIds: ids, afterCursor, expectedTeamCursor: before.team.cursor })
    expect(teamMemberReadinessPageSchema.parse(page)).toEqual(page)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(900)
    expect(page.items.length).toBeLessThanOrEqual(2)
    expect(page.items.every(item => item.state === 'not-applicable' && item.reasons.includes('service-managed'))).toBe(true)
    received.push(...page.items.map(item => item.participantId))
    pages++
    if (page.nextCursor === undefined) break
    expect(page.nextCursor).toBeGreaterThan(afterCursor)
    afterCursor = page.nextCursor
  }
  expect(received).toEqual(ids)
  expect(pages).toBe(4)
  expect(await ctx.teams.getTeam({ teamId })).toEqual(before)
  await expect(read({ teamId, participantIds: ids, expectedTeamCursor: before.team.cursor - 1 }))
    .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
  await expect(read({ teamId, participantIds: [human.id, human.id] })).rejects.toThrow()
  await expect(ctx.teams.getMemberReadiness({ teamId, participantIds: ids, actor: {} as never }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  await expect(read({ teamId, participantIds: Array.from({ length: 100 }, (_, index) => `unread-${index}` as never) }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
})


function scopedReader(ctx: Context, human: ReturnType<typeof participant>) {
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  const stop = ctx.teams.registerHumanActorProofSource({ name: 'readiness-focused', resolveHumanActorProof: proof => scopes.get(proof) })
  return { stop, async read(input: TeamMemberReadinessInput) {
    const actor = Object.freeze({}) as TeamHumanActorProof
    const bound = { teamId, operation: 'member-readiness-read' as const, fence: { kind: 'read' as const }, payload: jsonObjectSchema.parse(input) }
    scopes.set(actor, { teamId, participantId: human.id, operation: bound.operation, fence: bound.fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
    try { return await ctx.teams.getMemberReadiness({ ...input, actor }) }
    finally { scopes.delete(actor) }
  } }
}

function readyMembers() {
  const human = participant({ id: 'readiness-reader', kind: 'human', owner: { kind: 'product-principal', principalId: 'reader' } })
  const worker = participant({ id: taskCreatorId, kind: 'local-agent', role: 'coordinator', provider: 'in-process', preset: 'worker', model: 'mock/model' })
  const records = [createdTeam(), teamPhase(), ...[human, worker].flatMap((member, memberIndex) =>
    (['invited', 'provisioning', 'active'] as const).map((phase, offset) => participantChanged({ participant: { ...member, phase },
      createdAt: 12 + memberIndex * 3 + offset })))]
  return { human, worker, records }
}

it('refuses an identity absent from its exact selected Team', async () => {
  const f = readyMembers()
  const ctx = await recover('json', f.records)
  const reader = scopedReader(ctx, f.human)
  await expect(reader.read({ teamId, participantIds: ['missing-member' as never] })).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
})

it('revalidates the current human proof after provider observation yields', async () => {
  const f = readyMembers()
  const ctx = await recover('json', f.records)
  const reader = scopedReader(ctx, f.human)
  ctx.on('team/member-execution-observe', async (_request, next) => { reader.stop(); return await next() })
  await expect(reader.read({ teamId, participantIds: [f.worker.id] })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})

it('refuses a complete readiness row and empty metadata header that exceed their own response bounds', async () => {
  const f = readyMembers()
  const row = await recover('json', f.records, undefined, teamId, [], f.records.length - 1, [], { maxSelectionBytes: 256 })
  const reader = scopedReader(row, f.human)
  row.on('team/member-execution-observe', async () => ({ route: { kind: 'configured', provider: 'in-process',
    configuration: 'configuration-path-'.repeat(100), reasons: [] } }))
  await expect(reader.read({ teamId, participantIds: [f.worker.id] })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
  const metadata = await recover('json', f.records, undefined, teamId, [], f.records.length - 1, [], { maxSelectionBytes: 100 })
  await expect(scopedReader(metadata, f.human).read({ teamId, participantIds: [] })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
})

it('counts active owned attempts as busy without exposing execution or configuration bodies', async () => {
  const f = readyMembers()
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' as const },
    sessionId: taskCreatorSessionId, provider: 'in-process' }
  const initial = task({ createdAt: 19 })
  const lease = taskLease({ participantId: taskCreatorId, activationId: taskCreatorActivationId,
    assignedAt: 20, renewedAt: 20, expiresAt: 10020, durationMs: 10000 })
  const assigned = task({ ...initial, revision: 2, phase: 'assigned', lease, attemptCount: 1 })
  const running = task({ ...assigned, revision: 3, phase: 'running', lease: { ...lease, startedAt: 21 } })
  const second = task({ id: 'readiness-assigned', createdAt: 22 })
  const secondLease = taskLease({ participantId: taskCreatorId, activationId: taskCreatorActivationId,
    attemptId: 'readiness-assigned-attempt', assignedAt: 23, renewedAt: 23, expiresAt: 10023, durationMs: 10000 })
  const secondAssigned = task({ ...second, revision: 2, phase: 'assigned', attemptCount: 1, lease: secondLease })
  const records = [...f.records, { type: 'activation/changed', binding, createdAt: 18 },
    taskChanged({ task: initial, createdAt: 19 }), taskChanged({ task: assigned, createdAt: 20 }),
    taskChanged({ task: running, createdAt: 21 }), taskChanged({ task: second, createdAt: 22 }),
    taskChanged({ task: secondAssigned, createdAt: 23 }),
    taskChanged({ task: task({ id: 'readiness-queued', createdAt: 24 }), createdAt: 24 })]
  const ctx = await recover('json', records)
  const reader = scopedReader(ctx, f.human)
  ctx.on('team/member-execution-observe', async () => ({ route: { kind: 'configured', provider: 'in-process', configuration: 'fixture', reasons: [] },
    activation: { state: 'attached', activationId: taskCreatorActivationId } }))
  const page = await reader.read({ teamId, participantIds: [f.worker.id] })
  expect(page.items).toMatchObject([{ state: 'busy', reasons: [], configuration: 'fixture' }])
  expect(JSON.stringify(page)).not.toMatch(/attemptHistory|authorityGrant|agentOptions/)
})


it('retains the first fitting readiness row and returns the exact unread next offset after byte backpressure', async () => {
  const f = readyMembers()
  const ctx = await recover('json', f.records, undefined, teamId, [], f.records.length - 1, [], { maxSelectionBytes: 420 })
  const reader = scopedReader(ctx, f.human)
  ctx.on('team/member-execution-observe', async input => input.participant.kind === 'human' ? {} : ({
    route: { kind: 'configured', provider: 'in-process', configuration: 'long-configuration-'.repeat(100), reasons: [] },
  }))
  const page = await reader.read({ teamId, participantIds: [f.human.id, f.worker.id] })
  expect(page.items.map(item => item.participantId)).toEqual([f.human.id])
  expect(page.nextCursor).toBe(1)
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(420)
})

it('treats a retained reservation as settled once its exact activation termination is proven', async () => {
  const f = readyMembers()
  const reservation = { id: 'readiness-reservation', sessionId: taskCreatorSessionId, provider: 'in-process', reservedAt: 18 }
  const active = { ...f.worker, phase: 'active', activationReservation: reservation }
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process', reservationId: reservation.id }
  const records: unknown[] = [...f.records, participantChanged({ participant: active, createdAt: 18 }),
    { type: 'activation/changed', binding, createdAt: 19 },
    { type: 'activation/changed', binding: { ...binding, activation: { ...binding.activation, status: 'stopping' } }, createdAt: 20 },
    { type: 'activation/changed', binding: { ...binding, activation: { ...binding.activation, status: 'offline' },
      quiescedAt: 21, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] }, createdAt: 21 }]
  const other = participant({ id: 'readiness-other-worker', kind: 'local-agent', role: 'worker' })
  records.push(...(['invited', 'provisioning', 'active'] as const).map((phase, index) => participantChanged({
    participant: { ...other, phase }, createdAt: 22 + index,
  })))
  const markerless = { activation: { id: 'readiness-markerless', teamId, participantId: other.id, status: 'idle' },
    sessionId: 'readiness-markerless-session', provider: 'in-process' }
  records.push({ type: 'activation/changed', binding: markerless, createdAt: 25 },
    { type: 'activation/changed', binding: { ...markerless, activation: { ...markerless.activation, status: 'stopping' } }, createdAt: 26 },
    { type: 'activation/changed', binding: { ...markerless, activation: { ...markerless.activation, status: 'offline' },
      quiescedAt: 27, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] }, createdAt: 27 })
  const ctx = await recover('json', records)
  const reader = scopedReader(ctx, f.human)
  ctx.on('team/member-execution-observe', async () => ({ route: { kind: 'configured', provider: 'in-process', configuration: 'fixture', reasons: [] } }))
  const page = await reader.read({ teamId, participantIds: [f.worker.id, other.id] })
  expect(page.items).toMatchObject([{ state: 'ready', reasons: [] }, { state: 'ready', reasons: [] }])
  const unrelated = await reader.read({ teamId, participantIds: [f.human.id] })
  expect(unrelated.items).toMatchObject([{ state: 'not-applicable', reasons: ['human'] }])
})

it('reports frozen zero startup and concurrency ceilings without activating a member', async () => {
  const f = readyMembers()
  const records = [createdTeam({ budgets: { maxLiveActivations: 0, maxConcurrency: 0 } }), ...f.records.slice(1)]
  const ctx = await recover('json', records)
  const reader = scopedReader(ctx, f.human)
  ctx.on('team/member-execution-observe', async () => ({ route: { kind: 'configured', provider: 'in-process', configuration: 'fixture', reasons: [] } }))
  const page = await reader.read({ teamId, participantIds: [f.worker.id] })
  expect(page.items).toMatchObject([{ state: 'capacity-wait', reasons: ['activation-capacity', 'concurrency-capacity'] }])
})
