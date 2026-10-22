import type { SimulationProductWorldManagementSubmitInput } from './world-management-types.ts'
import type { SimulationWorldManagementSubmitRequest } from '@clocky/clocky-simulation/world-management-types'
import type { SimulationProductWorldCaseCancelInput } from './case-cancel-types.ts'
/** Private product creation intent and attempt history; never a browser-selected native run configuration. */
import type { SimulationProductCheckpointInput, SimulationProductRestoreInput } from './maintenance-types.ts'
import type { SimulationProductTaskReviewResolveInput } from './review-types.ts'
import type { SimulationProductTaskCancelInput } from './task-control-types.ts'
import type { SimulationProductOperationRetryInput } from './operation-retry-types.ts'
import type { ProductPrincipalId } from '@clocky/clocky-product-principal'
import type { SimulationRunSpec } from '@clocky/clocky-simulation'
import type { SimulationCompanyPreparation } from './company-preparation.ts'
import type { SimulationCompanyDriverConfig } from './company-driver.ts'
import type { SimulationProductPrepareInput, SimulationProductRequestReceipt,
  SimulationProductTemplateId, SimulationProductLimits, SimulationProductOriginalCreateInput } from './administration-types.ts'
import type { SimulationProductRecord } from './registration-types.ts'
import type { SimulationWorldCreation } from './world-creation.ts'
import type { SimulationProductWorldCreateInput } from './world-types.ts'

/** Trusted installed template; native run identity is allocated separately by the product owner. */
export interface SimulationCompanyTemplate {
  readonly id: SimulationProductTemplateId
  readonly version: '1'
  readonly name: string
  readonly provider: string
  readonly spec: Omit<SimulationRunSpec, 'runId'>
  readonly preset: string
  readonly objective: string
  readonly driver: SimulationCompanyDriverConfig
  readonly checkpoint: { readonly maxDrainRounds: number; readonly maxAttempts: number }
  /** Explicit deployment allowlist; omitted fields retain the installed immutable specification. */
  readonly editableLimits?: readonly (keyof SimulationProductLimits)[] | undefined
}
/** Deployment-only late binding; this selector never enters a durable driver or native specification. */
export interface SimulationInstalledCompanyTemplate extends Omit<SimulationCompanyTemplate, 'driver'> {
  readonly driver: Omit<SimulationCompanyDriverConfig, 'model'> & {
    readonly model: SimulationCompanyDriverConfig['model'] | { readonly source: 'agent-default' }
  }
}
/** Exact original deployment resolution stored before any native creation IO. */
export interface SimulationCompanyCreation {
  readonly record: SimulationProductRecord
  readonly request: SimulationProductOriginalCreateInput
  readonly preparation: SimulationCompanyPreparation
  readonly driver: SimulationCompanyDriverConfig
}
/** Queued/terminal request identity; later attempts never replace this result. */
export type SimulationCreationCommand = {
  readonly ownerPrincipalId: ProductPrincipalId
  readonly receipt: SimulationProductRequestReceipt
} & (
  | { readonly kind: 'create'; readonly input: SimulationProductOriginalCreateInput; readonly creation: SimulationCompanyCreation }
  | { readonly kind: 'world-create'; readonly input: SimulationProductWorldCreateInput; readonly creation: SimulationWorldCreation }
  | { readonly kind: 'world-prepare'; readonly input: SimulationProductPrepareInput }
  | { readonly kind: 'prepare'; readonly input: SimulationProductPrepareInput }
  | { readonly kind: 'checkpoint'; readonly input: SimulationProductCheckpointInput }
  | { readonly kind: 'restore'; readonly input: SimulationProductRestoreInput }
  | { readonly kind: 'review'; readonly input: SimulationProductTaskReviewResolveInput }
  | { readonly kind: 'world-management'
    readonly input: SimulationProductWorldManagementSubmitInput
    readonly native: SimulationWorldManagementSubmitRequest }
  | { readonly kind: 'cancel-world-case'; readonly input: SimulationProductWorldCaseCancelInput }
  | { readonly kind: 'cancel-task'; readonly input: SimulationProductTaskCancelInput }
  | { readonly kind: 'retry-operation'; readonly input: SimulationProductOperationRetryInput }
)
/** The command kind fixes the immutable creation family; Native remains the only world-fact owner. */
export type SimulationCreation = ({ readonly kind: 'company' } & SimulationCompanyCreation)
  | ({ readonly kind: 'world' } & SimulationWorldCreation)
  | import('./experiment-store.ts').SimulationWorldBranchCreation
/** Entire bounded replay projection, independent of native world phase/effects. */
export interface SimulationCreationBook {
  readonly commands: ReadonlyMap<string, SimulationCreationCommand>
  readonly creations: ReadonlyMap<string, SimulationCreation>
}
