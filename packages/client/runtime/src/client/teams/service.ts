import { WorkflowInspector } from './workflow-inspector.ts'
import { TaskInspector } from './task-inspector.ts'
/** Browser-owned Team task list, selection, and first-input draft service. */

import type { Context } from '@clocky/cordis'
import type {
  ChannelId, ChannelPostIdempotencyKey, ChannelReadPageResult, IApiClient, MuxFrame, RpcError, RpcRequest, RpcResponse, SessionId,
  TeamArtifactReadResult,
  TeamArtifactReference,
  TeamAuditList,
  TeamHumanActionSnapshot,
  TeamId,
  TeamSnapshot,
  TeamStateSnapshot,
  TeamTaskId,
  TeamTaskSnapshot,

} from '@clocky/clocky-client-connection/client'
import { createSnapshotStore, type SnapshotStore } from '../contract/store.ts'
import type {
  ITeamTasks, TeamHumanAction, TeamInboxPage, TeamInboxState, TeamActionResponseInput, TeamActionResponseResult,
  TeamManagementCommand, TeamTaskDraft, TeamTaskDraftOptions, TeamTaskListState,
  TeamTaskSelection, TeamTaskStartInput,
  TeamChannelState,
  TeamChannelListState,
  TeamChannelAttachmentInput,
  TeamChannelAttachmentResult,
  TeamCollectionKind,
  TeamCollectionReadMode,
  TeamCollectionPage,
  TeamCollectionsState,

} from '../contract/team-tasks.ts'

const TEAM_COLLECTION_PAGE_LIMIT = 64

/** Error surfaced when a Team task draft cannot be started or resolved. */
export class TeamTaskStartError extends Error {
  /** Host business error retained when the request reached the Team API. */
  readonly rpcError?: RpcError

  /** @param message - actionable start or selection failure. @param rpcError - optional Host failure. */
  constructor(message: string, rpcError?: RpcError) {
    super(message)
    this.name = 'TeamTaskStartError'
    if (rpcError !== undefined) this.rpcError = rpcError
  }
}

/** Client implementation of the Team product state owner. */
export class TeamTaskRuntime implements ITeamTasks {
  /** UI-facing Team product projection. */
  readonly list: SnapshotStore<TeamTaskListState & { readonly inbox: TeamInboxState }>
  private readonly workflowInspector: WorkflowInspector
  private readonly taskInspector: TaskInspector
  private refreshing: Promise<void> | undefined
  private continuing: Promise<void> | undefined
  private starting: Promise<TeamTaskSelection> | undefined
  private selectionGeneration = 0
  private inboxGeneration = 0
  private inboxContinuation: Promise<void> | undefined
  private channelGeneration = 0
  private channelAbort: AbortController | undefined
  private channelAcknowledgement: Promise<void> | undefined
  private channelAcknowledgementGeneration = -1
  private channelInvitationGeneration = 0
  private channelAdmissionGeneration = 0
  private channelListGeneration = 0
  private channelListAbort: AbortController | undefined
  private channelListOperation: Promise<void> | undefined
  private channelListActivity = 0
  private channelCatalogGeneration = 0
  private channelCatalogAbort: AbortController | undefined
  private readonly collectionOperations = new Map<string, Promise<void>>()

  /** @param ctx - client root context. @param api - shared Host API client. */
  constructor(ctx: Context, private readonly api: IApiClient) {
    this.list = createSnapshotStore({
      items: [], current: undefined, selected: undefined, phase: 'pending', state: 'idle', error: null, draft: undefined,
      pendingHumanActions: [],
      inbox: emptyInboxState(),
    })
    this.workflowInspector = new WorkflowInspector(api, (workflowDetail) => {
      this.list.set({ ...this.list.getSnapshot(), workflowDetail })
    })
    ctx.effect(() => () => { this.workflowInspector.close() })
    this.taskInspector = new TaskInspector(api, (taskDetail) => {
      this.list.set({ ...this.list.getSnapshot(), taskDetail })
    })
    ctx.effect(() => () => { this.taskInspector.close() })
    ctx.reflect.provide('teamTasks', this, undefined)
    ctx.effect(() => () => { this.closeChannelView(); this.resetChannelList(); this.channelCatalogAbort?.abort() })
  }

