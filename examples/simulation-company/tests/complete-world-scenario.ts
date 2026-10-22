/** One original portable world executes its authored workflow through the shared driver, then restores in fresh processes. */
import assert from 'node:assert/strict'
import { verifyCheckpointWorldCoverage } from './checkpoint-world-coverage.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import SimulationProducts, { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { simulationProductRunIdSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldDomainInputSchema, simulationProductWorldDomainResultSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import type { SimulationProductWorldDomainInput, SimulationProductWorldDomainResult, EngineRef } from '@clocky/clocky-simulation-product/world-read-types'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simTimeSchema,
  simulationEntityIdSchema, simulationDecisionIdSchema, simulationOperationIdSchema,
  simulationWorldHireCommittedResultPayloadSchema, personnelObligationQuerySchema,
  PERSONNEL_OBLIGATION_MAX_ITEMS, PERSONNEL_OBLIGATION_MAX_BYTES } from '@clocky/clocky-simulation'
import { SimulationWorldDomainError } from '@clocky/clocky-simulation'
import { SimulationWorldDriver, OrganizationWorldExecution, ExistingHireWorldExecution, GovernanceWorldExecution,
  NormWorldExecution, ExternalMediatedWorldExecution, PersonnelWorldExecution } from '@clocky/clocky-simulation-world'
import type { SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import type { LogStream } from '@clocky/clocky-storage'
import type { PersonnelObligationReport } from '@clocky/clocky-simulation'
import { definition, deployment } from './fixtures/complete-world/source.ts'
import { requests } from './fixtures/complete-world/model.ts'
import { installWorldReplayProbe } from './world-replay-probe.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recover = process.env.WORLD_COMPLETE_RECOVER === 'true'
const round = process.env.WORLD_COMPLETE_ROUND!, face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local',
  '@clocky/clocky-simulation-world', '@clocky/clocky-simulation-product']
  .map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(face === 'lib' ? '/lib/' : '/src/'), path)
if (face === 'lib') { assert.deepEqual(process.execArgv, []); assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false) }
const ctx = await boot('complete-world', process.argv[2]!), errors: string[] = []
const replayProbe = recover && process.env.WORLD_REPLAY_PROBE === 'true' ? installWorldReplayProbe(ctx) : undefined
ctx.on('agent/error', ({ error }) => { errors.push(error instanceof Error ? error.stack ?? error.message : String(error)) })
const compiled = await compileWorldScenarioV1(definition, deployment, 'json', ctx.teams.getCreationLimits())
assert.ok(compiled.ok, JSON.stringify(compiled)); const resolved = compiled.resolved
const checkpointId = simulationCheckpointIdSchema.parse('complete-world-final')
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recover ? 'open' : 'create',
  spec: { runId: 'complete-world', ...resolved.native } })
