import { parsePersonaManagementCommand } from './world-management-schema.ts'
/** Resolve bounded human form choices against the actual Native person, assignment and installed positions. */
import type { SimulationSnapshot, SimulationRelation } from '@clocky/clocky-simulation'
import { simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationWorldManagementAction } from '@clocky/clocky-simulation/world-management-types'
import type { SimulationProductWorldManagementDraft, SimulationProductWorldManagementFields,
  SimulationProductWorldManagementFieldsInput } from './world-management-types.ts'
import { SimulationProductError } from './index.ts'

interface Options {
  readonly maxReasonBytes: number
  readonly name: (id: string) => string
}
function current(state: SimulationSnapshot, relation: SimulationRelation): boolean {
  return BigInt(relation.validFrom) <= BigInt(state.time)
    && (relation.validUntil === null || BigInt(state.time) < BigInt(relation.validUntil))
}
function person(state: SimulationSnapshot, id: SimulationProductWorldManagementFieldsInput['targetId']) {
  const target = Object.hasOwn(state.entities, id) ? state.entities[id] : undefined
  if (target?.kind !== 'person' || state.world === undefined) throw unavailable('World management person history is unavailable')
  return { target, world: state.world }
}
/**
 * Publish current exact choice identities; form inspection neither reserves work nor implies permission to submit.
 * @param state - Authoritative Native read prefix, independent of an execution owner.
 * @param input - Authorized run-local person and one installed action.
 * @param options - Resolved complete-reason allowance and metadata-only name selector.
 * @returns bounded source-stated fields; empty required choices explicitly make the form unavailable.
 */
export function worldManagementFields(state: SimulationSnapshot, input: SimulationProductWorldManagementFieldsInput,
  options: Options): SimulationProductWorldManagementFields {
  if (input.action === 'hiring-market') {
    const target = state.entities[input.targetId]
    if (target?.kind !== 'position' || !state.world?.definition.positions.some(value => value.entityId === target.id))
      throw unavailable('Persona review requires its declared target position')
    return { apiVersion: 'clocky.world-management/v1', ...input, snapshotRevision: state.revision, targetRevision: state.revision,
      status: 'available', fields: [{ id: 'command', kind: 'persona', required: true, maxBytes: options.maxReasonBytes,
        organizationEntityId: state.world.definition.organizationEntityId, positionEntityId: target.id, now: state.time,
        maxTime: state.spec.maxTime, maxRevisions: 16, templates: [...state.world.definition.templates] }] }
  }
  const { target, world } = person(state, input.targetId)
  const assignments = Object.values(state.relations).filter(value => value.relation === 'assignment'
    && value.subject === target.id && value.scope === world.definition.organizationEntityId && current(state, value))
  const positions = world.definition.positions.map(value => ({ id: value.entityId, label: options.name(value.entityId) }))
  const fields: SimulationProductWorldManagementFields['fields'] = []
  if (input.action !== 'hire-existing') fields.push({ id: 'assignmentId', kind: 'choice', required: true,
    options: assignments.map(value => ({ id: value.id, label: `${options.name(value.object)} · ${value.id} r${value.revision}` })) })
  if (input.action !== 'depart') fields.push({ id: 'position', kind: 'choice', required: true, options: positions })
  if (input.action !== 'hire-existing') fields.push({ id: 'effective', kind: 'choice', required: true, options: [
    { id: 'boundary', label: 'Next safe boundary' }, { id: 'at', label: 'Specified simulated time' },
  ] }, { id: 'at', kind: 'time', required: false })
  if (input.action === 'depart') fields.push({ id: 'retire', kind: 'choice', required: true, options: [
    { id: 'no', label: 'Keep independent activity' }, { id: 'yes', label: 'Retire cognition after confirmed settlement' },
  ] })
  fields.push({ id: 'reason', kind: 'text', required: true, maxBytes: options.maxReasonBytes })
  const unavailableChoice = fields.some(field => field.kind === 'choice' && field.required && field.options.length === 0)
  return { apiVersion: 'clocky.world-management/v1', ...input, snapshotRevision: state.revision, targetRevision: target.revision,
    status: unavailableChoice ? 'unavailable' : 'available', ...!unavailableChoice ? {} : { reason: 'no-current-target' }, fields }
}
/**
 * Resolve one exact original user form to an installed Native action; client-supplied authority and replacement identities do not exist.
 * @param state - Current authoritative Native prefix used for preview or fresh submission resolution.
 * @param input - Strict original choices and the displayed person's exact revision.
 * @param options - Explicit complete-description allowance and public name reader.
 * @returns a complete immutable Native action; changed people/assignments or undeclared positions refuse before acceptance.
 */
export function resolveWorldManagementDraft(state: SimulationSnapshot, input: SimulationProductWorldManagementDraft,
  options: Options): SimulationWorldManagementAction {
  if (input.action === 'hiring-market') {
    if (input.expectedRevision !== state.revision) throw stale('Persona review requires its displayed Native revision')
    const command = parsePersonaManagementCommand(input.values.command)
    if (state.world?.definition.organizationEntityId !== command.organizationEntityId
      || input.targetId !== command.positionEntityId) throw invalid('Persona review differs from its original scope and position')
    if (Buffer.byteLength(JSON.stringify(input.values), 'utf8') > options.maxReasonBytes)
      throw invalid('Complete Persona review exceeds its byte allowance')
    return { kind: 'hiring-market', payload: command }
  }
  const { target, world } = person(state, input.targetId)
  if (target.revision !== input.expectedRevision) throw stale('World management target changed since inspection')
  if (Buffer.byteLength(input.values.reason, 'utf8') > options.maxReasonBytes)
    throw invalid('World management description exceeds its complete byte allowance')
  const description = input.values.reason, organizationEntityId = world.definition.organizationEntityId
  if (input.action === 'hire-existing') {
    if (!world.definition.positions.some(value => value.entityId === input.values.position)) throw invalid('World target position is undeclared')
    return { kind: 'hire-existing', payload: { organizationEntityId, personId: target.id,
      positionEntityId: input.values.position, description } }
  }
  const assignment = Object.hasOwn(state.relations, input.values.assignmentId) ? state.relations[input.values.assignmentId] : undefined
  if (assignment?.relation !== 'assignment' || assignment.subject !== target.id || assignment.scope !== organizationEntityId
    || !current(state, assignment)) throw stale('World management assignment is no longer current for this person')
  const at = input.values.effective === 'at' ? input.values.at : null
  if (at === undefined) throw invalid('World management exact effective time is absent')
  const payload = { organizationEntityId, personId: target.id, assignmentId: assignment.id, assignmentRevision: assignment.revision,
    requestedEffectiveAt: at === null ? null : simTimeSchema.parse(at), description }
  if (input.action === 'depart') return { kind: 'depart', payload: { ...payload, retire: input.values.retire === 'yes' } }
  if (!world.definition.positions.some(value => value.entityId === input.values.position)) throw invalid('World target position is undeclared')
  return { kind: 'transfer', payload: { ...payload, targetPositionId: input.values.position } }
}
function invalid(message: string): SimulationProductError { return new SimulationProductError(message, 'SIMULATION_PRODUCT_INVALID') }
function stale(message: string): SimulationProductError { return new SimulationProductError(message, 'SIMULATION_PRODUCT_STALE') }
function unavailable(message: string): SimulationProductError { return new SimulationProductError(message, 'SIMULATION_PRODUCT_UNAVAILABLE') }
