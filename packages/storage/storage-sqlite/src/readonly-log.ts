/** Existing SQLite journals are observed through read-only connections and consistent read transactions. */
import { DatabaseSync } from 'node:sqlite'
import { stat } from 'node:fs/promises'
import { assertLogReadRequest, boundedLogReadSnapshot, StorageError, StorageReadLimitError } from '@clocky/clocky-storage'
import type { LogReadLimits, LogReadSnapshot, LogStreamDescriptor } from '@clocky/clocky-storage'
import { STORAGE_SQLITE_SCHEMA_VERSION } from './schema.ts'

/**
 * Read a complete retained stream without creating databases, migrating schemas or taking writer ownership.
 * @param path - Deployment-resolved existing database path.
 * @param descriptor - Expected stream identity and durable format.
 * @param limits - Explicit retained-row and complete-byte allowances.
 * @returns one consistent detached observation, or undefined for missing database/stream.
 */
export async function readSqliteLogSnapshot(path: string, descriptor: LogStreamDescriptor, limits: LogReadLimits):
Promise<LogReadSnapshot | undefined> {
  assertLogReadRequest(descriptor, limits)
  try { await stat(path) }
  catch (cause: unknown) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 0; BEGIN')
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version !== STORAGE_SQLITE_SCHEMA_VERSION) {
      throw new StorageError('version-mismatch', 'Read-only SQLite database schema does not match this build')
    }
    const header = db.prepare('SELECT version, tail_sequence FROM log_streams WHERE name = ?').get(descriptor.name) as
      { version: number; tail_sequence: number } | undefined
    if (header === undefined) return undefined
    if (header.version !== descriptor.version) throw new StorageError('version-mismatch', 'Read-only SQLite stream format does not match')
    const count = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(value AS BLOB))), 0) AS bytes '
      + 'FROM log_entries WHERE stream = ?').get(descriptor.name) as { count: number; bytes: number }
    const checkpointBytes = db.prepare('SELECT length(CAST(value AS BLOB)) AS bytes FROM log_checkpoints WHERE stream = ?')
      .get(descriptor.name) as { bytes: number } | undefined
    if (count.count > limits.maxEntries) throw new StorageReadLimitError('entries', count.count, limits.maxEntries)
    const bytes = count.bytes + (checkpointBytes?.bytes ?? 0)
    if (bytes > limits.maxBytes) throw new StorageReadLimitError('bytes', bytes, limits.maxBytes)
    const rows = db.prepare('SELECT sequence, value FROM log_entries WHERE stream = ? ORDER BY sequence').all(descriptor.name) as
      { sequence: number; value: string }[]
    const checkpoint = db.prepare('SELECT sequence, value FROM log_checkpoints WHERE stream = ?').get(descriptor.name) as
      { sequence: number; value: string } | undefined
    return boundedLogReadSnapshot({ ...descriptor, firstSequence: rows[0]?.sequence ?? 0, tailSequence: header.tail_sequence,
      entries: rows.map(row => ({ sequence: row.sequence, value: parseValue(row.value) })),
      ...checkpoint === undefined ? {} : { checkpoint: { sequence: checkpoint.sequence, value: parseValue(checkpoint.value) } } }, limits)
  } finally { db.close() }
}

/** Decode durable JSON without returning malformed data as an empty observation. */
function parseValue(value: string): unknown {
  try { return JSON.parse(value) as unknown }
  catch (cause: unknown) { throw new StorageError('malformed-medium', 'Read-only SQLite log contains malformed JSON', { cause }) }
}

/**
 * Scan a fixed SQLite prefix through bounded pages in one read transaction.
 * @param path - Existing database; this reader does not create, migrate or acquire writer ownership.
 * @param descriptor - Exact expected stream identity and version.
 * @param limits - Whole-prefix refusal bounds and independent page allocation bounds.
 * @yields contiguous pages from the captured first/tail sequence; later appends cannot enter this observation.
 * @returns after complete prefix validation; missing files/streams yield no pages and remain absent.
 */
