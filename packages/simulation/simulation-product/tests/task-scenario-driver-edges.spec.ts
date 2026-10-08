/** Retained workflow state must be complete before the driver admits another step. */
import { expect, it, vi } from 'vitest'
import { simulationDecisionIdSchema, simulationIngressRequestSchema, simulationProposalSchema, simulationWindowIdSchema, simulationWriterEpochSchema } from '@clocky/clocky-simulation'
import { SimulationTaskScenarioDriver } from '../src/task-scenario-driver.ts'
import { simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { registerTaskScenarioPolicies } from '../src/task-scenario-policies.ts'
import { SimulationTaskExecutor } from '../src/task-executor.ts'
import { driverActivation } from '../src/driver-residency.ts'
import { taskScenarioPrefix } from '../src/task-scenario-config.ts'
import { companyConfig, companyFixture, companySettings } from './company-driver-fixture.ts'

const config = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1', steps: [
  { id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'supplier', channelKey: 'purchase',
    subject: 'Report', description: 'Report one result', text: 'One result', cognition: 'deterministic',
    leaseDurationMs: 60000, maxAttempts: 2, retry: 'before-effects' },
] } })

it('rejects an incomplete checkpoint or foreign open window before scheduling workflow work', async () => {
  const h = await companyFixture()
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    expect((await driver.advance()).reason).toBe('paused')
    await h.start()
    const retained = h.run.snapshot()
    const initial = retained.checkpoints?.[companySettings.checkpoint.id]
    if (initial?.status !== 'completed') throw new Error('Prepared workflow has no complete initial checkpoint')
    const otherVersion = { ...initial, manifest: { ...initial.manifest, implementationVersion: 'other' } }
    const otherTeam = { ...initial, manifest: { ...initial.manifest,
      team: { ...initial.manifest.team, owner: { ...initial.manifest.team.owner, teamId: 'other-team' } } } }
    const foreignWindow = simulationWindowIdSchema.parse('foreign-window')
    const cases = [
      { ...retained, checkpoints: {} },
      { ...retained, checkpoints: { ...retained.checkpoints, [companySettings.checkpoint.id]: otherVersion } },
      { ...retained, checkpoints: { ...retained.checkpoints, [companySettings.checkpoint.id]: otherTeam } },
      { ...retained, activeWindowId: foreignWindow, windows: {} },
    ]
    const read = vi.spyOn(h.run, 'snapshot')
    for (const state of cases) {
      read.mockReturnValue(state)
      expect((await driver.advance()).reason).toBe('recovery-required')
    }
    read.mockRestore()
    expect(h.run.snapshot()).toEqual(retained)
  } finally { await h.close() }
})

it('resumes an exact workflow creation window after its native open response is lost', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const open = h.connection.openWindow.bind(h.connection)
    const lost = vi.spyOn(h.connection, 'openWindow').mockImplementationOnce(async (request) => {
      await open(request)
      throw new Error('Workflow creation window response was lost')
    })
    await expect(driver.advance()).rejects.toThrow('Workflow creation window response was lost')
    expect(h.run.snapshot().activeWindowId).toBeDefined()
    lost.mockRestore()
    const resumed = await driver.advance()
    expect(resumed.reason).toBe('work-limit')
    expect(h.run.snapshot().activeWindowId).toBeUndefined()
    expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'task/create')).toHaveLength(1)
    const nextOpen = vi.spyOn(h.connection, 'openWindow').mockImplementationOnce(async (request) => {
      await open(request)
      throw new Error('Workflow follow-up window response was lost')
    })
    await expect(driver.advance()).rejects.toThrow('Workflow follow-up window response was lost')
    const active = h.run.snapshot().activeWindowId
    if (active === undefined) throw new Error('Lost follow-up window was not retained')
    nextOpen.mockRestore()
    await driver.advance()
    expect(h.run.snapshot().windows?.[active]?.status).toBe('closed')
  } finally { remove(); await h.close() }
})

