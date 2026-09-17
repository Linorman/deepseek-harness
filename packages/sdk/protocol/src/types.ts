import type { TeamMemberInspection } from '@clocky/clocky-team'
import type { TeamWorkflowInspectRequest, TeamWorkflowInspection } from '@clocky/clocky-team'
import type { TeamHumanActionSnapshot } from '@clocky/clocky-team'
import type { TeamTaskInspectionSelection, TeamTaskInspection } from '@clocky/clocky-team'
import type { TeamBrowseKind, TeamBrowsePage } from '@clocky/clocky-team'
import type { TeamMemberSessionSnapshot } from '@clocky/clocky-team'
import type { EncodedImageAttachment, ImageAttachmentRef } from '@clocky/clocky-attachment'
import type { TeamHumanActionAnswer, TeamHumanActionResponseResult } from '@clocky/clocky-team'
import type { TeamHumanInboxReadInput, TeamHumanInboxPage, TeamHumanInboxAcknowledgeInput, TeamHumanInboxAcknowledgement } from '@clocky/clocky-team'
/**
 * Named wire types for Clocky SDK runtime protocol: request/result pairs and
 * server-to-client notification payloads
 * exchanged over the newline-delimited JSON-RPC stdio transport. The server
 * plugin (`@clocky/clocky-sdk-jsonrpc-server`) and SDK clients share these shapes;
 * `serverInfo.name` stays the wire-stable `clocky-sdk-runtime`.
 *
 * @module @clocky/clocky-sdk-protocol/types
 */

import type { ContentBlock } from '@clocky/clocky-llm'
import type { SessionEvent } from '@clocky/clocky-session'
import type {
  ChannelParticipant,
  ChannelHumanInvitationSnapshot,
  ChannelHumanAdmissionSnapshot,
  TeamChannelListPage,
  ChannelReadPageResult,
  ChannelSnapshot,
  ChannelWatchResult,
  EnvelopeDelivery,
  EnvelopePriority,
  JsonObject,
  ParticipantInterruptSnapshot,
  ParticipantKind,
  ParticipantSnapshot,
  TeamAdapterRef,
  TeamAuditEntry,
  TeamArtifactReference,
  TeamEnvelope,
  TeamEvent,
  ChannelEvent,
  TeamGoalBlocker,
  TeamGoalPhase,
  TeamQuiescenceSnapshot,
  TeamMetricsSnapshot,
  TeamPhase,
  TeamSnapshot,
  TeamStateSnapshot,
  TeamSelectionSnapshot,
  TeamTaskReviewPolicy,
  TeamTaskIntegrationSpec,
  TeamTaskSnapshot,
  TeamTaskWorkspaceMode,
  TeamWorkflowPlanSnapshot,
  TeamWatchResult,
} from '@clocky/clocky-team'

/** Actor-free human response whose opaque wire ids are validated by the runtime. */
export interface TeamInboxRespondParams {
  readonly teamId: string
  readonly actionId: string
  readonly expectedUpdatedAt: number
  readonly idempotencyKey: string
  readonly answer: TeamHumanActionAnswer
}

/** Empty request for a durable Team summary listing. */
export interface TeamListParams {
  readonly afterCursor?: string | -1 | undefined
  readonly limit?: number | undefined
}

/** Durable Team summaries visible to an SDK client. */
export interface TeamListResult {
  readonly scanned: number
  readonly items: readonly TeamSnapshot[]
  readonly nextCursor?: string | undefined
}

/** Request one complete durable Team projection. */
export interface TeamGetParams {
  readonly teamId: string
}

/** Bounded selection with optional exact scalar metadata under the same byte allowance. */
export interface TeamSelectionParams extends TeamGetParams {
  readonly includeMetadata?: boolean | undefined
}

/** Complete durable Team state returned by the SDK runtime. */
export interface TeamGetResult {
  readonly state: TeamStateSnapshot
}

/** Current task fields or revision-pinned attempt/review history. */
export type TeamTaskInspectParams = TeamTaskInspectionSelection & {
  readonly teamId: string
  readonly taskId: string
  readonly expectedRevision?: number | undefined
}
/** Bounded task inspection from the runtime. */
export interface TeamTaskInspectResult { readonly inspection: TeamTaskInspection }

