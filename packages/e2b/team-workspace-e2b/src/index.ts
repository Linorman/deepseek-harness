/**
 * E2B remote Team workspace provider. Each exact task attempt receives a
 * deterministic directory inside the shared E2B sandbox, and the provider
 * publishes bounded remote file references without pretending that one remote
 * sandbox is a durable multi-host store.
 *
 * @module @clocky/clocky-team-workspace-e2b
 */

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type {} from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-team-artifact'
import { FileNotFoundError, FileType, SandboxNotFoundError } from '@clocky/clocky-e2b'
import type { EntryInfo } from '@clocky/clocky-e2b'
import type {} from '@clocky/clocky-e2b'
import { TeamError, teamWorkspaceAllocationIdSchema, teamWorkspaceExecutionWorldSchema, teamArtifactReferenceSchema } from '@clocky/clocky-team'
import { defineLogStream } from '@clocky/clocky-storage-log'
import type {} from '@clocky/clocky-storage-log'
import type {
  ActivationBindingSnapshot,
  ParticipantSnapshot,
  TeamArtifactReference,
  TeamStateSnapshot,
  TeamTaskSnapshot,
  TeamWorkspaceLoss,
} from '@clocky/clocky-team'
import type {
  TeamWorkspaceAllocation,
  TeamWorkspaceAllocationMetadata,
  TeamWorkspaceEligibilityRequest,
  TeamWorkspacePreflightRequest,
  TeamWorkspacePreparation,
  TeamWorkspacePrepareRequest,
  TeamWorkspaceProvider,
  TeamWorkspacePublishRequest,
  TeamWorkspacePublishResult,
  TeamWorkspaceSourceIntegrateRequest,
  TeamWorkspaceSourceIntegrateResult,
} from '@clocky/clocky-team-workspace'
import {
  encodeTeamWorkspaceChangeSet,
  parseTeamWorkspaceChangeSet,
  selectTeamWorkspacePatchArtifact,
  teamWorkspaceSourceIntegrationResult,
  TeamWorkspaceLostError,
} from '@clocky/clocky-team-workspace'
import type { TeamWorkspaceChange, TeamWorkspaceChangeSet } from '@clocky/clocky-team-workspace'

/** Cordis plugin name. */
export const name = 'team-workspace-e2b'
/** Workspace registry, Team authority, local Agent discovery, and E2B must exist before allocation. */
export const inject = ['teamWorkspaces', 'teams', 'agents', 'e2b']

const DEFAULT_PROVIDER_NAME = 'remote-e2b'
const DEFAULT_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_INTEGRATION_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_ENTRIES_PER_PUBLISH = 4_096
const DEFAULT_MAX_LIST_DEPTH = 64
const MANIFEST_VERSION = 2 as const
const INTEGRATION_MARKER_VERSION = 1 as const

/** E2B remote workspace configuration. */
export interface Config {
  /** Registry identity used in durable allocation metadata. */
  readonly providerName?: string
  /** Absolute POSIX directory under the remote E2B runtime root. */
  readonly workspaceParent?: string
  /** Optional artifact provider used for bounded changed-file bytes. */
  readonly artifactProvider?: string
  /** Maximum remote file size read for artifact publication. */
  readonly maxArtifactBytes?: number
  /** Maximum remote entries returned by one publish scan. */
  readonly maxEntriesPerPublish?: number
  /** Recursive listing depth used by one publish scan. */
  readonly maxListDepth?: number
  /** Absolute POSIX directory that contains provider-specific integration targets. */
  readonly integrationRoot?: string
  /** Explicitly enables provider-specific target-directory integration. */
  readonly integrationEnabled?: boolean
  /** Maximum encoded change-set and decoded file bytes accepted by integration. */
  readonly maxIntegrationBytes?: number
  /** Interval between bounded execution-world and manifest loss checks. */
  readonly lossPollIntervalMs?: number
  /** Maximum allocation manifests checked per poll. */
  readonly maxLossChecksPerPoll?: number
  /** Bound on durable artifact references retained for one allocation. */
  readonly maxRetainedArtifacts?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  providerName: z.string().default(DEFAULT_PROVIDER_NAME),
  workspaceParent: z.string(),
  artifactProvider: z.string().min(1),
  maxArtifactBytes: z.number().step(1).min(1).default(DEFAULT_MAX_ARTIFACT_BYTES),
  maxEntriesPerPublish: z.number().step(1).min(1).default(DEFAULT_MAX_ENTRIES_PER_PUBLISH),
  maxListDepth: z.number().step(1).min(1).default(DEFAULT_MAX_LIST_DEPTH),
  integrationRoot: z.string(),
  integrationEnabled: z.boolean().default(false),
  maxIntegrationBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INTEGRATION_BYTES),
  lossPollIntervalMs: z.number().step(1).min(1).max(2147483647).default(5000),
  maxLossChecksPerPoll: z.number().step(1).min(1).default(16),
  maxRetainedArtifacts: z.number().step(1).min(1).default(4096),
})

interface ResolvedConfig {
  readonly providerName: string
  readonly workspaceParent: string
  readonly artifactProvider?: string
  readonly maxArtifactBytes: number
  readonly maxEntriesPerPublish: number
  readonly maxListDepth: number
  readonly integrationRoot?: string
  readonly integrationEnabled: boolean
  readonly maxIntegrationBytes: number
  readonly lossPollIntervalMs: number
  readonly maxLossChecksPerPoll: number
  readonly maxRetainedArtifacts: number
}

interface StoredManifest {
  readonly version: typeof MANIFEST_VERSION
  readonly metadata: TeamWorkspaceAllocationMetadata
}

interface IntegrationMarkerBase {
  readonly version: typeof INTEGRATION_MARKER_VERSION
  readonly provider: string
  readonly sourceTaskId: string
  readonly sourceAttemptId: string
  readonly integrationTaskId: string
  readonly integrationAttemptId: string
  readonly target: string
  readonly expectedVersion: string
}

type IntegrationMarker =
  | (IntegrationMarkerBase & { readonly status: 'prepared'; readonly targetVersion?: undefined; readonly targetCreated: boolean })
  | (IntegrationMarkerBase & { readonly status: 'integrated'; readonly targetVersion: string })

const EMPTY_REMOTE_DIRECTORY_VERSION = createHash('sha256').update('[]').digest('hex')

/** Provider that owns isolated remote directories in one E2B execution world. */
class E2BTeamWorkspaceProvider implements TeamWorkspaceProvider {
  readonly modes = ['remote'] as const
  private readonly preparations = new Map<string, TeamWorkspacePreparation>()
  private readonly allocations = new Map<string, TeamWorkspaceAllocation>()
  private readonly materializations = new Map<string, Promise<TeamWorkspaceAllocation>>()
  /** Serialize provider-specific integration operations for one remote target. */
  private readonly integrationQueues = new Map<string, Promise<void>>()
  private readonly losses = new Map<string, TeamWorkspaceLoss>()
  private readonly lossListeners = new Map<string, Set<(loss: TeamWorkspaceLoss) => Promise<void>>>()
  private readonly artifactQueues = new Map<string, Promise<unknown>>()
  private readonly retainedArtifacts = new Map<string, readonly TeamArtifactReference[]>()
  private polling: Promise<void> | undefined
  private lossTimer: ReturnType<typeof setInterval> | undefined
  private pollCursor = 0
  private retired = false

