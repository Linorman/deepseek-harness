import type { WorldEvidenceChallengeId, WorldEvidenceRevisionId, WorldEvidenceFieldCode } from '@clocky/clocky-simulation'
import type { WorldIntentId } from '@clocky/clocky-simulation/world-domain-types'
/** Browser-safe World case facts; discovery never grants case prose or generated Persona. */
import type { SimulationEntityId, SimulationOperationId, SimulationRelationId, SimulationDecisionId,
  SimulationEventId } from '@clocky/clocky-simulation/identities'
import type { WorldRequestId, WorldPlanId, WorldResultId, WorldCancelId } from '@clocky/clocky-simulation/world-types'
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import type { ChannelId, EnvelopeId } from '@clocky/clocky-team/types'
import type { SimulationProductRunId, SimulationProductCursor, SimulationProductText } from './types.ts'
import type { SimulationProductReadVersion } from './watch-types.ts'

/** Native case lifecycle, independent of publication and delivery. */
export type SimulationProductWorldCaseStatus = 'open' | 'awaiting-evidence' | 'cancel-requested' | 'cancelled' | 'rejected' | 'committed'
/** Actual finite cancellation dependencies from one Native prefix; no prose or additional authority. */
export interface SimulationProductWorldCaseCancelPreview {
  readonly snapshotRevision: number
  readonly previewHash: string
  readonly impact: {
    readonly requestStatus: SimulationProductWorldCaseStatus
    readonly planIds: readonly WorldPlanId[]
    readonly hiringReservationIds: readonly WorldIntentId[]
    readonly personnelReservationIds: readonly WorldIntentId[]
    readonly representativeReservationIds: readonly WorldIntentId[]
    readonly unconfirmedExecutionPlanIds: readonly WorldPlanId[]
  }
}
/** Observed hint only; the cancellation command rechecks ownership and Native linearization. */
export interface SimulationProductWorldCaseCancelCapability {
  readonly allowed: boolean
  readonly reason: 'ready' | 'terminal' | 'recovery-required' | 'retiring' | 'capacity' | 'in-progress' | 'stale'
  readonly preview?: SimulationProductWorldCaseCancelPreview | undefined
}
/** Pure domain summary disclosure; unsupported and unknown never mean zero business responsibility. */
export type SimulationProductWorldBusinessSummary = { readonly status: 'unsupported' | 'withheld' | 'unknown' }
  | { readonly status: 'allowed'; readonly value: import('@clocky/clocky-simulation/world-summary').SimulationWorldBusinessSummary }

/** Original safe references; names, request prose and plan rationale are absent. */
export interface SimulationProductWorldCaseSummary {
  readonly apiVersion: 'clocky.world-case/v4'
  /** Same authorized pure mapping in list, detail and domain exports. */
  readonly businessSummary: SimulationProductWorldBusinessSummary
  readonly domain: string
  readonly operation: string
  readonly version: string
  readonly requestId: WorldRequestId
  readonly intentId: WorldIntentId
  readonly status: SimulationProductWorldCaseStatus
  readonly requesterEntityId: SimulationEntityId | null
  /** A user command never claims an acting person or a model decision. */
  readonly origin: { readonly kind: 'decision' } | { readonly kind: 'authenticated-user'
    readonly commandId: import('./administration-types.ts').SimulationProductCommandId }
  readonly organizationEntityId: SimulationEntityId
  /** Actual original intent target; hiring positions are one domain-specific use. */
  readonly targetEntityId: SimulationEntityId
  readonly cancel: SimulationProductWorldCaseCancelCapability
  /** Four independent lifecycle layers projected from the page’s single Native prefix. */
  readonly lifecycle: SimulationProductWorldCaseLifecycle
}
/** Explicit registration, bounded status filter and authenticated continuation. */
export interface SimulationProductWorldCasesInput {
  readonly runId: SimulationProductRunId
  readonly status?: SimulationProductWorldCaseStatus | undefined
  readonly expectedRevision?: number | undefined
  readonly cursor?: SimulationProductCursor | undefined
  readonly limit?: number | undefined
}
/** Complete metadata page, bound to a Native revision and read-policy lifetime. */
export interface SimulationProductWorldCasesPage {
  readonly runId: SimulationProductRunId
  readonly snapshotRevision: number
  readonly readVersion: SimulationProductReadVersion
  readonly observedAt: number
  readonly total: number
  readonly items: readonly SimulationProductWorldCaseSummary[]
  readonly nextCursor?: SimulationProductCursor | undefined
}
/** Independent fixed sections; the caller cannot select provider, principal or Session. */
export interface SimulationProductWorldCaseInput {
  readonly runId: SimulationProductRunId
  readonly requestId: WorldRequestId
  readonly section: 'request' | 'plans' | 'execution' | 'notification'
  readonly expectedRevision?: number | undefined
  readonly readVersion?: SimulationProductReadVersion | undefined
  readonly cursor?: SimulationProductCursor | undefined
  readonly limit?: number | undefined
}
/** Case text and Persona use separate disclosure domains. */
export type SimulationProductWorldCaseBody = { readonly status: 'withheld' }
  | { readonly status: 'allowed'; readonly text: SimulationProductText }
