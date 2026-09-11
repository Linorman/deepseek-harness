/**
 * On-disk JSON format for append-only log streams. The full document is one
 * atomic-rewrite unit, so an accepted batch never appears as a torn suffix.
 * @module @clocky/clocky-storage-json/src/log-format
 */

import { EMPTY_LOG_SEQUENCE, StorageError } from '@clocky/clocky-storage'
import type { LogCheckpoint, LogEntry, LogStreamDescriptor, LogStreamInfo } from '@clocky/clocky-storage'

/** Parsed stream state held by one open JSON log handle. */
export interface LogState {
  readonly version: number
  /** First retained sequence after an optional prefix compaction. */
  readonly firstSequence?: number
  readonly entries: readonly LogEntry[]
  readonly checkpoint?: LogCheckpoint
}

/**
 * Serialize a complete log state in the JSON backend's human-readable format.
 * @param descriptor - Stream identity and version stamped in the file header.
 * @param state - Complete in-memory stream state to persist.
 * @returns a pretty-printed JSON document with a trailing newline.
 */
export function serializeLog(descriptor: LogStreamDescriptor, state: LogState): string {
  const firstSequence = state.firstSequence ?? 0
  const document = {
    stream: {
      name: descriptor.name,
      version: state.version,
      ...(firstSequence === 0 ? {} : { firstSequence }),
    },
    entries: state.entries,
    ...(state.checkpoint === undefined ? {} : { checkpoint: state.checkpoint }),
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

/**
 * Parse and validate one full stream document against an expected descriptor.
 * @param text - Raw JSON document read from the stream file.
 * @param descriptor - Expected stream identity and format version.
 * @returns validated in-memory stream state.
 */
export function parseLog(text: string, descriptor: LogStreamDescriptor): LogState {
  const { info, state } = parseDocument(text)
  if (info.name !== descriptor.name) {
    throw new StorageError('malformed-medium', `log stream '${descriptor.name}': foreign stream header '${info.name}'`)
  }
  if (info.version !== descriptor.version) {
    throw new StorageError(
      'version-mismatch',
      `log stream '${descriptor.name}': stored version ${info.version} != expected ${descriptor.version}`,
    )
  }
  return state
}

/**
 * Parse a document while discovering its header for `LogFacet.list()`.
 * @param text - Raw JSON document read from one materialized stream file.
 * @returns validated stream metadata.
 */
export function parseLogInfo(text: string): LogStreamInfo {
  const { info } = parseDocument(text)
  return info
}

/** Complete JSON parse and logical consistency checks shared by open/list. */
function parseDocument(text: string): { info: LogStreamInfo; state: LogState } {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    throw new StorageError('malformed-medium', 'log stream file is not valid JSON', { cause: error })
  }
  if (!isRecord(document)) throw new StorageError('malformed-medium', 'log stream file is not a JSON object')
  const stream = document['stream']
  const entriesValue = document['entries']
  if (!isRecord(stream) || typeof stream['name'] !== 'string' || stream['name'].length === 0 || !isVersion(stream['version'])) {
    throw new StorageError('malformed-medium', 'log stream file has no valid stream header')
  }
  const firstSequence = stream['firstSequence'] === undefined ? 0 : stream['firstSequence']
  if (!isNonNegativeSequence(firstSequence)) {
    throw new StorageError('malformed-medium', `log stream '${stream['name']}' has an invalid first sequence`)
  }
  if (!Array.isArray(entriesValue)) {
    throw new StorageError('malformed-medium', `log stream '${stream['name']}': entries is not an array`)
  }
  const entries: LogEntry[] = []
  for (const [index, entry] of entriesValue.entries()) {
    if (!isRecord(entry) || !Object.hasOwn(entry, 'value') || !isSequence(entry['sequence']) || entry['sequence'] !== firstSequence + index) {
      throw new StorageError('malformed-medium', `log stream '${stream['name']}': entry ${index} is not contiguous`)
    }
    entries.push({ sequence: entry['sequence'], value: entry['value'] })
  }
  let checkpoint: LogCheckpoint | undefined
  if (Object.hasOwn(document, 'checkpoint')) {
    const value = document['checkpoint']
    if (!isRecord(value) || !Object.hasOwn(value, 'value') || !isSequence(value['sequence'])) {
      throw new StorageError('malformed-medium', `log stream '${stream['name']}': checkpoint is invalid`)
    }
    if (value['sequence'] > (entries.at(-1)?.sequence ?? EMPTY_LOG_SEQUENCE)) {
      throw new StorageError('malformed-medium', `log stream '${stream['name']}': checkpoint exceeds the durable tail`)
    }
    if (value['sequence'] >= 0 && value['sequence'] < firstSequence) {
      throw new StorageError('malformed-medium', `log stream '${stream['name']}': checkpoint precedes the retained prefix`)
    }
    checkpoint = { sequence: value['sequence'], value: value['value'] }
  }
  if (entries.length === 0 && firstSequence !== 0) {
    throw new StorageError('malformed-medium', `log stream '${stream['name']}' has a non-zero first sequence without entries`)
  }
  const tailSequence = entries.at(-1)?.sequence ?? firstSequence - 1
  const info: LogStreamInfo = {
    name: stream['name'],
    version: stream['version'],
    tailSequence,
    ...(checkpoint === undefined ? {} : { checkpointSequence: checkpoint.sequence }),
  }
  return {
    info,
    state: {
      version: info.version,
      ...(firstSequence === 0 ? {} : { firstSequence }),
      entries,
      ...(checkpoint === undefined ? {} : { checkpoint }),
    },
  }
}

/** Narrow an object record without accepting arrays or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Stream versions are non-negative safe integers. */
function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Entry and checkpoint sequence numbers may use the empty-stream sentinel. */
function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= EMPTY_LOG_SEQUENCE
}

/** Retained stream starts cannot use the empty-stream sentinel. */
function isNonNegativeSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
