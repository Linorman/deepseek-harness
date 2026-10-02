/** Canonical rework starts distinct report work; old attempts cannot settle a newer review or exceed its attempt bound. */
import { afterEach, expect, it, vi } from 'vitest'
import { ownerFixture } from './company-owner-fixture.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { call } from './fixtures.ts'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'

afterEach(() => { vi.restoreAllMocks() })
const driver = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1',
  topology: { actors: [{ id: 'auditor', name: 'Independent auditor' }], channels: [{ key: 'audit', members: [
    { entityId: 'buyer', role: 'author' }, { entityId: 'auditor', role: 'receiver' },
  ] }] }, steps: [{ id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'auditor', channelKey: 'audit',
    reviewerEntityId: 'auditor', subject: 'Review report', description: 'Publish the installed report', text: 'Report',
    cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 2, retry: 'before-effects' }] } })

it.each(['json', 'sqlite'] as const)('keeps old review/results separate from newer rework and blocks exhausted attempts (%s)', async (backend) => {
  const h = await ownerFixture(backend, {}, driver, { maxTokensPerInterval: 0 })
  let connection: SimulationTeamConnection | undefined
  const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
  vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementation(async (...args) => {
    connection = await attach(...args); return connection
  })
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const pending = async () => await vi.waitFor(async () => {
      const item = (await service.listTaskReviews({ runId }, call())).items.find(value => value.action.allowed)
      if (item === undefined) throw new Error('Report review is not ready')
      return item
    }, { timeout: 5000, interval: 5 })
    await service.manage({ runId, managementId: 'start-rework-fencing' as never, phase: 'running' }, call())
    const first = await pending(), firstExecution = h.owned().snapshot().taskExecutions?.[first.attemptId]
    if (firstExecution?.result === undefined || connection === undefined) throw new Error('First report has no genuine result')
    const original = { runId, commandId: 'original-rework' as never, operationId: first.operationId,
      attemptId: first.attemptId, expectedRevision: first.taskRevision, nextPhase: 'pending' as const, reason: 'Add the audit batch' }
    await service.resolveTaskReview(original, call()); expect((await h.finished(original.commandId)).status).toBe('completed')
    const second = await pending()
    expect(second.attemptId).not.toBe(first.attemptId); expect(second.attemptCount).toBe(2)
    await service.manage({ runId, managementId: 'pause-newer-review' as never, phase: 'paused' }, call())
    await vi.waitFor(async () => {
      expect((await service.control({ runId }, call())).inFlight).toBe(false)
      expect(h.owned().snapshot().taskExecutions?.[second.attemptId]?.task?.phase).toBe('review')
    })
    const before = h.owned().snapshot()
    const task = await h.ctx.teams.getTask({ teamId: second.teamId, taskId: second.taskId })
    expect(task.reviewHistory).toHaveLength(1)
    expect(task.reviewHistory[0]?.attemptId).toBe(first.attemptId)
    const reports = Object.values(before.operations).filter(value => value.action.kind === 'communication/post')
    expect(reports).toHaveLength(2)
    expect(reports.some(value => value.action.kind === 'communication/post' && value.action.text.includes(original.reason))).toBe(true)
    expect(Object.values(before.taskExecutions ?? {}).some(value => value.request.reportContinuation !== undefined)).toBe(false)
    expect(await service.resolveTaskReview(original, call())).toMatchObject({ commandId: original.commandId, status: 'completed' })
    await expect(connection.completeTask({ attemptId: first.attemptId, policy: firstExecution.result.request.policy })).rejects.toThrow()
    await expect(h.owned().recordTaskResult({ ...firstExecution.result.request,
      outcome: { kind: 'failed', failure: { code: 'LATE', message: 'Late overwritten result' } } }, before.revision)).rejects.toThrow()
    expect(h.owned().snapshot().taskExecutions?.[second.attemptId]).toEqual(before.taskExecutions?.[second.attemptId])
    expect((await h.ctx.teams.getTask({ teamId: second.teamId, taskId: second.taskId })).reviewHistory).toHaveLength(1)
    const exhausted = { runId, commandId: 'exhausted-rework' as never, operationId: second.operationId,
      attemptId: second.attemptId, expectedRevision: second.taskRevision, nextPhase: 'pending' as const, reason: 'No remaining attempts' }
    await service.resolveTaskReview(exhausted, call())
    expect(await h.finished(exhausted.commandId)).toMatchObject({ status: 'failed', failure: 'review-failed' })
    const final = await h.ctx.teams.getTask({ teamId: second.teamId, taskId: second.taskId })
    expect(final.phase).toBe('review'); expect(final.attemptCount).toBe(final.maxAttempts)
    expect(Object.values(h.owned().snapshot().taskExecutions ?? {})).toHaveLength(2)
    expect(Object.values(h.owned().snapshot().operations).filter(value => value.action.kind === 'communication/post')).toHaveLength(2)
    expect(h.owned().snapshot().resources['stock' as never]?.quantity).toBe('2')
    expect(h.requests).toEqual([])
    const approval = { ...exhausted, commandId: 'approve-final-bounded-attempt' as never, nextPhase: 'completed' as const,
      reason: 'Approve the final existing report without another attempt' }
    await service.resolveTaskReview(approval, call()); expect((await h.finished(approval.commandId)).status).toBe('completed')
    expect((await h.ctx.teams.getTask({ teamId: second.teamId, taskId: second.taskId })).phase).toBe('completed')
  } finally { await h.close() }
}, 15000)
