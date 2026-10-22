import { WORLD_GENERATE_AND_HIRE_PIN, simulationExternalRepresentativeReservationSchema } from '@clocky/clocky-simulation'
import { worldIntentIdSchema } from '../src/world-domain.ts'
import type { WorldIntentId } from '../src/world-domain-types.ts'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  worldPlanIdSchema, worldRequestIdSchema, simulationHireIntentRequestSchema,
  simulationWorldDefinitionSchema, simulationWorldPersonaSchema, simulationWorldRequestOperationSchema,
  simulationWorldResolveOperationSchema, simulationWorldTemplateSchema,
  worldResultIdSchema, worldCancelIdSchema, simulationWorldCancelRequestSchema,
  simulationWorldCancellationSchema, simulationWorldResultSchema,
  simulationWorldContextRequestSchema, worldResultNotification,
} from '../src/world.ts'
import type { WorldPlanId, WorldRequestId, WorldResultId, WorldCancelId } from '../src/world-types.ts'
import { simulationWorldHireReserveRequestSchema, simulationWorldHireReservationSchema,
  simulationWorldIdentityCleanupEvidenceSchema } from '../src/world-hire.ts'
import type { SimulationWorldIdentityCleanupEvidence } from '../src/world-hire-types.ts'
import { SimulationWorldError } from '../src/world-errors.ts'

const template = {
  id: 'researcher', version: '1', names: ['Lin', 'Kai'], skills: ['analysis'],
  traits: ['patient'], goals: ['publish'], description: 'A research colleague.',
}
const persona = { name: 'Lin', skills: ['analysis'], traits: ['patient'], goals: ['publish'] }
const definition = { positionRolePermissions: [], operations: [WORLD_GENERATE_AND_HIRE_PIN], operationGrants: ([{ requesterEntityId: 'requester', positionEntityId: 'research-position', relationId: 'authority' }]).map(value => ({ requesterEntityId: value.requesterEntityId, domain: WORLD_GENERATE_AND_HIRE_PIN.domain, operation: WORLD_GENERATE_AND_HIRE_PIN.operation, version: WORLD_GENERATE_AND_HIRE_PIN.version, scopeEntityId: 'organization', targetEntityId: value.positionEntityId, relationId: value.relationId, relation: 'can-hire' })),
  directorEntityId: 'director', organizationEntityId: 'organization',
  positions: [{ entityId: 'research-position', capacity: 2 }],
  authorizations: [{ requesterEntityId: 'requester', positionEntityId: 'research-position', relationId: 'authority' }],
  templates: [template], policyVersion: '1',
  limits: { maxRequests: 10,
    maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
    maxRequestsPerActorPerInterval: 10,
    maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 2048, maxBytesPerPlan: 4096 },
}
const intent = {
  organizationEntityId: 'organization', positionEntityId: 'research-position', requesterEntityId: 'requester', applicationId: 'application',
}

it('parses an explicit predecessor without accepting empty, nullable or injected case links', () => {
  const linked = { ...intent, priorRequestId: 'original-case' }
  expect(simulationHireIntentRequestSchema.parse(linked)).toEqual(linked)
  for (const priorRequestId of ['', null, {}, 3]) {
    expect(() => simulationHireIntentRequestSchema.parse({ ...intent, priorRequestId })).toThrow()
  }
  expect(() => simulationHireIntentRequestSchema.parse({ ...linked, priorResult: 'insufficient-information' })).toThrow()
})
const request = { kind: 'world/request', domain: 'organization', operation: 'generate-and-hire', version: '1',
  businessKey: 'application', expectedTime: null, evidence: [], payload: { organizationEntityId: 'organization',
    positionEntityId: 'research-position', description: 'A research colleague is needed.' } }
const apply = {
  kind: 'world/resolve', requestId: 'request', supersedes: null,
  resolution: { kind: 'apply', payload: { templateId: 'researcher', templateVersion: '1', persona }, rationale: 'Private assessment.' },
}
const reject = {
  kind: 'world/resolve', requestId: 'request', supersedes: 'previous-plan',
  resolution: { kind: 'reject', reason: 'insufficient-information', rationale: 'Private assessment.' },
}
const cancellation = { id: 'original-cancel', requestId: 'request' }
const receipt = { request: cancellation, status: 'cancelled', resultId: 'result', sequence: 1 }
const result = { id: 'result', requestId: 'request', intentId: 'intent', time: '0', sequence: 1,
  source: { kind: 'cancel', commandId: cancellation.id }, outcome: { kind: 'cancelled' }, payload: {} }

