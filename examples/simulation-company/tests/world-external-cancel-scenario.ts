import { assertUnknownReconcileOnly } from './world-reconcile-observation-proof.ts'
/** Company and laboratory prepare a real independent external actor and exchange canonical private Channel messages. */
import assert from 'node:assert/strict'
import { verifyCheckpointWorldCoverage } from './checkpoint-world-coverage.ts'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_ACTOR_PIN, simulationEntityIdSchema, simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationWorldCancelRequestSchema, activeSimulationMaintenance,
  simulationWorldHireReserveRequestSchema } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalActorWorldExecution } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-external-cancel-model.ts'
import { TeamError } from '@clocky/clocky-team'
import type { SimulationExternalRepresentativeReservation, SimulationWorldCancellation } from '@clocky/clocky-simulation'

const scenarioCase = process.env.WORLD_EXTERNAL_CANCEL ?? 'participant-io'
const cases = ['before-reserve', 'participant-io', 'channel-io', 'commit-wins', 'unknown-read', 'unknown-close',
  'crash-channel-io', 'crash-abandon-before-append', 'crash-abandon-after-append']
assert.ok(cases.includes(scenarioCase))
const scene = process.env.WORLD_SCENARIO ?? 'company', recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
assert.ok(['company', 'laboratory'].includes(scene))
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scene}.json`), 'utf8')))
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-external-cancel-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, requester = original.actors.find(value => value.role === 'member' && original.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
assert.ok(requester)
const requesterId = simulationEntityIdSchema.parse(requester.entityId)
const scope = original.world.organizationEntityId, subject = simulationEntityIdSchema.parse('external-supplier')
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [...original.world.operations, WORLD_EXTERNAL_ACTOR_PIN],
  operationGrants: [...original.world.operationGrants, { requesterEntityId: requester.entityId,
    domain: 'external', operation: 'interact', version: '2', scopeEntityId: scope, targetEntityId: subject,
    relationId: 'external-permission', relation: 'can-interact' }] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  entities: [...original.entities, { kind: 'entity/create', id: subject, entityKind: 'organization', cognition: 'none', readiness: 'ready',
    profile: { name: 'Independent Supplier', description: 'An external simulated supplier represented by its own actor.' } }],
  native: { ...original.native, relationRules: [...original.native.relationRules,
    { relation: 'can-interact', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false },
    { relation: 'represents', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
  relations: [...original.relations, { kind: 'relation/create', id: 'external-permission', subject: requester.entityId,
    relation: 'can-interact', object: subject, scope, validFrom: '0', validUntil: null }] }
const { definitionHash: _oldHash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), crash = scenarioCase.startsWith('crash-')
const unknownCold = scenarioCase.startsWith('unknown-'), finalCold = process.env.WORLD_CANCEL_FINAL === 'true'
const ctx = await boot('world-external-cancel', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `external-cancel-${scene}-${scenarioCase}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse(crash || unknownCold ? 'cancel-initial' : 'cancel-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
let releaseAcceptedIO: (() => void) | undefined
const core = () => ({ world: run.snapshot().world, resources: run.snapshot().resources, commitments: run.snapshot().commitments,
  relations: run.snapshot().relations, maintenance: run.snapshot().maintenance ?? null, entities: run.snapshot().entities })
async function executeScenario(): Promise<void> {
  try {
    const inputPath = resolve(root, 'cancel-input.json'), originalPath = resolve(root, 'cancel-original.json')
    if (!recovering) await writeFile(inputPath, JSON.stringify({ selection, resolved }))
    else assert.deepEqual(JSON.parse(await readFile(inputPath, 'utf8')), { selection: { ...selection, mode: 'create' }, resolved })
    const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
      ownerName: `external-cancel/${scene}/${scenarioCase}`, checkpoint: { id: simulationCheckpointIdSchema.parse('cancel-initial'),
        maxDrainRounds: 4, maxAttempts: 3 } })
    const team = run.snapshot().teamReservation!, owner = team.creation.rules['activationLifecycleOwner']
    assert.ok(typeof owner === 'string')
    const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, owner)
    const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id,
      ownerName: owner, maxDrainRounds: 4, maxAttempts: 3 }
    const lifetime = new AbortController().signal
    const adapter = new ExternalActorWorldExecution(run, connection, resolved, anchor, lifetime)
    const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime, ctx, ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: anchor,
      lifetime: lifetime,
    }, [adapter]))
    assert.equal((await driver.advance()).reason, 'paused')
    assert.equal(requests.length, 0)
    const representative = () => Object.values(run.snapshot().world!.external.representatives)[0]
    const cancellation = () => simulationWorldCancelRequestSchema.parse({ id: 'withdraw-original-representative',
      requestId: Object.values(run.snapshot().world!.requests)[0]!.id })
    const topology = async (reserved: SimulationExternalRepresentativeReservation | undefined = representative(), allowUnknown = false) => {
      const actual = await ctx.teams.getTeam({ teamId: team.teamId }), channels = []
      for (const selected of reserved?.identities.channels ?? []) {
        try { channels.push({ original: selected, observed: await ctx.teams.getChannelAdmission({ channelId: selected.channelId }) }) }
        catch (error: unknown) {
          if (error instanceof TeamError && error.code === 'TEAM_CHANNEL_NOT_FOUND') channels.push({ original: selected, observed: null })
          else if (allowUnknown) channels.push({ original: selected, observed: { status: 'unknown', message: String(error) } })
          else throw error
        }
      }
      return { team: actual, channels, sessionUnmaterialized: reserved === undefined ? null
        : await ctx.sessionPersistence.isUnmaterialized(reserved.identities.binding.sessionId) }
    }
    const journal = async () => {
      const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream, records = []
      let after = -1
      while (after < stream.tailSequence) {
        const entries = await stream.read(after, 128)
        assert.ok(entries.length)
        records.push(...entries); after = entries.at(-1)!.sequence
      }
      return records
    }
    const crashNow = async (boundary: string) => {
      await writeFile(resolve(root, 'cancel-crash-prefix.json'), JSON.stringify({ boundary, core: core(),
        topology: await topology(), requests, journal: await journal() }))
      process.send?.({ event: 'cancel-durable', boundary, modelCalls: requests.length })
      await new Promise<void>((done) => { process.once('message', () => { done() }) })
    }
    let originalReservation: SimulationExternalRepresentativeReservation | undefined
    let command: SimulationWorldCancellation | undefined, unknownEvidence: unknown, barrierEvidence: unknown
    let armUnknown: (() => void) | undefined
    let drainEvidence: unknown
    if (!recovering) {
      await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-stock', owner: subject,
        kind: 'inventory', unit: 'widget', quantity: '7', controllers: [] }), run.snapshot().revision)
      const assets = structuredClone(run.snapshot().resources)
      const acceptedIO = Promise.withResolvers<undefined>(), releaseIO = Promise.withResolvers<undefined>()
      releaseAcceptedIO = () => { releaseIO.resolve(undefined) }
      if (scenarioCase === 'before-reserve') {
        const reserve = run.reserveExternalRepresentative.bind(run)
        run.reserveExternalRepresentative = async (...args) => {
          command = await run.cancelWorldCase(cancellation())
          assert.equal(command.status, 'cancelled')
          await run.setPhase('paused', run.snapshot().revision)
          return await reserve(...args)
        }
      } else if (scenarioCase === 'commit-wins') {
        const commit = run.commitExternalRepresentative.bind(run)
        run.commitExternalRepresentative = async (...args) => {
          const result = await commit(...args)
          originalReservation = representative()!
          command = await run.cancelWorldCase(cancellation())
          assert.equal(command.status, 'already-committed')
          return result
        }
      } else {
        const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
        ctx.teams.inviteParticipant = async (...args) => {
          const actual = await invite(...args), selected = representative()
          if (selected?.identities.binding.participantId === actual.id && scenarioCase === 'participant-io') {
            originalReservation = selected; acceptedIO.resolve(undefined); await releaseIO.promise
          }
          return actual
        }
        const open = ctx.teams.openChannel.bind(ctx.teams)
        ctx.teams.openChannel = async (...args) => {
          const actual = await open(...args), selected = representative()
          if (selected?.identities.channels[0].channelId === actual.manifest.id) {
            originalReservation = selected; acceptedIO.resolve(undefined); await releaseIO.promise
          }
          return actual
        }
      }
      if (scenarioCase === 'unknown-read') {
        const read = ctx.teams.getChannelAdmission.bind(ctx.teams)
        let unknown = false
        ctx.teams.getChannelAdmission = async (...args) => {
          if (unknown && representative()?.status === 'cancel-requested'
            && representative()?.identities.channels[0].channelId === args[0].channelId) throw new Error('Original canonical Channel read is unknown')
          return await read(...args)
        }
        armUnknown = () => { unknown = true }
      }
      if (scenarioCase === 'unknown-close') {
        const close = ctx.teams.closeChannel.bind(ctx.teams)
        let unknown = false
        ctx.teams.closeChannel = async (...args) => {
          const actual = await close(...args)
          if (unknown && representative()?.identities.channels[0].channelId === args[0].channelId)
            throw new Error('Original canonical Channel close returned no usable receipt')
          return actual
        }
        armUnknown = () => { unknown = true }
      }
      if (scenarioCase === 'crash-abandon-before-append' || scenarioCase === 'crash-abandon-after-append') {
        const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream, append = stream.append.bind(stream)
        stream.append = async (...args) => {
          const cleanup = args[1].some(value => (value as { change?: { kind?: string } }).change?.kind === 'external/abandoned')
          if (cleanup && scenarioCase === 'crash-abandon-before-append') await crashNow('abandon-before-append')
          const receipt = await append(...args)
          if (cleanup && scenarioCase === 'crash-abandon-after-append') await crashNow('abandon-after-append')
          return receipt
        }
      }
      await run.setPhase('running', run.snapshot().revision)
      await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'external-cancel-goal', entityId: requesterId, time: '1',
        reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'first/vendor/widget' })) }), run.snapshot().revision)
      const work = driver.advance(), settled = Promise.allSettled([work])
      if (!['before-reserve', 'commit-wins'].includes(scenarioCase)) {
        await Promise.race([acceptedIO.promise, work.then(() => { throw new Error('Driver ended before the actual accepted IO boundary') })])
        command = await run.cancelWorldCase(cancellation())
        assert.equal(command.status, 'cancel-requested')
        const pending = representative()!
        assert.equal(pending.status, 'cancel-requested')
        assert.deepEqual(pending.identities, originalReservation!.identities)
        assert.equal(run.snapshot().entities[pending.identities.entityId]?.readiness, 'preparing')
        assert.equal(Object.keys(run.snapshot().world!.results).length, 0)
        assert.equal(await ctx.sessionPersistence.isUnmaterialized(pending.identities.binding.sessionId), true)
        barrierEvidence = { pending, topology: await topology(), resources: run.snapshot().resources, modelCalls: requests.length }
        if (scenarioCase === 'crash-channel-io') await crashNow('accepted-channel-io')
        let draining: Promise<import('@clocky/clocky-simulation').SimulationWorldResult> | undefined
        if (scenarioCase === 'participant-io') {
          let finished = false
          draining = run.settleExternalRepresentativeCancellation(pending.id).then((value) => { finished = true; return value })
          const drained = Promise.allSettled([draining])
          await new Promise<void>((done) => { setImmediate(done) })
          assert.equal(finished, false)
          assert.equal(Object.keys(run.snapshot().world!.results).length, 0)
          assert.equal(representative()!.status, 'cancel-requested')
          drainEvidence = { sourceOwner: owner, originalIdentities: pending.identities, pendingBeforeIOReceipt: true,
            modelCalls: requests.length, resultCount: 0 }
          releaseIO.resolve(undefined)
          const outcome = (await drained)[0]
          if (outcome.status !== 'fulfilled') throw outcome.reason
          assert.equal(outcome.value.outcome.kind, 'cancelled')
        }
        armUnknown?.()
        releaseIO.resolve(undefined)
      }
      const outcome = (await settled)[0]
      if (scenarioCase.startsWith('unknown-')) {
        assert.equal(outcome.status, 'rejected')
        const pending = representative()!
        assert.equal(pending.status, 'cancel-requested')
        assert.equal(Object.keys(run.snapshot().world!.results).length, 0)
        assert.ok(activeSimulationMaintenance(run.snapshot()))
        await assert.rejects(run.finishMaintenance(pending.request.maintenance), /retains|preparation|cleanup/)
        const revision = run.snapshot().revision, models = requests.length
        await assert.rejects(run.commitExternalRepresentative(pending.id))
        if (scenarioCase === 'unknown-read')
          await assert.rejects(run.settleExternalRepresentativeCancellation(pending.id), /unknown/)
        assert.equal(run.snapshot().revision, revision)
        assert.equal(requests.length, models)
        const pendingCore = core()
        unknownEvidence = { pending: pendingCore, actual: await topology(representative(), true), revision, modelCalls: models,
          unknownNeverInterpretedAsAbsence: true }
        await writeFile(resolve(root, 'cancel-pending.json'), JSON.stringify({ core: pendingCore, barrierEvidence, unknownEvidence,
          topology: await topology(representative(), true), originalReservation, journal: await journal(), requests }))
        await writeFile(resolve(root, 'cancel-held.json'), JSON.stringify({ originalReservation, barrierEvidence, unknownEvidence }))
        await writeFile(resolve(root, 'cancel-model-inputs.json'), JSON.stringify(requests))
        console.log(JSON.stringify({ scene, scenarioCase, phase: run.snapshot().phase, reservation: 'cancel-requested',
          outcome: 'pending', originalIdentities: true, originalAssets: true, exactRetry: true, pendingResultWakes: 0,
          unknownRetained: true, modelCalls: requests.length, restored: false }))
        return
      } else {
        if (outcome.status !== 'fulfilled') throw outcome.reason
        assert.equal(outcome.value.reason, 'paused')
      }
      if (activeSimulationMaintenance(run.snapshot()) !== undefined) assert.equal((await driver.reconcile()).reason, 'paused')
      assert.equal(requests.length, 6)
      assert.deepEqual(run.snapshot().resources, assets)
      assert.equal(failures.length, 0, failures.join('\n'))
      await writeFile(resolve(root, 'cancel-held.json'), JSON.stringify({ originalReservation, barrierEvidence, unknownEvidence, drainEvidence }))
    } else {
      assert.equal(run.snapshot().phase, 'paused')
      assert.equal(requests.length, 0)
      if (unknownCold && !finalCold) {
        const pending = representative()!
        assert.equal(pending.status, 'cancel-requested')
        const persisted = JSON.parse(await readFile(resolve(root, 'cancel-pending.json'), 'utf8')) as { core: unknown }
        assert.deepEqual(core(), persisted.core)
        const read = ctx.teams.getChannelAdmission.bind(ctx.teams)
        ctx.teams.getChannelAdmission = async (...args) => {
          if (args[0].channelId === pending.identities.channels[0].channelId)
            throw new Error('Original cleanup admission read remains unknown after cold restore')
          return await read(...args)
        }
        const revision = run.snapshot().revision, unchanged = core()
        await assert.rejects(driver.reconcile(), /remains unknown/)
        assert.equal(run.snapshot().revision, revision + 2)
        assertUnknownReconcileOnly(unchanged, core(), await journal(), revision, pending.request.planId)
        assert.equal(requests.length, 0)
        await writeFile(resolve(root, 'cancel-pending-cold.json'), JSON.stringify({ core: core(),
          topology: await topology(pending, true), journal: await journal(), request: cancellation() }))
        console.log(JSON.stringify({ scene, scenarioCase, phase: 'paused', reservation: 'cancel-requested', outcome: 'pending',
          originalIdentities: true, originalAssets: true, exactRetry: true, pendingResultWakes: 0, unknownRetained: true,
          modelCalls: 0, restored: true }))
        return
      }
      if (activeSimulationMaintenance(run.snapshot()) !== undefined) assert.equal((await driver.reconcile()).reason, 'paused')
    }
    const state = run.snapshot(), worldState = state.world!, selected = representative()
    const request = Object.values(worldState.requests)[0]!, result = Object.values(worldState.results)[0]!
    assert.equal(Object.keys(worldState.external.identities).length, 1)
    assert.equal(Object.keys(worldState.results).length, 1)
    assert.equal(state.phase, 'paused')
    assert.equal(activeSimulationMaintenance(state), undefined)
    if (scenarioCase === 'before-reserve') {
      assert.equal(selected, undefined)
      assert.equal(result.outcome.kind, 'cancelled')
      assert.equal(request.status, 'cancelled')
    } else {
      assert.ok(selected)
      if (!recovering) assert.deepEqual(selected.identities, originalReservation!.identities)
      const person = state.entities[selected.identities.entityId]!
      if (scenarioCase === 'commit-wins') {
        assert.equal(selected.status, 'committed')
        assert.equal(result.outcome.kind, 'committed')
        assert.equal(person.readiness, 'ready')
        assert.equal(state.relations[selected.identities.relationId]?.relation, 'represents')
        assert.equal((await run.cancelWorldCase(cancellation())).status, 'already-committed')
        await assert.rejects(run.settleExternalRepresentativeCancellation(selected.id))
      } else {
        assert.equal(selected.status, 'abandoned')
        assert.equal(result.outcome.kind, 'cancelled')
        assert.equal(person.readiness, 'abandoned')
        assert.equal(person.phase, 'terminated')
        assert.equal(state.relations[selected.identities.relationId], undefined)
        assert.ok(selected.cleanup)
        assert.equal(selected.cleanup.sequence, result.sequence)
        assert.equal(selected.cleanup.evidence.session, 'unmaterialized')
        assert.ok(['left', 'failed'].includes(selected.cleanup.evidence.participant))
        assert.equal((await connection.cancelWorldCase(cancellation())).status, 'cancelled')
        assert.deepEqual(await run.settleExternalRepresentativeCancellation(selected.id), result)
        const revision = run.snapshot().revision
        await assert.rejects(run.commitExternalRepresentative(selected.id))
        const wrong = simulationWorldHireReserveRequestSchema.parse({ ...selected.request,
          maintenance: { ...selected.request.maintenance, owner: 'foreign-owner' } })
        await assert.rejects(run.reserveExternalRepresentative(wrong))
        assert.equal(run.snapshot().revision, revision)
      }
      assert.equal(await ctx.sessionPersistence.isUnmaterialized(selected.identities.binding.sessionId), true)
      assert.equal(ctx.agents.get(selected.identities.binding.sessionId), undefined)
    }
    const wakes = Object.values(state.scheduledEvents).filter(value => value.id === `simulation-world-result:${result.id}`)
    assert.equal(wakes.length, 1)
    assert.equal(wakes[0]!.status, 'pending')
    assert.equal(state.entities[subject]?.cognition, 'none')
    const finalTopology = await topology(), proof = { core: core(), topology: finalTopology, resultWake: wakes[0], request, result }
    if (recovering && !unknownCold && (!crash || process.env.WORLD_CANCEL_FINAL === 'true')) assert.deepEqual(proof, JSON.parse(await readFile(originalPath, 'utf8')))
    else {
      if (!crash && !unknownCold) {
        assert.equal((await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('cancel-complete'),
          implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
        if (process.env.WORLD_CHECKPOINT_COVERAGE === 'true') await verifyCheckpointWorldCoverage(run, root)
      }
      await writeFile(originalPath, JSON.stringify({ ...proof, core: core(), topology: await topology() }))
      await writeFile(resolve(root, 'cancel-journal.json'), JSON.stringify(await journal()))
      if (!unknownCold) await writeFile(resolve(root, 'cancel-model-inputs.json'), JSON.stringify(requests))
    }
    const revision = run.snapshot().revision, models = requests.length
    assert.equal((await driver.advance()).reason, 'paused')
    assert.equal(run.snapshot().revision, revision)
    assert.equal(requests.length, models)
    console.log(JSON.stringify({ scene, scenarioCase, phase: run.snapshot().phase, reservation: selected?.status ?? 'absent',
      outcome: result.outcome.kind, originalIdentities: true, originalAssets: true, exactRetry: true, pendingResultWakes: 1,
      unknownRetained: scenarioCase.startsWith('unknown-'), modelCalls: requests.length, restored: recovering }))
  } catch (cause) {
    await writeFile(resolve(root, 'cancel-failure.json'), JSON.stringify({ failures, requests, core: core() }))
    throw cause
  } finally { releaseAcceptedIO?.(); await run.close(); await ctx.fiber.dispose() }
}
await executeScenario()