  /**
   * @param ctx - Context carrying Team authority, local Agent discovery, and E2B.
   * @param config - Canonical immutable remote configuration.
   */
  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  /** Provider registry identity. */
  get name(): string { return this.config.providerName }

  /**
   * Probe the configured E2B world before activating a Participant.
   * @param request - task, active Participant, and candidate runtime route.
   * @returns whether the remote workspace world is currently reachable.
   */
  async preflight(request: TeamWorkspacePreflightRequest): Promise<boolean> {
    if (request.task.workspaceMode !== 'remote' || request.participant.phase !== 'active') return false
    try {
      const sandbox = await this.ctx.e2b.getSandbox()
      await sandbox.getInfo()
      return true
    } catch {
      return false
    }
  }

  /**
   * Report whether the E2B world and exact local Agent binding are available.
   * @param request - scheduler task and activation facts.
   * @returns false when the remote world is unavailable or the binding is stale.
   */
  async eligible(request: TeamWorkspaceEligibilityRequest): Promise<boolean> {
    if (request.task.workspaceMode !== 'remote') return false
    try {
      const sandbox = await this.ctx.e2b.getSandbox()
      await sandbox.getInfo()
    } catch {
      return false
    }
    const state = await this.ctx.teams.getTeam({ teamId: request.task.teamId })
    return this.isEligibleState(state, request.task, request.binding)
      && this.hasExactLiveAgent(request.binding)
  }

  /**
   * Reserve root-free metadata before Team durability accepts the allocation.
   * @param request - current lease and activation facts.
   * @returns a root-less provider reservation.
   */
  async prepare(request: TeamWorkspacePrepareRequest): Promise<TeamWorkspacePreparation> {
    if (this.retired) throw new TeamError('E2B workspace provider is retired', 'TEAM_INVALID_ARGUMENT')
    await this.assertCurrentAllocation(request)
    const key = allocationKey(request)
    const existing = this.preparations.get(key)
    if (existing !== undefined) return existing
    const metadata = this.metadata(request, (await this.remoteSandbox()).sandboxId)
    let abandoned = false
    const preparation: TeamWorkspacePreparation = Object.freeze({
      ...metadata,
      materialize: async (): Promise<TeamWorkspaceAllocation> => {
        if (abandoned) throw new TeamError(`remote allocation '${metadata.id}' was abandoned`, 'TEAM_INVALID_ARGUMENT')
        await this.assertCurrentAllocation(request)
        const current = this.allocations.get(key)
        if (current !== undefined) return current
        const pending = this.materializations.get(key)
        if (pending !== undefined) return await pending
        const materialization = this.detectLoss(metadata, () => this.materializeOwned(metadata, key)).then((allocation) => {
          this.allocations.set(key, allocation)
          this.startLossPolling()
          return allocation
        })
        this.materializations.set(key, materialization)
        try {
          return await materialization
        } finally {
          if (this.materializations.get(key) === materialization) this.materializations.delete(key)
        }
      },
      abandon: (): Promise<void> => {
        if (abandoned) return Promise.resolve()
        abandoned = true
        if (this.preparations.get(key) === preparation) this.preparations.delete(key)
        return Promise.resolve()
      },
    })
    this.preparations.set(key, preparation)
    return preparation
  }

  /** Reopen an exact remote directory while its E2B sandbox remains live. */
  async restore(
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
  ): Promise<TeamWorkspaceAllocation> {
    const sandbox = await this.remoteSandbox()
    const expected = this.metadata(request, metadata.executionWorld?.id ?? sandbox.sandboxId)
    if (!sameMetadata(metadata, expected)) {
      throw new TeamError(`remote allocation '${metadata.id}' is not owned by this provider`, 'TEAM_INVALID_ARGUMENT')
    }
    await this.detectLoss(metadata, async () => { await this.requireWorld(metadata, sandbox) })
    await this.assertCurrentAllocation(request)
    const key = allocationKey(request)
    const current = this.allocations.get(key)
    if (current !== undefined) return current
    const root = allocationRoot(this.config, key)
    await this.detectLoss(metadata, async () => {
      await this.requireWorld(metadata, sandbox)
      await this.assertRemoteDirectory(sandbox, root)
      await this.readManifest(sandbox, metadata, key)
    })
    const allocation = this.createAllocation(sandbox, metadata, key, root)
    this.allocations.set(key, allocation)
    this.startLossPolling()
    return allocation
  }

  /** Reconcile remote cleanup without recreating the remote execution root. */
  async reconcileRelease(
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
  ): Promise<void> {
    const sandbox = await this.remoteSandbox()
    const expected = this.metadata(request, metadata.executionWorld?.id ?? sandbox.sandboxId)
    if (!sameMetadata(metadata, expected)) {
      throw new TeamError(`remote allocation '${metadata.id}' is not owned by this provider`, 'TEAM_INVALID_ARGUMENT')
    }
    const key = allocationKey(request)
    const current = this.allocations.get(key)
    if (current !== undefined) {
      await current.release()
      return
    }
    if (this.losses.get(key)?.terminationProven !== true) {
      await this.detectLoss(metadata, async () => {
        await this.requireWorld(metadata, sandbox)
        await this.removeOwned(sandbox, metadata, key)
      })
    }
    this.preparations.delete(key)
  }

  /**
   * Publish bounded remote files without integrating them into another target.
   * @param request - exact live allocation selected by the task attempt.
   * @returns changed paths and optional provider-backed file artifacts.
   */
  async publish(request: TeamWorkspacePublishRequest): Promise<TeamWorkspacePublishResult> {
    return await this.detectLoss(request.allocation, async () => await this.publishOwned(request))
  }

