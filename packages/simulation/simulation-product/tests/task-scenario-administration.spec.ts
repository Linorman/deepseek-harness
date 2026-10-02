/** Product scheduling and administrative review derive the reviewer from an installed report step. */
import { afterEach, expect, it, vi } from 'vitest'
import { simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { ownerFixture } from './company-owner-fixture.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { call } from './fixtures.ts'
import { simulationProductManageInputSchema } from '../src/control-schema.ts'
import { simulationProductTaskReviewResolveInputSchema } from '../src/review-schema.ts'

afterEach(() => vi.restoreAllMocks())
const config = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1', steps: [
  { id: 'buyer-report', sourceEntityId: 'supplier', entityId: 'buyer', recipientEntityId: 'supplier', channelKey: 'purchase',
    reviewerEntityId: 'supplier', subject: 'Buyer report', description: 'Deliver authorized report', text: 'Private forecast report',
    cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 2, retry: 'before-effects' },
] } })
it.each(['json', 'sqlite'] as const)('uses trusted supplier review, keeps paused intent and original retries (%s)', async (backend) => {
  const h = await ownerFixture(backend, {}, config)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const template = (await service.catalog(call())).items[0]!
    expect(template).toMatchObject({ kind: 'task-workflow', review: 'participant', execution: 'automatic-tasks' })
    await service.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'start', phase: 'running' }), call())
    const item = await vi.waitFor(async () => {
      const page = await service.listTaskReviews({ runId }, call())
      const found = page.items.find(value => value.action.allowed)
      if (found === undefined) throw new Error('Waiting for persisted report review')
      return found
    }, { timeout: 5000, interval: 10 })
    expect(item.reviewerEntityId).toBe('supplier')
    expect(item.evidence?.inventoryTransfer).toBeUndefined()
    expect(JSON.stringify(item)).not.toContain('Private forecast report')
    await service.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'pause', phase: 'paused' }), call())
    const request = simulationProductTaskReviewResolveInputSchema.parse({ runId, commandId: 'approve', operationId: item.operationId,
      attemptId: item.attemptId, expectedRevision: item.taskRevision, nextPhase: 'completed', reason: 'Approved forecast' })
    await service.resolveTaskReview(request, call())
    expect((await h.finished(request.commandId)).status).toBe('completed')
    expect(h.owned().snapshot().phase).toBe('paused'); expect(h.requests).toHaveLength(0)
    const first = await service.request({ commandId: request.commandId }, call())
    expect(await service.resolveTaskReview(request, call())).toEqual(first.status === 'found' ? first.request : undefined)
    expect(Object.values(h.owned().snapshot().taskExecutions!)).toHaveLength(1)
    await h.fiber.dispose(); const next = h.mount(); await next
    expect(await h.ctx.simulationAdministration.request({ commandId: request.commandId }, call())).toEqual(first)
    const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), attach = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear()
    const cold = await h.ctx.simulationAdministration.listTaskReviews({ runId }, call())
    expect(cold.items[0]?.action.reason).toBe('recovery-required')
    expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled()
  } finally { await h.close() }
})
