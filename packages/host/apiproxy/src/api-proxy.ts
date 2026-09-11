import { teamChannelInputRequestSchema, teamChannelAttachmentRequestSchema, teamWorkflowPlanListRequestSchema } from './api/teams.schema.ts'
import type { TeamChannelPostInput, TeamWorkflowPlanList } from './api/teams.ts'
import { teamChannelListInputSchema } from '@clocky/clocky-team/schema'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { TeamHumanActionResponseInput, TeamHumanActionResponseResult, HostHumanActionResponseScope, HostHumanActionUnavailableScope } from '@clocky/clocky-team'
import { teamHumanActionResponseInputSchema, taskAttemptIdSchema } from '@clocky/clocky-team'
import { isDeepStrictEqual } from 'node:util'
import { resolvePrincipalChannelText, getPrincipalChannelInvitation, acknowledgePrincipalChannelInvitation, createPrincipalChannelAdmission } from '@clocky/clocky-team-channel-admission/principal'
/**
 * Host-side ApiProxy implementation. Signature discipline: unary takes the
 * narrow RpcRequest<P> and echoes request.rpcId on the RpcResponse<T>.
 */

import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { z as zod } from 'zod'
import type { Context } from '@clocky/cordis'
import { installModelSelection, resolveAgentWorkspaceRoot } from '@clocky/clocky-agent'
import type { Agent, ModelSelection, ModelSelectionRef, AgentOptions, AgentStatus } from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-agent-presets/types'
import { AttachmentError, admitEncodedImages } from '@clocky/clocky-attachment'
import type { ImageAttachmentRef } from '@clocky/clocky-attachment'
import {
  TeamError,
  channelCloseInputSchema,
  channelSummarySelectionInputSchema,
  channelSummaryHumanProofInput,
  channelIdSchema,
  channelOpenInputSchema,
  jsonObjectSchema,
  participantIdSchema,
  participantInterruptRequestInputSchema,
  participantInviteInputSchema,
  participantPhaseTransitionInputSchema,
  teamArchiveInputSchema,
  teamGoalPhaseTransitionInputSchema,
  teamGoalUpdateInputSchema,
  teamResumeInputSchema,
  teamTaskCancelInputSchema,
  teamTaskCreateInputSchema,
  teamTaskDeleteInputSchema,
  teamTaskDetailsUpdateInputSchema,
  teamTaskReviewResolveInputSchema,
  teamHumanActionIdSchema,
  teamHumanActionSourceIdSchema,
  teamIdSchema,
} from '@clocky/clocky-team'
import type {
  ChannelCloseInput,
  ChannelEnvelopePostInput,
  ChannelOpenInput,
  ChannelSnapshot,
  EnvelopeId,
  ParticipantInterruptSnapshot,
  ParticipantInterruptRequestInput,
  ParticipantId,
  ParticipantInviteInput,
  ParticipantPhaseTransitionInput,
  ParticipantSnapshot,
  JsonObject,
  TaskAttemptResult,
  TeamHumanActionId,
  TeamHumanActionKind,
  TeamHumanActionSnapshot,
  TeamHumanActorProofInput,
  TeamSystemHumanActionProof,
  TeamSystemHumanActionProofSource,
  TeamSystemHumanActionScope,
  TeamId,
  TeamTaskSnapshot,
  TeamStateSnapshot,
  TeamMetricsSnapshot,
  TeamEnvelope,
  TeamGoalPhaseTransitionInput,
  TeamGoalUpdateInput,
  TeamResumeInput,
  TeamWorkflowPlanSnapshot,
  TeamTaskCancelInput,
  TeamTaskCreateInput,
  TeamTaskDeleteInput,
  TeamTaskDetailsUpdateInput,
  TeamTaskReviewResolveInput,
  TeamParticipantOwner,
} from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-human-actor'
import type {} from '@clocky/clocky-team-channel-summary'
import { TeamArtifactError } from '@clocky/clocky-team-artifact'
import type {} from '@clocky/clocky-team-artifact'
import { TeamRunError } from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-team-run'
import { createUserMessage, freezeMessage, ReasoningEffortId } from '@clocky/clocky-llm'
import { errorChain } from '@clocky/clocky-llm'
import type { MessageSource } from '@clocky/clocky-llm'
import { isAppendSurfaceEvent, isJsonValue } from '@clocky/clocky-session'
import type { JsonValue, Session, SessionEvent, SessionEventMap, SessionHeader, SessionId, UserMessage } from '@clocky/clocky-session'
import type { SessionPersistence } from '@clocky/clocky-session-persistence'
import { SessionQueryError, type SessionSearchCursor } from '@clocky/clocky-session-query'
import { isUserInvocable } from '@clocky/clocky-skill'
import type { Workspace, WorkspaceRecord } from '@clocky/clocky-workspace'
import {
  workspaceDomainState, workspaceRecord, WorkspaceId as brandWorkspaceId,
  WorkspaceMoveInvalidError, WorkspaceOrderInvalidError, WorkspaceUnknownSessionError,
} from '@clocky/clocky-workspace'
// Type-only: brings the `ctx.tools` Context merge into this program (viewFor reads presenters).
import {
  InvalidPresetIdError, PresetExistsError, PresetMountError,
  PresetNotWritableError, resolveSessionPreset, UnknownPresetError,
} from '@clocky/clocky-agent-presets'
import type { PresetBearingSession } from '@clocky/clocky-agent-presets'
import type {} from '@clocky/clocky-tools'
import type {
  ApiProxy, ConfigurableProviderView, CredentialView, GoalRef, HistoryEntry, HostFrame,
  ModelCatalogFailure, ModelProviderGroup,
  ModelReasoning, MuxFrame, PromptContentPart, QuestionResponsePayload, SessionListMetadata,
  SessionModels, SessionProjectionsBlock, SessionSearchItem,
  QueuedInboxItem, SessionSummary, SettingsNamespaceView, JobView, ToolEventView,
  WorkspaceId, WorkspaceView,
} from './api/index.ts'
import {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  flushLiveSessionLog,
  sessionLogExportDeps,
  sessionLogZipFilename,
  streamSessionLogZip,
  type SessionLogExportReady,
  type SessionLogCompressionLevel,
} from './session-export.ts'
import type { SessionRawArtifact } from '@clocky/clocky-session-persistence'
import {
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
  truncateUnicodeCodePoints,
} from './api/session-search.ts'
// Type-only: resolves `ctx.get('sessionProjections')` to the projection registry.
import type {} from '@clocky/clocky-session-projection'
// Type-only: resolves `ctx.get('tasks')` to the background job registry.
import type {} from '@clocky/clocky-jobs'
import type { JobSnapshot } from '@clocky/clocky-jobs'
// Type-only: resolves `ctx.get('sessionProjectionCache')` (the cold listing column).
import type {} from '@clocky/clocky-session-projection-cache'
// GoalError narrows domain rejections to their stable codes at the wire boundary.
import { GoalError } from '@clocky/clocky-goal'
import type { GoalRef as CoreGoalRef } from '@clocky/clocky-goal'
// Type-only edges: resolve the command-change stream and `ctx.get('skills')`.
import type {} from '@clocky/clocky-commands'
// Type-only: the dynamic-package runner's forwarded-event declarations. Its
// client-safe `./types` subpath deliberately, not the package root — the root
// merges `ctx.dynamicCordisRunner`, and a dependency on that package would
// rebuild the api-remotes cycle this direction exists to avoid.
import type {} from '@clocky/clocky-cordis-host-runner/types'
import type {} from '@clocky/clocky-skill'
// The settings/credentials seams: brand guards run at this wire boundary; the
// service reads stay optional (`ctx.get`) so a composition without either
// provider still serves every other domain.
import { SettingsConflictError, settingsNamespace } from '@clocky/clocky-settings'
import type { SettingsDescriptor, SettingsNamespace, SettingsPathOp } from '@clocky/clocky-settings'
import { credentialRef } from '@clocky/clocky-credentials'
// Value edge: the rename impl narrows the title service's validation failure; the import also resolves `ctx.get('sessionTitle')`.
import { SessionTitleInvalidError } from '@clocky/clocky-session-title'
import type { CallId } from '@clocky/clocky-llm/brand'
import type { ScopeKey } from '@clocky/clocky-scope'
import type { ApprovalOutcome, ApprovalRequestId } from '@clocky/clocky-user-approval'
// Side-effect type import: resolves the `approval/request` waterfall and
// `ctx.get('approval')` without a value dependency on the seam (optional composition).
import type {} from '@clocky/clocky-user-approval'
import { approvalResponsePayloadSchema } from './api/approvals.schema.ts'
import { imageLimitsProjectionSchema, sessionListMetadataProjectionSchema } from './api/sessions.schema.ts'
import { questionResponsePayloadSchema } from './api/questions.schema.ts'
import type { ClientResponse, RpcError, RpcReceipt, RpcRequest, RpcResponse } from './api/rpc.ts'
import { RpcId } from './api/rpc.ts'
import type { TeamArtifactReadResult, TeamAuditList, TeamFinal, TeamStartResult } from './api/teams.ts'
import type {
  AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest,
} from '@clocky/clocky-user-questions'
import { UserQuestionError } from '@clocky/clocky-user-questions'
import { DirectoryPickerError } from '@clocky/clocky-host-directory-picker'
import {
  ApiRemoteSessionNotFound as SessionNotFound,
  API_REMOTE_FORWARDED_EVENTS,
  apiRemoteSubagentOwnershipError,
  apiRemoteTeamOwnershipError,
  createApiRemoteAgentResolver,
  hasApiRemoteSubagentOwner,
  hasApiRemoteTeamOwner,
  inspectApiRemoteSession,
} from '@clocky/clocky-api-remotes'
import { canOpenNativePath, openNativePath, openNativeTextFile } from './native-path-opener.ts'
import { currentAuthenticatedProductCall, withAuthenticatedProductCall } from './authenticated-product-call.ts'

/** Page size when history is called without maxMessages. */
const DEFAULT_MAX_MESSAGES = 50

/** Provider work budget: at most 100 calls and 2,000 inspected hits. */
const SESSION_SEARCH_PROVIDER_CALL_LIMIT = 100

/** Bound cold-log stat fan-out and settle each started batch before cancellation returns. */
const COLD_SUMMARY_BATCH_SIZE = 16
/** Default maximum artifact size eligible for one cold blankness read. */
export const DEFAULT_COLD_BLANK_PROBE_MAX_BYTES = 1024
/** Fixed host-side safety bound for one browser artifact response. */
const MAX_TEAM_ARTIFACT_READ_BYTES = 8 * 1024 * 1024

/** Conversation message event types (the pagination counting unit). */
const MESSAGE_TYPES = new Set(['user/message', 'team/channel-view', 'assistant/message'])

/** Recognize a Team-envelope source without making Host depend on the delivery Consumer package. */
function isTeamSteeringSource(source: MessageSource): boolean {
  const candidate = source as unknown as { readonly kind?: string; readonly delivery?: string }
  return candidate.kind === 'team-envelope' && candidate.delivery === 'steer'
}

type DurablePromptContent = Array<
  | { type: 'text'; text: string }
  | { type: 'image'; attachment: ImageAttachmentRef }
>

/** Validate one prompt as a batch before publishing any durable image object. */
async function durablePromptContent(ctx: Context, content: readonly PromptContentPart[]): Promise<DurablePromptContent> {
  if (content.every(part => part.type === 'text')) {
    return content.map(part => ({ type: 'text', text: part.text }))
  }
  const refs = await admitEncodedImages(ctx.attachments, content.filter(part => part.type === 'image'))
  let next = 0
  return content.map(part => part.type === 'text'
    ? { type: 'text', text: part.text }
    // admitEncodedImages returns one reference per image part in order.
    : { type: 'image', attachment: refs[next++] as ImageAttachmentRef })
}

/** Resolve optional wire fields into one complete actor-free Hub post command. */
function channelPostCommandInput(input: TeamChannelPostInput): ChannelEnvelopePostInput {
  return {
    expectedCursor: input.expectedCursor,
    ...input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey },
    draft: {
      channelId: input.channelId, audience: input.audience, kind: input.kind, payload: input.payload, delivery: input.delivery,
      ...input.priority === undefined ? {} : { priority: input.priority },
      ...input.causationId === undefined ? {} : { causationId: input.causationId },
      ...input.correlationId === undefined ? {} : { correlationId: input.correlationId },
      ...input.taskId === undefined ? {} : { taskId: input.taskId },
      ...input.traceId === undefined ? {} : { traceId: input.traceId },
      ...input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs },
    },
  }
}

/** Search durable content for an image reference, including nested tool results. */
function imageBlockIn(content: unknown, match: (ref: ImageAttachmentRef) => boolean): ImageAttachmentRef | undefined {
  if (!Array.isArray(content)) return undefined
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { type?: unknown; attachment?: unknown; content?: unknown }
    if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as ImageAttachmentRef
      if (match(ref)) return ref
    }
    if (block.type === 'tool-result') {
      const nested = imageBlockIn(block.content, match)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Search every durable event carrier that can own model-visible content. */
function imageInEvent(event: SessionEvent, match: (ref: ImageAttachmentRef) => boolean): ImageAttachmentRef | undefined {
  const data = event.data as {
    content?: unknown
    message?: { content?: unknown }
    inserted?: Array<{ content?: unknown }>
    chunk?: { type?: unknown; block?: unknown }
  }
  const direct = imageBlockIn(data.content, match)
  if (direct !== undefined) return direct
  if (data.message !== undefined) {
    const wrapped = imageBlockIn(data.message.content, match)
    if (wrapped !== undefined) return wrapped
  }
  if (data.inserted !== undefined) {
    for (const message of data.inserted) {
      const inserted = imageBlockIn(message.content, match)
      if (inserted !== undefined) return inserted
    }
  }
  if (event.type === 'assistant/chunk' && data.chunk?.type === 'block-end') {
    return imageBlockIn([data.chunk.block], match)
  }
  return undefined
}

/** Resolve the first reference matching one opaque id. */
function referencedImage(events: readonly SessionEvent[], attachmentId: string): ImageAttachmentRef | undefined {
  for (const event of events) {
    const found = imageInEvent(event, ref => String(ref.attachmentId) === attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}

/** Strict browser-zone profile: UTC or an IANA Area/Location-style identifier. */
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/

/** Validate and canonicalize one browser-supplied IANA zone at the wire boundary. */
function canonicalClientTimeZone(value: string): string | undefined {
  if (value.length === 0 || value.trim() !== value
    || (value !== 'UTC' && !IANA_TIME_ZONE.test(value))) return undefined
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: value })
      .resolvedOptions().timeZone
    /* v8 ignore next -- Intl returns UTC or a canonical IANA Area/Location for accepted input. */
    if (canonical !== 'UTC' && !IANA_TIME_ZONE.test(canonical)) return undefined
    return canonical
  } catch {
    // Intl rejects unsupported zone names; the RPC maps that parser rejection below.
    return undefined
  }
}

/** Read live abort state across awaits without treating it as synchronously immutable. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Message-boundary pagination: count maxMessages append-origin messages
 * backwards from the window tail. Replacement copies never entered the
 * conversation a reader sees — they restate a shadowed range for the model
 * alone — so they consume no quota; the page stays one contiguous raw range,
 * which keeps a compaction's log-only `compaction/summary` record on the same page as its
 * replacement. The cut is the starting seq of the oldest message group (chunks
 * group via sourceEventSeqs — never cut mid-message). The tail page naturally
 * includes the in-progress partial.
 */
function paginate(
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
): { events: SessionEvent[]; hasMore: boolean } {
  const window = beforeSeq === undefined ? [...events] : events.filter(event => event.seq < beforeSeq)
  let count = 0
  let cut = 0
  for (let i = window.length - 1; i >= 0; i--) {
    const event = window[i] as SessionEvent
    if (!MESSAGE_TYPES.has(event.type) || !isAppendSurfaceEvent(event)) continue
    count++
    const sources = (event as { sourceEventSeqs?: number[] }).sourceEventSeqs
    let groupStart = event.seq
    if (sources !== undefined) {
      for (const source of sources) {
        if (source < groupStart) groupStart = source
      }
    }
    if (count >= maxMessages) {
      cut = groupStart
      break
    }
  }
  const page = window.filter(event => event.seq >= cut)
  return { events: page, hasMore: cut > 0 }
}

/** Wrap an ok result echoing the request's rpcId. */
function ok<T>(request: RpcRequest<unknown>, value: T): RpcResponse<T> {
  return { rpcId: request.rpcId, result: { ok: true, value } }
}

/**
 * Build the provider/model catalog over every registered route. Shared by the
 * session-scoped `session.models` and host-scoped `llm.models`. Catalog
 * membership stays advisory: an unlisted session selection remains valid for
 * provider dispatch, but is not injected back into the selector after its
 * owning catalog stops advertising it. Per-provider failures ride `failures`
 * without failing the sound groups; groups that advertise nothing are dropped.
 */
async function buildModelCatalog(ctx: Context): Promise<{
  groups: ModelProviderGroup[]
  failures: ModelCatalogFailure[]
}> {
  const catalog = await Promise.all(ctx.llm.listProviders().map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...effort.description === undefined
                ? {}
                : { description: effort.description },
            })),
            ...resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort },
          }
        return {
          id: model.id,
          name: model.name,
          ...model.description === undefined ? {} : { description: model.description },
          ...reasoning === undefined ? {} : { reasoning },
        }
      }))
      const group: ModelProviderGroup = {
        id: provider.id,
        name: provider.name,
        models: entries,
      }
      return { kind: 'group' as const, group }
    } catch (error: unknown) {
      const failure: ModelCatalogFailure = {
        id: provider.id,
        name: provider.name,
        message: error instanceof Error ? error.message : String(error),
      }
      return { kind: 'failure' as const, failure }
    }
  }))
  return {
    groups: catalog.flatMap(item => item.kind === 'group' ? [item.group] : []).filter(group => group.models.length > 0),
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}

/** Wrap an error result echoing the request's rpcId. */
function err<T>(request: RpcRequest<unknown>, error: RpcError): RpcResponse<T> {
  return { rpcId: request.rpcId, result: { ok: false, error } }
}

/**
 * The RPC refusal a preset failure becomes, or undefined when the failure is
 * about something else.
 *
 * Both the session-create path and the switch path can be handed the same two
 * failures, and a client that has to branch on the code needs them worded the
 * same from either.
 * @param request - the request being answered.
 * @param error - the thrown value.
 * @returns the refusal, or undefined when the caller should keep handling.
 */
function presetFailure(request: RpcRequest<unknown>, error: unknown): RpcResponse<never> | undefined {
  if (error instanceof UnknownPresetError) {
    return err(request, {
      code: 'agent-preset-not-found',
      message: error.message,
      details: { agentPreset: error.presetId, available: [...error.available] },
    })
  }
  if (error instanceof PresetMountError) {
    return err(request, {
      code: 'agent-preset-invalid',
      message: error.message,
      details: { agentPreset: error.presetId, reason: error.reason },
    })
  }
  return undefined
}

/** Simple async queue: core callbacks push, the AsyncIterable pulls; abort/return cleans up. */
class FrameQueue<F> {
  private buffer: F[] = []
  private waiter: (() => void) | undefined
  private done = false

  push(item: F): void {
    if (this.done) return
    this.buffer.push(item)
    this.waiter?.()
  }

  end(): void {
    this.done = true
    this.waiter?.()
  }

  async *iterate(signal: AbortSignal, cleanup: () => void): AsyncGenerator<F> {
    const onAbort = (): void => { this.end() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (true) {
        while (this.buffer.length > 0) yield this.buffer.shift() as F
        if (this.done || signal.aborted) return
        await new Promise<void>((resolve) => { this.waiter = resolve })
        this.waiter = undefined
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      cleanup()
    }
  }
}

/**
 * Server-side frame mint: pure pushes get a fresh rpcId per frame (answerable
 * frames — approval/question requested — mint their stable id in their
 * pending registries instead).
 */
function frame<F>(payload: F): RpcRequest<F> {
  return { rpcId: RpcId(randomUUID()), payload }
}

/**
 * Narrow one allowlisted host event's argument list to the JSON values the
 * wrapper frame carries. A rejected argument is an allowlist mistake (the
 * forwarded path applies no projection), not hostile input, so it throws rather
 * than degrading to a lossy frame. The throw surfaces where the forwarding
 * listener runs, so the emitter's own listener containment logs it and drops
 * that frame — loud in the Host log, not at load or at the emit. Exported for
 * the test that owns this decision: every currently allowlisted event has a
 * statically JSON-safe payload, so a type-legal `ctx.emit` cannot reach the
 * rejection branch.
 * @param event - forwarded host event name, named in the failure.
 * @param args - the emitter's argument list.
 * @returns the same arguments typed as JSON values.
 */
export function assertJsonArgs(event: string, args: readonly unknown[]): JsonValue[] {
  for (const [index, arg] of args.entries()) {
    if (!isJsonValue(arg)) {
      throw new Error(`forwarded host event "${event}" argument ${index} is not lossless JSON data`)
    }
  }
  return args as JsonValue[]
}

/** Queue the subscription baseline frame. */
function subscribeSession(queue: FrameQueue<RpcRequest<MuxFrame>>, session: Session): void {
  queue.push(frame({ type: 'session/subscribed', sessionId: session.id, lastSeq: session.seq - 1 }))
}

/**
 * Project registry snapshots onto the wire view, dropping the three internal
 * fields {@link JobView} documents as absent.
 */
function jobViews(snapshots: readonly JobSnapshot[]): JobView[] {
  return snapshots.map(job => ({
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    ...job.detail === undefined ? {} : { detail: job.detail },
    startedAt: job.startedAt,
    ...job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt },
  }))
}

/**
 * Whether the session's conversation has started: no turn has run yet (a
 * turn is one model-loop execution). Standalone plugin events — command
 * lifecycle records, plan/mode, titles, goals — never open a turn, so
 * running `/plan` or `/goal` on a fresh session keeps it blank
 * (list-hidden, reusable).
 */
function sessionBlank(session: Session): boolean {
  return !session.events.some(event => event.type === 'turn/start')
}

/** Advance the Session-list hint projection by one committed event. */
function applySessionListMetadata(state: SessionListMetadata, event: SessionEvent): SessionListMetadata {
  const blank = state.blank && event.type !== 'turn/start'
  const lastPromptAt = event.type === 'user/message' && event.data.source.kind === 'user'
    ? event.time
    : state.lastPromptAt
  return blank === state.blank && lastPromptAt === state.lastPromptAt
    ? state
    : { blank, lastPromptAt }
}

/** Fold exact list metadata for an attached Session. */
function sessionListMetadata(events: readonly SessionEvent[]): SessionListMetadata {
  let state: SessionListMetadata = { blank: true, lastPromptAt: null }
  for (const event of events) state = applySessionListMetadata(state, event)
  return state
}

/** Sort by creation or latest human prompt, whichever is newer. */
function sessionListUpdatedAt(header: SessionHeader, metadata: SessionListMetadata | undefined): number {
  return Math.max(header.createdAt, metadata?.lastPromptAt ?? 0)
}

/** Shared Session-header projection for list baselines and creation frames. */
function sessionListFields(header: SessionHeader, events: readonly SessionEvent[] = []): {
  cwd?: string
  agentPreset?: string
} {
  // The preset comes from the log, not the header: a session that switched
  // while blank ran its turns under the newer composition, and a picker
  // showing the creation-time value would contradict what the model saw.
  const agentPreset = resolveSessionPreset({ header, events })
  return {
    ...header.cwd === undefined ? {} : { cwd: header.cwd },
    ...agentPreset === undefined ? {} : { agentPreset },
  }
}

/** SessionSummary projection for attached (in-memory) sessions. */
function summarize(session: Session, running: boolean): SessionSummary {
  const metadata = sessionListMetadata(session.events)
  return {
    sessionId: session.id,
    updatedAt: sessionListUpdatedAt(session.header, metadata),
    running,
    blank: metadata.blank,
    ...sessionListFields(session.header, session.events),
  }
}

/**
 * Verify a possibly blank cold Session only when its physical artifact passes
 * the configured per-Session size check. A stale `blank: true`, an
 * absent cache row, a large or location-less artifact, and read failures all
 * resolve to visible (`false`); listing must never hide a conversation on a
 * cache hint or an unavailable optimization.
 */
