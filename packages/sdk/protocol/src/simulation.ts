import type { SimulationProductRawArchiveInput, SimulationProductRawArchivePage } from '@clocky/clocky-simulation-product/types'
import { simulationProductRawArchiveInputSchema, simulationProductRawArchivePageSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductRunControlInput, SimulationProductRunControlResult } from '@clocky/clocky-simulation-product/types'
import { simulationProductRunControlInputSchema, simulationProductRunControlResultSchema } from '@clocky/clocky-simulation-product/schema'
import {
  simulationProductWorldBranchInputSchema,
  simulationProductWorldBranchResultSchema,
  simulationProductWorldBranchReadInputSchema,
  simulationProductWorldCausalInputSchema,
  simulationProductWorldCausalResultSchema,
  simulationProductWorldCompareInputSchema,
  simulationProductWorldCompareResultSchema,
} from '@clocky/clocky-simulation-product/experiment-schema'
import type { SimulationProductBackupExportResult } from '@clocky/clocky-simulation-product/types'
import { simulationProductBackupExportInputSchema, simulationProductBackupExportResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRetentionPreviewInputSchema, simulationProductRetentionExecuteInputSchema, simulationProductRetentionReadInputSchema, simulationProductRetentionRecordsInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRetentionPlanSchema, simulationProductRetentionResultSchema, simulationProductRetentionRecordsResultSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductRetentionPlan, SimulationProductRetentionResult, SimulationProductRetentionRecordsResult } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductGenerationResult } from '@clocky/clocky-simulation-product/types'
import { simulationProductGenerationRequestSchema, simulationProductGenerationReadSchema, simulationProductGenerationTransitionSchema, simulationProductGenerationPersonaDraftSchema, simulationProductGenerationResultSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductRebuildIndexInput, SimulationProductRebuildIndexResult } from '@clocky/clocky-simulation-product/types'
import { simulationProductRebuildIndexInputSchema, simulationProductRebuildIndexResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductCalendarCommandInputSchema, simulationProductCalendarCommandResultSchema, simulationProductCalendarCancelSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductCalendarInputSchema, simulationProductCalendarPreviewSchema, simulationProductCalendarSubmitSchema, simulationProductCalendarReceiptSchema } from '@clocky/clocky-simulation-product/schema'
import { scenarioDraftReadSchema, scenarioDraftSaveSchema, scenarioDraftReadResultSchema, scenarioDraftSaveResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldManagementFieldsInputSchema, simulationProductWorldManagementDraftSchema, simulationProductWorldManagementSubmitInputSchema, simulationProductWorldManagementFieldsSchema, simulationProductWorldManagementPreviewSchema } from '@clocky/clocky-simulation-product/world-management-schema'
import type { SimulationProductWorldDomainInput, SimulationProductWorldDomainResult } from '@clocky/clocky-simulation-product/world-read-types'
import { simulationProductWorldDomainInputSchema, simulationProductWorldDomainResultSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import type { SimulationProductWorldCasesInput, SimulationProductWorldCaseInput, SimulationProductWorldCaseCancelInput, SimulationProductWorldCasesPage, SimulationProductWorldCaseInspection } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductWorldPreflightInput, SimulationProductWorldPreflightResult,
  SimulationProductWorldCreateInput, SimulationProductWorldExportResult } from '@clocky/clocky-simulation-product/types'
