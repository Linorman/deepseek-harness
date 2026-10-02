export type { TeamTaskUpdateLookup, TeamTaskUpdateLookupInput, TeamTaskUpdateCommandId } from '@clocky/clocky-client-connection/client'
export type { TeamTaskReferencesPage, TeamTaskReference } from '@clocky/clocky-client-connection/client'
export type { TaskReferencesState, TaskReferencesOptions } from '../teams/task-references.ts'
import type { TeamIdentityState, TeamIdentityOptions } from '../teams/identity-resolver.ts'
export type { TeamActionInspection, TeamAttentionHandling } from '@clocky/clocky-client-connection/client'

/** One verified artifact byte window; view components retain selection and feedback only. */
export interface TeamArtifactDetailState {
  readonly teamId: TeamId
  readonly artifactId: string
  readonly value: TeamArtifactReadResult | undefined
  readonly loading: boolean
  readonly disconnected: boolean
  readonly stale: boolean
  readonly error?: string | undefined
}

/** Exact member metadata and a single bounded capability page, owned by runtime. */
export interface TeamMemberDetailState {
  readonly teamId: TeamId
  readonly participantId: ParticipantId
  readonly value: Extract<Awaited<ReturnType<IApiClient['teams']['memberInspect']>>['result'], { ok: true }>['value'] | undefined
  readonly loading: boolean
  readonly disconnected: boolean
  readonly hasNewer: boolean
  readonly error?: string
}

/** Exact current request inspection owned by the runtime, independent of UI drafts. */
export interface TeamActionDetailState {
  readonly teamId: import('@clocky/clocky-client-connection/client').TeamId
  readonly actionId: import('@clocky/clocky-client-connection/client').TeamHumanActionId
  readonly value?: import('@clocky/clocky-client-connection/client').TeamActionInspection | undefined
  readonly loading: boolean
  readonly error?: string | undefined
  readonly hasNewer: boolean
  readonly disconnected: boolean
}
export type { TeamAttentionReadInput, TeamAttentionPage, TeamAttentionCounts, TeamAttentionItem, TeamAttentionCursor } from '@clocky/clocky-client-connection/client'
import type { TeamAttentionPage, TeamAttentionCursor } from '@clocky/clocky-client-connection/client'

/** One retained Team pending page and its independent request state. */
export interface TeamAttentionState {
  readonly teamId: import('@clocky/clocky-client-connection/client').TeamId
  readonly limit: number
  readonly startCursor?: TeamAttentionCursor | undefined
  readonly page?: TeamAttentionPage | undefined
  readonly loading: boolean
  readonly error?: string | undefined
  readonly hasNewer: boolean
  readonly disconnected: boolean
}
/** Bounded identity, scalar metadata and counts returned by the Team selection endpoint. */
export type TeamSelectionView = Extract<Awaited<ReturnType<IApiClient['teams']['selection']>>['result'], { ok: true }>['value']
/** Browser Team-task product state and operations. */

import type {
  ChannelId, ChannelPostIdempotencyKey, ChannelReadPageResult, IApiClient, MuxFrame, ParticipantId, RpcError, SessionId,
  TeamArtifactList, TeamArtifactReadResult, TeamAuditList, ModelSelection,
  TeamId, TeamList, TeamSnapshot, TeamStateSnapshot, TeamTaskId, TeamTaskSnapshot,
} from '@clocky/clocky-client-connection/client'
import type { ObservableSnapshot } from './store.ts'

/** Host mutation names supported by the Team management surface. */
export type TeamManagementOperation = 'memberInvite' | 'memberActivate' | 'memberRemove' | 'memberInterrupt'
  | 'channelOpen' | 'channelPost' | 'channelInput' | 'channelClose' | 'channelSummarize' | 'taskCreate' | 'taskUpdate' | 'taskReview'

/** Exact Host payload for one management action; the runtime supplies its owning Team. */
export type TeamManagementCommand = {
  [Operation in TeamManagementOperation]: {
    readonly operation: Operation
    readonly input: Omit<Parameters<IApiClient['teams'][Operation]>[0], 'teamId'>
  }
}[TeamManagementOperation]

