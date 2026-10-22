import { personnelRoleAuthorities } from './personnel-authorities.ts'
import { assertWorldMutationSlot } from './world-structure-budget.ts'
import { inspectPersonnelObligations } from './personnel-obligations.ts'
import { personnelObligationQuerySchema, PERSONNEL_OBLIGATION_MAX_ITEMS, PERSONNEL_OBLIGATION_MAX_BYTES } from '@clocky/clocky-simulation'
/** Native-owned personnel reservation and fencing transitions; all cross-owner IO remains outside this fold. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { personnelReserveRequestSchema, personnelReservationSchema, personnelFenceSchema,
  WORLD_TRANSFER_PIN, WORLD_DEPART_PIN, simulationWorldTransferPayloadSchema, simulationWorldDepartPayloadSchema,
  worldIntentIdSchema, PersonnelDomainError, activeSimulationMaintenance,
  personnelAuthorityGeneration, personnelObligationReportSchema, personnelObligationTeamCoverageSchema,
  personnelTaskTerminalEvidenceSchema, personnelTerminalSourceFingerprint } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldIntent, SimulationWorldPlan, WorldIntentId, SimTime,
  SimulationEntityId, PersonnelReservation } from '@clocky/clocky-simulation'
import { requireWorld, worldExecutionReads, withWorldResult, worldResultIdentity } from './world.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'
import type { PersonnelDomainOwner } from './world-personnel-domain.ts'

/** Every owner transition retains its complete original request and identity. */
export const personnelRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('personnel/reserved'), reservation: personnelReservationSchema }),
  z.strictObject({ kind: z.literal('personnel/fenced'), fence: personnelFenceSchema }),
  z.strictObject({ kind: z.literal('personnel/ready'), id: worldIntentIdSchema, team: personnelObligationTeamCoverageSchema,
    terminalTasks: z.array(personnelTaskTerminalEvidenceSchema).max(PERSONNEL_OBLIGATION_MAX_ITEMS) }),
  z.strictObject({ kind: z.literal('personnel/cancelled'), id: worldIntentIdSchema }),
])
/** Closed Native personnel transition. */
export type PersonnelRecord = z.infer<typeof personnelRecordSchema>

/**
 * Fence an actual accepted departure in the same Native request append, before any director plan or owner IO.
 * @param state - Prefix containing the original accepted request and its actual source.
 * @param intent - Exact original departure intent.
 * @param requestId - Original accepted request identity.
 * @param sequence - Original acceptance record position.
 * @returns projection with the exact assignment fence and next role generation; no relation or entity is rewritten.
 */
export function acceptDepartureFence(state: SimulationSnapshot, intent: SimulationWorldIntent,
  requestId: import('@clocky/clocky-simulation').WorldRequestId, sequence: number): SimulationSnapshot {
  const world = requireWorld(state), request = world.requests[requestId], payload = simulationWorldDepartPayloadSchema.parse(intent.payload)
  if (!isDeepStrictEqual(intent.pin, WORLD_DEPART_PIN) || request?.intentId !== intent.id || request.status !== 'open'
    || !isDeepStrictEqual(request.proposal.payload, intent.payload)) {
    throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Departure fence requires its actual original accepted request')
  }
  if (Object.values(world.personnel.fences).some(value => value.personId === payload.personId && value.status === 'active'))
    throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Original person already retains an active personnel fence')
  const generation = personnelAuthorityGeneration(state, payload.personId) + 1
  const fence = personnelFenceSchema.parse({ assignmentId: payload.assignmentId, personId: payload.personId,
    intentId: intent.id, requestId, sequence, generation, status: 'active' })
  return { ...state, world: { ...world, personnel: { ...world.personnel,
    fences: { ...world.personnel.fences, [fence.intentId]: fence },
    generations: { ...world.personnel.generations, [payload.personId]: generation } } } }
}

