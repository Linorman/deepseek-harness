import { simulationProductRawArchivePageSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRunControlResultSchema } from '@clocky/clocky-simulation-product/schema'
import {
  simulationProductWorldBranchResultSchema,
  simulationProductWorldCausalResultSchema,
  simulationProductWorldCompareResultSchema,
} from '@clocky/clocky-simulation-product/schema'
import { simulationProductBackupExportResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRetentionPlanSchema, simulationProductRetentionResultSchema, simulationProductRetentionRecordsResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductGenerationResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRebuildIndexResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductCalendarCommandResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductCalendarPreviewSchema, simulationProductCalendarReceiptSchema } from '@clocky/clocky-simulation-product/schema'
import { scenarioDraftReadResultSchema, scenarioDraftSaveResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldManagementFieldsSchema, simulationProductWorldManagementPreviewSchema, matchesWorldManagementPreview } from '@clocky/clocky-simulation-product/world-management-schema'
import { simulationProductWorldDomainResultSchema, matchesWorldDomainSelection } from '@clocky/clocky-simulation-product/world-read-schema'
import { simulationProductWorldCasesPageSchema, simulationProductWorldCaseInspectionSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRequestsPageSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductPreflightResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldPreflightResultSchema, simulationProductWorldExportResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRunStatusesPageSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductTasksPageSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductTaskReviewPageSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductSourceInspectionSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRecordsPageSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWatchResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductIngressReceiptSchema, simulationProductIngressResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductControlSchema, simulationProductManageResultSchema, simulationProductManagementResultSchema } from '@clocky/clocky-simulation-product/schema'
import { teamTaskUpdateLookupValueSchema } from '../api/teams.schema.ts'
import { simulationProductRunPageSchema, simulationProductRunInspectionSchema,
  simulationProductCollectionPageSchema, simulationProductObjectInspectionSchema, simulationProductCatalogSchema,
  simulationProductRequestReceiptSchema, simulationProductRequestResultSchema } from '@clocky/clocky-simulation-product/schema'
import { ApiAccessDeniedError } from '../api/rpc.ts'
import { teamIdentityResolutionSchema } from '../api/teams.schema.ts'
import { teamExecutionProfilesPageSchema } from '../api/teams.schema.ts'
import { teamMemberReadinessPageSchema } from '../api/teams.schema.ts'
import { teamCapabilitiesValueSchema } from '../api/teams.schema.ts'
import { teamActionInspectionValueSchema } from '../api/teams.schema.ts'
import { teamAttentionValueSchema } from '../api/teams.schema.ts'
import { teamMemberInspectValueSchema } from '../api/teams.schema.ts'
import { teamWorkflowInspectionValueSchema } from '../api/teams.schema.ts'
import { teamHumanActionValueSchema } from '../api/teams.schema.ts'
import { teamTaskReferencesValueSchema } from '../api/teams.schema.ts'
import { teamTaskInspectionValueSchema } from '../api/teams.schema.ts'
import { teamBrowseValueSchema } from '../api/teams.schema.ts'
import { teamMemberSessionValueSchema } from '../api/teams.schema.ts'
import { teamSelectionValueSchema } from '../api/teams.schema.ts'
import { teamHumanActionResponseResultSchema } from '../api/teams.schema.ts'
import { teamHumanInboxPageSchema, teamHumanInboxAcknowledgementSchema } from '../api/teams.schema.ts'
/**
 * Client side of the fetch carrier. AbstractApiClient holds every protocol invariant: rpcId minting,
 * four-quadrant envelope wrap/unwrap, zod parsing, in-process SSE frame decoding, and the payload-direct
 * IApiClient domain methods (business code never mints). Platform differences ride two aspects:
 * abstract doFetch (transport) + overridable onEnvelope (tap). ApiProxy (the impl face) is untouched.
 */

import type { z } from 'zod'
import type { ApiProxy, HostFrame, MuxFrame } from '../api/index.ts'
import type { RequestPayload, ResponseValue, RpcMethodMap } from '../api/rpc-map.ts'
import type { ClientRequest, ClientResponse, RpcMessage, RpcReceipt, RpcRequest, RpcResponse, ServerRequest } from '../api/rpc.ts'
import { RpcId } from '../api/rpc.ts'
import type { Wire } from '../api/rpc.schema.ts'
import { rpcReceiptSchema, serverRequestSchema, serverResponseSchema } from '../api/rpc.schema.ts'
import { hostFrameSchema, muxFrameSchema } from '../api/events.schema.ts'
import {
  hostCreateDirectoryValueSchema, hostDescribeValueSchema,
  hostListDirectoryValueSchema, hostOpenPathValueSchema, hostPickDirectoryValueSchema,
} from '../api/host.schema.ts'
import {
  sessionCancelValueSchema,
  sessionAttachmentValueSchema,
  sessionHistoryValueSchema,
  sessionListValueSchema,
  sessionModelsValueSchema,
  sessionPromptValueSchema,
  sessionRenameValueSchema,
  sessionSearchValueSchema,
  sessionSelectModelValueSchema,
  sessionUpdateQueueValueSchema,
} from '../api/sessions.schema.ts'
import {
  workspaceArchiveSessionValueSchema,
  workspaceCreateValueSchema,
  workspaceDeleteValueSchema,
  workspaceInsertBeforeValueSchema,
  workspaceInsertSessionBeforeValueSchema,
  workspaceListValueSchema,
  workspaceRenameValueSchema,
} from '../api/workspace.schema.ts'
import { skillListValueSchema } from '../api/skills.schema.ts'
import {
  agentPresetCopyValueSchema, agentPresetListValueSchema, agentPresetOpenDocumentValueSchema,
  agentPresetReadValueSchema, agentPresetRemoveValueSchema, agentPresetSelectValueSchema,
} from '../api/agent-presets.schema.ts'
import {
  settingsDescribeValueSchema, settingsMutateValueSchema, settingsOpenDocumentValueSchema,
  settingsReplaceValueSchema, settingsUpdateValueSchema,
} from '../api/settings.schema.ts'
import {
  credentialsDescribeValueSchema, credentialsSetValueSchema, credentialsUnsetValueSchema,
} from '../api/credentials.schema.ts'
import { llmDiscoverModelsValueSchema, llmModelsValueSchema, llmProvidersValueSchema } from '../api/llm.schema.ts'
import {
  teamCancelValueSchema,
  teamArchiveValueSchema,
  teamGoalTransitionValueSchema,
  teamGoalUpdateValueSchema,
  teamArtifactReadValueSchema,
  teamArtifactListValueSchema,
  teamQuiescenceValueSchema,
  teamMetricsValueSchema,
  teamAuditReadValueSchema,
  teamChannelCloseValueSchema,
  teamChannelOpenValueSchema,
  teamChannelInputValueSchema,
  teamChannelAttachmentValueSchema,
  teamChannelListValueSchema,
  teamChannelCatalogValueSchema,
  teamChannelAdmissionValueSchema,
  teamChannelInvitationValueSchema,
  teamChannelPostValueSchema,
  teamChannelSummarizeValueSchema,
  teamChannelReadValueSchema,
  teamChannelWatchValueSchema,
  teamFinalSchema,
  teamInputReceiptSchema,
  teamListValueSchema,
  teamMemberInterruptValueSchema,
  teamMemberInviteValueSchema,
  teamMemberListValueSchema,
  teamMemberActivateValueSchema,
  teamMemberRemoveValueSchema,
  teamResumeValueSchema,
  teamStartValueSchema,
  teamStateValueSchema,
  teamTaskCreateValueSchema,
  teamTaskCancelValueSchema,
  teamTaskDeleteValueSchema,
  teamTaskReviewValueSchema,
  teamTaskGetValueSchema,
  teamTaskListValueSchema,
  teamWorkflowPlanListValueSchema,
  teamTaskUpdateValueSchema,
  teamTaskWatchValueSchema,
} from '../api/teams.schema.ts'

/**
 * Client consumption face of the contract (shape a): same domain tree as ApiProxy, but unary
 * methods take the business payload directly — the carrier mints the rpcId and wraps the
 * envelope. Business code needing the call's rpcId reads it from the RpcResponse echo.
 * Unary methods and respond accept an optional external AbortSignal as the last parameter.
 * Bounded calls merge it with the instance timeout via AbortSignal.any; user-paced calls
 * carry only that external signal. In both cases the signal rides beside the request, never
 * on the wire, like the stream signatures.
 * Stream methods accept an optional onOpen callback: it fires once the physical transport is
 * readable (before any frame) — the "stream established" signal
 * connection controllers need for the readiness handshake. Generators are lazy, so the
 * underlying fetch (and therefore onOpen) only happens once iteration starts.
 * Relationship: ApiProxy is the narrow-form signature contract the impl side implements;
 * IApiClient is the payload-direct view clients consume; AbstractApiClient bridges the two.
 * Derived per method key from RpcMethodMap so a map row addition updates this mechanically.
 */
