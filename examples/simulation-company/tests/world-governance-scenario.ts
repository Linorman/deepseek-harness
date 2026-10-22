/** Real Loader, independent Agent Sessions, atomic Native votes, sole resolution and cold restoration. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema,
  simulationWakeRequestSchema, simulationWorldGoalSchema,
  simulationGovernanceVoteInputSchema, simulationDecisionIdSchema, simulationEntityIdSchema, simulationChangeSchema } from '@clocky/clocky-simulation'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, GovernanceWorldExecution } from '@clocky/clocky-simulation-world'
import { requests, modelInputs } from './world-governance-model.ts'
import { contextRequest } from '../../../packages/simulation/simulation-local/tests/context-fixture.ts'
import type { LogStream } from '@clocky/clocky-storage'

const disclosureBoundary = process.env.WORLD_GOVERNANCE_DISCLOSURE_BOUNDARY
if (disclosureBoundary !== undefined) assert.ok(['cached', 'pre-step'].includes(disclosureBoundary))

import { scenario, members, proposer, voter, resolved, org } from './world-governance-composition.ts'
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
const proofPath = resolve(root, 'governance-proof.json')
const ctx = await boot('world-governance', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `governance-${scenario}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('governance-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-governance/${scenario}`, checkpoint: { id: simulationCheckpointIdSchema.parse('governance-initial'),
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
  const originalRecords = async () => {
    const rows = [], stream = Reflect.get(run, 'stream') as LogStream
    while ((rows.at(-1)?.sequence ?? -1) < stream.tailSequence) {
      const page = await stream.read(rows.at(-1)?.sequence ?? -1, 128); assert.ok(page.length); rows.push(...page)
    }
    return { state: run.snapshot(), journal: rows, sessions: await Promise.all(Object.values(run.snapshot().entities)
      .flatMap(entity => entity.binding === undefined ? [] : [(async () => ({ entityId: entity.id, binding: entity.binding,
        events: (await ctx.sessionPersistence.readFrom(entity.binding!.sessionId, 0)).events }))()])) }
  }
  if (!recovering) {
    await run.setPhase('running', run.snapshot().revision)
    await goal(proposer.id, 'proposal-goal', 'Propose the committee hiring policy. Independent votes must follow.')
    const proposal = Object.values(run.snapshot().world!.governance.proposals)[0]!
    if (disclosureBoundary !== undefined) {
      const actor = simulationEntityIdSchema.parse(proposer.id), id = simulationDecisionIdSchema.parse('non-goal-vote-disclosure')
      const originalRequest = Object.values(run.snapshot().world!.requests).find(value => value.pin.operation === 'propose-norm')!
      const request = { ...contextRequest(), world: { kind: 'request' as const, intentId: originalRequest.intentId } }
      await connection.openDecision(actor, id)
      const prepared = await connection.prepareContext(actor, id, request)
      assert.equal(prepared.status, 'prepared'); if (prepared.status !== 'prepared') throw new Error('Probe context overflowed')
      assert.equal(prepared.world?.kind, 'request'); assert.equal(prepared.world.governance?.length, 1)
      assert.equal(prepared.world.governanceAccess?.[0]?.proposal.bodyHash, proposal.bodyHash)
      const agent = ctx.agents.get(run.snapshot().entities[actor]!.binding!.sessionId)!; assert.ok(agent)
      const history = structuredClone(agent.session.events), calls = requests.length
      const grant = Object.values(run.snapshot().relations).find(value => value.subject === actor && value.relation === 'can-vote')!
      const { revision: grantRevision, ...grantFields } = grant
      const revoke = async () => await run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...grantFields,
        relationRevision: grantRevision, object: org }), run.snapshot().revision)
      let remove: (() => void) | undefined, work: Promise<unknown> | undefined
      const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      try {
        if (disclosureBoundary === 'pre-step') {
          remove = ctx.on('agent/pre-step', async ({ agent: actual }, next) => {
            if (actual !== agent) return await next()
            entered.resolve(undefined); await release.promise; return await next()
          })
          work = connection.executeDecision(actor, id, request).catch((error: unknown) => error)
          await Promise.race([entered.promise, work.then(() => { throw new Error('Probe missed pre-step wait') })])
        }
        await revoke()
        await assert.rejects(connection.prepareContext(actor, id, request), /governance body authority/)
        if (work === undefined) await assert.rejects(connection.executeDecision(actor, id, request), /governance body authority/)
        else { release.resolve(undefined); assert.ok(await work instanceof Error) }
        assert.deepEqual(agent.session.events.slice(0, history.length), history)
        const refusedEvents = agent.session.events.slice(history.length)
        assert.ok(refusedEvents.every(event => ['agent/inbox/spliced', 'turn/start', 'turn/end'].includes(event.type)))
        assert.equal(JSON.stringify(refusedEvents).includes(proposal.body), false)
        assert.equal(requests.length, calls)
        assert.deepEqual(run.snapshot().decisions[id]!.context, prepared)
        await writeFile(resolve(root, 'disclosure-proof.json'), JSON.stringify({ boundary: disclosureBoundary, prepared,
          before: { history, calls }, after: { history: agent.session.events, calls: requests.length, state: run.snapshot() } }, null, 2) + '\n')
      } finally { release.resolve(undefined); if (work !== undefined) await work; remove?.() }
      await connection.cancelDecision(actor, id)
      const changed = run.snapshot().relations[grant.id]!
      await run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...grantFields, relationRevision: changed.revision }), run.snapshot().revision)
    }
    assert.equal(Object.keys(run.snapshot().world!.governance.votes).length, 0)
    await assert.rejects(run.closeWorldGovernance(proposal.id), /Remaining legal votes/)
    await goal(proposer.id, 'first-independent-vote', 'Read the original proposal and independently vote.')
    assert.equal(Object.keys(run.snapshot().world!.governance.votes).length, 1)
    await assert.rejects(run.closeWorldGovernance(proposal.id), /Remaining legal votes/)
    await goal(voter.id, 'second-independent-vote', 'Read the same original proposal and independently vote.')
    const resolution = Object.values(run.snapshot().world!.governance.resolutions).find(value => value.proposalId === proposal.id)
    assert.ok(resolution, 'The production governance boundary must close the original ballots')
    assert.equal(resolution.outcome, 'passed')
    const retry = run.snapshot().revision
    assert.deepEqual(await run.closeWorldGovernance(proposal.id), resolution)
    assert.equal(run.snapshot().revision, retry)
    await advance()
  }
  const state = run.snapshot(), governance = state.world!.governance
  const proposal = Object.values(governance.proposals)[0]!, votes = Object.values(governance.votes)
  const resolution = Object.values(governance.resolutions)[0]!
  assert.equal(Object.keys(governance.proposals).length, 1)
  assert.equal(votes.length, 2)
  assert.equal(Object.keys(governance.resolutions).length, 1)
  assert.equal(new Set(votes.map(value => value.source.binding.sessionId)).size, 2)
  assert.equal(new Set(votes.map(value => value.source.binding.participantId)).size, 2)
  assert.deepEqual(votes.map(value => value.voter).sort(), members.map(value => value.id).sort())
  for (const vote of votes) {
    const decision = state.decisions[vote.source.decisionId]!
    assert.equal(decision.entityId, vote.voter)
    assert.equal(decision.epoch, vote.source.epoch)
    assert.equal(decision.status, 'accepted')
    assert.equal(decision.consumption?.sessionId, vote.source.binding.sessionId)
    assert.equal(vote.bodyHash, proposal.bodyHash)
    assert.equal(vote.choice, 'yes')
  }
  assert.equal(resolution.outcome, 'passed')
  assert.deepEqual(resolution.counts, { yes: 2, no: 0, abstain: 0, missing: 0 })
  assert.equal(state.scheduledEvents[resolution.wakeId]?.action.kind, 'wake')
  assert.equal(Object.values(state.world!.results).filter(value => value.outcome.kind === 'committed').length, 3)
  assert.ok(Object.values(state.operations).filter(value => value.action.kind === 'communication/post')
    .every(value => value.delivery?.receipt !== undefined))
  assert.throws(() => simulationGovernanceVoteInputSchema.parse({ proposalId: proposal.id, proposalRevision: 1,
    bodyHash: proposal.bodyHash, choice: 'yes', voter: proposer.id }))
  const proof = { governance, requests: state.world!.requests, plans: state.world!.plans,
    results: state.world!.results, mutations: state.world!.mutations, wake: state.scheduledEvents[resolution.wakeId] }
  if (recovering) {
    assert.deepEqual(proof, JSON.parse(await readFile(proofPath, 'utf8')))
    assert.equal(state.phase, 'paused')
    assert.equal(requests.length, 0)
  } else {
    await run.setPhase('paused', run.snapshot().revision)
    await driver.drain()
    const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('governance-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
    if (checkpoint.status !== 'completed') throw new Error('Governance checkpoint did not complete')
    for (const [kind, count] of [['proposal', 1], ['vote', 2], ['resolution', 1]] as const)
      assert.equal(checkpoint.manifest.state.world?.records.filter(value => value.kind === kind).length, count)
    await writeFile(proofPath, JSON.stringify(proof))
  }
  if (disclosureBoundary !== undefined) {
    const records = await originalRecords()
    if (recovering) assert.deepEqual(records, JSON.parse(await readFile(resolve(root, 'disclosure-original.json'), 'utf8')))
    else await writeFile(resolve(root, 'disclosure-original.json'), JSON.stringify({ ...records }, null, 2) + '\n')
    await writeFile(resolve(root, recovering ? 'disclosure-cold.json' : 'disclosure-warm.json'),
      JSON.stringify({ ...records, pid: process.pid, modelInputs, modelCalls: requests.length }, null, 2) + '\n')
  }
  console.log(JSON.stringify({ scenario, independentSessions: 2, actualVotes: 2, actualChannel: true,
    soleResolution: true, restored: recovering, modelCalls: requests.length,
    ...disclosureBoundary === undefined ? {} : { disclosureBoundary } }))
} finally { await run.close(); await ctx.fiber.dispose() }
