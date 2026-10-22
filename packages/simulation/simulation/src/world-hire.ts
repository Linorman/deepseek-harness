import { simTimeSchema } from './time.ts'
import { worldIntentIdSchema } from './world-domain.ts'
/** Trusted persistent hire preparation inputs; model proposals cannot invoke these owner operations. */
import { z } from 'zod'
import { simulationHireApprovalBasisSchema } from './world-hire-approval.ts'
import { channelIdSchema } from '@clocky/clocky-team/schema'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simulationEntityBindingSchema } from './writer.ts'
import { simulationMaintenanceRequestSchema } from './maintenance.ts'
import { worldPlanIdSchema, worldRequestIdSchema } from './world.ts'
import { simulationChannelKeySchema } from './schema.ts'
import type { SimulationWorldHireReserveRequest, SimulationWorldHireIdentities, SimulationWorldHireReservation } from './world-hire-types.ts'
import type { SimulationWorldIdentityCleanupEvidence, SimulationWorldIdentityChannelCleanup } from './world-hire-types.ts'
export type { SimulationWorldIdentityCleanupEvidence, SimulationWorldIdentityChannelCleanup } from './world-hire-types.ts'
import type { SimulationSnapshot } from './types.ts'
import type { SimulationEntityId } from './entity-types.ts'
import type { SimulationChannelKey } from './identities.ts'
import { SimulationWorldError } from './world-errors.ts'
import { simulationResourceReservationIdSchema } from './resource-reservation.ts'
import { SimulationHiringResourceError } from './world-hiring-resources.ts'

