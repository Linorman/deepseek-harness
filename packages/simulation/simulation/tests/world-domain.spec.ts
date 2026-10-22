import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import {
  simulationWorldDomainSelectorSchema, simulationWorldDomainRequestSchema, simulationWorldDomainPlanSchema,
  simulationWorldDomainResultSchema, simulationWorldDomainMutationSchema, simulationWorldEvidenceRefSchema,
  worldSchemaRefSchema, worldImplementationRefSchema, worldIntentIdSchema, worldMutationIdSchema,
  worldResourceIdSchema, worldDefinitionIdSchema, worldAuthorityIdSchema, worldNormIdSchema,
  worldProposalIdSchema, worldResolutionIdSchema, worldExternalIdentityIdSchema, simulationWorldReadSetSchema,
} from '../src/world-domain.ts'
import { SimulationWorldDomainRegistry, SimulationWorldDomainError, parseSimulationWorldSchema } from '../src/world-domain-registry.ts'
import type { SimulationWorldDomainDefinition, SimulationWorldDomainImplementation,
  WorldIntentId, WorldMutationId, WorldSchemaRef, WorldImplementationRef, WorldResourceId,
  WorldDefinitionId, WorldAuthorityId, WorldNormId, WorldProposalId, WorldResolutionId, WorldExternalIdentityId,
  SimulationWorldEvidenceRef } from '../src/world-domain-types.ts'

import { worldRequestIdSchema, worldPlanIdSchema, worldResultIdSchema, worldCancelIdSchema } from '../src/world.ts'
import type { WorldRequestId, WorldPlanId, WorldResultId, WorldCancelId } from '../src/world-types.ts'

const selector = { domain: 'meeting-room', operation: 'reserve', version: '1' }
const hash = `sha256:${'a'.repeat(64)}`
// Exhaustive keys make a new evidence discriminant require an accompanying parser specimen.
const evidenceSpecimens = {
  'entity': { kind: 'entity', id: 'person', revision: 1 },
  'entity-profile': { kind: 'entity-profile', id: 'person', revision: 1, hash },
  'entity-binding': { kind: 'entity-binding', id: 'person', hash },
  'relation-subject-set': { kind: 'relation-subject-set', relation: 'assignment', subject: 'person', hash },
  'relation': { kind: 'relation', id: 'assignment', revision: 1, effectiveFrom: '10', effectiveUntil: null },
  'relation-set': { kind: 'relation-set', relation: 'assignment', object: 'position', scope: 'organization', hash },
  'resource-owner-set': { kind: 'resource-owner-set', owner: 'person', unit: 'credit', hash },
  'resource': { kind: 'resource', id: 'budget', revision: 3 },
  'resource-account': { kind: 'resource-account', id: 'account', hash },
  'resource-reservation-set': { kind: 'resource-reservation-set', resourceId: 'account', hash },
  'resource-grant-set': { kind: 'resource-grant-set', ids: ['grant'], hash },
  'hiring-fee-policy': { kind: 'hiring-fee-policy', id: 'fee-policy', version: '1', hash },
  'world-input': { kind: 'world-input', id: 'intent', revision: 0, hash },
  'world-definition': { kind: 'world-definition', id: 'world', revision: 1 },
  'authority': { kind: 'authority', id: 'grant', generation: 2 },
  'norm': { kind: 'norm', id: 'rule', version: 'v2' },
  'proposal': { kind: 'proposal', id: 'proposal', hash },
  'resolution': { kind: 'resolution', id: 'resolution', hash },
  'external-representation': { kind: 'external-representation', id: 'client', hash },
  'external': { kind: 'external', id: 'client', revision: 4 },
  'external-adjudication-policy': { kind: 'external-adjudication-policy', policyRef: 'clocky.external.adjudication/1',
    generation: 1, hash },
  'world-fact': { kind: 'world-fact', reference: { factId: 'supplier-fact', version: '9007199254740993' }, hash },
  'world-fact-set': { kind: 'world-fact-set', subject: 'supplier', scope: 'company', hash },
  'commitment': { kind: 'commitment', id: 'original-commitment', revision: 2, hash },
  'commitment-party-set': { kind: 'commitment-party-set', subject: 'supplier', hash },
} satisfies Record<SimulationWorldEvidenceRef['kind'], Readonly<Record<string, unknown>>>

