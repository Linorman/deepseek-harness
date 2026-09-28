/** Durable simulation event keys and bounded drive requests. @module @clocky/clocky-simulation/scheduler */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import { simulationOperationIdSchema, simulationDecisionIdSchema } from './business.ts'
import { simTimeSchema } from './time.ts'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationInteractionIdSchema, simulationCommitmentIdSchema } from './interaction.ts'
import { simulationIngressIdSchema } from './ingress.ts'

/** Stable event identity within a run. */
export const simulationEventIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationEventId'>)
/** Canonical decimal event counter, independent of storage and decision cursors. */
export const simulationEventSlotSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as Branded<'SimulationEventSlot'>)
/** Phases whose order is fixed in the run configuration. */
export const simulationEventPhaseSchema = z.enum(['delivery', 'decision', 'deadline'])
/** An exact persisted ordering key; phase order comes from the run policy. */
export const simulationEventKeySchema = z.strictObject({
  time: simTimeSchema,
  microstep: simulationEventSlotSchema,
  phase: simulationEventPhaseSchema,
  slot: simulationEventSlotSchema,
})
/** Scheduled domain work; consumption must create a durable fact or responsibility. */
export const simulationEventActionSchema = z.discriminatedUnion('kind', [
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
