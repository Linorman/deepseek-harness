/** Common Native records stay domain-neutral; registered hiring parsers own their business payloads. */
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  simulationWorldDefinitionSchema, simulationWorldOperationGrantSchema, simulationWorldIntentSchema,
  simulationWorldResolveOperationSchema, simulationWorldResultSchema, worldResultNotification,
} from '../src/world.ts'
import {
  WORLD_GENERATE_AND_HIRE, WORLD_GENERATE_AND_HIRE_PIN, simulationWorldHirePayloadSchema,
  simulationWorldHirePlanPayloadSchema, simulationWorldHireResultPayloadSchema,
  simulationWorldHireMutationPayloadSchema, createSimulationWorldDomainRegistry,
} from '../src/world-domains.ts'
import type { SimulationWorldIntent } from '../src/world-types.ts'
import type { WorldIntentId } from '../src/world-domain-types.ts'

const grant = { requesterEntityId: 'requester', ...WORLD_GENERATE_AND_HIRE,
  scopeEntityId: 'organization', targetEntityId: 'position', relationId: 'can-hire', relation: 'can-hire' }
const definition = {
  positionRolePermissions: [],
  directorEntityId: 'director', organizationEntityId: 'organization',
  operations: [WORLD_GENERATE_AND_HIRE_PIN], operationGrants: [grant],
  positions: [{ entityId: 'position', capacity: 1 }],
  authorizations: [{ requesterEntityId: 'requester', positionEntityId: 'position', relationId: 'can-hire' }],
  templates: [{ id: 'person', version: '1', names: ['Lin'], skills: ['analysis'], traits: [], goals: [], description: 'Colleague' }],
  policyVersion: '1', limits: { maxRequests: 10,
    maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
    maxRequestsPerActorPerInterval: 10,
    maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 4096, maxBytesPerPlan: 4096 },
}
const hirePayload = { organizationEntityId: 'organization', positionEntityId: 'position', description: 'Need help' }
const persona = { name: 'Lin', skills: ['analysis'], traits: [], goals: [] }
const hirePlanPayload = { templateId: 'person', templateVersion: '1', persona }
const intent = { id: 'intent', pin: WORLD_GENERATE_AND_HIRE_PIN, businessKey: 'application', requesterEntityId: 'requester',
  scopeEntityId: 'organization', targetEntityId: 'position', expectedTime: null, evidence: [], description: 'Need help', payload: hirePayload, sequence: 1, requestId: 'case' }
const plan = { kind: 'world/resolve', requestId: 'case', supersedes: null,
  resolution: { kind: 'apply', payload: hirePlanPayload, rationale: 'Private assessment' } }
const result = { id: 'result', requestId: 'case', intentId: 'intent', source: { kind: 'plan', planId: 'plan' },
  outcome: { kind: 'committed' }, payload: { entityId: 'new-person', relationId: 'assignment' }, time: '5', sequence: 3 }