const definition: SimulationWorldDomainDefinition = { ...selector,
  schemaRef: worldSchemaRefSchema.parse('meeting-room/reserve/schema/1'),
  schemas: {
    request: z.strictObject({ room: z.string().min(1), from: z.string(), until: z.string() }),
    plan: z.strictObject({ booking: z.string(), policy: z.strictObject({ version: z.string() }) }),
    result: z.strictObject({ booking: z.string() }),
    mutation: z.strictObject({ booking: z.string(), room: z.string() }),
  },
}
const implementation: SimulationWorldDomainImplementation & { reserve: () => string } = {
  ref: worldImplementationRefSchema.parse('meeting-room/reserve/implementation/1'), generation: 1,
  reserve: () => 'original',
}
const pin = { ...selector, schemaRef: definition.schemaRef, implementationRef: implementation.ref, generation: 1 }
const request = { kind: 'world/request', ...selector, businessKey: 'weekly-review', expectedTime: '5',
  evidence: [{ kind: 'resource', id: 'room-calendar', revision: 4 }],
  payload: { room: 'atlas', from: '5', until: '10' } }
const plan = { kind: 'world/plan', id: 'plan', requestId: 'request', intentId: 'intent', pin,
  requestRevision: 1, supersedes: null, expectedTime: '5', reads: request.evidence,
  authority: [{ kind: 'authority', id: 'grant', generation: 1 }],
  payload: { booking: 'booking', policy: { version: '1' } } }
const result = { kind: 'world/result', id: 'result', requestId: 'request', intentId: 'intent', planId: 'plan', pin,
  outcome: { kind: 'committed', refs: [{ kind: 'resource', id: 'room-calendar', revision: 5 }] },
  time: '5', sequence: 3, payload: { booking: 'booking' } }
const mutation = { kind: 'world/mutation', id: 'mutation', requestId: 'request', planId: 'plan', pin,
  time: '5', sequence: 2, recordedAt: 123, payload: { booking: 'booking', room: 'atlas' } }

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrow(expect.objectContaining({ name: 'SimulationWorldDomainError', code }))
}

