import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { channelIdSchema, envelopeIdSchema } from '@clocky/clocky-team'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { simTimeSchema, simulationDecisionIdSchema, simulationPostReceiptSchema } from '@clocky/clocky-simulation'
import type { SimulationOutboundMessage, SimulationTeamTransport } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup(backend: 'json' | 'sqlite', options: Record<string, unknown> = {}) {
  const fixture = await createBusinessHarness(backend, options)
  cleanups.push(fixture.close)
  const sender = await fixture.actor('sender')
  const recipient = await fixture.actor('recipient')
  const decision = await fixture.submit(sender.lease, 'message', [{ after: [], action: {
    kind: 'communication/post', recipient: recipient.id, channelId: 'channel', text: 'Private scheduled message', deliverAt: '5',
  } }])
  const id = decision.operationIds[0]
  if (id === undefined) throw new Error('fixture operation missing')
  return { ...fixture, sender, recipient, id }
}
async function target(root: string, backend: 'json' | 'sqlite', loseResponse: boolean) {
  const medium = backend === 'json' ? new JsonStorageBackend(join(root, 'target'))
    : new SqliteStorageBackend({ path: join(root, 'target.sqlite') })
  cleanups.push(() => medium.close())
  const log = await medium.log.open({ name: 'messages', version: 0 })
  const calls: SimulationOutboundMessage[] = []
  const transport: SimulationTeamTransport = { post: async (message) => {
    calls.push(message)
    const records = (await log.read(-1, 100)).map(entry => simulationPostReceiptSchema.parse(entry.value))
    const existing = records.find(record => record.operationId === message.operationId)
    if (existing !== undefined) {
      if (existing.fingerprint !== message.fingerprint) throw new Error('payload conflict')
      return { status: 'applied', receipt: existing }
    }
    if (!message.publishAllowed) return { status: 'blocked-authority', code: 'DENIED' }
    const receipt = { runId: message.runId, teamId: message.sender.teamId, recipientId: message.recipient.participantId,
      sequence: log.tailSequence + 2, operationId: message.operationId, fingerprint: message.fingerprint,
      channelId: message.channelId, envelopeId: envelopeIdSchema.parse(`envelope-${log.tailSequence + 1}`) }
    await log.append(log.tailSequence, [receipt])
    if (loseResponse) { loseResponse = false; throw new Error('response lost after durable publication') }
    return { status: 'applied', receipt }
  } }
  return { transport, calls, log, medium }
}

