/**
 * Local shared-root Team workspace provider for exact local-Agent task attempts.
 *
 * The provider hands out no filesystem lock or isolated checkout. It verifies
 * that a live Agent Session already owns the configured canonical root, then
 * retains only a logical attempt allocation until its caller releases it. An
 * explicit separate target root can opt into portable change-set integration.
 *
 * @module @clocky/clocky-team-workspace-shared
 */

import { createHash, randomUUID } from 'node:crypto'
import { snapshotDirectory, fingerprintDirectoryEntries, readBoundedBaseline } from './fingerprint.ts'
import type { FileFingerprint, DirectorySnapshot, ScanLimits } from './fingerprint.ts'
import { teamWorkspaceObservationIdSchema, teamWorkspaceScanVersionSchema } from '@clocky/clocky-team'
import type { TeamWorkspaceObservation, TeamWorkspaceObservationInput, TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope, TeamWorkspaceScanVersion } from '@clocky/clocky-team'
import { Buffer } from 'node:buffer'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { dirname, isAbsolute, join, parse as parsePath, relative, resolve as resolvePath, sep } from 'node:path'
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
export const name = 'team-workspace-shared'
/** Workspace registration, Team authority, and live local Agents must exist before allocation. */
export const inject = ['teamWorkspaces', 'teams', 'agents']

const DEFAULT_PROVIDER_NAME = 'shared-local'
const DEFAULT_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_INTEGRATION_BYTES = 8 * 1024 * 1024
const MANIFEST_VERSION = 2 as const
const INTEGRATION_MARKER_VERSION = 1 as const

/** Local shared-workspace provider configuration. */
export interface Config {
  /** Existing sidecar directory; defaults to integration state or a provider-owned child of the shared root. */
  readonly observationStateRoot?: string
  /** Maximum directory entries inspected by one observation, including directories. */
  readonly observationMaxEntries?: number
  /** Maximum aggregate file bytes hashed by one observation. */
  readonly observationMaxHashBytes?: number
  /** Maximum individual file bytes read by one observation. */
  readonly observationMaxFileBytes?: number
  /** Elapsed traversal/read budget; filesystem metadata calls may finish after the deadline. */
  readonly observationTimeoutMs?: number
  /** Maximum proven changed paths retained in one observation record. */
  readonly observationMaxPaths?: number
  /** Maximum encoded baseline-sidecar bytes written or parsed. */
  readonly observationMaxStateBytes?: number
  /** Optional interval for default-off periodic observations of live allocations. */
  readonly observationPulseIntervalMs?: number
  /** Maximum live allocations observed by one periodic pulse. */
  readonly observationMaxAllocationsPerPulse?: number
  /** Required absolute path to the existing shared execution root. */
  readonly root: string
  /** Allow each durable Team workspacePath to select its own existing shared root. */
  readonly allowTeamWorkspacePath?: boolean
  /** Registry name published for diagnostics and HMR-safe replacement. */
  readonly providerName?: string
  /** Optional artifact provider used for bounded changed-file and patch bytes. */
  readonly artifactProvider?: string
  /** Maximum file size read for hashes and provider-backed artifact publication. */
  readonly maxArtifactBytes?: number
  /** Absolute existing directory containing provider-specific integration targets. */
  readonly integrationRoot?: string
  /** Explicitly enables provider-specific target-directory integration. */
  readonly integrationEnabled?: boolean
  /** Maximum encoded change-set and decoded file bytes accepted by integration. */
  readonly maxIntegrationBytes?: number
}

/** Schemastery validator for {@link Config}. Filesystem checks run during provider mounting. */
export const Config: z<Config> = z.object({
  observationStateRoot: z.string(),
  observationMaxStateBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16 * 1024 * 1024),
  observationMaxEntries: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(2048),
  observationMaxHashBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16 * 1024 * 1024),
  observationMaxFileBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8 * 1024 * 1024),
  observationTimeoutMs: z.number().step(1).min(1).max(2147483647).default(2000),
  observationMaxPaths: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(128),
  observationPulseIntervalMs: z.number().step(1).min(1).max(2147483647).default(undefined as unknown as number),
  observationMaxAllocationsPerPulse: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1),
  root: z.string(),
  allowTeamWorkspacePath: z.boolean().default(false),
  providerName: z.string().default(DEFAULT_PROVIDER_NAME),
  artifactProvider: z.string().min(1),
  maxArtifactBytes: z.number().step(1).min(1).default(DEFAULT_MAX_ARTIFACT_BYTES),
  integrationRoot: z.string(),
  integrationEnabled: z.boolean().default(false),
  maxIntegrationBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INTEGRATION_BYTES),
})

/** Fully validated configuration retained by one provider instance. */
interface ResolvedConfig extends ScanLimits {
  readonly observationStateRoot: string
  readonly observationMaxPaths: number
  readonly observationMaxStateBytes: number
  readonly observationPulseIntervalMs?: number
  readonly observationMaxAllocationsPerPulse: number
  /** Canonical existing directory shared by every accepted local attempt. */
  readonly root: string
  /** Whether a durable Team workspacePath may select the allocation root. */
  readonly allowTeamWorkspacePath: boolean
  /** Registry identity selected before registration. */
  readonly providerName: string
  /** Optional provider-backed artifact store identity. */
  readonly artifactProvider?: string
  /** Maximum file size inspected during publication. */
  readonly maxArtifactBytes: number
  /** Canonical directory containing provider-specific integration targets. */
  readonly integrationRoot?: string
  /** Whether source change sets may update integration targets. */
  readonly integrationEnabled: boolean
  /** Maximum encoded change-set and decoded file bytes. */
  readonly maxIntegrationBytes: number
}

interface StoredManifest {
  readonly version: typeof MANIFEST_VERSION
  readonly metadata: TeamWorkspaceAllocationMetadata
  readonly baseline: Readonly<Record<string, FileFingerprint>>
  readonly scan: TeamWorkspaceScanVersion
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

/** Local provider that returns one configured root without claiming filesystem ownership. */
class SharedTeamWorkspaceProvider implements TeamWorkspaceProvider {
  readonly modes = ['shared'] as const
  private readonly preparations = new Map<string, TeamWorkspacePreparation>()
  private readonly allocations = new Map<string, TeamWorkspaceAllocation>()
  private readonly materializations = new Map<string, Promise<TeamWorkspaceAllocation>>()
  private readonly unavailableBaselines = new Set<string>()
  private readonly observedScans = new Map<string, DirectorySnapshot>()
  private readonly observationQueues = new Map<string, Promise<unknown>>()
  private readonly observationProofs = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()
  private readonly baselines = new Map<string, StoredManifest>()
  /** Canonical execution root retained for each live or recovering allocation. */
  private readonly roots = new Map<string, string>()
  /** Serialize provider-specific integration operations for one target path. */
  private readonly integrationQueues = new Map<string, Promise<void>>()
  private pulseTail = Promise.resolve()
  private pulseClosing = false