/** Exact member and optional cursor-pinned capability page. */
export interface TeamMemberInspectParams {
  readonly teamId: string
  readonly participantId: string
  readonly afterCursor?: number | undefined
  readonly limit?: number | undefined
  readonly expectedTeamCursor?: number | undefined
}
/** Bounded member detail, never a complete Team state. */
export interface TeamMemberInspectResult { readonly detail: TeamMemberInspection }

/** Collection summary read with optional provider-order continuation. */
export interface TeamBrowseParams {
  readonly teamId: string
  readonly kind: TeamBrowseKind
  readonly afterCursor?: number | undefined
  readonly limit?: number | undefined
}
/** Byte-bounded summaries, never complete execution records. */
export interface TeamBrowseResult { readonly page: TeamBrowsePage }

/** Exact Team/member lookup for a published Session binding. */
export interface TeamMemberSessionParams {
  readonly teamId: string
  readonly participantId: string
}
/** Published binding for member transcript inspection; does not activate the member. */
export interface TeamMemberSessionResult {
  readonly binding: TeamMemberSessionSnapshot
}

/** Bounded first-selection result without roster or history collections. */
export interface TeamSelectionResult {
  readonly selection: TeamSelectionSnapshot
}

/** Replace one Team objective and/or goal-specific budget through authenticated human authority. */
export interface TeamGoalUpdateParams {
  readonly teamId: string
  readonly expectedRevision: number
  readonly objective?: string
  readonly budgets?: JsonObject
}
/** Wire declaration for TeamGoalUpdateResult. */
export interface TeamGoalUpdateResult { readonly state: TeamStateSnapshot }
/** Transition one Team objective lifecycle through authenticated human authority. */
export interface TeamGoalTransitionParams {
  readonly teamId: string
  readonly expectedRevision: number
  readonly phase: TeamGoalPhase
  readonly blocker?: TeamGoalBlocker
}
/** Wire declaration for TeamGoalTransitionResult. */
export interface TeamGoalTransitionResult { readonly state: TeamStateSnapshot }

/** Read-only quiescence diagnostics for one Team. */
export interface TeamQuiescenceParams { readonly teamId: string }
/** Wire declaration for TeamQuiescenceResult. */
export interface TeamQuiescenceResult { readonly value: TeamQuiescenceSnapshot }
/** Process-local Team operational counters used by dashboards and alerts. */
export type TeamMetricsParams = Record<string, never>
/** Wire declaration for TeamMetricsResult. */
export type TeamMetricsResult = TeamMetricsSnapshot
/** Read-only Team-journal or channel-WAL audit page. */
export interface TeamAuditReadParams {
  readonly teamId: string
  readonly channelId?: string
  readonly afterCursor?: number
  readonly limit?: number
}
/** Wire declaration for TeamAuditReadResult. */
export interface TeamAuditReadResult {
  readonly teamId: string
  readonly channelId?: string
  readonly firstCursor?: number
  readonly items: readonly TeamAuditEntry[]
  readonly nextCursor?: number
}
/** Request one visible Team artifact by its durable reference id. */
export interface TeamArtifactReadParams {
  readonly teamId: string
  readonly artifactId: string
}
/** Verified artifact bytes returned by the SDK runtime as canonical base64. */
export interface TeamArtifactReadResult {
  readonly artifact: TeamArtifactReference
  readonly bytes: number
  readonly data: string
}
/** Request one bounded page of visible Team artifact references. */
export interface TeamArtifactListParams {
  readonly teamId: string
  readonly afterCursor?: number | undefined
  readonly limit?: number | undefined
}
/** Visible artifact references in provider order. */
export interface TeamArtifactListResult {
  readonly items: readonly TeamArtifactReference[]
  readonly nextCursor?: number | undefined
}

