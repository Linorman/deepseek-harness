/** Governance module: observe proposals and votes, active norm versions and their history. Users never vote here. */
import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button, DiffBlock } from '@clocky/clocky-client-ui-primitives'
import { Moment, ViewSwitch, useLiveTransition } from '@clocky/clocky-client-ui-viz'
import { useLiveEntry } from './world-motion.ts'
import type { EngineRef, GovernanceView, NormVersionView, ProposalDetailView, SimTime, WorldWindow } from './world-domain.ts'
import { compareTime, windowValue } from './world-domain.ts'
import { CopyId, CoverageNote, InfoHint, EnforcementBadge, PrivacyGate, TemporalFacts, TimeInterval, WindowStatus, WindowCoverage, groupTime, displayText, proposalTitle, shortId } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import { TimePicker } from './WorldOrganization.tsx'
import { InspectorDock, WorkspaceStage, focusRow, tabStop, tableKeys } from './WorldInspector.tsx'
import type { InspectorSizing } from './WorldInspector.tsx'
import { SourceLinks, useLiveRows } from './WorldRefs.tsx'
import { NormImpactPanel } from './WorldNormImpact.tsx'
import { ElectorateGrid, VoteTally } from './WorldVotes.tsx'
import css from './World.module.css'

/** Governance lens. */
export type GovernanceLens = 'proposals' | 'norms' | 'history'
/** Route-derived selection. */
export interface GovernanceRoute { readonly lens: GovernanceLens
  readonly at?: SimTime | undefined
  readonly objectId?: string | undefined
  readonly section?: 'record' | 'electorate' | 'votes' | 'impact' | undefined }

interface Props {
  /** Wide-screen inspector width and resize callback; absent keeps the responsive default. */
  sizing?: InspectorSizing | undefined
  route: GovernanceRoute
  window: WorldWindow<GovernanceView>
  proposal: WorldWindow<ProposalDetailView>
  norm: WorldWindow<NormVersionView>
  connected: boolean
  navigate: (next: Partial<GovernanceRoute>, push?: boolean) => void
  reload: (cursor?: string) => void
  reloadDetail?: ((cursor?: string) => void) | undefined
  previewImpact?: ((input: import('@clocky/clocky-simulation').SimulationNormImpactInput) => Promise<void>) | undefined
  openRef: (ref: EngineRef) => void
  t: WorldT
}

/**
 * Render governance. Passing and enactment are always stated separately.
 * @param props - Domain windows, route and navigation.
 * @returns lens bar, list and inspector.
 */
export function GovernanceModule(props: Props) {
  const { route, t } = props
  const shown = windowValue(props.window)
  const value = shown?.value
  return <div className={css.module}>
    <div className={css.moduleBar}>
      <ViewSwitch label={t('world.nav.governance')} value={route.lens} options={(['proposals', 'norms', 'history'] as const)
        .map(id => ({ id, label: t(`world.gov.lens.${id}`) }))} onChange={(lens) => { props.navigate({ lens, objectId: undefined }) }} />
      <InfoHint label={t('world.hint')} text={t('world.gov.observeOnly')} />
      {route.lens !== 'proposals' && <TimePicker at={route.at} commit={(at) => { props.navigate({ at }) }} t={t} />}
      {value !== undefined && <CoverageNote value={value.coverage} stale={shown?.stale} disabled={!props.connected || props.window.status !== 'ready'}
        more={() => { props.reload(value.coverage.nextCursor) }} t={t} />}
    </div>
    {route.at !== undefined && <div className={css.historyBanner} role="status">
      <span>{t('world.org.historical', { at: groupTime(route.at) })}</span>
      <Button size="sm" variant="secondary" onClick={() => { props.navigate({ at: undefined }) }}>{t('world.org.backToLatest')}</Button></div>}
    <WindowStatus window={props.window} retry={() => { props.reload() }} t={t} />
    {value !== undefined && <WorkspaceStage detail={route.objectId !== undefined}>
      {route.lens === 'proposals' && <Proposals view={value} props={props} />}
      {route.lens === 'norms' && <Norms view={value} props={props} />}
      {route.lens === 'history' && <History view={value} t={t} open={(id) => { props.navigate({ lens: 'norms', objectId: id }) }} />}
    </WorkspaceStage>}
  </div>
}