  private async publishOwned(request: TeamWorkspacePublishRequest): Promise<TeamWorkspacePublishResult> {
    const key = allocationKey(request.allocation)
    const allocation = this.allocations.get(key)
    if (allocation === undefined || !sameAllocation(allocation, request.allocation)) {
      throw new TeamError(`remote allocation for task attempt '${request.allocation.attemptId}' is not live`, 'TEAM_INVALID_ARGUMENT')
    }
    const sandbox = await this.remoteSandbox()
    await this.requireWorld(allocation, sandbox)
    await this.readManifest(sandbox, allocation, key)
    const entries = await sandbox.files.list(allocation.root, { depth: this.config.maxListDepth })
    if (entries.length > this.config.maxEntriesPerPublish) {
      throw new TeamError(`remote sandbox publish exceeds the configured ${String(this.config.maxEntriesPerPublish)}-entry limit`, 'TEAM_INVALID_ARGUMENT')
    }
    const files = entries
      .filter(entry => entry.type === FileType.FILE && entry.symlinkTarget === undefined)
      .map(entry => ({ entry, path: relativeRemotePath(allocation.root, entry.path) }))
      .filter((candidate): candidate is { readonly entry: EntryInfo; readonly path: string } => candidate.path !== undefined)
      .sort((left, right) => left.path.localeCompare(right.path))
    const changedPaths = files.map(candidate => candidate.path)
    const artifacts = [...await materializeArtifacts(this.ctx, sandbox, allocation, files, this.config,
      async (artifact) => { await this.retainArtifact(allocation, artifact) })]
    const patchData = await materializeChangeSet(sandbox, allocation, files, this.config)
    const artifactStore = this.ctx.get('teamArtifacts')
    if (patchData !== undefined
      && this.config.integrationRoot !== undefined
      && artifactStore !== undefined
      && this.config.artifactProvider !== undefined) {
      const artifact = await artifactStore.save(this.config.artifactProvider, {
        teamId: allocation.teamId,
        sourceAttemptId: allocation.attemptId,
        kind: 'patch',
        visibility: 'team',
        name: `remote-${String(allocation.taskId)}-${String(allocation.attemptId)}.changes.json`,
        data: patchData,
      })
      await this.retainArtifact(allocation, artifact)
      artifacts.push(artifact)
    }
    void request.target
    return {
      teamId: allocation.teamId,
      taskId: allocation.taskId,
      attemptId: allocation.attemptId,
      changedPaths,
      artifacts,
      accepted: false,
    }
  }

