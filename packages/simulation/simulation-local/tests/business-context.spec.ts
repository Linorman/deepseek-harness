/** Recorded Native responsibilities stay actor-scoped, complete under the byte budget and reproducible across replay. */
import { describe, expect, it } from 'vitest'
import { simulationBusinessContextSchema, simulationDecisionIdSchema, simTimeSchema,
  simulationInteractionIdSchema, simulationChangeSchema } from '@clocky/clocky-simulation'
import type { SimulationContextPreparation } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { contextRequest } from './context-fixture.ts'
import { businessContext, businessMaterial } from '../src/business-context.ts'
import { decisionInput } from '../../simulation-team/src/input.ts'
import { simulationProposalSchema } from '@clocky/clocky-simulation'
import { prepareContext, assertContextProjection } from '../src/context.ts'

function material(context: SimulationContextPreparation) {
  if (context.status !== 'prepared') throw new Error('Expected complete business context')
  const blocks = context.view.content.flatMap(section => section.blocks).map(businessMaterial).filter(value => value !== undefined)
  return blocks.map(value => simulationBusinessContextSchema.parse(value))
}
async function fixture(backend: 'json' | 'sqlite') {
  const h = await createBusinessHarness(backend), buyer = await h.actor('buyer'), seller = await h.actor('seller'), director = await h.actor('director')
  await h.apply(buyer.lease, 'request-private-work', { kind: 'interaction/request', id: 'private-work', assignee: seller.id,
    description: 'PRIVATE-ONLY-PARTIES 中文🙂', replyBy: null, completeBy: '10', fulfillment: { kind: 'explicit' } })
  return { ...h, buyer, seller, director }
}
describe.each(['json', 'sqlite'] as const)('%s actor business context', (backend) => {
  it('reveals only actual party obligations and excludes accepted task bodies and provider metadata', async () => {
    const h = await fixture(backend)
    try {
      await h.submit(h.buyer.lease, 'private-task', [{ after: [], action: { kind: 'task/create', deliverAt: '0', task: {
        subject: 'TASK-SECRET', description: 'PROVIDER-CONFIG-SECRET', blockedBy: [], requiredCapabilities: [], priority: 0,
        readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1,
      } } }])
      const id = simulationDecisionIdSchema.parse('buyer-context')
      await h.buyer.lease.openDecision(id, h.run.snapshot().revision)
      const prepared = await h.buyer.lease.prepareContext(id, contextRequest()), [own] = material(prepared)
      expect(own).toMatchObject({ actorId: h.buyer.id, coverage: 'active-and-current-wake-only', interactions: [{
        id: 'private-work', revision: 1, selection: 'active', description: 'PRIVATE-ONLY-PARTIES 中文🙂', requester: h.buyer.id, assignee: h.seller.id,
      }], commitments: [], routes: [] })
      expect(JSON.stringify(prepared)).not.toMatch(/TASK-SECRET|PROVIDER-CONFIG-SECRET/)
      await h.buyer.lease.cancelDecision(id)
      const foreign = simulationDecisionIdSchema.parse('director-context')
      await h.director.lease.openDecision(foreign, h.run.snapshot().revision)
      const withheld = await h.director.lease.prepareContext(foreign, contextRequest())
      expect(material(withheld)).toEqual([])
      expect(JSON.stringify(withheld)).not.toContain('PRIVATE-ONLY-PARTIES')
      await h.director.lease.cancelDecision(foreign)
      await h.apply(h.seller.lease, 'accept-private-work', { kind: 'interaction/accept', id: 'private-work', expectedRevision: 1 })
      const accepted = simulationDecisionIdSchema.parse('seller-commitment')
      await h.seller.lease.openDecision(accepted, h.run.snapshot().revision)
      const [obligations] = material(await h.seller.lease.prepareContext(accepted, contextRequest()))
      expect(obligations?.commitments).toMatchObject([{ interactionId: 'private-work', debtor: h.seller.id, creditor: h.buyer.id,
        revision: 1, phase: 'open', evidence: [], selection: 'active' }])
      expect(() => simulationBusinessContextSchema.parse({ ...own, actorId: h.director.id })).toThrow(/actual business parties/)
    } finally { await h.close() }
  })

  it('includes the whole required UTF8 block at the exact budget and refuses one byte less without omitting responsibility', async () => {
    const h = await fixture(backend)
    try {
      const id = simulationDecisionIdSchema.parse('exact-context'), decision = await h.seller.lease.openDecision(id, h.run.snapshot().revision)
      const state = h.run.snapshot(), complete = prepareContext(state, decision, contextRequest())
      if (complete.status !== 'prepared') throw new Error('Unexpected fixture overflow')
      const bytes = Buffer.byteLength(JSON.stringify(complete.view.content.flatMap(section => section.blocks)), 'utf8')
      expect(prepareContext(state, decision, contextRequest(bytes))).toMatchObject({ status: 'prepared', retainedBytes: bytes, omitted: [] })
      expect(prepareContext(state, decision, contextRequest(bytes + 1))).toMatchObject({ status: 'prepared', retainedBytes: bytes })
      expect(prepareContext(state, decision, contextRequest(bytes - 1))).toMatchObject({ status: 'overflow', requiredBytes: bytes })
      const recorded = await h.seller.lease.prepareContext(id, contextRequest(bytes))
      expect(material(recorded)).toHaveLength(1)
      if (recorded.status !== 'prepared') throw new Error('Expected exact recorded block')
      expect(recorded.requiredSections).toContain('commitments')
      expect(recorded.view.sources).toContainEqual({ kind: 'run-event', runId: state.spec.runId, sequence: decision.snapshotRevision })
      const block = recorded.view.content.find(section => section.kind === 'commitments')!.blocks.at(-1)!
      const [own] = material(recorded)
      const changed = { ...recorded, view: { ...recorded.view, content: recorded.view.content.map(section => section.kind !== 'commitments'
        ? section : { ...section, blocks: [...section.blocks.slice(0, -1), { ...block, type: 'text' as const,
          text: JSON.stringify({ ...own, actorId: h.director.id }) }] }) } }
      expect(() => { assertContextProjection(h.run.snapshot(), { ...decision, context: changed }) }).toThrow()
      expect(() => prepareContext(state, decision, { ...contextRequest(), sections: contextRequest().sections.map(section =>
        section.kind !== 'commitments' ? section : { ...section, blocks: [block] }) })).toThrow(/reserved/)
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }; h.leases.splice(0)
      await h.run.close()
      const cold = await h.provider.open({ ...h.selection, mode: 'open' })
      try { expect(cold.snapshot().decisions[id]!.context).toEqual(recorded) }
      finally { await cold.close() }
    } finally { await h.close() }
  })

  it('rejects a changed Native prefix instead of relabeling newer state as the original decision snapshot', async () => {
    const h = await fixture(backend)
    try {
      const id = simulationDecisionIdSchema.parse('original-prefix'), decision = await h.seller.lease.openDecision(id, h.run.snapshot().revision)
      const original = h.run.snapshot(), value = businessContext(original, decision)
      expect(value?.source.sequence).toBe(decision.snapshotRevision)
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'later-metadata', entityKind: 'artifact',
        cognition: 'none', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
      await expect(h.seller.lease.prepareContext(id, contextRequest())).rejects.toThrow(/unchanged decision prefix/)
      const interaction = original.interactions[simulationInteractionIdSchema.parse('private-work')]!, op = original.operations[interaction.createdBy]!
      expect(() => businessContext({ ...original, operations: { ...original.operations, [op.id]: { ...op,
        result: { ...op.result!, sequence: decision.snapshotRevision + 1 } } } }, decision)).toThrow(/newer/)
    } finally { await h.close() }
  })

  it('refuses a genuinely queued cancellation applied after claim even when all current duties have disappeared', async () => {
    const h = await fixture(backend)
    try {
      const cancel = await h.submit(h.buyer.lease, 'queued-cancellation', [{ after: [], action: {
        kind: 'interaction/cancel', id: 'private-work', expectedRevision: 1, reason: 'Withdraw original work' } }])
      const id = simulationDecisionIdSchema.parse('claim-before-original-cancel')
      await h.seller.lease.openDecision(id, h.run.snapshot().revision)
      expect((await h.run.executeOperation(cancel.operationIds[0]!)).status).toBe('applied')
      expect(h.run.snapshot().interactions[simulationInteractionIdSchema.parse('private-work')]!.execution).toBe('cancelled')
      await expect(h.seller.lease.prepareContext(id, contextRequest())).rejects.toThrow(/unchanged decision prefix/)
    } finally { await h.close() }
  })

  it('selects terminal only from the received canonical message and original accepted business batch', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      await h.propose(h.requester, 'original-terminal', { kind: 'interaction/request', id: 'terminal', assignee: h.director,
        description: 'CURRENT-TERMINAL', replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' } })
      const id = simulationDecisionIdSchema.parse('original-cancel-and-notify')
      await h.connection.openDecision(h.requester, id)
      const prepared = await h.connection.prepareContext(h.requester, id, contextRequest())
      if (prepared.status !== 'prepared') throw new Error('Expected original request context')
      const agent = h.ctx.agents.get(h.run.snapshot().entities[h.requester]!.binding!.sessionId)!
      agent.session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
      agent.session.append('user/message', decisionInput(prepared.view), { surfaceOp: 'append' })
      expect(await h.ctx.sessions.flush(agent.session)).toBe(true)
      const actions = [{ after: [], action: { kind: 'interaction/cancel', id: 'terminal', expectedRevision: 1, reason: 'Withdraw' } },
        { after: [0], action: { kind: 'communication/post', recipient: h.director,
          channelId: h.run.snapshot().world!.channels[h.requester], deliverAt: '0', text: 'The original business has been cancelled.' } }]
      await h.ctx.simulationTeams.modelRequest(agent, { kind: 'observe' }, h.lifetime.signal)
      await h.ctx.simulationTeams.modelRequest(agent, { kind: 'stage', proposals: actions.map(value => simulationProposalSchema.parse(value)) },
        h.lifetime.signal)
      await h.ctx.simulationTeams.modelRequest(agent, { kind: 'submit' }, h.lifetime.signal)
      const operations = h.run.snapshot().decisions[id]!.operationIds
      await h.run.executeOperation(operations[0]!)
      await h.run.drive({ until: simTimeSchema.parse('0') })
      await h.connection.dispatchOperation(operations[1]!, () => Date.now())
      const wakeId = await h.connection.receiveOperation(operations[1]!)
      await h.run.drive({ until: simTimeSchema.parse('0') })
      const consumedId = simulationDecisionIdSchema.parse('consume-original-terminal')
      const decision = await h.connection.openDecision(h.director, consumedId, wakeId), state = h.run.snapshot()
      const result = await h.connection.prepareContext(h.director, consumedId, contextRequest()), [own] = material(result)
      expect(own).toMatchObject({ coverage: 'active-and-current-wake-only', currentWakeId: wakeId,
        interactions: [{ id: 'terminal', selection: 'current-wake', execution: 'cancelled' }] })
      const { wakeId: _wake, ...unassociated } = decision
      expect(businessContext(state, unassociated)).toBeUndefined()
    } finally { await h.close() }
  })

  it('records active reply-wake responsibility and preserves the original view after cancellation without exposing unrelated history', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const buyer = await h.actor('buyer'), seller = await h.actor('seller')
      await h.apply(buyer.lease, 'old-request', { kind: 'interaction/request', id: 'history', assignee: seller.id,
        description: 'OLD-HISTORY', replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' } })
      await h.apply(seller.lease, 'old-reject', { kind: 'interaction/reject', id: 'history', expectedRevision: 1, reason: 'No' })
      await h.apply(buyer.lease, 'deferred-request', { kind: 'interaction/request', id: 'deferred', assignee: seller.id,
        description: 'CURRENT-TERMINAL', replyBy: '10', completeBy: null, fulfillment: { kind: 'explicit' } })
      await h.apply(seller.lease, 'defer', { kind: 'interaction/defer', id: 'deferred', expectedRevision: 1, until: '2', reason: 'Wait' })
      await h.run.drive({ until: simTimeSchema.parse('2') })
      const wake = Object.values(h.run.snapshot().wakes).find(value => value.entityId === seller.id && value.status === 'pending')!
      const id = simulationDecisionIdSchema.parse('consume-reply')
      await seller.lease.openDecision(id, h.run.snapshot().revision, wake.eventId)
      const prepared = await seller.lease.prepareContext(id, contextRequest()), [own] = material(prepared)
      expect(own).toMatchObject({ coverage: 'active-and-current-wake-only',
        interactions: [{ id: 'deferred', selection: 'active', reply: 'deferred', execution: 'pending' }] })
      expect(JSON.stringify(prepared)).not.toContain('OLD-HISTORY')
      await seller.lease.submitDecision(id, [])
      await h.apply(buyer.lease, 'cancel-deferred', { kind: 'interaction/cancel', id: 'deferred', expectedRevision: 2, reason: 'Withdraw' })
      expect(h.run.snapshot().wakes[wake.eventId]?.status).toBe('completed')
      expect(h.run.snapshot().decisions[id]?.context).toEqual(prepared)
      expect(() => { assertContextProjection(h.run.snapshot(), h.run.snapshot().decisions[id]!) }).not.toThrow()
      const nextId = simulationDecisionIdSchema.parse('after-cancellation')
      const next = await seller.lease.openDecision(nextId, h.run.snapshot().revision)
      expect(businessContext(h.run.snapshot(), next)).toBeUndefined()
    } finally { await h.close() }
  })

  it('attaches only confirmed Native member routes when actual canonical actors have responsibility, without claiming live Hub verification', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      const idle = simulationDecisionIdSchema.parse('empty-business')
      await h.connection.openDecision(h.requester, idle)
      expect(material(await h.connection.prepareContext(h.requester, idle, contextRequest()))).toEqual([])
      await h.connection.cancelDecision(h.requester, idle)
      await h.propose(h.requester, 'original-business', { kind: 'interaction/request', id: 'owned-route', assignee: h.director,
        description: 'Only the real two parties receive this business', replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' } })
      const id = simulationDecisionIdSchema.parse('owned-route-context')
      const decision = await h.connection.openDecision(h.director, id)
      const state = h.run.snapshot()
      const [own] = material(await h.connection.prepareContext(h.director, id, contextRequest()))
      expect(own?.routes.length).toBeGreaterThan(0)
      expect(own?.routes.every(route => route.confirmation === 'native-confirmed-membership' && route.members.includes(h.director))).toBe(true)
      expect(businessContext({ ...state, channelReservations: Object.fromEntries(Object.entries(state.channelReservations!)
        .map(([key, value]) => [key, { ...value, confirmed: false }])) }, decision)?.routes).toEqual([])
    } finally { await h.close() }
  })
})
