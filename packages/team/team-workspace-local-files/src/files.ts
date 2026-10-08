/** Shared local filesystem implementation used by sandbox and shared-root Team workspaces.
 * @module @clocky/clocky-team-workspace-local-files
 */
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { cp,lstat,mkdir,readFile,readdir,rm,stat,symlink,writeFile } from 'node:fs/promises'
import { dirname,isAbsolute,join,relative,sep } from 'node:path'
import type { Context } from '@clocky/cordis'
import type {} from '@clocky/clocky-team-artifact'
import { TeamError } from '@clocky/clocky-team'
import { isTeamWorkspaceIntegrationMarkerBase,encodeTeamWorkspaceChangeSetIfSupported } from '@clocky/clocky-team-workspace'
import type { TeamWorkspaceAllocation,TeamWorkspaceChange,TeamWorkspaceIntegrationMarkerBase } from '@clocky/clocky-team-workspace'

/** Local prepared and committed markers both record the fully staged content version. */
export interface LocalIntegrationMarker extends TeamWorkspaceIntegrationMarkerBase {
  readonly targetVersion:string
  readonly status:'prepared'|'integrated'
}
/** Provider-resolved limits and artifact routing for one local file publication. */
export interface LocalArtifactOptions {
  readonly providerName:string
  readonly artifactProvider?:string
  readonly maxArtifactBytes:number
}

/** Apply validated portable changes without following symlink writes or deleting directories.
 * @param root - Canonical provider-owned directory.
 * @param changes - Validated ordered portable changes.
 * @param label - Existing provider label for its rejection diagnostics.
 * @returns completion after the filesystem operation settles.
 */
export async function applyChanges(root: string, changes: readonly TeamWorkspaceChange[], label: string): Promise<void> {
  for (const change of changes) {
    const absolute = portablePath(root, change.path, label)
    await ensureRegularDirectoryPath(root, dirname(absolute), label)
    let existing
    try {
      existing = await lstat(absolute)
    } catch (error: unknown) {
      if (!isNotFound(error)) throw error
    }
    if (change.kind === 'delete') {
      if (existing !== undefined && existing.isDirectory()) {
        throw new TeamError(`${label} integration cannot delete directory '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
      }
      await rm(absolute, { force: true })
      continue
    }
    if (existing !== undefined && existing.isDirectory()) {
      throw new TeamError(`${label} integration cannot replace directory '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
    }
    if (change.kind === 'file') {
      if (existing?.isSymbolicLink()) {
        throw new TeamError(`${label} integration cannot write through symlink '${change.path}'`, 'TEAM_INVALID_ARGUMENT')
      }
      await writeFile(absolute, Buffer.from(change.data, 'base64'), { mode: 0o600 })
    } else {
      await rm(absolute, { force: true })
      await symlink(change.target, absolute)
    }
  }
}

/** Copy a target tree into its private stage without following symlinks.
 * @param source - Existing source directory.
 * @param destination - Private staged directory.
 * @returns completion after the filesystem operation settles.
 */
export async function copyDirectoryContents(source: string, destination: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await cp(join(source, entry.name), join(destination, entry.name), {
      recursive: true,
      dereference: false,
      force: false,
    })
  }
}

/** Create missing parents and reject any existing symlink or non-directory ancestor.
 * @param root - Canonical provider-owned directory.
 * @param path - Provider-owned or validated child path.
 * @param label - Existing provider label for its rejection diagnostics.
 * @returns completion after the filesystem operation settles.
 */
export async function ensureRegularDirectoryPath(root: string, path: string, label: string): Promise<void> {
  const descendant = relative(root, path)
  if (descendant === '..' || descendant.startsWith(`..${sep}`) || isAbsolute(descendant)) {
    throw new TeamError(`${label} integration path escapes its configured root`, 'TEAM_INVALID_ARGUMENT')
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
      throw new TeamError(`${label} integration ancestor '${current}' is not a regular directory`, 'TEAM_INVALID_ARGUMENT')
    }
  }
}

/** Resolve a validated portable file path strictly below its target root.
 * @param root - Canonical provider-owned directory.
 * @param path - Provider-owned or validated child path.
 * @param label - Existing provider label for its rejection diagnostics.
 * @returns the resolved provider-owned path.
 */
export function portablePath(root: string, path: string, label: string): string {
  const absolute = join(root, ...path.split('/'))
  if (!isChildPath(root, absolute)) throw new TeamError(`${label} integration path '${path}' escapes its target`, 'TEAM_INVALID_ARGUMENT')
  return absolute
}

/** Test strict canonical path descent, rejecting equal paths and traversal.
 * @param parent - Canonical parent path.
 * @param child - Canonical candidate path.
 * @returns the predicate result.
 */
export function isChildPath(parent: string, child: string): boolean {
  const descendant = relative(parent, child)
  return descendant.length > 0 && descendant !== '..' && !descendant.startsWith(`..${sep}`) && !isAbsolute(descendant)
}