  /**
   * Integrate one completed source attempt into a provider-owned remote target directory.
   * @param request - source artifact provenance, target, and operation mode.
   * @returns a proposal or remote target-directory integration result.
   */
  async integrateSource(request: TeamWorkspaceSourceIntegrateRequest): Promise<TeamWorkspaceSourceIntegrateResult> {
    assertSourceIntegrationRequest(request)
    const artifact = selectTeamWorkspacePatchArtifact(request)
    const decision = await this.ctx.teams.authorize({
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
        provider: this.config.providerName,
      },
    })
    if (decision.kind === 'deny') throw new TeamError(decision.message, 'TEAM_POLICY_DENIED')
    if (request.mode === 'proposal') return teamWorkspaceSourceIntegrationResult(request, { status: 'proposed', artifact })
    if (!this.config.integrationEnabled) {
      throw new TeamError('remote E2B integration authority is disabled by configuration', 'TEAM_POLICY_DENIED')
    }
    const store = this.ctx.get('teamArtifacts')
    const integrationRoot = this.config.integrationRoot
    if (store === undefined || this.config.artifactProvider === undefined || integrationRoot === undefined) {
      throw new TeamError(
        'remote E2B source integration requires integrationEnabled, integrationRoot, and a configured artifact provider',
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const bytes = await store.read(this.config.artifactProvider, { reference: artifact })
    const changeSet = parseTeamWorkspaceChangeSet(
      parseJson(bytes),
      this.config.providerName,
      request.source.attemptId,
      this.config.maxIntegrationBytes,
    )
    return await this.serializeIntegration(
      request.target,
      async () => await this.applyChangeSet(request, artifact, changeSet, integrationRoot),
    )
  }

  /** Serialize one remote target operation within this provider process. */
  private async serializeIntegration<T>(target: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.integrationQueues.get(target) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.integrationQueues.set(target, current)
    await prior
    try {
      return await operation()
    } finally {
      release()
      if (this.integrationQueues.get(target) === current) this.integrationQueues.delete(target)
    }
  }

  /** Apply a validated change set with a remote target-version fence and recovery marker. */
  private async applyChangeSet(
    request: TeamWorkspaceSourceIntegrateRequest,
    artifact: import('@clocky/clocky-team').TeamArtifactReference,
    changeSet: TeamWorkspaceChangeSet,
    integrationRoot: string,
  ): Promise<TeamWorkspaceSourceIntegrateResult> {
    const sandbox = await this.remoteSandbox()
    const targetRoot = integrationTargetRoot(integrationRoot, request.target)
    const markerPathname = integrationMarkerPath(this.config, request)
    const currentVersion = await remoteDirectoryVersion(sandbox, targetRoot, this.config)
    const previous = await readIntegrationMarker(sandbox, markerPathname)
    let recoveredPreparedExpectedVersion: string | undefined
    if (previous !== undefined) {
      if (!sameIntegrationMarker(previous, request, this.config.providerName)) {
        throw new TeamError(`remote integration marker '${markerPathname}' does not match the current request`, 'TEAM_INVALID_ARGUMENT')
      }
      if (previous.status === 'integrated') {
        if (currentVersion === previous.targetVersion) {
          if (request.expectedTarget !== undefined && request.expectedTarget !== previous.expectedVersion) {
            return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
          }
          return teamWorkspaceSourceIntegrationResult(request, { status: 'integrated', targetVersion: previous.targetVersion, artifact })
        }
        return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
      }
      const preparedTargetUnchanged = currentVersion === previous.expectedVersion
        || (previous.targetCreated && previous.expectedVersion === 'missing' && currentVersion === EMPTY_REMOTE_DIRECTORY_VERSION)
      if (!preparedTargetUnchanged) return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
      recoveredPreparedExpectedVersion = previous.expectedVersion
      await removeRemote(sandbox, markerPathname)
    }
    if (request.expectedTarget !== undefined
      && request.expectedTarget !== currentVersion
      && request.expectedTarget !== recoveredPreparedExpectedVersion) {
      return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
    }
    const existingTarget = await remoteInfo(sandbox, targetRoot)
    await ensureRemoteDirectoryPath(sandbox, integrationRoot, posix.dirname(targetRoot))
    if (await remoteDirectoryVersion(sandbox, targetRoot, this.config) !== currentVersion) {
      return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
    }
    await sandbox.files.makeDir(integrationMarkerRoot(this.config))
    await writeIntegrationMarker(sandbox, markerPathname, {
      version: INTEGRATION_MARKER_VERSION,
      provider: this.config.providerName,
      sourceTaskId: String(request.source.taskId),
      sourceAttemptId: String(request.source.attemptId),
      integrationTaskId: String(request.integrationTaskId),
      integrationAttemptId: String(request.integrationAttemptId),
      target: request.target,
      expectedVersion: currentVersion,
      status: 'prepared',
      targetCreated: existingTarget === undefined,
    })
    if (existingTarget?.type === FileType.DIR) {
      await ensureRemoteDirectoryPath(sandbox, targetRoot, targetRoot)
    } else {
      await sandbox.files.makeDir(targetRoot)
    }
    await applyRemoteChanges(sandbox, targetRoot, changeSet.changes)
    const targetVersion = await remoteDirectoryVersion(sandbox, targetRoot, this.config)
    await writeIntegrationMarker(sandbox, markerPathname, {
      version: INTEGRATION_MARKER_VERSION,
      provider: this.config.providerName,
      sourceTaskId: String(request.source.taskId),
      sourceAttemptId: String(request.source.attemptId),
      integrationTaskId: String(request.integrationTaskId),
      integrationAttemptId: String(request.integrationAttemptId),
      target: request.target,
      expectedVersion: currentVersion,
      targetVersion,
      status: 'integrated',
    })
    return teamWorkspaceSourceIntegrationResult(request, { status: 'integrated', targetVersion, artifact })
  }

  private async materializeOwned(metadata: TeamWorkspaceAllocationMetadata, key: string): Promise<TeamWorkspaceAllocation> {
    const sandbox = await this.remoteSandbox()
    await this.requireWorld(metadata, sandbox)
    const root = allocationRoot(this.config, key)
    await sandbox.files.makeDir(this.config.workspaceParent)
    const existingRoot = await remoteInfo(sandbox, root)
    if (existingRoot !== undefined) {
      await this.assertRemoteDirectory(sandbox, root)
      await this.readManifest(sandbox, metadata, key)
      return this.createAllocation(sandbox, metadata, key, root)
    }
    const created = await sandbox.files.makeDir(root)
    if (!created) throw new TeamError(`remote sandbox root '${root}' was created concurrently`, 'TEAM_INVALID_ARGUMENT')
    try {
      await sandbox.files.makeDir(posix.dirname(manifestPath(this.config, key)))
      await sandbox.files.write(manifestPath(this.config, key), JSON.stringify({ version: MANIFEST_VERSION, metadata }))
      return this.createAllocation(sandbox, metadata, key, root)
    } catch (error: unknown) {
      await removeRemote(sandbox, root)
      throw error
    }
  }

  private async removeOwned(
    sandbox: import('@clocky/clocky-e2b').Sandbox,
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
  ): Promise<void> {
    const manifest = await remoteInfo(sandbox, manifestPath(this.config, key))
    const root = allocationRoot(this.config, key)
    const existingRoot = await remoteInfo(sandbox, root)
    if (manifest === undefined && existingRoot === undefined) return
    if (manifest === undefined) throw await this.lossError(metadata, 'manifest-missing')
    await this.readManifest(sandbox, metadata, key)
    await removeRemote(sandbox, root)
    await removeRemote(sandbox, manifestPath(this.config, key))
  }

  private async readManifest(
    sandbox: import('@clocky/clocky-e2b').Sandbox,
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
  ): Promise<StoredManifest> {
    let raw: string
    try {
      raw = await sandbox.files.read(manifestPath(this.config, key), { format: 'text' })
    } catch (error: unknown) {
      if (isRemoteNotFound(error)) throw await this.lossError(metadata, 'manifest-missing')
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error: unknown) {
      throw new TeamError(`remote allocation '${metadata.id}' has an invalid provider manifest`, 'TEAM_INVALID_ARGUMENT', { cause: error })
    }
    if (!isStoredManifest(parsed) || !sameMetadata(parsed.metadata, metadata)) {
      throw new TeamError(`remote allocation '${metadata.id}' has a mismatched provider manifest`, 'TEAM_INVALID_ARGUMENT')
    }
    return parsed
  }

  private async assertRemoteDirectory(sandbox: import('@clocky/clocky-e2b').Sandbox, root: string): Promise<void> {
    const info = await remoteInfo(sandbox, root)
    if (info === undefined || info.type !== FileType.DIR || info.symlinkTarget !== undefined) {
      throw new TeamError(`remote workspace root '${root}' is not a regular directory`, 'TEAM_INVALID_ARGUMENT')
    }
  }

  private async remoteSandbox(): Promise<import('@clocky/clocky-e2b').Sandbox> {
    try {
      return await this.ctx.e2b.getSandbox()
    } catch (error: unknown) {
      throw new TeamError('remote Team workspace sandbox is unavailable', 'TEAM_INVALID_ARGUMENT', { cause: error })
    }
  }

  private createAllocation(
    sandbox: import('@clocky/clocky-e2b').Sandbox,
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
    root: string,
  ): TeamWorkspaceAllocation {
    let released = false
    return Object.freeze({
      ...metadata,
      root,
      onLoss: (listener: (loss: TeamWorkspaceLoss) => Promise<void>): (() => void) => {
        let listeners = this.lossListeners.get(key)
        if (listeners === undefined) { listeners = new Set(); this.lossListeners.set(key, listeners) }
        listeners.add(listener)
        return () => { listeners.delete(listener); if (listeners.size === 0) this.lossListeners.delete(key) }
      },
      release: async (): Promise<void> => {
        if (released) return
        if (this.losses.get(key)?.terminationProven !== true) {
          await this.detectLoss(metadata, async () => {
            await this.requireWorld(metadata, sandbox)
            await this.removeOwned(sandbox, metadata, key)
          })
        }
        released = true
        this.allocations.delete(key)
        this.preparations.delete(key)
        this.lossListeners.delete(key)
        if (this.allocations.size === 0) this.stopLossPolling()
      },
    })
  }

  private async assertCurrentAllocation(request: TeamWorkspacePrepareRequest): Promise<void> {
    await this.remoteSandbox()
    const state = await this.ctx.teams.getTeam({ teamId: request.teamId })
    const task = state.tasks.find(candidate => candidate.id === request.taskId)
    requireCurrent(task !== undefined, `Team task '${request.taskId}' is not available for remote allocation`)
    requireCurrent(state.team.phase === 'active', `Team '${request.teamId}' is not active for remote allocation`)
    requireCurrent(task.workspaceMode === 'remote', `Team task '${task.id}' does not request a remote workspace`)
    requireCurrent(task.phase === 'assigned' || task.phase === 'running', `Team task '${task.id}' has no active remote lease`)
    const lease = task.lease
    requireCurrent(lease !== undefined, `Team task '${task.id}' has no current remote lease`)
    requireCurrent(lease.expiresAt > Date.now(), `Team task '${task.id}' current lease has expired`)
    requireCurrent(lease.attemptId === request.attemptId, `Team task '${task.id}' attempt does not match remote allocation`)
    requireCurrent(lease.assignedRevision === request.assignedRevision, `Team task '${task.id}' assigned revision does not match remote allocation`)
    requireCurrent(lease.participantId === request.participantId, `Team task '${task.id}' participant does not match remote allocation`)
    requireCurrent(lease.activationId === request.activationId, `Team task '${task.id}' activation does not match remote allocation`)
    const participant = state.participants.find(candidate => candidate.id === request.participantId)
    requireCurrent(isActiveLocalAgent(participant), `Team participant '${request.participantId}' is not an active local Agent`)
    const binding = state.activations.find(candidate => candidate.activation.id === request.activationId)
    requireCurrent(
      binding !== undefined
      && binding.activation.teamId === request.teamId
      && binding.activation.participantId === request.participantId
      && binding.sessionId === request.sessionId
      && isDeliverableActivation(binding),
      `Team activation '${request.activationId}' does not match remote allocation ownership`,
    )
    requireCurrent(this.hasExactLiveAgent(binding), `Session '${request.sessionId}' is not a live local Agent for remote allocation`)
    const decision = await this.ctx.teams.authorize({
      hook: 'workspace-allocate',
      teamId: request.teamId,
      actorId: request.participantId,
      facts: {
        taskId: request.taskId,
        attemptId: request.attemptId,
        assignedRevision: request.assignedRevision,
        participantId: request.participantId,
        activationId: request.activationId,
        sessionId: request.sessionId,
        workspaceMode: 'remote',
        workspaceParent: this.config.workspaceParent,
      },
    })
    if (decision.kind === 'deny') throw new TeamError(decision.message, 'TEAM_POLICY_DENIED')
  }

  private isEligibleState(state: TeamStateSnapshot, task: TeamTaskSnapshot, binding: ActivationBindingSnapshot): boolean {
    const currentTask = state.tasks.find(candidate => candidate.id === task.id)
    const participant = state.participants.find(candidate => candidate.id === binding.activation.participantId)
    const currentBinding = state.activations.find(candidate => candidate.activation.id === binding.activation.id)
    return state.team.phase === 'active'
      && currentTask?.revision === task.revision
      && currentTask.workspaceMode === 'remote'
      && isActiveLocalAgent(participant)
      && currentBinding !== undefined
      && sameBindingIdentity(currentBinding, binding)
      && isDeliverableActivation(currentBinding)
  }

  private hasExactLiveAgent(binding: ActivationBindingSnapshot): boolean {
    const agent = this.ctx.agents.get(binding.sessionId)
    return agent !== undefined && agent.session.id === binding.sessionId
  }

  private metadata(request: TeamWorkspacePrepareRequest, sandboxId: string): TeamWorkspaceAllocationMetadata {
    return {
      id: teamWorkspaceAllocationIdSchema.parse(`remote-${createHash('sha256').update(`${this.config.providerName}:${allocationKey(request)}`).digest('hex')}`),
      provider: this.config.providerName,
      mode: 'remote',
      teamId: request.teamId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      assignedRevision: request.assignedRevision,
      participantId: request.participantId,
      activationId: request.activationId,
      sessionId: request.sessionId,
      executionWorld: teamWorkspaceExecutionWorldSchema.parse({ kind: 'e2b', id: sandboxId }),
    }
  }

  /** Stop future observations and wait for accepted loss and artifact operations. */
  async close(): Promise<void> {
    this.retired = true
    this.stopLossPolling()
    const results = await Promise.allSettled([...(this.polling === undefined ? [] : [this.polling]), ...this.artifactQueues.values()])
    const failures: unknown[] = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'E2B workspace observation teardown failed')
  }

