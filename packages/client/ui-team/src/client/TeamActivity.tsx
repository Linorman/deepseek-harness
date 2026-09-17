/** Bounded recent Team-journal activity, refreshed explicitly without disrupting a reader. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { TeamAuditList } from '@clocky/clocky-client-runtime/client'
import type { TeamPageProps } from './TeamPage.tsx'
import type { TeamKey } from './locales.ts'
import css from './TeamWorkspace.module.css'

const eventLabels: Readonly<Record<string, TeamKey>> = {
  'team/created': 'overview.event.created', 'team/phase': 'overview.event.state',
  'task/changed': 'overview.event.task', 'participant/changed': 'overview.event.member',
  'activation/bound': 'overview.event.activation', 'team/final-admitted': 'overview.event.result',
  'team/cancellation': 'overview.event.cancellation', 'goal/changed': 'overview.event.goal',
}

/**
 * Read a small suffix of the authoritative Team journal using its source cursor.
 * @param props - current Team, read callback, labels, and audit navigation.
 * @returns recent events with explicit refresh and error recovery.
 */
export function TeamActivity({ state, translate: t, readAudit, inspect }: Pick<TeamPageProps, 'state' | 'translate' | 'readAudit'> & { inspect: (cursor: number) => void }) {
  const [page, setPage] = useState<TeamAuditList>()
  const [cursor, setCursor] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const request = useRef<AbortController>()
  const latest = useRef({ readAudit, cursor: state.team.cursor })
  latest.current = { readAudit, cursor: state.team.cursor }
  const refresh = async () => {
    const current = latest.current
    if (current.readAudit === undefined) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(undefined)
    try {
      const result = await current.readAudit({ afterCursor: Math.max(-1, current.cursor - 8), limit: 8 }, controller.signal)
      if (!controller.signal.aborted) { setPage(result); setCursor(current.cursor) }
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => { void refresh(); return () => { request.current?.abort() } }, [state.team.id])
  const items = page?.items.slice(-5).reverse() ?? []
  const label = (entry: TeamAuditList['items'][number]) => {
    const event = t(eventLabels[entry.type] ?? 'overview.event.state')
    const task = entry.facts.task
    if (task !== null && typeof task === 'object' && !Array.isArray(task) && 'subject' in task && typeof task.subject === 'string') return `${task.subject} · ${event}`
    const member = entry.facts.participant
    if (member !== null && typeof member === 'object' && !Array.isArray(member) && 'displayName' in member && typeof member.displayName === 'string') return `${member.displayName} · ${event}`
    return event
  }
  return <section className={css.previewCard} aria-label={t('overview.activity')}>
    <div className={css.cardHeader}><h2>{t('overview.activity')}</h2>
      {readAudit !== undefined && <Button size="sm" disabled={busy} onClick={() => { void refresh() }}>{t(cursor < state.team.cursor ? 'overview.refreshActivity' : 'detail.refresh')}</Button>}
    </div>
    {busy && <p className={css.emptyPreview} role="status">{t('detail.auditLoading')}</p>}
    {error !== undefined && <p className={css.headerError} role="alert">{error}</p>}
    <ol className={css.activity}>{items.map(entry => <li key={entry.cursor}>
      <button type="button" className={css.textLink} title={entry.type} onClick={() => { inspect(entry.cursor) }}>{label(entry)}</button>
      <time dateTime={new Date(entry.createdAt).toISOString()}>{new Intl.DateTimeFormat(t('channel.dateLocale'), { hour: '2-digit', minute: '2-digit' }).format(entry.createdAt)}</time>
    </li>)}</ol>
    {!busy && items.length === 0 && error === undefined && <p className={css.emptyPreview}>{t(readAudit === undefined ? 'workspace.unavailable' : 'overview.noActivity')}</p>}
  </section>
}
