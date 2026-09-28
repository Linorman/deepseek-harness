import { simulationTemp } from './temp.ts'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activationIdSchema, activationReservationIdSchema, participantIdSchema, teamIdSchema } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import { simulationChangeSchema, simulationEntityIdSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup(backend: 'json' | 'sqlite') {
  const root = await simulationTemp('ledger')
  const config = { name: 'local', root, backend, replayPageSize: 2 }
  const provider = new LocalSimulationProvider(config, () => {})
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'writers', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceQuantity: '1000000000000000000000000', relationRules: [],
  } })
  const run = await provider.open(selection)
  cleanups.push(async () => { await run.close(); await provider.close(); await rm(root, { recursive: true, force: true }) })
  const entityId = simulationEntityIdSchema.parse('buyer')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entityId, entityKind: 'person', cognition: 'agent', profile: {} }), 0)
  const binding = { teamId: teamIdSchema.parse('team'), participantId: participantIdSchema.parse('buyer'), sessionId: SessionId('session') }
  const reservationId = activationReservationIdSchema.parse('reservation-one')
  const activation = { ...binding, reservationId, provider: 'in-process', activationId: activationIdSchema.parse('activation-one') }
  return { root, config, selection, provider, run, entityId, binding, reservationId, activation }
}

describe.each(['json', 'sqlite'] as const)('%s cognition ownership', (backend) => {
  it('keeps one canonical binding, issues monotonic epochs and rejects stale capabilities', async () => {
    const { run, provider, selection, entityId, binding, reservationId, activation } = await setup(backend)
    await expect(run.reserveWriter(entityId, 'in-process', reservationId, run.snapshot().revision)).rejects.toThrow(/active bound entity/)
    await run.bindEntity(entityId, binding, run.snapshot().revision)
    const bound = run.snapshot()
    await run.bindEntity(entityId, binding, bound.revision)
    expect(run.snapshot()).toEqual(bound)
    const first = await run.reserveWriter(entityId, 'in-process', reservationId, bound.revision)
    first.bindDecisionAdmission(async () => {})
    const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
    await expect(first.openDecision(simulationDecisionIdSchema.parse('before-activation'), run.snapshot().revision))
      .rejects.toThrow(/cannot admit a decision/)
    await expect(run.reserveWriter(entityId, 'in-process', reservationId, run.snapshot().revision)).rejects.toThrow(/proven stopped/)
    await expect(first.release()).rejects.toThrow(/revoked before release/)
    for (const invalid of [
      { ...activation, sessionId: SessionId('other') },
      { ...activation, participantId: participantIdSchema.parse('other') },
      { ...activation, teamId: teamIdSchema.parse('other') },
      { ...activation, provider: 'remote' },
      { ...activation, reservationId: activationReservationIdSchema.parse('other') },
    ]) await expect(first.activate(invalid)).rejects.toThrow(/canonical binding/)
    await first.activate(activation)
    await first.activate(activation)
    await expect(first.activate({ ...activation, activationId: activationIdSchema.parse('other') })).rejects.toThrow(/canonical binding/)
    const current = Object.values(run.snapshot().entities)[0]
    await expect(run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: entityId, entityRevision: current?.revision, phase: 'inactive' }), run.snapshot().revision)).rejects.toThrow(/proven-stopped/)
    const recovered = await run.recoverWriter(entityId, activation)
    expect(recovered.priorCoordinatorExited).toBe(false)
    await recovered.revoke(); await first.revoke()
    await expect(first.activate(activation)).rejects.toThrow(/not reserved/)
    await recovered.release(); await recovered.release(); await recovered.revoke()
    const second = await run.reserveWriter(entityId, 'in-process', activationReservationIdSchema.parse('reservation-two'), run.snapshot().revision)
    expect(second.epoch).toBe('2')
    await expect(first.revoke()).rejects.toThrow(/stale/)
    await expect(first.release()).rejects.toThrow(/stale/)
    await expect(first.activate(activation)).rejects.toThrow(/stale/)
    await second.revoke(); await second.release()
    const snapshot = run.snapshot()
    await run.close()
    const reopened = await provider.open({ ...selection, mode: 'open' })
    expect(reopened.snapshot()).toEqual(snapshot)
    const previousActivation = { ...activation, reservationId: activationReservationIdSchema.parse('reservation-two') }
    const oldLease = await reopened.recoverWriter(entityId, previousActivation)
    expect(oldLease.priorCoordinatorExited).toBe(true)
    await expect(oldLease.activate(previousActivation)).rejects.toThrow(/recovered writer/)
    await oldLease.revoke(); await oldLease.release()
  })

  it('retains the process lock until even a revoked writer is released, including provider shutdown', async () => {
    const { run, provider, config, selection, entityId, binding, reservationId } = await setup(backend)
    await run.bindEntity(entityId, binding, run.snapshot().revision)
    const lease = await run.reserveWriter(entityId, 'in-process', reservationId, run.snapshot().revision)
    const competitor = new LocalSimulationProvider(config, () => {})
    try {
      await expect(run.close()).rejects.toThrow(/confirmed quiescence/)
      await expect(provider.close()).rejects.toThrow(/cleanup failed/)
      await expect(competitor.open({ ...selection, mode: 'open' })).rejects.toThrow(/coordinator/)
      await lease.revoke()
      await expect(run.close()).rejects.toThrow(/confirmed quiescence/)
      await lease.release()
      await run.close()
      const reopened = await competitor.open({ ...selection, mode: 'open' })
      expect(Object.values(reopened.snapshot().entities)[0]?.writer?.phase).toBe('released')
    } finally { await competitor.close() }
  })
})

