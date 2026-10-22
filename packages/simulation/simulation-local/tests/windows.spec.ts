import { describe, expect, it } from 'vitest'
import { simulationChangeSchema, simulationEntityIdSchema, simulationEntityBindingSchema, simulationDecisionIdSchema, simulationProposalSchema, simulationWindowRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

describe.each(['json', 'sqlite'] as const)('%s ordered windows', (backend) => {
  it.each([false, true])('preserves resource commit order when proposal completion is reversed=%s', async (reverse) => {
    const h = await createBusinessHarness(backend)
    try {
      const a = await h.actor('a')
      const b = await h.actor('b')
      await h.account('stock', a.id, '1', [a.id, b.id])
      await h.account('a-stock', a.id, '0')
      await h.account('b-stock', b.id, '0')
      const request = simulationWindowRequestSchema.parse({ id: 'purchase', decisions: [a, b].map(actor => ({
        id: actor.id, entityId: actor.id, context: contextRequest(),
      })) })
      const opened = await h.run.openWindow(request, h.run.snapshot().revision)
      await expect(h.account('late-stock', a.id, '1')).rejects.toThrow(/window to close/)
      await expect(h.actor('late-actor')).rejects.toThrow(/administrative changes wait/)
      expect(await h.run.openWindow(request, 0)).toEqual(opened)
      const propose = async (actor: typeof a) => actor.lease.submitDecision(
        simulationDecisionIdSchema.parse(actor.id), [simulationProposalSchema.parse({
          after: [], action: { kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
            reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: `${actor.id}-stock`, revision: 1 }],
            transfers: [{ from: 'stock', to: `${actor.id}-stock`, quantity: '1' }] } },
        })])
      const first = reverse ? b : a
      const last = reverse ? a : b
      expect((await propose(first)).status).toBe('submitted')
      expect((await h.run.commitWindow(opened.id)).status).toBe('collecting')
      expect((await h.run.drive({ until: simTimeSchema.parse('1') })).reason).toBe('decision-required')
      const intent = Object.values(h.run.snapshot().operations)[0]
      if (intent !== undefined) await expect(h.run.executeOperation(intent.id)).rejects.toThrow(/window to close/)
      await propose(last)
      expect((await h.run.commitWindow(opened.id)).status).toBe('closed')
      await h.run.drive({ until: simTimeSchema.parse('0') })
      const state = h.run.snapshot()
      expect(Object.values(state.operations).map(value => [value.entityId, value.result?.status, value.result?.code])).toEqual([
        ['a', 'applied', 'SIM_APPLIED'], ['b', 'rejected', 'SIM_RESOURCE_REVISION_CONFLICT'],
      ])
      expect(Object.values(state.resources).map(value => value.quantity)).toEqual(['0', '1', '0'])
      expect(state.windows?.[opened.id]?.request).toEqual(request)
      expect(new Set(Object.values(state.decisions).map(value => value.snapshotRevision)).size).toBe(1)
    } finally { await h.close() }
  })

  it('rejects changed window inputs and retires submitted work when its writer is revoked', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('a')
      const request = simulationWindowRequestSchema.parse({ id: 'window', decisions: [{ id: 'decision', entityId: actor.id, context: contextRequest() }] })
      const window = await h.run.openWindow(request, h.run.snapshot().revision)
      await expect(h.run.openWindow({ ...request, decisions: [{ ...request.decisions[0]!, context: contextRequest(1) }] }, 0))
        .rejects.toThrow(/changed its frozen/)
      await actor.lease.submitDecision(request.decisions[0]!.id, [])
      await actor.lease.revoke()
      expect(h.run.snapshot().decisions[request.decisions[0]!.id]?.status).toBe('cancelled')
      expect((await h.run.commitWindow(window.id)).status).toBe('closed')
      expect(h.run.snapshot().operations).toEqual({})
    } finally { await h.close() }
  })

  it('enforces window capacity and requires cancellation before resuming an overflowing context', async () => {
    const h = await createBusinessHarness(backend, {
      decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536,
      maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 1,
    })
    try {
      const a = await h.actor('a')
      const b = await h.actor('b')
      const request = simulationWindowRequestSchema.parse({ id: 'capacity', decisions: [a, b].map(actor => ({
        id: actor.id, entityId: actor.id, context: contextRequest(),
      })) })
      await expect(h.run.openWindow(request, h.run.snapshot().revision)).rejects.toThrow(/configured limit/)
      expect(h.run.snapshot().windows).toBeUndefined()
      const overflow = { ...request, decisions: [{ ...request.decisions[0]!, context: contextRequest(1) }] }
      const window = await h.run.openWindow(overflow, h.run.snapshot().revision)
      expect(h.run.snapshot().phase).toBe('stalled')
      await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toThrow(/cancelled before resuming/)
      await a.lease.cancelDecision(overflow.decisions[0]!.id)
      await h.run.commitWindow(window.id)
      await h.run.setPhase('running', h.run.snapshot().revision)
      expect(h.run.snapshot().activeWindowId).toBeUndefined()
    } finally { await h.close() }
  })

  it('owns frozen context blocks independently of caller mutation', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('a')
      const other = simulationEntityIdSchema.parse('unbound')
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id: other, entityKind: 'person',
        cognition: 'agent', profile: {} }), h.run.snapshot().revision)
      const request = simulationWindowRequestSchema.parse({ id: 'owned-context', decisions: [{
        id: 'decision', entityId: actor.id, context: contextRequest(),
      }] })
      const window = await h.run.openWindow(request, h.run.snapshot().revision)
      await expect(h.run.bindEntity(other, simulationEntityBindingSchema.parse({ teamId: 'company', participantId: 'unbound', sessionId: 'unbound' }),
        h.run.snapshot().revision)).rejects.toThrow(/window to close/)
      Reflect.set(request.decisions[0]!.context.sections[0]!.blocks[0]!, 'text', 'unlogged-mutation')
      expect(JSON.stringify(h.run.snapshot())).not.toContain('unlogged-mutation')
      expect(h.run.snapshot().windows?.[window.id]?.request).toEqual(window.request)
    } finally { await h.close() }
  })
})

