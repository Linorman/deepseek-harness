import { memberLabels, memberPageLabels } from './member-labels.ts'
/** Team-local execution and attention, with bounded previews of authoritative activity. */
import { useMemo, useState } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { TeamArtifactReference, TeamTaskId } from '@clocky/clocky-client-runtime/client'
import type { TeamPageProps } from './TeamPage.tsx'
import type { TeamWorkspaceView } from './workspace-store.ts'
import { HumanActionCard } from './HumanActionCard.tsx'
import { TeamActivity } from './TeamActivity.tsx'
import css from './TeamWorkspace.module.css'

type OverviewProps = Pick<TeamPageProps, 'state' | 'collections' | 'humanActions' | 'translate' | 'pendingActions' | 'respondAction' | 'openActionContext' | 'openParticipantSession' | 'readAudit'> & {
  artifacts: readonly TeamArtifactReference[]
  openTask: (taskId: TeamTaskId) => void
  navigate: (view: TeamWorkspaceView) => void
  openArtifact?: (artifact: TeamArtifactReference) => void
  inspectActivity: (cursor: number) => void
}

/**
 * Present Team state without confusing bounded previews with aggregate counts.
 * @param props - complete Team state, bounded artifact references, and existing navigation/action owners.
 * @returns the operational overview with attention, members, activity, and artifacts.
 */
export function TeamOverview({ state, collections, humanActions = [], translate: t, pendingActions = [], respondAction, openActionContext,
  openParticipantSession, readAudit, artifacts, openTask, navigate, openArtifact, inspectActivity }: OverviewProps) {
  const [error, setError] = useState<string>()
  const [showAllActions, setShowAllActions] = useState(false)
  const tasks = useMemo(() => (collections?.tasks.items ?? []).filter(task => task.phase !== 'deleted'), [collections?.tasks.items])
  const counts = state.counts.tasks
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0) - counts.deleted
  const participants = memberLabels(state, memberPageLabels(collections?.members.items ?? []))
  const completed = counts.completed
  const running = counts.running + counts.assigned
  const reviews = tasks.filter(task => task.phase === 'review')
  const pending = humanActions.filter(action => action.phase === 'pending')
  const durableSources = new Set<string>(humanActions.map(action => action.sourceId))
  const legacy = pendingActions.filter(action => !durableSources.has(action.kind === 'approval' ? action.approvalId : action.questionRpcId))
  const attentionCount = (state.pendingHumanActionCount ?? (pending.length + legacy.length)) + counts.review + (state.team.phase === 'stalled' ? 1 : 0)
  const usage = state.metadata?.kind === 'available' ? state.metadata.usage : undefined
  const tokens = usage === undefined ? undefined : usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const visible = [...tasks].sort((a, b) => {
    const rank = { running: 0, review: 1, assigned: 2, failed: 3, pending: 4, completed: 5, cancelled: 6, deleted: 7 }
    return rank[a.phase] - rank[b.phase]
  }).slice(0, 6)
  const members = participants.filter(member => member.kind !== 'human' && member.phase !== 'left')
    .sort((a, b) => Number(b.role === 'coordinator') - Number(a.role === 'coordinator')).slice(0, 4)
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
      <div><dt>{t('workspace.attention')}</dt><dd>{attentionCount}</dd></div>
      <div><dt>{t('workspace.tokens')}</dt><dd>{tokens === undefined ? '—' : new Intl.NumberFormat(t('channel.dateLocale')).format(tokens)}</dd>
        <small>{t(tokens === undefined ? 'workspace.unavailable' : 'workspace.subtree')}</small>
        {usage !== undefined && <details className={css.usageDetails}><summary>{t('overview.usageDetails')}</summary>
          <dl><dt>{t('overview.input')}</dt><dd>{usage.inputTokens}</dd><dt>{t('overview.output')}</dt><dd>{usage.outputTokens}</dd>
            <dt>{t('overview.cacheRead')}</dt><dd>{usage.cacheReadTokens}</dd><dt>{t('overview.cacheWrite')}</dt><dd>{usage.cacheWriteTokens}</dd>
            <dt>{t('overview.turns')}</dt><dd>{usage.turns}</dd><dt>{t('overview.cost')}</dt><dd>{usage.costUnits}</dd></dl>
        </details>}
      </div>
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
              <td>{participants.find(member => member.id === owner)?.displayName ?? t('detail.task.unassigned')}</td>
              <td><span className={css.state} data-phase={task.phase}>{phaseLabel(task)}</span></td></tr>
          })}</tbody>
        </table>}
      </section>
      <div className={css.overviewRail}>
        <section className={`${css.previewCard} ${attentionCount > 0 ? css.attention : ''}`} aria-label={t('detail.humanActions')}>
          <div className={css.cardHeader}><h2>{t('overview.attention')}</h2><span>{attentionCount}</span></div>
          {attentionCount === 0 && <p className={css.emptyPreview}>{t('overview.noAttention')}</p>}
          {state.team.phase === 'stalled' && <p className={css.stalled}>{t('overview.stalled')}</p>}
          <ul className={css.attentionList}>
            {pending.slice(0, showAllActions ? undefined : 3).map(action => <li key={String(action.id)}>
              <details><summary>{t(action.kind === 'approval' ? 'detail.approval' : 'detail.question')}</summary>
                {respondAction === undefined ? <p>{t('detail.pending')}</p> : <HumanActionCard action={action} translate={t} respond={respondAction}
                  {...openActionContext === undefined ? {} : { openContext: openActionContext }} />}
              </details>
            </li>)}
            {legacy.slice(0, showAllActions ? undefined : 2).map(action => <li key={action.requestId}>{t(action.kind === 'approval' ? 'detail.approval' : 'detail.question')}
              {action.kind === 'approval' ? ` · ${action.toolName}` : ''}
            </li>)}
            {reviews.slice(0, showAllActions ? undefined : 3).map(task => <li key={task.id}><button className={css.textLink} type="button" onClick={() => { openTask(task.id) }}>{task.subject.text}</button><small>{t('detail.task.phase.review')}</small></li>)}
          </ul>
          {(pending.length > 3 || legacy.length > 2 || reviews.length > 3) && <Button size="sm" onClick={() => { setShowAllActions(value => !value) }}>{t(showAllActions ? 'overview.collapse' : 'overview.viewAll')}</Button>}
        </section>
        <section className={css.previewCard} aria-label={t('overview.members')}>
          <div className={css.cardHeader}><h2>{t('overview.members')}</h2><Button size="sm" onClick={() => { navigate('members') }}>{t('overview.viewAll')}</Button></div>
          <ul className={css.memberPreview}>{members.map((member) => {
            const binding = state.coordinator.kind === 'bound' && state.coordinator.binding.activation.participantId === member.id ? state.coordinator.binding : undefined
            const working = tasks.some(task => task.ownerId === member.id && (task.phase === 'running' || task.phase === 'assigned'))
            const status = working ? t('workspace.running') : binding === undefined ? t(`detail.participant.phase.${member.phase}`) : t(`detail.activation.${binding.activation.status}`)
            return <li key={member.id}><div><strong>{member.displayName}</strong><small>{member.role} · {status}</small></div>
              {openParticipantSession !== undefined && <Button size="sm" aria-label={`${t('taskView.openSession')} ${member.displayName}`}
                onClick={() => { run(async () =>{  await openParticipantSession(member.id) }) }}>{t('detail.openSession')}</Button>}</li>
          })}</ul>
          {members.length === 0 && <p className={css.emptyPreview}>{t('overview.noMembers')}</p>}
        </section>
      </div>
    </div>
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