it('rejects a canonical task reader that returns another task identity', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const bounded = simulationCompanyDriverSchema.parse({ ...config, maxControlSteps: 1 })
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, bounded, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    for (let round = 0; round < 4; round++) {
      if (Object.values(h.run.snapshot().operations).some(value => value.action.kind === 'task/create')) break
      await driver.advance()
    }
    const before = h.run.snapshot()
    expect(Object.values(before.operations).filter(value => value.action.kind === 'task/create')).toHaveLength(1)
    const wrongReader = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, bounded, config.scenario,
      h.lifetime.signal, async request => ({ ...await h.ctx.teams.getTask(request), id: 'another-task' as never }))
    await expect(wrongReader.advance()).rejects.toThrow('another task')
    const wrongTeam = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, bounded, config.scenario,
      h.lifetime.signal, async request => ({ ...await h.ctx.teams.getTask(request), teamId: 'another-team' as never }))
    await expect(wrongTeam.advance()).rejects.toThrow('another task')
    expect(h.run.snapshot().taskExecutions).toEqual(before.taskExecutions)
  } finally { remove(); await h.close() }
})

it('blocks a step whose accepted creation identity has no task operation', async () => {
  const h = await companyFixture()
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const source = config.scenario.steps[0]!.sourceEntityId
    await h.connection.ensureResident(source, { activation: driverActivation(h.run, source, companySettings.participant,
      config.model, h.lifetime.signal), evict: Object.keys(h.run.snapshot().entities) as typeof source[] })
    const id = simulationDecisionIdSchema.parse(`${taskScenarioPrefix(0)}${h.run.snapshot().nextDecisionSlot}`)
    await h.connection.openDecision(source, id)
    await h.connection.submitDecision(source, id, [])
    await h.run.drive({ until: h.run.snapshot().time })
    expect(h.run.snapshot().decisions[id]?.status).toBe('accepted')
    expect((await driver.advance()).reason).toBe('scenario-blocked')
    expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'task/create')).toEqual([])
  } finally { await h.close() }
})

it('blocks a spoofed creation identity that actually accepted another native effect', async () => {
  const h = await companyFixture()
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const source = config.scenario.steps[0]!.sourceEntityId
    await h.connection.ensureResident(source, { activation: driverActivation(h.run, source, companySettings.participant,
      config.model, h.lifetime.signal), evict: Object.keys(h.run.snapshot().entities) as typeof source[] })
    const id = simulationDecisionIdSchema.parse(`${taskScenarioPrefix(0)}${h.run.snapshot().nextDecisionSlot}`)
    await h.connection.openDecision(source, id)
    const resources = h.run.snapshot().resources
    const stock = resources['stock' as never], received = resources['received' as never]
    if (stock === undefined || received === undefined) throw new Error('Prepared company has no transfer resources')
    const proposal = simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', grants: [],
      transaction: { commitmentId: null, reads: [{ resourceId: 'stock', revision: stock.revision },
        { resourceId: 'received', revision: received.revision }], transfers: [{ from: 'stock', to: 'received', quantity: '1' }] } } })
    await h.connection.submitDecision(source, id, [proposal])
    await h.run.drive({ until: h.run.snapshot().time })
    const operationId = h.run.snapshot().decisions[id]?.operationIds[0]
    expect(operationId === undefined ? undefined : h.run.snapshot().operations[operationId]?.action.kind).toBe('resource/transfer')
    expect((await driver.advance()).reason).toBe('scenario-blocked')
    expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'task/create')).toEqual([])
  } finally { await h.close() }
})

it('waits for a retained task creation whose canonical outbox receipt is still pending', async () => {
  const h = await companyFixture()
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const step = config.scenario.steps[0]!, source = step.sourceEntityId
    await h.connection.ensureResident(source, { activation: driverActivation(h.run, source, companySettings.participant,
      config.model, h.lifetime.signal), evict: Object.keys(h.run.snapshot().entities) as typeof source[] })
    const id = simulationDecisionIdSchema.parse(`${taskScenarioPrefix(0)}${h.run.snapshot().nextDecisionSlot}`)
    await h.connection.openDecision(source, id)
    const proposal = simulationProposalSchema.parse({ after: [], action: { kind: 'task/create', deliverAt: h.run.snapshot().time,
      task: { subject: step.subject, description: step.description, blockedBy: [], requiredCapabilities: [],
        priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, maxAttempts: step.maxAttempts,
        reviewPolicy: { kind: 'none' } } } })
    await h.connection.submitDecision(source, id, [proposal])
    await h.run.drive({ until: h.run.snapshot().time })
    const operationId = h.run.snapshot().decisions[id]?.operationIds[0]
    if (operationId === undefined) throw new Error('Native task creation did not retain its operation')
    expect(h.run.snapshot().operations[operationId]?.outbox?.taskReceipt).toBeUndefined()
    vi.spyOn(h.connection, 'driveResident').mockResolvedValueOnce({ reason: 'until', rounds: 0, steps: 0,
      revision: h.run.snapshot().revision })
    expect((await driver.advance()).reason).toBe('work-limit')
    expect(h.run.snapshot().operations[operationId]?.outbox?.taskReceipt).toBeUndefined()
  } finally { await h.close() }
})

