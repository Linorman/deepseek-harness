/**
 * Synchronous navigation with an optional native presentation lifetime.
 * Browser capture cannot delay the route or overwrite subsequent history.
 * Global pseudo-element styles live in ui-theme's `transitions.css`.
 */
import { prefersReducedMotion } from './hooks.ts'
import { flushSync } from 'react-dom'

/**
 * How a navigation moves: `page` changes workspace (depth crossfade),
 * `forward`/`back` move through an ordered set of modules (slide), and
 * `none` only crossfades.
 */
export type TransitionDirection = 'page' | 'forward' | 'back' | 'none'

interface ActiveNavigation {
  commit: () => void
  stop: () => void
  transition: ViewTransition | undefined
  committed: boolean
}

// One presentation owner fences cleanup and pending callbacks across rapid navigation.
let activeNavigation: ActiveNavigation | undefined

/**
 * Run a navigation as a view transition. Without API support, while the
 * document is hidden, or under reduced motion, the update runs immediately.
 * @param update - The navigation, committed synchronously by this React presentation adapter;
 * called exactly once, including cancellation and visual failure. Its errors propagate.
 * @param direction - Direction through an ordered set; module containers slide that way.
 */
export function navigateWithTransition(update: () => void, direction: TransitionDirection = 'none'): void {
  const doc = typeof document === 'undefined' ? undefined : document
  // A skipped transition still invokes its callback later. Commit the older
  // intent first so that delayed callbacks cannot overwrite the latest intent.
  activeNavigation?.stop()
  if (doc?.startViewTransition === undefined || doc.visibilityState === 'hidden' || prefersReducedMotion()) {
    activeNavigation = undefined
    if (doc !== undefined) delete doc.documentElement.dataset.clockyTransition
    if (doc === undefined) update()
    else flushSync(update)
    return
  }
  const root = doc.documentElement
  const navigation: ActiveNavigation = {
    committed: false,
    transition: undefined,
    stop: () => {
      navigation.commit()
      navigation.transition?.skipTransition()
      cleanup()
    },
    commit: () => {
      if (navigation.committed) return
      navigation.committed = true
      flushSync(update)
    },
  }
  activeNavigation = navigation
  root.dataset.clockyTransition = direction
  // Chromium suppresses live-element hit testing during capture. Retire the
  // visual on fresh input so the following target click reaches committed DOM.
  const interrupt = () => { if (activeNavigation === navigation) navigation.stop() }
  const hide = () => { if (doc.visibilityState === 'hidden') interrupt() }
  const cleanup = () => {
    doc.removeEventListener('pointermove', interrupt, true)
    doc.removeEventListener('pointerdown', interrupt, true)
    doc.removeEventListener('keydown', interrupt, true)
    doc.removeEventListener('visibilitychange', hide)
    if (activeNavigation !== navigation) return
    activeNavigation = undefined
    delete root.dataset.clockyTransition
  }
  doc.addEventListener('pointermove', interrupt, true)
  doc.addEventListener('pointerdown', interrupt, true)
  doc.addEventListener('keydown', interrupt, true)
  doc.addEventListener('visibilitychange', hide)
  try {
    navigation.transition = doc.startViewTransition(navigation.commit)
  } catch (error: unknown) {
    cleanup()
    if (navigation.committed) throw error
    navigation.commit()
    return
  }
  // Visual rejection never replays the action. Observe all native promises;
  // failed/skipped captures may reject ready while finished still resolves.
  void navigation.transition.ready.catch(() => { /* A failed visual capture leaves the committed navigation intact. */ })
  void navigation.transition.updateCallbackDone.catch(cleanup)
  void navigation.transition.finished.then(cleanup, cleanup)
  // Native old-state capture queues its callback. Commit before returning so
  // Back/Forward already sees the new history entry; the delayed callback is
  // an idempotent visual checkpoint, never a later navigation intent.
  try {
    navigation.commit()
  } catch (error: unknown) {
    navigation.transition.skipTransition()
    cleanup()
    throw error
  }
}

/**
 * Direction of a move between two positions in an ordered list.
 * @param order - Ordered identifiers.
 * @param from - Current identifier.
 * @param to - Target identifier.
 * @returns forward, back, or none when either is unknown or they match.
 */
export function transitionDirection(order: readonly string[], from: string, to: string): TransitionDirection {
  const a = order.indexOf(from), b = order.indexOf(to)
  if (a < 0 || b < 0 || a === b) return 'none'
  return b > a ? 'forward' : 'back'
}

/**
 * A valid `view-transition-name` for an arbitrary identifier.
 * @param prefix - Namespace such as `clocky-run`.
 * @param id - Raw identifier.
 * @returns a CSS identifier unique per id.
 */
export function transitionName(prefix: string, id: string): string {
  return `${prefix}-${Array.from(id).map(char => /[A-Za-z0-9_-]/u.test(char) ? char : `_${char.codePointAt(0)?.toString(36) ?? ''}`).join('')}`
}
