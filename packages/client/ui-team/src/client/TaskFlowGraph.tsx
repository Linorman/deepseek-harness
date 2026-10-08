/** Task flow graph: one workflow plan's dependencies, laid out in layers. */
import { useMemo } from 'react'
import {
  describeVisualization, GraphView, layoutLayered, longestChain, VizListView,
  type GraphEdgeView, type GraphNodeView,
} from '@clocky/clocky-client-ui-viz'
import type { TeamTaskId, TeamTaskSummary, TeamWorkflowDetailState, TeamWorkflowSummary } from '@clocky/clocky-client-runtime/client'
import { buildWorkflowFlow } from './team-viz.ts'
import type { TeamKey } from './locales.ts'
import { vizWords } from './viz-words.ts'
import css from './TeamViz.module.css'

type Translate = (key: TeamKey, vars?: Record<string, unknown>) => string

/**
 * Render the flow view. It draws only the selected plan's bounded window;
 * dependencies outside the window are ghosts, and the critical path appears
 * only when the whole plan is loaded. A Team-wide graph waits for the
 * dependency page read.
 * @param props - Loaded plans, the plan inspection, loaded task summaries, and actions.
 * @returns the plan picker and its graph with a list equivalent.
 */
export function TaskFlowGraph({ plans, detail, read, tasks, openTask, t }: {
  plans: readonly TeamWorkflowSummary[]
  detail?: TeamWorkflowDetailState | undefined
  read?: ((id: TeamWorkflowSummary['id'], mode?: 'open') => Promise<void>) | undefined
  tasks: readonly TeamTaskSummary[]
  openTask: (taskId: TeamTaskId) => void
  t: Translate
}) {
  const value = detail?.value
  const flow = useMemo(() => value === undefined ? undefined : buildWorkflowFlow(value, tasks, t), [value, tasks, t])
  const graph = useMemo(() => {
    if (flow === undefined) return undefined
    const ids = flow.nodes.map(node => node.id)
    const layout = layoutLayered(ids, flow.edges, { layerGap: 170, nodeGap: 84 })
    const critical = flow.complete ? new Set(longestChain(ids, flow.edges)) : new Set<string>()
    const nodes: GraphNodeView[] = flow.nodes.map((node) => {
      const position = layout.positions.get(node.id)
      return { ...node, x: position?.x ?? 0, y: position?.y ?? 0, radius: 14, emphasis: critical.has(node.id) || undefined }
    })
    const edges: GraphEdgeView[] = flow.edges.map(edge => ({ id: `${edge.from}→${edge.to}`, from: edge.from, to: edge.to, directed: true, curvature: 0.08,
      variant: flow.nodes.find(node => node.id === edge.from)?.ghost === true ? 'ghost' : 'solid',
      emphasis: critical.has(edge.from) && critical.has(edge.to) || undefined }))
    return { nodes, edges, critical }
  }, [flow])
  const activate = (id: string) => {
    const taskId = flow?.nodes.find(node => node.id === id)?.taskId
    if (taskId !== undefined) openTask(taskId as TeamTaskId)
  }
  const words = vizWords(t)
  return <div className={css.panelBody}>
    {plans.length === 0
      ? <p className={css.note}>{t('viz.flow.noPlans')}</p>
      : <div className={css.planPicker} role="group" aria-label={t('viz.flow.plan')}>
        {plans.map(plan => <button key={plan.id} type="button" aria-pressed={detail?.planId === plan.id}
          disabled={read === undefined} onClick={() => { void read?.(plan.id, 'open') }}>{plan.name.text || plan.id}</button>)}
      </div>}
    {detail?.loading === true && <p className={css.note} role="status">{t('viz.flow.loading')}</p>}
    {flow === undefined || graph === undefined
      ? <p className={css.note}>{t('viz.flow.empty')}</p>
      : <>
        <GraphView label={t('viz.flow.title')} height={320}
          description={describeVisualization(t('viz.flow.title'), flow.nodes, { loaded: flow.loaded, total: flow.total }, words.describe)}
          nodes={graph.nodes} edges={graph.edges} onActivate={activate}
          controls={{ zoomIn: t('viz.zoomIn'), zoomOut: t('viz.zoomOut'), fit: t('viz.fit') }}
          overlay={<span>{flow.complete ? `${t('viz.flow.critical')} · ${String(graph.critical.size)}`
            : t('viz.flow.partial', { loaded: flow.loaded, total: flow.total })}</span>} />
        <details>
          <summary className={css.note}>{t('viz.list')}</summary>
          <VizListView label={t('viz.flow.title')} items={flow.nodes} count={{ loaded: flow.loaded, total: flow.total }}
            words={words.list} onSelect={activate} />
        </details>
      </>}
  </div>
}
