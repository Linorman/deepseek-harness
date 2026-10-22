import { simulationWorldHireCommittedResultPayloadSchema } from '@clocky/clocky-simulation'
import { hiringIntentFields } from './world-domain-input.ts'
import { seedHiringIntent } from './world-domain-input.ts'
/** Real driver attempts lose a critical read at the reservation boundary; cold recovery retains their bounded history. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { simulationChangeSchema, simulationCheckpointIdSchema, simulationWakeRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import { requests } from './world-driver-model.ts'

/**
 * Verify actual Agent replanning and a stable, non-inferencing stop across a new-process checkpoint restore.
 * @param run - Original prepared or cold-restored Native run.
 * @param connection - Its canonical Team connection.
 * @param driver - The same generic driver used by the successful scenarios.
 * @param recovering - Whether the original checkpoint was restored in this process.
 * @param scenario - Definition label used only in the evidence output.
 */
export async function verifyWorldReplanning(run: SimulationRun, connection: SimulationTeamConnection,
  driver: SimulationWorldDriver, recovering: boolean, scenario: string): Promise<void> {
  const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-replanning-proof.json')
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, 0)
  const limit = run.snapshot().world!.definition.limits.maxPlansPerRequest
  assert.equal(limit, 3)
  if (!recovering) {
    const reserve = run.reserveWorldHire.bind(run)
    run.reserveWorldHire = async (input) => {
      const grant = Object.values(run.snapshot().relations).find(value => value.relation === 'can-hire')!
      const { revision, ...fields } = grant
      const attempt = Object.values(run.snapshot().world!.plans).length
      await run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...fields, relationRevision: revision,
        validUntil: String(100 + attempt) }), run.snapshot().revision)
      return await reserve(input)
    }
  }
  await run.setPhase('running', run.snapshot().revision)
  if (!recovering) {
    for (let attempt = 1; attempt <= limit; attempt++) {
      const outcome = await driver.advance()
      assert.equal(outcome.reason, 'plan-stale', JSON.stringify(outcome))
      const plans = Object.values(run.snapshot().world!.plans)
      assert.equal(plans.length, attempt)
      assert.equal(plans.at(-1)!.proposal.supersedes, attempt === 1 ? null : plans.at(-2)!.id)
      assert.equal(plans.at(-1)!.stale?.reason, 'read-set-changed')
      assert.equal(plans.at(-1)!.stale?.phase, 'execution')
      assert.equal(requests.length, (attempt + 1) * 3)
    }
  }
  const calls = requests.length
  const stopped = await driver.advance()
  assert.equal(stopped.reason, 'plan-budget', JSON.stringify(stopped))
  const before = run.snapshot()
  assert.equal(Object.values(before.world!.plans).length, limit)
  assert.equal(Object.values(before.world!.requests).length, 1)
  assert.equal(Object.values(before.world!.intents).length, 1)
  assert.deepEqual(before.world!.reservations, {})
  assert.deepEqual(before.world!.results, {})
  assert.equal(before.activeWindowId, undefined)
  assert.ok(Object.values(before.decisions).filter(value => value.context?.status === 'prepared'
    && value.context.world?.kind === 'resolve').length === limit)
  for (let repeat = 0; repeat < 3; repeat++) {
    assert.equal((await driver.advance()).reason, 'plan-budget')
    assert.equal(run.snapshot().revision, before.revision)
    assert.equal(requests.length, calls)
  }
  if (recovering) assert.deepEqual(before.world, JSON.parse(await readFile(proofPath, 'utf8')))
  else await writeFile(proofPath, JSON.stringify(before.world))
  await run.setPhase('paused', run.snapshot().revision)
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, calls)
  if (!recovering) {
    const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('world-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
  }
  console.log(JSON.stringify({ scenario, stop: stopped.reason, plans: limit, requests: 1, hires: 0,
    stableStop: true, originalHistory: true, paused: true, modelCalls: calls }))
}