it('blocks a native task creation whose queued delivery is cancelled before settlement', async () => {
  const h = await companyFixture()
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const step = config.scenario.steps[0]!, source = step.sourceEntityId
    await h.connection.ensureResident(source, { activation: driverActivation(h.run, source, companySettings.participant,
      config.model, h.lifetime.signal), evict: Object.keys(h.run.snapshot().entities) as typeof source[] })
    const id = simulationDecisionIdSchema.parse(`${taskScenarioPrefix(0)}${h.run.snapshot().nextDecisionSlot}`)
    await h.connection.openDecision(source, id)
    await h.connection.submitDecision(source, id, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'task/create', deliverAt: h.run.snapshot().time, task: { subject: step.subject, description: step.description,
        blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
        budget: {}, maxAttempts: step.maxAttempts, reviewPolicy: { kind: 'none' },
      },
    } })])
    const operationId = h.run.snapshot().decisions[id]?.operationIds[0]
    if (operationId === undefined) throw new Error('Native task creation did not retain its operation')
    const ready = Object.values(h.run.snapshot().scheduledEvents).find(event => event.status === 'pending'
      && event.action.kind === 'outbox-ready' && event.action.operationId === operationId)
    if (ready === undefined) throw new Error('Task creation has no pending native outbox event')
    await h.run.cancelEvent(ready.id, 'Delivery was cancelled', h.run.snapshot().revision)
    expect(h.run.snapshot().operations[operationId]?.result?.status).toBe('rejected')
    expect((await driver.advance()).reason).toBe('scenario-blocked')
  } finally { await h.close() }
})

it('stops a completed report attempt at its real participant review', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const reviewConfig = simulationCompanyDriverSchema.parse({ ...config, scenario: { ...config.scenario,
      steps: [{ ...config.scenario.steps[0]!, reviewerEntityId: 'supplier' }] } })
    if (reviewConfig.scenario === undefined) throw new Error('Review scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, reviewConfig, reviewConfig.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    let reason: string | undefined
    for (let round = 0; round < 12; round++) {
      reason = (await driver.advance()).reason
      if (reason === 'review-required') break
    }
    expect(reason).toBe('review-required')
    const execution = Object.values(h.run.snapshot().taskExecutions ?? {})[0]
    if (execution === undefined) throw new Error('Review workflow has no task attempt')
    const task = await h.ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
    expect(task.phase).toBe('review')
    expect(h.run.snapshot().activeWindowId).toBeUndefined()
  } finally { remove(); await h.close() }
})

it('keeps future inputs ordered after the report completes and propagates a resident retry', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    let reason: string | undefined
    for (let round = 0; round < 16; round++) {
      reason = (await driver.advance()).reason
      if (reason === 'completed') break
    }
    expect(reason).toBe('completed')
    const before = h.run.snapshot()
    for (const [id, time] of [['late', '100'], ['early', '90'], ['same-time', '90'], ['middle', '95']] as const) {
      await h.run.ingest(simulationIngressRequestSchema.parse({ id, entityId: 'supplier', source: 'audit', text: id,
        availableAt: time }))
    }
    const resident = vi.spyOn(h.connection, 'driveResident')
      .mockResolvedValueOnce({ reason: 'until', rounds: 0, steps: 0, revision: h.run.snapshot().revision })
      .mockImplementationOnce(async (_request, _clock, residency) => {
        expect(residency(config.scenario!.steps[0]!.sourceEntityId).evict).toContain('supplier')
        return { reason: 'retry', rounds: 0, steps: 0, revision: h.run.snapshot().revision, nextAttemptAt: 123 }
      })
    expect(await driver.advance()).toMatchObject({ reason: 'retry', nextAttemptAt: 123 })
    expect(resident).toHaveBeenCalledTimes(2)
    expect(resident.mock.calls[1]?.[0]).toEqual({ until: '90' })
    expect(h.run.snapshot().taskExecutions).toEqual(before.taskExecutions)
  } finally { remove(); await h.close() }
})

