import { afterEach, expect, it } from 'vitest'
import { simulationChangeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup() {
  const h = await createBusinessHarness('sqlite', { maxResourceQuantity: '100' })
  cleanups.push(h.close)
  const buyer = await h.actor('buyer'), seller = await h.actor('seller')
  await h.account('stock', seller.id, '10'); await h.account('received', buyer.id, '0')
  await h.account('other', seller.id, '0')
  await h.account('money', seller.id, '0', [seller.id], 'money', 'cent')
  await h.account('units', seller.id, '0', [seller.id], 'inventory', 'box')
  const request = { kind: 'interaction/request', id: 'order', assignee: seller.id as string, description: 'Deliver items',
    replyBy: '10' as string | null, completeBy: '20' as string | null,
    fulfillment: { kind: 'transfer', from: 'stock', to: 'received', quantity: '2' } }
  return { ...h, buyer, seller, request }
}

it.each(['assignee', 'noncognitive', 'reply-limit', 'completion-limit', 'deadlines', 'missing-from', 'missing-to',
  'same', 'kind', 'unit', 'quantity'] as const)('rejects an impossible request (%s) without creating responsibility', async (variant) => {
  const h = await setup()
  const request = structuredClone(h.request)
  let code = 'SIM_FULFILLMENT_INVALID'
  if (variant === 'assignee' || variant === 'noncognitive') {
    if (variant === 'noncognitive') await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'org',
      entityKind: 'organization', cognition: 'none', profile: {} }), h.run.snapshot().revision)
    request.assignee = variant === 'assignee' ? 'toString' : 'org'; code = 'SIM_ASSIGNEE_UNAVAILABLE'
  }
  if (variant === 'reply-limit') { request.replyBy = '101'; code = 'SIM_INTERACTION_DEADLINE_INVALID' }
  if (variant === 'completion-limit') { request.completeBy = '101'; code = 'SIM_INTERACTION_DEADLINE_INVALID' }
  if (variant === 'deadlines') { request.completeBy = '9'; code = 'SIM_INTERACTION_DEADLINE_INVALID' }
  if (variant === 'missing-from') request.fulfillment.from = 'toString'
  if (variant === 'missing-to') request.fulfillment.to = 'toString'
  if (variant === 'same') request.fulfillment.to = 'stock'
  if (variant === 'kind') request.fulfillment.to = 'money'
  if (variant === 'unit') request.fulfillment.to = 'units'
  if (variant === 'quantity') request.fulfillment.quantity = '101'
  expect(await h.apply(h.buyer.lease, variant, request)).toMatchObject({ code })
  expect(h.run.snapshot().interactions).toEqual({})
  expect(h.run.snapshot().commitments).toEqual({})
})

it('rejects duplicate requests, missing referents, unauthorized cancellation and confirmation before acceptance', async () => {
  const h = await setup()
  await h.apply(h.buyer.lease, 'request', h.request)
  expect(await h.apply(h.buyer.lease, 'duplicate', h.request)).toMatchObject({ code: 'SIM_INTERACTION_CONFLICT' })
  expect(await h.apply(h.seller.lease, 'missing', { kind: 'interaction/accept', id: 'toString', expectedRevision: 1 }))
    .toMatchObject({ code: 'SIM_INTERACTION_NOT_FOUND' })
  expect(await h.apply(h.seller.lease, 'cancel', { kind: 'interaction/cancel', id: 'order', expectedRevision: 1, reason: 'Cancel' }))
    .toMatchObject({ code: 'SIM_INTERACTION_AUTHORITY' })
  expect(await h.apply(h.buyer.lease, 'confirm', { kind: 'interaction/confirm', id: 'order', expectedRevision: 1 }))
    .toMatchObject({ code: 'SIM_COMMITMENT_NOT_FOUND' })
  await h.apply(h.seller.lease, 'accept', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })
  expect(await h.apply(h.buyer.lease, 'wrong-evidence', { kind: 'interaction/confirm', id: 'order', expectedRevision: 2 }))
    .toMatchObject({ code: 'SIM_FULFILLMENT_INVALID' })
})

it('keeps a rejected request closed even to its requester', async () => {
  const h = await setup()
  await h.apply(h.buyer.lease, 'request', h.request)
  await h.apply(h.seller.lease, 'reject', { kind: 'interaction/reject', id: 'order', expectedRevision: 1, reason: 'Unavailable' })
  expect(await h.apply(h.buyer.lease, 'cancel', { kind: 'interaction/cancel', id: 'order', expectedRevision: 2, reason: 'Cancel' }))
    .toMatchObject({ code: 'SIM_INTERACTION_CLOSED' })
})