/**
 * Count only actual unsettled target reservations; blocked and uncertain state still occupies capacity.
 * @param state - Original Native snapshot.
 * @param scope - Original organization.
 * @param position - Exact target position.
 * @param exclude - Sole committing original reservation, never an unrelated actor's occupancy.
 * @returns original immutable capacity references.
 */
export function personnelPositionReservations(state: SimulationSnapshot, scope: SimulationEntityId,
  position: SimulationEntityId, exclude?: WorldIntentId): readonly { intentId: WorldIntentId; updatedSequence: number }[] {
  const world = requireWorld(state)
  return Object.values(world.personnel.reservations).filter(value => value.id !== exclude
    && value.status !== 'committed' && value.status !== 'cancelled' && value.targetPositionId === position
    && world.intents[value.id]?.scopeEntityId === scope).map(value => ({ intentId: value.id, updatedSequence: value.updatedSequence }))
}
function source(state: SimulationSnapshot, id: WorldIntentId) {
  const world = requireWorld(state), reservation = world.personnel.reservations[id]
  if (reservation === undefined) throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel reservation is not retained')
  const intent = world.intents[id], plan = world.plans[reservation.request.planId], request = world.requests[reservation.requestId]
  if (intent === undefined || plan === undefined || request?.intentId !== id || plan.requestId !== request.id)
    throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel reservation lost its original plan and request')
  return { world, reservation, intent, plan, request }
}

/**
 * Require the original ready reservation and proven-quiescent maintenance before a pure personnel effect.
 * @param state - Actual precommit Native prefix.
 * @param intent - Original accepted business identity.
 * @param plan - Original unchanged apply plan.
 * @param effectiveAt - Actual simulated safe-boundary time, never wall-clock or backfilled time.
 * @returns exact previously frozen role-authority closures; obligations are not automatically transferred.
 */
export function requirePersonnelCommit(state: SimulationSnapshot, intent: SimulationWorldIntent,
  plan: SimulationWorldPlan, effectiveAt: SimTime): { closedAuthorityRelationIds: readonly import('@clocky/clocky-simulation').SimulationRelationId[] } {
  const original = source(state, intent.id), maintenance = activeSimulationMaintenance(state)
  if (original.reservation.status !== 'ready' || original.reservation.evidence?.complete !== true
    || original.reservation.evidence.status !== 'covered' || !isDeepStrictEqual(original.plan, plan)
    || !isDeepStrictEqual(original.intent, intent) || effectiveAt !== state.time || state.phase !== 'paused'
    || maintenance?.status !== 'quiescent' || !isDeepStrictEqual(maintenance.request, original.reservation.request.maintenance)
    || Object.values(state.entities).some(value => value.writer !== undefined && value.writer.phase !== 'released')) {
    throw new PersonnelDomainError('SIM_PERSONNEL_HANDOFF_REQUIRED', 'Personnel commit requires its original complete settled cut and quiescent owner')
  }
  const blockers = original.reservation.evidence.items.filter(item => !settlesOwnReference(original.reservation, item.ref))
  if (blockers.length) throw new PersonnelDomainError('SIM_PERSONNEL_HANDOFF_REQUIRED', 'Original personnel duties require their explicit owner settlement')
  return { closedAuthorityRelationIds: original.reservation.closedAuthorityRelationIds }
}
/**
 * Identify only references this original closed personnel mutation itself settles.
 * @param reservation - Original Native reservation and exact approved authority closures.
 * @param ref - Actual inventoried original owner reference, never a free-text claim.
 * @returns true only for this reservation, its case and approved role relation closures; other duties remain owned.
 */
export function settlesOwnReference(reservation: PersonnelReservation,
  ref: import('@clocky/clocky-simulation').PersonnelObligationReference): boolean {
  return ref.kind === 'world-reservation' && ref.intentId === reservation.id
    || ref.kind === 'world-case' && ref.intentId === reservation.id && ref.requestId === reservation.requestId
    || ref.kind === 'relation' && (ref.id === reservation.assignmentId || reservation.revokedAuthorityRelationIds.includes(ref.id))
}

