import { worldDecisionSource } from '@clocky/clocky-simulation'
/** Original identity cleanup uses Team owners before either Native domain can release its reservation. */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import { activeSimulationMaintenance, SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot, SimulationWorldHireReservation, SimulationWorldIdentityCleanupEvidence,
  SimulationWorldHireIdentities, SimulationWorldHireReserveRequest, SimulationExternalRepresentativeReservation,
  SimulationExternalContact, SimulationExternalContactCleanupEvidence, SimulationChannelSpec, SimulationChannelKey } from '@clocky/clocky-simulation'
import { TeamError, fingerprintChannelManifest } from '@clocky/clocky-team'
import type { TeamId, TeamStateSnapshot, ChannelAdmissionSnapshot, ChannelId, ChannelInvitationSnapshot, ChannelPhase } from '@clocky/clocky-team'
import type { SimulationParticipantAuthority } from './participants.ts'
import type { SimulationChannelAuthority } from './channels.ts'
import type { SimulationInvitationAuthority } from './invitation.ts'

/** Shared immutable topology input; each domain separately verifies its authoritative cancellation book. */
export interface WorldIdentityCleanupSelection {
  readonly identities: SimulationWorldHireIdentities
  readonly request: SimulationWorldHireReserveRequest
}

/** One original Channel source, independent of whether its domain owns a new person or an existing representative. */
export interface WorldChannelCleanupSelection {
  readonly key: SimulationChannelKey
  readonly channelId: ChannelId
  readonly spec: SimulationChannelSpec
}

/** Exact retained lease selected before Team IO; its original status and revision remain fenced until Native append. */
type ContactKeeper = Extract<SimulationExternalContactCleanupEvidence, { readonly kind: 'retained' }>['keeper']

function contactLeaseKey(contact: SimulationExternalContact) {
  return { identityId: contact.identityId, representativeIntentId: contact.representativeIntentId,
    requesterEntityId: contact.requesterEntityId, generation: contact.generation, channel: contact.channel }
}

/**
 * Select another live original lease without moving representative, Session or task responsibility.
 * @param state - Authoritative contact book.
 * @param contact - Original cancelled per-caller lease.
 * @returns stable keeper identity/revision/status, or absence when this Channel has no other live lease.
 */
export function externalContactKeeper(state: SimulationSnapshot, contact: SimulationExternalContact): ContactKeeper | undefined {
  for (const candidate of Object.values(state.world?.external.contacts ?? {}).sort((a, b) =>
    a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (candidate.id === contact.id || candidate.status !== 'reserved' && candidate.status !== 'committed'
      || !isDeepStrictEqual(contactLeaseKey(candidate), contactLeaseKey(contact))) continue
    return { id: candidate.id, sequence: candidate.updatedSequence, status: candidate.status }
  }
  return undefined
}

/**
 * Derive only the cancelled contact's original canonical endpoints.
 * @param state - Authoritative original representative and binding book.
 * @param contact - Original per-caller Channel allocation.
 * @returns one exact Channel source and its immutable endpoint roles.
 */
export function externalContactCleanupChannel(state: SimulationSnapshot, contact: SimulationExternalContact): WorldChannelCleanupSelection {
  const representative = state.world?.external.representatives[contact.representativeIntentId]
  if (representative === undefined || representative.identityId !== contact.identityId) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact cleanup lost its original representative generation')
  }
  return { ...contact.channel, spec: { key: contact.channel.key, limits: {}, members: [
    { entityId: representative.identities.entityId, role: 'member' }, { entityId: contact.requesterEntityId, role: 'requester' },
  ] } }
}

/**
 * Admit only the original contact cancellation under its own frozen maintenance request.
 * @param run - Authoritative source retaining this lease.
 * @param contact - Original cancellation, caller, generation and Channel.
 * @param checkAdmission - Current connection/checkpoint lifetime around cleanup IO.
 */