describe.each(['json', 'sqlite'] as const)('%s persistent outbox', (backend) => {
  it('keeps content at the sender until deliverAt, retries the same target key and returns the original receipt after restart', async () => {
    const { run, root, id, sender, recipient, provider, selection, leases } = await setup(backend)
    const remote = await target(root, backend, true)
    let now = 100
    await expect(run.dispatchOperation(id, remote.transport, () => now)).rejects.toThrow(/not due/)
    await run.drive({ until: simTimeSchema.parse('4') })
    expect(remote.calls).toHaveLength(0)
    expect((await remote.log.read(-1, 100))).toEqual([])
    expect(await run.drive({ until: simTimeSchema.parse('10') })).toMatchObject({ reason: 'dispatch-required', operationId: id })
    expect(run.snapshot().time).toBe('5')
    await expect(recipient.lease.openDecision(simulationDecisionIdSchema.parse('too-early'), run.snapshot().revision))
      .rejects.toThrow(/publication result/)
    expect(await run.dispatchOperation(id, remote.transport, () => now)).toEqual({ status: 'retry', nextAttemptAt: 110 })
    expect((await remote.log.read(-1, 100))).toHaveLength(1)
    await sender.lease.revoke(); await sender.lease.release()
    now = 109
    expect(await run.dispatchOperation(id, remote.transport, () => now)).toEqual({ status: 'retry', nextAttemptAt: 110 })
    expect(remote.calls).toHaveLength(1)
    now = 110
    const settled = await run.dispatchOperation(id, remote.transport, () => now)
    expect(settled.status).toBe('settled')
    expect(run.budgetUsage().messages.used).toBe(1)
    expect(remote.calls.map(call => [call.operationId, call.fingerprint, call.text])).toEqual([
      [id, run.snapshot().operations[id]?.fingerprint, 'Private scheduled message'],
      [id, run.snapshot().operations[id]?.fingerprint, 'Private scheduled message'],
    ])
    expect((await remote.log.read(-1, 100))).toHaveLength(1)
    await recipient.lease.revoke(); await recipient.lease.release(); leases.splice(0)
    await run.close()
    const restored = await provider.open({ ...selection, mode: 'open' })
    expect(await restored.dispatchOperation(id, remote.transport, () => now)).toEqual(settled)
    expect(remote.calls).toHaveLength(2)
    expect(restored.snapshot().operations[id]?.outbox?.receipt?.envelopeId).toBe('envelope-0')
  })

  it('records unknown outcome at the attempt limit and requires an explicit retry decision', async () => {
    const { run, root, id } = await setup(backend, { outboxMaxAttempts: 1 })
    const remote = await target(root, backend, true)
    await run.drive({ until: simTimeSchema.parse('5') })
    expect(await run.dispatchOperation(id, remote.transport, () => 100)).toEqual({ status: 'outcome-unknown' })
    expect(run.snapshot()).toMatchObject({ phase: 'stalled', stall: { code: 'SIM_OUTBOX_OUTCOME_UNKNOWN', operationId: id } })
    await expect(run.setPhase('running', run.snapshot().revision)).rejects.toThrow(/explicit recovery/)
    expect(await run.dispatchOperation(id, remote.transport, () => 200)).toEqual({ status: 'outcome-unknown' })
    expect(remote.calls).toHaveLength(1)
    await run.retryOutbox(id, 'Reconcile the exact idempotent Team post', 200, run.snapshot().revision)
    await run.setPhase('running', run.snapshot().revision)
    expect((await run.dispatchOperation(id, remote.transport, () => 200)).status).toBe('settled')
    expect((await remote.log.read(-1, 100))).toHaveLength(1)
    expect(run.snapshot().operations[id]?.outbox?.attempts).toHaveLength(2)
  })
})

it('does not hold the run write queue during IO and drains accepted dispatch before closing storage', async () => {
  const { run, id, sender } = await setup('sqlite')
  await run.drive({ until: simTimeSchema.parse('5') })
  const entered = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const post = vi.fn(async (message: SimulationOutboundMessage) => {
    entered.resolve(undefined)
    await finish.promise
    return { status: 'applied' as const, receipt: { runId: message.runId, teamId: message.sender.teamId,
      recipientId: message.recipient.participantId, sequence: 1, operationId: message.operationId, fingerprint: message.fingerprint,
      channelId: message.channelId, envelopeId: envelopeIdSchema.parse('receipt') } }
  })
  const first = run.dispatchOperation(id, { post }, () => 100)
  await entered.promise
  expect(run.dispatchOperation(id, { post }, () => 100)).toBe(first)
  await sender.lease.revoke(); await sender.lease.release()
  expect(run.snapshot().operations[id]?.outbox?.attempts[0]?.outcome).toBe('in-flight')
  const recipient = Object.values(run.snapshot().entities).find(entity => entity.id !== sender.id)
  if (recipient?.writer?.activationId === undefined || recipient.binding === undefined) throw new Error('fixture recipient missing')
  const lease = await run.recoverWriter(recipient.id, { ...recipient.binding, provider: recipient.writer.provider,
    reservationId: recipient.writer.reservationId, activationId: recipient.writer.activationId })
  await lease.revoke(); await lease.release()
  let closed = false
  const closing = run.close().then(() => { closed = true })
  await Promise.resolve()
  expect(closed).toBe(false)
  finish.resolve(undefined)
  expect((await first).status).toBe('settled')
  await closing
  expect(post).toHaveBeenCalledTimes(1)
  await expect(run.dispatchOperation(id, { post }, () => 100)).rejects.toThrow(/run is closed/)
})

it('retains exhaustion after a started final attempt loses its outcome write', async () => {
  const { run, id } = await setup('sqlite', { outboxMaxAttempts: 1 })
  await run.drive({ until: simTimeSchema.parse('5') })
  const stream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const append = stream.append.bind(stream)
  const fault = vi.spyOn(stream, 'append').mockImplementationOnce(append).mockRejectedValueOnce(new Error('Outcome write failed'))
  const post = vi.fn<SimulationTeamTransport['post']>().mockRejectedValue(new Error('Transport failed'))
  try { await expect(run.dispatchOperation(id, { post }, () => 100)).rejects.toThrow(/Outcome write failed/) }
  finally { fault.mockRestore() }
  expect(run.snapshot().operations[id]?.outbox?.attempts[0]?.outcome).toBe('in-flight')
  expect(await run.dispatchOperation(id, { post }, () => 110)).toEqual({ status: 'outcome-unknown' })
  expect(post).toHaveBeenCalledTimes(1)
  expect(run.snapshot().phase).toBe('stalled')
})

