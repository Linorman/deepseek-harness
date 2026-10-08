/** Team mode tile for the blank hero: recent Teams orbiting the hub, with loaded counts. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@clocky/clocky-client-ui-slots'
import type { ObservableSnapshot, TeamId, TeamTaskListState } from '@clocky/clocky-client-runtime/client'
import { ModeTile, navigateWithTransition, SwarmGlyph } from '@clocky/clocky-client-ui-viz'
import { teamPhaseKey } from './locales.ts'
import { deriveShortTitle, relativeTime, sortTeams, teamStatus } from './team-row.ts'

/** Registrant-private inject share for the card. */
export interface TeamModeCardInjected {
  /** Open one Team, or the Team workspace when none exists. */
  open: (teamId?: TeamId) => void
  hooks: { tasks: ObservableSnapshot<TeamTaskListState> }
}

type Props = PropsRuntime<'conversation.hero.modes'> & InjectFace<TeamModeCardInjected> & PropsLocale<'team'>

/**
 * Render the tile. Counts cover the loaded Team page only; a further page
 * shows as "N+", and each satellite is one loaded Team in its phase color.
 * @param props - The Team list hook, an open action, and Team copy.
 * @returns a tile that opens the latest Team.
 */
export function TeamModeCard({ useTasks, open, t }: Props) {
  const items = useTasks(state => state.items)
  const loaded = useTasks(state => state.phase === 'ready')
  const more = useTasks(state => state.nextCursor !== undefined)
  const recent = sortTeams(items)
  const latest = recent[0]
  const running = items.filter(team => team.phase === 'active' || team.phase === 'quiescing' || team.phase === 'provisioning').length
  const stalled = items.filter(team => team.phase === 'stalled').length
  const count = `${String(items.length)}${more ? '+' : ''}`
  const time = latest === undefined ? undefined : relativeTime(latest.updatedAt, Date.now())
  return <ModeTile mode="team" eyebrow={t('mode.team.eyebrow')} title={t('mode.team.title')} tagline={t('mode.team.tagline')}
    label={`${t('mode.team.title')} · ${t('mode.team.open')}`} transitionName="clocky-mode-team"
    onOpen={() => { navigateWithTransition(() => { open(latest?.id) }, 'page') }}
    stats={loaded ? [
      { id: 'running', value: String(running), label: t('mode.team.stat.running'), tone: running > 0 ? 'running' : undefined },
      { id: 'total', value: count, label: t('mode.team.stat.total') },
      ...stalled > 0 ? [{ id: 'stalled', value: String(stalled), label: t('mode.team.stat.stalled'), tone: 'needs-you' as const }] : [],
    ] : []}
    recent={!loaded ? t('mode.team.loading') : latest === undefined || time === undefined ? t('mode.team.none')
      : t('mode.team.recent', { title: deriveShortTitle(latest.goal.objective), phase: t(teamPhaseKey[latest.phase]), time: t(time.key, { count: time.count }) })}
    preview={<SwarmGlyph label={t('mode.team.preview', { count: recent.length })}
      satellites={recent.slice(0, 18).map(team => ({ id: team.id, state: teamStatus(team.phase) }))} />} />
}
