import type { SimulationProductRawArchiveInput, SimulationProductRawArchivePage } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductRunControlInput, SimulationProductRunControlResult } from '@clocky/clocky-simulation-product/types'
import type {
  SimulationProductWorldBranchInput,
  SimulationProductWorldBranchResult,
  SimulationProductWorldBranchReadInput,
  SimulationProductWorldCausalInput,
  SimulationProductWorldCausalResult,
  SimulationProductWorldCompareInput,
  SimulationProductWorldCompareResult,
} from '@clocky/clocky-simulation-product/experiment-types'
import type { SimulationProductBackupExportInput, SimulationProductBackupExportResult } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductRetentionPreviewInput, SimulationProductRetentionExecuteInput, SimulationProductRetentionReadInput, SimulationProductRetentionRecordsInput, SimulationProductRetentionPlan, SimulationProductRetentionResult, SimulationProductRetentionRecordsResult } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductGenerationRequest, SimulationProductGenerationRead, SimulationProductGenerationTransition, SimulationProductGenerationPersonaDraft, SimulationProductGenerationResult } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductRebuildIndexInput, SimulationProductRebuildIndexResult } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductCalendarCommandInput, SimulationProductCalendarCommandResult, SimulationProductCalendarCancel } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductCalendarInput, SimulationProductCalendarPreview, SimulationProductCalendarSubmit, SimulationProductCalendarReceipt } from '@clocky/clocky-simulation-product/types'
import type { ScenarioDraftSave, ScenarioDraftSaveResult, ScenarioDraftRead, ScenarioDraftReadResult } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductWorldManagementFieldsInput, SimulationProductWorldManagementDraft, SimulationProductWorldManagementSubmitInput, SimulationProductWorldManagementFields, SimulationProductWorldManagementPreview } from '@clocky/clocky-simulation-product/world-management-types'
import type { SimulationProductWorldDomainInput, SimulationProductWorldDomainResult } from '@clocky/clocky-simulation-product/world-read-types'
import type { SimulationProductWorldCasesInput, SimulationProductWorldCasesPage, SimulationProductWorldCaseInput, SimulationProductWorldCaseInspection } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductWorldCaseCancelInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductTasksInput, SimulationProductTasksPage, SimulationProductTaskCancelInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductRequestsInput, SimulationProductRequestsPage, SimulationProductRetryRequestInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductPreflightInput, SimulationProductPreflightResult } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductWorldCreateInput, SimulationProductWorldPreflightInput,
  SimulationProductWorldPreflightResult, SimulationProductWorldExportResult } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductOperationRetryInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductRunStatusesInput, SimulationProductRunStatusesPage } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductTaskReviewListInput, SimulationProductTaskReviewPage, SimulationProductTaskReviewResolveInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductSourceInput, SimulationProductSourceInspection } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductRecordsInput, SimulationProductRecordsPage } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductWatchInput, SimulationProductWatchResult } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductCheckpointInput, SimulationProductIngressInput, SimulationProductIngressQuery, SimulationProductIngressReceipt, SimulationProductIngressResult, SimulationProductRequestReceipt, SimulationProductRestoreInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductControlInput, SimulationProductControl, SimulationProductManageInput, SimulationProductManageResult, SimulationProductManagementInput, SimulationProductManagementResult } from '@clocky/clocky-simulation-product/types'
/** Actor-free product Simulation reads and retained creation requests; deployment owns configuration and execution. */
import type { SimulationProductListInput, SimulationProductRunPage, SimulationProductInspectInput,
  SimulationProductRunInspection, SimulationProductBrowseInput, SimulationProductCollectionPage,
  SimulationProductObjectInput, SimulationProductObjectInspection } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductCreateInput, SimulationProductPrepareInput, SimulationProductRequestInput, SimulationProductCatalog,
  SimulationProductRequestResult } from '@clocky/clocky-simulation-product/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Authenticated metadata, template discovery and persistent creation/preparation requests. */
