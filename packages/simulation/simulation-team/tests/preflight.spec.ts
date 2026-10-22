import { expect, it } from 'vitest'
import { z } from 'zod'
import { SimulationWorldDomainRegistry, simulationWorldDomainPinSchema, WORLD_EXTERNAL_MEDIATED_DEFINITION,
  WORLD_EXTERNAL_MEDIATED_PIN } from '@clocky/clocky-simulation'
import type { SimulationWorldContext } from '@clocky/clocky-simulation'
import { preflightProposals } from '../src/preflight.ts'

const pin = simulationWorldDomainPinSchema.parse({ domain: 'harbor', operation: 'execute', version: '3',
  schemaRef: 'schema/3', implementationRef: 'implementation/3', generation: 3 })
const request = z.strictObject({ command: z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('audit') }), z.strictObject({ kind: z.literal('advance'), day: z.number().int().positive() }),
]) })
function fixture() {
  const registry = new SimulationWorldDomainRegistry()
  const dispose = registry.register({ ...pin, schemas: { request, plan: z.strictObject({ forwardOriginal: z.literal(true) }),
    result: z.strictObject({}), mutation: z.strictObject({}) } }, { ref: pin.implementationRef, generation: pin.generation })
  const scope: SimulationWorldContext = { kind: 'goal', operations: [{ pin, grants: [] }], assignments: [], baseRevision: 0 }
  const proposal = { after: [], action: { kind: 'world/request', domain: 'harbor', operation: 'execute', version: '3',
    businessKey: 'key', expectedTime: null, evidence: [], payload: { command: { kind: 'audit' } } } }
  return { registry, dispose, scope, proposal }
}

it('checks exact frozen request and resolution parsers without executing or allocating requests', async () => {
  const h = fixture(), before = structuredClone(h.proposal)
  expect(preflightProposals([h.proposal], h.scope, h.registry)).toEqual([h.proposal])
  expect(h.proposal).toEqual(before)
  expect(() => preflightProposals([{ ...h.proposal, action: { ...h.proposal.action, version: '2' } }], h.scope, h.registry))
    .toThrow(/operation\/version authorized/)
  const resolve: SimulationWorldContext = { kind: 'scenario-resolve', pin, requestId: 'current' as never,
    intentId: 'intent' as never, reads: [], baseRevision: 0, trigger: {} as never }
  const plan = { after: [], action: { kind: 'world/resolve', requestId: 'current', supersedes: null,
    resolution: { kind: 'apply', payload: { forwardOriginal: true }, rationale: 'Forward unchanged.' } } }
  expect(preflightProposals([plan], resolve, h.registry)).toEqual([plan])
  expect(() => preflightProposals([{ ...plan, action: { ...plan.action, requestId: 'old' } }], resolve, h.registry)).toThrow(/current requestId/)
  expect(() => preflightProposals([{ ...plan, action: { ...plan.action,
    resolution: { ...plan.action.resolution, payload: { command: { kind: 'audit' } } } } }], resolve, h.registry))
    .toThrow(/resolution.payload.forwardOriginal/)
  await h.dispose()
  // Parser tombstones remain structural evidence after unloading; they never confer execution admission.
  expect(preflightProposals([plan], resolve, h.registry)).toEqual([plan])
  expect(() => h.registry.acquire(pin)).toThrow(/no longer admits/)
})

