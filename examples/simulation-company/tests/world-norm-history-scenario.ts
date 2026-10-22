/** Actual committee votes enact a Norm, then approve one original HR request before atomic hiring and cold restore. */
import assert from 'node:assert/strict'
import { verifyCheckpointWorldCoverage } from './checkpoint-world-coverage.ts'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { simulationWorldDefinitionSchema, simulationRunSelectionSchema, simulationCheckpointIdSchema,
  simulationWakeRequestSchema, simulationWorldGoalSchema, simulationWorldHireReserveRequestSchema, simulationWorldHirePlanPayloadSchema,
  WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN,
  WORLD_GOVERNANCE_HIRE_APPROVAL_DEFINITION, WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN,
  SimulationHireApprovalError, projectNorms, effectiveNorms, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan, SimulationSnapshot, SimulationDecision } from '@clocky/clocky-simulation'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, GovernanceWorldExecution, OrganizationWorldExecution, NormWorldExecution } from '@clocky/clocky-simulation-world'
import type { WorldExecutionHandler, SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests, modelInputs } from './world-norm-history-model.ts'

/** The test registers pure domain mutation adapters; actual execution and all persistence remain Native-owned. */
class HireApprovalExecution implements WorldExecutionHandler {
  readonly definition = WORLD_GOVERNANCE_HIRE_APPROVAL_DEFINITION
  readonly ref = WORLD_GOVERNANCE_HIRE_APPROVAL_PIN.implementationRef
  readonly generation = WORLD_GOVERNANCE_HIRE_APPROVAL_PIN.generation
  private readonly run: SimulationRun
  constructor(run: SimulationRun) {
    this.run = run
  }
  reconciliationPlans(): readonly SimulationWorldPlan['id'][] { return [] }
  retainsResponsibility(_plan: SimulationWorldPlan): boolean { return false }
  async execute(plan: SimulationWorldPlan): Promise<undefined> {
    assert.equal(plan.proposal.resolution.kind, 'apply')
    if (plan.proposal.resolution.kind !== 'apply') throw new Error('Fixture requires the original accepted apply plan')
    await this.run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.payload })
    return undefined
  }
  async reconcile(plan: SimulationWorldPlan): Promise<void> { await this.execute(plan) }
}

const scenario = process.env.WORLD_SCENARIO
assert.ok(scenario === 'company' || scenario === 'laboratory')
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(`examples/simulation-company/scenarios/world-${scenario}.json`, 'utf8')))
const members = definition.actors.filter(value => value.role === 'member')
assert.equal(members.length, 2)
const [proposer, voter] = members
assert.ok(proposer && voter)
definition.positions[0]!.capacity = 3
definition.assignments.push({ id: 'policy-voter-assignment', personId: voter.id, positionId: definition.positions[0]!.id })
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-norm-history-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, org = original.world.organizationEntityId, committee = 'policy-committee'
const permissions = [{ entityId: proposer.id, pin: WORLD_GOVERNANCE_PROPOSE_PIN, relation: 'can-propose-norm' },
  { entityId: proposer.id, pin: WORLD_NORM_ENACT_PIN, relation: 'can-enact-norm' },
  { entityId: proposer.id, pin: WORLD_NORM_REVOKE_PIN, relation: 'can-revoke-norm' },
  { entityId: proposer.id, pin: WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, relation: 'can-approve-hire' },
  ...members.map(value => ({ entityId: value.id, pin: WORLD_GOVERNANCE_VOTE_PIN, relation: 'can-vote' }))]
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [...original.world.operations, WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN,
    WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN],
  operationGrants: [...original.world.operationGrants, ...permissions.map(value => ({ requesterEntityId: value.entityId,
    domain: value.pin.domain, operation: value.pin.operation, version: value.pin.version, targetEntityId: committee,
    scopeEntityId: org, relation: value.relation, relationId: `permission:${value.relation}:${value.entityId}` }))],
  limits: { ...original.world.limits, maxRequests: 32,
    maxBirthsPerInterval: 32, maxExternalExpansionsPerInterval: 32, maxPendingMutations: 1,
    maxRequestsPerActorPerInterval: 32, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 } })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  native: { ...original.native, relationRules: [...original.native.relationRules,
    ...['committee-member', 'can-propose-norm', 'can-enact-norm', 'can-revoke-norm', 'can-approve-hire', 'can-vote'].map(relation => ({ relation,
      subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }))] },
  entities: [...original.entities, { kind: 'entity/create', id: committee, entityKind: 'organization', cognition: 'none',
    readiness: 'ready', profile: { name: 'Policy committee', description: 'Independent votes govern each hiring request.' } }],
  relations: [...original.relations, ...members.map(value => ({ kind: 'relation/create' as const, id: `membership:${value.id}`,
    subject: value.id, relation: 'committee-member', object: committee, scope: org, validFrom: '0' as const, validUntil: null })),
  ...permissions.map(value => ({ kind: 'relation/create' as const, id: `permission:${value.relation}:${value.entityId}`,
    subject: value.entityId, relation: value.relation, object: committee, scope: org, validFrom: '0' as const, validUntil: null }))] }