import { simulationProductWorldPreflightInputSchema, simulationProductWorldPreflightResultSchema,
  simulationProductWorldCreateInputSchema, simulationProductWorldExportResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldCasesInputSchema, simulationProductWorldCaseInputSchema, simulationProductWorldCaseCancelInputSchema, simulationProductWorldCasesPageSchema, simulationProductWorldCaseInspectionSchema } from '@clocky/clocky-simulation-product/schema'
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
  readonly [K in keyof T]: K extends 'runIds' ? readonly string[] : K extends 'reference' ? { readonly id: string; readonly revision: number } | Extract<T[K], undefined> : K extends 'runId' | 'id' | 'entityId' | 'decisionId' | 'cursor' | 'commandId' | 'templateId' | 'managementId' | 'checkpointId' | 'ingressId' | 'availableAt' | 'operationId' | 'attemptId' | 'requestId' | 'readVersion'
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
/** Whole-run personnel and complete-or-unavailable canonical Team history metadata. */
export type { SimulationProductPeopleCounts as SimulationPeopleCounts,
  SimulationProductPeopleHistory as SimulationPeopleHistory } from '@clocky/clocky-simulation-product/types'
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
/** Portable actor-free World creation draft; installed runtime resolution stays with the product owner. */
export type SimulationWorldPreflightParams = WireInput<SimulationProductWorldPreflightInput>
/** Current bounded World preview or strict field diagnostics. */
export type SimulationWorldPreflightResult = SimulationProductWorldPreflightResult
/** Original World definition, command and preflight identity. */
export type SimulationWorldCreateParams = WireInput<SimulationProductWorldCreateInput>
/** Durable World creation receipt; creation never starts inference. */
export type SimulationWorldCreateResult = SimulationProductRequestReceipt
/** Original World preparation command without replacement definition or runtime configuration. */
export type SimulationWorldPrepareParams = WireInput<SimulationProductPrepareInput>
/** Durable World preparation receipt; explicit start remains separate. */
export type SimulationWorldPrepareResult = SimulationProductRequestReceipt
/** Authorized original run whose portable definition is being exported. */
export type SimulationWorldExportParams = WireInput<SimulationProductControlInput>
/** Portable creation input bound to the selected run, without private runtime history. */
export type SimulationWorldExportResult = SimulationProductWorldExportResult
/** Strict World preflight draft parser. */
export const simulationWorldPreflightParamsSchema = simulationProductWorldPreflightInputSchema satisfies
  z.ZodType<SimulationWorldPreflightParams>
/** Strict World preview and diagnostics parser. */
export const simulationWorldPreflightResultSchema = simulationProductWorldPreflightResultSchema
/** Strict immutable World creation input parser. */
export const simulationWorldCreateParamsSchema = simulationProductWorldCreateInputSchema satisfies z.ZodType<SimulationWorldCreateParams>
/** Strict original World creation receipt parser. */
export const simulationWorldCreateResultSchema = simulationProductRequestReceiptSchema
/** Strict original World preparation input parser. */
export const simulationWorldPrepareParamsSchema = simulationProductPrepareInputSchema satisfies z.ZodType<SimulationWorldPrepareParams>
/** Strict original World preparation receipt parser. */
export const simulationWorldPrepareResultSchema = simulationProductRequestReceiptSchema
/** Strict authorized World export selection parser. */
export const simulationWorldExportParamsSchema = simulationProductControlInputSchema satisfies z.ZodType<SimulationWorldExportParams>
/** Strict portable World export result parser. */
export const simulationWorldExportResultSchema = simulationProductWorldExportResultSchema
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

/** Strict wire parameters for authenticated personnel fields; authority remains server-owned. */
export type SimulationWorldManagementFieldsParams = z.input<typeof simulationProductWorldManagementFieldsInputSchema>
/** Original bounded fields result. */
export type SimulationWorldManagementFieldsResult = z.output<typeof simulationProductWorldManagementFieldsSchema>
/** Validate the complete original fields selection. */
export const simulationWorldManagementFieldsParamsSchema = simulationProductWorldManagementFieldsInputSchema
/** Validate the complete original fields result. */
export const simulationWorldManagementFieldsResultSchema = simulationProductWorldManagementFieldsSchema

/** Strict wire parameters for authenticated personnel preview; authority remains server-owned. */
export type SimulationWorldManagementPreviewParams = z.input<typeof simulationProductWorldManagementDraftSchema>
/** Original bounded preview result. */
export type SimulationWorldManagementPreviewResult = z.output<typeof simulationProductWorldManagementPreviewSchema>
/** Validate the complete original preview selection. */
export const simulationWorldManagementPreviewParamsSchema = simulationProductWorldManagementDraftSchema
/** Validate the complete original preview result. */
export const simulationWorldManagementPreviewResultSchema = simulationProductWorldManagementPreviewSchema

/** Strict wire parameters for authenticated personnel submit; authority remains server-owned. */
export type SimulationWorldManagementSubmitParams = z.input<typeof simulationProductWorldManagementSubmitInputSchema>
/** Original bounded submit result. */
export type SimulationWorldManagementSubmitResult = z.output<typeof simulationProductRequestReceiptSchema>
/** Validate the complete original submit selection. */
export const simulationWorldManagementSubmitParamsSchema = simulationProductWorldManagementSubmitInputSchema
/** Validate the complete original submit result. */
export const simulationWorldManagementSubmitResultSchema = simulationProductRequestReceiptSchema

