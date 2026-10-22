/** External world module: simulated identities, known facts, representatives and recorded interactions. */
import { useRef } from 'react'
import type { EngineRef, ExternalIdentityDetail, ExternalView, WorldWindow } from './world-domain.ts'
import { windowValue } from './world-domain.ts'
import { CopyId, CoverageNote, PrivacyGate, SourceKindBadge, WindowStatus, WindowCoverage, factLabels, groupTime } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import { InspectorDock, WorkspaceStage, focusRow, tabStop, tableKeys } from './WorldInspector.tsx'
import type { InspectorSizing } from './WorldInspector.tsx'
import { StatusTrack } from './WorldTracks.tsx'
import { FactValue } from '@clocky/clocky-client-ui-primitives'
import { Moment } from '@clocky/clocky-client-ui-viz'
import { useLiveEntry } from './world-motion.ts'
import { EngineRefLink, SourceLinks, useLiveRows } from './WorldRefs.tsx'
import css from './World.module.css'

/** InspectorDock section. */
export type ExternalSection = 'identity' | 'facts' | 'representative' | 'interactions'
/** Route-derived selection. */
export interface ExternalRoute { readonly objectId?: string | undefined; readonly section?: ExternalSection | undefined }

/**
 * Render the external world. Its toolbar states the simulated-only boundary in full and cannot dismiss it;
 * the run header carries only the short marker.
 * @param props - Domain windows, route and navigation.
 * @returns notice, identity table and inspector.
 */
export function ExternalModule({ route, window, identity, connected, navigate, reload, reloadDetail, openRef, sizing, t }: {
  route: ExternalRoute
  window: WorldWindow<ExternalView>
  identity: WorldWindow<ExternalIdentityDetail>
  connected: boolean
  navigate: (next: Partial<ExternalRoute>, push?: boolean) => void
  reload: (cursor?: string) => void
  reloadDetail?: ((cursor?: string) => void) | undefined
  openRef: (ref: EngineRef) => void
  sizing?: InspectorSizing | undefined
  t: WorldT
}) {
  const table = useRef<HTMLTableElement>(null)
  const shown = windowValue(window)
  const value = shown?.value
  const detailValue = windowValue(identity)?.value
  const detail = detailValue !== undefined && detailValue.key === route.objectId ? detailValue : undefined
  const section = route.section ?? 'identity'
  const live = useLiveRows(`${value?.runId ?? ''}:external`, value?.identities, row => row.key, t)
  const converge = useLiveEntry(detail?.key ?? '', detail, detail?.representative?.ready === 'ready')
  const open = (key: string) => { navigate({ objectId: key, section }) }
  return <div className={css.module}>
    <div className={css.moduleBar}><p className={css.simNotice} role="note"><span aria-hidden="true">◎</span>{t('world.ext.notice')}</p>
      {value !== undefined && <CoverageNote value={value.coverage} stale={shown?.stale} disabled={!connected || window.status !== 'ready'}
        more={() => { reload(value.coverage.nextCursor) }} t={t} />}</div>
    <WindowStatus window={window} retry={() => { reload() }} t={t} />
    {value !== undefined && <WorkspaceStage detail={route.objectId !== undefined}>
      <div className={css.tablePane}>
        <table ref={table} className={css.dataTable} aria-label={t('world.nav.external')} onKeyDown={(event) => { tableKeys(event, open) }}>
          <thead><tr><th>{t('world.ext.name')}</th><th>{t('world.ext.key')}</th><th>{t('world.ext.kind')}</th>
            <th>{t('world.ext.generation')}</th><th>{t('world.ext.latest')}</th></tr></thead>
          <tbody>{value.identities.map(row => <tr key={row.key} data-row={row.key}
            tabIndex={row.key === tabStop(value.identities.map(item => item.key), route.objectId) ? 0 : -1}
            aria-selected={row.key === route.objectId}
            data-changed={live.changed.has(row.key) || undefined}
            onClick={() => { open(row.key) }}>
            <td><strong>{row.name.text}</strong></td><td><CopyId value={row.key} compact t={t} /></td>
            <td><SourceKindBadge kind={row.kind} t={t} /></td><td className={css.figure}>{row.generation}</td>
            {/* The Host summary stays verbatim; one clamped line keeps rows even and the full text stays in the title. */}
            <td>{row.latest === undefined ? '—' : <span className={css.latestCell} title={row.latest.summary.text}>
              <span className={css.time}>{groupTime(row.latest.at)}</span>
              <span className={css.latestText}>{row.latest.summary.text}</span></span>}</td>
          </tr>)}</tbody>
        </table>
        {value.identities.length === 0 && <p className={css.muted}>{t('world.empty', { objects: t('world.ext.identities') })}</p>}
      </div>
      <span className={css.srOnly} aria-live="polite">{live.announcement}</span>
      {route.objectId !== undefined && <InspectorDock identity={route.objectId} t={t} sizing={sizing}
        close={() => { navigate({ objectId: undefined, section: undefined }); focusRow(table.current, route.objectId) }}
        title={detail?.name.text ?? value.identities.find(row => row.key === route.objectId)?.name.text ?? route.objectId}
        eyebrow={detail === undefined ? undefined : <SourceKindBadge kind={detail.kind} t={t} />}
        sections={{ current: section, select: (next) => { navigate({ section: next as ExternalSection }, false) },
          items: (['identity', 'facts', 'representative', 'interactions'] as const).map(id => ({ id, label: t(`world.ext.section.${id}`) })) }}>
        <WindowStatus window={identity} retry={() => { reloadDetail?.() }} t={t} />
        <WindowCoverage window={identity} more={() => { reloadDetail?.(identity.coverage?.nextCursor) }} disabled={!connected} t={t} />
        {detail !== undefined && <Moment kind="converge" generation={converge}><Section detail={detail} section={section} openRef={openRef} t={t} /><SourceLinks sources={detail.sources} open={openRef} t={t} /></Moment>}
      </InspectorDock>}
    </WorkspaceStage>}
  </div>
}

