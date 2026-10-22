/** Real authenticated control rechecks pool availability only for an explicit new management intent. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@clocky/cordis'
import { CompactionId, recordCompactionRequest } from '@clocky/clocky-compaction'
import { createUserMessage } from '@clocky/clocky-llm'
import type { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductManageInputSchema, simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { compileWorldScenario } from '@clocky/clocky-simulation-scenario'
import type { ScenarioCatalog } from '@clocky/clocky-simulation-scenario'
import { occupyWorldModelPool } from './world-model-pool-scenario.ts'
import { requests } from './world-driver-model.ts'
import { installWorldReplayProbe } from './world-replay-probe.ts'

/**
 * Prove real pool refusal, zero automatic retry on release/read and one explicit continuation after cold product restore.
 * @param ctx - Actual Loader services sharing the model pool.
 * @param client - Authenticated fetch client.
 * @param held - Original product run observer.
 * @param input - Original accepted command payload.
 * @param installed - Original test-only model catalog.
 * @param recovering - Independent process restoring the checkpoint.
 * @param scenario - Company or laboratory label for evidence.
 */
export async function verifyProductWorldModelPool(ctx: Context, client: InProcessApiClient, held: () => SimulationRun | undefined,
  input: SimulationProductWorldCreateInput, installed: ScenarioCatalog, recovering: boolean, scenario: string): Promise<void> {
  const mode = process.env.WORLD_OWNER_POOL
  const auxiliary = process.env.WORLD_OWNER_POOL_AUX === 'true'
  const replayProbe = recovering && process.env.WORLD_REPLAY_PROBE === 'true' ? installWorldReplayProbe(ctx) : undefined
  assert.ok(mode === 'director' || mode === 'newcomer')
  const compiled = await compileWorldScenario(input.definition, installed)
  assert.ok(compiled.ok)
  let finish: (() => Promise<void>) | undefined
  const attach = ctx.simulationTeams.attach.bind(ctx.simulationTeams)
  ctx.simulationTeams.attach = async (...args) => {
    const connection = await attach(...args), run = args[0]
    if (!recovering && run.snapshot().spec.runId !== 'world-pool-holder') {
      const execute = connection.executeDecision.bind(connection)
      connection.executeDecision = async (...input) => {
        const context = run.snapshot().decisions[input[1]]?.context
        if (finish === undefined && context?.status === 'prepared'
          && context.world?.kind === (mode === 'director' ? 'resolve' : 'first-action')) {
          finish = await occupyWorldModelPool(ctx, compiled.resolved)
          if (auxiliary) {
            const binding = run.snapshot().entities[input[0]]?.binding
            assert.ok(binding)
            const actor = ctx.agents.get(binding.sessionId)
            assert.ok(actor)
            await actor.runMaintenance(async (signal) => {
              const compactionId = CompactionId(`world-pool/${mode}`)
              actor.session.append('compaction/start', { compactionId, turn: null })
              const options = recordCompactionRequest(actor.session, { sessionId: actor.session.id, purpose: 'compaction',
                provider: 'world-driver-scripted', model: 'scripted', signal, messages: actor.session.deriveMessages() })
              let refused = false
              for await (const chunk of ctx.llm.stream(options)) {
                if (chunk.type === 'finish' && chunk.reason.kind === 'error') refused = true
              }
              assert.equal(refused, true)
              actor.session.append('compaction/end', { compactionId, turn: null, error: 'Model pool refused the auxiliary request' })
              assert.equal(await ctx.sessions.flush(actor.session), true)
            })
          }
        }
        return await execute(...input)
      }
    }
    return connection
  }
  const created = await client.simulations.createWorld(input)
  assert.ok(created.result.ok)
  const runId = created.result.value.runId
  const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-product-model-pool.json')
  if (!recovering && process.env.WORLD_OWNER_POOL_CRASH === 'true') {
    const run = held()
    assert.ok(run)
    const reserve = run.reserveWriter.bind(run)
    run.reserveWriter = async (...args) => {
      const writer = await reserve(...args)
      if (auxiliary) {
        const block = writer.blockCompactionModelAdmission.bind(writer)
        writer.blockCompactionModelAdmission = async (...input) => {
          const refused = await block(...input)
          const state = run.snapshot()
          assert.ok(state.latestCheckpointId)
          await writeFile(proofPath, JSON.stringify({ runId, checkpointId: state.latestCheckpointId,
            world: state.world, stall: state.stall, blocks: state.compactionAdmissionBlocks }))
          process.send?.('pool-refusal-durable')
          await new Promise<undefined>((resolve) => { process.once('message', () => { resolve(undefined) }) })
          return refused
        }
        return writer
      }
      const block = writer.blockModelAdmission.bind(writer)
      writer.blockModelAdmission = async (...input) => {
        const refused = await block(...input)
        const state = run.snapshot()
        assert.ok(state.latestCheckpointId)
        await writeFile(proofPath, JSON.stringify({ runId, checkpointId: state.latestCheckpointId,
          world: state.world, stall: state.stall }))
        process.send?.('pool-refusal-durable')
        await new Promise<undefined>((resolve) => { process.once('message', () => { resolve(undefined) }) })
        return refused
      }
      return writer
    }
  }
  const waitCommand = async (commandId: string) => {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const query = await client.simulations.request({ commandId: commandId as import('@clocky/clocky-simulation-product/types').SimulationProductCommandId })
      assert.ok(query.result.ok && query.result.value.status === 'found')
      if (query.result.value.request.status !== 'accepted') return query.result.value.request
      await new Promise(done => setTimeout(done, 5))
    }
    throw new Error('Original pool command did not settle')
  }
  const waitStop = async (stop: string) => {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const control = await client.simulations.control({ runId })
      assert.ok(control.result.ok)
      assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result.value))
      if (control.result.value.stop === stop && !control.result.value.inFlight) return control.result.value
      await new Promise(done => setTimeout(done, 5))
    }
    throw new Error(`World product did not reach ${stop}`)
  }
  try {
    if (recovering) {
      const proof = JSON.parse(await readFile(proofPath, 'utf8')) as {
        runId: string
        checkpointId: string
        world: unknown
        stall: unknown
        blocks?: unknown }
      assert.equal(proof.runId, runId)
      const restored = await client.simulations.restore(simulationProductRestoreInputSchema.parse({ runId,
        commandId: 'restore-original-model-pool', checkpointId: proof.checkpointId }))
      assert.ok(restored.result.ok)
      assert.equal((await waitCommand('restore-original-model-pool')).status, 'completed')
      const run = held()
      assert.ok(run)
      assert.deepEqual(run.snapshot().world, proof.world)
      assert.deepEqual(run.snapshot().stall, proof.stall)
      if (auxiliary) assert.deepEqual(run.snapshot().compactionAdmissionBlocks, proof.blocks)
      const control = await client.simulations.control({ runId })
      assert.ok(control.result.ok)
      assert.equal(control.result.value.phase, 'paused')
      assert.equal(control.result.value.stop, 'model-pool-capacity')
      assert.equal(control.result.value.actions.start.allowed, true)
      const revision = run.snapshot().revision
      await client.simulations.inspect({ runId })
      await client.simulations.exportWorldDefinition({ runId })
      assert.equal(run.snapshot().revision, revision)
      assert.equal(requests.length, 0)
      const beforeStart = replayProbe?.snapshot()
      if (beforeStart !== undefined) assert.deepEqual(beforeStart, { model: 0, execution: 0, randomSample: 0, fetch: 0, socket: 0,
        productionAllowed: false })
      const input = simulationProductManageInputSchema.parse({ runId, managementId: 'explicit-continue-model-pool', phase: 'running' })
      replayProbe?.allowExplicitStart()
      const started = await client.simulations.manage(input)
      assert.ok(started.result.ok)
      await waitStop('idle')
      const state = run.snapshot(), calls = requests.length
      assert.equal(calls, mode === 'director' ? 15 : 12)
      assert.equal(Object.values(state.world!.results).filter(value => value.outcome.kind === 'committed').length, 1)
      const original = Object.values(state.decisions).find(value => value.modelAdmissionBlock !== undefined
        || state.compactionAdmissionBlocks?.some(block => block.decisionId === value.id))
      assert.ok(original)
      assert.equal(Object.values(state.decisions).filter(value => value.wakeId === original.wakeId).length, 2)
      const repeat = await client.simulations.manage(input)
      assert.ok(repeat.result.ok)
      assert.equal(run.snapshot().revision, state.revision)
      assert.equal(requests.length, calls)
      if (replayProbe !== undefined) {
        assert.equal(replayProbe.snapshot().model, calls)
        assert.equal(replayProbe.snapshot().fetch, 0); assert.equal(replayProbe.snapshot().socket, 0)
        await writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, 'explicit-start-replay-proof.json'), JSON.stringify({
          pid: process.pid, face: process.env.CLOCKY_EXAMPLE_MODE ?? 'src', backend: process.env.SIMULATION_COMPANY_BACKEND,
          scenario, mode, runId, checkpointId: proof.checkpointId, beforeStart, afterStart: replayProbe.snapshot(),
          managementId: input.managementId, pausedBeforeStart: true, repeatStartRevisionUnchanged: true,
          retainedWorldBeforeStart: proof.world, stateAfterStart: state }, null, 2))
      }
    } else {
      const started = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
        managementId: 'start-original-model-pool', phase: 'running' }))
      assert.ok(started.result.ok)
      const stopped = await waitStop('model-pool-capacity')
      assert.equal(stopped.actions.start.allowed, false)
      assert.equal(stopped.actions.start.reason, 'stalled')
      const run = held()
      assert.ok(run)
      const revision = run.snapshot().revision, calls = requests.length
      assert.equal(calls, mode === 'director' ? 3 : 6)
      if (auxiliary) {
        assert.equal(run.snapshot().stall?.code, 'SIM_COMPACTION_MODEL_POOL_CAPACITY')
        const block = run.snapshot().compactionAdmissionBlocks?.[0]
        assert.ok(block)
        assert.ok(block.decisionId)
        assert.equal(run.snapshot().decisions[block.decisionId]?.status, 'cancelled')
        assert.equal(Object.values(run.snapshot().tokenReservations ?? {}).some(value =>
          value.compactionId === block.request.compactionId), false)
      }
      assert.ok(finish)
      await finish()
      finish = undefined
      for (let read = 0; read < 3; read++) {
        const current = await client.simulations.control({ runId })
        assert.ok(current.result.ok)
        assert.equal(current.result.value.stop, 'model-pool-capacity')
        assert.equal(current.result.value.actions.start.allowed, true)
        await client.simulations.inspect({ runId })
        await client.simulations.exportWorldDefinition({ runId })
      }
      assert.equal(run.snapshot().revision, revision)
      assert.equal(requests.length, calls)
      const pause = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
        managementId: 'pause-original-model-pool', phase: 'paused' }))
      assert.ok(pause.result.ok)
      if (auxiliary) {
        const block = run.snapshot().compactionAdmissionBlocks?.[0]
        assert.ok(block)
        const read = ctx.sessionPersistence.readFrom.bind(ctx.sessionPersistence)
        const previous = run.snapshot().latestCheckpointId
        let changed = false
        ctx.sessionPersistence.readFrom = async (...args) => {
          const stored = await read(...args)
          if (args[0] !== block.sessionId) return stored
          return { ...stored, events: stored.events.map((event) => {
            if (event.type !== 'compaction/request' || event.data.compactionId !== block.request.compactionId) return event
            changed = true
            return { ...event, data: { ...event.data, request: { ...event.data.request,
              messages: [...event.data.request.messages, createUserMessage({ source: { kind: 'user' },
                content: [{ type: 'text', text: 'Altered auxiliary input' }] })] } } }
          }) }
        }
        try {
          const checkpoint = await client.simulations.checkpoint(simulationProductCheckpointInputSchema.parse({ runId,
            commandId: 'checkpoint-altered-auxiliary-input' }))
          assert.ok(checkpoint.result.ok)
          assert.equal((await waitCommand('checkpoint-altered-auxiliary-input')).status, 'failed')
          assert.equal(changed, true)
          assert.equal(run.snapshot().latestCheckpointId, previous)
          assert.equal(requests.length, calls)
        } finally { ctx.sessionPersistence.readFrom = read }
      }
      const checkpoint = await client.simulations.checkpoint(simulationProductCheckpointInputSchema.parse({ runId,
        commandId: 'checkpoint-original-model-pool' }))
      assert.ok(checkpoint.result.ok)
      const receipt = await waitCommand('checkpoint-original-model-pool')
      assert.equal(receipt.status, 'completed')
      assert.ok(receipt.checkpointId)
      await writeFile(proofPath, JSON.stringify({ runId, checkpointId: receipt.checkpointId,
        world: run.snapshot().world, stall: run.snapshot().stall,
        ...auxiliary ? { blocks: run.snapshot().compactionAdmissionBlocks } : {} }))
    }
  } finally { if (finish !== undefined) await finish(); replayProbe?.dispose() }
  console.log(JSON.stringify({ scenario, mode, stop: 'model-pool-capacity', productOwner: true,
    explicitContinuation: recovering, noAutomaticRetry: true, modelCalls: requests.length, heldProviderCalls: recovering ? 0 : 1 }))
}
