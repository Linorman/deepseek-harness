/** Current-audience knowledge retrieval is separate from historical context and authoritative world facts. */
import type { Branded } from '@clocky/clocky-brand'
import type { SimulationEntityId, SimulationDecisionId, SimulationOperationId } from '@clocky/clocky-simulation/identities'
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import type { SimulationProductContextBody } from './collections-types.ts'
import type { SimulationProductCursor, SimulationProductText } from './types.ts'
import type { SimulationProductReadVersion } from './watch-types.ts'

/** Exact retained premise selection; references grant no retrieval permission. */
export interface SimulationProductKnowledgeRef {
  readonly id: Branded<'SimulationKnowledgeId'>
  readonly revision: number
}
/** Source attribution remains distinct from fact verification; premises carry their exact original versions. */
export type SimulationProductKnowledgeSource =
  | { readonly kind: 'observation'; readonly worldRevision: number; readonly visibilityPolicy: SimulationProductText }
  | { readonly kind: 'report'; readonly operationId: SimulationOperationId; readonly body: SimulationProductContextBody }
  | { readonly kind: 'inference'; readonly decisionId: SimulationDecisionId; readonly confidence?: number | undefined }
  | { readonly kind: 'summary'; readonly cursor: number; readonly policy: SimulationProductText; readonly policyVersion: SimulationProductText }
  | { readonly kind: 'belief'; readonly profileRevision: number; readonly policyVersion: SimulationProductText; readonly confidence?: number | undefined }
/** A complete text part and its original provenance; current revocation governs every exact version read. */
export interface SimulationProductKnowledgeItem {
  readonly reference: SimulationProductKnowledgeRef
  readonly owner: SimulationEntityId
  readonly observedAt: SimTime
  readonly availableAt: SimTime
  readonly validFrom: SimTime
  readonly validUntil: SimTime | null
  readonly sequence: number
  readonly body: SimulationProductContextBody
  readonly source: SimulationProductKnowledgeSource
  readonly premises: readonly SimulationProductKnowledgeRef[]
}
/** Knowledge body pages are policy tagged and additionally invalidated by current world/audience changes. */
export interface SimulationProductKnowledgeDetail {
  readonly collection: 'entities' | 'decisions'
  readonly section: 'knowledge'
  readonly id: SimulationEntityId | SimulationDecisionId
  readonly readVersion: SimulationProductReadVersion
  readonly bodyAccess: 'allowed' | 'withheld'
  readonly entityId: SimulationEntityId
  readonly time: SimTime
  readonly cutoffRevision: number
  readonly selected?: SimulationProductKnowledgeRef | undefined
  readonly knowledge: { readonly items: readonly SimulationProductKnowledgeItem[]
    readonly total: number
    readonly nextCursor?: SimulationProductCursor | undefined }
}
