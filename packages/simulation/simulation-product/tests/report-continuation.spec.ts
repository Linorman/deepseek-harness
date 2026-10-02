/** Retired report attempts consume their exact original effect through a new native-checked empty acknowledgement. */
import { afterEach, expect, it, vi } from 'vitest'
import { taskReportContinuationEvidence } from '@clocky/clocky-simulation'
import { ownerFixture } from './company-owner-fixture.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { call } from './fixtures.ts'
import { SimulationTaskExecutor } from '../src/task-executor.ts'

afterEach(() => { vi.restoreAllMocks() })

const driver = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1',
  topology: { actors: [{ id: 'auditor', name: 'Independent auditor' }], channels: [{ key: 'audit', members: [
    { entityId: 'buyer', role: 'author' }, { entityId: 'auditor', role: 'receiver' },
  ] }] }, steps: [{ id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'auditor', channelKey: 'audit',
    reviewerEntityId: 'auditor', subject: 'Report', description: 'Publish exactly one report', text: '原始审计报告',
    cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 3, retry: 'before-effects' }] } })

it.each(['json', 'sqlite'] as const)('continues an owned delivered report after cold retirement without a second publication (%s)', async (backend) => {
  const h = await ownerFixture(backend, {}, driver, { maxTokensPerInterval: 0 })
  const advance = Object.getOwnPropertyDescriptor(SimulationTaskExecutor.prototype, 'advance')?.value as
    SimulationTaskExecutor['advance']
  let failure: unknown
  vi.spyOn(SimulationTaskExecutor.prototype, 'advance').mockImplementation(function (this: SimulationTaskExecutor) {
    return advance.call(this).catch((cause: unknown) => { failure = cause; throw cause })
  })
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const lost = vi.spyOn(h.owned(), 'recordTaskResult').mockImplementationOnce(async () => {
      throw new Error('Interrupted after the original persisted report and before native result')
    })
    await service.manage({ runId, managementId: 'start-interrupted-report' as never, phase: 'running' }, call())
    await vi.waitFor(() => { expect(lost).toHaveBeenCalledOnce() }, { timeout: 5000 })
    const before = h.owned().snapshot()
    const report = Object.values(before.operations).find(value => value.action.kind === 'communication/post')
    if (report?.result?.status !== 'applied' || report.delivery?.receipt === undefined) throw new Error('Original report was not persisted')
    const resources = before.resources
    lost.mockRestore()
    failure = undefined
    const cut = { runId, commandId: 'interrupted-report-cut' as never }
    await service.checkpoint(cut, call()); expect((await h.finished(cut.commandId)).status).toBe('completed')
    await h.fiber.dispose(); await h.mount()
    const current = h.ctx.simulationAdministration
    const restore = { runId, commandId: 'restore-report' as never, checkpointId: `product-checkpoint/${cut.commandId}` as never }
    await current.restore(restore, call()); expect((await h.finished(restore.commandId)).status).toBe('completed')
    const reserve = h.owned().reserveTaskExecution.bind(h.owned())
    const selected = vi.spyOn(h.owned(), 'reserveTaskExecution').mockImplementation(async (request, revision) => {
      if (request.reportContinuation !== undefined) {
        const proof = request.reportContinuation, state = h.owned().snapshot()
        const source = state.taskExecutions?.[proof.attemptId]
        const report = state.operations[proof.operationId]
        const decision = report === undefined ? undefined : state.decisions[report.decisionId]
        expect(source?.retired).toBeDefined()
        expect(source?.request.sessionId).toBe(request.sessionId)
        expect(source?.request.ordinal).toBeLessThan(request.ordinal)
        expect(BigInt(source?.request.epoch ?? '0')).toBeLessThan(BigInt(request.epoch))
        expect(decision?.context?.status === 'prepared' ? decision.context.fingerprint : undefined).toBe(proof.contextFingerprint)
        const proposals = decision?.deterministic?.proposals ?? decision?.submission
        expect(JSON.stringify(proposals?.[0]?.action)).toBe(JSON.stringify(report?.action))
        expect(taskReportContinuationEvidence(state, request)?.id).toBe(proof.operationId)
        const start = h.owned().snapshot().revision
        for (const changed of [{ ...request.reportContinuation, attemptId: 'foreign' as never },
          { ...request.reportContinuation, operationId: request.operationId },
          { ...request.reportContinuation, contextFingerprint: 'changed' }]) {
          await expect(reserve({ ...request, reportContinuation: changed }, revision)).rejects.toThrow()
          expect(h.owned().snapshot().revision).toBe(start)
        }
        for (const changed of [{ ...request, runId: 'foreign' as never }, { ...request, taskId: 'foreign' as never },
          { ...request, sessionId: 'foreign' as never }, { ...request, participantId: 'foreign' as never },
          { ...request, entityId: 'supplier' as never }, { ...request, epoch: source!.request.epoch },
          { ...request, ordinal: source!.request.ordinal }]) {
          expect(taskReportContinuationEvidence(state, changed)).toBeUndefined()
          await expect(reserve(changed, revision)).rejects.toThrow()
          expect(h.owned().snapshot().revision).toBe(start)
        }
        await expect(reserve({ ...request, reportContinuation: undefined }, revision)).rejects.toThrow('source-backed continuation')
      }
      return await reserve(request, revision)
    })
    await current.manage({ runId, managementId: 'continue-report' as never, phase: 'running' }, call())
    const review = await vi.waitFor(async () => {
      const item = (await current.listTaskReviews({ runId }, call())).items.find(value => value.action.allowed)
      expect(failure).toBeUndefined()
      if (item === undefined) throw new Error('Continued report is not ready for review')
      return item
    }, { timeout: 5000, interval: 5 })
    const after = h.owned().snapshot(), executions = Object.values(after.taskExecutions ?? {})
    const continued = executions.find(value => value.request.reportContinuation !== undefined)
    if (continued === undefined) throw new Error('No source-backed report continuation was reserved')
    expect(continued.request.reportContinuation?.operationId).toBe(report.id)
    expect(continued.request.interaction).toBeUndefined()
    expect(continued.result?.request.operations).toEqual([report.id])
    expect(continued.decisions).toHaveLength(1)
    const association = continued.decisions?.[0]
    if (association === undefined) throw new Error('Continuation has no recorded acknowledgement')
    const acknowledgement = after.decisions[association.request.decisionId]
    expect(acknowledgement).toMatchObject({ status: 'accepted', operationIds: [] })
    expect(JSON.stringify(acknowledgement?.context)).toContain('reportContinuation')
    expect(taskReportContinuationEvidence(after, continued.request)?.id).toBe(report.id)
    const { delivery: _delivery, ...withoutDelivery } = report
    const { outbox: _outbox, ...withoutOutbox } = report
    for (const changed of [
      withoutDelivery, withoutOutbox,
      { ...report, delivery: { ...report.delivery, sessionId: 'foreign' as never } },
      { ...report, action: { ...report.action, recipient: 'supplier' as never } },
    ]) expect(taskReportContinuationEvidence({ ...after, operations: { ...after.operations, [report.id]: changed } },
      continued.request)).toBeUndefined()
    expect(Object.values(after.operations).filter(value => value.action.kind === 'communication/post')).toHaveLength(1)
    expect(after.resources).toEqual(resources); expect(h.requests).toEqual([])
    expect(selected).toHaveBeenCalled(); expect(executions[0]?.retired).toBeDefined()
    const approve = { runId, commandId: 'approve-continued-report' as never, operationId: review.operationId,
      attemptId: review.attemptId, expectedRevision: review.taskRevision, nextPhase: 'completed' as const, reason: 'Verified original receipt' }
    await current.resolveTaskReview(approve, call()); expect((await h.finished(approve.commandId)).status).toBe('completed')
    await vi.waitFor(async () => { expect((await current.control({ runId }, call())).stop).toBe('completed') }, { timeout: 5000 })
    expect(Object.values(h.owned().snapshot().operations).filter(value => value.action.kind === 'communication/post')).toHaveLength(1)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
}, 15000)
