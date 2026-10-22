/** Bounded private draft projection; graph selection and list controls issue the same inert typed operations. */
import { useId, useMemo, useState } from 'react'
import { Button, Input } from '@clocky/clocky-client-ui-primitives'
import { GraphView, layoutLayered } from '@clocky/clocky-client-ui-viz'
import type { GraphNodeView, GraphEdgeView } from '@clocky/clocky-client-ui-viz'
import type { WorldScenarioV1, ScenarioDraftCommand } from '@clocky/clocky-simulation-scenario'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/**
 * Show at most 80 matching nodes, with explicit coverage and keyboard-equivalent edits.
 * @param props - Original definition, revision label and Host-validated command callback.
 * @returns graph/list editor; selecting or moving a node never writes a running world.
 */
export function WorldDraftGraph({ definition, revision, layout: savedLayout, changeLayout, disabled, command, t }: {
  definition: WorldScenarioV1
  revision: number | undefined
  layout?: readonly { readonly id: string; readonly x: number; readonly y: number }[] | undefined
  changeLayout: (value: readonly { readonly id: string; readonly x: number; readonly y: number }[]) => void
  disabled: boolean
  command: (value: ScenarioDraftCommand) => Promise<void>
  t: WorldT
}) {
  const id = useId()
  const [search, setSearch] = useState(''), [page, setPage] = useState(0), [selected, setSelected] = useState('')
  const [layer, setLayer] = useState<string>()
  const [target, setTarget] = useState(''), [newId, setNewId] = useState(''), [name, setName] = useState('')
  const [capacity, setCapacity] = useState('1')
  const [x, setX] = useState('0'), [y, setY] = useState('0')
  const observedAt = useMemo(() => new Date().toISOString(), [definition])
  const all = useMemo(() => {
    const units = new Map(definition.organization.units.map(unit => [unit.id, unit.parentId]))
    return [...definition.entities.map(entity => ({ id: entity.id, name: entity.name,
      kind: entity.kind === 'organization' ? 'unit' as const : entity.kind === 'person' ? 'person' as const : 'object' as const, parent: units.get(entity.id) })),
    ...definition.organization.positions.map(position => ({ id: position.id, name: position.name,
      kind: 'position' as const, parent: position.unitId }))]
  }, [definition])
  const visible = layer === undefined ? all : all.filter(node => node.id === layer || node.parent === layer)
  const filtered = visible.filter(node => `${node.id} ${node.name}`.toLowerCase().includes(search.toLowerCase()))
  const start = Math.min(page * 80, Math.max(0, Math.ceil(filtered.length / 80) - 1) * 80)
  const window = filtered.slice(start, start + 80), ids = new Set(window.map(node => node.id))
  const edges: GraphEdgeView[] = window.flatMap(node => node.parent !== undefined && ids.has(node.parent)
    ? [{ id: `parent:${node.id}`, from: node.parent, to: node.id, variant: 'solid', directed: true }] : [])
  for (const assignment of definition.organization.assignments) if (ids.has(assignment.personId) && ids.has(assignment.positionId)) {
    edges.push({ id: assignment.id, from: assignment.positionId, to: assignment.personId, variant: 'dashed', directed: true })
  }
  const layout = layoutLayered(window.map(node => node.id), edges, { direction: 'vertical', layerGap: 96, nodeGap: 120 })
  const nodes: GraphNodeView[] = window.map(node => ({ id: node.id, label: node.name, initials: node.name.slice(0, 2),
    x: savedLayout?.find(value => value.id === node.id)?.x ?? layout.positions.get(node.id)?.x ?? 0,
    y: savedLayout?.find(value => value.id === node.id)?.y ?? layout.positions.get(node.id)?.y ?? 0, state: 'idle',
    stateLabel: t(node.kind === 'unit' ? 'world.org.unit' : node.kind === 'position' ? 'world.org.position'
      : node.kind === 'person' ? 'world.section.people' : 'world.author.genericObject') }))
  const select = (nodeId: string) => {
    setSelected(nodeId)
    const node = nodes.find(value => value.id === nodeId)
    if (node !== undefined) { setX(String(node.x)); setY(String(node.y)) }
  }
  const totalEdges = all.filter(node => node.parent !== undefined).length + definition.organization.assignments.length
  const chosen = all.find(node => node.id === selected)
  const positive = /^[1-9][0-9]*$/.test(capacity) && Number.isSafeInteger(Number(capacity))
  const move = () => {
    if (chosen?.kind === 'unit') void command({ kind: 'unit/move', id: selected, parentId: target })
    if (chosen?.kind === 'position') void command({ kind: 'position/move', id: selected, unitId: target })
    if (chosen?.kind === 'person') void command({ kind: 'assignment/create', assignment: {
      id: newId, personId: selected, positionId: target, validFrom: '0', validUntil: null } })
  }
  return <section className={css.draftGraph} aria-label={t('world.author.graph')}>
    <p className={css.notice}>{t('world.author.templateOnly')}</p>
    <label htmlFor={`${id}-search`}>{t('world.author.graphSearch')}</label>
    <Input id={`${id}-search`} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} />
    <p>{t('world.author.graphObservedAt', { time: observedAt })}</p>
    <p role="status">{t('world.author.graphCoverage', { loaded: nodes.length, total: filtered.length, revision: revision ?? '—' })}</p>
    <p>{t('world.author.edgeCoverage', { loaded: edges.length, total: totalEdges, omitted: totalEdges - edges.length })}</p>
    <GraphView label={t('world.author.graph')} description={t('world.author.templateOnly')} nodes={nodes} edges={edges}
      selectedId={selected} onSelect={select} onConnect={disabled ? undefined : (from, to) => {
        const node = all.find(value => value.id === from)
        if (node?.kind === 'unit') void command({ kind: 'unit/move', id: from, parentId: to })
        if (node?.kind === 'position') void command({ kind: 'position/move', id: from, unitId: to })
        if (node?.kind === 'person') {
          setSelected(from); setTarget(to)
          if (newId !== '') void command({ kind: 'assignment/create', assignment: {
            id: newId, personId: from, positionId: to, validFrom: '0', validUntil: null } })
        }
      }} height={360}
      controls={{ zoomIn: t('visual.zoomIn'), zoomOut: t('visual.zoomOut'), fit: t('visual.fit') }} />
    <div className={css.authorActions}>
      <Button variant="secondary" disabled={chosen?.kind !== 'unit'} onClick={() => { setLayer(selected); setPage(0) }}>{t('world.author.childLayer')}</Button>
      <Button variant="secondary" disabled={layer === undefined} onClick={() => { setLayer(undefined); setPage(0) }}>{t('world.author.allLayers')}</Button>
      <Button variant="secondary" disabled={start === 0} onClick={() => { setPage(Math.max(0, page - 1)) }}>{t('world.author.previousWindow')}</Button>
      <Button variant="secondary" disabled={start + 80 >= filtered.length} onClick={() => { setPage(page + 1) }}>{t('world.author.nextWindow')}</Button>
    </div>
    <ul className={css.draftGraphList}>{window.map(node => <li key={node.id}><Button variant={selected === node.id ? 'primary' : 'ghost'}
      onClick={() => { select(node.id) }}>{node.name} · {node.id}</Button></li>)}</ul>
    <fieldset disabled={disabled} className={css.fieldGrid}>
      <legend>{t('world.author.layout')}</legend>
      <p>{t('world.author.layoutNotice')}</p>
      <div className={css.field}><label htmlFor={`${id}-x`}>X</label><Input id={`${id}-x`} type="number" min={-100000} max={100000} value={x}
        onChange={(event) => { setX(event.target.value) }} /></div>
      <div className={css.field}><label htmlFor={`${id}-y`}>Y</label><Input id={`${id}-y`} type="number" min={-100000} max={100000} value={y}
        onChange={(event) => { setY(event.target.value) }} /></div>
      <Button disabled={chosen === undefined || x.trim() === '' || y.trim() === ''
        || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y)) || Math.abs(Number(x)) > 100000 || Math.abs(Number(y)) > 100000}
      onClick={() => { changeLayout([...(savedLayout ?? []).filter(value => value.id !== selected),
        { id: selected, x: Number(x), y: Number(y) }]) }}>{t('world.author.layoutApply')}</Button>
      <Button variant="secondary" onClick={() => { changeLayout([]) }}>{t('world.author.layoutReset')}</Button>
    </fieldset>
    <fieldset disabled={disabled} className={`${css.fieldGrid} ${css.draftGraphFields}`}>
      <legend>{t('world.author.graphEdit')}</legend>
      <div className={css.field}><label htmlFor={`${id}-target`}>{t('world.author.targetId')}</label>
        <Input id={`${id}-target`} value={target} onChange={(event) => { setTarget(event.target.value) }} /></div>
      <div className={css.field}><label htmlFor={`${id}-new`}>{t('world.author.newId')}</label>
        <Input id={`${id}-new`} value={newId} onChange={(event) => { setNewId(event.target.value) }} /></div>
      <div className={css.field}><label htmlFor={`${id}-name`}>{t('world.author.nodeName')}</label>
        <Input id={`${id}-name`} value={name} onChange={(event) => { setName(event.target.value) }} /></div>
      <div className={css.field}><label htmlFor={`${id}-capacity`}>{t('world.author.nodeCapacity')}</label>
        <Input id={`${id}-capacity`} inputMode="numeric" value={capacity} onChange={(event) => { setCapacity(event.target.value) }} /></div>
      <Button variant="secondary" disabled={target === '' || newId === '' || name === ''} onClick={() => {
        void command({ kind: 'unit/create', id: newId, parentId: target, name, description: name })
      }}>{t('world.author.createUnit')}</Button>
      <Button variant="secondary" disabled={target === '' || newId === '' || name === '' || !positive} onClick={() => {
        void command({ kind: 'position/create', position: { id: newId, unitId: target, name, description: name,
          capacity: Number(capacity), permissions: [] } })
      }}>{t('world.author.createPosition')}</Button>
      <Button variant="secondary" disabled={chosen === undefined || chosen.kind === 'object' || target === '' || chosen.kind === 'person' && newId === ''}
        onClick={move}>{t('world.author.connectNode')}</Button>
      <Button variant="secondary" disabled={chosen?.kind !== 'position' || !positive} onClick={() => {
        void command({ kind: 'position/capacity', id: selected, capacity: Number(capacity) })
      }}>{t('world.author.changeCapacity')}</Button>
    </fieldset>
  </section>
}
