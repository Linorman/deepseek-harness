/** Real Loader admission proof with no maintenance barrier masking an unready person. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { activationIdSchema, activationReservationIdSchema, taskAttemptIdSchema } from '@clocky/clocky-team'
import { simulationChangeSchema, simulationEntityIdSchema, simulationRunSelectionSchema,
  simulationCheckpointIdSchema, simulationDecisionIdSchema, simulationProposalSchema,
  simulationTaskExecutionRequestSchema, simulationWakeRequestSchema } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema, scenarioCatalogSchema } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'

const scenario = z.enum(['company', 'laboratory']).parse(process.env.WORLD_SCENARIO)
const recovering = process.env.WORLD_PREPARING_RECOVER === 'true'
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
const inputPath = resolve(root, 'preparing-input.json'), proofPath = resolve(root, 'preparing-proof.json')
const inputSchema = z.strictObject({ definition: worldScenarioSchema, catalog: scenarioCatalogSchema, resolved: z.json() })
const ctx = await boot('world-preparing', process.argv[2]!)
let modelCalls = 0
ctx.on('llm/stream', (_request, next) => { modelCalls += 1; return next() })
try {
  if (!recovering) {
    const definition = worldScenarioSchema.parse(JSON.parse(await readFile(
      resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
    definition.initialEvents = []
    const installed = catalog()
    installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
    const compiled = await compileWorldScenario(definition, installed)
    assert.ok(compiled.ok)
    await writeFile(inputPath, JSON.stringify({ definition, catalog: installed, resolved: compiled.resolved }))
  }
  const original = inputSchema.parse(JSON.parse(await readFile(inputPath, 'utf8')))
  const compiled = await compileWorldScenario(original.definition, original.catalog)
  assert.ok(compiled.ok)
  assert.deepEqual(compiled.resolved, original.resolved)
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
    spec: { runId: `world-preparing-${scenario}`, ...compiled.resolved.native } })
  const checkpointId = simulationCheckpointIdSchema.parse('preparing-original')
  const restored = recovering ? await ctx.simulationTeams.restore(selection,
    { id: checkpointId, implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
  const run = restored?.run ?? await ctx.simulations.open(selection)
  try {
    const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run,
      { resolved: compiled.resolved, ownerName: `world-preparing/${scenario}`,
        checkpoint: { id: simulationCheckpointIdSchema.parse('world-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
    const retained = run.snapshot().teamReservation
    assert.ok(retained)
    const ownerName = retained.creation.rules['activationLifecycleOwner']
    assert.equal(typeof ownerName, 'string')
    if (typeof ownerName !== 'string') throw new Error('Missing original lifecycle owner')
    const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, retained.teamId, ownerName)
    const id = simulationEntityIdSchema.parse('unready-person')
    if (!recovering) {
      await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent',
        readiness: 'preparing', profile: { name: 'Unready person', readiness: 'ready', role: 'director' } }), run.snapshot().revision)
      await connection.ensureParticipant(id, { displayName: 'Unready person', role: 'member', capabilities: [],
        provider: 'in-process', preset: 'simulation', model: 'world-driver-scripted/scripted' })
      const requester = simulationEntityIdSchema.parse(compiled.resolved.actors.find(value => value.role === 'member')!.entityId)
      const lease = await connection.activate(requester, { provider: 'in-process', seed: { kind: 'fresh' },
        agent: { preset: 'simulation', options: { provider: 'world-driver-scripted', model: 'scripted' } }, signal: new AbortController().signal })
      await run.setPhase('running', run.snapshot().revision)
      const decisionId = simulationDecisionIdSchema.parse('original-task-source')
      await connection.openDecision(requester, decisionId)
      const decision = await connection.submitDecision(requester, decisionId, [simulationProposalSchema.parse({ after: [], action: {
        kind: 'task/create', deliverAt: '0', task: { subject: 'Pending work', description: 'Requires a ready independent executor',
          blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
          reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 2 },
      } })])
      assert.equal(decision.status, 'accepted')
      const operationId = decision.operationIds[0]!
      assert.equal((await run.drive({ until: run.snapshot().time })).reason, 'dispatch-required')
      assert.equal((await connection.dispatchOperation(operationId, Date.now)).status, 'settled')
      await lease.dispose()
      await run.setPhase('paused', run.snapshot().revision)
    }
    const entity = run.snapshot().entities[id]!
    assert.equal(entity.readiness, 'preparing')
    assert.equal(entity.phase, 'active')
    assert.equal(entity.writer, undefined)
    assert.ok(entity.binding)
    assert.equal(run.snapshot().phase, 'paused')
    assert.equal(Object.values(run.snapshot().maintenance ?? {}).length, 0)
    const binding = entity.binding
    const source = Object.values(run.snapshot().operations).find(value => value.action.kind === 'task/create')!
    const receipt = source.outbox!.taskReceipt!
    assert.equal(source.result?.status, 'applied')
    const task = await ctx.teams.getTask({ teamId: receipt.teamId, taskId: receipt.taskId })
    assert.equal(task.phase, 'pending')
    assert.equal(task.attemptCount, 0)
    const proof = { entity, source, task }
    if (recovering) assert.deepEqual(proof, JSON.parse(await readFile(proofPath, 'utf8')))
    const placement = { provider: 'in-process', agent: { preset: 'simulation',
      options: { provider: 'world-driver-scripted', model: 'scripted' } }, signal: new AbortController().signal }
    const activationId = activationIdSchema.parse('never-admitted')
    const reservationId = activationReservationIdSchema.parse('never-admitted')
    const denied = async () => {
      const before = run.snapshot(), teamBefore = await ctx.teams.getTeam({ teamId: binding.teamId })
      assert.equal(teamBefore.participants.find(value => value.id === binding.participantId)?.phase, 'active')
      await assert.rejects(run.reserveWriter(id, 'in-process', reservationId, before.revision), /ready entity/)
      await assert.rejects(run.queueDecision({ id: simulationDecisionIdSchema.parse('never-admitted'), entityId: id, priority: 0 }),
        /current|active|eligible|nomination|ready/)
      await assert.rejects(connection.openDecision(id, simulationDecisionIdSchema.parse('never-admitted')), /ready entity/)
      await assert.rejects(connection.submitDecision(id, simulationDecisionIdSchema.parse('never-admitted'), []), /ready entity/)
      await assert.rejects(run.reserveTaskExecution(simulationTaskExecutionRequestSchema.parse({ ...binding,
        runId: before.spec.runId, operationId: source.id, taskId: receipt.taskId, taskRevision: task.revision,
        attemptId: 'never-admitted', ordinal: 1, entityId: id, activationId, reservationId, epoch: '1', leaseDurationMs: 60000 }),
      run.snapshot().revision), /current accepted source and writer/)
      await assert.rejects(connection.assignTask({ operationId: source.id, entityId: id,
        attemptId: taskAttemptIdSchema.parse('never-admitted'), leaseDurationMs: 60000 }), /ready|resident|writer|actor/)
      for (const kind of ['fresh', 'resume'] as const) {
        await assert.rejects(connection.activate(id, { ...placement, seed: { kind } }), /ready entity/)
        await assert.rejects(ctx.teamActivations.activate({ ...placement, ...binding, seed: { kind },
          expectedCursor: (await ctx.teams.getTeam({ teamId: binding.teamId })).team.cursor }), /ready entity/)
      }
      await assert.rejects(ctx.teamActivations.coldReplace({ teamId: binding.teamId, participantId: binding.participantId,
        activationId, signal: placement.signal }), { code: 'TEAM_ACTIVATION_NOT_FOUND' })
      // The rejected controller startup owns a released reservation; recovery may settle only that receipt.
      await connection.recover(id)
      assert.deepEqual(run.snapshot(), before)
      const after = await ctx.teams.getTeam({ teamId: binding.teamId })
      assert.deepEqual(after.activations, teamBefore.activations)
      assert.deepEqual(after.tasks, teamBefore.tasks)
      const member = after.participants.find(value => value.id === binding.participantId)!
      assert.equal(member.phase, 'active')
      assert.ok(member.activationReservation?.releasedAt !== undefined)
      assert.equal(await ctx.sessionPersistence.isUnmaterialized(binding.sessionId), true)
      assert.equal(ctx.agents.get(binding.sessionId), undefined)
    }
    await denied()
    const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id,
      ownerName, maxDrainRounds: 4, maxAttempts: 3 }
    const driver = new SimulationWorldDriver(run, connection, compiled.resolved, anchor,
      new AbortController().signal, ctx, ctx.simulationWorldExecutions.handlers({
        run: run,
        connection: connection,
        resolved: compiled.resolved,
        anchor: anchor,
        lifetime: new AbortController().signal,
      }, []))
    assert.equal((await driver.advance()).reason, 'paused')
    assert.equal(modelCalls, 0)
    // Running entry tests readiness directly; no active structural maintenance can hide an admission regression.
    await run.setPhase('running', run.snapshot().revision)
    await denied()
    if (!recovering) {
      const wake = simulationWakeRequestSchema.parse({ id: 'unready-ordinary-action', entityId: id, time: '0', reason: 'Act now' })
      await run.scheduleWake(wake, run.snapshot().revision)
      assert.equal((await driver.advance()).reason, 'idle')
      assert.equal(run.snapshot().wakes[wake.id]?.status, 'cancelled')
      assert.equal(run.snapshot().wakes[wake.id]?.cancellation, 'Entity unavailable')
    } else {
      const before = run.snapshot().revision
      assert.equal((await driver.advance()).reason, 'idle')
      assert.equal(run.snapshot().revision, before)
      assert.equal(run.snapshot().wakes[simulationWakeRequestSchema.parse({ id: 'unready-ordinary-action', entityId: id,
        time: '0', reason: 'Act now' }).id]?.status, 'cancelled')
    }
    assert.equal(Object.values(run.snapshot().decisions).some(value => value.entityId === id), false)
    assert.equal(Object.values(run.snapshot().taskExecutions ?? {}).some(value => value.request.entityId === id), false)
    assert.equal((await ctx.teams.getTeam({ teamId: binding.teamId })).activations.some(value =>
      value.activation.participantId === binding.participantId), false)
    assert.deepEqual(run.snapshot().entities[id], entity)
    assert.equal(modelCalls, 0)
    await run.setPhase('paused', run.snapshot().revision)
    if (!recovering) {
      assert.equal((await connection.checkpoint({ id: checkpointId, implementationVersion: 'world/1',
        maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
      await writeFile(proofPath, JSON.stringify(proof))
    }
    await driver.drain()
    console.log(JSON.stringify({ scenario, restored: recovering, readiness: 'preparing', maintenance: 0,
      ordinaryDecisions: 0, taskAttempts: 0, activations: 0, writer: false, sessionMaterialized: false,
      driverWake: 'cancelled', taskSource: 'applied', identityPreserved: true, phase: 'paused', modelCalls }))
  } finally { await run.close() }
} finally { await ctx.fiber.dispose() }