  private async requireWorld(metadata: TeamWorkspaceAllocationMetadata, sandbox: import('@clocky/clocky-e2b').Sandbox): Promise<void> {
    if (metadata.executionWorld === undefined) throw new TeamError('Remote allocation has no durable execution-world identity', 'TEAM_INVALID_ARGUMENT')
    if (metadata.executionWorld.id !== sandbox.sandboxId) throw await this.lossError(metadata, 'world-changed')
    await sandbox.getInfo()
  }

  private async detectLoss<T>(metadata: TeamWorkspaceAllocationMetadata, operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error: unknown) {
      if (error instanceof SandboxNotFoundError) throw await this.lossError(metadata, 'sandbox-expired')
      throw error
    }
  }

  private async lossError(metadata: TeamWorkspaceAllocationMetadata, reason: TeamWorkspaceLoss['reason']): Promise<TeamWorkspaceLostError> {
    const executionWorld = metadata.executionWorld
    if (executionWorld === undefined) throw new TeamError('Remote loss has no recorded execution world', 'TEAM_INVALID_ARGUMENT')
    const loss: TeamWorkspaceLoss = {
      executionWorld, reason, terminationProven: reason === 'sandbox-expired', artifacts: await this.readRetainedArtifacts(metadata),
    }
    this.losses.set(allocationKey(metadata), loss)
    return new TeamWorkspaceLostError(loss)
  }

  private startLossPolling(): void {
    if (this.lossTimer !== undefined || this.retired) return
    this.lossTimer = setInterval(() => {
      if (this.polling !== undefined) return
      this.polling = this.pollLosses().catch((error: unknown) => {
        this.ctx.logger.warn(`team-workspace-e2b: loss observation did not settle: ${String(error)}`)
      }).finally(() => { this.polling = undefined })
    }, this.config.lossPollIntervalMs)
    this.lossTimer.unref()
  }

  private stopLossPolling(): void {
    if (this.lossTimer !== undefined) clearInterval(this.lossTimer)
    this.lossTimer = undefined
  }

  private async pollLosses(): Promise<void> {
    const allocations = [...this.allocations.values()]
    const count = Math.min(allocations.length, this.config.maxLossChecksPerPoll)
    for (let index = 0; index < count; index += 1) {
      const allocation = allocations[(this.pollCursor + index) % allocations.length]
      if (allocation === undefined || this.retired) break
      let loss = this.losses.get(allocationKey(allocation))
      if (loss?.terminationProven !== true) {
        try {
          await this.detectLoss(allocation, async () => {
            const sandbox = await this.remoteSandbox()
            await this.requireWorld(allocation, sandbox)
            await this.readManifest(sandbox, allocation, allocationKey(allocation))
          })
        } catch (error: unknown) {
          if (!(error instanceof TeamWorkspaceLostError)) continue
          loss = error.loss
        }
      }
      if (loss === undefined) continue
      const listeners = this.lossListeners.get(allocationKey(allocation))
      if (listeners === undefined) continue
      const results = await Promise.allSettled([...listeners].map(async (listener) => { await listener(structuredClone(loss)) }))
      for (const result of results) {
        if (result.status === 'rejected') this.ctx.logger.warn(`team-workspace-e2b: exact loss settlement failed: ${String(result.reason)}`)
      }
    }
    this.pollCursor = allocations.length === 0 ? 0 : (this.pollCursor + count) % allocations.length
  }

  private async readRetainedArtifacts(metadata: TeamWorkspaceAllocationMetadata): Promise<readonly TeamArtifactReference[]> {
    if (this.config.artifactProvider === undefined) return []
    const key = allocationKey(metadata)
    await this.artifactQueues.get(key)
    const cached = this.retainedArtifacts.get(key)
    if (cached !== undefined) return cached
    return await this.withArtifactManifest(metadata, references => Promise.resolve(references))
  }

  private async retainArtifact(metadata: TeamWorkspaceAllocationMetadata, artifact: TeamArtifactReference): Promise<void> {
    const key = allocationKey(metadata)
    const preceding = this.artifactQueues.get(key) ?? Promise.resolve()
    const append = async (): Promise<void> => {
      await this.withArtifactManifest(metadata, async (references, stream) => {
        if (references.some(reference => reference.id === artifact.id)) return
        if (references.length >= this.config.maxRetainedArtifacts) throw new TeamError('Remote artifact retention exceeds the configured bound', 'TEAM_INVALID_ARGUMENT')
        await stream.append(references.length - 1, [artifact])
        this.retainedArtifacts.set(key, [...references, artifact])
      })
    }
    const operation = preceding.then(append, append)
    this.artifactQueues.set(key, operation)
    try { await operation } finally { if (this.artifactQueues.get(key) === operation) this.artifactQueues.delete(key) }
  }

  private async withArtifactManifest<T>(
    metadata: TeamWorkspaceAllocationMetadata,
    operation: (references: readonly TeamArtifactReference[], stream: import('@clocky/clocky-storage-log').LogStream) => Promise<T>,
  ): Promise<T> {
    const logs = this.ctx.get('storageLog')
    if (logs === undefined) throw new TeamError('Remote provider-backed artifacts require storageLog for loss recovery', 'TEAM_INVALID_ARGUMENT')
    const key = createHash('sha256').update(`${metadata.provider}:${metadata.id}`).digest('hex')
    const stream = await logs.open(defineLogStream({ name: `e2b-workspace-artifacts/${key}`, version: 1 }))
    try {
      if (stream.firstSequence !== 0) throw new TeamError('Remote artifact manifest has an unsupported compacted prefix', 'TEAM_INVALID_ARGUMENT')
      const records = await stream.read(-1, this.config.maxRetainedArtifacts + 1)
      if (records.length > this.config.maxRetainedArtifacts) throw new TeamError('Remote artifact manifest exceeds its configured bound', 'TEAM_INVALID_ARGUMENT')
      const references = records.map((record, index) => {
        const reference = teamArtifactReferenceSchema.parse(record.value)
        if (record.sequence !== index || reference.provider === undefined || reference.sourceAttemptId !== metadata.attemptId) {
          throw new TeamError('Remote artifact manifest has invalid attempt provenance', 'TEAM_INVALID_ARGUMENT')
        }
        return reference
      })
      this.retainedArtifacts.set(allocationKey(metadata), references)
      return await operation(references, stream)
    } finally { await stream.close() }
  }
}

