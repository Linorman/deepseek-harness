import { memberLabels, memberPageLabels, overviewMemberLabels, referencedMemberName } from './member-labels.ts'
/** Team-local execution and attention, with bounded previews of authoritative activity. */
import { useMemo, useState } from 'react'
import { Avatar, Button, StatusBadge } from '@clocky/clocky-client-ui-primitives'
import { memberStatus } from './team-row.ts'
import { TaskBoard } from './TaskBoard.tsx'
import type { TeamArtifactReference, TeamTaskId } from '@clocky/clocky-client-runtime/client'
import type { TeamPageProps } from './TeamPage.tsx'
import type { TeamWorkspaceView } from './workspace-store.ts'
import { TeamAttention } from './TeamAttention.tsx'
import { TeamActivity } from './TeamActivity.tsx'
import { TeamVisualization } from './TeamVisualization.tsx'
import type { SwarmPositions, TeamOverviewViz } from './workspace-store.ts'
import vizCss from './TeamViz.module.css'
import css from './TeamWorkspace.module.css'

type OverviewProps = Pick<TeamPageProps, 'identities' | 'memberReadiness' | 'state' | 'collections' | 'attentionPreview' | 'refreshAttentionPreview'
  | 'openPendingAction' | 'translate' | 'openParticipantSession' | 'readAudit' | 'workflowDetail' | 'readWorkflowDetail'> & {
    channelListState?: TeamPageProps['channelListState'] | undefined
    channelState?: TeamPageProps['channelState'] | undefined
    viz?: TeamOverviewViz | undefined
    onVizChange?: ((viz: TeamOverviewViz) => void) | undefined
    swarmPositions?: SwarmPositions | undefined
    onSwarmPositions?: ((positions: SwarmPositions) => void) | undefined
    artifacts: readonly TeamArtifactReference[]
    openTask: (taskId: TeamTaskId) => void
    openMember?: ((id: import('@clocky/clocky-client-runtime/client').ParticipantId) => void) | undefined
    navigate: (view: TeamWorkspaceView) => void
    openArtifact?: (artifact: TeamArtifactReference) => void
    inspectActivity: (cursor: number) => void
  }

/**
 * Present Team state without confusing bounded previews with aggregate counts.
 * @param props - complete Team state, bounded artifact references, and existing navigation/action owners.
 * @returns the operational overview with attention, members, activity, and artifacts.
 */
