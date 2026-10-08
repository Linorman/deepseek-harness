import { localWorkspaceFileConfigFields } from '@clocky/clocky-team-workspace-local-files'
import type { LocalArtifactOptions,LocalChangeSetOptions } from '@clocky/clocky-team-workspace-local-files'
import { teamWorkspaceIntegrationKey } from '@clocky/clocky-team-workspace'
import { isStoredTeamWorkspaceManifestHeader } from '@clocky/clocky-team-workspace'

import { materializeLocalChangeSet } from '@clocky/clocky-team-workspace-local-files'
import { assertCurrentTeamWorkspaceOwner,isCurrentTeamWorkspaceCandidate,authorizeTeamWorkspaceAllocation } from '@clocky/clocky-team-workspace'
import { integrateSerializedLocalDirectory } from '@clocky/clocky-team-workspace-local-files'
import { isChildPath, isPathUnder, materializeArtifacts, ensureRegularDirectoryPath, isDirectory, pathExists, isNotFound, isAlreadyExists } from '@clocky/clocky-team-workspace-local-files'

import { TeamWorkspaceReservations } from '@clocky/clocky-team-workspace'

import { TeamWorkspaceIntegrationQueue, assertTeamWorkspaceSourceIntegration, authorizeTeamWorkspaceSourceIntegration, decodeTeamWorkspaceChangeSet } from '@clocky/clocky-team-workspace'
import { teamWorkspaceAllocationKey as allocationKey, sameTeamWorkspaceBaseMetadata as sameMetadata } from '@clocky/clocky-team-workspace'
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

// Static provider dependency inventory; no implementation logic is covered by this declaration-only block.
/* jscpd:ignore-start */
import { createHash, randomUUID } from 'node:crypto'
import { snapshotDirectory, fingerprintDirectoryEntries, readBoundedBaseline } from './fingerprint.ts'
import type { FileFingerprint, DirectorySnapshot, ScanLimits } from './fingerprint.ts'
import { teamWorkspaceObservationIdSchema, teamWorkspaceScanVersionSchema } from '@clocky/clocky-team'
import type { TeamWorkspaceObservation, TeamWorkspaceObservationInput, TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope, TeamWorkspaceScanVersion } from '@clocky/clocky-team'
import { Buffer } from 'node:buffer'
import { lstat, realpath, rm, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { dirname, isAbsolute, join, parse as parsePath, relative, resolve as resolvePath, sep } from 'node:path'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type {} from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-team-artifact'
import { TeamError, teamWorkspaceAllocationIdSchema } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
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
import { selectTeamWorkspacePatchArtifact, teamWorkspaceSourceIntegrationResult } from '@clocky/clocky-team-workspace'

/* jscpd:ignore-end */

/** Cordis plugin name. */
export const name = 'team-workspace-shared'
/** Workspace registration, Team authority, and live local Agents must exist before allocation. */
export const inject = ['teamWorkspaces', 'teams', 'agents']

const DEFAULT_PROVIDER_NAME = 'shared-local'
const DEFAULT_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_INTEGRATION_BYTES = 8 * 1024 * 1024
const MANIFEST_VERSION = 2 as const

/** Local shared-workspace provider configuration. */
export interface Config {
  /** Existing sidecar directory; defaults to integration state or a provider-owned child of the shared root. */
  readonly observationStateRoot?: string
  /** Existing absolute runtime directories omitted from workspace observations; defaults to none. */
  readonly observationExcludedRoots?: string[]
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
  observationExcludedRoots: z.array(z.string().min(1)).default([]),
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
  ...localWorkspaceFileConfigFields(DEFAULT_MAX_ARTIFACT_BYTES, DEFAULT_MAX_INTEGRATION_BYTES),
})

/** Fully validated configuration retained by one provider instance. */
interface ResolvedConfig extends ScanLimits, LocalArtifactOptions, LocalChangeSetOptions {
  readonly observationStateRoot: string
  readonly observationMaxPaths: number
  readonly observationMaxStateBytes: number
  readonly observationPulseIntervalMs?: number
  readonly observationMaxAllocationsPerPulse: number
  /** Canonical existing directory shared by every accepted local attempt. */
  readonly root: string
  /** Whether a durable Team workspacePath may select the allocation root. */
  readonly allowTeamWorkspacePath: boolean
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

/** Local provider that returns one configured root without claiming filesystem ownership. */
class SharedTeamWorkspaceProvider implements TeamWorkspaceProvider {
  readonly modes = ['shared'] as const
  private readonly reservations = new TeamWorkspaceReservations()
  private readonly preparations = this.reservations.preparations
  private readonly allocations = this.reservations.allocations
  private readonly unavailableBaselines = new Set<string>()
  private readonly observedScans = new Map<string, DirectorySnapshot>()
  private readonly observationQueues = new Map<string, Promise<unknown>>()
  private readonly observationProofs = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()
  private readonly baselines = new Map<string, StoredManifest>()
  /** Canonical execution root retained for each live or recovering allocation. */
  private readonly roots = new Map<string, string>()
  /** Serialize provider-specific integration operations for one target path. */
  private readonly integrationQueues = new TeamWorkspaceIntegrationQueue()
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
    return this.reservations.reuseOrCreate(key, () => {
      const metadata = this.metadata(request, root)
      return this.reservations.reserveMaterialized(
        key, metadata, async () => await this.assertCurrentAllocation(request),
        async () => await this.materializeOwned(metadata, key, root),
        `shared workspace allocation '${metadata.id}' was abandoned`, undefined,
        () => { if (!this.allocations.has(key)) this.roots.delete(key) },
      )
    })
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
    assertTeamWorkspaceSourceIntegration(request, 'shared')
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
    await authorizeTeamWorkspaceSourceIntegration(this.ctx.teams, request, this.config.providerName)
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
    const integrationRoot = this.config.integrationRoot
    const bytes = await store.read(this.config.artifactProvider, { reference: artifact })
    const changeSet = decodeTeamWorkspaceChangeSet(
      bytes, this.config.providerName, request.source.attemptId, this.config.maxIntegrationBytes, 'shared',
    )
    return await integrateSerializedLocalDirectory(this.integrationQueues, request, artifact, changeSet, () => {
      const targetRoot = integrationTargetRoot(integrationRoot, request.target)
      const markerPathname = integrationMarkerPath(this.config, integrationRoot, request)
      return {
        stagePrefix: '.clocky-team-shared-integration-', providerName: this.config.providerName, label: 'shared',
        integrationRoot, targetRoot, markerPathname,
        backupPathname: integrationBackupPath(markerPathname, targetRoot),
        markerParentRoot: integrationRoot, markerDirectory: dirname(markerPathname),
        version: async root => await directoryVersion(root, this.config),
        assertDirectory,
      }
    })
  }