function Section({ detail, section, openRef, t }: { detail: ExternalIdentityDetail
  section: ExternalSection
  openRef: (ref: EngineRef) => void
  t: WorldT }) {
  switch (section) {
    case 'identity': return <dl className={css.keyValue}>
      <div><dt>{t('world.ext.key')}</dt><dd><CopyId value={detail.key} t={t} /></dd></div>
      <div><dt>Entity</dt><dd><EngineRefLink value={detail.entity} open={openRef} t={t} /></dd></div>
      <div><dt>{t('revision')}</dt><dd className={css.figure}>r{detail.revision}</dd></div>
      <div><dt>{t('world.ext.kind')}</dt><dd><SourceKindBadge kind={detail.kind} t={t} /></dd></div>
      <div><dt>{t('world.ext.expansion')}</dt><dd>{detail.expansion.text}</dd></div>
    </dl>
    case 'facts': return <dl className={css.keyValue}>{detail.facts.map(fact => <div key={fact.key}>
      <dt><code>{fact.key}</code></dt>
      <dd>{fact.value.state === 'unknown' ? <><FactValue labels={factLabels(t)} fact={{ state: 'unknown' }} /> <span aria-hidden="true">{t('world.unknown')}</span></>
        : fact.value.text.text}{fact.report && <span className={css.badge} data-tone="warning">{t('world.ext.report')}</span>}</dd>
    </div>)}</dl>
    case 'representative': {
      const rows = detail.representatives ?? []
      return rows.length === 0 ? <p className={css.muted}>{t('world.ext.noRepresentative')}</p>
        : <>{rows.map(row => <Representative key={row.participantId} value={row} openRef={openRef} t={t} />)}</>
    }
    case 'interactions': return detail.interactions.length === 0 ? <p className={css.muted}>{t('world.empty', { objects: t('world.ext.section.interactions') })}</p>
      : <ol className={css.interactions}>{detail.interactions.map(item => <li key={`${item.kind}:${item.id}`}>
        <header><span className={css.time}>{groupTime(item.at)}</span><SourceKindBadge kind={item.kind} t={t} /></header>
        <dl className={css.keyValue}>
          <div><dt>{t('world.ext.requester')}</dt><dd>{item.requester.text}</dd></div>
          <div><dt>{t('world.ext.basis')}</dt><dd>{item.basis.text}</dd></div>
          <div><dt>{t('world.ext.outcome')}</dt><dd>{item.outcome.text}</dd></div>
        </dl>
        {item.sampled && <p className={css.muted}>{t('world.ext.sampled')}</p>}
        <PrivacyGate value={item.disclosure} t={t}>{text => <p className={css.prose}>{text.text}</p>}</PrivacyGate>
      </li>)}</ol>
    default: { const unreachable: never = section; throw new Error(`Unknown external section ${String(unreachable)}`) }
  }
}

/** Render one selected representation; an explicit empty page never falls back to the latest summary. */
function Representative({ value, openRef, t }: { value: NonNullable<ExternalIdentityDetail['representatives']>[number]
  openRef: (ref: EngineRef) => void
  t: WorldT }) {
  return <section>
    <dl className={css.keyValue}>
      <div><dt>{t('world.field.person')}</dt><dd>{value.person.text}</dd></div>
      <div><dt>Entity</dt><dd><EngineRefLink value={value.entity} open={openRef} t={t} /></dd></div>
      <div><dt>Participant</dt><dd><CopyId value={value.participantId} t={t} /></dd></div>
      <div><dt>Session</dt><dd><CopyId value={value.sessionId} t={t} /></dd></div>
      <div><dt>{t('status')}</dt><dd><span className={css.stateTag} data-state={value.ready}>
        {t(`world.ext.ready.${value.ready}`)}</span></dd></div>
    </dl>
    {value.steps.length > 0 && <StatusTrack tracks={[{ kind: 'execution', steps: value.steps,
      summary: t(`world.ext.ready.${value.ready}`) }]} t={t} />}
  </section>
}