export function assertExternalContactCleanup(run: SimulationRun, contact: SimulationExternalContact, checkAdmission: () => void): void {
  checkAdmission()
  const state = run.snapshot(), current = state.world?.external.contacts[contact.id]
  const request = state.world?.requests[contact.requestId], maintenance = activeSimulationMaintenance(state)
  const representative = state.world?.external.representatives[contact.representativeIntentId]
  const actor = representative === undefined ? undefined : state.entities[representative.identities.entityId]
  if (current?.status !== 'cancel-requested' || request?.status !== 'cancel-requested'
    || current.id !== contact.id || current.requestId !== contact.requestId || request.intentId !== contact.id
    || current.planId !== contact.planId || !isDeepStrictEqual(contactLeaseKey(current), contactLeaseKey(contact))
    || contact.cancellation === undefined || !isDeepStrictEqual(current.cancellation, contact.cancellation)
    || state.phase !== 'paused' || maintenance?.status !== 'quiescent'
    || !isDeepStrictEqual(maintenance.request, contact.cancellation.maintenance)
    || state.activeWindowId !== undefined || state.activeDecisionId !== undefined
    || Object.values(state.entities).some(entity => entity.writer !== undefined && entity.writer.phase !== 'released')
    || representative?.status !== 'committed' || representative.identityId !== contact.identityId
    || !isDeepStrictEqual(actor?.binding, representative.identities.binding)
    || !isDeepStrictEqual(state.entities[contact.requesterEntityId]?.binding, worldDecisionSource(request).binding)) {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Contact cleanup requires its original cancelled lease and quiescent maintenance owner')
  }
}

function assertContactKeeper(state: SimulationSnapshot, contact: SimulationExternalContact, keeper: ContactKeeper | undefined): void {
  if (keeper === undefined) {
    if (externalContactKeeper(state, contact) !== undefined) {
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Contact cleanup acquired another original Channel lease')
    }
    return
  }
  const current = state.world?.external.contacts[keeper.id]
  if (current === undefined || current.id === contact.id || current.updatedSequence !== keeper.sequence || current.status !== keeper.status
    || !isDeepStrictEqual(contactLeaseKey(current), contactLeaseKey(contact))) {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Contact cleanup retained lease changed during original IO')
  }
}

/**
 * Verify immutable Channel metadata and complete Session endpoint consent independently of current phase.
 * @param state - Authoritative Native Channel and permanent binding projection.
 * @param selected - Exact original single-Channel source.
 * @param admission - Actual current or original-prefix Channel/endpoint observation.
 * @param teamId - Canonical execution Team.
 */
export function assertWorldChannelAdmission(state: SimulationSnapshot, selected: WorldChannelCleanupSelection,
  admission: ChannelAdmissionSnapshot, teamId: TeamId): void {
  const reserved = state.channelReservations?.[selected.key]
  const endpoints = selected.spec.members.map(member => ({ binding: state.entities[member.entityId]?.binding, role: member.role }))
  const manifest = admission.channel.manifest
  if (reserved?.channelId !== selected.channelId || !isDeepStrictEqual(reserved.spec, selected.spec)
    || endpoints.some(value => value.binding?.teamId !== teamId)
    || manifest.teamId !== teamId || manifest.id !== selected.channelId
    || manifest.adapter.type !== 'direct' || manifest.adapter.version !== 4
    || !isDeepStrictEqual(manifest.limits, selected.spec.limits)
    || !isDeepStrictEqual(manifest.participants, endpoints.map(value => ({ id: value.binding?.participantId, role: value.role })))
    || admission.invitations.length !== endpoints.length
    || endpoints.some(value => !admission.invitations.some(invitation => invitation.participantId === value.binding?.participantId
      && invitation.role === value.role
      && invitation.endpoint.kind === 'activation' && invitation.endpoint.sessionId === value.binding.sessionId
      && invitation.endpoint.activationId === undefined && invitation.required
      && invitation.manifestFingerprint === fingerprintChannelManifest(manifest)))) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cleanup Channel differs from its original canonical endpoints')
  }
}

/**
 * Release only an unleased contact Channel, or retain it under the exact original keeper snapshot.
 * @param ctx - Authoritative Team reader; storage and provider failures propagate.
 * @param run - Original cancelled Native contact and frozen maintenance owner.
 * @param contact - Exact original per-caller contact allocation.
 * @param teamId - Canonical execution Team.
 * @param lifecycleOwner - Original attached owner source.
 * @param channels - Original accepted Channel preparation/closure owner.
 * @param invitations - Accepted endpoint consent IO owner.
 * @param checkAdmission - Connection/checkpoint lifetime around all IO.
 * @returns terminal source proof or precise retained lease proof; no Actor, Participant or Session is retired.
 */
