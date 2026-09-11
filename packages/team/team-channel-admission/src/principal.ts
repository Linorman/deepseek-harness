/** Authenticated human endpoint consent. @module @clocky/clocky-team-channel-admission/principal */
import type { Context } from '@clocky/cordis'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type {} from '@clocky/clocky-team-human-actor'
import { resolveConsultTextDraft, parseDiscussionChannelManifest } from '@clocky/clocky-team-channel-basic'
import type { TeamEnvelopeDraft, ChannelHumanAdmissionSnapshot, ChannelPostIdempotencyKey } from '@clocky/clocky-team'
import { parseDirectProductChannelManifest } from '@clocky/clocky-team-channel-direct'
import { TeamError, channelInvitationIdempotencyKeySchema, fingerprintChannelManifest, jsonObjectSchema } from '@clocky/clocky-team'
import type { ChannelGetRequest, ChannelInvitationAcknowledgeInput, ChannelHumanInvitationSnapshot } from '@clocky/clocky-team'
import { channelGetRequestSchema, channelInvitationAcknowledgeInputSchema } from '@clocky/clocky-team'
import type { HumanChannelAdmission } from './index.ts'

/**
 * Discover the current principal's invitation without recording consent.
 * @param ctx - context with authoritative Team and human proof providers.
 * @param call - authenticated transport call.
 * @param request - actor-free channel selection.
 * @returns only the caller's invitation and its complete manifest.
 */
export async function getPrincipalChannelInvitation(
  ctx: Context, call: AuthenticatedProductCall, request: ChannelGetRequest,
): Promise<ChannelHumanInvitationSnapshot> {
  call.signal.throwIfAborted()
  const input = channelGetRequestSchema.parse(request)
  const teams = ctx.get('teams')
  const humanActors = ctx.get('teamHumanActors')
  if (teams === undefined || humanActors === undefined) throw new TeamError('Authenticated human endpoint provider is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  const channel = await teams.getChannel(input)
  return await humanActors.withProof(call, { teamId: channel.manifest.teamId, operation: 'channel-invitation-read',
    fence: { kind: 'read' }, payload: jsonObjectSchema.parse(input) },
  async actor => await teams.getHumanChannelInvitation({ actor, ...input }))
}

/**
 * Record explicit caller acceptance of an exact invitation manifest.
 * @param ctx - context with authoritative Team and human proof providers.
 * @param call - authenticated transport call.
 * @param request - exact manifest fingerprint, invitation revision and retry key accepted by the caller.
 * @returns the caller's durable acknowledgement and resulting channel phase.
 */
export async function acknowledgePrincipalChannelInvitation(
  ctx: Context, call: AuthenticatedProductCall, request: ChannelInvitationAcknowledgeInput,
): Promise<ChannelHumanInvitationSnapshot> {
  const input = channelInvitationAcknowledgeInputSchema.parse(request)
  const own = await getPrincipalChannelInvitation(ctx, call, { channelId: input.channelId })
  const teams = ctx.get('teams')
  const humanActors = ctx.get('teamHumanActors')
  if (teams === undefined || humanActors === undefined) throw new TeamError('Authenticated human endpoint provider is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  const admission = await humanActors.withProof(call, { teamId: own.channel.manifest.teamId, operation: 'channel-open',
    fence: { kind: 'revision', revision: input.revision }, payload: jsonObjectSchema.parse(input) },
  async actor => await teams.acknowledgeChannelInvitation({ actor, ...input }))
  const invitation = admission.invitations.find(value => value.participantId === own.invitation.participantId)
  if (invitation === undefined) throw new TeamError('Acknowledged invitation is missing', 'TEAM_INVALID_ARGUMENT')
  return { channel: admission.channel, invitation }
}

/**
 * Retain one authenticated call for exact product human endpoint confirmation.
 * @param ctx - transport context carrying Team and human proof services.
 * @param call - current authenticated principal call, including credential revocation.
 * @returns a runtime-only capability that validates each supplied manifest before issuing its full-payload human proof.
 */
