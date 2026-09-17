/** Bounded task list with a single concise, non-modal task inspector. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Input, Menu, IconCloseOutline16, IconChevronDownOutline14 } from '@clocky/clocky-client-ui-primitives'
import type { MenuEntry } from '@clocky/clocky-client-ui-primitives'
import type { TeamArtifactReference, TeamTaskRecord, TeamTaskSummary, TeamTaskDetailState, ITeamTasks } from '@clocky/clocky-client-runtime/client'
import type { TeamPageProps, TeamLoadedContext } from './TeamPage.tsx'
import type { TeamTaskDialogTarget } from './TeamTaskDialog.tsx'
import type { TeamViewState } from './workspace-store.ts'
import css from './TaskWorkspace.module.css'

/** The selected task is resolved against current authoritative records, never a copied object. */
export interface TaskWorkspaceProps {
  state: {
    readonly team: Pick<TeamPageProps['state']['team'], 'id'>
    readonly participants: readonly Pick<TeamLoadedContext['participants'][number], 'id' | 'displayName'>[]
    readonly tasks: readonly Pick<TeamLoadedContext['tasks'][number], 'id' | 'subject'>[]
  }
  tasks: readonly TeamTaskSummary[]
  detail?: TeamTaskDetailState | undefined
  readDetail?: ITeamTasks['readTaskDetail']
  closeDetail?: (() => void) | undefined
  viewState: TeamViewState
  updateView: (patch: Partial<TeamViewState>) => void
  translate: TeamPageProps['translate']
  canManage: boolean
  busy: boolean
  onForm: (target: TeamTaskDialogTarget) => void
  onStop?: (task: TeamTaskRecord) => void
  onDelete?: (task: TeamTaskRecord) => void
  openParticipantSession?: TeamPageProps['openParticipantSession']
  openTeam?: TeamPageProps['openTeam']
  openArtifact?: (artifact: TeamArtifactReference) => void
}

/**
 * Render task navigation and the selected summary without repeating Team management content.
 * @param props - loaded tasks, current authority, controlled view preferences, and authorized callbacks.
 * @returns a task table with an optional summary inspector.
 */
