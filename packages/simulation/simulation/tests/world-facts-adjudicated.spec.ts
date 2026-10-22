/** Structured facts retain closed semantic schemas and slim original sources rather than quoted/model authority. */
import { expect, expectTypeOf, it } from 'vitest'
import { simulationWorldFactRequestSchema, simulationWorldFactTextRequestSchema, simulationWorldFactVersionSchema,
  simulationWorldFactAdjudicatedRequestSchema, WORLD_FACT_EXTERNAL_ADJUDICATED_SCHEMA_REF,
  WORLD_FACT_TEXT_SCHEMA_REF, isWorldFactText, isWorldFactAdjudicated } from '../src/world-facts.ts'
import type { SimulationWorldFactAdjudicated, SimulationWorldFactText } from '../src/world-facts-types.ts'

const provenance = { kind: 'external-adjudication', identityId: 'original-identity', intentId: 'original-intent',
  requestId: 'original-request', planId: 'original-plan', adjudicationSequence: 1, policyFingerprint: `sha256:${'a'.repeat(64)}` }
const structured = { factId: 'weather', version: '1', schemaRef: WORLD_FACT_EXTERNAL_ADJUDICATED_SCHEMA_REF,
  subject: 'organization', scope: 'organization', payload: { claim: { kind: 'condition', predicate: 'weather',
    schemaRef: 'weather/1', value: { status: 'rain' } }, asOf: '0', provenance }, effectiveFrom: '0', effectiveUntil: null,
  availableAt: '0', audience: { kind: 'public' }, supersedes: null, sources: [] }
const text = { ...structured, schemaRef: WORLD_FACT_TEXT_SCHEMA_REF, payload: { body: 'Original text.' } }

it('keeps original text strict while admitting only the installed structured payload and exact slim provenance', () => {
  expect(simulationWorldFactTextRequestSchema.parse(text)).toEqual(text)
  expect(simulationWorldFactRequestSchema.parse(structured)).toEqual(structured)
  for (const input of [
    { ...text, payload: { ...text.payload, claim: structured.payload.claim } },
    { ...structured, payload: { ...structured.payload, body: 'Stock increased.' } },
    { ...structured, payload: { ...structured.payload, claim: { kind: 'quote', quantity: '1000' } } },
    { ...structured, payload: { ...structured.payload, claim: { kind: 'condition', predicate: 'inventory',
      schemaRef: 'inventory/1', value: { quantity: '1000' } } } },
    { ...structured, payload: { ...structured.payload, provenance: { ...provenance, context: 'private' } } },
    { ...structured, payload: { ...structured.payload, provenance: { ...provenance, policyFingerprint: 'unhashed' } } },
    { ...structured, payload: { ...structured.payload, provenance: { ...provenance,
      adjudicationSequence: Number.MAX_SAFE_INTEGER + 1 } } },
    { ...structured, schemaRef: 'uninstalled/custom/1' },
    { ...structured, source: { owner: 'model' } },
  ]) expect(simulationWorldFactRequestSchema.safeParse(input).success).toBe(false)
})

it('narrows both immutable publications by the exact installed schema reference', () => {
  for (const input of [text, structured]) {
    const { sources, ...fields } = input
    const fact = simulationWorldFactVersionSchema.parse({ ...fields, sequence: 2, recordedAt: 123,
      source: { kind: 'owner', owner: 'original', references: sources } })
    if (isWorldFactText(fact)) {
      expectTypeOf(fact).toEqualTypeOf<SimulationWorldFactText>()
      expect(fact.payload.body).toBe('Original text.')
      expect(isWorldFactAdjudicated(fact)).toBe(false)
    } else {
      expectTypeOf(fact).toEqualTypeOf<SimulationWorldFactAdjudicated>()
      expect(isWorldFactAdjudicated(fact)).toBe(true)
      expect(fact.payload.claim.kind).toBe('condition')
    }
  }
})

it('rejects arbitrary effects in every observation branch without coercing unknown stock to zero', () => {
  const claims = [structured.payload.claim,
    { kind: 'inventory-as-of', unit: 'widget', availability: { status: 'known', quantity: '7' } },
    { kind: 'inventory-as-of', unit: 'widget', availability: { status: 'unknown' } },
    { kind: 'balance-as-of', resourceId: 'money', quantity: '999' },
    { kind: 'commitment-as-of', commitmentId: 'obligation', phase: 'open' },
  ]
  for (const claim of claims) {
    expect(simulationWorldFactAdjudicatedRequestSchema.safeParse({ ...structured,
      payload: { ...structured.payload, claim } }).success).toBe(true)
    expect(simulationWorldFactAdjudicatedRequestSchema.safeParse({ ...structured,
      payload: { ...structured.payload, claim: { ...claim, execute: 'mint' } } }).success).toBe(false)
  }
  expect(simulationWorldFactAdjudicatedRequestSchema.safeParse({ ...structured,
    payload: { ...structured.payload, claim: { kind: 'inventory-as-of', unit: 'widget',
      availability: { status: 'unknown', quantity: '0' } } } }).success).toBe(false)
})
