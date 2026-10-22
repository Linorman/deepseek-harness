/** The authenticated product owner resumes a stale case with a new explicit scheduling intent. */
import assert from 'node:assert/strict'
import type { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductManageInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product/types'
import { simulationChangeSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { requests } from './world-driver-model.ts'

/**
 * Change one critical read before reservation, then continue the same case through the actual product scheduler.
 * @param client - Authenticated product RPC carrier.
 * @param run - Product-held Native run, already prepared without inference.
 * @param input - Original accepted product creation command.
 * @param scenario - Portable definition label used in the output.
 */
export async function verifyWorldOwnerReplanning(client: InProcessApiClient, run: SimulationRun,
  input: SimulationProductWorldCreateInput, scenario: string): Promise<void> {
  const original = await client.simulations.createWorld(input)
  assert.ok(original.result.ok)
  const runId = original.result.value.runId
  const reserve = run.reserveWorldHire.bind(run)
  let changed = false
  run.reserveWorldHire = async (request) => {
    if (!changed) {
      changed = true
      const grant = Object.values(run.snapshot().relations).find(value => value.relation === 'can-hire')!
      const { revision, ...fields } = grant
      await run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...fields,
        relationRevision: revision, validUntil: '100' }), run.snapshot().revision)
    }
    return await reserve(request)
  }
  const wait = async (stop: 'plan-stale' | 'idle') => {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const control = await client.simulations.control({ runId })
      assert.ok(control.result.ok)
      assert.notEqual(control.result.value.driver, 'failed')
      if (control.result.value.stop === stop && !control.result.value.inFlight) return control.result.value
      await new Promise(done => setTimeout(done, 5))
    }
    throw new Error(`World replanning did not reach ${stop}`)
  }
  const start = simulationProductManageInputSchema.parse({ runId, managementId: 'original-start', phase: 'running' })
  assert.ok((await client.simulations.manage(start)).result.ok)
  assert.deepEqual((await wait('plan-stale')).actions.start, { allowed: true, reason: 'ready' })
  const before = run.snapshot(), first = Object.values(before.world!.plans)[0]!, calls = requests.length
  assert.equal(first.status, 'stale')
  assert.deepEqual(before.world!.reservations, {})
  assert.deepEqual(before.maintenance ?? {}, {})
  assert.ok((await client.simulations.manage(start)).result.ok)
  assert.deepEqual(run.snapshot(), before)
  assert.equal(requests.length, calls)
  assert.ok((await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
    managementId: 'pause-stale-case', phase: 'paused' }))).result.ok)
  assert.ok((await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
    managementId: 'continue-stale-case', phase: 'running' }))).result.ok)
  await wait('idle')
  const world = run.snapshot().world!, plans = Object.values(world.plans), results = Object.values(world.results)
  assert.equal(plans.length, 2)
  assert.deepEqual(plans[0], first)
  assert.equal(plans[1]!.proposal.supersedes, first.id)
  assert.equal(plans[1]!.requestId, first.requestId)
  assert.equal(Object.values(world.requests).length, 1)
  assert.equal(results.length, 1)
  assert.equal(results[0]!.outcome.kind, 'committed')
  assert.equal(Object.values(world.reservations).length, 1)
  console.log(JSON.stringify({ scenario, productOwner: true, explicitContinue: true, originalRetryInert: true,
    cases: 1, plans: 2, hires: 1, modelCalls: requests.length }))
}
