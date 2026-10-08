import { projectHumanAction } from '@clocky/clocky-team/selection'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema, teamSystemHumanActionScopeSchema, teamHumanActionResponseInputSchema } from '@clocky/clocky-team'
import type { TeamHumanActorProof, TeamHumanActorScope, TeamSystemHumanActionProof, TeamSystemHumanActionScope } from '@clocky/clocky-team'
import { teamHumanActionIdSchema, teamHumanActionSnapshotSchema, teamHumanActionReadRequestSchema } from '@clocky/clocky-team/schema'
/** Human-action admission and late settlement across durable Team closure. @module */

import { describe, expect, it, vi } from 'vitest'
import { retainedFinalAdapter, retainedFinalFixture } from './durable-final-fixtures.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import type { DurableChannelFixture } from './durable-replay-fixtures.ts'
import { createdTeam, goal, goalChanged, participant, participantChanged, taskCreatorActivationId, taskCreatorId,
  taskCreatorSessionId, teamId, teamPhase, task, taskChanged, taskLease, seedTeamPhase } from './fixtures.ts'

function action(createdAt = 16) {
  return { id: 'question-a', teamId, kind: 'question', phase: 'pending', participantId: taskCreatorId,
    sessionId: taskCreatorSessionId, sourceId: 'rpc-a', details: { questionRpcId: 'rpc-a', questions: [] },
    createdAt, updatedAt: createdAt }
}

function actionRecord(value: object, createdAt: number) {
  return { type: 'human-action/changed', action: value, createdAt }
}

function closure(kind: 'complete' | 'fail' | 'cancel', createdAt: number) {
  return { type: 'team/closure', createdAt, closure: { teamId, kind, idempotencyKey: `close-${kind}`,
    actor: { kind: 'system', name: 'team-run' }, reason: { code: 'RUN_SETTLED', message: 'The run settled.' },
    requestedAt: createdAt, ...kind === 'complete' ? { finalChannelId: 'human-channel', finalEnvelopeId: 'final-a' } : {},
  } }
}

function fixture(kind: 'complete' | 'fail' | 'cancel', pending: boolean) {
  const final = kind === 'complete' ? retainedFinalFixture({ channelId: 'human-channel', senderId: taskCreatorId,
    memberAt: 14, createdAt: 17, admittedAt: 20, receiptAt: 21 }) : undefined
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process' }
  const prefix = [createdTeam(), teamPhase(),
    participantChanged({ participant: member, createdAt: 12 }),
    participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 }),
    ...final?.memberRecords ?? [],
    { type: 'activation/changed', binding, createdAt: 15 },
    ...pending ? [actionRecord(action(), 16)] : [],
    ...final === undefined ? [] : [final.attachment],
    ...kind === 'complete' ? [goalChanged({ goal: goal({ phase: 'complete', revision: 2 }), createdAt: 17 })] : [],
  ]
  const intent = kind === 'cancel'
    ? { type: 'team/cancellation', createdAt: 18, cancellation: { teamId, idempotencyKey: 'close-cancel',
      actor: { kind: 'system', name: 'team-run' }, reason: { code: 'CANCELLED', message: 'Cancellation requested.' }, requestedAt: 18 } }
    : closure(kind, 18)
  const closing = [...prefix, intent, { type: 'team/phase', phase: 'quiescing', createdAt: 19 }]
  const offline = { type: 'activation/changed', binding: { ...binding, activation: { ...binding.activation, status: 'offline' },
    quiescedAt: 21, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] }, createdAt: 21 }
  const terminalPhase = kind === 'complete' ? 'completed' : kind === 'fail' ? 'failed' : 'cancelled'
  const terminal = [...pending ? [actionRecord({ ...action(), phase: 'cancelled', outcome: { reason: 'Run closed.' }, updatedAt: 20 }, 20)] : [],
    ...final === undefined ? [] : [final.admission],
    offline, ...kind === 'cancel' ? [closure('cancel', 22)] : [], { type: 'team/phase', phase: terminalPhase, createdAt: 23 }]
  checkpointFor([...closing, ...terminal])
  return { closing, terminal, terminalPhase,
    channels: final === undefined ? [] : [final.channel],
    pendingChannels: final === undefined ? [] : [final.pendingChannel],
  }
}

