/** Team-local pending summaries; owning runtime controls pagination and authority. */
import { useState } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { TeamAttentionState, TeamAttentionCounts, TeamAttentionItem, TeamTaskId, TeamActionResponseInput } from '@clocky/clocky-client-runtime/client'
import type { TeamKey } from './locales.ts'
import css from './TeamWorkspace.module.css'

/** Pending preview and complete-list controls share the same state semantics. */
export interface TeamAttentionProps {
  readonly state?: TeamAttentionState | undefined
  readonly counts?: TeamAttentionCounts | undefined
  readonly preview?: boolean | undefined
  readonly translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  readonly read?: ((mode?: 'first' | 'next') => Promise<void>) | undefined
  readonly viewAll?: (() => void) | undefined
  readonly openTask: (id: TeamTaskId) => void
  readonly openRecovery: () => void
  readonly openAction?: ((id: TeamActionResponseInput['actionId']) => Promise<void>) | undefined
}

/**
 * Show bounded pending rows while retaining totals and navigation after preview failure.
 * @param props - runtime page, authoritative counts and shared navigation owners.
 * @returns loading/empty/error/stale feedback and precise responsibility links.
 */
export function TeamAttention({ state, counts, preview = false, translate: t, read, viewAll,
  openTask, openRecovery, openAction }: TeamAttentionProps) {
  const [error, setError] = useState<string>()
  const [opening, setOpening] = useState<TeamActionResponseInput['actionId']>()
  const page = state?.page
  const total = counts?.total ?? page?.counts.total
  const run = (operation: () => Promise<void>) => {
    setError(undefined)
    void operation().catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
  }
  const open = (item: TeamAttentionItem) => {
    switch (item.kind) {
      case 'team-recovery': openRecovery(); return
      case 'task-review': case 'task-recovery': openTask(item.id); return
      case 'human-action':
        if (openAction === undefined || opening !== undefined) return
        setOpening(item.id)
        run(async () => { try { await openAction(item.id) } finally { setOpening(undefined) } })
        return
      default: return assertNever(item)
    }
  }
  const label = (item: TeamAttentionItem): string => {
    switch (item.kind) {
      case 'team-recovery': return t('attention.teamRecovery')
      case 'task-recovery': case 'task-review': return item.subject.text
      case 'human-action': return t(item.actionKind === 'approval' ? 'detail.approval' : 'detail.question')
      default: return assertNever(item)
    }
  }
  return <section className={`${css.previewCard} ${total !== undefined && total > 0 ? css.attention : ''}`}
    data-empty={preview && total === 0 && state?.error === undefined && !state?.loading || undefined}
    aria-label={t('workspace.attention')} data-team-attention={preview ? 'preview' : 'list'} aria-busy={state?.loading || undefined}>
    <div className={css.cardHeader}><h2>{t('overview.attention')}</h2><span>{total ?? '—'}</span></div>
    {!preview && counts !== undefined && <p className={css.emptyPreview}>{t('attention.categories', { recovery: counts.recovery, humanActions: counts.humanActions, reviews: counts.reviews })}</p>}
    {(state?.loading || state === undefined && read !== undefined) && <p role="status" className={css.emptyPreview}>{t('attention.loading')}</p>}
    {state?.disconnected && <p role="status" className={css.emptyPreview}>{t('attention.disconnected')}</p>}
    {state?.hasNewer && <p role="status" className={css.emptyPreview}>{t('attention.newer')}</p>}
    {state?.error !== undefined && <p role="alert" className={css.headerError}>{state.error}</p>}
    {error !== undefined && <p role="alert" className={css.headerError}>{error}</p>}
    {read === undefined && <p role="status" className={css.emptyPreview}>{t('attention.unavailable')}</p>}
    {(total === 0 || page !== undefined && page.items.length === 0) && !state?.loading
      && state?.error === undefined && <p className={css.emptyPreview}>
      {t(total === 0 ? 'overview.noAttention' : 'attention.noPreview')}</p>}
    {page !== undefined && <ul className={css.attentionList}>{page.items.map(item => <li key={JSON.stringify([item.kind, item.id])}>
      <button type="button" className={css.textLink} disabled={item.kind === 'human-action' && (openAction === undefined || opening !== undefined)}
        onClick={() => { open(item) }}>{label(item)}</button>
      <small>{t(`attention.kind.${item.kind}`)} · {t(item.handling.kind === 'actionable' ? 'attention.actionable' : `attention.wait.${item.handling.reason}`)}</small>
      {(item.kind === 'team-recovery' || item.kind === 'task-recovery') && item.reason !== undefined && <p>{item.reason.message.text}</p>}
    </li>)}</ul>}
    <div className={css.pendingControls}>
      {read !== undefined && <Button size="sm" disabled={state?.loading || state?.disconnected}
        onClick={() => { run(async () => { await read('first') }) }}>{t(preview ? 'attention.refreshPreview' : 'attention.refresh')}</Button>}
      {preview && total !== undefined && total > 0 && viewAll !== undefined && <Button size="sm" onClick={viewAll}>{t('attention.viewAll')}</Button>}
      {!preview && read !== undefined && <Button size="sm" disabled={state?.loading || state?.disconnected || state?.hasNewer
        || state?.error !== undefined || page?.nextCursor === undefined}
      onClick={() => { run(async () => { await read('next') }) }}>{t('attention.next')}</Button>}
    </div>
  </section>
}

/** Closed responsibility kinds require navigation and labels when extended. */
function assertNever(value: never): never { throw new Error(`Unhandled pending responsibility: ${String(value)}`) }
