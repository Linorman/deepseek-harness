import { localWorkspaceFileConfigFields } from '@clocky/clocky-team-workspace-local-files'
import { teamWorkspaceIntegrationKey } from '@clocky/clocky-team-workspace'
import { isStoredTeamWorkspaceManifestHeader } from '@clocky/clocky-team-workspace'
import type { LocalArtifactOptions,LocalChangeSetOptions } from '@clocky/clocky-team-workspace-local-files'
import { materializeLocalChangeSet } from '@clocky/clocky-team-workspace-local-files'
import { assertCurrentTeamWorkspaceOwner,isCurrentTeamWorkspaceCandidate,authorizeTeamWorkspaceAllocation } from '@clocky/clocky-team-workspace'
import { integrateSerializedLocalDirectory } from '@clocky/clocky-team-workspace-local-files'
import { materializeArtifacts, isChildPath, isPathUnder, isDirectory, pathExists, isAlreadyExists, isNotFound } from '@clocky/clocky-team-workspace-local-files'

import { TeamWorkspaceReservations } from '@clocky/clocky-team-workspace'

import { TeamWorkspaceIntegrationQueue, assertTeamWorkspaceSourceIntegration, authorizeTeamWorkspaceSourceIntegration, decodeTeamWorkspaceChangeSet } from '@clocky/clocky-team-workspace'
import { teamWorkspaceAllocationKey as allocationKey, sameTeamWorkspaceBaseMetadata as sameMetadata } from '@clocky/clocky-team-workspace'
/**
 * Local isolated Team sandbox workspace provider. It owns a deterministic
 * provider-created directory for one exact task attempt, optionally seeds it
 * from a configured source directory, and publishes bounded file manifests.
 * The task Agent Client exposes the returned root to the existing filesystem
 * and process Consumers; this provider does not claim a filesystem lock.
 *
 * @module @clocky/clocky-team-workspace-sandbox
 */

// Static provider dependency inventory; no implementation logic is covered by this declaration-only block.
/* jscpd:ignore-start */
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readlink, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'

import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type {} from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-team-artifact'
import { TeamError, teamWorkspaceAllocationIdSchema } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
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
export const name = 'team-workspace-sandbox'
/** Workspace registry, Team authority, and local Agent registry must exist before allocation. */
export const inject = ['teamWorkspaces', 'teams', 'agents']

const DEFAULT_PROVIDER_NAME = 'sandbox-local'
const DEFAULT_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_INTEGRATION_BYTES = 8 * 1024 * 1024
const MANIFEST_VERSION = 1 as const

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
  ...localWorkspaceFileConfigFields(DEFAULT_MAX_ARTIFACT_BYTES, DEFAULT_MAX_INTEGRATION_BYTES),
})

