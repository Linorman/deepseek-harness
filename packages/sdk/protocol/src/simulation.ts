import type { SimulationProductTasksInput, SimulationProductTasksPage, SimulationProductTaskCancelInput } from '@clocky/clocky-simulation-product/types'
import { simulationProductTasksInputSchema, simulationProductTaskCancelInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductTasksPageSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductRequestsInput, SimulationProductRequestsPage, SimulationProductRetryRequestInput } from '@clocky/clocky-simulation-product/types'
import { simulationProductRequestsInputSchema, simulationProductRequestsPageSchema, simulationProductRetryRequestInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductPreflightInput, SimulationProductPreflightResult } from '@clocky/clocky-simulation-product/types'
import { simulationProductPreflightInputSchema, simulationProductPreflightResultSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductOperationRetryInput } from '@clocky/clocky-simulation-product/types'
import { simulationProductOperationRetryInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductRunStatusesInput, SimulationProductRunStatusesPage } from '@clocky/clocky-simulation-product/types'
import { simulationProductRunStatusesInputSchema, simulationProductRunStatusesPageSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductTaskReviewListInput, SimulationProductTaskReviewPage, SimulationProductTaskReviewResolveInput } from '@clocky/clocky-simulation-product/types'
import { simulationProductTaskReviewListInputSchema, simulationProductTaskReviewPageSchema, simulationProductTaskReviewResolveInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductSourceInput, SimulationProductSourceInspection } from '@clocky/clocky-simulation-product/types'
import { simulationProductSourceInputSchema, simulationProductSourceInspectionSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductRecordsInput, SimulationProductRecordsPage } from '@clocky/clocky-simulation-product/types'
import { simulationProductRecordsInputSchema, simulationProductRecordsPageSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductWatchInput, SimulationProductWatchResult } from '@clocky/clocky-simulation-product/types'
import { simulationProductWatchInputSchema, simulationProductWatchResultSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductControlInput, SimulationProductControl, SimulationProductManageInput, SimulationProductManageResult, SimulationProductManagementInput, SimulationProductManagementResult, SimulationProductCheckpointInput, SimulationProductRestoreInput, SimulationProductIngressInput, SimulationProductIngressReceipt, SimulationProductIngressQuery, SimulationProductIngressResult } from '@clocky/clocky-simulation-product/types'
import { simulationProductControlInputSchema, simulationProductControlSchema, simulationProductManageInputSchema, simulationProductManageResultSchema, simulationProductManagementInputSchema, simulationProductManagementResultSchema, simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema, simulationProductIngressInputSchema, simulationProductIngressReceiptSchema, simulationProductIngressQuerySchema, simulationProductIngressResultSchema } from '@clocky/clocky-simulation-product/schema'
/** Simulation SDK selections use wire strings; the product schemas validate and brand identities at ingress. */
import type { z } from 'zod'
import type {
  SimulationProductBrowseInput,
  SimulationProductCatalog,
  SimulationProductCollectionPage,
  SimulationProductCreateInput,
  SimulationProductInspectInput,
  SimulationProductListInput,
  SimulationProductObjectInput,
  SimulationProductObjectInspection,
  SimulationProductPrepareInput,
  SimulationProductRequestInput,
  SimulationProductRequestReceipt,
  SimulationProductRequestResult,
  SimulationProductRunInspection,
  SimulationProductRunPage,
} from '@clocky/clocky-simulation-product/types'
import {
  simulationProductBrowseInputSchema,
  simulationProductCatalogSchema,
  simulationProductCatalogInputSchema,
  simulationProductCollectionPageSchema,
  simulationProductCreateInputSchema,
  simulationProductInspectInputSchema,
  simulationProductListInputSchema,
  simulationProductObjectInputSchema,
  simulationProductObjectInspectionSchema,
  simulationProductPrepareInputSchema,
  simulationProductRequestInputSchema,
  simulationProductRequestReceiptSchema,
  simulationProductRequestResultSchema,
  simulationProductRunInspectionSchema,
  simulationProductRunPageSchema,
} from '@clocky/clocky-simulation-product/schema'