/** Request the durable participant roster for one Team. */
export interface TeamMemberListParams {
  readonly teamId: string
  readonly afterCursor?: number | undefined
  readonly limit?: number | undefined
}
/** Durable participant descriptors and derived lifecycle state. */
export interface TeamMemberListResult {
  readonly items: readonly ParticipantSnapshot[]
  readonly nextCursor?: number | undefined
}
/** Invite one Team participant with explicit descriptor claims. */
export interface TeamMemberInviteParams {
  readonly teamId: string
  readonly expectedCursor: number
  readonly kind: Exclude<ParticipantKind, 'human'>
  readonly displayName: string
  readonly role: string
  readonly capabilities: string[]
  readonly provider?: string
  readonly preset?: string
  readonly model?: string
  readonly authScheme?: string
}
/** Wire declaration for TeamMemberInviteResult. */
export interface TeamMemberInviteResult { readonly value: ParticipantSnapshot }
/** Activate, remove, or interrupt one Team participant. */
export interface TeamMemberActivateParams { readonly teamId: string; readonly participantId: string; readonly expectedCursor: number }
/** Wire declaration for TeamMemberActivateResult. */
export interface TeamMemberActivateResult { readonly value: ParticipantSnapshot }
/** Wire declaration for TeamMemberRemoveParams. */
export interface TeamMemberRemoveParams { readonly teamId: string; readonly participantId: string; readonly expectedCursor: number }
/** Wire declaration for TeamMemberRemoveResult. */
export interface TeamMemberRemoveResult { readonly value: ParticipantSnapshot }
/** Wire declaration for TeamMemberInterruptParams. */
export interface TeamMemberInterruptParams { readonly teamId: string; readonly participantId: string; readonly expectedCursor: number }
/** Wire declaration for TeamMemberInterruptResult. */
export interface TeamMemberInterruptResult { readonly value: ParticipantInterruptSnapshot }
/** Request a bounded channel WAL suffix. */
export interface TeamChannelReadParams {
  readonly channelId: string
  readonly afterCursor?: number | undefined
  readonly limit?: number | undefined
}
/** Channel projection, records, and optional view policy output. */
export interface TeamChannelReadResult { readonly value: ChannelReadPageResult }
/** Actor-free selection of attached channels by stable insertion index. */
export interface TeamChannelListParams {
  readonly teamId: string
  readonly afterCursor?: number | undefined
  readonly limit?: number | undefined
}
/** Bounded attached-channel projections without message history. */
export type TeamChannelListResult = TeamChannelListPage

/** Authenticated discovery requires no Team selection. */
export type TeamChannelCatalogParams = Record<string, never>
/** Registered protocols, view policies and optional summary bounds. */
export type TeamChannelCatalogResult = import('@clocky/clocky-team').TeamChannelCatalog
/** Actor-free bounded summary selection. */
export interface TeamChannelSummarizeParams {
  readonly channelId: string
  readonly expectedCursor: number
  readonly coveredSequenceRange: { readonly from: number; readonly to: number }
  readonly idempotencyKey: string
}
/** Durable summary and its exact source provenance. */
export interface TeamChannelSummarizeResult { readonly value: import('@clocky/clocky-team').ChannelSummaryRecord }

/** Authenticated Team member selection for channel admission metadata. */
export interface TeamChannelAdmissionParams { readonly teamId: string; readonly channelId: string }
/** Immutable manifest and endpoint admission state without message delivery. */
export interface TeamChannelAdmissionResult { readonly value: ChannelHumanAdmissionSnapshot }

/** Actor-free selection of the authenticated human invitation. */
export interface TeamChannelInvitationParams { readonly channelId: string }
/** Explicit acceptance of an exact manifest and invitation revision. */
export interface TeamChannelInvitationAcknowledgeParams extends TeamChannelInvitationParams {
  readonly revision: number
  readonly manifestFingerprint: string
  readonly idempotencyKey: string
}
/** Only the current principal's invitation and complete manifest. */
export interface TeamChannelInvitationResult { readonly value: ChannelHumanInvitationSnapshot }

