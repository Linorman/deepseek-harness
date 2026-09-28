import { createUserMessage, MessageId } from '@clocky/clocky-llm'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { simulationTemp } from '../../simulation-local/tests/temp.ts'
import { readFile, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { createContext } from './harness.ts'
import { SessionId } from '@clocky/clocky-session'
import type { TeamHumanActorProof, TeamHumanActorScope } from '@clocky/clocky-team'
import { simulationChangeSchema, simulationEntityIdSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup(attach = true, maxContextBytes = 65536, maxCoordinationRounds = 16,
  decisionTimeoutMs = 60000, maxTokensPerInterval = 1000000, maxResidentActors = 16) {
  const root = await simulationTemp('team')
  const { ctx, runtimeFiber, serviceFiber } = await createContext(root, 'sqlite', maxContextBytes, maxCoordinationRounds)
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'company', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors, maxTokensPerInterval, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceQuantity: '1000000000000000000000000', relationRules: [],
  } })
  const run = await ctx.simulations.open(selection)
  cleanups.push(async () => {
    await run.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
  })
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Company', budgets: {} },
    rules: { activationLifecycleOwner: 'simulation/company', simulationRunId: 'company' }, budgets: {} })
  const teamId = team.team.id
  const participant = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: team.team.cursor,
    kind: 'local-agent', displayName: 'Buyer', role: 'buyer', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    const state = await ctx.teams.getTeam({ teamId })
    await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id, expectedCursor: state.team.cursor, phase })
  }
  const entityId = simulationEntityIdSchema.parse('buyer')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entityId, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
  const connection = attach ? await ctx.simulationTeams.attach(run, teamId, 'simulation/company') : undefined
  return { ctx, run, teamId, participant, entityId, connection, serviceFiber, runtimeFiber }
}
function writer(run: SimulationRun) { return Object.values(run.snapshot().entities)[0]?.writer }
const placement = () => ({ provider: 'in-process', seed: { kind: 'fresh' as const }, agent: { options: {} }, signal: new AbortController().signal })

it('denies a model attempt before adapter dispatch when its token reservation cannot fit', async () => {
  const { ctx, run, connection, entityId, participant } = await setup(true, 65536, 16, 60000, 0)
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const model = new MockAdapter([textResponse('Must not run')])
  ctx.llm.registerAdapter(['token-limit'], model)
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'token-limit', model: 'fixture' } } })
  await run.setPhase('running', run.snapshot().revision)
  await expect(connection.executeDecision(entityId, simulationDecisionIdSchema.parse('limited'), contextRequest()))
    .rejects.toThrow(/without submitting/)
  expect(model.requests).toHaveLength(0)
  expect(run.snapshot().tokenReservations).toBeUndefined()
  expect(run.snapshot().stall).toMatchObject({ code: 'SIM_BUDGET_LIMIT', budget: 'tokens', used: 0 })
  expect(ctx.simulationTeams.modelUsage().active).toBe(0)
})

it('releases token capacity when cancellation is proven to precede downstream model dispatch', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const model = new MockAdapter([textResponse('Must not run')])
  ctx.llm.registerAdapter(['cancel-before-model'], model)
  let cancel = () => {}
  const reserveWriter = run.reserveWriter.bind(run)
  vi.spyOn(run, 'reserveWriter').mockImplementation(async (...args) => {
    const writer = await reserveWriter(...args)
    const reserveTokens = writer.reserveModelTokens.bind(writer)
    writer.reserveModelTokens = async (...request) => {
      const reservation = await reserveTokens(...request)
      cancel()
      return reservation
    }
    return writer
  })
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, { ...placement(), agent: {
    options: { provider: 'cancel-before-model', model: 'fixture' },
  } })
  if (activation.localAgent === undefined) throw new Error('fixture actor missing')
  const actor = activation.localAgent
  cancel = () => { actor.cancel({ kind: 'hook', reason: 'Cancel before provider dispatch' }) }
  await run.setPhase('running', run.snapshot().revision)
  await expect(connection.executeDecision(entityId, simulationDecisionIdSchema.parse('cancelled'), contextRequest()))
    .rejects.toThrow(/without submitting/)
  expect(model.requests).toHaveLength(0)
  expect(Object.values(run.snapshot().tokenReservations ?? {}).map(value => value.status)).toEqual(['not-dispatched'])
  expect(run.budgetUsage().tokens.used).toBe(0)
})

it('runs a versioned deterministic policy once and reuses its retained output after an acceptance write failure', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationPolicyRefSchema, simulationWakeRequestSchema, simTimeSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'no-work', version: '1' })
  const decide = vi.fn((_view: Readonly<import('@clocky/clocky-session').SimulationContextViewEventData>) => [])
  const remove = ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide })
  expect(() => ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide })).toThrow(/already registered/)
  const model = new MockAdapter([textResponse('Must not run')])
  ctx.llm.registerAdapter(['deterministic-only'], model)
  await connection.bind(entityId, participant.id)
  const actor = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'deterministic-only', model: 'fixture' } } })
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('deterministic')
  const wake = simulationWakeRequestSchema.parse({ id: 'deterministic-wake', entityId, time: '0', reason: 'Run policy' })
  await run.scheduleWake(wake, run.snapshot().revision)
  await run.drive({ until: simTimeSchema.parse('0') })
  await expect(connection.executeDeterministicDecision(entityId, id, contextRequest(), { ...policy, version: '2' }, wake.id))
    .rejects.toThrow(/not registered/)
  expect(run.snapshot().decisions[id]).toBeUndefined()
  const stream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const append = stream.append.bind(stream)
  let fail = true
  vi.spyOn(stream, 'append').mockImplementation(async (cursor, values) => {
    if (fail && JSON.stringify(values).includes('"kind":"decision/accepted"')) { fail = false; throw new Error('acceptance failed') }
    return await append(cursor, values)
  })
  await expect(connection.executeDeterministicDecision(entityId, id, contextRequest(), policy, wake.id)).rejects.toThrow('acceptance failed')
  expect(run.snapshot().decisions[id]?.deterministic?.proposals).toEqual([])
  expect(decide).toHaveBeenCalledTimes(1)
  expect(Object.isFrozen(decide.mock.calls[0]?.[0])).toBe(true)
  await expect(connection.dispatchDecision(entityId, id)).rejects.toThrow(/cannot dispatch model input/)
  remove()
  const completed = await connection.executeDeterministicDecision(entityId, id, contextRequest(), policy, wake.id)
  expect(completed.status).toBe('accepted')
  expect(run.snapshot().wakes[wake.id]?.status).toBe('completed')
  expect(await connection.executeDeterministicDecision(entityId, id, contextRequest(), policy, wake.id)).toEqual(completed)
  expect(decide).toHaveBeenCalledTimes(1)
  expect(model.requests).toHaveLength(0)
  expect(actor.localAgent?.session.events.some(event => event.type === 'assistant/chunk')).toBe(false)
  expect(run.budgetUsage().tokens.used).toBe(0)
})

it('drains admitted deterministic output on close without accepting a late proposal', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'closing', version: '1' })
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: () => [] })
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
  const stream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const append = stream.append.bind(stream)
  vi.spyOn(stream, 'append').mockImplementation(async (cursor, values) => {
    if (JSON.stringify(values).includes('"kind":"deterministic/result"')) { entered.resolve(undefined); await release.promise }
    return await append(cursor, values)
  })
  const id = simulationDecisionIdSchema.parse('closing')
  const work = connection.executeDeterministicDecision(entityId, id, contextRequest(), policy)
  const rejected = expect(work).rejects.toThrow(/closed/)
  await entered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  await new Promise(resolve => setImmediate(resolve))
  expect(closed).toBe(false)
  release.resolve(undefined)
  await Promise.all([closing, rejected])
  expect(run.snapshot().decisions[id]).toMatchObject({ status: 'cancelled', deterministic: { proposals: [] } })
  expect(run.snapshot().operations).toEqual({})
  expect(run.population().chargedActors).toBe(0)
})

it('hibernates an idle actor and resumes its canonical Session without inference', async () => {
  const { run, connection, entityId, participant, ctx } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  const first = await connection.activate(entityId, placement())
  await connection.hibernate(entityId)
  await connection.hibernate(entityId)
  expect(run.population().chargedActors).toBe(0)
  expect(ctx.agents.get(first.binding.sessionId)).toBeUndefined()
  const { seed: _seed, ...request } = placement()
  const second = await connection.resume(entityId, request)
  expect(second.binding.sessionId).toBe(first.binding.sessionId)
  expect(second.binding.activation.id).not.toBe(first.binding.activation.id)
  expect(second.localAgent?.status).toBe('idle')
  expect(run.population().chargedActors).toBe(1)
})

it('retains hibernation ownership when final Session flush fails and retries quiescence', async () => {
  const { run, connection, entityId, participant, ctx } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  const first = await connection.activate(entityId, placement())
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const failure = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
    if (run.snapshot().entities[entityId]?.writer?.phase === 'revoked') return false
    return await flush(session)
  })
  await expect(connection.hibernate(entityId)).rejects.toThrow(/durable Session/)
  expect(run.population().chargedActors).toBe(1)
  expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('revoked')
  const { seed: _seed, ...request } = placement()
  expect(() => connection.resume(entityId, request)).toThrow(/hibernation/)
  failure.mockRestore()
  await connection.hibernate(entityId)
  expect(run.population().chargedActors).toBe(0)
  expect((await connection.resume(entityId, request)).binding.sessionId).toBe(first.binding.sessionId)
})

it('refuses hibernation while a decision is still unsubmitted', async () => {
  const { run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  await connection.openDecision(entityId, simulationDecisionIdSchema.parse('unfinished'))
  await expect(connection.hibernate(entityId)).rejects.toThrow(/settled decisions/)
  expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('active')
})

it('expires an unsubmitted idle turn without making another model request', async () => {
  const { ctx, run, connection, entityId, participant } = await setup(true, 65536, 16, 500)
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const id = simulationDecisionIdSchema.parse('idle-deadline')
  const model = new MockAdapter([textResponse('No proposal')])
  ctx.llm.registerAdapter(['idle-deadline'], model)
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'idle-deadline', model: 'fixture' } } })
  await run.setPhase('running', run.snapshot().revision)
  await expect(connection.executeDecision(entityId, id, contextRequest())).rejects.toThrow(/without submitting/)
  await expect.poll(() => run.snapshot().decisions[id]?.cancellation, { timeout: 1500 }).toBe('timeout')
  expect(run.snapshot().decisions[id]).toMatchObject({ status: 'cancelled', cancellation: 'timeout' })
  expect(model.requests).toHaveLength(1)
})

it('rejects a completed model turn that did not submit its Simulation decision', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const model = new MockAdapter([textResponse('I have finished.')])
  ctx.llm.registerAdapter(['unsubmitted'], model)
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'unsubmitted', model: 'fixture' } } })
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('unsubmitted')
  await expect(connection.executeDecision(entityId, id, contextRequest())).rejects.toThrow(/without submitting/)
  expect(run.snapshot().decisions[id]?.status).toBe('open')
  expect(model.requests).toHaveLength(1)
})

it('rejects decision context overflow before requesting inference', async () => {
  const { ctx, run, connection, entityId, participant } = await setup(true, 1)
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const model = new MockAdapter([textResponse('Must not run')])
  ctx.llm.registerAdapter(['overflow'], model)
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'overflow', model: 'fixture' } } })
  await run.setPhase('running', run.snapshot().revision)
  await expect(connection.executeDecision(entityId, simulationDecisionIdSchema.parse('overflow'), contextRequest())).rejects.toThrow(/exceeds/)
  expect(model.requests).toHaveLength(0)
  expect(run.snapshot().phase).toBe('stalled')
})

describe('controller-enforced Simulation writers', () => {
  it('rejects direct controller startup when the durable owner is absent', async () => {
    const { ctx, teamId, participant } = await setup(false)
    const activate = vi.spyOn(ctx.agentRuntimes, 'activate')
    const state = await ctx.teams.getTeam({ teamId })
    await expect(ctx.teamActivations.activate({ ...placement(), teamId, participantId: participant.id,
      sessionId: SessionId('unbound'), expectedCursor: state.team.cursor })).rejects.toThrow(/lifecycle owner.*unavailable/)
    expect(activate).not.toHaveBeenCalled()
    expect((await ctx.teams.getTeam({ teamId })).participants[0]?.activationReservation).toBeUndefined()
  })

  it('binds once, intercepts direct activation, revokes before disposal and advances the next epoch', async () => {
    const { ctx, run, connection, entityId, participant, teamId } = await setup()
    if (connection === undefined) throw new Error('fixture connection missing')
    const binding = await connection.bind(entityId, participant.id)
    expect(await connection.bind(entityId, participant.id)).toEqual(binding)
    const state = await ctx.teams.getTeam({ teamId })
    const lease = await ctx.teamActivations.activate({ ...placement(), ...binding, expectedCursor: state.team.cursor })
    expect(writer(run)).toMatchObject({ epoch: '1', phase: 'active', activationId: lease.binding.activation.id,
      reservationId: lease.binding.reservationId })
    const observed: unknown[] = []
    lease.localAgent?.ctx.effect(() => () => { observed.push(writer(run)?.phase) })
    await lease.dispose()
    expect(observed).toEqual(['revoked'])
    expect(writer(run)?.phase).toBe('released')
    const second = await connection.activate(entityId, { ...placement(), seed: { kind: 'resume' } })
    expect(second.binding.sessionId).toBe(binding.sessionId)
    expect(writer(run)).toMatchObject({ epoch: '2', phase: 'active' })
    await run.close()
    expect(writer(run)?.phase).toBe('released')
    await expect(connection.activate(entityId, placement())).rejects.toThrow(/closed/)
  })

  it('rejects a caller-selected Session before starting a runtime and settles its startup reservation', async () => {
    const { ctx, run, connection, entityId, participant, teamId } = await setup()
    if (connection === undefined) throw new Error('fixture connection missing')
    await connection.bind(entityId, participant.id)
    const state = await ctx.teams.getTeam({ teamId })
    const activate = vi.spyOn(ctx.agentRuntimes, 'activate')
    await expect(ctx.teamActivations.activate({ ...placement(), teamId, participantId: participant.id,
      sessionId: SessionId('wrong'), expectedCursor: state.team.cursor })).rejects.toThrow(/exact Simulation entity binding/)
    expect(activate).not.toHaveBeenCalled()
    expect(writer(run)).toBeUndefined()
    const latest = await ctx.teams.getTeam({ teamId })
    expect(latest.participants[0]?.activationReservation?.releasedAt).toEqual(expect.any(Number))
  })

  it('drains a live writer when the Simulation Team service is unloaded', async () => {
    const { run, connection, entityId, participant, serviceFiber } = await setup()
    if (connection === undefined) throw new Error('fixture connection missing')
    await connection.bind(entityId, participant.id)
    await connection.activate(entityId, placement())
    await serviceFiber.dispose()
    expect(writer(run)?.phase).toBe('released')
    await expect(connection.bind(entityId, participant.id)).rejects.toThrow(/closed/)
  })
})

it('pins the validated in-process provider across durable reservation and rejects a same-name replacement', async () => {
  const { ctx, run, connection, entityId, participant, runtimeFiber, teamId } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  const reserve = run.reserveWriter.bind(run)
  const externalStart = vi.fn(async () => { throw new Error('external start must not run') })
  vi.spyOn(run, 'reserveWriter').mockImplementation(async (...args) => {
    const lease = await reserve(...args)
    await runtimeFiber.dispose()
    ctx.agentRuntimes.registerProvider({ name: 'in-process', terminationMode: 'owned-process', activate: externalStart })
    return lease
  })
  await expect(connection.activate(entityId, placement())).rejects.toMatchObject({ code: 'AGENT_RUNTIME_PROVIDER_CHANGED' })
  expect(externalStart).not.toHaveBeenCalled()
  expect(writer(run)?.phase).toBe('released')
  expect((await ctx.teams.getTeam({ teamId })).participants[0]?.activationReservation?.releasedAt).toEqual(expect.any(Number))
})

it('retains the runtime when domain revocation fails and retries without releasing its writer early', async () => {
  const { ctx, run, connection, entityId, participant, teamId } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  const reserve = run.reserveWriter.bind(run)
  vi.spyOn(run, 'reserveWriter').mockImplementation(async (...args) => {
    const lease = await reserve(...args)
    return { ...lease, revoke: vi.fn().mockRejectedValueOnce(new Error('journal failed')).mockImplementation(() => lease.revoke()) }
  })
  const active = await connection.activate(entityId, placement())
  let disposed = false
  active.localAgent?.ctx.effect(() => () => { disposed = true })
  await expect(active.dispose()).rejects.toThrow('journal failed')
  expect(disposed).toBe(false)
  expect(writer(run)?.phase).toBe('active')
  expect((await ctx.teams.getTeam({ teamId })).activations[0]?.quiescedAt).toBeUndefined()
  await active.dispose()
  expect(disposed).toBe(true)
  expect(writer(run)?.phase).toBe('released')
})

it('rejects missing bindings, external placement and mismatched durable owner selection', async () => {
  const { ctx, run, connection, entityId, participant, teamId } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await expect(ctx.simulationTeams.attach(run, teamId, 'wrong')).rejects.toThrow(/exact durable/)
  await expect(ctx.simulationTeams.attach(run, teamId, 'simulation/company')).rejects.toThrow(/already attached/)
  await expect(connection.activate(entityId, placement())).rejects.toThrow(/no cognition binding/)
  await expect(connection.recover(entityId)).rejects.toThrow(/no cognition binding/)
  await expect(connection.bind(simulationEntityIdSchema.parse('missing'), participant.id)).rejects.toThrow(/does not exist/)
  const { participantIdSchema } = await import('@clocky/clocky-team')
  await expect(connection.bind(entityId, participantIdSchema.parse('missing'))).rejects.toThrow(/fresh active local/)
  await connection.bind(entityId, participant.id)
  await expect(connection.bind(entityId, participantIdSchema.parse('other'))).rejects.toThrow(/permanent/)
  await expect(connection.recover(entityId)).rejects.toThrow(/no durable activation/)
  await expect(connection.activate(entityId, { ...placement(), provider: 'missing' })).rejects.toThrow(/actual in-process/)
  const externalStart = vi.fn(() => Promise.reject(new Error('must not start')))
  ctx.agentRuntimes.registerProvider({ name: 'external', terminationMode: 'owned-process', activate: externalStart })
  await expect(connection.activate(entityId, { ...placement(), provider: 'external' })).rejects.toThrow(/actual in-process/)
  expect(externalStart).not.toHaveBeenCalled()
})

it('keeps retirement retryable after service unload encounters a journal failure', async () => {
  const { ctx, run, connection, entityId, participant, serviceFiber } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  const reserve = run.reserveWriter.bind(run)
  vi.spyOn(run, 'reserveWriter').mockImplementation(async (...args) => {
    const receipt = await reserve(...args)
    return { ...receipt, revoke: vi.fn().mockRejectedValueOnce(new Error('journal failed')).mockImplementation(() => receipt.revoke()) }
  })
  await connection.activate(entityId, placement())
  const service = ctx.simulationTeams
  await serviceFiber.dispose()
  expect(writer(run)?.phase).toBe('active')
  await expect(service.attach(run, participant.teamId, 'simulation/company')).rejects.toThrow(/closed/)
  await run.close()
  expect(writer(run)?.phase).toBe('released')
})

it('does not register a late attachment after its service closes during a Team read', async () => {
  const { ctx, run, teamId, serviceFiber } = await setup(false)
  const state = await ctx.teams.getTeam({ teamId })
  const pending = Promise.withResolvers<typeof state>()
  vi.spyOn(ctx.teams, 'getTeam').mockReturnValueOnce(pending.promise)
  const attaching = ctx.simulationTeams.attach(run, teamId, 'simulation/company')
  const rejected = expect(attaching).rejects.toThrow(/closed/)
  await serviceFiber.dispose()
  pending.resolve(state)
  await rejected
})

it('reconciles an already-quiescent epoch without claiming another live runtime was fenced', async () => {
  const { ctx, run, connection, entityId, participant, teamId } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, placement())
  await expect(connection.recover(entityId)).rejects.toThrow(/conflicts with a controller-owned/)
  const state = await ctx.teams.getTeam({ teamId })
  const { activationReservationIdSchema } = await import('@clocky/clocky-team')
  await expect(ctx.teamActivations.recoverCoordinatedReservation({ teamId, participantId: participant.id,
    reservationId: activationReservationIdSchema.parse('wrong') })).rejects.toThrow(/exact unpublished/)
  if (lease.binding.reservationId === undefined) throw new Error('fixture reservation missing')
  await expect(ctx.teamActivations.recoverCoordinatedReservation({ teamId, participantId: participant.id,
    reservationId: lease.binding.reservationId })).rejects.toThrow(/exact unpublished/)
  await lease.dispose()
  const revision = run.snapshot().revision
  await connection.recover(entityId)
  expect(run.snapshot().revision).toBe(revision)
  expect((await ctx.teams.getTeam({ teamId })).activations).toHaveLength(state.activations.length)
})

it('validates controller observations against the actual local Agent and rejects foreign recovery inputs', async () => {
  const { ctx, run, teamId, entityId, participant } = await setup(false)
  const registered = vi.spyOn(ctx.teamActivations, 'registerLifecycleOwner')
  const connection = await ctx.simulationTeams.attach(run, teamId, 'simulation/company')
  const owner = registered.mock.calls[0]?.[0]
  if (owner === undefined) throw new Error('fixture owner missing')
  const reserved = vi.spyOn(owner, 'reserve')
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, placement())
  const returned = reserved.mock.results[0]
  if (returned?.type !== 'return') throw new Error('fixture reservation did not return')
  const receipt = await returned.value
  if (receipt === undefined || lease.localAgent === undefined || lease.binding.reservationId === undefined) throw new Error('fixture receipt missing')
  await expect(receipt.bind(lease.binding, undefined)).rejects.toThrow(/exact controller-owned local Agent/)
  await expect(receipt.bind({ ...lease.binding, sessionId: SessionId('foreign') }, lease.localAgent)).rejects.toThrow(/exact controller-owned/)
  const { teamIdSchema, participantIdSchema } = await import('@clocky/clocky-team')
  const foreign = { ...lease.binding, activation: { ...lease.binding.activation, teamId: teamIdSchema.parse('foreign') } }
  await expect(receipt.bind(foreign, lease.localAgent)).rejects.toThrow(/exact controller-owned/)
  await expect(receipt.bind({ ...lease.binding, activation: { ...lease.binding.activation,
    participantId: participantIdSchema.parse('foreign') } }, lease.localAgent)).rejects.toThrow(/exact controller-owned/)
  await expect(owner.recover(foreign)).rejects.toThrow(/external activation recovery/)
  await expect(owner.recover({ ...lease.binding, recovery: {
    kind: 'sdk-local-cold-replace', version: 1, runtimeProvider: 'in-process', profile: 'external',
    agent: { provider: 'mock', model: 'mock' }, process: { hostId: 'external', pid: 1, started: 'external' },
  } })).rejects.toThrow(/external activation recovery/)
  const legacy = { ...lease.binding }
  Reflect.deleteProperty(legacy, 'reservationId')
  await expect(owner.recover(legacy)).rejects.toThrow(/no durable startup reservation/)
  const reservation = { teamId: foreign.activation.teamId, participantId: participant.id, sessionId: lease.binding.sessionId,
    provider: 'in-process', expectedCursor: 0, reservationId: lease.binding.reservationId }
  await expect(owner.recoverReservation(reservation)).rejects.toThrow(/another Team/)
  await expect(owner.reserve({ ...placement(), ...reservation }, reservation)).rejects.toThrow(/another Team/)
})

it('rejects a second retirement owner without leaking its controller registration', async () => {
  const { ctx, run, teamId } = await setup(false)
  const retire = run.onClose(() => Promise.resolve())
  await expect(ctx.simulationTeams.attach(run, teamId, 'simulation/company')).rejects.toThrow(/retirement owner/)
  retire()
  const connection = await ctx.simulationTeams.attach(run, teamId, 'simulation/company')
  await connection.close()
})