async function probeColdSessionMetadata(
  ctx: Context,
  persistence: SessionPersistence,
  meta: SessionHeader,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<SessionListMetadata | undefined> {
  if (maxBytes === 0) return undefined
  signal?.throwIfAborted()
  const location = persistence.locate(meta)
  if (location === undefined) return undefined
  signal?.throwIfAborted()
  let size: number
  try {
    size = (await stat(location.path)).size
  } catch {
    signal?.throwIfAborted()
    return undefined
  }
  if (size > maxBytes) return undefined
  try {
    const { events } = await persistence.readFrom(meta.id, 0, signal)
    signal?.throwIfAborted()
    return sessionListMetadata(events)
  } catch (error) {
    signal?.throwIfAborted()
    ctx.logger.warn(`session.list: blank probe for "${meta.id}" failed (serving it as visible): ${String(error)}`)
    return undefined
  }
}

/** SessionSummary projection for a cold persisted Session. */
async function summarizeCold(
  ctx: Context,
  persistence: SessionPersistence,
  meta: SessionHeader,
  metadata: SessionListMetadata | undefined,
  blankProbeMaxBytes: number,
  signal?: AbortSignal,
): Promise<SessionSummary> {
  const probed = metadata?.blank === false
    ? undefined
    : await probeColdSessionMetadata(ctx, persistence, meta, blankProbeMaxBytes, signal)
  return {
    sessionId: meta.id,
    updatedAt: sessionListUpdatedAt(meta, probed ?? metadata),
    running: false,
    blank: metadata?.blank === false ? false : probed?.blank ?? false,
    // Header-only: reading the log for a blank-window preset switch would
    // defeat the same index read, and attaching the session replaces this row
    // with `summarize()`, which resolves the switch from the events.
    ...sessionListFields(meta),
  }
}

/** Map a browse-primitive failure onto the wire error vocabulary (unknown throws stay internal). */
function directoryError(error: unknown): RpcError {
  if (error instanceof DirectoryPickerError) {
    return { code: error.code, message: error.message, details: { path: error.path } }
  }
  return { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} }
}

/** Resolved Agent model and project-directory defaults consumed by the API implementation. */
export interface ApiProxyDefaults {
  /**
   * The model selection a session starts from when its own log names none. Read on
   * every access rather than captured, so a default saved during this process
   * reaches the sessions that have not run a turn yet.
   */
  defaultModelSelection: () => ModelSelection | undefined
  /**
   * Record a selection as the new default. Either absent, or a closure that
   * may itself decline — the gateway plugin always passes one, and it no-ops
   * when the deployment mounts no settings provider or when the write races
   * service teardown. A switch then stays process-local. A rejection is
   * reported and swallowed: the switch already applies to its own session,
   * and undoing it because storage failed would be the worse outcome.
   */
  saveDefaultModelSelection?: (selection: ModelSelection) => Promise<void>
  /** Default project directory for new sessions whose create request carries no cwd. */
  cwd: string
  /** Native open-with-default-application; injectable for carrier tests. */
  openPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native text-editor handoff; injectable for settings-document tests. */
  openTextFile?: (path: string, signal: AbortSignal) => Promise<void>
  /** Validated DEFLATE level for session-log ZIP entries; defaults to 6. */
  sessionExportCompressionLevel?: SessionLogCompressionLevel
  /** Maximum artifact size eligible for one cold blankness read. */
  coldBlankProbeMaxBytes?: number
  /**
   * Whether handing a path to the native opener can work at all — the
   * `hasDocument` capability the preset roster reports, and the switch
   * between opening a preset directory and answering its path as text.
   * Absent, an injected `openPath` counts as openable and everything else
   * falls back to platform detection ({@link canOpenNativePath}).
   */
  canOpenPath?: () => boolean
}

/** The tool/call payload fields the presenter path reads. */
interface ToolCallData { callId: string; name: string; arguments: string }
/**
 * One outstanding approval question: the stable server-request id, the frame
 * material replayed to late mux subscribers, and the resolver that settles the
 * answerer's promise back into `ctx.approval`.
 */
interface PendingApproval {
  answerClaimed?: boolean
  rpcId: RpcId
  sessionId: SessionId
  approvalId: ApprovalRequestId
  toolName: string
  callId?: CallId
  reason?: string
  teamId?: TeamId
  participantId?: ParticipantId
  taskId?: TeamTaskSnapshot['id']
  resolve(outcome: ApprovalOutcome): void
}

/** Project a pending entry into its answerable mux frame (initial push and mux-open replay share it). */
function requestedFrame(pending: PendingApproval): RpcRequest<MuxFrame> {
  return {
    rpcId: pending.rpcId,
    payload: {
      type: 'approval/requested',
      sessionId: pending.sessionId,
      approvalId: pending.approvalId,
      toolName: pending.toolName,
      ...pending.callId === undefined ? {} : { callId: pending.callId },
      ...pending.reason === undefined ? {} : { reason: pending.reason },
      ...pending.teamId === undefined ? {} : { teamId: pending.teamId },
      ...pending.participantId === undefined ? {} : { participantId: pending.participantId },
      ...pending.taskId === undefined ? {} : { taskId: pending.taskId },
    },
  }
}

/** One host-owned question wait, addressed by the stable server-request id. */
interface PendingQuestion {
  answerClaimed?: boolean
  rpcId: RpcId
  sessionId: SessionId
  questions: AskUserQuestionItem[]
  resolve: (answer: AskUserQuestionAnswer) => void
  reject: (error: UserQuestionError) => void
  signal?: AbortSignal
  onAbort?: () => void
  teamId?: TeamId
  participantId?: ParticipantId
  taskId?: TeamTaskSnapshot['id']
}

const HOST_API_PROXY_HUMAN_ACTION_PROOF_SOURCE = 'host-api-proxy'

/** Retain the Host-only proof issuer associated with one ApiProxy context. */
const hostHumanActionProofIssuers = new WeakMap<Context, HostHumanActionProofIssuer>()

/** Own one-shot authority for Host-verified Team approval/question actions. */
class HostHumanActionProofIssuer {
  private readonly proofs = new Map<TeamSystemHumanActionProof, TeamSystemHumanActionScope>()
  private readonly pendingActions = new Map<TeamHumanActionId, TeamHumanActionSnapshot>()
  private readonly proofChecks = new Map<TeamSystemHumanActionProof, () => boolean>()
  private closed = false

  /** Source registered while this ApiProxy context owns verified interaction entries. */
  readonly source: TeamSystemHumanActionProofSource = Object.freeze({
    name: HOST_API_PROXY_HUMAN_ACTION_PROOF_SOURCE,
    resolveHumanActionProof: (proof: TeamSystemHumanActionProof): TeamSystemHumanActionScope | undefined =>
      this.resolve(proof),
  })

  /** Issue one exact pending-action proof and retain its action only after Hub acceptance. */
  async upsert<T>(
    input: { readonly teamId: TeamId; readonly expectedCursor: number; readonly action: TeamHumanActionSnapshot },
    operation: (actor: TeamSystemHumanActionProof) => Promise<T>,
  ): Promise<T> {
    const result = await this.withProof({ kind: 'host-human-action-upsert', ...input }, operation)
    this.pendingActions.set(input.action.id, freezeHumanAction(structuredClone(input.action)))
    return result
  }