it('preserves a delivered workflow input when its recipient has no resident capacity', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    let reason: string | undefined
    for (let round = 0; round < 16; round++) {
      reason = (await driver.advance()).reason
      if (reason === 'completed') break
    }
    expect(reason).toBe('completed')
    await h.run.ingest(simulationIngressRequestSchema.parse({ id: 'capacity-input', entityId: 'supplier',
      source: 'audit', text: 'Respond later', availableAt: h.run.snapshot().time }))
    const resident = vi.spyOn(h.connection, 'ensureResident').mockResolvedValueOnce({ status: 'capacity', entityId: 'supplier' as never })
    expect((await driver.advance()).reason).toBe('resident-capacity')
    expect(resident).toHaveBeenCalled()
    expect(Object.values(h.run.snapshot().wakes).filter(value => value.status === 'pending')).toHaveLength(1)
  } finally { remove(); await h.close() }
})

it('refuses to resume a task window under a changed executor route', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const open = h.connection.openWindow.bind(h.connection)
    const lost = vi.spyOn(h.connection, 'openWindow').mockImplementation(async (request) => {
      const value = await open(request)
      const decisionId = request.decisions[0]?.id
      if (decisionId !== undefined && String(decisionId).startsWith('task-executor/1/')) {
        throw new Error('Workflow task window response was lost')
      }
      return value
    })
    let failure: unknown
    for (let round = 0; round < 12; round++) {
      try { await driver.advance() }
      catch (error: unknown) { failure = error; break }
    }
    expect(failure).toMatchObject({ message: 'Workflow task window response was lost' })
    const active = h.run.snapshot().activeWindowId
    if (active === undefined) throw new Error('Lost task window was not retained')
    const decisionId = h.run.snapshot().windows?.[active]?.request.decisions[0]?.id
    expect(decisionId === undefined ? undefined : h.run.snapshot().taskDecisionOwners?.[decisionId]).toBeDefined()
    lost.mockRestore()
    const changed = { ...config.scenario, steps: [{ ...config.scenario.steps[0]!, entityId: 'supplier' as never }] }
    const wrong = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, changed,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    expect((await wrong.advance()).reason).toBe('recovery-required')
    expect(h.run.snapshot().activeWindowId).toBe(active)
    const blocked = vi.spyOn(SimulationTaskExecutor.prototype, 'advance').mockResolvedValueOnce({
      reason: 'task-blocked', controlSteps: 1, revision: h.run.snapshot().revision,
    })
    expect((await driver.advance()).reason).toBe('scenario-blocked')
    expect(h.run.snapshot().activeWindowId).toBe(active)
    blocked.mockRestore()
    const unavailable = vi.spyOn(SimulationTaskExecutor.prototype, 'advance').mockResolvedValueOnce({
      reason: 'recovery-required', controlSteps: 1, revision: h.run.snapshot().revision,
    })
    expect((await driver.advance()).reason).toBe('recovery-required')
    expect(h.run.snapshot().activeWindowId).toBe(active)
    unavailable.mockRestore()
    const waiting = vi.spyOn(SimulationTaskExecutor.prototype, 'advance').mockResolvedValueOnce({
      reason: 'task-waiting', controlSteps: 1, revision: h.run.snapshot().revision,
    })
    const review = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, async request => ({ ...await h.ctx.teams.getTask(request), phase: 'review' }))
    expect((await review.advance()).reason).toBe('review-required')
    expect(h.run.snapshot().activeWindowId).toBe(active)
    waiting.mockRestore()
    const waitingForEffects = vi.spyOn(SimulationTaskExecutor.prototype, 'advance').mockResolvedValueOnce({
      reason: 'task-waiting', controlSteps: 1, revision: h.run.snapshot().revision,
    })
    const bounded = simulationCompanyDriverSchema.parse({ ...config, maxControlSteps: 1 })
    const oneRound = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, bounded, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    expect((await oneRound.advance()).reason).toBe('work-limit')
    expect(h.run.snapshot().activeWindowId).toBe(active)
    waitingForEffects.mockRestore()
    await driver.advance()
    expect(h.run.snapshot().windows?.[active]?.status).toBe('closed')
  } finally { remove(); await h.close() }
})