/** Principal-owned inbox response from the authenticated Host. */
export type TeamInboxPage = Extract<Awaited<ReturnType<IApiClient['teams']['inboxRead']>>['result'], { ok: true }>['value']
/** Exact durable approval/question answer sent to the Host. */
export type TeamActionResponseInput = Parameters<IApiClient['teams']['inboxRespond']>[0]
/** Answer acceptance or an unavailable continuation, without a tool-completion claim. */
export type TeamActionResponseResult = Extract<Awaited<ReturnType<IApiClient['teams']['inboxRespond']>>['result'], { ok: true }>['value']
/** Principal-scoped invitation returned without accepting its manifest. */
export type TeamChannelInvitation = Extract<Awaited<ReturnType<IApiClient['teams']['channelInvitation']>>['result'], { ok: true }>['value']
/** Authorized complete endpoint-admission metadata; it never grants consent authority. */
export type TeamChannelAdmission = Extract<Awaited<ReturnType<IApiClient['teams']['channelAdmission']>>['result'], { ok: true }>['value']
/** One provider-bounded channel list page. */
export type TeamChannelListPage = Extract<Awaited<ReturnType<IApiClient['teams']['channelList']>>['result'], { ok: true }>['value']
/** Active protocol and view-policy registrations available for new channels. */
export type TeamChannelCatalog = Extract<Awaited<ReturnType<IApiClient['teams']['channelCatalog']>>['result'], { ok: true }>['value']
/** Durable summary returned by the authenticated source-range command. */
export type TeamChannelSummary = Extract<Awaited<ReturnType<IApiClient['teams']['channelSummarize']>>['result'], { ok: true }>['value']
/** Connection-scoped creation choices; existing manifests remain immutable. */
export interface TeamChannelCatalogState {
  readonly value?: TeamChannelCatalog | undefined
  readonly loading: boolean
  readonly error?: string | undefined
  readonly disconnected?: boolean | undefined
}
/** Ordered encoded user content admitted by the Host's channel input endpoint. */
export type TeamChannelInput = Parameters<IApiClient['teams']['channelInput']>[0]
/** Exact durable Envelope image read selected by its owning Team and channel. */
export type TeamChannelAttachmentInput = Parameters<IApiClient['teams']['channelAttachment']>[0]
/** Verified attachment bytes; callers never construct a durable image reference. */
export type TeamChannelAttachmentResult = Extract<Awaited<ReturnType<IApiClient['teams']['channelAttachment']>>['result'], { ok: true }>['value']
/** Ordered durable display content for an admitted direct-channel message. */
export type TeamChannelMessageContent = readonly ({ readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: TeamChannelAttachmentResult['attachment'] })[]
/** Explicitly loaded channel pages owned by the runtime. */
export interface TeamChannelListState {
  /** Exclusive cursor that produced this single window; absent for the first page. */
  readonly startCursor?: number | undefined
  readonly teamId: TeamId
  readonly items: TeamChannelListPage['items']
  readonly nextCursor?: number | undefined
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly hasNewer: boolean
  readonly error?: string | undefined
}
/** Runtime-owned channel inspection and explicit invitation consent. */
export interface TeamChannelState {
  /** Exclusive cursor that produced the retained record window. */
  readonly startCursor?: number | undefined
  readonly channelId: ChannelId
  readonly page?: ChannelReadPageResult | undefined
  readonly invitation?: TeamChannelInvitation | undefined
  readonly admission?: TeamChannelAdmission | undefined
  readonly admissionError?: string | undefined
  readonly lastSummary?: TeamChannelSummary | undefined
  readonly loading: boolean
  readonly acknowledging: boolean
  readonly hasNewer: boolean
  readonly error?: string | undefined
  readonly invitationError?: string | undefined
  readonly acknowledgementError?: string | undefined
  readonly disconnected?: boolean | undefined
}

/** One independently loaded Team collection page owned by the browser runtime. */
export interface TeamCollectionPage<T> {
  /** Exclusive cursor that produced this window; absent before its first successful read. */
  readonly startCursor?: number | undefined
  readonly items: readonly T[]
  readonly nextCursor?: number | undefined
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly hasNewer: boolean
  readonly error?: string | undefined
}

/** Member rows omit provider configuration, grants and task-outcome statistics. */
export type TeamMemberSummary = Extract<Extract<Awaited<ReturnType<IApiClient['teams']['browse']>>['result'], { ok: true }>['value'], { kind: 'members' }>['items'][number]

/** Task rows omit instructions, execution outcomes and attempt/review history. */
export type TeamTaskSummary = Extract<Extract<Awaited<ReturnType<IApiClient['teams']['browse']>>['result'], { ok: true }>['value'], { kind: 'tasks' }>['items'][number]

