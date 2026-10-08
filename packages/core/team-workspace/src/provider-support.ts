/** Provider-independent Team workspace ownership operations. */
import { TeamError, sameActivationBinding } from '@clocky/clocky-team'
import { parseTeamWorkspaceChangeSet } from './change-set.ts'
import type { TeamWorkspaceChangeSet } from './change-set.ts'
import type { ActivationBindingSnapshot, ParticipantSnapshot, TeamRuntime, TaskAttemptId, TeamStateSnapshot, TeamTaskSnapshot, TeamTaskWorkspaceMode, JsonObject } from '@clocky/clocky-team'
import type { TeamWorkspaceAllocation, TeamWorkspacePreparation, TeamWorkspaceAllocationMetadata, TeamWorkspacePrepareRequest, TeamWorkspaceSourceIntegrateRequest } from './types.ts'

/** Stable allocation key over the exact attempt, assigned revision, Participant and activation.
 * @param request - Complete ownership tuple.
 * @returns the collision-free serialized tuple.
 */
export function teamWorkspaceAllocationKey(request: Pick<TeamWorkspacePrepareRequest, 'teamId' | 'taskId' | 'attemptId' | 'assignedRevision' | 'participantId' | 'activationId' | 'sessionId'>): string {
  return JSON.stringify([
    request.teamId,
    request.taskId,
    request.attemptId,
    request.assignedRevision,
    request.participantId,
    request.activationId,
    request.sessionId,
  ])
}

/** Narrow a live local Participant accepted by workspace providers.
 * @param participant - Current Team membership, possibly absent.
 * @returns whether local Agent allocation is permitted by membership phase.
 */
export function isActiveWorkspaceLocalAgent(participant: ParticipantSnapshot | undefined): participant is ParticipantSnapshot {
  return participant?.kind === 'local-agent' && participant.phase === 'active'
}

/** Test the activation phases that permit workspace allocation.
 * @param binding - Current placement binding.
 * @returns whether its Agent is idle or running.
 */
export function isWorkspaceActivationDeliverable(binding: ActivationBindingSnapshot): boolean {
  return binding.activation.status === 'idle' || binding.activation.status === 'running'
}

/** Compare allocation ownership, provider, mode and base version independently of execution-world identity.
 * @param left - Durable or existing allocation metadata.
 * @param right - Expected allocation metadata.
 * @returns whether the common metadata fields match.
 */
export function sameTeamWorkspaceBaseMetadata(left: TeamWorkspaceAllocationMetadata, right: TeamWorkspaceAllocationMetadata): boolean {
  return left.id === right.id
    && left.provider === right.provider
    && left.mode === right.mode
    && left.teamId === right.teamId
    && left.taskId === right.taskId
    && left.attemptId === right.attemptId
    && left.assignedRevision === right.assignedRevision
    && left.participantId === right.participantId
    && left.activationId === right.activationId
    && left.sessionId === right.sessionId
    && left.baseVersion === right.baseVersion
}

/** Serialize integration operations independently for each provider-owned target. */
export class TeamWorkspaceIntegrationQueue {
  private readonly targets = new Map<string, Promise<void>>()

  /** Execute after all earlier operations on the same target settle, even when one rejects.
   * @param target - Provider-owned integration target identity.
   * @param operation - Integration transaction, including its version and recovery checks.
   * @returns the transaction's result; errors propagate after releasing the next operation.
   */
  async run<T>(target: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.targets.get(target) ?? Promise.resolve()
    const { promise, resolve } = Promise.withResolvers<void>()
    this.targets.set(target, promise)
    await prior
    try {
      return await operation()
    } finally {
      resolve()
      if (this.targets.get(target) === promise) this.targets.delete(target)
    }
  }
}

/** Validate a provider source-integration identity before policy or artifact reads.
 * @param request - Source attempt, consuming integration attempt and target.
 * @param subject - Provider label used by its existing rejection messages.
 */