it('rejects forked history through a direct controller call before materializing the runtime', async () => {
  const { ctx, run, connection, teamId, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const binding = await connection.bind(entityId, participant.id)
  const state = await ctx.teams.getTeam({ teamId })
  const activate = vi.spyOn(ctx.agentRuntimes, 'activate')
  await expect(ctx.teamActivations.activate({ ...placement(), ...binding, expectedCursor: state.team.cursor,
    seed: { kind: 'fork', sourceSessionId: SessionId('other-person'), events: [] } })).rejects.toThrow(/forked Session/)
  expect(activate).not.toHaveBeenCalled()
  expect(writer(run)).toBeUndefined()
})

it('binds a fresh second participant while rejecting reuse of an activated participant', async () => {
  const { ctx, run, connection, teamId, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  const secondId = simulationEntityIdSchema.parse('manager')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: secondId, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
  await expect(connection.bind(secondId, participant.id)).rejects.toThrow(/fresh active local/)
  const state = await ctx.teams.getTeam({ teamId })
  const second = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: state.team.cursor,
    kind: 'local-agent', displayName: 'Manager', role: 'manager', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    const latest = await ctx.teams.getTeam({ teamId })
    await transitionBootstrapParticipant(ctx, { teamId, participantId: second.id, expectedCursor: latest.team.cursor, phase })
  }
  const binding = await connection.bind(secondId, second.id)
  expect(binding.participantId).toBe(second.id)
})

it('rejects attaching an already-bound run to another canonical Team', async () => {
  const { ctx, run, teamId, entityId } = await setup(false)
  const other = await createTestRootTeam(ctx, { goal: { objective: 'Other', budgets: {} },
    rules: { activationLifecycleOwner: 'other-owner', simulationRunId: 'company' }, budgets: {} })
  const participant = await inviteBootstrapParticipant(ctx, { teamId: other.team.id, expectedCursor: other.team.cursor,
    kind: 'local-agent', displayName: 'Other', role: 'worker', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    const state = await ctx.teams.getTeam({ teamId: other.team.id })
    await transitionBootstrapParticipant(ctx, { teamId: other.team.id, participantId: participant.id,
      expectedCursor: state.team.cursor, phase })
  }
  const connection = await ctx.simulationTeams.attach(run, other.team.id, 'other-owner')
  await connection.bind(entityId, participant.id)
  await connection.close()
  await expect(ctx.simulationTeams.attach(run, teamId, 'simulation/company')).rejects.toThrow(/another canonical Team/)
})

it('checks current participant authority inside decision admission and preserves an unaccepted slot', async () => {
  const { ctx, run, connection, teamId, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const id = simulationDecisionIdSchema.parse('before-removal')
  await connection.openDecision(entityId, id)
  const before = await ctx.teams.getTeam({ teamId })
  const human = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: before.team.cursor,
    kind: 'human', displayName: 'Owner', role: 'human', capabilities: [], owner: { kind: 'system' } })
  for (const phase of ['provisioning', 'active'] as const) {
    const state = await ctx.teams.getTeam({ teamId })
    await transitionBootstrapParticipant(ctx, { teamId, participantId: human.id, expectedCursor: state.team.cursor, phase })
  }
  const { fingerprintTeamHumanActorPayload, jsonObjectSchema } = await import('@clocky/clocky-team')
  const state = await ctx.teams.getTeam({ teamId })
  const input = { teamId, participantId: participant.id, expectedCursor: state.team.cursor, phase: 'left' as const }
  const actor = {} as TeamHumanActorProof
  const fence = { kind: 'cursor' as const, cursor: state.team.cursor }
  const scope: TeamHumanActorScope = { teamId, participantId: human.id, operation: 'close', fence,
    payloadFingerprint: fingerprintTeamHumanActorPayload({ teamId, operation: 'close', fence, payload: jsonObjectSchema.parse(input) }) }
  const unregister = ctx.teams.registerHumanActorProofSource({ name: 'simulation-human-test',
    resolveHumanActorProof: value => value === actor ? scope : undefined })
  try { await ctx.teams.transitionParticipantPhase({ actor, ...input }) }
  finally { unregister() }
  await expect(connection.submitDecision(entityId, id, [])).rejects.toThrow(/authority is no longer active/)
  expect(run.snapshot().decisions[id]?.status).toBe('open')
  await lease.dispose()
  expect(run.snapshot().decisions[id]?.status).toBe('cancelled')
})

it('flushes the exact prepared context before inference and replaces only the previous view', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  const agent = lease.localAgent
  if (agent === undefined) throw new Error('fixture local Agent missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await run.setPhase('running', run.snapshot().revision)
  for (const name of ['first', 'second']) {
    const id = simulationDecisionIdSchema.parse(name)
    await connection.openDecision(entityId, id)
    const prepared = await connection.prepareContext(entityId, id, contextRequest())
    if (prepared.status !== 'prepared') throw new Error('fixture context overflow')
    expect(await connection.prepareContext(entityId, id, contextRequest())).toEqual(prepared)
    const flush = vi.spyOn(ctx.sessions, 'flush')
    await connection.dispatchDecision(entityId, id)
    await agent.whenIdle()
    expect(flush).toHaveBeenCalledWith(agent.session)
    flush.mockRestore()
    const request = adapter.requests.at(-1)
    expect(request?.messages.filter(message => message.source.kind === 'simulation-context-view')).toHaveLength(1)
    expect(request?.messages.find(message => message.source.kind === 'simulation-context-view')?.content)
      .toEqual(prepared.view.content.flatMap(section => section.blocks))
    const persisted = await ctx.sessionPersistence.load(agent.session.id)
    expect(persisted?.events.filter(event => event.type === 'simulation/context-view').at(-1)?.data).toEqual(prepared.view)
    await connection.submitDecision(entityId, id, [])
    const consumed = agent.session.events.find(event => event.type === 'user/message' && event.data.id === MessageId(prepared.view.inputId))
    if (consumed?.type !== 'user/message') throw new Error('fixture consumed input missing')
    agent.session.append('user/message', consumed.data, {
      surfaceOp: { op: 'replace', start: consumed.seq, end: consumed.seq }, sourceEventSeqs: [consumed.seq],
    })
    expect(await connection.dispatchDecision(entityId, id)).toMatchObject({ status: 'consumed', inputId: prepared.view.inputId })
  }
  expect(adapter.requests).toHaveLength(2)
  expect(agent.session.deriveMessages().filter(message => message.source.kind === 'simulation-context-view')).toHaveLength(1)
  expect(agent.session.deriveMessages().some(message => message.content.some(block => block.type === 'text' && block.text === 'first'))).toBe(true)
})

it('blocks model IO without prepared context and after failed context flush', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const adapter = new MockAdapter([textResponse('unexpected')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  const agent = lease.localAgent
  if (agent === undefined) throw new Error('fixture local Agent missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('flush-failure')
  await connection.openDecision(entityId, id)
  agent.send(createUserMessage({ content: [{ type: 'text', text: 'unprepared' }], source: { kind: 'user' } }), 'next-turn', true)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(0)
  await connection.prepareContext(entityId, id, contextRequest())
  const failure = vi.spyOn(ctx.sessions, 'flush').mockRejectedValueOnce(new Error('disk unavailable'))
  agent.send(createUserMessage({ content: [{ type: 'text', text: 'not durable' }], source: { kind: 'user' } }), 'next-turn', true)
  await agent.whenIdle()
  failure.mockRestore()
  expect(adapter.requests).toHaveLength(0)
  expect(agent.session.events.filter(event => event.type === 'simulation/context-view')).toHaveLength(1)
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(agent.session.events.filter(event => event.type === 'simulation/context-view')).toHaveLength(1)
})

it('uses the deployment budget and prevents inference after required context overflow', async () => {
  const { ctx, run, connection, entityId, participant } = await setup(true, 1)
  if (connection === undefined) throw new Error('fixture connection missing')
  const adapter = new MockAdapter([textResponse('unexpected')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  const agent = lease.localAgent
  if (agent === undefined) throw new Error('fixture local Agent missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('budget-overflow')
  await connection.openDecision(entityId, id)
  expect(await connection.prepareContext(entityId, id, contextRequest(999999))).toMatchObject({ status: 'overflow', maxBytes: 1 })
  agent.send(createUserMessage({ content: [{ type: 'text', text: 'overflow' }], source: { kind: 'user' } }), 'next-turn', true)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(0)
  expect(agent.session.events.some(event => event.type === 'simulation/context-view')).toBe(false)
})

it.each([false, true])('checkpoints consumed input and request before dispatch (pause during flush: %s)', async (pause) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const adapter = new MockAdapter([textResponse('durable request')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  const agent = lease.localAgent
  if (agent === undefined) throw new Error('fixture local Agent missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('dispatch-barrier')
  await connection.openDecision(entityId, id)
  await connection.prepareContext(entityId, id, contextRequest())
  const barrier = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const checkpoint = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
    const result = await flush(session)
    if (session.events.some(event => event.type === 'request/header')) {
      try {
        const location = ctx.sessionPersistence.locate(session.header)
        if (location === undefined) throw new Error('fixture Session path missing')
        const records = (await readFile(location.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { type: string })
        expect(records.some(event => event.type === 'request/header')).toBe(true)
        expect(records.some(event => event.type === 'user/message')).toBe(true)
        barrier.resolve(undefined)
      } catch (error) { barrier.reject(error); throw error }
      await release.promise
    }
    return result
  })
  try {
    await connection.dispatchDecision(entityId, id)
    await barrier.promise
    expect(adapter.requests).toHaveLength(0)
    if (pause) await run.setPhase('paused', run.snapshot().revision)
    release.resolve(undefined)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(pause ? 0 : 1)
  } finally {
    release.resolve(undefined)
    checkpoint.mockRestore()
  }
})

it('does not construct the downstream model stream when request checkpointing fails', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const adapter = new MockAdapter([textResponse('unexpected')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  const agent = lease.localAgent
  if (agent === undefined) throw new Error('fixture local Agent missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('dispatch-failure')
  await connection.openDecision(entityId, id)
  await connection.prepareContext(entityId, id, contextRequest())
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const checkpoint = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
    if (session.events.some(event => event.type === 'request/header')) throw new Error('Request checkpoint unavailable')
    return await flush(session)
  })
  try {
    await connection.dispatchDecision(entityId, id)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'request/header')).toBe(true)
  } finally { checkpoint.mockRestore() }
})

it.each(['unlogged', 'duplicate'])('rejects an inconsistent model conversation: %s', async (mode) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const adapter = new MockAdapter([textResponse('unexpected')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  const agent = lease.localAgent
  if (agent === undefined) throw new Error('fixture local Agent missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('unlogged-rewrite')
  await connection.openDecision(entityId, id)
  const prepared = await connection.prepareContext(entityId, id, contextRequest())
  if (prepared.status !== 'prepared') throw new Error('fixture context overflow')
  ctx.on('llm/stream', (options, next) => {
    if (mode === 'unlogged') options.messages = []
    else {
      agent.session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
      options.messages = agent.session.deriveMessages()
    }
    return next()
  }, { prepend: true })
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(0)
})

it('holds auxiliary model capacity until cancelled provider cleanup and retains partial usage', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { CompactionId, recordCompactionRequest } = await import('@clocky/clocky-compaction')
  const adapter = new MockAdapter([])
  const entered = Promise.withResolvers<undefined>()
  const cleanup = Promise.withResolvers<undefined>()
  const aborted = Promise.withResolvers<undefined>()
  vi.spyOn(adapter, 'stream').mockImplementation(async function* (options) {
    yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 2 } }
    const signal = options.signal
    if (signal === undefined) throw new Error('fixture cancellation missing')
    const abort = new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    entered.resolve(undefined)
    await abort
    aborted.resolve(undefined)
    await cleanup.promise
    signal.throwIfAborted()
  })
  ctx.llm.registerAdapter(['mock'], adapter)
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  const actor = activation.localAgent
  if (actor === undefined) throw new Error('fixture actor missing')
  const cancel = new AbortController()
  const compactionId = CompactionId('aux-cancel')
  actor.session.append('compaction/start', { compactionId, turn: null })
  const options = recordCompactionRequest(actor.session, { sessionId: actor.session.id, purpose: 'compaction',
    signal: cancel.signal, provider: 'mock', model: 'mock', messages: [createUserMessage({
      content: [{ type: 'text', text: 'source' }], source: { kind: 'user' },
    })] })
  const work = (async () => { for await (const _chunk of ctx.llm.stream(options)) { /* Consume partial usage. */ } })()
  await entered.promise
  cancel.abort(new Error('cancel auxiliary'))
  await aborted.promise
  expect(ctx.simulationTeams.modelUsage().active).toBe(1)
  expect(Object.values(run.snapshot().tokenReservations ?? {})[0]?.status).toBe('reserved')
  cleanup.resolve(undefined)
  await work
  actor.session.append('compaction/end', { compactionId, turn: null, error: 'cancel auxiliary' })
  expect(ctx.simulationTeams.modelUsage().active).toBe(0)
  expect(Object.values(run.snapshot().tokenReservations ?? {})[0]).toMatchObject({ status: 'unknown',
    observedUsage: { inputTokens: 17, outputTokens: 2 }, compactionId })
  expect(run.budgetUsage().tokens.used).toBe(10000)
})

it.each(['unmarked', 'cloned', 'changed', 'ended', 'unrouted', 'foreign-session', 'unclassified'] as const)('rejects %s auxiliary requests before model IO', async (variant) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { CompactionId, recordCompactionRequest } = await import('@clocky/clocky-compaction')
  const adapter = new MockAdapter([textResponse('Must not run')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  const actor = activation.localAgent
  if (actor === undefined) throw new Error('fixture actor missing')
  const compactionId = CompactionId('aux-denied')
  actor.session.append('compaction/start', { compactionId, turn: null })
  const raw = { sessionId: actor.session.id, purpose: 'compaction' as const, provider: 'mock', model: 'mock',
    messages: [createUserMessage({ content: [{ type: 'text', text: 'source' }], source: { kind: 'user' } })] }
  let options: import('@clocky/clocky-llm').GenerateOptions = variant === 'unmarked' ? raw : recordCompactionRequest(actor.session, raw)
  if (variant === 'cloned') options = { ...options }
  if (variant === 'unrouted') delete options.sessionId
  if (variant === 'unclassified') delete options.purpose
  if (variant === 'foreign-session') options.sessionId = ctx.sessions.create().id
  if (variant === 'changed') options.model = 'different'
  if (variant === 'ended') actor.session.append('compaction/end', { compactionId, turn: null, error: 'cancelled' })
  const consume = async () => { for await (const _chunk of ctx.llm.stream(options)) { /* Drain the attempted request. */ } }
  await expect(consume()).rejects.toThrow(/compaction ownership/)
  if (variant !== 'ended') actor.session.append('compaction/end', { compactionId, turn: null, error: 'rejected' })
  expect(adapter.requests).toHaveLength(0)
  expect(run.budgetUsage().tokens.used).toBe(0)
  expect(ctx.simulationTeams.modelUsage().active).toBe(0)
})

it('refuses to represent an executed entity with missing Session history as unmaterialized', async () => {
  const { ctx, connection } = await preparedPost()
  vi.spyOn(ctx.sessionPersistence, 'isUnmaterialized').mockResolvedValue(true)
  await expect(connection.collectCheckpointCandidate(4, 3)).rejects.toThrow(/history is missing/)
})

it('keeps an unbound checkpoint attached to its recorded canonical Team', async () => {
  const { ctx, run, connection, teamId } = await setup()
  if (connection === undefined) throw new Error('Fixture connection missing')
  const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const command = simulationCheckpointRequestSchema.parse({ id: 'unbound-owner', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  expect((await connection.checkpoint(command)).status).toBe('completed')
  await connection.close()
  const foreign = await createTestRootTeam(ctx, { goal: { objective: 'Another execution Team', budgets: {} }, budgets: {},
    rules: { simulationRunId: run.snapshot().spec.runId, activationLifecycleOwner: 'simulation/foreign' } })
  await expect(ctx.simulationTeams.attach(run, foreign.team.id, 'simulation/foreign')).rejects.toThrow(/canonical Team/)
  const resumed = await ctx.simulationTeams.attach(run, teamId, 'simulation/company')
  expect(await resumed.checkpoint(command)).toMatchObject({ status: 'completed' })
})

it('rechecks execution identity after Team lookup before registering attachment ownership', async () => {
  const { ctx, run, teamId } = await setup(false)
  const creation = { goal: { objective: 'Reserved while reading', budgets: {} }, budgets: {} }
  const getTeam = ctx.teams.getTeam.bind(ctx.teams)
  const moving = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (...args) => {
    const result = await getTeam(...args)
    await run.reserveTeam({ ...creation, rules: { simulationRunId: run.snapshot().spec.runId,
      activationLifecycleOwner: 'simulation/company' } }, run.snapshot().revision)
    return result
  })
  await expect(ctx.simulationTeams.attach(run, teamId, 'simulation/company')).rejects.toThrow(/canonical Team/)
  moving.mockRestore()
  const canonical = await ctx.simulationTeams.ensureTeam(run, creation, 'simulation/company')
  const connection = await ctx.simulationTeams.attach(run, canonical.team.id, 'simulation/company')
  await connection.close()
})

it('drains an admitted direct activation before collecting a checkpoint', async () => {
  const { run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('Fixture connection missing')
  await connection.bind(entityId, participant.id)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const reserve = run.reserveWriter.bind(run)
  const held = vi.spyOn(run, 'reserveWriter').mockImplementationOnce(async (...args) => {
    entered.resolve(undefined)
    await release.promise
    return await reserve(...args)
  })
  const starting = connection.activate(entityId, placement())
  const settled = Promise.allSettled([starting])
  await entered.promise
  let collected = false
  const collecting = connection.collectCheckpointCandidate(4, 3).then((value) => { collected = true; return value })
  try {
    await new Promise(resolve => setTimeout(resolve, 25))
    if (collected) (await collecting).release()
    expect(collected).toBe(false)
  } finally { release.resolve(undefined); await settled; held.mockRestore() }
  const candidate = await collecting
  try {
    expect(candidate.sessions[0]?.kind).toBe('materialized')
    expect(candidate.snapshot.entities[entityId]?.writer?.phase).toBe('released')
  } finally { candidate.release() }
})

it('cancels checkpoint acquisition while retaining an admitted startup until it settles', async () => {
  const { run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('Fixture connection missing')
  await connection.bind(entityId, participant.id)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const reserve = run.reserveWriter.bind(run)
  const held = vi.spyOn(run, 'reserveWriter').mockImplementationOnce(async (...args) => {
    entered.resolve(undefined)
    await release.promise
    return await reserve(...args)
  })
  let finished = false
  const starting = connection.activate(entityId, placement())
  const settled = starting.then(() => { finished = true }, () => { finished = true })
  await entered.promise
  const abort = new AbortController()
  const collecting = connection.collectCheckpointCandidate(4, 3, abort.signal)
  const rejected = expect(collecting).rejects.toThrow('Cancel checkpoint')
  try {
    await new Promise(resolve => setImmediate(resolve))
    abort.abort(new Error('Cancel checkpoint'))
    await rejected
    expect(finished).toBe(false)
  } finally { release.resolve(undefined); await settled; held.mockRestore() }
  expect((await starting).localAgent).toBeDefined()
  const candidate = await connection.collectCheckpointCandidate(4, 3)
  try { expect(run.population().chargedActors).toBe(0) }
  finally { candidate.release() }
})

it('holds connection close until a pre-controller activation lookup settles', async () => {
  const { ctx, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('Fixture connection missing')
  await connection.bind(entityId, participant.id)
  const getTeam = ctx.teams.getTeam.bind(ctx.teams)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (...args) => {
    const value = await getTeam(...args)
    entered.resolve(undefined)
    await release.promise
    return value
  })
  const starting = connection.activate(entityId, placement())
  const refused = expect(starting).rejects.toThrow(/closed/)
  await entered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  try {
    await new Promise(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
  } finally { release.resolve(undefined); held.mockRestore() }
  await refused
  await closing
})

it('publishes an immutable checkpoint and keeps terminal retries from changing newer state', async () => {
  const { run, connection } = await preparedPost()
  const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const request = simulationCheckpointRequestSchema.parse({ id: 'first', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  const pending = connection.checkpoint(request)
  expect(connection.checkpoint(request)).toBe(pending)
  const result = await pending
  expect(result.status).toBe('completed')
  if (result.status !== 'completed') throw new Error('fixture checkpoint failed')
  expect(result.manifest.sessions).toHaveLength(2)
  expect(result.manifest.channels).toHaveLength(1)
  expect(result.manifest.run.cursor).toBe(result.finishedSequence - 1)
  expect(run.snapshot().latestCheckpointId).toBe(request.id)
  await run.setPhase('running', run.snapshot().revision)
  const revision = run.snapshot().revision
  expect(await connection.checkpoint(request)).toEqual(result)
  expect(run.snapshot().phase).toBe('running')
  expect(run.snapshot().revision).toBe(revision)
  await expect(connection.checkpoint({ ...request, implementationVersion: 'different' })).rejects.toThrow(/changed its request/)
})

it('restores an old checkpoint with Team, channel and Session suffixes without replaying model or publication effects', async () => {
  const { ctx, run, connection, entityId, receiverId, channel, model, simTimeSchema } = await preparedPost()
  const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const command = simulationCheckpointRequestSchema.parse({ id: 'before-delivery', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  const checkpoint = await connection.checkpoint(command)
  expect(checkpoint.status).toBe('completed')
  await connection.activate(entityId, { ...placement(), seed: { kind: 'resume' } })
  await connection.activate(receiverId, { ...placement(), seed: { kind: 'resume' }, agent: { options: { provider: 'mock', model: 'mock' } } })
  await run.setPhase('running', run.snapshot().revision)
  await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
  await run.close()
  const before = run.snapshot()
  const wal = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  const requests = model.requests.length
  const restored = await ctx.simulationTeams.restore({ provider: 'local', mode: 'open', spec: before.spec }, { id: command.id, implementationVersion: command.implementationVersion, maxAttempts: command.maxAttempts })
  cleanups.push(() => restored.run.close())
  expect(restored.run.snapshot()).toMatchObject({ phase: 'paused', time: before.time, operations: before.operations,
    resources: before.resources, wakes: before.wakes })
  expect((await ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor).toBe(wal.cursor)
  expect(model.requests).toHaveLength(requests)
})

it.each(['team', 'channel', 'session', 'missing-session'] as const)('rejects %s checkpoint prefix damage before exposing execution', async (kind) => {
  const { ctx, run, connection, model } = await preparedPost()
  const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const command = simulationCheckpointRequestSchema.parse({ id: 'damaged', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  expect((await connection.checkpoint(command)).status).toBe('completed')
  await run.close()
  const selection = { provider: 'local', mode: 'open' as const, spec: run.snapshot().spec }
  const prefix = ctx.teams.getPersistenceReference.bind(ctx.teams)
  const session = ctx.sessionPersistence.getPersistencePrefix.bind(ctx.sessionPersistence)
  const fault = kind === 'missing-session' ? vi.spyOn(ctx.sessionPersistence, 'isUnmaterialized').mockResolvedValue(true)
    : kind === 'session' ? vi.spyOn(ctx.sessionPersistence, 'getPersistencePrefix').mockImplementation(async (...args) => {
      const value = await session(...args)
      return { ...value, fingerprint: `sha256:${'0'.repeat(64)}` as typeof value.fingerprint }
    }) : vi.spyOn(ctx.teams, 'getPersistenceReference').mockImplementation(async (request) => {
      const value = await prefix(request)
      return request.kind === kind && request.prefixCursor !== undefined
        ? { ...value, fingerprint: `sha256:${'0'.repeat(64)}` as typeof value.fingerprint } : value
    })
  const request = { id: command.id, implementationVersion: command.implementationVersion, maxAttempts: command.maxAttempts }
  await expect(ctx.simulationTeams.restore(selection, request)).rejects.toThrow(/prefix does not match|history is missing/)
  fault.mockRestore()
  expect(model.requests).toHaveLength(0)
  const restored = await ctx.simulationTeams.restore(selection, request)
  cleanups.push(() => restored.run.close())
  expect(restored.run.snapshot().phase).toBe('paused')
})

it('bounds recovery retries after owner movement and releases the run after a failed attempt', async () => {
  const { ctx, run, connection } = await preparedPost()
  const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const { TeamError } = await import('@clocky/clocky-team')
  const command = simulationCheckpointRequestSchema.parse({ id: 'moving', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  expect((await connection.checkpoint(command)).status).toBe('completed')
  await run.close()
  const selection = { provider: 'local', mode: 'open' as const, spec: run.snapshot().spec }
  const request = { id: command.id, implementationVersion: command.implementationVersion, maxAttempts: 2 }
  const moving = vi.spyOn(ctx.teams, 'getPersistenceReference').mockRejectedValue(new TeamError('Owner moved', 'TEAM_CURSOR_CONFLICT'))
  await expect(ctx.simulationTeams.restore(selection, request)).rejects.toThrow(/Owner moved/)
  expect(moving).toHaveBeenCalledTimes(2)
  moving.mockRestore()
  const once = vi.spyOn(ctx.teams, 'getPersistenceReference').mockRejectedValueOnce(new TeamError('Owner moved', 'TEAM_CURSOR_CONFLICT'))
  const restored = await ctx.simulationTeams.restore(selection, request)
  cleanups.push(() => restored.run.close())
  expect(restored.run.snapshot().phase).toBe('paused')
  once.mockRestore()
})

it('cancels restoration during prefix IO without publishing a connection or retaining the run lock', async () => {
  const { ctx, run, connection, model } = await preparedPost()
  const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const command = simulationCheckpointRequestSchema.parse({ id: 'cancelled-recovery', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  expect((await connection.checkpoint(command)).status).toBe('completed')
  await run.close()
  const selection = { provider: 'local', mode: 'open' as const, spec: run.snapshot().spec }
  const request = { id: command.id, implementationVersion: command.implementationVersion, maxAttempts: 2 }
  const abort = new AbortController()
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const prefix = ctx.sessionPersistence.getPersistencePrefix.bind(ctx.sessionPersistence)
  const held = vi.spyOn(ctx.sessionPersistence, 'getPersistencePrefix').mockImplementationOnce(async (...args) => {
    const value = await prefix(...args)
    entered.resolve(undefined)
    await release.promise
    return value
  })
  const restoring = ctx.simulationTeams.restore(selection, request, abort.signal)
  const rejected = expect(restoring).rejects.toThrow('Stop restore')
  await entered.promise
  abort.abort(new Error('Stop restore'))
  release.resolve(undefined)
  await rejected
  held.mockRestore()
  expect(model.requests).toHaveLength(0)
  const retried = await ctx.simulationTeams.restore(selection, request)
  cleanups.push(() => retried.run.close())
  expect(retried.run.snapshot().phase).toBe('paused')
})

it.each([false, true])('closes a retired checkpoint-suffix window without accepting new proposals (partial=%s)', async (partial) => {
  const { ctx, run, connection, entityId, receiverId } = await preparedPost()
  const { simulationCheckpointRequestSchema, simulationWindowIdSchema, simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const command = simulationCheckpointRequestSchema.parse({ id: 'window-cut', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  expect((await connection.checkpoint(command)).status).toBe('completed')
  await connection.activate(entityId, { ...placement(), seed: { kind: 'resume' } })
  await connection.activate(receiverId, { ...placement(), seed: { kind: 'resume' } })
  await run.setPhase('running', run.snapshot().revision)
  const windowId = simulationWindowIdSchema.parse('suffix-window')
  const first = simulationDecisionIdSchema.parse('suffix-first'), second = simulationDecisionIdSchema.parse('suffix-second')
  await connection.openWindow({ id: windowId, decisions: [
    { id: first, entityId, context: contextRequest() }, { id: second, entityId: receiverId, context: contextRequest() },
  ] })
  await connection.submitDecision(entityId, first, [])
  if (partial) expect((await run.commitWindow(windowId)).status).toBe('collecting')
  await run.close()
  expect(run.snapshot().activeWindowId).toBe(windowId)
  const before = run.snapshot()
  const selection = { provider: 'local', mode: 'open' as const, spec: before.spec }
  const request = { id: command.id, implementationVersion: command.implementationVersion, maxAttempts: 3 }
  const open = ctx.simulations.open.bind(ctx.simulations)
  const failed = vi.spyOn(ctx.simulations, 'open').mockImplementationOnce(async (...args) => {
    const opened = await open(...args)
    const log = (opened as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
    const append = log.append.bind(log)
    vi.spyOn(log, 'append').mockImplementation(async (cursor, values, options) => {
      if (JSON.stringify(values).includes('window/closed')) throw new Error('Window close unavailable')
      return await append(cursor, values, options)
    })
    return opened
  })
  await expect(ctx.simulationTeams.restore(selection, request)).rejects.toThrow(/Window close unavailable/)
  failed.mockRestore()
  const restored = await ctx.simulationTeams.restore(selection, request)
  cleanups.push(() => restored.run.close())
  const after = restored.run.snapshot()
  expect(after.activeWindowId).toBeUndefined()
  expect(after.windows?.[windowId]?.status).toBe('closed')
  expect(after.decisions[first]).toEqual(before.decisions[first])
  expect(after.decisions[second]).toEqual(before.decisions[second])
  expect(after.operations).toEqual(before.operations)
  expect(after.phase).toBe('paused')
})

it('retains the previous complete manifest when a later publication cannot be written', async () => {
  const { run, connection } = await preparedPost()
  const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const request = simulationCheckpointRequestSchema.parse({ id: 'retained', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  expect((await connection.checkpoint(request)).status).toBe('completed')
  const stream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const append = stream.append.bind(stream)
  const failure = vi.spyOn(stream, 'append').mockImplementation(async (cursor, values, options) => {
    if (JSON.stringify(values).includes('checkpoint/published')) throw new Error('Manifest publication unavailable')
    return await append(cursor, values, options)
  })
  const next = simulationCheckpointRequestSchema.parse({ ...request, id: 'failed-publication' })
  const result = await connection.checkpoint(next)
  failure.mockRestore()
  expect(result.status).toBe('failed')
  expect(run.snapshot().latestCheckpointId).toBe(request.id)
  const revision = run.snapshot().revision
  expect(await connection.checkpoint(next)).toEqual(result)
  expect(run.snapshot().revision).toBe(revision)
})

it('protects Simulation Team and channel history even from valid scheduler compaction proofs', async () => {
  const { ctx, channel } = await preparedPost()
  const teamId = channel.manifest.teamId
  const team = await ctx.teams.getTeam({ teamId })
  const current = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  const references = await Promise.all([
    ctx.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: team.team.cursor }),
    ctx.teams.getPersistenceReference({ kind: 'channel', channelId: current.manifest.id, expectedCursor: current.cursor }),
  ])
  expect(references.map(value => value.retention)).toEqual(['full', 'full'])
  const proofs = new WeakMap<import('@clocky/clocky-team').TeamSystemMaintenanceProof, import('@clocky/clocky-team').TeamSystemMaintenanceScope>()
  const remove = ctx.teams.registerSystemMaintenanceProofSource({ name: 'team-scheduler-dag', resolveMaintenanceProof: proof => proofs.get(proof) })
  const issue = (scope: import('@clocky/clocky-team').TeamSystemMaintenanceScope) => {
    const proof = {} as import('@clocky/clocky-team').TeamSystemMaintenanceProof
    proofs.set(proof, scope)
    return proof
  }
  try {
    const teamInput = { teamId, expectedCursor: team.team.cursor, throughSequence: 0 }
    await expect(ctx.teams.compactTeam({ ...teamInput, actor: issue({ kind: 'scheduler-team-journal-compaction', ...teamInput }) }))
      .rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    const channelInput = { teamId, channelId: current.manifest.id, expectedCursor: current.cursor, throughSequence: 0 }
    await expect(ctx.teams.compactChannel({ ...channelInput, actor: issue({ kind: 'scheduler-channel-compaction', ...channelInput }) }))
      .rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    for (const reference of references) {
      expect(await ctx.teams.getPersistenceReference({ ...reference.owner, expectedCursor: reference.cursor })).toEqual(reference)
    }
    expect(ctx.teams.getMetrics()).toMatchObject({ teamCompactions: 0, channelCompactions: 0 })
  } finally { remove() }
})

it.each(['team', 'channel', 'session'] as const)('rejects checkpoint collection when %s history lacks protection', async (kind) => {
  const { ctx, run, connection } = await preparedPost()
  if (kind === 'session') {
    const read = ctx.sessionPersistence.getPersistenceReference.bind(ctx.sessionPersistence)
    vi.spyOn(ctx.sessionPersistence, 'getPersistenceReference').mockImplementation(async (...args) => ({ ...await read(...args), retention: 'unprotected' }))
  } else {
    const read = ctx.teams.getPersistenceReference.bind(ctx.teams)
    vi.spyOn(ctx.teams, 'getPersistenceReference').mockImplementation(async request => ({
      ...await read(request), retention: request.kind === kind ? 'compactable' : 'full',
    }))
  }
  await expect(connection.collectCheckpointCandidate(4, 3)).rejects.toThrow(/history is not protected/)
  await run.setPhase('running', run.snapshot().revision)
})

it.each(['checkpoint', 'close'] as const)('quiesces an active model before %s completes', async (mode) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const entered = Promise.withResolvers<undefined>()
  const model = new MockAdapter([])
  vi.spyOn(model, 'stream').mockImplementation(async function* (options) {
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 0 } }
    const signal = options.signal
    if (signal === undefined) throw new Error('fixture model signal missing')
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', () => { resolve() }, { once: true })
      entered.resolve(undefined)
    })
    signal.throwIfAborted()
  })
  ctx.llm.registerAdapter(['checkpoint-model'], model)
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'checkpoint-model', model: 'mock' } } })
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('active-at-checkpoint')
  const decision = connection.executeDecision(entityId, id, contextRequest()).catch((error: unknown) => error)
  await entered.promise
  if (mode === 'close') {
    await connection.close()
    await decision
    expect(run.snapshot().decisions[id]?.status).toBe('cancelled')
    expect(ctx.simulationTeams.modelUsage().active).toBe(0)
    expect(Object.values(run.snapshot().tokenReservations ?? {})[0]?.status).toBe('unknown')
    return
  }
  const candidate = await connection.collectCheckpointCandidate(4, 3)
  try {
    await decision
    expect(candidate.snapshot.decisions[id]?.status).toBe('cancelled')
    expect(ctx.simulationTeams.modelUsage().active).toBe(0)
    expect(Object.values(candidate.snapshot.tokenReservations ?? {})[0]?.status).toBe('unknown')
    await candidate.validate()
  } finally { candidate.release() }
})

it('releases a cut when the connection closes during owner collection', async () => {
  const { ctx, run, connection } = await preparedPost()
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const read = ctx.teams.getPersistenceReference.bind(ctx.teams)
  vi.spyOn(ctx.teams, 'getPersistenceReference').mockImplementationOnce(async (request) => {
    const reference = await read(request)
    entered.resolve(undefined)
    await release.promise
    return reference
  })
  const collection = connection.collectCheckpointCandidate(4, 3)
  const rejected = expect(collection).rejects.toThrow(/no longer admitted/)
  await entered.promise
  const closing = connection.close()
  release.resolve(undefined)
  await rejected
  await closing
  await run.setPhase('running', run.snapshot().revision)
})

it('bounds movement retries and releases admission after fatal source failure', async () => {
  const { ctx, connection } = await preparedPost()
  const missing = vi.spyOn(ctx.sessionPersistence, 'readFrom').mockRejectedValue(new Error('Required Session missing'))
  await expect(connection.collectCheckpointCandidate(4, 3)).rejects.toThrow(/Required Session missing/)
  expect(missing).toHaveBeenCalledTimes(1)
  missing.mockRestore()
  const { TeamError } = await import('@clocky/clocky-team')
  const moving = vi.spyOn(ctx.teams, 'getPersistenceReference').mockRejectedValue(new TeamError('Moving owner', 'TEAM_CURSOR_CONFLICT'))
  await expect(connection.collectCheckpointCandidate(4, 2)).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
  expect(moving).toHaveBeenCalledTimes(2)
  moving.mockRestore()
  const candidate = await connection.collectCheckpointCandidate(4, 3)
  candidate.release()
})

it('collects unpublished owner references after retiring actors and holds admission until release', async () => {
  const { ctx, run, connection, entityId, receiverId } = await preparedPost()
  const candidate = await connection.collectCheckpointCandidate(4, 3)
  try {
    expect(candidate.snapshot.phase).toBe('paused')
    expect(Object.values(candidate.snapshot.entities).every(entity => entity.writer?.phase === 'released')).toBe(true)
    expect(candidate.sessions).toHaveLength(2)
    expect(candidate.channels).toHaveLength(1)
    await candidate.validate()
    await expect(connection.activate(entityId, { ...placement(), seed: { kind: 'resume' } })).rejects.toThrow(/blocks new admission/)
    await expect(run.setPhase('running', run.snapshot().revision)).rejects.toThrow(/blocks new writes/)
  } finally { candidate.release() }
  await expect(candidate.validate()).rejects.toThrow(/no longer admitted/)
  const resumed = await connection.activate(receiverId, { ...placement(), seed: { kind: 'resume' } })
  expect(resumed.localAgent).toBeDefined()
  expect(ctx.agents.get(resumed.binding.sessionId)).toBe(resumed.localAgent)
})

it('retries owner movement but propagates failed Session flush before exposing a candidate', async () => {
  const { ctx, run, connection } = await preparedPost()
  const failed = vi.spyOn(ctx.sessions, 'flush').mockResolvedValue(false)
  await expect(connection.collectCheckpointCandidate(4, 3)).rejects.toThrow(/durable Session/)
  failed.mockRestore()
  const { TeamError } = await import('@clocky/clocky-team')
  const moved = vi.spyOn(ctx.teams, 'getPersistenceReference').mockRejectedValueOnce(new TeamError('Owner moved', 'TEAM_CURSOR_CONFLICT'))
  const candidate = await connection.collectCheckpointCandidate(4, 3)
  try {
    expect(moved.mock.calls.length).toBeGreaterThan(2)
    expect(run.snapshot().phase).toBe('paused')
    await candidate.validate()
  } finally { candidate.release(); moved.mockRestore() }
})

it('captures only flushed physical Session prefixes and rejects stale sequence requests', async () => {
  const { ctx, receiver } = await preparedPost()
  const actor = receiver.localAgent
  if (actor === undefined) throw new Error('fixture receiver missing')
  await ctx.sessions.flush(actor.session)
  const sequence = actor.session.events.length - 1
  const reference = await ctx.sessionPersistence.getPersistenceReference(actor.session.id, sequence)
  expect(reference.header.id).toBe(actor.session.id)
  expect(reference.sequence).toBe(sequence)
  expect(reference.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(await ctx.sessionPersistence.getPersistenceReference(actor.session.id, sequence)).toEqual(reference)
  actor.send(createUserMessage({ content: [{ type: 'text', text: 'Pending checkpoint input' }], source: { kind: 'user' } }), 'next-step', false)
  await ctx.sessions.flush(actor.session)
  await expect(ctx.sessionPersistence.getPersistenceReference(actor.session.id, sequence)).rejects.toThrow(/cursor moved/)
  const advanced = await ctx.sessionPersistence.getPersistenceReference(actor.session.id, actor.session.events.length - 1)
  expect(advanced.fingerprint).not.toBe(reference.fingerprint)
  expect(advanced.revision).not.toBe(reference.revision)
})

it('captures channel references at the exact publication cursor and rejects stale collection', async () => {
  const { ctx, run, connection, channel, simTimeSchema } = await preparedPost()
  const before = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  const reference = await ctx.teams.getPersistenceReference({ kind: 'channel', channelId: channel.manifest.id, expectedCursor: before.cursor })
  expect(reference.owner).toEqual({ kind: 'channel', channelId: channel.manifest.id })
  expect(reference.cursor).toBe(before.cursor)
  expect(reference.firstSequence).toBe(0)
  await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
  await expect(ctx.teams.getPersistenceReference({ kind: 'channel', channelId: channel.manifest.id, expectedCursor: before.cursor }))
    .rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })
  const current = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  const published = await ctx.teams.getPersistenceReference({ kind: 'channel', channelId: channel.manifest.id, expectedCursor: current.cursor })
  expect(published.fingerprint).not.toBe(reference.fingerprint)
  expect(published.stream).toEqual(reference.stream)
  expect(await ctx.teams.getPersistenceReference({ kind: 'channel', channelId: channel.manifest.id,
    expectedCursor: current.cursor, prefixCursor: before.cursor })).toEqual(reference)
  expect(run.snapshot().time).toBe('5')
})

async function preparedTask(withDependency = false) {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationProposalSchema, simTimeSchema } = await import('@clocky/clocky-simulation')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('create-task')
  await connection.openDecision(entityId, id)
  const proposal = simulationProposalSchema.parse({ after: [], action: {
    kind: 'task/create', deliverAt: '5', task: { subject: 'Task from accepted intent', description: 'Create exactly once',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 2 },
  } })
  const decision = await connection.submitDecision(entityId, id, [proposal, ...withDependency ? [{ ...proposal, after: [0] }] : []])
  const operationId = decision.operationIds[0]!
  expect(await run.drive({ until: simTimeSchema.parse('10') })).toMatchObject({ reason: 'dispatch-required', operationId })
  return { ctx, run, connection, operationId, dependentId: decision.operationIds[1] }
}

it.each(['missing', 'creator-kind', 'team', 'run', 'operation', 'participant', 'key'] as const)
('refuses checkpoint task evidence with changed %s and permits a corrected retry', async (field) => {
  const { ctx, run, connection, operationId } = await preparedTask()
  const { teamIdSchema, participantIdSchema, teamTaskCreateIdempotencyKeySchema } = await import('@clocky/clocky-team')
  const { simulationRunIdSchema, simulationOperationIdSchema } = await import('@clocky/clocky-simulation')
  await connection.dispatchOperation(operationId, () => 100)
  const receipt = run.snapshot().operations[operationId]!.outbox!.taskReceipt!
  const read = ctx.teams.getTeam.bind(ctx.teams)
  const changed = vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
    const team = await read(request)
    const tasks = team.tasks.flatMap((item) => {
      if (item.id !== receipt.taskId) return [item]
      if (field === 'missing') return []
      const creator = item.createCommand.creator
      if (!('kind' in creator)) throw new Error('Fixture task has no Simulation attribution')
      const command = { ...item.createCommand }
      if (field === 'creator-kind') command.creator = { teamId: creator.teamId, participantId: creator.participantId }
      if (field === 'team') command.creator = { ...creator, teamId: teamIdSchema.parse('foreign') }
      if (field === 'run') command.creator = { ...creator, runId: simulationRunIdSchema.parse('foreign') }
      if (field === 'operation') command.creator = { ...creator, operationId: simulationOperationIdSchema.parse('foreign') }
      if (field === 'participant') command.creator = { ...creator, participantId: participantIdSchema.parse('foreign') }
      if (field === 'key') command.idempotencyKey = teamTaskCreateIdempotencyKeySchema.parse('foreign')
      return [{ ...item, createCommand: command }]
    })
    return { ...team, tasks }
  })
  try { await expect(connection.collectCheckpointCandidate(4, 2)).rejects.toThrow(/task receipt/) }
  finally { changed.mockRestore() }
  const candidate = await connection.collectCheckpointCandidate(4, 2)
  try { await candidate.validate() }
  finally { candidate.release() }
})

it('dispatches an accepted task through the shared outbox and reconciles a lost target response', async () => {
  const { ctx, run, connection, operationId } = await preparedTask()
  const create = ctx.teams.createSimulationTask.bind(ctx.teams)
  const lost = vi.spyOn(ctx.teams, 'createSimulationTask').mockImplementationOnce(async (request) => {
    await create(request)
    throw new Error('Task committed but response lost')
  })
  expect(await connection.dispatchOperation(operationId, () => 100)).toEqual({ status: 'retry', nextAttemptAt: 110 })
  lost.mockRestore()
  expect(await connection.dispatchOperation(operationId, () => 110)).toMatchObject({ status: 'settled', result: { status: 'applied', code: 'SIM_TASK_CREATED' } })
  const operation = run.snapshot().operations[operationId]!
  const receipt = operation.outbox?.taskReceipt
  expect(receipt).toMatchObject({ operationId, fingerprint: operation.fingerprint })
  expect(operation.outbox?.receipt).toBeUndefined()
  expect(operation.delivery).toBeUndefined()
  expect(operation.outbox?.attempts.map(attempt => attempt.outcome)).toEqual(['uncertain', 'applied'])
  const teamId = Object.values(run.snapshot().entities)[0]!.binding!.teamId
  const tasks = await ctx.teams.listTasksPage({ teamId, afterCursor: -1, limit: 10 })
  expect(tasks.items).toHaveLength(1)
  expect(tasks.items[0]!.id).toBe(receipt?.taskId)
})

it('blocks new Simulation tasks while their Team is quiescing and still reconciles committed tasks', async () => {
  const { ctx, run, connection, operationId, dependentId } = await preparedTask(true)
  const { seedTeamPhase } = await import('../../../team/team-hub/tests/fixtures.ts')
  const create = ctx.teams.createSimulationTask.bind(ctx.teams)
  const lost = vi.spyOn(ctx.teams, 'createSimulationTask').mockImplementationOnce(async (request) => {
    await create(request)
    throw new Error('Task committed but response lost')
  })
  expect(await connection.dispatchOperation(operationId, () => 100)).toEqual({ status: 'retry', nextAttemptAt: 110 })
  lost.mockRestore()
  const teamId = Object.values(run.snapshot().entities)[0]!.binding!.teamId
  await seedTeamPhase(ctx, teamId, 'quiescing')
  expect(await connection.dispatchOperation(operationId, () => 110)).toMatchObject({ status: 'settled', result: { status: 'applied' } })
  await run.drive({ until: run.snapshot().time })
  expect(await connection.dispatchOperation(dependentId!, () => 120)).toMatchObject({ status: 'settled', result: {
    status: 'blocked-authority', code: 'TEAM_POLICY_DENIED',
  } })
  expect((await ctx.teams.getTeam({ teamId })).tasks).toHaveLength(1)
  expect(run.snapshot().operations[dependentId!]!.outbox!.taskReceipt).toBeUndefined()
})

it.each(['TEAM_POLICY_DENIED', 'TEAM_GRANT_DENIED', 'TEAM_TASK_IDEMPOTENCY_CONFLICT'] as const)
('retains definitive task target error %s without retrying creation', async (code) => {
  const { ctx, run, connection, operationId } = await preparedTask()
  const { TeamError } = await import('@clocky/clocky-team')
  const denied = vi.spyOn(ctx.teams, 'createSimulationTask').mockRejectedValue(new TeamError('Target denied creation', code))
  const result = await connection.dispatchOperation(operationId, () => 100)
  expect(result).toMatchObject({ status: 'settled', result: {
    status: code === 'TEAM_TASK_IDEMPOTENCY_CONFLICT' ? 'rejected' : 'blocked-authority', code,
  } })
  expect(await connection.dispatchOperation(operationId, () => 200)).toEqual(result)
  expect(denied).toHaveBeenCalledTimes(1)
  expect(run.snapshot().operations[operationId]?.outbox?.attempts).toHaveLength(1)
  expect(run.snapshot().operations[operationId]?.outbox?.taskReceipt).toBeUndefined()
  denied.mockRestore()
  const teamId = Object.values(run.snapshot().entities)[0]!.binding!.teamId
  expect((await ctx.teams.listTasksPage({ teamId, afterCursor: -1, limit: 10 })).items).toEqual([])
})

it('deduplicates exact Simulation task creation and rejects revoked or widened source authority', async () => {
  const { ctx, run, entityId, receiverId } = await preparedPost()
  const { teamTaskCreateIdempotencyKeySchema } = await import('@clocky/clocky-team')
  const { simulationOperationIdSchema } = await import('@clocky/clocky-simulation')
  const binding = run.snapshot().entities[entityId]!.binding!
  const current = await ctx.teams.getTeam({ teamId: binding.teamId })
  const operationId = simulationOperationIdSchema.parse('task-proof-operation')
  const input = { teamId: binding.teamId,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(JSON.stringify(['simulation-task', run.snapshot().spec.runId, operationId])) },
    subject: 'Accepted task', description: 'Exact source payload', blockedBy: [], requiredCapabilities: [], priority: 0,
    readScopes: [], writeScopes: [], workspaceMode: 'shared' as const, budget: {}, reviewPolicy: { kind: 'none' as const }, maxAttempts: 2 }
  const proof = {} as import('@clocky/clocky-team').TeamSystemTaskControlProof
  let allowed = false
  let creatorParticipant = binding.participantId
  const remove = ctx.teams.registerSystemTaskControlProofSource({ name: 'simulation-team', resolveTaskControlProof: value => value !== proof
    ? undefined : { kind: 'simulation-task-create', runId: run.snapshot().spec.runId, operationId, lifecycleOwner: 'simulation/company',
      participantId: creatorParticipant, publishAllowed: allowed, input } })
  const request = { actor: proof, ...input, expectedCursor: current.team.cursor }
  try {
    await expect(ctx.teams.createSimulationTask(request)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    allowed = true
    await expect(ctx.teams.createSimulationTask({ ...request, description: 'Unaccepted work' })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    for (const change of ['permission', 'creator']) {
      const revokeDuringPolicy = ctx.teams.registerPolicy('task-mutate', { name: 'revoke-task-source', async apply(_request, next) {
        if (change === 'permission') allowed = false
        else creatorParticipant = run.snapshot().entities[receiverId]!.binding!.participantId
        return await next()
      } })
      await expect(ctx.teams.createSimulationTask(request)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      revokeDuringPolicy()
      allowed = true
      creatorParticipant = binding.participantId
    }
    const created = await ctx.teams.createSimulationTask(request)
    expect(created.createCommand.creator).toEqual({ kind: 'simulation', teamId: binding.teamId,
      participantId: binding.participantId, runId: run.snapshot().spec.runId, operationId })
    allowed = false
    expect(await ctx.teams.createSimulationTask({ ...request, expectedCursor: 0 })).toEqual(created)
    remove()
    await expect(ctx.teams.createSimulationTask(request)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await ctx.teams.listTasksPage({ teamId: binding.teamId, afterCursor: -1, limit: 10 })).items).toHaveLength(1)
  } finally { remove() }
})

it('reconciles real Team task revisions without fulfilling a delivery commitment', async () => {
  const { ctx, run, connection, entityId, receiverId } = await preparedPost()
  const { simulationDecisionIdSchema, simulationProposalSchema } = await import('@clocky/clocky-simulation')
  const { teamTaskCreateIdempotencyKeySchema } = await import('@clocky/clocky-team')
  const { assignTestTask } = await import('../../../team/team-hub/tests/fixtures.ts')
  const coordinator = simulationEntityIdSchema.parse('coordinator')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: coordinator,
    entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
  const teamId = run.snapshot().entities[entityId]!.binding!.teamId
  const before = await ctx.teams.getTeam({ teamId })
  const participant = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: before.team.cursor,
    kind: 'local-agent', displayName: 'Coordinator', role: 'coordinator', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    const current = await ctx.teams.getTeam({ teamId })
    await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id, expectedCursor: current.team.cursor, phase })
  }
  await connection.bind(coordinator, participant.id)
  await connection.activate(coordinator, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  const state = await ctx.teams.getTeam({ teamId })
  const binding = state.activations.find(value => value.activation.participantId === participant.id)
  const receiverParticipant = run.snapshot().entities[receiverId]!.binding!.participantId
  const worker = state.activations.find(value => value.activation.participantId === receiverParticipant)
  if (binding === undefined || worker === undefined) throw new Error('fixture active participants missing')
  const issuer = ctx.teams.openActivationActorProofIssuer()
  const task = await ctx.teams.createTask({ actor: issuer.issue(binding).proof, teamId, expectedCursor: state.team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('simulation-task') },
    subject: 'Deliver report', description: 'Prepare delivery evidence', blockedBy: [], requiredCapabilities: [], priority: 0,
    readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 2 })
  const apply = async (actor: typeof entityId, name: string, action: unknown) => {
    const id = simulationDecisionIdSchema.parse(name)
    await connection.openDecision(actor, id)
    const accepted = await connection.submitDecision(actor, id, [simulationProposalSchema.parse({ after: [], action })])
    expect((await run.executeOperation(accepted.operationIds[0]!)).status).toBe('applied')
  }
  await apply(entityId, 'task-request', { kind: 'interaction/request', id: 'task-order', assignee: receiverId,
    description: 'Deliver report', replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' } })
  await apply(receiverId, 'task-accept', { kind: 'interaction/accept', id: 'task-order', expectedRevision: 1 })
  const interaction = Object.values(run.snapshot().interactions).find(value => value.description === 'Deliver report')!
  const linked = await connection.reconcileTask(interaction.id, interaction.revision, task.id)
  expect(linked.task).toMatchObject({ revision: task.revision, phase: 'pending' })
  const assigned = await assignTestTask(ctx, { teamId, taskId: task.id, expectedRevision: task.revision,
    participantId: worker.activation.participantId, activationId: worker.activation.id, leaseDurationMs: 60000 })
  const actor = issuer.issue(worker).proof
  const running = await ctx.teams.startTaskAttempt({ actor, taskId: task.id,
    attemptId: assigned.lease!.attemptId, expectedRevision: assigned.revision })
  const completed = await ctx.teams.settleTaskAttempt({ actor, taskId: task.id, attemptId: running.lease!.attemptId,
    expectedRevision: running.revision, outcome: { kind: 'completed', result: { summary: 'Report prepared' } } })
  const reconciled = await connection.reconcileTask(interaction.id, linked.revision, task.id)
  expect(reconciled.task).toMatchObject({ phase: 'completed', revision: completed.revision })
  expect(run.snapshot().commitments[reconciled.commitmentId!]!.phase).toBe('open')
})

it('delegates ordinary Sessions without requiring a Simulation decision', async () => {
  const { ctx } = await setup()
  const adapter = new MockAdapter([textResponse('ordinary response')])
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = ctx.agentLoop.create(SessionId('ordinary-session'), { provider: 'mock', model: 'mock' })
  agent.send(createUserMessage({ content: [{ type: 'text', text: 'Ordinary request' }], source: { kind: 'user' } }), 'next-turn', true)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(agent.session.events.some(event => event.type === 'simulation/context-view')).toBe(false)
})

it('coalesces input admission and retries a failed queue flush without duplicate consumption', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const adapter = new MockAdapter([textResponse('one decision')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  const agent = lease.localAgent
  if (agent === undefined) throw new Error('fixture local Agent missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('queue-retry')
  await connection.openDecision(entityId, id)
  const prepared = await connection.prepareContext(entityId, id, contextRequest())
  if (prepared.status !== 'prepared') throw new Error('fixture context overflow')
  const flush = vi.spyOn(ctx.sessions, 'flush').mockRejectedValueOnce(new Error('Queue checkpoint unavailable'))
  const first = connection.dispatchDecision(entityId, id)
  const repeated = connection.dispatchDecision(entityId, id)
  expect(repeated).toBe(first)
  await expect(first).rejects.toThrow(/Queue checkpoint/)
  flush.mockRestore()
  expect(adapter.requests).toHaveLength(0)
  expect(agent.inbox.nextTurn.map(message => message.id)).toEqual([MessageId(prepared.view.inputId)])
  expect(await connection.dispatchDecision(entityId, id)).toMatchObject({ status: 'queued' })
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(await connection.dispatchDecision(entityId, id)).toMatchObject({ status: 'consumed' })
  expect(agent.session.events.filter(event => event.type === 'user/message' && event.data.id === MessageId(prepared.view.inputId))).toHaveLength(1)
})

async function inputHarness(name: string) {
  const state = await setup()
  const { ctx, run, connection, entityId, participant } = state
  if (connection === undefined) throw new Error('fixture connection missing')
  const adapter = new MockAdapter([textResponse('input accepted')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  const agent = lease.localAgent
  if (agent === undefined) throw new Error('fixture local Agent missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse(name)
  await connection.openDecision(entityId, id)
  const prepared = await connection.prepareContext(entityId, id, contextRequest())
  if (prepared.status !== 'prepared') throw new Error('fixture context overflow')
  return { ...state, connection, agent, adapter, id, prepared }
}

it('rejects a control-input identity reused for different content', async () => {
  const { connection, agent, adapter, entityId, id, prepared } = await inputHarness('input-collision')
  const { freezeMessage } = await import('@clocky/clocky-llm')
  agent.send(freezeMessage({ id: MessageId(prepared.view.inputId), role: 'user',
    content: [{ type: 'text', text: 'Another payload' }], source: { kind: 'plugin', plugin: 'simulation-team' } }), 'next-turn', false)
  await expect(connection.dispatchDecision(entityId, id)).rejects.toThrow(/another payload/)
  expect(adapter.requests).toHaveLength(0)
})

it('requires the prepared control identity even when context already exists', async () => {
  const { agent, adapter } = await inputHarness('unassigned-input')
  agent.send(createUserMessage({ content: [{ type: 'text', text: 'Unassigned input' }], source: { kind: 'user' } }), 'next-turn', true)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(0)
})

it('retires a terminal decision queue entry before waking a new slot', async () => {
  const { ctx, run, connection, agent, adapter, entityId, id, prepared } = await inputHarness('old-queued-input')
  const failure = vi.spyOn(ctx.sessions, 'flush').mockRejectedValueOnce(new Error('Queue checkpoint unavailable'))
  await expect(connection.dispatchDecision(entityId, id)).rejects.toThrow(/Queue checkpoint/)
  failure.mockRestore()
  await connection.submitDecision(entityId, id, [])
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const nextId = simulationDecisionIdSchema.parse('next-input')
  await connection.openDecision(entityId, nextId)
  await connection.prepareContext(entityId, nextId, contextRequest())
  await connection.dispatchDecision(entityId, nextId)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(agent.session.events.some(event => event.type === 'user/message' && event.data.id === MessageId(prepared.view.inputId))).toBe(false)
  expect(run.snapshot().decisions[id]?.status).toBe('accepted')
})

it('reports a claimed input as in-flight without inserting it again', async () => {
  const { ctx, connection, agent, adapter, entityId, id } = await inputHarness('claimed-input')
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  ctx.on('agent/pre-step', async (_payload, next) => {
    entered.resolve(undefined)
    await release.promise
    return await next()
  }, { prepend: true })
  try {
    await connection.dispatchDecision(entityId, id)
    await entered.promise
    expect(await connection.dispatchDecision(entityId, id)).toMatchObject({ status: 'in-flight' })
    expect(agent.inbox.hasPending).toBe(false)
    release.resolve(undefined)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
  } finally { release.resolve(undefined) }
})

it.each(['duplicate-entry', 'requeued'])('rejects contradictory consumption history: %s', async (kind) => {
  const { connection, agent, adapter, entityId, id, prepared } = await inputHarness('contradictory-input')
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  const entered = agent.session.events.find(event => event.type === 'user/message' && event.data.id === MessageId(prepared.view.inputId))
  if (entered?.type !== 'user/message') throw new Error('fixture consumed input missing')
  if (kind === 'duplicate-entry') agent.session.append('user/message', entered.data, { surfaceOp: 'append' })
  else agent.send(entered.data, 'next-turn', false)
  await expect(connection.dispatchDecision(entityId, id)).rejects.toThrow(/consumed more than once|consumption history/)
  expect(adapter.requests).toHaveLength(1)
})

async function preparedPost(maxCoordinationRounds = 16, maxContextBytes = 65536, message = 'Durable message', extraMessages: string[] = []) {
  const { ctx, run, connection, entityId, participant, teamId, serviceFiber } = await setup(true, maxContextBytes, maxCoordinationRounds)
  if (connection === undefined) throw new Error('fixture connection missing')
  const model = new MockAdapter([textResponse('Message received')])
  ctx.llm.registerAdapter(['mock'], model)
  const direct = await import('@clocky/clocky-team-channel-direct')
  await ctx.plugin(direct)
  await connection.bind(entityId, participant.id)
  const sender = await connection.activate(entityId, placement())
  const latest = await ctx.teams.getTeam({ teamId })
  const recipient = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: latest.team.cursor,
    kind: 'local-agent', displayName: 'Receiver', role: 'receiver', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    const state = await ctx.teams.getTeam({ teamId })
    await transitionBootstrapParticipant(ctx, { teamId, participantId: recipient.id, expectedCursor: state.team.cursor, phase })
  }
  const receiverId = simulationEntityIdSchema.parse('receiver')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: receiverId, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
  await connection.bind(receiverId, recipient.id)
  const { openTestChannel } = await import('../../../core/team/tests/channel-lifecycle-authority.ts')
  const state = await ctx.teams.getTeam({ teamId })
  const opened = await openTestChannel(ctx, { teamId, expectedCursor: state.team.cursor, adapter: direct.DIRECT_CHANNEL_ADAPTER_V4,
    participants: [{ id: participant.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }], limits: {},
    invitations: [connection.invitation(entityId), connection.invitation(receiverId)] })
  await connection.acknowledgeInvitation(entityId, opened.manifest.id)
  const channel = (await connection.acknowledgeInvitation(receiverId, opened.manifest.id)).channel
  const receiver = await connection.activate(receiverId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })

  await run.setPhase('running', run.snapshot().revision)
  const { simulationDecisionIdSchema, simulationProposalSchema, simTimeSchema } = await import('@clocky/clocky-simulation')
  const id = simulationDecisionIdSchema.parse('post-after-retirement')
  await connection.openDecision(entityId, id)
  const accepted = await connection.submitDecision(entityId, id, [message, ...extraMessages].map(text => simulationProposalSchema.parse({
    after: [], action: {
      kind: 'communication/post', recipient: receiverId, channelId: channel.manifest.id, text, deliverAt: '5',
    } })))
  const operation = accepted.operationIds[0]
  if (operation === undefined) throw new Error('fixture operation missing')
  return { ctx, run, connection, entityId, participant, recipient, receiverId, receiver, channel, sender, operation, serviceFiber,
    operations: accepted.operationIds, simTimeSchema, model }
}

it('drains accepted recipient delivery before hibernation and restores its pending input', async () => {
  const { ctx, run, connection, receiverId, receiver, operation, simTimeSchema } = await preparedPost()
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  let first = true
  const delayed = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
    if (first && session.id === receiver.binding.sessionId) {
      first = false
      entered.resolve(undefined)
      await release.promise
    }
    return await flush(session)
  })
  const delivery = connection.receiveOperation(operation)
  await entered.promise
  const sleeping = connection.hibernate(receiverId)
  try {
    await expect(connection.openDecision(receiverId, simulationDecisionIdSchema.parse('too-early'))).rejects.toThrow(/hibernation/)
    expect(run.snapshot().entities[receiverId]?.writer?.phase).toBe('active')
  } finally { release.resolve(undefined) }
  const wake = await delivery
  await sleeping
  delayed.mockRestore()
  expect(run.snapshot().operations[operation]?.delivery?.receipt).toBeDefined()
  const resumed = await connection.resume(receiverId, { provider: 'in-process',
    agent: { options: { provider: 'mock', model: 'mock' } }, signal: new AbortController().signal })
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.openDecision(receiverId, simulationDecisionIdSchema.parse('after-sleep'), wake)
  expect(JSON.stringify(resumed.localAgent?.inbox.nextStep)).toContain('Durable message')
  expect(resumed.binding.sessionId).toBe(receiver.binding.sessionId)
})

it('publishes through direct v4 after writer retirement and reconciles a lost target response', async () => {
  const { ctx, run, connection, entityId, participant, recipient, channel, sender, operation, simTimeSchema } = await preparedPost()
  await sender.dispose()
  await expect(connection.dispatchOperation(operation, () => 100)).rejects.toThrow(/not due/)
  await run.drive({ until: simTimeSchema.parse('5') })
  const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
  const lost = vi.spyOn(ctx.teams, 'postChannelEnvelope').mockImplementationOnce(async (request) => {
    await post(request)
    throw new Error('Target response lost')
  })
  expect(await connection.dispatchOperation(operation, () => 100)).toMatchObject({ status: 'retry' })
  lost.mockRestore()
  const current = run.snapshot().entities[entityId]
  if (current === undefined) throw new Error('fixture entity missing')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: entityId,
    entityRevision: current.revision, phase: 'inactive' }), run.snapshot().revision)
  expect(await connection.dispatchOperation(operation, () => 200)).toMatchObject({ status: 'settled', result: { status: 'applied' } })
  const records = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
  const envelopes = records.records.filter(record => record.type === 'channel/envelope')
  expect(envelopes).toHaveLength(1)
  expect(envelopes[0]).toMatchObject({ envelope: { senderId: participant.id, audience: [recipient.id],
    delivery: 'context', payload: { content: [{ type: 'text', text: 'Durable message' }] } } })
  expect(run.snapshot().operations[operation]?.outbox?.receipt).toMatchObject({ runId: run.snapshot().spec.runId,
    teamId: channel.manifest.teamId, recipientId: recipient.id, sequence: envelopes[0]!.envelope.sequence })
})

it('refuses a publication at another WAL position before persisting recipient input', async () => {
  const { ctx, run, connection, operation, receiver, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const read = ctx.teams.listChannelPendingDeliveries.bind(ctx.teams)
  const changed = vi.spyOn(ctx.teams, 'listChannelPendingDeliveries').mockImplementation(async (request) => {
    const result = await read(request)
    return { ...result, deliveries: result.deliveries.map(value => ({ ...value,
      envelope: { ...value.envelope, sequence: value.envelope.sequence + 1 },
    })) }
  })
  try { await expect(connection.receiveOperation(operation)).rejects.toThrow(/position differs/ ) }
  finally { changed.mockRestore() }
  expect(run.snapshot().operations[operation]?.delivery).toBeUndefined()
  expect(JSON.stringify(receiver.localAgent?.inbox.nextStep)).not.toContain('Durable message')
  await connection.receiveOperation(operation)
  expect(run.snapshot().operations[operation]?.delivery?.receipt).toBeDefined()
})

it.each(['missing', 'position', 'identity', 'team', 'channel', 'sender', 'audience', 'kind', 'delivery', 'payload'] as const)
('refuses checkpoint publication evidence with changed %s and permits a corrected retry', async (field) => {
  const { ctx, run, connection, operation, simTimeSchema } = await preparedPost()
  const { envelopeIdSchema, teamIdSchema, channelIdSchema, participantIdSchema } = await import('@clocky/clocky-team')
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const receipt = run.snapshot().operations[operation]!.outbox!.receipt!
  const read = ctx.teams.readChannelPage.bind(ctx.teams)
  const changed = vi.spyOn(ctx.teams, 'readChannelPage').mockImplementation(async (request) => {
    const page = await read(request)
    if (request.afterCursor !== receipt.sequence - 1) return page
    const record = page.records[0]
    if (record?.type !== 'channel/envelope') throw new Error('Fixture publication missing')
    if (field === 'missing') return { ...page, records: [] }
    const envelope = { ...record.envelope }
    if (field === 'position') envelope.sequence += 1
    if (field === 'identity') envelope.id = envelopeIdSchema.parse('foreign')
    if (field === 'team') envelope.teamId = teamIdSchema.parse('foreign')
    if (field === 'channel') envelope.channelId = channelIdSchema.parse('foreign')
    if (field === 'sender') envelope.senderId = participantIdSchema.parse('foreign')
    if (field === 'audience') envelope.audience = []
    if (field === 'kind') envelope.kind = 'other'
    if (field === 'delivery') envelope.delivery = 'turn'
    if (field === 'payload') envelope.payload = { content: [{ type: 'text', text: 'Unrecorded content' }] }
    return { ...page, records: [{ ...record, envelope }] }
  })
  try { await expect(connection.collectCheckpointCandidate(4, 2)).rejects.toThrow(/publication/) }
  finally { changed.mockRestore() }
  expect(run.snapshot().operations[operation]!.outbox!.receipt).toEqual(receipt)
  const candidate = await connection.collectCheckpointCandidate(4, 2)
  try { await candidate.validate() }
  finally { candidate.release() }
})

it('rejects mixed publication cuts and a missing channel owner', async () => {
  const { ctx, run, connection, operation, channel, simTimeSchema } = await preparedPost()
  const { validateAcceptedTargets } = await import('../src/target-references.ts')
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const receipt = run.snapshot().operations[operation]!.outbox!.receipt!
  const current = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  const prior = await ctx.teams.getPersistenceReference({ kind: 'channel', channelId: channel.manifest.id,
    expectedCursor: current.cursor, prefixCursor: receipt.sequence - 1 })
  await expect(validateAcceptedTargets(ctx, run.snapshot(), [], [], () => {})).rejects.toThrow(/outside its retained channel prefix/)
  await expect(validateAcceptedTargets(ctx, run.snapshot(), [prior], [], () => {})).rejects.toThrow(/outside its retained channel prefix/)
})

it.each(['message', 'task'] as const)('rejects an applied %s projection without its target receipt', async (kind) => {
  const h = kind === 'message' ? await preparedPost() : await preparedTask()
  const id = 'operation' in h ? h.operation : h.operationId
  const { validateAcceptedTargets } = await import('../src/target-references.ts')
  const { simTimeSchema } = await import('@clocky/clocky-simulation')
  await h.run.drive({ until: simTimeSchema.parse('5') })
  await h.connection.dispatchOperation(id, () => 100)
  const state = h.run.snapshot(), operation = state.operations[id]!
  const withoutOutbox = { ...operation }
  delete withoutOutbox.outbox
  const withoutReceipt = { ...operation, outbox: { ...operation.outbox! } }
  delete withoutReceipt.outbox.receipt
  delete withoutReceipt.outbox.taskReceipt
  for (const value of [withoutOutbox, withoutReceipt]) {
    const incomplete = { ...state, operations: { [id]: value } }
    await expect(validateAcceptedTargets(h.ctx, incomplete, [], [], () => {})).rejects.toThrow(/has no .*receipt/)
  }
  expect(h.run.snapshot()).toEqual(state)
})

it('does not demand cross-owner targets for pending publications or completed local transfers', async () => {
  const { ctx, run, connection, entityId } = await preparedPost()
  const { simulationResourceSpecSchema, simulationProposalSchema, simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const { validateAcceptedTargets } = await import('../src/target-references.ts')
  for (const [id, quantity] of [['stock', '1'], ['received', '0']]) {
    await run.createResource(simulationResourceSpecSchema.parse({ id, quantity, owner: entityId, controllers: [entityId],
      kind: 'inventory', unit: 'item' }), run.snapshot().revision)
  }
  const decision = simulationDecisionIdSchema.parse('local-effect')
  await connection.openDecision(entityId, decision)
  const accepted = await connection.submitDecision(entityId, decision, [simulationProposalSchema.parse({ after: [], action: {
    kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
      reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
      transfers: [{ from: 'stock', to: 'received', quantity: '1' }] },
  } })])
  expect((await run.executeOperation(accepted.operationIds[0]!)).status).toBe('applied')
  const reads = vi.spyOn(ctx.teams, 'readChannelPage')
  await validateAcceptedTargets(ctx, run.snapshot(), [], [], () => {})
  expect(reads).not.toHaveBeenCalled()
})

it('rechecks publication permission after awaited Team policy before committing an Envelope', async () => {
  const { ctx, run, connection, entityId, channel, sender, operation, simTimeSchema } = await preparedPost()
  await sender.dispose()
  await run.drive({ until: simTimeSchema.parse('5') })
  const remove = ctx.teams.registerPolicy('send', { name: 'withdraw-simulation-publication', async apply(_request, next) {
    const current = run.snapshot().entities[entityId]
    if (current === undefined) throw new Error('fixture entity missing')
    await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: entityId,
      entityRevision: current.revision, phase: 'inactive' }), run.snapshot().revision)
    return await next()
  } })
  try {
    expect(await connection.dispatchOperation(operation, () => 100)).toMatchObject({ status: 'settled',
      result: { status: 'blocked-authority', code: 'TEAM_POLICY_DENIED' } })
    const page = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
    expect(page.records.some(record => record.type === 'channel/envelope')).toBe(false)
  } finally { remove() }
})

it.each(['flush', 'receipt-response'])('retries recipient %s failure without duplicate input or wake', async (failure) => {
  const { ctx, run, connection, operation, channel, receiverId, simTimeSchema, model } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const ack = ctx.teams.ackChannelEnvelope.bind(ctx.teams)
  const fault = failure === 'flush'
    ? vi.spyOn(ctx.sessions, 'flush').mockRejectedValueOnce(new Error('Recipient flush failed'))
    : vi.spyOn(ctx.teams, 'ackChannelEnvelope').mockImplementationOnce(async (request) => {
      await ack(request)
      throw new Error('Receipt response lost')
    })
  await expect(connection.receiveOperation(operation)).rejects.toThrow(/Recipient flush|Receipt response/)
  fault.mockRestore()
  expect((await run.drive({ until: simTimeSchema.parse('20') })).reason).toBe('delivery-required')
  expect(run.snapshot().time).toBe('5')
  if (failure === 'flush') {
    expect(run.snapshot().operations[operation]?.delivery).toBeUndefined()
    expect((await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
      .some(record => record.type === 'channel/receipt')).toBe(false)
  }
  const wakeId = await connection.receiveOperation(operation)
  expect(await connection.receiveOperation(operation)).toBe(wakeId)
  const binding = run.snapshot().entities[receiverId]?.binding
  const actor = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
  expect(actor?.inbox.nextStep).toHaveLength(1)
  expect((await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
    .filter(record => record.type === 'channel/receipt')).toHaveLength(1)
  expect(model.requests).toHaveLength(0)
})

it('restores receipted input claimed by a rejected step without acknowledging a second time', async () => {
  const { ctx, run, connection, operation, receiverId, simTimeSchema, model } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const wake = await connection.receiveOperation(operation)
  await run.drive({ until: simTimeSchema.parse('5') })
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const id = simulationDecisionIdSchema.parse('retry-received-input')
  await connection.openDecision(receiverId, id, wake)
  await connection.prepareContext(receiverId, id, contextRequest())
  const reject = ctx.on('agent/pre-step', async () => ({ kind: 'reject' as const }), { prepend: true })
  await connection.dispatchDecision(receiverId, id)
  const binding = run.snapshot().entities[receiverId]?.binding
  const actor = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
  if (actor === undefined) throw new Error('fixture receiver missing')
  await actor.whenIdle()
  reject()
  expect(actor.inbox.hasPending).toBe(false)
  expect(model.requests).toHaveLength(0)
  await connection.receiveOperation(operation)
  await connection.dispatchDecision(receiverId, id)
  await actor.whenIdle()
  expect(model.requests).toHaveLength(1)
  expect(model.requests[0]?.messages.filter(message => message.source.kind === 'team-envelope')).toHaveLength(1)
  await connection.submitDecision(receiverId, id, [])
  expect(await connection.receiveOperation(operation)).toBe(wake)
  expect(actor.session.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'team-envelope')).toHaveLength(1)
})

it('restores receipted input locally before a new epoch opens a decision', async () => {
  const { ctx, run, connection, operation, receiverId, receiver, simTimeSchema, model } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const wake = await connection.receiveOperation(operation)
  await run.drive({ until: simTimeSchema.parse('5') })
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const old = simulationDecisionIdSchema.parse('interrupted-receipt')
  await connection.openDecision(receiverId, old, wake)
  await connection.prepareContext(receiverId, old, contextRequest())
  const reject = ctx.on('agent/pre-step', async () => ({ kind: 'reject' as const }), { prepend: true })
  await connection.dispatchDecision(receiverId, old)
  await receiver.localAgent?.whenIdle()
  reject()
  await receiver.dispose()
  const resumed = await connection.activate(receiverId, { ...placement(), seed: { kind: 'resume' },
    agent: { options: { provider: 'mock', model: 'mock' } } })
  const claim = vi.spyOn(ctx.teams, 'claimChannelDelivery').mockRejectedValue(new Error('No Hub notification or claim available'))
  try {
    const next = simulationDecisionIdSchema.parse('restored-receipt')
    await connection.openDecision(receiverId, next, wake)
    await connection.prepareContext(receiverId, next, contextRequest())
    await connection.dispatchDecision(receiverId, next)
    await resumed.localAgent?.whenIdle()
    expect(claim).not.toHaveBeenCalled()
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.messages.filter(message => message.source.kind === 'team-envelope')).toHaveLength(1)
  } finally { claim.mockRestore() }
})

it.each(['serial', 'window', 'window-resume'])('retires deterministic Team input before a later model decision: %s', async (mode) => {
  const { ctx, run, connection, receiver, receiverId, operation, simTimeSchema, model } = await preparedPost()
  const { simulationDecisionIdSchema, simulationPolicyRefSchema, simulationWindowIdSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'ignore-message', version: '1' })
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: () => [] })
  await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
  const wake = run.snapshot().operations[operation]!.delivery!.wakeId
  expect(receiver.localAgent?.inbox.hasPending).toBe(true)
  const id = simulationDecisionIdSchema.parse('handled-without-model')
  const windowId = simulationWindowIdSchema.parse('handled-window')
  if (mode !== 'serial') await connection.openWindow({ id: windowId, decisions: [{
    id, entityId: receiverId, context: contextRequest(), wakeId: wake,
  }] })
  await connection.executeDeterministicDecision(receiverId, id, contextRequest(), policy, wake)
  if (mode !== 'serial') await run.commitWindow(windowId)
  expect(run.snapshot().wakes[wake]?.status).toBe('completed')
  if (mode === 'serial') expect(receiver.localAgent?.inbox.hasPending).toBe(false)
  if (mode === 'window-resume') {
    await connection.hibernate(receiverId)
    const resumed = await connection.resume(receiverId, { provider: 'in-process',
      agent: { options: { provider: 'mock', model: 'mock' } }, signal: new AbortController().signal })
    expect(resumed.localAgent?.inbox.hasPending).toBe(false)
  }
  expect(receiver.localAgent?.session.events.some(event => event.type === 'user/message')).toBe(false)
  const next = simulationDecisionIdSchema.parse('later-model')
  await expect(connection.executeDecision(receiverId, next, contextRequest())).rejects.toThrow(/without submitting/)
  expect(model.requests).toHaveLength(1)
  expect(model.requests[0]?.messages.some(message => message.source.kind === 'team-envelope')).toBe(false)
})

it('requires the exact recipient receipt and report body before recording knowledge', async () => {
  const { run, connection, receiverId, entityId, operation, simTimeSchema } = await preparedPost()
  const { simulationKnowledgeRequestSchema } = await import('@clocky/clocky-simulation')
  const action = run.snapshot().operations[operation]!.action
  if (action.kind !== 'communication/post') throw new Error('fixture post missing')
  const request = simulationKnowledgeRequestSchema.parse({ id: 'report', owner: receiverId, expectedRevision: 0,
    statement: action.text, source: { kind: 'report', operationId: operation }, readers: [],
    observedAt: '5', availableAt: '5', validFrom: '5', validUntil: null })
  await expect(run.recordKnowledge(request)).rejects.toThrow(/delivery receipt/)
  await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
  await expect(run.recordKnowledge({ ...request, owner: entityId })).rejects.toThrow(/delivery receipt/)
  await expect(run.recordKnowledge({ ...request, statement: 'Unrelated assertion' })).rejects.toThrow(/delivery receipt/)
  const recorded = await run.recordKnowledge(request)
  expect(run.queryKnowledge({ viewer: receiverId, cursor: run.snapshot().revision, time: simTimeSchema.parse('5'), limit: 1 }))
    .toEqual([recorded])
  expect(run.queryKnowledge({ viewer: entityId, cursor: run.snapshot().revision, time: simTimeSchema.parse('5'), limit: 1 })).toEqual([])
})

it.each(['model', 'model-window', 'deterministic', 'policy-window'])('materializes report knowledge once for %s consumption', async (mode) => {
  const { ctx, run, connection, receiverId, operation, simTimeSchema, model } = await preparedPost()
  const { simulationKnowledgeRequestSchema, simulationDecisionIdSchema, simulationPolicyRefSchema, simulationWindowIdSchema } =
    await import('@clocky/clocky-simulation')
  const action = run.snapshot().operations[operation]!.action
  if (action.kind !== 'communication/post') throw new Error('fixture post missing')
  await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
  const item = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'report', owner: receiverId, expectedRevision: 0,
    statement: action.text, source: { kind: 'report', operationId: operation }, readers: [],
    observedAt: '5', availableAt: '5', validFrom: '5', validUntil: null }))
  const context = { ...contextRequest(), knowledge: { ids: [item.id], required: true, visibleReports: [operation] } }
  const id = simulationDecisionIdSchema.parse('report-consumer')
  const wake = run.snapshot().operations[operation]!.delivery!.wakeId
  if (mode !== 'model' && mode !== 'model-window') {
    const policy = simulationPolicyRefSchema.parse({ id: 'read-report', version: '1' })
    const decide = vi.fn((view: Readonly<import('@clocky/clocky-session').SimulationContextViewEventData>) => {
      expect(JSON.stringify(view)).toContain(action.text)
      return []
    })
    ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide })
    const windowId = simulationWindowIdSchema.parse('report-window')
    if (mode === 'policy-window') await connection.openWindow({ id: windowId, decisions: [{
      id, entityId: receiverId, context, policy, wakeId: wake,
    }] })
    await connection.executeDeterministicDecision(receiverId, id, context, policy, wake)
    if (mode === 'policy-window') await run.commitWindow(windowId)
    expect(model.requests).toHaveLength(0)
    const next = simulationDecisionIdSchema.parse('model-after-policy')
    await expect(connection.executeDecision(receiverId, next, context)).rejects.toThrow(/without submitting/)
  } else {
    if (mode === 'model-window') {
      const request = { id: simulationWindowIdSchema.parse('model-report-window'), decisions: [{ id, entityId: receiverId, context, wakeId: wake }] }
      const opened = await connection.openWindow(request)
      expect(await connection.openWindow({ ...request, decisions: [{ ...request.decisions[0]!,
        context: { ...context, knowledge: { ...context.knowledge, visibleReports: [] } } }] })).toEqual(opened)
    }
    await expect(connection.executeDecision(receiverId, id, context, wake)).rejects.toThrow(/without submitting/)
  }
  expect(model.requests).toHaveLength(1)
  expect(JSON.stringify(model.requests[0]?.messages).split(action.text)).toHaveLength(2)
})

