/** Public SDK readers retain reservation names and opaque journal text without granting Native mutation authority. */
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { simulationObjectResultSchema, simulationRecordsResultSchema, simulationWorldPreflightResultSchema,
  simulationWorldPreflightParamsSchema } from '../src/simulation.ts'

const input: unknown = JSON.parse(await readFile(new URL('./fixtures/simulation-resource-reservation-cases.json', import.meta.url), 'utf8'))
const cases = z.array(z.object({ kind: z.string(), action: z.record(z.string(), z.unknown()),
  operation: simulationObjectResultSchema, records: simulationRecordsResultSchema })).parse(input)
const preview: unknown = JSON.parse(await readFile(new URL('./fixtures/world-v1-preview.json', import.meta.url), 'utf8'))
const installed = simulationWorldPreflightResultSchema.parse(preview)
if (installed.status !== 'ready') throw new Error('Complete reservation allowance fixture requires a ready preview')
const source: unknown = JSON.parse(await readFile(new URL('./fixtures/world-v1-definition.json', import.meta.url), 'utf8'))
const definition = simulationWorldPreflightParamsSchema.parse({ definition: source }).definition

it('retains the explicit resolved history and a separate portable override without introducing defaults', () => {
  expect(installed.limits.native.maxResourceReservationHistory).toBe(128)
  const parsed = simulationWorldPreflightParamsSchema.parse({ definition: { ...definition,
    limits: { ...definition.limits, native: { maxResourceReservationHistory: 1 } } } })
  expect(parsed.definition.limits?.native).toEqual({ maxResourceReservationHistory: 1 })
})

it.each(cases)('preserves public $kind effects and the original JSON body as text', ({ kind, action, operation, records }) => {
  expect(operation.status === 'found' && operation.value?.section === 'execution' && 'summary' in operation.value
    && 'kind' in operation.value.summary && operation.value.summary.kind.text).toBe(kind)
  expect(records.items[0]?.action?.text).toBe(kind)
  expect(simulationRecordsResultSchema.parse(records)).toEqual(records)
  expect(() => simulationRecordsResultSchema.parse({ ...records, bodyAccess: 'withheld' })).toThrow()
  const body = records.items[0]!.body
  expect(body.status === 'text' && JSON.parse(body.text)).toEqual(action)
  expect(() => simulationRecordsResultSchema.parse({ ...records,
    items: [{ ...records.items[0], body: { ...body, transaction: {} } }] })).toThrow()
  const { status: _status, ...missing } = operation
  expect(() => simulationObjectResultSchema.parse(missing)).toThrow()
  expect(() => simulationObjectResultSchema.parse({ ...operation, reservation: {} })).toThrow()
})

it.each([undefined, null, true, false, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '128'])(
  'refuses missing or non-positive-safe reservation history in resolved allowances: %j', (maximum) => {
    const { maxResourceReservationHistory: _maximum, ...native } = installed.limits.native
    const changed = { ...installed, limits: { ...installed.limits,
      native: { ...native, ...maximum === undefined ? {} : { maxResourceReservationHistory: maximum } } } }
    expect(simulationWorldPreflightResultSchema.safeParse(changed).success).toBe(false)
    if (maximum !== undefined) expect(simulationWorldPreflightParamsSchema.safeParse({ definition: { ...definition,
      limits: { ...definition.limits, native: { maxResourceReservationHistory: maximum } } } }).success).toBe(false)
  },
)
