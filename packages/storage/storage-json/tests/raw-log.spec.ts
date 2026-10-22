/** Storage-only preservation keeps unknown consumer versions and exact document bytes unchanged. */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { JsonStorageBackend, readJsonRawLogArchive } from '../src/index.ts'

it('preserves original version101 and bytes without opening the source with a newer consumer version', async () => {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/raw-json-'))
  const backend = new JsonStorageBackend(root)
  try {
    const log = await backend.log.open({ name: 'simulation', version: 101 })
    await log.append(-1, [{ kind: 'unknown-native-kind', private: '甲😀 secret' }])
    await log.writeCheckpoint({ sequence: 0, value: { old: 'uninterpreted' } })
    const before = await readFile(join(root, 'logs', 'c2ltdWxhdGlvbg.json'))
    const archived = await readJsonRawLogArchive(root, 'simulation', { maxEntries: 10, maxBytes: 16384 })
    expect(archived).toMatchObject({ version: 101, representation: 'json-document-bytes', firstSequence: 0, tailSequence: 0, entryCount: 1 })
    if (archived === undefined) throw new Error('Archive missing')
    const value: unknown = JSON.parse(archived.text)
    if (typeof value !== 'object' || value === null || !('documentBase64' in value)
      || typeof value.documentBase64 !== 'string') throw new Error('Original JSON archive bytes missing')
    expect(Buffer.from(value.documentBase64, 'base64')).toEqual(before)
    expect(await readFile(join(root, 'logs', 'c2ltdWxhdGlvbg.json'))).toEqual(before)
    await expect(readJsonRawLogArchive(root, 'simulation', { maxEntries: 10, maxBytes: 16 }))
      .rejects.toMatchObject({ code: 'read-limit', dimension: 'bytes', limit: 16 })
    expect(await readJsonRawLogArchive(root, 'missing', { maxEntries: 10, maxBytes: 16384 })).toBeUndefined()
  } finally { await backend.close(); await rm(root, { recursive: true, force: true }) }
})
