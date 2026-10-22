/** Real Native originals and held Product owner: fixed quotes, queued rechecks and lost acceptance never invent failure. */
import { afterEach, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import UserQuestions from '@clocky/clocky-user-questions'
import type { SimulationContextRequest, SimulationRun, SimulationWorldManagementAuthority } from '@clocky/clocky-simulation'
import { WORLD_HIRE_EXISTING_PIN, simulationWorldManagementActionSchema, simulationWorldManagementSubmitRequestSchema, simulationDecisionIdSchema, simulationProposalSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { worldManagementFingerprint } from '../src/world-management-authority.ts'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import Products, { SimulationProductError } from '../src/index.ts'
import Administration from '../src/administration.ts'
import { simulationProductWorldCreateInputSchema } from '../src/world-schema.ts'
import { simulationProductWorldCaseCancelInputSchema, simulationProductWorldCaseCancelPreviewSchema } from '../src/case-cancel-schema.ts'
import { worldCaseCancelPreview } from '../src/case-cancel-preview.ts'
import { companyFixture } from './company-driver-fixture.ts'
import { call } from './fixtures.ts'
import { sample, deployment } from '../../simulation-scenario/tests/v1-fixtures.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { decisionInput } from '../../simulation-team/src/input.ts'

afterEach(() => vi.restoreAllMocks())
async function fixture(backend: 'json' | 'sqlite', evidenceBytes = 4096) {
  const h = await companyFixture(backend, false)
  await h.ctx.plugin(UserQuestions)
  let native: SimulationRun | undefined
  const open = h.ctx.simulations.open.bind(h.ctx.simulations)
  vi.spyOn(h.ctx.simulations, 'open').mockImplementation(async (input) => { const run = await open(input); native = run; return run })
  await h.ctx.plugin(Products, { directoryStream: 'fixed-cancel-products' })
  const catalog = structuredClone(deployment)
  for (const limits of [catalog.limits.defaults.world, catalog.limits.ceilings.world]) {
    limits.maxBytesPerPlan = evidenceBytes; limits.maxBytesPerRequest = evidenceBytes
  }
  catalog.runtimeProfiles[0]!.model = { provider: 'company', name: 'scripted', version: '1', available: true }
  catalog.domains.push({ pin: WORLD_HIRE_EXISTING_PIN, available: true })
  const adminFiber = h.ctx.plugin(Administration, { journalStream: 'fixed-cancel-commands', templates: [],
    world: { provider: 'local', catalog, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } } })
  await adminFiber
  const definition = { ...sample, domains: [...sample.domains, { domain: 'organization', operation: 'hire-existing', version: '1' }],
    organization: { ...sample.organization, positions: [...sample.organization.positions,
      { id: 'cancel-vacancy', name: 'Actual vacancy', description: 'Actual cancellation target', unitId: sample.organization.rootId, capacity: 1, permissions: [] }],
    grants: [...sample.organization.grants, ...sample.entities.filter(person => person.kind === 'person' && person.cognition === 'agent' && person.role !== 'director').map(person => ({
      id: `cancel-eligible-${person.id}`, personId: person.id, domain: 'organization', operation: 'hire-existing', version: '1',
      scopeId: sample.organization.rootId, targetId: sample.organization.rootId, relation: 'eligible-for-hire', validFrom: '0', validUntil: null }))] },
    behavior: { initialGoals: [], calendars: [], directorEvents: [] },
    limits: { ...sample.limits, world: { ...sample.limits.world, maxBytesPerPlan: evidenceBytes, maxBytesPerRequest: evidenceBytes } } }
  const admin = h.ctx.simulationAdministration
  const preview = await admin.preflightWorld({ definition }, call())
  if (preview.status !== 'ready') throw new Error(JSON.stringify(preview))
  const created = await admin.createWorld(simulationProductWorldCreateInputSchema.parse({ commandId: 'fixed-cancel-create', name: 'Fixed cancel owner',
    definition, preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } }), call())
  await vi.waitFor(async () => { expect(await admin.request({ commandId: created.commandId }, call())).toMatchObject({ request: { status: 'completed' } }) })
  if (native === undefined) throw new Error('Actual original Native owner absent')
  const run = native, state = run.snapshot(), person = Object.values(state.entities).find(person => person.kind === 'person'
    && person.id !== state.world!.definition.directorEntityId && !Object.values(state.relations).some(relation => relation.relation === 'assignment' && relation.subject === person.id))!
  const position = Object.values(state.entities).find(value => value.kind === 'position' && value.profile['name'] === 'Actual vacancy')!
  const action = simulationWorldManagementActionSchema.parse({ kind: 'hire-existing', payload: { personId: person.id,
    organizationEntityId: state.world!.definition.organizationEntityId, positionEntityId: position.id, description: 'Original Native owner case' } })
  const digest = worldManagementFingerprint
  // Trusted Native owner fixture creates the real original; the public cancellation is independently authenticated below.
  const authority: SimulationWorldManagementAuthority = { resolve: () => ({ source: { kind: 'authenticated-user', principalId: call().principal.id,
    credentialGeneration: 1, policyRef: 'test-actual-native-owner/1', policyGeneration: '1' }, actionHash: digest(action),
  sourceFingerprint: digest('actual-owner-cut'), sourceComplete: true, funding: null }) }
  const quote = await run.previewWorldManagement({ action, expectedRevision: state.revision }, authority)
  expect(quote.admission).toBe('allowed')
  const original = await run.submitWorldManagement(simulationWorldManagementSubmitRequestSchema.parse({ action,
    expectedRevision: state.revision,
    commandId: 'native-case-before-public-cancel', previewHash: quote.previewHash }), authority)
  const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
  const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
  const selected = async (commandId = 'fixed-cancel') => {
    const result = await h.ctx.simulationProducts.inspectWorldCase({ runId: created.runId, requestId: original.requestId, section: 'request' }, call())
    const capability = result.value?.summary.cancel
    expect(capability?.allowed).toBe(true)
    if (capability?.preview === undefined) throw new Error('Actual same-prefix quote absent')
    return simulationProductWorldCaseCancelInputSchema.parse({ runId: created.runId, commandId, requestId: original.requestId,
      previewRevision: capability.preview.snapshotRevision, previewHash: capability.preview.previewHash })
  }
  return { ...h, run, admin, adminFiber, client, original, created, selected }
}