export async function cleanupExternalContact(ctx: Context, run: SimulationRun, contact: SimulationExternalContact,
  teamId: TeamId, lifecycleOwner: string, channels: SimulationChannelAuthority, invitations: SimulationInvitationAuthority,
  checkAdmission: () => void): Promise<SimulationExternalContactCleanupEvidence> {
  assertExternalContactCleanup(run, contact, checkAdmission)
  await Promise.all([channels.drain(run), invitations.drain(run)])
  assertExternalContactCleanup(run, contact, checkAdmission)
  const selected = externalContactCleanupChannel(run.snapshot(), contact), keeper = externalContactKeeper(run.snapshot(), contact)
  const check = () => {
    assertExternalContactCleanup(run, contact, checkAdmission)
    assertContactKeeper(run.snapshot(), contact, keeper)
  }
  check()
  const team = await ctx.teams.getTeam({ teamId })
  check()
  if (team.rules['simulationRunId'] !== run.snapshot().spec.runId || team.rules['activationLifecycleOwner'] !== lifecycleOwner) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact cleanup no longer has its original canonical Team owner')
  }
  if (keeper !== undefined) {
    const admission = await channels.inspectWorldChannel(run, selected, teamId, check)
    check()
    let observed: Extract<SimulationExternalContactCleanupEvidence, { readonly kind: 'retained' }>['channel']
    if (admission === undefined) observed = { phase: 'absent', channelId: selected.channelId }
    else {
      const { phase, cursor } = admission.channel
      if (phase !== 'pending' && phase !== 'active') {
        throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Retained contact Channel has unknown or terminal lifecycle responsibility')
      }
      observed = { phase, channelId: selected.channelId, cursor }
    }
    const latest = await ctx.teams.getTeam({ teamId })
    check()
    return { kind: 'retained', keeper, teamCursor: latest.team.cursor, channel: observed }
  }
  const channel = await channels.closeWorldChannel(run, selected, teamId, lifecycleOwner, check, 'World external contact cancelled')
  check()
  const latest = await ctx.teams.getTeam({ teamId })
  check()
  let observed: Extract<SimulationExternalContactCleanupEvidence, { readonly kind: 'terminal' }>['channel']
  if (channel === undefined) observed = { phase: 'absent', channelId: selected.channelId }
  else {
    const { phase, cursor } = channel
    if (phase !== 'closed' && phase !== 'expired' && phase !== 'failed') {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact cleanup lacks its exact terminal Channel')
    }
    observed = { phase, channelId: selected.channelId, cursor }
  }
  return { kind: 'terminal', teamCursor: latest.team.cursor, channel: observed }
}

/**
 * Check original cancellation ownership around each target IO and its proof validation.
 * @param run - Authoritative run; no ordinary execution may coexist with cleanup.
 * @param reservation - Original immutable preparation whose effects are being reconciled.
 * @param checkAdmission - Connection lifetime and checkpoint admission check.
 */
export function assertWorldHireCleanup(run: SimulationRun, reservation: SimulationWorldHireReservation, checkAdmission: () => void): void {
  checkAdmission()
  const state = run.snapshot(), owner = activeSimulationMaintenance(state)
  const current = state.world?.reservations[reservation.id], request = state.world?.requests[reservation.requestId]
  if (current?.status !== 'cancel-requested' || request?.status !== 'cancel-requested'
    || current.id !== reservation.id || current.requestId !== reservation.requestId || request.intentId !== reservation.id
    || !isDeepStrictEqual(current.identities, reservation.identities) || !isDeepStrictEqual(current.request, reservation.request)
    || state.phase !== 'paused' || owner?.status !== 'quiescent' || !isDeepStrictEqual(owner.request, reservation.request.maintenance)
    || state.activeWindowId !== undefined || state.activeDecisionId !== undefined
    || Object.values(state.entities).some(entity => entity.writer !== undefined && entity.writer.phase !== 'released')) {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World cleanup requires its original cancelled hire and quiescent maintenance owner')
  }
}

/**
 * Check the original external cancellation without borrowing the generated-hire reservation book.
 * @param run - Authoritative run retaining the representative identity responsibility.
 * @param reservation - Original external identity/generation, case and immutable topology input.
 * @param checkAdmission - Connection/checkpoint lifetime checked around all cleanup IO.
 */
