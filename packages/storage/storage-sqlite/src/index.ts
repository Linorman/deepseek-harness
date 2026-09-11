/**
 * SQLite storage backend for the storage hub: one database file hosts every
 * routed unit, document-per-row (`key TEXT` / `value TEXT` JSON). Registers
 * as backend `sqlite`; the disposer unregisters first, then closes the medium.
 * @module @clocky/clocky-storage-sqlite
 */

import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type { DatabaseSync } from 'node:sqlite'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@clocky/clocky-storage'
import type {
  KvFacet, KvUnit, KvUnitDescriptor, LogFacet, LogStream, LogStreamDescriptor,
  LogStreamInfo, StorageBackend,
} from '@clocky/clocky-storage'
import { openSqliteLog, validateExistingStream } from './log.ts'
import { openDatabase, recordTableName, type JournalMode } from './schema.ts'
import { SqliteKvUnit } from './unit.ts'

export { STORAGE_SQLITE_SCHEMA_VERSION, type JournalMode } from './schema.ts'

/** Cordis plugin name. */
export const name = 'storage-sqlite'
/** The backend registers on the storage hub. */
export const inject = ['storage']

/** Plugin configuration. */
export interface Config {
  /**
   * Filesystem path to the SQLite database file. The special value `:memory:`
   * opens an in-process database (tests). On filesystems with POSIX modes,
   * missing directories and databases are created owner-only; existing path
   * modes are preserved. Filesystem setup errors other than an existing
   * database fail the open. The backend does not protect confidentiality or
   * integrity when another principal can replace the database entry in its
   * parent directory.
   */
  path: string
  /**
   * SQLite `journal_mode` pragma. `wal` (the default) suits local disks; pick
   * a rollback-journal mode (`delete`/`truncate`/`persist`) on filesystems
   * where WAL's shared-memory files do not work (network mounts). See
   * {@link JournalMode}.
   */
  journalMode?: JournalMode
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
})

/**
 * The SQLite {@link StorageBackend}. Owns one `DatabaseSync` connection and
 * independent open-handle tables for KV units and log streams; each facet
 * validates its own durable version record before exposing a handle.
 */
export class SqliteStorageBackend implements StorageBackend {
  /** Key-value units backed by the unit metadata and record tables. */
  readonly kv: KvFacet = { open: descriptor => this.openUnit(descriptor) }
  /** Durable append-only streams backed by `log_*` tables. */
  readonly log: LogFacet = {
    open: descriptor => this.openLog(descriptor),
    list: () => this.listLogs(),
  }

  private readonly ready: Promise<DatabaseSync>
  /** Open (or still-opening) units by name; presence is the double-open guard. */
  private readonly units = new Map<string, Promise<SqliteKvUnit>>()
  /** One caller-owned handle per log stream name. */
  private readonly logs = new Map<string, Promise<LogStream>>()
  private closing: Promise<void> | undefined

  /**
   * @param config - Validated plugin configuration.
   */
  constructor(config: Config) {
    this.ready = openDatabase(config.path, config.journalMode ?? 'wal')
    // Mark the rejection handled: every primitive re-awaits `ready`, so an
    // open failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
  }

