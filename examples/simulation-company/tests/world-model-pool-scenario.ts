/** Real downstream stream competition against director and newborn cognition, including cold explicit continuation. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@clocky/cordis'
import { MessageId } from '@clocky/clocky-llm'
import { simulationCheckpointIdSchema, simulationPhaseManagementRequestSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, OrganizationWorldExecution } from '@clocky/clocky-simulation-world'
import { requests } from './world-driver-model.ts'

/**
 * Hold one actual Agent provider request from another run under the same model admission owner.
 * @param ctx - Real Loader composition, whose pool is configured with one permit and no waiting queue.
 * @param resolved - Original compiler output; the competing run owns separate canonical identities and storage.
 * @returns explicit terminal cleanup; release never schedules the blocked target run.
 */
export async function occupyWorldModelPool(ctx: Context, resolved: ResolvedWorldScenario): Promise<() => Promise<void>> {
  const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create',
    spec: { runId: 'world-pool-holder', ...resolved.native } }))
  const preparation = await prepareSimulationWorld(ctx.simulationTeams, run, { resolved, ownerName: 'world-pool/holder',
    checkpoint: { id: simulationCheckpointIdSchema.parse('pool-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!
  const ownerName = team.creation.rules['activationLifecycleOwner']
  assert.equal(typeof ownerName, 'string')
  assert.ok(typeof ownerName === 'string')
  const connection = await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const lifetime = new AbortController()
  const anchor = { checkpointId: preparation.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime.signal, ctx,
    ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: anchor,
      lifetime: lifetime.signal,
    }, [new OrganizationWorldExecution(run, connection, resolved, anchor, lifetime.signal)]))
  const held = ctx.worldDriverProbe.holdNextRequest()
  await run.setPhase('running', run.snapshot().revision)
  const work = driver.advance()
  const settled = Promise.allSettled([work])
  await held.entered
  assert.deepEqual(ctx.simulationTeams.modelUsage(), { active: 1, queued: 0, limit: 1, queueLimit: 0 })
  assert.equal(Object.values(run.snapshot().tokenReservations ?? {}).filter(value => value.status === 'reserved').length, 1)
  return async () => {
    lifetime.abort(new Error('Explicitly retire competing fixture stream'))
    held.finish()
    await settled
    await driver.drain()
    await connection.close()
    await run.close()
    assert.deepEqual(ctx.simulationTeams.modelUsage(), { active: 0, queued: 0, limit: 1, queueLimit: 0 })
  }
}

/**
 * Refuse an actual target Agent attempt, retain its original wake and checkpoint it; a cold process explicitly retries once.
 * @param ctx - Shared real model pool owner and other Loader services.
 * @param run - Target world run.
 * @param connection - Its exclusive execution connection.
 * @param driver - Generic world scheduling owner.
 * @param resolved - Original compiler output.
 * @param recovering - Whether the target was explicitly restored in this independent process.
 */
export async function verifyWorldModelPool(ctx: Context, run: SimulationRun, connection: SimulationTeamConnection,
  driver: SimulationWorldDriver, resolved: ResolvedWorldScenario, recovering: boolean): Promise<void> {
  const mode = process.env.WORLD_DRIVER_POOL
  assert.ok(mode === 'director' || mode === 'newcomer')
  const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-model-pool-proof.json')
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, 0)
  if (!recovering) {
    let finish: (() => Promise<void>) | undefined
    const execute = connection.executeDecision.bind(connection)
    connection.executeDecision = async (...args) => {
      const world = run.snapshot().decisions[args[1]]?.context
      if (finish === undefined && world?.status === 'prepared'
        && world.world?.kind === (mode === 'director' ? 'resolve' : 'first-action')) {
        finish = await occupyWorldModelPool(ctx, resolved)
      }
      return await execute(...args)
    }
    try {
      await run.setPhase('running', run.snapshot().revision)
      assert.equal((await driver.advance()).reason, 'model-pool-capacity')
      const stopped = run.snapshot(), calls = requests.length
      assert.equal(calls, mode === 'director' ? 3 : 6)
      assert.equal(stopped.stall?.code, 'SIM_MODEL_POOL_CAPACITY')
      if (stopped.stall?.code !== 'SIM_MODEL_POOL_CAPACITY') throw new Error('Missing exact pool refusal')
      const refused = stopped.decisions[stopped.stall.decisionId]!
      assert.equal(refused.status, 'cancelled')
      assert.deepEqual(refused.modelAdmissionBlock && { ...refused.modelAdmissionBlock, sessionSequence: 0 },
        { sessionSequence: 0, active: 1, queued: 0, limit: 1, queueLimit: 0 })
      assert.ok(refused.modelAdmissionBlock && refused.modelAdmissionBlock.sessionSequence > 0)
      assert.ok(refused.wakeId)
      assert.equal(stopped.wakes[refused.wakeId]?.status, 'pending')
      assert.equal(stopped.activeWindowId, undefined)
      assert.deepEqual(refused.operationIds, [])
      for (let repeat = 0; repeat < 3; repeat++) {
        assert.equal((await driver.advance()).reason, 'model-pool-capacity')
        assert.equal(run.snapshot().revision, stopped.revision)
        assert.equal(requests.length, calls)
      }
      assert.ok(finish)
      await finish()
      finish = undefined
      assert.equal(run.snapshot().revision, stopped.revision)
      assert.equal(requests.length, calls)
      assert.equal((await driver.advance()).reason, 'model-pool-capacity')
      await writeFile(proofPath, JSON.stringify({ decision: refused, world: stopped.world, stall: stopped.stall }))
      await run.setPhase('paused', run.snapshot().revision)
      const read = ctx.sessionPersistence.readFrom.bind(ctx.sessionPersistence)
      const previousCheckpoint = run.snapshot().latestCheckpointId
      const sessionId = stopped.entities[refused.entityId]!.binding!.sessionId
      let changed = false
      ctx.sessionPersistence.readFrom = async (...args) => {
        const stored = await read(...args)
        if (args[0] !== sessionId) return stored
        return { ...stored, events: stored.events.map((event) => {
          if (event.type !== 'user/message' || refused.context?.status !== 'prepared'
            || event.data.id !== MessageId(refused.context.view.inputId)) return event
          changed = true
          return { ...event, data: { ...event.data, content: [{ type: 'text' as const, text: 'Changed refused input' }] } }
        }) }
      }
      try {
        const invalid = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('world-pool-invalid-request'),
          implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
        assert.equal(changed, true)
        assert.equal(invalid.status, 'failed')
        assert.equal(run.snapshot().latestCheckpointId, previousCheckpoint)
      } finally { ctx.sessionPersistence.readFrom = read }
      const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('world-complete'),
        implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
      assert.equal(checkpoint.status, 'completed')
    } finally { if (finish !== undefined) await finish() }
  } else {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as { decision: { id: string; wakeId: string }; world: unknown; stall: unknown }
    const original = Object.values(run.snapshot().decisions).find(value => value.id === proof.decision.id)
    assert.ok(original)
    assert.deepEqual(original, proof.decision)
    assert.deepEqual(run.snapshot().world, proof.world)
    assert.deepEqual(run.snapshot().stall, proof.stall)
    assert.equal(requests.length, 0)
    const management = simulationPhaseManagementRequestSchema.parse({ id: 'explicit-resume-pool', phase: 'running' })
    const accepted = await run.managePhase(management)
    assert.equal(accepted.status, 'completed')
    let result = await driver.advance()
    for (let repeat = 0; repeat < 8 && result.reason === 'work-limit'; repeat++) result = await driver.advance()
    assert.equal(result.reason, 'idle')
    assert.equal(requests.length, mode === 'director' ? 15 : 12)
    const state = run.snapshot()
    assert.deepEqual(state.decisions[original.id], original)
    assert.equal(Object.values(state.decisions).filter(value => value.wakeId === original.wakeId).length, 2)
    assert.equal(Object.values(state.world!.results).filter(value => value.outcome.kind === 'committed').length, 1)
    assert.equal(Object.values(state.world!.plans).filter(value => value.status === 'accepted').length, 1)
    assert.deepEqual(await run.managePhase(management), accepted)
    assert.equal(run.snapshot().revision, state.revision)
    assert.equal(requests.length, mode === 'director' ? 15 : 12)
  }
  process.stdout.write(JSON.stringify({ mode, stop: 'model-pool-capacity', originalWake: true,
    coldRestore: recovering, modelCalls: requests.length, heldProviderCalls: recovering ? 0 : 1 }))
}