it('maps ordinary retained task stops without repeating task creation', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const bounded = simulationCompanyDriverSchema.parse({ ...config, maxControlSteps: 1 })
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, bounded, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    for (let round = 0; round < 8; round++) {
      if (Object.values(h.run.snapshot().operations).some(value => value.action.kind === 'task/create'
        && value.outbox?.taskReceipt !== undefined)) break
      await driver.advance()
    }
    const creation = Object.values(h.run.snapshot().operations).find(value => value.action.kind === 'task/create')
    if (creation?.outbox?.taskReceipt === undefined) throw new Error('Workflow task has no retained receipt')
    expect(h.run.snapshot().activeWindowId).toBeUndefined()
    expect(Object.values(h.run.snapshot().decisions).filter(value => value.id.startsWith(taskScenarioPrefix(0))
      && value.status === 'accepted')).toHaveLength(1)
    const task = await h.ctx.teams.getTask({ teamId: creation.outbox.taskReceipt.teamId,
      taskId: creation.outbox.taskReceipt.taskId })
    const snapshot = h.run.snapshot.bind(h.run)
    // Team can finish before the native attempt completion is recorded; the driver must still inspect the task.
    vi.spyOn(h.run, 'snapshot').mockImplementation(() => {
      const current = { ...snapshot(), wakes: {} }
      delete current.taskExecutions
      return current
    })
    vi.spyOn(h.connection, 'driveResident').mockImplementation(async () => ({ reason: 'until', rounds: 0, steps: 0,
      revision: h.run.snapshot().revision }))
    const stop = vi.spyOn(SimulationTaskExecutor.prototype, 'advance')
      .mockResolvedValueOnce({ reason: 'idle', controlSteps: 1, revision: h.run.snapshot().revision })
      .mockResolvedValueOnce({ reason: 'task-waiting', controlSteps: 1, revision: h.run.snapshot().revision })
      .mockResolvedValueOnce({ reason: 'task-blocked', controlSteps: 1, revision: h.run.snapshot().revision })
      .mockResolvedValueOnce({ reason: 'task-waiting', controlSteps: 1, revision: h.run.snapshot().revision })
    expect((await driver.advance()).reason).toBe('work-limit')
    expect(stop).toHaveBeenCalledTimes(1)
    expect((await driver.advance()).reason).toBe('work-limit')
    expect((await driver.advance()).reason).toBe('scenario-blocked')
    const reviewDriver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, bounded, config.scenario,
      h.lifetime.signal, async () => ({ ...task, phase: 'review' }))
    expect((await reviewDriver.advance()).reason).toBe('review-required')
    expect(stop).toHaveBeenCalledTimes(4)
    expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'task/create')).toHaveLength(1)
  } finally { vi.restoreAllMocks(); remove(); await h.close() }
})

it.each(['capacity', 'recovery-required'] as const)(
  'stops a workflow before creating a task when creator residency reports %s', async (status) => {
    const h = await companyFixture()
    const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
    try {
      if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
      const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
        h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
      await h.start()
      const source = config.scenario.steps[0]!.sourceEntityId
      const resident = vi.spyOn(h.connection, 'ensureResident').mockResolvedValueOnce({ status, entityId: source })
      expect((await driver.advance()).reason).toBe(status === 'capacity' ? 'resident-capacity' : 'recovery-required')
      expect(resident).toHaveBeenCalled()
      expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'task/create')).toEqual([])
    } finally { remove(); await h.close() }
  },
)

it('propagates a resident retry stop without creating workflow work', async () => {
  const h = await companyFixture()
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    vi.spyOn(h.connection, 'driveResident').mockImplementationOnce(async (_request, _clock, residency) => {
      const choice = residency(config.scenario!.steps[0]!.sourceEntityId)
      expect(choice.activation.provider).toBe(companySettings.participant.provider)
      expect(choice.evict).toEqual(expect.arrayContaining(['buyer', 'supplier']))
      return { reason: 'retry', rounds: 0, steps: 0, revision: h.run.snapshot().revision, nextAttemptAt: 123 }
    })
    await expect(driver.advance()).resolves.toMatchObject({ reason: 'retry', nextAttemptAt: 123 })
    expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'task/create')).toEqual([])
  } finally { await h.close() }
})