it('summarizes only an authorized subset without activating an actor or inheriting private inputs', async () => {
  const { ctx, run, connection, entityId } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationKnowledgeRequestSchema, simulationSummaryRequestSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const reader = simulationEntityIdSchema.parse('reader')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: reader, entityKind: 'person', cognition: 'none', profile: {} }),
    run.snapshot().revision)
  const base = simulationKnowledgeRequestSchema.parse({ id: 'secret', owner: entityId, expectedRevision: 0, statement: 'SECRET',
    source: { kind: 'belief', profileRevision: 1, policyVersion: '1', confidence: 1 }, observedAt: '0', availableAt: '0',
    validFrom: '0', validUntil: null, readers: [] })
  const secret = await run.recordKnowledge(base)
  const publicRequest = simulationKnowledgeRequestSchema.parse({ ...base, id: 'public', statement: 'PUBLIC', readers: [reader] })
  const shared = await run.recordKnowledge(publicRequest)
  const policy = simulationPolicyRefSchema.parse({ id: 'extract', version: '1' })
  const summarize = vi.fn((items: readonly Readonly<Omit<import('@clocky/clocky-simulation').SimulationKnowledge, 'readers'>>[]) => {
    expect(Object.isFrozen(items)).toBe(true)
    expect(items.every(item => !('readers' in item))).toBe(true)
    return items.map(item => item.statement).join('; ')
  })
  const remove = ctx.simulationTeams.registerSummaryPolicy({ ...policy, summarize })
  expect(() => ctx.simulationTeams.registerSummaryPolicy({ ...policy, summarize })).toThrow(/already registered/)
  const request = simulationSummaryRequestSchema.parse({ id: 'digest', expectedRevision: 0, inputs: [secret.id, shared.id],
    readers: [reader], availableAt: '0', validFrom: '0', validUntil: null })
  await expect(connection.summarizeKnowledge(entityId, policy, request)).rejects.toThrow(/complete source subset/)
  expect(summarize).not.toHaveBeenCalled()
  const acceptedRequest = { ...request, inputs: [shared.id] }
  const result = await connection.summarizeKnowledge(entityId, policy, acceptedRequest)
  expect(result.statement).toBe('PUBLIC')
  expect(result.source).toMatchObject({ kind: 'summary', policy, premises: [{ id: shared.id, revision: 1 }] })
  remove()
  expect(await connection.summarizeKnowledge(entityId, policy, acceptedRequest)).toEqual(result)
  expect(summarize).toHaveBeenCalledTimes(1)
  await run.recordKnowledge({ ...publicRequest, expectedRevision: 1, readers: [] })
  expect(run.queryKnowledge({ viewer: reader, cursor: run.snapshot().revision, time: run.snapshot().time, limit: 10 })).toEqual([])
  expect(run.population().chargedActors).toBe(0)
  expect(run.budgetUsage().tokens.used).toBe(0)
})

