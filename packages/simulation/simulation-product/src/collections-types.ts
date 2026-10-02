/** Browser-safe administrative object DTOs; private bodies and source storage selections are excluded. */
import type { SimulationEntityId, SimulationDecisionId, SimulationDecisionSlot, SimulationOperationId,
  SimulationCheckpointId, SimulationWriterEpoch, SimulationRelationId } from '@clocky/clocky-simulation/identities'
import type { Branded } from '@clocky/clocky-brand'
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import type { TeamId, ParticipantId, ChannelId, TeamTaskId, EnvelopeId } from '@clocky/clocky-team/types'
import type { SessionId } from '@clocky/clocky-session/types'
import type { SimulationProductRunId, SimulationProductCursor, SimulationProductText } from './types.ts'
import type { SimulationProductReadVersion } from './watch-types.ts'
import type { SimulationProductKnowledgeRef, SimulationProductKnowledgeDetail } from './knowledge-types.ts'

/** Administrative collection selectors; each row contains metadata rather than private world bodies. */
export type SimulationProductCollection = 'entities' | 'decisions' | 'operations' | 'checkpoints'
/** Native entity lifecycle, independent of writer residency. */
export type SimulationProductEntityPhase = 'active' | 'inactive' | 'terminated'
/** Native decision submission/acceptance, independent of business execution. */
export type SimulationProductDecisionStatus = 'open' | 'submitted' | 'accepted' | 'cancelled'
/** Native business effect status; uncertain publication does not imply failure. */
export type SimulationProductOperationStatus = 'pending' | 'applied' | 'rejected' | 'blocked-authority' | 'blocked-dependency' | 'outcome-unknown'
/** Retained checkpoint request progress, independent of current source validation. */
export type SimulationProductCheckpointStatus = 'in-progress' | 'failed' | 'completed'

/** Public entity label and independent participation/writer observations. */
export interface SimulationProductEntitySummary {
  readonly id: SimulationEntityId
  readonly name?: SimulationProductText | undefined
  readonly kind: SimulationProductText
  readonly phase: SimulationProductEntityPhase
  readonly cognition: 'none' | 'agent'
  readonly writer: 'none' | 'reserved' | 'active' | 'revoked' | 'released'
}
/** Public decision ordering and execution identity, without proposals or context text. */
export interface SimulationProductDecisionSummary {
  readonly id: SimulationDecisionId
  readonly entityId: SimulationEntityId
  readonly slot: SimulationDecisionSlot
  readonly time: SimTime
  readonly snapshotRevision: number
  readonly status: SimulationProductDecisionStatus
  readonly operationCount: number
}
/** Public effect identity and separate publication/recipient evidence. */
export interface SimulationProductOperationSummary {
  readonly id: SimulationOperationId
  readonly entityId: SimulationEntityId
  readonly decisionId: SimulationDecisionId
  readonly index: number
  readonly kind: SimulationProductText
  readonly status: SimulationProductOperationStatus
  readonly publication: 'not-applicable' | 'pending' | 'published'
  readonly delivery: 'not-applicable' | 'pending' | 'input-persisted' | 'receipted'
  readonly deliveryFailure?: 'unresolved' | 'retained-input' | 'absent-input' | 'entity-terminated' | undefined
  readonly task: 'not-applicable' | 'pending' | 'created'
}
/** Retained checkpoint metadata never claims that cross-owner source verification has run. */
export interface SimulationProductCheckpointSummary {
  readonly id: SimulationCheckpointId
  readonly status: SimulationProductCheckpointStatus
  readonly startedSequence: number
  readonly finishedSequence?: number | undefined
  readonly time?: SimTime | undefined
  readonly publishedAt?: number | undefined
  readonly latestSuccessful: boolean
  readonly sourceValidation: 'not-performed'
}

interface PageInput {
  readonly runId: SimulationProductRunId
  readonly limit?: number | undefined
  readonly cursor?: SimulationProductCursor | undefined
}
/** Collection-specific filters are wire-validated and bound to continuation. */
export type SimulationProductBrowseInput = PageInput & (
  | { readonly collection: 'entities'
    readonly phase?: SimulationProductEntityPhase | undefined
    readonly cognition?: 'none' | 'agent' | undefined }
  | { readonly collection: 'decisions'
    readonly status?: SimulationProductDecisionStatus | undefined
    readonly entityId?: SimulationEntityId | undefined }
  | { readonly collection: 'operations'
    readonly status?: SimulationProductOperationStatus | undefined
    readonly entityId?: SimulationEntityId | undefined
    readonly decisionId?: SimulationDecisionId | undefined }
  | { readonly collection: 'checkpoints'
    readonly status?: SimulationProductCheckpointStatus | undefined }
)
interface PageObservation {
  readonly runId: SimulationProductRunId
  readonly snapshotRevision: number
  readonly observedAt: number
  readonly total: number
  readonly nextCursor?: SimulationProductCursor | undefined
}
/** One collection page contains one exact native revision and the complete filtered total. */
export type SimulationProductCollectionPage = PageObservation & (
  | { readonly collection: 'entities'
    readonly items: readonly SimulationProductEntitySummary[] }
  | { readonly collection: 'decisions'
    readonly items: readonly SimulationProductDecisionSummary[] }
  | { readonly collection: 'operations'
    readonly items: readonly SimulationProductOperationSummary[] }
  | { readonly collection: 'checkpoints'
    readonly items: readonly SimulationProductCheckpointSummary[] }
)
/** Exact object and section selection; page controls exist only for collection-bearing sections. */
export type SimulationProductObjectSelection =
  | { readonly collection: 'entities'
    readonly id: SimulationEntityId
    readonly section: 'knowledge' }
  | { readonly collection: 'decisions'
    readonly id: SimulationDecisionId
    readonly section: 'knowledge'
    readonly reference?: SimulationProductKnowledgeRef | undefined }
  | { readonly collection: 'entities'
    readonly id: SimulationEntityId
    readonly section: 'identity' | 'relationships' }
  | { readonly collection: 'decisions'
    readonly id: SimulationDecisionId
    readonly section: 'execution' | 'context' }
  | { readonly collection: 'operations'
    readonly id: SimulationOperationId
    readonly section: 'execution' | 'attempts' }
  | { readonly collection: 'checkpoints'
    readonly id: SimulationCheckpointId
    readonly section: 'references' }
