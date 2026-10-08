/** Trusted workflow reports use real actors, canonical attempts and persisted recipient receipts. */
import { expect, it, vi } from 'vitest'
import { SimulationCompanyDriver, simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { registerTaskScenarioPolicies, taskScenarioInput, taskScenarioReport, taskScenarioReportContinuation } from '../src/task-scenario-policies.ts'
import { scenarioHasReview, scenarioReviewSummary, scenarioTaskStep } from '../src/scenario-review.ts'
import { companyFixture, companyConfig, companySettings } from './company-driver-fixture.ts'
import type { SimulationDeterministicPolicy, SimulationTaskCompletionPolicy } from '@clocky/clocky-simulation'

const config = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1', steps: [
  { id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'supplier', channelKey: 'purchase',
    reviewerEntityId: 'supplier', subject: 'Publish buyer report', description: 'Publish the supplied buyer report',
    text: 'Buyer report: approved forecast', cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 2, retry: 'before-effects' },
  { id: 'response', sourceEntityId: 'buyer', entityId: 'supplier', recipientEntityId: 'buyer', channelKey: 'purchase',
    subject: 'Publish supplier response', description: 'Publish the supplied supplier response', text: 'Supplier response: forecast received',
    cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 1, retry: 'never' },
] } })

it.each(['json', 'sqlite'] as const)('routes sequential report tasks and supplier review without purchasing inventory (%s)', async (backend) => {
  const h = await companyFixture(backend)
  let cognition: SimulationDeterministicPolicy | undefined, completion: SimulationTaskCompletionPolicy | undefined
  const remove = registerTaskScenarioPolicies({
    registerDeterministicPolicy(policy) {
      cognition = policy
      return h.ctx.simulationTeams.registerDeterministicPolicy(policy)
    },
    registerTaskCompletionPolicy(policy) {
      completion = policy
      return h.ctx.simulationTeams.registerTaskCompletionPolicy(policy)
    },
  })
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
    const reported = h.run.snapshot()
    const selectedCognition = cognition, selectedCompletion = completion
    if (selectedCompletion === undefined || selectedCognition === undefined) throw new Error('Workflow policies were not registered')
    const association = first.decisions?.[0]
    if (association === undefined) throw new Error('Workflow report has no decision association')
    const context = association === undefined ? undefined : reported.decisions[association.request.decisionId]?.context
    if (context?.status !== 'prepared') throw new Error('Workflow has no recorded authorized input')
    expect(selectedCognition.decide(context.view)).toHaveLength(1)
    expect(() => selectedCognition.decide({ ...context.view,
      content: context.view.content.filter(section => section.kind !== 'input'),
    })).toThrow('no recorded authorized input')
    const withInput = (input: string) => ({ ...context.view, content: context.view.content.map(section => section.kind !== 'input'
      ? section : { ...section, blocks: section.blocks.map(block => block.type !== 'text' || !block.text.startsWith('Authorized task workflow: ')
        ? block : { ...block, text: input }) }) })
    expect(selectedCognition.decide(withInput(taskScenarioInput(null)))).toEqual([])
    expect(() => selectedCognition.decide(withInput(taskScenarioInput({ after: [],
      action: { kind: 'interaction/accept', id: 'foreign' as never, expectedRevision: 1 },
    })))).toThrow('unsupported effect')
    const report = taskScenarioReport(reported, first)
    expect(report?.action.kind).toBe('communication/post')
    expect(selectedCompletion.evaluate(reported, first)).toMatchObject({ status: 'result', operations: [report?.id],
      outcome: { kind: 'completed' } })
    expect(taskScenarioReportContinuation(reported, first)).toBeUndefined()
    if (report === undefined) throw new Error('Workflow did not persist its authorized report')
    if (report.action.kind !== 'communication/post') throw new Error('Workflow report has the wrong effect')
    const withoutReport = { ...reported, operations: { ...reported.operations, [report.id]: {
      ...report, delivery: undefined,
    } } }
    expect(taskScenarioReport(withoutReport, first)).toBeUndefined()
    expect(selectedCompletion.evaluate(withoutReport, first)).toMatchObject({ status: 'waiting' })
    const rejected = { ...reported, operations: { ...reported.operations, [report.id]: { ...report,
      result: { ...report.result!, status: 'rejected' as const },
    } } }
    expect(selectedCompletion.evaluate(rejected, first)).toMatchObject({ status: 'result', outcome: { kind: 'failed' } })
    const reportRecipient = report.action.recipient
    const entities = Object.fromEntries(Object.entries(reported.entities).filter(([id]) => id !== reportRecipient))
    expect(taskScenarioReport({ ...reported, entities }, first)).toBeUndefined()
    expect(taskScenarioReport(reported, { ...first, decisions: [] })).toBeUndefined()
    expect(taskScenarioReport(reported, { ...first, decisions: [...first.decisions!, ...first.decisions!] })).toBeUndefined()
    const withoutDecisions = { ...first }
    delete withoutDecisions.decisions
    expect(selectedCompletion.evaluate(reported, withoutDecisions)).toMatchObject({ status: 'waiting' })
    const decision = reported.decisions[association.request.decisionId]!
    for (const changed of [{ ...decision, status: 'open' as const }, { ...decision, operationIds: [] },
      { ...decision, context: undefined }]) {
      expect(taskScenarioReport({ ...reported, decisions: { ...reported.decisions, [decision.id]: changed } }, first)).toBeUndefined()
    }
    const missingDecision = { ...association, request: { ...association.request, decisionId: 'missing-report-decision' as never } }
    expect(taskScenarioReport(reported, { ...first, decisions: [missingDecision] })).toBeUndefined()
    expect(selectedCompletion.evaluate(reported, { ...first, decisions: [missingDecision] })).toMatchObject({ status: 'waiting' })
    expect(taskScenarioReport({ ...reported, decisions: { ...reported.decisions,
      [decision.id]: { ...decision, context: { ...context, view: withInput(taskScenarioInput(null)) } },
    } }, first)).toBeUndefined()
    const missingOperation = { ...decision, operationIds: ['missing-report-operation' as never] }
    const missingEffect = { ...reported, decisions: { ...reported.decisions, [decision.id]: missingOperation } }
    expect(selectedCompletion.evaluate(missingEffect, first)).toMatchObject({ status: 'result', outcome: { kind: 'failed' } })
    const task = await h.ctx.teams.getTask({ teamId: first.request.teamId, taskId: first.request.taskId })
    const summary = scenarioReviewSummary(h.run.snapshot(), first, task, config)
    expect(summary.action).toEqual({ allowed: true, reason: 'ready' })
    expect(scenarioReviewSummary(h.run.snapshot(), first, task, companyConfig).action.reason).toBe('target-changed')
    const withoutPolicy = { ...first }
    delete withoutPolicy.completionPolicy
    expect(scenarioReviewSummary(h.run.snapshot(), withoutPolicy, task, config).action.reason)
      .toBe('review-unavailable')
    if (first.result === undefined) throw new Error('Reviewed workflow has no native result')
    for (const operations of [[], ['unrelated' as never]]) {
      const changed = { ...first, result: { ...first.result,
        request: { ...first.result.request, operations } } }
      expect(scenarioReviewSummary(h.run.snapshot(), changed, task, config).action.reason).toBe('review-unavailable')
    }
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
    const response = Object.values(h.run.snapshot().taskExecutions!).find(value => value.request.operationId !== first.request.operationId)!
    const responseTask = await h.ctx.teams.getTask({ teamId: response.request.teamId, taskId: response.request.taskId })
    expect(scenarioReviewSummary(h.run.snapshot(), response, responseTask, config).action.reason).toBe('review-disabled')
    expect(Object.values(h.run.snapshot().operations).some(value => value.action.kind === 'resource/transfer')).toBe(false)
    expect(h.run.snapshot().resources['stock' as never]?.quantity).toBe('2')
    expect(h.requests).toHaveLength(0)
  } finally { await driver.drain(); remove(); await h.close() }
})

