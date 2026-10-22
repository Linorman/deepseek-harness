import { z } from 'zod'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import assert from 'node:assert/strict'
import { WORLD_REPRESENTATION_PIN, WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_MEDIATED_PIN,
  WORLD_EXTERNAL_MEDIATION_POLICY_REF, simulationEntityIdSchema, simulationChangeSchema, simTimeSchema,
  representationSwitchRequestSchema, simulationWorldDomainRequestSchema, simulationExternalMediatedRequestSchema, simulationWorldCancelRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationWorldJsonValue } from '@clocky/clocky-simulation'
import { WorldExecutionDispatcher } from '../../simulation-world/src/execution.ts'
import { RepresentationWorldExecution } from '../../simulation-world/src/representation.ts'
import { ExternalWorldExecution } from '../../simulation-world/src/external.ts'
import { ExternalMediatedNativeWorldDomain } from '../src/world-external-mediated.ts'
import { ExternalInteractNativeWorldDomain } from '../src/world-external.ts'
import { RepresentationNativeWorldDomain } from '../src/world-representation-domain.ts'
import { assertRepresentationAdmission } from '../src/world-representation-access.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

/** Run the real Loader request/plan/switch/reopen chain; all artifacts remain inside the repository. */
export async function representationScenario(backend: 'json' | 'sqlite', configPath: string, interrupted = false) {
  const temp = resolve('.tmp/world-post-mvp-bc/representation'); await mkdir(temp, { recursive: true })
  const root = await mkdtemp(resolve(temp, `${backend}-`))
  const oldRoot = process.env.SIMULATION_COMPANY_ROOT, oldBackend = process.env.SIMULATION_COMPANY_BACKEND
  process.env.SIMULATION_COMPANY_ROOT = root; process.env.SIMULATION_COMPANY_BACKEND = backend
  const ctx = await boot('representation-switch', configPath)
  const scope = simulationEntityIdSchema.parse('fee-org'), target = simulationEntityIdSchema.parse('vendor')
  const pins = [WORLD_REPRESENTATION_PIN, WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_MEDIATED_PIN]
  const grants = pins.map(pin => ({ requesterEntityId: simulationEntityIdSchema.parse('buyer'),
    domain: pin.domain, operation: pin.operation, version: pin.version, scopeEntityId: scope, targetEntityId: target,
    relationId: `grant-${pin.operation}-${pin.version}` as import('@clocky/clocky-simulation').SimulationRelationId, relation: `can-${pin.operation}-${pin.version}` }))
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: root, loadedContext: { ctx, serviceFiber: ctx.fiber },
    installedPins: pins, microstepLimit: 128, extraEntities: [{ id: 'vendor', entityKind: 'organization' }], extraOperationGrants: grants,
    positionRolePermissions: [{ positionEntityId: simulationEntityIdSchema.parse('fee-role'), permissions: grants.map(({ requesterEntityId: _actor,
      relationId: _relation, ...permission }) => permission) }],
    externalAdjudicationPolicy: { ref: WORLD_EXTERNAL_MEDIATION_POLICY_REF, version: '1', generation: 1,
      conditionInstalls: [], futureConditionInstalls: [], maxDelay: simTimeSchema.parse('20'), allowPublicDisclosure: false,
      allowScopeDisclosure: false, actorDisclosure: [], allowedOutcomeKinds: ['failure', 'delayed-event'] },
  })
  try {
    const dispatcher = new WorldExecutionDispatcher(h.run)
    h.ctx.effect(() => dispatcher.register(new ExternalWorldExecution(h.run)))
    h.ctx.effect(() => dispatcher.register(new RepresentationWorldExecution(h.run)))
    let sequence = 0
    const transact = async (operation: string, version: string, payload: SimulationWorldJsonValue, planPayload = payload,
      execute = true) => {
      const key = `representation-${++sequence}`
      for (const wake of Object.values(h.run.snapshot().wakes)) if (wake.status === 'pending')
        await h.propose(wake.entityId, `drain-${key}-${wake.eventId}`, undefined, undefined, wake.eventId)
      await h.propose(h.requester, `${key}-request`, { kind: 'world/request', domain: 'external', operation, version,
        businessKey: key, expectedTime: null, evidence: [], payload }, { kind: 'goal' })
      const request = Object.values(h.run.snapshot().world!.requests).find(value => value.proposal.businessKey === key)!
      await h.run.drive({ until: h.run.snapshot().time })
      await h.connection.dispatchOperation(request.notificationOperationId!, () => Date.now())
      const wakeId = await h.connection.receiveOperation(request.notificationOperationId!)
      await h.run.drive({ until: h.run.snapshot().time })
      for (const wake of Object.values(h.run.snapshot().wakes)) if (wake.status === 'pending' && wake.eventId !== wakeId)
        await h.propose(wake.entityId, `drain-plan-${key}-${wake.eventId}`, undefined, undefined, wake.eventId)
      await h.run.drive({ until: h.run.snapshot().time })
      await h.propose(h.director, `${key}-plan`, { kind: 'world/resolve', requestId: request.id, supersedes: null,
        resolution: { kind: 'apply', rationale: 'Preserve the original subject and actual state.', payload: planPayload } },
      { kind: 'resolve', requestId: request.id }, wakeId)
      const selected = h.run.snapshot().world!.requests[request.id]!.plans.at(-1)!
      const plan = h.run.snapshot().world!.plans[selected]!
      assert.equal(plan.status, 'accepted')
      assert.equal(plan.requestId, request.id)
      if (operation === 'switch-representation') {
        const input = representationSwitchRequestSchema.parse(payload)
        assert.throws(() =>{  assertRepresentationAdmission(h.run.snapshot(), input.targetEntityId, input.identityId, input.from) },
          /closed new interaction/)
        if (interrupted && execute) {
          const profile = h.run.snapshot().entities[target]!.profile
          const commit = h.run.commitWorldMutation.bind(h.run)
          h.run.commitWorldMutation = async () => { throw new Error('Interrupted before original switch commit') }
          try { await assert.rejects(dispatcher.execute(plan), /Interrupted before original switch/) }
          finally { h.run.commitWorldMutation = commit }
          assert.deepEqual(h.run.snapshot().entities[target]!.profile, profile)
          assert.equal(h.run.snapshot().world!.executions[plan.id]!.phase, 'outcome-unknown')
          await dispatcher.reconcile(plan)
        }
      }
      if (execute) {
        // The mediated leaf uses the same public Native command as the installed execution provider; no representative is admitted.
        if (operation === 'interact' && version === '3') await h.run.commitWorldMutation({ planId: plan.id, payload: { kind: 'apply-original-adjudication' } })
        else await dispatcher.execute(plan)
      }
      return plan
    }
    await h.start()
    const input = { scope, subjectRef: target, externalKey: 'vendor', sourceKind: 'simulated-rule',
      policyRef: 'clocky.external.availability/1', input: { kind: 'availability', unit: 'item' } }
    const first = await transact('interact', '1', input, { kind: 'evaluate-rule' }, false)
    const identity = Object.values(h.run.snapshot().world!.external.identities)[0]!
    const request = representationSwitchRequestSchema.parse({ scopeEntityId: scope, targetEntityId: target,
      identityId: identity.id, expectedGeneration: 1, from: 'simulated-rule', to: 'director-mediated' })
    const switchEnvelope = simulationWorldDomainRequestSchema.parse({ kind: 'world/request', domain: 'external', operation: 'switch-representation', version: '1',
      businessKey: 'switch-probe', expectedTime: null, evidence: [], payload: request })
    assert.throws(() => new RepresentationNativeWorldDomain().admitRequest(h.run.snapshot(), h.requester, switchEnvelope),
      /outstanding original obligations/)
    const mediated = simulationExternalMediatedRequestSchema.parse({ scope, subjectRef: target, externalKey: 'vendor',
      sourceKind: 'director-mediated', policyRef: WORLD_EXTERNAL_MEDIATION_POLICY_REF,
      input: { kind: 'adjudicate', question: 'Report the simulated original vendor status.' },
      responseScope: { allowed: ['failure', 'delayed-event'], disclosure: { kind: 'requester' } } })
    const mediatedEnvelope = simulationWorldDomainRequestSchema.parse({ ...switchEnvelope, operation: 'interact', version: '3', payload: mediated })
    assert.throws(() => new ExternalMediatedNativeWorldDomain().admitRequest(h.run.snapshot(), h.requester,
      mediatedEnvelope), /explicit switch/)
    await dispatcher.execute(first)
    const cancelled = await transact('switch-representation', '1', request, request, false)
    assert.equal((await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-switch', requestId: cancelled.requestId }))).status, 'cancelled')
    assertRepresentationAdmission(h.run.snapshot(), target, identity.id, 'simulated-rule')
    assert.throws(() => representationSwitchRequestSchema.parse({ ...request, from: 'simulated-actor' }))
    const before = h.run.snapshot(), resources = before.resources
    const plan = await transact('switch-representation', '1', request)
    const histories = h.run.snapshot().entities[target]!.profile.externalRepresentations as Record<string, unknown[]>
    assert.equal(histories[identity.id]!.length, 1)
    const transition = histories[identity.id]![0] as Record<string, unknown>
    assert.equal(transition.generation, 2)
    assert.equal(transition.from, 'simulated-rule')
    assert.equal(transition.to, 'director-mediated')
    assert.equal(transition.memory, 'none')
    assert.deepEqual(h.run.snapshot().resources, resources)
    assert.deepEqual(h.run.snapshot().world!.external.identities[identity.id], identity)
    assert.deepEqual(h.run.snapshot().world!.external.interactions, before.world!.external.interactions)
    assert.equal(h.run.snapshot().entities[target]!.cognition, 'none')
    const current = h.run.snapshot()
    const originalMutation = Object.values(current.world!.mutations).find(value => value.planId === plan.id)!
    await h.run.commitWorldMutation({ planId: plan.id, payload: originalMutation.payload })
    assert.deepEqual(h.run.snapshot(), current)
    const envelope = simulationWorldDomainRequestSchema.parse({ kind: 'world/request', domain: 'external', operation: 'interact', version: '1',
      businessKey: 'retired', expectedTime: null, evidence: [], payload: input })
    assert.throws(() => new ExternalInteractNativeWorldDomain().admitRequest(current, h.requester, envelope), /retired representation/)
    assert.throws(() => new RepresentationNativeWorldDomain().admitRequest(current, h.requester,
      { ...envelope, operation: 'switch-representation', payload: request }), /stale generation/)
    const common = { subjectRef: target, sourceKind: 'director-mediated', policyRef: WORLD_EXTERNAL_MEDIATION_POLICY_REF,
      attribution: 'scenario-generated', evidence: [], disclosure: { kind: 'requester' } }
    const failure = { ...common, kind: 'failure', code: 'declined', description: 'No simulated offer is available.' }
    const mediatedPlan = await transact('interact', '3', z.json().parse(mediated), { kind: 'adjudicate', outcome: failure })
    assert.equal(Object.values(h.run.snapshot().world!.external.adjudications).filter(value => value.planId === mediatedPlan.id).length, 1)
    const delayedPlan = await transact('interact', '3', z.json().parse(mediated), { kind: 'adjudicate', outcome: { ...common,
      kind: 'delayed-event', key: 'retained-old-duty', deliverAt: '2', outcome: failure } })
    const reverse = representationSwitchRequestSchema.parse({ ...request, expectedGeneration: 2, from: 'director-mediated', to: 'simulated-rule' })
    assert.throws(() => new RepresentationNativeWorldDomain().admitRequest(h.run.snapshot(), h.requester,
      { ...switchEnvelope, payload: reverse }), /outstanding original obligations/)
    let driven
    for (let round = 0; round < 16; round += 1) {
      for (const wake of Object.values(h.run.snapshot().wakes)) if (wake.status === 'pending')
        await h.propose(wake.entityId, `drain-duty-${round}-${wake.eventId}`, undefined, undefined, wake.eventId)
      driven = await h.run.drive({ until: simTimeSchema.parse('2') })
      if (Object.values(h.run.snapshot().world!.external.events).some(event => event.original.planId === delayedPlan.id && event.status === 'consumed')) break
    }
    assert.ok(Object.values(h.run.snapshot().world!.external.events).some(event => event.original.planId === delayedPlan.id && event.status === 'consumed'),
      JSON.stringify({ driven, time: h.run.snapshot().time, duties: h.run.snapshot().world!.external.events }))
    await transact('switch-representation', '1', reverse)
    assert.throws(() => new ExternalMediatedNativeWorldDomain().admitRequest(h.run.snapshot(), h.requester,
      mediatedEnvelope), /retired representation/)
    await transact('interact', '1', input, { kind: 'evaluate-rule' })
    const final = h.run.snapshot()
    const finalHistory = final.entities[target]!.profile.externalRepresentations as Record<string, unknown[]>
    assert.equal(finalHistory[identity.id]!.length, 2)
    assert.deepEqual(final.world!.external.identities[identity.id], identity)
    assert.deepEqual(final.resources, resources)
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await assert.rejects(h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: target,
      entityRevision: h.run.snapshot().entities[target]!.revision, profile: {} }), h.run.snapshot().revision), /Representation history/)
    await h.connection.close(); await h.run.close()
    const reopened = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    try { assert.deepEqual(reopened.snapshot().entities[target]!.profile, final.entities[target]!.profile) }
    finally { await reopened.close() }
    return { generation: 3, from: 'simulated-rule', to: 'simulated-rule', transitions: 2,
      memory: transition.memory, originalIdentity: true, originalResources: true, replay: true,
      beforeSwitchMediatedDenied: true, afterSwitchMediatedCommitted: true, reverseRuleCommitted: true,
      pendingRequestDenied: true, pendingEventDenied: true, cancelledFenceReleased: true }
  } finally {
    await h.close()
    if (oldRoot === undefined) delete process.env.SIMULATION_COMPANY_ROOT
    else process.env.SIMULATION_COMPANY_ROOT = oldRoot
    if (oldBackend === undefined) delete process.env.SIMULATION_COMPANY_BACKEND
    else process.env.SIMULATION_COMPANY_BACKEND = oldBackend
  }
}