export function createPrincipalChannelAdmission(ctx: Context, call: AuthenticatedProductCall): HumanChannelAdmission {
  return async ({ admission, participantId, signal }) => {
    const combined = AbortSignal.any([signal, call.signal])
    combined.throwIfAborted()
    const channel = admission.channel
    const manifest = parseDirectProductChannelManifest(channel.manifest)
    const members = channel.manifest.participants
    if (![3, 4].includes(manifest.version) || members.find(member => member.id === participantId)?.role !== 'human'
      || members.filter(member => member.role === 'coordinator').length !== 1
      || channel.manifest.viewPolicy?.type !== 'directed' || channel.manifest.viewPolicy.version !== 1) {
      throw new TeamError('Product human endpoint does not support the supplied role or view policy', 'TEAM_INVALID_ARGUMENT')
    }
    const invitation = admission.invitations.find(value => value.participantId === participantId)
    if (invitation?.endpoint.kind !== 'human' || invitation.manifestFingerprint !== fingerprintChannelManifest(channel.manifest)) {
      throw new TeamError('Product human endpoint invitation does not match its manifest', 'TEAM_INVALID_ARGUMENT')
    }
    const humanActors = ctx.get('teamHumanActors')
    const teams = ctx.get('teams')
    if (humanActors === undefined || teams === undefined) throw new TeamError('Authenticated human endpoint provider is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
    const input = { channelId: manifest.channelId, revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint,
      idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`principal:${String(call.principal.id)}:${String(manifest.channelId)}:${invitation.revision}`) }
    await humanActors.withProof({ ...call, signal: combined }, { teamId: manifest.teamId, operation: 'channel-open',
      fence: { kind: 'revision', revision: input.revision }, payload: jsonObjectSchema.parse(input) },
    async (actor) => { await teams.acknowledgeChannelInvitation({ actor, ...input }) })
  }
}

/**
 * Resolve human basic-protocol text using authoritative turn and request metadata.
 * @param ctx - Team provider and authenticated human proof issuer.
 * @param call - Current product call, including revocation and cancellation.
 * @param own - The current principal's discovered channel invitation.
 * @param input - One text block and explicit delivery/audience selection.
 * @returns A protocol-valid draft whose consult causation comes from the retained request.
 */
export async function resolvePrincipalChannelText(
  ctx: Context, call: AuthenticatedProductCall, own: ChannelHumanInvitationSnapshot,
  input: {
    readonly text: string
    readonly delivery: TeamEnvelopeDraft['delivery']
    readonly audience: TeamEnvelopeDraft['audience']
    readonly idempotencyKey?: ChannelPostIdempotencyKey | undefined
    readonly causationId?: TeamEnvelopeDraft['causationId']
    readonly taskId?: TeamEnvelopeDraft['taskId']
  },
): Promise<TeamEnvelopeDraft> {
  const teams = ctx.get('teams')
  const actors = ctx.get('teamHumanActors')
  if (teams === undefined || actors === undefined) throw new TeamError('Authenticated human endpoint provider is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
  const retrying = input.idempotencyKey !== undefined
  if (own.invitation.status !== 'acknowledged' || (!retrying && own.channel.phase !== 'active')) {
    throw new TeamError('Channel text requires an acknowledged active invitation', 'TEAM_INVALID_ARGUMENT')
  }
  const manifest = own.channel.manifest
  const selection = { teamId: manifest.teamId, channelId: manifest.id }
  const status: ChannelHumanAdmissionSnapshot = await actors.withProof(call, { teamId: manifest.teamId,
    operation: 'channel-admission-read', fence: { kind: 'read' }, payload: jsonObjectSchema.parse(selection) },
  actor => teams.getHumanChannelAdmission({ actor, ...selection }))
  const senderId = own.invitation.participantId
  if (!retrying && (status.channel.phase !== 'active'
    || (status.expectedNext.kind === 'participant' && status.expectedNext.participantId !== senderId))) {
    throw new TeamError('The channel is not awaiting this participant', 'TEAM_INVALID_ARGUMENT')
  }
  if (status.protocolStatus.kind === 'consult') {
    let draft: TeamEnvelopeDraft
    try {
      draft = resolveConsultTextDraft({ manifest, senderId, text: input.text, delivery: input.delivery,
        audience: input.audience, request: status.protocolStatus.request })
    } catch (cause: unknown) {
      throw new TeamError('Consult text does not match the current ordinary request or response', 'TEAM_INVALID_ARGUMENT', { cause })
    }
    if ((input.causationId !== undefined && input.causationId !== draft.causationId)
      || (draft.kind === 'response' && input.taskId !== undefined && input.taskId !== draft.taskId)) {
      throw new TeamError('Consult routing conflicts with the retained request', 'TEAM_INVALID_ARGUMENT')
    }
    return { ...draft, ...draft.kind === 'request' && input.taskId !== undefined ? { taskId: input.taskId } : {} }
  }
  if (status.protocolStatus.kind === 'discussion') {
    const discussion = parseDiscussionChannelManifest(manifest)
    const peers = discussion.participantIds.filter(id => id !== senderId)
    if (input.text.trim().length === 0 || input.delivery === 'steer' || (input.audience !== null
      && (input.audience.length !== peers.length || !peers.every(id => input.audience?.includes(id))))) {
      throw new TeamError('Discussion text requires nonempty text, all peers and non-steer delivery', 'TEAM_INVALID_ARGUMENT')
    }
    return { channelId: manifest.id, kind: 'message', payload: { text: input.text }, audience: peers, delivery: input.delivery,
      ...input.causationId === undefined ? {} : { causationId: input.causationId },
      ...input.taskId === undefined ? {} : { taskId: input.taskId } }
  }
  throw new TeamError('Text input requires a supported direct, consult or discussion channel', 'TEAM_INVALID_ARGUMENT')
}
