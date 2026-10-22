/** Actual Native holds constrain immediate transfers, retain identity and settle by simulation clock. */
import { describe, expect, it, vi } from 'vitest'
import type { LogStream } from '@clocky/clocky-storage'
import { simulationResourceReservationIdSchema, simulationResourceIdSchema, simulationEventIdSchema, simTimeSchema,
  simulationWakeRequestSchema, simulationDecisionIdSchema, simulationProposalSchema,
  simulationTransactionSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { resourceAvailable } from '../src/resource-ledger.ts'
import { resourceReservationExpiryId, assertResourceReservationProjection, assertResourceReservationExpirySource } from '../src/resource-reservation.ts'
const holdId = simulationResourceReservationIdSchema.parse('original-hold'), cash = simulationResourceIdSchema.parse('cash')
async function fixture(backend: 'json' | 'sqlite', cap = 128) {
  const h = await createBusinessHarness(backend, { maxResourceReservationHistory: cap }), owner = await h.actor('owner'), other = await h.actor('other')
  await h.account('cash', owner.id, '10', [owner.id], 'money', 'credit')
  await h.account('payee', other.id, '0', [other.id], 'money', 'credit')
  await h.account('different-unit', other.id, '0', [other.id], 'money', 'usd')
  const tx = (quantity = '6', to = 'payee') => simulationTransactionSchema.parse({ commitmentId: null,
    reads: [cash, simulationResourceIdSchema.parse(to)].map(resourceId => ({ resourceId,
      revision: h.run.snapshot().resources[resourceId]!.revision })),
    transfers: [{ from: cash, to, quantity }] })
  const reserve = (id = 'original-hold', quantity = '6', expiresAt = '2') => ({ kind: 'resource/reserve', id,
    transaction: tx(quantity), grants: [], expiresAt })
  return { ...h, owner, other, tx, reserve }
}
describe.each(['json', 'sqlite'] as const)('%s conserved resource reservation', (backend) => {
  it('freezes original amounts without debiting, rejects a new-ID overbooking and releases only at the original consumed deadline', async () => {
    const h = await fixture(backend)
    try {
      expect((await h.apply(h.owner.lease, 'reserve', h.reserve())).status).toBe('applied')
      const active = h.run.snapshot(), hold = active.resourceReservations[holdId]!, expiryId = resourceReservationExpiryId(holdId)
      expect(active.resources[cash]!.quantity).toBe('10'); expect(resourceAvailable(active, cash)).toBe(4n)
      expect(hold).toMatchObject({ phase: 'active', revision: 1, expiresAt: '2', actorId: h.owner.id })
      expect(active.scheduledEvents[expiryId]).toMatchObject({ key: { time: '2', phase: 'deadline' }, status: 'pending',
        sourceOperationId: hold.createdOperationId, action: { kind: 'resource-reservation-expiry', id: holdId, revision: 1 } })
      expect((await h.apply(h.owner.lease, 'another-id', h.reserve('new-id', '5'))).code).toBe('SIM_RESOURCE_INSUFFICIENT')
      expect(Object.values(h.run.snapshot().resourceReservations)).toEqual([hold])
      expect((await h.apply(h.owner.lease, 'spend-held', { kind: 'resource/transfer', transaction: h.tx('5'), grants: [] })).code)
        .toBe('SIM_RESOURCE_INSUFFICIENT')
      const beforeCancel = h.run.snapshot()
      await expect(h.run.cancelEvent(expiryId, 'Skip the original expiry', beforeCancel.revision)).rejects.toThrow(/Active resource expiry/)
      expect(h.run.snapshot()).toEqual(beforeCancel)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const paused = h.run.snapshot(); await new Promise(resolve => setTimeout(resolve, 25)); expect(h.run.snapshot()).toEqual(paused)
      await h.run.setPhase('running', h.run.snapshot().revision)
      await h.run.drive({ until: simTimeSchema.parse('1') })
      expect(h.run.snapshot().resourceReservations[holdId]).toEqual(hold)
      await h.run.drive({ until: simTimeSchema.parse('2') })
      const expired = h.run.snapshot().resourceReservations[holdId]!
      expect(expired).toMatchObject({ phase: 'expired', revision: 2, settlement: { kind: 'expiry', eventId: expiryId, time: '2' } })
      expect(resourceAvailable(h.run.snapshot(), cash)).toBe(10n)
      expect(h.run.snapshot().resources[cash]!.quantity).toBe('10')
      expect((await h.apply(h.owner.lease, 'late-commit', { kind: 'resource/commit-reservation', id: holdId, expectedRevision: 2 })).code)
        .toBe('SIM_RESOURCE_RESERVATION_REVISION_CONFLICT')
      expect((await h.apply(h.owner.lease, 'retry-expired', h.reserve())).code).toBe('SIM_RESOURCE_RESERVATION_REUSED')
      expect(h.run.snapshot().resourceReservations[holdId]).toEqual(expired)
      expect(() => { assertResourceReservationProjection(h.run.snapshot()) }).not.toThrow()
    } finally { await h.close() }
  })
  it('commits one exact original payment, preserves operation retries and cancels the outstanding expiry in the same batch', async () => {
    const h = await fixture(backend)
    try {
      await h.apply(h.owner.lease, 'reserve', h.reserve())
      const commit = await h.apply(h.owner.lease, 'commit', { kind: 'resource/commit-reservation', id: holdId, expectedRevision: 1 })
      expect(commit.status).toBe('applied')
      const done = h.run.snapshot(), hold = done.resourceReservations[holdId]!
      expect(done.resources[cash]!.quantity).toBe('4'); expect(done.resources[simulationResourceIdSchema.parse('payee')]!.quantity).toBe('6')
      expect(resourceAvailable(done, cash)).toBe(4n)
      expect(done.scheduledEvents[resourceReservationExpiryId(holdId)]!.status).toBe('cancelled')
      expect(hold.settlement).toMatchObject({ kind: 'operation', operationId: commit.operationId, sequence: commit.sequence })
      expect(await h.run.executeOperation(commit.operationId)).toEqual(commit); expect(h.run.snapshot()).toEqual(done)
      expect((await h.apply(h.owner.lease, 'commit-again', { kind: 'resource/commit-reservation', id: holdId, expectedRevision: 1 })).code)
        .toBe('SIM_RESOURCE_RESERVATION_REVISION_CONFLICT')
      expect(h.run.snapshot().resources).toEqual(done.resources)
      expect((await h.apply(h.other.lease, 'steal-cancel', { kind: 'resource/cancel-reservation', id: holdId, expectedRevision: 2 })).code)
        .toBe('SIM_RESOURCE_RESERVATION_AUTHORITY')
    } finally { await h.close() }
  })
  it('retains cancelled history under its frozen quota and rejects changed actor/payload, invalid units and deadlines', async () => {
    const h = await fixture(backend, 1)
    try {
      await h.apply(h.owner.lease, 'reserve', h.reserve())
      expect((await h.apply(h.other.lease, 'same-id-another-actor', h.reserve())).code).toBe('SIM_RESOURCE_RESERVATION_CONFLICT')
      expect((await h.apply(h.owner.lease, 'same-id-changed-body', h.reserve('original-hold', '7'))).code).toBe('SIM_RESOURCE_RESERVATION_CONFLICT')
      expect((await h.apply(h.owner.lease, 'cancel', { kind: 'resource/cancel-reservation', id: holdId, expectedRevision: 1 })).status).toBe('applied')
      expect((await h.apply(h.owner.lease, 'quota-bypass', h.reserve('another-id'))).code).toBe('SIM_RESOURCE_RESERVATION_HISTORY_LIMIT')
      expect(resourceAvailable(h.run.snapshot(), cash)).toBe(10n)
      expect(h.run.snapshot().resources[cash]!.quantity).toBe('10')
    } finally { await h.close() }
    const k = await fixture(backend)
    try {
      for (const expiresAt of ['0', '101']) expect((await k.apply(k.owner.lease, `bad-time-${expiresAt}`, k.reserve('bad-time', '1', expiresAt))).code)
        .toBe('SIM_RESOURCE_RESERVATION_DEADLINE_INVALID')
      expect((await k.apply(k.owner.lease, 'unit-mismatch', { ...k.reserve('unit'), transaction: k.tx('1', 'different-unit') })).code)
        .toBe('SIM_RESOURCE_UNIT_MISMATCH')
      expect((await k.apply(k.other.lease, 'no-authority', k.reserve('no-authority'))).code).toBe('SIM_RESOURCE_AUTHORITY')
      expect(k.run.snapshot().resourceReservations).toEqual({})
    } finally { await k.close() }
  })
  it('locks exact one-use grants across reservation IDs and rechecks a revoked original grant before paying', async () => {
    const h = await fixture(backend)
    try {
      const transaction = h.tx('3')
      await h.apply(h.owner.lease, 'grant', { kind: 'resource/grant', id: 'payment-grant', grantee: h.other.id, resources: [cash], transaction })
      const reserve = { kind: 'resource/reserve', id: 'original-hold', transaction, grants: ['payment-grant'], expiresAt: '3' }
      expect((await h.apply(h.other.lease, 'reserve-granted', reserve)).status).toBe('applied')
      expect((await h.apply(h.other.lease, 'second-held-grant', { ...reserve, id: 'other-hold' })).code).toBe('SIM_GRANT_RESERVED')
      expect((await h.apply(h.other.lease, 'use-held-grant', { kind: 'resource/transfer', transaction, grants: ['payment-grant'] })).code)
        .toBe('SIM_GRANT_RESERVED')
      await h.apply(h.owner.lease, 'revoke', { kind: 'resource/revoke-grant', id: 'payment-grant', expectedRevision: 1 })
      expect((await h.apply(h.other.lease, 'commit-revoked', { kind: 'resource/commit-reservation', id: holdId, expectedRevision: 1 })).code)
        .toBe('SIM_GRANT_USED')
      expect(h.run.snapshot().resources[cash]!.quantity).toBe('10')
      await h.apply(h.other.lease, 'cancel', { kind: 'resource/cancel-reservation', id: holdId, expectedRevision: 1 })
      expect(Object.values(h.run.snapshot().grants)[0]!.phase).toBe('revoked')
    } finally { await h.close() }
  })
  it('refuses stale account reads and forged expiry sources without publishing partial balances', async () => {
    const h = await fixture(backend)
    try {
      await h.apply(h.owner.lease, 'reserve', h.reserve())
      const before = h.run.snapshot(), event = before.scheduledEvents[resourceReservationExpiryId(holdId)]!
      expect(() => assertResourceReservationExpirySource(before, { ...event, id: simulationEventIdSchema.parse(`${event.id}:copy`) })).toThrow()
      expect(() => assertResourceReservationExpirySource(before, { ...event, key: { ...event.key, time: simTimeSchema.parse('3') } })).toThrow()
      await h.apply(h.owner.lease, 'independent-free-transfer', { kind: 'resource/transfer', transaction: h.tx('1'), grants: [] })
      expect((await h.apply(h.owner.lease, 'stale-commit', { kind: 'resource/commit-reservation', id: holdId, expectedRevision: 1 })).code)
        .toBe('SIM_RESOURCE_REVISION_CONFLICT')
      expect(h.run.snapshot().resources[cash]!.quantity).toBe('9'); expect(resourceAvailable(h.run.snapshot(), cash)).toBe(3n)
    } finally { await h.close() }
  })
})


it.each(['json', 'sqlite'] as const)('%s refuses commitment at the exact expiry time even before the later deadline phase is consumed', async (backend) => {
  const h = await fixture(backend)
  try {
    await h.apply(h.owner.lease, 'reserve', h.reserve())
    const wakeId = simulationEventIdSchema.parse('same-time-commit')
    await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: wakeId, entityId: h.owner.id, time: '2',
      reason: 'An original independent actor decision at the expiry boundary' }), h.run.snapshot().revision)
    expect((await h.run.drive({ until: simTimeSchema.parse('2') })).reason).toBe('decision-required')
    expect(h.run.snapshot().time).toBe('2'); expect(h.run.snapshot().resourceReservations[holdId]!.phase).toBe('active')
    const decisionId = simulationDecisionIdSchema.parse('exact-expiry-commit')
    await h.owner.lease.openDecision(decisionId, h.run.snapshot().revision, wakeId)
    const accepted = await h.owner.lease.submitDecision(decisionId, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'resource/commit-reservation', id: holdId, expectedRevision: 1 } })])
    const result = await h.run.executeOperation(accepted.operationIds[0]!)
    expect(result.code).toBe('SIM_RESOURCE_RESERVATION_EXPIRED')
    expect(h.run.snapshot().resources[cash]!.quantity).toBe('10')
    await h.run.drive({ until: simTimeSchema.parse('2') })
    expect(h.run.snapshot().resourceReservations[holdId]!.phase).toBe('expired')
  } finally { await h.close() }
})