/** Only the approved template and finite selected values are disclosed with a Persona grant. */
export type SimulationProductWorldCasePersona = { readonly status: 'withheld' | 'not-applicable' }
  | { readonly status: 'allowed'
    readonly templateId: SimulationProductText
    readonly templateVersion: SimulationProductText
    readonly name: SimulationProductText
    readonly skills: readonly SimulationProductText[]
    readonly traits: readonly SimulationProductText[]
    readonly goals: readonly SimulationProductText[] }
/** Original plan facts preserve stale causes, predecessor and hash without implying a hire. */
export interface SimulationProductWorldCasePlan {
  readonly id: WorldPlanId
  readonly operationId: SimulationOperationId | null
  readonly sequence: number
  readonly hash: string
  readonly predecessor: WorldPlanId | null
  readonly status: 'accepted' | 'stale'
  readonly resolution: 'apply' | 'reject' | 'awaiting-evidence'
  readonly stale?: { readonly phase: 'acceptance' | 'execution'
    readonly reason: 'read-set-changed' | 'authority-unavailable'
    readonly sequence: number } | undefined
  readonly rationale: SimulationProductWorldCaseBody
  readonly persona: SimulationProductWorldCasePersona
}
/** A sole immutable result contains only bounded Native outcomes and original source IDs. */
export interface SimulationProductWorldCaseResult {
  readonly id: WorldResultId
  readonly sequence: number
  readonly time: SimTime
  readonly source: { readonly kind: 'plan'; readonly planId: WorldPlanId } | { readonly kind: 'cancel'; readonly commandId: WorldCancelId }
    | { readonly kind: 'evidence-deadline'; readonly challengeId: WorldEvidenceChallengeId; readonly eventId: SimulationEventId }
    | { readonly kind: 'evidence-exhausted'; readonly challengeId: WorldEvidenceChallengeId; readonly decisionId: SimulationDecisionId }
  readonly payload: import('@clocky/clocky-simulation/world-domain-types').SimulationWorldJsonValue
  readonly outcome: { readonly kind: 'committed' }
    | { readonly kind: 'rejected'; readonly reason: 'insufficient-information' | 'unauthorized' | 'capacity-full' | 'unsupported' | 'policy' }
    | { readonly kind: 'cancelled' }
}
/** Publication and durable receipt are separate from wake consumption. Message text is never projected. */
export interface SimulationProductWorldCasePost {
  readonly operationId: SimulationOperationId
  readonly status: 'pending' | 'applied' | 'rejected' | 'blocked-authority' | 'blocked-dependency' | 'outcome-unknown'
  readonly publication: 'unpublished' | 'in-flight' | 'unknown' | 'published'
  readonly delivery: 'not-received' | 'received'
  readonly channelId: ChannelId
  readonly envelopeId?: EnvelopeId | undefined
}
/** An original wake proves scheduling responsibility, never successful communication. */
export interface SimulationProductWorldCaseWake {
  readonly id: SimulationEventId
  readonly status: 'scheduled' | 'pending' | 'claimed' | 'completed' | 'cancelled' | 'absent'
  readonly decisionId?: SimulationDecisionId | undefined
}
/** Latest original evidence metadata; answer text obeys the independent case-prose permission. */
export interface SimulationProductWorldCaseEvidence {
  /** Latest accepted input revision, or zero before any answer. */
  readonly inputRevision: number
  /** At most one latest question, with trusted field descriptions and actual prepared attempt count. */
  readonly latestChallenge?: {
    readonly id: WorldEvidenceChallengeId
    readonly status: 'awaiting' | 'answered' | 'expired' | 'exhausted' | 'cancelled'
    readonly round: number
    readonly fields: readonly { readonly code: WorldEvidenceFieldCode; readonly description: SimulationProductText }[]
    readonly responders: readonly SimulationEntityId[]
    readonly deadline: SimTime
    readonly maxAttempts: number
    readonly attemptsUsed: number
  } | undefined
  /** At most one immutable latest answer; no Session, binding or private source content is copied. */
  readonly latestRevision?: {
    readonly id: WorldEvidenceRevisionId
    readonly revision: number
    readonly sequence: number
    readonly actorId: SimulationEntityId
    readonly answers: { readonly status: 'withheld' }
      | { readonly status: 'allowed'; readonly items: readonly { readonly field: WorldEvidenceFieldCode; readonly text: SimulationProductText }[] }
  } | undefined
}
/** Domain-owned durable preparation states; none implies the state of plan authorization or notification. */
export type SimulationProductWorldCaseResponsibility = {
  readonly kind: 'personnel'
  readonly status: 'reserved' | 'fenced' | 'ready' | 'blocked' | 'cancel-requested' | 'cancelled' | 'committed'
} | {
  readonly kind: 'representative'
  readonly status: 'reserved' | 'preparing' | 'committed' | 'cancel-requested' | 'abandoned'
} | {
  readonly kind: 'contact'
  readonly status: 'reserved' | 'committed' | 'cancel-requested' | 'cancelled'
}
/** Original responsibility references; an unsettled record proves retained duty, not failed or safely retryable IO. */
export type SimulationProductWorldCaseResponsibilityRecord = SimulationProductWorldCaseResponsibility & {
  readonly id: WorldIntentId
  readonly planId: WorldPlanId
  readonly sequence: number
  readonly updatedSequence: number
}

