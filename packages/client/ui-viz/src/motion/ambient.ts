/**
 * Ambient field signals. A workspace tells the L0 field behind it which scene it shows and when a live
 * observation happened by dispatching a bubbling DOM event; the field listens on its own stage. The DOM
 * carries the signal so separately bundled feature packages need no shared module instance.
 */
import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

/** Bubbling event name the ambient field listens for on its stage. */
export const AMBIENT_SIGNAL = 'clocky-ambient'

/** Scene tone: `full` while the shown world is observed running, `muted` otherwise. Atmosphere only, never state. */
export type AmbientTone = 'full' | 'muted'

/** One ambient signal. */
export type AmbientSignal =
  /** The scene shown in front of the field; an absent seed returns to the neutral star map. */
  | { readonly kind: 'scene'; readonly seed: string | undefined; readonly tone: AmbientTone }
  /** One live observation; the field answers with a single ring from this client point. */
  | { readonly kind: 'pulse'; readonly x: number; readonly y: number }

/**
 * Dispatch an ambient signal from an element inside a workspace stage.
 * @param from - Element that bubbles the event; nothing happens when it is absent.
 * @param signal - Scene or pulse.
 */
export function signalAmbient(from: Element | null | undefined, signal: AmbientSignal): void {
  from?.dispatchEvent(new CustomEvent<AmbientSignal>(AMBIENT_SIGNAL, { bubbles: true, detail: signal }))
}

/**
 * Publish the scene a workspace shows while it is mounted, and return the field to neutral on unmount.
 * @param ref - Element inside the stage.
 * @param seed - Scene identity such as a run id.
 * @param tone - Current tone.
 */
export function useAmbientScene(ref: RefObject<Element>, seed: string | undefined, tone: AmbientTone): void {
  useEffect(() => { signalAmbient(ref.current, { kind: 'scene', seed, tone }) }, [ref, seed, tone])
  useEffect(() => {
    const element = ref.current
    return () => { signalAmbient(element, { kind: 'scene', seed: undefined, tone: 'muted' }) }
  }, [ref])
}

/**
 * Send one pulse from an element's centre.
 * @param element - Anchor such as the overview clock.
 */
export function pulseAmbient(element: Element | null | undefined): void {
  if (element === null || element === undefined) return
  const box = element.getBoundingClientRect()
  signalAmbient(element, { kind: 'pulse', x: box.left + box.width / 2, y: box.top + box.height / 2 })
}

const PREFERENCE_KEY = 'clocky:ambient-motion'
const PREFERENCE_EVENT = 'clocky-ambient-preference'

/** Whether the ambient field may move. `off` keeps it static; reduced motion always keeps it static. */
export type AmbientMotion = 'on' | 'off'

/** Page-lifetime value used when browser storage is blocked (private mode, policy). */
let unpersisted: AmbientMotion = 'on'

function readPreference(): AmbientMotion {
  try {
    const stored = globalThis.localStorage.getItem(PREFERENCE_KEY)
    return stored === null ? unpersisted : stored === 'off' ? 'off' : 'on'
  } catch { return unpersisted /* Blocked storage: the page-lifetime value set below still applies. */ }
}

/**
 * The viewer's ambient-motion preference, synchronised across every field and toggle in this browser.
 * @returns the current preference and a setter that persists it locally (never in the URL).
 */
export function useAmbientMotion(): [AmbientMotion, (next: AmbientMotion) => void] {
  const [value, setValue] = useState<AmbientMotion>(readPreference)
  useEffect(() => {
    const update = () => { setValue(readPreference()) }
    window.addEventListener(PREFERENCE_EVENT, update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener(PREFERENCE_EVENT, update); window.removeEventListener('storage', update) }
  }, [])
  const set = (next: AmbientMotion) => {
    unpersisted = next
    try { globalThis.localStorage.setItem(PREFERENCE_KEY, next) }
    catch { /* Blocked storage: the page-lifetime value above applies until reload. */ }
    setValue(next)
    window.dispatchEvent(new Event(PREFERENCE_EVENT))
  }
  return [value, set]
}
