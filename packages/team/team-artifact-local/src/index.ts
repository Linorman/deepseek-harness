import type { TeamListPageRequest } from '@clocky/clocky-team'
/**
 * Content-addressed local provider for Team artifact bytes. It owns only the
 * object store; Team task state retains references and provenance separately.
 * @module @clocky/clocky-team-artifact-local
 */

import { createHash } from 'node:crypto'
import { mkdir, lstat, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { TeamArtifactError } from '@clocky/clocky-team-artifact'
import type {
  TeamArtifactCollectRequest,
  TeamArtifactCollectResult,
  TeamArtifactCollectionFailure,
  TeamArtifactDeleteRequest,
  TeamArtifactProvider,
  TeamArtifactReadRequest,
  TeamArtifactWriteRequest,
} from '@clocky/clocky-team-artifact'
import type {
  TeamArtifactReference,
  TaskAttemptResult,
  TeamRuntime,
} from '@clocky/clocky-team'
import { TeamError } from '@clocky/clocky-team'

/** Cordis plugin name. */
export const name = 'team-artifact-local'
/** Artifact registry must exist before this provider registers. */
export const inject = ['teamArtifacts']

const DEFAULT_PROVIDER_NAME = 'local'
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_ARTIFACTS_PER_ATTEMPT = 256
const DIGEST = /^[0-9a-f]{64}$/

/** Local content-addressed artifact-store configuration. */
export interface Config {
  /** Provider name used in references and registry lookups. */
  readonly providerName?: string
  /** Absolute directory retaining content-addressed objects. */
  readonly root: string
  /** Maximum bytes accepted for one artifact. */
  readonly maxBytes?: number
  /** Maximum distinct artifacts accepted for one source attempt. */
  readonly maxArtifactsPerAttempt?: number
  /** Optional Team-aware reachability collector for this local object store. */
  readonly retention?: RetentionConfig
}

/** Deployment bounds for the optional Team-aware local artifact collector. */
export interface RetentionConfig {
  /** Minimum time an object remains unreachable before collection may remove it. */
  readonly graceMs: number
  /** Maximum object rows inspected by one collection drive. */
  readonly maxObjectsPerDrive: number
  /** Optional recurring collection pulse; omission leaves collection explicitly driven. */
  readonly pulseIntervalMs?: number
  /** Maximum time accepted collection work may delay provider disposal. */
  readonly disposalTimeoutMs: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  root: z.string().required(),
  maxBytes: z.number().step(1).min(1).default(DEFAULT_MAX_BYTES),
  maxArtifactsPerAttempt: z.number().step(1).min(1).default(DEFAULT_MAX_ARTIFACTS_PER_ATTEMPT),
  retention: z.object({
    graceMs: z.number().step(1).min(0),
    maxObjectsPerDrive: z.number().step(1).min(1),
    pulseIntervalMs: z.number().step(1).min(1).default(undefined as unknown as number),
    disposalTimeoutMs: z.number().step(1).min(1),
  }).default(undefined as unknown as {
    graceMs: number
    maxObjectsPerDrive: number
    pulseIntervalMs: number
    disposalTimeoutMs: number
  }),
})

interface ResolvedConfig {
  readonly providerName: string
  readonly root: string
  readonly maxBytes: number
  readonly maxArtifactsPerAttempt: number
  readonly retention?: RetentionConfig
}

/** Local provider that writes immutable objects under a private canonical root. */
class LocalTeamArtifactProvider implements TeamArtifactProvider {
  private readonly attempts = new Map<string, Set<string>>()

  constructor(private readonly config: ResolvedConfig) {}

  get name(): string { return this.config.providerName }

