import { afterEach, expect, it } from 'vitest'
import {
  simulationDecisionIdSchema, simulationEventIdSchema, simulationIngressIdSchema, simulationOperationIdSchema,
  simulationPolicyRefSchema, simulationWindowIdSchema, simulationWindowRequestSchema,
} from '@clocky/clocky-simulation'
import type { SimulationDecision, SimulationSnapshot } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'
import { acceptanceRecords, assertBusinessProjection, nextLocalOperation } from '../src/decisions.ts'
import { foldEntry } from '../src/journal.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup() {
  const h = await createBusinessHarness('sqlite')
  cleanups.push(h.close)
  const actor = await h.actor('actor')
  return { ...h, actor }
}
function fold(state: SimulationSnapshot, change: unknown): SimulationSnapshot {
  return foldEntry(state, { sequence: state.revision + 1,
    value: { kind: 'run/business', runId: state.spec.runId, expectedRevision: state.revision, change } }, state.spec, 'sqlite')
}

it('rejects replayed preparation and timing records without their current decision prerequisites', async () => {
  const h = await setup()
  const before = h.run.snapshot()
  const id = simulationDecisionIdSchema.parse('decision')
  const record = { kind: 'decision/opened', id, entityId: h.actor.id, epoch: h.actor.lease.epoch,
    slot: before.nextDecisionSlot, snapshotRevision: before.revision, entityRevision: before.entities[h.actor.id]!.revision }
  expect(() => fold({ ...before, phase: 'paused' }, record)).toThrow(/not admitting/)
  expect(() => fold(before, { ...record, slot: '9' })).toThrow(/snapshot or slot/)
  await h.actor.lease.openDecision(id, before.revision)
  const state = h.run.snapshot()
  const policy = simulationPolicyRefSchema.parse({ id: 'policy', version: '1' })
  expect(() => fold({ ...state, phase: 'paused' }, { kind: 'deterministic/selected', id, policy })).toThrow(/current prepared decision owner/)
  const selected = fold(state, { kind: 'deterministic/selected', id, policy })
  expect(() => fold(selected, { kind: 'deterministic/selected', id, policy })).toThrow(/already selected/)
  expect(() => fold(state, { kind: 'deterministic/result', id, proposals: [] })).toThrow(/unfinished selected policy/)
  expect(() => fold(state, { kind: 'decision/finished', id, finishedAt: 1 })).toThrow(/missed its deadline/)
  expect(() => fold(state, { kind: 'decision/expired', id, expiredAt: 1 })).toThrow(/no expired inference/)
  expect(() => fold({ ...state, phase: 'paused' }, { kind: 'decision/context', id, request: contextRequest() })).toThrow(/current unprepared/)
  expect(() => fold({ ...state, phase: 'paused' }, { kind: 'decision/rebased', id, reports: ['missing'] })).toThrow(/current decision authority/)
  const decision = state.decisions[id]!
  const running = { ...state, decisions: { [id]: { ...decision, inference: { startedAt: 1, deadline: 60001 } } } }
  expect(() => fold(running, acceptanceRecords(state, decision, [])[0])).toThrow(/lacks completed inference/)
  const cancelled = fold(state, { kind: 'decision/cancelled', id })
  expect(() => fold(cancelled, { kind: 'decision/cancelled', id })).toThrow(/Only an open/)
})

it('rejects broken decision ownership, timing and retained event responsibility in published projections', async () => {
  const h = await setup()
  const decision = await h.actor.lease.openDecision(simulationDecisionIdSchema.parse('decision'), h.run.snapshot().revision)
  const state = h.run.snapshot()
  const invalid = (patch: Partial<SimulationDecision>, pattern: RegExp) => {
    expect(() => { assertBusinessProjection({ ...state, decisions: { [decision.id]: { ...decision, ...patch } } }) }).toThrow(pattern)
  }
  invalid({ deterministic: { policy: simulationPolicyRefSchema.parse({ id: 'policy', version: '1' }), proposals: [] } }, /deterministic policy/)
  invalid({ ingressId: simulationIngressIdSchema.parse('missing') }, /ingress/)
  invalid({ retry: { rootDecisionId: decision.id, attempt: 1, sourceOperationId: simulationOperationIdSchema.parse('missing') } }, /retry/)
  invalid({ inference: { startedAt: 1, deadline: 2 } }, /inference timing/)
  invalid({ status: 'cancelled', cancellation: 'timeout' }, /no recorded observation/)
  expect(() => { assertBusinessProjection({ ...state, entities: {} }) }).toThrow(/owning writer epoch/)
  expect(() => { assertBusinessProjection({ ...state, activeDecisionId: simulationDecisionIdSchema.parse('other') }) })
    .toThrow(/active writer interval/)
})

