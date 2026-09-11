/**
 * Team Workspace Service Definition: a named provider registry at
 * `ctx.teamWorkspaces`, independent of Team persistence and Agent delivery.
 *
 * @module @clocky/clocky-team-workspace
 */

import { Context, Service } from '@clocky/cordis'
import type { TeamTaskWorkspaceMode } from '@clocky/clocky-team'
import { TeamWorkspaceError } from './error.ts'
import type {
  TeamWorkspaceAllocation,
  TeamWorkspaceAllocationPublisher,
  TeamWorkspaceOwnerPublicationRequest,
  TeamWorkspaceAllocationMetadata,
  TeamWorkspaceEligibilityRequest,
  TeamWorkspacePreflightRequest,
  TeamWorkspacePreparation,
  TeamWorkspacePrepareRequest,
  TeamWorkspaceProvider,
  TeamWorkspaceProviderRef,
  TeamWorkspacePublishRequest,
  TeamWorkspacePublishResult,
  TeamWorkspaceIntegrateRequest,
  TeamWorkspaceIntegrateResult,
  TeamWorkspaceSourceIntegrateRequest,
  TeamWorkspaceSourceIntegrateResult,
} from './types.ts'

export { executeTeamIntegrationTask } from './integration.ts'
export type { TeamIntegrationTaskExecutionRequest } from './integration.ts'
export {
  encodeTeamWorkspaceChangeSet,
  parseTeamWorkspaceChangeSet,
  TEAM_WORKSPACE_CHANGE_SET_VERSION,
} from './change-set.ts'
export type { TeamWorkspaceChange, TeamWorkspaceChangeSet } from './change-set.ts'
export {
  selectTeamWorkspacePatchArtifact,
  teamWorkspaceSourceIntegrationResult,
} from './integration-provenance.ts'

export { TeamWorkspaceError, TeamWorkspaceLostError } from './error.ts'
export type { TeamWorkspaceErrorCode } from './error.ts'
export type * from './types.ts'

declare module '@clocky/cordis' {
  interface Context {
    teamWorkspaces: TeamWorkspaceRegistry
  }
}

const WORKSPACE_MODES: readonly TeamTaskWorkspaceMode[] = ['shared', 'worktree', 'sandbox', 'remote']

/** Named Team execution-root registry. Providers retain all allocation ownership. */
export class TeamWorkspaceRegistry extends Service {
  private readonly allocationPublishers = new WeakMap<object, TeamWorkspaceAllocationPublisher>()
  private readonly providersByName = new Map<string, TeamWorkspaceProvider>()
  private readonly providersByMode = new Map<TeamTaskWorkspaceMode, TeamWorkspaceProvider>()

