/** Terminal foreign-task provenance is captured from real held Hub sources, then bound to its original Native receipt. */
import { expect, it, vi } from 'vitest'
import { simulationPersonnelSettlementCutScopeSchema, teamTaskSnapshotSchema, taskLeaseSnapshotSchema, participantIdSchema,
  teamTaskCreateIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamSystemMaintenanceProof } from '@clocky/clocky-team'
import { personnelObligationQuerySchema, personnelTaskTerminalEvidenceSchema, personnelTerminalSourceFingerprint,
  personnelReservationSchema,
  simulationChangeSchema, simulationEntityIdSchema, simulationOperationIdSchema, simulationWorldDefinitionSchema,
  simulationWorldRoleIntentSchema, simulationWorldRequestOperationSchema, simulationWorldResolveOperationSchema,
  simulationRelationIdSchema, worldIntentIdSchema, worldRequestIdSchema, worldPlanIdSchema, WORLD_DEPART_PIN,
  WORLD_DEPART_DEFINITION, SimulationWorldDomainRegistry } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, NativeWorldDomain,
  SimulationWorldRequest, SimulationWorldPlan } from '@clocky/clocky-simulation'
import { taskExecutorFixture } from '../../simulation-product/tests/task-executor-fixture.ts'
import { companySettings } from '../../simulation-product/tests/company-driver-fixture.ts'
import { projectPersonnelTaskTerminalEvidence } from '../src/personnel-terminal.ts'
import { projectPersonnelObligations } from '../src/personnel-obligations.ts'
import { inspectPersonnelObligations } from '../../simulation-local/src/personnel-obligations.ts'
import { foldPersonnel, personnelRecordSchema, personnelDomainOwner,
  validatePersonnelTerminalTasks } from '../../simulation-local/src/world-personnel.ts'
import { foldEntityChange } from '../../simulation-local/src/entities.ts'
import { NativeWorldRuntime } from '../../simulation-local/src/world-runtime.ts'
import { DepartNativeWorldDomain } from '../../simulation-local/src/world-personnel-domain.ts'
import { businessFingerprint } from '../../simulation-local/src/business.ts'

const buyerId = simulationEntityIdSchema.parse('buyer')
async function setup(backend: 'json' | 'sqlite', phase: 'pending' | 'cancelled' | 'completed' = 'cancelled') {
  const h = await taskExecutorFixture(backend)
  try {
    await h.start()
    const buyer = h.run.snapshot().entities[buyerId]!
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: buyerId,
      entityRevision: buyer.revision, profile: { private: 'PERSONNEL-TERMINAL-PROFILE-CANARY' } }), h.run.snapshot().revision)
    const operation = await h.createTask(), receipt = operation.outbox?.taskReceipt
    if (receipt === undefined) throw new Error('Actual task creation did not retain its Native receipt')
    const pending = await h.ctx.teams.getTask({ teamId: receipt.teamId, taskId: receipt.taskId })
    if (phase === 'cancelled') await h.connection.cancelTask({ operationId: operation.id,
      expectedRevision: pending.revision, expectedAttemptId: null })
    else if (phase === 'completed') expect((await h.executor.advance()).reason).toBe('idle')
    if (phase !== 'pending') await h.connection.hibernate(buyerId)
    const state = h.run.snapshot(), person = state.entities[buyerId]!
    const query = personnelObligationQuerySchema.parse({ selector: { kind: 'person', personId: buyerId,
      personRevision: person.revision }, limit: 1024, maxBytes: 1048576 })
    const native = h.run.inspectPersonnelObligations(query)
    const team = await h.ctx.teams.getTeam({ teamId: receipt.teamId })
    const scope = simulationPersonnelSettlementCutScopeSchema.parse({ kind: 'simulation-personnel-cut', teamId: team.team.id,
      runId: state.spec.runId, lifecycleOwner: companySettings.ownerName, personnelIntentId: 'terminal-owner-boundary-unit',
      expectedTeamCursor: team.team.cursor, channels: await Promise.all(team.channelIds.map(async channelId => ({ channelId,
        cursor: (await h.ctx.teams.getChannel({ channelId })).cursor }))) })
    // Core owner-boundary proof only: no Actor/Human or Native personnel-commit authority is manufactured.
    const tokens = new WeakMap<TeamSystemMaintenanceProof, typeof scope>()
    const stop = h.ctx.teams.registerSystemMaintenanceProofSource({ name: 'terminal-owner-boundary-unit',
      resolveMaintenanceProof: candidate => tokens.get(candidate) })
    const token: object = { toJSON(): never { throw new TypeError('Terminal owner cut proof is runtime-only') } }
    const actor = Object.freeze(token) as TeamSystemMaintenanceProof
    tokens.set(actor, scope)
    try {
      const captured = await h.ctx.teams.withPersonnelSettlementCut({ actor, scope }, async sources => ({
        team: sources.team, terminalTasks: projectPersonnelTaskTerminalEvidence(state, sources.team, native),
        report: projectPersonnelObligations(state, native, { team: sources.team, complete: true,
          channels: sources.channels.map(({ channel, pending }) => ({ channel, deliveries: pending.flatMap(value =>
            value.senderId !== person.binding!.participantId && value.recipientId !== person.binding!.participantId ? [] : [{
              ...value,
              direction: value.recipientId === person.binding!.participantId ? 'incoming' as const : 'outgoing' as const }]) })) }, query),
      }))
      return { ...h, state, native, query, receipt, operation, scope, ...captured }
    } finally { tokens.delete(actor); stop() }
  } catch (error) { await h.close(); throw error }
}