it('rejects mismatched wake ownership at acceptance and cancellation even when the decision references it', async () => {
  const h = await setup()
  const decision = await h.actor.lease.openDecision(simulationDecisionIdSchema.parse('decision'), h.run.snapshot().revision)
  const state = h.run.snapshot()
  const wake = simulationEventIdSchema.parse('missing')
  const corrupt = { ...state, decisions: { [decision.id]: { ...decision, wakeId: wake } } }
  expect(() => fold(corrupt, acceptanceRecords(state, decision, [])[0])).toThrow(/scheduled wake/)
  expect(() => fold(corrupt, { kind: 'decision/cancelled', id: decision.id })).toThrow(/scheduled wake/)
})

it('rejects missing and prematurely closed windows and altered frozen membership', async () => {
  const h = await setup()
  const before = h.run.snapshot()
  const id = simulationWindowIdSchema.parse('window')
  const request = simulationWindowRequestSchema.parse({ id, decisions: [{ id: 'decision', entityId: h.actor.id, context: contextRequest() }] })
  expect(() => fold({ ...before, entities: {} }, { kind: 'window/opened', request })).toThrow(/no active writer/)
  await h.run.openWindow(request, before.revision)
  const state = h.run.snapshot()
  const selected = request.decisions[0]!.id
  expect(() => fold(state, { kind: 'window/closed', id })).toThrow(/unsettled decisions/)
  const { windows: _windows, ...withoutWindows } = state
  expect(() => { assertBusinessProjection(withoutWindows) }).toThrow(/no durable opening/)
  expect(() => { assertBusinessProjection({ ...state, activeWindowId: simulationWindowIdSchema.parse('missing') }) })
    .toThrow(/no durable opening/)
  expect(() => { assertBusinessProjection({ ...state, spec: { ...state.spec, maxDecisionsPerWindow: 0 } }) })
    .toThrow(/window admission/)
  const window = state.windows![id]!
  expect(() => { assertBusinessProjection({ ...state, windows: { [id]: { ...window, snapshotRevision: 0 } } }) })
    .toThrow(/frozen input/)
  const { activeWindowId: _active, ...inactive } = state
  expect(() => { assertBusinessProjection({ ...inactive, windows: { [id]: { ...window, status: 'closed' } } }) })
    .toThrow(/unfinished decision/)
  expect(() => fold({ ...state, phase: 'paused' }, { kind: 'decision/submitted', id: selected, proposals: [] }))
    .toThrow(/current decision authority/)
  const decision = state.decisions[selected]!
  expect(() => fold({ ...state, decisions: { [selected]: { ...decision, inference: { startedAt: 1, deadline: 60001 } } } },
    { kind: 'decision/submitted', id: selected, proposals: [] })).toThrow(/lacks completed inference/)
  const submitted = fold(state, { kind: 'decision/submitted', id: selected, proposals: [] })
  const accept = acceptanceRecords(submitted, submitted.decisions[selected]!, [])[0]!
  expect(() => fold(submitted, { ...accept, fingerprint: 'changed' })).toThrow(/submitted proposal/)
  const { submission: _submission, ...withoutSubmission } = submitted.decisions[selected]!
  expect(() => fold({ ...submitted, decisions: { [selected]: withoutSubmission } }, accept)).toThrow(/slot order/)
  expect(() => fold(submitted, { kind: 'operation/settled', id: 'missing', status: 'applied', code: 'SIM_APPLIED' }))
    .toThrow(/window closure/)
})

it('retains local operation ordering independently of projection key enumeration', async () => {
  const h = await setup()
  const request = { after: [], action: { kind: 'interaction/request', id: 'request', assignee: h.actor.id,
    description: 'Work', replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' } } }
  const first = await h.submit(h.actor.lease, 'first', [request])
  await h.submit(h.actor.lease, 'second', [request])
  const state = h.run.snapshot()
  expect(nextLocalOperation({ ...state, operations: Object.fromEntries(Object.entries(state.operations).reverse()) })?.id)
    .toBe(first.operationIds[0])
})

it('rejects outbox intents without canonical actor bindings before exposing an acceptance batch', async () => {
  const h = await setup()
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  const decision = await h.actor.lease.openDecision(simulationDecisionIdSchema.parse('decision'), h.run.snapshot().revision)
  const state = h.run.snapshot()
  const task = { subject: 'Work', description: 'Do work', blockedBy: [], requiredCapabilities: [], priority: 0,
    readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1 }
  const actions = [{ kind: 'communication/post', recipient: 'toString', channelId: 'channel', text: 'Message', deliverAt: '0' },
    { kind: 'task/create', task, deliverAt: '0' }]
  for (const action of actions) {
    const records = acceptanceRecords(state, decision, [simulationProposalSchema.parse({ after: [], action })])
    const accepted = fold(state, records[0])
    const { binding: _binding, ...withoutBinding } = state.entities[h.actor.id]!
    expect(() => fold(action.kind === 'task/create' ? { ...accepted, entities: { [h.actor.id]: withoutBinding } } : accepted, records[1]))
      .toThrow(/canonical/)
  }
})
