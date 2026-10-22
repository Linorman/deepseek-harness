/** Manifest recovery through real Loader owners, with process-kill checkpoints. */
import assert from 'node:assert/strict'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { StreamChunk } from '@clocky/clocky-llm'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointRequestSchema, simulationCheckpointRestoreRequestSchema,
  simulationChangeSchema, simulationEntityIdSchema, simulationChannelSpecSchema, simulationDecisionIdSchema,
  simulationProposalSchema, simulationIngressRequestSchema, simulationWindowIdSchema, simulationContextRequestSchema, simulationResourceSpecSchema, simulationResourceIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'
import type {} from '@clocky/clocky-simulation-local'

const receivedId = simulationResourceIdSchema.parse('received')
const windowCase = process.env['RESTORE_WINDOW_CASE'] === 'true'
const windowId = simulationWindowIdSchema.parse('after-cut/window')
const slotA = simulationDecisionIdSchema.parse('after-cut/a'), slotB = simulationDecisionIdSchema.parse('after-cut/b')
const ctx = await boot('simulation-checkpoint-restore', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'open', spec: {
  runId: 'checkpoint-restore', tickUnit: 'hour', origin: '0', maxTime: '100', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 64,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 3, maxDecisionsPerWindow: 3, maxOperationsPerDecision: 16,
  maxResourceReservationHistory: 128,
  maxResourceQuantity: '10000', maxQueuedDecisions: 32, maxDispatchWaitRounds: 8,
  budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
  maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, maxPendingEvents: 100, maxPendingInteractions: 100,
  maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 16, relationRules: [],
} })
const command = simulationCheckpointRequestSchema.parse({ id: 'retained-cut', implementationVersion: 'restore-fixture-1',
  maxDrainRounds: 4, maxAttempts: 3 })
const request = simulationCheckpointRestoreRequestSchema.parse({ id: command.id,
  implementationVersion: command.implementationVersion, maxAttempts: 3 })
