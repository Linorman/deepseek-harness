/** Recover only the original winner recorded while the real personnel callback and canonical source cut were held. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@clocky/cordis'
import { simulationWorldCancelRequestSchema, simulationWorldTransferPayloadSchema,
  simulationWorldTransferCommittedResultPayloadSchema, activeSimulationMaintenance } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationRunSelection, SimulationEntityId } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import { recordR06Cut } from './world-r06-observation.ts'

/**
 * Reconcile the old callback without resuming scheduling, then prove the original cancellation or commit stayed terminal.
 * @param input - Real restored owners and current process-local model counter; no replacement business input is accepted.
 */
export async function recoverR06PersonnelCancel(input: {
  readonly ctx: Context
  readonly run: SimulationRun
  readonly selection: SimulationRunSelection
  readonly connection: SimulationTeamConnection
  readonly driver: SimulationWorldDriver
  readonly person: SimulationEntityId
  readonly winner: 'cancel' | 'commit'
  readonly models: () => number
}): Promise<void> {
  const { ctx, run, selection, connection, driver } = input
  const saved = JSON.parse(await readFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, 'r06-personnel-cancel-source.json'), 'utf8')) as {
    originalIdentity: {
      binding: unknown
      profile: unknown
      profileRevision: number
      assignment: unknown
      channelId: unknown
      entityIds: string[]
    }
    heldEvidence: { cancellation: unknown }
    memoryPrefix: unknown[]
    memoryCanary: string
  }
  const cancellation = simulationWorldCancelRequestSchema.parse(saved.heldEvidence.cancellation)
  const person = input.person, before = run.snapshot()
  assert.equal(before.phase, 'paused'); assert.equal(input.models(), 0)
  assert.equal((await driver.advance()).reason, 'paused')
  assert.deepEqual(run.snapshot(), before)
  await driver.reconcile()
  assert.equal(run.snapshot().phase, 'paused'); assert.equal(input.models(), 0)
  assert.equal(activeSimulationMaintenance(run.snapshot()), undefined)
  const state = run.snapshot(), world = state.world!, target = state.entities[person]!
  const request = world.requests[cancellation.requestId]!, intent = world.intents[request.intentId]!
  const result = Object.values(world.results).find(value => value.intentId === intent.id)!
  assert.ok(result)
  assert.equal(Object.values(world.results).filter(value => value.intentId === intent.id).length, 1)
  assert.equal(result.outcome.kind, input.winner === 'commit' ? 'committed' : 'cancelled')
  assert.deepEqual(target.binding, saved.originalIdentity.binding)
  assert.deepEqual(target.profile, saved.originalIdentity.profile)
  assert.equal(target.profileRevision, saved.originalIdentity.profileRevision)
  assert.deepEqual(Object.keys(state.entities).sort(), saved.originalIdentity.entityIds)
  assert.equal(world.channels[person], saved.originalIdentity.channelId)
  const payload = simulationWorldTransferPayloadSchema.parse(intent.payload), reservation = world.personnel.reservations[intent.id]!
  assert.ok(reservation)
  if (input.winner === 'commit') {
    const outcome = simulationWorldTransferCommittedResultPayloadSchema.parse(result.payload)
    assert.equal(state.relations[outcome.closedAssignmentId]!.validUntil, result.time)
    assert.equal(state.relations[outcome.newAssignmentId]!.validFrom, result.time)
    assert.equal(reservation.status, 'committed'); assert.equal(world.personnel.fences[intent.id]!.status, 'closed')
    assert.equal(Object.keys(world.mutations).length, 1)
  } else {
    assert.deepEqual(state.relations[payload.assignmentId], saved.originalIdentity.assignment)
    assert.equal(reservation.status, 'cancelled'); assert.equal(world.personnel.fences[intent.id]!.status, 'cancelled')
    assert.equal(Object.keys(world.mutations).length, 0)
  }
  assert.equal(state.maintenance![reservation.request.maintenance.id]!.status, 'completed')
  const revision = run.snapshot().revision
  const retry = await connection.cancelWorldCase(cancellation)
  assert.equal(retry.status, input.winner === 'commit' ? 'already-committed' : 'cancelled')
  assert.equal(retry.resultId, result.id); assert.equal(run.snapshot().revision, revision)
  const memory = await ctx.sessionPersistence.readFrom(target.binding!.sessionId, 0)
  assert.deepEqual(memory.events.slice(0, saved.memoryPrefix.length), saved.memoryPrefix)
  assert.ok(JSON.stringify(memory.events).includes(saved.memoryCanary))
  assert.equal(input.models(), 0)
  if (process.env.WORLD_R06_ROUND === '2') {
    const previous = JSON.parse(await readFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, 'r06-final-1.json'), 'utf8')) as {
      snapshot: ReturnType<typeof run.snapshot>
    }
    assert.deepEqual(run.snapshot().world, previous.snapshot.world)
    assert.deepEqual(run.snapshot().relations, previous.snapshot.relations)
    assert.deepEqual(run.snapshot().operations, previous.snapshot.operations)
  }
  await recordR06Cut(ctx, run, selection, 'final')
  console.log(JSON.stringify({ winner: input.winner, phase: 'paused', modelCalls: input.models(), originalIdentity: true,
    originalMemory: true, noPartialMutation: true, originalTerminalWinner: true, exactRetryNoAppend: true }))
}