/** Open one versioned Team channel. */
export interface TeamChannelOpenParams {
  readonly teamId: string
  readonly expectedCursor: number
  readonly adapter: TeamAdapterRef
  readonly viewPolicy?: { readonly type: string; readonly version: number }
  readonly participants: ChannelParticipant[]
  readonly limits: JsonObject
}
/** Wire declaration for TeamChannelOpenResult. */
export interface TeamChannelOpenResult { readonly value: ChannelSnapshot }
/** Post, close, or watch one Team channel. */
export interface TeamChannelPostParams {
  readonly channelId: string
  readonly expectedCursor: number
  readonly audience: readonly string[] | null
  readonly kind: string
  readonly payload: JsonObject
  readonly delivery: EnvelopeDelivery
  readonly priority?: EnvelopePriority
  readonly idempotencyKey?: string
  readonly causationId?: string
  readonly correlationId?: string
  readonly taskId?: string
  readonly traceId?: string
  readonly ttlMs?: number
}
/** Ordered media for a direct channel, or one text block for a consult or discussion turn. */
export type TeamChannelInputContent = { readonly type: 'text'; readonly text: string }
  | (EncodedImageAttachment & { readonly type: 'image' })
/** Actor-free media input; durable image references are resolved by the server. */
export interface TeamChannelInputParams extends Omit<TeamChannelPostParams, 'kind' | 'payload'> {
  readonly content: readonly TeamChannelInputContent[]
}
/** Exact authorized Envelope from which one attachment may be read. */
export interface TeamChannelAttachmentParams {
  readonly teamId: string
  readonly channelId: string
  readonly envelopeId: string
  readonly envelopeSequence: number
  readonly attachmentId: string
}
/** Verified image bytes and the durable reference retained by the selected Envelope. */
export interface TeamChannelAttachmentResult { readonly attachment: ImageAttachmentRef; readonly data: string }

/** Wire declaration for TeamChannelPostResult. */
export interface TeamChannelPostResult { readonly value: TeamEnvelope }
/** Wire declaration for TeamChannelCloseParams. */
export interface TeamChannelCloseParams { readonly channelId: string; readonly expectedCursor: number; readonly reason?: string }
/** Wire declaration for TeamChannelCloseResult. */
export interface TeamChannelCloseResult { readonly value: ChannelSnapshot }
/** Wire declaration for TeamChannelWatchParams. */
export interface TeamChannelWatchParams { readonly channelId: string; readonly afterCursor?: number | undefined }
/** Wire declaration for TeamChannelWatchResult. */
export interface TeamChannelWatchResult { readonly value: ChannelWatchResult }
/** Request all durable tasks in one Team. */
export interface TeamTaskListParams {
  readonly teamId: string
  readonly afterCursor?: number | undefined
  readonly limit?: number | undefined
}
/** Durable task projections including tombstones. */
export interface TeamTaskListResult {
  readonly items: readonly TeamTaskSnapshot[]
  readonly nextCursor?: number | undefined
}
/** Request one bounded page of durable workflow plans in admission order. */
export interface TeamWorkflowPlanListParams {
  readonly teamId: string
  readonly afterCursor?: number | undefined
  readonly limit?: number | undefined
}
/** Durable workflow plan projections returned to an SDK client. */
export interface TeamWorkflowPlanListResult {
  readonly items: readonly TeamWorkflowPlanSnapshot[]
  readonly nextCursor?: number | undefined
}
/** Create or mutate one durable Team task. */
export interface TeamTaskCreateParams {
  readonly teamId: string
  readonly expectedCursor: number
  readonly idempotencyKey: string
  readonly parentTaskId?: string
  readonly subject: string
  readonly description: string
  readonly integration?: TeamTaskIntegrationSpec
  readonly blockedBy: readonly string[]
  readonly requiredCapabilities: readonly string[]
  readonly priority: number
  readonly readScopes: readonly string[]
  readonly writeScopes: readonly string[]
  readonly workspaceMode: TeamTaskWorkspaceMode
  readonly budget: JsonObject
  readonly reviewPolicy: TeamTaskReviewPolicy
  readonly maxAttempts: number
}
/** Wire declaration for TeamTaskCreateResult. */
export interface TeamTaskCreateResult { readonly value: TeamTaskSnapshot }
/** Wire declaration for TeamTaskGetParams. */
export interface TeamTaskGetParams { readonly teamId: string; readonly taskId: string }
/** Wire declaration for TeamTaskGetResult. */
export interface TeamTaskGetResult { readonly value: TeamTaskSnapshot }
/** Wire declaration for TeamTaskUpdateParams. */
export interface TeamTaskUpdateParams {
  readonly teamId: string
  readonly taskId: string
  readonly expectedRevision: number
  readonly subject?: string
  readonly description?: string
  readonly blockedBy?: readonly string[]
}
/** Wire declaration for TeamTaskUpdateResult. */
export interface TeamTaskUpdateResult { readonly value: TeamTaskSnapshot }
/** Wire declaration for TeamTaskCancelParams. */
export interface TeamTaskCancelParams {
  readonly teamId: string
  readonly taskId: string
  readonly expectedRevision: number
  /** Optional explanation bound to the authenticated cancellation intent. */
  readonly reason?: string
}
/** Wire declaration for TeamTaskCancelResult. */
export interface TeamTaskCancelResult { readonly value: TeamTaskSnapshot }
/** Wire declaration for TeamTaskDeleteParams. */
export interface TeamTaskDeleteParams { readonly teamId: string; readonly taskId: string; readonly expectedRevision: number }
/** Wire declaration for TeamTaskDeleteResult. */
export interface TeamTaskDeleteResult { readonly value: TeamTaskSnapshot }
/** Wire declaration for TeamTaskReviewParams. */
export interface TeamTaskReviewParams {
  readonly teamId: string
  readonly taskId: string
  readonly expectedRevision: number
  readonly decision: 'accepted' | 'rework'
  readonly reason: string
}
/** Wire declaration for TeamTaskReviewResult. */
export interface TeamTaskReviewResult { readonly value: TeamTaskSnapshot }
/** Wire declaration for TeamTaskWatchParams. */
export interface TeamTaskWatchParams { readonly teamId: string; readonly afterCursor?: number }
/** Wire declaration for TeamTaskWatchResult. */
export interface TeamTaskWatchResult { readonly value: TeamWatchResult }

