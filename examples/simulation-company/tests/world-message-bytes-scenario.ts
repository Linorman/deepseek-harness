import { hiringIntentFields } from './world-domain-input.ts'
/** Definite pre-append Envelope byte rejection remains terminal and model-free across cold recovery. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductManageInputSchema, simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product/types'
import { simulationWakeRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { requests } from './world-driver-model.ts'

/**
 * Publish through the actual Team Hub limit and preserve one terminal Native rejection without a target Envelope.
 * @param client - Authenticated actual product carrier.
 * @param held - Original native run observer.
 * @param input - Frozen scenario/Team limit creation command.
 * @param recovering - Independent explicit cold restore.
 * @param scenario - Company/laboratory evidence label.
 */
export async function verifyWorldMessageBytes(client: InProcessApiClient, held: () => SimulationRun | undefined,
  input: SimulationProductWorldCreateInput, recovering: boolean, scenario: string): Promise<void> {
  const mode = z.enum(['director', 'newcomer']).parse(process.env.WORLD_MESSAGE_BYTES)
  const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-message-bytes.json')
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
    throw new Error('Envelope byte command did not settle')
  }
  const waitStop = async (stop: string) => {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const control = await client.simulations.control({ runId })
      assert.ok(control.result.ok)
      assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result.value))
      if (control.result.value.stop === stop && !control.result.value.inFlight) return control.result.value
      await new Promise(done => setTimeout(done, 5))
    }
    const run = held()
    throw new Error(`Envelope byte run did not stop with ${stop}: ${JSON.stringify({
      modelCalls: requests, wakes: run?.snapshot().wakes, operations: Object.values(run?.snapshot().operations ?? {})
        .map(value => ({ kind: value.action.kind, status: value.status, code: value.result?.code })) })}`)
  }
  if (recovering) {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as {
      runId: string
      checkpointId: string
      operation: unknown
      world: unknown }
    assert.equal(proof.runId, runId)
    const restored = await client.simulations.restore(simulationProductRestoreInputSchema.parse({ runId,
      commandId: 'restore-envelope-bytes', checkpointId: proof.checkpointId }))
    assert.ok(restored.result.ok)
    assert.equal((await waitCommand('restore-envelope-bytes')).status, 'completed')
    const run = held()
    assert.ok(run)
    assert.deepEqual(Object.values(run.snapshot().operations).find(value => value.result?.code === 'SIM_ENVELOPE_BYTE_LIMIT'), proof.operation)
    assert.deepEqual(run.snapshot().world, proof.world)
    const control = await client.simulations.control({ runId })
    assert.ok(control.result.ok)
    assert.equal(control.result.value.phase, 'paused')
    assert.equal(control.result.value.stop, 'message-byte-limit')
    assert.equal(control.result.value.actions.start.allowed, false)
    const revision = run.snapshot().revision
    const start = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
      managementId: 'cannot-retry-byte-rejection', phase: 'running' }))
    assert.equal(start.result.ok, false)
    await client.simulations.inspect({ runId })
    await client.simulations.exportWorldDefinition({ runId })
    assert.equal(run.snapshot().revision, revision)
    assert.equal(requests.length, 0)
  } else {
    const start = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
      managementId: 'start-envelope-bytes', phase: 'running' }))
    assert.ok(start.result.ok)
    const run = held()
    assert.ok(run)
    if (mode === 'director') {
      await waitStop('idle')
      assert.equal(requests.length, 18)
      await client.simulations.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'pause-before-message', phase: 'paused' }))
      const state = run.snapshot(), director = state.world!.definition.directorEntityId
      const intent = Object.values(state.world!.intents)[0]!, requester = hiringIntentFields(intent).requesterEntityId
      const channel = Object.values(state.channelReservations ?? {}).find(value => value.confirmed
        && value.spec.members.some(member => member.entityId === director)
        && value.spec.members.some(member => member.entityId === requester))
      assert.ok(channel?.channelId)
      await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'director-large-message', entityId: director, time: state.time,
        reason: JSON.stringify({ kind: 'envelope-byte-probe', recipient: requester, channelId: channel.channelId, deliverAt: state.time }) }), state.revision)
      const continued = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
        managementId: 'explicit-director-message', phase: 'running' }))
      assert.ok(continued.result.ok)
    }
    const control = await waitStop('message-byte-limit')
    assert.equal(control.actions.start.allowed, false)
    const state = run.snapshot(), rejected = Object.values(state.operations).find(value => value.result?.code === 'SIM_ENVELOPE_BYTE_LIMIT')
    assert.ok(rejected)
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.outbox?.receipt, undefined)
    assert.equal(rejected.outbox?.attempts.length, 1)
    assert.equal(state.phase, 'running')
    assert.equal(Object.values(state.operations).some(value => value.status === 'outcome-unknown'), false)
    assert.equal(Object.values(state.world!.results).filter(value => value.outcome.kind === 'committed').length, 1)
    assert.equal(requests.length, mode === 'director' ? 21 : 12)
    const calls = requests.length
    for (let read = 0; read < 3; read++) await client.simulations.control({ runId })
    assert.equal(run.snapshot().revision, state.revision)
    assert.equal(requests.length, calls)
    const checkpoint = await client.simulations.checkpoint(simulationProductCheckpointInputSchema.parse({ runId,
      commandId: 'checkpoint-envelope-bytes' }))
    assert.ok(checkpoint.result.ok)
    const receipt = await waitCommand('checkpoint-envelope-bytes')
    assert.equal(receipt.status, 'completed')
    assert.ok(receipt.checkpointId)
    await writeFile(proofPath, JSON.stringify({ runId, checkpointId: receipt.checkpointId,
      operation: rejected, world: run.snapshot().world }))
  }
  console.log(JSON.stringify({ scenario, mode, stop: 'message-byte-limit', originalRejection: true,
    coldRecovery: recovering, modelCalls: requests.length }))
}