  /**
   * @param ctx - Context carrying Team authority and the live local Agent registry.
   * @param config - Canonical immutable provider configuration.
   */
  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {
    ctx.effect(() => ctx.teams.registerSystemWorkspaceAllocationProofSource({
      name: `team-workspace-observation/${config.providerName}`,
      resolveWorkspaceAllocationProof: proof => this.observationProofs.get(proof),
    }), 'teamWorkspaceShared.observationAuthority()')
  }

  /** Provider registry identity. */
  get name(): string { return this.config.providerName }

  /** Configured fallback root used when a Team does not carry a selected workspace. */
  private get root(): string { return this.config.root }

  /** Start an optional bounded periodic observation loop and return its async disposer. */
  startObservationPulse(): () => Promise<void> {
    const interval = this.config.observationPulseIntervalMs
    if (interval === undefined) return async () => {}
    const timer = setInterval(() => {
      if (this.pulseClosing) return
      const operation = this.pulseTail.then(() => this.runObservationPulse())
      this.pulseTail = operation.catch((error: unknown) => {
        this.ctx.logger.warn(`team-workspace-shared: periodic observation failed: ${String(error)}`)
      })
    }, interval)
    timer.unref()
    return async () => {
      this.pulseClosing = true
      clearInterval(timer)
      await this.pulseTail
    }
  }

  /** Observe at most the configured number of currently live allocations in map order. */
  private async runObservationPulse(): Promise<void> {
    let selected = 0
    for (const [key, allocation] of this.allocations) {
      if (this.pulseClosing || selected >= this.config.observationMaxAllocationsPerPulse) return
      selected += 1
      try {
        await this.observeAllocation(allocation, key, 'periodic')
      } catch (error: unknown) {
        this.ctx.logger.warn(`team-workspace-shared: periodic observation skipped allocation '${allocation.id}': ${String(error)}`)
      }
    }
  }

  /**
   * Reject a route whose configured cwd cannot equal the provider-owned shared root.
   * @param request - task, active Participant, and candidate runtime route.
   * @returns whether the route can use this shared root before activation.
   */
  async preflight(request: TeamWorkspacePreflightRequest): Promise<boolean> {
    if (request.task.workspaceMode !== 'shared' || request.participant.teamId !== request.task.teamId
      || request.participant.phase !== 'active' || request.route.cwd.length === 0) return false
    const state = await this.ctx.teams.getTeam({ teamId: request.task.teamId })
    let root: string
    try { root = await this.rootForState(state) } catch { return false }
    if (!(await isDirectory(root))) return false
    try { return await realpath(request.route.cwd) === root } catch { return false }
  }

  /**
   * Report whether this provider can execute the exact current task/binding pair.
   * @param request - Scheduler-observed task and durable activation binding.
   * @returns false for every non-shared, stale, non-local, unavailable-root, or cwd mismatch case.
   */
  async eligible(request: TeamWorkspaceEligibilityRequest): Promise<boolean> {
    if (request.task.workspaceMode !== 'shared') return false
    const state = await this.ctx.teams.getTeam({ teamId: request.task.teamId })
    let root: string
    try {
      root = await this.rootForState(state)
    } catch {
      return false
    }
    return await isDirectory(root)
      && this.isEligibleState(state, request.task, request.binding)
      && await this.hasExactLiveAgent(request.binding, root)
  }

