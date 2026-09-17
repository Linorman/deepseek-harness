/** Bounded diagnostics for exact-config watcher failures, without changing watcher behavior. */
import type { EventEmitter } from 'node:events'
import type { Context } from '@clocky/cordis'
import type {} from '@clocky/cordis-plugin-hmr'

type ObservedWatcher = EventEmitter & {
  closed: boolean
  options: { usePolling?: boolean; interval?: number }
  getWatched(): Record<string, string[]>
}

/** Observe already-registered watchers and retain only their most recent events.
 * @param ctx - Live test context with an exact-config HMR registration.
 * @returns a snapshot function for assertion diagnostics; the Context owns listener cleanup.
 */
export function observeHmrConfig(ctx: Context): () => unknown {
  // Test-only observation of real Chokidar handles; no replacement of watchers or callbacks.
  const owner = ctx.hmr as unknown as { configs: Map<string, { watcher: ObservedWatcher }> }
  const observations = [...owner.configs].map(([filename, { watcher }]) => {
    const events: { kind: string; args: unknown[] }[] = []
    const remember = (kind: string, args: unknown[]) => {
      events.push({ kind, args })
      if (events.length > 16) events.shift()
    }
    const raw = (...args: unknown[]) => { remember('raw', args) }
    const all = (...args: unknown[]) => { remember('all', args) }
    watcher.on('raw', raw)
    watcher.on('all', all)
    ctx.effect(() => () => { watcher.off('raw', raw); watcher.off('all', all) })
    return () => ({ filename, closed: watcher.closed, options: watcher.options,
      watched: watcher.getWatched(), events })
  })
  return () => observations.map(snapshot => snapshot())
}
