/** Name discovery must not load or validate potentially large journal bodies. */
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { JsonStorageBackend } from '../src/index.ts'
import { logFileName } from '../src/log.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function discover(backend: JsonStorageBackend, prefix: string, maxNameBytes: number) {
  const names: Array<string | undefined> = []
  for await (const name of backend.log.scanNames!(prefix, maxNameBytes)) names.push(name)
  return names
}

it('accounts for unrelated files without reading a malformed journal body', async () => {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/json-name-scan-'))
  const backend = new JsonStorageBackend(root)
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
  const stream = await backend.log.open({ name: 'team/large', version: 1 })
  await stream.append(-1, [{ value: 'initial' }])
  await stream.close()
  const other = await backend.log.open({ name: 'channel/other', version: 1 })
  await other.append(-1, [{}]); await other.close()
  await writeFile(join(root, 'logs', `${Buffer.from('team/large').toString('base64url')}.json`), 'not-json'.repeat(100000))
  await writeFile(join(root, 'logs', 'in-flight.tmp'), 'temporary')
  const entries: Array<string | undefined> = []
  for await (const value of backend.log.scanNames!('team/', 1024)) entries.push(value)
  expect(entries.filter(value => value !== undefined)).toEqual(['team/large'])
  expect(entries).toHaveLength((await readdir(join(root, 'logs'))).length)
  await expect(backend.log.open({ name: 'team/large', version: 1 })).rejects.toMatchObject({ code: 'malformed-medium' })
})

it('reads a byte-bounded atomic header independently of malformed or large history', async () => {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/json-summary-'))
  const backend = new JsonStorageBackend(root)
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
  const descriptor = { name: 'team/header', version: 1 }
  const stream = await backend.log.open(descriptor)
  await stream.append(-1, [{ body: 'x'.repeat(1000000) }], { summary: { label: '界😀' } })
  await stream.close()
  const path = join(root, 'logs', `${Buffer.from(descriptor.name).toString('base64url')}.json`)
  const original = await readFile(path)
  const headerBytes = original.indexOf(10) + 1
  expect(headerBytes).toBeLessThan(256)
  const probe = await open(path, 'r')
  const prototype = Object.getPrototypeOf(probe) as typeof probe
  await probe.close()
  // oxlint-disable-next-line typescript/unbound-method -- the Proxy forwards each FileHandle receiver through Reflect.apply.
  const originalRead = prototype.read
  const shortReads = vi.spyOn(prototype, 'read').mockImplementation(new Proxy(originalRead, {
    apply(target, receiver, args) {
      if (typeof args[2] === 'number') args[2] = Math.min(args[2], 7)
      return Reflect.apply(target, receiver, args) as ReturnType<typeof originalRead>
    },
  }))
  try {
    await expect(backend.log.readSummary!(descriptor, headerBytes)).resolves.toEqual({ sequence: 0, value: { label: '界😀' } })
    expect(shortReads.mock.calls.length).toBeGreaterThan(1)
  } finally { shortReads.mockRestore() }
  await expect(backend.log.readSummary!(descriptor, headerBytes - 1)).rejects.toMatchObject({ code: 'invalid-value' })
  await writeFile(path, Buffer.concat([original.subarray(0, headerBytes), Buffer.from('invalid body')]))
  await expect(backend.log.readSummary!(descriptor, headerBytes)).resolves.toMatchObject({ sequence: 0 })
  await expect(backend.log.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })
  await writeFile(path, '{\"stream\":')
  await expect(backend.log.readSummary!(descriptor, 256)).rejects.toMatchObject({ code: 'invalid-value' })
  await writeFile(path, '{bad,\n')
  await expect(backend.log.readSummary!(descriptor, 256)).rejects.toMatchObject({ code: 'malformed-medium' })
  await writeFile(path, '{"other":1,\n')
  await expect(backend.log.readSummary!(descriptor, 256)).rejects.toMatchObject({ code: 'malformed-medium' })
})

it('distinguishes absent durable metadata from a malformed log pathname and refuses access after close', async () => {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/json-existence-'))
  const backend = new JsonStorageBackend(root)
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
  const descriptor = { name: 'team/exists', version: 1 }
  expect(await backend.log.has!(descriptor.name)).toBe(false)
  expect(await backend.log.readSummary!(descriptor, 256)).toBeUndefined()
  const stream = await backend.log.open(descriptor)
  await stream.append(-1, [{}]); await stream.close()
  expect(await backend.log.has!(descriptor.name)).toBe(true)
  await expect(discover(backend, 'team/', 5)).rejects.toMatchObject({ code: 'invalid-value' })
  await mkdir(join(root, 'logs', logFileName('team/directory')))
  await expect(backend.log.has!('team/directory')).rejects.toMatchObject({ code: 'malformed-medium' })
  await expect(discover(backend, 'team/', 1024)).rejects.toMatchObject({ code: 'malformed-medium' })
  // POSIX reports overlong file components distinctly from absent paths; Windows maps them differently.
  if (process.platform !== 'win32') {
    const oversizedName = 'x'.repeat(512)
    await expect(backend.log.has!(oversizedName)).rejects.toMatchObject({ code: 'ENAMETOOLONG' })
    await expect(backend.log.readSummary!({ name: oversizedName, version: 1 }, 256))
      .rejects.toMatchObject({ code: 'ENAMETOOLONG' })
  }
  await backend.close()
  await expect(backend.log.has!(descriptor.name)).rejects.toMatchObject({ code: 'closed' })
  await expect(backend.log.readSummary!(descriptor, 256)).rejects.toMatchObject({ code: 'closed' })
  await expect(backend.log.scanNames!('team/', 1024)[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'closed' })
})

it.each(['!.json', 'dGVhbS9h=.json'])('rejects a noncanonical discovery filename without reading its payload (%s)', async (file) => {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/json-invalid-name-'))
  const backend = new JsonStorageBackend(root)
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }) })
  expect(await backend.log.has!('absent')).toBe(false)
  await writeFile(join(root, 'logs', file), 'not a journal')
  await expect(discover(backend, '', 1024)).rejects.toMatchObject({ code: 'malformed-medium' })
})