export function assertTeamWorkspaceSourceIntegration(request: TeamWorkspaceSourceIntegrateRequest, subject: string): void {
  if ([request.source.teamId, request.source.taskId, request.source.attemptId, request.integrationTaskId, request.integrationAttemptId]
    .some(id => String(id).length === 0)) {
    throw new TeamError(`${subject} source integration identities must be non-empty`, 'TEAM_INVALID_ARGUMENT')
  }
  if (request.target.length === 0 || request.target.trim() !== request.target) {
    throw new TeamError(`${subject} integration target must be non-empty without surrounding whitespace`, 'TEAM_INVALID_ARGUMENT')
  }
}

/** Authorize the exact source and consuming attempt before any provider integration effects.
 * @param teams - Team authority that owns workspace policy admission.
 * @param request - Durable source provenance, consuming attempt and target.
 * @param provider - Optional provider fact included by portable change-set providers.
 * @returns policy admission; denial rejects with the existing Team policy error.
 */
export async function authorizeTeamWorkspaceSourceIntegration(
  teams: Pick<TeamRuntime, 'authorize'>,
  request: TeamWorkspaceSourceIntegrateRequest,
  provider?: string,
): Promise<void> {
  const decision = await teams.authorize({
    hook: 'workspace-integrate',
    teamId: request.source.teamId,
    ...request.actorId === undefined ? {} : { actorId: request.actorId },
    facts: {
      operation: 'source-integration',
      sourceTaskId: request.source.taskId,
      sourceAttemptId: request.source.attemptId,
      integrationTaskId: request.integrationTaskId,
      integrationAttemptId: request.integrationAttemptId,
      target: request.target,
      ...request.expectedTarget === undefined ? {} : { expectedTarget: request.expectedTarget },
      mode: request.mode,
      ...provider === undefined ? {} : { provider },
    },
  })
  if (decision.kind === 'deny') throw new TeamError(decision.message, 'TEAM_POLICY_DENIED')
}

/** Decode and validate bytes from a provider-backed portable source patch artifact.
 * @param bytes - Artifact bytes, already read through the provider-owned store.
 * @param provider - Expected change-set producer.
 * @param attemptId - Exact source attempt.
 * @param maxBytes - Configured aggregate decoding bound.
 * @param subject - Existing provider label for malformed JSON rejection.
 * @returns the validated bounded change set.
 */
export function decodeTeamWorkspaceChangeSet(
  bytes: Uint8Array, provider: string, attemptId: TaskAttemptId, maxBytes: number, subject: string,
): TeamWorkspaceChangeSet {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error: unknown) {
    throw new TeamError(`${subject} source patch artifact is not valid JSON`, 'TEAM_INVALID_ARGUMENT', { cause: error })
  }
  return parseTeamWorkspaceChangeSet(parsed, provider, attemptId, maxBytes)
}

/** Immutable operation identity shared by local and remote source-integration recovery markers. */
export interface TeamWorkspaceIntegrationIdentity {
  readonly provider: string
  readonly sourceTaskId: string
  readonly sourceAttemptId: string
  readonly integrationTaskId: string
  readonly integrationAttemptId: string
  readonly target: string
}

/** Common recovery-marker header; providers retain their prepared/integrated payloads. */
export interface TeamWorkspaceIntegrationMarkerBase extends TeamWorkspaceIntegrationIdentity {
  readonly version: 1
  readonly expectedVersion: string
}

/** Capture one exact source/consumer/target identity for a recovery marker.
 * @param request - Current source-integration operation.
 * @param provider - Owning workspace provider.
 * @returns provider-independent marker identity fields.
 */
export function teamWorkspaceIntegrationIdentity(
  request: TeamWorkspaceSourceIntegrateRequest, provider: string,
): TeamWorkspaceIntegrationIdentity {
  return {
    provider,
    sourceTaskId: String(request.source.taskId),
    sourceAttemptId: String(request.source.attemptId),
    integrationTaskId: String(request.integrationTaskId),
    integrationAttemptId: String(request.integrationAttemptId),
    target: request.target,
  }
}