it('reports bounded paths, codes and allowed values and rejects unknown fields without stripping them', () => {
  const h = fixture()
  for (const bad of [ { action: h.proposal.action },
    { ...h.proposal, unknown: true },
    { ...h.proposal, action: { ...h.proposal.action, resolution: {} } },
    { ...h.proposal, action: { ...h.proposal.action, payload: { command: { kind: 'wrong' } } } },
    { ...h.proposal, action: { ...h.proposal.action, payload: { command: { kind: 'audit', text: '机密'.repeat(10000) } } } },
  ]) {
    try { preflightProposals([bad], h.scope, h.registry); expect.fail('must reject') }
    catch (cause) {
      expect(cause).toBeInstanceOf(Error)
      const message = (cause as Error).message
      expect(message).toContain('previous staged list is unchanged')
      expect(message).toContain('proposals.0')
      expect(Buffer.byteLength(message)).toBeLessThan(4096)
      expect(message).not.toContain('机密')
    }
  }
  expect(() => preflightProposals([{ ...h.proposal, action: { ...h.proposal.action,
    payload: { command: { kind: 'wrong' } } } }], h.scope, h.registry)).toThrow(/allowedValues/)
  const valid = { ...h.proposal, action: { ...h.proposal.action, businessKey: '合法'.repeat(1000) } }
  expect(preflightProposals([valid], h.scope, h.registry)[0]?.action).toEqual(valid.action)
})

it('identifies missing fields in the selected external outcome without unrelated union branches or private values', () => {
  const registry = new SimulationWorldDomainRegistry()
  registry.register(WORLD_EXTERNAL_MEDIATED_DEFINITION, {
    ref: WORLD_EXTERNAL_MEDIATED_PIN.implementationRef, generation: WORLD_EXTERNAL_MEDIATED_PIN.generation,
  })
  const scope: SimulationWorldContext = { kind: 'resolve', pin: WORLD_EXTERNAL_MEDIATED_PIN,
    requestId: 'current' as never, intentId: 'intent' as never, notificationOperationId: 'notification' as never,
    reads: [], baseRevision: 0 }
  const outcome = { kind: 'unverified-report', sourceKind: 'director-mediated', attribution: 'scenario-generated',
    policyRef: 'clocky.external.adjudication/1', evidence: [], disclosure: { kind: 'requester' }, reliability: 'unverified',
    statement: 'PRIVATE-REPORT-CANARY',
    quote: { unit: 'book', quantity: '8', price: { currency: 'credit', quantity: '0' }, validUntil: null } }
  const proposal = { after: [], action: { kind: 'world/resolve', requestId: 'current', supersedes: null,
    resolution: { kind: 'apply', payload: { kind: 'adjudicate', outcome }, rationale: 'PRIVATE-RATIONALE-CANARY' } } }
  expect(() => preflightProposals([proposal], scope, registry)).toThrow(
    '"diagnostics":[{"path":"proposals.0.action.resolution.payload.outcome.subjectRef","code":"invalid_type","expected":"string"}],"truncated":false')
  expect(preflightProposals([{ ...proposal, action: { ...proposal.action,
    resolution: { ...proposal.action.resolution, payload: { kind: 'adjudicate', outcome: { ...outcome, subjectRef: 'library' } } },
  } }], scope, registry)).toHaveLength(1)
})

it('bounds expanded union diagnostics and retains the union when no kind branch is selected', () => {
  const h = fixture()
  const nested = z.union([z.strictObject({ kind: z.literal('report'),
    fields: z.strictObject(Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`field${index}`, z.string()]))),
  }), z.strictObject({ kind: z.literal('failure') })])
  const registry = { payloadSchema: () => z.strictObject({ outcome: nested }) }
  const check = (outcome: unknown) => {
    try { preflightProposals([{ ...h.proposal, action: { ...h.proposal.action, payload: { outcome } } }], h.scope, registry) }
    catch (cause) { return (cause as Error).message }
    throw new Error('Invalid replacement was accepted')
  }
  const expanded = check({ kind: 'report', fields: {} })
  expect(expanded).toContain('payload.outcome.fields.field0')
  expect(expanded).toContain('payload.outcome.fields.field7')
  expect(expanded).not.toContain('field8')
  expect(expanded).toContain('"truncated":true')
  expect(Buffer.byteLength(expanded)).toBeLessThan(4096)
  const ambiguous = check({ kind: 'PRIVATE-UNKNOWN-KIND', fields: {} })
  expect(ambiguous).toContain('"code":"invalid_union"')
  expect(ambiguous).not.toContain('PRIVATE-UNKNOWN-KIND')
})
