/** Pending reads retain exact principal authority and one authoritative Team revision on both storage owners. */
import { expect, it } from 'vitest'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema, teamAttentionReadInputSchema } from '@clocky/clocky-team'
import type { TeamAttentionReadInput, TeamHumanActorProof, TeamHumanActorScope } from '@clocky/clocky-team'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, task, taskChanged, taskLease, teamId, teamPhase } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('pages pending reviews with current human permissions and no model work (%s)', async (backend) => {
  const human = participant({ id: 'pending-reader', kind: 'human', role: 'human', phase: 'active',
    owner: { kind: 'product-principal', principalId: 'reader' }, authorityGrant: {
      operations: ['task-mutate', 'human-action', 'activate'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {},
    } })
  const records = [createdTeam(), teamPhase(), ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
    participantChanged({ participant: { ...human, phase }, createdAt: 12 + index }))]
  for (let index = 0; index < 4; index++) {
    const createdAt = 15 + index * 4
    const initial = task({ id: `review-${index}`, createdAt, writeScopes: [], reviewPolicy: { kind: 'participant', reviewerId: human.id },
      createCommand: { creator: { teamId, participantId: human.id }, idempotencyKey: `review-create-${index}` } })
    const lease = taskLease({ attemptId: `review-attempt-${index}`, participantId: human.id, assignedAt: createdAt + 1,
      renewedAt: createdAt + 1, expiresAt: createdAt + 11 })
    const assigned = { ...initial, revision: 2, phase: 'assigned', attemptCount: 1, lease }
    const running = { ...assigned, revision: 3, phase: 'running', lease: { ...lease, startedAt: createdAt + 2 } }
    const reviewed = { ...running, revision: 4, phase: 'review', lease: undefined, attemptHistory: [{
      id: lease.attemptId, teamId, taskId: initial.id, ordinal: 1, participantId: human.id,
      assignedAt: lease.assignedAt, startedAt: createdAt + 2, settledAt: createdAt + 3, leaseExpiresAt: lease.expiresAt,
      outcome: { kind: 'completed', result: { summary: 'Private result' } },
    }] }
    records.push(taskChanged({ task: initial, createdAt }), taskChanged({ task: assigned, createdAt: createdAt + 1 }),
      taskChanged({ task: running, createdAt: createdAt + 2 }), taskChanged({ task: reviewed, createdAt: createdAt + 3 }))
  }
  const ctx = await recover(backend, records, undefined, teamId, [], records.length - 1, [], { recoveryPageSize: 2 })
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  const dispose = ctx.teams.registerHumanActorProofSource({ name: 'pending-reader', resolveHumanActorProof: actor => scopes.get(actor) })
  const read = async (raw: TeamAttentionReadInput, revoke = false) => {
    const input = teamAttentionReadInputSchema.parse(raw)
    const actor = Object.freeze({}) as TeamHumanActorProof
    const bound = { teamId, operation: 'attention-read' as const, fence: { kind: 'read' as const }, payload: jsonObjectSchema.parse(input) }
    scopes.set(actor, { teamId, participantId: human.id, operation: bound.operation, fence: bound.fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
    if (revoke) scopes.delete(actor)
    try { return await ctx.teams.getTeamAttention({ ...input, actor }) }
    finally { scopes.delete(actor) }
  }
  const before = await ctx.teams.getTeam({ teamId })
  const first = await read({ teamId })
  expect(first.counts).toEqual({ recovery: 0, humanActions: 0, reviews: 4, total: 4 })
  expect(first.items.map(item => item.id)).toEqual(['review-0', 'review-1'])
  expect(first.items.every(item => item.handling.kind === 'actionable')).toBe(true)
  expect((await ctx.teams.getTeamSelection({ teamId })).attentionCounts).toEqual(first.counts)
  const second = await read({ teamId, cursor: first.nextCursor })
  expect(second.items.map(item => item.id)).toEqual(['review-2', 'review-3'])
  expect(second.nextCursor).toBeUndefined()
  expect(await ctx.teams.getTeam({ teamId })).toEqual(before)
  expect(JSON.stringify(first)).not.toMatch(/Private result|authorityGrant|attemptHistory/)
  await expect(read({ teamId, cursor: { ...first.nextCursor!, teamCursor: first.teamCursor - 1 } }))
    .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
  await expect(read({ teamId }, true)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  dispose()
  await expect(read({ teamId })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})