it.each(['missing', 'closed', 'no-contribution'] as const)('rolls resource changes back when transfer evidence is %s', async (variant) => {
  const h = await setup()
  await h.apply(h.buyer.lease, 'request', h.request)
  await h.apply(h.seller.lease, 'accept', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })
  const obligation = Object.values(h.run.snapshot().commitments)[0]!
  if (variant === 'closed') await h.apply(h.buyer.lease, 'cancel', { kind: 'interaction/cancel', id: 'order',
    expectedRevision: 2, reason: 'Cancel' })
  const before = h.run.snapshot()
  const from = 'stock'
  const to = variant === 'no-contribution' ? 'other' : 'received'
  const actor = h.seller
  const result = await h.apply(actor.lease, 'delivery', { kind: 'resource/transfer', grants: [], transaction: {
    commitmentId: variant === 'missing' ? 'toString' : obligation.id,
    reads: [{ resourceId: from, revision: 1 }, { resourceId: to, revision: 1 }], transfers: [{ from, to, quantity: '1' }],
  } })
  expect(result).toMatchObject({ code: variant === 'missing' ? 'SIM_COMMITMENT_NOT_FOUND'
    : variant === 'closed' ? 'SIM_COMMITMENT_CLOSED' : 'SIM_FULFILLMENT_INVALID' })
  expect(h.run.snapshot().resources).toEqual(before.resources)
  expect(h.run.snapshot().commitments).toEqual(before.commitments)
})

it.each(['explicit', 'transfer'] as const)('keeps linked task progress independent of %s world fulfillment', async (kind) => {
  const h = await setup()
  const { simulationTaskReconcileRequestSchema } = await import('@clocky/clocky-simulation')
  await h.apply(h.buyer.lease, 'request', { ...h.request, fulfillment: kind === 'explicit' ? { kind } : h.request.fulfillment })
  await h.apply(h.seller.lease, 'accept', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })
  const interaction = Object.values(h.run.snapshot().interactions)[0]!
  await h.run.reconcileTask(simulationTaskReconcileRequestSchema.parse({ interactionId: interaction.id, expectedRevision: 2,
    task: { teamId: 'company', taskId: 'work', revision: 1, phase: 'running' } }))
  if (kind === 'explicit') {
    expect(await h.apply(h.buyer.lease, 'confirm', { kind: 'interaction/confirm', id: 'order', expectedRevision: 3 }))
      .toMatchObject({ status: 'applied' })
  } else {
    const commitment = Object.values(h.run.snapshot().commitments)[0]!
    for (const revision of [1, 2]) {
      expect(await h.apply(h.seller.lease, `delivery-${revision}`, { kind: 'resource/transfer', grants: [], transaction: {
        commitmentId: commitment.id, reads: [{ resourceId: 'stock', revision }, { resourceId: 'received', revision }],
        transfers: [{ from: 'stock', to: 'received', quantity: '1' }],
      } })).toMatchObject({ status: 'applied' })
      expect(Object.values(h.run.snapshot().commitments)[0]!.phase).toBe(revision === 1 ? 'open' : 'fulfilled')
    }
  }
  const state = h.run.snapshot()
  const fulfilled = Object.values(state.commitments)[0]!
  expect(Object.values(state.interactions)[0]).toMatchObject({ execution: 'task', task: { phase: 'running' } })
  expect(fulfilled).toMatchObject({ phase: 'fulfilled', fulfilledAt: '0' })
  expect(fulfilled.evidence).toHaveLength(kind === 'transfer' ? 2 : 1)
})


it('rejects a retained commitment evidence reference that is missing or names a non-transfer operation', async () => {
  const h = await setup()
  const { recordTransferEvidence } = await import('../src/interactions.ts')
  const { simulationOperationIdSchema } = await import('@clocky/clocky-simulation')
  await h.apply(h.buyer.lease, 'request', h.request)
  const accepted = await h.apply(h.seller.lease, 'accept', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })
  const state = h.run.snapshot()
  const obligation = Object.values(state.commitments)[0]!
  const decision = await h.submit(h.seller.lease, 'delivery', [{ after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
    commitmentId: obligation.id, reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
    transfers: [{ from: 'stock', to: 'received', quantity: '1' }],
  } } }])
  const current = h.run.snapshot()
  const operation = current.operations[decision.operationIds[0]!]!
  for (const id of [simulationOperationIdSchema.parse('missing'), accepted.operationId]) {
    expect(() => recordTransferEvidence({ ...current, commitments: {
      [obligation.id]: { ...obligation, evidence: [id] },
    } }, operation)).toThrow(/authoritative transfer/)
  }
})

it.each(['accept-first', 'cancel-first'] as const)('settles racing acceptance and cancellation in operation order (%s)', async (order) => {
  const h = await setup()
  await h.apply(h.buyer.lease, 'request', h.request)
  const accept = { kind: 'interaction/accept', id: 'order', expectedRevision: 1 }
  const cancel = { kind: 'interaction/cancel', id: 'order', expectedRevision: 1, reason: 'Withdraw' }
  const sequence = order === 'accept-first'
    ? [[h.seller.lease, accept], [h.buyer.lease, cancel]] as const
    : [[h.buyer.lease, cancel], [h.seller.lease, accept]] as const
  const first = await h.submit(sequence[0][0], 'first', [{ after: [], action: sequence[0][1] }])
  const second = await h.submit(sequence[1][0], 'second', [{ after: [], action: sequence[1][1] }])
  const results = await Promise.all([h.run.executeOperation(first.operationIds[0]!), h.run.executeOperation(second.operationIds[0]!)])
  expect(results.map(result => result.code)).toEqual(['SIM_APPLIED', 'SIM_INTERACTION_REVISION_CONFLICT'])
  expect(Object.values(h.run.snapshot().commitments)).toHaveLength(order === 'accept-first' ? 1 : 0)
  expect(Object.values(h.run.snapshot().interactions)[0]!.execution).toBe(order === 'accept-first' ? 'pending' : 'cancelled')
})
