/** The durable owner record fences a Hub without retaining a native descriptor. */
import type { FileHandle } from 'node:fs/promises'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { acquireJsonLogOwner } from '../src/log-owner.ts'

it('closes the acquisition descriptor while its durable record still fences another Hub', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clocky-json-owner-'))
  const path = join(root, '.clocky-log-owner.lock')
  const probe = await open(join(root, 'probe'), 'wx')
  const prototype = Object.getPrototypeOf(probe) as FileHandle
  await probe.close()
  // oxlint-disable-next-line typescript/unbound-method -- Reflect.apply preserves the FileHandle receiver.
  const originalSync = prototype.sync
  let acquisitionHandle: FileHandle | undefined
  const sync = vi.spyOn(prototype, 'sync').mockImplementation(new Proxy(originalSync, {
    apply(target, receiver: FileHandle, args) {
      acquisitionHandle = receiver
      return Reflect.apply(target, receiver, args) as ReturnType<typeof originalSync>
    },
  }))
  try {
    const owner = await acquireJsonLogOwner(root)
    expect(acquisitionHandle).toBeDefined()
    expect(acquisitionHandle?.fd).toBe(-1)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ pid: process.pid })
    await expect(acquireJsonLogOwner(root)).rejects.toMatchObject({ code: 'writer-locked' })
    await owner.close()
    await owner.close()
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const successor = await acquireJsonLogOwner(root)
    expect(acquisitionHandle?.fd).toBe(-1)
    await successor.close()
  } finally {
    sync.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
