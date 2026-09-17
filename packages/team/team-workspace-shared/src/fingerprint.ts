/** Bounded shared-tree observations without following symlink entries. @module */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, readlink, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { TeamError, teamWorkspaceContentVersionSchema } from '@clocky/clocky-team'
import type { TeamWorkspaceScanVersion } from '@clocky/clocky-team'

/** One observed file, link or non-regular entry; file content never leaves the scanner. */
export type FileFingerprint =
  | { readonly kind: 'file'; readonly size: number; readonly modifiedAt: number; readonly contentHash?: string }
  | { readonly kind: 'symlink'; readonly target: string }
  | { readonly kind: 'other'; readonly type: string }

/** Deployment-selected traversal and file-read bounds. */
export interface ScanLimits {
  /** Provider-owned sidecars are excluded from the observed user tree. */
  readonly observationStateRoot?: string
  /** Canonical deployment-owned directories excluded from task change observations. */
  readonly observationExcludedRoots?: readonly string[]
  readonly observationMaxEntries: number
  readonly observationMaxHashBytes: number
  readonly observationMaxFileBytes: number
  readonly observationTimeoutMs: number
}

/** Bounded fingerprints plus explicit completeness and traversal window. */
export interface DirectorySnapshot {
  readonly files: Readonly<Record<string, FileFingerprint>>
  readonly version: TeamWorkspaceScanVersion
}

/**
 * Inspect one bounded directory window, capturing symlink targets as data and never reading them.
 * @param root - Canonical allocation root whose parent identity is checked before and after file reads.
 * @param limits - Entry, aggregate-byte, per-file-byte and elapsed-time bounds.
 * @param signal - Optional current publisher cancellation, joined with the traversal deadline.
 * @returns Captured fingerprints with explicit incomplete facts for limits, races and filesystem failures.
 */
export async function snapshotDirectory(root: string, limits: ScanLimits, signal?: AbortSignal): Promise<DirectorySnapshot> {
  const excluded = new Set([limits.observationStateRoot, ...limits.observationExcludedRoots ?? []])
  const files = Object.create(null) as Record<string, FileFingerprint>
  const reasons = new Set<string>()
  let scannedEntries = 0
  let hashedBytes = 0
  let knownOmittedEntries = 0
  const startedAt = Date.now()
  const started = performance.now()
  const cancellation = new AbortController()
  const cancel = (): void => { cancellation.abort(signal?.reason) }
  if (signal?.aborted === true) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => { cancellation.abort() }, limits.observationTimeoutMs)
  timer.unref()
  const expired = (): boolean => {
    if (cancellation.signal.aborted || performance.now() - started >= limits.observationTimeoutMs) {
      reasons.add(signal?.aborted === true ? 'canceled' : 'duration-limit')
      return true
    }
    return false
  }
  const inside = (path: string): boolean => {
    const child = relative(root, path)
    return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  }
  async function visit(directory: string, prefix: string): Promise<void> {
    if (expired()) return
    if (await realpath(directory) !== directory || !inside(directory)) {
      reasons.add('directory-identity-changed')
      return
    }
    const directoryBefore = await lstat(directory)
    if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink()) { reasons.add('directory-identity-changed'); return }
    const entries = []
    const handle = await opendir(directory)
    try {
      for await (const entry of handle) {
        if (expired()) break
        if (scannedEntries >= limits.observationMaxEntries) {
          reasons.add('entry-limit')
          knownOmittedEntries += 1
          break
        }
        scannedEntries += 1
        entries.push(entry)
      }
    } catch (error: unknown) {
      reasons.add(cancellation.signal.aborted ? signal?.aborted === true ? 'canceled' : 'duration-limit' : filesystemReason(error))
    }
    for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      if (expired()) break
      const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (path.includes('\\') || path.includes('\0')) { reasons.add('non-portable-path'); knownOmittedEntries += 1; continue }
      const absolute = join(directory, entry.name)
      if (excluded.has(absolute)) continue
      try {
        if (await realpath(directory) !== directory) { reasons.add('directory-identity-changed'); continue }
        const info = await lstat(absolute)
        if (info.isSymbolicLink()) { files[path] = { kind: 'symlink', target: await readlink(absolute) }; continue }
        if (info.isDirectory()) { await visit(absolute, path); continue }
        if (!info.isFile()) { files[path] = { kind: 'other', type: String(info.mode & constants.S_IFMT) }; continue }
        if (info.size > limits.observationMaxFileBytes || info.size > limits.observationMaxHashBytes - hashedBytes) {
          reasons.add(info.size > limits.observationMaxFileBytes ? 'file-byte-limit' : 'hash-byte-limit')
          knownOmittedEntries += 1
          files[path] = { kind: 'file', size: info.size, modifiedAt: info.mtimeMs }
          continue
        }
        const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const opened = await file.stat()
          if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || await realpath(directory) !== directory) {
            reasons.add('file-identity-changed')
            continue
          }
          const hash = createHash('sha256')
          let size = 0
          if (info.size > 0) {
            const stream = file.createReadStream({ start: 0, end: info.size - 1, autoClose: false, signal: cancellation.signal })
            for await (const chunk of stream) {
              const bytes = chunk as Buffer
              hashedBytes += bytes.byteLength
              size += bytes.byteLength
              hash.update(bytes)
            }
          }
          const after = await file.stat()
          if (size !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || await realpath(directory) !== directory) {
            reasons.add('file-changed-during-scan')
            continue
          }
          files[path] = { kind: 'file', size, modifiedAt: 0, contentHash: hash.digest('hex') }
        } finally { await file.close() }
      } catch (error: unknown) {
        reasons.add(cancellation.signal.aborted ? signal?.aborted === true ? 'canceled' : 'duration-limit' : filesystemReason(error))
      }
    }
    const directoryAfter = await lstat(directory)
    if (directoryAfter.ino !== directoryBefore.ino || directoryAfter.dev !== directoryBefore.dev
      || directoryAfter.mtimeMs !== directoryBefore.mtimeMs || directoryAfter.ctimeMs !== directoryBefore.ctimeMs) {
      reasons.add('directory-changed-during-scan')
    }
  }
  try { await visit(root, ''); expired() } catch (error: unknown) { reasons.add(filesystemReason(error)) } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
  const complete = reasons.size === 0
  const ordered = Object.fromEntries(Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
  const digest = fingerprintDirectoryEntries(ordered, complete)
  return { files: ordered, version: { digest, complete, startedAt, finishedAt: Math.max(startedAt, Date.now()),
    scannedEntries, hashedBytes, knownOmittedEntries, incompleteReasons: [...reasons].sort() } }
}

