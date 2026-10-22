/** Actual owner-boundary financial reservation and atomic existing-person hiring on both Native media. */
import { describe, expect, it, vi } from 'vitest'
import type { LogStream } from '@clocky/clocky-storage'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { hiringResourceReservationId } from '../src/world-hiring-resources.ts'
import { resourceAvailable } from '../src/resource-ledger.ts'
import { simulationResourceIdSchema } from '@clocky/clocky-simulation'

describe.each(['json', 'sqlite'] as const)('%s hiring resources', (backend) => {
  it.each(['generate-and-hire', 'hire-existing'] as const)('%s saves its exact original source and denies ordinary tools ownership', async (mode) => {
    const h = await hiringResourceHarness(backend, mode)
    try {
      const plan = await h.plan(), before = h.run.snapshot(), reserved = await h.reserve(plan)
      expect(reserved).toBeDefined()
      const state = h.run.snapshot(), hold = state.resourceReservations[hiringResourceReservationId(plan.id)]!
      expect(hold).toMatchObject({ actorId: h.requester, phase: 'active', createdOperationId: plan.operationId,
        world: { planId: plan.id, fee: { quantity: '6', reservationPeriod: '5' }, approvals: [] } })
      expect(hold.sequence).toBeGreaterThan(before.revision)
      expect(state.resources[simulationResourceIdSchema.parse('fee-cash')]!.quantity).toBe('10')
      expect(resourceAvailable(state, simulationResourceIdSchema.parse('fee-cash'))).toBe(4n)
      expect(state.operations[plan.operationId]!.action.kind).toBe('world/resolve')
      expect(await h.reserve(plan)).toEqual(reserved)
      expect(h.run.snapshot()).toEqual(state)
      expect(await h.propose(h.requester, 'tool-cancel', { kind: 'resource/cancel-reservation', id: hold.id, expectedRevision: 1 }))
        .toMatchObject({ status: 'blocked-authority', code: 'SIM_RESOURCE_RESERVATION_OWNER' })
      expect(await h.propose(h.requester, 'tool-pay', { kind: 'resource/commit-reservation', id: hold.id, expectedRevision: 1 }))
        .toMatchObject({ status: 'blocked-authority', code: 'SIM_RESOURCE_RESERVATION_OWNER' })
      expect(h.run.snapshot().resourceReservations[hold.id]).toEqual(hold)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })
  it('existing-person commit conserves money with original identity, assignment, result and deadline settlement', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      const plan = await h.plan(), person = h.run.snapshot().entities[h.candidate]!
      await h.reserve(plan)
      const result = await h.run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.kind === 'apply'
        ? plan.proposal.resolution.payload : {} })
      expect(result.outcome.kind).toBe('committed')
      const state = h.run.snapshot(), hold = state.resourceReservations[hiringResourceReservationId(plan.id)]!
      expect(state.entities[h.candidate]).toEqual(person)
      expect([state.resources[simulationResourceIdSchema.parse('fee-cash')]!.quantity,
        state.resources[simulationResourceIdSchema.parse('fee-payee')]!.quantity]).toEqual(['4', '6'])
      expect(hold).toMatchObject({ phase: 'committed', settlement: { kind: 'world', transition: 'committed', sequence: result.sequence } })
      expect(Object.values(state.relations).filter(value => value.relation === 'assignment' && value.subject === h.candidate)).toHaveLength(1)
      expect(await h.run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.kind === 'apply'
        ? plan.proposal.resolution.payload : {} })).toEqual(result)
      expect(h.run.snapshot()).toEqual(state)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })
})

