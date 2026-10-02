import { CheckpointDiagnostic } from './CheckpointDiagnostic.tsx'
/** Explicit metadata sections preserve independent execution, publication and receipt outcomes. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { SimulationProductObjectDetail, SimulationProductCursor } from '@clocky/clocky-client-runtime/client'
import type { Route } from './store.ts'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'
import { KnowledgeDetails } from './KnowledgeDetails.tsx'
import { TeamReference } from './TeamReference.tsx'
import { ContextAndRelations, DetailPagination } from './ContextAndRelations.tsx'
type Translate = (key: Key) => string

/**
 * @param props - One authorized section with view navigation and bounded continuation.
 * @returns metadata only; references never authorize Team/Session content.
 */
export function ObjectDetails({ value, t, date, view, navigate, readPage, blocked, canContinue, navigateApplication, openRetry }: {
  openRetry?: ((operationId: string, expectedAttemptCount: number) => void) | undefined
  value: SimulationProductObjectDetail
  t: Translate
  date: (value: number) => string
  view: Route
  navigate: (next: Route) => void
  readPage: (cursor?: SimulationProductCursor) => void
  blocked: boolean
  canContinue: boolean
  navigateApplication?: ((href: string) => void) | undefined
}) {
  if (value.section === 'knowledge') return <KnowledgeDetails value={value} t={t} view={view} navigate={navigate}
    readPage={readPage} blocked={blocked} canContinue={canContinue} />
  if (value.section === 'relationships' || value.section === 'context') return <ContextAndRelations
    value={value} t={t} view={view} navigate={navigate} readPage={readPage} blocked={blocked} canContinue={canContinue}
    navigateApplication={navigateApplication} />
  const label = (name: Key, text: ReactNode) => <div><dt>{t(name)}</dt><dd>{text}</dd></div>
  const link = (name: Key, module: Route['module'], id: string) => label(name,
    <Button variant="ghost" onClick={() => { navigate({ runId: view.runId, search: view.search, module, objectId: id }) }}>{id}</Button>)
  const related = (module: 'decisions' | 'operations', filter: Pick<Route, 'entityId' | 'decisionId'>) => {
    navigate({ runId: view.runId, search: view.search, module, ...filter })
  }
  const page = value.collection === 'operations' && value.section === 'attempts' ? value.attempts
    : value.collection === 'checkpoints' ? value.references : undefined
  return <div className={css.detail}>
    <dl>{value.collection === 'entities' ? <>
      {label('kind', value.summary.kind.text)}{label('status', t(value.summary.phase))}
      {label('cognition', t(value.summary.cognition))}{label('writer', t(value.summary.writer))}
      {value.binding !== undefined && <>{label('teamReference', <TeamReference target={{ kind: 'team', teamId: value.binding.teamId }}
        id={value.binding.teamId} navigateApplication={navigateApplication} t={t} />)}
      {label('participantReference', value.binding.participantId)}{label('sessionReference', <TeamReference
        target={{ kind: 'session', ...value.binding }} id={value.binding.sessionId} navigateApplication={navigateApplication} t={t} />)}
      <p className={css.notice}>{t('referenceNotice')}</p></>}
    </> : value.collection === 'decisions' ? <>
      {label('status', t(value.summary.status))}{link('entity', 'entities', value.summary.entityId)}
      {label('time', value.summary.time)}{label('slot', value.summary.slot)}
      {label('frozenRevision', value.summary.snapshotRevision)}{label('operationCount', value.summary.operationCount)}
      {label('context', t(value.context.status))}
      {value.context.status === 'prepared' && <>{label('retainedBytes', value.context.retainedBytes)}
        {label('maxBytes', value.context.maxBytes)}{label('knowledgeCount', value.context.knowledgeCount)}
        {label('sourceCount', value.context.sourceCount)}{label('sectionCount', value.context.sectionCount)}</>}
      {value.context.status === 'overflow' && <>{label('requiredBytes', value.context.requiredBytes)}{label('maxBytes', value.context.maxBytes)}</>}
      <p className={css.notice}>{t('withheld')}</p>
      {value.inference !== undefined && <>{label('startedAt', date(value.inference.startedAt))}
        {label('deadline', date(value.inference.deadline))}
        {value.inference.finishedAt !== undefined && label('finishedAt', date(value.inference.finishedAt))}
        {value.inference.expiredAt !== undefined && label('expiredAt', date(value.inference.expiredAt))}</>}
      {value.closedAt !== undefined && label('closedAt', date(value.closedAt))}
      {value.cancellation !== undefined && label('cancellation', t(`cancellation.${value.cancellation}`))}
    </> : value.collection === 'operations' && value.section === 'execution' ? <>
      {label('kind', value.summary.kind.text)}{label('status', t(value.summary.status))}
      {link('entity', 'entities', value.summary.entityId)}{link('decision', 'decisions', value.summary.decisionId)}
      {label('publication', t(value.summary.publication))}{label('delivery', t(value.summary.delivery))}{label('task', t(value.summary.task))}
      {value.summary.deliveryFailure !== undefined && <p className={css.notice}>{t(value.summary.deliveryFailure)}</p>}
      {label('dependencies', value.dependencies.length === 0 ? t('none') : <ul>{value.dependencies.map(id => <li key={id}>
        <Button variant="ghost" onClick={() => { navigate({ ...view, objectId: id, section: undefined }) }}>{id}</Button></li>)}</ul>)}
      {value.result !== undefined && <>{label('resultStatus', t(value.result.status))}{label('time', value.result.time)}
        {label('sequence', value.result.sequence)}{label('resultCode', value.result.code.text)}</>}
      {value.outbox !== undefined && <>{label('publicationReady', t(value.outbox.ready ? 'yes' : 'no'))}
        {label('attemptCount', value.outbox.attemptCount)}
        {value.outbox.nextAttemptAt !== undefined && label('nextAttemptAt', date(value.outbox.nextAttemptAt))}</>}
      {openRetry !== undefined && <div>
        <Button disabled={blocked} onClick={() => { openRetry(value.id, value.retry?.expectedAttemptCount ?? value.outbox?.attemptCount ?? 0) }}>{t('operationRetry.title')}</Button>
        <p>{t('operationRetry.notice')}</p>
        {value.retry === undefined ? <p>{t('operationRetry.unavailable')}</p>
          : !value.retry.allowed && <p>{t(`operationRetry.reason.${value.retry.reason}`)}</p>}
      </div>}
      {value.taskReference !== undefined && <>{label('teamReference', <TeamReference target={{ kind: 'team', teamId: value.taskReference.teamId }}
        id={value.taskReference.teamId} navigateApplication={navigateApplication} t={t} />)}
      {label('taskReference', <TeamReference target={{ kind: 'task', ...value.taskReference }} id={value.taskReference.taskId}
        navigateApplication={navigateApplication} t={t} />)}<p className={css.notice}>{t('referenceNotice')}</p></>}
    </> : value.collection === 'operations' ? <>
      {value.attempts.items.map(attempt => <div key={attempt.number}>
        <dt>{t('attemptNumber')}: {attempt.number}</dt><dd>{t(attempt.outcome)}
          <dl>{label('startedAt', date(attempt.startedAt))}
            {attempt.finishedAt !== undefined && label('finishedAt', date(attempt.finishedAt))}</dl></dd>
      </div>)}
    </> : <>
      {label('status', t(value.summary.status))}{label('latest', t(value.summary.latestSuccessful ? 'yes' : 'no'))}
      {label('startedSequence', value.summary.startedSequence)}
      {value.summary.finishedSequence !== undefined && label('finishedSequence', value.summary.finishedSequence)}
      {value.summary.time !== undefined && label('time', value.summary.time)}
      {value.summary.publishedAt !== undefined && label('checkpointPublishedAt', date(value.summary.publishedAt))}
      <p className={css.notice}>{t('validation')}</p><p>{t('referenceNotice')}</p>
      {value.failure !== undefined && <p role="status">{t('checkpointFailure')}</p>}
      {value.diagnostic !== undefined && view.runId !== undefined && <CheckpointDiagnostic value={value.diagnostic}
        runId={view.runId as never} t={t} navigate={navigate} navigateApplication={navigateApplication} />}
      {value.references.items.map((reference, index) => <div key={index}>
        <dt>{t(`reference.${reference.kind}`)}</dt><dd>
          {reference.kind === 'team' ? <TeamReference target={{ kind: 'team', teamId: reference.id }} id={reference.id}
            navigateApplication={navigateApplication} t={t} /> : reference.kind === 'session' && reference.materialization === 'materialized'
            ? <TeamReference target={{ kind: 'session', teamId: reference.teamId, participantId: reference.participantId, sessionId: reference.id }}
              id={reference.id} navigateApplication={navigateApplication} t={t} /> : 'id' in reference && <code>{reference.id}</code>}
          <dl>{'cursor' in reference && label('sequence', reference.cursor)}
            {reference.kind === 'session' && <>{label('teamReference', reference.teamId)}
              {label('participantReference', reference.participantId)}{label('materialization', t(reference.materialization))}
              {'sequence' in reference && label('sequence', reference.sequence)}</>}</dl>
        </dd>
      </div>)}
    </>}</dl>
    {value.collection === 'entities' && <div className={css.actions}>
      <Button onClick={() => { related('decisions', { entityId: value.id }) }}>{t('entityDecisions')}</Button>
      <Button onClick={() => { related('operations', { entityId: value.id }) }}>{t('entityOperations')}</Button>
    </div>}
    {value.collection === 'decisions' && <Button onClick={() => { related('operations', { decisionId: value.id }) }}>{t('decisionOperations')}</Button>}
    {value.collection === 'entities' && <details className={css.overviewDetails}><summary>{t('object.technical')}</summary>
      <dl>{value.summary.name !== undefined && label('entityName', value.summary.name.text)}
        {value.summary.name?.truncated && <p>{t('truncate')}</p>}
        {label('entityRevision', value.revision)}{label('profileRevision', value.profileRevision)}
        {value.writerEpoch !== undefined && label('writerEpoch', value.writerEpoch)}</dl>
    </details>}
    <Identity value={value.id} t={t} />
    {page !== undefined && <DetailPagination page={page} blocked={blocked} canContinue={canContinue} readPage={readPage} t={t} />}
  </div>
}

/** Full metadata identities remain keyboard-selectable when clipboard access is unavailable. */
function Identity({ value, t }: { value: string; t: Translate }) {
  const [status, setStatus] = useState<'copied' | 'copyFailed'>()
  return <div className={css.identity}><code tabIndex={0}>{value}</code><Button aria-label={t('copy')}
    onClick={() => { void (async () => {
      try { await navigator.clipboard.writeText(value); setStatus('copied') }
      catch { setStatus('copyFailed') }
    })() }}>{t('copy')}</Button>
  {status !== undefined && <small role="status">{t(status)}</small>}</div>
}
