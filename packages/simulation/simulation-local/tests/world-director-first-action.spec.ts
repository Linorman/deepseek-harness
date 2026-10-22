/** A real consumed director event cannot create an external representative or a first-contact disclosure route. */
import { expect, it } from 'vitest'
import { z } from 'zod'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenarioV1, worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { WORLD_EXTERNAL_MEDIATED_PIN, simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationDecisionIdSchema,
  simulationProposalSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationContextRequest, SimulationEventId } from '@clocky/clocky-simulation'
import { worldV1Definition, worldV1Catalog } from '../../../../examples/simulation-company/tests/fixtures/world-v1-product/deployment.ts'
import { contextRequest } from './context-fixture.ts'
import { decisionInput } from '../../simulation-team/src/input.ts'

it('rejects representative preparation at the actual scenario-director request boundary before any first contact', async () => {
  const evidence = resolve('.local/world-completion/thread-01a1336a-role-projection')
  await mkdir(evidence, { recursive: true }); const root = await mkdtemp(resolve(evidence, 'director-contact-'))
  const previousRoot = process.env.SIMULATION_COMPANY_ROOT, previousBackend = process.env.SIMULATION_COMPANY_BACKEND
  process.env.SIMULATION_COMPANY_ROOT = root; process.env.SIMULATION_COMPANY_BACKEND = 'json'
  const ctx = await boot('director-first-action-probe', resolve('examples/simulation-company/tests/fixtures/world-director-events/cordis.yml'))
  const source = structuredClone(worldV1Definition), catalog = structuredClone(worldV1Catalog)
  const directorId = source.entities.find(value => value.kind === 'person' && value.cognition === 'agent' && value.role === 'director')!.id
  source.domains = [{ domain: 'external', operation: 'interact', version: '3' }]
  source.organization.grants = []; source.governance = { committees: [], norms: [] }; source.knowledge = []
  source.externalWorld.adjudicationPolicy!.allowedOutcomeKinds = ['representative-preparation-plan']
  source.behavior = { initialGoals: [], calendars: [{ id: 'first-contact', startsAt: '1', endsAt: '1', period: '1', maxOccurrences: 1,
    target: { kind: 'person', personId: directorId }, body: 'Contact the declared external representative.' }],
  directorEvents: [{ id: 'original-contact', calendarId: 'first-contact', domain: 'external', operation: 'interact', version: '3',
    scopeId: source.organization.rootId, targetId: 'outside-vendor', maxRequests: 1 }] }
  catalog.domains = [{ pin: WORLD_EXTERNAL_MEDIATED_PIN, available: true, directorEvents: true }]
  catalog.runtimeProfiles = catalog.runtimeProfiles.filter(value => value.version !== 'unavailable-model')
  for (const runtime of catalog.runtimeProfiles) runtime.model.provider = 'world-director-events-scripted'
  const compiled = await compileWorldScenarioV1(worldScenarioV1Schema.parse(source), scenarioV1CatalogSchema.parse(catalog), 'json', ctx.teams.getCreationLimits())
  if (!compiled.ok) throw new Error(JSON.stringify(compiled))
  const resolved = compiled.resolved, lifetime = new AbortController()
  const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create',
    spec: { runId: 'director-first-action', ...resolved.native } }))
  let connection: Awaited<ReturnType<typeof ctx.simulationTeams.attach>> | undefined
  const stages: unknown[] = []
  try {
    const prepared = await prepareSimulationWorld(ctx.simulationTeams, run, { resolved, ownerName: 'director-first-action/original',
      checkpoint: { id: simulationCheckpointIdSchema.parse('first-action-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
    const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']
    if (typeof ownerName !== 'string') throw new Error('Original Team lifecycle owner is absent')
    const anchor = { checkpointId: prepared.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
    connection = await ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, anchor.ownerName)
    const director = resolved.world.directorEntityId, runtime = resolved.actors.find(value => value.entityId === director)!.runtime
    await run.setPhase('running', run.snapshot().revision)
    const resident = async () => connection!.ensureResident(director, { activation: { provider: runtime.provider,
      seed: { kind: run.snapshot().entities[director]!.writer === undefined ? 'fresh' : 'resume' },
      agent: { preset: runtime.preset, options: { provider: runtime.model.provider, model: runtime.model.name } },
      signal: lifetime.signal }, evict: [] })
    await resident()
    const propose = async (key: string, selection: SimulationContextRequest['world'], wake: SimulationEventId,
      select: (body: { authority: Record<string, unknown> }) => unknown) => {
      const id = simulationDecisionIdSchema.parse(key)
      await connection!.openDecision(director, id, wake)
      const context = await connection!.prepareContext(director, id, { ...contextRequest(), world: selection })
      if (context.status !== 'prepared') throw new Error('Actual director context overflowed')
      const actor = ctx.agents.get(run.snapshot().entities[director]!.binding!.sessionId)!
      actor.session.append('simulation/context-view', context.view, { surfaceOp: 'append' })
      for (const input of [...actor.inbox.nextTurn, ...actor.inbox.nextStep]) {
        actor.inbox.remove(input.id); actor.session.append('user/message', input, { surfaceOp: 'append' })
      }
      actor.session.append('user/message', decisionInput(context.view), { surfaceOp: 'append' }); await ctx.sessions.flush(actor.session)
      // The test interprets the same recorded JSON supplied to the actual actor; no Native identity is manufactured.
      const body = z.object({ authority: z.object({ businessKey: z.string(), scopeEntityId: z.string(),
        targetEntityId: z.string() }) }).parse(context.view.content.flatMap(section => section.blocks).flatMap((block) => {
        if (block.type !== 'text') return []
        let value: unknown
        try { value = JSON.parse(block.text) }
        catch { return [] /* Ordinary section prose has no World authority object. */ }
        return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'world-context' ? [value] : []
      })[0])
      const action = select(body)
      stages.push({ key, tool: 'simulation_observe', response: await ctx.simulationTeams.modelRequest(actor, { kind: 'observe' }, lifetime.signal) })
      stages.push({ key, tool: 'simulation_stage', response: await ctx.simulationTeams.modelRequest(actor, { kind: 'stage',
        proposals: [simulationProposalSchema.parse({ after: [], action })] }, lifetime.signal) })
      try { await ctx.simulationTeams.modelRequest(actor, { kind: 'submit' }, lifetime.signal) }
      catch (error) {
        stages.push({ key, tool: 'simulation_submit', error: String(error), response: error })
        throw error
      }
      const accepted = run.snapshot().decisions[id]!
      await run.executeOperation(accepted.operationIds[0]!)
      stages.push({ key, state: run.snapshot() })
    }
    await run.drive({ until: simTimeSchema.parse('1') })
    const beforeProbe = run.snapshot(), beforeTeam = await ctx.teams.getTeam({ teamId: beforeProbe.teamReservation!.teamId })
    const trigger = Object.values(run.snapshot().wakes).find(value => value.entityId === director && value.status === 'pending')!
    await expect(propose('request-representative', { kind: 'director-event' }, trigger.eventId, body => ({ kind: 'world/request',
      domain: 'external', operation: 'interact', version: '3', businessKey: body.authority.businessKey, expectedTime: null, evidence: [],
      payload: { scope: body.authority.scopeEntityId, subjectRef: body.authority.targetEntityId, externalKey: 'vendor',
        sourceKind: 'director-mediated', policyRef: 'clocky.external.adjudication/1',
        input: { kind: 'adjudicate', question: 'Arrange the declared representative.', contactUnit: 'widget' },
        responseScope: { allowed: ['representative-preparation-plan'], disclosure: { kind: 'requester' } } } }))).rejects.toThrow(/Scenario-directed environment requests cannot prepare representatives/)
    const state = run.snapshot()
    expect(state.decisions[simulationDecisionIdSchema.parse('request-representative')]!.context).toMatchObject({
      status: 'prepared', world: { kind: 'director-event' } })
    expect(state.decisions[simulationDecisionIdSchema.parse('request-representative')]!.consumption).toBeDefined()
    expect(state.world!.requests).toEqual({}); expect(state.world!.plans).toEqual({})
    expect(state.world!.external.representatives).toEqual({}); expect(state.operations).toEqual({})
    const team = await ctx.teams.getTeam({ teamId: state.teamReservation!.teamId })
    expect(team.channelIds).toEqual(beforeTeam.channelIds)
    expect(Object.keys(state.entities)).toEqual(Object.keys(beforeProbe.entities))
    expect(Object.values(state.entities).map(value => value.binding))
      .toEqual(Object.values(beforeProbe.entities).map(value => value.binding))
    const channels = await Promise.all(team.channelIds.map(async channelId => ({ channelId,
      records: (await ctx.teams.readChannelPage({ channelId, afterCursor: -1, limit: 128 })).records })))
    expect(channels.flatMap(channel => channel.records).filter(value => value.type === 'channel/envelope')).toEqual([])
    const actor = ctx.agents.get(state.entities[director]!.binding!.sessionId)!
    await writeFile(resolve(root, 'admission-rejected.json'), JSON.stringify({ state, session: actor.session.events, resolved, stages, channels,
      representativeSessionCreated: false,
      conclusion: 'Scenario director representative preparation is rejected before case acceptance; first-action is unreachable.' }, null, 2) + '\n')
  } catch (error) {
    await writeFile(resolve(root, 'probe.json'), JSON.stringify({ error: String(error), stages, state: run.snapshot(), resolved }, null, 2) + '\n')
    throw error
  } finally {
    await connection?.close(); await run.close(); await ctx.fiber.dispose()
    if (previousRoot === undefined) delete process.env.SIMULATION_COMPANY_ROOT; else process.env.SIMULATION_COMPANY_ROOT = previousRoot
    if (previousBackend === undefined) delete process.env.SIMULATION_COMPANY_BACKEND
    else process.env.SIMULATION_COMPANY_BACKEND = previousBackend
  }
}, 60000)