it.each(['json', 'sqlite'] as const)('%s preserves frozen inputs and completed proposals through pause and later ingress', async (backend) => {
  const h = await createBusinessHarness(backend)
  try {
    const first = await h.actor('first'), second = await h.actor('second')
    const request = simulationWindowRequestSchema.parse({ id: 'paused-window', decisions: [first, second].map(actor => ({
      id: actor.id, entityId: actor.id, context: contextRequest(),
    })) })
    const window = await h.run.openWindow(request, h.run.snapshot().revision)
    const secondId = request.decisions[1]!.id, firstId = request.decisions[0]!.id
    await second.lease.submitDecision(secondId, [])
    const frozen = h.run.snapshot()
    await h.run.setPhase('paused', frozen.revision)
    const { simulationIngressRequestSchema } = await import('@clocky/clocky-simulation')
    const input = await h.run.ingest(simulationIngressRequestSchema.parse({ id: 'later-input', entityId: first.id,
      source: 'operator', text: 'Apply after the frozen window', availableAt: '0' }))
    await expect(first.lease.submitDecision(firstId, [])).rejects.toThrow(/current decision authority/)
    expect((await h.run.drive({ until: simTimeSchema.parse('10') })).reason).toBe('paused')
    expect(h.run.snapshot().windows![window.id]).toEqual(frozen.windows![window.id])
    expect(h.run.snapshot().decisions).toEqual(frozen.decisions)
    await h.run.setPhase('running', h.run.snapshot().revision)
    await first.lease.submitDecision(firstId, [])
    await h.run.commitWindow(window.id)
    const completed = h.run.snapshot()
    expect(Object.values(completed.decisions).map(decision => [decision.slot, decision.status])).toEqual([['0', 'accepted'], ['1', 'accepted']])
    for (const decision of Object.values(completed.decisions)) {
      expect(decision.context).toEqual(frozen.decisions[decision.id]!.context)
      expect(JSON.stringify(decision.context)).not.toContain(input.request.text)
    }
    await h.run.drive({ until: simTimeSchema.parse('0') })
    expect(h.run.snapshot().wakes[input.eventId]!.status).toBe('pending')
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s retries partial ordered acceptance without publishing world effects early', async (backend) => {
  const { vi } = await import('vitest')
  const h = await createBusinessHarness(backend)
  try {
    const first = await h.actor('first'), second = await h.actor('second')
    await h.account('stock', first.id, '2', [first.id, second.id])
    await h.account('received', first.id, '0')
    const request = simulationWindowRequestSchema.parse({ id: 'write-failure', decisions: [first, second].map(actor => ({
      id: actor.id, entityId: actor.id, context: contextRequest(),
    })) })
    const window = await h.run.openWindow(request, h.run.snapshot().revision)
    for (const [index, actor] of [first, second].entries()) {
      await actor.lease.submitDecision(request.decisions[index]!.id, [simulationProposalSchema.parse({ after: [], action: {
        kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
          reads: [{ resourceId: 'stock', revision: index + 1 }, { resourceId: 'received', revision: index + 1 }],
          transfers: [{ from: 'stock', to: 'received', quantity: '1' }],
        },
      } })])
    }
    const stream = (h.run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
    const append = stream.append.bind(stream)
    let accepts = 0
    const interrupted = vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
      if (args[1].some(value => (value as { change?: { kind?: string } }).change?.kind === 'decision/accepted') && ++accepts === 2) {
        throw new Error('Second acceptance unavailable')
      }
      return await append(...args)
    })
    try { await expect(h.run.commitWindow(window.id)).rejects.toThrow(/Second acceptance unavailable/) }
    finally { interrupted.mockRestore() }
    const partial = h.run.snapshot()
    expect(Object.values(partial.decisions).map(value => value.status)).toEqual(['accepted', 'submitted'])
    expect(Object.values(partial.resources).map(value => value.quantity)).toEqual(['2', '0'])
    const firstOperation = Object.values(partial.operations)[0]!
    await expect(h.run.executeOperation(firstOperation.id)).rejects.toThrow(/window to close/)
    expect((await h.run.commitWindow(window.id)).status).toBe('closed')
    expect(h.run.snapshot().decisions[request.decisions[0]!.id]).toEqual(partial.decisions[request.decisions[0]!.id])
    await h.run.drive({ until: simTimeSchema.parse('0') })
    expect(Object.values(h.run.snapshot().resources).map(value => value.quantity)).toEqual(['0', '2'])
    const settled = h.run.snapshot()
    expect((await h.run.commitWindow(window.id)).status).toBe('closed')
    expect(h.run.snapshot()).toEqual(settled)
  } finally { await h.close() }
})
