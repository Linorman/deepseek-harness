/** Actor-free product creation and preparation receipts; no deployment paths or executable configuration. */
import type { SimulationCheckpointId } from '@clocky/clocky-simulation/identities'
import type { Branded } from '@clocky/clocky-brand'
import type { SimulationCheckpointDiagnostic } from '@clocky/clocky-simulation/checkpoint-diagnostics-types'
import type { SimulationProductRunId, SimulationProductText, SimulationProductCursor } from './types.ts'

/** Caller-retained identity of one persistent product administration request. */
export type SimulationProductCommandId = Branded<'SimulationProductCommandId'>
/** Deployment-selected versioned template identity. */
export type SimulationProductTemplateId = Branded<'SimulationProductTemplateId'>
/** Parameters permitted by the installed company procurement template. */
export interface SimulationCompanyParameters {
  readonly buyerName: string
  readonly supplierName: string
  readonly initialStock: string
}
/** Allowlisted immutable run allowances; deployment maxima also serve as defaults. */
export interface SimulationProductLimits {
  readonly maxEntities: number
  readonly maxResidentActors: number
  readonly tokensPerModelRequest: number
  readonly maxTokensPerInterval: number
  /** Canonical decimal tick horizon, never converted through JavaScript Number. */
  readonly maxTime: string
}
/** Read-only resolution and current shared model capacity; preflight reserves no resources. */
export interface SimulationProductConfiguration {
  readonly limits: SimulationProductLimits
  readonly budgetInterval: string
  readonly tickUnit: SimulationProductText
  readonly rulesVersion: SimulationProductText
  readonly policyVersion: SimulationProductText
  readonly sharedModelLimit: number
}
/** Creation semantics without a durable command; inspecting them creates no run, Team or actor. */
export type SimulationProductPreflightInput = Omit<SimulationProductCreateInput, 'commandId' | 'expectedModel'>
/** Exact route shown for confirmation; `name` is the provider-owned model ID, not a display label. */
export interface SimulationProductModelRoute {
  readonly provider: string
  readonly name: string
}
/** Installed-template readiness is independent of form validity and never performs inference. */
export type SimulationProductModelReadiness =
  | { readonly status: 'ready'
    readonly model: SimulationProductModelRoute }
  | { readonly status: 'needs-model'
    readonly reason: 'default-model-missing' }
  | { readonly status: 'unavailable'
    readonly reason: 'provider-unavailable' | 'metadata-unavailable'
    | 'reasoning-unsupported' | 'execution-unavailable' | 'template-unavailable' }
/** Bounded field rejection, including deployment readiness; private provider diagnostics are withheld. */
export interface SimulationProductPreflightIssue {
  readonly field: string
  readonly code: 'invalid' | 'not-allowed' | 'unavailable' | 'capacity-unavailable'
  readonly message: SimulationProductText
}
/** Ready describes the current observation; create independently rechecks before durable acceptance. */
export type SimulationProductPreflightResult = { readonly status: 'ready'
  readonly configuration: SimulationProductConfiguration
  readonly readiness: Extract<SimulationProductModelReadiness, { readonly status: 'ready' }> }
  | { readonly status: 'invalid'
    readonly issues: readonly SimulationProductPreflightIssue[]
    readonly readiness: SimulationProductModelReadiness }
