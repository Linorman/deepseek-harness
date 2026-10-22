import { hiringIntentFields } from './world-domain-input.ts'
/** Real World actor publication retains bounded unknown responsibility and the original target Envelope through cold retry. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { Context } from '@clocky/cordis'
import type { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductManageInputSchema, simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product/types'
import { simulationWakeRequestSchema, simulationOutboxRetryRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationOperation } from '@clocky/clocky-simulation'
import { requests } from './world-driver-model.ts'

/**
 * Exhaust the actual original actor message budget after target commit, then grant the same intent once in a cold process.
 * @param ctx - Real Loader Team and Session owners.
 * @param client - Authenticated product API.
 * @param held - Original Native observer.
 * @param input - Original frozen creation command.
 * @param recovering - Independent process restoring the original checkpoint.
 * @param scenario - Company/laboratory evidence label.
 */
export async function verifyWorldOutboxRetry(ctx: Context, client: InProcessApiClient, held: () => SimulationRun | undefined,
  input: SimulationProductWorldCreateInput, recovering: boolean, scenario: string): Promise<void> {
  const mode = z.enum(['director', 'newcomer']).parse(process.env.WORLD_OUTBOX_RETRY)
  const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-outbox-retry.json')
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
    throw new Error('Original outbox command did not settle')
  }
  const waitStop = async (stop: string) => {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const control = await client.simulations.control({ runId })
      assert.ok(control.result.ok)
      assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result.value))
      if (control.result.value.stop === stop && !control.result.value.inFlight) return control.result.value
      await new Promise(done => setTimeout(done, 5))
    }
    throw new Error(`Original outbox did not stop with ${stop}`)
  }
  if (recovering) {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as {
      checkpointId: string
      operation: SimulationOperation
      world: unknown
      envelopeId: string }
    const restored = await client.simulations.restore(simulationProductRestoreInputSchema.parse({ runId,
      commandId: 'restore-original-outbox', checkpointId: proof.checkpointId }))
    assert.ok(restored.result.ok)
    assert.equal((await waitCommand('restore-original-outbox')).status, 'completed')
    const run = held()
    assert.ok(run)
    assert.deepEqual(run.snapshot().operations[proof.operation.id], proof.operation)
    assert.deepEqual(run.snapshot().world, proof.world)
    const control = await client.simulations.control({ runId })
    assert.ok(control.result.ok)
    assert.equal(control.result.value.phase, 'paused')
    assert.equal(control.result.value.stop, 'outcome-unknown')
    assert.equal(control.result.value.actions.start.allowed, false)
    const before = run.snapshot()
    for (let read = 0; read < 3; read++) await client.simulations.control({ runId })
    assert.deepEqual(run.snapshot(), before)
    assert.equal(requests.length, 0)
    const blocked = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
      managementId: 'no-implicit-retry', phase: 'running' }))
    assert.equal(blocked.result.ok, false)
    const request = simulationOutboxRetryRequestSchema.parse({ id: 'original-explicit-grant', operationId: proof.operation.id,
      expectedAttemptCount: proof.operation.outbox!.attempts.length, reason: 'Reconcile original target commit', authorizedAt: 1000 })
    const grant = await run.retryOutbox(request)
    assert.equal(run.snapshot().phase, 'paused')
    assert.equal(requests.length, 0)
    const granted = run.snapshot()
    assert.deepEqual(await run.retryOutbox(request), grant)
    assert.deepEqual(run.snapshot(), granted)
    const continued = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
      managementId: 'explicit-original-key-retry', phase: 'running' }))
    assert.ok(continued.result.ok)
    await waitStop('idle')
    const operation = run.snapshot().operations[proof.operation.id]!
    assert.equal(operation.status, 'applied')
    assert.equal(operation.outbox!.attempts.length, proof.operation.outbox!.attempts.length + 1)
    assert.equal(operation.outbox!.receipt?.envelopeId, proof.envelopeId)
    assert.equal(operation.fingerprint, proof.operation.fingerprint)
    assert.deepEqual(operation.action, proof.operation.action)
    assert.deepEqual(await run.retryOutbox(request), grant)
    assert.ok(operation.action.kind === 'communication/post')
    const records = await ctx.teams.readChannel({ channelId: operation.action.channelId, afterCursor: -1 })
    assert.equal(records.records.filter(record => record.type === 'channel/envelope'
      && record.envelope.traceId === operation.fingerprint).length, 1)
  } else {
    const run = held()
    assert.ok(run)
    const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
    let envelopeId: string | undefined
    const attemptedKeys: string[] = []
    ctx.teams.postChannelEnvelope = async (request) => {
      const state = run.snapshot(), target = mode === 'director' ? state.world!.definition.directorEntityId
        : Object.values(state.world!.reservations)[0]?.identities.entityId
      const operation = Object.values(state.operations).find(value => value.entityId === target
        && value.fingerprint === request.draft.traceId && value.action.kind === 'communication/post'
        && (mode === 'newcomer' || value.action.text === 'Original bounded retry message'))
      const envelope = await post(request)
      if (operation !== undefined) {
        assert.ok(request.idempotencyKey)
        attemptedKeys.push(request.idempotencyKey)
        if (envelopeId === undefined) envelopeId = envelope.id
        assert.equal(envelope.id, envelopeId)
        throw new Error('Actual target append succeeded; original response is lost')
      }
      return envelope
    }
    try {
      const start = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
        managementId: 'start-bounded-outbox', phase: 'running' }))
      assert.ok(start.result.ok)
      if (mode === 'director') {
        await waitStop('idle')
        assert.equal(requests.length, 18)
        const paused = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
          managementId: 'pause-before-original-post', phase: 'paused' }))
        assert.ok(paused.result.ok)
        const state = run.snapshot(), director = state.world!.definition.directorEntityId
        const requester = hiringIntentFields(Object.values(state.world!.intents)[0]).requesterEntityId
        const channel = Object.values(state.channelReservations ?? {}).find(value => value.confirmed
          && value.spec.members.some(member => member.entityId === director)
          && value.spec.members.some(member => member.entityId === requester))
        assert.ok(channel)
        await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'original-director-post', entityId: director, time: state.time,
          reason: JSON.stringify({ kind: 'envelope-byte-probe', recipient: requester, channelId: channel.channelId, deliverAt: state.time }) }), state.revision)
        const continued = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
          managementId: 'explicit-original-director-post', phase: 'running' }))
        assert.ok(continued.result.ok)
      }
      const control = await waitStop('outcome-unknown')
      assert.equal(control.actions.start.allowed, false)
      const state = run.snapshot(), operation = Object.values(state.operations).find(value => value.status === 'outcome-unknown')
      assert.ok(operation?.outbox)
      assert.equal(operation.outbox.attempts.length, state.spec.outboxMaxAttempts)
      assert.equal(attemptedKeys.length, state.spec.outboxMaxAttempts)
      assert.equal(new Set(attemptedKeys).size, 1)
      assert.equal(operation.outbox.receipt, undefined)
      assert.ok(envelopeId)
      assert.ok(operation.action.kind === 'communication/post')
      const records = await ctx.teams.readChannel({ channelId: operation.action.channelId, afterCursor: -1 })
      assert.equal(records.records.filter(record => record.type === 'channel/envelope'
        && record.envelope.traceId === operation.fingerprint).length, 1)
      const calls = requests.length
      assert.equal(calls, mode === 'director' ? 21 : 12)
      for (let read = 0; read < 3; read++) await client.simulations.control({ runId })
      assert.equal(run.snapshot().revision, state.revision)
      assert.equal(requests.length, calls)
      const checkpoint = await client.simulations.checkpoint(simulationProductCheckpointInputSchema.parse({ runId,
        commandId: 'checkpoint-original-outbox' }))
      assert.ok(checkpoint.result.ok)
      const receipt = await waitCommand('checkpoint-original-outbox')
      assert.equal(receipt.status, 'completed')
      assert.ok(receipt.checkpointId)
      await writeFile(proofPath, JSON.stringify({ checkpointId: receipt.checkpointId,
        operation: run.snapshot().operations[operation.id], world: run.snapshot().world, envelopeId }))
    } finally { ctx.teams.postChannelEnvelope = post }
  }
  console.log(JSON.stringify({ scenario, mode, originalEnvelope: true, boundedAttempts: true, coldRecovery: recovering }))
}