/** Retain stable filesystem error categories without recording file contents or platform error prose. */
function filesystemReason(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? `filesystem-${error.code}` : 'filesystem-error'
}

/**
 * Hash canonical tuples of captured entries, including the completeness marker.
 * @param files - Validated fingerprints keyed by portable relative paths.
 * @param complete - Whether every selected entry and regular-file byte was captured.
 * @returns A digest of observed data; incomplete digests never identify a complete tree.
 */
export function fingerprintDirectoryEntries(files: Readonly<Record<string, FileFingerprint>>, complete: boolean): TeamWorkspaceScanVersion['digest'] {
  const entries = Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, value]) => value.kind === 'file' ? [path, value.kind, value.size, value.modifiedAt, value.contentHash ?? null]
      : value.kind === 'symlink' ? [path, value.kind, value.target] : [path, value.kind, value.type])
  return teamWorkspaceContentVersionSchema.parse(`sha256:${createHash('sha256').update(JSON.stringify([complete, entries])).digest('hex')}`)
}

/**
 * Read provider baseline bytes through a regular-file handle with a strict byte ceiling.
 * @param path - Provider-owned baseline path, never followed through a final symlink.
 * @param limit - Maximum accepted bytes, including files that grow during the read.
 * @returns Bounded bytes for the durable JSON parser.
 */
export async function readBoundedBaseline(path: string, limit: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > limit) throw new TeamError('Workspace baseline is not a bounded regular file', 'TEAM_INVALID_ARGUMENT')
    const chunks: Buffer[] = []
    let size = 0
    const stream = handle.createReadStream({ start: 0, end: limit, autoClose: false })
    for await (const chunk of stream) {
      const bytes = chunk as Buffer
      size += bytes.length
      if (size > limit) throw new TeamError('Workspace baseline exceeds its byte limit', 'TEAM_INVALID_ARGUMENT')
      chunks.push(bytes)
    }
    return Buffer.concat(chunks, size)
  } finally { await handle.close() }
}
