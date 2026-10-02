/** Production automatic task selection, cognition and settlement through the real Loader composition. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { LlmAdapter, CallId } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationRunSelectionSchema, simulationDecisionIdSchema, simulationProposalSchema,
  simulationEntityIdSchema, simulationPolicyRefSchema, simulationCheckpointIdSchema } from '@clocky/clocky-simulation'
import { prepareSimulationCompany, simulationCompanyPreparationSchema, SimulationTaskExecutor,
  simulationTaskExecutorSchema } from '@clocky/clocky-simulation-product'
import type {} from '@clocky/clocky-simulation-team'
const ctx = await boot('simulation-task-executor', process.argv[2]!)
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
  maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceQuantity: '10000', relationRules: [],
} })
const run = await ctx.simulations.open({ ...selection, mode: 'create' })
const lifetime = new AbortController()
let executor: SimulationTaskExecutor | undefined
let modelCalls = 0, computations = 0
const progression = process.env.TASK_EXECUTOR_PROGRESSION
const multiStep = progression === 'multi-step', rework = progression === 'rework'
const fulfillment = process.env.TASK_EXECUTOR_FULFILLMENT
if (fulfillment !== undefined) assert.ok(['explicit', 'transfer', 'task-completed'].includes(fulfillment))
try {
  const prepared = await prepareSimulationCompany(ctx.simulationTeams, run, settings)
  const connection = await ctx.simulationTeams.attach(run, prepared.teamId, settings.ownerName)
  const buyer = simulationEntityIdSchema.parse('buyer'), supplier = simulationEntityIdSchema.parse('supplier')
  const residency = (id: typeof buyer) => ({ activation: { provider: 'in-process',
    seed: { kind: run.snapshot().entities[id]?.writer === undefined ? 'fresh' as const : 'resume' as const },
    agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: lifetime.signal }, evict: [buyer, supplier] })
  const cognition = simulationPolicyRefSchema.parse({ id: 'inventory-transfer', version: '1' })
  const completion = simulationPolicyRefSchema.parse({ id: 'inventory-completion', version: '1' })
  const proposals = () => [simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
    commitmentId: fulfillment === 'transfer' ? Object.values(run.snapshot().interactions)[0]?.commitmentId : null,
    reads: ['stock', 'received'].map(id => ({ resourceId: id, revision: run.snapshot().resources[id as never]!.revision })),
    transfers: [{ from: 'stock', to: 'received', quantity: '1' }],
  } } })]
  const deterministic = process.env.TASK_EXECUTOR_COGNITION === 'deterministic'
  ctx.simulationTeams.registerDeterministicPolicy({ ...cognition, decide(view) {
    computations++
    const block = view.content.find(section => section.kind === 'input')!.blocks[0]!
    assert.equal(block.type, 'text')
    const actions = JSON.parse(block.type === 'text' ? block.text : '') as unknown[]
    return actions.map(value => simulationProposalSchema.parse(value))
  } })
  ctx.simulationTeams.registerTaskCompletionPolicy({ ...completion, evaluate(state, execution) {
    const effect = execution.decisions?.flatMap(value => state.decisions[value.request.decisionId]?.operationIds ?? [])
      .map(id => state.operations[id]).find(value => value?.action.kind === 'resource/transfer' && value.result?.status === 'applied')
    return effect === undefined || multiStep && (execution.decisions?.length ?? 0) < 2 ? { status: 'waiting', reason: 'Transfer is not applied' }
      : { status: 'result', operations: [effect.id], outcome: { kind: 'completed', result: { summary: 'Delivered one inventory unit' } } }
  } })
  class TaskModel extends LlmAdapter {
    async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      assert.ok(!deterministic)
      assert.deepEqual(options.tools?.map(value => value.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
      const name = modelCalls++ % 2 === 0 ? 'simulation_stage' : 'simulation_submit'
      const args = JSON.stringify(name === 'simulation_stage' ? { proposals: proposals() } : {})
      const id = CallId(name)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.llm.registerAdapter(['company'], new TaskModel())
  const config = simulationTaskExecutorSchema.parse({ version: '1', maxControlSteps: 3, leaseDurationMs: 60000,
    maxDecisionsPerAttempt: multiStep ? 2 : 1,
    routes: [{ sourceEntityId: buyer, entityId: supplier,
      ...fulfillment === undefined ? {} : { interactionId: 'fulfillment-order' },
      ...deterministic ? { cognition } : {}, completion,
      reason: 'Deliver one inventory unit' }] })
  executor = new SimulationTaskExecutor(run, connection, config, {
    lifetime: lifetime.signal, readTask: ctx.teams.getTask.bind(ctx.teams), residency,
    ...multiStep ? { nextDecision: () => ({ kind: 'decision' as const, reason: 'Deliver the second authorized unit',
      ...deterministic ? { policy: cognition } : {} }) } : {},
    context: () => ({ personaVersion: 'company/1', modelVersion: 'company/scripted',
      sources: [{ kind: 'run-event', runId: run.snapshot().spec.runId, sequence: run.snapshot().revision }],
      sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({
        kind: kind as 'identity' | 'authority' | 'input' | 'goals' | 'commitments', required: true,
        blocks: [{ type: 'text', text: kind === 'input' ? JSON.stringify(proposals())
          : kind === 'goals' ? 'Transfer the authorized stock unit, then submit.' : kind }],
      })),
    }),
  })
  const before = run.snapshot()
  assert.equal((await executor.advance()).reason, 'paused')
  assert.deepEqual(run.snapshot(), before)
  assert.equal(modelCalls, 0)
  await run.setPhase('running', run.snapshot().revision)
  await connection.ensureResident(buyer, residency(buyer))
  if (fulfillment !== undefined) {
    const request = simulationDecisionIdSchema.parse('fulfillment-request')
    await connection.openDecision(buyer, request)
    await connection.submitDecision(buyer, request, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'interaction/request', id: 'fulfillment-order', assignee: supplier, description: 'Deliver the authorized unit',
      replyBy: null, completeBy: null, fulfillment: fulfillment === 'transfer'
        ? { kind: 'transfer', from: 'stock', to: 'received', quantity: '1' } : { kind: fulfillment },
    } })])
    await connection.driveResident({ until: run.snapshot().time }, Date.now, residency)
    await connection.ensureResident(supplier, residency(supplier))
    const accepted = simulationDecisionIdSchema.parse('fulfillment-accept')
    await connection.openDecision(supplier, accepted)
    await connection.submitDecision(supplier, accepted, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'interaction/accept', id: 'fulfillment-order', expectedRevision: Object.values(run.snapshot().interactions)[0]!.revision,
    } })])
    await connection.driveResident({ until: run.snapshot().time }, Date.now, residency)
  }
  const creation = simulationDecisionIdSchema.parse('source-create')
  await connection.openDecision(buyer, creation)
  await connection.submitDecision(buyer, creation, [simulationProposalSchema.parse({ after: [], action: {
    kind: 'task/create', deliverAt: run.snapshot().time, task: { subject: 'Deliver goods', description: 'Transfer one inventory unit',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      reviewPolicy: rework ? { kind: 'participant', reviewerId: run.snapshot().entities[buyer]!.binding!.participantId }
        : { kind: 'none' }, budget: {}, maxAttempts: 2 },
  } })])
  await connection.driveResident({ until: run.snapshot().time }, Date.now, residency)
  let lostResponse = false
  const settle = ctx.teams.settleSimulationTaskAttempt.bind(ctx.teams)
  if (process.env.TASK_EXECUTOR_LOST_RESPONSE === 'true') ctx.teams.settleSimulationTaskAttempt = async (request) => {
    const result = await settle(request)
    if (!lostResponse) { lostResponse = true; throw new Error('settlement-response-lost') }
    return result
  }
  if (process.env.TASK_EXECUTOR_LOST_RESPONSE === 'true') {
    await assert.rejects(executor.advance(), /settlement-response-lost/)
  }
  const pending = executor.advance()
  assert.equal(executor.advance(), pending)
  assert.equal((await pending).reason, rework ? 'task-waiting' : 'idle')
  if (rework) {
    const original = Object.values(run.snapshot().taskExecutions!)[0]!
    const intent = original.result
    const resolveReview = async (nextPhase: 'pending' | 'completed') => {
      const task = await ctx.teams.getTask({ teamId: prepared.teamId, taskId: original.request.taskId })
      const team = await ctx.teams.getTeam({ teamId: prepared.teamId })
      const reviewerId = run.snapshot().entities[buyer]!.binding!.participantId
      const binding = team.activations.find(value => value.activation.participantId === reviewerId)!
      const issuer = ctx.teams.openActivationActorProofIssuer(), actor = issuer.issue(binding)
      try {
        await ctx.teams.resolveTaskReview({ actor: actor.proof, taskId: task.id, expectedRevision: task.revision,
          nextPhase, reason: nextPhase === 'pending' ? 'Deliver the second unit' : 'Both deliveries verified' })
      } finally { actor.revoke(); issuer.close() }
    }
    await resolveReview('pending')
    assert.equal((await executor.advance()).reason, 'task-waiting')
    assert.deepEqual(run.snapshot().taskExecutions![original.request.attemptId]!.result, intent)
    await resolveReview('completed')
    assert.equal((await executor.advance()).reason, 'idle')
  }
  const state = run.snapshot(), executions = Object.values(state.taskExecutions!)
  const execution = executions.at(-1)!
  const task = await ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
  assert.equal(task.phase, 'completed')
  assert.equal(task.attemptCount, rework ? 2 : 1)
  assert.equal(executions.length, rework ? 2 : 1)
  const deliveries = multiStep || rework ? 2 : 1
  assert.equal(state.resources['stock' as never]!.quantity, String(2 - deliveries))
  assert.equal(state.resources['received' as never]!.quantity, String(deliveries))
  assert.equal(execution.decisions!.length, multiStep ? 2 : 1)
  if (multiStep) assert.equal(execution.decisions![1]!.request.predecessor, execution.decisions![0]!.request.decisionId)
  assert.ok(execution.decisions![0]!.input)
  assert.equal(modelCalls, deterministic ? 0 : deliveries * 2)
  assert.equal(computations, deterministic ? deliveries : 0)
  let fulfillmentBeforeConfirm: string | undefined
  if (fulfillment !== undefined) {
    const interaction = Object.values(run.snapshot().interactions)[0]!
    fulfillmentBeforeConfirm = run.snapshot().commitments[interaction.commitmentId!]!.phase
    assert.equal(fulfillmentBeforeConfirm, fulfillment === 'explicit' ? 'open' : 'fulfilled')
    if (fulfillment === 'explicit') {
      const unauthorized = simulationDecisionIdSchema.parse('debtor-cannot-confirm')
      await connection.openDecision(supplier, unauthorized)
      await connection.submitDecision(supplier, unauthorized, [simulationProposalSchema.parse({ after: [], action: {
        kind: 'interaction/confirm', id: interaction.id, expectedRevision: interaction.revision,
      } })])
      await connection.driveResident({ until: run.snapshot().time }, Date.now, residency)
      assert.equal(run.snapshot().commitments[interaction.commitmentId!]!.phase, 'open')
      const confirm = simulationDecisionIdSchema.parse('creditor-confirm')
      await connection.openDecision(buyer, confirm)
      await connection.submitDecision(buyer, confirm, [simulationProposalSchema.parse({ after: [], action: {
        kind: 'interaction/confirm', id: interaction.id, expectedRevision: run.snapshot().interactions[interaction.id]!.revision,
      } })])
      await connection.driveResident({ until: run.snapshot().time }, Date.now, residency)
      assert.equal(run.snapshot().commitments[interaction.commitmentId!]!.phase, 'fulfilled')
    }
  }
  const session = ctx.sessions.get(execution.request.sessionId)!
  assert.ok(session.events.some(event => event.type === 'simulation/context-view' && event.data.content.some(section =>
    section.kind === 'input' && section.blocks.some(block => block.type === 'text' && block.text.includes('simulation-task')))))
  assert.equal((await executor.advance()).reason, 'idle')
  if (fulfillment === undefined) assert.deepEqual(run.snapshot(), state)
  const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('completed-cut'),
    implementationVersion: 'company/1', maxDrainRounds: 4, maxAttempts: 3 })
  assert.equal(checkpoint.status, 'completed')
  console.log(JSON.stringify({ phase: run.snapshot().phase, task: task.phase, attempts: task.attemptCount,
    source: 'accepted-task-create', cognition: deterministic ? 'deterministic' : 'model', modelCalls, computations,
    inputLogged: true, inventory: [String(2 - deliveries), String(deliveries)], lostResponse, repeatWithoutWrites: true,
    checkpoint: checkpoint.status, ...fulfillment === undefined ? {} : { fulfillment, fulfillmentBeforeConfirm,
      completionDoesNotBypassCreditor: true }, ...progression === undefined ? {} : { progression, decisions: execution.decisions!.length,
      reviews: task.reviewHistory.length } }))
} finally { lifetime.abort(); await executor?.drain(); await run.close(); await ctx.fiber.dispose() }
