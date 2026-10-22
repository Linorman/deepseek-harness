/** Callback facts are strict and nonterminal, independent of their final business result. */
import { describe, expect, expectTypeOf, it } from 'vitest'
import { worldExecutionRequestSchema, worldExecutionObservationSchema, worldExecutionReasonSchema } from '../src/world-execution.ts'
import type { WorldPlanId, WorldRequestId } from '../src/world-types.ts'
import type { WorldIntentId } from '../src/world-domain-types.ts'
import { WORLD_HIRE_EXISTING_PIN } from '../src/world-hire-existing.ts'

const request = { planId: 'plan', mode: 'execute', expectedSequence: null }
const source = { requestId: 'request', intentId: 'intent', pin: WORLD_HIRE_EXISTING_PIN, sequence: 3, updates: 1, time: '0' }

describe('strict callback observations', () => {
  it.each(['armed', 'settled'] as const)('requires an explicit null reason for %s', (phase) => {
    const input = { ...request, phase, reason: null }
    expect(worldExecutionRequestSchema.parse(input)).toEqual(input)
    expect(worldExecutionObservationSchema.parse({ ...input, ...source })).toEqual({ ...input, ...source })
    for (const reason of [undefined, 'callback-unconfirmed'])
      expect(() => worldExecutionRequestSchema.parse({ ...input, reason })).toThrow()
  })

  it.each(['blocked', 'outcome-unknown'] as const)('requires an installed finite reason for %s', (phase) => {
    for (const reason of worldExecutionReasonSchema.options) {
      const input = { ...request, phase, reason }
      expect(worldExecutionRequestSchema.parse(input)).toEqual(input)
      expect(worldExecutionObservationSchema.parse({ ...input, ...source })).toEqual({ ...input, ...source })
    }
    for (const reason of [undefined, null, 'private provider prose'])
      expect(() => worldExecutionRequestSchema.parse({ ...request, phase, reason })).toThrow()
  })

  it('rejects incomplete, extended and unsafe-sequence facts while preserving identity brands', () => {
    const input = { ...request, phase: 'armed', reason: null }, complete = { ...input, ...source }
    for (const field of Object.keys(complete))
      expect(() => worldExecutionObservationSchema.parse(Object.fromEntries(Object.entries(complete)
        .filter(([key]) => key !== field)))).toThrow()
    expect(() => worldExecutionRequestSchema.parse({ ...input, requesterId: 'forged' })).toThrow()
    expect(() => worldExecutionObservationSchema.parse({ ...complete, callback: 'forged' })).toThrow()
    for (const expectedSequence of [0, -1, Number.MAX_SAFE_INTEGER + 1])
      expect(() => worldExecutionRequestSchema.parse({ ...input, expectedSequence })).toThrow()
    const parsed = worldExecutionObservationSchema.parse(complete)
    expectTypeOf(parsed.planId).toEqualTypeOf<WorldPlanId>()
    expectTypeOf(parsed.requestId).toEqualTypeOf<WorldRequestId>()
    expectTypeOf(parsed.intentId).toEqualTypeOf<WorldIntentId>()
  })
})
