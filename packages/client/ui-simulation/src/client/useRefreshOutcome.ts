/** Explicit refresh outcome: refreshed, failed or timed out, derived from the read state it refreshed. */
import { useEffect, useRef, useState } from 'react'
import type { SimulationReadState } from '@clocky/clocky-client-runtime/client'

/** Result of the latest explicit refresh; automatic rereads never produce one. */
export type RefreshOutcome = { readonly kind: 'refreshing' | 'refreshed' | 'failed' | 'timeout'; readonly at: number }

/**
 * Track one explicit refresh at a time; a newer refresh or a changed scope replaces the old outcome.
 * @param current - Read state of the refreshed view, judged once the refresh settles.
 * @param connected - A refresh that settles while disconnected failed.
 * @param timeoutMs - Real milliseconds after which an unsettled refresh reports a timeout.
 * @param scope - View identity; changing it clears the outcome.
 * @returns the outcome and a starter that accepts the refresh's settling promise.
 */
export function useRefreshOutcome(current: SimulationReadState<unknown>, connected: boolean, timeoutMs: number, scope: string): {
  readonly outcome: RefreshOutcome | undefined
  readonly start: (refresh: Promise<void>) => void
} {
  const [request, setRequest] = useState<{ id: number; scope: string; at: number; settled: boolean }>()
  // The refresh whose own timeout elapsed before it settled; a newer refresh never inherits it.
  const [timedOut, setTimedOut] = useState<number>()
  const next = useRef(0)
  const timer = useRef<number>()
  useEffect(() => () => { window.clearTimeout(timer.current) }, [])
  const start = (refresh: Promise<void>) => {
    const id = ++next.current
    window.clearTimeout(timer.current)
    setRequest({ id, scope, at: Date.now(), settled: false })
    // Each refresh clears only its own timer, so an older refresh settling late cannot cancel a newer one's timeout.
    const own = window.setTimeout(() => { setTimedOut(id) }, timeoutMs)
    timer.current = own
    void refresh.finally(() => {
      window.clearTimeout(own)
      setRequest(value => value?.id === id ? { ...value, settled: true, at: Date.now() } : value)
    })
  }
  const outcome: RefreshOutcome | undefined = request === undefined || request.scope !== scope ? undefined
    : !request.settled ? { kind: timedOut === request.id ? 'timeout' : 'refreshing', at: request.at }
      : { kind: !connected || current.error !== undefined ? 'failed' : 'refreshed', at: request.at }
  return { outcome, start }
}
