import type { AttachmentIdType, ImageAttachmentRef } from '@clocky/clocky-attachment'
import type { TeamHumanActionResponseInput, TeamHumanActionResponseResult } from '@clocky/clocky-team/types'
import type { TeamHumanInboxReadInput, TeamHumanInboxPage, TeamHumanInboxAcknowledgeInput, TeamHumanInboxAcknowledgement } from '@clocky/clocky-team/types'
/** Browser-safe Team product-domain contract. */

import type {
  ChannelId,
  ChannelHumanAdmissionSnapshot,
  TeamChannelListInput,
  TeamChannelListPage,
  ChannelHumanInvitationSnapshot,
  ChannelInvitationAcknowledgeInput,
  ChannelSummarySelectionInput,
  ChannelSummaryRecord,
  ChannelReadPageResult,
  ChannelSnapshot,
  ChannelPostIdempotencyKey,
  ChannelWatchResult,
  ChannelParticipant,
  EnvelopeDelivery,
  EnvelopePriority,
  EnvelopeId,
  JsonObject,
  ParticipantId,
  ParticipantInterruptSnapshot,
  ParticipantKind,
  ParticipantSnapshot,
  TeamAdapterRef,
  TeamAuditEntry,
  TeamId,
  TeamListPage,
  TeamStateSnapshot,
  TeamQuiescenceSnapshot,
  TeamMetricsSnapshot,
  TeamTaskId,
  TeamTaskCreateIdempotencyKey,
  TeamTaskIntegrationSpec,
  TeamTaskReviewPolicy,
  TeamTaskSnapshot,
  TeamTaskPlacement,
  TeamTaskExecution,
  TeamTaskWorkspaceMode,
  TeamWatchResult,
  TeamEnvelope,
  TeamPhase,
  TeamViewPolicyRef,
  TeamArtifactReference,
  TeamGoalPhaseTransitionInput,
  TeamGoalUpdateInput,
  TeamWorkflowPlanSnapshot,
} from '@clocky/clocky-team/types'
import type { ModelSelection } from './sessions.ts'
import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { PromptContentPart } from './sessions.ts'

/** Actor-free routing and payload for a human channel post. */
export interface TeamChannelPostInput {
  channelId: ChannelId
  expectedCursor: number
  audience: readonly ParticipantId[] | null
  kind: string
  payload: JsonObject
  delivery: EnvelopeDelivery
  priority?: EnvelopePriority | undefined
  idempotencyKey?: ChannelPostIdempotencyKey | undefined
  causationId?: EnvelopeId | undefined
  correlationId?: string | undefined
  taskId?: TeamTaskId | undefined
  traceId?: string | undefined
  ttlMs?: number | undefined
}

/** Ordered media for direct channels, or one text block for a consult or discussion turn. */
export interface TeamChannelInput extends Omit<TeamChannelPostInput, 'kind' | 'payload'> {
  readonly content: readonly PromptContentPart[]
}
/** Exact retained message reference authorizing an image read. */
export interface TeamChannelAttachmentInput {
  readonly teamId: TeamId
  readonly channelId: ChannelId
  readonly envelopeId: EnvelopeId
  readonly envelopeSequence: number
  readonly attachmentId: AttachmentIdType
}
/** Verified normalized image bytes for an exact channel message. */
export interface TeamChannelAttachment {
  readonly attachment: ImageAttachmentRef
  readonly data: string
}

/** Receipt returned after trusted human text enters a default Team channel. */
export interface TeamInputReceipt {
  /** Hub-stamped identity of the accepted human Envelope. */
  readonly envelopeId: EnvelopeId
}

/** Result returned after a Team topology and its first trusted human input both commit. */
export interface TeamStartResult {
  /** Complete durable Team state after the default topology is active. */
  readonly state: TeamStateSnapshot
  /** Hub-stamped first human Envelope identity. */
  readonly envelopeId: EnvelopeId
}

/** Bounded visible Team-summary page returned by the management surface. */
export type TeamList = TeamListPage

/** Explicit final result accepted from the default coordinator channel. */
export interface TeamFinal {
  /** Team that owns the final result. */
  readonly teamId: TeamId
  /** Default human/coordinator channel retaining the final Envelope. */
  readonly channelId: ChannelId
  /** Immutable final Envelope identity. */
  readonly envelopeId: EnvelopeId
  /** Human-visible coordinator final text. */
  readonly text: string
}

/** Team participant list returned by the management surface. */
export interface TeamMemberList {
  /** Durable participants in provider order. */
  readonly items: readonly ParticipantSnapshot[]
  /** Provider-order ordinal for the next page when more participants remain. */
  readonly nextCursor?: number | undefined
}

