/** A completed deterministic workflow still consumes authorized future inputs without repeating its report task. */
import { afterEach, expect, it, vi } from 'vitest'
import { simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { simulationProductIngressInputSchema } from '../src/maintenance-schema.ts'
import { ownerFixture } from './company-owner-fixture.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { call } from './fixtures.ts'

afterEach(() => { vi.restoreAllMocks() })
const availableAt = '9007199254740993'
const driver = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1',
  topology: { actors: [{ id: 'auditor', name: 'Independent auditor' }], channels: [{ key: 'audit', members: [
    { entityId: 'buyer', role: 'author' }, { entityId: 'auditor', role: 'receiver' },
  ] }] }, steps: [
    { id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'auditor', channelKey: 'audit',
      subject: 'Final audit report', description: 'Publish the installed audit report', text: 'Audit complete',
      cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 1, retry: 'never' },
  ] } })

it.each(['json', 'sqlite'] as const)('consumes a post-completion future auditor input at its exact tick after explicit resume (%s)', async (backend) => {
  const h = await ownerFixture(backend, {}, driver, { maxTime: '9007199254741000', maxTokensPerInterval: 0 })
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage({ runId, managementId: 'start-report' as never, phase: 'running' }, call())
    await vi.waitFor(async () => { expect((await service.control({ runId }, call())).stop).toBe('completed') }, { timeout: 5000 })
    await service.manage({ runId, managementId: 'pause-completed' as never, phase: 'paused' }, call())
    const before = h.owned().snapshot()
    expect(Object.values(before.taskExecutions ?? {})).toHaveLength(1)
    expect(Object.values(before.operations).filter(operation => operation.action.kind === 'communication/post')).toHaveLength(1)
    const input = simulationProductIngressInputSchema.parse({ runId, ingressId: 'future-audit', entityId: 'auditor',
      text: '延迟审计通知：保留完成报告，不重复发布。', availableAt })
    const receipt = await service.ingress(input, call())
    expect(receipt.status).toBe('pending')
    expect(await service.ingress(input, call())).toEqual(receipt)
    expect(h.owned().snapshot().phase).toBe('paused')
    expect(h.owned().snapshot().time).toBe(before.time)
    await service.manage({ runId, managementId: 'resume-future-input' as never, phase: 'running' }, call())
    const consumed = await vi.waitFor(async () => {
      const result = await service.ingressRequest({ runId, ingressId: input.ingressId }, call())
      if (result.status !== 'found' || result.receipt.status !== 'consumed') throw new Error('The original future input is not consumed')
      expect((await service.control({ runId }, call())).stop).toBe('completed')
      return result.receipt
    }, { timeout: 5000, interval: 5 })
    const after = h.owned().snapshot()
    expect(after.time).toBe(availableAt)
    expect(consumed.eventId).toBe(receipt.eventId)
    expect(consumed.decisionId).toBeDefined()
    const decision = after.decisions[consumed.decisionId!]
    expect(decision).toMatchObject({ status: 'accepted', entityId: 'auditor', ingressId: input.ingressId, operationIds: [] })
    expect(JSON.stringify(decision?.context)).toContain(input.text)
    expect(Object.values(after.decisions).filter(value => value.ingressId === input.ingressId)).toHaveLength(1)
    expect(after.operations).toEqual(before.operations)
    expect(after.taskExecutions).toEqual(before.taskExecutions)
    expect(after.resources).toEqual(before.resources)
    expect(h.requests).toHaveLength(0)
    await service.manage({ runId, managementId: 'pause-consumed' as never, phase: 'paused' }, call())
    const decisions = h.owned().snapshot().decisions
    expect(await service.ingress(input, call())).toEqual(consumed)
    expect(h.owned().snapshot().decisions).toEqual(decisions)
    expect(h.owned().snapshot().phase).toBe('paused')
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})