/** Detail refresh can fence the selected world revision; neither selector grants authority. */
export type SimulationProductObjectInput = { readonly runId: SimulationProductRunId
  readonly expectedRevision?: number | undefined } & (
  | (Extract<SimulationProductObjectSelection, { section: 'knowledge' }>
    & { readonly limit?: number | undefined; readonly cursor?: SimulationProductCursor | undefined })
  | { readonly collection: 'entities'
    readonly id: SimulationEntityId
    readonly section: 'identity' }
  | { readonly collection: 'decisions'
    readonly id: SimulationDecisionId
    readonly section: 'execution' }
  | ({ readonly collection: 'entities'
    readonly id: SimulationEntityId
    readonly section: 'relationships' }
    & { readonly limit?: number | undefined
      readonly cursor?: SimulationProductCursor | undefined })
  | ({ readonly collection: 'decisions'
    readonly id: SimulationDecisionId
    readonly section: 'context' }
    & { readonly limit?: number | undefined
      readonly cursor?: SimulationProductCursor | undefined })
  | { readonly collection: 'operations'
    readonly id: SimulationOperationId
    readonly section: 'execution' }
  | ({ readonly collection: 'operations'
    readonly id: SimulationOperationId
    readonly section: 'attempts' }
    & { readonly limit?: number | undefined
      readonly cursor?: SimulationProductCursor | undefined })
  | (Extract<SimulationProductObjectSelection, { collection: 'checkpoints' }>
    & { readonly limit?: number | undefined
      readonly cursor?: SimulationProductCursor | undefined })
)

/** Real-time inference timestamps; simulation time remains on the decision summary. */
export interface SimulationProductInference {
  readonly startedAt: number
  readonly deadline: number
  readonly finishedAt?: number | undefined
  readonly expiredAt?: number | undefined
}
/** Frozen context accounting contains no original sections, knowledge text or complete model request. */
export type SimulationProductContextSummary =
  | { readonly status: 'absent' }
  | { readonly status: 'overflow'
    readonly requiredBytes: number
    readonly maxBytes: number }
  | { readonly status: 'prepared'
    readonly retainedBytes: number
    readonly maxBytes: number
    readonly knowledgeCount: number
    readonly sourceCount: number
    readonly sectionCount: number
    readonly content: 'withheld' }
/** A single technical publication attempt; provider diagnostics are withheld. */
export interface SimulationProductAttempt {
  readonly number: number
  readonly startedAt: number
  readonly finishedAt?: number | undefined
  readonly outcome: 'in-flight' | 'uncertain' | 'applied' | 'rejected' | 'blocked-authority'
}
/** Metadata reference permits navigation only; Team and Session content require their own read authorization. */
export type SimulationProductCheckpointReference =
  | { readonly kind: 'run'
    readonly cursor: number }
  | { readonly kind: 'team'
    readonly id: TeamId
    readonly cursor: number }
  | { readonly kind: 'channel'
    readonly id: ChannelId
    readonly cursor: number }
  | { readonly kind: 'session'
    readonly id: SessionId
    readonly teamId: TeamId
    readonly participantId: ParticipantId
    readonly materialization: 'materialized'
    readonly sequence: number }
  | { readonly kind: 'session'
    readonly id: SessionId
    readonly teamId: TeamId
    readonly participantId: ParticipantId
    readonly materialization: 'unmaterialized' }
interface DetailPage<T> {
  readonly items: readonly T[]
  readonly total: number
  readonly nextCursor?: SimulationProductCursor | undefined
}
/** Historical relation intervals remain canonical decimals; active is observed at this page's simulation time. */
export interface SimulationProductRelation {
  readonly id: SimulationRelationId
  readonly subject: SimulationEntityId
  readonly object: SimulationEntityId
  readonly relation: SimulationProductText
  readonly scope?: SimulationEntityId | undefined
  readonly revision: number
  readonly validFrom: SimTime
  readonly validUntil: SimTime | null
  readonly active: boolean
}
/** Text is split at Unicode boundaries; omitted and unsupported bodies cannot masquerade as empty text. */
export type SimulationProductContextBody = { readonly status: 'withheld' | 'unsupported' }
  | { readonly status: 'text'
    readonly text: string
    readonly part: number
    readonly parts: number }
