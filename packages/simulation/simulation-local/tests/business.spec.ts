import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  simulationDecisionIdSchema, simulationProposalSchema,
} from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { createBusinessHarness } from './business-harness.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup(backend: 'json' | 'sqlite') {
  const fixture = await createBusinessHarness(backend)
  cleanups.push(fixture.close)
  return fixture
}

function transfer(from: string, to: string, quantity: string, fromRevision = 1, toRevision = 1, grants: string[] = []) {
  return { kind: 'resource/transfer', transaction: {
    commitmentId: null,
    reads: [{ resourceId: from, revision: fromRevision }, { resourceId: to, revision: toRevision }],
    transfers: [{ from, to, quantity }],
  }, grants }
}

describe.each(['json', 'sqlite'] as const)('%s accepted business responsibility', (backend) => {
  it('stages an atomic intent batch and returns the original transfer result after restart', async () => {
    const { run, provider, selection, actor, account, submit, leases } = await setup(backend)
    const buyer = await actor('buyer')
    await account('funds', buyer.id, '100', [buyer.id], 'money', 'cent')
    await account('reserved', buyer.id, '0', [buyer.id], 'money', 'cent')
    const proposal = { after: [], action: transfer('funds', 'reserved', '25') }
    const accepted = await submit(buyer.lease, 'reserve-funds', [proposal])
    expect(Object.values(run.snapshot().resources).map(value => value.quantity)).toEqual(['100', '0'])
    expect(accepted.operationIds).toHaveLength(1)
    expect(await buyer.lease.submitDecision(accepted.id, [simulationProposalSchema.parse(proposal)])).toEqual(accepted)
    await expect(buyer.lease.submitDecision(accepted.id, [simulationProposalSchema.parse({ after: [], action: transfer('funds', 'reserved', '26') })])).rejects.toThrow(/different payload/)
    const id = accepted.operationIds[0]
    if (id === undefined) throw new Error('fixture intent missing')
    await buyer.lease.revoke(); await buyer.lease.release()
    const result = await run.executeOperation(id)
    expect(result.status).toBe('applied')
    expect(await run.executeOperation(id)).toEqual(result)
    expect(Object.values(run.snapshot().resources).map(value => value.quantity)).toEqual(['75', '25'])
    leases.splice(0)
    await run.close()
    const reopened = await provider.open({ ...selection, mode: 'open' })
    expect(await reopened.executeOperation(id)).toEqual(result)
    expect(Object.values(reopened.snapshot().resources).map(value => value.quantity)).toEqual(['75', '25'])
  })

  it('commits in slot order and lets only one actor consume the last resource', async () => {
    const { run, actor, account, submit } = await setup(backend)
    const one = await actor('one'); const two = await actor('two')
    await account('stock', one.id, '1', [one.id, two.id])
    await account('one-stock', one.id, '0')
    await account('two-stock', two.id, '0')
    const first = await submit(one.lease, 'first', [{ after: [], action: transfer('stock', 'one-stock', '1') }])
    const second = await submit(two.lease, 'second', [{ after: [], action: transfer('stock', 'two-stock', '1') }])
    const a = first.operationIds[0]; const b = second.operationIds[0]
    if (a === undefined || b === undefined) throw new Error('fixture intents missing')
    await expect(run.executeOperation(b)).rejects.toThrow(/earlier/)
    expect((await run.executeOperation(a)).status).toBe('applied')
    expect(await run.executeOperation(b)).toMatchObject({ status: 'rejected', code: 'SIM_RESOURCE_REVISION_CONFLICT' })
    expect(Object.values(run.snapshot().resources).map(value => value.quantity)).toEqual(['0', '1', '0'])
  })

  it('requires an exact grant for another actor’s resources and consumes it with a multi-resource exchange', async () => {
    const { run, actor, account, submit } = await setup(backend)
    const buyer = await actor('buyer'); const seller = await actor('seller')
    await account('buyer-money', buyer.id, '100', [buyer.id], 'money', 'cent')
    await account('seller-money', seller.id, '0', [seller.id], 'money', 'cent')
    await account('seller-stock', seller.id, '1')
    await account('buyer-stock', buyer.id, '0')
    const transaction = {
      commitmentId: null,
      reads: ['buyer-money', 'seller-money', 'seller-stock', 'buyer-stock'].map(resourceId => ({ resourceId, revision: 1 })),
      transfers: [{ from: 'buyer-money', to: 'seller-money', quantity: '25' }, { from: 'seller-stock', to: 'buyer-stock', quantity: '1' }],
    }
    const denied = await submit(buyer.lease, 'unauthorized', [{ after: [], action: { kind: 'resource/transfer', transaction, grants: [] } }])
    const deniedId = denied.operationIds[0]
    if (deniedId === undefined) throw new Error('fixture intent missing')
    expect(await run.executeOperation(deniedId)).toMatchObject({ status: 'blocked-authority', code: 'SIM_RESOURCE_AUTHORITY' })
    const grant = await submit(seller.lease, 'consent', [{ after: [], action: {
      kind: 'resource/grant', id: 'sale', grantee: buyer.id, resources: ['seller-stock'], transaction,
    } }])
    const grantId = grant.operationIds[0]
    if (grantId === undefined) throw new Error('fixture grant missing')
    expect((await run.executeOperation(grantId)).status).toBe('applied')
    const accepted = await submit(buyer.lease, 'purchase', [{ after: [grantId], action: { kind: 'resource/transfer', transaction, grants: ['sale'] } }])
    const id = accepted.operationIds[0]
    if (id === undefined) throw new Error('fixture transfer missing')
    expect((await run.executeOperation(id)).status).toBe('applied')
    expect(Object.values(run.snapshot().resources).map(value => value.quantity)).toEqual(['75', '25', '0', '1'])
    expect(Object.values(run.snapshot().grants)[0]).toMatchObject({ phase: 'consumed', consumedBy: id })
  })
})