  /**
   * Reserve deterministic root-less metadata before the Team owner binds it.
   * @param request - Current lease, owner, activation, and Session fences.
   * @returns the logical shared-root reservation; repeated current requests reuse it until abandonment or release.
   */
  async prepare(request: TeamWorkspacePrepareRequest): Promise<TeamWorkspacePreparation> {
    const root = await this.assertCurrentAllocation(request)
    const key = allocationKey(request)
    this.roots.set(key, root)
    const existing = this.preparations.get(key)
    if (existing !== undefined) return existing
    const metadata = this.metadata(request, root)
    let abandoned = false
    const preparation: TeamWorkspacePreparation = Object.freeze({
      ...metadata,
      materialize: async (): Promise<TeamWorkspaceAllocation> => {
        if (abandoned) throw new TeamError(`shared workspace allocation '${metadata.id}' was abandoned`, 'TEAM_INVALID_ARGUMENT')
        await this.assertCurrentAllocation(request)
        const existing = this.allocations.get(key)
        if (existing !== undefined) return existing
        const pending = this.materializations.get(key)
        if (pending !== undefined) return await pending
        const materialization = this.materializeOwned(metadata, key, root).then((allocation) => {
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
        if (!this.allocations.has(key)) this.roots.delete(key)
        return Promise.resolve()
      },
    })
    this.preparations.set(key, preparation)
    return preparation
  }

  /** Reopen the configured shared root only for metadata this provider minted. */
  async restore(
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
  ): Promise<TeamWorkspaceAllocation> {
    const state = await this.ctx.teams.getTeam({ teamId: request.teamId })
    const root = await this.rootForState(state)
    const expected = this.metadata(request, root)
    if (!sameMetadata(metadata, expected)) {
      throw new TeamError(`shared workspace allocation '${metadata.id}' is not owned by this provider`, 'TEAM_INVALID_ARGUMENT')
    }
    const preparation = await this.prepare(request)
    return await preparation.materialize()
  }

  /** Prove logical shared-root cleanup without recreating an execution scope. */
  async reconcileRelease(
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
  ): Promise<void> {
    const state = await this.ctx.teams.getTeam({ teamId: request.teamId })
    const root = await this.rootForState(state, true)
    const expected = this.metadata(request, root)
    if (!sameMetadata(metadata, expected)) {
      throw new TeamError(`shared workspace allocation '${metadata.id}' is not owned by this provider`, 'TEAM_INVALID_ARGUMENT')
    }
    const key = allocationKey(request)
    const allocation = this.allocations.get(key)
    if (allocation !== undefined) await allocation.release()
    else {
      try { await this.observeAllocation(metadata, key, 'release', undefined, undefined, root) } catch (error: unknown) {
        this.ctx.logger.warn(`team-workspace-shared: recovery observation could not be recorded: ${String(error)}`)
      }
    }
    await this.removeManifest(key)
    this.preparations.delete(key)
    this.roots.delete(key)
  }

  /**
   * Publish bounded changes from an owned shared root without integrating them.
   * A configured artifact store additionally receives a portable patch for the
   * provider's explicit target-directory integration authority.
   * @param request - exact live allocation selected by the task attempt.
   * @returns the allocation provenance, changed paths, and optional artifacts.
   */
  async publish(request: TeamWorkspacePublishRequest): Promise<TeamWorkspacePublishResult> {
    const key = allocationKey(request.allocation)
    const allocation = this.allocations.get(key)
    if (allocation === undefined || allocation !== request.allocation || !sameAllocation(allocation, request.allocation)) {
      throw new TeamError(
        `shared workspace allocation for task attempt '${request.allocation.attemptId}' is not live`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const observation = await this.observeAllocation(allocation, key, 'publish', undefined, request.signal)
    request.signal?.throwIfAborted()
    const current = this.observedScans.get(key)
    if (current === undefined) throw new TeamError('Workspace publication has no retained current scan', 'TEAM_INVALID_ARGUMENT')
    const changedPaths = observation.paths.map(path => path.path)
    const artifacts = this.config.artifactProvider === undefined ? []
      : [...await materializeArtifacts(this.ctx, allocation, changedPaths, this.config)]
    const patchData = observation.truncated ? undefined
      : await materializeChangeSet(allocation, observation.paths, current.files, this.config)
    const store = this.ctx.get('teamArtifacts')
    if (patchData !== undefined && store !== undefined && this.config.artifactProvider !== undefined) {
      artifacts.push(await store.save(this.config.artifactProvider, {
        teamId: allocation.teamId,
        sourceAttemptId: allocation.attemptId,
        kind: 'patch',
        visibility: 'team',
        name: `shared-${String(allocation.taskId)}-${String(allocation.attemptId)}.changes.json`,
        data: patchData,
      }))
    }
    void request.target
    return {
      teamId: allocation.teamId,
      taskId: allocation.taskId,
      attemptId: allocation.attemptId,
      changedPaths,
      observation,
      artifacts,
      accepted: false,
    }
  }

  /**
   * Integrate one completed source attempt into a provider-owned target
   * directory. The shared source root is never used as the integration target.
   * @param request - source artifact provenance, target, and operation mode.
   * @returns a proposal or target-directory integration result.
   */
  async integrateSource(request: TeamWorkspaceSourceIntegrateRequest): Promise<TeamWorkspaceSourceIntegrateResult> {
    assertSourceIntegrationRequest(request)
    const artifact = selectTeamWorkspacePatchArtifact(request)
    const state = await this.ctx.teams.getTeam({ teamId: request.source.teamId })
    const sourceAllocation = state.workspaceAllocations.find(value => value.taskId === request.source.taskId
      && value.attemptId === request.source.attemptId && value.provider === this.name)
    const live = [...this.allocations.values()].find(value => value.id === sourceAllocation?.id)
    const observation = live === undefined ? sourceAllocation?.observation
      : await this.observeAllocation(live, allocationKey(live), 'integration')
    if (sourceAllocation !== undefined && (observation === undefined || observation.truncated)) {
      throw new TeamError('Shared source integration requires a complete latest workspace observation', 'TEAM_POLICY_DENIED')
    }
    const decision = await this.ctx.teams.authorize({
      hook: 'workspace-integrate',
      teamId: request.source.teamId,
      ...request.actorId === undefined ? {} : { actorId: request.actorId },
      facts: {
        operation: 'source-integration',
        ...observation === undefined ? {} : { observationId: observation.id, sourceVersion: observation.final.digest },
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
      throw new TeamError('shared integration authority is disabled by configuration', 'TEAM_POLICY_DENIED')
    }
    const store = this.ctx.get('teamArtifacts')
    if (store === undefined || this.config.artifactProvider === undefined || this.config.integrationRoot === undefined) {
      throw new TeamError(
        'shared source integration requires integrationEnabled, integrationRoot, and a configured artifact provider',
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

  /** Apply a validated source change set with a content-version fence. */
  private async applyChangeSet(
    request: TeamWorkspaceSourceIntegrateRequest,
    artifact: import('@clocky/clocky-team').TeamArtifactReference,
    changeSet: TeamWorkspaceChangeSet,
  ): Promise<TeamWorkspaceSourceIntegrateResult> {
    const integrationRoot = this.config.integrationRoot
    if (integrationRoot === undefined) {
      throw new TeamError('shared integration requires a configured integrationRoot', 'TEAM_INVALID_ARGUMENT')
    }
    const targetRoot = integrationTargetRoot(this.config, request.target)
    const markerPathname = integrationMarkerPath(this.config, request)
    const backupPathname = integrationBackupPath(markerPathname, targetRoot)
    const currentVersion = await directoryVersion(targetRoot, this.config)
    const previous = await readIntegrationMarker(markerPathname)
    if (previous !== undefined) {
      if (!sameIntegrationMarker(previous, request, this.config.providerName)) {
        throw new TeamError(`shared integration marker '${markerPathname}' does not match the current request`, 'TEAM_INVALID_ARGUMENT')
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
    const stage = await mkdtemp(join(dirname(targetRoot), '.clocky-team-shared-integration-'))
    let targetMoved = false
    let stageMoved = false
    let backup: string | undefined
    try {
      if (await pathExists(targetRoot)) {
        await assertDirectory(targetRoot)
        await copyDirectoryContents(targetRoot, stage)
      }
      await applyChanges(stage, changeSet.changes)
      const targetVersion = await directoryVersion(stage, this.config)
      if (await directoryVersion(targetRoot, this.config) !== currentVersion) {
        return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
      }
      await ensureRegularDirectoryPath(integrationRoot, dirname(markerPathname))
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
        try { await rm(stage, { recursive: true, force: true }) } catch (error: unknown) { failures.push(error) }
      }
      if (targetMoved && !stageMoved && backup !== undefined) {
        try {
          if (!(await pathExists(targetRoot))) await rename(backup, targetRoot)
        } catch (error: unknown) { failures.push(error) }
      }
      if (stageMoved && backup !== undefined) {
        try { await rm(backup, { recursive: true, force: true }) } catch (error: unknown) { failures.push(error) }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'team-workspace-shared: integration cleanup failed')
    }
  }

  /** Materialize the logical shared allocation and retain its bounded source baseline. */
  private async materializeOwned(
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
    root: string,
  ): Promise<TeamWorkspaceAllocation> {
    const current = this.allocations.get(key)
    if (current !== undefined) return current
    const stored = await this.readManifestIfPresent(metadata, key)
    const scan = stored === undefined ? await snapshotDirectory(root, this.config) : { files: stored.baseline, version: stored.scan }
    let manifest = stored ?? { version: MANIFEST_VERSION, metadata, baseline: scan.files, scan: scan.version }
    const durable = (await this.ctx.teams.getTeam({ teamId: metadata.teamId })).workspaceAllocations.find(value => value.id === metadata.id)
    if (durable === undefined) throw new TeamError('Workspace materialization requires its durable allocation reservation', 'TEAM_INVALID_ARGUMENT')
    if (stored === undefined && durable.observation !== undefined) {
      this.unavailableBaselines.add(key)
      manifest = { ...manifest, baseline: {}, scan: durable.observation.base ?? durable.observation.final }
    }
    if (stored === undefined && durable.observation === undefined && Buffer.byteLength(JSON.stringify(manifest), 'utf8') > this.config.observationMaxStateBytes) {
      manifest = { ...manifest, scan: { ...manifest.scan, complete: false,
        digest: fingerprintDirectoryEntries(manifest.baseline, false),
        incompleteReasons: [...new Set([...manifest.scan.incompleteReasons, 'state-byte-limit'])].sort() } }
    }
    if (stored === undefined && durable.observation === undefined && !manifest.scan.incompleteReasons.includes('state-byte-limit')) {
      try {
        await writeFile(manifestPath(this.config, key), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 })
      } catch (error: unknown) {
        if (!isAlreadyExists(error)) throw error
        manifest = await this.readManifest(metadata, key)
      }
    }
    this.baselines.set(key, manifest)
    const allocation = this.createAllocation(metadata, key, root)
    if (durable.observation === undefined) await this.observeAllocation(allocation, key, 'baseline', { files: manifest.baseline, version: manifest.scan }, undefined, root)
    else await this.observeAllocation(allocation, key, 'restore')
    return allocation
  }

  /** Read a provider-owned baseline sidecar, rejecting malformed recovery state. */
  private async readManifest(metadata: TeamWorkspaceAllocationMetadata, key: string): Promise<StoredManifest> {
    const manifest = await this.readManifestIfPresent(metadata, key)
    if (manifest === undefined) {
      throw new TeamError(`shared workspace allocation '${metadata.id}' has no provider baseline`, 'TEAM_INVALID_ARGUMENT')
    }
    return manifest
  }

  /** Read one optional provider-owned baseline sidecar. */
  private async readManifestIfPresent(
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
  ): Promise<StoredManifest | undefined> {
    let raw: string
    try {
      raw = (await readBoundedBaseline(manifestPath(this.config, key), this.config.observationMaxStateBytes)).toString('utf8')
    } catch (error: unknown) {
      if (isNotFound(error)) return undefined
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error: unknown) {
      throw new TeamError(`shared workspace allocation '${metadata.id}' has an invalid provider baseline`, 'TEAM_INVALID_ARGUMENT', { cause: error })
    }
    if (!isStoredManifest(parsed) || !sameMetadata(parsed.metadata, metadata)) {
      throw new TeamError(`shared workspace allocation '${metadata.id}' has a mismatched provider baseline`, 'TEAM_INVALID_ARGUMENT')
    }
    return parsed
  }

  /** Remove one provider-owned source baseline after logical allocation release. */
  private async removeManifest(key: string): Promise<void> {
    await rm(manifestPath(this.config, key), { force: true })
    this.baselines.delete(key)
  }

  /** Check immutable mode, current durable records, and the exact live local Agent before policy authorization. */
  private async assertCurrentAllocation(request: TeamWorkspacePrepareRequest): Promise<string> {
    const state = await this.ctx.teams.getTeam({ teamId: request.teamId })
    const root = await this.rootForState(state)
    if (!(await isDirectory(root))) {
      throw new TeamError(`shared Team workspace root '${root}' is not an existing directory`, 'TEAM_INVALID_ARGUMENT')
    }
    const task = state.tasks.find(candidate => candidate.id === request.taskId)
    requireCurrent(task !== undefined, `Team task '${request.taskId}' is not available for shared workspace allocation`)
    requireCurrent(state.team.phase === 'active', `Team '${request.teamId}' is not active for shared workspace allocation`)
    requireCurrent(task.workspaceMode === 'shared', `Team task '${task.id}' does not request a shared workspace`)
    requireCurrent(
      task.phase === 'assigned' || task.phase === 'running',
      `Team task '${task.id}' does not hold an active shared workspace lease`,
    )
    const lease = task.lease
    requireCurrent(lease !== undefined, `Team task '${task.id}' has no current shared workspace lease`)
    requireCurrent(lease.expiresAt > Date.now(), `Team task '${task.id}' current lease has expired`)
    requireCurrent(lease.attemptId === request.attemptId, `Team task '${task.id}' attempt does not match shared allocation`)
    requireCurrent(
      lease.assignedRevision === request.assignedRevision,
      `Team task '${task.id}' assigned revision does not match shared allocation`,
    )
    requireCurrent(
      lease.participantId === request.participantId,
      `Team task '${task.id}' participant does not match shared allocation`,
    )
    requireCurrent(
      lease.activationId === request.activationId,
      `Team task '${task.id}' activation does not match shared allocation`,
    )
    const participant = state.participants.find(candidate => candidate.id === request.participantId)
    requireCurrent(
      isActiveLocalAgent(participant),
      `Team participant '${request.participantId}' is not an active local Agent`,
    )
    const binding = state.activations.find(candidate => candidate.activation.id === request.activationId)
    requireCurrent(
      binding !== undefined
      && binding.activation.teamId === request.teamId
      && binding.activation.participantId === request.participantId
      && binding.sessionId === request.sessionId
      && isDeliverableActivation(binding),
      `Team activation '${request.activationId}' does not match shared allocation ownership`,
    )
    requireCurrent(
      await this.hasExactLiveAgent(binding, root),
      `Session '${request.sessionId}' is not a live local Agent at shared workspace root '${root}'`,
    )
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
        workspaceMode: 'shared',
        root,
      },
    })
    if (decision.kind === 'deny') throw new TeamError(decision.message, 'TEAM_POLICY_DENIED')
    return root
  }

  /** Resolve the canonical shared root selected by durable Team rules. */
  private async rootForState(state: TeamStateSnapshot, allowMissing = false): Promise<string> {
    const configured = this.config.allowTeamWorkspacePath && typeof state.rules.workspacePath === 'string'
      ? state.rules.workspacePath
      : this.root
    if (configured === this.root) return this.root
    if (!isAbsolute(configured)) {
      throw new TeamError(`Team '${state.team.id}' workspacePath must be an absolute path`, 'TEAM_INVALID_ARGUMENT')
    }
    try {
      const root = await realpath(configured)
      if (!(await isDirectory(root))) {
        throw new TeamError(`shared Team workspace root '${configured}' is not an existing directory`, 'TEAM_INVALID_ARGUMENT')
      }
      return root
    } catch (error: unknown) {
      if (allowMissing && isNotFound(error)) return resolvePath(configured)
      if (error instanceof TeamError) throw error
      throw new TeamError(`shared Team workspace root '${configured}' cannot be canonicalized`, 'TEAM_INVALID_ARGUMENT', { cause: error })
    }
  }

  /** Compare the current Team projection with a scheduler's candidate task and binding. */
  private isEligibleState(
    state: TeamStateSnapshot,
    task: TeamTaskSnapshot,
    binding: ActivationBindingSnapshot,
  ): boolean {
    const currentTask = state.tasks.find(candidate => candidate.id === task.id)
    const participant = state.participants.find(candidate => candidate.id === binding.activation.participantId)
    const currentBinding = state.activations.find(candidate => candidate.activation.id === binding.activation.id)
    return state.team.phase === 'active'
      && currentTask?.revision === task.revision
      && currentTask.workspaceMode === 'shared'
      && isActiveLocalAgent(participant)
      && currentBinding !== undefined
      && sameBindingIdentity(currentBinding, binding)
      && isDeliverableActivation(currentBinding)
  }

  /** Match one currently registered local Agent's canonical Session cwd to the selected root. */
  private async hasExactLiveAgent(binding: ActivationBindingSnapshot, root: string): Promise<boolean> {
    const agent = this.ctx.agents.get(binding.sessionId)
    const cwd = agent?.session.header.cwd
    if (agent === undefined || agent.session.id !== binding.sessionId || cwd === undefined) return false
    try {
      return await realpath(cwd) === root
    } catch {
      return false
    }
  }

  /** Build durable metadata without exposing this provider's live root. */
  private metadata(request: TeamWorkspacePrepareRequest, root: string): TeamWorkspaceAllocationMetadata {
    return {
      id: sharedAllocationId(this.name, root, request),
      provider: this.name,
      mode: 'shared',
      teamId: request.teamId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      assignedRevision: request.assignedRevision,
      participantId: request.participantId,
      activationId: request.activationId,
      sessionId: request.sessionId,
    }
  }

  /** Serialize scans per allocation while filesystem work remains outside the Hub queue. */
  private async observeAllocation(
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
    stage: TeamWorkspaceObservationInput['stage'],
    captured?: DirectorySnapshot,
    signal?: AbortSignal,
    root = this.roots.get(key) ?? this.root,
  ): Promise<TeamWorkspaceObservation> {
    const priorOperation = this.observationQueues.get(key)
    const operation = (async () => {
      if (priorOperation !== undefined) await priorOperation.catch(() => {})
      const manifest = this.baselines.get(key) ?? await this.readManifestIfPresent(metadata, key)
      const previous = manifest === undefined ? undefined : { files: manifest.baseline, version: manifest.scan }
      const final = captured ?? await snapshotDirectory(root, this.config, signal)
      const state = await this.ctx.teams.getTeam({ teamId: metadata.teamId })
      const allocation = state.workspaceAllocations.find(value => value.id === metadata.id)
      if (allocation === undefined || allocation.provider !== this.name || allocation.attemptId !== metadata.attemptId) {
        throw new TeamError('Workspace observation lost its exact durable allocation', 'TEAM_INVALID_ARGUMENT')
      }
      const previousObservation = allocation.observation
      const base = previousObservation === undefined ? null : previousObservation.base ?? previousObservation.final
      const retainedBaseline = !this.unavailableBaselines.has(key) && previous !== undefined && isDeepStrictEqual(previous.version, base)
      const unchangedComplete = previousObservation !== undefined && !previousObservation.truncated
        && previousObservation.final.complete && final.version.complete && previousObservation.final.digest === final.version.digest
      const baselineAvailable = base === null || retainedBaseline || unchangedComplete
      const changes = retainedBaseline ? observedChanges(previous, final)
        : unchangedComplete ? previousObservation.paths.map(({ path, change }) => ({ path, change })) : []
      const input: TeamWorkspaceObservationInput = {
        teamId: metadata.teamId, allocationId: metadata.id, expectedRevision: allocation.revision,
        ...previousObservation === undefined ? {} : { previousObservationId: previousObservation.id },
        id: teamWorkspaceObservationIdSchema.parse(`workspace-observation-${randomUUID()}`), stage,
        base, baselineAvailable, final: final.version,
        paths: changes.slice(0, this.config.observationMaxPaths),
        omittedPaths: Math.max(0, changes.length - this.config.observationMaxPaths),
      }
      const token: object = Object.freeze({ toJSON(): never { throw new TypeError('Workspace observation proof is runtime-only') } })
      const proof = token as TeamSystemWorkspaceAllocationProof
      this.observationProofs.set(proof, { kind: 'workspace-observe', ...input })
      try {
        const observation = await this.ctx.teams.recordWorkspaceObservation({ actor: proof, ...input })
        this.observedScans.set(key, final)
        return observation
      } finally { this.observationProofs.delete(proof) }
    })()
    this.observationQueues.set(key, operation)
    try { return await operation } finally { if (this.observationQueues.get(key) === operation) this.observationQueues.delete(key) }
  }

  /** Create one live logical root handle after Team binding has accepted its metadata. */
  private createAllocation(
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
    root: string,
  ): TeamWorkspaceAllocation {
    let released = false
    return Object.freeze({
      ...metadata,
      root,
      release: async (): Promise<void> => {
        if (released) return Promise.resolve()
        try { await this.observeAllocation(metadata, key, 'release', undefined, undefined, root) } catch (error: unknown) {
          this.ctx.logger.warn(`team-workspace-shared: release observation could not be recorded: ${String(error)}`)
        }
        await this.removeManifest(key)
        this.observedScans.delete(key)
        this.unavailableBaselines.delete(key)
        released = true
        this.allocations.delete(key)
        this.preparations.delete(key)
        this.roots.delete(key)
      },
    })
  }
}

/** Mount a provider after canonicalizing the required shared root. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = await resolveConfig(config)
  const provider = new SharedTeamWorkspaceProvider(ctx, resolved)
  ctx.effect(() => ctx.teamWorkspaces.registerProvider(provider), 'teamWorkspaceShared.registerProvider()')
  ctx.effect(() => provider.startObservationPulse(), 'teamWorkspaceShared.observationPulse()')
}

/** Validate and canonicalize a direct function-plugin configuration before registration. */
async function resolveConfig(config: Config): Promise<ResolvedConfig> {
  const observation = {
    observationMaxEntries: config.observationMaxEntries ?? 2048,
    observationMaxHashBytes: config.observationMaxHashBytes ?? 16 * 1024 * 1024,
    observationMaxFileBytes: config.observationMaxFileBytes ?? 8 * 1024 * 1024,
    observationTimeoutMs: config.observationTimeoutMs ?? 2000,
    observationMaxPaths: config.observationMaxPaths ?? 128,
    observationMaxStateBytes: config.observationMaxStateBytes ?? 16 * 1024 * 1024,
  }
  for (const [field, value] of Object.entries(observation)) {
    if (!Number.isSafeInteger(value) || value < 1 || (field === 'observationTimeoutMs' && value > 2147483647)) {
      throw new TypeError(`team-workspace-shared: ${field} must be a positive bounded integer`)
    }
  }
  const observationPulseIntervalMs = config.observationPulseIntervalMs === undefined
    ? undefined : timerDelay(config.observationPulseIntervalMs, 'observationPulseIntervalMs')
  const providerName = config.providerName ?? DEFAULT_PROVIDER_NAME
  const allowTeamWorkspacePath = config.allowTeamWorkspacePath ?? false
  if (providerName.length === 0 || providerName.trim() !== providerName) {
    throw new TypeError('team-workspace-shared: providerName must be non-empty without surrounding whitespace')
  }
  if (!isAbsolute(config.root)) {
    throw new TypeError('team-workspace-shared: root must be an absolute path')
  }
  let root: string
  try {
    root = await realpath(config.root)
  } catch (error: unknown) {
    throw new TypeError(`team-workspace-shared: root '${config.root}' cannot be canonicalized`, { cause: error })
  }
  if (!(await isDirectory(root))) {
    throw new TypeError(`team-workspace-shared: root '${config.root}' is not a directory`)
  }
  const integrationRoot = config.integrationRoot === undefined
    ? undefined
    : await canonicalDirectory(config.integrationRoot, 'integrationRoot')
  if (integrationRoot !== undefined && (isPathUnder(root, integrationRoot) || isPathUnder(integrationRoot, root))) {
    throw new TypeError('team-workspace-shared: integrationRoot and root must not overlap')
  }
  const statePath = config.observationStateRoot ?? (integrationRoot === undefined
    ? join(root, '.clocky', 'team-workspace-observations') : join(integrationRoot, '.clocky-team-shared-state'))
  if (!isAbsolute(statePath) || isPathUnder(root, resolvePath(statePath))) {
    throw new TypeError('team-workspace-shared: observationStateRoot must not contain the shared root')
  }
  let externalStateRoot: string | undefined
  if (isChildPath(root, statePath)) await ensureRegularDirectoryPath(root, statePath)
  else if (integrationRoot !== undefined && isChildPath(integrationRoot, statePath)) {
    await ensureRegularDirectoryPath(integrationRoot, statePath)
  } else externalStateRoot = await createExternalObservationDirectory(statePath)
  const observationStateRoot = externalStateRoot ?? await canonicalDirectory(statePath, 'observationStateRoot')
  if (isPathUnder(root, observationStateRoot)) {
    throw new TypeError('team-workspace-shared: observationStateRoot must not contain the shared root')
  }
  const integrationEnabled = config.integrationEnabled ?? false
  if (integrationEnabled && integrationRoot === undefined) {
    throw new TypeError('team-workspace-shared: integrationRoot is required when integrationEnabled is true')
  }
  if (integrationEnabled && config.artifactProvider === undefined) {
    throw new TypeError('team-workspace-shared: artifactProvider is required when integrationEnabled is true')
  }
  const artifactProvider = config.artifactProvider === undefined
    ? undefined
    : normalized(config.artifactProvider, 'artifactProvider')
  const maxArtifactBytes = positive(config.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES, 'maxArtifactBytes')
  const maxIntegrationBytes = positive(config.maxIntegrationBytes ?? DEFAULT_MAX_INTEGRATION_BYTES, 'maxIntegrationBytes')
  return {
    ...observation,
    observationStateRoot,
    ...observationPulseIntervalMs === undefined ? {} : { observationPulseIntervalMs },
    observationMaxAllocationsPerPulse: positive(config.observationMaxAllocationsPerPulse ?? 1, 'observationMaxAllocationsPerPulse'),
    root,
    allowTeamWorkspacePath,
    providerName,
    ...artifactProvider === undefined ? {} : { artifactProvider },
    maxArtifactBytes,
    ...integrationRoot === undefined ? {} : { integrationRoot },
    integrationEnabled,
    maxIntegrationBytes,
  }
}

/** Canonicalize one required existing directory at the provider boundary. */
async function canonicalDirectory(value: string, label: string): Promise<string> {
  if (!isAbsolute(value)) throw new TypeError(`team-workspace-shared: ${label} must be an absolute path`)
  let canonical: string
  try {
    canonical = await realpath(value)
  } catch (error: unknown) {
    throw new TypeError(`team-workspace-shared: ${label} '${value}' cannot be canonicalized`, { cause: error })
  }
  if (!(await isDirectory(canonical))) throw new TypeError(`team-workspace-shared: ${label} '${value}' is not a directory`)
  return canonical
}

/** Create provider-private external state without following user-controlled ancestor links. */
async function createExternalObservationDirectory(value: string): Promise<string> {
  const absolute = resolvePath(value)
  const filesystemRoot = parsePath(absolute).root
  const parts = relative(filesystemRoot, absolute).split(sep).filter(Boolean)
  let current = await realpath(filesystemRoot)
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] as string
    const candidate = join(current, part)
    let info
    try { info = await lstat(candidate) } catch (error: unknown) {
      if (!isNotFound(error)) throw error
      const target = join(current, ...parts.slice(index))
      await ensureRegularDirectoryPath(current, target)
      return await canonicalDirectory(target, 'observationStateRoot')
    }
    if (info.isSymbolicLink()) {
      const parent = await lstat(current)
      // Root-owned aliases under an unwritable system directory include macOS /var and /tmp.
      if (index !== 0 || info.uid !== 0 || parent.uid !== 0 || (parent.mode & 0o022) !== 0) {
        throw new TypeError(`team-workspace-shared: observationStateRoot ancestor '${candidate}' is a symbolic link`)
      }
      current = await canonicalDirectory(candidate, 'observationStateRoot ancestor')
    } else {
      if (!info.isDirectory()) throw new TypeError(`team-workspace-shared: observationStateRoot ancestor '${candidate}' is not a directory`)
      current = candidate
    }
  }
  return current
}

/** Validate one configuration string before it reaches a provider-owned path or registry. */
function normalized(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`team-workspace-shared: ${label} must be non-empty without surrounding whitespace`)
  }
  return value
}

/** Validate one bounded positive integer configuration field. */
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`team-workspace-shared: ${label} must be a positive safe integer`)
  }
  return value
}