describe('strict domain protocol', () => {
  it('requires explicit selectors and excludes model self-asserted caller authority', () => {
    expect(simulationWorldDomainSelectorSchema.parse(selector)).toEqual(selector)
    expect(simulationWorldDomainRequestSchema.parse(request)).toEqual(request)
    for (const field of ['domain', 'operation', 'version', 'businessKey', 'expectedTime', 'evidence', 'payload']) {
      const incomplete = Object.fromEntries(Object.entries(request).filter(([key]) => key !== field))
      expect(() => simulationWorldDomainRequestSchema.parse(incomplete)).toThrow()
    }
    for (const field of ['requester', 'requesterEntityId', 'runId', 'epoch', 'sessionId', 'intentId', 'source', 'decisionId']) {
      expect(() => simulationWorldDomainRequestSchema.parse({ ...request, [field]: 'invented' })).toThrow()
    }
    expectTypeOf(worldIntentIdSchema.parse('intent')).toEqualTypeOf<WorldIntentId>()
    expectTypeOf(worldMutationIdSchema.parse('mutation')).toEqualTypeOf<WorldMutationId>()
  })

  it.each(Object.entries(evidenceSpecimens))('strictly parses every evidence and read-set branch: %s', (kind, value) => {
    expect(value.kind).toBe(kind)
    expect(simulationWorldEvidenceRefSchema.parse(value)).toEqual(value)
    expect(simulationWorldReadSetSchema.parse([value])).toEqual([value])
    const extended = { ...value, path: '/private/body' }
    expect(() => simulationWorldEvidenceRefSchema.parse(extended)).toThrow(z.ZodError)
    expect(() => simulationWorldReadSetSchema.parse([extended])).toThrow(z.ZodError)
    for (const field of Object.keys(value)) {
      const incomplete = Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))
      expect(() => simulationWorldEvidenceRefSchema.parse(incomplete)).toThrow(z.ZodError)
      expect(() => simulationWorldReadSetSchema.parse([incomplete])).toThrow(z.ZodError)
    }
    if ('reference' in value) {
      for (const field of Object.keys(value.reference)) {
        const reference = Object.fromEntries(Object.entries(value.reference).filter(([key]) => key !== field))
        expect(() => simulationWorldEvidenceRefSchema.parse({ ...value, reference })).toThrow(z.ZodError)
        expect(() => simulationWorldReadSetSchema.parse([{ ...value, reference }])).toThrow(z.ZodError)
      }
      const reference = { ...value.reference, owner: 'invented' }
      expect(() => simulationWorldEvidenceRefSchema.parse({ ...value, reference })).toThrow(z.ZodError)
      expect(() => simulationWorldReadSetSchema.parse([{ ...value, reference }])).toThrow(z.ZodError)
    }
  })

  it('retains the complete typed reference vector and the explicitly empty read-set', () => {
    const all = Object.values(evidenceSpecimens)
    expect(simulationWorldReadSetSchema.parse(all)).toEqual(all)
    expect(simulationWorldReadSetSchema.parse([])).toEqual([])
    expect(() => simulationWorldReadSetSchema.parse({ entries: all })).toThrow(z.ZodError)
  })

  it('preserves all protocol identity brands through public schemas and retained envelopes', () => {
    expectTypeOf(worldIntentIdSchema.parse('intent')).toEqualTypeOf<WorldIntentId>()
    expectTypeOf(worldMutationIdSchema.parse('mutation')).toEqualTypeOf<WorldMutationId>()
    expectTypeOf(worldSchemaRefSchema.parse('schema')).toEqualTypeOf<WorldSchemaRef>()
    expectTypeOf(worldImplementationRefSchema.parse('implementation')).toEqualTypeOf<WorldImplementationRef>()
    expectTypeOf(worldResourceIdSchema.parse('resource')).toEqualTypeOf<WorldResourceId>()
    expectTypeOf(worldDefinitionIdSchema.parse('definition')).toEqualTypeOf<WorldDefinitionId>()
    expectTypeOf(worldAuthorityIdSchema.parse('authority')).toEqualTypeOf<WorldAuthorityId>()
    expectTypeOf(worldNormIdSchema.parse('norm')).toEqualTypeOf<WorldNormId>()
    expectTypeOf(worldProposalIdSchema.parse('proposal')).toEqualTypeOf<WorldProposalId>()
    expectTypeOf(worldResolutionIdSchema.parse('resolution')).toEqualTypeOf<WorldResolutionId>()
    expectTypeOf(worldExternalIdentityIdSchema.parse('external')).toEqualTypeOf<WorldExternalIdentityId>()
    expectTypeOf(worldRequestIdSchema.parse('request')).toEqualTypeOf<WorldRequestId>()
    expectTypeOf(worldPlanIdSchema.parse('plan')).toEqualTypeOf<WorldPlanId>()
    expectTypeOf(worldResultIdSchema.parse('result')).toEqualTypeOf<WorldResultId>()
    expectTypeOf(worldCancelIdSchema.parse('cancel')).toEqualTypeOf<WorldCancelId>()
    const parsedPlan = simulationWorldDomainPlanSchema.parse(plan)
    expectTypeOf(parsedPlan.id).toEqualTypeOf<WorldPlanId>()
    expectTypeOf(parsedPlan.requestId).toEqualTypeOf<WorldRequestId>()
    expectTypeOf(parsedPlan.intentId).toEqualTypeOf<WorldIntentId>()
    const parsedResult = simulationWorldDomainResultSchema.parse(result)
    expectTypeOf(parsedResult.id).toEqualTypeOf<WorldResultId>()
    const parsedMutation = simulationWorldDomainMutationSchema.parse(mutation)
    expectTypeOf(parsedMutation.id).toEqualTypeOf<WorldMutationId>()
    expectTypeOf<WorldIntentId>().not.toEqualTypeOf<WorldMutationId>()
    expectTypeOf<WorldRequestId>().not.toEqualTypeOf<WorldPlanId>()
  })

  it('refuses a changed adjudication policy or noncanonical fact version before owner reads', () => {
    expect(() => simulationWorldEvidenceRefSchema.parse({ kind: 'external-adjudication-policy',
      policyRef: 'uninstalled-policy', generation: 1, hash })).toThrow()
    expect(() => simulationWorldEvidenceRefSchema.parse({ kind: 'external-adjudication-policy',
      policyRef: 'clocky.external.adjudication/1', generation: 0, hash })).toThrow()
    for (const version of ['0', '01', '-1', '1.0'])
      expect(() => simulationWorldEvidenceRefSchema.parse({ kind: 'world-fact', reference: { factId: 'fact', version }, hash })).toThrow()
    expect(() => simulationWorldEvidenceRefSchema.parse({ kind: 'world-fact',
      reference: { factId: 'fact', version: '1', owner: 'invented' }, hash })).toThrow()
  })

  it('represents complete relation query results including the empty set without arbitrary paths', () => {
    const reference = { kind: 'relation-set', relation: 'assignment', object: 'position', scope: 'organization', hash }
    expect(simulationWorldEvidenceRefSchema.parse(reference)).toEqual(reference)
    expect(() => simulationWorldEvidenceRefSchema.parse({ ...reference, path: '$.assignments' })).toThrow()
    expect(() => simulationWorldEvidenceRefSchema.parse({ ...reference, hash: 'arbitrary-text' })).toThrow()
    expect(() => simulationWorldEvidenceRefSchema.parse({ ...reference, scope: '' })).toThrow()
  })

  it.each([
    { kind: 'entity', id: 'person', revision: -1 },
    { kind: 'entity', id: 'person', revision: 0 },
    { kind: 'entity', id: 'person', revision: Number.MAX_SAFE_INTEGER + 1 },
    { kind: 'authority', id: 'grant', generation: 0 },
    { kind: 'relation', id: 'assignment', revision: 1, effectiveFrom: '10', effectiveUntil: '10' },
    { kind: 'relation', id: 'assignment', revision: 1, effectiveFrom: '10', effectiveUntil: '9' },
    { kind: 'unknown-domain-reference', id: 'anything', revision: 1 },
    { kind: 'norm', id: 'rule', revision: 1 },
    { kind: 'proposal', id: 'proposal', hash: 'hash-1' },
    { kind: 'resolution', id: 'resolution', hash: `sha256:${'A'.repeat(64)}` },
  ])('rejects malformed or uncomparable references: %j', (value) => {
    expect(() => simulationWorldEvidenceRefSchema.parse(value)).toThrow()
  })

  it.each([
    [simulationWorldDomainPlanSchema, plan], [simulationWorldDomainResultSchema, result],
    [simulationWorldDomainMutationSchema, mutation],
  ] as const)('parses complete persisted envelopes and rejects injected fields', (schema, value) => {
    expect(schema.parse(value)).toEqual(value)
    expect(() => schema.parse({ ...value, caller: 'invented' })).toThrow()
    expect(() => schema.parse({ ...value, pin: { ...pin, provider: 'replacement' } })).toThrow()
    expect(() => schema.parse({ ...value, pin: { ...pin, generation: 0 } })).toThrow()
    expect(() => schema.parse({ ...value, payload: { callback: () => null } })).toThrow()
  })

  it('preserves the difference between rejection, blocking and uncertain accepted IO', () => {
    for (const outcome of [
      { kind: 'rejected', reason: 'policy' }, { kind: 'blocked', reason: 'approval-pending' },
      { kind: 'outcome-unknown', mutationId: 'original-mutation' },
    ]) expect(simulationWorldDomainResultSchema.parse({ ...result, outcome }).outcome).toEqual(outcome)
    expect(() => simulationWorldDomainResultSchema.parse({ ...result,
      outcome: { kind: 'outcome-unknown', reason: 'maybe' } })).toThrow()
  })
})

