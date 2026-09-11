/** Explicit endpoint consent for fixtures that own a current authenticated binding. */
import type { Context } from '@clocky/cordis'
import { TeamError, channelInvitationIdempotencyKeySchema } from '@clocky/clocky-team'
import type { ChannelManifest, ChannelSnapshot, ParticipantId, TeamActorProof } from '@clocky/clocky-team'

/**
 * Validate the endpoint's supported protocol and commit its exact invitation through the public Hub command.
 * @param ctx - real Team provider context.
 * @param channel - immutable channel selected by the fixture.
 * @param endpoints - current activation proofs, with identities independently checked by the Hub.
 * @param validate - actual protocol validator supported by these fixture endpoints.
 * @returns the current channel after these endpoints have confirmed.
 */
export async function consentChannelEndpoints(
  ctx: Context, channel: ChannelSnapshot,
  endpoints: readonly { readonly participantId: ParticipantId; readonly actor: TeamActorProof }[],
  validate: (manifest: ChannelManifest) => void,
): Promise<ChannelSnapshot> {
  validate(channel.manifest)
  for (const endpoint of endpoints) {
    const admission = await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
    const invitation = admission.invitations.find(value => value.participantId === endpoint.participantId)
    if (invitation === undefined) throw new Error('Fixture endpoint has no channel invitation')
    if (invitation.status === 'acknowledged') continue
    try {
      await ctx.teams.acknowledgeChannelInvitation({ actor: endpoint.actor, channelId: channel.manifest.id,
        revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint,
        idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`fixture-endpoint:${String(channel.manifest.id)}:${String(endpoint.participantId)}`) })
    } catch (error: unknown) {
      if (!(error instanceof TeamError) || error.code !== 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT') throw error
      const current = await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
      if (current.invitations.find(value => value.participantId === endpoint.participantId)?.status !== 'acknowledged') throw error
    }
  }
  return await ctx.teams.getChannel({ channelId: channel.manifest.id })
}
