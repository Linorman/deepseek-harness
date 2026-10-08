/** Indexed name discovery must be independent of journal-body size and validation. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { SqliteStorageBackend } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

it('seeks names across insertion and deletion without decoding log entries', async () => {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/sqlite-name-scan-'))
  const path = join(root, 'storage.db')
  const backend = new SqliteStorageBackend({ path })
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
  async function create(name: string) {
    const stream = await backend.log.open({ name, version: 1 })
    await stream.append(-1, [{}]); await stream.close()
  }
  await create('team/a'); await create('team/z'); await create('channel/other')
  const db = new DatabaseSync(path)
  cleanups.push(async () => { db.close() })
  db.prepare('UPDATE log_entries SET value = ? WHERE stream = ?').run('not-json', 'team/a')
  const iterator = backend.log.scanNames!('team/', 1024)[Symbol.asyncIterator]()
  expect(await iterator.next()).toEqual({ value: 'team/a', done: false })
  await create('team/b')
  db.prepare('DELETE FROM log_entries WHERE stream = ?').run('team/z')
  db.prepare('DELETE FROM log_streams WHERE name = ?').run('team/z')
  expect(await iterator.next()).toEqual({ value: 'team/b', done: false })
  expect((await iterator.next()).done).toBe(true)
  await expect(backend.log.open({ name: 'team/a', version: 1 })).rejects.toMatchObject({ code: 'malformed-medium' })
})

it('rejects malformed or oversized summary cells without exposing journal bodies', async () => {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/sqlite-summary-'))
  const path = join(root, 'storage.db')
  const backend = new SqliteStorageBackend({ path })
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
  const descriptor = { name: 'team/summary', version: 1 }
  const stream = await backend.log.open(descriptor)
  await stream.append(-1, [{}], { summary: { label: '界😀' } })
  await stream.close()
  const db = new DatabaseSync(path)
  cleanups.push(async () => { db.close() })
  db.prepare('UPDATE log_entries SET value = ? WHERE stream = ?').run('invalid journal JSON', descriptor.name)
  await expect(backend.log.readSummary!(descriptor, 256)).resolves.toEqual({ sequence: 0, value: { label: '界😀' } })
  await expect(backend.log.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })
  db.prepare('UPDATE log_streams SET summary = ? WHERE name = ?').run('"' + '界'.repeat(1000) + '"', descriptor.name)
  await expect(backend.log.readSummary!(descriptor, 256)).rejects.toMatchObject({ code: 'invalid-value' })
  db.prepare('UPDATE log_streams SET summary = ? WHERE name = ?').run('{}', descriptor.name)
  await expect(backend.log.readSummary!(descriptor, 4)).rejects.toMatchObject({ code: 'invalid-value' })
  db.prepare('UPDATE log_streams SET summary = ? WHERE name = ?').run('bad JSON', descriptor.name)
  await expect(backend.log.readSummary!(descriptor, 256)).rejects.toMatchObject({ code: 'malformed-medium' })
})

it('uses exact Unicode prefix bounds and rejects malformed or oversized indexed names', async () => {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/sqlite-prefix-bounds-'))
  const path = join(root, 'storage.db')
  const backend = new SqliteStorageBackend({ path })
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
  for (const name of ['team/one', 'team/too-long', '\ud7ff/end', '\ue000/next', '\u{10ffff}/last']) {
    const stream = await backend.log.open({ name, version: 1 })
    await stream.append(-1, [{}]); await stream.close()
  }
  async function names(prefix: string, maxNameBytes = 1024) {
    const found: Array<string | undefined> = []
    for await (const name of backend.log.scanNames!(prefix, maxNameBytes)) found.push(name)
    return found
  }
  expect(await names('\ud7ff')).toEqual(['\ud7ff/end'])
  expect(await names('\u{10ffff}')).toEqual(['\u{10ffff}/last'])
  expect(await names('')).toHaveLength(5)
  await expect(names('team/', 8)).rejects.toMatchObject({ code: 'invalid-value' })
  const db = new DatabaseSync(path)
  cleanups.push(async () => { db.close() })
  db.prepare('DELETE FROM log_entries WHERE stream = ?').run('team/one')
  db.prepare('UPDATE log_streams SET name = ? WHERE name = ?').run('', 'team/one')
  await expect(names('')).rejects.toMatchObject({ code: 'malformed-medium' })
})
