import { worldEvidenceChallengeIdSchema } from './world-evidence.ts'
/** Durable simulation event keys and bounded drive requests. @module @clocky/clocky-simulation/scheduler */
import { z } from 'zod'
import { simulationEventIdSchema, simulationEventSlotSchema } from './event-identities.ts'
export { simulationEventIdSchema, simulationEventSlotSchema } from './event-identities.ts'
import { simulationWorldCalendarSourceSchema } from './world-calendar.ts'
import { simulationOperationIdSchema, simulationDecisionIdSchema } from './business.ts'
import { simTimeSchema } from './time.ts'
import { simulationResourceReservationIdSchema } from './resource-reservation.ts'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationInteractionIdSchema, simulationCommitmentIdSchema } from './interaction.ts'
import { simulationIngressIdSchema } from './ingress.ts'
import { worldProposalIdSchema, worldIntentIdSchema } from './world-domain.ts'
import { simulationNormReferenceSchema } from './world-norms.ts'

/** Phases whose order is fixed in the run configuration. */
export const simulationEventPhaseSchema = z.enum(['delivery', 'decision', 'deadline'])
/** An exact persisted ordering key; phase order comes from the run policy. */
export const simulationEventKeySchema = z.strictObject({
  time: simTimeSchema,
  microstep: simulationEventSlotSchema,
  phase: simulationEventPhaseSchema,
  slot: simulationEventSlotSchema,
  priority: z.number().int().min(-1000).max(1000).optional(),
})
/** Scheduled domain work; consumption must create a durable fact or responsibility. */
export const simulationEventActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resource-reservation-expiry'), id: simulationResourceReservationIdSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ kind: z.literal('world-calendar'), source: simulationWorldCalendarSourceSchema,
    occurrence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ kind: z.literal('external-adjudicated-event'), intentId: worldIntentIdSchema,
    leafHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }),
  z.strictObject({ kind: z.literal('world-evidence-deadline'), challengeId: worldEvidenceChallengeIdSchema }),
  z.strictObject({ kind: z.literal('world-execution-time'), intentId: worldIntentIdSchema }),
  z.strictObject({ kind: z.literal('norm-boundary'), norm: simulationNormReferenceSchema,
    edge: z.enum(['from', 'until']), bodyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }),
  z.strictObject({ kind: z.literal('governance-deadline'), proposalId: worldProposalIdSchema,
    bodyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }),
  z.strictObject({ kind: z.literal('ingress'), ingressId: simulationIngressIdSchema }),
  z.strictObject({ kind: z.literal('conflict-retry'), operationId: simulationOperationIdSchema,
    rootDecisionId: simulationDecisionIdSchema, attempt: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('outbox-ready'), operationId: simulationOperationIdSchema }),
  z.strictObject({ kind: z.literal('wake'), entityId: simulationEntityIdSchema, reason: z.string().min(1) }),
  z.strictObject({ kind: z.literal('reply-wake'), interactionId: simulationInteractionIdSchema }),
  z.strictObject({ kind: z.literal('reply-deadline'), interactionId: simulationInteractionIdSchema }),
  z.strictObject({ kind: z.literal('commitment-deadline'), commitmentId: simulationCommitmentIdSchema }),
])
/** Administrative wake input; business deadlines are derived from accepted operations. */
export const simulationWakeRequestSchema = z.strictObject({
  id: simulationEventIdSchema, time: simTimeSchema, entityId: simulationEntityIdSchema, reason: z.string().min(1),
})
/** Explicit target time; each call also obeys the persisted per-drive work limit. */
export const simulationDriveRequestSchema = z.strictObject({ until: simTimeSchema })