it.each(['', 'opaque transport rejection'])('retains an unstructured transport rejection: %j', async (reason) => {
  const { run, id } = await setup('sqlite')
  await run.drive({ until: simTimeSchema.parse('5') })
  const post = vi.fn<SimulationTeamTransport['post']>().mockRejectedValue(reason)
  expect(await run.dispatchOperation(id, { post }, () => 100)).toEqual({ status: 'retry', nextAttemptAt: 110 })
  expect(run.snapshot().operations[id]?.outbox?.attempts[0]?.detail).toBe(reason || 'Unknown transport outcome')
})

it('refuses local execution of an external effect and never publishes for an inactive sender', async () => {
  const { run, id, sender } = await setup('sqlite')
  await expect(run.executeOperation(id)).rejects.toThrow(/outbox dispatcher/)
  await sender.lease.revoke(); await sender.lease.release()
  const { simulationChangeSchema } = await import('@clocky/clocky-simulation')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: sender.id, phase: 'inactive',
    entityRevision: run.snapshot().entities[sender.id]!.revision }), run.snapshot().revision)
  await run.drive({ until: simTimeSchema.parse('5') })
  const post = vi.fn<SimulationTeamTransport['post']>()
  expect(await run.dispatchOperation(id, { post }, () => 100))
    .toMatchObject({ status: 'settled', result: { status: 'blocked-authority', code: 'SIM_ENTITY_UNAVAILABLE' } })
  expect(post).not.toHaveBeenCalled()
})

it('rejects an unrelated receipt instead of marking the operation applied', async () => {
  const { run, id } = await setup('sqlite')
  await run.drive({ until: simTimeSchema.parse('5') })
  const transport: SimulationTeamTransport = { post: message => Promise.resolve({ status: 'applied', receipt: {
    runId: message.runId, teamId: message.sender.teamId, recipientId: message.recipient.participantId, sequence: 1,
    operationId: message.operationId, fingerprint: message.fingerprint, channelId: channelIdSchema.parse('wrong'),
    envelopeId: envelopeIdSchema.parse('wrong'),
  } }) }
  expect(await run.dispatchOperation(id, transport, () => 100)).toEqual({ status: 'retry', nextAttemptAt: 110 })
  expect(run.snapshot().operations[id]?.result).toBeUndefined()
  expect(run.snapshot().operations[id]?.outbox?.attempts[0]).toMatchObject({ outcome: 'uncertain' })
})

it.each(['run', 'team', 'recipient', 'sequence'] as const)('reconciles a receipt with invalid %s provenance without duplicating publication', async (field) => {
  const { run, root, id } = await setup('sqlite')
  const remote = await target(root, 'sqlite', false)
  const { simulationRunIdSchema } = await import('@clocky/clocky-simulation')
  const { teamIdSchema, participantIdSchema } = await import('@clocky/clocky-team')
  await run.drive({ until: simTimeSchema.parse('5') })
  const malformed: SimulationTeamTransport = { post: async (message) => {
    const result = await remote.transport.post(message)
    if (result.status !== 'applied') throw new Error('Fixture publication was rejected')
    const receipt = { ...result.receipt }
    if (field === 'run') receipt.runId = simulationRunIdSchema.parse('foreign')
    if (field === 'team') receipt.teamId = teamIdSchema.parse('foreign')
    if (field === 'recipient') receipt.recipientId = participantIdSchema.parse('foreign')
    if (field === 'sequence') receipt.sequence = 0
    return { status: 'applied', receipt }
  } }
  expect(await run.dispatchOperation(id, malformed, () => 100)).toEqual({ status: 'retry', nextAttemptAt: 110 })
  expect(run.snapshot().operations[id]?.result).toBeUndefined()
  expect(run.snapshot().operations[id]?.outbox?.receipt).toBeUndefined()
  expect(await run.dispatchOperation(id, remote.transport, () => 110)).toMatchObject({ status: 'settled', result: { status: 'applied' } })
  expect(await remote.log.read(-1, 100)).toHaveLength(1)
  expect(run.snapshot().operations[id]?.outbox?.receipt).toMatchObject({ runId: 'business', teamId: 'company', recipientId: 'recipient', sequence: 1 })
})

