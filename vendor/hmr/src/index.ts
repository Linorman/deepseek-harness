import { Context, CordisError, Service, type Plugin } from '@clocky/cordis'
import type { Dict } from '@clocky/cosmokit'
import { ModuleLoader, type ModuleJob, type ResolveResult } from '@clocky/cordis-plugin-loader'
import type { Include } from '@clocky/cordis-plugin-include'
import { FSWatcher, watch, type ChokidarOptions } from 'chokidar'
import { dirname, relative, resolve } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { handleError } from './error.ts'
import type {} from '@clocky/cordis-plugin-timer'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import picomatch from 'picomatch'
import z from '@clocky/schemastery'

declare module '@clocky/cordis' {
  interface Context {
    hmr: Hmr
  }

  interface Events {
    'hmr/change'(url: string): void
    'hmr/reload'(reloads: Map<Plugin, Reload>): void
    /**
     * A watched config-file refresh failed.
     * @param filename - Absolute path observed by HMR.
     * @param error - Normalized refresh failure.
     * @mode parallel
     */
    'hmr/config-update-failed'(filename: string, error: Error): Promise<void> | void
  }
}

/**
 * Recursively collect all module dependencies from a ModuleJob.
 * Skips node: builtins and node_modules to focus on user code.
 */
async function loadDependencies(job: ModuleJob, ignored = new Set<string>()) {
  const dependencies = new Set<string>()
  async function traverse(job: ModuleJob) {
    if (ignored.has(job.url) || dependencies.has(job.url)) return
    if (job.url.startsWith('node:') || job.url.includes('/node_modules/')) return
    dependencies.add(job.url)
    const children = await job.linked
    await Promise.all(Array.prototype.map.call(children, traverse))
  }
  await traverse(job)
  return dependencies
}

interface Reload {
  filename: string
  runtime?: Plugin.Runtime
}

interface ConfigRefresh {
  dirty: boolean
  running?: Promise<void>
}

interface ConfigRegistration {
  watcher: FSWatcher
  ready: Promise<void>
  cancelReady(): void
  close(): Promise<void>
}