/** Parameters for the process-wide SDK handshake. */
export interface InitializeParams {
  /** Opaque product credential accepted only during this connection handshake. */
  readonly credential: string
  /** Working directory recorded on every SDK-created coordinator Session header. */
  readonly cwd: string
  /** Provider route every SDK-created Team coordinator runs on. */
  readonly provider: string
  /** Model name every SDK-created Team coordinator runs on; the surrounding composition owns its adapter. */
  readonly model: string
  /** Optional positive output-token cap inherited by SDK-created coordinators and their in-process descendants. */
  readonly maxTokens?: number
}

/** Wire-stable server identity returned by initialization. */
export interface InitializeResult {
  /** Wire-stable server identity (`clocky-sdk-runtime`) and version. */
  serverInfo: { name: string; version: string }
}

/** Create one local default Team and admit its initial trusted human content. */
export interface TeamCreateParams {
  /** Non-empty user objective retained by the Team journal. */
  objective: string
  /** Ordered human content for the initial direct v3 Envelope. */
  contentBlocks: ContentBlock[]
}

/** Durable product-Team creation and first-Envelope admission receipt. */
export interface TeamCreateResult {
  /** Hub-minted product Team identity. */
  teamId: string
  /** Coordinator Session that owns the visible participant transcript. */
  coordinatorSessionId: string
  /** Hub-stamped initial human Envelope identity. */
  envelopeId: string
}

/** Re-attach one durable local Team to a fresh coordinator activation. */
export interface TeamResumeParams {
  /** Durable Team identity selected for resume. */
  teamId: string
  /** Team-journal cursor observed before the authenticated resume request. */
  expectedCursor: number
}

/** Team identity and coordinator Session returned after resume. */
export interface TeamResumeResult {
  /** Durable Team identity. */
  teamId: string
  /** Existing coordinator Session re-owned by the new runtime process. */
  coordinatorSessionId: string
}

/** Wait for one local product Team's explicit human-addressed final Envelope. */
export interface TeamWaitFinalParams {
  /** Product Team created by this runtime process. */
  teamId: string
}

/** Final Team result after receipt and local topology settlement. */
export interface TeamWaitFinalResult {
  /** Completed product Team identity. */
  teamId: string
  /** Direct channel retaining the final Envelope. */
  channelId: string
  /** Hub-stamped coordinator final Envelope identity. */
  envelopeId: string
  /** Exact human-visible final text. */
  text: string
}

