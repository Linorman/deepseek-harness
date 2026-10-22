/** Retained hire identities and owner input without Host services or schema inference dependencies. */
import type { SimTime } from './time-types.ts'
import type { ChannelId } from '@clocky/clocky-team/types'
import type { SimulationEntityBinding } from './binding-types.ts'
import type { SimulationMaintenanceRequest } from './maintenance-types.ts'
import type { SimulationEntityId, SimulationRelationId, SimulationChannelKey } from './identities.ts'
import type { WorldIntentId } from './world-domain-types.ts'
import type { WorldRequestId, WorldPlanId } from './world-types.ts'

/** Trusted frozen hire reservation input, independent of model plan submission. */
export interface SimulationWorldHireReserveRequest {
  readonly planId: WorldPlanId
  readonly maintenance: SimulationMaintenanceRequest
  readonly member: {
    readonly displayName: string
    readonly role: 'member'
    readonly capabilities: readonly string[]
    readonly provider: 'in-process'
    readonly preset: string
    readonly model: string
    readonly modelVersion: string
  }
}
/** Original pre-IO allocation; channel purpose and order remain immutable. */
export interface SimulationWorldHireIdentities {
  readonly entityId: SimulationEntityId
  readonly relationId: SimulationRelationId
  readonly binding: SimulationEntityBinding
  readonly channels: readonly [
    { readonly purpose: 'director'; readonly key: SimulationChannelKey; readonly channelId: ChannelId },
    { readonly purpose: 'requester'; readonly key: SimulationChannelKey; readonly channelId: ChannelId },
  ]
}
/** Exact terminal observation of an originally reserved private Channel. */
export type SimulationWorldIdentityChannelCleanup =
  | { readonly phase: 'absent'; readonly channelId: ChannelId }
  | { readonly phase: 'closed' | 'expired' | 'failed'; readonly channelId: ChannelId; readonly cursor: number }
/** Canonical topology owner's retained cleanup evidence; no Session or activation may have started. */
export interface SimulationWorldIdentityCleanupEvidence {
  readonly binding: SimulationEntityBinding
  readonly teamCursor: number
  readonly participant: 'absent' | 'left' | 'failed'
  readonly session: 'unmaterialized'
  readonly channels: readonly [SimulationWorldIdentityChannelCleanup, SimulationWorldIdentityChannelCleanup]
}
/** One Native-owned capacity and identity obligation for an original business application. */
export interface SimulationWorldHireReservation {
  /** Exact shared-ledger funding hold, present only when the frozen scene declares a one-time charge. */
  readonly resourceReservationId?: import('./resource-reservation.ts').SimulationResourceReservationId | undefined
  /** Exact passed committee resolutions and effective policy versions verified at original reserve admission. */
  readonly approvals: readonly import('./world-hire-approval-types.ts').SimulationHireApprovalBasis[]
  readonly id: WorldIntentId
  readonly requestId: WorldRequestId
  readonly request: SimulationWorldHireReserveRequest
  readonly identities: SimulationWorldHireIdentities
  readonly sequence: number
  readonly updatedSequence: number
  /** Native admission time, retained before topology IO. */
  readonly reservedAt: SimTime
  /** First preparation admission; immutable across retries and terminal settlement. */
  readonly prepared?: { readonly time: SimTime; readonly sequence: number } | undefined
  readonly status: 'reserved' | 'preparing' | 'candidate' | 'cancel-requested' | 'committed' | 'abandoned'
  /** Confirmed independent candidate; the second maintenance cut commits the original identity after consent. */
  readonly candidate?: { readonly time: SimTime; readonly sequence: number; readonly maintenance: SimulationMaintenanceRequest } | undefined
  readonly cleanup?: {
    readonly sequence: number
    readonly evidence: SimulationWorldIdentityCleanupEvidence
  } | undefined
}
