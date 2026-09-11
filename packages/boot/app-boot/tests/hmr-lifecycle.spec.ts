/** Real filesystem scans and watchers exercise HMR registration during unloading. */
import fs from 'node:fs'
import promises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@clocky/cordis'
import Hmr from '@clocky/cordis-plugin-hmr'
import Loader from '@clocky/cordis-plugin-loader'
import Timer from '@clocky/cordis-plugin-timer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
const contexts: Context[] = []
const releases: Array<() => void> = []

async function root(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await promises.mkdir(parent, { recursive: true })
  const dir = await promises.mkdtemp(join(parent, 'hmr-lifecycle-'))
  roots.push(dir)
  return dir
}

async function context(dir: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = `${pathToFileURL(dir).href}/`
  await ctx.plugin(Loader)
  await ctx.plugin(Timer)
  return ctx
}

/** Hold the real filesystem result at the chosen asynchronous operation. */
function hold(kind: 'stat' | 'realpath' | 'readdir', directory: string) {
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  releases.push(() => { release.resolve(undefined) })
  if (kind === 'stat') {
    const stat = promises.stat.bind(promises)
    vi.spyOn(promises, 'stat').mockImplementation(async (path, options) => {
      const result = await stat(path, options)
      if (String(path) === directory) { entered.resolve(undefined); await release.promise }
      return result
    })
  } else if (kind === 'realpath') {
    const realpath = promises.realpath.bind(promises)
    vi.spyOn(promises, 'realpath').mockImplementation(async (path, options) => {
      const result = await realpath(path, options)
      if (String(path) === directory) { entered.resolve(undefined); await release.promise }
      return result
    })
  } else {
    const readdir = promises.readdir.bind(promises)
    vi.spyOn(promises, 'readdir').mockImplementation(async (path, options) => {
      const result = await readdir(path, options)
      if (String(path) === directory) { entered.resolve(undefined); await release.promise }
      return result
    })
  }
  syncBuiltinESMExports()
  return { entered: entered.promise, release: () => { release.resolve(undefined) } }
}

/** Observe real native watcher ownership without substituting a watcher. */
function observeWatchers() {
  const watch = fs.watch.bind(fs)
  const active = new Set<fs.FSWatcher>()
  const opened: string[] = []
  vi.spyOn(fs, 'watch').mockImplementation((...args) => {
    const watcher = watch(...args)
    active.add(watcher)
    opened.push(String(args[0]))
    watcher.once('close', () => { active.delete(watcher) })
    return watcher
  })
  syncBuiltinESMExports()
  return { active, opened, close: () => { for (const watcher of active) watcher.close() } }
}

afterEach(async () => {
  for (const release of releases.splice(0)) release()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const dir of roots.splice(0)) await promises.rm(dir, { recursive: true, force: true })
})

describe('HMR watcher admission and teardown', () => {
  it('rejects a retained service after its owner was removed while the root caller stays live', async () => {
    const dir = await root()
    const ctx = await context(dir)
    const owner = await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    const hmr = ctx.hmr
    const observed = observeWatchers()
    await owner.dispose()
    let dispose: (() => Promise<void>) | undefined
    try {
      const result = await hmr.registerConfig(join(dir, 'plugins.yml'), () => {}).then(
        (value) => { dispose = value; return 'registered' },
        (error: unknown) => error,
      )
      expect(result).toMatchObject({ code: 'INACTIVE_EFFECT' })
      expect(observed.opened).toEqual([])
    } finally { await dispose?.(); observed.close() }
  })

  it('drains a root lookup admitted before owner removal without creating a late watcher', async () => {
    const dir = await root()
    const ctx = await context(dir)
    const owner = await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    const gate = hold('stat', dir)
    const observed = observeWatchers()
    let dispose: (() => Promise<void>) | undefined
    const registration = ctx.hmr.registerConfig(join(dir, 'plugins.yml'), () => {}).then(
      (value) => { dispose = value; return 'registered' },
      (error: unknown) => error,
    )
    await gate.entered
    const unloading = owner.dispose()
    await vi.waitFor(() => { expect(ctx.get('hmr')).toBeUndefined() })
    gate.release()
    try {
      expect(await registration).toMatchObject({ code: 'INACTIVE_EFFECT' })
      await unloading
      expect(observed.opened).toEqual([])
    } finally { gate.release(); await dispose?.(); observed.close(); await unloading }
  })

  for (const target of ['owner', 'caller'] as const) {
    it(`settles a config registration closed before Chokidar ready when its ${target} unloads`, async () => {
      const dir = await root()
      await promises.writeFile(join(dir, 'plugins.yml'), '[]\n')
      const ctx = await context(dir)
      const owner = await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
      let caller!: Context
      const consumer = await ctx.plugin({ inject: ['hmr'], apply(inner) { caller = inner } })
      const gate = hold('readdir', dir)
      const observed = observeWatchers()
      let settled = false
      let dispose: (() => Promise<void>) | undefined
      const registration = caller.hmr.registerConfig(join(dir, 'plugins.yml'), () => {}).then(
        (value) => { dispose = value; settled = true; return 'registered' },
        (error: unknown) => { settled = true; return error },
      )
      await gate.entered
      const unloading = (target === 'owner' ? owner : consumer).dispose()
      gate.release()
      try {
        await vi.waitFor(() => { expect(settled).toBe(true) }, { timeout: 1_000 })
        expect(await registration).toMatchObject({ code: 'INACTIVE_EFFECT' })
        await unloading
        await vi.waitFor(() => { expect(observed.active.size).toBe(0) })
      } finally { gate.release(); await dispose?.(); observed.close(); await unloading }
    }, 5_000)
  }
  for (const stage of ['realpath', 'readdir'] as const) {
    it(`cancels main-watcher initialization during ${stage} without retaining native watchers`, async () => {
      const dir = await root()
      await promises.writeFile(join(dir, 'module.ts'), 'export const value = 1\n')
      const ctx = await context(dir)
      const gate = hold(stage, dir)
      const observed = observeWatchers()
      let owner: Fiber | undefined
      ctx.on('internal/plugin', (fiber) => {
        if (fiber.runtime?.callback === Hmr && fiber.uid !== null) owner = fiber
      })
      let settled = false
      const mounting = Promise.resolve(ctx.plugin(Hmr, { root: ['.'], ignored: [], debounce: 0 }))
        .then(() => { settled = true })
      await gate.entered
      if (owner === undefined) throw new Error('HMR did not publish its actual loading fiber')
      const unloading = owner.dispose()
      try {
        if (stage === 'realpath') gate.release()
        await vi.waitFor(() => { expect(settled).toBe(true) }, { timeout: 1_000 })
        await unloading
        gate.release()
        await mounting
        await vi.waitFor(() => { expect(observed.active.size).toBe(0) })
        if (stage === 'realpath') expect(observed.opened).toEqual([])
      } finally { gate.release(); await mounting; observed.close(); await unloading }
    }, 5_000)
  }

})
