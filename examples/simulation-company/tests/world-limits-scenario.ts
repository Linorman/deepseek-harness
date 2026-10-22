/** Real World actors retain quota stops without relabeling them as driver failures or repeating inference. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { simulationCheckpointIdSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import type { WorldScenario } from '@clocky/clocky-simulation-scenario'
import { requests } from './world-driver-model.ts'

const modes = ['position', 'entities', 'participants', 'channels', 'director-tokens', 'newcomer-tokens', 'context', 'microstep'] as const
const modeSchema = z.enum(modes)

/** @param definition - Portable input whose explicit limits are frozen by the ordinary compiler. */
export function applyWorldLimitScenario(definition: WorldScenario): void {
  if (process.env.WORLD_DRIVER_FAIRNESS === 'true') {
    definition.limits = { ...definition.limits, native: { maxDriveSteps: 2, maxDispatchWaitRounds: 2 } }
  }
  if (process.env.WORLD_MESSAGE_BYTES !== undefined) {
    z.enum(['director', 'newcomer']).parse(process.env.WORLD_MESSAGE_BYTES)
    definition.limits = { ...definition.limits, team: { maxEnvelopeBytes: 2048 } }
  }
  if (process.env.WORLD_SUBMISSION_LIMIT !== undefined) {
    const mode = z.enum(['request-bytes', 'plan-bytes', 'authority']).parse(process.env.WORLD_SUBMISSION_LIMIT)
    if (mode === 'request-bytes') definition.limits = { ...definition.limits, world: { maxBytesPerRequest: 2048 } }
    if (mode === 'plan-bytes') definition.limits = { ...definition.limits, world: { maxBytesPerPlan: 2048 } }
  }
  if (process.env.WORLD_OWNER_ACTIVATION !== undefined) {
    const mode = z.enum(['director', 'newcomer']).parse(process.env.WORLD_OWNER_ACTIVATION)
    definition.limits = { ...definition.limits, team: { maxActivations: mode === 'director' ? 3 : 4 } }
  }
  if (process.env.WORLD_DRIVER_LIMIT === undefined) return
  const mode = modeSchema.parse(process.env.WORLD_DRIVER_LIMIT)
  if (mode === 'position') definition.positions[0]!.capacity = 1
  if (mode === 'entities') definition.limits = { ...definition.limits, native: { maxEntities: 5 } }
  if (mode === 'participants') definition.limits = { ...definition.limits, team: { maxParticipants: 3 } }
  if (mode === 'channels') definition.limits = { ...definition.limits, team: { maxChannels: 2 } }
  if (mode === 'director-tokens') definition.limits = { ...definition.limits, native: { maxTokensPerInterval: 10044 } }
  if (mode === 'newcomer-tokens') definition.limits = { ...definition.limits, native: { maxTokensPerInterval: 10089 } }
  if (mode === 'microstep') definition.limits = { ...definition.limits, native: { maxMicrostepsPerTime: 1 } }
}

/**
 * Verify durable actor/plan/identity facts and a stable stop before and after an explicit new-process restore.
 * @param run - Original prepared or cold-restored run.
 * @param connection - Its canonical Team connection.
 * @param driver - Generic driver using only original compiled limits.
 * @param recovering - Whether the checkpoint was explicitly restored in this process.
 * @param scenario - Definition label included in the evidence output.
 */
export async function verifyWorldLimits(run: SimulationRun, connection: SimulationTeamConnection,
  driver: SimulationWorldDriver, recovering: boolean, scenario: string): Promise<void> {
  const mode = modeSchema.parse(process.env.WORLD_DRIVER_LIMIT)
  const stops = { position: 'position-capacity', entities: 'entity-capacity', participants: 'identity-capacity',
    channels: 'channel-capacity', 'director-tokens': 'budget-limit', 'newcomer-tokens': 'budget-limit',
    context: 'context-limit', microstep: 'microstep-limit' } as const
  const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-limit-proof.json')
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, 0)
  const stalled = mode === 'director-tokens' || mode === 'newcomer-tokens' || mode === 'context' || mode === 'microstep'
  if (recovering && stalled && mode !== 'context') {
    assert.ok(run.snapshot().stall)
    await assert.rejects(run.setPhase('running', run.snapshot().revision))
    assert.equal(requests.length, 0)
  } else {
    await run.setPhase('running', run.snapshot().revision)
    const outcome = await driver.advance()
    assert.equal(outcome.reason, stops[mode], JSON.stringify(outcome))
    const revision = run.snapshot().revision, calls = requests.length
    for (let repeat = 0; repeat < 3; repeat++) {
      assert.equal((await driver.advance()).reason, stops[mode])
      assert.equal(run.snapshot().revision, revision)
      assert.equal(requests.length, calls)
    }
  }
  const state = run.snapshot(), world = state.world!
  if (!recovering) {
    if (mode === 'context') assert.equal(requests.length, 0)
    else if (mode === 'director-tokens' || mode === 'microstep') assert.equal(requests.length, 3)
    else assert.equal(requests.length, 6)
  }
  if (mode === 'newcomer-tokens') {
    const decision = Object.values(state.decisions).find(value => value.context?.status === 'prepared'
      && value.context.world?.kind === 'first-action')
    assert.ok(decision)
    assert.equal(state.entities[decision.entityId]?.profile['name'], scenario === 'company' ? 'Lin' : 'Kai')
    assert.equal(Object.values(world.results).filter(value => value.outcome.kind === 'committed').length, 1)
  } else assert.deepEqual(world.reservations, {})
  const proof = { world, stall: state.stall ?? null, decisions: state.decisions, tokens: state.tokenReservations ?? {} }
  if (recovering) {
    const original = JSON.parse(await readFile(proofPath, 'utf8')) as { world: unknown; stall: unknown; tokens: unknown }
    assert.deepEqual(proof.world, original.world)
    if (mode === 'context') {
      assert.equal(state.stall?.code, 'SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW')
      if (state.stall?.code !== 'SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW') throw new Error('Original context bound must still block inference')
      assert.equal(state.stall.maxBytes, 512)
      assert.ok(state.stall.requiredBytes > state.stall.maxBytes)
    } else assert.deepEqual(proof.stall, original.stall)
    assert.deepEqual(proof.tokens, original.tokens)
  } else await writeFile(proofPath, JSON.stringify(proof))
  if (!recovering) {
    await run.setPhase('paused', run.snapshot().revision)
    const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('world-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
  }
  console.log(JSON.stringify({ scenario, mode, stop: stops[mode], stableStop: true, originalFacts: true,
    pausedRecovery: recovering, modelCalls: requests.length }))
}