/** Workflow list rows exclude the DAG, task bindings and result payloads. */
export type TeamWorkflowSummary = Extract<Extract<Awaited<ReturnType<IApiClient['teams']['browse']>>['result'], { ok: true }>['value'], { kind: 'workflowPlans' }>['items'][number]
/** Current workflow metadata and one task/dependency page. */
export type TeamWorkflowInspection = Extract<Awaited<ReturnType<IApiClient['teams']['workflowPlanInspect']>>['result'], { ok: true }>['value']
/** Navigation of the single retained workflow inspection. */
export type TeamWorkflowDetailReadMode = TeamCollectionReadMode | 'open'
/** Runtime-owned workflow read status; failures preserve the visible revision. */
export interface TeamWorkflowDetailState {
  readonly teamId: TeamId
  readonly planId: TeamWorkflowSummary['id']
  readonly value?: TeamWorkflowInspection | undefined
  readonly loading: boolean
  readonly hasNewer: boolean
  readonly disconnected: boolean
  readonly error?: string | undefined
}

/** Exact form scopes sent for an authenticated Host observation. */
export type TeamTaskCapabilitiesInput = Parameters<IApiClient['teams']['capabilities']>[0]
/** Allowed choices and independently versioned Host execution availability. */
export type TeamTaskCapabilitiesValue = Extract<Awaited<ReturnType<IApiClient['teams']['capabilities']>>['result'], { ok: true }>['value']
/** One live, replaceable Team observation; presentation drafts belong elsewhere. */
export interface TeamObservationState<Input, Value> {
  readonly input: Input
  readonly value?: Value | undefined
  readonly loading: boolean
  readonly error?: string | undefined
  readonly disconnected: boolean
}
/** A form keeps its draft separately from this live business observation. */
export type TeamTaskCapabilitiesState = TeamObservationState<TeamTaskCapabilitiesInput, TeamTaskCapabilitiesValue>
/** Selected member kind and one bounded deployment-profile window. */
export type TeamExecutionProfilesInput = Parameters<IApiClient['teams']['executionProfiles']>[0]
/** Public descriptors and current permission observation returned by the Host. */
export type TeamExecutionProfilesValue = Extract<Awaited<ReturnType<IApiClient['teams']['executionProfiles']>>['result'], { ok: true }>['value']
/** Catalog data belongs to the runtime; selected identity and descriptor drafts belong to the form. */
export type TeamExecutionProfilesState = TeamObservationState<TeamExecutionProfilesInput, TeamExecutionProfilesValue>
/** Current visible member identities, without collection traversal. */
export type TeamMemberReadinessInput = Pick<Parameters<IApiClient['teams']['memberReadiness']>[0], 'teamId' | 'participantIds'>
/** Host observation page, before the runtime assembles the selected member set. */
export type TeamMemberReadinessPage = Extract<Awaited<ReturnType<IApiClient['teams']['memberReadiness']>>['result'], { ok: true }>['value']
/** Every member retains the version and time of its own bounded page. */
export type TeamMemberReadinessRecord = TeamMemberReadinessPage['items'][number] & Pick<TeamMemberReadinessPage, 'observationId' | 'observedAt'>
/** Atomic client publication of the requested set; independently observed owners remain versioned per row. */
export interface TeamMemberReadinessValue {
  readonly teamId: TeamId
  readonly teamCursor: number
  readonly items: readonly TeamMemberReadinessRecord[]
}
/** Runtime-owned readiness polling, separate from the member list's cursor and form drafts. */
export type TeamMemberReadinessState = TeamObservationState<TeamMemberReadinessInput, TeamMemberReadinessValue>

/** Literal Host task-title query, independent from any collection page. */
export type TeamTaskQuery = NonNullable<Parameters<IApiClient['teams']['browse']>[0]['query']>
/** One server-filtered task page with revision-bound continuation. */
export type TeamTaskQueryPage = Extract<Extract<Awaited<ReturnType<IApiClient['teams']['browse']>>['result'], { ok: true }>['value'], { kind: 'tasks' }>
/** Business state for one independently paged task query. */
export interface TeamTaskQueryState {
  /** Cursor that produced the retained page; absent for the first page. */
  readonly startCursor?: TeamTaskQueryPage['nextQueryCursor']
  readonly teamId: TeamId
  readonly query: TeamTaskQuery
  readonly page?: TeamTaskQueryPage | undefined
  readonly loading: boolean
  readonly error?: string | undefined
  readonly hasNewer: boolean
  readonly disconnected: boolean
}

