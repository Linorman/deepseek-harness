/** Summary list and one independently paged workflow inspection. */
import type { MouseEvent } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { TeamWorkflowSummary, TeamWorkflowDetailState, TeamWorkflowDetailReadMode, TeamTaskId } from '@clocky/clocky-client-runtime/client'
import type { TeamPageProps } from './TeamPage.tsx'
import css from './TeamBrowser.module.css'
import workspaceCss from './TeamWorkspace.module.css'

/** Bounded workflow state and its existing task navigation. */
export interface WorkflowWorkspaceProps {
  readonly plans: readonly TeamWorkflowSummary[]
  readonly detail?: TeamWorkflowDetailState | undefined
  readonly read?: ((id: TeamWorkflowSummary['id'], mode?: TeamWorkflowDetailReadMode) => Promise<void>) | undefined
  readonly close?: (() => void) | undefined
  readonly translate: TeamPageProps['translate']
  readonly openTask: (event: MouseEvent<HTMLAnchorElement>, taskId: TeamTaskId) => void
}

/** Render summaries without requiring any complete workflow snapshot.
 * @param props - Current summary page and one workflow inspector.
 * @returns workflow choices and bounded task/dependency rows.
 */
export function WorkflowWorkspace({ plans, detail, read, close, translate: t, openTask }: WorkflowWorkspaceProps) {
  const value = detail?.value
  const record = value?.record
  const blocked = detail?.loading || detail?.disconnected
  return <>
    <ul className={css.list}>{plans.map(plan => <li key={plan.id} className={css.record}>
      <div className={css.taskHeader}>
        <Button disabled={read === undefined || detail?.planId === plan.id && detail.loading} aria-pressed={detail?.planId === plan.id}
          onClick={() => { void read?.(plan.id, 'open') }}>{plan.name.text || plan.id}</Button>
        <span className={css.badge}>{t(`detail.workflow.phase.${plan.phase}`)}</span>
      </div>
      <small className={css.taskMeta}>{plan.taskCount} {t('detail.workflow.tasks')}</small>
    </li>)}</ul>
    {detail !== undefined && <section className={css.section} aria-label={t('workflowView.detail')}>
      <div className={css.sectionHeader}>
        <h3>{record?.name ?? plans.find(plan => plan.id === detail.planId)?.name.text ?? detail.planId}</h3>
        <div className={css.actions}>
          <Button disabled={close === undefined} onClick={close}>{t('workflowView.close')}</Button>
          <Button disabled={blocked || read === undefined} onClick={() => { void read?.(detail.planId, 'refresh') }}>{t('workflowView.refresh')}</Button>
        </div>
      </div>
      {detail.loading && <p role="status">{t('detail.workflowLoading')}</p>}
      {detail.hasNewer && <p role="status">{t('workflowView.newer')}</p>}
      {detail.disconnected && <p role="status">{t('workflowView.disconnected')}</p>}
      {detail.error !== undefined && <p className={css.error} role="alert">{detail.error}</p>}
      {record !== undefined && <>
        <div><span className={css.badge}>{t(`detail.workflow.phase.${record.phase}`)}</span></div>
        <small className={css.taskMeta}>{t('detail.workflow.bounds')}: {record.bounds.maxTasks} · {record.bounds.maxParallelism} · {record.bounds.maxTotalAttempts}</small>
        <ol className={css.list} aria-label={t('detail.workflow.tasks')}>
          {value?.items.map(task => <li key={task.templateId} className={css.record}>
            {task.taskId === undefined ? <strong>{task.subject.text || task.templateId}</strong>
              : <a className={workspaceCss.textLink} href={`#team-task-${task.taskId}`} onClick={(event) => { if (task.taskId !== undefined) openTask(event, task.taskId) }}>{task.subject.text || task.templateId}</a>}
            {task.blockedBy.length > 0 && <small className={css.taskMeta}>{t('detail.workflow.dependsOn')}: {' '}
              {task.blockedBy.map((dependency, index) => <span key={dependency.templateId}>{index > 0 ? ' · ' : null}
                {dependency.taskId === undefined ? dependency.subject.text
                  : <a className={workspaceCss.textLink} href={`#team-task-${dependency.taskId}`} onClick={(event) => {
                    if (dependency.taskId !== undefined) openTask(event, dependency.taskId)
                  }}>{dependency.subject.text}</a>}
              </span>)}
            </small>}
          </li>)}
        </ol>
        {record.failure !== undefined && <p className={css.error}>{t('detail.workflow.failure')}: {record.failure.message}</p>}
        {record.cancellation !== undefined && <p className={css.notice}>{t('detail.workflow.cancellation')}: {record.cancellation.message}</p>}
        {record.resultTaskCount !== undefined && <small>{t('detail.workflow.result')}: {record.resultTaskCount}</small>}
      </>}
      {value !== undefined && <div className={css.actions}>
        {value.startCursor >= 0 && <Button disabled={blocked} onClick={() => { void read?.(detail.planId, 'first') }}>{t('detail.firstPage')}</Button>}
        {value.nextCursor !== undefined && <Button disabled={blocked || detail.hasNewer || detail.error !== undefined}
          onClick={() => { void read?.(detail.planId, 'next') }}>{t('detail.loadMore')}</Button>}
      </div>}
    </section>}
  </>
}
