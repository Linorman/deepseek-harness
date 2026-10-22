/** A raw logical archive preserves original record text and versions; it makes no physical SQLite/WAL-copy claim. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { SqliteStorageBackend, readSqliteRawLogArchive } from '../src/index.ts'

/** Validate the opaque byte field independently of the unparsed consumer payload. */
function frameBytes(value: unknown): Buffer {
  if (typeof value !== 'object' || value === null || !('valueBase64' in value)
    || typeof value.valueBase64 !== 'string') throw new Error('Original SQLite archive frame bytes missing')
  return Buffer.from(value.valueBase64, 'base64')
}

it('preserves original101 logical frames, checkpoint and numeric spelling without Native parsing or mutation', async () => {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/raw-sqlite-')), path = join(root, 'journal.sqlite')
  const backend = new SqliteStorageBackend({ path, journalMode: 'wal' })
  try {
    const log = await backend.log.open({ name: 'simulation', version: 101 })
    await log.append(-1, [{ kind: 'unknown-native-kind', amount: 100 }])
    await log.writeCheckpoint({ sequence: 0, value: { old: true } })
    const db = new DatabaseSync(path)
    const original = '{ "kind": "unknown-native-kind", "amount": 1e2, "private": "甲😀" }'
    try { db.prepare('UPDATE log_entries SET value = ? WHERE stream = ? AND sequence = 0').run(original, 'simulation') }
    finally { db.close() }
    const archived = await readSqliteRawLogArchive(path, 'simulation', { maxEntries: 10, maxBytes: 16384 })
    expect(archived).toMatchObject({ version: 101, representation: 'sqlite-logical-frames', firstSequence: 0, tailSequence: 0, entryCount: 1 })
    if (archived === undefined) throw new Error('Archive missing')
    const value: unknown = JSON.parse(archived.text)
    if (typeof value !== 'object' || value === null || !('entries' in value) || !Array.isArray(value.entries)
      || !('checkpoint' in value)) throw new Error('Original SQLite archive entries or checkpoint missing')
    expect(value).toMatchObject({ version: 101 })
    expect(frameBytes(value.entries[0]).toString('utf8')).toBe(original)
    expect(JSON.parse(frameBytes(value.checkpoint).toString('utf8'))).toEqual({ old: true })
    await expect(readSqliteRawLogArchive(path, 'simulation', { maxEntries: 10, maxBytes: 16 }))
      .rejects.toMatchObject({ code: 'read-limit', dimension: 'bytes', limit: 16 })
    expect(await readSqliteRawLogArchive(path, 'missing', { maxEntries: 10, maxBytes: 16384 })).toBeUndefined()
    expect((await log.read(-1, 1))[0]?.value).toMatchObject({ amount: 100 })
  } finally { await backend.close(); await rm(root, { recursive: true, force: true }) }
})