describe('explicit world operation manifest', () => {
  it('requires the manifest and grants without allocating defaults', () => {
    expect(simulationWorldDefinitionSchema.parse(definition)).toEqual(definition)
    for (const field of ['operations', 'operationGrants', 'positionRolePermissions']) {
      const incomplete = Object.fromEntries(Object.entries(definition).filter(([key]) => key !== field))
      expect(() => simulationWorldDefinitionSchema.parse(incomplete)).toThrow()
    }
    expect(() => simulationWorldDefinitionSchema.parse({ ...definition, operations: [] })).toThrow()
    expect(() => simulationWorldDefinitionSchema.parse({ ...definition,
      operations: [{ ...WORLD_GENERATE_AND_HIRE, schemaRef: 'schema', implementationRef: 'implementation' }] })).toThrow()
  })

  it('rejects duplicate selectors even when their implementation generations differ', () => {
    for (const duplicate of [WORLD_GENERATE_AND_HIRE_PIN, { ...WORLD_GENERATE_AND_HIRE_PIN, generation: 2 }]) {
      expect(() => simulationWorldDefinitionSchema.parse({ ...definition,
        operations: [...definition.operations, duplicate] })).toThrow('Duplicate operation selectors')
    }
  })

  it('rejects duplicate scope/target grants even when a different relation identity is supplied', () => {
    for (const duplicate of [grant, { ...grant, relationId: 'another-grant' }]) {
      expect(() => simulationWorldDefinitionSchema.parse({ ...definition,
        operationGrants: [grant, duplicate] })).toThrow('Duplicate operation grants')
    }
  })

  it.each([
    { ...grant, domain: 'calendar' }, { ...grant, operation: 'release' }, { ...grant, version: '2' },
  ])('rejects a grant selecting an undeclared operation version: %j', (value) => {
    expect(() => simulationWorldDefinitionSchema.parse({ ...definition, operationGrants: [value] }))
      .toThrow('Grant must reference a declared operation version')
  })

  it('keeps an explicit second selector and independently scoped target grant without a hiring alias', () => {
    const booking = { ...WORLD_GENERATE_AND_HIRE_PIN, domain: 'calendar', operation: 'book-room',
      schemaRef: 'calendar/book-room/schema/1', implementationRef: 'calendar/book-room/native/1' }
    const bookingGrant = { ...grant, domain: 'calendar', operation: 'book-room', targetEntityId: 'room',
      relationId: 'can-book', relation: 'can-book' }
    expect(simulationWorldDefinitionSchema.parse({ ...definition, operations: [...definition.operations, booking],
      operationGrants: [grant, bookingGrant] }).operationGrants).toEqual([grant, bookingGrant])
  })

  it('rejects unknown manifest and authority fields rather than silently dropping them', () => {
    expect(() => simulationWorldDefinitionSchema.parse({ ...definition, enabled: true })).toThrow()
    expect(() => simulationWorldDefinitionSchema.parse({ ...definition,
      operations: [{ ...WORLD_GENERATE_AND_HIRE_PIN, fallback: true }] })).toThrow()
    expect(() => simulationWorldOperationGrantSchema.parse({ ...grant, source: 'model' })).toThrow()
    expect(() => simulationWorldOperationGrantSchema.parse({ ...grant, relation: '' })).toThrow()
  })
})

describe('common Native intent, resolution and result', () => {
  it('retains a branded domain intent and rejects the old hiring-only intent layout', () => {
    const parsed = simulationWorldIntentSchema.parse(intent)
    expect(parsed).toEqual(intent)
    expectTypeOf(parsed).toExtend<Omit<SimulationWorldIntent, 'requestId'>>()
    expectTypeOf(parsed.id).toEqualTypeOf<WorldIntentId>()
    expect(() => simulationWorldIntentSchema.parse({ id: 'intent', request: { ...hirePayload, requesterEntityId: 'requester' },
      sequence: 1 })).toThrow()
    expect(() => simulationWorldIntentSchema.parse({ ...intent, actor: 'another-person' })).toThrow()
    expect(() => simulationWorldIntentSchema.parse({ ...intent, pin: { ...intent.pin, fallback: true } })).toThrow()
    expect(() => simulationWorldIntentSchema.parse({ ...intent, scopeEntityId: '' })).toThrow()
  })

  it('retains generic apply data inside payload and forbids old hiring fields in the common envelope', () => {
    expect(simulationWorldResolveOperationSchema.parse(plan)).toEqual(plan)
    expect(simulationWorldResolveOperationSchema.parse({ ...plan,
      resolution: { kind: 'reject', reason: 'policy', rationale: 'Private assessment' } }).resolution.kind).toBe('reject')
    expect(() => simulationWorldResolveOperationSchema.parse({ ...plan,
      resolution: { ...plan.resolution, templateId: 'person' } })).toThrow()
    expect(() => simulationWorldResolveOperationSchema.parse({ ...plan, actor: 'director' })).toThrow()
    expect(() => simulationWorldResolveOperationSchema.parse({ ...plan,
      resolution: { kind: 'apply', ...hirePlanPayload, rationale: 'Private assessment' } })).toThrow()
  })

  it('keeps committed business references in result payload and renders only the public result', () => {
    const parsed = simulationWorldResultSchema.parse(result)
    expect(parsed).toEqual(result)
    expect(JSON.parse(worldResultNotification(parsed))).toEqual({ resultId: result.id, outcome: result.outcome, payload: result.payload })
    expect(worldResultNotification(parsed)).not.toContain('Private assessment')
    expect(() => simulationWorldResultSchema.parse({ ...result,
      outcome: { kind: 'committed', entityId: 'new-person', relationId: 'assignment' } })).toThrow()
    expect(() => simulationWorldResultSchema.parse({ ...result, privateRationale: 'Private assessment' })).toThrow()
    expect(() => simulationWorldResultSchema.parse({ ...result, source: { kind: 'plan', planId: 'plan', alternate: true } })).toThrow()
  })

  it('preserves the original plan or cancellation source for empty terminal payloads', () => {
    const rejected = { ...result, outcome: { kind: 'rejected', reason: 'policy' }, payload: {} }
    const cancelled = { ...result, source: { kind: 'cancel', commandId: 'cancel' }, outcome: { kind: 'cancelled' }, payload: {} }
    expect(simulationWorldResultSchema.parse(rejected)).toEqual(rejected)
    expect(simulationWorldResultSchema.parse(cancelled)).toEqual(cancelled)
    expect(() => simulationWorldResultSchema.parse({ ...cancelled, source: result.source })).toThrow()
    expect(() => simulationWorldResultSchema.parse({ ...rejected, source: cancelled.source })).toThrow()
  })

  it.each([undefined, () => null, new Date('2026-10-11T00:00:00Z'), NaN, Infinity, BigInt(1)])(
    'rejects non-JSON domain payload input: %s', (payload) => {
      expect(() => simulationWorldIntentSchema.parse({ ...intent, payload })).toThrow()
      expect(() => simulationWorldResolveOperationSchema.parse({ ...plan, resolution: { ...plan.resolution, payload } })).toThrow()
      expect(() => simulationWorldResultSchema.parse({ ...result, payload })).toThrow()
    },
  )
})

