/** Company production batches use canonical task execution without ordinary Team tool or assignment authority. */
import { expect, it, vi } from 'vitest'
import { SimulationCompanyDriver, simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { SimulationTaskExecutor } from '../src/task-executor.ts'
import { registerCompanyTaskPolicies } from '../src/company-task-policies.ts'
import { companyFixture, companyConfig, companySettings } from './company-driver-fixture.ts'
import { ownerFixture } from './company-owner-fixture.ts'
import { call } from './fixtures.ts'
import { simulationProductManageInputSchema } from '../src/control-schema.ts'
import { simulationEntityIdSchema, simulationProposalSchema, taskContinuationEvidence, simulationOperationIdSchema,
  simulationIngressRequestSchema } from '@clocky/clocky-simulation'
import { participantIdSchema, teamIdSchema, teamTaskIdSchema } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'

const taskConfig = (cognition: 'model' | 'deterministic') => simulationCompanyDriverSchema.parse({ ...companyConfig,
  tasks: { version: '1', cognition, leaseDurationMs: 60000, maxAttempts: 2, retry: 'scene' },
})

it.each((['json', 'sqlite'] as const).flatMap(backend => (['model', 'deterministic'] as const).map(cognition => ({ backend, cognition }))))
('executes a real company task and applied inventory before reporting ($backend, $cognition)', async ({ backend, cognition }) => {
  const h = await companyFixture(backend)
  try {
    const remove = registerCompanyTaskPolicies(h.ctx.simulationTeams)
    const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, taskConfig(cognition), h.lifetime.signal,
      { readTask: h.ctx.teams.getTask.bind(h.ctx.teams) })
    const before = h.run.snapshot()
    expect((await driver.advance()).reason).toBe('paused')
    expect(h.run.snapshot()).toEqual(before)
    await h.start()
    let result
    for (let batch = 0; batch < 40; batch++) {
      result = await driver.advance()
      expect(result.controlSteps).toBeLessThanOrEqual(companyConfig.maxControlSteps)
      if (result.reason !== 'work-limit') break
    }
    expect(result?.reason).toBe('completed')
    const state = h.run.snapshot(), executions = Object.values(state.taskExecutions!)
    expect(executions).toHaveLength(1)
    expect(executions[0]!.task?.phase).toBe('completed')
    expect(executions[0]!.decisions?.[0]?.input).toBeDefined()
    expect(state.resources['stock' as never]?.quantity).toBe('1')
    expect(state.resources['received' as never]?.quantity).toBe('1')
    expect(h.requests.some(value => value.stage === 'transfer')).toBe(cognition === 'model')
    expect(h.requests.filter(value => value.stage === 'task')).toHaveLength(3)
    const calls = h.requests.length
    expect((await driver.advance()).reason).toBe('completed')
    expect(h.requests).toHaveLength(calls)
    expect(h.run.snapshot()).toEqual(state)
    await driver.drain(); remove()
  } finally { await h.close() }
})

it('fails before activation when a task-enabled driver has no canonical reader', async () => {
  const h = await companyFixture()
  try {
    expect(() => new SimulationCompanyDriver(h.run, h.connection, companySettings, taskConfig('model'), h.lifetime.signal))
      .toThrow('canonical task reader')
    expect(h.run.population().chargedActors).toBe(0)
  } finally { await h.close() }
})

it('advances retained future events while task evidence is missing and stops after the queue is exhausted', async () => {
  const h = await companyFixture('json', true, {}, (stage, proposals) => stage === 'transfer' ? [] : proposals)
  try {
    registerCompanyTaskPolicies(h.ctx.simulationTeams)
    const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, taskConfig('model'), h.lifetime.signal,
      { readTask: h.ctx.teams.getTask.bind(h.ctx.teams) })
    for (const [id, time] of [['earlier', '40'], ['late', '41'], ['same-time', '40']]) {
      await h.run.ingest(simulationIngressRequestSchema.parse({ id, source: 'human',
        entityId: id === 'same-time' ? 'supplier' : 'buyer', text: 'Retained future input', availableAt: time }))
    }
    await h.start()
    let result
    for (let batch = 0; batch < 40; batch++) {
      result = await driver.advance()
      if (result.reason !== 'work-limit') break
    }
    expect(result?.reason).toBe('scenario-blocked')
    expect(h.run.snapshot().time).toBe('41')
    expect(h.run.snapshot().resources['received' as never]?.quantity).toBe('0')
    expect(Object.values(h.run.snapshot().taskExecutions!)[0]?.task?.phase).toBe('running')
  } finally { await h.close() }
})

