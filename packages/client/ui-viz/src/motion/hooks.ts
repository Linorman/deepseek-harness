/**
 * Motion gates shared by every visualization: whether the page is visible,
 * whether an element is on screen, whether the user asked for reduced
 * motion, and whether a data change was observed live.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'

/** The four motion tiers; elements carry the tier in `data-motion-tier`. */
export type MotionTier = 'L0' | 'L1' | 'L2' | 'L3'

/** Concurrent particle cap for L1; the excess merges into one "+N" pulse. */
export const MAX_PARTICLES = 24

/**
 * Whether the user prefers reduced motion, following changes live.
 * @returns true under `prefers-reduced-motion: reduce`.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion())
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { setReduced(query.matches) }
    query.addEventListener('change', update)
    return () => { query.removeEventListener('change', update) }
  }, [])
  return reduced
}

/**
 * Synchronous reduced-motion read for event handlers and animation starts.
 * @returns true under `prefers-reduced-motion: reduce`.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Whether the document is visible; animation work stops while it is hidden.
 * @returns false while the tab is in the background.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    const update = () => { setVisible(document.visibilityState !== 'hidden') }
    document.addEventListener('visibilitychange', update)
    return () => { document.removeEventListener('visibilitychange', update) }
  }, [])
  return visible
}

/**
 * Whether an element intersects the viewport. Without IntersectionObserver
 * (jsdom) the element counts as on screen.
 * @param ref - Element to observe.
 * @returns false once the element scrolls fully out of view.
 */
export function useInViewport(ref: RefObject<Element>): boolean {
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const element = ref.current
    if (element === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1)
      if (entry !== undefined) setInView(entry.isIntersecting)
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [ref])
  return inView
}

/**
 * Combined gate: animation work runs only while the page is visible and the
 * element is on screen.
 * @param ref - Element that owns the animation.
 * @returns true while animation work may run.
 */
export function useAnimationActive(ref: RefObject<Element>): boolean {
  const visible = useDocumentVisible()
  const inView = useInViewport(ref)
  const reduced = usePrefersReducedMotion()
  const [exposed, setExposed] = useState(true)
  useEffect(() => {
    const check = () => {
      const element = ref.current
      if (element === null) return
      const dialog = document.querySelector('dialog[open]')
      setExposed(element.closest('[hidden], [data-behind-pane="true"]') === null
        && (dialog === null || element.closest('dialog[open]') !== null))
    }
    check()
    return observeExposure(check)
  }, [ref])
  return visible && inView && exposed && !reduced
}

// Explicit shell markers and native modal lifetimes govern occlusion. One
// shared observer watches those attributes, never streaming text or frames.
const exposureListeners = new Set<() => void>()
let exposureObserver: MutationObserver | undefined

function observeExposure(listener: () => void): () => void {
  exposureListeners.add(listener)
  if (exposureObserver === undefined && typeof MutationObserver !== 'undefined') {
    exposureObserver = new MutationObserver(() => {
      for (const notify of exposureListeners) notify()
    })
    exposureObserver.observe(document.body, { attributes: true, subtree: true,
      attributeFilter: ['hidden', 'data-behind-pane', 'open'] })
  }
  return () => {
    exposureListeners.delete(listener)
    if (exposureListeners.size !== 0) return
    exposureObserver?.disconnect()
    exposureObserver = undefined
  }
}

/** What a component knows about the latest change of one observed value. */
export interface LiveTransition<T> {
  /** True only when the value changed while this component watched the same identity. */
  readonly live: boolean
  /** The value before the latest change; undefined on first render or after an identity change. */
  readonly previous: T | undefined
  /** Increments on each live change, for keying one-shot animations. */
  readonly generation: number
}

/**
 * Classify the latest change of a pushed value as live or settled. The first
 * value for an identity (initial hydration, reload, navigation to another
 * Team or run, replay into a fresh mount) is settled and must render without
 * L2/L3 motion. A later change whose cursor advances while the same identity
 * stays mounted is live.
 * @param identity - Owner identity, such as the Team id; a new identity resets.
 * @param cursor - Monotonic source cursor; a regression or repeat is not live.
 * @param value - The observed value whose change is classified.
 * @returns whether the latest change is live, the previous value, and a generation counter.
 */
export function useLiveTransition<T>(identity: string, cursor: number | undefined, value: T): LiveTransition<T> {
  const state = useRef<LiveRecord<T>>()
  const next = advanceLive(state.current, identity, cursor, value)
  state.current = next
  return next.result
}

interface LiveRecord<T> { identity: string; cursor: number | undefined; value: T; result: LiveTransition<T> }

/** Pure transition step behind {@link useLiveTransition}. */
function advanceLive<T>(current: LiveRecord<T> | undefined, identity: string, cursor: number | undefined, value: T): LiveRecord<T> {
  if (current === undefined || current.identity !== identity) {
    return { identity, cursor, value, result: { live: false, previous: undefined, generation: 0 } }
  }
  if (cursor !== undefined && (current.cursor === undefined || cursor > current.cursor)) {
    // First cursor after mount without one is still hydration, not a live change.
    const live = current.cursor !== undefined && !Object.is(current.value, value)
    const result = live
      ? { live: true, previous: current.value, generation: current.result.generation + 1 }
      : { ...current.result, live: false }
    return { identity, cursor, value, result }
  }
  // A value refresh at the same cursor (a re-read, not a push) is settled.
  if (!Object.is(current.value, value) && cursor === current.cursor) {
    return { ...current, value, result: { ...current.result, live: false } }
  }
  return current
}

/**
 * Detect live increases in a keyed set: which keys appeared or changed state
 * since the previous render under the same identity.
 * @param identity - Owner identity; a change resets without reporting anything.
 * @param entries - Current key → state signature.
 * @returns keys whose signature changed live; empty on the first render of an identity.
 */
export function useLiveChanges(identity: string, entries: ReadonlyMap<string, string>): ReadonlySet<string> {
  const previous = useRef<{ identity: string; entries: ReadonlyMap<string, string>; changed: ReadonlySet<string> }>()
  const prior = previous.current
  const next = prior === undefined || prior.identity !== identity
    ? { identity, entries, changed: new Set<string>() }
    : prior.entries === entries ? prior : { identity, entries, changed: diffSignatures(prior.entries, entries) }
  previous.current = next
  return next.changed
}

/** Keys whose signature differs between two snapshots, including new keys. */
function diffSignatures(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): Set<string> {
  const changed = new Set<string>()
  for (const [key, signature] of after) if (before.get(key) !== signature) changed.add(key)
  return changed
}
