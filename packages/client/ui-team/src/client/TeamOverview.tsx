import { MemberReference } from './MemberReference.tsx'
import { MemberReadiness } from './MemberReadiness.tsx'
import { memberLabels, memberPageLabels, overviewMemberLabels } from './member-labels.ts'
/** Team-local execution and attention, with bounded previews of authoritative activity. */
import { useMemo, useState } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { TeamArtifactReference, TeamTaskId } from '@clocky/clocky-client-runtime/client'
import type { TeamPageProps } from './TeamPage.tsx'
import type { TeamWorkspaceView } from './workspace-store.ts'
import { TeamAttention } from './TeamAttention.tsx'
import { TeamActivity } from './TeamActivity.tsx'
import css from './TeamWorkspace.module.css'

type OverviewProps = Pick<TeamPageProps, 'identities' | 'memberReadiness' | 'state' | 'collections' | 'attentionPreview' | 'refreshAttentionPreview' | 'openPendingAction' | 'translate' | 'openParticipantSession' | 'readAudit'> & {
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
}: OverviewProps) {
  const [error, setError] = useState<string>()
  const tasks = useMemo(() => (collections?.tasks.items ?? []).filter(task => task.phase !== 'deleted'), [collections?.tasks.items])
  const counts = state.counts.tasks
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0) - counts.deleted
  const participants = memberLabels(state, memberPageLabels(collections?.members.items ?? []))
  const completed = counts.completed
  const running = counts.running + counts.assigned
  const preview = attentionPreview?.teamId === state.team.id ? attentionPreview : undefined
  const attentionCounts = preview?.page !== undefined && preview.page.teamCursor >= state.team.cursor
    ? preview.page.counts : state.attentionCounts
  const attentionCount = attentionCounts?.total
  const usage = state.metadata?.kind === 'available' ? state.metadata.usage : undefined
  const tokens = usage === undefined ? undefined : usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const visible = [...tasks].sort((a, b) => {
    const rank = { running: 0, review: 1, assigned: 2, failed: 3, pending: 4, completed: 5, cancelled: 6, deleted: 7 }
    return rank[a.phase] - rank[b.phase]
  }).slice(0, 6)
  const members = overviewMemberLabels(state, memberPageLabels(collections?.members.items ?? []))
  const groups = (['completed', 'running', 'assigned', 'pending', 'review', 'failed', 'cancelled'] as const)
    .map(phase => ({ phase, count: counts[phase] })).filter(group => group.count > 0)
  const run = (operation: () => Promise<unknown>) => {
    setError(undefined)
    void operation().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const phaseLabel = (task: typeof tasks[number]) => t(task.cancellationRequested && (task.phase === 'running' || task.phase === 'assigned')
    ? 'detail.task.phase.stopping' : `detail.task.phase.${task.phase}`)
  return <div className={css.overview} data-team-overview>
    <dl className={css.metrics}>
      <div><dt>{t('workspace.completed')}</dt><dd>{completed}<small> / {total}</small></dd></div>
      <div><dt>{t('workspace.running')}</dt><dd>{running}</dd></div>
      <div><dt>{t('workspace.attention')}</dt><dd>{attentionCount ?? '—'}</dd></div>
    </dl>
    <div className={css.overviewMain}>
      <section className={css.execution} aria-label={t('workspace.execution')}>
        <div className={css.cardHeader}><h2>{t('workspace.execution')}</h2><Button size="sm" onClick={() => { navigate('tasks') }}>{t('overview.viewAll')}</Button></div>
        {total > 0 && <>
          <div className={css.distribution} aria-hidden="true">{groups.map(group => <span key={group.phase} data-phase={group.phase} style={{ flexGrow: group.count }} />)}</div>
          <ul className={css.legend}>{groups.map(group => <li key={group.phase}><span className={css.state} data-phase={group.phase}>{t(`detail.task.phase.${group.phase}`)} {group.count}</span></li>)}</ul>
        </>}
        {visible.length === 0 ? <p className={css.emptyPreview}>{t('workspace.noTasks')}</p> : <table className={css.taskTable}>
          <thead><tr><th>{t('workspace.tasks')}</th><th>{t('detail.task.owner')}</th><th>{t('taskView.status')}</th></tr></thead>
          <tbody>{visible.map((task) => {
            const owner = task.ownerId
            return <tr key={task.id}><td><button className={css.textLink} type="button" onClick={() => { openTask(task.id) }}>{task.subject.text}</button></td>
              <td><MemberReference id={owner} loadedName={participants.find(member => member.id === owner)?.displayName}
                identities={identities} inspect={openMember} translate={t} className={css.textLink} /></td>
              <td><span className={css.state} data-phase={task.phase}>{phaseLabel(task)}</span></td></tr>
          })}</tbody>
        </table>}
      </section>
      <div className={css.overviewRail}>
        <TeamAttention preview state={preview} counts={attentionCounts} translate={t}
          read={refreshAttentionPreview === undefined ? undefined : async () => { await refreshAttentionPreview(state.team.id) }}
          viewAll={() => { navigate('attention') }} openTask={openTask} openRecovery={() => { navigate('audit') }}
          openAction={openPendingAction === undefined ? undefined : async (id) => { await openPendingAction(state.team.id, id) }} />
        <section className={css.previewCard} aria-label={t('overview.members')}>
          <div className={css.cardHeader}><h2>{t('overview.members')}</h2><Button size="sm" onClick={() => { navigate('members') }}>{t('overview.viewAll')}</Button></div>
          <ul className={css.memberPreview}>{members.map((member) => {
            const execution = memberReadiness?.value?.items.find(item => item.participantId === member.id)
            return <li key={member.id}><div><strong>{member.displayName}</strong><small>{member.role} · {t(`detail.participant.phase.${execution?.participation ?? member.phase}`)}</small>
              <MemberReadiness value={execution} stale={memberReadiness?.error !== undefined || memberReadiness?.disconnected === true
                || memberReadiness?.value !== undefined && memberReadiness.value.teamCursor < state.team.cursor} translate={t} /></div>
            {openParticipantSession !== undefined && <Button size="sm" aria-label={`${t('taskView.openSession')} ${member.displayName}`}
              onClick={() => { run(async () =>{  await openParticipantSession(member.id) }) }}>{t('detail.openSession')}</Button>}</li>
          })}</ul>
          {members.length === 0 && <p className={css.emptyPreview}>{t('overview.noMembers')}</p>}
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
    <div className={css.overviewSecondary}>
      <TeamActivity state={state} translate={t} inspect={inspectActivity} {...readAudit === undefined ? {} : { readAudit }} />
      <section className={css.previewCard} aria-label={t('overview.artifacts')}>
        <div className={css.cardHeader}><h2>{t('overview.artifacts')}</h2><Button size="sm" onClick={() => { navigate('artifacts') }}>{t('overview.viewAll')}</Button></div>
        <ul className={css.artifactPreview}>{artifacts.slice(0, 3).map(artifact => <li key={artifact.id}>
          <button className={css.textLink} type="button" disabled={openArtifact === undefined || artifact.provider === undefined}
            onClick={() => { openArtifact?.(artifact) }}>{artifact.uri.split('/').at(-1) || artifact.id}</button><small>{artifact.kind}</small>
        </li>)}</ul>
        {artifacts.length === 0 && <p className={css.emptyPreview}>{t('overview.noArtifacts')}</p>}
      </section>
    </div>
    {error !== undefined && <p className={css.headerError} role="alert">{error}</p>}
  </div>
}
