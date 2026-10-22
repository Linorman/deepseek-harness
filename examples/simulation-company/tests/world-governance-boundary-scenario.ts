/** Real accepted ballots exercise productive closure, queued pause and actual process loss around its atomic append. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationPhaseManagementRequestSchema,
  simulationWakeRequestSchema, simulationWorldGoalSchema, governanceEarlyClosure, WORLD_GOVERNANCE_VOTE_PIN } from '@clocky/clocky-simulation'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, GovernanceWorldExecution } from '@clocky/clocky-simulation-world'
import type { LogStream } from '@clocky/clocky-storage'
import { requests } from './world-governance-model.ts'
import { scenario, proposer, voter, resolved } from './world-governance-composition.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), stage = process.env.WORLD_GOVERNANCE_BOUNDARY_STAGE
const round = Number(process.env.WORLD_GOVERNANCE_BOUNDARY_ROUND), face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
assert.ok(stage === 'before-close' || stage === 'after-close' || stage === 'pause-race')
assert.ok(round === 0 || round === 1 || round === 2)
const paths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world']
  .map(name => [name, import.meta.resolve(name)]))
assert.ok(Object.values(paths).every(path => path.includes(face === 'lib' ? '/lib/' : '/src/')))
if (face === 'lib') assert.deepEqual(process.execArgv, [])
const ctx = await boot('world-governance-boundary', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: round === 0 ? 'create' : 'open',
  spec: { runId: `governance-boundary-${stage}-${scenario}`, ...resolved.native } })
const checkpointId = simulationCheckpointIdSchema.parse(round === 2 ? 'governance-boundary-complete' : 'governance-boundary-initial')
const restored = round === 0 ? undefined : await ctx.simulationTeams.restore(selection,
  { id: checkpointId, implementationVersion: 'world/1', maxAttempts: 3 })
const run = restored?.run ?? await ctx.simulations.open(selection)
async function journal() {
  const stream = Reflect.get(run, 'stream') as LogStream, rows = []
  while ((rows.at(-1)?.sequence ?? -1) < stream.tailSequence) {
    const page = await stream.read(rows.at(-1)?.sequence ?? -1, 128)
    assert.ok(page.length); rows.push(...page)
  }
  return rows
}
async function record(name: string) {
  await writeFile(resolve(root, name), JSON.stringify({ pid: process.pid, face, stage, round, paths,
    votePin: WORLD_GOVERNANCE_VOTE_PIN, state: run.snapshot(), journal: await journal(), modelCalls: requests.length }, null, 2) + '\n')
}
try {
  if (round === 0) await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-governance-boundary/${stage}`, checkpoint: { id: checkpointId, maxDrainRounds: 4, maxAttempts: 3 } })
  const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']
  assert.equal(typeof ownerName, 'string')
  const connection = restored?.connection
    ?? await ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName as string)
  const anchor = { checkpointId, ownerName: ownerName as string, maxDrainRounds: 4, maxAttempts: 3 }
  const vote = new GovernanceWorldExecution(run, 'vote'), boundary = vote.settleBoundary
  assert.ok(boundary)
  let intercepted = false
  Object.assign(vote, { settleBoundary: async () => {
    const state = run.snapshot(), governance = state.world!.governance
    const eligible = Object.values(governance.proposals).find(value => governanceEarlyClosure(state, governance, value.id) !== undefined)
    if (round === 0 && eligible !== undefined && !intercepted) {
      intercepted = true
      assert.equal(Object.values(governance.votes).length, 2)
      assert.equal(state.activeWindowId, undefined)
      assert.ok(Object.values(state.world!.requests).some(value => value.pin.operation === 'vote' && value.plans.length === 0),
        'The final accepted vote must predate any director acknowledgement plan')
      await record('accepted.json')
      if (stage === 'before-close') { process.kill(process.pid, 'SIGKILL'); await new Promise(() => {}) }
      if (stage === 'pause-race') {
        const pause = run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'boundary-queued-pause', phase: 'paused' }))
        const closed = await boundary()
        await pause
        assert.equal(closed, false)
        assert.equal(Object.keys(run.snapshot().world!.governance.resolutions).length, 0)
        await record('pause-race.json')
        return false
      }
    }
    const progress = await boundary()
    if (round === 0 && stage === 'after-close' && progress) {
      await record('closed.json'); process.kill(process.pid, 'SIGKILL'); await new Promise(() => {})
    }
    if (round === 1 && progress) await run.managePhase(simulationPhaseManagementRequestSchema.parse({
      id: 'pause-after-recovered-boundary', phase: 'paused' }))
    return progress
  } })
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, new AbortController().signal, ctx,
    ctx.simulationWorldExecutions.handlers({ run, connection, resolved, anchor, lifetime: new AbortController().signal },
      [new GovernanceWorldExecution(run, 'proposal'), vote]))
  const advance = async () => {
    for (let i = 0; i < 8; i++) {
      const result = await driver.advance(run.snapshot().time)
      if (result.reason === 'work-limit') continue
      assert.ok(['idle', 'until', 'paused'].includes(result.reason), JSON.stringify(result))
      return result
    }
    throw new Error('Governance boundary driver did not finish its bounded batch')
  }
  const goal = async (entityId: string, id: string, text: string) => {
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id, entityId, time: run.snapshot().time,
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: text })) }), run.snapshot().revision)
    await advance()
  }
  if (round === 0) {
    await run.setPhase('running', run.snapshot().revision)
    await goal(proposer.id, 'proposal-goal', 'Propose the committee hiring policy. Independent votes must follow.')
    await goal(proposer.id, 'first-independent-vote', 'Read the original proposal and independently vote.')
    await goal(voter.id, 'second-independent-vote', 'Read the same original proposal and independently vote.')
    assert.equal(stage, 'pause-race'); assert.equal(intercepted, true)
    assert.equal(run.snapshot().phase, 'paused')
  } else {
    const accepted = JSON.parse(await readFile(resolve(root, 'accepted.json'), 'utf8')) as { state: ReturnType<typeof run.snapshot> }
    assert.deepEqual(run.snapshot().world!.governance.votes, accepted.state.world!.governance.votes)
    assert.equal(run.snapshot().phase, 'paused'); assert.equal(requests.length, 0)
    const original = run.snapshot()
    assert.equal((await advance()).reason, 'paused')
    assert.deepEqual(run.snapshot(), original)
    await record(`paused-${round}.json`)
    if (round === 1 && stage !== 'after-close') {
      assert.equal(Object.keys(original.world!.governance.resolutions).length, 0)
      const proposal = Object.values(original.world!.governance.proposals)[0]!
      assert.equal(await run.closeWorldGovernance(proposal.id, { boundary: true }), undefined)
      for (const options of [null, {}, { boundary: false }, { boundary: true, unknown: true }])
        await assert.rejects(Promise.resolve().then(() => run.closeWorldGovernance(proposal.id, options as never)))
      assert.deepEqual(run.snapshot(), original)
      await run.setPhase('running', original.revision)
      assert.equal((await advance()).reason, 'paused')
    }
    assert.equal(requests.length, 0)
    const governance = run.snapshot().world!.governance, resolution = Object.values(governance.resolutions)[0]!
    assert.ok(resolution); assert.equal(resolution.closure, 'all-voted'); assert.equal(resolution.outcome, 'passed')
    assert.deepEqual(resolution.votes.map(value => value.id).sort(), Object.values(governance.votes).map(value => value.id).sort())
    assert.equal(Object.keys(governance.resolutions).length, 1)
    const before = run.snapshot()
    assert.deepEqual(await run.closeWorldGovernance(resolution.proposalId, { boundary: true }), resolution)
    assert.deepEqual(run.snapshot(), before)
    if (round === 2) {
      const prior = JSON.parse(await readFile(resolve(root, 'recovered-1.json'), 'utf8')) as { state: ReturnType<typeof run.snapshot> }
      assert.deepEqual(governance, prior.state.world!.governance)
    }
    if (round === 1) {
      const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('governance-boundary-complete'),
        implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
      assert.equal(checkpoint.status, 'completed')
    }
  }
  await record(round === 0 ? 'warm.json' : `recovered-${round}.json`)
  console.log(JSON.stringify({ pid: process.pid, face, stage, round, paused: run.snapshot().phase === 'paused', modelCalls: requests.length }))
  await driver.drain(); await connection.close()
} finally { await run.close(); await ctx.fiber.dispose() }
