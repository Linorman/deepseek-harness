import type { ParticipantSnapshot } from '@clocky/clocky-team'
/** Native source topology shared by unit and real Loader evidence; no read implementation is replaced. */
import type { Context } from '@clocky/cordis'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { SimulationRun, SimulationWriterLease } from '@clocky/clocky-simulation'
import { simulationChangeSchema, simulationDecisionIdSchema } from '@clocky/clocky-simulation'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel, acknowledgeTestChannelActivations } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { postActor } from '../../../team/team-hub/tests/fixtures.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'

export async function seedSource(ctx: Context, native: { run: SimulationRun; leases: SimulationWriterLease[] },
  reader: AuthenticatedProductCall) {
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Source history', budgets: {} }, rules: {}, budgets: {} })
  const teamId = team.team.id
  const members: ParticipantSnapshot[] = []
  for (const name of ['reader', 'sender', 'recipient']) {
    const member = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: name === 'reader' ? 'human' : 'local-agent', displayName: name, role: name, capabilities: [],
      ...name === 'reader' ? { owner: { kind: 'product-principal' as const, principalId: reader.principal.id } } : {} })
    for (const phase of ['provisioning', 'active'] as const) await transitionBootstrapParticipant(ctx,
      { teamId, participantId: member.id, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
    members.push(member)
  }
  const actor = await postActor(ctx, teamId, members[1]!.id)
  await postActor(ctx, teamId, members[2]!.id)
  const channel = await openTestChannel(ctx, { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    adapter: { type: 'direct', version: 4 }, participants: members.slice(1).map(member => ({ id: member.id, role: member.role })), limits: {} })
  const channelId = channel.manifest.id
  await acknowledgeTestChannelActivations(ctx, channelId)
  let original
  for (const text of ['Unrelated one', 'Unrelated two', '精确🙂来源正文']) {
    original = await ctx.teams.postChannelEnvelope({ actor, expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor,
      draft: { channelId, kind: 'message', audience: [members[2]!.id], delivery: 'context', payload: { content: [{ type: 'text', text }] } } })
  }
  if (original === undefined) throw new Error('Fixture has no source')
  const id = 'source-reader' as never
  await native.run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id, entityKind: 'person', cognition: 'agent', profile: {} }), native.run.snapshot().revision)
  const binding = (await ctx.teams.getTeam({ teamId })).activations.find(value => value.activation.participantId === members[2]!.id)!
  await native.run.bindEntity(id, { teamId, participantId: members[2]!.id, sessionId: binding.sessionId }, native.run.snapshot().revision)
  const lease = await native.run.reserveWriter(id, 'local', 'source-lease' as never, native.run.snapshot().revision)
  native.leases.push(lease); lease.bindDecisionAdmission(async () => {})
  await lease.activate({ teamId, participantId: members[2]!.id, sessionId: binding.sessionId, provider: 'local',
    reservationId: 'source-lease' as never, activationId: binding.activation.id })
  const decisionId = simulationDecisionIdSchema.parse('source-decision')
  await lease.openDecision(decisionId, native.run.snapshot().revision)
  const request = contextRequest()
  request.teamCursor = (await ctx.teams.getTeam({ teamId })).team.cursor
  request.sources.push({ kind: 'team-envelope', teamId, channelId, envelopeId: original.id })
  await lease.prepareContext(decisionId, request)
  return { teamId, members, channelId, original, decisionId, id }
}
