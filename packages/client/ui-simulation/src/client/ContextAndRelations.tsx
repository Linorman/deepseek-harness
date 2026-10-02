/** Frozen context is text-only and never labeled as the complete model request; relations retain historical validity. */
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { SimulationProductObjectDetail, SimulationProductCursor } from '@clocky/clocky-client-runtime/client'
import type { Route } from './store.ts'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'
import { TeamReference } from './TeamReference.tsx'
type Detail = Extract<SimulationProductObjectDetail, { section: 'relationships' | 'context' }>

/**
 * Keep original relation intervals and frozen context distinct from execution and current source authority.
 * @param props - One independently bounded, authorized section with view-only navigation.
 * @returns historical relationships or recorded context and provenance, with explicit redaction.
 */
export function ContextAndRelations({ value, t, view, navigate, readPage, blocked, canContinue, navigateApplication }: {
  value: Detail
  t: (key: Key) => string
  view: Route
  navigate: (next: Route) => void
  readPage: (cursor?: SimulationProductCursor) => void
  blocked: boolean
  canContinue: boolean
  navigateApplication?: ((href: string) => void) | undefined
}) {
  const link = (id: string) => <Button variant="ghost" onClick={() => {
    navigate({ runId: view.runId, module: 'entities', search: view.search, objectId: id })
  }}>{id}</Button>
  const page = value.section === 'relationships' ? value.relationships : value.items
  return <div className={css.detail}>
    <code>{value.id}</code>
    {value.section === 'relationships' ? <>
      <p>{t('time')}: {value.time}</p><p className={css.notice}>{t('relationInterval')}</p>
      <ul className={css.records}>{value.relationships.items.map(item => <li key={item.id}>
        <code>{item.id}</code><p>{link(item.subject)} · {item.relation.text} · {link(item.object)}</p>
        <dl><div><dt>{t('relationScope')}</dt><dd>{item.scope === undefined ? t('none') : link(item.scope)}</dd></div>
          <div><dt>{t('validFrom')}</dt><dd>{item.validFrom}</dd></div>
          <div><dt>{t('validUntil')}</dt><dd>{item.validUntil ?? t('noUpperBound')}</dd></div>
          <div><dt>{t('relationActive')}</dt><dd>{t(item.active ? 'yes' : 'no')}</dd></div>
          <div><dt>{t('revision')}</dt><dd>{item.revision}</dd></div></dl>
      </li>)}</ul>
    </> : <>
      <p className={css.notice}>{t('contextPartial')}</p><p>{t('context')}: {t(value.accounting.status)}</p>
      <p>{t(value.bodyAccess === 'allowed' ? 'contextBodyAllowed' : 'contextBodyWithheld')}</p>
      {value.frozen !== undefined && <dl>
        <div><dt>{t('entity')}</dt><dd>{link(value.frozen.entityId)}</dd></div>
        <div><dt>{t('time')}</dt><dd>{value.frozen.time}</dd></div><div><dt>{t('slot')}</dt><dd>{value.frozen.slot}</dd></div>
        <div><dt>{t('frozenRevision')}</dt><dd>{value.frozen.projections.run}</dd></div>
        <div><dt>{t('entityRevision')}</dt><dd>{value.frozen.projections.entity}</dd></div>
        <div><dt>{t('teamCursor')}</dt><dd>{value.frozen.projections.team}</dd></div>
        <div><dt>{t('writerEpoch')}</dt><dd>{value.frozen.epoch}</dd></div>
        {(['rules', 'policy', 'persona', 'model'] as const).map(key => <div key={key}>
          <dt>{t(`contextVersion.${key}`)}</dt><dd>{value.frozen?.versions[key].text}</dd></div>)}
      </dl>}
      <ul className={css.records}>{value.items.items.map((item, ordinal) => <li key={ordinal}>
        {item.kind === 'section' ? <>
          <h3>{item.section.text} · {t('contextBlock')} {item.block + 1} {item.required ? `· ${t('requiredSection')}` : ''}</h3>
          {item.body.status === 'text' ? <><p>{t('contextPart')}: {item.body.part + 1} / {item.body.parts}</p>
            <pre className={css.contextText}>{item.body.text}</pre></> : <p>{t(item.body.status === 'withheld' ? 'contextBodyWithheld' : 'contextBodyUnsupported')}</p>}
        </> : item.kind === 'knowledge' ? <><p>{t('knowledgeReference')}: <Button variant="ghost" onClick={() => { navigate({ ...view, section: 'knowledge',
          knowledgeId: item.id, knowledgeRevision: item.revision }) }}>{item.id}</Button></p>
        <p>{t('revision')}: {item.revision}</p></> : item.kind === 'run-event' ? <p>{t('runEventReference')}: <Button variant="ghost" onClick={() => { navigate({ runId: view.runId, module: 'records', search: view.search, recordSequence: item.sequence }) }}>{item.sequence}</Button></p>
          : <><p>{t('envelopeReference')}: <Button variant="ghost" data-source-index={item.sourceIndex} data-source-decision={view.objectId}
            onClick={() => { navigate({ ...view, sourceIndex: item.sourceIndex }) }}>{item.envelopeId}</Button></p>
          <p>{t('teamReference')}: <TeamReference target={{ kind: 'team', teamId: item.teamId }} id={item.teamId}
            navigateApplication={navigateApplication} t={t} /></p>
          <p>{t('reference.channel')}: <TeamReference target={{ kind: 'channel', teamId: item.teamId, channelId: item.channelId }} id={item.channelId}
            navigateApplication={navigateApplication} t={t} /></p></>}
      </li>)}</ul><p className={css.notice}>{t('referenceNotice')}</p>
    </>}
    <DetailPagination page={page} blocked={blocked} canContinue={canContinue} readPage={readPage} t={t} />
  </div>
}

/**
 * Preserve a readable section after continuation failure while retaining an explicit refresh path.
 * @param props - Current page and read readiness; failed continuation cannot erase readable content.
 * @returns shared independent section pagination with an explicit first-page recovery action.
 */
export function DetailPagination({ page, blocked, canContinue, readPage, t }: {
  page: { total: number; items: readonly unknown[]; nextCursor?: SimulationProductCursor | undefined }
  blocked: boolean
  canContinue: boolean
  readPage: (cursor?: SimulationProductCursor) => void
  t: (key: Key) => string
}) {
  return <><p>{t('total')}: {page.total}</p>{page.items.length === 0 && <p>{t('emptyCollection')}</p>}
    <div className={css.pagination}>
      <Button disabled={blocked} onClick={() => { readPage() }}>{t('first')}</Button>
      <Button disabled={blocked || !canContinue || page.nextCursor === undefined} onClick={() => { readPage(page.nextCursor) }}>{t('next')}</Button>
    </div></>
}
