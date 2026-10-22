/** Stop targets are separate durable commands: refusals stay refusals, unknown outcomes retry the exact original. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok, err } from './fake-api.client.ts'

const runId = 'run' as never
const target = { targetId: 'target-1', clock: { kind: 'native' as const }, boundary: '12' as never, mode: 'drain-admitted' as const,
  checkpointPolicy: 'request' as const, drainBudget: { maxSteps: 32, maxTokens: 4096, maxWallTimeMs: 600000 } }
const control = { runId, owner: 'held', driver: 'idle', inFlight: false, observedAt: 1,
  actions: { start: { allowed: false, reason: 'stop-target-pending' }, pause: { allowed: true, reason: 'ready' } },
  administration: { actions: { checkpoint: { allowed: true, reason: 'ready' }, restore: { allowed: true, reason: 'ready' },
    prepare: { allowed: true, reason: 'ready' }, ingress: { allowed: true, reason: 'ready' } }, ingress: { maxTime: '100', maxBytes: 1, targets: [] } },
  budget: { model: { provider: 'p', name: 'm' }, tokensPerRequest: 1, tokensPerInterval: 1, interval: '1', residentActors: 1, sharedModelLimit: 1 } }

function fixture() {
  const ctx = new Context(), api = new FakeApiClient(), source = new SimulationRuntime(ctx, api)
  source.connected('scope' as never)
  return { ctx, api, source, owner: source.runControl(ctx, { timeoutMs: 1000 }) }
}

it('confirms a target only from the Host receipt and never starts scheduling', async () => {
  const h = fixture()
  try {
    const update = vi.spyOn(h.api.simulations, 'updateRunControl').mockImplementation(async input => ok({ runId,
      receipt: { commandId: input.commandId, revision: 7, activation: 'effective', targetId: 'target-1' }, control } as never))
    const manage = vi.spyOn(h.api.simulations, 'manage')
    await h.owner.update({ runId, target })
    expect(h.owner.state.getSnapshot()).toMatchObject({ status: 'confirmed', receipt: { activation: 'effective', targetId: 'target-1' } })
    expect(update.mock.calls[0]?.[0]).toMatchObject({ runId, target })
    expect(manage).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps a boundary refusal distinct and retries an unknown outcome with the exact original command', async () => {
  const h = fixture()
  try {
    const update = vi.spyOn(h.api.simulations, 'updateRunControl')
      .mockResolvedValueOnce(err({ code: 'simulation-product-invalid', message: 'The target is earlier than the confirmed clock; keep the run paused', details: {} }))
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockImplementationOnce(async input => ok({ runId, receipt: { commandId: input.commandId, revision: 8, activation: 'pending', targetId: 'target-1' }, control } as never))
    await h.owner.update({ runId, target })
    expect(h.owner.state.getSnapshot()).toMatchObject({ status: 'refused', error: 'invalid' })
    await h.owner.update({ runId, target: { ...target, boundary: '13' as never } })
    const unknown = h.owner.state.getSnapshot()
    expect(unknown.status).toBe('unknown')
    expect(h.owner.dismiss()).toBe(false)
    await expect(h.owner.update({ runId, target })).rejects.toThrow(/original/)
    await h.owner.retry()
    expect(update.mock.calls[2]?.[0]).toEqual(unknown.input)
    expect(h.owner.state.getSnapshot()).toMatchObject({ status: 'confirmed', receipt: { activation: 'pending' } })
    expect(h.owner.dismiss()).toBe(true)
  } finally { await h.ctx.fiber.dispose() }
})

it('clears the original command when the credential is replaced', async () => {
  const h = fixture()
  try {
    vi.spyOn(h.api.simulations, 'updateRunControl').mockRejectedValueOnce(new Error('lost'))
    await h.owner.update({ runId, target: null })
    expect(h.owner.state.getSnapshot().status).toBe('unknown')
    h.source.clearAuthorization()
    expect(h.owner.state.getSnapshot().status).toBe('idle')
  } finally { await h.ctx.fiber.dispose() }
})