describe('controlled domain registry', () => {
  it('resolves an exact installed selector and rejects unknown domains, operations and versions distinctly', () => {
    const registry = new SimulationWorldDomainRegistry()
    registry.register(definition, implementation)
    expect(registry.resolve(selector)).toEqual(definition)
    expect(registry.pin(selector)).toEqual(pin)
    expectCode(() => registry.resolve({ ...selector, domain: 'unknown' }), 'SIM_WORLD_DOMAIN_UNKNOWN')
    expectCode(() => registry.resolve({ ...selector, operation: 'release' }), 'SIM_WORLD_OPERATION_UNKNOWN')
    expectCode(() => registry.resolve({ ...selector, version: '2' }), 'SIM_WORLD_VERSION_UNAVAILABLE')
    expectCode(() => registry.resolve({ ...selector, unknown: true } as typeof selector), 'SIM_WORLD_SCHEMA')
  })

  it('uses all four installed payload parsers before any provider execution', () => {
    let executions = 0
    const registry = new SimulationWorldDomainRegistry<typeof implementation>()
    registry.register(definition, { ...implementation, reserve: () => { executions++; return 'executed' } })
    expect(registry.parseRequest(request)).toEqual(request)
    expect(registry.parsePlan(plan)).toEqual(plan)
    expect(registry.parseResult(result)).toEqual(result)
    expect(registry.parseMutation(mutation)).toEqual(mutation)
    const parsers = [registry.parseRequest.bind(registry), registry.parsePlan.bind(registry),
      registry.parseResult.bind(registry), registry.parseMutation.bind(registry)]
    for (const [index, value] of [request, plan, result, mutation].entries()) {
      expectCode(() => parsers[index]!({ ...value, payload: { ...value.payload, unknown: true } }), 'SIM_WORLD_SCHEMA')
      expectCode(() => parsers[index]!({ ...value, payload: {} }), 'SIM_WORLD_SCHEMA')
    }
    expectCode(() => registry.parsePlan({ ...plan, payload: { booking: 'booking',
      policy: { version: '1', invisible: true } } }), 'SIM_WORLD_SCHEMA')
    expect(executions).toBe(0)
  })

  it.each([
    z.object({ booking: z.string() }), z.looseObject({ booking: z.string() }),
    z.strictObject({ nested: z.object({ booking: z.string() }) }),
    z.strictObject({ nested: z.record(z.string(), z.string()) }),
    z.strictObject({ nested: z.array(z.object({ booking: z.string() })) }),
    z.strictObject({ nested: z.unknown() }), z.any(),
  ])('rejects payload registrations that can hide unknown fields', (schema) => {
    const registry = new SimulationWorldDomainRegistry()
    expectCode(() => registry.register({ ...definition, schemas: { ...definition.schemas, request: schema } }, implementation),
      'SIM_WORLD_SCHEMA')
    expectCode(() => registry.resolve(selector), 'SIM_WORLD_DOMAIN_UNKNOWN')
  })

  it('admits strict discriminated payload unions without weakening their branches', () => {
    const registry = new SimulationWorldDomainRegistry()
    registry.register({ ...definition, schemas: { ...definition.schemas, request: z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('reserve'), room: z.string() }),
      z.strictObject({ action: z.literal('release'), booking: z.string() }),
    ]) } }, implementation)
    expect(registry.parseRequest({ ...request, payload: { action: 'release', booking: 'booking' } }).payload)
      .toEqual({ action: 'release', booking: 'booking' })
    expectCode(() => registry.parseRequest({ ...request, payload: { action: 'release', booking: 'booking', room: 'atlas' } }),
      'SIM_WORLD_SCHEMA')
  })

  it('closes admission synchronously, drains existing execution and retains exact original parsers', async () => {
    const registry = new SimulationWorldDomainRegistry<typeof implementation>()
    const dispose = registry.register(definition, implementation)
    const lease = registry.acquire(registry.pin(selector))
    expect(lease.implementation.reserve()).toBe('original')
    let drained = false
    const draining = dispose().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    expectCode(() => registry.parseRequest(request), 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE')
    expect(registry.parseRequest(request, lease.pin)).toEqual(request)
    expectCode(() => registry.parseRequest({ ...request, operation: 'other' }, lease.pin), 'SIM_WORLD_IMPLEMENTATION_MISMATCH')
    expectCode(() => registry.acquire(registry.pin(selector)), 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE')
    expectCode(() => registry.acquire(simulationWorldDomainPlanSchema.parse(plan).pin), 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE')
    expect(registry.parsePlan(plan)).toEqual(plan)
    expect(lease.implementation.reserve()).toBe('original')
    lease.release()
    lease.release()
    await draining
    expect(drained).toBe(true)
    await dispose()
    expect(registry.parseResult(result)).toEqual(result)
    expect(registry.parseMutation(mutation)).toEqual(mutation)
    expectCode(() => registry.register(definition, { ...implementation, reserve: () => 'replacement' }),
      'SIM_WORLD_REGISTRATION_CONFLICT')
  })

  it('allows a new generation without redirecting retained or uncertain old responsibilities', async () => {
    const registry = new SimulationWorldDomainRegistry<typeof implementation>()
    const dispose = registry.register(definition, implementation)
    const original = registry.acquire(registry.pin(selector))
    const draining = dispose()
    const disposeReplacement = registry.register(definition, { ...implementation, generation: 2, reserve: () => 'replacement' })
    const replacement = registry.acquire(registry.pin(selector))
    expect(replacement.implementation.reserve()).toBe('replacement')
    expect(original.implementation.reserve()).toBe('original')
    expectCode(() => registry.acquire(simulationWorldDomainPlanSchema.parse(plan).pin), 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE')
    expect(registry.parseResult({ ...result, outcome: { kind: 'outcome-unknown', mutationId: 'mutation' } }).pin.generation).toBe(1)
    expectCode(() => registry.acquire({ ...registry.pin(selector), schemaRef: worldSchemaRefSchema.parse('forged-schema') }),
      'SIM_WORLD_IMPLEMENTATION_MISMATCH')
    original.release()
    replacement.release()
    await draining
    await disposeReplacement()
  })

  it('refuses changed payload schemas under a retained immutable schema reference', async () => {
    const registry = new SimulationWorldDomainRegistry()
    await registry.register(definition, implementation)()
    expectCode(() => registry.register({ ...definition, schemas: { ...definition.schemas,
      request: z.strictObject({ alternative: z.string() }) } }, { ...implementation, generation: 2 }),
    'SIM_WORLD_REGISTRATION_CONFLICT')
  })

  it('does not mistake equal JSON schema shapes for the same refinement or transformation contract', async () => {
    const registry = new SimulationWorldDomainRegistry()
    await registry.register(definition, implementation)()
    const equivalentShape = z.strictObject({ room: z.string().min(1), from: z.string(), until: z.string() })
      .refine(value => value.room !== 'atlas', 'Atlas is forbidden by this replacement')
    expectCode(() => registry.register({ ...definition, schemas: { ...definition.schemas,
      request: equivalentShape } }, { ...implementation, generation: 2 }), 'SIM_WORLD_REGISTRATION_CONFLICT')
    const replacementDefinition = { ...definition, schemaRef: worldSchemaRefSchema.parse('meeting-room/reserve/schema/2'),
      schemas: { ...definition.schemas, request: equivalentShape } }
    const dispose = registry.register(replacementDefinition, { ...implementation, generation: 2 })
    expectCode(() => registry.parseRequest(request), 'SIM_WORLD_SCHEMA')
    expect(registry.parsePlan(plan)).toEqual(plan)
    await dispose()
  })

  it('refuses registered transformations that return non-JSON public or persisted data', () => {
    const registry = new SimulationWorldDomainRegistry()
    registry.register({ ...definition, schemas: { ...definition.schemas,
      request: definition.schemas.request.transform(() => ({ callback: () => undefined })) } }, implementation)
    expectCode(() => registry.parseRequest(request), 'SIM_WORLD_SCHEMA')
  })

  it('preserves parser failure causes and exposes stable categories separately from diagnostics', () => {
    const registry = new SimulationWorldDomainRegistry()
    registry.register(definition, implementation)
    try {
      registry.parseRequest({ ...request, payload: {} })
      throw new Error('Expected the registered parser to reject incomplete input')
    } catch (error) {
      if (!(error instanceof SimulationWorldDomainError)) throw error
      expect(error.code).toBe('SIM_WORLD_SCHEMA')
      expect(error.cause).toBeInstanceOf(z.ZodError)
    }
  })
})

describe('World parser error ownership', () => {
  it('identifies missing nested fields and unexpected properties while preserving the complete parser cause', () => {
    const schema = z.strictObject({ payload: z.strictObject({ templateVersion: z.string(),
      persona: z.strictObject({ name: z.string() }) }) })
    expect(() => parseSimulationWorldSchema(schema, { payload: { persona: {}, invented: true } }))
      .toThrow('payload.templateVersion: Invalid input: expected string, received undefined')
    expect(() => parseSimulationWorldSchema(schema, { payload: { persona: {}, invented: true } }))
      .toThrow('payload.persona.name: Invalid input: expected string, received undefined')
    expect(() => parseSimulationWorldSchema(schema, { payload: { persona: {}, invented: true } }))
      .toThrow('Unrecognized key: "invented"')
  })

  it('bounds diagnostic paths, messages and count without discarding the original issues', () => {
    const schema = z.array(z.strictObject({ ['long'.repeat(100)]: z.string().min(1, '错'.repeat(1000)) }))
    try {
      parseSimulationWorldSchema(schema, Array.from({ length: 20 }, () => ({ ['long'.repeat(100)]: '' })))
      throw new Error('Expected invalid domain input')
    } catch (error) {
      if (!(error instanceof SimulationWorldDomainError) || !(error.cause instanceof z.ZodError)) throw error
      expect(error.message).toContain('12 more issues')
      expect(error.message.length).toBeLessThan(3300)
      expect(error.cause.issues).toHaveLength(20)
    }
  })

  it('returns parser output and preserves arbitrary implementation errors and business refusals', () => {
    expect(parseSimulationWorldSchema(z.string().transform(value => value.length), 'value')).toBe(5)
    for (const failure of [new Error('Implementation failed'),
      new SimulationWorldDomainError('SIM_WORLD_AUTHORITY', 'Owner refused')]) {
      const schema = z.string().transform(() => { throw failure })
      expect(() => parseSimulationWorldSchema(schema, 'value')).toThrow(failure)
    }
  })
})

describe('domain evidence vocabulary', () => {
  it('freezes the installed field definitions independently of the provider array', async () => {
    const { simulationWorldEvidenceFieldSchema } = await import('../src/world-evidence.ts')
    const fields = [simulationWorldEvidenceFieldSchema.parse({ code: 'requirements', description: 'Describe the missing requirements.' })]
    const registry = new SimulationWorldDomainRegistry()
    const remove = registry.register({ ...definition, evidenceFields: fields }, implementation)
    fields[0]!.description = 'Provider changed its object'
    fields.push(simulationWorldEvidenceFieldSchema.parse({ code: 'other', description: 'Another field.' }))
    const retained = registry.definition(selector).evidenceFields!
    expect(retained).toEqual([{ code: 'requirements', description: 'Describe the missing requirements.' }])
    expect(Object.isFrozen(retained)).toBe(true)
    expect(Object.isFrozen(retained[0])).toBe(true)
    await remove()
  })

  it.each(['renamed', 'rewritten', 'removed'] as const)('requires a new schema reference when evidence fields are %s', async (change) => {
    const { simulationWorldEvidenceFieldSchema } = await import('../src/world-evidence.ts')
    const field = simulationWorldEvidenceFieldSchema.parse({ code: 'requirements', description: 'Original question.' })
    const registry = new SimulationWorldDomainRegistry()
    await registry.register({ ...definition, evidenceFields: [field] }, implementation)()
    const fields = change === 'removed' ? undefined : [simulationWorldEvidenceFieldSchema.parse({
      code: change === 'renamed' ? 'different' : field.code,
      description: change === 'rewritten' ? 'Changed question.' : field.description,
    })]
    expect(() => registry.register({ ...definition, ...fields === undefined ? {} : { evidenceFields: fields } },
      { ...implementation, generation: 2 })).toThrow(expect.objectContaining({ code: 'SIM_WORLD_REGISTRATION_CONFLICT' }))
    const remove = registry.register({ ...definition, schemaRef: worldSchemaRefSchema.parse('meeting-room/reserve/schema/2'),
      ...fields === undefined ? {} : { evidenceFields: fields } }, { ...implementation, generation: 2 })
    await remove()
  })

  it.each([{ fields: [] }, { fields: [{ code: 'requirements', description: 'First' },
    { code: 'requirements', description: 'Second' }] }, { fields: [{ code: 'requirements', description: 'Question', authoritative: true }] }])(
    'rejects an invalid field contract before installing it: %j', ({ fields }) => {
      const registry = new SimulationWorldDomainRegistry()
      expect(() => registry.register(
        { ...definition, evidenceFields: fields } as unknown as SimulationWorldDomainDefinition, implementation))
        .toThrow(expect.objectContaining({ code: 'SIM_WORLD_SCHEMA' }))
      expect(() => registry.definition(selector)).toThrow()
    })
})