  /**
   * @param ctx - Cordis context that owns this registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'teamWorkspaces')
  }

  /**
   * Register one provider for one or more exact workspace modes. Registration
   * is effect-scoped; disposing it removes only this provider instance.
   * @param provider - local, worktree, sandbox, or remote execution-root provider.
   * @returns HMR-safe disposer for this registration.
   */
  registerProvider(provider: TeamWorkspaceProvider): () => void {
    assertProvider(provider)
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamWorkspaceRegistry) {
      if (this.providersByName.has(provider.name)) {
        throw new TeamWorkspaceError(
          `Team workspace provider '${provider.name}' is already registered`,
          'TEAM_WORKSPACE_PROVIDER_DUPLICATE',
        )
      }
      for (const mode of provider.modes) {
        const existing = this.providersByMode.get(mode)
        if (existing !== undefined) {
          throw new TeamWorkspaceError(
            `Team workspace mode '${mode}' is already provided by '${existing.name}'`,
            'TEAM_WORKSPACE_MODE_DUPLICATE',
          )
        }
      }
      this.providersByName.set(provider.name, provider)
      for (const mode of provider.modes) this.providersByMode.set(mode, provider)
      yield () => {
        if (this.providersByName.get(provider.name) !== provider) return
        this.providersByName.delete(provider.name)
        for (const mode of provider.modes) {
          if (this.providersByMode.get(mode) === provider) this.providersByMode.delete(mode)
        }
      }
    }.bind(this), 'teamWorkspaces.registerProvider()')
  }

  /**
   * Register one current delivery owner's exact task-allocation publisher without exposing live handles.
   * @param owner - Same-process Agent object used by the actual tool execution.
   * @param publisher - Owner that verifies Session claim, running lease and allocation identity.
   * @returns Effect-owned disposer for the exact registration.
   */
  registerAllocationPublisher(owner: object, publisher: TeamWorkspaceAllocationPublisher): () => void {
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamWorkspaceRegistry) {
      if (this.allocationPublishers.has(owner)) throw new TeamWorkspaceError('Workspace owner already has a publisher', 'TEAM_WORKSPACE_ALLOCATION_MISMATCH')
      this.allocationPublishers.set(owner, publisher)
      yield () => { if (this.allocationPublishers.get(owner) === publisher) this.allocationPublishers.delete(owner) }
    }.bind(this), 'teamWorkspaces.registerAllocationPublisher()')
  }

  /**
   * Publish through the actual allocation owner before a task outcome may settle.
   * @param owner - Exact current Agent object, never an id or ambient context slot.
   * @param request - Authoritative retained allocation and active tool cancellation.
   * @returns The provider result; undefined only when a valid owner's provider does not support publication.
   */
  async publishForOwner(owner: object, request: TeamWorkspaceOwnerPublicationRequest): Promise<TeamWorkspacePublishResult | undefined> {
    const publisher = this.allocationPublishers.get(owner)
    if (publisher === undefined) throw new TeamWorkspaceError('The retained workspace allocation has no current publisher', 'TEAM_WORKSPACE_ALLOCATION_MISMATCH')
    return await publisher.publish(request)
  }

  /**
   * Resolve one provider by its registered name.
   * @param name - provider registry name.
   * @returns the live provider, or `undefined` when no matching provider remains.
   */
  getProvider(name: string): TeamWorkspaceProvider | undefined {
    return this.providersByName.get(name)
  }

  /**
   * List provider identities in registration order.
   * @returns detached provider references.
   */
  listProviders(): TeamWorkspaceProviderRef[] {
    return [...this.providersByName.values()].map(provider => ({
      name: provider.name,
      modes: [...provider.modes],
    }))
  }

  /**
   * Resolve the sole live provider for one workspace mode.
   * @param mode - task workspace mode selected by an immutable task snapshot.
   * @returns the provider registered for the exact mode.
   * @throws {@link TeamWorkspaceError} when no provider currently owns the mode.
   */
  resolve(mode: TeamTaskWorkspaceMode): TeamWorkspaceProvider {
    const provider = this.providersByMode.get(mode)
    if (provider === undefined) {
      throw new TeamWorkspaceError(
        `No Team workspace provider is registered for '${mode}' mode`,
        'TEAM_WORKSPACE_MODE_UNAVAILABLE',
      )
    }
    return provider
  }

  /**
   * Delegate a scheduler eligibility check to the exact selected mode provider.
   * @param mode - immutable workspace mode selected by the task.
   * @param request - current task and activation binding proposed by the scheduler.
   * @returns whether the provider can execute this task binding without allocation.
   */
  async eligible(mode: TeamTaskWorkspaceMode, request: TeamWorkspaceEligibilityRequest): Promise<boolean> {
    return await this.resolve(mode).eligible(request)
  }

  /**
   * Check provider-owned route compatibility before a Participant activation exists.
   * @param mode - task workspace mode selecting the provider.
   * @param request - task, Participant, and candidate runtime route.
   * @returns the provider's compatibility result, or `true` when it exposes no preflight.
   */
  async preflight(mode: TeamTaskWorkspaceMode, request: TeamWorkspacePreflightRequest): Promise<boolean> {
    const provider = this.resolve(mode)
    return provider.preflight === undefined ? true : await provider.preflight(request)
  }

  /**
   * Reserve provider-owned metadata before a Team command durably binds it.
   * @param mode - immutable workspace mode selected by the task.
   * @param request - exact lease and activation facts the provider must revalidate.
   * @returns a root-less provider reservation.
   */
  async prepare(
    mode: TeamTaskWorkspaceMode,
    request: TeamWorkspacePrepareRequest,
  ): Promise<TeamWorkspacePreparation> {
    const provider = this.resolve(mode)
    const preparation = await provider.prepare(request)
    if (metadataMatchesRequest(preparation, provider.name, mode, request)) return preparation
    const mismatch = allocationMismatch(request, 'preparation')
    try {
      await preparation.abandon()
    } catch (abandonError: unknown) {
      throw new AggregateError([mismatch, abandonError], 'Team workspace preparation mismatch cleanup failed')
    }
    throw mismatch
  }

  /**
   * Materialize one metadata reservation only after its Team owner accepted it.
   * @param mode - immutable workspace mode selected by the task.
   * @param request - exact lease and activation facts captured by the reservation.
   * @param preparation - root-less provider reservation returned by {@link prepare}.
   * @returns the provider-owned live execution-root allocation.
   */
  async materialize(
    mode: TeamTaskWorkspaceMode,
    request: TeamWorkspacePrepareRequest,
    preparation: TeamWorkspacePreparation,
  ): Promise<TeamWorkspaceAllocation> {
    const provider = this.resolve(mode)
    if (!metadataMatchesRequest(preparation, provider.name, mode, request)) {
      throw allocationMismatch(request, 'preparation')
    }
    const allocation = await preparation.materialize()
    if (metadataMatchesRequest(allocation, provider.name, mode, request)
      && sameMetadata(allocation, preparation)) return allocation
    const mismatch = allocationMismatch(request, 'materialization')
    try {
      await allocation.release()
    } catch (releaseError: unknown) {
      throw new AggregateError([mismatch, releaseError], 'Team workspace allocation mismatch cleanup failed')
    }
    throw mismatch
  }

  /**
   * Reopen one exact durable provider allocation during local recovery.
   * @param mode - immutable workspace mode selected by the task.
   * @param request - exact current lease and activation facts.
   * @param metadata - Team-retained provider metadata without a root.
   * @returns the provider-owned live execution-root allocation.
   */
  async restore(
    mode: TeamTaskWorkspaceMode,
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
  ): Promise<TeamWorkspaceAllocation> {
    const provider = this.resolve(mode)
    if (!metadataMatchesRequest(metadata, provider.name, mode, request)) {
      throw allocationMismatch(request, 'recovery metadata')
    }
    const allocation = await provider.restore(request, metadata)
    if (metadataMatchesRequest(allocation, provider.name, mode, request) && sameMetadata(allocation, metadata)) {
      return allocation
    }
    const mismatch = allocationMismatch(request, 'restored allocation')
    try {
      await allocation.release()
    } catch (releaseError: unknown) {
      throw new AggregateError([mismatch, releaseError], 'Team workspace restored-allocation mismatch cleanup failed')
    }
    throw mismatch
  }

  /**
   * Ask the metadata-owning provider to prove physical cleanup without
   * materializing a root that a prior process already released.
   * @param mode - immutable workspace mode selected by the task.
   * @param request - exact task-attempt ownership retained by the allocation.
   * @param metadata - Team-retained provider metadata without a root.
   * @returns resolution after provider cleanup is proven or completed.
   */
  async reconcileRelease(
    mode: TeamTaskWorkspaceMode,
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
  ): Promise<void> {
    const provider = this.resolve(mode)
    if (!metadataMatchesRequest(metadata, provider.name, mode, request)) {
      throw allocationMismatch(request, 'release-reconciliation metadata')
    }
    await provider.reconcileRelease(request, metadata)
  }

  /**
   * Delegate an explicit publish/integrate operation to the selected provider.
   * @param mode - task workspace mode selecting the provider.
   * @param request - exact allocation and optional integration target.
   * @returns provider-owned publish provenance.
   */
  async publish(
    mode: TeamTaskWorkspaceMode,
    request: TeamWorkspacePublishRequest,
  ): Promise<TeamWorkspacePublishResult> {
    const provider = this.resolve(mode)
    if (provider.publish === undefined) {
      throw new TeamWorkspaceError(`Team workspace provider '${provider.name}' does not support publish`, 'TEAM_WORKSPACE_MODE_UNAVAILABLE')
    }
    const result = await provider.publish(request)
    if (result.teamId === request.allocation.teamId
      && result.taskId === request.allocation.taskId
      && result.attemptId === request.allocation.attemptId) {
      return result
    }
    throw new TeamWorkspaceError(
      `Team workspace provider '${provider.name}' returned publish provenance outside task attempt '${request.allocation.attemptId}'`,
      'TEAM_WORKSPACE_ALLOCATION_MISMATCH',
    )
  }

  /**
   * Delegate an explicit proposal or integration operation to the selected provider.
   * @param mode - workspace mode selecting the provider.
   * @param request - exact allocation, target, and operation mode.
   * @returns provider-owned integration provenance.
   */
  async integrate(
    mode: TeamTaskWorkspaceMode,
    request: TeamWorkspaceIntegrateRequest,
  ): Promise<TeamWorkspaceIntegrateResult> {
    const provider = this.resolve(mode)
    if (provider.integrate === undefined) {
      throw new TeamWorkspaceError(`Team workspace provider '${provider.name}' does not support integrate`, 'TEAM_WORKSPACE_MODE_UNAVAILABLE')
    }
    const result = await provider.integrate(request)
    if (result.teamId === request.allocation.teamId
      && result.taskId === request.allocation.taskId
      && result.attemptId === request.allocation.attemptId
      && result.target === request.target) {
      return result
    }
    throw new TeamWorkspaceError(
      `Team workspace provider '${provider.name}' returned integration provenance outside task attempt '${request.allocation.attemptId}'`,
      'TEAM_WORKSPACE_ALLOCATION_MISMATCH',
    )
  }

  /**
   * Delegate an integration sourced from a durable artifact manifest.
   * @param providerName - exact provider identity selected by the integration task.
   * @param request - source provenance, integration attempt, target, and operation mode.
   * @returns provider-owned integration provenance with every source identity preserved.
   */
  async integrateSource(
    providerName: string,
    request: TeamWorkspaceSourceIntegrateRequest,
  ): Promise<TeamWorkspaceSourceIntegrateResult> {
    const provider = this.providersByName.get(providerName)
    if (provider === undefined || provider.integrateSource === undefined) {
      throw new TeamWorkspaceError(
        `Team workspace provider '${providerName}' does not support source integration`,
        'TEAM_WORKSPACE_MODE_UNAVAILABLE',
      )
    }
    const result = await provider.integrateSource(request)
    if (result.teamId === request.source.teamId
      && result.sourceTaskId === request.source.taskId
      && result.sourceAttemptId === request.source.attemptId
      && result.integrationTaskId === request.integrationTaskId
      && result.integrationAttemptId === request.integrationAttemptId
      && result.target === request.target
      && sourceArtifactProvenanceMatches(result, request)) {
      return result
    }
    throw new TeamWorkspaceError(
      `Team workspace provider '${providerName}' returned source integration provenance outside the requested task attempts`,
      'TEAM_WORKSPACE_SOURCE_MISMATCH',
    )
  }
}