it('stops before opening a workflow decision when management pauses after creator residency', async () => {
  const h = await companyFixture()
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    vi.spyOn(h.connection, 'driveResident').mockResolvedValueOnce({ reason: 'until', rounds: 0, steps: 0,
      revision: h.run.snapshot().revision })
    const ensure = h.connection.ensureResident.bind(h.connection)
    vi.spyOn(h.connection, 'ensureResident').mockImplementationOnce(async (...args) => {
      const resident = await ensure(...args)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      return resident
    })
    expect((await driver.advance()).reason).toBe('paused')
    expect(h.run.snapshot().activeWindowId).toBeUndefined()
    expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'task/create')).toEqual([])
  } finally { await h.close() }
})

it('cancels an open workflow decision when management pauses during cognition', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    let pausedDecision: string | undefined
    vi.spyOn(h.connection, 'executeDeterministicDecision').mockImplementationOnce(async (_entityId, id) => {
      pausedDecision = id
      await h.run.setPhase('paused', h.run.snapshot().revision)
      throw new Error('Cognition stopped after management paused')
    })
    expect((await driver.advance()).reason).toBe('paused')
    if (pausedDecision === undefined) throw new Error('Workflow decision was not attempted')
    expect(h.run.snapshot().decisions[pausedDecision as never]?.status).toBe('cancelled')
    expect(h.run.snapshot().activeWindowId).toBeUndefined()
  } finally { remove(); await h.close() }
})

it('retains a submitted workflow decision when management pauses after its lost response', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const execute = h.connection.executeDeterministicDecision.bind(h.connection)
    vi.spyOn(h.connection, 'executeDeterministicDecision').mockImplementationOnce(async (...args) => {
      await execute(...args)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      throw new Error('Submitted response was lost during pause')
    })
    expect((await driver.advance()).reason).toBe('paused')
    const active = h.run.snapshot().activeWindowId
    if (active === undefined) throw new Error('Submitted decision lost its window')
    const decisionId = h.run.snapshot().windows?.[active]?.request.decisions[0]?.id
    expect(decisionId === undefined ? undefined : h.run.snapshot().decisions[decisionId]?.status).toBe('submitted')
    await h.run.setPhase('running', h.run.snapshot().revision)
    await driver.advance()
    expect(h.run.snapshot().windows?.[active]?.status).toBe('closed')
    expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'task/create')).toHaveLength(1)
  } finally { remove(); await h.close() }
})

it('retains an open workflow window after a non-management cognition failure', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const failure = new Error('Cognition failed while the run remained active')
    const fail = vi.spyOn(h.connection, 'executeDeterministicDecision').mockRejectedValueOnce(failure)
    await expect(driver.advance()).rejects.toBe(failure)
    const active = h.run.snapshot().activeWindowId
    if (active === undefined) throw new Error('Failed decision lost its active window')
    const decisionId = h.run.snapshot().windows?.[active]?.request.decisions[0]?.id
    expect(decisionId === undefined ? undefined : h.run.snapshot().decisions[decisionId]?.status).toBe('open')
    fail.mockRestore()
    await driver.advance()
    expect(h.run.snapshot().windows?.[active]?.status).toBe('closed')
  } finally { remove(); await h.close() }
})

it('refuses to resume an open workflow decision after its writer is revoked or replaced', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const failure = new Error('Cognition interrupted before submission')
    vi.spyOn(h.connection, 'executeDeterministicDecision').mockRejectedValueOnce(failure)
    await expect(driver.advance()).rejects.toBe(failure)
    const source = config.scenario.steps[0]!.sourceEntityId
    const snapshot = h.run.snapshot.bind(h.run)
    const entity = snapshot().entities[source]
    const writer = entity?.writer
    if (writer === undefined) throw new Error('Workflow creator has no writer')
    let projectedWriter: typeof writer = { ...writer, phase: 'revoked' }
    const revoked = vi.spyOn(h.run, 'snapshot').mockImplementation(() => ({ ...snapshot(), entities: {
      ...snapshot().entities, [source]: { ...entity, writer: projectedWriter },
    } }))
    expect((await driver.advance()).reason).toBe('recovery-required')
    projectedWriter = { ...writer, epoch: simulationWriterEpochSchema.parse(String(BigInt(writer.epoch) + 1n)) }
    expect((await driver.advance()).reason).toBe('recovery-required')
    revoked.mockRestore()
    await driver.advance()
  } finally { remove(); await h.close() }
})