function Proposals({ view, props }: { view: GovernanceView; props: Props }) {
  const { route, t } = props
  const liveRows = useLiveRows(`${view.runId}:proposals`, view.proposals, row => row.id, t)
  const table = useRef<HTMLTableElement>(null)
  const detailValue = windowValue(props.proposal)?.value
  const detail = detailValue !== undefined && detailValue.id === route.objectId ? detailValue : undefined
  const ballots = detail === undefined ? 0 : detail.tally.for + detail.tally.against + detail.tally.abstain
  const live = useLiveTransition(detail?.id ?? '', ballots, ballots)
  const seal = useLiveEntry(detail?.id ?? '', detail, detail?.enactment.state === 'enacted')
  const open = (id: string) => { props.navigate({ objectId: id }) }
  return <>
    <div className={css.tablePane}>
      <table ref={table} className={css.dataTable} aria-label={t('world.gov.lens.proposals')} onKeyDown={(event) => { tableKeys(event, open) }}>
        <thead><tr><th>{t('world.gov.title')}</th><th>{t('world.gov.committee')}</th><th>{t('world.gov.status')}</th>
          <th>{t('world.gov.deadline')}</th><th>{t('world.gov.tally')}</th></tr></thead>
        <tbody>{view.proposals.map(proposal => <tr key={proposal.id} data-row={proposal.id}
          tabIndex={proposal.id === tabStop(view.proposals.map(item => item.id), route.objectId) ? 0 : -1}
          data-changed={liveRows.changed.has(proposal.id) || undefined}
          aria-selected={proposal.id === route.objectId} onClick={() => { open(proposal.id) }}>
          <td><strong title={proposal.title.text}>{proposalTitle(proposal, t)}</strong></td><td>{proposal.committee.text}</td>
          <td><span className={css.stateTag} data-state={proposal.status}>{t(`world.gov.status.${proposal.status}`)}</span></td>
          <td className={css.time}>{groupTime(proposal.deadline)}</td><td><VoteTally value={proposal.tally} compact t={t} /></td>
        </tr>)}</tbody>
      </table>
      {view.proposals.length === 0 && <p className={css.muted}>{t('world.empty', { objects: t('world.gov.lens.proposals') })}</p>}
    </div>
    <span className={css.srOnly} aria-live="polite">{liveRows.announcement}</span>
    {route.objectId !== undefined && <InspectorDock identity={route.objectId} t={t} sizing={props.sizing}
      close={() => { props.navigate({ objectId: undefined }); focusRow(table.current, route.objectId) }}
      title={<>{proposalHeading(detail ?? view.proposals.find(item => item.id === route.objectId), route.objectId, t)}
        {detail !== undefined && <span className={css.version}> v{detail.version}</span>}</>}
      sections={{ current: route.section ?? 'record', select: (section) => {
        props.navigate({ section: section as GovernanceRoute['section'] }, false)
      }, items: (['record', 'electorate', 'votes'] as const).map(id => ({ id, label: t(`world.gov.section.${id}`) })) }}
      eyebrow={detail === undefined ? undefined : detail.status === 'voting' ? t('world.gov.votingUntil', { at: groupTime(detail.deadline) })
        : t(`world.gov.status.${detail.status}`)}>
      <WindowStatus window={props.proposal} retry={() => { props.reloadDetail?.() }} t={t} />
      <WindowCoverage window={props.proposal} more={() => { props.reloadDetail?.(props.proposal.coverage?.nextCursor) }}
        disabled={!props.connected} t={t} />
      {detail !== undefined && <>
        <p className={css.hashLine}>{t('world.gov.bodyHash')} <CopyId value={detail.bodyHash} t={t} />
          {detail.targetNorm !== undefined && <span>· {t('world.gov.targetNorm', detail.targetNorm)}</span>}</p>
        <details className={css.bodyDisclosure}><summary>{t('world.gov.viewBody')}</summary>
          <PrivacyGate value={detail.body} t={t}>{body => <p className={css.prose}>{body.text}</p>}</PrivacyGate></details>
        {detail.routeDefinition !== undefined && <section className={css.authorSection} aria-label={t('world.gov.reviewRoute')}>
          <h4>{t('world.gov.reviewRoute')} · {detail.routeDefinition.id}</h4>
          <p>{t(`world.gov.route.${detail.routeDefinition.mode}`)} · {t('world.gov.deadline')}: {detail.routeDefinition.deadline}</p>
          <CopyId value={detail.routeDefinition.hash} t={t} />
          <ol>{detail.routeDefinition.steps.map(step => <li key={step.id}>
            <Button variant="ghost" size="sm" onClick={() => { props.navigate({ objectId: step.proposalId, section: 'record' }) }}>{step.id}</Button>
            <p>{step.committeeId} · {t('world.gov.deadline')}: {step.deadline} · {step.status === 'pending' ? t('world.gov.audit.pending') : t(`world.gov.status.${step.status}`)}</p>
            <p>{step.rule.kind === 'unanimity' ? t('world.vote.rule.unanimous', { quorum: step.quorum, electorate: step.electorate.length })
              : t('world.vote.rule.absolute', { threshold: step.rule.yes, quorum: step.quorum, electorate: step.electorate.length })}</p>
            <p>{step.electorate.join(', ')}</p>
            {step.dependsOn.length > 0 && <p>{t('world.gov.routeDepends')}: {step.dependsOn.join(', ')}</p>}
            {step.resolutionHash !== null && <CopyId value={step.resolutionHash} t={t} />}
          </li>)}</ol>
        </section>}
        {detail.reviewRoute !== undefined && <section className={css.authorSection} aria-label={t('world.gov.reviewRoute')}>
          <h4>{t('world.gov.reviewRoute')} · {detail.reviewRoute.id} · r{detail.reviewRoute.revision}</h4>
          <p>{t(`world.gov.route.${detail.reviewRoute.mode}`)} · <CopyId value={detail.reviewRoute.hash} t={t} /></p>
          <ol>{detail.reviewRoute.steps.map(step => <li key={step.id}>
            <Button variant="ghost" size="sm" onClick={() => { props.navigate({ objectId: step.proposalId, section: 'record' }) }}>{step.id}</Button>
            <span>{step.resolutionId} · {step.resolutionHash === null ? t('world.gov.audit.pending') : <CopyId value={step.resolutionHash} t={t} />}</span>
            {step.dependsOn.length > 0 && <span> · {t('world.gov.routeDepends')}: {step.dependsOn.join(', ')}</span>}
          </li>)}</ol>
        </section>}
        {detail.targetNorm !== undefined && <Button variant="secondary" onClick={() => {
          props.navigate({ section: 'impact', at: undefined })
        }}>{t('world.gov.impact.open')}</Button>}
        {route.section === 'impact' && <NormImpactPanel detail={detail} connected={props.connected}
          loading={props.proposal.status === 'loading'} preview={props.previewImpact} t={t} />}
        <Moment kind="seal" generation={seal}><VoteTally value={detail.tally} live={live.live} t={t} /></Moment>
        {route.section !== undefined && route.section !== 'record' && route.section !== 'impact' && <ElectorateGrid members={detail.electorateMembers}
          frozenAt={detail.frozenAt} openRef={props.openRef} t={t} />}
        <dl className={css.keyValue}>
          <div><dt>{t('world.gov.resolution')}</dt><dd>{detail.resolution === undefined ? t('world.gov.resolution.none')
            : t('world.gov.resolution.at', { at: groupTime(detail.resolution.at), outcome: t(`world.gov.status.${detail.resolution.outcome}`) })}</dd></div>
          <div><dt>{t('world.gov.enactment')}</dt><dd>{detail.enactment.state === 'enacted' && detail.enactment.normVersion !== undefined
            ? <button type="button" className={css.refLink} onClick={() => { const version = detail.enactment.normVersion
              if (version !== undefined) props.navigate({ lens: 'norms', objectId: JSON.stringify([version.id, version.version]) }) }}>
              {t('world.gov.enactment.enacted', detail.enactment.normVersion)} ↗</button>
            : t(`world.gov.enactment.${detail.enactment.state === 'enacted' ? 'not-applicable' : detail.enactment.state}`)}
          {detail.enactment.announcement !== undefined && <small className={css.muted}> · {t(`world.gov.announcement.${detail.enactment.announcement}`)}</small>}</dd></div>
        </dl>
        <p className={css.notice}>{t('world.gov.passNotEnact')}</p>
        <SourceLinks sources={detail.sources} open={props.openRef} t={t} />
      </>}
    </InspectorDock>}
  </>
}