/** Frozen evidence references grant neither current knowledge nor Team/Session body access. */
export type SimulationProductContextItem =
  | { readonly kind: 'section'
    readonly index: number
    readonly block: number
    readonly section: SimulationProductText
    readonly required: boolean
    readonly body: SimulationProductContextBody }
  | { readonly kind: 'knowledge'
    readonly id: Branded<'SimulationKnowledgeId'>
    readonly revision: number }
  | { readonly kind: 'run-event'
    readonly sequence: number }
  | { readonly kind: 'team-envelope'
    readonly sourceIndex: number
    readonly teamId: TeamId
    readonly channelId: ChannelId
    readonly envelopeId: EnvelopeId }
/** Recorded provenance is independent of the current world revision and complete model request. */
export interface SimulationProductFrozenContext {
  readonly time: SimTime
  readonly slot: SimulationDecisionSlot
  readonly entityId: SimulationEntityId
  readonly epoch: SimulationWriterEpoch
  readonly projections: { readonly run: number
    readonly entity: number
    readonly team: number }
  readonly versions: { readonly rules: SimulationProductText
    readonly policy: SimulationProductText
    readonly persona: SimulationProductText
    readonly model: SimulationProductText }
}
/** Sectioned metadata uses authoritative status without publishing private world/context bodies. */
export type SimulationProductObjectDetail =
  | SimulationProductKnowledgeDetail
  | { readonly collection: 'entities'
    readonly section: 'relationships'
    readonly id: SimulationEntityId
    readonly time: SimTime
    readonly relationships: DetailPage<SimulationProductRelation> }
  | { readonly collection: 'decisions'
    readonly section: 'context'
    readonly id: SimulationDecisionId
    readonly readVersion: SimulationProductReadVersion
    readonly accounting: SimulationProductContextSummary
    readonly bodyAccess: 'allowed' | 'withheld'
    readonly frozen?: SimulationProductFrozenContext | undefined
    readonly items: DetailPage<SimulationProductContextItem> }
  | { readonly collection: 'entities'
    readonly section: 'identity'
    readonly id: SimulationEntityId
    readonly summary: SimulationProductEntitySummary
    readonly revision: number
    readonly profileRevision: number
    readonly writerEpoch?: SimulationWriterEpoch | undefined
    readonly binding?: { readonly teamId: TeamId
      readonly participantId: ParticipantId
      readonly sessionId: SessionId } | undefined }
  | { readonly collection: 'decisions'
    readonly section: 'execution'
    readonly id: SimulationDecisionId
    readonly summary: SimulationProductDecisionSummary
    readonly context: SimulationProductContextSummary
    readonly inference?: SimulationProductInference | undefined
    readonly closedAt?: number | undefined
    readonly cancellation?: 'requested' | 'writer-revoked' | 'scheduled-wake-cancelled' | 'timeout' | undefined }
  | { readonly collection: 'operations'
    readonly section: 'execution'
    readonly id: SimulationOperationId
    readonly summary: SimulationProductOperationSummary
    readonly dependencies: readonly SimulationOperationId[]
    readonly result?: { readonly status: Exclude<SimulationProductOperationStatus, 'pending' | 'outcome-unknown'>
      readonly time: SimTime
      readonly sequence: number
      readonly code: SimulationProductText } | undefined
    readonly outbox?: { readonly ready: boolean
      readonly attemptCount: number
      readonly nextAttemptAt?: number | undefined } | undefined
    readonly taskReference?: { readonly teamId: TeamId
      readonly taskId: TeamTaskId } | undefined
    /** Missing only on older peers; new reads supply exact native fences and independent owner admission. */
    readonly retry?: import('./operation-retry-types.ts').SimulationProductOperationRetryCapability | undefined }
  | { readonly collection: 'operations'
    readonly section: 'attempts'
    readonly id: SimulationOperationId
    readonly attempts: DetailPage<SimulationProductAttempt> }
  | { readonly collection: 'checkpoints'
    readonly section: 'references'
    readonly id: SimulationCheckpointId
    readonly summary: SimulationProductCheckpointSummary
    readonly references: DetailPage<SimulationProductCheckpointReference>
    readonly failure?: 'details-withheld' | undefined
    readonly diagnostic?: import('@clocky/clocky-simulation/checkpoint-diagnostics-types').SimulationCheckpointDiagnostic | undefined }
/** Exact authorized read; unknown and other-run object IDs share missing status. */
export interface SimulationProductObjectInspection {
  readonly runId: SimulationProductRunId
  readonly snapshotRevision: number
  readonly observedAt: number
  readonly selection: SimulationProductObjectSelection
  readonly status: 'found' | 'missing'
  readonly value?: SimulationProductObjectDetail | undefined
}
