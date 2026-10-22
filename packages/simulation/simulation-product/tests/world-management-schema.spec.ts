/** Whole public user quotes reject spoofed identity, partial coverage and replaced exact choices. */
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { worldManagementCommandIdSchema, simulationWorldManagementPreviewSchema, simulationWorldAuthenticatedUserSourceSchema,
  simulationWorldManagementFundingAuthoritySchema } from '@clocky/clocky-simulation/world-management'
import { simulationResourceReservationSchema } from '@clocky/clocky-simulation'
import { simulationProductWorldCaseInspectionSchema, simulationProductWorldCasesPageSchema,
  simulationProductWorldCaseInputSchema, simulationProductWorldCasesInputSchema } from '../src/case-schema.ts'
import { managementCommandBoundaries, managementReasonBoundaries } from './world-management-fixture.ts'
import { expect, expectTypeOf, it } from 'vitest'
import { simulationProductWorldManagementCommandIdSchema } from '../src/schema-common.ts'
import type { WorldResultId } from '@clocky/clocky-simulation/world-types'
import type { SimulationProductCommandId } from '../src/administration-types.ts'
import { simulationProductWorldManagementDraftSchema, simulationProductWorldManagementPreviewSchema,
  simulationProductWorldManagementFieldsSchema, simulationProductWorldManagementOutcomeSchema,
  simulationProductWorldManagementSubmitInputSchema, matchesWorldManagementPreview } from '../src/world-management-schema.ts'
import { simulationProductRequestResultSchema, simulationProductRequestReceiptSchema } from '../src/administration-schema.ts'
import { managementDraft as draft, managementPreview as preview, managementFields as fields, managementSubmit as submit } from './world-management-fixture.ts'

it.each([{ principalId: 'fake-user' }, { requesterEntityId: 'fake-actor' }, { source: { kind: 'decision', decisionId: 'fake' } },
  { values: { ...draft.values, operationId: 'fake' } }, { action: 'rehire' }, { expectedRevision: -1 },
  { values: { ...draft.values, effective: 'at' } }, { values: { ...draft.values, reason: ' ' } }])(
  'refuses untrusted management source or incomplete choice %j', (change) => {
    expect(simulationProductWorldManagementDraftSchema.safeParse({ ...draft, ...change }).success).toBe(false)
  })
it.each([{ runId: 'other' }, { revision: 2 }, { coverage: { ...preview.coverage, complete: false, reason: 'native-only' } },
  { impact: null }, { impact: { ...preview.impact, personId: 'other' } }, { impact: { ...preview.impact, assignmentId: 'other' } },
  { impact: { ...preview.impact, targetPositionId: 'other' } }, { impact: { ...preview.impact, requestedEffectiveAt: '3' } },
  { blockers: ['handoff-required'] }, { apiVersion: 'clocky.world-management/v0' }])(
  'refuses a quote whose whole impact no longer describes the original form %j', (change) => {
    expect(simulationProductWorldManagementPreviewSchema.safeParse({ ...preview, ...change }).success).toBe(false)
  })
it('normalizes key order while retaining inactive original values and every confirmed choice', () => {
  expect(matchesWorldManagementPreview({ values: { reason: 'Original user reason', effective: 'boundary', position: 'position',
    assignmentId: 'assignment' }, targetId: 'person', runId: 'run', expectedRevision: 1, action: 'transfer' }, preview)).toBe(true)
  expect(matchesWorldManagementPreview({ ...draft, values: { ...draft.values, at: '2' } }, preview)).toBe(false)
  expect(simulationProductWorldManagementSubmitInputSchema.safeParse({ ...submit, runId: 'other' }).success).toBe(false)
})
it('rejects duplicate field identities, unavailable success and a future person revision', () => {
  for (const change of [{ fields: [...fields.fields, fields.fields[0]] }, { status: 'unavailable' }, { targetRevision: 4 },
    { fields: [{ id: 'position', kind: 'choice', required: true, options: [{ id: 'x', label: 'one' }, { id: 'x', label: 'two' }] }] }])
    expect(simulationProductWorldManagementFieldsSchema.safeParse({ ...fields, ...change }).success).toBe(false)
})
it('retains a real user original only on its exact receipt and refuses a foreign callback identity', () => {
  const request = { kind: 'world-management', runId: 'run', commandId: 'original-user', acceptedAt: 1, status: 'accepted' }
  expect(simulationProductRequestResultSchema.safeParse({ status: 'found', request, worldManagement: submit }).success).toBe(true)
  for (const change of [{ worldManagement: undefined }, { worldManagement: { ...submit, commandId: 'other' } },
    { worldManagementOutcome: { runId: 'other', commandId: 'original-user', acceptedSequence: 4, intentId: 'intent', requestId: 'case', planId: 'plan' } }])
    expect(simulationProductRequestResultSchema.safeParse({ status: 'found', request, worldManagement: submit, ...change }).success).toBe(false)
  expect(simulationProductWorldManagementOutcomeSchema.safeParse({ runId: 'run', commandId: 'original-user', acceptedSequence: 4,
    intentId: 'intent', requestId: 'case', planId: 'plan', result: { id: 'result', sequence: 3, time: '2', status: 'committed' } }).success).toBe(false)
})

