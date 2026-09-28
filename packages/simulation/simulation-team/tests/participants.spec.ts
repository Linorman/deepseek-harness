import { afterEach, describe, expect, it, vi } from 'vitest'
import { rm } from 'node:fs/promises'
import { simulationChangeSchema, simulationEntityIdSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { simulationTemp } from '../../simulation-local/tests/temp.ts'
import { createContext } from './harness.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const participant = { displayName: 'Buyer', role: 'buyer', capabilities: [], provider: 'in-process', preset: 'simulation', model: 'mock/default' }
const entityId = simulationEntityIdSchema.parse('buyer')
async function setup(backend: 'json' | 'sqlite') {
  const root = await simulationTemp('participants')
  const { ctx } = await createContext(root, backend)
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'company', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
    outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
    phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceQuantity: '10000', relationRules: [],
  } })
  const run = await ctx.simulations.open(selection)
  cleanups.push(async () => { await run.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Company', budgets: {} }, budgets: {} }, 'simulation/company')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entityId, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/company')
  return { ctx, run, connection, teamId: team.team.id, selection }
}

describe.each(['json', 'sqlite'] as const)('%s participant provisioning', (backend) => {
  it('checkpoints a reserved Session without creating it and replays its absence', async () => {
    const { ctx, run, connection, selection, teamId } = await setup(backend)
    const binding = await connection.ensureParticipant(entityId, participant)
    const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
    const request = simulationCheckpointRequestSchema.parse({ id: 'before-first-activation', implementationVersion: 'fixture-1',
      maxDrainRounds: 4, maxAttempts: 3 })
    const result = await connection.checkpoint(request)
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('Checkpoint failed')
    expect(result.manifest.sessions).toEqual([{ kind: 'unmaterialized', ...binding }])
    expect(await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)).toBe(true)
    await run.close()
    const restored = await ctx.simulations.open({ ...selection, mode: 'open' })
    cleanups.push(() => restored.close())
    const resumed = await ctx.simulationTeams.attach(restored, teamId, 'simulation/company')
    expect(await resumed.checkpoint(request)).toEqual(result)
    expect(await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)).toBe(true)
  })

  it('restores an unmaterialized checkpoint with its retained run suffix and closes the exclusive owner on rejection', async () => {
    const { ctx, run, connection, selection } = await setup(backend)
    const binding = await connection.ensureParticipant(entityId, participant)
    const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
    const command = simulationCheckpointRequestSchema.parse({ id: 'restore-absent', implementationVersion: 'fixture-1',
      maxDrainRounds: 4, maxAttempts: 3 })
    const result = await connection.checkpoint(command)
    expect(result.status).toBe('completed')
    const newer = simulationCheckpointRequestSchema.parse({ ...command, id: 'newer-cut' })
    expect((await connection.checkpoint(newer)).status).toBe('completed')
    await run.setPhase('running', run.snapshot().revision)
    const suffixRevision = run.snapshot().revision
    await run.close()
    const request = { id: command.id, implementationVersion: command.implementationVersion, maxAttempts: 3 }
    await expect(ctx.simulationTeams.restore({ ...selection, mode: 'open' }, { ...request, implementationVersion: 'wrong' }))
      .rejects.toThrow(/implementation version/)
    const restored = await ctx.simulationTeams.restore({ ...selection, mode: 'open' }, request)
    cleanups.push(() => restored.run.close())
    expect(restored.run.snapshot().phase).toBe('paused')
    expect(restored.run.snapshot().revision).toBe(suffixRevision + 1)
    expect(restored.manifest.id).toBe(command.id)
    expect(restored.run.snapshot().latestCheckpointId).toBe(newer.id)
    expect(restored.run.snapshot().entities[entityId]?.binding).toEqual(binding)
    expect(await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)).toBe(true)
    await restored.run.close()
    const retried = await ctx.simulationTeams.restore({ ...selection, mode: 'open' }, request)
    cleanups.push(() => retried.run.close())
    expect(retried.run.snapshot()).toEqual(restored.run.snapshot())
  })

  it('invalidates a candidate when a reserved Session acquires a stored header', async () => {
    const { ctx, connection } = await setup(backend)
    const binding = await connection.ensureParticipant(entityId, participant)
    const candidate = await connection.collectCheckpointCandidate(4, 3)
    try {
      const session = ctx.sessions.create(binding.sessionId, { meta: { teamId: binding.teamId, participantId: binding.participantId } })
      await ctx.sessionPersistence.materializeHeader(session)
      await expect(candidate.validate()).rejects.toThrow(/Session materialized/)
    } finally { candidate.release() }
    const current = await connection.collectCheckpointCandidate(4, 3)
    try { expect(current.sessions[0]?.kind).toBe('materialized') }
    finally { current.release() }
  })

  it.each(['reservation', 'invitation', 'provisioning', 'active', 'binding'] as const)('reconciles a lost %s response with permanent identities', async (stage) => {
    const { ctx, run, connection, teamId, selection } = await setup(backend)
    if (stage === 'reservation') {
      const original = run.reserveParticipant.bind(run)
      vi.spyOn(run, 'reserveParticipant').mockImplementationOnce(async (...args) => { await original(...args); throw new Error('lost response') })
    } else if (stage === 'invitation') {
      const original = ctx.teams.inviteParticipant.bind(ctx.teams)
      vi.spyOn(ctx.teams, 'inviteParticipant').mockImplementationOnce(async (request) => { await original(request); throw new Error('lost response') })
    } else if (stage === 'binding') {
      const original = run.bindEntity.bind(run)
      vi.spyOn(run, 'bindEntity').mockImplementationOnce(async (...args) => { await original(...args); throw new Error('lost response') })
    } else {
      const original = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
      vi.spyOn(ctx.teams, 'transitionParticipantPhase').mockImplementation(async (request) => {
        const result = await original(request)
        if (request.phase === stage) throw new Error('lost response')
        return result
      })
    }
    await expect(connection.ensureParticipant(entityId, participant)).rejects.toThrow('lost response')
    const reserved = run.snapshot().entities[entityId]?.participantReservation
    expect(reserved).toBeDefined()
    vi.restoreAllMocks()
    await run.close()
    const reopened = await ctx.simulations.open({ ...selection, mode: 'open' })
    cleanups.push(() => reopened.close())
    const resumed = await ctx.simulationTeams.attach(reopened, teamId, 'simulation/company')
    expect(await resumed.ensureParticipant(entityId, participant)).toEqual(reserved?.binding)
    expect(await resumed.ensureParticipant(entityId, participant)).toEqual(reserved?.binding)
    const state = await ctx.teams.getTeam({ teamId })
    expect(state.participants).toHaveLength(1)
    expect(state.participants[0]).toMatchObject({ phase: 'active', preset: 'simulation', provider: 'in-process' })
    expect(state.activations).toEqual([])
    await expect(resumed.ensureParticipant(entityId, { ...participant, model: 'changed' })).rejects.toThrow(/changed its payload/)
  })

  it('serializes concurrent members and rejects substituted target payloads', async () => {
    const { ctx, run, connection, teamId } = await setup(backend)
    const other = simulationEntityIdSchema.parse('supplier')
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: other, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    const original = ctx.teams.inviteParticipant.bind(ctx.teams)
    vi.spyOn(ctx.teams, 'inviteParticipant').mockImplementationOnce(async (request) => {
      await expect(original({ ...request, role: 'intruder' })).rejects.toThrow(/invalid/)
      return await original(request)
    })
    const bindings = await Promise.all([connection.ensureParticipant(entityId, participant),
      connection.ensureParticipant(other, { ...participant, displayName: 'Supplier', role: 'supplier' })])
    expect(bindings[0]?.participantId).not.toBe(bindings[1]?.participantId)
    expect(bindings[0]?.sessionId).not.toBe(bindings[1]?.sessionId)
    expect((await ctx.teams.getTeam({ teamId })).participants).toHaveLength(2)
  })

  it('revokes target authority after a policy wait and rejects later work on a closed connection', async () => {
    const { ctx, run, connection, teamId } = await setup(backend)
    ctx.teams.registerPolicy('invite', { name: 'retire-entity', async apply(_request, next) {
      const entity = run.snapshot().entities[entityId]!
      await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: entityId, entityRevision: entity.revision, phase: 'inactive' }), run.snapshot().revision)
      return await next()
    } })
    await expect(connection.ensureParticipant(entityId, participant)).rejects.toThrow(/failed to resolve/)
    expect((await ctx.teams.getTeam({ teamId })).participants).toEqual([])
    await connection.close()
    expect(() => connection.ensureParticipant(entityId, participant)).toThrow(/closed/)
  })

  it('holds shutdown until accepted invitation IO settles', async () => {
    const { ctx, connection, teamId } = await setup(backend)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    ctx.teams.registerPolicy('invite', { name: 'hold-invitation', async apply(_request, next) {
      entered.resolve(undefined)
      await release.promise
      return await next()
    } })
    const work = connection.ensureParticipant(entityId, participant)
    const rejection = expect(work).rejects.toThrow(/failed to resolve/)
    await entered.promise
    let closed = false
    const shutdown = connection.close().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    release.resolve(undefined)
    await rejection
    await shutdown
    expect((await ctx.teams.getTeam({ teamId })).participants).toEqual([])
  })

  it('rejects untrusted actor identity, running-run provisioning and substitution of a reserved binding', async () => {
    const { run, connection } = await setup(backend)
    expect(() => connection.ensureParticipant(entityId, { ...participant, participantId: 'forged' } as never)).toThrow()
    await run.setPhase('running', run.snapshot().revision)
    await expect(connection.ensureParticipant(entityId, participant)).rejects.toThrow(/not admissible/)
    expect(run.snapshot().entities[entityId]?.participantReservation).toBeUndefined()
    await run.setPhase('paused', run.snapshot().revision)
    await run.reserveParticipant(entityId, participant, run.snapshot().revision)
    await expect(run.setPhase('running', run.snapshot().revision)).rejects.toThrow(/provisioning must finish/)
    const reserved = run.snapshot().entities[entityId]!.participantReservation!
    await expect(run.bindEntity(entityId, { ...reserved.binding, participantId: 'other' as never }, run.snapshot().revision))
      .rejects.toThrow(/reserved participant/)
    expect(run.snapshot().entities[entityId]?.binding).toBeUndefined()
    expect(await connection.ensureParticipant(entityId, participant)).toEqual(reserved.binding)
  })
})

