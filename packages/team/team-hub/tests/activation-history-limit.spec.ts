/** Historical capacity includes quiesced epochs and never implies rejected-start cleanup. */
import { expect, it } from 'vitest'
import { SessionId } from '@clocky/clocky-session'
import { activationIdSchema, activationHistoryLimitDetails } from '@clocky/clocky-team'
import { recover } from './durable-replay-fixtures.ts'
import { bindTestActivation, createdTeam, fenceTestActivation, participant, participantChanged, quiesceTestActivation,
  teamId, teamPhase } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('reports exact %s historical capacity without appending the rejected epoch', async (backend) => {
  const member = participant({ id: 'history-worker', role: 'worker' })
  const ctx = await recover(backend, [createdTeam(), teamPhase(), ...(['invited', 'provisioning', 'active'] as const)
    .map((phase, index) => participantChanged({ participant: { ...member, phase }, createdAt: 12 + index }))],
  undefined, teamId, [], 4, [], { maxActivationsPerTeam: 1 })
  const sessionId = SessionId('history-session')
  const original = await bindTestActivation(ctx, { expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    binding: { activation: { id: activationIdSchema.parse('history-original'), teamId, participantId: member.id, status: 'idle' },
      sessionId, provider: 'in-process' } })
  const identity = { teamId, activationId: original.activation.id, participantId: member.id, sessionId, provider: original.provider }
  await fenceTestActivation(ctx, { ...identity, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor })
  await quiesceTestActivation(ctx, { ...identity, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor })
  const before = await ctx.teams.getTeam({ teamId })
  expect(before.activations[0]?.quiescedAt).toBeDefined()
  const activationId = activationIdSchema.parse('history-refused')
  const error: unknown = await bindTestActivation(ctx, { expectedCursor: before.team.cursor,
    binding: { ...original, activation: { id: activationId, teamId, participantId: member.id, status: 'idle' } } })
    .catch((reason: unknown) => reason)
  expect(activationHistoryLimitDetails(error)).toEqual({ kind: 'activation-history-limit', teamId,
    teamCursor: before.team.cursor, used: 1, limit: 1, participantId: member.id, activationId, sessionId, cleanup: 'pending' })
  expect(await ctx.teams.getTeam({ teamId })).toEqual(before)
})