const hold = async (stage: string) => {
  if (process.env['RESTORE_CRASH'] !== stage) return
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
let run: SimulationRun | undefined
let observedRevision: number | undefined
let invalidNotification = false
ctx.on('simulation/committed', (snapshot, tail) => {
  if (snapshot.revision !== tail) invalidNotification = true
  else observedRevision = snapshot.revision
})
let modelCalls = 0
let publications = 0
const stream = ctx.llm.stream.bind(ctx.llm)
ctx.llm.stream = (...args) => { modelCalls += 1; return stream(...args) }
const a = simulationEntityIdSchema.parse('a'), b = simulationEntityIdSchema.parse('b'), dormant = simulationEntityIdSchema.parse('dormant')
try {
  if (process.env['RESTORE_MODE'] === 'create') {
    ctx.llm.registerAdapter(['restore-model'], new class extends LlmAdapter {
      async *stream(): AsyncGenerator<StreamChunk> {
        await hold('window-inference')
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }())
    run = await ctx.simulations.open({ ...selection, mode: 'create' })
    const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Recover a retained checkpoint', budgets: {} }, budgets: {} },
      'simulation/checkpoint-restore')
    const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/checkpoint-restore')
    for (const id of [a, b, dormant]) {
      await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
      await connection.ensureParticipant(id, { displayName: id, role: id, capabilities: [], provider: 'in-process', preset: 'simulation', model: 'unused/model' })
    }
    const activate = async (id: typeof a, kind: 'fresh' | 'resume') => {
      const lease = await connection.activate(id, { provider: 'in-process', seed: { kind }, agent: { preset: 'simulation', options: { provider: 'restore-model', model: 'scripted' } },
        signal: new AbortController().signal })
      assert.ok(lease.localAgent)
      assert.ok(await ctx.sessions.flush(lease.localAgent.session))
    }
    await activate(a, 'fresh'); await activate(b, 'fresh')
    const channel = await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'mail',
      members: [{ entityId: a, role: 'sender' }, { entityId: b, role: 'recipient' }], limits: {} }))
    if (windowCase) {
      for (const [id, quantity] of [['stock', '10'], ['received', '0']]) {
        await run.createResource(simulationResourceSpecSchema.parse({ id, owner: a, controllers: [a], kind: 'inventory', unit: 'item', quantity }),
          run.snapshot().revision)
      }
    }
    await run.setPhase('running', run.snapshot().revision)
    const decision = simulationDecisionIdSchema.parse('accepted-before-cut')
    await connection.openDecision(a, decision)
    await connection.submitDecision(a, decision, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'communication/post', recipient: b, channelId: channel.manifest.id, text: 'Retain this responsibility', deliverAt: '5',
    } })])
    assert.equal((await connection.checkpoint(command)).status, 'completed')
    for (const kind of ['missing-channel', 'missing-owner', 'empty-owner', 'foreign-owner']) {
      const getTeam = ctx.teams.getTeam.bind(ctx.teams)
      ctx.teams.getTeam = async (...args) => {
        const current = await getTeam(...args)
        if (kind === 'missing-channel') return { ...current, channelIds: [] }
        const rules = { ...current.rules }
        if (kind === 'missing-owner') delete rules['activationLifecycleOwner']
        else rules['activationLifecycleOwner'] = kind === 'empty-owner' ? '' : 'simulation/foreign'
        return { ...current, rules }
      }
      try {
        const result = await connection.checkpoint(simulationCheckpointRequestSchema.parse({ ...command, id: `refuse/${kind}` }))
        assert.equal(result.status, 'failed')
        if (result.status !== 'failed') throw new Error('Invalid owner was published')
        assert.equal(result.error, kind === 'missing-channel' ? 'Checkpoint run has a confirmed channel missing from its Team'
          : 'Checkpoint Team has another lifecycle owner')
        assert.equal(run.snapshot().latestCheckpointId, command.id)
      } finally { ctx.teams.getTeam = getTeam }
    }
    await hold('checkpoint-published')
    await activate(a, 'resume'); await activate(b, 'resume'); await activate(dormant, 'fresh')
    await run.setPhase('running', run.snapshot().revision)
    await connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
    await run.ingest(simulationIngressRequestSchema.parse({ id: 'after-cut', entityId: a, source: 'test', text: 'Preserve suffix input', availableAt: '5' }))
    await hold('suffix-written')
    if (windowCase) {
      const wakeId = Object.values(run.snapshot().wakes).find(wake => wake.entityId === b && wake.status === 'pending')?.eventId
      assert.ok(wakeId)
      const context = simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 0,
        personaVersion: 'restore-1', modelVersion: 'restore-1', sources: [],
        sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
          blocks: [{ type: 'text', text: kind }] })),
      })
      await connection.openWindow({ id: windowId, decisions: [
        { id: slotA, entityId: a, context }, { id: slotB, entityId: b, context, wakeId },
      ] })
      await hold('window-opened')
      if (process.env['RESTORE_CRASH'] === 'window-inference') await connection.executeDecision(a, slotA, context)
      await connection.submitDecision(a, slotA, [simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', grants: [],
        transaction: { commitmentId: null, reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
          transfers: [{ from: 'stock', to: 'received', quantity: '1' }] } } })])
      await hold('window-submitted')
      assert.equal((await run.commitWindow(windowId)).status, 'collecting')
      await hold('window-partial')
    }
    await run.close()
  }
  const prefix = ctx.sessionPersistence.getPersistencePrefix.bind(ctx.sessionPersistence)
  ctx.sessionPersistence.getPersistencePrefix = async (...args) => {
    const result = await prefix(...args)
    await hold('restore-prefix')
    return result
  }
  const recover = ctx.teamActivations.recoverCoordinatedLocal.bind(ctx.teamActivations)
  ctx.teamActivations.recoverCoordinatedLocal = async (...args) => {
    await recover(...args)
    await hold('restore-writer')
  }
  const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
  ctx.teams.postChannelEnvelope = (...args) => { publications += 1; return post(...args) }
  const open = ctx.simulations.open.bind(ctx.simulations)
  ctx.simulations.open = async (...args) => {
    const opened = await open(...args)
    const commit = opened.commitWindow.bind(opened)
    opened.commitWindow = async (...input) => {
      const result = await commit(...input)
      await hold('restore-window')
      return result
    }
    return opened
  }
  let writerRefusals = 0
  for (const damage of ['missing', 'session', 'participant']) {
    const getTeam = ctx.teams.getTeam.bind(ctx.teams)
    ctx.teams.getTeam = async (...args) => {
      const team = await getTeam(...args)
      const first = team.activations[0]!
      const other = team.activations.find(value => value.activation.participantId !== first.activation.participantId)!
      return { ...team, activations: damage === 'missing'
        ? team.activations.filter(value => value.activation.participantId !== first.activation.participantId)
        : team.activations.map(value => value.activation.participantId !== first.activation.participantId ? value
          : damage === 'session' ? { ...value, sessionId: other.sessionId }
            : { ...value, activation: { ...value.activation, participantId: other.activation.participantId } }) }
    }
    try {
      await assert.rejects(ctx.simulationTeams.restore(selection, request), /Checkpoint writer has no matching retained Team activation/)
      assert.equal(modelCalls, 0)
      assert.equal(publications, 0)
      writerRefusals += 1
    } finally { ctx.teams.getTeam = getTeam }
  }
  const inspection = await ctx.simulations.open(selection)
  const inspected = inspection.snapshot()
  await inspection.close()
  let publicationRefusals = 0
  if (Object.values(inspected.operations).some(operation => operation.outbox?.receipt !== undefined)) {
    const read = ctx.teams.readChannelPage.bind(ctx.teams)
    ctx.teams.readChannelPage = async (...args) => {
      const page = await read(...args)
      return { ...page, records: page.records.filter(record => record.type !== 'channel/envelope') }
    }
    try {
      await assert.rejects(ctx.simulationTeams.restore(selection, request), /no retained Envelope/)
      assert.equal(modelCalls, 0)
      assert.equal(publications, 0)
      const unchanged = await ctx.simulations.open(selection)
      try { assert.deepEqual(unchanged.snapshot(), inspected) }
      finally { await unchanged.close() }
      publicationRefusals += 1
    } finally { ctx.teams.readChannelPage = read }
  }
  const restored = await ctx.simulationTeams.restore(selection, request)
  run = restored.run
  const state = run.snapshot()
  assert.equal(state.phase, 'paused')
  assert.equal(observedRevision, state.revision)
  assert.equal(invalidNotification, false)
  assert.equal(modelCalls, 0)
  assert.equal(publications, 0)
  assert.ok(Object.values(state.entities).every(entity => entity.writer === undefined || entity.writer.phase === 'released'))
  assert.equal(Object.keys(state.operations).length, state.decisions[slotA]?.status === 'accepted' ? 2 : 1)
  if (windowCase) {
    assert.equal(state.activeWindowId, undefined)
    assert.equal(state.windows?.[windowId]?.status, 'closed')
    assert.equal(state.decisions[slotB]?.status, 'cancelled')
    assert.equal(state.resources[receivedId]?.quantity, '0')
  }
  const operation = Object.values(state.operations)[0]!
  const dormantId = state.entities[dormant]!.binding!.sessionId
  const windowRecovery = windowCase ? { status: state.windows?.[windowId]?.status,
    accepted: state.decisions[slotA]?.status === 'accepted',
    retainedSubmission: state.decisions[slotA]?.submission !== undefined,
    pendingTokens: Object.keys(state.tokenReservations ?? {}).length, chargedTokens: run.budgetUsage().tokens.used } : undefined
  if (windowRecovery?.pendingTokens) assert.ok(windowRecovery.chargedTokens >= state.spec.tokensPerModelRequest)
  const recovered = { ...windowRecovery === undefined ? {} : { windowRecovery },
    ownerRefusals: Object.values(state.checkpoints ?? {}).filter(value => value.request.id.startsWith('refuse/') && value.status === 'failed').length,
    writerRefusals, publicationRefusals, committedNotificationValid: true, phase: state.phase, time: state.time, modelCalls, publications,
    manifestSessions: restored.manifest.sessions.map(value => value.kind).sort(),
    dormantMaterialized: !await ctx.sessionPersistence.isUnmaterialized(dormantId),
    operation: { status: operation.status, receipt: operation.delivery?.receipt !== undefined },
    writersReleased: Object.values(state.entities).filter(entity => entity.writer?.phase === 'released').length,
    ingressRetained: Object.keys(state.ingresses ?? {}).length, pendingWakes: Object.values(state.wakes).filter(value => value.status === 'pending').length }
  for (const id of [a, b]) {
    await restored.connection.activate(id, { provider: 'in-process', seed: { kind: 'resume' }, agent: { preset: 'simulation', options: {} },
      signal: new AbortController().signal })
  }
  await run.setPhase('running', run.snapshot().revision)
  await restored.connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
  if (windowCase) {
    const wakeId = Object.values(run.snapshot().wakes).find(wake => wake.entityId === b && wake.status === 'pending')?.eventId
    assert.ok(wakeId)
    const retry = simulationDecisionIdSchema.parse('continued-recipient')
    await restored.connection.openDecision(b, retry, wakeId)
    await restored.connection.submitDecision(b, retry, [])
    await restored.connection.drive({ until: simTimeSchema.parse('5') }, () => 100)
    assert.equal(run.snapshot().resources[receivedId]?.quantity, state.decisions[slotA]?.status === 'accepted' ? '1' : '0')
  }
  const continued = Object.values(run.snapshot().operations)[0]!
  assert.equal(continued.status, 'applied')
  assert.ok(continued.delivery?.receipt)
  assert.equal(modelCalls, 0)
  assert.equal(publications, operation.status === 'pending' ? 1 : 0)
  console.log(JSON.stringify({ ...recovered, continued: { status: continued.status, newPublications: publications } }))
} finally { await run?.close(); await ctx.fiber.dispose() }