/** Cancel one active local product Team. */
export interface TeamCancelParams {
  /** Product Team created by this runtime process. */
  teamId: string
}

/** Terminal durable phase after SDK-owned cancellation settles. */
export interface TeamCancelResult {
  /** Terminal Team phase after the runtime-owned cancellation completes. */
  readonly phase: TeamPhase
}

/** Archive one terminal Team through the authenticated connection's human proof. */
export interface TeamArchiveParams {
  /** Terminal Team selected by the human proof. */
  teamId: string
  /** Team-journal cursor observed before the proof-bound archive mutation. */
  expectedCursor: number
}

/** Confirmation returned after the Team archive marker is durable. */
export interface TeamArchiveResult {
  /** Archived Team identity. */
  teamId: string
  /** Epoch milliseconds of the durable archive marker. */
  archivedAt: number
}

/** Exact opaque ownership references for one remote activation epoch. */
export interface SdkActivationTarget {
  /** Provider-minted activation epoch identity. */
  readonly activationId: string
  /** Team that owns the logical participant. */
  readonly teamId: string
  /** Team-local logical participant. */
  readonly participantId: string
  /** Durable Session selected for this activation. */
  readonly sessionId: string
}

/** Initial placement supports a fresh Session or a persisted-resume Session. */
export type SdkActivationSeed =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'resume' }

/** Closed process-residency status reported for one exact remote activation. */
export type SdkActivationStatus = 'starting' | 'running' | 'idle' | 'stopping' | 'offline'

/** Immutable remote activation projection with a per-epoch monotonic sequence. */
export interface SdkActivationState extends SdkActivationTarget {
  /** Current exact epoch residency status. */
  readonly status: SdkActivationStatus
  /** Strictly increasing within `activationId` whenever `status` changes. */
  readonly statusSequence: number
}

/** Open one remote activation after the process-level SDK route has initialized. */
export interface ActivationOpenParams {
  /** Exact Team/Participant/Session/activation identity for this epoch. */
  readonly target: SdkActivationTarget
  /** Whether to create a fresh Session or reopen persisted history. */
  readonly seed: SdkActivationSeed
}

/** Remote activation state after a successful open. */
export interface ActivationOpenResult {
  /** The published remote activation state. */
  readonly state: SdkActivationState
}

/** Immutable Link identity supplied only after the Team Hub bound an activation. */
export interface SdkTeamLinkBinding extends SdkActivationTarget {
  /** AgentRuntime provider that owns this durable activation epoch. */
  readonly provider: string
}

/** Opaque WebSocket credential issued for one exact remote activation binding. */
export interface SdkTeamLinkEnrollment {
  /** Enrollment provider selected by the Hub deployment. */
  readonly provider: string
  /** Complete authenticated Team Link endpoint. */
  readonly endpoint: string
  /** Opaque credential that must never enter a Session, Team journal, or diagnostic. */
  readonly capability: string
}

/** Attach one remote activation's fixed Link delivery only after durable Team binding. */
export interface ActivationLinkEnrollParams {
  /** Existing remote activation selected by its complete lifecycle target. */
  readonly target: SdkActivationTarget
  /** Durable binding that must repeat the target and name its placement provider. */
  readonly binding: SdkTeamLinkBinding
  /** Short-lived opaque remote Link credential issued for this binding. */
  readonly enrollment: SdkTeamLinkEnrollment
}

/** Empty acknowledgement after the child accepted one exact fixed Link delivery. */
export type ActivationLinkEnrollResult = Record<string, never>

/** Read the state of one exact remote activation epoch. */
export interface ActivationStatusParams {
  /** Exact Team/Participant/Session/activation identity to read. */
  readonly target: SdkActivationTarget
}

/** Remote activation state returned by a status read. */
export interface ActivationStatusResult {
  /** The current remote activation state. */
  readonly state: SdkActivationState
}

/** A cancellation reason accepted by the remote Agent cancellation API. */
export type SdkActivationInterruptCause =
  | { readonly kind: 'user' }
  | { readonly kind: 'parent' }
  | { readonly kind: 'hook'; readonly reason: string }
  | { readonly kind: 'disposed' }

