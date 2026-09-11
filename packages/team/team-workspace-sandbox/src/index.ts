/**
 * Local isolated Team sandbox workspace provider. It owns a deterministic
 * provider-created directory for one exact task attempt, optionally seeds it
 * from a configured source directory, and publishes bounded file manifests.
 * The task Agent Client exposes the returned root to the existing filesystem
 * and process Consumers; this provider does not claim a filesystem lock.
 *
 * @module @clocky/clocky-team-workspace-sandbox
 */

import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { Buffer } from 'node:buffer'
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type {} from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-team-artifact'
import { TeamError, teamWorkspaceAllocationIdSchema } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ParticipantSnapshot,
  TeamStateSnapshot,
  TeamTaskSnapshot,
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
} from '@clocky/clocky-team-workspace'
import type { TeamWorkspaceChange, TeamWorkspaceChangeSet } from '@clocky/clocky-team-workspace'

/** Cordis plugin name. */
export const name = 'team-workspace-sandbox'
/** Workspace registry, Team authority, and local Agent registry must exist before allocation. */
export const inject = ['teamWorkspaces', 'teams', 'agents']

const DEFAULT_PROVIDER_NAME = 'sandbox-local'
const DEFAULT_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_INTEGRATION_BYTES = 8 * 1024 * 1024
const MANIFEST_VERSION = 1 as const
const INTEGRATION_MARKER_VERSION = 1 as const

/** Local isolated sandbox configuration. */
export interface Config {
  /** Registry identity used in durable allocation metadata. */
  readonly providerName?: string
  /** Absolute existing directory under which provider-owned roots are created. */
  readonly allocationParent: string
  /** Optional absolute directory copied into each newly created sandbox root. */
  readonly sourceRoot?: string
  /** Optional artifact provider used for bounded changed-file bytes. */
  readonly artifactProvider?: string
  /** Maximum file size read for hashes and provider-backed artifact publication. */
  readonly maxArtifactBytes?: number
  /** Absolute existing directory that contains provider-specific integration targets. */
  readonly integrationRoot?: string
  /** Explicitly enables provider-specific target-directory integration. */
  readonly integrationEnabled?: boolean
  /** Maximum encoded change-set and decoded file bytes accepted by integration. */
  readonly maxIntegrationBytes?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  providerName: z.string().default(DEFAULT_PROVIDER_NAME),
  allocationParent: z.string(),
  sourceRoot: z.string(),
  artifactProvider: z.string().min(1),
  maxArtifactBytes: z.number().step(1).min(1).default(DEFAULT_MAX_ARTIFACT_BYTES),
  integrationRoot: z.string(),
  integrationEnabled: z.boolean().default(false),
  maxIntegrationBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INTEGRATION_BYTES),
})

interface ResolvedConfig {
  readonly providerName: string
  readonly allocationParent: string
  readonly sourceRoot?: string
  readonly artifactProvider?: string
  readonly maxArtifactBytes: number
  readonly integrationRoot?: string
  readonly integrationEnabled: boolean
  readonly maxIntegrationBytes: number
}

type FileFingerprint =
  | { readonly kind: 'file'; readonly size: number; readonly modifiedAt: number; readonly contentHash?: string }
  | { readonly kind: 'symlink'; readonly target: string }
  | { readonly kind: 'other'; readonly type: string }

interface StoredManifest {
  readonly version: typeof MANIFEST_VERSION
  readonly metadata: TeamWorkspaceAllocationMetadata
  readonly baseline: Readonly<Record<string, FileFingerprint>>
}

interface IntegrationMarker {
  readonly version: typeof INTEGRATION_MARKER_VERSION
  readonly provider: string
  readonly sourceTaskId: string
  readonly sourceAttemptId: string
  readonly integrationTaskId: string
  readonly integrationAttemptId: string
  readonly target: string
  readonly expectedVersion: string
  readonly targetVersion: string
  readonly status: 'prepared' | 'integrated'
}

/** Local provider that owns one isolated root per exact task attempt. */
class SandboxTeamWorkspaceProvider implements TeamWorkspaceProvider {
  readonly modes = ['sandbox'] as const
  private readonly preparations = new Map<string, TeamWorkspacePreparation>()
  private readonly allocations = new Map<string, TeamWorkspaceAllocation>()
  private readonly materializations = new Map<string, Promise<TeamWorkspaceAllocation>>()
  /** Serialize provider-specific integration operations for one target path. */
  private readonly integrationQueues = new Map<string, Promise<void>>()

  /**
   * @param ctx - Context carrying Team authority and local Agent discovery.
   * @param config - Canonical immutable provider configuration.
   */
  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  /** Provider registry identity. */
  get name(): string { return this.config.providerName }

