/** Keyless Loader acceptance: real case CLI and independent Sessions; only external model responses are scripted. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationCheckpointIdSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import Products, { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { simulationProductImportSchema } from '@clocky/clocky-simulation-product/src/directory.ts'
import { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import { createHarborInstallation, HARBOR_PIN } from '@clocky/clocky-simulation-world/harbor'
import { deployment } from '../../../packages/simulation/simulation-scenario/tests/v1-fixtures.ts'

function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') {
    let parsed: unknown
    try { parsed = JSON.parse(value) }
    catch { return [] } // Non-JSON instructions have no structured authority fields.
    return objects(parsed)
  }
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  const record = value as Record<string, unknown>
  return [record, ...Object.values(record).flatMap(objects)]
}

const ctx = await boot('harbor-case-test', process.argv[2]!)
const stopping = process.env.HARBOR_STOP_TEST === 'true'
const draining = process.env.HARBOR_STOP_MODE === 'drain-admitted'
const budgetLimited = process.env.HARBOR_STOP_BUDGET === 'limited'
let attemptedCrossing = false
const actors = new Set<string>(), acted = new Set<string>(), steps = new Map<string, number>()
const goalOrder: string[] = []
let woke = false, wakeAfter = 0
const { catalog, definition } = createHarborInstallation(deployment)
const protocolVersion = process.env.HARBOR_PROTOCOL_VERSION ?? HARBOR_PIN.version
if (protocolVersion !== HARBOR_PIN.version) {
  const { HARBOR_CONTRACTS } = await import('@clocky/clocky-simulation-world/src/harbor-protocol.ts')
  const original = HARBOR_CONTRACTS.find(value => value.pin.version === protocolVersion)
  if (original === undefined) throw new Error('Requested retained protocol is unavailable')
  catalog.domains = [{ pin: original.pin, available: true }]
  definition.domains = definition.domains.map(value => ({ ...value, version: protocolVersion }))
  definition.organization.positions = definition.organization.positions.map(position => ({ ...position,
    permissions: position.permissions.map(value => ({ ...value, version: protocolVersion })) }))
  definition.organization.grants = definition.organization.grants.map(value => ({ ...value, version: protocolVersion }))
}
for (const profile of catalog.runtimeProfiles) profile.model = { provider: 'harbor-keyless', name: 'fixture', version: '1', available: true }
ctx.effect(() => ctx.llm.registerAdapter(['harbor-keyless'], new class extends LlmAdapter {
  override resolveModel(provider: string, model: string) { return Promise.resolve({ provider, id: model, name: model }) }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const values = objects(options.messages.filter(message => message.role === 'user'
      && !message.content.some(block => block.type === 'tool-result')))
    const marker = z.object({ entityId: z.string(), contextKey: z.string(), purpose: z.string() })
      .parse(values.findLast(value => value.kind === 'world-driver'))
    actors.add(marker.entityId)
    if (marker.purpose === 'goal' && marker.entityId === 'coordinator') {
      assert.match(String(values.findLast(value => value.kind === 'world-goal')?.goal), /bounded multi-day stages/)
    }
    const key = `${marker.entityId}/${marker.contextKey}`, index = steps.get(key) ?? 0
    steps.set(key, index + 1)
    if (index === 0 && marker.purpose === 'goal') goalOrder.push(marker.entityId)
    const observation = values.findLast(value => typeof value.viewId === 'string')
    if (marker.purpose === 'goal' && marker.entityId !== 'coordinator') assert.equal(observation?.actor, marker.entityId)
    const overview = values.findLast(value => value.name === '河港社会' && typeof value.day === 'number')
    const day = marker.entityId === 'coordinator'
      ? values.findLast(value => value.protocol !== undefined)?.day ?? overview?.day
      : observation?.day
    let command: unknown
    const actionKey = `${marker.entityId}/${String(day)}`
    if (marker.purpose === 'goal' && (day === 0 && ['coop', 'clinic', 'north', 'west'].includes(marker.entityId)
      || day === 1 && marker.entityId === 'coop') && !acted.has(actionKey)) {
      command = { kind: 'act', viewId: observation?.viewId,
        rationale: 'Transfer one credit as the fixture’s independently submitted conservation probe.',
        actions: (marker.entityId === 'coop' ? ['clinic', 'north', 'west'] : ['coop'])
          .map(to => ({ kind: 'transfer', to, resource: 'cash', quantity: 1 })) }
      if (index === 1) acted.add(actionKey)
    }
    else if (stopping && marker.purpose === 'goal' && marker.entityId === 'coordinator' && (day === 0 || day === 7)) {
      command = { kind: 'advance', day: day === 0 ? 7 : 11 }
    }
    else if (marker.purpose === 'goal' && marker.entityId === 'coordinator' && (day === 0 || stopping && day === 11)) {
      command = { kind: 'advance', day: stopping ? index === 1 ? 13 : 12 : 1 }
      if (stopping && index === 1) attemptedCrossing = true
      if (stopping && index === 2) assert.match(JSON.stringify(options.messages), /exceeds the retained domain stop target/)
    }
    else if (marker.purpose === 'goal' && marker.entityId === 'coordinator' && day === 1 && !woke) {
      command = { kind: 'wake', actors: ['clinic', 'north'], reason: 'Each requested actor must get its own complete decision before this batch returns.' }
      if (index === 1) { woke = true; wakeAfter = goalOrder.length }
    }
    let action: unknown = command === undefined ? undefined : {
      kind: 'world/request', domain: 'harbor', operation: 'execute', version: protocolVersion, businessKey: key,
      expectedTime: null, evidence: [], payload: { scopeEntityId: 'harbor', targetEntityId: 'harbor-environment', command },
    }
    const world = values.find(value => value.kind === 'world-context'
      && typeof value.authority === 'object' && value.authority !== null
      && 'kind' in value.authority && value.authority.kind === marker.purpose)
    if (marker.purpose === 'resolve') {
      const pending = z.object({ authority: z.object({ requestId: z.string() }), input: z.json() }).parse(world)
      action = { kind: 'world/resolve', requestId: pending.authority.requestId, supersedes: null,
        resolution: { kind: 'apply', payload: protocolVersion === '3' ? { forwardOriginal: true } : pending.input, rationale: 'Submit the unchanged fixture actor request to the original judge.' } }
    } else if (marker.purpose === 'result') {
      action = z.object({ authority: z.object({ notification: z.json() }) }).parse(world).authority.notification
    }
    const correcting = stopping && marker.purpose === 'goal' && marker.entityId === 'coordinator' && day === 11 && index === 2
    const tool = index === 0 ? 'simulation_observe' : index === 1 || correcting ? 'simulation_stage' : 'simulation_submit'
    const args = JSON.stringify(index === 1 || correcting ? { proposals: action === undefined ? [] : [{ after: [], action }] } : {})
    const id = CallId(`${key}/${index}`)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}()))
const compiled = await compileWorldScenarioV1(definition, catalog, 'json', null)
assert.ok(compiled.ok, JSON.stringify(compiled))
const runId = 'harbor-loader-test'
const recovering = process.env.HARBOR_RECOVER === 'true'
const checkpointId = simulationCheckpointIdSchema.parse('harbor-initial')
const selection = simulationRunSelectionSchema.parse({
  provider: 'local', mode: recovering ? 'open' : 'create', spec: { runId, ...compiled.resolved.native },
})
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: checkpointId, implementationVersion: 'world/1', maxAttempts: 3,
}) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  if (!recovering) await prepareSimulationWorld(ctx.simulationTeams, run, { resolved: compiled.resolved, ownerName: 'harbor-loader-test',
    checkpoint: { id: checkpointId, maxDrainRounds: 64, maxAttempts: 3 } })
  const teamId = run.snapshot().teamReservation?.teamId
  assert.ok(teamId)
  const ownerName = run.snapshot().teamReservation?.creation.rules.activationLifecycleOwner
  assert.equal(typeof ownerName, 'string')
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, teamId, ownerName)
  const binding = { run, connection, resolved: compiled.resolved,
    anchor: { ownerName, checkpointId, maxDrainRounds: 64, maxAttempts: 3 }, lifetime: new AbortController().signal }
  const handlers = ctx.simulationWorldExecutions.handlers(binding)
  const driver = new SimulationWorldDriver(run, connection, compiled.resolved, binding.anchor, binding.lifetime, ctx, handlers)
  assert.equal((await driver.advance()).reason, 'paused')
  await run.setPhase('running', run.snapshot().revision)
  if (stopping) {
    assert.equal(recovering, false)
    const harbor = handlers.find(handler => handler.definition.domain === 'harbor')
    assert.ok(harbor !== undefined && typeof harbor.settleBoundary === 'function')
    assert.equal(await harbor.settleBoundary(), true)
    await run.updateRunControl({ commandId: 'loader-stop', target: { targetId: 'day-twelve',
      clock: { kind: 'domain', pin: HARBOR_PIN, name: 'harbor-day' }, boundary: '12' as never, mode: draining ? 'drain-admitted' : 'at-boundary',
      checkpointPolicy: 'none', drainBudget: { maxSteps: 512, maxTokens: budgetLimited ? compiled.resolved.native.tokensPerModelRequest - 1
        : 2 * compiled.resolved.native.tokensPerModelRequest, maxWallTimeMs: 60000 } } }, run.snapshot().revision)
    assert.equal(run.snapshot().runControl?.current.nativeBoundary, '12')
    const beforeFutureWake = run.snapshot().revision
    await assert.rejects(run.scheduleWake({ id: 'crossing-native-wake' as never, entityId: 'coordinator' as never,
      time: '13' as never, reason: 'A direct Host attempt to bypass the case stopping date.' }, beforeFutureWake), /stop target/)
    assert.equal(run.snapshot().revision, beforeFutureWake)
  }
  let result
  for (let batch = 0; batch < 100; batch++) {
    result = await driver.advance()
    if (result.reason !== 'work-limit') break
  }
  if (stopping) {
    const state = run.snapshot()
    assert.equal(attemptedCrossing, true)
    assert.equal(state.phase, 'paused')
    assert.equal(state.runControl?.current.state, 'paused')
    assert.equal(state.runControl?.current.cut?.clockValue, '12')
    const frozenRequests = new Set(state.runControl?.current.cut?.requestIds)
    const pendingOutcome = Object.values(state.world?.results ?? {}).some(result => frozenRequests.has(result.requestId)
      && Object.values(state.wakes).some(wake => wake.eventId === `simulation-world-result:${result.id}`
        && (wake.status === 'pending' || wake.status === 'claimed')))
    if (draining && budgetLimited) {
      assert.equal(state.runControl?.current.reason, 'drain-budget')
      assert.equal(pendingOutcome, true)
    } else if (draining) {
      assert.equal(state.runControl?.current.reason, 'target-reached')
      assert.ok((state.runControl?.current.steps ?? 0) > 0)
      assert.equal(pendingOutcome, false)
      for (const id of state.runControl?.current.cut?.requestIds ?? []) {
        const request = state.world?.requests[id as never]
        assert.notEqual(request?.status, 'open')
      }
    }
    const requests = Object.values(state.world?.requests ?? {}).map(value =>
      z.object({ command: z.object({ kind: z.string(), day: z.number().optional() }) }).parse(value.proposal.payload).command)
    assert.equal(requests.some(value => value.kind === 'advance' && value.day === 13), false)
    assert.equal(requests.filter(value => value.kind === 'advance' && value.day === 12).length, 1)
    await assert.rejects(run.setPhase('running', state.revision), /stop target/)
    console.log(JSON.stringify({ stopping: 'paused', crossingRejected: true, correctedAdvanceCount: 1,
      drainResult: !draining ? 'not-requested' : budgetLimited ? 'budget' : 'complete' }))
  } else {
    assert.equal(result?.reason, 'idle', JSON.stringify(result))
    assert.equal(run.snapshot().time, '1')
    if (!recovering) assert.deepEqual(goalOrder.slice(wakeAfter, wakeAfter + 2), ['clinic', 'north'])
    const directory = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'harbor', createHash('sha256').update(runId).digest('hex'))
    const journal = (await readFile(resolve(directory, 'output/journal.jsonl'), 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as {
        kind: string
        day: number
        payload: { id?: string; teamIdentity?: string; actor?: string; actions?: unknown[]; rationale?: string; viewId?: string } })
    const decisions = journal.filter(entry => entry.kind === 'decision')
    assert.equal(decisions.length, 5)
    assert.equal(new Set(decisions.map(entry => entry.payload.teamIdentity)).size, 4)
    assert.ok(decisions.some(entry => entry.day === 1))
    const bound = Object.values(run.snapshot().entities).filter(entity => entity.binding !== undefined)
    assert.equal(new Set(bound.map(entity => entity.binding?.sessionId)).size, 14)
    assert.equal(actors.size, recovering ? 0 : 14)
    const sessions = new Set(bound.map(entity => `${entity.binding?.teamId}/${entity.binding?.sessionId}`))
    assert.ok(sessions.has(decisions[0]!.payload.teamIdentity!))
    const snapshot = run.snapshot()
    for (const result of Object.values(snapshot.world?.results ?? {})) {
      if (result.outcome.kind !== 'committed') continue
      const receipt = z.object({ ok: z.boolean(), command: z.string(),
        receipt: z.object({ decisionId: z.string().nullable() }) }).parse(result.payload)
      if (!receipt.ok || receipt.command !== 'act') continue
      const request = snapshot.world?.requests[result.requestId]
      assert.ok(request?.source.kind === 'decision')
      const input = z.object({ command: z.object({ actions: z.array(z.json()), rationale: z.string(), viewId: z.string() }) })
        .parse(request.proposal.payload)
      const original = decisions.find(record => record.payload.id === receipt.receipt.decisionId)
      assert.ok(original)
      assert.deepEqual(original.payload.actions, input.command.actions)
      assert.equal(original.payload.rationale, input.command.rationale)
      assert.equal(original.payload.viewId, input.command.viewId)
      assert.equal(original.payload.teamIdentity, `${request.source.binding.teamId}/${request.source.binding.sessionId}`)
    }
    const registered = simulationProductImportSchema.parse({ id: 'harbor-business-read', name: 'Harbor business read',
      provider: 'local', spec: selection.spec, ownerPrincipalId: 'harbor-reader' })
    const reader = { principal: { id: registered.ownerPrincipalId, issuer: 'snapshot', subject: 'harbor-reader',
      assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
    const environmentId = Object.values(snapshot.world!.intents).find(intent => intent.pin.domain === 'harbor')?.targetEntityId
    assert.ok(environmentId)
    await ctx.plugin(Products, { directoryStream: 'harbor-business-directory', imports: [registered] })
    const products = ctx.simulationProducts
    let cases = await products.listWorldCases({ runId: registered.id }, reader)
    const selectedResult = Object.values(snapshot.world!.results).find(value => value.outcome.kind === 'committed'
      && z.object({ ok: z.boolean(), command: z.string() }).parse(value.payload).ok
      && z.object({ command: z.string() }).parse(value.payload).command === 'act')
    assert.ok(selectedResult)
    let selectedCase = cases.items.find(value => value.requestId === selectedResult.requestId)
    assert.ok(selectedCase)
    assert.equal(selectedCase.businessSummary.status, 'allowed')
    if (selectedCase.businessSummary.status !== 'allowed') throw new Error('Public judge summary missing')
    assert.equal(selectedCase.businessSummary.value.execution, 'accepted')
    assert.deepEqual(selectedCase.businessSummary.value.counts.organizations, { status: 'withheld' })
    const revokeContext = products.contextReaderRegistrar()([{ principalId: reader.principal.id,
      runId: registered.id, entityIds: [environmentId], content: ['context'] }])
    cases = await products.listWorldCases({ runId: registered.id }, reader)
    selectedCase = cases.items.find(value => value.requestId === selectedResult.requestId)
    assert.ok(selectedCase)
    const summary = selectedCase.businessSummary
    assert.equal(summary.status, 'allowed')
    if (summary.status !== 'allowed') throw new Error('Authorized Harbor summary missing')
    assert.equal(summary.value.execution, 'accepted')
    assert.equal(summary.value.businessOutcome, 'unknown')
    assert.deepEqual(summary.value.counts.independentSessions, { status: 'known', value: 14 })
    const published = z.object({ publishedAtNativeSequence: z.number().int().nonnegative(), revision: z.number(), day: z.number(),
      overview: z.object({ actors: z.array(z.unknown()), organizations: z.array(z.unknown()) }) })
      .parse(snapshot.entities[environmentId]!.profile.harbor)
    assert.deepEqual(summary.value.counts.businessEntities, { status: 'known', value: published.overview.actors.length })
    assert.deepEqual(summary.value.counts.organizations, { status: 'known', value: published.overview.organizations.length })
    assert.deepEqual(summary.value.sources.find(source => source.kind === 'environment'), {
      kind: 'environment', sequence: published.publishedAtNativeSequence, domainRevision: published.revision,
      domainTime: String(published.day), profileRevision: snapshot.entities[environmentId]!.profileRevision })
    const detail = await products.inspectWorldCase({ runId: registered.id, requestId: selectedCase.requestId, section: 'execution' }, reader)
    assert.deepEqual(detail.value?.summary.businessSummary, summary)
    assert.ok(detail.value?.section === 'execution')
    assert.deepEqual(detail.value.result?.payload, selectedResult.payload)
    const exported = await products.readWorldDomain({ runId: registered.id, kind: 'case-extensions', requestIds: [selectedCase.requestId] }, reader)
    assert.ok(exported.kind === 'case-extensions' && exported.value !== undefined)
    assert.deepEqual(exported.value[0]?.businessSummary, summary)
    const prose = await products.inspectWorldCase({ runId: registered.id, requestId: selectedCase.requestId, section: 'request' }, reader)
    assert.ok(prose.value?.section === 'request')
    assert.equal(prose.value.description.status, 'withheld')
    revokeContext()
    const publicOnly = await products.inspectWorldCase({ runId: registered.id, requestId: selectedCase.requestId, section: 'request' }, reader)
    assert.equal(publicOnly.value?.summary.businessSummary.status, 'allowed')
    if (publicOnly.value?.summary.businessSummary.status === 'allowed') {
      assert.equal(publicOnly.value.summary.businessSummary.value.execution, 'accepted')
      assert.deepEqual(publicOnly.value.summary.businessSummary.value.counts.organizations, { status: 'withheld' })
    }
    assert.deepEqual(run.snapshot(), snapshot)
    console.log(JSON.stringify({ day: 1, caseDecisions: decisions.length, independentSessions: bound.length,
      businessProjection: 'accepted/unknown',
      modelActors: actors.size, directorInferred: actors.has('director'), stop: result?.reason }))
  }
} catch (error) {
  console.error('Harbor scenario failure', error)
  const state = run.snapshot()
  console.error(JSON.stringify({ phase: state.phase, time: state.time, stall: state.stall,
    stopping: state.runControl?.current,
    wakes: Object.values(state.wakes).filter(wake => wake.status === 'pending' || wake.status === 'claimed'),
    decisions: Object.values(state.decisions).map(value => ({ id: value.id, entity: value.entityId, status: value.status })),
    requests: Object.values(state.world?.requests ?? {}).map(value => ({ id: value.id, status: value.status })) }))
  throw error
} finally { await run.close(); await ctx.fiber.dispose() }