/** Isolated replay prefix retains actual creation/receipt facts; this does not claim full Team/maintenance settlement authorization. */
function readyPrefix(original: SimulationSnapshot) {
  const person = original.entities[buyerId]!, assignmentId = simulationRelationIdSchema.parse('terminal-original-assignment')
  let state: SimulationSnapshot = { ...original, resources: {}, grants: {}, interactions: {}, commitments: {},
    scheduledEvents: {}, wakes: {}, spec: { ...original.spec, relationRules: [{ relation: 'assignment',
      subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false }] },
    entities: { ...original.entities, [buyerId]: { ...person, writer: { ...person.writer!, phase: 'released' } } } }
  for (const [name, kind] of [['terminal-org', 'organization'], ['terminal-position', 'position']]) {
    state = foldEntityChange(state, simulationChangeSchema.parse({ kind: 'entity/create', id: name,
      entityKind: kind, cognition: 'none', readiness: 'ready', profile: {} }))
  }
  state = foldEntityChange(state, simulationChangeSchema.parse({ kind: 'relation/create', id: assignmentId,
    subject: buyerId, object: 'terminal-position', scope: 'terminal-org', relation: 'assignment', validFrom: '0', validUntil: null }))
  const intentId = worldIntentIdSchema.parse('terminal-original-departure'),
    requestId = worldRequestIdSchema.parse('terminal-original-request')
  const planId = worldPlanIdSchema.parse('terminal-original-plan')
  const action = simulationWorldRequestOperationSchema.parse({ kind: 'world/request', domain: 'organization', operation: 'depart',
    version: '1', businessKey: 'original', expectedTime: null, evidence: [], payload: { organizationEntityId: 'terminal-org',
      personId: buyerId, assignmentId, assignmentRevision: 1, requestedEffectiveAt: null, description: 'Original departure',
      retire: false } })
  const { requestId: _requestId, ...parsed } = simulationWorldRoleIntentSchema.parse({ id: intentId, requestId, pin: WORLD_DEPART_PIN,
    businessKey: 'original', requesterEntityId: buyerId, scopeEntityId: 'terminal-org', targetEntityId: 'terminal-position',
    expectedTime: null, evidence: [],
    payload: action.payload, description: 'Original departure', sequence: state.revision })
  const intent = { ...parsed, requestId }, sourceDecision = Object.values(state.decisions).find(value => value.entityId === buyerId)!
  const request: SimulationWorldRequest = { id: requestId, intentId, requesterEntityId: buyerId, pin: WORLD_DEPART_PIN,
    operationId: simulationOperationIdSchema.parse('terminal-request-operation'),
    notificationOperationId: simulationOperationIdSchema.parse('terminal-notification'),
    proposal: action, description: 'Original departure', payloadHash: businessFingerprint(action), sequence: state.revision,
    plans: [planId], status: 'open', source: { kind: 'decision', decisionId: sourceDecision.id,
      epoch: sourceDecision.epoch, binding: person.binding! } }
  const proposal = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId, supersedes: null,
    resolution: { kind: 'apply', payload: action.payload, rationale: 'Original exact selection' } })
  const plan: SimulationWorldPlan = { id: planId, requestId, pin: WORLD_DEPART_PIN,
    operationId: simulationOperationIdSchema.parse('terminal-plan-operation'), proposal, reads: [], baseRevision: state.revision,
    sequence: state.revision, hash: businessFingerprint(proposal), status: 'accepted' }
  const reservation = personnelReservationSchema.parse({ id: intentId, requestId, personId: buyerId, binding: person.binding,
    assignmentId, assignmentRevision: 1, request: { planId, maintenance: { id: 'terminal-maintenance', owner: companySettings.ownerName } },
    targetPositionId: null, authorityGeneration: 0, closedAuthorityRelationIds: [], revokedAuthorityRelationIds: [],
    status: 'fenced', sequence: state.revision,
    updatedSequence: state.revision, actualEffectiveAt: null, evidence: null, terminalTasks: [] })
  state = { ...state, world: { executions: {},
    external: { identities: {}, interactions: {}, representatives: {}, contacts: {}, adjudications: {}, events: {} },
    definition: simulationWorldDefinitionSchema.parse({ positionRolePermissions: [],
      directorEntityId: 'supplier', organizationEntityId: 'terminal-org', operations: [WORLD_DEPART_PIN], operationGrants: [],
      authorizations: [], positions: [{ entityId: 'terminal-position', capacity: 1 }],
      templates: [{ id: 'finite', version: '1', names: ['Finite'], skills: [], traits: [], goals: [], description: 'Finite' }],
      policyVersion: '1', limits: { maxRequests: 16,
        maxBirthsPerInterval: 16, maxExternalExpansionsPerInterval: 16, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: 16,
        maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 } }),
    sequence: 1, channels: {}, intents: { [intentId]: intent }, requests: { [requestId]: request }, plans: { [planId]: plan },
    results: {}, cancellations: {}, reservations: {}, mutations: {}, facts: {}, evidence: { challenges: {}, revisions: {} },
    governance: { proposals: {}, votes: {}, resolutions: {} },
    norms: { versions: {}, closures: [], announcements: {} }, personnel: { reservations: { [intentId]: reservation },
      fences: { [intentId]: { assignmentId, personId: buyerId, intentId, requestId, generation: 1, sequence: state.revision,
        status: 'active' } },
      generations: { [buyerId]: 1 }, operationGrants: [] } } }
  const registry = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  const unregister = registry.register(WORLD_DEPART_DEFINITION, new DepartNativeWorldDomain(personnelDomainOwner))
  const runtime = new NativeWorldRuntime(registry)
  const query = personnelObligationQuerySchema.parse({ selector: { kind: 'assignment', personId: buyerId,
    personRevision: state.entities[buyerId]!.revision, assignmentId, assignmentRevision: 1 }, limit: 1024, maxBytes: 1048576 })
  return { state, runtime, query, intentId, async close() { runtime.close(); await unregister() } }
}

