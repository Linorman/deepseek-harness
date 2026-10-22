/** Product-visible history capacity keeps the original fair selection and distinguishes unknown startup cleanup. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@clocky/cordis'
import type { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { AgentRuntimeTerminationUnconfirmedError } from '@clocky/clocky-agent-runtime'
import { simulationProductManageInputSchema, simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { requests } from './world-driver-model.ts'

/**
 * Verify original history refusal, confirmed/unknown provider cleanup and zero new startups after cold recovery.
 * @param ctx - Real Loader services and actual in-process provider.
 * @param client - Authenticated fetch client.
 * @param held - Original product run observer.
 * @param input - Retained paused creation command and frozen limits.
 * @param recovering - Independent process restoring the original checkpoint and suffix.
 * @param scenario - Company/laboratory label in the evidence.
 */
export async function verifyWorldActivationHistory(ctx: Context, client: InProcessApiClient, held: () => SimulationRun | undefined,
  input: SimulationProductWorldCreateInput, recovering: boolean, scenario: string): Promise<void> {
  const mode = process.env.WORLD_OWNER_ACTIVATION
  assert.ok(mode === 'director' || mode === 'newcomer')
  const unknown = process.env.WORLD_ACTIVATION_UNKNOWN === 'true', crash = process.env.WORLD_ACTIVATION_CRASH === 'true'
  const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-activation-history.json')
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
    throw new Error('Activation history command did not settle')
  }
  const provider = ctx.agentRuntimes.getProvider('in-process')
  assert.ok(provider)
  const activate = provider.activate.bind(provider)
  const attach = ctx.simulationTeams.attach.bind(ctx.simulationTeams)
  ctx.simulationTeams.attach = async (...args) => {
    const connection = await attach(...args)
    if (!recovering) {
      const requester = args[0].snapshot().world?.definition.authorizations[0]?.requesterEntityId
      assert.ok(requester)
      for (let round = 0; round < 2; round++) {
        await connection.activate(requester, { provider: 'in-process', seed: { kind: round === 0 ? 'fresh' : 'resume' },
          agent: { preset: 'simulation', options: { provider: 'world-driver-scripted', model: 'scripted' } },
          signal: new AbortController().signal })
        await connection.hibernate(requester)
      }
      assert.equal(requests.length, 0)
    }
    return connection
  }
  let attemptedStarts = 0
  provider.activate = async (request) => {
    const handle = await activate(request), state = held()?.snapshot()
    const entity = Object.values(state?.entities ?? {}).find(value => value.binding?.sessionId === request.sessionId)
    const target = mode === 'director' ? state?.world?.definition.directorEntityId
      : Object.values(state?.world?.reservations ?? {})[0]?.identities.entityId
    if (entity?.id === target) {
      attemptedStarts++
      if (unknown && !recovering) handle.dispose = () => Promise.reject(
        new AgentRuntimeTerminationUnconfirmedError('Original unpublished provider stop is unconfirmed'))
    }
    return handle
  }
  try {
    if (recovering) {
      const proof = JSON.parse(await readFile(proofPath, 'utf8')) as {
        runId: string
        checkpointId: string
        block: unknown
        world: unknown
        selection: unknown }
      assert.equal(proof.runId, runId)
      const restore = await client.simulations.restore(simulationProductRestoreInputSchema.parse({ runId,
        commandId: 'restore-history-limit', checkpointId: proof.checkpointId }))
      assert.ok(restore.result.ok)
      assert.equal((await waitCommand('restore-history-limit')).status, 'completed')
      const run = held()
      assert.ok(run)
      assert.deepEqual(run.snapshot().activationAdmissionBlocks?.[0], proof.block)
      assert.deepEqual(run.snapshot().world, proof.world)
      assert.deepEqual(run.snapshot().decisionDispatch, proof.selection)
      const block = run.snapshot().activationAdmissionBlocks?.[0]
      assert.ok(block)
      assert.equal(run.snapshot().entities[block.entityId]?.writer?.phase, 'released')
      const control = await client.simulations.control({ runId })
      assert.ok(control.result.ok)
      assert.equal(control.result.value.phase, 'paused')
      assert.equal(control.result.value.stop, 'activation-history-limit')
      assert.equal(control.result.value.actions.start.allowed, false)
      assert.equal(control.result.value.actions.start.reason, 'scenario-blocked')
      const revision = run.snapshot().revision
      const start = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
        managementId: 'cannot-resume-frozen-history', phase: 'running' }))
      assert.equal(start.result.ok, false)
      await assert.rejects(run.setPhase('running', revision), /new scenario/)
      await client.simulations.inspect({ runId })
      await client.simulations.exportWorldDefinition({ runId })
      assert.equal(run.snapshot().revision, revision)
      assert.equal(requests.length, 0)
      assert.equal(attemptedStarts, 0)
    } else {
      const run = held()
      assert.ok(run)
      const record = run.recordActivationAdmissionBlock.bind(run)
      run.recordActivationAdmissionBlock = async (...args) => {
        const block = await record(...args)
        if (crash) {
          const state = run.snapshot()
          assert.ok(state.latestCheckpointId)
          assert.equal(block.details.cleanup, unknown ? 'unconfirmed' : 'confirmed')
          assert.equal(state.entities[block.entityId]?.writer?.phase, unknown ? 'revoked' : 'released')
          if (unknown) assert.ok(run.population().chargedActors > 0)
          assert.equal(attemptedStarts, 1)
          await writeFile(proofPath, JSON.stringify({ runId, checkpointId: state.latestCheckpointId,
            block, world: state.world, selection: state.decisionDispatch }))
          process.send?.('activation-refusal-durable')
          await new Promise<undefined>((resolve) => { process.once('message', () => { resolve(undefined) }) })
        }
        return block
      }
      const start = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
        managementId: 'start-history-limit', phase: 'running' }))
      assert.ok(start.result.ok)
      let reached = false
      for (let attempt = 0; attempt < 2000; attempt++) {
        const control = await client.simulations.control({ runId })
        assert.ok(control.result.ok)
        assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result.value))
        if (control.result.value.stop === (unknown ? 'recovery-required' : 'activation-history-limit')
          && !control.result.value.inFlight) {
          assert.equal(control.result.value.actions.start.allowed, false)
          assert.equal(control.result.value.actions.start.reason, unknown ? 'recovery-required' : 'scenario-blocked')
          reached = true; break
        }
        await new Promise(done => setTimeout(done, 5))
      }
      assert.equal(reached, true)
      const state = run.snapshot(), block = state.activationAdmissionBlocks?.[0]
      assert.ok(block)
      assert.equal(attemptedStarts, 1)
      assert.equal(requests.length, mode === 'director' ? 3 : 6)
      if (unknown) {
        assert.equal(state.entities[block.entityId]?.writer?.phase, 'revoked')
        assert.ok(run.population().chargedActors > 0)
        assert.ok(state.latestCheckpointId)
        const revision = state.revision
        await client.simulations.control({ runId })
        assert.equal(run.snapshot().revision, revision)
        assert.equal(attemptedStarts, 1)
        await writeFile(proofPath, JSON.stringify({ runId, checkpointId: state.latestCheckpointId,
          block, world: state.world, selection: state.decisionDispatch }))
        process.send?.('activation-refusal-durable')
        await new Promise<undefined>((resolve) => { process.once('message', () => { resolve(undefined) }) })
      }
      assert.equal(state.entities[block.entityId]?.writer?.phase, 'released')
      const ticket = Object.values(state.decisionDispatch?.tickets ?? {}).find(value =>
        value.candidate.entityId === block.entityId && value.status === 'reserved')
      assert.equal(state.activeWindowId, undefined)
      if (mode === 'newcomer') {
        assert.ok(ticket)
        assert.ok(ticket.candidate.wakeId)
        assert.equal(state.wakes[ticket.candidate.wakeId]?.status, 'pending')
      } else {
        // Recipient placement can hit the limit before delivery creates the director wake/ticket.
        const request = Object.values(state.world?.requests ?? {})[0]
        assert.ok(request)
        assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
        const notification = state.operations[request.notificationOperationId]
        assert.equal(notification?.action.kind, 'communication/post')
        assert.ok(notification?.outbox?.receipt)
        assert.equal(notification?.delivery, undefined)
        assert.equal(notification?.result?.status, 'applied')
      }
      for (let read = 0; read < 3; read++) await client.simulations.control({ runId })
      assert.equal(run.snapshot().revision, state.revision)
      assert.equal(attemptedStarts, 1)
      const checkpoint = await client.simulations.checkpoint(simulationProductCheckpointInputSchema.parse({ runId,
        commandId: 'checkpoint-history-limit' }))
      assert.ok(checkpoint.result.ok)
      const receipt = await waitCommand('checkpoint-history-limit')
      assert.equal(receipt.status, 'completed')
      assert.ok(receipt.checkpointId)
      await writeFile(proofPath, JSON.stringify({ runId, checkpointId: receipt.checkpointId, block,
        world: run.snapshot().world, selection: run.snapshot().decisionDispatch }))
    }
    console.log(JSON.stringify({ scenario, mode, unknown, historyLimit: true, originalSelection: true,
      coldRecovery: recovering, modelCalls: requests.length, attemptedStarts }))
  } finally { provider.activate = activate; ctx.simulationTeams.attach = attach }
}