/** Explicit frozen generated-member route; readiness and decision authority come from Native, never this descriptor. */
export const simulationWorldHireMemberSchema = z.strictObject({
  displayName: z.string().min(1), role: z.literal('member'), capabilities: z.array(z.string()).max(0),
  provider: z.literal('in-process'), preset: z.string().min(1), model: z.string().min(1), modelVersion: z.string().min(1),
})
/** Original accepted plan, trusted maintenance owner and immutable member configuration. */
export const simulationWorldHireReserveRequestSchema = z.strictObject({
  planId: worldPlanIdSchema, maintenance: simulationMaintenanceRequestSchema, member: simulationWorldHireMemberSchema,
}) satisfies z.ZodType<SimulationWorldHireReserveRequest>
/** All cross-owner identities are stored before any Participant, Session or Channel IO begins. */
export const simulationWorldHireIdentitiesSchema = z.strictObject({
  entityId: simulationEntityIdSchema, relationId: simulationRelationIdSchema, binding: simulationEntityBindingSchema,
  channels: z.tuple([
    z.strictObject({ purpose: z.literal('director'), key: simulationChannelKeySchema, channelId: channelIdSchema }),
    z.strictObject({ purpose: z.literal('requester'), key: simulationChannelKeySchema, channelId: channelIdSchema }),
  ]),
}) satisfies z.ZodType<SimulationWorldHireIdentities>
const cleanupCursorSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** A missing original Channel or its immutable terminal state, preserving its actual cursor. */
export const simulationWorldIdentityChannelCleanupSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('absent'), channelId: channelIdSchema }),
  z.strictObject({ phase: z.enum(['closed', 'expired', 'failed']), channelId: channelIdSchema, cursor: cleanupCursorSchema }),
]) satisfies z.ZodType<SimulationWorldIdentityChannelCleanup>
/** Cross-owner cleanup of the exact pre-IO identity tuple; unknown or live states cannot settle a cancellation. */
export const simulationWorldIdentityCleanupEvidenceSchema = z.strictObject({
  binding: simulationEntityBindingSchema, teamCursor: cleanupCursorSchema,
  participant: z.enum(['absent', 'left', 'failed']), session: z.literal('unmaterialized'),
  channels: z.tuple([simulationWorldIdentityChannelCleanupSchema, simulationWorldIdentityChannelCleanupSchema]),
}) satisfies z.ZodType<SimulationWorldIdentityCleanupEvidence>
/** Immutable reservation plus its owned settlement; unresolved cancellation retains capacity and identities. */
export const simulationWorldHireReservationSchema = z.strictObject({
  resourceReservationId: simulationResourceReservationIdSchema.optional(),
  approvals: z.array(simulationHireApprovalBasisSchema),
  id: worldIntentIdSchema, requestId: worldRequestIdSchema, request: simulationWorldHireReserveRequestSchema,
  identities: simulationWorldHireIdentitiesSchema, sequence: z.number().int().positive(), updatedSequence: z.number().int().positive(),
  reservedAt: simTimeSchema,
  prepared: z.strictObject({ time: simTimeSchema, sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).optional(),
  status: z.enum(['reserved', 'preparing', 'candidate', 'cancel-requested', 'committed', 'abandoned']),
  candidate: z.strictObject({ time: simTimeSchema, sequence: z.number().int().positive(),
    maintenance: simulationMaintenanceRequestSchema }).optional(),
  cleanup: z.strictObject({ sequence: z.number().int().positive(), evidence: simulationWorldIdentityCleanupEvidenceSchema }).optional(),
}).superRefine((reservation, ctx) => {
  if (reservation.status === 'reserved' && reservation.prepared !== undefined
    || ['preparing', 'candidate', 'committed', 'cancel-requested'].includes(reservation.status) && reservation.prepared === undefined)
    ctx.addIssue({ code: 'custom', path: ['prepared'], message: 'Preparation evidence must match reservation status' })
  if (reservation.prepared !== undefined && (BigInt(reservation.prepared.time) < BigInt(reservation.reservedAt)
    || reservation.prepared.sequence <= reservation.sequence || reservation.prepared.sequence > reservation.updatedSequence))
    ctx.addIssue({ code: 'custom', path: ['prepared'], message: 'Preparation must follow reservation and precede settlement' })
  if ((reservation.status === 'candidate') !== (reservation.candidate !== undefined && reservation.status !== 'committed' && reservation.status !== 'abandoned'))
    ctx.addIssue({ code: 'custom', path: ['candidate'], message: 'Candidate readiness requires its confirmed original transition' })
  if (reservation.cleanup !== undefined && reservation.prepared === undefined)
    ctx.addIssue({ code: 'custom', path: ['cleanup'], message: 'Cleanup requires original preparation evidence' })
  if (reservation.cleanup === undefined) return
  const { evidence, sequence } = reservation.cleanup
  if (reservation.status !== 'abandoned' || sequence !== reservation.updatedSequence || sequence <= reservation.sequence) {
    ctx.addIssue({ code: 'custom', path: ['cleanup'], message: 'Cleanup belongs to the original prepared abandonment transition' })
  }
  for (const key of ['teamId', 'participantId', 'sessionId'] as const) {
    if (evidence.binding[key] !== reservation.identities.binding[key]) {
      ctx.addIssue({ code: 'custom', path: ['cleanup', 'evidence', 'binding', key], message: 'Cleanup changed its original binding' })
    }
  }
  for (const [index, channel] of evidence.channels.entries()) {
    if (channel.channelId !== reservation.identities.channels[index]?.channelId) {
      ctx.addIssue({ code: 'custom', path: ['cleanup', 'evidence', 'channels', index, 'channelId'], message: 'Cleanup changed its original Channel order or identity' })
    }
  }
}) satisfies z.ZodType<SimulationWorldHireReservation>

/**
 * Withdraw preparation authority after cancellation or accepted-plan invalidation.
 * @param state - Current Native projection, rechecked around each external topology operation.
 * @param entityIds - Every member of the topology operation, including consent by an existing actor.
 * @param channelKey - Exact conversation key when the operation creates or confirms a Channel.
 * New IO rejects for unsettled hires whose original case/plan is no longer executable. Existing durable
 * identity observations remain available for cleanup; this check neither releases capacity nor settles IO.
 */
export function assertSimulationWorldPreparationAdmission(state: SimulationSnapshot, entityIds: readonly SimulationEntityId[],
  channelKey?: SimulationChannelKey): void {
  if (state.worldBootstrap?.status === 'retained' && entityIds.some(id => state.worldBootstrap?.request.actorIds.includes(id)))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Original scenario initialization must settle before ordinary cognition or IO')
  const world = state.world
  if (world === undefined) return
  if (channelKey !== undefined) {
    const contacts = Object.values(world.external.contacts).filter(contact => contact.channel.key === channelKey)
    if (contacts.some(contact => contact.status === 'cancel-requested')
      && !contacts.some(contact => contact.status === 'reserved' || contact.status === 'committed'))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Withdrawn contact cannot authorize further conversation IO')
    if (contacts.length && !contacts.some(contact => contact.status !== 'cancelled'))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Cancelled conversation history cannot be reopened or recycled')
  }
  for (const value of Object.values(world.external.representatives)) {
    if (!entityIds.includes(value.identities.entityId) || value.status === 'committed') continue
    const request = world.requests[value.requestId], plan = world.plans[value.request.planId]
    if (value.status !== 'preparing' || request?.status !== 'open' || plan?.status !== 'accepted' || request.plans.at(-1) !== plan.id)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Representative preparation authority was withdrawn; retain original cleanup responsibility')
  }
  for (const reservation of Object.values(world.reservations)) {
    if (!entityIds.includes(reservation.identities.entityId) || reservation.status === 'committed' || reservation.candidate !== undefined) continue
    const request = world.requests[reservation.requestId], plan = world.plans[reservation.request.planId]
    if (reservation.status !== 'preparing' || request?.status !== 'open' || plan?.status !== 'accepted'
      || request.plans.at(-1) !== plan.id) {
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'World preparation authority was withdrawn; retain original identities and cleanup responsibility')
    }
    const intent = world.intents[reservation.id]
    const fee = world.definition.hiringFees?.find(value => value.operation === 'generate-and-hire'
      && value.positionEntityId === intent?.targetEntityId)
    if (fee !== undefined) {
      const hold = reservation.resourceReservationId === undefined ? undefined
        : state.resourceReservations[reservation.resourceReservationId]
      if (hold === undefined || hold.world?.intentId !== reservation.id || hold.world.planId !== plan.id)
        throw new SimulationHiringResourceError('stale')
      if (hold.phase !== 'active' || hold.world.expiryConsumed !== undefined || BigInt(state.time) >= BigInt(hold.expiresAt))
        throw new SimulationHiringResourceError('expired')
      if (hold.transaction.reads.some(read => state.resources[read.resourceId]?.revision !== read.revision))
        throw new SimulationHiringResourceError('stale')
      const grants = hold.grants.map(id => state.grants[id])
      if (grants.some(grant => grant?.phase !== 'available' || grant.grantee !== hold.actorId
        || state.entities[grant.issuer]?.phase !== 'active'
        || grant.resources.some(id => !state.resources[id]?.controllers.includes(grant.issuer)))
        || hold.transaction.transfers.some(transfer => !state.resources[transfer.from]?.controllers.includes(hold.actorId)
          && !grants.some(grant => grant?.resources.includes(transfer.from))))
        throw new SimulationHiringResourceError('authority')
    }
  }
}

/**
 * Inspect every Native-generated cognitive identity obligation under its original domain owner.
 * @param state - Authoritative snapshot; returned records grant no lifecycle or employment rights.
 * @returns original hire and external representative preparations, including retained cancellation responsibility.
 */
export function worldActorPreparations(state: SimulationSnapshot): readonly (
  import('./world-hire-types.ts').SimulationWorldHireReservation | import('./world-external-types.ts').SimulationExternalRepresentativeReservation
)[] {
  return [...Object.values(state.world?.reservations ?? {}), ...Object.values(state.world?.external.representatives ?? {})]
}