it.each([{ overflow: false, modelBacked: false, reportOnly: false }, { overflow: true, modelBacked: false, reportOnly: false },
  { overflow: false, modelBacked: true, reportOnly: false }, { overflow: false, modelBacked: false, reportOnly: true }])
('restores compacted reports with %j', async ({ overflow, modelBacked, reportOnly }) => {
  const { ctx, run, connection, receiver, receiverId, operation, simTimeSchema, model } = await preparedPost(16, overflow ? 1024 : 65536, overflow || reportOnly ? 'large-report '.repeat(400) : 'Private scheduled message')
  const { BasicCompactionEngine } = await import('@clocky/clocky-compaction-basic')
  const { default: TokenMeter } = await import('@clocky/clocky-token-meter')
  const tools = await import('@clocky/clocky-tool-simulation')
  const { toolCallResponse } = await import('../../../core/agent-loop/tests/mock-adapter.ts')
  const { simulationKnowledgeRequestSchema, simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await ctx.plugin(TokenMeter)
  await ctx.plugin(modelBacked ? BasicCompactionEngine : class extends BasicCompactionEngine {
    override async summarize(): Promise<import('@clocky/clocky-compaction-basic/src/summarizer.ts').SummaryResult> {
      return { summary: [{ type: 'text', text: 'compacted' }], provider: 'template', model: 'template' }
    }
  }, { auto: false })
  await ctx.plugin(tools)
  const scripted = new MockAdapter([toolCallResponse('observe-compact', 'simulation_observe', {}),
    ...modelBacked ? [textResponse('compacted')] : [],
    toolCallResponse('stage-compact', 'simulation_stage', { proposals: [] }),
    toolCallResponse('submit-compact', 'simulation_submit', {})])
  vi.spyOn(model, 'stream').mockImplementation(async function* (options) {
    if (options.purpose === 'compaction') {
      const actor = receiver.localAgent
      if (actor === undefined) throw new Error('fixture actor missing')
      const location = ctx.sessionPersistence.locate(actor.session.header)
      if (location === undefined) throw new Error('fixture Session path missing')
      const records = (await readFile(location.path, 'utf8')).trim().split('\n')
        .map(line => JSON.parse(line) as { type: string; data: unknown })
      expect(records.findLast(event => event.type === 'compaction/request')?.data)
        .toEqual(actor.session.events.findLast(event => event.type === 'compaction/request')?.data)
      expect(ctx.simulationTeams.modelUsage().active).toBe(1)
    }
    yield* scripted.stream(options)
  })
  await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
  const action = run.snapshot().operations[operation]!.action
  if (action.kind !== 'communication/post' || receiver.localAgent === undefined) throw new Error('fixture report missing')
  const actor = receiver.localAgent
  const item = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'compact-report', owner: receiverId,
    expectedRevision: 0, statement: action.text, source: { kind: 'report', operationId: operation }, readers: [],
    observedAt: '5', availableAt: '5', validFrom: '5', validUntil: null }))
  let compacted = false
  const remove = ctx.on('agent/pre-step', async (event, next) => {
    const result = await next()
    if (event.agent === actor && event.step === 2 && !compacted) {
      const nodes = actor.session.surface.nodes
      const report = nodes.find((seq) => {
        const value = actor.session.events[seq]
        return value?.type === 'user/message' && value.data.source.kind === 'team-envelope'
      })
      if (reportOnly) expect(report).toBeDefined()
      await ctx.compaction.compactRegion(reportOnly ? report! : nodes[0]!, reportOnly ? report! : nodes.at(-1)!, actor, event.signal)
      if (reportOnly) expect(actor.session.surface.nodes.filter(seq => actor.session.events[seq]?.type === 'simulation/context-view')).toHaveLength(1)
      compacted = true
    }
    return result
  })
  try {
    const id = simulationDecisionIdSchema.parse('compact-decision')
    const wake = run.snapshot().operations[operation]!.delivery!.wakeId
    const work = connection.executeDecision(receiverId, id,
      { ...contextRequest(), knowledge: { ids: [item.id], required: true } }, wake)
    if (overflow) {
      await expect(work).rejects.toThrow(/prepared input/)
      expect(run.snapshot().stall?.code).toBe('SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW')
      expect(scripted.requests).toHaveLength(1)
      return
    }
    const accepted = await work
    expect(accepted.status).toBe('accepted')
    expect(compacted).toBe(true)
    expect(scripted.requests).toHaveLength(modelBacked ? 4 : 3)
    const auxiliary = Object.values(run.snapshot().tokenReservations ?? {}).filter(value => value.compactionId !== undefined)
    expect(auxiliary).toHaveLength(modelBacked ? 1 : 0)
    if (modelBacked) {
      expect(auxiliary[0]).toMatchObject({ status: 'settled', usage: { inputTokens: 10, outputTokens: 9 }, request: { provider: 'mock', model: 'mock' } })
      expect(auxiliary[0]!.decisionId).toBeUndefined()
      const request = actor.session.events.find(event => event.type === 'compaction/request')
      expect(request?.type === 'compaction/request' && request.data.request.messages).toEqual(scripted.requests[1]!.messages)
    }
    for (const request of scripted.requests.filter(value => value.purpose !== 'compaction')) expect(JSON.stringify(request.messages).split(action.text)).toHaveLength(2)
    expect(actor.session.events.filter(event => event.type === 'simulation/context-view')).toHaveLength(2)
    expect(actor.session.surface.nodes.filter(seq => actor.session.events[seq]?.type === 'simulation/context-view')).toHaveLength(1)
    expect(accepted.context?.status === 'prepared' && accepted.context.previousPresentationHashes?.length).toBe(1)
    expect(accepted.context?.status === 'prepared' && accepted.context.referencedReports).toEqual([])
  } finally { remove() }
})

it('coordinates due publication and receipt before returning a decision requirement', async () => {
  const { run, connection, operation, simTimeSchema, model } = await preparedPost()
  const first = connection.drive({ until: simTimeSchema.parse('10') }, () => 100)
  expect(connection.drive({ until: simTimeSchema.parse('10') }, () => 100)).toBe(first)
  await expect(connection.drive({ until: simTimeSchema.parse('20') }, () => 100)).rejects.toThrow(/another horizon/)
  expect(await first).toMatchObject({ reason: 'decision-required', rounds: 3 })
  expect(run.snapshot().time).toBe('5')
  expect(run.snapshot().operations[operation]?.delivery?.receipt).toBeDefined()
  expect(model.requests).toHaveLength(0)
})

it('reports a dormant recipient without advancing beyond its unreceived publication', async () => {
  const { run, connection, receiver, receiverId, operation, simTimeSchema } = await preparedPost()
  await receiver.dispose()
  expect(await connection.drive({ until: simTimeSchema.parse('10') }, () => 100))
    .toMatchObject({ reason: 'recipient-required', operationId: operation, entityId: receiverId })
  expect(run.snapshot().time).toBe('5')
  expect(run.snapshot().operations[operation]?.delivery).toBeUndefined()
  await connection.activate(receiverId, { ...placement(), seed: { kind: 'resume' } })
  expect(await connection.drive({ until: simTimeSchema.parse('10') }, () => 100)).toMatchObject({ reason: 'decision-required' })
})

it('bounds automatic recipient placement and excludes overlapping coordinator calls', async () => {
  const { run, connection, receiverId, operation, simTimeSchema, model } = await preparedPost(1)
  await connection.hibernate(receiverId)
  const request = { until: simTimeSchema.parse('10') }
  const choose = () => ({ activation: { ...placement(), seed: { kind: 'resume' as const } }, evict: [] })
  const first = connection.driveResident(request, () => 100, choose)
  await expect(connection.drive(request, () => 100)).rejects.toThrow(/resident drive/)
  await expect(connection.driveResident(request, () => 100, choose)).rejects.toThrow(/resident drive/)
  expect(await first).toMatchObject({ reason: 'coordination-limit', rounds: 1 })
  expect(await connection.driveResident(request, () => 100, choose)).toMatchObject({ reason: 'coordination-limit', rounds: 1 })
  expect(run.snapshot().entities[receiverId]?.writer?.phase).toBe('active')
  expect(run.snapshot().operations[operation]?.delivery).toBeUndefined()
  expect(await connection.driveResident(request, () => 100, choose)).toMatchObject({ reason: 'coordination-limit', rounds: 1 })
  expect(run.snapshot().operations[operation]?.delivery?.receipt).toBeDefined()
  expect(await connection.driveResident(request, () => 100, choose)).toMatchObject({ reason: 'decision-required', rounds: 1 })
  expect(model.requests).toHaveLength(0)
})

it('returns the persisted retry deadline instead of spinning on a failed Team publication', async () => {
  const { ctx, run, connection, operation, simTimeSchema } = await preparedPost()
  const fault = vi.spyOn(ctx.teams, 'postChannelEnvelope').mockRejectedValueOnce(new Error('Transport unavailable'))
  expect(await connection.drive({ until: simTimeSchema.parse('10') }, () => 100))
    .toMatchObject({ reason: 'retry', operationId: operation, nextAttemptAt: 110 })
  expect(fault).toHaveBeenCalledTimes(1)
  expect(await connection.drive({ until: simTimeSchema.parse('10') }, () => 105)).toMatchObject({ reason: 'retry', nextAttemptAt: 110 })
  expect(fault).toHaveBeenCalledTimes(1)
  fault.mockRestore()
  expect(run.snapshot().time).toBe('5')
  expect(await connection.drive({ until: simTimeSchema.parse('10') }, () => 110)).toMatchObject({ reason: 'decision-required' })
})

it('bounds coordination rounds while preserving durable publication and receipt progress', async () => {
  const { run, connection, operation, simTimeSchema } = await preparedPost(1)
  const request = { until: simTimeSchema.parse('10') }
  expect(await connection.drive(request, () => 100)).toMatchObject({ reason: 'coordination-limit', rounds: 1 })
  expect(run.snapshot().operations[operation]?.result?.status).toBe('applied')
  expect(run.snapshot().operations[operation]?.delivery).toBeUndefined()
  expect(await connection.drive(request, () => 100)).toMatchObject({ reason: 'coordination-limit', rounds: 1 })
  expect(run.snapshot().operations[operation]?.delivery?.receipt).toBeDefined()
  expect(await connection.drive(request, () => 100)).toMatchObject({ reason: 'decision-required', rounds: 1 })
})

async function dormantInvitation() {
  const fixture = await preparedPost()
  await fixture.sender.dispose()
  await fixture.receiver.dispose()
  const { openTestChannel } = await import('../../../core/team/tests/channel-lifecycle-authority.ts')
  const teamId = fixture.channel.manifest.teamId
  const state = await fixture.ctx.teams.getTeam({ teamId })
  const channel = await openTestChannel(fixture.ctx, { teamId, expectedCursor: state.team.cursor,
    adapter: fixture.channel.manifest.adapter, participants: fixture.channel.manifest.participants, limits: {},
    invitations: [fixture.connection.invitation(fixture.entityId), fixture.connection.invitation(fixture.receiverId)] })
  return { ...fixture, channel, activationsBefore: state.activations.length }
}

it('drains a dormant endpoint acknowledgement before releasing the run owner', async () => {
  const { ctx, run, connection, entityId, channel } = await dormantInvitation()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  ctx.teams.registerPolicy('channel-open', { name: 'hold-dormant-consent', async apply(_request, next) {
    entered.resolve(undefined)
    await release.promise
    return await next()
  } })
  const work = connection.acknowledgeInvitation(entityId, channel.manifest.id)
  const rejected = expect(work).rejects.toThrow()
  await entered.promise
  let closed = false
  const closing = run.close().then(() => { closed = true })
  try {
    await new Promise(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
  } finally {
    release.resolve(undefined)
    await rejected
    await closing
  }
  const admission = await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
  expect(admission.invitations.every(invitation => invitation.status === 'pending')).toBe(true)
})

it('confirms dormant Session endpoints without activation or inference and preserves retry identity', async () => {
  const { ctx, connection, entityId, receiverId, channel, model, activationsBefore } = await dormantInvitation()
  const first = await connection.acknowledgeInvitation(entityId, channel.manifest.id)
  expect(first.channel.phase).toBe('pending')
  const complete = await connection.acknowledgeInvitation(receiverId, channel.manifest.id)
  expect(complete.channel.phase).toBe('active')
  expect(await connection.acknowledgeInvitation(receiverId, channel.manifest.id)).toEqual(complete)
  expect(complete.invitations.every(value => value.endpoint.kind === 'activation'
    && value.endpoint.sessionId !== undefined && value.endpoint.activationId === undefined)).toBe(true)
  expect((await ctx.teams.getTeam({ teamId: channel.manifest.teamId })).activations).toHaveLength(activationsBefore)
  expect(model.requests).toHaveLength(0)
})

it('does not convert expired dormant invitations into acknowledged endpoints', async () => {
  const { ctx, connection, receiverId, channel } = await dormantInvitation()
  const initial = await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
  const clock = vi.spyOn(Date, 'now').mockReturnValue(initial.invitations[0]!.deadline)
  try { await expect(connection.acknowledgeInvitation(receiverId, channel.manifest.id)).rejects.toThrow(/expired/) }
  finally { clock.mockRestore() }
  expect(await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })).toEqual(initial)
})

it('rechecks canonical entity authority after awaited invitation policy', async () => {
  const { ctx, run, connection, receiverId, channel } = await dormantInvitation()
  const remove = ctx.teams.registerPolicy('channel-open', { name: 'retire-invited-entity', async apply(_request, next) {
    const entity = run.snapshot().entities[receiverId]!
    await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: receiverId,
      entityRevision: entity.revision, phase: 'inactive' }), run.snapshot().revision)
    return await next()
  } })
  try { await expect(connection.acknowledgeInvitation(receiverId, channel.manifest.id)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' }) }
  finally { remove() }
  expect((await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })).invitations
    .every(value => value.status === 'pending')).toBe(true)
})

it('revokes invitation proof after its exact confirmation and rejects parameter substitution', async () => {
  const { ctx, connection, receiverId, channel } = await dormantInvitation()
  const acknowledge = ctx.teams.acknowledgeChannelInvitation.bind(ctx.teams)
  let retained: Parameters<typeof acknowledge>[0] | undefined
  const intercept = vi.spyOn(ctx.teams, 'acknowledgeChannelInvitation').mockImplementationOnce(async (request) => {
    retained = request
    expect(() => JSON.stringify(request.actor)).toThrow(/runtime-only/)
    await expect(acknowledge({ ...request, revision: request.revision + 1 })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    return await acknowledge(request)
  })
  try { await connection.acknowledgeInvitation(receiverId, channel.manifest.id) }
  finally { intercept.mockRestore() }
  if (retained === undefined) throw new Error('fixture proof was not captured')
  await expect(acknowledge(retained)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})

it('rejects an invitation frozen to another Session before consenting', async () => {
  const { ctx, connection, entityId, receiverId, channel } = await dormantInvitation()
  const { openTestChannel } = await import('../../../core/team/tests/channel-lifecycle-authority.ts')
  const sender = connection.invitation(entityId)
  const receiver = connection.invitation(receiverId)
  const state = await ctx.teams.getTeam({ teamId: channel.manifest.teamId })
  const wrong = await openTestChannel(ctx, { teamId: state.team.id, expectedCursor: state.team.cursor,
    adapter: channel.manifest.adapter, participants: channel.manifest.participants, limits: {},
    invitations: [sender, { ...receiver, sessionId: sender.sessionId }] })
  await expect(connection.acknowledgeInvitation(receiverId, wrong.manifest.id)).rejects.toThrow(/canonical Session/)
  expect((await ctx.teams.getChannelAdmission({ channelId: wrong.manifest.id })).invitations.every(value => value.status === 'pending')).toBe(true)
})

it('retains authoritative Team abandonment as a stalled delivery without inventing a receipt', async () => {
  const { ctx, run, connection, operation, channel, sender, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const { teamClosureIdempotencyKeySchema } = await import('@clocky/clocky-team')
  const actor = ctx.teams.openActivationActorProofIssuer().issue(sender.binding)
  const state = await ctx.teams.getTeam({ teamId: channel.manifest.teamId })
  try {
    await ctx.teams.cancelTeam({ actor: actor.proof, teamId: state.team.id, expectedCursor: state.team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('simulation-delivery-cancelled'),
      reason: { code: 'USER_CANCELLED', message: 'Cancel pending recipient delivery' } })
  } finally { actor.revoke() }
  expect(await connection.drive({ until: simTimeSchema.parse('10') }, () => 200)).toMatchObject({ reason: 'stalled' })
  expect(run.snapshot()).toMatchObject({ time: '5', stall: { code: 'SIM_DELIVERY_FAILED', operationId: operation } })
  expect(run.snapshot().operations[operation]).toMatchObject({ result: { status: 'applied' },
    deliveryFailure: { record: { type: 'channel/delivery-expired', reason: 'cancellation' } } })
  expect(run.snapshot().operations[operation]?.delivery).toBeUndefined()
  await expect(run.setPhase('running', run.snapshot().revision)).rejects.toThrow(/reconciliation/)
})

it.each(['absent', 'flushed', 'recorded'] as const)('reconciles %s recipient input after definitive transport failure', async (stage) => {
  const { ctx, run, connection, operation, receiverId, receiver, channel, simTimeSchema, model } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  if (stage !== 'absent') {
    const fault = stage === 'flushed'
      ? vi.spyOn(run, 'recordDelivery').mockRejectedValueOnce(new Error('Lost local record'))
      : vi.spyOn(ctx.teams, 'ackChannelEnvelope').mockRejectedValueOnce(new Error('Target unavailable'))
    try { await expect(connection.receiveOperation(operation)).rejects.toThrow(/Lost local|Target unavailable/) }
    finally { fault.mockRestore() }
  }
  const entity = run.snapshot().entities[receiverId]!
  const receipt = run.snapshot().operations[operation]!.outbox!.receipt!
  const current = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  await run.recordDeliveryFailure(operation, { type: 'channel/delivery-expired', sequence: current.cursor + 1,
    createdAt: Date.now(), participantId: entity.binding!.participantId, envelopeId: receipt.envelopeId,
    envelopeSequence: current.cursor, reason: 'closure' }, run.snapshot().revision)
  const disposition = stage === 'absent' ? 'absent-input' : 'retained-input'
  expect(await connection.reconcileDeliveryFailure(operation)).toBe(disposition)
  expect(await connection.reconcileDeliveryFailure(operation)).toBe(disposition)
  expect(run.snapshot().phase).toBe('stalled')
  await run.setPhase('running', run.snapshot().revision)
  expect(await connection.drive({ until: simTimeSchema.parse('10') }, () => 100))
    .toMatchObject({ reason: stage === 'absent' ? 'until' : 'decision-required' })
  expect(receiver.localAgent?.inbox.nextStep).toHaveLength(stage === 'absent' ? 0 : 1)
  expect(run.snapshot().operations[operation]?.delivery?.receipt).toBeUndefined()
  expect(model.requests).toHaveLength(0)
})

it('does not record target failure when delivery evidence cannot be read', async () => {
  const { ctx, run, connection, operation, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const unavailable = vi.spyOn(ctx.teams, 'readChannelPage').mockRejectedValueOnce(new Error('Evidence temporarily unavailable'))
  try { await expect(connection.drive({ until: simTimeSchema.parse('10') }, () => 100)).rejects.toThrow(/temporarily unavailable/) }
  finally { unavailable.mockRestore() }
  expect(run.snapshot().operations[operation]?.deliveryFailure).toBeUndefined()
  expect(run.snapshot().phase).toBe('running')
  expect(await connection.drive({ until: simTimeSchema.parse('10') }, () => 100)).toMatchObject({ reason: 'decision-required' })
})

it('accepts model-staged proposals without executing effects and concludes the submitted turn', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const ToolSimulation = await import('@clocky/clocky-tool-simulation')
  await ctx.plugin(ToolSimulation)
  const { toolCallResponse } = await import('../../../core/agent-loop/tests/mock-adapter.ts')
  const { simulationResourceSpecSchema, simulationDecisionIdSchema, simTimeSchema } = await import('@clocky/clocky-simulation')
  for (const [id, quantity] of [['wallet', '2'], ['spent', '0']]) {
    await run.createResource(simulationResourceSpecSchema.parse({ id, quantity, owner: entityId,
      kind: 'money', unit: 'cent', controllers: [entityId] }), run.snapshot().revision)
  }
  const proposals = [{ after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
    commitmentId: null, reads: [{ resourceId: 'wallet', revision: 1 }, { resourceId: 'spent', revision: 1 }],
    transfers: [{ from: 'wallet', to: 'spent', quantity: '1' }],
  } } }]
  const model = new MockAdapter([toolCallResponse('observe', 'simulation_observe', {}),
    toolCallResponse('stage', 'simulation_stage', { proposals }), toolCallResponse('submit', 'simulation_submit', {})])
  ctx.llm.registerAdapter(['simulation-tools'], model)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'simulation-tools', model: 'fixture' } } })
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('model-proposal')
  await connection.openDecision(entityId, id)
  await connection.prepareContext(entityId, id, contextRequest())
  const actor = lease.localAgent!
  await expect(ctx.simulationTeams.modelRequest(actor, { kind: 'observe' }, new AbortController().signal)).rejects.toThrow(/prepared decision input/)
  await connection.dispatchDecision(entityId, id)
  await actor.whenIdle()
  expect(model.requests).toHaveLength(3)
  expect(run.snapshot().decisions[id]?.status).toBe('accepted')
  expect(Object.values(run.snapshot().resources).map(resource => resource.quantity)).toEqual(['2', '0'])
  const results = actor.session.events.filter(event => event.type === 'tool/result')
  expect(results).toHaveLength(3)
  const result = results.at(-1)?.data.message.content.find(block => block.type === 'tool-result')
  expect(result?.isError).toBe(false)
  expect(result?.content).toEqual([{ type: 'text', text: JSON.stringify({ status: 'accepted',
    operationIds: run.snapshot().decisions[id]?.operationIds, effects: 'pending' }) }])
  expect(await ctx.simulationTeams.modelRequest(actor, { kind: 'submit' }, new AbortController().signal)).toMatchObject({ status: 'accepted' })
  await run.drive({ until: simTimeSchema.parse('0') })
  expect(Object.values(run.snapshot().resources).map(resource => resource.quantity)).toEqual(['1', '1'])
  await lease.dispose()
  await expect(ctx.simulationTeams.modelRequest(actor, { kind: 'observe' }, new AbortController().signal)).rejects.toThrow(/no Simulation/)
})

it('denies other tools for Simulation actors and revokes model tool registrations on unload', async () => {
  const { ctx, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { CallId } = await import('@clocky/clocky-llm')
  const { defineTool } = await import('@clocky/clocky-tools')
  const ToolSimulation = await import('@clocky/clocky-tool-simulation')
  const fiber = ctx.plugin(ToolSimulation)
  await fiber
  const execute = vi.fn(async () => true)
  ctx.tools.register(defineTool({ name: 'outside-simulation', description: 'Unrelated capability', parameters: {},
    output: { schema: { type: 'boolean' }, render: () => [] }, execute }))
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, placement())
  const request = { callId: CallId('forbidden'), name: 'outside-simulation', arguments: {}, signal: new AbortController().signal }
  expect(await ctx.tools.execute({ ...request, agent: lease.localAgent! })).toMatchObject({ isError: true })
  expect(execute).not.toHaveBeenCalled()
  expect(await ctx.tools.execute(request)).toMatchObject({ isError: false })
  expect(await ctx.tools.execute({ ...request, name: 'simulation_observe' })).toMatchObject({ isError: true })
  expect(await ctx.tools.execute({ ...request, name: 'simulation_submit', agent: lease.localAgent! })).toMatchObject({ isError: true })
  await fiber.dispose()
  expect(ctx.tools.schemas().some(tool => tool.name.startsWith('simulation_'))).toBe(false)
})

it('reserves one Team before Hub IO and reconciles a lost creation response', async () => {
  const { ctx, run, entityId } = await setup(false)
  const creation = { goal: { objective: 'Canonical company', budgets: {} }, budgets: {} }
  const create = ctx.teams.createTeam.bind(ctx.teams)
  let targetId: import('@clocky/clocky-team').TeamId | undefined
  let retained: Parameters<typeof create>[0] | undefined
  const fault = vi.spyOn(ctx.teams, 'createTeam').mockImplementationOnce(async (request) => {
    retained = request
    expect(run.snapshot().teamReservation?.confirmed).toBe(false)
    await expect(run.setPhase('running', run.snapshot().revision)).rejects.toThrow(/confirmed before running/)
    expect(() => JSON.stringify(request.actor)).toThrow(/runtime-only/)
    await expect(create({ ...request, goal: { objective: 'Tampered', budgets: {} } })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const team = await create(request)
    targetId = team.team.id
    await expect(ctx.simulationTeams.attach(run, targetId, 'simulation/bootstrap')).rejects.toThrow(/confirmed canonical/)
    throw new Error('Root creation response lost')
  })
  await expect(ctx.simulationTeams.ensureTeam(run, creation, 'simulation/bootstrap')).rejects.toThrow(/response lost/)
  fault.mockRestore()
  const team = await ctx.simulationTeams.ensureTeam(run, creation, 'simulation/bootstrap')
  expect(team.team.id).toBe(targetId)
  expect(run.snapshot().teamReservation).toMatchObject({ teamId: targetId, confirmed: true })
  expect((await ctx.teams.listTeamsPage({ afterCursor: -1, limit: 10 })).items).toHaveLength(2)
  expect((await ctx.simulationTeams.ensureTeam(run, creation, 'simulation/bootstrap')).team.id).toBe(targetId)
  await expect(ctx.simulationTeams.ensureTeam(run, { ...creation, budgets: { other: 1 } }, 'simulation/bootstrap'))
    .rejects.toThrow(/changed its creation payload/)
  if (retained === undefined) throw new Error('fixture root proof missing')
  await expect(create(retained)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/bootstrap')
  const participant = await inviteBootstrapParticipant(ctx, { teamId: team.team.id, expectedCursor: team.team.cursor,
    kind: 'local-agent', displayName: 'Buyer', role: 'buyer', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    const current = await ctx.teams.getTeam({ teamId: team.team.id })
    await transitionBootstrapParticipant(ctx, { teamId: team.team.id, participantId: participant.id,
      expectedCursor: current.team.cursor, phase })
  }
  expect((await connection.bind(entityId, participant.id)).teamId).toBe(targetId)
})

it('coalesces root bootstrap and holds run ownership until accepted target IO settles', async () => {
  const { ctx, run } = await setup(false)
  const entered = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const create = ctx.teams.createTeam.bind(ctx.teams)
  const calls = vi.spyOn(ctx.teams, 'createTeam').mockImplementation(async (request) => {
    entered.resolve(undefined)
    await finish.promise
    return await create(request)
  })
  const creation = { goal: { objective: 'Drain root creation', budgets: {} }, budgets: {} }
  const first = ctx.simulationTeams.ensureTeam(run, creation, 'simulation/bootstrap')
  const second = ctx.simulationTeams.ensureTeam(run, creation, 'simulation/bootstrap')
  await entered.promise
  expect(calls).toHaveBeenCalledTimes(1)
  await expect(ctx.simulationTeams.ensureTeam(run, { ...creation, budgets: { other: 1 } }, 'simulation/bootstrap'))
    .rejects.toThrow(/another creation payload/)
  let closed = false
  const closing = run.close().then(() => { closed = true })
  await Promise.resolve()
  expect(closed).toBe(false)
  const settled = Promise.allSettled([first, second])
  finish.resolve(undefined)
  expect((await settled).every(value => value.status === 'rejected')).toBe(true)
  await closing
  expect(run.snapshot().teamReservation?.confirmed).toBe(false)
  calls.mockRestore()
})

it('hibernates only an eligible idle actor when explicit residency exhausts its single slot', async () => {
  const { ctx, run, connection, entityId, participant, teamId } = await setup(true, 65536, 16, 60000, 1000000, 1)
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await connection.bind(entityId, participant.id)
  const first = await connection.activate(entityId, placement())
  const other = simulationEntityIdSchema.parse('other')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: other, entityKind: 'person', cognition: 'agent', profile: {} }),
    run.snapshot().revision)
  const currentTeam = await ctx.teams.getTeam({ teamId })
  const otherParticipant = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: currentTeam.team.cursor,
    kind: 'local-agent', displayName: 'Other', role: 'worker', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    const current = await ctx.teams.getTeam({ teamId })
    await transitionBootstrapParticipant(ctx, { teamId, participantId: otherParticipant.id, expectedCursor: current.team.cursor, phase })
  }
  await connection.bind(other, otherParticipant.id)
  const request = { activation: placement(), evict: [entityId] }
  const abort = new AbortController()
  abort.abort(new Error('Residency cancelled'))
  await expect(connection.ensureResident(other, { ...request, activation: { ...placement(), signal: abort.signal } }))
    .rejects.toThrow('Residency cancelled')
  expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('active')
  await expect(connection.ensureResident(other, { ...request, evict: [entityId, entityId] })).rejects.toThrow(/must be distinct/)
  await expect(connection.ensureResident(other, { ...request, evict: [simulationEntityIdSchema.parse('missing')] }))
    .rejects.toThrow(/does not exist/)
  await run.setPhase('running', run.snapshot().revision)
  const decision = simulationDecisionIdSchema.parse('retain-resident')
  await connection.openDecision(entityId, decision)
  expect(await connection.ensureResident(other, { ...request, evict: [other, entityId] })).toEqual({ status: 'capacity', entityId: other })
  expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('active')
  await connection.cancelDecision(entityId, decision)
  const second = await connection.ensureResident(other, { ...request, evict: [entityId, other] })
  expect(second.status).toBe('resident')
  expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('released')
  expect(run.population().chargedActors).toBe(1)
  const reused = await connection.ensureResident(other, request)
  expect(reused.status).toBe('resident')
  if (second.status !== 'resident' || reused.status !== 'resident') throw new Error('fixture residency missing')
  expect(reused.lease.localAgent).toBe(second.lease.localAgent)
  await connection.hibernate(other)
  const resumed = await connection.ensureResident(entityId, { activation: { ...placement(), seed: { kind: 'resume' } }, evict: [] })
  expect(resumed.status).toBe('resident')
  if (resumed.status !== 'resident') throw new Error('fixture resumed residency missing')
  expect(resumed.lease.binding.sessionId).toBe(first.binding.sessionId)
  await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: other,
    entityRevision: run.snapshot().entities[other]!.revision, phase: 'inactive' }), run.snapshot().revision)
  await expect(connection.ensureResident(other, request)).rejects.toThrow(/active bound entity/)
})

it('requires recovery rather than starting a second resident while its writer is reserved', async () => {
  const { run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const reserve = run.reserveWriter.bind(run)
  const held = vi.spyOn(run, 'reserveWriter').mockImplementationOnce(async (...args) => {
    const writer = await reserve(...args)
    entered.resolve(undefined)
    await release.promise
    return writer
  })
  const starting = connection.activate(entityId, placement())
  try {
    await entered.promise
    expect(await connection.ensureResident(entityId, { activation: placement(), evict: [] }))
      .toEqual({ status: 'recovery-required', entityId })
    expect(run.population().chargedActors).toBe(1)
    expect(held).toHaveBeenCalledTimes(1)
  } finally { release.resolve(undefined); await starting; held.mockRestore() }
})

async function preparedDeadline(timeout = 60000) {
  const { ctx, run, connection, entityId, participant } = await setup(true, 65536, 16, timeout)
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  let writer: import('@clocky/clocky-simulation').SimulationWriterLease | undefined
  const reserve = run.reserveWriter.bind(run)
  vi.spyOn(run, 'reserveWriter').mockImplementationOnce(async (...args) => {
    writer = await reserve(...args)
    return writer
  })
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, placement())
  if (writer === undefined || lease.localAgent === undefined) throw new Error('fixture writer missing')
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('already-expired')
  await connection.openDecision(entityId, id)
  const prepared = await connection.prepareContext(entityId, id, contextRequest())
  if (prepared.status !== 'prepared') throw new Error('fixture context overflow')
  return { ctx, run, connection, writer, actor: lease.localAgent, id, prepared }
}

