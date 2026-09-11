/** Durable approval/question controls; accepted answers do not imply tool completion. */

import { useEffect, useId, useRef, useState } from 'react'
import { Button, MarkdownText } from '@clocky/clocky-client-ui-primitives'
import type { TeamActionResponseInput, TeamActionResponseResult, TeamHumanAction } from '@clocky/clocky-client-runtime/client'
import type { TeamKey } from './locales.ts'
import css from './TeamBrowser.module.css'

type Action = TeamActionResponseResult['action']
type Question = Extract<TeamHumanAction, { kind: 'question' }>['questions'][number]
type AnswerDraft = { readonly selected: readonly string[]; readonly custom: string }

/**
 * Render a durable request and admit one revision-fenced answer through its Host owner.
 * @param props - current action, authenticated callbacks, and parent dialog interaction-state callbacks.
 * @returns current request facts, answer controls, and truthful acceptance/unavailability feedback.
 */
export function HumanActionCard({ action, translate: t, respond, confirm, openContext, onDirtyChange, onBusyChange }: {
  readonly action: Action
  readonly translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  readonly respond: (input: TeamActionResponseInput, signal?: AbortSignal) => Promise<TeamActionResponseResult>
  readonly confirm?: (action: Action, signal?: AbortSignal) => Promise<Action>
  readonly openContext?: (action: Action) => void | Promise<void>
  readonly onDirtyChange?: (dirty: boolean) => void
  readonly onBusyChange?: (busy: boolean) => void
}) {
  const id = useId()
  const [drafts, setDrafts] = useState<Readonly<Record<string, AnswerDraft>>>({})
  const [confirmedAt, setConfirmedAt] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [result, setResult] = useState<TeamActionResponseResult | undefined>()
  const [invalidQuestion, setInvalidQuestion] = useState<string | undefined>()
  const request = useRef<AbortController | undefined>()
  const retry = useRef<{ fingerprint: string; key: TeamActionResponseInput['idempotencyKey'] } | undefined>()
  const questions = action.kind === 'question' ? readQuestions(action.details.questions) : []
  const answerAccepted = action.response !== undefined || result?.kind === 'accepted'
  const available = action.phase === 'pending' && !answerAccepted && result?.kind !== 'unavailable'
  const verified = confirm === undefined || confirmedAt === action.updatedAt

  useEffect(() => () => {
    request.current?.abort()
    onDirtyChange?.(false)
    onBusyChange?.(false)
  }, [])

  const setDraft = (questionId: string, next: AnswerDraft): void => {
    const updated = { ...drafts, [questionId]: next }
    setDrafts(updated)
    onDirtyChange?.(Object.values(updated).some(value => value.selected.length > 0 || value.custom.trim().length > 0))
  }
  const updateBusy = (value: boolean): void => { setBusy(value); onBusyChange?.(value) }
  const confirmCurrent = async (): Promise<void> => {
    if (confirm === undefined || request.current !== undefined) return
    const controller = new AbortController()
    request.current = controller; updateBusy(true); setError(undefined)
    try {
      const current = await confirm(action, controller.signal)
      if (!controller.signal.aborted) setConfirmedAt(current.updatedAt)
    } catch (cause: unknown) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (request.current === controller) { request.current = undefined; updateBusy(false) } }
  }
  const answer = async (value: TeamActionResponseInput['answer']): Promise<void> => {
    if (!available || !verified || request.current !== undefined) return
    const fingerprint = JSON.stringify({ updatedAt: action.updatedAt, answer: value })
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() as TeamActionResponseInput['idempotencyKey'] }
    const controller = new AbortController()
    request.current = controller; updateBusy(true); setError(undefined)
    try {
      const accepted = await respond({ teamId: action.teamId, actionId: action.id, expectedUpdatedAt: action.updatedAt,
        idempotencyKey: retry.current.key, answer: value }, controller.signal)
      if (!controller.signal.aborted) { setResult(accepted); onDirtyChange?.(false) }
    } catch (cause: unknown) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (request.current === controller) { request.current = undefined; updateBusy(false) } }
  }
  const submitQuestions = async (): Promise<void> => {
    if (questions === undefined) return
    const answers = []
    for (const question of questions) {
      const draft = drafts[question.id] ?? { selected: [], custom: '' }
      if (draft.selected.length === 0 && !draft.custom.trim()) {
        setInvalidQuestion(question.id)
        setError(t('human.answerRequired'))
        document.getElementById(`${id}-${question.id}`)?.focus()
        return
      }
      answers.push({ id: question.id, selected: draft.selected, ...draft.custom.trim() ? { custom: draft.custom.trim() } : {} })
    }
    setInvalidQuestion(undefined)
    await answer({ kind: 'question', answers })
  }
  const inspectContext = async (): Promise<void> => {
    try { await openContext?.(action) }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <article className={css.humanAction} aria-label={t(action.kind === 'approval' ? 'detail.approval' : 'detail.question')}>
    <strong>{t(action.kind === 'approval' ? 'detail.approval' : 'detail.question')}</strong>
    {action.kind === 'approval' && <>
      {typeof action.details.toolName === 'string' && <p>{action.details.toolName}</p>}
      {typeof action.details.reason === 'string' && <p className={css.humanText}>{action.details.reason}</p>}
      {typeof action.details.callId === 'string' && <small>{t('human.call')}: {action.details.callId}</small>}
    </>}
    {action.kind === 'question' && questions === undefined && <p className={css.notice}>{t('human.unsupported')}</p>}
    {action.kind === 'question' && questions?.map((question) => {
      const draft = drafts[question.id] ?? { selected: [], custom: '' }
      return <fieldset key={question.id} id={`${id}-${question.id}`} tabIndex={-1} className={css.managementChoices}
        disabled={!available || !verified || busy} aria-invalid={invalidQuestion === question.id}
        aria-describedby={invalidQuestion === question.id ? `${id}-error` : undefined}>
        <legend>{question.question}</legend>
        {question.detail !== undefined && <MarkdownText text={question.detail} />}
        {question.options?.map(option => <label key={option.label}>
          <input type={question.multiSelect ? 'checkbox' : 'radio'} name={`${id}-${question.id}`} checked={draft.selected.includes(option.label)}
            onChange={(event) => {
              const selected = question.multiSelect
                ? event.target.checked ? [...draft.selected, option.label] : draft.selected.filter(value => value !== option.label)
                : [option.label]
              setDraft(question.id, { selected, custom: question.multiSelect ? draft.custom : '' })
            }} />
          <span>{option.label}{option.description !== undefined && <small>{option.description}</small>}</span>
        </label>)}
        <label htmlFor={`${id}-${question.id}-custom`}>{t('human.customAnswer')}</label>
        <textarea id={`${id}-${question.id}-custom`} rows={3} className={`${css.managementText} clocky-resize-none`} value={draft.custom}
          onChange={(event) => {
            setDraft(question.id, { selected: question.multiSelect ? draft.selected : [], custom: event.target.value })
          }} />
      </fieldset>
    })}
    {answerAccepted && <p className={css.notice} role="status">{t('human.accepted')}</p>}
    {result?.kind === 'unavailable' && <p className={css.notice} role="status">{t('human.unavailable')}</p>}
    {action.phase === 'cancelled' && result?.kind !== 'unavailable' && <p className={css.notice} role="status">
      {t('human.cancelled')}
    </p>}
    {action.phase === 'resolved' && !answerAccepted && <p className={css.notice} role="status">{t('human.resolved')}</p>}
    {error !== undefined && <p id={`${id}-error`} className={css.error} role="alert">{error}</p>}
    {busy && <p className={css.muted} role="status">{t('manage.pending')}</p>}
    <div className={css.actions}>
      {openContext !== undefined && <Button disabled={busy} onClick={() => { void inspectContext() }}>{t('human.context')}</Button>}
      {available && !verified && <Button disabled={busy} onClick={() => { void confirmCurrent() }}>{t('human.confirmCurrent')}</Button>}
      {available && verified && action.kind === 'approval' && <>
        <Button disabled={busy} onClick={() => { void answer({ kind: 'approval', outcome: 'rejected' }) }}>{t('human.reject')}</Button>
        <Button disabled={busy} onClick={() => { void answer({ kind: 'approval', outcome: 'allowed-once' }) }}>{t('human.allowOnce')}</Button>
      </>}
      {available && verified && action.kind === 'question' && questions !== undefined && <Button disabled={busy} onClick={() => { void submitQuestions() }}>{t('human.submitAnswer')}</Button>}
      {busy && <Button onClick={() => { request.current?.abort(); setError(t('manage.cancelledRead')) }}>{t('detail.cancelRead')}</Button>}
    </div>
  </article>
}

