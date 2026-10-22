/** A real funded hire commits before a canonical result post loses its Native acknowledgement; cold processes only query that original. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationDispatchOutcomeSchema,
  simulationOperationIdSchema, worldResultIdSchema, simulationEntityIdSchema, simulationResourceIdSchema } from '@clocky/clocky-simulation'
import { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import type { LogStream } from '@clocky/clocky-storage'
import { hiringDefinition, hiringCatalog } from './fixtures/hiring-resources/source.ts'
import { hiringModelRequests as requests } from './fixtures/hiring-resources/model.ts'
import { recordR06Cut } from './world-r06-observation.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), round = Number(process.env.WORLD_R06_ROUND)
assert.ok(round === 0 || round === 1 || round === 2)
const mode = process.env.WORLD_HIRING_MODE
assert.ok(mode === 'generate-and-hire' || mode === 'hire-existing')
const ctx = await boot('r06-funded-hire', process.argv[2]!)
const compiled = await compileWorldScenarioV1(hiringDefinition, hiringCatalog, 'json', ctx.teams.getCreationLimits())
assert.ok(compiled.ok, JSON.stringify(compiled))
const resolved = compiled.resolved, initialCheckpoint = simulationCheckpointIdSchema.parse('r06-funded-initial')
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: round === 0 ? 'create' : 'open',
  spec: { runId: `r06-funded-${mode}`, ...resolved.native } })
const restored = round === 0 ? undefined : await ctx.simulationTeams.restore(selection, {
  id: initialCheckpoint, implementationVersion: 'world/1', maxAttempts: 3 })
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  if (round === 0) await prepareSimulationWorld(ctx.simulationTeams, run, { resolved, ownerName: `r06-funded/${mode}`,
    checkpoint: { id: initialCheckpoint, maxDrainRounds: 4, maxAttempts: 3 } })
  const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']
  assert.equal(typeof ownerName, 'string')
  const connection = restored?.connection
    ?? await ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName as string)
  const anchor = { checkpointId: initialCheckpoint, ownerName: ownerName as string, maxDrainRounds: 4, maxAttempts: 3 }
  const lifetime = new AbortController()
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime.signal, ctx,
    ctx.simulationWorldExecutions.handlers({ run, connection, resolved, anchor, lifetime: lifetime.signal }))
  const proofPath = resolve(root, 'funded-notification-proof.json')
  if (round === 0) {
    await writeFile(resolve(root, 'funded-initial.json'), JSON.stringify(run.snapshot(), null, 2) + '\n')
    const stream = Reflect.get(run, 'stream') as LogStream, append = stream.append.bind(stream)
    const shape = z.object({ kind: z.string(), change: z.object({ kind: z.string().optional(), id: z.string().optional(),
      outcome: z.unknown().optional() }).loose().optional() }).loose()
    let reached = false
    stream.append = async (...args) => {
      for (const raw of args[1]) {
        const value = shape.parse(raw)
        if (value.kind !== 'run/outbox' || value.change?.kind !== 'outbox/finished' || value.change.id === undefined) continue
        const outcome = simulationDispatchOutcomeSchema.safeParse(value.change.outcome)
        if (!outcome.success || outcome.data.status !== 'applied') continue
        const operationId = simulationOperationIdSchema.parse(value.change.id), operation = run.snapshot().operations[operationId]
        if (operation?.action.kind !== 'communication/post') continue
        let body: unknown
        try { body = JSON.parse(operation.action.text) }
        catch { continue /* Actual ordinary Channel prose is not a structured result notification. */ }
        const notice = z.object({ resultId: worldResultIdSchema }).safeParse(body)
        if (!notice.success) continue
        const result = run.snapshot().world!.results[notice.data.resultId]
        const plan = result?.source.kind === 'plan' ? run.snapshot().world!.plans[result.source.planId] : undefined
        if (plan?.pin.operation !== mode) continue
        assert.equal(reached, false); reached = true
        assert.equal(result?.outcome.kind, 'committed')
        assert.equal(Object.values(run.snapshot().resourceReservations).filter(value => value.phase === 'committed').length, 1)
        await writeFile(proofPath, JSON.stringify({ operationId, outcome: outcome.data, result, plan,
          request: run.snapshot().world!.requests[plan.requestId], before: run.snapshot() }, null, 2) + '\n')
        await recordR06Cut(ctx, run, selection, 'barrier')
        process.send?.('durable')
        await new Promise<void>((done) => { process.once('message', () => { done() }) })
      }
      return await append(...args)
    }
    await run.setPhase('running', run.snapshot().revision)
    for (let i = 0; i < 32; i++) {
      const result = await driver.advance()
      if (result.reason === 'work-limit') continue
      throw new Error(`Actual funded result-post barrier was not reached: ${JSON.stringify(result)}`)
    }
    throw new Error('Funded hiring exhausted its original bounded driver batches')
  }
  const proof = z.object({ operationId: simulationOperationIdSchema, outcome: simulationDispatchOutcomeSchema,
    result: z.json(), plan: z.json(), request: z.json(), before: z.json() }).parse(JSON.parse(await readFile(proofPath, 'utf8')))
  assert.equal(run.snapshot().phase, 'paused'); assert.equal(requests.length, 0)
  const original = run.snapshot(), world = original.world!
  assert.equal(Object.values(world.results).length, 1)
  assert.deepEqual(Object.values(world.results)[0], proof.result)
  assert.deepEqual(Object.values(world.plans)[0], proof.plan)
  assert.equal(Object.values(original.resourceReservations).length, 1)
  const hold = Object.values(original.resourceReservations)[0]!
  assert.equal(hold.phase, 'committed'); assert.equal(hold.world!.fee.quantity, '3')
  assert.equal(original.resources[simulationResourceIdSchema.parse('fee-cash')]?.quantity, '7')
  assert.equal(original.resources[simulationResourceIdSchema.parse('fee-payee')]?.quantity, '3')
  if (mode === 'hire-existing') {
    const initial = JSON.parse(await readFile(resolve(root, 'funded-initial.json'), 'utf8')) as ReturnType<typeof run.snapshot>
    const candidate = simulationEntityIdSchema.parse('observer')
    assert.deepEqual(original.entities[candidate]?.binding, initial.entities[candidate]?.binding)
    assert.deepEqual(original.entities[candidate]?.profile, initial.entities[candidate]?.profile)
  }
  if (round === 1) {
    assert.ok(proof.outcome.status === 'applied' && 'receipt' in proof.outcome)
    await run.setPhase('running', run.snapshot().revision)
    assert.equal((await connection.dispatchOperation(proof.operationId, Date.now)).status, 'settled')
    await run.setPhase('paused', run.snapshot().revision)
    assert.deepEqual(run.snapshot().operations[proof.operationId]?.outbox?.receipt, proof.outcome.receipt)
  }
  assert.deepEqual(run.snapshot().resources, original.resources)
  assert.deepEqual(run.snapshot().resourceReservations, original.resourceReservations)
  assert.deepEqual(run.snapshot().relations, original.relations)
  assert.deepEqual(run.snapshot().world, world)
  assert.equal(requests.length, 0)
  if (round === 2) {
    const previous = JSON.parse(await readFile(resolve(root, 'r06-final-1.json'), 'utf8')) as { snapshot: ReturnType<typeof run.snapshot> }
    assert.deepEqual(run.snapshot().world, previous.snapshot.world)
    assert.deepEqual(run.snapshot().resourceReservations, previous.snapshot.resourceReservations)
    assert.deepEqual(run.snapshot().resources, previous.snapshot.resources)
    assert.deepEqual(run.snapshot().relations, previous.snapshot.relations)
    assert.deepEqual(run.snapshot().operations, previous.snapshot.operations)
  }
  await recordR06Cut(ctx, run, selection, 'final')
  console.log(JSON.stringify({ mode, round, phase: 'paused', modelCalls: requests.length, actualFee: '3',
    originalFundedResult: true, originalNotificationReceipt: true, noDuplicateDebit: true }))
  await driver.drain(); await connection.close()
} finally { await run.close(); await ctx.fiber.dispose() }