  /** Issue one exact terminal-action proof for an action this Host previously admitted. */
  async resolveAction<T>(
    input: {
      readonly teamId: TeamId
      readonly expectedCursor: number
      readonly actionId: TeamHumanActionId
      readonly phase: 'resolved' | 'cancelled'
      readonly outcome: JsonObject
    },
    operation: (actor: TeamSystemHumanActionProof) => Promise<T>,
  ): Promise<T> {
    this.assertOpen()
    const action = this.pendingActions.get(input.actionId)
    if (action === undefined || action.teamId !== input.teamId) {
      throw new TeamError('Host human-action entry is no longer verified', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const result = await this.withProof({
      kind: 'host-human-action-resolve',
      teamId: input.teamId,
      expectedCursor: input.expectedCursor,
      action,
      phase: input.phase,
      outcome: input.outcome,
    }, operation)
    this.pendingActions.delete(input.actionId)
    return result
  }

  /** Check whether this runtime still owns an accepted interaction or in-flight settlement. */
  hasVerifiedAction(actionId: TeamHumanActionId): boolean { return this.pendingActions.has(actionId) }

  /** Persist one caller-authenticated response while its exact callback remains owned. */
  async acceptResponse<T>(
    scope: Omit<HostHumanActionResponseScope, 'kind' | 'action'>,
    isCurrent: () => boolean,
    operation: (actor: TeamSystemHumanActionProof) => Promise<T>,
  ): Promise<T> {
    const action = this.pendingActions.get(scope.input.actionId)
    if (action === undefined) throw new TeamError('Host response continuation is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
    return await this.withProof({ kind: 'host-human-action-response-accept', ...scope, action }, operation, isCurrent)
  }

  /** Failure-only authority cannot recreate a successful response callback from durable data. */
  async unavailable<T>(
    scope: Omit<HostHumanActionUnavailableScope, 'kind'>,
    isCurrent: () => boolean,
    operation: (actor: TeamSystemHumanActionProof) => Promise<T>,
  ): Promise<T> {
    return await this.withProof({ kind: 'host-human-action-unavailable', ...scope }, operation,
      () => isCurrent() && !this.pendingActions.has(scope.action.id))
  }

  /** Forget an action after a terminal persistence failure no longer retries it. */
  forget(actionId: TeamHumanActionId): void {
    this.pendingActions.delete(actionId)
  }

  /** Invalidate every outstanding proof and verified action during ApiProxy teardown. */
  close(): void {
    this.closed = true
    this.proofs.clear()
    this.proofChecks.clear()
    this.pendingActions.clear()
  }

  /** Retain one proof only until its matching TeamRuntime call settles. */
  private async withProof<T>(
    scope: TeamSystemHumanActionScope,
    operation: (actor: TeamSystemHumanActionProof) => Promise<T>,
    isCurrent?: () => boolean,
  ): Promise<T> {
    this.assertOpen()
    const proof = createHostHumanActionProof()
    this.proofs.set(proof, freezeHumanActionScope(structuredClone(scope)))
    if (isCurrent !== undefined) this.proofChecks.set(proof, isCurrent)
    try {
      return await operation(proof)
    } finally {
      this.proofs.delete(proof)
      this.proofChecks.delete(proof)
    }
  }

  /** Resolve only a live one-shot proof retained by this exact Host issuer. */
  private resolve(proof: TeamSystemHumanActionProof): TeamSystemHumanActionScope | undefined {
    return this.closed || this.proofChecks.get(proof)?.() === false ? undefined : this.proofs.get(proof)
  }

  /** Reject issuance after ApiProxy teardown before a proof reaches the Hub. */
  private assertOpen(): void {
    if (this.closed) throw new TeamError('Host human-action proof issuer is closed', 'TEAM_ACTOR_PROOF_INVALID')
  }
}

/** Create one non-serializable proof that only the Host ApiProxy source can resolve. */
function createHostHumanActionProof(): TeamSystemHumanActionProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Host human-action proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemHumanActionProof
}

/** Freeze one action value retained by the private issuer without exposing caller mutation. */
function freezeHumanAction(action: TeamHumanActionSnapshot): TeamHumanActionSnapshot {
  Object.freeze(action)
  Object.freeze(action.details)
  if (action.outcome !== undefined) Object.freeze(action.outcome)
  return action
}

/** Freeze a detached system scope before retaining it behind an opaque proof. */
function freezeHumanActionScope(scope: TeamSystemHumanActionScope): TeamSystemHumanActionScope {
  Object.freeze(scope)
  freezeHumanAction(scope.action)
  if (scope.kind === 'host-human-action-resolve') Object.freeze(scope.outcome)
  return scope
}

/** Return the sole Host issuer for this ApiProxy context, registering it on first Team use. */
function hostHumanActionProofIssuer(ctx: Context): HostHumanActionProofIssuer | undefined {
  const existing = hostHumanActionProofIssuers.get(ctx)
  if (existing !== undefined) return existing
  const teams = ctx.get('teams')
  if (teams === undefined) return undefined
  const issuer = new HostHumanActionProofIssuer()
  const unregister = teams.registerSystemHumanActionProofSource(issuer.source)
  hostHumanActionProofIssuers.set(ctx, issuer)
  ctx.effect(() => () => {
    issuer.close()
    unregister()
    if (hostHumanActionProofIssuers.get(ctx) === issuer) hostHumanActionProofIssuers.delete(ctx)
  }, 'api-proxy: human-action proof source')
  return issuer
}

/** Resolve Team/Participant/task provenance from a Session header and latest task assignment. */
function interactionProvenance(session: Pick<Session, 'header' | 'events'>): {
  readonly teamId?: TeamId
  readonly participantId?: ParticipantId
  readonly taskId?: TeamTaskSnapshot['id']
} {
  const team = teamIdSchema.safeParse(session.header.teamId)
  const participant = participantIdSchema.safeParse(session.header.participantId)
  const latestAssignment = [...session.events].reverse().find(event => event.type === 'user/message'
    && (event.data.source as { kind?: unknown }).kind === 'team-task-assignment')
  const rawTaskId = latestAssignment?.type === 'user/message'
    ? (latestAssignment.data.source as { taskId?: unknown }).taskId
    : undefined
  const task = typeof rawTaskId === 'string' ? rawTaskId as TeamTaskSnapshot['id'] : undefined
  return {
    ...team.success ? { teamId: team.data } : {},
    ...participant.success ? { participantId: participant.data } : {},
    ...task === undefined ? {} : { taskId: task },
  }
}

/** Build a stable Team-owned interaction identity from its source request. */
function teamHumanActionId(
  kind: TeamHumanActionKind,
  sessionId: SessionId,
  sourceId: string,
): TeamHumanActionId {
  return teamHumanActionIdSchema.parse(`${kind}:${String(sessionId)}:${sourceId}`)
}

/** Persist one pending Team interaction when its Session carries complete Team provenance. */
async function persistPendingTeamAction(
  ctx: Context,
  input: {
    readonly sessionId: SessionId
    readonly kind: TeamHumanActionKind
    readonly sourceId: string
    readonly details: JsonObject
    readonly participantId?: ParticipantId
    readonly teamId?: TeamId
    readonly taskId?: TeamTaskSnapshot['id']
  },
  isVerifiedPending: () => boolean,
): Promise<TeamHumanActionSnapshot | undefined> {
  if (input.teamId === undefined || input.participantId === undefined || !isVerifiedPending()) return undefined
  const teamId = input.teamId
  const teams = ctx.get('teams')
  if (teams === undefined) return undefined
  const issuer = hostHumanActionProofIssuer(ctx)
  if (issuer === undefined) return undefined
  const source = input.taskId === undefined ? undefined : [...(ctx.get('sessions')?.get(input.sessionId)?.events ?? [])].reverse()
    .find(event => event.type === 'user/message' && (event.data.source as { taskId?: unknown }).taskId === input.taskId)
  const attempt = source?.type === 'user/message'
    ? taskAttemptIdSchema.safeParse((source.data.source as { attemptId?: unknown }).attemptId) : undefined
  const action: TeamHumanActionSnapshot = {
    ...(attempt?.success === true ? { attemptId: attempt.data } : {}),
    id: teamHumanActionId(input.kind, input.sessionId, input.sourceId),
    teamId,
    kind: input.kind,
    phase: 'pending',
    sessionId: input.sessionId,
    participantId: input.participantId,
    ...input.taskId === undefined ? {} : { taskId: input.taskId },
    sourceId: teamHumanActionSourceIdSchema.parse(input.sourceId),
    details: structuredClone(input.details),
    createdAt: 0,
    updatedAt: 0,
  }
  // Timestamps are Hub-owned; the zero placeholders satisfy the wire shape and
  // are replaced by TeamHub on the first durable append.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!isVerifiedPending()) return undefined
    const state = await teams.getTeam({ teamId })
    if (!isVerifiedPending()) return undefined
    try {
      return await issuer.upsert({
        teamId,
        expectedCursor: state.team.cursor,
        action,
      }, async actor => await teams.upsertHumanAction({
        actor,
        teamId,
        expectedCursor: state.team.cursor,
      }))
    } catch (error: unknown) {
      if (error instanceof TeamError && error.code === 'TEAM_CURSOR_CONFLICT') continue
      throw error
    }
  }
  throw new TeamError(`Team '${teamId}' human-action cursor changed repeatedly`, 'TEAM_CURSOR_CONFLICT')
}

/** Persist a terminal Team interaction state without making response delivery depend on the mux. */
async function persistResolvedTeamAction(
  ctx: Context,
  input: {
    readonly sessionId: SessionId
    readonly kind: TeamHumanActionKind
    readonly sourceId: string
    readonly phase: 'resolved' | 'cancelled'
    readonly outcome: JsonObject
    readonly teamId?: TeamId
  },
): Promise<void> {
  if (input.teamId === undefined) return
  const teamId = input.teamId
  const teams = ctx.get('teams')
  if (teams === undefined) return
  const actionId = teamHumanActionId(input.kind, input.sessionId, input.sourceId)
  const issuer = hostHumanActionProofIssuers.get(ctx)
  if (issuer === undefined) {
    ctx.logger.warn(`api-proxy: no verified Host human-action entry exists for '${String(actionId)}'`)
    return
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let state: TeamStateSnapshot
    try {
      state = await teams.getTeam({ teamId })
    } catch (error: unknown) {
      ctx.logger.warn(`api-proxy: could not read Team '${input.teamId}' while resolving human-action '${String(actionId)}': ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    try {
      await issuer.resolveAction({
        teamId,
        expectedCursor: state.team.cursor,
        actionId,
        phase: input.phase,
        outcome: input.outcome,
      }, async actor => await teams.resolveHumanAction({
        actor,
        teamId,
        expectedCursor: state.team.cursor,
      }))
      return
    } catch (error: unknown) {
      if (error instanceof TeamError && error.code === 'TEAM_CURSOR_CONFLICT') continue
      // A restarted Host has no verified pending entry and therefore cannot
      // mint replacement authority. Keep the mux outcome authoritative and
      // leave this fail-closed persistence diagnostic for operators.
      issuer.forget(actionId)
      ctx.logger.warn(`api-proxy: could not persist Team human-action '${String(actionId)}': ${error instanceof Error ? error.message : String(error)}`)
      return
    }
  }
  issuer.forget(actionId)
  ctx.logger.warn(`api-proxy: Team human-action '${String(actionId)}' resolution cursor kept changing`)
}

/** Validate one answer batch against the exact question request it resolves. */
function matchesQuestions(payload: QuestionResponsePayload, pending: PendingQuestion): boolean {
  if (payload.sessionId !== pending.sessionId) return false
  const answers = payload.answer.answers
  if (answers.length !== pending.questions.length) return false
  return answers.every((answer, index) => {
    const question = pending.questions[index] as AskUserQuestionItem
    if (answer.id !== question.id) return false
    if (new Set(answer.selected).size !== answer.selected.length) return false
    const custom = answer.custom?.trim()
    if (custom !== undefined && custom === '') return false
    if (question.multiSelect !== true) {
      if (custom !== undefined && answer.selected.length > 0) return false
      if (answer.selected.length > 1) return false
    }
    const labels = new Set(question.options?.map(option => option.label) ?? [])
    return answer.selected.every(label => labels.has(label))
  })
}

/**
 * Compute the render intent for a tool/call or tool/result event through the
 * presenters registered at this moment; every other event type gets none. A
 * result's presenter needs its call's parsed args — `argsFor` supplies them
 * (live: the per-session call table; history: an in-page backscan), returning
 * undefined when the pairing is unavailable (e.g. the call fell off the page),
 * which soft-falls to no view. Presenter or JSON.parse throws also soft-fall:
 * the client's documented default (generic JSON card) covers every miss.
 */
function viewFor(
  ctx: Context,
  event: SessionEvent,
  argsFor: (callId: string) => unknown,
  // Presenters live with the definitions, and definitions live in the scope
  // chain: a preset registers its tools into its standing layer. A live agent
  // is a scope whose chain passes through its preset; a cold read passes the
  // preset's standing key directly — no agent, no resume. An undefined scope
  // sees only the global layer, which is the pre-preset deployment shape.
  scope?: ScopeKey,
): ToolEventView | undefined {
  try {
    if (event.type === 'tool/call') {
      const { name, arguments: raw } = event.data as ToolCallData
      const view = ctx.tools.get(name, scope)?.presentCall?.(JSON.parse(raw))
      return view === undefined ? undefined : { for: 'call', view }
    }
    if (event.type === 'tool/result') {
      const { message, meta } = event.data
      const [result] = message.content
      const callId = message.source.callId
      const call = argsFor(callId) as { name: string; args: unknown } | undefined
      if (call === undefined) return undefined
      const view = ctx.tools.get(call.name, scope)?.presentResult?.(call.args, {
        content: result.content,
        isError: result.isError === true,
        ...meta === undefined ? {} : { meta },
      })
      return view === undefined ? undefined : { for: 'result', view }
    }
  } catch (error: unknown) {
    // A throwing presenter (or unparseable arguments) must not break delivery;
    // the event still ships, just without a view.
    console.error(`api-proxy: presenter failed for ${event.type}, falling back to generic: ${String(error)}`)
  }
  return undefined
}

/**
 * Resolve a tool/result's call pairing by scanning a window of events backwards
 * for the matching tool/call. Used by the history path (the page is the
 * window — a cross-page pairing soft-falls to no view) and by live-path table
 * misses after a reconnect-eviction.
 */
function backscanArgs(events: readonly SessionEvent[], callId: string): { name: string; args: unknown } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as SessionEvent
    if (event.type !== 'tool/call') continue
    const data = event.data as ToolCallData
    if (data.callId !== callId) continue
    try {
      return { name: data.name, args: JSON.parse(data.arguments) }
    } catch {
      // Unparseable stored arguments: same soft-fall as a live parse failure.
      return undefined
    }
  }
  return undefined
}

/** Render one detached history page through the same presenter path as ordinary history. */
function historyPage(
  ctx: Context,
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number | undefined,
  scope?: ScopeKey,
): { events: HistoryEntry[]; hasMore: boolean } {
  const page = paginate(events, beforeSeq, maxMessages ?? DEFAULT_MAX_MESSAGES)
  return {
    events: page.events.map((event) => {
      const view = viewFor(ctx, event, callId => backscanArgs(page.events, callId), scope)
      return { event, ...view === undefined ? {} : { view } }
    }),
    hasMore: page.hasMore,
  }
}

/**
 * The projection baseline for one history tail page: the registry's
 * watermark-cache snapshot — one fully synchronous read (no await between the
 * page slice and this), so all values and `asOfSeq` form a single consistent
 * cut and `asOfSeq` equals the window tail event seq. The carrier holds zero
 * domain knowledge (each value passed its unit's own schema inside the
 * registry). An absent registry means the deployment has no projection seam:
 * the whole block is absent and clients treat every key as capability-absent.
 */
/**
 * Which session a transcript read is served from. An attached session is the
 * live object and keeps appending, so its events and projection baseline are
 * read together in one synchronous step; a detached one is already a frozen
 * inspection.
 */
type HistorySource =
  | { readonly kind: 'attached'; readonly session: Session }
  | { readonly kind: 'detached'; readonly header: SessionHeader; readonly events: SessionEvent[] }

function projectionsFor(ctx: Context, session: Session): SessionProjectionsBlock | undefined {
  const registry = ctx.get('sessionProjections')
  if (registry === undefined) return undefined
  return registry.snapshot(session)
}

/**
 * The projection baseline of one session.list row, fail-soft: attached
 * sessions cut the registry's live watermark cache; cold sessions view the
 * persisted projection cache's identity-checked stored rows (zero log loads
 * either way — the listing use case the cache exists for). The block shape
 * (values + asOfSeq) matches the history tail's, so a client seeds its
 * value store under the same higher-seq-wins rule. Any failure — and an
 * empty value set — yields an absent block: a listing without projections
 * is degraded, never broken.
 */
function listProjectionsFor(ctx: Context, meta: SessionHeader, session: Session | undefined): SessionProjectionsBlock | undefined {
  try {
    const block = session !== undefined
      ? ctx.get('sessionProjections')?.snapshot(session)
      : ctx.get('sessionProjectionCache')?.cachedSnapshot(meta)
    return block !== undefined && Object.keys(block.values).length > 0 ? block : undefined
  } catch (error) {
    ctx.logger.warn(`session.list: projection column for "${meta.id}" failed (serving the row without it): ${String(error)}`)
    return undefined
  }
}

/** Projection baseline for a detached history tail without Agent activation. */
function detachedProjectionsFor(
  ctx: Context,
  events: readonly SessionEvent[],
): SessionProjectionsBlock | undefined {
  const registry = ctx.get('sessionProjections')
  if (registry === undefined) return undefined
  return registry.restore({}, events, 0).snapshot
}

/** The roster is absent: this deployment composes no agent presets at all. */
function noRoster(agentPreset: string): RpcError {
  return {
    code: 'agent-preset-not-found',
    message: 'this deployment composes no agent presets',
    details: { agentPreset, available: [] },
  }
}

/** Map one authoring/roster failure onto its wire code. */
function presetError(agentPreset: string, error: unknown): RpcError {
  if (error instanceof UnknownPresetError) {
    return {
      code: 'agent-preset-not-found',
      message: error.message,
      details: { agentPreset: error.presetId, available: [...error.available] },
    }
  }
  if (error instanceof PresetNotWritableError) {
    return { code: 'agent-preset-read-only', message: error.message, details: { agentPreset, reason: error.message } }
  }
  if (error instanceof InvalidPresetIdError || error instanceof PresetExistsError) {
    return { code: 'agent-preset-invalid', message: error.message, details: { agentPreset, reason: error.message } }
  }
  return { code: 'internal', message: `agent preset "${agentPreset}": ${String(error)}`, details: {} }
}

/** An explicit Host naming operation would duplicate another Workspace title. */
class WorkspaceNameConflictError extends Error {
  constructor(readonly workspaceName: string) {
    super(`workspace name '${workspaceName}' is already in use`)
    this.name = 'WorkspaceNameConflictError'
  }
}

/** Shared workspace-not-found error response of the workspace.* mutation rows. */
function workspaceNotFound<T>(request: RpcRequest<unknown>, workspaceId: string): RpcResponse<T> {
  return err(request, {
    code: 'workspace-not-found',
    message: `workspace "${workspaceId}" not found`,
    details: { workspaceId },
  })
}

/** Wire projection of one workspace entity (the workspace.* value row). */
function workspaceView(workspace: Workspace): WorkspaceView {
  return {
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

/** Wire projection of the durable record carried by `domain/changed`. */
function changedWorkspaceView(workspaceId: string, value: unknown): WorkspaceView {
  const record: WorkspaceRecord = workspaceRecord.parse(value)
  return {
    workspaceId: workspaceId as WorkspaceId,
    path: record.path,
    title: record.title,
    sessionIds: [...record.sessionIds],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Remove private artifact metadata from browser-facing Team projections. */
function redactTeamStateForHuman(state: TeamStateSnapshot): TeamStateSnapshot {
  return {
    ...state,
    tasks: state.tasks.map(redactTaskForHuman),
    workspaceAllocations: state.workspaceAllocations.map(allocation => allocation.loss === undefined ? allocation : {
      ...allocation, loss: { ...allocation.loss, artifacts: allocation.loss.artifacts.filter(reference => reference.visibility !== 'private') },
    }),
  }
}

/** Remove private artifact metadata from one browser-facing task projection. */
function redactTaskForHuman(task: TeamTaskSnapshot): TeamTaskSnapshot {
  return {
    ...task,
    attemptHistory: task.attemptHistory.map((attempt) => {
      if (attempt.outcome.kind !== 'completed') return attempt
      return {
        ...attempt,
        outcome: {
          ...attempt.outcome,
          result: redactTaskResultForHuman(attempt.outcome.result),
        },
      }
    }),
  }
}

/** Retain only artifact fields that a human Team reader may inspect. */
function redactTaskResultForHuman(result: TaskAttemptResult): TaskAttemptResult {
  return {
    ...result,
    ...result.artifacts === undefined ? {} : { artifacts: result.artifacts.filter(artifact => artifact.visibility !== 'private') },
    ...result.integration === undefined ? {} : {
      integration: {
        ...result.integration,
        ...result.integration.proposalArtifact?.visibility === 'private' ? {} : result.integration.proposalArtifact === undefined ? {} : { proposalArtifact: result.integration.proposalArtifact },
        ...result.integration.artifacts === undefined ? {} : { artifacts: result.integration.artifacts.filter(artifact => artifact.visibility !== 'private') },
      },
    },
  }
}

/** Remove private artifact metadata from one browser-facing workflow plan result. */
function redactWorkflowPlanForHuman(plan: TeamWorkflowPlanSnapshot): TeamWorkflowPlanSnapshot {
  if (plan.result === undefined) return plan
  return {
    ...plan,
    result: {
      ...plan.result,
      tasks: plan.result.tasks.map(task => task.phase === 'completed'
        ? { ...task, result: redactTaskResultForHuman(task.result) }
        : task),
    },
  }
}

/**
 * Implement ApiProxy over a composed host context.
 * @param ctx - a context with the Host spine and Workspace registry mounted.
 * @param defaults - host routing and project-directory defaults.
 * @returns the ApiProxy implementation.
 */
export function createApiProxy(ctx: Context, defaults: ApiProxyDefaults): ApiProxy {
  const sessionExportCompressionLevel = defaults.sessionExportCompressionLevel
    ?? DEFAULT_SESSION_LOG_COMPRESSION_LEVEL
  const coldBlankProbeMaxBytes = defaults.coldBlankProbeMaxBytes
    ?? DEFAULT_COLD_BLANK_PROBE_MAX_BYTES
  /** The seed model each create/resume declares; re-read so it never goes stale. */
  const agentOptions = (): AgentOptions => {
    const selection = defaults.defaultModelSelection()
    return selection === undefined ? {} : { provider: selection.provider, model: selection.model }
  }
  type WebModelSelectionRef = ModelSelectionRef & { current: ModelSelection | undefined }
  const selections = new WeakMap<Agent, WebModelSelectionRef>()
  /**
   * Serializes `agentPreset.select` per session. Two concurrent selects both
   * pass the blank check, and the second `unmountPresetFor` then finds nothing
   * to unmount because the first already removed the record — leaving two
   * compositions registered into one agent layer. The client's `busy` flag is
   * not enforcement: the wire is reachable directly.
   */
  const presetSwitches = new Map<SessionId, Promise<unknown>>()
  /** Serializes path ownership and explicit title checks with Workspace mutations. */
  let workspaceCreationChain = Promise.resolve()
  const pendingQuestions = new Map<RpcId, PendingQuestion>()
  const pendingApprovals = new Map<RpcId, PendingApproval>()
  const muxQueues = new Set<FrameQueue<RpcRequest<MuxFrame>>>()
  const imageAdmissionChains = new WeakMap<Agent, Promise<void>>()
  hostHumanActionProofIssuer(ctx)

  /** Serialize image admission with model selection for one agent. */
  function serializeImageAdmission<T>(agent: Agent, operation: () => Promise<T>): Promise<T> {
    const result = (imageAdmissionChains.get(agent) ?? Promise.resolve()).then(operation)
    imageAdmissionChains.set(agent, result.then(() => undefined, () => undefined))
    return result
  }

  /**
   * Install or return the session-local model selection that prompt assembly snapshots.
   *
   * Precedence, resolved on EVERY read rather than seeded once: a selection
   * made in this process, else the session's own latest logged request/header,
   * else the live Agent default. Re-reading keeps the two tiers exact in both
   * directions: a session with a recorded request derives its selection from
   * its log, while a blank session (New Session reuses one rather than minting
   * another) reads any default saved after it was created. There is no create-time
   * per-session override tier on this wire — if one returns (a create-options
   * contribution), it must fold in between the selection and the log.
   */
  function selectionFor(agent: Agent): WebModelSelectionRef {
    const installed = selections.get(agent)
    if (installed !== undefined) return installed
    let picked: ModelSelection | undefined
    const selection: WebModelSelectionRef = {
      get current(): ModelSelection | undefined {
        if (picked !== undefined) return picked
        // Incrementally folded by the session, so a per-step read costs
        // O(new events) rather than a rescan.
        const logged = agent.session.requestHeader()?.config
        if (logged === undefined) return defaults.defaultModelSelection()
        return {
          provider: logged.provider,
          model: logged.model,
          ...logged.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: logged.reasoningEffort },
        }
      },
      set current(next: ModelSelection) {
        picked = next
      },
      assembled: undefined,
    }
    installModelSelection(agent.ctx, selection)
    selections.set(agent, selection)
    return selection
  }

  /** Pre-publication setup used by both fresh and resumed Web agents. */
  function installSelection(agentCtx: Context): void {
    const agent = agentCtx.agent
    if (agent === undefined) throw new Error('api-proxy: agent setup has no scoped agent')
    selectionFor(agent)
  }

  /**
   * Resolve the preset an agent will be composed from, and the setup that
   * installs it.
   *
   * The id is resolved BEFORE the session exists because the session boundary
   * snapshots `meta` before asynchronous setup begins — a preset discovered
   * during setup could never reach the header. Mounting still happens in
   * setup, where a failure rolls the whole creation back rather than leaving a
   * published session whose capabilities are half-installed.
   *
   * A deployment with no preset roster composes nothing and every session
   * shares the host composition, which is the behavior before presets existed.
   * @param presetId - the requested preset, or `undefined` for the default.
   * @returns the id to record on the header (absent without a roster) and the setup callback.
   * @throws when the roster supplies no such preset.
   */
  async function composeAgent(presetId: string | undefined): Promise<{
    agentPreset?: string
    setup: (agentCtx: Context) => Promise<void>
  }> {
    const presets = ctx.get('agentPresets')
    if (presets === undefined) {
      return {
        setup: (agentCtx: Context) => {
          installSelection(agentCtx)
          return Promise.resolve()
        },
      }
    }
    const resolvedId = (await presets.resolve(presetId)).id
    return {
      agentPreset: resolvedId,
      setup: async (agentCtx: Context) => {
        installSelection(agentCtx)
        await presets.mount(agentCtx, resolvedId)
      },
    }
  }

  const hasSubagentOwner = (
    session: Pick<Session, 'header'>,
    agent: Agent | undefined,
  ): boolean => hasApiRemoteSubagentOwner(ctx, session, agent)
  const hasTeamOwner = (session: Pick<Session, 'header'>): boolean =>
    hasApiRemoteTeamOwner(session)
  const subagentOwnershipError = (sessionId: SessionId): RpcError =>
    apiRemoteSubagentOwnershipError(sessionId)
  const teamOwnershipError = (sessionId: SessionId): RpcError =>
    apiRemoteTeamOwnershipError(sessionId)
  const inspectServable = (sessionId: SessionId): Promise<{ meta: SessionHeader; events: SessionEvent[] }> =>
    inspectApiRemoteSession(ctx, sessionId)
  // Cold resume composes the preset recorded by the session: its history was
  // produced under that composition.
  // Every generic entry point — prompt, models, commands — arrives here, so
  // leaving it out meant a session opened after a restart ran on host tools
  // and the deployment persona. Resolved from the LOG, not the header: a
  // session that switched while blank ran its turns under the newer
  // composition, and the header is written once at creation. Reading the
  // header here would silently undo the switch on the next restart and
  // restore that history under the old tool set.
  const agentFor = createApiRemoteAgentResolver(ctx, {
    agentOptions,
    setup: async ({ meta, events }) =>
      (await composeAgent(resolveSessionPreset({ header: meta, events }))).setup,
  })

  /** Send one transient frame to every connected mux consumer. */
  function broadcast(payload: MuxFrame): void {
    const envelope = frame(payload)
    for (const queue of muxQueues) queue.push(envelope)
  }

  // Projection change feed → session/projection push frames. The carrier
  // mints the wire frame (the Service Definition package holds no wire vocabulary); the
  // child activates only when a projection registry is composed, and the
  // subscription unwinds with this gateway's fiber.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.onChanged((session, key, value, seq) => {
      broadcast({ type: 'session/projection', sessionId: session.id, key, value, seq })
    })
  })

  // The cache supplies recency and a monotonic non-blank hint. A cached
  // `blank: true` remains only a prefix fact and is verified on the cold path.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'sessionListMetadata', SessionListMetadata>({
      key: 'sessionListMetadata',
      stateSchema: sessionListMetadataProjectionSchema,
      init: () => ({ blank: true, lastPromptAt: null }),
      apply: applySessionListMetadata,
      wire: { viewSchema: sessionListMetadataProjectionSchema, view: state => state },
      stateVersion: 1,
    })
  })

  // The imageLimits projection unit: the attachments config this proxy
  // enforces at prompt admission, constant per host boot. `apply` keeps the
  // same state reference for every event, so no change frames are ever
  // pushed — baselines alone carry the value — and clients pre-check intake
  // and label upload affordances from it. Registered here, not in the
  // attachment Service Definition: clocky-llm depends on clocky-attachment, so the
  // seam package cannot reference the projection registry without a cycle,
  // and the per-message rules the value describes are this proxy's own
  // admission checks. The child activates only while both seams are composed.
  // `view` reading the live service instead of the (null) state is sanctioned
  // exactly for boot-constant units: the value cannot change within a process
  // lifetime, so the fold stays observationally pure, and a stale persisted
  // cache row re-viewing to the current config is the correct outcome.
  ctx.inject(['sessionProjections', 'attachments'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'imageLimits', null>({
      key: 'imageLimits',
      stateSchema: zod.null(),
      init: () => null,
      apply: state => state,
      wire: { viewSchema: imageLimitsProjectionSchema, view: () => projectionCtx.attachments.imageLimits },
      stateVersion: 1,
    })
  })

  /** Project both durable inbox lists, optionally including the splice currently being emitted. */
  const queueItems = (
    agent: Agent,
    splice?: SessionEventMap['agent/inbox/spliced'],
  ): QueuedInboxItem[] => {
    const project = (target: 'next-turn' | 'next-step'): readonly UserMessage[] => {
      const messages = target === 'next-turn' ? agent.inbox.nextTurn : agent.inbox.nextStep
      return splice?.target === target
        ? messages.toSpliced(splice.start, splice.removedCount ?? 0, ...splice.inserted)
        : messages
    }
    return [
      ...project('next-turn').map(message => ({ id: message.id, placement: 'queued' as const, message })),
      ...project('next-step').map(message => ({
        id: message.id,
        // Explicit Team steering retains its durable delivery intent; other
        // Team-derived context (approval notices, task completion, attached
        // snapshots) must not render as a pending steering bubble.
        placement: message.source.kind === 'user' || isTeamSteeringSource(message.source)
          ? 'steering' as const
          : 'context' as const,
        message,
      })),
    ]
  }

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'agent/inbox/spliced') return
    const agent = ctx.agents.get(session.id)
    if (agent?.session !== session) return
    broadcast({ type: 'session/queue', sessionId: session.id, items: queueItems(agent, event.data) })
  })
  ctx.on('team/changed', (event) => { broadcast({ type: 'team/changed', event }) })
  ctx.on('channel/changed', (event) => { broadcast({ type: 'channel/changed', event }) })

  /** Remove a wait before settling it: synchronous deletion makes the first claimant win. */
  function claimQuestion(
    pending: PendingQuestion,
    outcome: 'answered' | 'cancelled',
    answer?: AskUserQuestionAnswer,
  ): void {
    pendingQuestions.delete(pending.rpcId)
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener('abort', pending.onAbort)
    }
    broadcast({
      type: 'question/resolved', sessionId: pending.sessionId,
      questionRpcId: pending.rpcId, outcome,
    })
    void persistResolvedTeamAction(ctx, {
      sessionId: pending.sessionId,
      kind: 'question',
      sourceId: String(pending.rpcId),
      phase: outcome === 'answered' ? 'resolved' : 'cancelled',
      outcome: outcome === 'answered'
        ? { kind: 'answered', answer: structuredClone(answer ?? { answers: [] }) as unknown as JsonValue }
        : { kind: 'cancelled' },
      ...pending.teamId === undefined ? {} : { teamId: pending.teamId },
    })
  }

  const disposeProvider = ctx.userQuestions.registerProvider({
    async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      const agent = request.agent
      const sessionId = agent?.id
      if (agent === undefined || sessionId === undefined) {
        return Promise.reject(new UserQuestionError(
          'web user interaction requires an agent-owned session', 'ASK_MISSING_AGENT'))
      }
      const provenance = interactionProvenance(agent.session)
      const rpcId = RpcId(randomUUID())
      if (request.signal?.aborted === true) {
        return Promise.reject(new UserQuestionError(
          'ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
      }
      const deferred = Promise.withResolvers<AskUserQuestionAnswer>()
      const pending: PendingQuestion = {
        rpcId, sessionId, questions: request.questions, resolve: deferred.resolve, reject: deferred.reject,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        ...provenance,
      }
      const onAbort = (): void => {
        claimQuestion(pending, 'cancelled')
        deferred.reject(new UserQuestionError(
          'ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
      }
      pending.onAbort = onAbort
      pendingQuestions.set(rpcId, pending)
      request.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        await persistPendingTeamAction(ctx, {
          sessionId,
          kind: 'question',
          sourceId: String(rpcId),
          details: { questionRpcId: String(rpcId), questions: structuredClone(request.questions) as unknown as JsonValue },
          ...provenance,
        }, () => pendingQuestions.get(rpcId) === pending)
      } catch (error: unknown) {
        pendingQuestions.delete(rpcId)
        request.signal?.removeEventListener('abort', onAbort)
        deferred.reject(error)
        return await deferred.promise
      }
      if (!pendingQuestions.has(rpcId)) return await deferred.promise
      const envelope: RpcRequest<MuxFrame> = {
        rpcId,
        payload: { type: 'question/requested', sessionId, questions: request.questions, ...provenance },
      }
      for (const queue of muxQueues) queue.push(envelope)
      return await deferred.promise
    },
  })
  ctx.effect(() => () => {
    disposeProvider()
    for (const pending of [...pendingQuestions.values()]) {
      claimQuestion(pending, 'cancelled')
      pending.reject(new UserQuestionError(
        'web user-questions provider was disposed', 'ASK_ABORTED'))
    }
  }, 'api-proxy: user-questions provider')

  // --- Approval pending registry ------------------------------------------
  // The proxy is the approval channel for every agent this host owns: an ask
  // through `ctx.approval` becomes an answerable server-request on the mux
  // stream (stable rpcId), settled by POST /api/respond. The entry survives
  // client disconnects — mux-open replays still-pending requested frames with
  // the same rpcId (the refresh-recovery baseline) — and withdraws on the
  // ask's own abort signal (turn cancel), pushing `cancelled` to subscribers.
  if (ctx.get('approval') !== undefined) {
    // Teardown parity with the question provider above: a gateway disposed
    // while approvals are pending settles every entry as 'cancelled' (the
    // service's fail-closed vocabulary), so no ask promise dangles past the
    // proxy's lifetime and subscribers see the withdrawal.
    ctx.effect(() => () => {
      for (const pending of [...pendingApprovals.values()]) pending.resolve('cancelled')
    }, 'api-proxy: approval registry teardown')
    ctx.on('approval/request', async (req, next) => {
      // Dispatch rides a microtask behind the service's own signal check: an
      // abort landing in that window would register the abort listener AFTER
      // the signal fired — never invoked, entry pending forever, zombie frame
      // on every mux replay. Settle synchronously instead of publishing.
      if (req.signal?.aborted === true) return Promise.resolve<ApprovalOutcome>('cancelled')
      // The audit pair `approval/asked` is already appended by the service
      // before dispatch, but dispatch rides a microtask: parallel tool calls
      // can append several asked events before any answerer runs. THIS
      // request's event is therefore the newest asked event that is still
      // undecided, unclaimed by another pending entry, and — when the ask
      // names a call — carries the same callId.
      const events = req.agent.session.events
      const claimed = new Set<ApprovalRequestId>()
      for (const entry of pendingApprovals.values()) claimed.add(entry.approvalId)
      const decided = new Set<ApprovalRequestId>()
      let approvalId: ApprovalRequestId | undefined
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i] as SessionEvent
        if (event.type === 'approval/decided') {
          decided.add(event.data.id)
        } else if (event.type === 'approval/asked') {
          if (decided.has(event.data.id) || claimed.has(event.data.id)) continue
          // Symmetric pairing: a callId-bearing ask only takes its own call's
          // record, and a callId-less ask only takes a callId-less record —
          // so neither shape can steal the other's audit id under parallel
          // asks. (Today every producer — the tool executor — passes callId;
          // the callId-less arm guards any future non-tool asker.)
          if ((req.callId ?? null) !== (event.data.callId ?? null)) continue
          approvalId = event.data.id
          break
        }
      }
      // No asked event means the request bypassed the service's audit path —
      // not this channel's question; delegate to the fail-closed default.
      if (approvalId === undefined) return next()
      const id = approvalId
      const provenance = interactionProvenance(req.agent.session)
      const rpcId = RpcId(randomUUID())
      const deferred = Promise.withResolvers<ApprovalOutcome>()
      const settle = (outcome: ApprovalOutcome): void => {
        /* v8 ignore next 3 -- defensive double-settle guard: respond() routes
           through the pending table (a settled id is not-pending before it can
           re-settle) and the first settle removes the abort listener, so no
           reachable path settles twice; kept against future settle callers. */
        if (!pendingApprovals.delete(pending.rpcId)) return
        req.signal?.removeEventListener('abort', onAbort)
        broadcast({ type: 'approval/resolved', sessionId: pending.sessionId, approvalId: id, outcome })
        void persistResolvedTeamAction(ctx, {
          sessionId: pending.sessionId,
          kind: 'approval',
          sourceId: String(id),
          phase: outcome === 'cancelled' ? 'cancelled' : 'resolved',
          outcome: { kind: outcome },
          ...pending.teamId === undefined ? {} : { teamId: pending.teamId },
        })
        // A cancelled ask was already settled by the service's own signal
        // race, which discards this late resolution; resolving is a no-op
        // there and keeps this promise from dangling forever.
        deferred.resolve(outcome)
      }
      const onAbort = (): void => { settle('cancelled') }
      const pending: PendingApproval = {
        rpcId,
        sessionId: req.agent.session.id,
        approvalId: id,
        toolName: req.toolName,
        ...req.callId === undefined ? {} : { callId: req.callId },
        ...req.reason === undefined ? {} : { reason: req.reason },
        ...provenance,
        resolve: settle,
      }
      pendingApprovals.set(pending.rpcId, pending)
      req.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        await persistPendingTeamAction(ctx, {
          sessionId: req.agent.session.id,
          kind: 'approval',
          sourceId: String(id),
          details: {
            approvalId: String(id),
            rpcId: String(rpcId),
            toolName: req.toolName,
            ...req.callId === undefined ? {} : { callId: String(req.callId) },
            ...req.reason === undefined ? {} : { reason: req.reason },
          },
          ...provenance,
        }, () => pendingApprovals.get(pending.rpcId) === pending)
      } catch (error: unknown) {
        pendingApprovals.delete(pending.rpcId)
        req.signal?.removeEventListener('abort', onAbort)
        throw error
      }
      if (!pendingApprovals.has(pending.rpcId)) {
        return await deferred.promise
      }
      const envelope = requestedFrame(pending)
      for (const queue of muxQueues) queue.push(envelope)
      return await deferred.promise
    })
  }

  type SessionReadState = {
    id: SessionId
    header: SessionHeader
    events: SessionEvent[]
  }

  /** Read one stable session prefix without acquiring an Agent owner. */
  async function readSessionState(sessionId: SessionId): Promise<SessionReadState> {
    const attached = ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return {
        id: attached.id,
        header: attached.header,
        events: [...attached.events],
      }
    }
    const inspected = await inspectServable(sessionId)
    return { id: inspected.meta.id, header: inspected.meta, events: inspected.events }
  }

  /**
   * Resolve which session one transcript read is served from, without
   * acquiring an Agent owner. This is the read's only asynchronous step
   * besides ensuring the composition; {@link historyCutOf} takes the cut.
   * @param sessionId - the transcript being read.
   * @returns the attached session, or the inspected detached header and events.
   * @throws {@link ApiRemoteSessionNotFound} when no project-backed session has that identity.
   */
  async function historySourceFor(sessionId: SessionId): Promise<HistorySource> {
    const attached = ctx.sessions.get(sessionId)
    if (attached !== undefined) return { kind: 'attached', session: attached }
    const inspected = await inspectServable(sessionId)
    return { kind: 'detached', header: inspected.meta, events: inspected.events }
  }

  /**
   * The header and events {@link presenterScopeFor} reads to decide which
   * composition a transcript ran under.
   * @param source - the live or detached session this read is served from.
   * @returns that session's creation header and its events.
   */
  function sourceSession(source: HistorySource): PresetBearingSession {
    if (source.kind === 'detached') return { header: source.header, events: source.events }
    return { header: source.session.header, events: source.session.events }
  }

  /**
   * One transcript cut: the events and the projection baseline that describe
   * the SAME log position.
   *
   * Synchronous, and the two reads sit next to each other, because an attached
   * session keeps appending: an `await` between them would serve events cut at
   * N beside a baseline folded to N+1, which is one response describing two
   * moments. The caller does its awaiting before this call.
   * @param source - the live or detached session this read is served from.
   * @param includeProjections - whether the caller asked for the baseline (a tail page does).
   * @returns the events and, when asked, the baseline for that same position.
   */
  function historyCutOf(
    source: HistorySource,
    includeProjections: boolean,
  ): { events: SessionEvent[]; projections?: SessionProjectionsBlock } {
    if (source.kind === 'detached') {
      const projections = includeProjections ? detachedProjectionsFor(ctx, source.events) : undefined
      return { events: source.events, ...projections === undefined ? {} : { projections } }
    }
    const events = [...source.session.events]
    const projections = includeProjections ? projectionsFor(ctx, source.session) : undefined
    return { events, ...projections === undefined ? {} : { projections } }
  }

  /**
   * The registry view scope a transcript's presenters resolve in.
   *
   * A live agent is that scope itself (its chain passes through its preset's
   * standing layer). A cold session resolves its preset from the LOG, and the
   * preset's STANDING key serves without resuming anything — ensuring the
   * mount composes plugins but starts no agent, session, or turn. No roster,
   * no recorded preset, or a preset the roster no longer supplies all fall
   * back to the global layer: the transcript still serves, with the generic
   * cards a viewless entry renders.
   *
   * Reading the header alone would render a session that switched while blank
   * through the composition it was CREATED with. Every tool only the newer
   * preset registers resolves to no presenter there, and the transcript
   * silently degrades to generic cards for exactly the calls its history is
   * made of.
   * @param sessionId - the transcript being read.
   * @param session - that session's header and log (attached or inspected).
   * @returns the scope to pass to presenter lookups, or undefined for global.
   */
  async function presenterScopeFor(
    sessionId: SessionId,
    session: PresetBearingSession,
  ): Promise<ScopeKey | undefined> {
    const live = ctx.get('agents')?.get(sessionId)
    if (live !== undefined) return live
    const presets = ctx.get('agentPresets')
    if (presets === undefined) return undefined
    try {
      // An unrecorded preset (a log from before the roster existed) renders
      // through the DEFAULT preset's standing layer: that is the composition
      // an unnamed session composes today, and presenters are pure display,
      // so the worst a mismatch produces is the generic card it had anyway.
      return await presets.standingKeyFor(resolveSessionPreset(session))
    } catch {
      // Swallows only the unknown/unusable-preset rejection from the roster:
      // a deleted or broken preset must degrade this read, never fail it.
      return undefined
    }
  }

  /** Resolve or create one path while holding the Host's workspace-create chain. */
  function ensureWorkspace(path: string): Promise<{ workspace: Workspace; created: boolean }> {
    const operation = workspaceCreationChain.then(async () => {
      const existing = await ctx.workspaceRegistry.resolveByPath(path)
      if (existing !== undefined) return { workspace: existing, created: false }
      return { workspace: await ctx.workspaceRegistry.create(path), created: true }
    })
    workspaceCreationChain = operation.then(() => undefined, () => undefined)
    return operation
  }

  /**
   * Build the session.list baseline shared by listing and search visibility.
   * Attached sessions come from memory; servable cold sessions merge from
   * persistence, and the final order is newest-first.
   */
  async function listVisibleSessionSummaries(signal?: AbortSignal): Promise<SessionSummary[]> {
    signal?.throwIfAborted()
    const summarizeAttached = (session: Session): SessionSummary => {
      const agent = ctx.agents.get(session.id)
      const projections = listProjectionsFor(ctx, session.header, session)
      return {
        ...summarize(session, agent?.status === 'running'),
        ...projections === undefined ? {} : { projections },
      }
    }
    const items = ctx.sessions.list().map(summarizeAttached)
    signal?.throwIfAborted()
    const attached = new Set(items.map(item => item.sessionId))
    const persistence = ctx.get('sessionPersistence')
    if (persistence !== undefined) {
      const cold = (await persistence.list(signal))
        .filter(meta => !attached.has(meta.id) && meta.cwd !== undefined)
      signal?.throwIfAborted()
      for (let offset = 0; offset < cold.length; offset += COLD_SUMMARY_BATCH_SIZE) {
        signal?.throwIfAborted()
        const batch = cold.slice(offset, offset + COLD_SUMMARY_BATCH_SIZE)
        const settled = await Promise.allSettled(
          batch.map(async (meta) => {
            // Projection hints remain optional. Blank verification may read
            // this Session's artifact only when it passes the configured size check.
            const projections = listProjectionsFor(ctx, meta, undefined)
            const summary = await summarizeCold(
              ctx,
              persistence,
              meta,
              projections?.values.sessionListMetadata,
              coldBlankProbeMaxBytes,
              signal,
            )
            const attachedSession = ctx.sessions.get(meta.id)
            if (attachedSession !== undefined) return summarizeAttached(attachedSession)
            return {
              ...summary,
              ...projections === undefined ? {} : { projections },
            }
          }),
        )
        const summaries: SessionSummary[] = []
        let rejected = false
        let failure: unknown
        for (const result of settled) {
          if (result.status === 'fulfilled') {
            summaries.push(result.value)
          } else if (!rejected) {
            rejected = true
            failure = result.reason
          }
        }
        if (rejected) throw failure
        signal?.throwIfAborted()
        items.push(...summaries)
      }
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt)
    return items
  }

  /**
   * Resolve the goal service THIS agent runs.
   *
   * The service is per session: an agent preset mounts it behind an `isolate`
   * realm, which no host context resolves. Reading it from the root would
   * answer "absent" for a session whose composition mounts it — so the lookup
   * is keyed by the agent, and only a deployment composing it nowhere is
   * genuinely absent.
   */
  function goalServiceFor(agent: Agent): NonNullable<ReturnType<typeof ctx.get<'goals'>>> | { error: RpcError } {
    const presets = ctx.get('agentPresets')
    const goals = presets?.serviceFor(agent, 'goals') ?? ctx.get('goals')
    if (goals === undefined) {
      return { error: { code: 'internal', message: 'goal service is absent: neither this session\'s agent preset nor the host composition mounts @clocky/clocky-goal', details: {} } }
    }
    return goals
  }

  /** Map one goal-domain rejection to the wire error (stable GoalError codes ride in details). */
  function goalError(request: RpcRequest<unknown>, error: unknown): RpcResponse<never> {
    const details = error instanceof GoalError ? { goalCode: error.code } : {}
    return err(request, { code: 'internal', message: String(error), details })
  }

  /** Resolve a session's agent, apply one goal mutation, and acknowledge with the new CAS ref. */
  async function mutateGoal(
    request: RpcRequest<{ sessionId: SessionId }>,
    mutation: (goals: NonNullable<ReturnType<typeof ctx.get<'goals'>>>, agent: Agent) => CoreGoalRef,
  ): Promise<RpcResponse<{ ref: GoalRef }>> {
    const found = await agentFor(request.payload.sessionId)
    if ('error' in found) return err(request, found.error)
    const goals = goalServiceFor(found.agent)
    if ('error' in goals) return err(request, goals.error)
    try {
      const ref = mutation(goals, found.agent)
      return ok(request, { ref: { id: ref.id, revision: ref.revision } })
    } catch (error: unknown) {
      return goalError(request, error)
    }
  }

  /**
   * Whether an adapter currently serves this provider, and therefore whether
   * a session selecting it can start a turn. Catalog membership cannot answer
   * it: an adapter may serve a model its own catalog stopped advertising, so
   * a provider missing from the groups is not the same as one nothing serves.
   * A composition with no llm registry at all cannot judge and says yes —
   * the dispatch it would have refused fails on its own terms.
   */
  function routeServed(provider: string): boolean {
    const llm = ctx.get('llm')
    return llm === undefined || llm.listProviders().some(entry => entry.id === provider)
  }

  /**
   * Resolve the addressed agent for a turn-starting method and refuse when no
   * adapter serves its current selection: a provider nothing serves cannot start a
   * turn, and letting it try spends the whole pre-step path to fail inside
   * the adapter with a message about registration. Refusing here names the
   * model the session is pointed at while the draft is still in the composer.
   * This is `session.prompt`'s enforcement boundary: a client that disables
   * its input is an affordance, and the method stays callable regardless.
   */
  function turnRefusal<T>(request: RpcRequest<unknown>, agent: Agent): RpcResponse<T> | undefined {
    const selection = selectionFor(agent).current
    if (selection === undefined) {
      return err(request, {
        code: 'model-not-configured',
        message: 'no model is configured; select a provider and model before starting a turn',
        details: {},
      })
    }
    if (!routeServed(selection.provider)) {
      return err(request, {
        code: 'model-unavailable',
        message: `no adapter serves provider "${selection.provider}"; select a model for this session`,
        details: { provider: selection.provider, model: selection.model },
      })
    }
    return undefined
  }

  async function turnAgentFor<T>(
    request: RpcRequest<unknown>, sessionId: SessionId,
  ): Promise<{ agent: Agent } | { refused: RpcResponse<T> }> {
    const found = await agentFor(sessionId)
    if ('error' in found) return { refused: err(request, found.error) }
    const agent = found.agent
    const refused = turnRefusal<T>(request, agent)
    if (refused !== undefined) return { refused }
    return { agent }
  }

  /** Missing-service report shared by the settings domain (skills-domain stance). */
  function settingsAbsent(): RpcError {
    return { code: 'internal', message: 'settings service is absent: this deployment does not mount a settings provider (e.g. @clocky/clocky-settings-file) in its composition', details: {} }
  }

  /** Open one Host-resolved target and map native failures onto the wire vocabulary. */
  async function openTarget(
    request: RpcRequest<unknown>, path: string, signal: AbortSignal,
    open: (path: string, signal: AbortSignal) => Promise<void>,
  ): Promise<RpcResponse<{ opened: true }>> {
    try {
      await open(path, signal)
      return ok(request, { opened: true as const })
    } catch (error: unknown) {
      if (signal.aborted) {
        return err(request, {
          code: 'cancelled',
          message: 'path open was aborted',
          details: {},
        })
      }
      return err(request, {
        code: 'internal',
        message: `path open failed: ${error instanceof Error ? error.message : String(error)}`,
        details: {},
      })
    }
  }

  /** Open one Host-resolved path with its default application. */
  function openPath(
    request: RpcRequest<unknown>, path: string, signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>> {
    const open = defaults.openPath
      ?? ((target: string, openSignal: AbortSignal) => openNativePath(target, openSignal))
    return openTarget(request, path, signal, open)
  }

  /** Open one Host-resolved text document in a native editor. */
  function openTextFile(
    request: RpcRequest<unknown>, path: string, signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>> {
    const open = defaults.openTextFile
      ?? ((target: string, openSignal: AbortSignal) => openNativeTextFile(target, openSignal))
    return openTarget(request, path, signal, open)
  }

  /** Whether this deployment can hand a path to a native opener at all. */
  function canOpenPaths(): boolean {
    if (defaults.canOpenPath !== undefined) return defaults.canOpenPath()
    // An injected opener is by definition usable; otherwise ask the platform.
    return defaults.openPath !== undefined || canOpenNativePath()
  }

  /** Missing-service report shared by the credentials domain. */
  function credentialsAbsent(): RpcError {
    return { code: 'internal', message: 'credentials service is absent: this deployment does not mount a credential provider (e.g. @clocky/clocky-credentials-local) in its composition', details: {} }
  }

  function teamServiceFor<T>(request: RpcRequest<unknown>):
    | { readonly teams: NonNullable<ReturnType<typeof ctx.get<'teams'>>> }
    | { readonly refused: RpcResponse<T> } {
    const teams = ctx.get('teams')
    if (teams !== undefined) return { teams }
    return {
      refused: err(request, {
        code: 'team-service-unavailable',
        message: 'Team RPC is unavailable: this host does not compose a Team provider',
        details: {},
      }),
    }
  }

  function teamRunFor<T>(request: RpcRequest<unknown>, teamId?: TeamId):
    | { readonly teams: NonNullable<ReturnType<typeof ctx.get<'teams'>>>; readonly teamRuns: NonNullable<ReturnType<typeof ctx.get<'teamRuns'>>> }
    | { readonly refused: RpcResponse<T> } {
    const service = teamServiceFor<T>(request)
    if ('refused' in service) return service
    const teamRuns = ctx.get('teamRuns')
    if (teamRuns !== undefined) return { teams: service.teams, teamRuns }
    return {
      refused: err(request, {
        code: 'team-run-unavailable',
        message: 'Team input and lifecycle operations require a current local Team-run owner',
        details: teamId === undefined ? {} : { teamId },
      }),
    }
  }

  /** Refuse Host Team control when this proxy has no authenticated Team actor. */
  function teamActorUnavailable<T>(request: RpcRequest<unknown>, teamId?: TeamId): RpcResponse<T> {
    return err(request, {
      code: 'team-run-unavailable',
      message: 'This Host Team control operation requires an authenticated Team actor, but none is available.',
      details: teamId === undefined ? {} : { teamId },
    })
  }

  /** Refuse every Team write before it can reach a TeamRun or Team policy path. */
  function requireTeamMutationAuthentication<T>(request: RpcRequest<unknown>): RpcResponse<T> | undefined {
    const authentication = authenticatedTeamMutationCall(request)
    return 'refused' in authentication ? authentication.refused : undefined
  }

  /** Resolve the live product call once when a Team route also needs its durable owner identity. */
  function authenticatedTeamMutationCall(request: RpcRequest<unknown>):
    | { readonly call: NonNullable<ReturnType<typeof currentAuthenticatedProductCall>> }
    | { readonly refused: RpcResponse<never> } {
    const call = currentAuthenticatedProductCall()
    if (call === undefined) {
      return {
        refused: err<never>(request, {
          code: 'PRODUCT_AUTH_REQUIRED',
          message: 'Product authentication is required for Team mutations.',
          details: {},
        }),
      }
    }
    if (call.signal.aborted) {
      return {
        refused: err<never>(request, {
          code: 'PRODUCT_AUTH_INVALID',
          message: 'Product authentication is invalid.',
          details: {},
        }),
      }
    }
    return { call }
  }

  /** Refuse a current-run route unless its transport principal owns exactly one active human participant. */
  async function requireCurrentTeamRunHumanOwner(
    request: RpcRequest<unknown>,
    teams: NonNullable<ReturnType<typeof ctx.get<'teams'>>>,
    teamId: TeamId,
    call: NonNullable<ReturnType<typeof currentAuthenticatedProductCall>>,
  ): Promise<RpcResponse<never> | undefined> {
    let state: TeamStateSnapshot
    try {
      state = await teams.getTeam({ teamId })
    } catch (error: unknown) {
      return teamFailure<never>(request, error, teamId)
    }
    if (call.signal.aborted) {
      return err<never>(request, {
        code: 'PRODUCT_AUTH_INVALID',
        message: 'Product authentication is invalid.',
        details: {},
      })
    }
    const matches = state.participants.filter(participant =>
      participant.kind === 'human'
      && participant.phase === 'active'
      && participant.owner?.kind === 'product-principal'
      && participant.owner.principalId === call.principal.id)
    if (matches.length === 0) {
      return err<never>(request, {
        code: 'TEAM_HUMAN_ACTOR_NOT_FOUND',
        message: 'Authenticated principal owns no active human Team participant',
        details: { teamId },
      })
    }
    if (matches.length > 1) {
      return err<never>(request, {
        code: 'TEAM_HUMAN_ACTOR_AMBIGUOUS',
        message: 'Authenticated principal maps to multiple active human Team participants',
        details: { teamId },
      })
    }
    return undefined
  }

  /** Return the durable non-secret owner selected by the current authenticated product call. */
  function authenticatedHumanOwner(): Extract<TeamParticipantOwner, { readonly kind: 'product-principal' }> {
    const call = currentAuthenticatedProductCall()
    if (call === undefined || call.signal.aborted) {
      throw new TeamError('Product authentication is invalid.', 'TEAM_ACTOR_PROOF_INVALID')
    }
    return { kind: 'product-principal', principalId: call.principal.id }
  }

  /** Retain this authenticated call for exact pending-manifest endpoint confirmation during Team creation. */
  function authenticatedChannelAdmission() {
    const call = currentAuthenticatedProductCall()
    if (call === undefined || call.signal.aborted) throw new TeamError('Product authentication is invalid', 'TEAM_ACTOR_PROOF_INVALID')
    return createPrincipalChannelAdmission(ctx, call)
  }

  /** Return whether the current authenticated principal owns exactly one active human for a Team response. */
  async function canResolveTeamHumanAction(teamId: TeamId, participantId?: ParticipantId): Promise<boolean> {
    const call = currentAuthenticatedProductCall()
    const teams = ctx.get('teams')
    if (call === undefined || call.signal.aborted || teams === undefined || participantId === undefined) return false
    let state: TeamStateSnapshot
    try {
      state = await teams.getTeam({ teamId })
    } catch {
      return false
    }
    const currentCall = currentAuthenticatedProductCall()
    if (currentCall === undefined || currentCall !== call || currentCall.signal.aborted) return false
    // `participantId` identifies the Team Agent that asked the question; it
    // is normally a coordinator or worker, not the human who is answering it.
    // Require that source participant to remain active, then authorize the
    // authenticated principal through its own active human participant.
    const sourceParticipant = state.participants.find(participant => participant.id === participantId)
    if (sourceParticipant === undefined || sourceParticipant.phase !== 'active') return false
    const humans = state.participants.filter(participant =>
      participant.kind === 'human'
      && participant.phase === 'active'
      && participant.owner?.kind === 'product-principal'
      && participant.owner.principalId === call.principal.id
      && participant.authorityGrant?.operations.includes('human-action') === true,
    )
    return sourceParticipant.kind === 'human'
      ? humans.some(participant => participant.id === sourceParticipant.id)
      : humans.length === 1
  }

  /** Bind one complete actor-free channel-post request to an authenticated human proof. */
  function humanChannelPostProofInput(
    teamId: TeamId,
    input: ChannelEnvelopePostInput,
  ): TeamHumanActorProofInput {
    return {
      teamId,
      operation: 'send',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Bind one complete actor-free channel-open request to an authenticated human proof. */
  function humanChannelOpenProofInput(input: ChannelOpenInput): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'channel-open',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Bind one complete actor-free channel-close request to the channel's server-derived Team. */
  function humanChannelCloseProofInput(teamId: TeamId, input: ChannelCloseInput): TeamHumanActorProofInput {
    return {
      teamId,
      operation: 'close',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Bind one complete actor-free participant invitation to an authenticated human proof. */
  function humanParticipantInviteProofInput(input: ParticipantInviteInput): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'invite',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Bind one complete actor-free participant phase mutation to an authenticated human proof. */
  function humanParticipantPhaseProofInput(
    input: ParticipantPhaseTransitionInput,
    operation: 'activate' | 'close',
  ): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation,
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Bind one complete actor-free participant interrupt to an authenticated human proof. */
  function humanParticipantInterruptProofInput(input: ParticipantInterruptRequestInput): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'interrupt',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Bind one complete actor-free terminal archive request to an authenticated human proof. */
  function humanTeamArchiveProofInput(input: { readonly teamId: TeamId; readonly expectedCursor: number }): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'close',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Bind one complete actor-free Team resume request to an authenticated human proof. */
  function humanTeamResumeProofInput(input: TeamResumeInput): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'activate',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Bind one complete actor-free Team goal revision mutation to an authenticated human proof. */
  function humanTeamGoalProofInput(
    input: TeamGoalUpdateInput | TeamGoalPhaseTransitionInput,
  ): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'goal-mutate',
      fence: { kind: 'revision', revision: input.expectedRevision },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Bind one complete actor-free task creation to an authenticated human proof. */
  function humanTaskCreateProofInput(input: TeamTaskCreateInput): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'task-mutate',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Bind one complete actor-free task revision mutation to an authenticated human proof. */
  function humanTaskRevisionProofInput(
    input: TeamTaskDetailsUpdateInput | TeamTaskCancelInput | TeamTaskDeleteInput,
  ): TeamHumanActorProofInput {
    return {
      teamId: input.teamId,
      operation: 'task-mutate',
      fence: { kind: 'revision', revision: input.expectedRevision },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
  }

  /** Bind the externally selected Team together with one actor-free review decision to an authenticated human proof. */
  function humanTaskReviewProofInput(
    teamId: TeamId,
    input: TeamTaskReviewResolveInput,
  ): TeamHumanActorProofInput {
    return {
      teamId,
      operation: 'task-mutate',
      fence: { kind: 'revision', revision: input.expectedRevision },
      payload: jsonObjectSchema.parse({ teamId, ...structuredClone(input) }),
    }
  }

  function teamCreatePreset(agentPreset: string | undefined): string | undefined {
    return agentPreset ?? ctx.get('agentPresets')?.defaultId
  }

  /** Convert the browser-safe model selection into the Agent's branded effort value. */
  function teamModelSelection(
    selection: import('./api/sessions.ts').ModelSelection | undefined,
  ): ModelSelection | undefined {
    if (selection === undefined) return undefined
    return {
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
    }
  }

  function teamFailure<T>(
    request: RpcRequest<unknown>,
    error: unknown,
    teamId?: TeamId,
    signal?: AbortSignal,
  ): RpcResponse<T> {
    if (signal?.aborted === true) {
      return err(request, { code: 'cancelled', message: 'Team operation was cancelled', details: {} })
    }
    if (error instanceof AttachmentError) {
      return err(request, {
        code: 'attachment-error',
        message: error.message,
        details: { reason: error.code },
      })
    }
    const teamError = error as TeamError | undefined
    if (teamError?.code === 'TEAM_HUMAN_ACTOR_NOT_FOUND'
      || teamError?.code === 'TEAM_HUMAN_ACTOR_AMBIGUOUS'
      || teamError?.code === 'TEAM_HUMAN_ACTOR_FORBIDDEN'
      || teamError?.code === 'TEAM_ACTOR_PROOF_INVALID') {
      return err(request, {
        code: teamError.code,
        message: teamError.message,
        details: teamId === undefined ? {} : { teamId },
      })
    }
    if (teamError?.code === 'TEAM_NOT_FOUND' && teamId !== undefined) {
      return err(request, { code: 'team-not-found', message: teamError.message, details: { teamId } })
    }
    if (teamError?.code === 'TEAM_CURSOR_CONFLICT') {
      return err(request, {
        code: 'team-cursor-conflict',
        message: teamError.message,
        details: teamId === undefined ? {} : { teamId },
      })
    }
    if (teamError?.code === 'TEAM_INVALID_ARGUMENT') {
      return err(request, { code: 'team-invalid-argument', message: teamError.message, details: teamId === undefined ? {} : { teamId } })
    }
    if (teamError?.code === 'TEAM_CHANNEL_CURSOR_CONFLICT') {
      const payload = request.payload
      const selected = typeof payload === 'object' && payload !== null && 'channelId' in payload
        ? channelIdSchema.safeParse(payload.channelId) : undefined
      return err(request, {
        code: 'team-channel-cursor-conflict', message: teamError.message,
        details: { ...teamId === undefined ? {} : { teamId },
          ...selected?.success === true ? { channelId: selected.data } : {} },
      })
    }
    if (teamError?.code === 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT') {
      const payload = request.payload
      const selected = typeof payload === 'object' && payload !== null && 'channelId' in payload
        ? channelIdSchema.safeParse(payload.channelId) : undefined
      return err(request, {
        code: 'team-channel-idempotency-conflict', message: teamError.message,
        details: { ...teamId === undefined ? {} : { teamId },
          ...selected?.success === true ? { channelId: selected.data } : {} },
      })
    }
    if (teamError?.code === 'TEAM_CHANNEL_COMPACTED' || teamError?.code === 'TEAM_AUDIT_COMPACTED') {
      const details = teamError.details
      const rawTeamId = details?.teamId
      const rawChannelId = details?.channelId
      const rawFirstCursor = details?.firstCursor
      const parsedTeamId = typeof rawTeamId === 'string' ? teamIdSchema.safeParse(rawTeamId) : undefined
      const parsedChannelId = typeof rawChannelId === 'string' ? channelIdSchema.safeParse(rawChannelId) : undefined
      const mappedTeamId = teamId ?? (parsedTeamId?.success === true ? parsedTeamId.data : undefined)
      const mappedChannelId = parsedChannelId?.success === true ? parsedChannelId.data : undefined
      const firstCursor = typeof rawFirstCursor === 'number' && Number.isSafeInteger(rawFirstCursor) && rawFirstCursor >= 0
        ? rawFirstCursor
        : undefined
      const mappedDetails = {
        ...mappedTeamId === undefined ? {} : { teamId: mappedTeamId },
        ...mappedChannelId === undefined ? {} : { channelId: mappedChannelId },
        ...firstCursor === undefined ? {} : { firstCursor },
      }
      return err(request, {
        code: teamError.code === 'TEAM_CHANNEL_COMPACTED' ? 'team-channel-compacted' : 'team-audit-compacted',
        message: teamError.message,
        details: mappedDetails,
      })
    }
    if (error instanceof TeamRunError) {
      switch (error.code) {
        case 'TEAM_RUN_MODEL_REQUIRED':
          return err(request, { code: 'team-model-required', message: error.message, details: {} })
        case 'TEAM_RUN_START_CONFLICT':
          return err(request, { code: 'team-start-conflict', message: error.message, details: {} })
        case 'TEAM_RUN_FINAL_INVALID':
          if (teamId !== undefined) {
            return err(request, { code: 'team-final-invalid', message: error.message, details: { teamId } })
          }
          break
        case 'TEAM_RUN_NOT_QUIESCENT':
          if (teamId !== undefined) {
            return err(request, { code: 'team-not-quiescent', message: error.message, details: { teamId } })
          }
          break
        case 'TEAM_RUN_WORKFLOW_INVALID':
          break
        case 'TEAM_RUN_NOT_FOUND':
        case 'TEAM_RUN_WORKFLOW_NOT_FOUND':
        case 'TEAM_RUN_DISPOSED':
        case 'TEAM_RUN_COORDINATOR_INVALID':
        case 'TEAM_RUN_WORKER_PRESET_REQUIRED':
        case 'TEAM_RUN_INVALID_WORKER_POOL':
          return err(request, {
            code: 'team-run-unavailable',
            message: error.message,
            details: teamId === undefined ? {} : { teamId },
          })
      }
    }
    return err(request, {
      code: 'internal',
      message: `Team operation failed: ${error instanceof Error ? error.message : String(error)}`,
      details: {},
    })
  }

  async function teamCoordinatorRoute<T>(
    request: RpcRequest<unknown>,
    sessionId: SessionId,
  ): Promise<
    | {
      readonly agent: Agent
      readonly teamId: TeamId
      readonly teams: NonNullable<ReturnType<typeof ctx.get<'teams'>>>
      readonly teamRuns: NonNullable<ReturnType<typeof ctx.get<'teamRuns'>>>
    }
    | { readonly refused: RpcResponse<T> }
    | undefined
  > {
    const liveAgent = ctx.agents.get(sessionId)
    const attached = liveAgent?.session ?? ctx.sessions.get(sessionId)
    let header = attached?.header
    if (header === undefined) {
      if (ctx.get('teams') === undefined) return undefined
      try {
        header = (await inspectServable(sessionId)).meta
      } catch (error: unknown) {
        // Lookup failures remain owned by the ordinary Session resolver below; this probe only detects Team provenance.
        void error
        return undefined
      }
    }
    if (header.teamId === undefined && header.participantId === undefined) return undefined
    if (header.teamId === undefined || header.participantId === undefined) {
      return {
        refused: err(request, {
          code: 'team-run-unavailable',
          message: `session "${sessionId}" has incomplete Team provenance`,
          details: {},
        }),
      }
    }
    const teamId = teamIdSchema.parse(header.teamId)
    const participantId = participantIdSchema.parse(header.participantId)
    const service = teamRunFor<T>(request, teamId)
    if ('refused' in service) return service
    if (liveAgent === undefined) {
      return {
        refused: err(request, {
          code: 'team-run-unavailable',
          message: `Team '${teamId}' has no live coordinator Session owned by this local Team-run provider`,
          details: { teamId },
        }),
      }
    }
    let state: TeamStateSnapshot
    try {
      state = await service.teams.getTeam({ teamId })
    } catch (error: unknown) {
      return { refused: teamFailure(request, error, teamId) }
    }
    const coordinators = state.participants.filter(participant =>
      participant.kind === 'local-agent' && participant.role === 'coordinator' && participant.phase === 'active')
    const coordinator = coordinators[0]
    const binding = coordinator === undefined
      ? undefined
      : state.activations.find(candidate => candidate.activation.participantId === coordinator.id
        && candidate.sessionId === liveAgent.session.id
        && (candidate.activation.status === 'idle' || candidate.activation.status === 'running'))
    if (coordinator === undefined || coordinators.length !== 1
      || coordinator.id !== participantId || binding === undefined
      || state.team.phase !== 'active') {
      return {
        refused: err(request, {
          code: 'team-run-unavailable',
          message: `Team '${teamId}' has no current local coordinator owner for session "${sessionId}"`,
          details: { teamId },
        }),
      }
    }
    return {
      agent: liveAgent,
      teamId,
      teams: service.teams,
      teamRuns: service.teamRuns,
    }
  }

  async function admitPromptContent<T>(
    request: RpcRequest<unknown>,
    agent: Agent,
    content: readonly PromptContentPart[],
  ): Promise<{ readonly content: DurablePromptContent } | { readonly refused: RpcResponse<T> }> {
    try {
      if (content.some(part => part.type === 'image')) {
        const current = selectionFor(agent).current
        if (current === undefined) {
          return {
            refused: err(request, {
              code: 'model-not-configured',
              message: 'no model is configured; select a provider and model before sending an image',
              details: {},
            }),
          }
        }
        const modelInfo = await ctx.llm.resolveModelInfo(current.provider, current.model)
        if (modelInfo.inputModalities !== undefined && !modelInfo.inputModalities.includes('image')) {
          return {
            refused: err(request, {
              code: 'attachment-error',
              message: `Model "${current.model}" does not support image input.`,
              details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
            }),
          }
        }
      }
      return { content: await durablePromptContent(ctx, content) }
    } catch (error: unknown) {
      if (error instanceof AttachmentError) {
        return {
          refused: err(request, {
            code: 'attachment-error',
            message: error.message,
            details: { reason: error.code },
          }),
        }
      }
      return {
        refused: err(request, {
          code: 'agent-busy',
          message: 'prompt rejected',
          details: { reason: String(error) },
        }),
      }
    }
  }

  /** Map one redacted settings descriptor to its wire view. */
  function namespaceView(descriptor: SettingsDescriptor): SettingsNamespaceView {
    return {
      ns: String(descriptor.ns),
      schema: descriptor.schema,
      value: descriptor.value,
      ...descriptor.base === undefined ? {} : { base: descriptor.base },
      ...descriptor.user === undefined ? {} : { user: descriptor.user },
      applies: descriptor.applies,
      secrets: (descriptor.secrets ?? []).map(secret => ({ path: [...secret.path], set: secret.set })),
      revision: descriptor.revision,
    }
  }

  /**
   * Run one settings write (merge or wholesale replace) and acknowledge with
   * the namespace's new redacted view. Every seam refusal — unknown or invalid
   * namespace, read-only provider, schema validation, storage — becomes one
   * `settings-rejected` carrying the seam's own message.
   */
  async function settingsWrite(
    request: RpcRequest<unknown>,
    ns: string,
    mode: 'update' | 'replace' | 'mutate',
    section: object,
    expectedRevision?: number,
  ): Promise<RpcResponse<SettingsNamespaceView>> {
    const settings = ctx.get('settings')
    if (settings === undefined) return err(request, settingsAbsent())
    const rejected = (error: unknown): RpcResponse<SettingsNamespaceView> => {
      // A stale writer is its own outcome, not a malformed request: the client
      // must re-read and re-apply rather than treat the write as invalid.
      if (error instanceof SettingsConflictError) {
        return err(request, {
          code: 'settings-conflict',
          message: error.message,
          details: { ns, expected: error.expected, actual: error.actual },
        })
      }
      return err(request, {
        code: 'settings-rejected',
        message: error instanceof Error ? error.message : String(error),
        details: { ns },
      })
    }
    let branded: SettingsNamespace
    try {
      branded = settingsNamespace(ns)
    } catch (error: unknown) {
      // A malformed name can address no registration, so it fails exactly as
      // an unregistered one does.
      return rejected(error)
    }
    try {
      if (mode === 'update') await settings.update(branded, section, expectedRevision)
      else if (mode === 'replace') await settings.replace(branded, section, expectedRevision)
      else await settings.mutate(branded, section as SettingsPathOp[], expectedRevision)
    } catch (error: unknown) {
      return rejected(error)
    }
    const descriptor = settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === branded)
    if (descriptor === undefined) {
      // The write committed but the namespace vanished before this read: only
      // a concurrent registrant disposal can produce it.
      return err(request, { code: 'internal', message: `settings namespace "${ns}" was disposed after the ${mode}`, details: {} })
    }
    return ok(request, namespaceView(descriptor))
  }

  async function responseState(call: AuthenticatedProductCall, input: TeamHumanActionResponseInput) {
    call.signal.throwIfAborted()
    const teams = ctx.get('teams')
    if (teams === undefined) throw new TeamError('Team provider is unavailable', 'TEAM_INVALID_ARGUMENT')
    const state = await teams.getTeam({ teamId: input.teamId })
    const action = state.humanActions?.find(value => value.id === input.actionId)
    if (action === undefined
      || !await withAuthenticatedProductCall(call, () => canResolveTeamHumanAction(input.teamId, action.participantId))) {
      throw new TeamError('Authenticated principal cannot answer this human action', 'TEAM_HUMAN_ACTOR_FORBIDDEN')
    }
    call.signal.throwIfAborted()
    return { teams, state, action }
  }

  function sameResponse(action: TeamHumanActionSnapshot, input: TeamHumanActionResponseInput): boolean {
    return action.response?.idempotencyKey === input.idempotencyKey && action.response.expectedUpdatedAt === input.expectedUpdatedAt
      && isDeepStrictEqual(action.response.answer, input.answer)
  }

  ctx.inject(['teamHumanDelivery'], (inboxCtx) => {
    const unregister = inboxCtx.teamHumanDelivery.registerActionResponder({
      async respond(call, request): Promise<TeamHumanActionResponseResult | undefined> {
        const input = teamHumanActionResponseInputSchema.parse(request)
        const { teams, state, action } = await responseState(call, input)
        const approval = action.kind === 'approval'
          ? [...pendingApprovals.values()].find(value => value.teamId === input.teamId && value.sessionId === action.sessionId
            && String(value.approvalId) === String(action.sourceId)) : undefined
        const question = action.kind === 'question'
          ? [...pendingQuestions.values()].find(value => value.teamId === input.teamId && value.sessionId === action.sessionId
            && String(value.rpcId) === String(action.sourceId)) : undefined
        const pending = approval ?? question
        if (pending === undefined) return undefined
        if (pending.answerClaimed === true) {
          if (sameResponse(action, input)) return { kind: 'accepted', action }
          throw new TeamError('Human response admission is already in progress; retry the same key', 'TEAM_CURSOR_CONFLICT')
        }
        if (input.answer.kind !== action.kind) throw new TeamError('Answer kind does not match the request', 'TEAM_INVALID_ARGUMENT')
        const questionAnswer = input.answer.kind === 'question'
          ? { answers: input.answer.answers.map(answer => ({ id: answer.id, selected: [...answer.selected],
            ...(answer.custom === undefined ? {} : { custom: answer.custom }) })) } : undefined
        if (question !== undefined && (questionAnswer === undefined
          || !matchesQuestions({ sessionId: question.sessionId, answer: questionAnswer }, question))) {
          throw new TeamError('Answer does not match the current question options', 'TEAM_INVALID_ARGUMENT')
        }
        const issuer = hostHumanActionProofIssuer(ctx)
        const human = state.participants.find(value => value.kind === 'human' && value.phase === 'active'
          && value.owner?.kind === 'product-principal' && value.owner.principalId === call.principal.id)
        if (issuer === undefined || human === undefined) throw new TeamError('Human response owner is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
        pending.answerClaimed = true
        const isCurrent = () => !call.signal.aborted && (approval === undefined
          ? pendingQuestions.get(pending.rpcId) === pending : pendingApprovals.get(pending.rpcId) === pending)
        let accepted: TeamHumanActionSnapshot
        try {
          accepted = await issuer.acceptResponse({ teamId: input.teamId, expectedCursor: state.team.cursor, input,
            principalId: call.principal.id, humanId: human.id }, isCurrent,
          async actor => await teams.acceptHumanActionResponse({ actor, teamId: input.teamId, expectedCursor: state.team.cursor }))
        } catch (error: unknown) { pending.answerClaimed = false; throw error }
        if (approval !== undefined && input.answer.kind === 'approval' && pendingApprovals.get(approval.rpcId) === approval) {
          approval.resolve(input.answer.outcome)
        } else if (question !== undefined && questionAnswer !== undefined && pendingQuestions.get(question.rpcId) === question) {
          claimQuestion(question, 'answered', questionAnswer)
          question.resolve(questionAnswer)
        }
        return { kind: 'accepted', action: accepted }
      },
      async unavailable(call, request): Promise<TeamHumanActionResponseResult> {
        const input = teamHumanActionResponseInputSchema.parse(request)
        const { teams, state, action } = await responseState(call, input)
        if (action.response !== undefined && !sameResponse(action, input)) {
          throw new TeamError('Response retry conflicts with the accepted answer', 'TEAM_INVALID_ARGUMENT')
        }
        if (action.phase !== 'pending') {
          if (action.outcome?.code === 'HUMAN_ACTION_CONTINUATION_UNAVAILABLE') return { kind: 'unavailable', action }
          if (sameResponse(action, input)) return { kind: 'accepted', action }
          throw new TeamError('Human action has already settled', 'TEAM_INVALID_ARGUMENT')
        }
        if (action.response === undefined && action.updatedAt !== input.expectedUpdatedAt) {
          throw new TeamError('Human action revision is stale', 'TEAM_INVALID_ARGUMENT')
        }
        const issuer = hostHumanActionProofIssuer(ctx)
        if (issuer === undefined) throw new TeamError('Human action recovery owner is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
        if (issuer.hasVerifiedAction(action.id)) {
          if (sameResponse(action, input)) return { kind: 'accepted', action }
          throw new TeamError('Human action settlement is in progress', 'TEAM_CURSOR_CONFLICT')
        }
        const unavailable = await issuer.unavailable({ teamId: input.teamId, expectedCursor: state.team.cursor, action },
          () => !call.signal.aborted,
          async actor => await teams.unavailableHumanAction({ actor, teamId: input.teamId, expectedCursor: state.team.cursor }))
        return { kind: 'unavailable', action: unavailable }
      },
    })
    inboxCtx.effect(() => unregister)
  })

  return {
    sessions: {
      // Attached sessions summarize from memory; persisted-but-unattached (cold)
      // sessions merge in from the persistence store so history survives restarts.
      // Logs without a cwd are not served; every session records its project
      // at create time.
      async list(request) {
        return ok(request, { items: await listVisibleSessionSummaries() })
      },

      async search(request, signal) {
        const cancelled = () => err<{ items: SessionSearchItem[]; hasMore: boolean }>(request, {
          code: 'cancelled',
          message: 'session search was aborted',
          details: {},
        })
        if (isAborted(signal)) return cancelled()
        const sessionQuery = ctx.get('sessionQuery')
        if (sessionQuery === undefined) {
          return err(request, {
            code: 'internal',
            message: 'session search is unavailable: this deployment does not mount @clocky/clocky-session-query',
            details: {},
          })
        }
        try {
          const visible = await listVisibleSessionSummaries(signal)
          if (isAborted(signal)) return cancelled()
          if (visible.length === 0) return ok(request, { items: [], hasMore: false })
          const visibleIds = new Set(visible.map(item => item.sessionId))
          const authorized: SessionSearchItem[] = []
          const acceptedIds = new Set<SessionId>()
          const seenCursors = new Set<SessionSearchCursor>()
          let cursor: SessionSearchCursor | undefined
          let providerCallCount = 0
          let providerPageLimit = SESSION_SEARCH_RESULT_LIMIT
          while (authorized.length <= SESSION_SEARCH_RESULT_LIMIT) {
            if (isAborted(signal)) return cancelled()
            if (providerCallCount >= SESSION_SEARCH_PROVIDER_CALL_LIMIT) {
              throw new Error(
                `session search provider exceeded the ${SESSION_SEARCH_PROVIDER_CALL_LIMIT}-call work budget`,
              )
            }
            providerCallCount++
            const requestedCursor = cursor
            const requestedPageLimit = providerPageLimit
            let page
            try {
              page = await sessionQuery.searchSessions({
                query: request.payload.query,
                eventFilters: [
                  { kind: 'type', values: ['user/message', 'team/channel-view', 'assistant/message'] },
                  { kind: 'surface', values: ['current'] },
                ],
                limit: requestedPageLimit,
                ...requestedCursor === undefined ? {} : { cursor: requestedCursor },
              }, { signal })
            } catch (error: unknown) {
              if (isAborted(signal)) return cancelled()
              if (
                requestedCursor === undefined
                && error instanceof SessionQueryError
                && error.code === 'SESSION_QUERY_INVALID_LIMIT'
                && requestedPageLimit > 1
              ) {
                providerPageLimit = Math.max(1, Math.floor(requestedPageLimit / 2))
                continue
              }
              if (
                requestedCursor !== undefined
                && error instanceof SessionQueryError
                && error.code === 'SESSION_QUERY_STALE_CURSOR'
              ) {
                authorized.length = 0
                acceptedIds.clear()
                seenCursors.clear()
                cursor = undefined
                continue
              }
              throw error
            }
            if (isAborted(signal)) return cancelled()
            const providerItemCount = page.items.length
            if (providerItemCount > requestedPageLimit) {
              throw new Error(
                `session search provider returned ${providerItemCount} items; maximum is ${requestedPageLimit}`,
              )
            }
            // Host visibility is the authorization boundary. Consume the
            // provider's globally ranked results rather than binding every
            // visible id into one SQLite statement, then require each hit to
            // name a visible session and a current message from that same
            // session before emitting its snippet.
            for (const hit of page.items) {
              if (authorized.length > SESSION_SEARCH_RESULT_LIMIT) continue
              if (
                !visibleIds.has(hit.header.id)
                || hit.bestMatch.sessionId !== hit.header.id
                || hit.bestMatch.surface !== 'current'
                || !MESSAGE_TYPES.has(hit.bestMatch.type)
                || acceptedIds.has(hit.header.id)
              ) continue
              const snippet = truncateUnicodeCodePoints(
                hit.bestMatch.snippet,
                SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
              )
              acceptedIds.add(hit.header.id)
              authorized.push({
                sessionId: hit.header.id,
                snippet,
              })
            }
            const nextCursor = page.nextCursor
            if (nextCursor !== undefined) {
              if (seenCursors.has(nextCursor)) {
                throw new Error('session search provider repeated a continuation cursor')
              }
              seenCursors.add(nextCursor)
            }
            if (authorized.length > SESSION_SEARCH_RESULT_LIMIT || nextCursor === undefined) break
            cursor = nextCursor
          }
          return ok(request, {
            items: authorized.slice(0, SESSION_SEARCH_RESULT_LIMIT),
            hasMore: authorized.length > SESSION_SEARCH_RESULT_LIMIT,
          })
        } catch (error: unknown) {
          if (
            isAborted(signal)
            || (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED')
          ) return cancelled()
          // XXX: Redact provider details before exposing this gateway beyond
          // its current single-user local deployment.
          return err(request, {
            code: 'internal',
            message: `session search failed: ${String(error)}`,
            details: {},
          })
        }
      },

      async history(request) {
        const { sessionId, beforeSeq, maxMessages } = request.payload
        try {
          const source = await historySourceFor(sessionId)
          // Both awaits happen BEFORE the cut. Ensuring the recorded
          // composition's standing mount is what registers its projection
          // units, so a first cold read would otherwise serve a baseline
          // missing every preset-owned key; and an attached session keeps
          // appending, so awaiting between the two reads would pair events cut
          // at N with a baseline folded to N+1.
          const scope = await presenterScopeFor(sessionId, sourceSession(source))
          const cut = historyCutOf(source, beforeSeq === undefined)
          const page = historyPage(ctx, cut.events, beforeSeq, maxMessages, scope)
          return ok(request, {
            events: page.events,
            hasMore: page.hasMore,
            ...cut.projections === undefined ? {} : { projections: cut.projections },
          })
        } catch (error: unknown) {
          if (error instanceof SessionNotFound) {
            return err(request, { code: 'session-not-found', message: error.message, details: { sessionId } })
          }
          return err(request, {
            code: 'internal',
            message: `history unavailable for session "${sessionId}": ${String(error)}`,
            details: {},
          })
        }
      },

      async models(request) {
        const { sessionId } = request.payload
        let agent: Agent
        // Model metadata is read-only and is needed to render a Team worker's
        // transcript. Coordinator ownership is required for prompt/model
        // mutation, but it must not block this harmless read when the worker
        // Agent is live and its Team binding is exact.
        const liveTeamAgent = ctx.agents.get(sessionId)
        if (liveTeamAgent !== undefined && hasTeamOwner(liveTeamAgent.session)) {
          agent = liveTeamAgent
        } else {
          const teamRoute = await teamCoordinatorRoute<SessionModels>(request, sessionId)
          if (teamRoute !== undefined && 'refused' in teamRoute) return teamRoute.refused
          if (teamRoute !== undefined) {
            agent = teamRoute.agent
          } else {
            const found = await agentFor(sessionId)
            if ('error' in found) return err(request, found.error)
            agent = found.agent
          }
        }
        const current = selectionFor(agent).current
        const { groups, failures } = await buildModelCatalog(ctx)
        const routable = current !== undefined && routeServed(current.provider)
        return ok(request, {
          ...current === undefined ? {} : { current: { ...current } },
          routable,
          groups,
          failures,
        })
      },

      async selectModel(request) {
        const { sessionId, provider, model, reasoningEffort } = request.payload
        const teamRoute = await teamCoordinatorRoute<{ selected: ModelSelection }>(request, sessionId)
        if (teamRoute !== undefined && 'refused' in teamRoute) return teamRoute.refused
        let agent: Agent
        if (teamRoute !== undefined) {
          agent = teamRoute.agent
        } else {
          const found = await agentFor(sessionId)
          if ('error' in found) return err(request, found.error)
          agent = found.agent
        }
        return serializeImageAdmission(agent, async () => {
          try {
            const resolved = await ctx.llm.resolveCallConfig({
              provider,
              model,
              ...reasoningEffort === undefined
                ? {}
                : { reasoningEffort: ReasoningEffortId(reasoningEffort) },
            })
            const selected: ModelSelection = {
              provider: resolved.provider,
              model: resolved.model,
              ...resolved.reasoningEffort === undefined
                ? {}
                : { reasoningEffort: resolved.reasoningEffort },
            }
            selectionFor(agent).current = selected
            try {
              await defaults.saveDefaultModelSelection?.(selected)
            } catch (error: unknown) {
              ctx.logger.warn(
                `api-proxy: the model switch applies to this session but was not saved as the default: ${String(error)}`,
              )
            }
            return ok(request, { selected: { ...selected } })
          } catch (error: unknown) {
            return err(request, {
              code: 'model-unavailable',
              message: error instanceof Error ? error.message : String(error),
              details: { provider, model },
            })
          }
        })
      },

      async rename(request) {
        const { sessionId, title } = request.payload
        const found = await agentFor(sessionId)
        if ('error' in found) return err(request, found.error)
        const titles = ctx.get('sessionTitle')
        if (titles === undefined) {
          return err(request, { code: 'internal', message: 'renaming is unavailable: this deployment mounts no session-title service', details: {} })
        }
        try {
          const accepted = titles.rename(found.agent.session, title)
          return ok(request, { title: accepted.title, seq: accepted.eventSeq })
        } catch (error: unknown) {
          // Only the input's fault maps to title-invalid (the message is
          // product-user-visible in the rename dialog); liveness and disposal
          // races are deployment trouble, not a bad title.
          if (error instanceof SessionTitleInvalidError) {
            return err(request, {
              code: 'title-invalid',
              message: error.message,
              details: { sessionId },
            })
          }
          return err(request, {
            code: 'internal',
            message: `failed to rename session "${sessionId}": ${String(error)}`,
            details: {},
          })
        }
      },

      async prompt(request) {
        const { sessionId, mode, content, clientTimeZone } = request.payload
        const canonicalTimeZone = clientTimeZone === undefined
          ? undefined
          : canonicalClientTimeZone(clientTimeZone)
        if (clientTimeZone !== undefined && canonicalTimeZone === undefined) {
          return err(request, {
            code: 'invalid-time-zone',
            message: 'clientTimeZone must be UTC or a valid IANA Area/Location name',
            details: { value: clientTimeZone },
          })
        }
        const teamRoute = await teamCoordinatorRoute<{ accepted: true }>(request, sessionId)
        if (teamRoute !== undefined) {
          if ('refused' in teamRoute) return teamRoute.refused
          const authentication = authenticatedTeamMutationCall(request)
          if ('refused' in authentication) return authentication.refused
          const ownerRefusal = await requireCurrentTeamRunHumanOwner(
            request, teamRoute.teams, teamRoute.teamId, authentication.call,
          )
          if (ownerRefusal !== undefined) return ownerRefusal
          const modelRefusal = turnRefusal<{ accepted: true }>(request, teamRoute.agent)
          if (modelRefusal !== undefined) return modelRefusal
          const hasImage = content.some(part => part.type === 'image')
          const admit = async (): Promise<RpcResponse<{ accepted: true }>> => {
            const admitted = await admitPromptContent<{ accepted: true }>(request, teamRoute.agent, content)
            if ('refused' in admitted) return admitted.refused
            try {
              await teamRoute.teamRuns.postHumanInput({
                teamId: teamRoute.teamId,
                content: admitted.content,
                delivery: mode === 'steer' ? 'steer' : 'turn',
                humanOwner: authenticatedHumanOwner(),
              })
            } catch (error: unknown) {
              return teamFailure(request, error, teamRoute.teamId)
            }
            return ok(request, { accepted: true as const })
          }
          return hasImage ? serializeImageAdmission(teamRoute.agent, admit) : admit()
        }
        const resolved = await turnAgentFor<{ accepted: true }>(request, sessionId)
        if ('refused' in resolved) return resolved.refused
        const agent = resolved.agent
        // Request identity and optional browser zone ride the exact durable user message.
        const source: MessageSource = {
          kind: 'user',
          rpcId: request.rpcId,
          ...(canonicalTimeZone === undefined ? {} : { clientTimeZone: canonicalTimeZone }),
        }
        const hasImage = content.some(part => part.type === 'image')
        const admit = async (): Promise<RpcResponse<{ accepted: true }>> => {
          const admitted = await admitPromptContent<{ accepted: true }>(request, agent, content)
          if ('refused' in admitted) return admitted.refused
          try {
            const message: UserMessage = createUserMessage({ content: admitted.content, source })
            if (mode === 'steer') agent.steer(message)
            else agent.followup(message)
          } catch (error: unknown) {
            return err(request, {
              code: 'agent-busy',
              message: 'prompt rejected',
              details: { reason: String(error) },
            })
          }
          return ok(request, { accepted: true as const })
        }
        return hasImage ? serializeImageAdmission(agent, admit) : admit()
      },

      async attachment(request) {
        const { sessionId, attachmentId } = request.payload
        let state: SessionReadState
        try {
          state = await readSessionState(sessionId)
        } catch (error: unknown) {
          if (error instanceof SessionNotFound) {
            return err(request, {
              code: 'session-not-found',
              message: error.message,
              details: { sessionId },
            })
          }
          return err(request, {
            code: 'internal',
            message: `attachment authorization unavailable for session "${sessionId}": ${String(error)}`,
            details: {},
          })
        }
        const ref = referencedImage(state.events, String(attachmentId))
        if (ref === undefined) {
          return err(request, {
            code: 'attachment-error',
            message: 'Image is not referenced by this session.',
            details: { reason: 'ATTACHMENT_NOT_REFERENCED' },
          })
        }
        try {
          const stored = await ctx.attachments.readImage(ref)
          return ok(request, {
            attachment: stored.ref,
            data: Buffer.from(stored.data).toString('base64'),
          })
        } catch (error: unknown) {
          if (error instanceof AttachmentError) {
            return err(request, {
              code: 'attachment-error',
              message: error.message,
              details: { reason: error.code },
            })
          }
          return err(request, {
            code: 'internal',
            message: 'Unable to read image attachment.',
            details: {},
          })
        }
      },

      updateQueue(request) {
        const { sessionId, itemId, action } = request.payload
        if (action.kind === 'edit' && action.content.some(block => block.type !== 'text')) {
          return Promise.resolve(err(request, {
            code: 'attachment-error',
            message: 'queue edits accept text content only',
            details: { reason: 'QUEUE_EDIT_NON_TEXT' },
          }))
        }
        const agent = ctx.agents.get(sessionId)
        if (agent !== undefined && hasTeamOwner(agent.session)) {
          return Promise.resolve(err(request, teamOwnershipError(sessionId)))
        }
        if (agent !== undefined && hasSubagentOwner(agent.session, agent)) {
          return Promise.resolve(err(request, subagentOwnershipError(sessionId)))
        }
        if (agent === undefined) {
          return Promise.resolve(err(request, {
            code: 'queue-item-not-found',
            message: 'queued item is no longer pending',
            details: { itemId },
          }))
        }
        const target = agent.inbox.nextTurn.some(message => message.id === itemId)
          ? 'next-turn'
          : agent.inbox.nextStep.some(message => message.id === itemId) ? 'next-step' : undefined
        const message = target === undefined
          ? undefined
          : (target === 'next-turn' ? agent.inbox.nextTurn : agent.inbox.nextStep)
            .find(candidate => candidate.id === itemId)
        if (target === undefined || message === undefined) {
          return Promise.resolve(err(request, {
            code: 'queue-item-not-found',
            message: 'queued item is no longer pending',
            details: { itemId },
          }))
        }
        if (action.kind === 'steer' && (target !== 'next-turn' || agent.status !== 'running')) {
          return Promise.resolve(err(request, {
            code: 'steer-unavailable',
            message: 'current turn no longer accepts steering',
            details: { itemId },
          }))
        }
        if (action.kind === 'edit') {
          agent.inbox.replace(itemId, freezeMessage({ ...message, content: action.content }))
        } else {
          agent.inbox.remove(itemId)
          if (action.kind === 'steer') agent.steer(message)
        }
        return Promise.resolve(ok(request, { accepted: true as const }))
      },

      async cancel(request) {
        const { sessionId } = request.payload
        const teamRoute = await teamCoordinatorRoute<{ accepted: true }>(request, sessionId)
        if (teamRoute !== undefined) {
          if ('refused' in teamRoute) return teamRoute.refused
          const refused = requireTeamMutationAuthentication<{ accepted: true }>(request)
          if (refused !== undefined) return refused
          return teamActorUnavailable(request, teamRoute.teamId)
        }
        const agent = ctx.agents.get(sessionId)
        if (agent === undefined) {
          return err(request, {
            code: 'session-not-found',
            message: `session "${sessionId}" not found (not attached)`,
            details: { sessionId },
          })
        }
        if (hasSubagentOwner(agent.session, agent)) {
          return err(request, subagentOwnershipError(sessionId))
        }
        agent.cancel({ kind: 'user' }, { keepInbox: true })
        return ok(request, { accepted: true as const })
      },
    },

    teams: {
      async list(request) {
        const service = teamServiceFor<Awaited<ReturnType<NonNullable<ReturnType<typeof ctx.get<'teams'>>>['listTeamsPage']>>>(request)
        if ('refused' in service) return service.refused
        try {
          return ok(request, await service.teams.listTeamsPage({
            afterCursor: request.payload.afterCursor ?? -1,
            limit: request.payload.limit ?? 128,
          }))
        } catch (error: unknown) {
          return teamFailure(request, error)
        }
      },

      async get(request) {
        const { teamId } = request.payload
        const service = teamServiceFor<TeamStateSnapshot>(request)
        if ('refused' in service) return service.refused
        try {
          return ok(request, redactTeamStateForHuman(await service.teams.getTeam({ teamId })))
        } catch (error: unknown) {
          return teamFailure(request, error, teamId)
        }
      },

      async create(request, signal) {
        const refused = requireTeamMutationAuthentication<TeamStateSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamRunFor<TeamStateSnapshot>(request)
        if ('refused' in service) return service.refused
        const preset = teamCreatePreset(request.payload.agentPreset)
        const selection = teamModelSelection(request.payload.selection)
        try {
          const run = await service.teamRuns.create({
            admitHumanChannel: authenticatedChannelAdmission(),
            objective: request.payload.objective,
            cwd: request.payload.cwd ?? defaults.cwd,
            humanOwner: authenticatedHumanOwner(),
            ...selection === undefined ? {} : { selection },
            ...preset === undefined ? {} : { preset },
            signal,
          })
          return ok(request, await service.teams.getTeam({ teamId: run.teamId }))
        } catch (error: unknown) {
          return teamFailure(request, error, undefined, signal)
        }
      },

      async resume(request, signal) {
        const refused = requireTeamMutationAuthentication<TeamStateSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamRunFor<TeamStateSnapshot>(request, request.payload.teamId)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const { cwd, agentPreset, ...untrustedInput } = request.payload
          const input = teamResumeInputSchema.parse(untrustedInput)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<TeamStateSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const preset = teamCreatePreset(agentPreset)
          const state = await humanActors.withProof(
            call,
            humanTeamResumeProofInput(input),
            async (actor) => {
              const authorization = await service.teams.authorizeHumanResume({ actor, ...input })
              try {
                const run = await service.teamRuns.resume({
                  admitHumanChannel: authenticatedChannelAdmission(),
                  teamId: input.teamId,
                  ...cwd === undefined ? {} : { cwd },
                  ...preset === undefined ? {} : { preset },
                  authorization,
                  humanOwner: authenticatedHumanOwner(),
                  signal,
                })
                return await service.teams.getTeam({ teamId: run.teamId })
              } finally {
                authorization.close()
              }
            },
          )
          return ok(request, redactTeamStateForHuman(state))
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId, signal)
        }
      },

      async start(request, signal) {
        const refused = requireTeamMutationAuthentication<TeamStartResult>(request)
        if (refused !== undefined) return refused
        const service = teamRunFor<TeamStartResult>(request)
        if ('refused' in service) return service.refused
        const preset = teamCreatePreset(request.payload.agentPreset)
        const selection = teamModelSelection(request.payload.selection)
        try {
          const started = await service.teamRuns.start({
            admitHumanChannel: authenticatedChannelAdmission(),
            objective: request.payload.objective,
            content: [{ type: 'text', text: request.payload.text }],
            idempotencyKey: request.payload.idempotencyKey,
            cwd: request.payload.cwd ?? defaults.cwd,
            humanOwner: authenticatedHumanOwner(),
            ...selection === undefined ? {} : { selection },
            ...preset === undefined ? {} : { preset },
            signal,
          })
          return ok(request, {
            state: await service.teams.getTeam({ teamId: started.handle.teamId }),
            envelopeId: started.input.id,
          })
        } catch (error: unknown) {
          return teamFailure(request, error, undefined, signal)
        }
      },

      async postInput(request) {
        const { teamId, text, content, idempotencyKey, delivery } = request.payload
        const authentication = authenticatedTeamMutationCall(request)
        if ('refused' in authentication) return authentication.refused
        const service = teamRunFor<{ envelopeId: EnvelopeId }>(request, teamId)
        if ('refused' in service) return service.refused
        const ownerRefusal = await requireCurrentTeamRunHumanOwner(
          request, service.teams, teamId, authentication.call,
        )
        if (ownerRefusal !== undefined) return ownerRefusal
        try {
          const input = content === undefined ? [{ type: 'text' as const, text: text ?? '' }] : content
          const durable = await durablePromptContent(ctx, input)
          const envelope = await service.teamRuns.postHumanInput({
            teamId,
            content: durable,
            humanOwner: authenticatedHumanOwner(),
            ...delivery === undefined ? {} : { delivery },
            ...idempotencyKey === undefined ? {} : { idempotencyKey },
          })
          return ok(request, { envelopeId: envelope.id })
        } catch (error: unknown) {
          return teamFailure(request, error, teamId)
        }
      },

      async waitFinal(request, signal) {
        const { teamId, afterCursor } = request.payload
        const authentication = authenticatedTeamMutationCall(request)
        if ('refused' in authentication) return authentication.refused
        const service = teamRunFor<TeamFinal>(request, teamId)
        if ('refused' in service) return service.refused
        const ownerRefusal = await requireCurrentTeamRunHumanOwner(
          request, service.teams, teamId, authentication.call,
        )
        if (ownerRefusal !== undefined) return ownerRefusal
        try {
          return ok(request, await service.teamRuns.waitForFinal({
            teamId,
            ...afterCursor === undefined ? {} : { afterCursor },
            humanOwner: authenticatedHumanOwner(),
            signal,
          }))
        } catch (error: unknown) {
          return teamFailure(request, error, teamId, signal)
        }
      },

      async cancel(request) {
        const { teamId } = request.payload
        const authentication = authenticatedTeamMutationCall(request)
        if ('refused' in authentication) return authentication.refused
        const teams = ctx.get('teams')
        const teamRuns = ctx.get('teamRuns')
        if (teams === undefined) {
          return err(request, {
            code: 'team-service-unavailable',
            message: 'Team RPC is unavailable: this host does not compose a Team provider',
            details: {},
          })
        }
        if (teamRuns === undefined) return teamActorUnavailable(request, teamId)
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, teamId)
        const ownerRefusal = await requireCurrentTeamRunHumanOwner(
          request, teams, teamId, authentication.call,
        )
        if (ownerRefusal !== undefined) return ownerRefusal
        try {
          await teamRuns.cancel(teamId, authenticatedHumanOwner())
          const state = await teams.getTeam({ teamId })
          return ok(request, { accepted: true as const, phase: state.team.phase })
        } catch (error: unknown) {
          if (error instanceof TeamRunError && error.code === 'TEAM_RUN_NOT_FOUND') {
            const state = await teams.getTeam({ teamId })
            const input = {
              teamId,
              expectedCursor: state.team.cursor,
            }
            try {
              await humanActors.withProof(
                authentication.call,
                humanTeamResumeProofInput(input),
                async (actor) => {
                  const authorization = await teams.authorizeHumanResume({ actor, ...input })
                  try {
                    const resumeRequest = {
                      teamId,
                      authorization,
                      admitHumanChannel: authenticatedChannelAdmission(),
                      humanOwner: authenticatedHumanOwner(),
                    } as const
                    try {
                      await teamRuns.resume(resumeRequest)
                    } catch (resumeError: unknown) {
                      if (!(resumeError instanceof TeamRunError) || resumeError.code !== 'TEAM_RUN_START_CONFLICT') throw resumeError
                      const activationController = ctx.get('teamActivations')
                      if (activationController === undefined) throw resumeError
                      const latest = await teams.getTeam({ teamId })
                      const coordinator = latest.participants.find(participant => participant.role === 'coordinator')
                      const binding = coordinator === undefined
                        ? undefined
                        : latest.activations.find(item => item.activation.participantId === coordinator.id)
                      if (coordinator === undefined || binding === undefined) throw resumeError
                      await activationController.fenceStale({
                        teamId,
                        participantId: coordinator.id,
                        activationId: binding.activation.id,
                        sessionId: binding.sessionId,
                        provider: binding.provider,
                        authorization,
                      })
                      await teamRuns.resume(resumeRequest)
                    }
                  } finally {
                    authorization.close()
                  }
                },
              )
              await teamRuns.cancel(teamId, authenticatedHumanOwner())
              const resumedAndCancelled = await teams.getTeam({ teamId })
              return ok(request, { accepted: true as const, phase: resumedAndCancelled.team.phase })
            } catch (fallbackError: unknown) {
              return teamFailure(request, fallbackError, teamId)
            }
          }
          return teamFailure(request, error, teamId)
        }
      },

      async archive(request) {
        const refused = requireTeamMutationAuthentication<TeamStateSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<TeamStateSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = teamArchiveInputSchema.parse(request.payload)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<TeamStateSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const state = await humanActors.withProof(
            call,
            humanTeamArchiveProofInput(input),
            async actor => await service.teams.archiveTeam({ actor, ...input }),
          )
          return ok(request, redactTeamStateForHuman(state))
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async goalUpdate(request) {
        const refused = requireTeamMutationAuthentication<TeamStateSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<TeamStateSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = teamGoalUpdateInputSchema.parse(request.payload)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<TeamStateSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const state = await humanActors.withProof(
            call,
            humanTeamGoalProofInput(input),
            async actor => await service.teams.updateTeamGoal({ actor, ...input }),
          )
          return ok(request, redactTeamStateForHuman(state))
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async goalTransition(request) {
        const refused = requireTeamMutationAuthentication<TeamStateSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<TeamStateSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = teamGoalPhaseTransitionInputSchema.parse(request.payload)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<TeamStateSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const state = await humanActors.withProof(
            call,
            humanTeamGoalProofInput(input),
            async actor => await service.teams.transitionTeamGoalPhase({ actor, ...input }),
          )
          return ok(request, redactTeamStateForHuman(state))
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async quiescence(request) {
        const { teamId } = request.payload
        const service = teamServiceFor<Awaited<ReturnType<NonNullable<ReturnType<typeof ctx.get<'teams'>>>['inspectQuiescence']>>>(request)
        if ('refused' in service) return service.refused
        try {
          return ok(request, await service.teams.inspectQuiescence(teamId))
        } catch (error: unknown) {
          return teamFailure(request, error, teamId)
        }
      },

      async inboxRespond(request) {
        const call = currentAuthenticatedProductCall()
        if (call === undefined || call.signal.aborted) return teamActorUnavailable(request)
        const inbox = ctx.get('teamHumanDelivery')
        try {
          if (inbox === undefined) throw new TeamError('Durable principal inbox is not mounted', 'TEAM_INVALID_ARGUMENT')
          return ok(request, await inbox.respond(call, request.payload))
        } catch (error: unknown) { return teamFailure(request, error, request.payload.teamId) }
      },

      async inboxRead(request) {
        const call = currentAuthenticatedProductCall()
        if (call === undefined || call.signal.aborted) return teamActorUnavailable(request)
        const inbox = ctx.get('teamHumanDelivery')
        try {
          if (inbox === undefined) throw new TeamError('Durable principal inbox is not mounted', 'TEAM_INVALID_ARGUMENT')
          return ok(request, await inbox.read(call, request.payload))
        } catch (error: unknown) { return teamFailure(request, error) }
      },

      async inboxWatch(request) {
        const call = currentAuthenticatedProductCall()
        if (call === undefined || call.signal.aborted) return teamActorUnavailable(request)
        const inbox = ctx.get('teamHumanDelivery')
        try {
          if (inbox === undefined) throw new TeamError('Durable principal inbox is not mounted', 'TEAM_INVALID_ARGUMENT')
          return ok(request, await inbox.watch(call, request.payload))
        } catch (error: unknown) { return teamFailure(request, error) }
      },

      async inboxAcknowledge(request) {
        const call = currentAuthenticatedProductCall()
        if (call === undefined || call.signal.aborted) return teamActorUnavailable(request)
        const inbox = ctx.get('teamHumanDelivery')
        try {
          if (inbox === undefined) throw new TeamError('Durable principal inbox is not mounted', 'TEAM_INVALID_ARGUMENT')
          return ok(request, await inbox.acknowledge(call, request.payload))
        } catch (error: unknown) { return teamFailure(request, error) }
      },

      async metrics(request) {
        const service = teamServiceFor<TeamMetricsSnapshot>(request)
        if ('refused' in service) return service.refused
        try {
          return await Promise.resolve(ok(request, service.teams.getMetrics()))
        } catch (error: unknown) {
          return teamFailure(request, error)
        }
      },

      async auditRead(request) {
        const { teamId, channelId, afterCursor, limit } = request.payload
        const service = teamServiceFor<TeamAuditList>(request)
        if ('refused' in service) return service.refused
        try {
          return ok(request, await service.teams.readAudit({
            teamId,
            ...channelId === undefined ? {} : { channelId },
            afterCursor: afterCursor ?? -1,
            limit: limit ?? 128,
          }))
        } catch (error: unknown) {
          return teamFailure(request, error, teamId)
        }
      },

      async artifactRead(request, signal) {
        const { teamId, artifactId } = request.payload
        const service = teamServiceFor<TeamArtifactReadResult>(request)
        if ('refused' in service) return service.refused
        try {
          const lookup = await service.teams.getArtifact({ teamId, artifactId })
          if (lookup === undefined) {
            return err(request, {
              code: 'team-artifact-not-found',
              message: `visible Team artifact '${artifactId}' was not found`,
              details: { teamId, artifactId },
            })
          }
          if (lookup.provider === undefined) {
            return err(request, {
              code: 'team-artifact-unavailable',
              message: `Team artifact '${artifactId}' has no readable provider`,
              details: { teamId, artifactId },
            })
          }
          const artifacts = ctx.get('teamArtifacts')
          if (artifacts === undefined || artifacts.getProvider(lookup.provider) === undefined) {
            return err(request, {
              code: 'team-artifact-unavailable',
              message: `Team artifact '${artifactId}' provider is unavailable`,
              details: { teamId, artifactId },
            })
          }
          signal.throwIfAborted()
          const bytes = await artifacts.read(lookup.provider, { reference: lookup, signal })
          signal.throwIfAborted()
          if (bytes.byteLength > MAX_TEAM_ARTIFACT_READ_BYTES) {
            return err(request, {
              code: 'team-artifact-unavailable',
              message: `Team artifact '${artifactId}' exceeds the browser read limit`,
              details: { teamId, artifactId },
            })
          }
          return ok(request, {
            artifact: lookup,
            bytes: bytes.byteLength,
            data: Buffer.from(bytes).toString('base64'),
          })
        } catch (error: unknown) {
          if (signal.aborted) return teamFailure(request, error, teamId, signal)
          if (error instanceof TeamArtifactError && error.code === 'TEAM_ARTIFACT_NOT_FOUND') {
            return err(request, {
              code: 'team-artifact-not-found',
              message: `visible Team artifact '${artifactId}' is no longer available`,
              details: { teamId, artifactId },
            })
          }
          return err(request, {
            code: 'team-artifact-unavailable',
            message: `Team artifact '${artifactId}' could not be read`,
            details: { teamId, artifactId },
          })
        }
      },

      async artifactList(request) {
        const { teamId, afterCursor, limit } = request.payload
        const service = teamServiceFor<Awaited<ReturnType<NonNullable<ReturnType<typeof ctx.get<'teams'>>>['listArtifactsPage']>>>(request)
        if ('refused' in service) return service.refused
        try {
          return ok(request, await service.teams.listArtifactsPage({
            teamId,
            afterCursor: afterCursor ?? -1,
            limit: limit ?? 128,
          }))
        } catch (error: unknown) {
          return teamFailure(request, error, teamId)
        }
      },

      async memberList(request) {
        const { teamId, afterCursor, limit } = request.payload
        const service = teamServiceFor<Awaited<ReturnType<NonNullable<ReturnType<typeof ctx.get<'teams'>>>['listParticipantsPage']>>>(request)
        if ('refused' in service) return service.refused
        try {
          return ok(request, await service.teams.listParticipantsPage({
            teamId,
            afterCursor: afterCursor ?? -1,
            limit: limit ?? 128,
          }))
        } catch (error: unknown) {
          return teamFailure(request, error, teamId)
        }
      },

      async memberInvite(request) {
        const refused = requireTeamMutationAuthentication<ParticipantSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<ParticipantSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = participantInviteInputSchema.parse(request.payload)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<ParticipantSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const participant = await humanActors.withProof(
            call,
            humanParticipantInviteProofInput(input),
            async actor => await service.teams.inviteParticipant({ actor, ...input }),
          )
          return ok(request, participant)
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async memberActivate(request) {
        const refused = requireTeamMutationAuthentication<ParticipantSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<ParticipantSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = participantPhaseTransitionInputSchema.parse({ ...request.payload, phase: 'active' })
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<ParticipantSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const participant = await humanActors.withProof(
            call,
            humanParticipantPhaseProofInput(input, 'activate'),
            async actor => await service.teams.transitionParticipantPhase({ actor, ...input }),
          )
          return ok(request, participant)
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async memberRemove(request) {
        const refused = requireTeamMutationAuthentication<ParticipantSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<ParticipantSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = participantPhaseTransitionInputSchema.parse({ ...request.payload, phase: 'left' })
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<ParticipantSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const participant = await humanActors.withProof(
            call,
            humanParticipantPhaseProofInput(input, 'close'),
            async actor => await service.teams.transitionParticipantPhase({ actor, ...input }),
          )
          return ok(request, participant)
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async memberInterrupt(request) {
        const refused = requireTeamMutationAuthentication<ParticipantInterruptSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<ParticipantInterruptSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = participantInterruptRequestInputSchema.parse(request.payload)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<ParticipantInterruptSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const interrupt = await humanActors.withProof(
            call,
            humanParticipantInterruptProofInput(input),
            async actor => await service.teams.requestParticipantInterrupt({ actor, ...input }),
          )
          return ok(request, interrupt)
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      channelCatalog(request) {
        return Promise.resolve().then(() => {
          const refused = requireTeamMutationAuthentication<import('@clocky/clocky-team').TeamChannelCatalog>(request)
          if (refused !== undefined) return refused
          const service = teamServiceFor<import('@clocky/clocky-team').TeamChannelCatalog>(request)
          if ('refused' in service) return service.refused
          const summaries = ctx.get('teamChannelSummaries')
          return ok(request, { adapters: service.teams.listAdapters(), viewPolicies: service.teams.listViewPolicies(),
            ...summaries === undefined ? {} : { summary: summaries.describe() } })
        })
      },

      async channelList(request) {
        const refused = requireTeamMutationAuthentication<import('@clocky/clocky-team').TeamChannelListPage>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<import('@clocky/clocky-team').TeamChannelListPage>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = teamChannelListInputSchema.parse(request.payload)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) return teamActorUnavailable(request, input.teamId)
          return ok(request, await humanActors.withProof(call, { teamId: input.teamId, operation: 'channel-list-read',
            fence: { kind: 'read' }, payload: jsonObjectSchema.parse(input) },
          async actor => await service.teams.listTeamChannels({ actor, ...input })))
        } catch (error: unknown) { return teamFailure(request, error, request.payload.teamId) }
      },

      async channelAdmission(request) {
        const refused = requireTeamMutationAuthentication<import('@clocky/clocky-team').ChannelHumanAdmissionSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<import('@clocky/clocky-team').ChannelHumanAdmissionSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = { teamId: teamIdSchema.parse(request.payload.teamId), channelId: channelIdSchema.parse(request.payload.channelId) }
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) return teamActorUnavailable(request, input.teamId)
          return ok(request, await humanActors.withProof(call, { teamId: input.teamId, operation: 'channel-admission-read',
            fence: { kind: 'read' }, payload: jsonObjectSchema.parse(input) },
          async actor => await service.teams.getHumanChannelAdmission({ actor, ...input })))
        } catch (error: unknown) { return teamFailure(request, error, request.payload.teamId) }
      },

      async channelInvitation(request) {
        const refused = requireTeamMutationAuthentication<import('@clocky/clocky-team').ChannelHumanInvitationSnapshot>(request)
        if (refused !== undefined) return refused
        try {
          const call = currentAuthenticatedProductCall()
          if (call === undefined) return teamActorUnavailable(request)
          return ok(request, await getPrincipalChannelInvitation(ctx, call, request.payload))
        } catch (error: unknown) {
          return teamFailure(request, error)
        }
      },

      async channelInvitationAcknowledge(request) {
        const refused = requireTeamMutationAuthentication<import('@clocky/clocky-team').ChannelHumanInvitationSnapshot>(request)
        if (refused !== undefined) return refused
        try {
          const call = currentAuthenticatedProductCall()
          if (call === undefined) return teamActorUnavailable(request)
          return ok(request, await acknowledgePrincipalChannelInvitation(ctx, call, request.payload))
        } catch (error: unknown) {
          return teamFailure(request, error)
        }
      },

      async channelOpen(request) {
        const refused = requireTeamMutationAuthentication<ChannelSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<ChannelSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = channelOpenInputSchema.parse(request.payload)
          const { workflowPlanId, expectedPlanRevision, ...genericInput } = input
          if (workflowPlanId !== undefined || expectedPlanRevision !== undefined) {
            throw new TeamError('Product channel opening cannot select a workflow plan', 'TEAM_INVALID_ARGUMENT')
          }
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<ChannelSnapshot>(request)
              ?? teamActorUnavailable(request, genericInput.teamId)
          }
          const channel = await humanActors.withProof(
            call,
            humanChannelOpenProofInput(genericInput),
            async actor => await service.teams.openChannel({ actor, authorityKind: 'human', ...genericInput }),
          )
          return ok(request, channel)
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async channelInput(request) {
        const refused = requireTeamMutationAuthentication<TeamEnvelope>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<TeamEnvelope>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request)
        try {
          const input = teamChannelInputRequestSchema.parse(request.payload)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) return teamActorUnavailable(request)
          const own = await getPrincipalChannelInvitation(ctx, call, { channelId: input.channelId })
          const adapter = own.channel.manifest.adapter
          if (adapter.type !== 'direct') {
            const first = input.content[0]
            if (input.content.length !== 1 || first?.type !== 'text') throw new TeamError('Basic channel input requires exactly one text block', 'TEAM_INVALID_ARGUMENT')
            const draft = await resolvePrincipalChannelText(ctx, call, own, { ...input, text: first.text })
            const command = channelPostCommandInput({ ...input, ...draft })
            return ok(request, await humanActors.withProof(call, humanChannelPostProofInput(own.channel.manifest.teamId, command),
              actor => service.teams.postChannelEnvelope({ actor, ...command })))
          }
          if (own.invitation.status !== 'acknowledged' || (input.idempotencyKey === undefined && own.channel.phase !== 'active')
            || ![3, 4].includes(adapter.version)) {
            throw new TeamError('Text and image input requires an acknowledged invitation in an active direct version 3 or 4 channel', 'TEAM_INVALID_ARGUMENT')
          }
          const parts: PromptContentPart[] = input.content.map(part => part.type === 'text' ? part : {
            type: 'image', mediaType: part.mediaType, data: part.data, ...part.name === undefined ? {} : { name: part.name },
          })
          const content = await durablePromptContent(ctx, parts)
          call.signal.throwIfAborted()
          const command = channelPostCommandInput({ ...input, kind: 'message', payload: jsonObjectSchema.parse({ content }) })
          const envelope = await humanActors.withProof(call, humanChannelPostProofInput(own.channel.manifest.teamId, command),
            async actor => await service.teams.postChannelEnvelope({ actor, ...command }))
          return ok(request, envelope)
        } catch (error: unknown) { return teamFailure(request, error) }
      },

      async channelAttachment(request) {
        const refused = requireTeamMutationAuthentication<import('./api/teams.ts').TeamChannelAttachment>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<import('./api/teams.ts').TeamChannelAttachment>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const { attachmentId, ...input } = teamChannelAttachmentRequestSchema.parse(request.payload)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) return teamActorUnavailable(request, input.teamId)
          const image = await humanActors.withProof(call, { teamId: input.teamId, operation: 'channel-content-read',
            fence: { kind: 'read' }, payload: jsonObjectSchema.parse(input) }, async (actor) => {
            const envelope = await service.teams.getHumanChannelEnvelope({ actor, ...input })
            const ref = imageBlockIn(envelope.payload.content, candidate => String(candidate.attachmentId) === String(attachmentId))
            if (ref === undefined) return undefined
            const stored = await ctx.attachments.readImage(ref, call.signal)
            await service.teams.getHumanChannelEnvelope({ actor, ...input })
            return { attachment: stored.ref, data: Buffer.from(stored.data).toString('base64') }
          })
          if (image === undefined) return err(request, { code: 'attachment-error',
            message: 'Image is not referenced by this channel message.', details: { reason: 'ATTACHMENT_NOT_REFERENCED' } })
          return ok(request, image)
        } catch (error: unknown) {
          if (error instanceof TeamError && error.code === 'TEAM_CHANNEL_ENVELOPE_NOT_FOUND') {
            return err(request, { code: 'attachment-error', message: error.message, details: { reason: 'ATTACHMENT_NOT_REFERENCED' } })
          }
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async channelPost(request) {
        const refused = requireTeamMutationAuthentication<TeamEnvelope>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<TeamEnvelope>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request)
        const input = channelPostCommandInput(request.payload)
        try {
          const channel = await service.teams.getChannel({ channelId: input.draft.channelId })
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            const currentRefusal = requireTeamMutationAuthentication<TeamEnvelope>(request)
            return currentRefusal ?? teamActorUnavailable(request, channel.manifest.teamId)
          }
          const envelope = await humanActors.withProof(
            call,
            humanChannelPostProofInput(channel.manifest.teamId, input),
            async actor => await service.teams.postChannelEnvelope({ actor, ...input }),
          )
          return ok(request, envelope)
        } catch (error: unknown) {
          return teamFailure(request, error)
        }
      },

      async channelSummarize(request) {
        const refused = requireTeamMutationAuthentication<import('@clocky/clocky-team').ChannelSummaryRecord>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<import('@clocky/clocky-team').ChannelSummaryRecord>(request)
        if ('refused' in service) return service.refused
        const summaries = ctx.get('teamChannelSummaries')
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request)
        try {
          if (summaries === undefined) throw new TeamError('Explicit channel summary Consumer is not mounted', 'TEAM_INVALID_ARGUMENT')
          const input = channelSummarySelectionInputSchema.parse(request.payload)
          const channel = await service.teams.getChannel({ channelId: input.channelId })
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) return teamActorUnavailable(request, channel.manifest.teamId)
          const summary = await humanActors.withProof(call, channelSummaryHumanProofInput(channel.manifest.teamId, input),
            async requester => await summaries.summarize({ requester, ...input }))
          return ok(request, summary)
        } catch (error: unknown) { return teamFailure(request, error) }
      },

      async channelRead(request) {
        const service = teamServiceFor<Awaited<ReturnType<NonNullable<ReturnType<typeof ctx.get<'teams'>>>['readChannelPage']>>>(request)
        if ('refused' in service) return service.refused
        try {
          return ok(request, await service.teams.readChannelPage({
            channelId: request.payload.channelId,
            afterCursor: request.payload.afterCursor ?? -1,
            limit: request.payload.limit ?? 128,
          }))
        } catch (error: unknown) {
          return teamFailure(request, error)
        }
      },

      async channelClose(request) {
        const refused = requireTeamMutationAuthentication<ChannelSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<ChannelSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request)
        try {
          const input = channelCloseInputSchema.parse(request.payload)
          const channel = await service.teams.getChannel({ channelId: input.channelId })
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<ChannelSnapshot>(request)
              ?? teamActorUnavailable(request, channel.manifest.teamId)
          }
          const closed = await humanActors.withProof(
            call,
            humanChannelCloseProofInput(channel.manifest.teamId, input),
            async actor => await service.teams.closeChannel({ actor, ...input }),
          )
          return ok(request, closed)
        } catch (error: unknown) {
          return teamFailure(request, error)
        }
      },

      async channelWatch(request, signal) {
        const service = teamServiceFor<Awaited<ReturnType<NonNullable<ReturnType<typeof ctx.get<'teams'>>>['watchChannel']>>>(request)
        if ('refused' in service) return service.refused
        try {
          return ok(request, await service.teams.watchChannel({
            channelId: request.payload.channelId,
            afterCursor: request.payload.afterCursor ?? -1,
            signal,
          }))
        } catch (error: unknown) {
          return teamFailure(request, error, undefined, signal)
        }
      },

      async taskCreate(request) {
        const refused = requireTeamMutationAuthentication<TeamTaskSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<TeamTaskSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const { idempotencyKey, ...payload } = request.payload
          const input = teamTaskCreateInputSchema.parse({ ...payload, createCommand: { idempotencyKey } })
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<TeamTaskSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const task = await humanActors.withProof(
            call,
            humanTaskCreateProofInput(input),
            async actor => await service.teams.createTask({ actor, ...input }),
          )
          return ok(request, redactTaskForHuman(task))
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async taskGet(request) {
        const { teamId, taskId } = request.payload
        const service = teamServiceFor<Awaited<ReturnType<NonNullable<ReturnType<typeof ctx.get<'teams'>>>['getTask']>>>(request)
        if ('refused' in service) return service.refused
        try {
          return ok(request, redactTaskForHuman(await service.teams.getTask({ teamId, taskId })))
        } catch (error: unknown) {
          return teamFailure(request, error, teamId)
        }
      },

      async taskList(request) {
        const { teamId, afterCursor, limit } = request.payload
        const service = teamServiceFor<Awaited<ReturnType<NonNullable<ReturnType<typeof ctx.get<'teams'>>>['listTasksPage']>>>(request)
        if ('refused' in service) return service.refused
        try {
          const page = await service.teams.listTasksPage({
            teamId,
            afterCursor: afterCursor ?? -1,
            limit: limit ?? 128,
          })
          return ok(request, { ...page, items: page.items.map(redactTaskForHuman) })
        } catch (error: unknown) {
          return teamFailure(request, error, teamId)
        }
      },

      async workflowPlanList(request) {
        const input = teamWorkflowPlanListRequestSchema.parse(request.payload)
        const service = teamServiceFor<TeamWorkflowPlanList>(request)
        if ('refused' in service) return service.refused
        try {
          const page = await service.teams.listWorkflowPlansPage({
            teamId: input.teamId,
            afterCursor: input.afterCursor ?? -1,
            limit: input.limit ?? 128,
          })
          return ok(request, {
            items: page.items.map(redactWorkflowPlanForHuman),
            ...page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor },
          })
        } catch (error: unknown) {
          return teamFailure(request, error, input.teamId)
        }
      },

      async taskUpdate(request) {
        const refused = requireTeamMutationAuthentication<TeamTaskSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<TeamTaskSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = teamTaskDetailsUpdateInputSchema.parse(request.payload)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<TeamTaskSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const task = await humanActors.withProof(
            call,
            humanTaskRevisionProofInput(input),
            async actor => await service.teams.updateTaskDetails({ actor, ...input }),
          )
          return ok(request, redactTaskForHuman(task))
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async taskCancel(request) {
        const refused = requireTeamMutationAuthentication<TeamTaskSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<TeamTaskSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = teamTaskCancelInputSchema.parse(request.payload)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<TeamTaskSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const task = await humanActors.withProof(
            call,
            humanTaskRevisionProofInput(input),
            async actor => await service.teams.cancelTask({ actor, ...input }),
          )
          return ok(request, redactTaskForHuman(task))
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async taskDelete(request) {
        const refused = requireTeamMutationAuthentication<TeamTaskSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<TeamTaskSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = teamTaskDeleteInputSchema.parse(request.payload)
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<TeamTaskSnapshot>(request)
              ?? teamActorUnavailable(request, input.teamId)
          }
          const task = await humanActors.withProof(
            call,
            humanTaskRevisionProofInput(input),
            async actor => await service.teams.deleteTask({ actor, ...input }),
          )
          return ok(request, redactTaskForHuman(task))
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async taskReview(request) {
        const refused = requireTeamMutationAuthentication<TeamTaskSnapshot>(request)
        if (refused !== undefined) return refused
        const service = teamServiceFor<TeamTaskSnapshot>(request)
        if ('refused' in service) return service.refused
        const humanActors = ctx.get('teamHumanActors')
        if (humanActors === undefined) return teamActorUnavailable(request, request.payload.teamId)
        try {
          const input = teamTaskReviewResolveInputSchema.parse({
            taskId: request.payload.taskId,
            expectedRevision: request.payload.expectedRevision,
            nextPhase: request.payload.decision === 'accepted' ? 'completed' : 'pending',
            reason: request.payload.reason,
          })
          const call = currentAuthenticatedProductCall()
          if (call === undefined || call.signal.aborted) {
            return requireTeamMutationAuthentication<TeamTaskSnapshot>(request)
              ?? teamActorUnavailable(request, request.payload.teamId)
          }
          const task = await humanActors.withProof(
            call,
            humanTaskReviewProofInput(request.payload.teamId, input),
            async actor => await service.teams.resolveTaskReview({ actor, ...input }),
          )
          return ok(request, redactTaskForHuman(task))
        } catch (error: unknown) {
          return teamFailure(request, error, request.payload.teamId)
        }
      },

      async taskWatch(request, signal) {
        const { teamId, afterCursor } = request.payload
        const service = teamServiceFor<Awaited<ReturnType<NonNullable<ReturnType<typeof ctx.get<'teams'>>>['watchTeam']>>>(request)
        if ('refused' in service) return service.refused
        try {
          return ok(request, await service.teams.watchTeam({ teamId, afterCursor: afterCursor ?? -1, signal }))
        } catch (error: unknown) {
          return teamFailure(request, error, teamId, signal)
        }
      },
    },

    workspace: {
      list(request) {
        return Promise.resolve(ok(request, {
          items: ctx.workspaceRegistry.list().map(workspaceView),
          archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds],
        }))
      },

      async create(request) {
        const { path } = request.payload
        try {
          const { workspace, created } = await ensureWorkspace(path)
          return ok(request, { workspace: workspaceView(workspace), created })
        } catch (error: unknown) {
          // The registry rejects a path that does not resolve to an existing
          // directory (realpath ENOENT / not-a-directory) — the business
          // error of the typed-path flow, surfaced as a validation failure.
          return err(request, {
            code: 'workspace-invalid-path',
            message: `cannot create a workspace at "${path}": ${error instanceof Error ? error.message : String(error)}`,
            details: { path },
          })
        }
      },

      async rename(request) {
        const { payload } = request
        const workspace = ctx.workspaceRegistry.get(brandWorkspaceId(payload.workspaceId))
        if (workspace === undefined) return workspaceNotFound(request, payload.workspaceId)
        const title = payload.title.trim()
        // Uniqueness AND the same-title no-op both ride the create chain so
        // they observe the state left by earlier queued renames — checked
        // up front, a queued A→A could report success while an earlier A→B
        // still lands afterwards.
        const operation = workspaceCreationChain.then(async () => {
          if (title === workspace.title) return
          if (ctx.workspaceRegistry.list().some(other => other.id !== workspace.id && other.title === title)) {
            throw new WorkspaceNameConflictError(title)
          }
          await workspace.setTitle(title)
        })
        workspaceCreationChain = operation.then(() => undefined, () => undefined)
        try {
          await operation
        } catch (error: unknown) {
          if (error instanceof WorkspaceNameConflictError) {
            return err(request, {
              code: 'workspace-name-conflict',
              message: error.message,
              details: { name: error.workspaceName },
            })
          }
          throw error
        }
        return ok(request, { workspace: workspaceView(workspace) })
      },

      async delete(request) {
        const { workspaceId } = request.payload
        const operation = workspaceCreationChain.then(() =>
          ctx.workspaceRegistry.delete(brandWorkspaceId(workspaceId)))
        workspaceCreationChain = operation.then(() => undefined, () => undefined)
        if (!await operation) return workspaceNotFound(request, workspaceId)
        return ok(request, { deleted: true as const })
      },

      async insertBefore(request) {
        const { workspaceId, beforeWorkspaceId } = request.payload
        try {
          const workspaceIds = await ctx.workspaceRegistry.insertBefore(
            brandWorkspaceId(workspaceId),
            beforeWorkspaceId === undefined ? undefined : brandWorkspaceId(beforeWorkspaceId),
          )
          return ok(request, { workspaceIds: [...workspaceIds] })
        } catch (error: unknown) {
          if (!(error instanceof WorkspaceOrderInvalidError)) throw error
          return workspaceNotFound(request, error.workspaceId)
        }
      },

      async insertSessionBefore(request) {
        const { payload } = request
        const workspace = ctx.workspaceRegistry.get(brandWorkspaceId(payload.workspaceId))
        if (workspace === undefined) return workspaceNotFound(request, payload.workspaceId)
        try {
          await workspace.insertSessionBefore(payload.sessionId, payload.beforeSessionId)
        } catch (error: unknown) {
          // Only the entity's unaccounted-id rejection is the business code;
          // storage/durability failures propagate as internal errors.
          if (!(error instanceof WorkspaceMoveInvalidError)) throw error
          return err(request, {
            code: 'workspace-move-invalid',
            message: error.message,
            details: {
              workspaceId: payload.workspaceId,
              sessionId: payload.sessionId,
              ...payload.beforeSessionId === undefined ? {} : { beforeSessionId: payload.beforeSessionId },
            },
          })
        }
        return ok(request, { workspace: workspaceView(workspace) })
      },

      async archiveSession(request) {
        const { sessionId } = request.payload
        try {
          await ctx.workspaceRegistry.archiveSession(sessionId)
        } catch (error: unknown) {
          // Only the registry's unknown-session rejection is the business
          // code; storage/durability failures propagate as internal errors.
          if (!(error instanceof WorkspaceUnknownSessionError)) throw error
          return err(request, {
            code: 'session-not-found',
            message: error.message,
            details: { sessionId },
          })
        }
        return ok(request, { archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds] })
      },
    },

    host: {
      describe(request) {
        // TODO: version should read apps/cli's package.json; placeholder for now.
        const selection = defaults.defaultModelSelection()
        return Promise.resolve(ok(request, {
          version: '0.0.1',
          // The configured execution-root fallback exposed to Host clients.
          cwd: defaults.cwd,
          // Read live for the same reason: this is what the NEXT session will
          // start from, so a saved default has to be what it reports.
          ...selection === undefined ? {} : { provider: selection.provider, model: selection.model },
          attachedSessions: ctx.agents.list().length,
          home: homedir(),
          canOpenPath: canOpenPaths(),
        }))
      },

      async pickDirectory(request, signal) {
        const capability = ctx.directoryPicker.capability()
        if (capability.kind !== 'native') {
          return err(request, {
            code: 'directory-picker-unavailable',
            message: `host.pickDirectory needs the native capability; the composed picker serves "${capability.kind}"`,
            details: { capability: capability.kind },
          })
        }
        try {
          const path = await capability.pick(signal)
          return ok(request, { path })
        } catch (error: unknown) {
          if (signal.aborted) {
            return err(request, {
              code: 'cancelled',
              message: 'directory picker was aborted',
              details: {},
            })
          }
          return err(request, {
            code: 'internal',
            message: `directory picker failed: ${error instanceof Error ? error.message : String(error)}`,
            details: {},
          })
        }
      },

      async listDirectory(request, signal) {
        const capability = ctx.directoryPicker.capability()
        if (capability.kind !== 'browse') {
          return err(request, {
            code: 'directory-picker-unavailable',
            message: `host.listDirectory needs the browse capability; the composed picker serves "${capability.kind}"`,
            details: { capability: capability.kind },
          })
        }
        try {
          // The carrier's signal follows the caller: a disconnect or timeout
          // stops the backend's directory scan instead of outliving it.
          return ok(request, await capability.list(request.payload.path, signal))
        } catch (error: unknown) {
          // An abort is the caller's own timeout/disconnect, not a server
          // failure — same code pickDirectory and command.execute report.
          if (signal.aborted) {
            return err(request, { code: 'cancelled', message: 'directory listing was aborted', details: {} })
          }
          return err(request, directoryError(error))
        }
      },

      async createDirectory(request) {
        const capability = ctx.directoryPicker.capability()
        if (capability.kind !== 'browse') {
          return err(request, {
            code: 'directory-picker-unavailable',
            message: `host.createDirectory needs the browse capability; the composed picker serves "${capability.kind}"`,
            details: { capability: capability.kind },
          })
        }
        try {
          return ok(request, { path: await capability.createDirectory(request.payload.path, request.payload.name) })
        } catch (error: unknown) {
          return err(request, directoryError(error))
        }
      },

      async openPath(request, signal) {
        return openPath(request, request.payload.path, signal)
      },
    },

    goals: {
      // Mutations only — the read side is the 'goal' session projection.
      // Every verb resolves the session's agent (agentFor: implicit cold
      // resume, the command.* precedent) and acknowledges with the new CAS
      // ref; the committed goal/change event carries the whole value to every
      // client through the projection frames.
      async create(request) {
        const { objective, maxGoalRounds } = request.payload
        return mutateGoal(request, (goals, agent) => goals.create(agent, {
          objective,
          ...(maxGoalRounds !== undefined ? { maxGoalRounds } : {}),
        }))
      },

      async edit(request) {
        const { ref, objective, maxGoalRounds } = request.payload
        return mutateGoal(request, (goals, agent) => goals.edit(agent, ref, {
          ...(objective !== undefined ? { objective } : {}),
          ...(maxGoalRounds !== undefined ? { maxGoalRounds } : {}),
        }))
      },

      async pause(request) {
        return mutateGoal(request, (goals, agent) => goals.pause(agent, request.payload.ref))
      },

      async resume(request) {
        return mutateGoal(request, (goals, agent) => goals.resume(agent, request.payload.ref))
      },

      async complete(request) {
        return mutateGoal(request, (goals, agent) => goals.complete(agent, request.payload.ref))
      },

      async clear(request) {
        const found = await agentFor(request.payload.sessionId)
        if ('error' in found) return err(request, found.error)
        const goals = goalServiceFor(found.agent)
        if ('error' in goals) return err(request, goals.error)
        try {
          goals.clear(found.agent, request.payload.ref)
          return ok(request, { cleared: true as const })
        } catch (error: unknown) {
          return goalError(request, error)
        }
      },
    },

    agentPresets: {
      // A deployment with no roster answers with an empty list rather than an
      // error: composing no presets is a valid deployment, and the browser
      // simply offers no choice.
      async list(request) {
        const presets = ctx.get('agentPresets')
        if (presets === undefined) return ok(request, { presets: [], authorable: false, hasDocument: false })
        const defaultId = presets.defaultId
        return ok(request, {
          presets: (await presets.list()).map(preset => ({
            id: preset.id,
            trust: preset.trust,
            isDefault: preset.id === defaultId,
            ...preset.name === undefined ? {} : { name: preset.name },
            ...preset.description === undefined ? {} : { description: preset.description },
            ...preset.broken === undefined ? {} : { broken: preset.broken },
          })),
          authorable: presets.authorable,
          hasDocument: canOpenPaths(),
        })
      },

      // Recomposing is limited to a blank session because a started
      // conversation's history was produced under its preset's tools; the
      // agent and the session survive, only the composition is swapped.
      async select(request) {
        const { sessionId, agentPreset } = request.payload
        const presets = ctx.get('agentPresets')
        if (presets === undefined) {
          return err(request, {
            code: 'agent-preset-not-found',
            message: 'this deployment composes no agent presets',
            details: { agentPreset, available: [] },
          })
        }
        const found = await agentFor(sessionId)
        if ('error' in found) return err(request, found.error)
        const { agent } = found
        const swap = async (): Promise<RpcResponse<{ agentPreset: string }>> => {
          // Re-read inside the queue: an earlier switch may have run, and a
          // conversation may have started, since this request arrived.
          if (!sessionBlank(agent.session)) {
            return err(request, {
              code: 'agent-preset-locked',
              message: `session "${sessionId}" has already started; its agent preset is fixed`,
              details: { sessionId, agentPreset },
            })
          }
          try {
            const preset = await presets.recompose(agent.ctx, agentPreset)
            // Recorded only after the swap committed: the log states what the
            // agent runs, and a rejected mount leaves the previous composition.
            agent.session.append('agent-preset/selected', { agentPreset: preset.id })
            return ok(request, { agentPreset: preset.id })
          } catch (error: unknown) {
            const refused = presetFailure(request, error)
            if (refused !== undefined) return refused
            return err(request, {
              code: 'internal',
              message: `failed to select agent preset "${agentPreset}": ${String(error)}`,
              details: {},
            })
          }
        }
        const queued = presetSwitches.get(sessionId) ?? Promise.resolve()
        const turn = queued.then(swap)
        presetSwitches.set(sessionId, turn.catch(() => undefined))
        try {
          return await turn
        } finally {
          if (presetSwitches.get(sessionId) === turn) presetSwitches.delete(sessionId)
        }
      },

      // Authoring is privileged (see PRIVILEGED_METHODS in clocky-client-connection):
      // a composition names the plugins a session runs, so reading one is
      // reconnaissance, and copy/remove/openDocument manage the roster and
      // drive the host desktop.
      async read(request) {
        const { agentPreset } = request.payload
        const presets = ctx.get('agentPresets')
        if (presets === undefined) return err(request, noRoster(agentPreset))
        try {
          const preset = await presets.resolve(agentPreset)
          return ok(request, {
            agentPreset: preset.id,
            trust: preset.trust,
            content: await presets.read(preset.id),
            ...preset.name === undefined ? {} : { name: preset.name },
            ...preset.description === undefined ? {} : { description: preset.description },
          })
        } catch (error: unknown) {
          return err(request, presetError(agentPreset, error))
        }
      },

      async copy(request) {
        const { from, agentPreset, name } = request.payload
        const presets = ctx.get('agentPresets')
        if (presets === undefined) return err(request, noRoster(agentPreset))
        try {
          await presets.copy(from, agentPreset, name)
          return ok(request, { agentPreset })
        } catch (error: unknown) {
          return err(request, presetError(agentPreset, error))
        }
      },

      async openDocument(request, signal) {
        const { agentPreset } = request.payload
        const presets = ctx.get('agentPresets')
        if (presets === undefined) return err(request, noRoster(agentPreset))
        try {
          const preset = await presets.resolve(agentPreset)
          // Same line as copy/remove draw: the shipped install is not the
          // user's to manage, and pointing an editor into it invites edits an
          // upgrade will silently overwrite.
          if (preset.trust !== 'user') {
            throw new PresetNotWritableError(preset.id, 'it ships with the deployment')
          }
          // The id resolved against the Host's own roots is what selects the
          // directory — no browser payload carries a path in either direction
          // unless the deployment has no opener to hand it to.
          const directory = dirname(preset.path)
          if (!canOpenPaths()) return ok(request, { opened: false as const, path: directory })
          return await openPath(request, directory, signal)
        } catch (error: unknown) {
          return err(request, presetError(agentPreset, error))
        }
      },

      async remove(request) {
        const { agentPreset } = request.payload
        const presets = ctx.get('agentPresets')
        if (presets === undefined) return err(request, noRoster(agentPreset))
        try {
          await presets.remove(agentPreset)
          return ok(request, {})
        } catch (error: unknown) {
          return err(request, presetError(agentPreset, error))
        }
      },
    },

    skills: {
      // Skill lookup never creates or resumes an agent. A live Agent supplies
      // its current execution root; a cold Session uses its recorded cwd.
      async list(request) {
        const { sessionId } = request.payload
        const session = ctx.sessions.get(sessionId)
        if (session === undefined) {
          return err(request, {
            code: 'session-not-found',
            message: `session "${sessionId}" not found (not attached)`,
            details: { sessionId },
          })
        }
        // The host registry is layered per scope and serves every session. A
        // composition may still realm-mount its own registry instead; that
        // instance is invisible to host contexts, so address it through the
        // live agent (`agents.get` keeps the no-side-effect stance above).
        const live = ctx.agents.get(sessionId)
        const presets = ctx.get('agentPresets')
        const scoped = live === undefined ? undefined : presets?.serviceFor(live, 'skills')
        // Same stance as the commands domain: a missing service means no
        // composition mounts clocky-skill, not an empty catalog. `ctx.get` also
        // keeps this handler independent of the gateway plugin's inject list
        // (an undeclared `ctx.skills` property read fails the reflect proxy).
        const skillRegistry = scoped ?? ctx.get('skills')
        if (skillRegistry === undefined) {
          return err(request, { code: 'internal', message: 'skill registry is absent: neither this session\'s agent preset nor the host composition mounts @clocky/clocky-skill', details: {} })
        }
        // The scope presenters resolve in — the live agent, else the recorded
        // preset's standing key, else the global layer — so a cold session's
        // '/' popup lists the catalog its composition actually serves.
        try {
          const cwd = live === undefined ? session.header.cwd : resolveAgentWorkspaceRoot(live)
          if (cwd === undefined) {
            // A cold cwd-less log is pre-project, while a live Agent has
            // already had its allocation root considered above.
            return err(request, { code: 'internal', message: `session "${sessionId}" has no project cwd`, details: {} })
          }
          const scope = await presenterScopeFor(sessionId, session)
          const skills = (await skillRegistry.list({ cwd, scope })).filter(isUserInvocable)
          return ok(request, {
            skills: skills.map(skill => ({
              name: skill.name,
              description: skill.description,
              ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
              modelInvocable: skill.invocation.modelInvocable,
            })),
          })
        } catch (error: unknown) {
          return err(request, { code: 'internal', message: `skill listing failed: ${String(error)}`, details: {} })
        }
      },
    },

    settings: {
      describe(request) {
        const settings = ctx.get('settings')
        if (settings === undefined) return Promise.resolve(err(request, settingsAbsent()))
        return Promise.resolve(ok(request, {
          writable: settings.writable,
          hasDocument: settings.documentPath !== undefined,
          namespaces: settings.describe({ redactSecrets: true }).map(namespaceView),
        }))
      },
      async openDocument(request, signal) {
        const settings = ctx.get('settings')
        if (settings === undefined) return err(request, settingsAbsent())
        if (isAborted(signal)) {
          return err(request, {
            code: 'cancelled',
            message: 'settings document open was aborted',
            details: {},
          })
        }
        let path: string | undefined
        try {
          path = await settings.prepareDocument()
        } catch (error: unknown) {
          if (isAborted(signal)) {
            return err(request, {
              code: 'cancelled',
              message: 'settings document preparation was aborted',
              details: {},
            })
          }
          return err(request, {
            code: 'internal',
            message: `settings document preparation failed: ${error instanceof Error ? error.message : String(error)}`,
            details: {},
          })
        }
        if (path === undefined) {
          return err(request, {
            code: 'internal',
            message: 'settings provider has no local document to open',
            details: {},
          })
        }
        if (isAborted(signal)) {
          return err(request, {
            code: 'cancelled',
            message: 'settings document open was aborted',
            details: {},
          })
        }
        return openTextFile(request, path, signal)
      },
      update: request => settingsWrite(request, request.payload.ns, 'update', request.payload.patch, request.payload.expectedRevision),
      replace: request => settingsWrite(request, request.payload.ns, 'replace', request.payload.section, request.payload.expectedRevision),
      mutate: request => settingsWrite(request, request.payload.ns, 'mutate', request.payload.ops, request.payload.expectedRevision),
    },

    credentials: {
      async describe(request) {
        const credentials = ctx.get('credentials')
        if (credentials === undefined) return err(request, credentialsAbsent())
        const entries = await Promise.all(request.payload.refs.map(async (ref) => {
          const info = await credentials.describe(credentialRef(ref))
          const view: CredentialView = {
            configured: info.configured,
            ...info.source === undefined ? {} : { source: info.source },
            writable: info.writable,
          }
          return [ref, view] as const
        }))
        return ok(request, { credentials: Object.fromEntries(entries) })
      },

      async set(request) {
        const credentials = ctx.get('credentials')
        if (credentials === undefined) return err(request, credentialsAbsent())
        const { ref, value } = request.payload
        try {
          await credentials.set(credentialRef(ref), value)
        } catch (error: unknown) {
          return err(request, {
            code: 'credential-rejected',
            message: error instanceof Error ? error.message : String(error),
            details: { ref },
          })
        }
        return ok(request, {})
      },

      async unset(request) {
        const credentials = ctx.get('credentials')
        if (credentials === undefined) return err(request, credentialsAbsent())
        const { ref } = request.payload
        try {
          await credentials.unset(credentialRef(ref))
        } catch (error: unknown) {
          return err(request, {
            code: 'credential-rejected',
            message: error instanceof Error ? error.message : String(error),
            details: { ref },
          })
        }
        return ok(request, {})
      },
    },

    llm: {
      providers(request) {
        const registered = ctx.llm.listProviders()
        const active = new Set(registered.map(provider => provider.id))
        const directory = ctx.llm.listConfigurableProviders()
        const declared = new Set(directory.map(entry => entry.provider))
        const views: ConfigurableProviderView[] = directory.map(entry => ({
          provider: entry.provider,
          displayName: entry.displayName,
          settingsNs: entry.settingsNs,
          settingsPath: [...entry.settingsPath],
          active: active.has(entry.provider),
          ...entry.declared === undefined ? {} : { declared: entry.declared },
        }))
        // Routes registered without a directory declaration still appear —
        // they exist and serve models — just with no settings address. No
        // adapter claimed them, so nothing can say whether they are shipped.
        for (const provider of registered) {
          if (declared.has(provider.id)) continue
          views.push({
            provider: provider.id,
            displayName: provider.name,
            settingsNs: '',
            settingsPath: [],
            active: true,
          })
        }
        return Promise.resolve(ok(request, { providers: views }))
      },

      async models(request) {
        return ok(request, await buildModelCatalog(ctx))
      },

      async discoverModels(request, signal) {
        const { settingsNs, provider, baseURL, api, apiKey } = request.payload
        try {
          const models = await ctx.llm.discoverModels(settingsNs, {
            ...provider === undefined ? {} : { provider },
            ...baseURL === undefined ? {} : { baseURL },
            ...api === undefined ? {} : { api },
            ...apiKey === undefined ? {} : { apiKey },
            ...signal === undefined ? {} : { signal },
          })
          return ok(request, { models })
        } catch (error: unknown) {
          // Every failure here is the user's next move, not a transport fault:
          // a wrong endpoint, a rejected key, or a protocol with no listing all
          // end at the same place — fill the models in by hand. The details
          // repeat only what the caller already sent, never the credential.
          return err(request, {
            code: 'model-discovery-failed',
            message: error instanceof Error ? error.message : String(error),
            details: { settingsNs, ...baseURL === undefined ? {} : { baseURL } },
          })
        }
      },
    },

    events: {
      mux(_request, signal) {
        const queue = new FrameQueue<RpcRequest<MuxFrame>>()
        muxQueues.add(queue)
        for (const session of ctx.sessions.list()) {
          subscribeSession(queue, session)
        }
        for (const pending of pendingQuestions.values()) {
          queue.push({
            rpcId: pending.rpcId,
            payload: {
              type: 'question/requested', sessionId: pending.sessionId,
              questions: pending.questions,
              ...pending.teamId === undefined ? {} : { teamId: pending.teamId },
              ...pending.participantId === undefined ? {} : { participantId: pending.participantId },
              ...pending.taskId === undefined ? {} : { taskId: pending.taskId },
            },
          })
        }
        // Refresh recovery: still-pending approval questions replay with their
        // stable rpcId so a reconnecting client can still answer them.
        for (const pending of pendingApprovals.values()) queue.push(requestedFrame(pending))
        // Queue snapshot baseline (pendingQuestions precedent): frames replayed
        // in arrival order per session; a reconnecting client rebuilds its
        // queue view from these alone.
        for (const session of ctx.sessions.list()) {
          const agent = ctx.agents.get(session.id)
          if (agent?.session === session && agent.inbox.hasPending) {
            queue.push(frame({ type: 'session/queue', sessionId: session.id, items: queueItems(agent) }))
          }
        }
        // Background-task baseline. `ctx.agents.get` is the non-resuming read:
        // a session with no live Agent owns no tasks, so it correctly sees only
        // the unowned ones, and listing never revives a cold session. An empty
        // set sends nothing — absence is how the client reads "no tasks".
        const jobs = ctx.get('jobs')
        if (jobs !== undefined) {
          for (const session of ctx.sessions.list()) {
            const views = jobViews(jobs.list(ctx.agents.get(session.id)))
            if (views.length > 0) {
              queue.push(frame({ type: 'session/jobs', sessionId: session.id, jobs: views }))
            }
          }
        }
        // Per-session open-call table for result-view pairing. Bounded by the
        // per-turn call count: entries clear on turn/end; a table miss (stream
        // opened mid-turn) backscans the session's in-memory events instead.
        const openCalls = new Map<SessionId, Map<string, { name: string; args: unknown }>>()
        const disposers = [
          ctx.on('session/event', (session: Session, event: SessionEvent) => {
            if (event.type === 'tool/call') {
              const data = event.data as ToolCallData
              try {
                let table = openCalls.get(session.id)
                if (table === undefined) openCalls.set(session.id, table = new Map<string, { name: string; args: unknown }>())
                table.set(data.callId, { name: data.name, args: JSON.parse(data.arguments) })
              } catch {
                // Unparseable model arguments: leave the table unset; the result view soft-falls.
              }
            } else if (event.type === 'turn/end') {
              openCalls.delete(session.id)
            }
            const view = viewFor(
              ctx, event,
              callId => openCalls.get(session.id)?.get(callId) ?? backscanArgs(session.events, callId),
              ctx.agents.get(session.id),
            )
            queue.push(frame({ type: 'session/event', sessionId: session.id, event, ...view === undefined ? {} : { view } }))
          }),
          ctx.on('session/created', (session: Session) => {
            subscribeSession(queue, session)
            // The subscribe frame clears the client's task mirror, and a
            // session born after the stream opened missed the baseline loop.
            // Unowned tasks are visible to it from birth, so without this it
            // would show none until the next registry change.
            const views = jobs === undefined ? [] : jobViews(jobs.list(ctx.agents.get(session.id)))
            if (views.length > 0) {
              queue.push(frame({ type: 'session/jobs', sessionId: session.id, jobs: views }))
            }
          }),
          ctx.on('session/disposed', (session: Session) => {
            openCalls.delete(session.id)
          }),
          ...jobs === undefined ? [] : [jobs.onJobsChanged((owner) => {
            if (owner !== undefined) {
              // The exact owner instance the fence compares against, so the
              // push stays correct even while that Agent's scope is tearing
              // down and a lookup by id would already miss.
              queue.push(frame({ type: 'session/jobs', sessionId: owner.id, jobs: jobViews(jobs.list(owner)) }))
              return
            }
            // An unowned task is visible to every caller, so every subscribed
            // session's set changed with it.
            for (const session of ctx.sessions.list()) {
              queue.push(frame({
                type: 'session/jobs',
                sessionId: session.id,
                jobs: jobViews(jobs.list(ctx.agents.get(session.id))),
              }))
            }
          })],
        ]
        return queue.iterate(signal, () => {
          muxQueues.delete(queue)
          for (const dispose of disposers) dispose()
        })
      },

      host(_request, signal) {
        const queue = new FrameQueue<RpcRequest<HostFrame>>()
        const committedWorkspaces = ctx.workspaceRegistry.list()
        const committedWorkspaceIds = new Set(
          committedWorkspaces.map(workspace => String(workspace.id)),
        )
        let committedWorkspaceOrder = committedWorkspaces.map(workspace => workspace.id)
        // Frame-dedup baseline, same posture as committedWorkspaceIds: the
        // stream opens against the current set; workspace.list re-baselines
        // reconnecting clients, so only later changes need frames.
        let archivedSessionIds = ctx.workspaceRegistry.archivedSessionIds
        const disposers = [
          ctx.on('session/created', (session: Session) => {
            queue.push(frame({
              type: 'host/session-added',
              sessionId: session.id,
              // Derived at frame time like summarize(); a just-created session
              // has run no turn yet, so this is constantly true in practice.
              blank: sessionBlank(session),
              // Including cwd lets the client group the new session without refreshing the list.
              ...sessionListFields(session.header, session.events),
            }))
          }),
          ctx.on('session/disposed', (session: Session) => {
            queue.push(frame({ type: 'host/session-removed', sessionId: session.id }))
          }),
          ctx.on('agent/status', ({ agent, status }: { agent: Agent; status: AgentStatus }) => {
            queue.push(frame({ type: 'host/session-status', sessionId: agent.id, running: status === 'running' }))
          }),
          ctx.on('agent/error', ({ agent, error }: { agent: Agent; error: unknown }) => {
            queue.push(frame({ type: 'host/agent-error', sessionId: agent.id, message: errorChain(error) }))
          }),
          ctx.on('domain/changed', (change) => {
            if (change.domain !== 'workspace') return
            if (change.table === '') {
              if (change.operation !== 'put') return
              const state = workspaceDomainState.parse(change.value)
              const orderChanged = state.workspaceIds.length === committedWorkspaceOrder.length
                && state.workspaceIds.every(workspaceId => committedWorkspaceIds.has(String(workspaceId)))
                && state.workspaceIds.some((workspaceId, index) => workspaceId !== committedWorkspaceOrder[index])
              for (const workspaceId of state.workspaceIds) {
                if (committedWorkspaceIds.has(workspaceId)) continue
                const workspace = ctx.workspaceRegistry.get(workspaceId)
                if (workspace === undefined) {
                  throw new Error(`committed workspace registry references missing workspace "${workspaceId}"`)
                }
                committedWorkspaceIds.add(workspaceId)
                queue.push(frame({ type: 'host/workspace-changed', workspace: workspaceView(workspace) }))
              }
              committedWorkspaceOrder = [...state.workspaceIds]
              if (orderChanged) {
                queue.push(frame({
                  type: 'host/workspace-order-changed',
                  workspaceIds: [...state.workspaceIds],
                }))
              }
              if (state.archivedSessionIds.length !== archivedSessionIds.length
                || state.archivedSessionIds.some((id, index) => id !== archivedSessionIds[index])) {
                archivedSessionIds = state.archivedSessionIds
                queue.push(frame({
                  type: 'host/archived-sessions-changed',
                  archivedSessionIds: [...state.archivedSessionIds],
                }))
              }
              return
            }
            if (change.table !== 'workspaces') return
            if (change.operation === 'deleted') {
              if (!committedWorkspaceIds.delete(change.key)) return
              queue.push(frame({
                type: 'host/workspace-removed',
                workspaceId: change.key as WorkspaceId,
              }))
              return
            }
            if (!committedWorkspaceIds.has(change.key)) return
            // Existing-entity table writes are complete attach/touch commits.
            // A new entity's first put waits for the global registry write above.
            queue.push(frame({
              type: 'host/workspace-changed',
              workspace: changedWorkspaceView(change.key, change.value),
            }))
          }),
          // Allowlisted host events ride one verbatim wrapper frame each. The
          // allowlist is api-remotes', and `ctx.remote.$on` is the consumer
          // face; nothing here projects, redacts, or renames.
          ...API_REMOTE_FORWARDED_EVENTS.map(name => ctx.on(
            name,
            // The allowlist's shape assertion proves each name is a real,
            // non-scoped, void-returning event, so the rest-parameter handler
            // satisfies every member of the union `on` accepts here;
            // assertJsonArgs proves the payload is JSON-safe before it queues.
            ((...args: unknown[]) => {
              queue.push(frame({
                type: 'host/remote-event',
                event: name,
                args: assertJsonArgs(name, args),
              }))
            }),
          )),
        ]
        return queue.iterate(signal, () => { for (const dispose of disposers) dispose() })
      },
    },

    downloads: {
      async sessionLog(request, signal) {
        // Clean error path first: missing services answer 500 and a missing
        // root artifact 404 before any zip byte is produced. The root content
        // read here is reused as the first zip entry, so nothing is read twice.
        const deps = sessionLogExportDeps(ctx)
        if (deps.sessionQuery === undefined || deps.sessionPersistence === undefined || deps.attachments === undefined) {
          return new Response(
            'session log export is unavailable: missing session-query, session-persistence, or attachments service',
            { status: 500 },
          )
        }
        if (!deps.sessionPersistence.supportsRawArtifacts) {
          return new Response(
            'session log export is unavailable: the persistence backend does not expose per-session raw artifacts',
            { status: 501 },
          )
        }
        const ready: SessionLogExportReady = {
          sessionQuery: deps.sessionQuery,
          sessionPersistence: deps.sessionPersistence,
          attachments: deps.attachments,
          sessions: deps.sessions,
        }
        let root: SessionRawArtifact | undefined
        try {
          await flushLiveSessionLog(deps, request.sessionId, signal)
          root = await deps.sessionPersistence.readRaw(request.sessionId, signal)
          signal.throwIfAborted()
        } catch {
          signal.throwIfAborted()
          // Root preparation failure: answer 500 without echoing the error,
          // which may carry absolute host paths into the browser error bar.
          return new Response('session log export failed to prepare the stored artifact', { status: 500 })
        }
        if (root === undefined) {
          return new Response('session not found', { status: 404 })
        }
        return new Response(
          streamSessionLogZip(
            ready,
            root,
            request.sessionId,
            request.includeDescendants === true,
            sessionExportCompressionLevel,
            signal,
          ),
          {
            headers: {
              'content-type': 'application/zip',
              'content-disposition': `attachment; filename="${sessionLogZipFilename(request.sessionId)}"`,
            },
          },
        )
      },
    },

    async respond(message: ClientResponse): Promise<RpcReceipt> {
      // Route by the echoed rpcId (the wire correlation): approvals first,
      // then questions — the two registries share one id space of UUIDs.
      const approval = pendingApprovals.get(message.rpcId)
      if (approval !== undefined) {
        if (approval.answerClaimed === true) return { accepted: false, reason: 'not-pending' }
        if (approval.teamId !== undefined && !await canResolveTeamHumanAction(approval.teamId, approval.participantId)) {
          return { accepted: false, reason: 'not-pending' }
        }
        if (pendingApprovals.get(message.rpcId) !== approval) return { accepted: false, reason: 'not-pending' }
        if (!message.result.ok) return { accepted: false, reason: 'bad-response' }
        const parsed = approvalResponsePayloadSchema.safeParse(message.result.value)
        // The payload's audit correlation must match the entry the rpcId routed
        // to — a mismatched answer is malformed, not merely late.
        if (!parsed.success || parsed.data.approvalId !== approval.approvalId || parsed.data.sessionId !== approval.sessionId) {
          return { accepted: false, reason: 'bad-response' }
        }
        approval.resolve(parsed.data.outcome)
        return { accepted: true }
      }
      const pending = pendingQuestions.get(message.rpcId)
      if (pending === undefined || pending.answerClaimed === true) return { accepted: false, reason: 'not-pending' }
      if (pending.teamId !== undefined && !await canResolveTeamHumanAction(pending.teamId, pending.participantId)) {
        return { accepted: false, reason: 'not-pending' }
      }
      if (pendingQuestions.get(message.rpcId) !== pending) return { accepted: false, reason: 'not-pending' }
      if (!message.result.ok) {
        if (message.result.error.code !== 'cancelled') {
          return { accepted: false, reason: 'bad-response' }
        }
        claimQuestion(pending, 'cancelled')
        pending.reject(new UserQuestionError(
          'the user cancelled ask_user_question', 'ASK_CANCELLED'))
        return { accepted: true }
      }
      const parsed = questionResponsePayloadSchema.safeParse(message.result.value)
      if (!parsed.success) {
        return { accepted: false, reason: 'bad-response' }
      }
      const payload: QuestionResponsePayload = {
        sessionId: parsed.data.sessionId,
        answer: {
          answers: parsed.data.answer.answers.map(answer => ({
            id: answer.id,
            selected: answer.selected,
            ...(answer.custom === undefined ? {} : { custom: answer.custom }),
          })),
        },
      }
      if (!matchesQuestions(payload, pending)) {
        return { accepted: false, reason: 'bad-response' }
      }
      claimQuestion(pending, 'answered', payload.answer)
      pending.resolve(payload.answer)
      return { accepted: true }
    },
  }

}
