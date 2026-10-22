import { HiringMarket } from './WorldHiringMarket.tsx'
import type { HiringMarketView, HiringMarketFamily } from './world-domain.ts'
/** Organization module: structure, tenure timeline and people, each at an explicit viewing time. */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button, Input, Menu, IconChevronDownOutline14 } from '@clocky/clocky-client-ui-primitives'
import { GraphView, Moment, ViewSwitch, describeVisualization, layoutLayered } from '@clocky/clocky-client-ui-viz'
import { useLiveEntry } from './world-motion.ts'
import type { GraphEdgeView, GraphNodeView } from '@clocky/clocky-client-ui-viz'
import type { ActionHint, EngineRef, Obligation, ObligationDisposition, OrganizationLens, OrganizationView, OrgNode, PersonDetailView,
  PersonRow, SimTime, Tenure, WorldWindow } from './world-domain.ts'
import { SIM_TIME, windowValue } from './world-domain.ts'
import { CopyId, CoverageNote, PrivacyGate, TimeInterval, WindowStatus, WindowCoverage, groupTime, actionHintReason, shortId } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import { InspectorDock, WorkspaceStage, focusRow, tabStop, tableKeys } from './WorldInspector.tsx'
import type { InspectorSizing } from './WorldInspector.tsx'
import { OccupancyMeter } from './WorldTracks.tsx'
import { ObligationList } from './WorldVotes.tsx'
import { EngineRefLink, SourceLinks, useLiveRows } from './WorldRefs.tsx'
import css from './World.module.css'

/** Route-derived selection for the module. */
export interface OrganizationRoute {
  readonly lens: OrganizationLens
  readonly at?: SimTime | undefined
  readonly objectId?: string | undefined
  readonly section?: 'identity' | 'tenure' | 'obligations' | 'actions' | undefined
  /** People filter from the attention strip, e.g. `handoff-required`. */
  readonly filter?: string | undefined
}

interface Props {
  reviewPersona?: ((positionId: string, revision: number, command: string) => void) | undefined
  market?: WorldWindow<HiringMarketView> | undefined
  readMarket?: ((family: HiringMarketFamily, cursor?: string) => void) | undefined
  /** Wide-screen inspector width and resize callback; absent keeps the responsive default. */
  sizing?: InspectorSizing | undefined
  route: OrganizationRoute
  window: WorldWindow<OrganizationView>
  person: WorldWindow<PersonDetailView>
  connected: boolean
  navigate: (next: Partial<OrganizationRoute>, push?: boolean) => void
  reload: (cursor?: string) => void
  reloadDetail?: ((cursor?: string) => void) | undefined
  openRef: (ref: EngineRef) => void
  openAction: (person: PersonDetailView, hint: ActionHint) => void
  dispose: (person: PersonDetailView, obligation: Obligation, disposition: ObligationDisposition) => void
  t: WorldT
}

/**
 * Render the organization module.
 * @param props - Domain windows, route selection and navigation/management callbacks.
 * @returns lens bar, coverage, the selected lens and an optional inspector.
 */
export function OrganizationModule(props: Props) {
  const { route, t } = props
  const shown = windowValue(props.window)
  const value = shown?.value
  const historical = route.at !== undefined
  return <div className={css.module} data-loading={props.window.status === 'loading' || undefined}>
    <div className={css.moduleBar}>
      <ViewSwitch label={t('world.nav.organization')} value={route.lens} options={(['structure', 'timeline', 'people'] as const)
        .map(id => ({ id, label: t(`world.org.lens.${id}`) }))} onChange={(lens) => { props.navigate({ lens, objectId: undefined, section: undefined }) }} />
      <TimePicker at={route.at} commit={(at) => { props.navigate({ at }) }} t={t} />
      {value !== undefined && <CoverageNote value={value.coverage} stale={shown?.stale} disabled={!props.connected || props.window.status !== 'ready'}
        more={() => { props.reload(value.coverage.nextCursor) }} t={t} />}
    </div>
    {historical && <div className={css.historyBanner} role="status">
      <span>{t('world.org.historical', { at: groupTime(route.at ?? '') })}</span>
      <Button size="sm" variant="secondary" onClick={() => { props.navigate({ at: undefined }) }}>{t('world.org.backToLatest')}</Button>
    </div>}
    {props.market !== undefined && props.readMarket !== undefined && <HiringMarket window={props.market}
      connected={props.connected} read={props.readMarket} review={historical ? undefined : props.reviewPersona}
      positions={value?.nodes.filter(node => node.kind === 'position') ?? []} revision={shown?.stale ? undefined : value?.coverage.revision}
      openRef={props.openRef} t={t} />}
    <WindowStatus window={props.window} retry={() => { props.reload() }} t={t} />
    {value !== undefined && <WorkspaceStage detail={route.objectId !== undefined}>
      {route.lens === 'structure' && <Structure previewAllowed={!historical && props.connected} view={value} selected={route.objectId} select={(id) => { props.navigate({ objectId: id }) }} t={t} />}
      {route.lens === 'timeline' && <TenureTimeline view={value} t={t} select={(id) => { props.navigate({ lens: 'people', objectId: id }) }} />}
      {route.lens === 'people' && <People view={value} route={route} historical={historical} props={props} />}
    </WorkspaceStage>}
  </div>
}