/** Pure owner capabilities supplied to installed personnel domains. */
export const personnelDomainOwner: PersonnelDomainOwner = {
  positionReservations: personnelPositionReservations, requireCommit: requirePersonnelCommit,
}

/**
 * Bind original terminal owner metadata to the actual Native task creation, receipt, binding and selected held Team cursor.
 * @param state - Original Native prefix; no current Team getter or mutable source cache is consulted.
 * @param team - Observed canonical Team cursor from the exact held source cut.
 * @param input - Strict original lease-free terminal task observations supplied only by the runtime-only proof owner.
 * @returns normalized immutable references; mismatched, duplicate or invented receipts reject before append.
 */
export function validatePersonnelTerminalTasks(state: SimulationSnapshot,
  team: Extract<import('@clocky/clocky-simulation').PersonnelObligationReport['coverage']['team'], { kind: 'observed' }>,
  input: readonly import('@clocky/clocky-simulation').PersonnelTaskTerminalEvidence[]):
readonly import('@clocky/clocky-simulation').PersonnelTaskTerminalEvidence[] {
  const parsed = z.array(personnelTaskTerminalEvidenceSchema).max(PERSONNEL_OBLIGATION_MAX_ITEMS).parse(input)
  const ids = new Set<string>()
  for (const task of parsed) {
    const key = JSON.stringify([task.teamId, task.taskId]), operation = state.operations[task.operationId]
    const receipt = operation?.outbox?.taskReceipt
    const binding = operation === undefined ? undefined : state.entities[operation.entityId]?.binding
    if (ids.has(key) || task.runId !== state.spec.runId || task.teamCursor !== team.cursor || task.teamId !== team.teamId
      || operation?.action.kind !== 'task/create' || operation.result?.status !== 'applied'
      || state.decisions[operation.decisionId]?.status !== 'accepted' || receipt?.operationId !== operation.id
      || receipt.teamId !== task.teamId || receipt.taskId !== task.taskId || receipt.fingerprint !== operation.fingerprint
      || task.fingerprint !== receipt.fingerprint || binding?.teamId !== task.teamId || binding.participantId !== task.creatorParticipantId
      || task.idempotencyKey !== JSON.stringify(['simulation-task', state.spec.runId, operation.id]))
      throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY', 'Personnel terminal task evidence lost its original accepted receipt and held source cursor')
    ids.add(key)
  }
  return parsed
}

/**
 * Match only the original external task target; attempts, interactions and cleanup reservations remain separately owned.
 * @param tasks - Validated original terminal metadata, never a task description or claimed successor.
 * @param ref - Exact current Native obligation reference.
 * @returns true only for the same original Team/task/operation/fingerprint target.
 */
export function settledPersonnelTaskTarget(tasks: readonly import('@clocky/clocky-simulation').PersonnelTaskTerminalEvidence[],
  ref: import('@clocky/clocky-simulation').PersonnelObligationReference): boolean {
  return ref.kind === 'task-target' && tasks.some(task => task.teamId === ref.teamId && task.taskId === ref.taskId
    && task.operationId === ref.operationId && task.fingerprint === ref.fingerprint)
}

/**
 * Release only an uncommitted original personnel disposition whose external maintenance has not started or is proven quiescent.
 * @param state - Current Native serializer prefix.
 * @param id - Exact original case being cancelled.
 * @param sequence - Atomic cancellation append position.
 * @returns projection retaining all historical identities and duties; uncertain maintenance rejects without releasing capacity.
 */
