import type { SimulationReadState } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'
type Translate = (key: Key) => string

/**
 * @param props - Current read state and locale; retained content belongs to its caller.
 * @returns read feedback that keeps freshness distinct from operation failure.
 */
export function Feedback({ value, t }: { value: SimulationReadState<unknown>; t: Translate }) {
  return <div className={css.feedback} aria-live="polite">
    {value.error !== undefined
      ? <p role="alert">{t(value.error)}</p>
      : value.stale
        ? <p className={css.stalePill}>{t('stale')}</p>
        : value.loading ? <p className={css.loading}>{t('loading')}</p> : null}
  </div>
}