it('allows the clock to reach a communication dependency before settling later local work', async () => {
  const { run, root, id, sender, account, submit } = await setup('sqlite')
  await account('a', sender.id, '2'); await account('b', sender.id, '0')
  const decision = await submit(sender.lease, 'after-publication', [{ after: [id], action: {
    kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
      reads: [{ resourceId: 'a', revision: 1 }, { resourceId: 'b', revision: 1 }],
      transfers: [{ from: 'a', to: 'b', quantity: '1' }],
    },
  } }])
  expect((await run.drive({ until: simTimeSchema.parse('10') })).reason).toBe('dispatch-required')
  const remote = await target(root, 'sqlite', false)
  await run.dispatchOperation(id, remote.transport, () => 100)
  expect((await run.drive({ until: simTimeSchema.parse('10') })).reason).toBe('delivery-required')
  const local = decision.operationIds[0]
  if (local === undefined) throw new Error('fixture local operation missing')
  expect(run.snapshot().operations[local]?.result?.status).toBe('applied')
  expect(Object.values(run.snapshot().resources).map(resource => resource.quantity)).toEqual(['1', '1'])
})

it('reconciles a prior publication after sender authority is withdrawn without granting permission to publish anew', async () => {
  const { run, root, id, sender } = await setup('sqlite')
  const remote = await target(root, 'sqlite', true)
  await run.drive({ until: simTimeSchema.parse('5') })
  await run.dispatchOperation(id, remote.transport, () => 100)
  await sender.lease.revoke(); await sender.lease.release()
  const entity = run.snapshot().entities[sender.id]
  if (entity === undefined) throw new Error('fixture entity missing')
  const { simulationChangeSchema } = await import('@clocky/clocky-simulation')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: sender.id, entityRevision: entity.revision, phase: 'inactive' }), run.snapshot().revision)
  expect((await run.dispatchOperation(id, remote.transport, () => 110)).status).toBe('settled')
  expect(remote.calls.at(-1)?.publishAllowed).toBe(false)
  expect((await remote.log.read(-1, 100))).toHaveLength(1)
})

it('blocks publication when its prerequisite fails and keeps the transport uncalled', async () => {
  const fixture = await createBusinessHarness('sqlite')
  cleanups.push(fixture.close)
  const { run, actor, account, submit } = fixture
  const sender = await actor('sender'); const recipient = await actor('recipient')
  await account('a', sender.id, '0'); await account('b', recipient.id, '0')
  const decision = await submit(sender.lease, 'failed-effect', [
    { after: [], action: { kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
      reads: [{ resourceId: 'a', revision: 1 }, { resourceId: 'b', revision: 1 }], transfers: [{ from: 'a', to: 'b', quantity: '1' }],
    } } },
    { after: [0], action: { kind: 'communication/post', recipient: recipient.id, channelId: 'channel', text: 'Success', deliverAt: '5' } },
  ])
  const message = decision.operationIds[1]
  if (message === undefined) throw new Error('fixture message missing')
  await run.drive({ until: simTimeSchema.parse('5') })
  const { foldOutboxRecord } = await import('../src/outbox.ts')
  const state = run.snapshot()
  expect(() => foldOutboxRecord(state, { kind: 'outbox/started', id: message, number: 1, at: 100 }, state.revision + 1))
    .toThrow(/prerequisites/)
  const post = vi.fn(() => Promise.reject(new Error('must not publish')))
  const result = await run.dispatchOperation(message, { post }, () => 100)
  expect(result).toMatchObject({ status: 'settled', result: { status: 'blocked-dependency', code: 'SIM_DEPENDENCY_FAILED' } })
  expect(post).not.toHaveBeenCalled()
})

