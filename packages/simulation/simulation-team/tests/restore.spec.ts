/** Cross-owner recovery refusal and moving-source tests using real persisted owners. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile, rm, rename } from 'node:fs/promises'
import { simulationChangeSchema, simulationEntityIdSchema, simulationRunSelectionSchema, simulationCheckpointRequestSchema,
  simulationChannelSpecSchema } from '@clocky/clocky-simulation'
import { SessionId } from '@clocky/clocky-session'
import { closeTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { TeamError, teamIdSchema, teamTaskIdSchema } from '@clocky/clocky-team'
import { task } from '../../../team/team-hub/tests/fixtures.ts'
import { createUserMessage } from '@clocky/clocky-llm'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { simulationTemp } from '../../simulation-local/tests/temp.ts'
import { createContext } from './harness.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup(backend: 'json' | 'sqlite', materialized = true) {
  const root = await simulationTemp('restore-audit')
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const original = await createContext(root, backend)
  const ctx = original.ctx
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Direct)
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'company', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
    outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
    phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceQuantity: '10000', relationRules: [],
  } })
  const run = await ctx.simulations.open(selection)
  cleanups.push(() => run.close())
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Validate retained owners', budgets: {} }, budgets: {} }, 'simulation/company')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/company')
  const ids = ['first', 'second'].map(value => simulationEntityIdSchema.parse(value))
  const bindings = []
  const sessions = []
  for (const id of ids) {
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    const binding = await connection.ensureParticipant(id, { displayName: id, role: id, capabilities: [], provider: 'in-process', preset: 'simulation', model: 'unused' })
    bindings.push(binding)
    if (materialized) {
      const session = ctx.sessions.create(binding.sessionId, { meta: { teamId: binding.teamId, participantId: binding.participantId } })
      await ctx.sessionPersistence.materializeHeader(session)
      session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Retained input' }] }), { surfaceOp: 'append' })
      await ctx.sessions.flush(session)
      sessions.push(session)
    }
  }
  const channel = await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'peer',
    members: ids.map((entityId, index) => ({ entityId, role: String(index) })), limits: {} }))
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'warehouse', entityKind: 'org', cognition: 'none', profile: {} }), run.snapshot().revision)
  const command = simulationCheckpointRequestSchema.parse({ id: 'cut', implementationVersion: 'audit-1', maxDrainRounds: 4, maxAttempts: 3 })
  const checkpoint = await connection.checkpoint(command)
  if (checkpoint.status !== 'completed') throw new Error('Fixture checkpoint failed')
  await run.close()
  const request = { id: command.id, implementationVersion: command.implementationVersion, maxAttempts: 3 }
  const reopen = async () => {
    await ctx.fiber.dispose()
    const next = await createContext(root, backend)
    await next.ctx.plugin(Direct)
    cleanups.push(() => next.ctx.fiber.dispose())
    return next.ctx
  }
  return { root, ctx, run, selection: { ...selection, mode: 'open' as const }, request, bindings, sessions, channel, manifest: checkpoint.manifest, reopen }
}

describe.each(['json', 'sqlite'] as const)('%s checkpoint owner audit', (backend) => {
  it.each(['response-lost', 'unchanged-tail', 'moving-tail'] as const)
  ('bounds checkpoint pause retries after %s', async (failure) => {
    const h = await setup(backend)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    await restored.run.setPhase('running', restored.run.snapshot().revision)
    const phase = restored.run.setPhase.bind(restored.run)
    let attempts = 0
    const fault = vi.spyOn(restored.run, 'setPhase').mockImplementation(async (next, revision) => {
      attempts += 1
      if (failure === 'unchanged-tail') throw new Error('Pause storage unavailable')
      const result = await phase(next, revision)
      if (failure === 'response-lost' && attempts > 1) return result
      if (failure === 'moving-tail') await phase('running', restored.run.snapshot().revision)
      throw new Error('Pause response unavailable')
    })
    const request = simulationCheckpointRequestSchema.parse({ id: 'pause-race', implementationVersion: 'audit-1',
      maxDrainRounds: 4, maxAttempts: 3 })
    try {
      const collection = restored.connection.collectCheckpointCandidate(request.maxDrainRounds, request.maxAttempts)
      if (failure === 'response-lost') (await collection).release()
      else await expect(collection).rejects.toThrow(failure === 'unchanged-tail' ? 'Pause storage unavailable' : 'Pause response unavailable')
      expect(attempts).toBe(failure === 'response-lost' ? 2 : failure === 'unchanged-tail' ? 1 : 3)
    } finally { fault.mockRestore() }
    expect((await restored.connection.checkpoint(request)).status).toBe('completed')
  })

  it('preserves both validation and cleanup failures when rejecting checkpoint restoration', async () => {
    const h = await setup(backend)
    const open = h.ctx.simulations.open.bind(h.ctx.simulations)
    const cleanupFailure = new Error('Run release unavailable')
    let restoreClose: (() => void) | undefined
    const intercepted = vi.spyOn(h.ctx.simulations, 'open').mockImplementationOnce(async (selection) => {
      const run = await open(selection)
      cleanups.push(() => run.close())
      const close = vi.spyOn(run, 'close').mockRejectedValueOnce(cleanupFailure)
      restoreClose = () => { close.mockRestore() }
      return run
    })
    try {
      await expect(h.ctx.simulationTeams.restore(h.selection, { ...h.request, implementationVersion: 'foreign' }))
        .rejects.toMatchObject({ message: 'Checkpoint recovery cleanup failed', errors: [
          expect.objectContaining({ message: 'Checkpoint implementation version differs' }), cleanupFailure,
        ] })
    } finally { intercepted.mockRestore(); restoreClose?.() }
  })

  it.each(['missing-channel', 'missing-owner', 'empty-owner', 'foreign-owner'] as const)
  ('refuses to publish a checkpoint with %s in the collected Team', async (kind) => {
    const h = await setup(backend)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
    const changed = vi.spyOn(h.ctx.teams, 'getTeam').mockImplementation(async (...args) => {
      const current = await getTeam(...args)
      if (kind === 'missing-channel') return { ...current, channelIds: [] }
      const rules = { ...current.rules }
      if (kind === 'missing-owner') delete rules['activationLifecycleOwner']
      else rules['activationLifecycleOwner'] = kind === 'empty-owner' ? '' : 'simulation/foreign'
      return { ...current, rules }
    })
    const command = simulationCheckpointRequestSchema.parse({ id: 'invalid-owner', implementationVersion: 'audit-1', maxDrainRounds: 4, maxAttempts: 3 })
    const result = await restored.connection.checkpoint(command)
    expect(result).toMatchObject({ status: 'failed', error: kind === 'missing-channel'
      ? 'Checkpoint run has a confirmed channel missing from its Team' : 'Checkpoint Team has another lifecycle owner' })
    expect(restored.run.snapshot().latestCheckpointId).toBe(h.request.id)
    changed.mockRestore()
    expect((await restored.connection.checkpoint(simulationCheckpointRequestSchema.parse({ ...command, id: 'repaired-owner' }))).status).toBe('completed')
  })

  it.each(['foreign-run', 'child-team', 'child-task', 'missing-participant'] as const)
  ('refuses checkpoint collection with %s and preserves its previous manifest', async (kind) => {
    const h = await setup(backend)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
    const changed = vi.spyOn(h.ctx.teams, 'getTeam').mockImplementation(async (...args) => {
      const current = await getTeam(...args)
      switch (kind) {
        case 'foreign-run': return { ...current, rules: { ...current.rules, simulationRunId: 'another-run' } }
        case 'child-team': return { ...current, team: { ...current.team, parentTeamId: teamIdSchema.parse('parent'),
          parentTaskId: teamTaskIdSchema.parse('parent-task'), depth: 1 } }
        case 'child-task': return { ...current, tasks: [task({ teamId: current.team.id, maxAttempts: 1,
          delegation: { id: 'delegation', phase: 'requested', requestedAt: 1, updatedAt: 1 }, execution: { kind: 'child-team',
            templateId: 'child', templateVersion: 1, authorityGrant: current.team.authorityGrant, budget: {} } })] }
        case 'missing-participant': return { ...current, participants: current.participants.filter(value => value.id !== h.bindings[0]!.participantId) }
      }
    })
    const command = simulationCheckpointRequestSchema.parse({ id: 'invalid-collection', implementationVersion: 'audit-1', maxDrainRounds: 4, maxAttempts: 3 })
    const result = await restored.connection.checkpoint(command)
    expect(result).toMatchObject({ status: 'failed', error: kind === 'foreign-run' ? 'Checkpoint Team belongs to another run'
      : kind === 'missing-participant' ? 'Checkpoint entity has no canonical Team participant'
        : 'Checkpoint collection does not cover child-Team owners' })
    expect(restored.run.snapshot().latestCheckpointId).toBe(h.request.id)
    changed.mockRestore()
    expect((await restored.connection.checkpoint(simulationCheckpointRequestSchema.parse({ ...command, id: 'repaired-collection' }))).status).toBe('completed')
  })

  it.each(['team', 'channel'] as const)('refuses checkpoint collection when the %s prefix has been removed', async (kind) => {
    const h = await setup(backend)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const read = h.ctx.teams.getPersistenceReference.bind(h.ctx.teams)
    const changed = vi.spyOn(h.ctx.teams, 'getPersistenceReference').mockImplementation(async request => ({ ...await read(request),
      firstSequence: request.kind === kind ? 1 : 0 }))
    await expect(restored.connection.collectCheckpointCandidate(4, 3)).rejects.toThrow(`Checkpoint ${kind === 'team' ? 'Team' : 'channel'} history has been removed`)
    changed.mockRestore()
    const candidate = await restored.connection.collectCheckpointCandidate(4, 3)
    candidate.release()
  })

  it.each(['channel-team', 'session-team', 'session-participant'] as const)('refuses checkpoint collection with a foreign %s binding', async (kind) => {
    const h = await setup(backend)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const getChannel = h.ctx.teams.getChannel.bind(h.ctx.teams)
    const read = h.ctx.sessionPersistence.getPersistenceReference.bind(h.ctx.sessionPersistence)
    if (kind === 'channel-team') {
      vi.spyOn(h.ctx.teams, 'getChannel').mockImplementation(async (...args) => {
        const current = await getChannel(...args)
        return { ...current, manifest: { ...current.manifest, teamId: teamIdSchema.parse('foreign-team') } }
      })
    } else {
      vi.spyOn(h.ctx.sessionPersistence, 'getPersistenceReference').mockImplementation(async (...args) => {
        const current = await read(...args)
        return { ...current, header: { ...current.header, ...kind === 'session-team'
          ? { teamId: teamIdSchema.parse('foreign-team') } : { participantId: h.bindings[1]!.participantId } } }
      })
    }
    await expect(restored.connection.collectCheckpointCandidate(4, 3)).rejects.toThrow(kind === 'channel-team'
      ? 'Checkpoint channel belongs to another Team' : 'Checkpoint Session has another canonical binding')
    expect(restored.run.snapshot().latestCheckpointId).toBe(h.request.id)
  })

  it.each(['team', 'channel'] as const)('recollects %s movement but rejects a moving owner after the retry bound', async (kind) => {
    const h = await setup(backend)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const read = h.ctx.teams.getPersistenceReference.bind(h.ctx.teams)
    let reads = 0
    const changed = vi.spyOn(h.ctx.teams, 'getPersistenceReference').mockImplementation(async (request) => {
      const current = await read(request)
      if (request.kind === kind && ++reads === 2) return { ...current, projectionVersion: current.projectionVersion + 1 }
      return current
    })
    const candidate = await restored.connection.collectCheckpointCandidate(4, 2)
    try { expect(reads).toBe(4); await candidate.validate() }
    finally { candidate.release(); changed.mockRestore() }
    const moved = vi.spyOn(h.ctx.teams, 'getPersistenceReference').mockImplementation(async (request) => {
      if (request.kind === kind) throw new TeamError('Owner moved', kind === 'team' ? 'TEAM_CURSOR_CONFLICT' : 'TEAM_CHANNEL_CURSOR_CONFLICT')
      return await read(request)
    })
    await expect(restored.connection.collectCheckpointCandidate(4, 2)).rejects.toThrow('Owner moved')
    expect(moved.mock.calls.filter(([request]) => request.kind === kind)).toHaveLength(2)
  })

  it('refuses to publish a candidate without a pending checkpoint request', async () => {
    const h = await setup(backend)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const candidate = await restored.connection.collectCheckpointCandidate(4, 3)
    try {
      await expect(candidate.publish(h.request.id)).rejects.toThrow('Candidate has no pending checkpoint request')
      expect(restored.run.snapshot().latestCheckpointId).toBe(h.request.id)
    } finally { candidate.release() }
  })

  it.each(['running', 'unpublished', 'missing', 'session', 'participant'] as const)
  ('refuses checkpoint publication with %s activation evidence after retirement', async (damage) => {
    const h = await setup(backend, false)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const id = simulationEntityIdSchema.parse('first')
    await restored.connection.activate(id, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { options: {} }, signal: new AbortController().signal })
    const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
    const acquire = restored.run.acquireCheckpointCut.bind(restored.run)
    vi.spyOn(restored.run, 'acquireCheckpointCut').mockImplementationOnce(async (...args) => {
      const cut = await acquire(...args)
      vi.spyOn(h.ctx.teams, 'getTeam').mockImplementation(async (...query) => {
        const team = await getTeam(...query)
        if (damage === 'running') return { ...team, activations: team.activations.map((value) => {
          const { quiescedAt: _quiesced, ...active } = value
          return active
        }) }
        if (damage === 'unpublished') return { ...team, activations: [], participants: team.participants.map((value) => {
          if (value.activationReservation === undefined) return value
          const { releasedAt: _released, ...reservation } = value.activationReservation
          return { ...value, activationReservation: reservation }
        }) }
        return { ...team, activations: damage === 'missing' ? [] : team.activations.map(value => damage === 'session'
          ? { ...value, sessionId: h.bindings[1]!.sessionId }
          : { ...value, activation: { ...value.activation, participantId: h.bindings[1]!.participantId } }) }
      })
      return cut
    })
    const command = simulationCheckpointRequestSchema.parse({ id: 'invalid-activation', implementationVersion: 'audit-1', maxDrainRounds: 4, maxAttempts: 3 })
    expect(await restored.connection.checkpoint(command)).toMatchObject({ status: 'failed', error: damage === 'running'
      ? 'Checkpoint Team retains an activation without confirmed quiescence' : damage === 'unpublished' || damage === 'missing'
        ? 'Checkpoint Team retains an unpublished startup without confirmed release'
        : 'Checkpoint writer has no matching retained Team activation' })
    expect(restored.run.snapshot().latestCheckpointId).toBe(h.request.id)
    vi.restoreAllMocks()
    expect((await restored.connection.checkpoint(simulationCheckpointRequestSchema.parse({ ...command, id: 'repaired-activation' }))).status).toBe('completed')
  })

  it.each(['writer', 'session', 'participant'] as const)
  ('refuses to treat an absent Session as unmaterialized when %s evidence records execution', async (evidence) => {
    const h = await setup(backend, false)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const id = simulationEntityIdSchema.parse('first')
    await restored.connection.activate(id, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { options: {} }, signal: new AbortController().signal })
    await restored.connection.hibernate(id)
    const binding = h.bindings[0]!
    const stored = await h.ctx.sessionPersistence.readFrom(binding.sessionId, 0)
    const path = h.ctx.sessionPersistence.locate(stored.meta)!.path
    const bytes = await readFile(path)
    await rm(path)
    if (evidence !== 'writer') {
      const acquire = restored.run.acquireCheckpointCut.bind(restored.run)
      vi.spyOn(restored.run, 'acquireCheckpointCut').mockImplementationOnce(async (...args) => {
        const cut = await acquire(...args)
        const { writer: _writer, ...entity } = cut.snapshot.entities[id]!
        return { ...cut, snapshot: { ...cut.snapshot, entities: { ...cut.snapshot.entities, [id]: entity } } }
      })
      if (evidence === 'participant') {
        const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
        vi.spyOn(h.ctx.teams, 'getTeam').mockImplementation(async (...args) => {
          const team = await getTeam(...args)
          return { ...team, activations: team.activations.map(value => ({ ...value, sessionId: SessionId('foreign-session') })) }
        })
      }
    }
    try {
      await expect(restored.connection.collectCheckpointCandidate(4, 3)).rejects.toThrow('Checkpoint Session history is missing for an executed entity')
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await writeFile(path, bytes) }
  })

  it.each(['removed-prefix', 'moved-source'] as const)('refuses a %s run reference during collection', async (damage) => {
    const h = await setup(backend)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    if (damage === 'removed-prefix') {
      const acquire = restored.run.acquireCheckpointCut.bind(restored.run)
      vi.spyOn(restored.run, 'acquireCheckpointCut').mockImplementationOnce(async (...args) => {
        const cut = await acquire(...args)
        return { ...cut, reference: { ...cut.reference, firstSequence: 1 } }
      })
    } else {
      const read = restored.run.getPersistenceReference.bind(restored.run)
      vi.spyOn(restored.run, 'getPersistenceReference').mockImplementation(async (...args) => {
        const reference = await read(...args)
        return { ...reference, stream: { ...reference.stream, name: 'replacement-stream' } }
      })
    }
    await expect(restored.connection.collectCheckpointCandidate(4, 2)).rejects.toThrow(damage === 'removed-prefix'
      ? 'Checkpoint run history has been removed' : 'Run reference changed')
  })

  it('refuses a channel reference that names a Team stream', async () => {
    const h = await setup(backend)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const read = h.ctx.teams.getPersistenceReference.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'getPersistenceReference').mockImplementation(async (request) => {
      const reference = await read(request)
      return request.kind === 'team' ? reference : { ...reference, owner: { kind: 'team', teamId: h.manifest.team.owner.teamId } }
    })
    await expect(restored.connection.collectCheckpointCandidate(4, 2)).rejects.toThrow('Checkpoint channel reference has another owner kind')
  })

  it('refuses publication when a collected confirmed channel is omitted from the manifest', async () => {
    const h = await setup(backend)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const acquire = restored.run.acquireCheckpointCut.bind(restored.run)
    vi.spyOn(restored.run, 'acquireCheckpointCut').mockImplementationOnce(async (...args) => {
      const cut = await acquire(...args)
      return { ...cut, publish: value => cut.publish({ ...value, channels: [] }) }
    })
    const command = simulationCheckpointRequestSchema.parse({ id: 'omitted-channel', implementationVersion: 'audit-1', maxDrainRounds: 4, maxAttempts: 3 })
    expect(await restored.connection.checkpoint(command)).toMatchObject({ status: 'failed', error: 'Checkpoint manifest omits or changes canonical owner references' })
    expect(restored.run.snapshot().latestCheckpointId).toBe(h.request.id)
  })

  it('rejects incompatible or unfinished restore requests before admitting execution and allows a valid retry', async () => {
    const h = await setup(backend)
    const models = vi.spyOn(h.ctx.llm, 'stream'), posts = vi.spyOn(h.ctx.teams, 'postChannelEnvelope')
    await expect(h.ctx.simulationTeams.restore({ ...h.selection, mode: 'create' }, h.request)).rejects.toThrow(/existing run/)
    await expect(h.ctx.simulationTeams.restore(h.selection, { ...h.request, implementationVersion: 'another-implementation' })).rejects.toThrow(/implementation version differs/)
    const pending = await h.ctx.simulations.open(h.selection)
    const command = simulationCheckpointRequestSchema.parse({ ...h.request, id: 'unfinished', maxDrainRounds: 4 })
    await pending.beginCheckpoint(command)
    await pending.close()
    await expect(h.ctx.simulationTeams.restore(h.selection, { ...h.request, id: command.id })).rejects.toThrow(/completed manifest/)
    const reopened = await h.ctx.simulations.open(h.selection)
    await reopened.failCheckpoint(command.id, 'Abandoned incomplete candidate')
    await reopened.close()
    await expect(h.ctx.simulationTeams.restore(h.selection, { ...h.request, id: command.id })).rejects.toThrow(/completed manifest/)
    expect(models).not.toHaveBeenCalled()
    expect(posts).not.toHaveBeenCalled()
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    expect(restored.run.snapshot().phase).toBe('paused')
    expect(restored.run.snapshot().latestCheckpointId).toBe(h.request.id)
  })

  it('recollects an unmaterialized Session that acquires a durable header during collection', async () => {
    const h = await setup(backend, false)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const binding = h.bindings[0]!
    const absent = h.ctx.sessionPersistence.isUnmaterialized.bind(h.ctx.sessionPersistence)
    let changed = false
    const moving = vi.spyOn(h.ctx.sessionPersistence, 'isUnmaterialized').mockImplementation(async (...args) => {
      const value = await absent(...args)
      if (args[0] === binding.sessionId && !changed) {
        changed = true
        const session = h.ctx.sessions.create(binding.sessionId, { meta: { teamId: binding.teamId, participantId: binding.participantId } })
        await h.ctx.sessionPersistence.materializeHeader(session)
      }
      return value
    })
    const request = simulationCheckpointRequestSchema.parse({ id: 'recollected', implementationVersion: 'audit-1', maxDrainRounds: 4, maxAttempts: 2 })
    const checkpoint = await restored.connection.checkpoint(request)
    expect(checkpoint.status).toBe('completed')
    if (checkpoint.status !== 'completed') throw new Error('Recollected checkpoint failed')
    expect(moving.mock.calls.filter(args => args[0] === binding.sessionId).length).toBeGreaterThanOrEqual(3)
    expect(checkpoint.manifest.sessions.find(value => value.sessionId === binding.sessionId)?.kind).toBe('materialized')
  })

  it.each(['materialized', 'replaced'] as const)('refuses publication after a Session is %s and retains the previous manifest', async (movement) => {
    const h = await setup(backend, movement === 'replaced')
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const { run, connection } = restored
    const binding = h.bindings[0]!
    const collect = connection.collectCheckpointCandidate.bind(connection)
    const moved = vi.spyOn(connection, 'collectCheckpointCandidate').mockImplementationOnce(async (...args) => {
      const candidate = await collect(...args)
      if (movement === 'materialized') {
        const session = h.ctx.sessions.create(binding.sessionId, { meta: { teamId: binding.teamId, participantId: binding.participantId } })
        await h.ctx.sessionPersistence.materializeHeader(session)
      } else {
        const stored = await h.ctx.sessionPersistence.readFrom(binding.sessionId, 0)
        const location = h.ctx.sessionPersistence.locate(stored.meta)!
        const replacement = `${location.path}.replacement`
        await writeFile(replacement, await readFile(location.path))
        await rename(replacement, location.path)
      }
      return candidate
    })
    const request = simulationCheckpointRequestSchema.parse({ id: 'moved-cut', implementationVersion: 'audit-1', maxDrainRounds: 4, maxAttempts: 3 })
    const failed = await connection.checkpoint(request)
    expect(failed).toMatchObject({ status: 'failed', error: movement === 'materialized' ? 'Session materialized' : 'Session reference changed' })
    expect(run.snapshot().latestCheckpointId).toBe(h.request.id)
    expect(run.snapshot().checkpoints?.[h.request.id]).toMatchObject({ status: 'completed', manifest: h.manifest })
    const revision = run.snapshot().revision
    expect(await connection.checkpoint(request)).toEqual(failed)
    expect(run.snapshot().revision).toBe(revision)
    moved.mockRestore()
    const retried = await connection.checkpoint(simulationCheckpointRequestSchema.parse({ ...request, id: 'fresh-cut' }))
    expect(retried.status).toBe('completed')
    if (retried.status !== 'completed') throw new Error('Fresh checkpoint failed')
    expect(retried.manifest.sessions.find(value => value.sessionId === binding.sessionId)?.kind).toBe('materialized')
  })

  it.each(['missing', 'truncated', 'header', 'binding', 'version'] as const)('refuses a %s Session artifact without repairing it', async (damage) => {
    const h = await setup(backend)
    const session = h.sessions[0]!
    const stored = await h.ctx.sessionPersistence.readFrom(session.id, 0)
    const location = h.ctx.sessionPersistence.locate(stored.meta)
    if (location === undefined) throw new Error('Fixture has no physical Session path')
    const original = await readFile(location.path, 'utf8')
    const ctx = await h.reopen()
    const lines = original.trimEnd().split('\n')
    if (damage === 'missing') await rm(location.path)
    else if (damage === 'truncated') await writeFile(location.path, `${lines[0]}\n`)
    else {
      const header = JSON.parse(lines[0]!) as Record<string, unknown>
      if (damage === 'header') header['createdAt'] = Number(header['createdAt']) + 1
      if (damage === 'binding') header['participantId'] = h.bindings[1]!.participantId
      if (damage === 'version') header['version'] = 999
      lines[0] = JSON.stringify(header)
      await writeFile(location.path, `${lines.join('\n')}\n`)
    }
    const damaged = damage === 'missing' ? undefined : await readFile(location.path, 'utf8')
    const models = vi.spyOn(ctx.llm, 'stream')
    const posts = vi.spyOn(ctx.teams, 'postChannelEnvelope')
    await expect(ctx.simulationTeams.restore(h.selection, h.request)).rejects.toThrow()
    expect(models).not.toHaveBeenCalled()
    expect(posts).not.toHaveBeenCalled()
    if (damaged !== undefined) expect(await readFile(location.path, 'utf8')).toBe(damaged)
    await writeFile(location.path, original)
    const restored = await ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    expect(restored.run.snapshot().phase).toBe('paused')
  })

  it.each(['team', 'channel'] as const)('refuses missing %s log history before restoring execution', async (kind) => {
    const h = await setup(backend)
    const reference = kind === 'team' ? h.manifest.team : h.manifest.channels[0]!
    await h.ctx.fiber.dispose()
    let repair: () => Promise<void>
    if (backend === 'json') {
      const path = join(h.root, 'team-json', 'logs', `${Buffer.from(reference.stream.name).toString('base64url')}.json`)
      const original = await readFile(path, 'utf8')
      const document = JSON.parse(original) as { entries: unknown[] }
      document.entries.shift()
      const damaged = `${JSON.stringify(document)}\n`
      await writeFile(path, damaged)
      repair = async () => { expect(await readFile(path, 'utf8')).toBe(damaged); await writeFile(path, original) }
    } else {
      const path = join(h.root, 'team.sqlite')
      const db = new DatabaseSync(path)
      const entry = db.prepare('SELECT value FROM log_entries WHERE stream = ? AND sequence = 0').get(reference.stream.name) as { value: string }
      db.prepare('DELETE FROM log_entries WHERE stream = ? AND sequence = 0').run(reference.stream.name)
      db.close()
      repair = () => {
        const db = new DatabaseSync(path)
        try {
          expect(db.prepare('SELECT value FROM log_entries WHERE stream = ? AND sequence = 0').get(reference.stream.name)).toBeUndefined()
          db.prepare('INSERT INTO log_entries(stream, sequence, value) VALUES (?, 0, ?)').run(reference.stream.name, entry.value)
        } finally { db.close() }
        return Promise.resolve()
      }
    }
    const ctx = await h.reopen()
    const models = vi.spyOn(ctx.llm, 'stream'), posts = vi.spyOn(ctx.teams, 'postChannelEnvelope')
    await expect(ctx.simulationTeams.restore(h.selection, h.request)).rejects.toThrow()
    expect(models).not.toHaveBeenCalled()
    expect(posts).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
    await repair()
    const retry = await h.reopen()
    const restored = await retry.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    expect(restored.run.snapshot().phase).toBe('paused')
  })

  it.each(['foreign-run', 'missing-owner', 'empty-owner', 'child-team', 'child-task', 'missing-channel', 'missing-participant'] as const)
  ('refuses a provider observation with %s ownership', async (kind) => {
    const h = await setup(backend)
    const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
    const changed = vi.spyOn(h.ctx.teams, 'getTeam').mockImplementation(async (...args) => {
      const current = await getTeam(...args)
      switch (kind) {
        case 'foreign-run': return { ...current, rules: { ...current.rules, simulationRunId: 'other-run' } }
        case 'missing-owner': {
          const rules = { ...current.rules }
          delete rules['activationLifecycleOwner']
          return { ...current, rules }
        }
        case 'empty-owner': return { ...current, rules: { ...current.rules, activationLifecycleOwner: '' } }
        case 'child-team': return { ...current, team: { ...current.team, parentTeamId: teamIdSchema.parse('parent'),
          parentTaskId: teamTaskIdSchema.parse('parent-task'), depth: 1 } }
        case 'child-task': return { ...current, tasks: [task({ teamId: current.team.id, maxAttempts: 1,
          delegation: { id: 'delegation', phase: 'requested', requestedAt: 1, updatedAt: 1 }, execution: { kind: 'child-team',
            templateId: 'child', templateVersion: 1, authorityGrant: current.team.authorityGrant, budget: {} } })] }
        case 'missing-channel': return { ...current, channelIds: [] }
        case 'missing-participant': return { ...current, participants: current.participants.filter(value => value.id !== h.bindings[0]!.participantId) }
      }
    })
    const models = vi.spyOn(h.ctx.llm, 'stream'), posts = vi.spyOn(h.ctx.teams, 'postChannelEnvelope')
    const expected = kind === 'child-team' || kind === 'child-task' ? 'Checkpoint recovery does not cover child-Team owners'
      : kind === 'missing-channel' ? 'Checkpoint channel is no longer attached to its Team'
        : kind === 'missing-participant' ? 'Restored entity has no canonical Team participant'
          : 'Checkpoint Team has another run or lifecycle owner'
    await expect(h.ctx.simulationTeams.restore(h.selection, h.request)).rejects.toThrow(expected)
    expect(models).not.toHaveBeenCalled()
    expect(posts).not.toHaveBeenCalled()
    changed.mockRestore()
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
  })

  it('refuses a channel returned with a foreign Team identity', async () => {
    const h = await setup(backend)
    const getChannel = h.ctx.teams.getChannel.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'getChannel').mockImplementation(async (...args) => {
      const current = await getChannel(...args)
      return { ...current, manifest: { ...current.manifest, teamId: teamIdSchema.parse('foreign-team') } }
    })
    await expect(h.ctx.simulationTeams.restore(h.selection, h.request)).rejects.toThrow(/another Team/)
  })

  it('rejects a run mutation during owner validation instead of admitting a mixed revision', async () => {
    const h = await setup(backend)
    const open = h.ctx.simulations.open.bind(h.ctx.simulations)
    vi.spyOn(h.ctx.simulations, 'open').mockImplementationOnce(async (...args) => {
      const opened = await open(...args)
      const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
      vi.spyOn(h.ctx.teams, 'getTeam').mockImplementationOnce(async (...query) => {
        const current = await getTeam(...query)
        await opened.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: 'warehouse', entityRevision: 1,
          profile: { changed: true } }), opened.snapshot().revision)
        return current
      })
      return opened
    })
    await expect(h.ctx.simulationTeams.restore(h.selection, h.request)).rejects.toThrow(/Run advanced/)
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    expect(restored.run.inspectEntity(simulationEntityIdSchema.parse('warehouse')).entity?.profile).toEqual({ changed: true })
  })

  it('validates newly provisioned Session and channel suffix owners absent from the old manifest', async () => {
    const h = await setup(backend)
    const run = await h.ctx.simulations.open(h.selection)
    cleanups.push(() => run.close())
    const connection = await h.ctx.simulationTeams.attach(run, h.manifest.team.owner.teamId, 'simulation/company')
    const third = simulationEntityIdSchema.parse('third')
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: third, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    const binding = await connection.ensureParticipant(third, { displayName: 'Third', role: 'third', capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'unused' })
    const session = h.ctx.sessions.create(binding.sessionId, { meta: { teamId: binding.teamId, participantId: binding.participantId } })
    await h.ctx.sessionPersistence.materializeHeader(session)
    const channel = await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'suffix-peer',
      members: [{ entityId: simulationEntityIdSchema.parse('first'), role: 'first' }, { entityId: third, role: 'third' }], limits: {} }))
    await run.close()
    const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
    const missing = vi.spyOn(h.ctx.teams, 'getTeam').mockImplementation(async (...args) => {
      const state = await getTeam(...args)
      return { ...state, channelIds: state.channelIds.filter(id => id !== channel.manifest.id) }
    })
    await expect(h.ctx.simulationTeams.restore(h.selection, h.request)).rejects.toThrow(/confirmed channel missing/)
    missing.mockRestore()
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    expect(restored.run.inspectEntity(third).entity?.binding).toEqual(binding)
  })

  it('refuses a provider projection that loses a binding retained in the manifest', async () => {
    const h = await setup(backend)
    const open = h.ctx.simulations.open.bind(h.ctx.simulations)
    vi.spyOn(h.ctx.simulations, 'open').mockImplementationOnce(async (...args) => {
      const opened = await open(...args)
      const snapshot = opened.snapshot.bind(opened)
      vi.spyOn(opened, 'snapshot').mockImplementation(() => {
        const state = snapshot()
        const id = simulationEntityIdSchema.parse('first')
        const entity = { ...state.entities[id]! }
        delete entity.binding
        return { ...state, entities: { ...state.entities, [id]: entity } }
      })
      return opened
    })
    await expect(h.ctx.simulationTeams.restore(h.selection, h.request)).rejects.toThrow(/binding differs from the restored run/)
  })

  it('revalidates a byte-identical Session artifact replaced during the final read', async () => {
    const h = await setup(backend)
    const session = h.sessions[0]!
    const stored = await h.ctx.sessionPersistence.readFrom(session.id, 0)
    const location = h.ctx.sessionPersistence.locate(stored.meta)!
    const read = h.ctx.sessionPersistence.getPersistenceReference.bind(h.ctx.sessionPersistence)
    let calls = 0
    const checked = vi.spyOn(h.ctx.sessionPersistence, 'getPersistenceReference').mockImplementation(async (...args) => {
      if (args[0] === session.id && ++calls === 2) {
        const bytes = await readFile(location.path, 'utf8')
        const replacement = `${location.path}.replacement`
        await writeFile(replacement, bytes)
        await rename(replacement, location.path)
      }
      return await read(...args)
    })
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    expect(checked.mock.calls.length).toBeGreaterThan(4)
    expect(calls).toBe(4)
  })

  it.each([false, true])('retains activation history and rejects missing Session (foreign source identity=%s)', async (foreignIdentity) => {
    const h = await setup(backend, false)
    const run = await h.ctx.simulations.open(h.selection)
    cleanups.push(() => run.close())
    const connection = await h.ctx.simulationTeams.attach(run, h.manifest.team.owner.teamId, 'simulation/company')
    const id = simulationEntityIdSchema.parse('first')
    const activated = await connection.activate(id, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { options: {} }, signal: new AbortController().signal })
    expect(activated.localAgent).toBeDefined()
    await connection.hibernate(id)
    await run.close()
    const good = await h.ctx.simulationTeams.restore(h.selection, h.request)
    await good.run.close()
    const stored = await h.ctx.sessionPersistence.readFrom(h.bindings[0]!.sessionId, 0)
    const location = h.ctx.sessionPersistence.locate(stored.meta)!
    const original = await readFile(location.path, 'utf8')
    const ctx = await h.reopen()
    await rm(location.path)
    if (foreignIdentity) {
      const getTeam = ctx.teams.getTeam.bind(ctx.teams)
      vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (...args) => {
        const state = await getTeam(...args)
        return { ...state, activations: state.activations.map(value => ({ ...value, sessionId: SessionId('other-session') })) }
      })
    }
    await expect(ctx.simulationTeams.restore(h.selection, h.request)).rejects.toThrow(foreignIdentity
      ? 'Checkpoint writer has no matching retained Team activation' : 'Checkpoint Session history is missing')
    await writeFile(location.path, original)
  })

  it.each(['missing', 'session', 'participant'] as const)('rejects %s writer activation history before recovery admission', async (damage) => {
    const h = await setup(backend, false)
    const second = h.bindings[1]!
    await h.ctx.sessionPersistence.materializeHeader(h.ctx.sessions.create(second.sessionId, {
      meta: { teamId: second.teamId, participantId: second.participantId },
    }))
    const run = await h.ctx.simulations.open(h.selection)
    const connection = await h.ctx.simulationTeams.attach(run, h.manifest.team.owner.teamId, 'simulation/company')
    const id = simulationEntityIdSchema.parse('first')
    await connection.activate(id, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { options: {} }, signal: new AbortController().signal })
    await connection.hibernate(id)
    await run.close()
    const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
    const changed = vi.spyOn(h.ctx.teams, 'getTeam').mockImplementation(async (...args) => {
      const state = await getTeam(...args)
      return { ...state, activations: damage === 'missing' ? [] : state.activations.map(value => damage === 'session'
        ? { ...value, sessionId: h.bindings[1]!.sessionId }
        : { ...value, activation: { ...value.activation, participantId: h.bindings[1]!.participantId } }) }
    })
    const models = vi.spyOn(h.ctx.llm, 'stream'), posts = vi.spyOn(h.ctx.teams, 'postChannelEnvelope')
    await expect(h.ctx.simulationTeams.restore(h.selection, h.request)).rejects.toThrow('Checkpoint writer has no matching retained Team activation')
    expect(models).not.toHaveBeenCalled()
    expect(posts).not.toHaveBeenCalled()
    changed.mockRestore()
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    expect(restored.run.inspectEntity(id).entity?.writer?.phase).toBe('released')
  })

  it('retries a changed retention declaration during final Team revalidation', async () => {
    const h = await setup(backend)
    const read = h.ctx.teams.getPersistenceReference.bind(h.ctx.teams)
    let currentReads = 0
    vi.spyOn(h.ctx.teams, 'getPersistenceReference').mockImplementation(async (request) => {
      const value = await read(request)
      if (request.kind === 'team' && request.prefixCursor === undefined && ++currentReads === 2) {
        return { ...value, retention: 'compactable' }
      }
      return value
    })
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    expect(currentReads).toBe(4)
  })

  it('retries channel advancement after validating its retained prefix', async () => {
    const h = await setup(backend)
    const read = h.ctx.teams.getPersistenceReference.bind(h.ctx.teams)
    let moved = false
    vi.spyOn(h.ctx.teams, 'getPersistenceReference').mockImplementation(async (request) => {
      const value = await read(request)
      if (!moved && request.kind === 'channel' && request.prefixCursor !== undefined) {
        moved = true
        await closeTestChannel(h.ctx, { channelId: request.channelId, expectedCursor: request.expectedCursor, reason: 'Owner advanced' })
      }
      return value
    })
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    expect((await h.ctx.teams.getChannel({ channelId: h.channel.manifest.id })).phase).toBe('closed')
  })

  it('retries a Session suffix append that races its retained-prefix read', async () => {
    const h = await setup(backend)
    const session = h.sessions[0]!
    const prefix = h.ctx.sessionPersistence.getPersistencePrefix.bind(h.ctx.sessionPersistence)
    const raced = vi.spyOn(h.ctx.sessionPersistence, 'getPersistencePrefix').mockImplementationOnce(async (...args) => {
      session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'After the cut' }] }), { surfaceOp: 'append' })
      await h.ctx.sessions.flush(session)
      return await prefix(...args)
    })
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    expect(raced.mock.calls.length).toBeGreaterThan(2)
    expect((await h.ctx.sessionPersistence.readFrom(session.id, 0)).events).toHaveLength(2)
  })

  it('retries materialization after an absent Session observation and retains its canonical identity', async () => {
    const h = await setup(backend, false)
    const binding = h.bindings[0]!
    const absent = h.ctx.sessionPersistence.isUnmaterialized.bind(h.ctx.sessionPersistence)
    vi.spyOn(h.ctx.sessionPersistence, 'isUnmaterialized').mockImplementationOnce(async (...args) => {
      const value = await absent(...args)
      const session = h.ctx.sessions.create(binding.sessionId, { meta: { teamId: binding.teamId, participantId: binding.participantId } })
      await h.ctx.sessionPersistence.materializeHeader(session)
      return value
    })
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    const stored = await h.ctx.sessionPersistence.readFrom(binding.sessionId, 0)
    expect(stored.meta.participantId).toBe(binding.participantId)
    expect(stored.events).toEqual([])
  })

  it.each(['team', 'channel'] as const)('refuses an owner whose %s retention guarantee was removed', async (kind) => {
    const h = await setup(backend)
    const read = h.ctx.teams.getPersistenceReference.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'getPersistenceReference').mockImplementation(async request => ({ ...await read(request),
      retention: request.kind === kind ? 'compactable' : 'full' }))
    await expect(h.ctx.simulationTeams.restore(h.selection, h.request)).rejects.toThrow(/history is not protected/)
  })
})

describe.each(['json', 'sqlite'] as const)('%s interrupted window projection', (backend) => {
  it.each(['missing-window', 'open-slot'] as const)('refuses %s after owner validation and permits a corrected retry', async (failure) => {
    const h = await setup(backend, false)
    const { simulationWindowIdSchema, simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
    const { contextRequest } = await import('../../simulation-local/tests/context-fixture.ts')
    const windowId = simulationWindowIdSchema.parse('interrupted-window')
    const id = simulationDecisionIdSchema.parse('interrupted-slot')
    if (failure === 'open-slot') {
      const prior = await h.ctx.simulationTeams.restore(h.selection, h.request)
      cleanups.push(() => prior.run.close())
      const entityId = simulationEntityIdSchema.parse('first')
      await prior.connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
        agent: { options: {} }, signal: new AbortController().signal })
      await prior.run.setPhase('running', prior.run.snapshot().revision)
      await prior.connection.openWindow({ id: windowId, decisions: [{ id, entityId, context: contextRequest() }] })
      await prior.run.close()
    }
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    const injected = vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementationOnce(async (...args) => {
      const connection = await attach(...args)
      const run = args[0], snapshot = run.snapshot.bind(run)
      vi.spyOn(run, 'snapshot').mockImplementation(() => {
        const state = snapshot()
        return failure === 'missing-window' ? { ...state, activeWindowId: windowId }
          : { ...state, decisions: { ...state.decisions, [id]: { ...state.decisions[id]!, status: 'open' as const } } }
      })
      return connection
    })
    try {
      await expect(h.ctx.simulationTeams.restore(h.selection, h.request)).rejects.toThrow(/retains an unsettled decision window/)
    } finally { injected.mockRestore() }
    const restored = await h.ctx.simulationTeams.restore(h.selection, h.request)
    cleanups.push(() => restored.run.close())
    expect(restored.run.snapshot().activeWindowId).toBeUndefined()
    expect(restored.run.snapshot().phase).toBe('paused')
    expect(restored.run.population().chargedActors).toBe(0)
    if (failure === 'open-slot') {
      expect(restored.run.snapshot().decisions[id]?.status).toBe('cancelled')
      expect(restored.run.snapshot().windows?.[windowId]?.status).toBe('closed')
    }
  })
})