/** Preserve each closed input union while allowing callers to supply opaque wire identities. */
type WireInput<T> = T extends unknown ? {
  readonly [K in keyof T]: K extends 'runIds' ? readonly string[] : K extends 'reference' ? { readonly id: string; readonly revision: number } | Extract<T[K], undefined> : K extends 'runId' | 'id' | 'entityId' | 'decisionId' | 'cursor' | 'commandId' | 'templateId' | 'managementId' | 'checkpointId' | 'ingressId' | 'availableAt' | 'operationId' | 'attemptId'
    ? string | Extract<T[K], undefined> : T[K]
} : never

/** Actor-free parameters for `catalog`; no provider, principal or native spec is accepted. */
export type SimulationCatalogParams = Record<string, never>
/** Complete bounded public result of `catalog`. */
export type SimulationCatalogResult = SimulationProductCatalog
/** Strict parser for `catalog` SDK parameters. */
export const simulationCatalogParamsSchema = simulationProductCatalogInputSchema satisfies z.ZodType<SimulationCatalogParams>
/** Strict public result parser for `catalog`. */
export const simulationCatalogResultSchema = simulationProductCatalogSchema

/** Actor-free parameters for `runs-list`; no provider, principal or native spec is accepted. */
export type SimulationListParams = WireInput<SimulationProductListInput>
/** Complete bounded public result of `runs-list`. */
export type SimulationListResult = SimulationProductRunPage
/** Strict parser for `runs-list` SDK parameters. */
export const simulationListParamsSchema = simulationProductListInputSchema satisfies z.ZodType<SimulationListParams>
/** Strict public result parser for `runs-list`. */
export const simulationListResultSchema = simulationProductRunPageSchema

/** Actor-free parameters for `runs-inspect`; no provider, principal or native spec is accepted. */
export type SimulationInspectParams = WireInput<SimulationProductInspectInput>
/** Complete bounded public result of `runs-inspect`. */
export type SimulationInspectResult = SimulationProductRunInspection
/** Strict parser for `runs-inspect` SDK parameters. */
export const simulationInspectParamsSchema = simulationProductInspectInputSchema satisfies z.ZodType<SimulationInspectParams>
/** Strict public result parser for `runs-inspect`. */
export const simulationInspectResultSchema = simulationProductRunInspectionSchema

/** Actor-free parameters for `collections-list`; no provider, principal or native spec is accepted. */
export type SimulationBrowseParams = WireInput<SimulationProductBrowseInput>
/** Complete bounded public result of `collections-list`. */
export type SimulationBrowseResult = SimulationProductCollectionPage
/** Strict parser for `collections-list` SDK parameters. */
export const simulationBrowseParamsSchema = simulationProductBrowseInputSchema satisfies z.ZodType<SimulationBrowseParams>
/** Strict public result parser for `collections-list`. */
export const simulationBrowseResultSchema = simulationProductCollectionPageSchema

/** Actor-free parameters for `objects-inspect`; no provider, principal or native spec is accepted. */
export type SimulationObjectParams = WireInput<SimulationProductObjectInput>
/** Complete bounded public result of `objects-inspect`. */
export type SimulationObjectResult = SimulationProductObjectInspection
/** Strict parser for `objects-inspect` SDK parameters. */
export const simulationObjectParamsSchema = simulationProductObjectInputSchema satisfies z.ZodType<SimulationObjectParams>
/** Strict public result parser for `objects-inspect`. */
export const simulationObjectResultSchema = simulationProductObjectInspectionSchema

/** Allowlisted creation draft; preflight allocates no command or run. */
export type SimulationPreflightParams = WireInput<SimulationProductPreflightInput>
/** Resolved immutable allowances or safe field issues at the current observation. */
export type SimulationPreflightResult = SimulationProductPreflightResult
/** Strict actor-free preflight input parser. */
export const simulationPreflightParamsSchema = simulationProductPreflightInputSchema satisfies z.ZodType<SimulationPreflightParams>
/** Strict bounded preflight result parser. */
export const simulationPreflightResultSchema = simulationProductPreflightResultSchema