it('rejects noncognitive, duplicate, cross-Team and inactive bindings without allocating a Session', async () => {
  const { run, entityId, binding } = await setup('sqlite')
  await expect(run.bindEntity(simulationEntityIdSchema.parse('missing'), binding, run.snapshot().revision)).rejects.toThrow(/does not exist/)
  const create = async (id: string, cognition: 'agent' | 'none') => {
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'org', cognition, profile: {} }), run.snapshot().revision)
    return simulationEntityIdSchema.parse(id)
  }
  const organization = await create('warehouse', 'none')
  await expect(run.bindEntity(organization, binding, run.snapshot().revision)).rejects.toThrow(/Non-cognitive/)
  await run.bindEntity(entityId, binding, run.snapshot().revision)
  await expect(run.bindEntity(entityId, { ...binding, sessionId: SessionId('other') }, run.snapshot().revision)).rejects.toThrow(/permanent binding/)
  const other = await create('other', 'agent')
  await expect(run.bindEntity(other, { ...binding, participantId: participantIdSchema.parse('other') }, run.snapshot().revision)).rejects.toThrow(/must be unique/)
  await expect(run.bindEntity(other, { ...binding, sessionId: SessionId('other') }, run.snapshot().revision)).rejects.toThrow(/must be unique/)
  await expect(run.bindEntity(other, { ...binding, teamId: teamIdSchema.parse('elsewhere') }, run.snapshot().revision)).rejects.toThrow(/canonical execution Team/)
  const entity = run.snapshot().entities[other]
  await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: other, entityRevision: entity?.revision, phase: 'inactive' }), run.snapshot().revision)
  await expect(run.bindEntity(other, { ...binding, participantId: participantIdSchema.parse('other'), sessionId: SessionId('other') }, run.snapshot().revision)).rejects.toThrow(/Only active/)
  await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: other, entityRevision: 2, phase: 'active' }), run.snapshot().revision)
  await run.bindEntity(other, { ...binding, participantId: participantIdSchema.parse('other'), sessionId: SessionId('other') }, run.snapshot().revision)
})

it('distinguishes never-admitted startup from reserved, published and foreign reservations', async () => {
  const { run, entityId, binding, reservationId, activation } = await setup('sqlite')
  await run.bindEntity(entityId, binding, run.snapshot().revision)
  const reservation = { ...binding, reservationId, provider: 'in-process' }
  expect(await run.recoverUnpublishedWriter(entityId, reservation)).toBeUndefined()
  await expect(run.recoverUnpublishedWriter(entityId, { ...reservation, sessionId: SessionId('foreign') })).rejects.toThrow(/canonical binding/)
  const lease = await run.reserveWriter(entityId, 'in-process', reservationId, run.snapshot().revision)
  for (const invalid of [
    { ...reservation, provider: 'remote' },
    { ...reservation, reservationId: activationReservationIdSchema.parse('other') },
  ]) await expect(run.recoverUnpublishedWriter(entityId, invalid)).rejects.toThrow(/startup reservation/)
  expect((await run.recoverUnpublishedWriter(entityId, reservation))?.priorCoordinatorExited).toBe(false)
  await lease.activate(activation)
  await expect(run.recoverUnpublishedWriter(entityId, reservation)).rejects.toThrow(/startup reservation/)
  await lease.revoke(); await lease.release()
  expect(await run.recoverUnpublishedWriter(entityId, { ...reservation, reservationId: activationReservationIdSchema.parse('never-started') })).toBeUndefined()
})

it('retains the current retirement callback when an older detached callback is disposed again', async () => {
  const { run } = await setup('sqlite')
  const first = run.onClose(() => Promise.resolve())
  expect(() => run.onClose(() => Promise.resolve())).toThrow(/retirement owner/)
  first()
  let stopped = false
  run.onClose(() => { stopped = true; return Promise.resolve() })
  first()
  await run.close()
  expect(stopped).toBe(true)
  expect(() => run.onClose(() => Promise.resolve())).toThrow(/closing/)
})

