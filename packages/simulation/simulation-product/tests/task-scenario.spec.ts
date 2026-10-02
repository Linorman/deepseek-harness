/** Trusted workflow reports use real actors, canonical attempts and persisted recipient receipts. */
import { expect, it } from 'vitest'
import { SimulationCompanyDriver, simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { registerTaskScenarioPolicies } from '../src/task-scenario-policies.ts'
import { scenarioReviewSummary } from '../src/scenario-review.ts'
import { companyFixture, companyConfig, companySettings } from './company-driver-fixture.ts'

const config = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1', steps: [
  { id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'supplier', channelKey: 'purchase',
    reviewerEntityId: 'supplier', subject: 'Publish buyer report', description: 'Publish the supplied buyer report',
    text: 'Buyer report: approved forecast', cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 2, retry: 'before-effects' },
  { id: 'response', sourceEntityId: 'buyer', entityId: 'supplier', recipientEntityId: 'buyer', channelKey: 'purchase',
    subject: 'Publish supplier response', description: 'Publish the supplied supplier response', text: 'Supplier response: forecast received',
    cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 1, retry: 'never' },
] } })

it.each(['json', 'sqlite'] as const)('routes sequential report tasks and supplier review without purchasing inventory (%s)', async (backend) => {
  const h = await companyFixture(backend), remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, config, h.lifetime.signal,
    { readTask: h.ctx.teams.getTask.bind(h.ctx.teams) })
  const until = async (reason: string) => {
    for (let round = 0; round < 80; round++) {
      const result = await driver.advance()
      if (result.reason === reason) return
      expect(['work-limit', 'decision-required', 'recipient-required', 'retry']).toContain(result.reason)
    }
    throw new Error(`Workflow did not reach ${reason}`)
  }
  try {
    await h.start(); await until('review-required')
    const first = Object.values(h.run.snapshot().taskExecutions!)[0]!
    const task = await h.ctx.teams.getTask({ teamId: first.request.teamId, taskId: first.request.taskId })
    const summary = scenarioReviewSummary(h.run.snapshot(), first, task, config)
    expect(summary.action).toEqual({ allowed: true, reason: 'ready' })
    expect(summary.reviewerEntityId).toBe('supplier'); expect(summary.evidence?.inventoryTransfer).toBeUndefined()
    expect(first.decisions).toHaveLength(1); expect(h.requests).toHaveLength(0)
    await expect(h.connection.reviewTask({ commandId: 'wrong-reviewer', attemptId: first.request.attemptId,
      reviewerEntityId: 'buyer' as never, expectedRevision: task.revision, nextPhase: 'completed', reason: 'Wrong role' })).rejects.toThrow()
    await h.connection.reviewTask({ commandId: 'rework', attemptId: first.request.attemptId,
      reviewerEntityId: 'supplier' as never, expectedRevision: task.revision, nextPhase: 'pending', reason: 'Add forecast period' })
    await until('review-required')
    const second = Object.values(h.run.snapshot().taskExecutions!).find(value => value.request.ordinal === 2)!
    const revised = await h.ctx.teams.getTask({ teamId: second.request.teamId, taskId: second.request.taskId })
    expect(JSON.stringify(h.run.snapshot().decisions[second.decisions![0]!.request.decisionId]?.context)).toContain('Add forecast period')
    await h.connection.reviewTask({ commandId: 'approve', attemptId: second.request.attemptId,
      reviewerEntityId: 'supplier' as never, expectedRevision: revised.revision, nextPhase: 'completed', reason: 'Checked' })
    await until('completed')
    expect(Object.values(h.run.snapshot().taskExecutions!)).toHaveLength(3)
    expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'task/create')).toHaveLength(2)
    expect(Object.values(h.run.snapshot().operations).some(value => value.action.kind === 'resource/transfer')).toBe(false)
    expect(h.run.snapshot().resources['stock' as never]?.quantity).toBe('2')
    expect(h.requests).toHaveLength(0)
  } finally { await driver.drain(); remove(); await h.close() }
})

it('rejects ambiguous generic execution routes while allowing multiple exact tasks from one source', async () => {
  const { simulationTaskExecutorSchema } = await import('../src/task-executor.ts')
  const base = { version: '1', maxControlSteps: 1, leaseDurationMs: 60000,
    routes: [{ sourceEntityId: 'buyer', entityId: 'supplier', operationId: 'first', completion: { id: 'report', version: '1' }, reason: 'First report' },
      { sourceEntityId: 'buyer', entityId: 'buyer', operationId: 'second', completion: { id: 'report', version: '1' }, reason: 'Second report' }] }
  expect(simulationTaskExecutorSchema.safeParse(base).success).toBe(true)
  expect(simulationTaskExecutorSchema.safeParse({ ...base, routes: [base.routes[0], base.routes[0]] }).success).toBe(false)
  expect(simulationTaskExecutorSchema.safeParse({ ...base,
    routes: [base.routes[0], { ...base.routes[1], operationId: undefined }] }).success).toBe(false)
})

it('refuses model workflows and executable scene fields before they can produce world effects', () => {
  const scenario = config.scenario!
  expect(simulationCompanyDriverSchema.safeParse({ ...config, scenario: { ...scenario,
    steps: [{ ...scenario.steps[0], cognition: 'model' }] } }).success).toBe(false)
  expect(simulationCompanyDriverSchema.safeParse({ ...config, scenario: { ...scenario,
    steps: [{ ...scenario.steps[0], tools: ['shell'] }] } }).success).toBe(false)
})

it('rejects an unprepared workflow actor or channel and insufficient delivery capacity at template load', async () => {
  const { simulationCompanyTemplateSchema } = await import('../src/creation-schema.ts')
  const h = await companyFixture('json', false)
  try {
    const { runId: _runId, ...spec } = h.selection.spec
    const template = { id: 'report', version: '1', name: 'Report', provider: 'local', spec,
      preset: 'simulation', objective: 'Publish report', driver: config, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } }
    const step = config.scenario!.steps[0]!
    expect(simulationCompanyTemplateSchema.safeParse(template).success).toBe(true)
    for (const changed of [{ ...step, entityId: 'unprepared' }, { ...step, channelKey: 'unprepared' }]) {
      expect(simulationCompanyTemplateSchema.safeParse({ ...template, driver: { ...config,
        scenario: { ...config.scenario, steps: [changed] } } }).success).toBe(false)
    }
    expect(simulationCompanyTemplateSchema.safeParse({ ...template, spec: { ...spec, maxResidentActors: 1 } }).success).toBe(false)
    expect(Object.values(h.run.snapshot().operations)).toHaveLength(0)
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})