/** An admitted callback without confirmation stays unknown independently of any committed business result. */
export type SimulationProductWorldCaseExecutionObservation = {
  readonly planId: WorldPlanId
  readonly mode: 'execute' | 'reconcile'
  readonly sequence: number
  readonly updates: number
  readonly time: SimTime
} & ({ readonly status: 'settled'; readonly reason: null }
  | { readonly status: 'blocked' | 'outcome-unknown'; readonly reason: import('@clocky/clocky-simulation/world-execution').WorldExecutionReason })

/** Actual original notification duties; receipt, delivery and wake consumption remain separate. */
export interface SimulationProductWorldCaseNotificationLifecycle {
  /** Null denotes a Native scenario trigger; no Channel publication is implied. */
  readonly request: SimulationProductWorldCasePost | null
  readonly result?: { readonly resultId: WorldResultId
    readonly wake: SimulationProductWorldCaseWake
    readonly post?: SimulationProductWorldCasePost | undefined } | undefined
  readonly firstAction?: { readonly wake: SimulationProductWorldCaseWake
    readonly post?: SimulationProductWorldCasePost | undefined } | undefined
}
/** Browser-safe lifecycle metadata; none means no original fact, never an inferred failure. */
export interface SimulationProductWorldCaseLifecycle {
  readonly request: { readonly status: SimulationProductWorldCaseStatus }
  readonly plan: { readonly status: 'none' }
    | Pick<SimulationProductWorldCasePlan, 'id' | 'status' | 'resolution'>
  readonly execution: {
    readonly callback: { readonly status: 'none' } | SimulationProductWorldCaseExecutionObservation
    readonly business: { readonly status: 'none' }
      | { readonly status: 'committed' | 'rejected' | 'cancelled'; readonly resultId: WorldResultId }
  }
  readonly notification: SimulationProductWorldCaseNotificationLifecycle
}

/** Four finite views project owned facts rather than forwarding Native objects. */
export type SimulationProductWorldCaseDetail = {
  readonly section: 'request'
  readonly summary: SimulationProductWorldCaseSummary
  readonly source: ({ readonly kind: 'decision'; readonly operationId: SimulationOperationId }
    | { readonly kind: 'authenticated-user'; readonly commandId: import('./administration-types.ts').SimulationProductCommandId })
    & { readonly sequence: number; readonly payloadHash: string }
  readonly description: SimulationProductWorldCaseBody
  readonly evidence?: SimulationProductWorldCaseEvidence | undefined
} | {
  readonly section: 'plans'
  readonly summary: SimulationProductWorldCaseSummary
  readonly total: number
  readonly items: readonly SimulationProductWorldCasePlan[]
  readonly nextCursor?: SimulationProductCursor | undefined
} | {
  readonly section: 'execution'
  readonly summary: SimulationProductWorldCaseSummary
  /** Original non-hiring responsibilities, including a shared representative owned by an earlier case. */
  readonly responsibilities?: readonly SimulationProductWorldCaseResponsibilityRecord[] | undefined
  /** Latest original plan callback observation, never copied from a run-wide stop. */
  readonly observation?: SimulationProductWorldCaseExecutionObservation | undefined
  readonly reservation?: { readonly id: WorldIntentId
    readonly planId: WorldPlanId
    readonly status: 'reserved' | 'preparing' | 'candidate' | 'cancel-requested' | 'committed' | 'abandoned'
    readonly sequence: number
    readonly updatedSequence: number
    readonly newborn: { readonly entityId: SimulationEntityId
      readonly readiness: 'absent' | 'preparing' | 'ready' | 'abandoned'
      readonly phase: 'absent' | 'active' | 'inactive' | 'terminated' }
    readonly assignment: { readonly relationId: SimulationRelationId; readonly status: 'absent' | 'retained' }
    readonly cleanup?: { readonly sequence: number; readonly participant: 'absent' | 'left' | 'failed' } | undefined } | undefined
  readonly result?: SimulationProductWorldCaseResult | undefined
} | {
  readonly section: 'notification'
  readonly summary: SimulationProductWorldCaseSummary
} & SimulationProductWorldCaseNotificationLifecycle
/** Authorized absence and a selected finite view share the original query identity. */
export interface SimulationProductWorldCaseInspection {
  readonly runId: SimulationProductRunId
  readonly requestId: WorldRequestId
  readonly section: SimulationProductWorldCaseInput['section']
  readonly snapshotRevision: number
  readonly readVersion: SimulationProductReadVersion
  readonly observedAt: number
  readonly status: 'found' | 'missing'
  readonly value?: SimulationProductWorldCaseDetail | undefined
}