/** Team task list returned by the management surface. */
export interface TeamTaskList {
  /** Durable tasks, including deleted tombstones. */
  readonly items: readonly TeamTaskSnapshot[]
  /** Provider-order ordinal for the next page when more tasks remain. */
  readonly nextCursor?: number | undefined
}

/** Read-only source records returned by the Team audit surface. */
export interface TeamAuditList {
  /** Team owning the selected source stream. */
  readonly teamId: TeamId
  /** Channel source when the page reads a channel WAL. */
  readonly channelId?: ChannelId
  /** First retained audit cursor after an optional prefix compaction. */
  readonly firstCursor?: number | undefined
  /** Ordered entries from the selected Team journal or channel WAL. */
  readonly items: readonly TeamAuditEntry[]
  /** Source cursor to use for a later page, when the page reached its limit. */
  readonly nextCursor?: number
}

/** Bounded workflow-plan page returned by the authenticated Team read surface. */
export interface TeamWorkflowPlanList {
  readonly items: readonly TeamWorkflowPlanSnapshot[]
  readonly nextCursor?: number | undefined
}

/** Bounded visible artifact-reference page retained by one Team. */
export interface TeamArtifactList {
  readonly items: readonly TeamArtifactReference[]
  readonly nextCursor?: number | undefined
}

/** Verified artifact bytes returned only after Team visibility and provenance checks. */
export interface TeamArtifactReadResult {
  /** Durable reference selected from the requested Team state. */
  readonly artifact: TeamArtifactReference
  /** Number of decoded bytes in `data`. */
  readonly bytes: number
  /** Canonical base64 encoding of the verified artifact bytes. */
  readonly data: string
}

/** Team-oriented unary methods exposed by the Host. */
export interface TeamsApi {
  /** Answer an exact principal-owned request through its retained continuation. */
  inboxRespond(request: RpcRequest<TeamHumanActionResponseInput>): Promise<RpcResponse<TeamHumanActionResponseResult>>
  /** Authenticated principal inbox read. */
  inboxRead(request: RpcRequest<TeamHumanInboxReadInput>): Promise<RpcResponse<TeamHumanInboxPage>>
  /** Authenticated principal inbox watch. */
  inboxWatch(request: RpcRequest<TeamHumanInboxReadInput>): Promise<RpcResponse<TeamHumanInboxPage>>
  /** Authenticated principal inbox acknowledge. */
  inboxAcknowledge(request: RpcRequest<TeamHumanInboxAcknowledgeInput>): Promise<RpcResponse<TeamHumanInboxAcknowledgement>>

  /** Lists durable Team summaries without requiring a local TeamRun owner. */
  list(request: RpcRequest<{ afterCursor?: number; limit?: number }>): Promise<RpcResponse<TeamList>>

  /** Reads one complete durable Team state without activating an Agent. */
  get(request: RpcRequest<{ teamId: TeamId }>): Promise<RpcResponse<TeamStateSnapshot>>