export async function* readSqliteLogPages(path: string, descriptor: LogStreamDescriptor,
  limits: import('@clocky/clocky-storage').LogReadPageLimits): AsyncGenerator<import('@clocky/clocky-storage').LogReadPage> {
  assertLogReadRequest(descriptor, limits)
  assertLogReadRequest(descriptor, { maxEntries: limits.pageEntries, maxBytes: limits.pageBytes })
  try { await stat(path) }
  catch (cause: unknown) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw cause
  }
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 0; BEGIN')
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version !== STORAGE_SQLITE_SCHEMA_VERSION) throw new StorageError('version-mismatch', 'Read-only SQLite schema mismatch')
    const header = db.prepare('SELECT version, tail_sequence FROM log_streams WHERE name = ?').get(descriptor.name) as
      { version: number; tail_sequence: number } | undefined
    if (header === undefined) return
    if (header.version !== descriptor.version) throw new StorageError('version-mismatch', 'Read-only SQLite stream format mismatch')
    const bounds = db.prepare('SELECT MIN(sequence) AS first, MAX(sequence) AS last, COUNT(*) AS count FROM log_entries WHERE stream = ?')
      .get(descriptor.name) as { first: number | null; last: number | null; count: number }
    const firstSequence = bounds.first ?? 0, tailSequence = header.tail_sequence
    if (!Number.isSafeInteger(firstSequence) || firstSequence < 0 || !Number.isSafeInteger(tailSequence) || tailSequence < -1
      || bounds.count === 0 && tailSequence !== -1
      || bounds.count > 0 && (bounds.last !== tailSequence || bounds.count !== tailSequence - firstSequence + 1))
      throw new StorageError('malformed-medium', 'Read-only SQLite stream prefix is not contiguous')
    if (bounds.count > limits.maxEntries) throw new StorageReadLimitError('entries', bounds.count, limits.maxEntries)
    let after = firstSequence - 1, totalBytes = 0
    if (bounds.count === 0) {
      const page = { ...descriptor, firstSequence, tailSequence, entries: [], bytes: 0 }
      page.bytes = Buffer.byteLength(JSON.stringify(page)) + 16
      if (page.bytes > limits.pageBytes) throw new StorageReadLimitError('bytes', page.bytes, limits.pageBytes)
      if (page.bytes > limits.maxBytes) throw new StorageReadLimitError('bytes', page.bytes, limits.maxBytes)
      yield page; return
    }
    while (after < tailSequence) {
      const sizes = db.prepare('SELECT sequence, length(CAST(value AS BLOB)) AS bytes FROM log_entries '
        + 'WHERE stream = ? AND sequence > ? AND sequence <= ? ORDER BY sequence LIMIT ?')
        .all(descriptor.name, after, tailSequence, limits.pageEntries) as Array<{ sequence: number; bytes: number }>
      if (sizes.length === 0) throw new StorageError('malformed-medium', 'Read-only SQLite stream has a sequence gap')
      let through = after
      let bytes = Buffer.byteLength(JSON.stringify({ ...descriptor, firstSequence, tailSequence,
        entries: [], bytes: Number.MAX_SAFE_INTEGER }))
      for (const row of sizes) {
        if (row.sequence !== through + 1) throw new StorageError('malformed-medium', 'Read-only SQLite stream has a sequence gap')
        const required = row.bytes + Buffer.byteLength(`{"sequence":${row.sequence},"value":}`) + 1
        if (bytes + required > limits.pageBytes) {
          if (through === after) throw new StorageReadLimitError('entry-bytes', bytes + required, limits.pageBytes)
          break
        }
        bytes += required; through = row.sequence
      }
      const rows = db.prepare('SELECT sequence, value FROM log_entries WHERE stream = ? AND sequence > ? AND sequence <= ? ORDER BY sequence')
        .all(descriptor.name, after, through) as Array<{ sequence: number; value: string }>
      if (rows.length !== through - after) throw new StorageError('malformed-medium', 'Read-only SQLite page is incomplete')
      const page = { ...descriptor, firstSequence, tailSequence,
        entries: rows.map(row => ({ sequence: row.sequence, value: parseValue(row.value) })), bytes }
      const completeBytes = Buffer.byteLength(JSON.stringify(page))
      if (completeBytes > limits.pageBytes) throw new StorageReadLimitError('bytes', completeBytes, limits.pageBytes)
      totalBytes += completeBytes
      if (totalBytes > limits.maxBytes) throw new StorageReadLimitError('bytes', totalBytes, limits.maxBytes)
      yield page
      after = through
    }
  } finally { db.close() }
}