async function findWatchRoot(filename: string): Promise<{ filename: string; root: string; depth: number }> {
  let root = dirname(filename)
  let depth = 0
  while (true) {
    try {
      if (!(await stat(root)).isDirectory()) throw new Error(`config watch parent is not a directory: ${root}`)
      const canonicalRoot = await realpath(root)
      return {
        filename: resolve(canonicalRoot, relative(root, filename)),
        root: canonicalRoot,
        depth,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(root)
      if (parent === root) throw error
      root = parent
      depth += 1
    }
  }
}

/** Fingerprint one exact path without reading its content or enumerating its parent. */
async function configStamp(filename: string): Promise<string | null> {
  try {
    const value = await stat(filename, { bigint: true })
    return `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

class Hmr extends Service {
  static inject = ['loader', 'timer']

  public baseDir: string

  private internal: ModuleLoader
  private watcher!: FSWatcher
  private mainRegistration?: ConfigRegistration
  private readonly closing = new AbortController()
  private readonly registrations = new Set<Promise<() => Promise<void>>>()
  private readonly configs = new Map<string, ConfigRegistration>()
  private readonly configPollIntervalMs: number
  private readonly configRefreshes = new WeakMap<object, ConfigRefresh>()
  private readonly refreshTasks = new Set<Promise<void>>()

  /**
   * Changes from externals will always trigger a full reload.
   * Externals are the dependency tree of the CLI worker entry point.
   */
  private externals!: Set<string>

  /**
   * Files that should be reloaded (accepted changes).
   * Includes all stashed files and their dependents.
   */
  private accepted!: Set<string>

  /**
   * Files that should NOT be reloaded.
   * Includes externals and files whose dependents are all declined.
   */
  private declined!: Set<string>

  /** Stashed file changes waiting to be processed */
  private stashed = new Set<string>()

  constructor(ctx: Context, public config: Hmr.Config) {
    super(ctx, 'hmr')
    this.configPollIntervalMs = config.configPollIntervalMs ?? 1000
    if (!Number.isSafeInteger(this.configPollIntervalMs) || this.configPollIntervalMs < 1) {
      throw new TypeError('configPollIntervalMs must be a positive safe integer')
    }
    if (!this.ctx.loader.internal) {
      throw new Error('--expose-internals is required for HMR service')
    }
    this.internal = this.ctx.loader.internal
    this.baseDir = fileURLToPath(new URL(config.base || '.', ctx.baseUrl))
    // Fiber disposal can begin while Service.init is still awaiting a scan.
    ctx.on('internal/plugin', (fiber) => {
      if (fiber === ctx.fiber && fiber.uid === null) this.closeAdmission()
    })
  }

  /**
   * Watch one exact config path outside the configured module roots.
   * @param filename - Config path, resolved against the HMR base directory.
   * @param refresh - Refresh callback run serially on add, change, or unlink.
   * @returns an asynchronous disposer once the exact watch is ready.
   * @throws INACTIVE_EFFECT when the owner or caller cancels registration; also rejects duplicate paths and watcher startup failures.
   */
  async registerConfig(filename: string, refresh: () => Promise<void> | void): Promise<() => Promise<void>> {
    this.assertRegistrationActive()
    const operation = this.registerConfigOwned(filename, refresh)
    this.registrations.add(operation)
    try {
      return await operation
    } finally {
      this.registrations.delete(operation)
    }
  }

  /** Require both the HMR owner and the calling plugin to retain their registration lifetime. */
  private assertRegistrationActive(): void {
    this.closing.signal.throwIfAborted()
    this.ctx.fiber.assertActive()
    if (!this.watcher) throw new Error('HMR is not active')
  }

  /** Retain lookup and readiness work until it has either published a disposer or closed its watcher. */
  private async registerConfigOwned(filename: string, refresh: () => Promise<void> | void): Promise<() => Promise<void>> {
    let registration: ConfigRegistration | undefined
    const caller = this.ctx
    const stopSetupCancellation = caller.on('internal/plugin', (fiber) => {
      if (fiber === caller.fiber && fiber.uid === null) registration?.cancelReady()
    })
    try {
      filename = resolve(this.baseDir, filename)
      const target = await findWatchRoot(filename)
      this.assertRegistrationActive()
      const watchFilename = target.filename
      if (this.configs.has(watchFilename)) throw new Error(`config path already registered: ${filename}`)

      const { root, depth } = target
      const watched = registration = this.openWatcher(root, {
        ...this.config,
        cwd: undefined,
        depth,
        ignored: undefined,
        ignoreInitial: false,
      })
      this.configs.set(watchFilename, watched)
      let stamp: string | null | undefined
      let stopped = false
      let stopPolling: (() => void) | undefined
      const nativeClose = watched.close
      watched.close = () => {
        stopped = true
        stopPolling?.()
        return nativeClose()
      }
      const reconcile = async () => {
        const next = await configStamp(watchFilename)
        if (next === stamp) return
        const initial = stamp === undefined
        stamp = next
        if (initial && next === null) return
        await refresh()
      }
      const schedule = () => {
        if (!stopped && !this.closing.signal.aborted) this.refreshConfig(watched, filename, reconcile)
      }
      const onChange = (path: string) => {
        const observed = resolve(path)
        if (observed !== filename && observed !== watchFilename) return
        schedule()
      }
      watched.watcher.on('add', onChange)
      watched.watcher.on('change', onChange)
      watched.watcher.on('unlink', onChange)

      let cleanupTask: Promise<void> | undefined
      const cleanup = (): Promise<void> => cleanupTask ??= (async () => {
        if (this.configs.get(watchFilename) === watched) this.configs.delete(watchFilename)
        await watched.close()
        await this.configRefreshes.get(watched)?.running
      })()
      let dispose: (() => Promise<void>) | undefined
      try {
        // The caller owns the watcher even before Chokidar emits ready.
        dispose = caller.effect(() => cleanup, 'hmr.registerConfig()')
        await watched.ready
        this.assertRegistrationActive()
        stopPolling = caller.interval(schedule, this.configPollIntervalMs)
        schedule()
        return dispose
      } catch (error) {
        await cleanup()
        await dispose?.()
        throw error
      }
    } finally {
      stopSetupCancellation()
    }
  }

  /** Cancel readiness as well as closing the real watcher: Chokidar does not emit ready after close. */
  private openWatcher(root: string | string[], options: ChokidarOptions): ConfigRegistration {
    this.closing.signal.throwIfAborted()
    const watcher = watch(root, options)
    const ready = Promise.withResolvers<void>()
    let settled = Array.isArray(root) && root.length === 0
    if (settled) ready.resolve()
    watcher.once('ready', () => {
      settled = true
      ready.resolve()
    })
    watcher.on('error', (error) => {
      if (!settled) {
        settled = true
        ready.reject(error)
      } else {
        this.ctx.logger.warn(error)
      }
    })
    const cancelReady = (): void => {
      settled = true
      ready.reject(new CordisError('INACTIVE_EFFECT'))
    }
    let closingTask: Promise<void> | undefined
    return {
      watcher,
      ready: ready.promise,
      cancelReady,
      close: () => {
        cancelReady()
        return closingTask ??= watcher.close()
      },
    }
  }

  /** Stop new registrations before any asynchronous watcher or refresh cleanup begins. */
  private closeAdmission(): void {
    if (this.closing.signal.aborted) return
    this.closing.abort(new CordisError('INACTIVE_EFFECT'))
    this.mainRegistration?.cancelReady()
    for (const registration of this.configs.values()) registration.cancelReady()
  }

  /**
   * Resolve a module specifier to a URL, compatible with Node 22-24.
   */
  private async _resolve(specifier: string, parentURL: string, attrs: ImportAttributes): Promise<ResolveResult> {
    switch (this.internal.version) {
      case 'v1': return await this.internal.resolve(specifier, parentURL, attrs)
      case 'v2': return this.internal.resolveSync(parentURL, { specifier, attributes: attrs })
    }
  }

  async* [Service.init]() {
    yield async () => {
      this.closeAdmission()
      const closes = await Promise.allSettled([
        this.mainRegistration?.close(),
        ...[...this.configs.values()].map(registration => registration.close()),
      ])
      await Promise.allSettled([...this.registrations])
      this.configs.clear()
      await Promise.allSettled([...this.refreshTasks])
      const failures: unknown[] = []
      for (const result of closes) if (result.status === 'rejected') failures.push(result.reason)
      if (failures.length > 0) throw new AggregateError(failures, 'HMR watcher teardown failed')
    }

    try {
      await this.startWatcher()
    } catch (error) {
      if (!this.closing.signal.aborted || !(error instanceof CordisError) || error.code !== 'INACTIVE_EFFECT') throw error
    }
  }

  /** Start module observation only while this service's original load is still admitted. */
  private async startWatcher(): Promise<void> {
    this.closing.signal.throwIfAborted()
    const { loader } = this.ctx
    const { root, ignored } = this.config
    if (!this.config.base) {
      this.ctx.logger.info('watching %o', root)
    } else {
      this.ctx.logger.info('watching %o in %s', root, this.baseDir)
    }

    const match = picomatch(ignored)
    const watchBaseDir = await realpath(this.baseDir)
    this.closing.signal.throwIfAborted()

    // Collect externals before opening the watcher so every post-ready change
    // is observed by listeners that already have their classification state.
    const mainUrl = pathToFileURL(resolve(process.argv[1])).href
    const mainJob = this.internal.loadCache.get(mainUrl)
    if (mainJob) {
      this.externals = await loadDependencies(mainJob)
    } else {
      this.externals = new Set()
    }

    this.closing.signal.throwIfAborted()
    const registration = this.mainRegistration = this.openWatcher(root, {
      ...this.config,
      cwd: watchBaseDir,
      ignored: path => match(relative(watchBaseDir, path)),
      // The initial scan re-announces files the boot just consumed: an `add`
      // for a config file refreshes an include whose initial apply may still
      // be in flight, and a failing apply then rolls this plugin back while
      // the scan-triggered refresh waits on that apply — a teardown deadlock
      // that strands boot without a diagnostic. Only events after the scan
      // matter here; `registerConfig` keeps its own initial scan because a
      // user patch layer present at registration must apply once.
      ignoreInitial: true,
    })
    this.watcher = registration.watcher

    const partialReload = this.ctx.debounce(() => this.partialReload(), this.config.debounce)

    const onChange = (kind: 'add' | 'change' | 'unlink', path: string) => {
      this.ctx.logger.debug('%s detected at %C', kind, path)
      const filename = resolve(watchBaseDir, path)
      const configuredFilename = resolve(this.baseDir, path)
      // Config reload: the file is a loader config file (e.g. cordis.yml).
      for (const entry of loader.entries()) {
        const include = entry.subtree as Include | undefined
        if (include?.filename !== filename && include?.filename !== configuredFilename) continue
        this.refreshConfig(include, include.filename, () => include.refresh())
        return
      }

      if (kind !== 'change') return
      const url = pathToFileURL(filename).href

      // Full reload: the changed file is part of the framework
      if (this.externals.has(url)) return loader.exit()

      // Partial reload: the file is in the ESM loadCache
      // In Node 24, both CJS and ESM modules imported via import() end up
      // in loadCache, so this check covers all module formats.
      if (loader.internal!.loadCache.has(url)) {
        this.stashed.add(url)
        return partialReload()
      }

      this.ctx.emit('hmr/change', url)
    }
    this.watcher.on('add', path => onChange('add', path))
    this.watcher.on('change', path => onChange('change', path))
    this.watcher.on('unlink', path => onChange('unlink', path))

    await registration.ready
    this.closing.signal.throwIfAborted()
  }

  private refreshConfig(key: object, filename: string, refresh: () => Promise<void> | void) {
    const state = this.configRefreshes.get(key) ?? { dirty: false }
    this.configRefreshes.set(key, state)
    state.dirty = true
    if (state.running) return
    const task = (async () => {
      do {
        state.dirty = false
        try {
          await refresh()
        } catch (reason) {
          const error = reason instanceof Error ? reason : new Error(String(reason), { cause: reason })
          this.ctx.logger.warn('config reload at %C failed', filename)
          this.ctx.logger.warn(error)
          try {
            await this.ctx.parallel('hmr/config-update-failed', filename, error)
          } catch (rejection) {
            this.ctx.logger.warn(rejection)
          }
        }
      } while (state.dirty)
    })().finally(() => {
      state.running = undefined
      this.refreshTasks.delete(task)
    })
    state.running = task
    this.refreshTasks.add(task)
  }

  // hide stack trace from HMR
  getOuterStack = (): string[] => [
    // '    at HMR.partialReload (<anonymous>)',
  ]

  async getLinked(url: string) {
    const job = this.internal.loadCache.get(url)
    if (!job) return []
    const linked = await job.linked
    return Array.prototype.map.call(linked, (job: ModuleJob) => job.url) as string[]
  }

  /**
   * Classify changed files into accepted (should reload) and declined (should not).
   *
   * A file is accepted if it's directly changed (stashed) or if any of its
   * dependents are accepted. A file is declined if all its dependents are
   * declined or if it's an external.
   */
  private async analyzeChanges() {
    const pending: string[] = []

    this.accepted = new Set(this.stashed)
    this.declined = new Set(this.externals)

    const isExcluded = (url: string) => url.startsWith('node:') || url.includes('/node_modules/')

    await Promise.all([...this.stashed].map(async (url) => {
      const children = await this.getLinked(url)
      for (const child of children) {
        if (this.accepted.has(child) || this.declined.has(child) || isExcluded(child)) continue
        pending.push(child)
      }
    }))

    while (pending.length) {
      let index = 0, hasUpdate = false
      while (index < pending.length) {
        const url = pending[index]
        const children = await this.getLinked(url)
        let isDeclined = true, isAccepted = false
        for (const child of children) {
          if (this.declined.has(child) || isExcluded(child)) continue
          if (this.accepted.has(child)) {
            isAccepted = true
            break
          } else {
            isDeclined = false
            if (!pending.includes(child)) {
              hasUpdate = true
              pending.push(child)
            }
          }
        }
        if (isAccepted || isDeclined) {
          hasUpdate = true
          pending.splice(index, 1)
          if (isAccepted) {
            this.accepted.add(url)
          } else {
            this.declined.add(url)
          }
        } else {
          index++
        }
      }
      if (!hasUpdate) break
    }

    for (const url of pending) {
      this.declined.add(url)
    }
  }

  private async partialReload() {
    await this.analyzeChanges()

    const pending = new Map<ModuleJob, Plugin>()
    const reloads = new Map<Plugin, Reload>()

    // Build a map of plugin names per config tree URL.
    // Plugin entry files are treated as atomic reload units.
    const nameMap: Dict<Set<string>> = Object.create(null)
    for (const entry of this.ctx.loader.entries()) {
      (nameMap[entry.parent.tree.ctx.baseUrl!] ??= new Set()).add(entry.options.name)
    }

    // Resolve each plugin name to its file URL and check if it needs reload
    for (const baseUrl in nameMap) {
      for (const name of nameMap[baseUrl]) {
        try {
          const { url } = await this._resolve(name, baseUrl, {})
          if (this.declined.has(url)) continue
          const job = this.internal.loadCache.get(url)
          const plugin = this.ctx.loader.unwrapExports(job?.module?.getNamespace())
          if (!job || !plugin) continue
          pending.set(job, plugin)
          this.declined.add(url)
        } catch (err) {
          this.ctx.logger.warn(err)
        }
      }
    }

    // Check each pending plugin's dependency tree for accepted files
    for (const [job, plugin] of pending) {
      this.declined.delete(job.url)
      const dependencies = [...await loadDependencies(job, this.declined)]
      this.declined.add(job.url)

      if (!dependencies.some(dep => this.accepted.has(dep))) continue
      dependencies.forEach(dep => this.accepted.add(dep))

      reloads.set(plugin, {
        filename: job.url,
        runtime: this.ctx.registry.get(plugin),
      })
    }

    /**
     * Clear module caches for all accepted files before re-importing.
     *
     * We need to clear both:
     * 1. ESM loadCache — managed by Node's internal ModuleLoader
     * 2. CJS Module._cache — for CJS modules that were imported via import()
     *
     * In Node 24, CJS modules loaded via import() appear in both caches.
     * If we only clear loadCache, the CJS cache may serve stale modules.
     *
     * We use Map.prototype methods directly on loadCache because:
     * - In Node 22/23, loadCache is a plain Map<url, ModuleJob>
     * - In Node 24, loadCache is a LoadCache extends Map<url, { [type]: ModuleJob }>
     *   where .delete() only sets the type slot to undefined (doesn't remove the entry)
     * Using Map.prototype.delete ensures complete removal in both versions.
     */
    const esmBackup: Dict = Object.create(null)
    const cjsBackup: Dict = Object.create(null)
    const require = createRequire(import.meta.url)
    for (const filename of this.accepted) {
      // Backup and clear ESM loadCache
      const job = Map.prototype.get.call(this.internal.loadCache, filename)
      esmBackup[filename] = job
      Map.prototype.delete.call(this.internal.loadCache, filename)

      // Backup and clear CJS Module._cache
      try {
        const filepath = fileURLToPath(filename)
        if (require.cache[filepath]) {
          cjsBackup[filepath] = require.cache[filepath]
          delete require.cache[filepath]
        }
      } catch {
        // filename might not be a file: URL (e.g. node: protocol), ignore
      }
    }

    const rollback = () => {
      for (const filename in esmBackup) {
        Map.prototype.set.call(this.internal.loadCache, filename, esmBackup[filename])
      }
      for (const filepath in cjsBackup) {
        require.cache[filepath] = cjsBackup[filepath]
      }
    }

    // Attempt to re-import all plugin entry files
    const attempts: Dict = {}
    try {
      for (const [, { filename }] of reloads) {
        attempts[filename] = this.ctx.loader.unwrapExports(await this.ctx.loader.import(filename, this.getOuterStack))
      }
    } catch (e) {
      handleError(this.ctx, e)
      return rollback()
    }

    const reload = (plugin: any, runtime: Plugin.Runtime) => {
      if (!runtime) return
      for (const oldFiber of runtime.fibers) {
        const fiber = oldFiber.parent.registry.plugin(plugin, oldFiber._config, this.getOuterStack)
        fiber.entry = oldFiber.entry
        if (fiber.entry) fiber.entry.fiber = fiber
      }
    }

    try {
      for (const [plugin, { filename, runtime }] of reloads) {
        if (!runtime) continue
        const path = relative(this.baseDir, fileURLToPath(filename))

        try {
          this.ctx.registry.delete(plugin)
        } catch (err) {
          this.ctx.logger.warn('failed to dispose plugin at %C', path)
          this.ctx.logger.warn(err)
        }

        try {
          reload(attempts[filename], runtime)
          this.ctx.logger.info('reload plugin at %C', path)
        } catch (err) {
          this.ctx.logger.warn('failed to reload plugin at %C', path)
          this.ctx.logger.warn(err)
          throw err
        }
      }
    } catch {
      // Rollback: restore caches and re-register old plugins
      rollback()
      for (const [plugin, { filename, runtime }] of reloads) {
        if (!runtime) continue
        try {
          this.ctx.registry.delete(attempts[filename])
          reload(plugin, runtime)
        } catch (err) {
          this.ctx.logger.warn(err)
        }
      }
      return
    }

    this.ctx.emit('hmr/reload', reloads)
    this.stashed = new Set()
  }
}

namespace Hmr {
  export interface Config extends ChokidarOptions {
    base?: string
    /** Reconcile exact configuration-file metadata at this interval to recover missed native events. */
    configPollIntervalMs?: number
    root: string[]
    debounce: number
    ignored: string[]
  }

  export const Config: z<Config> = z.object({
    base: z.string(),
    configPollIntervalMs: z.natural().min(1).role('ms').default(1000),
    root: z.array(String).role('table').default(['.']),
    ignored: z.array(String).role('table').default([
      '**/node_modules',
      '**/.*',
      'cache',
      'data',
    ]),
    debounce: z.natural().role('ms').default(100),
  })
  // [clocky] vendored modification: removed `.i18n({ 'en-US': enUS, 'zh-CN': zhCN })`
  // and the corresponding `./locales/*.yml` imports, to avoid a runtime YAML import hook
  // (@cordisjs/unyaml) that we don't vendor. See vendor/README.md.
}

export default Hmr