/** One selected Team owns each independently loaded collection. */
export interface TeamCollectionsState {
  readonly teamId: TeamId
  readonly members: TeamCollectionPage<TeamMemberSummary>
  readonly tasks: TeamCollectionPage<TeamTaskSummary>
  readonly workflowPlans: TeamCollectionPage<TeamWorkflowSummary>
  /** Provider-owned visible artifact references returned by the bounded artifact read. */
  readonly artifacts: TeamCollectionPage<TeamArtifactList['items'][number]>
}
/** Collection selector accepted by the bounded Team collection reader. */
export type TeamCollectionKind = 'members' | 'tasks' | 'workflowPlans' | 'artifacts'
/** Explicit navigation of one retained collection window. */
export type TeamCollectionReadMode = 'refresh' | 'next' | 'first'
/** Actor-free task inspection data returned by the Host. */
export type TeamTaskInspection = Extract<Awaited<ReturnType<IApiClient['teams']['taskInspect']>>['result'], { ok: true }>['value']
/** Current task fields, independent of retained execution histories. */
export type TeamTaskRecord = Extract<TeamTaskInspection, { section: 'record' }>['task']
/** One public settled attempt from an independently paged history. */
export type TeamTaskAttempt = Extract<TeamTaskInspection, { section: 'attempts' }>['items'][number]
/** One independently loaded part of the selected task inspector. */
export interface TeamTaskDetailPart<T> {
  readonly value?: T | undefined
  readonly loading: boolean
  readonly error?: string | undefined
}
/** The runtime retains one current record, one latest attempt, and one window per history. */
export interface TeamTaskDetailState {
  readonly teamId: TeamId
  readonly taskId: TeamTaskId
  readonly record: TeamTaskDetailPart<Extract<TeamTaskInspection, { section: 'record' }>>
  readonly latest: TeamTaskDetailPart<TeamTaskAttempt>
  readonly attempts: TeamTaskDetailPart<Extract<TeamTaskInspection, { section: 'attempts' }>>
  readonly reviews: TeamTaskDetailPart<Extract<TeamTaskInspection, { section: 'reviews' }>>
  readonly hasNewer: boolean
  readonly disconnected: boolean
}
/** History navigation replaces the retained window rather than accumulating rows. */
export type TeamTaskDetailReadMode = 'refresh' | 'first' | 'next'

/** Bounded, explicitly loaded principal inbox plus its read and display state. */
export interface TeamInboxState {
  readonly connectionGeneration: number
  readonly items: TeamInboxPage['items']
  readonly phase: 'idle' | 'loading' | 'ready' | 'error'
  readonly displayCursor: number
  readonly cursor: number
  readonly nextCursor: number | undefined
  readonly loadingMore: boolean
  readonly acknowledging: boolean
  readonly hasNewer: boolean
  readonly error: RpcError | null
}

/** Current lifecycle of a local unsubmitted or retryable Team task draft. */
export type TeamTaskDraftPhase = 'ready' | 'starting' | 'error'

/** Local-only first-input state before a Team becomes the selected product task. */
export interface TeamTaskDraft {
  /** Retry key that remains stable until start succeeds or the draft is abandoned. */
  readonly idempotencyKey: ChannelPostIdempotencyKey
  /** Explicit coordinator preset carried into the draft's first Team admission. */
  readonly agentPreset?: string
  /** Optional project execution root carried into the draft's first Team admission. */
  readonly cwd?: string
  /** Optional coordinator model route carried into the draft's first Team admission. */
  readonly selection?: ModelSelection
  /** Current local start operation state. */
  readonly phase: TeamTaskDraftPhase
  /** Semantic first-input fingerprint retained after the first admission attempt. */
  readonly fingerprint?: string
  /** Last Host business failure, when the attempt reached the Host. */
  readonly error: RpcError | undefined
  /** Last transport or local failure message, when no Host business result exists. */
  readonly message: string | undefined
}

/** Team list, selected Team identity, and local first-input draft. */
export interface TeamTaskListState {
  /** One explicitly opened workflow inspection. */
  readonly workflowDetail?: TeamWorkflowDetailState | undefined
  /** Cursor that produced the retained Team window; absent before its first read. */
  readonly startCursor?: TeamList['nextCursor'] | -1

