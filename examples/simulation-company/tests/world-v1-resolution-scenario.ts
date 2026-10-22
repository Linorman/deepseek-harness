/** Full real deployment resolution survives accepted-command SIGKILL and changed/removed cold installations. */
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { LogStream } from '@clocky/clocky-storage'
import { simulationProductWorldCreateInputSchema, preflightSimulationWorld } from '@clocky/clocky-simulation-product'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product'
import type { SimulationWorldCreation } from '@clocky/clocky-simulation-product/src/world-creation.ts'
import type { ScenarioV1Catalog } from '@clocky/clocky-simulation-scenario'
import { compileWorldScenarioV1, exportWorldScenarioV1Text } from '@clocky/clocky-simulation-scenario'
import { mountCatalog, resolutionCatalog, resolutionDefinition } from './fixtures/world-v1-resolution/deployment.ts'
import { mediatedModelRequests } from './world-external-mediated-model.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), round = Number(process.env.WORLD_V1_RESOLUTION_ROUND ?? '0')
const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src', backend = process.env.SIMULATION_COMPANY_BACKEND!
assert.ok(['src', 'lib'].includes(face)); assert.ok(['json', 'sqlite'].includes(backend)); assert.ok([0, 1, 2].includes(round))
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-scenario',
  '@clocky/clocky-simulation-product', '@clocky/clocky-simulation-product/administration'].map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(face === 'lib' ? '/lib/' : '/src/'), path)