it.each(['close', 'retire'] as const)('drains an already-expired decision write before deadline %s finishes', async (mode) => {
  const { ctx, run, writer, actor, id, prepared } = await preparedDeadline()
  const { SimulationDeadlines } = await import('../src/deadline.ts')
  await writer.startDecision(id, 0)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const expire = writer.expireDecision.bind(writer)
  vi.spyOn(writer, 'expireDecision').mockImplementationOnce(async (...args) => {
    entered.resolve(undefined)
    await release.promise
    return await expire(...args)
  })
  const deadlines = new SimulationDeadlines((error) => { throw error })
  const starting = deadlines.start(writer, id, actor, prepared.view.inputId)
  const rejected = expect(starting).rejects.toThrow('deadline exceeded before model dispatch')
  await entered.promise
  let closed = false
  const closing = (mode === 'close' ? deadlines.close() : deadlines.retire(actor)).then(() => { closed = true })
  try {
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(closed).toBe(false)
    expect(run.snapshot().decisions[id]?.status).toBe('open')
  } finally { release.resolve(undefined); await rejected; await closing }
  expect(run.snapshot().decisions[id]).toMatchObject({ status: 'cancelled', cancellation: 'timeout' })
  expect(ctx.simulationTeams.modelUsage().active).toBe(0)
  await deadlines.close()
  await expect(deadlines.start(writer, id, actor, prepared.view.inputId)).rejects.toThrow(/owner is closed/)
})

it.each([false, true])('stops current inference after expiry persistence fails even when logging throws=%s', async (loggingThrows) => {
  const { ctx, run, connection, entityId, participant } = await setup(true, 65536, 16, 500)
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const entered = Promise.withResolvers<undefined>(), reported = Promise.withResolvers<undefined>()
  const model = new MockAdapter([])
  const streamModel = vi.spyOn(model, 'stream').mockImplementation(async function* (options) {
    const signal = options.signal
    if (signal === undefined) throw new Error('fixture model signal missing')
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', () => { resolve() }, { once: true })
      entered.resolve(undefined)
    })
    signal.throwIfAborted()
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  ctx.llm.registerAdapter(['failed-expiry'], model)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'failed-expiry', model: 'fixture' } } })
  const actor = lease.localAgent
  if (actor === undefined) throw new Error('fixture actor missing')
  const cancel = actor.cancel.bind(actor)
  const cancelled = vi.spyOn(actor, 'cancel')
  await run.setPhase('running', run.snapshot().revision)
  const log = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const append = log.append.bind(log)
  const failed = vi.spyOn(log, 'append').mockImplementation(async (cursor, values, options) => {
    if (JSON.stringify(values).includes('decision/expired')) throw new Error('Expiry storage unavailable')
    return await append(cursor, values, options)
  })
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation((...args) => {
    if (args[0] === 'Simulation deadline persistence failed') {
      reported.resolve(undefined)
      if (loggingThrows) throw new Error('Logger unavailable')
    }
  })
  const id = simulationDecisionIdSchema.parse('failed-expiry')
  const working = connection.executeDecision(entityId, id, contextRequest()).catch((error: unknown) => error)
  try {
    await entered.promise
    await reported.promise
    expect(cancelled).toHaveBeenCalledWith({ kind: 'hook', reason: 'Simulation deadline persistence failed' }, { keepInbox: true })
  } finally {
    warn.mockRestore(); failed.mockRestore()
    cancel({ kind: 'hook', reason: 'Finish expiry test' })
    await working
  }
  expect(run.snapshot().decisions[id]).toMatchObject({ status: 'open' })
  expect(run.snapshot().decisions[id]?.inference?.expiredAt).toBeUndefined()
  expect(ctx.simulationTeams.modelUsage().active).toBe(0)
  expect(streamModel).toHaveBeenCalledTimes(1)
})

it('rearms long deadlines without extending their persisted absolute expiry', async () => {
  const { run, writer, actor, id, prepared } = await preparedDeadline(0x7fffffff + 23)
  const { SimulationDeadlines } = await import('../src/deadline.ts')
  const deadlines = new SimulationDeadlines((error) => { throw error })
  const expire = vi.spyOn(writer, 'expireDecision')
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  try {
    await deadlines.start(writer, id, actor, prepared.view.inputId)
    const timing = run.snapshot().decisions[id]!.inference
    await vi.advanceTimersByTimeAsync(0x7fffffff)
    expect(expire).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    await deadlines.start(writer, id, actor, prepared.view.inputId)
    expect(run.snapshot().decisions[id]?.inference).toEqual(timing)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(23)
    await deadlines.close()
    expect(expire).toHaveBeenCalledTimes(1)
    expect(run.snapshot().decisions[id]).toMatchObject({ status: 'cancelled', cancellation: 'timeout' })
  } finally { await deadlines.close(); vi.useRealTimers() }
})

it.each(['finish', 'close'] as const)('ignores late timer callbacks after %s without retiring another actor', async (mode) => {
  const h = await preparedDeadline()
  const other = await preparedDeadline()
  const { SimulationDeadlines } = await import('../src/deadline.ts')
  const deadlines = new SimulationDeadlines((error) => { throw error })
  const expire = vi.spyOn(h.writer, 'expireDecision')
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  const timer = vi.spyOn(globalThis, 'setTimeout')
  try {
    await deadlines.start(h.writer, h.id, h.actor, h.prepared.view.inputId)
    const callback = timer.mock.calls.at(-1)![0]
    await deadlines.retire(other.actor)
    expect(vi.getTimerCount()).toBe(1)
    if (mode === 'close') await deadlines.close()
    else deadlines.finish(h.id)
    const before = h.run.snapshot()
    callback()
    await Promise.resolve()
    expect(expire).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(h.run.snapshot()).toEqual(before)
  } finally { await deadlines.close(); timer.mockRestore(); vi.useRealTimers() }
})

it('preserves an accepted decision when its uncleared deadline callback arrives', async () => {
  const { run, writer, actor, id, prepared } = await preparedDeadline()
  const { SimulationDeadlines } = await import('../src/deadline.ts')
  actor.session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
  const cancel = vi.spyOn(actor, 'cancel')
  const deadlines = new SimulationDeadlines((error) => { throw error })
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  try {
    await deadlines.start(writer, id, actor, prepared.view.inputId)
    await writer.submitDecision(id, [])
    const before = run.snapshot()
    await vi.advanceTimersByTimeAsync(60000)
    await deadlines.close()
    expect(run.snapshot()).toEqual(before)
    expect(run.snapshot().decisions[id]?.status).toBe('accepted')
    expect(cancel).not.toHaveBeenCalled()
  } finally { await deadlines.close(); vi.useRealTimers() }
})

it('does not arm a deadline when its owner closes during persisted timing admission', async () => {
  const { writer, actor, id, prepared } = await preparedDeadline()
  const { SimulationDeadlines } = await import('../src/deadline.ts')
  const deadlines = new SimulationDeadlines((error) => { throw error })
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const start = writer.startDecision.bind(writer)
  vi.spyOn(writer, 'startDecision').mockImplementationOnce(async (...args) => {
    const timing = await start(...args)
    entered.resolve(undefined)
    await release.promise
    return timing
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const starting = deadlines.start(writer, id, actor, prepared.view.inputId)
  const rejected = expect(starting).rejects.toThrow(/owner is closed/)
  try {
    await entered.promise
    await deadlines.close()
    expect(vi.getTimerCount()).toBe(0)
  } finally { release.resolve(undefined); await rejected; await deadlines.close(); vi.useRealTimers() }
})

it('rebudgets only selected report bodies and retains evidence and presentation history', async () => {
  const { run, connection, receiverId, operation, operations, simTimeSchema } = await preparedPost(16, 65536, 'Long report '.repeat(300), ['Second report'])
  const { simulationKnowledgeRequestSchema, simulationDecisionIdSchema, simulationOperationIdSchema } = await import('@clocky/clocky-simulation')
  const { prepareContext, materializeReports, assertContextProjection } = await import('../../simulation-local/src/context.ts')
  await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
  const state = run.snapshot(), post = state.operations[operation]!
  if (post.action.kind !== 'communication/post') throw new Error('fixture report missing')
  const report = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'report', owner: receiverId, expectedRevision: 0,
    statement: post.action.text, source: { kind: 'report', operationId: operation }, readers: [],
    observedAt: '5', availableAt: '5', validFrom: '5', validUntil: null }))
  const secondReport = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'second-report', owner: receiverId, expectedRevision: 0,
    statement: 'Second report', source: { kind: 'report', operationId: operations[1]! }, readers: [],
    observedAt: '5', availableAt: '5', validFrom: '5', validUntil: null }))
  const belief = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'belief', owner: receiverId, expectedRevision: 0,
    statement: 'Other knowledge', source: { kind: 'belief', profileRevision: 1, policyVersion: '1' }, readers: [],
    observedAt: '5', availableAt: '5', validFrom: '5', validUntil: null }))
  const id = simulationDecisionIdSchema.parse('rebase-audit')
  const decision = await connection.openDecision(receiverId, id, post.delivery!.wakeId)
  const current = run.snapshot()
  const request = { ...contextRequest(), knowledge: { ids: [belief.id, report.id, secondReport.id],
    required: false, visibleReports: [operation, operations[1]!] } }
  request.sections.push({ kind: 'history', required: false, blocks: [{ type: 'text', text: 'Preserved history' }] })
  request.sources.push({ kind: 'team-envelope', teamId: current.entities[receiverId]!.binding!.teamId,
    channelId: post.outbox!.receipt!.channelId, envelopeId: post.outbox!.receipt!.envelopeId },
  { kind: 'run-event', runId: current.spec.runId, sequence: belief.sequence },
  { kind: 'run-event', runId: current.spec.runId, sequence: report.sequence })
  const prepared = prepareContext(current, decision, request)
  if (prepared.status !== 'prepared') throw new Error('fixture context overflow')
  expect(prepared.view.sources.filter(value => value.kind === 'run-event')).toHaveLength(3)
  expect(prepared.view.content.at(-1)?.kind).toBe('history')
  expect(prepareContext(current, decision, { ...request, maxBytes: 1 })).toMatchObject({ status: 'overflow', visibleReports: [operation, operations[1]] })
  const rebased = materializeReports(current, { ...decision, context: prepared }, [operation])
  if (rebased.status !== 'prepared') throw new Error('fixture rebase overflow')
  expect(JSON.stringify(rebased.view.content)).toContain(post.action.text)
  expect(JSON.stringify(rebased.view.content)).toContain('Other knowledge')
  expect(rebased.referencedReports).toEqual([operations[1]])
  const twice = materializeReports(current, { ...decision, context: rebased }, [operations[1]!])
  expect(twice.status === 'prepared' && twice.previousPresentationHashes).toHaveLength(2)
  expect(rebased.previousPresentationHashes).toHaveLength(1)
  expect(() => materializeReports(current, decision, [operation])).toThrow(/no current references/)
  expect(() => materializeReports(current, { ...decision, context: prepared }, [])).toThrow(/no current references/)
  expect(() => materializeReports(current, { ...decision, context: prepared }, [operation, operation])).toThrow(/no current references/)
  expect(() => materializeReports(current, { ...decision, context: rebased }, [operation])).toThrow(/no current references/)
  const omitted = materializeReports(current, { ...decision, context: { ...prepared, maxBytes: prepared.retainedBytes } }, [operation])
  expect(omitted).toMatchObject({ status: 'prepared', omitted: ['knowledge'] })
  expect('knowledge' in omitted).toBe(false)
  expect('referencedReports' in omitted).toBe(false)
  const { visibleReports: _hint, ...withoutHint } = prepared
  expect(materializeReports(current, { ...decision, context: { ...withoutHint, maxBytes: prepared.retainedBytes,
    requiredSections: [...prepared.requiredSections, 'knowledge'] } }, [operation])).toMatchObject({ status: 'overflow' })
  const malformed = [
    { ...prepared, requiredSections: [...prepared.requiredSections, 'observations' as const] },
    { ...prepared, knowledge: [{ id: report.id, revision: 2 }] },
    { ...prepared, view: { ...prepared.view, sources: [] } },
    { ...prepared, view: { ...prepared.view, content: prepared.view.content.filter(section => section.kind !== 'knowledge') } },
  ]
  for (const context of malformed) expect(() => { assertContextProjection(current, { ...decision, context }) }).toThrow()
  expect(() => prepareContext(current, decision, { ...request, knowledge: { ...request.knowledge, visibleReports: [simulationOperationIdSchema.parse('missing')] } }))
    .toThrow(/must belong to selected/)
  expect(() => prepareContext(current, decision, { ...request, sections: [...request.sections.slice(0, -1),
    { kind: 'knowledge', required: false, blocks: [{ type: 'text', text: 'Manual' }] }] })).toThrow(/cannot share a manual section/)
})

it('refuses changed summary retries and source revocation without recomputing retained output', async () => {
  const { ctx, run, connection, entityId } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationKnowledgeRequestSchema, simulationSummaryRequestSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const reader = simulationEntityIdSchema.parse('reader')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: reader, entityKind: 'person', cognition: 'none', profile: {} }), run.snapshot().revision)
  const base = simulationKnowledgeRequestSchema.parse({ id: 'source', owner: entityId, expectedRevision: 0, statement: 'Private source',
    source: { kind: 'belief', profileRevision: 1, policyVersion: '1' }, observedAt: '0', availableAt: '0', validFrom: '0', validUntil: null, readers: [reader] })
  const source = await run.recordKnowledge(base)
  const policy = simulationPolicyRefSchema.parse({ id: 'extract', version: '1' })
  const summarize = vi.fn(() => 'Summary')
  ctx.simulationTeams.registerSummaryPolicy({ ...policy, summarize })
  const request = simulationSummaryRequestSchema.parse({ id: 'digest', expectedRevision: 0, inputs: [source.id], readers: [],
    availableAt: '0', validFrom: '0', validUntil: null })
  const summary = await connection.summarizeKnowledge(reader, policy, request)
  for (const changed of [
    { ...request, inputs: [simulationKnowledgeRequestSchema.parse({ ...base, id: 'other' }).id] },
    { ...request, readers: [entityId] }, { ...request, availableAt: (await import('@clocky/clocky-simulation')).simTimeSchema.parse('1') },
  ]) await expect(connection.summarizeKnowledge(reader, policy, changed)).rejects.toThrow(/retry changed/)
  await expect(connection.summarizeKnowledge(entityId, policy, request)).rejects.toThrow(/retry changed/)
  await expect(connection.summarizeKnowledge(reader, { ...policy, version: '2' }, request)).rejects.toThrow(/retry changed/)
  await run.recordKnowledge({ ...base, expectedRevision: 1, readers: [] })
  await expect(connection.summarizeKnowledge(reader, policy, request)).rejects.toThrow(/no longer retrievable/)
  expect(run.snapshot().knowledge?.[request.id]).toEqual([summary])
  expect(summarize).toHaveBeenCalledTimes(1)
})

it('does not invoke summary policies for missing inputs and refuses a policy replaced during computation', async () => {
  const { ctx, run, connection, entityId } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationKnowledgeRequestSchema, simulationSummaryRequestSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const base = simulationKnowledgeRequestSchema.parse({ id: 'source', owner: entityId, expectedRevision: 0, statement: 'Source',
    source: { kind: 'belief', profileRevision: 1, policyVersion: '1' }, observedAt: '0', availableAt: '0', validFrom: '0', validUntil: null, readers: [] })
  const source = await run.recordKnowledge(base)
  const policy = simulationPolicyRefSchema.parse({ id: 'extract', version: '1' })
  const request = simulationSummaryRequestSchema.parse({ id: 'digest', expectedRevision: 0, inputs: [source.id], readers: [],
    availableAt: '0', validFrom: '0', validUntil: null })
  const summarize = vi.fn(() => {
    remove()
    ctx.simulationTeams.registerSummaryPolicy({ ...policy, summarize: () => 'Replacement' })
    return 'Old policy output'
  })
  const remove = ctx.simulationTeams.registerSummaryPolicy({ ...policy, summarize })
  await expect(connection.summarizeKnowledge(entityId, policy, { ...request, inputs: [simulationKnowledgeRequestSchema.parse({ ...base, id: 'missing' }).id] }))
    .rejects.toThrow(/missing, future or unauthorized/)
  expect(summarize).not.toHaveBeenCalled()
  await expect(connection.summarizeKnowledge(entityId, { ...policy, version: 'missing' }, request)).rejects.toThrow(/not registered/)
  await expect(connection.summarizeKnowledge(entityId, policy, request)).rejects.toThrow(/retired during computation/)
  expect(run.snapshot().knowledge?.[request.id]).toBeUndefined()
  await run.recordKnowledge({ ...base, id: request.id })
  await expect(connection.summarizeKnowledge(entityId, policy, request)).rejects.toThrow(/retry changed/)
})

it('requires canonical report publications and exact originals before model dispatch', async () => {
  const { run, connection, receiver, receiverId, entityId, operation, simTimeSchema } = await preparedPost()
  const { simulationKnowledgeRequestSchema, simulationOperationIdSchema } = await import('@clocky/clocky-simulation')
  const { modelKnowledge, missingReportReferences, assertReportReferences } = await import('../src/knowledge.ts')
  await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
  const state = run.snapshot(), actor = receiver.localAgent!
  const messages = [...actor.session.deriveMessages(), ...actor.inbox.nextStep]
  expect(missingReportReferences(state, [operation], messages)).toEqual([])
  expect(() => { assertReportReferences(state, [operation], []) }).toThrow(/absent from the model request/)
  const post = state.operations[operation]!
  const { receipt: _receipt, ...withoutReceipt } = post.outbox!
  const { binding: _binding, ...withoutBinding } = state.entities[entityId]!
  for (const changed of [
    { ...state, operations: {} },
    { ...state, operations: { [operation]: { ...post, outbox: withoutReceipt } } },
    { ...state, entities: { ...state.entities, [entityId]: withoutBinding } },
  ]) expect(() => missingReportReferences(changed, [operation], messages)).toThrow(/no canonical publication/)
  expect(() => missingReportReferences(state, [simulationOperationIdSchema.parse('constructor')], messages)).toThrow(/no canonical publication/)
  const belief = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'belief', owner: receiverId,
    expectedRevision: 0, statement: 'Belief without a report', source: { kind: 'belief', profileRevision: 1, policyVersion: '1' },
    observedAt: '5', availableAt: '5', validFrom: '5', validUntil: null, readers: [] }))
  const context = { ...contextRequest(), knowledge: { ids: [belief.id], required: true } }
  expect(modelKnowledge(run, actor, receiverId, context, run.snapshot().revision).knowledge?.visibleReports).toEqual([])
})

it.each(['request', 'usage'] as const)('retains auxiliary ownership when the %s flush fails', async (boundary) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { CompactionId, recordCompactionRequest } = await import('@clocky/clocky-compaction')
  const { LlmAdapter } = await import('@clocky/clocky-llm')
  let calls = 0
  ctx.llm.registerAdapter(['aux-flush'], new class extends LlmAdapter {
    async *stream(): AsyncGenerator<import('@clocky/clocky-llm').StreamChunk> {
      calls += 1
      yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }())
  await connection.bind(entityId, participant.id)
  const actor = (await connection.activate(entityId, placement())).localAgent!
  const compactionId = CompactionId(`flush-${boundary}`)
  actor.session.append('compaction/start', { compactionId, turn: null })
  const options = recordCompactionRequest(actor.session, { sessionId: actor.session.id, purpose: 'compaction',
    provider: 'aux-flush', model: 'fixture', messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Source' }] })] })
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  let attempts = 0
  const failing = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async session => ++attempts === (boundary === 'request' ? 1 : 2)
    ? false : await flush(session))
  const consume = async () => { for await (const _chunk of ctx.llm.stream(options)) { /* Consume the admitted request. */ } }
  try { await expect(consume()).rejects.toThrow(/durable Session/) }
  finally { failing.mockRestore() }
  expect(calls).toBe(boundary === 'request' ? 0 : 1)
  expect(ctx.simulationTeams.modelUsage().active).toBe(0)
  expect(Object.values(run.snapshot().tokenReservations ?? {}).map(value => value.status)).toEqual(boundary === 'request' ? [] : ['reserved'])
  actor.session.append('compaction/end', { compactionId, turn: null, error: 'Persistence failure' })
})

it('requires a live task attempt, serializes dependencies and retires runtime-only proofs', async () => {
  const { ctx, run, operationId, dependentId } = await preparedTask(true)
  const { SimulationTaskAuthority } = await import('../src/task-transport.ts')
  const { requireOutbox, outboundPayload } = await import('../../simulation-local/src/outbox.ts')
  const state = run.snapshot(), entity = Object.values(state.entities)[0]!
  const transport = new SimulationTaskAuthority(ctx).transport(run, entity.binding!.teamId, 'simulation/company', () => true)
  const payload = outboundPayload(state, requireOutbox(state, operationId))
  if (!('task' in payload)) throw new Error('fixture task missing')
  const create = ctx.teams.createSimulationTask.bind(ctx.teams)
  const calls: Parameters<typeof create>[0][] = []
  const observed = vi.spyOn(ctx.teams, 'createSimulationTask').mockImplementation(async (request) => {
    expect(() => JSON.stringify(request.actor)).toThrow(/runtime-only/)
    calls.push(request)
    return await create(request)
  })
  try {
    await expect(transport.createTask(payload)).rejects.toThrow(/no exact accepted due intent/)
    expect(observed).not.toHaveBeenCalled()
    expect((await run.dispatchOperation(operationId, transport, () => 100)).status).toBe('settled')
    await run.drive({ until: (await import('@clocky/clocky-simulation')).simTimeSchema.parse('5') })
    expect((await run.dispatchOperation(dependentId!, transport, () => 100)).status).toBe('settled')
    expect(calls).toHaveLength(2)
    await expect(create(calls[0]!)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(transport.createTask(payload)).rejects.toThrow(/no exact accepted due intent/)
  } finally { observed.mockRestore() }
})

it('refuses summarization before any knowledge has been recorded', async () => {
  const { ctx, connection, entityId } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationSummaryRequestSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'extract', version: '1' })
  const summarize = vi.fn(() => 'Must not run')
  ctx.simulationTeams.registerSummaryPolicy({ ...policy, summarize })
  await expect(connection.summarizeKnowledge(entityId, policy, simulationSummaryRequestSchema.parse({
    id: 'digest', expectedRevision: 0, inputs: ['missing'], readers: [], availableAt: '0', validFrom: '0', validUntil: null,
  }))).rejects.toThrow(/missing, future or unauthorized/)
  expect(summarize).not.toHaveBeenCalled()
})

it('requires canonical actors for knowledge windows and retains the original reference selection on retry', async () => {
  const { run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationKnowledgeRequestSchema, simulationWindowRequestSchema, simulationOperationIdSchema } = await import('@clocky/clocky-simulation')
  const belief = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'belief', owner: entityId,
    expectedRevision: 0, statement: 'Known fact', source: { kind: 'belief', profileRevision: 1, policyVersion: '1' },
    observedAt: '0', availableAt: '0', validFrom: '0', validUntil: null, readers: [] }))
  const parsed = simulationWindowRequestSchema.parse({ id: 'knowledge-window', decisions: [{ id: 'knowledge-decision', entityId,
    context: { ...contextRequest(), knowledge: { ids: [belief.id], required: true } } }] })
  const request = { id: parsed.id, decisions: parsed.decisions.map(({ id, entityId, context }) => ({ id, entityId, context })) }
  await run.setPhase('running', run.snapshot().revision)
  await expect(connection.openWindow(request)).rejects.toThrow(/canonical actor/)
  await connection.bind(entityId, participant.id)
  await expect(connection.openWindow(request)).rejects.toThrow(/canonical actor/)
  await connection.activate(entityId, placement())
  const opened = await connection.openWindow(request)
  expect(opened.request.decisions[0]?.context.knowledge?.visibleReports).toEqual([])
  const changedHints = { ...request, decisions: request.decisions.map(value => ({ ...value, context: { ...value.context,
    knowledge: { ids: [belief.id], required: true, visibleReports: [simulationOperationIdSchema.parse('forged')] } } })) }
  expect(await connection.openWindow(changedHints)).toEqual(opened)
})

it('rejects substituted task identities and drains admitted task reads on close', async () => {
  const { ctx, run, connection, operationId } = await preparedTask()
  const { simulationInteractionIdSchema } = await import('@clocky/clocky-simulation')
  const { teamIdSchema, teamTaskIdSchema } = await import('@clocky/clocky-team')
  await connection.dispatchOperation(operationId, () => 100)
  const receipt = run.snapshot().operations[operationId]!.outbox!.taskReceipt!
  const get = ctx.teams.getTask.bind(ctx.teams)
  const task = await get({ teamId: receipt.teamId, taskId: receipt.taskId })
  const interactionId = simulationInteractionIdSchema.parse('not-yet-linked')
  for (const changed of [{ ...task, teamId: teamIdSchema.parse('foreign') }, { ...task, id: teamTaskIdSchema.parse('foreign') }]) {
    const read = vi.spyOn(ctx.teams, 'getTask').mockResolvedValueOnce(changed)
    try { await expect(connection.reconcileTask(interactionId, 1, task.id)).rejects.toThrow(/owner returned another task/) }
    finally { read.mockRestore() }
  }
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.teams, 'getTask').mockImplementationOnce(async (...args) => {
    const value = await get(...args)
    entered.resolve(undefined); await release.promise
    return value
  })
  const reading = connection.reconcileTask(interactionId, 1, task.id)
  const rejected = expect(reading).rejects.toThrow(/closed/)
  await entered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  await Promise.resolve()
  expect(closed).toBe(false)
  release.resolve(undefined)
  await rejected; await closing
  held.mockRestore()
})

it.each(['constructor', 'toString', '__proto__'])('admits an opaque decision id that is also an object property (%s)', async (value) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const ToolSimulation = await import('@clocky/clocky-tool-simulation')
  await ctx.plugin(ToolSimulation)
  const { toolCallResponse } = await import('../../../core/agent-loop/tests/mock-adapter.ts')
  const model = new MockAdapter([toolCallResponse('stage', 'simulation_stage', { proposals: [] }),
    toolCallResponse('submit', 'simulation_submit', {})])
  ctx.llm.registerAdapter(['opaque-id'], model)
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'opaque-id', model: 'fixture' } } })
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse(value)
  const accepted = await connection.executeDecision(entityId, id, contextRequest())
  expect(accepted.status).toBe('accepted')
  expect(await connection.executeDecision(entityId, id, contextRequest())).toEqual(accepted)
  const { simulationEventIdSchema } = await import('@clocky/clocky-simulation')
  await expect(connection.executeDecision(entityId, id, contextRequest(), simulationEventIdSchema.parse('foreign-wake')))
    .rejects.toThrow(/changed its owner or wake/)
  const { executeDecision } = await import('../src/decision.ts')
  await expect(executeDecision(run, connection, activation.localAgent!, entityId, id, contextRequest(),
    () => Promise.resolve(false), () => { expect(ctx.agents.get(activation.localAgent!.id)).toBe(activation.localAgent) }))
    .rejects.toThrow(/completion requires durable Session storage/)
  expect(Object.hasOwn(run.snapshot().decisions, id)).toBe(true)
  expect(run.snapshot().decisions[id]?.context?.status).toBe('prepared')
  expect(model.requests).toHaveLength(2)
})