/**
 * Viewing-time control: decimal input plus quick choices; reads happen only on commit.
 * @param props.at - Committed time; undefined means latest.
 * @param props.commit - Commit a valid time or latest.
 * @returns labelled control with inline validation.
 */
export function TimePicker({ at, commit, t }: { at?: SimTime | undefined; commit: (at: SimTime | undefined) => void; t: WorldT }) {
  const id = useId()
  const [draft, setDraft] = useState(at ?? '')
  const [menu, setMenu] = useState(false)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => { setDraft(at ?? ''); setInvalid(false) }, [at])
  const submit = () => {
    const next = draft.trim()
    if (next === '') { setInvalid(false); if (at !== undefined) commit(undefined); return }
    if (!SIM_TIME.test(next)) { setInvalid(true); return }
    setInvalid(false); if (next !== at) commit(next)
  }
  return <div className={css.timePicker}>
    <label htmlFor={`${id}-at`}>{t('world.org.at')}</label>
    <Input id={`${id}-at`} inputMode="numeric" value={draft} placeholder={t('world.org.at.latest')} aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      onChange={(event) => { setDraft(event.target.value) }} onBlur={submit}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } }} />
    <Menu open={menu} portal items={[{ id: 'latest', label: t('world.org.at.latest') }, { id: 'start', label: t('world.org.at.start') }]}
      anchor={<Button size="sm" variant="ghost" aria-label={t('world.org.at')} aria-expanded={menu} onClick={() => { setMenu(!menu) }}>
        <IconChevronDownOutline14 /></Button>}
      onClose={() => { setMenu(false) }} onSelect={(id) => { setMenu(false); commit(id === 'latest' ? undefined : '0') }} />
    {invalid && <span id={`${id}-error`} className={css.fieldError} role="alert">{t('world.org.at.invalid')}</span>}
  </div>
}