it('refuses a persisted readiness event moved ahead of the accepted deliverAt', async () => {
  const { run, id } = await setup('sqlite')
  const { foldSchedulerRecord, allocateEventKey } = await import('../src/scheduler.ts')
  const event = Object.values(run.snapshot().scheduledEvents).find(value => value.action.kind === 'outbox-ready')
  if (event === undefined) throw new Error('fixture event missing')
  const state = { ...run.snapshot(), scheduledEvents: {} }
  const key = allocateEventKey(state, simTimeSchema.parse('1'), event.action)
  expect(() => foldSchedulerRecord(state, { kind: 'event/queued', id: event.id, key,
    action: event.action, sourceOperationId: id }, state.revision + 1)).toThrow(/time or target/)
})

it('settles an explicitly cancelled publication instead of stranding its accepted intent', async () => {
  const { run, id } = await setup('sqlite')
  const event = Object.values(run.snapshot().scheduledEvents).find(value => value.action.kind === 'outbox-ready')
  if (event === undefined) throw new Error('fixture event missing')
  await run.cancelEvent(event.id, 'Operator withdrew the message before publication', run.snapshot().revision)
  const post = vi.fn(() => Promise.reject(new Error('must not publish')))
  expect(await run.dispatchOperation(id, { post }, () => 100))
    .toMatchObject({ status: 'settled', result: { status: 'rejected', code: 'SIM_POST_CANCELLED' } })
  expect((await run.drive({ until: simTimeSchema.parse('10') })).reason).toBe('until')
  expect(post).not.toHaveBeenCalled()
})

it.each(['json', 'sqlite'] as const)('retains exact delivery failure and its reconciliation across %s replay', async (backend) => {
  const { run, root, id, recipient, provider, selection, leases } = await setup(backend)
  const remote = await target(root, backend, false)
  await run.drive({ until: simTimeSchema.parse('5') })
  await run.dispatchOperation(id, remote.transport, () => 100)
  const receipt = run.snapshot().operations[id]?.outbox?.receipt
  const entity = run.snapshot().entities[recipient.id]
  if (receipt === undefined || entity?.binding === undefined || entity.writer === undefined) throw new Error('fixture delivery missing')
  const record = { type: 'channel/delivery-expired' as const, sequence: 2, createdAt: 100,
    participantId: entity.binding.participantId, envelopeId: receipt.envelopeId, envelopeSequence: 1 }
  await expect(run.recordDeliveryFailure(id, { ...record, envelopeId: envelopeIdSchema.parse('wrong') }, run.snapshot().revision))
    .rejects.toThrow(/does not match/)
  await run.recordDeliveryFailure(id, record, run.snapshot().revision)
  const failed = run.snapshot()
  expect(await run.recordDeliveryFailure(id, record, -1)).toEqual(failed)
  await expect(run.recordDeliveryFailure(id, { ...record, createdAt: 101 }, failed.revision))
    .rejects.toThrow(/changed its evidence/)
  expect(await run.drive({ until: simTimeSchema.parse('10') })).toMatchObject({ reason: 'stalled' })
  await expect(run.setPhase('running', failed.revision)).rejects.toThrow(/reconciliation/)
  await expect(run.resolveDeliveryFailure(id, { kind: 'retained-input' }, failed.revision)).rejects.toThrow(/recipient evidence/)
  await run.resolveDeliveryFailure(id, { kind: 'absent-input', epoch: entity.writer.epoch }, run.snapshot().revision)
  expect(await run.resolveDeliveryFailure(id, { kind: 'absent-input', epoch: entity.writer.epoch }, 0)).toEqual(run.snapshot())
  await expect(run.resolveDeliveryFailure(id, { kind: 'retained-input' }, 0)).rejects.toThrow(/changed its disposition/)
  expect(run.snapshot().phase).toBe('stalled')
  for (const lease of leases.splice(0)) { await lease.revoke(); await lease.release() }
  await run.close()
  const restored = await provider.open({ ...selection, mode: 'open' })
  try {
    expect(restored.snapshot().operations[id]?.deliveryFailure).toMatchObject({ record, resolution: { kind: 'absent-input' } })
    await restored.setPhase('running', restored.snapshot().revision)
    expect(await restored.drive({ until: simTimeSchema.parse('10') })).toMatchObject({ reason: 'until' })
    expect(restored.snapshot().operations[id]?.delivery).toBeUndefined()
  } finally { await restored.close() }
})

