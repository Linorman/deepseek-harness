/** Browser runtime services for slots, Teams, Sessions, Workspaces, and connection-stream delivery. */
import type { Context } from '@clocky/cordis'
import type { ConnectionHandle, SessionId } from '@clocky/clocky-api-remotes/client'
// Type-only: the ctx.remote merge. Deliberately the gateway's Client half rather
// than api-remotes': that face imports a Host-tsdown-generated artifact, and this
// project sits in the Host build graph.
import type {} from '@clocky/clocky-api-remotes/client'
import type { TypertContext } from '@clocky/clocky-typert-protocol'
import type { MaybeSnapshotSelectorHook, SnapshotSelectorHook } from '@clocky/clocky-client-ui-slots'
import { SlotRegistry } from './slots.ts'
import { SessionRuntime } from './sessions/service.ts'
import type { SessionListState } from './sessions/service.ts'
import { WorkspaceRuntime } from './workspaces/service.ts'
import { TeamTaskRuntime } from './teams/service.ts'
import type { ConversationSnapshot } from './sessions/conversation.ts'
import type { UseProjection } from './sessions/projection-store.ts'
import { ConversationEventRegistry } from './conversation/event-registry.ts'
import { ConversationViewRegistry } from './conversation/view-registry.ts'

export { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@clocky/clocky-session/surface'

export { SlotRegistry } from './slots.ts'
export { ConversationEventRegistry } from './conversation/event-registry.ts'
export { ConversationViewRegistry } from './conversation/view-registry.ts'
export { ConversationNodeAssembler } from './sessions/conversation-assembler.ts'
export { ConversationLocationIndex } from './sessions/conversation-location-index.ts'
export { conversationContextKey } from './contract/conversation.ts'
export type {
  ChatConversationViewNode, ConversationContextReader, ConversationEventInput,
  ConversationLocationData, ConversationLocationDataScope, ConversationLocationDataStore,
  ConversationStepDataMap,
  ConversationLocation, ConversationMatch, ConversationMatchResult,
  ConversationNodeContext, ConversationNodeDefinition, ConversationPreviousContext,
  ConversationPublication, ConversationTimelineSnapshot, ConversationTurnDataMap, ConversationViewBuilder,
  ConversationViewDefinition, ConversationViewNode, ConversationViewSnapshotMap,
  ConversationViewSnapshotStore, StepLocation, TurnLocation,
} from './contract/conversation.ts'
export type { ConversationRuntime } from './sessions/conversation-assembler.ts'
export type { RootOwnerProps } from './slots.ts'
export { SessionRuntime, scopeOf, workspaceTitleOf } from './sessions/service.ts'
// The provide channel is shared with the client test runtime (one
// materialization/projection implementation; no test-side mirror to drift).
export { SessionProvideChannel } from './sessions/provide.ts'
export type { SessionProvideChannelHost } from './sessions/provide.ts'
export { createScope } from './agents/scope.ts'
export type { AgentScopeHandle } from './agents/scope.ts'
export { DirectoryBrowseError, WorkspaceCreateError, WorkspaceRuntime } from './workspaces/service.ts'
export { TeamTaskRuntime, TeamTaskStartError } from './teams/service.ts'
export { abbreviateHomePath, resolveWorkspacePath } from './workspaces/path.ts'
// Contract only: the scope implementation and its Host transport belong to
// clocky-client-ui-settings (see that package's settings-scope.ts).
export type {
  SettingsScope, SettingsScopeSnapshot, SettingsScopeSpec,
} from './contract/settings-scope.ts'
export type { Session } from './sessions/session.ts'
export type { ISession, ProjectionsFace, SessionFace } from './contract/session.ts'
export type { AgentContext, ISessions } from './contract/sessions.ts'
export type { IWorkspaces } from './contract/workspaces.ts'
export type {
  TeamWorkflowSummary, TeamWorkflowInspection, TeamWorkflowDetailReadMode, TeamWorkflowDetailState,
  TeamTaskSummary, TeamMemberSummary, TeamTaskInspection, TeamTaskRecord, TeamTaskAttempt,
  TeamTaskDetailState, TeamTaskDetailPart, TeamTaskDetailReadMode,
  ITeamTasks, TeamHumanAction, TeamInboxPage, TeamInboxState, TeamActionResponseInput, TeamActionResponseResult,
  TeamChannelState, TeamChannelInvitation, TeamChannelAdmission, TeamChannelListPage, TeamChannelListState, TeamCollectionKind,
  TeamCollectionReadMode, TeamCollectionPage, TeamCollectionsState, TeamManagementCommand, TeamManagementOperation,
  TeamTaskDraft, TeamTaskDraftOptions, TeamTaskDraftPhase, TeamTaskListState, TeamTaskSelection,
  TeamTaskStartInput, TeamChannelInput, TeamChannelAttachmentInput, TeamChannelAttachmentResult, TeamChannelMessageContent,
  TeamChannelCatalog, TeamChannelCatalogState, TeamChannelSummary,
} from './contract/team-tasks.ts'
export type {
  ChannelId, ChannelReadPageResult, ChannelReadResult, ChannelRecord, ParticipantId, TeamArtifactReadResult,
  TeamArtifactReference, TeamAuditList,
  TeamTaskId, TeamTaskSnapshot,
} from '@clocky/clocky-client-connection/client'
export type {
  SessionBinding, SessionListState, SessionProvideContribution, SessionProvideDescriptor, SessionSummary,
} from './sessions/service.ts'
export type { SessionListPhase, SessionSearchResultItem } from './sessions/manager.ts'
export type { JobView } from '@clocky/clocky-client-connection/client'
export type { WorkspaceListPhase } from './workspaces/manager.ts'
export type { WorkspaceListState } from './workspaces/service.ts'
export type {
  DirectoryEntry, DirectoryListing, WorkspaceId, WorkspaceView,
} from '@clocky/clocky-client-connection/client'
// Runtime owns the snapshot store; ui-renderer only binds it to React.
export { createSnapshotStore, defineStore, shallowEqual } from './contract/store.ts'
export type {
  EngineStoreHandle, EngineStoreInstance, ObservableSnapshot, SnapshotStore,
} from './contract/store.ts'
export type {
  AssistantBlock, AssistantMessageNode, AssistantProvenanceView, AssistantRequestConfig,
  AssistantTiming, ChatLocationNodeIndex, ChatNodeStore, ChatSnapshot,
  CommandNode, CompactionSummaryNode, ComposerPhase,
  ContextMessageNode, ConversationNode, ConversationSnapshot, ModelRetryNode, QueuedMessage,
  LegacyConversationSlice, PartialAssistant, RunningToolCall,
  SteeringMessageNode, TodoItem, ToolCallBlock, ToolResultNode, TurnErrorNode, TurnMaxTokensNode,
  UnknownSurfaceNode, UserMessageNode,
} from './sessions/conversation.ts'
export {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS, toAssistantBlock, toAssistantBlocks,
} from './sessions/conversation.ts'
export { emptyAssistantBlock } from './sessions/partial.ts'
export { isTokenDelta } from './sessions/assistant-timing.ts'
export { contextForm, contextProvenance, sessionRecallLabels } from './sessions/context-provenance.ts'
export { displayFailureMessage } from './sessions/failure-display.ts'
export type {
  ConversationContext, ConversationContextOriginKind,
} from './sessions/conversation-context.ts'
export type {
  ContextProvenanceView, ContextRole, KnownContextForm,
} from './sessions/context-provenance.ts'
export type {
  ConversationPromptSnapshot, RequestInspectionSnapshot, RequestPromptChange, RequestView,
} from './sessions/request-inspection.ts'
export { PendingWait } from './sessions/pending.ts'
export type {
  PendingInteraction, PendingInteractionStatus, PendingKind, PendingPayloads,
} from './sessions/pending.ts'
// Projection value store (push model; see the session-projection subsystem
// page, docs/subsystems/session-projection.md): host-computed
// whole values per key; domains ship projection support with zero client code.
export type {
  ProjectionsBaseline, ProjectionValueStore, SessionProjectionMap, UseProjection,
} from './sessions/projection-store.ts'
export type { SessionId, TeamId } from '@clocky/clocky-client-connection/client'

/** Client-side Cordis context after declaration merging. */
export type ClientContext = Context

declare module '@clocky/clocky-typert-protocol' {
  interface TypertContextMap {
    /** Client Agent scope identity; the agent and session share one wire id. */
    agent: TypertContext<SessionId>
  }
}

/** The conversation-snapshot selector hook supplied to session-scoped UI entries. */
export type UseConversationSession = SnapshotSelectorHook<ConversationSnapshot>

declare module '@clocky/clocky-client-ui-slots' {
  /**
   * Session standard kit, real members (ui-slots declares the empty seat;
   * the runtime — where the subjects live — merges the concrete types):
   * every session-scope slot component receives these from the framework.
   */
  interface SessionStandardProps {
    useSession: SnapshotSelectorHook<ConversationSnapshot>
    /** The framework-resolved session id (owners never pass it). */
    sessionId: SessionId
    /** The fifth framework hook seat: key-addressed projection reader (undefined = capability absent). */
    useProjection: UseProjection
  }
  /** Standard kit for slots that remain mounted while current session changes. */
  interface SessionMaybeStandardProps {
    useSession: MaybeSnapshotSelectorHook<ConversationSnapshot>
    /** Current session id; absent in the no-session state. */
    sessionId: SessionId | undefined
    /** Key-addressed projection reader; every key reads absent while no session is current. */
    useProjection: UseProjection
  }
  /** Props injected into every global slot component. */
  interface GlobalStandardProps {
    useSessions: SnapshotSelectorHook<SessionListState>
    /** Selector hook over real Workspaces and their independent baseline lifecycle. */
    useWorkspaces: SnapshotSelectorHook<import('./workspaces/service.ts').WorkspaceListState>
    /** Selector hook over durable Team task state and the local first-input draft. */
    useTeamTasks?: SnapshotSelectorHook<import('./contract/team-tasks.ts').TeamTaskListState>
  }
}

declare module '@clocky/cordis' {
  interface Events {
    /**
     * A slot's definition or registration set changed.
     * @mode emit
     * @param key - the mutated SlotMap key.
     */
    'slots/changed'(key: string): void
    /**
     * A connection generation was (re-)established. Wire-derived caches must
     * treat their state as stale and repull (commands directory; the queue
     * mirrors reset themselves through the session resync path).
     * @mode emit
     */
    'connection/reset'(): void
  }
  interface Context {
    slots: import('./slots.ts').SlotRegistry
    /** Event-to-business-Context Definition registry. */
    conversationEvents: import('./conversation/event-registry.ts').ConversationEventRegistry
    /** Per-target Conversation snapshot builder registry. */
    conversationViews: import('./conversation/view-registry.ts').ConversationViewRegistry
    /** The outward face only; the concrete service stays inside the runtime. */
    sessions: import('./contract/sessions.ts').ISessions
    /** The outward face only; the concrete service stays inside the runtime. */
    workspaces: import('./contract/workspaces.ts').IWorkspaces
    /** The outward Team product face; Session transcripts remain descendants. */
    teamTasks: import('./contract/team-tasks.ts').ITeamTasks
  }
}

/** Required services: the wire handle and Client Typert registry. */
export const inject = ['connection', 'typert', 'remote', 'remote.commands']

/** Mounts the browser runtime services and connection stream.
 * @param ctx - Client Cordis context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(SlotRegistry)
  const conversation = {
    events: new ConversationEventRegistry(ctx),
    views: new ConversationViewRegistry(ctx),
  }
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = new SessionRuntime(ctx, connection.api, ctx.remote, conversation)
  ctx.typert.contexts.registerClient('agent', {
    identity: candidate => sessions.scopeOf(candidate),
  })
  const workspaces = new WorkspaceRuntime(ctx, connection.api, sessions)
  const teamTasks = new TeamTaskRuntime(ctx, connection.api)
  sessions.clear()
  teamTasks.startDraft()
  const loop = connection.start({
    onMuxEnvelope: (envelope) => {
      sessions.handleMuxEnvelope(envelope)
      teamTasks.handleMuxEnvelope(envelope)
    },
    onHostEnvelope: (envelope) => {
      sessions.handleHostEnvelope(envelope)
      workspaces.handleHostEnvelope(envelope)
      // Forwarded-event bridge: the session layer ignores registry frames (no
      // session routing). This plugin owns the frame sink, so it hands the
      // decoded frame straight to the Remote service, which fans it out to
      // `ctx.remote.$on` subscribers; no consumer reads a frame.
      const frame = envelope.payload
      if (frame.type === 'host/remote-event') ctx.remote.$dispatch(frame.event, frame.args)
    },
    onConnected: () => {
      sessions.handleConnected()
      workspaces.handleConnected()
      teamTasks.handleConnected()
      ctx.emit('connection/reset')
    },
    onStateChange: (state) => {
      // Generation death fires before any next-generation frame can arrive
      // (reconnect replays flow from stream open, ahead of onConnected):
      // the only safe moment to drop generation-scoped interaction state.
      if (state === 'reconnecting') {
        sessions.handleDisconnected()
        teamTasks.handleDisconnected()
      }
    },
  })
  ctx.effect(() => () => { loop.stop() }, 'runtime: connection stream loop')
}
