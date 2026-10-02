/** Current audience and original provenance remain separate from historical context and verified world facts. */
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { SimulationProductKnowledgeDetail, SimulationProductCursor } from '@clocky/clocky-client-runtime/client'
import type { Route } from './store.ts'
import type { Key } from './locales.ts'
import { DetailPagination } from './ContextAndRelations.tsx'
import css from './Workspace.module.css'

/**
 * Render only the Host-approved knowledge window and separately disclosed report source.
 * @param props - Exact version/cutoff metadata, independent read state and viewing navigation.
 * @returns attributed text with explicit permission, temporal and provenance distinctions.
 */
export function KnowledgeDetails({ value, t, view, navigate, readPage, blocked, canContinue }: {
  value: SimulationProductKnowledgeDetail
  t: (key: Key) => string
  view: Route
  navigate: (next: Route) => void
  readPage: (cursor?: SimulationProductCursor) => void
  blocked: boolean
  canContinue: boolean
}) {
  return <div className={css.detail}>
    <p className={css.notice}>{t('knowledgeNotice')}</p>
    <p>{t('time')}: {value.time} · {t('frozenRevision')}: {value.cutoffRevision}</p>
    {value.bodyAccess === 'withheld' ? <p>{t('knowledgeWithheld')}</p> : <>
      {value.selected !== undefined && <p>{t('knowledgeReference')}: {value.selected.id} · {t('revision')}: {value.selected.revision}</p>}
      {value.selected !== undefined && value.knowledge.total === 0 && <p>{t('knowledgeUnavailable')}</p>}
      <ul className={css.records}>{value.knowledge.items.map((item, index) => <li key={index}>
        <h3>{item.reference.id} · {t('revision')}: {item.reference.revision}</h3>
        <p>{t(`knowledgeOrigin.${item.source.kind}`)} · {t('entity')}: {item.owner}</p>
        <dl><div><dt>{t('knowledgeObserved')}</dt><dd>{item.observedAt}</dd></div>
          <div><dt>{t('inputAvailableAt')}</dt><dd>{item.availableAt}</dd></div>
          <div><dt>{t('validFrom')}</dt><dd>{item.validFrom}</dd></div><div><dt>{t('validUntil')}</dt><dd>{item.validUntil ?? t('noUpperBound')}</dd></div></dl>
        {item.body.status === 'text' && <><p>{t('contextPart')}: {item.body.part + 1} / {item.body.parts}</p>
          <pre className={css.contextText}>{item.body.text}</pre></>}
        {item.source.kind === 'report' && <>
          <Button onClick={() => { navigate({ runId: view.runId, search: view.search, module: 'operations', objectId: item.source.kind === 'report' ? item.source.operationId : undefined }) }}>{t('knowledgeReportOperation')}</Button>
          <p>{t('knowledgeReportSource')}</p>
          {item.source.body.status === 'text' ? <pre className={css.contextText}>{item.source.body.text}</pre>
            : <p>{t(item.source.body.status === 'withheld' ? 'knowledgeSourceWithheld' : 'contextBodyUnsupported')}</p>}
        </>}
        {item.source.kind === 'inference' && <Button onClick={() => { if (item.source.kind === 'inference') navigate({ runId: view.runId, search: view.search,
          module: 'decisions', objectId: item.source.decisionId }) }}>{t('knowledgeInferenceDecision')}</Button>}
        {item.source.kind === 'observation' && <p>{t('frozenRevision')}: {item.source.worldRevision} · {item.source.visibilityPolicy.text}</p>}
        {item.source.kind === 'summary' && <p>{item.source.policy.text} · {item.source.policyVersion.text} · {item.source.cursor}</p>}
        {item.source.kind === 'belief' && <p>{t('profileRevision')}: {item.source.profileRevision} · {item.source.policyVersion.text}</p>}
        {item.premises.length > 0 && <ul aria-label={t('knowledgePremises')}>{item.premises.map(ref => <li key={`${ref.id}:${ref.revision}`}>
          <code>{ref.id}</code> · {ref.revision}</li>)}</ul>}
      </li>)}</ul>
      <DetailPagination page={value.knowledge} blocked={blocked} canContinue={canContinue} readPage={readPage} t={t} />
    </>}
  </div>
}