  /** Enter a local first-input draft without allocating a durable Team or Session. */
  startDraft(options: TeamTaskDraftOptions = {}): void {
    if (this.starting !== undefined) return
    this.taskInspector.close()
    this.workflowInspector.close()
    this.closeChannelView()
    this.resetChannelList()
    this.selectionGeneration += 1
    const state = this.list.getSnapshot()
    this.list.set({
      ...state,
      current: undefined,
      selected: undefined,
      memberSession: undefined,
      collections: undefined,
      draft: {
        idempotencyKey: crypto.randomUUID() as ChannelPostIdempotencyKey,
        ...options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset },
        ...options.cwd === undefined ? {} : { cwd: options.cwd },
        ...options.selection === undefined ? {} : { selection: options.selection },
        phase: 'ready',
        error: undefined,
        message: undefined,
      },
    })
  }

  /** Update the local choices retained by the current Team start draft. */
  updateDraft(options: TeamTaskDraftOptions): void {
    if (this.starting !== undefined) return
    const current = this.list.getSnapshot()
    const draft = current.draft
    if (draft === undefined) return
    const changed = ('agentPreset' in options && options.agentPreset !== draft.agentPreset)
      || ('cwd' in options && options.cwd !== draft.cwd)
      || ('selection' in options && JSON.stringify(options.selection) !== JSON.stringify(draft.selection))
    const nextDraft = {
      ...draft,
      ...options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset },
      ...options.cwd === undefined ? {} : { cwd: options.cwd },
      ...options.selection === undefined ? {} : { selection: options.selection },
    }
    if (!changed) {
      this.list.set({ ...current, draft: nextDraft })
      return
    }
    const { fingerprint: _discardedFingerprint, ...retryDraft } = nextDraft
    this.list.set({
      ...current,
      draft: { ...retryDraft, phase: 'ready', error: undefined, message: undefined },
    })
  }

  /** Clear only the local Team start draft. */
  abandonDraft(): void {
    if (this.starting !== undefined) return
    this.list.set({ ...this.list.getSnapshot(), draft: undefined })
  }

  /** Refresh durable Team summaries and retain local selection or draft state. */
  refresh(firstPage = false): Promise<void> {
    if (firstPage && this.refreshing !== undefined) return this.refreshing.then(async () => { await this.refresh(true) })
    if (this.continuing !== undefined) return this.continuing.then(async () => { await this.refresh(firstPage) })
    this.refreshing ??= this.load(firstPage ? -1 : undefined).then(async () => { await this.refreshCurrentSelection() })
      .finally(() => { this.refreshing = undefined })
    return this.refreshing
  }

  /** Replace the Team window with its next page; a failure preserves the current window. */
  loadMore(): Promise<void> {
    if (this.continuing !== undefined) return this.continuing
    const pendingRefresh = this.refreshing
    this.continuing = (async () => {
      await pendingRefresh
      const current = this.list.getSnapshot()
      const afterCursor = current.nextCursor
      if (afterCursor === undefined) return
      this.list.set({ ...current, loadingMore: true, error: null })
      try {
        const result = (await this.api.teams.list({ afterCursor })).result
        if (!result.ok) throw new TeamTaskStartError(result.error.message, result.error)
        if (result.value.nextCursor !== undefined && result.value.nextCursor === afterCursor) {
          throw new TeamTaskStartError('Team list returned a non-advancing page cursor')
        }
        const latest = this.list.getSnapshot()
        this.list.set({
          ...latest, startCursor: afterCursor, nextCursor: result.value.nextCursor,
          items: result.value.items,
          state: 'idle', error: null,
        })
      } catch (error: unknown) {
        this.list.set({ ...this.list.getSnapshot(), state: 'error', error: error instanceof TeamTaskStartError && error.rpcError !== undefined
          ? error.rpcError : { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } })
      } finally {
        this.list.set({ ...this.list.getSnapshot(), loadingMore: false })
      }
    })().finally(() => { this.continuing = undefined })
    return this.continuing
  }

  /** Start periodic Team-list refreshes so the browser converges after remote lifecycle changes. */
  watch(intervalMs = 2_000): () => void {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 250) throw new TypeError('Team live refresh interval must be at least 250ms')
    const timer = setInterval(() => { void this.refresh() }, intervalMs)
    return () => { clearInterval(timer) }
  }

  /** Resolve a Team and explicitly resume its offline coordinator when needed. */
  async open(teamId: TeamId, signal?: AbortSignal): Promise<TeamTaskSelection> {
    const selected = await this.inspect(teamId, signal)
    if (!['completed', 'failed', 'cancelled'].includes(selected.state.team.phase)
      && selected.state.coordinator.kind === 'bound' && selected.state.coordinator.binding.activation.status === 'offline') {
      return this.resume(teamId, signal)
    }
    return selected
  }

  /** Select bounded Team data without creating or resuming an activation. */
  async inspect(teamId: TeamId, signal?: AbortSignal): Promise<TeamTaskSelection> {
    if (this.list.getSnapshot().current !== teamId) {
      this.taskInspector.close(); this.workflowInspector.close(); this.closeChannelView(); this.resetChannelList()
    }
    const generation = ++this.selectionGeneration
    const response = await this.api.teams.selection({ teamId, includeMetadata: true }, signal)
    this.assertCurrentSelectionRequest(generation, signal)
    if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
    const selection = selectionOf(response.result.value)
    if (this.list.getSnapshot().current !== teamId) {
      this.taskInspector.close(); this.workflowInspector.close(); this.closeChannelView(); this.resetChannelList()
    }
    this.assertCurrentSelectionRequest(generation, signal)
    const current = this.list.getSnapshot()
    this.list.set({ ...current, current: teamId, selected: selection,
      ...current.current === teamId ? {} : { collections: undefined, memberSession: undefined } })
    await this.refreshCollections(teamId, generation, signal)
    this.assertCurrentSelectionRequest(generation, signal)
    return selection
  }

  /** Archive one terminal Team through its revisioned Host operation. */
  async archive(teamId: TeamId, signal?: AbortSignal): Promise<TeamStateSnapshot> {
    const current = this.list.getSnapshot().items.find(item => item.id === teamId) ?? this.currentSelection(teamId)?.state.team
    if (current === undefined) throw new TeamTaskStartError(`Team '${teamId}' is not in the current list`)
    const response = await this.api.teams.archive({ teamId, expectedCursor: current.cursor }, signal)
    const result = response.result
    if (!result.ok) throw new TeamTaskStartError(result.error.message, result.error)
    if (this.list.getSnapshot().current === teamId) {
      this.taskInspector.close(); this.workflowInspector.close(); this.closeChannelView(); this.resetChannelList()
    }
    const next = this.list.getSnapshot()
    this.list.set({
      ...next,
      current: next.current === teamId ? undefined : next.current,
      selected: next.selected?.teamId === teamId ? undefined : next.selected,
      memberSession: next.memberSession?.teamId === teamId ? undefined : next.memberSession,
      collections: next.current === teamId ? undefined : next.collections,
      items: next.items.filter(item => item.id !== teamId),
    })
    return result.value
  }

  /** Cancel one Team through the Host control plane. */
  async cancel(teamId: TeamId, signal?: AbortSignal): Promise<TeamSnapshot['phase']> {
    const response = await this.api.teams.cancel({ teamId }, signal)
    if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
    const phase = response.result.value.phase
    const current = this.list.getSnapshot()
    this.list.set({
      ...current,
      items: current.items.map(item => item.id === teamId ? { ...item, phase } : item),
    })
    if (current.current === teamId) await this.refreshCurrentSelection(signal)
    return phase
  }

  /** Delete one lease-free Team task and reconcile the selected detail snapshot. */
  async deleteTask(teamId: TeamId, taskId: TeamTaskId, expectedRevision: number, signal?: AbortSignal): Promise<TeamTaskSnapshot> {
    const response = await this.api.teams.taskDelete({ teamId, taskId, expectedRevision }, signal)
    if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
    const task = response.result.value
    this.replaceSelectedTask(teamId, task)
    if (this.list.getSnapshot().taskDetail?.taskId === task.id) await this.readTaskDetail(teamId, task.id)
    if (task.lease !== undefined && task.cancellation !== undefined) {
      void this.reconcileTaskUntilSettled(teamId, task.id, signal)
    }
    return task
  }

  /** Cancel one assigned or running Team task and reconcile its selected detail projection. */
  async cancelTask(
    teamId: TeamId, taskId: TeamTaskId, expectedRevision: number, reason?: string, signal?: AbortSignal,
  ): Promise<TeamTaskSnapshot> {
    const response = await this.api.teams.taskCancel({
      teamId,
      taskId,
      expectedRevision,
      ...reason === undefined ? {} : { reason },
    }, signal)
    if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
    const task = response.result.value
    this.replaceSelectedTask(teamId, task)
    if (this.list.getSnapshot().taskDetail?.taskId === task.id) await this.readTaskDetail(teamId, task.id)
    if (task.lease !== undefined && task.cancellation !== undefined) {
      void this.reconcileTaskUntilSettled(teamId, task.id, signal)
    }
    return task
  }

  /** Replace one task in the selected Team projection after a Host mutation. */
  private replaceSelectedTask(teamId: TeamId, task: TeamTaskSnapshot): void {
    this.taskInspector.changed(teamId, task.id, task.revision)
    const current = this.list.getSnapshot()
    const selected = current.selected
    if (selected?.teamId !== teamId) return
    const collections = current.collections
    if (collections?.teamId === teamId) this.list.set({ ...current,
      collections: { ...collections, tasks: { ...collections.tasks, hasNewer: true } } })
  }

  /** Poll one accepted cancellation until its durable lease settles so detail controls converge without a page reload. */
  private async reconcileTaskUntilSettled(teamId: TeamId, taskId: TeamTaskId, signal?: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (signal?.aborted) return
      await new Promise<void>((resolve) => { setTimeout(resolve, 1_000) })
      if (signal?.aborted) return
      const detail = this.list.getSnapshot().taskDetail
      if (detail?.teamId !== teamId || detail.taskId !== taskId) return
      await this.readTaskDetail(teamId, taskId)
      const current = this.list.getSnapshot().taskDetail
      if (current?.teamId !== teamId || current.taskId !== taskId || current.record.error !== undefined) return
      const task = current.record.value?.task
      if (task === undefined || task.lease === undefined && ['completed', 'failed', 'cancelled', 'deleted'].includes(task.phase)) return
    }
  }

  /** Re-attach one durable Team and return its coordinator transcript selection. */
  async resume(teamId: TeamId, signal?: AbortSignal): Promise<TeamTaskSelection> {
    const current = this.list.getSnapshot().items.find(item => item.id === teamId) ?? this.currentSelection(teamId)?.state.team
    if (current === undefined) throw new TeamTaskStartError(`Team '${teamId}' is not in the current list`)
    const generation = ++this.selectionGeneration
    const state = await this.api.teams.selection({ teamId }, signal)
    this.assertCurrentSelectionRequest(generation, signal)
    if (!state.result.ok) throw new TeamTaskStartError(state.result.error.message, state.result.error)
    const response = await this.api.teams.resume({ teamId, expectedCursor: state.result.value.team.cursor }, signal)
    this.assertCurrentSelectionRequest(generation, signal)
    if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
    return this.inspect(teamId, signal)
  }

  /** Post one human-authored content batch through the durable Team channel. */
  async postInput(
    teamId: TeamId,
    content: readonly Record<string, unknown>[],
    delivery: 'context' | 'turn' | 'steer' = 'turn',
    signal?: AbortSignal,
  ): Promise<void> {
    const text = content
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => String(block.text))
      .join('\n')
    const response = await this.api.teams.postInput({
      teamId,
      content: content as never,
      ...text.length === 0 ? {} : { text },
      delivery,
    }, signal)
    if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
  }

  /** Read the principal's unread page or explicitly reopen history. */
  async refreshInbox(history = false, signal?: AbortSignal): Promise<void> {
    await this.readInboxPage(history ? { afterCursor: -1 } : {}, signal)
  }

  async recoverInbox(signal?: AbortSignal): Promise<void> {
    const error = this.currentInbox().error
    if (error?.code !== 'team-inbox-compacted' || error.details.firstCursor === undefined) {
      throw new Error('Inbox recovery requires a retained history cursor')
    }
    await this.readInboxPage({ afterCursor: error.details.firstCursor - 1 }, signal)
  }

  private async readInboxPage(request: { afterCursor?: number }, signal?: AbortSignal): Promise<void> {
    const generation = ++this.inboxGeneration
    this.updateInbox({ phase: 'loading', loadingMore: false, error: null })
    try {
      const response = await this.api.teams.inboxRead(request, signal)
      if (signal?.aborted || generation !== this.inboxGeneration) return
      if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
      this.updateInbox({ ...response.result.value, nextCursor: response.result.value.nextCursor, phase: 'ready', hasNewer: false, error: null })
    } catch (error: unknown) {
      if (!signal?.aborted && generation === this.inboxGeneration) this.inboxFailure(error)
    } finally {
      if (signal?.aborted && generation === this.inboxGeneration) this.updateInbox({ phase: 'ready' })
    }
  }

  /** Replace the principal inbox window with the explicitly requested next page. */
  loadMoreInbox(signal?: AbortSignal): Promise<void> {
    this.inboxContinuation ??= this.appendInboxPage(signal).finally(() => { this.inboxContinuation = undefined })
    return this.inboxContinuation
  }

  private async appendInboxPage(signal?: AbortSignal): Promise<void> {
    const previous = this.currentInbox()
    const afterCursor = previous.nextCursor ?? (previous.hasNewer ? previous.cursor : undefined)
    if (afterCursor === undefined) return
    const generation = this.inboxGeneration
    this.updateInbox({ loadingMore: true, error: null })
    try {
      const response = await this.api.teams.inboxRead({ afterCursor }, signal)
      if (signal?.aborted || generation !== this.inboxGeneration) return
      if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
      const page = response.result.value
      if (page.nextCursor !== undefined && page.nextCursor <= afterCursor) throw new Error('Inbox returned a non-advancing cursor')
      this.updateInbox({ ...page, nextCursor: page.nextCursor, phase: 'ready', hasNewer: false, error: null,
        items: page.items,
      })
    } catch (error: unknown) {
      if (!signal?.aborted && generation === this.inboxGeneration) this.inboxFailure(error)
    } finally { if (generation === this.inboxGeneration) this.updateInbox({ loadingMore: false }) }
  }

  /** Wait through the authenticated transport and expose new delivery availability without implicit paging. */
  async watchInbox(signal: AbortSignal): Promise<TeamInboxPage> {
    const generation = this.inboxGeneration
    const response = await this.api.teams.inboxWatch({ afterCursor: this.currentInbox().cursor }, signal)
    signal.throwIfAborted()
    if (!response.result.ok) {
      const error = new TeamTaskStartError(response.result.error.message, response.result.error)
      if (generation === this.inboxGeneration) this.inboxFailure(error)
      throw error
    }
    const page = response.result.value
    if (generation === this.inboxGeneration) {
      this.updateInbox({ displayCursor: page.displayCursor, hasNewer: page.items.length > 0,
        ...page.items.length === 0 ? { cursor: page.cursor } : {},
      })
      for (const item of page.items) if (item.kind === 'action') this.publishInboxAction(item.action)
    }
    return page
  }

  /** Persist a display acknowledgement derived only from the loaded, unfiltered inbox range. */
  async acknowledgeInbox(signal?: AbortSignal): Promise<void> {
    const inbox = this.currentInbox()
    const throughCursor = inbox.items.at(-1)?.sequence
    if (throughCursor === undefined || inbox.acknowledging) return
    const generation = this.inboxGeneration
    this.updateInbox({ acknowledging: true, error: null })
    try {
      const response = await this.api.teams.inboxAcknowledge({ throughCursor }, signal)
      if (signal?.aborted || generation !== this.inboxGeneration) return
      if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
      this.updateInbox({ displayCursor: Math.max(this.currentInbox().displayCursor, response.result.value.displayCursor) })
    } catch (error: unknown) { if (!signal?.aborted && generation === this.inboxGeneration) this.inboxFailure(error) }
    finally { if (generation === this.inboxGeneration) this.updateInbox({ acknowledging: false }) }
  }

  /** Resolve historical inbox entries against the current authoritative Team action. */
  async readAction(teamId: TeamId, actionId: TeamActionResponseInput['actionId'], signal?: AbortSignal): Promise<TeamActionResponseResult['action']> {
    const generation = this.inboxGeneration
    const response = await this.api.teams.actionRead({ teamId, actionId }, signal)
    signal?.throwIfAborted()
    if (generation !== this.inboxGeneration) throw new DOMException('Inbox connection changed', 'AbortError')
    if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
    const action = response.result.value
    if (action.teamId !== teamId || action.id !== actionId) throw new TeamTaskStartError('Action response belongs to a different Team or action')
    this.publishInboxAction(action)
    if (this.list.getSnapshot().current === teamId) await this.refreshCurrentSelection(signal)
    return action
  }

  /** Submit a current action revision and retain the Host's admission or unavailable result. */
  async respondAction(teamId: TeamId, input: Omit<TeamActionResponseInput, 'teamId'>, signal?: AbortSignal): Promise<TeamActionResponseResult> {
    const generation = this.inboxGeneration
    try {
      const response = await this.api.teams.inboxRespond({ ...input, teamId }, signal)
      signal?.throwIfAborted()
      if (generation !== this.inboxGeneration) throw new DOMException('Inbox connection changed', 'AbortError')
      if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
      this.publishInboxAction(response.result.value.action)
      return response.result.value
    } finally { await this.refresh() }
  }

  /** Runtime construction initializes this optional feature of the public Team owner. */
  private currentInbox(): TeamInboxState { return this.list.getSnapshot().inbox }

  private updateInbox(update: Partial<TeamInboxState>): void {
    const current = this.list.getSnapshot()
    const previous = this.currentInbox()
    const inbox = { ...previous, ...update,
      displayCursor: Math.max(previous.displayCursor, update.displayCursor ?? previous.displayCursor) }
    const pendingHumanActions = update.items === undefined ? (current.pendingHumanActions ?? [])
      : Object.freeze(inbox.items.flatMap((item) => {
        if (item.kind !== 'action') return []
        const projected = projectDurableHumanAction(item.action)
        return projected === undefined ? [] : [Object.freeze(projected)]
      }))
    this.list.set({ ...current, inbox, pendingHumanActions })
  }

  private inboxFailure(error: unknown): void {
    this.updateInbox({ phase: 'error', error: error instanceof TeamTaskStartError && error.rpcError !== undefined
      ? error.rpcError : { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } })
  }

  private publishInboxAction(action: TeamHumanActionSnapshot): void {
    const current = this.currentInbox()
    const present = current.items.some(item => item.kind === 'action' && item.teamId === action.teamId && item.action.id === action.id)
    this.updateInbox({ hasNewer: current.hasNewer || !present,
      items: current.items.map(item => item.kind === 'action'
        && item.teamId === action.teamId && item.action.id === action.id && action.updatedAt >= item.action.updatedAt
        ? { ...item, action } : item) })
  }

  /** Apply one authenticated management command and reconcile success or conflict with the Host. */
  async manage(teamId: TeamId, command: TeamManagementCommand, signal?: AbortSignal): Promise<void> {
    if ('channelId' in command.input && (this.list.getSnapshot().channel?.admission?.channel.manifest.id !== command.input.channelId
      || this.list.getSnapshot().channel?.admission?.channel.manifest.teamId !== teamId)) {
      const admission = await this.api.teams.channelAdmission({ teamId, channelId: command.input.channelId }, signal)
      signal?.throwIfAborted()
      if (!admission.result.ok) throw new TeamTaskStartError(admission.result.error.message, admission.result.error)
      const manifest = admission.result.value.channel.manifest
      if (manifest.teamId !== teamId || manifest.id !== command.input.channelId) {
        throw new TeamTaskStartError(`Channel '${command.input.channelId}' is not in selected Team '${teamId}'`)
      }
    }
    let response: RpcResponse<unknown>
    try {
      switch (command.operation) {
        case 'memberInvite': response = await this.api.teams.memberInvite({ ...command.input, teamId }, signal); break
        case 'memberActivate': response = await this.api.teams.memberActivate({ ...command.input, teamId }, signal); break
        case 'memberRemove': response = await this.api.teams.memberRemove({ ...command.input, teamId }, signal); break
        case 'memberInterrupt': response = await this.api.teams.memberInterrupt({ ...command.input, teamId }, signal); break
        case 'channelOpen': response = await this.api.teams.channelOpen({ ...command.input, teamId }, signal); break
        case 'channelPost': response = await this.api.teams.channelPost(command.input, signal); break
        case 'channelInput': response = await this.api.teams.channelInput(command.input, signal); break
        case 'channelClose': response = await this.api.teams.channelClose(command.input, signal); break
        case 'channelSummarize': {
          const summarized = await this.api.teams.channelSummarize(command.input, signal)
          response = summarized
          const current = this.list.getSnapshot().channel
          if (summarized.result.ok && current?.channelId === command.input.channelId
            && (current.lastSummary === undefined || current.lastSummary.sequence < summarized.result.value.sequence)) {
            this.patchChannel({ lastSummary: summarized.result.value })
          }
          break
        }
        case 'taskCreate': response = await this.api.teams.taskCreate({ ...command.input, teamId }, signal); break
        case 'taskUpdate': response = await this.api.teams.taskUpdate({ ...command.input, teamId }, signal); break
        case 'taskReview': response = await this.api.teams.taskReview({ ...command.input, teamId }, signal); break
        default: assertNever(command)
      }
      if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
      if ((command.operation === 'taskUpdate' || command.operation === 'taskReview')
        && this.list.getSnapshot().taskDetail?.taskId === command.input.taskId) {
        await this.readTaskDetail(teamId, command.input.taskId)
      }
    } finally {
      await this.refreshCurrentSelection()
      if (command.operation === 'channelOpen' || command.operation === 'channelClose') await this.readChannels(teamId)
      if (command.operation === 'channelSummarize') {
        const channel = this.list.getSnapshot().channel
        if (channel?.channelId === command.input.channelId && channel.page !== undefined) {
          try { await this.readChannelPage(channel.channelId, channel.page.channel.cursor, undefined, true) }
          catch {
            // The channel owner publishes read failures; preserve the summary command's original outcome.
          }
        }
      }
    }
  }

  /** Read one bounded authoritative Team or channel audit page. */
  async readAudit(
    teamId: TeamId,
    options: { channelId?: ChannelId; afterCursor?: number; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<TeamAuditList> {
    const response = await this.api.teams.auditRead({
      teamId,
      ...options.channelId === undefined ? {} : { channelId: options.channelId },
      ...options.afterCursor === undefined ? {} : { afterCursor: options.afterCursor },
      ...options.limit === undefined ? {} : { limit: options.limit },
    }, signal)
    const result = response.result
    if (!result.ok) throw new TeamTaskStartError(result.error.message, result.error)
    return result.value
  }

  /** Read one bounded authoritative channel WAL suffix. */
  async readChannel(channelId: ChannelId, afterCursor = -1, signal?: AbortSignal): Promise<ChannelReadPageResult> {
    return await this.readChannelPage(channelId, afterCursor, signal, false)
  }

  /** Keep a summary source window intact while refreshing only its cursor and authority. */
  private async readChannelPage(channelId: ChannelId,
    afterCursor: number,
    signal: AbortSignal |
     undefined,
    preserveWindow: boolean): Promise<ChannelReadPageResult> {

    const selectionGeneration = this.selectionGeneration
    const selectedTeam = this.list.getSnapshot().current
    this.channelAbort?.abort()
    const controller = new AbortController()
    this.channelAbort = controller
    const generation = ++this.channelGeneration
    const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    const previous = this.list.getSnapshot().channel
    this.publishChannel({ ...previous?.channelId === channelId ? previous : { channelId }, loading: true,
      acknowledging: false, hasNewer: false, error: undefined })
    try {
      const response = await this.api.teams.channelRead({ channelId, afterCursor }, combined)
      combined.throwIfAborted()
      if (generation !== this.channelGeneration || selectionGeneration !== this.selectionGeneration
        || selectedTeam !== this.list.getSnapshot().current) throw new DOMException('Channel selection changed', 'AbortError')
      if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
      const incoming = response.result.value
      if (selectedTeam !== undefined && incoming.channel.manifest.teamId !== selectedTeam) {
        throw new TeamTaskStartError('Channel response belongs to a different Team')
      }
      const oldPage = previous?.channelId === channelId ? previous.page : undefined
      const unreadCursor = oldPage?.nextCursor ??
         (oldPage !== undefined &&
         incoming.channel.cursor > oldPage.channel.cursor ? oldPage.channel.cursor : undefined)
      const page = preserveWindow && oldPage !== undefined ? { ...oldPage, channel: incoming.channel,
        ...unreadCursor === undefined ? {} : { nextCursor: unreadCursor } }
        : incoming
      const lastSummary = this.list.getSnapshot().channel?.lastSummary
      this.publishChannel({ ...this.list.getSnapshot().channel, channelId, page,
        startCursor: preserveWindow ? previous?.startCursor : afterCursor, loading: true, acknowledging: false,
        hasNewer: preserveWindow ? previous?.hasNewer === true || unreadCursor !== undefined : false,
        ...lastSummary === undefined ? {} : { lastSummary } })
      if (this.list.getSnapshot().channelCatalog === undefined) void this.readChannelCatalog()
      await Promise.all([this.refreshChannelInvitation(channelId,
        generation,
        combined),
      this.refreshChannelAdmission(channelId,
        generation,
        combined)])
      combined.throwIfAborted()
      if (selectionGeneration !== this.selectionGeneration || selectedTeam !== this.list.getSnapshot().current) throw new DOMException('Channel selection changed', 'AbortError')
      if (!combined.aborted && generation === this.channelGeneration) {
        this.patchChannel({ loading: false })
        void this.watchSelectedChannel(channelId, generation, controller.signal)
      }
      return page
    } catch (error: unknown) {
      const sameSelection = selectionGeneration === this.selectionGeneration && selectedTeam === this.list.getSnapshot().current
      if (generation === this.channelGeneration) {
        this.patchChannel({ loading: false,
          ...combined.aborted ||
           !sameSelection ? {} : { error: error instanceof Error ? error.message : String(error) } })
        if (!sameSelection &&
           selectedTeam === this.list.getSnapshot().current &&
           !controller.signal.aborted &&
           this.list.getSnapshot().channel?.page !== undefined) {

          void this.watchSelectedChannel(channelId, generation, controller.signal)
        }
      }
      throw error
    }
  }

  /** Stop the current read and watch without altering any durable invitation. */
  closeChannelView(): void {
    this.channelGeneration += 1
    this.channelAbort?.abort()
    this.channelAbort = undefined
    this.list.set({ ...this.list.getSnapshot(), channel: undefined })
  }

  /** Retain consent identity across ambiguous transport errors; changed invitation revisions require another click. */
  acknowledgeChannel(channelId: ChannelId): Promise<void> {
    if (this.channelAcknowledgement !== undefined &&
       this.channelAcknowledgementGeneration === this.channelGeneration) return this.channelAcknowledgement
    const current = this.list.getSnapshot().channel
    const invitation = current?.channelId === channelId ? current.invitation?.invitation : undefined
    if (current?.channelId !== channelId) return Promise.resolve()
    if (invitation?.status !== 'pending') {
      this.patchChannel({ acknowledgementError: 'Channel invitation is no longer pending; refresh before confirming.' })
      return Promise.resolve()
    }
    const generation = this.channelGeneration
    const idempotencyKey = `team-channel-consent:${JSON.stringify([
      channelId, invitation.participantId, invitation.revision, invitation.manifestFingerprint,
    ])}` as Parameters<IApiClient['teams']['channelInvitationAcknowledge']>[0]['idempotencyKey']
    const input = { channelId, revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint, idempotencyKey }
    this.patchChannel({ acknowledging: true, acknowledgementError: undefined })
    const operation = (async () => {
      try {
        const response = await this.api.teams.channelInvitationAcknowledge(input, this.channelAbort?.signal)
        if (generation !== this.channelGeneration) return
        if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
        this.channelInvitationGeneration += 1
        this.patchChannel({ invitation: response.result.value })
        await this.readChannel(channelId)
      } catch (error: unknown) {
        if (generation === this.channelGeneration) {
          await this.refreshChannelInvitation(channelId, generation, this.channelAbort?.signal)
          if (generation === this.channelGeneration && this.list.getSnapshot().channel?.channelId === channelId) {
            this.patchChannel({ acknowledgementError: error instanceof Error ? error.message : String(error) })
          }
        }
      } finally { if (generation === this.channelGeneration) this.patchChannel({ acknowledging: false }) }
    })().finally(() => { if (this.channelAcknowledgement === operation) this.channelAcknowledgement = undefined })
    this.channelAcknowledgement = operation
    this.channelAcknowledgementGeneration = generation
    return operation
  }

  private publishChannel(channel: TeamChannelState): void {
    this.list.set({ ...this.list.getSnapshot(), channel })
  }

  private patchChannel(patch: Partial<TeamChannelState>): void {
    const current = this.list.getSnapshot().channel
    if (current !== undefined) this.publishChannel({ ...current, ...patch })
  }

  private async refreshChannelInvitation(channelId: ChannelId, generation: number, signal?: AbortSignal): Promise<void> {
    const invitationGeneration = ++this.channelInvitationGeneration
    try {
      const response = await this.api.teams.channelInvitation({ channelId }, signal)
      if (signal?.aborted || generation !== this.channelGeneration || invitationGeneration !== this.channelInvitationGeneration) return
      if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
      this.patchChannel({ invitation: response.result.value, invitationError: undefined })
    } catch (error: unknown) {
      if (!signal?.aborted &&
         generation === this.channelGeneration &&
         invitationGeneration === this.channelInvitationGeneration) this.patchChannel({
        invitationError: error instanceof Error ? error.message : String(error) })
    }
  }

  private async refreshChannelAdmission(channelId: ChannelId, generation: number, signal?: AbortSignal): Promise<void> {
    const teamId = this.list.getSnapshot().channel?.page?.channel.manifest.teamId
    if (teamId === undefined) return
    const epoch = ++this.channelAdmissionGeneration
    try {
      const response = await this.api.teams.channelAdmission({ teamId, channelId }, signal)
      if (signal?.aborted || generation !== this.channelGeneration || epoch !== this.channelAdmissionGeneration) return
      if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
      const prior = this.list.getSnapshot().channel?.admission
      if (prior !== undefined && response.result.value.channel.cursor < prior.channel.cursor) return
      this.patchChannel({ admission: response.result.value, admissionError: undefined })
    } catch (error: unknown) {
      if (!signal?.aborted && generation === this.channelGeneration && epoch === this.channelAdmissionGeneration) {
        this.patchChannel({ admissionError: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  /** Load channel pages only through the authorized provider list, retaining the visible window on failure. */
  readChannels(teamId: TeamId, mode: TeamCollectionReadMode = 'refresh'): Promise<void> {
    const more = mode === 'next'
    const selectedTeam = this.list.getSnapshot().current
    if (selectedTeam !== undefined && selectedTeam !== teamId) return Promise.resolve()
    if (this.list.getSnapshot().channels?.teamId !== teamId) this.resetChannelList()
    if (this.channelListOperation !== undefined) return this.channelListOperation
    const previous = this.list.getSnapshot().channels
    if (more && previous?.nextCursor === undefined) return Promise.resolve()
    const controller = new AbortController()
    this.channelListAbort = controller
    const generation = ++this.channelListGeneration
    const activity = this.channelListActivity
    const base: TeamChannelListState = previous ?? { teamId, items: [], loading: false, loadingMore: false, hasNewer: false }
    this.publishChannelList({ ...base, loading: !more, loadingMore: more, error: undefined })
    const operation = (async () => {
      try {
        let afterCursor: number | undefined
        switch (mode) {
          case 'next': afterCursor = previous?.nextCursor; break
          case 'first': afterCursor = undefined; break
          case 'refresh': afterCursor = previous?.startCursor; break
          default: assertNever(mode)
        }
        const response = await this.api.teams.channelList({ teamId,
          ...afterCursor === undefined ? {} : { afterCursor } }, controller.signal)
        if (controller.signal.aborted || generation !== this.channelListGeneration) return
        if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
        const page = response.result.value
        if (page.nextCursor !== undefined && page.nextCursor <= (afterCursor ?? -1)) {
          throw new TeamTaskStartError('Channel list returned a non-advancing page cursor')
        }
        this.publishChannelList({ teamId,
          items: page.items, startCursor: afterCursor,
          nextCursor: page.nextCursor,
          loading: false,
          loadingMore: false,
          hasNewer: activity !== this.channelListActivity })
      } catch (error: unknown) {
        if (!controller.signal.aborted && generation === this.channelListGeneration) {
          this.publishChannelList({ ...(this.list.getSnapshot().channels ??
             base),
          loading: false,
          loadingMore: false,
          error: error instanceof Error ? error.message : String(error) })
        }
      }
    })().finally(() => { if (this.channelListOperation === operation) this.channelListOperation = undefined })
    this.channelListOperation = operation
    return operation
  }

  private publishChannelList(channels: TeamChannelListState): void {
    this.list.set({ ...this.list.getSnapshot(), channels })
  }

  /** Refresh active creation references without changing any existing channel. */
  async readChannelCatalog(): Promise<void> {
    this.channelCatalogAbort?.abort()
    const controller = new AbortController()
    this.channelCatalogAbort = controller
    const generation = ++this.channelCatalogGeneration
    this.list.set({ ...this.list.getSnapshot(), channelCatalog: { ...this.list.getSnapshot().channelCatalog,
      loading: true, error: undefined, disconnected: false } })
    try {
      const response = await this.api.teams.channelCatalog({}, controller.signal)
      if (controller.signal.aborted || generation !== this.channelCatalogGeneration) return
      if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
      this.list.set({ ...this.list.getSnapshot(), channelCatalog: { value: response.result.value, loading: false } })
    } catch (error: unknown) {
      if (!controller.signal.aborted && generation === this.channelCatalogGeneration) this.list.set({ ...this.list.getSnapshot(),
        channelCatalog: { ...this.list.getSnapshot().channelCatalog,
          loading: false,
          error: error instanceof Error ? error.message : String(error) } })
    }
  }

  private resetChannelList(): void {
    this.channelListGeneration += 1
    this.channelListAbort?.abort()
    this.channelListOperation = undefined
    this.list.set({ ...this.list.getSnapshot(), channels: undefined })
  }

  private async watchSelectedChannel(channelId: ChannelId, generation: number, signal: AbortSignal): Promise<void> {
    const isCurrent = () => !signal.aborted && generation === this.channelGeneration
    try {
      while (isCurrent()) {
        const current = this.list.getSnapshot().channel
        const page = current?.page
        if (page === undefined || !['pending', 'active', 'closing'].includes(page.channel.phase)) return
        const response = await this.api.teams.channelWatch({ channelId, afterCursor: page.channel.cursor }, signal)
        if (!isCurrent()) return
        if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
        if (response.result.value.kind === 'changed' && response.result.value.cursor <= page.channel.cursor) {
          throw new TeamTaskStartError('Channel watch returned a non-advancing cursor')
        }
        this.patchChannel({ loading: true })
        const refreshed = await this.api.teams.channelRead({ channelId, afterCursor: page.channel.cursor }, signal)
        if (!isCurrent()) return
        if (!refreshed.result.ok) throw new TeamTaskStartError(refreshed.result.error.message, refreshed.result.error)
        const snapshot = refreshed.result.value
        this.patchChannel({ hasNewer: true, page: { ...page, channel: snapshot.channel,
          nextCursor: page.nextCursor ?? page.channel.cursor } })
        await Promise.all([this.refreshChannelInvitation(channelId,
          generation,
          signal),
        this.refreshChannelAdmission(channelId,
          generation,
          signal)])
        if (isCurrent()) this.patchChannel({ loading: false })
        if (response.result.value.kind === 'closed') return
      }
    } catch (error: unknown) {
      if (isCurrent()) this.patchChannel({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Read an image only through the saved Envelope selected by its exact owner tuple. */
  async readChannelAttachment(input: TeamChannelAttachmentInput, signal?: AbortSignal): Promise<TeamChannelAttachmentResult> {
    const response = await this.api.teams.channelAttachment(input, signal)
    signal?.throwIfAborted()
    if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
    return response.result.value
  }

  /** Read one visible Team artifact through the Host provider boundary. */
  async readArtifact(teamId: TeamId, artifactId: string, signal?: AbortSignal): Promise<TeamArtifactReadResult> {
    const response = await this.api.teams.artifactRead({ teamId, artifactId }, signal)
    const result = response.result
    if (!result.ok) throw new TeamTaskStartError(result.error.message, result.error)
    return result.value
  }

  /** Read one task without expanding its complete Team history.
   * @param teamId - Selected Team.
   * @param taskId - Task to inspect, including unloaded dependencies.
   * @param section - Current fields or one history.
   * @param mode - Replace, advance or restart the history window.
   */
  async readTaskDetail(teamId: TeamId, taskId: TeamTaskId, section: 'record' | 'attempts' | 'reviews' = 'record',
    mode: 'refresh' | 'first' | 'next' = 'refresh'): Promise<void> {
    if (this.list.getSnapshot().current !== teamId) return
    await this.taskInspector.read(teamId, taskId, section, mode)
  }

  /** Release the selected task's reads and bounded inspection data. */
  closeTaskDetail(): void { this.taskInspector.close() }

  /** Read the selected workflow independently from the summary list. */
  async readWorkflowDetail(teamId: TeamId, planId: Parameters<NonNullable<ITeamTasks['readWorkflowDetail']>>[1],
    mode: Parameters<NonNullable<ITeamTasks['readWorkflowDetail']>>[2] = 'open'): Promise<void> {
    if (this.list.getSnapshot().current === teamId) await this.workflowInspector.read(teamId, planId, mode)
  }

  /** Dismiss the workflow page without affecting execution. */
  closeWorkflowDetail(): void { this.workflowInspector.close() }

  /** Read one bounded collection page, retaining current data after failure or cancellation. */
  readCollections(teamId: TeamId, collection: TeamCollectionKind, mode: TeamCollectionReadMode = 'refresh', signal?: AbortSignal): Promise<void> {
    const current = this.list.getSnapshot()
    if (current.current !== teamId) return Promise.resolve()
    const generation = this.selectionGeneration
    const key = `${String(teamId)}:${collection}:${generation}`
    const pending = this.collectionOperations.get(key)
    if (pending !== undefined) return pending
    const previous = current.collections?.teamId === teamId ? current.collections : emptyCollections(teamId)
    const priorPage = previous[collection]
    const more = mode === 'next'
    if (more && priorPage.nextCursor === undefined) return Promise.resolve()
    const afterCursor = mode === 'first' ? -1 : more ? (priorPage.nextCursor ?? -1) : (priorPage.startCursor ?? -1)
    const startCursor = current.selected?.teamId === teamId ? current.selected.state.team.cursor : undefined
    const operation = (async () => {
      const loadingPage = { ...priorPage, loading: !more, loadingMore: more, error: undefined }
      this.publishCollections(teamId, { ...previous, [collection]: loadingPage })
      try {
        const response = collection === 'members' || collection === 'tasks' || collection === 'workflowPlans'
          ? await this.api.teams.browse({ teamId, kind: collection, afterCursor, limit: TEAM_COLLECTION_PAGE_LIMIT }, signal)
          : await this.api.teams.artifactList({ teamId, afterCursor, limit: TEAM_COLLECTION_PAGE_LIMIT }, signal)
        signal?.throwIfAborted()
        if (generation !== this.selectionGeneration || this.list.getSnapshot().current !== teamId) return
        if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
        const page = response.result.value
        if ((collection === 'tasks' || collection === 'members' || collection === 'workflowPlans') && (!('kind' in page) || page.kind !== collection || page.teamId !== teamId)) {
          throw new TeamTaskStartError(`${collection} summaries do not match the selected Team`)
        }
        if (page.nextCursor !== undefined && page.nextCursor <= afterCursor) {
          throw new TeamTaskStartError(`${collection} list returned a non-advancing page cursor`)
        }
        if (page.items.length > TEAM_COLLECTION_PAGE_LIMIT) {
          throw new TeamTaskStartError(`${collection} list exceeded its requested row limit`)
        }
        const items = [...new Map(page.items.map(item => [item.id, item])).values()]
        const latestSelection = this.list.getSnapshot().selected
        const newerCursor = startCursor !== undefined && latestSelection?.teamId === teamId
          && latestSelection.state.team.cursor > startCursor
        const nextPage = {
          items, startCursor: afterCursor, nextCursor: page.nextCursor, loading: false, loadingMore: false,
          hasNewer: more ? priorPage.hasNewer || newerCursor : newerCursor,
        }
        const currentCollections = this.list.getSnapshot().collections ?? emptyCollections(teamId)
        const next: TeamCollectionsState = {
          ...currentCollections,
          teamId,
          [collection]: nextPage,
          artifacts: collection === 'artifacts' ? nextPage as TeamCollectionPage<TeamArtifactReference> : currentCollections.artifacts,
        }
        this.publishCollections(teamId, next)
      } catch (error: unknown) {
        if (generation !== this.selectionGeneration || this.list.getSnapshot().current !== teamId) return
        const collections = this.list.getSnapshot().collections ?? emptyCollections(teamId)
        this.publishCollections(teamId, {
          ...collections,
          [collection]: { ...collections[collection], loading: false, loadingMore: false,
            error: signal?.aborted ? undefined : error instanceof Error ? error.message : String(error) },
        })
      }
    })().finally(() => { if (this.collectionOperations.get(key) === operation) this.collectionOperations.delete(key) })
    this.collectionOperations.set(key, operation)
    return operation
  }

  /** Publish a collection state only while its Team remains selected. */
  private publishCollections(teamId: TeamId, collections: TeamCollectionsState): void {
    const current = this.list.getSnapshot()
    if (current.current !== teamId) return
    this.list.set({ ...current, collections })
  }

  /** Load the first bounded member/task pages after selection without making the read fatal. */
  private async refreshCollections(teamId: TeamId, generation: number, signal?: AbortSignal): Promise<void> {
    if (generation !== this.selectionGeneration || this.list.getSnapshot().current !== teamId) return
    await Promise.all([
      this.readCollections(teamId, 'members', 'refresh', signal),
      this.readCollections(teamId, 'tasks', 'refresh', signal),
      this.readCollections(teamId, 'workflowPlans', 'refresh', signal),
      this.readCollections(teamId, 'artifacts', 'refresh', signal),
    ])
  }

  /** Read one member detail without selecting or resuming a Team. */
  async inspectMember(input: Parameters<IApiClient['teams']['memberInspect']>[0], signal?: AbortSignal):
  Promise<Extract<Awaited<ReturnType<IApiClient['teams']['memberInspect']>>['result'], { ok: true }>['value']> {
    const response = await this.api.teams.memberInspect(input, signal)
    signal?.throwIfAborted()
    if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
    const value = response.result.value
    if (value.record.teamId !== input.teamId || value.record.id !== input.participantId
      || value.startCursor !== (input.afterCursor ?? -1)
      || input.expectedTeamCursor !== undefined && value.teamCursor !== input.expectedTeamCursor
      || input.limit !== undefined && value.items.length > input.limit) {
      throw new TeamTaskStartError('Member inspection belongs to another selection or exceeds the requested page')
    }
    return value
  }

  /** Resolve a member's published Session through the owning Team, without loading or activating the Team. */
  async participantSession(teamId: TeamId, participantId: Parameters<NonNullable<ITeamTasks['participantSession']>>[1], signal?: AbortSignal): Promise<SessionId> {
    const response = await this.api.teams.memberSession({ teamId, participantId }, signal)
    signal?.throwIfAborted()
    if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
    const binding = response.result.value
    if (binding.activation.teamId !== teamId || binding.activation.participantId !== participantId) {
      throw new TeamTaskStartError('Member Session response belongs to a different Team or participant')
    }
    if (this.list.getSnapshot().current === teamId) this.list.set({ ...this.list.getSnapshot(),
      memberSession: { teamId, participantId, sessionId: binding.sessionId } })
    return binding.sessionId
  }

  /** Start one drafted Team through the Host's idempotent create-and-admit operation. */
  start(input: TeamTaskStartInput, signal?: AbortSignal): Promise<TeamTaskSelection> {
    const draft = this.requireDraft()
    const resolvedInput = resolveStartInput(input, draft)
    const fingerprint = startFingerprint(resolvedInput)
    if (draft.fingerprint !== undefined && draft.fingerprint !== fingerprint) {
      return Promise.reject(new TeamTaskStartError('task draft input changed after a failed start; begin a new task to use different input'))
    }
    if (this.starting !== undefined) return this.starting
    const current = this.list.getSnapshot()
    this.list.set({
      ...current,
      draft: { ...draft, fingerprint, phase: 'starting', error: undefined, message: undefined },
    })
    this.starting = (async (): Promise<TeamTaskSelection> => {
      try {
        const response = await this.api.teams.start({
          objective: resolvedInput.text.trim(),
          text: resolvedInput.text.trim(),
          idempotencyKey: draft.idempotencyKey,
          ...resolvedInput.cwd === undefined ? {} : { cwd: resolvedInput.cwd },
          ...resolvedInput.agentPreset === undefined ? {} : { agentPreset: resolvedInput.agentPreset },
          ...resolvedInput.selection === undefined ? {} : { selection: resolvedInput.selection },
        }, signal)
        const result = response.result
        if (!result.ok) {
          const current = this.list.getSnapshot()
          this.list.set({
            ...current,
            draft: { ...draft, fingerprint, phase: 'error', error: result.error, message: undefined },
          })
          throw new TeamTaskStartError(result.error.message, result.error)
        }
        const selected = await this.api.teams.selection({ teamId: result.value.state.team.id, includeMetadata: true }, signal)
        if (!selected.result.ok) throw new TeamTaskStartError(selected.result.error.message, selected.result.error)
        const selection = selectionOf(selected.result.value)
        if (this.list.getSnapshot().current !== selection.teamId) { this.closeChannelView(); this.resetChannelList() }
        const current = this.list.getSnapshot()
        this.list.set({
          ...current,
          current: selection.teamId,
          selected: selection,
          draft: undefined,
        })
        if (result.value.state.humanActions?.some(action => action.phase === 'pending')) this.updateInbox({ hasNewer: true })
        return selection
      } catch (error: unknown) {
        if (error instanceof TeamTaskStartError && error.rpcError !== undefined) throw error
        const message = error instanceof Error ? error.message : String(error)
        const current = this.list.getSnapshot()
        this.list.set({
          ...current,
          draft: { ...draft, fingerprint, phase: 'error', error: undefined, message },
        })
        throw error instanceof TeamTaskStartError ? error : new TeamTaskStartError(message)
      }
    })().finally(() => { this.starting = undefined })
    return this.starting
  }

  /** Resolve a coordinator from Session-owned metadata without retaining historical routes.
   * @param sessionId - Session receiving input.
   * @param owner - Immutable Team and Participant identity from its header.
   * @param signal - Optional cancellation for the bounded read.
   * @returns the exact current coordinator route, or undefined for another Team member.
   */
  async resolveCoordinatorSession(sessionId: SessionId,
    owner?: Parameters<IApiClient['teams']['memberSession']>[0], signal?: AbortSignal,
  ): Promise<Pick<TeamTaskSelection, 'teamId' | 'coordinatorSessionId'> | undefined> {
    if (owner === undefined) {
      const current = this.list.getSnapshot().selected
      if (current?.coordinatorSessionId !== sessionId || current.state.coordinator.kind !== 'bound') return undefined
      owner = { teamId: current.teamId, participantId: current.state.coordinator.binding.activation.participantId }
    }
    const response = await this.api.teams.selection({ teamId: owner.teamId }, signal)
    signal?.throwIfAborted()
    if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
    const coordinator = response.result.value.coordinator
    if (response.result.value.team.id !== owner.teamId) throw new TeamTaskStartError('Coordinator selection belongs to another Team')
    if (coordinator.kind !== 'bound' || coordinator.participantPhase !== 'active'
      || coordinator.binding.activation.participantId !== owner.participantId || coordinator.binding.sessionId !== sessionId) {
      return undefined
    }
    return { teamId: owner.teamId, coordinatorSessionId: sessionId }
  }

  /** Return the lightweight selection only for its current Team. */
  private currentSelection(teamId: TeamId): TeamTaskSelection | undefined {
    const selected = this.list.getSnapshot().selected
    return selected?.teamId === teamId ? selected : undefined
  }

  /** Retain visible records while invalidating all requests from the lost connection. */
  handleDisconnected(): void {
    this.taskInspector.disconnect()
    this.workflowInspector.disconnect()
    this.selectionGeneration += 1
    this.collectionOperations.clear()
    this.channelCatalogGeneration += 1
    this.channelCatalogAbort?.abort()
    const catalog = this.list.getSnapshot().channelCatalog
    if (catalog !== undefined) this.list.set({ ...this.list.getSnapshot(),
      channelCatalog: { ...catalog,
        loading: false,
        disconnected: true } })
    this.channelGeneration += 1
    this.channelAbort?.abort()
    this.patchChannel({ loading: false, acknowledging: false, disconnected: true })
    this.channelListGeneration += 1
    this.channelListAbort?.abort()
    this.channelListOperation = undefined
    const channels = this.list.getSnapshot().channels
    if (channels !== undefined) this.publishChannelList({ ...channels, loading: false, loadingMore: false, hasNewer: true })
  }

  /** Refresh after a new connection generation becomes available. */
  handleConnected(): void {
    void this.taskInspector.reconnect()
    void this.workflowInspector.reconnect()
    if (this.list.getSnapshot().channelCatalog !== undefined) void this.readChannelCatalog()
    const channels = this.list.getSnapshot().channels
    if (channels !== undefined) void this.readChannels(channels.teamId)
    const channel = this.list.getSnapshot().channel
    if (channel !== undefined) {
      this.channelAbort?.abort()
      const controller = new AbortController()
      this.channelAbort = controller
      const generation = ++this.channelGeneration
      this.patchChannel({ error: undefined, loading: true, acknowledging: false, disconnected: false })
      if (channel.page === undefined) {
        // Read failures are already published in the channel state.
        void this.readChannel(channel.channelId).catch(() => {})
      } else {
        void Promise.all([this.refreshChannelInvitation(channel.channelId, generation, controller.signal),
          this.refreshChannelAdmission(channel.channelId, generation, controller.signal)]).then(() => {
          if (controller.signal.aborted || generation !== this.channelGeneration) return
          this.patchChannel({ loading: false })
          void this.watchSelectedChannel(channel.channelId, generation, controller.signal)
        })
      }
    }
    this.inboxGeneration += 1
    this.list.set({ ...this.list.getSnapshot(), inbox: emptyInboxState(this.inboxGeneration) })
    this.updateInbox({ items: [] })
    void this.refresh().then(async () => {
      const current = this.list.getSnapshot()
      if (current.current !== undefined) await this.refreshCollections(current.current, this.selectionGeneration)
    }).catch(() => {
      // `refresh()` publishes connection failures on the Team list state.
    })
    void this.refreshSelectedHumanActions()
  }

  /**
   * Refresh Team state and project Team-bound human actions from one mux envelope.
   * @param envelope - validated mux request or notification delivered by the host.
   */
  handleMuxEnvelope(envelope: RpcRequest<MuxFrame> | MuxFrame): void {
    const frame = isMuxRequest(envelope) ? envelope.payload : envelope
    this.handleHumanActionFrame(frame)
    if (frame.type === 'team/changed' && frame.event.type === 'human-action/changed') {
      this.publishInboxAction(frame.event.action)
    }
    if (frame.type === 'team/changed' && frame.event.type === 'workflow-plan/changed') {
      this.workflowInspector.changed(frame.event.plan.teamId, frame.event.plan.id, frame.event.plan.revision)
    }
    if (frame.type === 'team/changed' || frame.type === 'channel/changed') void this.refresh()
    if (frame.type === 'team/changed' && frame.event.type === 'task/changed'
      && this.list.getSnapshot().current === frame.event.task.teamId) {
      const teamId = frame.event.task.teamId
      this.taskInspector.changed(teamId, frame.event.task.id, frame.event.task.revision)
      const generation = this.selectionGeneration
      void this.refreshCurrentSelection().then(async () => {
        if (generation === this.selectionGeneration && this.list.getSnapshot().current === teamId) {
          await this.refreshCollections(teamId, generation)
        }
      }).catch(() => {
        // The normal connection refresh owns the visible error projection.
      })
    }
    const channels = this.list.getSnapshot().channels
    if (channels !== undefined && frame.type === 'channel/changed'
      && (channels.items.some(channel => channel.manifest.id === frame.event.channelId)
        || frame.event.record.type === 'channel/opened' && frame.event.record.manifest.teamId === channels.teamId)) {
      this.channelListActivity += 1
      this.publishChannelList({ ...channels, hasNewer: true })
    }
  }

  /** Transient notifications advertise inbox changes without retaining another action body cache. */
  private handleHumanActionFrame(frame: MuxFrame): void {
    if (((frame.type === 'approval/requested' || frame.type === 'question/requested') && frame.teamId !== undefined)
      || frame.type === 'approval/resolved' || frame.type === 'question/resolved') {
      this.updateInbox({ hasNewer: true })
    }
  }

  /** Reconnect the principal inbox without reading historical Team projections. */
  private async refreshSelectedHumanActions(): Promise<void> {
    await this.refreshInbox()
  }

  /** Reject a late open result before it can redirect either Team detail or its transcript. */
  private assertCurrentSelectionRequest(generation: number, signal?: AbortSignal): void {
    signal?.throwIfAborted()
    if (generation !== this.selectionGeneration) throw new DOMException('Team selection was superseded', 'AbortError')
  }

  /** Refresh the currently visible detail without resuming an offline activation. */
  private async refreshCurrentSelection(signal?: AbortSignal): Promise<void> {
    const teamId = this.list.getSnapshot().current
    if (teamId === undefined) return
    const generation = this.selectionGeneration
    const previous = this.currentSelection(teamId)
    try {
      const response = await this.api.teams.selection({ teamId, includeMetadata: true }, signal)
      if (generation !== this.selectionGeneration || this.list.getSnapshot().current !== teamId
        || this.currentSelection(teamId) !== previous || signal?.aborted) return
      if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
      this.publishRefreshedSelection(response.result.value)
    } catch (error: unknown) {
      if (generation !== this.selectionGeneration || signal?.aborted) return
      const rpcError = error instanceof TeamTaskStartError ? error.rpcError : undefined
      this.list.set({ ...this.list.getSnapshot(), error: rpcError
        ?? { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } })
    }
  }

  /** Replace cached business state and report whether the Host projection is at least as current. */
  private publishRefreshedSelection(state: TeamTaskSelection['state']): boolean {
    const previous = this.currentSelection(state.team.id)
    if (previous !== undefined && state.team.cursor < previous.state.team.cursor) return false
    const channels = this.list.getSnapshot().channels
    if (channels?.teamId === state.team.id && previous !== undefined
      && previous.state.counts.channels !== state.counts.channels) {
      this.channelListActivity += 1
      this.publishChannelList({ ...channels, hasNewer: true })
    }
    const selection = selectionOf(state)
    const current = this.list.getSnapshot()
    if (current.current === selection.teamId) {
      const collections = current.collections?.teamId === selection.teamId && previous !== undefined
        && state.team.cursor > previous.state.team.cursor
        ? { ...current.collections,
          members: { ...current.collections.members, hasNewer: true },
          tasks: { ...current.collections.tasks, hasNewer: true },
          workflowPlans: { ...current.collections.workflowPlans, hasNewer: true },
          artifacts: { ...current.collections.artifacts, hasNewer: true } }
        : current.collections
      this.list.set({ ...current, selected: selection, collections, error: null })
    }
    return true
  }

  private async load(requestedStart?: NonNullable<TeamTaskListState['nextCursor']> | -1): Promise<void> {
    this.list.set({ ...this.list.getSnapshot(), state: 'loading', error: null })
    try {
      const afterCursor = requestedStart ?? this.list.getSnapshot().startCursor ?? -1
      const response = await this.api.teams.list({ afterCursor })
      if (!response.result.ok) throw new TeamTaskStartError(response.result.error.message, response.result.error)
      const page = response.result.value
      if (page.nextCursor !== undefined && page.nextCursor === afterCursor) {
        throw new TeamTaskStartError('Team list returned a non-advancing page cursor')
      }
      this.list.set({
        ...this.list.getSnapshot(),
        items: page.items, startCursor: afterCursor,
        nextCursor: page.nextCursor,
        phase: 'ready',
        state: 'idle',
        error: null,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const current = this.list.getSnapshot()
      this.list.set({
        ...current,
        phase: 'ready',
        state: 'error',
        error: error instanceof TeamTaskStartError && error.rpcError !== undefined
          ? error.rpcError : { code: 'internal', message, details: {} },
      })
    }
  }

  private requireDraft(): TeamTaskDraft {
    const draft = this.list.getSnapshot().draft
    if (draft === undefined) throw new TeamTaskStartError('start a new task before submitting its first input')
    return draft
  }
}

/** Normalize user text and optional start choices for local retry identity. */
function startFingerprint(input: TeamTaskStartInput): string {
  const value: { text: string; cwd?: string; agentPreset?: string; selection?: TeamTaskStartInput['selection'] } = {
    text: input.text.trim(),
    ...input.cwd === undefined ? {} : { cwd: input.cwd },
    ...input.agentPreset === undefined ? {} : { agentPreset: input.agentPreset },
  }
  if (input.selection !== undefined) value.selection = input.selection
  return JSON.stringify(value)
}

/** Resolve explicit call choices over the options retained by the draft. */
function resolveStartInput(input: TeamTaskStartInput, draft: TeamTaskDraft): TeamTaskStartInput {
  return {
    text: input.text,
    ...input.cwd === undefined
      ? draft.cwd === undefined ? {} : { cwd: draft.cwd }
      : { cwd: input.cwd },
    ...input.agentPreset === undefined
      ? draft.agentPreset === undefined ? {} : { agentPreset: draft.agentPreset }
      : { agentPreset: input.agentPreset },
    ...input.selection === undefined
      ? draft.selection === undefined ? {} : { selection: draft.selection }
      : { selection: input.selection },
  }
}

/** Extract the active coordinator Session from a default Team state. */
function emptyCollectionPage<T>(): TeamCollectionPage<T> {
  return { items: [], loading: false, loadingMore: false, hasNewer: false }
}

/** Create an empty bounded collection projection for one Team selection. */
function emptyCollections(teamId: TeamId): TeamCollectionsState {
  return { teamId,
    members: emptyCollectionPage(),
    tasks: emptyCollectionPage(),
    workflowPlans: emptyCollectionPage(),
    artifacts: emptyCollectionPage() }
}

/** Extract the active coordinator Session from a default Team state. */
function selectionOf(state: TeamTaskSelection['state']): TeamTaskSelection {
  if (state.coordinator.kind !== 'bound') throw new TeamTaskStartError(`Team '${state.team.id}' coordinator is unavailable: ${state.coordinator.reason}`)
  return Object.freeze({ teamId: state.team.id, state, coordinatorSessionId: state.coordinator.binding.sessionId })
}

/** Distinguish the connection stream envelope from a bare frame test helper. */
function isMuxRequest(value: RpcRequest<MuxFrame> | MuxFrame): value is RpcRequest<MuxFrame> {
  return 'payload' in value && 'rpcId' in value
}

/** Project a durable Team action into the answerable UI shape used by mux frames. */
function projectDurableHumanAction(action: TeamHumanActionSnapshot): TeamHumanAction | undefined {
  if (action.phase !== 'pending') return undefined
  const details = action.details
  if (action.kind === 'approval') {
    const approvalId = typeof details.approvalId === 'string'
      ? details.approvalId as Extract<MuxFrame, { type: 'approval/requested' }>['approvalId']
      : action.sourceId as unknown as Extract<MuxFrame, { type: 'approval/requested' }>['approvalId']
    return {
      kind: 'approval',
      requestId: String(approvalId),
      sessionId: action.sessionId,
      teamId: action.teamId,
      approvalId,
      toolName: typeof details.toolName === 'string' ? details.toolName : 'approval',
      ...typeof details.callId === 'string' ? { callId: details.callId } : {},
      ...typeof details.reason === 'string' ? { reason: details.reason } : {},
      participantId: String(action.participantId),
      ...action.taskId === undefined ? {} : { taskId: String(action.taskId) },
    }
  }
  const questions = Array.isArray(details.questions)
    ? details.questions as Extract<MuxFrame, { type: 'question/requested' }>['questions']
    : []
  const questionRpcId = typeof details.questionRpcId === 'string' ? details.questionRpcId : action.sourceId
  return {
    kind: 'question',
    requestId: questionRpcId,
    sessionId: action.sessionId,
    teamId: action.teamId,
    questionRpcId,
    questions,
    participantId: String(action.participantId),
    ...action.taskId === undefined ? {} : { taskId: String(action.taskId) },
  }
}

/** Keep the closed management operation map exhaustive. */
function assertNever(value: never): never {
  throw new Error(`Unsupported Team management command: ${String(value)}`)
}

/** An authenticated connection starts without a cached principal's inbox data. */
function emptyInboxState(connectionGeneration = 0): TeamInboxState {
  return { connectionGeneration, items: [], phase: 'idle', displayCursor: -1, cursor: -1, nextCursor: undefined,
    loadingMore: false, acknowledging: false, hasNewer: false, error: null }
}