  /** Creates the default local Team topology and returns its durable state. */
  create(
    request: RpcRequest<{ objective: string; cwd?: string; agentPreset?: string; selection?: ModelSelection }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<TeamStateSnapshot>>

  /** Re-attaches a durable default Team to a fresh local coordinator activation. */
  resume(
    request: RpcRequest<{ teamId: TeamId; expectedCursor: number; cwd?: string; agentPreset?: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<TeamStateSnapshot>>

  /** Creates the default local Team topology and admits its first trusted text input under one retry key. */
  start(
    request: RpcRequest<{
      objective: string
      text: string
      idempotencyKey: ChannelPostIdempotencyKey
      cwd?: string
      agentPreset?: string
      selection?: ModelSelection
    }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<TeamStartResult>>

  /** Posts one trusted text message to the default human/coordinator channel. */
  postInput(
    request: RpcRequest<{
      teamId: TeamId
      text?: string
      content?: readonly PromptContentPart[]
      idempotencyKey?: ChannelPostIdempotencyKey
      delivery?: EnvelopeDelivery
    }>,
  ): Promise<RpcResponse<TeamInputReceipt>>

  /** Waits for the coordinator's explicit human-addressed final result. */
  waitFinal(
    request: RpcRequest<{ teamId: TeamId; afterCursor?: number }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<TeamFinal>>

  /** Cancels the current locally owned default Team run. */
  cancel(request: RpcRequest<{ teamId: TeamId }>): Promise<RpcResponse<{ accepted: true; phase: TeamPhase }>>

  /** Archives one terminal Team without deleting its durable state. */
  archive(request: RpcRequest<{ teamId: TeamId; expectedCursor: number }>): Promise<RpcResponse<TeamStateSnapshot>>

  /** Replaces one Team objective's text and/or goal-specific budgets through an authenticated human proof. */
  goalUpdate(request: RpcRequest<TeamGoalUpdateInput>): Promise<RpcResponse<TeamStateSnapshot>>

  /** Transitions one Team objective lifecycle through an authenticated human proof. */
  goalTransition(request: RpcRequest<TeamGoalPhaseTransitionInput>): Promise<RpcResponse<TeamStateSnapshot>>

  /** Returns durable quiescence diagnostics for completion and stall policies. */
  quiescence(request: RpcRequest<{ teamId: TeamId }>): Promise<RpcResponse<TeamQuiescenceSnapshot>>

  /** Returns process-local Team operational counters for dashboards and alerts. */
  metrics(request: RpcRequest<{}>): Promise<RpcResponse<TeamMetricsSnapshot>>

  /** Reads a bounded Team-journal or attached-channel audit page. */
  auditRead(
    request: RpcRequest<{ teamId: TeamId; channelId?: ChannelId; afterCursor?: number; limit?: number }>,
  ): Promise<RpcResponse<TeamAuditList>>

  /** Reads verified bytes for a visible artifact retained by one durable Team result. */
  artifactRead(
    request: RpcRequest<{ teamId: TeamId; artifactId: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<TeamArtifactReadResult>>

  /** Lists bounded non-private artifact references retained by one Team. */
  artifactList(request: RpcRequest<{ teamId: TeamId; afterCursor?: number; limit?: number }>): Promise<RpcResponse<TeamArtifactList>>

  /** Lists the durable participants in one Team. */
  memberList(request: RpcRequest<{ teamId: TeamId; afterCursor?: number; limit?: number }>): Promise<RpcResponse<TeamMemberList>>

  /** Invites one participant with explicit role and capability claims. */
  memberInvite(
    request: RpcRequest<{
      teamId: TeamId
      expectedCursor: number
      kind: Exclude<ParticipantKind, 'human'>
      displayName: string
      role: string
      capabilities: readonly string[]
      provider?: string
      preset?: string
      model?: string
      authScheme?: string
    }>,
  ): Promise<RpcResponse<ParticipantSnapshot>>

  /** Activates an invited or provisioning participant through a cursor fence. */
  memberActivate(
    request: RpcRequest<{ teamId: TeamId; participantId: ParticipantId; expectedCursor: number }>,
  ): Promise<RpcResponse<ParticipantSnapshot>>

  /** Marks one active participant as left through a cursor-fenced transition. */
  memberRemove(
    request: RpcRequest<{ teamId: TeamId; participantId: ParticipantId; expectedCursor: number }>,
  ): Promise<RpcResponse<ParticipantSnapshot>>

  /** Requests a soft interrupt for one participant's current activation. */
  memberInterrupt(
    request: RpcRequest<{ teamId: TeamId; participantId: ParticipantId; expectedCursor: number }>,
  ): Promise<RpcResponse<ParticipantInterruptSnapshot>>

  /** Discover installed channel protocols, view policies and summary bounds. */
  channelCatalog(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<import('@clocky/clocky-team/types').TeamChannelCatalog>>
  /** Read one page of attached channel snapshots as an authenticated Team human. */
  channelList(request: RpcRequest<TeamChannelListInput>): Promise<RpcResponse<TeamChannelListPage>>
  /** Inspect endpoint consent status as an authenticated human member of the owning Team. */
  channelAdmission(request: RpcRequest<{ teamId: TeamId; channelId: ChannelId }>): Promise<RpcResponse<ChannelHumanAdmissionSnapshot>>
  /** Read this authenticated principal's invitation without accepting it. */
  channelInvitation(request: RpcRequest<{ channelId: ChannelId }>): Promise<RpcResponse<ChannelHumanInvitationSnapshot>>
  /** Explicitly accept the exact manifest and invitation revision supplied by discovery. */
  channelInvitationAcknowledge(request: RpcRequest<ChannelInvitationAcknowledgeInput>): Promise<RpcResponse<ChannelHumanInvitationSnapshot>>
  /** Opens one versioned channel for active Team participants. */
  channelOpen(
    request: RpcRequest<{
      teamId: TeamId
      expectedCursor: number
      adapter: TeamAdapterRef
      viewPolicy?: TeamViewPolicyRef
      participants: readonly ChannelParticipant[]
      limits: JsonObject
    }>,
  ): Promise<RpcResponse<ChannelSnapshot>>

  /** Admit direct-channel media or basic-protocol text with authoritative turn and request validation. */
  channelInput(request: RpcRequest<TeamChannelInput>): Promise<RpcResponse<TeamEnvelope>>
  /** Read image bytes only after proving this exact retained channel message references the image. */
  channelAttachment(request: RpcRequest<TeamChannelAttachmentInput>): Promise<RpcResponse<TeamChannelAttachment>>

  /** Posts one human-authored Envelope to a Team channel. */
  channelPost(
    request: RpcRequest<TeamChannelPostInput>,
  ): Promise<RpcResponse<TeamEnvelope>>

  /** Reads a bounded channel-WAL suffix. */
  channelRead(
    request: RpcRequest<{ channelId: ChannelId; afterCursor?: number; limit?: number }>,
  ): Promise<RpcResponse<ChannelReadPageResult>>

  /** Generates an explicit channel-wide extractive summary through the authenticated human's current proof. */
  channelSummarize(request: RpcRequest<ChannelSummarySelectionInput>): Promise<RpcResponse<ChannelSummaryRecord>>

  /** Closes one channel through its expected-cursor precondition. */
  channelClose(
    request: RpcRequest<{ channelId: ChannelId; expectedCursor: number; reason?: string }>,
  ): Promise<RpcResponse<ChannelSnapshot>>

  /** Waits for one channel-WAL change or terminal closure. */
  channelWatch(
    request: RpcRequest<{ channelId: ChannelId; afterCursor?: number }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<ChannelWatchResult>>

  /** Creates one durable Team task from a complete caller-supplied task record. */
  taskCreate(
    request: RpcRequest<{
      teamId: TeamId
      expectedCursor: number
      idempotencyKey: TeamTaskCreateIdempotencyKey
      parentTaskId?: TeamTaskId
      placement?: TeamTaskPlacement
      execution?: TeamTaskExecution
      subject: string
      description: string
      integration?: TeamTaskIntegrationSpec
      blockedBy: readonly TeamTaskId[]
      requiredCapabilities: readonly string[]
      priority: number
      readScopes: readonly string[]
      writeScopes: readonly string[]
      workspaceMode: TeamTaskWorkspaceMode
      budget: JsonObject
      reviewPolicy: TeamTaskReviewPolicy
      maxAttempts: number
    }>,
  ): Promise<RpcResponse<TeamTaskSnapshot>>

  /** Reads one durable Team task. */
  taskGet(request: RpcRequest<{ teamId: TeamId; taskId: TeamTaskId }>): Promise<RpcResponse<TeamTaskSnapshot>>

  /** Lists one Team's durable task projections. */
  taskList(request: RpcRequest<{ teamId: TeamId; afterCursor?: number; limit?: number }>): Promise<RpcResponse<TeamTaskList>>

  /** Lists durable workflow plans in admission order through a bounded page. */
  workflowPlanList(request: RpcRequest<{ teamId: TeamId; afterCursor?: number; limit?: number }>): Promise<RpcResponse<TeamWorkflowPlanList>>

  /** Edits one lease-free task's subject, description, or dependencies. */
  taskUpdate(
    request: RpcRequest<{
      teamId: TeamId
      taskId: TeamTaskId
      expectedRevision: number
      subject?: string
      description?: string
      blockedBy?: readonly TeamTaskId[]
    }>,
  ): Promise<RpcResponse<TeamTaskSnapshot>>

  /** Requests one task cancellation through its revision fence while the Team continues. */
  taskCancel(
    request: RpcRequest<{ teamId: TeamId; taskId: TeamTaskId; expectedRevision: number; reason?: string }>,
  ): Promise<RpcResponse<TeamTaskSnapshot>>

  /** Tombstones one lease-free Team task through its revision fence. */
  taskDelete(
    request: RpcRequest<{ teamId: TeamId; taskId: TeamTaskId; expectedRevision: number }>,
  ): Promise<RpcResponse<TeamTaskSnapshot>>

  /** Resolves a participant-reviewed task as accepted or returned for rework. */
  taskReview(
    request: RpcRequest<{ teamId: TeamId; taskId: TeamTaskId; expectedRevision: number; decision: 'accepted' | 'rework'; reason: string }>,
  ): Promise<RpcResponse<TeamTaskSnapshot>>

  /** Waits for a Team-journal cursor change while observing task projections. */
  taskWatch(
    request: RpcRequest<{ teamId: TeamId; afterCursor?: number }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<TeamWatchResult>>
}
