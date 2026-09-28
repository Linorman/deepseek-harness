import { afterEach, expect, it } from 'vitest'
import { simulationChangeSchema, simulationResourceSpecSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup() {
  const h = await createBusinessHarness('sqlite', { maxResourceQuantity: '100' })
  cleanups.push(h.close)
  const owner = await h.actor('owner'), buyer = await h.actor('buyer'), stranger = await h.actor('stranger')
  await h.account('from', owner.id, '10')
  await h.account('to', buyer.id, '95')
  await h.account('money', owner.id, '0', [owner.id], 'money', 'cent')
  await h.account('units', owner.id, '0', [owner.id], 'inventory', 'box')
  const transaction = { commitmentId: null, reads: [{ resourceId: 'from', revision: 1 }, { resourceId: 'to', revision: 1 }],
    transfers: [{ from: 'from', to: 'to', quantity: '1' }] }
  return { ...h, owner, buyer, stranger, transaction }
}

it('rejects invalid initial resource identities, duplicates and bounds before publication', async () => {
  const h = await setup()
  const before = h.run.snapshot()
  const base = { id: 'new', owner: h.owner.id, controllers: [h.owner.id], kind: 'inventory', unit: 'item', quantity: '0' }
  for (const [spec, error] of [
    [{ ...base, id: 'from' }, /already exists/],
    [{ ...base, owner: 'missing' }, /active entities/],
    [{ ...base, controllers: ['missing'] }, /active entities/],
    [{ ...base, controllers: [h.owner.id, h.owner.id] }, /distinct/],
    [{ ...base, quantity: '101' }, /maximum/],
  ] as const) await expect(h.run.createResource(simulationResourceSpecSchema.parse(spec), before.revision)).rejects.toThrow(error)
  expect(h.run.snapshot()).toEqual(before)
})

const transferCases = [
  ['duplicate-read', 'SIM_RESOURCE_READ_SET_INVALID'], ['missing-read', 'SIM_RESOURCE_READ_SET_INVALID'],
  ['extra-read', 'SIM_RESOURCE_READ_SET_INVALID'], ['unknown-resource', 'SIM_RESOURCE_NOT_FOUND'],
  ['cycle', 'SIM_RESOURCE_CYCLIC_TRANSFER'], ['kind', 'SIM_RESOURCE_UNIT_MISMATCH'], ['unit', 'SIM_RESOURCE_UNIT_MISMATCH'],
  ['quantity-limit', 'SIM_RESOURCE_LIMIT'], ['balance-limit', 'SIM_RESOURCE_LIMIT'],
  ['duplicate-grant', 'SIM_GRANT_DUPLICATE'], ['missing-grant', 'SIM_GRANT_NOT_FOUND'],
] as const
it.each(transferCases)('keeps resources unchanged for %s', async (variant, code) => {
  const h = await setup()
  const transaction = structuredClone(h.transaction)
  let grants: string[] = []
  if (variant === 'duplicate-read') transaction.reads.push(transaction.reads[0]!)
  if (variant === 'missing-read') transaction.reads.pop()
  if (variant === 'extra-read') transaction.reads[1] = { resourceId: 'money', revision: 1 }
  if (variant === 'unknown-resource') {
    transaction.reads[0]!.resourceId = 'toString'; transaction.transfers[0]!.from = 'toString'
  }
  if (variant === 'cycle') transaction.transfers.push({ from: 'to', to: 'from', quantity: '1' })
  if (variant === 'kind' || variant === 'unit') {
    const target = variant === 'kind' ? 'money' : 'units'
    transaction.reads[1]!.resourceId = target; transaction.transfers[0]!.to = target
  }
  if (variant === 'quantity-limit') transaction.transfers[0]!.quantity = '101'
  if (variant === 'balance-limit') transaction.transfers[0]!.quantity = '6'
  if (variant === 'duplicate-grant') grants = ['missing', 'missing']
  if (variant === 'missing-grant') grants = ['toString']
  const before = h.run.snapshot()
  expect(await h.apply(h.owner.lease, variant, { kind: 'resource/transfer', transaction, grants }))
    .toMatchObject({ status: 'rejected', code })
  expect(h.run.snapshot().resources).toEqual(before.resources)
  expect(h.run.snapshot().grants).toEqual(before.grants)
})

it.each([
  ['grantee', 'SIM_GRANTEE_UNAVAILABLE'], ['duplicate', 'SIM_GRANT_RESOURCES_INVALID'],
  ['not-debit', 'SIM_GRANT_RESOURCES_INVALID'], ['authority', 'SIM_RESOURCE_AUTHORITY'],
] as const)('does not publish an invalid grant (%s)', async (variant, code) => {
  const h = await setup()
  const action = { kind: 'resource/grant', id: 'grant', grantee: h.buyer.id as string, resources: ['from'], transaction: h.transaction }
  if (variant === 'grantee') action.grantee = 'toString'
  if (variant === 'duplicate') action.resources.push('from')
  if (variant === 'not-debit') action.resources = ['to']
  const lease = variant === 'authority' ? h.stranger.lease : h.owner.lease
  expect(await h.apply(lease, variant, action)).toMatchObject({ code })
  expect(h.run.snapshot().grants).toEqual({})
})

it('rejects duplicate grants and absent, stale or already revoked grant changes', async () => {
  const h = await setup()
  const action = { kind: 'resource/grant', id: 'grant', grantee: h.buyer.id, resources: ['from'], transaction: h.transaction }
  await h.apply(h.owner.lease, 'grant', action)
  expect(await h.apply(h.owner.lease, 'duplicate', action)).toMatchObject({ code: 'SIM_GRANT_CONFLICT' })
  expect(await h.apply(h.owner.lease, 'missing', { kind: 'resource/revoke-grant', id: 'toString', expectedRevision: 1 }))
    .toMatchObject({ code: 'SIM_GRANT_NOT_FOUND' })
  expect(await h.apply(h.owner.lease, 'stale', { kind: 'resource/revoke-grant', id: 'grant', expectedRevision: 2 }))
    .toMatchObject({ code: 'SIM_GRANT_REVISION_CONFLICT' })
  await h.apply(h.owner.lease, 'revoke', { kind: 'resource/revoke-grant', id: 'grant', expectedRevision: 1 })
  expect(await h.apply(h.owner.lease, 'again', { kind: 'resource/revoke-grant', id: 'grant', expectedRevision: 2 }))
    .toMatchObject({ code: 'SIM_GRANT_REVISION_CONFLICT' })
})

it('does not consume a grant whose issuer became inactive after consent', async () => {
  const h = await setup()
  await h.apply(h.owner.lease, 'grant', { kind: 'resource/grant', id: 'grant', grantee: h.buyer.id,
    resources: ['from'], transaction: h.transaction })
  await h.owner.lease.revoke(); await h.owner.lease.release()
  await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: h.owner.id,
    entityRevision: h.run.snapshot().entities[h.owner.id]!.revision, phase: 'inactive' }), h.run.snapshot().revision)
  const before = h.run.snapshot()
  expect(await h.apply(h.buyer.lease, 'use', { kind: 'resource/transfer', transaction: h.transaction, grants: ['grant'] }))
    .toMatchObject({ code: 'SIM_GRANT_AUTHORITY', status: 'blocked-authority' })
  expect(h.run.snapshot().resources).toEqual(before.resources)
  expect(h.run.snapshot().grants).toEqual(before.grants)
})

it('retains an accepted operation but denies its effects after entity termination', async () => {
  const h = await setup()
  const decision = await h.submit(h.owner.lease, 'before-termination', [{ after: [],
    action: { kind: 'resource/transfer', transaction: h.transaction, grants: [] } }])
  await h.owner.lease.revoke(); await h.owner.lease.release()
  await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: h.owner.id,
    entityRevision: h.run.snapshot().entities[h.owner.id]!.revision, phase: 'terminated' }), h.run.snapshot().revision)
  expect(await h.run.executeOperation(decision.operationIds[0]!)).toMatchObject({ code: 'SIM_ENTITY_UNAVAILABLE' })
})
