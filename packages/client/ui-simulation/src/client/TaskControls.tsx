/** Run-owned task controls never expose ordinary Team write authority or canonical task bodies. */
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Modal } from '@clocky/clocky-client-ui-primitives'
import type { SimulationProductRunId, SimulationProductTasksInput, SimulationProductTasksPage, SimulationReadState,
  SimulationCommand, SimulationCommandKey } from '@clocky/clocky-client-runtime/client'
import { simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import type { SimulationTaskCancelDraft } from './store.ts'
import { taskCancelDraftKey } from './store.ts'
import { commandUnresolved, type CommandProps } from './command-props.ts'
import { CommandRecord } from './CommandRecord.tsx'
import css from './Workspace.module.css'
import { useTaskDraft } from './useTaskDraft.ts'

type Target = Pick<SimulationTaskCancelDraft, 'runId' | 'operationId'>
interface Props extends CommandProps {
  runId: SimulationProductRunId
  ready: boolean
  connected: boolean
  authorizationVersion: number
  value: SimulationReadState<SimulationProductTasksPage>
  pageSize: number
  read: (input: SimulationProductTasksInput) => Promise<void>
  drafts: Readonly<Record<string, SimulationTaskCancelDraft>>
  target?: Target | undefined
  change: (key: string, value?: SimulationTaskCancelDraft) => void
  select: (target?: Target) => void

}
/** Show bounded current task phases and one explicit exact-cancellation dialog without starting execution. */
export function TaskControls(props: Props) {
  const { runId, value, connected, t, pageSize } = props
  const page = value.value?.runId === runId ? value.value : undefined
  const refresh = () => props.read({ runId, limit: pageSize })
  useEffect(() => { if (connected && props.ready) void refresh() }, [runId, connected, props.ready, props.authorizationVersion])
  const [error, setError] = useState<string>()
  const selected = props.target?.runId === runId ? props.drafts[taskCancelDraftKey(props.target)] : undefined
  return <section className={css.review} data-empty={page?.total === 0 || page === undefined && value.error !== undefined || undefined} aria-label={t('taskControl.title')}>
    <header className={css.reviewHeader}><h2>{t('taskControl.title')}{page === undefined ? '' : ` · ${page.total}`}</h2>
      <Button variant="secondary" disabled={!connected}
        onClick={() => { void refresh() }}>{t('taskControl.refresh')}</Button></header>
    {page?.total !== 0 && value.error === undefined && <p>{t('taskControl.notice')}</p>}
    {value.loading && page === undefined && <p role="status">{t('loading')}</p>}
    {value.error !== undefined && <p role="alert">{t(value.error)}</p>}
    {error !== undefined && <p role="alert">{error}</p>}
    {page?.items.length === 0 && <p>{t('taskControl.empty')}</p>}
    <ul>{page?.items.map(row => <li key={row.operationId} data-simulation-task-control={row.taskId}>
      <code>{row.taskId}</code><p>{t(`reviews.phase.${row.phase}`)} · {t('reviews.revision')}: {row.taskRevision}</p>
      <p>{t(`taskControl.reason.${row.cancel.reason}`)}</p>
      {row.cancellation !== undefined && <p>{t('taskControl.cancelPending')}</p>}
      {/* Opening only edits a draft; submission is fenced on a fresh window, so a background read never disables the
          control focus returns to. */}
      <Button disabled={!connected} onClick={() => {
        const target = { runId, operationId: row.operationId }, key = taskCancelDraftKey(target)
        try {
          if (props.drafts[key] === undefined) props.change(key, { ...target, expectedRevision: row.taskRevision,
            expectedAttemptId: row.expectedAttemptId, reason: '' })
          props.select(target); setError(undefined)
        } catch { setError(t('commandCapacity')) }
      }}>{t('taskControl.open')}</Button>
    </li>)}</ul>
    {page?.nextCursor !== undefined && <Button disabled={!connected || value.loading || value.stale || value.error !== undefined}
      onClick={() => { void props.read({ runId, limit: pageSize, cursor: page.nextCursor, expectedRevision: page.snapshotRevision }) }}>{t('next')}</Button>}
    {Object.values(props.drafts).filter(draft => draft.runId === runId).map(draft => <Button key={taskCancelDraftKey(draft)}
      onClick={() => { props.select(draft) }}>{t('taskControl.openDraft')} · {draft.operationId}</Button>)}
    {selected !== undefined && <CancelDialog key={taskCancelDraftKey(selected)} {...props} draft={selected} refresh={refresh} />}
  </section>
}

function CancelDialog({ draft, refresh, ...props }: Props & { draft: SimulationTaskCancelDraft; refresh: () => Promise<void> }) {
  const { t, connected, value } = props
  const id = useId(), key = taskCancelDraftKey(draft), busy = useRef(false), composing = useRef(false)
  const [discard, setDiscard] = useState(false)
  const record = draft.commandKey === undefined ? undefined : props.commands[draft.commandKey]
  const commandKey = draft.commandKey
  const row = value.value?.runId === draft.runId ? value.value.items.find(item => item.operationId === draft.operationId) : undefined
  const original = record?.command.kind === 'cancel-task' ? record.command.input : undefined
  const unresolved = commandUnresolved(record)
  const sameFailed = record?.receipt?.kind === 'request' && record.receipt.value.status === 'failed' && original !== undefined
    && draft.reason.trim() === original.reason && draft.expectedRevision === original.expectedRevision
    && draft.expectedAttemptId === original.expectedAttemptId
  const fresh = connected && !value.loading && !value.stale && value.error === undefined
  const matches = row?.taskRevision === draft.expectedRevision && row.expectedAttemptId === draft.expectedAttemptId
  const canSubmit = fresh && row?.cancel.allowed === true && matches && draft.reason.trim() !== '' && !unresolved && !sameFailed
  const { latest, active, error, setError, change } = useTaskDraft(draft, (next) => { props.change(key, next) }, () => t('commandCapacity'))
  const settle = async (commandKey: SimulationCommandKey, query: boolean) => {
    const result = await (query ? props.query(commandKey) : props.submit(commandKey))
    if (!active.current) return result
    if (result?.receipt?.kind === 'request' && result.receipt.value.status === 'completed' && result.command.kind === 'cancel-task') {
      const current = latest.current, submitted = current.submitted
      if (submitted !== undefined && current.commandKey === commandKey && current.reason === submitted.reason
        && current.expectedRevision === submitted.expectedRevision && current.expectedAttemptId === submitted.expectedAttemptId) {
        props.change(key, undefined); props.select(undefined)
      }
    }
    await refresh()
    return result
  }
  const execute = async () => {
    if (!canSubmit || busy.current || composing.current) return
    busy.current = true
    try {
      const input = { runId: draft.runId, commandId: crypto.randomUUID() as never, operationId: draft.operationId as never,
        expectedRevision: draft.expectedRevision, expectedAttemptId: draft.expectedAttemptId, reason: draft.reason.trim() }
      const command: SimulationCommand = { kind: 'cancel-task', input }
      const commandKey = simulationCommandKey(command)
      const retained = { ...draft, commandKey, submitted: { reason: draft.reason, expectedRevision: draft.expectedRevision,
        expectedAttemptId: draft.expectedAttemptId } }
      props.change(key, retained)
      latest.current = retained
      props.retain(command, props.authorizationVersion)
      await settle(commandKey, false)
    } catch { setError(t('commandCapacity')) }
    finally { busy.current = false }
  }
  return <>
    <Modal open title={t('taskControl.open')} closeLabel={t('closeKeepDraft')} onClose={() => { props.select(undefined) }}
      footer={<><Button variant="secondary" onClick={() => { setDiscard(true) }}>{t('discardDraft')}</Button>
        <Button disabled={!canSubmit || record?.pending} onClick={() => { void execute() }}>{t('taskControl.confirm')}</Button></>}>
      <p>{t('taskControl.cancelNotice')}</p><code>{row?.taskId ?? draft.operationId}</code>
      <p>{t('reviews.revision')}: {draft.expectedRevision} · {t('reviews.attempt')}: {draft.expectedAttemptId ?? t('taskControl.noLease')}</p>
      <Button disabled={!connected || value.loading} onClick={() => { void refresh() }}>{t('taskControl.refresh')}</Button>
      {!fresh && <p role="status" className={css.stalePill}>{t('reviews.stale')}</p>}
      {fresh && row !== undefined && !matches && !unresolved && <Button onClick={() => {
        change({ ...draft, expectedRevision: row.taskRevision, expectedAttemptId: row.expectedAttemptId, commandKey: undefined })
      }}>{t('taskControl.confirmFence')}</Button>}
      {row !== undefined && !row.cancel.allowed && <p role="status">{t(`taskControl.reason.${row.cancel.reason}`)}</p>}
      <label htmlFor={id}>{t('taskControl.reason')}</label>
      <textarea id={id} rows={5} className={`${css.textarea} clocky-resize-none`} value={draft.reason}
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
        onChange={(event) => { change({ ...draft, reason: event.target.value }) }} />
      {original !== undefined && <p>{t('taskControl.originalReason')}: {original.reason}</p>}
      {record !== undefined && commandKey !== undefined && <CommandRecord value={record} connected={connected} t={t}
        query={() => settle(commandKey, true)} retry={() => settle(commandKey, false)} />}
      {error !== undefined && <p role="alert">{error}</p>}
    </Modal>
    <Modal open={discard} title={t('discardDraft')} closeLabel={t('keepEditing')} onClose={() => { setDiscard(false) }}
      footer={<><Button onClick={() => { setDiscard(false) }}>{t('keepEditing')}</Button><Button onClick={() => {
        props.change(key, undefined); props.select(undefined)
      }}>{t('discardDraft')}</Button></>}><p>{t('discardDraftNotice')}</p></Modal>
  </>
}