it.each(['json',
  'sqlite'] as const)('%s persists exact cancelled-task evidence from the held original Team cut without task or profile bodies', async (backend) => {
  const h = await setup(backend)
  try {
    const task = h.team.tasks.find(value => value.id === h.receipt.taskId)!
    expect(task.phase).toBe('cancelled')
    expect(task.lease).toBeUndefined()
    expect(h.terminalTasks).toEqual([{ teamId: task.teamId, taskId: task.id, revision: task.revision, phase: task.phase,
      runId: h.state.spec.runId, operationId: h.operation.id, creatorParticipantId: h.state.entities[buyerId]!.binding!.participantId,
      idempotencyKey: task.createCommand.idempotencyKey, fingerprint: h.receipt.fingerprint, teamCursor: h.team.team.cursor }])
    const persisted = JSON.parse(JSON.stringify(h.terminalTasks)) as unknown[]
    expect(persisted.map(value => personnelTaskTerminalEvidenceSchema.parse(value))).toEqual(h.terminalTasks)
    for (const changed of [{ ...h.terminalTasks[0], revision: 0 }, { ...h.terminalTasks[0], phase: 'pending' },
      { ...h.terminalTasks[0], teamCursor: -1 }, { ...h.terminalTasks[0], description: 'forged private body' }]) {
      expect(() => personnelTaskTerminalEvidenceSchema.parse(changed)).toThrow()
    }
    expect(JSON.stringify(persisted)).not.toContain('Transfer one stock unit')
    expect(JSON.stringify(persisted)).not.toContain('PERSONNEL-TERMINAL-PROFILE-CANARY')
    expect(h.native.items.some(value => value.ref.kind === 'task-target')).toBe(true)
    expect(h.report.items.some(value => value.ref.kind === 'task-target')).toBe(false)
    expect(h.report.items.some(value => value.ref.kind === 'resource')).toBe(true)
    expect(h.run.snapshot()).toEqual(h.state)
    expect(await h.ctx.teams.getTeam({ teamId: task.teamId })).toEqual(h.team)
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})

it('does not turn an actual pending task or a terminal observation retaining a lease into terminal owner evidence', async () => {
  const h = await setup('json', 'pending')
  try {
    expect(h.terminalTasks).toEqual([])
    expect(h.report.items.some(value => value.ref.kind === 'task-target')).toBe(true)
    const task = h.team.tasks.find(value => value.id === h.receipt.taskId)!
    // Pure owner-fault metadata: no attempt is persisted or assigned by this adversarial projection.
    const leased = { ...task, phase: 'cancelled' as const, lease: taskLeaseSnapshotSchema.parse({ attemptId: 'retained-attempt',
      assignedRevision: task.revision, ordinal: 1, participantId: h.state.entities[buyerId]!.binding!.participantId,
      assignedAt: 0, durationMs: 100, renewedAt: 0, expiresAt: 100 }), attemptCount: 1 }
    const team = { ...h.team, tasks: [leased] }
    expect(projectPersonnelTaskTerminalEvidence(h.state, team, h.native)).toEqual([])
    expect(projectPersonnelObligations(h.state, h.native, { team, channels: [], complete: true }, h.query)
      .items.some(value => value.ref.kind === 'task-target')).toBe(true)
  } finally { await h.close() }
})

it('captures an actual completed task at its exact settled revision while retaining independent Native responsibility', async () => {
  const h = await setup('json', 'completed')
  try {
    expect(h.terminalTasks).toHaveLength(1)
    expect(h.terminalTasks[0]).toMatchObject({ taskId: h.receipt.taskId, phase: 'completed', teamCursor: h.team.team.cursor })
    expect(h.report.items.some(value => value.ref.kind === 'resource')).toBe(true)
    expect(h.run.snapshot()).toEqual(h.state)
  } finally { await h.close() }
})

it('keeps a real unretired Native attempt unresolved after its actual Team task becomes cancelled', async () => {
  const h = await taskExecutorFixture('json')
  const release = Promise.withResolvers<undefined>()
  let completion: Promise<{ error?: unknown }> | undefined
  try {
    await h.start(); const operation = await h.createTask()
    vi.spyOn(h.connection, 'executeTaskDecision').mockRejectedValueOnce(new Error('before-original-task-input'))
    await expect(h.executor.advance()).rejects.toThrow('before-original-task-input')
    const execution = Object.values(h.run.snapshot().taskExecutions ?? {})[0]
    if (execution === undefined) throw new Error('Actual assignment did not reserve its Native attempt')
    const task = await h.ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
    const entered = Promise.withResolvers<undefined>(), originalRetire = h.run.retireTaskExecution.bind(h.run)
    vi.spyOn(h.run, 'retireTaskExecution').mockImplementationOnce(async (request) => {
      entered.resolve(undefined); await release.promise
      return await originalRetire(request)
    })
    completion = h.connection.cancelTask({ operationId: operation.id, expectedRevision: task.revision,
      expectedAttemptId: execution.request.attemptId }).then(() => ({}), (error: unknown) => ({ error }))
    await entered.promise
    const state = h.run.snapshot(), query = personnelObligationQuerySchema.parse({ selector: { kind: 'person',
      personId: execution.request.entityId, personRevision: state.entities[execution.request.entityId]!.revision },
    limit: 1024, maxBytes: 1048576 })
    const native = h.run.inspectPersonnelObligations(query), team = await h.ctx.teams.getTeam({ teamId: execution.request.teamId })
    expect(team.tasks.find(value => value.id === task.id)?.phase).toBe('cancelled')
    expect(projectPersonnelTaskTerminalEvidence(state, team, native)).toEqual([])
    const report = await h.connection.inspectPersonnelObligations(query)
    expect(report.items.some(value => value.ref.kind === 'task-execution')).toBe(true)
    expect(report.items.some(value => value.ref.kind === 'task-assignment')).toBe(true)
    expect(h.run.snapshot()).toEqual(state)
  } finally {
    release.resolve(undefined)
    const result = await completion
    vi.restoreAllMocks(); await h.close()
    if (result !== undefined && 'error' in result) throw result.error
  }
})

it('rejects mismatched original task creator, canonical key, accepted operation or immutable receipt fingerprint', async () => {
  const h = await setup('json')
  try {
    const task = h.team.tasks.find(value => value.id === h.receipt.taskId)!, creator = task.createCommand.creator
    if (!('kind' in creator)) throw new Error('Actual Simulation task lacks its immutable creator')
    for (const changed of [{ ...creator, runId: 'foreign-run' }, { ...creator, operationId: 'foreign-operation' },
      { ...creator, participantId: participantIdSchema.parse('foreign-creator') }]) {
      const parsed = teamTaskSnapshotSchema.parse({ ...task, createCommand: { ...task.createCommand, creator: changed } })
      expect(() => projectPersonnelTaskTerminalEvidence(h.state, { ...h.team, tasks: [parsed] }, h.native)).toThrow()
    }
    const wrongKey = { ...task, createCommand: { ...task.createCommand,
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('foreign-key') } }
    expect(() => projectPersonnelTaskTerminalEvidence(h.state, { ...h.team, tasks: [wrongKey] }, h.native)).toThrow()
    const altered = { ...h.state, operations: { ...h.state.operations, [h.operation.id]: { ...h.operation,
      outbox: { ...h.operation.outbox!, taskReceipt: { ...h.receipt, fingerprint: 'foreign-fingerprint' } } } } }
    expect(() => projectPersonnelTaskTerminalEvidence(altered, h.team, h.native)).toThrow()
    const decision = h.state.decisions[h.operation.decisionId]!
    expect(() => projectPersonnelTaskTerminalEvidence({ ...h.state, decisions: { ...h.state.decisions,
      [decision.id]: { ...decision, status: 'cancelled' } } }, h.team, h.native)).toThrow()
  } finally { await h.close() }
})

it('replays persisted terminal evidence against the original Native target and rejects omission, duplicates, foreign facts or cursor substitution', async () => {
  const h = await setup('json'), p = readyPrefix(h.state)
  try {
    const native = inspectPersonnelObligations(p.state, p.query, p.runtime)
    const terminalTasks = projectPersonnelTaskTerminalEvidence(p.state, h.team, native)
    const report = projectPersonnelObligations(p.state, native, { team: h.team, channels: [], complete: true }, p.query)
    if (report.coverage.team.kind !== 'observed') throw new Error('Actual held original source coverage was incomplete')
    const team = { ...report.coverage.team, hash: personnelTerminalSourceFingerprint(report.coverage.team, terminalTasks) }
    const record = personnelRecordSchema.parse({ kind: 'personnel/ready', id: p.intentId,
      team, terminalTasks })
    const ready = foldPersonnel(p.state, record, p.state.revision + 1, p.runtime)
    expect(ready.world!.personnel.reservations[p.intentId]!.terminalTasks).toEqual(terminalTasks)
    expect(ready.world!.personnel.reservations[p.intentId]!.evidence!.items.some(value => value.ref.kind === 'task-target')).toBe(false)
    const reloaded = personnelRecordSchema.parse(JSON.parse(JSON.stringify(record)))
    expect(foldPersonnel(p.state, reloaded, p.state.revision + 1, p.runtime)).toEqual(ready)
    const evidence = terminalTasks[0]!
    for (const changed of [[], [evidence, evidence], [{ ...evidence, operationId: 'foreign-operation' }],
      [{ ...evidence, fingerprint: `sha256:${'0'.repeat(64)}` }], [{ ...evidence, creatorParticipantId: 'foreign-creator' }],
      [{ ...evidence, teamCursor: evidence.teamCursor + 1 }]]) {
      // Origin checks must reject even if a forged durable record recomputes its public integrity hash.
      if (changed.length !== 0) expect(() => validatePersonnelTerminalTasks(p.state, team,
        changed.map(value => personnelTaskTerminalEvidenceSchema.parse(value)))).toThrow()
      expect(() => foldPersonnel(p.state, personnelRecordSchema.parse({ ...record, terminalTasks: changed }),
        p.state.revision + 1, p.runtime)).toThrow()
    }
    for (const changed of [[{ ...evidence, revision: evidence.revision + 1 }], [{ ...evidence, phase: 'failed' }]]) {
      expect(() => foldPersonnel(p.state, personnelRecordSchema.parse({ ...record, terminalTasks: changed }),
        p.state.revision + 1, p.runtime)).toThrow()
    }
    const blocked = { ...p.state, resources: h.state.resources }
    expect(() => foldPersonnel(blocked, record, blocked.revision + 1, p.runtime)).toThrow(/obligation|duties/)
    expect(h.run.snapshot()).toEqual(h.state)
  } finally { await p.close(); await h.close() }
})