export function assertExternalRepresentativeCleanup(run: SimulationRun, reservation: SimulationExternalRepresentativeReservation,
  checkAdmission: () => void): void {
  checkAdmission()
  const state = run.snapshot(), owner = activeSimulationMaintenance(state)
  const current = state.world?.external.representatives[reservation.id], request = state.world?.requests[reservation.requestId]
  if (current?.status !== 'cancel-requested' || request?.status !== 'cancel-requested'
    || current.id !== reservation.id || current.requestId !== reservation.requestId || request.intentId !== reservation.id
    || current.identityId !== reservation.identityId
    || !isDeepStrictEqual(current.identities, reservation.identities) || !isDeepStrictEqual(current.request, reservation.request)
    || state.phase !== 'paused' || owner?.status !== 'quiescent' || !isDeepStrictEqual(owner.request, reservation.request.maintenance)
    || state.activeWindowId !== undefined || state.activeDecisionId !== undefined
    || Object.values(state.entities).some(entity => entity.writer !== undefined && entity.writer.phase !== 'released')) {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World cleanup requires its original cancelled representative and quiescent maintenance owner')
  }
}

/**
 * Query an exact reserved channel; only an explicit not-found result proves absence after preparation drains.
 * @param ctx - Authoritative Team provider.
 * @param channelId - Original reserved identity; never allocate a replacement.
 * @returns original admission or proven absence; storage/recovery/permission failures propagate.
 */
export async function originalWorldChannel(ctx: Context, channelId: SimulationWorldHireIdentities['channels'][number]['channelId']):
Promise<ChannelAdmissionSnapshot | undefined> {
  try { return await ctx.teams.getChannelAdmission({ channelId }) }
  catch (error: unknown) {
    if (error instanceof TeamError && error.code === 'TEAM_CHANNEL_NOT_FOUND') return undefined
    throw error
  }
}

/**
 * Drain preparation, settle exact target owners and collect immutable absence/terminal evidence without inference.
 * @param ctx - Current authoritative Team and Session providers.
 * @param run - Run retaining cancellation and capacity responsibility.
 * @param reservation - Original newcomer and private channel identities.
 * @param teamId - Canonical execution Team.
 * @param lifecycleOwner - Immutable source name installed by the connection.
 * @param participants - Participant preparation/retirement owner.
 * @param channels - Channel preparation/closure owner.
 * @param invitations - Endpoint consent owner whose accepted IO must drain.
 * @param checkAdmission - Connection/checkpoint liveness, rechecked before and after IO.
 * @returns complete source evidence; unknown IO, active obligations or unexpected materialized Session reject without release.
 */
export async function cleanupWorldHire(ctx: Context, run: SimulationRun, reservation: SimulationWorldHireReservation,
  teamId: TeamId, lifecycleOwner: string, participants: SimulationParticipantAuthority, channels: SimulationChannelAuthority,
  invitations: SimulationInvitationAuthority, checkAdmission: () => void): Promise<SimulationWorldIdentityCleanupEvidence> {
  const check = () => { assertWorldHireCleanup(run, reservation, checkAdmission) }
  return await cleanupWorldIdentity(ctx, run, reservation, teamId, lifecycleOwner, participants, channels, invitations,
    check, 'World hire cancelled')
}

/**
 * Settle only the external book's original cancelled identity through the shared canonical topology owners.
 * @param ctx - Authoritative Team/Session providers.
 * @param run - Original Native run retaining cleanup responsibility.
 * @param reservation - Original external representative allocation; never inserted into the hire book.
 * @param teamId - Canonical execution Team.
 * @param lifecycleOwner - Confirmed source name.
 * @param participants - Canonical Participant preparation/retirement owner.
 * @param channels - Canonical Channel preparation/closure owner.
 * @param invitations - Accepted consent IO owner.
 * @param checkAdmission - Current connection/checkpoint lifetime.
 * @returns exact terminal observations; unknown or unexpected duties reject without release or inference.
 */
export async function cleanupExternalRepresentative(ctx: Context, run: SimulationRun,
  reservation: SimulationExternalRepresentativeReservation, teamId: TeamId, lifecycleOwner: string,
  participants: SimulationParticipantAuthority, channels: SimulationChannelAuthority,
  invitations: SimulationInvitationAuthority, checkAdmission: () => void): Promise<SimulationWorldIdentityCleanupEvidence> {
  const check = () => { assertExternalRepresentativeCleanup(run, reservation, checkAdmission) }
  return await cleanupWorldIdentity(ctx, run, reservation, teamId, lifecycleOwner, participants, channels, invitations,
    check, 'World external representative cancelled')
}

/** One exact topology cleanup; the domain check remains live during every source read and protected target call. */
async function cleanupWorldIdentity(ctx: Context, run: SimulationRun, reservation: WorldIdentityCleanupSelection,
  teamId: TeamId, lifecycleOwner: string, participants: SimulationParticipantAuthority, channels: SimulationChannelAuthority,
  invitations: SimulationInvitationAuthority, check: () => void, reason: 'World hire cancelled' | 'World external representative cancelled'):