describe('strict installed hiring payloads', () => {
  it('parses request, apply, result and mutation business payloads independently of their envelopes', () => {
    expect(simulationWorldHirePayloadSchema.parse(hirePayload)).toEqual(hirePayload)
    expect(simulationWorldHirePlanPayloadSchema.parse(hirePlanPayload)).toEqual(hirePlanPayload)
    expect(simulationWorldHireResultPayloadSchema.parse(result.payload)).toEqual(result.payload)
    expect(simulationWorldHireResultPayloadSchema.parse({})).toEqual({})
    expect(simulationWorldHireMutationPayloadSchema.parse({ maintenanceId: 'original-maintenance' }))
      .toEqual({ maintenanceId: 'original-maintenance' })
  })

  it('rejects unknown fields recursively and incomplete committed identities', () => {
    expect(() => simulationWorldHirePayloadSchema.parse({ ...hirePayload, requesterEntityId: 'another-person' })).toThrow()
    expect(() => simulationWorldHirePlanPayloadSchema.parse({ ...hirePlanPayload, rationale: 'Private assessment' })).toThrow()
    expect(() => simulationWorldHirePlanPayloadSchema.parse({ ...hirePlanPayload, persona: { ...persona, unrestricted: true } })).toThrow()
    expect(() => simulationWorldHireResultPayloadSchema.parse({ ...result.payload, rationale: 'Private assessment' })).toThrow()
    expect(() => simulationWorldHireResultPayloadSchema.parse({ entityId: 'new-person' })).toThrow()
    expect(() => simulationWorldHireResultPayloadSchema.parse({ relationId: 'assignment' })).toThrow()
    expect(() => simulationWorldHireMutationPayloadSchema.parse({ maintenanceId: 'original-maintenance', status: 'committed' })).toThrow()
  })

  it('uses a caller-owned registry to reject unknown request payload fields and operation versions', () => {
    const registry = createSimulationWorldDomainRegistry()
    const request = { kind: 'world/request', ...WORLD_GENERATE_AND_HIRE, businessKey: 'application',
      expectedTime: null, evidence: [], payload: hirePayload }
    expect(registry.parseRequest(request)).toEqual(request)
    expect(() => registry.parseRequest({ ...request, payload: { ...hirePayload, fallback: true } })).toThrow()
    expect(() => registry.parseRequest({ ...request, version: '2' })).toThrow(expect.objectContaining({ code: 'SIM_WORLD_VERSION_UNAVAILABLE' }))
    expect(() => registry.parseRequest({ ...request, domain: 'calendar' })).toThrow(expect.objectContaining({ code: 'SIM_WORLD_DOMAIN_UNKNOWN' }))
  })
})