it.each(['json', 'sqlite'] as const)('%s generated-person payment shares the actual prepared identity and original commit batch', async (backend) => {
  const h = await hiringResourceHarness(backend, 'generate-and-hire')
  try {
    const plan = await h.plan(), prepared = await h.prepareGenerated(plan)
    const before = h.run.snapshot(), id = hiringResourceReservationId(plan.id)
    expect(before.resourceReservations[id]!.phase).toBe('active')
    expect(before.entities[prepared.identities.entityId]!.readiness).toBe('preparing')
    const result = await h.run.commitWorldHire(prepared.id)
    const committed = h.run.snapshot(), hold = committed.resourceReservations[id]!
    expect(hold.settlement).toMatchObject({ kind: 'world', transition: 'committed', sequence: result.sequence })
    expect(committed.world!.reservations[prepared.id]!.updatedSequence).toBe(result.sequence)
    expect(committed.entities[prepared.identities.entityId]!.readiness).toBe('ready')
    expect(committed.entities[prepared.identities.entityId]!.binding).toEqual(prepared.identities.binding)
    expect([committed.resources[simulationResourceIdSchema.parse('fee-cash')]!.quantity,
      committed.resources[simulationResourceIdSchema.parse('fee-payee')]!.quantity]).toEqual(['4', '6'])
    expect(await h.run.commitWorldHire(prepared.id)).toEqual(result)
    expect(h.run.snapshot()).toEqual(committed)
    await h.run.finishMaintenance(prepared.request.maintenance)
    expect(h.run.snapshot().phase).toBe('paused')
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})

it.each([{ backend: 'json', mode: 'generate-and-hire' }, { backend: 'sqlite', mode: 'generate-and-hire' },
  { backend: 'json', mode: 'hire-existing' }, { backend: 'sqlite', mode: 'hire-existing' }] as const)(
  '$backend refuses insufficient $mode funds before retaining any identity or financial quote', async ({ backend, mode }) => {
    const h = await hiringResourceHarness(backend, mode, { balance: '5' })
    try {
      const plan = await h.plan(), before = h.run.snapshot()
      await expect(h.reserve(plan)).rejects.toMatchObject({ resourceFailure: 'insufficient' })
      expect(h.run.snapshot()).toEqual(before)
      expect(before.resourceReservations).toEqual({})
      expect(before.world!.reservations).toEqual({})
    } finally { await h.close() }
  })

it.each(['json', 'sqlite'] as const)('%s refuses a stale frozen payment after an independent free spend, and only explicit cancellation releases funds', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing')
  try {
    const plan = await h.plan(); await h.reserve(plan)
    await h.propose(h.requester, 'free-spend', { kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
      reads: ['fee-cash', 'fee-payee'].map(resourceId => ({ resourceId, revision: 1 })),
      transfers: [{ from: 'fee-cash', to: 'fee-payee', quantity: '1' }] } })
    const before = h.run.snapshot(), hold = before.resourceReservations[hiringResourceReservationId(plan.id)]!
    await expect(h.run.commitWorldMutation({ planId: plan.id,
      payload: plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : {} })).rejects.toThrow()
    expect(h.run.snapshot().resources).toEqual(before.resources)
    expect(h.run.snapshot().resourceReservations[hold.id]).toEqual(hold)
    expect(h.run.snapshot().world!.plans[plan.id]!.status).toBe('stale')
    expect(resourceAvailable(h.run.snapshot(), simulationResourceIdSchema.parse('fee-cash'))).toBe(3n)
    const { simulationWorldCancelRequestSchema } = await import('@clocky/clocky-simulation')
    const cancelled = await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'release-stale-case', requestId: plan.requestId }))
    expect(cancelled.status).toBe('cancelled')
    expect(resourceAvailable(h.run.snapshot(), simulationResourceIdSchema.parse('fee-cash'))).toBe(9n)
    expect(h.run.snapshot().resources).toEqual(before.resources)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s reaches the original simulated expiry without a wall clock deadline or a refunded history quota', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing', { period: '2', history: 1 })
  try {
    const plan = await h.plan(); await h.reserve(plan)
    const { simTimeSchema } = await import('@clocky/clocky-simulation')
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const paused = h.run.snapshot(); await new Promise(resolve => setTimeout(resolve, 25)); expect(h.run.snapshot()).toEqual(paused)
    await h.run.setPhase('running', h.run.snapshot().revision)
    await h.run.drive({ until: simTimeSchema.parse('2') })
    const hold = h.run.snapshot().resourceReservations[hiringResourceReservationId(plan.id)]!
    expect(hold.phase).toBe('expired')
    expect(hold.settlement).toMatchObject({ kind: 'expiry', time: '2' })
    expect(resourceAvailable(h.run.snapshot(), simulationResourceIdSchema.parse('fee-cash'))).toBe(10n)
    await expect(h.run.commitWorldMutation({ planId: plan.id,
      payload: plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : {} })).rejects.toMatchObject({ resourceFailure: 'expired' })
    expect(await h.reserve(plan)).toEqual(hold)
    expect(h.run.snapshot().resourceReservations[hold.id]).toEqual(hold)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s cancellation releases an existing-person hold without touching its identity or refunding history', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing', { history: 1 })
  try {
    const plan = await h.plan(), person = h.run.snapshot().entities[h.candidate]!
    await h.reserve(plan)
    const { simulationWorldCancelRequestSchema } = await import('@clocky/clocky-simulation')
    const cancelled = await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-original-fee', requestId: plan.requestId }))
    expect(cancelled.status).toBe('cancelled')
    expect(h.run.snapshot().entities[h.candidate]).toEqual(person)
    expect(h.run.snapshot().resourceReservations[hiringResourceReservationId(plan.id)]!.phase).toBe('cancelled')
    const next = await h.plan('new-business-key'), before = h.run.snapshot()
    await expect(h.reserve(next)).rejects.toMatchObject({ resourceFailure: 'history-limit' })
    expect(h.run.snapshot()).toEqual(before)
    expect(resourceAvailable(before, simulationResourceIdSchema.parse('fee-cash'))).toBe(10n)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s an actual revoked one-use grant makes the original reserved hire stale and cannot be revived by cancellation', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing', { grants: ['original-fee-grant'] })
  try {
    const transaction = { commitmentId: null, reads: ['fee-cash', 'fee-payee'].map(resourceId => ({ resourceId, revision: 1 })),
      transfers: [{ from: 'fee-cash', to: 'fee-payee', quantity: '6' }] }
    await h.propose(h.requester, 'grant-original-fee', { kind: 'resource/grant', id: 'original-fee-grant',
      grantee: h.requester, resources: ['fee-cash'], transaction })
    const plan = await h.plan(); await h.reserve(plan)
    await h.propose(h.requester, 'revoke-original-fee', { kind: 'resource/revoke-grant', id: 'original-fee-grant', expectedRevision: 1 })
    await expect(h.run.commitWorldMutation({ planId: plan.id,
      payload: plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : {} })).rejects.toThrow()
    expect(h.run.snapshot().resourceReservations[hiringResourceReservationId(plan.id)]!.phase).toBe('active')
    const { simulationWorldCancelRequestSchema } = await import('@clocky/clocky-simulation')
    await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-revoked-fee', requestId: plan.requestId }))
    expect(Object.values(h.run.snapshot().grants)[0]!.phase).toBe('revoked')
    expect(resourceAvailable(h.run.snapshot(), simulationResourceIdSchema.parse('fee-cash'))).toBe(10n)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s commits an original one-use grant against the actual hiring record rather than a fabricated transfer operation', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing', { grants: ['original-fee-grant'] })
  try {
    await h.propose(h.requester, 'grant-payment', { kind: 'resource/grant', id: 'original-fee-grant', grantee: h.requester,
      resources: ['fee-cash'], transaction: { commitmentId: null,
        reads: ['fee-cash', 'fee-payee'].map(resourceId => ({ resourceId, revision: 1 })),
        transfers: [{ from: 'fee-cash', to: 'fee-payee', quantity: '6' }] } })
    const plan = await h.plan(); await h.reserve(plan)
    const result = await h.run.commitWorldMutation({ planId: plan.id,
      payload: plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : {} })
    const grant = Object.values(h.run.snapshot().grants)[0]!
    expect(grant.phase).toBe('consumed')
    expect(grant.consumedBy).toBeUndefined()
    expect(grant.worldConsumption).toEqual({ intentId: result.intentId, planId: plan.id, sequence: result.sequence, time: result.time })
    expect(await h.reserve(plan)).toEqual(h.run.snapshot().resourceReservations[hiringResourceReservationId(plan.id)])
    expect(h.run.snapshot().world!.plans[plan.id]!.status).toBe('accepted')
  } finally { await h.close() }
})

