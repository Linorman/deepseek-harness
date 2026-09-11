/** Shipped workspace recovery rows await actual asynchronous provider registration. */
import assert from 'node:assert/strict'
import promises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { Context, type Fiber } from '@clocky/cordis'
import Loader, { type EntryOptions } from '@clocky/cordis-plugin-loader'
import AgentRegistry from '@clocky/clocky-agent'
import Storage from '@clocky/clocky-storage'
import * as Sqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import TeamWorkspaces from '@clocky/clocky-team-workspace'
import * as Shared from '@clocky/clocky-team-workspace-shared'
import * as Recovery from '@clocky/clocky-team-workspace-recovery'
import { afterEach, describe, expect, it, vi } from 'vitest'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const contexts: Context[] = []
const roots: string[] = []
const release: Array<() => void> = []
afterEach(async () => {
  for (const done of release.splice(0)) done()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const root of roots.splice(0)) await promises.rm(root, { recursive: true, force: true })
})

/** Select actual shipped rows, changing only the deployment's filesystem root. */
async function rows(surface: string, root: string): Promise<EntryOptions[]> {
  const patch = await promises.readFile(join(repository, 'packages/bundle', surface, 'cordis.patch.yml'), 'utf8')
  return ['team-workspace-shared', 'team-workspace-recovery'].map((id) => {
    const start = patch.indexOf(`    - id: ${id}\n`)
    assert(start >= 0)
    const next = patch.indexOf('\n    - id: ', start + 1)
    const text = patch.slice(start, next < 0 ? undefined : next).replaceAll(/^    /gm, '')
      .replace('root: !!js process.cwd()', `root: ${JSON.stringify(root)}`)
      .replace("observationStateRoot: !!js clockyHomePath('team-workspace-observations')",
        `observationStateRoot: ${JSON.stringify(join(root, 'team-workspace-observations'))}`)
    return (load(text) as EntryOptions[])[0]!
  })
}

async function setup(surface: string) {
  await promises.mkdir(join(repository, '.tmp'), { recursive: true })
  const root = await promises.mkdtemp(join(repository, '.tmp/workspace-loader-order-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(Storage)
  await ctx.plugin(Sqlite, { path: join(root, 'team.sqlite') })
  await ctx.plugin(StorageLog, { backend: 'sqlite', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(TeamWorkspaces)
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === '@clocky/clocky-team-workspace-shared') return Shared
      if (specifier === '@clocky/clocky-team-workspace-recovery') return Recovery
      throw new Error(`unexpected workspace Loader import '${specifier}'`)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  return { ctx, root, entries: await rows(surface, root) }
}

/** Delay the real directory result, preserving provider validation and registration. */
function holdRoot(root: string) {
  const entered = Promise.withResolvers<undefined>()
  const ready = Promise.withResolvers<undefined>()
  const realpath = promises.realpath.bind(promises)
  vi.spyOn(promises, 'realpath').mockImplementation(async (path, options) => {
    const result = await realpath(path, options)
    if (String(path) === root) { entered.resolve(undefined); await ready.promise }
    return result
  })
  syncBuiltinESMExports()
  release.push(() => { ready.resolve(undefined) })
  return { entered: entered.promise, release: () => { ready.resolve(undefined) } }
}

describe('shipped workspace recovery startup ordering', () => {
  for (const surface of ['headless', 'web-app']) {
    it(`${surface} waits for a slow provider, scans once, and preserves explicit restart ownership`, async () => {
      const { ctx, root, entries } = await setup(surface)
      const gate = holdRoot(root)
      const seen = Promise.withResolvers<Fiber>()
      ctx.on('internal/plugin', (fiber) => {
        if (fiber.entry?.options.id === 'team-workspace-recovery') seen.resolve(fiber)
      })
      const snapshots: string[][] = []
      const list = ctx.teams.listTeamsPage.bind(ctx.teams)
      vi.spyOn(ctx.teams, 'listTeamsPage').mockImplementation(async (request) => {
        snapshots.push(ctx.teamWorkspaces.listProviders().map(provider => provider.name))
        return await list(request)
      })
      const loading = ctx.loader.root.update(entries)
      await gate.entered
      const recovery = await seen.promise
      await recovery.await()
      try { expect(snapshots).toEqual([]) }
      finally { gate.release(); await loading }
      await ctx.loader.await()
      expect(snapshots).toEqual([['shared-local']])
      await ctx.loader.await()
      expect(snapshots).toHaveLength(1)
      await recovery.restart()
      await ctx.loader.await()
      expect(snapshots).toEqual([['shared-local'], ['shared-local']])
      await ctx.loader.resolve('team-workspace-shared').fiber!.restart()
      await ctx.loader.await()
      expect(snapshots).toHaveLength(2)
      expect(ctx.teamWorkspaces.listProviders()).toEqual([{ name: 'shared-local', modes: ['shared'] }])
    })

    it(`${surface} rejects a provider directory failure through Loader settlement`, async () => {
      const { ctx, root, entries } = await setup(surface)
      entries[0]!.config = { root: join(root, 'missing') }
      const result = await Promise.allSettled([ctx.loader.root.update(entries), ctx.loader.await()])
      expect(result.some(outcome => outcome.status === 'rejected' && String(outcome.reason).includes('cannot be canonicalized'))).toBe(true)
      expect(ctx.teamWorkspaces.listProviders()).toEqual([])
    })
  }
})