it.each(managementCommandBoundaries)('matches Native UTF-16 command identity limits for $label on every management projection', async ({ commandId, allowed }) => {
  expect(worldManagementCommandIdSchema.safeParse(commandId).success).toBe(allowed)
  expect(simulationProductWorldManagementSubmitInputSchema.safeParse({ ...submit, commandId }).success).toBe(allowed)
  expect(simulationProductWorldManagementOutcomeSchema.safeParse({ commandId, runId: 'run', acceptedSequence: 4,
    intentId: 'intent', requestId: 'case', planId: 'plan' }).success).toBe(allowed)
  const receipt = { commandId, runId: 'run', kind: 'world-management', status: 'accepted', acceptedAt: 1 }
  expect(simulationProductRequestReceiptSchema.safeParse(receipt).success).toBe(allowed)
  if (commandId.length > 256) expect(simulationProductRequestReceiptSchema.safeParse({ ...receipt, kind: 'create' }).success).toBe(true)
  const families: unknown = JSON.parse(await readFile('python/sdk/tests/fixtures/world-management-cases-v3.json', 'utf8'))
  const fixtures = z.array(z.object({ sections: z.array(z.unknown()) })).parse(families)
  for (const raw of fixtures[0]!.sections) {
    const original = simulationProductWorldCaseInspectionSchema.parse(raw)
    if (original.status !== 'found' || original.value === undefined) throw new Error('Real user case fixture is absent')
    const summary = { ...original.value.summary, origin: { kind: 'authenticated-user', commandId } }
    const value = original.value.section === 'request' ? { ...original.value, summary, source: { ...original.value.source, commandId } }
      : { ...original.value, summary }
    expect(simulationProductWorldCaseInspectionSchema.safeParse({ ...original, value }).success).toBe(allowed)
  }
})

it('retains the Product administration brand at the bounded management parser', () => {
  expectTypeOf<z.output<typeof simulationProductWorldManagementCommandIdSchema>>().toEqualTypeOf<SimulationProductCommandId>()
})

it.each(managementReasonBoundaries)('keeps the TS owner management description rules for $label on every form', ({ reason, allowed }) => {
  for (const action of ['transfer', 'depart', 'hire-existing'] as const) {
    const values = action === 'hire-existing' ? { position: 'position', reason }
      : { assignmentId: 'assignment', effective: 'boundary', reason, ...action === 'transfer' ? { position: 'position' } : { retire: 'no' } }
    const input = { ...draft, action, values }
    const parsed = simulationProductWorldManagementDraftSchema.safeParse(input)
    expect(parsed.success).toBe(allowed)
    if (parsed.success) {
      if (parsed.data.action === 'hiring-market') throw new Error('Personnel form changed its action')
      expect(parsed.data.values.reason).toBe(reason)
    }
    expect(simulationProductWorldManagementSubmitInputSchema.safeParse({ ...submit, draft: input }).success).toBe(allowed)
  }
})

it('binds the shared blank corpus to the actual JavaScript trim semantics for every BMP character', () => {
  const observed = Array.from({ length: 65536 }, (_, index) => String.fromCharCode(index)).filter(value => value.trim().length === 0)
  const expected = managementReasonBoundaries.filter(value => value.label.startsWith('blank-U+')).map(value => value.reason)
  expect(observed).toEqual(expected)
})

it('preserves the Native result identity brand in management outcome metadata', () => {
  const output = simulationProductWorldManagementOutcomeSchema.parse({ commandId: 'original', runId: 'run', acceptedSequence: 4,
    intentId: 'intent', requestId: 'case', planId: 'plan', result: { id: 'actual-result', sequence: 5, time: '2', status: 'committed' } })
  if (output.result === undefined) throw new Error('Expected original result metadata')
  expectTypeOf(output.result.id).toEqualTypeOf<WorldResultId>()
})

it('matches Native bounded source and funding policy text without trimming or replacing UTF-16', async () => {
  const corpus = z.array(z.strictObject({ label: z.string(), text: z.string(), repeat: z.number().int().positive().optional(),
    suffix: z.string().optional(), allowed: z.boolean() })).parse(JSON.parse(await readFile(
    'python/sdk/tests/fixtures/world-management-authority-text.json', 'utf8')))
  const original = simulationResourceReservationSchema.parse(JSON.parse(await readFile(
    'python/sdk/tests/fixtures/world-management-native-hold.json', 'utf8')))
  if (original.management === undefined) throw new Error('Actual user hold lost its source')
  for (const item of corpus) {
    const value = item.text.repeat(item.repeat ?? 1) + (item.suffix ?? '')
    for (const field of ['principalId', 'policyRef', 'policyGeneration'] as const) {
      const source = { ...original.management, [field]: value }
      const parsed = simulationWorldAuthenticatedUserSourceSchema.safeParse(source)
      expect(parsed.success, `${field}/${item.label}`).toBe(item.allowed)
      if (parsed.success) expect(parsed.data[field]).toBe(value)
      expect(simulationResourceReservationSchema.safeParse({ ...original, management: source }).success).toBe(item.allowed)
    }
    for (const field of ['policyRef', 'policyGeneration'] as const) {
      const funding = { kind: 'native-controller', entityId: 'controller', policyRef: 'policy', policyGeneration: 'generation', [field]: value }
      const parsed = simulationWorldManagementFundingAuthoritySchema.safeParse(funding)
      expect(parsed.success, `funding/${field}/${item.label}`).toBe(item.allowed)
      if (parsed.success) expect(parsed.data[field]).toBe(value)
    }
  }
})