it.each([{ backend: 'json', mode: 'generate-and-hire' }, { backend: 'sqlite', mode: 'generate-and-hire' },
  { backend: 'json', mode: 'hire-existing' }, { backend: 'sqlite', mode: 'hire-existing' }] as const)(
  '$backend $mode refuses a real reservation append without publishing a half hold or identity', async ({ backend, mode }) => {
    const h = await hiringResourceHarness(backend, mode)
    try {
      const plan = await h.plan(), before = h.run.snapshot()
      const stream = Reflect.get(h.run, 'stream') as LogStream, entries = await stream.read(-1, 10000)
      const append = vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('Actual fee reserve append unavailable'))
      await expect(h.reserve(plan)).rejects.toThrow('Actual fee reserve append unavailable')
      expect(h.run.snapshot()).toEqual(before)
      expect(await stream.read(-1, 10000)).toEqual(entries)
      const reserved = await h.reserve(plan); append.mockRestore()
      const after = h.run.snapshot()
      expect(await h.reserve(plan)).toEqual(reserved)
      expect(h.run.snapshot()).toEqual(after)
      expect(Object.values(after.resourceReservations)).toHaveLength(1)
      expect(after.resources[simulationResourceIdSchema.parse('fee-cash')]!.quantity).toBe('10')
    } finally { await h.close() }
  })

