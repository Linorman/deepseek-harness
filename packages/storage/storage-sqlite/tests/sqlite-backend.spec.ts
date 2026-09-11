import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import Storage, { storageBackendServiceKey } from '@clocky/clocky-storage'
import type { KvUnitDescriptor } from '@clocky/clocky-storage'
import { runKvBackendContract } from '../../storage/tests/contract.ts'
import { runLogBackendContract } from '../../storage/tests/log-contract.ts'
import * as StorageSqlite from '../src/index.ts'
import { Config, SqliteStorageBackend, STORAGE_SQLITE_SCHEMA_VERSION } from '../src/index.ts'

/** Mirror the loader: resolve schemastery defaults before construction. */
function backendAt(path: string): SqliteStorageBackend {
  return new SqliteStorageBackend(new Config({ path }))
}

const dirs: string[] = []
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }) })

async function freshDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clocky-storage-sqlite-'))
  dirs.push(dir)
  return join(dir, 'storage.db')
}

// The contract suite's reopen() needs a surviving medium, so the harness binds
// a real file; :memory: gets its own cases below.
runKvBackendContract('sqlite', async () => {
  const path = await freshDbPath()
  return {
    backend: backendAt(path),
    reopen: async () => backendAt(path),
  }
})

runLogBackendContract('sqlite', async () => {
  const path = await freshDbPath()
  return {
    backend: backendAt(path),
    reopen: async () => backendAt(path),
    tearTail: async () => {
      const db = new DatabaseSync(path)
      try {
        db.prepare('UPDATE log_entries SET value = ? WHERE stream = ? AND sequence = ?')
          .run('{"torn":', 'contract_stream', 0)
      } finally {
        db.close()
      }
    },
  }
})

const DESCRIPTOR: KvUnitDescriptor = {
  name: 'specimen',
  version: 1,
  tables: ['records'],
  hasGlobal: true,
}