it('preserves the real retry deadline when advancing future task evidence encounters transport retry', async () => {
  const h = await companyFixture('json', true, {}, (stage, proposals) => stage === 'transfer' ? [] : proposals)
  try {
    registerCompanyTaskPolicies(h.ctx.simulationTeams)
    const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, taskConfig('model'), h.lifetime.signal,
      { readTask: h.ctx.teams.getTask.bind(h.ctx.teams) })
    const drive = h.connection.driveResident.bind(h.connection)
    vi.spyOn(h.connection, 'driveResident').mockImplementation(async (request, clock, residency) => {
      const state = h.run.snapshot()
      if (Object.values(state.taskExecutions ?? {}).length > 0 && request.until !== state.time) {
        residency?.(simulationEntityIdSchema.parse('supplier'))
        return { reason: 'retry', rounds: 0, steps: 0, revision: state.revision, nextAttemptAt: 1234 }
      }
      return await drive(request, clock, residency)
    })
    await h.start()
    let result
    for (let batch = 0; batch < 40; batch++) { result = await driver.advance(); if (result.reason !== 'work-limit') break }
    expect(result).toMatchObject({ reason: 'retry', nextAttemptAt: 1234, stage: 'task' })
  } finally { await h.close() }
})

it('passes the task executor’s technical retry deadline to the product scheduling owner', async () => {
  const h = await companyFixture()
  try {
    registerCompanyTaskPolicies(h.ctx.simulationTeams)
    const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, taskConfig('model'), h.lifetime.signal,
      { readTask: h.ctx.teams.getTask.bind(h.ctx.teams) })
    vi.spyOn(SimulationTaskExecutor.prototype, 'advance').mockResolvedValueOnce({ reason: 'retry', controlSteps: 1,
      revision: h.run.snapshot().revision, nextAttemptAt: 1234 })
    await h.start()
    let result
    for (let batch = 0; batch < 40; batch++) { result = await driver.advance(); if (result.reason !== 'work-limit') break }
    expect(result).toMatchObject({ reason: 'retry', nextAttemptAt: 1234, stage: 'task' })
    vi.restoreAllMocks()
  } finally { await h.close() }
})

it.each((['json', 'sqlite'] as const).flatMap(backend => (['model', 'deterministic'] as const).map(cognition => ({ backend, cognition }))))
('continues original applied task effects after writer retirement without another transfer ($backend, $cognition)', async ({ backend, cognition }) => {
  const h = await companyFixture(backend)
  try {
    registerCompanyTaskPolicies(h.ctx.simulationTeams)
    const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, taskConfig(cognition), h.lifetime.signal,
      { readTask: h.ctx.teams.getTask.bind(h.ctx.teams) })
    vi.spyOn(h.ctx.teams, 'settleSimulationTaskAttempt').mockRejectedValueOnce(new Error('result-response-lost'))
    await h.start()
    await expect((async () => {
      for (let batch = 0; batch < 40; batch++) {
        const result = await driver.advance()
        if (result.reason !== 'work-limit') throw new Error(`Unexpected stop: ${result.reason}`)
      }
    })()).rejects.toThrow('result-response-lost')
    expect(h.run.snapshot().resources['received' as never]?.quantity).toBe('1')
    await h.connection.hibernate(simulationEntityIdSchema.parse('supplier'))
    const original = Object.values(h.run.snapshot().taskExecutions!)[0]!
    expect(original.retired).toBeDefined()
    let result
    for (let batch = 0; batch < 40; batch++) {
      result = await driver.advance()
      if (result.reason !== 'work-limit') break
    }
    expect(result?.reason).toBe('completed')
    const state = h.run.snapshot(), executions = Object.values(state.taskExecutions!)
    expect(executions).toHaveLength(2)
    expect(executions[0]!.task?.executor?.outcome).toBe('failed')
    expect(executions[1]!.request.interaction?.execution).toBe('continuation')
    expect(executions[1]!.task?.phase).toBe('completed')
    expect(state.resources['stock' as never]?.quantity).toBe('1')
    expect(state.resources['received' as never]?.quantity).toBe('1')
    expect(Object.values(state.operations).filter(value => value.action.kind === 'resource/transfer')).toHaveLength(1)
    expect(h.requests.filter(value => value.stage === 'transfer')).toHaveLength(cognition === 'model' ? 3 : 0)
    expect(h.requests.filter(value => value.stage === 'task-recovery')).toHaveLength(cognition === 'model' ? 3 : 0)
    const acknowledgement = executions[1]!.decisions![0]!
    expect(state.decisions[acknowledgement.request.decisionId]?.operationIds).toEqual([])
    expect(executions[1]!.result?.request.operations).toEqual(executions[0]!.result?.request.operations)
  } finally { await h.close() }
})