/** Test whether a canonical path is equal to or below its parent.
 * @param path - Provider-owned or validated child path.
 * @param parent - Canonical parent path.
 * @returns the predicate result.
 */
export function isPathUnder(path: string, parent: string): boolean {
  return path === parent || isChildPath(parent, path)
}

/** Probe directory availability; inaccessible paths report false.
 * @param path - Provider-owned or validated child path.
 * @returns the predicate result.
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

/** Check path existence while propagating failures other than absence.
 * @param path - Provider-owned or validated child path.
 * @returns completion after the filesystem operation settles.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error: unknown) {
    if (isNotFound(error)) return false
    throw error
  }
}

/** Classify only the Node filesystem absence error.
 * @param error - Filesystem failure at the provider IO boundary.
 * @returns the predicate result.
 */
export function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** Classify only a Node filesystem concurrent-create conflict.
 * @param error - Filesystem failure at the provider IO boundary.
 * @returns the predicate result.
 */
export function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

/** Read and validate a local recovery marker; an absent marker returns undefined.
 * @param path - Provider-owned or validated child path.
 * @param label - Existing provider label for its rejection diagnostics.
 * @returns the marker, or undefined when absent.
 */
export async function readLocalIntegrationMarker(path: string, label: string): Promise<LocalIntegrationMarker | undefined> {
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
    throw new TeamError(`${label} integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT', { cause: error })
  }
  if (!isLocalIntegrationMarker(parsed)) throw new TeamError(`${label} integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT')
  return parsed
}

/** Validate and write a local recovery marker, exclusively creating its prepared record.
 * @param path - Provider-owned or validated child path.
 * @param marker - Validated prepared or integrated marker.
 * @param label - Existing provider label for its rejection diagnostics.
 * @returns completion after the filesystem operation settles.
 */
export async function writeLocalIntegrationMarker(path: string, marker: LocalIntegrationMarker, label: string): Promise<void> {
  if (!isLocalIntegrationMarker(marker)) throw new TeamError(`${label} integration marker '${path}' is invalid`, 'TEAM_INVALID_ARGUMENT')
  await writeFile(path, JSON.stringify(marker), { mode: 0o600, flag: marker.status === 'prepared' ? 'wx' : 'w' })
}

/** Validate local recovery state after the shared marker header passes.
 * @param value - Parsed durable marker.
 * @returns the predicate result.
 */
function isLocalIntegrationMarker(value: unknown): value is LocalIntegrationMarker {
  if (!isTeamWorkspaceIntegrationMarkerBase(value)) return false
  const record = value as TeamWorkspaceIntegrationMarkerBase & Record<string, unknown>
  return typeof record.targetVersion === 'string'
    && (record.status === 'prepared' || record.status === 'integrated')
}

/** Publish bounded changed regular files, or create provider-owned URI references when no store is configured.
 * @param ctx - Provider context with optional artifact storage.
 * @param allocation - Current exact-attempt allocation.
 * @param paths - Changed relative file paths.
 * @param config - Resolved publication byte bound and artifact provider.
 * @returns bounded file references in source order.
 */
export async function materializeArtifacts(
  ctx: Context,
  allocation: TeamWorkspaceAllocation,
  paths: readonly string[],
  config: LocalArtifactOptions,
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

/** One local scanner entry used to build a portable patch without following symlinks. */
export type LocalFileFingerprint =
  | { readonly kind: 'file'; readonly size: number; readonly modifiedAt: number; readonly contentHash?: string }
  | { readonly kind: 'symlink'; readonly target: string }
  | { readonly kind: 'other'; readonly type: string }

/** Provider-resolved portable patch provenance and aggregate byte allowance. */
export interface LocalChangeSetOptions {
  readonly providerName: string
  readonly maxIntegrationBytes: number
}

/** Materialize an explicit provider-selected path window into one bounded portable patch.
 * @param allocation - Exact source-attempt allocation.
 * @param paths - Provider-selected changed paths, including observed deletions.
 * @param fileOf - Owning scanner's current entry lookup; missing entries encode deletion.
 * @param config - Resolved producer identity and encoded/decoded byte allowance.
 * @returns the encoded patch, or undefined when empty, unsupported or over its byte bound.
 */
export async function materializeLocalChangeSet(
  allocation: TeamWorkspaceAllocation, paths: readonly string[],
  fileOf: (path: string) => LocalFileFingerprint | undefined, config: LocalChangeSetOptions,
): Promise<string | undefined> {
  const changes: TeamWorkspaceChange[] = []
  for (const path of paths) {
    const entry = fileOf(path)
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
  return encodeTeamWorkspaceChangeSetIfSupported(
    { provider: config.providerName, sourceAttemptId: allocation.attemptId, changes }, config.maxIntegrationBytes,
  )
}