it.each(['json', 'sqlite'] as const)('%s retains hold, balances and original expiry together when their real storage append fails', async (backend) => {
  for (const settlement of ['reserve', 'commit', 'cancel', 'expiry'] as const) {
    const h = await fixture(backend)
    try {
      if (settlement !== 'reserve') await h.apply(h.owner.lease, 'reserve', h.reserve())
      const action = settlement === 'reserve' ? h.reserve() : {
        kind: settlement === 'commit' ? 'resource/commit-reservation' : 'resource/cancel-reservation', id: holdId, expectedRevision: 1 }
      const accepted = settlement === 'expiry' ? undefined : await h.submit(h.owner.lease, 'settle', [{ after: [], action }])
      const before = h.run.snapshot()
      // The real backend and fold remain in place; only the next durability boundary rejects.
      const stream = (h.run as unknown as { stream: LogStream }).stream
      const originalJournal = await stream.read(-1, 10000)
      const append = vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('resource durability unavailable'))
      const execute = () => accepted === undefined ? h.run.drive({ until: simTimeSchema.parse('2') })
        : h.run.executeOperation(accepted.operationIds[0]!)
      await expect(execute()).rejects.toThrow('resource durability unavailable')
      expect(h.run.snapshot()).toEqual(before)
      expect(await stream.read(-1, 10000)).toEqual(originalJournal)
      await execute(); append.mockRestore()
      const after = h.run.snapshot(), hold = after.resourceReservations[holdId]!
      expect(hold.phase).toBe(settlement === 'reserve' ? 'active' : settlement === 'commit' ? 'committed'
        : settlement === 'cancel' ? 'cancelled' : 'expired')
      expect(after.resources[cash]!.quantity).toBe(settlement === 'commit' ? '4' : '10')
      expect(after.scheduledEvents[resourceReservationExpiryId(holdId)]!.status).toBe(settlement === 'reserve' ? 'pending'
        : settlement === 'expiry' ? 'consumed' : 'cancelled')
      expect(() => { assertResourceReservationProjection(after) }).not.toThrow()
      if (accepted !== undefined) {
        await execute(); expect(h.run.snapshot()).toEqual(after)
      }
    } finally { await h.close() }
  }
})
