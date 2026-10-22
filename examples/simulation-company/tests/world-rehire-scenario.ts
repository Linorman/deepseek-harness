/** Real independent policy/approval votes hire an original person without allocating identity, memory or channels. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { simulationWorldDefinitionSchema, simulationRunSelectionSchema, simulationCheckpointIdSchema,
  simulationWakeRequestSchema, simulationWorldGoalSchema, simulationEntityIdSchema, simulationEventIdSchema,
  simulationDispatchCandidateSchema,
  simulationWorldHireExistingPayloadSchema, simulationWorldHireExistingCommittedResultPayloadSchema,
  WORLD_HIRE_EXISTING_PIN, WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN,
  WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, WORLD_NORM_ENACT_PIN, SimulationHireApprovalError, WORLD_DEPART_PIN,
  simulationWorldDepartPayloadSchema,
  simulationWorldDepartCommittedResultPayloadSchema, simulationChangeSchema, personnelRetired,
  projectPersonnelCounts, combinePersonnelCounts, personnelCountsSchema } from '@clocky/clocky-simulation'
import type { PersonnelCounts } from '@clocky/clocky-simulation'
import type { SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import { SimulationWorldDriver, GovernanceWorldExecution, NormWorldExecution,
  ExistingHireWorldExecution, PersonnelWorldExecution } from '@clocky/clocky-simulation-world'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests, modelInputs } from './world-rehire-model.ts'

const scenario = process.env.WORLD_SCENARIO
assert.ok(scenario === 'company' || scenario === 'laboratory')
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(`examples/simulation-company/scenarios/world-${scenario}.json`, 'utf8')))
const members = definition.actors.filter(value => value.role === 'member')
assert.equal(members.length, 2)
const [hr, candidate] = members
assert.ok(hr && candidate)
definition.initialEvents = []
definition.positions.push({ id: 'rehire-old-role', name: 'Original colleague role', capacity: 1 },
  { id: 'rehire-new-role', name: 'New rejoined role', capacity: 1 })
definition.assignments.push({ id: 'original-candidate-employment', personId: candidate.id, positionId: 'rehire-old-role' })
definition.authorizations = definition.authorizations.map(value => value.requesterId === hr.id
  ? { ...value, positionId: 'rehire-new-role' } : value)
const witness = { id: 'committee-witness', role: 'member' as const, template: hr.template }
definition.actors.push(witness)
definition.positions.push({ id: 'committee-work', name: 'Committee witness', capacity: 1 })
definition.assignments.push({ id: 'witness-employment', personId: witness.id, positionId: 'committee-work' })
const electorate = [hr, witness]
const installed = catalog()
// Reuse the existing-hire three-resident workload; real retirement settles the candidate's revision before approval freezes it.
installed.limits.defaults.native.maxResidentActors = 3
installed.limits.ceilings.native.maxResidentActors = 3
installed.runtimeProfiles[0]!.model = { provider: 'world-rehire-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
const original = compiled.resolved, organization = original.world.organizationEntityId, committee = 'existing-person-committee'
const permissions = [{ entityId: hr.id, pin: WORLD_GOVERNANCE_PROPOSE_PIN, relation: 'can-propose-norm' },
  { entityId: hr.id, pin: WORLD_NORM_ENACT_PIN, relation: 'can-enact-norm' },
  { entityId: hr.id, pin: WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, relation: 'can-approve-hire' },
  ...electorate.map(value => ({ entityId: value.id, pin: WORLD_GOVERNANCE_VOTE_PIN, relation: 'can-vote' }))]
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [WORLD_HIRE_EXISTING_PIN, WORLD_DEPART_PIN, WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN,
    WORLD_NORM_ENACT_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN],
  operationGrants: [...original.world.operationGrants.map(value => ({ ...value,
    domain: WORLD_HIRE_EXISTING_PIN.domain, operation: WORLD_HIRE_EXISTING_PIN.operation, version: WORLD_HIRE_EXISTING_PIN.version })),
  { requesterEntityId: hr.id, domain: WORLD_DEPART_PIN.domain, operation: WORLD_DEPART_PIN.operation, version: WORLD_DEPART_PIN.version,
    targetEntityId: 'rehire-old-role', scopeEntityId: organization, relation: 'can-depart', relationId: 'rehire-depart-permission' },
  ...permissions.map(value => ({ requesterEntityId: value.entityId, domain: value.pin.domain, operation: value.pin.operation,
    version: value.pin.version, targetEntityId: committee, scopeEntityId: organization, relation: value.relation,
    relationId: `permission:${value.relation}:${value.entityId}` }))],
  limits: { ...original.world.limits, maxRequests: 32,
    maxBirthsPerInterval: 32, maxExternalExpansionsPerInterval: 32, maxPendingMutations: 1,
    maxRequestsPerActorPerInterval: 32, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 } })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  native: { ...original.native, relationRules: [...original.native.relationRules,
    ...['committee-member', 'can-propose-norm', 'can-enact-norm', 'can-approve-hire', 'can-vote', 'eligible-for-hire']
      .map(relation => ({ relation, subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false })),
    { relation: 'can-depart', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false }] },
  entities: [...original.entities, { kind: 'entity/create', id: committee, entityKind: 'organization', cognition: 'none',
    readiness: 'ready', profile: { name: 'Existing-person committee', description: 'Independent votes authorize one original person.' } }],
  relations: [...original.relations, { kind: 'relation/create', id: 'rehire-depart-permission', subject: hr.id,
    relation: 'can-depart', object: 'rehire-old-role', scope: organization, validFrom: '0', validUntil: null },
  ...electorate.map(value => ({ kind: 'relation/create' as const, id: `membership:${value.id}`, subject: value.id,
    relation: 'committee-member', object: committee, scope: organization, validFrom: '0' as const, validUntil: null })),
  ...permissions.map(value => ({ kind: 'relation/create' as const, id: `permission:${value.relation}:${value.entityId}`,
    subject: value.entityId, relation: value.relation, object: committee, scope: organization, validFrom: '0' as const, validUntil: null }))] }
const { definitionHash: _hash, ...resolvedBody } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(resolvedBody)).digest('hex')}` })
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
const proofPath = resolve(root, 'rehire-proof.json'), memoryCanary = 'ORIGINAL-REHIRED-PERSON-MEMORY-CANARY'
const privateRationale = 'DIRECTOR-PRIVATE-REHIRE-CANARY'
const ctx = await boot('world-rehire', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `rehire-${scenario}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('rehire-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-rehire/${scenario}`, checkpoint: {
      id: simulationCheckpointIdSchema.parse('rehire-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
  const lifetime = new AbortController().signal
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime, ctx,
    ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: anchor,
      lifetime: lifetime,
    }, [new PersonnelWorldExecution(run, connection, anchor, lifetime, 'depart'), new ExistingHireWorldExecution(run), new GovernanceWorldExecution(run, 'proposal'), new GovernanceWorldExecution(run, 'vote'),
      new GovernanceWorldExecution(run, 'hire-approval'), new NormWorldExecution(run, 'enact')]))
  assert.equal((await driver.advance()).reason, 'paused')
  const advance = async (until = run.snapshot().time): Promise<SimulationWorldDriveResult> => {
    let result = await driver.advance(until)
    for (let round = 0; round < 16 && result.reason === 'work-limit'; round++) result = await driver.advance(until)
    assert.ok(['idle', 'until', 'approval-required'].includes(result.reason), JSON.stringify(result))
    return result
  }
  const wake = async (entityId: string, id: string, reason: string) => {
    const time = `${BigInt(run.snapshot().time) + BigInt(1)}`
    const requested = simulationWakeRequestSchema.parse({ id, entityId, time, reason })
    await run.scheduleWake(requested, run.snapshot().revision)
    return advance(requested.time)
  }
  const goal = (entityId: string, id: string, text: string) => wake(entityId, id,
    JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: text })))
  const candidateId = simulationEntityIdSchema.parse(candidate.id)
  const candidateChannels = () => Object.values(run.snapshot().channelReservations ?? {}).filter(value => value.confirmed
    && value.spec.members.length === 2 && value.spec.members.some(member => member.entityId === candidateId)
    && value.spec.members.some(member => member.entityId === world.directorEntityId))
  assert.equal(candidateChannels().length, 1)
  let memoryPrefix: unknown[] = []
  let countStages: Record<string, PersonnelCounts> = {}
  const observeCounts = async (): Promise<PersonnelCounts> => {
    const state = run.snapshot(), actualTeam = await ctx.teams.getTeam({ teamId: team.teamId })
    assert.equal(run.snapshot().revision, state.revision)
    const counts = combinePersonnelCounts(state, projectPersonnelCounts(state), { kind: 'full', runId: state.spec.runId,
      nativeCursor: state.revision, teamCursor: actualTeam.team.cursor, team: actualTeam })
    assert.equal(counts.nonterminatedPeople, 4)
    assert.equal(counts.residentLimit, 3)
    assert.equal(counts.historicalParticipants.kind, 'known')
    assert.equal(counts.historicalActivations.kind, 'known')
    if (counts.historicalParticipants.kind !== 'known') throw new Error('Actual canonical participant history must be known')
    assert.equal(counts.historicalParticipants.value, 4)
    const currentAgents = Object.values(state.entities).filter(value => value.binding !== undefined
      && ctx.agents.get(value.binding.sessionId) !== undefined && value.writer?.phase === 'active')
    assert.equal(counts.residentActors, currentAgents.length)
    return counts
  }
  const originalIdentity = { binding: run.snapshot().entities[candidateId]!.binding,
    profile: run.snapshot().entities[candidateId]!.profile, profileRevision: run.snapshot().entities[candidateId]!.profileRevision,
    channelId: candidateChannels()[0]!.channelId,
    entityIds: Object.keys(run.snapshot().entities).sort() }
  if (!recovering) {
    assert.ok(originalIdentity.binding && originalIdentity.channelId)
    assert.equal(Object.values(run.snapshot().relations).filter(value => value.subject === candidateId
      && value.relation === 'assignment' && value.validUntil === null).length, 1)
    await run.setPhase('running', run.snapshot().revision)
    await wake(candidate.id, 'original-candidate-memory', JSON.stringify({ kind: 'private-candidate-memory', text: memoryCanary }))
    const originalSession = ctx.sessions.get(originalIdentity.binding.sessionId)
    assert.ok(originalSession)
    assert.equal(await ctx.sessions.flush(originalSession), true)
    memoryPrefix = [...(await ctx.sessionPersistence.readFrom(originalIdentity.binding.sessionId, 0)).events]
    assert.ok(JSON.stringify(memoryPrefix).includes(memoryCanary))
    countStages['before-departure'] = await observeCounts()
    assert.equal(countStages['before-departure'].assignedPeople, 3)
    assert.equal(countStages['before-departure'].residentActors, 1)
    assert.equal(countStages['before-departure'].unreleasedWriters, 1)
    await goal(hr.id, 'original-person-retire-before-rehire', 'depart-retire')
    const retired = run.snapshot(), departure = Object.values(retired.world!.requests).find(value => value.pin.operation === 'depart')!
    assert.ok(departure)
    const departedResult = Object.values(retired.world!.results).find(value => value.requestId === departure.id)!
    assert.equal(departedResult.outcome.kind, 'committed')
    assert.equal(simulationWorldDepartPayloadSchema.parse(retired.world!.intents[departure.intentId]!.payload).retire, true)
    const departed = simulationWorldDepartCommittedResultPayloadSchema.parse(departedResult.payload)
    assert.equal(departed.retire, true)
    assert.equal(departed.entityId, candidateId)
    const closed = retired.relations[departed.closedAssignmentId]!
    assert.equal(closed.subject, candidateId)
    assert.equal(closed.validUntil, departedResult.time)
    assert.equal(retired.entities[candidateId]!.phase, 'active')
    assert.equal(retired.entities[candidateId]!.writer!.phase, 'released')
    assert.equal(personnelRetired(retired, candidateId), true)
    assert.deepEqual(retired.entities[candidateId]!.binding, originalIdentity.binding)
    assert.deepEqual(retired.entities[candidateId]!.profile, originalIdentity.profile)
    const refused = run.snapshot().revision, beforeRefusedCalls = requests.length
    await assert.rejects(connection.activate(candidateId, { provider: 'in-process', seed: { kind: 'resume' },
      agent: { preset: 'simulation', options: { provider: 'world-rehire-scripted', model: 'scripted' } }, signal: lifetime }),
    /confirmed retirement/)
    assert.equal(run.snapshot().revision, refused)
    assert.equal(requests.length, beforeRefusedCalls)
    const refusedNomination = run.snapshot()
    await assert.rejects(run.queueDecision(simulationDispatchCandidateSchema.parse({ id: 'retired-person-fresh-nomination',
      entityId: candidateId, priority: 0 })), /retire/i)
    assert.deepEqual(run.snapshot(), refusedNomination)
    assert.equal(requests.length, beforeRefusedCalls)
    countStages['committed-retired'] = await observeCounts()
    assert.equal(countStages['committed-retired'].assignedPeople, 2)
    const oldEpochs = (await ctx.teams.getTeam({ teamId: team.teamId })).activations
      .filter(value => value.activation.participantId === originalIdentity.binding!.participantId)
    assert.equal(oldEpochs.length, 1)
    assert.ok(oldEpochs.every(value => value.quiescedAt !== undefined))
    // Actual trusted scenario owner admits this explicit eligibility only after departure has settled its original obligations.
    await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'original-candidate-eligibility', subject: candidateId,
      relation: 'eligible-for-hire', object: organization, scope: organization, validFrom: run.snapshot().time, validUntil: null }),
    run.snapshot().revision)
    await goal(hr.id, 'existing-person-policy-proposal', 'propose-policy')
    await goal(hr.id, 'existing-person-policy-first-vote', 'vote-policy')
    await goal(witness.id, 'existing-person-policy-second-vote', 'vote-policy')
    const policy = Object.values(run.snapshot().world!.governance.proposals).find(value => value.target.kind === 'norm')!
    assert.equal((await run.closeWorldGovernance(policy.id)).outcome, 'passed')
    await advance()
    await goal(hr.id, 'existing-person-policy-enactment', 'enact-policy')
    assert.equal(Object.values(run.snapshot().world!.norms.versions).flat().length, 1)
    const deferredAnnouncements = Object.values(run.snapshot().wakes).filter(value => value.entityId === candidateId
      && value.eventId.startsWith('simulation-norm-announcement:'))
    assert.equal(deferredAnnouncements.length, 1)
    const deferredAnnouncement = deferredAnnouncements[0]!
    assert.equal(deferredAnnouncement.status, 'pending')
    assert.equal(personnelRetired(run.snapshot(), candidateId), true)
    assert.equal((await goal(hr.id, 'existing-person-request', 'request-existing-person')).reason, 'approval-required')
    const request = Object.values(run.snapshot().world!.requests).find(value => value.pin.operation === 'hire-existing')!
    const plan = run.snapshot().world!.plans[request.plans.at(-1)!]!
    assert.equal(plan.status, 'accepted')
    assert.equal(plan.proposal.resolution.kind, 'apply')
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('Existing hiring needs its original accepted apply plan')
    const intent = run.snapshot().world!.intents[request.intentId]!
    assert.deepEqual(simulationWorldHireExistingPayloadSchema.parse(plan.proposal.resolution.payload), intent.payload)
    assert.deepEqual(run.inspectWorldHireAuthorization(plan.id), { allowed: false, reason: 'approval-required' })
    const blocked = run.snapshot().revision
    await assert.rejects(run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.payload }),
      (error: unknown) => error instanceof SimulationHireApprovalError && error.code === 'SIM_HIRE_APPROVAL_REQUIRED')
    assert.equal(run.snapshot().revision, blocked)
    assert.equal(Object.keys(run.snapshot().world!.reservations).length, 0)
    assert.equal(Object.values(run.snapshot().relations).filter(value => value.subject === candidateId
      && value.relation === 'assignment' && value.validUntil === null).length, 0)
    await goal(hr.id, 'existing-person-specific-approval', 'propose-hire-approval')
    const approval = Object.values(run.snapshot().world!.governance.proposals).find(value => value.target.kind === 'hire-approval')!
    assert.equal(approval.target.kind, 'hire-approval')
    if (approval.target.kind !== 'hire-approval') throw new Error('Expected the exact existing-person approval target')
    const selected = approval.target.approval.selection
    assert.equal(selected.kind, 'existing-person')
    if (selected.kind !== 'existing-person') throw new Error('Approval must preserve its original person')
    assert.equal(selected.personId, candidateId)
    assert.equal(selected.entityRevision, run.snapshot().entities[candidateId]!.revision)
    assert.match(selected.profileHash, /^sha256:[a-f0-9]{64}$/)
    await goal(hr.id, 'existing-person-approval-first-vote', 'vote-hire-approval')
    await goal(witness.id, 'existing-person-approval-second-vote', 'vote-hire-approval')
    assert.equal(run.snapshot().entities[candidateId]!.revision, selected.entityRevision)
    assert.equal((await run.closeWorldGovernance(approval.id)).outcome, 'passed')
    assert.deepEqual(run.inspectWorldHireAuthorization(plan.id), { allowed: true })
    assert.deepEqual(run.snapshot().wakes[deferredAnnouncement.eventId], deferredAnnouncement)
    assert.equal(Object.values(run.snapshot().decisions).some(value => value.wakeId === deferredAnnouncement.eventId), false)
    await advance()
  } else {
    const stored: unknown = JSON.parse(await readFile(proofPath, 'utf8'))
    assert.ok(stored !== null && typeof stored === 'object' && !Array.isArray(stored))
    const prior = stored as Record<string, unknown>
    assert.ok(Array.isArray(prior.memoryPrefix))
    memoryPrefix = prior.memoryPrefix
    assert.deepEqual(originalIdentity, prior.originalIdentity)
    assert.ok(prior.countStages !== null && typeof prior.countStages === 'object' && !Array.isArray(prior.countStages))
    countStages = Object.fromEntries(Object.entries(prior.countStages).map(([key, value]) => [key, personnelCountsSchema.parse(value)]))
  }
  const state = run.snapshot(), owned = state.world!, person = state.entities[candidateId]!
  const request = Object.values(owned.requests).find(value => value.pin.operation === 'hire-existing')!
  const plan = owned.plans[request.plans.at(-1)!]!, result = Object.values(owned.results).find(value => value.requestId === request.id)!
  assert.equal(result.outcome.kind, 'committed')
  const outcome = simulationWorldHireExistingCommittedResultPayloadSchema.parse(result.payload)
  assert.equal(outcome.entityId, candidateId)
  assert.deepEqual(person.binding, originalIdentity.binding)
  assert.deepEqual(person.profile, originalIdentity.profile)
  assert.equal(person.profileRevision, originalIdentity.profileRevision)
  assert.equal(candidateChannels().length, 1)
  assert.equal(candidateChannels()[0]!.channelId, originalIdentity.channelId)
  assert.deepEqual(Object.keys(state.entities).sort(), originalIdentity.entityIds)
  assert.equal(Object.keys(owned.reservations).length, 0)
  assert.ok(Object.values(owned.intents).every(value => value.pin.operation !== 'generate-and-hire'))
  assert.equal(Object.values(state.relations).filter(value => value.subject === candidateId && value.relation === 'assignment').length, 2)
  assert.equal(Object.values(state.relations).filter(value => value.subject === candidateId && value.relation === 'assignment'
    && value.validUntil === null).length, 1)
  assert.equal(personnelRetired(state, candidateId), false)
  const deferredAnnouncements = Object.values(state.wakes).filter(value => value.entityId === candidateId
    && value.eventId.startsWith('simulation-norm-announcement:'))
  assert.equal(deferredAnnouncements.length, 1)
  const deferredAnnouncement = deferredAnnouncements[0]!
  assert.equal(deferredAnnouncement.status, 'completed')
  const announcementDecision = Object.values(state.decisions).find(value => value.wakeId === deferredAnnouncement.eventId)!
  assert.equal(announcementDecision.status, 'accepted')
  assert.equal(announcementDecision.entityId, candidateId)
  assert.equal(announcementDecision.context?.status, 'prepared')
  if (announcementDecision.context?.status !== 'prepared') throw new Error('Original announcement needs its actual prepared context')
  const announcementView = announcementDecision.context.view
  const assignment = state.relations[outcome.relationId]!
  assert.equal(assignment.subject, candidateId)
  assert.equal(assignment.object, 'rehire-new-role')
  const departure = Object.values(owned.requests).find(value => value.pin.operation === 'depart')!
  const departedResult = Object.values(owned.results).find(value => value.requestId === departure.id)!
  assert.equal(departedResult.outcome.kind, 'committed')
  const departed = simulationWorldDepartCommittedResultPayloadSchema.parse(departedResult.payload)
  const closedAssignment = state.relations[departed.closedAssignmentId]!
  assert.equal(closedAssignment.object, 'rehire-old-role')
  assert.equal(closedAssignment.validUntil, departedResult.time)
  assert.ok(BigInt(assignment.validFrom) >= BigInt(closedAssignment.validUntil))
  assert.notEqual(assignment.id, closedAssignment.id)
  assert.equal(assignment.validFrom, result.time)
  const first = state.scheduledEvents[simulationEventIdSchema.parse(`simulation-world-first:${result.intentId}`)]!
  assert.equal(first.action.kind, 'wake')
  if (first.action.kind !== 'wake') throw new Error('The committed existing hire must retain its first-action wake')
  assert.equal(first.action.entityId, candidateId)
  assert.equal(first.key.time, result.time)
  assert.ok(person.binding && state.entities[owned.definition.directorEntityId]!.binding)
  assert.notEqual(person.binding.sessionId, state.entities[owned.definition.directorEntityId]!.binding!.sessionId)
  const session = await ctx.sessionPersistence.readFrom(person.binding.sessionId, 0)
  const announcementViews = session.events.filter(value => value.type === 'simulation/context-view'
    && value.data.inputId === announcementView.inputId)
  assert.equal(announcementViews.length, 1)
  assert.equal(announcementViews[0]!.type, 'simulation/context-view')
  assert.deepEqual(announcementViews[0]!.data, announcementView)
  assert.deepEqual(session.events.slice(0, memoryPrefix.length), memoryPrefix)
  assert.ok(JSON.stringify(session.events).includes(memoryCanary))
  assert.equal(JSON.stringify(session.events).includes(privateRationale), false)
  const firstDecision = Object.values(state.decisions).find(value => value.wakeId === first.id)!
  assert.equal(firstDecision.entityId, candidateId)
  assert.equal(firstDecision.status, 'accepted')
  assert.equal(firstDecision.consumption?.sessionId, person.binding.sessionId)
  assert.equal(announcementDecision.epoch, firstDecision.epoch)
  const firstPost = Object.values(state.operations).filter(value => value.decisionId === firstDecision.id
    && value.entityId === candidateId && value.action.kind === 'communication/post')
  assert.equal(firstPost.length, 1)
  assert.equal(firstPost[0]!.action.kind, 'communication/post')
  if (firstPost[0]!.action.kind !== 'communication/post') throw new Error('Existing hiring first action must be a private post')
  assert.equal(firstPost[0]!.action.channelId, originalIdentity.channelId)
  assert.equal(firstPost[0]!.action.recipient, owned.definition.directorEntityId)
  assert.ok(firstPost[0]!.delivery?.receipt)
  const actualCounts = await observeCounts()
  assert.equal(actualCounts.assignedPeople, 3)
  const candidateEpochs = (await ctx.teams.getTeam({ teamId: team.teamId })).activations
    .filter(value => value.activation.participantId === person.binding!.participantId)
  assert.equal(candidateEpochs.length, 2)
  assert.ok(candidateEpochs.every(value => value.sessionId === originalIdentity.binding!.sessionId))
  assert.notEqual(candidateEpochs[0]!.activation.id, candidateEpochs[1]!.activation.id)
  if (!recovering) countStages['rehired-first-action'] = actualCounts
  else {
    assert.equal(actualCounts.residentActors, 0)
    assert.equal(actualCounts.unreleasedWriters, 0)
  }
  const historyBefore = countStages['committed-retired']!.historicalActivations
  const historyAfter = actualCounts.historicalActivations
  assert.equal(historyBefore.kind, 'known')
  assert.equal(historyAfter.kind, 'known')
  if (historyBefore.kind !== 'known' || historyAfter.kind !== 'known') throw new Error('Actual full activation histories must be known')
  assert.ok(historyAfter.value > historyBefore.value)
  const votes = Object.values(owned.governance.votes)
  assert.equal(votes.length, 4)
  assert.equal(new Set(votes.map(value => value.source.binding.sessionId)).size, 2)
  assert.deepEqual([...new Set(votes.map(value => value.voter))].sort(), electorate.map(value => value.id).sort())
  assert.ok(votes.every(value => value.source.binding.sessionId !== person.binding!.sessionId))
  assert.equal(Object.keys(owned.governance.resolutions).length, 2)
  for (const vote of votes) {
    assert.equal(state.decisions[vote.source.decisionId]!.entityId, vote.voter)
    assert.equal(state.decisions[vote.source.decisionId]!.consumption?.sessionId, vote.source.binding.sessionId)
  }
  if (!recovering) {
    assert.ok(modelInputs.some(value => value.entityId === candidate.id && value.purpose === 'first-action'
      && value.input.includes(memoryCanary)))
    assert.equal(modelInputs.some(value => value.entityId !== candidate.id && value.input.includes(memoryCanary)), false)
    assert.equal(modelInputs.some(value => value.entityId === candidate.id && value.input.includes(privateRationale)), false)
  }
  const beforeRetry = run.snapshot().revision, beforeCalls = requests.length
  assert.equal(plan.proposal.resolution.kind, 'apply')
  if (plan.proposal.resolution.kind !== 'apply') throw new Error('Retained commit retry must keep its original apply plan')
  assert.deepEqual(await run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.payload }), result)
  assert.equal(run.snapshot().revision, beforeRetry)
  assert.equal(requests.length, beforeCalls)
  const departurePlan = owned.plans[departure.plans.at(-1)!]!
  assert.equal(departurePlan.proposal.resolution.kind, 'apply')
  if (departurePlan.proposal.resolution.kind !== 'apply') throw new Error('Retained departure must preserve its original apply plan')
  assert.deepEqual(await connection.commitPersonnel(departure.intentId), departedResult)
  assert.equal(run.snapshot().revision, beforeRetry)
  assert.equal(requests.length, beforeCalls)
  const proof = { originalIdentity, memoryPrefix, countStages, deferredAnnouncement, announcementDecision,
    personnel: owned.personnel, closedAssignment,
    governance: owned.governance, norms: owned.norms, intents: owned.intents,
    requests: owned.requests, plans: owned.plans, results: owned.results, mutations: owned.mutations, reservations: owned.reservations,
    channels: owned.channels, assignment, posts: Object.values(state.operations).filter(value => value.action.kind === 'communication/post') }
  if (recovering) {
    assert.deepEqual(proof, JSON.parse(await readFile(proofPath, 'utf8')))
    assert.equal(state.phase, 'paused')
    assert.equal(requests.length, 0)
  } else {
    await run.setPhase('paused', run.snapshot().revision)
    await driver.drain()
    const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('rehire-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
    if (checkpoint.status !== 'completed') throw new Error('Existing-person checkpoint must complete before a cold process')
    await writeFile(proofPath, JSON.stringify(proof))
  }
  console.log(JSON.stringify({ scenario, retiredThenRehired: true, retiredActivationRejected: true,
    retiredNewNominationRejected: true, oldAssignmentClosed: true,
    originalIdentity: true, originalPersona: true, originalPrivateChannel: true,
    originalMemory: true, separatePersonnelCounts: true, originalParticipantHistory: true, actualNewActivationEpoch: true,
    retiredAnnouncementPreserved: true, originalAnnouncementProcessedAfterRehire: true,
    independentVoteSessions: 2, actualVotes: 4, approvedExistingPerson: true,
    missingApprovalRejected: true, uniqueAssignment: true, generatedPeople: 0, generationReservations: 0,
    independentFirstAction: true, privateCanaryLeaks: 0, exactCommitRetryNoAppend: true,
    restored: recovering, modelCalls: requests.length }))
} finally { await run.close(); await ctx.fiber.dispose() }
