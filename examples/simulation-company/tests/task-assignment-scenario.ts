/** Actual Loader task assignment, scoped cognition, result settlement and controller-proved recovery. */
import type { SimulationEntityId } from '@clocky/clocky-simulation'
import { LlmAdapter, CallId } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { contextRequest } from '../../../packages/simulation/simulation-local/tests/context-fixture.ts'
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { taskAttemptIdSchema } from '@clocky/clocky-team'
import { simulationRunSelectionSchema, simulationDecisionIdSchema, simulationProposalSchema,
  simulationCheckpointRestoreRequestSchema, simulationCheckpointIdSchema, simulationResourceSpecSchema, simulationResourceIdSchema, simulationInteractionIdSchema, simulationPolicyRefSchema } from '@clocky/clocky-simulation'
import { prepareSimulationCompany, simulationCompanyPreparationSchema } from '@clocky/clocky-simulation-product'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-task-assignment', process.argv[2]!)
const settings = simulationCompanyPreparationSchema.parse({ version: '1', ownerName: 'simulation/task-assignment',
  objective: 'Assign one participant task', buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2',
  participant: { provider: 'in-process', preset: 'simulation', model: 'company/scripted' },
  checkpoint: { id: 'initial', maxDrainRounds: 4, maxAttempts: 3 } })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'open', spec: {
  runId: 'task-assignment', tickUnit: 'minute', origin: '0', maxTime: '100', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536,
  maxEntities: 16, maxResidentActors: 2, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100',
  maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100, maxPendingEvents: 100, maxPendingInteractions: 100,
  maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 100, maxDispatchWaitRounds: 8,
  maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '10000', relationRules: [],
} })
const hold = async (stage: string) => {
  if (process.env.TASK_ASSIGNMENT_CRASH !== stage) return
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
const interactionMode = process.env.TASK_INTERACTION
const deterministicMode = process.env.TASK_DETERMINISTIC === 'true'
const completionMode = process.env.TASK_COMPLETION === 'true' || deterministicMode
const workMode = process.env.TASK_DECISION === 'true' || completionMode
let modelCalls = 0
ctx.on('llm/stream', (_request, next) => { modelCalls += 1
  if (!workMode || deterministicMode) throw new Error('This task execution must not infer')
  return next()
})
const recovering = process.env.TASK_ASSIGNMENT_RECOVER === 'true'
const restored = recovering ? await ctx.simulationTeams.restore(selection, simulationCheckpointRestoreRequestSchema.parse({
  id: 'initial', implementationVersion: 'company/1', maxAttempts: 3,
})) : undefined
const run = restored?.run ?? await ctx.simulations.open({ ...selection, mode: 'create' })
try {
  const preparation = restored === undefined ? await prepareSimulationCompany(ctx.simulationTeams, run, settings) : undefined
  const teamId = preparation?.teamId ?? restored!.manifest.team.owner.teamId
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, teamId, settings.ownerName)
  const entity = Object.values(run.snapshot().entities).find(value => value.binding !== undefined)!
  const originalId = taskAttemptIdSchema.parse('original-attempt')
  if (recovering) {
    assert.equal(run.snapshot().phase, 'paused')
    const original = run.snapshot().taskExecutions![originalId]!
    assert.ok(original.retired)
    assert.equal(modelCalls, 0)
    const task = await ctx.teams.getTask({ teamId, taskId: original.request.taskId })
    assert.equal(task.attemptCount, process.env.TASK_ASSIGNMENT_STAGE === 'reserved' ? 0 : 1)
    if (task.attemptCount !== 0) assert.equal(task.attemptHistory[0]!.outcome.kind, 'failed')
  }
  await run.setPhase('running', run.snapshot().revision)
  await connection.ensureResident(entity.id, { activation: { provider: 'in-process', seed: { kind: recovering ? 'resume' : 'fresh' },
    agent: { preset: 'simulation', options: { provider: 'scripted', model: 'scripted' } }, signal: new AbortController().signal }, evict: [] })
  const linkedId = simulationInteractionIdSchema.parse('task-order')
  if (interactionMode !== undefined) {
    const requester = Object.values(run.snapshot().entities).find(value => value.binding !== undefined && value.id !== entity.id)!
    await connection.ensureResident(requester.id, { activation: { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { preset: 'simulation', options: { provider: 'scripted', model: 'scripted' } }, signal: new AbortController().signal }, evict: [] })
    for (const [id, quantity, owner] of [['task-stock', '2', entity.id], ['task-received', '0', requester.id]]) {
      await run.createResource(simulationResourceSpecSchema.parse({ id, quantity, owner, controllers: [entity.id, requester.id],
        kind: 'inventory', unit: 'item' }), run.snapshot().revision)
    }
    const apply = async (actor: SimulationEntityId, label: string, action: unknown) => {
      const id = simulationDecisionIdSchema.parse(label)
      await connection.openDecision(actor, id)
      const decision = await connection.submitDecision(actor, id, [simulationProposalSchema.parse({ after: [], action })])
      assert.equal((await run.executeOperation(decision.operationIds[0]!)).status, 'applied')
    }
    await apply(requester.id, 'linked-request', { kind: 'interaction/request', id: linkedId, assignee: entity.id,
      description: 'Deliver a task unit', replyBy: null, completeBy: null,
      fulfillment: interactionMode === 'transfer' ? { kind: 'transfer', from: 'task-stock', to: 'task-received', quantity: '1' }
        : { kind: interactionMode } })
    await apply(entity.id, 'linked-accept', { kind: 'interaction/accept', id: linkedId, expectedRevision: 1 })
  }
  const decisionId = simulationDecisionIdSchema.parse('create-task')
  let decision = run.snapshot().decisions[decisionId]
  if (decision === undefined) {
    await connection.openDecision(entity.id, decisionId)
    decision = await connection.submitDecision(entity.id, decisionId, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'task/create', deliverAt: run.snapshot().time, task: {
        subject: 'Deliver goods', description: 'A later executor must prove the world effect', blockedBy: [], requiredCapabilities: [],
        priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 2,
      },
    } })])
    await run.drive({ until: run.snapshot().time })
    await connection.dispatchOperation(decision.operationIds[0]!, Date.now)
  }
  const reserve = run.reserveTaskExecution.bind(run)
  run.reserveTaskExecution = async (...args) => { const result = await reserve(...args); await hold('reserved'); return result }
  const assign = ctx.teams.assignSimulationTask.bind(ctx.teams)
  ctx.teams.assignSimulationTask = async (request) => { const result = await assign(request); await hold('assigned'); return result }
  const observe = run.observeTaskExecution.bind(run)
  run.observeTaskExecution = async (...args) => { const result = await observe(...args); await hold('observed'); return result }
  const request = { operationId: decision.operationIds[0]!, entityId: entity.id,
    attemptId: recovering ? taskAttemptIdSchema.parse('replacement-attempt') : originalId, leaseDurationMs: 60000,
    ...interactionMode === undefined ? {} : { interactionId: linkedId } }
  const execution = await connection.assignTask(request)
  const revision = run.snapshot().revision
  assert.deepEqual(await connection.assignTask(request), execution)
  assert.equal(run.snapshot().revision, revision)
  assert.equal(execution.task!.executor!.attemptId, request.attemptId)
  const interactionEvidence = () => {
    if (interactionMode === undefined) return undefined
    const state = run.snapshot(), interaction = state.interactions[linkedId]!
    return { kind: interactionMode, task: interaction.task!.phase, commitment: state.commitments[interaction.commitmentId!]!.phase,
      source: run.snapshot().taskExecutions![request.attemptId]!.request.interaction!.interactionId }
  }
  let completionEvidence: { before: string; after: string; retriesWithoutEvaluation: boolean } | undefined
  let workEvidence: { modelCalls: number
    before: string[]
    after: string[]
    phase: string
    inputLogged: boolean
    taskContext: string } | undefined
  if (workMode) {
    for (const [id, quantity] of [['task-stock', '2'], ['task-received', '0']]) {
      if (run.snapshot().resources[simulationResourceIdSchema.parse(id)] !== undefined) continue
      await run.createResource(simulationResourceSpecSchema.parse({ id, quantity, owner: entity.id, controllers: [entity.id],
        kind: 'inventory', unit: 'item' }), run.snapshot().revision)
    }
    const transfer = [{ after: [], action: { kind: 'resource/transfer', grants: [], transaction: { commitmentId: interactionMode === 'transfer' ? run.snapshot().interactions[linkedId]!.commitmentId : null,
      reads: [{ resourceId: 'task-stock', revision: 1 }, { resourceId: 'task-received', revision: 1 }],
      transfers: [{ from: 'task-stock', to: 'task-received', quantity: '1' }] } } }]
    class TaskModel extends LlmAdapter {
      index = 0
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        assert.deepEqual(options.tools?.map(value => value.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
        const name = this.index++ === 0 ? 'simulation_stage' : 'simulation_submit'
        const argumentsJson = JSON.stringify(name === 'simulation_stage' ? { proposals: transfer } : {})
        const id = CallId(name)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJson } }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      }
    }
    const adapter = new TaskModel()
    ctx.llm.registerAdapter(['scripted'], adapter)
    const taskDecisionId = simulationDecisionIdSchema.parse('task-body')
    const before = Object.values(run.snapshot().resources).filter(value => value.id.startsWith('task-')).map(value => value.quantity)
    const cognition = simulationPolicyRefSchema.parse({ id: 'task-transfer-cognition', version: '1' })
    const removeCognition = deterministicMode ? ctx.simulationTeams.registerDeterministicPolicy({ ...cognition,
      decide: () => transfer.map(value => simulationProposalSchema.parse(value)),
    }) : undefined
    const selected = { attemptId: request.attemptId, decisionId: taskDecisionId, predecessor: null,
      ...deterministicMode ? { policy: cognition } : {},
      reason: 'Perform the task transfer', context: contextRequest() }
    const result = await connection.executeTaskDecision(selected)
    assert.equal(result.status, 'accepted')
    assert.deepEqual(Object.values(run.snapshot().resources).filter(value => value.id.startsWith('task-')).map(value => value.quantity), before)
    const callCount = modelCalls
    assert.deepEqual(await connection.executeTaskDecision(selected), result)
    assert.equal(modelCalls, callCount)
    removeCognition?.()
    const completionPolicy = simulationPolicyRefSchema.parse({ id: 'task-transfer', version: '1' })
    let evaluations = 0
    const removeCompletion = completionMode ? ctx.simulationTeams.registerTaskCompletionPolicy({ ...completionPolicy,
      evaluate: (state, original) => {
        evaluations += 1
        const effect = original.decisions?.flatMap(value => state.decisions[value.request.decisionId]?.operationIds ?? [])
          .map(id => state.operations[id]).find(value => value?.action.kind === 'resource/transfer'
            && value.result?.status === 'applied' && value.action.transaction.transfers.some(item =>
            item.from === 'task-stock' && item.to === 'task-received' && item.quantity === '1'))
        return effect === undefined ? { status: 'waiting', reason: 'Transfer has not been applied' }
          : { status: 'result', operations: [effect.id], outcome: { kind: 'completed', result: { summary: 'Transferred one inventory unit' } } }
      },
    }) : undefined
    if (completionMode) assert.equal((await connection.completeTask({ attemptId: request.attemptId, policy: completionPolicy })).status, 'waiting')
    await run.drive({ until: run.snapshot().time })
    const after = Object.values(run.snapshot().resources).filter(value => value.id.startsWith('task-')).map(value => value.quantity)
    assert.deepEqual(after, ['1', '1'])
    const task = await ctx.teams.getTask({ teamId, taskId: execution.request.taskId })
    assert.equal(task.phase, 'running')
    if (completionMode) {
      const settle = ctx.teams.settleSimulationTaskAttempt.bind(ctx.teams)
      ctx.teams.settleSimulationTaskAttempt = async (input) => {
        await settle(input)
        throw new Error('Original completion response lost')
      }
      await assert.rejects(connection.completeTask({ attemptId: request.attemptId, policy: completionPolicy }), /response lost/)
      ctx.teams.settleSimulationTaskAttempt = settle
      const count = evaluations
      removeCompletion?.()
      const completed = await connection.completeTask({ attemptId: request.attemptId, policy: completionPolicy })
      assert.equal(completed.status, 'settled')
      assert.equal(completed.execution.task?.phase, 'completed')
      assert.equal(evaluations, count)
      const revision = run.snapshot().revision
      assert.deepEqual(await connection.completeTask({ attemptId: request.attemptId, policy: completionPolicy }), completed)
      assert.equal(run.snapshot().revision, revision)
      completionEvidence = { before: 'waiting', after: completed.execution.task.phase, retriesWithoutEvaluation: true }
    }
    const association = run.snapshot().taskExecutions![request.attemptId]!.decisions![0]!
    const session = ctx.sessions.get(execution.request.sessionId)!
    assert.ok(session.events.some(event => event.type === 'user/message' && event.data.id === association.input?.id
      || event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === association.input?.id)))
    assert.equal(modelCalls, deterministicMode ? 0 : 2)
    const views = session.events.filter(event => event.type === 'simulation/context-view')
    const taskContext = views.at(-1)!.data.content.find(section => section.kind === 'input')!.blocks.at(-1)!
    assert.equal(taskContext.type, 'text')
    const normalized = JSON.parse(taskContext.type === 'text' ? taskContext.text : '') as Record<string, unknown>
    for (const key of ['runId', 'teamId', 'taskId', 'attemptId', 'decisionId', 'epoch']) normalized[key] = `<${key}>`
    workEvidence = { modelCalls, before, after, phase: task.phase, inputLogged: association.input !== undefined,
      taskContext: JSON.stringify(normalized) }
  }
  const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('assigned-cut'), implementationVersion: 'company/1',
    maxDrainRounds: 4, maxAttempts: 3 })
  assert.equal(checkpoint.status, 'completed')
  const task = await ctx.teams.getTask({ teamId, taskId: execution.request.taskId })
  const terminal = await connection.assignTask(request)
  assert.equal(terminal.task!.executor!.outcome, completionMode ? 'completed' : 'failed')
  if (completionMode) assert.equal(terminal.retired, undefined)
  else assert.ok(terminal.retired)
  if (!workMode) assert.equal(modelCalls, 0)
  assert.equal(Object.values(run.snapshot().operations).filter(value => value.action.kind === 'task/create').length, 1)
  console.log(JSON.stringify({ ...completionEvidence === undefined ? {} : { completion: completionEvidence },
    ...interactionMode === undefined ? {} : { interaction: interactionEvidence() },
    ...workEvidence === undefined ? {} : { work: workEvidence },
    phase: run.snapshot().phase, modelCalls, taskCount: 1, attemptCount: task.attemptCount,
    original: recovering ? { retired: true, assigned: process.env.TASK_ASSIGNMENT_STAGE !== 'reserved' } : undefined,
    replacement: recovering, exactAttempt: true, retriedWithoutWrites: true,
    checkpoint: checkpoint.status, interrupted: task.attemptHistory.at(-1)!.outcome.kind,
    controllerEvidence: task.attemptHistory.at(-1)!.retirement?.source }))
} finally { await run.close(); await ctx.fiber.dispose() }
