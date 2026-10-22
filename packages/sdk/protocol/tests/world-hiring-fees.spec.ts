/** Authored fee terms remain inert original data; financial blockers use closed public stop categories. */
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { simulationProductOperationalStatusSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationControlResultSchema, simulationWorldPreflightParamsSchema, simulationWorldCreateParamsSchema } from '../src/simulation.ts'

const input: unknown = JSON.parse(await readFile(new URL('./fixtures/world-hiring-fee-definition.json', import.meta.url), 'utf8'))
const definition = simulationWorldPreflightParamsSchema.parse({ definition: input }).definition
if (definition.apiVersion !== 'clocky.world/v1') throw new Error('Hiring fee corpus requires v1')
const first = definition.organization.hiringFees![0]!
const controlInput: unknown = JSON.parse(await readFile(new URL('./fixtures/world-hiring-fee-control.json', import.meta.url), 'utf8'))
const stops = z.array(z.object({ reason: z.string(), control: simulationControlResultSchema,
  operational: simulationProductOperationalStatusSchema })).parse(controlInput)

it('keeps both hiring selectors and exact declared fee terms without injecting an absent declaration', () => {
  expect(definition).toEqual(input)
  const original = { definition, commandId: 'original', name: 'Explicit fee',
    preflight: { hash: `sha256:${'a'.repeat(64)}`, catalogGeneration: 'installed' } }
  expect(simulationWorldCreateParamsSchema.parse(original).definition).toEqual(definition)
  const { hiringFees: _fees, ...organization } = definition.organization
  const omitted = { ...definition, organization }
  expect(simulationWorldPreflightParamsSchema.parse({ definition: omitted }).definition).toEqual(omitted)
  const changed = { ...definition, organization: { ...organization, hiringFees: [{ ...first, operation: 'hire-existing' }] } }
  expect(simulationWorldPreflightParamsSchema.parse({ definition: changed }).definition).toEqual(changed)
})

it.each([{ quantity: '0' }, { quantity: '01' }, { quantity: 1 }, { quantity: true }, { reservationPeriod: '0' },
  { reservationPeriod: '-1' }, { reservationPeriod: 1 }, { policyRef: 'other/1' }, { operation: 'transfer' },
  { from: first.to }, { grants: ['duplicate', 'duplicate'] }, { from_: 'injected' }, { price: '1' }, { id: 'x'.repeat(257) }])(
  'rejects malformed or caller-expanded fee terms: %j', (patch) => {
    const changed = { ...definition, organization: { ...definition.organization, hiringFees: [{ ...first, ...patch }] } }
    expect(simulationWorldPreflightParamsSchema.safeParse({ definition: changed }).success).toBe(false)
  },
)

it.each(Object.keys(first))('requires the declared fee field %s', (field) => {
  const rule = Object.fromEntries(Object.entries(first).filter(([key]) => key !== field))
  expect(simulationWorldPreflightParamsSchema.safeParse({ definition: { ...definition,
    organization: { ...definition.organization, hiringFees: [rule] } } }).success).toBe(false)
})

it.each([null, false, {}])('distinguishes an omitted fee declaration from malformed %j', (hiringFees) => {
  expect(simulationWorldPreflightParamsSchema.safeParse({ definition: { ...definition,
    organization: { ...definition.organization, hiringFees } } }).success).toBe(false)
})

it.each(stops)('keeps the $reason public stop and rejects unknown or private categories', ({ reason, control, operational }) => {
  expect(control.stop).toBe(reason)
  expect(operational.status === 'observed' && operational.stop).toBe(reason)
  expect(simulationControlResultSchema.safeParse({ ...control, stop: 'resource-minted' }).success).toBe(false)
  expect(simulationControlResultSchema.safeParse({ ...control, feeQuote: {} }).success).toBe(false)
  expect(simulationProductOperationalStatusSchema.safeParse({ ...operational, stop: 'resource-minted' }).success).toBe(false)
  expect(simulationProductOperationalStatusSchema.safeParse({ ...operational, feeQuote: {} }).success).toBe(false)
})
