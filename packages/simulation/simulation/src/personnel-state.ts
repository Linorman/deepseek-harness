/** Durable personnel reservations, assignment fences and explicitly scenario-owned role permissions. */
import { z } from 'zod'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simulationEntityBindingSchema } from './writer.ts'
import { simulationMaintenanceRequestSchema } from './maintenance.ts'
import { worldIntentIdSchema } from './world-domain.ts'
import { worldRequestIdSchema, worldPlanIdSchema } from './world.ts'
import { personnelObligationReportSchema } from './personnel-obligations.ts'
import { simTimeSchema } from './time.ts'
import { simulationWorldDepartPayloadSchema } from './world-personnel.ts'
import { personnelTaskTerminalEvidenceSchema } from './personnel-terminal.ts'
import type { SimulationSnapshot } from './types.ts'
import type { SimulationWorldOperationGrant } from './world-types.ts'

const sequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
/** Immutable owner-selected maintenance request for one original accepted personnel plan. */
export const personnelReserveRequestSchema = z.strictObject({ planId: worldPlanIdSchema, maintenance: simulationMaintenanceRequestSchema })
/** Native-retained canonical identity and original assignment; no new person, Persona, Participant or Session is allocated. */
export const personnelReservationSchema = z.strictObject({ id: worldIntentIdSchema, requestId: worldRequestIdSchema,
  request: personnelReserveRequestSchema, personId: simulationEntityIdSchema, binding: simulationEntityBindingSchema,
  assignmentId: simulationRelationIdSchema, assignmentRevision: sequence, targetPositionId: simulationEntityIdSchema.nullable(),
  authorityGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  closedAuthorityRelationIds: z.array(simulationRelationIdSchema).max(1024)
    .refine(values => new Set(values).size === values.length, 'Closed role authority references must be distinct'),
  revokedAuthorityRelationIds: z.array(simulationRelationIdSchema).max(1024)
    .refine(values => new Set(values).size === values.length, 'Revoked role authority references must be distinct'),
  status: z.enum(['reserved', 'fenced', 'ready', 'blocked', 'cancel-requested', 'cancelled', 'committed']),
  sequence, updatedSequence: sequence,
  evidence: personnelObligationReportSchema.nullable(), actualEffectiveAt: simTimeSchema.nullable(),
  terminalTasks: z.array(personnelTaskTerminalEvidenceSchema).max(1024),
}).refine(value => value.closedAuthorityRelationIds.every(id => value.revokedAuthorityRelationIds.includes(id)),
  'Physical role closures must belong to the original revoked authority directory')
/** An accepted departure or reserved transfer closes this exact assignment's new-work admission. */
export const personnelFenceSchema = z.strictObject({ assignmentId: simulationRelationIdSchema, personId: simulationEntityIdSchema,
  intentId: worldIntentIdSchema, requestId: worldRequestIdSchema, generation: sequence, sequence,
  status: z.enum(['active', 'cancelled', 'closed']) })
/** Native-owned historical reservations and effective role-generation directory. */
export interface PersonnelState {
  readonly reservations: Readonly<Record<import('./world-domain-types.ts').WorldIntentId, z.infer<typeof personnelReservationSchema>>>
  readonly fences: Readonly<Record<import('./world-domain-types.ts').WorldIntentId, z.infer<typeof personnelFenceSchema>>>
  readonly generations: Readonly<Record<import('./identities.ts').SimulationEntityId, number>>
  readonly operationGrants: readonly SimulationWorldOperationGrant[]
}
/** Caller-owned original reservation request. */
export type PersonnelReserveRequest = z.infer<typeof personnelReserveRequestSchema>
/** Original structural responsibility; unknown state never releases capacity. */
export type PersonnelReservation = z.infer<typeof personnelReservationSchema>
/** Exact source assignment admission fence. */
export type PersonnelFence = z.infer<typeof personnelFenceSchema>
/** Read-only original source evidence carried by a runtime-only commit authority. */
export interface PersonnelCommitEvidence {
  readonly reservationId: import('./world-domain-types.ts').WorldIntentId
  readonly report: import('./personnel-obligations.ts').PersonnelObligationReport
  readonly terminalTasks: readonly import('./personnel-terminal.ts').PersonnelTaskTerminalEvidence[]
}
declare const personnelCommitProofBrand: unique symbol
/** Non-serializable original Team cut authority; a request field or JSON receipt cannot manufacture it. */
export interface PersonnelCommitProof { readonly [personnelCommitProofBrand]: never }
export { worldOperationGrants } from './world-membership.ts'
/**
 * Resolve the actual person's current employment generation, without inferring it from role labels or writer epochs.
 * @param state - Current original Native snapshot.
 * @param personId - Exact person identity.
 * @returns original generation; zero denotes the initial unmodified role directory.
 */
export function personnelAuthorityGeneration(state: SimulationSnapshot, personId: import('./identities.ts').SimulationEntityId): number {
  return state.world?.personnel.generations[personId] ?? 0
}
/**
 * Inspect only live original assignment fences, without treating departure as entity termination.
 * @param state - Current original Native snapshot.
 * @param personId - Exact person whose new employment work is being admitted.
 * @returns active original fences; accepted old effects retain their separate settlement owner.
 */
export function activePersonnelFences(state: SimulationSnapshot,
  personId: import('./identities.ts').SimulationEntityId): readonly PersonnelFence[] {
  return Object.values(state.world?.personnel.fences ?? {}).filter(value => value.personId === personId && value.status === 'active')
}

/**
 * Resolve a committed explicit departure retirement without changing identity or erasing historical memory.
 * @param state - Current Native projection.
 * @param personId - Exact original person.
 * @returns true while the last committed personnel disposition requested retirement and no newer assignment exists.
 */
export function personnelRetired(state: SimulationSnapshot, personId: import('./identities.ts').SimulationEntityId): boolean {
  const world = state.world
  if (world === undefined) return false
  const last = Object.values(world.personnel.reservations).filter(value => value.personId === personId && value.status === 'committed')
    .sort((a, b) => b.updatedSequence - a.updatedSequence)[0]
  if (last === undefined || last.targetPositionId !== null) return false
  const intent = world.intents[last.id]
  if (intent === undefined || !simulationWorldDepartPayloadSchema.parse(intent.payload).retire) return false
  return !Object.values(state.relations).some(value => value.subject === personId && value.relation === 'assignment'
    && BigInt(value.validFrom) >= BigInt(last.actualEffectiveAt ?? state.time)
    && (value.validUntil === null || BigInt(value.validUntil) > BigInt(state.time)))
}
