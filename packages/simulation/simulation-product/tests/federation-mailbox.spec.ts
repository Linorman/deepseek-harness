/** Real durable peer mailboxes preserve exact originals, causal blocks and receipts through Host restarts. */
import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { fixture, call } from './fixtures.ts'
import Mailbox from '../src/federation-mailbox.ts'
const config = (runId: string, peer: string) => ({ stream: `mail-${runId}`, runId, generation: 1,
  principalId: runId, peers: [{ runId: peer, generation: 1, principalId: peer }], maxEntries: 100, maxEntryBytes: 65536, pageSize: 1 })
for (const backend of ['json', 'sqlite'] as const) {
  it(`${backend}: duplicate, out-of-order, lost receipt and fresh-process-style reopen preserve one accepted inbox message`, async () => {
    const source = await fixture(backend), destination = await fixture(backend)
    let left = source.ctx.plugin(Mailbox, config('left', 'right')); await left
    let right = destination.ctx.plugin(Mailbox, config('right', 'left')); await right
    const wire = await source.ctx.federationMailbox.enqueue({ messageId: 'msg-1', targetRun: 'right', after: [], body: 'first' }, call(undefined, 'left'))
    const next = await source.ctx.federationMailbox.enqueue({ messageId: 'msg-2', targetRun: 'right', after: ['msg-1'], body: 'second' }, call(undefined, 'left'))
    await expect(destination.ctx.federationMailbox.receive(next, call(undefined, 'left'))).rejects.toThrow('blocked')
    const receipt = await destination.ctx.federationMailbox.receive(wire, call(undefined, 'left'))
    expect((await source.ctx.federationMailbox.inspect(call(undefined, 'left'))).outbox[0]!.receipt).toBeUndefined()
    await left.dispose(); await right.dispose()
    left = source.ctx.plugin(Mailbox, config('left', 'right')); await left
    right = destination.ctx.plugin(Mailbox, config('right', 'left')); await right
    expect(await destination.ctx.federationMailbox.receive(wire, call(undefined, 'left'))).toEqual(receipt)
    await expect(source.ctx.federationMailbox.acknowledge(receipt, call(undefined, 'left'))).rejects.toThrow('authorization')
    await expect(source.ctx.federationMailbox.acknowledge({ ...receipt, inboxSequence: receipt.inboxSequence + 1 },
      call(undefined, 'right'))).rejects.toThrow('does not match original')
    await source.ctx.federationMailbox.acknowledge(receipt, call(undefined, 'right'))
    await source.ctx.federationMailbox.acknowledge(receipt, call(undefined, 'right'))
    await destination.ctx.federationMailbox.receive(next, call(undefined, 'left'))
    expect((await destination.ctx.federationMailbox.inspect(call(undefined, 'right'))).inbox).toHaveLength(2)
    await expect(destination.ctx.federationMailbox.receive({ ...wire, body: 'changed' }, call(undefined, 'left'))).rejects.toThrow('collision')
    await expect(destination.ctx.federationMailbox.receive({ ...wire, targetGeneration: 0 }, call(undefined, 'left'))).rejects.toThrow('stale')
    await expect(destination.ctx.federationMailbox.receive(wire, call(undefined, 'intruder'))).rejects.toThrow('authorization')
    await expect(source.ctx.federationMailbox.enqueue({ messageId: 'msg-1', targetRun: 'right', after: [], body: 'changed' }, call(undefined, 'left'))).rejects.toThrow('changed')
    await expect(source.ctx.federationMailbox.acknowledge({ ...receipt, digest: 'a'.repeat(64) }, call(undefined, 'right'))).rejects.toThrow('match')
    await left.dispose()
    const originalStream = await source.ctx.storageLog.open({ name: 'mail-left', version: 1 })
    const frames = (await originalStream.read(-1, 100)).map(row => structuredClone(row.value))
    const changed = frames.at(-1) as { receipt: { inboxSequence: number } }; changed.receipt.inboxSequence++
    await originalStream.close()
    const corrupt = await source.ctx.storageLog.open({ name: 'wrong-receipt-cursor', version: 1 })
    await corrupt.append(-1, frames); await corrupt.close()
    await expect(Promise.resolve(source.ctx.plugin(Mailbox, { ...config('left', 'right'), stream: 'wrong-receipt-cursor' })))
      .rejects.toThrow('receipt history invalid')
  })
}

