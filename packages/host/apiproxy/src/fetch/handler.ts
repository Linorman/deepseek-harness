import { teamMemberInspectInputSchema } from '../api/teams.schema.ts'
import { teamWorkflowInspectRequestSchema } from '@clocky/clocky-team/schema'
import { teamHumanActionReadRequestSchema } from '@clocky/clocky-team/schema'
import { teamSelectionRequestSchema } from '@clocky/clocky-team/schema'
import { teamTaskInspectRequestSchema } from '../api/teams.schema.ts'
import { teamBrowseInputSchema } from '../api/teams.schema.ts'
import { teamMemberSessionRequestSchema } from '../api/teams.schema.ts'
import { teamHumanActionResponseInputSchema } from '../api/teams.schema.ts'
import { teamHumanInboxReadInputSchema, teamHumanInboxAcknowledgeInputSchema } from '../api/teams.schema.ts'
/**
 * Server side of the fetch carrier: maps an ApiProxy onto a pure
 * WHATWG Request->Response function. Two-level parse: full form (type/rpcId/method +
 * path==method) -> payload dispatched per method. HTTP status expresses only the carrier
 * (404 unknown path / 415 non-JSON media type / 400 non-JSON body / 500 handler crash);
 * business errors are always 200 + ServerResponse.
 */

import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { ApiProxy, MuxFrame, HostFrame } from '../api/index.ts'
import { sessionLogQuerySchema } from '../api/downloads.schema.ts'
import type { RequestPayload, ResponseValue, RpcMethodMap } from '../api/rpc-map.ts'
import type { ClientRequest, RpcError, RpcRequest, RpcResponse, ServerRequest, ServerResponse } from '../api/rpc.ts'
import { RpcId } from '../api/rpc.ts'
import type { Wire } from '../api/rpc.schema.ts'
import { clientRequestSchema, clientResponseSchema } from '../api/rpc.schema.ts'
import { withAuthenticatedProductCall } from '../authenticated-product-call.ts'
import {
  sessionCancelRequestSchema,
  sessionAttachmentRequestSchema,
  sessionHistoryRequestSchema,
  sessionListRequestSchema,
  sessionModelsRequestSchema,
  sessionPromptRequestSchema,
  sessionRenameRequestSchema,
  sessionSearchRequestSchema,
  sessionSelectModelRequestSchema,
  sessionUpdateQueueRequestSchema,
} from '../api/sessions.schema.ts'
import {
  hostCreateDirectoryRequestSchema, hostDescribeRequestSchema,
  hostListDirectoryRequestSchema, hostOpenPathRequestSchema,
  hostPickDirectoryRequestSchema,
} from '../api/host.schema.ts'
import {
  workspaceArchiveSessionRequestSchema,
  workspaceCreateRequestSchema,
  workspaceDeleteRequestSchema,
  workspaceInsertBeforeRequestSchema,
  workspaceInsertSessionBeforeRequestSchema,
  workspaceListRequestSchema,
  workspaceRenameRequestSchema,
} from '../api/workspace.schema.ts'
import { skillListRequestSchema } from '../api/skills.schema.ts'
import {
  agentPresetCopyRequestSchema, agentPresetListRequestSchema, agentPresetOpenDocumentRequestSchema,
  agentPresetReadRequestSchema, agentPresetRemoveRequestSchema, agentPresetSelectRequestSchema,
} from '../api/agent-presets.schema.ts'
import {
  settingsDescribeRequestSchema, settingsMutateRequestSchema, settingsOpenDocumentRequestSchema,
  settingsReplaceRequestSchema, settingsUpdateRequestSchema,
} from '../api/settings.schema.ts'
import {
  credentialsDescribeRequestSchema, credentialsSetRequestSchema, credentialsUnsetRequestSchema,
} from '../api/credentials.schema.ts'
import { llmDiscoverModelsRequestSchema, llmModelsRequestSchema, llmProvidersRequestSchema } from '../api/llm.schema.ts'
import {
  teamArchiveRequestSchema, teamArtifactListRequestSchema, teamArtifactReadRequestSchema,
  teamAuditReadRequestSchema, teamCancelRequestSchema,
  teamGoalTransitionRequestSchema, teamGoalUpdateRequestSchema,
  teamMetricsRequestSchema,
  teamChannelCloseRequestSchema,
  teamChannelOpenRequestSchema,
  teamChannelInputRequestSchema,
  teamChannelAttachmentRequestSchema,
  teamChannelListRequestSchema,
  teamChannelCatalogRequestSchema,
  teamChannelAdmissionRequestSchema,
  teamChannelInvitationRequestSchema,
  teamChannelInvitationAcknowledgeRequestSchema,
  teamChannelPostRequestSchema,
  teamChannelSummarizeRequestSchema,
  teamChannelReadRequestSchema,
  teamChannelWatchRequestSchema,
  teamCreateRequestSchema,
  teamGetRequestSchema,
  teamListRequestSchema,
  teamMemberInterruptRequestSchema,
  teamMemberActivateRequestSchema,
  teamMemberInviteRequestSchema,
  teamMemberListRequestSchema,
  teamMemberRemoveRequestSchema,
  teamPostInputRequestSchema,
  teamResumeRequestSchema,
  teamQuiescenceRequestSchema,
  teamStartRequestSchema,
  teamTaskCreateRequestSchema,
  teamTaskCancelRequestSchema,
  teamTaskDeleteRequestSchema,
  teamTaskReviewRequestSchema,
  teamTaskGetRequestSchema,
  teamTaskListRequestSchema,
  teamTaskUpdateRequestSchema,
  teamTaskWatchRequestSchema,
  teamWorkflowPlanListRequestSchema,
  teamWaitFinalRequestSchema,
} from '../api/teams.schema.ts'

