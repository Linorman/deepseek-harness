/** Current control metadata stays bounded while complete cut identities remain replay-authoritative. */
import { expect, it } from 'vitest'
import { simulationRunControlStateSchema, simulationStopTargetSchema } from '../src/run-control.ts'
import { observeSimulationRunControl, simulationRunControlObservationSchema } from '../src/run-control-observation.ts'
import { simulationWorldDomainPinSchema } from '../src/world-domain.ts'

it('projects large admitted-work and save histories as scalar counts without truncating the original cut', () => {
  const ids = Array.from({ length: 10000 }, (_, index) => `original-responsibility/${index}`)
  const state = simulationRunControlStateSchema.parse({ revision: 10000, commandId: 'stop', target: { targetId: 'day-one',
    clock: { kind: 'native' }, boundary: '1', mode: 'at-boundary', checkpointPolicy: 'request',
    drainBudget: { maxSteps: 1, maxTokens: 1, maxWallTimeMs: 1 } }, nativeBoundary: '1', activation: 'effective', state: 'paused',
  reason: 'target-reached', steps: 0, tokens: 0, checkpoint: 'pending', checkpointId: ids[9999], checkpointAttempts: ids,
  cut: { nativeRevision: 10000, nativeTime: '1', clockRevision: 10000, clockValue: '1', recordedAt: 10000, tokenBaseline: 10000,
    operationIds: ids, requestIds: ids, decisionIds: ids, tokenReservations: Object.fromEntries(ids.map(id => [id, 1])) } })
  const observed = observeSimulationRunControl(state)
  expect(observed).toMatchObject({ checkpointAttemptCount: 10000, cut: { operationCount: 10000, requestCount: 10000,
    decisionCount: 10000, tokenReservationCount: 10000 } })
  expect(simulationRunControlObservationSchema.parse(observed)).toEqual(observed)
  expect(Buffer.byteLength(JSON.stringify(observed))).toBeLessThan(2048)
  expect(observed.cut).not.toHaveProperty('operationIds')
  expect(observed).not.toHaveProperty('checkpointAttempts')
  expect(state.cut?.operationIds).toHaveLength(10000)
  expect(state.checkpointAttempts).toHaveLength(10000)
})

it('bounds only new stop-target selector metadata while preserving the global exact pin parser', () => {
  const pin = { domain: 'domain', operation: 'advance', version: '1', schemaRef: 'schema', implementationRef: 'implementation', generation: 1 }
  const target = { targetId: 'stop', clock: { kind: 'domain', pin, name: 'day' }, boundary: '12', mode: 'at-boundary',
    checkpointPolicy: 'none', drainBudget: { maxSteps: 1, maxTokens: 1, maxWallTimeMs: 1 } }
  expect(simulationStopTargetSchema.safeParse(target).success).toBe(true)
  const oversized = { ...pin, schemaRef: '😀'.repeat(129) }
  expect(simulationWorldDomainPinSchema.safeParse(oversized).success).toBe(true)
  expect(simulationStopTargetSchema.safeParse({ ...target, clock: { ...target.clock, pin: oversized } }).success).toBe(false)
  expect(simulationStopTargetSchema.safeParse({ ...target, boundary: '9'.repeat(257) }).success).toBe(false)
})