/** Mount the E2B remote provider without opening another sandbox. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(ctx, config)
  const provider = new E2BTeamWorkspaceProvider(ctx, resolved)
  ctx.effect(() => {
    const unregister = ctx.teamWorkspaces.registerProvider(provider)
    return async () => { unregister(); await provider.close() }
  }, 'teamWorkspaceE2B.registerProvider()')
}

function resolveConfig(ctx: Context, config: Config): ResolvedConfig {
  const providerName = normalized(config.providerName ?? DEFAULT_PROVIDER_NAME, 'providerName')
  const workspaceParent = normalizedRemoteRoot(
    config.workspaceParent ?? posix.join(ctx.e2b.runtimeRoot, 'team-workspaces'),
    'workspaceParent',
  )
  if (!posix.isAbsolute(workspaceParent)) throw new TypeError('team-workspace-e2b: workspaceParent must be an absolute POSIX path')
  if (!isPosixChild(ctx.e2b.runtimeRoot, workspaceParent)) {
    throw new TypeError('team-workspace-e2b: workspaceParent must be inside the E2B runtime root')
  }
  const integrationEnabled = config.integrationEnabled ?? false
  const integrationRoot = config.integrationRoot === undefined
    ? integrationEnabled ? posix.join(ctx.e2b.runtimeRoot, 'team-integrations') : undefined
    : normalizedRemoteRoot(config.integrationRoot, 'integrationRoot')
  if (integrationEnabled && config.artifactProvider === undefined) {
    throw new TypeError('team-workspace-e2b: artifactProvider is required when integrationEnabled is true')
  }
  if (integrationRoot !== undefined) {
    if (!posix.isAbsolute(integrationRoot) || !isPosixChild(ctx.e2b.runtimeRoot, integrationRoot)) {
      throw new TypeError('team-workspace-e2b: integrationRoot must be inside the E2B runtime root')
    }
    if (integrationRoot === workspaceParent
      || isPosixChild(integrationRoot, workspaceParent)
      || isPosixChild(workspaceParent, integrationRoot)) {
      throw new TypeError('team-workspace-e2b: integrationRoot and workspaceParent must not overlap')
    }
  }
  const artifactProvider = config.artifactProvider === undefined ? undefined : normalized(config.artifactProvider, 'artifactProvider')
  if (artifactProvider !== undefined && ctx.get('storageLog') === undefined) {
    throw new TypeError('team-workspace-e2b: artifactProvider requires storageLog for durable loss recovery')
  }
  return {
    providerName,
    workspaceParent,
    ...artifactProvider === undefined ? {} : { artifactProvider },
    maxArtifactBytes: positive(config.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES, 'maxArtifactBytes'),
    maxEntriesPerPublish: positive(config.maxEntriesPerPublish ?? DEFAULT_MAX_ENTRIES_PER_PUBLISH, 'maxEntriesPerPublish'),
    maxListDepth: positive(config.maxListDepth ?? DEFAULT_MAX_LIST_DEPTH, 'maxListDepth'),
    ...integrationRoot === undefined ? {} : { integrationRoot },
    integrationEnabled,
    maxIntegrationBytes: positive(config.maxIntegrationBytes ?? DEFAULT_MAX_INTEGRATION_BYTES, 'maxIntegrationBytes'),
    lossPollIntervalMs: positive(config.lossPollIntervalMs ?? 5000, 'lossPollIntervalMs'),
    maxLossChecksPerPoll: positive(config.maxLossChecksPerPoll ?? 16, 'maxLossChecksPerPoll'),
    maxRetainedArtifacts: positive(config.maxRetainedArtifacts ?? 4096, 'maxRetainedArtifacts'),
  }
}

async function materializeArtifacts(
  ctx: Context,
  sandbox: import('@clocky/clocky-e2b').Sandbox,
  allocation: TeamWorkspaceAllocation,
  files: readonly { readonly entry: EntryInfo; readonly path: string | undefined }[],
  config: ResolvedConfig,
  retain: (artifact: TeamArtifactReference) => Promise<void>,
): Promise<readonly TeamArtifactReference[]> {
  const artifacts: TeamArtifactReference[] = []
  const store = ctx.get('teamArtifacts')
  for (const candidate of files) {
    const path = candidate.path
    if (path === undefined || candidate.entry.size > config.maxArtifactBytes) continue
    const bytes = await sandbox.files.read(candidate.entry.path, { format: 'bytes' })
    if (bytes.byteLength > config.maxArtifactBytes) continue
    if (store !== undefined && config.artifactProvider !== undefined) {
      const artifact = await store.save(config.artifactProvider, {
        teamId: allocation.teamId,
        sourceAttemptId: allocation.attemptId,
        kind: 'file',
        visibility: 'team',
        name: path,
        data: bytes,
      })
      await retain(artifact)
      artifacts.push(artifact)
    } else {
      artifacts.push({
        id: `${config.providerName}:${String(allocation.attemptId)}:${path}`,
        kind: 'file',
        uri: `e2b://${sandbox.sandboxId}${candidate.entry.path}`,
        contentHash: createHash('sha256').update(bytes).digest('hex'),
        sourceAttemptId: allocation.attemptId,
        visibility: 'team',
      })
    }
  }
  return artifacts
}

/** Build one bounded portable change set from the current remote file list. */
async function materializeChangeSet(
  sandbox: import('@clocky/clocky-e2b').Sandbox,
  allocation: TeamWorkspaceAllocation,
  files: readonly { readonly entry: EntryInfo; readonly path: string }[],
  config: ResolvedConfig,
): Promise<string | undefined> {
  const changes: TeamWorkspaceChange[] = []
  for (const candidate of files) {
    if (candidate.entry.size > config.maxIntegrationBytes) return undefined
    const bytes = await sandbox.files.read(candidate.entry.path, { format: 'bytes' })
    if (bytes.byteLength > config.maxIntegrationBytes) return undefined
    changes.push({ path: candidate.path, kind: 'file', data: Buffer.from(bytes).toString('base64') })
  }
  if (changes.length === 0) return undefined
  try {
    return encodeTeamWorkspaceChangeSet({
      provider: config.providerName,
      sourceAttemptId: allocation.attemptId,
      changes,
    }, config.maxIntegrationBytes)
  } catch (error: unknown) {
    if (error instanceof TeamError && error.code === 'TEAM_INVALID_ARGUMENT') return undefined
    throw error
  }
}

