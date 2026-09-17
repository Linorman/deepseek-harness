import { z } from 'zod'
/** View preferences survive module and Session inspection changes without duplicating Team data. */
import { defineStore, type ChannelId, type EngineStoreHandle, type TeamId, type TeamTaskId, type TeamTaskSnapshot } from '@clocky/clocky-client-runtime/client'
import type { ChannelComposerDraft } from './channel-draft.ts'

/** Modules owned by the Team workspace. */
export type TeamWorkspaceView = 'overview' | 'tasks' | 'channels' | 'members' | 'artifacts' | 'workflows' | 'audit'

/** Local navigation, task filters, and independent module scroll positions. */
export interface TeamViewState {
  workflowPlanId?: import('@clocky/clocky-client-runtime/client').TeamWorkflowSummary['id'] | undefined
  view: TeamWorkspaceView
  taskId: TeamTaskId | undefined
  taskListScroll: number
  taskSearch: string
  taskPhase: 'all' | TeamTaskSnapshot['phase']
  scroll: Partial<Record<TeamWorkspaceView, number>>
  channelDrafts: Record<string, ChannelComposerDraft>
  channelSearch: string
  channelDetails: boolean
}

/** Initial preferences for a Team without a retained view. */
export const DEFAULT_TEAM_VIEW: TeamViewState = { view: 'overview', taskId: undefined, taskListScroll: 0, taskSearch: '', taskPhase: 'all', scroll: {}, channelDrafts: {}, channelSearch: '', channelDetails: false }

/** Deployment limits for retained cross-channel draft data. */
export interface Config {
  /** Maximum retained channel drafts across all Teams. */
  readonly maxDrafts?: number | undefined
  /** Total UTF-8 bytes of serialized Team/channel/draft tuples. */
  readonly maxDraftBytes?: number | undefined
  /** Maximum cached Team view preferences; must leave a slot beyond the draft count. */
  readonly maxViewStates?: number | undefined
}
/** Public browser options, applied on page boot through client-modules.browserConfig. */
export const Config = z.object({ maxDrafts: z.number().int().min(1).default(32),
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
  update: (draft: WorkspaceState, teamId: TeamId, patch: Partial<Omit<TeamViewState, 'scroll' | 'channelDrafts'>>) => void
  rememberScroll: (draft: WorkspaceState, teamId: TeamId, view: TeamWorkspaceView, top: number) => void
  discardChannelDraft: (draft: WorkspaceState, teamId: TeamId, channelId: ChannelId) => void
  setChannelDraft: (draft: WorkspaceState, teamId: TeamId, channelId: ChannelId, value: ChannelComposerDraft) => void
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
      const evict = state.viewOrder.findIndex(id => Object.keys(state.byTeam[id]?.channelDrafts ?? {}).length === 0)
      if (evict < 0) throw new DraftCapacityError('No unpinned view state is available')
      const id = state.viewOrder[evict]
      if (id !== undefined) state.byTeam = withoutKey(state.byTeam, id)
      state.viewOrder.splice(evict, 1)
    }
    state.viewOrder.push(teamId)
  }
  return defineStore({
    init: (): WorkspaceState => ({ byTeam: {}, viewOrder: [], draftSizes: {}, draftCount: 0, draftBytes: 0 }),
    actions: {
      discardChannelDraft: (draft, teamId, channelId) => {
        const key = JSON.stringify([teamId, channelId])
        const bytes = draft.draftSizes[key]
        if (bytes === undefined) return
        const team = draft.byTeam[teamId]
        if (team !== undefined) team.channelDrafts = withoutKey(team.channelDrafts, channelId)
        draft.draftSizes = withoutKey(draft.draftSizes, key)
        draft.draftCount--
        draft.draftBytes -= bytes
      },
      setChannelDraft: (draft, teamId, channelId, value) => {
        const key = JSON.stringify([teamId, channelId])
        const priorBytes = draft.draftSizes[key]
        const count = draft.draftCount + (priorBytes === undefined ? 1 : 0)
        if (count > limits.maxDrafts) throw new DraftCapacityError('Retained channel draft count exceeds the configured limit')
        if (value.text.length > limits.maxDraftBytes || value.content.some(part =>
          (part.content.type === 'image' ? part.content.data.length : part.content.text.length) > limits.maxDraftBytes)) {
          throw new DraftCapacityError('Retained channel draft bytes exceed the configured limit')
        }
        const entryBytes = utf8.encode(JSON.stringify([teamId, channelId, value])).byteLength
        const bytes = draft.draftBytes - (priorBytes ?? 0) + entryBytes
        if (bytes > limits.maxDraftBytes) throw new DraftCapacityError('Retained channel draft bytes exceed the configured limit')
        reserveView(draft, teamId)
        draft.draftCount = count
        draft.draftBytes = bytes
        draft.draftSizes[key] = entryBytes
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