/**
 * Unary dispatch table, keyed by (and compiler-locked to) RpcMethodMap: a map row without a
 * route row fails to compile, and each row's schema/invoke pair is checked against that row's
 * payload type — a schema pasted onto the wrong row is a type error, not a runtime surprise.
 * Schemas anchor to the Wire<> widening (the repo-wide exactOptionalPropertyTypes accommodation
 * documented on Wire); the dispatch point carries the one Wire→exact cast.
 * Every invoke receives the carrier Request's signal; routes whose contract
 * declares a signal parameter forward it, and the rest ignore it.
 */
type UnaryRoutes = {
  [K in keyof RpcMethodMap]: {
    schema: z.ZodType<Wire<RequestPayload<K>>>
    invoke(api: ApiProxy, request: RpcRequest<RequestPayload<K>>, signal: AbortSignal): Promise<RpcResponse<ResponseValue<K>>>
  }
}

const UNARY_ROUTES: UnaryRoutes = {
  'session.list': { schema: sessionListRequestSchema, invoke: (api, r) => api.sessions.list(r) },
  'session.search': { schema: sessionSearchRequestSchema, invoke: (api, r, signal) => api.sessions.search(r, signal) },
  'session.history': { schema: sessionHistoryRequestSchema, invoke: (api, r) => api.sessions.history(r) },
  'session.models': { schema: sessionModelsRequestSchema, invoke: (api, r) => api.sessions.models(r) },
  'session.selectModel': { schema: sessionSelectModelRequestSchema, invoke: (api, r) => api.sessions.selectModel(r) },
  'session.rename': { schema: sessionRenameRequestSchema, invoke: (api, r) => api.sessions.rename(r) },
  'session.prompt': { schema: sessionPromptRequestSchema, invoke: (api, r) => api.sessions.prompt(r) },
  'session.attachment': { schema: sessionAttachmentRequestSchema, invoke: (api, r) => api.sessions.attachment(r) },
  'session.updateQueue': { schema: sessionUpdateQueueRequestSchema, invoke: (api, r) => api.sessions.updateQueue(r) },
  'session.cancel': { schema: sessionCancelRequestSchema, invoke: (api, r) => api.sessions.cancel(r) },
  'team.list': { schema: teamListRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.list'>(api, r, team => team.list(r)) },
  'team.workflow.plan.inspect': { schema: teamWorkflowInspectRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.workflow.plan.inspect'>(api, r, team => team.workflowPlanInspect(r)) },
  'team.action.read': { schema: teamHumanActionReadRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.action.read'>(api, r, team => team.actionRead(r)) },
  'team.selection': { schema: teamSelectionRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.selection'>(api, r, team => team.selection(r)) },
  'team.member.inspect': { schema: teamMemberInspectInputSchema, invoke: (api, r) => unavailableTeamApi<'team.member.inspect'>(api, r, team => team.memberInspect(r)) },
  'team.member.session': { schema: teamMemberSessionRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.member.session'>(api, r, team => team.memberSession(r)) },
  'team.task.inspect': { schema: teamTaskInspectRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.task.inspect'>(api, r, team => team.taskInspect(r)) },
  'team.browse': { schema: teamBrowseInputSchema, invoke: (api, r) => unavailableTeamApi<'team.browse'>(api, r, team => team.browse(r)) },
  'team.get': { schema: teamGetRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.get'>(api, r, team => team.get(r)) },
  'team.create': { schema: teamCreateRequestSchema, invoke: (api, r, signal) => unavailableTeamApi<'team.create'>(api, r, team => team.create(r, signal)) },
  'team.resume': { schema: teamResumeRequestSchema, invoke: (api, r, signal) => unavailableTeamApi<'team.resume'>(api, r, team => team.resume(r, signal)) },
  'team.start': { schema: teamStartRequestSchema, invoke: (api, r, signal) => unavailableTeamApi<'team.start'>(api, r, team => team.start(r, signal)) },
  'team.postInput': { schema: teamPostInputRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.postInput'>(api, r, team => team.postInput(r)) },
  'team.waitFinal': { schema: teamWaitFinalRequestSchema, invoke: (api, r, signal) => unavailableTeamApi<'team.waitFinal'>(api, r, team => team.waitFinal(r, signal)) },
  'team.cancel': { schema: teamCancelRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.cancel'>(api, r, team => team.cancel(r)) },
  'team.archive': { schema: teamArchiveRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.archive'>(api, r, team => team.archive(r)) },
  'team.goal.update': { schema: teamGoalUpdateRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.goal.update'>(api, r, team => team.goalUpdate(r)) },
  'team.goal.transition': { schema: teamGoalTransitionRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.goal.transition'>(api, r, team => team.goalTransition(r)) },
  'team.quiescence': { schema: teamQuiescenceRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.quiescence'>(api, r, team => team.quiescence(r)) },
  'team.inbox.respond': { schema: teamHumanActionResponseInputSchema, invoke: (api, r) => unavailableTeamApi<'team.inbox.respond'>(api, r, team => team.inboxRespond(r)) },
  'team.inbox.read': { schema: teamHumanInboxReadInputSchema, invoke: (api, r) => unavailableTeamApi<'team.inbox.read'>(api, r, team => team.inboxRead(r)) },
  'team.inbox.watch': { schema: teamHumanInboxReadInputSchema, invoke: (api, r) => unavailableTeamApi<'team.inbox.watch'>(api, r, team => team.inboxWatch(r)) },
  'team.inbox.acknowledge': { schema: teamHumanInboxAcknowledgeInputSchema, invoke: (api, r) => unavailableTeamApi<'team.inbox.acknowledge'>(api, r, team => team.inboxAcknowledge(r)) },
  'team.metrics': { schema: teamMetricsRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.metrics'>(api, r, team => team.metrics(r)) },
  'team.audit.read': { schema: teamAuditReadRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.audit.read'>(api, r, team => team.auditRead(r)) },
  'team.artifact.read': { schema: teamArtifactReadRequestSchema, invoke: (api, r, signal) => unavailableTeamApi<'team.artifact.read'>(api, r, team => team.artifactRead(r, signal)) },
  'team.artifact.list': { schema: teamArtifactListRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.artifact.list'>(api, r, team => team.artifactList(r)) },
  'team.member.list': { schema: teamMemberListRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.member.list'>(api, r, team => team.memberList(r)) },
  'team.member.invite': { schema: teamMemberInviteRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.member.invite'>(api, r, team => team.memberInvite(r)) },
  'team.member.activate': { schema: teamMemberActivateRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.member.activate'>(api, r, team => team.memberActivate(r)) },
  'team.member.remove': { schema: teamMemberRemoveRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.member.remove'>(api, r, team => team.memberRemove(r)) },
  'team.member.interrupt': { schema: teamMemberInterruptRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.member.interrupt'>(api, r, team => team.memberInterrupt(r)) },
  'team.channel.input': { schema: teamChannelInputRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.input'>(api, r, team => team.channelInput(r)) },
  'team.channel.attachment': { schema: teamChannelAttachmentRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.attachment'>(api, r, team => team.channelAttachment(r)) },
  'team.channel.catalog': { schema: teamChannelCatalogRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.catalog'>(api, r, team => team.channelCatalog(r)) },
  'team.channel.list': { schema: teamChannelListRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.list'>(api, r, team => team.channelList(r)) },
  'team.channel.admission': { schema: teamChannelAdmissionRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.admission'>(api, r, team => team.channelAdmission(r)) },
  'team.channel.invitation': { schema: teamChannelInvitationRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.invitation'>(api, r, team => team.channelInvitation(r)) },
  'team.channel.invitation.acknowledge': { schema: teamChannelInvitationAcknowledgeRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.invitation.acknowledge'>(api, r, team => team.channelInvitationAcknowledge(r)) },
  'team.channel.open': { schema: teamChannelOpenRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.open'>(api, r, team => team.channelOpen(r)) },
  'team.channel.post': { schema: teamChannelPostRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.post'>(api, r, team => team.channelPost(r)) },
  'team.channel.read': { schema: teamChannelReadRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.read'>(api, r, team => team.channelRead(r)) },
  'team.channel.summarize': { schema: teamChannelSummarizeRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.summarize'>(api, r, team => team.channelSummarize(r)) },
  'team.channel.close': { schema: teamChannelCloseRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.channel.close'>(api, r, team => team.channelClose(r)) },
  'team.channel.watch': { schema: teamChannelWatchRequestSchema, invoke: (api, r, signal) => unavailableTeamApi<'team.channel.watch'>(api, r, team => team.channelWatch(r, signal)) },
  'team.task.create': { schema: teamTaskCreateRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.task.create'>(api, r, team => team.taskCreate(r)) },
  'team.task.cancel': { schema: teamTaskCancelRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.task.cancel'>(api, r, team => team.taskCancel(r)) },
  'team.task.delete': { schema: teamTaskDeleteRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.task.delete'>(api, r, team => team.taskDelete(r)) },
  'team.task.review': { schema: teamTaskReviewRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.task.review'>(api, r, team => team.taskReview(r)) },
  'team.task.get': { schema: teamTaskGetRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.task.get'>(api, r, team => team.taskGet(r)) },
  'team.task.list': { schema: teamTaskListRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.task.list'>(api, r, team => team.taskList(r)) },
  'team.workflow.plan.list': { schema: teamWorkflowPlanListRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.workflow.plan.list'>(api, r, team => team.workflowPlanList(r)) },
  'team.task.update': { schema: teamTaskUpdateRequestSchema, invoke: (api, r) => unavailableTeamApi<'team.task.update'>(api, r, team => team.taskUpdate(r)) },
  'team.task.watch': { schema: teamTaskWatchRequestSchema, invoke: (api, r, signal) => unavailableTeamApi<'team.task.watch'>(api, r, team => team.taskWatch(r, signal)) },
  'host.describe': { schema: hostDescribeRequestSchema, invoke: (api, r) => api.host.describe(r) },
  'host.pickDirectory': { schema: hostPickDirectoryRequestSchema, invoke: (api, r, signal) => api.host.pickDirectory(r, signal) },
  'host.listDirectory': { schema: hostListDirectoryRequestSchema, invoke: (api, r, signal) => api.host.listDirectory(r, signal) },
  'host.createDirectory': { schema: hostCreateDirectoryRequestSchema, invoke: (api, r) => api.host.createDirectory(r) },
  'host.openPath': { schema: hostOpenPathRequestSchema, invoke: (api, r, signal) => api.host.openPath(r, signal) },
  'workspace.list': { schema: workspaceListRequestSchema, invoke: (api, r) => api.workspace.list(r) },
  'workspace.create': { schema: workspaceCreateRequestSchema, invoke: (api, r) => api.workspace.create(r) },
  'workspace.rename': { schema: workspaceRenameRequestSchema, invoke: (api, r) => api.workspace.rename(r) },
  'workspace.delete': { schema: workspaceDeleteRequestSchema, invoke: (api, r) => api.workspace.delete(r) },
  'workspace.insertBefore': { schema: workspaceInsertBeforeRequestSchema, invoke: (api, r) => api.workspace.insertBefore(r) },
  'workspace.insertSessionBefore': { schema: workspaceInsertSessionBeforeRequestSchema, invoke: (api, r) => api.workspace.insertSessionBefore(r) },
  'workspace.archiveSession': { schema: workspaceArchiveSessionRequestSchema, invoke: (api, r) => api.workspace.archiveSession(r) },
  'skill.list': { schema: skillListRequestSchema, invoke: (api, r) => api.skills.list(r) },
  'agentPreset.list': { schema: agentPresetListRequestSchema, invoke: (api, r) => api.agentPresets.list(r) },
  'agentPreset.select': { schema: agentPresetSelectRequestSchema, invoke: (api, r) => api.agentPresets.select(r) },
  'agentPreset.read': { schema: agentPresetReadRequestSchema, invoke: (api, r) => api.agentPresets.read(r) },
  'agentPreset.copy': { schema: agentPresetCopyRequestSchema, invoke: (api, r) => api.agentPresets.copy(r) },
  'agentPreset.openDocument': { schema: agentPresetOpenDocumentRequestSchema, invoke: (api, r, signal) => api.agentPresets.openDocument(r, signal) },
  'agentPreset.remove': { schema: agentPresetRemoveRequestSchema, invoke: (api, r) => api.agentPresets.remove(r) },
  'settings.describe': { schema: settingsDescribeRequestSchema, invoke: (api, r) => api.settings.describe(r) },
  'settings.openDocument': { schema: settingsOpenDocumentRequestSchema, invoke: (api, r, signal) => api.settings.openDocument(r, signal) },
  'settings.update': { schema: settingsUpdateRequestSchema, invoke: (api, r) => api.settings.update(r) },
  'settings.replace': { schema: settingsReplaceRequestSchema, invoke: (api, r) => api.settings.replace(r) },
  'settings.mutate': { schema: settingsMutateRequestSchema, invoke: (api, r) => api.settings.mutate(r) },
  'credentials.describe': { schema: credentialsDescribeRequestSchema, invoke: (api, r) => api.credentials.describe(r) },
  'credentials.set': { schema: credentialsSetRequestSchema, invoke: (api, r) => api.credentials.set(r) },
  'credentials.unset': { schema: credentialsUnsetRequestSchema, invoke: (api, r) => api.credentials.unset(r) },
  'llm.providers': { schema: llmProvidersRequestSchema, invoke: (api, r) => api.llm.providers(r) },
  'llm.models': { schema: llmModelsRequestSchema, invoke: (api, r) => api.llm.models(r) },
  'llm.discoverModels': { schema: llmDiscoverModelsRequestSchema, invoke: (api, r, signal) => api.llm.discoverModels(r, signal) },
}

/** Answer a Team route on a legacy API fixture that predates the Team domain. */
function unavailableTeamApi<K extends keyof RpcMethodMap>(
  api: ApiProxy,
  request: RpcRequest<RequestPayload<K>>,
  invoke: (teams: NonNullable<ApiProxy['teams']>) => Promise<RpcResponse<ResponseValue<K>>>,
): Promise<RpcResponse<ResponseValue<K>>> {
  if (api.teams !== undefined) return invoke(api.teams)
  return Promise.resolve({
    rpcId: request.rpcId,
    result: {
      ok: false,
      error: {
        code: 'team-service-unavailable',
        message: 'Team RPC is unavailable: this host does not compose a Team provider',
        details: {},
      },
    },
  })
}

/** Route lookup that narrows an arbitrary path segment to a map key (single cast point for the string→key refinement). */
function methodFor(path: string): keyof RpcMethodMap | undefined {
  return Object.hasOwn(UNARY_ROUTES, path) ? path as keyof RpcMethodMap : undefined
}

/**
 * Sentinel rpcId for error responses to envelopes whose own rpcId is unreadable: the response
 * must still be a valid ServerResponse (a self-violating shape would turn the server's explicit
 * bad-request report into a client-side parse failure). Fixed value, documented here as wire contract.
 */
const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')

/** Wrap a business error as a ServerResponse full form (rpcId backfilled; an unreadable rpcId uses the invalid-request sentinel). */
function errorResponse(rpcId: RpcId, error: RpcError): Response {
  const body: ServerResponse = { type: 'server-response', rpcId, result: { ok: false, error } }
  return Response.json(body)
}

/** Complete the impl's narrow form into a ServerResponse full form. */
function fullResponse(narrow: RpcResponse<unknown>): Response {
  const body: ServerResponse = { type: 'server-response', rpcId: narrow.rpcId, result: narrow.result }
  return Response.json(body)
}

/**
 * Parse the payload and invoke one unary route. Generic over the map key so
 * the row's schema/invoke pairing typechecks; the only cast collapses the
 * Wire<> widening back to the exact payload (undefined-valued properties and
 * absent ones are indistinguishable after JSON transport).
 */
// K appears once in the signature but ties the UNARY_ROUTES[K] row lookup to its own
// schema/invoke pairing; a union parameter degrades the row to an uninvokable intersection.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
async function handleUnary<K extends keyof RpcMethodMap>(
  api: ApiProxy,
  method: K,
  message: ClientRequest,
  signal: AbortSignal,
  authenticatedProductCall: AuthenticatedProductCall | undefined,
): Promise<Response> {
  const route = UNARY_ROUTES[method]
  const payload = route.schema.safeParse(message.payload)
  if (!payload.success) {
    return errorResponse(message.rpcId, { code: 'bad-request', message: `invalid payload for ${method}`, details: { issues: payload.error.issues } })
  }
  try {
    const dispatchSignal = authenticatedProductCall === undefined
      ? signal
      : AbortSignal.any([signal, authenticatedProductCall.signal])
    return await withAuthenticatedProductCall(authenticatedProductCall, async () =>
      fullResponse(await route.invoke(api, { rpcId: message.rpcId, payload: payload.data }, dispatchSignal)))
  } catch (error: unknown) {
    // The impl never throws business errors; reaching here means the implementation itself crashed — 500, carrier layer.
    return new Response(`handler failure: ${String(error)}`, { status: 500 })
  }
}

/** Runtime-only call facts supplied by an authenticated physical carrier. */
export interface ApiFetchContext {
  /** Immutable product principal authenticated before this request was parsed or dispatched. */
  readonly authenticatedProductCall?: AuthenticatedProductCall | undefined
}

/** SSE frame: complete the narrow RpcRequest<frame> into a ServerRequest full form (method = frame type). */
function fullFrame(narrow: RpcRequest<MuxFrame | HostFrame>): ServerRequest {
  return { type: 'server-request', rpcId: narrow.rpcId, method: narrow.payload.type, payload: narrow.payload }
}

/**
 * Wrap a frame stream as an SSE Response; stops when req.signal aborts. An
 * impl throw mid-stream emits one stream/error frame and then closes.
 */
function sseResponse(frames: AsyncIterable<RpcRequest<MuxFrame | HostFrame>>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Send an SSE comment line on open so clients/proxies see a live channel (the host
        // stream has no baseline frames and would otherwise emit zero bytes while idle;
        // a comment line is not a frame, so client frame parsing skips it naturally).
        controller.enqueue(encoder.encode(': connected\n\n'))
        for await (const narrow of frames) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame(narrow))}\n\n`))
        }
      } catch (error: unknown) {
        // Mid-stream impl failure → one stream/error frame, then close: the client must see
        // the failure instead of a silent end (which reads as a normal disconnect). A fresh
        // rpcId is minted — this is a server-initiated push like any other frame.
        const failure: MuxFrame | HostFrame = { type: 'stream/error', error: { code: 'internal', message: String(error), details: {} } }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame({ rpcId: RpcId(randomUUID()), payload: failure }))}\n\n`))
        } catch {
          // Consumer already cancelled the stream: enqueue-after-cancel is the
          // only reachable error, and there is no one left to tell.
        }
      } finally {
        try {
          controller.close()
        } catch { /* already cancelled by the consumer: a double close is the only reachable error */ }
      }
    },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}

/**
 * Wraps an ApiProxy into a pure fetch function (isomorphic point: feed the returned fetch straight to InProcessApiClient).
 * @param api - the host-side ApiProxy implementation.
 * @param context - runtime-only transport facts; these never join an RPC envelope or payload.
 * @returns an object holding `fetch(Request)`; paths outside /api/ return 404.
 */
export function toFetchHandler(api: ApiProxy, context: ApiFetchContext = {}): { fetch: typeof fetch } {
  return {
    // Signature matches global fetch: the isomorphic point hands this function to InProcessApiClient as its transport aspect,
    // Clients call in (url, init) form — normalize to Request before handling.
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const req = input instanceof Request ? input : new Request(input, init)
      const url = new URL(req.url)
      const path = url.pathname
      const dispatchSignal = context.authenticatedProductCall === undefined
        ? req.signal
        : AbortSignal.any([req.signal, context.authenticatedProductCall.signal])

      // No-envelope read channels (SSE GET streams + host-only download):
      // physical routes that answer directly, without a wire envelope.
      if (path === '/api/events.mux' && req.method === 'GET') {
        return sseResponse(api.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, dispatchSignal))
      }
      if (path === '/api/events.host' && req.method === 'GET') {
        return sseResponse(api.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, dispatchSignal))
      }
      if (path === '/api/session.export' && (req.method === 'GET' || req.method === 'HEAD')) {
        // Query params are a different boundary from the POST envelope, but
        // the request still casts its brands only through the domain schema.
        const parsed = sessionLogQuerySchema.safeParse(Object.fromEntries(url.searchParams))
        if (!parsed.success) {
          return new Response('missing or invalid sessionId query parameter', { status: 400 })
        }
        const response = await api.downloads.sessionLog(parsed.data, dispatchSignal)
        if (req.method === 'GET') return response
        await response.body?.cancel()
        return new Response(null, { status: response.status, headers: response.headers })
      }

      if (req.method !== 'POST' || !path.startsWith('/api/')) {
        return new Response('not found', { status: 404 })
      }

      // Cross-site write fence: browsers send "simple" POSTs (text/plain,
      // form encodings) without a CORS preflight, so a malicious page could
      // otherwise execute side-effectful RPCs blind — the response stays
      // unreadable cross-origin, but session.prompt would still run. Only the
      // JSON media type is accepted; anything else is forced into a preflight
      // this server never answers. 415 = carrier layer, like the 400 below.
      const mediaType = req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await req.json()
      } catch {
        // 400 = carrier layer (body is not even JSON); valid JSON with a bad shape goes 200 + bad-request.
        return new Response('body is not JSON', { status: 400 })
      }

      if (path === '/api/respond') {
        const parsed = clientResponseSchema.safeParse(body)
        if (!parsed.success) return Response.json({ accepted: false, reason: 'bad-response' })
        return await withAuthenticatedProductCall(context.authenticatedProductCall, async () =>
          Response.json(await api.respond(parsed.data)))
      }

      const method = methodFor(path.slice('/api/'.length))
      if (method === undefined) return new Response('not found', { status: 404 })

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        // Best effort at correlation: salvage a string rpcId from the raw body;
        // otherwise the fixed sentinel keeps the response a valid ServerResponse.
        const rawId = (body as { rpcId?: unknown } | null)?.rpcId
        const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
        return errorResponse(rpcId, { code: 'bad-request', message: 'invalid client-request message', details: { issues: envelope.error.issues } })
      }
      const message: ClientRequest = envelope.data
      if (message.method !== method) {
        return errorResponse(message.rpcId, { code: 'bad-request', message: `method "${message.method}" does not match path "${method}"`, details: { issues: [] } })
      }
      return handleUnary(api, method, message, dispatchSignal, context.authenticatedProductCall)
    },
  }
}