it('conservative clocks await durable peer boundaries and covered inbox messages; late events and permanent failures refuse progress', async () => {
  const source = await fixture(), destination = await fixture()
  await source.ctx.plugin(Mailbox, config('left', 'right')); await destination.ctx.plugin(Mailbox, config('right', 'left'))
  const local = call(undefined, 'left'), remote = call(undefined, 'right')
  await expect(destination.ctx.federationMailbox.advance('0', remote)).rejects.toThrow('clock blocked')
  await expect(destination.ctx.federationMailbox.advance('1', remote)).rejects.toThrow('clock blocked')
  const wire = await source.ctx.federationMailbox.enqueue({ messageId: 'before-cut', targetRun: 'right', after: [], body: 'original', at: '0' }, local)
  const cut = await source.ctx.federationMailbox.sealBoundary('right', '90071992547409930', local)
  const sourceTail = source.ctx.storageLog.get('mail-left')!.tailSequence
  expect(await source.ctx.federationMailbox.sealBoundary('right', cut.time, local)).toEqual(cut)
  expect(source.ctx.storageLog.get('mail-left')!.tailSequence).toBe(sourceTail)
  await expect(destination.ctx.federationMailbox.receiveBoundary(cut, local)).rejects.toThrow('missing messages')
  await destination.ctx.federationMailbox.receive(wire, local)
  await destination.ctx.federationMailbox.receiveBoundary(cut, local)
  const targetTail = destination.ctx.storageLog.get('mail-right')!.tailSequence
  expect(await destination.ctx.federationMailbox.receiveBoundary(cut, local)).toEqual(cut)
  expect(destination.ctx.storageLog.get('mail-right')!.tailSequence).toBe(targetTail)
  expect(await destination.ctx.federationMailbox.advance(cut.time, remote)).toBe(cut.time)
  await expect(source.ctx.federationMailbox.enqueue({ messageId: 'late-send', targetRun: 'right', after: [], body: 'late', at: '1' }, local)).rejects.toThrow('promised boundary')
  await expect(destination.ctx.federationMailbox.receive({ ...wire, messageId: 'late', sourceSequence: 1, at: '1' }, local)).rejects.toThrow('late message')
  await destination.ctx.federationMailbox.stopPeer('left', remote)
  await expect(destination.ctx.federationMailbox.advance(cut.time, remote)).rejects.toThrow('permanent stop')
  expect((await destination.ctx.federationMailbox.inspect(remote)).stoppedPeers).toEqual(['left'])
})

