/** Product cancellation uses actual scoped canonical operations and remains recoverable by its original command. */
import { afterEach, expect, it, vi } from 'vitest'
import { ownerFixture } from './company-owner-fixture.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { simulationProductTaskCancelInputSchema } from '../src/task-control-schema.ts'
import { call } from './fixtures.ts'

afterEach(() => { vi.restoreAllMocks() })
const driver = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1', steps: [
  { id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'supplier', channelKey: 'purchase',
    reviewerEntityId: 'supplier', subject: 'Private task subject', description: 'Private task instructions', text: 'Private report body',
    cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 2, retry: 'before-effects' },
] } })

it.each(['json', 'sqlite'] as const)('cancels a reviewed report through its original product command without reverting its effect (%s)', async (backend) => {
  const h = await ownerFixture(backend, {}, driver)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage({ runId, managementId: 'task-control-start' as never, phase: 'running' }, call())
    const row = await vi.waitFor(async () => {
      const result = await service.listTaskReviews({ runId }, call())
      const item = result.items.find(item => item.action.allowed)
      if (item === undefined) throw new Error('Real reviewed attempt is not ready')
      return item
    }, { timeout: 3000, interval: 5 })
    await service.manage({ runId, managementId: 'task-control-pause' as never, phase: 'paused' }, call())
    const controls = await service.listTasks({ runId, limit: 1 }, call())
    expect(controls.total).toBe(1)
    expect(controls.items[0]).toMatchObject({ operationId: row.operationId, taskId: row.taskId, phase: 'review', expectedAttemptId: null,
      cancel: { allowed: true, reason: 'ready' } })
    expect(JSON.stringify(controls)).not.toContain('Private')
    const before = h.owned().snapshot()
    const input = simulationProductTaskCancelInputSchema.parse({ runId, commandId: 'cancel-exact-report', operationId: row.operationId,
      expectedRevision: controls.items[0]!.taskRevision, expectedAttemptId: null, reason: 'Cancel this reviewed report' })
    await service.cancelTask(input, call())
    const terminal = await h.finished(input.commandId)
    expect(terminal).toMatchObject({ status: 'completed', kind: 'cancel-task' })
    const task = await h.ctx.teams.getTask({ teamId: row.teamId, taskId: row.taskId })
    expect(task.phase).toBe('cancelled')
    expect(task.attemptHistory[0]?.outcome.kind).toBe('completed')
    expect(task.cancellation?.target.kind).toBe('review')
    const after = h.owned().snapshot()
    expect(after.phase).toBe('paused')
    expect(after.resources).toEqual(before.resources)
    expect(Object.keys(after.operations)).toEqual(Object.keys(before.operations))
    expect(h.requests).toEqual([])
    expect(await service.cancelTask(input, call())).toEqual(terminal)
    await expect(service.cancelTask({ ...input, reason: 'Another reason' }, call())).rejects.toThrow()
    expect(await service.request({ commandId: input.commandId }, call())).toEqual({ status: 'found', request: terminal, cancellation: input })
    expect((await service.listTasks({ runId }, call())).items[0]?.cancel.reason).toBe('terminal')
    await h.fiber.dispose(); await h.mount()
    const cold = h.ctx.simulationAdministration, open = vi.spyOn(h.ctx.simulations, 'open').mockClear()
    expect(await cold.retryRequest({ runId, commandId: input.commandId }, call())).toEqual(terminal)
    expect(open).not.toHaveBeenCalled()
  } finally { await h.close() }
})

it('retains definitive stale-revision refusal and denies other owners without exposing task bodies', async () => {
  const h = await ownerFixture('json', {}, driver)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage({ runId, managementId: 'stale-cancel-start' as never, phase: 'running' }, call())
    const row = await vi.waitFor(async () => {
      const page = await service.listTaskReviews({ runId }, call())
      const item = page.items.find(item => item.action.allowed)
      if (item === undefined) throw new Error('Waiting for canonical review')
      return item
    }, { timeout: 3000, interval: 5 })
    await service.manage({ runId, managementId: 'stale-cancel-pause' as never, phase: 'paused' }, call())
    const before = await h.ctx.teams.getTask({ teamId: row.teamId, taskId: row.taskId })
    const request = simulationProductTaskCancelInputSchema.parse({ runId, commandId: 'stale-cancel', operationId: row.operationId,
      expectedRevision: row.taskRevision - 1, expectedAttemptId: null, reason: 'Stale selection' })
    await service.cancelTask(request, call())
    expect(await h.finished(request.commandId)).toMatchObject({ status: 'failed', failure: 'cancel-task-failed' })
    expect(await h.ctx.teams.getTask({ teamId: row.teamId, taskId: row.taskId })).toEqual(before)
    await expect(service.listTasks({ runId }, call(undefined, 'other'))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await expect(service.cancelTask({ ...request, commandId: 'foreign-cancel' as never }, call(undefined, 'other')))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  } finally { await h.close() }
})
