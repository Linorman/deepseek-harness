/** An external retry allowance is separate from publication, scheduling and an original command retry. */
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Modal } from '@clocky/clocky-client-ui-primitives'
import type { SimulationProductObjectInspection, SimulationReadState, SimulationCommand, SimulationCommandKey,
  SimulationCommandState } from '@clocky/clocky-client-runtime/client'
import type { SimulationOperationRetryDraft } from './store.ts'
import { operationRetryDraftKey } from './store.ts'
import { CommandRecord } from './CommandRecord.tsx'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

type Props = {
  draft: SimulationOperationRetryDraft
  detail: SimulationReadState<SimulationProductObjectInspection>
  connected: boolean
  authorizationVersion: number
  commands: Readonly<Record<string, SimulationCommandState>>
  refresh: () => Promise<void>
  change: (key: string, draft?: SimulationOperationRetryDraft) => void
  close: () => void
  retain: (command: SimulationCommand, version: number) => SimulationCommandKey
  submit: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  query: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  t: (key: Key) => string
}
/** Keep an exact operation/fence original while later raw reason edits remain private and independently bounded. */
export function OperationRetry({ draft, ...props }: Props) {
  const { t, detail, connected } = props
  const id = useId()
  const key = operationRetryDraftKey(draft)
  const latest = useRef(draft); latest.current = draft
  const admission = useRef(false)
  const [error, setError] = useState<string>()
  const [discard, setDiscard] = useState(false)
  useEffect(() => { if (connected) void props.refresh() }, [draft.runId, draft.operationId, connected, props.authorizationVersion])
  const value = detail.value?.runId === draft.runId && detail.value.selection.id === draft.operationId
    && detail.value.value?.collection === 'operations' && detail.value.value.section === 'execution' ? detail.value.value : undefined
  const hint = value?.retry
  const record = draft.commandKey === undefined ? Object.values(props.commands).find(value => value.command.kind === 'retry-operation'
    && value.command.input.runId === draft.runId && value.command.input.operationId === draft.operationId)
    : props.commands[draft.commandKey]
  const original = record?.command.kind === 'retry-operation' ? record.command.input : undefined
  const commandKey = draft.commandKey
  const unresolved = record !== undefined && (record.unknown || record.pending || record.receipt === undefined
    || record.receipt.value.status === 'accepted')
  const fresh = connected && !detail.loading && !detail.stale && detail.error === undefined && value !== undefined
  const sameFailed = record?.receipt?.kind === 'request' && record.receipt.value.status === 'failed' && original !== undefined
    && original.expectedAttemptCount === draft.expectedAttemptCount && original.reason.trim() === draft.reason.trim()
  const canSubmit = fresh && hint?.allowed === true && hint.expectedAttemptCount === draft.expectedAttemptCount
    && draft.expectedAttemptCount > 0 && draft.reason.trim() !== '' && !unresolved && !sameFailed
    && record?.error !== 'forbidden' && !admission.current
  const change = (next: SimulationOperationRetryDraft) => {
    try { props.change(key, next); latest.current = next; setError(undefined) }
    catch { setError(t('draftCapacity')) }
  }
  const settle = async (selectedKey: SimulationCommandKey, query: boolean) => {
    const result = await (query ? props.query(selectedKey) : props.submit(selectedKey))
    if (result?.command.kind === 'retry-operation' && result.receipt?.kind === 'request' && result.receipt.value.status === 'completed') {
      const current = latest.current, submitted = current.submitted
      if (current.commandKey === selectedKey && submitted !== undefined && current.reason === submitted.reason
        && current.expectedAttemptCount === submitted.expectedAttemptCount && submitted.reason.trim() === result.command.input.reason.trim()
        && submitted.expectedAttemptCount === result.command.input.expectedAttemptCount) {
        props.change(key, undefined); props.close()
      }
    }
    await props.refresh()
    return result
  }
  const submit = async () => {
    if (!canSubmit || admission.current) return
    admission.current = true
    try {
      const selectedKey = props.retain({ kind: 'retry-operation', input: { runId: draft.runId,
        commandId: crypto.randomUUID() as never, operationId: value.id, expectedAttemptCount: draft.expectedAttemptCount,
        reason: draft.reason.trim() } }, props.authorizationVersion)
      const retained = { ...draft, commandKey: selectedKey,
        submitted: { reason: draft.reason, expectedAttemptCount: draft.expectedAttemptCount } }
      props.change(key, retained); latest.current = retained
      await settle(selectedKey, false)
    } catch { setError(t('commandCapacity')) }
    finally { admission.current = false }
  }
  return <>
    <Modal open title={t('operationRetry.title')} closeLabel={t('closeKeepDraft')} onClose={props.close}
      footer={<><Button variant="outline" onClick={() => { setDiscard(true) }}>{t('discardDraft')}</Button>
        <Button disabled={!canSubmit || record?.pending} onClick={() => { void submit() }}>{t('operationRetry.grant')}</Button></>}>
      <p>{t('operationRetry.notice')}</p><code>{draft.operationId}</code>
      <p>{t('operationRetry.fence')}: {draft.expectedAttemptCount}</p>
      <p>{t('operationRetry.limit')}: {hint?.maxAttempts ?? t('unavailable')}</p>
      {!fresh && <p role="status">{t('operationRetry.check')}</p>}
      {detail.error !== undefined && <p role="alert">{t(detail.error)}</p>}
      {hint === undefined && <p role="status">{t('operationRetry.unavailable')}</p>}
      {hint !== undefined && !hint.allowed && <p role="status">{t(`operationRetry.reason.${hint.reason}`)}</p>}
      {hint !== undefined && hint.expectedAttemptCount !== draft.expectedAttemptCount && <p role="status">{t('operationRetry.changed')}</p>}
      {sameFailed && <p role="status">{t('operationRetry.sameFailed')}</p>}
      <Button disabled={!connected || detail.loading || record?.pending} onClick={() => { void props.refresh() }}>{t('operationRetry.refresh')}</Button>
      {fresh && hint !== undefined && hint.expectedAttemptCount !== draft.expectedAttemptCount && !unresolved && <Button onClick={() => {
        change({ ...draft, expectedAttemptCount: hint.expectedAttemptCount, commandKey: undefined })
      }}>{t('operationRetry.confirmFence')}</Button>}
      <label htmlFor={id}>{t('operationRetry.reason')}</label>
      <textarea id={id} rows={5} className={`${css.textarea} clocky-resize-none`} value={draft.reason}
        onChange={(event) => { change({ ...draft, reason: event.target.value }) }} />
      {original !== undefined && <p>{t('operationRetry.originalReason')}: {original.reason}</p>}
      {record !== undefined && commandKey !== undefined && <CommandRecord value={record} connected={connected} t={t}
        query={() => settle(commandKey, true)} retry={() => settle(commandKey, false)} />}
      {record !== undefined && commandKey !== undefined && !record.unknown && record.receipt?.kind === 'request'
        && ['completed', 'failed'].includes(record.receipt.value.status) && <Button disabled={!connected || record.pending}
        onClick={() => { void settle(commandKey, true) }}>{t('queryOriginal')}</Button>}
      {error !== undefined && <p role="alert">{error}</p>}
    </Modal>
    {discard && <Modal open title={t('discardDraft')} closeLabel={t('keepEditing')} onClose={() => { setDiscard(false) }}
      footer={<><Button onClick={() => { setDiscard(false) }}>{t('keepEditing')}</Button><Button onClick={() => {
        props.change(key, undefined); props.close()
      }}>{t('discardDraft')}</Button></>}><p>{t('discardDraftNotice')}</p></Modal>}
  </>
}
