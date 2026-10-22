/** Public usage shares real reservation and interval admission accounting without starting recovery. */
import { expect, it } from 'vitest'
import { budgetUsage, simulationRuntimeMetrics, simulationTokenCount, simulationCompactionTokenRequestSchema, simulationDecisionIdSchema,
  simulationBudgetGrantRequestSchema, simulationDispatchCandidateSchema, simulationDispatchSelectionRequestSchema,
  simulationTokenReservationIdSchema, simulationProposalSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

it.each(['json', 'sqlite'] as const)('projects charged unknown usage and writer slots from the actual %s owners', async (backend) => {
  const h = await createBusinessHarness(backend, { origin: '9007199254740993', maxTime: '100000000000000000000',
    budgetInterval: '100', tokensPerModelRequest: 100, maxTokensPerInterval: 200 })
  try {
    await h.run.drive({ until: simTimeSchema.parse('9007199254740993') })
    const a = await h.actor('a'), b = await h.actor('b')
    const id = simulationDecisionIdSchema.parse('metric-decision')
    await a.lease.openDecision(id, h.run.snapshot().revision)
    await a.lease.prepareContext(id, contextRequest()); await a.lease.startDecision(id, Date.now())
    const reservation = await a.lease.reserveModelTokens(id, { provider: 'fixture', model: 'scripted', sessionSequence: 1 })
    await a.lease.settleModelTokens(reservation.id, { kind: 'unknown', observedUsage: { inputTokens: 50, outputTokens: 0 } })
    expect(simulationRuntimeMetrics(h.run.snapshot(), 'this-provider').pendingDecisionCount).toBe(1)
    await a.lease.submitDecision(id, [simulationProposalSchema.parse({ after: [], action: { kind: 'communication/post',
      recipient: b.id, channelId: 'channel', text: 'Private body must not appear in metrics', deliverAt: h.run.snapshot().time } })])
    await h.run.extendBudget(simulationBudgetGrantRequestSchema.parse({ id: 'token-extra', interval: h.run.budgetUsage().interval,
      budget: 'tokens', amount: 50, reason: 'Explicit current interval grant' }), h.run.snapshot().revision)
    const before = h.run.snapshot()
    const metrics = simulationRuntimeMetrics(before, 'this-provider')
    expect(metrics).toMatchObject({ budgets: { interval: '9007199254740900', width: '100',
      tokens: { charged: 100, limit: 250, unknownAttempts: 1 }, decisions: { used: 1 }, messages: { used: 1 } },
    residentSlots: { used: 2, limit: 16, recoveryRequired: 0 }, pendingDecisionCount: 0,
    pendingExternalOperationCount: 1, unknownOperationCount: 0 })
    expect(metrics.tokenAttribution.total).toMatchObject({ attempts: 1, outstandingReservedTokens: 100,
      statuses: { unknown: 1 }, unknownReported: { inputTokens: 50, outputTokens: 0 } })
    expect(metrics.tokenAttribution.categories.unknown).toEqual(metrics.tokenAttribution.total)
    expect(metrics.budgets.tokens.charged).toBe(budgetUsage(before).tokens.used)
    expect(metrics.residentSlots.used).toBe(h.run.population().chargedActors)
    expect(JSON.stringify(metrics)).not.toContain('Private body')
    expect(h.run.snapshot()).toEqual(before)
    await h.run.queueDecision({ id: simulationDecisionIdSchema.parse('queued-b'), entityId: b.id, priority: 0 })
    expect(simulationRuntimeMetrics(h.run.snapshot(), 'this-provider').pendingDecisionCount).toBe(1)
    expect(simulationRuntimeMetrics(h.run.snapshot(), 'this-provider').budgets.decisions.used).toBe(1)
    await a.lease.revoke()
    expect(simulationRuntimeMetrics(h.run.snapshot(), 'this-provider').residentSlots).toMatchObject({ used: 2, recoveryRequired: 1 })
    expect(simulationRuntimeMetrics(h.run.snapshot(), 'unowned').residentSlots.recoveryRequired).toBe(2)
    await a.lease.release()
    expect(simulationRuntimeMetrics(h.run.snapshot(), 'this-provider').residentSlots.used).toBe(1)
    expect(simulationRuntimeMetrics(h.run.snapshot(), 'this-provider').budgets.tokens.charged).toBe(100)
  } finally { await h.close() }
})

it('refuses rounded token bucket sums and interval charges above safe integer capacity', async () => {
  expect(simulationTokenCount({ inputTokens: Number.MAX_SAFE_INTEGER - 1, outputTokens: 1 })).toBe(Number.MAX_SAFE_INTEGER)
  expect(() => simulationTokenCount({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 })).toThrow('safe integer')
  expect(() => simulationTokenCount({ inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0 }))
    .toThrow('token bucket exceeds safe integer')
  expect(() => simulationTokenCount({ inputTokens: -1, outputTokens: 0 }))
    .toThrow('token bucket exceeds safe integer')
  expect(simulationCompactionTokenRequestSchema.parse({ provider: 'fixture', model: 'scripted',
    sessionSequence: 1, compactionId: 'compact-1' }).compactionId).toBe('compact-1')
  const h = await createBusinessHarness('json')
  try {
    const a = await h.actor('a')
    const id = simulationDecisionIdSchema.parse('overflow')
    await a.lease.openDecision(id, h.run.snapshot().revision)
    await a.lease.prepareContext(id, contextRequest()); await a.lease.startDecision(id, 0)
    const reservation = await a.lease.reserveModelTokens(id, { provider: 'fixture', model: 'scripted', sessionSequence: 1 })
    const state = h.run.snapshot(), secondId = simulationTokenReservationIdSchema.parse('another-reservation')
    const changed = { ...state, tokenReservations: { [reservation.id]: { ...reservation, status: 'unknown' as const,
      reserved: Number.MAX_SAFE_INTEGER }, [secondId]: { ...reservation, id: secondId, reserved: 1 } } }
    expect(() => simulationRuntimeMetrics(changed, 'unowned')).toThrow('charged tokens exceed safe integer')
    expect(h.run.budgetUsage().tokens.used).toBe(state.spec.tokensPerModelRequest)
  } finally { await h.close() }
})

it('counts a reserved dispatch ticket as pending before its decision opens', async () => {
  const h = await createBusinessHarness('json')
  try {
    const actor = await h.actor('queued-actor')
    await h.run.queueDecision(simulationDispatchCandidateSchema.parse({ id: 'queued', entityId: actor.id, priority: 0 }))
    const request = simulationDispatchSelectionRequestSchema.parse({ id: 'reserved-window', limit: 1 })
    await h.run.reserveDecisionWindow(request, h.run.snapshot().revision)
    expect(h.run.snapshot().decisionDispatch?.tickets[simulationDecisionIdSchema.parse('queued')]?.status).toBe('reserved')
    expect(simulationRuntimeMetrics(h.run.snapshot(), 'this-provider').pendingDecisionCount).toBe(1)
  } finally { await h.close() }
})

it('counts an unsettled task creation as a pending external operation', async () => {
  const h = await createBusinessHarness('json')
  try {
    const actor = await h.actor('creator')
    const task = { subject: 'Produce evidence', description: 'Return the result', blockedBy: [], requiredCapabilities: [],
      priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1 }
    await h.submit(actor.lease, 'create-task', [{ after: [], action: { kind: 'task/create', deliverAt: '0', task } }])
    expect(simulationRuntimeMetrics(h.run.snapshot(), 'this-provider').pendingExternalOperationCount).toBe(1)
  } finally { await h.close() }
})