/** Authenticated Simulation methods; inspection never opens native execution ownership. */
export interface SimulationSdkRequestMap {
  'simulation/world-calendar-retain': { params: z.input<typeof simulationProductCalendarSubmitSchema>; result: z.output<typeof simulationProductCalendarCommandResultSchema> }
  'simulation/world-calendar-command': { params: z.input<typeof simulationProductCalendarCommandInputSchema>; result: z.output<typeof simulationProductCalendarCommandResultSchema> }
  'simulation/world-calendar-cancel': { params: z.input<typeof simulationProductCalendarCancelSchema>; result: z.output<typeof simulationProductCalendarCommandResultSchema> }

  'simulation/world-calendar-preview': { params: z.input<typeof simulationProductCalendarInputSchema>; result: z.output<typeof simulationProductCalendarPreviewSchema> }
  'simulation/world-calendar-submit': { params: z.input<typeof simulationProductCalendarSubmitSchema>; result: z.output<typeof simulationProductCalendarReceiptSchema> }

  'simulation/world-management-fields': { params: SimulationWorldManagementFieldsParams; result: SimulationWorldManagementFieldsResult }
  'simulation/world-management-preview': { params: SimulationWorldManagementPreviewParams; result: SimulationWorldManagementPreviewResult }
  'simulation/world-management-submit': { params: SimulationWorldManagementSubmitParams; result: SimulationWorldManagementSubmitResult }
  'simulation/world-domain-read': { params: SimulationWorldDomainParams; result: SimulationWorldDomainResult }
  'simulation/world-case-cancel': { params: SimulationWorldCaseCancelParams; result: SimulationWorldCaseCancelResult }
  'simulation/draft-read': { params: SimulationDraftReadParams; result: SimulationDraftReadResult }
  'simulation/draft-save': { params: SimulationDraftSaveParams; result: SimulationDraftSaveResult }
  'simulation/world-preflight': { params: SimulationWorldPreflightParams; result: SimulationWorldPreflightResult }
  'simulation/world-create': { params: SimulationWorldCreateParams; result: SimulationWorldCreateResult }
  'simulation/world-prepare': { params: SimulationWorldPrepareParams; result: SimulationWorldPrepareResult }
  'simulation/world-export': { params: SimulationWorldExportParams; result: SimulationWorldExportResult }
  'simulation/world-case-inspect': { params: SimulationWorldCaseParams; result: SimulationWorldCaseResult }
  'simulation/world-cases-list': { params: SimulationWorldCasesParams; result: SimulationWorldCasesResult }
  'simulation/sources-inspect': { params: SimulationSourceParams; result: SimulationSourceResult }
  'simulation/raw-archive': { params: SimulationRawArchiveParams; result: SimulationRawArchiveResult }
  'simulation/records-list': { params: SimulationRecordsParams; result: SimulationRecordsResult }
  'simulation/changes-watch': { params: SimulationWatchParams; result: SimulationWatchResult }
  'simulation/runs-control': { params: SimulationControlParams; result: SimulationControlResult }
  'simulation/runs-run-control': { params: SimulationRunControlParams; result: SimulationRunControlResult }
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
  'simulation/world-branch': { params: SimulationWorldBranchParams; result: SimulationWorldBranchResult }
  'simulation/world-branch-read': { params: SimulationWorldBranchReadParams; result: SimulationWorldBranchResult }
  'simulation/world-causal': { params: SimulationWorldCausalParams; result: SimulationWorldCausalResult }
  'simulation/world-compare': { params: SimulationWorldCompareParams; result: SimulationWorldCompareResult }
  'simulation/backup-export': { params: SimulationBackupExportParams; result: SimulationBackupExportResult }
  'simulation/retention-preview': { params: SimulationRetentionPreviewParams; result: SimulationRetentionPlan }
  'simulation/retention-execute': { params: SimulationRetentionExecuteParams; result: SimulationRetentionResult }
  'simulation/retention-read': { params: SimulationRetentionReadParams; result: SimulationRetentionResult }
  'simulation/retention-records': { params: SimulationRetentionRecordsParams; result: SimulationRetentionRecordsResult }
  'simulation/generation-request': { params: SimulationGenerationRequestParams; result: SimulationGenerationResult }
  'simulation/generation-read': { params: SimulationGenerationReadParams; result: SimulationGenerationResult }
  'simulation/generation-execute': { params: SimulationGenerationExecuteParams; result: SimulationGenerationResult }
  'simulation/generation-transition': { params: SimulationGenerationTransitionParams; result: SimulationGenerationResult }
  'simulation/generation-persona-draft': { params: SimulationGenerationPersonaDraftParams; result: SimulationGenerationResult }
  'simulation/index-rebuild': { params: SimulationProductRebuildIndexInput; result: SimulationProductRebuildIndexResult }
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

/** Actor-free original World selection. */
export type SimulationWorldCasesParams = WireInput<SimulationProductWorldCasesInput>
/** Strict bounded original World response. */
export type SimulationWorldCasesResult = SimulationProductWorldCasesPage
/** Parse only original selection fields. */
export const simulationWorldCasesParamsSchema = simulationProductWorldCasesInputSchema satisfies z.ZodType<SimulationWorldCasesParams>
/** Refuse unknown fields and protocol variants. */
export const simulationWorldCasesResultSchema = simulationProductWorldCasesPageSchema

/** Actor-free original World selection. */
export type SimulationWorldCaseParams = WireInput<SimulationProductWorldCaseInput>
/** Strict bounded case response; committed business references belong to result.payload, separate from outcome.kind. */
export type SimulationWorldCaseResult = SimulationProductWorldCaseInspection
/** Parse only original selection fields. */
export const simulationWorldCaseParamsSchema = simulationProductWorldCaseInputSchema satisfies z.ZodType<SimulationWorldCaseParams>
/** Validate common JSON result payloads and original hiring identities when a hiring reservation is present. */
export const simulationWorldCaseResultSchema = simulationProductWorldCaseInspectionSchema

/** Actor-free original World selection. */
export type SimulationWorldCaseCancelParams = WireInput<SimulationProductWorldCaseCancelInput>
/** Strict bounded original World response. */
export type SimulationWorldCaseCancelResult = SimulationProductRequestReceipt
/** Parse only original selection fields. */
export const simulationWorldCaseCancelParamsSchema = simulationProductWorldCaseCancelInputSchema satisfies
  z.ZodType<SimulationWorldCaseCancelParams>
/** Refuse unknown fields and protocol variants. */
export const simulationWorldCaseCancelResultSchema = simulationProductRequestReceiptSchema

/** Exact bounded domain selection; reads never restore or activate execution. */
export type SimulationWorldDomainParams = WireInput<SimulationProductWorldDomainInput>
/** Independently disclosed facts from one Native prefix, bound to the original query. */
export type SimulationWorldDomainResult = SimulationProductWorldDomainResult
/** Strict parameters shared with Host domain admission. */
export const simulationWorldDomainParamsSchema = simulationProductWorldDomainInputSchema satisfies z.ZodType<SimulationWorldDomainParams>
/** Strict domain result, including coverage and original selection. */
export const simulationWorldDomainResultSchema = simulationProductWorldDomainResultSchema

/** Original private draft read parameters. */
export type SimulationDraftReadParams = z.input<typeof scenarioDraftReadSchema>
/** Complete private draft read response. */
export type SimulationDraftReadResult = z.output<typeof scenarioDraftReadResultSchema>
/** Strict draft read request parser. */
export const simulationDraftReadParamsSchema: typeof scenarioDraftReadSchema = scenarioDraftReadSchema
/** Strict draft read response parser. */
export const simulationDraftReadResultSchema: typeof scenarioDraftReadResultSchema = scenarioDraftReadResultSchema
/** Original private draft save parameters. */
export type SimulationDraftSaveParams = z.input<typeof scenarioDraftSaveSchema>
/** Complete private draft save response. */
export type SimulationDraftSaveResult = z.output<typeof scenarioDraftSaveResultSchema>
/** Strict draft save request parser. */
export const simulationDraftSaveParamsSchema: typeof scenarioDraftSaveSchema = scenarioDraftSaveSchema
/** Strict draft save response parser. */
export const simulationDraftSaveResultSchema: typeof scenarioDraftSaveResultSchema = scenarioDraftSaveResultSchema

export { simulationProductCalendarInputSchema, simulationProductCalendarPreviewSchema,
  simulationProductCalendarSubmitSchema, simulationProductCalendarReceiptSchema }

/** Complete strict calendar preview parameters. */
export type SimulationCalendarPreviewParams = z.input<typeof simulationProductCalendarInputSchema>
/** Complete strict calendar submit parameters. */
export type SimulationCalendarSubmitParams = z.input<typeof simulationProductCalendarSubmitSchema>

/** Exact inert calendar preview response. */
export type SimulationCalendarPreviewResult = z.output<typeof simulationProductCalendarPreviewSchema>
/** Exact durable calendar acceptance response. */
export type SimulationCalendarSubmitResult = z.output<typeof simulationProductCalendarReceiptSchema>

/** Original calendar command lookup or latest-author recovery request. */
export type SimulationCalendarCommandParams = z.input<typeof simulationProductCalendarCommandInputSchema>
/** Original exact calendar cancellation selector. */
export type SimulationCalendarCancelParams = z.input<typeof simulationProductCalendarCancelSchema>
/** Author-scoped original quote and independent Native execution outcome. */
export type SimulationCalendarCommandResult = z.output<typeof simulationProductCalendarCommandResultSchema>
export { simulationProductCalendarCommandInputSchema, simulationProductCalendarCommandResultSchema, simulationProductCalendarCancelSchema }

/** SDK rebuild parameters retain their exact source revision. */
export const simulationRebuildIndexParamsSchema = simulationProductRebuildIndexInputSchema
/** SDK rebuild results contain no journal bodies. */
export const simulationRebuildIndexResultSchema = simulationProductRebuildIndexResultSchema
/** Exact source selection. */
export type SimulationRebuildIndexParams = SimulationProductRebuildIndexInput
/** Published derived source identity. */
export type SimulationRebuildIndexResult = SimulationProductRebuildIndexResult

/** Exact original generation request input. */
export const simulationGenerationRequestParamsSchema = simulationProductGenerationRequestSchema
/** Wire selection for explicit generation request. */
export type SimulationGenerationRequestParams = z.input<typeof simulationGenerationRequestParamsSchema>

/** Exact original generation read input. */
export const simulationGenerationReadParamsSchema = simulationProductGenerationReadSchema
/** Wire selection for explicit generation read. */
export type SimulationGenerationReadParams = z.input<typeof simulationGenerationReadParamsSchema>

/** Exact original generation execute input. */
export const simulationGenerationExecuteParamsSchema = simulationProductGenerationReadSchema
/** Wire selection for explicit generation execute. */
export type SimulationGenerationExecuteParams = z.input<typeof simulationGenerationExecuteParamsSchema>

/** Exact original generation transition input. */
export const simulationGenerationTransitionParamsSchema = simulationProductGenerationTransitionSchema
/** Wire selection for explicit generation transition. */
export type SimulationGenerationTransitionParams = z.input<typeof simulationGenerationTransitionParamsSchema>

/** Exact original generation persona-draft input. */
export const simulationGenerationPersonaDraftParamsSchema = simulationProductGenerationPersonaDraftSchema
/** Wire selection for explicit generation persona-draft. */
export type SimulationGenerationPersonaDraftParams = z.input<typeof simulationGenerationPersonaDraftParamsSchema>

/** Strict retained private generation result. */
export const simulationGenerationResultSchema = simulationProductGenerationResultSchema
/** Original generation state without invented usage or effects. */
export type SimulationGenerationResult = SimulationProductGenerationResult

/** Original full-history retention preview selection. */
export const simulationRetentionPreviewParamsSchema = simulationProductRetentionPreviewInputSchema
/** Wire input for explicit retention preview. */
export type SimulationRetentionPreviewParams = z.input<typeof simulationRetentionPreviewParamsSchema>

/** Original full-history retention execute selection. */
export const simulationRetentionExecuteParamsSchema = simulationProductRetentionExecuteInputSchema
/** Wire input for explicit retention execute. */
export type SimulationRetentionExecuteParams = z.input<typeof simulationRetentionExecuteParamsSchema>

/** Original full-history retention read selection. */
export const simulationRetentionReadParamsSchema = simulationProductRetentionReadInputSchema
/** Wire input for explicit retention read. */
export type SimulationRetentionReadParams = z.input<typeof simulationRetentionReadParamsSchema>

/** Original full-history retention records selection. */
export const simulationRetentionRecordsParamsSchema = simulationProductRetentionRecordsInputSchema
/** Wire input for explicit retention records. */
export type SimulationRetentionRecordsParams = z.input<typeof simulationRetentionRecordsParamsSchema>

/** Strict original retention plan. */
export const simulationRetentionPlanSchema = simulationProductRetentionPlanSchema
/** Original retained metadata or authorized raw records. */
export type SimulationRetentionPlan = SimulationProductRetentionPlan

/** Strict original retention result. */
export const simulationRetentionResultSchema = simulationProductRetentionResultSchema
/** Original retained metadata or authorized raw records. */
export type SimulationRetentionResult = SimulationProductRetentionResult

/** Strict original retention recordsresult. */
export const simulationRetentionRecordsResultSchema = simulationProductRetentionRecordsResultSchema
/** Original retained metadata or authorized raw records. */
export type SimulationRetentionRecordsResult = SimulationProductRetentionRecordsResult

/** Original completed archive lookup; no capture or execution is implied. */
export const simulationBackupExportParamsSchema = simulationProductBackupExportInputSchema
/** Exact bounded portable bytes. */
export const simulationBackupExportResultSchema = simulationProductBackupExportResultSchema
/** Original lookup identities. */
export type SimulationBackupExportParams = z.input<typeof simulationBackupExportParamsSchema>
/** Private portable full-backup response. */
export type SimulationBackupExportResult = SimulationProductBackupExportResult

/** Exact original selection for world-branch. */
export const simulationWorldBranchParamsSchema = simulationProductWorldBranchInputSchema
/** Strict wire input for world-branch. */
export type SimulationWorldBranchParams = z.input<typeof simulationWorldBranchParamsSchema>

/** Exact original selection for world-branch-read. */
export const simulationWorldBranchReadParamsSchema = simulationProductWorldBranchReadInputSchema
/** Strict wire input for world-branch-read. */
export type SimulationWorldBranchReadParams = z.input<typeof simulationWorldBranchReadParamsSchema>

/** Exact original selection for world-causal. */
export const simulationWorldCausalParamsSchema = simulationProductWorldCausalInputSchema
/** Strict wire input for world-causal. */
export type SimulationWorldCausalParams = z.input<typeof simulationWorldCausalParamsSchema>

/** Exact original selection for world-compare. */
export const simulationWorldCompareParamsSchema = simulationProductWorldCompareInputSchema
/** Strict wire input for world-compare. */
export type SimulationWorldCompareParams = z.input<typeof simulationWorldCompareParamsSchema>

/** Strict bounded public experiment outcome. */
export const simulationWorldBranchResultSchema = simulationProductWorldBranchResultSchema
/** Source-bound public experiment result without private history. */
export type SimulationWorldBranchResult = z.infer<typeof simulationWorldBranchResultSchema>

/** Strict bounded public experiment outcome. */
export const simulationWorldCausalResultSchema = simulationProductWorldCausalResultSchema
/** Source-bound public experiment result without private history. */
export type SimulationWorldCausalResult = z.infer<typeof simulationWorldCausalResultSchema>

/** Strict bounded public experiment outcome. */
export const simulationWorldCompareResultSchema = simulationProductWorldCompareResultSchema
/** Source-bound public experiment result without private history. */
export type SimulationWorldCompareResult = z.infer<typeof simulationWorldCompareResultSchema>

/** Original authenticated stop command or explicit clear; not a scheduling request. */
export type SimulationRunControlParams = WireInput<SimulationProductRunControlInput>
/** Original durable stop receipt and independent current control observation. */
export type SimulationRunControlResult = SimulationProductRunControlResult
/** Strict input retains explicit null when clearing a target. */
export const simulationRunControlParamsSchema = simulationProductRunControlInputSchema satisfies z.ZodType<SimulationRunControlParams>
/** Strict output excludes raw provider diagnostics and private world payloads. */
export const simulationRunControlResultSchema = simulationProductRunControlResultSchema

/** Explicit original-byte preservation requires whole-record authorization independent of run access. */
export type SimulationRawArchiveParams = WireInput<SimulationProductRawArchiveInput>
/** Bounded raw-only text archive; no Native parser, writable state or physical SQLite-copy claim. */
export type SimulationRawArchiveResult = SimulationProductRawArchivePage
/** Preserve exact registered source selection and bounded continuation. */
export const simulationRawArchiveParamsSchema = simulationProductRawArchiveInputSchema satisfies z.ZodType<SimulationRawArchiveParams>
/** Every page states original storage version and raw-only coverage. */
export const simulationRawArchiveResultSchema = simulationProductRawArchivePageSchema
