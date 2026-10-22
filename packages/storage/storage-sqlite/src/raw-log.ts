/** Logical SQLite preservation captures original frame bytes and versions under one consistent read transaction. */
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { assertLogReadRequest, StorageError, StorageReadLimitError } from '@clocky/clocky-storage'
import type { LogReadLimits, RawLogArchive } from '@clocky/clocky-storage'

/**
 * Capture a logical stream archive without opening a backend owner or interpreting consumer payloads.
 * @param path - Fixed database namespace selected by the provider, never a public caller path.
 * @param name - Exact retained stream name.
 * @param limits - Raw/complete archive byte and retained-entry refusal bounds.
 * @returns original logical frames or absence. This is not a physical database/WAL copy or validated domain state.
 */
export async function readSqliteRawLogArchive(path: string, name: string, limits: LogReadLimits): Promise<RawLogArchive | undefined> {
  assertLogReadRequest({ name, version: 0 }, limits)
  try { await stat(path) }
  catch (cause: unknown) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw cause }
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 0; BEGIN')
    const schema = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const columns = db.prepare('PRAGMA table_info(log_streams)').all() as Array<{ name: string }>
    const withSummary = columns.some(value => value.name === 'summary')
    const header = db.prepare(`SELECT version, tail_sequence, ${withSummary ? 'length(CAST(summary AS BLOB))' : 'NULL'} AS summary_bytes FROM log_streams WHERE name = ?`)
      .get(name) as { version: number; tail_sequence: number; summary_bytes: number | null } | undefined
    if (header === undefined) return undefined
    if (!Number.isSafeInteger(header.version) || header.version < 0
      || !Number.isSafeInteger(header.tail_sequence) || header.tail_sequence < -1)
      throw new StorageError('malformed-medium', 'Raw archive storage header has invalid version or tail')
    const count = db.prepare('SELECT MIN(sequence) AS first, MAX(sequence) AS last, COUNT(*) AS count, '
      + 'COALESCE(SUM(length(CAST(value AS BLOB))), 0) AS bytes FROM log_entries WHERE stream = ?').get(name) as
      { first: number | null; last: number | null; count: number; bytes: number }
    const checkpoint = db.prepare('SELECT sequence, length(CAST(value AS BLOB)) AS bytes FROM log_checkpoints WHERE stream = ?')
      .get(name) as { sequence: number; bytes: number } | undefined
    const firstSequence = count.first ?? 0
    if (firstSequence < 0 || count.count === 0 && header.tail_sequence !== -1 || count.count > 0
      && (count.last !== header.tail_sequence || count.count !== header.tail_sequence - firstSequence + 1))
      throw new StorageError('malformed-medium', 'Raw archive storage prefix is noncontiguous')
    if (count.count > limits.maxEntries) throw new StorageReadLimitError('entries', count.count, limits.maxEntries)
    const bytes = count.bytes + (checkpoint?.bytes ?? 0) + (header.summary_bytes ?? 0)
    if (bytes > limits.maxBytes) throw new StorageReadLimitError('bytes', bytes, limits.maxBytes)
    const rows = db.prepare('SELECT sequence, CAST(value AS BLOB) AS value FROM log_entries WHERE stream = ? ORDER BY sequence')
      .all(name) as Array<{ sequence: number; value: Uint8Array }>
    const checkpointBytes = checkpoint === undefined ? undefined : db.prepare('SELECT CAST(value AS BLOB) AS value FROM log_checkpoints WHERE stream = ?')
      .get(name) as { value: Uint8Array } | undefined
    const summary = !withSummary || header.summary_bytes === null ? undefined : db.prepare('SELECT CAST(summary AS BLOB) AS value FROM log_streams WHERE name = ?')
      .get(name) as { value: Uint8Array } | undefined
    const text = JSON.stringify({ format: 'clocky.raw-sqlite-logical/v1', storageSchemaVersion: schema.user_version, name,
      version: header.version, tailSequence: header.tail_sequence,
      entries: rows.map(row => ({ sequence: row.sequence, valueBase64: Buffer.from(row.value).toString('base64') })),
      ...checkpoint === undefined || checkpointBytes === undefined ? {} : {
        checkpoint: { sequence: checkpoint.sequence, valueBase64: Buffer.from(checkpointBytes.value).toString('base64') } },
      ...summary === undefined ? {} : { summaryBase64: Buffer.from(summary.value).toString('base64') } }) + '\n'
    const result: RawLogArchive = { version: header.version, firstSequence, tailSequence: header.tail_sequence, entryCount: rows.length,
      representation: 'sqlite-logical-frames', sourceHash: createHash('sha256').update(text).digest('hex'), text }
    const complete = Buffer.byteLength(JSON.stringify(result))
    if (complete > limits.maxBytes) throw new StorageReadLimitError('bytes', complete, limits.maxBytes)
    return result
  } finally { db.close() }
}
