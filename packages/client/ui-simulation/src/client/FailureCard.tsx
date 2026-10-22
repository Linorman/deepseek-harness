/**
 * Scheduler failure card driven only by the Host's safe failure facts (category, time, revision, retry disposition, action code).
 * It answers which stage failed, whether anything still executes, whether completed results are kept and the next step;
 * provider messages and private diagnostics are never rendered, only the failure identity for authorized correlation.
 */
import { Button, writeClipboard } from '@clocky/clocky-client-ui-primitives'
import type { Key } from './locales.ts'
import type { RunFailure, RunState } from './run-state.ts'
import css from './Workspace.module.css'

type Translate = (key: Key, params?: Record<string, string>) => string
/** Stage that failed, from the failure category. */
type FailureStage = 'provider' | 'admission' | 'protocol' | 'history' | 'unknown'
/** The one next step a failure suggests; `details` is the documented default for any unrecognized code. */
export type FailureNextStep = 'resume' | 'account' | 'context' | 'budget' | 'protocol' | 'read-limit' | 'storage' | 'integrity' | 'details'

/**
 * Stage of a failure category.
 * @param category - Safe Host failure category.
 * @returns the execution stage it belongs to.
 */
export function failureStage(category: RunFailure['category']): FailureStage {
  switch (category) {
    case 'payment-required': case 'insufficient-balance': case 'rate-limited': case 'network': case 'provider-unavailable': return 'provider'
    case 'context-limit': case 'request-budget': case 'token-overrun': return 'admission'
    case 'protocol-unavailable': return 'protocol'
    case 'history-limit': case 'storage': case 'integrity': return 'history'
    case 'unknown': return 'unknown'
    default: { const unreachable: never = category; throw new Error(`Unknown failure category ${String(unreachable)}`) }
  }
}

/**
 * Next step of a failure. Resuming is offered only for an explicit-resume disposition; a code this client does not know
 * (a newer Host) falls back to `details`, which only opens the run details.
 * @param failure - Safe Host failure facts.
 * @returns the suggested next step.
 */
export function failureNextStep(failure: Pick<RunFailure, 'actionCode' | 'retryDisposition'>): FailureNextStep {
  const code: string = failure.actionCode
  switch (code) {
    case 'resume-explicitly': return failure.retryDisposition === 'explicit-resume' ? 'resume' : 'details'
    case 'check-account': return 'account'
    case 'review-context': return 'context'
    case 'review-budget': return 'budget'
    case 'repair-protocol': return 'protocol'
    case 'raise-read-limit': return 'read-limit'
    case 'repair-storage': return 'storage'
    case 'inspect-integrity': return 'integrity'
    default: return 'details'
  }
}

/**
 * @param props.failure - Safe failure facts from the control or its directory projection.
 * @param props.state - Synthesized run state; supplies whether accepted work still executes.
 * @param props.resume - Open the explicit Continue confirmation; offered only for an explicit-resume failure.
 * @param props.details - Open the run details.
 * @param props.history - Open the run's history records.
 * @param props.time - Formats the real failure time.
 * @returns a card answering the four questions, or the reason a retry is not offered.
 */
export function FailureCard({ failure, state, resume, details, history, time, t }: {
  failure: RunFailure
  state: RunState
  resume?: (() => void) | undefined
  details: () => void
  history?: (() => void) | undefined
  time: (at: number) => string
  t: Translate
}) {
  const stage = failureStage(failure.category)
  const next = failureNextStep(failure)
  const retryAfter = failure.providerRetryAfterMs === undefined ? undefined : String(Math.ceil(failure.providerRetryAfterMs / 1000))
  return <section className={css.failureCard} aria-label={t('failure.title')} data-failure-category={failure.category}>
    <h2>{t('failure.title')} · {t(`failure.category.${failure.category}`)}</h2>
    <dl>
      <div><dt>{t('failure.stage')}</dt><dd>{t(`failure.stage.${stage}`)}</dd></div>
      <div><dt>{t('failure.executing')}</dt><dd>{t(state.inFlight === true ? 'failure.executing.yes' : 'failure.executing.no')}</dd></div>
      <div><dt>{t('failure.kept')}</dt><dd>{t('failure.kept.value')}</dd></div>
      <div><dt>{t('failure.next')}</dt><dd>{t(`failure.next.${next}`)}{retryAfter !== undefined && ` ${t('failure.retryAfter', { seconds: retryAfter })}`}</dd></div>
      <div><dt>{t('failure.when')}</dt><dd>{time(failure.occurredAt)} · {t('revision')} {failure.revision}</dd></div>
    </dl>
    <div className={css.actions}>
      {next === 'resume' && resume !== undefined && <Button variant="primary" onClick={resume}>{t('failure.resume')}</Button>}
      {next === 'integrity' && history !== undefined && <Button variant="secondary" onClick={history}>{t('failure.openHistory')}</Button>}
      <Button variant={next === 'resume' ? 'secondary' : 'primary'} onClick={details}>{t('failure.details')}</Button>
      <Button variant="ghost" onClick={() => { void writeClipboard(failure.failureId) }}>{t('failure.copyId')}</Button>
    </div>
    {next !== 'resume' && <p className={css.muted}>{t('failure.noRetry')}</p>}
  </section>
}
