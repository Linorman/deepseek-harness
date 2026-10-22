/** Real Loader bootstrap and process-exit reconciliation before any actor activation or inference. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { teamIdSchema, channelIdSchema } from '@clocky/clocky-team'
import { simulationCheckpointIdSchema, simulationEntityBindingSchema, simulationEntityIdSchema,
  simulationChannelKeySchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { compileWorldScenario, scenarioCatalogSchema, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import type { SimulationWorldPreparation } from '@clocky/clocky-simulation-product'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-protocol-model.ts'

const scenario = z.enum(['company', 'laboratory']).parse(process.env.WORLD_SCENARIO)
const root = resolve(process.env.SIMULATION_COMPANY_ROOT ?? '')
const recovering = process.env.WORLD_PREPARATION_RECOVER === 'true'
const acceptedPath = resolve(root, 'accepted-world-definition.json'), proofPath = resolve(root, 'reserved-identities.json')
const acceptedSchema = z.strictObject({ compilerVersion: z.literal('1'), commandId: z.literal('create-original'),
  definition: worldScenarioSchema, catalog: scenarioCatalogSchema,
  resolved: z.json(), previewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) })
const identitySchema = z.strictObject({ teamId: teamIdSchema.optional(),
  actors: z.array(z.strictObject({ entityId: simulationEntityIdSchema, binding: simulationEntityBindingSchema })),
  channels: z.array(z.strictObject({ key: simulationChannelKeySchema, channelId: channelIdSchema })) })
const ctx = await boot('world-preparation', process.argv[2]!)
let modelCalls = 0
ctx.on('llm/stream', (_request, next) => { modelCalls += 1; return next() })
try {
  if (!recovering) {
    const definition = worldScenarioSchema.parse(JSON.parse(await readFile(
      resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
    const installed = catalog()
    installed.runtimeProfiles[0]!.model = { provider: 'world-scripted', name: 'scripted', version: '1', available: true }
    const compiled = await compileWorldScenario(definition, installed)
    assert.ok(compiled.ok)
    // The test creation owner persists original accepted inputs before allocating any identity.
    await writeFile(acceptedPath, JSON.stringify({ compilerVersion: '1', commandId: 'create-original',
      definition, catalog: installed, resolved: compiled.resolved, previewHash: compiled.preview.hash }))
  }
  const accepted = acceptedSchema.parse(JSON.parse(await readFile(acceptedPath, 'utf8')))
  const compiled = await compileWorldScenario(accepted.definition, accepted.catalog)
  assert.ok(compiled.ok)
  assert.equal(compiled.preview.hash, accepted.previewHash)
  // Deterministic validation uses the captured catalog, never current deployment defaults or a generation model.
  assert.deepEqual(compiled.resolved, accepted.resolved)
  const request: SimulationWorldPreparation = { resolved: compiled.resolved, ownerName: `world-test/${scenario}/${accepted.commandId}`,
    checkpoint: { id: simulationCheckpointIdSchema.parse('world-initial'), maxDrainRounds: 4, maxAttempts: 3 } }
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
    spec: { runId: `world-${scenario}`, ...request.resolved.native } })
  const run = await ctx.simulations.open(selection)
  const identityProof = () => identitySchema.parse({
    ...run.snapshot().teamReservation === undefined ? {} : { teamId: run.snapshot().teamReservation?.teamId },
    actors: Object.values(run.snapshot().entities).flatMap((entity) => {
      const binding = entity.participantReservation?.binding ?? entity.binding
      return binding === undefined ? [] : [{ entityId: entity.id, binding }]
    }),
    channels: Object.values(run.snapshot().channelReservations ?? {}).map(value => ({ key: value.spec.key, channelId: value.channelId })),
  })
  const hold = async (stage: string) => {
    if (recovering || process.env.WORLD_PREPARATION_CRASH !== stage) return
    await writeFile(proofPath, JSON.stringify(identityProof()))
    process.send?.('durable')
    await new Promise<void>((done) => { process.once('message', () => { done() }) })
  }
  if (!recovering) {
    const reserveParticipant = run.reserveParticipant.bind(run)
    run.reserveParticipant = async (...args) => {
      const state = await reserveParticipant(...args); await hold('participant-reserved'); return state
    }
    const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
    ctx.teams.inviteParticipant = async (...args) => {
      const participant = await invite(...args); await hold('participant-created'); return participant
    }
    const reserveChannel = run.reserveChannel.bind(run)
    run.reserveChannel = async (...args) => {
      const state = await reserveChannel(...args); await hold('channel-reserved'); return state
    }
    const openChannel = ctx.teams.openChannel.bind(ctx.teams)
    ctx.teams.openChannel = async (...args) => {
      const channel = await openChannel(...args); await hold('channel-created'); return channel
    }
    const change = run.change.bind(run)
    run.change = async (...args) => {
      const state = await change(...args)
      if (args[0].kind === 'entity/readiness' && args[0].readiness === 'ready') await hold('ready')
      return state
    }
  }
  try {
    const original = recovering ? identitySchema.parse(JSON.parse(await readFile(proofPath, 'utf8'))) : undefined
    const prepared = await prepareSimulationWorld(ctx.simulationTeams, run, request)
    await hold('checkpoint')
    const state = run.snapshot(), team = await ctx.teams.getTeam({ teamId: prepared.teamId })
    assert.equal(state.phase, 'paused')
    assert.equal(state.time, '0')
    assert.equal(Object.keys(state.entities).length, 5)
    assert.equal(team.participants.length, 3)
    assert.equal(team.activations.length, 0)
    assert.deepEqual(team.rules['teamLimits'], request.resolved.limits.team)
    assert.ok(Object.values(state.entities).every(entity => entity.readiness === 'ready'))
    assert.ok(prepared.checkpoint.manifest.sessions.every(session => session.kind === 'unmaterialized'))
    assert.deepEqual(await ctx.sessionPersistence.list(), [])
    const revision = state.revision
    assert.deepEqual(await prepareSimulationWorld(ctx.simulationTeams, run, request), prepared)
    assert.equal(run.snapshot().revision, revision)
    if (original !== undefined) {
      assert.equal(prepared.teamId, original.teamId)
      for (const actor of original.actors) assert.deepEqual(prepared.actors[actor.entityId], actor.binding)
      for (const channel of original.channels) assert.equal(prepared.channels[channel.key], channel.channelId)
    }
    assert.equal(modelCalls, 0)
    assert.equal(requests.length, 0)
    console.log(JSON.stringify({ scenario, phase: 'paused', entities: 5, actors: 3, channels: 2,
      ready: true, initialWake: Object.keys(state.scheduledEvents).length, checkpoint: 'completed',
      identityPreserved: true, originalDefinitionPreserved: true, frozenTeamLimits: true, modelCalls: 0, sessionsMaterialized: 0 }))
  } finally { await run.close() }
} finally { await ctx.fiber.dispose() }