export interface IApiClient {
  /** Optional deployment reads still use the same required carrier contract and unavailable result. */
  simulations: {
    /** Read one original journal page under its independent historical-content policy. */
    /** Inspect an exact frozen source under independent Simulation and Team permission. */
    inspectSource(payload: RequestPayload<'simulation.sources.inspect'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.sources.inspect'>>>
    archiveRaw(payload: RequestPayload<'simulation.raw.archive'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.raw.archive'>>>
    records(payload: RequestPayload<'simulation.records.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.records.list'>>>
    watch(payload: RequestPayload<'simulation.changes.watch'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.changes.watch'>>>
    checkpoint(payload: RequestPayload<'simulation.checkpoints.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.checkpoints.create'>>>
    restore(payload: RequestPayload<'simulation.runs.restore'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.runs.restore'>>>
    listTasks(payload: RequestPayload<'simulation.tasks.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.tasks.list'>>>
    worldManagementFields(payload: RequestPayload<'simulation.world.management.fields'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.management.fields'>>>
    retainWorldCalendar(payload: RequestPayload<'simulation.world.calendar.retain'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.calendar.retain'>>>
    readWorldCalendarCommand(payload: RequestPayload<'simulation.world.calendar.command'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.calendar.command'>>>
    cancelWorldCalendar(payload: RequestPayload<'simulation.world.calendar.cancel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.calendar.cancel'>>>
    previewWorldCalendar(payload: RequestPayload<'simulation.world.calendar.preview'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.calendar.preview'>>>
    submitWorldCalendar(payload: RequestPayload<'simulation.world.calendar.submit'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.calendar.submit'>>>
    previewWorldManagement(payload: RequestPayload<'simulation.world.management.preview'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.management.preview'>>>
    submitWorldManagement(payload: RequestPayload<'simulation.world.management.submit'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.management.submit'>>>
    readScenarioDraft(payload: RequestPayload<'simulation.world.drafts.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.drafts.read'>>>
    saveScenarioDraft(payload: RequestPayload<'simulation.world.drafts.save'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.drafts.save'>>>
    readWorldDomain(payload: RequestPayload<'simulation.world.domain.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.domain.read'>>>
    listWorldCases(payload: RequestPayload<'simulation.world.cases.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.cases.list'>>>
    inspectWorldCase(payload: RequestPayload<'simulation.world.cases.inspect'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.cases.inspect'>>>
    cancelWorldCase(payload: RequestPayload<'simulation.world.cases.cancel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.cases.cancel'>>>
    cancelTask(payload: RequestPayload<'simulation.tasks.cancel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.tasks.cancel'>>>
    listTaskReviews(payload: RequestPayload<'simulation.tasks.review.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.tasks.review.list'>>>
    resolveTaskReview(payload: RequestPayload<'simulation.tasks.review.resolve'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.tasks.review.resolve'>>>
    ingress(payload: RequestPayload<'simulation.ingress.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.ingress.create'>>>
    ingressRequest(payload: RequestPayload<'simulation.ingress.get'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.ingress.get'>>>
    control(payload: RequestPayload<'simulation.runs.control'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.runs.control'>>>
    updateRunControl(payload: RequestPayload<'simulation.runs.run-control'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.runs.run-control'>>>
    manage(payload: RequestPayload<'simulation.runs.manage'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.runs.manage'>>>
    managementRequest(payload: RequestPayload<'simulation.management.get'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.management.get'>>>
    catalog(payload: RequestPayload<'simulation.catalog'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.catalog'>>>
    /** Resolve a creation draft without allocating or preparing a run. */
    preflight(payload: RequestPayload<'simulation.runs.preflight'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.runs.preflight'>>>
    preflightWorld(payload: RequestPayload<'simulation.world.preflight'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.preflight'>>>
    createWorld(payload: RequestPayload<'simulation.world.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.create'>>>
    prepareWorld(payload: RequestPayload<'simulation.world.prepare'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.prepare'>>>
    exportWorldDefinition(payload: RequestPayload<'simulation.world.export'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.world.export'>>>
    create(payload: RequestPayload<'simulation.runs.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.runs.create'>>>
    prepare(payload: RequestPayload<'simulation.runs.prepare'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.runs.prepare'>>>
    /** Discover original receipt metadata without retaining private command bodies. */
    listRequests(payload: RequestPayload<'simulation.requests.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.requests.list'>>>
    /** Retry only the server-retained original; input and identity cannot be replaced. */
    retryRequest(payload: RequestPayload<'simulation.requests.retry'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.requests.retry'>>>
    request(payload: RequestPayload<'simulation.requests.get'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.requests.get'>>>
    retryOperation(payload: RequestPayload<'simulation.operation.retry'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.operation.retry'>>>
    runStatuses(payload: RequestPayload<'simulation.runs.statuses'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.runs.statuses'>>>
    list(payload: RequestPayload<'simulation.runs.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.runs.list'>>>
    inspect(payload: RequestPayload<'simulation.runs.inspect'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.runs.inspect'>>>
    /** Rebuild only the exact retained source prefix. */
    /** Original experiment command or bounded read; source selection is echoed and checked.
     * @param payload - Exact original command or archived observation references.
     * @param signal - Optional transport waiter cancellation; durable originals remain retained.
     * @returns Source-bound strict response envelope without starting a paused run.
     */
    branchWorld(payload: RequestPayload<'simulation.world.branch'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.world.branch'>>>
    /** Original experiment command or bounded read; source selection is echoed and checked.
     * @param payload - Exact original command or archived observation references.
     * @param signal - Optional transport waiter cancellation; durable originals remain retained.
     * @returns Source-bound strict response envelope without starting a paused run.
     */
    readWorldBranch(payload: RequestPayload<'simulation.world.branch.read'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.world.branch.read'>>>
    /** Original experiment command or bounded read; source selection is echoed and checked.
     * @param payload - Exact original command or archived observation references.
     * @param signal - Optional transport waiter cancellation; durable originals remain retained.
     * @returns Source-bound strict response envelope without starting a paused run.
     */
    queryWorldCausal(payload: RequestPayload<'simulation.world.causal'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.world.causal'>>>
    /** Original experiment command or bounded read; source selection is echoed and checked.
     * @param payload - Exact original command or archived observation references.
     * @param signal - Optional transport waiter cancellation; durable originals remain retained.
     * @returns Source-bound strict response envelope without starting a paused run.
     */
    compareWorlds(payload: RequestPayload<'simulation.world.compare'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.world.compare'>>>
    backupExport(payload: RequestPayload<'simulation.backup.export'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.backup.export'>>>
    retentionPreview(payload: RequestPayload<'simulation.retention.preview'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.retention.preview'>>>
    retentionExecute(payload: RequestPayload<'simulation.retention.execute'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.retention.execute'>>>
    retentionRead(payload: RequestPayload<'simulation.retention.read'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.retention.read'>>>
    retentionRecords(payload: RequestPayload<'simulation.retention.records'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.retention.records'>>>
    generationRequest(payload: RequestPayload<'simulation.generation.request'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.generation.request'>>>
    generationRead(payload: RequestPayload<'simulation.generation.read'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.generation.read'>>>
    generationExecute(payload: RequestPayload<'simulation.generation.execute'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.generation.execute'>>>
    generationTransition(payload: RequestPayload<'simulation.generation.transition'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.generation.transition'>>>
    generationPersonaDraft(payload: RequestPayload<'simulation.generation.persona-draft'>, signal?: AbortSignal):
    Promise<RpcResponse<ResponseValue<'simulation.generation.persona-draft'>>>
    rebuildIndex(payload: RequestPayload<'simulation.index.rebuild'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.index.rebuild'>>>
    browse(payload: RequestPayload<'simulation.collections.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.collections.list'>>>
    inspectObject(payload: RequestPayload<'simulation.objects.inspect'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'simulation.objects.inspect'>>>
  }
  sessions: {
    list(payload: RequestPayload<'session.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.list'>>>
    search(payload: RequestPayload<'session.search'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.search'>>>
    history(payload: RequestPayload<'session.history'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.history'>>>
    models(payload: RequestPayload<'session.models'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.models'>>>
    selectModel(payload: RequestPayload<'session.selectModel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.selectModel'>>>
    rename(payload: RequestPayload<'session.rename'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.rename'>>>
    prompt(payload: RequestPayload<'session.prompt'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.prompt'>>>
    attachment(payload: RequestPayload<'session.attachment'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.attachment'>>>
    updateQueue(payload: RequestPayload<'session.updateQueue'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.updateQueue'>>>
    cancel(payload: RequestPayload<'session.cancel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.cancel'>>>
  }
  teams: {
    executionProfiles(payload: RequestPayload<'team.executionProfiles'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.executionProfiles'>>>

    /** Read authorized display identities and their principal-generation cache scope. */
    /** Read Team-scoped pending counts and one bounded summary page. */
    actionInspect(payload: RequestPayload<'team.action.inspect'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.action.inspect'>>>
    attentionRead(payload: RequestPayload<'team.attention.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.attention.read'>>>
    identityResolve(payload: RequestPayload<'team.identity.resolve'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.identity.resolve'>>>
    memberReadiness(payload: RequestPayload<'team.member.readiness'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.member.readiness'>>>

    capabilities(payload: RequestPayload<'team.capabilities'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.capabilities'>>>

    memberInspect(payload: RequestPayload<'team.member.inspect'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.member.inspect'>>>

    /** Read task details or one history window without retaining other histories. */
    actionRead(payload: RequestPayload<'team.action.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.action.read'>>>
    taskReferences(payload: RequestPayload<'team.task.references'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.task.references'>>>
    taskInspect(payload: RequestPayload<'team.task.inspect'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.task.inspect'>>>

    browse(payload: RequestPayload<'team.browse'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.browse'>>>

    /** Read an exact member's latest published Session binding. */
    memberSession(payload: RequestPayload<'team.member.session'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.member.session'>>>

    inboxRespond(payload: RequestPayload<'team.inbox.respond'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.inbox.respond'>>>
    inboxRead(payload: RequestPayload<'team.inbox.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.inbox.read'>>>
    inboxWatch(payload: RequestPayload<'team.inbox.watch'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.inbox.watch'>>>
    inboxAcknowledge(payload: RequestPayload<'team.inbox.acknowledge'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.inbox.acknowledge'>>>

    list(payload: RequestPayload<'team.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.list'>>>
    /** Read bounded identity and coordinator data without activating an Agent. */
    selection(payload: RequestPayload<'team.selection'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.selection'>>>
    get(payload: RequestPayload<'team.get'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.get'>>>
    create(payload: RequestPayload<'team.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.create'>>>
    resume(payload: RequestPayload<'team.resume'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.resume'>>>
    start(payload: RequestPayload<'team.start'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.start'>>>
    postInput(payload: RequestPayload<'team.postInput'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.postInput'>>>
    waitFinal(payload: RequestPayload<'team.waitFinal'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.waitFinal'>>>
    cancel(payload: RequestPayload<'team.cancel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.cancel'>>>
    archive(payload: RequestPayload<'team.archive'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.archive'>>>
    goalUpdate(payload: RequestPayload<'team.goal.update'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.goal.update'>>>
    goalTransition(payload: RequestPayload<'team.goal.transition'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.goal.transition'>>>
    quiescence(payload: RequestPayload<'team.quiescence'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.quiescence'>>>
    metrics(payload: RequestPayload<'team.metrics'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.metrics'>>>
    auditRead(payload: RequestPayload<'team.audit.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.audit.read'>>>
    artifactRead(payload: RequestPayload<'team.artifact.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.artifact.read'>>>
    artifactList(payload: RequestPayload<'team.artifact.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.artifact.list'>>>
    memberList(payload: RequestPayload<'team.member.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.member.list'>>>
    memberInvite(payload: RequestPayload<'team.member.invite'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.member.invite'>>>
    memberActivate(payload: RequestPayload<'team.member.activate'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.member.activate'>>>
    memberRemove(payload: RequestPayload<'team.member.remove'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.member.remove'>>>
    memberInterrupt(payload: RequestPayload<'team.member.interrupt'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.member.interrupt'>>>
    channelInput(payload: RequestPayload<'team.channel.input'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.input'>>>
    channelAttachment(payload: RequestPayload<'team.channel.attachment'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.attachment'>>>
    channelCatalog(payload: RequestPayload<'team.channel.catalog'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.catalog'>>>
    channelList(payload: RequestPayload<'team.channel.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.list'>>>
    channelAdmission(payload: RequestPayload<'team.channel.admission'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.admission'>>>
    channelInvitation(payload: RequestPayload<'team.channel.invitation'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.invitation'>>>
    channelInvitationAcknowledge(payload: RequestPayload<'team.channel.invitation.acknowledge'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.invitation.acknowledge'>>>
    channelOpen(payload: RequestPayload<'team.channel.open'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.open'>>>
    channelPost(payload: RequestPayload<'team.channel.post'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.post'>>>
    channelSummarize(payload: RequestPayload<'team.channel.summarize'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.summarize'>>>
    channelRead(payload: RequestPayload<'team.channel.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.read'>>>
    channelClose(payload: RequestPayload<'team.channel.close'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.close'>>>
    channelWatch(payload: RequestPayload<'team.channel.watch'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.channel.watch'>>>
    taskCreate(payload: RequestPayload<'team.task.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.task.create'>>>
    taskGet(payload: RequestPayload<'team.task.get'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.task.get'>>>
    taskList(payload: RequestPayload<'team.task.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.task.list'>>>
    workflowPlanInspect(payload: RequestPayload<'team.workflow.plan.inspect'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.workflow.plan.inspect'>>>
    workflowPlanList(payload: RequestPayload<'team.workflow.plan.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.workflow.plan.list'>>>
    taskUpdateResult(payload: RequestPayload<'team.task.update.result'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.task.update.result'>>>
    taskUpdate(payload: RequestPayload<'team.task.update'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.task.update'>>>
    taskCancel(payload: RequestPayload<'team.task.cancel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.task.cancel'>>>
    taskDelete(payload: RequestPayload<'team.task.delete'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.task.delete'>>>
    taskReview(payload: RequestPayload<'team.task.review'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.task.review'>>>
    taskWatch(payload: RequestPayload<'team.task.watch'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.task.watch'>>>
  }
  host: {
    describe(payload: RequestPayload<'host.describe'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.describe'>>>
    pickDirectory(payload: RequestPayload<'host.pickDirectory'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.pickDirectory'>>>
    listDirectory(payload: RequestPayload<'host.listDirectory'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.listDirectory'>>>
    createDirectory(payload: RequestPayload<'host.createDirectory'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.createDirectory'>>>
    openPath(payload: RequestPayload<'host.openPath'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.openPath'>>>
  }
  workspace: {
    list(payload: RequestPayload<'workspace.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.list'>>>
    create(payload: RequestPayload<'workspace.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.create'>>>
    rename(payload: RequestPayload<'workspace.rename'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.rename'>>>
    delete(payload: RequestPayload<'workspace.delete'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.delete'>>>
    insertBefore(payload: RequestPayload<'workspace.insertBefore'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.insertBefore'>>>
    insertSessionBefore(payload: RequestPayload<'workspace.insertSessionBefore'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.insertSessionBefore'>>>
    archiveSession(payload: RequestPayload<'workspace.archiveSession'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.archiveSession'>>>
  }
  skills: {
    list(payload: RequestPayload<'skill.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'skill.list'>>>
  }
  agentPresets: {
    list(payload: RequestPayload<'agentPreset.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.list'>>>
    select(payload: RequestPayload<'agentPreset.select'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.select'>>>
    read(payload: RequestPayload<'agentPreset.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.read'>>>
    copy(payload: RequestPayload<'agentPreset.copy'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.copy'>>>
    openDocument(payload: RequestPayload<'agentPreset.openDocument'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.openDocument'>>>
    remove(payload: RequestPayload<'agentPreset.remove'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.remove'>>>
  }
  events: {
    mux(payload: Parameters<ApiProxy['events']['mux']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<MuxFrame>>
    host(payload: Parameters<ApiProxy['events']['host']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<HostFrame>>
  }
  settings: {
    describe(payload: RequestPayload<'settings.describe'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.describe'>>>
    openDocument(payload: RequestPayload<'settings.openDocument'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.openDocument'>>>
    update(payload: RequestPayload<'settings.update'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.update'>>>
    replace(payload: RequestPayload<'settings.replace'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.replace'>>>
    mutate(payload: RequestPayload<'settings.mutate'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.mutate'>>>
  }
  credentials: {
    describe(payload: RequestPayload<'credentials.describe'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'credentials.describe'>>>
    set(payload: RequestPayload<'credentials.set'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'credentials.set'>>>
    unset(payload: RequestPayload<'credentials.unset'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'credentials.unset'>>>
  }
  llm: {
    providers(payload: RequestPayload<'llm.providers'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'llm.providers'>>>
    models(payload: RequestPayload<'llm.models'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'llm.models'>>>
    discoverModels(payload: RequestPayload<'llm.discoverModels'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'llm.discoverModels'>>>
  }
  /** client-response passthrough (rpcId is a backfill of the server-request's id — never minted here). */
  respond(message: ClientResponse, signal?: AbortSignal): Promise<RpcReceipt>
}

/**
 * S→C second-level parse table: value schema by method (the response-path
 * mirror of the handler's request table; key coverage compiler-enforced against RpcMethodMap).
 */
const UNARY_VALUE_SCHEMAS: { [K in keyof RpcMethodMap]: z.ZodType<Wire<ResponseValue<K>>> } = {
  'simulation.world.drafts.read': scenarioDraftReadResultSchema,
  'simulation.world.drafts.save': scenarioDraftSaveResultSchema,
  'simulation.checkpoints.create': simulationProductRequestReceiptSchema,
  'simulation.runs.restore': simulationProductRequestReceiptSchema,
  'simulation.tasks.list': simulationProductTasksPageSchema,
  'simulation.tasks.cancel': simulationProductRequestReceiptSchema,
  'simulation.world.management.fields': simulationProductWorldManagementFieldsSchema,
  'simulation.world.calendar.retain': simulationProductCalendarCommandResultSchema,
  'simulation.world.calendar.command': simulationProductCalendarCommandResultSchema,
  'simulation.world.calendar.cancel': simulationProductCalendarCommandResultSchema,
  'simulation.world.calendar.preview': simulationProductCalendarPreviewSchema,
  'simulation.world.calendar.submit': simulationProductCalendarReceiptSchema,
  'simulation.world.management.preview': simulationProductWorldManagementPreviewSchema,
  'simulation.world.management.submit': simulationProductRequestReceiptSchema,
  'simulation.world.domain.read': simulationProductWorldDomainResultSchema,
  'simulation.world.cases.list': simulationProductWorldCasesPageSchema,
  'simulation.world.cases.inspect': simulationProductWorldCaseInspectionSchema,
  'simulation.world.cases.cancel': simulationProductRequestReceiptSchema,
  'simulation.tasks.review.list': simulationProductTaskReviewPageSchema,
  'simulation.tasks.review.resolve': simulationProductRequestReceiptSchema,
  'simulation.ingress.create': simulationProductIngressReceiptSchema,
  'simulation.ingress.get': simulationProductIngressResultSchema,
  'simulation.runs.control': simulationProductControlSchema,
  'simulation.runs.run-control': simulationProductRunControlResultSchema,
  'simulation.runs.manage': simulationProductManageResultSchema,
  'simulation.management.get': simulationProductManagementResultSchema,
  'simulation.catalog': simulationProductCatalogSchema,
  'simulation.runs.preflight': simulationProductPreflightResultSchema,
  'simulation.world.preflight': simulationProductWorldPreflightResultSchema,
  'simulation.world.create': simulationProductRequestReceiptSchema,
  'simulation.world.prepare': simulationProductRequestReceiptSchema,
  'simulation.world.export': simulationProductWorldExportResultSchema,
  'simulation.runs.create': simulationProductRequestReceiptSchema,
  'simulation.runs.prepare': simulationProductRequestReceiptSchema,
  'simulation.requests.list': simulationProductRequestsPageSchema,
  'simulation.requests.retry': simulationProductRequestReceiptSchema,
  'simulation.requests.get': simulationProductRequestResultSchema,
  'simulation.operation.retry': simulationProductRequestReceiptSchema,
  'simulation.runs.statuses': simulationProductRunStatusesPageSchema,
  'simulation.runs.list': simulationProductRunPageSchema,
  'simulation.runs.inspect': simulationProductRunInspectionSchema,
  'simulation.world.branch': simulationProductWorldBranchResultSchema,
  'simulation.world.branch.read': simulationProductWorldBranchResultSchema,
  'simulation.world.causal': simulationProductWorldCausalResultSchema,
  'simulation.world.compare': simulationProductWorldCompareResultSchema,
  'simulation.backup.export': simulationProductBackupExportResultSchema,
  'simulation.retention.preview': simulationProductRetentionPlanSchema,
  'simulation.retention.execute': simulationProductRetentionResultSchema,
  'simulation.retention.read': simulationProductRetentionResultSchema,
  'simulation.retention.records': simulationProductRetentionRecordsResultSchema,
  'simulation.generation.request': simulationProductGenerationResultSchema,
  'simulation.generation.read': simulationProductGenerationResultSchema,
  'simulation.generation.execute': simulationProductGenerationResultSchema,
  'simulation.generation.transition': simulationProductGenerationResultSchema,
  'simulation.generation.persona-draft': simulationProductGenerationResultSchema,
  'simulation.index.rebuild': simulationProductRebuildIndexResultSchema,
  'simulation.collections.list': simulationProductCollectionPageSchema,
  'simulation.objects.inspect': simulationProductObjectInspectionSchema,
  'simulation.sources.inspect': simulationProductSourceInspectionSchema,
  'simulation.raw.archive': simulationProductRawArchivePageSchema,
  'simulation.records.list': simulationProductRecordsPageSchema,
  'simulation.changes.watch': simulationProductWatchResultSchema,
  'session.list': sessionListValueSchema,
  'session.search': sessionSearchValueSchema,
  'session.history': sessionHistoryValueSchema,
  'session.models': sessionModelsValueSchema,
  'session.selectModel': sessionSelectModelValueSchema,
  'session.rename': sessionRenameValueSchema,
  'session.prompt': sessionPromptValueSchema,
  'session.attachment': sessionAttachmentValueSchema,
  'session.updateQueue': sessionUpdateQueueValueSchema,
  'session.cancel': sessionCancelValueSchema,
  'team.list': teamListValueSchema,
  'team.selection': teamSelectionValueSchema,
  'team.member.inspect': teamMemberInspectValueSchema,
  'team.member.session': teamMemberSessionValueSchema,
  'team.workflow.plan.inspect': teamWorkflowInspectionValueSchema,
  'team.action.read': teamHumanActionValueSchema,
  'team.task.references': teamTaskReferencesValueSchema,
  'team.task.inspect': teamTaskInspectionValueSchema,
  'team.executionProfiles': teamExecutionProfilesPageSchema,
  'team.identity.resolve': teamIdentityResolutionSchema,
  'team.member.readiness': teamMemberReadinessPageSchema,
  'team.capabilities': teamCapabilitiesValueSchema,
  'team.action.inspect': teamActionInspectionValueSchema,
  'team.attention.read': teamAttentionValueSchema,
  'team.browse': teamBrowseValueSchema,
  'team.get': teamStateValueSchema,
  'team.create': teamStateValueSchema,
  'team.resume': teamResumeValueSchema,
  'team.start': teamStartValueSchema,
  'team.postInput': teamInputReceiptSchema,
  'team.waitFinal': teamFinalSchema,
  'team.cancel': teamCancelValueSchema,
  'team.archive': teamArchiveValueSchema,
  'team.goal.update': teamGoalUpdateValueSchema,
  'team.goal.transition': teamGoalTransitionValueSchema,
  'team.quiescence': teamQuiescenceValueSchema,
  'team.inbox.respond': teamHumanActionResponseResultSchema,
  'team.inbox.read': teamHumanInboxPageSchema,
  'team.inbox.watch': teamHumanInboxPageSchema,
  'team.inbox.acknowledge': teamHumanInboxAcknowledgementSchema,
  'team.metrics': teamMetricsValueSchema,
  'team.audit.read': teamAuditReadValueSchema,
  'team.artifact.read': teamArtifactReadValueSchema,
  'team.artifact.list': teamArtifactListValueSchema,
  'team.member.list': teamMemberListValueSchema,
  'team.member.invite': teamMemberInviteValueSchema,
  'team.member.activate': teamMemberActivateValueSchema,
  'team.member.remove': teamMemberRemoveValueSchema,
  'team.member.interrupt': teamMemberInterruptValueSchema,
  'team.channel.input': teamChannelInputValueSchema,
  'team.channel.attachment': teamChannelAttachmentValueSchema,
  'team.channel.catalog': teamChannelCatalogValueSchema,
  'team.channel.list': teamChannelListValueSchema,
  'team.channel.admission': teamChannelAdmissionValueSchema,
  'team.channel.invitation': teamChannelInvitationValueSchema,
  'team.channel.invitation.acknowledge': teamChannelInvitationValueSchema,
  'team.channel.open': teamChannelOpenValueSchema,
  'team.channel.post': teamChannelPostValueSchema,
  'team.channel.summarize': teamChannelSummarizeValueSchema,
  'team.channel.read': teamChannelReadValueSchema,
  'team.channel.close': teamChannelCloseValueSchema,
  'team.channel.watch': teamChannelWatchValueSchema,
  'team.task.create': teamTaskCreateValueSchema,
  'team.task.cancel': teamTaskCancelValueSchema,
  'team.task.delete': teamTaskDeleteValueSchema,
  'team.task.review': teamTaskReviewValueSchema,
  'team.task.get': teamTaskGetValueSchema,
  'team.task.list': teamTaskListValueSchema,
  'team.workflow.plan.list': teamWorkflowPlanListValueSchema,
  'team.task.update': teamTaskUpdateValueSchema,
  'team.task.update.result': teamTaskUpdateLookupValueSchema,
  'team.task.watch': teamTaskWatchValueSchema,
  'host.describe': hostDescribeValueSchema,
  'host.pickDirectory': hostPickDirectoryValueSchema,
  'host.listDirectory': hostListDirectoryValueSchema,
  'host.createDirectory': hostCreateDirectoryValueSchema,
  'host.openPath': hostOpenPathValueSchema,
  'workspace.list': workspaceListValueSchema,
  'workspace.create': workspaceCreateValueSchema,
  'workspace.rename': workspaceRenameValueSchema,
  'workspace.delete': workspaceDeleteValueSchema,
  'workspace.insertBefore': workspaceInsertBeforeValueSchema,
  'workspace.insertSessionBefore': workspaceInsertSessionBeforeValueSchema,
  'workspace.archiveSession': workspaceArchiveSessionValueSchema,
  'skill.list': skillListValueSchema,
  'agentPreset.list': agentPresetListValueSchema,
  'agentPreset.select': agentPresetSelectValueSchema,
  'agentPreset.read': agentPresetReadValueSchema,
  'agentPreset.copy': agentPresetCopyValueSchema,
  'agentPreset.openDocument': agentPresetOpenDocumentValueSchema,
  'agentPreset.remove': agentPresetRemoveValueSchema,
  'settings.describe': settingsDescribeValueSchema,
  'settings.openDocument': settingsOpenDocumentValueSchema,
  'settings.update': settingsUpdateValueSchema,
  'settings.replace': settingsReplaceValueSchema,
  'settings.mutate': settingsMutateValueSchema,
  'credentials.describe': credentialsDescribeValueSchema,
  'credentials.set': credentialsSetValueSchema,
  'credentials.unset': credentialsUnsetValueSchema,
  'llm.providers': llmProvidersValueSchema,
  'llm.models': llmModelsValueSchema,
  'llm.discoverModels': llmDiscoverModelsValueSchema,
}

/** Default timeout for bounded unary calls (rpc-compare 2026-07-19: a hung host must not leave callers pending forever). */
const DEFAULT_TIMEOUT_MS = 30_000

/** Whether a unary call uses the transport health deadline or only caller/connection cancellation. */
type UnaryTimeoutPolicy = 'default' | 'caller-signal-only'

/** URL base for in-process handler injection (fake authority, opencode precedent). */
const INTERNAL_BASE = 'http://clocky.internal'

/**
 * Abstract fetch-carrier client. Subclasses supply the transport (doFetch) and may refine the
 * per-message tap (onEnvelope) — platform aspects stay in subclasses, protocol invariants stay
 * here. Envelope observation is a first-class aspect of this data middle layer: the instance
 * owns a microtask-batched buffer (frame storms must not cost one consumer update per frame),
 * and observers subscribe via subscribeEnvelopes. The isomorphic point survives: an in-process
 * subclass whose doFetch is toFetchHandler(api).fetch never touches the network.
 */
export abstract class AbstractApiClient implements IApiClient {
  readonly simulations: IApiClient['simulations'] = {
    inspectSource: async (payload, signal) => {
      const response = await this.callUnary('simulation.sources.inspect', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.decisionId !== payload.decisionId || value.sourceIndex !== payload.sourceIndex
          || payload.expectedRevision !== undefined && value.snapshotRevision !== payload.expectedRevision
          || payload.envelopeSequence !== undefined && value.envelope !== undefined && value.envelope.sequence !== payload.envelopeSequence
          || payload.limit !== undefined && value.items.length > payload.limit) throw new Error('Simulation source response does not match its selection')
      }
      return response
    },
    archiveRaw: async (payload, signal) => {
      const response = await this.callUnary('simulation.raw.archive', payload, signal)
      if (response.result.ok && response.result.value.runId !== payload.runId)
        throw new Error('Raw archive response belongs to another original selection')
      return response
    },
    records: async (payload, signal) => {
      const response = await this.callUnary('simulation.records.list', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.mode !== payload.mode || value.selection.kind !== payload.kind
          || value.selection.sequence !== payload.sequence
          || payload.expectedRevision !== undefined && value.snapshotRevision !== payload.expectedRevision
          || payload.sequence !== undefined && value.items.some(item => item.sequence !== payload.sequence)
          || payload.limit !== undefined && value.items.length > payload.limit) {
          throw new Error('Simulation record response does not match its query or page')
        }
      }
      return response
    },
    watch: async (payload, signal) => {
      const response = await this.callUnary('simulation.changes.watch', payload, signal)
      if (response.result.ok && response.result.value.runId !== payload.runId) throw new Error('Simulation watch response does not match its run')
      return response
    },
    checkpoint: async (payload, signal) => {
      const response = await this.callUnary('simulation.checkpoints.create', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.commandId !== payload.commandId || value.kind !== 'checkpoint') {
          throw new Error('Simulation maintenance/input response does not match its original selection')
        }
      }
      return response
    },
    restore: async (payload, signal) => {
      const response = await this.callUnary('simulation.runs.restore', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.commandId !== payload.commandId || value.kind !== 'restore'
          || value.checkpointId !== payload.checkpointId) {
          throw new Error('Simulation maintenance/input response does not match its original selection')
        }
      }
      return response
    },
    listTasks: async (payload, signal) => {
      const response = await this.callUnary('simulation.tasks.list', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || payload.expectedRevision !== undefined && response.result.value.snapshotRevision !== payload.expectedRevision
        || payload.limit !== undefined && response.result.value.items.length > payload.limit)) {
        throw new Error('Simulation task page does not match its original selection')
      }
      return response
    },
    worldManagementFields: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.management.fields', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId || response.result.value.targetId !== payload.targetId
        || response.result.value.action !== payload.action)) {
        throw new Error('World management response does not match its original selection')
      }
      return response
    },
    retainWorldCalendar: async (payload, signal) => this.callUnary('simulation.world.calendar.retain', payload, signal),
    readWorldCalendarCommand: async (payload, signal) => this.callUnary('simulation.world.calendar.command', payload, signal),
    cancelWorldCalendar: async (payload, signal) => this.callUnary('simulation.world.calendar.cancel', payload, signal),
    previewWorldCalendar: async (payload, signal) => this.callUnary('simulation.world.calendar.preview', payload, signal),
    submitWorldCalendar: async (payload, signal) => this.callUnary('simulation.world.calendar.submit', payload, signal),
    previewWorldManagement: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.management.preview', payload, signal)
      if (response.result.ok && (!matchesWorldManagementPreview(payload, response.result.value))) {
        throw new Error('World management response does not match its original selection')
      }
      return response
    },
    submitWorldManagement: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.management.submit', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId || response.result.value.commandId !== payload.commandId || response.result.value.kind !== 'world-management')) {
        throw new Error('World management response does not match its original selection')
      }
      return response
    },
    readScenarioDraft: (payload, signal) => this.callUnary('simulation.world.drafts.read', payload, signal),
    saveScenarioDraft: (payload, signal) => this.callUnary('simulation.world.drafts.save', payload, signal),
    readWorldDomain: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.domain.read', payload, signal)
      if (response.result.ok && !matchesWorldDomainSelection(payload, response.result.value)) {
        throw new Error('World domain response does not match its original selection')
      }
      return response
    },
    listWorldCases: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.cases.list', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || payload.expectedRevision !== undefined && response.result.value.snapshotRevision !== payload.expectedRevision
        || payload.limit !== undefined && response.result.value.items.length > payload.limit
        || payload.status !== undefined && response.result.value.items.some(item => item.status !== payload.status))) {
        throw new Error('World case page does not match its original selection')
      }
      return response
    },
    inspectWorldCase: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.cases.inspect', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || payload.expectedRevision !== undefined && response.result.value.snapshotRevision !== payload.expectedRevision
        || response.result.value.requestId !== payload.requestId || response.result.value.section !== payload.section)) {
        throw new Error('World case detail does not match its original selection')
      }
      return response
    },
    cancelWorldCase: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.cases.cancel', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.commandId !== payload.commandId || response.result.value.kind !== 'cancel-world-case')) {
        throw new Error('World cancellation receipt does not match its original selection')
      }
      return response
    },
    cancelTask: async (payload, signal) => {
      const response = await this.callUnary('simulation.tasks.cancel', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.commandId !== payload.commandId || response.result.value.kind !== 'cancel-task')) {
        throw new Error('Simulation cancellation receipt does not match its original selection')
      }
      return response
    },
    listTaskReviews: async (payload, signal) => {
      const response = await this.callUnary('simulation.tasks.review.list', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || payload.expectedRevision !== undefined && response.result.value.snapshotRevision !== payload.expectedRevision
        || payload.limit !== undefined && response.result.value.items.length > payload.limit)) {
        throw new Error('Simulation review page does not match its original selection')
      }
      return response
    },
    resolveTaskReview: async (payload, signal) => {
      const response = await this.callUnary('simulation.tasks.review.resolve', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.commandId !== payload.commandId || response.result.value.kind !== 'review')) {
        throw new Error('Simulation review receipt does not match its original selection')
      }
      return response
    },
    ingress: async (payload, signal) => {
      const response = await this.callUnary('simulation.ingress.create', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.ingressId !== payload.ingressId || value.entityId !== payload.entityId
          || value.availableAt !== payload.availableAt) {
          throw new Error('Simulation maintenance/input response does not match its original selection')
        }
      }
      return response
    },
    ingressRequest: async (payload, signal) => {
      const response = await this.callUnary('simulation.ingress.get', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.ingressId !== payload.ingressId) {
          throw new Error('Simulation maintenance/input response does not match its original selection')
        }
      }
      return response
    },
    control: async (payload, signal) => {
      const response = await this.callUnary('simulation.runs.control', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId) {
          throw new Error('Simulation scheduling response does not match its original selection')
        }
      }
      return response
    },
    updateRunControl: async (payload, signal) => {
      const response = await this.callUnary('simulation.runs.run-control', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.receipt.commandId !== payload.commandId
        || response.result.value.receipt.targetId !== (payload.target?.targetId ?? null)))
        throw new Error('Simulation stop response does not match its original selection')
      return response
    },
    manage: async (payload, signal) => {
      const response = await this.callUnary('simulation.runs.manage', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.operation.managementId !== payload.managementId
          || value.operation.phase !== payload.phase) {
          throw new Error('Simulation scheduling response does not match its original selection')
        }
      }
      return response
    },
    managementRequest: async (payload, signal) => {
      const response = await this.callUnary('simulation.management.get', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.managementId !== payload.managementId) {
          throw new Error('Simulation scheduling response does not match its original selection')
        }
      }
      return response
    },
    catalog: (payload, signal) => this.callUnary('simulation.catalog', payload, signal),
    preflight: (payload, signal) => this.callUnary('simulation.runs.preflight', payload, signal),
    preflightWorld: (payload, signal) => this.callUnary('simulation.world.preflight', payload, signal),
    createWorld: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.create', payload, signal)
      if (response.result.ok && (response.result.value.commandId !== payload.commandId || response.result.value.kind !== 'world-create')) {
        throw new Error('World creation response does not match its original command')
      }
      return response
    },
    prepareWorld: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.prepare', payload, signal)
      if (response.result.ok && (response.result.value.commandId !== payload.commandId
        || response.result.value.runId !== payload.runId || response.result.value.kind !== 'world-prepare')) {
        throw new Error('World preparation response does not match its original command')
      }
      return response
    },
    exportWorldDefinition: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.export', payload, signal)
      if (response.result.ok && response.result.value.runId !== payload.runId) {
        throw new Error('World export response does not match its selected run')
      }
      return response
    },
    create: async (payload, signal) => {
      const response = await this.callUnary('simulation.runs.create', payload, signal)
      if (response.result.ok && (response.result.value.commandId !== payload.commandId || response.result.value.kind !== 'create')) {
        throw new Error('Simulation administration response does not match its original command')
      }
      return response
    },
    prepare: async (payload, signal) => {
      const response = await this.callUnary('simulation.runs.prepare', payload, signal)
      if (response.result.ok && (response.result.value.commandId !== payload.commandId || response.result.value.kind !== 'prepare' || response.result.value.runId !== payload.runId)) {
        throw new Error('Simulation administration response does not match its original command')
      }
      return response
    },
    listRequests: async (payload, signal) => {
      const response = await this.callUnary('simulation.requests.list', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.items.some(item => item.runId !== payload.runId)
          || payload.expectedRevision !== undefined && value.snapshotRevision !== payload.expectedRevision
          || payload.limit !== undefined && value.items.length > payload.limit) {
          throw new Error('Simulation request page does not match its original selection')
        }
      }
      return response
    },
    retryRequest: async (payload, signal) => {
      const response = await this.callUnary('simulation.requests.retry', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId || response.result.value.commandId !== payload.commandId)) {
        throw new Error('Simulation request retry does not match its original selection')
      }
      return response
    },
    request: async (payload, signal) => {
      const response = await this.callUnary('simulation.requests.get', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        const id = value.status === 'found' ? value.request.commandId : value.commandId
        if (id !== payload.commandId) throw new Error('Simulation result response does not match its original command')
      }
      return response
    },
    retryOperation: async (payload, signal) => {
      const response = await this.callUnary('simulation.operation.retry', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.commandId !== payload.commandId || response.result.value.kind !== 'retry-operation')) {
        throw new Error('Simulation operation retry response does not match its original selection')
      }
      return response
    },
    runStatuses: async (payload, signal) => {
      const response = await this.callUnary('simulation.runs.statuses', payload, signal)
      if (response.result.ok && (response.result.value.items.length !== payload.runIds.length
        || response.result.value.items.some((item, index) => item.run.id !== payload.runIds[index]))) {
        throw new Error('Simulation status response does not match its exact run batch')
      }
      return response
    },
    list: (payload, signal) => this.callUnary('simulation.runs.list', payload, signal),
    inspect: async (payload, signal) => {
      const response = await this.callUnary('simulation.runs.inspect', payload, signal)
      if (response.result.ok && response.result.value.run.id !== payload.runId) {
        throw new Error('Simulation inspection response does not match its registered run')
      }
      return response
    },
    branchWorld: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.branch', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.commandId !== payload.commandId || value.status === 'not-found'
        || value.memoryPolicy !== payload.memoryPolicy || value.source.runId !== payload.source.runId
        || value.source.archiveCommandId !== payload.source.archiveCommandId)
          throw new Error('World experiment response changed its original selection or bounds')
      }
      return response
    },
    readWorldBranch: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.branch.read', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.commandId !== payload.commandId)
          throw new Error('World experiment response changed its original selection or bounds')
      }
      return response
    },
    queryWorldCausal: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.causal', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.source.runId !== payload.source.runId || value.source.archiveCommandId !== payload.source.archiveCommandId
        || value.nodes.length > payload.maxNodes || new TextEncoder().encode(JSON.stringify(value)).length > payload.maxBytes)
          throw new Error('World experiment response changed its original selection or bounds')
      }
      return response
    },
    compareWorlds: async (payload, signal) => {
      const response = await this.callUnary('simulation.world.compare', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.observations.left.runId !== payload.left.runId
          || value.observations.left.archiveCommandId !== payload.left.archiveCommandId
        || value.observations.right.runId !== payload.right.runId
        || value.observations.right.archiveCommandId !== payload.right.archiveCommandId)
          throw new Error('World experiment response changed its original selection or bounds')
      }
      return response
    },
    backupExport: async (payload, signal) => {
      const response = await this.callUnary('simulation.backup.export', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId || response.result.value.commandId !== payload.commandId))
        throw new Error('Backup response changed its original selection')
      return response
    },
    retentionPreview: async (payload, signal) => {
      const response = await this.callUnary('simulation.retention.preview', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId) throw new Error('Retention response changed its original selection')
      }
      return response
    },
    retentionExecute: async (payload, signal) => {
      const response = await this.callUnary('simulation.retention.execute', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.commandId !== payload.commandId
        || value.status === 'not-found' || value.plan.planHash !== payload.planHash || value.plan.snapshotRevision !== payload.expectedRevision) throw new Error('Retention response changed its original selection')
      }
      return response
    },
    retentionRead: async (payload, signal) => {
      const response = await this.callUnary('simulation.retention.read', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.commandId !== payload.commandId) throw new Error('Retention response changed its original selection')
      }
      return response
    },
    retentionRecords: async (payload, signal) => {
      const response = await this.callUnary('simulation.retention.records', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.commandId !== payload.commandId
        || value.owner !== payload.owner || value.ownerId !== payload.ownerId
        || value.entries.length > payload.limit || value.entries.some((entry, index, entries) =>
          entry.sequence <= (entries[index - 1]?.sequence ?? payload.afterSequence))) throw new Error('Retention response changed its original selection')
      }
      return response
    },
    generationRequest: async (payload, signal) => {
      const response = await this.callUnary('simulation.generation.request', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.job !== null && response.result.value.job.job.id !== payload.job.id
        || response.result.value.job === null)) throw new Error('Generation response changed its original selection')
      return response
    },
    generationRead: async (payload, signal) => {
      const response = await this.callUnary('simulation.generation.read', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.job !== null && response.result.value.job.job.id !== payload.jobId)) throw new Error('Generation response changed its original selection')
      return response
    },
    generationExecute: async (payload, signal) => {
      const response = await this.callUnary('simulation.generation.execute', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.job !== null && response.result.value.job.job.id !== payload.jobId
        || response.result.value.job === null)) throw new Error('Generation response changed its original selection')
      return response
    },
    generationTransition: async (payload, signal) => {
      const response = await this.callUnary('simulation.generation.transition', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.job !== null && response.result.value.job.job.id !== payload.change.id
        || response.result.value.job === null)) throw new Error('Generation response changed its original selection')
      return response
    },
    generationPersonaDraft: async (payload, signal) => {
      const response = await this.callUnary('simulation.generation.persona-draft', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.job !== null && response.result.value.job.job.id !== payload.jobId
        || response.result.value.job === null)) throw new Error('Generation response changed its original selection')
      return response
    },
    rebuildIndex: async (payload, signal) => {
      const response = await this.callUnary('simulation.index.rebuild', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.snapshotRevision !== payload.expectedRevision)) throw new Error('Simulation index response does not match its source')
      return response
    },
    browse: async (payload, signal) => {
      const response = await this.callUnary('simulation.collections.list', payload, signal)
      if (response.result.ok && (response.result.value.runId !== payload.runId
        || response.result.value.collection !== payload.collection)) {
        throw new Error('Simulation collection response does not match its registered run and collection')
      }
      return response
    },
    inspectObject: async (payload, signal) => {
      const response = await this.callUnary('simulation.objects.inspect', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.runId !== payload.runId || value.selection.collection !== payload.collection || value.selection.id !== payload.id
          || value.selection.section !== payload.section
          || payload.collection === 'decisions' && payload.section === 'knowledge' && (value.selection.collection !== 'decisions'
            || value.selection.section !== 'knowledge' || value.selection.reference?.id !== payload.reference?.id
            || value.selection.reference?.revision !== payload.reference?.revision)
          || payload.expectedRevision !== undefined && value.snapshotRevision !== payload.expectedRevision) {
          throw new Error('Simulation object response does not match its exact selection')
        }
      }
      return response
    },
  }
  /** Instance-owned observation buffer (module-level state would leak across instances/tests). */
  private envelopeBatch: RpcMessage[] = []
  private flushScheduled = false
  private readonly envelopeListeners = new Set<(batch: readonly RpcMessage[]) => void>()

  /** @param timeoutMs - timeout for bounded unary calls; user-paced calls and streams do not use it. */
  constructor(protected readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  /** Transport aspect: browser fetch, injected handler.fetch, IPC bridge, ... */
  protected abstract doFetch(input: URL, init?: RequestInit): Promise<Response>

  /**
   * Subscribe to batched envelope observation (diagnostics/logging consumers).
   * Batches follow microtask boundaries; a listener throw is isolated (observation
   * must never break the carrier).
   * @param listener - receives each flushed batch in arrival order.
   * @returns unsubscribe function.
   */
  subscribeEnvelopes(listener: (batch: readonly RpcMessage[]) => void): () => void {
    this.envelopeListeners.add(listener)
    return () => {
      this.envelopeListeners.delete(listener)
    }
  }

  /** Per-message tap: feeds the instance buffer. Subclasses may override to observe unbatched (call super to keep batching). */
  protected onEnvelope(message: RpcMessage): void {
    if (this.envelopeListeners.size === 0) return
    this.envelopeBatch.push(message)
    if (this.flushScheduled) return
    this.flushScheduled = true
    queueMicrotask(() => {
      this.flushScheduled = false
      // Never empty here: a flush is only ever scheduled by the push above,
      // and this callback is the sole drain point.
      const batch = this.envelopeBatch
      this.envelopeBatch = []
      for (const notify of this.envelopeListeners) {
        try {
          notify(batch)
        } catch (error) {
          console.error('[apiproxy] envelope listener threw:', error)
        }
      }
    })
  }

  /** Browser = same-origin (a fake authority would fail DNS on real requests); no-location env (Node) = fake authority. */
  protected resolveBase(): string {
    const loc = (globalThis as { location?: { origin?: string } }).location
    return loc?.origin !== undefined && loc.origin !== 'null' ? loc.origin : INTERNAL_BASE
  }

  protected mintRpcId(): RpcId {
    // crypto.randomUUID is a Web API (browser + Node ≥19): keeps this base platform-neutral.
    return RpcId(crypto.randomUUID())
  }

  /**
   * Shared POST leg of both C→S carriers (callUnary/respond): JSON body,
   * optional default timeout merged with the caller's external signal, non-2xx → transport throw.
   */
  private async postJson(
    path: string,
    body: ClientRequest | ClientResponse,
    signal: AbortSignal | undefined,
    timeoutPolicy: UnaryTimeoutPolicy = 'default',
  ): Promise<Response> {
    const requestSignal = timeoutPolicy === 'default'
      ? signal === undefined
        ? AbortSignal.timeout(this.timeoutMs)
        : AbortSignal.any([AbortSignal.timeout(this.timeoutMs), signal])
      : signal
    const response = await this.doFetch(new URL(path, this.resolveBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...requestSignal === undefined ? {} : { signal: requestSignal },
    })
    if (response.status === 401 || response.status === 403) throw new ApiAccessDeniedError(path, response.status)
    if (!response.ok) throw new Error(`transport failure for ${path}: HTTP ${response.status}`)
    return response
  }

  /**
   * Unary protocol path: mint → tap → POST full form → envelope parse → verify
   * echo → value parse → tap → narrow. Virtual so a fake carrier (fixture) can
   * override transport at this layer.
   */
  protected async callUnary<K extends keyof RpcMethodMap>(
    method: K,
    payload: RequestPayload<K>,
    signal?: AbortSignal,
    timeoutPolicy: UnaryTimeoutPolicy = 'default',
  ): Promise<RpcResponse<ResponseValue<K>>> {
    const message: ClientRequest = { type: 'client-request', rpcId: this.mintRpcId(), method, payload }
    this.onEnvelope(message)
    const response = await this.postJson(`/api/${method}`, message, signal, timeoutPolicy)
    const full = serverResponseSchema.parse(await response.json())
    this.onEnvelope(full)
    if (full.rpcId !== message.rpcId) throw new Error(`rpcId mismatch for ${method}: sent ${message.rpcId}, got ${full.rpcId}`)
    if (!full.result.ok) return { rpcId: full.rpcId, result: full.result }
    // Second-level S→C parse: the ok value must match the method's Value schema (mirror of the
    // handler's request-payload parse). The cast collapses the Wire<> widening, same as the handler side.
    const value = UNARY_VALUE_SCHEMAS[method].parse(full.result.value) as ResponseValue<K>
    return { rpcId: full.rpcId, result: { ok: true, value } }
  }

  /** Mux stream opener; virtual for the same override reason as callUnary. */
  protected openMux(_payload: Parameters<ApiProxy['events']['mux']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readSse('/api/events.mux', signal, muxFrameSchema, onOpen)
  }

  /** Host stream opener; virtual. */
  protected openHost(_payload: Parameters<ApiProxy['events']['host']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readSse('/api/events.host', signal, hostFrameSchema, onOpen)
  }

  /**
   * SSE protocol path: streaming fetch (not EventSource), '\n\n' framing, ServerRequest envelope +
   * frame-schema parse, tap, narrow yield. onOpen fires once the response headers are in and the
   * body is readable — the stream-established signal, before any frame arrives. A frame that fails
   * either parse level is reported and skipped (one corrupt frame must not kill the stream; the
   * client's gap detection covers whatever the frame carried).
   */
  protected async *readSse<F extends MuxFrame | HostFrame>(
    path: string,
    signal: AbortSignal,
    frameSchema: z.ZodType<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const response = await this.doFetch(new URL(path, this.resolveBase()), { signal })
    if (response.status === 401 || response.status === 403) throw new ApiAccessDeniedError(path, response.status)
    if (!response.ok || response.body === null) throw new Error(`transport failure for ${path}: HTTP ${response.status}`)
    onOpen?.()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = chunk.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('')
          if (data === '') continue
          let full: ServerRequest
          let frame: F
          try {
            full = serverRequestSchema.parse(JSON.parse(data))
            frame = frameSchema.parse(full.payload)
          } catch (error) {
            console.error(`[apiproxy] dropping malformed SSE frame on ${path}:`, error)
            continue
          }
          this.onEnvelope(full)
          yield { rpcId: full.rpcId, payload: frame }
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }

  // ---- IApiClient API (arrow properties so destructured/passed references stay bound) ----

  readonly sessions: IApiClient['sessions'] = {
    list: (payload, signal) => this.callUnary('session.list', payload, signal),
    search: (payload, signal) => this.callUnary('session.search', payload, signal),
    history: (payload, signal) => this.callUnary('session.history', payload, signal),
    models: (payload, signal) => this.callUnary('session.models', payload, signal),
    selectModel: (payload, signal) => this.callUnary('session.selectModel', payload, signal),
    rename: (payload, signal) => this.callUnary('session.rename', payload, signal),
    prompt: (payload, signal) => this.callUnary('session.prompt', payload, signal),
    attachment: (payload, signal) => this.callUnary('session.attachment', payload, signal),
    updateQueue: (payload, signal) => this.callUnary('session.updateQueue', payload, signal),
    cancel: (payload, signal) => this.callUnary('session.cancel', payload, signal),
  }

  readonly teams: IApiClient['teams'] = {
    executionProfiles: (payload, signal) => this.callUnary('team.executionProfiles', payload, signal),
    actionInspect: (payload, signal) => this.callUnary('team.action.inspect', payload, signal),
    attentionRead: (payload, signal) => this.callUnary('team.attention.read', payload, signal),
    identityResolve: (payload, signal) => this.callUnary('team.identity.resolve', payload, signal),
    memberReadiness: (payload, signal) => this.callUnary('team.member.readiness', payload, signal),
    capabilities: (payload, signal) => this.callUnary('team.capabilities', payload, signal),
    memberInspect: (payload, signal) => this.callUnary('team.member.inspect', payload, signal),
    actionRead: async (payload, signal) => {
      const response = await this.callUnary('team.action.read', payload, signal)
      if (response.result.ok && (response.result.value.teamId !== payload.teamId || response.result.value.id !== payload.actionId)) {
        throw new Error('team.action.read response does not match its action selection')
      }
      return response
    },
    taskReferences: (payload, signal) => this.callUnary('team.task.references', payload, signal),
    taskInspect: async (payload, signal) => {
      const response = await this.callUnary('team.task.inspect', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.teamId !== payload.teamId || value.taskId !== payload.taskId || value.section !== payload.section
          || payload.expectedRevision !== undefined && value.revision !== payload.expectedRevision
          || value.section !== 'record' && payload.section !== 'record' && value.startCursor !== (payload.afterCursor ?? -1)) {
          throw new Error('team.task.inspect response does not match its task selection')
        }
      }
      return response
    },
    browse: async (payload, signal) => {
      const response = await this.callUnary('team.browse', payload, signal)
      if (response.result.ok && (response.result.value.teamId !== payload.teamId || response.result.value.kind !== payload.kind)) {
        throw new Error('team.browse response belongs to a different Team or collection')
      }
      return response
    },
    memberSession: (payload, signal) => this.callUnary('team.member.session', payload, signal),
    list: (payload, signal) => this.callUnary('team.list', payload, signal),
    selection: (payload, signal) => this.callUnary('team.selection', payload, signal),
    get: (payload, signal) => this.callUnary('team.get', payload, signal),
    create: (payload, signal) => this.callUnary('team.create', payload, signal),
    resume: (payload, signal) => this.callUnary('team.resume', payload, signal),
    start: (payload, signal) => this.callUnary('team.start', payload, signal),
    postInput: (payload, signal) => this.callUnary('team.postInput', payload, signal),
    // A final result is user-paced and may legitimately outlast the carrier's
    // health deadline; caller or connection cancellation still stops the wait.
    waitFinal: (payload, signal) => this.callUnary('team.waitFinal', payload, signal, 'caller-signal-only'),
    cancel: (payload, signal) => this.callUnary('team.cancel', payload, signal),
    archive: (payload, signal) => this.callUnary('team.archive', payload, signal),
    goalUpdate: (payload, signal) => this.callUnary('team.goal.update', payload, signal),
    goalTransition: (payload, signal) => this.callUnary('team.goal.transition', payload, signal),
    quiescence: (payload, signal) => this.callUnary('team.quiescence', payload, signal),
    inboxRespond: (payload, signal) => this.callUnary('team.inbox.respond', payload, signal),
    inboxRead: (payload, signal) => this.callUnary('team.inbox.read', payload, signal),
    inboxWatch: (payload, signal) => this.callUnary('team.inbox.watch', payload, signal, 'caller-signal-only'),
    inboxAcknowledge: (payload, signal) => this.callUnary('team.inbox.acknowledge', payload, signal),
    metrics: (payload, signal) => this.callUnary('team.metrics', payload, signal),
    auditRead: (payload, signal) => this.callUnary('team.audit.read', payload, signal),
    artifactRead: (payload, signal) => this.callUnary('team.artifact.read', payload, signal),
    artifactList: (payload, signal) => this.callUnary('team.artifact.list', payload, signal),
    memberList: (payload, signal) => this.callUnary('team.member.list', payload, signal),
    memberInvite: (payload, signal) => this.callUnary('team.member.invite', payload, signal),
    memberActivate: (payload, signal) => this.callUnary('team.member.activate', payload, signal),
    memberRemove: (payload, signal) => this.callUnary('team.member.remove', payload, signal),
    memberInterrupt: (payload, signal) => this.callUnary('team.member.interrupt', payload, signal),
    channelInput: (payload, signal) => this.callUnary('team.channel.input', payload, signal),
    channelAttachment: (payload, signal) => this.callUnary('team.channel.attachment', payload, signal),
    channelCatalog: (payload, signal) => this.callUnary('team.channel.catalog', payload, signal),
    channelList: (payload, signal) => this.callUnary('team.channel.list', payload, signal),
    channelAdmission: (payload, signal) => this.callUnary('team.channel.admission', payload, signal),
    channelInvitation: (payload, signal) => this.callUnary('team.channel.invitation', payload, signal),
    channelInvitationAcknowledge: (payload, signal) => this.callUnary('team.channel.invitation.acknowledge', payload, signal),
    channelOpen: (payload, signal) => this.callUnary('team.channel.open', payload, signal),
    channelPost: (payload, signal) => this.callUnary('team.channel.post', payload, signal),
    channelSummarize: (payload, signal) => this.callUnary('team.channel.summarize', payload, signal),
    channelRead: (payload, signal) => this.callUnary('team.channel.read', payload, signal),
    channelClose: (payload, signal) => this.callUnary('team.channel.close', payload, signal),
    channelWatch: (payload, signal) => this.callUnary('team.channel.watch', payload, signal, 'caller-signal-only'),
    taskCreate: (payload, signal) => this.callUnary('team.task.create', payload, signal),
    taskGet: (payload, signal) => this.callUnary('team.task.get', payload, signal),
    taskList: (payload, signal) => this.callUnary('team.task.list', payload, signal),
    workflowPlanInspect: async (payload, signal) => {
      const response = await this.callUnary('team.workflow.plan.inspect', payload, signal)
      if (response.result.ok) {
        const value = response.result.value
        if (value.record.teamId !== payload.teamId || value.record.id !== payload.planId
          || value.startCursor !== (payload.afterCursor ?? -1)
          || payload.expectedRevision !== undefined && value.record.revision !== payload.expectedRevision) {
          throw new Error('Workflow inspection response does not match its selection')
        }
      }
      return response
    },
    workflowPlanList: (payload, signal) => this.callUnary('team.workflow.plan.list', payload, signal),
    taskUpdateResult: (payload, signal) => this.callUnary('team.task.update.result', payload, signal),
    taskUpdate: async (payload, signal) => {
      const response = await this.callUnary('team.task.update', payload, signal)
      if (response.result.ok) {
        const { receipt } = response.result.value
        if (receipt.teamId !== payload.teamId || receipt.taskId !== payload.taskId
          || receipt.commandId !== payload.commandId || receipt.expectedRevision !== payload.expectedRevision) {
          throw new Error('Task update receipt does not match its original command')
        }
      }
      return response
    },
    taskCancel: (payload, signal) => this.callUnary('team.task.cancel', payload, signal),
    taskDelete: (payload, signal) => this.callUnary('team.task.delete', payload, signal),
    taskReview: (payload, signal) => this.callUnary('team.task.review', payload, signal),
    taskWatch: (payload, signal) => this.callUnary('team.task.watch', payload, signal, 'caller-signal-only'),
  }

  readonly host: IApiClient['host'] = {
    describe: (payload, signal) => this.callUnary('host.describe', payload, signal),
    // A native system dialog is user-paced and may legitimately stay open
    // longer than the normal unary deadline. Caller/connection aborts remain.
    pickDirectory: (payload, signal) => this.callUnary(
      'host.pickDirectory', payload, signal, 'caller-signal-only',
    ),
    listDirectory: (payload, signal) => this.callUnary('host.listDirectory', payload, signal),
    createDirectory: (payload, signal) => this.callUnary('host.createDirectory', payload, signal),
    openPath: (payload, signal) => this.callUnary('host.openPath', payload, signal),
  }

  readonly workspace: IApiClient['workspace'] = {
    list: (payload, signal) => this.callUnary('workspace.list', payload, signal),
    create: (payload, signal) => this.callUnary('workspace.create', payload, signal),
    rename: (payload, signal) => this.callUnary('workspace.rename', payload, signal),
    delete: (payload, signal) => this.callUnary('workspace.delete', payload, signal),
    insertBefore: (payload, signal) => this.callUnary('workspace.insertBefore', payload, signal),
    insertSessionBefore: (payload, signal) => this.callUnary('workspace.insertSessionBefore', payload, signal),
    archiveSession: (payload, signal) => this.callUnary('workspace.archiveSession', payload, signal),
  }

  readonly skills: IApiClient['skills'] = {
    list: (payload, signal) => this.callUnary('skill.list', payload, signal),
  }

  // Annotated like every sibling, and load-bearing rather than cosmetic:
  // inferring this member inlines `AgentPresetEntry` into the emitted
  // declaration by the specifier TS picks — the host `index.ts` — which drags
  // the whole gateway, and with it the host `Context` merges, into every
  // Client program that imports this carrier.
  readonly agentPresets: IApiClient['agentPresets'] = {
    list: (payload, signal) => this.callUnary('agentPreset.list', payload, signal),
    select: (payload, signal) => this.callUnary('agentPreset.select', payload, signal),
    read: (payload, signal) => this.callUnary('agentPreset.read', payload, signal),
    copy: (payload, signal) => this.callUnary('agentPreset.copy', payload, signal),
    openDocument: (payload, signal) => this.callUnary('agentPreset.openDocument', payload, signal),
    remove: (payload, signal) => this.callUnary('agentPreset.remove', payload, signal),
  }

  readonly settings: IApiClient['settings'] = {
    describe: (payload, signal) => this.callUnary('settings.describe', payload, signal),
    openDocument: (payload, signal) => this.callUnary('settings.openDocument', payload, signal),
    update: (payload, signal) => this.callUnary('settings.update', payload, signal),
    replace: (payload, signal) => this.callUnary('settings.replace', payload, signal),
    mutate: (payload, signal) => this.callUnary('settings.mutate', payload, signal),
  }

  readonly credentials: IApiClient['credentials'] = {
    describe: (payload, signal) => this.callUnary('credentials.describe', payload, signal),
    set: (payload, signal) => this.callUnary('credentials.set', payload, signal),
    unset: (payload, signal) => this.callUnary('credentials.unset', payload, signal),
  }

  readonly llm: IApiClient['llm'] = {
    providers: (payload, signal) => this.callUnary('llm.providers', payload, signal),
    models: (payload, signal) => this.callUnary('llm.models', payload, signal),
    discoverModels: (payload, signal) => this.callUnary('llm.discoverModels', payload, signal),
  }

  readonly events: IApiClient['events'] = {
    mux: (payload, signal, onOpen) => this.openMux(payload, signal, onOpen),
    host: (payload, signal, onOpen) => this.openHost(payload, signal, onOpen),
  }

  async respond(message: ClientResponse, signal?: AbortSignal): Promise<RpcReceipt> {
    this.onEnvelope(message)
    const response = await this.postJson('/api/respond', message, signal)
    return rpcReceiptSchema.parse(await response.json())
  }
}

/**
 * In-process client over an injected fetch-shaped handler (the isomorphic point:
 * `new InProcessApiClient(toFetchHandler(api))` never touches the network). Lives here because
 * in-process injection is this package's own capability (handler and client are both local).
 */
export class InProcessApiClient extends AbstractApiClient {
  constructor(private readonly handler: { fetch: typeof fetch }, timeoutMs?: number) {
    super(timeoutMs)
  }

  /**
   * Faithful to real fetch: reject on signal abort even when the in-process
   * handler ignores the signal (a hung impl must not defeat timeout/cancel).
   */
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    const signal = init?.signal ?? undefined
    if (signal === undefined) return this.handler.fetch(input, init)
    if (signal.aborted) return Promise.reject(abortError(signal))
    return new Promise((resolve, reject) => {
      const onAbort = (): void => { reject(abortError(signal)) }
      signal.addEventListener('abort', onAbort, { once: true })
      this.handler.fetch(input, init)
        .then(resolve, reject)
        .finally(() => { signal.removeEventListener('abort', onAbort) })
    })
  }
}

/** Mirror fetch's abort rejection: the signal's reason when present, else a DOMException-style AbortError. */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new Error(reason)
  return new Error('This operation was aborted')
}
