/** Reviewed procurement uses production task decisions, delivery receipts and scoped review; inventory is transferred once. */
import { expect, it } from 'vitest'
import { SimulationCompanyDriver, simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { registerCompanyTaskPolicies } from '../src/company-task-policies.ts'
import { companyReviewSummary } from '../src/company-review.ts'
import { companyFixture, companyConfig, companySettings } from './company-driver-fixture.ts'

it.each(['json', 'sqlite'] as const)('executes a bounded reviewed task and reworks its report without another inventory transfer (%s)', async (backend) => {
  const h = await companyFixture(backend)
  const remove = registerCompanyTaskPolicies(h.ctx.simulationTeams)
  const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, simulationCompanyDriverSchema.parse({
    ...companyConfig, tasks: { version: '1', cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 2, retry: 'scene', review: 'buyer' },
  }), h.lifetime.signal, { readTask: h.ctx.teams.getTask.bind(h.ctx.teams) })
  const until = async (reason: string) => {
    for (let round = 0; round < 60; round++) {
      const result = await driver.advance()
      if (result.reason === reason) return
      expect(['work-limit', 'decision-required', 'recipient-required', 'retry']).toContain(result.reason)
    }
    throw new Error(`Company did not reach ${reason}`)
  }
  try {
    await h.start()
    await until('review-required')
    const first = Object.values(h.run.snapshot().taskExecutions!)[0]!
    expect(first.decisions).toHaveLength(2)
    expect(first.request.interaction).toBeUndefined()
    expect(first.task?.phase).toBe('review')
    const beforeReview = h.requests.length
    expect((await driver.advance()).reason).toBe('review-required')
    expect(h.requests).toHaveLength(beforeReview)
    const firstTask = await h.ctx.teams.getTask({ teamId: first.request.teamId, taskId: first.request.taskId })
    const reviewState = h.run.snapshot()
    expect(companyReviewSummary(reviewState, first, firstTask).action).toEqual({ allowed: true, reason: 'ready' })
    expect(() => companyReviewSummary(reviewState, first, { ...firstTask,
      execution: { kind: 'agent' } } as never)).toThrow('canonical task source')
    expect(companyReviewSummary({ ...reviewState, interactions: {} }, first, firstTask).action.reason).toBe('review-unavailable')
    expect(companyReviewSummary({ ...reviewState, taskExecutions: {} }, first, firstTask).action.reason).toBe('review-unavailable')
    const reportless = { ...first, result: { ...first.result!, request: { ...first.result!.request,
      operations: [undefined] as never } } }
    expect(companyReviewSummary(reviewState, reportless, firstTask).action.reason).toBe('review-unavailable')
    const noDecision = { ...first }
    delete noDecision.decisions
    expect(companyReviewSummary(reviewState, noDecision, firstTask).action.reason).toBe('review-unavailable')
    const original = { commandId: 'rework-report', attemptId: first.request.attemptId, reviewerEntityId: 'buyer' as never,
      expectedRevision: firstTask.revision, nextPhase: 'pending' as const, reason: '请补充报告批次编号' }
    await h.connection.reviewTask(original)
    await until('review-required')
    const executions = Object.values(h.run.snapshot().taskExecutions!)
    expect(executions).toHaveLength(2)
    const second = executions.find(value => value.request.ordinal === 2)!
    expect(second.decisions).toHaveLength(1)
    expect(first.result).toEqual(h.run.snapshot().taskExecutions![first.request.attemptId]?.result)
    const secondDecision = h.run.snapshot().decisions[second.decisions![0]!.request.decisionId]!
    expect(JSON.stringify(secondDecision.context)).toContain(original.reason)
    await h.connection.reviewTask(original)
    const current = await h.ctx.teams.getTask({ teamId: first.request.teamId, taskId: first.request.taskId })
    expect(current.phase).toBe('review')
    expect(current.reviewHistory).toHaveLength(1)
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const inferenceCount = h.requests.length
    await h.connection.reviewTask({ commandId: 'approve-report', attemptId: second.request.attemptId,
      reviewerEntityId: 'buyer' as never, expectedRevision: current.revision, nextPhase: 'completed', reason: '报告已核对' })
    expect(h.run.snapshot().phase).toBe('paused')
    expect(h.requests).toHaveLength(inferenceCount)
    await h.run.setPhase('running', h.run.snapshot().revision)
    await until('completed')
    expect(h.run.snapshot().resources['received' as never]?.quantity).toBe('1')
    expect(h.run.snapshot().resources['stock' as never]?.quantity).toBe('1')
    expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'resource/transfer')).toHaveLength(1)
    expect(h.requests.every(value => value.tools.join(',') === 'simulation_observe,simulation_stage,simulation_submit')).toBe(true)
  } finally { await driver.drain(); remove(); await h.close() }
})

it('uses the recorded model route for a reviewed transfer and its report', async () => {
  const h = await companyFixture()
  const remove = registerCompanyTaskPolicies(h.ctx.simulationTeams)
  const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, simulationCompanyDriverSchema.parse({
    ...companyConfig, tasks: { version: '1', cognition: 'model', leaseDurationMs: 60000, maxAttempts: 2, retry: 'scene', review: 'buyer' },
  }), h.lifetime.signal, { readTask: h.ctx.teams.getTask.bind(h.ctx.teams) })
  try {
    await h.start()
    let reason = ''
    for (let round = 0; round < 60; round++) {
      reason = (await driver.advance()).reason
      if (reason === 'review-required') break
      expect(['work-limit', 'decision-required', 'recipient-required', 'retry']).toContain(reason)
    }
    expect(reason).toBe('review-required')
    const execution = Object.values(h.run.snapshot().taskExecutions ?? {})[0]
    if (execution === undefined) throw new Error('Model-reviewed task has no native attempt')
    const task = await h.ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
    expect(companyReviewSummary(h.run.snapshot(), execution, task).action).toEqual({ allowed: true, reason: 'ready' })
    expect(h.requests.map(value => value.stage)).toContain('transfer')
    expect(h.requests.map(value => value.stage)).toContain('task-report')
  } finally { await driver.drain(); remove(); await h.close() }
})