  async save(request: TeamArtifactWriteRequest): Promise<TeamArtifactReference> {
    const bytes = toBytes(request.data)
    if (bytes.byteLength > this.config.maxBytes) {
      throw new TeamArtifactError(
        `Team artifact exceeds the configured ${String(this.config.maxBytes)}-byte limit`,
        'TEAM_ARTIFACT_TOO_LARGE',
      )
    }
    const digest = createHash('sha256').update(bytes).digest('hex')
    const attemptKey = request.sourceAttemptId === undefined ? undefined : String(request.sourceAttemptId)
    if (attemptKey !== undefined) {
      const retained = this.attempts.get(attemptKey) ?? new Set<string>()
      if (!retained.has(digest) && retained.size >= this.config.maxArtifactsPerAttempt) {
        throw new TeamArtifactError(
          `Team attempt '${attemptKey}' exceeded the configured artifact-count limit`,
          'TEAM_ARTIFACT_TOO_LARGE',
        )
      }
      retained.add(digest)
      this.attempts.set(attemptKey, retained)
    }
    const path = objectPath(this.config.root, digest)
    const directory = dirname(path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const directoryInfo = await lstat(directory)
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new TeamArtifactError(`artifact object directory for '${digest}' is not a regular directory`, 'TEAM_ARTIFACT_INVALID')
    }
    try {
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) throw error
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new TeamArtifactError(`content-addressed artifact '${digest}' is not a regular file`, 'TEAM_ARTIFACT_INVALID')
      }
      const existing = await readFile(path)
      if (!existing.equals(bytes)) {
        throw new TeamArtifactError(`content-addressed artifact '${digest}' does not match its existing object`, 'TEAM_ARTIFACT_INVALID')
      }
    }
    return Object.freeze({
      id: `${this.config.providerName}:${digest}`,
      provider: this.config.providerName,
      kind: request.kind,
      uri: artifactUri(this.config.providerName, digest),
      contentHash: digest,
      ...request.sourceAttemptId === undefined ? {} : { sourceAttemptId: request.sourceAttemptId },
      visibility: request.visibility,
    })
  }

  async read(request: TeamArtifactReadRequest): Promise<Uint8Array> {
    request.signal?.throwIfAborted()
    const digest = digestFromReference(request.reference, this.config.providerName)
    const path = objectPath(this.config.root, digest)
    let bytes: Buffer
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('artifact object is not a regular file')
      bytes = await readFile(path)
    } catch (error: unknown) {
      throw new TeamArtifactError(`Team artifact '${request.reference.id}' is not available`, 'TEAM_ARTIFACT_NOT_FOUND', { cause: error })
    }
    request.signal?.throwIfAborted()
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== digest || (request.reference.contentHash !== undefined && request.reference.contentHash !== actual)) {
      throw new TeamArtifactError(`Team artifact '${request.reference.id}' failed content-hash verification`, 'TEAM_ARTIFACT_INVALID')
    }
    return new Uint8Array(bytes)
  }

  async collect(request: TeamArtifactCollectRequest): Promise<TeamArtifactCollectResult> {
    request.signal?.throwIfAborted()
    const afterCursor = validCollectionCursor(request.afterCursor)
    const limit = positive(request.limit, 'collection limit')
    const reachable = new Set<string>()
    for (const reference of request.reachable) {
      const digest = ownedDigestOrUndefined(reference, this.config.providerName)
      if (digest !== undefined) reachable.add(digest)
    }
    const reclaimable = new Set<string>()
    for (const id of request.reclaimableIds) {
      if (!id.startsWith(`${this.config.providerName}:`)) continue
      const digest = id.slice(this.config.providerName.length + 1)
      if (!DIGEST.test(digest)) {
        throw new TeamArtifactError(`reclaimable artifact id '${id}' is malformed`, 'TEAM_ARTIFACT_INVALID')
      }
      reclaimable.add(digest)
    }

    let scanned = 0
    let retained = 0
    let lastDigest: string | undefined
    let nextCursor: string | undefined
    const unreachable: string[] = []
    const deleted: string[] = []
    const failures: TeamArtifactCollectionFailure[] = []
    const buckets = (await readdir(this.config.root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && /^[0-9a-f]{2}$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))

    outer: for (const bucket of buckets) {
      const files = (await readdir(join(this.config.root, bucket.name), { withFileTypes: true }))
        .filter(entry => /^[0-9a-f]{62}$/.test(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name))
      for (const file of files) {
        request.signal?.throwIfAborted()
        const digest = `${bucket.name}${file.name}`
        if (afterCursor !== undefined && digest <= afterCursor) continue
        if (scanned >= limit) {
          nextCursor = lastDigest
          break outer
        }
        scanned += 1
        lastDigest = digest
        const id = `${this.config.providerName}:${digest}`
        const path = objectPath(this.config.root, digest)
        let info: Awaited<ReturnType<typeof lstat>>
        try {
          info = await lstat(path)
        } catch (error: unknown) {
          failures.push({ id, message: `artifact object inspection failed: ${errorMessage(error)}` })
          continue
        }
        if (!info.isFile() || info.isSymbolicLink()) {
          failures.push({ id, message: 'artifact object is not a regular file' })
          continue
        }
        if (reachable.has(digest)) {
          retained += 1
          continue
        }
        unreachable.push(id)
        if (!reclaimable.has(digest)) {
          retained += 1
          continue
        }
        try {
          await unlink(path)
          deleted.push(id)
        } catch (error: unknown) {
          if (isNotFound(error)) {
            deleted.push(id)
          } else {
            failures.push({ id, message: `artifact object deletion failed: ${errorMessage(error)}` })
            retained += 1
          }
        }
      }
    }
    return {
      scanned,
      retained,
      unreachable,
      deleted,
      failures,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    }
  }

  delete(request: TeamArtifactDeleteRequest): Promise<void> {
    request.signal?.throwIfAborted()
    // Content-addressed objects may be shared by multiple Team references.
    // Direct deletion is therefore a no-op; the Team-aware retention owner
    // uses collect() with a current reachability set instead.
    void request
    return Promise.resolve()
  }
}