export function cancelPersonnelDisposition(state: SimulationSnapshot, id: WorldIntentId, sequence: number): SimulationSnapshot {
  const world = requireWorld(state), personnel = world.personnel, reservation = personnel.reservations[id], fence = personnel.fences[id]
  if (fence === undefined || fence.status !== 'active') return state
  if (personnelCancellationPending(state, id))
    throw new PersonnelDomainError('SIM_PERSONNEL_HANDOFF_REQUIRED', 'Original personnel maintenance must prove its accepted IO stopped before cancellation')
  return { ...state, world: { ...world, personnel: { ...personnel,
    generations: { ...personnel.generations, [fence.personId]: personnelAuthorityGeneration(state, fence.personId) + 1 },
    fences: { ...personnel.fences, [id]: { ...fence, status: 'cancelled' } },
    reservations: reservation === undefined ? personnel.reservations : { ...personnel.reservations,
      [id]: { ...reservation, status: 'cancelled', updatedSequence: sequence } } } } }
}

/**
 * Check whether this original personnel disposition still owns unconfirmed maintenance IO.
 * @param state - Current Native prefix, including retained maintenance history.
 * @param id - Exact original personnel intent being cancelled.
 * @returns true until an initiated original maintenance proves its controller and writer responsibilities stopped.
 */
export function personnelCancellationPending(state: SimulationSnapshot, id: WorldIntentId): boolean {
  const reservation = state.world?.personnel.reservations[id]
  if (reservation === undefined || reservation.status === 'committed' || reservation.status === 'cancelled') return false
  const maintenance = state.maintenance?.[reservation.request.maintenance.id]
  return maintenance !== undefined && (maintenance.status === 'draining'
    || !isDeepStrictEqual(maintenance.request, reservation.request.maintenance)
    || Object.values(state.entities).some(value => value.writer !== undefined && value.writer.phase !== 'released'))
}

function settlePersonnelCancellation(state: SimulationSnapshot, id: WorldIntentId, sequence: number,
  runtime: NativeWorldRuntime): SimulationSnapshot {
  const original = source(state, id), reservation = original.reservation
  const maintenance = state.maintenance?.[reservation.request.maintenance.id]
  const commands = Object.values(original.world.cancellations).filter(value => value.request.requestId === reservation.requestId
    && value.status === 'cancel-requested').sort((a, b) => a.sequence - b.sequence)
  const first = commands[0]
  if (reservation.status !== 'cancel-requested' || original.request.status !== 'cancel-requested'
    || first === undefined || first.sequence >= sequence || maintenance === undefined || maintenance.status === 'draining'
    || !isDeepStrictEqual(maintenance.request, reservation.request.maintenance) || personnelCancellationPending(state, id))
    throw new PersonnelDomainError('SIM_PERSONNEL_HANDOFF_REQUIRED', 'Original personnel cancellation awaits confirmed maintenance cleanup')
  const released = cancelPersonnelDisposition(state, id, sequence), resultId = worldResultIdentity(id)
  const next = withWorldResult(released, { id: resultId, requestId: reservation.requestId, intentId: id,
    source: { kind: 'cancel', commandId: first.request.id }, outcome: { kind: 'cancelled' }, payload: {}, time: state.time, sequence }, runtime)
  const cancellations = { ...original.world.cancellations }
  for (const command of commands) cancellations[command.request.id] = { ...command, resultId,
    status: command.request.id === first.request.id ? 'cancelled' : 'already-resolved' }
  return { ...next, world: { ...requireWorld(next), cancellations } }
}

/**
 * Capture original identity and position capacity before maintenance or other owner IO starts.
 * @param state - Current original Native snapshot.
 * @param input - Strict original plan and maintenance owner request.
 * @param sequence - Next contiguous Native record position.
 * @param runtime - Original explicit pinned pure domain catalog.
 * @returns complete immutable reservation; invalid or stale plans reject before identity or authority changes.
 */