export function TaskWorkspace({ state,
  tasks, detail, readDetail, closeDetail,
  viewState,
  updateView,
  translate: t,
  canManage,
  busy,
  onForm,
  onStop,
  onDelete,
  openParticipantSession,
  openTeam,
  openArtifact }: TaskWorkspaceProps) {

  const tableScroll = useRef<HTMLDivElement>(null)
  const tablePosition = useRef(viewState.taskListScroll)
  const updateViewRef = useRef(updateView)
  updateViewRef.current = updateView
  useLayoutEffect(() => {
    const element = tableScroll.current
    if (element !== null) element.scrollTop = tablePosition.current
    return () => { updateViewRef.current({ taskListScroll: tablePosition.current }) }
  }, [])
  const [menuOpen, setMenuOpen] = useState(false)
  const [phaseMenuOpen, setPhaseMenuOpen] = useState(false)
  const [error, setError] = useState<string>()
  const query = viewState.taskSearch.trim().toLocaleLowerCase()
  const visible = tasks.filter(task => task.phase !== 'deleted'
    && (viewState.taskPhase === 'all' || task.phase === viewState.taskPhase)
    && task.subject.text.toLocaleLowerCase().includes(query))
  const currentDetail = detail?.teamId === state.team.id && detail.taskId === viewState.taskId ? detail : undefined
  const current = currentDetail?.record.value?.task
  const selected = current?.phase === 'deleted' ? undefined : current
  const ready = currentDetail !== undefined && !currentDetail.hasNewer && !currentDetail.disconnected
    && !currentDetail.record.loading && currentDetail.record.error === undefined
    && !currentDetail.latest.loading && currentDetail.latest.error === undefined
  const mutable = canManage && ready
  useEffect(() => {
    if (viewState.taskId !== undefined) void readDetail?.(state.team.id, viewState.taskId, 'record', 'first')
    else closeDetail?.()
  }, [state.team.id, viewState.taskId, readDetail, closeDetail])
  const previousSelection = useRef(viewState.taskId)
  useLayoutEffect(() => {
    const previous = previousSelection.current
    if (viewState.taskId === undefined && previous !== undefined) {
      const element = tableScroll.current
      if (element !== null) element.scrollTop = tablePosition.current
      const target = document.getElementById(`team-task-${previous}`)?.querySelector('button')
        ?? element?.parentElement?.querySelector('input')
      target?.focus({ preventScroll: true })
    }
    previousSelection.current = viewState.taskId
  }, [viewState.taskId])
  const select = (taskId: TeamTaskRecord['id'] | undefined) => {
    setMenuOpen(false)
    setError(undefined)
    updateView({ taskId })
  }
  const run = (operation: () => Promise<unknown>) => {
    setError(undefined)
    void operation().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }
  const participantName = (id: string | undefined) => state.participants.find(member => member.id === id)?.displayName ?? t('detail.task.unassigned')
  const phaseLabel = (task: Pick<TeamTaskRecord, 'phase'>, stopping: boolean) => t(stopping && (task.phase === 'assigned' || task.phase === 'running')
    ? 'detail.task.phase.stopping' : `detail.task.phase.${task.phase}`)
  const menu: MenuEntry[] = []
  if (selected !== undefined) {
    if (mutable && selected.phase === 'pending' && selected.lease === undefined) menu.push({ id: 'taskUpdate', label: t('taskForm.taskUpdate') })
    if (mutable && selected.phase === 'review') menu.push({ id: 'taskReview', label: t('taskForm.taskReview') })
    if (mutable && selected.phase === 'completed' && currentDetail.latest.value?.outcome.kind === 'completed') menu.push({ id: 'taskIntegrate', label: t('taskForm.taskIntegrate') })
    if (onStop !== undefined && selected.cancellation === undefined && (selected.phase === 'running' || selected.phase === 'assigned')) menu.push({ id: 'stop', label: t('detail.task.stop'), danger: true, disabled: busy || !ready })
    if (onDelete !== undefined && selected.lease === undefined && selected.phase !== 'review') menu.push({ id: 'delete', label: t('detail.task.delete'), danger: true, disabled: busy || !ready })
  }
  return <div className={css.layout} data-task-workspace>
    <div className={css.list}>
      <div className={css.filters}>
        <Input aria-label={t('taskView.search')} placeholder={t('taskView.search')} value={viewState.taskSearch}
          onChange={(event) => { updateView({ taskSearch: event.target.value }) }} />
        {viewState.taskSearch !== '' && <Button size="sm" aria-label={t('taskView.clearSearch')} onClick={() => {
          updateView({ taskSearch: '' })
          tableScroll.current?.parentElement?.querySelector('input')?.focus()
        }}><IconCloseOutline16 /></Button>}
        <div className={css.phaseFilter}>
          <Menu open={phaseMenuOpen} selectedId={viewState.taskPhase} portal
            items={(['all', 'pending', 'assigned', 'running', 'review', 'completed', 'failed', 'cancelled'] as const)
              .map(id => ({ id, label: t(id === 'all' ? 'taskView.all' : `detail.task.phase.${id}`) }))}
            anchor={<Button aria-label={t('taskView.status')} aria-expanded={phaseMenuOpen}
              onClick={() => { setPhaseMenuOpen(value => !value) }}>{t(viewState.taskPhase === 'all' ? 'taskView.all' : `detail.task.phase.${viewState.taskPhase}`)}<IconChevronDownOutline14 /></Button>}
            onClose={() => { setPhaseMenuOpen(false) }} onSelect={(id) => {
              setPhaseMenuOpen(false)
              updateView({ taskPhase: id as TeamViewState['taskPhase'] })
            }} />
        </div>
      </div>
      <div
        ref={tableScroll}
        className={css.tableScroll}
        data-task-scroll
        onScroll={(event) => {
          if (event.currentTarget.getClientRects().length > 0) tablePosition.current = event.currentTarget.scrollTop
        }}>
        <table className={css.table}>
          <thead><tr><th>{t('workspace.tasks')}</th><th>{t('detail.task.owner')}</th><th>{t('taskView.status')}</th><th>{t('detail.task.blockedBy')}</th></tr></thead>
          <tbody>{visible.map(task => <tr key={task.id} id={`team-task-${task.id}`} data-selected={task.id === viewState.taskId || undefined}>
            <td><button type="button" className={css.taskName} aria-pressed={task.id === viewState.taskId} onClick={() => { select(task.id) }}>{task.subject.text}{task.subject.truncated ? '…' : ''}</button></td>
            <td>{participantName(task.ownerId)}</td><td><span className={css.phase} data-phase={task.phase}>
              {phaseLabel(task, task.cancellationRequested)}</span></td>
            <td>{task.dependencyCount === 0 ? t('taskView.none') : <button type="button" className={css.link}
              aria-label={t('taskView.inspectDependencies', { count: task.dependencyCount })}
              onClick={() => { select(task.id) }}>{task.dependencyCount}</button>}</td>
          </tr>)}</tbody>
        </table>
        {visible.length === 0 && <div className={css.empty}><p>{t(tasks.length === 0 ? 'workspace.noTasks' : 'taskView.noResults')}</p>
          {tasks.length > 0 && <Button onClick={() => { updateView({ taskSearch: '', taskPhase: 'all' }) }}>{t('taskView.clearFilters')}</Button>}</div>}
      </div>
      <p className={css.count}>{t('taskView.loaded', { count: tasks.length })}</p>
    </div>
    {viewState.taskId !== undefined && <aside data-task-inspector className={css.inspector} aria-label={t('taskView.summary')}>
      <div className={css.inspectorHeader}><strong>{t('taskView.summary')}</strong><Button data-task-close size="sm" aria-label={t('taskView.close')} onClick={() => {
        select(undefined)
      }}><IconCloseOutline16 /></Button></div>
      {readDetail === undefined && <p>{t('taskView.unavailable')}</p>}
      {readDetail !== undefined && (currentDetail === undefined || currentDetail.record.loading) && <p role="status">{t('taskView.loading')}</p>}
      {currentDetail?.record.error !== undefined && <p className={css.error} role="alert">{currentDetail.record.error}</p>}
      {currentDetail?.hasNewer && <p role="status">{t('taskView.changed')}</p>}
      {currentDetail?.disconnected && <p role="status">{t('taskView.disconnected')}</p>}
      {current?.phase === 'deleted' && <p>{t('taskView.deleted')}</p>}
      <Button size="sm" disabled={currentDetail?.record.loading || currentDetail?.latest.loading || readDetail === undefined}
        onClick={() => { if (viewState.taskId !== undefined) void readDetail?.(state.team.id, viewState.taskId) }}>{t('taskView.refresh')}</Button>
      {selected !== undefined && currentDetail !== undefined && <TaskSummary key={selected.id} task={selected} detail={currentDetail}
        readDetail={readDetail} state={state} translate={t}
        owner={participantName(selected.lease?.participantId ?? currentDetail.latest.value?.participantId)}
        phase={phaseLabel(selected, selected.cancellation !== undefined)}
        onDependency={select} openParticipantSession={openParticipantSession} openTeam={openTeam} openArtifact={openArtifact} run={run} />}
      {mutable && selected?.phase === 'review' && <Button variant="primary" onClick={() => { onForm({ kind: 'taskReview', taskId: selected.id }) }}>{t('taskForm.taskReview')}</Button>}
      {selected !== undefined && menu.length > 0 && <Menu open={menuOpen} portal align="end" items={menu}
        anchor={<Button aria-label={t('taskView.actions')} aria-expanded={menuOpen} onClick={() => { setMenuOpen(value => !value) }}>{t('taskView.actions')}<IconChevronDownOutline14 /></Button>}
        onClose={() => { setMenuOpen(false) }} onSelect={(id) => {
          setMenuOpen(false)
          if (id === 'stop') onStop?.(selected)
          else if (id === 'delete') onDelete?.(selected)
          else if (id === 'taskUpdate' || id === 'taskReview' || id === 'taskIntegrate') onForm({ kind: id, taskId: selected.id })
        }} />}
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </aside>}
  </div>
}