/** Result of one Team-aware local artifact retention drive. */
export interface LocalTeamArtifactRetentionDriveResult extends TeamArtifactCollectResult {
  /** Number of visible Team projections whose task results were inspected. */
  readonly teamsScanned: number
  /** Number of distinct current Team artifact references supplied to the provider. */
  readonly reachableArtifacts: number
}

/** Team-aware reachability owner for the local content-addressed provider. */
export class LocalTeamArtifactRetention {
  private cursor: string | undefined
  private pulseTimer: ReturnType<typeof setInterval> | undefined
  private readonly accepted = new Set<Promise<LocalTeamArtifactRetentionDriveResult>>()
  private tail: Promise<void> = Promise.resolve()
  private started = false
  private closing = false

  /**
   * @param ctx - Context carrying the artifact registry and Team runtime.
   * @param provider - local provider whose object rows this owner collects.
   * @param config - explicit grace, page, pulse, and disposal bounds.
   */
  constructor(
    private readonly ctx: Context,
    private readonly provider: TeamArtifactProvider,
    private readonly config: RetentionConfig,
  ) {}

  /** Start the optional recurring pulse; explicit callers may invoke {@link drive}. */
  start(): void {
    if (this.started || this.closing) return
    this.started = true
    if (this.config.pulseIntervalMs !== undefined) {
      this.pulseTimer = setInterval(() => {
        void this.drive()
          .then((result) => { this.reportResult(result) })
          .catch((error: unknown) => { this.reportFailure(error) })
      }, this.config.pulseIntervalMs)
      this.pulseTimer.unref()
    }
  }

  /**
   * Run one serialized bounded collection page.
   * @param now - trusted epoch-millisecond clock used for grace evaluation.
   * @returns the provider page plus reachability observations.
   */
  drive(now = Date.now()): Promise<LocalTeamArtifactRetentionDriveResult> {
    if (this.closing) return Promise.reject(new TeamArtifactError('Team artifact retention is closing', 'TEAM_ARTIFACT_INVALID'))
    if (!Number.isSafeInteger(now) || now < 0) {
      return Promise.reject(new TypeError('team-artifact-local: retention clock must be a non-negative safe integer'))
    }
    const operation = this.tail.then(() => this.collectPage(now))
    this.tail = operation.then(() => undefined, () => undefined)
    this.accepted.add(operation)
    void operation.then(
      () => { this.accepted.delete(operation) },
      () => { this.accepted.delete(operation) },
    )
    return operation
  }

  /** Stop future pulses and await accepted collection work. */
  async close(): Promise<void> {
    this.closing = true
    if (this.pulseTimer !== undefined) {
      clearInterval(this.pulseTimer)
      this.pulseTimer = undefined
    }
    const accepted = [...this.accepted]
    if (accepted.length === 0) return
    const settled = await withTimeout(Promise.allSettled(accepted), this.config.disposalTimeoutMs)
    const failures: unknown[] = []
    for (const result of settled) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Team artifact retention disposal failed')
  }

