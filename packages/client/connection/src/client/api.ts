// Central contract re-export point: every contract import inside
// web-runtime goes through this single file.
// Types and runtime protocol helpers/bounds come from the apiproxy api/ layer
// (zero Node deps, browser-safe); AbstractApiClient is the client boundary.
// NEVER import the package root: it drags bootHost/cordis into the browser bundle.
// The ./api and ./client subpath exports are the browser-safe channels.

import type { TeamMetricsSnapshot } from '@clocky/clocky-team/types'

export type {
  ApiProxy, SessionsApi, SessionSearchItem, SessionSummary, PromptContentPart, HostApi, EventsApi, MuxFrame, HostFrame,
  ApprovalResponsePayload, QuestionResponsePayload, HistoryEntry, ToolEventView,
  DirectoryEntry, DirectoryListing,
  ResponseValue, WorkspaceApi, WorkspaceId, WorkspaceView,
  SkillsApi, SkillEntry,
  ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelReasoning,
  ModelReasoningEffort, ModelSelection, QueueAction, QueuedInboxItem, SessionModels,
  AgentPresetEntry,
  SettingsApi, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
  CredentialsApi, CredentialView, ConfigurableProviderView, DiscoveredModelView, LlmApi,
  TeamArtifactList, TeamArtifactReadResult, TeamAuditList, TeamFinal, TeamInputReceipt, TeamList,
  TeamMemberList, TeamStartResult, TeamTaskList, TeamWorkflowPlanList, TeamsApi,
  JobView,
} from '@clocky/clocky-host-apiproxy/api'
export type { ToolCallView, ToolResultView } from '@clocky/clocky-tools/presentation'
export type {
  RpcRequest, RpcResponse, RpcResult, RpcError, RpcErrorCode,
  ClientRequest, ServerResponse, ServerRequest, ClientResponse, RpcMessage, RpcReceipt,
} from '@clocky/clocky-host-apiproxy/api'
// transportError lives in the apiproxy api layer (beside RpcResult, its
// subject); re-exported here so connection consumers keep one contract
// entry point.
export {
  RpcId,
  SESSION_SEARCH_RESULT_LIMIT,
  transportError,
} from '@clocky/clocky-host-apiproxy/api'
export { AbstractApiClient } from '@clocky/clocky-host-apiproxy/client'
export type { IApiClient } from '@clocky/clocky-host-apiproxy/client'
export type { SessionId, SessionEvent } from '@clocky/clocky-session/types'
export type {
  ChannelPostIdempotencyKey, TeamId, TeamSnapshot, TeamStateSnapshot, TeamTaskId, TeamTaskSnapshot,
  ChannelId, ChannelReadPageResult, ChannelReadResult, ChannelRecord, ParticipantId,
  TeamArtifactReference,
  TeamHumanActionId, TeamHumanActionSourceId, TeamHumanActionSnapshot,
  TeamUsageSampleId, TeamUsageSnapshot, TeamQuiescenceSnapshot, TeamMetricsSnapshot, TeamStallReason, TeamViewPolicyRef,
} from '@clocky/clocky-team/types'
export type { MessageId } from '@clocky/clocky-llm/brand'
export type { ContentBlock, StreamChunk } from '@clocky/clocky-llm/types'

/**
 * Build an empty Team latency histogram for deterministic wire fixtures.
 * @returns a zero-sample histogram in the Team metrics wire shape.
 */
export function emptyTeamLatencyHistogram(): TeamMetricsSnapshot['taskLatency'] {
  const upperBounds: readonly (number | null)[] = [
    1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000, null,
  ]
  return {
    count: 0,
    sumMs: 0,
    buckets: upperBounds.map(upperBoundMs => ({ upperBoundMs, count: 0 })),
  }
}

/** Successful value returned by the connection-generation host handshake. */
export type HostDescription = import('@clocky/clocky-host-apiproxy/api').ResponseValue<'host.describe'>

import type { RpcResponse, RpcResult } from '@clocky/clocky-host-apiproxy/api'

/**
 * Unwrap a unary response: RpcResponse<T> -> RpcResult<T> (business code only
 * cares about the result slot).
 * @param response - the unary response.
 * @returns its result slot.
 */
export function resultOf<T>(response: RpcResponse<T>): RpcResult<T> {
  return response.result
}