it('rejects malformed persisted epoch transitions even when the outer journal cursor is correct', async () => {
  const { foldEntry } = await import('../src/journal.ts')
  const { run, entityId, binding, reservationId, activation } = await setup('sqlite')
  await run.bindEntity(entityId, binding, run.snapshot().revision)
  const lease = await run.reserveWriter(entityId, 'in-process', reservationId, run.snapshot().revision)
  const reserved = run.snapshot()
  const apply = (state: typeof reserved, change: unknown) => foldEntry(state, {
    sequence: state.revision + 1,
    value: { kind: 'run/writer', runId: state.spec.runId, expectedRevision: state.revision, change },
  }, state.spec, 'sqlite')
  const entity = reserved.entities[entityId]
  if (entity === undefined) throw new Error('fixture entity missing')
  const inactive = { ...reserved, entities: { ...reserved.entities, [entityId]: { ...entity, phase: 'inactive' as const } } }
  expect(() => apply(inactive, { kind: 'writer/activated', entityId, epoch: '1', activation })).toThrow(/not reserved/)
  await lease.activate(activation); await lease.revoke()
  expect(() => apply(run.snapshot(), { kind: 'writer/revoked', entityId, epoch: '1' })).toThrow(/cannot be revoked/)
  expect(() => apply(run.snapshot(), { kind: 'writer/released', entityId, epoch: '1', activationId: 'foreign' })).toThrow(/retain its activation/)
  await lease.release()
  expect(() => apply(run.snapshot(), { kind: 'writer/reserved', entityId, epoch: '3', provider: 'in-process',
    coordinatorId: 'coordinator', reservationId: 'next' })).toThrow(/increase by one/)
})


describe.each(['json', 'sqlite'] as const)('%s acceptance authority diagnostics', (backend) => {
  it('checks new acceptance intervals and retains accepted effects after revocation', async () => {
    const { createBusinessHarness } = await import('./business-harness.ts')
    const { assertWriterAdmission } = await import('../src/writers.ts')
    const { Context } = await import('@clocky/cordis')
    const { default: Invariants } = await import('@clocky/clocky-invariants')
    const invariant = await import('../src/invariant.ts')
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    const { id, lease } = await h.actor('actor')
    const ctx = new Context()
    await ctx.plugin(Invariants)
    await ctx.plugin(invariant)
    try {
      const before = h.run.snapshot().revision
      const pendingId = (await import('@clocky/clocky-simulation')).simulationDecisionIdSchema.parse('accepted')
      await lease.openDecision(pendingId, h.run.snapshot().revision)
      expect(() => { ctx.emit('simulation/committed', h.run.snapshot(), h.run.snapshot().revision, before) }).not.toThrow()
      const decision = await lease.submitDecision(pendingId, [])
      const accepted = h.run.snapshot()
      const writers = await import('../src/writers.ts')
      const interrupted = vi.spyOn(writers, 'assertWriterProjection').mockImplementationOnce(() => { throw 'projection unavailable' })
      expect(() => { ctx.emit('simulation/committed', accepted, accepted.revision, before) }).toThrow('projection unavailable')
      interrupted.mockRestore()
      expect(() => { ctx.emit('simulation/committed', accepted, accepted.revision, before) }).not.toThrow()
      const actor = accepted.entities[id]!
      const writer = actor.writer!
      const { writer: _writer, ...withoutWriter } = actor
      for (const entity of [undefined, { ...actor, phase: 'inactive' as const }, withoutWriter,
        { ...actor, writer: { ...writer, phase: 'revoked' as const } },
        { ...actor, writer: { ...writer, epoch: (await import('@clocky/clocky-simulation')).simulationWriterEpochSchema.parse('2') } }]) {
        const invalid = { ...accepted, entities: { ...accepted.entities } }
        if (entity === undefined) invalid.entities = {}
        else invalid.entities[id] = entity
        expect(() => { assertWriterAdmission(invalid, before) }).toThrow(/active writer interval/)
      }
      for (const closedAt of [undefined, decision.snapshotRevision, accepted.revision + 1]) {
        const invalid = { ...accepted, decisions: { ...accepted.decisions, [decision.id]: { ...decision, closedAt } } }
        expect(() => { ctx.emit('simulation/committed', invalid, invalid.revision, before) }).toThrow(/journal interval/)
      }
      await lease.revoke()
      const revoked = h.run.snapshot()
      expect(() => { ctx.emit('simulation/committed', revoked, revoked.revision, accepted.revision) }).not.toThrow()
      expect(() => { ctx.emit('simulation/committed', revoked, revoked.revision, before) }).toThrow(/active writer interval/)
      expect(revoked.decisions[decision.id]).toEqual(decision)
      await lease.release()
    } finally { await ctx.fiber.dispose() }
  })
})