  private async collectPage(now: number): Promise<LocalTeamArtifactRetentionDriveResult> {
    const teams: TeamRuntime | undefined = this.ctx.get('teams')
    if (teams === undefined) throw new TypeError('team-artifact-local: retention drive requires the teams service')
    const reachability = await collectReachableArtifacts(teams, this.config.maxObjectsPerDrive)
    const reachableIds = new Set<string>()
    for (const reference of reachability.references) {
      const id = localObjectId(reference, this.provider.name)
      if (id === undefined) continue
      reachableIds.add(id)
      this.unreachableSince.delete(id)
    }
    const reclaimableIds = [...this.unreachableSince.entries()]
      .filter(([, since]) => now >= since && now - since >= this.config.graceMs)
      .map(([id]) => id)
    const result = await this.ctx.teamArtifacts.collect(this.provider.name, {
      reachable: reachability.references,
      reclaimableIds,
      ...(this.cursor === undefined ? {} : { afterCursor: this.cursor }),
      limit: this.config.maxObjectsPerDrive,
    })
    for (const id of result.unreachable) {
      if (reachableIds.has(id)) continue
      if (this.unreachableSince.has(id) || this.unreachableSince.size < this.config.maxObjectsPerDrive) {
        this.unreachableSince.set(id, this.unreachableSince.get(id) ?? now)
      }
    }
    for (const id of result.deleted) this.unreachableSince.delete(id)
    this.cursor = result.nextCursor
    return {
      ...result,
      teamsScanned: reachability.teamsScanned,
      reachableArtifacts: reachability.references.length,
    }
  }

  private readonly unreachableSince = new Map<string, number>()

  private reportFailure(error: unknown): void {
    this.ctx.logger.warn(`team-artifact-local: retention drive failed: ${errorMessage(error)}`)
  }

  private reportResult(result: LocalTeamArtifactRetentionDriveResult): void {
    if (result.failures.length === 0) return
    this.ctx.logger.warn(`team-artifact-local: retention left ${String(result.failures.length)} cleanup failure(s) for a later drive`)
  }
}

/** Mount the local content-addressed provider after validating its root. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved: ResolvedConfig = {
    providerName: normalized(config.providerName ?? DEFAULT_PROVIDER_NAME, 'providerName'),
    root: await canonicalRoot(config.root),
    maxBytes: positive(config.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes'),
    maxArtifactsPerAttempt: positive(config.maxArtifactsPerAttempt ?? DEFAULT_MAX_ARTIFACTS_PER_ATTEMPT, 'maxArtifactsPerAttempt'),
    ...config.retention === undefined ? {} : { retention: resolveRetention(config.retention) },
  }
  const provider = new LocalTeamArtifactProvider(resolved)
  ctx.effect(() => ctx.teamArtifacts.registerProvider(provider), 'teamArtifactLocal.registerProvider()')
  if (resolved.retention !== undefined) {
    const retention = new LocalTeamArtifactRetention(ctx, provider, resolved.retention)
    ctx.effect(() => {
      const unprovide = ctx.provide('teamArtifactRetention', retention)
      retention.start()
      return async () => {
        try {
          await retention.close()
        } finally {
          unprovide()
        }
      }
    }, 'teamArtifactLocal.retention()')
  }
}

interface ReachabilitySnapshot {
  readonly teamsScanned: number
  readonly references: readonly TeamArtifactReference[]
}

async function collectReachableArtifacts(teams: TeamRuntime, pageSize: number): Promise<ReachabilitySnapshot> {
  const references = new Map<string, TeamArtifactReference>()
  let teamsScanned = 0
  let afterCursor: TeamListPageRequest['afterCursor'] = -1
  while (true) {
    const page = await teams.listTeamsPage({ afterCursor, limit: pageSize })
    for (const summary of page.items) {
      const state = await teams.getTeam({ teamId: summary.id })
      teamsScanned += 1
      for (const allocation of state.workspaceAllocations) {
        for (const reference of allocation.loss?.artifacts ?? []) references.set(reference.id, reference)
      }
      for (const task of state.tasks) {
        for (const attempt of task.attemptHistory) {
          if (attempt.outcome.kind !== 'completed') continue
          for (const reference of artifactReferences(attempt.outcome.result)) references.set(reference.id, reference)
        }
      }
    }
    if (page.nextCursor === undefined) break
    if (page.nextCursor === afterCursor) {
      throw new TeamError('team-artifact-local: Team listing cursor did not advance', 'TEAM_CURSOR_CONFLICT')
    }
    afterCursor = page.nextCursor
  }
  return { teamsScanned, references: [...references.values()] }
}

/** Collect every durable artifact slot, including integration-specific result fields. */
function artifactReferences(result: TaskAttemptResult): readonly TeamArtifactReference[] {
  return [
    ...(result.artifacts ?? []),
    ...(result.integration?.proposalArtifact === undefined ? [] : [result.integration.proposalArtifact]),
    ...(result.integration?.artifacts ?? []),
  ]
}