/** Request remote interruption without releasing its activation ownership. */
export interface ActivationInterruptParams {
  /** Exact Team/Participant/Session/activation identity to interrupt. */
  readonly target: SdkActivationTarget
  /** Cancellation intent supplied to the exact remote Agent. */
  readonly cause: SdkActivationInterruptCause
}

/** Acknowledgement that an interrupt reached the activation owner. */
export type ActivationInterruptResult = Record<string, never>

/** Request terminal disposal of one exact remote activation. */
export interface ActivationDisposeParams {
  /** Exact Team/Participant/Session/activation identity to release. */
  readonly target: SdkActivationTarget
}

/** Terminal state returned after remote activation disposal reaches quiescence. */
export interface ActivationDisposeResult {
  /** The activation's terminal offline state. */
  readonly state: SdkActivationState
}

/** `session.event` payload: one session-log event, streamed as it is recorded. */
export interface SessionEventNotification {
  /** Session the event belongs to (every session in the runtime, not only SDK-created ones). */
  sessionId: string
  /** The full session-log event envelope. */
  event: SessionEvent
}

/** Whole-agent lifecycle state for one session. */
export interface SessionStatusNotification {
  /** Session whose live agent changed status. */
  sessionId: string
  /** The whole-agent state after the transition. */
  status: 'idle' | 'running'
}

/** Post-commit durable Team journal projection streamed by the SDK runtime. */
export interface TeamEventNotification { readonly event: TeamEvent }
/** Post-commit durable channel WAL projection streamed by the SDK runtime. */
export interface ChannelEventNotification { readonly event: ChannelEvent }

/** `activation.status` payload for one exact remote activation transition. */
export interface ActivationStatusNotification {
  /** The complete provenance-bearing state after the transition. */
  readonly state: SdkActivationState
}

/** Server-to-client notifications by JSON-RPC method name. */
export interface HarnessSdkNotificationMap {
  'activation.status': ActivationStatusNotification
  'session.event': SessionEventNotification
  'session.status': SessionStatusNotification
  'team.event': TeamEventNotification
  'channel.event': ChannelEventNotification
}

/** Client-to-server request methods with their param and result shapes. */
export interface HarnessSdkRequestMap {
  'team/inbox-respond': { params: TeamInboxRespondParams; result: TeamHumanActionResponseResult }
  'team/workflow-plan-inspect': { params: TeamWorkflowInspectParams; result: TeamWorkflowInspection }
  'team/action-read': { params: TeamActionReadParams; result: TeamHumanActionSnapshot }
  'team/inbox-read': { params: TeamHumanInboxReadInput; result: TeamHumanInboxPage }
  'team/inbox-watch': { params: TeamHumanInboxReadInput; result: TeamHumanInboxPage }
  'team/inbox-acknowledge': { params: TeamHumanInboxAcknowledgeInput; result: TeamHumanInboxAcknowledgement }