Promise<SimulationWorldIdentityCleanupEvidence> {
  check()
  await Promise.all([participants.drain(run), channels.drain(run), invitations.drain(run)])
  check()
  const binding = reservation.identities.binding
  const team = await ctx.teams.getTeam({ teamId })
  check()
  if (binding.teamId !== teamId || team.rules['activationLifecycleOwner'] !== lifecycleOwner
    || team.rules['simulationRunId'] !== run.snapshot().spec.runId
    || team.activations.some(value => value.activation.participantId === binding.participantId || value.sessionId === binding.sessionId)
    || team.participants.find(value => value.id === binding.participantId)?.activationReservation !== undefined
    || team.tasks.some(task => task.lease?.participantId === binding.participantId)
    || ctx.agents.get(binding.sessionId) !== undefined
    || !await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cleanup retains unexpected activation, task or Session responsibility')
  }
  check()
  // Do not close unrelated work to manufacture a clean newcomer. Every attached channel must be accounted for.
  for (const channelId of team.channelIds) {
    const channel = await ctx.teams.getChannel({ channelId })
    if (channel.manifest.participants.some(value => value.id === binding.participantId)
      && !reservation.identities.channels.some(value => value.channelId === channelId)) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cleanup found a newcomer channel outside its original reservation')
    }
    check()
  }
  const observed: SimulationWorldIdentityCleanupEvidence['channels'][number][] = []
  for (const selected of reservation.identities.channels) {
    check()
    const channel = await channels.closeWorldIdentity(run, reservation, selected.channelId, teamId, lifecycleOwner, check, reason)
    if (channel === undefined) observed.push({ phase: 'absent', channelId: selected.channelId })
    else {
      if (channel.phase !== 'closed' && channel.phase !== 'expired' && channel.phase !== 'failed') {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cleanup lacks a terminal channel')
      }
      observed.push({ phase: channel.phase, channelId: selected.channelId, cursor: channel.cursor })
    }
  }
  const member = await participants.retireWorldIdentity(run, reservation, teamId, lifecycleOwner, check)
  check()
  const latest = await ctx.teams.getTeam({ teamId })
  check()
  const first = observed[0], second = observed[1]
  if (first === undefined || second === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cleanup lost an original channel')
  return { binding, teamCursor: latest.team.cursor, participant: member?.phase ?? 'absent', session: 'unmaterialized',
    channels: [first, second] }
}

/**
 * Verify retained cleanup against current durable owners during checkpoint acquisition and writable restore.
 * @param ctx - Authoritative Team/Session providers; errors are never interpreted as absence.
 * @param state - Full accepted Native projection, including original reservations and cleanup records.
 * @param team - Current canonical Team whose protected history is checked by the collector.
 * @param check - Acquisition/restore liveness check around reads.
 * @returns completion without mutation, model calls or historical repair; missing/mismatched evidence rejects.
 */
export async function validateWorldCleanupHistory(ctx: Context, state: SimulationSnapshot, team: TeamStateSnapshot,
  check: () => void): Promise<void> {
  for (const reservation of [...Object.values(state.world?.reservations ?? {}),
    ...Object.values(state.world?.external.representatives ?? {})]) {
    const evidence = reservation.cleanup?.evidence
    if (evidence === undefined) continue
    check()
    const binding = reservation.identities.binding
    const participant = team.participants.find(value => value.id === binding.participantId)
    if (team.team.id !== binding.teamId || team.team.cursor < evidence.teamCursor
      || (participant?.phase ?? 'absent') !== evidence.participant || participant?.activationReservation !== undefined
      || team.activations.some(value => value.activation.participantId === binding.participantId || value.sessionId === binding.sessionId)
      || !await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cleanup history lost its original member or Session evidence')
    }
    check()
    for (const channel of evidence.channels) {
      const current = await originalWorldChannel(ctx, channel.channelId)
      if (channel.phase === 'absent' ? current !== undefined
        : current?.channel.phase !== channel.phase || current.channel.cursor < channel.cursor
          || current.channel.manifest.teamId !== binding.teamId
          || current.invitations.some(value => value.status === 'pending')) {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cleanup history lost its original channel evidence')
      }
      check()
    }
  }
  await validateExternalContactCleanupHistory(ctx, state, team, check)
}