if (face === 'lib') { assert.deepEqual(process.execArgv, []); assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false) }
const ctx = await boot('world-v1-resolution', process.argv[2]!)
const call: AuthenticatedProductCall = { principal: { id: 'c33-owner' as never, issuer: 'c33-loader', subject: 'c33-owner',
  assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
async function entries(stream: LogStream) {
  const rows = []; let after = -1
  while (after < stream.tailSequence) { const page = await stream.read(after, 128); assert.ok(page.length)
    rows.push(...page); after = page.at(-1)!.sequence }
  return rows
}
async function allocations() {
  let nativeFiles: string[]
  try { nativeFiles = await readdir(resolve(root, 'simulation'), { recursive: true }) }
  catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT'); nativeFiles = [] }
  return { nativeFiles: nativeFiles.sort(), logs: await ctx.storage.backend.get(backend).log!.list(),
    products: await ctx.simulationProducts.list({}, call), sessions: await ctx.sessionPersistence.list(),
    models: mediatedModelRequests.length }
}
async function finished(commandId: SimulationProductWorldCreateInput['commandId']) {
  let result = await ctx.simulationAdministration.request({ commandId }, call)
  const deadline = Date.now() + 20000
  while (result.status === 'found' && result.request.status === 'accepted' && Date.now() < deadline) {
    await delay(20); result = await ctx.simulationAdministration.request({ commandId }, call)
  }
  assert.ok(result.status === 'found'); assert.equal(result.request.status, 'completed', JSON.stringify(result))
  return result
}
const mutations: readonly [string, (catalog: ScenarioV1Catalog) => void][] = [
  ['default', (catalog) => { catalog.limits.defaults.native.maxEntities = 15 }],
  ['ceiling', (catalog) => { catalog.limits.ceilings.native.maxEntities = 15 }],
  ['model', (catalog) => { catalog.runtimeProfiles[0]!.model.version = 'different-model-metadata' }],
  ['template', (catalog) => { catalog.templates[0]!.template.description = 'Different installed template metadata.' }],
  ['template-default-persona', (catalog) => { catalog.templates[0]!.defaultPersona.name = 'Director' }],
  ['policy', (catalog) => { catalog.policyVersion = 'different-policy-version' }],
  ['native', (catalog) => { catalog.native.rulesVersion = 'different-native-rules' }],
  ['implementation-generation', (catalog) => { catalog.domains[0]!.pin.generation += 1 }],
]
try {
  const originalPath = resolve(root, 'original.json')
  let input: SimulationProductWorldCreateInput
  if (round === 0) {
    const baseline = await allocations()
    const preview = await ctx.simulationAdministration.preflightWorld({ definition: resolutionDefinition }, call)
    assert.ok(preview.status === 'ready' && 'apiVersion' in preview && preview.apiVersion === 'clocky.world/v1')
    const original = await preflightSimulationWorld(ctx, resolutionDefinition, resolutionCatalog, call.signal, 'local')
    assert.ok(original.ok && original.resolved.apiVersion === 'clocky.world/v1')
    assert.equal(original.resolved.compilerVersion, '9')
    assert.equal(preview.preview.hash, original.preview.hash)
    assert.equal(original.resolved.limits.native.maxEntities, 8)
    assert.equal(original.resolved.catalog.limits.defaults.native.maxEntities, 16)
    assert.equal(original.resolved.catalog.limits.ceilings.native.maxEntities, 16)
    assert.deepEqual(original.resolved.catalog.limits, resolutionCatalog.limits)
    assert.deepEqual(original.resolved.catalog.native, resolutionCatalog.native)
    assert.deepEqual(original.resolved.teamCeilings, ctx.teams.getCreationLimits())
    assert.equal(original.resolved.catalog.policyVersion, resolutionCatalog.policyVersion)
    assert.deepEqual(original.resolved.catalog.templates, resolutionCatalog.templates)
    assert.deepEqual(await allocations(), baseline)
    input = simulationProductWorldCreateInputSchema.parse({ commandId: 'original-resolution-v1', name: 'Original complete deployment',
      definition: resolutionDefinition, preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } })
    const stale = []
    for (const [kind, mutate] of mutations) {
      const changed = structuredClone(resolutionCatalog); mutate(changed); await mountCatalog(ctx, changed)
      const current = await ctx.simulationAdministration.preflightWorld({ definition: resolutionDefinition }, call)
      if (current.status === 'ready') {
        assert.notEqual(current.preview.hash, preview.preview.hash)
        if (kind === 'default' || kind === 'ceiling') assert.deepEqual(current.limits, preview.limits)
      } else { assert.equal(kind, 'implementation-generation'); assert.ok(current.diagnostics.some(value => value.code === 'domain-unavailable')) }
      await assert.rejects(ctx.simulationAdministration.createWorld(input, call), /preview changed/)
      const actual = await allocations(); assert.deepEqual(actual, baseline)
      assert.equal(ctx.storageLog.get('c33-v1-commands')!.tailSequence, -1)
      stale.push({ kind, changedCatalog: changed, current, actual, rejectedOriginalHash: preview.preview.hash })
    }
    await mountCatalog(ctx, resolutionCatalog)
    await writeFile(originalPath, JSON.stringify({ input, preview, resolved: original.resolved, stale, baseline }, null, 2))
    const stream = ctx.storageLog.get('c33-v1-commands')!, append = stream.append.bind(stream)
    stream.append = async (...args) => {
      const result = await append(...args)
      const accepted = args[1].find(value => (value as { kind: string }).kind === 'command/accepted')
      if (accepted !== undefined) {
        const state = await allocations(); assert.deepEqual(state, { ...baseline,
          logs: state.logs })
        assert.equal(state.logs.find(value => value.name === 'c33-v1-commands')!.tailSequence, 0)
        assert.ok(state.logs.every(value => !value.name.startsWith('team/') && !value.name.startsWith('channel/')))
        const command = (accepted as { command: { creation: SimulationWorldCreation } }).command
        assert.deepEqual(command.creation.preparation.resolved, original.resolved)
        await writeFile(resolve(root, 'accepted-prefix.json'), JSON.stringify({ command, allocations: state,
          journal: await entries(stream), modelCalls: mediatedModelRequests.length }, null, 2))
        process.send?.({ event: 'v1-resolution-accepted' })
        await new Promise<void>((done) => { process.once('message', () => { done() }) })
      }
      return result
    }
    await ctx.simulationAdministration.createWorld(input, call)
    throw new Error('Actual accepted command barrier was not reached')
  }
  const original = JSON.parse(await readFile(originalPath, 'utf8')) as {
    input: SimulationProductWorldCreateInput
    preview: unknown
    resolved: SimulationWorldCreation['preparation']['resolved'] }
  input = simulationProductWorldCreateInputSchema.parse(original.input)
  let currentPreview: unknown
  if (round === 1) await assert.rejects(
    ctx.simulationAdministration.preflightWorld({ definition: input.definition }, call), /not installed/)
  else {
    const current = await ctx.simulationAdministration.preflightWorld({ definition: input.definition }, call)
    assert.ok(current.status === 'ready'); assert.notEqual(current.preview.hash, input.preflight.hash)
    currentPreview = current
  }
  await ctx.simulationAdministration.createWorld(input, call)
  const outcome = await finished(input.commandId), receipt = outcome.request
  const stream = ctx.storageLog.get('c33-v1-commands')!, journal = await entries(stream)
  const creation = (journal[0]!.value as { command: { creation: SimulationWorldCreation } }).command.creation
  assert.deepEqual(creation.preparation.resolved, original.resolved); assert.deepEqual(creation.request, input)
  const resolved = creation.preparation.resolved; assert.ok(resolved.apiVersion === 'clocky.world/v1')
  assert.equal(resolved.compilerVersion, '9')
  const selection = ctx.simulations.resolveInspection({ provider: creation.record.provider,
    spec: simulationRunSpecSchema.parse(creation.record.spec), includeRecords: true })
  const observation = await ctx.simulations.inspect(selection); assert.ok(observation)
  const state: SimulationSnapshot = observation.snapshot
  assert.equal(state.phase, 'paused'); assert.equal(state.time, '0'); assert.equal(state.worldBootstrap!.status, 'applied')
  assert.deepEqual(state.worldBootstrap!.request.data, resolved.bootstrap); assert.deepEqual(state.world!.definition, resolved.world)
  assert.equal(state.worldBootstrap!.request.definitionHash, resolved.definitionHash)
  assert.deepEqual(state.decisions, {}); assert.deepEqual(state.operations, {}); assert.deepEqual(state.world!.intents, {})
  const team = await ctx.teams.getTeam({ teamId: state.teamReservation!.teamId })
  assert.equal(team.participants.length, 3); assert.equal(team.channelIds.length, 3)
  assert.equal(team.activations.length, 0); assert.equal(team.tasks.length, 0)
  const sessions = Object.values(state.entities).flatMap(value => value.binding === undefined ? []
    : [{ entityId: value.id, binding: value.binding }])
  for (const session of sessions) { assert.equal(await ctx.sessionPersistence.isUnmaterialized(session.binding.sessionId), true)
    assert.equal(ctx.agents.get(session.binding.sessionId), undefined) }
  assert.equal(mediatedModelRequests.length, 0)
  const exported = await ctx.simulationAdministration.exportWorldDefinition({ runId: receipt.runId }, call)
  assert.deepEqual(exported.definition, input.definition)
  const portableText = JSON.stringify(exported.definition)
  for (const forbidden of [receipt.runId, team.team.id, ...team.channelIds, root,
    ...sessions.flatMap(value => [value.binding.participantId, value.binding.sessionId])])
    assert.equal(portableText.includes(forbidden), false)
  const exportCompilations = []
  for (const format of ['json', 'yaml'] as const) {
    const text = exportWorldScenarioV1Text({ definition: exported.definition }, format)
    const compiled = await compileWorldScenarioV1(text, resolved.catalog, format, resolved.teamCeilings)
    assert.ok(compiled.ok, JSON.stringify(compiled))
    assert.equal(compiled.resolved.definitionHash, resolved.definitionHash)
    assert.equal(compiled.preview.hash, input.preflight.hash)
    assert.deepEqual(compiled.resolved, resolved)
    exportCompilations.push({ format, text, compiled })
  }
  assert.deepEqual(await ctx.simulationAdministration.createWorld(input, call), receipt)
  assert.deepEqual(await entries(stream), journal)
  const identity = { receipt, state, team, sessions, journal }
  let restoreProof: unknown
  if (round === 1) await writeFile(resolve(root, 'original-identity.json'), JSON.stringify(identity, null, 2))
  else {
    const first = JSON.parse(await readFile(resolve(root, 'original-identity.json'), 'utf8')) as typeof identity
    assert.deepEqual(identity, first)
    const request = { runId: receipt.runId, commandId: 'original-resolution-restore' as never,
      checkpointId: creation.preparation.checkpoint.id }
    await ctx.simulationAdministration.restore(request, call)
    const restored = await finished(request.commandId), after = await ctx.simulations.inspect(selection); assert.ok(after)
    assert.equal(after.owner, 'this-provider'); assert.deepEqual(after.snapshot, state)
    assert.deepEqual(await ctx.teams.getTeam({ teamId: team.team.id }), team)
    for (const session of sessions) assert.equal(await ctx.sessionPersistence.isUnmaterialized(session.binding.sessionId), true)
    const restoreJournal = await entries(stream); assert.equal(restoreJournal.length, journal.length + 2)
    assert.deepEqual(restoreJournal.slice(0, journal.length), journal)
    assert.deepEqual(await ctx.simulationAdministration.createWorld(input, call), receipt)
    assert.deepEqual(await ctx.simulationAdministration.restore(request, call), restored.request)
    assert.deepEqual(await entries(stream), restoreJournal)
    restoreProof = { request, restored, after, restoreJournal, separateManagementCommand: true }
  }
  await writeFile(resolve(root, `cold-${round}.json`), JSON.stringify({ round, creation, resolved, observation, identity,
    currentCatalogMode: process.env.WORLD_V1_RESOLUTION_CATALOG, currentPreview, restoreProof, exported, exportCompilations,
    modelCalls: mediatedModelRequests.length,
    runtimePaths, execArgv: process.execArgv }, null, 2))
  process.stdout.write(JSON.stringify({ round, face, backend, phase: state.phase, modelCalls: mediatedModelRequests.length,
    originalFullCatalogRetained: true, currentCatalogIgnoredForAcceptedCommand: true, originalIdentitiesRetained: true,
    restoredFromOriginal: round === 2, runtimePaths, execArgv: process.execArgv }) + '\n')
} finally { await ctx.fiber.dispose() }