  /** Last exact member Session lookup for the current Team; retained for shareable inspection routes. */
  readonly memberSession?: {
    readonly teamId: TeamId
    readonly participantId: Parameters<IApiClient['teams']['memberSession']>[0]['participantId']
    readonly sessionId: SessionId
  } | undefined
  /** Durable Team summaries returned by the Host. */
  readonly items: TeamList['items']
  /** Exclusive continuation cursor for the next unloaded Team page. */
  readonly nextCursor?: TeamList['nextCursor']
  /** Whether an explicit continuation read is pending. */
  readonly loadingMore?: boolean
  /** Current Team product selection. */
  readonly current: TeamId | undefined
  /** Latest authoritative detail for the current Team, published by the runtime owner. */
  readonly selected: TeamTaskSelection | undefined
  /** Current list refresh lifecycle. */
  readonly phase: 'pending' | 'ready'
  /** Latest list refresh state. */
  readonly state: 'idle' | 'loading' | 'error'
  /** Latest list refresh Host error. */
  readonly error: RpcError | null
  /** Local draft that owns the next Team start, when present. */
  readonly draft: TeamTaskDraft | undefined
  /** Principal-wide inbox retained by the browser owner, independent of Team selection. */
  readonly inbox?: TeamInboxState
  /** Independently selected provider bytes, retired on Team or authority replacement. */
  readonly artifactDetail?: TeamArtifactDetailState | undefined
  /** Selected channel's retained records and live observation, independent of the dialog lifetime. */
  readonly channel?: TeamChannelState | undefined
  /** Only channel pages explicitly requested for the selected Team. */
  readonly channels?: TeamChannelListState | undefined
  readonly channelCatalog?: TeamChannelCatalogState | undefined
  /** Independently paged selected-Team collections; full state remains available for authority and fallback. */
  readonly collections?: TeamCollectionsState | undefined
  /** Independently read current task and history windows. */
  readonly taskDetail?: TeamTaskDetailState | undefined
  readonly identities?: TeamIdentityState | undefined
  readonly executionProfiles?: TeamExecutionProfilesState | undefined
  readonly memberReadiness?: TeamMemberReadinessState | undefined
  readonly taskCapabilities?: TeamTaskCapabilitiesState | undefined
  readonly taskQuery?: TeamTaskQueryState | undefined
  readonly attentionPreview?: TeamAttentionState | undefined
  readonly attention?: TeamAttentionState | undefined
  readonly memberDetail?: TeamMemberDetailState | undefined
  readonly actionDetail?: TeamActionDetailState | undefined
  readonly taskReferences?: import('../teams/task-references.ts').TaskReferencesState | undefined
  readonly dependencyQuery?: TeamTaskQueryState | undefined
  /** Pending action previews derived only from the current principal inbox page. */
  readonly pendingHumanActions?: readonly TeamHumanAction[]
}

/** One pending human action projected from a Team-bound host interaction frame. */
export type TeamHumanAction =
  | {
    readonly kind: 'approval'
    readonly requestId: string
    readonly sessionId: SessionId
    readonly teamId: TeamId
    readonly approvalId: Extract<MuxFrame, { type: 'approval/requested' }>['approvalId']
    readonly toolName: string
    readonly callId?: string
    readonly reason?: string
    readonly participantId?: string
    readonly taskId?: string
  }
  | {
    readonly kind: 'question'
    readonly requestId: string
    readonly sessionId: SessionId
    readonly teamId: TeamId
    readonly questionRpcId: string
    readonly questions: Extract<MuxFrame, { type: 'question/requested' }>['questions']
    readonly participantId?: string
    readonly taskId?: string
  }

/** Trusted first input submitted from a local Team task draft. */
export interface TeamTaskStartInput {
  /** Nonempty text used as both the durable objective and first human message. */
  readonly text: string
  /** Optional local execution root for the coordinator Session. */
  readonly cwd?: string
  /** Optional coordinator Agent preset. */
  readonly agentPreset?: string
  /** Optional coordinator model route selected before the Team was admitted. */
  readonly selection?: ModelSelection
}

/** Optional local choices retained before the first Team admission. */
export interface TeamTaskDraftOptions {
  /** Explicit coordinator preset for the Team created from this draft. */
  readonly agentPreset?: string
  /** Explicit project execution root for the Team created from this draft. */
  readonly cwd?: string
  /** Explicit coordinator model route for the Team created from this draft. */
  readonly selection?: ModelSelection
}

/** Selected Team data; coordinator-free Teams remain inspectable through member-owned Sessions. */
export interface TeamTaskSelection {
  /** Selected durable Team identity. */
  readonly teamId: TeamId
  /** Complete Team projection used by Team product consumers. */
  readonly state: TeamSelectionView
  /** Coordinator transcript, absent when the Team has no currently bound coordinator. */
  readonly coordinatorSessionId?: SessionId | undefined
}