it('revocation cancels an open slot and fences old results without discarding accepted work', async () => {
  const { run, actor, account, submit } = await setup('sqlite')
  const buyer = await actor('buyer')
  await account('a', buyer.id, '1'); await account('b', buyer.id, '0')
  const accepted = await submit(buyer.lease, 'accepted', [{ after: [], action: transfer('a', 'b', '1') }])
  const open = await buyer.lease.openDecision(simulationDecisionIdSchema.parse('late'), run.snapshot().revision)
  await buyer.lease.revoke()
  expect(run.snapshot().decisions[open.id]).toMatchObject({ status: 'cancelled', cancellation: 'writer-revoked' })
  await expect(buyer.lease.submitDecision(open.id, [])).rejects.toThrow(/no live decision/)
  const operation = accepted.operationIds[0]
  if (operation === undefined) throw new Error('fixture intent missing')
  expect((await run.executeOperation(operation)).status).toBe('applied')
})

it('blocks a dependent result after a resource failure without publishing any partial resource updates', async () => {
  const { run, actor, account, submit } = await setup('sqlite')
  const buyer = await actor('buyer')
  await account('a', buyer.id, '1'); await account('b', buyer.id, '0')
  const accepted = await submit(buyer.lease, 'insufficient', [
    { after: [], action: transfer('a', 'b', '2') },
    { after: [0], action: transfer('a', 'b', '1') },
  ])
  const first = accepted.operationIds[0]; const second = accepted.operationIds[1]
  if (first === undefined || second === undefined) throw new Error('fixture intents missing')
  expect(await run.executeOperation(first)).toMatchObject({ status: 'rejected', code: 'SIM_RESOURCE_INSUFFICIENT' })
  expect(await run.executeOperation(second)).toMatchObject({ status: 'blocked-dependency', code: 'SIM_DEPENDENCY_FAILED' })
  expect(Object.values(run.snapshot().resources).map(value => value.quantity)).toEqual(['1', '0'])
})