it.each(['invitation', 'provisioning', 'active'] as const)('rejects another participant returned from %s before binding the reserved identity', async (stage) => {
  const { ctx, run, connection, teamId } = await setup('sqlite')
  const other = simulationEntityIdSchema.parse('supplier')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: other, entityKind: 'person', cognition: 'agent', profile: {} }),
    run.snapshot().revision)
  const otherBinding = await connection.ensureParticipant(other, { ...participant, displayName: 'Supplier', role: 'supplier' })
  const foreign = (await ctx.teams.getTeam({ teamId })).participants.find(value => value.id === otherBinding.participantId)!
  const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
  const transition = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
  const fault = stage === 'invitation'
    ? vi.spyOn(ctx.teams, 'inviteParticipant').mockImplementationOnce(async (request) => { await invite(request); return foreign })
    : vi.spyOn(ctx.teams, 'transitionParticipantPhase').mockImplementation(async (request) => {
      const result = await transition(request)
      return request.phase === stage ? foreign : result
    })
  try {
    await expect(connection.ensureParticipant(entityId, participant)).rejects.toThrow(/participant target returned another identity/)
    expect(run.snapshot().entities[entityId]!.binding).toBeUndefined()
  } finally { fault.mockRestore() }
  const binding = await connection.ensureParticipant(entityId, participant)
  expect(binding.participantId).not.toBe(otherBinding.participantId)
  expect((await ctx.teams.getTeam({ teamId })).participants.find(value => value.id === binding.participantId)?.phase).toBe('active')
})

it('requires the reserved participant and refuses terminal target membership', async () => {
  const { ctx, run, connection } = await setup('sqlite')
  const reserve = run.reserveParticipant.bind(run)
  const missing = vi.spyOn(run, 'reserveParticipant').mockImplementationOnce(async (...args) => {
    const result = await reserve(...args)
    const observed = run.inspectEntity(entityId)
    vi.spyOn(run, 'inspectEntity').mockReturnValueOnce({ runId: observed.runId, revision: observed.revision })
    return result
  })
  await expect(connection.ensureParticipant(entityId, participant)).rejects.toThrow(/no canonical reservation/)
  missing.mockRestore(); vi.restoreAllMocks()
  const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
  const terminal = vi.spyOn(ctx.teams, 'inviteParticipant').mockImplementationOnce(async (request) => {
    expect(() => JSON.stringify(request.actor)).toThrow(/runtime-only/)
    return { ...await invite(request), phase: 'failed' as const }
  })
  try { await expect(connection.ensureParticipant(entityId, participant)).rejects.toThrow(/cannot resume provisioning/) }
  finally { terminal.mockRestore() }
  expect(run.snapshot().entities[entityId]!.binding).toBeUndefined()
  await connection.ensureParticipant(entityId, participant)
})