  private openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (this.closing !== undefined) {
      return Promise.reject(new StorageError('closed', 'sqlite storage backend is closed'))
    }
    if (!UNIT_NAME_RE.test(descriptor.name)) {
      return Promise.reject(new Error(`kv unit name '${descriptor.name}' violates ${UNIT_NAME_RE}`))
    }
    for (const table of descriptor.tables) {
      if (!UNIT_NAME_RE.test(table)) {
        return Promise.reject(new Error(`kv table name '${table}' in unit '${descriptor.name}' violates ${UNIT_NAME_RE}`))
      }
    }
    if (this.units.has(descriptor.name)) {
      return Promise.reject(new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`))
    }
    // Reserve the name synchronously so a concurrent second open of the same
    // name rejects instead of racing past the guard during the awaits below.
    const pending = this.materializeUnit(descriptor)
    this.units.set(descriptor.name, pending)
    pending.catch(() => this.units.delete(descriptor.name))
    return pending
  }

  private async materializeUnit(descriptor: KvUnitDescriptor): Promise<SqliteKvUnit> {
    const db = await this.ready
    const row = db.prepare('SELECT version FROM units WHERE name = ?').get(descriptor.name) as
      | { version: number }
      | undefined
    if (row === undefined) {
      db.prepare('INSERT INTO units (name, version) VALUES (?, ?)').run(descriptor.name, descriptor.version)
    } else if (row.version !== descriptor.version) {
      throw new StorageError(
        'version-mismatch',
        `kv unit '${descriptor.name}' is stamped version ${row.version} on the medium, incompatible with descriptor version ${descriptor.version}`,
      )
    }
    for (const table of descriptor.tables) {
      // Both segments passed UNIT_NAME_RE, so the identifier is safe in DDL.
      db.exec(`
        CREATE TABLE IF NOT EXISTS "${recordTableName(descriptor.name, table)}" (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT
      `)
    }
    return new SqliteKvUnit(db, descriptor, () => {
      this.units.delete(descriptor.name)
    })
  }

  /** Reserve and open one log stream. */
  private openLog(descriptor: LogStreamDescriptor): Promise<LogStream> {
    if (this.closing !== undefined) {
      return Promise.reject(new StorageError('closed', 'sqlite storage backend is closed'))
    }
    if (descriptor.name.length === 0) {
      return Promise.reject(new Error('log stream name must be non-empty'))
    }
    if (!Number.isSafeInteger(descriptor.version) || descriptor.version < 0) {
      return Promise.reject(new Error(`log stream '${descriptor.name}' version must be a non-negative safe integer`))
    }
    if (this.logs.has(descriptor.name)) {
      return Promise.reject(new Error(`log stream '${descriptor.name}' is already open (double-open is a caller bug)`))
    }
    const pending = this.materializeLog(descriptor)
    this.logs.set(descriptor.name, pending)
    pending.catch(() => this.logs.delete(descriptor.name))
    return pending
  }

  /** Ensure the database has opened, then expose a validated stream handle. */
  private async materializeLog(descriptor: LogStreamDescriptor): Promise<LogStream> {
    const db = await this.ready
    if (this.closing !== undefined) throw new StorageError('closed', 'sqlite storage backend is closed')
    return openSqliteLog(
      db,
      descriptor,
      () => { this.logs.delete(descriptor.name) },
      () => this.closing !== undefined,
    )
  }

  /** List and validate every materialized stream in stable name order. */
  private async listLogs(): Promise<readonly LogStreamInfo[]> {
    this.ensureOpenForLogs()
    const db = await this.ready
    this.ensureOpenForLogs()
    const rows = db.prepare('SELECT name, version, tail_sequence FROM log_streams ORDER BY name ASC').all() as
      Array<{ name: string; version: number; tail_sequence: number }>
    return rows.map((row) => {
      if (row.name.length === 0 || !Number.isSafeInteger(row.version) || row.version < 0) {
        throw new StorageError('malformed-medium', 'log stream metadata has an invalid name or version')
      }
      const descriptor = { name: row.name, version: row.version }
      validateExistingStream(db, descriptor)
      const checkpoint = db.prepare('SELECT sequence FROM log_checkpoints WHERE stream = ?').get(row.name) as
        | { sequence: number }
        | undefined
      return {
        name: row.name,
        version: row.version,
        tailSequence: row.tail_sequence,
        ...(checkpoint === undefined ? {} : { checkpointSequence: checkpoint.sequence }),
      }
    })
  }

  /** Reject log work once backend disposal begins. */
  private ensureOpenForLogs(): void {
    if (this.closing !== undefined) throw new StorageError('closed', 'sqlite storage backend is closed')
  }

  /**
   * Close every open unit and release the database. Idempotent; concurrent
   * and repeated calls resolve once teardown finishes.
   * @returns resolution after the medium is released.
   */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    let db: DatabaseSync
    try {
      db = await this.ready
    } catch {
      // The medium never opened; that failure already rejected the opener and
      // every unit call, so there is nothing left to release here.
      return
    }
    for (const pending of [...this.units.values()]) {
      const unit = await pending.catch(() => undefined)
      await unit?.close()
    }
    for (const pending of [...this.logs.values()]) {
      const stream = await pending.catch(() => undefined)
      await stream?.close()
    }
    db.close()
  }
}

/**
 * Register the SQLite backend as `sqlite` on the storage hub. The disposer
 * unregisters the name first, then closes the backend.
 * @param ctx - Plugin context (must inject `storage`).
 * @param config - Validated plugin configuration.
 */
export function apply(ctx: Context, config: Config) {
  const backend = new SqliteStorageBackend(config)
  ctx.effect(() => {
    const dispose = ctx.storage.backend.register('sqlite', backend)
    return async () => {
      dispose()
      await backend.close()
    }
  }, 'storage-sqlite.registerBackend')
  ctx.provide(storageBackendServiceKey('sqlite'), backend)
}
