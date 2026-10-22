/** Scenario review uses exact original attempts; ordinary Team mutation authority remains closed. */
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Modal } from '@clocky/clocky-client-ui-primitives'
import type { SimulationReadState, SimulationProductTaskReviewPage, SimulationProductTaskReviewListInput,
  SimulationProductRunId, SimulationCommandKey } from '@clocky/clocky-client-runtime/client'
import { reviewDraftKey } from './store.ts'
import type { SimulationReviewDraft, SimulationReviewTarget } from './store.ts'
import { CommandRecord } from './CommandRecord.tsx'
import { commandUnresolved, type CommandProps } from './command-props.ts'
import css from './Workspace.module.css'
import { useTaskDraft } from './useTaskDraft.ts'

type Props = CommandProps & {
  runId: SimulationProductRunId
  ready: boolean
  value: SimulationReadState<SimulationProductTaskReviewPage>
  connected: boolean
  authorizationVersion: number
  pageSize: number
  read: (input: SimulationProductTaskReviewListInput) => Promise<void>
  drafts: Readonly<Record<string, SimulationReviewDraft>>
  target?: SimulationReviewTarget | undefined
  select: (target?: SimulationReviewTarget) => void
  change: (key: string, draft?: SimulationReviewDraft) => void

}
/** Render a bounded pending window and one exact-attempt dialog without exposing task bodies. */
export function TaskReviews(props: Props) {
  const { runId, value, connected, read, pageSize, t } = props
  const page = value.value?.runId === runId ? value.value : undefined
  const refresh = () => read({ runId, limit: pageSize })
  useEffect(() => { if (connected && props.ready) void refresh() }, [runId, connected, props.authorizationVersion, props.ready])
  const [error, setError] = useState<string>()
  const open = (draft: SimulationReviewDraft) => {
    try { props.change(reviewDraftKey(draft), draft); props.select(draft); setError(undefined) }
    catch { setError(t('commandCapacity')) }
  }
  const selectedDraft = props.target?.runId === runId ? props.drafts[reviewDraftKey(props.target)] : undefined
  const retained = Object.entries(props.drafts).filter(([, draft]) => draft.runId === runId)
  return <section className={css.review} data-empty={page?.total === 0 || page === undefined && value.error !== undefined || undefined} aria-label={t('reviews.title')} data-simulation-reviews>
    <header className={css.reviewHeader}><h2>{t('reviews.title')}{page === undefined ? '' : ` · ${page.total}`}</h2>
      <Button variant="secondary" disabled={!connected}
        onClick={() => { void refresh() }}>{t('reviews.refresh')}</Button></header>
    {value.loading && page === undefined && <p role="status">{t('loading')}</p>}
    {value.error !== undefined && <p role="alert">{t(value.error)}</p>}
    {error !== undefined && <p role="alert">{error}</p>}
    {page?.items.length === 0 && <p>{t('reviews.empty')}</p>}
    <ul>{page?.items.map(row => <li key={`${row.operationId}:${row.attemptId}`}>
      <code>{row.taskId}</code> · {t('reviews.attempt')} {row.attemptCount} / {row.maxAttempts}
      <p>{t(`reviews.phase.${row.phase}`)} · {t('reviews.revision')}: {row.taskRevision} · {t('reviews.reviewer')}: <code>{row.reviewerEntityId}</code></p>
      <p>{t(`reviews.reason.${row.action.reason}`)}</p>
      <ReviewEvidence row={row} t={t} />
      {/* Opening only edits a draft; submission is fenced on a fresh window, so a background read never disables the
          control focus returns to. */}
      <Button disabled={!connected} onClick={() => { open(props.drafts[reviewDraftKey({ runId,
        operationId: row.operationId, attemptId: row.attemptId })] ?? { runId, operationId: row.operationId,
        attemptId: row.attemptId, expectedRevision: row.taskRevision, nextPhase: 'completed', reason: '' }) }}>{t('reviews.open')}</Button>
    </li>)}</ul>
    {page?.nextCursor !== undefined && <Button disabled={!connected || value.loading || value.stale || value.error !== undefined}
      onClick={() => { void read({ runId, cursor: page.nextCursor, expectedRevision: page.snapshotRevision, limit: pageSize }) }}>{t('next')}</Button>}
    {retained.map(([key, draft]) => <Button key={key} onClick={() => { props.select(draft) }}>{t('reviews.openDraft')} · {draft.attemptId}</Button>)}
    {selectedDraft !== undefined && <ReviewDialog
      key={reviewDraftKey(selectedDraft)} {...props} refresh={refresh} draft={selectedDraft} />}
  </section>
}

