/** Overview visualization panel: topology, flow, lanes, and their list equivalent. */
import { useMemo, useRef } from 'react'
import { describeVisualization, ViewSwitch, VizListView } from '@clocky/clocky-client-ui-viz'
import type { ParticipantId, TeamTaskId, TeamTaskSummary } from '@clocky/clocky-client-runtime/client'
import type { TeamPageProps } from './TeamPage.tsx'
import { memberLabels, memberPageLabels, referencedMemberName } from './member-labels.ts'
import { buildSwarm, type ChannelMembership } from './team-viz.ts'
import { SwarmTopology } from './SwarmTopology.tsx'
import { TaskFlowGraph } from './TaskFlowGraph.tsx'
import { AgentLanes } from './AgentLanes.tsx'
import type { SwarmPositions, TeamOverviewViz } from './workspace-store.ts'
import { vizWords } from './viz-words.ts'
import css from './TeamViz.module.css'

/** Inputs the panel reads from the Team page. */
export type TeamVisualizationProps = Pick<TeamPageProps, 'state' | 'collections' | 'memberReadiness' | 'identities' | 'translate'> & {
  readonly channelListState?: TeamPageProps['channelListState'] | undefined
  readonly channelState?: TeamPageProps['channelState'] | undefined
  readonly tasks: readonly TeamTaskSummary[]
  readonly viz: TeamOverviewViz
  readonly onVizChange: (viz: TeamOverviewViz) => void
  readonly positions?: SwarmPositions | undefined
  readonly onPositions?: ((positions: SwarmPositions) => void) | undefined
  readonly workflowDetail?: TeamPageProps['workflowDetail']
  readonly readWorkflowDetail?: TeamPageProps['readWorkflowDetail']
  readonly openTask: (taskId: TeamTaskId) => void
  readonly openMember?: ((id: ParticipantId) => void) | undefined
}

/**
 * Render the panel. Every view reads the same loaded records; the list view
 * names the same members as the topology with the same loaded/total count.
 * @param props - Team records already loaded by the page and the view choice.
 * @returns the panel.
 */
export function TeamVisualization(props: TeamVisualizationProps) {
  const { state, collections, memberReadiness, identities, translate: t, tasks } = props
  const loadedMembers = useMemo(() => memberLabels(state, memberPageLabels(collections?.members.items ?? [])),
    [state, collections?.members.items])
  const readiness = memberReadiness?.input.teamId === state.team.id ? memberReadiness : undefined
  const readinessStale = readiness?.disconnected === true || readiness?.error !== undefined
    || readiness?.value !== undefined && readiness.value.teamCursor < state.team.cursor
  const channels: ChannelMembership[] = useMemo(() => (props.channelListState?.teamId === state.team.id ? props.channelListState.items : [])
    .map(channel => ({ id: channel.manifest.id, participantIds: channel.manifest.participants.map(member => member.id) })),
  [props.channelListState, state.team.id])
  const liveChannelId = props.channelState?.page !== undefined ? props.channelState.channelId : undefined
  const model = useMemo(() => buildSwarm({
    members: loadedMembers, totalMembers: state.counts.participants, readiness: readiness?.value?.items ?? [], readinessStale,
    tasks, channels, liveChannelId, t,
    nameOf: id => referencedMemberName(id, loadedMembers.find(member => member.id === id)?.displayName, identities, t),
  }), [loadedMembers, state.counts.participants, readiness?.value, readinessStale, tasks, channels, liveChannelId, identities, t])
  const words = vizWords(t)
  const count = { loaded: model.loaded, total: model.total }
  const description = describeVisualization(t('viz.swarm.title'), model.items, count, words.describe)
  const taskSignatures = useMemo(() => new Map(tasks.map(task => [task.id as string, `${task.phase}:${String(task.revision)}`])), [tasks])
  const taskOwners = useMemo(() => new Map(tasks.flatMap(task => task.ownerId === undefined ? []
    : [[task.id as string, task.ownerId as string] as const])), [tasks])
  const deliveries = useMemo(() => (props.channelState?.page?.records ?? []).flatMap(record => record.type === 'channel/envelope'
    ? [{ id: record.envelope.id, senderId: record.envelope.senderId }] : []), [props.channelState?.page?.records])
  const select = (id: string) => {
    const meta = model.meta.get(id)
    if (meta?.participantId !== undefined && meta.kind === 'member') props.openMember?.(meta.participantId)
  }
  // The crossfade plays only after the user switches views; first paint stays settled.
  const switched = useRef(false)
  const changeViz = (next: TeamOverviewViz) => { switched.current = true; props.onVizChange(next) }
  const options = [
    { id: 'topology' as const, label: t('viz.topology') },
    { id: 'flow' as const, label: t('viz.flow') },
    { id: 'lanes' as const, label: t('viz.lanes') },
    { id: 'list' as const, label: t('viz.list') },
  ]
  return <section className={css.panel} aria-label={t('viz.swarm.title')} data-team-visualization={props.viz}>
    <div className={css.panelHeader}>
      <h2>{t(props.viz === 'flow' ? 'viz.flow.title' : props.viz === 'lanes' ? 'viz.lanes.title' : 'viz.swarm.title')}</h2>
      <div className={css.panelMeta}>
        {(props.viz === 'topology' || props.viz === 'lanes') && <span>{words.list.loaded(count.loaded, count.total)}</span>}
        <ViewSwitch label={t('viz.switch')} options={options} value={props.viz} onChange={changeViz} />
      </div>
    </div>
    {/* Keyed by view: each switch remounts and plays the short crossfade. */}
    <div key={props.viz} className={switched.current ? css.viewEnter : undefined}>
      {props.viz === 'topology' && (model.items.length === 0
        ? <p className={css.note}>{t('viz.empty')}</p>
        : <SwarmTopology teamId={state.team.id} cursor={state.team.cursor} phase={state.team.phase} model={model}
          positions={props.positions} onPositions={props.onPositions} deliveries={deliveries}
          taskSignatures={taskSignatures} taskOwners={taskOwners} description={description}
          onActivate={select} t={t} />)}
      {props.viz === 'flow' && <TaskFlowGraph plans={collections?.workflowPlans.items ?? []} detail={props.workflowDetail?.teamId === state.team.id ? props.workflowDetail : undefined}
        read={props.readWorkflowDetail} tasks={tasks} openTask={props.openTask} t={t} />}
      {props.viz === 'lanes' && <AgentLanes members={model.items.filter(item => model.meta.get(item.id)?.kind === 'member')}
        count={count} onSelect={select} t={t} />}
      {props.viz === 'list' && <VizListView label={t('viz.swarm.title')} items={model.items} count={count} words={words.list}
        onSelect={select} />}
    </div>
  </section>
}