function Structure({ view, selected, select, previewAllowed, t }: { view: OrganizationView
  previewAllowed: boolean
  selected?: string | undefined
  select: (id: string) => void
  t: WorldT }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const table = useRef<HTMLDivElement>(null)
  const children = useMemo(() => {
    const map = new Map<string | undefined, OrgNode[]>()
    for (const node of view.nodes) {
      const parent = view.nodes.some(item => item.id === node.parentId) ? node.parentId : undefined
      map.set(parent, [...map.get(parent) ?? [], node])
    }
    // Units lead each level so the hierarchy reads top-down before positions without a placement.
    for (const [parent, nodes] of map) map.set(parent, nodes.toSorted((a, b) => Number(a.kind !== 'unit') - Number(b.kind !== 'unit')))
    return map
  }, [view.nodes])
  const rows: { node: OrgNode; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      rows.push({ node, depth })
      if (!collapsed.has(node.id)) walk(node.id, depth + 1)
    }
  }
  walk(undefined, 0)
  const treeStop = tabStop(rows.map(row => row.node.id), selected)
  const unit = view.nodes.find(node => node.id === selected && node.kind === 'unit')
    ?? view.nodes.find(node => node.id === view.nodes.find(item => item.id === selected)?.parentId)
    // Nothing selected yet: show the first root unit's neighbourhood instead of an empty pane.
    ?? (selected === undefined ? rows.find(row => row.node.kind === 'unit')?.node : undefined)
  return <div className={css.split}>
    <div ref={table} className={css.treeTable} role="treegrid" aria-label={t('world.org.lens.structure')}
      onKeyDown={(event) => { tableKeys(event, select) }}>
      {rows.map(({ node, depth }) => {
        const hasChildren = (children.get(node.id)?.length ?? 0) > 0
        return <div key={node.id} role="row" data-row={node.id} tabIndex={node.id === treeStop ? 0 : -1} aria-level={depth + 1} aria-selected={node.id === selected}
          aria-expanded={hasChildren ? !collapsed.has(node.id) : undefined} className={css.treeRow} data-kind={node.kind}
          style={{ '--depth': depth } as CSSProperties} onClick={() => { select(node.id) }}>
          <span role="gridcell" className={css.treeName}>
            {hasChildren ? <button type="button" className={css.disclosure} aria-label={t(collapsed.has(node.id) ? 'world.org.expand' : 'world.org.collapse', { name: node.name.text })}
              onClick={(event) => {
                event.stopPropagation()
                const next = new Set(collapsed); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); setCollapsed(next)
              }}>{collapsed.has(node.id) ? '▸' : '▾'}</button> : <span className={css.disclosureSpacer} />}
            <span className={css.kindTag}>{t(node.kind === 'unit' ? 'world.org.unit' : 'world.org.position')}</span>
            <strong>{node.name.text}</strong>
          </span>
          <span role="gridcell">{node.occupancy !== undefined && <OccupancyMeter {...node.occupancy} t={t} />}</span>
        </div>
      })}
      {view.unloadedNodes > 0 && <div className={css.treeRow} data-kind="ghost" role="row">
        <span role="gridcell" className={css.muted}>{t('world.coverage.unloaded', { count: view.unloadedNodes })}</span></div>}
    </div>
    <div className={css.graphPane}>{unit === undefined ? <p className={css.muted}>{t('world.org.graph.select')}</p>
      : <LocalGraph previewAllowed={previewAllowed} view={view} unit={unit} selected={selected} select={select} t={t} />}</div>
  </div>
}

function LocalGraph({ view, unit, selected, select, previewAllowed, t }: { view: OrganizationView
  previewAllowed: boolean
  unit: OrgNode
  selected?: string | undefined
  select: (id: string) => void
  t: WorldT }) {
  const [blockedMove, setBlockedMove] = useState<{ from: string; to: string }>()
  const near = view.nodes.filter(node => node.id === unit.id || node.parentId === unit.id || node.id === unit.parentId).slice(0, 80)
  const ids = near.map(node => node.id)
  const edges = view.edges.filter(edge => ids.includes(edge.from) && ids.includes(edge.to))
  const layout = layoutLayered(ids, edges.map(edge => ({ from: edge.from, to: edge.to })), { direction: 'vertical', layerGap: 96, nodeGap: 120 })
  const nodes: GraphNodeView[] = near.map((node) => {
    const position = layout.positions.get(node.id)
    const full = node.occupancy !== undefined && node.occupancy.occupied + node.occupancy.reserved >= node.occupancy.capacity
    return { id: node.id, x: position?.x ?? 0, y: position?.y ?? 0, label: node.name.text, initials: node.name.text.slice(0, 2),
      state: node.kind === 'unit' ? 'idle' : full ? 'blocked' : 'done', stateLabel: t(node.kind === 'unit' ? 'world.org.unit' : 'world.org.position'),
      detail: node.occupancy === undefined ? undefined : t('world.occupancy', node.occupancy) }
  })
  const graphEdges: GraphEdgeView[] = edges.map(edge => ({ id: edge.id, from: edge.from, to: edge.to,
    variant: edge.kind === 'parent' ? 'solid' : 'dashed', directed: true }))
  const label = t('world.org.graph', { name: unit.name.text })
  const words = { loaded: (loaded: number, total: number | undefined) => total === undefined ? t('visual.loadedOnly', { loaded })
    : t('visual.loaded', { loaded, total }), state: (count: number, state: string) => t('visual.stateCount', { count, state }),
  ghosts: (count: number) => t('visual.ghosts', { count }), stale: (count: number) => t('visual.staleCount', { count }) }
  return <><GraphView label={label} description={describeVisualization(label, nodes, { loaded: nodes.length }, words)} nodes={nodes}
    edges={graphEdges} selectedId={selected} onSelect={select} onConnect={previewAllowed ? (from, to) => { setBlockedMove({ from, to }) } : undefined} height={320} renderer="svg"
    controls={{ zoomIn: t('visual.zoomIn'), zoomOut: t('visual.zoomOut'), fit: t('visual.fit') }} />
  {blockedMove !== undefined && <div className={css.notice} role="status">
    <p>{blockedMove.from} → {blockedMove.to}</p><p>{t('world.org.structurePreviewBlocked')}</p>
    <Button variant="secondary" onClick={() => { setBlockedMove(undefined) }}>{t('world.close')}</Button>
  </div>}
  </>
}