/** Match a recovery marker to one exact source-integration operation.
 * @param marker - Validated provider-owned marker identity.
 * @param request - Current integration operation.
 * @param provider - Expected provider.
 * @returns whether the marker belongs to this exact operation.
 */
export function sameTeamWorkspaceIntegrationMarker(
  marker: TeamWorkspaceIntegrationIdentity, request: TeamWorkspaceSourceIntegrateRequest, provider: string,
): boolean {
  const expected = teamWorkspaceIntegrationIdentity(request, provider)
  return (Object.keys(expected) as (keyof TeamWorkspaceIntegrationIdentity)[]).every(key => marker[key] === expected[key])
}

/** Validate the shared fields before providers inspect their recovery-specific payloads.
 * @param value - Parsed durable recovery marker.
 * @returns whether version, ownership fields and expected target version are well-formed.
 */
export function isTeamWorkspaceIntegrationMarkerBase(value: unknown): value is TeamWorkspaceIntegrationMarkerBase {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.version === 1 && ['provider', 'sourceTaskId', 'sourceAttemptId', 'integrationTaskId', 'integrationAttemptId', 'target', 'expectedVersion']
    .every(key => typeof record[key] === 'string')
}

/** Provider-local reservation and single-flight materialization ownership. */
export class TeamWorkspaceReservationRegistry {
  /** Root-less reservations addressable until their provider abandons or releases them. */
  readonly preparations = new Map<string, TeamWorkspacePreparation>()
  /** Reuse a reservation before performing provider-specific metadata IO.
   * @param key - Exact ownership tuple, after the provider's current-lease check.
   * @param create - Synchronous or asynchronous provider reservation construction.
   * @returns the current reservation or the construction result without an additional await.
   */
  reuseOrCreate<Result extends TeamWorkspacePreparation | Promise<TeamWorkspacePreparation>>(
    key: string, create: () => Result,
  ): TeamWorkspacePreparation | Result {
    return this.preparations.get(key) ?? create()
  }

  /** Mint a root-less reservation; the provider performs its initial current-lease validation first.
   * @param key - Exact attempt ownership tuple.
   * @param metadata - Validated deterministic provider allocation metadata.
   * @param materialize - Provider operation that revalidates its lease and materializes its root.
   * @param abandonedMessage - Existing provider rejection after explicit abandonment.
   * @param onAbandon - Optional provider-local sidecar or root-reference cleanup.
   * @returns the frozen reservation registered under the key.
   */
  reserve(
    key: string, metadata: TeamWorkspaceAllocationMetadata,
    materialize: () => Promise<TeamWorkspaceAllocation>, abandonedMessage: string,
    onAbandon?: () => void,
  ): TeamWorkspacePreparation {
    let abandoned = false
    const preparation: TeamWorkspacePreparation = Object.freeze({
      ...metadata,
      materialize: async (): Promise<TeamWorkspaceAllocation> => {
        if (abandoned) throw new TeamError(abandonedMessage, 'TEAM_INVALID_ARGUMENT')
        return await materialize()
      },
      abandon: (): Promise<void> => {
        if (abandoned) return Promise.resolve()
        abandoned = true
        if (this.preparations.get(key) === preparation) this.preparations.delete(key)
        onAbandon?.()
        return Promise.resolve()
      },
    })
    this.preparations.set(key, preparation)
    return preparation
  }

}

/** Single-flight physical creation layered onto provider-local reservations. */
export class TeamWorkspaceReservations extends TeamWorkspaceReservationRegistry {
  /** Materialized allocations retained until exact provider release. */
  readonly allocations = new Map<string, TeamWorkspaceAllocation>()
  /** In-flight physical creation, shared by concurrent callers of one reservation. */
  readonly materializations = new Map<string, Promise<TeamWorkspaceAllocation>>()