it('keeps recipient wake responsibility when transport fails after local input durability', async () => {
  const { run, root, id, recipient } = await setup('sqlite')
  const remote = await target(root, 'sqlite', false)
  await run.drive({ until: simTimeSchema.parse('5') })
  await run.dispatchOperation(id, remote.transport, () => 100)
  const entity = run.snapshot().entities[recipient.id]!
  if (entity.writer === undefined || entity.binding === undefined) throw new Error('fixture recipient missing')
  await run.recordDelivery(id, entity.writer.epoch, run.snapshot().revision)
  const operation = run.snapshot().operations[id]!
  await run.recordDeliveryFailure(id, { type: 'channel/delivery-expired', sequence: 2, createdAt: 100,
    participantId: entity.binding.participantId, envelopeId: operation.outbox!.receipt!.envelopeId,
    envelopeSequence: 1 }, run.snapshot().revision)
  await expect(run.resolveDeliveryFailure(id, { kind: 'absent-input', epoch: entity.writer.epoch }, run.snapshot().revision))
    .rejects.toThrow(/recipient evidence/)
  await run.resolveDeliveryFailure(id, { kind: 'retained-input' }, run.snapshot().revision)
  await run.setPhase('running', run.snapshot().revision)
  expect(await run.drive({ until: simTimeSchema.parse('10') })).toMatchObject({ reason: 'decision-required' })
  expect(run.snapshot().operations[id]?.delivery).toEqual(operation.delivery)
  expect(run.snapshot().wakes[operation.delivery!.wakeId]?.status).toBe('pending')
  const decision = await recipient.lease.openDecision(simulationDecisionIdSchema.parse('consume-retained-input'), run.snapshot().revision,
    operation.delivery!.wakeId)
  expect(decision.status).toBe('open')
})

it('does not cancel an accepted business commitment when its notification transport fails', async () => {
  const { run, root, id, sender, recipient, account, apply } = await setup('sqlite')
  await account('stock', recipient.id, '2'); await account('received', sender.id, '0')
  await apply(sender.lease, 'request-order', { kind: 'interaction/request', id: 'order', assignee: recipient.id,
    description: 'Deliver two items', replyBy: '10', completeBy: '20',
    fulfillment: { kind: 'transfer', from: 'stock', to: 'received', quantity: '2' } })
  await apply(recipient.lease, 'accept-order', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })
  const commitments = run.snapshot().commitments
  expect(Object.values(commitments)).toHaveLength(1)
  const remote = await target(root, 'sqlite', false)
  await run.drive({ until: simTimeSchema.parse('5') })
  await run.dispatchOperation(id, remote.transport, () => 100)
  const entity = run.snapshot().entities[recipient.id]!
  await run.recordDeliveryFailure(id, { type: 'channel/delivery-expired', sequence: 2, createdAt: 100,
    participantId: entity.binding!.participantId, envelopeId: run.snapshot().operations[id]!.outbox!.receipt!.envelopeId,
    envelopeSequence: 1 }, run.snapshot().revision)
  await run.resolveDeliveryFailure(id, { kind: 'absent-input', epoch: entity.writer!.epoch }, run.snapshot().revision)
  await run.setPhase('running', run.snapshot().revision)
  expect(run.snapshot().commitments).toEqual(commitments)
  expect(Object.values(run.snapshot().commitments)[0]?.phase).toBe('open')
})

it('rejects a persisted attempt that starts inside a frozen decision window', async () => {
  const { run, id, sender } = await setup('sqlite')
  const { contextRequest } = await import('./context-fixture.ts')
  const { simulationWindowRequestSchema } = await import('@clocky/clocky-simulation')
  const { foldOutboxRecord } = await import('../src/outbox.ts')
  await run.drive({ until: simTimeSchema.parse('5') })
  await run.openWindow(simulationWindowRequestSchema.parse({ id: 'frozen', decisions: [
    { id: 'next', entityId: sender.id, context: contextRequest() },
  ] }), run.snapshot().revision)
  const state = run.snapshot()
  expect(() => foldOutboxRecord(state, { kind: 'outbox/started', id, number: 1, at: 100 }, state.revision + 1))
    .toThrow(/not admissible/)
})

