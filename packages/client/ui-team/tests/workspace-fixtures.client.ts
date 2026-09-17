import type { TeamStateSnapshot } from '@clocky/clocky-client-connection/client'
import { projectWorkflowInspection, projectTeamSelection, projectTeamBrowse, projectTaskInspection } from '@clocky/clocky-team/selection'
import type { TeamTaskSummary, TeamTaskDetailState } from '@clocky/clocky-client-runtime/client'
/** Complete typed Team projections for workspace interaction tests. */
import type { TeamTaskSelection, TeamTaskSnapshot } from '@clocky/clocky-client-runtime/client'

/** Create a Team with no execution or control history. */
export function workspaceState(): TeamStateSnapshot {
  const teamId = 'workspace-team' as TeamTaskSelection['teamId']
  const goal = { teamId, revision: 1, objective: 'Release preparation', phase: 'active' as const, budgets: {} }
  return {
    team: { id: teamId, goal, phase: 'active', depth: 0, maxTeamDepth: 4, cursor: 1, createdAt: 1, updatedAt: 1 },
    goal, rules: {}, budgets: {}, participants: [], activations: [], tasks: [], workspaceAllocations: [], channelIds: [],
  }
}

/** Create a valid unassigned task whose variants retain the required policy fields. */
export function workspaceTask(id: string, patch: Partial<TeamTaskSnapshot> = {}): TeamTaskSnapshot {
  const teamId = workspaceState().team.id
  return {
    id: id as TeamTaskSnapshot['id'], teamId, revision: 1, execution: { kind: 'participant' },
    createCommand: { creator: { teamId, participantId: 'human' as never }, idempotencyKey: id as never },
    subject: id, description: `Instructions for ${id}`, phase: 'pending', blockedBy: [], requiredCapabilities: [],
    priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' },
    reviewHistory: [], maxAttempts: 2, attemptCount: 0, attemptHistory: [], ...patch,
  }
}

/** Build the same bounded row the Host serves to the task list. */
export function workspaceTaskSummary(input: TeamTaskSnapshot): TeamTaskSummary {
  const task = workspaceTask(String(input.id), input)
  const result = projectTeamBrowse({ team: { ...workspaceState().team, id: task.teamId }, tasks: new Map([[task.id, task]]),
    participants: new Map(), workflowPlans: new Map() }, { teamId: task.teamId, kind: 'tasks', afterCursor: -1, limit: 1 }, 512, 16384)
  if (!result.ok || result.value.kind !== 'tasks' || result.value.items[0] === undefined) throw new Error('Fixture task summary is unavailable')
  return result.value.items[0]
}

/** Preloaded inspection state for presentation-only tests; data-owner tests exercise asynchronous reads. */
export function workspaceTaskDetail(task: TeamTaskSnapshot): TeamTaskDetailState {
  const result = projectTaskInspection(task, 1, { teamId: task.teamId, taskId: task.id, section: 'record' }, 16384)
  if (!result.ok || result.value.section !== 'record') throw new Error('Fixture task record is unavailable')
  const attemptPage = projectTaskInspection(task, 1, { teamId: task.teamId, taskId: task.id, section: 'attempts', afterCursor: -1, limit: 32 }, 16384)
  const reviewPage = projectTaskInspection(task, 1, { teamId: task.teamId, taskId: task.id, section: 'reviews', afterCursor: -1, limit: 32 }, 16384)
  return { teamId: task.teamId, taskId: task.id, record: { value: result.value, loading: false },
    latest: { value: task.attemptHistory.at(-1), loading: false }, hasNewer: false, disconnected: false,
    attempts: { value: attemptPage.ok && attemptPage.value.section === 'attempts' ? attemptPage.value : undefined, loading: false },
    reviews: { value: reviewPage.ok && reviewPage.value.section === 'reviews' ? reviewPage.value : undefined, loading: false } }
}

/** Project full fixture input through the same bounded selector as the Host. */
export function workspaceSelection(state: TeamStateSnapshot): TeamTaskSelection['state'] {
  const projected = projectTeamSelection({ team: { ...state.team, goal: state.goal }, budgets: state.budgets,
    ...state.usage === undefined ? {} : { usage: state.usage },
    humanActions: new Map((state.humanActions ?? []).map(action => [action.id, action])),
    participants: new Map(state.participants.map(member => [member.id, member])),
    activations: new Map(state.activations.map(binding => [binding.activation.id, binding])),
    tasks: new Map(state.tasks.map(task => [task.id, task])), channelIds: new Set(state.channelIds),
    workflowPlans: { size: state.workflowPlans?.length ?? 0 },
  }, 512, 16384, true)
  if (!projected.ok) throw new Error('Fixture selection is oversized')
  return projected.value
}

/** Convert complete fixture members to the same history-free rows served by the Host. */
export function workspaceMemberSummary(member: TeamStateSnapshot['participants'][number]) {
  const result = projectTeamBrowse({ team: { ...workspaceState().team, id: member.teamId },
    participants: new Map([[member.id, member]]), tasks: new Map(), workflowPlans: new Map(),
  }, { teamId: member.teamId, kind: 'members', afterCursor: -1, limit: 1 }, 512, 16384)
  if (!result.ok || result.value.kind !== 'members' || result.value.items[0] === undefined) throw new Error('Fixture member is oversized')
  return result.value.items[0]
}

/** Build one workflow list row from fixture-owned complete state. */
export function workspaceWorkflowSummary(plan: NonNullable<TeamStateSnapshot['workflowPlans']>[number]) {
  return { id: plan.id, teamId: plan.teamId, revision: plan.revision, phase: plan.phase,
    name: { text: plan.plan.name, truncated: false }, taskCount: plan.plan.tasks.length, boundTaskCount: plan.taskBindings.length }
}

/** Provide one bounded workflow inspection for isolated product rendering tests. */
export function workspaceWorkflowDetail(plan: NonNullable<TeamStateSnapshot['workflowPlans']>[number]) {
  const result = projectWorkflowInspection(plan, 1, { teamId: plan.teamId, planId: plan.id, afterCursor: -1, limit: 64 }, 512, 16384)
  if (!result.ok) throw new Error('Fixture workflow inspection is oversized')
  return { teamId: plan.teamId, planId: plan.id, value: result.value, loading: false, hasNewer: false, disconnected: false }
}