/** Actor-free parameters for `runs-create`; no provider, principal or native spec is accepted. */
export type SimulationCreateParams = WireInput<SimulationProductCreateInput>
/** Complete bounded public result of `runs-create`. */
export type SimulationCreateResult = SimulationProductRequestReceipt
/** Strict parser for `runs-create` SDK parameters. */
export const simulationCreateParamsSchema = simulationProductCreateInputSchema satisfies z.ZodType<SimulationCreateParams>
/** Strict public result parser for `runs-create`. */
export const simulationCreateResultSchema = simulationProductRequestReceiptSchema

/** Actor-free parameters for `runs-prepare`; no provider, principal or native spec is accepted. */
export type SimulationPrepareParams = WireInput<SimulationProductPrepareInput>
/** Complete bounded public result of `runs-prepare`. */
export type SimulationPrepareResult = SimulationProductRequestReceipt
/** Strict parser for `runs-prepare` SDK parameters. */
export const simulationPrepareParamsSchema = simulationProductPrepareInputSchema satisfies z.ZodType<SimulationPrepareParams>
/** Strict public result parser for `runs-prepare`. */
export const simulationPrepareResultSchema = simulationProductRequestReceiptSchema

/** Exact authorized run and bounded immutable receipt page; command inputs are withheld. */
export type SimulationRequestsParams = WireInput<SimulationProductRequestsInput>
/** Revision-pinned original receipt metadata for browser/process restart discovery. */
export type SimulationRequestsResult = SimulationProductRequestsPage
/** Exact run and original command; the caller supplies no replacement input. */
export type SimulationRetryRequestParams = WireInput<SimulationProductRetryRequestInput>
/** Original accepted or terminal receipt; retained commands are never assigned fresh identities. */
export type SimulationRetryRequestResult = SimulationProductRequestReceipt
/** Strict actor-free original request metadata selector. */
export const simulationRequestsParamsSchema = simulationProductRequestsInputSchema satisfies z.ZodType<SimulationRequestsParams>
/** Strict bounded original receipt page parser. */
export const simulationRequestsResultSchema = simulationProductRequestsPageSchema
/** Strict retained-original retry selector; changed or arbitrary input fields reject. */
export const simulationRetryRequestParamsSchema = simulationProductRetryRequestInputSchema satisfies z.ZodType<SimulationRetryRequestParams>
/** Strict original administrative receipt parser. */
export const simulationRetryRequestResultSchema = simulationProductRequestReceiptSchema

/** Actor-free parameters for `requests-get`; no provider, principal or native spec is accepted. */
export type SimulationRequestParams = WireInput<SimulationProductRequestInput>
/** Complete bounded public result of `requests-get`. */
export type SimulationRequestResult = SimulationProductRequestResult
/** Strict parser for `requests-get` SDK parameters. */
export const simulationRequestParamsSchema = simulationProductRequestInputSchema satisfies z.ZodType<SimulationRequestParams>
/** Strict public result parser for `requests-get`. */
export const simulationRequestResultSchema = simulationProductRequestResultSchema

/** Read current scheduling ownership and preconditions without opening or advancing a run. */
export type SimulationControlParams = WireInput<SimulationProductControlInput>
/** Bounded public result of `runs-control`. */
export type SimulationControlResult = SimulationProductControl
/** Strict actor-free parser for `runs-control` parameters. */
export const simulationControlParamsSchema = simulationProductControlInputSchema satisfies z.ZodType<SimulationControlParams>
/** Strict redacted parser for `runs-control` results. */
export const simulationControlResultSchema = simulationProductControlSchema

