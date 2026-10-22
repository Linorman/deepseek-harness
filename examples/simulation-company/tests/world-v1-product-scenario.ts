/** Public v1 admission and original command reuse run through a real Loader with inert canonical identities. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { simulationProductWorldCreateInputSchema } from '@clocky/clocky-simulation-product'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product'
import type { SimulationWorldCreation } from '@clocky/clocky-simulation-product/src/world-creation.ts'
import { worldV1Definition } from './fixtures/world-v1-product/deployment.ts'
import { mediatedModelRequests } from './world-external-mediated-model.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), round = Number(process.env.WORLD_V1_PRODUCT_ROUND ?? '0')
const backend = process.env.SIMULATION_COMPANY_BACKEND!, face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
assert.ok(['json', 'sqlite'].includes(backend)); assert.ok(['src', 'lib'].includes(face)); assert.ok([0, 1, 2, 3].includes(round))
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-product',
  '@clocky/clocky-simulation-product/administration', '@clocky/clocky-simulation-scenario'].map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(face === 'lib' ? '/lib/' : '/src/'), path)
if (face === 'lib') {
  assert.deepEqual(process.execArgv, [])
  assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false)
}
const ctx = await boot('world-v1-product', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(String(error)) })
const call: AuthenticatedProductCall = { principal: { id: 'c30-world-owner' as never, issuer: 'c30-loader', subject: 'c30-owner',
  assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
const administration = ctx.simulationAdministration
async function nativeFiles(): Promise<string[]> {
  let files: string[]
  try { files = await readdir(resolve(root, 'simulation'), { recursive: true }) }
  catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT'); return [] }
  return files.sort()
}
async function noAllocation() {
  const logs = await ctx.storage.backend.get(backend).log!.list()
  const products = await ctx.simulationProducts.list({}, call)
  return { logs, nativeFiles: await nativeFiles(), products, sessions: await ctx.sessionPersistence.list(),
    calls: mediatedModelRequests.length }
}
async function entries(stream: LogStream) {
  const output = []; let after = -1
  while (after < stream.tailSequence) { const page = await stream.read(after, 128); assert.ok(page.length)
    output.push(...page); after = page.at(-1)!.sequence }
  return output
}
function checkpointSessionBindings(state: SimulationSnapshot) {
  const checkpoint = state.checkpoints![state.latestCheckpointId!]!
  assert.ok(checkpoint.status === 'completed')
  return checkpoint.manifest.sessions
}
const commandStream = ctx.storageLog.get('c30-v1-commands')!
try {
  assert.ok(commandStream)
  const originalPath = resolve(root, 'original-command.json')
  let input: SimulationProductWorldCreateInput
  if (round === 0) {
    const before = await noAllocation(), tails = { command: commandStream.tailSequence }
    const preview = await administration.preflightWorld({ definition: worldV1Definition }, call)
    assert.equal(preview.status, 'ready', JSON.stringify(preview))
    assert.ok(preview.status === 'ready' && 'apiVersion' in preview && preview.apiVersion === 'clocky.world/v1')
    assert.equal(JSON.stringify(preview).includes('PRIVATE-C30'), false)
    assert.equal(preview.preview.creationMode, 'paused'); assert.equal(preview.preview.initialRequestCount, 0)
    const afterPreview = await noAllocation(); assert.deepEqual(afterPreview, before)
    const rejected = []
    const badModel = structuredClone(worldV1Definition)
    badModel.runtimeProfiles.allowed = [{ id: worldV1Definition.runtimeProfiles.generated.id, version: 'unavailable-model' }]
    badModel.runtimeProfiles.generated = badModel.runtimeProfiles.allowed[0]!
    for (const actor of badModel.entities) if (actor.kind === 'person' && actor.cognition === 'agent')
      actor.runtimeProfile = badModel.runtimeProfiles.generated
    const badDomain = structuredClone(worldV1Definition)
    badDomain.domains.push({ domain: 'external', operation: 'interact', version: 'uninstalled-version' })
    for (const definition of [badModel, badDomain]) {
      const result = await administration.preflightWorld({ definition }, call)
      assert.equal(result.status, 'invalid'); assert.ok(result.status === 'invalid')
      assert.ok(result.diagnostics.some(value => value.code === (definition === badModel ? 'model-unavailable' : 'domain-unavailable')))
      rejected.push(result); assert.deepEqual(await noAllocation(), before)
    }
    input = simulationProductWorldCreateInputSchema.parse({ commandId: 'original-v1-world', name: 'Original complete v1 World',
      definition: worldV1Definition, preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } })
    for (const preflight of [{ ...input.preflight, hash: `sha256:${'f'.repeat(64)}` },
      { ...input.preflight, catalogGeneration: 'changed-catalog-generation' }]) {
      await assert.rejects(administration.createWorld({ ...input, preflight }, call), /preview changed/)
      assert.deepEqual(await noAllocation(), before)
    }
    const changedDefinition = structuredClone(worldV1Definition)
    changedDefinition.facts[0]!.body = 'PRIVATE-C30-UNREVIEWED-FACT'
    await assert.rejects(administration.createWorld({ ...input, definition: changedDefinition }, call), /preview changed/)
    assert.deepEqual(await noAllocation(), before)
    await writeFile(resolve(root, 'preflight-zero-allocation.json'), JSON.stringify({ before, afterPreview, rejected, tails,
      commandTailAfter: commandStream.tailSequence, preview }, null, 2))
    await writeFile(originalPath, JSON.stringify({ input, preview }, null, 2))
    await administration.createWorld(input, call)
  } else {
    const retained: unknown = JSON.parse(await readFile(originalPath, 'utf8'))
    assert.ok(retained !== null && typeof retained === 'object')
    input = simulationProductWorldCreateInputSchema.parse(Reflect.get(retained, 'input'))
  }
  let outcome = await administration.request({ commandId: input.commandId }, call)
  const deadline = Date.now() + 20000
  while (outcome.status === 'found' && outcome.request.status === 'accepted' && Date.now() < deadline) {
    await delay(20); outcome = await administration.request({ commandId: input.commandId }, call)
  }
  assert.ok(outcome.status === 'found'); assert.equal(outcome.request.status, 'completed', JSON.stringify(outcome))
  const receipt = outcome.request, originalEntries = await entries(commandStream)
  const accepted = originalEntries.find(entry => (entry.value as { kind: string }).kind === 'command/accepted')!.value as
  { command: { kind: string; input: SimulationProductWorldCreateInput; creation: SimulationWorldCreation } }
  assert.equal(accepted.command.kind, 'world-create'); assert.deepEqual(accepted.command.input, input)
  const creation = accepted.command.creation, resolved = creation.preparation.resolved
  assert.ok(resolved.apiVersion === 'clocky.world/v1'); assert.deepEqual(resolved.definition, input.definition)
  assert.equal(creation.record.id, receipt.runId)
  assert.equal(creation.record.ownerPrincipalId, call.principal.id)
  const original = JSON.parse(await readFile(originalPath, 'utf8')) as { preview: unknown }
  assert.deepEqual(await administration.preflightWorld({ definition: input.definition }, call), original.preview)
  const selection = ctx.simulations.resolveInspection({ provider: creation.record.provider,
    spec: simulationRunSpecSchema.parse(creation.record.spec), includeRecords: true })
  const observation = await ctx.simulations.inspect(selection); assert.ok(observation)
  const state: SimulationSnapshot = observation.snapshot
  assert.equal(observation.owner, round === 0 ? 'this-provider' : 'unowned')
  const book = state.worldBootstrap!; assert.ok(book && state.world)
  assert.equal(state.phase, 'paused'); assert.equal(state.time, '0'); assert.equal(book.status, 'applied')
  assert.deepEqual(book.request.data, resolved.bootstrap); assert.deepEqual(book.request.definition, resolved.world)
  assert.equal(book.request.definitionHash, resolved.definitionHash)
  assert.ok(book.appliedSequence !== undefined)
  assert.equal(book.appliedSequence, state.world.sequence); assert.ok(book.sequence < book.appliedSequence)
  assert.deepEqual(state.world.intents, {}); assert.deepEqual(state.world.requests, {})
  assert.deepEqual(state.decisions, {}); assert.deepEqual(state.operations, {}); assert.deepEqual(state.wakes, {})
  assert.deepEqual(state.world.governance, { proposals: {}, votes: {}, resolutions: {} })
  assert.deepEqual(book.occurrences, [])
  assert.equal(Object.keys(state.entities).length, resolved.entities.length)
  assert.equal(Object.keys(state.relations).length, resolved.relations.length)
  assert.ok(Object.values(state.entities).every(value => value.readiness === 'ready' && value.writer === undefined))
  const norm = state.world.norms.versions['initial-hiring-policy' as never]![0]!
  assert.equal(norm.origin, 'scenario'); assert.ok(norm.origin === 'scenario')
  assert.equal(norm.source.definitionHash, resolved.definitionHash); assert.equal(norm.source.bootstrapSequence, book.sequence)
  const fact = state.world.facts['original-private-fact' as never]![0]!
  assert.deepEqual(fact.payload, { body: 'PRIVATE-C30-DIRECTOR-FACT-CANARY' }); assert.equal(fact.sequence, book.appliedSequence)
  assert.deepEqual(fact.source.references, [{ kind: 'run-event', runId: state.spec.runId, sequence: book.sequence }])
  assert.equal(norm.sequence, book.appliedSequence)
  assert.deepEqual(state.knowledge!['original-belief' as never]![0]!.readers, [])
  assert.equal(state.knowledge!['original-belief' as never]![0]!.sequence, book.appliedSequence)
  assert.equal(state.resources['supplier-stock' as never]!.quantity, '7')
  const identity = Object.values(state.world.external.identities)[0]!
  assert.equal(identity.source.kind, 'scenario'); assert.equal(identity.representation, 'director-mediated')
  assert.ok(identity.source.kind === 'scenario')
  assert.equal(identity.source.definitionHash, resolved.definitionHash); assert.equal(identity.source.bootstrapSequence, book.sequence)
  assert.equal(identity.sequence, book.appliedSequence)
  assert.equal(Object.keys(state.world.external.representatives).length, 0)
  assert.equal(Object.values(state.scheduledEvents).filter(value => value.action.kind === 'world-calendar').length, 2)
  const team = await ctx.teams.getTeam({ teamId: state.teamReservation!.teamId })
  assert.equal(team.participants.length, resolved.actors.length)
  assert.equal(team.activations.length, 0); assert.equal(team.tasks.length, 0)
  assert.equal(team.channelIds.length, resolved.channels.length)
  const channels = await Promise.all(team.channelIds.map(async (channelId) => {
    const manifest = await ctx.teams.getChannel({ channelId })
    const reservation = Object.values(state.channelReservations!).find(value => value.channelId === channelId)!
    assert.ok(reservation.confirmed)
    assert.equal(manifest.manifest.teamId, team.team.id); assert.equal(manifest.manifest.id, channelId)
    assert.deepEqual(manifest.manifest.adapter, { type: 'direct', version: 4 })
    assert.deepEqual(manifest.manifest.participants, reservation.spec.members.map(member => ({
      id: state.entities[member.entityId]!.binding!.participantId, role: member.role })))
    const page = await ctx.teams.readChannelPage({ channelId, afterCursor: -1, limit: 128 })
    assert.equal(page.records.some(value => value.type === 'channel/envelope'), false)
    return { channelId, manifest, records: page.records }
  }))
  const sessions = await Promise.all(Object.values(state.entities).filter(value => value.binding !== undefined).map(async (actor) => {
    const binding = actor.binding!
    assert.equal(binding.teamId, team.team.id)
    assert.ok(team.participants.some(value => value.id === binding.participantId && value.kind === 'local-agent'))
    assert.deepEqual(actor.participantReservation?.binding, binding)
    assert.ok(checkpointSessionBindings(state).some(value => value.sessionId === binding.sessionId
      && value.participantId === binding.participantId && value.teamId === binding.teamId))
    assert.equal(await ctx.sessionPersistence.isUnmaterialized(binding.sessionId), true)
    assert.equal(ctx.agents.get(binding.sessionId), undefined)
    return { entityId: actor.id, binding, unmaterialized: true }
  }))
  assert.equal(await ctx.sessionPersistence.list().then(value => value.length), 0)
  const checkpoint = state.checkpoints![state.latestCheckpointId!]!
  assert.equal(checkpoint.status, 'completed'); assert.equal(checkpoint.request.id, creation.preparation.checkpoint.id)
  assert.ok(checkpoint.status === 'completed'); assert.ok(checkpoint.manifest.sessions.every(value => value.kind === 'unmaterialized'))
  assert.equal(checkpoint.manifest.team.owner.teamId, team.team.id)
  assert.equal(mediatedModelRequests.length, 0); assert.deepEqual(failures, [])
  const beforeRetry = { state, receipt, commandEntries: originalEntries, team, channels, sessions }
  assert.deepEqual(await administration.createWorld(input, call), receipt)
  const exported = await administration.exportWorldDefinition({ runId: receipt.runId }, call)
  assert.deepEqual(exported.definition, input.definition)
  assert.deepEqual(await administration.preflightWorld({ definition: exported.definition }, call), original.preview)
  await assert.rejects(administration.createWorld({ ...input, name: 'Changed original payload' }, call), /another original payload/)
  const alteredDefinition = structuredClone(worldV1Definition)
  alteredDefinition.knowledge[0]!.body = 'PRIVATE-C30-CHANGED-ORIGINAL-BELIEF'
  await assert.rejects(administration.createWorld({ ...input, definition: alteredDefinition }, call), /another original payload/)
  await assert.rejects(administration.createWorld({ ...input, preflight: { ...input.preflight, hash: `sha256:${'d'.repeat(64)}` } }, call),
    /another original payload/)
  assert.deepEqual(await entries(commandStream), originalEntries)
  const afterRetry = await ctx.simulations.inspect(selection); assert.ok(afterRetry)
  assert.deepEqual(afterRetry.snapshot, state)
  assert.deepEqual((await administration.listRequests({ runId: receipt.runId }, call)).items, [receipt])
  const identityProof = { receipt, teamId: team.team.id, sessions, channels: channels.map(value => value.channelId),
    nativeRevision: state.revision, bootstrapSequence: book.sequence, appliedSequence: book.appliedSequence }
  if (round === 0) await writeFile(resolve(root, 'original-identities.json'), JSON.stringify(identityProof, null, 2))
  else assert.deepEqual(identityProof, JSON.parse(await readFile(resolve(root, 'original-identities.json'), 'utf8')))
  let restoredProof: unknown
  if (round === 3) {
    const restoreInput = { runId: receipt.runId, commandId: 'explicit-v1-restore' as never,
      checkpointId: creation.preparation.checkpoint.id }
    await administration.restore(restoreInput, call)
    let restoreOutcome = await administration.request({ commandId: restoreInput.commandId }, call)
    const restoreDeadline = Date.now() + 20000
    while (restoreOutcome.status === 'found' && restoreOutcome.request.status === 'accepted' && Date.now() < restoreDeadline) {
      await delay(20); restoreOutcome = await administration.request({ commandId: restoreInput.commandId }, call)
    }
    assert.ok(restoreOutcome.status === 'found')
    assert.equal(restoreOutcome.request.status, 'completed', JSON.stringify(restoreOutcome))
    assert.equal(restoreOutcome.request.checkpointId, checkpoint.request.id)
    const restored = await ctx.simulations.inspect(selection); assert.ok(restored)
    assert.equal(restored.owner, 'this-provider'); assert.equal(restored.snapshot.phase, 'paused'); assert.equal(restored.snapshot.time, '0')
    assert.deepEqual(restored.snapshot.world, state.world); assert.deepEqual(restored.snapshot.worldBootstrap, book)
    assert.deepEqual(restored.snapshot.resources, state.resources); assert.deepEqual(restored.snapshot.knowledge, state.knowledge)
    assert.deepEqual(Object.values(restored.snapshot.entities).flatMap(value => value.binding === undefined ? [] : [value.binding]),
      sessions.map(value => value.binding))
    assert.ok(Object.values(restored.snapshot.entities).every(value => value.writer === undefined && value.readiness === 'ready'))
    assert.deepEqual(restored.snapshot.decisions, {}); assert.deepEqual(restored.snapshot.operations, {})
    const restoredTeam = await ctx.teams.getTeam({ teamId: team.team.id }); assert.deepEqual(restoredTeam, team)
    for (const session of sessions) {
      assert.equal(await ctx.sessionPersistence.isUnmaterialized(session.binding.sessionId), true)
      assert.equal(ctx.agents.get(session.binding.sessionId), undefined)
    }
    assert.equal(mediatedModelRequests.length, 0)
    const restoreJournal = await entries(commandStream)
    assert.deepEqual(restoreJournal.slice(0, originalEntries.length), originalEntries)
    assert.equal(restoreJournal.length, originalEntries.length + 2)
    assert.deepEqual(await administration.createWorld(input, call), receipt)
    assert.deepEqual(await administration.restore(restoreInput, call), restoreOutcome.request)
    assert.deepEqual(await entries(commandStream), restoreJournal)
    restoredProof = { restoreInput, restoreOutcome, restored, restoredTeam, sessions, restoreJournal,
      priorReadOnlyIdentityProof: identityProof, separateNewManagementCommand: true, modelCalls: mediatedModelRequests.length }
    await writeFile(resolve(root, 'explicit-restore-raw.json'), JSON.stringify(restoredProof, null, 2))
  }
  await writeFile(resolve(root, `round-${round}-raw.json`), JSON.stringify({ round, backend, face, creation, resolved, exported,
    beforeRetry, observation, identityProof, restoredProof, commandJournal: originalEntries,
    productDirectory: await entries(ctx.storageLog.get('c30-v1-products')!), models: mediatedModelRequests }, null, 2))
  process.stdout.write(JSON.stringify({ round, backend, face, pid: process.pid, phase: state.phase,
    modelCalls: mediatedModelRequests.length,
    publicOriginalCommand: true, originalInitializedData: true, sameCanonicalIdentities: true, unmaterializedSessions: true,
    privateSourceRetained: true, exportedPreflightUnchanged: true, noAllocationDuringPreflight: true,
    explicitWritableRestore: round === 3,
    inputHash: createHash('sha256').update(JSON.stringify(input.definition)).digest('hex'), runtimePaths }) + '\n')
} finally { await ctx.fiber.dispose() }