function Norms({ view, props }: { view: GovernanceView; props: Props }) {
  const { route, t } = props
  const list = useRef<HTMLTableElement>(null)
  const detailValue = windowValue(props.norm)?.value
  const detail = detailValue !== undefined && detailValue.id === route.objectId ? detailValue : undefined
  const now = route.at ?? view.now
  const active = view.norms.filter(norm => norm.effectiveFrom !== undefined && compareTime(norm.effectiveFrom, now) <= 0
    && (norm.until === undefined || compareTime(norm.until, now) > 0))
  const open = (id: string) => { props.navigate({ objectId: id }) }
  return <>
    <div className={css.tablePane}>
      <table ref={list} className={css.dataTable} aria-label={t('world.gov.lens.norms')} onKeyDown={(event) => { tableKeys(event, open) }}>
        <thead><tr><th>{t('world.gov.title')}</th><th>{t('world.gov.version')}</th><th>{t('world.field.enforcement')}</th>
          <th>{t('world.gov.scope')}</th><th>{t('world.gov.interval')}</th></tr></thead>
        <tbody>{active.map(norm => <tr key={norm.id} data-row={norm.id}
          tabIndex={norm.id === tabStop(active.map(item => item.id), route.objectId) ? 0 : -1} aria-selected={norm.id === route.objectId}
          onClick={() => { open(norm.id) }}>
          <td><strong title={norm.title.text}>{displayText(norm.title.text)}</strong></td><td className={css.figure}>v{norm.version}</td>
          <td><EnforcementBadge value={norm.enforcement} t={t} /></td><td>{norm.scope.text}</td>
          <td>{norm.effectiveFrom === undefined ? '—' : <TimeInterval from={norm.effectiveFrom} until={norm.until} t={t} />}</td>
        </tr>)}</tbody>
      </table>
      {active.length === 0 && <p className={css.muted}>{t('world.empty', { objects: t('world.gov.lens.norms') })}</p>}
    </div>
    {route.objectId !== undefined && <InspectorDock identity={route.objectId} t={t} sizing={props.sizing}
      close={() => { props.navigate({ objectId: undefined }); focusRow(list.current, route.objectId) }}
      title={<>{displayText(detail?.title.text ?? route.objectId)}
        {detail !== undefined && <span className={css.version}> v{detail.version}</span>}</>}
      eyebrow={detail === undefined ? undefined : <EnforcementBadge value={detail.enforcement} t={t} />}>
      <WindowStatus window={props.norm} retry={() => { props.reloadDetail?.() }} t={t} />
      <WindowCoverage window={props.norm} more={() => { props.reloadDetail?.(props.norm.coverage?.nextCursor) }}
        disabled={!props.connected} t={t} />
      {detail !== undefined && <>
        <TemporalFacts times={{ recorded: detail.recordedAt, effective: detail.effectiveFrom,
          knowable: detail.knowableAt, until: detail.until }} t={t} />
        <dl className={css.keyValue}>
          <div><dt>{t('world.gov.scope')}</dt><dd>{detail.scope.text}</dd></div>
          {detail.enforcement.mode === 'validated' && <div><dt>{t('world.gov.policy')}</dt><dd>{detail.enforcement.policyRef === undefined
            ? <span className={css.error}>{t('world.enforcement.missingPolicy')}</span> : <code>{detail.enforcement.policyRef}</code>}</dd></div>}
          {detail.sourceProposalId !== undefined && <div><dt>{t('world.gov.sourceProposal')}</dt><dd>
            <button type="button" className={css.refLink} onClick={() => { props.navigate({ lens: 'proposals', objectId: detail.sourceProposalId }) }}>
              <code title={detail.sourceProposalId}>{shortId(detail.sourceProposalId)}</code> ↗</button></dd></div>}
        </dl>
        <PrivacyGate value={detail.body} t={t}>{body => <p className={css.prose}>{body.text}</p>}</PrivacyGate>
        {detail.audit !== undefined && <section aria-label={t('world.gov.audit')}>
          <h4>{t('world.gov.audit')}</h4><ol>{detail.audit.map(step => <li key={`${step.kind}:${step.id}`}>
            {t(`world.gov.audit.${step.kind}`)} · {t(`world.gov.audit.${step.state}`)}
            {step.at !== undefined && <span> · {groupTime(step.at)}</span>}
            {step.source !== undefined && <Button variant="ghost" size="sm" onClick={() => { if (step.source) props.openRef(step.source) }}>
              {t('world.gov.audit.source')}</Button>}
          </li>)}</ol>
        </section>}
        <SourceLinks sources={detail.sources} open={props.openRef} t={t} />
      </>}
    </InspectorDock>}
  </>
}