export interface SimulationsApi {
  /** Explicit original experiment operation; reads never infer or resume scheduling.
   * @param request - Authenticated original command or finite archived observation selection.
   * @returns Source-bound response envelope; private archive bytes remain separately authorized.
   */
  branchWorld(request: RpcRequest<SimulationProductWorldBranchInput>): Promise<RpcResponse<SimulationProductWorldBranchResult>>
  /** Explicit original experiment operation; reads never infer or resume scheduling.
   * @param request - Authenticated original command or finite archived observation selection.
   * @returns Source-bound response envelope; private archive bytes remain separately authorized.
   */
  readWorldBranch(request: RpcRequest<SimulationProductWorldBranchReadInput>): Promise<RpcResponse<SimulationProductWorldBranchResult>>
  /** Explicit original experiment operation; reads never infer or resume scheduling.
   * @param request - Authenticated original command or finite archived observation selection.
   * @returns Source-bound response envelope; private archive bytes remain separately authorized.
   */
  queryWorldCausal(request: RpcRequest<SimulationProductWorldCausalInput>): Promise<RpcResponse<SimulationProductWorldCausalResult>>
  /** Explicit original experiment operation; reads never infer or resume scheduling.
   * @param request - Authenticated original command or finite archived observation selection.
   * @returns Source-bound response envelope; private archive bytes remain separately authorized.
   */
  compareWorlds(request: RpcRequest<SimulationProductWorldCompareInput>): Promise<RpcResponse<SimulationProductWorldCompareResult>>

  /** @param request - Owned run and original prefix. @returns atomically published derived index identity. */
  /** Original full-history retention preview; preview and read never infer. */
  /** Exact private completed backup; independent record disclosure is required. */
  backupExport(request: RpcRequest<SimulationProductBackupExportInput>): Promise<RpcResponse<SimulationProductBackupExportResult>>
  retentionPreview(request: RpcRequest<SimulationProductRetentionPreviewInput>): Promise<RpcResponse<SimulationProductRetentionPlan>>
  /** Original full-history retention execute; preview and read never infer. */
  retentionExecute(request: RpcRequest<SimulationProductRetentionExecuteInput>): Promise<RpcResponse<SimulationProductRetentionResult>>
  /** Original full-history retention read; preview and read never infer. */
  retentionRead(request: RpcRequest<SimulationProductRetentionReadInput>): Promise<RpcResponse<SimulationProductRetentionResult>>
  /** Original full-history retention records; preview and read never infer. */
  retentionRecords(request: RpcRequest<SimulationProductRetentionRecordsInput>):
  Promise<RpcResponse<SimulationProductRetentionRecordsResult>>
  /** Explicit original generation request; reads never infer. */
  generationRequest(request: RpcRequest<SimulationProductGenerationRequest>): Promise<RpcResponse<SimulationProductGenerationResult>>
  /** Explicit original generation read; reads never infer. */
  generationRead(request: RpcRequest<SimulationProductGenerationRead>): Promise<RpcResponse<SimulationProductGenerationResult>>
  /** Explicit original generation execute; reads never infer. */
  generationExecute(request: RpcRequest<SimulationProductGenerationRead>): Promise<RpcResponse<SimulationProductGenerationResult>>
  /** Explicit original generation transition; reads never infer. */
  generationTransition(request: RpcRequest<SimulationProductGenerationTransition>): Promise<RpcResponse<SimulationProductGenerationResult>>
  /** Explicit original generation persona-draft; reads never infer. */
  generationPersonaDraft(request: RpcRequest<SimulationProductGenerationPersonaDraft>):
  Promise<RpcResponse<SimulationProductGenerationResult>>
  rebuildIndex(request: RpcRequest<SimulationProductRebuildIndexInput>): Promise<RpcResponse<SimulationProductRebuildIndexResult>>
  /** Preserve or recover the authenticated original calendar intent. */
  retainWorldCalendar(request: RpcRequest<SimulationProductCalendarSubmit>): Promise<RpcResponse<SimulationProductCalendarCommandResult>>
  /** Preserve or recover the authenticated original calendar intent. */
  readWorldCalendarCommand(request: RpcRequest<SimulationProductCalendarCommandInput>):
  Promise<RpcResponse<SimulationProductCalendarCommandResult>>
  /** Preserve or recover the authenticated original calendar intent. */
  cancelWorldCalendar(request: RpcRequest<SimulationProductCalendarCancel>): Promise<RpcResponse<SimulationProductCalendarCommandResult>>
  /** @param request - Exact calendar replacement. @returns inert affected-event quote. */
  previewWorldCalendar(request: RpcRequest<SimulationProductCalendarInput>): Promise<RpcResponse<SimulationProductCalendarPreview>>
  /** @param request - Exact original quote. @returns durable deduplicated acceptance. */
  submitWorldCalendar(request: RpcRequest<SimulationProductCalendarSubmit>): Promise<RpcResponse<SimulationProductCalendarReceipt>>

