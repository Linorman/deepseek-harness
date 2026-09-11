import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage, { storageBackendServiceKey } from '@clocky/clocky-storage'
import InvariantRegistry from '@clocky/clocky-invariants'
import { runKvBackendContract } from '../../storage/tests/contract.ts'
import { runLogBackendContract } from '../../storage/tests/log-contract.ts'
import { Config, JsonStorageBackend, apply } from '../src/index.ts'
import * as InvariantCompanion from '../src/invariant.ts'
import { logFileName } from '../src/log.ts'
import { acquireJsonLogOwner } from '../src/log-owner.ts'

const roots: string[] = []

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'clocky-storage-json-'))
  roots.push(root)
  return root
}

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

runKvBackendContract('json', async () => {
  const root = await freshRoot()
  return {
    backend: new JsonStorageBackend(root),
    reopen: async () => new JsonStorageBackend(root),
  }
})

runLogBackendContract('json', async () => {
  const root = await freshRoot()
  return {
    backend: new JsonStorageBackend(root),
    reopen: async () => new JsonStorageBackend(root),
    tearTail: async () => {
      await writeFile(join(root, 'logs', logFileName('contract_stream')), '{"stream":', 'utf8')
    },
  }
})

describe('json backend specifics', () => {
  const descriptor = { name: 'shape', version: 1, tables: ['t'], hasGlobal: true }

  it('publishes a human-readable pretty-printed file', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    const unit = await backend.kv.open(descriptor)
    await unit.putRecord('t', 'k', { hello: 'world' })
    const text = await readFile(join(root, 'shape.json'), 'utf8')
    expect(text).toBe(`${JSON.stringify(
      { unit: { name: 'shape', version: 1 }, global: null, tables: { t: { k: { hello: 'world' } } } },
      null,
      2,
    )}\n`)
    await backend.close()
  })

  it('defers materialization until the first write', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    await backend.kv.open(descriptor)
    await expect(readFile(join(root, 'shape.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await backend.close()
  })

  it('rejects a malformed medium', async () => {
    const root = await freshRoot()
    await writeFile(join(root, 'shape.json'), 'not json at all', 'utf8')
    const backend = new JsonStorageBackend(root)
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })
    await backend.close()
  })

  it('rejects a foreign unit header', async () => {
    const root = await freshRoot()
    await writeFile(
      join(root, 'shape.json'),
      JSON.stringify({ unit: { name: 'other', version: 1 }, global: null, tables: {} }),
      'utf8',
    )
    const backend = new JsonStorageBackend(root)
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })
    await backend.close()
  })

  it('rejects double-open of one unit as a plain caller error', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    await backend.kv.open(descriptor)
    await expect(backend.kv.open(descriptor)).rejects.toThrow(/already open/)
    await backend.close()
  })

  it('refuses a second JSON log Hub for the same root until the first closes', async () => {
    const root = await freshRoot()
    const first = new JsonStorageBackend(root)
    const stream = await first.log.open({ name: 'single_hub', version: 1 })
    const second = new JsonStorageBackend(root)
    await expect(second.log.open({ name: 'single_hub', version: 1 })).rejects.toMatchObject({
      code: 'writer-locked',
    })
    await stream.close()
    await first.close()
    const resumed = await second.log.open({ name: 'single_hub', version: 1 })
    await resumed.close()
    await second.close()
  })

  it('reclaims a proven-dead local log owner and rejects malformed owner records', async () => {
    const root = await freshRoot()
    const logs = join(root, 'logs')
    await mkdir(logs)
    const lock = join(logs, '.clocky-log-owner.lock')
    await writeFile(lock, JSON.stringify({ host: hostname(), pid: 999_999_999, nonce: 'stale-owner' }) + '\n', 'utf8')
    const owner = await acquireJsonLogOwner(logs)
    await owner.close()
    await owner.close()

    await writeFile(lock, '{not JSON', 'utf8')
    await expect(acquireJsonLogOwner(logs)).rejects.toMatchObject({ code: 'malformed-medium' })

    await writeFile(lock, '{}', 'utf8')
    await expect(acquireJsonLogOwner(logs)).rejects.toMatchObject({ code: 'malformed-medium' })

    await writeFile(lock, '[]', 'utf8')
    await expect(acquireJsonLogOwner(logs)).rejects.toMatchObject({ code: 'malformed-medium' })

    await writeFile(lock, JSON.stringify({ host: 'another-host', pid: 1, nonce: 'remote-owner' }) + '\n', 'utf8')
    await expect(acquireJsonLogOwner(logs)).rejects.toMatchObject({ code: 'writer-locked' })

    const nonDirectory = join(root, 'not-a-directory')
    await writeFile(nonDirectory, '', 'utf8')
    await expect(acquireJsonLogOwner(nonDirectory)).rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it('encodes Team-style stream names without exposing them as filesystem paths', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    const stream = await backend.log.open({ name: 'team/abc-123', version: 1 })
    expect(stream.version).toBe(1)
    await stream.append(-1, [{ accepted: true }])
    await stream.close()
    const names = (await readdir(join(root, 'logs'))).filter(name => !name.startsWith('.'))
    expect(names).toEqual(['dGVhbS9hYmMtMTIz.json'])
    expect(await backend.log.list()).toEqual([{ name: 'team/abc-123', version: 1, tailSequence: 0 }])
    await backend.close()
  })

  it('rejects invalid log descriptors and log work after backend close', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    await expect(backend.log.open({ name: '', version: 1 })).rejects.toMatchObject({ code: 'malformed-medium' })
    await expect(backend.log.open({ name: 'team/negative-version', version: -1 })).rejects.toMatchObject({
      code: 'malformed-medium',
    })
    await expect(backend.log.open({ name: 'team/non-integer-version', version: 1.5 })).rejects.toMatchObject({
      code: 'malformed-medium',
    })

    await backend.close()
    await expect(backend.log.open({ name: 'team/after-close', version: 1 })).rejects.toMatchObject({ code: 'closed' })
    await expect(backend.log.list()).rejects.toMatchObject({ code: 'closed' })
  })

  it('does not expose a log stream whose open races backend close', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    const opening = backend.log.open({ name: 'team/opening', version: 1 })
    const closing = backend.close()

    await expect(opening).rejects.toMatchObject({ code: 'closed' })
    await closing
  })

  it('rejects a stream file whose encoded path and header disagree', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    const stream = await backend.log.open({ name: 'team/header', version: 1 })
    await stream.append(-1, [{ accepted: true }])
    await stream.close()
    await rename(
      join(root, 'logs', logFileName('team/header')),
      join(root, 'logs', 'mismatched-stream.json'),
    )

    await expect(backend.log.list()).rejects.toMatchObject({ code: 'malformed-medium' })
    await backend.close()
  })

  it('recovers a failed log-owner acquisition before a later stream open', async () => {
    const root = await freshRoot()
    const logs = join(root, 'logs')
    const lock = join(logs, '.clocky-log-owner.lock')
    await mkdir(logs)
    await writeFile(lock, '{not JSON', 'utf8')

    const backend = new JsonStorageBackend(root)
    await expect(backend.log.open({ name: 'team/retry-owner', version: 1 })).rejects.toMatchObject({
      code: 'malformed-medium',
    })
    await rm(lock)

    const stream = await backend.log.open({ name: 'team/retry-owner', version: 1 })
    await stream.close()
    await backend.close()
  })

  it('drains a failed log-owner acquisition while backend close is in progress', async () => {
    const root = await freshRoot()
    const logs = join(root, 'logs')
    await mkdir(logs)
    await writeFile(join(logs, '.clocky-log-owner.lock'), '{not JSON', 'utf8')

    const backend = new JsonStorageBackend(root)
    const listing = backend.log.list()
    const closing = backend.close()
    await expect(listing).rejects.toMatchObject({ code: 'malformed-medium' })
    await closing
  })

  it('rejects new stream operations immediately when backend shutdown starts', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    const stream = await backend.log.open({ name: 'team/closing', version: 1 })
    const closing = backend.close()
    await expect(stream.append(-1, [{ late: true }])).rejects.toMatchObject({ code: 'closed' })
    await expect(stream.read(-1, 1)).rejects.toMatchObject({ code: 'closed' })
    await closing
  })

  it('rejects non-JSON append values and stream paths that are not files', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    const stream = await backend.log.open({ name: 'team/values', version: 1 })
    await expect(stream.append(-1, [undefined])).rejects.toMatchObject({ code: 'invalid-value' })
    await expect(stream.append(-1, [{ toJSON: () => { throw new Error('cannot serialize') } }])).rejects.toMatchObject({
      code: 'invalid-value',
    })
    const internals = stream as unknown as { state: { checkpoint: { sequence: number; value: unknown } } }
    internals.state.checkpoint = { sequence: -1, value: { toJSON: () => { throw new Error('corrupt state') } } }
    await expect(stream.readCheckpoint()).rejects.toMatchObject({ code: 'invalid-value' })
    await stream.close()
    await backend.close()

    await mkdir(join(root, 'logs', logFileName('team/not-a-file')))
    const damaged = new JsonStorageBackend(root)
    await expect(damaged.log.open({ name: 'team/not-a-file', version: 1 })).rejects.toMatchObject({ code: 'EISDIR' })
    await damaged.close()
  })

  it('rolls back memory when a publish fails', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    const unit = await backend.kv.open(descriptor)
    await unit.putRecord('t', 'k', { v: 'committed' })
    await unit.setGlobal({ g: 'committed' })
    const path = join(root, 'shape.json')
    const backup = join(root, 'shape.committed.json')
    // A directory at the publish target rejects atomic replacement on every host.
    await rename(path, backup)
    await mkdir(path)
    await expect(unit.putRecord('t', 'k', { v: 'rejected' })).rejects.toThrow()
    await expect(unit.putRecord('t', 'k2', { v: 'also rejected' })).rejects.toThrow()
    await expect(unit.deleteRecord('t', 'k')).rejects.toThrow()
    await expect(unit.setGlobal({ g: 'rejected' })).rejects.toThrow()
    await rm(path, { recursive: true })
    await rename(backup, path)
    const snapshot = await unit.loadAll()
    expect(snapshot.tables['t']).toEqual({ k: { v: 'committed' } })
    expect(snapshot.global).toEqual({ g: 'committed' })
    // The next successful publish must not carry rejected writes to disk.
    await unit.putRecord('t', 'k3', { v: 'later' })
    const text = await readFile(path, 'utf8')
    expect(text).not.toContain('rejected')
    await backend.close()
  })

  it('rejects undeclared table and global access as caller errors', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    const unit = await backend.kv.open({ name: 'shape', version: 1, tables: ['t'], hasGlobal: false })
    await expect(unit.putRecord('undeclared', 'k', {})).rejects.toThrow(/does not declare table/)
    await expect(unit.setGlobal({})).rejects.toThrow(/does not declare a global slot/)
    await backend.close()
  })

  it('rejects invalid unit and table names', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    await expect(backend.kv.open({ ...descriptor, name: 'Bad-Name' })).rejects.toMatchObject({
      name: 'StorageError',
      code: 'malformed-medium',
    })
    await expect(backend.kv.open({ ...descriptor, tables: ['ok', 'not ok'] })).rejects.toMatchObject({
      name: 'StorageError',
      code: 'malformed-medium',
    })
    await backend.close()
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'closed' })
  })

  it('opens a file missing a declared table as that table empty', async () => {
    const root = await freshRoot()
    await writeFile(
      join(root, 'contract_unit.json'),
      JSON.stringify({ unit: { name: 'contract_unit', version: 3 }, global: null, tables: { alpha: { k: 1 } } }),
      'utf8',
    )
    const backend = new JsonStorageBackend(root)
    const unit = await backend.kv.open({ name: 'contract_unit', version: 3, tables: ['alpha', 'beta'], hasGlobal: true })
    const snapshot = await unit.loadAll()
    expect(snapshot.tables['alpha']).toEqual({ k: 1 })
    expect(snapshot.tables['beta']).toEqual({})
    await backend.close()
  })

  it('propagates non-ENOENT read failures', async () => {
    const root = await freshRoot()
    const { mkdir } = await import('node:fs/promises')
    // A directory where the unit file should be: readFile fails with EISDIR.
    await mkdir(join(root, 'shape.json'))
    const backend = new JsonStorageBackend(root)
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'EISDIR' })
    await backend.close()
  })

  it('rejects malformed table shapes and foreign versions distinctly', async () => {
    const root = await freshRoot()
    await writeFile(
      join(root, 'shape.json'),
      JSON.stringify({ unit: { name: 'shape', version: 1 }, global: null, tables: { t: ['not', 'an', 'object'] } }),
      'utf8',
    )
    const backend = new JsonStorageBackend(root)
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })

    await writeFile(
      join(root, 'shape.json'),
      JSON.stringify({ unit: { name: 'shape', version: 9 }, global: null, tables: {} }),
      'utf8',
    )
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'version-mismatch' })

    await writeFile(join(root, 'shape.json'), JSON.stringify({ unit: { name: 'shape', version: 1 }, global: null }), 'utf8')
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })

    await writeFile(join(root, 'shape.json'), JSON.stringify('just a string'), 'utf8')
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })
    await backend.close()
  })

  it('registers on the hub via apply and closes on dispose', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    await ctx.plugin(Storage)
    const fiber = await ctx.plugin({ apply, Config, inject: ['storage'] }, { root })
    const backend = ctx.storage.backend.get('json')
    expect(ctx.get(storageBackendServiceKey('json'))).toBe(backend)
    const unit = await backend.kv!.open(descriptor)
    await unit.putRecord('t', 'k', { v: 1 })
    await fiber.dispose()
    expect(() => ctx.storage.backend.get('json')).toThrow()
    expect(ctx.get(storageBackendServiceKey('json'))).toBeUndefined()
    await expect(unit.putRecord('t', 'x', {})).rejects.toMatchObject({ code: 'closed' })
  })

  it('registers the invariant companion and disposes cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(InvariantCompanion)
    // Disposal releases the reservation: a fresh mount succeeds.
    await fiber.dispose()
    await ctx.plugin(InvariantCompanion)
  })

  it('close drains in-flight writes and blocks in-flight opens', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root)
    const unit = await backend.kv.open(descriptor)
    const bigWrite = unit.putRecord('t', 'big', { blob: 'x'.repeat(4 * 1024 * 1024) })
    await unit.close()
    await expect(bigWrite).resolves.toBeUndefined()
    const onDisk = JSON.parse(await readFile(join(root, 'shape.json'), 'utf8')) as {
      tables: Record<string, Record<string, unknown>>
    }
    expect(onDisk.tables['t']?.['big']).toBeDefined()

    const backend2 = new JsonStorageBackend(root)
    const opening = backend2.kv.open(descriptor)
    const closing = backend2.close()
    await expect(opening.then(u => u.putRecord('t', 'x', {}))).rejects.toMatchObject({ code: 'closed' })
    await closing
  })
})