/** Keep provider-produced artifact references within the source or integration attempt. */
function sourceArtifactProvenanceMatches(
  result: TeamWorkspaceSourceIntegrateResult,
  request: TeamWorkspaceSourceIntegrateRequest,
): boolean {
  const sourceAttemptId = result.artifact?.sourceAttemptId
  return sourceAttemptId === undefined
    || sourceAttemptId === request.source.attemptId
    || sourceAttemptId === request.integrationAttemptId
}

/** Reject an invalid provider declaration before it changes the registry. */
function assertProvider(provider: TeamWorkspaceProvider): void {
  if (provider.name.length === 0 || provider.name.trim() !== provider.name) {
    throw new TeamWorkspaceError(
      'Team workspace provider name must be non-empty without surrounding whitespace',
      'TEAM_WORKSPACE_PROVIDER_INVALID',
    )
  }
  if (provider.modes.length === 0) {
    throw new TeamWorkspaceError(
      `Team workspace provider '${provider.name}' must register at least one mode`,
      'TEAM_WORKSPACE_PROVIDER_INVALID',
    )
  }
  const modes = new Set<TeamTaskWorkspaceMode>()
  for (const mode of provider.modes) {
    if (!WORKSPACE_MODES.includes(mode) || modes.has(mode)) {
      throw new TeamWorkspaceError(
        `Team workspace provider '${provider.name}' has invalid or repeated '${mode}' mode`,
        'TEAM_WORKSPACE_PROVIDER_INVALID',
      )
    }
    modes.add(mode)
  }
}

