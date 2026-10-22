/** Actual retained maintenance survives effect unload and process loss; missing/changed bindings are refused before callback IO. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@clocky/cordis'
import { activeSimulationMaintenance, simulationWorldDomainPinSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationRunSelection } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import type { WorldExecutionHandler, SimulationWorldDriverAnchor } from '@clocky/clocky-simulation-world'
import { recordR06Cut } from './world-r06-observation.ts'

/** @param ctx - Existing Loader context. @param run - Original run. @param selection - Original inspection identity. */
export async function holdR06Retirement(ctx: Context, run: SimulationRun,
  selection: Pick<SimulationRunSelection, 'provider' | 'spec'>): Promise<void> {
  assert.ok(activeSimulationMaintenance(run.snapshot()))
  assert.equal(Object.values(run.snapshot().world!.reservations)[0]?.status, 'committed')
  assert.ok(Object.values(run.snapshot().world!.executions).some(value => value.phase === 'outcome-unknown'))
  await recordR06Cut(ctx, run, selection, 'barrier')
  process.send?.('durable')
  await new Promise<void>((done) => { process.once('message', () => { done() }) })
}

/**
 * Verify original provider reconciliation and exact binding rejection without starting production scheduling.
 * @param input - Real restored owners, the original compiled artifact and process-local model counter.
 */
export async function recoverR06Retirement(input: {
  readonly ctx: Context
  readonly run: SimulationRun
  readonly selection: SimulationRunSelection
  readonly connection: SimulationTeamConnection
  readonly resolved: ResolvedWorldScenario
  readonly anchor: SimulationWorldDriverAnchor
  readonly driver: SimulationWorldDriver
  readonly models: () => number
  readonly scope: Context
}): Promise<void> {
  const { ctx, run, connection, resolved, anchor, driver, selection } = input
  const held = JSON.parse(await readFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, 'r06-barrier-0.json'), 'utf8')) as {
    snapshot: ReturnType<typeof run.snapshot>
  }
  const before = run.snapshot(), handlers = ctx.simulationWorldExecutions.handlers({ run, connection, resolved, anchor,
    lifetime: new AbortController().signal })
  assert.equal(before.phase, 'paused'); assert.equal(input.models(), 0)
  const original = handlers[0]!, pin = before.world!.definition.operations[0]!
  assert.ok(original && pin)
  const changed = simulationWorldDomainPinSchema.parse({ ...pin,
    implementationRef: `${pin.implementationRef}/r06-replacement`, generation: pin.generation + 1 })
  let callback = false
  const replacement: WorldExecutionHandler = { definition: original.definition, ref: changed.implementationRef,
    generation: changed.generation, reconciliationPlans: () => [], retainsResponsibility: () => false,
    execute: async () => { callback = true; throw new Error('A replacement callback must never enter') },
    reconcile: async () => { callback = true; throw new Error('A replacement reconciliation must never enter') } }
  for (const [name, selected] of [['missing', []], ['changed', [replacement]]] as const) {
    const scope = new Context()
    try {
      assert.throws(() => new SimulationWorldDriver(run, connection, resolved, anchor, new AbortController().signal, scope, selected),
        { code: name === 'missing' ? 'SIM_WORLD_DOMAIN_UNKNOWN' : 'SIM_WORLD_IMPLEMENTATION_MISMATCH' })
    } finally { await scope.fiber.dispose() }
    assert.deepEqual(run.snapshot(), before)
  }
  assert.equal(callback, false)
  await driver.reconcile()
  const state = run.snapshot()
  assert.equal(state.phase, 'paused'); assert.equal(input.models(), 0)
  assert.equal(activeSimulationMaintenance(state), undefined)
  assert.deepEqual(state.world!.reservations, held.snapshot.world!.reservations)
  assert.deepEqual(state.world!.results, held.snapshot.world!.results)
  assert.deepEqual(state.world!.plans, held.snapshot.world!.plans)
  assert.deepEqual(state.relations, held.snapshot.relations)
  assert.deepEqual(state.resources, held.snapshot.resources)
  assert.deepEqual(state.resourceReservations, held.snapshot.resourceReservations)
  for (const reservation of Object.values(state.world!.reservations)) {
    const entity = reservation.identities.entityId
    assert.deepEqual(state.entities[entity]?.profile, held.snapshot.entities[entity]?.profile)
    assert.deepEqual(state.entities[entity]?.binding, held.snapshot.entities[entity]?.binding)
  }
  assert.ok(Object.values(state.world!.executions).every(value => value.phase === 'settled'))
  await recordR06Cut(ctx, run, selection, 'final')
  await input.scope.fiber.dispose()
  console.log(JSON.stringify({ phase: state.phase, modelCalls: input.models(), originalRetiredExecutor: true,
    originalMaintenanceReconciled: true, wrongBindingsRejected: 2, sameIdentities: true, samePersona: true }))
}