it.each(['text', 'audience', 'correlation', 'fingerprint', 'key'] as const)('rejects substituted Simulation publication %s before target persistence', async (field) => {
  const { ctx, run, connection, channel, operation, participant, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
  const altered = vi.spyOn(ctx.teams, 'postChannelEnvelope').mockImplementationOnce(async (request) => {
    expect(() => JSON.stringify(request.actor)).toThrow(/runtime-only/)
    const draft = { ...request.draft }
    if (field === 'text') draft.payload = { content: [{ type: 'text', text: 'Substituted' }] }
    if (field === 'audience') draft.audience = [participant.id]
    if (field === 'correlation') draft.correlationId = 'foreign-run'
    if (field === 'fingerprint') draft.traceId = 'foreign-fingerprint'
    return await post({ ...request, draft, ...field === 'key' ? {
      idempotencyKey: (await import('@clocky/clocky-team')).channelPostIdempotencyKeySchema.parse('foreign-key'),
    } : {} })
  })
  try {
    expect(await connection.dispatchOperation(operation, () => 100)).toMatchObject({ status: 'retry' })
    expect((await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
      .filter(record => record.type === 'channel/envelope')).toEqual([])
  } finally { altered.mockRestore() }
  expect(await connection.dispatchOperation(operation, () => 200)).toMatchObject({ status: 'settled', result: { status: 'applied' } })
})

it('revokes a publication proof when its exact call has finished', async () => {
  const { ctx, run, connection, operation, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
  let captured: Parameters<typeof ctx.teams.postChannelEnvelope>[0] | undefined
  const observer = vi.spyOn(ctx.teams, 'postChannelEnvelope').mockImplementationOnce(async (request) => {
    captured = request
    return await post(request)
  })
  try { expect(await connection.dispatchOperation(operation, () => 100)).toMatchObject({ status: 'settled' }) }
  finally { observer.mockRestore() }
  if (captured === undefined) throw new Error('fixture post missing')
  await expect(post(captured)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})

it('rejects a publication after its proof source unloads during awaited policy', async () => {
  const { ctx, run, channel, operation, serviceFiber, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await serviceFiber.dispose()
  const { SimulationPostAuthority } = await import('../src/transport.ts')
  let transport: import('@clocky/clocky-simulation').SimulationTeamTransport | undefined
  const source = ctx.plugin({ inject: ['teams'], apply: (child: import('@clocky/cordis').Context) => {
    transport = new SimulationPostAuthority(child).transport(run, channel.manifest.teamId, 'simulation/company', () => true)
  } })
  await source
  const policy = ctx.teams.registerPolicy('send', { name: 'unload-post-source', async apply(_request, next) {
    await source.dispose()
    return await next()
  } })
  try {
    if (transport === undefined) throw new Error('fixture transport missing')
    expect(await run.dispatchOperation(operation, transport, () => 100)).toMatchObject({ status: 'retry' })
    expect((await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
      .filter(record => record.type === 'channel/envelope')).toEqual([])
  } finally { policy(); await source.dispose() }
})

it('derives outbound authority only from the exact current accepted intent and canonical bindings', async () => {
  const { ctx, run, channel, operation, serviceFiber, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await serviceFiber.dispose()
  const { SimulationPostAuthority } = await import('../src/transport.ts')
  const { simulationRunIdSchema, simulationDecisionIdSchema, simulationOperationIdSchema } = await import('@clocky/clocky-simulation')
  const { teamIdSchema, participantIdSchema, channelIdSchema } = await import('@clocky/clocky-team')
  let authority: InstanceType<typeof SimulationPostAuthority> | undefined
  const source = ctx.plugin({ inject: ['teams'], apply: (child: import('@clocky/cordis').Context) => {
    authority = new SimulationPostAuthority(child)
  } })
  await source
  if (authority === undefined) throw new Error('fixture authority missing')
  const transport = authority.transport(run, channel.manifest.teamId, 'simulation/company', () => true)
  const foreign = authority.transport(run, teamIdSchema.parse('foreign'), 'simulation/company', () => true)
  try {
    expect(await run.dispatchOperation(operation, { post: async (message) => {
      for (const altered of [
        { ...message, operationId: simulationOperationIdSchema.parse('missing') },
        { ...message, decisionId: simulationDecisionIdSchema.parse('missing') },
        { ...message, runId: simulationRunIdSchema.parse('foreign') },
        { ...message, entityId: simulationEntityIdSchema.parse('foreign') },
        { ...message, fingerprint: 'changed' }, { ...message, text: 'changed' },
        { ...message, channelId: channelIdSchema.parse('foreign') },
        { ...message, sender: { ...message.sender, participantId: participantIdSchema.parse('foreign') } },
        { ...message, recipient: { ...message.recipient, sessionId: SessionId('foreign') } },
      ]) await expect(transport.post(altered)).rejects.toThrow(/exact accepted due intent/)
      await expect(foreign.post(message)).rejects.toThrow(/exact accepted due intent/)
      const result = await transport.post(message)
      return result
    } }, () => 100)).toMatchObject({ status: 'settled', result: { status: 'applied' } })
  } finally { await source.dispose() }
})

it.each(['TEAM_PARTICIPANT_NOT_FOUND', 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT'] as const)(
  'records definitive publication refusal %s instead of an uncertain retry', async (code) => {
    const { ctx, run, connection, operation, simTimeSchema } = await preparedPost()
    const { TeamError } = await import('@clocky/clocky-team')
    await run.drive({ until: simTimeSchema.parse('5') })
    const failure = vi.spyOn(ctx.teams, 'postChannelEnvelope').mockRejectedValueOnce(new TeamError('Target refused', code))
    try {
      expect(await connection.dispatchOperation(operation, () => 100)).toMatchObject({ status: 'settled',
        result: { code, status: code === 'TEAM_PARTICIPANT_NOT_FOUND' ? 'blocked-authority' : 'rejected' } })
    } finally { failure.mockRestore() }
  },
)

function deliveryOwner(ctx: import('@clocky/cordis').Context): import('../src/delivery.ts').SimulationDeliveryAuthority {
  return (ctx.simulationTeams as unknown as { deliveryAuthority: import('../src/delivery.ts').SimulationDeliveryAuthority }).deliveryAuthority
}

it('keeps delivery evidence scans scoped, advancing and revocable', async () => {
  const { ctx, run, connection, channel, operation, simTimeSchema } = await preparedPost()
  const authority = deliveryOwner(ctx)
  const teamId = channel.manifest.teamId
  await expect(authority.observeFailure(run, operation, teamId, () => true)).rejects.toThrow(/published communication/)
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const { teamIdSchema } = await import('@clocky/clocky-team')
  await expect(authority.observeFailure(run, operation, teamIdSchema.parse('foreign'), () => true)).rejects.toThrow(/canonical bindings/)
  await expect(authority.observeFailure(run, operation, teamId, () => false)).rejects.toThrow(/observation is closed/)
  const page = await ctx.teams.readChannelPage({ channelId: channel.manifest.id, afterCursor: -1, limit: 100 })
  const { nextCursor: _nextCursor, ...last } = page
  const read = vi.spyOn(ctx.teams, 'readChannelPage')
  try {
    read.mockResolvedValueOnce({ ...last, records: [], nextCursor: 0 }).mockResolvedValueOnce(last)
    expect(await authority.observeFailure(run, operation, teamId, () => true)).toBe(false)
    expect(read.mock.calls.slice(-2).map(([request]) => request.afterCursor)).toEqual([-1, 0])
    read.mockResolvedValueOnce({ ...last, records: [], nextCursor: -1 })
    await expect(authority.observeFailure(run, operation, teamId, () => true)).rejects.toThrow(/did not advance/)
    read.mockResolvedValueOnce({ ...last, channel: { ...last.channel, manifest: { ...last.channel.manifest, teamId: teamIdSchema.parse('foreign') } } })
    await expect(authority.observeFailure(run, operation, teamId, () => true)).rejects.toThrow(/another Team/)
    const recipient = run.snapshot().entities[simulationEntityIdSchema.parse('receiver')]!
    const receipt = run.snapshot().operations[operation]!.outbox!.receipt!
    let admitted = true
    read.mockImplementationOnce(() => {
      admitted = false
      return Promise.resolve({ ...last, records: [{ type: 'channel/delivery-expired' as const, sequence: last.channel.cursor + 1,
        createdAt: 100, participantId: recipient.binding!.participantId, envelopeId: receipt.envelopeId,
        envelopeSequence: last.channel.cursor, reason: 'closure' as const }] })
    })
    await expect(authority.observeFailure(run, operation, teamId, () => admitted)).rejects.toThrow(/retired before persistence/)
    expect(run.snapshot().operations[operation]!.deliveryFailure).toBeUndefined()
  } finally { read.mockRestore() }
  await connection.receiveOperation(operation)
  expect(await authority.observeFailure(run, operation, teamId, () => true)).toBe(false)
})

it('rejects changed or missing claimed payloads before recording receipt', async () => {
  const { ctx, run, connection, channel, operation, simTimeSchema, model } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const pending = ctx.teams.listChannelPendingDeliveries.bind(ctx.teams)
  const altered = vi.spyOn(ctx.teams, 'listChannelPendingDeliveries').mockImplementationOnce(async (request) => {
    const page = await pending(request)
    return { ...page, deliveries: page.deliveries.map(value => ({ ...value,
      envelope: { ...value.envelope, payload: { content: [{ type: 'text', text: 'Unaccepted text' }] } },
    })) }
  })
  try { await expect(connection.receiveOperation(operation)).rejects.toThrow(/differs from its accepted intent/) }
  finally { altered.mockRestore() }
  expect(run.snapshot().operations[operation]!.delivery).toBeUndefined()
  expect((await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
    .some(record => record.type === 'channel/receipt')).toBe(false)
  await connection.receiveOperation(operation)
  expect(model.requests).toHaveLength(0)
})

it('keeps delivery proofs runtime-only and refuses a second consumer without owner authority', async () => {
  const { ctx, run, connection, operation, channel, receiver, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const claim = ctx.teams.claimChannelDelivery.bind(ctx.teams)
  let saved: Parameters<typeof claim>[0] | undefined
  const inspect = vi.spyOn(ctx.teams, 'claimChannelDelivery').mockImplementationOnce(async (request) => {
    saved = request
    expect(() => JSON.stringify(request.deliveryOwner)).toThrow(/runtime-only/)
    const { deliveryOwner: _owner, ...ordinary } = request
    await expect(claim(ordinary)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    return await claim(request)
  })
  try { await connection.receiveOperation(operation) }
  finally { inspect.mockRestore() }
  if (saved === undefined) throw new Error('fixture claim missing')
  const lease = ctx.teams.openActivationActorProofIssuer().issue(receiver.binding)
  try { await expect(claim({ ...saved, actor: lease.proof })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' }) }
  finally { lease.revoke() }
  expect((await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
    .filter(record => record.type === 'channel/receipt')).toHaveLength(1)
})

it.each(['capacity', 'recovery-required'] as const)('reports automatic recipient placement %s without claiming delivery', async (outcome) => {
  const { run, connection, operation, receiver, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  await receiver.dispose()
  const { driveTeam } = await import('../src/driver.ts')
  const place = vi.fn(() => Promise.resolve(outcome))
  const result = await driveTeam(run, connection, { until: simTimeSchema.parse('10') }, () => 100, 2,
    () => 'unavailable', () => Promise.resolve(false), () => {}, place)
  expect(result).toMatchObject({ reason: outcome === 'capacity' ? 'resident-capacity' : 'residency-recovery-required', operationId: operation })
  expect(place).toHaveBeenCalledTimes(1)
  expect(run.snapshot().operations[operation]!.delivery).toBeUndefined()
})

it('rejects incomplete scheduler handoffs and reports a busy recipient without admitting input', async () => {
  const { run, connection, operation, simTimeSchema } = await preparedPost()
  const { driveTeam } = await import('../src/driver.ts')
  const request = { until: simTimeSchema.parse('10') }
  const bad = vi.spyOn(run, 'drive').mockResolvedValueOnce({ reason: 'dispatch-required', steps: 0, revision: run.snapshot().revision })
  try {
    await expect(driveTeam(run, connection, request, () => 100, 2, () => 'ready', () => Promise.resolve(false), () => {}))
      .rejects.toThrow(/omitted its required operation/)
    const { simulationOperationIdSchema } = await import('@clocky/clocky-simulation')
    bad.mockResolvedValueOnce({ reason: 'delivery-required', operationId: simulationOperationIdSchema.parse('missing'),
      steps: 0, revision: run.snapshot().revision })
    await expect(driveTeam(run, connection, request, () => 100, 2, () => 'ready', () => Promise.resolve(false), () => {}))
      .rejects.toThrow(/no communication intent/)
  } finally { bad.mockRestore() }
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  expect(await driveTeam(run, connection, request, () => 100, 2, () => 'busy', () => Promise.resolve(false), () => {}))
    .toMatchObject({ reason: 'recipient-busy', operationId: operation })
  expect(run.snapshot().operations[operation]!.delivery).toBeUndefined()
})

it('returns unknown target outcomes from bounded coordination without retrying them implicitly', async () => {
  const { connection, operation, ctx, simTimeSchema } = await preparedPost()
  const failure = vi.spyOn(ctx.teams, 'postChannelEnvelope').mockRejectedValue(new Error('Unknown target result'))
  try {
    for (const now of [100, 200]) expect(await connection.drive({ until: simTimeSchema.parse('10') }, () => now)).toMatchObject({ reason: 'retry' })
    expect(await connection.drive({ until: simTimeSchema.parse('10') }, () => 300)).toMatchObject({ reason: 'outcome-unknown', operationId: operation })
    expect(failure).toHaveBeenCalledTimes(3)
  } finally { failure.mockRestore() }
})

it('keeps concurrent dormant acknowledgements owned until both complete', async () => {
  const { connection, receiverId, channel, ctx } = await dormantInvitation()
  const [first, second] = await Promise.all([connection.acknowledgeInvitation(receiverId, channel.manifest.id),
    connection.acknowledgeInvitation(receiverId, channel.manifest.id)])
  expect(second).toEqual(first)
  expect((await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })).invitations
    .find(value => value.participantId === first.invitations.find(value => value.status === 'acknowledged')?.participantId)?.status).toBe('acknowledged')
})

it('refuses invitation work after admission closes and before a canonical binding exists', async () => {
  const { ctx, run, channel, entityId } = await dormantInvitation()
  const authority = (ctx.simulationTeams as unknown as {
    invitationAuthority: import('../src/invitation.ts').SimulationInvitationAuthority
  }).invitationAuthority
  await expect(authority.acknowledge(run, entityId, channel.manifest.id, channel.manifest.teamId, 'simulation/company', () => false))
    .rejects.toThrow(/admission is closed/)
  await expect(authority.acknowledge(run, simulationEntityIdSchema.parse('missing'), channel.manifest.id,
    channel.manifest.teamId, 'simulation/company', () => true)).rejects.toThrow(/canonical entity binding/)
})

async function failedPost() {
  const fixture = await preparedPost()
  const { ctx, run, connection, operation, receiverId, channel, simTimeSchema } = fixture
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const current = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  const recipient = run.snapshot().entities[receiverId]!
  const receipt = run.snapshot().operations[operation]!.outbox!.receipt!
  await run.recordDeliveryFailure(operation, { type: 'channel/delivery-expired', sequence: current.cursor + 1,
    createdAt: 100, participantId: recipient.binding!.participantId, envelopeId: receipt.envelopeId,
    envelopeSequence: current.cursor, reason: 'closure' }, run.snapshot().revision)
  return fixture
}

it('requires durable failure and a live resident unless the recipient is irreversibly terminated', async () => {
  const { ctx, run, connection, receiverId, receiver, channel, operation, simTimeSchema } = await preparedPost()
  const owner = deliveryOwner(ctx)
  const teamId = channel.manifest.teamId
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  await expect(owner.reconcileFailure(run, operation, teamId, () => true)).rejects.toThrow(/no durable target failure/)
  const current = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  const entity = run.snapshot().entities[receiverId]!
  await run.recordDeliveryFailure(operation, { type: 'channel/delivery-expired', sequence: current.cursor + 1, createdAt: 100,
    participantId: entity.binding!.participantId, envelopeId: run.snapshot().operations[operation]!.outbox!.receipt!.envelopeId,
    envelopeSequence: current.cursor, reason: 'closure' }, run.snapshot().revision)
  expect(await owner.observeFailure(run, operation, teamId, () => true)).toBe(true)
  await expect(owner.receive(run, operation, teamId, 'simulation/company', () => true)).rejects.toThrow(/needs reconciliation/)
  await expect(owner.reconcileFailure(run, operation, teamId, () => false)).rejects.toThrow(/reconciliation is closed/)
  await receiver.dispose()
  await expect(owner.reconcileFailure(run, operation, teamId, () => true)).rejects.toThrow(/resident recipient/)
  await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: receiverId,
    entityRevision: run.snapshot().entities[receiverId]!.revision, phase: 'terminated' }), run.snapshot().revision)
  expect(await owner.reconcileFailure(run, operation, teamId, () => true)).toBe('entity-terminated')
})

it.each(['maintenance', 'flush-failure', 'retired-flush'] as const)('keeps failed delivery unresolved after %s', async (failure) => {
  const { ctx, run, channel, operation, receiver } = await failedPost()
  const owner = deliveryOwner(ctx)
  const actor = receiver.localAgent!
  let admitted = true
  const maintenance = actor.runMaintenance.bind(actor)
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const fault = failure === 'maintenance'
    ? vi.spyOn(actor, 'runMaintenance').mockImplementationOnce(async (action) => { admitted = false; return await maintenance(action) })
    : vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
      if (failure === 'flush-failure') return false
      const persisted = await flush(session)
      admitted = false
      return persisted
    })
  try {
    await expect(owner.reconcileFailure(run, operation, channel.manifest.teamId, () => admitted))
      .rejects.toThrow(/lost its writer|durable Session|retired during flush/)
    expect(run.snapshot().operations[operation]!.deliveryFailure!.resolution).toBeUndefined()
  } finally { fault.mockRestore() }
})

it.each(['maintenance', 'payload-read', 'flush-failure', 'retired-flush', 'claim-revoked'] as const)(
  'does not receipt delivery after %s interrupts admission', async (failure) => {
    const { ctx, run, channel, operation, receiver, connection, simTimeSchema } = await preparedPost()
    await run.drive({ until: simTimeSchema.parse('5') })
    await connection.dispatchOperation(operation, () => 100)
    const owner = deliveryOwner(ctx), actor = receiver.localAgent!
    let admitted = true
    const maintenance = actor.runMaintenance.bind(actor)
    const pending = ctx.teams.listChannelPendingDeliveries.bind(ctx.teams)
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    const claim = ctx.teams.claimChannelDelivery.bind(ctx.teams)
    const fault = failure === 'maintenance'
      ? vi.spyOn(actor, 'runMaintenance').mockImplementationOnce(async (action) => { admitted = false; return await maintenance(action) })
      : failure === 'payload-read'
        ? vi.spyOn(ctx.teams, 'listChannelPendingDeliveries').mockImplementationOnce(async (request) => {
          const result = await pending(request); admitted = false; return result
        })
        : failure === 'claim-revoked'
          ? vi.spyOn(ctx.teams, 'claimChannelDelivery').mockImplementationOnce(async (request) => { admitted = false; return await claim(request) })
          : vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
            if (failure === 'flush-failure') return false
            const result = await flush(session); admitted = false; return result
          })
    try {
      await expect(owner.receive(run, operation, channel.manifest.teamId, 'simulation/company', () => admitted))
        .rejects.toThrow(/no longer current|retired|durable Session|proof is invalid/)
      expect(run.snapshot().operations[operation]!.delivery).toBeUndefined()
      expect((await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
        .some(record => record.type === 'channel/receipt')).toBe(false)
    } finally { fault.mockRestore() }
  },
)

it('publishes a dependent intent only after its original Team receipt is retained', async () => {
  const { run, connection, operation, channel, entityId, receiverId, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const wake = await connection.receiveOperation(operation)
  await run.drive({ until: simTimeSchema.parse('5') })
  const { simulationDecisionIdSchema, simulationProposalSchema } = await import('@clocky/clocky-simulation')
  const handled = simulationDecisionIdSchema.parse('handled')
  await connection.openDecision(receiverId, handled, wake)
  await connection.submitDecision(receiverId, handled, [])
  const next = simulationDecisionIdSchema.parse('dependent-message')
  await connection.openDecision(entityId, next)
  const accepted = await connection.submitDecision(entityId, next, [simulationProposalSchema.parse({ after: [operation], action: {
    kind: 'communication/post', recipient: receiverId, channelId: channel.manifest.id, text: 'Dependent message', deliverAt: '5',
  } })])
  await run.drive({ until: simTimeSchema.parse('5') })
  expect(await connection.dispatchOperation(accepted.operationIds[0]!, () => 100)).toMatchObject({ status: 'settled', result: { status: 'applied' } })
})

it('rejects receipt admission without a resident activation or a claimed target responsibility', async () => {
  const { ctx, run, connection, operation, channel, receiver, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const read = ctx.teams.getTeam.bind(ctx.teams)
  const missingActivation = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async request => ({ ...await read(request), activations: [] }))
  try { await expect(connection.receiveOperation(operation)).rejects.toThrow(/no current activation/) }
  finally { missingActivation.mockRestore() }
  const unclaimed = vi.spyOn(ctx.teams, 'claimChannelDelivery').mockResolvedValueOnce(undefined)
  try { await expect(connection.receiveOperation(operation)).rejects.toThrow(/no durable local input responsibility/) }
  finally { unclaimed.mockRestore() }
  await receiver.dispose()
  await expect(deliveryOwner(ctx).receive(run, operation, channel.manifest.teamId, 'simulation/company', () => true))
    .rejects.toThrow(/not resident/)
})

it('rescans pending pages and refuses an empty or nonadvancing claimed-envelope scan', async () => {
  const { ctx, run, connection, operation, simTimeSchema } = await preparedPost()
  const { envelopeIdSchema } = await import('@clocky/clocky-team')
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const original = ctx.teams.listChannelPendingDeliveries.bind(ctx.teams)
  const pages = vi.spyOn(ctx.teams, 'listChannelPendingDeliveries')
  try {
    pages.mockImplementationOnce(async request => ({ ...await original(request), deliveries: [] }))
    await expect(connection.receiveOperation(operation)).rejects.toThrow(/no longer pending/)
    pages.mockImplementationOnce(async (request) => {
      const result = await original(request)
      return { ...result, nextCursor: -1, deliveries: result.deliveries.map(value => ({ ...value,
        envelope: { ...value.envelope, id: envelopeIdSchema.parse('unrelated') },
      })) }
    })
    await expect(connection.receiveOperation(operation)).rejects.toThrow(/did not advance/)
    pages.mockImplementationOnce(async (request) => {
      const result = await original(request)
      return { ...result, nextCursor: 0, deliveries: result.deliveries.map(value => ({ ...value,
        envelope: { ...value.envelope, id: envelopeIdSchema.parse('unrelated') },
      })) }
    })
    pages.mockImplementationOnce(async request => await original({ ...request, afterCursor: -1 }))
    await connection.receiveOperation(operation)
    expect(pages.mock.calls.slice(-2).map(([request]) => request.afterCursor)).toEqual([-1, 0])
  } finally { pages.mockRestore() }
})

it('does not acknowledge a malformed delivery response and recovers the committed responsibility on retry', async () => {
  const { ctx, run, connection, operation, channel, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const record = run.recordDelivery.bind(run)
  const damaged = vi.spyOn(run, 'recordDelivery').mockImplementationOnce(async (...args) => {
    const state = await record(...args)
    const { delivery: _delivery, ...missingWake } = state.operations[operation]!
    return { ...state, operations: { ...state.operations, [operation]: missingWake } }
  })
  try { await expect(connection.receiveOperation(operation)).rejects.toThrow(/no recorded wake/) }
  finally { damaged.mockRestore() }
  expect((await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
    .some(value => value.type === 'channel/receipt')).toBe(false)
  const before = run.snapshot().operations[operation]!.delivery!.wakeId
  expect(await connection.receiveOperation(operation)).toBe(before)
})

it('keeps receipted input restoration tied to canonical Session history and admission', async () => {
  const { ctx, run, connection, operation, receiverId, receiver, channel, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  await connection.receiveOperation(operation)
  const owner = deliveryOwner(ctx), actor = receiver.localAgent!
  const input = actor.inbox.nextStep[0]!
  actor.inbox.remove(input.id)
  await expect(owner.restorePending(run, receiverId, channel.manifest.teamId, () => false)).rejects.toThrow(/restoration is closed/)
  const missingHistory = vi.spyOn(actor.session, 'events', 'get').mockReturnValue([])
  try {
    await expect(owner.restorePending(run, receiverId, channel.manifest.teamId, () => true)).rejects.toThrow(/absent from its Session log/)
  }
  finally { missingHistory.mockRestore() }
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const failedFlush = vi.spyOn(ctx.sessions, 'flush').mockResolvedValueOnce(false)
  try { await expect(owner.restorePending(run, receiverId, channel.manifest.teamId, () => true)).rejects.toThrow(/durable Session/) }
  finally { failedFlush.mockRestore() }
  let admitted = true
  const retired = vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
    const result = await flush(session); admitted = false; return result
  })
  try {
    await expect(owner.restorePending(run, receiverId, channel.manifest.teamId, () => admitted)).rejects.toThrow(/retired during flush/)
  }
  finally { retired.mockRestore() }
  const state = run.snapshot()
  const { binding: _binding, ...withoutBinding } = state.entities[receiverId]!
  const missingBinding = vi.spyOn(run, 'snapshot').mockReturnValue({ ...state, entities: { ...state.entities, [receiverId]: withoutBinding } })
  try { await expect(owner.restorePending(run, receiverId, channel.manifest.teamId, () => true)).rejects.toThrow(/canonical actor/) }
  finally { missingBinding.mockRestore() }
  await receiver.dispose()
  await expect(owner.restorePending(run, receiverId, channel.manifest.teamId, () => true)).rejects.toThrow(/canonical actor/)
})

it('does not resurrect input after its durable wake is cancelled before receipt retry', async () => {
  const { ctx, run, connection, operation, receiver, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const fault = vi.spyOn(ctx.teams, 'ackChannelEnvelope').mockRejectedValueOnce(new Error('Receipt unavailable'))
  try { await expect(connection.receiveOperation(operation)).rejects.toThrow(/Receipt unavailable/) }
  finally { fault.mockRestore() }
  const actor = receiver.localAgent!
  const wake = run.snapshot().operations[operation]!.delivery!.wakeId
  await run.cancelEvent(wake, 'Withdraw pending work', run.snapshot().revision)
  actor.inbox.remove(actor.inbox.nextStep[0]!.id)
  expect(await connection.receiveOperation(operation)).toBe(wake)
  expect(actor.inbox.nextStep).toEqual([])
  expect(run.snapshot().scheduledEvents[wake]!.status).toBe('cancelled')
})

it('reconciles an already consumed Session input without queuing it a second time', async () => {
  const { ctx, run, connection, operation, receiverId, receiver, channel, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const record = (await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
    .find(value => value.type === 'channel/envelope')
  if (record?.type !== 'channel/envelope') throw new Error('fixture publication missing')
  const { renderDirectV4EnvelopeInput } = await import('@clocky/clocky-team-agent-client')
  const actor = receiver.localAgent!, input = renderDirectV4EnvelopeInput(record.envelope)
  actor.session.append('user/message', input, { surfaceOp: 'append' })
  await ctx.sessions.flush(actor.session)
  const state = run.snapshot(), current = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  await run.recordDeliveryFailure(operation, { type: 'channel/delivery-expired', sequence: current.cursor + 1, createdAt: 100,
    participantId: state.entities[receiverId]!.binding!.participantId, envelopeId: state.operations[operation]!.outbox!.receipt!.envelopeId,
    envelopeSequence: current.cursor, reason: 'closure' }, state.revision)
  expect(await connection.reconcileDeliveryFailure(operation)).toBe('retained-input')
  expect(actor.inbox.hasPending).toBe(false)
  expect(actor.session.events.filter(event => event.type === 'user/message' && event.data.id === input.id)).toHaveLength(1)
})

it('requires staging and preserves the prior complete proposal after a rejected replacement', async () => {
  const { ctx, run, connection, agent, entityId, id } = await inputHarness('staging-contract')
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  const signal = new AbortController().signal
  await expect(ctx.simulationTeams.modelRequest(agent, { kind: 'submit' }, signal)).rejects.toThrow(/Stage the complete/)
  expect(await ctx.simulationTeams.modelRequest(agent, { kind: 'stage', proposals: [] }, signal)).toMatchObject({ count: 0, effects: 'none' })
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  const proposal = simulationProposalSchema.parse({ after: [], action: { kind: 'interaction/request', id: 'work', assignee: entityId,
    description: 'Work', replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' } } })
  await expect(ctx.simulationTeams.modelRequest(agent, { kind: 'stage', proposals: Array.from({ length: 17 }, () => proposal) }, signal))
    .rejects.toThrow(/proposal limit exceeded/)
  expect(await ctx.simulationTeams.modelRequest(agent, { kind: 'submit' }, signal)).toMatchObject({ status: 'accepted', operationIds: [], effects: 'pending' })
  expect(run.snapshot().operations).toEqual({})
})

it('reports a submitted window proposal without claiming ordered acceptance or world effects', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationWindowRequestSchema } = await import('@clocky/clocky-simulation')
  const model = new MockAdapter([textResponse('Ready to submit')])
  ctx.llm.registerAdapter(['window-tool-result'], model)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'window-tool-result', model: 'fixture' } } })
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('window-decision')
  const window = await run.openWindow(simulationWindowRequestSchema.parse({ id: 'window', decisions: [{ id, entityId, context: contextRequest() }] }),
    run.snapshot().revision)
  await connection.dispatchDecision(entityId, id)
  const agent = lease.localAgent!
  await agent.whenIdle()
  const signal = new AbortController().signal
  await ctx.simulationTeams.modelRequest(agent, { kind: 'stage', proposals: [] }, signal)
  expect(await ctx.simulationTeams.modelRequest(agent, { kind: 'submit' }, signal)).toEqual({ status: 'submitted', effects: 'pending', operationIds: [] })
  const revision = run.snapshot().revision
  expect(await ctx.simulationTeams.modelRequest(agent, { kind: 'submit' }, signal)).toEqual({ status: 'submitted', effects: 'pending', operationIds: [] })
  expect(run.snapshot().revision).toBe(revision)
  expect(run.snapshot().operations).toEqual({})
  await run.commitWindow(window.id)
})

it('does not describe a decision that expires during submission as accepted', async () => {
  const { ctx, run, connection, agent, entityId, id } = await inputHarness('tool-deadline')
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  const signal = new AbortController().signal
  await ctx.simulationTeams.modelRequest(agent, { kind: 'stage', proposals: [] }, signal)
  const deadline = run.snapshot().decisions[id]!.inference!.deadline
  const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline)
  try { await expect(ctx.simulationTeams.modelRequest(agent, { kind: 'submit' }, signal)).rejects.toThrow(/deadline exceeded/) }
  finally { clock.mockRestore() }
  expect(run.snapshot().decisions[id]).toMatchObject({ status: 'cancelled', cancellation: 'timeout' })
  expect(run.snapshot().operations).toEqual({})
})

it('rejects mismatched tool service outcomes and unrecordable observation blocks', async () => {
  const { ctx, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const tools = await import('@clocky/clocky-tool-simulation')
  await ctx.plugin(tools)
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, placement())
  const { CallId } = await import('@clocky/clocky-llm')
  const { simTimeSchema } = await import('@clocky/clocky-simulation')
  const owner = vi.spyOn(ctx.simulationTeams, 'modelRequest')
  try {
    for (const name of ['simulation_observe', 'simulation_stage', 'simulation_submit']) {
      owner.mockResolvedValueOnce(name === 'simulation_stage' ? { status: 'accepted', operationIds: [], effects: 'pending' }
        : { status: 'staged', count: 0, effects: 'none' })
      const result = await ctx.tools.execute({ name, callId: CallId(name), arguments: name === 'simulation_stage' ? { proposals: [] } : {},
        agent: activation.localAgent!, signal: new AbortController().signal })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('returned another operation result')
      expect(ctx.tools.get(name)?.presentCall?.(name === 'simulation_stage' ? { proposals: [] } : {})).toMatchObject({ card: 'generic' })
    }
    const block = { type: 'text' as const, text: 'Not serializable', extra: 1n }
    owner.mockResolvedValueOnce({ status: 'observed', time: simTimeSchema.parse('0'), sections: [{ kind: 'identity', blocks: [block] }] })
    const invalid = await ctx.tools.execute({ name: 'simulation_observe', callId: CallId('non-json'), arguments: {},
      agent: activation.localAgent!, signal: new AbortController().signal })
    expect(invalid.isError).toBe(true)
    expect(JSON.stringify(invalid)).toContain('non-JSON')
  } finally { owner.mockRestore() }
})

it('validates bootstrap names and explicit authority before allocating a root', async () => {
  const { ctx, run, serviceFiber } = await setup(false)
  const creation = { goal: { objective: 'Bootstrap', budgets: {} }, budgets: {} }
  const authority = (ctx.simulationTeams as unknown as { bootstrap: import('../src/bootstrap.ts').SimulationBootstrapAuthority }).bootstrap
  for (const owner of ['', ' untrimmed']) await expect(authority.ensure(run, creation, owner)).rejects.toThrow(/trimmed name/)
  await expect(authority.ensure(run, { ...creation, goal: { objective: '   ', budgets: {} } }, 'simulation/bootstrap'))
    .rejects.toThrow(/objective must not be empty/)
  const authorityGrant = { operations: [], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} }
  await authority.ensure(run, { ...creation, authorityGrant }, 'simulation/bootstrap')
  expect(run.snapshot().teamReservation!.creation.authorityGrant).toEqual(authorityGrant)
  await serviceFiber.dispose()
  await expect(authority.ensure(run, creation, 'simulation/bootstrap')).rejects.toThrow(/bootstrap is closed/)
})

it('does not confirm a root when its reservation response or target identity is missing', async () => {
  const { ctx, run } = await setup(false)
  const creation = { goal: { objective: 'Bootstrap', budgets: {} }, budgets: {} }
  const reserve = run.reserveTeam.bind(run)
  const missing = vi.spyOn(run, 'reserveTeam').mockImplementationOnce(async (...args) => {
    const { teamReservation: _reserved, ...rest } = await reserve(...args)
    return rest
  })
  try { await expect(ctx.simulationTeams.ensureTeam(run, creation, 'simulation/bootstrap')).rejects.toThrow(/omitted its reserved Team/) }
  finally { missing.mockRestore() }
  const create = ctx.teams.createTeam.bind(ctx.teams)
  const { teamIdSchema } = await import('@clocky/clocky-team')
  const foreign = vi.spyOn(ctx.teams, 'createTeam').mockImplementationOnce(async (request) => {
    const result = await create(request)
    return { ...result, team: { ...result.team, id: teamIdSchema.parse('foreign') } }
  })
  try { await expect(ctx.simulationTeams.ensureTeam(run, creation, 'simulation/bootstrap')).rejects.toThrow(/another Team identity/) }
  finally { foreign.mockRestore() }
  expect(run.snapshot().teamReservation!.confirmed).toBe(false)
  await ctx.simulationTeams.ensureTeam(run, creation, 'simulation/bootstrap')
  expect(run.snapshot().teamReservation!.confirmed).toBe(true)
})

it('drains bootstrap shutdown while storage has accepted its reservation but target IO has not started', async () => {
  const { ctx, run, serviceFiber } = await setup(false)
  const reserve = run.reserveTeam.bind(run)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const blocked = vi.spyOn(run, 'reserveTeam').mockImplementationOnce(async (...args) => {
    const result = await reserve(...args); entered.resolve(undefined); await release.promise; return result
  })
  const creation = { goal: { objective: 'Shutdown bootstrap', budgets: {} }, budgets: {} }
  const work = ctx.simulationTeams.ensureTeam(run, creation, 'simulation/bootstrap')
  const rejection = expect(work).rejects.toThrow(/retired before Team creation/)
  await entered.promise
  let closed = false
  const closing = serviceFiber.dispose().then(() => { closed = true })
  try {
    await Promise.resolve()
    expect(closed).toBe(false)
  } finally { release.resolve(undefined) }
  await rejection; await closing
  blocked.mockRestore()
  expect(run.snapshot().teamReservation!.confirmed).toBe(false)
})

it('revokes a root creation proof while its target call is pending during service shutdown', async () => {
  const { ctx, run, serviceFiber } = await setup(false)
  const create = ctx.teams.createTeam.bind(ctx.teams)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.teams, 'createTeam').mockImplementationOnce(async (request) => {
    entered.resolve(undefined); await release.promise; return await create(request)
  })
  const work = ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Retire pending root', budgets: {} }, budgets: {} }, 'simulation/bootstrap')
  const rejected = expect(work).rejects.toThrow(/proof/)
  await entered.promise
  const closing = serviceFiber.dispose()
  release.resolve(undefined)
  try { await rejected; await closing }
  finally { held.mockRestore() }
  expect(run.snapshot().teamReservation!.confirmed).toBe(false)
})

it('rejects a root proof when its source closes admission before the target resolves it', async () => {
  const { ctx, run, serviceFiber } = await setup(false)
  await serviceFiber.dispose()
  const { SimulationBootstrapAuthority } = await import('../src/bootstrap.ts')
  let admitted = true
  let authority: InstanceType<typeof SimulationBootstrapAuthority> | undefined
  const source = ctx.plugin({ inject: ['teams'], apply: (child: import('@clocky/cordis').Context) => {
    authority = new SimulationBootstrapAuthority(child, () => admitted)
  } })
  await source
  const create = ctx.teams.createTeam.bind(ctx.teams)
  const revoked = vi.spyOn(ctx.teams, 'createTeam').mockImplementationOnce(async (request) => {
    admitted = false
    return await create(request)
  })
  const input = { goal: { objective: 'Revoke root authority', budgets: {} }, budgets: {} }
  try {
    if (authority === undefined) throw new Error('fixture root owner missing')
    await expect(authority.ensure(run, input, 'simulation/bootstrap')).rejects.toThrow(/proof/)
    expect(run.snapshot().teamReservation!.confirmed).toBe(false)
    admitted = true
    await authority.ensure(run, input, 'simulation/bootstrap')
    expect(run.snapshot().teamReservation!.confirmed).toBe(true)
  } finally { revoked.mockRestore(); await source.dispose() }
})

it.each(['constructor', 'toString', '__proto__'])('runs a deterministic policy once for opaque decision id %s', async (value) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'opaque-policy', version: '1' })
  const infer = vi.fn()
  ctx.on('llm/stream', (_options, next) => { infer(); return next() }, { prepend: true })
  const decide = vi.fn(() => [])
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide })
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse(value)
  const result = await connection.executeDeterministicDecision(entityId, id, contextRequest(), policy)
  expect(result.status).toBe('accepted')
  expect(await connection.executeDeterministicDecision(entityId, id, contextRequest(), policy)).toEqual(result)
  expect(decide).toHaveBeenCalledTimes(1)
  expect(infer).not.toHaveBeenCalled()
  expect(activation.localAgent!.session.events.some(event => event.type === 'assistant/chunk')).toBe(false)
  expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
})

it('keeps deterministic completion retryable after a Session flush failure and rejects changed retry identity', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationPolicyRefSchema, simulationEventIdSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'checkpointed-policy', version: '1' })
  const decide = vi.fn(() => [])
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide })
  await connection.bind(entityId, participant.id); await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('flush-policy')
  const flush = vi.spyOn(ctx.sessions, 'flush').mockResolvedValueOnce(false)
  try { await expect(connection.executeDeterministicDecision(entityId, id, contextRequest(), policy)).rejects.toThrow(/durable Session/) }
  finally { flush.mockRestore() }
  expect(run.snapshot().decisions[id]!.status).toBe('accepted')
  const retryFlush = vi.spyOn(ctx.sessions, 'flush').mockResolvedValueOnce(false)
  try { await expect(connection.executeDeterministicDecision(entityId, id, contextRequest(), policy)).rejects.toThrow(/durable Session/) }
  finally { retryFlush.mockRestore() }
  expect((await connection.executeDeterministicDecision(entityId, id, contextRequest(), policy)).status).toBe('accepted')
  expect(decide).toHaveBeenCalledTimes(1)
  await expect(connection.executeDeterministicDecision(entityId, id, contextRequest(), { ...policy, version: '2' }))
    .rejects.toThrow(/changed its owner, wake or policy/)
  await expect(connection.executeDeterministicDecision(entityId, id, contextRequest(), policy, simulationEventIdSchema.parse('other')))
    .rejects.toThrow(/changed its owner, wake or policy/)
  const ordinary = simulationDecisionIdSchema.parse('already-completed')
  await connection.openDecision(entityId, ordinary); await connection.submitDecision(entityId, ordinary, [])
  await expect(connection.executeDeterministicDecision(entityId, ordinary, contextRequest(), policy))
    .rejects.toThrow(/no deterministic policy/)
})

it('rejects required deterministic input overflow before computing or dispatching a model', async () => {
  const { ctx, run, connection, entityId, participant } = await setup(true, 1)
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'small-budget', version: '1' })
  const decide = vi.fn(() => [])
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide })
  await connection.bind(entityId, participant.id); await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  await expect(connection.executeDeterministicDecision(entityId, simulationDecisionIdSchema.parse('overflow-policy'), contextRequest(), policy))
    .rejects.toThrow(/exceeds its configured budget/)
  expect(decide).not.toHaveBeenCalled()
  expect(run.snapshot().phase).toBe('stalled')
  expect(run.snapshot().tokenReservations).toBeUndefined()
})

it('refuses a deterministic policy that replaces itself during computation', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'retiring-policy', version: '1' })
  let remove = () => {}
  remove = ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: () => {
    remove(); ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: () => [] }); return []
  } })
  await connection.bind(entityId, participant.id); await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('retired-policy')
  await expect(connection.executeDeterministicDecision(entityId, id, contextRequest(), policy))
    .rejects.toThrow(/retired during computation/)
  expect(run.snapshot().decisions[id]!.deterministic?.proposals).toBeUndefined()
})

it.each(['policy-replaced', 'missing-result'] as const)('refuses deterministic %s at the durable computation boundary', async (failure) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'guarded-policy', version: '1' })
  const remove = ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: () => [] })
  const reserve = run.reserveWriter.bind(run)
  const intercept = vi.spyOn(run, 'reserveWriter').mockImplementationOnce(async (...args) => {
    const writer = await reserve(...args)
    if (failure === 'policy-replaced') {
      const read = writer.readPreparedContext.bind(writer)
      writer.readPreparedContext = async (id) => {
        const result = await read(id)
        remove(); ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: () => [] })
        return result
      }
    } else {
      const record = writer.recordDeterministicResult.bind(writer)
      writer.recordDeterministicResult = async (...args) => {
        const result = await record(...args)
        const { proposals: _proposals, ...withoutOutput } = result.deterministic!
        return { ...result, deterministic: withoutOutput }
      }
    }
    return writer
  })
  try {
    await connection.bind(entityId, participant.id); await connection.activate(entityId, placement())
    await run.setPhase('running', run.snapshot().revision)
    await expect(connection.executeDeterministicDecision(entityId, simulationDecisionIdSchema.parse('guarded'), contextRequest(), policy))
      .rejects.toThrow(/retired before computation|lost its recorded output/)
  } finally { intercept.mockRestore() }
})

