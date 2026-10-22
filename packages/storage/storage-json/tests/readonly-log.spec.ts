/** Atomic JSON documents remain observable while the writer lock is held. */
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { JsonStorageBackend, readJsonLogSnapshot } from '../src/index.ts'
import { logFileName } from '../src/log.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function root() {
  await mkdir('.tmp', { recursive: true })
  const value = await mkdtemp(join(process.cwd(), '.tmp', 'readonly-json-'))
  roots.push(value); return value
}
const descriptor = { name: 'observed', version: 2 }
const limits = { maxEntries: 8, maxBytes: 8192 }

it('does not materialize a missing root and returns detached current data without taking the live writer lock', async () => {
  const directory = await root()
  const missing = join(directory, 'absent')
  expect(await readJsonLogSnapshot(missing, descriptor, limits)).toBeUndefined()
  await expect(stat(missing)).rejects.toMatchObject({ code: 'ENOENT' })
  const backend = new JsonStorageBackend(directory)
  try {
    const writer = await backend.log.open(descriptor)
    await writer.append(-1, [{ name: 'original' }, '甲😀'])
    expect((await readJsonLogSnapshot(directory, descriptor, limits))?.checkpoint).toBeUndefined()
    await writer.writeCheckpoint({ sequence: 1, value: { retained: true } })
    const path = join(directory, 'logs', logFileName(descriptor.name))
    const before = await readFile(path)
    const observed = await readJsonLogSnapshot(directory, descriptor, limits)
    expect(observed).toMatchObject({ firstSequence: 0, tailSequence: 1, checkpoint: { sequence: 1 },
      entries: [{ sequence: 0 }, { sequence: 1 }] })
    expect(await readFile(path)).toEqual(before)
    if (observed === undefined) throw new Error('Expected a read-only snapshot')
    ;(observed.entries[0]?.value as { name: string }).name = 'reader-local'
    expect((await writer.read(-1, 1))[0]?.value).toEqual({ name: 'original' })
    await writer.append(1, [{ next: true }])
    expect((await readJsonLogSnapshot(directory, descriptor, limits))?.tailSequence).toBe(2)
    await expect(readJsonLogSnapshot(directory, { ...descriptor, version: 3 }, limits)).rejects.toMatchObject({ code: 'version-mismatch' })
    await expect(readJsonLogSnapshot(directory, descriptor, { ...limits, maxEntries: 1 })).rejects.toMatchObject({ code: 'read-limit' })
    await expect(readJsonLogSnapshot(directory, descriptor, { ...limits, maxBytes: 10 })).rejects.toMatchObject({ code: 'read-limit' })
    await writer.writeCheckpoint({ sequence: 2, value: {} })
    await writer.compact({ throughSequence: 0, expectedCheckpointSequence: 2 })
    expect((await readJsonLogSnapshot(directory, descriptor, limits))?.firstSequence).toBe(1)
  } finally { await backend.close() }
})

it('rejects corrupt existing documents and propagates non-missing IO errors', async () => {
  const directory = await root()
  await mkdir(join(directory, 'logs'))
  const path = join(directory, 'logs', logFileName(descriptor.name))
  await writeFile(path, 'corrupt')
  await expect(readJsonLogSnapshot(directory, descriptor, limits)).rejects.toMatchObject({ code: 'malformed-medium' })
  await rm(path)
  await mkdir(path)
  await expect(readJsonLogSnapshot(directory, descriptor, limits)).rejects.toBeTruthy()
  const invalidRoot = join(directory, 'not-a-directory')
  await writeFile(invalidRoot, 'file')
  await expect(readJsonLogSnapshot(invalidRoot, descriptor, limits)).rejects.toMatchObject({ code: 'ENOTDIR' })
})

it('rejects a medium whose size changes between metadata and read, while retaining valid empty journals', async () => {
  const directory = await root()
  const backend = new JsonStorageBackend(directory)
  try {
    const writer = await backend.log.open(descriptor)
    await writer.writeCheckpoint({ sequence: -1, value: {} })
    expect(await readJsonLogSnapshot(directory, descriptor, limits)).toMatchObject({ entries: [], tailSequence: -1 })
    const handle = await open(join(directory, 'logs', logFileName(descriptor.name)), 'r')
    const actual = await handle.stat()
    const prototype = Object.getPrototypeOf(handle) as typeof handle
    await handle.close()
    actual.size = 1
    const changedSize = vi.spyOn(prototype, 'stat').mockResolvedValueOnce(actual)
    try { await expect(readJsonLogSnapshot(directory, descriptor, limits)).rejects.toMatchObject({ code: 'malformed-medium' }) }
    finally { changedSize.mockRestore() }
  } finally { await backend.close() }
})
