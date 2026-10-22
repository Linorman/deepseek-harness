/** Real Native queue collisions retain original scheduling responsibility without hiding unrelated IO errors. */
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { SimulationRevisionConflictError, simulationRunSelectionSchema, simulationCheckpointIdSchema,
  simulationWakeRequestSchema, simulationDecisionIdSchema, simulationWindowIdSchema, simTimeSchema, simulationPhaseManagementRequestSchema } from '@clocky/clocky-simulation'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { sample, deployment } from '../../simulation-scenario/tests/v1-fixtures.ts'
import { simulationTemp } from '../../simulation-local/tests/temp.ts'
import { createContext } from '../../simulation-team/tests/harness.ts'
import { SimulationWorldDriver } from '../src/driver.ts'
import SimulationWorldExecutions from '../src/providers.ts'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture(backend: 'json' | 'sqlite') {
  const definition = structuredClone(sample); definition.behavior.initialGoals = []
  const compiled = await compileWorldScenarioV1(definition, deployment)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const root = await simulationTemp('driver-revision'), h = await createContext(root, backend)
  await h.ctx.plugin(SimulationWorldExecutions)
  await h.ctx.plugin(Direct)
  const run = await h.ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create',
    spec: { runId: 'driver-revision', ...compiled.resolved.native } }))
  const checkpointId = simulationCheckpointIdSchema.parse('original'), requestedOwnerName = 'driver-revision/original'
  await prepareSimulationWorld(h.ctx.simulationTeams, run, { resolved: compiled.resolved, ownerName: requestedOwnerName,
    checkpoint: { id: checkpointId, maxDrainRounds: 4, maxAttempts: 3 } })
  const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']
  if (typeof ownerName !== 'string') throw new Error('Original canonical preparation lost its owner')
  const connection = await h.ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName)
  const driver = new SimulationWorldDriver(run, connection, compiled.resolved, { checkpointId, ownerName,
    maxDrainRounds: 4, maxAttempts: 3 }, new AbortController().signal, h.ctx, h.ctx.simulationWorldExecutions.handlers({
    run: run,
    connection: connection,
    resolved: compiled.resolved,
    anchor: { checkpointId, ownerName,
      maxDrainRounds: 4, maxAttempts: 3 },
    lifetime: new AbortController().signal,
  }, []))
  cleanups.push(async () => { await driver.drain(); await connection.close(); await run.close(); await h.ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true }) })
  const actor = compiled.resolved.actors[0]!.entityId
  await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'retained-future-wake', entityId: actor,
    time: '1', reason: 'Original pending responsibility' }), run.snapshot().revision)
  await run.setPhase('running', run.snapshot().revision)
  const models = vi.spyOn(h.ctx.llm, 'stream')
  return { ...h, run, connection, driver, actor, models }
}
describe.each(['json', 'sqlite'] as const)('%s real optimistic driver admission', (backend) => {
  it('stops after resident IO observes a newer pause without nominating or allocating another decision', async () => {
    const h = await fixture(backend), before = h.run.snapshot(), drive = h.connection.driveResident.bind(h.connection)
    vi.spyOn(h.connection, 'driveResident').mockImplementationOnce(async (...args) => {
      const result = await drive(...args)
      await h.run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'pause-after-resident-io', phase: 'paused' }))
      return result
    })
    const reserve = vi.spyOn(h.run, 'reserveDecisionWindow'), nominate = vi.spyOn(h.run, 'queueDecision')
    expect(await h.driver.advance(simTimeSchema.parse('0'))).toMatchObject({ reason: 'paused' })
    expect(reserve).not.toHaveBeenCalled(); expect(nominate).not.toHaveBeenCalled()
    expect(h.run.snapshot().scheduledEvents).toEqual(before.scheduledEvents)
    expect(h.run.snapshot().decisionDispatch).toEqual(before.decisionDispatch)
    expect(h.run.snapshot().decisions).toEqual({}); expect(h.models).not.toHaveBeenCalled()
  })

  it('observes a recorded pause that wins queue admission and preserves the original future wake without opening a window', async () => {
    const h = await fixture(backend), before = h.run.snapshot(), reserve = h.run.reserveDecisionWindow.bind(h.run)
    const conflicts: SimulationRevisionConflictError[] = []
    vi.spyOn(h.run, 'reserveDecisionWindow').mockImplementationOnce(async (request, revision) => {
      await h.run.setPhase('paused', h.run.snapshot().revision)
      try { return await reserve(request, revision) }
      catch (error) { if (!(error instanceof SimulationRevisionConflictError)) throw error; conflicts.push(error); throw error }
    })
    expect(await h.driver.advance(simTimeSchema.parse('0'))).toMatchObject({ reason: 'paused' })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ code: 'SIM_REVISION_CONFLICT', expectedRevision: before.revision,
      actualRevision: h.run.snapshot().revision })
    expect(h.run.snapshot().scheduledEvents).toEqual(before.scheduledEvents)
    expect(h.run.snapshot().decisionDispatch).toEqual(before.decisionDispatch)
    expect(h.run.snapshot().decisions).toEqual({}); expect(h.run.snapshot().operations).toEqual({})
    expect(h.models).not.toHaveBeenCalled()
  })
  it('returns a bounded coordination retry when an unrelated recorded wake changes the running revision', async () => {
    const h = await fixture(backend), before = h.run.snapshot(), reserve = h.run.reserveDecisionWindow.bind(h.run)
    const spy = vi.spyOn(h.run, 'reserveDecisionWindow').mockImplementationOnce(async (request, revision) => {
      await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'concurrent-wake', entityId: h.actor,
        time: '2', reason: 'Independent accepted scheduling change' }), h.run.snapshot().revision)
      return await reserve(request, revision)
    })
    expect(await h.driver.advance(simTimeSchema.parse('0'))).toMatchObject({ reason: 'coordination-limit' })
    spy.mockRestore()
    expect(await h.driver.advance(simTimeSchema.parse('0'))).toMatchObject({ reason: 'until' })
    expect(Object.values(h.run.snapshot().scheduledEvents).filter(value => value.status === 'pending')).toHaveLength(2)
    expect(h.run.snapshot().scheduledEvents[Object.values(before.scheduledEvents)[0]!.id]).toEqual(Object.values(before.scheduledEvents)[0])
    expect(h.models).not.toHaveBeenCalled()
  })
  it('propagates an unrelated failure even when another owner has recorded pause', async () => {
    const h = await fixture(backend)
    vi.spyOn(h.connection, 'driveResident').mockImplementationOnce(async () => {
      await h.run.setPhase('paused', h.run.snapshot().revision)
      throw new Error('Unrelated original provider IO failure')
    })
    await expect(h.driver.advance(simTimeSchema.parse('0'))).rejects.toThrow('Unrelated original provider IO failure')
    expect(h.models).not.toHaveBeenCalled()
  })
})


it.each(['submitted', 'cancelled', 'accepted'] as const)('continues a retained %s window without redispatching its model input', async (status) => {
  const h = await fixture('sqlite'), original = h.run.snapshot()
  const id = simulationDecisionIdSchema.parse('world/1/retained'), windowId = simulationWindowIdSchema.parse('world/1/retained-window')
  // Only the retained status is read before commit; Native acceptance and rejection are covered by message-rejection.spec.ts.
  vi.spyOn(h.run, 'snapshot').mockReturnValue({ ...original, activeWindowId: windowId,
    decisions: { ...original.decisions, [id]: { id, entityId: h.actor, status } as never } })
  const commit = vi.spyOn(h.run, 'commitWindow').mockResolvedValue({} as never)
  const dispatch = vi.spyOn(h.connection, 'executeDecision').mockRejectedValue(new Error('Retained input must not dispatch'))
  await (h.driver as unknown as { execute(decisionId: typeof id, actorId: typeof h.actor): Promise<void> }).execute(id, h.actor)
  expect(commit).toHaveBeenCalledExactlyOnceWith(windowId)
  expect(dispatch).not.toHaveBeenCalled()
  expect(h.models).not.toHaveBeenCalled()
})