const { definitionHash: _hash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
const proofPath = resolve(root, 'norm-history-proof.json')
const historyPath = resolve(root, 'norm-history-inputs.json')
const canary = 'PRIVATE-NORM-HISTORY-CANARY'
function heldViews(state: SimulationSnapshot, ids?: readonly string[]) {
  return Object.fromEntries(Object.values(state.decisions).filter(value => ids === undefined || ids.includes(value.id))
    .filter(value => value.context?.status === 'prepared').map(value => [value.id, {
      context: value.context, ...value.consumption === undefined ? {} : { consumption: value.consumption },
    }]))
}
function viewsHash(value: ReturnType<typeof heldViews>): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}
function viewText(decision: SimulationDecision): string {
  assert.equal(decision.context?.status, 'prepared')
  if (decision.context?.status !== 'prepared') throw new Error('Expected actually consumed prepared view')
  return JSON.stringify(decision.context.view)
}
const ctx = await boot('world-norm-history', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `norm-history-${scenario}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('norm-history-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-norm-history/${scenario}`, checkpoint: { id: simulationCheckpointIdSchema.parse('norm-history-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
  const lifetime = new AbortController().signal
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime,
    ctx, ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: anchor,
      lifetime: lifetime,
    }, [new OrganizationWorldExecution(run, connection, resolved, anchor, lifetime),
      new GovernanceWorldExecution(run, 'proposal'), new GovernanceWorldExecution(run, 'vote'),
      new NormWorldExecution(run, 'enact'), new NormWorldExecution(run, 'revoke'), new HireApprovalExecution(run)]))
  assert.equal((await driver.advance()).reason, 'paused')
  const advance = async (until = run.snapshot().time): Promise<SimulationWorldDriveResult> => {
    let result = await driver.advance(until)
    for (let round = 0; round < 16 && result.reason === 'work-limit'; round++) result = await driver.advance(until)
    assert.ok(['idle', 'until', 'approval-required'].includes(result.reason), JSON.stringify(result))
    return result
  }
  const goal = async (entityId: string, id: string, text: string) => {
    const time = `${BigInt(run.snapshot().time) + BigInt(1)}`
    const wake = simulationWakeRequestSchema.parse({ id, entityId, time,
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: text })) })
    await run.scheduleWake(wake, run.snapshot().revision)
    return advance(wake.time)
  }
  const probe = async (entityId: string, id: string) => {
    const wake = simulationWakeRequestSchema.parse({ id, entityId, time: `${BigInt(run.snapshot().time) + BigInt(1)}`,
      reason: JSON.stringify({ kind: 'norm-history-probe', label: id }) })
    await run.scheduleWake(wake, run.snapshot().revision)
    await advance(wake.time)
    const decision = Object.values(run.snapshot().decisions).find(value => value.wakeId === wake.id)
    assert.ok(decision && decision.status === 'accepted')
    const binding = run.snapshot().entities[decision.entityId]?.binding
    assert.ok(binding)
    const session = ctx.sessions.get(binding.sessionId)
    assert.ok(session)
    assert.equal(await ctx.sessions.flush(session), true)
    if (decision.context?.status !== 'prepared') throw new Error('Expected prepared ordinary Agent decision')
    const view = decision.context.view
    const projected = session.events.filter(value => value.type === 'simulation/context-view' && value.data.inputId === view.inputId).at(-1)
    const entered = session.events.filter(value => value.type === 'user/message' && value.surfaceOp === 'append'
      && String(value.data.id) === String(view.inputId))
    assert.ok(projected?.type === 'simulation/context-view')
    assert.deepEqual(projected.data, view)
    assert.equal(entered.length, 1)
    assert.ok(entered[0]!.seq > projected.seq)
    return decision
  }
  if (!recovering) {
    await run.setPhase('running', run.snapshot().revision)
    await goal(proposer.id, 'norm-proposal-goal', 'propose-policy')
    await goal(proposer.id, 'norm-vote-proposer', 'vote-policy')
    await goal(voter.id, 'norm-vote-peer', 'vote-policy')
    const policyProposal = Object.values(run.snapshot().world!.governance.proposals).find(value => value.target.kind === 'norm')!
    const policyResolution = await run.closeWorldGovernance(policyProposal.id)
    assert.equal(policyResolution.outcome, 'passed')
    await advance()
    await goal(proposer.id, 'norm-enact-goal', 'enact-policy')
    assert.equal(Object.values(run.snapshot().world!.norms.versions).flat().length, 1)
    await goal(proposer.id, 'norm-hire-goal', 'request-hire')
    const owned = run.snapshot().world!
    const hireRequest = Object.values(owned.requests).find(value => value.pin.operation === 'generate-and-hire')!
    const hirePlan = owned.plans[hireRequest.plans.at(-1)!]!
    assert.equal(hirePlan.status, 'accepted')
    assert.deepEqual(run.inspectWorldHireAuthorization(hirePlan.id), { allowed: false, reason: 'approval-required' })
    assert.equal(Object.keys(owned.reservations).length, 0)
    const selected = simulationWorldHirePlanPayloadSchema.parse(hirePlan.proposal.resolution.kind === 'apply'
      ? hirePlan.proposal.resolution.payload : null)
    const runtime = resolved.generatedActorRuntime
    const reserve = simulationWorldHireReserveRequestSchema.parse({ planId: hirePlan.id,
      maintenance: { id: `world/1/hire/${hirePlan.id}`, owner: ownerName }, member: { displayName: selected.persona.name,
        role: 'member', capabilities: [], provider: runtime.provider, preset: runtime.preset,
        model: `${runtime.model.provider}/${runtime.model.name}`, modelVersion: runtime.model.version } })
    const before = run.snapshot().revision
    await assert.rejects(run.reserveWorldHire(reserve), (error: unknown) => error instanceof SimulationHireApprovalError
      && error.code === 'SIM_HIRE_APPROVAL_REQUIRED')
    assert.equal(run.snapshot().revision, before)
    await goal(proposer.id, 'norm-hire-approval-goal', 'propose-hire-approval')
    await goal(proposer.id, 'norm-hire-vote-proposer', 'vote-hire-approval')
    await goal(voter.id, 'norm-hire-vote-peer', 'vote-hire-approval')
    const approval = Object.values(run.snapshot().world!.governance.proposals).find(value => value.target.kind === 'hire-approval')!
    const accepted = await run.closeWorldGovernance(approval.id)
    assert.equal(accepted.outcome, 'passed')
    assert.deepEqual(run.inspectWorldHireAuthorization(hirePlan.id), { allowed: true })
    await advance()
    const initial = run.snapshot(), v1 = Object.values(initial.world!.norms.versions).flat()[0]!
    const hired = Object.values(initial.world!.reservations)[0]!
    const oldViews = heldViews(initial), viewIds = Object.keys(oldViews), oldViewsHash = viewsHash(oldViews)
    const oldVotes = Object.values(initial.world!.governance.votes)
    const oldHire = { reservation: hired, profile: initial.entities[hired.identities.entityId]?.profile,
      assignment: initial.relations[hired.identities.relationId], result: Object.values(initial.world!.results)
        .find(value => value.requestId === hired.requestId) }
    await goal(proposer.id, 'history-propose-v2', 'propose-policy-v2')
    await goal(proposer.id, 'history-vote-v2-proposer', 'vote-policy-v2')
    await goal(voter.id, 'history-vote-v2-peer', 'vote-policy-v2')
    const proposedV2 = Object.values(run.snapshot().world!.governance.proposals).find(value =>
      value.target.kind === 'norm' && value.target.norm.version === '2')!
    assert.equal((await run.closeWorldGovernance(proposedV2.id)).outcome, 'passed')
    await advance()
    await goal(proposer.id, 'history-enact-v2', 'enact-policy-v2')
    const v2 = Object.values(run.snapshot().world!.norms.versions).flat().find(value => value.version === '2')!
    assert.ok(v2.body.includes(canary))
    assert.ok(BigInt(v2.availableAt) <= BigInt(run.snapshot().time) && BigInt(v2.effectiveFrom) > BigInt(run.snapshot().time))
    assert.deepEqual(effectiveNorms(run.snapshot(), org, run.snapshot().time, run.snapshot().revision).map(value => value.version), ['1'])
    const announced = run.queryWorldNorms({ viewer: simulationEntityIdSchema.parse(proposer.id), cursor: run.snapshot().revision,
      time: run.snapshot().time, limit: 8 })
    assert.equal(announced.items.find(value => value.norm.version === '2')?.effective, 'scheduled')
    assert.equal(announced.items.find(value => value.norm.version === '2')?.norm.body, v2.body)
    const lowBefore = await probe(hired.identities.entityId, 'history-low-before-effective')
    assert.equal(viewText(lowBefore).includes(canary), false)
    const authorizedBefore = await probe(proposer.id, 'history-authorized-before-effective')
    assert.ok(viewText(authorizedBefore).includes(canary))
    await advance(v2.effectiveFrom)
    assert.deepEqual(effectiveNorms(run.snapshot(), org, run.snapshot().time, run.snapshot().revision).map(value => value.version), ['2'])
    const authorizedAfter = await probe(proposer.id, 'history-authorized-after-effective')
    assert.ok(viewText(authorizedAfter).includes(canary))
    const authorizedProjection = run.queryWorldNorms({ viewer: simulationEntityIdSchema.parse(proposer.id), cursor: run.snapshot().revision,
      time: run.snapshot().time, limit: 8 })
    assert.equal(authorizedProjection.items.find(value => value.norm.version === '2')?.effective, 'effective')
    const lowAfter = await probe(hired.identities.entityId, 'history-low-after-effective')
    assert.equal(viewText(lowAfter).includes(canary), false)
    await goal(proposer.id, 'history-propose-v3', 'propose-policy-v3')
    await goal(proposer.id, 'history-vote-v3-proposer', 'vote-policy-v3')
    await goal(voter.id, 'history-vote-v3-peer', 'vote-policy-v3')
    const proposedV3 = Object.values(run.snapshot().world!.governance.proposals).find(value =>
      value.target.kind === 'norm' && value.target.norm.version === '3')!
    assert.equal((await run.closeWorldGovernance(proposedV3.id)).outcome, 'passed')
    await advance()
    await goal(proposer.id, 'history-revoke-v3', 'revoke-policy-v3')
    const revoked = Object.values(run.snapshot().world!.norms.versions).flat().find(value => value.version === '3')!
    assert.equal(revoked.status, 'revoked')
    assert.equal(revoked.effectiveFrom, run.snapshot().time)
    assert.ok(BigInt(revoked.availableAt) > BigInt(run.snapshot().time))
    assert.deepEqual(effectiveNorms(run.snapshot(), org, run.snapshot().time, run.snapshot().revision), [])
    const unavailable = run.queryWorldNorms({ viewer: hired.identities.entityId, cursor: run.snapshot().revision,
      time: run.snapshot().time, limit: 8 })
    assert.equal(unavailable.items.some(value => value.norm.version === '3'), false)
    assert.equal(JSON.stringify(unavailable).includes(canary), false)
    const lowBeforeNotice = await probe(hired.identities.entityId, 'history-low-before-revocation-notice')
    assert.equal(viewText(lowBeforeNotice).includes(canary), false)
    await advance(revoked.availableAt)
    const lowAfterNotice = await probe(hired.identities.entityId, 'history-low-after-revocation-notice')
    assert.ok(viewText(lowAfterNotice).includes(revoked.body))
    assert.equal(viewText(lowAfterNotice).includes(canary), false)
    const finished = run.snapshot()
    assert.deepEqual(Object.values(finished.world!.norms.versions).flat()[0], v1)
    assert.deepEqual(Object.values(finished.world!.norms.versions).flat()[1], v2)
    assert.deepEqual(heldViews(finished, viewIds), oldViews)
    assert.equal(viewsHash(heldViews(finished, viewIds)), oldViewsHash)
    for (const vote of oldVotes) assert.deepEqual(finished.world!.governance.votes[vote.id], vote)
    assert.deepEqual({ reservation: finished.world!.reservations[hired.id],
      profile: finished.entities[hired.identities.entityId]?.profile,
      assignment: finished.relations[hired.identities.relationId], result: Object.values(finished.world!.results)
        .find(value => value.requestId === hired.requestId) }, oldHire)
    assert.equal(modelInputs.filter(value => value.entityId === hired.identities.entityId)
      .some(value => value.input.includes(canary)), false)
    const authorizedViews = [authorizedBefore, authorizedAfter].map(value => ({ id: value.id,
      view: value.context?.status === 'prepared' ? value.context.view : null, consumption: value.consumption }))
    await writeFile(historyPath, JSON.stringify({ oldViews, viewIds, oldViewsHash, authorizedViews, oldHire, v1, v2 }))
  }
  const state = run.snapshot(), owned = state.world!, norms = Object.values(owned.norms.versions).flat()
  assert.equal(norms.length, 3)
  const norm = norms[0]!, proposals = Object.values(owned.governance.proposals), votes = Object.values(owned.governance.votes)
  const policyProposal = proposals.find(value => value.target.kind === 'norm')!, approval = proposals.find(value => value.target.kind === 'hire-approval')!
  assert.equal(proposals.length, 4)
  assert.equal(votes.length, 8)
  assert.equal(Object.keys(owned.governance.resolutions).length, 4)
  assert.equal(norm.origin, 'governance')
  if (norm.origin !== 'governance') throw new Error('Approved institution must retain its real governance source')
  assert.equal(norm.proposal.id, policyProposal.id)
  assert.equal(norm.bodyHash, policyProposal.bodyHash)
  assert.equal(norm.enforcement.kind, 'validated')
  assert.equal(norms[2]?.status, 'revoked')
  assert.equal(owned.norms.closures.length, 2)
  assert.deepEqual(owned.norms.closures.map(value => [value.norm.version, value.supersededBy.version]), [['1', '2'], ['2', '3']])
  assert.deepEqual(effectiveNorms(state, org, state.time, state.revision), [])
  const savedHistory = JSON.parse(await readFile(historyPath, 'utf8')) as {
    oldViews: ReturnType<typeof heldViews>
    viewIds: string[]
    oldViewsHash: string
  }
  assert.deepEqual(heldViews(state, savedHistory.viewIds), savedHistory.oldViews)
  assert.equal(viewsHash(heldViews(state, savedHistory.viewIds)), savedHistory.oldViewsHash)
  const enactRequest = Object.values(owned.requests).find(value => value.pin.operation === 'enact-norm')!
  const enactPlan = owned.plans[enactRequest.plans.at(-1)!]!
  if (enactPlan.proposal.resolution.kind !== 'apply') throw new Error('Expected exact original enacted plan')
  const enactedResult = Object.values(owned.results).find(value => value.requestId === enactRequest.id)!
  const beforeEnactRetry = run.snapshot().revision
  assert.deepEqual(await run.commitWorldMutation({ planId: enactPlan.id, payload: enactPlan.proposal.resolution.payload }), enactedResult)
  assert.equal(run.snapshot().revision, beforeEnactRetry)
  assert.equal(Object.keys(run.snapshot().world!.norms.announcements).length, 3)
  const hire = Object.values(owned.reservations)[0]!
  assert.equal(Object.keys(owned.reservations).length, 1)
  assert.equal(hire.status, 'committed')
  assert.equal(hire.approvals.length, 1)
  assert.equal(hire.approvals[0]?.proposalId, approval.id)
  assert.notEqual(hire.approvals[0]?.proposalId, policyProposal.id)
  assert.deepEqual(hire.approvals[0]?.norm, { id: norm.id, version: norm.version })
  assert.equal(approval.target.kind, 'hire-approval')
  if (approval.target.kind !== 'hire-approval') throw new Error('Expected single-hire approval')
  assert.equal(approval.target.approval.intentId, hire.id)
  assert.equal(approval.target.approval.requestHash, owned.requests[hire.requestId]?.payloadHash)
  for (const proposal of proposals) assert.equal(new Set(votes.filter(value => value.proposalId === proposal.id)
    .map(value => value.source.binding.sessionId)).size, 2)
  assert.equal(state.entities[hire.identities.entityId]?.readiness, 'ready')
  assert.equal(state.relations[hire.identities.relationId]?.subject, hire.identities.entityId)
  const known = projectNorms(state, { viewer: simulationEntityIdSchema.parse(proposer.id),
    cursor: state.revision, time: state.time, limit: 8 })
  assert.equal(known.items[0]?.norm.body, policyProposal.body)
  assert.equal(known.items.find(value => value.norm.version === '3')?.effective, 'revoked')
  const lowKnown = run.queryWorldNorms({ viewer: hire.identities.entityId, cursor: state.revision, time: state.time, limit: 8 })
  assert.equal(lowKnown.items.some(value => value.norm.version === '2'), false)
  assert.equal(lowKnown.items.find(value => value.norm.version === '3')?.effective, 'revoked')
  assert.equal(JSON.stringify(lowKnown).includes(canary), false)
  for (const decision of Object.values(state.decisions).filter(value => value.entityId === hire.identities.entityId)) {
    if (decision.context?.status === 'prepared') assert.equal(JSON.stringify(decision.context.view).includes(canary), false)
  }
  assert.equal(Object.keys(owned.norms.announcements).length, 3)
  const announcement = Object.values(owned.norms.announcements)[0]!
  assert.equal(announcement.material.body, policyProposal.body)
  const proof = () => ({ governance: owned.governance, norms: owned.norms, requests: owned.requests,
    plans: owned.plans, results: owned.results, mutations: owned.mutations, reservations: owned.reservations,
    newcomer: run.snapshot().entities[hire.identities.entityId], assignment: state.relations[hire.identities.relationId] })
  if (recovering) {
    assert.deepEqual(proof(), JSON.parse(await readFile(proofPath, 'utf8')))
    assert.equal(state.phase, 'paused')
    assert.equal(requests.length, 0)
  } else {
    assert.ok(modelInputs.some(value => value.input.includes('hire-approval-opportunities')))
    await run.setPhase('paused', run.snapshot().revision)
    await driver.drain()
    const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('norm-history-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
    if (checkpoint.status !== 'completed') throw new Error('Policy workflow checkpoint did not complete')
    if (process.env.WORLD_CHECKPOINT_COVERAGE === 'true') await verifyCheckpointWorldCoverage(run, root)
    assert.equal(checkpoint.manifest.state.world?.records.filter(value => value.kind === 'norm').length, 3)
    await writeFile(proofPath, JSON.stringify(proof()))
  }
  console.log(JSON.stringify({ scenario, normVersions: 3, closures: 2, revoked: true, frozenViews: true,
    privateCanaryLeaks: 0, perHireApprovals: 1, independentVotes: 8, committedHires: 1,
    actualChannel: true, restored: recovering, modelCalls: requests.length }))
} finally { await run.close(); await ctx.fiber.dispose() }