export function TeamOverview({ identities, memberReadiness, state, collections, attentionPreview, refreshAttentionPreview,
  openPendingAction, translate: t,
  openParticipantSession, readAudit, artifacts, openTask, openMember, navigate, openArtifact, inspectActivity,
  channelListState, channelState, workflowDetail, readWorkflowDetail, viz = 'topology', onVizChange, swarmPositions, onSwarmPositions,
}: OverviewProps) {
  const [error, setError] = useState<string>()
  const tasks = useMemo(() => (collections?.tasks.items ?? []).filter(task => task.phase !== 'deleted'), [collections?.tasks.items])
  const counts = state.counts.tasks
  const participants = memberLabels(state, memberPageLabels(collections?.members.items ?? []))
  const preview = attentionPreview?.teamId === state.team.id ? attentionPreview : undefined
  const attentionCounts = preview?.page !== undefined && preview.page.teamCursor >= state.team.cursor
    ? preview.page.counts : state.attentionCounts
  const usage = state.metadata?.kind === 'available' ? state.metadata.usage : undefined
  const tokens = usage === undefined ? undefined : usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const members = overviewMemberLabels(state, memberPageLabels(collections?.members.items ?? []))
  const run = (operation: () => Promise<unknown>) => {
    setError(undefined)
    void operation().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return <div className={css.overview} data-team-overview>
    {/* The swarm is the first image, with what needs a person beside it. The
        rail comes first in the DOM so attention still leads for assistive tech;
        grid areas place the visualization on the left. */}
    <div className={vizCss.overviewTop}>
      <div className={vizCss.attentionRail}>
        <div className={css.needsYou}>
          <TeamAttention preview state={preview} counts={attentionCounts} translate={t}
            read={refreshAttentionPreview === undefined ? undefined : async () => { await refreshAttentionPreview(state.team.id) }}
            viewAll={() => { navigate('attention') }} openTask={openTask} openRecovery={() => { navigate('audit') }}
            openAction={openPendingAction === undefined ? undefined : async (id) => { await openPendingAction(state.team.id, id) }} />
        </div>
        <TeamActivity state={state} translate={t} inspect={inspectActivity} {...readAudit === undefined ? {} : { readAudit }} />
      </div>
      <TeamVisualization state={state} collections={collections} memberReadiness={memberReadiness} identities={identities}
        channelListState={channelListState} channelState={channelState} translate={t} tasks={tasks}
        viz={viz} onVizChange={(next) => { onVizChange?.(next) }} positions={swarmPositions} onPositions={onSwarmPositions}
        workflowDetail={workflowDetail} readWorkflowDetail={readWorkflowDetail} openTask={openTask} openMember={openMember} />
    </div>
    <div className={css.overviewMain}>
      <section className={css.execution} aria-label={t('workspace.execution')}>
        <div className={css.cardHeader}><h2>{t('workspace.execution')}</h2><Button size="sm" onClick={() => { navigate('tasks') }}>{t('overview.viewAll')}</Button></div>
        <TaskBoard teamId={state.team.id} cursor={state.team.cursor} tasks={tasks} counts={counts} openTask={openTask} translate={t}
          ownerName={id => referencedMemberName(id, participants.find(member => member.id === id)?.displayName, identities, t)} />
      </section>
      <div className={css.overviewRail}>

        <section className={css.previewCard} aria-label={t('overview.members')}>
          <div className={css.cardHeader}><h2>{t('overview.members')}</h2><Button size="sm" onClick={() => { navigate('members') }}>{t('overview.viewAll')}</Button></div>
          <ul className={css.memberLanes}>{members.map((member) => {
            const execution = memberReadiness?.value?.items.find(item => item.participantId === member.id)
            const stale = memberReadiness?.error !== undefined || memberReadiness?.disconnected === true
              || memberReadiness?.value !== undefined && memberReadiness.value.teamCursor < state.team.cursor
            const participation = t(`detail.participant.phase.${execution?.participation ?? member.phase}`)
            const readiness = t(execution === undefined ? 'readiness.unavailable' : `readiness.state.${execution.state}`)
            return <li key={member.id} className={css.memberLane} data-stale={stale || undefined}>
              <span className={vizCss.pod} data-state={memberStatus(execution?.state)} data-stale={stale || undefined}
                title={t('pod.ring', { name: member.displayName, state: readiness })}>
                <Avatar name={member.displayName} role={member.role} decorative />
              </span>
              <div className={css.laneText}>
                {openMember === undefined
                  ? <strong>{member.displayName}</strong>
                  : <button type="button" className={css.laneName} onClick={() => { openMember(member.id) }}>{member.displayName}</button>}
                <span className={css.laneMeta}>
                  <small title={participation}>{member.role}</small>
                  <StatusBadge status={memberStatus(execution?.state)} title={`${participation} · ${t('readiness.execution')}`}>
                    {stale ? `${readiness} · ${t('readiness.stale')}` : readiness}
                  </StatusBadge>
                </span>
              </div>
              {openParticipantSession !== undefined && <Button size="sm" aria-label={`${t('taskView.openSession')} ${member.displayName}`}
                onClick={() => { run(async () => { await openParticipantSession(member.id) }) }}>{t('detail.openSession')}</Button>}
            </li>
          })}</ul>
          {members.length === 0 && <p className={css.emptyPreview}>{t('overview.noMembers')}</p>}
        </section>
        <section className={css.previewCard} aria-label={t('overview.artifacts')}>
          <div className={css.cardHeader}><h2>{t('overview.artifacts')}</h2><Button size="sm" onClick={() => { navigate('artifacts') }}>{t('overview.viewAll')}</Button></div>
          <ul className={css.artifactPreview}>{artifacts.slice(0, 3).map(artifact => <li key={artifact.id}>
            <button className={css.textLink} type="button" disabled={openArtifact === undefined || artifact.provider === undefined}
              onClick={() => { openArtifact?.(artifact) }}>{artifact.uri.split('/').at(-1) || artifact.id}</button><small>{artifact.kind}</small>
          </li>)}</ul>
          {artifacts.length === 0 && <p className={css.emptyPreview}>{t('overview.noArtifacts')}</p>}
        </section>
      </div>
    </div>
    <details className={css.usageDetails}>
      <summary>{t('overview.usageDetails')} · {tokens === undefined ? '—' : new Intl.NumberFormat(t('channel.dateLocale')).format(tokens)} {t('workspace.tokens')}</summary>
      <p>{t(tokens === undefined ? 'workspace.unavailable' : 'workspace.subtree')}</p>
      <dl className={css.usageSummary}>
        <div><dt>{t('workspace.tokens')}</dt><dd>{tokens === undefined ? '—' : new Intl.NumberFormat(t('channel.dateLocale')).format(tokens)}</dd></div>
        {usage !== undefined && <>
          <div><dt>{t('overview.input')}</dt><dd>{usage.inputTokens}</dd></div>
          <div><dt>{t('overview.output')}</dt><dd>{usage.outputTokens}</dd></div>
          <div><dt>{t('overview.cacheRead')}</dt><dd>{usage.cacheReadTokens}</dd></div>
          <div><dt>{t('overview.cacheWrite')}</dt><dd>{usage.cacheWriteTokens}</dd></div>
          <div><dt>{t('overview.turns')}</dt><dd>{usage.turns}</dd></div>
          <div><dt>{t('overview.cost')}</dt><dd>{usage.costUnits}</dd></div>
        </>}
      </dl>
    </details>
    {error !== undefined && <p className={css.headerError} role="alert">{error}</p>}
  </div>
}
