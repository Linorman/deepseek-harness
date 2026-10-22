import { useEffect, useRef } from 'react'
import type { SimulationRuntimeState } from '@clocky/clocky-client-runtime/client'

/**
 * Stable change identity: heartbeat timestamps and renewed cursors are not data changes.
 * @param data - Current authenticated runtime snapshot.
 * @param runId - Run selected by this mounted view.
 * @returns observation identity for this run, or undefined while disconnected or awaiting its observation.
 */
export function observationVersion(data: SimulationRuntimeState, runId: string | undefined): string | undefined {
  const value = data.observation.value
  if (!data.connected || runId === undefined || value?.runId !== runId) return undefined
  return JSON.stringify([runId, data.generation, data.authorizationVersion, value.readVersion,
    value.world.status, value.world.status === 'observed' ? value.world.revision : undefined])
}

/**
 * Reread a mounted window after an observation changes, coalescing changes during pending reads.
 * Initial/selection reads and cancellation belong to the existing view and runtime owners.
 * @param version - Current authorized change identity; undefined suspends automatic reads.
 * @param loading - The owning window's pending state; never cancel a slow read just to refresh it.
 * @param refresh - Read the currently selected window without changing authored input or submitting commands.
 * @param stale - The first observation can overtake the initial read; retry that window once per version.
 */
export function useObservedRefresh(version: string | undefined, loading: boolean, refresh: () => void, stale = false): void {
  const readVersion = useRef(version)
  const refreshed = useRef<string>()
  useEffect(() => {
    if (version === undefined) { readVersion.current = undefined; refreshed.current = undefined; return }
    if (loading) return
    if (readVersion.current === undefined && !stale) { readVersion.current = version; return }
    if (readVersion.current === version && (!stale || refreshed.current === version)) return
    readVersion.current = version
    refreshed.current = version
    refresh()
  }, [version, loading, refresh, stale])
}