/** Create allocates one original run identity before preparation; credentials/provider/spec are server-derived. */
export interface SimulationProductCreateInput {
  readonly commandId: SimulationProductCommandId
  readonly templateId: SimulationProductTemplateId
  readonly templateVersion: '1'
  /** Optimistic confirmation only; the Host resolves and freezes the actual route. */
  readonly expectedModel: SimulationProductModelRoute
  readonly name: string
  readonly parameters: SimulationCompanyParameters
  readonly limits?: { readonly [Key in keyof SimulationProductLimits]?: SimulationProductLimits[Key] | undefined } | undefined
}
/** Durable semantic input; the confirmed route is retained by the existing immutable creation driver. */
export type SimulationProductOriginalCreateInput = Omit<SimulationProductCreateInput, 'expectedModel'>
/** Explicit reconciliation attempt on the original allocated run. */
export interface SimulationProductPrepareInput {
  readonly runId: SimulationProductRunId
  readonly commandId: SimulationProductCommandId
}
/** Exact original request selector, independent of transport rpcId. */
export interface SimulationProductRequestInput {
  readonly commandId: SimulationProductCommandId
}
/** Authorized bounded discovery of one run's original durable administration requests. */
export interface SimulationProductRequestsInput {
  readonly runId: SimulationProductRunId
  readonly limit?: number | undefined
  readonly cursor?: SimulationProductCursor | undefined
  readonly expectedRevision?: number | undefined
}
/** Receipt-only original history; revision counts this run's accepted and terminal journal entries. */
export interface SimulationProductRequestsPage {
  readonly runId: SimulationProductRunId
  readonly snapshotRevision: number
  readonly items: readonly SimulationProductRequestReceipt[]
  readonly total: number
  readonly nextCursor?: SimulationProductCursor | undefined
}
/** Explicit original retry selects retained semantics; it carries no replacement payload or command identity. */
export interface SimulationProductRetryRequestInput {
  readonly runId: SimulationProductRunId
  readonly commandId: SimulationProductCommandId
}
/** Safe original operation fact plus current preparation observation; a failed attempt never changes on retry. */
export interface SimulationProductRequestReceipt {
  readonly commandId: SimulationProductCommandId
  readonly runId: SimulationProductRunId
  readonly kind: 'create' | 'prepare' | 'checkpoint' | 'restore' | 'review' | 'retry-operation' | 'cancel-task'
  readonly acceptedAt: number
  readonly status: 'accepted' | 'completed' | 'failed'
  readonly checkpointId?: SimulationCheckpointId | undefined
  readonly failure?: 'preparation-required' | 'recovery-required' | 'unavailable' | 'checkpoint-failed' | 'restore-failed'
    | 'review-failed' | 'retry-operation-failed' | 'cancel-task-failed' | undefined
  /** Explicit public failure facts; no provider prose, credentials or storage paths. */
  readonly diagnostic?: SimulationCheckpointDiagnostic | undefined
}
/** Absence does not establish that a caller's timed-out request failed or may use a new identity. */
export type SimulationProductRequestResult = { readonly status: 'not-found'; readonly commandId: SimulationProductCommandId }
  | { readonly status: 'found'
    readonly request: SimulationProductRequestReceipt
    readonly review?: import('./review-types.ts').SimulationProductTaskReviewResolveInput | undefined
    readonly cancellation?: import('./task-control-types.ts').SimulationProductTaskCancelInput | undefined
    readonly retryOperation?: import('./operation-retry-types.ts').SimulationProductOperationRetryInput | undefined }
/** Bounded catalog entry; driver implementation and strict parameter schema are installed by the Host. */
export interface SimulationProductTemplateSummary {
  readonly id: SimulationProductTemplateId
  readonly version: '1'
  readonly name: SimulationProductText
  readonly kind: 'company-procurement' | 'task-workflow'
  readonly readiness: SimulationProductModelReadiness
  readonly tickUnit: SimulationProductText
  readonly execution: 'cognition-only' | 'automatic-tasks'
  /** Actual installed execution strategy; deterministic workflow steps make no model requests. */
  readonly cognition?: 'model' | 'deterministic' | undefined
  readonly review: 'none' | 'buyer' | 'participant'
  readonly maxStock: string
  readonly configuration?: (SimulationProductConfiguration & { readonly editable: readonly (keyof SimulationProductLimits)[] }) | undefined
}
/** Complete bounded authorized template catalog. */
export interface SimulationProductCatalog {
  readonly items: readonly SimulationProductTemplateSummary[]
}