/**
 * Version timelines grouped by norm; knowable time is a triangle before the interval when announced in advance.
 * Selecting two versions of one norm shows a body diff only when both bodies are disclosed.
 */
function History({ view, open, t }: { view: GovernanceView; open: (id: string) => void; t: WorldT }) {
  const [selected, setSelected] = useState<readonly string[]>([])
  const [compare, setCompare] = useState(false)
  const groups = new Map<string, NormVersionView[]>()
  for (const norm of view.norms) groups.set(norm.normId, [...groups.get(norm.normId) ?? [], norm])
  const times = view.norms.flatMap(norm => [norm.effectiveFrom, norm.knowableAt, norm.until]
    .filter((time): time is string => time !== undefined))
  const start = times.reduce((min, time) => compareTime(time, min) < 0 ? time : min, times[0] ?? '0')
  const end = [...times, view.now].reduce((max, time) => compareTime(time, max) > 0 ? time : max, view.now)
  const span = BigInt(end) - BigInt(start) || 1n
  const x = (time: SimTime) => Number((BigInt(time) - BigInt(start)) * 10000n / span) / 100
  const picked = view.norms.filter(norm => selected.includes(norm.id))
  const sameNorm = picked.length === 2 && picked[0]?.normId === picked[1]?.normId
  const [older, newer] = [...picked].sort((a, b) => compareTime(a.version, b.version))
  return <div className={css.history}>
    <div className={css.timelineTools}>
      <Button size="sm" variant="secondary" disabled={!sameNorm} onClick={() => { setCompare(true) }}>{t('world.gov.compare')}</Button>
      {!sameNorm && <span className={css.muted}>{t('world.gov.compareHint')}</span>}
    </div>
    {/* One shared scale for every norm: start and end of the loaded window and the viewing time as a cursor. */}
    {groups.size > 0 && <div className={css.historyAxis} aria-hidden="true">
      <span style={{ '--at': '0%' } as CSSProperties}>{groupTime(start)}</span>
      <span data-now style={{ '--at': `${String(x(view.now))}%` } as CSSProperties}>{t('world.org.now')} {groupTime(view.now)}</span>
      {compareTime(end, view.now) > 0 && <span data-end style={{ '--at': '100%' } as CSSProperties}>{groupTime(end)}</span>}
    </div>}
    {[...groups].map(([normId, versions]) => <section key={normId} className={css.normHistory}
      aria-label={versions[0]?.title.text ?? normId}>
      <h4>{displayText(versions[0]?.title.text ?? normId)}</h4>
      <div className={css.versionTrack} style={{ '--now': `${String(x(view.now))}%` } as CSSProperties}>{versions.map((version) => {
        const left = version.effectiveFrom === undefined ? 0 : x(version.effectiveFrom)
        const right = version.until === undefined ? 100 : x(version.until)
        const checked = selected.includes(version.id)
        return <div key={version.id} className={css.versionItem}>
          {version.knowableAt !== undefined && <span className={css.knowable} style={{ '--at': `${String(x(version.knowableAt))}%` } as CSSProperties}
            title={`${t('world.time.knowable')} ${groupTime(version.knowableAt)}`} aria-hidden="true">▸</span>}
          <button type="button" className={css.versionBar} data-open={version.until === undefined || undefined} aria-pressed={checked}
            style={{ '--left': `${String(left)}%`, '--width': `${String(Math.max(right - left, 1))}%` } as CSSProperties}
            aria-label={t('world.gov.select', { title: version.title.text, version: version.version })}
            onClick={() => { setSelected(checked ? selected.filter(id => id !== version.id) : [...selected.slice(-1), version.id]) }}
            onDoubleClick={() => { open(version.id) }}>v{version.version}{version.effectiveFrom !== undefined
              && <span className={css.versionSpan}> · <TimeInterval from={version.effectiveFrom} until={version.until} t={t} />
              </span>}</button>
          {version.until !== undefined && <span className={css.versionEnd} style={{ '--at': `${String(right)}%` } as CSSProperties} aria-hidden="true" />}
        </div>
      })}</div>
    </section>)}
    {compare && sameNorm && older !== undefined && newer !== undefined && <section className={css.diffPane} aria-label={t('world.gov.compare')}>
      <header><h4>{displayText(older.title.text)} v{older.version} → v{newer.version}</h4>
        <Button size="sm" variant="ghost" onClick={() => { setCompare(false) }}>{t('world.close')}</Button></header>
      {older.body.state === 'allowed' && newer.body.state === 'allowed'
        ? <DiffBlock diffs={[{ path: older.normId, oldText: older.body.value.text, newText: newer.body.value.text }]} />
        : <p className={css.gate}>{t('world.gov.compareWithheld')}</p>}
    </section>}
  </div>
}

/**
 * Inspector heading for a proposal that may not be loaded yet.
 * @param proposal - Loaded detail or list row, if any.
 * @param id - Selected proposal id.
 * @param t - Namespace translator.
 * @returns readable title, falling back to the compact id.
 */
function proposalHeading(proposal: Parameters<typeof proposalTitle>[0] | undefined, id: string, t: WorldT): string {
  return proposal === undefined ? displayText(id) : proposalTitle(proposal, t)
}
