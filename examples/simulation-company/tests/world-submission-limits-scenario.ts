/** Rejected world tool inputs retain a bounded Native reason and their original Session evidence through cold recovery. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { Context } from '@clocky/cordis'
import type { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductManageInputSchema, simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { requests } from './world-driver-model.ts'

/**
 * Prove a real rejected tool submission cannot turn into driver-failed, accepted effects or repeated inference.
 * @param ctx - Actual Loader Session and runtime owners.
 * @param client - Authenticated product fetch client.
 * @param held - Original Native run observer.
 * @param input - Frozen paused creation command.
 * @param recovering - New process restoring original history.
 * @param scenario - Company/laboratory label in evidence.
 */
export async function verifyWorldSubmissionLimits(ctx: Context, client: InProcessApiClient, held: () => SimulationRun | undefined,
  input: SimulationProductWorldCreateInput, recovering: boolean, scenario: string): Promise<void> {
  const mode = z.enum(['request-bytes', 'plan-bytes', 'authority']).parse(process.env.WORLD_SUBMISSION_LIMIT)
  const stop = mode === 'authority' ? 'authority-missing' : 'world-byte-limit', crash = process.env.WORLD_SUBMISSION_CRASH === 'true'
  const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-submission-limit.json')
  const created = await client.simulations.createWorld(input)
  assert.ok(created.result.ok)
  const runId = created.result.value.runId
  const waitCommand = async (commandId: string) => {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const result = await client.simulations.request({ commandId: commandId as import('@clocky/clocky-simulation-product/types').SimulationProductCommandId })
      assert.ok(result.result.ok && result.result.value.status === 'found')
      if (result.result.value.request.status !== 'accepted') return result.result.value.request
      await new Promise(done => setTimeout(done, 5))
    }
    throw new Error('Original submission-limit command did not settle')
  }
  if (recovering) {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as {
      runId: string
      checkpointId: string
      decision: unknown
      world: unknown
      tokens: unknown }
    assert.equal(runId, proof.runId)
    const restore = await client.simulations.restore(simulationProductRestoreInputSchema.parse({ runId,
      commandId: 'restore-original-submission', checkpointId: proof.checkpointId }))
    assert.ok(restore.result.ok)
    assert.equal((await waitCommand('restore-original-submission')).status, 'completed')
    const run = held()
    assert.ok(run)
    const rejected = Object.values(run.snapshot().decisions).find(value => value.worldSubmissionBlock !== undefined)
    assert.deepEqual(rejected, proof.decision)
    assert.deepEqual(run.snapshot().world, proof.world)
    assert.deepEqual(run.snapshot().tokenReservations, proof.tokens)
    const control = await client.simulations.control({ runId })
    assert.ok(control.result.ok)
    assert.equal(control.result.value.phase, 'paused')
    assert.equal(control.result.value.stop, stop)
    assert.equal(control.result.value.actions.start.allowed, false)
    assert.equal(control.result.value.actions.start.reason, 'scenario-blocked')
    const revision = run.snapshot().revision
    const start = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
      managementId: 'cannot-bypass-frozen-submission', phase: 'running' }))
    assert.equal(start.result.ok, false)
    await assert.rejects(run.setPhase('running', revision), /rejected world submission/)
    await client.simulations.inspect({ runId })
    await client.simulations.exportWorldDefinition({ runId })
    assert.equal(run.snapshot().revision, revision)
    assert.equal(requests.length, 0)
  } else {
    const run = held()
    assert.ok(run)
    if (crash) {
      const reserve = run.reserveWriter.bind(run)
      run.reserveWriter = async (...args) => {
        const writer = await reserve(...args), submit = writer.submitDecision.bind(writer)
        writer.submitDecision = async (...input) => {
          try { return await submit(...input) }
          catch (error) {
            const state = run.snapshot(), rejected = state.decisions[input[0]]
            if (rejected?.worldSubmissionBlock === undefined) throw error
            assert.ok(state.latestCheckpointId)
            await writeFile(proofPath, JSON.stringify({ runId, checkpointId: state.latestCheckpointId,
              decision: rejected, world: state.world, tokens: state.tokenReservations }))
            process.send?.('world-submission-durable')
            await new Promise<undefined>((resolve) => { process.once('message', () => { resolve(undefined) }) })
            throw error
          }
        }
        return writer
      }
    }
    const start = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
      managementId: 'start-submission-limit', phase: 'running' }))
    assert.ok(start.result.ok)
    let stopped = false
    for (let attempt = 0; attempt < 2000; attempt++) {
      const control = await client.simulations.control({ runId })
      assert.ok(control.result.ok)
      assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result.value))
      if (control.result.value.stop === stop && !control.result.value.inFlight) { stopped = true; break }
      await new Promise(done => setTimeout(done, 5))
    }
    assert.equal(stopped, true)
    const state = run.snapshot(), rejected = Object.values(state.decisions).find(value => value.worldSubmissionBlock !== undefined)
    assert.ok(rejected)
    assert.equal(rejected.status, 'cancelled')
    assert.deepEqual(rejected.operationIds, [])
    assert.equal(state.activeWindowId, undefined)
    assert.ok(rejected.wakeId)
    assert.equal(state.wakes[rejected.wakeId]?.status, 'pending')
    assert.equal(Object.keys(state.world!.plans).length, 0)
    assert.equal(requests.length, mode === 'request-bytes' ? 3 : 6)
    const calls = requests.length
    for (let read = 0; read < 3; read++) await client.simulations.control({ runId })
    assert.equal(run.snapshot().revision, state.revision)
    assert.equal(requests.length, calls)
    const binding = state.entities[rejected.entityId]?.binding
    assert.ok(binding)
    const read = ctx.sessionPersistence.readFrom.bind(ctx.sessionPersistence)
    const previous = state.latestCheckpointId
    let changed = false
    ctx.sessionPersistence.readFrom = async (...args) => {
      const stored = await read(...args)
      if (args[0] !== binding.sessionId) return stored
      return { ...stored, events: stored.events.map((event) => {
        if (event.type !== 'tool/call' || event.data.name !== 'simulation_stage') return event
        changed = true
        return { ...event, data: { ...event.data, arguments: '{}' } }
      }) }
    }
    try {
      const checkpoint = await client.simulations.checkpoint(simulationProductCheckpointInputSchema.parse({ runId,
        commandId: 'checkpoint-altered-rejected-body' }))
      assert.ok(checkpoint.result.ok)
      assert.equal((await waitCommand('checkpoint-altered-rejected-body')).status, 'failed')
      assert.equal(changed, true)
      assert.equal(run.snapshot().latestCheckpointId, previous)
      assert.equal(requests.length, calls)
    } finally { ctx.sessionPersistence.readFrom = read }
    const checkpoint = await client.simulations.checkpoint(simulationProductCheckpointInputSchema.parse({ runId,
      commandId: 'checkpoint-original-submission' }))
    assert.ok(checkpoint.result.ok)
    const receipt = await waitCommand('checkpoint-original-submission')
    assert.equal(receipt.status, 'completed')
    assert.ok(receipt.checkpointId)
    await writeFile(proofPath, JSON.stringify({ runId, checkpointId: receipt.checkpointId,
      decision: rejected, world: run.snapshot().world, tokens: run.snapshot().tokenReservations }))
  }
  console.log(JSON.stringify({ scenario, mode, stop, pausedRecovery: recovering,
    rejectedOnce: true, stableReads: true, modelCalls: requests.length }))
}