/**
 * Tenure lanes grouped by unit: `[from, until)` bars, open ends fade to "now", transfers meet at a diamond,
 * requested-versus-actual offsets draw a thin connector, departures end with a rule, terminations with a cross.
 * Zoom changes tick density only and never reads more data.
 */
function TenureTimeline({ view, select, t }: { view: OrganizationView; select: (personId: string) => void; t: WorldT }) {
  const [zoom, setZoom] = useState(1)
  const [table, setTable] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const from = BigInt(view.range.from), until = BigInt(view.range.until) > BigInt(view.range.from)
    ? BigInt(view.range.until) : BigInt(view.range.from) + 1n
  const span = until - from
  const x = (time: SimTime) => {
    const value = BigInt(time)
    const clamped = value < from ? from : value > until ? until : value
    return Number((clamped - from) * 10000n / span) / 100
  }
  const groups = new Map<string, PersonRow[]>()
  for (const person of view.people) {
    const unit = person.unitId ?? ''
    groups.set(unit, [...groups.get(unit) ?? [], person])
  }
  const unitName = (id: string) => view.nodes.find(node => node.id === id)?.name.text ?? id
  const ticks = Array.from({ length: Math.round(4 * zoom) + 1 }, (_, index) =>
    (from + span * BigInt(index) / BigInt(Math.round(4 * zoom))).toString())
  return <div className={css.timeline}>
    <div className={css.timelineTools}>
      <Button size="sm" variant="ghost" aria-label={t('world.org.zoomOut')} disabled={zoom <= 1} onClick={() => { setZoom(Math.max(1, zoom / 2)) }}>−</Button>
      <Button size="sm" variant="ghost" aria-label={t('world.org.zoomIn')} disabled={zoom >= 8} onClick={() => { setZoom(Math.min(8, zoom * 2)) }}>+</Button>
      <Button size="sm" variant="ghost" aria-pressed={table} onClick={() => { setTable(!table) }}>{t(table ? 'world.showVisual' : 'world.showTable')}</Button>
    </div>
    {table ? <table className={css.dataTable}><thead><tr><th>{t('world.org.people.name')}</th><th>{t('world.org.position')}</th>
      <th>{t('world.gov.interval')}</th></tr></thead>
    <tbody>{view.people.flatMap(person => person.tenures.map(tenure => <tr key={tenure.id}>
      <td>{person.name.text}</td><td>{tenure.positionName.text}</td><td><TimeInterval from={tenure.from} until={tenure.until} t={t} /></td>
    </tr>))}</tbody></table>
      : <div className={css.lanesScroll} tabIndex={0} aria-label={t('world.org.lens.timeline')}
        onKeyDown={(event) => {
          if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(Math.min(8, zoom * 2)) }
          if (event.key === '-') { event.preventDefault(); setZoom(Math.max(1, zoom / 2)) }
        }}>
        <div className={css.lanes} style={{ '--zoom': zoom } as CSSProperties}>
          <div className={css.laneAxis} aria-hidden="true">{ticks.map((tick, index) => <span key={tick}
            data-edge={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : undefined} style={{ '--at': `${String(x(tick))}%` } as CSSProperties}>
            {groupTime(tick)}</span>)}</div>
          {[...groups].map(([unit, people]) => <section key={unit} className={css.laneGroup}>
            <button type="button" className={css.laneGroupHead} aria-expanded={!collapsed.has(unit)} onClick={() => {
              const next = new Set(collapsed); if (next.has(unit)) next.delete(unit); else next.add(unit); setCollapsed(next)
            }}>{collapsed.has(unit) ? '▸' : '▾'} {unit === '' ? t('world.org.noUnit') : unitName(unit)} <span className={css.figure}>{people.length}</span></button>
            {!collapsed.has(unit) && people.map(person => <div key={person.id} className={css.lane}>
              <button type="button" className={css.laneLabel} onClick={() => { select(person.id) }}>{person.name.text}</button>
              <div className={css.laneTrack}>
                {person.tenures.map((tenure, index) => <TenureBar key={tenure.id} tenure={tenure} x={x}
                  joined={index > 0 && person.tenures[index - 1]?.until === tenure.from} t={t} />)}
                {person.employment === 'terminated' && <span className={css.terminated} aria-hidden="true"
                  style={{ '--at': `${String(x(person.tenures.at(-1)?.until ?? view.now))}%` } as CSSProperties}>⨯</span>}
              </div>
            </div>)}
          </section>)}
          <div className={css.laneOverlay} aria-hidden="true"><span className={css.nowCursor} data-end={x(view.now) > 85 || undefined}
            style={{ '--at': `${String(x(view.now))}%` } as CSSProperties}>
            <span>{t('world.org.now')}</span></span></div>
        </div>
      </div>}
  </div>
}