describe('sqlite backend specifics', () => {
  it('defaults direct construction to WAL when journalMode is omitted', async () => {
    const backend = new SqliteStorageBackend({ path: await freshDbPath() })
    const stream = await backend.log.open({ name: 'team/default-journal-mode', version: 1 })
    await stream.append(-1, [{ accepted: true }])
    await stream.close()
    await backend.close()
  })

  it('uses the durable tail as a compare-and-set boundary across backend instances', async () => {
    const path = await freshDbPath()
    const first = backendAt(path)
    const second = backendAt(path)
    const left = await first.log.open({ name: 'team/shared', version: 1 })
    const right = await second.log.open({ name: 'team/shared', version: 1 })
    const results = await Promise.allSettled([
      left.append(-1, [{ owner: 'first' }]),
      right.append(-1, [{ owner: 'second' }]),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(await left.read(-1, 10)).toHaveLength(1)
    await left.close()
    await right.close()
    await first.close()
    await second.close()
  })

  it('rejects invalid log descriptors and log work after backend close', async () => {
    const backend = backendAt(':memory:')
    await expect(backend.log.open({ name: '', version: 1 })).rejects.toThrow(/non-empty/)
    await expect(backend.log.open({ name: 'team/negative-version', version: -1 })).rejects.toThrow(/non-negative safe integer/)
    await expect(backend.log.open({ name: 'team/non-integer-version', version: 1.5 })).rejects.toThrow(/non-negative safe integer/)

    await backend.close()
    await expect(backend.log.open({ name: 'team/after-close', version: 1 })).rejects.toMatchObject({ code: 'closed' })
    await expect(backend.log.list()).rejects.toMatchObject({ code: 'closed' })
  })

  it('drains a pending log open when backend shutdown wins the race', async () => {
    const backend = backendAt(':memory:')
    const opening = backend.log.open({ name: 'team/opening', version: 1 })
    const closing = backend.close()

    await expect(opening).rejects.toMatchObject({ code: 'closed' })
    await closing
  })

  it('lists checkpoint watermarks and rejects malformed durable metadata', async () => {
    const path = await freshDbPath()
    const backend = backendAt(path)
    const stream = await backend.log.open({ name: 'team/listed', version: 1 })
    await stream.append(-1, [{ accepted: true }])
    await stream.writeCheckpoint({ sequence: 0, value: { folded: true } })
    await stream.close()
    await expect(backend.log.list()).resolves.toEqual([
      { name: 'team/listed', version: 1, tailSequence: 0, checkpointSequence: 0 },
    ])
    await backend.close()

    const db = new DatabaseSync(path)
    try {
      db.prepare('UPDATE log_streams SET version = ? WHERE name = ?').run(-1, 'team/listed')
    } finally {
      db.close()
    }
    const damaged = backendAt(path)
    await expect(damaged.log.list()).rejects.toMatchObject({ code: 'malformed-medium' })
    await damaged.close()
  })

  it('rejects new stream operations immediately when backend shutdown starts', async () => {
    const backend = backendAt(':memory:')
    const stream = await backend.log.open({ name: 'team/closing', version: 1 })
    const closing = backend.close()
    await expect(stream.append(-1, [{ late: true }])).rejects.toMatchObject({ code: 'closed' })
    await expect(stream.read(-1, 1)).rejects.toMatchObject({ code: 'closed' })
    await closing
  })

  it('rejects invalid log values and malformed durable checkpoint data', async () => {
    const path = await freshDbPath()
    const backend = backendAt(path)
    const stream = await backend.log.open({ name: 'team/values', version: 1 })
    await expect(stream.append(-1, [undefined])).rejects.toMatchObject({ code: 'invalid-value' })
    await expect(stream.append(-1, [{ toJSON: () => { throw new Error('cannot serialize') } }])).rejects.toMatchObject({
      code: 'invalid-value',
    })
    await expect(stream.writeCheckpoint({ sequence: -1, value: undefined })).rejects.toMatchObject({ code: 'invalid-value' })
    await stream.append(-1, [{ accepted: true }])
    await stream.writeCheckpoint({ sequence: 0, value: { folded: true } })

    const db = new DatabaseSync(path)
    try {
      db.prepare('UPDATE log_checkpoints SET value = ? WHERE stream = ?').run('{bad json', 'team/values')
    } finally {
      db.close()
    }
    await expect(stream.readCheckpoint()).rejects.toMatchObject({ code: 'malformed-medium' })
    await stream.close()
    await backend.close()
  })

  it('reopens an empty stream materialized by its initial checkpoint', async () => {
    const path = await freshDbPath()
    const first = backendAt(path)
    const stream = await first.log.open({ name: 'team/empty', version: 1 })
    await stream.writeCheckpoint({ sequence: -1, value: { folded: false } })
    await stream.close()
    await stream.close()
    await first.close()

    const second = backendAt(path)
    const resumed = await second.log.open({ name: 'team/empty', version: 1 })
    await expect(resumed.read(-1, 10)).resolves.toEqual([])
    await expect(resumed.readCheckpoint()).resolves.toEqual({ sequence: -1, value: { folded: false } })
    await resumed.close()
    await second.close()
  })

  it('rejects malformed stream metadata and torn durable rows on reopen', async () => {
    const path = await freshDbPath()
    const first = backendAt(path)
    const stream = await first.log.open({ name: 'team/damaged', version: 1 })
    await stream.append(-1, [{ accepted: true }])
    await stream.close()
    await first.close()

    const db = new DatabaseSync(path)
    try {
      db.prepare('UPDATE log_streams SET tail_sequence = ? WHERE name = ?').run(9, 'team/damaged')
    } finally {
      db.close()
    }
    const reopened = backendAt(path)
    await expect(reopened.log.open({ name: 'team/damaged', version: 1 })).rejects.toMatchObject({ code: 'malformed-medium' })
    await reopened.close()
  })

  it('rejects malformed stream versions, entry sequences, and checkpoints on reopen', async () => {
    const cases: Array<{ name: string; mutate(db: DatabaseSync): void; code: string }> = [
      {
        name: 'foreign version',
        mutate: (db) => { db.prepare('UPDATE log_streams SET version = ? WHERE name = ?').run(2, 'team/checked') },
        code: 'version-mismatch',
      },
      {
        name: 'invalid metadata version',
        mutate: (db) => { db.prepare('UPDATE log_streams SET version = ? WHERE name = ?').run(-1, 'team/checked') },
        code: 'malformed-medium',
      },
      {
        name: 'noncontiguous entry',
        mutate: (db) => {
          db.prepare('UPDATE log_entries SET sequence = ? WHERE stream = ? AND sequence = ?').run(1, 'team/checked', 0)
          db.prepare('UPDATE log_streams SET tail_sequence = ? WHERE name = ?').run(1, 'team/checked')
        },
        code: 'malformed-medium',
      },
      {
        name: 'checkpoint beyond tail',
        mutate: (db) => {
          db.prepare('UPDATE log_checkpoints SET sequence = ? WHERE stream = ?').run(2, 'team/checked')
        },
        code: 'malformed-medium',
      },
    ]
    for (const candidate of cases) {
      const path = await freshDbPath()
      const first = backendAt(path)
      const stream = await first.log.open({ name: 'team/checked', version: 1 })
      await stream.append(-1, [{ accepted: true }])
      await stream.writeCheckpoint({ sequence: 0, value: { folded: true } })
      await stream.close()
      await first.close()
      const db = new DatabaseSync(path)
      try {
        candidate.mutate(db)
      } finally {
        db.close()
      }
      const reopened = backendAt(path)
      await expect(reopened.log.open({ name: 'team/checked', version: 1 }), candidate.name)
        .rejects.toMatchObject({ code: candidate.code })
      await reopened.close()
    }
  })

  it('rechecks live stream metadata inside an append transaction', async () => {
    const path = await freshDbPath()
    const backend = backendAt(path)
    const stream = await backend.log.open({ name: 'team/live', version: 1 })
    await stream.append(-1, [{ accepted: true }])
    const db = new DatabaseSync(path)
    try {
      db.prepare('UPDATE log_streams SET version = ? WHERE name = ?').run(2, 'team/live')
    } finally {
      db.close()
    }
    await expect(stream.append(0, [{ next: true }])).rejects.toMatchObject({ code: 'version-mismatch' })
    await stream.close()
    await backend.close()

    const second = backendAt(path)
    const resumed = await second.log.open({ name: 'team/live', version: 2 })
    const repair = new DatabaseSync(path)
    try {
      repair.prepare('UPDATE log_streams SET tail_sequence = ? WHERE name = ?').run(-2, 'team/live')
    } finally {
      repair.close()
    }
    await expect(resumed.append(0, [{ next: true }])).rejects.toMatchObject({ code: 'malformed-medium' })
    await resumed.close()
    await second.close()
  })

  it('opens an in-memory database', async () => {
    const backend = backendAt(':memory:')
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'k', { n: 1 })
    expect((await unit.loadAll()).tables['records']).toEqual({ k: { n: 1 } })
    await backend.close()
  })

  it('materializes STRICT record tables and stamps the schema version', async () => {
    const path = await freshDbPath()
    const backend = backendAt(path)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'k', { n: 1 })
    await backend.close()

    const db = new DatabaseSync(path)
    try {
      const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version).toBe(STORAGE_SQLITE_SCHEMA_VERSION)
      const table = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'u_specimen_records'",
      ).get() as { sql: string } | undefined
      expect(table?.sql).toContain('STRICT')
      const unitRow = db.prepare('SELECT version FROM units WHERE name = ?').get('specimen') as { version: number }
      expect(unitRow.version).toBe(DESCRIPTOR.version)
    } finally {
      db.close()
    }
  })

  it('rejects a mismatched database schema version', async () => {
    const path = await freshDbPath()
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version = 999')
    db.close()

    const backend = backendAt(path)
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toMatchObject({
      name: 'StorageError',
      code: 'version-mismatch',
    })
    await backend.close()
  })

  it('rejects invalid unit and table names before touching the medium', async () => {
    const backend = backendAt(':memory:')
    await expect(backend.kv.open({ ...DESCRIPTOR, name: 'Bad-Name' })).rejects.toThrow(/violates/)
    await expect(backend.kv.open({ ...DESCRIPTOR, tables: ['ok', '1bad'] })).rejects.toThrow(/violates/)
    await backend.close()
  })

  it('rejects a second open of the same unit name', async () => {
    const backend = backendAt(':memory:')
    await backend.kv.open(DESCRIPTOR)
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toThrow(/already open/)
    await backend.close()
  })

  it('allows re-open after unit close, and rejects open on a closed backend', async () => {
    const backend = backendAt(':memory:')
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.close()
    const again = await backend.kv.open(DESCRIPTOR)
    await again.putRecord('records', 'k', 1)
    await backend.close()
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toMatchObject({ code: 'closed' })
  })

  it('round-trips prototype-polluting keys as own properties', async () => {
    const backend = backendAt(':memory:')
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', '__proto__', { evil: true })
    await unit.putRecord('records', 'constructor', { n: 1 })
    const { tables } = await unit.loadAll()
    const records = tables['records']!
    expect(Object.hasOwn(records, '__proto__')).toBe(true)
    expect(records['__proto__']).toEqual({ evil: true })
    expect(records['constructor']).toEqual({ n: 1 })
    expect(Object.getPrototypeOf({})).not.toHaveProperty('evil')
    await backend.close()
  })

  it('leaves a failed materialization unstamped so a repaired medium reopens', async () => {
    const path = await freshDbPath()
    // Obstruct table creation: an index squatting on the unit_globals name
    // makes CREATE TABLE IF NOT EXISTS throw AFTER the units table exists.
    const setup = new DatabaseSync(path)
    setup.exec('CREATE TABLE squatter (x TEXT)')
    setup.exec('CREATE INDEX unit_globals ON squatter(x)')
    setup.close()

    const broken = backendAt(path)
    await expect(broken.kv.open(DESCRIPTOR)).rejects.toThrow(/already an index/)
    await broken.close()

    // Clear the obstruction; the medium must still be version 0, not a
    // half-materialized database stamped as current.
    const repair = new DatabaseSync(path)
    expect((repair.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(0)
    repair.exec('DROP INDEX unit_globals')
    repair.close()

    const backend = backendAt(path)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'k', { n: 1 })
    await backend.close()
  })

  it('rejects unparsable stored JSON with malformed-medium', async () => {
    const path = await freshDbPath()
    const backend = backendAt(path)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'good', { n: 1 })
    await unit.setGlobal({ g: 1 })
    await backend.close()

    const db = new DatabaseSync(path)
    db.prepare('UPDATE u_specimen_records SET value = ? WHERE key = ?').run('{not json', 'good')
    db.close()

    const reopened = backendAt(path)
    const damaged = await reopened.kv.open(DESCRIPTOR)
    await expect(damaged.loadAll()).rejects.toMatchObject({
      name: 'StorageError',
      code: 'malformed-medium',
    })
    await reopened.close()
  })

  it('wraps a non-Error toJSON throw into an Error rejection', async () => {
    const backend = backendAt(':memory:')
    const unit = await backend.kv.open(DESCRIPTOR)
    // JSON.stringify propagates a value's own toJSON throw verbatim; the unit
    // must still reject with an Error instance.
    const hostile = { toJSON: () => { throw 'not an error' } }
    await expect(unit.putRecord('records', 'k', hostile)).rejects.toThrow('not an error')
    await expect(unit.putRecord('records', 'k', hostile)).rejects.toBeInstanceOf(Error)
    await backend.close()
  })

  it('rejects setGlobal on a unit without a global slot and writes to undeclared tables', async () => {
    const backend = backendAt(':memory:')
    const unit = await backend.kv.open({ ...DESCRIPTOR, hasGlobal: false })
    await expect(unit.setGlobal({ g: 1 })).rejects.toThrow(/declared no global slot/)
    await expect(unit.putRecord('undeclared', 'k', 1)).rejects.toThrow(/declared no table/)
    expect((await unit.loadAll()).global).toBeNull()
    await backend.close()
  })

  it('drains a still-pending failed open during close', async () => {
    const path = await freshDbPath()
    const first = backendAt(path)
    await (await first.kv.open(DESCRIPTOR)).close()
    await first.close()

    const backend = backendAt(path)
    // Do not await: close() must tolerate an in-flight open that will reject
    // (version mismatch) while its name is still reserved in the unit table.
    const pending = backend.kv.open({ ...DESCRIPTOR, version: 99 })
    const closed = backend.close()
    await expect(pending).rejects.toMatchObject({ code: 'version-mismatch' })
    await closed
  })

  it('propagates filesystem errors other than an existing database file', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'clocky-storage-sqlite-'))
    dirs.push(dir)
    await chmod(dir, 0o500)
    const backend = backendAt(join(dir, 'storage.db'))
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toMatchObject({ code: 'EACCES' })
    await backend.close()
    await chmod(dir, 0o700)
  })

  it('propagates an invalid database filename before opening SQLite', async () => {
    const path = await freshDbPath()
    const backend = backendAt(`${path}\0invalid`)
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toThrow(/null bytes/i)
    await backend.close()
  })

  it('preserves the mode of an existing database file', async () => {
    if (process.platform === 'win32') return
    const path = await freshDbPath()
    await writeFile(path, '', { mode: 0o644 })
    await chmod(path, 0o644)
    const backend = backendAt(path)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'k', 1)
    await backend.close()
  })

  it('registers on the storage hub as backend sqlite and closes on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const fiber = await ctx.plugin(StorageSqlite, { path: ':memory:' })
    const backend = ctx.storage.backend.get('sqlite')
    expect(ctx.get(storageBackendServiceKey('sqlite'))).toBe(backend)
    const unit = await backend.kv!.open(DESCRIPTOR)
    await unit.putRecord('records', 'k', { n: 1 })

    await fiber.dispose()
    expect(ctx.storage.backend.names()).toEqual([])
    expect(ctx.get(storageBackendServiceKey('sqlite'))).toBeUndefined()
    await expect(backend.kv!.open(DESCRIPTOR)).rejects.toMatchObject({ code: 'closed' })
  })

  it('rejects an unparsable global slot with malformed-medium', async () => {
    const path = await freshDbPath()
    const backend = backendAt(path)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.setGlobal({ g: 1 })
    await backend.close()

    const db = new DatabaseSync(path)
    db.prepare('UPDATE unit_globals SET value = ? WHERE unit = ?').run('][', 'specimen')
    db.close()

    const reopened = backendAt(path)
    const damaged = await reopened.kv.open(DESCRIPTOR)
    await expect(damaged.loadAll()).rejects.toMatchObject({
      name: 'StorageError',
      code: 'malformed-medium',
    })
    await reopened.close()
  })
})
