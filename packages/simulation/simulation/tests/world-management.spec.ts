/** Strict public user originals keep opaque IDs, source variants and receipt relationships at the parser boundary. */
import { expect, expectTypeOf, it } from 'vitest'
import { simulationWorldManagementActionSchema, simulationWorldManagementSubmitRequestSchema,
  simulationWorldAuthenticatedUserSourceSchema, simulationWorldManagementReceiptSchema,
  simulationWorldIntentSchema, WORLD_TRANSFER_PIN, worldManagementCommandIdSchema } from '../src/index.ts'
import type { WorldManagementCommandId, SimulationEntityId } from '../src/index.ts'

const payload = { organizationEntityId: 'org', personId: 'person', assignmentId: 'assignment', assignmentRevision: 1,
  requestedEffectiveAt: null, description: 'Real user reason', targetPositionId: 'target' }
const source = simulationWorldAuthenticatedUserSourceSchema.parse({ kind: 'authenticated-user', commandId: 'original',
  principalId: 'principal', credentialGeneration: 0, policyRef: 'actual-management-policy', policyGeneration: '1', time: '0' })
it('preserves management and Native ID brands while refusing missing and invented action fields', () => {
  expectTypeOf(worldManagementCommandIdSchema.parse('original')).toEqualTypeOf<WorldManagementCommandId>()
  const action = simulationWorldManagementActionSchema.parse({ kind: 'transfer', payload })
  if (action.kind !== 'transfer') throw new Error('Transfer parser changed its action')
  expectTypeOf(action.payload.personId).toEqualTypeOf<SimulationEntityId>()
  for (const kind of ['transfer', 'depart', 'hire-existing']) {
    const body = kind === 'transfer' ? payload : kind === 'depart'
      ? { ...payload, targetPositionId: undefined, retire: false }
      : { organizationEntityId: 'org', personId: 'person', positionEntityId: 'target', description: 'Original user hire' }
    const value = JSON.parse(JSON.stringify({ kind, payload: body })) as Record<string, unknown>
    expect(simulationWorldManagementActionSchema.safeParse(value).success).toBe(true)
    expect(simulationWorldManagementActionSchema.safeParse({ ...value, requesterEntityId: 'director' }).success).toBe(false)
    for (const key of Object.keys(value.payload as Record<string, unknown>)) {
      const missing = { ...value, payload: Object.fromEntries(Object.entries(value.payload as Record<string, unknown>)
        .filter(([name]) => name !== key)) }
      expect(simulationWorldManagementActionSchema.safeParse(missing).success, `${kind}.${key}`).toBe(false)
    }
    expect(simulationWorldManagementActionSchema.safeParse({ ...value, payload: { ...(value.payload as object),
      operationId: 'fake' } }).success).toBe(false)
  }
  expect(simulationWorldManagementSubmitRequestSchema.safeParse({ commandId: 'original', action, expectedRevision: 1,
    previewHash: `sha256:${'a'.repeat(64)}`, source }).success).toBe(false)
})
it('accepts disjoint actual user provenance and rejects role impersonation, absent sources and scenario triggers', () => {
  const intent = { id: 'intent', pin: WORLD_TRANSFER_PIN, businessKey: 'original', requesterEntityId: null, source,
    scopeEntityId: 'org', targetEntityId: 'position', expectedTime: null, evidence: [], description: payload.description,
    payload, sequence: 1 }
  expect(simulationWorldIntentSchema.parse(intent)).toEqual(intent)
  for (const value of [{ ...intent, requesterEntityId: 'director' }, { ...intent, source: undefined },
    { ...intent, scenarioTrigger: {} }, { ...intent, operationId: 'fake' }])
    expect(simulationWorldIntentSchema.safeParse(value).success).toBe(false)
  expect(simulationWorldAuthenticatedUserSourceSchema.safeParse({ ...source, credential: 'secret' }).success).toBe(false)
})
it('rejects a different case or plan receipt rather than accepting independently schema-valid facts', () => {
  const receipt = { commandId: source.commandId, principalId: source.principalId, inputHash: `sha256:${'a'.repeat(64)}`,
    acceptedSequence: 1, intentId: 'intent', requestId: 'case', planId: 'plan' }
  expect(simulationWorldManagementReceiptSchema.parse(receipt)).toEqual(receipt)
  const execution = { planId: 'plan', requestId: 'case', intentId: 'intent', pin: WORLD_TRANSFER_PIN, expectedSequence: null,
    mode: 'execute', phase: 'armed', reason: null, sequence: 2, updates: 1, time: '0' }
  expect(simulationWorldManagementReceiptSchema.safeParse({ ...receipt, execution }).success).toBe(true)
  for (const field of ['planId', 'requestId', 'intentId'])
    expect(simulationWorldManagementReceiptSchema.safeParse({ ...receipt, execution: { ...execution,
      [field]: 'different' } }).success).toBe(false)
  const result = { id: 'result', requestId: 'case', intentId: 'intent', source: { kind: 'plan', planId: 'different' },
    outcome: { kind: 'committed' }, payload: {}, time: '0', sequence: 3 }
  expect(simulationWorldManagementReceiptSchema.safeParse({ ...receipt, result }).success).toBe(false)
})