function ReviewDialog({ draft, refresh, ...props }: Props & { draft: SimulationReviewDraft; refresh: () => Promise<void> }) {
  const reasonId = useId()
  const { t, value, connected, commands } = props
  const key = reviewDraftKey(draft)
  const [discard, setDiscard] = useState(false)
  const admission = useRef(false)
  const record = draft.commandKey === undefined ? Object.values(commands).find(value => value.command.kind === 'review'
    && value.command.input.runId === draft.runId && value.command.input.operationId === draft.operationId
    && value.command.input.attemptId === draft.attemptId) : commands[draft.commandKey]
  const commandKey = draft.commandKey
  const original = record?.command.kind === 'review' ? record.command.input : undefined
  const pending = record?.pending === true
  const unresolved = commandUnresolved(record)
  const row = value.value?.runId === draft.runId ? value.value.items.find(item => item.operationId === draft.operationId
    && item.attemptId === draft.attemptId) : undefined
  const fresh = connected && !value.loading && !value.stale && value.error === undefined
  const failedSameIntent = record?.receipt?.kind === 'request' && record.receipt.value.status === 'failed' && original !== undefined
    && draft.reason.trim() === original.reason.trim() && draft.nextPhase === original.nextPhase
    && draft.expectedRevision === original.expectedRevision
  const canSubmit = fresh && row?.action.allowed === true && row.taskRevision === draft.expectedRevision
    && draft.reason.trim() !== '' && !unresolved && !failedSameIntent && record?.error !== 'forbidden' && !admission.current
  const { latest, active, error, setError, change } = useTaskDraft(draft, (next) => { props.change(key, next) }, () => t('commandCapacity'))
  const settle = async (commandKey: SimulationCommandKey, query: boolean) => {
    const result = await (query ? props.query(commandKey) : props.submit(commandKey))
    if (!active.current) return result
    if (result?.receipt?.kind === 'request' && result.receipt.value.status === 'completed' && result.command.kind === 'review') {
      const current = latest.current
      const submitted = current.submitted
      if (current.commandKey === commandKey && submitted !== undefined
        && current.reason === submitted.reason && current.nextPhase === submitted.nextPhase
        && current.expectedRevision === submitted.expectedRevision && submitted.reason.trim() === result.command.input.reason.trim()
        && submitted.nextPhase === result.command.input.nextPhase && submitted.expectedRevision === result.command.input.expectedRevision) {
        props.change(key, undefined); props.select(undefined)
      }
    }
    await refresh()
    return result
  }
  const submit = async () => {
    if (!canSubmit || admission.current) return
    admission.current = true
    try {
      const input = { runId: draft.runId, commandId: crypto.randomUUID() as never, operationId: row.operationId,
        attemptId: row.attemptId, expectedRevision: draft.expectedRevision, nextPhase: draft.nextPhase, reason: draft.reason.trim() }
      const commandKey = props.retain({ kind: 'review', input }, props.authorizationVersion)
      const retained = { ...draft, commandKey, submitted: { reason: draft.reason, nextPhase: draft.nextPhase,
        expectedRevision: draft.expectedRevision } }
      props.change(key, retained)
      latest.current = retained
      await settle(commandKey, false)
    } catch { setError(t('commandCapacity')) }
    finally { admission.current = false }
  }
  return <>
    <Modal open title={t('reviews.open')} closeLabel={t('closeKeepDraft')} onClose={() => { props.select(undefined) }}
      footer={<><Button variant="secondary" onClick={() => { setDiscard(true) }}>{t('discardDraft')}</Button>
        <Button disabled={!canSubmit || pending} onClick={() => { void submit() }}>{t(draft.nextPhase === 'completed' ? 'reviews.approve' : 'reviews.rework')}</Button></>}>
      <div className={`${css.formBody} ${css.review}`}>
        <p>{t('reviews.notice')}</p><code>{draft.operationId}</code> · <code>{draft.attemptId}</code>
        {row !== undefined && <ReviewEvidence row={row} t={t} />}
        <p>{t('reviews.revision')}: {draft.expectedRevision}</p>
        {!fresh && <p role="status" className={css.stalePill}>{t('reviews.stale')}</p>}
        {failedSameIntent && <p role="status">{t('reviews.failedSameIntent')}</p>}
        {row === undefined && <p role="status">{t('reviews.targetUnavailable')}</p>}
        {row !== undefined && row.taskRevision !== draft.expectedRevision && <p role="status">{t('reviews.changed')}</p>}
        <Button disabled={!connected || value.loading || pending} onClick={() => { void refresh() }}>{t('reviews.refresh')}</Button>
        {fresh && row !== undefined && row.taskRevision !== draft.expectedRevision && !unresolved && <Button onClick={() => {
          change({ ...draft, expectedRevision: row.taskRevision, commandKey: undefined })
        }}>{t('reviews.confirmRevision')}</Button>}
        <div className={css.actions}>
          <Button aria-pressed={draft.nextPhase === 'completed'} onClick={() => { change({ ...draft, nextPhase: 'completed' }) }}>{t('reviews.approve')}</Button>
          <Button aria-pressed={draft.nextPhase === 'pending'} onClick={() => { change({ ...draft, nextPhase: 'pending' }) }}>{t('reviews.rework')}</Button>
        </div>
        <label htmlFor={reasonId}>{t('reviews.reason')}</label><textarea id={reasonId} rows={5} className={`${css.textarea} clocky-resize-none`} value={draft.reason} onChange={(event) => {
          change({ ...draft, reason: event.target.value })
        }} />
        {original !== undefined && <p>{t('reviews.originalReason')}: {original.reason}</p>}
        {row !== undefined && !row.action.allowed && <p role="status">{t(`reviews.reason.${row.action.reason}`)}</p>}
        {record !== undefined && commandKey !== undefined && <CommandRecord value={record} connected={connected} t={t}
          query={() => settle(commandKey, true)} retry={() => settle(commandKey, false)} />}
        {record !== undefined && commandKey !== undefined && !record.unknown && record.receipt?.kind === 'request'
        && ['completed', 'failed'].includes(record.receipt.value.status) && <Button disabled={!connected || pending}
          onClick={() => { void settle(commandKey, true) }}>{t('queryOriginal')}</Button>}
        {error !== undefined && <p role="alert">{error}</p>}
      </div>
    </Modal>
    <Modal open={discard} title={t('discardDraft')} closeLabel={t('closeKeepDraft')} onClose={() => { setDiscard(false) }}
      footer={<><Button onClick={() => { setDiscard(false) }}>{t('closeKeepDraft')}</Button><Button onClick={() => {
        props.change(key, undefined); props.select(undefined)
      }}>{t('discardDraft')}</Button></>}><p>{t('discardDraftNotice')}</p></Modal>
  </>
}

/** Scene-verified evidence stays separate from independently authorized original report text. */
function ReviewEvidence({ row, t }: { row: SimulationProductTaskReviewPage['items'][number]; t: Props['t'] }) {
  const evidence = row.evidence
  return evidence === undefined ? <p>{t('reviews.noEvidence')}</p> : <dl>
    {evidence.inventoryTransfer !== undefined && <><dt>{t('reviews.transfer')}</dt><dd><code>{evidence.inventoryTransfer.operationId}</code>
      · {t('reviews.applied')} · {t('reviews.quantity')}: {evidence.inventoryTransfer.quantity}</dd></>}
    <dt>{t('reviews.report')}</dt><dd><code>{evidence.report.operationId}</code> · {t('reviews.persisted')}</dd>
  </dl>
}
