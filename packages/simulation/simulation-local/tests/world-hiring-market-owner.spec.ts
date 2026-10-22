/** Real JSON/SQLite append queues serialize competing previously accepted market plans. */
import { describe, expect, it } from 'vitest'
import { WORLD_HIRING_MARKET_PIN, hiringMarket, simulationEntityIdSchema, simulationRelationIdSchema,
  simTimeSchema, simulationWakeRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationEntityId, SimulationEventId, SimulationWorldPlan } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

async function owner(backend: 'json' | 'sqlite') {
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.tmp/world-post-mvp',
    installedPins: [WORLD_HIRING_MARKET_PIN], capacity: 2, requestHistory: 48, actorRequests: 48,
    residentLimit: 3, balance: '20', contextBytes: 524288, microstepLimit: 256, decisionLimit: 256,
    extraOperationGrants: ['buyer', 'fee-candidate'].map(actor => ({ requesterEntityId: simulationEntityIdSchema.parse(actor),
      domain: 'organization', operation: 'hiring-market', version: '1', scopeEntityId: simulationEntityIdSchema.parse('fee-org'),
      targetEntityId: simulationEntityIdSchema.parse('fee-vacancy'), relationId: simulationRelationIdSchema.parse(`market:${actor}`), relation: 'can-market' })) })
  let serial = 0
  const activated = new Set<SimulationEntityId>([h.requester, h.director])
  const resident = async (actor: SimulationEntityId) => {
    await h.connection.ensureResident(actor, { activation: { provider: 'in-process', seed: { kind: activated.has(actor) ? 'resume' : 'fresh' },
      agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal },
    evict: [h.requester, h.director, h.candidate].filter(id => id !== actor) })
    activated.add(actor)
    await h.start()
  }
  const drain = async (target?: SimulationEventId, until = h.run.snapshot().time) => {
    for (let round = 0; round < 128; round++) {
      await h.run.drive({ until: simTimeSchema.parse(until) })
      const state = h.run.snapshot()
      if (target !== undefined && state.wakes[target]?.status === 'pending') return
      const wake = Object.values(state.wakes).find(value => value.status === 'pending')
      if (wake !== undefined) {
        await resident(wake.entityId)
        await h.propose(wake.entityId, `drain:${serial++}`, undefined, undefined, wake.eventId)
        continue
      }
      const operation = Object.values(state.operations).find(value => value.outbox?.ready && value.result === undefined)
      if (operation !== undefined) {
        await h.connection.dispatchOperation(operation.id, Date.now)
        await h.connection.receiveOperation(operation.id)
        continue
      }
      if (target === undefined && state.time === until) return
    }
    throw new Error('Market owner did not reach its actual scheduler boundary')
  }
  const plan = async (actor: SimulationEntityId, body: object, commit = true) => {
    await drain()
    await resident(actor)
    const key = `market-owner:${serial++}`
    const payload = { organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy', ...body }
    await h.propose(actor, `${key}/request`, { kind: 'world/request', domain: 'organization', operation: 'hiring-market',
      version: '1', businessKey: key, expectedTime: null, evidence: [], payload }, { kind: 'goal' })
    const request = Object.values(h.run.snapshot().world!.requests).find(value => value.proposal.businessKey === key)!
    await h.run.drive({ until: simTimeSchema.parse(h.run.snapshot().time) })
    if (request.notificationOperationId === null) throw new Error('Market request lost its original private notification')
    await h.connection.dispatchOperation(request.notificationOperationId, Date.now)
    const wake = await h.connection.receiveOperation(request.notificationOperationId)
    await drain(wake)
    await resident(h.director)
    await h.propose(h.director, `${key}/resolve`, { kind: 'world/resolve', requestId: request.id, supersedes: null,
      resolution: { kind: 'apply', rationale: 'Preserve the actual actor command for serialized commit.', payload } },
    { kind: 'resolve', requestId: request.id }, wake)
    const selected = Object.values(h.run.snapshot().world!.plans).find(value => value.requestId === request.id)!
    if (commit) await h.run.commitWorldMutation({ planId: selected.id, payload })
    return { plan: selected, input: { planId: selected.id, payload } }
  }
  await plan(h.requester, { kind: 'vacancy', id: 'vacancy', validUntil: '90', capacity: 2, requirements: [], reservationPolicy: 'on-acceptance' })
  await plan(h.candidate, { kind: 'application', id: 'application', vacancyId: 'vacancy' })
  const offer = async (id: string) => {
    await drain(); await resident(h.requester); await resident(h.director)
    const hired = await h.plan(`hire:${id}`)
    await plan(h.requester, { kind: 'offer', id, expectedRevision: 0, planId: hired.id, vacancyId: 'vacancy', applicationId: 'application',
      candidateId: h.candidate, validUntil: '5', terms: 'Original one-time terms.' })
    const value = hiringMarket(h.run.snapshot()).offers.get(id)!
    const response = { kind: 'offer-response', id, revision: value.revision, bodyHash: value.bodyHash }
    await plan(h.requester, { ...response, decision: 'delivered' })
    return { hired, response }
  }
  const cold = async () => {
    await h.connection.close(); await h.run.close()
    return (await h.ctx.simulations.inspect({ provider: h.selection.provider, spec: h.selection.spec }))!.snapshot
  }
  return { h, plan, offer, drain, cold }
}

