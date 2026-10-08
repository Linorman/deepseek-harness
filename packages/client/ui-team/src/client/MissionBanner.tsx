/** Mission banner: authoritative progress, live parallelism, elapsed time, and token use. */
import { useEffect, useState } from 'react'
import { Moment, Odometer, RadialProgress, useLiveTransition } from '@clocky/clocky-client-ui-viz'
import type { TeamPageProps } from './TeamPage.tsx'
import { progressSegments } from './team-viz.ts'
import css from './TeamViz.module.css'

type Props = Pick<TeamPageProps, 'state' | 'translate'>

/** Format a duration as `h:mm:ss` (or `d天 h:mm:ss` beyond a day) with tabular digits. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor(total % 86_400 / 3600)
  const pad = (value: number) => String(value).padStart(2, '0')
  const clock = `${String(hours)}:${pad(Math.floor(total % 3600 / 60))}:${pad(total % 60)}`
  return days > 0 ? `${String(days)}d ${clock}` : clock
}

/**
 * Render the banner. Counts come from the Team's authoritative totals; a
 * throughput sparkline needs the execution timeline read and is absent until
 * then rather than estimated. Digits roll and the ring moves only for a live
 * observed change; a live stall or completion plays its moment once.
 * @param props - Team selection and copy.
 * @returns the banner row.
 */
export function MissionBanner({ state, translate: t }: Props) {
  const { team } = state
  const counts = state.counts.tasks
  const { segments, total } = progressSegments(counts, t)
  const running = counts.running + counts.assigned
  const attention = state.attentionCounts?.total
  const usage = state.metadata?.kind === 'available' ? state.metadata.usage : undefined
  const tokens = usage === undefined ? undefined : usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const terminal = team.phase === 'completed' || team.phase === 'failed' || team.phase === 'cancelled'
  const live = useLiveTransition(team.id, team.cursor, JSON.stringify([counts, tokens, attention]))
  const phase = useLiveTransition(team.id, team.cursor, team.phase)
  const [now, setNow] = useState(() => Date.now())
  // The elapsed clock ticks once a second only while the Team runs and the page is visible.
  useEffect(() => {
    if (terminal) return
    const tick = () => { if (document.visibilityState !== 'hidden') setNow(Date.now()) }
    const timer = window.setInterval(tick, 1000)
    return () => { window.clearInterval(timer) }
  }, [terminal])
  const elapsed = formatElapsed((terminal ? team.updatedAt : now) - team.createdAt)
  const locale = t('channel.dateLocale')
  const moment = phase.live && phase.previous !== team.phase
    ? team.phase === 'stalled' ? 'stall' : team.phase === 'completed' ? 'converge' : undefined : undefined
  return <Moment kind={moment ?? 'stall'} generation={moment === undefined ? 0 : phase.generation} className={css.bannerMoment}>
    <dl className={css.banner} aria-label={t('header.progress')} data-mission-banner>
      <RadialProgress segments={segments} total={total} size={60} thickness={6} live={live.live}
        label={t('banner.progress', { done: counts.completed, total })}>
        <span className={css.ringCenter}>{total === 0 ? '—' : `${String(Math.round(counts.completed / total * 100))}%`}</span>
      </RadialProgress>
      <div className={css.metric}><dt>{t('workspace.completed')}</dt>
        <dd><Odometer text={String(counts.completed)} live={live.live} /><small> / {total}</small></dd></div>
      <div className={css.metric}><dt>{t('banner.runningNow')}</dt>
        <dd><Odometer text={String(running)} live={live.live} /></dd></div>
      <div className={css.metric} data-attention={attention !== undefined && attention > 0 || undefined}><dt>{t('workspace.attention')}</dt>
        <dd>{attention === undefined ? <span className={css.metricUnavailable}>—</span>
          : <Odometer text={String(attention)} live={live.live} />}</dd></div>
      <div className={css.metric}><dt>{t('workspace.tokens')}</dt>
        <dd>{tokens === undefined
          ? <span className={css.metricUnavailable} title={t('workspace.unavailable')}>—</span>
          : <Odometer text={new Intl.NumberFormat(locale, { notation: 'compact' }).format(tokens)}
            label={new Intl.NumberFormat(locale).format(tokens)} live={live.live} />}</dd></div>
      <div className={css.metric}><dt>{t('banner.elapsed')}</dt><dd><span>{elapsed}</span></dd></div>
    </dl>
  </Moment>
}
