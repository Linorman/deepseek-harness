/** Company scene policies select recorded inventory facts and reject invalid durable input without IO. */
import { expect, it, vi } from 'vitest'
import type { SimulationDeterministicPolicy, SimulationTaskCompletionPolicy, SimulationSnapshot } from '@clocky/clocky-simulation'
import { simulationOperationIdSchema } from '@clocky/clocky-simulation'
import { registerCompanyTaskPolicies, companyTaskTransfer, recoverCompanyTask, companyTaskCompletion } from '../src/company-task-policies.ts'
import { companyFixture, companyConfig, companySettings } from './company-driver-fixture.ts'
import { SimulationCompanyDriver, simulationCompanyDriverSchema } from '../src/company-driver.ts'

function capturePolicies() {
  let cognition: SimulationDeterministicPolicy | undefined, completion: SimulationTaskCompletionPolicy | undefined
  const removeCognition = vi.fn(), removeCompletion = vi.fn(), removeReviewed = vi.fn()
  const registry = { registerDeterministicPolicy: (policy: SimulationDeterministicPolicy) => { cognition = policy; return removeCognition },
    registerTaskCompletionPolicy: (policy: SimulationTaskCompletionPolicy) => {
      if (policy.id === companyTaskCompletion.id) { completion = policy; return removeCompletion }
      return removeReviewed
    } }
  const remove = registerCompanyTaskPolicies(registry)
  if (cognition === undefined || completion === undefined) throw new Error('Company policies not registered')
  return { cognition, completion, remove, removeCognition, removeCompletion, removeReviewed, registry }
}

async function evidence() {
  const h = await companyFixture()
  registerCompanyTaskPolicies(h.ctx.simulationTeams)
  const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, simulationCompanyDriverSchema.parse({ ...companyConfig,
    tasks: { version: '1', cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 2, retry: 'scene' } }), h.lifetime.signal,
  { readTask: h.ctx.teams.getTask.bind(h.ctx.teams) })
  await h.start()
  for (let batch = 0; batch < 40; batch++) if ((await driver.advance()).reason === 'completed') break
  const state = h.run.snapshot(), execution = Object.values(state.taskExecutions!)[0]!
  const decision = state.decisions[execution.decisions![0]!.request.decisionId]!
  if (decision.context?.status !== 'prepared') throw new Error('Task input was not prepared')
  const transfer = companyTaskTransfer(state, execution.request.operationId)!
  return { h, state, execution, view: decision.context.view, transfer }
}

it('removes both policy generations and rolls back a partially rejected registration', () => {
  const p = capturePolicies()
  p.remove(); expect(p.removeCognition).toHaveBeenCalledOnce(); expect(p.removeCompletion).toHaveBeenCalledOnce()
  expect(p.removeReviewed).toHaveBeenCalledOnce()
  const remove = vi.fn()
  expect(() => registerCompanyTaskPolicies({ registerDeterministicPolicy: () => remove,
    registerTaskCompletionPolicy: () => { throw new Error('policy-occupied') } })).toThrow('policy-occupied')
  expect(remove).toHaveBeenCalledOnce()
})