/** Summary limits expanded instructions and attempt history to an explicit details disclosure. */
function TaskSummary({ task, detail, readDetail, state, translate: t, owner, phase,
  onDependency, openParticipantSession, openTeam, openArtifact, run }: {
  task: TeamTaskRecord
  detail: TeamTaskDetailState
  readDetail: ITeamTasks['readTaskDetail']
  state: TaskWorkspaceProps['state']
  translate: TeamPageProps['translate']
  owner: string
  phase: string
  onDependency: (id: TeamTaskRecord['id']) => void
  openParticipantSession: TaskWorkspaceProps['openParticipantSession']
  openTeam: TaskWorkspaceProps['openTeam']
  openArtifact: TaskWorkspaceProps['openArtifact']
  run: (operation: () => Promise<unknown>) => void
}) {
  const latest = detail.latest.value
  const attempt = task.lease ?? latest
  const result = latest?.outcome.kind === 'completed' ? latest.outcome.result : undefined
  const artifacts = [...new Map([
    ...(result?.artifacts ?? []), ...(result?.integration?.artifacts ?? []),
    ...(result?.integration?.proposalArtifact === undefined ? [] : [result.integration.proposalArtifact]),
    ...(task.delegation?.result?.artifacts ?? []),
  ].filter(artifact => artifact.visibility !== 'private').map(artifact => [artifact.id, artifact])).values()]
  return <>
    <div className={css.title}><h2>{task.subject}</h2><span className={css.phase} data-phase={task.phase}>{phase}</span></div>
    <p className={css.description}>{task.description}</p>
    <dl className={css.facts}>
      <dt>{t('detail.task.owner')}</dt><dd>{owner}</dd>
      <dt>{t('detail.task.attempts')}</dt><dd>{task.attemptCount} / {task.maxAttempts}</dd>
      <dt>{t('detail.task.blockedBy')}</dt><dd>{task.blockedBy.length === 0 ? t('taskView.none') : task.blockedBy.map(id =>
        <button type="button" key={id} className={css.link} onClick={() => { onDependency(id) }}>{state.tasks.find(item => item.id === id)?.subject ?? t('taskForm.unloadedDependency', { taskId: id })}</button>)}</dd>
    </dl>
    {detail.latest.loading && <p role="status">{t('taskView.latestLoading')}</p>}
    {detail.latest.error !== undefined && <p className={css.error} role="alert">{detail.latest.error}</p>}
    {result !== undefined && <section className={css.result}><h3>{t('taskView.result')}</h3><p>{result.summary}</p></section>}
    {task.delegation !== undefined && <section className={css.result}>
      <h3>{t('detail.task.child')} · {t(`detail.task.childPhase.${task.delegation.phase}`)}</h3>
      {task.delegation.failure !== undefined && <p className={css.error}>{task.delegation.failure.message}</p>}
      {task.delegation.result !== undefined && <p>{task.delegation.result.text}</p>}
      {task.delegation.childTeamId !== undefined && openTeam !== undefined && <Button onClick={() => {
        const id = task.delegation?.childTeamId
        if (id !== undefined) run(async () =>{  await openTeam(id) })
      }}>{t('detail.task.openChild')}</Button>}
    </section>}
    {artifacts.length > 0 && <section className={css.result}><h3>{t('overview.artifacts')}</h3>
      <ul className={css.artifacts}>{artifacts.slice(0, 3).map(artifact => <li key={artifact.id}>
        <button type="button" className={css.link} disabled={openArtifact === undefined || artifact.provider === undefined}
          onClick={() => { openArtifact?.(artifact) }}>{artifact.uri.split('/').at(-1) || artifact.id}</button>
      </li>)}</ul>
    </section>}
    <details className={css.details} onToggle={(event) => {
      if (event.currentTarget.open && !detail.hasNewer && !detail.disconnected) {
        if (detail.attempts.value === undefined && !detail.attempts.loading) void readDetail?.(detail.teamId, detail.taskId, 'attempts', 'first')
        if (detail.reviews.value === undefined && !detail.reviews.loading) void readDetail?.(detail.teamId, detail.taskId, 'reviews', 'first')
      }
    }}><summary>{t('taskView.fullDetails')}<IconChevronDownOutline14 /></summary>
      <h3>{t('taskForm.description')}</h3><p>{task.description}</p>
      {result?.evidence !== undefined && <><h3>{t('detail.task.evidence')}</h3><ul>{result.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      {result?.verification !== undefined && <><h3>{t('detail.task.verification')}</h3><p>{result.verification}</p></>}
      <h3>{t('taskView.history')}</h3>
      <HistoryControls detail={detail} section="attempts" readDetail={readDetail} translate={t} />
      {detail.attempts.value?.items.map((item) => {
        return <div className={css.attempt} key={item.id}><span>{item.ordinal} · {t(`taskView.outcome.${item.outcome.kind}`)}</span>
          {item.activationId !== undefined && openParticipantSession !== undefined && <Button size="sm" onClick={() => {
            run(async () => { await openParticipantSession(item.participantId) })
          }}>{t('detail.openSession')}</Button>}</div>
      })}
      <h3>{t('taskView.reviews')}</h3>
      <HistoryControls detail={detail} section="reviews" readDetail={readDetail} translate={t} />
      {detail.reviews.value?.items.map(review => <div className={css.attempt} key={review.attemptId}>
        <span>{review.reason}</span><span>{t(review.nextPhase === 'completed' ? 'taskView.accepted' : 'taskView.rework')}</span>
      </div>)}
    </details>
    {attempt?.activationId !== undefined && openParticipantSession !== undefined
      ? <Button variant="outline" className={css.openSession} onClick={() => {
        run(async () => { await openParticipantSession(attempt.participantId) })
      }}>{t('taskView.openSession')}</Button>
      : task.execution.kind === 'participant' && <p className={css.count}>{t('taskView.noSession')}</p>}
  </>
}

/** Each history owns one replacement window and retains its last successful page after an error. */
function HistoryControls({ detail, section, readDetail, translate: t }: {
  detail: TeamTaskDetailState
  section: 'attempts' | 'reviews'
  readDetail: ITeamTasks['readTaskDetail']
  translate: TeamPageProps['translate']
}) {
  const part = detail[section]
  const page = part.value
  const disabled = part.loading || detail.record.loading || detail.hasNewer || detail.disconnected || readDetail === undefined
  return <div>
    {part.loading && <p role="status">{t('taskView.historyLoading')}</p>}
    {part.error !== undefined && <p role="alert" className={css.error}>{part.error}</p>}
    {page !== undefined && <p>{t('taskView.historyRange', {
      from: page.items.length === 0 ? 0 : page.startCursor + 2,
      to: page.items.length === 0 ? 0 : page.startCursor + page.items.length + 1, total: page.total,
    })}</p>}
    <Button size="sm" disabled={disabled} onClick={() => { void readDetail?.(detail.teamId, detail.taskId, section, 'first') }}>{t('detail.firstPage')}</Button>
    <Button size="sm" disabled={disabled} onClick={() => { void readDetail?.(detail.teamId, detail.taskId, section) }}>{t('taskView.refresh')}</Button>
    {page?.nextCursor !== undefined && <Button size="sm" disabled={disabled}
      onClick={() => { void readDetail?.(detail.teamId, detail.taskId, section, 'next') }}>{t('taskView.nextHistory')}</Button>}
  </div>
}
