import type { TeamLoadedContext } from './TeamPage.tsx'
import type { TeamTaskDetailState, ITeamTasks } from '@clocky/clocky-client-runtime/client'
/** Revision-fenced task authoring, review, and artifact integration forms. */

import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Modal } from '@clocky/clocky-client-ui-primitives'
import type { TeamManagementCommand } from '@clocky/clocky-client-runtime/client'
import { TeamTaskStartError } from '@clocky/clocky-client-runtime/client'
import type { TeamKey } from './locales.ts'
import css from './TeamBrowser.module.css'

type CreateInput = Extract<TeamManagementCommand, { operation: 'taskCreate' }>['input']
type UpdateRefusal = Extract<Awaited<ReturnType<NonNullable<ITeamTasks['lookupTaskUpdate']>>>, { kind: 'rejected' }>['rejection']

import { createTaskFormDraft, hasTaskDraftInput, isPreviousTaskUpdateUnchanged,
  type TaskFormDraft, type TaskFormFields, type TeamTaskDialogTarget } from './task-draft.ts'
export type { TeamTaskDialogTarget } from './task-draft.ts'

interface TaskDialogProps {

  readonly inspection?: TeamTaskDetailState | undefined
  readonly readTaskDetail?: ITeamTasks['readTaskDetail']
  readonly target: TeamTaskDialogTarget
  readonly state: TeamLoadedContext
  readonly translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  readonly manage?: ((command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>) | undefined
  /** Current Team management eligibility; original-result reads remain independent. */
  readonly canSubmit?: boolean | undefined
  readonly taskCapabilities?: import('@clocky/clocky-client-runtime/client').TeamTaskCapabilitiesState | undefined
  readonly watchTaskCapabilities?: ((input: import('@clocky/clocky-client-runtime/client').TeamTaskCapabilitiesInput) => () => void) | undefined
  readonly refreshTaskCapabilities?: ITeamTasks['refreshTaskCapabilities']
  readonly lookupTaskUpdate?: ITeamTasks['lookupTaskUpdate']
  readonly taskReferences?: import('@clocky/clocky-client-runtime/client').TaskReferencesState | undefined
  readonly watchTaskReferences?: import('./TeamBrowser.tsx').TeamBrowserInjected['watchTaskReferences']
  readonly refreshTaskReferences?: (() => Promise<void>) | undefined
  readonly dependencyQuery?: import('@clocky/clocky-client-runtime/client').TeamTaskQueryState | undefined
  readonly readDependencies?: ITeamTasks['readDependencies']
  readonly closeDependencies?: ITeamTasks['closeDependencies']
  readonly onClose: () => void
  readonly draft?: TaskFormDraft | undefined
  readonly onDraftChange?: ((draft: TaskFormDraft) => void) | undefined
  readonly onDraftDiscard?: (() => void) | undefined
}

/**
 * Render task instructions and policy inputs against the current Team projection.
 * @param props - task target, current Team, locale, and authenticated mutation owner.
 * @returns an application dialog retaining fields across rejected mutations.
 */
export function TeamTaskDialog(props: TaskDialogProps) {
  const { target, state, inspection, readTaskDetail, translate: t, onClose } = props
  const taskId = 'taskId' in target ? target.taskId : undefined
  const detail = inspection?.teamId === state.team.id && inspection.taskId === taskId ? inspection : undefined
  useEffect(() => {
    if (taskId !== undefined && detail === undefined) void readTaskDetail?.(state.team.id, taskId)
  }, [state.team.id, taskId, readTaskDetail])
  if (taskId !== undefined && (detail?.record.value === undefined || detail.latest.loading && detail.latest.value === undefined)) {
    return <Modal open title={t(`taskForm.${target.kind}`)} closeLabel={t('cancel')} onClose={onClose}
      footer={<Button onClick={onClose}>{t('cancel')}</Button>}>
      <p role="status">{t('taskView.loading')}</p>
      <p className={css.muted}>{t('taskForm.draftRetention')}</p>
      {detail?.record.error !== undefined && <p role="alert">{detail.record.error}</p>}
      <Button disabled={detail?.record.loading || detail?.disconnected}
        onClick={() => { void readTaskDetail?.(state.team.id, taskId) }}>{t('taskView.refresh')}</Button>
    </Modal>
  }
  return <TaskForm key={`${state.team.id}:${target.kind}:${taskId ?? ''}`} {...props} />
}

/** Form fields belong to the viewing store; current task records come from runtime inspection. */
function TaskForm({ target, state, inspection, readTaskDetail, dependencyQuery, readDependencies,
  closeDependencies, taskCapabilities, watchTaskCapabilities, refreshTaskCapabilities, translate: t, manage, onClose,
  draft: controlledDraft, onDraftChange, onDraftDiscard, taskReferences, watchTaskReferences,
  refreshTaskReferences, lookupTaskUpdate, canSubmit = true }: TaskDialogProps) {
  const id = useId()
  const detail = 'taskId' in target && inspection?.taskId === target.taskId && inspection.teamId === state.team.id ? inspection : undefined
  const task = detail?.record.value?.task
  const completedAttempts = [...new Map([...(detail?.attempts.value?.items ?? []),
    ...(detail?.latest.value === undefined ? [] : [detail.latest.value])].filter(attempt => attempt.outcome.kind === 'completed')
    .map(attempt => [attempt.id, attempt])).values()]
  const [localDraft, setLocalDraft] = useState(() => createTaskFormDraft(target, task,
    t('taskForm.integrateSubject', { subject: task?.subject ?? '' }), completedAttempts.at(-1)?.id))
  const draft = controlledDraft ?? localDraft
  const draftRef = useRef(draft)
  draftRef.current = draft
  const canWrite = canSubmit && manage !== undefined
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [discard, setDiscard] = useState(false)
  const publishDraft = (next: TaskFormDraft): boolean => {
    try {
      onDraftChange?.(next)
      if (controlledDraft === undefined) setLocalDraft(next)
      draftRef.current = next
      return true
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)); return false }
  }
  const field = <K extends keyof TaskFormFields>(name: K) => [draft.fields[name],
    (value: TaskFormFields[K] | ((previous: TaskFormFields[K]) => TaskFormFields[K])) => {
      const current = draftRef.current
      publishDraft({ ...current, fields: { ...current.fields, [name]: typeof value === 'function' ? value(current.fields[name]) : value } })
    }] as const
  const baselineRevision = draft.baselineRevision
  const revisionChanged = target.kind !== 'taskCreate' && (task?.revision !== baselineRevision || detail?.hasNewer === true)
  const reading = detail?.record.loading === true || detail?.latest.loading === true || detail?.disconnected === true
    || detail?.record.error !== undefined || detail?.latest.error !== undefined
  const refreshNeeded = detail?.hasNewer === true || detail?.record.error !== undefined || detail?.latest.error !== undefined
  const refreshBlocked = detail?.record.loading === true || detail?.latest.loading === true || detail?.disconnected === true
    || readTaskDetail === undefined
  const unavailable = (target.kind === 'taskReview' && task?.phase !== 'review')
    || (target.kind === 'taskUpdate' && (task?.phase !== 'pending' || task.lease !== undefined))
    || (target.kind === 'taskIntegrate' && task?.phase !== 'completed')
  const reviewedAttempt = detail?.latest.value
  const creating = target.kind === 'taskCreate' || target.kind === 'taskIntegrate'
  const [subject, setSubject] = field('subject')
  const [description, setDescription] = field('description')
  const [blockedBy, setBlockedBy] = field('blockedBy')
  const referenceIds = JSON.stringify([...new Set([...(task?.blockedBy ?? []), ...blockedBy])])
  useEffect(() => {
    if (target.kind === 'taskReview') return
    return watchTaskReferences?.(state.team.id, JSON.parse(referenceIds) as typeof blockedBy)
  }, [state.team.id, referenceIds, target.kind, watchTaskReferences])
  const references = taskReferences?.teamId === state.team.id ? taskReferences : undefined
  const referencesReady = references !== undefined && JSON.stringify(references.taskIds) === referenceIds
    && !references.loading && !references.hasNewer && !references.disconnected && references.error === undefined
  const unavailableDependencies = blockedBy.filter((taskId) => {
    const row = references?.items.find(item => item.taskId === taskId)
    return row?.state === 'unavailable' || row?.state === 'resolved' && row.phase === 'deleted'
  })
  const dependenciesBlocked = target.kind !== 'taskReview' && (blockedBy.length > 0 || (task?.blockedBy.length ?? 0) > 0)
    && (!referencesReady || unavailableDependencies.length > 0)
  const referenceLabel = (taskId: (typeof blockedBy)[number]): string => {
    const row = references?.items.find(item => item.taskId === taskId)
    return row?.state === 'resolved' ? `${row.subject.text}${row.subject.truncated ? '…' : ''} (${taskId})` : taskId
  }
  const [workspaceMode, setWorkspaceMode] = field('workspaceMode')
  const [priority, setPriority] = field('priority')
  const [maxAttempts, setMaxAttempts] = field('maxAttempts')
  const [capabilities, setCapabilities] = field('capabilities')
  const [readScopes, setReadScopes] = field('readScopes')
  const [writeScopes, setWriteScopes] = field('writeScopes')
  const authoring = taskCapabilities?.input.teamId === state.team.id ? taskCapabilities : undefined
  const options = authoring?.value
  const scopesMatch = authoring?.input.integration === (target.kind === 'taskIntegrate')
    && JSON.stringify(authoring.input.readScopes) === JSON.stringify(pathLines(readScopes))
    && JSON.stringify(authoring.input.writeScopes) === JSON.stringify(pathLines(writeScopes))
  const readScopeRejected = scopesMatch && options?.readScopes.accepted === false && !authoring.loading
  const writeScopeRejected = scopesMatch && options?.writeScopes.accepted === false && !authoring.loading
  const capabilityBlocked = creating && (watchTaskCapabilities === undefined || options === undefined
    || authoring?.loading === true || authoring?.disconnected === true
    || authoring?.error !== undefined || !scopesMatch || !options.create.allowed
    || !options.workspaceModes.find(item => item.mode === workspaceMode)?.allowed
    || !options.readScopes.accepted || !options.writeScopes.accepted)
  useEffect(() => {
    if (!creating) return
    return watchTaskCapabilities?.({ teamId: state.team.id, integration: target.kind === 'taskIntegrate', readScopes: pathLines(readScopes), writeScopes: pathLines(writeScopes) })
  }, [creating, target.kind, state.team.id, readScopes, writeScopes, watchTaskCapabilities])
  const [reviewer, setReviewer] = field('reviewer')
  const [decision, setDecision] = field('decision')
  const [reason, setReason] = field('reason')
  const [maxTokens, setMaxTokens] = field('maxTokens')
  const [maxTurns, setMaxTurns] = field('maxTurns')
  const [placementMembers, setPlacementMembers] = field('placementMembers')
  const [placementRoles, setPlacementRoles] = field('placementRoles')
  const [placementProviders, setPlacementProviders] = field('placementProviders')
  const [placementPresets, setPlacementPresets] = field('placementPresets')
  const [placementModels, setPlacementModels] = field('placementModels')
  const [provider, setProvider] = field('provider')
  const [integrationTarget, setIntegrationTarget] = field('integrationTarget')
  const [expectedTarget, setExpectedTarget] = field('expectedTarget')
  const [integrationMode, setIntegrationMode] = field('integrationMode')
  const [sourceAttemptId, setSourceAttemptId] = field('sourceAttemptId')
  const [dependencySearch, setDependencySearch] = field('dependencySearch')
  const excludedTask = target.kind === 'taskUpdate' ? target.taskId : undefined
  const candidates = dependencyQuery?.teamId === state.team.id && dependencyQuery.query.excludeTaskId === excludedTask
    ? dependencyQuery : undefined
  const searchDependencies = (search: string): void => {
    void readDependencies?.(state.team.id, { search, ...excludedTask === undefined ? {} : { excludeTaskId: excludedTask } }, 'first')
  }
  useEffect(() => {
    if (target.kind !== 'taskReview') void readDependencies?.(state.team.id,
      { search: '', ...excludedTask === undefined ? {} : { excludeTaskId: excludedTask } }, 'first')
    return () => { closeDependencies?.() }
  }, [state.team.id, excludedTask, target.kind, readDependencies, closeDependencies])
  const [busy, setBusy] = useState(false)
  const [invalid, setInvalid] = useState<string | undefined>()
  const request = useRef<AbortController | undefined>()
  const form = useRef<HTMLFormElement | null>(null)
  const title = t(`taskForm.${target.kind}`)

  useEffect(() => {
    const previous = document.activeElement
    form.current?.closest('dialog')?.querySelector<HTMLButtonElement>('[data-task-dialog-cancel]')?.focus()
    return () => { request.current?.abort(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])

  const fail = (field: string, message: string): void => {
    setInvalid(field); setError(message)
    const element = document.getElementById(`${id}-${field}`)
    for (let parent = element?.parentElement; parent !== undefined && parent !== null; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true
    }
    element?.focus()
  }
  const fieldA11y = (field: string) => ({
    id: `${id}-${field}`, 'aria-invalid': invalid === field,
    'aria-describedby': invalid === field ? `${id}-error` : undefined,
  })
  const submit = async (): Promise<void> => {
    if (!canWrite || request.current !== undefined || revisionChanged || unavailable || reading || capabilityBlocked
      || dependenciesBlocked || draft.updateRetry !== undefined || isPreviousTaskUpdateUnchanged(draft)) return
    setError(undefined); setInvalid(undefined)
    let command: TeamManagementCommand
    if (target.kind === 'taskReview') {
      if (task === undefined || baselineRevision === undefined) return
      if (!reason.trim()) { fail('reason', t('taskForm.reasonRequired')); return }
      command = { operation: 'taskReview', input: { taskId: task.id, expectedRevision: baselineRevision, decision, reason: reason.trim() } }
    } else {
      if (!subject.trim()) { fail('subject', t('taskForm.subjectRequired')); return }
      if (!description.trim()) { fail('description', t('taskForm.descriptionRequired')); return }
      if (target.kind === 'taskUpdate') {
        if (task === undefined || baselineRevision === undefined) return
        const input = { taskId: task.id,
          commandId: crypto.randomUUID() as Extract<TeamManagementCommand, { operation: 'taskUpdate' }>['input']['commandId'],
          expectedRevision: baselineRevision, subject: subject.trim(), description: description.trim(), blockedBy }
        if (!publishDraft({ ...draftRef.current, previousUpdateInput: undefined, updateRetry: { input } })) return
        command = { operation: 'taskUpdate', input }
      } else {
        const parsedPriority = Number(priority)
        const parsedMaxAttempts = Number(maxAttempts)
        if (priority.trim() === '' || !Number.isSafeInteger(parsedPriority)) { fail('priority', t('taskForm.integerRequired')); return }
        if (!Number.isSafeInteger(parsedMaxAttempts) || parsedMaxAttempts < 1) { fail('maxAttempts', t('taskForm.positiveRequired')); return }
        if (options !== undefined && parsedMaxAttempts > options.maxAttempts) { fail('maxAttempts', t('taskForm.attemptLimit', { max: options.maxAttempts })); return }
        const budget: Record<string, number> = {}
        for (const [field, budgetKey, value] of [['maxTokens', 'maxTotalTokens', maxTokens], ['maxTurns', 'maxTurns', maxTurns]] as const) {
          if (value.trim() === '') continue
          const parsed = Number(value)
          if (!Number.isSafeInteger(parsed) || parsed < 0) { fail(field, t('taskForm.budgetRequired')); return }
          budget[budgetKey] = parsed
        }
        let integration: CreateInput['integration']
        if (target.kind === 'taskIntegrate') {
          if (task === undefined || sourceAttemptId === undefined) { fail('attempt', t('taskForm.attemptRequired')); return }
          if (!provider.trim()) { fail('provider', t('taskForm.providerRequired')); return }
          if (!integrationTarget.trim()) { fail('target', t('taskForm.targetRequired')); return }
          if (integrationMode === 'integrate' && !expectedTarget.trim()) { fail('expectedTarget', t('taskForm.versionRequired')); return }
          integration = {
            sourceTaskId: task.id, sourceAttemptId, provider: provider.trim(), target: integrationTarget.trim(), mode: integrationMode,
            ...expectedTarget.trim() ? { expectedTarget: expectedTarget.trim() } : {},
          }
        }
        const placement = {
          ...placementMembers.length === 0 ? {} : { participantIds: placementMembers },
          ...placementRoles.trim() ? { roles: commaList(placementRoles) } : {},
          ...placementProviders.trim() ? { providers: commaList(placementProviders) } : {},
          ...placementPresets.trim() ? { presets: commaList(placementPresets) } : {},
          ...placementModels.trim() ? { models: commaList(placementModels) } : {},
        }
        const input = {
          subject: subject.trim(), description: description.trim(), blockedBy, requiredCapabilities: commaList(capabilities),
          priority: parsedPriority, maxAttempts: parsedMaxAttempts, readScopes: pathLines(readScopes), writeScopes: pathLines(writeScopes),
          workspaceMode, budget,
          ...Object.keys(placement).length === 0 ? {} : { placement },
          reviewPolicy: reviewer === undefined ? { kind: 'none' as const } : { kind: 'participant' as const, reviewerId: reviewer },
          ...integration === undefined ? {} : { integration },
        }
        const nextFingerprint = JSON.stringify(input)
        const retry = draft.createRetry?.fingerprint === nextFingerprint ? draft.createRetry
          : { fingerprint: nextFingerprint, key: crypto.randomUUID() as CreateInput['idempotencyKey'] }
        if (!publishDraft({ ...draftRef.current, createRetry: retry })) return
        command = { operation: 'taskCreate', input: {
          ...input, expectedCursor: state.team.cursor, idempotencyKey: retry.key,
        } }
      }
    }
    const controller = new AbortController()
    request.current = controller; setBusy(true)
    try { await manage(command, controller.signal); if (!controller.signal.aborted) { onDraftDiscard?.(); onClose() } }
    catch (cause: unknown) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause))
        if (command.operation === 'taskUpdate' && cause instanceof TeamTaskStartError
          && cause.rpcError?.code === 'team-task-update-rejected') {
          await settleRefusal({ input: command.input }, cause.rpcError.details.rejection, cause.rpcError.message)
        }
      }
    }
    finally { if (request.current === controller) { request.current = undefined; setBusy(false) } }
  }
  const settleOriginal = async (retry: NonNullable<TaskFormDraft['updateRetry']>): Promise<void> => {
    const current = draftRef.current
    const original = retry.input
    if (current.fields.subject.trim() === original.subject && current.fields.description.trim() === original.description
      && JSON.stringify(current.fields.blockedBy) === JSON.stringify(original.blockedBy)) {
      onDraftDiscard?.(); onClose()
    } else if (publishDraft({ ...current, updateRetry: undefined })) {
      await readTaskDetail?.(state.team.id, original.taskId)
      setNotice(t('taskForm.originalConfirmed'))
    }
  }
  const settleRefusal = async (retry: NonNullable<TaskFormDraft['updateRetry']>, refusal: UpdateRefusal, diagnostic?: string): Promise<void> => {
    if (refusal.teamId !== state.team.id || refusal.taskId !== retry.input.taskId
      || refusal.commandId !== retry.input.commandId || refusal.expectedRevision !== retry.input.expectedRevision) {
      setError(t('taskForm.originalMismatch')); return
    }
    if (!publishDraft({ ...draftRef.current, updateRetry: undefined, previousUpdateInput: retry.input })) return
    if (refusal.reason === 'invalid-edit') {
      setNotice(undefined)
      fail('dependencies', diagnostic ?? t('taskForm.rejected.invalid-edit'))
    } else setNotice(t(`taskForm.rejected.${refusal.reason}`))
    try { await readTaskDetail?.(state.team.id, retry.input.taskId) }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const recoverOriginal = async (retryWrite: boolean): Promise<void> => {
    const retry = draftRef.current.updateRetry
    if (retry === undefined || request.current !== undefined || lookupTaskUpdate === undefined) return
    const controller = new AbortController()
    request.current = controller; setBusy(true); setError(undefined); setNotice(undefined)
    try {
      if (retryWrite) {
        if (!canWrite) return
        await manage({ operation: 'taskUpdate', input: retry.input }, controller.signal)
        if (!controller.signal.aborted) await settleOriginal(retry)
      } else {
        const outcome = await lookupTaskUpdate({ teamId: state.team.id, taskId: retry.input.taskId,
          commandId: retry.input.commandId }, controller.signal)
        if (controller.signal.aborted) return
        switch (outcome.kind) {
          case 'applied':
            if (outcome.receipt.expectedRevision !== retry.input.expectedRevision) setError(t('taskForm.originalMismatch'))
            else await settleOriginal(retry)
            break
          case 'rejected': await settleRefusal(retry, outcome.rejection); break
          case 'not-found': setNotice(t('taskForm.originalNotFound')); break
          /* v8 ignore next 2 -- The runtime returns only the three parsed lookup outcome tags. */
          default: assertNever(outcome)
        }
      }
    } catch (cause: unknown) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause))
        if (cause instanceof TeamTaskStartError && cause.rpcError?.code === 'team-task-update-rejected') {
          await settleRefusal(retry, cause.rpcError.details.rejection, cause.rpcError.message)
        }
      }
    }
    finally { if (request.current === controller) { request.current = undefined; setBusy(false) } }
  }
  const dirty = hasTaskDraftInput(draft)
  const close = (): void => {
    if (busy) return
    if (dirty && onDraftChange === undefined) setDiscard(true)
    else onClose()
  }
  const footer = <div className={css.actions}>
    <Button data-task-dialog-cancel disabled={busy} onClick={close}>
      {t(dirty && onDraftChange !== undefined ? 'taskForm.closeKeepDraft' : 'cancel')}</Button>
    {dirty && <Button disabled={busy} onClick={() => { setDiscard(true) }}>{t('taskForm.discardDraft')}</Button>}
    {busy && <Button onClick={() => { request.current?.abort(); setError(t('manage.cancelledRead')) }}>
      {t('detail.cancelRead')}</Button>}
    <Button form={`${id}-form`} type="submit" variant="primary" disabled={!canWrite || busy || revisionChanged || unavailable || reading
      || capabilityBlocked || dependenciesBlocked || draft.updateRetry !== undefined || isPreviousTaskUpdateUnchanged(draft)}>
      {title}</Button>
  </div>
  return <><Modal open onClose={close} title={title} closeLabel={t('cancel')} footer={footer} bodyClassName={css.managementContent ?? ''}>
    <form id={`${id}-form`} ref={form} noValidate className={css.managementForm} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <p className={css.muted}>{t('taskForm.draftRetention')}</p>
      {!canWrite && <p role="status">{t('taskForm.readOnlyRecovery')}</p>}
      {draft.updateRetry !== undefined && <div className={css.notice} role="status">
        <p>{t('taskForm.originalUnknown')}</p>
        <div className={css.actions}>
          <Button disabled={busy || detail?.disconnected || lookupTaskUpdate === undefined} onClick={() => { void recoverOriginal(false) }}>{t('taskForm.queryOriginal')}</Button>
          <Button disabled={!canWrite || busy || detail?.disconnected || lookupTaskUpdate === undefined}
            onClick={() => { void recoverOriginal(true) }}>{t('taskForm.retryOriginal')}</Button>
        </div>
      </div>}
      {notice !== undefined && <p role="status" className={css.notice}>{notice}</p>}
      {isPreviousTaskUpdateUnchanged(draft) && <p role="status">{t('taskForm.changeRejectedInput')}</p>}

      {detail?.record.error !== undefined && <p role="alert">{detail.record.error}</p>}
      {detail?.latest.error !== undefined && <p role="alert">{detail.latest.error}</p>}
      {refreshNeeded && (!revisionChanged || unavailable) && <Button disabled={refreshBlocked}
        onClick={() => { void readTaskDetail?.(detail.teamId, detail.taskId) }}>{t('taskView.refresh')}</Button>}
      {!canSubmit && <p className={css.notice} role="status">{t('taskForm.readOnlyTeam')}</p>}
      {unavailable && <p className={css.notice} role="status">{t(target.kind === 'taskUpdate' ? 'taskForm.updateUnavailable' : 'taskForm.unavailable')}</p>}
      {revisionChanged && !unavailable && <div className={css.notice} role="status">
        <p>{t('taskForm.changed')}</p>
        {detail?.hasNewer ? <p>{t('taskForm.currentUnavailable')}</p> : target.kind === 'taskUpdate' && task !== undefined &&
          <div className={css.changes}>
            <table aria-label={t('taskForm.comparison')}>
              <thead><tr><th>{t('taskForm.field')}</th><th>{t('taskForm.current')}</th><th>{t('taskForm.proposed')}</th></tr></thead>
              <tbody>{([
                { field: 'subject', current: task.subject, proposed: subject.trim() },
                { field: 'description', current: task.description, proposed: description.trim() },
                { field: 'dependencies', current: task.blockedBy.map(referenceLabel).join('\n'), proposed: blockedBy.map(referenceLabel).join('\n') },
              ] as const).map(row => <tr key={row.field}>
                <th scope="row">{t(`taskForm.${row.field}`)}<small>{t(row.current === row.proposed ? 'taskForm.unchanged' : 'taskForm.willReplace')}</small></th>
                <td><pre>{row.current || t('taskForm.emptyField')}</pre></td><td><pre>{row.proposed || t('taskForm.emptyField')}</pre></td>
              </tr>)}</tbody>
            </table>
          </div>}

        <Button disabled={refreshNeeded ? refreshBlocked : reading || dependenciesBlocked} onClick={() => {
          if (refreshNeeded) void readTaskDetail?.(detail.teamId, detail.taskId)
          else if (publishDraft({ ...draftRef.current, baselineRevision: task?.revision })) setError(undefined)
        }}>{t(refreshNeeded ? 'taskView.refresh' : 'taskForm.useLatest')}</Button>
      </div>}
      {target.kind === 'taskReview' ? <>
        <p><strong>{task?.subject}</strong></p>
        {reviewedAttempt?.outcome.kind === 'completed' && <div className={css.result}>
          <p>{reviewedAttempt.outcome.result.summary}</p>
          {reviewedAttempt.outcome.result.evidence?.map((evidence, index) => <p key={index}>{evidence}</p>)}
          {reviewedAttempt.outcome.result.verification !== undefined && <p>{t('detail.task.verification')}: {reviewedAttempt.outcome.result.verification}</p>}
        </div>}
        <fieldset className={css.managementChoices} disabled={busy}><legend>{t('taskForm.decision')}</legend>
          {(['accepted', 'rework'] as const).map(value => <label key={value}><input type="radio" name={`${id}-decision`} checked={decision === value} onChange={() => { setDecision(value) }} />{t(`taskForm.${value}`)}</label>)}
        </fieldset>
        <label htmlFor={`${id}-reason`}>{t('taskForm.reason')}</label>
        <textarea {...fieldA11y('reason')} className={`${css.managementText} clocky-resize-none`} rows={5} disabled={busy} value={reason} onChange={(event) => { setReason(event.target.value) }} />
      </> : <>
        <label htmlFor={`${id}-subject`}>{t('taskForm.subject')}</label>
        <Input {...fieldA11y('subject')} disabled={busy} value={subject} onChange={(event) => { setSubject(event.target.value) }} />
        <label htmlFor={`${id}-description`}>{t('taskForm.description')}</label>
        <textarea {...fieldA11y('description')} className={`${css.managementText} clocky-resize-none`} rows={5} disabled={busy} value={description} onChange={(event) => { setDescription(event.target.value) }} />
        <fieldset {...fieldA11y('dependencies')} tabIndex={-1} className={css.managementChoices} disabled={busy}>
          <legend>{t('taskForm.selectedDependencies')}</legend>
          {invalid === 'dependencies' && error !== undefined && <p id={`${id}-error`} className={css.error} role="alert">{error}</p>}
          {blockedBy.length === 0 && <p className={css.muted}>{t('taskForm.noDependencies')}</p>}
          {blockedBy.map((taskId) => {
            const row = references?.items.find(item => item.taskId === taskId)
            const unavailable = row?.state === 'unavailable' || row?.state === 'resolved' && row.phase === 'deleted'
            const label = row?.state === 'resolved' && row.phase === 'deleted' ? t('taskForm.deletedDependency', { taskId })
              : row?.state === 'unavailable' ? t('taskForm.unavailableDependency', { taskId })
                : row?.state === 'resolved' ? row.subject.text
                  : state.tasks.find(item => item.id === taskId && item.phase !== 'deleted')?.subject
                    ?? candidates?.page?.items.find(item => item.id === taskId)?.subject.text ?? t('taskForm.unloadedDependency', { taskId })
            return <label key={taskId}>
              <input type="checkbox" checked aria-invalid={unavailable} onChange={() => { setBlockedBy(previous => previous.filter(value => value !== taskId)) }} />
              {label}
            </label>
          })}
          {blockedBy.length > 0 && <>
            {watchTaskReferences === undefined && <p role="alert">{t('taskForm.referencesUnavailable')}</p>}
            {references?.loading && <p role="status">{t('taskForm.referencesLoading')}</p>}
            {references?.error !== undefined && <p role="alert">{references.error}</p>}
            {(references?.hasNewer || references?.disconnected) && <p role="status">{t('taskForm.referencesChanged')}</p>}
            {unavailableDependencies.length > 0 && <p role="alert">{t('taskForm.removeUnavailable')}</p>}
          </>}
          {referenceIds !== '[]' && refreshTaskReferences !== undefined && <Button disabled={busy || references?.loading || references?.disconnected}
            onClick={() => { void refreshTaskReferences() }}>{t('taskForm.referencesRefresh')}</Button>}
        </fieldset>
        <fieldset className={css.managementChoices} disabled={busy}><legend>{t('taskForm.addDependencies')}</legend>
          <label htmlFor={`${id}-dependency-search`}>{t('taskForm.searchDependencies')}</label>
          <Input id={`${id}-dependency-search`} value={dependencySearch}
            onChange={(event) => { setDependencySearch(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (!event.nativeEvent.isComposing) searchDependencies(dependencySearch)
              }
            }} />
          <div className={css.actions}>
            <Button disabled={readDependencies === undefined} onClick={() => { searchDependencies(dependencySearch) }}>{t('taskForm.search')}</Button>
            {dependencySearch !== '' && <Button onClick={() => {
              setDependencySearch(''); searchDependencies(''); document.getElementById(`${id}-dependency-search`)?.focus()
            }}>{t('taskForm.clearSearch')}</Button>}
            <Button disabled={readDependencies === undefined || candidates?.loading} onClick={() => {
              searchDependencies(candidates?.query.search ?? dependencySearch)
            }}>{t('taskForm.refreshDependencies')}</Button>
            {candidates?.page?.nextQueryCursor !== undefined && <Button
              disabled={candidates.loading || candidates.hasNewer || candidates.disconnected || candidates.error !== undefined}
              onClick={() => { void readDependencies?.(state.team.id, candidates.query, 'next') }}>{t('taskForm.nextDependencies')}</Button>}
          </div>
          {readDependencies === undefined && <p role="status">{t('taskForm.dependenciesUnavailable')}</p>}
          {candidates?.page !== undefined && <p className={css.muted}>{t('taskForm.dependencyCount', {
            count: candidates.page.items.length, total: candidates.page.total,
          })}</p>}
          {candidates?.loading && <p role="status">{t('taskForm.dependenciesLoading')}</p>}
          {candidates?.error !== undefined && <p role="alert">{candidates.error}</p>}
          {candidates?.disconnected && <p role="status">{t('taskForm.dependenciesDisconnected')}</p>}
          {candidates?.hasNewer && !candidates.disconnected && <p role="status">{t('taskForm.dependenciesChanged')}</p>}
          {candidates?.page !== undefined && !candidates.loading && candidates.error === undefined
            && candidates.page.items.length === 0 && <p role="status">{t(candidates.query.search.trim() === '' ? 'taskForm.dependenciesEmpty' : 'taskForm.dependenciesNoResults')}</p>}
          {candidates?.page !== undefined && !candidates.loading && candidates.error === undefined && candidates.page.items.length > 0
            && candidates.page.items.every(item => blockedBy.includes(item.id)) && <p role="status">{t('taskForm.dependenciesSelected')}</p>}
          {candidates?.page?.items.filter(item => !blockedBy.includes(item.id)).map(item => <label key={item.id}>
            <input type="checkbox" checked={false} disabled={candidates.loading || candidates.hasNewer || candidates.disconnected}
              onChange={() => { setBlockedBy(previous => [...previous, item.id]) }} />{item.subject.text}
          </label>)}
        </fieldset>
        {creating && <>
          <div aria-label={t('taskForm.executionOptions')}>
            {(authoring === undefined || authoring.loading && authoring.value === undefined) && <p role="status">{t(watchTaskCapabilities === undefined ? 'taskForm.optionsUnavailable' : 'taskForm.optionsLoading')}</p>}
            {authoring?.disconnected && <p role="status">{t('taskForm.optionsDisconnected')}</p>}
            {authoring?.error !== undefined && <p role="alert">{authoring.error}</p>}
            {refreshTaskCapabilities !== undefined && <Button aria-busy={authoring?.loading} disabled={authoring?.disconnected}
              onClick={() => { void refreshTaskCapabilities() }}>{t('taskForm.optionsRefresh')}</Button>}
            {options !== undefined && options.workspaceModes.every(item => !item.allowed) && <p role="status">{t('taskForm.noExecutionMode')}</p>}
            {options !== undefined && (!options.readScopes.accepted || !options.writeScopes.accepted) && !authoring?.loading
              && <p role="alert">{t('taskForm.scopesRejected')}</p>}
            {options?.create.reasons.map(reason => <p key={reason} role="status">{t(`taskForm.blocker.${reason}`)}</p>)}
          </div>
          <fieldset className={css.managementChoices} disabled={busy}><legend>{t('taskForm.workspace')}</legend>
            {options?.workspaceModes.filter(item => item.allowed).map(item => <label key={item.mode}>
              <input type="radio" name={`${id}-workspace`} checked={workspaceMode === item.mode} onChange={() => { setWorkspaceMode(item.mode) }} />
              {t(`taskForm.workspace.${item.mode}`)}
            </label>)}
          </fieldset>
          <details className={css.details}><summary>{t('taskForm.advanced')}</summary><div className={css.managementForm}>
            <fieldset className={css.managementChoices}><legend>{t('taskForm.unavailableModes')}</legend>
              {options?.workspaceModes.filter(item => !item.allowed).map(item => <label key={item.mode}>
                <input type="radio" disabled checked={workspaceMode === item.mode} name={`${id}-workspace`} />
                {t(`taskForm.workspace.${item.mode}`)} · {item.reasons.map(reason => t(`taskForm.blocker.${reason}`)).join(' · ')}
              </label>)}
            </fieldset>
            <details className={css.details}><summary>{t('taskForm.placement')}</summary>
              <fieldset className={css.managementChoices} disabled={busy}><legend>{t('taskForm.placementMembers')}</legend>
                {state.participants.filter(item => item.phase === 'active' && item.kind !== 'human').map(item => <label key={item.id}>
                  <input type="checkbox" checked={placementMembers.includes(item.id)} onChange={(event) => { setPlacementMembers(previous => event.target.checked ? [...previous, item.id] : previous.filter(value => value !== item.id)) }} />{item.displayName}
                </label>)}
              </fieldset>
              <div className={css.managementForm}>
                <label htmlFor={`${id}-placementRoles`}>{t('taskForm.placementRoles')}</label><Input id={`${id}-placementRoles`} disabled={busy} value={placementRoles} onChange={(event) => { setPlacementRoles(event.target.value) }} />
                <label htmlFor={`${id}-placementProviders`}>{t('taskForm.placementProviders')}</label><Input id={`${id}-placementProviders`} disabled={busy} value={placementProviders} onChange={(event) => { setPlacementProviders(event.target.value) }} />
                <label htmlFor={`${id}-placementPresets`}>{t('taskForm.placementPresets')}</label><Input id={`${id}-placementPresets`} disabled={busy} value={placementPresets} onChange={(event) => { setPlacementPresets(event.target.value) }} />
                <label htmlFor={`${id}-placementModels`}>{t('taskForm.placementModels')}</label><Input id={`${id}-placementModels`} disabled={busy} value={placementModels} onChange={(event) => { setPlacementModels(event.target.value) }} />
              </div>
            </details>
            <label htmlFor={`${id}-capabilities`}>{t('manage.capabilities')}</label><Input id={`${id}-capabilities`} disabled={busy} value={capabilities} onChange={(event) => { setCapabilities(event.target.value) }} />
            <label htmlFor={`${id}-readScopes`}>{t('taskForm.readScopes')}</label><textarea id={`${id}-readScopes`} aria-invalid={readScopeRejected} aria-describedby={`${id}-readScopes-help${readScopeRejected ? ` ${id}-readScopes-error` : ''}`} className={`${css.managementText} clocky-resize-none`} rows={3} disabled={busy || options?.readScopes.editable !== true} value={readScopes} onChange={(event) => { setReadScopes(event.target.value) }} />
            {readScopes !== '' && options?.readScopes.editable !== true && <Button disabled={busy} onClick={() => { setReadScopes('') }}>{t('taskForm.clearReadScopes')}</Button>}
            <p id={`${id}-readScopes-help`} className={css.muted}>{t(options?.readScopes.editable ? 'taskForm.scopeCheck' : 'taskForm.scopesUnavailable')}</p>
            {readScopeRejected && <p id={`${id}-readScopes-error`} role="alert">{t('taskForm.readScopeDenied')}</p>}
            <label htmlFor={`${id}-writeScopes`}>{t('taskForm.writeScopes')}</label><textarea id={`${id}-writeScopes`} aria-invalid={writeScopeRejected} aria-describedby={`${id}-writeScopes-help${writeScopeRejected ? ` ${id}-writeScopes-error` : ''}`} className={`${css.managementText} clocky-resize-none`} rows={3} disabled={busy || options?.writeScopes.editable !== true} value={writeScopes} onChange={(event) => { setWriteScopes(event.target.value) }} />
            {writeScopes !== '' && options?.writeScopes.editable !== true && <Button disabled={busy} onClick={() => { setWriteScopes('') }}>{t('taskForm.clearWriteScopes')}</Button>}
            <p id={`${id}-writeScopes-help`} className={css.muted}>{t(options?.writeScopes.editable ? 'taskForm.scopeCheck' : 'taskForm.scopesUnavailable')}</p>
            {writeScopeRejected && <p id={`${id}-writeScopes-error`} role="alert">{t('taskForm.writeScopeDenied')}</p>}
            <label htmlFor={`${id}-priority`}>{t('taskForm.priority')}</label><Input {...fieldA11y('priority')} type="number" step={1} disabled={busy} value={priority} onChange={(event) => { setPriority(event.target.value) }} />
            <label htmlFor={`${id}-maxAttempts`}>{t('taskForm.maxAttempts')}</label><Input {...fieldA11y('maxAttempts')} type="number" min={1} step={1} disabled={busy} value={maxAttempts} onChange={(event) => { setMaxAttempts(event.target.value) }} />
            <label htmlFor={`${id}-maxTokens`}>{t('taskForm.maxTokens')}</label><Input {...fieldA11y('maxTokens')} type="number" min={0} step={1} disabled={busy} value={maxTokens} onChange={(event) => { setMaxTokens(event.target.value) }} />
            <label htmlFor={`${id}-maxTurns`}>{t('taskForm.maxTurns')}</label><Input {...fieldA11y('maxTurns')} type="number" min={0} step={1} disabled={busy} value={maxTurns} onChange={(event) => { setMaxTurns(event.target.value) }} />
            <fieldset className={css.managementChoices} disabled={busy}><legend>{t('taskForm.reviewer')}</legend>
              <label><input type="radio" name={`${id}-reviewer`} checked={reviewer === undefined} onChange={() => { setReviewer(undefined) }} />{t('taskForm.noReview')}</label>
              {state.participants.filter(item => item.phase === 'active').map(item => <label key={item.id}><input type="radio" name={`${id}-reviewer`} checked={reviewer === item.id} onChange={() => { setReviewer(item.id) }} />{item.displayName} · {item.role}</label>)}
            </fieldset>
          </div></details>
        </>}
        {target.kind === 'taskIntegrate' && <>
          <fieldset id={`${id}-attempt`} tabIndex={-1} className={css.managementChoices} disabled={busy}><legend>{t('taskForm.sourceAttempt')}</legend>
            {detail !== undefined && readTaskDetail !== undefined && <>
              <Button size="sm" disabled={detail.attempts.loading || reading || revisionChanged}
                onClick={() => { void readTaskDetail(detail.teamId, detail.taskId, 'attempts', 'first') }}>{t('detail.firstPage')}</Button>
              {detail.attempts.value?.nextCursor !== undefined && <Button size="sm" disabled={detail.attempts.loading || reading || revisionChanged}
                onClick={() => { void readTaskDetail(detail.teamId, detail.taskId, 'attempts', 'next') }}>{t('taskView.nextHistory')}</Button>}
              {detail.attempts.error !== undefined && <p role="alert">{detail.attempts.error}</p>}
            </>}
            {completedAttempts.map(attempt => <label key={attempt.id}><input type="radio" name={`${id}-attempt`} checked={sourceAttemptId === attempt.id} onChange={() => { setSourceAttemptId(attempt.id) }} />{attempt.id}</label>)}
          </fieldset>
          <label htmlFor={`${id}-provider`}>{t('taskForm.integrationProvider')}</label><Input {...fieldA11y('provider')} disabled={busy} value={provider} onChange={(event) => { setProvider(event.target.value) }} />
          <label htmlFor={`${id}-target`}>{t('taskForm.integrationTarget')}</label><Input {...fieldA11y('target')} disabled={busy} value={integrationTarget} onChange={(event) => { setIntegrationTarget(event.target.value) }} />
          <label htmlFor={`${id}-expectedTarget`}>{t('taskForm.expectedTarget')}</label><Input {...fieldA11y('expectedTarget')} disabled={busy} value={expectedTarget} onChange={(event) => { setExpectedTarget(event.target.value) }} />
          <fieldset className={css.managementChoices} disabled={busy}><legend>{t('taskForm.integrationMode')}</legend>
            {(['proposal', 'integrate'] as const).map(value => <label key={value}><input type="radio" name={`${id}-integration`} checked={integrationMode === value} onChange={() => { setIntegrationMode(value) }} />{t(`taskForm.${value}`)}</label>)}
          </fieldset>
          {integrationMode === 'integrate' && <p className={css.notice}>{t('taskForm.integrationWarning')}</p>}
        </>}
      </>}
      {invalid !== 'dependencies' && error !== undefined && <p id={`${id}-error`} className={css.error} role="alert">{error}</p>}
      {busy && <p className={css.muted} role="status">{t('manage.pending')}</p>}

    </form>
  </Modal>
  {discard && <Modal open title={t('taskForm.discardDraft')} closeLabel={t('cancel')} onClose={() => { setDiscard(false) }}
    footer={<><Button onClick={() => { setDiscard(false) }}>{t('taskForm.continueEditing')}</Button>
      <Button onClick={() => { onDraftDiscard?.(); onClose() }}>{t('taskForm.discardAndClose')}</Button></>}>
    <p>{t('taskForm.discardConfirm')}</p>
  </Modal>}
  </>
}

/** Normalize user-entered capability names without retaining duplicate constraints. */
function commaList(value: string): string[] { return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))] }

/** Preserve spaces inside a workspace path while treating each line as one scope. */
function pathLines(value: string): string[] { return [...new Set(value.split('\n').map(item => item.trim()).filter(Boolean))] }

/* v8 ignore next 2 -- Runtime lookup schemas accept only the three closed outcome tags. */
/** Require explicit handling when the original-update outcome protocol grows. */
function assertNever(value: never): never { void value; throw new Error('Unhandled task update outcome') }