it('releases actual registered generations when their contributing fiber is disposed', async () => {
  const h = await companyFixture()
  try {
    const fiber = h.ctx.plugin({ inject: ['simulationTeams'], apply(ctx) {
      const teams = ctx.get('simulationTeams')
      if (teams === undefined) throw new Error('Policy fixture has no canonical registry')
      ctx.effect(() => registerCompanyTaskPolicies(teams))
    } })
    await fiber
    expect(() => registerCompanyTaskPolicies(h.ctx.simulationTeams)).toThrow('already registered')
    await fiber.dispose()
    const remove = registerCompanyTaskPolicies(h.ctx.simulationTeams)
    remove()
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('validates recorded JSON accounts and emits no world action for an original-effect acknowledgement', async () => {
  const { h, view, transfer } = await evidence()
  try {
    const { cognition } = capturePolicies()
    const input = (text: string) => ({ ...view, content: view.content.map(section => section.kind !== 'input' ? section : {
      ...section, blocks: [{ type: 'text' as const, text }],
    }) })
    expect(() => cognition.decide(input('No inventory selection'))).toThrow('authorized inventory view')
    expect(() => cognition.decide(input('Task inventory: {'))).toThrow()
    for (const accounts of [['stock', 'stock'], ['other', 'received'], ['stock', 'other']]) {
      expect(() => cognition.decide(input(`Task inventory: ${JSON.stringify({ kind: 'transfer', commitmentId: 'purchase',
        reads: accounts.map(resourceId => ({ resourceId, revision: 1 })) })}`))).toThrow('different transfer accounts')
    }
    expect(cognition.decide(input(`Task inventory: ${JSON.stringify({ kind: 'confirm', interactionId: 'purchase',
      expectedRevision: 1, evidence: transfer.id })}`))).toEqual([])
    expect(cognition.decide(view)).toHaveLength(1)
  } finally { await h.close() }
})

it('waits for unapplied effects, fails rejected work, and refuses unrelated or ambiguous completion evidence', async () => {
  const { h, state, execution, transfer } = await evidence()
  try {
    const { completion } = capturePolicies()
    const { result: _result, ...pending } = transfer
    const waiting: SimulationSnapshot = { ...state, operations: { ...state.operations, [transfer.id]: { ...pending, status: 'pending' } } }
    expect(completion.evaluate(waiting, execution).status).toBe('waiting')
    const rejected: SimulationSnapshot = { ...state, operations: { ...state.operations,
      [transfer.id]: { ...transfer, status: 'rejected', result: { status: 'rejected', code: 'SIM_RESOURCE_CONFLICT' } } } }
    expect(completion.evaluate(rejected, execution)).toMatchObject({ status: 'result', operations: [], outcome: { kind: 'failed' } })
    expect(completion.evaluate({ ...state, interactions: {} }, execution).status).toBe('waiting')
    expect(companyTaskTransfer({ ...state, interactions: {} }, execution.request.operationId)).toBeUndefined()
    expect(companyTaskTransfer({ ...state, taskExecutions: {} }, execution.request.operationId)).toBeUndefined()
    const empty = { ...execution, decisions: [] }
    expect(completion.evaluate(state, empty).status).toBe('waiting')
    const noDecisions = { ...execution }
    delete noDecisions.decisions
    expect(completion.evaluate(state, noDecisions).status).toBe('waiting')
    expect(recoverCompanyTask(state, [empty])).toBe('retry')
    expect(recoverCompanyTask(waiting, [execution])).toBe('waiting')
    expect(recoverCompanyTask(rejected, [execution])).toBe('blocked')
    expect(recoverCompanyTask({ ...state, operations: {} }, [execution])).toBe('blocked')
    const missingDecision = { ...state, decisions: {} }
    expect(completion.evaluate(missingDecision, execution).status).toBe('waiting')
    expect(recoverCompanyTask(missingDecision, [execution])).toBe('retry')
    const fake = simulationOperationIdSchema.parse('other-world-operation')
    const association = execution.decisions![0]!
    const withOther: SimulationSnapshot = { ...state, decisions: { ...state.decisions,
      [association.request.decisionId]: { ...state.decisions[association.request.decisionId]!, operationIds: [transfer.id, fake] } },
    operations: { ...state.operations, [fake]: { ...transfer, id: fake } } }
    expect(companyTaskTransfer(withOther, execution.request.operationId)).toBeUndefined()
    expect(recoverCompanyTask(withOther, [execution])).toBe('blocked')
    const source = state.operations[execution.request.operationId]!
    const additional: SimulationSnapshot = { ...withOther, operations: { ...withOther.operations, [fake]: { ...source, id: fake } } }
    expect(recoverCompanyTask(additional, [execution])).toBe('blocked')
    expect(completion.evaluate({ ...state, operations: { ...state.operations,
      [transfer.id]: { ...source, id: transfer.id } } }, execution).status)
      .toBe('waiting')
    expect(completion.evaluate({ ...state, operations: { ...state.operations,
      [transfer.id]: { ...transfer, entityId: state.entities['buyer' as never]!.id } } }, execution).status).toBe('waiting')
    const noExecution = { ...state }
    delete noExecution.taskExecutions
    expect(companyTaskTransfer(noExecution, execution.request.operationId)).toBeUndefined()
  } finally { await h.close() }
})
