/** Portable provider-owned change-set artifacts used by non-Git workspace integrations. */

import { taskAttemptIdSchema, TeamError } from '@clocky/clocky-team'
import type { TaskAttemptId } from '@clocky/clocky-team'

/** Current JSON encoding version for provider-specific workspace change sets. */
export const TEAM_WORKSPACE_CHANGE_SET_VERSION = 1 as const

/** One safe relative change in a provider-owned workspace tree. */
export type TeamWorkspaceChange =
  | { readonly path: string; readonly kind: 'file'; readonly data: string }
  | { readonly path: string; readonly kind: 'symlink'; readonly target: string }
  | { readonly path: string; readonly kind: 'delete' }

/** Portable change set embedded in one provenance-bound `patch` artifact. */
export interface TeamWorkspaceChangeSet {
  /** Encoding version. */
  readonly version: typeof TEAM_WORKSPACE_CHANGE_SET_VERSION
  /** Provider identity that must apply this change set. */
  readonly provider: string
  /** Completed source attempt that produced the changes. */
  readonly sourceAttemptId: TaskAttemptId
  /** Ordered, distinct relative changes. */
  readonly changes: readonly TeamWorkspaceChange[]
}

/**
 * Encode a portable change set and enforce its bounded artifact size.
 * @param value - provider identity, source attempt, and relative changes.
 * @param maxBytes - maximum UTF-8 byte length of the encoded change set.
 * @returns the canonical JSON representation.
 */
export function encodeTeamWorkspaceChangeSet(
  value: Omit<TeamWorkspaceChangeSet, 'version'>,
  maxBytes: number,
): string {
  const parsed = parseTeamWorkspaceChangeSet(
    { ...value, version: TEAM_WORKSPACE_CHANGE_SET_VERSION },
    value.provider,
    value.sourceAttemptId,
    maxBytes,
  )
  const encoded = JSON.stringify(parsed)
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) {
    throw new TeamError(`Team workspace change set exceeds the configured ${String(maxBytes)}-byte limit`, 'TEAM_INVALID_ARGUMENT')
  }
  return encoded
}

/**
 * Parse and verify one provider-owned portable change set at an artifact boundary.
 * @param value - decoded JSON value.
 * @param provider - provider identity that is allowed to consume the set.
 * @param sourceAttemptId - completed attempt identity expected by the integration task.
 * @param maxBytes - maximum UTF-8 byte length and decoded file-byte bound.
 * @returns the validated change set.
 */
export function parseTeamWorkspaceChangeSet(
  value: unknown,
  provider: string,
  sourceAttemptId: TaskAttemptId,
  maxBytes: number,
): TeamWorkspaceChangeSet {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TeamError('Team workspace change-set size bound must be a positive safe integer', 'TEAM_INVALID_ARGUMENT')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TeamError('Team workspace change set must be an object', 'TEAM_INVALID_ARGUMENT')
  }
  const record = value as Record<string, unknown>
  if (record.version !== TEAM_WORKSPACE_CHANGE_SET_VERSION
    || record.provider !== provider
    || record.sourceAttemptId !== sourceAttemptId
    || !Array.isArray(record.changes)
    || record.changes.length === 0
    || Object.keys(record).some(key => !['version', 'provider', 'sourceAttemptId', 'changes'].includes(key))) {
    throw new TeamError('Team workspace change set provenance or version is invalid', 'TEAM_INVALID_ARGUMENT')
  }
  const changes: TeamWorkspaceChange[] = []
  const paths = new Set<string>()
  let decodedBytes = 0
  for (const raw of record.changes) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new TeamError('Team workspace change set contains an invalid change', 'TEAM_INVALID_ARGUMENT')
    }
    const change = raw as Record<string, unknown>
    if (typeof change.path !== 'string' || !isPortablePath(change.path) || paths.has(change.path)) {
      throw new TeamError('Team workspace change set contains a duplicate or unsafe path', 'TEAM_INVALID_ARGUMENT')
    }
    paths.add(change.path)
    if (change.kind === 'delete') {
      if (Object.keys(change).some(key => key !== 'path' && key !== 'kind')) {
        throw new TeamError('Team workspace delete change contains unexpected fields', 'TEAM_INVALID_ARGUMENT')
      }
      changes.push({ path: change.path, kind: 'delete' })
      continue
    }
    if (change.kind === 'symlink') {
      if (typeof change.target !== 'string' || !isPortableSymlinkTarget(change.target)
        || Object.keys(change).some(key => !['path', 'kind', 'target'].includes(key))) {
        throw new TeamError('Team workspace symlink change is invalid', 'TEAM_INVALID_ARGUMENT')
      }
      changes.push({ path: change.path, kind: 'symlink', target: change.target })
      continue
    }
    if (change.kind !== 'file' || typeof change.data !== 'string'
      || !isBase64(change.data)
      || Object.keys(change).some(key => !['path', 'kind', 'data'].includes(key))) {
      throw new TeamError('Team workspace file change is invalid', 'TEAM_INVALID_ARGUMENT')
    }
    const byteLength = base64ByteLength(change.data)
    decodedBytes += byteLength
    if (decodedBytes > maxBytes) {
      throw new TeamError(`Team workspace change set exceeds the configured ${String(maxBytes)}-byte limit`, 'TEAM_INVALID_ARGUMENT')
    }
    changes.push({ path: change.path, kind: 'file', data: change.data })
  }
  return {
    version: TEAM_WORKSPACE_CHANGE_SET_VERSION,
    provider,
    sourceAttemptId: taskAttemptIdSchema.parse(sourceAttemptId),
    changes,
  }
}

/** Check the portable path grammar before a provider maps it to a host path. */
function isPortablePath(value: string): boolean {
  if (value.length === 0 || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false
  const parts = value.split('/')
  return parts.every(part => part.length > 0 && part !== '.' && part !== '..')
}

/** Keep integrated symlink targets relative to the target provider root. */
function isPortableSymlinkTarget(value: string): boolean {
  return value.length > 0 && !value.startsWith('/') && !value.includes('\\') && !value.includes('\0')
    && value.split('/').every(part => part.length > 0 && part !== '..')
}

/** Validate canonical RFC 4648 base64 without accepting alternate encodings. */
function isBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false
  return true
}

/** Return decoded byte length without allocating a second copy of the payload. */
function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return value.length / 4 * 3 - padding
}
