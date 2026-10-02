import { z } from 'zod'
/** View preferences survive module and Session inspection changes without duplicating Team data. */
import { defineStore, type ChannelId, type EngineStoreHandle, type TeamId, type TeamTaskId, type TeamTaskSnapshot } from '@clocky/clocky-client-runtime/client'
import type { ChannelComposerDraft } from './channel-draft.ts'
import type { HumanActionDraft } from './action-draft.ts'
import { taskDraftKey, type TaskFormDraft, type TeamTaskDialogTarget } from './task-draft.ts'

/** Modules owned by the Team workspace. */
export type TeamWorkspaceView = 'overview' | 'tasks' | 'channels' | 'members' | 'artifacts' | 'workflows' | 'audit' | 'attention'

/** Local navigation, task filters, and independent module scroll positions. */
export interface TeamViewState {
  workflowPlanId?: import('@clocky/clocky-client-runtime/client').TeamWorkflowSummary['id'] | undefined
  view: TeamWorkspaceView
  taskId: TeamTaskId | undefined
  taskListScroll: number
  taskSearch: string
  taskPhase: 'all' | Exclude<TeamTaskSnapshot['phase'], 'deleted'>
  scroll: Partial<Record<TeamWorkspaceView, number>>
  channelDrafts: Record<string, ChannelComposerDraft>
  actionId?: import('@clocky/clocky-client-runtime/client').TeamActionResponseInput['actionId'] | undefined
  actionDrafts: Record<string, HumanActionDraft>
  taskForm?: TeamTaskDialogTarget | undefined
  taskDrafts: Record<string, TaskFormDraft>
  channelSearch: string
  channelDetails: boolean
}

/** Initial preferences for a Team without a retained view. */
export const DEFAULT_TEAM_VIEW: TeamViewState = { view: 'overview', taskId: undefined, taskListScroll: 0, taskSearch: '', taskPhase: 'all', scroll: {}, channelDrafts: {}, actionDrafts: {}, taskDrafts: {}, channelSearch: '', channelDetails: false }

/** Public Team view, draft and capability-observation limits. */
export interface Config {
  /** Maximum retained member display identities in the current authenticated connection. */
  readonly identityCacheCapacity?: number | undefined
  /** Maximum referenced IDs in each identity request. */
  readonly identityBatchSize?: number | undefined
  /** Refresh visible names and authorization while the Team view remains open. */
  readonly identityRefreshMs?: number | undefined
  /** Refresh visible members when route or runtime facts change without a Team journal write. */
  readonly readinessRefreshMs?: number | undefined
  /** Maximum retained selected/current dependency references in one form. */
  readonly taskReferenceCapacity?: number | undefined
  /** Maximum explicit task IDs in each reference request. */
  readonly taskReferenceBatchSize?: number | undefined
  /** Refresh exact dependency status independently of candidate pages. */
  readonly taskReferenceRefreshMs?: number | undefined
  /** Refresh the current overview pending preview without reading continuation pages. */
  readonly attentionRefreshMs?: number | undefined
  /** Maximum pending rows requested by the overview. */
  readonly attentionPreviewLimit?: number | undefined
  /** Maximum pending rows requested by the complete-list workspace. */
  readonly attentionPageLimit?: number | undefined
  /** Poll independent Host authoring capabilities while a form is open. */
  readonly capabilityRefreshMs?: number | undefined
  /** Maximum retained channel, task-form and human-answer drafts across all Teams. */
  readonly maxDrafts?: number | undefined
  /** Total UTF-8 bytes of serialized draft identity and input tuples. */
  readonly maxDraftBytes?: number | undefined
  /** Maximum cached Team view preferences; must leave a slot beyond the draft count. */
  readonly maxViewStates?: number | undefined
}
/** Public browser options, applied on page boot through client-modules.browserConfig. */
export const Config = z.object({
  identityCacheCapacity: z.number().int().positive().default(512),
  identityBatchSize: z.number().int().positive().default(64),
  identityRefreshMs: z.number().int().positive().max(2_147_483_647).default(5000),
  readinessRefreshMs: z.number().int().positive().max(2_147_483_647).default(5000),
  taskReferenceCapacity: z.number().int().positive().default(512),
  taskReferenceBatchSize: z.number().int().positive().default(64),
  taskReferenceRefreshMs: z.number().int().positive().max(2_147_483_647).default(5000),
  attentionRefreshMs: z.number().int().positive().max(2_147_483_647).default(5000),
  attentionPreviewLimit: z.number().int().positive().default(3),
  attentionPageLimit: z.number().int().positive().default(64),
  capabilityRefreshMs: z.number().int().positive().max(2_147_483_647).default(5000),
  maxDrafts: z.number().int().min(1).default(32),
  maxDraftBytes: z.number().int().min(1).default(8 * 1024 * 1024),
  maxViewStates: z.number().int().min(2).default(128) }).strict()
  .refine(value => value.maxViewStates > value.maxDrafts, { message: 'maxViewStates must exceed maxDrafts to keep navigation available' })
  .prefault({})