/** Browser Team-task state and Host operations. */
export interface ITeamTasks {
  /** Read a runtime-owned bounded member page without activating execution.
   * @param teamId - Selected Team.
   * @param participantId - Exact member.
   * @param mode - First, current or next capability page.
   * @returns completion after the read settles; failures remain in memberDetail.
   */
  readMemberDetail?(teamId: TeamId, participantId: ParticipantId, mode?: 'first' | 'refresh' | 'next'): Promise<void>
  /** Release selected member data and cancel outstanding reads. */
  closeMemberDetail?(): void

  /** Resolve the current coordinator without a historical route cache.
   * @param sessionId - Target Session.
   * @param owner - Header ownership, or the currently selected coordinator when omitted.
   * @param signal - Optional cancellation for the bounded read.
   * @returns the current route, or undefined for another member or a standalone Session.
   */
  resolveCoordinatorSession(sessionId: SessionId, owner?: Parameters<IApiClient['teams']['memberSession']>[0],
    signal?: AbortSignal): Promise<Pick<TeamTaskSelection, 'teamId' | 'coordinatorSessionId'> | undefined>

  /** Read one workflow page without expanding complete plans.
   * @param teamId - Current Team.
   * @param planId - Exact workflow plan.
   * @param mode - Open, refresh, first or next page.
   * @returns completion after the bounded read settles.
   */
  readWorkflowDetail?(teamId: TeamId, planId: TeamWorkflowSummary['id'], mode?: TeamWorkflowDetailReadMode): Promise<void>
  /** Close workflow inspection and retire any pending read. */
  closeWorkflowDetail?(): void


