import { z } from 'zod'
import { simulationWorldHireReservationSchema, simulationOfferRevisionSchema, simulationResourceReservationSchema } from '@clocky/clocky-simulation'
import { businessFingerprint } from '../../../packages/simulation/simulation-local/src/business.ts'
import { HiringMarketWorldExecution } from '../../../packages/simulation/simulation-world/src/hiring-market.ts'
import { WORLD_GENERATE_AND_HIRE_PIN, simulationWorldManagementActionSchema, simulationWorldManagementSubmitRequestSchema, simulationWorldAuthenticatedUserSourceSchema } from '@clocky/clocky-simulation'
import type { SimulationWorldManagementAuthority } from '@clocky/clocky-simulation'
/** Loader boot, real actor Sessions, and cold restoration of a candidate's exact accepted offer. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenarioV1, worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { WORLD_HIRING_MARKET_PIN, WORLD_HIRE_EXISTING_PIN, simulationResourceSpecSchema, simulationHiringFeePolicySchema,
  simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWakeRequestSchema,
  simulationWorldGoalSchema, simulationEntityIdSchema, hiringMarket } from '@clocky/clocky-simulation'
import { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { worldV1Definition, worldV1Catalog } from './fixtures/world-v1-product/deployment.ts'
import { requests, modelInputs } from './world-hiring-market-model.ts'

const cut = process.env.WORLD_MARKET_CUT ?? ''
const partialRecovery = process.env.WORLD_MARKET_PARTIAL === 'true'
const generated = process.env.WORLD_MARKET_GENERATED === 'true'
const terminal = process.env.WORLD_MARKET_TERMINAL ?? 'accepted'
assert.ok(['accepted', 'declined', 'withdrawn'].includes(terminal))
const hirePin = generated ? WORLD_GENERATE_AND_HIRE_PIN : WORLD_HIRE_EXISTING_PIN
const definition = structuredClone(worldV1Definition), installed = structuredClone(worldV1Catalog)
const [hr, candidate] = definition.entities.filter(value => 'role' in value && value.role === 'member')
assert.ok(hr && candidate)
const organization = definition.organization.rootId
const position = definition.organization.grants.find(value => value.personId === hr.id && value.relation === 'can-hire')!.targetId
const pins = [hirePin, WORLD_HIRING_MARKET_PIN]
definition.domains = pins.map(({ domain, operation, version }) => ({ domain, operation, version }))
definition.organization.assignments = definition.organization.assignments.filter(value => value.personId !== candidate.id)
definition.organization.grants = definition.organization.grants.filter(value => value.personId === hr.id && value.relation === 'can-hire')
  .map(value => ({ ...value, operation: hirePin.operation }))
for (const actor of [hr, candidate]) definition.organization.grants.push({ id: `market-${actor.id}`, personId: actor.id,
  domain: 'organization', operation: 'hiring-market', version: '1', scopeId: organization, targetId: position,
  relation: 'can-market', validFrom: '0', validUntil: null })
definition.organization.grants.push({ id: 'candidate-eligibility', personId: candidate.id, domain: 'organization', operation: 'hiring-market',
  version: '1', scopeId: organization, targetId: organization, relation: 'eligible-for-hire', validFrom: '0', validUntil: null })
definition.behavior = { initialGoals: [], calendars: [], directorEvents: [] }
definition.governance = { committees: [], norms: [] }; definition.facts = []; definition.knowledge = []
definition.externalWorld = { mode: 'simulated-only', identities: [] }
definition.resources = [{ id: 'cash', owner: organization, controllers: [hr.id], kind: 'money', unit: 'credit', quantity: '10' },
  { id: 'payee', owner: candidate.id, controllers: [], kind: 'money', unit: 'credit', quantity: '0' }].map(value => simulationResourceSpecSchema.parse(value))
definition.organization.hiringFees = [simulationHiringFeePolicySchema.parse({ id: 'fee', version: '1', policyRef: 'clocky.organization.hiring-fee/1',
  operation: hirePin.operation, positionEntityId: position, from: 'cash', to: 'payee', unit: 'credit', quantity: '3', grants: [], reservationPeriod: '10' })]
definition.limits.world = { maxRequests: 32, maxRequestsPerActorPerInterval: 32, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 }
installed.limits.defaults.native.maxResidentActors = 3
installed.limits.ceilings.native.maxResidentActors = 3
installed.limits.ceilings.world.maxRequests = 32
installed.limits.ceilings.world.maxRequestsPerActorPerInterval = 32
installed.limits.ceilings.world.maxBytesPerRequest = 65536
installed.limits.ceilings.world.maxBytesPerPlan = 65536
installed.domains = pins.map(pin => ({ pin, available: true }))
installed.runtimeProfiles = installed.runtimeProfiles.filter(value => value.version !== 'unavailable-model')
for (const runtime of installed.runtimeProfiles) runtime.model.provider = 'world-hiring-market-scripted'
const compiled = await compileWorldScenarioV1(worldScenarioV1Schema.parse(definition), scenarioV1CatalogSchema.parse(installed))
assert.ok(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
const resolved = compiled.resolved
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
const ctx = await boot('world-hiring-market', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: { runId: 'market', ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse(partialRecovery ? 'market-initial' : 'market-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved, ownerName: 'world-market',
    checkpoint: { id: simulationCheckpointIdSchema.parse('market-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName,
    maxDrainRounds: 4, maxAttempts: 3 }
  const lifetime = new AbortController().signal
  const stop = async (stage: string) => {
    if (cut !== stage) return
    await writeFile(resolve(root, 'market-cut.json'), JSON.stringify({ stage, reservations: run.snapshot().world!.reservations,
      offers: [...hiringMarket(run.snapshot()).offers.values()], resources: run.snapshot().resourceReservations }))
    process.send?.('durable')
    await new Promise<never>(() => { setInterval(() => {}, 1000) })
  }
  const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
  ctx.teams.inviteParticipant = async (...args) => {
    const participant = await invite(...args)
    if (Object.values(run.snapshot().world!.reservations).some(value => value.identities.binding.participantId === participant.id))
      await stop('participant-afterIO')
    return participant
  }
  const ready = run.readyWorldCandidate.bind(run)
  run.readyWorldCandidate = async (...args) => { const result = await ready(...args); await stop('candidate-ready'); return result }
  const commit = run.commitWorldHire.bind(run)
  run.commitWorldHire = async (...args) => {
    await stop('commit-before')
    const result = await commit(...args)
    await stop('commit-after')
    return result
  }
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime, ctx,
    ctx.simulationWorldExecutions.handlers({ run, connection, resolved, anchor, lifetime }))
  let candidateId = simulationEntityIdSchema.parse(candidate.id), originalBinding = run.snapshot().entities[candidateId]!.binding
  let originalProfile = run.snapshot().entities[candidateId]!.profile
  async function goal(entityId: string, name: string) {
    const wake = simulationWakeRequestSchema.parse({ id: `market-${name}`, entityId,
      time: String(BigInt(run.snapshot().time) + 1n), reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: name })) })
    await run.scheduleWake(wake, run.snapshot().revision)
    let result = await driver.advance(wake.time)
    for (let i = 0; i < 32 && result.reason === 'work-limit'; i++) result = await driver.advance(wake.time)
    assert.ok(['idle', 'until', 'approval-required'].includes(result.reason), JSON.stringify(result))
  }
  if (!recovering || partialRecovery) {
    if (generated && !hiringMarket(run.snapshot()).drafts.has('generated-review')) {
      const template = run.snapshot().world!.definition.templates[0]!
      for (const decision of ['draft', 'reviewed', 'accepted'] as const) {
        const prior = hiringMarket(run.snapshot()).drafts.get('generated-review')
        const payload = { organizationEntityId: organization, positionEntityId: position, id: 'generated-review',
          ...decision === 'draft' ? { kind: 'draft', expectedRevision: 0, validUntil: '90', body: {
            templateId: template.id, templateVersion: template.version,
            persona: { name: template.names[0], skills: [], traits: [], goals: [] } } }
            : { kind: 'review', revision: 1, bodyHash: prior!.bodyHash, decision,
              reason: 'Human finite review before independent candidate birth.' } }
        const action = simulationWorldManagementActionSchema.parse({ kind: 'hiring-market', payload })
        const source = simulationWorldAuthenticatedUserSourceSchema.parse({ kind: 'authenticated-user', principalId: 'scene-owner',
          credentialGeneration: 1, commandId: 'preview', policyRef: 'test-review/1', policyGeneration: '1', time: run.snapshot().time })
        const authority: SimulationWorldManagementAuthority = { resolve: () => ({ source, actionHash: businessFingerprint(action),
          sourceFingerprint: businessFingerprint('reviewed-template'), sourceComplete: true, funding: null }) }
        const expectedRevision = run.snapshot().revision
        const preview = await run.previewWorldManagement({ action, expectedRevision }, authority)
        assert.equal(preview.admission, 'allowed')
        const accepted = await run.submitWorldManagement(simulationWorldManagementSubmitRequestSchema.parse({ action, expectedRevision,
          commandId: `review-${decision}`, previewHash: preview.previewHash }), authority)
        await new HiringMarketWorldExecution(run).execute(run.snapshot().world!.plans[accepted.planId]!)
      }
    }
    if (partialRecovery) {
      await driver.reconcile()
      let recovered = await driver.advance(run.snapshot().time)
      for (let i = 0; i < 32 && recovered.reason === 'work-limit'; i++) recovered = await driver.advance(run.snapshot().time)
    }
    if (run.snapshot().phase !== 'running') await run.setPhase('running', run.snapshot().revision)
    if (!hiringMarket(run.snapshot()).vacancies.has('vacancy')) await goal(hr.id, 'vacancy')
    if (!generated) await goal(candidate.id, 'application')
    if (!Object.values(run.snapshot().world!.intents).some(value => value.pin.operation === hirePin.operation)) await goal(hr.id, 'hire')
    if (generated) {
      const prepared = Object.values(run.snapshot().world!.reservations)[0]!
      assert.ok(['candidate', 'committed'].includes(prepared.status))
      candidateId = prepared.identities.entityId
      originalBinding = run.snapshot().entities[candidateId]!.binding
      originalProfile = run.snapshot().entities[candidateId]!.profile
      if (prepared.status === 'candidate') assert.equal(Object.values(run.snapshot().relations).some(value => value.subject === candidateId && value.relation === 'assignment'), false)
      if (!hiringMarket(run.snapshot()).applications.has('application')) await goal(candidateId, 'application')
    }
    if (!hiringMarket(run.snapshot()).offers.has('offer')) await goal(hr.id, 'offer')
    if (hiringMarket(run.snapshot()).offers.get('offer')!.status === 'proposed') await goal(hr.id, 'delivered')
    if (hiringMarket(run.snapshot()).offers.get('offer')!.status === 'delivered') {
      assert.equal(Object.values(run.snapshot().relations).some(value => value.subject === candidateId && value.relation === 'assignment'), false)
      await goal(terminal === 'withdrawn' ? hr.id : candidateId, terminal)
    }
    if (!partialRecovery) assert.ok(requests.some(value => value.entityId === candidateId && value.purpose === 'goal'))
    assert.ok(modelInputs.filter(value => value.entityId === candidateId).every(value => !value.input.includes('DIRECTOR-PRIVATE-MARKET-CANARY')))
  }
  if (recovering && generated) {
    const person = Object.values(run.snapshot().world!.reservations)[0]!
    candidateId = person.identities.entityId
    originalBinding = run.snapshot().entities[candidateId]!.binding
    originalProfile = run.snapshot().entities[candidateId]!.profile
  }
  const state = run.snapshot(), offer = hiringMarket(state).offers.get('offer')!
  assert.equal(offer.status, terminal)
  const plan = state.world!.plans[offer.planId]!
  assert.ok(plan.proposal.resolution.kind === 'apply')
  const result = Object.values(state.world!.results).find(value => value.intentId === state.world!.requests[plan.requestId]!.intentId)!
  assert.equal(result.outcome.kind, terminal === 'accepted' ? 'committed' : 'cancelled')
  assert.deepEqual(state.entities[candidateId]!.binding, originalBinding)
  assert.deepEqual(state.entities[candidateId]!.profile, originalProfile)
  assert.equal(state.entities[candidateId]!.phase, 'active')
  assert.equal(state.entities[candidateId]!.readiness, 'ready')
  const assignments = Object.values(state.relations).filter(value => value.subject === candidateId && value.relation === 'assignment')
  assert.equal(assignments.length, terminal === 'accepted' ? 1 : 0)
  if (terminal === 'accepted') {
    const revision = state.revision
    assert.deepEqual(generated ? await run.commitWorldHire(Object.values(state.world!.reservations)[0]!.id)
      : await run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.payload }), result)
    assert.equal(run.snapshot().revision, revision)
  }
  assert.equal(Object.values(state.resources).find(value => value.id === 'cash')!.quantity, terminal === 'accepted' ? '7' : '10')
  assert.equal(Object.values(state.resources).find(value => value.id === 'payee')!.quantity, terminal === 'accepted' ? '3' : '0')
  if (partialRecovery) {
    const original = z.strictObject({ stage: z.string(), reservations: z.record(z.string(), simulationWorldHireReservationSchema),
      offers: z.array(simulationOfferRevisionSchema), resources: z.record(z.string(), simulationResourceReservationSchema) })
      .parse(JSON.parse(await readFile(resolve(root, 'market-cut.json'), 'utf8')))
    for (const reservation of Object.values(original.reservations)) {
      const current = state.world!.reservations[reservation.id]!
      assert.deepEqual(current.identities, reservation.identities)
      assert.deepEqual(current.request, reservation.request)
      assert.deepEqual(current.prepared, reservation.prepared)
    }
    for (const accepted of original.offers.filter(value => value.status === 'accepted'))
      assert.deepEqual(hiringMarket(state).offers.get(accepted.id), accepted)
    for (const hold of Object.values(original.resources)) {
      const current = state.resourceReservations[hold.id]!
      assert.equal(current.createdOperationId, hold.createdOperationId)
      assert.deepEqual(current.transaction, hold.transaction)
    }
  }
  const proof = { resources: state.resources, holds: state.resourceReservations, offer, binding: originalBinding,
    profile: originalProfile, assignments, results: state.world!.results }
  if (recovering && !partialRecovery) {
    assert.deepEqual(proof, JSON.parse(await readFile(resolve(root, 'market-proof.json'), 'utf8')))
    assert.equal(requests.length, 0)
  } else {
    await run.setPhase('paused', run.snapshot().revision)
    await driver.drain()
    assert.equal((await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('market-complete'), implementationVersion: 'world/1',
      maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
    await writeFile(resolve(root, 'market-proof.json'), JSON.stringify(proof))
  }
  console.log(JSON.stringify({ accepted: terminal === 'accepted', terminal, uniqueAssignment: true, originalIdentity: true, noPrivateLeak: true, exactRetry: true,
    recovered: recovering, modelCalls: requests.length }))
} finally { await run.close(); await ctx.fiber.dispose() }
