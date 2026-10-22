/** Canonical owner observations used internally to construct a bounded personnel obligation report. */
import type { ChannelSnapshot, EnvelopeId, ParticipantId, TeamStateSnapshot } from '@clocky/clocky-team'

/** Metadata-only pending message reference; private payload and recipient instructions are excluded. */
export interface PersonnelPendingDeliverySource {
  readonly envelopeId: EnvelopeId
  readonly recipientId: ParticipantId
  readonly senderId: ParticipantId
  readonly sequence: number
  readonly direction: 'incoming' | 'outgoing'
}
/** One original channel and only deliveries involving the selected canonical participant. */
export interface PersonnelChannelSource {
  readonly channel: ChannelSnapshot
  readonly deliveries: readonly PersonnelPendingDeliverySource[]
}
/** Explicit trusted read-work bounds; exhaustion prevents a complete coverage claim. */
export interface PersonnelTeamReadLimits {
  readonly maxChannels: number
  readonly maxPages: number
  readonly pageSize: number
  readonly maxBytes: number
}
/** Owner-only sources, never forwarded directly to a model or product DTO. */
export type PersonnelTeamSources = {
  readonly team: TeamStateSnapshot
  readonly channels: readonly PersonnelChannelSource[]
} & ({ readonly complete: true; readonly incomplete?: never }
  | { readonly complete: false; readonly incomplete: 'channel-limit' | 'page-limit' | 'byte-limit' | 'source-moved' })