it('commits a cancelled workflow window without replaying its original cognition', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const failure = new Error('Cognition interrupted before submission')
    const fail = vi.spyOn(h.connection, 'executeDeterministicDecision').mockRejectedValueOnce(failure)
    await expect(driver.advance()).rejects.toBe(failure)
    const active = h.run.snapshot().activeWindowId
    if (active === undefined) throw new Error('Interrupted decision lost its window')
    const decisionId = h.run.snapshot().windows?.[active]?.request.decisions[0]?.id
    if (decisionId === undefined) throw new Error('Interrupted window lost its decision')
    await h.connection.cancelDecision(config.scenario.steps[0]!.sourceEntityId, decisionId)
    fail.mockRestore()
    const replay = vi.spyOn(h.connection, 'executeDeterministicDecision')
    await driver.advance()
    expect(replay.mock.calls.filter(([, id]) => id === decisionId)).toEqual([])
    expect(h.run.snapshot().windows?.[active]?.status).toBe('closed')
  } finally { remove(); await h.close() }
})

it('replays a retained submitted workflow decision after its execution response is lost', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const execute = h.connection.executeDeterministicDecision.bind(h.connection)
    const lost = vi.spyOn(h.connection, 'executeDeterministicDecision').mockImplementationOnce(async (...args) => {
      await execute(...args)
      throw new Error('Submitted workflow decision response was lost')
    })
    await expect(driver.advance()).rejects.toThrow('Submitted workflow decision response was lost')
    const active = h.run.snapshot().activeWindowId
    if (active === undefined) throw new Error('Submitted decision lost its active window')
    const decisionId = h.run.snapshot().windows?.[active]?.request.decisions[0]?.id
    expect(decisionId === undefined ? undefined : h.run.snapshot().decisions[decisionId]?.status).toBe('submitted')
    lost.mockRestore()
    const retry = vi.spyOn(h.connection, 'executeDeterministicDecision')
    await driver.advance()
    expect(retry.mock.calls.filter(([, id]) => id === decisionId)).toHaveLength(1)
    expect(h.run.snapshot().windows?.[active]?.status).toBe('closed')
    expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'task/create')).toHaveLength(1)
  } finally { remove(); await h.close() }
})

it('leaves an accepted workflow window open when management pauses after cognition', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const execute = h.connection.executeDeterministicDecision.bind(h.connection)
    vi.spyOn(h.connection, 'executeDeterministicDecision').mockImplementationOnce(async (...args) => {
      const result = await execute(...args)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      return result
    })
    expect((await driver.advance()).reason).toBe('paused')
    const active = h.run.snapshot().activeWindowId
    if (active === undefined) throw new Error('Paused workflow lost its accepted window')
    await h.run.setPhase('running', h.run.snapshot().revision)
    await driver.advance()
    expect(h.run.snapshot().windows?.[active]?.status).toBe('closed')
  } finally { remove(); await h.close() }
})

it('retains a resumed workflow window when management pauses after its cognition retry', async () => {
  const h = await companyFixture()
  const remove = registerTaskScenarioPolicies(h.ctx.simulationTeams)
  try {
    if (config.scenario === undefined) throw new Error('Workflow scenario fixture is missing')
    const driver = new SimulationTaskScenarioDriver(h.run, h.connection, companySettings, config, config.scenario,
      h.lifetime.signal, h.ctx.teams.getTask.bind(h.ctx.teams))
    await h.start()
    const open = h.connection.openWindow.bind(h.connection)
    const lost = vi.spyOn(h.connection, 'openWindow').mockImplementationOnce(async (request) => {
      await open(request)
      throw new Error('Workflow opening response lost before cognition')
    })
    await expect(driver.advance()).rejects.toThrow('Workflow opening response lost before cognition')
    lost.mockRestore()
    const active = h.run.snapshot().activeWindowId
    if (active === undefined) throw new Error('Lost opening has no active window')
    const execute = h.connection.executeDeterministicDecision.bind(h.connection)
    vi.spyOn(h.connection, 'executeDeterministicDecision').mockImplementationOnce(async (...args) => {
      const result = await execute(...args)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      return result
    })
    expect((await driver.advance()).reason).toBe('paused')
    expect(h.run.snapshot().activeWindowId).toBe(active)
    await h.run.setPhase('running', h.run.snapshot().revision)
    await driver.advance()
    expect(h.run.snapshot().windows?.[active]?.status).toBe('closed')
  } finally { remove(); await h.close() }
})