it('refuses a deterministic decision prepared with model-only report references', async () => {
  const { ctx, run, connection, receiverId, operation, simTimeSchema } = await preparedPost()
  const { simulationKnowledgeRequestSchema, simulationDecisionIdSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
  const action = run.snapshot().operations[operation]!.action
  if (action.kind !== 'communication/post') throw new Error('fixture message missing')
  const knowledge = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'model-report', owner: receiverId,
    expectedRevision: 0, statement: action.text, source: { kind: 'report', operationId: operation }, readers: [],
    observedAt: '5', availableAt: '5', validFrom: '5', validUntil: null }))
  const id = simulationDecisionIdSchema.parse('model-prepared-policy')
  const wake = run.snapshot().operations[operation]!.delivery!.wakeId
  const context = { ...contextRequest(), knowledge: { ids: [knowledge.id], required: true } }
  await connection.openDecision(receiverId, id, wake)
  await connection.prepareContext(receiverId, id, context)
  const policy = simulationPolicyRefSchema.parse({ id: 'reference-policy', version: '1' })
  const decide = vi.fn(() => [])
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide })
  await expect(connection.executeDeterministicDecision(receiverId, id, context, policy, wake)).rejects.toThrow(/requires policy selection/)
  expect(decide).not.toHaveBeenCalled()
})

it.each([{ fails: false, resident: false }, { fails: true, resident: false },
  { fails: false, resident: true }, { fails: true, resident: true }])('drains an admitted coordinator drive before close with %j', async ({ fails, resident }) => {
  const { run, connection } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simTimeSchema } = await import('@clocky/clocky-simulation')
  await run.setPhase('running', run.snapshot().revision)
  const original = run.drive.bind(run)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(run, 'drive').mockImplementationOnce(async (request) => {
    entered.resolve(undefined)
    await release.promise
    if (fails) throw new Error('Drive storage unavailable')
    return await original(request)
  })
  const work = resident
    ? connection.driveResident({ until: simTimeSchema.parse('1') }, () => 0, () => ({ activation: placement(), evict: [] }))
    : connection.drive({ until: simTimeSchema.parse('1') }, () => 0)
  const settled = fails ? expect(work).rejects.toThrow('Drive storage unavailable') : expect(work).resolves.toMatchObject({ reason: 'until' })
  await entered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
  } finally {
    release.resolve(undefined)
    await settled
    await closing
    held.mockRestore()
  }
  expect(closed).toBe(true)
})

it.each([false, true])('drains a committed direct outbox dispatch with response lost=%s', async (lost) => {
  const { ctx, run, connection, operation, channel, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const delayed = vi.spyOn(ctx.teams, 'postChannelEnvelope').mockImplementationOnce(async (request) => {
    const envelope = await post(request)
    entered.resolve(undefined)
    await release.promise
    if (lost) throw new Error('Post response lost')
    return envelope
  })
  const dispatch = connection.dispatchOperation(operation, () => 100)
  await entered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
  } finally {
    release.resolve(undefined)
    await dispatch
    await closing
    delayed.mockRestore()
  }
  expect(await dispatch).toMatchObject({ status: lost ? 'retry' : 'settled' })
  if (lost) expect(run.snapshot().operations[operation]?.result).toBeUndefined()
  else expect(run.snapshot().operations[operation]?.result).toMatchObject({ status: 'applied' })
  expect((await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
    .filter(record => record.type === 'channel/envelope')).toHaveLength(1)
})

it.each([{ consumed: false, fails: false }, { consumed: false, fails: true },
  { consumed: true, fails: false }, { consumed: true, fails: true }])('drains input persistence before close with %j', async ({ consumed, fails }) => {
  const { ctx, connection, entityId, id, agent, adapter, prepared } = await inputHarness('close-consumed-input')
  if (consumed) { await connection.dispatchDecision(entityId, id); await agent.whenIdle() }
  const original = ctx.sessions.flush.bind(ctx.sessions)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const delayed = vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
    entered.resolve(undefined)
    await release.promise
    if (fails) throw new Error('Consumed-input flush unavailable')
    return await original(session)
  })
  const input = connection.dispatchDecision(entityId, id)
  const rejected = expect(input).rejects.toThrow(fails ? 'Consumed-input flush unavailable' : 'connection is closed')
  await entered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
  } finally {
    release.resolve(undefined)
    await rejected
    await closing
    delayed.mockRestore()
  }
  expect(adapter.requests).toHaveLength(consumed ? 1 : 0)
  expect(agent.session.events.filter(event => event.type === 'user/message' && event.data.id === MessageId(prepared.view.inputId))).toHaveLength(consumed ? 1 : 0)
})

it.each([false, true])('drains direct recipient discovery before close with read failure=%s', async (fails) => {
  const { ctx, run, connection, operation, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const read = ctx.teams.readChannelPage.bind(ctx.teams)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.teams, 'readChannelPage').mockImplementationOnce(async (request) => {
    entered.resolve(undefined)
    await release.promise
    if (fails) throw new Error('Recipient discovery unavailable')
    return await read(request)
  })
  const work = connection.receiveOperation(operation)
  const rejected = expect(work).rejects.toThrow(fails ? /Recipient discovery unavailable/ : /authority is no longer current/)
  await entered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(closed).toBe(false)
  } finally {
    release.resolve(undefined)
    await rejected
    await closing
    held.mockRestore()
  }
  expect(run.snapshot().operations[operation]?.delivery).toBeUndefined()
})

it.each([false, true])('drains a direct recovery lookup before close with read failure=%s', async (fails) => {
  const { ctx, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  const read = ctx.teams.getTeam.bind(ctx.teams)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (request) => {
    entered.resolve(undefined)
    await release.promise
    if (fails) throw new Error('Recovery discovery unavailable')
    return await read(request)
  })
  const work = connection.recover(entityId)
  const rejected = expect(work).rejects.toThrow(fails ? 'Recovery discovery unavailable' : 'connection is closed')
  await entered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
  } finally {
    release.resolve(undefined)
    await rejected
    await closing
    held.mockRestore()
  }
})

it.each([false, true])('drains a direct hibernation before close with retirement failure=%s', async (fails) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  const stop = ctx.teamActivations.stopOwnedActivation.bind(ctx.teamActivations)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.teamActivations, 'stopOwnedActivation').mockImplementationOnce(async (request) => {
    entered.resolve(undefined)
    await release.promise
    if (fails) throw new Error('Hibernation retirement unavailable')
    await stop(request)
  })
  const work = connection.hibernate(entityId)
  const settled = fails ? expect(work).rejects.toThrow('Hibernation retirement unavailable') : expect(work).resolves.toBeUndefined()
  await entered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(closed).toBe(false)
    expect(writer(run)?.phase).toBe('active')
  } finally {
    release.resolve(undefined)
    await settled
    await closing
    held.mockRestore()
  }
  expect(writer(run)?.phase).toBe('released')
})

it.each([false, true])('drains direct delivery reconciliation before close with persistence failure=%s', async (fails) => {
  const { run, connection, operation, receiverId, receiver } = await failedPost()
  await receiver.dispose()
  await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: receiverId,
    entityRevision: run.snapshot().entities[receiverId]!.revision, phase: 'terminated' }), run.snapshot().revision)
  const resolve = run.resolveDeliveryFailure.bind(run)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(run, 'resolveDeliveryFailure').mockImplementationOnce(async (...args) => {
    entered.resolve(undefined)
    await release.promise
    if (fails) throw new Error('Delivery reconciliation unavailable')
    return await resolve(...args)
  })
  const work = connection.reconcileDeliveryFailure(operation)
  const settled = fails ? expect(work).rejects.toThrow('Delivery reconciliation unavailable') : expect(work).resolves.toBe('entity-terminated')
  await entered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(closed).toBe(false)
  } finally {
    release.resolve(undefined)
    await settled
    await closing
    held.mockRestore()
  }
  expect(run.snapshot().operations[operation]?.deliveryFailure?.resolution?.kind).toBe(fails ? undefined : 'entity-terminated')
})

it('drains a direct recovery lookup before collecting a checkpoint', async () => {
  const { ctx, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  const read = ctx.teams.getTeam.bind(ctx.teams)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (request) => {
    entered.resolve(undefined)
    await release.promise
    return await read(request)
  })
  const recovery = connection.recover(entityId)
  const rejected = expect(recovery).rejects.toThrow(/checkpoint collection blocks/)
  await entered.promise
  let collected = false
  const collection = connection.collectCheckpointCandidate(4, 2).then((value) => { collected = true; return value })
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(collected).toBe(false)
  } finally {
    release.resolve(undefined)
    await rejected
    ;(await collection).release()
    held.mockRestore()
  }
})

it.each([{ fails: false, checkpoint: false }, { fails: true, checkpoint: false },
  { fails: false, checkpoint: true }, { fails: true, checkpoint: true }])('drains model decision completion with %j', async ({ fails, checkpoint }) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await ctx.plugin(await import('@clocky/clocky-tool-simulation'))
  const { toolCallResponse } = await import('../../../core/agent-loop/tests/mock-adapter.ts')
  const model = new MockAdapter([toolCallResponse('stage', 'simulation_stage', { proposals: [] }),
    toolCallResponse('submit', 'simulation_submit', {})])
  ctx.llm.registerAdapter(['completion-close'], model)
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'completion-close', model: 'fixture' } } })
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('completion-close')
  const accepted = await connection.executeDecision(entityId, id, contextRequest())
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  let calls = 0
  const held = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
    if (++calls === 2) {
      entered.resolve(undefined)
      await release.promise
      if (fails) throw new Error('Decision completion unavailable')
    }
    return await flush(session)
  })
  const work = connection.executeDecision(entityId, id, contextRequest())
  const rejected = expect(work).rejects.toThrow(fails
    ? /Decision completion unavailable/ : /connection is closed|checkpoint collection blocks/)
  await entered.promise
  let closed = false
  const closing = (checkpoint ? connection.collectCheckpointCandidate(4, 2).then((candidate) => { candidate.release() })
    : connection.close()).then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(closed).toBe(false)
  } finally {
    release.resolve(undefined)
    await rejected
    await closing
    held.mockRestore()
  }
  expect(run.snapshot().decisions[id]).toEqual(accepted)
  expect(model.requests).toHaveLength(2)
})

it.each([false, true])('rejects cognition admission without a resident writer (bound=%s)', async (bound) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  if (bound) await connection.bind(entityId, participant.id)
  const before = run.snapshot()
  const id = simulationDecisionIdSchema.parse('no-resident')
  await expect(connection.executeDecision(entityId, id, contextRequest())).rejects.toThrow(/no current local actor/)
  await expect(connection.executeDeterministicDecision(entityId, id, contextRequest(),
    simulationPolicyRefSchema.parse({ id: 'unavailable', version: '1' }))).rejects.toThrow(/requires its local writer/)
  await expect(connection.openDecision(entityId, id)).rejects.toThrow(/no live decision authority/)
  await expect(connection.prepareContext(entityId, id, contextRequest())).rejects.toThrow(/no live decision authority/)
  await expect(connection.submitDecision(entityId, id, [])).rejects.toThrow(/no live decision authority/)
  await expect(connection.cancelDecision(entityId, id)).rejects.toThrow(/no current writer/)
  await expect(connection.dispatchDecision(entityId, id)).rejects.toThrow(/no current local actor/)
  await expect(connection.hibernate(entityId)).rejects.toThrow(/requires a current local activation/)
  const { seed: _seed, ...request } = placement()
  await expect(connection.resume(entityId, request)).rejects.toThrow(/proven-stopped/)
  if (!bound) expect(() => connection.invitation(entityId)).toThrow(/active bound entity/)
  expect(run.snapshot()).toEqual(before)
  expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
})

it('coalesces an in-flight deterministic decision and refuses conflicting owner requests', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationPolicyRefSchema, simulationEventIdSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'single-flight', version: '1' })
  const decide = vi.fn(() => [])
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide })
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const read = ctx.teams.getTeam.bind(ctx.teams)
  const held = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (request) => {
    entered.resolve(undefined); await release.promise
    return await read(request)
  })
  const id = simulationDecisionIdSchema.parse('single-flight')
  const work = connection.executeDeterministicDecision(entityId, id, contextRequest(), policy)
  await entered.promise
  try {
    expect(connection.executeDeterministicDecision(entityId, id, contextRequest(), policy)).toBe(work)
    await expect(connection.executeDeterministicDecision(entityId, simulationDecisionIdSchema.parse('another'), contextRequest(), policy))
      .rejects.toThrow(/another deterministic computation/)
    await expect(connection.executeDeterministicDecision(entityId, id, contextRequest(), policy, simulationEventIdSchema.parse('another-wake')))
      .rejects.toThrow(/another deterministic computation/)
    await expect(connection.executeDeterministicDecision(entityId, id, contextRequest(), { ...policy, version: '2' }))
      .rejects.toThrow(/another deterministic computation/)
  } finally { release.resolve(undefined); held.mockRestore() }
  expect((await work).status).toBe('accepted')
  expect(decide).toHaveBeenCalledTimes(1)
})

it.each(['ordinary', 'resident'] as const)('keeps a single coordinator drive in flight (%s)', async (mode) => {
  const { run, connection } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simTimeSchema } = await import('@clocky/clocky-simulation')
  await run.setPhase('running', run.snapshot().revision)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const drive = run.drive.bind(run)
  const held = vi.spyOn(run, 'drive').mockImplementationOnce(async (request) => {
    entered.resolve(undefined); await release.promise
    return await drive(request)
  })
  const request = { until: simTimeSchema.parse('1') }
  const choose = () => ({ activation: placement(), evict: [] })
  const work = mode === 'ordinary' ? connection.drive(request, () => 0) : connection.driveResident(request, () => 0, choose)
  await entered.promise
  try {
    if (mode === 'ordinary') {
      expect(connection.drive(request, () => 1)).toBe(work)
      await expect(connection.drive({ until: simTimeSchema.parse('2') }, () => 0)).rejects.toThrow(/another horizon/)
      await expect(connection.driveResident(request, () => 0, choose)).rejects.toThrow(/already driving/)
    } else {
      await expect(connection.driveResident(request, () => 0, choose)).rejects.toThrow(/already in progress/)
      await expect(connection.drive(request, () => 0)).rejects.toThrow(/resident drive is already/)
    }
  } finally { release.resolve(undefined); held.mockRestore() }
  expect(await work).toMatchObject({ reason: 'until' })
})

it('rejects a second residency transition while retaining the first activation', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  const read = ctx.teams.getTeam.bind(ctx.teams)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (request) => {
    entered.resolve(undefined); await release.promise
    return await read(request)
  })
  const choice = { activation: placement(), evict: [] }
  const work = connection.ensureResident(entityId, choice)
  await entered.promise
  try { await expect(connection.ensureResident(entityId, choice)).rejects.toThrow(/transition is already in progress/) }
  finally { release.resolve(undefined); held.mockRestore() }
  expect((await work).status).toBe('resident')
  expect(run.population().chargedActors).toBe(1)
})

it.each([[0, 1], [1, 0], [1.5, 1], [1, 1.5]])('rejects invalid checkpoint bounds %j before pausing', async (drain, attempts) => {
  const { run, connection } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await run.setPhase('running', run.snapshot().revision)
  const before = run.snapshot()
  await expect(connection.collectCheckpointCandidate(drain, attempts)).rejects.toThrow(/positive safe integers/)
  expect(run.snapshot()).toEqual(before)
})

it('refuses root bootstrap while a connection already owns the run', async () => {
  const { ctx, run } = await setup()
  await expect(ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Duplicate root', budgets: {} }, budgets: {} }, 'simulation/company'))
    .rejects.toThrow(/unattached run/)
  expect(run.snapshot().teamReservation).toBeUndefined()
})

it('honors a downstream pre-step veto without publishing context or dispatching inference', async () => {
  const { ctx, connection, entityId, id, agent, adapter } = await inputHarness('vetoed-step')
  const remove = ctx.on('agent/pre-step', async () => ({ kind: 'reject' as const }))
  try {
    await connection.dispatchDecision(entityId, id)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'simulation/context-view')).toBe(false)
  } finally { remove() }
})

it.each(['context', 'request'] as const)('refuses inference when the %s durability barrier returns false', async (boundary) => {
  const { ctx, connection, entityId, id, agent, adapter } = await inputHarness(`false-${boundary}-flush`)
  const flush = vi.spyOn(ctx.sessions, 'flush')
  const remove = boundary === 'context'
    ? ctx.on('agent/pre-step', async (_event, next) => { flush.mockResolvedValueOnce(false); return await next() })
    : ctx.on('llm/stream', (_options, next) => { flush.mockResolvedValueOnce(false); return next() }, { prepend: true })
  try {
    await connection.dispatchDecision(entityId, id)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'simulation/context-view')).toBe(true)
    expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
  } finally { remove(); flush.mockRestore() }
})

it('rejects a prepared context with another deployment byte budget before model IO', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  let lease: import('@clocky/clocky-simulation').SimulationWriterLease | undefined
  const reserve = run.reserveWriter.bind(run)
  const captured = vi.spyOn(run, 'reserveWriter').mockImplementation(async (...args) => {
    lease = await reserve(...args)
    return lease
  })
  const adapter = new MockAdapter([textResponse('Must not run')])
  ctx.llm.registerAdapter(['mock'], adapter)
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'mock', model: 'mock' } } })
  captured.mockRestore()
  if (lease === undefined || activation.localAgent === undefined) throw new Error('fixture writer missing')
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('changed-context-policy')
  await connection.openDecision(entityId, id)
  expect((await lease.prepareContext(id, contextRequest(32768))).status).toBe('prepared')
  await connection.dispatchDecision(entityId, id)
  await activation.localAgent.whenIdle()
  expect(adapter.requests).toHaveLength(0)
  expect(activation.localAgent.session.events.some(event => event.type === 'simulation/context-view')).toBe(false)
})

it.each(['unowned', 'session-title'] as const)('rejects %s model routing for a canonical Simulation Session', async (kind) => {
  const { ctx, connection, entityId, id, agent, adapter } = await inputHarness(`unowned-${kind}`)
  if (kind === 'unowned') await connection.cancelDecision(entityId, id)
  const consume = async () => {
    for await (const _chunk of ctx.llm.stream({ provider: 'mock', model: 'mock', sessionId: agent.session.id,
      messages: agent.session.deriveMessages(), ...(kind === 'session-title' ? { purpose: 'session-title' as const } : {}) })) {
      // The routing guard must reject before any provider chunk is available.
    }
  }
  await expect(consume()).rejects.toThrow(/current conversation decision/)
  expect(adapter.requests).toHaveLength(0)
})

it('rejects unlogged request content added by a downstream request plugin', async () => {
  const { ctx, connection, entityId, id, agent, adapter } = await inputHarness('unlogged-request')
  const remove = ctx.on('llm/stream', (options, next) => {
    options.messages = [...options.messages, createUserMessage({ source: { kind: 'plugin', plugin: 'unlogged-context' },
      content: [{ type: 'text', text: 'Unrecorded instruction' }] })]
    return next()
  }, { prepend: true })
  try {
    await connection.dispatchDecision(entityId, id)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.deriveMessages().some(message => message.content.some(block => block.type === 'text'
      && block.text === 'Unrecorded instruction'))).toBe(false)
  } finally { remove() }
})

it.each(['drive', 'bind', 'recover'] as const)('closes %s admission across attached runs while another bootstrap drains', async (operation) => {
  const { ctx, run, connection, entityId, participant, serviceFiber } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simTimeSchema } = await import('@clocky/clocky-simulation')
  const service = ctx.simulationTeams
  const other = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create',
    spec: { ...run.snapshot().spec, runId: 'other-bootstrap' } }))
  cleanups.push(() => other.close())
  await run.setPhase('running', run.snapshot().revision)
  const before = run.snapshot()
  const reserve = other.reserveTeam.bind(other)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(other, 'reserveTeam').mockImplementationOnce(async (...args) => {
    const result = await reserve(...args)
    entered.resolve(undefined); await release.promise
    return result
  })
  const bootstrap = service.ensureTeam(other, { goal: { objective: 'Drain another run', budgets: {} }, budgets: {} }, 'simulation/other')
  const rejected = expect(bootstrap).rejects.toThrow(/retired before Team creation/)
  await entered.promise
  let closed = false
  const closing = serviceFiber.dispose().then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
    await expect(Promise.resolve().then<unknown>(() => operation === 'drive' ? connection.drive({ until: simTimeSchema.parse('1') }, () => 0)
      : operation === 'bind' ? connection.bind(entityId, participant.id) : connection.recover(entityId)))
      .rejects.toThrow(/service is closed/)
    expect(run.snapshot()).toEqual(before)
  } finally {
    release.resolve(undefined)
    await rejected
    await closing
    held.mockRestore()
  }
})

it('retains a Session until consumed-input persistence settles during checkpoint collection', async () => {
  const { ctx, run, connection, entityId, id, agent } = await inputHarness('checkpoint-consumed-input')
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
    entered.resolve(undefined)
    await release.promise
    return await flush(session)
  })
  const input = connection.dispatchDecision(entityId, id)
  const refused = expect(input).rejects.toThrow(/checkpoint collection blocks/)
  await entered.promise
  let collected = false
  const pending = connection.collectCheckpointCandidate(4, 2).then((candidate) => { collected = true; return candidate })
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(collected).toBe(false)
    expect(ctx.agents.get(agent.id)).toBe(agent)
    expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('active')
  } finally {
    release.resolve(undefined)
    try { await refused }
    finally { (await pending).release(); held.mockRestore() }
  }
  expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('released')
})

it('cancels directly dispatched inference before waiting for its consumed-input flush at a checkpoint', async () => {
  const { ctx, run, connection, entityId, id, agent, adapter } = await inputHarness('direct-checkpoint')
  const streamed = Promise.withResolvers<undefined>(), aborted = Promise.withResolvers<undefined>()
  vi.spyOn(adapter, 'stream').mockImplementation(async function* (options) {
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 0 } }
    const signal = options.signal
    if (signal === undefined) throw new Error('fixture cancellation missing')
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => { aborted.resolve(undefined); resolve() }, { once: true })
      streamed.resolve(undefined)
    })
    signal.throwIfAborted()
  })
  await connection.dispatchDecision(entityId, id)
  await streamed.promise
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
    entered.resolve(undefined); await release.promise
    return await flush(session)
  })
  const input = connection.dispatchDecision(entityId, id)
  const rejected = expect(input).rejects.toThrow(/checkpoint collection blocks/)
  await entered.promise
  const collection = connection.collectCheckpointCandidate(4, 2)
  try {
    await aborted.promise
    expect(ctx.agents.get(agent.id)).toBe(agent)
  } finally {
    release.resolve(undefined)
    try { await rejected }
    finally { (await collection).release(); held.mockRestore() }
  }
  expect(run.snapshot().decisions[id]?.status).toBe('cancelled')
  expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
})

it.each(['ordinary', 'resident'] as const)('drains the admitted %s drive before checkpoint collection', async (mode) => {
  const { run, connection } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simTimeSchema } = await import('@clocky/clocky-simulation')
  await run.setPhase('running', run.snapshot().revision)
  const drive = run.drive.bind(run)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(run, 'drive').mockImplementationOnce(async (request) => {
    entered.resolve(undefined); await release.promise
    return await drive(request)
  })
  const request = { until: simTimeSchema.parse('1') }
  const work = mode === 'ordinary' ? connection.drive(request, () => 0)
    : connection.driveResident(request, () => 0, () => ({ activation: placement(), evict: [] }))
  await entered.promise
  let collected = false
  const collection = connection.collectCheckpointCandidate(4, 2).then((candidate) => { collected = true; return candidate })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(collected).toBe(false)
  } finally {
    release.resolve(undefined)
    try { expect(await work).toMatchObject({ reason: 'paused' }) }
    finally { (await collection).release(); held.mockRestore() }
  }
})

it('coalesces hibernation and waits for its retirement before collecting a checkpoint', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  const stop = ctx.teamActivations.stopOwnedActivation.bind(ctx.teamActivations)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.teamActivations, 'stopOwnedActivation').mockImplementationOnce(async (request) => {
    entered.resolve(undefined); await release.promise
    await stop(request)
  })
  const work = connection.hibernate(entityId)
  await entered.promise
  expect(connection.hibernate(entityId)).toBe(work)
  const collection = connection.collectCheckpointCandidate(4, 2)
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(held).toHaveBeenCalledTimes(1)
    expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('active')
  } finally {
    release.resolve(undefined)
    try { await work }
    finally { (await collection).release(); held.mockRestore() }
  }
  expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('released')
})

it('retains accepted deterministic output while checkpoint collection drains its Session flush', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'checkpoint-policy', version: '1' })
  const decide = vi.fn(() => [])
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide })
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
    entered.resolve(undefined); await release.promise
    return await flush(session)
  })
  const id = simulationDecisionIdSchema.parse('checkpoint-policy')
  const work = connection.executeDeterministicDecision(entityId, id, contextRequest(), policy)
  const rejected = expect(work).rejects.toEqual({ kind: 'hook', reason: 'Simulation checkpoint collection' })
  await entered.promise
  const collection = connection.collectCheckpointCandidate(4, 2)
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(ctx.agents.get(activation.binding.sessionId)).toBe(activation.localAgent)
    expect(run.snapshot().decisions[id]?.status).toBe('accepted')
  } finally {
    release.resolve(undefined)
    try { await rejected }
    finally { (await collection).release(); held.mockRestore() }
  }
  expect(run.snapshot().decisions[id]?.status).toBe('accepted')
  expect(decide).toHaveBeenCalledTimes(1)
})

it.each(['maxConcurrentModels', 'maxQueuedModels', 'maxCoordinationRounds', 'deliveryPageSize', 'maxContextBytes'] as const)(
  'rejects unsafe integer configuration for %s at plugin startup', async (field) => {
    const { ctx, run, serviceFiber } = await setup(false)
    await serviceFiber.dispose()
    const { default: SimulationTeams } = await import('../src/index.ts')
    const config = { maxConcurrentModels: 2, maxQueuedModels: 16, maxCoordinationRounds: 16, deliveryPageSize: 32, maxContextBytes: 65536,
      [field]: Number.MAX_SAFE_INTEGER + 1 }
    const before = run.snapshot()
    const failed = ctx.plugin(SimulationTeams, config)
    await expect(Promise.resolve(failed)).rejects.toThrow(/capacity limits are invalid|positive safe integer/)
    await failed.dispose()
    expect(run.snapshot()).toEqual(before)
  })

it('retries hibernation cleanup through checkpoint collection after a failed final Session flush', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const failure = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async session => run.snapshot().entities[entityId]?.writer?.phase === 'revoked'
    ? false : await flush(session))
  try { await expect(connection.hibernate(entityId)).rejects.toThrow(/durable Session/) }
  finally { failure.mockRestore() }
  expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('revoked')
  expect(run.population().chargedActors).toBe(1)
  const candidate = await connection.collectCheckpointCandidate(4, 2)
  try {
    await candidate.validate()
    expect(run.population().chargedActors).toBe(0)
    expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('released')
  } finally { candidate.release() }
  const { seed: _seed, ...request } = placement()
  await connection.resume(entityId, request)
  expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('active')
})

it.each(['summary', 'deterministic'] as const)('keeps a replacement %s policy registered after its old disposer is repeated', async (kind) => {
  const { ctx } = await setup()
  const { simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'reloaded-policy', version: '1' })
  const register = (version: string) => kind === 'summary'
    ? ctx.simulationTeams.registerSummaryPolicy({ ...policy, version, summarize: () => 'Summary' })
    : ctx.simulationTeams.registerDeterministicPolicy({ ...policy, version, decide: () => [] })
  const old = register('1')
  old()
  const replacement = register('2')
  old()
  expect(() => register('3')).toThrow(/already registered/)
  replacement()
  register('3')()
})

it('rejects direct inference after an unsubmitted decision turn has ended', async () => {
  const { ctx, run, connection, entityId, id, agent, adapter } = await inputHarness('ended-turn-inference')
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  expect(agent.status).toBe('idle')
  const tokens = run.budgetUsage().tokens.used
  const downstream = vi.spyOn(adapter, 'stream')
  const consume = async () => {
    for await (const _chunk of ctx.llm.stream({ provider: 'mock', model: 'mock', sessionId: agent.session.id,
      messages: agent.session.deriveMessages() })) { /* Drain any incorrectly admitted stream. */ }
  }
  await expect(consume()).rejects.toThrow(/active Agent turn/)
  expect(downstream).not.toHaveBeenCalled()
  expect(run.budgetUsage().tokens.used).toBe(tokens)
})

it('does not reuse a prior turn consumed input to authorize a later unrelated turn', async () => {
  const { run, connection, entityId, id, agent, adapter } = await inputHarness('prior-turn-inference')
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  const tokens = run.budgetUsage().tokens.used
  agent.send(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'An unrelated new turn' }] }), 'next-turn', true)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(run.budgetUsage().tokens.used).toBe(tokens)
})

it('rechecks the recorded conversation after token reservation and before provider IO', async () => {
  const { ctx, run, connection, entityId, id, agent, adapter } = await inputHarness('token-boundary-drift')
  const stream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const append = stream.append.bind(stream)
  let changed = false
  const drift = vi.spyOn(stream, 'append').mockImplementation(async (cursor, values) => {
    const result = await append(cursor, values)
    if (!changed && JSON.stringify(values).includes('"kind":"token/reserved"')) {
      changed = true
      agent.session.append('user/message', createUserMessage({ source: { kind: 'plugin', plugin: 'concurrent-context' },
        content: [{ type: 'text', text: 'Concurrent recorded context' }] }), { surfaceOp: 'append' })
    }
    return result
  })
  try {
    await connection.dispatchDecision(entityId, id)
    await agent.whenIdle()
    expect(changed).toBe(true)
    expect(adapter.requests).toHaveLength(0)
    expect(Object.values(run.snapshot().tokenReservations ?? {}).map(value => value.status)).toEqual(['not-dispatched'])
    expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
  } finally { drift.mockRestore() }
})

it.each(['config', 'system', 'tools'] as const)('rejects request-header %s drift during token reservation', async (field) => {
  const { ctx, run, connection, entityId, id, agent, adapter } = await inputHarness(`header-${field}-drift`)
  const stream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const append = stream.append.bind(stream)
  let changed = false
  const drift = vi.spyOn(stream, 'append').mockImplementation(async (cursor, values) => {
    const result = await append(cursor, values)
    if (!changed && JSON.stringify(values).includes('"kind":"token/reserved"')) {
      changed = true
      const header = agent.session.requestHeader()
      if (header === undefined) throw new Error('fixture header missing')
      const replacement = field === 'config' ? { ...header, config: { ...header.config, maxTokens: (header.config.maxTokens ?? 256) + 1 } }
        : field === 'system' ? { ...header, system: 'Changed after request assembly' }
          : { ...header, tools: [{ name: 'different_tool', description: 'Different capability', parameters: { type: 'object' } }] }
      agent.session.append('request/header', { header: replacement, reason: 'change' })
    }
    return result
  })
  try {
    await connection.dispatchDecision(entityId, id)
    await agent.whenIdle()
    expect(changed).toBe(true)
    expect(adapter.requests).toHaveLength(0)
    expect(Object.values(run.snapshot().tokenReservations ?? {}).map(value => value.status)).toEqual(['not-dispatched'])
    expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
  } finally { drift.mockRestore() }
})

it('refuses an actor turn without an open decision owner', async () => {
  const { ctx, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const model = new MockAdapter([textResponse('Must not run')])
  ctx.llm.registerAdapter(['unowned-turn'], model)
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'unowned-turn', model: 'fixture' } } })
  if (activation.localAgent === undefined) throw new Error('fixture actor missing')
  activation.localAgent.send(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Unowned turn' }] }), 'next-turn', true)
  await activation.localAgent.whenIdle()
  expect(model.requests).toHaveLength(0)
  expect(activation.localAgent.session.events.some(event => event.type === 'simulation/context-view')).toBe(false)
})

it('refuses model inference for an explicitly deterministic window slot', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationWindowIdSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'window-no-model', version: '1' })
  const decide = vi.fn(() => [])
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide })
  const model = new MockAdapter([textResponse('Must not run')])
  ctx.llm.registerAdapter(['no-model-window'], model)
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'no-model-window', model: 'fixture' } } })
  if (activation.localAgent === undefined) throw new Error('fixture actor missing')
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('no-model-window')
  await connection.openWindow({ id: simulationWindowIdSchema.parse('policy-window'), decisions: [{ id, entityId, policy, context: contextRequest() }] })
  expect(run.snapshot().decisions[id]?.deterministic?.policy).toEqual(policy)
  activation.localAgent.send(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Attempt inference' }] }), 'next-turn', true)
  await activation.localAgent.whenIdle()
  expect(model.requests).toHaveLength(0)
  expect(decide).not.toHaveBeenCalled()
})

it('refuses inference when two context views remain visible in a canonical Session', async () => {
  const { connection, entityId, id, agent, adapter, prepared } = await inputHarness('duplicate-view')
  agent.session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
  agent.session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(0)
  expect(agent.session.events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'error'
    && event.data.reason.error.message.includes('multiple active context views'))).toBe(true)
})

it('requires exact prepared-input consumption before direct model dispatch', async () => {
  const { ctx, agent, adapter } = await inputHarness('unconsumed-model')
  const consume = async () => {
    for await (const _chunk of ctx.llm.stream({ provider: 'mock', model: 'mock', sessionId: agent.session.id,
      messages: agent.session.deriveMessages() })) { /* Drain an incorrectly admitted stream. */ }
  }
  await expect(consume()).rejects.toThrow(/has not consumed its exact prepared input/)
  expect(adapter.requests).toHaveLength(0)
})

it('rejects a different decision id without queuing another control input', async () => {
  const { connection, entityId, agent, adapter } = await inputHarness('owned-input')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await expect(connection.dispatchDecision(entityId, simulationDecisionIdSchema.parse('missing-input'))).rejects.toThrow(/no owned prepared decision/)
  expect(agent.inbox.nextTurn).toHaveLength(0)
  expect(adapter.requests).toHaveLength(0)
})

it.each(['queued', 'consumed'] as const)('preserves %s control input after a false persistence barrier', async (phase) => {
  const { ctx, connection, entityId, id, agent, adapter, prepared } = await inputHarness(`false-${phase}`)
  if (phase === 'consumed') { await connection.dispatchDecision(entityId, id); await agent.whenIdle() }
  const flush = vi.spyOn(ctx.sessions, 'flush').mockResolvedValueOnce(false)
  try { await expect(connection.dispatchDecision(entityId, id)).rejects.toThrow(/requires durable Session storage/) }
  finally { flush.mockRestore() }
  expect(adapter.requests).toHaveLength(phase === 'consumed' ? 1 : 0)
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(agent.session.events.filter(event => event.type === 'user/message' && event.data.id === MessageId(prepared.view.inputId))).toHaveLength(1)
})