it('does not settle a dependency failure while another accepted prerequisite is still pending', async () => {
  const h = await createBusinessHarness('sqlite')
  cleanups.push(h.close)
  const sender = await h.actor('sender'), recipient = await h.actor('recipient')
  await h.account('stock', sender.id, '1'); await h.account('received', recipient.id, '0')
  const accepted = await h.submit(sender.lease, 'dependent', [
    { after: [], action: { kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
      reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
      transfers: [{ from: 'stock', to: 'received', quantity: '2' }],
    } } },
    { after: [], action: { kind: 'communication/post', recipient: recipient.id, channelId: 'channel', text: 'Prerequisite', deliverAt: '10' } },
    { after: [0, 1], action: { kind: 'communication/post', recipient: recipient.id, channelId: 'channel', text: 'Dependent', deliverAt: '5' } },
  ])
  await h.run.drive({ until: simTimeSchema.parse('5') })
  const { foldOutboxRecord } = await import('../src/outbox.ts')
  const state = h.run.snapshot()
  expect(state.operations[accepted.operationIds[0]!]!.result?.status).toBe('rejected')
  expect(state.operations[accepted.operationIds[1]!]!.result).toBeUndefined()
  expect(() => foldOutboxRecord(state, { kind: 'outbox/blocked', id: accepted.operationIds[2]!, code: 'SIM_DEPENDENCY_FAILED' },
    state.revision + 1)).toThrow(/prerequisites/)
  await expect(h.run.dispatchOperation(accepted.operationIds[2]!, { post: async () => ({ status: 'rejected', code: 'UNREACHED' }) }, () => 100))
    .rejects.toThrow(/dependency is pending/)
})

it('preserves the first delivery receipt and rejects replacement evidence', async () => {
  const { run, root, id, recipient } = await setup('sqlite')
  const remote = await target(root, 'sqlite', false)
  await expect(run.dispatchOperation(id, { createTask: async () => ({ status: 'rejected', code: 'WRONG_TARGET' }) }, () => 100))
    .rejects.toThrow(/does not implement its target kind/)
  await run.drive({ until: simTimeSchema.parse('5') })
  await run.dispatchOperation(id, remote.transport, () => 100)
  await run.recordDelivery(id, recipient.lease.epoch, run.snapshot().revision)
  const { channelReceiptRecordSchema } = await import('@clocky/clocky-team')
  const operation = run.snapshot().operations[id]!
  const receipt = channelReceiptRecordSchema.parse({ type: 'channel/receipt', sequence: 2, createdAt: 100,
    participantId: run.snapshot().entities[recipient.id]!.binding!.participantId,
    envelopeId: operation.outbox!.receipt!.envelopeId, cursor: 1 })
  const confirmed = await run.confirmDelivery(id, receipt, run.snapshot().revision)
  expect(await run.confirmDelivery(id, receipt, 0)).toEqual(confirmed)
  await expect(run.confirmDelivery(id, { ...receipt, createdAt: 101 }, 0)).rejects.toThrow(/changed its target result/)
  expect(run.snapshot()).toEqual(confirmed)
})

it('allows an admitted transport result to finish after pause while refusing new rejection records', async () => {
  const { run, root, id, sender } = await setup('sqlite')
  const remote = await target(root, 'sqlite', false)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  await run.drive({ until: simTimeSchema.parse('5') })
  const dispatched = run.dispatchOperation(id, { post: async (message) => {
    entered.resolve(undefined); await release.promise; return await remote.transport.post(message)
  } }, () => 100)
  await entered.promise
  try {
    const { contextRequest } = await import('./context-fixture.ts')
    const { simulationWindowRequestSchema } = await import('@clocky/clocky-simulation')
    await run.openWindow(simulationWindowRequestSchema.parse({ id: 'frozen', decisions: [
      { id: 'next', entityId: sender.id, context: contextRequest() },
    ] }), run.snapshot().revision)
    const { foldOutboxRecord } = await import('../src/outbox.ts')
    const state = run.snapshot()
    expect(() => foldOutboxRecord(state, { kind: 'outbox/blocked', id, code: 'SIM_ENTITY_UNAVAILABLE' }, state.revision + 1))
      .toThrow(/not admissible/)
    await run.setPhase('paused', run.snapshot().revision)
  } finally { release.resolve(undefined) }
  expect(await dispatched).toMatchObject({ status: 'settled', result: { status: 'applied' } })
  expect(run.snapshot().phase).toBe('paused')
})

