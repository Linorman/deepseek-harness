/** Diagnostics from the shared compiler or Host preflight, with locate actions and modified/stale states. */
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { DraftPath, SectionId } from './world-draft.ts'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/** One displayable diagnostic. */
export interface DiagnosticItem {
  readonly key: string
  readonly severity: 'error' | 'warning'
  readonly section: SectionId
  readonly readable: string
  readonly path: DraftPath
  readonly code: string
  readonly message: string
  readonly line?: number | undefined
  readonly column?: number | undefined
  /** The value this diagnostic is about changed since it was checked. */
  readonly modified: boolean
}

/**
 * List diagnostics. Fixed items stay struck through until the next check replaces them.
 * @param props.items - Diagnostics in compiler order.
 * @param props.state - `unchecked` before the first explicit check.
 * @param props.stale - Last check failed; previous results remain.
 * @param props.locate - Move focus to the responsible cell or source token.
 * @returns heading, optional stale banner and list.
 */
export function DiagnosticList({ items, state, stale, locate, t }: {
  items: readonly DiagnosticItem[]
  state: 'unchecked' | 'checked'
  stale: boolean
  locate: (item: DiagnosticItem) => void
  t: WorldT
}) {
  const open = items.filter(item => !item.modified).length
  return <section className={css.diagnostics} aria-label={t('world.diag.title')}>
    <h3 data-count={open}>{open > 0 ? <><span className={css.diagIcon} data-severity="error" aria-hidden="true">⚠</span>
      {t('world.diag.count', { count: open })}</> : t('world.diag.title')}</h3>
    {stale && <p className={css.warning} role="status">{t('world.diag.stale')}</p>}
    {state === 'unchecked' ? <p className={css.muted}>{t('world.diag.notChecked')}</p>
      : items.length === 0 ? <p className={css.ok}><span aria-hidden="true">✓ </span>{t('world.diag.none')}</p>
        : <ol className={css.diagList}>{items.map(item => <li key={item.key} data-modified={item.modified || undefined}
          data-severity={item.severity}>
          <button type="button" className={css.diagButton} onClick={() => { locate(item) }}
            aria-label={`${t('world.diag.locate')}: ${t(`world.section.${item.section}`)} · ${item.readable} · ${item.message}`}>
            <span className={css.diagIcon} data-severity={item.severity} aria-hidden="true">{item.severity === 'error' ? '●' : '▲'}</span>
            <span className={css.diagMain}>
              <span className={css.diagWhere}>{t(`world.section.${item.section}`)} · {item.readable}</span>
              <span className={css.diagMessage}>{item.message}</span>
              <small className={css.diagRaw}><code>{item.path.join('.') || '/'}</code> · {item.code}
                {item.line !== undefined && item.column !== undefined && ` · ${t('world.diag.location', { line: item.line, column: item.column })}`}</small>
              {item.modified && <small className={css.diagModified}>{t('world.diag.modified')}</small>}
            </span>
          </button>
        </li>)}</ol>}
    {state === 'checked' && items.length > 1 && <div className={css.inlineActions}>
      <Button size="sm" variant="ghost" onClick={() => { const first = items.find(item => !item.modified) ?? items[0]; if (first !== undefined) locate(first) }}>
        {t('world.diag.next')} <kbd>F8</kbd></Button>
    </div>}
  </section>
}
