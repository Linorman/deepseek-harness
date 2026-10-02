import { CheckpointDiagnostic } from './CheckpointDiagnostic.tsx'
import type { Route } from './store.ts'
/** Original-operation feedback distinguishes unknown transport outcome, durable receipt and current execution. */
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { SimulationCommandState } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

/**
 * Show the original receipt and explicit query/retry controls without allocating another command.
 * @param props - Runtime-owned original record and user-triggered exact operations.
 * @returns accessible original-result feedback; no current scheduling phase is inferred.
 */
export function CommandRecord({ value, connected, query, retry, t, navigate, navigateApplication, alwaysQuery = false }: {
  alwaysQuery?: boolean
  navigate?: ((next: Route) => void) | undefined
  navigateApplication?: ((href: string) => void) | undefined
  value: SimulationCommandState
  connected: boolean
  query: () => Promise<SimulationCommandState | undefined>
  retry: () => Promise<SimulationCommandState | undefined>
  t: (key: Key) => string
}) {
  const input = value.command.input
  const id = 'commandId' in input ? input.commandId : 'managementId' in input ? input.managementId : input.ingressId
  const result = value.receipt
  const kind = value.command.kind === 'retry-request' && result?.kind === 'request' ? result.value.kind : value.command.kind
  const observation = value.requestObservation
  const authoritativeTerminal = observation !== undefined && observation.status !== 'accepted'
  const retryBlocked = value.requestObservationUnavailable || authoritativeTerminal || observation?.comparison === 'conflict'
  const unresolved = value.requestObservationUnavailable || value.unknown || result === undefined || result.value.status === 'accepted' || result.value.status === 'in-progress'
    || observation?.comparison === 'conflict'
    || result.kind === 'ingress' && (result.value.status === 'pending' || result.value.status === 'claimed')
  const receiptContent = result === undefined ? null : <>
    <p>{t('originalResult')}: {t(`receipt.${result.value.status}`)}</p>
    {value.command.kind === 'retry-operation' && result.kind === 'request' && result.value.status === 'completed'
      && <p>{t('operationRetry.granted')}</p>}
    {result.kind === 'request' && result.value.diagnostic !== undefined && <CheckpointDiagnostic value={result.value.diagnostic}
      runId={result.value.runId} t={t} navigate={navigate} navigateApplication={navigateApplication} />}
    {result.kind === 'request' && result.value.failure !== undefined && <p>{t(`requestFailure.${result.value.failure}`)}</p>}
  </>
  return <section className={css.command} aria-label={t('originalCommand')}>
    <h3>{t(`command.${kind}`)}</h3>
    <code>{id}</code>{value.command.kind === 'restore' && <p>{t('checkpointId')}: <code>{value.command.input.checkpointId}</code></p>}
    {value.command.kind === 'retry-operation' && <p><code>{value.command.input.operationId}</code> · {t('operationRetry.fence')}: {value.command.input.expectedAttemptCount}</p>}
    {value.command.kind === 'review' && <p><code>{value.command.input.operationId}</code> · <code>{value.command.input.attemptId}</code>
      · {t('reviews.revision')}: {value.command.input.expectedRevision} · {t(value.command.input.nextPhase === 'completed' ? 'reviews.approve' : 'reviews.rework')}</p>}
    {value.command.kind === 'manage' && <p>{t(value.command.input.phase)}</p>}
    <div aria-live="polite">
      {value.requestObservationUnavailable && <p role="status">{t('requests.capacity')}</p>}
      {value.pending && <p>{t('commandPending')}</p>}
      {value.unknown && !authoritativeTerminal && <p>{t('commandUnknown')}</p>}
      {value.notFound && <p>{t('commandNotFound')}</p>}
      {value.error !== undefined && <p role="alert">{t(authoritativeTerminal ? 'requests.queryFailed' : `commandError.${value.error}`)}</p>}
      {result?.kind === 'ingress' && <><p>{t('inputAssignedAt')}: {result.value.assignedAt}</p>
        <p>{t('inputEntity')}: {result.value.entityId}</p>
        {result.value.decisionId !== undefined && <p>{t('inputDecision')}: <code>{result.value.decisionId}</code></p>}</>}
      {result?.kind === 'request' && result.value.checkpointId !== undefined && <p>{t('checkpointId')}: <code>{result.value.checkpointId}</code></p>}
      {observation !== undefined && <div>
        <p>{t('requests.observed')}: {t(`receipt.${observation.status}`)}</p>
        <p>{t(`requests.comparison.${observation.comparison}`)}</p>
        <small>{t('requests.journalRevision')}: {observation.journalRevision}</small>
        {observation.stale && <small>{t('requests.retainedObservation')}</small>}
      </div>}
      {value.requestObservationUnavailable || observation?.comparison === 'receipt-older' || observation?.comparison === 'conflict'
        ? <details><summary>{t(value.requestObservationUnavailable || observation?.comparison === 'conflict' ? 'requests.localReceipt' : 'requests.earlierReceipt')}</summary>{receiptContent}</details>
        : receiptContent}
    </div>
    {unresolved && <div className={css.actions}>
      <Button disabled={!connected || value.pending} aria-busy={value.pending} onClick={() => { void query() }}>{t('queryOriginal')}</Button>
      {!retryBlocked && <Button variant="outline" disabled={!connected || value.pending} aria-busy={value.pending} onClick={() => { void retry() }}>{t('retryOriginal')}</Button>}
    </div>}
    {!unresolved && (alwaysQuery || result.kind === 'request' && result.value.diagnostic !== undefined) && <Button disabled={!connected || value.pending} aria-busy={value.pending}
      onClick={() => { void query() }}>{t('queryOriginal')}</Button>}
  </section>
}
