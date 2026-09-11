/** Browser Team-task product state and operations. */

import type {
  ChannelId, ChannelPostIdempotencyKey, ChannelReadPageResult, IApiClient, MuxFrame, ParticipantId, RpcError, SessionId,
  TeamArtifactList, TeamArtifactReadResult, TeamAuditList, ModelSelection, TeamMemberList, TeamTaskList, TeamWorkflowPlanList,
  TeamId, TeamSnapshot, TeamStateSnapshot, TeamTaskId, TeamTaskSnapshot,
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
  readonly items: readonly T[]
  readonly nextCursor?: number | undefined
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly hasNewer: boolean
  readonly error?: string | undefined
}

/** Independently bounded member, task, workflow-plan, and artifact projections for one selected Team. */
export interface TeamCollectionsState {
  readonly teamId: TeamId
  readonly members: TeamCollectionPage<TeamMemberList['items'][number]>
  readonly tasks: TeamCollectionPage<TeamTaskList['items'][number]>
  readonly workflowPlans: TeamCollectionPage<TeamWorkflowPlanList['items'][number]>
  /** Provider-owned visible artifact references returned by the bounded artifact read. */
  readonly artifacts: TeamCollectionPage<TeamArtifactList['items'][number]>
}
/** Collection selector accepted by the bounded Team collection reader. */
export type TeamCollectionKind = 'members' | 'tasks' | 'workflowPlans' | 'artifacts'
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
  /** Durable Team summaries returned by the Host. */
  readonly items: readonly TeamSnapshot[]
  /** Exclusive continuation cursor for the next unloaded Team page. */
  readonly nextCursor?: number | undefined
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
  /** Selected channel's retained records and live observation, independent of the dialog lifetime. */
  readonly channel?: TeamChannelState | undefined
  /** Only channel pages explicitly requested for the selected Team. */
  readonly channels?: TeamChannelListState | undefined
  readonly channelCatalog?: TeamChannelCatalogState | undefined
  /** Independently paged selected-Team collections; full state remains available for authority and fallback. */
  readonly collections?: TeamCollectionsState | undefined
  /** Host-owned approval/question requests carrying Team provenance. */
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

/** Selected Team state plus the Session transcript owned by its coordinator Participant. */
export interface TeamTaskSelection {
  /** Selected durable Team identity. */
  readonly teamId: TeamId
  /** Complete Team projection used by Team product consumers. */
  readonly state: TeamStateSnapshot
  /** Local coordinator transcript selected only as a Participant descendant. */
  readonly coordinatorSessionId: SessionId
}

/** Browser Team-task state and Host operations. */
export interface ITeamTasks {
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
   * Refresh durable Team summaries from the Host.
   * @returns completion after the current single-flight refresh settles.
   */
  refresh(): Promise<void>
  /** Load one further Team page after an explicit user request. */
  loadMore?(): Promise<void>
  /** Start a bounded live Team-list refresh loop; the returned disposer is local-only. */
  watch?(intervalMs?: number): () => void
  /**
   * Select a durable Team and resolve its coordinator transcript.
   * @param teamId - durable Team identity to open.
   * @param signal - optional cancellation for the Host read.
   * @returns selected Team state plus its coordinator transcript identity.
   */
  open(teamId: TeamId, signal?: AbortSignal): Promise<TeamTaskSelection>
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
  resume(teamId: TeamId, signal?: AbortSignal): Promise<TeamTaskSelection>
  /** Post human content to the selected Team channel instead of bypassing the Hub through Session.prompt. */
  postInput(teamId: TeamId, content: readonly Record<string, unknown>[], delivery?: 'context' | 'turn' | 'steer', signal?: AbortSignal): Promise<void>
  /** Read an initial unread or historical inbox page, preserving prior content on failure. */
  refreshInbox?(history?: boolean, signal?: AbortSignal): Promise<void>
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
  readChannels?(teamId: TeamId, more?: boolean): Promise<void>
  /** Read bytes only through an exact saved Envelope reference. */
  readChannelAttachment?(input: TeamChannelAttachmentInput, signal?: AbortSignal): Promise<TeamChannelAttachmentResult>
  /** Refresh the active registration catalog before opening a channel. */
  readChannelCatalog?(): Promise<void>
  /** Read and verify one visible Team artifact's bytes for the detail view. */
  readArtifact?(teamId: TeamId, artifactId: string, signal?: AbortSignal): Promise<TeamArtifactReadResult>
  /** Read a bounded collection page; failure preserves rows and newer markers, and cancellation clears loading without an error. */
  readCollections?(teamId: TeamId, collection: TeamCollectionKind, more?: boolean, signal?: AbortSignal): Promise<void>
  /** Resolve a Participant's descendant Session without deriving Team state from transcript rows. */
  participantSession?(teamId: TeamId, participantId: ParticipantId, signal?: AbortSignal): Promise<SessionId>
  /**
   * Create a Team and admit its first human text through the retry-safe Team start operation.
   * @param input - local draft input and optional coordinator choices.
   * @param signal - optional cancellation for the Host operation.
   * @returns selected Team state plus its coordinator transcript identity.
   */
  start(input: TeamTaskStartInput, signal?: AbortSignal): Promise<TeamTaskSelection>
}