it('retains typed quota ownership separately from trusted diagnostic wording', () => {
  for (const limit of ['position', 'entities', 'participants', 'channels', 'bytes', 'requests', 'commands', 'plans'] as const) {
    const error = new SimulationWorldError('SIM_WORLD_LIMIT', 'The diagnostic can change independently.', limit)
    expect(error.code).toBe('SIM_WORLD_LIMIT')
    expect(error.failure).toEqual({ code: 'SIM_WORLD_LIMIT', limit })
  }
  expect(new SimulationWorldError('SIM_WORLD_AUTHORITY', 'No current grant').failure).toEqual({ code: 'SIM_WORLD_AUTHORITY' })
})

describe('trusted hire inputs', () => {
  const request = { planId: 'original-plan', maintenance: { id: 'original-maintenance', owner: 'world-owner' },
    member: { displayName: 'Lin', role: 'member', capabilities: [], provider: 'in-process',
      preset: 'simulation', model: 'scripted/model', modelVersion: '1' } }
  const reservation = { approvals: [], id: 'intent', requestId: 'request', request, sequence: 1, updatedSequence: 2, reservedAt: '0', prepared: { time: '0', sequence: 2 }, status: 'preparing',
    identities: { entityId: 'new-person', relationId: 'assignment', binding: { teamId: 'team-original',
      participantId: 'participant-original', sessionId: 'a17fe0bf-6e90-4c12-87da-de59d4e6bb55' }, channels: [
      { purpose: 'director', key: 'private-director', channelId: 'channel-director' },
      { purpose: 'requester', key: 'private-requester', channelId: 'channel-requester' },
    ] } }
  const evidence = { binding: reservation.identities.binding, teamCursor: 3, participant: 'left', session: 'unmaterialized',
    channels: [{ phase: 'closed', channelId: 'channel-director', cursor: 1 },
      { phase: 'absent', channelId: 'channel-requester' }] }

  it('retains complete original route, maintenance owner and every identity without allocating defaults', () => {
    expect(simulationWorldHireReserveRequestSchema.parse(request)).toEqual(request)
    expect(simulationWorldHireReservationSchema.parse(reservation)).toEqual(reservation)
  })

  it.each([
    { ...request, planId: '' }, { ...request, ready: true },
    { ...request, maintenance: { id: 'original-maintenance' } },
    { ...request, maintenance: { ...request.maintenance, status: 'quiescent' } },
    { ...request, member: { ...request.member, capabilities: ['world/resolve'] } },
    { ...request, member: { ...request.member, role: 'director' } },
    { ...request, member: { ...request.member, provider: 'worker' } },
    { ...request, member: { ...request.member, path: '/host/preset' } },
    { ...request, member: { ...request.member, modelVersion: '' } },
  ])('rejects authority expansion, missing identities and unknown route fields: %j', (input) => {
    expect(() => simulationWorldHireReserveRequestSchema.parse(input)).toThrow()
  })

  it.each([
    { ...reservation, status: 'ready' }, { ...reservation, sequence: 0 }, { ...reservation, result: 'fabricated' },
    { ...reservation, identities: { ...reservation.identities, binding: { teamId: 'team-original' } } },
    { ...reservation, identities: { ...reservation.identities, channels: reservation.identities.channels.slice(0, 1) } },
    { ...reservation, identities: { ...reservation.identities, channels: [...reservation.identities.channels].reverse() } },
    { ...reservation, identities: { ...reservation.identities, session: { ready: true } } },
  ])('rejects partial or fabricated persisted preparation: %j', (input) => {
    expect(() => simulationWorldHireReservationSchema.parse(input)).toThrow()
  })

  it('requires monotonic preparation evidence for both hire and representative reservations', () => {
    const { approvals: _approvals, ...representative } = reservation
    for (const [schema, base] of [
      [simulationWorldHireReservationSchema, reservation],
      [simulationExternalRepresentativeReservationSchema, { ...representative, identityId: 'identity', generation: 1 }],
    ] as const) {
      for (const status of ['reserved', 'abandoned']) {
        const unprepared = { ...base, status, prepared: undefined }
        expect(schema.safeParse(unprepared).success).toBe(true)
      }
      for (const status of ['preparing', 'committed', 'cancel-requested']) {
        expect(schema.safeParse({ ...base, status, prepared: undefined }).success).toBe(false)
        expect(schema.safeParse({ ...base, status }).success).toBe(true)
      }
      for (const changed of [
        { reservedAt: undefined }, { reservedAt: '01' }, { reservedAt: '1' },
        { status: 'reserved' }, { prepared: { time: '0', sequence: 1 } },
        { prepared: { time: '0', sequence: 3 } }, { prepared: { time: '0', sequence: 1.5 } },
        { prepared: { time: '0', sequence: Number.MAX_SAFE_INTEGER + 1 } },
        { prepared: { time: '0', sequence: 2, extra: true } },
        { status: 'abandoned', prepared: undefined, cleanup: { sequence: 2, evidence } },
      ]) expect(schema.safeParse({ ...base, ...changed }).success).toBe(false)
    }
  })

  it('keeps a pending cancellation distinct from a terminal result', () => {
    expect(simulationWorldCancellationSchema.parse({ request: cancellation, sequence: 1, status: 'cancel-requested' }))
      .toEqual({ request: cancellation, sequence: 1, status: 'cancel-requested' })
    expect(() => simulationWorldCancellationSchema.parse({ ...receipt, status: 'cancel-requested' })).toThrow()
    expect(() => simulationWorldCancellationSchema.parse({ request: cancellation, sequence: 1, status: 'cancelled' })).toThrow()
  })

  it('retains only terminal original cleanup observations with their actual cursors', () => {
    expectTypeOf(simulationWorldIdentityCleanupEvidenceSchema.parse(evidence)).toExtend<SimulationWorldIdentityCleanupEvidence>()
    expect(simulationWorldIdentityCleanupEvidenceSchema.parse(evidence)).toEqual(evidence)
    for (const phase of ['closed', 'expired', 'failed']) {
      for (const participant of ['absent', 'left', 'failed']) {
        const observation = { ...evidence, participant,
          channels: [{ phase, channelId: 'channel-director', cursor: 0 }, evidence.channels[1]] }
        expect(simulationWorldIdentityCleanupEvidenceSchema.parse(observation)).toEqual(observation)
      }
    }
    const abandoned = { ...reservation, status: 'abandoned', cleanup: { sequence: 2, evidence } }
    expect(simulationWorldHireReservationSchema.parse(abandoned)).toEqual(abandoned)
    expect(simulationWorldHireReservationSchema.parse({ ...reservation, status: 'abandoned' }))
      .toEqual({ ...reservation, status: 'abandoned' })
  })

  it.each([
    { ...evidence, participant: 'active' }, { ...evidence, session: 'materialized' },
    { ...evidence, binding: { ...evidence.binding, activationId: 'fabricated' } },
    { ...evidence, unknown: true }, { ...evidence, channels: evidence.channels.slice(0, 1) },
    { ...evidence, channels: [...evidence.channels, evidence.channels[1]] },
    { ...evidence, channels: [{ phase: 'open', channelId: 'channel-director', cursor: 1 }, evidence.channels[1]] },
    { ...evidence, channels: [{ phase: 'closed', channelId: 'channel-director' }, evidence.channels[1]] },
    { ...evidence, channels: [evidence.channels[0], { ...evidence.channels[1], cursor: 0 }] },
    { ...evidence, channels: [{ ...evidence.channels[0], ready: true }, evidence.channels[1]] },
  ])('rejects live, incomplete or fabricated cleanup observations: %j', (input) => {
    expect(() => simulationWorldIdentityCleanupEvidenceSchema.parse(input)).toThrow()
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('rejects unsafe cleanup cursors: %s', (cursor) => {
    expect(simulationWorldIdentityCleanupEvidenceSchema.safeParse({ ...evidence, teamCursor: cursor }).success).toBe(false)
    expect(simulationWorldIdentityCleanupEvidenceSchema.safeParse({ ...evidence,
      channels: [{ ...evidence.channels[0], cursor }, evidence.channels[1]] }).success).toBe(false)
  })

  it('rejects cleanup detached from its original abandonment sequence, binding or ordered Channel identities', () => {
    for (const status of ['reserved', 'preparing', 'cancel-requested', 'committed']) {
      expect(simulationWorldHireReservationSchema.safeParse({ ...reservation, status,
        cleanup: { sequence: 2, evidence } }).success).toBe(false)
    }
    for (const sequence of [0, 1, 3]) {
      expect(simulationWorldHireReservationSchema.safeParse({ ...reservation, status: 'abandoned', cleanup: { sequence, evidence } }).success).toBe(false)
    }
    for (const key of ['teamId', 'participantId', 'sessionId'] as const) {
      const binding = { ...evidence.binding, [key]: key === 'sessionId' ? '08e1776a-13e1-46ba-9bd8-3d8b86826e0a' : 'another-original' }
      expect(simulationWorldHireReservationSchema.safeParse({ ...reservation, status: 'abandoned',
        cleanup: { sequence: 2, evidence: { ...evidence, binding } } }).success).toBe(false)
    }
    expect(simulationWorldHireReservationSchema.safeParse({ ...reservation, status: 'abandoned',
      cleanup: { sequence: 2, evidence: { ...evidence, channels: [...evidence.channels].reverse() } } }).success).toBe(false)
    for (const key of Object.keys(evidence)) {
      const incomplete = Object.fromEntries(Object.entries(evidence).filter(([field]) => field !== key))
      expect(simulationWorldIdentityCleanupEvidenceSchema.safeParse(incomplete).success, key).toBe(false)
    }
  })
})

describe('world input schemas', () => {
  it('selects immutable result notification and first-action purposes without caller-supplied authority', () => {
    for (const kind of ['result', 'first-action'] as const) {
      const selector = { kind, resultId: 'original-result' }
      expect(simulationWorldContextRequestSchema.parse(selector)).toEqual(selector)
      for (const input of [{ kind }, { ...selector, resultId: '' }, { ...selector, intentId: 'fabricated' },
        { ...selector, notification: { recipient: 'another-person' } }, { ...selector, reads: {} }]) {
        expect(simulationWorldContextRequestSchema.safeParse(input).success).toBe(false)
      }
    }
  })

  it('renders only the result identity and bounded outcome without disclosing private assessment or source history', () => {
    const cancelled = simulationWorldResultSchema.parse(result)
    const rejected = simulationWorldResultSchema.parse({ ...result, source: { kind: 'plan', planId: 'original-plan' },
      outcome: { kind: 'rejected', reason: 'capacity-full' } })
    const committed = simulationWorldResultSchema.parse({ ...result, source: { kind: 'plan', planId: 'original-plan' },
      outcome: { kind: 'committed' }, payload: { entityId: 'new-person', relationId: 'original-assignment' } })
    expect(worldResultNotification(cancelled)).toBe('{"resultId":"result","outcome":{"kind":"cancelled"},"payload":{}}')
    expect(worldResultNotification(rejected))
      .toBe('{"resultId":"result","outcome":{"kind":"rejected","reason":"capacity-full"},"payload":{}}')
    expect(worldResultNotification(committed))
      .toBe('{"resultId":"result","outcome":{"kind":"committed"},"payload":{"entityId":"new-person","relationId":"original-assignment"}}')
    const privateResult = { ...committed, outcome: { ...committed.outcome, rationale: 'Private assessment.' } }
    expect(worldResultNotification(privateResult)).toBe(worldResultNotification(committed))
    for (const terminal of [cancelled, rejected, committed]) {
      const text = worldResultNotification(terminal)
      expect(JSON.parse(text)).toEqual({ resultId: terminal.id, outcome: terminal.outcome, payload: terminal.payload })
      expect(text).not.toContain('original-plan')
      expect(text).not.toContain('original-cancel')
    }
  })

  it('preserves complete explicit inputs without inventing execution facts', () => {
    expect(simulationWorldDefinitionSchema.parse(definition)).toEqual(definition)
    expect(simulationHireIntentRequestSchema.parse(intent)).toEqual(intent)
    expect(simulationWorldRequestOperationSchema.parse(request)).toEqual(request)
    expect(simulationWorldResolveOperationSchema.parse(apply)).toEqual(apply)
    expect(simulationWorldResolveOperationSchema.parse(reject)).toEqual(reject)
  })

  it('returns distinct opaque business, request and plan identities', () => {
    expectTypeOf(worldIntentIdSchema.parse('intent')).toEqualTypeOf<WorldIntentId>()
    expectTypeOf(worldRequestIdSchema.parse('request')).toEqualTypeOf<WorldRequestId>()
    expectTypeOf(worldPlanIdSchema.parse('plan')).toEqualTypeOf<WorldPlanId>()
    expectTypeOf(worldResultIdSchema.parse('result')).toEqualTypeOf<WorldResultId>()
    expectTypeOf(worldCancelIdSchema.parse('cancel')).toEqualTypeOf<WorldCancelId>()
    for (const schema of [worldRequestIdSchema, worldPlanIdSchema, worldResultIdSchema, worldCancelIdSchema]) {
      expect(schema.safeParse('').success).toBe(false)
      expect(schema.safeParse(1).success).toBe(false)
    }
  })

  it.each([
    [simulationWorldDefinitionSchema, definition], [simulationWorldTemplateSchema, template],
    [simulationWorldPersonaSchema, persona], [simulationHireIntentRequestSchema, intent],
    [simulationWorldRequestOperationSchema, request], [simulationWorldResolveOperationSchema, apply],
    [simulationWorldCancelRequestSchema, cancellation], [simulationWorldCancellationSchema, receipt], [simulationWorldResultSchema, result],
  ])('rejects unknown fields and missing required fields at every public object entry', (schema, value) => {
    expect(schema.safeParse({ ...value, unknown: 'forged' }).success).toBe(false)
    for (const key of Object.keys(value)) {
      const incomplete = Object.fromEntries(Object.entries(value).filter(([field]) => field !== key))
      expect(schema.safeParse(incomplete).success, key).toBe(false)
    }
  })

  it.each(['positions', 'authorizations', 'templates'] as const)('rejects duplicate %s', (field) => {
    expect(simulationWorldDefinitionSchema.safeParse({
      ...definition, [field]: [...definition[field], ...definition[field]],
    }).success).toBe(false)
  })

  it('rejects conflicting versions, duplicate authority scopes and reused relation identities', () => {
    expect(simulationWorldDefinitionSchema.safeParse({
      ...definition, templates: [template, { ...template, version: '2' }],
    }).success).toBe(false)
    const authorization = definition.authorizations[0]!
    for (const duplicate of [{ ...authorization, relationId: 'other' }, { ...authorization, requesterEntityId: 'other' }]) {
      expect(simulationWorldDefinitionSchema.safeParse({
        ...definition, authorizations: [authorization, duplicate],
      }).success).toBe(false)
    }
  })

  it('reports undeclared positions at the authorization reference', () => {
    const result = simulationWorldDefinitionSchema.safeParse({ ...definition, authorizations: [{ ...definition.authorizations[0], positionEntityId: 'missing' }] })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['authorizations', 0, 'positionEntityId'])
  })

  it.each(['names', 'skills', 'traits', 'goals'])('rejects duplicate and empty template %s values', (field) => {
    for (const values of [['same', 'same'], ['']]) {
      expect(simulationWorldTemplateSchema.safeParse({ ...template, [field]: values }).success).toBe(false)
    }
  })

  it.each(['skills', 'traits', 'goals'])('rejects duplicate and empty selected persona %s values', (field) => {
    for (const values of [['same', 'same'], ['']]) {
      expect(simulationWorldPersonaSchema.safeParse({ ...persona, [field]: values }).success).toBe(false)
    }
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('rejects non-positive or unsafe quantities: %s', (value) => {
    expect(simulationWorldDefinitionSchema.safeParse({
      ...definition, positions: [{ entityId: 'research-position', capacity: value }],
    }).success).toBe(false)
    for (const field of Object.keys(definition.limits).filter(key =>
      value !== 0 || !['maxBirthsPerInterval', 'maxExternalExpansionsPerInterval', 'maxEvidenceAttemptsPerRequest'].includes(key))) {
      expect(simulationWorldDefinitionSchema.safeParse({
        ...definition, limits: { ...definition.limits, [field]: value },
      }).success).toBe(false)
    }
  })

  it('rejects unknown fields inside configuration records', () => {
    for (const field of ['positions', 'authorizations', 'templates'] as const) {
      expect(simulationWorldDefinitionSchema.safeParse({
        ...definition, [field]: [{ ...definition[field][0], unknown: true }],
      }).success).toBe(false)
    }
    expect(simulationWorldDefinitionSchema.safeParse({
      ...definition, limits: { ...definition.limits, unknown: true },
    }).success).toBe(false)
  })

  it('requires a complete persona and forbids free public description or unknown resolution fields', () => {
    for (const field of Object.keys(persona)) {
      const incomplete = Object.fromEntries(Object.entries(persona).filter(([key]) => key !== field))
      expect(simulationWorldResolveOperationSchema.safeParse({
        ...apply, resolution: { ...apply.resolution, persona: incomplete },
      }).success).toBe(false)
    }
    expect(simulationWorldResolveOperationSchema.safeParse({
      ...apply, resolution: { ...apply.resolution, persona: { ...persona, description: 'Private leak' } },
    }).success).toBe(false)
    for (const operation of [apply, reject]) {
      expect(simulationWorldResolveOperationSchema.safeParse({
        ...operation, resolution: { ...operation.resolution, unknown: true },
      }).success).toBe(false)
    }
  })

  it('accepts only bounded rejection reasons and explicit predecessor identities', () => {
    for (const reason of ['insufficient-information', 'unauthorized', 'capacity-full', 'unsupported', 'policy']) {
      expect(simulationWorldResolveOperationSchema.safeParse({
        ...reject, resolution: { ...reject.resolution, reason },
      }).success).toBe(true)
    }
    expect(simulationWorldResolveOperationSchema.safeParse({
      ...reject, resolution: { ...reject.resolution, reason: 'secret details' },
    }).success).toBe(false)
    expect(simulationWorldResolveOperationSchema.safeParse({ ...apply, supersedes: '' }).success).toBe(false)
    expect(simulationWorldResolveOperationSchema.safeParse({
      ...apply, resolution: { kind: 'wait', rationale: 'Later' },
    }).success).toBe(false)
  })

  it('requires the exact terminal source and excludes private text from result and cancellation records', () => {
    expect(simulationWorldCancelRequestSchema.parse(cancellation)).toEqual(cancellation)
    expect(simulationWorldCancellationSchema.parse(receipt)).toEqual(receipt)
    expect(simulationWorldResultSchema.parse(result)).toEqual(result)
    const rejected = { ...result, source: { kind: 'plan', planId: 'plan' }, outcome: { kind: 'rejected', reason: 'policy' } }
    const committed = { ...rejected, outcome: { kind: 'committed' }, payload: { entityId: 'person', relationId: 'assignment' } }
    for (const terminal of [rejected, committed]) expect(simulationWorldResultSchema.parse(terminal)).toEqual(terminal)
    for (const terminal of [result, rejected, committed]) {
      expect(simulationWorldResultSchema.safeParse({ ...terminal, source: { ...terminal.source, unknown: true } }).success).toBe(false)
      expect(simulationWorldResultSchema.safeParse({ ...terminal, outcome: { ...terminal.outcome, rationale: 'private' } }).success).toBe(false)
      expect(simulationWorldResultSchema.safeParse({ ...terminal, sequence: 0 }).success).toBe(false)
      expect(simulationWorldResultSchema.safeParse({ ...terminal, time: '00' }).success).toBe(false)
    }
    expect(simulationWorldResultSchema.safeParse({ ...result, source: rejected.source }).success).toBe(false)
    expect(simulationWorldResultSchema.safeParse({ ...rejected, source: result.source }).success).toBe(false)
    expect(simulationWorldCancellationSchema.safeParse({ ...receipt, status: 'pending' }).success).toBe(false)
  })
})


it('requires structural quotas, allows disabled births and expansions, and freezes pending concurrency', () => {
  const schema = simulationWorldDefinitionSchema
  for (const field of ['maxBirthsPerInterval', 'maxExternalExpansionsPerInterval']) {
    for (const value of [0, 1, Number.MAX_SAFE_INTEGER])
      expect(schema.safeParse({ ...definition, limits: { ...definition.limits, [field]: value } }).success).toBe(true)
    for (const value of [undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', true])
      expect(schema.safeParse({ ...definition, limits: { ...definition.limits, [field]: value } }).success).toBe(false)
  }
  for (const value of [undefined, null, 0, 2, 1.5, '1', true])
    expect(schema.safeParse({ ...definition, limits: { ...definition.limits, maxPendingMutations: value } }).success).toBe(false)
})
