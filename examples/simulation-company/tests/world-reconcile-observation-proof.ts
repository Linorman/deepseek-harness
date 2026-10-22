/** Exact business-preserving proof for a failed retry of an already-retained callback. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import { worldExecutionObservationSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, WorldPlanId } from '@clocky/clocky-simulation'
import type { LogEntry } from '@clocky/clocky-storage'
const observed = z.strictObject({ kind: z.literal('run/world-execution'), runId: z.string(), expectedRevision: z.number().int(),
  change: z.strictObject({ kind: z.literal('world/execution'), observation: worldExecutionObservationSchema }) })
/**
 * Verify that unknown IO only appended the original armed/unknown observation pair.
 * @param before - Complete selected business, identity and occupancy projection before the retry.
 * @param after - Same projection after the failed retry.
 * @param entries - Actual Native journal readback.
 * @param revision - Original tail before callback admission.
 * @param planId - Exact original callback responsibility.
 * @returns nothing after checking unchanged business and all other execution responsibilities.
 */
export function assertUnknownReconcileOnly(before: { world: SimulationSnapshot['world'] }, after: { world: SimulationSnapshot['world'] },
  entries: readonly LogEntry[], revision: number, planId: WorldPlanId): void {
  assert.ok(before.world); assert.ok(after.world)
  const added = entries.filter(entry => entry.sequence > revision)
  assert.equal(added.length, 2)
  const records = added.map(entry => observed.parse(entry.value))
  assert.deepEqual(records.map(record => ({ planId: record.change.observation.planId, mode: record.change.observation.mode,
    phase: record.change.observation.phase })), [
    { planId, mode: 'reconcile', phase: 'armed' }, { planId, mode: 'reconcile', phase: 'outcome-unknown' },
  ])
  records.forEach((record, index) => {
    assert.equal(record.expectedRevision, revision + index)
    assert.equal(record.change.observation.sequence, added[index]!.sequence)
    assert.deepEqual(record.change.observation.pin, before.world!.plans[planId]!.pin)
  })
  assert.deepEqual(after.world.executions, { ...before.world.executions, [planId]: records[1]!.change.observation })
  assert.deepEqual({ ...after, world: { ...after.world, executions: before.world.executions } }, before)
}

/**
 * Verify a new explicit execute attempt records only its original plan's armed/blocked pair.
 * @param before - Business projection before the explicit attempt.
 * @param after - Identical projection after the blocked attempt.
 * @param entries - Newly read Native records.
 * @param revision - Tail before the attempt.
 * @param planId - Original accepted plan.
 * @param reason - Exact capacity refusal.
 * @returns nothing after asserting the complete pair and unchanged business state.
 */
export function assertBlockedExecuteOnly(before: { world: SimulationSnapshot['world'] }, after: { world: SimulationSnapshot['world'] },
  entries: readonly LogEntry[], revision: number, planId: WorldPlanId, reason: string): void {
  assert.ok(before.world); assert.ok(after.world)
  assert.equal(entries.length, 2)
  const records = entries.map(entry => observed.parse(entry.value))
  assert.deepEqual(records.map(record => ({ planId: record.change.observation.planId, mode: record.change.observation.mode,
    phase: record.change.observation.phase, reason: record.change.observation.reason })), [
    { planId, mode: 'execute', phase: 'armed', reason: null }, { planId, mode: 'execute', phase: 'blocked', reason },
  ])
  records.forEach((record, index) => {
    assert.equal(entries[index]!.sequence, revision + index + 1)
    assert.equal(record.expectedRevision, revision + index)
    assert.equal(record.change.observation.sequence, entries[index]!.sequence)
    assert.deepEqual(record.change.observation.pin, before.world!.plans[planId]!.pin)
  })
  assert.deepEqual(after.world.executions, { ...before.world.executions, [planId]: records[1]!.change.observation })
  assert.deepEqual({ ...after, world: { ...after.world, executions: before.world.executions } }, before)
}