/** Submit an original scheduling intent; exact retries retain its result without undoing later intent. */
export type SimulationManageParams = WireInput<SimulationProductManageInput>
/** Bounded public result of `runs-manage`. */
export type SimulationManageResult = SimulationProductManageResult
/** Strict actor-free parser for `runs-manage` parameters. */
export const simulationManageParamsSchema = simulationProductManageInputSchema satisfies z.ZodType<SimulationManageParams>
/** Strict redacted parser for `runs-manage` results. */
export const simulationManageResultSchema = simulationProductManageResultSchema

/** Query an original scheduling outcome; absence does not establish failure. */
export type SimulationManagementParams = WireInput<SimulationProductManagementInput>
/** Bounded public result of `management-get`. */
export type SimulationManagementResult = SimulationProductManagementResult
/** Strict actor-free parser for `management-get` parameters. */
export const simulationManagementParamsSchema = simulationProductManagementInputSchema satisfies z.ZodType<SimulationManagementParams>
/** Strict redacted parser for `management-get` results. */
export const simulationManagementResultSchema = simulationProductManagementResultSchema

/** Request a full checkpoint; accepted work outlives its waiter and remains paused after completion. */
export type SimulationCheckpointParams = WireInput<SimulationProductCheckpointInput>
/** Bounded public result of `runs-checkpoint`. */
export type SimulationCheckpointResult = SimulationProductRequestReceipt
/** Strict actor-free parser for `runs-checkpoint` parameters. */
export const simulationCheckpointParamsSchema = simulationProductCheckpointInputSchema satisfies z.ZodType<SimulationCheckpointParams>
/** Strict redacted parser for `runs-checkpoint` results. */
export const simulationCheckpointResultSchema = simulationProductRequestReceiptSchema

/** Verify checkpoint history and current suffix, then acquire a paused owner without rollback or inference. */
export type SimulationRestoreParams = WireInput<SimulationProductRestoreInput>
/** Bounded public result of `runs-restore`. */
export type SimulationRestoreResult = SimulationProductRequestReceipt
/** Strict actor-free parser for `runs-restore` parameters. */
export const simulationRestoreParamsSchema = simulationProductRestoreInputSchema satisfies z.ZodType<SimulationRestoreParams>
/** Strict redacted parser for `runs-restore` results. */
export const simulationRestoreResultSchema = simulationProductRequestReceiptSchema

/** Submit one attributed entity input with its original identity and exact simulated time. */
export type SimulationIngressParams = WireInput<SimulationProductIngressInput>
/** Bounded public result of `runs-ingress`. */
export type SimulationIngressResult = SimulationProductIngressReceipt
/** Strict actor-free parser for `runs-ingress` parameters. */
export const simulationIngressParamsSchema = simulationProductIngressInputSchema satisfies z.ZodType<SimulationIngressParams>
/** Strict redacted parser for `runs-ingress` results. */
export const simulationIngressResultSchema = simulationProductIngressReceiptSchema

/** Query original input assignment and consumption independently of scheduling. */
export type SimulationIngressRequestParams = WireInput<SimulationProductIngressQuery>
/** Bounded public result of `ingress-get`. */
export type SimulationIngressRequestResult = SimulationProductIngressResult
/** Strict actor-free parser for `ingress-get` parameters. */
export const simulationIngressRequestParamsSchema = simulationProductIngressQuerySchema satisfies z.ZodType<SimulationIngressRequestParams>
/** Strict redacted parser for `ingress-get` results. */
export const simulationIngressRequestResultSchema = simulationProductIngressResultSchema

/** Exact run and optional bounded real-time wait; no execution authority is requested. */
export type SimulationWatchParams = WireInput<SimulationProductWatchInput>
/** Metadata-only invalidation result, independent of simulation time. */
export type SimulationWatchResult = SimulationProductWatchResult
/** Strict actor-free watch parameters. */
export const simulationWatchParamsSchema = simulationProductWatchInputSchema satisfies z.ZodType<SimulationWatchParams>
/** Strict public invalidation hints. */
export const simulationWatchResultSchema = simulationProductWatchResultSchema