interface ResolvedConfig extends LocalArtifactOptions, LocalChangeSetOptions {
  readonly allocationParent: string
  readonly sourceRoot?: string
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

/** Local provider that owns one isolated root per exact task attempt. */
class SandboxTeamWorkspaceProvider implements TeamWorkspaceProvider {
  readonly modes = ['sandbox'] as const
  private readonly reservations = new TeamWorkspaceReservations()
  private readonly preparations = this.reservations.preparations
  private readonly allocations = this.reservations.allocations
  /** Serialize provider-specific integration operations for one target path. */
  private readonly integrationQueues = new TeamWorkspaceIntegrationQueue()

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
    return isCurrentTeamWorkspaceCandidate(state, request.task, request.binding, 'sandbox')
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
    return this.reservations.reuseOrCreate(key, () => {
      const metadata = this.metadata(request)
      return this.reservations.reserveMaterialized(
        key, metadata, async () =>{  await this.assertCurrentAllocation(request) },
        async () => await this.materializeOwned(metadata, key),
        `sandbox allocation '${metadata.id}' was abandoned`,
      )
    })
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
    assertTeamWorkspaceSourceIntegration(request, 'sandbox')
    const artifact = selectTeamWorkspacePatchArtifact(request)
    await authorizeTeamWorkspaceSourceIntegration(this.ctx.teams, request, this.config.providerName)
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
    const integrationRoot = this.config.integrationRoot
    const bytes = await store.read(this.config.artifactProvider, { reference: artifact })
    const changeSet = decodeTeamWorkspaceChangeSet(
      bytes, this.config.providerName, request.source.attemptId, this.config.maxIntegrationBytes, 'sandbox',
    )
    return await integrateSerializedLocalDirectory(this.integrationQueues, request, artifact, changeSet, () => {
      const targetRoot = integrationTargetRoot(integrationRoot, request.target)
      const markerPathname = integrationMarkerPath(this.config, request)
      return {
        stagePrefix: '.clocky-team-sandbox-integration-', providerName: this.config.providerName, label: 'sandbox',
        integrationRoot, targetRoot, markerPathname,
        backupPathname: integrationBackupPath(markerPathname, targetRoot),
        markerParentRoot: this.config.allocationParent, markerDirectory: integrationMarkerRoot(this.config),
        version: async root => await directoryVersion(root, this.config.maxIntegrationBytes),
        assertDirectory,
      }
    })
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
    const binding = assertCurrentTeamWorkspaceOwner(state, request, 'sandbox')
    requireCurrent(this.hasExactLiveAgent(binding), `Session '${request.sessionId}' is not a live local Agent for sandbox allocation`)
    await authorizeTeamWorkspaceAllocation(this.ctx.teams, request, 'sandbox', { allocationParent: this.config.allocationParent })
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
  return await materializeLocalChangeSet(allocation, paths, path => current[path], config)
}

/** Return the provider-owned target directory for one portable target name. */
function integrationTargetRoot(integrationRoot: string, target: string): string {
  if (target.includes('\\') || target.includes('\0') || isAbsolute(target)) {
    throw new TeamError('sandbox integration target must be a relative path without backslashes', 'TEAM_INVALID_ARGUMENT')
  }
  const root = resolvePath(integrationRoot, target)
  if (root === integrationRoot || !isChildPath(integrationRoot, root)) {
    throw new TeamError('sandbox integration target must be a child of integrationRoot', 'TEAM_INVALID_ARGUMENT')
  }
  return root
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
  return join(integrationMarkerRoot(config), `${createHash('sha256').update(teamWorkspaceIntegrationKey(request, config.providerName)).digest('hex')}.json`)
}

/** Provider-owned marker directory for restart-safe local integration settlement. */
function integrationMarkerRoot(config: ResolvedConfig): string {
  return join(config.allocationParent, '.clocky-team-sandbox-integrations')
}

/** Deterministic provider-owned backup used to recover a crash after target removal. */
function integrationBackupPath(markerPathname: string, targetRoot: string): string {
  return join(dirname(targetRoot), `.clocky-team-sandbox-backup-${createHash('sha256').update(markerPathname).digest('hex')}`)
}

function allocationRoot(config: ResolvedConfig, key: string): string {
  const digest = createHash('sha256').update(`${config.providerName}:${key}`).digest('hex')
  return join(config.allocationParent, `.clocky-team-sandbox-${digest}`)
}

function manifestPath(config: ResolvedConfig, key: string): string {
  return join(config.allocationParent, `.clocky-team-sandbox-${createHash('sha256').update(`${config.providerName}:${key}`).digest('hex')}.manifest.json`)
}

function sameAllocation(left: TeamWorkspaceAllocation, right: TeamWorkspaceAllocation): boolean {
  return sameMetadata(left, right) && left.root === right.root
}

function isStoredManifest(value: unknown): value is StoredManifest {
  if (!isStoredTeamWorkspaceManifestHeader(value, MANIFEST_VERSION)) return false
  const record = value as unknown as Record<string, unknown>
  return typeof record.baseline === 'object'
    && record.baseline !== null
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