function TenureBar({ tenure, x, joined, t }: { tenure: Tenure; x: (time: SimTime) => number; joined: boolean; t: WorldT }) {
  const left = x(tenure.from), right = tenure.until === undefined ? 100 : x(tenure.until)
  const sentence = `${tenure.positionName.text} · ${t('world.interval', { from: groupTime(tenure.from),
    until: tenure.until === undefined ? t('world.untilNow') : groupTime(tenure.until) })}`
  return <>
    <span className={css.tenure} data-open={tenure.until === undefined || undefined} data-end={tenure.end}
      style={{ '--left': `${String(left)}%`, '--width': `${String(Math.max(right - left, 0.6))}%` } as CSSProperties}
      role="img" aria-label={sentence} title={sentence}><span>{tenure.positionName.text}</span></span>
    {joined && <span className={css.diamond} style={{ '--at': `${String(left)}%` } as CSSProperties} aria-hidden="true" />}
    {tenure.requestedAt !== undefined && tenure.requestedAt !== tenure.from && <span className={css.requested}
      style={{ '--from': `${String(x(tenure.requestedAt))}%`, '--to': `${String(left)}%` } as CSSProperties}
      title={t('world.org.requested', { requested: groupTime(tenure.requestedAt), actual: groupTime(tenure.from) })} aria-hidden="true" />}
  </>
}