  /** Reserve a provider root with current-lease revalidation and shared physical-creation ownership.
   * @param key - Exact reservation identity.
   * @param metadata - Provider-owned immutable allocation metadata.
   * @param validate - Current Team and live-root validation before each materialization.
   * @param create - Provider-specific physical allocation operation.
   * @param abandonedMessage - Existing provider diagnosis after abandonment.
   * @param onMaterialized - Optional execution-world observation startup after publication.
   * @param onAbandon - Optional provider-owned logical-root cleanup.
   * @returns the frozen reservation whose materialization stays single-flight.
   */
  reserveMaterialized(
    key: string, metadata: TeamWorkspaceAllocationMetadata, validate: () => Promise<unknown>,
    create: () => Promise<TeamWorkspaceAllocation>, abandonedMessage: string,
    onMaterialized?: () => void, onAbandon?: () => void,
  ): TeamWorkspacePreparation {
    return this.reserve(key, metadata, async () => {
      await validate()
      return await this.materialize(key, create, onMaterialized)
    }, abandonedMessage, onAbandon)
  }

  /** Share physical allocation creation after the provider's current-lease check.
   * @param key - Exact reservation key.
   * @param materialize - Provider filesystem operation.
   * @param onMaterialized - Optional loss-observation startup after allocation publication.
   * @returns the retained allocation or current creation operation.
   */
  async materialize(
    key: string, materialize: () => Promise<TeamWorkspaceAllocation>, onMaterialized?: () => void,
  ): Promise<TeamWorkspaceAllocation> {
    const current = this.allocations.get(key)
    if (current !== undefined) return current
    const pending = this.materializations.get(key)
    if (pending !== undefined) return await pending
    const materialization = materialize().then((allocation) => {
      this.allocations.set(key, allocation)
      onMaterialized?.()
      return allocation
    })
    this.materializations.set(key, materialization)
    try {
      return await materialization
    } finally {
      if (this.materializations.get(key) === materialization) this.materializations.delete(key)
    }
  }
}

/** Verify current Team, lease, local membership and activation ownership before provider-specific live-root checks.
 * @param state - Current authoritative Team projection.
 * @param request - Exact task-attempt ownership tuple.
 * @param mode - Workspace mode implemented by the calling provider.
 * @returns the current deliverable binding, or a Team invalid-argument rejection naming its failed fence.
 */
export function assertCurrentTeamWorkspaceOwner(
  state: TeamStateSnapshot, request: TeamWorkspacePrepareRequest, mode: TeamTaskWorkspaceMode,
): ActivationBindingSnapshot {
  const task = state.tasks.find(candidate => candidate.id === request.taskId)
  const subject = mode === 'shared' ? 'shared workspace' : mode
  requireWorkspaceOwner(task !== undefined, `Team task '${request.taskId}' is not available for ${subject} allocation`)
  requireWorkspaceOwner(state.team.phase === 'active', `Team '${request.teamId}' is not active for ${subject} allocation`)
  requireWorkspaceOwner(task.workspaceMode === mode, `Team task '${task.id}' does not request a ${mode} workspace`)
  requireWorkspaceOwner(task.phase === 'assigned' || task.phase === 'running', mode === 'shared' || mode === 'worktree'
    ? `Team task '${task.id}' does not hold an active ${subject} lease`
    : `Team task '${task.id}' has no active ${subject} lease`)
  const lease = task.lease
  requireWorkspaceOwner(lease !== undefined, `Team task '${task.id}' has no current ${subject} lease`)
  requireWorkspaceOwner(lease.expiresAt > Date.now(), `Team task '${task.id}' current lease has expired`)
  requireWorkspaceOwner(lease.attemptId === request.attemptId, `Team task '${task.id}' attempt does not match ${mode} allocation`)
  requireWorkspaceOwner(lease.assignedRevision === request.assignedRevision, `Team task '${task.id}' assigned revision does not match ${mode} allocation`)
  requireWorkspaceOwner(lease.participantId === request.participantId, `Team task '${task.id}' participant does not match ${mode} allocation`)
  requireWorkspaceOwner(lease.activationId === request.activationId, `Team task '${task.id}' activation does not match ${mode} allocation`)
  const participant = state.participants.find(candidate => candidate.id === request.participantId)
  requireWorkspaceOwner(isActiveWorkspaceLocalAgent(participant), `Team participant '${request.participantId}' is not an active local Agent`)
  const binding = state.activations.find(candidate => candidate.activation.id === request.activationId)
  requireWorkspaceOwner(binding !== undefined && binding.activation.teamId === request.teamId
    && binding.activation.participantId === request.participantId && binding.sessionId === request.sessionId
    && isWorkspaceActivationDeliverable(binding),
  `Team activation '${request.activationId}' does not match ${mode} allocation ownership`)
  return binding
}