/** Authenticated Simulation methods; inspection never opens native execution ownership. */
export interface SimulationSdkRequestMap {
  'simulation/sources-inspect': { params: SimulationSourceParams; result: SimulationSourceResult }
  'simulation/records-list': { params: SimulationRecordsParams; result: SimulationRecordsResult }
  'simulation/changes-watch': { params: SimulationWatchParams; result: SimulationWatchResult }
  'simulation/runs-control': { params: SimulationControlParams; result: SimulationControlResult }
  'simulation/runs-manage': { params: SimulationManageParams; result: SimulationManageResult }
  'simulation/management-get': { params: SimulationManagementParams; result: SimulationManagementResult }
  'simulation/runs-checkpoint': { params: SimulationCheckpointParams; result: SimulationCheckpointResult }
  'simulation/runs-restore': { params: SimulationRestoreParams; result: SimulationRestoreResult }
  'simulation/runs-ingress': { params: SimulationIngressParams; result: SimulationIngressResult }
  'simulation/tasks-list': { params: SimulationTasksParams; result: SimulationTasksResult }
  'simulation/tasks-cancel': { params: SimulationTaskCancelParams; result: SimulationTaskCancelResult }
  'simulation/task-reviews-list': { params: SimulationTaskReviewListParams; result: SimulationTaskReviewListResult }
  'simulation/task-reviews-resolve': { params: SimulationTaskReviewResolveParams; result: SimulationTaskReviewResolveResult }
  'simulation/ingress-get': { params: SimulationIngressRequestParams; result: SimulationIngressRequestResult }
  'simulation/catalog': { params: SimulationCatalogParams; result: SimulationCatalogResult }
  'simulation/operation-retry': { params: SimulationOperationRetryParams; result: SimulationOperationRetryResult }
  'simulation/runs-statuses': { params: SimulationRunStatusesParams; result: SimulationRunStatusesResult }
  'simulation/runs-list': { params: SimulationListParams; result: SimulationListResult }
  'simulation/runs-inspect': { params: SimulationInspectParams; result: SimulationInspectResult }
  'simulation/collections-list': { params: SimulationBrowseParams; result: SimulationBrowseResult }
  'simulation/objects-inspect': { params: SimulationObjectParams; result: SimulationObjectResult }
  'simulation/runs-preflight': { params: SimulationPreflightParams; result: SimulationPreflightResult }
  'simulation/runs-create': { params: SimulationCreateParams; result: SimulationCreateResult }
  'simulation/runs-prepare': { params: SimulationPrepareParams; result: SimulationPrepareResult }
  'simulation/requests-list': { params: SimulationRequestsParams; result: SimulationRequestsResult }
  'simulation/requests-retry': { params: SimulationRetryRequestParams; result: SimulationRetryRequestResult }
  'simulation/requests-get': { params: SimulationRequestParams; result: SimulationRequestResult }
}

/** Exact public journal selection; bodies require separate whole-run historical access. */
export type SimulationRecordsParams = WireInput<SimulationProductRecordsInput>
/** Bounded journal page, preserving sequence references and Unicode text part order. */
export type SimulationRecordsResult = SimulationProductRecordsPage
/** Strict SDK record-query parser. */
export const simulationRecordsParamsSchema = simulationProductRecordsInputSchema satisfies z.ZodType<SimulationRecordsParams>
/** Strict policy-tagged record-result parser. */
export const simulationRecordsResultSchema = simulationProductRecordsPageSchema

/** Frozen decision source selection; references grant no body or Team authority. */
export type SimulationSourceParams = WireInput<SimulationProductSourceInput>
/** Bounded original source text or explicit redacted/lookup status. */
export type SimulationSourceResult = SimulationProductSourceInspection
/** Strict exact-source SDK selector. */
export const simulationSourceParamsSchema = simulationProductSourceInputSchema satisfies z.ZodType<SimulationSourceParams>
/** Strict text-only source response parser. */
export const simulationSourceResultSchema = simulationProductSourceInspectionSchema

