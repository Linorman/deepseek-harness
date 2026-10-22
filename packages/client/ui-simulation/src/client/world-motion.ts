/** Live-transition helpers for World L3 moments; settled loads, reloads and navigation never play them. */
import { useRef } from 'react'
import { useLiveTransition } from '@clocky/clocky-client-ui-viz'

/**
 * Count distinct observations of a value so `useLiveTransition` receives a monotonic cursor.
 * @param value - Latest observed snapshot identity (a new object per Host observation).
 * @returns cursor that advances once per new observation.
 */
export function useObservationCursor(value: unknown): number {
  const state = useRef<{ value: unknown; count: number }>({ value: undefined, count: 0 })
  if (state.current.value !== value) state.current = { value, count: state.current.count + 1 }
  return state.current.count
}

/**
 * Generation for an L3 moment that plays only when `condition` turns true live under the same identity.
 * @param identity - Owner identity (object id); a new identity is settled.
 * @param observation - Latest observed snapshot.
 * @param condition - Whether the target state holds now.
 * @returns generation to pass to `Moment`; zero until a live entry is observed.
 */
export function useLiveEntry(identity: string, observation: unknown, condition: boolean): number {
  const cursor = useObservationCursor(observation)
  const transition = useLiveTransition(identity, cursor, condition)
  const generation = useRef(0)
  const seen = useRef(identity)
  if (seen.current !== identity) { seen.current = identity; generation.current = 0 }
  if (transition.live && transition.previous === false && condition) generation.current = transition.generation
  return generation.current
}
