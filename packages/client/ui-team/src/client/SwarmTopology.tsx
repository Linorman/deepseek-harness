/** Swarm topology: who works with whom, laid out around the coordinator. */
import { useEffect, useMemo, useRef } from 'react'
import {
  GraphView, layoutRadialSwarm, useLiveChanges, useLiveTransition,
  type GraphNodeView, type GraphSignal, type Point,
} from '@clocky/clocky-client-ui-viz'
import type { SwarmModel } from './team-viz.ts'
import type { SwarmPositions } from './workspace-store.ts'
import type { TeamKey } from './locales.ts'

type Translate = (key: TeamKey, vars?: Record<string, unknown>) => string

/** Props of {@link SwarmTopology}. */
export interface SwarmTopologyProps {
  readonly teamId: string
  readonly cursor: number
  readonly phase: string
  readonly model: SwarmModel
  /** Settled positions from the view store; matching nodes stay where the user saw them. */
  readonly positions?: SwarmPositions | undefined
  readonly onPositions?: ((positions: SwarmPositions) => void) | undefined
  /** Sender ids of envelopes observed live in the open channel, newest last. */
  readonly deliveries?: readonly { readonly id: string; readonly senderId: string }[] | undefined
  /** Signature per task, for pulsing the owner of a task that changed live. */
  readonly taskSignatures: ReadonlyMap<string, string>
  readonly taskOwners: ReadonlyMap<string, string>
  readonly selectedId?: string | undefined
  readonly onSelect?: ((id: string) => void) | undefined
  readonly onActivate?: ((id: string) => void) | undefined
  readonly description: string
  readonly t: Translate
}

/**
 * Render the topology. Layout is seeded by the Team id and settled positions
 * persist in the view store, so revisiting the overview does not reshuffle
 * nodes. Particles fly only for the open channel's live envelopes; other
 * live task changes pulse the owning node once. The assemble moment plays
 * only when the Team was observed leaving provisioning while mounted.
 * @param props - Swarm model, live inputs, and selection.
 * @returns the interactive graph.
 */
export function SwarmTopology(props: SwarmTopologyProps) {
  const { model, t } = props
  const previous = useMemo(() => props.positions === undefined ? undefined
    : new Map<string, Point>(Object.entries(props.positions)), [props.positions])
  const layout = useMemo(() => layoutRadialSwarm({
    nodes: model.layout, links: model.links, seed: props.teamId, previous, ringGap: 104, nodeSpacing: 60,
  }),
  [model.layout, model.links, props.teamId, previous])
  // Persist newly settled nodes once; already stored nodes never move.
  const persisted = useRef<string>()
  useEffect(() => {
    if (props.onPositions === undefined) return
    const missing = [...layout.positions.keys()].some(id => props.positions?.[id] === undefined)
    const signature = [...layout.positions.keys()].sort().join('|')
    if (!missing || persisted.current === signature) return
    persisted.current = signature
    props.onPositions(Object.fromEntries(layout.positions))
  }, [layout, props.positions, props.onPositions])

  const nodes: GraphNodeView[] = model.items.map((item) => {
    const position = layout.positions.get(item.id) ?? { x: 0, y: 0 }
    const meta = model.meta.get(item.id)
    return { ...item, x: position.x, y: position.y, initials: meta?.initials, radius: meta?.kind === 'member' && item.id === model.layout.find(node => node.ring === 0)?.id ? 24 : 18 }
  })
  const clusters = [...layout.clusters].map(([id, cluster]) => ({ id, ...cluster, label: model.clusterLabels.get(id) ?? '' }))

  const phase = useLiveTransition(props.teamId, props.cursor, props.phase)
  const assemble = phase.live && phase.previous === 'provisioning' && props.phase === 'active'
  const changedTasks = useLiveChanges(props.teamId, props.taskSignatures)
  const deliveryIndex = useMemo(() => new Map((props.deliveries ?? []).map(entry => [entry.id, entry.senderId])), [props.deliveries])
  const deliveries = useLiveChanges(props.teamId, deliveryIndex)
  const signals = useMemo<GraphSignal[]>(() => {
    const out: GraphSignal[] = []
    for (const taskId of changedTasks) {
      const owner = props.taskOwners.get(taskId)
      if (owner !== undefined) out.push({ id: `task:${taskId}:${props.taskSignatures.get(taskId) ?? ''}`, nodeId: owner })
    }
    for (const delivery of props.deliveries ?? []) {
      if (!deliveries.has(delivery.id)) continue
      for (const edge of model.edges) {
        if (edge.active !== true) continue
        if (edge.from === delivery.senderId || edge.to === delivery.senderId) out.push({ id: `envelope:${delivery.id}:${edge.id}`, edgeId: edge.id })
      }
    }
    return out
  }, [changedTasks, deliveries])
  const changedNodes = useMemo(() => new Set([...changedTasks].flatMap((id) => {
    const owner = props.taskOwners.get(id)
    return owner === undefined ? [] : [owner]
  })), [changedTasks])

  return <GraphView label={t('viz.swarm.title')} description={props.description} nodes={nodes} edges={model.edges}
    clusters={clusters} selectedId={props.selectedId} onSelect={props.onSelect} onActivate={props.onActivate}
    height="clamp(240px, 30dvh, 440px)" signals={signals} changedIds={changedNodes} assemble={assemble}
    controls={{ zoomIn: t('viz.zoomIn'), zoomOut: t('viz.zoomOut'), fit: t('viz.fit') }}
    overlay={<>
      <span>{t('viz.legend.owner')}</span><span>{t('viz.legend.review')}</span>
      <span>{t('viz.legend.channel')}</span><span>{t('viz.legend.ghost')}</span>
    </>} />
}
