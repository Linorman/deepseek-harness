import type {
  ChannelCloseInput,
  ChannelOpenInput,
  ChannelSnapshot,
  TeamSystemChannelLifecycleProof,
  TeamSystemChannelLifecycleProofSource,
  TeamSystemChannelLifecycleScope,
} from '@clocky/clocky-team'
import { channelInvitationIdempotencyKeySchema, fingerprintChannelManifest } from '@clocky/clocky-team'
import type { Context } from '@clocky/cordis'

/** Close one channel through a short-lived exact fixture lifecycle proof. */
export async function closeTestChannel(
  ctx: Context,
  input: ChannelCloseInput,
): Promise<ChannelSnapshot> {
  const channel = await ctx.teams.getChannel({ channelId: input.channelId })
  const scope: TeamSystemChannelLifecycleScope = {
    kind: 'channel-close',
    teamId: channel.manifest.teamId,
    ...structuredClone(input),
  }
  return await withTestChannelLifecycleProof(ctx, scope, async actor =>
    await ctx.teams.closeChannel({ actor, ...input }))
}

/** Open one non-workflow channel through a short-lived exact fixture lifecycle proof. */
export async function openTestChannel(
  ctx: Context,
  input: ChannelOpenInput,
): Promise<ChannelSnapshot> {
  const { workflowPlanId, expectedPlanRevision, ...genericInput } = input
  if (workflowPlanId !== undefined || expectedPlanRevision !== undefined) {
    throw new TypeError('openTestChannel accepts generic non-workflow channel input only')
  }
  const scope: TeamSystemChannelLifecycleScope = {
    kind: 'channel-open',
    ...structuredClone(genericInput),
  }
  return await withTestChannelLifecycleProof(ctx, scope, async actor =>
    await ctx.teams.openChannel({ actor, authorityKind: 'channel-lifecycle', ...genericInput }))
}

/** Acknowledge every pending activation endpoint whose current durable binding is available. */
export async function acknowledgeTestChannelActivations(
  ctx: Context,
  channelId: ChannelSnapshot['manifest']['id'],
): Promise<ChannelSnapshot> {
  const channel = await ctx.teams.getChannel({ channelId })
  const admission = await ctx.teams.getChannelAdmission({ channelId })
  const state = await ctx.teams.getTeam({ teamId: channel.manifest.teamId })
  const issuer = ctx.teams.openActivationActorProofIssuer()
  for (const invitation of admission.invitations) {
    if (invitation.status !== 'pending' || invitation.endpoint.kind !== 'activation') continue
    const binding = state.activations.findLast(candidate => candidate.activation.participantId === invitation.participantId
      && (candidate.activation.status === 'idle' || candidate.activation.status === 'running'))
    if (binding === undefined) continue
    await ctx.teams.acknowledgeChannelInvitation({
      actor: issuer.issue(binding).proof,
      channelId,
      revision: invitation.revision,
      manifestFingerprint: fingerprintChannelManifest(channel.manifest),
      idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`test-consent:${String(invitation.participantId)}`),
    })
  }
  return await ctx.teams.getChannel({ channelId })
}

/** Retain one exact lifecycle scope only until its fixture Hub call settles. */
async function withTestChannelLifecycleProof<T>(
  ctx: Context,
  scope: TeamSystemChannelLifecycleScope,
  operation: (actor: TeamSystemChannelLifecycleProof) => Promise<T>,
): Promise<T> {
  const proofs = new Map<TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope>()
  const source: TeamSystemChannelLifecycleProofSource = {
    name: 'team-channel-lifecycle',
    resolveChannelLifecycleProof: proof => proofs.get(proof),
  }
  const unregister = ctx.teams.registerSystemChannelLifecycleProofSource(source)
  const proof = createTestChannelLifecycleProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    proofs.delete(proof)
    unregister()
  }
}

/** Create one fixture-only proof that cannot cross a durable or wire boundary. */
function createTestChannelLifecycleProof(): TeamSystemChannelLifecycleProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Test channel-lifecycle proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemChannelLifecycleProof
}