it('refuses to wake a removed queue input and retries without duplicate consumption', async () => {
  const { ctx, connection, entityId, id, agent, adapter, prepared } = await inputHarness('removed-before-wake')
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const removed = vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
    const result = await flush(session)
    agent.inbox.remove(MessageId(prepared.view.inputId))
    return result
  })
  try { await expect(connection.dispatchDecision(entityId, id)).rejects.toThrow(/no longer available to wake/) }
  finally { removed.mockRestore() }
  expect(adapter.requests).toHaveLength(0)
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(agent.session.events.filter(event => event.type === 'user/message' && event.data.id === MessageId(prepared.view.inputId))).toHaveLength(1)
})

it('rejects a changed in-flight checkpoint request without replacing its accepted work', async () => {
  const { run, connection } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const request = simulationCheckpointRequestSchema.parse({ id: 'inflight-cut', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  const begin = run.beginCheckpoint.bind(run)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(run, 'beginCheckpoint').mockImplementationOnce(async (value) => {
    entered.resolve(undefined); await release.promise
    return await begin(value)
  })
  const work = connection.checkpoint(request)
  await entered.promise
  try {
    await expect(connection.checkpoint({ ...request, maxAttempts: 2 })).rejects.toThrow(/changed its request/)
    expect(connection.checkpoint(request)).toBe(work)
    expect(held).toHaveBeenCalledTimes(1)
  } finally { release.resolve(undefined); held.mockRestore() }
  expect((await work).status).toBe('completed')
})

it('returns a durably published checkpoint after losing its publication response', async () => {
  const { run, connection } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const request = simulationCheckpointRequestSchema.parse({ id: 'published-response-lost', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  const collect = connection.collectCheckpointCandidate.bind(connection)
  const fail = vi.spyOn(run, 'failCheckpoint')
  const lost = vi.spyOn(connection, 'collectCheckpointCandidate').mockImplementationOnce(async (...args) => {
    const candidate = await collect(...args)
    return { ...candidate, publish: async (id) => { await candidate.publish(id); throw new Error('Publication response lost') } }
  })
  try {
    const result = await connection.checkpoint(request)
    expect(result.status).toBe('completed')
    expect(fail).not.toHaveBeenCalled()
    expect(run.snapshot().latestCheckpointId).toBe(request.id)
    const before = run.snapshot()
    expect(await connection.checkpoint(request)).toEqual(result)
    expect(run.snapshot()).toEqual(before)
  } finally { lost.mockRestore(); fail.mockRestore() }
})

it('persists a non-Error checkpoint failure and releases collection admission', async () => {
  const { ctx, run, connection } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationCheckpointRequestSchema, simTimeSchema } = await import('@clocky/clocky-simulation')
  const request = simulationCheckpointRequestSchema.parse({ id: 'opaque-failure', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  const fault = vi.spyOn(ctx.teams, 'getTeam').mockRejectedValueOnce('Opaque storage failure')
  try { expect(await connection.checkpoint(request)).toMatchObject({ status: 'failed', error: 'Opaque storage failure' }) }
  finally { fault.mockRestore() }
  await run.setPhase('running', run.snapshot().revision)
  expect(await connection.drive({ until: simTimeSchema.parse('1') }, () => 0)).toMatchObject({ reason: 'until' })
})

it.each(['hibernate', 'close', 'checkpoint', 'lease', 'service-bootstrap'] as const)('retains an auxiliary model and Session until %s cleanup settles', async (mode) => {
  const { ctx, run, connection, entityId, participant, serviceFiber } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const service = ctx.simulationTeams
  const { CompactionId, recordCompactionRequest } = await import('@clocky/clocky-compaction')
  const adapter = new MockAdapter([])
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const cancellation = new AbortController()
  let providerCancelled = false
  vi.spyOn(adapter, 'stream').mockImplementation(async function* (options) {
    yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 2 } }
    const signal = options.signal
    if (signal === undefined) throw new Error('fixture model signal missing')
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => { providerCancelled = true; resolve() }, { once: true })
      entered.resolve(undefined)
    })
    await release.promise
    signal.throwIfAborted()
  })
  ctx.llm.registerAdapter(['aux-retirement'], adapter)
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, placement())
  const actor = activation.localAgent
  if (actor === undefined) throw new Error('fixture actor missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const pendingDecision = simulationDecisionIdSchema.parse('retiring-input')
  if (mode === 'lease') {
    await run.setPhase('running', run.snapshot().revision)
    await connection.openDecision(entityId, pendingDecision)
    await connection.prepareContext(entityId, pendingDecision, contextRequest())
  }
  const compactionId = CompactionId(`retirement-${mode}`)
  actor.session.append('compaction/start', { compactionId, turn: null })
  const options = recordCompactionRequest(actor.session, { sessionId: actor.session.id, purpose: 'compaction',
    signal: cancellation.signal, provider: 'aux-retirement', model: 'fixture', messages: [createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Source to compact' }],
    })] })
  const work = (async () => { for await (const _chunk of ctx.llm.stream(options)) { /* Drain the owned auxiliary request. */ } })()
    .catch((error: unknown) => error)
  await entered.promise
  const bootstrapRelease = Promise.withResolvers<undefined>()
  let bootstrapRejected: Promise<void> | undefined
  if (mode === 'service-bootstrap') {
    const extra = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create',
      spec: { ...run.snapshot().spec, runId: 'pending-aux-bootstrap' } }))
    cleanups.push(() => extra.close())
    const reserve = extra.reserveTeam.bind(extra)
    const reserved = Promise.withResolvers<undefined>()
    vi.spyOn(extra, 'reserveTeam').mockImplementationOnce(async (...args) => {
      const result = await reserve(...args)
      reserved.resolve(undefined); await bootstrapRelease.promise
      return result
    })
    bootstrapRejected = expect(service.ensureTeam(extra, { goal: { objective: 'Pending bootstrap', budgets: {} }, budgets: {} },
      'simulation/pending-aux-bootstrap')).rejects.toThrow(/retired before Team creation/)
    await reserved.promise
  }
  let stopped = false
  let candidate: import('../src/types.ts').SimulationCheckpointCollection | undefined
  const stopping = (mode === 'service-bootstrap' ? serviceFiber.dispose() : mode === 'checkpoint' ? connection.collectCheckpointCandidate(4, 2).then((value) => { candidate = value })
    : mode === 'hibernate' ? connection.hibernate(entityId) : mode === 'lease' ? activation.dispose() : connection.close())
    .then(() => { stopped = true })
  try {
    await vi.waitFor(() => { expect(providerCancelled).toBe(true) })
    expect(cancellation.signal.aborted).toBe(false)
    if (mode === 'lease') await expect(connection.dispatchDecision(entityId, pendingDecision)).rejects.toThrow(/no current writer/)
    expect(stopped).toBe(false)
    expect(service.modelUsage().active).toBe(1)
    expect(run.population().chargedActors).toBe(1)
    expect(ctx.agents.get(actor.id)).toBe(actor)
  } finally {
    cancellation.abort(new Error('Test cancellation'))
    release.resolve(undefined)
    await work
    bootstrapRelease.resolve(undefined)
    await bootstrapRejected
    await stopping
    candidate?.release()
  }
  expect(await work).toBeUndefined()
  expect(service.modelUsage().active).toBe(0)
  expect(run.population().chargedActors).toBe(0)
  expect(Object.values(run.snapshot().tokenReservations ?? {})[0]).toMatchObject({ status: 'unknown',
    observedUsage: { inputTokens: 17, outputTokens: 2 } })
})

it('retires auxiliary streams only for their exact writer while another actor keeps running', async () => {
  const { ctx, run, connection, entityId, sender, receiver } = await preparedPost()
  const { CompactionId, recordCompactionRequest } = await import('@clocky/clocky-compaction')
  const adapter = new MockAdapter([])
  const entered = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()]
  const release = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()]
  const cancelled = [false, false]
  const controllers = [new AbortController(), new AbortController()]
  vi.spyOn(adapter, 'stream').mockImplementation(async function* (options) {
    const index = Number(options.model)
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } }
    const signal = options.signal
    if (signal === undefined) throw new Error('fixture cancellation missing')
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => { cancelled[index] = true; resolve() }, { once: true })
      entered[index]!.resolve(undefined)
    })
    await release[index]!.promise
    signal.throwIfAborted()
  })
  ctx.llm.registerAdapter(['aux-isolation'], adapter)
  const actors = [sender.localAgent!, receiver.localAgent!]
  const work = actors.map((actor, index) => {
    const compactionId = CompactionId(`isolated-${index}`)
    actor.session.append('compaction/start', { compactionId, turn: null })
    const options = recordCompactionRequest(actor.session, { sessionId: actor.session.id, purpose: 'compaction',
      signal: controllers[index]!.signal, provider: 'aux-isolation', model: String(index), messages: [createUserMessage({
        source: { kind: 'user' }, content: [{ type: 'text', text: 'Isolated source' }],
      })] })
    return (async () => { for await (const _chunk of ctx.llm.stream(options)) { /* Drain each actor's auxiliary request. */ } })()
  })
  await Promise.all(entered.map(value => value.promise))
  const sleeping = connection.hibernate(entityId)
  try {
    await vi.waitFor(() => { expect(cancelled[0]).toBe(true) })
    expect(cancelled[1]).toBe(false)
    expect(ctx.simulationTeams.modelUsage().active).toBe(2)
    release[0]!.resolve(undefined)
    await work[0]
    await sleeping
    expect(ctx.simulationTeams.modelUsage().active).toBe(1)
    expect(run.population().chargedActors).toBe(1)
    expect(ctx.agents.get(actors[1]!.id)).toBe(actors[1])
    expect(cancelled[1]).toBe(false)
  } finally {
    for (const controller of controllers) controller.abort(new Error('Test cleanup'))
    for (const pending of release) pending.resolve(undefined)
    await Promise.all(work)
    await sleeping
  }
  expect(ctx.simulationTeams.modelUsage().active).toBe(0)
})

it('automatically resumes a dormant recipient and records its delivery without inference', async () => {
  const { run, connection, receiverId, receiver, operation, simTimeSchema, model } = await preparedPost()
  await receiver.dispose()
  const choose = vi.fn(() => ({ activation: { provider: 'in-process', seed: { kind: 'resume' as const },
    agent: { options: { provider: 'mock', model: 'mock' } }, signal: new AbortController().signal }, evict: [] }))
  expect(await connection.driveResident({ until: simTimeSchema.parse('5') }, () => 100, choose))
    .toMatchObject({ reason: 'decision-required' })
  expect(choose).toHaveBeenCalledTimes(1)
  expect(choose).toHaveBeenCalledWith(receiverId)
  expect(run.snapshot().entities[receiverId]?.binding?.sessionId).toBe(receiver.binding.sessionId)
  expect(run.snapshot().entities[receiverId]?.writer?.phase).toBe('active')
  expect(run.snapshot().operations[operation]?.delivery?.receipt).toBeDefined()
  expect(model.requests).toHaveLength(0)
})

it('refuses a deterministic window whose selected policy version is not registered', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationPolicyRefSchema, simulationWindowIdSchema, simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const policy = simulationPolicyRefSchema.parse({ id: 'versioned-window', version: '1' })
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: () => [] })
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  const before = run.snapshot()
  await expect(connection.openWindow({ id: simulationWindowIdSchema.parse('wrong-policy'), decisions: [{
    id: simulationDecisionIdSchema.parse('wrong-policy'), entityId, context: contextRequest(), policy: { ...policy, version: '2' },
  }] })).rejects.toThrow(/policy version is not registered/)
  expect(run.snapshot()).toEqual(before)
})

it('drains an admitted checkpoint request and records its failed outcome before close returns', async () => {
  const { ctx, run, connection, teamId } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const request = simulationCheckpointRequestSchema.parse({ id: 'closing-cut', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  const getTeam = ctx.teams.getTeam.bind(ctx.teams)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (input) => {
    entered.resolve(undefined); await release.promise
    return await getTeam(input)
  })
  const work = connection.checkpoint(request)
  await entered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
  } finally { release.resolve(undefined); await closing; held.mockRestore() }
  const failed = await work
  expect(failed).toMatchObject({ status: 'failed', error: 'Checkpoint collection is no longer admitted' })
  expect(run.snapshot().latestCheckpointId).toBeUndefined()
  const attached = await ctx.simulationTeams.attach(run, teamId, 'simulation/company')
  expect(await attached.checkpoint(request)).toEqual(failed)
})

it('rejects late model and decision calls after the exact Agent registry entry is detached', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const entered = vi.spyOn(ctx.agents, 'enter')
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, placement())
  const registration = entered.mock.results[0]
  entered.mockRestore()
  if (registration?.type !== 'return' || activation.localAgent === undefined) throw new Error('fixture registration missing')
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('detached-actor')
  await connection.openDecision(entityId, id)
  await connection.prepareContext(entityId, id, contextRequest())
  const observation = ctx.simulationTeams.modelRequest(activation.localAgent, { kind: 'observe' }, new AbortController().signal)
  const decision = connection.openDecision(entityId, id)
  const rejectedObservation = expect(observation).rejects.toThrow(/no longer current/)
  const rejectedDecision = expect(decision).rejects.toThrow(/no current local Agent/)
  registration.value()
  expect(ctx.agents.get(activation.binding.sessionId)).toBeUndefined()
  await Promise.all([rejectedObservation, rejectedDecision])
})

it.each(['binding', 'activation'] as const)('refuses a checkpoint when the provider loses an active writer %s', async (missing) => {
  const { run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  const snapshot = run.snapshot.bind(run)
  const incomplete = vi.spyOn(run, 'snapshot').mockImplementation(() => {
    const state = snapshot()
    const entity = { ...state.entities[entityId]! }
    if (missing === 'binding') delete entity.binding
    else {
      const writer = { ...entity.writer! }
      delete writer.activationId
      entity.writer = writer
    }
    return { ...state, entities: { ...state.entities, [entityId]: entity } }
  })
  try {
    await expect(connection.collectCheckpointCandidate(4, 2)).rejects.toThrow(missing === 'binding'
      ? 'Checkpoint writer has no canonical binding' : 'Checkpoint actor has no recorded activation')
    expect(run.population().chargedActors).toBe(1)
  } finally { incomplete.mockRestore() }
  const candidate = await connection.collectCheckpointCandidate(4, 2)
  try { await candidate.validate(); expect(run.population().chargedActors).toBe(0) }
  finally { candidate.release() }
})

it('keeps ordinary one-shot inference outside Simulation model accounting', async () => {
  const { ctx, run } = await setup()
  const model = new MockAdapter([textResponse('Ordinary response')])
  ctx.llm.registerAdapter(['ordinary-one-shot'], model)
  for await (const _chunk of ctx.llm.stream({ provider: 'ordinary-one-shot', model: 'fixture', messages: [] })) {
    // This independent call has no Simulation Session or decision owner.
  }
  expect(model.requests).toHaveLength(1)
  expect(run.budgetUsage().tokens.used).toBe(0)
  expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
})

it('refuses auxiliary inference for a canonical Session without a resident writer', async () => {
  const { ctx, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const binding = await connection.bind(entityId, participant.id)
  const session = ctx.sessions.create(binding.sessionId, { meta: { teamId: binding.teamId, participantId: binding.participantId } })
  const model = new MockAdapter([textResponse('Must not run')])
  ctx.llm.registerAdapter(['dormant-auxiliary'], model)
  const consume = async () => {
    for await (const _chunk of ctx.llm.stream({ provider: 'dormant-auxiliary', model: 'fixture', sessionId: session.id,
      purpose: 'compaction', messages: [] })) { /* Consume any incorrectly admitted model stream. */ }
  }
  await expect(consume()).rejects.toThrow(/requires its current canonical actor/)
  expect(model.requests).toHaveLength(0)
})

it('coalesces concurrent receipt discovery for one operation', async () => {
  const { ctx, run, connection, operation, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const read = ctx.teams.readChannelPage.bind(ctx.teams)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.teams, 'readChannelPage').mockImplementationOnce(async (request) => {
    entered.resolve(undefined); await release.promise
    return await read(request)
  })
  const first = connection.receiveOperation(operation)
  await entered.promise
  try { expect(connection.receiveOperation(operation)).toBe(first) }
  finally { release.resolve(undefined); held.mockRestore() }
  await first
  expect(run.snapshot().operations[operation]?.delivery?.receipt).toBeDefined()
})

it('rejects a receipt request that does not name a published communication', async () => {
  const { connection } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationOperationIdSchema } = await import('@clocky/clocky-simulation')
  await expect(connection.receiveOperation(simulationOperationIdSchema.parse('missing-publication'))).rejects.toThrow(/publication|published/)
})

it('rejects another decision while an input admission is awaiting persistence', async () => {
  const { ctx, connection, entityId, id } = await inputHarness('held-input')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
    entered.resolve(undefined); await release.promise
    return await flush(session)
  })
  const first = connection.dispatchDecision(entityId, id)
  await entered.promise
  try {
    await expect(connection.dispatchDecision(entityId, simulationDecisionIdSchema.parse('competing-input')))
      .rejects.toThrow(/another input admission in flight/)
  } finally { release.resolve(undefined); await first; held.mockRestore() }
})

it('keeps residency when the initial hibernation flush fails and allows retry', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  const held = vi.spyOn(ctx.sessions, 'flush').mockResolvedValueOnce(false)
  try { await expect(connection.hibernate(entityId)).rejects.toThrow(/requires durable Session storage/) }
  finally { held.mockRestore() }
  expect(run.population().chargedActors).toBe(1)
  expect(run.snapshot().entities[entityId]?.writer?.phase).toBe('active')
  await connection.hibernate(entityId)
  expect(run.population().chargedActors).toBe(0)
})

it('requires the reserved participant identity even when another active participant is available', async () => {
  const { ctx, run, entityId } = await setup(false)
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Reserved binding', budgets: {} }, budgets: {} }, 'simulation/reserved')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/reserved')
  const participant = await inviteBootstrapParticipant(ctx, { teamId: team.team.id, expectedCursor: team.team.cursor,
    kind: 'local-agent', displayName: 'Alternative', role: 'buyer', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    const current = await ctx.teams.getTeam({ teamId: team.team.id })
    await transitionBootstrapParticipant(ctx, { teamId: team.team.id, participantId: participant.id,
      expectedCursor: current.team.cursor, phase })
  }
  await run.reserveParticipant(entityId, { displayName: 'Reserved', role: 'buyer', capabilities: [],
    provider: 'in-process', preset: 'simulation', model: 'fixture' }, run.snapshot().revision)
  const before = run.snapshot()
  await expect(connection.bind(entityId, participant.id)).rejects.toThrow(/differs from its reserved identity/)
  expect(run.snapshot()).toEqual(before)
})

it('refuses context preparation without its named decision', async () => {
  const { connection, entityId } = await inputHarness('existing-context')
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await expect(connection.prepareContext(entityId, simulationDecisionIdSchema.parse('missing-context'), contextRequest()))
    .rejects.toThrow(/no canonical actor decision/)
})

it.each(['missing-agent', 'foreign-activation'] as const)('preserves an established writer after rejecting bind retry %s', async (failure) => {
  const { ctx, run, teamId, entityId, participant } = await setup(false)
  const registered = vi.spyOn(ctx.teamActivations, 'registerLifecycleOwner')
  const connection = await ctx.simulationTeams.attach(run, teamId, 'simulation/company')
  const owner = registered.mock.calls[0]?.[0]
  if (owner === undefined) throw new Error('fixture owner missing')
  const reserved = vi.spyOn(owner, 'reserve')
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, placement())
  const result = reserved.mock.results[0]
  if (result?.type !== 'return') throw new Error('fixture receipt missing')
  const receipt = await result.value
  if (receipt === undefined) throw new Error('fixture coordination missing')
  if (failure === 'missing-agent') {
    await expect(receipt.bind(activation.binding, undefined)).rejects.toThrow(/exact controller-owned local Agent/)
  } else {
    const { activationIdSchema } = await import('@clocky/clocky-team')
    await expect(receipt.bind({ ...activation.binding, activation: { ...activation.binding.activation,
      id: activationIdSchema.parse('foreign-activation') } }, activation.localAgent)).rejects.toThrow(/activation/)
  }
  await run.setPhase('running', run.snapshot().revision)
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  const id = simulationDecisionIdSchema.parse('after-rejected-bind')
  expect((await connection.openDecision(entityId, id)).status).toBe('open')
  expect(run.snapshot().entities[entityId]?.writer?.activationId).toBe(activation.binding.activation.id)
})

it('closes an interrupted decision window before returning a checkpoint candidate', async () => {
  const { run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationWindowIdSchema } = await import('@clocky/clocky-simulation')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('checkpoint-cancelled-slot')
  const windowId = simulationWindowIdSchema.parse('checkpoint-window')
  await connection.openWindow({ id: windowId, decisions: [{ id, entityId, context: contextRequest() }] })
  const candidate = await connection.collectCheckpointCandidate(4, 2)
  try {
    await candidate.validate()
    expect(candidate.snapshot.activeWindowId).toBeUndefined()
    expect(candidate.snapshot.windows?.[windowId]?.status).toBe('closed')
    expect(candidate.snapshot.decisions[id]?.status).toBe('cancelled')
  } finally { candidate.release() }
})

it('does not report hibernation when the controller has not released its writer', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  const unconfirmed = vi.spyOn(ctx.teamActivations, 'stopOwnedActivation').mockResolvedValueOnce()
  try { await expect(connection.hibernate(entityId)).rejects.toThrow(/no confirmed writer release/) }
  finally { unconfirmed.mockRestore() }
  expect(run.population().chargedActors).toBe(1)
  await connection.hibernate(entityId)
  expect(run.population().chargedActors).toBe(0)
})

it('refuses a checkpoint when recovery returns without releasing the missing actor writer', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const entered = vi.spyOn(ctx.agents, 'enter')
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, placement())
  const registration = entered.mock.results[0]
  entered.mockRestore()
  if (registration?.type !== 'return') throw new Error('fixture registration missing')
  registration.value()
  const unconfirmed = vi.spyOn(ctx.teamActivations, 'recoverCoordinatedLocal').mockResolvedValueOnce()
  try { await expect(connection.collectCheckpointCandidate(4, 2)).rejects.toThrow(/recovery has not confirmed release/) }
  finally { unconfirmed.mockRestore(); await activation.dispose() }
  expect(run.population().chargedActors).toBe(0)
  const candidate = await connection.collectCheckpointCandidate(4, 2)
  try { await candidate.validate() }
  finally { candidate.release() }
})

it('waits for admitted consumed-input persistence before hibernating a settled actor', async () => {
  const { ctx, run, connection, entityId, id, agent } = await inputHarness('hibernate-consumed')
  await connection.dispatchDecision(entityId, id)
  await agent.whenIdle()
  await connection.submitDecision(entityId, id, [])
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const held = vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
    entered.resolve(undefined); await release.promise
    return await flush(session)
  })
  const input = connection.dispatchDecision(entityId, id)
  await entered.promise
  let stopped = false
  const sleeping = connection.hibernate(entityId).then(() => { stopped = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(stopped).toBe(false)
    expect(run.population().chargedActors).toBe(1)
  } finally { release.resolve(undefined); await input; await sleeping; held.mockRestore() }
  expect(run.population().chargedActors).toBe(0)
})

it('closes a retained hibernation failure after Session persistence recovers', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const fault = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async session => run.snapshot().entities[entityId]?.writer?.phase === 'revoked'
    ? false : await flush(session))
  try { await expect(connection.hibernate(entityId)).rejects.toThrow(/durable Session/) }
  finally { fault.mockRestore() }
  await connection.close()
  expect(run.population().chargedActors).toBe(0)
})

it('refuses hibernation after a provider loses the canonical binding during persistence', async () => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  const inspect = run.inspectEntity.bind(run), flush = ctx.sessions.flush.bind(ctx.sessions)
  let lost = false
  const observation = vi.spyOn(run, 'inspectEntity').mockImplementation((id) => {
    const result = inspect(id)
    if (!lost || id !== entityId || result.entity === undefined) return result
    const entity = { ...result.entity }
    delete entity.binding
    return { ...result, entity }
  })
  const stored = vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
    const result = await flush(session); lost = true; return result
  })
  try { await expect(connection.hibernate(entityId)).rejects.toThrow(/lost its canonical binding/) }
  finally { observation.mockRestore(); stored.mockRestore() }
  expect(run.population().chargedActors).toBe(1)
  await connection.hibernate(entityId)
  expect(run.population().chargedActors).toBe(0)
})

it.each(['belief', 'report'] as const)('preserves frozen %s knowledge on repeated context preparation', async (kind) => {
  const { run, connection, receiverId, operation, simTimeSchema } = await preparedPost()
  const { simulationKnowledgeRequestSchema, simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
  const action = run.snapshot().operations[operation]!.action
  if (action.kind !== 'communication/post') throw new Error('fixture communication missing')
  const item = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'retry-knowledge', owner: receiverId,
    expectedRevision: 0, statement: action.text, readers: [], observedAt: '5', availableAt: '5', validFrom: '5', validUntil: null,
    source: kind === 'report' ? { kind: 'report', operationId: operation } : { kind: 'belief', profileRevision: 1, policyVersion: '1' } }))
  const id = simulationDecisionIdSchema.parse('retry-context')
  await connection.openDecision(receiverId, id, run.snapshot().operations[operation]!.delivery!.wakeId)
  const context = { ...contextRequest(), knowledge: { ids: [item.id], required: true } }
  const first = await connection.prepareContext(receiverId, id, context)
  expect(await connection.prepareContext(receiverId, id, context)).toEqual(first)
})

it.each(['model', 'deterministic', 'auxiliary'] as const)('rejects a %s completion when its registry owner disappears during flush', async (kind) => {
  const { ctx, run, connection, entityId, participant } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const { simulationDecisionIdSchema, simulationPolicyRefSchema } = await import('@clocky/clocky-simulation')
  const model = new MockAdapter([textResponse('Prepared response')])
  ctx.llm.registerAdapter(['detached-completion'], model)
  const entered = vi.spyOn(ctx.agents, 'enter')
  await connection.bind(entityId, participant.id)
  const activation = await connection.activate(entityId, { ...placement(), agent: { options: { provider: 'detached-completion', model: 'fixture' } } })
  const registration = entered.mock.results[0]
  entered.mockRestore()
  if (registration?.type !== 'return' || activation.localAgent === undefined) throw new Error('fixture actor missing')
  const actor = activation.localAgent
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('detached-completion')
  if (kind === 'model') {
    await connection.openDecision(entityId, id)
    await connection.prepareContext(entityId, id, contextRequest())
    await connection.dispatchDecision(entityId, id)
    await actor.whenIdle()
    await connection.submitDecision(entityId, id, [])
  }
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  let calls = 0
  const detached = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
    const result = await flush(session)
    if (++calls === (kind === 'model' ? 2 : 1)) registration.value()
    return result
  })
  try {
    if (kind === 'model') {
      await expect(connection.executeDecision(entityId, id, contextRequest())).rejects.toThrow(/decision actor is no longer current/)
    } else if (kind === 'deterministic') {
      const policy = simulationPolicyRefSchema.parse({ id: 'detached-policy', version: '1' })
      ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: () => [] })
      await expect(connection.executeDeterministicDecision(entityId, id, contextRequest(), policy))
        .rejects.toThrow(/deterministic actor is no longer current/)
    } else {
      const { CompactionId, recordCompactionRequest } = await import('@clocky/clocky-compaction')
      actor.session.append('compaction/start', { compactionId: CompactionId('detached-auxiliary'), turn: null })
      const options = recordCompactionRequest(actor.session, { sessionId: actor.id, purpose: 'compaction',
        provider: 'detached-completion', model: 'fixture', messages: [] })
      const consume = async () => {
        for await (const _chunk of ctx.llm.stream(options)) { /* Drain an incorrectly admitted stream. */ }
      }
      await expect(consume()).rejects.toThrow(/compaction actor retired/)
    }
    expect(model.requests).toHaveLength(kind === 'model' ? 1 : 0)
  } finally { detached.mockRestore() }
})

it('releases coordination after the writer is directly revoked and its runtime is proven stopped', async () => {
  const { ctx, run, teamId, entityId, participant } = await setup(false)
  const registered = vi.spyOn(ctx.teamActivations, 'registerLifecycleOwner')
  const connection = await ctx.simulationTeams.attach(run, teamId, 'simulation/company')
  const owner = registered.mock.calls[0]?.[0]
  if (owner === undefined) throw new Error('fixture owner missing')
  const reserved = vi.spyOn(owner, 'reserve')
  const writers = vi.spyOn(run, 'reserveWriter')
  const agents = vi.spyOn(ctx.agents, 'create')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  const ownerResult = reserved.mock.results[0], writerResult = writers.mock.results[0], agentResult = agents.mock.results[0]
  if (ownerResult?.type !== 'return' || writerResult?.type !== 'return' || agentResult?.type !== 'return') {
    throw new Error('fixture ownership missing')
  }
  const receipt = await ownerResult.value, writer = await writerResult.value, actor = await agentResult.value
  if (receipt === undefined) throw new Error('fixture coordination missing')
  await writer.revoke()
  await actor.dispose()
  await receipt.release()
  expect(run.population().chargedActors).toBe(0)
  expect(ctx.agents.get(actor.agent.id)).toBeUndefined()
  const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
  await expect(connection.openDecision(entityId, simulationDecisionIdSchema.parse('after-release'))).rejects.toThrow(/no live decision authority/)
})

it('admits an exact current-turn request when its caller omits the optional signal', async () => {
  const { ctx, run, connection, entityId, id, agent, adapter } = await inputHarness('signal-optional')
  let forwarded = false
  const remove = ctx.on('llm/stream', (request, next) => {
    if (forwarded) return next()
    forwarded = true
    const { signal: _signal, ...withoutSignal } = request
    return ctx.llm.stream(withoutSignal)
  }, { prepend: true })
  try {
    await connection.dispatchDecision(entityId, id)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(Object.values(run.snapshot().tokenReservations ?? {})).toHaveLength(1)
    expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
  } finally { remove() }
})

it.each(['missing-entity', 'missing-binding', 'busy'] as const)('defers delivery for recipient observation %s', async (kind) => {
  const { ctx, run, connection, receiverId, receiver, operation, simTimeSchema } = await preparedPost()
  await run.drive({ until: simTimeSchema.parse('5') })
  await connection.dispatchOperation(operation, () => 100)
  const inspect = run.inspectEntity.bind(run)
  const changed = kind === 'busy' ? vi.spyOn(receiver.localAgent!, 'status', 'get').mockReturnValue('running')
    : vi.spyOn(run, 'inspectEntity').mockImplementation((id) => {
      const result = inspect(id)
      if (id !== receiverId) return result
      if (kind === 'missing-entity') return { runId: result.runId, revision: result.revision }
      const entity = { ...result.entity! }
      delete entity.binding
      return { ...result, entity }
    })
  const claim = vi.spyOn(ctx.teams, 'claimChannelDelivery')
  try {
    expect(await connection.drive({ until: simTimeSchema.parse('5') }, () => 100))
      .toMatchObject({ reason: kind === 'busy' ? 'recipient-busy' : 'recipient-required', entityId: receiverId })
    expect(claim).not.toHaveBeenCalled()
  } finally { changed.mockRestore(); claim.mockRestore() }
  expect(await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)).toMatchObject({ reason: 'decision-required' })
})

it('skips an unbound eviction candidate before hibernating an eligible resident', async () => {
  const { ctx, run, connection, entityId, participant, teamId } = await setup(true, 65536, 16, 60000, 1000000, 1)
  if (connection === undefined) throw new Error('fixture connection missing')
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, placement())
  const unbound = simulationEntityIdSchema.parse('unbound-victim'), target = simulationEntityIdSchema.parse('next-resident')
  for (const id of [unbound, target]) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id,
    entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
  const team = await ctx.teams.getTeam({ teamId })
  const member = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: team.team.cursor,
    kind: 'local-agent', displayName: 'Next', role: 'next', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    const current = await ctx.teams.getTeam({ teamId })
    await transitionBootstrapParticipant(ctx, { teamId, participantId: member.id, expectedCursor: current.team.cursor, phase })
  }
  await connection.bind(target, member.id)
  expect((await connection.ensureResident(target, { activation: placement(), evict: [unbound, entityId] })).status).toBe('resident')
  expect(run.population().chargedActors).toBe(1)
  expect(run.inspectEntity(unbound).entity?.writer).toBeUndefined()
  expect(run.inspectEntity(entityId).entity?.writer?.phase).toBe('released')
})

it('rejects adding a knowledge selection after a decision context is frozen', async () => {
  const { run, connection, entityId, id } = await inputHarness('frozen-without-knowledge')
  const { simulationKnowledgeIdSchema } = await import('@clocky/clocky-simulation')
  const before = run.snapshot()
  await expect(connection.prepareContext(entityId, id, { ...contextRequest(), knowledge: {
    ids: [simulationKnowledgeIdSchema.parse('new-selection')], required: true,
  } })).rejects.toThrow(/changed|knowledge|context/)
  expect(run.snapshot()).toEqual(before)
})

it('refuses context preparation when the provider loses the actor binding', async () => {
  const { run, connection, entityId, id } = await inputHarness('missing-context-binding')
  const inspect = run.inspectEntity.bind(run)
  const missing = vi.spyOn(run, 'inspectEntity').mockImplementation((entity) => {
    const result = inspect(entity)
    if (entity !== entityId || result.entity === undefined) return result
    const current = { ...result.entity }
    delete current.binding
    return { ...result, entity: current }
  })
  try { await expect(connection.prepareContext(entityId, id, contextRequest())).rejects.toThrow(/no canonical actor decision/) }
  finally { missing.mockRestore() }
  expect((await connection.prepareContext(entityId, id, contextRequest())).status).toBe('prepared')
})

it('retains a replacement checkpoint wait when an earlier collection rejects', async () => {
  const { ctx, connection } = await setup()
  if (connection === undefined) throw new Error('fixture connection missing')
  const firstRead = Promise.withResolvers<never>(), firstEntered = Promise.withResolvers<undefined>()
  const secondEntered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const read = ctx.teams.getTeam.bind(ctx.teams)
  let calls = 0
  const held = vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
    if (++calls === 1) { firstEntered.resolve(undefined); return await firstRead.promise }
    if (calls === 2) { secondEntered.resolve(undefined); await release.promise }
    return await read(request)
  })
  const first = connection.collectCheckpointCandidate(4, 2)
  const refused = expect(first).rejects.toThrow('Collection source unavailable')
  await firstEntered.promise
  let retry: Promise<unknown> | undefined
  const started = Promise.withResolvers<undefined>()
  let attempts = 0
  const retryCollection = (): void => {
    try {
      retry = connection.collectCheckpointCandidate(4, 2).catch((error: unknown) => error)
      started.resolve(undefined)
    } catch (error: unknown) {
      if (++attempts >= 100) { started.reject(error); return }
      queueMicrotask(retryCollection)
    }
  }
  queueMicrotask(retryCollection)
  firstRead.reject(new Error('Collection source unavailable'))
  await started.promise
  await secondEntered.promise
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
  } finally {
    release.resolve(undefined)
    await refused
    await closing
    held.mockRestore()
  }
  expect(await retry).toMatchObject({ message: 'Checkpoint collection is no longer admitted' })
})