/**
 * Exercise a rejected request and a linked successful application through the generic driver, then cold replay both originals.
 * @param run - Original prepared or cold-restored Native run.
 * @param connection - Its canonical Team connection.
 * @param driver - Generic World driver; no business operation is executed directly by this probe.
 * @param recovering - Whether the original checkpoint was restored in this process.
 * @param scenario - Definition label used only in evidence.
 */
export async function verifyWorldResubmission(run: SimulationRun, connection: SimulationTeamConnection,
  driver: SimulationWorldDriver, recovering: boolean, scenario: string): Promise<void> {
  const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-resubmission-proof.json')
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, 0)
  if (!recovering) {
    await run.setPhase('running', run.snapshot().revision)
    assert.equal((await driver.advance()).reason, 'idle')
    const first = Object.values(run.snapshot().world!.requests)[0]!
    const result = Object.values(run.snapshot().world!.results)[0]!
    assert.deepEqual(result.outcome, { kind: 'rejected', reason: 'insufficient-information' })
    const application = hiringIntentFields(run.snapshot().world!.intents[first.intentId])
    const input = { ...application, applicationId: 'clarified-application' }
    const before = run.snapshot()
    await assert.rejects(seedHiringIntent(run, input), /must link the latest insufficient-information case/)
    assert.deepEqual(run.snapshot(), before)
    const intent = await seedHiringIntent(run, { ...input, priorRequestId: first.id })
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: `world-initial:${intent.id}`, entityId: input.requesterEntityId,
      time: run.snapshot().time, reason: 'The linked application now has the missing position information.' }), run.snapshot().revision)
    let outcome = await driver.advance()
    for (let round = 0; round < 8 && outcome.reason === 'work-limit'; round++) outcome = await driver.advance()
    assert.equal(outcome.reason, 'idle', JSON.stringify(outcome))
    assert.deepEqual(run.snapshot().world!.results[result.id], result)
  }
  const world = run.snapshot().world!
  assert.equal(Object.values(world.requests).length, 2)
  assert.equal(Object.values(world.plans).length, 2)
  assert.equal(Object.values(world.results).length, 2)
  const committed = Object.values(world.results).find(value => value.outcome.kind === 'committed')!
  assert.equal(committed.outcome.kind, 'committed')
  if (committed.outcome.kind !== 'committed') throw new Error('Linked application must actually hire')
  const original = Object.values(world.requests).find(value => value.status === 'rejected')!
  assert.equal(hiringIntentFields(world.intents[committed.intentId]).priorRequestId, original.id)
  const newborn = run.snapshot().entities[simulationWorldHireCommittedResultPayloadSchema.parse(committed.payload).entityId]!
  assert.equal(newborn.readiness, 'ready')
  assert.ok(newborn.binding)
  assert.notEqual(newborn.binding.sessionId, run.snapshot().entities[world.definition.directorEntityId]?.binding?.sessionId)
  if (!recovering) assert.ok(requests.some(value => value.purpose === 'first-action' && value.entityId === newborn.id))
  const proof = { world,
    assignment: run.snapshot().relations[simulationWorldHireCommittedResultPayloadSchema.parse(committed.payload).relationId] }
  if (recovering) assert.deepEqual(proof, JSON.parse(await readFile(proofPath, 'utf8')))
  else await writeFile(proofPath, JSON.stringify(proof))
  const calls = requests.length
  assert.equal((await driver.advance()).reason, recovering ? 'paused' : 'idle')
  assert.equal(requests.length, calls)
  if (!recovering) {
    await run.setPhase('paused', run.snapshot().revision)
    const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('world-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
  }
  console.log(JSON.stringify({ scenario, resubmitted: true, linked: true, requests: 2, plans: 2, hires: 1,
    firstAction: true, originalHistory: true, paused: true, modelCalls: calls }))
}
