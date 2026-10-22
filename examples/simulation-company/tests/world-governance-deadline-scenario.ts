/** Real Native deadline consumption preserves the frozen electorate and closes without an owner-side manual close. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { simulationWorldDefinitionSchema, simulationRunSelectionSchema, simulationCheckpointIdSchema,
  simTimeSchema, simulationRelationIdSchema,
  simulationEntityIdSchema,
  simulationWakeRequestSchema, simulationWorldGoalSchema, WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN,
  simulationGovernanceVoteInputSchema } from '@clocky/clocky-simulation'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, GovernanceWorldExecution } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-governance-model.ts'

const scenario = process.env.WORLD_SCENARIO
assert.ok(scenario === 'company' || scenario === 'laboratory')
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(`examples/simulation-company/scenarios/world-${scenario}.json`, 'utf8')))
const members = definition.actors.filter(value => value.role === 'member')
assert.equal(members.length, 2)
const [proposer, voter] = members
assert.ok(proposer && voter)
definition.assignments.push({ id: 'voter-assignment', personId: voter.id, positionId: definition.positions[0]!.id })
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-governance-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, org = original.world.organizationEntityId, committee = 'policy-committee'
const permissions = [{ entityId: proposer.id, pin: WORLD_GOVERNANCE_PROPOSE_PIN, relation: 'can-propose-norm' },
  ...members.map(value => ({ entityId: value.id, pin: WORLD_GOVERNANCE_VOTE_PIN, relation: 'can-vote' }))]
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN], authorizations: [],
  operationGrants: permissions.map(value => ({ requesterEntityId: value.entityId, domain: value.pin.domain,
    operation: value.pin.operation, version: value.pin.version, targetEntityId: committee, scopeEntityId: org,
    relation: value.relation, relationId: `permission:${value.relation}:${value.entityId}` })) })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  native: { ...original.native, relationRules: [...original.native.relationRules,
    ...['committee-member', 'can-propose-norm', 'can-vote'].map(relation => ({ relation, subjectKinds: ['person'],
      objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }))] },
  entities: [...original.entities, { kind: 'entity/create', id: committee, entityKind: 'organization', cognition: 'none',
    readiness: 'ready', profile: { name: 'Policy committee', description: 'Frozen independent electorate for institutional proposals.' } }],
  relations: [...original.relations, ...members.map(value => ({ kind: 'relation/create' as const, id: `membership:${value.id}`,
    subject: value.id, relation: 'committee-member', object: committee, scope: org, validFrom: '0' as const, validUntil: null })),
  ...permissions.map(value => ({ kind: 'relation/create' as const, id: `permission:${value.relation}:${value.entityId}`,
    subject: value.entityId, relation: value.relation, object: committee, scope: org, validFrom: '0' as const, validUntil: null }))] }
const { definitionHash: _hash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
const proofPath = resolve(root, 'governance-deadline-proof.json')
const ctx = await boot('world-governance', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `governance-deadline-${scenario}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('governance-deadline-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-governance/${scenario}`, checkpoint: { id: simulationCheckpointIdSchema.parse('governance-deadline-initial'),
      maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!
  const ownerName = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const driver = new SimulationWorldDriver(run, connection, resolved, {
    checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 },
  new AbortController().signal, ctx, ctx.simulationWorldExecutions.handlers({
    run: run,
    connection: connection,
    resolved: resolved,
    anchor: {
      checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 },
    lifetime: new AbortController().signal,
  }, [new GovernanceWorldExecution(run, 'proposal'), new GovernanceWorldExecution(run, 'vote')]))
  assert.equal((await driver.advance()).reason, 'paused')
  const advance = async () => {
    let result = await driver.advance(run.snapshot().time)
    for (let round = 0; round < 8 && result.reason === 'work-limit'; round++) result = await driver.advance(run.snapshot().time)
    assert.ok(result.reason === 'idle' || result.reason === 'until', JSON.stringify(result))
  }
  const goal = async (entityId: string, id: string, text: string) => {
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id, entityId, time: run.snapshot().time,
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: text })) }), run.snapshot().revision)
    await advance()
  }
  if (!recovering) {
    await run.setPhase('running', run.snapshot().revision)
    await goal(proposer.id, 'proposal-goal', 'Propose the committee hiring policy. Independent votes must follow.')
    const proposal = Object.values(run.snapshot().world!.governance.proposals)[0]!
    assert.equal(Object.keys(run.snapshot().world!.governance.votes).length, 0)
    const deadline = Object.values(run.snapshot().scheduledEvents).find(event => event.action.kind === 'governance-deadline')
    assert.ok(deadline)
    const unchanged = run.snapshot().revision
    await assert.rejects(run.cancelEvent(deadline.id, 'Cancel original vote cutoff', unchanged), /frozen governance deadline/)
    await assert.rejects(run.scheduleWake(simulationWakeRequestSchema.parse({ id: deadline.id, entityId: proposer.id,
      time: '0', reason: 'Forged cutoff' }), unchanged), /ids are reserved/)
    assert.equal(run.snapshot().revision, unchanged)
    await assert.rejects(run.closeWorldGovernance(proposal.id), /Remaining legal votes/)
    await goal(proposer.id, 'first-independent-vote', 'Read the original proposal and independently vote.')
    assert.equal(Object.keys(run.snapshot().world!.governance.votes).length, 1)
    await assert.rejects(run.closeWorldGovernance(proposal.id), /Remaining legal votes/)
    await run.drive({ until: simTimeSchema.parse('1') })
    const membership = run.snapshot().relations[simulationRelationIdSchema.parse(`membership:${voter.id}`)]
    assert.ok(membership)
    await run.change({ kind: 'relation/update', id: membership.id, relationRevision: membership.revision,
      subject: membership.subject, relation: membership.relation, object: membership.object, scope: membership.scope,
      validFrom: membership.validFrom, validUntil: simTimeSchema.parse('1') }, run.snapshot().revision)
    assert.equal(Object.values(run.snapshot().world!.governance.proposals)[0]!.electorate.length, 2)
    let driven = await driver.advance()
    for (let round = 0; round < 8 && driven.reason === 'work-limit'; round++) driven = await driver.advance()
    assert.equal(driven.reason, 'idle')
    const resolution = Object.values(run.snapshot().world!.governance.resolutions)[0]!
    assert.equal(resolution.outcome, 'failed')
    assert.equal(resolution.closure, 'deadline')
    const retry = run.snapshot().revision
    assert.deepEqual(await run.closeWorldGovernance(proposal.id), resolution)
    assert.equal(run.snapshot().revision, retry)
    await assert.rejects(run.openWorldIntent(simulationEntityIdSchema.parse(voter.id), { kind: 'world/request',
      domain: 'governance', operation: 'vote', version: '1',
      businessKey: 'late-vote', expectedTime: null, evidence: [], payload: { proposalId: proposal.id,
        proposalRevision: proposal.revision, bodyHash: proposal.bodyHash, choice: 'yes' } }), /resolved|deadline/)
    assert.equal(run.snapshot().revision, retry)
  }
  const state = run.snapshot(), governance = state.world!.governance
  const proposal = Object.values(governance.proposals)[0]!, votes = Object.values(governance.votes)
  const resolution = Object.values(governance.resolutions)[0]!
  assert.equal(Object.keys(governance.proposals).length, 1)
  assert.equal(votes.length, 1)
  assert.equal(Object.keys(governance.resolutions).length, 1)
  assert.equal(new Set(votes.map(value => value.source.binding.sessionId)).size, 1)
  assert.equal(new Set(votes.map(value => value.source.binding.participantId)).size, 1)
  assert.deepEqual(votes.map(value => value.voter).sort(), [proposer.id])
  for (const vote of votes) {
    const decision = state.decisions[vote.source.decisionId]!
    assert.equal(decision.entityId, vote.voter)
    assert.equal(decision.epoch, vote.source.epoch)
    assert.equal(decision.status, 'accepted')
    assert.equal(decision.consumption?.sessionId, vote.source.binding.sessionId)
    assert.equal(vote.bodyHash, proposal.bodyHash)
    assert.equal(vote.choice, 'yes')
  }
  assert.equal(resolution.outcome, 'failed')
  assert.deepEqual(resolution.counts, { yes: 1, no: 0, abstain: 0, missing: 1 })
  assert.equal(state.scheduledEvents[resolution.wakeId]?.action.kind, 'wake')
  assert.equal(Object.values(state.world!.results).filter(value => value.outcome.kind === 'committed').length, 2)
  assert.ok(Object.values(state.operations).filter(value => value.action.kind === 'communication/post')
    .every(value => value.delivery?.receipt !== undefined))
  assert.throws(() => simulationGovernanceVoteInputSchema.parse({ proposalId: proposal.id, proposalRevision: 1,
    bodyHash: proposal.bodyHash, choice: 'yes', voter: proposer.id }))
  const deadline = Object.values(state.scheduledEvents).find(event => event.action.kind === 'governance-deadline')
  assert.ok(deadline)
  assert.equal(deadline.key.phase, 'deadline')
  assert.equal(deadline.key.time, proposal.deadline)
  assert.equal(deadline.status, 'consumed')
  assert.equal(deadline.settledAt, resolution.sequence)
  assert.equal(resolution.time, proposal.deadline)
  const proof = { deadline, governance, requests: state.world!.requests, plans: state.world!.plans,
    results: state.world!.results, mutations: state.world!.mutations, wake: state.scheduledEvents[resolution.wakeId] }
  if (recovering) {
    assert.deepEqual(proof, JSON.parse(await readFile(proofPath, 'utf8')))
    assert.equal(state.phase, 'paused')
    assert.equal(requests.length, 0)
  } else {
    await run.setPhase('paused', run.snapshot().revision)
    await driver.drain()
    const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('governance-deadline-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
    if (checkpoint.status !== 'completed') throw new Error('Governance checkpoint did not complete')
    for (const [kind, count] of [['proposal', 1], ['vote', 1], ['resolution', 1]] as const)
      assert.equal(checkpoint.manifest.state.world?.records.filter(value => value.kind === kind).length, count)
    await writeFile(proofPath, JSON.stringify(proof))
  }
  console.log(JSON.stringify({ scenario, frozenElectorate: 2, actualVotes: 1, automaticDeadline: true, actualChannel: true,
    soleResolution: true, restored: recovering, modelCalls: requests.length }))
} finally { await run.close(); await ctx.fiber.dispose() }
