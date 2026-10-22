import { expect, expectTypeOf, it } from 'vitest'
import {
  simulationWorldFactRequestSchema, simulationWorldFactVersionSchema, simulationWorldFactQuerySchema,
  WORLD_FACT_TEXT_SCHEMA_REF, worldFactIdSchema, worldFactVersionSchema,
} from '../src/world-facts.ts'
import type { WorldFactId, WorldFactVersion } from '../src/world-facts-types.ts'

const input = { factId: 'background', version: '1', schemaRef: WORLD_FACT_TEXT_SCHEMA_REF, subject: 'organization',
  scope: 'organization', payload: { body: 'Tomorrow the workshop opens.' }, effectiveFrom: '10', effectiveUntil: '20',
  availableAt: '0', audience: { kind: 'public' }, supersedes: null,
  sources: [{ kind: 'run-event', runId: 'run', sequence: 1 }] }

it('requires explicit publication fields and keeps recording metadata outside trusted owner input', () => {
  expect(simulationWorldFactRequestSchema.parse(input)).toEqual(input)
  expectTypeOf(worldFactIdSchema.parse('fact')).toEqualTypeOf<WorldFactId>()
  expectTypeOf(worldFactVersionSchema.parse('9007199254740993')).toEqualTypeOf<WorldFactVersion>()
  for (const field of ['source', 'recordedAt', 'sequence', 'sender', 'enforcement', 'policyRef']) {
    expect(() => simulationWorldFactRequestSchema.parse({ ...input, [field]: 'claimed' })).toThrow()
  }
  for (const field of ['scope', 'subject', 'audience', 'supersedes', 'availableAt', 'schemaRef']) {
    const incomplete = Object.fromEntries(Object.entries(input).filter(([key]) => key !== field))
    expect(() => simulationWorldFactRequestSchema.parse(incomplete)).toThrow()
  }
})

it('rejects unknown fact schemas, body fields and model/knowledge/report provenance', () => {
  expect(() => simulationWorldFactRequestSchema.parse({ ...input, schemaRef: 'unknown/fact/schema/1' })).toThrow()
  expect(() => simulationWorldFactRequestSchema.parse({ ...input, payload: { ...input.payload, execute: 'code' } })).toThrow()
  const { sources: _sources, ...fields } = input
  const fact = { ...fields, recordedAt: 123, sequence: 2, source: { kind: 'owner', owner: 'original', references: input.sources } }
  expect(simulationWorldFactVersionSchema.parse(fact)).toEqual(fact)
  for (const kind of ['belief', 'report', 'summary', 'inference', 'model']) {
    expect(() => simulationWorldFactVersionSchema.parse({ ...fact, source: { kind, owner: 'director', references: [] } })).toThrow()
  }
})

it.each([
  { ...input, version: '01' }, { ...input, version: '0' }, { ...input, effectiveFrom: '01' },
  { ...input, availableAt: '-1' }, { ...input, effectiveUntil: '10' }, { ...input, effectiveUntil: '9' },
  { ...input, audience: { kind: 'actors', entityIds: ['person', 'person'] } },
  { ...input, sources: [{ kind: 'session-event', sessionId: 'foreign', seq: 1 }] },
])('rejects unrepresentable time, version, audience and source fields: %j', (value) => {
  expect(() => simulationWorldFactRequestSchema.parse(value)).toThrow()
})

it('requires bounded explicit reader queries and rejects duplicates or caller-supplied publication authority', () => {
  const query = { viewer: 'person', cursor: 5, time: '10', limit: 2, ids: ['fact', 'unknown'] }
  expect(simulationWorldFactQuerySchema.parse(query)).toEqual(query)
  expect(() => simulationWorldFactQuerySchema.parse({ ...query, ids: ['fact', 'fact'] })).toThrow()
  expect(() => simulationWorldFactQuerySchema.parse({ ...query, limit: 0 })).toThrow()
  expect(() => simulationWorldFactQuerySchema.parse({ ...query, owner: 'director' })).toThrow()
})