  /** Materialize the logical shared allocation and retain its bounded source baseline. */
  private async materializeOwned(
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
    root: string,
  ): Promise<TeamWorkspaceAllocation> {
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
    const binding = assertCurrentTeamWorkspaceOwner(state, request, 'shared')
    requireCurrent(
      await this.hasExactLiveAgent(binding, root),
      `Session '${request.sessionId}' is not a live local Agent at shared workspace root '${root}'`,
    )
    await authorizeTeamWorkspaceAllocation(this.ctx.teams, request, 'shared', { root })
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
    return isCurrentTeamWorkspaceCandidate(state, task, binding, 'shared')
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
  const observationExcludedRoots = await Promise.all((config.observationExcludedRoots ?? [])
    .map(path => canonicalDirectory(path, 'observationExcludedRoots')))
  if (observationExcludedRoots.some(excluded => isPathUnder(root, excluded))) {
    throw new TypeError('team-workspace-shared: observationExcludedRoots must not contain the shared root')
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
  if (isChildPath(root, statePath)) await ensureRegularDirectoryPath(root, statePath, 'shared')
  else if (integrationRoot !== undefined && isChildPath(integrationRoot, statePath)) {
    await ensureRegularDirectoryPath(integrationRoot, statePath, 'shared')
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
    observationExcludedRoots,
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
      await ensureRegularDirectoryPath(current, target, 'shared')
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

/** Build one bounded portable change set from a shared baseline and current tree. */
async function materializeChangeSet(
  allocation: TeamWorkspaceAllocation,
  observedPaths: TeamWorkspaceObservationInput['paths'],
  current: Readonly<Record<string, FileFingerprint>>,
  config: ResolvedConfig,
): Promise<string | undefined> {
  if (config.integrationRoot === undefined) return undefined
  const paths = observedPaths.map(change => change.path)
  return await materializeLocalChangeSet(allocation, paths, path => Object.hasOwn(current, path) ? current[path] : undefined, config)
}

/** Return the provider-owned target directory for one safe relative target name. */
function integrationTargetRoot(integrationRoot: string, target: string): string {
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

/** Compute a content-derived version for one integration target directory. */
async function directoryVersion(root: string, config: ResolvedConfig): Promise<string> {
  if (!(await pathExists(root))) return 'missing'
  await assertDirectory(root)
  const snapshot = await snapshotDirectory(root, { ...config, observationMaxFileBytes: config.maxIntegrationBytes })
  if (!snapshot.version.complete) throw new TeamError('Shared integration requires a complete bounded target observation', 'TEAM_INVALID_ARGUMENT')
  return snapshot.version.digest
}

/** Provider-owned state directory kept outside user source and target paths. */
function integrationStateRoot(integrationRoot: string): string {
  return join(integrationRoot, '.clocky-team-shared-state')
}

/** Location of one provider-owned source baseline sidecar. */
function manifestPath(config: ResolvedConfig, key: string): string {
  return join(config.observationStateRoot, `baseline-${createHash('sha256').update(`${config.providerName}:${key}`).digest('hex')}.json`)
}

/** Location of one provider-owned integration recovery marker. */
function integrationMarkerPath(config: ResolvedConfig, integrationRoot: string, request: TeamWorkspaceSourceIntegrateRequest): string {
  return join(integrationStateRoot(integrationRoot), 'integrations', `${createHash('sha256').update(teamWorkspaceIntegrationKey(request, config.providerName)).digest('hex')}.json`)
}

/** Deterministic provider-owned backup used to recover a crash after target removal. */
function integrationBackupPath(markerPathname: string, targetRoot: string): string {
  return join(dirname(targetRoot), `.clocky-team-shared-backup-${createHash('sha256').update(markerPathname).digest('hex')}`)
}

/** Validate the shallow shape of a persisted source baseline before use. */
function isStoredManifest(value: unknown): value is StoredManifest {
  if (Array.isArray(value) || !isStoredTeamWorkspaceManifestHeader(value, MANIFEST_VERSION)) return false
  const record = value as unknown as Record<string, unknown>
  if (typeof record.baseline !== 'object' || record.baseline === null || Array.isArray(record.baseline)) return false
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

/** Compare the immutable allocation fields accepted at the workspace seam. */
function sameAllocation(left: TeamWorkspaceAllocation, right: TeamWorkspaceAllocation): boolean {
  return sameMetadata(left, right)
    && left.teamId === right.teamId
    && left.root === right.root
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