/** Capacity failure leaves every existing draft unchanged. */
export class DraftCapacityError extends Error {
  override readonly name = 'DraftCapacityError'
}

interface WorkspaceState {
  byTeam: Record<string, TeamViewState>
  viewOrder: string[]
  draftSizes: Record<string, number>
  draftCount: number
  draftBytes: number
}
type WorkspaceActions = {
  update: (draft: WorkspaceState, teamId: TeamId, patch: Partial<Omit<TeamViewState, 'scroll' | 'channelDrafts' | 'actionDrafts' | 'taskDrafts'>>) => void
  rememberScroll: (draft: WorkspaceState, teamId: TeamId, view: TeamWorkspaceView, top: number) => void
  discardChannelDraft: (draft: WorkspaceState, teamId: TeamId, channelId: ChannelId) => void
  setChannelDraft: (draft: WorkspaceState, teamId: TeamId, channelId: ChannelId, value: ChannelComposerDraft) => void
  setActionDraft: (draft: WorkspaceState, teamId: TeamId, actionId: NonNullable<TeamViewState['actionId']>, value: HumanActionDraft) => void
  discardActionDraft: (draft: WorkspaceState, teamId: TeamId, actionId: NonNullable<TeamViewState['actionId']>) => void
  clearFormDrafts: (draft: WorkspaceState, onlyTeamId?: TeamId) => void
  setTaskDraft: (draft: WorkspaceState, teamId: TeamId, target: TeamTaskDialogTarget, value: TaskFormDraft) => void
  discardTaskDraft: (draft: WorkspaceState, teamId: TeamId, target: TeamTaskDialogTarget) => void
}

/** Copy bounded record indexes without keeping an erased entry reachable. */
function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([candidate]) => candidate !== key))
}

/**
 * Create the registration-owned viewing store; authoritative Team records stay in runtime.
 * @param config - Public deployment limits; defaults resolve before the store is created.
 * @returns a fresh handle for the Team workspace registration.
 */
