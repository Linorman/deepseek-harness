/**
 * Pure view models for the Team visualizations. Every node, edge, and ring
 * segment comes from a loaded authoritative record; anything referenced but
 * not loaded becomes a ghost, and nothing is estimated.
 */
import type { GraphEdgeView, RingSegment, SwarmLinkInput, SwarmNodeInput, VizItem, VizState } from '@clocky/clocky-client-ui-viz'
import type { ParticipantId, TeamMemberReadinessRecord, TeamTaskSummary, TeamWorkflowInspection } from '@clocky/clocky-client-runtime/client'
import type { MemberLabel } from './member-labels.ts'
import type { TeamKey } from './locales.ts'
import { memberStatus } from './team-row.ts'

type Translate = (key: TeamKey, vars?: Record<string, unknown>) => string
type TaskPhase = TeamTaskSummary['phase']

/** One loaded channel's membership, enough to draw channel edges. */
export interface ChannelMembership {
  readonly id: string
  readonly participantIds: readonly string[]
}

/** Inputs to {@link buildSwarm}. */
export interface SwarmInput {
  /** Loaded members plus the independently resolved coordinator. */
  readonly members: readonly MemberLabel[]
  /** Authoritative participant count for the loaded/total label. */
  readonly totalMembers: number
  readonly readiness: readonly TeamMemberReadinessRecord[]
  readonly readinessStale: boolean
  readonly tasks: readonly TeamTaskSummary[]
  readonly channels: readonly ChannelMembership[]
  /** Channel whose live read is open; its edges are active and carry particles. */
  readonly liveChannelId?: string | undefined
  /** Resolve a referenced participant's display name. */
  readonly nameOf: (id: string) => string
  readonly t: Translate
}

/** Node decoration beyond the shared {@link VizItem}. */
export interface SwarmNodeMeta {
  readonly initials: string
  readonly glow?: boolean
  readonly kind: 'member' | 'ghost' | 'child-team'
  /** Participant behind a member or ghost node. */
  readonly participantId?: ParticipantId | undefined
  readonly childTeamId?: string | undefined
}

/** Result of {@link buildSwarm}. */
export interface SwarmModel {
  readonly items: readonly VizItem[]
  readonly meta: ReadonlyMap<string, SwarmNodeMeta>
  readonly layout: readonly SwarmNodeInput[]
  readonly links: readonly SwarmLinkInput[]
  readonly edges: readonly GraphEdgeView[]
  readonly clusterLabels: ReadonlyMap<string, string>
  readonly loaded: number
  readonly total: number
}

/**
 * Map a task phase onto the shared state vocabulary.
 * @param phase - Durable task phase.
 * @returns the state whose role colors it.
 */
export function taskState(phase: TaskPhase): VizState {
  switch (phase) {
    case 'pending': return 'idle'
    case 'assigned': case 'running': return 'running'
    case 'review': return 'waiting'
    case 'completed': return 'done'
    case 'failed': return 'failed'
    case 'cancelled': case 'deleted': return 'idle'
    default: {
      const unreachable: never = phase
      throw new Error(`unknown task phase ${String(unreachable)}`)
    }
  }
}

/**
 * Board column label for a task phase, used as the state word.
 * @param phase - Durable task phase.
 * @param t - Team copy.
 * @returns the localized column label.
 */
export function taskStateLabel(phase: TaskPhase, t: Translate): string {
  switch (phase) {
    case 'pending': return t('board.pending')
    case 'assigned': case 'running': return t('board.active')
    case 'review': return t('board.review')
    case 'completed': return t('board.completed')
    case 'failed': case 'cancelled': case 'deleted': return t('board.closed')
    default: {
      const unreachable: never = phase
      throw new Error(`unknown task phase ${String(unreachable)}`)
    }
  }
}

/**
 * Initials for a node disc: the first CJK character, or the first two Latin letters.
 * @param name - Display name.
 * @returns one or two characters.
 */