export function preparePersonnelReservation(state: SimulationSnapshot, input: import('@clocky/clocky-simulation').PersonnelReserveRequest,
  sequence: number, runtime: NativeWorldRuntime): PersonnelReservation {
  const request = personnelReserveRequestSchema.parse(input), world = requireWorld(state), plan = world.plans[request.planId]
  const original = plan === undefined ? undefined : world.requests[plan.requestId]
  const intent = original === undefined ? undefined : world.intents[original.intentId]
  if (plan?.status !== 'accepted' || plan.proposal.resolution.kind !== 'apply' || original?.status !== 'open'
    || original.plans.at(-1) !== plan.id || intent === undefined || state.activeWindowId !== undefined
    || ![WORLD_TRANSFER_PIN, WORLD_DEPART_PIN].some(value => isDeepStrictEqual(value, intent.pin))) {
    throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel reservation requires its latest original accepted apply plan')
  }
  assertWorldMutationSlot(state)
  if (Object.values(world.reservations).some(value => value.status !== 'committed' && value.status !== 'abandoned')
    || Object.values(world.personnel.reservations).some(value => value.status !== 'committed' && value.status !== 'cancelled')
    || Object.values(world.external.representatives).some(value => value.status !== 'committed' && value.status !== 'abandoned')) {
    throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Another original structural reservation remains unsettled')
  }
  if (!isDeepStrictEqual(plan.reads, worldExecutionReads(state, intent, runtime)))
    throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel plan lost its exact original execution dependencies')
  runtime.original(plan.pin).validatePlan(state, intent, plan.proposal.resolution)
  const payload = intent.pin.operation === 'transfer' ? simulationWorldTransferPayloadSchema.parse(intent.payload)
    : simulationWorldDepartPayloadSchema.parse(intent.payload)
  const person = state.entities[payload.personId]
  if (person?.binding === undefined) throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY', 'Personnel reservation lost its original canonical person')
  const roleAuthorities = personnelRoleAuthorities(state, person.id, payload.organizationEntityId)
  return personnelReservationSchema.parse({ id: intent.id, requestId: original.id, request, personId: person.id,
    binding: person.binding, assignmentId: payload.assignmentId, assignmentRevision: payload.assignmentRevision,
    targetPositionId: 'targetPositionId' in payload ? payload.targetPositionId : null,
    authorityGeneration: personnelAuthorityGeneration(state, person.id),
    revokedAuthorityRelationIds: [...new Set(roleAuthorities.map(value => value.id))],
    closedAuthorityRelationIds: [...new Set(roleAuthorities.filter(value => BigInt(value.validFrom) < BigInt(state.time))
      .map(value => value.id))],
    status: 'reserved', sequence, updatedSequence: sequence, evidence: null, actualEffectiveAt: null, terminalTasks: [] })
}

/**
 * Fold one retained original personnel transition without any IO, inference or implicit obligation cancellation.
 * @param state - Original preceding Native prefix.
 * @param record - Strict closed transition.
 * @param sequence - Original contiguous journal position.
 * @param runtime - Explicit original parser/reducer catalog.
 * @returns new authoritative personnel projection.
 */
