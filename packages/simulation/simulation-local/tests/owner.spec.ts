/** Owner observations distinguish unavailable storage from a live competing coordinator. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { acquireRunOwner, observeRunOwner } from '../src/owner.ts'

it('treats missing and invalid owner databases as unavailable without claiming ownership', async () => {
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'simulation-owner-'))
  const path = join(root, 'owner.sqlite')
  try {
    expect(await observeRunOwner(path)).toBe('unavailable')
    await writeFile(path, 'not a SQLite database')
    expect(await observeRunOwner(path)).toBe('unavailable')
    await rm(path)

    const release = acquireRunOwner(path)
    try {
      expect(await observeRunOwner(path)).toBe('other-owner')
      expect(() => acquireRunOwner(path)).toThrow('already has a coordinator')
    }
    finally { release() }
    expect(await observeRunOwner(path)).toBe('unowned')
  } finally { await rm(root, { recursive: true, force: true }) }
})