/** Verify that provider metadata cannot escape its exact task-attempt ownership relation. */
function metadataMatchesRequest(
  metadata: TeamWorkspaceAllocationMetadata,
  providerName: string,
  mode: TeamTaskWorkspaceMode,
  request: TeamWorkspacePrepareRequest,
): boolean {
  return metadata.provider === providerName
    && metadata.mode === mode
    && metadata.teamId === request.teamId
    && metadata.taskId === request.taskId
    && metadata.attemptId === request.attemptId
    && metadata.assignedRevision === request.assignedRevision
    && metadata.participantId === request.participantId
    && metadata.activationId === request.activationId
    && metadata.sessionId === request.sessionId
}

/** Compare immutable provider metadata after materialization or recovery. */
function sameMetadata(left: TeamWorkspaceAllocationMetadata, right: TeamWorkspaceAllocationMetadata): boolean {
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
    && left.executionWorld?.kind === right.executionWorld?.kind
    && left.executionWorld?.id === right.executionWorld?.id
}

/** Build the stable registry rejection for malformed provider-owned allocation facts. */
function allocationMismatch(request: TeamWorkspacePrepareRequest, subject: string): TeamWorkspaceError {
  return new TeamWorkspaceError(
    `Team workspace provider returned ${subject} outside task attempt '${request.attemptId}'`,
    'TEAM_WORKSPACE_ALLOCATION_MISMATCH',
  )
}

export default TeamWorkspaceRegistry
