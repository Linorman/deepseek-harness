/** Bounded recent Team-journal activity that follows pushed Team changes; reload stays in the card menu. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { IconButton, IconEllipsisOutline16, Menu } from '@clocky/clocky-client-ui-primitives'
import { relativeTime } from './team-row.ts'
import type { TeamAuditList } from '@clocky/clocky-client-runtime/client'
import type { TeamPageProps } from './TeamPage.tsx'
import type { TeamKey } from './locales.ts'
import vizCss from './TeamViz.module.css'
import css from './TeamWorkspace.module.css'

/** Live arrivals above this count merge into one burst entry instead of staggering. */
const BURST = 3

const eventLabels: Readonly<Record<string, TeamKey>> = {
  'team/created': 'overview.event.created', 'team/phase': 'overview.event.state',
  'task/changed': 'overview.event.task', 'participant/changed': 'overview.event.member',
  'activation/bound': 'overview.event.activation', 'team/final-admitted': 'overview.event.result',
  'team/cancellation': 'overview.event.cancellation', 'goal/changed': 'overview.event.goal',
}

/**
 * Read a small suffix of the authoritative Team journal using its source cursor.
 * @param props - current Team, read callback, labels, and audit navigation.
 * The suffix rereads shortly after each pushed Team cursor advance, so the
 * feed is live without a refresh control; the card menu keeps an explicit
 * reload for recovery.
 * @returns recent events with error recovery.
 */
export function TeamActivity({ state, translate: t, readAudit, inspect }: Pick<TeamPageProps, 'state' | 'translate' | 'readAudit'> & { inspect: (cursor: number) => void }) {
  const [page, setPage] = useState<TeamAuditList>()
  const [cursor, setCursor] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [error, setError] = useState<string>()
  const request = useRef<AbortController>()
  const latest = useRef({ readAudit, cursor: state.team.cursor })
  // Entries newer than this cursor arrived through a live pushed advance.
  const seenTop = useRef<{ teamId: string; cursor: number } | undefined>()
  const liveRead = useRef(false)
  const [fresh, setFresh] = useState<readonly number[]>([])
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
      if (!controller.signal.aborted) {
        const top = Math.max(-1, ...result.items.map(item => item.cursor))
        const prior = seenTop.current?.teamId === state.team.id ? seenTop.current.cursor : undefined
        // Only a read triggered by a pushed cursor advance is live; first loads and manual reloads settle.
        setFresh(liveRead.current && prior !== undefined ? result.items.filter(item => item.cursor > prior).map(item => item.cursor) : [])
        seenTop.current = { teamId: state.team.id, cursor: Math.max(top, prior ?? -1) }
        liveRead.current = false
        setPage(result); setCursor(current.cursor)
      }
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => { void refresh(); return () => { request.current?.abort() } }, [state.team.id])
  // Follow pushed journal advances; a short delay coalesces bursts of events.
  useEffect(() => {
    if (cursor === -1 || state.team.cursor <= cursor) return
    const timer = setTimeout(() => { liveRead.current = true; void refresh() }, 400)
    return () => { clearTimeout(timer) }
  }, [state.team.cursor, cursor])
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
      {readAudit !== undefined && <Menu open={menu} portal align="end" onClose={() => { setMenu(false) }}
        anchor={<IconButton size="sm" label={t('overview.activityActions')} aria-expanded={menu} icon={<IconEllipsisOutline16 />}
          onClick={() => { setMenu(value => !value) }} />}
        items={[{ id: 'reload', label: t('overview.reloadFromServer'), disabled: busy }]}
        onSelect={() => { setMenu(false); void refresh() }} />}
    </div>
    {busy && page === undefined && <p className={css.emptyPreview} role="status">{t('detail.auditLoading')}</p>}
    {error !== undefined && <p className={css.headerError} role="alert">{error}</p>}
    {fresh.length > BURST && <p className={`${vizCss.burst} ${vizCss.feedEnter}`} data-motion-tier="L2" key={`burst:${String(fresh.at(-1))}`}>
      {t('feed.burst', { count: fresh.length })}</p>}
    <ol className={css.activity}>{items.map(entry => <li key={entry.cursor}
      className={fresh.length <= BURST && fresh.includes(entry.cursor) ? vizCss.feedEnter : undefined}
      data-motion-tier={fresh.length <= BURST && fresh.includes(entry.cursor) ? 'L2' : undefined}
      style={{ '--stagger': String(Math.max(0, fresh.indexOf(entry.cursor))) } as CSSProperties}>
      <button type="button" className={css.textLink} title={entry.type} onClick={() => { inspect(entry.cursor) }}>{label(entry)}</button>
      <time dateTime={new Date(entry.createdAt).toISOString()}
        title={new Intl.DateTimeFormat(t('channel.dateLocale'), { dateStyle: 'short', timeStyle: 'short' }).format(entry.createdAt)}>
        {(({ key, count }) => t(key, { count }))(relativeTime(entry.createdAt, Date.now()))}
      </time>
    </li>)}</ol>
    {!busy && items.length === 0 && error === undefined && <p className={css.emptyPreview}>{t(readAudit === undefined ? 'workspace.unavailable' : 'overview.noActivity')}</p>}
  </section>
}