it('diagnoses corrupted population and canonical reservations from published state', async () => {
  const { assertWriterProjection, foldWriterChange } = await import('../src/writers.ts')
  const { simulationChannelSpecSchema } = await import('@clocky/clocky-simulation')
  const { run, entityId, binding } = await setup('sqlite')
  await run.reserveTeam({ goal: { objective: 'Canonical Team', budgets: {} }, budgets: {},
    rules: { simulationRunId: run.snapshot().spec.runId, activationLifecycleOwner: 'simulation/writers' } }, run.snapshot().revision)
  const unconfirmed = run.snapshot()
  const teamId = unconfirmed.teamReservation!.teamId
  const canonical = { ...binding, teamId }
  expect(() => foldWriterChange(unconfirmed, { kind: 'entity/bound', entityId, binding: canonical })).toThrow(/confirmed canonical Team/)
  await run.confirmTeam(teamId, run.snapshot().revision)
  expect(() => foldWriterChange(run.snapshot(), { kind: 'entity/bound', entityId, binding })).toThrow(/confirmed canonical Team/)
  await run.reserveParticipant(entityId, { displayName: 'Buyer', role: 'buyer', capabilities: [], provider: 'local', preset: 'native', model: 'model' }, run.snapshot().revision)
  const reserved = run.snapshot()
  const own = reserved.entities[entityId]!
  const actual = own.participantReservation!.binding
  const { participantReservation: _reservation, ...withoutReservation } = own
  await run.bindEntity(entityId, actual, reserved.revision)
  const state = run.snapshot()
  expect(() => { assertWriterProjection(state) }).not.toThrow()
  expect(() => { assertWriterProjection({ ...state, spec: { ...state.spec, maxEntities: 0 } }) }).toThrow(/population/)
  const foreign = { ...actual, teamId: teamIdSchema.parse('foreign') }
  for (const bad of [
    { ...own, participantReservation: { ...own.participantReservation!, binding: foreign } },
    { ...own, binding: foreign },
    { ...withoutReservation, binding: foreign },
  ]) expect(() => { assertWriterProjection({ ...state, entities: { [entityId]: bad } }) }).toThrow(/canonical|confirmed Team/)
  expect(() => {
    assertWriterProjection({ ...state, teamReservation: { ...state.teamReservation!, confirmed: false } })
  }).toThrow(/canonical reservation/)
  expect(() => { assertWriterProjection({ ...state, teamReservation: { ...state.teamReservation!, confirmed: false },
    entities: { [entityId]: { ...withoutReservation, binding: actual } } }) }).toThrow(/confirmed Team/)
  const other = simulationEntityIdSchema.parse('other')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: other, entityKind: 'person', cognition: 'agent', profile: {} }),
    run.snapshot().revision)
  await run.bindEntity(other, { teamId, participantId: participantIdSchema.parse('other'), sessionId: SessionId('other') },
    run.snapshot().revision)
  const spec = simulationChannelSpecSchema.parse({ key: 'work', members: [{ entityId, role: 'member' }, { entityId: other, role: 'member' }],
    limits: {} })
  await run.reserveChannel(spec, run.snapshot().revision)
  const channel = run.snapshot()
  expect(() => { assertWriterProjection(channel) }).not.toThrow()
  expect(() => { assertWriterProjection({ ...channel, entities: {} }) }).toThrow(/channel membership/)
  expect(() => {
    assertWriterProjection({ ...channel, teamReservation: { ...channel.teamReservation!, confirmed: false } })
  }).toThrow(/channel membership/)
})


describe.each(['json', 'sqlite'] as const)('%s historical writer authority', (backend) => {
  it('refuses a persisted late acceptance after writer retirement without admitting a run', async () => {
    const { createBusinessHarness } = await import('./business-harness.ts')
    const { acceptanceRecords } = await import('../src/decisions.ts')
    const { simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    const { lease } = await h.actor('actor')
    const decision = await lease.openDecision(simulationDecisionIdSchema.parse('late'), h.run.snapshot().revision)
    const records = acceptanceRecords(h.run.snapshot(), decision, [])
    await lease.revoke(); await lease.release()
    const state = h.run.snapshot()
    const stream = (h.run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
    const invalid = records.map((change, index) => ({ kind: 'run/business', runId: state.spec.runId,
      expectedRevision: state.revision + index, change }))
    await stream.append(state.revision, invalid)
    const tail = stream.tailSequence
    const read = await stream.read(state.revision, invalid.length)
    expect(read.map(entry => entry.value)).toEqual(invalid)
    await h.run.close()
    await expect(h.provider.open({ ...h.selection, mode: 'open' })).rejects.toThrow(/decision is not current/)
    expect(tail).toBe(state.revision + invalid.length)
  })
})