/** Decode the standard question view inside extension-owned action details without inventing missing choices. */
function readQuestions(value: unknown): readonly Question[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const result: Question[] = []
  const ids = new Set<string>()
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || typeof entry.question !== 'string') return undefined
    if (entry.detail !== undefined && typeof entry.detail !== 'string') return undefined
    if (entry.header !== undefined && typeof entry.header !== 'string') return undefined
    if (entry.multiSelect !== undefined && typeof entry.multiSelect !== 'boolean') return undefined
    const options: NonNullable<Question['options']> = []
    if (entry.options !== undefined) {
      if (!Array.isArray(entry.options)) return undefined
      for (const option of entry.options) {
        if (!isRecord(option) || typeof option.label !== 'string'
          || (option.description !== undefined && typeof option.description !== 'string')) return undefined
        options.push({ label: option.label, ...option.description === undefined ? {} : { description: option.description } })
      }
    }
    ids.add(entry.id)
    result.push({ id: entry.id, question: entry.question,
      ...entry.options === undefined ? {} : { options },
      ...entry.detail === undefined ? {} : { detail: entry.detail },
      ...entry.header === undefined ? {} : { header: entry.header },
      ...entry.multiSelect === undefined ? {} : { multiSelect: entry.multiSelect },
    })
  }
  return result
}

/** Extension-owned details must be JSON objects before field projection. */
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