it('authenticated mailbox cuts gate the actual Native executor and preserve permanent peer failure', async () => {
  const { createBusinessHarness } = await import('../../simulation-local/tests/business-harness.ts')
  const { simTimeSchema } = await import('@clocky/clocky-simulation')
  const h = await createBusinessHarness('json')
  try {
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const source = await fixture(), destination = await fixture()
    await source.ctx.plugin(Mailbox, config('right', 'business')); await destination.ctx.plugin(Mailbox, config('business', 'right'))
    const local = call(undefined, 'business'), remote = call(undefined, 'right')
    await destination.ctx.federationMailbox.syncNativeClock(h.run, local)
    const fence = h.run.snapshot().federationTime
    const stream = destination.ctx.storageLog.get('mail-business')
    if (!fence || !stream) throw new Error('Native mailbox prefix evidence missing')
    const prefix = { name: stream.name, version: stream.version, entries: await stream.read(-1, fence.sourceSequence + 1) }
    expect(fence.sourceSequence).toBe(stream.tailSequence)
    expect(fence.sourceHash).toBe(createHash('sha256').update(JSON.stringify(prefix)).digest('hex'))
    await h.run.setPhase('running', h.run.snapshot().revision)
    await expect(h.run.drive({ until: simTimeSchema.parse('1') })).rejects.toThrow('Federation clock blocked')
    const boundary = await source.ctx.federationMailbox.sealBoundary('business', '5', remote)
    await destination.ctx.federationMailbox.receiveBoundary(boundary, remote)
    await destination.ctx.federationMailbox.advance('5', local)
    await destination.ctx.federationMailbox.syncNativeClock(h.run, local)
    expect((await h.run.drive({ until: simTimeSchema.parse('4') })).reason).toBe('until')
    await expect(h.run.drive({ until: simTimeSchema.parse('5') })).rejects.toThrow('Federation clock blocked')
    const nextBoundary = await source.ctx.federationMailbox.sealBoundary('business', '6', remote)
    await destination.ctx.federationMailbox.receiveBoundary(nextBoundary, remote)
    await destination.ctx.federationMailbox.advance('6', local)
    await destination.ctx.federationMailbox.syncNativeClock(h.run, local)
    expect((await h.run.drive({ until: simTimeSchema.parse('5') })).reason).toBe('until')
    await destination.ctx.federationMailbox.stopPeer('right', local)
    await destination.ctx.federationMailbox.syncNativeClock(h.run, local)
    await expect(h.run.drive({ until: simTimeSchema.parse('5') })).rejects.toThrow('permanently stopped')
    expect(h.run.snapshot().federationTime).toMatchObject({ ownerId: 'mail-business', limit: '6', blockedPeers: ['right'] })
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s refuses a changed Host principal/peer policy even before the first inbox message', async (backend) => {
  const { ctx } = await fixture(backend), original = config('left', 'right')
  const first = ctx.plugin(Mailbox, original); await first
  await ctx.federationMailbox.sealBoundary('right', '5', call(undefined, 'left'))
  await first.dispose()
  const changed = ctx.plugin(Mailbox, { ...original, peers: [{ ...original.peers[0]!, principalId: 'replacement' }] })
  await expect(Promise.resolve(changed)).rejects.toThrow('original policy changed')
})

it.each(['json', 'sqlite'] as const)('%s causal prerequisites do not reveal another peer inbox membership', async (backend) => {
  const { ctx } = await fixture(backend)
  const policy = { ...config('receiver', 'sender-a'), peers: [
    { runId: 'sender-a', generation: 1, principalId: 'sender-a' }, { runId: 'sender-c', generation: 1, principalId: 'sender-c' }] }
  const fiber = ctx.plugin(Mailbox, policy); await fiber
  const secret = { version: 1 as const, messageId: 'private-c-message', sourceRun: 'sender-c', targetRun: 'receiver',
    sourceGeneration: 1, targetGeneration: 1, sourceSequence: 0, at: '0', after: [], body: 'Private C to receiver' }
  const probe = { ...secret, messageId: 'a-probe', sourceRun: 'sender-a', after: [secret.messageId], body: 'Probe' }
  await expect(ctx.federationMailbox.receive(probe, call(undefined, 'sender-a'))).rejects.toThrow('missing sequence or causal predecessor')
  await ctx.federationMailbox.receive(secret, call(undefined, 'sender-c'))
  await expect(ctx.federationMailbox.receive(probe, call(undefined, 'sender-a'))).rejects.toThrow('missing sequence or causal predecessor')
  const original = { ...probe, messageId: 'a-first', after: [] }
  await ctx.federationMailbox.receive(original, call(undefined, 'sender-a'))
  await ctx.federationMailbox.receive({ ...probe, sourceSequence: 1, after: [original.messageId] }, call(undefined, 'sender-a'))
  await fiber.dispose()
  const stream = await ctx.storageLog.open({ name: policy.stream, version: 1 }), rows = await stream.read(-1, 100)
  const forged = rows.map(row => structuredClone(row.value))
  const last = forged.at(-1) as { kind: string; message: { after: string[] } }
  last.message.after = [secret.messageId]
  await stream.close()
  const bad = await ctx.storageLog.open({ name: 'forged-mail', version: 1 }); await bad.append(-1, forged); await bad.close()
  await expect(Promise.resolve(ctx.plugin(Mailbox, { ...policy, stream: 'forged-mail' }))).rejects.toThrow('inbox history invalid')
})

it.each(['json', 'sqlite'] as const)('%s identical private message aliases remain independent across source namespaces and restart', async (backend) => {
  const { ctx } = await fixture(backend)
  const policy = { ...config('receiver', 'sender-a'), peers: [
    { runId: 'sender-a', generation: 1, principalId: 'sender-a' }, { runId: 'sender-c', generation: 1, principalId: 'sender-c' }] }
  const first = ctx.plugin(Mailbox, policy); await first
  const message = (sourceRun: string, messageId: string, sourceSequence: number) => ({ version: 1 as const,
    messageId, sourceRun, sourceGeneration: 1, targetRun: 'receiver', targetGeneration: 1, sourceSequence, after: [], at: '0', body: sourceRun })
  const before = message('sender-a', 'c-private-before', 0), beforeC = message('sender-c', before.messageId, 0)
  const afterC = message('sender-c', 'c-private-after', 1), after = message('sender-a', afterC.messageId, 1)
  const beforeReceipt = await ctx.federationMailbox.receive(before, call(undefined, 'sender-a'))
  await ctx.federationMailbox.receive(beforeC, call(undefined, 'sender-c'))
  await ctx.federationMailbox.receive(afterC, call(undefined, 'sender-c'))
  const afterReceipt = await ctx.federationMailbox.receive(after, call(undefined, 'sender-a'))
  expect(beforeReceipt.inboxSequence).toBe(0)
  expect(afterReceipt.inboxSequence).toBe(1)
  expect((await ctx.federationMailbox.inspect(call(undefined, 'receiver'))).inbox).toHaveLength(4)
  await first.dispose(); await ctx.plugin(Mailbox, policy)
  expect(await ctx.federationMailbox.receive(before, call(undefined, 'sender-a'))).toEqual(beforeReceipt)
  expect(await ctx.federationMailbox.receive(after, call(undefined, 'sender-a'))).toEqual(afterReceipt)
  expect((await ctx.federationMailbox.inspect(call(undefined, 'receiver'))).inbox).toHaveLength(4)
})

it.each(['json', 'sqlite'] as const)('%s returned boundaries cannot mutate durable time promises', async (backend) => {
  const source = await fixture(backend), destination = await fixture(backend)
  await source.ctx.plugin(Mailbox, config('left', 'right'))
  const right = destination.ctx.plugin(Mailbox, config('right', 'left')); await right
  const local = call(undefined, 'left'), remote = call(undefined, 'right')
  const sent = await source.ctx.federationMailbox.sealBoundary('right', '10', local)
  const original = structuredClone(sent)
  sent.time = '0'
  await expect(source.ctx.federationMailbox.enqueue({ messageId: 'late', targetRun: 'right', at: '1', after: [], body: 'late' }, local))
    .rejects.toThrow('promised boundary')
  const received = await destination.ctx.federationMailbox.receiveBoundary(original, local)
  received.time = '100'
  await expect(destination.ctx.federationMailbox.advance('11', remote)).rejects.toThrow('clock blocked')
  expect((await destination.ctx.federationMailbox.inspect(remote)).boundaries[0]!.time).toBe('10')
  await right.dispose(); await destination.ctx.plugin(Mailbox, config('right', 'left'))
  await expect(destination.ctx.federationMailbox.advance('11', remote)).rejects.toThrow('clock blocked')
})

it.each(['json', 'sqlite'] as const)('%s accepted source time promises reject new earlier messages before local advance and during replay', async (backend) => {
  const { ctx } = await fixture(backend), policy = config('right', 'left')
  const fiber = ctx.plugin(Mailbox, policy); await fiber
  const local = call(undefined, 'left'), remote = call(undefined, 'right')
  await ctx.federationMailbox.receiveBoundary({ version: 1, sourceRun: 'left', targetRun: 'right', sourceGeneration: 1,
    targetGeneration: 1, nextSequence: 0, time: '10' }, local)
  const message = { version: 1 as const, messageId: 'late', sourceRun: 'left', targetRun: 'right', sourceGeneration: 1,
    targetGeneration: 1, sourceSequence: 0, at: '1', after: [], body: 'late' }
  const before = ctx.storageLog.get(policy.stream)!.tailSequence
  await expect(ctx.federationMailbox.receive(message, local)).rejects.toThrow('late message')
  expect(ctx.storageLog.get(policy.stream)!.tailSequence).toBe(before)
  expect((await ctx.federationMailbox.inspect(remote)).inbox).toHaveLength(0)
  await fiber.dispose()
  const stream = await ctx.storageLog.open({ name: policy.stream, version: 1 })
  await stream.append(stream.tailSequence, [{ kind: 'inbox', message, principalId: 'left' }]); await stream.close()
  await expect(Promise.resolve(ctx.plugin(Mailbox, policy))).rejects.toThrow('inbox history invalid')
})
