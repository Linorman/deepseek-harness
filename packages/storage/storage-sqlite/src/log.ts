/**
 * SQLite implementation of append-only storage-log streams. `BEGIN IMMEDIATE`
 * protects the expected-tail check and complete batch against a second process
 * sharing the same database file.
 * @module @clocky/clocky-storage-sqlite/src/log
 */

import type { DatabaseSync, StatementSync } from 'node:sqlite'
import {
  assertLogCompactionBounds,
  assertLogCompactionRequest,
  EMPTY_LOG_SEQUENCE,
  StorageError,
} from '@clocky/clocky-storage'
import type {
  LogAppendOptions, LogAppendResult, LogCheckpoint, LogCompactionRequest, LogEntry, LogStream, LogStreamDescriptor,
} from '@clocky/clocky-storage'

/**
 * Open a stream after the backend has checked its descriptor and open slot.
 * @param db - Backend-owned SQLite connection.
 * @param descriptor - Expected stream identity and version.
 * @param onClose - Callback releasing the backend's open-stream slot.
 * @param isBackendClosed - Reads whether backend shutdown has closed admission.
 * @returns a caller-owned stream handle.
 */
export function openSqliteLog(
  db: DatabaseSync,
  descriptor: LogStreamDescriptor,
  onClose: () => void,
  isBackendClosed: () => boolean,
): LogStream {
  validateExistingStream(db, descriptor)
  return new SqliteLogStream(db, descriptor, onClose, isBackendClosed)
}

/**
 * Validate the durable stream row and every entry before a handle is exposed.
 * @param db - Backend-owned SQLite connection.
 * @param descriptor - Expected stream identity and version.
 */
export function validateExistingStream(db: DatabaseSync, descriptor: LogStreamDescriptor): void {
  const row = db.prepare('SELECT version, tail_sequence FROM log_streams WHERE name = ?').get(descriptor.name) as
    | { version: number; tail_sequence: number }
    | undefined
  if (row === undefined) return
  if (!isVersion(row.version) || !isSequence(row.tail_sequence)) {
    throw new StorageError('malformed-medium', `log stream '${descriptor.name}' has invalid metadata`)
  }
  if (row.version !== descriptor.version) {
    throw new StorageError(
      'version-mismatch',
      `log stream '${descriptor.name}' is stamped version ${row.version}, incompatible with ${descriptor.version}`,
    )
  }
  const entries = db.prepare('SELECT sequence, value FROM log_entries WHERE stream = ? ORDER BY sequence ASC').all(descriptor.name) as
    Array<{ sequence: number; value: string }>
  if (row.tail_sequence !== (entries.at(-1)?.sequence ?? EMPTY_LOG_SEQUENCE)) {
    throw new StorageError('malformed-medium', `log stream '${descriptor.name}' has a tail watermark gap`)
  }
  const firstSequence = entries[0]?.sequence ?? 0
  for (const [index, entry] of entries.entries()) {
    if (entry.sequence !== firstSequence + index) {
      throw new StorageError('malformed-medium', `log stream '${descriptor.name}' has a torn entry sequence at ${entry.sequence}`)
    }
    parseStoredValue(descriptor.name, `entry ${entry.sequence}`, entry.value)
  }
  const checkpoint = db.prepare('SELECT sequence, value FROM log_checkpoints WHERE stream = ?').get(descriptor.name) as
    | { sequence: number; value: string }
    | undefined
  if (checkpoint !== undefined) {
    if (!isSequence(checkpoint.sequence) || checkpoint.sequence > row.tail_sequence) {
      throw new StorageError('malformed-medium', `log stream '${descriptor.name}' has an invalid checkpoint watermark`)
    }
    if (checkpoint.sequence >= 0 && checkpoint.sequence < firstSequence) {
      throw new StorageError('malformed-medium', `log stream '${descriptor.name}' has a checkpoint before the retained prefix`)
    }
    parseStoredValue(descriptor.name, 'checkpoint', checkpoint.value)
  }
}

/** One SQLite stream and its prepared statements. */
class SqliteLogStream implements LogStream {
  private readonly selectStream: StatementSync
  private readonly createStream: StatementSync
  private readonly updateTail: StatementSync
  private readonly insertEntry: StatementSync
  private readonly selectEntries: StatementSync
  private readonly selectCheckpoint: StatementSync
  private readonly upsertCheckpoint: StatementSync
  private readonly deleteEntries: StatementSync
  private readonly selectFirstEntry: StatementSync
  private closed = false