it.each(['json', 'sqlite'] as const)('keeps reply, commitment fulfillment and result notification separate (%s)', async (backend) => {
  const { run, actor, account, apply: execute } = await setup(backend)
  const buyer = await actor('buyer'); const seller = await actor('seller'); const stranger = await actor('stranger')
  await account('seller-stock', seller.id, '2'); await account('buyer-stock', buyer.id, '0')
  await execute(buyer.lease, 'request', { kind: 'interaction/request', id: 'order', assignee: seller.id,
    description: 'Deliver two items', replyBy: '10', completeBy: '20', fulfillment: { kind: 'transfer', from: 'seller-stock', to: 'buyer-stock', quantity: '2' } })
  expect(Object.values(run.snapshot().interactions)[0]).toMatchObject({ reply: 'pending', execution: 'pending', revision: 1 })
  expect(Object.values(run.snapshot().commitments)).toEqual([])
  expect(await execute(stranger.lease, 'wrong-assignee', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })).toMatchObject({ status: 'blocked-authority' })
  const accepted = await execute(seller.lease, 'accept', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })
  expect(accepted.status).toBe('applied')
  expect(await run.executeOperation(accepted.operationId)).toEqual(accepted)
  const obligation = Object.values(run.snapshot().commitments)[0]
  if (obligation === undefined) throw new Error('fixture commitment missing')
  expect(obligation).toMatchObject({ phase: 'open', debtor: seller.id, creditor: buyer.id })
  expect(await execute(seller.lease, 'claim-before-effect', { kind: 'interaction/result', id: 'order', expectedRevision: 2, evidence: [] }))
    .toMatchObject({ status: 'rejected', code: 'SIM_RESULT_BEFORE_FULFILLMENT' })
  const action = transfer('seller-stock', 'buyer-stock', '2')
  const delivery = await execute(seller.lease, 'delivery', { ...action, transaction: { ...action.transaction, commitmentId: obligation.id } })
  expect(delivery.status).toBe('applied')
  expect(Object.values(run.snapshot().commitments)[0]).toMatchObject({ phase: 'fulfilled', evidence: [delivery.operationId], fulfilledAt: '0' })
  expect(Object.values(run.snapshot().interactions)[0]).toMatchObject({ reply: 'accepted', execution: 'completed', revision: 3 })
  expect(await execute(seller.lease, 'result', { kind: 'interaction/result', id: 'order', expectedRevision: 3, evidence: [delivery.operationId] }))
    .toMatchObject({ status: 'applied' })
  expect(Object.values(run.snapshot().resources).map(resource => resource.quantity)).toEqual(['0', '2'])
})