function People({ view, route, historical, props }: { view: OrganizationView
  route: OrganizationRoute
  historical: boolean
  props: Props }) {
  const { t } = props
  const live = useLiveRows(`${view.runId}:people`, view.people, row => row.id, t)
  const table = useRef<HTMLTableElement>(null)
  const rows = route.filter === undefined ? view.people
    : view.people.filter(person => route.filter === 'handoff-required' ? person.pendingObligations !== null && person.pendingObligations > 0
      : route.filter === 'retirement-unconfirmed' ? person.residency === 'retirement-unconfirmed' : true)
  const peopleStop = tabStop(rows.map(row => row.id), route.objectId)
  const person = windowValue(props.person)?.value
  const detail = person !== undefined && person.personId === route.objectId ? person : undefined
  const stall = useLiveEntry(detail?.personId ?? '', detail, detail?.residency === 'retirement-unconfirmed')
  const open = (id: string) => { props.navigate({ objectId: id, section: route.section ?? 'identity' }) }
  const close = () => { props.navigate({ objectId: undefined, section: undefined }); focusRow(table.current, route.objectId) }
  const obligationText = (row: PersonRow) => row.pendingObligations === null ? t('world.unknown') : String(row.pendingObligations)
  // Columns whose loaded values are all identical fold into one "this page" summary so differing columns get the width.
  const columns = [
    { id: 'cognition', label: t('world.org.people.cognition'), text: (row: PersonRow) => t(`world.org.cognition.${row.cognition}`) },
    { id: 'residency', label: t('world.org.people.residency'), text: (row: PersonRow) => t(`world.org.residency.${row.residency}`) },
    { id: 'obligations', label: t('world.org.people.obligations'), text: obligationText },
  ] as const
  const uniform = rows.length < 2 ? [] : columns.flatMap((column) => {
    const values = new Set(rows.map(column.text))
    const [only] = values
    return values.size === 1 && only !== undefined ? [{ id: column.id, label: column.label, text: only }] : []
  })
  const shown = { cognition: !uniform.some(column => column.id === 'cognition'),
    residency: !uniform.some(column => column.id === 'residency'), obligations: !uniform.some(column => column.id === 'obligations') }
  return <>
    <div className={css.tablePane}>
      {uniform.length > 0 && <p className={css.columnSummary}>{t('world.columns.summary', { count: rows.length,
        facts: uniform.map(column => t('world.columns.fact', { label: column.label, value: column.text })).join(' · ') })}</p>}
      <table ref={table} className={css.dataTable} aria-label={t('world.org.lens.people')} onKeyDown={(event) => { tableKeys(event, open) }}>
        <thead><tr><th>{t('world.org.people.name')}</th><th>{t('world.org.people.position')}</th><th>{t('world.org.people.employment')}</th>
          {shown.cognition && <th>{t('world.org.people.cognition')}</th>}{shown.residency && <th>{t('world.org.people.residency')}</th>}
          {shown.obligations && <th>{t('world.org.people.obligations')}</th>}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} data-row={row.id} tabIndex={row.id === peopleStop ? 0 : -1}
          aria-selected={row.id === route.objectId}
          data-changed={live.changed.has(row.id) || undefined}
          onClick={() => { open(row.id) }}>
          <td><span className={css.personCell}><span className={css.personAvatar} aria-hidden="true">{Array.from(row.name.text)[0] ?? '?'}</span>
            <span><strong>{row.name.text}</strong><small className={css.rowId} title={row.id}>{shortId(row.id)}</small></span></span></td>
          <td>{row.position?.text ?? '—'}</td>
          <td className={css.cellTight}><span className={css.stateTag} data-state={row.employment}>{t(`world.org.employment.${row.employment}`)}</span></td>
          {shown.cognition && <td className={css.cellTight}>{t(`world.org.cognition.${row.cognition}`)}</td>}
          {shown.residency && <td className={css.cellTight}><span className={css.stateTag} data-state={row.residency}>{t(`world.org.residency.${row.residency}`)}</span></td>}
          {shown.obligations && <td className={`${css.figure} ${css.cellTight}`}>{obligationText(row)}</td>}
        </tr>)}</tbody>
      </table>
      {rows.length === 0 && <p className={css.muted}>{t('world.empty', { objects: t('world.org.lens.people') })}</p>}
    </div>
    <span className={css.srOnly} aria-live="polite">{live.announcement}</span>
    {route.objectId !== undefined && <InspectorDock identity={route.objectId} t={t} close={close} sizing={props.sizing}
      title={detail?.name.text ?? view.people.find(row => row.id === route.objectId)?.name.text ?? route.objectId}
      eyebrow={detail === undefined ? undefined : t(`world.org.employment.${detail.employment}`)}
      sections={{ current: route.section ?? 'identity', select: (section) => { props.navigate({ section: section as OrganizationRoute['section'] }, false) },
        items: (['identity', 'tenure', 'obligations', 'actions'] as const).map(id => ({ id, label: t(`world.org.person.${id}`) })) }}>
      <WindowStatus window={props.person} retry={() => { props.reloadDetail?.() }} t={t} />
      <WindowCoverage window={props.person} more={() => { props.reloadDetail?.(props.person.coverage?.nextCursor) }}
        disabled={!props.connected} t={t} />
      {detail !== undefined && <Moment kind="stall" generation={stall}>
        <PersonSection person={detail} section={route.section ?? 'identity'} historical={historical} props={props} />
        <SourceLinks sources={detail.sources} open={props.openRef} t={t} /></Moment>}
    </InspectorDock>}
  </>
}

