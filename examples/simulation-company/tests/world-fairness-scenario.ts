import { hiringIntentFields } from './world-domain-input.ts'
/** Sustained real Agent wake competition proves bounded World batches and retained fair selection across cold recovery. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { simulationWakeRequestSchema, simulationCheckpointIdSchema, simulationMaintenanceRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationEntityId } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import { requests } from './world-driver-model.ts'

/**
 * Replenish one recorded wake per served actor until both finish a finite sustained workload through actual model tools.
 * @param run - Original Native world run or cold-restored checkpoint.
 * @param connection - Canonical execution owner.
 * @param driver - Generic bounded world scheduler.
 * @param recovering - Independent cold process; it validates facts without running the workload again.
 * @param scenario - Company/laboratory evidence label.
 */
export async function verifyWorldFairness(run: SimulationRun, connection: SimulationTeamConnection,
  driver: SimulationWorldDriver, recovering: boolean, scenario: string): Promise<void> {
  const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-fairness.json')
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, 0)
  if (recovering) {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as { world: unknown; dispatch: unknown; decisions: unknown }
    const state = run.snapshot()
    assert.deepEqual(state.world, proof.world)
    assert.deepEqual(state.decisionDispatch, proof.dispatch)
    assert.deepEqual(state.decisions, proof.decisions)
    assert.equal(state.phase, 'paused')
    assert.equal(requests.length, 0)
    console.log(JSON.stringify({ scenario, pausedRecovery: true, roundsPerActor: 12,
      maxWaitRounds: 2, maxBatchSteps: 2, modelCalls: 0 }))
    return
  }
  await run.setPhase('running', run.snapshot().revision)
  let result = await driver.advance()
  for (let batch = 0; batch < 64 && result.reason === 'work-limit'; batch++) result = await driver.advance()
  assert.equal(result.reason, 'idle')
  assert.equal(requests.length, 18)
  const world = run.snapshot().world!, before = structuredClone(world)
  const owner = run.snapshot().teamReservation?.creation.rules['activationLifecycleOwner']
  assert.ok(typeof owner === 'string')
  const maintenance = simulationMaintenanceRequestSchema.parse({ id: 'fairness-maintenance-boundary', owner })
  await run.beginMaintenance(maintenance)
  const blocked = run.snapshot(), blockedCalls = requests.length
  for (let repeat = 0; repeat < 3; repeat++) {
    assert.equal((await driver.advance()).reason, 'maintenance-blocked')
    assert.equal(run.snapshot().revision, blocked.revision)
    assert.equal(requests.length, blockedCalls)
  }
  await connection.quiesceForMaintenance(maintenance, 4, 3)
  await run.finishMaintenance(maintenance)
  assert.equal(run.snapshot().phase, 'paused')
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, blockedCalls)
  await run.setPhase('running', run.snapshot().revision)
  const director = world.definition.directorEntityId, member = hiringIntentFields(Object.values(world.intents)[0]).requesterEntityId
  const counts = new Map<SimulationEntityId, number>([[director, 0], [member, 0]])
  const served: Array<{ entityId: SimulationEntityId; round: bigint; batch: number }> = []
  let currentBatch = 0
  const nextWake = async (entityId: SimulationEntityId, index: number) => {
    const state = run.snapshot()
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: `fair/${entityId}/${index}`, entityId,
      time: String(BigInt(state.time) + 1n), reason: 'Continue your bounded observation through the recorded tools.' }), state.revision)
  }
  const execute = connection.executeDecision.bind(connection)
  connection.executeDecision = async (...args) => {
    const decision = await execute(...args)
    if (!decision.wakeId?.startsWith('fair/')) return decision
    assert.ok(decision.status === 'submitted' || decision.status === 'accepted')
    const state = run.snapshot(), ticket = state.decisionDispatch?.tickets[decision.id]
    const selection = Object.values(state.decisionDispatch?.selections ?? {}).find(value => value.decisions.includes(decision.id))
    assert.ok(ticket)
    assert.ok(selection)
    assert.ok(BigInt(selection.round) - BigInt(ticket.queuedRound) <= BigInt(state.spec.maxDispatchWaitRounds))
    const count = (counts.get(decision.entityId) ?? 0) + 1
    counts.set(decision.entityId, count)
    served.push({ entityId: decision.entityId, round: BigInt(selection.round), batch: currentBatch })
    if (count < 12) await nextWake(decision.entityId, count + 1)
    return decision
  }
  await nextWake(director, 1)
  await nextWake(member, 1)
  for (currentBatch = 1; currentBatch <= 80; currentBatch++) {
    const prior = served.length
    const calls: number = requests.length
    result = await driver.advance()
    assert.ok(result.reason === 'work-limit' || result.reason === 'idle', JSON.stringify(result))
    assert.ok(result.controlSteps <= 2)
    assert.ok(served.length - prior <= 2)
    assert.equal(requests.length - calls, (served.length - prior) * 3)
    if (result.reason === 'idle') break
  }
  assert.equal(result.reason, 'idle')
  assert.equal(served.length, 24)
  for (const entityId of [director, member]) {
    assert.equal(counts.get(entityId), 12)
    const own = served.filter(value => value.entityId === entityId)
    for (let index = 1; index < own.length; index++) {
      assert.ok(own[index]!.round - own[index - 1]!.round <= 2n)
      assert.ok(own[index]!.batch - own[index - 1]!.batch <= 2)
    }
  }
  assert.equal(requests.length, 90)
  assert.deepEqual(run.snapshot().world, before)
  const idle = run.snapshot(), calls = requests.length
  for (let repeat = 0; repeat < 3; repeat++) assert.equal((await driver.advance()).reason, 'idle')
  assert.equal(run.snapshot().revision, idle.revision)
  assert.equal(requests.length, calls)
  await run.setPhase('paused', run.snapshot().revision)
  const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('world-complete'),
    implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
  assert.equal(checkpoint.status, 'completed')
  const state = run.snapshot()
  await writeFile(proofPath, JSON.stringify({ world: state.world, dispatch: state.decisionDispatch, decisions: state.decisions,
    services: served.map(value => ({ ...value, round: String(value.round) })) }))
  console.log(JSON.stringify({ scenario, pausedRecovery: false, roundsPerActor: 12,
    maxWaitRounds: 2, maxBatchSteps: 2, modelCalls: requests.length }))
}