it.each(managementCommandBoundaries)('retains the fee and reservation owners 256-unit boundary for $label', async ({ commandId, allowed }) => {
  const original = simulationResourceReservationSchema.parse(JSON.parse(await readFile(
    'python/sdk/tests/fixtures/world-management-native-hold.json', 'utf8')))
  if (original.world === undefined) throw new Error('Actual hold lost its frozen fee')
  expect(simulationWorldManagementPreviewSchema.shape.hiringFee.unwrap().safeParse({ ...original.world.fee, id: commandId }).success)
    .toBe(allowed)
  expect(simulationResourceReservationSchema.safeParse({ ...original, id: commandId }).success).toBe(allowed)
})

it('rejects all shared case optional-null paths while retaining required null facts', async () => {
  const rows = z.array(z.strictObject({ kind: z.enum(['inspection', 'page', 'input', 'list-input']), label: z.string(), value: z.json(),
    forbiddenNullPaths: z.array(z.array(z.union([z.string(), z.number()])).min(1)),
    requiredNullPaths: z.array(z.array(z.union([z.string(), z.number()])).min(1)),
  })).parse(JSON.parse(await readFile('python/sdk/tests/fixtures/world-case-optional-boundaries.json', 'utf8')))
  const schemas = { inspection: simulationProductWorldCaseInspectionSchema, page: simulationProductWorldCasesPageSchema,
    input: simulationProductWorldCaseInputSchema, 'list-input': simulationProductWorldCasesInputSchema }
  for (const row of rows) {
    expect(schemas[row.kind].safeParse(row.value).success, row.label).toBe(true)
    for (const [paths, remove] of [[row.forbiddenNullPaths, false], [row.requiredNullPaths, true]] as const) {
      for (const path of paths) {
        const changed = structuredClone(row.value)
        let current = changed
        for (const part of path.slice(0, -1)) {
          if (Array.isArray(current) && typeof part === 'number') current = current[part]!
          else if (current !== null && typeof current === 'object' && !Array.isArray(current) && typeof part === 'string') current = current[part]!
          else throw new Error('Case corpus path has no original container')
        }
        const key = path.at(-1)
        if (current === null || typeof current !== 'object' || Array.isArray(current) || typeof key !== 'string')
          throw new Error('Case corpus path must name an original object field')
        let mutation: unknown = changed
        if (remove) mutation = JSON.parse(JSON.stringify(changed, function (this: unknown, field: string, value: unknown) {
          return this === current && field === key ? undefined : value
        }))
        else current[key] = null
        expect(schemas[row.kind].safeParse(mutation).success, `${row.label}/${path.join('/')}`).toBe(false)
      }
    }
  }
})

it('rejects forbidden nullable request-result branch keys', () => {
  const found = { status: 'found', commandId: null, request: { commandId: submit.commandId, runId: submit.runId,
    kind: 'world-management', status: 'accepted', acceptedAt: 1 }, worldManagement: submit }
  expect(simulationProductRequestResultSchema.safeParse(found).success).toBe(false)
  expect(simulationProductRequestResultSchema.safeParse({ status: 'not-found', commandId: 'original', request: null }).success).toBe(false)
})

it.each([{ sequence: 0, allowed: true }, { sequence: 1, allowed: true }, { sequence: Number.MAX_SAFE_INTEGER, allowed: true },
  { sequence: -1, allowed: false }, { sequence: Number.MAX_SAFE_INTEGER + 1, allowed: false }, { sequence: true, allowed: false }])(
  'keeps Native expiry consumption cursor $sequence at its actual safe nonnegative boundary', async ({ sequence, allowed }) => {
    const original = simulationResourceReservationSchema.parse(JSON.parse(await readFile(
      'python/sdk/tests/fixtures/world-management-native-hold.json', 'utf8')))
    expect(simulationResourceReservationSchema.safeParse({ ...original, world: { ...original.world,
      expiryConsumed: { eventId: 'expiry', sequence, time: '0' } } }).success).toBe(allowed)
  })

it('keeps every Native hold numeric optional and required-nullable boundary at the source-owned result', async () => {
  const rows = z.array(z.strictObject({ label: z.string(), category: z.string(), value: z.json(), allowed: z.boolean() }))
    .parse(JSON.parse(await readFile('python/sdk/tests/fixtures/world-native-hold-boundaries.json', 'utf8')))
  for (const row of rows) expect(simulationResourceReservationSchema.safeParse(row.value).success, row.label).toBe(row.allowed)
})