async function recoverHuman(
  backend: 'json' | 'sqlite',
  records: readonly unknown[],
  channels: readonly DurableChannelFixture[],
  checkpoint?: unknown,
  checkpointCursor?: number,
) {
  const ctx = await recover(backend, records, checkpoint, teamId, channels, checkpointCursor)
  if (channels.length > 0) ctx.teams.registerAdapter(retainedFinalAdapter)
  return ctx
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable human-action closure (${backend})`, () => {
    it('refuses a new question in a terminal journal without a closure intent', async () => {
      const { closing, terminal } = fixture('fail', false)
      const rows = [...closing, ...terminal].filter(record => record.type !== 'team/closure')
      checkpointFor(rows)
      const ctx = await recover(backend, [...rows, actionRecord(action(24), 24)])
      await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow('terminal Team retains pending human action')
    })

    for (const kind of ['complete', 'fail', 'cancel'] as const) {
      it(`refuses new human work after ${kind} intent or terminal settlement`, async () => {
        const { closing, terminal, channels, pendingChannels } = fixture(kind, false)
        for (const value of [{ prefix: closing, channels: pendingChannels }, { prefix: [...closing, ...terminal], channels }]) {
          const late = action(24)
          const ctx = await recoverHuman(backend, [...value.prefix, actionRecord(late, 24)], value.channels)
          await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
        }
      })

      it(`keeps pre-${kind} pending work recoverable until its exact late settlement`, async () => {
        const { closing, pendingChannels } = fixture(kind, true)
        const checkpoint = checkpointFor(closing)
        const pending = await recoverHuman(backend, closing, pendingChannels, checkpoint)
        expect((await pending.teams.getTeam({ teamId })).humanActions).toEqual([action()])
        for (const phase of ['resolved', 'cancelled'] as const) {
          const settled = { ...action(), phase, outcome: { answer: 'The request settled.' }, updatedAt: 20 }
          const rows = [...closing, actionRecord(settled, 20)]
          const reader = await recoverHuman(backend, rows, pendingChannels, checkpoint, closing.length - 1)
          expect((await reader.teams.getTeam({ teamId })).humanActions).toEqual([settled])
          const reopened = await recoverHuman(backend, [...rows, actionRecord({ ...action(), updatedAt: 21 }, 21)], pendingChannels)
          await expect(reopened.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
        }
      })

      it(`refuses ${kind} terminal journals and checkpoints that retain pending human work`, async () => {
        const { closing, terminal, terminalPhase, channels } = fixture(kind, true)
        const withoutSettlement = terminal.filter(record => record.type !== 'human-action/changed')
        const invalid = await recoverHuman(backend, [...closing, ...withoutSettlement], channels)
        await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
        const rows = [...closing, ...terminal]
        const checkpoint = checkpointFor(rows)
        const restored = await recoverHuman(backend, rows, channels, { ...checkpoint, humanActions: [action()] })
        const state = await restored.teams.getTeam({ teamId })
        expect(state.team.phase).toBe(terminalPhase)
        expect(state.humanActions?.[0]?.phase).toBe('cancelled')
      })
    }
  })
}

it.each(['json', 'sqlite'] as const)('reads one durable action without copying the Team state (%s)', async (backend) => {
  const input = fixture('fail', true)
  const ctx = await recoverHuman(backend, input.closing, [])
  const expected = teamHumanActionSnapshotSchema.parse(action())
  const completeRead = vi.spyOn(ctx.teams, 'getTeam').mockRejectedValue(new Error('Full Team materialization forbidden'))
  const actual = await ctx.teams.getHumanAction({ teamId, actionId: expected.id })
  expect(actual).toEqual(expected)
  expect(Object.isFrozen(actual)).toBe(true)
  expect(completeRead).not.toHaveBeenCalled()
  await expect(ctx.teams.getHumanAction({ teamId, actionId: teamHumanActionIdSchema.parse('missing') }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  expect(teamHumanActionReadRequestSchema.safeParse({ teamId, actionId: expected.id, extra: true }).success).toBe(false)
  expect(projectHumanAction(expected, 1)).toEqual({ ok: false, reason: 'too-large' })
  expect(projectHumanAction(undefined, 16384)).toEqual({ ok: false, reason: 'missing' })
  const projected = projectHumanAction(expected, 16384)
  expect(projected).toEqual({ ok: true, value: expected })
  expect(projected.ok && projected.value === expected).toBe(false)
})

it.each(['json', 'sqlite'] as const)('rejects an oversized durable action (%s)', async (backend) => {
  const input = fixture('fail', true)
  const records = input.closing.map(record => record.type === 'human-action/changed'
    ? { ...record, action: { ...action(), details: { prompt: 'x'.repeat(20000) } } } : record)
  const ctx = await recoverHuman(backend, records, [])
  await expect(ctx.teams.getHumanAction({ teamId, actionId: teamHumanActionIdSchema.parse('question-a') }))
    .rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
})

it.each(['json', 'sqlite'] as const)('inspects retained request handling under exact human read proofs (%s)', async (backend) => {
  const human = participant({ id: 'detail-reader', kind: 'human', role: 'human', phase: 'active',
    owner: { kind: 'product-principal', principalId: 'reader' }, authorityGrant: {
      operations: ['human-action'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {},
    } })
  const expected = teamHumanActionSnapshotSchema.parse(action())
  const fixtureValue = fixture('fail', true)
  const records = [...fixtureValue.closing]
  const position = records.findIndex(record => record.type === 'activation/changed')
  records.splice(position, 0, ...(['invited', 'provisioning', 'active'] as const).map(phase =>
    participantChanged({ participant: { ...human, phase }, createdAt: 14 })))
  let ctx = await recoverHuman(backend, records, [])
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  const dispose = ctx.teams.registerHumanActorProofSource({ name: 'request-detail', resolveHumanActorProof: actor => scopes.get(actor) })
  const inspect = async (actionId = expected.id, revoke = false) => {
    const input = { teamId, actionId }
    const actor = Object.freeze({}) as TeamHumanActorProof
    const bound = { teamId, operation: 'attention-read' as const, fence: { kind: 'read' as const }, payload: jsonObjectSchema.parse(input) }
    scopes.set(actor, { teamId, participantId: human.id, operation: bound.operation, fence: bound.fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
    if (revoke) scopes.delete(actor)
    try { return await ctx.teams.inspectHumanAction({ ...input, actor }) }
    finally { scopes.delete(actor) }
  }
  const before = await ctx.teams.getTeam({ teamId })
  const detail = await inspect()
  expect(detail).toEqual({ teamId, teamCursor: before.team.cursor, action: expected,
    handling: { kind: 'waiting', reason: 'closure-in-progress' } })
  expect(Object.isFrozen(detail)).toBe(true)
  expect(await ctx.teams.getTeam({ teamId })).toEqual(before)
  await expect(inspect(teamHumanActionIdSchema.parse('missing'))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  await expect(inspect(expected.id, true)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  dispose()
  ctx = await recoverHuman(backend, records.map(record => record.type === 'human-action/changed'
    ? { ...record, action: { ...action(), details: { prompt: 'x'.repeat(20000) } } } : record), [])
  const releaseLarge = ctx.teams.registerHumanActorProofSource({ name: 'request-detail-large', resolveHumanActorProof: actor => scopes.get(actor) })
  await expect(inspect()).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
  releaseLarge()
})


/** Real active membership and serialized question; the Host seam selects the complete accepted answer. */
async function responseFixture(taskState?: 'active' | 'settled') {
  const human = participant({ id: 'answer-human', kind: 'human', owner: { kind: 'product-principal', principalId: 'answer-principal' },
    authorityGrant: { operations: ['human-action'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {} } })
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const pending = { ...action(taskState === undefined ? 19 : 23),
    ...taskState === undefined ? {} : { taskId: 'human-response-task', attemptId: 'human-response-attempt' } }
  const rows: unknown[] = [createdTeam(), teamPhase(), ...[member, human].flatMap((value, index) =>
    (['invited', 'provisioning', 'active'] as const).map((phase, offset) => participantChanged({
      participant: { ...value, phase }, createdAt: 12 + index * 3 + offset,
    }))),
  { type: 'activation/changed', binding: { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process' }, createdAt: 18 }]
  if (taskState !== undefined) {
    const initial = task({ id: 'human-response-task', createdAt: 20 })
    const lease = taskLease({ attemptId: 'human-response-attempt', activationId: taskCreatorActivationId, participantId: taskCreatorId,
      assignedAt: 21, renewedAt: 21, expiresAt: 10021, durationMs: 10000 })
    const assigned = task({ ...initial, phase: 'assigned', revision: 2, lease, attemptCount: 1 })
    const running = task({ ...assigned, phase: 'running', revision: 3, lease: { ...lease, startedAt: 22 } })
    rows.push(taskChanged({ task: initial, createdAt: 20 }), taskChanged({ task: assigned, createdAt: 21 }),
      taskChanged({ task: running, createdAt: 22 }), actionRecord(pending, 23))
    if (taskState === 'settled') rows.push(taskChanged({ task: task({ ...running, phase: 'completed', revision: 4, lease: undefined,
      attemptHistory: [{ id: lease.attemptId, teamId, taskId: initial.id, ordinal: lease.ordinal, participantId: taskCreatorId,
        activationId: taskCreatorActivationId, assignedAt: 21, startedAt: 22, leaseExpiresAt: lease.expiresAt, settledAt: 24,
        outcome: { kind: 'completed', result: { summary: 'Task completed' } } }] }), createdAt: 24 }))
  } else rows.push(actionRecord(pending, 19))
  const ctx = await recover('json', rows)
  const proofs = new Map<TeamSystemHumanActionProof, TeamSystemHumanActionScope>()
  const stop = ctx.teams.registerSystemHumanActionProofSource({ name: 'host-api-proxy', resolveHumanActionProof: value => proofs.get(value) })
  async function respond(patch: Record<string, unknown> = {}, scopePatch: Record<string, unknown> = {}) {
    const state = await ctx.teams.getTeam({ teamId })
    const input = teamHumanActionResponseInputSchema.parse({ teamId, actionId: pending.id, expectedUpdatedAt: pending.updatedAt,
      idempotencyKey: 'answer-once', answer: { kind: 'question', answers: [] }, ...patch })
    const actor = Object.freeze({ toJSON(): never { throw new Error('Runtime-only proof') } }) as unknown as TeamSystemHumanActionProof
    proofs.set(actor, teamSystemHumanActionScopeSchema.parse({ kind: 'host-human-action-response-accept', teamId,
      expectedCursor: state.team.cursor, action: { ...pending, createdAt: 0, updatedAt: 0 }, input,
      principalId: 'answer-principal', humanId: human.id, ...scopePatch }))
    try { return await ctx.teams.acceptHumanActionResponse({ actor, teamId, expectedCursor: state.team.cursor }) }
    finally { proofs.delete(actor) }
  }
  async function resolve(phase: 'resolved' | 'cancelled', outcome: Record<string, unknown>, actionPatch: Record<string, unknown> = {}) {
    const state = await ctx.teams.getTeam({ teamId })
    const actor = Object.freeze({ toJSON(): never { throw new Error('Runtime-only proof') } }) as unknown as TeamSystemHumanActionProof
    proofs.set(actor, teamSystemHumanActionScopeSchema.parse({ kind: 'host-human-action-resolve', teamId,
      expectedCursor: state.team.cursor, action: { ...pending, createdAt: 0, updatedAt: 0, ...actionPatch }, phase, outcome }))
    try { return await ctx.teams.resolveHumanAction({ actor, teamId, expectedCursor: state.team.cursor }) }
    finally { proofs.delete(actor) }
  }
  async function unavailable(actionPatch: Record<string, unknown> = {}, scopePatch: Record<string, unknown> = {}) {
    const state = await ctx.teams.getTeam({ teamId })
    const actor = Object.freeze({ toJSON(): never { throw new Error('Runtime-only proof') } }) as unknown as TeamSystemHumanActionProof
    proofs.set(actor, teamSystemHumanActionScopeSchema.parse({ kind: 'host-human-action-unavailable', teamId,
      expectedCursor: state.team.cursor, action: { ...pending, ...actionPatch }, ...scopePatch }))
    try { return await ctx.teams.unavailableHumanAction({ actor, teamId, expectedCursor: state.team.cursor }) }
    finally { proofs.delete(actor) }
  }
  return { ctx, pending, human, respond, resolve, unavailable, stop,
    replaceResolutionOutcome(outcome: Record<string, unknown>) {
      for (const [proof, scope] of proofs) if (scope.kind === 'host-human-action-resolve') {
        proofs.set(proof, teamSystemHumanActionScopeSchema.parse({ ...scope, outcome }))
      }
    } }

}

it('stalls a live Team after the Host proves a pending human continuation cannot be recovered', async () => {
  const f = await responseFixture()
  const before = await f.ctx.teams.getTeam({ teamId })
  await expect(f.unavailable({}, { kind: 'host-human-action-resolve', phase: 'cancelled',
    action: { ...f.pending, createdAt: 0, updatedAt: 0 },
    outcome: { code: 'WRONG_OPERATION' } })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  await expect(f.unavailable({ details: { questionRpcId: 'other-request', questions: [] } }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect(await f.ctx.teams.getTeam({ teamId })).toEqual(before)
  const cancelled = await f.unavailable()
  expect(cancelled).toMatchObject({ phase: 'cancelled', outcome: {
    kind: 'unavailable', code: 'HUMAN_ACTION_CONTINUATION_UNAVAILABLE',
  } })
  const stalled = await f.ctx.teams.getTeam({ teamId })
  expect(stalled.team.phase).toBe('stalled')
  expect(stalled.team.stallReason?.code).toBe('HUMAN_ACTION_CONTINUATION_UNAVAILABLE')
  expect(stalled.humanActions).toContainEqual(cancelled)
  await expect(f.unavailable()).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})

it('cancels an unavailable human continuation without replacing an earlier Team stall reason', async () => {
  const f = await responseFixture()
  await f.ctx.teams.getTeam({ teamId })
  await seedTeamPhase(f.ctx, teamId, 'stalled', { code: 'MODEL_UNAVAILABLE', message: 'Waiting for model recovery.' })
  const cancelled = await f.unavailable()
  expect(cancelled.phase).toBe('cancelled')
  const team = await f.ctx.teams.getTeam({ teamId })
  expect(team.team.phase).toBe('stalled')
  expect(team.team.stallReason).toEqual({ code: 'MODEL_UNAVAILABLE', message: 'Waiting for model recovery.' })
})

it('retains the first exact accepted human answer across retries without claiming tool completion', async () => {
  const f = await responseFixture()
  try {
    const accepted = await f.respond()
    expect(accepted.phase).toBe('pending')
    expect(accepted.response).toMatchObject({ idempotencyKey: 'answer-once', respondedBy: f.human.id,
      expectedUpdatedAt: f.pending.updatedAt, answer: { kind: 'question', answers: [] } })
    const before = await f.ctx.teams.getTeam({ teamId })
    expect(await f.respond()).toEqual(accepted)
    expect(await f.ctx.teams.getTeam({ teamId })).toEqual(before)
    await expect(f.respond({ idempotencyKey: 'different-answer' })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(f.respond({ answer: { kind: 'question', answers: [{ id: 'q', selected: [], custom: 'Different' }] } }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  } finally { await f.ctx.fiber.dispose() }
})

it.each([
  ['old request revision', { expectedUpdatedAt: 18 }],
  ['different answer kind', { answer: { kind: 'approval', outcome: 'rejected' } }],
] as const)('refuses a human response with %s before changing the pending request', async (_name, patch) => {
  const f = await responseFixture()
  try {
    const before = await f.ctx.teams.getTeam({ teamId })
    await expect(f.respond(patch)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(await f.ctx.teams.getTeam({ teamId })).toEqual(before)
  } finally { await f.ctx.fiber.dispose() }
})

it.each(['principalId', 'humanId'] as const)('refuses a response proof that binds another %s', async (field) => {
  const f = await responseFixture()
  try { await expect(f.respond({}, { [field]: 'foreign' })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' }) }
  finally { await f.ctx.fiber.dispose() }
})

it('revalidates response proof lifetime after policy admission yields', async () => {
  const f = await responseFixture()
  f.ctx.teams.registerPolicy('human-action', { name: 'retire-response-source', async apply(_request, next) {
    f.stop(); return await next()
  } })
  try {
    const before = await f.ctx.teams.getTeam({ teamId })
    await expect(f.respond()).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(await f.ctx.teams.getTeam({ teamId })).toEqual(before)
  } finally { await f.ctx.fiber.dispose() }
})


it('accepts only the pending response tied to the currently retained task attempt and Session', async () => {
  const live = await responseFixture('active')
  try {
    expect((await live.respond()).response?.expectedUpdatedAt).toBe(23)
  } finally { await live.ctx.fiber.dispose() }
  const settled = await responseFixture('settled')
  try {
    await expect(settled.respond()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  } finally { await settled.ctx.fiber.dispose() }
})

it('refuses a captured pending request that disagrees with the durable action details', async () => {
  const f = await responseFixture()
  try {
    await expect(f.respond({}, { action: { ...f.pending, createdAt: 0, updatedAt: 0, details: { questionRpcId: 'changed' } } }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  } finally { await f.ctx.fiber.dispose() }
})

it('refuses a proof selecting an unknown action instead of answering another retained request', async () => {
  const f = await responseFixture()
  try {
    await expect(f.respond({ actionId: 'missing' }, { action: { ...f.pending, id: 'missing', createdAt: 0, updatedAt: 0 } }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  } finally { await f.ctx.fiber.dispose() }
})

it('refuses a proof whose payload action identity disagrees with its captured request', async () => {
  const f = await responseFixture()
  try {
    await expect(f.respond({ actionId: 'different-action' })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  } finally { await f.ctx.fiber.dispose() }
})


it.each(['resolved', 'cancelled'] as const)('retains exact Host %s settlements and refuses a different terminal outcome', async (phase) => {
  const f = await responseFixture()
  const outcome = phase === 'resolved' ? { answers: [] } : { kind: 'cancelled', reason: 'Host request cancelled' }
  try {
    const settled = await f.resolve(phase, outcome)
    expect(settled.phase).toBe(phase)
    const before = await f.ctx.teams.getTeam({ teamId })
    expect(await f.resolve(phase, outcome)).toEqual(settled)
    expect(await f.ctx.teams.getTeam({ teamId })).toEqual(before)
    await expect(f.resolve(phase, { ...outcome, different: true })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  } finally { await f.ctx.fiber.dispose() }
})

it('revalidates the exact Host resolution source after policy work rather than committing a retired outcome', async () => {
  const f = await responseFixture()
  f.ctx.teams.registerPolicy('human-action', { name: 'retire-resolution', async apply(_request, next) {
    f.stop(); return await next()
  } })
  try {
    const before = await f.ctx.teams.getTeam({ teamId })
    await expect(f.resolve('resolved', { answers: [] })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(await f.ctx.teams.getTeam({ teamId })).toEqual(before)
  } finally { await f.ctx.fiber.dispose() }
})


it('refuses missing or changed Host resolution identities without settling another action', async () => {
  const f = await responseFixture()
  try {
    await expect(f.resolve('resolved', { answers: [] }, { id: 'missing-action' })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(f.resolve('resolved', { answers: [] }, { details: { questionRpcId: 'changed-request' } }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  } finally { await f.ctx.fiber.dispose() }
})

it('retains the original task-cancelled reason when the Host continuation later acknowledges generic cancellation', async () => {
  const f = await responseFixture('active')
  try {
    const original = await f.resolve('cancelled', { kind: 'task-cancelled', taskId: f.pending.taskId, reason: 'Task stop admitted' })
    const before = await f.ctx.teams.getTeam({ teamId })
    expect(await f.resolve('cancelled', { kind: 'cancelled' })).toEqual(original)
    expect(await f.ctx.teams.getTeam({ teamId })).toEqual(before)
  } finally { await f.ctx.fiber.dispose() }
})

it('refuses changed resolution facts from a still-registered Host source after policy work', async () => {
  const f = await responseFixture()
  f.ctx.teams.registerPolicy('human-action', { name: 'change-resolution', async apply(_request, next) {
    f.replaceResolutionOutcome({ changed: true }); return await next()
  } })
  try {
    const before = await f.ctx.teams.getTeam({ teamId })
    await expect(f.resolve('resolved', { answers: [] })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(await f.ctx.teams.getTeam({ teamId })).toEqual(before)
  } finally { await f.ctx.fiber.dispose() }
})