it.each(['model', 'deterministic'] as const)('lets the product-held background scheduler complete %s task cognition', async (cognition) => {
  const h = await ownerFixture('json', {}, taskConfig(cognition))
  try {
    expect((await h.ctx.simulationAdministration.catalog(call())).items[0]?.execution).toBe('automatic-tasks')
    const runId = await h.create()
    await h.ctx.simulationAdministration.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'task-start', phase: 'running' }), call())
    await vi.waitFor(async () => { expect((await h.ctx.simulationAdministration.control({ runId }, call())).driver).toBe('completed') },
      { timeout: 5000, interval: 5 })
    const state = h.owned().snapshot()
    expect(Object.values(state.taskExecutions!)[0]!.task?.phase).toBe('completed')
    expect(state.resources['received' as never]?.quantity).toBe('1')
    expect(h.requests.filter(value => value.stage === 'transfer')).toHaveLength(cognition === 'model' ? 3 : 0)
  } finally { await h.close() }
})

it('denies repeated world actions and substituted result evidence during an actual continuation', async () => {
  const h = await companyFixture()
  try {
    registerCompanyTaskPolicies(h.ctx.simulationTeams)
    const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, taskConfig('model'), h.lifetime.signal,
      { readTask: h.ctx.teams.getTask.bind(h.ctx.teams) })
    vi.spyOn(h.ctx.teams, 'settleSimulationTaskAttempt').mockRejectedValueOnce(new Error('before-settlement'))
    await h.start()
    await expect((async () => { for (let batch = 0; batch < 40; batch++) await driver.advance() })()).rejects.toThrow('before-settlement')
    await h.connection.hibernate(simulationEntityIdSchema.parse('supplier'))
    const execute = h.connection.executeDecision.bind(h.connection)
    let checkedActions = false, checkedResult = false
    const reserve = h.run.reserveTaskExecution.bind(h.run)
    vi.spyOn(h.run, 'reserveTaskExecution').mockImplementation(async (request, revision) => {
      if (request.interaction?.execution === 'continuation') {
        const before = h.run.snapshot()
        await expect(reserve({ ...request, interaction: { ...request.interaction,
          expectedRevision: request.interaction.expectedRevision - 1 } }, revision)).rejects.toThrow('interaction revision conflict')
        expect(h.run.snapshot()).toEqual(before)
      }
      return await reserve(request, revision)
    })
    vi.spyOn(h.connection, 'executeDecision').mockImplementation(async (entityId, id, context, wakeId) => {
      const state = h.run.snapshot(), owner = state.taskDecisionOwners?.[id]
      const execution = owner === undefined ? undefined : state.taskExecutions?.[owner.attemptId]
      if (execution?.request.interaction?.execution === 'continuation') {
        await h.connection.openDecision(entityId, id)
        const before = h.run.snapshot()
        const proposal = simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
          commitmentId: Object.values(before.commitments)[0]!.id,
          reads: ['stock', 'received'].map(key => ({ resourceId: key, revision: before.resources[key as never]!.revision })),
          transfers: [{ from: 'stock', to: 'received', quantity: '1' }],
        } } })
        await expect(h.connection.submitDecision(entityId, id, [proposal])).rejects.toThrow('only an acknowledgement')
        expect(h.run.snapshot()).toEqual(before)
        expect(taskContinuationEvidence(before, execution.request)).toBeDefined()
        const { interaction: _interaction, ...unassociated } = execution.request
        expect(taskContinuationEvidence(before, unassociated)).toBeUndefined()
        const missingAttempts = { ...before }
        delete missingAttempts.taskExecutions
        expect(taskContinuationEvidence(missingAttempts, execution.request)).toBeUndefined()
        const old = Object.values(before.taskExecutions!).find(value => value.retired !== undefined)!
        const { retired: _retired, ...unretired } = old
        for (const changed of [unretired,
          { ...old, request: { ...old.request, operationId: simulationOperationIdSchema.parse('another-source') } },
          { ...old, request: { ...old.request, participantId: participantIdSchema.parse('another-participant') } },
          { ...old, request: { ...old.request, sessionId: SessionId('another-session') } },
          { ...old, request: { ...old.request, ordinal: execution.request.ordinal } },
          { ...old, request: { ...old.request, epoch: execution.request.epoch } },
          { ...old, decisions: [] },
          { ...old, decisions: old.decisions!.map((value) => { const { input: _input, ...missing } = value; return missing }) },
        ]) expect(taskContinuationEvidence({ ...before, taskExecutions: { ...before.taskExecutions,
          [old.request.attemptId]: changed } }, execution.request)).toBeUndefined()
        expect(taskContinuationEvidence({ ...before, interactions: {} }, execution.request)).toBeUndefined()
        const interaction = before.interactions[execution.request.interaction.interactionId]!
        for (const changed of [{ ...interaction, reply: 'pending' as const },
          { ...interaction, fulfillment: { kind: 'explicit' as const } },
          { ...interaction, assignee: simulationEntityIdSchema.parse('buyer') }]) {
          expect(taskContinuationEvidence({ ...before, interactions: { ...before.interactions,
            [interaction.id]: changed } }, execution.request)).toBeUndefined()
        }
        const commitment = before.commitments[interaction.commitmentId!]!
        expect(taskContinuationEvidence({ ...before, interactions: { ...before.interactions, [interaction.id]: { ...interaction,
          task: { ...interaction.task!, teamId: teamIdSchema.parse('another-team') } } } }, execution.request)).toBeUndefined()
        expect(taskContinuationEvidence({ ...before, interactions: { ...before.interactions, [interaction.id]: { ...interaction,
          task: { ...interaction.task!, taskId: teamTaskIdSchema.parse('another-task') } } } }, execution.request)).toBeUndefined()
        for (const changed of [{ ...commitment, phase: 'open' as const }, { ...commitment, phase: 'cancelled' as const },
          { ...commitment, evidence: [] }, { ...commitment, evidence: [simulationOperationIdSchema.parse('foreign-evidence')] }]) {
          expect(taskContinuationEvidence({ ...before, commitments: { ...before.commitments,
            [commitment.id]: changed } }, execution.request)).toBeUndefined()
        }
        expect(taskContinuationEvidence({ ...before, commitments: {} }, execution.request)).toBeUndefined()
        checkedActions = true
      }
      return await execute(entityId, id, context, wakeId)
    })
    const record = h.run.recordTaskResult.bind(h.run)
    vi.spyOn(h.run, 'recordTaskResult').mockImplementation(async (request, revision) => {
      const before = h.run.snapshot(), execution = before.taskExecutions![request.attemptId]!
      if (execution.request.interaction?.execution === 'continuation') {
        await expect(record({ ...request, operations: [simulationOperationIdSchema.parse('foreign-result')] }, before.revision))
          .rejects.toThrow('exact original transfer evidence')
        expect(h.run.snapshot()).toEqual(before)
        checkedResult = true
      }
      return await record(request, revision)
    })
    let result
    for (let batch = 0; batch < 40; batch++) { result = await driver.advance(); if (result.reason !== 'work-limit') break }
    expect(result?.reason).toBe('completed')
    expect(checkedActions && checkedResult).toBe(true)
    expect(h.run.snapshot().resources['received' as never]?.quantity).toBe('1')
  } finally { await h.close() }
})
