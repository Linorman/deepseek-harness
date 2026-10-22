/** A final synchronous refusal must settle the real Native reservation without entering downstream code. */
import { expect, it, vi } from 'vitest'
import type { StreamChunk } from '@clocky/clocky-llm'
import { simulationDecisionIdSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { meteredStream } from '../src/metered-stream.ts'

it('settles tokens as not-dispatched when synchronous authority rejects after the awaited admission check', async () => {
  const h = await createBusinessHarness('json', { tokensPerModelRequest: 100 })
  const gate = Promise.withResolvers<undefined>()
  try {
    const actor = await h.actor('requester'), id = simulationDecisionIdSchema.parse('metered-authority-gap')
    await actor.lease.openDecision(id, h.run.snapshot().revision)
    await actor.lease.prepareContext(id, contextRequest())
    await actor.lease.startDecision(id, 0)
    const reservation = await actor.lease.reserveModelTokens(id, { provider: 'fixture', model: 'scripted', sessionSequence: 1 })
    expect(h.run.budgetUsage().tokens.used).toBe(100)
    let checked = false
    const check = vi.fn(async () => { await gate.promise; checked = true })
    const denied = new Error('Scope access ended after asynchronous admission')
    const beforeDispatch = vi.fn(() => { expect(checked).toBe(true); throw denied })
    const next = vi.fn<() => AsyncIterable<StreamChunk>>(() => (async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
    })())
    const flush = vi.fn(async () => true), settle = vi.spyOn(actor.lease, 'settleModelTokens')
    const iterator = meteredStream(actor.lease, reservation, next, check, flush, new AbortController().signal, beforeDispatch)
      [Symbol.asyncIterator]()
    const reading = iterator.next()
    expect(check).toHaveBeenCalledOnce()
    expect(beforeDispatch).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    expect(h.run.snapshot().tokenReservations?.[reservation.id]?.status).toBe('reserved')
    gate.resolve(undefined)
    await expect(reading).rejects.toBe(denied)
    expect(beforeDispatch).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
    expect(flush).toHaveBeenCalledOnce()
    expect(settle).toHaveBeenCalledExactlyOnceWith(reservation.id, { kind: 'not-dispatched' })
    expect(h.run.snapshot().tokenReservations?.[reservation.id]?.status).toBe('not-dispatched')
    expect(h.run.budgetUsage().tokens.used).toBe(0)
  } finally { gate.resolve(undefined); await h.close() }
})
