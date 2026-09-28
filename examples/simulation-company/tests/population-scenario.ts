/** Durable actor capacity through real controller startup, delayed cleanup and process recovery. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { simulationChangeSchema, simulationDecisionIdSchema, simulationEntityIdSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'
import type {} from '@clocky/clocky-simulation-local'

const ctx = await boot('simulation-population', process.argv[2]!)
const acceptanceIntervals: boolean[] = []
ctx.on('simulation/committed', (snapshot, tail, previousRevision) => {
  if (previousRevision === undefined) return
  for (const decision of Object.values(snapshot.decisions)) {
    if (decision.status !== 'accepted' || decision.closedAt === undefined || decision.closedAt <= previousRevision) continue
    const writer = snapshot.entities[decision.entityId]?.writer
    acceptanceIntervals.push(snapshot.revision === tail && decision.closedAt <= tail
      && decision.closedAt > decision.snapshotRevision && writer?.phase === 'active' && writer.epoch === decision.epoch)
  }
})
const recovering = process.env['SIMULATION_POPULATION_RECOVER'] === 'true'
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'population', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 2, maxResidentActors: 1, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8,
  maxDecisionsPerWindow: 2,
  maxOperationsPerDecision: 16, maxResourceQuantity: '10000', relationRules: [],
} }))
const release = Promise.withResolvers<undefined>()
const hold = async (stage: string) => {
  if (process.env['SIMULATION_POPULATION_CRASH'] !== stage) return
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
try {
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Use one resident slot', budgets: {} }, budgets: {} }, 'simulation/population')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/population')
  const a = simulationEntityIdSchema.parse('a')
  const b = simulationEntityIdSchema.parse('b')
  for (const id of [a, b]) {
    if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id,
      entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    await connection.ensureParticipant(id, { displayName: id, role: id, capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'unused' })
  }
  const provider = ctx.agentRuntimes.getProvider('in-process')
  assert.ok(provider)
  const start = provider.activate.bind(provider)
  let starts = 0
  provider.activate = async (request) => {
    if (!recovering) await hold('reserved')
    starts += 1
    return await start(request)
  }
  const activate = (id: typeof a) => connection.activate(id, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal })
  const charges: number[] = []
  if (!recovering) {
    const first = await activate(a)
    assert.ok(first.localAgent)
    await ctx.sessions.flush(first.localAgent.session)
    await assert.rejects(activate(b), /resident actor capacity/)
    assert.equal(starts, 1)
    charges.push(run.population().chargedActors)
    await hold('bound')
    const entered = Promise.withResolvers<undefined>()
    first.localAgent.ctx.effect(() => async () => { entered.resolve(undefined); await release.promise })
    const stopping = connection.hibernate(a)
    await entered.promise
    assert.equal(run.snapshot().entities[a]?.writer?.phase, 'revoked')
    const current = await ctx.teams.getTeam({ teamId: team.team.id })
    const binding = run.snapshot().entities[b]!.binding!
    await assert.rejects(ctx.teamActivations.activate({ ...binding, expectedCursor: current.team.cursor,
      provider: 'in-process', seed: { kind: 'fresh' }, agent: { preset: 'simulation', options: {} },
      signal: new AbortController().signal }), /resident actor capacity/)
    assert.equal(starts, 1)
    charges.push(run.population().chargedActors)
    await hold('revoked')
    release.resolve(undefined)
    await stopping
  } else {
    assert.equal(run.population().chargedActors, 1)
    await assert.rejects(activate(b), /resident actor capacity/)
    assert.equal(starts, 0)
    charges.push(run.population().chargedActors)
    assert.equal((await connection.ensureResident(a, { activation: { provider: 'in-process', seed: { kind: 'resume' },
      agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal }, evict: [] })).status, 'recovery-required')
    await connection.recover(a)
  }
  assert.equal(run.population().chargedActors, 0)
  const second = await activate(b)
  const target = { provider: 'in-process', seed: { kind: 'resume' as const },
    agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal }
  const beforePlacement = starts
  assert.equal((await connection.ensureResident(a, { activation: target, evict: [] })).status, 'capacity')
  await run.setPhase('running', run.snapshot().revision)
  const unfinished = simulationDecisionIdSchema.parse('unfinished')
  await connection.openDecision(b, unfinished)
  assert.equal((await connection.ensureResident(a, { activation: target, evict: [b] })).status, 'capacity')
  assert.equal(starts, beforePlacement)
  assert.equal(run.snapshot().entities[b]?.writer?.phase, 'active')
  await connection.cancelDecision(b, unfinished)
  const automatic = await connection.ensureResident(a, { activation: { provider: 'in-process',
    seed: { kind: run.snapshot().entities[a]?.writer?.activationId === undefined ? 'fresh' : 'resume' },
    agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal }, evict: [b] })
  assert.equal(automatic.status, 'resident')
  assert.equal(run.population().chargedActors, 1)
  const restored = await connection.ensureResident(b, { activation: { provider: 'in-process', seed: { kind: 'resume' },
    agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal }, evict: [a] })
  assert.equal(restored.status, 'resident')
  assert.equal(second.binding.sessionId, run.snapshot().entities[b]?.binding?.sessionId)
  await assert.rejects(run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'c', entityKind: 'person',
    cognition: 'none', profile: {} }), run.snapshot().revision), /entity capacity/)
  await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: a,
    entityRevision: run.snapshot().entities[a]!.revision, phase: 'terminated' }), run.snapshot().revision)
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'c', entityKind: 'person',
    cognition: 'none', profile: {} }), run.snapshot().revision)
  const beforeClose = run.population()
  assert.deepEqual(beforeClose, { entities: 2, chargedActors: 1 })
  await connection.hibernate(b)
  const resumed = await connection.resume(b, { provider: 'in-process', agent: { preset: 'simulation', options: {} },
    signal: new AbortController().signal })
  assert.equal(resumed.binding.sessionId, second.binding.sessionId)
  const acceptedId = simulationDecisionIdSchema.parse('accepted-before-retirement')
  await connection.openDecision(b, acceptedId)
  await connection.submitDecision(b, acceptedId, [])
  await connection.hibernate(b)
  assert.deepEqual(acceptanceIntervals, [true])
  assert.equal(run.snapshot().decisions[acceptedId]?.status, 'accepted')
  console.log(JSON.stringify({ charges, starts, beforeClose, afterClose: run.population(),
    retainedEntities: Object.keys(run.snapshot().entities).length, canonicalSessionPreserved: true,
    acceptedWriterIntervals: acceptanceIntervals.length }))
} finally { release.resolve(undefined); await run.close(); await ctx.fiber.dispose() }
