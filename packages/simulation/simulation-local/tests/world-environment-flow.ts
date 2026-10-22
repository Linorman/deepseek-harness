import { boot } from '@clocky/clocky-app-boot'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { WORLD_ENVIRONMENT_PIN, WORLD_EXPERIENCE_PIN, environmentSampleSchema, personEvolutionStateSchema,
  environmentStateSchema, environmentRequestSchema,
  simulationEntityIdSchema, simulationChangeSchema, simulationDecisionIdSchema, simulationWorldDomainRequestSchema, simulationWorldCancelRequestSchema, personExperienceSchema } from '@clocky/clocky-simulation'
import { WorldExecutionDispatcher } from '../../simulation-world/src/execution.ts'
import { EvolutionWorldExecution } from '../../simulation-world/src/evolution.ts'
import { EvolutionNativeWorldDomain } from '../src/world-environment-domain.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

const initial = { model: 'supply-fixed/1', generation: 1, inventory: 10, committed: 4,
  capacity: 20, sourceLimit: 3, sinkLimit: 5, step: 1, lastTime: null }
const input = environmentRequestSchema.parse({ scopeEntityId: 'fee-org', targetEntityId: 'supply', demand: 8 })

/** Execute the real Loader, canonical Session and original registry flow for a runnable example. */
export async function runEnvironmentFlow(backend: 'json' | 'sqlite', model: 'supply-fixed/1' | 'supply-seasonal/1') {
  const scopeEntityId = simulationEntityIdSchema.parse('fee-org'), targetEntityId = simulationEntityIdSchema.parse('supply')
  const temp = resolve('.tmp/world-post-mvp/c3/loader'); await mkdir(temp, { recursive: true })
  const root = await mkdtemp(resolve(temp, `${backend}-`))
  const oldRoot = process.env.SIMULATION_COMPANY_ROOT, oldBackend = process.env.SIMULATION_COMPANY_BACKEND
  process.env.SIMULATION_COMPANY_ROOT = root; process.env.SIMULATION_COMPANY_BACKEND = backend
  const ctx = await boot('c3-environment', resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml'))
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: root, loadedContext: { ctx, serviceFiber: ctx.fiber },
    installedPins: [WORLD_ENVIRONMENT_PIN, WORLD_EXPERIENCE_PIN], extraEntities: [{ id: 'supply', entityKind: 'environment' }, { id: 'growth', entityKind: 'person-state' }],
    extraOperationGrants: [{ requesterEntityId: simulationEntityIdSchema.parse('buyer'),
      domain: 'environment', operation: 'supply-step', version: '1', scopeEntityId, targetEntityId,
      relationId: 'supply-grant' as import('@clocky/clocky-simulation').SimulationRelationId, relation: 'can-supply' }, { requesterEntityId: simulationEntityIdSchema.parse('buyer'), domain: 'person-state', operation: 'experience', version: '1', scopeEntityId, targetEntityId: simulationEntityIdSchema.parse('growth'), relationId: 'growth-grant' as import('@clocky/clocky-simulation').SimulationRelationId, relation: 'can-grow' }],
    positionRolePermissions: [{ positionEntityId: simulationEntityIdSchema.parse('fee-role'), permissions: [{
      domain: 'environment', operation: 'supply-step', version: '1', scopeEntityId, targetEntityId, relation: 'can-supply' }, { domain: 'person-state', operation: 'experience', version: '1', scopeEntityId, targetEntityId: simulationEntityIdSchema.parse('growth'), relation: 'can-grow' }] }],
  })
  try {
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: targetEntityId,
      entityRevision: h.run.snapshot().entities[targetEntityId]!.revision, profile: { environment: { ...initial,
        model } } }), h.run.snapshot().revision)
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: 'growth', entityRevision: h.run.snapshot().entities[simulationEntityIdSchema.parse('growth')]!.revision, profile: { evolution: { personId: h.requester, audience: [h.requester, h.director], period: 10, versions: [] } } }), h.run.snapshot().revision)
    await h.start()
    await h.propose(h.requester, 'supply-request', { kind: 'world/request', domain: 'environment', operation: 'supply-step',
      version: '1', businessKey: 'supply', expectedTime: null, evidence: [], payload: input }, { kind: 'goal' })
    const request = Object.values(h.run.snapshot().world!.requests).find(v => v.proposal.businessKey === 'supply')!
    await h.run.drive({ until: h.run.snapshot().time })
    await h.connection.dispatchOperation(request.notificationOperationId!, () => Date.now())
    const wake = await h.connection.receiveOperation(request.notificationOperationId!)
    await h.run.drive({ until: h.run.snapshot().time })
    await h.propose(h.director, 'supply-plan', { kind: 'world/resolve', requestId: request.id, supersedes: null,
      resolution: { kind: 'apply', rationale: 'Apply frozen supply rule.', payload: input } }, { kind: 'resolve', requestId: request.id }, wake)
    const plan = Object.values(h.run.snapshot().world!.plans).at(-1)!
    const dispatcher = new WorldExecutionDispatcher(h.run)
    h.ctx.effect(() => dispatcher.register(new EvolutionWorldExecution(h.run, 'supply')))
    h.ctx.effect(() => dispatcher.register(new EvolutionWorldExecution(h.run, 'experience')))
    await dispatcher.execute(plan)
    const retained = h.run.snapshot().entities[targetEntityId]!.profile
    assert.equal(environmentStateSchema.parse(retained.environment).inventory, 8)
    assert.equal(environmentStateSchema.parse(retained.environment).committed, 4)
    const sample = environmentSampleSchema.parse(Object.values(h.run.snapshot().world!.mutations).at(-1)!.payload)
    assert.equal(sample.production, 3); assert.equal(sample.consumed, 5)
    const originalPerson = h.run.snapshot().entities[h.requester]!
    const source = Object.values(h.run.snapshot().world!.intents).find(v => v.requestId === request.id)!
    const experience = personExperienceSchema.parse({ scopeEntityId, targetEntityId: 'growth', personId: h.requester,
      field: 'skill', key: 'supply', previous: 0, next: 3, sourceIntentId: source.id,
      effectiveAt: h.run.snapshot().time, validUntil: '100' })
    const domain = new EvolutionNativeWorldDomain('experience')
    const envelope = simulationWorldDomainRequestSchema.parse({ kind: 'world/request', domain: 'person-state', operation: 'experience', version: '1', businessKey: 'growth', expectedTime: null, evidence: [], payload: experience })
    assert.throws(() => domain.admitRequest(h.run.snapshot(), h.candidate, envelope), /audience/)
    assert.throws(() => domain.admitRequest(h.run.snapshot(), h.requester, { ...envelope, payload: { ...experience, sourceIntentId: 'missing' } }), /experience/)
    await h.propose(h.requester, 'growth-request', envelope, { kind: 'goal' })
    const growthRequest = Object.values(h.run.snapshot().world!.requests).find(v => v.proposal.businessKey === 'growth')!
    await h.run.drive({ until: h.run.snapshot().time })
    await h.connection.dispatchOperation(growthRequest.notificationOperationId!, () => Date.now())
    const growthWake = await h.connection.receiveOperation(growthRequest.notificationOperationId!)
    await h.run.drive({ until: h.run.snapshot().time })
    for (let round = 0; round < 8 && h.run.snapshot().wakes[growthWake]?.status !== 'pending'; round += 1) {
      for (const pending of Object.values(h.run.snapshot().wakes)) if (pending.status === 'pending' && pending.eventId !== growthWake) await h.propose(pending.entityId, `prior:${pending.eventId}`, undefined, undefined, pending.eventId)
      await h.run.drive({ until: h.run.snapshot().time })
    }
    await h.propose(h.director, 'growth-plan', { kind: 'world/resolve', requestId: growthRequest.id, supersedes: null,
      resolution: { kind: 'apply', rationale: 'Record committed experience.', payload: experience } }, { kind: 'resolve', requestId: growthRequest.id }, growthWake)
    const growthPlan = Object.values(h.run.snapshot().world!.plans).at(-1)!
    const frozenContext = structuredClone(h.run.snapshot().decisions[simulationDecisionIdSchema.parse('growth-plan')]!.context)
    assert.ok(frozenContext)
    if (frozenContext?.status !== 'prepared') throw new Error('Original growth context was not prepared')
    assert.ok(frozenContext.view.content.flatMap(section => section.blocks).some(block => block.type === 'text' && block.text.includes('"versions":[]')))
    await dispatcher.execute(growthPlan)
    assert.deepEqual(h.run.snapshot().decisions[simulationDecisionIdSchema.parse('growth-plan')]!.context, frozenContext)
    assert.deepEqual(h.run.snapshot().entities[h.requester], originalPerson)
    const retainedGrowth = h.run.snapshot().entities[simulationEntityIdSchema.parse('growth')]!.profile
    assert.deepEqual(personEvolutionStateSchema.parse(retainedGrowth.evolution).versions, [experience])
    assert.throws(() => domain.admitRequest(h.run.snapshot(), h.requester, { ...envelope, payload: { ...experience,
      previous: 3, next: 4 } }), /period/)
    assert.throws(() => domain.admitRequest(h.run.snapshot(), h.requester, { ...envelope, payload: { ...experience, key: 'other-skill', previous: 0, next: 3 } }), /aggregate period/)
    const beforeCancellation = structuredClone(h.run.snapshot().entities)
    for (const proposal of [
      { domain: 'environment', operation: 'supply-step', payload: { ...input, demand: 1 } },
      { domain: 'person-state', operation: 'experience', payload: { ...experience, key: 'cancelled-skill', previous: 0, next: 1 } },
    ]) {
      const key = `cancel-${proposal.domain}`
      await h.propose(h.requester, key, { kind: 'world/request', ...proposal, version: '1', businessKey: key,
        expectedTime: null, evidence: [] }, { kind: 'goal' })
      const request = Object.values(h.run.snapshot().world!.requests).find(value => value.proposal.businessKey === key)!
      const cancellation = await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: key, requestId: request.id }))
      assert.equal(cancellation.status, 'cancelled')
    }
    assert.deepEqual(h.run.snapshot().entities, beforeCancellation)
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await assert.rejects(h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: targetEntityId, entityRevision: h.run.snapshot().entities[targetEntityId]!.revision, profile: { environment: { ...initial, model: 'supply-seasonal/1' } } }), h.run.snapshot().revision), /new experiment/)
    await assert.rejects(h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: 'growth', entityRevision: h.run.snapshot().entities[simulationEntityIdSchema.parse('growth')]!.revision, profile: { evolution: { personId: h.requester, audience: [h.requester], period: 10, versions: [] } } }), h.run.snapshot().revision), /immutable/)
    await h.connection.close(); await h.run.close()
    const reopened = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    try { assert.deepEqual(reopened.snapshot().entities[targetEntityId]!.profile, retained); assert.deepEqual(reopened.snapshot().entities[simulationEntityIdSchema.parse('growth')]!.profile, retainedGrowth) }
    finally { await reopened.close() }
    return { backend, model, sample, skill: { previous: experience.previous, next: experience.next, field: experience.field,
      key: experience.key },
    originalPersonUnchanged: true, originalContextUnchanged: true, cancelledDomains: ['environment', 'person-state'], restored: true }
  } finally {
    await h.close()
    if (oldRoot === undefined) delete process.env.SIMULATION_COMPANY_ROOT
    else process.env.SIMULATION_COMPANY_ROOT = oldRoot
    if (oldBackend === undefined) delete process.env.SIMULATION_COMPANY_BACKEND
    else process.env.SIMULATION_COMPANY_BACKEND = oldBackend
  }
}
