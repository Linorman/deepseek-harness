import type { SimulationReadState } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'
import type { RefreshOutcome } from './useRefreshOutcome.ts'
import css from './Workspace.module.css'
type Translate = (key: Key, params?: Record<string, string>) => string

/**
 * @param props - Current read state and locale; retained content belongs to its caller.
 * @returns initial-load and failure feedback; retained content refreshes silently.
 */
export function Feedback({ value, t }: { value: SimulationReadState<unknown>; t: Translate }) {
  return <div className={css.feedback} aria-live="polite">
    {value.error !== undefined
      ? <p role="alert">{t(value.error)}</p>
      : value.loading && value.value === undefined ? <p className={css.loading}>{t('loading')}</p> : null}
  </div>
}

/**
 * Announce the latest explicit refresh: refreshing, refreshed at a time, failed, or timed out.
 * @param props.value - Outcome from `useRefreshOutcome`; absent renders an empty live region.
 * @param props.time - Formats the real settlement time.
 * @returns a polite live region.
 */
export function RefreshFeedback({ value, time, t }: { value: RefreshOutcome | undefined; time: (at: number) => string; t: Translate }) {
  return <span className={css.refreshOutcome} aria-live="polite" data-refresh={value?.kind}>
    {value === undefined ? null : value.kind === 'refreshing' ? t('refresh.pending')
      : value.kind === 'refreshed' ? t('refresh.done', { time: time(value.at) })
        : value.kind === 'failed' ? <span role="alert">{t('refresh.failed')}</span> : <span role="alert">{t('refresh.timeout')}</span>}
  </span>
}
