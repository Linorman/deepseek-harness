import { recordR06Cut } from './world-r06-observation.ts'
/** Actual Agent votes and institution commits stop at controlled append/receipt barriers for process-loss recovery. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { simulationWorldDefinitionSchema, simulationRunSelectionSchema, simulationCheckpointIdSchema,
  simulationWakeRequestSchema, simulationWorldGoalSchema, simulationWorldHireReserveRequestSchema, simulationWorldHirePlanPayloadSchema,
  WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN,
  WORLD_GOVERNANCE_HIRE_APPROVAL_DEFINITION, WORLD_NORM_ENACT_PIN,
  SimulationHireApprovalError, projectNorms, simulationEntityIdSchema, simulationInspectionSelectionSchema, worldResultIdSchema,
  simulationOperationIdSchema, simulationDispatchOutcomeSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, GovernanceWorldExecution, OrganizationWorldExecution, NormWorldExecution } from '@clocky/clocky-simulation-world'
import type { WorldExecutionHandler, SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests, modelInputs } from './world-norm-model.ts'

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
installed.runtimeProfiles[0]!.model = { provider: 'world-norm-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, org = original.world.organizationEntityId, committee = 'policy-committee'
const permissions = [{ entityId: proposer.id, pin: WORLD_GOVERNANCE_PROPOSE_PIN, relation: 'can-propose-norm' },
  { entityId: proposer.id, pin: WORLD_NORM_ENACT_PIN, relation: 'can-enact-norm' },
  { entityId: proposer.id, pin: WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, relation: 'can-approve-hire' },
  ...members.map(value => ({ entityId: value.id, pin: WORLD_GOVERNANCE_VOTE_PIN, relation: 'can-vote' }))]
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [...original.world.operations, WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN,
    WORLD_NORM_ENACT_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN],
  operationGrants: [...original.world.operationGrants, ...permissions.map(value => ({ requesterEntityId: value.entityId,
    domain: value.pin.domain, operation: value.pin.operation, version: value.pin.version, targetEntityId: committee,
    scopeEntityId: org, relation: value.relation, relationId: `permission:${value.relation}:${value.entityId}` }))],
  limits: { ...original.world.limits, maxRequests: 32,
    maxBirthsPerInterval: 32, maxExternalExpansionsPerInterval: 32, maxPendingMutations: 1,
    maxRequestsPerActorPerInterval: 32, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 } })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  native: { ...original.native, relationRules: [...original.native.relationRules,
    ...['committee-member', 'can-propose-norm', 'can-enact-norm', 'can-approve-hire', 'can-vote'].map(relation => ({ relation,
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
const proofPath = resolve(root, 'norm-proof.json')
const crashProof = resolve(root, 'norm-crash-proof.json')
const crashStage = process.env.WORLD_NORM_CRASH
assert.ok(crashStage)
const appendShape = z.object({ kind: z.string(), change: z.object({ kind: z.string(),
  action: z.object({ kind: z.string(), domain: z.string().optional(), operation: z.string().optional() }).loose().optional(),
  mutation: z.object({ pin: z.object({ operation: z.string() }).loose() }).loose().optional(),
  id: z.string().optional(), outcome: z.object({ status: z.string().optional() }).loose().optional(),
}).loose().optional() }).loose()
const ctx = await boot('world-norm', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `norm-${scenario}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('norm-initial'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  if (recovering) {
    const proof = z.object({ stage: z.string(), before: z.json(), durable: z.json(),
      entries: z.array(z.json()) }).parse(JSON.parse(await readFile(crashProof, 'utf8')))
    assert.equal(proof.stage, crashStage)
    assert.deepEqual(run.snapshot().world, proof.durable)
    assert.equal(run.snapshot().phase, 'paused')
    assert.equal(requests.length, 0)
    const world = run.snapshot().world!
    const voteCount = Object.keys(world.governance.votes).length
    const resolvedCount = Object.keys(world.governance.resolutions).length
    const normCount = Object.values(world.norms.versions).flat().length
    const announcementCount = Object.keys(world.norms.announcements).length
    if (crashStage === 'vote-before') assert.equal(voteCount, 0)
    if (crashStage === 'vote-after') assert.equal(voteCount, 1)
    if (crashStage === 'close-before') { assert.equal(voteCount, 2); assert.equal(resolvedCount, 0) }
    if (crashStage === 'close-after') { assert.equal(voteCount, 2); assert.equal(resolvedCount, 1) }
    if (crashStage === 'enact-before') { assert.equal(normCount, 0); assert.equal(announcementCount, 0) }
    if (crashStage === 'enact-after' || crashStage === 'notification-lost') {
      assert.equal(normCount, 1); assert.equal(announcementCount, 1)
      const request = Object.values(world.requests).find(value => value.pin.operation === 'enact-norm')!
      const plan = world.plans[request.plans.at(-1)!]!
      if (plan.proposal.resolution.kind !== 'apply') throw new Error('Restored original institution plan lost its accepted payload')
      const before = run.snapshot().revision
      const original = Object.values(world.results).find(value => value.requestId === request.id)
      assert.deepEqual(await run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.payload }), original)
      assert.equal(run.snapshot().revision, before)
    }
    if (crashStage === 'close-after') {
      const resolution = Object.values(world.governance.resolutions)[0]!
      const before = run.snapshot().revision
      assert.deepEqual(await run.closeWorldGovernance(resolution.proposalId), resolution)
      assert.equal(run.snapshot().revision, before)
    }
    if (crashStage === 'notification-lost') {
      const record = proof.entries.map(value => appendShape.parse(value)).find(value => value.kind === 'run/outbox'
        && value.change?.kind === 'outbox/finished')
      assert.ok(record?.change)
      const id = simulationOperationIdSchema.parse(record.change.id), receipt = simulationDispatchOutcomeSchema.parse(record.change.outcome)
      assert.ok(receipt.status === 'applied' && 'receipt' in receipt)
      const connection = restored?.connection
      assert.ok(connection)
      await run.setPhase('running', run.snapshot().revision)
      const settled = await connection.dispatchOperation(id, Date.now)
      assert.equal(settled.status, 'settled')
      assert.deepEqual(run.snapshot().operations[id]?.outbox?.receipt, receipt.receipt)
      await run.setPhase('paused', run.snapshot().revision)
      assert.deepEqual(run.snapshot().world, proof.durable)
      assert.equal(requests.length, 0)
    }
    console.log(JSON.stringify({ scenario, stage: crashStage, restored: true, voteCount, resolvedCount,
      normCount, announcementCount, modelCalls: requests.length }))
  } else {
    const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
      ownerName: `world-norm/${scenario}`, checkpoint: { id: simulationCheckpointIdSchema.parse('norm-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
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
        new NormWorldExecution(run, 'enact'), new HireApprovalExecution(run)]))
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
    const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream
    const append = stream.append.bind(stream)
    let captured = false
    stream.append = async (...args) => {
      let entries: z.infer<typeof appendShape>[]
      try { entries = args[1].map(value => appendShape.parse(value)) }
      catch (error) { process.stderr.write(`Actual append parsing failed: ${String(error)}\n`); throw error }
      const vote = entries.some(value => value.kind === 'run/business' && value.change?.kind === 'operation/intent'
      && value.change.action?.kind === 'world/request' && value.change.action.operation === 'vote')
      const close = entries.some(value => value.kind === 'run/world-governance' && value.change?.kind === 'world/governance-closed')
      const enact = entries.some(value => value.kind === 'run/world-mutation' && value.change?.mutation?.pin.operation === 'enact-norm')
      const notice = entries.some((value) => {
        if (value.kind !== 'run/outbox' || value.change?.kind !== 'outbox/finished' || value.change.outcome?.status !== 'applied') return false
        const operation = run.snapshot().operations[simulationOperationIdSchema.parse(value.change.id)]
        if (operation?.action.kind !== 'communication/post') return false
        let index: unknown
        try { index = JSON.parse(operation.action.text) } catch { return false /* Other real channel messages are not result notices. */ }
        const parsed = z.object({ resultId: z.string() }).safeParse(index)
        const result = parsed.success ? run.snapshot().world?.results[worldResultIdSchema.parse(parsed.data.resultId)] : undefined
        const plan = result?.source.kind === 'plan' ? run.snapshot().world?.plans[result.source.planId] : undefined
        return plan?.pin.operation === 'enact-norm'
      })
      const matches = crashStage.startsWith('vote-') && vote || crashStage.startsWith('close-') && close
      || crashStage.startsWith('enact-') && enact || crashStage === 'notification-lost' && notice
      const before = run.snapshot().world
      const hold = async () => {
        if (!matches || captured) return
        captured = true
        const observed = await ctx.simulations.inspect(simulationInspectionSelectionSchema.parse({ provider: selection.provider,
          spec: selection.spec, includeRecords: true }))
        assert.ok(observed)
        await writeFile(crashProof, JSON.stringify({ stage: crashStage, before,
          durable: observed.snapshot.world, entries: args[1] }))
        await recordR06Cut(ctx, run, selection, 'barrier')
        process.send?.('durable')
        await new Promise<void>((done) => { process.once('message', () => { done() }) })
      }
      if (crashStage.endsWith('-before') || crashStage === 'notification-lost') await hold()
      const receipt = await append(...args)
      if (crashStage.endsWith('-after')) await hold()
      return receipt
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
    }
    const state = run.snapshot(), owned = state.world!, norms = Object.values(owned.norms.versions).flat()
    assert.equal(norms.length, 1)
    const norm = norms[0]!, proposals = Object.values(owned.governance.proposals), votes = Object.values(owned.governance.votes)
    const policyProposal = proposals.find(value => value.target.kind === 'norm')!, approval = proposals.find(value => value.target.kind === 'hire-approval')!
    assert.equal(proposals.length, 2)
    assert.equal(votes.length, 4)
    assert.equal(Object.keys(owned.governance.resolutions).length, 2)
    assert.equal(norm.origin, 'governance')
    if (norm.origin !== 'governance') throw new Error('Approved institution must retain its real governance source')
    assert.equal(norm.proposal.id, policyProposal.id)
    assert.equal(norm.bodyHash, policyProposal.bodyHash)
    assert.equal(norm.enforcement.kind, 'validated')
    const enactRequest = Object.values(owned.requests).find(value => value.pin.operation === 'enact-norm')!
    const enactPlan = owned.plans[enactRequest.plans.at(-1)!]!
    if (enactPlan.proposal.resolution.kind !== 'apply') throw new Error('Expected exact original enacted plan')
    const enactedResult = Object.values(owned.results).find(value => value.requestId === enactRequest.id)!
    const beforeEnactRetry = run.snapshot().revision
    assert.deepEqual(await run.commitWorldMutation({ planId: enactPlan.id, payload: enactPlan.proposal.resolution.payload }), enactedResult)
    assert.equal(run.snapshot().revision, beforeEnactRetry)
    assert.equal(Object.keys(run.snapshot().world!.norms.announcements).length, 1)
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
    assert.equal(Object.keys(owned.norms.announcements).length, 1)
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
      assert.ok(modelInputs.some(value => value.includes('hire-approval-opportunities')))
      await run.setPhase('paused', run.snapshot().revision)
      await driver.drain()
      const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('norm-complete'),
        implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
      assert.equal(checkpoint.status, 'completed')
      if (checkpoint.status !== 'completed') throw new Error('Policy workflow checkpoint did not complete')
      assert.equal(checkpoint.manifest.state.world?.records.filter(value => value.kind === 'norm').length, 1)
      await writeFile(proofPath, JSON.stringify(proof()))
    }
    console.log(JSON.stringify({ scenario, enactedNorms: 1, perHireApprovals: 1, independentVotes: 4, committedHires: 1,
      actualChannel: true, restored: recovering, modelCalls: requests.length }))
  }
  await recordR06Cut(ctx, run, selection, 'final')
} finally {
  if (!recovering) for (const session of ctx.sessions.list()) for (const event of session.events) {
    if (event.type === 'tool/result') for (const block of event.data.message.content) {
      if (block.type === 'tool-result' && block.isError) process.stderr.write(JSON.stringify(block.content) + '\n')
    }
  }
  await run.close(); await ctx.fiber.dispose()
}