const commitHire = async (h: Awaited<ReturnType<typeof owner>>['h'], plan: SimulationWorldPlan) => {
  if (plan.proposal.resolution.kind !== 'apply') throw new Error('Expected original apply plan')
  return await h.run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.payload })
}

describe.each(['json', 'sqlite'] as const)('%s original hiring owner queue', (backend) => {
  it.each(['accepted', 'withdrawn'] as const)('serializes concurrent acceptance and withdrawal with %s first', async (first) => {
    const o = await owner(backend), { h } = o
    try {
      const offer = await o.offer('offer')
      const accept = await o.plan(h.candidate, { ...offer.response, decision: 'accepted' }, false)
      const withdraw = await o.plan(h.requester, { ...offer.response, decision: 'withdrawn' }, false)
      const inputs = first === 'accepted' ? [accept.input, withdraw.input] : [withdraw.input, accept.input]
      const results = await Promise.allSettled(inputs.map(input => h.run.commitWorldMutation(input)))
      expect(results.map(value => value.status)).toEqual(['fulfilled', 'rejected'])
      expect(hiringMarket(h.run.snapshot()).offers.get('offer')?.status).toBe(first)
      if (first === 'accepted') {
        await commitHire(h, offer.hired)
        expect(await commitHire(h, offer.hired)).toEqual(Object.values(h.run.snapshot().world!.results)
          .find(value => value.source.kind === 'plan' && value.source.planId === offer.hired.id))
      }
      const state = await o.cold()
      expect(hiringMarket(state).offers.get('offer')?.status).toBe(first)
      expect(Object.values(state.relations).filter(value => value.subject === h.candidate && value.relation === 'assignment'))
        .toHaveLength(first === 'accepted' ? 1 : 0)
      expect(Object.values(state.resources).find(value => value.id === 'fee-cash')?.quantity).toBe(first === 'accepted' ? '14' : '20')
    } finally { await h.close() }
  }, 30000)
  it('serializes two incompatible accepted plans before a single original fee and assignment commit', async () => {
    const o = await owner(backend), { h } = o
    try {
      const first = await o.offer('first'), second = await o.offer('second')
      const a = await o.plan(h.candidate, { ...first.response, decision: 'accepted' }, false)
      const b = await o.plan(h.candidate, { ...second.response, decision: 'accepted' }, false)
      const outcomes = await Promise.allSettled([a.input, b.input].map(input => h.run.commitWorldMutation(input)))
      expect(outcomes.map(value => value.status)).toEqual(['fulfilled', 'rejected'])
      await commitHire(h, first.hired)
      await expect(commitHire(h, second.hired)).rejects.toThrow()
      const state = await o.cold()
      expect([...hiringMarket(state).offers.values()].filter(value => value.status === 'accepted')).toHaveLength(1)
      expect(Object.values(state.resourceReservations).filter(value => value.phase === 'committed')).toHaveLength(1)
      expect(Object.values(state.relations).filter(value => value.subject === h.candidate && value.relation === 'assignment')).toHaveLength(1)
      expect(Object.values(state.resources).find(value => value.id === 'fee-cash')?.quantity).toBe('14')
    } finally { await h.close() }
  }, 30000)
  it.each([false, true])('serializes the simulation deadline with candidate acceptance beforeDeadline=%s', async (beforeDeadline) => {
    const o = await owner(backend), { h } = o
    try {
      const offer = await o.offer('offer')
      const accepted = await o.plan(h.candidate, { ...offer.response, decision: 'accepted' }, false)
      if (beforeDeadline) await h.run.commitWorldMutation(accepted.input)
      await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'owner-deadline', entityId: h.requester,
        time: '5', reason: 'Retain the actual simulation-time race boundary.' }), h.run.snapshot().revision)
      await o.drain(undefined, simTimeSchema.parse('5'))
      if (beforeDeadline) {
        const hold = Object.values(h.run.snapshot().resourceReservations)[0]!
        expect(hold.phase).toBe('active')
        expect(hold.world?.expiryConsumed?.time).toBe('5')
        await commitHire(h, offer.hired)
      } else {
        await expect(h.run.commitWorldMutation(accepted.input)).rejects.toThrow()
        await o.plan(h.requester, { ...offer.response, decision: 'expired' })
        await expect(commitHire(h, offer.hired)).rejects.toThrow()
      }
      const state = await o.cold()
      expect(hiringMarket(state).offers.get('offer')?.status).toBe(beforeDeadline ? 'accepted' : 'expired')
      expect(Object.values(state.relations).filter(value => value.subject === h.candidate && value.relation === 'assignment'))
        .toHaveLength(beforeDeadline ? 1 : 0)
      expect(Object.values(state.resources).find(value => value.id === 'fee-cash')?.quantity).toBe(beforeDeadline ? '14' : '20')
    } finally { await h.close() }
  }, 30000)

})