  /** Observable Team product state for Team-aware navigation and composition. */
  readonly list: ObservableSnapshot<TeamTaskListState>
  /**
   * Start a fresh local Team task draft without creating a Team or Session.
   * @param options - optional coordinator choices retained until the first admission.
   */
  startDraft(options?: TeamTaskDraftOptions): void
  /** Update local choices on the current draft without creating a Team. */
  updateDraft(options: TeamTaskDraftOptions): void
  /** Drop the local Team task draft without mutating a durable Team. */
  abandonDraft(): void
  /**
   * Refresh the retained Team page or explicitly return to the beginning.
   * @param firstPage - Reset discovery to its first page.
   * @returns completion after the current single-flight refresh settles.
   */
  refresh(firstPage?: boolean): Promise<void>
  /** Load one further Team page after an explicit user request. */
  loadMore?(): Promise<void>
  /** Start a bounded live Team-list refresh loop; the returned disposer is local-only. */
  watch?(intervalMs?: number): () => void
  /**
   * Select a durable Team and resume an offline coordinator through the legacy explicit open route.
   * @param teamId - durable Team identity to open.
   * @param signal - optional cancellation for the Host read.
   * @returns selected Team state with its required coordinator transcript; coordinator-free inspection uses inspect().
   */
  open(teamId: TeamId, signal?: AbortSignal): Promise<TeamTaskSelection & { readonly coordinatorSessionId: SessionId }>
  /** Select durable Team state for descendant inspection without resuming an offline activation. */
  inspect?(teamId: TeamId, signal?: AbortSignal): Promise<TeamTaskSelection>
  /**
   * Archive one terminal Team and remove it from the default browser list.
   * @param teamId - durable Team identity to archive.
   * @param signal - optional cancellation for the Host write.
   * @returns the archived Team state.
   */
  archive(teamId: TeamId, signal?: AbortSignal): Promise<TeamStateSnapshot>
  /** Request cancellation through the Host control plane and return the durable phase. */
  cancel(teamId: TeamId, signal?: AbortSignal): Promise<TeamSnapshot['phase']>
  /** Cancel one assigned or running Team task through its revision fence. */
  cancelTask?(
    teamId: TeamId, taskId: TeamTaskId, expectedRevision: number, reason?: string, signal?: AbortSignal,
  ): Promise<TeamTaskSnapshot>
  /** Delete one lease-free Team task through its revision fence. */
  deleteTask?(teamId: TeamId, taskId: TeamTaskId, expectedRevision: number, signal?: AbortSignal): Promise<TeamTaskSnapshot>
  /** Re-attach a Team whose coordinator activation is offline or stalled. */
  resume(teamId: TeamId, signal?: AbortSignal): Promise<TeamTaskSelection & { readonly coordinatorSessionId: SessionId }>
  /** Post human content to the selected Team channel instead of bypassing the Hub through Session.prompt. */
  postInput(teamId: TeamId, content: readonly Record<string, unknown>[], delivery?: 'context' | 'turn' | 'steer', signal?: AbortSignal): Promise<void>
  /** Read an initial unread or historical inbox page, preserving prior content on failure. */
  refreshInbox?(history?: boolean, signal?: AbortSignal): Promise<void>
  /** Explicitly read the retained inbox suffix after a compacted-cursor error, preserving prior content on failure. */
  recoverInbox?(signal?: AbortSignal): Promise<void>
  /** Read one explicit continuation page without filtering another Team's unseen deliveries. */
  loadMoreInbox?(signal?: AbortSignal): Promise<void>
  /** Wait for one newer page and flag available content without silently extending the displayed range. */
  watchInbox?(signal: AbortSignal): Promise<TeamInboxPage>
  /** Mark only the last loaded principal-inbox sequence as displayed through the Host. */
  acknowledgeInbox?(signal?: AbortSignal): Promise<void>
  /** Read the current action before offering controls for an append-only historical inbox revision. */
  readAction?(teamId: TeamId, actionId: TeamActionResponseInput['actionId'], signal?: AbortSignal): Promise<TeamActionResponseResult['action']>
  /**
   * Answer an exact durable action; accepted means answer admission, not tool completion.
   * @param teamId - Team owning the action.
   * @param input - action revision, stable retry key, and complete typed answer.
   * @param signal - optional cancellation of the local request.
   * @returns durable acceptance or explicit continuation unavailability.
   */
  respondAction?(teamId: TeamId, input: Omit<TeamActionResponseInput, 'teamId'>, signal?: AbortSignal): Promise<TeamActionResponseResult>
  /**
   * Apply a cursor-fenced member or channel action and refresh the authoritative Team projection.
   * @param teamId - Team owning the management surface.
   * @param command - operation and its exact Host input, without a caller-selected Team identity.
   * @param signal - cancellation of the local request; accepted writes may still commit.
   * @returns completion after the mutation response and selected-Team refresh.
   */
  manage?(teamId: TeamId, command: TeamManagementCommand, signal?: AbortSignal): Promise<void>
  /** Read one bounded authoritative Team audit page for the detail view. */
  readAudit?(
    teamId: TeamId,
    options?: { channelId?: ChannelId; afterCursor?: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<TeamAuditList>
  /** Read one bounded authoritative channel WAL suffix for the detail view. */
  readChannel?(channelId: ChannelId, afterCursor?: number, signal?: AbortSignal): Promise<ChannelReadPageResult>
  /** Accept the displayed principal invitation with its exact revision, manifest and retained retry key. */
  acknowledgeChannel?(channelId: ChannelId): Promise<void>
  /** End channel inspection and abort its read/watch operations. */
  closeChannelView?(): void
  /** Refresh the explicit channel-list window; continuation loads exactly one additional provider page. */
  readChannels?(teamId: TeamId, mode?: TeamCollectionReadMode): Promise<void>
  /** Read bytes only through an exact saved Envelope reference. */
  readChannelAttachment?(input: TeamChannelAttachmentInput, signal?: AbortSignal): Promise<TeamChannelAttachmentResult>
  /** Refresh the active registration catalog before opening a channel. */
  readChannelCatalog?(): Promise<void>
  /** Read one visible artifact into the runtime's exact byte window.
   * @param teamId - Selected owning Team.
   * @param artifactId - Exact provider reference.
   * @param signal - Caller read cancellation.
   * @returns settlement after publishing authorized content or its read state.
   */
  readArtifact?(teamId: TeamId, artifactId: string, signal?: AbortSignal): Promise<void>
  /** Dismiss the selected artifact and cancel its byte read. */
  closeArtifactDetail?(): void
  /** Read the dependency editor's independent task query; rejected continuation preserves the prior page. */
  watchMemberReadiness?(input: TeamMemberReadinessInput, intervalMs: number): () => void
  /** Recheck the currently observed member set. */
  refreshMemberReadiness?(): Promise<void>
  /** Observe only referenced member names with explicit polling and cache limits. */
  watchIdentities?(teamId: TeamId, ids: readonly ParticipantId[], options: TeamIdentityOptions): () => void
  /** Retry the current identity references without changing navigation. */
  refreshIdentities?(): Promise<void>
  /** Observe one member-registration catalog window. */
  watchExecutionProfiles?(input: TeamExecutionProfilesInput, intervalMs: number): () => void
  /** Retry the current deployment-profile window. */
  refreshExecutionProfiles?(): Promise<void>
  /** Observe the current form's authoring capabilities. */
  watchTaskCapabilities?(input: TeamTaskCapabilitiesInput, intervalMs: number): () => void
  /** Retry the current form's capability observation. */
  refreshTaskCapabilities?(): Promise<void>
  /** Read the main table's server-filtered task page independently of dependency candidates. */
  readTaskQuery?(teamId: TeamId, query: Pick<TeamTaskQuery, 'search' | 'phase'>, mode?: 'first' | 'next'): Promise<void>
  /** Cancel table requests when its view closes while retaining its current page. */
  pauseTaskQuery?(): void
  /** Observe the Team overview's independent bounded pending preview.
   * @param teamId - Currently selected Team.
   * @param options - UI-resolved row allowance and refresh interval.
   * @returns disposer which stops this preview without changing full-list pagination.
   */
  watchAttention?(teamId: TeamId, options: { readonly limit: number; readonly refreshMs: number }): () => void
  /** Read the first pending page or its exact continuation.
   * @param teamId - Currently selected Team.
   * @param limit - UI-resolved page allowance, bounded again by the Host.
   * @param mode - Refresh from the beginning or advance the current page.
   */
  readAttention?(teamId: TeamId, limit: number, mode?: 'first' | 'next'): Promise<void>
  /** Stop current pending-list reads while preserving the visible page. */
  pauseAttention?(): void
  /** Refresh the current overview preview without changing full-list pagination. */
  refreshAttentionPreview?(): Promise<void>
  /** Inspect one retained human request without admitting an answer.
   * @param teamId - Currently selected Team.
   * @param actionId - Exact retained request identity.
   * @returns the current inspection, or undefined when it cannot be admitted.
   */
  inspectAction?(teamId: TeamId, actionId: TeamActionResponseInput['actionId']): Promise<import('@clocky/clocky-client-connection/client').TeamActionInspection | undefined>
  /** Stop request-body IO and release its server-owned inspection. */
  closeActionDetail?(): void
  /** Query original task-update admission without resending the operation.
   * @param input - Exact Team/task/command identity from the retained draft.
   * @param signal - Current form request cancellation.
   * @returns immutable original admission or absence at this read; scope replacement withholds the result.
   */
  lookupTaskUpdate?(input: import('@clocky/clocky-client-connection/client').TeamTaskUpdateLookupInput, signal?: AbortSignal): Promise<import('@clocky/clocky-client-connection/client').TeamTaskUpdateLookup>
  /** Observe exact selected/current dependency facts separately from candidate pagination.
   * @param teamId - Selected Team.
   * @param taskIds - Current and drafted dependency IDs.
   * @param options - Validated consumer resource limits.
   * @returns disposer for this form's observation.
   */
  watchTaskReferences?(teamId: TeamId, taskIds: readonly TeamTaskId[], options: import('../teams/task-references.ts').TaskReferencesOptions): () => void
  /** Explicitly refresh the current exact dependency set. */
  refreshTaskReferences?(): Promise<void>
  /** Read dependency candidates independently from the main task collection. */
  readDependencies?(teamId: TeamId, query: TeamTaskQuery, mode?: 'first' | 'next'): Promise<void>
  /** Cancel dependency reads without changing an editor's draft. */
  closeDependencies?(): void
  /** Read one selected collection window. */
  readCollections?(teamId: TeamId, collection: TeamCollectionKind, mode?: TeamCollectionReadMode, signal?: AbortSignal): Promise<void>
  /** Read the selected task record or replace one revision-pinned history window. */
  readTaskDetail?(teamId: TeamId, taskId: TeamTaskId, section?: 'record' | 'attempts' | 'reviews', mode?: TeamTaskDetailReadMode): Promise<void>
  /** Close the selected task read and release its bounded data. */
  closeTaskDetail?(): void
  /** Resolve a Participant's descendant Session without deriving Team state from transcript rows. */
  participantSession?(teamId: TeamId, participantId: ParticipantId, signal?: AbortSignal): Promise<SessionId>
  /**
   * Create a Team and admit its first human text through the retry-safe Team start operation.
   * @param input - local draft input and optional coordinator choices.
   * @param signal - optional cancellation for the Host operation.
   * @returns selected Team state plus its coordinator transcript identity.
   */
  start(input: TeamTaskStartInput, signal?: AbortSignal): Promise<TeamTaskSelection & { readonly coordinatorSessionId: SessionId }>
}
