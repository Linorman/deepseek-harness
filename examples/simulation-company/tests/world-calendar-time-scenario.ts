/** Actual finite office scheduling, role reassignment and delayed reply share the durable simulation clock. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { boot } from '@clocky/clocky-app-boot'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationChangeSchema,
  simulationWakeRequestSchema, simTimeSchema, simulationNormQuerySchema } from '@clocky/clocky-simulation'
import { SimulationWorldDriver, ExternalMediatedWorldExecution } from '@clocky/clocky-simulation-world'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { calendarCatalog, calendarDefinition, calendarActors } from './fixtures/world-calendar-time/source.ts'
import { calendarProbeRequests } from './fixtures/world-calendar-time/probe-model.ts'
import { mediatedModelRequests } from './world-external-mediated-model.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_CALENDAR_TIME_RECOVER === 'true'
const round = process.env.WORLD_CALENDAR_TIME_ROUND!, face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world']
  .map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(face === 'lib' ? '/lib/' : '/src/'), path)
if (face === 'lib') { assert.deepEqual(process.execArgv, []); assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false) }
const modelCalls = () => mediatedModelRequests.length + calendarProbeRequests.length
const ctx = await boot('world-calendar-time', process.argv[2]!)
const compiled = await compileWorldScenarioV1(calendarDefinition, calendarCatalog, 'json', ctx.teams.getCreationLimits())
assert.ok(compiled.ok); const resolved = compiled.resolved
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: 'calendar-time-world', ...resolved.native } })
const checkpointId = simulationCheckpointIdSchema.parse('calendar-time-complete')
const restored = recovering ? await ctx.simulationTeams.restore(selection, { id: checkpointId, implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
let connection = restored?.connection
async function journal() {
  const stream = Reflect.get(run, 'stream') as LogStream, rows = []; let after = -1
  while (after < stream.tailSequence) { const page = await stream.read(after, 128); assert.ok(page.length)
    rows.push(...page); after = page.at(-1)!.sequence }
  return rows
}
async function actual(state: SimulationSnapshot) {
  const team = await ctx.teams.getTeam({ teamId: state.teamReservation!.teamId })
  const channels = await Promise.all(team.channelIds.map(async channelId => ({ channelId,
    admission: await ctx.teams.getChannelAdmission({ channelId }),
    records: (await ctx.teams.readChannelPage({ channelId, afterCursor: -1, limit: 128 })).records })))
  const sessions = await Promise.all(Object.values(state.entities).flatMap(entity => entity.binding === undefined ? [] : [(async () => {
    const binding = entity.binding!, unmaterialized = await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)
    return { entityId: entity.id, binding, unmaterialized,
      events: unmaterialized ? [] : (await ctx.sessionPersistence.readFrom(binding.sessionId, 0)).events }
  })()]))
  return { team, channels, sessions }
}
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: 'calendar-time/original', checkpoint: { id: simulationCheckpointIdSchema.parse('calendar-time-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']; assert.equal(typeof ownerName, 'string')
  connection ??= await ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName as string)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName: ownerName as string,
    maxDrainRounds: 4, maxAttempts: 3 }
  const signal = new AbortController().signal
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, signal, ctx,
    ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: anchor,
      lifetime: signal,
    }, [new ExternalMediatedWorldExecution(run, connection, resolved, anchor, signal)]))
  const norm = () => run.queryWorldNorms(simulationNormQuerySchema.parse({ viewer: calendarActors.director,
    time: run.snapshot().time, cursor: run.snapshot().revision, ids: ['time-institution'], limit: 8 }))
  const advance = async (until: string) => {
    let value = await driver.advance(simTimeSchema.parse(until))
    for (let step = 0; step < 64 && value.reason === 'work-limit'; step++) value = await driver.advance(simTimeSchema.parse(until))
    assert.ok(['idle', 'until'].includes(value.reason), JSON.stringify(value))
  }
  if (!recovering) {
    await writeFile(resolve(root, 'input.json'), JSON.stringify({ resolved, calendarDefinition, calendarCatalog }, null, 2))
    assert.equal((await driver.advance()).reason, 'paused'); assert.equal(modelCalls(), 0)
    const paused = run.snapshot(), recordedWall = Date.now(); await delay(100)
    assert.ok(Date.now() > recordedWall); assert.deepEqual(run.snapshot(), paused)
    assert.deepEqual(norm().items, []); assert.deepEqual(norm().unknown, ['time-institution'])
    await run.setPhase('running', run.snapshot().revision)
    const beforeInvalid = run.snapshot(), callsBeforeInvalid = modelCalls(), horizonErrors: string[] = []
    const captureHorizon = (error: unknown) => { horizonErrors.push(String(error)); return /maximum/.test(String(error)) }
    await assert.rejects(run.drive({ until: simTimeSchema.parse('7') }), captureHorizon)
    await assert.rejects(run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'outside-horizon', entityId: calendarActors.requester,
      time: '7', reason: 'A horizon violation' }), run.snapshot().revision), captureHorizon)
    assert.deepEqual(run.snapshot(), beforeInvalid); assert.equal(modelCalls(), callsBeforeInvalid)
    await writeFile(resolve(root, 'horizon-before.json'), JSON.stringify({ before: beforeInvalid, after: run.snapshot(),
      errors: [...horizonErrors], callsBefore: callsBeforeInvalid, callsAfter: modelCalls() }, null, 2))
    await run.drive({ until: simTimeSchema.parse('1') })
    const occurrence = run.snapshot().worldBootstrap!.occurrences[0]!
    assert.equal(occurrence.time, '1'); assert.deepEqual(occurrence.recipients, [calendarActors.requester])
    const oldWake = Object.values(run.snapshot().scheduledEvents).find(value => value.id.startsWith('simulation-world-calendar-wake:'))!
    assert.ok(oldWake && oldWake.action.kind === 'wake' && oldWake.status === 'pending')
    const beforeReassignment = run.snapshot(), old = Object.values(beforeReassignment.relations).find(value => value.relation === 'assignment'
      && value.subject === calendarActors.requester)!
    const { revision, ...fields } = old
    await run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...fields, relationRevision: revision, validUntil: '1' }), run.snapshot().revision)
    await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'requester-standby', subject: calendarActors.requester,
      relation: 'assignment', object: 'standby-position', scope: resolved.world.organizationEntityId, validFrom: '1', validUntil: null }), run.snapshot().revision)
    await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'observer-office', subject: calendarActors.observer,
      relation: 'assignment', object: calendarActors.position, scope: resolved.world.organizationEntityId, validFrom: '1', validUntil: null }), run.snapshot().revision)
    assert.deepEqual(run.snapshot().scheduledEvents[oldWake.id], oldWake)
    assert.deepEqual(run.snapshot().worldBootstrap!.occurrences[0], occurrence)
    await writeFile(resolve(root, 'frozen-old-wake.json'), JSON.stringify({ occurrence, oldWake, beforeReassignment, afterReassignment: run.snapshot() }, null, 2))
    await advance('1')
    const request = Object.values(run.snapshot().world!.requests)[0]!
    assert.equal(request.requesterEntityId, calendarActors.requester); assert.equal(request.status, 'committed')
    const duty = Object.values(run.snapshot().world!.external.events)[0]!
    assert.equal(duty.status, 'scheduled'); assert.equal(duty.original.deliverAt, '4')
    assert.equal(run.snapshot().scheduledEvents[oldWake.id]!.status, 'consumed')
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'time-cutoff:request', entityId: calendarActors.requester, time: '1',
      reason: JSON.stringify({ kind: 'time-cutoff-probe', proposals: [
        { after: [], action: { kind: 'interaction/request', id: 'original-time-cutoff', assignee: calendarActors.observer,
          description: 'An unanswered request expires at actual simulation time4.', replyBy: '4', completeBy: '5', fulfillment: { kind: 'explicit' } } },
        { after: [], action: { kind: 'interaction/request', id: 'invalid-future-cutoff', assignee: calendarActors.observer,
          description: 'A deadline outside the horizon must reject.', replyBy: '7', completeBy: null, fulfillment: { kind: 'explicit' } } },
      ] }) }), run.snapshot().revision)
    await advance('1')
    const unanswered = Object.values(run.snapshot().interactions)[0]!
    assert.ok(unanswered && unanswered.id === 'original-time-cutoff'); assert.equal(unanswered.replyExpiredAt, undefined)
    const invalidFuture = Object.values(run.snapshot().operations).find(item => item.action.kind === 'interaction/request' && item.action.id === 'invalid-future-cutoff')!
    assert.equal(invalidFuture.result?.code, 'SIM_INTERACTION_DEADLINE_INVALID'); assert.equal(invalidFuture.result?.status, 'rejected')
    assert.equal(Object.values(run.snapshot().interactions).length, 1)
    await run.setPhase('paused', run.snapshot().revision)
    const delayedPaused = run.snapshot(); const wallBefore = Date.now(); await delay(100)
    assert.ok(Date.now() > wallBefore); assert.deepEqual(run.snapshot(), delayedPaused)
    assert.equal(Object.values(run.snapshot().world!.external.events)[0]!.status, 'scheduled')
    await writeFile(resolve(root, 'wall-clock-inert.json'), JSON.stringify({ recordedWall, wallBefore, wallAfter: Date.now(), paused, delayedPaused }, null, 2))
    await run.setPhase('running', run.snapshot().revision)
    await run.drive({ until: simTimeSchema.parse('3') })
    const next = run.snapshot().worldBootstrap!.occurrences[1]!
    assert.equal(next.time, '3'); assert.deepEqual(next.recipients, [calendarActors.observer])
    const nextWake = Object.values(run.snapshot().scheduledEvents).find(value => value.action.kind === 'wake'
      && value.action.entityId === calendarActors.observer && value.key.time === '3' && value.status === 'pending')!
    assert.ok(nextWake)
    await run.cancelEvent(nextWake.id, 'Management cancelled the second original goal without accepting productive work', run.snapshot().revision)
    assert.equal(Object.values(run.snapshot().scheduledEvents).filter(value => value.action.kind === 'world-calendar' && value.status === 'pending').length, 0)
    assert.deepEqual(norm().items, [])
    await advance('4')
    assert.equal(Object.values(run.snapshot().world!.external.events)[0]!.status, 'consumed')
    assert.equal(norm().items[0]!.effective, 'effective')
    const expired = Object.values(run.snapshot().interactions)[0]!
    assert.equal(expired.replyExpiredAt, '4'); assert.equal(expired.reply, 'pending'); assert.equal(expired.revision, 2)
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'time-cutoff:late-accept', entityId: calendarActors.observer, time: '4',
      reason: JSON.stringify({ kind: 'time-cutoff-probe', proposals: [{ after: [], action: {
        kind: 'interaction/accept', id: expired.id, expectedRevision: expired.revision } }] }) }), run.snapshot().revision)
    await advance('4')
    const lateAccept = Object.values(run.snapshot().operations).find(item => item.action.kind === 'interaction/accept')!
    assert.equal(lateAccept.result?.code, 'SIM_REPLY_EXPIRED'); assert.equal(lateAccept.result?.status, 'rejected')
    assert.deepEqual(Object.values(run.snapshot().interactions)[0], expired)
    assert.equal(Object.values(run.snapshot().commitments).length, 0)
    await writeFile(resolve(root, 'at-four.json'), JSON.stringify({ state: run.snapshot(), norm: norm(), actual: await actual(run.snapshot()), journal: await journal() }, null, 2))
    await advance('5'); assert.equal(norm().items[0]!.effective, 'historical')
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'time-cutoff:past-request', entityId: calendarActors.requester, time: '5',
      reason: JSON.stringify({ kind: 'time-cutoff-probe', proposals: [{ after: [], action: {
        kind: 'interaction/request', id: 'invalid-past-cutoff', assignee: calendarActors.observer,
        description: 'A new deadline cannot enter the committed past.', replyBy: '4', completeBy: '5', fulfillment: { kind: 'explicit' } } }] }) }), run.snapshot().revision)
    await advance('5')
    const invalidPast = Object.values(run.snapshot().operations).find(item => item.action.kind === 'interaction/request' && item.action.id === 'invalid-past-cutoff')!
    assert.equal(invalidPast.result?.code, 'SIM_INTERACTION_DEADLINE_INVALID'); assert.equal(invalidPast.result?.status, 'rejected')
    assert.equal(Object.values(run.snapshot().interactions).length, 1)
    await advance('6')
    // Empty World driver work does not manufacture a clock boundary at the requested horizon.
    assert.equal(run.snapshot().time, '5')
    const explicitHorizon = await run.drive({ until: simTimeSchema.parse('6') })
    assert.equal(run.snapshot().time, '6')
    const beforeBad = run.snapshot(), callsBefore = modelCalls()
    await assert.rejects(run.drive({ until: simTimeSchema.parse('7') }), captureHorizon)
    assert.deepEqual(run.snapshot(), beforeBad); assert.equal(modelCalls(), callsBefore)
    await assert.rejects(run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'past-wake', entityId: calendarActors.requester,
      time: '5', reason: 'A new event cannot enter the committed past' }), run.snapshot().revision), (error: unknown) => {
      horizonErrors.push(String(error)); return /committed past/.test(String(error))
    })
    assert.deepEqual(run.snapshot(), beforeBad); assert.equal(modelCalls(), callsBefore)
    await writeFile(resolve(root, 'horizon-after.json'), JSON.stringify({ before: beforeBad, after: run.snapshot(), explicitHorizon,
      errors: [...horizonErrors], callsBefore, callsAfter: modelCalls() }, null, 2))
    await run.setPhase('paused', run.snapshot().revision)
    const completed = await connection.checkpoint({ id: checkpointId, implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(completed.status, 'completed')
    await writeFile(resolve(root, 'original.json'), JSON.stringify({ state: run.snapshot(), norm: norm(), actual: await actual(run.snapshot()),
      journal: await journal(), modelRequests: mediatedModelRequests, probeRequests: calendarProbeRequests }, null, 2))
  } else {
    const original = JSON.parse(await readFile(resolve(root, 'original.json'), 'utf8')) as {
      state: SimulationSnapshot
      actual: Awaited<ReturnType<typeof actual>>
      journal: Awaited<ReturnType<typeof journal>>
    }
    assert.deepEqual(run.snapshot(), original.state)
    assert.deepEqual(await actual(run.snapshot()), original.actual)
    assert.deepEqual(await journal(), original.journal)
    assert.equal((await driver.advance()).reason, 'paused'); assert.equal(modelCalls(), 0)
  }
  const state = run.snapshot(), records = await journal(), current = await actual(state)
  const consumed = records.flatMap((entry) => {
    const value = entry.value as { kind: string; change?: { kind: string; id: string } }
    if (value.kind !== 'run/scheduler' || value.change?.kind !== 'event/consumed') return []
    const event = Object.values(state.scheduledEvents).find(item => item.id === value.change!.id)!
    assert.ok(event && event.status === 'consumed')
    return [{ sequence: entry.sequence, id: event.id, key: event.key, action: event.action }]
  })
  for (let i = 1; i < consumed.length; i++) {
    const left = consumed[i - 1]!.key, right = consumed[i]!.key
    const compare = BigInt(left.time) !== BigInt(right.time) ? BigInt(left.time) < BigInt(right.time)
      : BigInt(left.microstep) !== BigInt(right.microstep) ? BigInt(left.microstep) < BigInt(right.microstep)
        : left.phase !== right.phase ? state.spec.phaseOrder.indexOf(left.phase) < state.spec.phaseOrder.indexOf(right.phase)
          : BigInt(left.slot) < BigInt(right.slot)
    assert.ok(compare, 'Actual committed consumption follows canonical numeric time/microstep/phase/slot order')
  }
  const atFour = consumed.filter(item => item.key.time === '4')
  assert.deepEqual(atFour.map(item => item.action.kind), ['wake', 'norm-boundary', 'external-adjudicated-event', 'reply-deadline', 'wake', 'outbox-ready', 'wake', 'wake'])
  assert.equal(atFour[0]!.action.kind, 'wake'); assert.ok(atFour[0]!.id.startsWith('simulation-norm-announcement:'))
  assert.ok(atFour[4]!.id.startsWith('simulation-external-adjudication-result:'))
  const atFive = consumed.filter(item => item.key.time === '5')
  assert.deepEqual(atFive.map(item => item.action.kind), ['norm-boundary', 'wake'])
  const duty = Object.values(state.world!.external.events)[0]!
  assert.ok(duty.consumption); assert.equal(duty.consumption.sequence, atFour[2]!.sequence)
  assert.equal(duty.original.deliverAt, '4'); assert.equal(duty.consumption.time, '4')
  assert.equal(duty.consumption.actualPublication?.availableAt, '4')
  assert.equal(duty.consumption.actualPublication?.effectiveFrom, '4')
  const first = state.worldBootstrap!.occurrences[0]!, next = state.worldBootstrap!.occurrences[1]!
  assert.deepEqual(first.recipients, [calendarActors.requester]); assert.deepEqual(next.recipients, [calendarActors.observer])
  const originalWake = consumed.filter(item => item.id.startsWith('simulation-world-calendar-wake:') && item.key.time === first.time)
  assert.equal(originalWake.length, 1)
  const decision = Object.values(state.decisions).find(item => item.wakeId === originalWake[0]!.id)!
  assert.ok(decision && decision.entityId === calendarActors.requester && decision.status === 'accepted')
  assert.equal(decision.time, '1')
  assert.ok(decision.context?.status === 'prepared')
  const contextView = decision.context.view
  const requesterSession = current.sessions.find(item => item.entityId === calendarActors.requester)!
  const recordedContext = requesterSession.events.find(item => item.type === 'simulation/context-view'
    && item.data.inputId === contextView.inputId)
  assert.ok(recordedContext && recordedContext.type === 'simulation/context-view')
  assert.deepEqual(recordedContext.data, contextView)
  assert.ok(JSON.stringify(recordedContext.data.content).includes('standby-position'))
  const canonicalPosts: unknown[] = []
  for (const operation of Object.values(state.operations)) {
    if (operation.action.kind !== 'communication/post') continue
    const receipt = operation.outbox?.receipt
    assert.ok(receipt && operation.delivery?.receipt)
    const accepted = current.channels.flatMap(item => item.records).filter(item => item.type === 'channel/envelope'
      && item.envelope.id === receipt.envelopeId)
    assert.equal(accepted.length, 1); const record = accepted[0]!
    assert.ok(record.type === 'channel/envelope')
    assert.equal(record.envelope.senderId, state.entities[operation.entityId]!.binding!.participantId)
    assert.equal(operation.action.deliverAt, operation.result!.time)
    assert.equal(operation.delivery.time, operation.action.deliverAt)
    const expected = renderDirectV4EnvelopeInput(record.envelope)
    const recipientId = operation.action.recipient
    const recipient = current.sessions.find(item => item.entityId === recipientId)!
    const inbox = recipient.events.flatMap(item => item.type === 'agent/inbox/spliced'
      ? item.data.inserted.filter(message => message.id === expected.id) : [])
    assert.equal(inbox.length, 1); assert.deepEqual(inbox[0], expected)
    const received = recipient.events.filter(item => item.type === 'user/message' && item.surfaceOp === 'append' && item.data.id === expected.id)
    assert.equal(received.length, 1); const entered = received[0]!
    assert.ok(entered.type === 'user/message'); assert.deepEqual(entered.data, expected)
    assert.equal(JSON.stringify(record.envelope).includes('PRIVATE-C30-DIRECTOR-FACT-CANARY'), false)
    canonicalPosts.push({ operationId: operation.id, simulatedTime: operation.delivery.time, accepted: record, inbox, received })
  }
  assert.equal(canonicalPosts.length, 3)
  const reply = Object.values(state.operations).find(item => item.action.kind === 'communication/post' && item.action.deliverAt === '4')!
  assert.equal(reply.entityId, calendarActors.director); assert.equal(reply.delivery!.time, duty.consumption.time)
  await writeFile(resolve(root, `proof-${round}.json`), JSON.stringify({ state, norm: norm(), actual: current,
    journal: records, consumed, canonicalPosts, originalGoalDecisionId: decision.id,
    modelCalls: modelCalls(), runtimePaths, execArgv: process.execArgv }, null, 2))
  process.stdout.write(JSON.stringify({ phase: run.snapshot().phase, modelCalls: modelCalls(),
    frozenOccurrenceRecipient: true, actualSelectedActorConsumed: true, futureReceiverAtActualTime: true,
    actualExpiredReplyRejected: true, invalidDeadlineRejected: true, simulatedDeadlineEffectReply: true, wallClockInert: true, horizonRejected: true, runtimePaths, execArgv: process.execArgv }) + '\n')
} catch (error) {
  await writeFile(resolve(root, `failure-${round}.json`), JSON.stringify({ error: String(error), state: run.snapshot(),
    journal: await journal(), modelRequests: mediatedModelRequests, probeRequests: calendarProbeRequests }, null, 2))
  throw error
} finally { await connection?.close(); await run.close(); await ctx.fiber.dispose() }
