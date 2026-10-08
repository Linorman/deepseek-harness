/** Real object-store files with deterministic filesystem failures at the provider boundary. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import TeamArtifactStore from '@clocky/clocky-team-artifact'
import { expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

const teamId = 'team-artifact-fault' as never

const fault = vi.hoisted(() => ({
  writePath: undefined as string | undefined,
  inspectPath: undefined as string | undefined,
  statPath: undefined as string | undefined,
  removePath: undefined as string | undefined,
  removeMode: 'none' as 'none' | 'vanished' | 'denied',
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original,
    async writeFile(...args: Parameters<typeof original.writeFile>) {
      const source = args[0]
      let path: string | undefined
      if (typeof source === 'string') path = source
      else if (Buffer.isBuffer(source)) path = source.toString('utf8')
      else if (source instanceof URL) path = source.pathname
      if (path === fault.writePath) throw Object.assign(new Error('object write failed'), { code: 'EIO' })
      await original.writeFile(...args)
    },
    async lstat(...args: Parameters<typeof original.lstat>) {
      if (String(args[0]) === fault.inspectPath) throw Object.assign(new Error('object inspection failed'), { code: 'EACCES' })
      return await original.lstat(...args)
    },
    async stat(...args: Parameters<typeof original.stat>) {
      const info = await original.stat(...args)
      const path = typeof args[0] === 'string' ? args[0] : args[0].toString()
      if (path !== fault.statPath) return info
      return new Proxy(info, { get(target, property, receiver) {
        if (property === 'isDirectory') return () => false
        return Reflect.get(target, property, receiver) as unknown
      } })
    },
    async unlink(...args: Parameters<typeof original.unlink>) {
      if (String(args[0]) === fault.removePath) {
        if (fault.removeMode === 'vanished') {
          await original.unlink(...args)
          throw Object.assign(new Error('object vanished during unlink'), { code: 'ENOENT' })
        }
        if (fault.removeMode === 'denied') throw 'object deletion denied'
      }
      await original.unlink(...args)
    },
  }
})

it('reports object write, inspection and deletion failures without reclaiming uncertain files', async () => {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'clocky-team-artifact-fault-'))
  const ctx = new Context()
  try {
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(TeamArtifactStore)
    await apply(ctx, { root })
    const provider = ctx.teamArtifacts.getProvider('local')
    if (provider === undefined || provider.collect === undefined) throw new Error('local artifact provider was not registered')
    const objectPath = (data: string) => {
      const digest = createHash('sha256').update(data).digest('hex')
      return join(root, digest.slice(0, 2), digest.slice(2))
    }
    fault.writePath = objectPath('blocked-write')
    await expect(provider.save({ teamId, kind: 'log', visibility: 'team', data: 'blocked-write' }))
      .rejects.toThrow('object write failed')
    fault.writePath = undefined

    const inspected = await provider.save({ teamId, kind: 'log', visibility: 'team', data: 'inspected-object' })
    fault.inspectPath = objectPath('inspected-object')
    const inspection = await provider.collect({ reachable: [], reclaimableIds: [inspected.id], limit: 10 })
    expect(inspection.failures).toContainEqual({ id: inspected.id,
      message: 'artifact object inspection failed: object inspection failed' })
    expect(inspection.deleted).toEqual([])
    fault.inspectPath = undefined

    fault.removePath = objectPath('inspected-object')
    fault.removeMode = 'vanished'
    const vanished = await provider.collect({ reachable: [], reclaimableIds: [inspected.id], limit: 10 })
    expect(vanished.deleted).toContain(inspected.id)

    const denied = await provider.save({ teamId, kind: 'log', visibility: 'team', data: 'denied-object' })
    fault.removePath = objectPath('denied-object')
    fault.removeMode = 'denied'
    const failed = await provider.collect({ reachable: [], reclaimableIds: [denied.id], limit: 10 })
    expect(failed.failures).toContainEqual({ id: denied.id, message: 'artifact object deletion failed: object deletion denied' })
    expect(failed.retained).toBeGreaterThan(0)
    await expect(provider.read({ reference: denied })).resolves.toBeInstanceOf(Uint8Array)
  } finally {
    fault.writePath = undefined
    fault.inspectPath = undefined
    fault.statPath = undefined
    fault.removePath = undefined
    fault.removeMode = 'none'
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it('refuses a canonical root that changes from directory to file during validation', async () => {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'clocky-team-artifact-root-race-'))
  const ctx = new Context()
  try {
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(TeamArtifactStore)
    fault.statPath = root
    await expect(apply(ctx, { root })).rejects.toThrow('cannot be prepared')
    expect(ctx.teamArtifacts.getProvider('local')).toBeUndefined()
  } finally {
    fault.statPath = undefined
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
