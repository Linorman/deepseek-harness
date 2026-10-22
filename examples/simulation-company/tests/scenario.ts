/** Keyless two-entity procurement scenario through the real Loader, model turns and Simulation tools. */
import assert from 'node:assert/strict'
import { participantIdSchema } from '@clocky/clocky-team'
import { boot } from '@clocky/clocky-app-boot'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationChannelSpecSchema, simulationChangeSchema, simulationContextRequestSchema, simulationDecisionIdSchema,
  simulationEntityIdSchema, simulationProposalSchema, simulationResourceSpecSchema, simulationRunSelectionSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationProposal } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-company', process.argv[2]!)
const recovering = process.env['SIMULATION_COMPANY_MODE'] === 'open'
const constrained = process.env['SIMULATION_AUTO_RESIDENCY'] === 'true'
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'company', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: constrained ? 1 : 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '10000', relationRules: [],
} }))
try {
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Deliver one inventory unit', budgets: {} }, budgets: {} }, 'simulation/company')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/company')
  const buyer = simulationEntityIdSchema.parse('buyer')
  const supplier = simulationEntityIdSchema.parse('supplier')
  let bootstrapResponseRejected = false
  for (const id of [buyer, supplier]) {
    if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id, entityKind: 'person', cognition: 'agent',
      profile: { name: id, privateNote: `${id}-secret` } }), run.snapshot().revision)
    const participant = { displayName: id, role: id, capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'company/scripted' }
    if (id === buyer && process.env['SIMULATION_BOOTSTRAP_RESPONSE_FAULT'] === 'true') {
      const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
      ctx.teams.inviteParticipant = async request => ({ ...await invite(request), id: participantIdSchema.parse('foreign-response'), phase: 'active' })
      try { await assert.rejects(connection.ensureParticipant(id, participant), /participant target returned another identity/) }
      finally { ctx.teams.inviteParticipant = invite }
      assert.equal(run.snapshot().entities[id]?.binding, undefined)
      bootstrapResponseRejected = true
    }
    await connection.ensureParticipant(id, participant)
  }
  const channel = await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'purchase',
    members: [{ entityId: buyer, role: 'buyer' }, { entityId: supplier, role: 'supplier' }], limits: {} }))
  for (const [id, owner, quantity] of [['stock', supplier, '2'], ['received', buyer, '0']] as const) {
    if (!recovering) await run.createResource(simulationResourceSpecSchema.parse({ id, owner, quantity, kind: 'inventory', unit: 'item', controllers: [owner] }), run.snapshot().revision)
  }
  let script: { id: string; proposals: SimulationProposal[]; request: number } | undefined
  const modelRequest = ctx.simulationTeams.modelRequest.bind(ctx.simulationTeams)
  const pause = () => new Promise<void>((resolve) => {
    process.send?.('durable')
    process.once('message', () => { resolve() })
  })
  ctx.simulationTeams.modelRequest = async (...args) => {
    const target = script?.id === 'transfer' ? 'transfer' : script?.id === 'task-plan' ? 'task' : undefined
    const submit = args[1].kind === 'submit' && target !== undefined
    if (submit && process.env['SIMULATION_COMPANY_CRASH'] === `${target}-before-accept`) await pause()
    const result = await modelRequest(...args)
    if (submit && process.env['SIMULATION_COMPANY_CRASH'] === `${target}-accepted`) await pause()
    return result
  }
  const createTask = ctx.teams.createSimulationTask.bind(ctx.teams)
  ctx.teams.createSimulationTask = async (...args) => {
    const result = await createTask(...args)
    if (process.env['SIMULATION_COMPANY_CRASH'] === 'task-created') await pause()
    return result
  }
  const requests: Array<{ decision: string; request: number; tools: string[]; contextVisible: boolean }> = []
  const allModelInputs: string[] = []
  ctx.llm.registerAdapter(['company'], new class extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      assert.ok(script)
      const input = JSON.stringify(options.messages)
      allModelInputs.push(input)
      assert.ok(!input.includes('buyer-secret') && !input.includes('supplier-secret'))
      const tools = options.tools?.map(tool => tool.name).sort() ?? []
      assert.deepEqual(tools, ['simulation_observe', 'simulation_stage', 'simulation_submit'])
      const index = script.request++
      const name = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
      assert.ok(name, 'Submission must conclude the decision turn')
      requests.push({ decision: script.id, request: index, tools, contextVisible: input.includes(`Decision ${script.id}`) })
      assert.ok(requests.at(-1)!.contextVisible)
      const args = JSON.stringify(index === 1 ? { proposals: script.proposals } : {})
      const id = CallId(`${script.id}-${index}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }())
  const agents = new Map<string, NonNullable<Awaited<ReturnType<typeof connection.activate>>['localAgent']>>()
  for (const entityId of constrained ? [buyer] : [buyer, supplier]) {
    if (recovering) await connection.recover(entityId)
    const lease = await connection.activate(entityId, { provider: 'in-process', seed: { kind: recovering ? 'resume' : 'fresh' },
      agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: new AbortController().signal })
    assert.ok(lease.localAgent)
    agents.set(entityId, lease.localAgent)
  }
  const drive = (requested: string) => {
    const until = simTimeSchema.parse(BigInt(requested) < BigInt(run.snapshot().time) ? run.snapshot().time : requested)
    return constrained ? connection.driveResident({ until }, Date.now, entityId => ({
      activation: { provider: 'in-process', seed: { kind: run.snapshot().entities[entityId]?.writer === undefined ? 'fresh' : 'resume' },
        agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: new AbortController().signal },
      evict: [buyer, supplier],
    })) : connection.drive({ until }, Date.now)
  }
  await run.setPhase('running', run.snapshot().revision)
  const decisions: Array<{ id: string; time: string; status: string; operations: number }> = []
  const observations: Array<{ decision: string; content: unknown }> = []
  const decide = async (entityId: typeof buyer, id: string, facts: unknown, proposals: unknown[]) => {
    const original = run.snapshot().decisions[simulationDecisionIdSchema.parse(id)]
    if (original?.status === 'cancelled') id = `${id}/retry-${run.snapshot().entities[entityId]?.writer?.epoch}`
    const existing = run.snapshot().decisions[simulationDecisionIdSchema.parse(id)]
    const wakeId = existing?.wakeId ?? Object.values(run.snapshot().wakes).find(value => value.entityId === entityId && value.status === 'pending')?.eventId
    script = { id, proposals: proposals.map(value => simulationProposalSchema.parse(value)), request: 0 }
    // Each scenario input names only the actor's own state or already-delivered report and retains the run cursor that supplied it.
    const context = simulationContextRequestSchema.parse({ personaVersion: 'company-1', modelVersion: 'scripted-1', maxBytes: 65536, teamCursor: 0,
      sources: [{ kind: 'run-event', runId: run.snapshot().spec.runId, sequence: run.snapshot().revision }],
      sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
        blocks: [{ type: 'text', text: kind === 'identity' ? `You are ${entityId}.`
          : kind === 'input' ? `Decision ${id}: ${JSON.stringify(facts)}`
            : kind === 'authority' ? 'Only stage authorized simulation operations.'
              : kind === 'goals' ? 'Deliver one inventory unit and report the evidenced result.'
                : JSON.stringify(Object.values(run.snapshot().commitments)
                  .filter(value => value.debtor === entityId || value.creditor === entityId)) }] })),
    })
    const accepted = await connection.executeDecision(entityId, simulationDecisionIdSchema.parse(id), context, wakeId)
    assert.equal(script.request, existing?.status === 'accepted' ? 0 : 3)
    const count = requests.length
    assert.equal((await connection.executeDecision(entityId, accepted.id, context, wakeId)).id, accepted.id)
    assert.equal(requests.length, count, 'A completed decision retry must not repeat inference')
    const observed = agents.get(entityId)!.session.events.find(event => event.type === 'tool/result'
      && event.data.message.content[0].toolCallId === CallId(`${id}-0`))
    assert.ok(observed?.type === 'tool/result')
    const text = observed.data.message.content[0].content.find(block => block.type === 'text')
    assert.ok(text?.type === 'text')
    observations.push({ decision: id, content: JSON.parse(text.text) as unknown })
    decisions.push({ id, time: accepted.time, status: accepted.status, operations: accepted.operationIds.length })
    return accepted
  }
  await decide(buyer, 'request', { received: 0, supplier: 'supplier', deliverAt: '5' }, [
    { after: [], action: { kind: 'interaction/request', id: 'purchase', assignee: supplier, description: 'Deliver one inventory unit',
      replyBy: '20', completeBy: '30', fulfillment: { kind: 'transfer', from: 'stock', to: 'received', quantity: '1' } } },
    { after: [0], action: { kind: 'communication/post', recipient: supplier, channelId: channel.manifest.id,
      text: 'Request purchase: deliver one inventory unit to received.', deliverAt: '5' } },
  ])
  if (!recovering) {
    assert.equal((await drive('4')).reason, 'until')
    if (constrained) assert.equal(ctx.agents.get(run.snapshot().entities[supplier]!.binding!.sessionId), undefined)
    else assert.equal(agents.get(supplier)!.session.events.filter(event => event.type === 'user/message').length, 0)
    assert.equal(requests.length, 3)
    assert.equal((await drive('5')).reason, 'decision-required')
  }
  if (constrained) {
    const actor = ctx.agents.get(run.snapshot().entities[supplier]!.binding!.sessionId)
    assert.ok(actor); agents.set(supplier, actor)
    assert.equal(run.population().chargedActors, 1)
  }
  assert.ok(JSON.stringify(agents.get(supplier)!.session.events).includes('Request purchase'))
  if (!recovering && !constrained) {
    const before = agents.get(supplier)!.session.id
    await connection.hibernate(supplier)
    const awake = await connection.resume(supplier, { provider: 'in-process', agent: { preset: 'simulation',
      options: { provider: 'company', model: 'scripted' } }, signal: new AbortController().signal })
    assert.ok(awake.localAgent)
    assert.equal(awake.binding.sessionId, before)
    agents.set(supplier, awake.localAgent)
  }
  const purchase = () => Object.values(run.snapshot().interactions)[0]!
  await decide(supplier, 'accept', { request: purchase(), stock: 2 }, [
    { after: [], action: { kind: 'interaction/accept', id: 'purchase', expectedRevision: purchase().revision } },
  ])
  await drive('5')
  const transfer = await decide(supplier, 'transfer', { commitment: purchase().commitmentId, stock: 2, destination: 'received' }, [
    { after: [], action: { kind: 'resource/transfer', grants: [], transaction: { commitmentId: purchase().commitmentId,
      reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
      transfers: [{ from: 'stock', to: 'received', quantity: '1' }] } } },
  ])
  await drive('5')
  const effect = run.snapshot().operations[transfer.operationIds[0]!]!
  assert.equal(effect.result?.status, 'applied')
  if (process.env['SIMULATION_COMPANY_CRASH'] === 'transfer-applied') {
    process.send?.('durable')
    await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
  }
  const beforeRetry = run.snapshot().resources
  assert.deepEqual(await run.executeOperation(effect.id), effect.result)
  assert.deepEqual(run.snapshot().resources, beforeRetry)
  await decide(supplier, 'result', { transfer: effect.result, commitment: Object.values(run.snapshot().commitments)[0] }, [
    { after: [], action: { kind: 'interaction/result', id: 'purchase', expectedRevision: purchase().revision, evidence: [effect.id] } },
    { after: [0], action: { kind: 'communication/post', recipient: buyer, channelId: channel.manifest.id,
      text: `Purchase fulfilled: one unit delivered; evidence ${effect.id}.`, deliverAt: '6' } },
  ])
  const reportPending = run.snapshot().decisions[simulationDecisionIdSchema.parse('report')]?.status !== 'accepted'
  const reportDrive = await drive('6')
  if (reportPending) assert.equal(reportDrive.reason, 'decision-required')
  if (constrained) {
    const actor = ctx.agents.get(run.snapshot().entities[buyer]!.binding!.sessionId)
    assert.ok(actor); agents.set(buyer, actor)
    assert.equal(run.population().chargedActors, 1)
  }
  assert.ok(JSON.stringify(agents.get(buyer)!.session.events).includes('Purchase fulfilled'))
  await decide(buyer, 'report', { received: Object.values(run.snapshot().resources).find(value => value.owner === buyer)?.quantity,
    report: 'Purchase fulfilled', evidence: effect.id }, [])
  await drive('6')
  const taskDecision = await decide(buyer, 'task-plan', { assignee: supplier, purpose: 'Prepare the next delivery' }, [
    { after: [], action: { kind: 'interaction/request', id: 'next-delivery', assignee: supplier,
      description: 'Prepare the next delivery', replyBy: null, completeBy: null, fulfillment: { kind: 'task-completed' } } },
    { after: [0], action: { kind: 'task/create', deliverAt: '6', task: {
      subject: 'Prepare the next delivery', description: 'Return delivery evidence', blockedBy: [], requiredCapabilities: [], priority: 0,
      readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1,
    } } },
  ])
  await drive('6')
  const receipt = run.snapshot().operations[taskDecision.operationIds[1]!]!.outbox?.taskReceipt
  assert.ok(receipt)
  const createdTask = await ctx.teams.getTask({ teamId: team.team.id, taskId: receipt.taskId })
  assert.equal(createdTask.phase, 'pending')
  assert.equal((await ctx.teams.listTasksPage({ teamId: team.team.id, afterCursor: -1, limit: 10 })).items.length, 1)
  if (process.env['SIMULATION_OPAQUE_DECISIONS'] === 'true') {
    for (const id of ['constructor', 'toString', '__proto__']) await decide(buyer, id, { opaqueIdentity: id }, [])
  }
  const state = run.snapshot()
  assert.equal(purchase().execution, 'completed')
  assert.equal(Object.values(state.commitments)[0]?.phase, 'fulfilled')
  assert.ok(Object.values(state.operations).every(value => value.result?.status === 'applied'))
  const summary = { ...bootstrapResponseRejected ? { bootstrapResponseRejected } : {}, recovered: recovering,
    cancelledDecisions: Object.values(state.decisions)
      .filter(decision => decision.status === 'cancelled').map(decision => ({ id: decision.id, reason: decision.cancellation })), decisions, requests, observations, time: state.time,
    resources: Object.values(state.resources).map(({ id, quantity, revision }) => ({ id, quantity, revision })),
    interaction: { reply: purchase().reply, execution: purchase().execution },
    commitment: { phase: Object.values(state.commitments)[0]!.phase, evidenceCount: Object.values(state.commitments)[0]!.evidence.length },
    operations: Object.values(state.operations).map(operation => ({ kind: operation.action.kind, status: operation.status,
      delivered: operation.delivery?.receipt !== undefined })),
    taskCreation: { phase: createdTask.phase, count: 1, fulfillment: 'task-completed' },
    delayedVisibility: true, privateProfilesHidden: allModelInputs.every(input => !input.includes('-secret')), effectRetryPreserved: true }
  // Retain all recorded business material; only this fixture's canonical Channel allocation varies between processes.
  console.log(JSON.stringify(summary).replaceAll(channel.manifest.id, '<purchase-channel>'))
} finally { await run.close(); await ctx.fiber.dispose() }
