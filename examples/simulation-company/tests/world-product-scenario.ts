/** Authenticated World creation retains one original command and identities across real process exits. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductWorldCreateInputSchema, simulationProductRunIdSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationEntityBindingSchema, simulationEntityIdSchema, simulationChannelKeySchema,
  simulationRunSpecSchema } from '@clocky/clocky-simulation'
import { teamIdSchema, channelIdSchema } from '@clocky/clocky-team'
import { compileWorldScenario, exportWorldScenarioText, parseWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-protocol-model.ts'

const scenario = z.enum(['company', 'laboratory']).parse(process.env.WORLD_SCENARIO)
const recovering = process.env.WORLD_PRODUCT_RECOVER === 'true', root = resolve(process.env.SIMULATION_COMPANY_ROOT ?? '')
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-scripted', name: 'scripted', version: '1', available: true }
process.env.WORLD_PRODUCT_CONFIGURATION = JSON.stringify({ provider: 'local', catalog: installed,
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })
const ctx = await boot('world-product-creation', process.argv[2]!)
const proofPath = resolve(root, 'world-original-proof.json'), inputPath = resolve(root, 'world-original-input.json')
const proofSchema = z.strictObject({ runId: simulationProductRunIdSchema, spec: simulationRunSpecSchema, teamId: teamIdSchema.optional(),
  actors: z.array(z.strictObject({ entityId: simulationEntityIdSchema, binding: simulationEntityBindingSchema })),
  channels: z.array(z.strictObject({ key: simulationChannelKeySchema, channelId: channelIdSchema })) })
let owned: import('@clocky/clocky-simulation').SimulationRun | undefined
let originalRunId: ReturnType<typeof simulationProductRunIdSchema.parse> | undefined
let originalSpec: ReturnType<typeof simulationRunSpecSchema.parse> | undefined
let modelCalls = 0
ctx.on('llm/stream', (_options, next) => { modelCalls += 1; return next() })
const hold = async (stage: string) => {
  if (recovering || process.env.WORLD_PRODUCT_CRASH !== stage) return
  assert.ok(originalRunId)
  assert.ok(originalSpec)
  const state = owned?.snapshot()
  await writeFile(proofPath, JSON.stringify({ runId: originalRunId, spec: originalSpec,
    ...state?.teamReservation === undefined ? {} : { teamId: state.teamReservation.teamId },
    actors: Object.values(state?.entities ?? {}).flatMap((entity) => {
      const binding = entity.participantReservation?.binding ?? entity.binding
      return binding === undefined ? [] : [{ entityId: entity.id, binding }]
    }),
    channels: Object.values(state?.channelReservations ?? {}).map(value => ({ key: value.spec.key, channelId: value.channelId })),
  }))
  process.send?.('durable')
  await new Promise<void>((done) => { process.once('message', () => { done() }) })
}
const terminal = Promise.withResolvers<undefined>()
const commands = ctx.storageLog.get('world-product-commands')
assert.ok(commands)
const append = commands.append.bind(commands)
commands.append = async (...args) => {
  const result = await append(...args)
  // This extracts identity evidence from the already validated producer value; the product owner owns full replay parsing.
  const record = z.object({ kind: z.string(), commandId: z.string().optional(), command: z.object({ kind: z.string(),
    creation: z.object({ record: z.object({ id: simulationProductRunIdSchema, spec: simulationRunSpecSchema }) }).optional() })
    .optional() })
    .parse(args[1][0])
  if (record.kind === 'command/accepted' && record.command?.kind === 'world-create') {
    originalRunId = record.command.creation?.record.id
    originalSpec = record.command.creation?.record.spec
    await hold('accepted')
  }
  if (record.commandId === 'original-world' && (record.kind === 'command/completed' || record.kind === 'command/failed')) {
    await hold('terminal')
    setImmediate(() => { terminal.resolve(undefined) })
  }
  return result
}
const open = ctx.simulations.open.bind(ctx.simulations)
ctx.simulations.open = async (...args) => {
  const run = await open(...args)
  owned = run
  const reserve = run.reserveParticipant.bind(run)
  run.reserveParticipant = async (...input) => {
    await hold(`before-participant-reserved/${input[0]}`)
    const state = await reserve(...input)
    await hold(`after-participant-reserved/${input[0]}`)
    await hold('participant-reserved')
    return state
  }
  const channel = run.reserveChannel.bind(run)
  run.reserveChannel = async (...input) => {
    await hold(`before-channel-reserved/${input[0].key}`)
    const state = await channel(...input)
    await hold(`after-channel-reserved/${input[0].key}`)
    await hold('channel-reserved')
    return state
  }
  const change = run.change.bind(run)
  run.change = async (...input) => {
    if (input[0].kind === 'entity/readiness') await hold(`before-ready/${input[0].id}`)
    const state = await change(...input)
    if (input[0].kind === 'entity/readiness') await hold(`after-ready/${input[0].id}`)
    if (input[0].kind === 'entity/readiness') await hold('ready')
    return state
  }
  return run
}
const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
ctx.teams.inviteParticipant = async (...args) => {
  const target = Object.values(owned?.snapshot().entities ?? {}).find(entity =>
    entity.participantReservation?.participant.displayName === args[0].displayName)?.id
  await hold(`before-participant-created/${target}`)
  const actor = await invite(...args)
  await hold(`after-participant-created/${target}`)
  await hold('participant-created')
  return actor
}
const channel = ctx.teams.openChannel.bind(ctx.teams)
ctx.teams.openChannel = async (...args) => {
  const state = owned?.snapshot()
  const target = Object.values(state?.channelReservations ?? {}).find(reservation => args[0].participants.every(endpoint =>
    reservation.spec.members.some(member => state?.entities[member.entityId]?.binding?.participantId === endpoint.id)))?.spec.key
  await hold(`before-channel-created/${target}`)
  const result = await channel(...args)
  await hold(`after-channel-created/${target}`)
  await hold('channel-created')
  return result
}

try {
  const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential: ctx.productPrincipals.bootstrapCredential('local') })
  try {
    await lease.withCall(async (call) => {
      const api = createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
      const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call }))
      if (!recovering) {
        let definition = worldScenarioSchema.parse(JSON.parse(await readFile(
          resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
        if (process.env.WORLD_INPUT_FORMAT === 'yaml') {
          const compiled = await compileWorldScenario(definition, installed)
          assert.ok(compiled.ok)
          const path = resolve(root, `world-${scenario}.yaml`)
          await writeFile(path, exportWorldScenarioText(compiled.resolved, 'yaml'))
          const parsed = parseWorldScenario(await readFile(path, 'utf8'), 'yaml')
          assert.ok(parsed.ok)
          assert.deepEqual(parsed.definition, definition)
          definition = parsed.definition
        }
        const preview = await client.simulations.preflightWorld({ definition })
        assert.ok(preview.result.ok && preview.result.value.status === 'ready')
        const input = simulationProductWorldCreateInputSchema.parse({ commandId: 'original-world', name: 'Original World', definition,
          preflight: { hash: preview.result.value.preview.hash, catalogGeneration: preview.result.value.preview.catalogGeneration } })
        await writeFile(inputPath, JSON.stringify(input))
      }
      const input = simulationProductWorldCreateInputSchema.parse(JSON.parse(await readFile(inputPath, 'utf8')))
      const proof = recovering ? proofSchema.parse(JSON.parse(await readFile(proofPath, 'utf8'))) : undefined
      const prior = await client.simulations.request({ commandId: input.commandId })
      assert.ok(prior.result.ok)
      assert.equal(prior.result.value.status, recovering ? 'found' : 'not-found')
      const created = await client.simulations.createWorld(input)
      assert.ok(created.result.ok)
      originalRunId = created.result.value.runId
      if (created.result.value.status === 'accepted') await terminal.promise
      const query = await client.simulations.request({ commandId: input.commandId })
      assert.ok(query.result.ok && query.result.value.status === 'found')
      assert.equal(query.result.value.request.status, 'completed')
      assert.equal(query.result.value.request.runId, originalRunId)
      const exported = await client.simulations.exportWorldDefinition({ runId: originalRunId })
      assert.ok(exported.result.ok)
      assert.deepEqual(exported.result.value, { runId: originalRunId, definition: input.definition })
      if (process.env.WORLD_INPUT_FORMAT === 'yaml') {
        const compiled = await compileWorldScenario(exported.result.value.definition, installed)
        assert.ok(compiled.ok)
        for (const format of ['json', 'yaml'] as const) {
          const imported = await compileWorldScenario(exportWorldScenarioText(compiled.resolved, format), installed, format)
          assert.ok(imported.ok)
          assert.equal(imported.resolved.definitionHash, compiled.resolved.definitionHash)
          assert.deepEqual(imported.resolved, compiled.resolved)
        }
      }
      const inspect = await client.simulations.inspect({ runId: originalRunId })
      assert.ok(inspect.result.ok && inspect.result.value.world !== undefined)
      assert.equal(inspect.result.value.world.phase, 'paused')
      const retry = await client.simulations.createWorld(input)
      assert.ok(retry.result.ok)
      assert.deepEqual(retry.result.value, query.result.value.request)
      if (proof !== undefined) {
        assert.equal(originalRunId, proof.runId)
        const state = owned?.snapshot() ?? (await ctx.simulations.inspect(ctx.simulations.resolveInspection({
          provider: 'local', spec: proof.spec })))?.snapshot
        assert.ok(state)
        if (proof.teamId !== undefined) assert.equal(state.teamReservation?.teamId, proof.teamId)
        for (const actor of proof.actors) assert.deepEqual(state.entities[actor.entityId]?.binding, actor.binding)
        for (const channel of proof.channels) assert.equal(state.channelReservations?.[channel.key]?.channelId, channel.channelId)
      }
      assert.equal(modelCalls, 0)
      assert.equal(requests.length, 0)
      assert.deepEqual(await ctx.sessionPersistence.list(), [])
      console.log(JSON.stringify({ scenario, originalCommand: true, originalAllocation: true, identitiesPreserved: true,
        phase: 'paused', originalDefinition: true, modelCalls: 0, originalQuery: 'completed', portableExport: true }))
    })
  } finally { await lease.revoke() }
} finally { await ctx.fiber.dispose() }
