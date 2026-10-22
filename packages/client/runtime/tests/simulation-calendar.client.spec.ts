/** Runtime retains one complete calendar intent across timeout, retry and authority changes. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { simulationProductCalendarInputSchema, simulationProductCalendarPreviewSchema,
  simulationProductCalendarReceiptSchema } from '@clocky/clocky-simulation-product/schema'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok } from './fake-api.client.ts'
const input = simulationProductCalendarInputSchema.parse({ runId: 'run', request: { commandId: 'original', expectedRuleRevision: 1,
  calendar: { id: 'daily', target: { kind: 'person', personId: 'actor' }, body: 'Work', startsAt: '5', endsAt: '9', period: '2', maxOccurrences: 3 } } })
const preview = simulationProductCalendarPreviewSchema.parse({ input, revision: 4, previewHash: `sha256:${'a'.repeat(64)}`,
  cancelled: ['old'], queued: [{ id: 'new', time: '5' }] })
const receipt = simulationProductCalendarReceiptSchema.parse({ runId: 'run', commandId: 'original', revision: 5, ruleRevision: 2, sequence: 5 })
function fixture() {
  const ctx = new Context(), api = new FakeApiClient(), source = new SimulationRuntime(ctx, api)
  source.connected('credential' as never)
  source.state.set({ ...source.state.getSnapshot(), run: { scope: JSON.stringify(['run', 'run']), loading: false, stale: false } })
  vi.spyOn(api.simulations, 'retainWorldCalendar').mockResolvedValue(ok({ command: { preview, status: 'retained', retainedSequence: 5, receipt: null } }))
  const calendar = source.worldCalendar(ctx, { timeoutMs: 50, maxBytes: 10000 })
  return { ctx, api, source, calendar }
}
it('retains the exact command after response loss and retries without replacing its quote', async () => {
  const h = fixture()
  try {
    vi.spyOn(h.api.simulations, 'previewWorldCalendar').mockResolvedValue(ok(preview))
    const submit = vi.spyOn(h.api.simulations, 'submitWorldCalendar').mockRejectedValueOnce(new Error('Reply lost')).mockResolvedValueOnce(ok(receipt))
    await h.calendar.preview(input); await h.calendar.submit()
    expect(h.calendar.state.getSnapshot()).toMatchObject({ status: 'unknown', input, preview })
    expect(h.calendar.close()).toBe(false)
    h.source.state.set({ ...h.source.state.getSnapshot(), run: { scope: JSON.stringify(['run', 'another']), loading: false, stale: false } })
    expect(h.calendar.state.getSnapshot()).toMatchObject({ status: 'unknown', input })
    await expect(h.calendar.submit()).rejects.toThrow(/active authenticated run/)
    h.source.state.set({ ...h.source.state.getSnapshot(), run: { scope: JSON.stringify(['run', 'run']), loading: false, stale: false } })
    await expect(h.calendar.preview({ ...input, request: { ...input.request, commandId: 'replacement' } })).rejects.toThrow(/original/)
    await h.calendar.submit()
    expect(submit.mock.calls[0]![0]).toEqual(submit.mock.calls[1]![0])
    expect(h.calendar.state.getSnapshot()).toMatchObject({ status: 'completed', receipt })
  } finally { await h.ctx.fiber.dispose() }
})
it('times out an unresponsive transport and clears private originals after authority withdrawal', async () => {
  const h = fixture()
  try {
    vi.spyOn(h.api.simulations, 'previewWorldCalendar').mockResolvedValue(ok(preview))
    vi.spyOn(h.api.simulations, 'submitWorldCalendar').mockImplementation(() => new Promise(() => {}))
    await h.calendar.preview(input); await h.calendar.submit()
    expect(h.calendar.state.getSnapshot().status).toBe('unknown')
    h.source.clearAuthorization()
    expect(h.calendar.state.getSnapshot()).toEqual({ status: 'idle' })
  } finally { await h.ctx.fiber.dispose() }
})
it('rejects oversized originals before transport and ignores late quotes after an authority change', async () => {
  const h = fixture()
  try {
    const request = vi.spyOn(h.api.simulations, 'previewWorldCalendar')
    expect(() => h.calendar.preview({ ...input, request: { ...input.request, calendar: { ...input.request.calendar, body: 'x'.repeat(10001) } } })).toThrow(/byte/)
    expect(request).not.toHaveBeenCalled()
    let resolve: ((value: ReturnType<typeof ok<typeof preview>>) => void) | undefined
    request.mockImplementation(() => new Promise((done) => { resolve = done }))
    const pending = h.calendar.preview(input)
    h.source.clearAuthorization(); resolve?.(ok(preview)); await pending
    expect(h.calendar.state.getSnapshot()).toEqual({ status: 'idle' })
  } finally { await h.ctx.fiber.dispose() }
})
it('recovers a durable original in a fresh runtime and preserves application when cancellation races', async () => {
  const h = fixture()
  try {
    const read = vi.spyOn(h.api.simulations, 'readWorldCalendarCommand').mockResolvedValue(ok({ command: {
      preview, status: 'retained', retainedSequence: 5, receipt: null } }))
    const submit = vi.spyOn(h.api.simulations, 'submitWorldCalendar')
    await h.calendar.recover('run')
    expect(read).toHaveBeenCalledOnce()
    expect(submit).not.toHaveBeenCalled()
    expect(h.calendar.state.getSnapshot()).toMatchObject({ status: 'unknown', input, preview })
    expect(h.calendar.close()).toBe(false)
    vi.spyOn(h.api.simulations, 'cancelWorldCalendar').mockResolvedValue(ok({ command: {
      preview, status: 'applied', retainedSequence: 5, receipt } }))
    await h.calendar.cancel()
    expect(h.calendar.state.getSnapshot()).toMatchObject({ status: 'completed', receipt })
  } finally { await h.ctx.fiber.dispose() }
})
it('never executes after a late retention acknowledgement and can recover the retained original', async () => {
  const h = fixture()
  try {
    vi.spyOn(h.api.simulations, 'previewWorldCalendar').mockResolvedValue(ok(preview))
    let settle: (() => void) | undefined
    vi.spyOn(h.api.simulations, 'retainWorldCalendar').mockImplementation(() => new Promise((resolve) => {
      settle = () => { resolve(ok({ command: { preview, status: 'retained', retainedSequence: 5, receipt: null } })) }
    }))
    const submit = vi.spyOn(h.api.simulations, 'submitWorldCalendar')
    await h.calendar.preview(input); await h.calendar.submit()
    expect(h.calendar.state.getSnapshot()).toMatchObject({ status: 'unknown', phase: 'retention' })
    settle?.(); await Promise.resolve(); await Promise.resolve()
    expect(submit).not.toHaveBeenCalled()
    vi.spyOn(h.api.simulations, 'readWorldCalendarCommand').mockResolvedValue(ok({ command: {
      preview, status: 'retained', retainedSequence: 5, receipt: null } }))
    await h.calendar.recover('run')
    expect(h.calendar.state.getSnapshot()).toMatchObject({ status: 'unknown', phase: 'execution', preview })
  } finally { await h.ctx.fiber.dispose() }
})
it('blocks new quotes and dismissal while a refreshed runtime is finding its original', async () => {
  const h = fixture()
  try {
    let resolve: ((value: Awaited<ReturnType<typeof h.api.simulations.readWorldCalendarCommand>>) => void) | undefined
    vi.spyOn(h.api.simulations, 'readWorldCalendarCommand').mockImplementation(() => new Promise((done) => { resolve = done }))
    const previewRequest = vi.spyOn(h.api.simulations, 'previewWorldCalendar')
    const recovery = h.calendar.recover('run')
    expect(h.calendar.state.getSnapshot()).toEqual({ status: 'recovering' })
    expect(h.calendar.close()).toBe(false)
    await expect(h.calendar.preview(input)).rejects.toThrow(/original/)
    expect(previewRequest).not.toHaveBeenCalled()
    resolve?.(ok({ command: { preview, status: 'retained', retainedSequence: 5, receipt: null } }))
    await recovery
    expect(h.calendar.state.getSnapshot()).toMatchObject({ status: 'unknown', input, preview })
  } finally { await h.ctx.fiber.dispose() }
})
it('keeps failed original discovery unresolved until an explicit successful lookup', async () => {
  const h = fixture()
  try {
    vi.spyOn(h.api.simulations, 'readWorldCalendarCommand').mockRejectedValueOnce(new Error('discovery lost'))
      .mockResolvedValueOnce(ok({ command: null }))
    await h.calendar.recover('run')
    expect(h.calendar.state.getSnapshot()).toMatchObject({ status: 'unknown', error: 'discovery lost' })
    expect(h.calendar.close()).toBe(false)
    await expect(h.calendar.preview(input)).rejects.toThrow(/original/)
    await h.calendar.recover('run')
    expect(h.calendar.state.getSnapshot()).toEqual({ status: 'idle' })
  } finally { await h.ctx.fiber.dispose() }
})