it.each(['json', 'sqlite'] as const)('%s retains money and original preparing identities when canonical cleanup observation is unknown', async (backend) => {
  const h = await hiringResourceHarness(backend, 'generate-and-hire')
  try {
    const plan = await h.plan(), prepared = await h.prepareGenerated(plan)
    const { simulationWorldCancelRequestSchema, simTimeSchema } = await import('@clocky/clocky-simulation')
    const cancellation = await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-preparing-fee', requestId: plan.requestId }))
    expect(cancellation.status).toBe('cancel-requested')
    const held = h.run.snapshot().resourceReservations[hiringResourceReservationId(plan.id)]!
    const failure = vi.spyOn(h.ctx.sessionPersistence, 'isUnmaterialized').mockRejectedValueOnce(new Error('Original Session observation unknown'))
    await expect(h.run.settleWorldHireCancellation(prepared.id)).rejects.toThrow('Original Session observation unknown')
    failure.mockRestore()
    expect(h.run.snapshot().resourceReservations[held.id]).toEqual(held)
    expect(resourceAvailable(h.run.snapshot(), simulationResourceIdSchema.parse('fee-cash'))).toBe(4n)
    await expect(h.run.drive({ until: simTimeSchema.parse('5') })).rejects.toThrow()
    const paused = h.run.snapshot(); await new Promise(resolve => setTimeout(resolve, 25)); expect(h.run.snapshot()).toEqual(paused)
    expect(h.run.snapshot().world!.reservations[prepared.id]!.status).toBe('cancel-requested')
    const result = await h.run.settleWorldHireCancellation(prepared.id)
    expect(result.outcome.kind).toBe('cancelled')
    expect(h.run.snapshot().resourceReservations[held.id]).toMatchObject({ phase: 'cancelled',
      settlement: { kind: 'world', transition: 'cancelled', sequence: result.sequence } })
    expect(resourceAvailable(h.run.snapshot(), simulationResourceIdSchema.parse('fee-cash'))).toBe(10n)
    expect(h.run.snapshot().entities[prepared.identities.entityId]!.readiness).toBe('abandoned')
    await h.run.finishMaintenance(prepared.request.maintenance)
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})