export function initials(name: string): string {
  const chars = Array.from(name.trim())
  const first = chars[0] ?? '?'
  if (/[㐀-鿿]/u.test(first)) return first
  const words = name.trim().split(/[\s\-_]+/u).filter(Boolean)
  return words.length > 1 ? `${Array.from(words[0] ?? '')[0] ?? ''}${Array.from(words[1] ?? '')[0] ?? ''}`.toUpperCase()
    : chars.slice(0, 2).join('').toUpperCase()
}

/** Ring for a participant role: coordinator at the center, workers next, others outside. */
function ringOf(member: Pick<MemberLabel, 'role' | 'kind'>): number {
  if (member.role === 'coordinator') return 0
  if (member.kind === 'human' || member.role === 'reviewer') return 2
  return 1
}

/**
 * Build the swarm topology from loaded records.
 * @param input - Loaded members, readiness, tasks, channels, and copy.
 * @returns items, layout inputs, edges, and loaded/total counts.
 */
export function buildSwarm(input: SwarmInput): SwarmModel {
  const { t } = input
  const items: VizItem[] = []
  const meta = new Map<string, SwarmNodeMeta>()
  const layout: SwarmNodeInput[] = []
  const edges = new Map<string, GraphEdgeView>()
  const clusterLabels = new Map<string, string>()
  const known = new Set<string>()
  const readiness = new Map(input.readiness.map(record => [record.participantId as string, record]))
  const coordinator = input.members.find(member => member.role === 'coordinator')
  for (const member of input.members) {
    if (member.phase === 'left' || known.has(member.id)) continue
    known.add(member.id)
    const record = readiness.get(member.id)
    const role = member.role === 'coordinator' || member.role === 'reviewer' || member.kind === 'human'
      ? t(`detail.participant.role.${member.kind === 'human' ? 'human' : member.role}` as TeamKey) : member.role
    items.push({ id: member.id, label: member.displayName, state: memberStatus(record?.state),
      stateLabel: t(record === undefined ? 'readiness.unavailable' : `readiness.state.${record.state}`),
      detail: role, stale: record !== undefined && input.readinessStale })
    meta.set(member.id, { initials: initials(member.displayName), kind: 'member', participantId: member.id })
    layout.push({ id: member.id, ring: ringOf(member) })
  }
  const ghost = (id: string) => {
    if (known.has(id)) return
    known.add(id)
    items.push({ id, label: input.nameOf(id), state: 'idle', stateLabel: t('viz.ghost'), ghost: true })
    meta.set(id, { initials: initials(input.nameOf(id)), kind: 'ghost', participantId: id as ParticipantId })
    layout.push({ id, ring: 2 })
  }
  const edge = (from: string, to: string, variant: GraphEdgeView['variant'], extra: Partial<GraphEdgeView> = {}) => {
    if (from === to) return
    const id = `${from}→${to}:${variant}`
    if (!edges.has(id) && !edges.has(`${to}→${from}:${variant}`)) edges.set(id, { id, from, to, variant, ...extra })
  }
  for (const task of input.tasks) {
    if (task.phase === 'deleted') continue
    if (task.ownerId !== undefined) {
      const loaded = known.has(task.ownerId)
      ghost(task.ownerId)
      if (coordinator !== undefined) edge(coordinator.id, task.ownerId, loaded ? 'solid' : 'ghost', { active: taskState(task.phase) === 'running' })
      if (task.reviewerId !== undefined) {
        ghost(task.reviewerId)
        edge(task.ownerId, task.reviewerId, 'dashed')
      }
    }
    if (task.childTeamId !== undefined) {
      const id = `child:${task.childTeamId}`
      if (!known.has(id)) {
        known.add(id)
        items.push({ id, label: t('viz.childTeam'), state: taskState(task.phase), stateLabel: taskStateLabel(task.phase, t),
          detail: t('viz.childTeamDetail', { task: task.subject.text }) })
        meta.set(id, { initials: '⧉', kind: 'child-team', childTeamId: task.childTeamId })
        layout.push({ id, ring: 2, cluster: id })
      }
      const parent = task.ownerId ?? coordinator?.id
      if (parent !== undefined) edge(parent, id, 'dashed', { directed: true })
    }
  }
  for (const channel of input.channels) {
    const present = channel.participantIds.filter(id => known.has(id) && meta.get(id)?.kind === 'member')
    const hub = present.includes(coordinator?.id ?? '') ? coordinator?.id : present[0]
    if (hub === undefined) continue
    for (const id of present) {
      if (id !== hub) edge(hub, id, 'solid', { active: channel.id === input.liveChannelId, curvature: 0.22 })
    }
  }
  const memberCount = items.filter(item => meta.get(item.id)?.kind === 'member').length
  return {
    items, meta, layout, edges: [...edges.values()], clusterLabels,
    links: [...edges.values()].map(value => ({ source: value.from, target: value.to })),
    loaded: memberCount, total: Math.max(input.totalMembers, memberCount),
  }
}

