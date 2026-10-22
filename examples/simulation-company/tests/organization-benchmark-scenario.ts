/** Multi-day organization, delayed commitments and role handoff through real deterministic actors. @module */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema, simulationDecisionIdSchema,
  simulationContextRequestSchema, simulationPolicyRefSchema, simulationProposalSchema, simulationResourceSpecSchema,
  simulationCheckpointRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationEntityId, SimulationInteractionId, SimulationSnapshot } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'
import { parseSimulationBenchmarkOptions } from '../../../scripts/simulation-benchmark-options.ts'
import { benchmarkLatencySummary, benchmarkDiskBytes, writeBenchmarkRecovery } from '../../../scripts/simulation-benchmark-metrics.ts'

const options = parseSimulationBenchmarkOptions(process.argv.slice(3))
if (options.workload !== 'organization') throw new Error('Organization benchmark requires --workload organization')
const root = process.env['SIMULATION_COMPANY_ROOT']
if (!root) throw new Error('SIMULATION_COMPANY_ROOT must name isolated benchmark data')
const ctx = await boot('simulation-organization-benchmark', process.argv[2]!)
let run: SimulationRun | undefined
let issued = 0, completed = 0, decisions = 0, policyCalls = 0, handoffs = 0, retainedDebtors = 0
let peakResidents = 0, peakRssBytes = 0, peakContextBytes = 0, peakPending = 0, modelCalls = 0, publications = 0
const latencies: number[] = [], delays: number[] = []
const emit = (value: unknown) => { console.log(JSON.stringify(value)) }
const stream = ctx.llm.stream.bind(ctx.llm)
ctx.llm.stream = (...args) => { modelCalls += 1; return stream(...args) }
const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
ctx.teams.postChannelEnvelope = (...args) => { publications += 1; return post(...args) }
const employees = Array.from({ length: options.entities - options.managers - options.departments }, (_, i) => simulationEntityIdSchema.parse(`employee-${i}`))
const managers = Array.from({ length: options.managers }, (_, i) => simulationEntityIdSchema.parse(`manager-${i}`))
const departments = Array.from({ length: options.departments }, (_, i) => simulationEntityIdSchema.parse(`department-${i}`))
const people = [...employees, ...managers]
const policy = simulationPolicyRefSchema.parse({ id: 'frozen-work-order', version: '1' })
ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: (view) => {
  policyCalls += 1
  const input = view.content.find(section => section.kind === 'input')?.blocks[0]
  assert.ok(input?.type === 'text')
  return simulationProposalSchema.array().parse(JSON.parse(input.text))
} })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
  runId: 'organization-benchmark', tickUnit: 'day', origin: '0', maxTime: String(options.days + 2),
  rulesVersion: 'organization-1', policyVersion: 'organization-1', outboxMaxAttempts: 1, outboxRetryDelayMs: 0,
  maxDriveSteps: options.sampleEvery, maxMicrostepsPerTime: options.operations * 6,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: options.timeoutMs, maxConflictRetries: 0,
  maxIngressBytes: 4096, maxEntities: options.entities, maxResidentActors: options.residents, maxDecisionsPerWindow: 1,
  maxOperationsPerDecision: 1,
  maxResourceReservationHistory: 128, maxResourceQuantity: String(options.operations), maxQueuedDecisions: people.length,
  maxDispatchWaitRounds: people.length, budgetInterval: String(options.days + 2), maxDecisionsPerInterval: options.operations * 3,
  maxMessagesPerInterval: 0, maxTokensPerInterval: 0, tokensPerModelRequest: 1,
  maxPendingEvents: options.operations * 2, maxPendingInteractions: options.operations, maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 1,
  relationRules: [{ relation: 'manager', subjectKinds: ['department'], objectKinds: ['manager'], acyclic: true },
    { relation: 'member', subjectKinds: ['employee'], objectKinds: ['department'], acyclic: true }],
} })
try {
  const setupStarted = performance.now()
  run = await ctx.simulations.open(selection)
  const owned = run
  const sample = () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024)
    peakResidents = Math.max(peakResidents, owned.population().chargedActors)
    peakPending = Math.max(peakPending, issued - completed)
    assert.ok(peakResidents <= options.residents)
  }
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Measure retained responsibilities across daily manager handoffs', budgets: {} }, budgets: {} },
    'simulation/organization-benchmark')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/organization-benchmark')
  const entities = [...employees.map(id => ({ id, entityKind: 'employee', cognition: 'agent' })),
    ...managers.map(id => ({ id, entityKind: 'manager', cognition: 'agent' })),
    ...departments.map(id => ({ id, entityKind: 'department', cognition: 'none' }))]
  for (let start = 0; start < entities.length; start += options.entityBatchSize) {
    await run.changeMany(entities.slice(start, start + options.entityBatchSize).map(entity => simulationChangeSchema.parse({
      kind: 'entity/create', readiness: 'ready', ...entity, profile: {},
    })), run.snapshot().revision)
  }
  for (const [index, id] of people.entries()) {
    await connection.ensureParticipant(id, { displayName: id, role: employees.includes(id) ? 'employee' : 'manager', capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'unused' })
    await run.createResource(simulationResourceSpecSchema.parse({ id: `${id}/stock`, owner: id, controllers: [id], kind: 'inventory',
      unit: 'item', quantity: managers.includes(id) ? String(options.operations) : '0' }), run.snapshot().revision)
    if ((index + 1) % options.sampleEvery === 0) { sample(); emit({ kind: 'progress', phase: 'participants', participants: index + 1, peakRssBytes }) }
  }
  for (const [index, id] of employees.entries()) {
    await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: `membership/${id}`, relation: 'member', subject: id,
      object: departments[index % departments.length], validFrom: '0', validUntil: null }), run.snapshot().revision)
  }
  const managerFor = (employee: SimulationEntityId): SimulationEntityId => {
    const relations = owned.relationsAt(owned.snapshot().time)
    const membership = relations.find(value => value.relation === 'member' && value.subject === employee)
    assert.ok(membership)
    const role = relations.filter(value => value.relation === 'manager' && value.subject === membership.object)
    assert.equal(role.length, 1)
    return role[0]!.object
  }
  const rotate = async (day: number) => {
    const current = owned.relationsAt(owned.snapshot().time).filter(value => value.relation === 'manager')
    const changes = current.map(value => simulationChangeSchema.parse({ kind: 'relation/update', id: value.id, relation: value.relation, subject: value.subject, object: value.object, validFrom: value.validFrom,
      relationRevision: value.revision, validUntil: String(day) }))
    // One administrative batch leaves every department with exactly one current manager.
    for (const [index, department] of departments.entries()) changes.push(simulationChangeSchema.parse({
      kind: 'relation/create', id: `manager/${day}/${department}`, relation: 'manager', subject: department,
      object: managers[(index + day) % managers.length], validFrom: String(day), validUntil: null,
    }))
    await owned.changeMany(changes, owned.snapshot().revision)
    handoffs += current.length
  }
  const decide = async (actor: SimulationEntityId, name: string, action: unknown) => {
    const began = performance.now()
    const before = owned.snapshot()
    assert.equal((await connection.ensureResident(actor, { activation: { provider: 'in-process',
      seed: { kind: before.entities[actor]?.writer?.activationId === undefined ? 'fresh' : 'resume' },
      agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal }, evict: people.filter(id => id !== actor) })).status, 'resident')
    sample()
    const state = owned.snapshot()
    const proposals = [simulationProposalSchema.parse({ after: [], action })]
    const context = simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 0, personaVersion: 'organization-1', modelVersion: 'no-model',
      sources: [{ kind: 'run-event', runId: state.spec.runId, sequence: state.revision }],
      sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
        blocks: [{ type: 'text', text: kind === 'input' ? JSON.stringify(proposals) : kind === 'identity' ? actor : 'Execute the authorized work order.' }] })),
    })
    const id = simulationDecisionIdSchema.parse(name)
    const decision = await connection.executeDeterministicDecision(actor, id, context, policy)
    assert.equal(decision.status, 'accepted')
    const calls = policyCalls
    assert.deepEqual(await connection.executeDeterministicDecision(actor, id, context, policy), decision)
    assert.equal(policyCalls, calls)
    for (const operation of decision.operationIds) {
      const result = await owned.executeOperation(operation)
      assert.equal(result.status, 'applied', JSON.stringify(result))
      const revision = owned.snapshot().revision
      assert.deepEqual(await owned.executeOperation(operation), result)
      assert.equal(owned.snapshot().revision, revision)
    }
    const prepared = owned.snapshot().decisions[id]?.context
    assert.ok(prepared?.status === 'prepared')
    peakContextBytes = Math.max(peakContextBytes, prepared.retainedBytes)
    decisions += 1
    latencies.push(performance.now() - began)
  }
  await run.setPhase('running', run.snapshot().revision)
  const setupMs = performance.now() - setupStarted
  const started = performance.now()
  const pending: { id: SimulationInteractionId; employee: SimulationEntityId; manager: SimulationEntityId; day: number }[] = []
  let day = 0
  for (; day <= options.days && performance.now() - started < options.durationMs; day += 1) {
    while (BigInt(run.snapshot().time) < BigInt(day)) {
      const result = await run.drive({ until: simTimeSchema.parse(String(day)) })
      assert.ok(result.reason === 'until' || result.reason === 'work-limit', JSON.stringify(result))
    }
    await rotate(day)
    while (pending.length > 0 && performance.now() - started < options.durationMs) {
      const order = pending[0]!
      const state: SimulationSnapshot = run.snapshot()
      const request = state.interactions[order.id]!
      const commitment = state.commitments[request.commitmentId!]!
      assert.equal(commitment.debtor, order.manager)
      if (managerFor(order.employee) !== order.manager) retainedDebtors += 1
      const from = Object.values(state.resources).find(value => value.id === `${order.manager}/stock`)!
      const to = Object.values(state.resources).find(value => value.id === `${order.employee}/stock`)!
      await decide(order.manager, `${order.id}/deliver`, { kind: 'resource/transfer', grants: [], transaction: {
        commitmentId: commitment.id, reads: [from, to].map(value => ({ resourceId: value.id, revision: value.revision })),
        transfers: [{ from: from.id, to: to.id, quantity: '1' }],
      } })
      assert.equal(run.snapshot().commitments[commitment.id]?.phase, 'fulfilled')
      completed += 1
      delays.push(day - order.day)
      pending.shift()
    }
    if (day === options.days) break
    for (const employee of employees) {
      if (performance.now() - started >= options.durationMs) break
      const manager = managerFor(employee)
      const id = `order/${day}/${employee}`
      await decide(employee, `${id}/request`, { kind: 'interaction/request', id, assignee: manager,
        description: 'Deliver one inventory unit on the next simulated day', replyBy: null, completeBy: String(day + 2),
        fulfillment: { kind: 'transfer', from: `${manager}/stock`, to: `${employee}/stock`, quantity: '1' } })
      const request = Object.values(run.snapshot().interactions).find(value => value.id === id)!
      await decide(manager, `${id}/accept`, { kind: 'interaction/accept', id, expectedRevision: request.revision })
      pending.push({ id: request.id, employee, manager, day })
      issued += 1
    }
    sample()
    emit({ kind: 'progress', phase: 'days', day, issued, completed, pending: pending.length, handoffs, peakRssBytes })
  }
  const workMs = performance.now() - started
  const state: SimulationSnapshot = run.snapshot()
  assert.equal(Object.values(state.commitments).filter(value => value.phase === 'fulfilled').length, completed)
  assert.equal(Object.values(state.commitments).filter(value => value.phase === 'open').length, pending.length)
  assert.equal(Object.values(state.resources).reduce((sum, value) => sum + BigInt(value.quantity), 0n),
    BigInt(managers.length) * BigInt(options.operations))
  assert.equal(Object.values(state.resources).filter(value => employees.includes(value.owner))
    .reduce((sum, value) => sum + Number(value.quantity), 0), completed)
  assert.equal(decisions, issued * 2 + completed)
  assert.equal(policyCalls, decisions)
  assert.equal(modelCalls, 0); assert.equal(publications, 0); assert.equal(run.budgetUsage().tokens.used, 0)
  const checkpoint = simulationCheckpointRequestSchema.parse({ id: 'organization-cut', implementationVersion: 'organization-benchmark-1', maxDrainRounds: 4, maxAttempts: 3 })
  const checkpointStarted = performance.now()
  assert.equal((await connection.checkpoint(checkpoint)).status, 'completed')
  const checkpointMs = performance.now() - checkpointStarted
  const before: SimulationSnapshot = run.snapshot()
  const fingerprint = createHash('sha256').update(JSON.stringify(before)).digest('hex')
  const bytesBeforeClose = await benchmarkDiskBytes(root)
  await run.close()
  const restoreStarted = performance.now()
  const restored = await ctx.simulationTeams.restore({ ...selection, mode: 'open' }, { id: checkpoint.id, implementationVersion: checkpoint.implementationVersion, maxAttempts: 3 })
  run = restored.run
  const restoreMs = performance.now() - restoreStarted
  assert.equal(createHash('sha256').update(JSON.stringify(run.snapshot())).digest('hex'), fingerprint)
  assert.equal(run.population().chargedActors, 0)
  await run.close()
  await writeBenchmarkRecovery(root, { ...selection, mode: 'open' }, { id: checkpoint.id, implementationVersion: checkpoint.implementationVersion, maxAttempts: 3 }, fingerprint)
  sample()
  emit({ kind: 'latencies', phase: 'decision', milliseconds: latencies })
  emit({ kind: 'latencies', phase: 'fulfillment-delay-days', days: delays })
  emit({ kind: 'result', layer: 'deterministic-organization', recoveryMode: 'same-process-owner-services',
    completion: completed === options.operations ? 'target-complete' : 'time-budget', employees: employees.length,
    managers: managers.length, departments: departments.length, requestedDays: options.days, simulatedDays: Number(before.time),
    requested: options.operations, issued, completed, pending: pending.length, decisions, handoffs, retainedDebtors,
    policyCalls, modelCalls, publications, reportedTokens: 0, modelCost: 0, peakResidents, peakModels: 0,
    peakContextBytes, peakPending, setupMs, workMs, throughputPerSecond: completed * 1000 / workMs,
    phases: { decision: benchmarkLatencySummary(latencies, workMs) }, checkpointMs, restoreMs,
    peakRssBytes, diskBytes: await benchmarkDiskBytes(root), bytesBeforeClose, cpuMicros: process.cpuUsage(),
    replayEqual: true, canonicalSessionsPreserved: true, acceptedResponsibilitiesPreserved: true,
    stalled: before.stall ?? null, teamMessages: 0 })
} finally { await run?.close(); await ctx.fiber.dispose() }
