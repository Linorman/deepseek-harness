/** Native task sources and authorized transfer policies for automatic executor regressions. */
import { simulationEntityIdSchema, simulationDecisionIdSchema, simulationProposalSchema, simulationPolicyRefSchema } from '@clocky/clocky-simulation'
import { SimulationTaskExecutor, simulationTaskExecutorSchema } from '../src/task-executor.ts'
import { companyFixture } from './company-driver-fixture.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'

export async function taskExecutorFixture(backend: 'json' | 'sqlite' = 'json') {
  const h = await companyFixture(backend)
  const buyer = simulationEntityIdSchema.parse('buyer'), supplier = simulationEntityIdSchema.parse('supplier')
  const cognition = simulationPolicyRefSchema.parse({ id: 'executor-transfer', version: '1' })
  const completion = simulationPolicyRefSchema.parse({ id: 'executor-completion', version: '1' })
  const config = simulationTaskExecutorSchema.parse({ version: '1', maxControlSteps: 2, leaseDurationMs: 60000,
    routes: [{ sourceEntityId: buyer, entityId: supplier, cognition, completion, reason: 'Deliver one inventory unit' }] })
  const residency = (entityId: typeof buyer) => ({ activation: { provider: 'in-process',
    seed: { kind: h.run.snapshot().entities[entityId]?.writer === undefined ? 'fresh' as const : 'resume' as const },
    agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [buyer, supplier] })
  const options = { lifetime: h.lifetime.signal, residency,
    readTask: h.ctx.teams.getTask.bind(h.ctx.teams), context: () => ({ personaVersion: 'company/1', modelVersion: 'company/scripted',
      sources: [{ kind: 'run-event' as const, runId: h.run.snapshot().spec.runId, sequence: h.run.snapshot().revision }],
      sections: contextRequest().sections.map(section => section.kind !== 'input' ? section : { ...section, blocks: [{ type: 'text' as const, text: JSON.stringify({
        reads: ['stock', 'received'].map(id => ({ resourceId: id, revision: h.run.snapshot().resources[id as never]!.revision })),
      }) }] }) }) }
  let evaluations = 0, computations = 0
  const removeCognition = h.ctx.simulationTeams.registerDeterministicPolicy({ ...cognition, decide(view) {
    computations++
    const block = view.content.find(section => section.kind === 'input')!.blocks[0]!
    if (block.type !== 'text') throw new Error('Transfer policy requires its authorized inventory revisions')
    const { reads } = JSON.parse(block.text) as { reads: unknown[] }
    return [simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
      commitmentId: null, reads, transfers: [{ from: 'stock', to: 'received', quantity: '1' }],
    } } })]
  } })
  const removeCompletion = h.ctx.simulationTeams.registerTaskCompletionPolicy({ ...completion, evaluate(state, execution) {
    evaluations++
    const effect = execution.decisions?.flatMap(value => state.decisions[value.request.decisionId]?.operationIds ?? [])
      .map(id => state.operations[id]).find(value => value?.action.kind === 'resource/transfer' && value.result?.status === 'applied')
    return effect === undefined ? { status: 'waiting', reason: 'Inventory transfer is pending' }
      : { status: 'result', operations: [effect.id], outcome: { kind: 'completed', result: { summary: 'Delivered one inventory unit' } } }
  } })
  const executor = new SimulationTaskExecutor(h.run, h.connection, config, options)
  return { ...h, executor, config, options, removeCognition, removeCompletion,
    get computations() { return computations }, get evaluations() { return evaluations },
    async createTask(blockedBy: string[] = [], sourceEntityId = buyer,
      overrides: Partial<Pick<import('@clocky/clocky-team').TeamTaskSnapshot, 'reviewPolicy' | 'maxAttempts'>> = {}) {
      await h.connection.ensureResident(sourceEntityId, residency(sourceEntityId))
      const id = simulationDecisionIdSchema.parse(`task-source/${h.run.snapshot().nextDecisionSlot}`)
      await h.connection.openDecision(sourceEntityId, id)
      const decision = await h.connection.submitDecision(sourceEntityId, id, [simulationProposalSchema.parse({ after: [], action: {
        kind: 'task/create', deliverAt: h.run.snapshot().time, task: { subject: 'Delivery', description: 'Transfer one stock unit',
          blockedBy, requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
          reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 2, ...overrides },
      } })])
      await h.run.drive({ until: h.run.snapshot().time })
      const operationId = decision.operationIds[0]!
      await h.connection.dispatchOperation(operationId, Date.now)
      return h.run.snapshot().operations[operationId]!
    },
  }
}
