/** A second domain registers only its strict schema, pure Native policy and public execution adapter. */
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { simulationWorldDomainPinSchema, simulationEntityIdSchema, simulationRelationIdSchema, simTimeSchema,
  simulationWorldReadSetSchema, simulationChangeSchema, SimulationWorldError } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldIntent, SimulationEntityId,
  SimulationWorldDomainRequest, SimulationWorldBusinessResolution, SimulationWorldPlan, SimulationWorldJsonValue,
  SimulationRun } from '@clocky/clocky-simulation'
import type { WorldExecutionHandler } from '@clocky/clocky-simulation-world'

const interval = { roomEntityId: simulationEntityIdSchema, from: simTimeSchema, until: simTimeSchema }
const validInterval = (value: { from: string; until: string }) => BigInt(value.from) < BigInt(value.until)
const request = z.strictObject({ ...interval, organizationEntityId: simulationEntityIdSchema, description: z.string().min(1) })
  .refine(validInterval, 'Booking intervals are half-open and nonempty')
const plan = z.strictObject(interval).refine(validInterval, 'Booking intervals are half-open and nonempty')
const result = z.union([z.strictObject({ ...interval, relationId: simulationRelationIdSchema }), z.strictObject({})])

/** Frozen appointment operation; unrelated hiring content cannot satisfy its parser. */
export const BOOKING_PIN = simulationWorldDomainPinSchema.parse({ domain: 'meeting-room', operation: 'book', version: '1',
  schemaRef: 'clocky.test.meeting-room/schema/1', implementationRef: 'clocky.test.meeting-room/native/1', generation: 1 })
/** Strict test-domain definition installed through the same production catalogs. */
export const BOOKING_DEFINITION = { domain: BOOKING_PIN.domain, operation: BOOKING_PIN.operation, version: BOOKING_PIN.version,
  schemaRef: BOOKING_PIN.schemaRef, schemas: { request, plan, result, mutation: z.strictObject({}) } }

/** Pure appointment owner; effect projection uses existing scoped Relation records. */
export class BookingNativeDomain implements NativeWorldDomain {
  // Booking affects its actual requester and a non-person room, without an additional existing person.
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }

  readonly definition = BOOKING_DEFINITION
  readonly ref = BOOKING_PIN.implementationRef
  readonly generation = BOOKING_PIN.generation

  admitRequest(state: SimulationSnapshot, _actorId: SimulationEntityId, proposed: SimulationWorldDomainRequest) {
    const payload = request.parse(proposed.payload)
    if (payload.organizationEntityId !== state.world?.definition.organizationEntityId || proposed.expectedTime !== null
      || proposed.evidence.length !== 0)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT',
        'Booking requires this organization and its declared interval without supplemental evidence')
    return { scopeEntityId: payload.organizationEntityId, targetEntityId: payload.roomEntityId,
      description: payload.description, payload }
  }

  planningContext(_state: SimulationSnapshot, intent: SimulationWorldIntent) {
    return { booking: request.parse(intent.payload) }
  }

  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    if (resolution.kind === 'reject') return
    const selected = plan.parse(resolution.payload), original = request.parse(intent.payload), room = state.entities[selected.roomEntityId]
    if (selected.roomEntityId !== original.roomEntityId || selected.from !== original.from || selected.until !== original.until
      || room?.kind !== 'room' || room.cognition !== 'none' || room.phase !== 'active' || BigInt(selected.from) < BigInt(state.time))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Booking plan must retain its original available room and future interval')
    if (Object.values(state.relations).some(value => value.relation === 'booking' && value.object === selected.roomEntityId
      && value.scope === intent.scopeEntityId && BigInt(value.validFrom) < BigInt(selected.until)
      && (value.validUntil === null || BigInt(selected.from) < BigInt(value.validUntil))))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Booking interval overlaps an existing accepted booking')
  }

  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const payload = request.parse(intent.payload), room = state.entities[payload.roomEntityId]
    if (room?.kind !== 'room' || room.cognition !== 'none' || room.phase !== 'active')
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Booking room is unavailable')
    const bookings = Object.values(state.relations).filter(value => value.relation === 'booking'
      && value.object === room.id && value.scope === intent.scopeEntityId).map(value => ({ id: value.id, revision: value.revision,
      from: value.validFrom, until: value.validUntil })).sort((a, b) => a.id.localeCompare(b.id))
    return simulationWorldReadSetSchema.parse([{ kind: 'entity', id: room.id, revision: room.revision },
      { kind: 'relation-set', relation: 'booking', object: room.id, scope: intent.scopeEntityId,
        hash: `sha256:${createHash('sha256').update(JSON.stringify(bookings)).digest('hex')}` }])
  }

  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, accepted: SimulationWorldPlan,
    payload: SimulationWorldJsonValue) {
    this.definition.schemas.mutation.parse(payload)
    if (accepted.proposal.resolution.kind !== 'apply') throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'Booking requires its apply plan')
    this.validatePlan(state, intent, accepted.proposal.resolution)
    const selected = plan.parse(accepted.proposal.resolution.payload), relationId = simulationRelationIdSchema.parse(`booking:${intent.id}`)
    return { changes: [simulationChangeSchema.parse({ kind: 'relation/create', id: relationId, subject: intent.requesterEntityId,
      object: selected.roomEntityId, scope: intent.scopeEntityId, relation: 'booking', validFrom: selected.from,
      validUntil: selected.until })],
    resultPayload: { ...selected, relationId } }
  }
}

/** Public execution capability; no private Native provider import or driver branch is required. */
export class BookingExecution implements WorldExecutionHandler {
  readonly definition = BOOKING_DEFINITION
  readonly ref = BOOKING_PIN.implementationRef
  readonly generation = BOOKING_PIN.generation
  private readonly run: SimulationRun
  constructor(run: SimulationRun) { this.run = run }
  reconciliationPlans(): readonly SimulationWorldPlan['id'][] { return [] }
  retainsResponsibility(_plan: SimulationWorldPlan): boolean { return false }
  async execute(plan: SimulationWorldPlan) { await this.run.commitWorldMutation({ planId: plan.id, payload: {} }); return undefined }
  async reconcile(_plan: SimulationWorldPlan): Promise<void> { throw new Error('Atomic booking has no uncertain external IO to reconcile') }
}