export function foldPersonnel(state: SimulationSnapshot, record: PersonnelRecord, sequence: number,
  runtime: NativeWorldRuntime): SimulationSnapshot {
  const world = requireWorld(state), personnel = world.personnel
  switch (record.kind) {
    case 'personnel/cancelled': return settlePersonnelCancellation(state, record.id, sequence, runtime)
    case 'personnel/reserved': {
      const expected = preparePersonnelReservation(state, record.reservation.request, sequence, runtime)
      if (!isDeepStrictEqual(expected, record.reservation))
        throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel reservation changed its original derived identity')
      const fence = personnel.fences[expected.id]
      const retained = fence?.status === 'active' && fence.intentId === expected.id ? { ...expected, status: 'fenced' as const } : expected
      return { ...state, world: { ...world, personnel: { ...personnel,
        reservations: { ...personnel.reservations, [expected.id]: retained } } } }
    }
    case 'personnel/fenced': {
      const original = source(state, record.fence.intentId), fence = record.fence
      if (fence.assignmentId !== original.reservation.assignmentId || fence.personId !== original.reservation.personId
      || fence.requestId !== original.reservation.requestId || fence.sequence !== sequence || fence.status !== 'active'
      || fence.generation !== personnelAuthorityGeneration(state, fence.personId) + 1
      || Object.values(personnel.fences).some(value => value.personId === fence.personId && value.status === 'active')) {
        throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel fence requires its exact original assignment and next authority generation')
      }
      return { ...state, world: { ...world, personnel: { ...personnel,
        generations: { ...personnel.generations, [fence.personId]: fence.generation },
        fences: { ...personnel.fences, [fence.intentId]: fence }, reservations: { ...personnel.reservations,
          [fence.intentId]: { ...original.reservation, status: 'fenced', updatedSequence: sequence } } } } }
    }
    case 'personnel/ready': {
      const original = source(state, record.id)
      if (original.reservation.status !== 'fenced')
        throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel ready requires its original fenced reservation')
      const team = record.team, person = state.entities[original.reservation.personId]
      if (person === undefined || team.kind !== 'observed' || team.teamId !== original.reservation.binding.teamId
        || team.participantId !== original.reservation.binding.participantId) {
        throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY', 'Personnel evidence lost its original person, assignment or canonical owner prefix')
      }
      const expectedHash = personnelTerminalSourceFingerprint(team, record.terminalTasks)
      if (new Set(team.channels.map(value => value.channelId)).size !== team.channels.length || team.hash !== expectedHash)
        throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY', 'Personnel settled source cut must retain its exact empty foreign duty fingerprint')
      const selector = { kind: 'assignment' as const, personId: person.id, personRevision: person.revision,
        assignmentId: original.reservation.assignmentId, assignmentRevision: original.reservation.assignmentRevision }
      const native = inspectPersonnelObligations(state, personnelObligationQuerySchema.parse({ selector,
        limit: PERSONNEL_OBLIGATION_MAX_ITEMS, maxBytes: PERSONNEL_OBLIGATION_MAX_BYTES }), runtime)
      const terminalTasks = validatePersonnelTerminalTasks(state, team, record.terminalTasks)
      if (terminalTasks.some(task => !native.items.some(item => settledPersonnelTaskTarget([task], item.ref))))
        throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY', 'Personnel terminal evidence must identify an original selected Native task target')
      const retained = native.items.filter(item => !settledPersonnelTaskTarget(terminalTasks, item.ref))
      if (native.overflow !== null || retained.some(item => !settlesOwnReference(original.reservation, item.ref))) {
        throw new PersonnelDomainError('SIM_PERSONNEL_HANDOFF_REQUIRED', 'Personnel source evidence cannot erase an original Native obligation')
      }
      // Native duties derive from this exact prefix; the runtime-only proof separately establishes the held foreign source cut.
      const evidence = personnelObligationReportSchema.parse({ ...native, status: 'covered', complete: true,
        items: retained, totalCount: retained.length,
        coverage: { native: 'complete', team } })
      const accepted = personnelReservationSchema.parse({ ...original.reservation, status: 'ready', evidence,
        terminalTasks, updatedSequence: sequence })
      if (!accepted.evidence?.complete || accepted.evidence.coverage.team.kind !== 'observed')
        throw new PersonnelDomainError('SIM_PERSONNEL_HANDOFF_REQUIRED', 'Personnel source cut remains incomplete')
      return { ...state, world: { ...world, personnel: { ...personnel,
        reservations: { ...personnel.reservations, [record.id]: accepted } } } }
    }
    default: return assertNever(record)
  }
}

function assertNever(record: never): never { throw new Error(`Unknown personnel record: ${String(record)}`) }

/**
 * Verify retained personnel relationships at restore and invariant boundaries without consulting live services.
 * @param state - Reconstructed original Native prefix.
 * @returns normally only when each fence, generation and committed result retains its original owner relationships.
 */