  constructor(
    private readonly db: DatabaseSync,
    readonly descriptor: LogStreamDescriptor,
    private readonly onClose: () => void,
    private readonly isBackendClosed: () => boolean,
  ) {
    this.selectStream = db.prepare('SELECT version, tail_sequence FROM log_streams WHERE name = ?')
    this.createStream = db.prepare('INSERT INTO log_streams (name, version, tail_sequence) VALUES (?, ?, ?)')
    this.updateTail = db.prepare('UPDATE log_streams SET tail_sequence = ?, summary = ? WHERE name = ?')
    this.insertEntry = db.prepare('INSERT INTO log_entries (stream, sequence, value) VALUES (?, ?, ?)')
    this.selectEntries = db.prepare(
      'SELECT sequence, value FROM log_entries WHERE stream = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?',
    )
    this.selectCheckpoint = db.prepare('SELECT sequence, value FROM log_checkpoints WHERE stream = ?')
    this.upsertCheckpoint = db.prepare(
      'INSERT INTO log_checkpoints (stream, sequence, value) VALUES (?, ?, ?) '
      + 'ON CONFLICT(stream) DO UPDATE SET sequence = excluded.sequence, value = excluded.value',
    )
    this.deleteEntries = db.prepare('DELETE FROM log_entries WHERE stream = ? AND sequence <= ?')
    this.selectFirstEntry = db.prepare('SELECT sequence FROM log_entries WHERE stream = ? ORDER BY sequence ASC LIMIT 1')
  }

  get name(): string { return this.descriptor.name }
  get version(): number { return this.descriptor.version }
  get firstSequence(): number {
    this.ensureOpen()
    const row = this.selectFirstEntry.get(this.name) as { sequence: number } | undefined
    return row?.sequence ?? 0
  }
  get tailSequence(): number {
    this.ensureOpen()
    const row = this.selectStream.get(this.name) as { tail_sequence: number } | undefined
    return row?.tail_sequence ?? EMPTY_LOG_SEQUENCE
  }

  append(expectedSequence: number, values: readonly unknown[], options?: LogAppendOptions): Promise<LogAppendResult> {
    try {
      assertSequence('expectedSequence', expectedSequence)
      if (values.length === 0) throw new Error(`log stream '${this.name}' append values must be non-empty`)
      const summary = options === undefined ? null : serializeValue(this.name, 'summary', options.summary)
      const serialized = values.map(value => serializeValue(this.name, 'append value', value))
      const result = this.transaction(() => {
        const tail = this.currentTail()
        if (tail !== expectedSequence) {
          throw new StorageError('sequence-conflict', `log stream '${this.name}' tail is ${tail}, expected ${expectedSequence}`)
        }
        for (const [index, value] of serialized.entries()) {
          this.insertEntry.run(this.name, tail + index + 1, value)
        }
        const tailSequence = tail + serialized.length
        this.updateTail.run(tailSequence, summary, this.name)
        return { tailSequence }
      })
      return Promise.resolve(result)
    } catch (error) {
      return Promise.reject(asError(error))
    }
  }

  read(afterSequence: number, limit: number): Promise<readonly LogEntry[]> {
    try {
      assertSequence('afterSequence', afterSequence)
      assertPositiveLimit(limit)
      this.ensureOpen()
      const rows = this.selectEntries.all(this.name, afterSequence, limit) as Array<{ sequence: number; value: string }>
      if (rows[0] !== undefined && rows[0].sequence > afterSequence + 1) {
        throw new StorageError(
          'compacted',
          `log stream '${this.name}' compacted through ${rows[0].sequence - 1}; cursor ${afterSequence} is no longer readable`,
        )
      }
      return Promise.resolve(rows.map(row => ({
        sequence: row.sequence,
        value: parseStoredValue(this.name, `entry ${row.sequence}`, row.value),
      })))
    } catch (error) {
      return Promise.reject(asError(error))
    }
  }

  readCheckpoint(): Promise<LogCheckpoint | undefined> {
    try {
      this.ensureOpen()
      const row = this.selectCheckpoint.get(this.name) as { sequence: number; value: string } | undefined
      return Promise.resolve(row === undefined
        ? undefined
        : { sequence: row.sequence, value: parseStoredValue(this.name, 'checkpoint', row.value) })
    } catch (error) {
      return Promise.reject(asError(error))
    }
  }

