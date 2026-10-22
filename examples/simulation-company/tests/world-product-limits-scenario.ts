/** Authenticated World control preserves real quota stops and their cold-recovery admission hints. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductManageInputSchema, simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { requests } from './world-driver-model.ts'

const modeSchema = z.enum(['entities', 'director-tokens', 'newcomer-tokens', 'context', 'microstep'])
const stops = { entities: 'entity-capacity', 'director-tokens': 'budget-limit', 'newcomer-tokens': 'budget-limit',
  context: 'context-limit', microstep: 'microstep-limit' } as const

/**
 * Inspect, explicitly start/pause and cold-restore the original product run without creating another scheduling owner.
 * @param client - Authenticated actual fetch carrier.
 * @param held - Observed original run handle opened by the real administrative owner.
 * @param input - Original accepted creation input.
 * @param recovering - Whether this process is reusing the original persisted run.
 * @param scenario - Definition label in the evidence output.
 */
export async function verifyProductWorldLimits(client: InProcessApiClient, held: () => SimulationRun | undefined,
  input: SimulationProductWorldCreateInput, recovering: boolean, scenario: string): Promise<void> {
  const mode = modeSchema.parse(process.env.WORLD_DRIVER_LIMIT), proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-product-limit.json')
  const original = z.strictObject({ runId: z.string(), checkpointId: z.string(), world: z.json(), stall: z.json() })
  const created = await client.simulations.createWorld(input)
  assert.ok(created.result.ok)
  const runId = created.result.value.runId
  const waitCommand = async (commandId: string) => {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const query = await client.simulations.request({ commandId: commandId as import('@clocky/clocky-simulation-product/types').SimulationProductCommandId })
      assert.ok(query.result.ok && query.result.value.status === 'found')
      if (query.result.value.request.status !== 'accepted') return query.result.value.request
      await new Promise(done => setTimeout(done, 5))
    }
    throw new Error('Original quota command did not settle')
  }
  if (recovering) {
    const proof = original.parse(JSON.parse(await readFile(proofPath, 'utf8')))
    assert.equal(runId, proof.runId)
    const restored = await client.simulations.restore(simulationProductRestoreInputSchema.parse({ runId,
      commandId: 'restore-original-quota-run', checkpointId: proof.checkpointId }))
    assert.ok(restored.result.ok)
    assert.equal((await waitCommand('restore-original-quota-run')).status, 'completed')
    const run = held()
    assert.ok(run)
    assert.deepEqual(run.snapshot().world, proof.world)
    assert.deepEqual(run.snapshot().stall ?? null, proof.stall)
    const control = await client.simulations.control({ runId })
    assert.ok(control.result.ok)
    assert.equal(control.result.value.phase, 'paused')
    assert.notEqual(control.result.value.driver, 'failed')
    if (mode === 'director-tokens' || mode === 'newcomer-tokens') {
      assert.equal(control.result.value.stop, 'budget-limit')
      assert.equal(control.result.value.actions.start.allowed, false)
      const continued = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
        managementId: 'cannot-bypass-original-budget', phase: 'running' }))
      assert.equal(continued.result.ok, false)
    }
    assert.equal(requests.length, 0)
  } else {
    assert.equal(requests.length, 0)
    const started = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
      managementId: 'start-original-quota-run', phase: 'running' }))
    assert.ok(started.result.ok)
    let stopped = false
    for (let attempt = 0; attempt < 2000; attempt++) {
      const control = await client.simulations.control({ runId })
      assert.ok(control.result.ok)
      assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result.value))
      if (control.result.value.stop === stops[mode] && !control.result.value.inFlight) { stopped = true; break }
      await new Promise(done => setTimeout(done, 5))
    }
    assert.equal(stopped, true)
    const run = held()
    assert.ok(run)
    const calls = requests.length, revision = run.snapshot().revision
    for (let read = 0; read < 3; read++) {
      await client.simulations.control({ runId })
      await client.simulations.inspect({ runId })
      await client.simulations.exportWorldDefinition({ runId })
    }
    assert.equal(requests.length, calls)
    assert.equal(run.snapshot().revision, revision)
    const pause = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
      managementId: 'pause-original-quota-run', phase: 'paused' }))
    assert.ok(pause.result.ok)
    const checkpoint = await client.simulations.checkpoint(simulationProductCheckpointInputSchema.parse({ runId, commandId: 'checkpoint-original-quota' }))
    assert.ok(checkpoint.result.ok)
    const receipt = await waitCommand('checkpoint-original-quota')
    assert.equal(receipt.status, 'completed')
    assert.ok(receipt.checkpointId)
    await writeFile(proofPath, JSON.stringify(original.parse({ runId, checkpointId: receipt.checkpointId,
      world: run.snapshot().world, stall: run.snapshot().stall ?? null })))
  }
  console.log(JSON.stringify({ scenario, mode, stop: stops[mode], productOwner: true, driverFailed: false,
    pausedRecovery: recovering, stableReads: true, modelCalls: requests.length }))
}