/** Authoritative task counts by phase. */
export type TaskCounts = Readonly<Record<TaskPhase, number>>

/**
 * Progress ring segments from authoritative counts, in work order.
 * @param counts - Whole-Team task counts.
 * @param t - Team copy.
 * @returns segments and the non-deleted total.
 */
export function progressSegments(counts: TaskCounts, t: Translate): { segments: RingSegment[]; total: number } {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0) - counts.deleted
  return {
    total,
    segments: [
      { state: 'done', value: counts.completed, label: t('board.completed') },
      { state: 'running', value: counts.assigned + counts.running, label: t('board.active') },
      { state: 'waiting', value: counts.review, label: t('board.review') },
      { state: 'failed', value: counts.failed + counts.cancelled, label: t('board.closed') },
    ],
  }
}

/** One node of the flow graph. */
export interface FlowNode extends VizItem {
  readonly taskId?: string | undefined
}

/** Result of {@link buildWorkflowFlow}. */
export interface FlowModel {
  readonly nodes: readonly FlowNode[]
  readonly edges: readonly { readonly from: string; readonly to: string }[]
  /** True only when the inspection window holds every task of the plan. */
  readonly complete: boolean
  readonly loaded: number
  readonly total: number
}

/**
 * Build a workflow plan's dependency graph from its bounded window. A
 * dependency outside the window becomes a ghost node.
 * @param value - The loaded workflow inspection window.
 * @param tasks - Loaded task summaries, for bound task phases.
 * @param t - Team copy.
 * @returns nodes, upstream → downstream edges, and completeness.
 */
export function buildWorkflowFlow(value: TeamWorkflowInspection, tasks: readonly TeamTaskSummary[], t: Translate): FlowModel {
  const phases = new Map(tasks.map(task => [task.id as string, task.phase]))
  const nodes = new Map<string, FlowNode>()
  const edges: { from: string; to: string }[] = []
  const describe = (templateId: string, subject: string, taskId: string | undefined, ghost: boolean): FlowNode => {
    const phase = taskId === undefined ? undefined : phases.get(taskId)
    return { id: templateId, label: subject || templateId, taskId, ghost,
      state: phase === undefined ? 'idle' : taskState(phase),
      stateLabel: ghost ? t('viz.ghost') : phase !== undefined ? taskStateLabel(phase, t) : t(taskId === undefined ? 'viz.flow.unbound' : 'viz.flow.bound') }
  }
  for (const item of value.items) nodes.set(item.templateId, describe(item.templateId, item.subject.text, item.taskId, false))
  for (const item of value.items) {
    for (const dependency of item.blockedBy) {
      if (!nodes.has(dependency.templateId)) {
        nodes.set(dependency.templateId, describe(dependency.templateId, dependency.subject.text, dependency.taskId, true))
      }
      edges.push({ from: dependency.templateId, to: item.templateId })
    }
  }
  const loaded = value.items.length
  return { nodes: [...nodes.values()], edges, loaded, total: Math.max(loaded, value.total),
    complete: value.startCursor === -1 && value.nextCursor === undefined && ![...nodes.values()].some(node => node.ghost === true) }
}
