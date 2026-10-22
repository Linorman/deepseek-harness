/** Actual bounded World driving pays the original hire once while preserving canonical identities across cold processes. */
import assert from 'node:assert/strict'
import { verifyCheckpointWorldCoverage } from './checkpoint-world-coverage.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { SimulationWorldDriver, OrganizationWorldExecution, ExistingHireWorldExecution } from '@clocky/clocky-simulation-world'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationEntityIdSchema, simulationWorldSubmissionHash } from '@clocky/clocky-simulation'
import type { SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { hiringDefinition, hiringCatalog } from './fixtures/hiring-resources/source.ts'
import { hiringModelRequests } from './fixtures/hiring-resources/model.ts'
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_CALENDAR_TIME_RECOVER === 'true'
const round = process.env.WORLD_CALENDAR_TIME_ROUND!, face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local'].map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(face === 'lib' ? '/lib/' : '/src/'), path)
if (face === 'lib') { assert.deepEqual(process.execArgv, []); assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false) }
const ctx = await boot('hiring-resources', process.argv[2]!)
const compiled = await compileWorldScenarioV1(hiringDefinition, hiringCatalog, 'json', ctx.teams.getCreationLimits())
assert.ok(compiled.ok, JSON.stringify(compiled)); const resolved = compiled.resolved
const checkpointId = simulationCheckpointIdSchema.parse('hiring-resources-complete')
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: { runId: 'hiring-world', ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, { id: checkpointId, implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const mode = process.env.WORLD_HIRING_MODE!
assert.ok(mode === 'generate-and-hire' || mode === 'hire-existing')
const expectAuthorityDenied = process.env.WORLD_HIRING_POLICY_BOUNDARY === 'blocked'
const expectByteBlock = process.env.WORLD_HIRING_EXPECT_BYTE_BLOCK === 'true'
const acceptedBatches: Array<{ expectedRevision: number; bytes: number; values: unknown[] }> = []
const stream = Reflect.get(run, 'stream') as LogStream
const originalAppend = stream.append.bind(stream)
stream.append = async (expectedRevision, values, options) => {
  const result = await originalAppend(expectedRevision, values, options)
  acceptedBatches.push({ expectedRevision, bytes: Buffer.byteLength(JSON.stringify(values), 'utf8'), values: structuredClone([...values]) })
  return result
}
let connection = restored?.connection
let driver: SimulationWorldDriver | undefined
const lifetime = new AbortController()
async function journal() {
  const stream = Reflect.get(run, 'stream') as LogStream, rows = []; let after = -1
  while (after < stream.tailSequence) {
    const page = await stream.read(after, 128); assert.ok(page.length); rows.push(...page); after = page.at(-1)!.sequence
  }
  return rows
}
async function sessions() {
  return await Promise.all(Object.values(run.snapshot().entities).flatMap(entity => entity.binding === undefined ? [] : [(async () => {
    const binding = entity.binding!, unmaterialized = await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)
    return { entityId: entity.id, binding, unmaterialized,
      events: unmaterialized ? [] : (await ctx.sessionPersistence.readFrom(binding.sessionId, 0)).events }
  })()]))
}
try {
  if (!recovering) await prepareSimulationWorld(ctx.simulationTeams, run, { resolved, ownerName: 'hiring-world/original',
    checkpoint: { id: simulationCheckpointIdSchema.parse('hiring-resources-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']; assert.equal(typeof ownerName, 'string')
  connection ??= await ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName as string)
  if (!recovering) {
    await writeFile(resolve(root, 'input.json'), JSON.stringify({ resolved, hiringDefinition, hiringCatalog }, null, 2))
    assert.equal(run.snapshot().phase, 'paused'); assert.equal(hiringModelRequests.length, 0)
    const initial = run.snapshot(), candidate = initial.entities[simulationEntityIdSchema.parse('observer')]!
    await writeFile(resolve(root, 'initial.json'), JSON.stringify({ state: initial, sessions: await sessions(), journal: await journal() }, null, 2))
    const anchor = { checkpointId: simulationCheckpointIdSchema.parse('hiring-resources-initial'), ownerName: ownerName as string, maxDrainRounds: 4, maxAttempts: 3 }
    driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime.signal, ctx,
      ctx.simulationWorldExecutions.handlers({
        run: run,
        connection: connection,
        resolved: resolved,
        anchor: anchor,
        lifetime: lifetime.signal,
      }, [mode === 'hire-existing' ? new ExistingHireWorldExecution(run)
        : new OrganizationWorldExecution(run, connection, resolved, anchor, lifetime.signal)]))
    await run.setPhase('running', run.snapshot().revision)
    const steps = []
    for (let index = 0; index < 128; index += 1) {
      const step: SimulationWorldDriveResult = await driver.advance(); steps.push(step)
      await writeFile(resolve(root, 'progress.json'), JSON.stringify({ state: run.snapshot(), steps, modelRequests: hiringModelRequests }, null, 2))
      if (step.reason === 'idle' || expectByteBlock && step.reason === 'world-byte-limit') break
      assert.equal(['authority-missing', 'position-capacity', 'plan-stale', 'resource-capacity', 'resource-history-limit',
        'resource-reservation-expired', 'recovery-required', 'maintenance-blocked'].includes(step.reason), false, JSON.stringify(step))
    }
    const state = run.snapshot()
    if (expectAuthorityDenied) {
      assert.equal(Object.keys(state.world!.requests).length, 0)
      assert.equal(Object.keys(state.world!.intents).length, 0)
      assert.equal(Object.keys(state.world!.plans).length, 0)
      assert.equal(Object.keys(state.world!.results).length, 0)
      assert.equal(Object.keys(state.resourceReservations).length, 0)
      assert.deepEqual(Object.values(state.resources).map(value => value.quantity), ['10', '0'])
      assert.equal(Object.values(state.operations).some(value => value.action.kind.startsWith('world/')), false)
      assert.equal(hiringModelRequests.filter(value => value.purpose === 'goal').length, 5)
      const actors = await sessions(), requesterId = resolved.definition.organization.assignments[0]!.personId
      const requesterSession = actors.find(value => value.entityId === requesterId)
      assert.ok(requesterSession)
      assert.equal(JSON.stringify(requesterSession.events).includes('PRIVATE-REQUEST-POLICY-CANARY'), false)
      assert.ok(JSON.stringify(requesterSession.events).includes('current authoritative policy'))
    } else if (expectByteBlock) {
      assert.equal(steps.at(-1)?.reason, 'world-byte-limit')
      assert.equal(state.phase, 'stalled')
      assert.equal(Object.keys(state.world!.requests).length, 0)
      assert.equal(Object.keys(state.operations).length, 0)
      assert.equal(Object.keys(state.resourceReservations).length, 0)
      assert.equal(Object.keys(state.world!.results).length, 0)
      assert.deepEqual(Object.values(state.resources).map(value => value.quantity), ['10', '0'])
      const blocked = Object.values(state.decisions).filter(value => value.worldSubmissionBlock !== undefined)
      assert.equal(blocked.length, 1)
      assert.deepEqual(blocked[0]!.worldSubmissionBlock!.failure, { code: 'SIM_WORLD_LIMIT', limit: 'bytes' })
      const decision = blocked[0]!
      assert.ok(decision.context?.status === 'prepared')
      assert.ok(decision.submission !== undefined)
      assert.equal(simulationWorldSubmissionHash(decision.submission), decision.worldSubmissionBlock!.proposalHash)
      const originalSession = (await sessions()).find(value => value.entityId === decision.entityId)
      assert.ok(originalSession)
      assert.ok(originalSession.events.some(event => event.type === 'simulation/context-view'
        && JSON.stringify(event.data) === JSON.stringify(decision.context!.status === 'prepared' ? decision.context!.view : null)))
      assert.ok(JSON.stringify(originalSession.events).includes('simulation_submit'))
      assert.equal(hiringModelRequests.length, 3)
      await writeFile(resolve(root, 'blocked.json'), JSON.stringify({ state, sessions: await sessions(),
        modelRequests: hiringModelRequests, steps, acceptedBatches }, null, 2))
    } else {
      const hold = Object.values(state.resourceReservations)[0]!
      assert.equal(hold.phase, 'committed'); assert.equal(hold.world!.fee.quantity, '3')
      assert.deepEqual(Object.values(state.resources).map(value => value.quantity), ['7', '3'])
      assert.equal(Object.values(state.world!.requests).length, 1)
      assert.equal(Object.values(state.world!.results).length, 1)
      assert.equal(Object.values(state.world!.results)[0]!.outcome.kind, 'committed')
      if (process.env.WORLD_HIRING_EVIDENCE === 'true') {
        const questions = Object.values(state.world!.evidence.challenges), revisions = Object.values(state.world!.evidence.revisions)
        assert.equal(questions.length, 1); assert.equal(revisions.length, 1)
        const question = questions[0]!, revision = revisions[0]!, request = Object.values(state.world!.requests)[0]!
        assert.equal(question.status, 'answered'); assert.equal(question.responseRevisionId, revision.id)
        assert.equal(revision.revision, 1); assert.equal(revision.requestId, request.id); assert.equal(request.plans.length, 2)
        assert.equal(state.operations[question.notificationOperationId]!.delivery?.receipt !== undefined, true)
        assert.equal(state.operations[revision.notificationOperationId]!.delivery?.receipt !== undefined, true)
        const answer = state.decisions[revision.source.decisionId]!
        assert.equal(answer.consumption?.notification?.operationId, question.notificationOperationId)
        const final = state.world!.plans[request.plans[1]!]!
        assert.ok(final.operationId !== null)
        const decision = state.decisions[state.operations[final.operationId]!.decisionId]!
        assert.equal(decision.consumption?.notification?.operationId, revision.notificationOperationId)
        assert.equal(final.proposal.supersedes, question.planId)
        assert.ok(JSON.stringify(decision.context).includes(revision.answers[0]!.text))
        assert.equal(hiringModelRequests.filter(value => value.purpose === 'evidence').length, 3)
        assert.equal(hiringModelRequests.filter(value => value.purpose === 'resolve').length, 6)
      }
      if (mode === 'hire-existing') {
        const original = state.entities[candidate.id]!
        assert.equal(original.id, candidate.id); assert.equal(original.cognition, candidate.cognition)
        assert.deepEqual(original.profile, candidate.profile); assert.deepEqual(original.binding, candidate.binding)
      }
      else {
        const reservations = Object.values(state.world!.reservations)
        assert.equal(reservations.length, 1)
        assert.equal(reservations[0]!.reservedAt, '0')
        assert.equal(reservations[0]!.prepared?.time, '0')
      }
    }
    assert.equal(state.world!.definition.limits.maxBirthsPerInterval, mode === 'generate-and-hire' ? 1 : 0)
    assert.equal(state.world!.definition.limits.maxExternalExpansionsPerInterval, 0)
    await run.setPhase('paused', run.snapshot().revision)
    const done = await connection.checkpoint({ id: checkpointId, implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(done.status, 'completed')
    if (process.env.WORLD_CHECKPOINT_COVERAGE === 'true') await verifyCheckpointWorldCoverage(run, root)
    await writeFile(resolve(root, 'original.json'), JSON.stringify({ state: run.snapshot(), sessions: await sessions(), journal: await journal(),
      modelRequests: hiringModelRequests, steps, acceptedBatches }, null, 2))
  } else {
    const original = JSON.parse(await readFile(resolve(root, 'original.json'), 'utf8')) as {
      state: SimulationSnapshot
      sessions: Awaited<ReturnType<typeof sessions>>
      journal: Awaited<ReturnType<typeof journal>>
    }
    assert.deepEqual(run.snapshot(), original.state); assert.deepEqual(await sessions(), original.sessions)
    assert.deepEqual(await journal(), original.journal)
    assert.equal(run.snapshot().phase, 'paused'); assert.equal(hiringModelRequests.length, 0)
  }
  const output = { face, mode, backend: process.env.SIMULATION_COMPANY_BACKEND, pid: process.pid, round, phase: run.snapshot().phase,
    modelCalls: hiringModelRequests.length, conserved: true, actualFundedHire: !expectByteBlock && !expectAuthorityDenied,
    requestAuthorityDenied: expectAuthorityDenied,
    requestByteBlocked: expectByteBlock, evidenceExchange: process.env.WORLD_HIRING_EVIDENCE === 'true', runtimePaths }
  await writeFile(resolve(root, `round-${round}.json`), JSON.stringify({ ...output, state: run.snapshot(), sessions: await sessions(), journal: await journal() }, null, 2))
  process.stdout.write(JSON.stringify(output) + '\n')
} catch (error) { await writeFile(resolve(root, `failed-${round}.json`), JSON.stringify({ error: String(error), state: run.snapshot(),
  sessions: await sessions(), journal: await journal(), modelRequests: hiringModelRequests, acceptedBatches }, null, 2)); throw error }
finally { await driver?.drain(); await connection?.close(); await run.close(); await ctx.fiber.dispose() }
