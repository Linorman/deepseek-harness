/** Independently disclosed immutable market history; reading never performs approval or candidate acceptance. */
import { useId, useState } from 'react'
import { useObservedRefresh } from './useObservedRefresh.ts'
import { Button, Input } from '@clocky/clocky-client-ui-primitives'
import { ViewSwitch } from '@clocky/clocky-client-ui-viz'
import type { HiringMarketFamily, HiringMarketView, WorldWindow, EngineRef } from './world-domain.ts'
import { windowValue } from './world-domain.ts'
import type { WorldT } from './WorldFacts.tsx'
import { WindowStatus, CoverageNote, PrivacyGate } from './WorldFacts.tsx'
import { SourceLinks } from './WorldRefs.tsx'
import css from './World.module.css'

/** @param props - Authorized page and explicit family/page reads. @returns audit history with no inferred business transitions. */
export function HiringMarket({ window, connected, read, review, positions = [], revision, openRef, t }: {
  window: WorldWindow<HiringMarketView>
  connected: boolean
  positions?: readonly { readonly id: string; readonly name: { readonly text: string } }[] | undefined
  revision?: number | undefined
  review?: ((positionId: string, revision: number, command: string) => void) | undefined
  read: (family: HiringMarketFamily, cursor?: string) => void
  openRef: (ref: EngineRef) => void
  t: WorldT
}) {
  const positionGroup = useId()
  const [reason, setReason] = useState(''), [position, setPosition] = useState('')
  const [compare, setCompare] = useState<readonly number[]>([])
  const [open, setOpen] = useState(false), [family, setFamily] = useState<HiringMarketFamily>('persona-draft')
  const shown = windowValue(window), value = shown?.value
  const current = value?.coverage.scope === `hiring-market/${family}` ? value : undefined
  useObservedRefresh(open && connected && revision !== undefined ? String(revision) : undefined,
    window.status === 'loading', () => { read(family) }, shown?.stale)
  const compared = current?.rows.flatMap(row => compare.includes(row.sequence) && row.detail.state === 'allowed'
    && 'kind' in row.detail.value && row.detail.value.kind === 'persona-draft' ? [row.detail.value] : []).sort((a, b) => a.revision - b.revision) ?? []
  const before = compared[0], after = compared[1]
  return <section className={css.marketPanel} aria-label={t('world.market.title')} data-open={open || undefined}>
    <button type="button" className={css.marketToggle} aria-expanded={open} onClick={() => {
      if (!open) read(family); setOpen(!open)
    }}><span aria-hidden="true" className={css.marketChevron}>▸</span>{t('world.market.title')}</button>
    {open && <>
      <p className={css.notice}>{t('world.market.notice')}</p>
      <ViewSwitch label={t('world.market.family')} value={family}
        options={(['persona-draft', 'vacancy', 'application', 'offer-revision'] as const).map(id => ({ id, label: t(`world.market.${id}`) }))}
        onChange={(next) => { setFamily(next); setCompare([]); read(next) }} />
      {family === 'persona-draft' && review !== undefined && <fieldset className={css.choiceGroup}>
        <legend>{t('world.market.position')}</legend>
        <p>{t('world.market.selectPosition')}</p>
        {positions.map(item => <label key={item.id} className={css.choice}>
          <input type="radio" name={positionGroup} value={item.id} checked={position === item.id}
            onChange={() => { setPosition(item.id) }} />{item.name.text}
        </label>)}
        <Button variant="secondary" disabled={!connected || shown?.stale || revision === undefined
          || !positions.some(item => item.id === position)} onClick={() => {
          if (revision !== undefined) review(position, revision, '')
        }}>{t('world.market.createDraft')}</Button>
      </fieldset>}
      {family === 'persona-draft' && review !== undefined && <label>{t('world.market.reason')}
        <Input value={reason} onChange={(event) => { setReason(event.target.value) }} /></label>}
      <WindowStatus window={window} retry={() => { read(family) }} t={t} />
      {current !== undefined && <>
        <CoverageNote value={current.coverage} stale={shown?.stale} disabled={!connected || window.status !== 'ready'}
          more={() => { read(family, current.coverage.nextCursor) }} t={t} />
        {current.rows.length === 0 && <p>{t('world.market.empty')}</p>}
        {before !== undefined && after !== undefined && before.id === after.id && <section aria-label={t('world.market.compare')}>
          <h3>{t('world.market.compare')} · {before.id}</h3>
          <div className={css.tableScroll}><table><thead><tr><th>{t('world.market.persona')}</th><th>{t('world.market.before')} r{before.revision}</th>
            <th>{t('world.market.after')} r{after.revision}</th></tr></thead><tbody>
            {(['name', 'skills', 'traits', 'goals'] as const).map(key => <tr key={key}>
              <th>{key === 'name' ? t('world.author.nodeName') : t(`world.market.${key}`)}</th>
              <td>{JSON.stringify(before.body.persona[key])}</td><td>{JSON.stringify(after.body.persona[key])}</td>
            </tr>)}
          </tbody></table></div>
        </section>}
        <ol>{current.rows.map(row => <li className={css.marketRecord} key={`${row.sequence}:${row.id}`}>
          <h3>{row.id} · {row.status} · {t('world.author.savedRevision', { revision: row.revision })}</h3>
          <PrivacyGate value={row.body} t={t}>{body => <pre className={css.mono}>{body.text}{body.truncated ? '…' : ''}</pre>}</PrivacyGate>
          <PrivacyGate value={row.detail} t={t}>{detail => <>
            {'kind' in detail && detail.kind === 'persona-draft' && <>
              <dl className={css.keyValue}><div><dt>{t('world.author.nodeName')}</dt><dd>{detail.body.persona.name}</dd></div>
                <div><dt>{t('world.market.template')}</dt><dd>{detail.body.templateId} · {detail.body.templateVersion}</dd></div>
                <div><dt>{t('world.market.persona')}</dt><dd><pre>{JSON.stringify(detail.body.persona, null, 2)}</pre></dd></div></dl>
              <dl className={css.keyValue}>
                <div><dt>{t('world.market.originalAuthor')}</dt><dd>{detail.source.actorId ?? detail.source.user?.principalId}</dd></div>
                <div><dt>{t('world.market.revisionAuthor')}</dt><dd>{detail.editedBy.actorId ?? detail.editedBy.user?.principalId}</dd></div>
                {detail.prior !== null && <div><dt>{t('world.market.priorRevision')}</dt><dd>r{detail.prior.revision} · {detail.prior.bodyHash}</dd></div>}
              </dl><p>{detail.reviewReason}</p>
              <label><input type="checkbox" checked={compare.includes(row.sequence)} onChange={(event) => {
                setCompare(event.target.checked ? [...compare.slice(-1), row.sequence] : compare.filter(item => item !== row.sequence))
              }} />{t('world.market.compare')} · r{detail.revision}</label>
              {review !== undefined && row.current && detail.status !== 'accepted' && <Button variant="secondary"
                disabled={!connected || shown?.stale || detail.revision >= 16} onClick={() => {
                  review(detail.positionEntityId, current.coverage.revision, JSON.stringify({ kind: 'draft', id: detail.id,
                    organizationEntityId: detail.organizationEntityId, positionEntityId: detail.positionEntityId,
                    expectedRevision: detail.revision, validUntil: detail.validUntil, body: detail.body }))
                }}>{t('world.market.revise')}</Button>}
              {review !== undefined && row.current && ['draft', 'reviewed'].includes(detail.status) && <div className={css.authorActions}>
                {(detail.status === 'reviewed' ? ['accepted', 'rejected'] as const : ['reviewed', 'rejected'] as const).map(decision => <Button key={decision} variant="secondary"
                  disabled={!connected || shown?.stale || reason.trim() === ''} onClick={() => {
                    review(detail.positionEntityId, current.coverage.revision, JSON.stringify({ kind: 'review', id: detail.id,
                      organizationEntityId: detail.organizationEntityId, positionEntityId: detail.positionEntityId,
                      revision: detail.revision, bodyHash: detail.bodyHash, decision, reason }))
                  }}>{t(`world.market.${decision}`)}</Button>)}
              </div>}
            </>}
            {'kind' in detail && detail.kind === 'offer-revision' && <>
              <p>{detail.terms}</p><p>{detail.candidateId} → {detail.positionEntityId} · {detail.validUntil}</p>
              <p>{detail.fee === null ? t('world.market.noFee') : `${detail.fee.quantity} ${detail.fee.unit}`}</p>
              <p className={css.notice}>{t('world.market.oneTime')}</p>
            </>}
          </>}</PrivacyGate>
          <SourceLinks sources={row.sources} open={openRef} t={t} />
        </li>)}</ol>
      </>}
    </>}
  </section>
}
