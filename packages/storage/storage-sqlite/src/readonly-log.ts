/** Existing SQLite journals are observed through read-only connections and consistent read transactions. */
import { DatabaseSync } from 'node:sqlite'
import { stat } from 'node:fs/promises'
import { assertLogReadRequest, boundedLogReadSnapshot, StorageError } from '@clocky/clocky-storage'
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
    if (count.count > limits.maxEntries || count.bytes + (checkpointBytes?.bytes ?? 0) > limits.maxBytes) {
      throw new StorageError('invalid-value', 'SQLite log payload exceeds its read-only allowance')
    }
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
