/** Current-owner control and pause/save remain available when full history cannot be inspected. */
import { expect, it, vi } from 'vitest'
import { StorageReadLimitError } from '@clocky/clocky-storage'
import { ownerFixture } from './company-owner-fixture.ts'
import { call } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('controls and saves an owned run without opening bounded detail history (%s)', async (backend) => {
  const h = await ownerFixture(backend)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration, run = h.owned()
    const read = vi.spyOn(h.ctx.simulations, 'inspect').mockRejectedValue(new StorageReadLimitError('bytes', 100000000, 16000000))
    await expect(h.ctx.simulationProducts.inspect({ runId }, call())).rejects.toMatchObject({
      code: 'SIMULATION_PRODUCT_UNAVAILABLE', reason: 'history-limit', limit: { dimension: 'bytes', actual: 100000000, limit: 16000000 },
    })
    const snapshot = vi.spyOn(run, 'snapshot')
    const control = await service.control({ runId }, call())
    expect(control).toMatchObject({ owner: 'held', phase: 'paused', inFlight: false })
    expect(snapshot).not.toHaveBeenCalled()
    snapshot.mockRestore()
    await service.manage({ runId, managementId: 'pause-without-history' as never, phase: 'paused' }, call())
    const commandId = 'save-without-history' as never
    await service.checkpoint({ runId, commandId }, call())
    expect(await h.finished(commandId)).toMatchObject({ status: 'completed' })
    expect(read).toHaveBeenCalledTimes(1)
    expect(h.requests).toHaveLength(0)
    await h.fiber.dispose(); await h.mount()
    const cold = await h.ctx.simulationAdministration.control({ runId }, call())
    expect(cold).toMatchObject({ owner: 'not-held', driverSource: { status: 'owner-unavailable' },
      historyRead: { status: 'unavailable', reason: 'history-limit', limit: { dimension: 'bytes', actual: 100000000, limit: 16000000 } } })
    expect(cold.phase).toBeUndefined()
    expect(cold.actions.start.allowed).toBe(false)
    expect(cold.actions.pause.allowed).toBe(false)
  } finally { vi.restoreAllMocks(); await h.close() }
})

it('refuses a proven impossible creation budget before allocating a run and leaves future consumption unknown', async () => {
  const h = await ownerFixture()
  try {
    const open = vi.spyOn(h.ctx.simulations, 'open')
    vi.spyOn(h.ctx.simulationTeams, 'requestCapacity').mockReturnValue({ status: 'impossible', dimension: 'request-limit',
      minimumRequired: '514', limit: 256 })
    const { commandId: _command, expectedModel: _model, ...preview } = h.input
    expect(await h.ctx.simulationAdministration.preflight(preview, call())).toMatchObject({ status: 'invalid',
      issues: [{ field: 'tokensPerModelRequest', code: 'capacity-unavailable' }] })
    await expect(h.ctx.simulationAdministration.create(h.input, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    expect(open).not.toHaveBeenCalled()
    expect(h.requests).toHaveLength(0)
  } finally { vi.restoreAllMocks(); await h.close() }
})
