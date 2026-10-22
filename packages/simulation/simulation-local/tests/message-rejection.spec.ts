import type { LogStream } from '@clocky/clocky-storage'
import { foldBusinessRecord } from '../src/decisions.ts'
import { businessFingerprint } from '../src/business.ts'
/** Queued message rejection is durable, bounded and independent of a model's stage-time checks. */
import { expect, it, vi } from 'vitest'
import { simulationDecisionIdSchema, simulationWindowRequestSchema, simulationWakeRequestSchema, simulationProposalSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

it.each(['json', 'sqlite'] as const)('returns a %s rejected wake, accepts its corrected retry once and cold-replays both facts', async (backend) => {
  const h = await createBusinessHarness(backend)
  try {
    const sender = await h.actor('sender'), target = await h.actor('target')
    const wake = simulationWakeRequestSchema.parse({ id: 'reply', entityId: sender.id, time: '0', reason: 'reply' })
    await h.run.scheduleWake(wake, h.run.snapshot().revision); await h.run.drive({ until: wake.time })
    const submit = async (name: string, recipient: string) => {
      const id = simulationDecisionIdSchema.parse(name)
      const window = simulationWindowRequestSchema.parse({ id: name, decisions: [{ id, entityId: sender.id,
        wakeId: wake.id, context: contextRequest() }] })
      await h.run.openWindow(window, h.run.snapshot().revision)
      await sender.lease.startDecision(id, Date.now())
      await sender.lease.submitDecision(id, [simulationProposalSchema.parse({ after: [], action: {
        kind: 'communication/post', recipient, channelId: 'channel', text: 'hello', deliverAt: '0' } })])
      await h.run.commitWindow(window.id)
      return id
    }
    const rejected = await submit('wrong-id', 'participant-unknown')
    expect(h.run.snapshot().decisions[rejected]).toMatchObject({ status: 'cancelled', messageRejection: {
      code: 'SIM_MESSAGE_RECIPIENT_INVALID', attempt: 1 } })
    expect(h.run.snapshot().activeWindowId).toBeUndefined()
    expect(h.run.snapshot().phase).toBe('running')
    expect(h.run.snapshot().wakes[wake.id]?.status).toBe('pending')
    expect(Object.keys(h.run.snapshot().operations)).toHaveLength(0)
    const accepted = await submit('corrected-id', target.id)
    expect(h.run.snapshot().decisions[accepted]?.status).toBe('accepted')
    expect(h.run.snapshot().wakes[wake.id]?.status).toBe('completed')
    expect(Object.values(h.run.snapshot().operations).map(value => value.action)).toEqual([
      { kind: 'communication/post', recipient: target.id, channelId: 'channel', text: 'hello', deliverAt: '0' }])
    for (const lease of h.leases) { await lease.revoke(); await lease.release() }
    await h.run.close()
    const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
    try {
      expect(reopened.snapshot().decisions[rejected]?.messageRejection).toEqual(h.run.snapshot().decisions[rejected]?.messageRejection)
      expect(reopened.snapshot().decisions[accepted]?.status).toBe('accepted')
      expect(reopened.snapshot().activeWindowId).toBeUndefined()
    } finally { await reopened.close() }
  } finally { await h.close() }
})

it('stops a permanently invalid message at its retained retry bound without leaving a collecting window', async () => {
  const h = await createBusinessHarness('sqlite', { maxConflictRetries: 1 })
  try {
    const sender = await h.actor('sender'), wake = simulationWakeRequestSchema.parse({ id: 'reply', entityId: sender.id, time: '0', reason: 'reply' })
    await h.run.scheduleWake(wake, h.run.snapshot().revision); await h.run.drive({ until: wake.time })
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = simulationDecisionIdSchema.parse(`attempt-${attempt}`), window = simulationWindowRequestSchema.parse({ id,
        decisions: [{ id, entityId: sender.id, wakeId: wake.id, context: contextRequest() }] })
      await h.run.openWindow(window, h.run.snapshot().revision)
      await sender.lease.submitDecision(id, [simulationProposalSchema.parse({ after: [], action: {
        kind: 'communication/post', recipient: 'wrong', channelId: 'channel', text: 'hello', deliverAt: '0' } })])
      await h.run.commitWindow(window.id)
    }
    expect(h.run.snapshot()).toMatchObject({ phase: 'stalled', stall: { code: 'SIM_MESSAGE_SUBMISSION_BLOCKED' } })
    expect(h.run.snapshot().activeWindowId).toBeUndefined()
    expect(Object.keys(h.run.snapshot().operations)).toHaveLength(0)
  } finally { await h.close() }
})


it('refuses fabricated rejection evidence and preserves a submitted message when storage fails', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const sender = await h.actor('sender'), receiver = await h.actor('receiver'), id = simulationDecisionIdSchema.parse('valid')
    const window = simulationWindowRequestSchema.parse({ id: 'valid', decisions: [{ id, entityId: sender.id, context: contextRequest() }] })
    const proposals = [simulationProposalSchema.parse({ after: [], action: { kind: 'communication/post', recipient: receiver.id,
      channelId: 'channel', deliverAt: '0', text: 'once' } })]
    await h.run.openWindow(window, h.run.snapshot().revision)
    await sender.lease.submitDecision(id, proposals)
    const before = h.run.snapshot()
    expect(() => foldBusinessRecord(before, { kind: 'decision/message-rejected', id,
      code: 'SIM_MESSAGE_RECIPIENT_INVALID', proposalHash: businessFingerprint(proposals) }, before.revision + 1)).toThrow(/no matching/)
    const stream = (h.run as unknown as { stream: LogStream }).stream
    const failure = vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('Disk unavailable'))
    await expect(h.run.commitWindow(window.id)).rejects.toThrow(/Disk unavailable/)
    failure.mockRestore()
    expect(h.run.snapshot()).toEqual(before)
    await h.run.commitWindow(window.id)
    await h.run.commitWindow(window.id)
    expect(Object.keys(h.run.snapshot().operations)).toHaveLength(1)
    expect(h.run.snapshot().decisions[id]?.messageRejection).toBeUndefined()
  } finally { await h.close() }
})


it('classifies an out-of-horizon queued delivery as a correctable time rejection', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const sender = await h.actor('sender'), receiver = await h.actor('receiver')
    const wake = simulationWakeRequestSchema.parse({ id: 'time', entityId: sender.id, time: '0', reason: 'time' })
    await h.run.scheduleWake(wake, h.run.snapshot().revision); await h.run.drive({ until: wake.time })
    const id = simulationDecisionIdSchema.parse('wrong-time'), window = simulationWindowRequestSchema.parse({ id,
      decisions: [{ id, entityId: sender.id, wakeId: wake.id, context: contextRequest() }] })
    await h.run.openWindow(window, h.run.snapshot().revision)
    await sender.lease.submitDecision(id, [simulationProposalSchema.parse({ after: [], action: { kind: 'communication/post',
      recipient: receiver.id, channelId: 'channel', text: 'hello', deliverAt: '101' } })])
    await h.run.commitWindow(window.id)
    expect(h.run.snapshot().decisions[id]?.messageRejection?.code).toBe('SIM_MESSAGE_TIME_INVALID')
    expect(h.run.snapshot().phase).toBe('running')
    expect(h.run.snapshot().activeWindowId).toBeUndefined()
    expect(h.run.snapshot().wakes[wake.id]?.status).toBe('pending')
  } finally { await h.close() }
})
