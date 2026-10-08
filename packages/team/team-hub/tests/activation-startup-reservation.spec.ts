/** Durable startup reservations guard unpublished provider work and survive retries. */
import { expect, it } from 'vitest'
import { activationIdSchema, activationReservationIdSchema, participantIdSchema } from '@clocky/clocky-team'
import type { ActivationReservationInput, TeamSystemActivationProof, TeamSystemActivationScope } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, teamId, teamPhase } from './fixtures.ts'

async function fixture(backend: 'json' | 'sqlite') {
  const member = participant({ id: 'reservation-worker', role: 'worker' })
  const rows = [createdTeam(), teamPhase(), ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
    participantChanged({ participant: { ...member, phase }, createdAt: 12 + index }))]
  const ctx = await recover(backend, rows)
  const scopes = new Map<TeamSystemActivationProof, TeamSystemActivationScope>()
  ctx.teams.registerSystemActivationProofSource({ name: 'team-activation-controller',
    resolveActivationProof: proof => scopes.get(proof) })
  const input = async (reservationId = activationReservationIdSchema.parse('startup-reservation')):
  Promise<ActivationReservationInput> => ({ teamId, participantId: member.id, reservationId,
    sessionId: SessionId('startup-session'), provider: 'in-process',
    expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor })
  const invoke = async (operation: 'reserve' | 'release', selected: ActivationReservationInput) => {
    const actor = Object.freeze({}) as TeamSystemActivationProof
    scopes.set(actor, { kind: operation === 'reserve' ? 'activation-controller-reserve'
      : 'activation-controller-release-reservation', ...selected })
    try { return operation === 'reserve' ? await ctx.teams.reserveActivation({ ...selected, actor })
      : await ctx.teams.releaseActivationReservation({ ...selected, actor }) }
    finally { scopes.delete(actor) }
  }
  return { ctx, member, scopes, input, invoke }
}

it.each(['json', 'sqlite'] as const)('reserves, retries and releases only one exact startup identity (%s)', async (backend) => {
  const f = await fixture(backend)
  const reserved = await f.invoke('reserve', await f.input())
  expect(reserved).toMatchObject({ id: 'startup-reservation', sessionId: 'startup-session' })
  const beforeRetry = await f.ctx.teams.getTeam({ teamId })
  expect(await f.invoke('reserve', await f.input())).toEqual(reserved)
  expect(await f.ctx.teams.getTeam({ teamId })).toEqual(beforeRetry)
  await expect(f.invoke('reserve', await f.input(activationReservationIdSchema.parse('another-startup'))))
    .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
  const released = await f.invoke('release', await f.input())
  expect(released.id).toBe(reserved.id)
  expect(released.sessionId).toBe(reserved.sessionId)
  expect(typeof released.releasedAt).toBe('number')
  const beforeReleaseRetry = await f.ctx.teams.getTeam({ teamId })
  expect(await f.invoke('release', await f.input())).toEqual(released)
  expect(await f.ctx.teams.getTeam({ teamId })).toEqual(beforeReleaseRetry)
  await expect(f.invoke('reserve', await f.input())).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
  await expect(f.invoke('release', await f.input(activationReservationIdSchema.parse('unrelated-reservation'))))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect((await f.ctx.teams.getTeam({ teamId })).participants.find(member => member.id === f.member.id)?.activationReservation)
    .toEqual(released)
})

it('revalidates a startup proof after policy and refuses a revoked reservation', async () => {
  const f = await fixture('json')
  const selected = await f.input()
  const proof = Object.freeze({}) as TeamSystemActivationProof
  f.scopes.set(proof, { kind: 'activation-controller-reserve', ...selected })
  f.ctx.teams.registerPolicy('activate', { name: 'revoke-startup-proof', async apply(_request, next) {
    f.scopes.delete(proof)
    return await next()
  } })
  await expect(f.ctx.teams.reserveActivation({ ...selected, actor: proof }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect((await f.ctx.teams.getTeam({ teamId })).participants.find(member => member.id === f.member.id)?.activationReservation)
    .toBeUndefined()
})

it('keeps a published startup reservation until its activation epoch has quiesced', async () => {
  const f = await fixture('json')
  const selected = await f.input()
  await f.invoke('reserve', selected)
  const binding = { activation: { id: activationIdSchema.parse('published-startup'), teamId,
    participantId: f.member.id, status: 'idle' as const }, sessionId: selected.sessionId,
  provider: selected.provider, reservationId: selected.reservationId }
  const input = { expectedCursor: (await f.ctx.teams.getTeam({ teamId })).team.cursor, binding }
  const actor = Object.freeze({}) as TeamSystemActivationProof
  f.scopes.set(actor, { kind: 'activation-controller-bind', ...input })
  await f.ctx.teams.bindActivation({ ...input, actor })
  const before = await f.ctx.teams.getTeam({ teamId })
  await expect(f.invoke('release', await f.input())).rejects.toMatchObject({ code: 'TEAM_NOT_QUIESCENT' })
  await expect(f.invoke('reserve', await f.input(activationReservationIdSchema.parse('new-startup'))))
    .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
  expect(await f.ctx.teams.getTeam({ teamId })).toEqual(before)
})

it('rejects a missing member and a proof selected for the opposite startup operation', async () => {
  const f = await fixture('json')
  const original = await f.input()
  const missing = { ...original, participantId: participantIdSchema.parse('missing-startup-member') }
  const missingProof = Object.freeze({}) as TeamSystemActivationProof
  f.scopes.set(missingProof, { kind: 'activation-controller-reserve', ...missing })
  await expect(f.ctx.teams.reserveActivation({ ...missing, actor: missingProof }))
    .rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
  const wrongProof = Object.freeze({}) as TeamSystemActivationProof
  f.scopes.set(wrongProof, { kind: 'activation-controller-release-reservation', ...original })
  await expect(f.ctx.teams.reserveActivation({ ...original, actor: wrongProof }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect((await f.ctx.teams.getTeam({ teamId })).participants.find(member => member.id === f.member.id)?.activationReservation)
    .toBeUndefined()
})
