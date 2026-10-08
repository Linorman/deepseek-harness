import { afterEach, expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationTokenReservationIdSchema, simulationCompactionTokenRequestSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'
import { assertTokenProjection, foldTokens, requireTokenReservation, tokenRecordSchema, tokenSettlementRetained } from '../src/tokens.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup() {
  const h = await createBusinessHarness('sqlite', { tokensPerModelRequest: 100 })
  cleanups.push(h.close)
  const actor = await h.actor('actor'), id = simulationDecisionIdSchema.parse('decision')
  await actor.lease.openDecision(id, h.run.snapshot().revision)
  await actor.lease.prepareContext(id, contextRequest())
  await actor.lease.startDecision(id, 0)
  const request = { provider: 'fixture', model: 'fixture', sessionSequence: 1 }
  return { ...h, actor, id, request }
}

it('requires current prepared owners for both conversation and auxiliary reservations', async () => {
  const h = await setup(), state = h.run.snapshot()
  expect(() => requireTokenReservation(state, simulationTokenReservationIdSchema.parse('toString'))).toThrow(/does not exist/)
  const record = tokenRecordSchema.parse({ kind: 'token/reserved', id: 'tokens/0', decisionId: 'missing', request: h.request })
  expect(() => foldTokens(state, record)).toThrow(/current prepared inference owner/)
  const auxiliary = tokenRecordSchema.parse({ kind: 'token/compaction-reserved', id: 'tokens/0', entityId: h.actor.id,
    epoch: h.actor.lease.epoch, request: { ...h.request, compactionId: 'auxiliary' } })
  expect(() => foldTokens({ ...state, phase: 'stalled' }, auxiliary)).toThrow(/current canonical writer/)
  const attemptId = 'cancelled-task-attempt' as never
  const operationId = 'cancelled-task-operation' as never
  const cancelled = { ...state,
    taskExecutions: { [attemptId]: { request: { attemptId, operationId,
      entityId: h.actor.id, epoch: h.actor.lease.epoch } } as never },
    taskCancellations: { [operationId]: { operationId } as never } }
  expect(() => foldTokens(cancelled, auxiliary)).toThrow(/current canonical writer/)
  const reservation = await h.actor.lease.reserveModelTokens(h.id, h.request)
  const current = h.run.snapshot()
  expect(() => requireTokenReservation(current, simulationTokenReservationIdSchema.parse('missing'))).toThrow(/does not exist/)
  expect(() => foldTokens(current, { kind: 'token/acknowledged', id: reservation.id })).toThrow(/no unacknowledged overrun/)
})

it.each(['not-dispatched', 'unknown', 'complete'] as const)('retains an exact %s settlement and rejects rewrites', async (kind) => {
  const h = await setup()
  const reservation = await h.actor.lease.reserveModelTokens(h.id, h.request)
  const outcome = kind === 'complete' ? { kind, usage: { inputTokens: 2, outputTokens: 3 } } : { kind }
  await h.actor.lease.settleModelTokens(reservation.id, outcome)
  const settled = h.run.snapshot().tokenReservations![reservation.id]!
  expect(tokenSettlementRetained(settled, outcome)).toBe(true)
  expect(() => tokenSettlementRetained(settled, kind === 'complete'
    ? { kind, usage: { inputTokens: 3, outputTokens: 3 } } : { kind: 'unknown', observedUsage: { inputTokens: 1, outputTokens: 0 } }))
    .toThrow(/changed its usage/)
  expect(() => foldTokens(h.run.snapshot(), { kind: 'token/settled', id: reservation.id, outcome })).toThrow(/already retained/)
})

it('retains partial observed usage idempotently and detects broken reservation provenance', async () => {
  const h = await setup()
  const reservation = await h.actor.lease.reserveModelTokens(h.id, h.request)
  const outcome = { kind: 'unknown' as const, observedUsage: { inputTokens: 20, outputTokens: 3 } }
  await h.actor.lease.settleModelTokens(reservation.id, outcome)
  expect(tokenSettlementRetained(h.run.snapshot().tokenReservations![reservation.id]!, outcome)).toBe(true)
  const state = h.run.snapshot()
  expect(() => { assertTokenProjection({ ...state, tokenReservations: { [reservation.id]: { ...state.tokenReservations![reservation.id]!,
    reserved: 99 } } }) }).toThrow(/ownership or usage evidence/)
  const aux = await h.actor.lease.reserveCompactionTokens(simulationCompactionTokenRequestSchema.parse({ ...h.request, compactionId: 'auxiliary' }))
  expect(aux.decisionId).toBeUndefined()
  expect(() => { assertTokenProjection(h.run.snapshot()) }).not.toThrow()
})