it.each(['json', 'sqlite'] as const)('publishes exact %s impact, rejects stale fresh quotes and retries completed originals without an owner', async (backend) => {
  const h = await fixture(backend)
  try {
    const input = await h.selected(), before = h.run.snapshot(), quote = worldCaseCancelPreview(before, input.requestId)!
    expect(quote).toEqual(simulationProductWorldCaseCancelPreviewSchema.parse(quote))
    expect(quote.impact).toEqual({ requestStatus: 'open', planIds: [h.original.planId], hiringReservationIds: [],
      personnelReservationIds: [], representativeReservationIds: [], unconfirmedExecutionPlanIds: [] })
    const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), model = vi.spyOn(h.ctx.llm, 'stream')
    await expect(h.admin.cancelWorldCase({ ...input, previewHash: `sha256:${'f'.repeat(64)}` }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_MANAGEMENT_PREVIEW_CHANGED' })
    for (const requestId of ['__proto__', 'constructor', 'toString'])
      await expect(h.admin.cancelWorldCase({ ...input, requestId: requestId as typeof input.requestId }, call()))
        .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_MANAGEMENT_PREVIEW_CHANGED' })
    expect(await h.admin.request({ commandId: input.commandId }, call())).toMatchObject({ status: 'not-found' })
    expect(h.run.snapshot()).toEqual(before)
    const response = await h.client.simulations.cancelWorldCase(input)
    expect(response.result).toMatchObject({ ok: true, value: { commandId: input.commandId, status: 'accepted' } })
    await vi.waitFor(async () => { expect(await h.admin.request({ commandId: input.commandId }, call())).toMatchObject({ request: { status: 'completed' }, worldCancellation: input }) })
    const after = h.run.snapshot()
    expect(after.world!.requests[input.requestId]?.status).toBe('cancelled')
    expect(Object.values(after.world!.cancellations)).toHaveLength(1)
    expect(await h.admin.cancelWorldCase(input, call())).toMatchObject({ status: 'completed' })
    expect(h.run.snapshot()).toEqual(after)
    expect(open).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled()
    await h.adminFiber.dispose()
    await h.ctx.plugin(Administration, { journalStream: 'fixed-cancel-commands', templates: [] })
    expect(await h.ctx.simulationAdministration.cancelWorldCase(input, call())).toMatchObject({ status: 'completed' })
    expect(open).not.toHaveBeenCalled()
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('rechecks %s Native queue revision and never appends a cancellation after a changed quote', async (backend) => {
  const h = await fixture(backend)
  try {
    const input = await h.selected(), original = h.run.cancelWorldCase.bind(h.run)
    vi.spyOn(h.run, 'cancelWorldCase').mockImplementationOnce(async (request, authorize) => {
      await h.run.recordWorldExecution({ planId: h.original.planId, phase: 'blocked', mode: 'execute', reason: 'implementation-unavailable', expectedSequence: null })
      return original(request, authorize)
    })
    await h.admin.cancelWorldCase(input, call())
    await vi.waitFor(async () => { expect(await h.admin.request({ commandId: input.commandId }, call()))
      .toMatchObject({ request: { status: 'failed', failure: 'cancel-world-case-failed' } }) })
    expect(h.run.snapshot().world!.cancellations).toEqual({})
    expect(h.run.snapshot().world!.requests[input.requestId]?.status).toBe('open')
    const next = await h.selected('refreshed-original')
    await h.admin.cancelWorldCase(next, call())
    await vi.waitFor(async () => { expect(await h.admin.request({ commandId: next.commandId }, call())).toMatchObject({ request: { status: 'completed' } }) })
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('retains accepted %s cancellation after a lost Native acknowledgement and reconciles its exact old quote', async (backend) => {
  const h = await fixture(backend)
  try {
    const input = await h.selected(), original = h.run.cancelWorldCase.bind(h.run), entered = Promise.withResolvers<undefined>()
    vi.spyOn(h.run, 'cancelWorldCase').mockImplementationOnce(async (request, authorize) => {
      await original(request, authorize); entered.resolve(undefined)
      throw new SimulationProductError('Response lost after actual Native acceptance', 'SIMULATION_PRODUCT_UNAVAILABLE')
    })
    await h.admin.cancelWorldCase(input, call()); await entered.promise
    await vi.waitFor(async () => {
      await h.admin.cancelWorldCase(input, call())
      expect(await h.admin.request({ commandId: input.commandId }, call())).toMatchObject({ request: { status: 'completed' }, worldCancellation: input })
    })
    expect(Object.values(h.run.snapshot().world!.cancellations)).toHaveLength(1)
    expect(h.run.snapshot().world!.requests[input.requestId]?.status).toBe('cancelled')
    expect(worldCaseCancelPreview(h.run.snapshot(), input.requestId)?.previewHash).not.toBe(input.previewHash)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('keeps %s an older reader prefix stale and includes only actual unconfirmed case plans in a fresh quote', async (backend) => {
  const h = await fixture(backend)
  try {
    const before = h.run.snapshot(), observed = await h.ctx.simulations.inspect({ provider: 'local', spec: before.spec })
    if (observed === undefined) throw new Error('Actual owner prefix absent')
    const armed = await h.run.recordWorldExecution({ planId: h.original.planId, phase: 'armed', mode: 'execute', reason: null, expectedSequence: null })
    await h.run.recordWorldExecution({ planId: h.original.planId, phase: 'outcome-unknown', mode: 'execute', reason: 'callback-unconfirmed', expectedSequence: armed.sequence })
    vi.spyOn(h.ctx.simulations, 'inspect').mockResolvedValueOnce(observed)
    const older = await h.ctx.simulationProducts.inspectWorldCase({ runId: h.created.runId, requestId: h.original.requestId, section: 'request' }, call())
    expect(older.snapshotRevision).toBe(before.revision)
    expect(older.value?.summary.cancel).toEqual({ allowed: false, reason: 'stale' })
    const fresh = await h.ctx.simulationProducts.listWorldCases({ runId: h.created.runId }, call())
    expect(fresh.items[0]?.cancel.preview).toEqual(worldCaseCancelPreview(h.run.snapshot(), h.original.requestId))
    expect(fresh.items[0]?.cancel.preview?.impact.unconfirmedExecutionPlanIds).toEqual([h.original.planId])
    expect(JSON.stringify(fresh.items[0]?.cancel)).not.toContain('Original Native owner case')
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('rechecks actual %s authentication in Native queue before its first cancellation append', async (backend) => {
  const h = await fixture(backend)
  try {
    const input = await h.selected(), original = h.run.cancelWorldCase.bind(h.run), control = new AbortController()
    vi.spyOn(h.run, 'cancelWorldCase').mockImplementationOnce(async (request, authorize) => {
      control.abort(new Error('Actual transport credential retired before its queued acceptance'))
      return original(request, authorize)
    })
    // Admission can return before the queued callback; either response must preserve the recorded original's honest outcome.
    await h.admin.cancelWorldCase(input, call(control)).catch((cause: unknown) => {
      if (!(cause instanceof SimulationProductError)) throw cause
    })
    await vi.waitFor(async () => { expect(await h.admin.request({ commandId: input.commandId }, call()))
      .toMatchObject({ request: { status: 'failed', failure: 'cancel-world-case-failed' } }) })
    expect(h.run.snapshot().world!.cancellations).toEqual({})
    expect(h.run.snapshot().world!.requests[input.requestId]?.status).toBe('open')
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('quotes and cancels a real %s awaiting-evidence case without calling a model', async (backend) => {
  // Six mandatory original plan/notification/scheduler records exceed the compact catalog's 4096-byte ceiling.
  const evidenceBytes = 8192
  const h = await fixture(backend, evidenceBytes)
  const lifetime = new AbortController()
  try {
    const state = h.run.snapshot(), team = state.teamReservation!
    const ownerName = team.creation.rules['activationLifecycleOwner']
    if (typeof ownerName !== 'string') throw new Error('Actual Team lifecycle owner absent')
    const connection = await h.ctx.simulationTeams.attach(h.run, team.teamId, ownerName)
    try {
      await h.run.setPhase('running', h.run.snapshot().revision)
      const grant = Object.values(h.run.snapshot().relations).find(value => value.relation === 'can-hire')!
      const director = h.run.snapshot().world!.definition.directorEntityId
      for (const person of [grant.subject, director]) await connection.ensureResident(person, { activation: { provider: 'in-process',
        seed: { kind: 'fresh' }, agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } },
        signal: lifetime.signal }, evict: [] })
      const propose = async (person: typeof director, id: string, action: unknown, world: SimulationContextRequest['world'],
        wakeId?: import('@clocky/clocky-simulation').SimulationEventId) => {
        const decisionId = simulationDecisionIdSchema.parse(id)
        await connection.openDecision(person, decisionId, wakeId)
        const context = await connection.prepareContext(person, decisionId, { ...contextRequest(4096), world })
        if (context.status !== 'prepared') throw new Error('Actual case context absent')
        const agent = h.ctx.agents.get(h.run.snapshot().entities[person]!.binding!.sessionId)
        if (agent === undefined) throw new Error('Actual role Agent absent')
        agent.session.append('simulation/context-view', context.view, { surfaceOp: 'append' })
        for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
          if (message.id === decisionInput(context.view).id) continue
          agent.inbox.remove(message.id); agent.session.append('user/message', message, { surfaceOp: 'append' })
        }
        agent.session.append('user/message', decisionInput(context.view), { surfaceOp: 'append' })
        if (!await h.ctx.sessions.flush(agent.session)) throw new Error('Actual role input not durable')
        await h.ctx.simulationTeams.modelRequest(agent, { kind: 'observe' }, lifetime.signal)
        await h.ctx.simulationTeams.modelRequest(agent, { kind: 'stage',
          proposals: [simulationProposalSchema.parse({ after: [], action })] }, lifetime.signal)
        await h.ctx.simulationTeams.modelRequest(agent, { kind: 'submit' }, lifetime.signal)
        const decision = h.run.snapshot().decisions[decisionId]!
        expect(decision.status).toBe('accepted')
        await h.run.executeOperation(decision.operationIds[0]!)
      }
      await propose(grant.subject, 'r', { kind: 'world/request', domain: 'organization',
        operation: 'generate-and-hire', version: '1', businessKey: 'w', expectedTime: null, evidence: [],
        payload: { organizationEntityId: state.world!.definition.organizationEntityId, positionEntityId: grant.object,
          description: 'R' } }, { kind: 'goal' })
      const request = Object.values(h.run.snapshot().world!.requests).find(value => value.proposal.businessKey === 'w')!
      if (request.notificationOperationId === null) throw new Error('Actual role notification absent')
      await h.run.drive({ until: simTimeSchema.parse(h.run.snapshot().time) })
      await connection.dispatchOperation(request.notificationOperationId, Date.now)
      const wake = await connection.receiveOperation(request.notificationOperationId)
      await h.run.drive({ until: simTimeSchema.parse(h.run.snapshot().time) })
      const byteLength = Buffer.byteLength.bind(Buffer), batches: { bytes: number; count: number; recordBytes: number[] }[] = []
      const measure = vi.spyOn(Buffer, 'byteLength').mockImplementation((value, encoding) => {
        const bytes = byteLength(value, encoding)
        if (typeof value === 'string' && value.startsWith('[{"kind":"run/') && value.includes('"kind":"evidence/opened"')) {
          const records = JSON.parse(value) as unknown[]
          batches.push({ bytes, count: records.length, recordBytes: records.map(item => byteLength(JSON.stringify(item))) })
        }
        return bytes
      })
      try {
        await propose(director, 'p', { kind: 'world/resolve', requestId: request.id, supersedes: null,
          resolution: { kind: 'awaiting-evidence', missingFields: ['requirements'], deadline: '10', maxAttempts: 2,
            rationale: 'Q' } }, { kind: 'resolve', requestId: request.id }, wake)
      } finally {
        measure.mockRestore()
        await writeFile(`.local/world-completion/u07-cancel/evidence-budget-${backend}-${evidenceBytes}.json`,
          JSON.stringify({ originalAllowance: 4096, explicitFixtureAllowance: evidenceBytes, contextBytes: 4096, batches }, null, 2) + '\n')
      }
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const detail = await h.ctx.simulationProducts.inspectWorldCase({ runId: h.created.runId, requestId: request.id, section: 'request' }, call())
      expect(detail.value?.summary).toMatchObject({ status: 'awaiting-evidence', cancel: { allowed: true, reason: 'ready',
        preview: { snapshotRevision: h.run.snapshot().revision, impact: { requestStatus: 'awaiting-evidence' } } } })
      const quote = detail.value!.summary.cancel.preview!
      const cancel = simulationProductWorldCaseCancelInputSchema.parse({ runId: h.created.runId, requestId: request.id,
        commandId: 'cancel-actual-waiting-case', previewRevision: quote.snapshotRevision, previewHash: quote.previewHash })
      await h.admin.cancelWorldCase(cancel, call())
      await vi.waitFor(async () => { expect(await h.admin.request({ commandId: cancel.commandId }, call()))
        .toMatchObject({ request: { status: 'completed' } }) })
      expect(h.run.snapshot().world!.requests[request.id]?.status).toBe('cancelled')
      expect(h.requests).toHaveLength(0)
    } finally { lifetime.abort(); await connection.close() }
  } finally { await h.close() }
})
