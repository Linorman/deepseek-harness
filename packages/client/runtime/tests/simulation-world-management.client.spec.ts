/** Human quotes retire by authority and selection while ordinary offline state preserves marked original choices. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { simulationProductWatchResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldManagementOutcomeSchema } from '@clocky/clocky-simulation-product/world-management-schema'
import { managementDraft, managementFields, managementPreview, managementSubmit } from '../../../simulation/simulation-product/tests/world-management-fixture.ts'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok } from './fake-api.client.ts'

function fixture() {
  const ctx = new Context(), api = new FakeApiClient(), source = new SimulationRuntime(ctx, api)
  source.connected('credential' as never)
  const observe = (revision = 3, version = 'policy') =>{  source.state.set({ ...source.state.getSnapshot(),
    run: { scope: JSON.stringify(['run', 'run']), loading: false, stale: false },
    observation: { loading: false, stale: false, value: simulationProductWatchResultSchema.parse({ runId: 'run', readVersion: version,
      status: 'changed', cursor: 'cursor', observedAt: 1, world: { status: 'observed', revision } }) } }) }
  observe()
  const reader = source.worldManagementReader(ctx)
  return { ctx, api, source, reader, observe }
}
it('reads exact choices and a full original quote without management, restore or submission', async () => {
  const h = fixture()
  try {
    const fields = vi.spyOn(h.api.simulations, 'worldManagementFields').mockResolvedValue(ok(managementFields))
    const preview = vi.spyOn(h.api.simulations, 'previewWorldManagement').mockResolvedValue(ok(managementPreview))
    const submit = vi.spyOn(h.api.simulations, 'submitWorldManagement'), restore = vi.spyOn(h.api.simulations, 'restore')
    await h.reader.fields({ runId: managementDraft.runId, action: 'transfer', targetId: managementDraft.targetId })
    await h.reader.preview(managementDraft)
    expect(fields).toHaveBeenCalledOnce(); expect(preview).toHaveBeenCalledWith(managementDraft, expect.any(AbortSignal))
    expect(h.reader.state.getSnapshot().preview.value).toEqual(managementPreview)
    expect(submit).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled()
    h.reader.close(); expect(h.reader.state.getSnapshot().preview.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})
it.each(['policy', 'native', 'credential', 'offline'] as const)('does not revive an obsolete quote after %s change', async (change) => {
  const h = fixture(), pending = Promise.withResolvers<ReturnType<typeof ok<typeof managementPreview>>>()
  try {
    vi.spyOn(h.api.simulations, 'previewWorldManagement').mockResolvedValueOnce(ok(managementPreview)).mockReturnValueOnce(pending.promise)
    await h.reader.preview(managementDraft)
    const late = h.reader.preview(managementDraft)
    if (change === 'credential') h.source.connected('new-credential' as never)
    else if (change === 'offline') h.source.disconnected()
    else h.observe(change === 'native' ? 4 : 3, change === 'policy' ? 'replacement' : 'policy')
    pending.resolve(ok(managementPreview)); await late
    const value = h.reader.state.getSnapshot().preview
    if (change === 'credential' || change === 'native') expect(value.value).toBeUndefined()
    else expect(value).toMatchObject({ value: managementPreview, stale: true, loading: false })
  } finally { pending.resolve(ok(managementPreview)); await h.ctx.fiber.dispose() }
})
it('keeps a newer exact quote current while metadata catches up and refuses a replaced reason', async () => {
  const h = fixture()
  try {
    h.observe(1)
    const read = vi.spyOn(h.api.simulations, 'previewWorldManagement').mockResolvedValue(ok(managementPreview))
    await h.reader.preview(managementDraft)
    h.observe(2); h.observe(3)
    expect(h.reader.state.getSnapshot().preview.stale).toBe(false)
    read.mockResolvedValue(ok({ ...managementPreview, input: { ...managementDraft,
      values: { ...managementDraft.values, reason: 'Other original reason' } } }))
    await h.reader.preview(managementDraft)
    expect(h.reader.state.getSnapshot().preview).toMatchObject({ stale: true, error: 'network' })
  } finally { await h.ctx.fiber.dispose() }
})
it('retains one immutable user command and requires lookup before exact retry after transport loss', async () => {
  const h = fixture()
  try {
    const owner = h.source.administration(h.ctx, { maxCommands: 2, maxBytes: 65536 })
    const send = vi.spyOn(h.api.simulations, 'submitWorldManagement').mockRejectedValueOnce(new Error('Response lost'))
    const key = owner.retain({ kind: 'world-management', input: managementSubmit }, h.source.state.getSnapshot().authorizationVersion)
    expect(await owner.submit(key)).toMatchObject({ unknown: true, error: 'network' })
    await owner.submit(key); expect(send).toHaveBeenCalledOnce()
    vi.spyOn(h.api.simulations, 'request').mockResolvedValue(ok({ status: 'not-found', commandId: managementSubmit.commandId }))
    await owner.query(key)
    send.mockResolvedValue(ok({ kind: 'world-management', runId: managementSubmit.runId, commandId: managementSubmit.commandId,
      status: 'accepted', acceptedAt: 1 }))
    await owner.submit(key)
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1]?.[0]).toEqual(managementSubmit)
    expect(owner.state.getSnapshot().commands[key]?.receipt).toMatchObject({ kind: 'request', value: { status: 'accepted' } })
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['original', 'other-run', 'other-command'] as const)('recovers only %s management case metadata through a cold original selector', async (selection) => {
  const h = fixture()
  try {
    const owner = h.source.administration(h.ctx, { maxCommands: 2, maxBytes: 65536 })
    const command = { kind: 'retry-request' as const, input: { runId: managementSubmit.runId, commandId: managementSubmit.commandId } }
    const key = owner.retain(command, h.source.state.getSnapshot().authorizationVersion)
    const outcome = simulationProductWorldManagementOutcomeSchema.parse({ commandId: selection === 'other-command' ? 'foreign' : managementSubmit.commandId,
      runId: selection === 'other-run' ? 'foreign-run' : managementSubmit.runId,
      acceptedSequence: 4, requestId: 'original-case', intentId: 'original-intent', planId: 'original-plan' })
    vi.spyOn(h.api.simulations, 'request').mockResolvedValue(ok({ status: 'found', worldManagement: managementSubmit,
      worldManagementOutcome: outcome, request: { commandId: managementSubmit.commandId, runId: managementSubmit.runId,
        kind: 'world-management', acceptedAt: 1, status: 'accepted' } }))
    const write = vi.spyOn(h.api.simulations, 'retryRequest')
    const result = await owner.query(key)
    if (selection === 'original') expect(result?.receipt).toMatchObject({ kind: 'request', worldManagementOutcome: outcome })
    else {
      expect(result).toMatchObject({ pending: false, error: 'network' })
      expect(result?.receipt).toBeUndefined()
    }
    expect(result?.command).toEqual(command); expect(write).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})
