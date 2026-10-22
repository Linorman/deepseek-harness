/** Actual public v1 preparation pauses at durable cross-owner boundaries for OS SIGKILL and original cold retry. */
import assert from 'node:assert/strict'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot } from '@clocky/clocky-simulation'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { LogStream } from '@clocky/clocky-storage'
import { simulationProductWorldCreateInputSchema } from '@clocky/clocky-simulation-product'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product'
import type { SimulationWorldCreation } from '@clocky/clocky-simulation-product/src/world-creation.ts'
import { worldV1Definition } from './fixtures/world-v1-preparation-fault/deployment.ts'
import { mediatedModelRequests } from './world-external-mediated-model.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), stage = process.env.WORLD_V1_PREPARATION_STAGE!
const round = Number(process.env.WORLD_V1_PREPARATION_ROUND ?? '0'), face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const backend = process.env.SIMULATION_COMPANY_BACKEND!
assert.ok(['src', 'lib'].includes(face)); assert.ok(['json', 'sqlite'].includes(backend)); assert.ok([0, 1, 2].includes(round))
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-product',
  '@clocky/clocky-simulation-product/administration', '@clocky/clocky-simulation-scenario'].map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(face === 'lib' ? '/lib/' : '/src/'), path)
if (face === 'lib') { assert.deepEqual(process.execArgv, []); assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false) }
const ctx = await boot('world-v1-preparation-fault', process.argv[2]!)
const call: AuthenticatedProductCall = { principal: { id: 'c31-owner' as never, issuer: 'c31-loader', subject: 'c31-owner',
  assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
const administration = ctx.simulationAdministration, commandStream = ctx.storageLog.get('c31-v1-commands')!
const shape = z.object({ kind: z.string(), command: z.object({ kind: z.string() }).loose().optional(),
  change: z.object({ kind: z.string() }).loose().optional() }).loose()
let currentRun: SimulationRun | undefined, reached = false, realIOFault = false
const checkpointIOFailure = stage === 'checkpoint-session-read-io-failed'
async function entries(stream: LogStream) {
  const output = []; let after = -1
  while (after < stream.tailSequence) { const page = await stream.read(after, 128); assert.ok(page.length)
    output.push(...page); after = page.at(-1)!.sequence }
  return output
}
async function originalCreation(): Promise<SimulationWorldCreation> {
  const journal = await entries(commandStream)
  const accepted = journal.find(entry => shape.parse(entry.value).kind === 'command/accepted')!
  assert.ok(accepted)
  return (accepted.value as { command: { creation: SimulationWorldCreation } }).command.creation
}
async function finished(commandId: SimulationProductWorldCreateInput['commandId']) {
  let result = await administration.request({ commandId }, call)
  const deadline = Date.now() + 20000
  while (result.status === 'found' && result.request.status === 'accepted' && Date.now() < deadline) {
    await delay(20); result = await administration.request({ commandId }, call)
  }
  assert.ok(result.status === 'found')
  return result
}
async function actual(state: SimulationSnapshot | undefined) {
  const info = await ctx.storage.backend.get(backend).log!.list()
  const teamId = state?.teamReservation?.teamId
  const teamExists = teamId !== undefined && info.some(value => value.name.includes(teamId) && value.tailSequence >= 0)
  const team = teamExists ? await ctx.teams.getTeam({ teamId: teamId }) : undefined
  const teamJournal = team === undefined ? [] : await entries(ctx.storageLog.get(`team/${team.team.id}`)!)
  const channels = await Promise.all((team?.channelIds ?? []).map(async channelId => ({ channelId,
    admission: await ctx.teams.getChannelAdmission({ channelId }),
    records: (await ctx.teams.readChannelPage({ channelId, afterCursor: -1, limit: 128 })).records })))
  const sessions = await Promise.all(Object.values(state?.entities ?? {}).flatMap((entity) => {
    const binding = entity.binding ?? entity.participantReservation?.binding
    return binding === undefined ? [] : [(async () => {
      if (checkpointIOFailure && round === 0 && realIOFault) return { entityId: entity.id, binding,
        pendingColdSourceRead: true, actualCollectionFailure: 'ENOTDIR' }
      assert.equal(await ctx.sessionPersistence.isUnmaterialized(binding.sessionId), true)
      assert.equal(ctx.agents.get(binding.sessionId), undefined)
      return { entityId: entity.id, binding, unmaterialized: true }
    })()]
  }))
  return { info, team, teamJournal, channels, sessions }
}
async function inspected() {
  const creation = await originalCreation()
  const observation = await ctx.simulations.inspect(ctx.simulations.resolveInspection({ provider: creation.record.provider,
    spec: simulationRunSpecSchema.parse(creation.record.spec), includeRecords: true }))
  return { creation, observation, actual: await actual(observation?.snapshot), commandJournal: await entries(commandStream) }
}
async function hold(cause: unknown): Promise<void> {
  assert.equal(reached, false); reached = true
  const proof = await inspected()
  assert.equal(mediatedModelRequests.length, 0)
  await writeFile(resolve(root, 'durable-prefix.json'), JSON.stringify({ stage, cause, ...proof, modelCalls: 0 }, null, 2))
  process.send?.({ event: 'v1-preparation-boundary', stage })
  await new Promise<void>((done) => { process.once('message', () => { done() }) })
}
function nativeBoundary(value: unknown): string | undefined {
  const row = shape.parse(value)
  if (row.kind === 'run/team-reserved') return 'team-reserved'
  if (row.kind === 'run/team-confirmed') return 'team-confirmed'
  if (row.kind === 'run/participant-reserved') return 'participant-reserved'
  if (row.kind === 'run/channel-reserved') return 'channel-reserved'
  if (row.kind === 'run/channel-confirmed') return 'channel-confirmed'
  if (row.kind === 'run/change' && row.command?.kind === 'entity/create') return 'entity-created'
  if (row.kind === 'run/writer' && row.change?.kind === 'entity/bound') return 'participant-bound'
  if (row.kind === 'run/change' && row.command?.kind === 'relation/create') return 'relation-created'
  if (row.change?.kind === 'world-bootstrap/retained') return 'bootstrap-retained'
  if (row.change?.kind === 'world-bootstrap/applied') return 'bootstrap-applied'
  if (row.change?.kind === 'checkpoint/requested') return 'checkpoint-requested'
  if (row.change?.kind === 'checkpoint/published') return 'checkpoint-published-lost'
  return undefined
}
if (round === 0) {
  const append = commandStream.append.bind(commandStream)
  commandStream.append = async (...args) => {
    const result = await append(...args)
    const target = args[1].some(value => shape.parse(value).kind === (stage === 'command-completed-lost' ? 'command/completed' : 'command/accepted'))
    if (!reached && target && ['command-accepted', 'command-completed-lost'].includes(stage)) await hold(args[1])
    return result
  }
  const open = ctx.simulations.open.bind(ctx.simulations)
  ctx.simulations.open = async (selection) => {
    const run = await open(selection); currentRun = run
    const stream = Reflect.get(run, 'stream') as LogStream, append = stream.append.bind(stream)
    stream.append = async (...args) => {
      const target = args[1].some(value => nativeBoundary(value) === stage
        || stage === 'bootstrap-before-applied' && nativeBoundary(value) === 'bootstrap-applied')
      if (!reached && target && stage === 'bootstrap-before-applied') await hold(args[1])
      const result = await append(...args)
      if (!realIOFault && checkpointIOFailure && args[1].some(value => nativeBoundary(value) === 'checkpoint-requested')) {
        const path = resolve(root, 'sessions')
        await mkdir(path, { recursive: true })
        await rename(path, resolve(root, 'session-root-preserved'))
        await writeFile(path, 'A real file occupies the Session persistence directory during checkpoint collection.\n')
        realIOFault = true
      }
      if (!reached && target) await hold(args[1])
      return result
    }
    return run
  }
  const createTeam = ctx.teams.createTeam.bind(ctx.teams)
  ctx.teams.createTeam = async (request) => { const value = await createTeam(request)
    if (!reached && stage === 'team-created-lost') await hold({ operation: stage, target: value }); return value }
  const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
  ctx.teams.inviteParticipant = async (request) => { const value = await invite(request)
    if (!reached && stage === 'participant-invited-lost') await hold({ operation: stage, target: value }); return value }
  const transition = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
  ctx.teams.transitionParticipantPhase = async (request) => { const value = await transition(request)
    if (!reached && stage === 'participant-active-before-bind' && request.phase === 'active') await hold({ operation: stage, target: value }); return value }
  const openChannel = ctx.teams.openChannel.bind(ctx.teams)
  ctx.teams.openChannel = async (request) => { const value = await openChannel(request)
    if (!reached && stage === 'channel-opened-lost') await hold({ operation: stage, target: value }); return value }
  const consent = ctx.teams.acknowledgeChannelInvitation.bind(ctx.teams)
  ctx.teams.acknowledgeChannelInvitation = async (request) => { const value = await consent(request)
    if (!reached && stage === 'channel-partial-consent') await hold({ operation: stage, target: value }); return value }
}
try {
  const originalPath = resolve(root, 'original-command.json')
  let input: SimulationProductWorldCreateInput
  if (round === 0) {
    const preview = await administration.preflightWorld({ definition: worldV1Definition }, call)
    assert.ok(preview.status === 'ready', JSON.stringify(preview))
    input = simulationProductWorldCreateInputSchema.parse({ commandId: 'original-fault-v1', name: 'Original v1 fault scene',
      definition: worldV1Definition, preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } })
    await writeFile(originalPath, JSON.stringify(input, null, 2))
  } else input = simulationProductWorldCreateInputSchema.parse(JSON.parse(await readFile(originalPath, 'utf8')))
  await administration.createWorld(input, call)
  let outcome = await administration.request({ commandId: input.commandId }, call)
  const deadline = Date.now() + 20000
  while (outcome.status === 'found' && outcome.request.status === 'accepted' && Date.now() < deadline) {
    await delay(20); outcome = await administration.request({ commandId: input.commandId }, call)
  }
  assert.ok(outcome.status === 'found')
  let recoveryOutcome: Awaited<ReturnType<typeof finished>> | undefined
  if (checkpointIOFailure) {
    assert.equal(outcome.request.status, 'failed', JSON.stringify(outcome))
    if (round === 0) {
      assert.ok(realIOFault)
      await rename(resolve(root, 'sessions'), resolve(root, 'session-root-blocking-file.txt'))
      await rename(resolve(root, 'session-root-preserved'), resolve(root, 'sessions'))
      await hold({ realFilesystemFault: 'ENOTDIR', originalFailedReceipt: outcome.request })
    } else {
      const recovery = { runId: outcome.request.runId, commandId: 'original-v1-checkpoint-recovery' as never }
      await administration.prepareWorld(recovery, call)
      recoveryOutcome = await finished(recovery.commandId)
      assert.equal(recoveryOutcome.request.status, 'completed', JSON.stringify(recoveryOutcome))
    }
  } else assert.equal(outcome.request.status, 'completed', JSON.stringify(outcome))
  assert.notEqual(round, 0, 'Requested real barrier was not reached')
  const proof = await inspected(), state = proof.observation!.snapshot, creation = proof.creation, resolved = creation.preparation.resolved
  assert.ok(resolved.apiVersion === 'clocky.world/v1'); assert.deepEqual(creation.request, input)
  const prefix = JSON.parse(await readFile(resolve(root, 'durable-prefix.json'), 'utf8')) as Awaited<ReturnType<typeof inspected>>
  assert.deepEqual(prefix.creation, creation)
  assert.deepEqual(proof.commandJournal.slice(0, prefix.commandJournal.length), prefix.commandJournal)
  assert.deepEqual(proof.actual.teamJournal.slice(0, prefix.actual.teamJournal.length), prefix.actual.teamJournal)
  for (const channel of prefix.actual.channels) {
    const current = proof.actual.channels.find(value => value.channelId === channel.channelId)!
    assert.ok(current)
    assert.deepEqual(current.admission.channel.manifest, channel.admission.channel.manifest)
    assert.deepEqual(current.records.slice(0, channel.records.length), channel.records)
  }
  const prior = prefix.observation?.snapshot
  if (prior !== undefined) {
    assert.equal(state.teamReservation?.teamId, prior.teamReservation?.teamId)
    for (const entity of Object.values(prior.entities)) {
      assert.deepEqual(state.entities[entity.id]!.profile, entity.profile)
      const binding = entity.binding ?? entity.participantReservation?.binding
      if (binding !== undefined) assert.deepEqual(state.entities[entity.id]!.binding, binding)
    }
    for (const [key, channel] of Object.entries(prior.channelReservations ?? {}))
      assert.equal(state.channelReservations![key as never]!.channelId, channel.channelId)
    assert.deepEqual(proof.observation!.records!.slice(0, prefix.observation!.records!.length), prefix.observation!.records)
    if (prior.worldBootstrap !== undefined) {
      assert.equal(state.worldBootstrap!.sequence, prior.worldBootstrap.sequence)
      assert.deepEqual(state.worldBootstrap!.request, prior.worldBootstrap.request)
    }
  }
  assert.equal(state.phase, 'paused'); assert.equal(state.time, '0'); assert.equal(mediatedModelRequests.length, 0)
  assert.deepEqual(state.worldBootstrap!.request.data, resolved.bootstrap)
  assert.deepEqual(state.worldBootstrap!.request.definition, resolved.world)
  assert.equal(state.worldBootstrap!.status, 'applied'); assert.equal(state.world!.sequence, state.worldBootstrap!.appliedSequence)
  assert.deepEqual(state.world!.intents, {}); assert.deepEqual(state.decisions, {}); assert.deepEqual(state.operations, {})
  assert.deepEqual(state.world!.governance, { proposals: {}, votes: {}, resolutions: {} })
  assert.equal(Object.keys(state.entities).length, resolved.entities.length)
  assert.equal(Object.keys(state.relations).length, resolved.relations.length)
  assert.ok(Object.values(state.entities).every(value => value.readiness === 'ready' && value.writer === undefined))
  assert.equal(proof.actual.sessions.length, 3); assert.equal(proof.actual.team!.participants.length, 3)
  assert.equal(proof.actual.channels.length, 3)
  assert.equal(proof.actual.team!.activations.length, 0); assert.equal(proof.actual.team!.tasks.length, 0)
  assert.equal(await ctx.sessionPersistence.list().then(value => value.length), 0)
  const records = proof.observation!.records!
  for (const kind of ['world-bootstrap/retained', 'world-bootstrap/applied', 'checkpoint/requested', 'checkpoint/published'])
    assert.equal(records.filter(entry => shape.parse(entry.value).change?.kind === kind).length,
      checkpointIOFailure && kind === 'checkpoint/requested' ? 2 : 1, kind)
  const checkpoint = state.checkpoints![state.latestCheckpointId!]!
  assert.ok(checkpoint.status === 'completed')
  assert.equal(checkpoint.request.id, checkpointIOFailure ? 'product-world-prepare/original-v1-checkpoint-recovery'
    : creation.preparation.checkpoint.id)
  assert.ok(checkpoint.manifest.sessions.every(value => value.kind === 'unmaterialized'))
  assert.deepEqual(await administration.createWorld(input, call), outcome.request)
  assert.deepEqual(await administration.exportWorldDefinition({ runId: outcome.request.runId }, call),
    { runId: outcome.request.runId, definition: input.definition })
  assert.deepEqual(await entries(commandStream), proof.commandJournal)
  await writeFile(resolve(root, `cold-${round}.json`), JSON.stringify({ stage, round, ...proof, outcome, recoveryOutcome,
    modelCalls: mediatedModelRequests.length, runtimePaths, execArgv: process.execArgv }, null, 2))
  if (round === 2) {
    const first = JSON.parse(await readFile(resolve(root, 'cold-1.json'), 'utf8')) as typeof proof
    assert.equal(proof.observation!.owner, 'unowned')
    assert.deepEqual(proof.creation, first.creation)
    assert.deepEqual(proof.observation!.snapshot, first.observation!.snapshot)
    assert.deepEqual(proof.observation!.records, first.observation!.records)
    assert.deepEqual(proof.actual, first.actual)
    assert.deepEqual(proof.commandJournal, first.commandJournal)
  }
  process.stdout.write(JSON.stringify({ stage, round, face, backend, phase: state.phase, modelCalls: 0,
    originalInputRetained: true, originalCanonicalIdsRetained: true, originalDataAppliedOnce: true, checkpointPublishedOnce: true,
    runtimePaths, execArgv: process.execArgv }) + '\n')
} finally { if (!reached) await currentRun?.close(); await ctx.fiber.dispose() }
