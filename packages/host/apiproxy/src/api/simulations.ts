import type { SimulationProductTasksInput, SimulationProductTasksPage, SimulationProductTaskCancelInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductRequestsInput, SimulationProductRequestsPage, SimulationProductRetryRequestInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductPreflightInput, SimulationProductPreflightResult } from '@clocky/clocky-simulation-product/types'
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