function PersonSection({ person, section, historical, props }: { person: PersonDetailView
  section: NonNullable<OrganizationRoute['section']>
  historical: boolean
  props: Props }) {
  const { t } = props
  switch (section) {
    case 'identity': return <>
      {person.employment === 'departing' && <p className={css.warning} role="status">{t('world.org.person.departing')}</p>}
      {person.employment === 'departed' && <p className={css.muted}>{t('world.org.person.ended')}</p>}
      {person.residency === 'retiring' && <p className={css.muted}>{t('world.org.person.retirement')}</p>}
      {person.residency === 'retirement-unconfirmed' && <div className={css.warning} role="status">
        <span>{t('world.org.residency.retirement-unconfirmed')}</span>
        <Button size="sm" variant="secondary" onClick={() => { props.navigate({ section: 'obligations' }) }}>
          {t('world.action.viewObligations')}</Button></div>}
      <dl className={css.keyValue}>
        <div><dt>Entity</dt><dd><EngineRefLink value={person.entity} open={props.openRef} t={t} /></dd></div>
        {person.participantId !== undefined && <div><dt>Participant</dt><dd><CopyId value={person.participantId} t={t} /></dd></div>}
        {person.sessionId !== undefined && <div><dt>Session</dt><dd><CopyId value={person.sessionId} t={t} /></dd></div>}
        <div><dt>{t('world.org.people.residency')}</dt><dd>{t(`world.org.residency.${person.residency}`)}</dd></div>
        <div><dt>{t('revision')}</dt><dd className={css.figure}>r{person.revision}</dd></div>
      </dl>
      <h4>{t('world.org.person.persona')}</h4>
      <PrivacyGate value={person.persona} t={t}>{persona => <p className={css.prose}>{persona.summary.text}</p>}</PrivacyGate>
    </>
    case 'tenure': return <ul className={css.tenureList}>{person.tenures.map(tenure => <li key={tenure.id}>
      <strong>{tenure.positionName.text}</strong><TimeInterval from={tenure.from} until={tenure.until} t={t} />
      {tenure.requestedAt !== undefined && tenure.requestedAt !== tenure.from && <small className={css.muted}>
        {t('world.org.requested', { requested: groupTime(tenure.requestedAt), actual: groupTime(tenure.from) })}</small>}
      {/* The exact relation identity stays in the text and title; one clamped line keeps the list readable. */}
      <small className={css.tenureId} title={`#${tenure.id} · r${String(tenure.revision)}`}>#{tenure.id} · r{tenure.revision}</small></li>)}</ul>
    case 'obligations': return <ObligationList items={person.obligations} openRef={props.openRef}
      complete={props.person.status === 'ready' && !props.person.stale && props.person.coverage?.complete === true}
      disabledReason={historical ? t('world.org.historicalDisabled') : !props.connected ? t('world.disconnected') : undefined}
      dispose={historical || !props.connected ? undefined : (obligation, disposition) => {
        props.dispose(person, obligation, disposition) }} t={t} />
    case 'actions': return person.actions.length === 0 ? <p className={css.muted}>{t('world.org.person.noActions')}</p>
      : <div className={css.actionList}>{person.actions.map((hint) => {
        const blocked = historical ? t('world.org.historicalDisabled') : !props.connected ? t('world.disconnected')
          : hint.allowed ? undefined : actionHintReason(hint.reason, t) ?? t('world.unavailable')
        return <div key={hint.action} className={css.actionRow}>
          <Button variant="secondary" disabled={blocked !== undefined} onClick={() => { props.openAction(person, hint) }}>
            {t(`world.action.${hint.action}`)}</Button>
          {blocked !== undefined && <span className={css.muted}>{blocked}</span>}
          {!hint.allowed && <Button variant="secondary" size="sm" onClick={() => { props.navigate({ section: 'obligations' }) }}>
            {t('world.action.viewObligations')}</Button>}
        </div>
      })}</div>
    default: { const unreachable: never = section; throw new Error(`Unknown person section ${String(unreachable)}`) }
  }
}