/** Validate source identities before policy or artifact reads. */
function assertSourceIntegrationRequest(request: TeamWorkspaceSourceIntegrateRequest): void {
  if (String(request.source.teamId).length === 0
    || String(request.source.taskId).length === 0
    || String(request.source.attemptId).length === 0
    || String(request.integrationTaskId).length === 0
    || String(request.integrationAttemptId).length === 0) {
    throw new TeamError('remote E2B source integration identities must be non-empty', 'TEAM_INVALID_ARGUMENT')
  }
  if (request.target.length === 0 || request.target.trim() !== request.target) {
    throw new TeamError('remote E2B integration target must be non-empty without surrounding whitespace', 'TEAM_INVALID_ARGUMENT')
  }
}

/** Return a safe remote target directory below the configured integration root. */
function integrationTargetRoot(integrationRoot: string, target: string): string {
  if (target.startsWith('/') || target.includes('\\') || target.includes('\0')
    || target.split('/').some(part => part.length === 0 || part === '.' || part === '..')) {
    throw new TeamError('remote E2B integration target must be a relative path without dot segments', 'TEAM_INVALID_ARGUMENT')
  }
  const root = posix.join(integrationRoot, target)
  if (root === integrationRoot || !isPosixChild(integrationRoot, root)) {
    throw new TeamError('remote E2B integration target must be a child of integrationRoot', 'TEAM_INVALID_ARGUMENT')
  }
  return root
}