it('releases cognition when completion registration fails', () => {
  const remove = vi.fn()
  expect(() => registerTaskScenarioPolicies({
    registerDeterministicPolicy: () => remove,
    registerTaskCompletionPolicy: () => { throw new Error('completion registry closed') },
  })).toThrow('completion registry closed')
  expect(remove).toHaveBeenCalledOnce()
})

it('accepts only the installed accepted task creation route for administrative review', () => {
  const step = config.scenario!.steps[0]!
  const operationId = 'created-task' as never
  const decisionId = 'task-workflow/1/0/create/decision' as never
  const operation = { id: operationId, entityId: step.sourceEntityId, decisionId, action: { kind: 'task/create' } }
  const accepted = { id: decisionId, status: 'accepted', operationIds: [operationId] }
  const state = { operations: { [operationId]: operation }, decisions: { [decisionId]: accepted } }
  expect(scenarioHasReview(companyConfig)).toBe(false)
  expect(scenarioHasReview(config)).toBe(true)
  expect(scenarioTaskStep(state as never, operationId, config)).toEqual(step)
  expect(scenarioTaskStep({ ...state, decisions: { [decisionId]: { ...accepted, status: 'open' } } } as never,
    operationId, config)).toBeUndefined()
  expect(scenarioTaskStep({ ...state, operations: { [operationId]: { ...operation,
    entityId: 'supplier' } } } as never, operationId, config)).toBeUndefined()
  expect(scenarioTaskStep({ ...state, decisions: { [decisionId]: { ...accepted,
    operationIds: [operationId, 'other'] } } } as never, operationId, config)).toBeUndefined()
  expect(scenarioTaskStep(state as never, 'other' as never, config)).toBeUndefined()
  expect(() => scenarioReviewSummary(state as never, { request: { operationId, entityId: 'supplier' } } as never,
    {} as never, config)).toThrow('no immutable execution route')
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
