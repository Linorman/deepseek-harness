/** Revision-fenced task authoring, review, and artifact integration forms. */

import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Modal } from '@clocky/clocky-client-ui-primitives'
import type { ParticipantId, TeamManagementCommand, TeamTaskId, TeamTaskSelection } from '@clocky/clocky-client-runtime/client'
import type { TeamKey } from './locales.ts'
import css from './TeamBrowser.module.css'

type CreateInput = Extract<TeamManagementCommand, { operation: 'taskCreate' }>['input']

/** Task form target; integration retains its exact source task. */
export type TeamTaskDialogTarget = { readonly kind: 'taskCreate' }
  | { readonly kind: 'taskUpdate' | 'taskReview' | 'taskIntegrate'; readonly taskId: TeamTaskId }

/**
 * Render task instructions and policy inputs against the current Team projection.
 * @param props - task target, current Team, locale, and authenticated mutation owner.
 * @returns an application dialog retaining fields across rejected mutations.
 */
export function TeamTaskDialog({ target, state, translate: t, manage, onClose }: {
  readonly target: TeamTaskDialogTarget
  readonly state: TeamTaskSelection['state']
  readonly translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  readonly manage: (command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>
  readonly onClose: () => void
}) {
  const id = useId()
  const task = 'taskId' in target ? state.tasks.find(item => item.id === target.taskId) : undefined
  const [baselineRevision, setBaselineRevision] = useState(task?.revision)
  const revisionChanged = !['taskCreate', 'taskIntegrate'].includes(target.kind) && task?.revision !== baselineRevision
  const unavailable = (target.kind === 'taskReview' && task?.phase !== 'review')
    || (target.kind === 'taskUpdate' && (task?.phase !== 'pending' || task.lease !== undefined))
    || (target.kind === 'taskIntegrate' && task?.phase !== 'completed')
  const reviewedAttempt = task?.attemptHistory.at(-1)
  const creating = target.kind === 'taskCreate' || target.kind === 'taskIntegrate'
  const [subject, setSubject] = useState(target.kind === 'taskIntegrate' ? t('taskForm.integrateSubject', { subject: task?.subject ?? '' }) : task?.subject ?? '')
  const [description, setDescription] = useState(target.kind === 'taskIntegrate' ? '' : task?.description ?? '')
  const [blockedBy, setBlockedBy] = useState<readonly TeamTaskId[]>(() => target.kind === 'taskIntegrate' && task !== undefined ? [task.id] : task?.blockedBy ?? [])
  const [workspaceMode, setWorkspaceMode] = useState<CreateInput['workspaceMode']>('shared')
  const [priority, setPriority] = useState('0')
  const [maxAttempts, setMaxAttempts] = useState('1')
  const [capabilities, setCapabilities] = useState('')
  const [readScopes, setReadScopes] = useState('')
  const [writeScopes, setWriteScopes] = useState('')
  const [reviewer, setReviewer] = useState<ParticipantId | undefined>()
  const [decision, setDecision] = useState<'accepted' | 'rework'>('accepted')
  const [reason, setReason] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [maxTurns, setMaxTurns] = useState('')
  const [placementMembers, setPlacementMembers] = useState<readonly ParticipantId[]>([])
  const [placementRoles, setPlacementRoles] = useState('')
  const [placementProviders, setPlacementProviders] = useState('')
  const [placementPresets, setPlacementPresets] = useState('')
  const [placementModels, setPlacementModels] = useState('')
  const [provider, setProvider] = useState('')
  const [integrationTarget, setIntegrationTarget] = useState('')
  const [expectedTarget, setExpectedTarget] = useState('')
  const [integrationMode, setIntegrationMode] = useState<'proposal' | 'integrate'>('proposal')
  const completedAttempts = task?.attemptHistory.filter(attempt => attempt.outcome.kind === 'completed') ?? []
  const [sourceAttemptId, setSourceAttemptId] = useState(completedAttempts.at(-1)?.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [invalid, setInvalid] = useState<string | undefined>()
  const request = useRef<AbortController | undefined>()
  const key = useRef(crypto.randomUUID())
  const fingerprint = useRef<string | undefined>()
  const form = useRef<HTMLFormElement | null>(null)
  const title = t(`taskForm.${target.kind}`)

  useEffect(() => {
    const previous = document.activeElement
    form.current?.closest('dialog')?.querySelector<HTMLButtonElement>('[data-task-dialog-cancel]')?.focus()
    return () => { request.current?.abort(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])

  const fail = (field: string, message: string): void => {
    setInvalid(field); setError(message); document.getElementById(`${id}-${field}`)?.focus()
  }
  const fieldA11y = (field: string) => ({
    id: `${id}-${field}`, 'aria-invalid': invalid === field,
    'aria-describedby': invalid === field ? `${id}-error` : undefined,
  })
  const submit = async (): Promise<void> => {
    if (request.current !== undefined || revisionChanged || unavailable) return
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
        command = { operation: 'taskUpdate', input: {
          taskId: task.id, expectedRevision: baselineRevision, subject: subject.trim(), description: description.trim(), blockedBy,
        } }
      } else {
        const parsedPriority = Number(priority)
        const parsedMaxAttempts = Number(maxAttempts)
        if (priority.trim() === '' || !Number.isSafeInteger(parsedPriority)) { fail('priority', t('taskForm.integerRequired')); return }
        if (!Number.isSafeInteger(parsedMaxAttempts) || parsedMaxAttempts < 1) { fail('maxAttempts', t('taskForm.positiveRequired')); return }
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
        if (fingerprint.current !== undefined && fingerprint.current !== nextFingerprint) key.current = crypto.randomUUID()
        fingerprint.current = nextFingerprint
        command = { operation: 'taskCreate', input: {
          ...input, expectedCursor: state.team.cursor, idempotencyKey: key.current as CreateInput['idempotencyKey'],
        } }
      }
    }
    const controller = new AbortController()
    request.current = controller; setBusy(true)
    try { await manage(command, controller.signal); if (!controller.signal.aborted) onClose() }
    catch (cause: unknown) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (request.current === controller) { request.current = undefined; setBusy(false) } }
  }
  const close = (): void => { if (!busy) onClose() }
  const footer = <div className={css.actions}>
    <Button data-task-dialog-cancel disabled={busy} onClick={close}>{t('cancel')}</Button>
    {busy && <Button onClick={() => { request.current?.abort(); setError(t('manage.cancelledRead')) }}>{t('detail.cancelRead')}</Button>}
    <Button form={`${id}-form`} type="submit" variant="primary" disabled={busy || revisionChanged || unavailable}>{title}</Button>
  </div>
  return <Modal open onClose={close} title={title} closeLabel={t('cancel')} footer={footer} bodyClassName={css.managementContent ?? ''}>
    <form id={`${id}-form`} ref={form} noValidate className={css.managementForm} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      {unavailable && <p className={css.notice} role="status">{t('taskForm.unavailable')}</p>}
      {revisionChanged && !unavailable && <div className={css.notice} role="status">
        <p>{t('taskForm.changed')}</p>
        {target.kind === 'taskUpdate' && <p>{task?.subject} · {task?.description}</p>}
        <Button onClick={() => { setBaselineRevision(task?.revision); setError(undefined) }}>{t('taskForm.useLatest')}</Button>
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
        <fieldset className={css.managementChoices} disabled={busy}><legend>{t('taskForm.dependencies')}</legend>
          {state.tasks.filter(item => item.phase !== 'deleted' && (target.kind !== 'taskUpdate' || item.id !== target.taskId)).map(item => <label key={item.id}>
            <input type="checkbox" checked={blockedBy.includes(item.id)} onChange={(event) => { setBlockedBy(previous => event.target.checked ? [...previous, item.id] : previous.filter(value => value !== item.id)) }} />{item.subject}
          </label>)}
          {blockedBy.filter(taskId => !state.tasks.some(item => item.id === taskId)).map(taskId => <p key={taskId} className={css.notice}>{t('taskForm.unloadedDependency', { taskId })}</p>)}
        </fieldset>
        {creating && <>
          <fieldset className={css.managementChoices} disabled={busy}><legend>{t('taskForm.workspace')}</legend>
            {(['shared', 'worktree', 'sandbox', 'remote'] as const).map(value => <label key={value}><input type="radio" name={`${id}-workspace`} checked={workspaceMode === value} onChange={() => { setWorkspaceMode(value) }} />{t(`taskForm.workspace.${value}`)}</label>)}
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
          <label htmlFor={`${id}-readScopes`}>{t('taskForm.readScopes')}</label><textarea id={`${id}-readScopes`} className={`${css.managementText} clocky-resize-none`} rows={3} disabled={busy} value={readScopes} onChange={(event) => { setReadScopes(event.target.value) }} />
          <label htmlFor={`${id}-writeScopes`}>{t('taskForm.writeScopes')}</label><textarea id={`${id}-writeScopes`} className={`${css.managementText} clocky-resize-none`} rows={3} disabled={busy} value={writeScopes} onChange={(event) => { setWriteScopes(event.target.value) }} />
          <label htmlFor={`${id}-priority`}>{t('taskForm.priority')}</label><Input {...fieldA11y('priority')} type="number" step={1} disabled={busy} value={priority} onChange={(event) => { setPriority(event.target.value) }} />
          <label htmlFor={`${id}-maxAttempts`}>{t('taskForm.maxAttempts')}</label><Input {...fieldA11y('maxAttempts')} type="number" min={1} step={1} disabled={busy} value={maxAttempts} onChange={(event) => { setMaxAttempts(event.target.value) }} />
          <label htmlFor={`${id}-maxTokens`}>{t('taskForm.maxTokens')}</label><Input {...fieldA11y('maxTokens')} type="number" min={0} step={1} disabled={busy} value={maxTokens} onChange={(event) => { setMaxTokens(event.target.value) }} />
          <label htmlFor={`${id}-maxTurns`}>{t('taskForm.maxTurns')}</label><Input {...fieldA11y('maxTurns')} type="number" min={0} step={1} disabled={busy} value={maxTurns} onChange={(event) => { setMaxTurns(event.target.value) }} />
          <fieldset className={css.managementChoices} disabled={busy}><legend>{t('taskForm.reviewer')}</legend>
            <label><input type="radio" name={`${id}-reviewer`} checked={reviewer === undefined} onChange={() => { setReviewer(undefined) }} />{t('taskForm.noReview')}</label>
            {state.participants.filter(item => item.phase === 'active').map(item => <label key={item.id}><input type="radio" name={`${id}-reviewer`} checked={reviewer === item.id} onChange={() => { setReviewer(item.id) }} />{item.displayName} · {item.role}</label>)}
          </fieldset>
        </>}
        {target.kind === 'taskIntegrate' && <>
          <fieldset id={`${id}-attempt`} tabIndex={-1} className={css.managementChoices} disabled={busy}><legend>{t('taskForm.sourceAttempt')}</legend>
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
      {error !== undefined && <p id={`${id}-error`} className={css.error} role="alert">{error}</p>}
      {busy && <p className={css.muted} role="status">{t('manage.pending')}</p>}

    </form>
  </Modal>
}

/** Normalize user-entered capability names without retaining duplicate constraints. */
function commaList(value: string): string[] { return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))] }

/** Preserve spaces inside a workspace path while treating each line as one scope. */
function pathLines(value: string): string[] { return [...new Set(value.split('\n').map(item => item.trim()).filter(Boolean))] }