/** Apply a validated change set to one remote target directory. */
async function applyRemoteChanges(
  sandbox: import('@clocky/clocky-e2b').Sandbox,
  root: string,
  changes: readonly TeamWorkspaceChange[],
): Promise<void> {
  for (const change of changes) {
    const path = remotePortablePath(root, change.path)
    await ensureRemoteDirectoryPath(sandbox, root, posix.dirname(path))
    const existing = await remoteInfo(sandbox, path)
    if (change.kind === 'delete') {
      if (existing?.type === FileType.DIR) throw new TeamError(`remote E2B integration cannot delete directory '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
      await removeRemote(sandbox, path)
      continue
    }
    if (change.kind === 'symlink') {
      throw new TeamError(`remote E2B integration does not support symlink change '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
    }
    if (existing?.type === FileType.DIR) throw new TeamError(`remote E2B integration cannot replace directory '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
    if (existing?.symlinkTarget !== undefined || (existing !== undefined && existing.type !== FileType.FILE)) {
      throw new TeamError(`remote E2B integration cannot write through non-file '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
    }
    const bytes = Buffer.from(change.data, 'base64')
    await sandbox.files.write(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  }
}

/** Compute a content-derived version for one remote target directory. */
async function remoteDirectoryVersion(
  sandbox: import('@clocky/clocky-e2b').Sandbox,
  root: string,
  config: ResolvedConfig,
): Promise<string> {
  const info = await remoteInfo(sandbox, root)
  if (info === undefined) return 'missing'
  if (info.type !== FileType.DIR || info.symlinkTarget !== undefined) {
    throw new TeamError(`remote E2B integration target '${root}' is not a regular directory`, 'TEAM_INVALID_ARGUMENT')
  }
  const entries = await sandbox.files.list(root, { depth: config.maxListDepth })
  if (entries.length > config.maxEntriesPerPublish) {
    throw new TeamError(`remote E2B integration target exceeds the configured ${String(config.maxEntriesPerPublish)}-entry limit`, 'TEAM_INVALID_ARGUMENT')
  }
  const files: Array<{ readonly path: string; readonly size: number; readonly contentHash?: string; readonly modifiedAt?: string }> = []
  for (const entry of entries) {
    if (entry.type === FileType.DIR) continue
    if (entry.type !== FileType.FILE || entry.symlinkTarget !== undefined) {
      throw new TeamError(`remote E2B integration target contains a non-file entry '${entry.path}'`, 'TEAM_INVALID_ARGUMENT')
    }
    const path = relativeRemotePath(root, entry.path)
    if (path === undefined) throw new TeamError(`remote E2B integration target returned an out-of-root entry '${entry.path}'`, 'TEAM_INVALID_ARGUMENT')
    if (entry.size <= config.maxIntegrationBytes) {
      const bytes = await sandbox.files.read(entry.path, { format: 'bytes' })
      files.push({ path, size: bytes.byteLength, contentHash: createHash('sha256').update(bytes).digest('hex') })
    } else {
      files.push({
        path,
        size: entry.size,
        ...entry.modifiedTime === undefined ? {} : { modifiedAt: entry.modifiedTime.toISOString() },
      })
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}

/** Ensure one remote path's existing ancestors are regular directories. */
async function ensureRemoteDirectoryPath(
  sandbox: import('@clocky/clocky-e2b').Sandbox,
  root: string,
  path: string,
): Promise<void> {
  if (!isPosixChild(root, path) && path !== root) throw new TeamError('remote E2B integration path escapes its configured root', 'TEAM_INVALID_ARGUMENT')
  const relativePath = path === root ? '' : path.slice(`${root}/`.length)
  let current = root
  const rootInfo = await remoteInfo(sandbox, root)
  if (rootInfo !== undefined && (rootInfo.type !== FileType.DIR || rootInfo.symlinkTarget !== undefined)) {
    throw new TeamError(`remote E2B integration ancestor '${root}' is not a regular directory`, 'TEAM_INVALID_ARGUMENT')
  }
  if (rootInfo === undefined) await sandbox.files.makeDir(root)
  for (const part of relativePath.length === 0 ? [] : relativePath.split('/')) {
    current = posix.join(current, part)
    const info = await remoteInfo(sandbox, current)
    if (info === undefined) {
      await sandbox.files.makeDir(current)
    } else if (info.type !== FileType.DIR || info.symlinkTarget !== undefined) {
      throw new TeamError(`remote E2B integration ancestor '${current}' is not a regular directory`, 'TEAM_INVALID_ARGUMENT')
    }
  }
}

/** Map one portable path to a remote root without allowing escapes. */
function remotePortablePath(root: string, path: string): string {
  const result = posix.join(root, path)
  if (!isPosixChild(root, result)) throw new TeamError(`remote E2B integration path '${path}' escapes its target`, 'TEAM_INVALID_ARGUMENT')
  return result
}

/** Location of one provider-owned remote recovery marker. */
function integrationMarkerRoot(config: ResolvedConfig): string {
  return posix.join(config.workspaceParent, 'integration-markers')
}

/** Location of one source/integration operation marker. */
function integrationMarkerPath(config: ResolvedConfig, request: TeamWorkspaceSourceIntegrateRequest): string {
  return posix.join(integrationMarkerRoot(config), `${createHash('sha256').update(JSON.stringify([
    config.providerName,
    String(request.source.taskId),
    String(request.source.attemptId),
    String(request.integrationTaskId),
    String(request.integrationAttemptId),
    request.target,
  ])).digest('hex')}.json`)
}

/** Read one remote integration recovery marker. */
async function readIntegrationMarker(
  sandbox: import('@clocky/clocky-e2b').Sandbox,
  path: string,
): Promise<IntegrationMarker | undefined> {
  const info = await remoteInfo(sandbox, path)
  if (info === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(await sandbox.files.read(path, { format: 'text' }))
  } catch (error: unknown) {
    throw new TeamError(`remote integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT', { cause: error })
  }
  if (!isIntegrationMarker(parsed)) throw new TeamError(`remote integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT')
  return parsed
}

/** Write one remote integration marker. */
async function writeIntegrationMarker(
  sandbox: import('@clocky/clocky-e2b').Sandbox,
  path: string,
  marker: IntegrationMarker,
): Promise<void> {
  if (!isIntegrationMarker(marker)) throw new TeamError(`remote integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT')
  await sandbox.files.write(path, JSON.stringify(marker))
}

/** Match a remote marker to one exact source/integration operation. */
function sameIntegrationMarker(marker: IntegrationMarker, request: TeamWorkspaceSourceIntegrateRequest, provider: string): boolean {
  return marker.provider === provider
    && marker.sourceTaskId === String(request.source.taskId)
    && marker.sourceAttemptId === String(request.source.attemptId)
    && marker.integrationTaskId === String(request.integrationTaskId)
    && marker.integrationAttemptId === String(request.integrationAttemptId)
    && marker.target === request.target
}

/** Validate a provider-owned remote marker. */
function isIntegrationMarker(value: unknown): value is IntegrationMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.version === INTEGRATION_MARKER_VERSION
    && typeof record.provider === 'string'
    && typeof record.sourceTaskId === 'string'
    && typeof record.sourceAttemptId === 'string'
    && typeof record.integrationTaskId === 'string'
    && typeof record.integrationAttemptId === 'string'
    && typeof record.target === 'string'
    && typeof record.expectedVersion === 'string'
    && ((record.status === 'prepared' && record.targetVersion === undefined && typeof record.targetCreated === 'boolean')
      || (record.status === 'integrated' && typeof record.targetVersion === 'string'))
}

/** Parse the JSON payload stored in one provider-backed patch artifact. */
function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error: unknown) {
    throw new TeamError('remote E2B source patch artifact is not valid JSON', 'TEAM_INVALID_ARGUMENT', { cause: error })
  }
}

/** Check whether one POSIX path is a strict descendant of another path. */
function isPosixChild(parent: string, child: string): boolean {
  const prefix = parent.endsWith('/') ? parent : `${parent}/`
  return child.startsWith(prefix) && child.length > prefix.length
}

function allocationRoot(config: ResolvedConfig, key: string): string {
  const digest = createHash('sha256').update(`${config.providerName}:${key}`).digest('hex')
  return posix.join(config.workspaceParent, 'allocations', digest)
}

function manifestPath(config: ResolvedConfig, key: string): string {
  const digest = createHash('sha256').update(`${config.providerName}:${key}`).digest('hex')
  return posix.join(config.workspaceParent, 'manifests', `${digest}.json`)
}

function allocationKey(request: Pick<TeamWorkspacePrepareRequest, 'teamId' | 'taskId' | 'attemptId' | 'assignedRevision' | 'participantId' | 'activationId' | 'sessionId'>): string {
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

function relativeRemotePath(root: string, path: string): string | undefined {
  const prefix = root.endsWith('/') ? root : `${root}/`
  if (!path.startsWith(prefix)) return undefined
  const value = path.slice(prefix.length)
  return value.length === 0 || value.includes('\0') ? undefined : value
}

async function remoteInfo(sandbox: import('@clocky/clocky-e2b').Sandbox, path: string): Promise<EntryInfo | undefined> {
  try {
    return await sandbox.files.getInfo(path)
  } catch (error: unknown) {
    if (isRemoteNotFound(error)) return undefined
    throw error
  }
}

async function removeRemote(sandbox: import('@clocky/clocky-e2b').Sandbox, path: string): Promise<void> {
  try {
    await sandbox.files.remove(path)
  } catch (error: unknown) {
    if (!isRemoteNotFound(error)) throw error
  }
}

function isRemoteNotFound(error: unknown): boolean {
  return error instanceof FileNotFoundError
}

function sameBindingIdentity(left: ActivationBindingSnapshot, right: ActivationBindingSnapshot): boolean {
  return left.activation.id === right.activation.id
    && left.activation.teamId === right.activation.teamId
    && left.activation.participantId === right.activation.participantId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
}

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

function sameAllocation(left: TeamWorkspaceAllocation, right: TeamWorkspaceAllocation): boolean {
  return sameMetadata(left, right) && left.root === right.root
}

function isStoredManifest(value: unknown): value is StoredManifest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.version === MANIFEST_VERSION
    && typeof record.metadata === 'object'
    && record.metadata !== null
}

function isActiveLocalAgent(participant: ParticipantSnapshot | undefined): participant is ParticipantSnapshot {
  return participant?.kind === 'local-agent' && participant.phase === 'active'
}

function isDeliverableActivation(binding: ActivationBindingSnapshot): boolean {
  return binding.activation.status === 'idle' || binding.activation.status === 'running'
}

function normalized(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) throw new TypeError(`team-workspace-e2b: ${label} must be non-empty without surrounding whitespace`)
  return value
}

function normalizedRemoteRoot(value: string, label: string): string {
  const normalized = posix.normalize(value)
  if (normalized.includes('\0')) throw new TypeError(`team-workspace-e2b: ${label} must not contain a NUL byte`)
  return normalized
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`team-workspace-e2b: ${label} must be a positive safe integer`)
  return value
}

function requireCurrent(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TeamError(message, 'TEAM_INVALID_ARGUMENT')
}
