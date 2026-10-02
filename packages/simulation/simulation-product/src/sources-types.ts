/** Exact frozen source selection; neither an index nor a reference grants Team content authority. */
import type { SimulationDecisionId } from '@clocky/clocky-simulation/identities'
import type { TeamId, ChannelId, EnvelopeId } from '@clocky/clocky-team/types'
import type { SimulationProductRunId, SimulationProductCursor, SimulationProductText } from './types.ts'
import type { SimulationProductReadVersion } from './watch-types.ts'
import type { SimulationProductContextBody } from './collections-types.ts'

/** Source ordinals refer only to the selected decision's retained source vector. */
export interface SimulationProductSourceInput {
  readonly runId: SimulationProductRunId
  readonly decisionId: SimulationDecisionId
  readonly sourceIndex: number
  /** Verified position returned by a prior lookup; identity is rechecked even if callers supply it directly. */
  readonly envelopeSequence?: number | undefined
  /** Optional current-world fence; immutable source continuation can omit it while the run advances. */
  readonly expectedRevision?: number | undefined
  readonly cursor?: SimulationProductCursor | undefined
  readonly limit?: number | undefined
}
/** Safe reference copied from the frozen context, without confirming private target existence. */
export interface SimulationProductEnvelopeSource {
  readonly kind: 'team-envelope'
  readonly teamId: TeamId
  readonly channelId: ChannelId
  readonly envelopeId: EnvelopeId
}
/** Locate and body continuation are separate: only found sources expose an exact native position. */
export interface SimulationProductSourceInspection {
  readonly runId: SimulationProductRunId
  readonly decisionId: SimulationDecisionId
  readonly sourceIndex: number
  readonly snapshotRevision: number
  readonly readVersion: SimulationProductReadVersion
  readonly observedAt: number
  readonly source?: SimulationProductEnvelopeSource | undefined
  readonly status: 'missing' | 'withheld' | 'unavailable' | 'searching' | 'found'
  readonly envelope?: {
    readonly sequence: number
    readonly kind: SimulationProductText
    readonly createdAt: number
  } | undefined
  /** Plain-text fragments only; unsupported blocks expose no provider payload. */
  readonly items: readonly { readonly block: number; readonly body: SimulationProductContextBody }[]
  readonly nextCursor?: SimulationProductCursor | undefined
}
