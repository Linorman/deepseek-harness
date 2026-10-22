import { assertUnknownReconcileOnly } from './world-reconcile-observation-proof.ts'
/** Original contact cleanup preserves the shared representative and releases only its unleased caller Channel. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_ACTOR_PIN, simulationEntityIdSchema, simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationWorldCancelRequestSchema, activeSimulationMaintenance } from '@clocky/clocky-simulation'
import type { SimulationExternalContact } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalActorWorldExecution } from '@clocky/clocky-simulation-world'
import { TeamError } from '@clocky/clocky-team'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-external-contact-model.ts'

const scenarioCase = process.env.WORLD_EXTERNAL_CONTACT ?? 'channel-io'
assert.ok(['retained-keeper', 'channel-io', 'commit-wins', 'unknown-read', 'unknown-close',
  'crash-channel-io', 'crash-cleanup-before-append', 'crash-cleanup-after-append'].includes(scenarioCase))
const scene = process.env.WORLD_SCENARIO ?? 'company', recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
assert.ok(['company', 'laboratory'].includes(scene))
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scene}.json`), 'utf8')))
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-external-contact-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, first = original.actors.find(value => value.role === 'member' && original.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
assert.ok(first)
const second = original.actors.find(value => value.role === 'member' && value.entityId !== first.entityId)!
assert.ok(second)
const buyerIds = [simulationEntityIdSchema.parse(first.entityId), simulationEntityIdSchema.parse(second.entityId)]
const requesterId = buyerIds[scenarioCase === 'retained-keeper' ? 0 : 1]!
const scope = original.world.organizationEntityId, subject = simulationEntityIdSchema.parse('external-supplier')
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [...original.world.operations, WORLD_EXTERNAL_ACTOR_PIN],
  operationGrants: [...original.world.operationGrants, ...buyerIds.map((buyer, index) => ({ requesterEntityId: buyer,
    domain: 'external', operation: 'interact', version: '2', scopeEntityId: scope, targetEntityId: subject,
    relationId: `external-permission-${index}`, relation: 'can-interact' }))] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  entities: [...original.entities, { kind: 'entity/create', id: subject, entityKind: 'organization', cognition: 'none', readiness: 'ready',
    profile: { name: 'Independent Supplier', description: 'An external simulated supplier represented by its own actor.' } }],
  native: { ...original.native, relationRules: [...original.native.relationRules,
    { relation: 'can-interact', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false },
    { relation: 'represents', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
  relations: [...original.relations, { kind: 'relation/create', id: 'second-buyer-assignment', subject: second.entityId,
    relation: 'assignment', object: original.relations.find(value => value.relation === 'assignment' && value.subject === first.entityId)!.object,
    scope, validFrom: '0', validUntil: null }, ...buyerIds.map((buyer, index) => ({ kind: 'relation/create' as const,
    id: `external-permission-${index}`, subject: buyer, relation: 'can-interact', object: subject, scope, validFrom: '0' as const, validUntil: null }))] }
const { definitionHash: _oldHash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), crash = scenarioCase.startsWith('crash-')
const unknownCold = scenarioCase.startsWith('unknown-'), finalCold = process.env.WORLD_CONTACT_FINAL === 'true'
const ctx = await boot('world-external-contact', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `external-contact-${scene}-${scenarioCase}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse(crash || unknownCold ? 'contact-base' : 'contact-complete'),
  implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
let releaseAcceptedIO: (() => void) | undefined, drainDriver: (() => Promise<void>) | undefined
const core = () => ({ world: run.snapshot().world, resources: run.snapshot().resources, commitments: run.snapshot().commitments,
  relations: run.snapshot().relations, maintenance: run.snapshot().maintenance ?? null, entities: run.snapshot().entities })
async function executeScenario(): Promise<void> {
  try {
    const inputPath = resolve(root, 'contact-input.json'), originalPath = resolve(root, 'contact-original.json')
    if (!recovering) await writeFile(inputPath, JSON.stringify({ selection, resolved }))
    else assert.deepEqual(JSON.parse(await readFile(inputPath, 'utf8')), { selection: { ...selection, mode: 'create' }, resolved })
    const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
      ownerName: `external-contact/${scene}/${scenarioCase}`, checkpoint: { id: simulationCheckpointIdSchema.parse('contact-initial'),
        maxDrainRounds: 4, maxAttempts: 3 } })
    const team = run.snapshot().teamReservation!, owner = team.creation.rules['activationLifecycleOwner']
    assert.ok(typeof owner === 'string')
    const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, owner)
    const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id,
      ownerName: owner, maxDrainRounds: 4, maxAttempts: 3 }
    const lifetime = new AbortController().signal
    const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime, ctx,
      ctx.simulationWorldExecutions.handlers({
        run: run,
        connection: connection,
        resolved: resolved,
        anchor: anchor,
        lifetime: lifetime,
      }, [new ExternalActorWorldExecution(run, connection, resolved, anchor, lifetime)]))
    drainDriver = () => driver.drain()
    const representative = () => Object.values(run.snapshot().world!.external.representatives)[0]!
    const selected = () => Object.values(run.snapshot().world!.external.contacts).find(value =>
      run.snapshot().world!.requests[value.requestId]!.proposal.businessKey === 'cancel-contact')
    const cancellation = () => simulationWorldCancelRequestSchema.parse({ id: 'withdraw-contact', requestId: selected()!.requestId })
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
    const topology = async (contact: SimulationExternalContact | undefined = selected(), allowUnknown = false) => {
      let observed: unknown
      if (contact !== undefined) {
        try { observed = await ctx.teams.getChannelAdmission({ channelId: contact.channel.channelId }) }
        catch (error: unknown) {
          if (error instanceof TeamError && error.code === 'TEAM_CHANNEL_NOT_FOUND') observed = null
          else if (allowUnknown) observed = { status: 'unknown', message: String(error) }
          else throw error
        }
      }
      return { team: await ctx.teams.getTeam({ teamId: team.teamId }), channel: { original: contact?.channel, observed },
        session: await ctx.sessionPersistence.readFrom(representative().identities.binding.sessionId, 0) }
    }
    const stable = async () => {
      const current = run.snapshot(), rep = representative(), person = current.entities[rep.identities.entityId]!
      const firstContact = Object.values(current.world!.external.contacts).find(value => value.requesterEntityId === buyerIds[0])!
      const channel = await ctx.teams.getChannelAdmission({ channelId: firstContact.channel.channelId })
      const page = await ctx.teams.readChannelPage({ channelId: firstContact.channel.channelId, afterCursor: -1, limit: 128 })
      assert.equal(page.records.length, channel.channel.cursor + 1)
      return { representative: rep, identity: current.world!.external.identities[rep.identityId],
        person: { id: person.id, cognition: person.cognition, readiness: person.readiness, phase: person.phase,
          binding: person.binding, profile: person.profile }, relation: current.relations[rep.identities.relationId],
        resources: current.resources, commitments: current.commitments,
        session: await ctx.sessionPersistence.readFrom(rep.identities.binding.sessionId, 0),
        firstContact, firstChannel: { channel, records: page.records } }
    }
    const crashNow = async (boundary: string) => {
      await writeFile(resolve(root, 'contact-crash-prefix.json'), JSON.stringify({ boundary, core: core(),
        topology: await topology(), requests, journal: await journal() }))
      await writeFile(resolve(root, 'contact-model-inputs.json'), JSON.stringify(requests))
      process.send?.({ event: 'contact-durable', boundary, modelCalls: requests.length })
      await new Promise<void>((done) => { process.once('message', () => { done() }) })
    }
    assert.equal((await driver.advance()).reason, 'paused')
    assert.equal(requests.length, 0)
    let barrierEvidence: unknown, unknownEvidence: unknown, drainEvidence: unknown, originalContact: SimulationExternalContact | undefined
    if (!recovering) {
      await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-stock', owner: subject,
        kind: 'inventory', unit: 'widget', quantity: '7', controllers: [] }), run.snapshot().revision)
      await run.setPhase('running', run.snapshot().revision)
      await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'contact-first-goal', entityId: buyerIds[0], time: '1',
        reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'base-contact/vendor/base-widget' })) }), run.snapshot().revision)
      let outcome = await driver.advance()
      for (let round = 0; round < 16 && ['work-limit', 'plan-stale'].includes(outcome.reason); round++) outcome = await driver.advance()
      assert.equal(outcome.reason, 'idle', JSON.stringify({ outcome, failures }))
      assert.equal(Object.keys(run.snapshot().world!.results).length, 1)
      assert.equal(representative().status, 'committed')
      await run.setPhase('paused', run.snapshot().revision)
      assert.equal((await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('contact-base'),
        implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
      const baseline = await stable()
      await writeFile(resolve(root, 'contact-baseline.json'), JSON.stringify(baseline))
      const acceptedIO = Promise.withResolvers<undefined>(), releaseIO = Promise.withResolvers<undefined>()
      releaseAcceptedIO = () => { releaseIO.resolve(undefined) }
      let armUnknown: (() => void) | undefined
      if (scenarioCase === 'commit-wins' || scenarioCase === 'retained-keeper') {
        const commit = run.commitExternalContact.bind(run)
        run.commitExternalContact = async (...args) => {
          originalContact = selected()!
          if (scenarioCase === 'retained-keeper') {
            acceptedIO.resolve(undefined); await releaseIO.promise
            return await commit(...args)
          }
          const result = await commit(...args)
          assert.equal((await run.cancelWorldCase(cancellation())).status, 'already-committed')
          await run.setPhase('paused', run.snapshot().revision)
          return result
        }
      } else {
        const open = ctx.teams.openChannel.bind(ctx.teams)
        ctx.teams.openChannel = async (...args) => {
          const actual = await open(...args), contact = selected()
          if (contact?.channel.channelId === actual.manifest.id) {
            originalContact = contact; acceptedIO.resolve(undefined); await releaseIO.promise
          }
          return actual
        }
      }
      if (scenarioCase === 'unknown-read') {
        const read = ctx.teams.getChannelAdmission.bind(ctx.teams)
        let unknown = false
        ctx.teams.getChannelAdmission = async (...args) => {
          if (unknown && selected()?.status === 'cancel-requested' && selected()?.channel.channelId === args[0].channelId)
            throw new Error('Original contact Channel admission remains unknown')
          return await read(...args)
        }
        armUnknown = () => { unknown = true }
      }
      if (scenarioCase === 'unknown-close') {
        const close = ctx.teams.closeChannel.bind(ctx.teams)
        let unknown = false
        ctx.teams.closeChannel = async (...args) => {
          const actual = await close(...args)
          if (unknown && selected()?.channel.channelId === args[0].channelId)
            throw new Error('Original contact Channel close returned no usable receipt')
          return actual
        }
        armUnknown = () => { unknown = true }
      }
      if (scenarioCase.startsWith('crash-cleanup-')) {
        const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream, append = stream.append.bind(stream)
        stream.append = async (...args) => {
          const cleanup = args[1].some(value => (value as { change?: { kind?: string } }).change?.kind === 'external/contact-cancelled')
          if (cleanup && scenarioCase.endsWith('before-append')) await crashNow('cleanup-before-append')
          const receipt = await append(...args)
          if (cleanup && scenarioCase.endsWith('after-append')) await crashNow('cleanup-after-append')
          return receipt
        }
      }
      await run.setPhase('running', run.snapshot().revision)
      await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'contact-cancel-goal', entityId: requesterId,
        time: String(BigInt(run.snapshot().time) + 1n),
        reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'cancel-contact/vendor/cancel-widget' })) }), run.snapshot().revision)
      const work = driver.advance(), settled = Promise.allSettled([work])
      if (scenarioCase !== 'commit-wins') {
        await Promise.race([acceptedIO.promise, work.then(() => { throw new Error('Driver ended before original accepted contact IO') })])
        assert.equal((await run.cancelWorldCase(cancellation())).status, 'cancel-requested')
        assert.equal(selected()!.status, 'cancel-requested')
        assert.deepEqual(selected()!.channel, originalContact!.channel)
        assert.equal(Object.keys(run.snapshot().world!.results).length, 1)
        barrierEvidence = { contact: selected(), core: core(), topology: await topology(), modelCalls: requests.length }
        if (scenarioCase === 'crash-channel-io') await crashNow('accepted-channel-io')
        if (scenarioCase === 'channel-io') {
          let finished = false
          const draining = (async () => {
            await connection.quiesceForMaintenance(selected()!.cancellation!.maintenance, 4, 3, lifetime)
            const value = await run.settleExternalContactCancellation(selected()!.id)
            finished = true; return value
          })()
          const drained = Promise.allSettled([draining])
          await new Promise<void>((done) => { setImmediate(done) })
          assert.equal(finished, false)
          assert.equal(Object.keys(run.snapshot().world!.results).length, 1)
          drainEvidence = { sourceOwner: owner, originalContact: selected(), pendingBeforeIOReceipt: true, modelCalls: requests.length }
          releaseIO.resolve(undefined)
          const result = (await drained)[0]
          if (result.status !== 'fulfilled') throw result.reason
          assert.equal(result.value.outcome.kind, 'cancelled')
        }
        armUnknown?.(); releaseIO.resolve(undefined)
      }
      const result = (await settled)[0]
      if (unknownCold) {
        assert.equal(result.status, 'rejected')
        assert.equal(selected()!.status, 'cancel-requested')
        assert.equal(Object.keys(run.snapshot().world!.results).length, 1)
        assert.ok(activeSimulationMaintenance(run.snapshot()))
        await assert.rejects(run.finishMaintenance(selected()!.cancellation!.maintenance))
        const revision = run.snapshot().revision
        await assert.rejects(run.commitExternalContact(selected()!.id))
        assert.equal(run.snapshot().revision, revision)
        assert.deepEqual(await stable(), baseline)
        unknownEvidence = { core: core(), actual: await topology(selected(), true), revision, modelCalls: requests.length }
        await writeFile(resolve(root, 'contact-pending.json'), JSON.stringify({ core: core(), stable: await stable(), topology: await topology(selected(), true),
          originalContact, barrierEvidence, unknownEvidence, journal: await journal() }))
        await writeFile(resolve(root, 'contact-held.json'), JSON.stringify({ originalContact, barrierEvidence, unknownEvidence }))
        await writeFile(resolve(root, 'contact-model-inputs.json'), JSON.stringify(requests))
        console.log(JSON.stringify({ scene, scenarioCase, phase: run.snapshot().phase, contact: 'cancel-requested', outcome: 'pending',
          originalIdentities: true, originalAssets: true, exactRetry: true, pendingResultWakes: 0,
          modelCalls: requests.length, restored: false }))
        return
      }
      if (result.status !== 'fulfilled') throw result.reason
      assert.equal(result.value.reason, 'paused')
      if (activeSimulationMaintenance(run.snapshot()) !== undefined || selected()?.status === 'cancel-requested')
        assert.equal((await driver.reconcile()).reason, 'paused')
      assert.deepEqual(await stable(), baseline)
      assert.equal(failures.length, 0, failures.join('\n'))
      await writeFile(resolve(root, 'contact-held.json'), JSON.stringify({ originalContact, barrierEvidence, drainEvidence }))
    } else {
      if (unknownCold && !finalCold) {
        const pending = selected()!, persisted = JSON.parse(await readFile(resolve(root, 'contact-pending.json'), 'utf8')) as { core: unknown }
        assert.equal(pending.status, 'cancel-requested')
        assert.deepEqual(core(), persisted.core)
        const read = ctx.teams.getChannelAdmission.bind(ctx.teams)
        ctx.teams.getChannelAdmission = async (...args) => {
          if (args[0].channelId === pending.channel.channelId) throw new Error('Original contact cleanup remains unknown after cold restore')
          return await read(...args)
        }
        const revision = run.snapshot().revision, unchanged = core()
        await assert.rejects(driver.reconcile(), /remains unknown/)
        assert.equal(run.snapshot().revision, revision + 2)
        assertUnknownReconcileOnly(unchanged, core(), await journal(), revision, pending.planId)
        await writeFile(resolve(root, 'contact-pending-cold.json'), JSON.stringify({ core: core(), stable: await stable(), topology: await topology(pending, true), journal: await journal() }))
        console.log(JSON.stringify({ scene, scenarioCase, phase: 'paused', contact: 'cancel-requested', outcome: 'pending',
          originalIdentities: true, originalAssets: true, exactRetry: true, pendingResultWakes: 0, modelCalls: 0, restored: true }))
        return
      }
      if (activeSimulationMaintenance(run.snapshot()) !== undefined || selected()?.status === 'cancel-requested')
        assert.equal((await driver.reconcile()).reason, 'paused')
      assert.deepEqual(await stable(), JSON.parse(await readFile(resolve(root, 'contact-baseline.json'), 'utf8')))
    }
    const state = run.snapshot(), contact = selected()!
    const result = Object.values(state.world!.results).find(value => value.requestId === contact.requestId)!
    assert.equal(state.phase, 'paused')
    assert.equal(activeSimulationMaintenance(state), undefined)
    assert.equal(Object.keys(state.world!.results).length, 2)
    assert.equal(representative().status, 'committed')
    assert.equal(Object.keys(state.world!.external.representatives).length, 1)
    assert.equal(contact.status, scenarioCase === 'commit-wins' ? 'committed' : 'cancelled')
    assert.equal((await connection.cancelWorldCase(cancellation())).status, scenarioCase === 'commit-wins' ? 'already-committed' : 'cancelled')
    const revision = run.snapshot().revision
    if (scenarioCase === 'commit-wins') await assert.rejects(run.settleExternalContactCancellation(contact.id))
    else {
      assert.deepEqual(await run.settleExternalContactCancellation(contact.id), result)
      await assert.rejects(run.commitExternalContact(contact.id))
      assert.equal(contact.cleanup!.sequence, result.sequence)
      assert.equal(contact.cleanup!.evidence.kind, scenarioCase === 'retained-keeper' ? 'retained' : 'terminal')
    }
    assert.equal(run.snapshot().revision, revision)
    const resultWake = Object.values(state.scheduledEvents).find(value => value.id === `simulation-world-result:${result.id}`)
    assert.ok(resultWake)
    assert.equal(resultWake.status, 'pending')
    const proof = { core: core(), stable: await stable(), topology: await topology(), result, resultWake }
    if (recovering && !unknownCold && (!crash || finalCold)) assert.deepEqual(proof, JSON.parse(await readFile(originalPath, 'utf8')))
    else {
      if (!crash && !unknownCold) assert.equal((await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('contact-complete'),
        implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
      await writeFile(originalPath, JSON.stringify({ ...proof, core: core(), topology: await topology() }))
      await writeFile(resolve(root, 'contact-journal.json'), JSON.stringify(await journal()))
      if (!recovering) await writeFile(resolve(root, 'contact-model-inputs.json'), JSON.stringify(requests))
    }
    const currentRevision = run.snapshot().revision, models = requests.length
    assert.equal((await driver.advance()).reason, 'paused')
    assert.equal(run.snapshot().revision, currentRevision)
    assert.equal(requests.length, models)
    console.log(JSON.stringify({ scene, scenarioCase, phase: 'paused', contact: contact.status, outcome: result.outcome.kind,
      originalIdentities: true, originalAssets: true, exactRetry: true, pendingResultWakes: 1,
      modelCalls: requests.length, restored: recovering }))
  } catch (cause) {
    await writeFile(resolve(root, 'contact-failure.json'), JSON.stringify({ failures, requests, core: core() }))
    throw cause
  } finally {
    releaseAcceptedIO?.(); await drainDriver?.(); await run.close(); await ctx.fiber.dispose()
  }
}
await executeScenario()
