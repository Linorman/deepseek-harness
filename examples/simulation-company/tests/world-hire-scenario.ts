import { LongitudinalMetrics } from '../../../packages/simulation/simulation-local/tests/longitudinal-metrics.ts'
import { recordR06Cut } from './world-r06-observation.ts'
import { simulationWorldReadSetSchema } from '@clocky/clocky-simulation'
import { simulationWorldHirePlanPayloadSchema } from '@clocky/clocky-simulation'
import { seedHiringIntent } from './world-domain-input.ts'
import { WORLD_GENERATE_AND_HIRE_PIN } from '@clocky/clocky-simulation'
/** Real Loader three-tool plan followed by Native reservation, owner quiescence and atomic hire settlement. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { z } from 'zod'
import {
  simulationChangeSchema, simulationChannelSpecSchema, simulationContextRequestSchema, simulationDecisionIdSchema,
  simulationEntityIdSchema, simulationHireIntentRequestSchema, simulationRunSelectionSchema,
  simulationWorldDefinitionSchema, simulationCheckpointRequestSchema, simulationCheckpointRestoreRequestSchema, simTimeSchema,
  simulationWorldHireReserveRequestSchema, simulationWorldHireReservationSchema, simulationWorldResultSchema,
  simulationWorldCancelRequestSchema,
  simulationWorldResolveOperationSchema, worldPlanIdSchema,
  simulationRelationIdSchema, simulationWorldHireCommittedResultPayloadSchema,
} from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'
import { requests } from './world-protocol-model.ts'

const ctx = await boot('world-protocol', process.argv[2]!)
const metrics = process.env.WORLD_B1_METRICS === 'true' ? new LongitudinalMetrics(ctx) : undefined
const recovering = process.env.WORLD_HIRE_RECOVER === 'true'
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'world-hire-company', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536,
  maxEntities: 16, maxResidentActors: 2, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100',
  maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100, maxPendingEvents: 100, maxPendingInteractions: 100,
  maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 100, maxDispatchWaitRounds: 8,
  maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '10000',
  relationRules: [
    { relation: 'can-hire', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: true },
    { relation: 'assignment', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: true },
  ],
} })
const checkpoint = simulationCheckpointRequestSchema.parse({ id: 'world-initial', implementationVersion: 'world-protocol/1',
  maxDrainRounds: 4, maxAttempts: 3 })
const restored = recovering ? await ctx.simulationTeams.restore(selection, simulationCheckpointRestoreRequestSchema.parse({
  id: checkpoint.id, implementationVersion: checkpoint.implementationVersion, maxAttempts: 3,
})) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
let connection = restored?.connection
const requester = simulationEntityIdSchema.parse('requester')
const director = simulationEntityIdSchema.parse('director')
const requesterEmploymentId = simulationRelationIdSchema.parse('requester-employment')
const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-hire-identities.json')
const context = () => simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 4,
  personaVersion: '1', modelVersion: 'scripted-1', sources: [],
  sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
    blocks: [{ type: 'text', text: kind }] })),
})
try {
  if (!recovering) {
    const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Staff one company position', budgets: {} }, budgets: {}, limits: ctx.teams.getCreationLimits() },
      'simulation/world-company')
    const teamId = team.team.id
    connection = await ctx.simulationTeams.attach(run, teamId, 'simulation/world-company')
    for (const [id, entityKind, cognition] of [
      [requester, 'person', 'agent'], [director, 'person', 'agent'], ['organization', 'organization', 'none'], ['position', 'position', 'none'], ['requester-role', 'position', 'none'],
    ]) {
      await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind, cognition, readiness: 'ready', profile: {} }),
        run.snapshot().revision)
    }
    for (const id of [requester, director]) {
      await connection.ensureParticipant(id, { displayName: id, role: id, capabilities: [], provider: 'in-process',
        preset: 'simulation', model: 'world-scripted/scripted' })
    }
    await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'hiring-private',
      members: [{ entityId: requester, role: 'requester' }, { entityId: director, role: 'director' }], limits: {} }))
    await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'hiring-authority', subject: requester,
      relation: 'can-hire', object: 'position', scope: 'organization', validFrom: '0', validUntil: null }), run.snapshot().revision)
    await run.configureWorld(simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], operations: [WORLD_GENERATE_AND_HIRE_PIN], operationGrants: ([{ requesterEntityId: requester, positionEntityId: 'position', relationId: 'hiring-authority' }]).map(value => ({ requesterEntityId: value.requesterEntityId, domain: WORLD_GENERATE_AND_HIRE_PIN.domain, operation: WORLD_GENERATE_AND_HIRE_PIN.operation, version: WORLD_GENERATE_AND_HIRE_PIN.version, scopeEntityId: 'organization', targetEntityId: value.positionEntityId, relationId: value.relationId, relation: 'can-hire' })),  directorEntityId: director, organizationEntityId: 'organization',
      positions: [{ entityId: 'position', capacity: 1 }],
      authorizations: [{ requesterEntityId: requester, positionEntityId: 'position', relationId: 'hiring-authority' }],
      templates: [{ id: 'researcher', version: '1', names: ['Lin'], skills: ['analysis'], traits: ['patient'], goals: ['research'],
        description: 'A research colleague.' }], policyVersion: '1',
      limits: { maxRequests: 10,
        maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: 10,
        maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 4096, maxBytesPerPlan: 4096 },
    }), run.snapshot().revision)
    await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'requester-employment', subject: requester,
      relation: 'assignment', object: 'requester-role', scope: 'organization', validFrom: '0', validUntil: null }), run.snapshot().revision)
    const intent = await seedHiringIntent(run, simulationHireIntentRequestSchema.parse({ organizationEntityId: 'organization',
      positionEntityId: 'position', requesterEntityId: requester, applicationId: 'research-application' }), 'We need a research colleague.')
    assert.equal((await connection.checkpoint(checkpoint)).status, 'completed')
    const leases = []
    for (const id of [requester, director]) {
      leases.push(await connection.activate(id, { provider: 'in-process', seed: { kind: 'fresh' },
        agent: { options: { provider: 'world-scripted', model: 'scripted' } }, signal: new AbortController().signal }))
    }
    await run.setPhase('running', run.snapshot().revision)
    await connection.executeDecision(requester, simulationDecisionIdSchema.parse('request'),
      { ...context(), world: { kind: 'request', intentId: intent.id } })
    const request = Object.values(run.snapshot().world!.requests)[0]!
    await run.drive({ until: simTimeSchema.parse('0') })
    assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    await connection.dispatchOperation(request.notificationOperationId, () => 100)
    const wake = await connection.receiveOperation(request.notificationOperationId)
    await run.drive({ until: simTimeSchema.parse('0') })
    await connection.executeDecision(director, simulationDecisionIdSchema.parse('resolve'),
      { ...context(), world: { kind: 'resolve', requestId: request.id } }, wake)
    const plan = Object.values(run.snapshot().world!.plans)[0]!
    const toolResults = leases[1]!.localAgent!.session.events.filter(event => event.type === 'tool/result')
    const result = toolResults.at(-1)?.data.message.content.find(block => block.type === 'tool-result')
    assert.equal(result?.isError, false)
    assert.deepEqual(result?.content, [{ type: 'text', text: JSON.stringify({ status: 'accepted',
      operationIds: run.snapshot().decisions[simulationDecisionIdSchema.parse('resolve')]?.operationIds, effects: 'pending' }) }])
    assert.equal(plan.proposal.resolution.kind, 'apply')
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('Hire probe requires its actual accepted apply plan')
  }
  assert.ok(connection)
  const plan = Object.values(run.snapshot().world!.plans)[0]!
  assert.equal(plan.status, 'accepted')
  if (plan.proposal.resolution.kind !== 'apply') throw new Error('Hire replay lost its actual accepted apply plan')
  const planProof = { id: plan.id, hash: plan.hash, proposal: plan.proposal, reads: plan.reads }
  const proofSchema = z.strictObject({
    plan: z.strictObject({ id: worldPlanIdSchema, hash: z.string().min(1), proposal: simulationWorldResolveOperationSchema,
      reads: simulationWorldReadSetSchema }),
    input: simulationWorldHireReserveRequestSchema, reservation: simulationWorldHireReservationSchema.optional(),
    result: simulationWorldResultSchema.optional(), finishedRevision: z.number().int().nonnegative().optional(),
  })
  if (!recovering) {
    const input = simulationWorldHireReserveRequestSchema.parse({ planId: plan.id,
      maintenance: { id: 'world-hire-owner', owner: 'loader-world-hire' }, member: { displayName: simulationWorldHirePlanPayloadSchema.parse(plan.proposal.resolution.payload).persona.name,
        role: 'member', capabilities: [], provider: 'in-process', preset: 'simulation', model: 'world-scripted/scripted', modelVersion: '1' } })
    await writeFile(proofPath, JSON.stringify(proofSchema.parse({ plan: planProof, input })))
  }
  const original = proofSchema.parse(JSON.parse(await readFile(proofPath, 'utf8')))
  assert.deepEqual(planProof, original.plan)
  const prefix = run.snapshot(), originalReservation = Object.values(prefix.world!.reservations)[0]
  if (original.reservation !== undefined) {
    assert.ok(originalReservation)
    assert.deepEqual(originalReservation.identities, original.reservation.identities)
    assert.deepEqual(originalReservation.request, original.reservation.request)
    assert.equal(originalReservation.sequence, original.reservation.sequence)
  }
  if (original.result !== undefined) assert.deepEqual(prefix.world!.results[original.result.id], original.result)
  if (original.finishedRevision !== undefined) assert.equal(prefix.revision, original.finishedRevision)
  if (recovering) { assert.equal(prefix.phase, 'paused'); assert.equal(requests.length, 0) }
  const save = async (finished = false) => {
    const state = run.snapshot(), reservation = Object.values(state.world!.reservations)[0], result = Object.values(state.world!.results)[0]
    await writeFile(proofPath, JSON.stringify(proofSchema.parse({ plan: original.plan, input: original.input,
      ...reservation === undefined ? {} : { reservation }, ...result === undefined ? {} : { result },
      ...finished ? { finishedRevision: state.revision } : {} })))
  }
  const hold = async (stage: string) => {
    if (recovering || process.env.WORLD_HIRE_CRASH !== stage) return
    await save()
    await recordR06Cut(ctx, run, selection, 'barrier')
    process.send?.('durable')
    await new Promise<void>((done) => { process.once('message', () => { done() }) })
  }
  await hold('accepted-before-reserve')
  const input = original.input, reservation = await run.reserveWorldHire(input)
  if (original.reservation !== undefined) assert.deepEqual(reservation.identities, original.reservation.identities)
  await hold('reserve-before-prep')
  await connection.quiesceForMaintenance(input.maintenance, 4, 3)
  const preparing = reservation.status === 'cancel-requested' || reservation.status === 'abandoned'
    ? reservation : await run.prepareWorldHire(reservation.id)
  assert.deepEqual(preparing.identities, reservation.identities)
  const id = preparing.identities.entityId
  if (preparing.status !== 'committed' && preparing.status !== 'abandoned') assert.equal(run.snapshot().entities[id]?.readiness, 'preparing')
  if (!recovering) {
    const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
    ctx.teams.inviteParticipant = async (...args) => {
      const member = await invite(...args)
      if (member.id === preparing.identities.binding.participantId) await hold('participant-afterIO')
      return member
    }
  }
  const { modelVersion: _version, ...member } = preparing.request.member
  const cancellationStage = process.env.WORLD_HIRE_CANCEL
  if (cancellationStage !== undefined) {
    const coordinator = connection
    assert.ok(['before-invite', 'after-invite', 'after-channel'].includes(cancellationStage))
    const cancelInput = simulationWorldCancelRequestSchema.parse({ id: 'withdraw-original-preparation', requestId: plan.requestId })
    const cancel = async () => { assert.equal((await run.cancelWorldCase(cancelInput)).status, 'cancel-requested') }
    if (!recovering) {
      if (cancellationStage === 'before-invite') await cancel()
      if (cancellationStage === 'after-invite') {
        const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
        ctx.teams.inviteParticipant = async (...args) => { const target = await invite(...args); await cancel(); return target }
      }
      if (cancellationStage !== 'after-channel') {
        await assert.rejects(async () => await coordinator.ensureParticipant(id, member), { code: 'SIM_WORLD_CONFLICT' })
      } else {
        assert.deepEqual(await coordinator.ensureParticipant(id, member), reservation.identities.binding)
        const open = ctx.teams.openChannel.bind(ctx.teams)
        ctx.teams.openChannel = async (...args) => { const target = await open(...args); await cancel(); return target }
        const selected = reservation.identities.channels[1]
        const spec = simulationChannelSpecSchema.parse({ key: selected.key,
          members: [{ entityId: id, role: 'member' }, { entityId: requester, role: 'requester' }], limits: {} })
        await assert.rejects(async () => await coordinator.ensureChannel(spec), { code: 'SIM_WORLD_CONFLICT' })
        for (const entityId of [id, requester]) {
          await assert.rejects(async () => await coordinator.acknowledgeInvitation(entityId, selected.channelId), { code: 'SIM_WORLD_CONFLICT' })
        }
        const admission = await ctx.teams.getChannelAdmission({ channelId: selected.channelId })
        assert.ok(admission.invitations.every(value => value.status === 'pending'))
        assert.equal(run.snapshot().channelReservations![selected.key]?.confirmed, false)
      }
    }
    if (process.env.WORLD_HIRE_CLEANUP === 'true') {
      if (!recovering) {
        const phase = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
        ctx.teams.transitionParticipantPhase = async (...args) => {
          const target = await phase(...args)
          if (target.id === reservation.identities.binding.participantId && target.phase === 'left') await hold('cleanup-member-afterIO')
          return target
        }
        const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream
        const append = stream.append.bind(stream)
        stream.append = async (...args) => {
          const cleanup = args[1].some(value => (value as { change?: { kind?: string } }).change?.kind === 'hire/abandoned')
          if (cleanup) await hold('cleanup-before-append')
          const receipt = await append(...args)
          if (cleanup) await hold('cleanup-after-append')
          return receipt
        }
      }
      const receipt = await coordinator.cancelWorldCase(cancelInput)
      assert.equal(receipt.status, 'cancelled')
      if (original.finishedRevision === undefined) {
        await run.finishMaintenance(input.maintenance)
        assert.equal(run.snapshot().phase, 'paused')
        await run.setPhase('running', run.snapshot().revision)
        await run.setPhase('paused', run.snapshot().revision)
      }
      const state = run.snapshot(), settled = state.world!.reservations[reservation.id]!
      assert.equal(settled.status, 'abandoned')
      assert.ok(settled.cleanup)
      assert.deepEqual(settled.identities, reservation.identities)
      assert.equal(state.entities[id]?.readiness, 'abandoned')
      assert.equal(state.entities[id]?.phase, 'terminated')
      assert.equal(Object.keys(state.world!.results).length, 1)
      assert.equal(Object.values(state.relations).filter(value => value.relation === 'assignment').length, 1)
      assert.deepEqual(state.relations[requesterEmploymentId], { id: requesterEmploymentId, subject: requester,
        relation: 'assignment', object: 'requester-role', scope: 'organization', validFrom: '0', validUntil: null, revision: 1 })
      assert.equal(Object.values(state.relations).filter(value => value.relation === 'assignment' && value.object === 'position').length, 0)
      const result = state.world!.results[receipt.resultId!]!
      assert.deepEqual(result.outcome, { kind: 'cancelled' })
      assert.equal(Object.values(state.scheduledEvents).filter(value => value.id === `simulation-world-result:${result.id}`).length, 1)
      const team = await ctx.teams.getTeam({ teamId: reservation.identities.binding.teamId })
      const participant = team.participants.find(value => value.id === reservation.identities.binding.participantId)
      assert.equal(participant?.phase, cancellationStage === 'before-invite' ? undefined : 'left')
      const revision = state.revision
      assert.deepEqual(await coordinator.cancelWorldCase(cancelInput), receipt)
      assert.deepEqual(await run.settleWorldHireCancellation(reservation.id), result)
      assert.equal(run.snapshot().revision, revision)
      assert.equal(requests.length, recovering ? 0 : 6)
      await save(true)
      console.log(JSON.stringify({ ...metrics === undefined ? {} : { metrics: metrics.sample(state) },
        phase: state.phase, cancellation: receipt.status, reservation: settled.status,
        participant: participant?.phase ?? 'absent', bound: state.entities[id]?.binding !== undefined,
        channels: team.channelIds.length, assignments: 0, results: 1, identitiesPreserved: true,
        cleanupEvidence: true, resultWakes: 1, exactRetry: true, modelCalls: requests.length }))
    } else {
      const state = run.snapshot(), receipt = await run.cancelWorldCase(cancelInput)
      assert.equal(run.snapshot().revision, state.revision)
      await assert.rejects(async () => await coordinator.ensureParticipant(id, member), { code: 'SIM_WORLD_CONFLICT' })
      await assert.rejects(run.commitWorldHire(reservation.id))
      await assert.rejects(run.finishMaintenance(input.maintenance), /unresolved preparation/)
      assert.deepEqual(state.world!.reservations[reservation.id]?.identities, reservation.identities)
      assert.equal(state.entities[id]?.readiness, 'preparing')
      assert.equal(state.world!.requests[plan.requestId]?.status, 'cancel-requested')
      assert.equal(Object.keys(state.world!.results).length, 0)
      assert.equal(Object.values(state.relations).filter(value => value.relation === 'assignment').length, 1)
      assert.deepEqual(state.relations[requesterEmploymentId], { id: requesterEmploymentId, subject: requester,
        relation: 'assignment', object: 'requester-role', scope: 'organization', validFrom: '0', validUntil: null, revision: 1 })
      assert.equal(Object.values(state.relations).filter(value => value.relation === 'assignment' && value.object === 'position').length, 0)
      assert.equal(state.phase, 'paused')
      const team = await ctx.teams.getTeam({ teamId: reservation.identities.binding.teamId })
      const target = team.participants.find(value => value.id === reservation.identities.binding.participantId)
      assert.equal(target?.phase, cancellationStage === 'before-invite' ? undefined : cancellationStage === 'after-invite' ? 'invited' : 'active')
      assert.equal(requests.length, 6)
      console.log(JSON.stringify({ ...metrics === undefined ? {} : { metrics: metrics.sample(state) },
        phase: state.phase, cancellation: receipt.status,
        reservation: state.world!.reservations[reservation.id]?.status,
        participant: target?.phase ?? 'absent', bound: state.entities[id]?.binding !== undefined,
        channels: team.channelIds.length, assignments: 0, results: 0, identitiesPreserved: true, exactRetry: true,
        modelCalls: requests.length }))
    }
  } else {
    assert.deepEqual(await connection.ensureParticipant(id, member), reservation.identities.binding)
    for (const channel of preparing.identities.channels) {
      const ready = await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: channel.key,
        members: [{ entityId: id, role: 'member' }, { entityId: channel.purpose === 'director' ? director : requester, role: channel.purpose }],
        limits: {} }))
      assert.equal(ready.manifest.id, channel.channelId)
    }
    await hold('commit-before')
    const committed = await run.commitWorldHire(reservation.id)
    assert.deepEqual(committed.outcome, { kind: 'committed' })
    assert.deepEqual(simulationWorldHireCommittedResultPayloadSchema.parse(committed.payload),
      { entityId: id, relationId: reservation.identities.relationId })
    if (original.result !== undefined) assert.deepEqual(committed, original.result)
    await hold('commit-after')
    await run.finishMaintenance(input.maintenance)
    const state = run.snapshot(), world = state.world!
    assert.equal(state.phase, 'paused')
    assert.equal(state.entities[id]?.readiness, 'ready')
    const persona = simulationWorldHirePlanPayloadSchema.parse(plan.proposal.resolution.payload).persona
    assert.deepEqual(state.entities[id]?.profile, { name: persona.name, description: 'A research colleague.', persona })
    assert.deepEqual(state.entities[id]?.binding, reservation.identities.binding)
    assert.equal(await ctx.sessionPersistence.isUnmaterialized(reservation.identities.binding.sessionId), true)
    assert.equal(Object.keys(world.reservations).length, 1)
    assert.equal(Object.keys(world.results).length, 1)
    assert.equal(Object.values(state.relations).filter(relation => relation.relation === 'assignment').length, 2)
    assert.deepEqual(state.relations[requesterEmploymentId], { id: requesterEmploymentId, subject: requester,
      relation: 'assignment', object: 'requester-role', scope: 'organization', validFrom: '0', validUntil: null, revision: 1 })
    assert.deepEqual(state.relations[reservation.identities.relationId], { id: reservation.identities.relationId,
      subject: id, relation: 'assignment', object: 'position', scope: 'organization', validFrom: committed.time,
      validUntil: null, revision: 1 })
    assert.equal(Object.keys(state.entities).length, 6)
    assert.equal(Object.values(state.entities).filter(entity => entity.cognition === 'agent').length, 3)
    assert.equal(run.population().chargedActors, 0)
    const first = Object.values(state.scheduledEvents).filter(event => event.id.startsWith('simulation-world-first:'))
    const notified = Object.values(state.scheduledEvents).filter(event => event.id.startsWith('simulation-world-result:'))
    assert.equal(first.length, 1); assert.equal(notified.length, 1)
    assert.equal(first[0]!.status, 'pending'); assert.equal(notified[0]!.status, 'pending')
    assert.deepEqual(first[0]!.action, { kind: 'wake', entityId: id, reason: JSON.stringify({ resultId: committed.id }) })
    assert.deepEqual(notified[0]!.action, { kind: 'wake', entityId: requester, reason: JSON.stringify({ resultId: committed.id }) })
    const team = await ctx.teams.getTeam({ teamId: reservation.identities.binding.teamId })
    assert.equal(team.participants.length, 3)
    assert.equal(team.channelIds.length, 3)
    assert.equal(team.activations.some(binding => binding.sessionId === reservation.identities.binding.sessionId), false)
    for (const channel of reservation.identities.channels) {
      const admission = await ctx.teams.getChannelAdmission({ channelId: channel.channelId })
      assert.equal(admission.channel.phase, 'active')
      assert.ok(admission.invitations.every(invitation => invitation.status === 'acknowledged'))
    }
    const revision = state.revision
    assert.deepEqual(await run.reserveWorldHire(input), world.reservations[reservation.id])
    assert.deepEqual(await run.commitWorldHire(reservation.id), committed)
    assert.equal(run.snapshot().revision, revision)
    if (original.finishedRevision !== undefined) assert.equal(revision, original.finishedRevision)
    assert.equal(requests.length, recovering ? 0 : 6)
    await save(true)
    console.log(JSON.stringify({ ...metrics === undefined ? {} : { metrics: metrics.sample(state) },
      phase: state.phase, entities: Object.keys(state.entities).length,
      actors: Object.values(state.entities).filter(entity => entity.cognition === 'agent').length,
      reservations: Object.keys(world.reservations).length,
      assignments: Object.values(state.relations)
        .filter(relation => relation.relation === 'assignment' && relation.object === 'position').length,
      results: Object.keys(world.results).length,
      firstWakes: first.length, resultWakes: notified.length, persona,
      identitiesPreserved: true, newSessionMaterialized: false, atomicCommit: true, exactRetry: true,
      planPreserved: true, resultPreserved: true, prefixReserved: originalReservation !== undefined,
      prefixCommitted: original.result !== undefined, modelCalls: requests.length }))
  }
  await recordR06Cut(ctx, run, selection, 'final')
} finally { await run.close(); await ctx.fiber.dispose() }
