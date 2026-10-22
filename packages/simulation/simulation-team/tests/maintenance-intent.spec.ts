/** New control may replace an immutable Native cut; collection still has one bounded retry owner. */
import { describe, expect, it, vi } from 'vitest'
import { simulationWorldCancelRequestSchema, simulationPhaseManagementRequestSchema, simulationMaintenanceRequestSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from '../../simulation-local/tests/hiring-resource-harness.ts'
import { checkpointRule } from '../src/checkpoint-failure.ts'

describe.each(['json', 'sqlite'] as const)('%s maintenance control intent', (backend) => {
  it('records cancellation under a sealed source while keeping ordinary production blocked', async () => {
    const h = await hiringResourceHarness(backend, 'generate-and-hire')
    let release: (() => void) | undefined
    try {
      const plan = await h.plan('cancel-sealed-source')
      await h.connection.quiesceForMaintenance(simulationMaintenanceRequestSchema.parse({ id: 'sealed-control', owner: 'simulation/company-product' }), 4, 3, h.lifetime.signal)
      const cut = await h.run.acquireCheckpointCut(4); release = () => { cut.release() }
      const cancel = await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'new-sealed-cancel', requestId: plan.requestId }))
      expect(cancel.status).toBe('cancelled')
      expect(h.run.snapshot().world?.cancellations[cancel.request.id]).toEqual(cancel)
      await expect(h.run.getPersistenceReference(cut.reference.cursor)).rejects.toMatchObject({ code: 'SIM_REVISION_CONFLICT' })
      await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toThrow(/blocks new writes/)
      expect(h.requests).toHaveLength(0)
    } finally { release?.(); await h.close() }
  })

  it('uses exactly the original attempt allowance when each candidate is invalidated by a newer pause', async () => {
    const h = await hiringResourceHarness(backend, 'generate-and-hire')
    try {
      await h.plan('bounded-new-pause')
      const collect = h.connection.collectCheckpointCandidate.bind(h.connection)
      let attempts = 0
      const spy = vi.spyOn(h.connection, 'collectCheckpointCandidate').mockImplementation(async (...args) => {
        expect(args[1]).toBe(1)
        const candidate = await collect(...args)
        await h.run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: `pause-${++attempts}`, phase: 'paused' }))
        return candidate
      })
      await expect(h.connection.quiesceForMaintenance(simulationMaintenanceRequestSchema.parse({ id: 'bounded-control', owner: 'simulation/company-product' }), 4, 3, h.lifetime.signal))
        .rejects.toMatchObject({ diagnostic: { code: 'source-moved', subject: { kind: 'run' } } })
      expect(spy).toHaveBeenCalledTimes(3)
      expect(attempts).toBe(3)
      expect(Object.values(h.run.snapshot().management ?? {}).every(value => value.status === 'completed')).toBe(true)
      expect(Object.values(h.run.snapshot().maintenance ?? {}).find(value => value.request.id === 'bounded-control')?.status).toBe('draining')
      expect(h.requests).toHaveLength(0)
      spy.mockRestore()
    } finally { await h.close() }
  })

  it.each(['source-moved', 'history-incomplete'] as const)('does not treat %s without new control as a replacement Native source', async (code) => {
    const h = await hiringResourceHarness(backend, 'generate-and-hire')
    try {
      await h.plan('invalid-source')
      const error = checkpointRule('Original source refused', 'validate', code, { kind: 'run' })
      const spy = vi.spyOn(h.connection, 'collectCheckpointCandidate').mockRejectedValue(error)
      await expect(h.connection.quiesceForMaintenance(simulationMaintenanceRequestSchema.parse({ id: 'invalid-control', owner: 'simulation/company-product' }), 4, 3, h.lifetime.signal))
        .rejects.toBe(error)
      expect(spy).toHaveBeenCalledTimes(1)
      spy.mockRestore()
    } finally { await h.close() }
  })
})