  'activation/open': { params: ActivationOpenParams; result: ActivationOpenResult }
  'activation/link-enroll': { params: ActivationLinkEnrollParams; result: ActivationLinkEnrollResult }
  'activation/status': { params: ActivationStatusParams; result: ActivationStatusResult }
  'activation/interrupt': { params: ActivationInterruptParams; result: ActivationInterruptResult }
  'activation/dispose': { params: ActivationDisposeParams; result: ActivationDisposeResult }
  'initialize': { params: InitializeParams; result: InitializeResult }
  'team/list': { params: TeamListParams; result: TeamListResult }
  'team/member-session': { params: TeamMemberSessionParams; result: TeamMemberSessionResult }
  'team/task-inspect': { params: TeamTaskInspectParams; result: TeamTaskInspectResult }
  'team/member-inspect': { params: TeamMemberInspectParams; result: TeamMemberInspectResult }
  'team/browse': { params: TeamBrowseParams; result: TeamBrowseResult }
  'team/selection': { params: TeamSelectionParams; result: TeamSelectionResult }
  'team/get': { params: TeamGetParams; result: TeamGetResult }
  'team/goal-update': { params: TeamGoalUpdateParams; result: TeamGoalUpdateResult }
  'team/goal-transition': { params: TeamGoalTransitionParams; result: TeamGoalTransitionResult }
  'team/quiescence': { params: TeamQuiescenceParams; result: TeamQuiescenceResult }
  'team/metrics': { params: TeamMetricsParams; result: TeamMetricsResult }
  'team/audit-read': { params: TeamAuditReadParams; result: TeamAuditReadResult }
  'team/artifact-read': { params: TeamArtifactReadParams; result: TeamArtifactReadResult }
  'team/member-list': { params: TeamMemberListParams; result: TeamMemberListResult }
  'team/member-invite': { params: TeamMemberInviteParams; result: TeamMemberInviteResult }
  'team/member-activate': { params: TeamMemberActivateParams; result: TeamMemberActivateResult }
  'team/member-remove': { params: TeamMemberRemoveParams; result: TeamMemberRemoveResult }
  'team/member-interrupt': { params: TeamMemberInterruptParams; result: TeamMemberInterruptResult }
  'team/channel-catalog': { params: TeamChannelCatalogParams; result: TeamChannelCatalogResult }
  'team/channel-summarize': { params: TeamChannelSummarizeParams; result: TeamChannelSummarizeResult }
  'team/channel-list': { params: TeamChannelListParams; result: TeamChannelListResult }
  'team/channel-admission': { params: TeamChannelAdmissionParams; result: TeamChannelAdmissionResult }
  'team/channel-invitation': { params: TeamChannelInvitationParams; result: TeamChannelInvitationResult }
  'team/channel-invitation-acknowledge': { params: TeamChannelInvitationAcknowledgeParams; result: TeamChannelInvitationResult }
  'team/channel-open': { params: TeamChannelOpenParams; result: TeamChannelOpenResult }
  'team/channel-input': { params: TeamChannelInputParams; result: TeamChannelPostResult }
  'team/channel-attachment': { params: TeamChannelAttachmentParams; result: TeamChannelAttachmentResult }
  'team/channel-post': { params: TeamChannelPostParams; result: TeamChannelPostResult }
  'team/channel-read': { params: TeamChannelReadParams; result: TeamChannelReadResult }
  'team/channel-close': { params: TeamChannelCloseParams; result: TeamChannelCloseResult }
  'team/channel-watch': { params: TeamChannelWatchParams; result: TeamChannelWatchResult }
  'team/task-create': { params: TeamTaskCreateParams; result: TeamTaskCreateResult }
  'team/task-get': { params: TeamTaskGetParams; result: TeamTaskGetResult }
  'team/task-list': { params: TeamTaskListParams; result: TeamTaskListResult }
  'team/workflow-plan-list': { params: TeamWorkflowPlanListParams; result: TeamWorkflowPlanListResult }
  'team/artifact-list': { params: TeamArtifactListParams; result: TeamArtifactListResult }
  'team/task-update': { params: TeamTaskUpdateParams; result: TeamTaskUpdateResult }
  'team/task-cancel': { params: TeamTaskCancelParams; result: TeamTaskCancelResult }
  'team/task-delete': { params: TeamTaskDeleteParams; result: TeamTaskDeleteResult }
  'team/task-review': { params: TeamTaskReviewParams; result: TeamTaskReviewResult }
  'team/task-watch': { params: TeamTaskWatchParams; result: TeamTaskWatchResult }
  'team/create': { params: TeamCreateParams; result: TeamCreateResult }
  'team/resume': { params: TeamResumeParams; result: TeamResumeResult }
  'team/wait-final': { params: TeamWaitFinalParams; result: TeamWaitFinalResult }
  'team/cancel': { params: TeamCancelParams; result: TeamCancelResult }
  'team/archive': { params: TeamArchiveParams; result: TeamArchiveResult }
  'shutdown': { params: undefined; result: Record<string, never> }
}

/** Exact human action read, independent from the complete Team projection. */
export interface TeamActionReadParams {
  readonly teamId: string
  readonly actionId: string
}

/** Workflow identity and task-window selection accepted by SDK clients. */
export type TeamWorkflowInspectParams = Omit<TeamWorkflowInspectRequest, 'teamId' | 'planId'> & {
  readonly teamId: string
  readonly planId: string
}