export function createTeamWorkspaceStore(config: Config = {}): EngineStoreHandle<WorkspaceState, WorkspaceActions> {
  const limits = Config.parse(config)
  const utf8 = new TextEncoder()
  const reserveView = (state: WorkspaceState, teamId: TeamId): void => {
    const oldPosition = state.viewOrder.indexOf(teamId)
    if (oldPosition >= 0) state.viewOrder.splice(oldPosition, 1)
    else if (state.viewOrder.length >= limits.maxViewStates) {
      const evict = state.viewOrder.findIndex(id => Object.keys(state.byTeam[id]?.channelDrafts ?? {}).length === 0
        && Object.keys(state.byTeam[id]?.actionDrafts ?? {}).length === 0 && Object.keys(state.byTeam[id]?.taskDrafts ?? {}).length === 0)
      if (evict < 0) throw new DraftCapacityError('No unpinned view state is available')
      const id = state.viewOrder[evict]
      if (id !== undefined) state.byTeam = withoutKey(state.byTeam, id)
      state.viewOrder.splice(evict, 1)
    }
    state.viewOrder.push(teamId)
  }
  const reserveDraft = (state: WorkspaceState, teamId: TeamId, identity: readonly string[], value: unknown): void => {
    const key = JSON.stringify(identity)
    const priorBytes = state.draftSizes[key]
    const count = state.draftCount + (priorBytes === undefined ? 1 : 0)
    if (count > limits.maxDrafts) throw new DraftCapacityError('Retained draft count exceeds the configured limit')
    const entryBytes = utf8.encode(JSON.stringify([...identity, value])).byteLength
    const bytes = state.draftBytes - (priorBytes ?? 0) + entryBytes
    if (bytes > limits.maxDraftBytes) throw new DraftCapacityError('Retained draft bytes exceed the configured limit')
    reserveView(state, teamId)
    state.draftCount = count
    state.draftBytes = bytes
    state.draftSizes[key] = entryBytes
  }
  const releaseDraft = (state: WorkspaceState, identity: readonly string[]): void => {
    const key = JSON.stringify(identity)
    const bytes = state.draftSizes[key]
    if (bytes === undefined) return
    state.draftSizes = withoutKey(state.draftSizes, key)
    state.draftCount--
    state.draftBytes -= bytes
  }
  return defineStore({
    init: (): WorkspaceState => ({ byTeam: {}, viewOrder: [], draftSizes: {}, draftCount: 0, draftBytes: 0 }),
    actions: {
      setActionDraft: (draft, teamId, actionId, value) => {
        reserveDraft(draft, teamId, [teamId, 'action', actionId], value)
        const current = draft.byTeam[teamId] ?? { ...DEFAULT_TEAM_VIEW, scroll: {}, channelDrafts: {}, actionDrafts: {} }
        draft.byTeam[teamId] = { ...current, actionDrafts: { ...current.actionDrafts, [actionId]: value } }
      },
      discardActionDraft: (draft, teamId, actionId) => {
        releaseDraft(draft, [teamId, 'action', actionId])
        const team = draft.byTeam[teamId]
        if (team !== undefined) team.actionDrafts = withoutKey(team.actionDrafts, actionId)
      },
      setTaskDraft: (draft, teamId, target, value) => {
        const key = taskDraftKey(target)
        reserveDraft(draft, teamId, [teamId, 'task', key], value)
        const current = draft.byTeam[teamId] ?? { ...DEFAULT_TEAM_VIEW, scroll: {}, channelDrafts: {}, actionDrafts: {}, taskDrafts: {} }
        draft.byTeam[teamId] = { ...current, taskDrafts: { ...current.taskDrafts, [key]: value } }
      },
      discardTaskDraft: (draft, teamId, target) => {
        const key = taskDraftKey(target)
        releaseDraft(draft, [teamId, 'task', key])
        const team = draft.byTeam[teamId]
        if (team !== undefined) team.taskDrafts = withoutKey(team.taskDrafts, key)
      },
      clearFormDrafts: (draft, onlyTeamId) => {
        for (const [teamId, team] of Object.entries(draft.byTeam)) {
          if (onlyTeamId !== undefined && teamId !== onlyTeamId) continue
          for (const channelId of Object.keys(team.channelDrafts)) releaseDraft(draft, [teamId, channelId])
          team.channelDrafts = {}
          for (const actionId of Object.keys(team.actionDrafts)) {
            releaseDraft(draft, [teamId, 'action', actionId])
          }
          for (const key of Object.keys(team.taskDrafts)) releaseDraft(draft, [teamId, 'task', key])
          team.actionDrafts = {}
          team.actionId = undefined
          team.taskDrafts = {}
          team.taskForm = undefined
        }
      },
      discardChannelDraft: (draft, teamId, channelId) => {
        releaseDraft(draft, [teamId, channelId])
        const team = draft.byTeam[teamId]
        if (team !== undefined) team.channelDrafts = withoutKey(team.channelDrafts, channelId)
      },
      setChannelDraft: (draft, teamId, channelId, value) => {
        if (value.text.length > limits.maxDraftBytes || value.content.some(part =>
          (part.content.type === 'image' ? part.content.data.length : part.content.text.length) > limits.maxDraftBytes)) {
          throw new DraftCapacityError('Retained channel draft bytes exceed the configured limit')
        }
        reserveDraft(draft, teamId, [teamId, channelId], value)
        const current = draft.byTeam[teamId] ?? { ...DEFAULT_TEAM_VIEW, scroll: {}, channelDrafts: {} }
        draft.byTeam[teamId] = { ...current, channelDrafts: { ...current.channelDrafts, [channelId]: value } }
      },
      update: (draft, teamId, patch) => {
        reserveView(draft, teamId)
        const current = draft.byTeam[teamId] ?? { ...DEFAULT_TEAM_VIEW, scroll: {} }
        draft.byTeam[teamId] = { ...current, ...patch }
      },
      rememberScroll: (draft, teamId, view, top) => {
        const current = draft.byTeam[teamId]
        if (current === undefined) return
        draft.byTeam[teamId] = { ...current, scroll: { ...current.scroll, [view]: top } }
      },
    },
  })
}