export function assertPersonnelProjection(state: SimulationSnapshot): void {
  const world = state.world
  if (world === undefined) return
  for (const [id, stored] of Object.entries(world.personnel.reservations)) {
    const value = personnelReservationSchema.parse(stored), original = source(state, value.id)
    const person = state.entities[value.personId], assignment = state.relations[value.assignmentId]
    const fence = world.personnel.fences[value.id]
    if (id !== value.id || value.sequence > value.updatedSequence || value.updatedSequence > state.revision
      || !isDeepStrictEqual(person?.binding, value.binding) || assignment?.subject !== value.personId
      || assignment.relation !== 'assignment' || fence?.intentId !== value.id || fence.requestId !== value.requestId
      || !isDeepStrictEqual(original.plan.pin, original.intent.pin))
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel projection lost its original identity, assignment or fence')
    if (value.status === 'committed') {
      const result = Object.values(world.results).find(item => item.intentId === value.id)
      if (fence.status !== 'closed' || value.actualEffectiveAt === null || assignment.validUntil !== value.actualEffectiveAt
        || assignment.revision !== value.assignmentRevision + 1 || result?.outcome.kind !== 'committed'
        || result.sequence !== value.updatedSequence || result.time !== value.actualEffectiveAt)
        throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Committed personnel projection lost its atomic assignment closure or result')
    } else if (value.status !== 'cancelled' && fence.status !== 'active') {
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Unsettled personnel responsibility lost its active original fence')
    }
  }
  const generations = new Map<SimulationEntityId, number>()
  for (const [intentId, stored] of Object.entries(world.personnel.fences)) {
    const fence = personnelFenceSchema.parse(stored), intent = world.intents[fence.intentId], request = world.requests[fence.requestId]
    const payload = intent === undefined ? undefined : intent.pin.operation === 'transfer'
      ? simulationWorldTransferPayloadSchema.parse(intent.payload) : simulationWorldDepartPayloadSchema.parse(intent.payload)
    if (intentId !== fence.intentId || intent === undefined || request?.intentId !== intent.id
      || fence.sequence > state.revision || payload?.personId !== fence.personId || payload.assignmentId !== fence.assignmentId)
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel fence lost its actual accepted request and source assignment')
    generations.set(fence.personId, Math.max(generations.get(fence.personId) ?? 0,
      fence.generation + (fence.status === 'active' ? 0 : 1)))
  }
  for (const [personId, generation] of Object.entries(world.personnel.generations)) {
    if (generations.get(personId as SimulationEntityId) !== generation)
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel role generation differs from its original fence transitions')
  }
  for (const grant of world.personnel.operationGrants) {
    const relation = state.relations[grant.relationId]
    if (relation?.subject !== grant.requesterEntityId || relation.object !== grant.targetEntityId
      || relation.relation !== grant.relation || relation.scope !== grant.scopeEntityId)
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Derived role permission lost its original Native relation')
  }
}
/**
 * Finish the original assignment disposition; the completed journal fold installs its declared target authority.
 * @param state - Projection after the domain's original closed core changes.
 * @param id - Original ready reservation.
 * @param sequence - Atomic original mutation position.
 * @returns the settled personnel directory; history, identity and memory remain intact.
 */
export function finishPersonnelMutation(state: SimulationSnapshot, id: WorldIntentId, sequence: number): SimulationSnapshot {
  const original = source(state, id), reservation = original.reservation, world = original.world
  if (reservation.status !== 'ready') throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel mutation lost its original ready reservation')
  const fence = world.personnel.fences[reservation.id]
  if (fence?.status !== 'active' || fence.intentId !== id) throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel mutation lost its exact source fence')
  const next = state
  const current = requireWorld(next), updated = { ...reservation, status: 'committed' as const,
    updatedSequence: sequence, actualEffectiveAt: state.time }
  return { ...next, world: { ...current, personnel: { ...current.personnel,
    reservations: { ...current.personnel.reservations, [id]: updated },
    fences: { ...current.personnel.fences, [fence.intentId]: { ...fence, status: 'closed' } },
    generations: { ...current.personnel.generations, [reservation.personId]: fence.generation + 1 },
    operationGrants: current.personnel.operationGrants } } }
}