  /** @param request - Private author draft lookup. @returns exact saved revision without execution. */
  readScenarioDraft(request: RpcRequest<ScenarioDraftRead>): Promise<RpcResponse<ScenarioDraftReadResult>>
  /** @param request - Original save and parent revision. @returns durable revision or conflict. */
  saveScenarioDraft(request: RpcRequest<ScenarioDraftSave>): Promise<RpcResponse<ScenarioDraftSaveResult>>
  /** @param request - Exact original person or confirmed command. @returns authenticated inert quote or retained receipt. */
  worldManagementFields(request: RpcRequest<SimulationProductWorldManagementFieldsInput>):
  Promise<RpcResponse<SimulationProductWorldManagementFields>>
  /** @param request - Exact original person or confirmed command. @returns authenticated inert quote or retained receipt. */
  previewWorldManagement(request: RpcRequest<SimulationProductWorldManagementDraft>):
  Promise<RpcResponse<SimulationProductWorldManagementPreview>>
  /** @param request - Exact original person or confirmed command. @returns authenticated inert quote or retained receipt. */
  submitWorldManagement(request: RpcRequest<SimulationProductWorldManagementSubmitInput>):
  Promise<RpcResponse<SimulationProductRequestReceipt>>

  /** @param request - Exact domain selection and bounded revision-pinned window.
   * @returns independently authorized World facts without execution or restore. */
  readWorldDomain(request: RpcRequest<SimulationProductWorldDomainInput>): Promise<RpcResponse<SimulationProductWorldDomainResult>>
  /** @param request - Owned run and revision-bound case page. @returns safe metadata without case or Persona bodies. */
  listWorldCases(request: RpcRequest<SimulationProductWorldCasesInput>): Promise<RpcResponse<SimulationProductWorldCasesPage>>
  /** @param request - Original case and bounded section. @returns independently authorized details and exact source identities. */
  inspectWorldCase(request: RpcRequest<SimulationProductWorldCaseInput>): Promise<RpcResponse<SimulationProductWorldCaseInspection>>
  /** @param request - Original command and owned World case. @returns durable receipt; Native resolves cancellation versus hiring. */
  cancelWorldCase(request: RpcRequest<SimulationProductWorldCaseCancelInput>): Promise<RpcResponse<SimulationProductRequestReceipt>>
  /** @param request - Portable definition only. @returns an inert deployment-backed preview, without command or identity allocation. */
  preflightWorld(request: RpcRequest<SimulationProductWorldPreflightInput>): Promise<RpcResponse<SimulationProductWorldPreflightResult>>
  /** @param request - Original command and exact reviewed definition/hash.
   * @returns retained creation; preparation never starts inference. */
  createWorld(request: RpcRequest<SimulationProductWorldCreateInput>): Promise<RpcResponse<SimulationProductRequestReceipt>>
  /** @param request - Owned original run and preparation command. @returns retained reconciliation receipt with original identities. */
  prepareWorld(request: RpcRequest<SimulationProductPrepareInput>): Promise<RpcResponse<SimulationProductRequestReceipt>>
  /** @param request - Owned World run. @returns its original portable definition, separate from execution history or backups. */
  exportWorldDefinition(request: RpcRequest<SimulationProductControlInput>): Promise<RpcResponse<SimulationProductWorldExportResult>>
  /** @param request - Exact owned run and bounded canonical task metadata window.
   * @returns current cancellation hints without task bodies. */
  listTasks(request: RpcRequest<SimulationProductTasksInput>): Promise<RpcResponse<SimulationProductTasksPage>>
  /** @param request - Original command, source operation, task revision and exact attempt or no-lease fence.
   * @returns durable cancellation receipt; it never grants general Team mutation authority or starts inference. */
  cancelTask(request: RpcRequest<SimulationProductTaskCancelInput>): Promise<RpcResponse<SimulationProductRequestReceipt>>
  /** @param request - Original command, unknown outbox operation, exact observed attempt count and reason.
   * @returns persistent original grant receipt; grants neither target publication nor model execution. */
  retryOperation(request: RpcRequest<SimulationProductOperationRetryInput>): Promise<RpcResponse<SimulationProductRequestReceipt>>
  /** @param request - Exact bounded registered run identities.
   * @returns independently observed native metrics and scheduling metadata, without acquiring execution. */
  runStatuses(request: RpcRequest<SimulationProductRunStatusesInput>): Promise<RpcResponse<SimulationProductRunStatusesPage>>
  /** @param request - Exact owned run and bounded canonical metadata window. @returns run-owned review hints without task bodies. */
  listTaskReviews(request: RpcRequest<SimulationProductTaskReviewListInput>): Promise<RpcResponse<SimulationProductTaskReviewPage>>
  /** @param request - Original command and canonical attempt/revision.
   * @returns durable original receipt; authentication grants only installed scene review. */
  resolveTaskReview(request: RpcRequest<SimulationProductTaskReviewResolveInput>): Promise<RpcResponse<SimulationProductRequestReceipt>>
  /** @param request - Exact frozen source and bounded lookup/body page.
   * @returns separately authorized original source text or redacted status. */
  inspectSource(request: RpcRequest<SimulationProductSourceInput>): Promise<RpcResponse<SimulationProductSourceInspection>>
  /** @param request - Exact journal filters and metadata/original mode.
   * @returns policy-bound records; original text needs separate permission. */
  /** Preserve original bytes under an explicit whole-record grant without selecting a Native parser. */
  archiveRaw(request: RpcRequest<SimulationProductRawArchiveInput>): Promise<RpcResponse<SimulationProductRawArchivePage>>
  records(request: RpcRequest<SimulationProductRecordsInput>): Promise<RpcResponse<SimulationProductRecordsPage>>
  /** @param request - Exact authorized run and bounded real wait. @returns metadata-only invalidation hint; never opens execution. */
  watch(request: RpcRequest<SimulationProductWatchInput>): Promise<RpcResponse<SimulationProductWatchResult>>
  /**
   * @param request - Exact original product identity and actor-free permitted parameters.
   * @returns durable original checkpoint/recovery request; accepted work outlives its transport waiter.
   */
  checkpoint(request: RpcRequest<SimulationProductCheckpointInput>): Promise<RpcResponse<SimulationProductRequestReceipt>>
  /**
   * @param request - Exact original product identity and actor-free permitted parameters.
   * @returns durable original checkpoint/recovery request; accepted work outlives its transport waiter.
   */
  restore(request: RpcRequest<SimulationProductRestoreInput>): Promise<RpcResponse<SimulationProductRequestReceipt>>
  /**
   * @param request - Exact original product identity and actor-free permitted parameters.
   * @returns original input assignment and separate consumption metadata; private text and attribution are withheld.
   */
  ingress(request: RpcRequest<SimulationProductIngressInput>): Promise<RpcResponse<SimulationProductIngressReceipt>>
  /**
   * @param request - Exact original product identity and actor-free permitted parameters.
   * @returns original input assignment and separate consumption metadata; private text and attribution are withheld.
   */
  ingressRequest(request: RpcRequest<SimulationProductIngressQuery>): Promise<RpcResponse<SimulationProductIngressResult>>
  /** @param request - Actor-free product run and original scheduling selection. @returns read-only owner/precondition observation. */
  control(request: RpcRequest<SimulationProductControlInput>): Promise<RpcResponse<SimulationProductControl>>
  /**
   * @param request - Actor-free product run and original scheduling selection.
   * @returns original scheduling result; current phase is observed separately.
   */
  /** Persist an authenticated original stopping target or explicit clear without starting scheduling. */
  updateRunControl(request: RpcRequest<SimulationProductRunControlInput>): Promise<RpcResponse<SimulationProductRunControlResult>>
  manage(request: RpcRequest<SimulationProductManageInput>): Promise<RpcResponse<SimulationProductManageResult>>
  /**
   * @param request - Actor-free product run and original scheduling selection.
   * @returns original scheduling result; current phase is observed separately.
   */
  managementRequest(request: RpcRequest<SimulationProductManagementInput>): Promise<RpcResponse<SimulationProductManagementResult>>
  /** @param request - Empty actor-free query. @returns bounded installed versioned templates without execution ownership. */
  catalog(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<SimulationProductCatalog>>
  /** @param request - Allowlisted creation draft without a command.
   * @returns resolved allowances or safe field issues; reserves no resources. */
  preflight(request: RpcRequest<SimulationProductPreflightInput>): Promise<RpcResponse<SimulationProductPreflightResult>>
  /**
   * @param request - Original command, template version and permitted parameters.
   * @returns allocated run and original preparation receipt.
   */
  create(request: RpcRequest<SimulationProductCreateInput>): Promise<RpcResponse<SimulationProductRequestReceipt>>
  /** @param request - Original run and explicit preparation command. @returns immutable preparation attempt receipt. */
  prepare(request: RpcRequest<SimulationProductPrepareInput>): Promise<RpcResponse<SimulationProductRequestReceipt>>
  /** @param request - Exact authorized run and bounded revision-pinned metadata page.
   * @returns original receipt metadata without retained inputs or inference. */
  listRequests(request: RpcRequest<SimulationProductRequestsInput>): Promise<RpcResponse<SimulationProductRequestsPage>>
  /** @param request - Exact run and retained original command.
   * @returns original receipt; retry dispatches only backend-stored input and never allocates another identity. */
  retryRequest(request: RpcRequest<SimulationProductRetryRequestInput>): Promise<RpcResponse<SimulationProductRequestReceipt>>
  /** @param request - Exact original command identity. @returns known original outcome or non-authoritative absence. */
  request(request: RpcRequest<SimulationProductRequestInput>): Promise<RpcResponse<SimulationProductRequestResult>>
  /** @param request - Authorized directory query. @returns bounded safe directory page. */
  list(request: RpcRequest<SimulationProductListInput>): Promise<RpcResponse<SimulationProductRunPage>>
  /** @param request - Exact registered product identity. @returns bounded current provider summary, without opening execution ownership. */
  inspect(request: RpcRequest<SimulationProductInspectInput>): Promise<RpcResponse<SimulationProductRunInspection>>
  /** @param request - Registered run and exact collection/filter observation. @returns bounded redacted collection page. */
  browse(request: RpcRequest<SimulationProductBrowseInput>): Promise<RpcResponse<SimulationProductCollectionPage>>
  /** @param request - Exact object, section and optional revision fence. @returns bounded section or authorized object absence. */
  inspectObject(request: RpcRequest<SimulationProductObjectInput>): Promise<RpcResponse<SimulationProductObjectInspection>>
}