/** Validate a retained observation through bounded original WAL pages; its keeper may legitimately commit or cancel later. */
async function validateRetainedContactPrefix(ctx: Context, state: SimulationSnapshot, selected: WorldChannelCleanupSelection,
  current: ChannelAdmissionSnapshot, observed: Extract<SimulationExternalContactCleanupEvidence, { readonly kind: 'retained' }>['channel'],
  teamId: TeamId, check: () => void): Promise<void> {
  if (observed.phase === 'absent') return
  let after = -1, phase: ChannelPhase | undefined
  const invitations = new Map<string, ChannelInvitationSnapshot>()
  while (after < observed.cursor) {
    check()
    // The provider bounds each page by its configured recoveryPageSize; retain only phase and two endpoint invitations.
    const page = await ctx.teams.readChannelPage({ channelId: selected.channelId, afterCursor: after,
      limit: Math.min(Number.MAX_SAFE_INTEGER, observed.cursor - after) })
    check()
    if (page.channel.firstCursor !== undefined && page.channel.firstCursor !== 0
      || page.channel.cursor < observed.cursor || !isDeepStrictEqual(page.channel.manifest, current.channel.manifest)) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Retained contact observation lost its original Channel prefix')
    }
    let advanced = false
    for (const record of page.records) {
      const sequence = record.type === 'channel/envelope' ? record.envelope.sequence : record.sequence
      if (sequence > observed.cursor) break
      if (sequence !== after + 1) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Retained contact Channel prefix has a sequence gap')
      after = sequence; advanced = true
      if (record.type === 'channel/opened' && !isDeepStrictEqual(record.manifest, current.channel.manifest)) {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Retained contact opening manifest changed its original endpoints')
      }
      if (record.type === 'channel/phase' || record.type === 'channel/closed') phase = record.phase
      if (record.type === 'channel/invitation' || record.type === 'channel/acknowledged' || record.type === 'channel/invitation-ended') {
        invitations.set(record.invitation.participantId, record.invitation)
      }
    }
    if (!advanced) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Retained contact Channel prefix cannot reach its observed cursor')
  }
  if (phase !== observed.phase) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Retained contact observation changed its original phase')
  const consent = [...invitations.values()]
  assertWorldChannelAdmission(state, selected,
    { channel: { ...current.channel, phase, cursor: observed.cursor }, invitations: consent }, teamId)
  if (phase === 'active' && consent.some(value => value.status !== 'acknowledged')) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Retained active contact observation lost its original consent')
  }
}

/** A later commit/cancellation of the keeper advances history; it does not erase the original retained lease snapshot. */
async function validateExternalContactCleanupHistory(ctx: Context, state: SimulationSnapshot, team: TeamStateSnapshot,
  check: () => void): Promise<void> {
  for (const contact of Object.values(state.world?.external.contacts ?? {})) {
    const cleanup = contact.cleanup
    if (cleanup === undefined) continue
    check()
    const evidence = cleanup.evidence, selected = externalContactCleanupChannel(state, contact)
    if (evidence.channel.channelId !== contact.channel.channelId || team.team.cursor < evidence.teamCursor) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact cleanup history changed its original Channel or Team receipt')
    }
    if (evidence.kind === 'retained') {
      const keeper = state.world?.external.contacts[evidence.keeper.id]
      if (keeper === undefined || keeper.id === contact.id || !isDeepStrictEqual(contactLeaseKey(keeper), contactLeaseKey(contact))
        || keeper.sequence > evidence.keeper.sequence || evidence.keeper.sequence > cleanup.sequence
        || keeper.updatedSequence < evidence.keeper.sequence
        || evidence.keeper.status === 'committed' && keeper.status !== 'committed') {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Retained contact cleanup history lost its original keeper snapshot')
      }
    }
    const current = await originalWorldChannel(ctx, selected.channelId)
    check()
    if (current === undefined) {
      if (evidence.channel.phase !== 'absent' || state.channelReservations?.[selected.key]?.confirmed) {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact cleanup history lost a confirmed original Channel')
      }
      continue
    }
    assertWorldChannelAdmission(state, selected, current, team.team.id)
    if (evidence.kind === 'terminal') {
      if (evidence.channel.phase === 'absent' || current.channel.phase !== evidence.channel.phase
        || current.channel.cursor < evidence.channel.cursor || current.invitations.some(value => value.status === 'pending')) {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Terminal contact cleanup history lost its original source evidence')
      }
    } else {
      // A retained absent source may be created later by its original keeper. Existing sources retain their exact old WAL prefix.
      await validateRetainedContactPrefix(ctx, state, selected, current, evidence.channel, team.team.id, check)
    }
    check()
  }
}
