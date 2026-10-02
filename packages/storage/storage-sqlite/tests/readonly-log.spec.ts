/** SQLite readers observe one transaction while a writer retains its own backend handle. */
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { SqliteStorageBackend, readSqliteLogSnapshot } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function path() {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'readonly-sqlite-'))
  roots.push(root); return join(root, 'journal.sqlite')
}
const descriptor = { name: 'observed', version: 2 }
const limits = { maxEntries: 8, maxBytes: 8192 }

it('does not create absent databases and reads detached entries and checkpoints beside a live writer', async () => {
  const file = await path()
  expect(await readSqliteLogSnapshot(file, descriptor, limits)).toBeUndefined()
  await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  const backend = new SqliteStorageBackend({ path: file, journalMode: 'wal' })
  try {
    const writer = await backend.log.open(descriptor)
    expect(await readSqliteLogSnapshot(file, descriptor, limits)).toBeUndefined()
    await writer.append(-1, [{ name: 'original' }, '甲😀'])
    expect((await readSqliteLogSnapshot(file, descriptor, limits))?.checkpoint).toBeUndefined()
    await writer.writeCheckpoint({ sequence: 1, value: { retained: true } })
    const observed = await readSqliteLogSnapshot(file, descriptor, limits)
    expect(observed).toMatchObject({ firstSequence: 0, tailSequence: 1, checkpoint: { sequence: 1 },
      entries: [{ sequence: 0 }, { sequence: 1 }] })
    if (observed === undefined) throw new Error('Expected a SQLite observation')
    ;(observed.entries[0]?.value as { name: string }).name = 'reader-local'
    expect((await writer.read(-1, 1))[0]?.value).toEqual({ name: 'original' })
    await writer.append(1, [{ next: true }])
    expect((await readSqliteLogSnapshot(file, descriptor, limits))?.tailSequence).toBe(2)
    await expect(readSqliteLogSnapshot(file, { ...descriptor, version: 3 }, limits)).rejects.toMatchObject({ code: 'version-mismatch' })
    await expect(readSqliteLogSnapshot(file, descriptor, { ...limits, maxEntries: 1 })).rejects.toMatchObject({ code: 'invalid-value' })
    await expect(readSqliteLogSnapshot(file, descriptor, { ...limits, maxBytes: 10 })).rejects.toMatchObject({ code: 'invalid-value' })
  } finally { await backend.close() }
  const before = await readFile(file)
  expect((await readSqliteLogSnapshot(file, descriptor, limits))?.tailSequence).toBe(2)
  expect(await readFile(file)).toEqual(before)
})

it('refuses wrong physical formats and malformed durable JSON', async () => {
  const file = await path()
  const backend = new SqliteStorageBackend({ path: file, journalMode: 'wal' })
  const writer = await backend.log.open(descriptor)
  await writer.writeCheckpoint({ sequence: -1, value: {} })
  expect(await readSqliteLogSnapshot(file, descriptor, limits)).toMatchObject({ entries: [], tailSequence: -1 })
  await writer.append(-1, ['valid'])
  await backend.close()
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA user_version = 99')
    await expect(readSqliteLogSnapshot(file, descriptor, limits)).rejects.toMatchObject({ code: 'version-mismatch' })
    db.exec('PRAGMA user_version = 3')
    db.prepare('UPDATE log_entries SET value = ? WHERE stream = ?').run('corrupt', descriptor.name)
    await expect(readSqliteLogSnapshot(file, descriptor, limits)).rejects.toMatchObject({ code: 'malformed-medium' })
  } finally { db.close() }
  await expect(readSqliteLogSnapshot(join(file, 'not-a-database'), descriptor, limits)).rejects.toMatchObject({ code: 'ENOTDIR' })
})