const restored = recover ? await ctx.simulationTeams.restore(selection, { id: checkpointId, implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection), lifetime = new AbortController()
let connection = restored?.connection, driver: SimulationWorldDriver | undefined
async function journal() {
  const stream = Reflect.get(run, 'stream') as LogStream, entries = []; let after = -1
  while (after < stream.tailSequence) {
    const page = await stream.read(after, 128); assert.ok(page.length); entries.push(...page); after = page.at(-1)!.sequence
  }
  return entries
}
async function sessions() {
  return await Promise.all(Object.values(run.snapshot().entities).flatMap(entity => entity.binding === undefined ? [] : [(async () => {
    const binding = entity.binding!, unmaterialized = await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)
    return { entityId: entity.id, binding, unmaterialized,
      events: unmaterialized ? [] : (await ctx.sessionPersistence.readFrom(binding.sessionId, 0)).events }
  })()]))
}
const steps: SimulationWorldDriveResult[] = []
try {
  if (!recover) await prepareSimulationWorld(ctx.simulationTeams, run, { resolved, ownerName: 'complete-world/original',
    checkpoint: { id: simulationCheckpointIdSchema.parse('complete-world-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']; assert.equal(typeof ownerName, 'string')
  connection ??= await ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName as string)
  const anchor = { checkpointId: simulationCheckpointIdSchema.parse('complete-world-initial'), ownerName: ownerName as string, maxDrainRounds: 4, maxAttempts: 3 }
  driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime.signal, ctx, ctx.simulationWorldExecutions.handlers({
    run: run,
    connection: connection,
    resolved: resolved,
    anchor: anchor,
    lifetime: lifetime.signal,
  }, [
    new OrganizationWorldExecution(run, connection, resolved, anchor, lifetime.signal), new ExistingHireWorldExecution(run),
    new GovernanceWorldExecution(run, 'proposal'), new GovernanceWorldExecution(run, 'vote'), new GovernanceWorldExecution(run, 'hire-approval'),
    new NormWorldExecution(run, 'enact'), new ExternalMediatedWorldExecution(run, connection, resolved, anchor, lifetime.signal),
    new PersonnelWorldExecution(run, connection, anchor, lifetime.signal, 'transfer'), new PersonnelWorldExecution(run, connection, anchor, lifetime.signal, 'depart')]))
  if (!recover) {
    await writeFile(resolve(root, 'input.json'), JSON.stringify({ definition, deployment, resolved }, null, 2))
    assert.equal(run.snapshot().phase, 'paused'); assert.equal(requests.length, 0)

    await writeFile(resolve(root, 'initial.json'), JSON.stringify({ state: run.snapshot(), sessions: await sessions(), journal: await journal() }, null, 2))
    await run.setPhase('running', run.snapshot().revision)
    const boundaries = new Set(definition.behavior.initialGoals.map(value => value.at))
    for (const calendar of definition.behavior.calendars) for (let n = 0; n < calendar.maxOccurrences; n += 1)
      boundaries.add(String(BigInt(calendar.startsAt) + BigInt(calendar.period) * BigInt(n)))
    const advance = async (time: string) => {
      for (let n = 0; n < 256; n += 1) {
        const step = await driver!.advance(simTimeSchema.parse(time)); steps.push(step)
        await writeFile(resolve(root, 'progress.json'), JSON.stringify({ state: run.snapshot(), steps, modelRequests: requests }, null, 2))
        if (step.reason === 'work-limit') continue
        assert.ok(['until', 'idle', 'approval-required'].includes(step.reason), JSON.stringify({ step, errors }))
        return
      }
      throw new Error('The declared driver step budget was exhausted')
    }
    const times = [...boundaries].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)
    for (const time of times) {
      await advance(time)
      const governance = run.snapshot().world!.governance
      for (const proposal of Object.values(governance.proposals)) {
        const ballotCount = Object.values(governance.votes).filter(value => value.proposalId === proposal.id).length
        if (ballotCount !== proposal.electorate.length) continue
        const resolution = Object.values(governance.resolutions).find(value => value.proposalId === proposal.id)
        assert.ok(resolution, 'The production domain boundary must close the original complete electorate')
        assert.equal(resolution.outcome, 'passed')
      }
      await advance(time)
      const current = run.snapshot()
      const original = Object.values(current.interactions).find(value => value.id === 'handoff-original')
      if (original?.commitmentId !== undefined && time === '15') {
        const obligation = current.commitments[original.commitmentId]!
        assert.equal(original.reply, 'accepted'); assert.equal(obligation.phase, 'open')
        assert.equal(obligation.debtor, original.assignee)
        const person = current.entities[original.assignee]!
        const selector = personnelObligationQuerySchema.parse({ selector: { kind: 'person', personId: person.id,
          personRevision: person.revision }, limit: PERSONNEL_OBLIGATION_MAX_ITEMS, maxBytes: PERSONNEL_OBLIGATION_MAX_BYTES })
        const calls: number = requests.length
        const inventory: PersonnelObligationReport = await connection.inspectPersonnelObligations(selector)
        assert.equal(inventory.complete, true)
        assert.ok(inventory.items.some(value => value.ref.kind === 'commitment' && value.ref.id === obligation.id))
        assert.deepEqual(run.snapshot(), current); assert.equal(requests.length, calls)
        await writeFile(resolve(root, 'handoff-open.json'), JSON.stringify({ state: current, inventory,
          sessions: await sessions(), journal: await journal() }, null, 2))
      }
      if (original?.commitmentId !== undefined && time === '16') {
        const replacement = Object.values(current.interactions).find(value => value.id === 'handoff-replacement')
        assert.ok(replacement?.commitmentId)
        assert.equal(original.assignee, current.commitments[original.commitmentId]!.debtor)
        assert.equal(current.commitments[original.commitmentId]!.phase, 'cancelled')
        assert.equal(replacement.reply, 'accepted'); assert.equal(replacement.execution, 'completed')
        assert.equal(current.commitments[replacement.commitmentId]!.phase, 'fulfilled')
        assert.notEqual(replacement.assignee, original.assignee)
        await writeFile(resolve(root, 'handoff-settled.json'), JSON.stringify({ state: current,
          sessions: await sessions(), journal: await journal() }, null, 2))
      }
    }
    assert.equal(errors.length, 0, errors.join('\n'))
    const state = run.snapshot(), world = state.world!, votes = Object.values(world.governance.votes)
    const generated = Object.values(world.reservations).find(value => value.status === 'committed')
    const existing = Object.values(world.results).find(value => world.requests[value.requestId]?.pin.operation === 'hire-existing')
    const appointment = generated === undefined ? existing : Object.values(world.results).find(value => value.intentId === generated.id)
    assert.ok(appointment && appointment.outcome.kind === 'committed')
    const identity = simulationWorldHireCommittedResultPayloadSchema.parse(appointment.payload)
    const person = state.entities[identity.entityId]!
    assert.ok(person && person.readiness === 'ready')
    for (const proposal of Object.values(world.governance.proposals)) {
      const actual = votes.filter(value => value.proposalId === proposal.id)
      assert.equal(new Set(actual.map(value => value.source.binding.sessionId)).size, 2)
    }
    if (generated !== undefined) {
      assert.equal(votes.length, 4); assert.equal(Object.values(world.norms.versions).flat().length, 1)
      assert.deepEqual(Object.values(state.resources).map(value => value.quantity), ['7', '3'])
      assert.equal(Object.values(world.external.representatives).filter(value => value.status === 'committed').length, 1)
      assert.equal(Object.values(world.personnel.reservations).filter(value => value.status === 'committed').length, 2)
      assert.ok(Object.values(world.results).some(value => world.requests[value.requestId]?.pin.operation === 'depart' && value.outcome.kind === 'committed'))
      assert.equal(Object.values(state.relations).filter(value => value.relation === 'assignment' && value.subject === person.id && value.validUntil === null).length, 0)
      assert.deepEqual(person.binding, generated.identities.binding)
      const representative = Object.values(world.external.representatives)[0]!
      const reply = Object.values(state.operations).find(value => value.entityId === representative.identities.entityId
        && value.action.kind === 'communication/post' && value.action.recipient === person.id)
      assert.ok(reply?.delivery?.receipt)
      assert.equal(state.entities[world.external.identities[representative.identityId]!.subjectRef]!.cognition, 'none')
      const original = Object.values(state.interactions).find(value => value.id === 'handoff-original')
      const replacement = Object.values(state.interactions).find(value => value.id === 'handoff-replacement')
      assert.ok(original?.commitmentId && replacement?.commitmentId)
      assert.equal(original.assignee, person.id); assert.equal(original.execution, 'cancelled')
      assert.notEqual(replacement.assignee, original.assignee)
      assert.equal(state.commitments[original.commitmentId]!.phase, 'cancelled')
      assert.equal(state.commitments[replacement.commitmentId]!.phase, 'fulfilled')
      const acceptance = Object.values(state.operations).find(value => value.entityId === replacement.assignee
        && value.action.kind === 'interaction/accept' && value.action.id === replacement.id)
      assert.ok(acceptance?.result?.status === 'applied')
      const closed = Object.values(world.results).find(value => world.requests[value.requestId]?.pin.operation === 'depart')!
      assert.ok(closed.sequence > acceptance.result.sequence)
    } else {
      assert.equal(votes.length, 2); assert.equal(person.id, 'candidate'); assert.deepEqual(state.resources, {})
      assert.equal(Object.values(world.external.representatives).length, 0)
      const failures = Object.values(world.external.adjudications)
      assert.equal(failures.length, 2)
      assert.ok(failures.every(value => value.proposal.outcome.kind === 'failure'))
      const before = JSON.parse(await readFile(resolve(root, 'initial.json'), 'utf8')) as { state: typeof state }
      assert.deepEqual(person.binding, before.state.entities[person.id]!.binding)
      assert.deepEqual(person.profile, before.state.entities[person.id]!.profile)
    }
    const privateBodies = definition.facts.filter(value => value.audience.kind === 'actors').map(value => value.body)
    for (const call of requests.filter(value => value.actor === person.id)) for (const body of privateBodies)
      assert.equal(JSON.stringify(call.messages).includes(body), false)
    await run.setPhase('paused', run.snapshot().revision)
    await driver.drain()
    const checkpoint = await connection.checkpoint({ id: checkpointId, implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
    if (process.env.WORLD_CHECKPOINT_COVERAGE === 'true') await verifyCheckpointWorldCoverage(run, root)
    await writeFile(resolve(root, 'original.json'), JSON.stringify({ state: run.snapshot(), sessions: await sessions(), journal: await journal(), modelRequests: requests, steps }, null, 2))
  } else {
    const original = JSON.parse(await readFile(resolve(root, 'original.json'), 'utf8')) as {
      state: ReturnType<typeof run.snapshot>
      sessions: Awaited<ReturnType<typeof sessions>>
      journal: Awaited<ReturnType<typeof journal>>
    }
    assert.deepEqual(run.snapshot(), original.state)
    assert.deepEqual(await sessions(), original.sessions)
    assert.deepEqual(await journal(), original.journal)
    assert.equal(run.snapshot().phase, 'paused'); assert.equal(requests.length, 0)
    if (replayProbe !== undefined) {
      const step = await driver.advance()
      assert.equal(step.reason, 'paused')
      assert.deepEqual(run.snapshot(), original.state)
      assert.deepEqual(await sessions(), original.sessions)
      assert.deepEqual(await journal(), original.journal)
      assert.deepEqual(replayProbe.snapshot(), { model: 0, execution: 0, randomSample: 0, fetch: 0, socket: 0,
        productionAllowed: false })
      await writeFile(resolve(root, `replay-probe-${round}.json`), JSON.stringify({ pid: process.pid, face,
        backend: process.env.SIMULATION_COMPANY_BACKEND, scene: process.env.WORLD_SCENARIO,
        checkpointId, counters: replayProbe.snapshot(), step, originalStateUnchanged: true,
        originalSessionsUnchanged: true, originalJournalUnchanged: true }, null, 2))
    }
  }
  if (process.env.WORLD_CASE_DUTIES === 'true' || process.env.WORLD_DOMAIN_READS === 'true') {
    const state = run.snapshot(), runId = simulationProductRunIdSchema.parse('complete-world-cases')
    await ctx.plugin(SimulationProducts, { directoryStream: 'complete-world-case-directory', imports: [{
      id: runId, name: 'Complete World', provider: 'local', spec: state.spec, ownerPrincipalId: productPrincipalId('case-reader') }] })
    const call: AuthenticatedProductCall = { principal: { id: 'case-reader' as never, issuer: 'test', subject: 'case-reader',
      assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
    const views = []
    let schemaRefusals = 0
    const schemaFailure = (error: unknown) => error instanceof SimulationWorldDomainError && error.code === 'SIM_WORLD_SCHEMA'
      && error.cause instanceof Error && error.cause.name === 'ZodError'
    for (const request of Object.values(state.world!.requests)) {
      assert.ok(request.requesterEntityId !== null && request.source.kind === 'decision')
      assert.throws(() => run.openWorldIntent(request.requesterEntityId,
        { ...request.proposal, requester: 'forged' } as never), schemaFailure)
      await assert.rejects(run.openWorldIntent(request.requesterEntityId,
        { ...request.proposal, payload: { forged: true } }), schemaFailure)
      schemaRefusals += 2
      const planId = request.plans.at(-1)
      if (planId !== undefined) {
        assert.throws(() => run.commitWorldMutation({ planId, payload: {}, requester: 'forged' } as never), schemaFailure)
        await assert.rejects(run.commitWorldMutation({ planId, payload: { forged: true } }), schemaFailure)
        schemaRefusals += 2
      }
      const detail = await ctx.simulationProducts.inspectWorldCase({ runId, requestId: request.id, section: 'execution' }, call)
      assert.ok(detail.value?.section === 'execution')
      const latest = request.plans.at(-1), observation = latest === undefined ? undefined : state.world!.executions[latest]
      if (observation !== undefined) assert.deepEqual(detail.value.observation, {
        planId: observation.planId, mode: observation.mode, sequence: observation.sequence,
        updates: observation.updates, time: observation.time,
        status: observation.phase === 'armed' ? 'outcome-unknown' : observation.phase,
        reason: observation.phase === 'armed' ? 'callback-unconfirmed' : observation.reason,
      })
      const notification = await ctx.simulationProducts.inspectWorldCase({ runId, requestId: request.id, section: 'notification' }, call)
      assert.ok(notification.value?.section === 'notification')
      const first = `simulation-world-first:${request.intentId}`
      if (Object.hasOwn(state.wakes, first) || Object.hasOwn(state.scheduledEvents, first))
        assert.equal(notification.value.firstAction?.wake.id, first)
      const expected = state.world!.personnel.reservations[request.intentId]
      if (expected !== undefined) assert.deepEqual(detail.value.responsibilities, [{ kind: 'personnel', id: expected.id,
        planId: expected.request.planId, status: expected.status, sequence: expected.sequence, updatedSequence: expected.updatedSequence }])
      const contact = state.world!.external.contacts[request.intentId]
      if (contact !== undefined) {
        const representative = state.world!.external.representatives[contact.representativeIntentId]!
        assert.deepEqual(detail.value.responsibilities, [
          { kind: 'representative', id: representative.id, planId: representative.request.planId, status: representative.status,
            sequence: representative.sequence, updatedSequence: representative.updatedSequence },
          { kind: 'contact', id: contact.id, planId: contact.planId, status: contact.status,
            sequence: contact.sequence, updatedSequence: contact.updatedSequence }])
      }
      views.push(detail)
    }
    assert.deepEqual(run.snapshot(), state)
    await writeFile(resolve(root, `case-duties-${round}.json`), JSON.stringify({ views, schemaRefusals, modelCalls: requests.length }, null, 2))
    if (process.env.WORLD_DOMAIN_READS === 'true') {
      const calls = requests.length, responses: SimulationProductWorldDomainResult[] = [], checked = new Set<string>()
      const sequences = new Set((await journal()).map(entry => entry.sequence))
      const checkRef = async (ref: EngineRef) => {
        const key = JSON.stringify(ref)
        if (checked.has(key)) return
        checked.add(key)
        switch (ref.kind) {
          case 'entity': assert.ok(state.entities[simulationEntityIdSchema.parse(ref.id)]); break
          case 'decision': assert.ok(state.decisions[simulationDecisionIdSchema.parse(ref.id)]); break
          case 'operation': assert.ok(state.operations[simulationOperationIdSchema.parse(ref.id)]); break
          case 'checkpoint': assert.equal(state.checkpoints?.[simulationCheckpointIdSchema.parse(ref.id)]?.status, 'completed'); break
          case 'record': assert.ok(sequences.has(ref.sequence)); break
          case 'team-task': {
            const task = await ctx.teams.getTask({ teamId: ref.teamId, taskId: ref.id })
            assert.equal(task.id, ref.id); break
          }
          case 'envelope': {
            if (ref.sourceIndex !== undefined && ref.decisionId !== undefined) {
              const original = state.decisions[simulationDecisionIdSchema.parse(ref.decisionId)]?.context
              assert.equal(original?.status, 'prepared')
              if (original?.status !== 'prepared') throw new Error('Original frozen source is absent')
              const source = original.view.sources[ref.sourceIndex]
              assert.equal(source?.kind, 'team-envelope')
              if (source?.kind !== 'team-envelope') throw new Error('Original Envelope source is absent')
              assert.equal(source.teamId, ref.teamId); assert.equal(source.channelId, ref.channelId)
              assert.equal(source.envelopeId, ref.envelopeId)
            } else {
              assert.notEqual(ref.envelopeSequence, undefined)
              const page = await ctx.teams.readChannelPage({ channelId: ref.channelId,
                afterCursor: ref.envelopeSequence! - 1, limit: 1 })
              assert.ok(page.records.some(value => value.type === 'channel/envelope' && value.envelope.id === ref.envelopeId
                && value.envelope.teamId === ref.teamId && value.envelope.sequence === ref.envelopeSequence))
            }
            break
          }
          default: { const unsupported: never = ref; throw new Error(`Unverified World source ${JSON.stringify(unsupported)}`) }
        }
      }
      const refs = async (value: unknown): Promise<void> => {
        if (value === null || typeof value !== 'object') return
        if (Array.isArray(value)) { for (const item of value) await refs(item); return }
        if ('kind' in value && 'id' in value && ['entity', 'decision', 'operation', 'checkpoint', 'envelope', 'team-task'].includes(String(value.kind))) {
          // The enclosing strict domain parser owns every reference; no untrusted raw Native payload is accepted here.
          await checkRef(value as EngineRef)
        } else if ('kind' in value && value.kind === 'record' && 'sequence' in value) await checkRef(value as EngineRef)
        for (const item of Object.values(value)) await refs(item)
      }
      const read = async (query: SimulationProductWorldDomainInput) => {
        let cursor: SimulationProductWorldDomainInput['cursor'], readVersion: SimulationProductWorldDomainInput['readVersion'], pages = 0
        do {
          assert.ok(++pages <= 1024, 'The explicit metadata page bound was exhausted')
          const selected = simulationProductWorldDomainInputSchema.parse({ ...query, limit: 2, ...cursor === undefined ? {} : {
            cursor, expectedRevision: state.revision, readVersion } })
          const value = simulationProductWorldDomainResultSchema.parse(await ctx.simulationProducts.readWorldDomain(selected, call))
          assert.equal(value.snapshotRevision, state.revision)
          assert.equal(value.status, 'found')
          await refs(value.value); responses.push(value)
          cursor = value.coverage.nextCursor
          readVersion = value.readVersion
        } while (cursor !== undefined)
      }
      await read({ runId, kind: 'overview' })
      for (const lens of ['structure', 'people', 'timeline'] as const) await read({ runId, kind: 'organization', lens })
      for (const person of Object.values(state.entities).filter(value => value.kind === 'person'))
        for (const section of ['identity', 'tenures', 'obligations'] as const) await read({ runId, kind: 'person', personId: person.id, section })
      for (const lens of ['proposals', 'norms', 'history'] as const) await read({ runId, kind: 'governance', lens })
      for (const proposal of Object.values(state.world!.governance.proposals))
        for (const section of ['record', 'electorate', 'votes'] as const) await read({ runId, kind: 'proposal', proposalId: proposal.id, section })
      for (const norm of Object.values(state.world!.norms.versions).flat())
        await read({ runId, kind: 'norm', versionId: JSON.stringify([norm.id, norm.version]) })
      await read({ runId, kind: 'external' })
      for (const identity of Object.values(state.world!.external.identities))
        for (const section of ['record', 'facts', 'representatives', 'interactions'] as const) await read({ runId, kind: 'identity', key: identity.id, section })
      const ids = Object.values(state.world!.requests).map(request => request.id)
      if (ids.length > 0) await read({ runId, kind: 'case-extensions', requestIds: ids })
      const contacts = Object.values(state.world!.external.contacts)
      const projectedContacts = responses.flatMap(value => value.kind === 'identity'
        && 'section' in value.selection && value.selection.section === 'interactions' ? value.value?.interactions ?? [] : [])
      for (const contact of contacts) assert.ok(projectedContacts.some(value => value.id === contact.id
        && value.kind === 'simulated-actor' && value.outcome.text.includes('reply-post:applied')
        && value.outcome.text.includes('publication:published') && value.outcome.text.includes('delivery:received')),
      'Original simulated-actor contact and its actual published/received reply are absent from public interaction pages')
      if (process.env.WORLD_SCENARIO !== 'association') assert.ok(contacts.length > 0, 'Actual supplier workflow must retain contact history')
      assert.deepEqual(run.snapshot(), state); assert.equal(requests.length, calls)
      await writeFile(resolve(root, `world-domains-${round}.json`), JSON.stringify({ responses, checkedSources: [...checked],
        counts: { proposals: Object.keys(state.world!.governance.proposals).length,
          votes: Object.keys(state.world!.governance.votes).length,
          interactions: Object.keys(state.world!.external.interactions).length, contacts: contacts.length,
          projectedContacts: projectedContacts.filter(value => value.kind === 'simulated-actor').length, cases: ids.length },
        modelCallsBefore: calls, modelCallsAfter: requests.length, readOnly: true }, null, 2))
    }
  }
  const output = { scene: process.env.WORLD_SCENARIO, face, backend: process.env.SIMULATION_COMPANY_BACKEND,
    pid: process.pid, round, phase: run.snapshot().phase, modelCalls: requests.length, actualAuthoredWorkflow: true, runtimePaths }
  await writeFile(resolve(root, `round-${round}.json`), JSON.stringify({ ...output, state: run.snapshot(), sessions: await sessions(), journal: await journal() }, null, 2))
  process.stdout.write(JSON.stringify(output) + '\n')
} catch (error) {
  await writeFile(resolve(root, `failed-${round}.json`), JSON.stringify({ error: error instanceof Error ? error.stack : String(error), errors,
    state: run.snapshot(), sessions: await sessions(), journal: await journal(), modelRequests: requests, steps }, null, 2))
  throw error
} finally { await driver?.drain(); await connection?.close(); await run.close(); await ctx.fiber.dispose(); replayProbe?.dispose() }