  writeCheckpoint(checkpoint: LogCheckpoint): Promise<void> {
    try {
      assertSequence('checkpoint.sequence', checkpoint.sequence)
      const value = serializeValue(this.name, 'checkpoint', checkpoint.value)
      this.transaction(() => {
        const tail = this.currentTail()
        const prior = this.selectCheckpoint.get(this.name) as { sequence: number } | undefined
        if (checkpoint.sequence > tail || checkpoint.sequence < (prior?.sequence ?? EMPTY_LOG_SEQUENCE)) {
          throw new StorageError(
            'checkpoint-conflict',
            `log stream '${this.name}' cannot store checkpoint ${checkpoint.sequence} at tail ${tail}`,
          )
        }
        this.upsertCheckpoint.run(this.name, checkpoint.sequence, value)
      })
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(asError(error))
    }
  }

  compact(request: LogCompactionRequest): Promise<void> {
    try {
      assertLogCompactionRequest(request)
      this.transaction(() => {
        const row = this.selectStream.get(this.name) as { version: number; tail_sequence: number } | undefined
        if (row === undefined || row.version !== this.version) {
          throw new StorageError(
            'checkpoint-conflict',
            `log stream '${this.name}' has no current durable stream for compaction`,
          )
        }
        const checkpoint = this.selectCheckpoint.get(this.name) as { sequence: number } | undefined
        assertLogCompactionBounds(this.name, row.tail_sequence, checkpoint?.sequence, request)
        this.deleteEntries.run(this.name, request.throughSequence)
      })
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(asError(error))
    }
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.onClose()
    }
    return Promise.resolve()
  }

  /** Read or create the metadata row while the caller holds a SQLite write transaction. */
  private currentTail(): number {
    this.ensureOpen()
    const row = this.selectStream.get(this.name) as { version: number; tail_sequence: number } | undefined
    if (row === undefined) {
      this.createStream.run(this.name, this.version, EMPTY_LOG_SEQUENCE)
      return EMPTY_LOG_SEQUENCE
    }
    if (row.version !== this.version) {
      throw new StorageError(
        'version-mismatch',
        `log stream '${this.name}' is stamped version ${row.version}, incompatible with ${this.version}`,
      )
    }
    if (!isSequence(row.tail_sequence)) {
      throw new StorageError('malformed-medium', `log stream '${this.name}' has an invalid tail watermark`)
    }
    return row.tail_sequence
  }

  /** Execute a synchronous SQLite transaction with rollback on every failure. */
  private transaction<T>(operation: () => T): T {
    this.ensureOpen()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      /* v8 ignore next -- an independently injected SQLite rollback failure is the only path that reaches this aggregate. */
      try {
        this.db.exec('ROLLBACK')
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `log stream '${this.name}' transaction rollback failed`)
      }
      throw error
    }
  }

  private ensureOpen(): void {
    if (this.closed || this.isBackendClosed()) {
      throw new StorageError('closed', `log stream '${this.name}' is closed`)
    }
  }
}

/** Parse one JSON cell without leaking malformed durable values to consumers. */
function parseStoredValue(stream: string, slot: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new StorageError('malformed-medium', `log stream '${stream}' has invalid JSON in ${slot}`, { cause: error })
  }
}

/** Snapshot a caller value before a durable transaction begins. */
function serializeValue(stream: string, slot: string, value: unknown): string {
  try {
    const text: unknown = JSON.stringify(value)
    if (typeof text !== 'string') {
      throw new StorageError('invalid-value', `log stream '${stream}' ${slot} is not JSON-serializable`)
    }
    return text
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('invalid-value', `log stream '${stream}' ${slot} is not JSON-serializable`, { cause: error })
  }
}

/** Reject invalid sequence fields before SQL work begins. */
function assertSequence(name: string, sequence: number): void {
  if (!isSequence(sequence)) {
    throw new Error(`${name} must be a safe integer at least ${EMPTY_LOG_SEQUENCE}`)
  }
}

/** Reject empty or unbounded read pages. */
function assertPositiveLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be a positive safe integer')
}

/** Sequence values include the empty-stream sentinel. */
function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= EMPTY_LOG_SEQUENCE
}

/** Stream format versions cannot use the empty-stream sentinel. */
function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Promise-returning API methods never synchronously throw non-Error values. */
/* v8 ignore next -- the public SQLite and JSON boundaries normalize all thrown values before this fallback. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