/** Compare scheduler-observed task and activation facts against the current Team projection.
 * @param state - Current authoritative Team state.
 * @param task - Scheduler candidate task revision.
 * @param binding - Scheduler candidate placement identity.
 * @param mode - Workspace mode implemented by the provider.
 * @returns whether protocol eligibility still holds; providers separately verify live execution-root access.
 */
export function isCurrentTeamWorkspaceCandidate(
  state: TeamStateSnapshot, task: TeamTaskSnapshot, binding: ActivationBindingSnapshot, mode: TeamTaskWorkspaceMode,
): boolean {
  const currentTask = state.tasks.find(candidate => candidate.id === task.id)
  const participant = state.participants.find(candidate => candidate.id === binding.activation.participantId)
  const currentBinding = state.activations.find(candidate => candidate.activation.id === binding.activation.id)
  return state.team.phase === 'active' && currentTask?.revision === task.revision && currentTask.workspaceMode === mode
    && isActiveWorkspaceLocalAgent(participant) && currentBinding !== undefined
    && sameActivationBinding(currentBinding, binding) && isWorkspaceActivationDeliverable(currentBinding)
}

/** Authorize allocation after protocol and provider live-root fences pass.
 * @param teams - Owning Team authority.
 * @param request - Exact validated allocation tuple.
 * @param mode - Calling provider's supported workspace mode.
 * @param facts - Provider-owned root and deployment facts, excluding the common ownership tuple.
 * @returns policy admission, or the existing Team policy denial.
 */
export async function authorizeTeamWorkspaceAllocation(
  teams: Pick<TeamRuntime, 'authorize'>, request: TeamWorkspacePrepareRequest, mode: TeamTaskWorkspaceMode, facts: JsonObject,
): Promise<void> {
  const decision = await teams.authorize({ hook: 'workspace-allocate', teamId: request.teamId, actorId: request.participantId,
    facts: { taskId: request.taskId, attemptId: request.attemptId, assignedRevision: request.assignedRevision,
      participantId: request.participantId, activationId: request.activationId, sessionId: request.sessionId,
      workspaceMode: mode, ...facts } })
  if (decision.kind === 'deny') throw new TeamError(decision.message, 'TEAM_POLICY_DENIED')
}

/** Preserve the provider's exact failed-fence diagnosis. */
function requireWorkspaceOwner(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TeamError(message, 'TEAM_INVALID_ARGUMENT')
}

/** Validate the common envelope before a provider checks its manifest payload and allocation provenance.
 * @param value - Parsed provider-owned durable manifest.
 * @param version - Exact on-disk format accepted by that provider.
 * @returns whether the version and object-valued metadata header are present; metadata fields remain provider-validated.
 */
export function isStoredTeamWorkspaceManifestHeader(
  value: unknown, version: number,
): value is { readonly version: number; readonly metadata: object } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.version === version && typeof record.metadata === 'object' && record.metadata !== null
}

/** Serialize exact source/consumer/target identity for provider-owned recovery marker naming.
 * @param request - Current source-integration operation.
 * @param provider - Owning workspace provider.
 * @returns the stable ordered tuple; providers retain their hash and disk-path conventions.
 */
export function teamWorkspaceIntegrationKey(request: TeamWorkspaceSourceIntegrateRequest, provider: string): string {
  return JSON.stringify(Object.values(teamWorkspaceIntegrationIdentity(request, provider)))
}