/** Bounded canonical metadata selection, without reviewer or Team grant fields. */
export type SimulationTaskReviewListParams = WireInput<SimulationProductTaskReviewListInput>
/** Original run-owned task metadata and revalidated action hints. */
export type SimulationTaskReviewListResult = SimulationProductTaskReviewPage
/** Exact immutable scene review command and canonical revision. */
export type SimulationTaskReviewResolveParams = WireInput<SimulationProductTaskReviewResolveInput>
/** Persistent original command fact, queried through requests-get after response loss. */
export type SimulationTaskReviewResolveResult = SimulationProductRequestReceipt
/** Browser-safe strict SDK review selection. */
export const simulationTaskReviewListParamsSchema = simulationProductTaskReviewListInputSchema satisfies
  z.ZodType<SimulationTaskReviewListParams>
/** Complete metadata result parser. */
export const simulationTaskReviewListResultSchema = simulationProductTaskReviewPageSchema
/** Strict original review intent parser. */
export const simulationTaskReviewResolveParamsSchema = simulationProductTaskReviewResolveInputSchema satisfies
  z.ZodType<SimulationTaskReviewResolveParams>
/** Strict original operation result parser. */
export const simulationTaskReviewResolveResultSchema = simulationProductRequestReceiptSchema

/** One exact bounded batch of registered run identities; status reads never select a native owner. */
export type SimulationRunStatusesParams = WireInput<SimulationProductRunStatusesInput>
/** Independent authorized native metrics, scenario and runtime scheduling observations. */
export type SimulationRunStatusesResult = SimulationProductRunStatusesPage
/** Strict wire batch parsing preserves opaque caller identities without accepting actors or configuration. */
export const simulationRunStatusesParamsSchema = simulationProductRunStatusesInputSchema satisfies z.ZodType<SimulationRunStatusesParams>
/** Bounded result parser keeps missing and unavailable independent from observed zero usage. */
export const simulationRunStatusesResultSchema = simulationProductRunStatusesPageSchema

/** Original bounded outbox-retry intent; target and attempt count are never substituted by current observations. */
export type SimulationOperationRetryParams = WireInput<SimulationProductOperationRetryInput>
/** Original persisted grant result; a successful grant never implies publication or resumed inference. */
export type SimulationOperationRetryResult = SimulationProductRequestReceipt
/** Strict actor-free parameters for explicit operation retry authorization. */
export const simulationOperationRetryParamsSchema = simulationProductOperationRetryInputSchema satisfies
  z.ZodType<SimulationOperationRetryParams>
/** Strict original family and receipt parser; requests-get separately returns the immutable intent. */
export const simulationOperationRetryResultSchema = simulationProductRequestReceiptSchema

/** Bounded run-owned task metadata; Team bodies and general mutation authority are omitted. */
export type SimulationTasksParams = WireInput<SimulationProductTasksInput>
/** Canonical current task and exact cancellation hints. */
export type SimulationTasksResult = SimulationProductTasksPage
/** Original cancellation command with a precise current-attempt or no-lease fence. */
export type SimulationTaskCancelParams = WireInput<SimulationProductTaskCancelInput>
/** Durable original cancellation receipt; cancellation completion is observed separately. */
export type SimulationTaskCancelResult = SimulationProductRequestReceipt
/** Strict actor-free run-owned task selector. */
export const simulationTasksParamsSchema = simulationProductTasksInputSchema satisfies z.ZodType<SimulationTasksParams>
/** Strict metadata-only canonical task response. */
export const simulationTasksResultSchema = simulationProductTasksPageSchema
/** Strict original cancellation intent; null is an explicit no-lease fence. */
export const simulationTaskCancelParamsSchema = simulationProductTaskCancelInputSchema satisfies z.ZodType<SimulationTaskCancelParams>
/** Original persistent cancellation fact parser. */
export const simulationTaskCancelResultSchema = simulationProductRequestReceiptSchema
