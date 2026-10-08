/** What in this run needs a person, summarized above the overview from reads it already has. */
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

/** One actionable count; zero counts are omitted. */
export interface NeedsYouItem {
  readonly id: 'reviews' | 'unknown' | 'requests'
  readonly count: number
  readonly open: () => void
}

/**
 * Render the strip: every non-zero item opens the surface that resolves it;
 * with nothing pending it stays one quiet line.
 * @param props.items - candidate items; zero counts are dropped.
 * @param props.t - localized words.
 * @returns the strip.
 */
export function NeedsYou({ items, t }: {
  items: readonly NeedsYouItem[]
  t: (key: Key, vars?: Record<string, unknown>) => string
}) {
  const pending = items.filter(item => item.count > 0)
  const total = pending.reduce((sum, item) => sum + item.count, 0)
  return <section className={css.needsYou} aria-label={t('needsYou.title')} data-pending={total > 0 || undefined}>
    <h2>{t('needsYou.title')} <span className={css.needsYouCount}>{total}</span></h2>
    {pending.length === 0
      ? <p className={css.muted}>{t('needsYou.none')}</p>
      : <div className={css.actions}>{pending.map(item => <Button key={item.id} variant="secondary" size="sm" onClick={item.open}>
        {t(`needsYou.${item.id}`, { count: item.count })}
      </Button>)}</div>}
  </section>
}