it('rejects missing canonical routes and receipt claims without a durable recipient input', async () => {
  const { run, root, id, recipient } = await setup('sqlite')
  const { requireOutbox, outboundMessage, foldOutboxRecord } = await import('../src/outbox.ts')
  const { channelReceiptRecordSchema } = await import('@clocky/clocky-team')
  const before = run.snapshot()
  expect(() => outboundMessage({ ...before, entities: {} }, requireOutbox(before, id))).toThrow(/canonical/)
  const epoch = recipient.lease.epoch
  expect(() => foldOutboxRecord(before, { kind: 'outbox/received', id, epoch }, before.revision + 1)).toThrow(/published target/)
  const remote = await target(root, 'sqlite', false)
  await run.drive({ until: simTimeSchema.parse('5') })
  await run.dispatchOperation(id, remote.transport, () => 100)
  const state = run.snapshot()
  const operation = state.operations[id]!
  const receipt = channelReceiptRecordSchema.parse({ type: 'channel/receipt', sequence: 2, createdAt: 100,
    participantId: state.entities[recipient.id]!.binding!.participantId, envelopeId: operation.outbox!.receipt!.envelopeId, cursor: 1 })
  expect(() => foldOutboxRecord(state, { kind: 'outbox/delivery-receipted', id, receipt }, state.revision + 1))
    .toThrow(/durable delivery/)
  await run.recordDeliveryFailure(id, { type: 'channel/delivery-expired', sequence: 2, createdAt: 100,
    participantId: receipt.participantId, envelopeId: receipt.envelopeId, envelopeSequence: 1 }, state.revision)
  const failed = run.snapshot()
  expect(() => foldOutboxRecord(failed, { kind: 'outbox/delivery-receipted', id, receipt }, failed.revision + 1))
    .toThrow(/another target result/)
  expect(() => foldOutboxRecord(failed, { kind: 'outbox/delivery-failure-resolved', id,
    resolution: { kind: 'entity-terminated' } }, failed.revision + 1)).toThrow(/recipient evidence/)
})

it('diagnoses missing recipient wake and mismatched receipts from authoritative delivery projections', async () => {
  const { run, root, id, recipient } = await setup('sqlite')
  const remote = await target(root, 'sqlite', false)
  const { assertSchedulerProjection, foldSchedulerRecord } = await import('../src/scheduler.ts')
  const { SessionId } = await import('@clocky/clocky-session')
  const { channelReceiptRecordSchema } = await import('@clocky/clocky-team')
  await run.drive({ until: simTimeSchema.parse('5') })
  await run.dispatchOperation(id, remote.transport, () => 100)
  const published = run.snapshot()
  expect(() => foldSchedulerRecord(published, { kind: 'clock/advanced', time: simTimeSchema.parse('6') }, published.revision + 1))
    .toThrow(/unreceived publication/)
  await run.recordDelivery(id, recipient.lease.epoch, run.snapshot().revision)
  const state = run.snapshot()
  const operation = state.operations[id]!
  expect(() => { assertSchedulerProjection({ ...state, operations: { ...state.operations,
    [id]: { ...operation, delivery: { ...operation.delivery!, sessionId: SessionId('foreign') } },
  } }) }).toThrow(/recipient wake/)
  const receipt = channelReceiptRecordSchema.parse({ type: 'channel/receipt', sequence: 2, createdAt: 100,
    participantId: state.entities[recipient.id]!.binding!.participantId, envelopeId: 'foreign', cursor: 1 })
  expect(() => { assertSchedulerProjection({ ...state, operations: { ...state.operations,
    [id]: { ...operation, delivery: { ...operation.delivery!, receipt } },
  } }) }).toThrow(/receipt has another target/)
  await run.recordDeliveryFailure(id, { type: 'channel/delivery-expired', sequence: 2, createdAt: 100,
    participantId: receipt.participantId, envelopeId: operation.outbox!.receipt!.envelopeId, envelopeSequence: 1 }, state.revision)
  const failed = run.snapshot()
  const failedOperation = failed.operations[id]!
  expect(() => { assertSchedulerProjection({ ...failed, operations: { ...failed.operations,
    [id]: { ...failedOperation, deliveryFailure: { ...failedOperation.deliveryFailure!,
      resolution: { kind: 'entity-terminated', sequence: failed.revision, time: failed.time } } },
  } }) }).toThrow(/failure has another target/)
})