  /**
   * Check sandbox allocation and seed roots before activating a Participant.
   * @param request - task, active Participant, and candidate runtime route.
   * @returns whether this sandbox deployment can accept the task mode.
   */
  async preflight(request: TeamWorkspacePreflightRequest): Promise<boolean> {
    return request.task.workspaceMode === 'sandbox'
      && request.participant.phase === 'active'
      && await isDirectory(this.config.allocationParent)
      && (this.config.sourceRoot === undefined || await isDirectory(this.config.sourceRoot))
  }

  /**
   * Report whether a current local Agent can consume an isolated sandbox.
   * @param request - scheduler task and activation facts.
   * @returns false for stale, non-local, or unavailable sandbox candidates.
   */
  async eligible(request: TeamWorkspaceEligibilityRequest): Promise<boolean> {
    if (request.task.workspaceMode !== 'sandbox') return false
    if (!(await isDirectory(this.config.allocationParent))) return false
    if (this.config.sourceRoot !== undefined && !(await isDirectory(this.config.sourceRoot))) return false
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
    await this.assertCurrentAllocation(request)
    const key = allocationKey(request)
    const existing = this.preparations.get(key)
    if (existing !== undefined) return existing
    const metadata = this.metadata(request)
    let abandoned = false
    const preparation: TeamWorkspacePreparation = Object.freeze({
      ...metadata,
      materialize: async (): Promise<TeamWorkspaceAllocation> => {
        if (abandoned) throw new TeamError(`sandbox allocation '${metadata.id}' was abandoned`, 'TEAM_INVALID_ARGUMENT')
        await this.assertCurrentAllocation(request)
        const current = this.allocations.get(key)
        if (current !== undefined) return current
        const pending = this.materializations.get(key)
        if (pending !== undefined) return await pending
        const materialization = this.materializeOwned(metadata, key).then((allocation) => {
          this.allocations.set(key, allocation)
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

  /** Reopen an exact provider-owned sandbox root from its sidecar manifest. */
  async restore(
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
  ): Promise<TeamWorkspaceAllocation> {
    const expected = this.metadata(request)
    if (!sameMetadata(metadata, expected)) {
      throw new TeamError(`sandbox allocation '${metadata.id}' is not owned by this provider`, 'TEAM_INVALID_ARGUMENT')
    }
    await this.assertCurrentAllocation(request)
    const key = allocationKey(request)
    const current = this.allocations.get(key)
    if (current !== undefined) return current
    await assertDirectory(allocationRoot(this.config, key))
    const manifest = await this.readManifest(metadata, key)
    const allocation = this.createAllocation(metadata, key, allocationRoot(this.config, key), manifest)
    this.allocations.set(key, allocation)
    return allocation
  }

  /** Reconcile release without allocating a new root. */
  async reconcileRelease(
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
  ): Promise<void> {
    const expected = this.metadata(request)
    if (!sameMetadata(metadata, expected)) {
      throw new TeamError(`sandbox allocation '${metadata.id}' is not owned by this provider`, 'TEAM_INVALID_ARGUMENT')
    }
    const key = allocationKey(request)
    const current = this.allocations.get(key)
    if (current !== undefined) {
      await current.release()
      return
    }
    await this.removeOwned(metadata, key)
    this.preparations.delete(key)
  }

  /**
   * Publish changed files from an owned sandbox without integrating them.
   * @param request - exact live allocation selected by the task attempt.
   * @returns bounded changed paths and optional provider-backed file artifacts.
   */
  async publish(request: TeamWorkspacePublishRequest): Promise<TeamWorkspacePublishResult> {
    const key = allocationKey(request.allocation)
    const allocation = this.allocations.get(key)
    if (allocation === undefined || !sameAllocation(allocation, request.allocation)) {
      throw new TeamError(`sandbox allocation for task attempt '${request.allocation.attemptId}' is not live`, 'TEAM_INVALID_ARGUMENT')
    }
    const manifest = await this.readManifest(allocation, key)
    const current = await snapshotDirectory(allocation.root, this.config.maxArtifactBytes)
    const changedPaths = [...new Set([...Object.keys(manifest.baseline), ...Object.keys(current)])]
      .filter(path => !isDeepStrictEqual(manifest.baseline[path], current[path]))
      .sort()
    const artifacts = [...await materializeArtifacts(this.ctx, allocation, changedPaths, this.config)]
    const patchData = await materializeChangeSet(allocation, manifest.baseline, current, this.config)
    const artifactStore = this.ctx.get('teamArtifacts')
    if (patchData !== undefined
      && this.config.integrationRoot !== undefined
      && artifactStore !== undefined
      && this.config.artifactProvider !== undefined) {
      artifacts.push(await artifactStore.save(this.config.artifactProvider, {
        teamId: allocation.teamId,
        sourceAttemptId: allocation.attemptId,
        kind: 'patch',
        visibility: 'team',
        name: `sandbox-${String(allocation.taskId)}-${String(allocation.attemptId)}.changes.json`,
        data: patchData,
      }))
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
   * Integrate one completed source attempt through a provider-owned target directory.
   * @param request - source artifact provenance, target, and operation mode.
   * @returns a proposal or target-directory integration result.
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
      throw new TeamError('sandbox integration authority is disabled by configuration', 'TEAM_POLICY_DENIED')
    }
    const store = this.ctx.get('teamArtifacts')
    if (store === undefined || this.config.artifactProvider === undefined || this.config.integrationRoot === undefined) {
      throw new TeamError(
        'sandbox source integration requires integrationEnabled, integrationRoot, and a configured artifact provider',
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
    return await this.serializeIntegration(request.target, async () => await this.applyChangeSet(request, artifact, changeSet))
  }

  /** Serialize one provider-specific target operation within this process. */
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

  /** Apply a validated change set with an expected-version fence and recovery marker. */
  private async applyChangeSet(
    request: TeamWorkspaceSourceIntegrateRequest,
    artifact: import('@clocky/clocky-team').TeamArtifactReference,
    changeSet: TeamWorkspaceChangeSet,
  ): Promise<TeamWorkspaceSourceIntegrateResult> {
    const integrationRoot = this.config.integrationRoot
    if (integrationRoot === undefined) {
      throw new TeamError('sandbox integration requires a configured integrationRoot', 'TEAM_INVALID_ARGUMENT')
    }
    const targetRoot = integrationTargetRoot(this.config, request.target)
    const markerPathname = integrationMarkerPath(this.config, request)
    const backupPathname = integrationBackupPath(markerPathname, targetRoot)
    const currentVersion = await directoryVersion(targetRoot, this.config.maxIntegrationBytes)
    const previous = await readIntegrationMarker(markerPathname)
    if (previous !== undefined) {
      if (!sameIntegrationMarker(previous, request, this.config.providerName)) {
        throw new TeamError(`sandbox integration marker '${markerPathname}' does not match the current request`, 'TEAM_INVALID_ARGUMENT')
      }
      if (currentVersion === previous.targetVersion) {
        if (request.expectedTarget !== undefined && request.expectedTarget !== previous.expectedVersion) {
          return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
        }
        if (previous.status === 'prepared') {
          await rm(backupPathname, { recursive: true, force: true })
          await writeIntegrationMarker(markerPathname, { ...previous, status: 'integrated' })
        }
        return teamWorkspaceSourceIntegrationResult(request, { status: 'integrated', targetVersion: previous.targetVersion, artifact })
      }
      if (previous.status === 'prepared' && currentVersion === previous.expectedVersion) {
        await rm(markerPathname, { force: true })
        await rm(backupPathname, { recursive: true, force: true })
      } else if (previous.status === 'prepared' && currentVersion === 'missing' && await pathExists(backupPathname)) {
        await rename(backupPathname, targetRoot)
        await rm(markerPathname, { force: true })
        return await this.applyChangeSet(request, artifact, changeSet)
      } else {
        return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
      }
    }
    if (request.expectedTarget !== undefined && request.expectedTarget !== currentVersion) {
      return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
    }
    await ensureRegularDirectoryPath(integrationRoot, dirname(targetRoot))
    const stage = await mkdtemp(join(dirname(targetRoot), '.clocky-team-sandbox-integration-'))
    let targetMoved = false
    let stageMoved = false
    let backup: string | undefined
    try {
      if (await pathExists(targetRoot)) {
        await assertDirectory(targetRoot)
        await copyDirectoryContents(targetRoot, stage)
      }
      await applyChanges(stage, changeSet.changes)
      const targetVersion = await directoryVersion(stage, this.config.maxIntegrationBytes)
      if (await directoryVersion(targetRoot, this.config.maxIntegrationBytes) !== currentVersion) {
        return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
      }
      await ensureRegularDirectoryPath(this.config.allocationParent, integrationMarkerRoot(this.config))
      await writeIntegrationMarker(markerPathname, {
        version: INTEGRATION_MARKER_VERSION,
        provider: this.config.providerName,
        sourceTaskId: String(request.source.taskId),
        sourceAttemptId: String(request.source.attemptId),
        integrationTaskId: String(request.integrationTaskId),
        integrationAttemptId: String(request.integrationAttemptId),
        target: request.target,
        expectedVersion: currentVersion,
        targetVersion,
        status: 'prepared',
      })
      if (await pathExists(targetRoot)) {
        backup = backupPathname
        await rm(backup, { recursive: true, force: true })
        await rename(targetRoot, backup)
        targetMoved = true
      }
      await rename(stage, targetRoot)
      stageMoved = true
      await writeIntegrationMarker(markerPathname, {
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
    } finally {
      const failures: unknown[] = []
      if (!stageMoved) {
        try {
          await rm(stage, { recursive: true, force: true })
        } catch (error: unknown) {
          failures.push(error)
        }
      }
      if (targetMoved && !stageMoved && backup !== undefined) {
        try {
          if (!(await pathExists(targetRoot))) await rename(backup, targetRoot)
        } catch (error: unknown) {
          failures.push(error)
        }
      }
      if (stageMoved && backup !== undefined) {
        try {
          await rm(backup, { recursive: true, force: true })
        } catch (error: unknown) {
          failures.push(error)
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'team-workspace-sandbox: integration cleanup failed')
    }
  }

  private async materializeOwned(
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
  ): Promise<TeamWorkspaceAllocation> {
    const root = allocationRoot(this.config, key)
    const manifest = await this.readManifestIfPresent(metadata, key)
    if (await pathExists(root)) {
      if (manifest === undefined) {
        throw new TeamError(`sandbox allocation root '${root}' is not owned by this provider`, 'TEAM_INVALID_ARGUMENT')
      }
      await assertDirectory(root)
      return this.createAllocation(metadata, key, root, manifest)
    }
    if (manifest !== undefined) {
      await this.createRoot(root)
      try {
        await this.seedRoot(root)
      } catch (error: unknown) {
        await rm(root, { recursive: true, force: true })
        throw error
      }
      return this.createAllocation(metadata, key, root, manifest)
    }
    await this.createRoot(root)
    try {
      await this.seedRoot(root)
      const baseline = await snapshotDirectory(root, this.config.maxArtifactBytes)
      const created: StoredManifest = { version: MANIFEST_VERSION, metadata, baseline }
      await writeFile(manifestPath(this.config, key), JSON.stringify(created), { flag: 'wx', mode: 0o600 })
      return this.createAllocation(metadata, key, root, created)
    } catch (error: unknown) {
      await rm(root, { recursive: true, force: true })
      throw error
    }
  }

  private async createRoot(root: string): Promise<void> {
    if (!isChildPath(this.config.allocationParent, root)) {
      throw new TeamError(`sandbox allocation root '${root}' escapes its configured parent`, 'TEAM_INVALID_ARGUMENT')
    }
    try {
      await mkdir(root, { mode: 0o700 })
    } catch (error: unknown) {
      if (isAlreadyExists(error)) {
        throw new TeamError(`sandbox allocation root '${root}' was created concurrently`, 'TEAM_INVALID_ARGUMENT', { cause: error })
      }
      throw error
    }
  }

  private async seedRoot(root: string): Promise<void> {
    if (this.config.sourceRoot === undefined) return
    await cp(this.config.sourceRoot, root, { recursive: true, dereference: false, force: false })
  }

  private async readManifest(metadata: TeamWorkspaceAllocationMetadata, key: string): Promise<StoredManifest> {
    const manifest = await this.readManifestIfPresent(metadata, key)
    if (manifest === undefined) {
      throw new TeamError(`sandbox allocation '${metadata.id}' has no provider manifest`, 'TEAM_INVALID_ARGUMENT')
    }
    return manifest
  }

  private async readManifestIfPresent(
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
  ): Promise<StoredManifest | undefined> {
    let raw: string
    try {
      raw = await readFile(manifestPath(this.config, key), 'utf8')
    } catch (error: unknown) {
      if (isNotFound(error)) return undefined
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error: unknown) {
      throw new TeamError(`sandbox allocation '${metadata.id}' has an invalid provider manifest`, 'TEAM_INVALID_ARGUMENT', { cause: error })
    }
    if (!isStoredManifest(parsed) || !sameMetadata(parsed.metadata, metadata)) {
      throw new TeamError(`sandbox allocation '${metadata.id}' has a mismatched provider manifest`, 'TEAM_INVALID_ARGUMENT')
    }
    return parsed
  }

  private async removeOwned(metadata: TeamWorkspaceAllocationMetadata, key: string): Promise<void> {
    const manifest = await this.readManifestIfPresent(metadata, key)
    const root = allocationRoot(this.config, key)
    if (manifest === undefined) {
      if (await pathExists(root)) {
        throw new TeamError(`sandbox allocation root '${root}' has no provider manifest`, 'TEAM_INVALID_ARGUMENT')
      }
      return
    }
    await rm(root, { recursive: true, force: true })
    await rm(manifestPath(this.config, key), { force: true })
  }

  private createAllocation(
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
    root: string,
    _manifest: StoredManifest,
  ): TeamWorkspaceAllocation {
    let released = false
    return Object.freeze({
      ...metadata,
      root,
      release: async (): Promise<void> => {
        if (released) return
        await this.removeOwned(metadata, key)
        released = true
        this.allocations.delete(key)
        this.preparations.delete(key)
      },
    })
  }

  private async assertCurrentAllocation(request: TeamWorkspacePrepareRequest): Promise<void> {
    if (!(await isDirectory(this.config.allocationParent))) {
      throw new TeamError(`sandbox allocation parent '${this.config.allocationParent}' is unavailable`, 'TEAM_INVALID_ARGUMENT')
    }
    if (this.config.sourceRoot !== undefined && !(await isDirectory(this.config.sourceRoot))) {
      throw new TeamError(`sandbox source root '${this.config.sourceRoot}' is unavailable`, 'TEAM_INVALID_ARGUMENT')
    }
    const state = await this.ctx.teams.getTeam({ teamId: request.teamId })
    const task = state.tasks.find(candidate => candidate.id === request.taskId)
    requireCurrent(task !== undefined, `Team task '${request.taskId}' is not available for sandbox allocation`)
    requireCurrent(state.team.phase === 'active', `Team '${request.teamId}' is not active for sandbox allocation`)
    requireCurrent(task.workspaceMode === 'sandbox', `Team task '${task.id}' does not request a sandbox workspace`)
    requireCurrent(task.phase === 'assigned' || task.phase === 'running', `Team task '${task.id}' has no active sandbox lease`)
    const lease = task.lease
    requireCurrent(lease !== undefined, `Team task '${task.id}' has no current sandbox lease`)
    requireCurrent(lease.expiresAt > Date.now(), `Team task '${task.id}' current lease has expired`)
    requireCurrent(lease.attemptId === request.attemptId, `Team task '${task.id}' attempt does not match sandbox allocation`)
    requireCurrent(lease.assignedRevision === request.assignedRevision, `Team task '${task.id}' assigned revision does not match sandbox allocation`)
    requireCurrent(lease.participantId === request.participantId, `Team task '${task.id}' participant does not match sandbox allocation`)
    requireCurrent(lease.activationId === request.activationId, `Team task '${task.id}' activation does not match sandbox allocation`)
    const participant = state.participants.find(candidate => candidate.id === request.participantId)
    requireCurrent(isActiveLocalAgent(participant), `Team participant '${request.participantId}' is not an active local Agent`)
    const binding = state.activations.find(candidate => candidate.activation.id === request.activationId)
    requireCurrent(
      binding !== undefined
      && binding.activation.teamId === request.teamId
      && binding.activation.participantId === request.participantId
      && binding.sessionId === request.sessionId
      && isDeliverableActivation(binding),
      `Team activation '${request.activationId}' does not match sandbox allocation ownership`,
    )
    requireCurrent(this.hasExactLiveAgent(binding), `Session '${request.sessionId}' is not a live local Agent for sandbox allocation`)
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
        workspaceMode: 'sandbox',
        allocationParent: this.config.allocationParent,
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
      && currentTask.workspaceMode === 'sandbox'
      && isActiveLocalAgent(participant)
      && currentBinding !== undefined
      && sameBindingIdentity(currentBinding, binding)
      && isDeliverableActivation(currentBinding)
  }

  private hasExactLiveAgent(binding: ActivationBindingSnapshot): boolean {
    const agent = this.ctx.agents.get(binding.sessionId)
    return agent !== undefined && agent.session.id === binding.sessionId
  }

  private metadata(request: TeamWorkspacePrepareRequest): TeamWorkspaceAllocationMetadata {
    const key = allocationKey(request)
    return {
      id: teamWorkspaceAllocationIdSchema.parse(`sandbox-${createHash('sha256').update(`${this.config.providerName}:${key}`).digest('hex')}`),
      provider: this.config.providerName,
      mode: 'sandbox',
      teamId: request.teamId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      assignedRevision: request.assignedRevision,
      participantId: request.participantId,
      activationId: request.activationId,
      sessionId: request.sessionId,
      baseVersion: this.config.sourceRoot === undefined
        ? 'empty'
        : `source:${createHash('sha256').update(this.config.sourceRoot).digest('hex')}`,
    }
  }
}

/** Mount the local sandbox provider after validating its roots and bounds. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = await resolveConfig(config)
  const provider = new SandboxTeamWorkspaceProvider(ctx, resolved)
  ctx.effect(() => ctx.teamWorkspaces.registerProvider(provider), 'teamWorkspaceSandbox.registerProvider()')
}

async function resolveConfig(config: Config): Promise<ResolvedConfig> {
  const providerName = normalized(config.providerName ?? DEFAULT_PROVIDER_NAME, 'providerName')
  const allocationParent = await canonicalDirectory(config.allocationParent, 'allocationParent')
  const sourceRoot = config.sourceRoot === undefined ? undefined : await canonicalDirectory(config.sourceRoot, 'sourceRoot')
  const integrationRoot = config.integrationRoot === undefined ? undefined : await canonicalDirectory(config.integrationRoot, 'integrationRoot')
  const integrationEnabled = config.integrationEnabled ?? false
  if (integrationEnabled && integrationRoot === undefined) {
    throw new TypeError('team-workspace-sandbox: integrationRoot is required when integrationEnabled is true')
  }
  if (integrationEnabled && config.artifactProvider === undefined) {
    throw new TypeError('team-workspace-sandbox: artifactProvider is required when integrationEnabled is true')
  }
  for (const [label, root] of [['sourceRoot', sourceRoot], ['integrationRoot', integrationRoot]] as const) {
    if (root !== undefined && (isPathUnder(root, allocationParent) || isPathUnder(allocationParent, root))) {
      throw new TypeError(`team-workspace-sandbox: ${label} and allocationParent must not overlap`)
    }
  }
  if (sourceRoot !== undefined && integrationRoot !== undefined
    && (isPathUnder(sourceRoot, integrationRoot) || isPathUnder(integrationRoot, sourceRoot))) {
    throw new TypeError('team-workspace-sandbox: sourceRoot and integrationRoot must not overlap')
  }
  const maxArtifactBytes = positive(config.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES, 'maxArtifactBytes')
  const maxIntegrationBytes = positive(config.maxIntegrationBytes ?? DEFAULT_MAX_INTEGRATION_BYTES, 'maxIntegrationBytes')
  return {
    providerName,
    allocationParent,
    ...sourceRoot === undefined ? {} : { sourceRoot },
    ...integrationRoot === undefined ? {} : { integrationRoot },
    ...config.artifactProvider === undefined ? {} : { artifactProvider: normalized(config.artifactProvider, 'artifactProvider') },
    maxArtifactBytes,
    integrationEnabled,
    maxIntegrationBytes,
  }
}

async function canonicalDirectory(value: string, label: string): Promise<string> {
  if (!isAbsolute(value)) throw new TypeError(`team-workspace-sandbox: ${label} must be an absolute path`)
  let canonical: string
  try {
    canonical = await realpath(value)
  } catch (error: unknown) {
    throw new TypeError(`team-workspace-sandbox: ${label} '${value}' cannot be canonicalized`, { cause: error })
  }
  if (!(await isDirectory(canonical))) throw new TypeError(`team-workspace-sandbox: ${label} '${value}' is not a directory`)
  return canonical
}

async function snapshotDirectory(root: string, maxArtifactBytes: number): Promise<Record<string, FileFingerprint>> {
  const result: Record<string, FileFingerprint> = {}
  await visit(root, '')
  return result

  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath)
        continue
      }
      if (entry.isSymbolicLink()) {
        result[relativePath] = { kind: 'symlink', target: await readlink(absolutePath) }
        continue
      }
      if (!entry.isFile()) {
        result[relativePath] = { kind: 'other', type: 'other' }
        continue
      }
      const info = await lstat(absolutePath)
      const fingerprint: FileFingerprint = { kind: 'file', size: info.size, modifiedAt: info.mtimeMs }
      if (info.size <= maxArtifactBytes) {
        Object.assign(fingerprint, { contentHash: createHash('sha256').update(await readFile(absolutePath)).digest('hex') })
      }
      result[relativePath] = fingerprint
    }
  }
}

async function materializeArtifacts(
  ctx: Context,
  allocation: TeamWorkspaceAllocation,
  paths: readonly string[],
  config: ResolvedConfig,
): Promise<readonly import('@clocky/clocky-team').TeamArtifactReference[]> {
  const artifacts: import('@clocky/clocky-team').TeamArtifactReference[] = []
  const store = ctx.get('teamArtifacts')
  for (const path of paths) {
    const absolute = join(allocation.root, path)
    if (!isChildPath(allocation.root, absolute)) continue
    let info
    try {
      info = await lstat(absolute)
    } catch (error: unknown) {
      if (isNotFound(error)) continue
      throw error
    }
    if (!info.isFile() || info.size > config.maxArtifactBytes) continue
    const bytes = await readFile(absolute)
    if (store !== undefined && config.artifactProvider !== undefined) {
      artifacts.push(await store.save(config.artifactProvider, {
        teamId: allocation.teamId,
        sourceAttemptId: allocation.attemptId,
        kind: 'file',
        visibility: 'team',
        name: path,
        data: bytes,
      }))
    } else {
      artifacts.push({
        id: `${config.providerName}:${String(allocation.attemptId)}:${path}`,
        kind: 'file',
        uri: absolute,
        contentHash: createHash('sha256').update(bytes).digest('hex'),
        sourceAttemptId: allocation.attemptId,
        visibility: 'team',
      })
    }
  }
  return artifacts
}

/** Build one bounded portable change set from a sandbox baseline and current tree. */
async function materializeChangeSet(
  allocation: TeamWorkspaceAllocation,
  baseline: Readonly<Record<string, FileFingerprint>>,
  current: Readonly<Record<string, FileFingerprint>>,
  config: ResolvedConfig,
): Promise<string | undefined> {
  const paths = [...new Set([...Object.keys(baseline), ...Object.keys(current)])]
    .filter(path => !isDeepStrictEqual(baseline[path], current[path]))
    .sort()
  const changes: TeamWorkspaceChange[] = []
  for (const path of paths) {
    const entry = current[path]
    if (entry === undefined) {
      changes.push({ path, kind: 'delete' })
      continue
    }
    if (entry.kind === 'symlink') {
      changes.push({ path, kind: 'symlink', target: entry.target })
      continue
    }
    if (entry.kind !== 'file' || entry.size > config.maxIntegrationBytes) return undefined
    const bytes = await readFile(join(allocation.root, path))
    if (bytes.byteLength > config.maxIntegrationBytes) return undefined
    changes.push({ path, kind: 'file', data: Buffer.from(bytes).toString('base64') })
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
    throw new TeamError('sandbox source integration identities must be non-empty', 'TEAM_INVALID_ARGUMENT')
  }
  if (request.target.length === 0 || request.target.trim() !== request.target) {
    throw new TeamError('sandbox integration target must be non-empty without surrounding whitespace', 'TEAM_INVALID_ARGUMENT')
  }
}

/** Return the provider-owned target directory for one portable target name. */
function integrationTargetRoot(config: ResolvedConfig, target: string): string {
  if (config.integrationRoot === undefined) {
    throw new TeamError('sandbox integration requires a configured integrationRoot', 'TEAM_INVALID_ARGUMENT')
  }
  if (target.includes('\\') || target.includes('\0') || isAbsolute(target)) {
    throw new TeamError('sandbox integration target must be a relative path without backslashes', 'TEAM_INVALID_ARGUMENT')
  }
  const root = resolvePath(config.integrationRoot, target)
  if (root === config.integrationRoot || !isChildPath(config.integrationRoot, root)) {
    throw new TeamError('sandbox integration target must be a child of integrationRoot', 'TEAM_INVALID_ARGUMENT')
  }
  return root
}

/** Apply one portable change set to a staged regular directory. */
async function applyChanges(root: string, changes: readonly TeamWorkspaceChange[]): Promise<void> {
  for (const change of changes) {
    const absolute = portablePath(root, change.path)
    await ensureRegularDirectoryPath(root, dirname(absolute))
    let existing
    try {
      existing = await lstat(absolute)
    } catch (error: unknown) {
      if (!isNotFound(error)) throw error
    }
    if (change.kind === 'delete') {
      if (existing !== undefined && existing.isDirectory()) {
        throw new TeamError(`sandbox integration cannot delete directory '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
      }
      await rm(absolute, { force: true })
      continue
    }
    if (existing !== undefined && existing.isDirectory()) {
      throw new TeamError(`sandbox integration cannot replace directory '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
    }
    if (change.kind === 'file') {
      if (existing?.isSymbolicLink()) {
        throw new TeamError(`sandbox integration cannot write through symlink '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
      }
      await writeFile(absolute, Buffer.from(change.data, 'base64'), { mode: 0o600 })
    } else {
      await rm(absolute, { force: true })
      await symlink(change.target, absolute)
    }
  }
}

/** Copy a target tree without following symlinks or changing the source. */
async function copyDirectoryContents(source: string, destination: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await cp(join(source, entry.name), join(destination, entry.name), {
      recursive: true,
      dereference: false,
      force: false,
    })
  }
}

/** Ensure every existing ancestor is a regular directory and create missing ancestors. */
async function ensureRegularDirectoryPath(root: string, path: string): Promise<void> {
  const descendant = relative(root, path)
  if (descendant === '..' || descendant.startsWith(`..${sep}`) || isAbsolute(descendant)) {
    throw new TeamError('sandbox integration path escapes its configured root', 'TEAM_INVALID_ARGUMENT')
  }
  let current = root
  for (const part of descendant.length === 0 ? [] : descendant.split(sep)) {
    current = join(current, part)
    let info
    try {
      info = await lstat(current)
    } catch (error: unknown) {
      if (!isNotFound(error)) throw error
      try {
        await mkdir(current, { mode: 0o700 })
        continue
      } catch (mkdirError: unknown) {
        if (!isAlreadyExists(mkdirError)) throw mkdirError
        info = await lstat(current)
      }
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new TeamError(`sandbox integration ancestor '${current}' is not a regular directory`, 'TEAM_INVALID_ARGUMENT')
    }
  }
}

/** Map a validated portable path to a local root without following path escapes. */
function portablePath(root: string, path: string): string {
  const absolute = join(root, ...path.split('/'))
  if (!isChildPath(root, absolute)) throw new TeamError(`sandbox integration path '${path}' escapes its target`, 'TEAM_INVALID_ARGUMENT')
  return absolute
}

/** Compute a content-derived version for one integration target directory. */
async function directoryVersion(root: string, maxBytes: number): Promise<string> {
  if (!(await pathExists(root))) return 'missing'
  await assertDirectory(root)
  const snapshot = await snapshotDirectory(root, maxBytes)
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

/** Location of one provider-owned recovery marker, outside user integration targets. */
function integrationMarkerPath(config: ResolvedConfig, request: TeamWorkspaceSourceIntegrateRequest): string {
  return join(integrationMarkerRoot(config), `${createHash('sha256').update(JSON.stringify([
    config.providerName,
    String(request.source.taskId),
    String(request.source.attemptId),
    String(request.integrationTaskId),
    String(request.integrationAttemptId),
    request.target,
  ])).digest('hex')}.json`)
}

/** Provider-owned marker directory for restart-safe local integration settlement. */
function integrationMarkerRoot(config: ResolvedConfig): string {
  return join(config.allocationParent, '.clocky-team-sandbox-integrations')
}

/** Deterministic provider-owned backup used to recover a crash after target removal. */
function integrationBackupPath(markerPathname: string, targetRoot: string): string {
  return join(dirname(targetRoot), `.clocky-team-sandbox-backup-${createHash('sha256').update(markerPathname).digest('hex')}`)
}

/** Read one recovery marker, rejecting malformed state rather than inferring it. */
async function readIntegrationMarker(path: string): Promise<IntegrationMarker | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error: unknown) {
    throw new TeamError(`sandbox integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT', { cause: error })
  }
  if (!isIntegrationMarker(parsed)) throw new TeamError(`sandbox integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT')
  return parsed
}

/** Write a marker only after validating its own lifecycle fields. */
async function writeIntegrationMarker(path: string, marker: IntegrationMarker): Promise<void> {
  if (!isIntegrationMarker(marker)) throw new TeamError(`sandbox integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT')
  await writeFile(path, JSON.stringify(marker), { mode: 0o600, flag: marker.status === 'prepared' ? 'wx' : 'w' })
}

/** Match a recovery marker to one exact source/integration operation. */
function sameIntegrationMarker(marker: IntegrationMarker, request: TeamWorkspaceSourceIntegrateRequest, provider: string): boolean {
  return marker.provider === provider
    && marker.sourceTaskId === String(request.source.taskId)
    && marker.sourceAttemptId === String(request.source.attemptId)
    && marker.integrationTaskId === String(request.integrationTaskId)
    && marker.integrationAttemptId === String(request.integrationAttemptId)
    && marker.target === request.target
}

/** Validate a recovery marker loaded from provider-owned disk. */
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
    && typeof record.targetVersion === 'string'
    && (record.status === 'prepared' || record.status === 'integrated')
}

/** Parse the JSON payload stored in one provider-backed patch artifact. */
function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error: unknown) {
    throw new TeamError('sandbox source patch artifact is not valid JSON', 'TEAM_INVALID_ARGUMENT', { cause: error })
  }
}

function allocationRoot(config: ResolvedConfig, key: string): string {
  const digest = createHash('sha256').update(`${config.providerName}:${key}`).digest('hex')
  return join(config.allocationParent, `.clocky-team-sandbox-${digest}`)
}

function manifestPath(config: ResolvedConfig, key: string): string {
  return join(config.allocationParent, `.clocky-team-sandbox-${createHash('sha256').update(`${config.providerName}:${key}`).digest('hex')}.manifest.json`)
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
    && typeof record.baseline === 'object'
    && record.baseline !== null
}

function isActiveLocalAgent(participant: ParticipantSnapshot | undefined): participant is ParticipantSnapshot {
  return participant?.kind === 'local-agent' && participant.phase === 'active'
}

function isDeliverableActivation(binding: ActivationBindingSnapshot): boolean {
  return binding.activation.status === 'idle' || binding.activation.status === 'running'
}

function isChildPath(parent: string, child: string): boolean {
  const descendant = relative(parent, child)
  return descendant.length > 0 && descendant !== '..' && !descendant.startsWith(`..${sep}`) && !isAbsolute(descendant)
}

function isPathUnder(path: string, parent: string): boolean {
  return path === parent || isChildPath(parent, path)
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error: unknown) {
    if (isNotFound(error)) return false
    throw error
  }
}

async function assertDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new TeamError(`sandbox allocation root '${path}' is not a regular directory`, 'TEAM_INVALID_ARGUMENT')
  }
}

function normalized(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) throw new TypeError(`team-workspace-sandbox: ${label} must be non-empty without surrounding whitespace`)
  return value
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`team-workspace-sandbox: ${label} must be a positive safe integer`)
  return value
}

function requireCurrent(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TeamError(message, 'TEAM_INVALID_ARGUMENT')
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