function resolveRetention(config: RetentionConfig): RetentionConfig {
  nonNegative(config.graceMs, 'retention.graceMs')
  positive(config.maxObjectsPerDrive, 'retention.maxObjectsPerDrive')
  positive(config.disposalTimeoutMs, 'retention.disposalTimeoutMs')
  if (config.pulseIntervalMs !== undefined) positive(config.pulseIntervalMs, 'retention.pulseIntervalMs')
  return { ...config }
}

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
}

function objectPath(root: string, digest: string): string {
  const path = join(root, digest.slice(0, 2), digest.slice(2))
  const child = relative(root, path)
  if (child.length === 0 || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new TeamArtifactError('artifact object path escaped its configured root', 'TEAM_ARTIFACT_INVALID')
  }
  return path
}

function artifactUri(provider: string, digest: string): string {
  return `artifact-local://${encodeURIComponent(provider)}/${digest}`
}

function digestFromReference(reference: TeamArtifactReference, provider: string): string {
  if (reference.provider !== undefined && reference.provider !== provider) {
    throw new TeamArtifactError(`Team artifact '${reference.id}' names provider '${reference.provider}', not '${provider}'`, 'TEAM_ARTIFACT_INVALID')
  }
  if (reference.id.startsWith(`${provider}:`)) {
    const digest = reference.id.slice(provider.length + 1)
    if (DIGEST.test(digest)) return digest
  }
  const prefix = `artifact-local://${encodeURIComponent(provider)}/`
  if (reference.uri.startsWith(prefix)) {
    const digest = reference.uri.slice(prefix.length)
    if (DIGEST.test(digest)) return digest
  }
  throw new TeamArtifactError(`Team artifact '${reference.id}' is not owned by provider '${provider}'`, 'TEAM_ARTIFACT_INVALID')
}

async function canonicalRoot(raw: string): Promise<string> {
  if (!isAbsolute(raw)) throw new TypeError('team-artifact-local: root must be an absolute path')
  try {
    await mkdir(raw, { recursive: true, mode: 0o700 })
    const path = await realpath(raw)
    if (!(await stat(path)).isDirectory()) throw new Error('not a directory')
    return path
  } catch (error: unknown) {
    throw new TypeError(`team-artifact-local: root '${raw}' cannot be prepared`, { cause: error })
  }
}

function normalized(value: string, field: string): string {
  if (value.length === 0 || value.trim() !== value) throw new TypeError(`team-artifact-local: ${field} must be non-empty without surrounding whitespace`)
  return value
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`team-artifact-local: ${field} must be a positive safe integer`)
  return value
}

function nonNegative(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`team-artifact-local: ${field} must be a non-negative safe integer`)
  return value
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EEXIST'
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validCollectionCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined
  if (!DIGEST.test(cursor)) throw new TeamArtifactError(`artifact collection cursor '${cursor}' is malformed`, 'TEAM_ARTIFACT_INVALID')
  return cursor
}

function ownedDigestOrUndefined(reference: TeamArtifactReference, provider: string): string | undefined {
  const ownedById = reference.id.startsWith(`${provider}:`)
  const ownedByUri = reference.uri.startsWith(`artifact-local://${encodeURIComponent(provider)}/`)
  if (!ownedById && !ownedByUri) return undefined
  return digestFromReference(reference, provider)
}

function localObjectId(reference: TeamArtifactReference, provider: string): string | undefined {
  const digest = ownedDigestOrUndefined(reference, provider)
  return digest === undefined ? undefined : `${provider}:${digest}`
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`team-artifact-local: retention disposal exceeded ${String(timeoutMs)}ms`)) }, timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}