it.each(['accept', 'cancel'] as const)('serializes the %s winner against a competing reply revision', async (winner) => {
  const { run, actor, submit } = await setup('sqlite')
  const buyer = await actor('buyer'); const seller = await actor('seller')
  const request = await submit(buyer.lease, 'request', [{ after: [], action: { kind: 'interaction/request', id: 'request',
    assignee: seller.id, description: 'Review a proposal', replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' } } }])
  const requestId = request.operationIds[0]
  if (requestId === undefined) throw new Error('fixture request missing')
  await run.executeOperation(requestId)
  const accept = { after: [], action: { kind: 'interaction/accept', id: 'request', expectedRevision: 1 } }
  const cancel = { after: [], action: { kind: 'interaction/cancel', id: 'request', expectedRevision: 1, reason: 'Withdraw' } }
  const first = await submit(winner === 'accept' ? seller.lease : buyer.lease, 'first', [winner === 'accept' ? accept : cancel])
  const second = await submit(winner === 'accept' ? buyer.lease : seller.lease, 'second', [winner === 'accept' ? cancel : accept])
  const firstId = first.operationIds[0]; const secondId = second.operationIds[0]
  if (firstId === undefined || secondId === undefined) throw new Error('fixture operations missing')
  expect((await run.executeOperation(firstId)).status).toBe('applied')
  expect(await run.executeOperation(secondId)).toMatchObject({ status: 'rejected', code: 'SIM_INTERACTION_REVISION_CONFLICT' })
  expect(Object.values(run.snapshot().commitments)).toHaveLength(winner === 'accept' ? 1 : 0)
})

it('keeps an acceptance and every initial intent absent when the atomic append fails', async () => {
  const { run, actor, account } = await setup('sqlite')
  const buyer = await actor('buyer')
  await account('a', buyer.id, '3'); await account('b', buyer.id, '0')
  const id = simulationDecisionIdSchema.parse('atomic')
  await buyer.lease.openDecision(id, run.snapshot().revision)
  const before = run.snapshot()
  // Inject at the actual storage append boundary, leaving the real backend and fold in place.
  const stream = (run as unknown as { stream: LogStream }).stream
  vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('disk unavailable'))
  const proposals = [simulationProposalSchema.parse({ after: [], action: transfer('a', 'b', '1') }),
    simulationProposalSchema.parse({ after: [0], action: transfer('a', 'b', '1', 2, 2) })]
  await expect(buyer.lease.submitDecision(id, proposals)).rejects.toThrow('disk unavailable')
  expect(run.snapshot()).toEqual(before)
  expect((await stream.read(-1, 100)).some(entry => (entry.value as { change?: { kind?: string } }).change?.kind === 'decision/accepted')).toBe(false)
  const accepted = await buyer.lease.submitDecision(id, proposals)
  expect(accepted.operationIds).toHaveLength(2)
  for (const operation of accepted.operationIds) expect((await run.executeOperation(operation)).status).toBe('applied')
  expect(Object.values(run.snapshot().resources).map(value => value.quantity)).toEqual(['1', '2'])
})

it('rejects a new submission after retirement has been requested', async () => {
  const { run, actor } = await setup('sqlite')
  const buyer = await actor('buyer')
  const id = simulationDecisionIdSchema.parse('cancelled-before-accept')
  await buyer.lease.openDecision(id, run.snapshot().revision)
  const revoke = buyer.lease.revoke()
  const submitted = buyer.lease.submitDecision(id, [])
  await revoke
  await expect(submitted).rejects.toThrow(/no live decision/)
  expect(run.snapshot().decisions[id]?.status).toBe('cancelled')
  expect(Object.values(run.snapshot().operations)).toEqual([])
})

it('does not allow a failed partial delivery to erase actual effects through cancellation', async () => {
  const { run, actor, account, apply } = await setup('sqlite')
  const buyer = await actor('buyer'); const seller = await actor('seller')
  await account('stock', seller.id, '2'); await account('received', buyer.id, '0')
  await apply(buyer.lease, 'request', { kind: 'interaction/request', id: 'order', assignee: seller.id, description: 'Two items',
    replyBy: null, completeBy: null, fulfillment: { kind: 'transfer', from: 'stock', to: 'received', quantity: '2' } })
  await apply(seller.lease, 'accept', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })
  const obligation = Object.values(run.snapshot().commitments)[0]
  if (obligation === undefined) throw new Error('fixture commitment missing')
  const action = transfer('stock', 'received', '1')
  await apply(seller.lease, 'partial', { ...action, transaction: { ...action.transaction, commitmentId: obligation.id } })
  expect(await apply(buyer.lease, 'cancel', { kind: 'interaction/cancel', id: 'order', expectedRevision: 2, reason: 'Withdraw' }))
    .toMatchObject({ status: 'rejected', code: 'SIM_INTERACTION_EFFECTS_EXIST' })
  expect(Object.values(run.snapshot().resources).map(value => value.quantity)).toEqual(['1', '1'])
  expect(Object.values(run.snapshot().commitments)[0]?.phase).toBe('open')
})

it('rejects an in-flight permission check when its writer begins retiring', async () => {
  const { run, actor } = await setup('sqlite')
  const entered = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const buyer = await actor('buyer', async () => { entered.resolve(undefined); await finish.promise })
  const opening = buyer.lease.openDecision(simulationDecisionIdSchema.parse('racing'), run.snapshot().revision)
  const rejected = expect(opening).rejects.toThrow(/retired during decision admission/)
  await entered.promise
  const revoked = buyer.lease.revoke()
  finish.resolve(undefined)
  await rejected
  await revoked
  expect(Object.values(run.snapshot().decisions)).toEqual([])
})

it('requires creditor confirmation for explicit fulfillment and keeps deferred/cancelled replies distinct', async () => {
  const { run, actor, apply } = await setup('sqlite')
  const requester = await actor('requester'); const assignee = await actor('assignee')
  const request = (id: string) => ({ kind: 'interaction/request', id, assignee: assignee.id, description: 'Review',
    replyBy: '10', completeBy: '20', fulfillment: { kind: 'explicit' } })
  await apply(requester.lease, 'request', request('approval'))
  await apply(assignee.lease, 'accept', { kind: 'interaction/accept', id: 'approval', expectedRevision: 1 })
  expect(await apply(assignee.lease, 'self-confirm', { kind: 'interaction/confirm', id: 'approval', expectedRevision: 2 }))
    .toMatchObject({ status: 'blocked-authority' })
  const confirmation = await apply(requester.lease, 'confirm', { kind: 'interaction/confirm', id: 'approval', expectedRevision: 2 })
  expect(confirmation.status).toBe('applied')
  expect(await apply(assignee.lease, 'result', { kind: 'interaction/result', id: 'approval', expectedRevision: 3, evidence: [confirmation.operationId] }))
    .toMatchObject({ status: 'applied' })
  await apply(requester.lease, 'later-request', request('later'))
  expect(await apply(assignee.lease, 'bad-defer', { kind: 'interaction/defer', id: 'later', expectedRevision: 1, until: '11', reason: 'Busy' }))
    .toMatchObject({ code: 'SIM_DEFER_INVALID' })
  await apply(assignee.lease, 'defer', { kind: 'interaction/defer', id: 'later', expectedRevision: 1, until: '5', reason: 'Busy' })
  expect(await apply(assignee.lease, 'early', { kind: 'interaction/accept', id: 'later', expectedRevision: 2 }))
    .toMatchObject({ code: 'SIM_REPLY_DEFERRED' })
  await apply(requester.lease, 'withdraw', { kind: 'interaction/cancel', id: 'later', expectedRevision: 2, reason: 'Withdraw' })
  expect(Object.values(run.snapshot().interactions).find(value => value.id === 'later'))
    .toMatchObject({ reply: 'deferred', execution: 'cancelled' })
  expect(await apply(assignee.lease, 'after-cancel', { kind: 'interaction/accept', id: 'later', expectedRevision: 3 }))
    .toMatchObject({ code: 'SIM_INTERACTION_CLOSED' })
})

it('rejects altered, revoked and reused grants without changing balances', async () => {
  const { run, actor, account, apply } = await setup('sqlite')
  const owner = await actor('owner'); const spender = await actor('spender')
  await account('a', owner.id, '10'); await account('b', spender.id, '0')
  const transaction = transfer('a', 'b', '5').transaction
  await apply(owner.lease, 'grant', { kind: 'resource/grant', id: 'permission', grantee: spender.id, resources: ['a'], transaction })
  expect(await apply(spender.lease, 'changed', transfer('a', 'b', '6', 1, 1, ['permission'])))
    .toMatchObject({ code: 'SIM_GRANT_MISMATCH' })
  expect(await apply(spender.lease, 'wrong-revoke', { kind: 'resource/revoke-grant', id: 'permission', expectedRevision: 1 }))
    .toMatchObject({ code: 'SIM_GRANT_AUTHORITY' })
  expect((await apply(owner.lease, 'revoke', { kind: 'resource/revoke-grant', id: 'permission', expectedRevision: 1 })).status).toBe('applied')
  expect(await apply(spender.lease, 'revoked', transfer('a', 'b', '5', 1, 1, ['permission'])))
    .toMatchObject({ code: 'SIM_GRANT_USED' })
  expect(Object.values(run.snapshot().resources).map(value => value.quantity)).toEqual(['10', '0'])
})