/** Validate one timer delay against Node's maximum supported timeout. */
function timerDelay(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new TypeError(`team-workspace-shared: ${label} must be a positive bounded timer delay`)
  }
  return value
}

/** Check whether one canonical path is a strict descendant of another. */
function isChildPath(parent: string, child: string): boolean {
  const descendant = relative(parent, child)
  return descendant.length > 0 && descendant !== '..' && !descendant.startsWith(`..${sep}`) && !isAbsolute(descendant)
}

/** Check whether one path is the same as or below another canonical path. */
function isPathUnder(path: string, parent: string): boolean {
  return path === parent || isChildPath(parent, path)
}

/** Materialize bounded file references for all changed regular files. */
async function materializeArtifacts(
  ctx: Context,
  allocation: TeamWorkspaceAllocation,
  paths: readonly string[],
  config: ResolvedConfig,
): Promise<import('@clocky/clocky-team').TeamArtifactReference[]> {
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

/** Build one bounded portable change set from a shared baseline and current tree. */
async function materializeChangeSet(
  allocation: TeamWorkspaceAllocation,
  observedPaths: TeamWorkspaceObservationInput['paths'],
  current: Readonly<Record<string, FileFingerprint>>,
  config: ResolvedConfig,
): Promise<string | undefined> {
  if (config.integrationRoot === undefined) return undefined
  const paths = observedPaths.map(change => change.path)
  const changes: TeamWorkspaceChange[] = []
  for (const path of paths) {
    const entry = Object.hasOwn(current, path) ? current[path] : undefined
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

/** Validate source identities before policy or provider-backed artifact reads. */
function assertSourceIntegrationRequest(request: TeamWorkspaceSourceIntegrateRequest): void {
  if (String(request.source.teamId).length === 0
    || String(request.source.taskId).length === 0
    || String(request.source.attemptId).length === 0
    || String(request.integrationTaskId).length === 0
    || String(request.integrationAttemptId).length === 0) {
    throw new TeamError('shared source integration identities must be non-empty', 'TEAM_INVALID_ARGUMENT')
  }
  if (request.target.length === 0 || request.target.trim() !== request.target) {
    throw new TeamError('shared integration target must be non-empty without surrounding whitespace', 'TEAM_INVALID_ARGUMENT')
  }
}

/** Return the provider-owned target directory for one safe relative target name. */
function integrationTargetRoot(config: ResolvedConfig, target: string): string {
  const integrationRoot = config.integrationRoot
  if (integrationRoot === undefined) {
    throw new TeamError('shared integration requires a configured integrationRoot', 'TEAM_INVALID_ARGUMENT')
  }
  if (target.includes('\\') || target.includes('\0') || isAbsolute(target)
    || target.split('/').some(part => part.length === 0 || part === '.' || part === '..')) {
    throw new TeamError('shared integration target must be a safe relative path without backslashes', 'TEAM_INVALID_ARGUMENT')
  }
  const root = resolvePath(integrationRoot, target)
  if (root === integrationRoot || !isChildPath(integrationRoot, root)
    || relative(integrationRoot, root).split(sep)[0] === '.clocky-team-shared-state') {
    throw new TeamError('shared integration target must be a child of integrationRoot', 'TEAM_INVALID_ARGUMENT')
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
        throw new TeamError(`shared integration cannot delete directory '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
      }
      await rm(absolute, { force: true })
      continue
    }
    if (existing !== undefined && existing.isDirectory()) {
      throw new TeamError(`shared integration cannot replace directory '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
    }
    if (change.kind === 'file') {
      if (existing?.isSymbolicLink()) {
        throw new TeamError(`shared integration cannot write through symlink '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
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
    throw new TeamError('shared integration path escapes its configured root', 'TEAM_INVALID_ARGUMENT')
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
      throw new TeamError(`shared integration ancestor '${current}' is not a regular directory`, 'TEAM_INVALID_ARGUMENT')
    }
  }
}

/** Map a validated portable path to a local root without following path escapes. */
function portablePath(root: string, path: string): string {
  const absolute = join(root, ...path.split('/'))
  if (!isChildPath(root, absolute)) throw new TeamError(`shared integration path '${path}' escapes its target`, 'TEAM_INVALID_ARGUMENT')
  return absolute
}

/** Compute a content-derived version for one integration target directory. */
async function directoryVersion(root: string, config: ResolvedConfig): Promise<string> {
  if (!(await pathExists(root))) return 'missing'
  await assertDirectory(root)
  const snapshot = await snapshotDirectory(root, { ...config, observationMaxFileBytes: config.maxIntegrationBytes })
  if (!snapshot.version.complete) throw new TeamError('Shared integration requires a complete bounded target observation', 'TEAM_INVALID_ARGUMENT')
  return snapshot.version.digest
}

/** Provider-owned state directory kept outside user source and target paths. */
function integrationStateRoot(config: ResolvedConfig): string {
  if (config.integrationRoot === undefined) {
    throw new TeamError('shared integration requires a configured integrationRoot', 'TEAM_INVALID_ARGUMENT')
  }
  return join(config.integrationRoot, '.clocky-team-shared-state')
}

/** Location of one provider-owned source baseline sidecar. */
function manifestPath(config: ResolvedConfig, key: string): string {
  return join(config.observationStateRoot, `baseline-${createHash('sha256').update(`${config.providerName}:${key}`).digest('hex')}.json`)
}

/** Location of one provider-owned integration recovery marker. */
function integrationMarkerPath(config: ResolvedConfig, request: TeamWorkspaceSourceIntegrateRequest): string {
  return join(integrationStateRoot(config), 'integrations', `${createHash('sha256').update(JSON.stringify([
    config.providerName,
    String(request.source.taskId),
    String(request.source.attemptId),
    String(request.integrationTaskId),
    String(request.integrationAttemptId),
    request.target,
  ])).digest('hex')}.json`)
}

/** Deterministic provider-owned backup used to recover a crash after target removal. */
function integrationBackupPath(markerPathname: string, targetRoot: string): string {
  return join(dirname(targetRoot), `.clocky-team-shared-backup-${createHash('sha256').update(markerPathname).digest('hex')}`)
}

/** Read one provider-owned recovery marker, rejecting malformed state. */
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
    throw new TeamError(`shared integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT', { cause: error })
  }
  if (!isIntegrationMarker(parsed)) throw new TeamError(`shared integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT')
  return parsed
}

/** Write a marker only after validating its own lifecycle fields. */
async function writeIntegrationMarker(path: string, marker: IntegrationMarker): Promise<void> {
  if (!isIntegrationMarker(marker)) throw new TeamError(`shared integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT')
  await writeFile(path, JSON.stringify(marker), { mode: 0o600, flag: marker.status === 'prepared' ? 'wx' : 'w' })
}

/** Match a recovery marker to one exact source and integration operation. */
function sameIntegrationMarker(marker: IntegrationMarker, request: TeamWorkspaceSourceIntegrateRequest, provider: string): boolean {
  return marker.provider === provider
    && marker.sourceTaskId === String(request.source.taskId)
    && marker.sourceAttemptId === String(request.source.attemptId)
    && marker.integrationTaskId === String(request.integrationTaskId)
    && marker.integrationAttemptId === String(request.integrationAttemptId)
    && marker.target === request.target
}

/** Validate a provider-owned integration marker loaded from disk. */
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

/** Validate the shallow shape of a persisted source baseline before use. */
function isStoredManifest(value: unknown): value is StoredManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.version !== MANIFEST_VERSION || typeof record.metadata !== 'object' || record.metadata === null
    || typeof record.baseline !== 'object' || record.baseline === null || Array.isArray(record.baseline)) return false
  const scan = teamWorkspaceScanVersionSchema.safeParse(record.scan)
  if (!scan.success) return false
  const entries = Object.entries(record.baseline)
  if (!entries.every(([path, fingerprint]: [string, unknown]) => path.length > 0 && !path.includes('\\')
    && !path.includes('\0') && !path.startsWith('/') && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
    && isFileFingerprint(fingerprint, scan.data.complete))) return false
  return fingerprintDirectoryEntries(record.baseline as Record<string, FileFingerprint>, scan.data.complete) === scan.data.digest
}

/** Validate fingerprints loaded from the provider sidecar before they participate in path comparisons. */
function isFileFingerprint(value: unknown, complete: boolean): value is FileFingerprint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (entry.kind === 'symlink') return typeof entry.target === 'string' && Object.keys(entry).every(key => key === 'kind' || key === 'target')
  if (entry.kind === 'other') return typeof entry.type === 'string' && Object.keys(entry).every(key => key === 'kind' || key === 'type')
  return entry.kind === 'file' && typeof entry.size === 'number' && Number.isSafeInteger(entry.size) && entry.size >= 0
    && typeof entry.modifiedAt === 'number' && Number.isFinite(entry.modifiedAt)
    && (entry.contentHash === undefined ? !complete : typeof entry.contentHash === 'string' && /^[a-f0-9]{64}$/u.test(entry.contentHash))
    && Object.keys(entry).every(key => key === 'kind' || key === 'size' || key === 'modifiedAt' || key === 'contentHash')
}

/** Parse JSON bytes stored in one provider-backed patch artifact. */
function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error: unknown) {
    throw new TeamError('shared source patch artifact is not valid JSON', 'TEAM_INVALID_ARGUMENT', { cause: error })
  }
}

/** Return whether a current filesystem path is an accessible directory. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Require one existing local target to be a regular directory, never a symlink. */
async function assertDirectory(path: string): Promise<void> {
  let info
  try {
    info = await lstat(path)
  } catch (error: unknown) {
    throw new TeamError(`shared integration target '${path}' is unavailable`, 'TEAM_INVALID_ARGUMENT', { cause: error })
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new TeamError(`shared integration target '${path}' is not a regular directory`, 'TEAM_INVALID_ARGUMENT')
  }
}

/** Check whether one local path exists without following a final symlink. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error: unknown) {
    if (isNotFound(error)) return false
    throw error
  }
}

/** Recognize filesystem absence errors at a durable provider boundary. */
function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** Recognize an atomic-create race while preserving all other filesystem errors. */
function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

/** Return whether one current participant can receive a shared local-Agent allocation. */
function isActiveLocalAgent(participant: ParticipantSnapshot | undefined): participant is ParticipantSnapshot {
  return participant?.kind === 'local-agent' && participant.phase === 'active'
}

/** Return whether an activation remains available for current local Agent work. */
function isDeliverableActivation(binding: ActivationBindingSnapshot): boolean {
  return binding.activation.status === 'idle' || binding.activation.status === 'running'
}

/** Compare immutable activation, Session, and placement identities while allowing status updates. */
function sameBindingIdentity(left: ActivationBindingSnapshot, right: ActivationBindingSnapshot): boolean {
  return left.activation.id === right.activation.id
    && left.activation.teamId === right.activation.teamId
    && left.activation.participantId === right.activation.participantId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
}

/** Produce one collision-free logical-allocation identity for a complete exact attempt request. */
function allocationKey(request: TeamWorkspacePrepareRequest): string {
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

/** Compare the immutable allocation fields accepted at the workspace seam. */
function sameAllocation(left: TeamWorkspaceAllocation, right: TeamWorkspaceAllocation): boolean {
  return sameMetadata(left, right)
    && left.teamId === right.teamId
    && left.root === right.root
}

/** Compare the immutable metadata whose relation is retained across provider recovery. */
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

/** Mint a deterministic provider-owned allocation id without deriving a filesystem path from Team ids. */
function sharedAllocationId(name: string, root: string, request: TeamWorkspacePrepareRequest) {
  const digest = createHash('sha256').update(JSON.stringify([
    name,
    root,
    request.teamId,
    request.taskId,
    request.attemptId,
    request.assignedRevision,
    request.participantId,
    request.activationId,
    request.sessionId,
  ])).digest('hex')
  return teamWorkspaceAllocationIdSchema.parse(`shared-${digest}`)
}

/** Raise the Team provider's stable invalid-argument code for a failed current-allocation relation. */
function requireCurrent(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TeamError(message, 'TEAM_INVALID_ARGUMENT')
}

/** Absence is a proven addition/deletion only when the opposite traversal is complete. */
function observedChanges(base: DirectorySnapshot, final: DirectorySnapshot): TeamWorkspaceObservationInput['paths'] {
  return [...new Set([...Object.keys(base.files), ...Object.keys(final.files)])].sort().flatMap<TeamWorkspaceObservationInput['paths'][number]>((path) => {
    const before = Object.hasOwn(base.files, path) ? base.files[path] : undefined
    const after = Object.hasOwn(final.files, path) ? final.files[path] : undefined
    if (before === undefined) return base.version.complete && after !== undefined ? [{ path, change: 'added' as const }] : []
    if (after === undefined) return final.version.complete ? [{ path, change: 'deleted' as const }] : []
    return isDeepStrictEqual(before, after) ? [] : [{ path, change: 'modified' as const }]
  })
}
