import { simulationProductIngressInputSchema } from '../src/maintenance-schema.ts'
import { simulationGenerationJobIdSchema } from '@clocky/clocky-simulation'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { WORLD_HIRING_MARKET_PIN, hiringMarket } from '@clocky/clocky-simulation'
import { simulationProductGenerationRequestSchema } from '../src/generation-schema.ts'
/** Actual product personnel commands retain authenticated sources and original Native/Team identities without inference. */
import { expect, it, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { writeFile } from 'node:fs/promises'
import UserQuestions from '@clocky/clocky-user-questions'
import { SimulationWorldExecutions } from '@clocky/clocky-simulation-world'
import ProductPrincipals from '@clocky/clocky-product-principal'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import type { RpcResponse } from '@clocky/clocky-host-apiproxy/api/rpc'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { WORLD_TRANSFER_PIN, WORLD_DEPART_PIN, WORLD_HIRE_EXISTING_PIN, simTimeSchema, simulationEntityIdSchema, simulationResourceIdSchema } from '@clocky/clocky-simulation'
import { worldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import Products from '../src/index.ts'
import Administration from '../src/administration.ts'
import { simulationProductWorldCreateInputSchema } from '../src/world-schema.ts'
import { simulationProductWorldManagementDraftSchema, simulationProductWorldManagementSubmitInputSchema } from '../src/world-management-schema.ts'
import { simulationProductWorldCaseInputSchema } from '../src/case-schema.ts'
import { simulationProductWorldCaseCancelInputSchema } from '../src/case-cancel-schema.ts'
import { worldCaseCancelPreview } from '../src/case-cancel-preview.ts'
import { simulationProductManageInputSchema } from '../src/control-schema.ts'
import { managementCommandBoundaries, managementSubmit, managementReasonBoundaries } from './world-management-fixture.ts'
import { simulationProductCommandIdSchema } from '../src/schema-common.ts'
import { companyFixture } from './company-driver-fixture.ts'
import { worldManagementFingerprint } from '../src/world-management-authority.ts'
import { call } from './fixtures.ts'
import { sample, deployment } from '../../simulation-scenario/tests/v1-fixtures.ts'

afterEach(() => vi.restoreAllMocks())
async function fixture(backend: 'json' | 'sqlite', fees?: 'undelegated' | 'delegated',
  options: {
    readonly generationMarket?: boolean
    readonly calendar?: boolean
    readonly resourceDuty?: boolean
    readonly maxCommands?: number
    readonly maxPendingPreparations?: number
    readonly managementBytes?: number
  } = {}) {
  const h = await companyFixture(backend, false)
  await h.ctx.plugin(UserQuestions)
  await h.ctx.plugin(Products, { directoryStream: 'human-management-products' })
  const installed = structuredClone(deployment)
  installed.runtimeProfiles[0]!.model = { provider: 'company', name: 'scripted', version: '1', available: true }
  if (options.managementBytes !== undefined) {
    installed.limits.ceilings.world.maxBytesPerRequest = options.managementBytes
    installed.limits.ceilings.world.maxBytesPerPlan = options.managementBytes
  }
  const pins = [WORLD_TRANSFER_PIN, WORLD_DEPART_PIN, WORLD_HIRE_EXISTING_PIN, ...options.generationMarket ? [WORLD_HIRING_MARKET_PIN] : []]
  installed.domains.push(...pins.map(pin => ({ pin, available: true })))
  const definition = worldScenarioV1Schema.parse({ ...sample,
    ...options.managementBytes === undefined ? {} : { limits: { ...sample.limits, world: { ...sample.limits.world,
      maxBytesPerRequest: options.managementBytes, maxBytesPerPlan: options.managementBytes } } }, domains: [...sample.domains,
      ...pins.map(({ domain, operation, version }) => ({ domain, operation, version }))],
    resources: fees === undefined ? options.resourceDuty ? [{ id: 'independent-cash', owner: sample.organization.rootId,
      kind: 'money', unit: 'credit', quantity: '10', controllers: ['requester'] }] : [] : [{ id: 'management-cash', owner: sample.organization.rootId, kind: 'money',
      unit: 'credit', quantity: '10', controllers: ['requester'] }, { id: 'management-payee', owner: sample.organization.rootId,
      kind: 'money', unit: 'credit', quantity: '0', controllers: [] }],
    organization: { ...sample.organization, ...fees === undefined ? {} : { hiringFees: [{ id: 'management-fee', version: '1',
      policyRef: 'clocky.organization.hiring-fee/1', operation: 'hire-existing', positionEntityId: 'management-role',
      from: 'management-cash', to: 'management-payee', unit: 'credit', quantity: '3', grants: [], reservationPeriod: '10' }] }, grants: [...sample.organization.grants,
      ...sample.entities.filter(value => value.kind === 'person' && value.cognition === 'agent' && value.role !== 'director').map(value => ({
        id: `eligibility-${value.id}`, personId: value.id, domain: 'organization', operation: 'hire-existing', version: '1',
        scopeId: sample.organization.rootId, targetId: sample.organization.rootId, relation: 'eligible-for-hire',
        validFrom: '0', validUntil: null }))], positions: [...sample.organization.positions,
      { id: 'management-role', name: 'Management role', description: 'Actual destination', unitId: sample.organization.rootId,
        capacity: 2, permissions: [] }] }, behavior: { initialGoals: [], calendars: options.calendar ? [{ id: 'daily', target: { kind: 'position', positionId: sample.organization.positions[0]!.id }, body: 'Original scheduled work', startsAt: '1', endsAt: '5', period: '2', maxOccurrences: 3 }] : [], directorEvents: [] } })
  let owned: SimulationRun | undefined
  const open = h.ctx.simulations.open.bind(h.ctx.simulations)
  vi.spyOn(h.ctx.simulations, 'open').mockImplementation(async (input) => { const value = await open(input); owned = value; return value })
  const administrationConfig = { journalStream: 'human-management-commands', templates: [],
    ...options.maxCommands === undefined ? {} : { maxCommands: options.maxCommands },
    ...options.maxPendingPreparations === undefined ? {} : { maxPendingPreparations: options.maxPendingPreparations },
    world: { provider: 'local', catalog: installed, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 },
      ...fees !== 'delegated' ? {} : { managementFundingDelegations: [{ principalId: call().principal.id,
        controllerEntityId: simulationEntityIdSchema.parse('requester') }] } } }
  const administrationFiber = h.ctx.plugin(Administration, administrationConfig)
  await administrationFiber
  const administration = h.ctx.simulationAdministration
  const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
  vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementation(async (...args) => {
    const connection = await attach(...args), commit = connection.commitPersonnel.bind(connection)
    vi.spyOn(connection, 'commitPersonnel').mockImplementation(async (...input) => {
      try { return await commit(...input) }
      catch (cause: unknown) {
        await writeFile(`.local/world-completion/u07-product/personnel-error-${backend}.txt`,
          String(cause instanceof Error ? cause.stack : cause) + '\n')
        throw cause
      }
    })
    return connection
  })
  const preview = await administration.preflightWorld({ definition }, call())
  if (preview.status !== 'ready') throw new Error(JSON.stringify(preview))
  const creation = simulationProductWorldCreateInputSchema.parse({ commandId: 'create-human-managed', name: 'Human managed World', definition,
    preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } })
  const created = await administration.createWorld(creation, call())
  await vi.waitFor(async () =>{  expect(await administration.request({ commandId: creation.commandId }, call()))
    .toMatchObject({ status: 'found', request: { status: 'completed' } }) }, { timeout: 4000 })
  const run = () => { if (owned === undefined) throw new Error('Original Native owner absent'); return owned }
  const finish = async (commandId: ReturnType<typeof simulationProductWorldManagementSubmitInputSchema.parse>['commandId']) =>
    await vi.waitFor(async () => {
      const result = await administration.request({ commandId }, call())
      expect(result).toMatchObject({ status: 'found', request: { status: 'completed' },
        worldManagementOutcome: { execution: { phase: 'settled' }, result: { status: 'committed' } } })
      return result
    }, { timeout: 4000 })
  const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
  const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
  const coldAdministration = async () => {
    await administrationFiber.dispose()
    await h.ctx.plugin(Administration, administrationConfig)
    return { administration: h.ctx.simulationAdministration, client }
  }
  return { ...h, administration, client, created, run, finish, coldAdministration }
}

async function response<T>(value: Promise<RpcResponse<T>>): Promise<T> {
  const observed = await value
  if (!observed.result.ok) throw new Error(JSON.stringify(observed.result.error))
  return observed.result.value
}

it.each(['json', 'sqlite'] as const)('reports retired %s execution providers before admitting start', async (backend) => {
  const h = await fixture(backend)
  try {
    const input = { runId: h.created.runId }, original = h.run().snapshot()
    expect((await h.administration.control(input, call())).actions.start).toMatchObject({ allowed: true, reason: 'ready' })
    await h.worldExecutionsFiber.dispose()
    const attach = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear(), models = vi.spyOn(h.ctx.llm, 'stream').mockClear()
    expect((await h.administration.control(input, call())).actions.start)
      .toEqual({ allowed: false, reason: 'execution-unavailable' })
    await expect(h.administration.manage(simulationProductManageInputSchema.parse({ ...input,
      managementId: 'missing-execution-start', phase: 'running' }), call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
    expect(h.run().snapshot()).toEqual(original)
    expect(attach).not.toHaveBeenCalled(); expect(models).not.toHaveBeenCalled()
    await h.ctx.plugin(SimulationWorldExecutions)
    expect((await h.administration.control(input, call())).actions.start).toEqual({ allowed: true, reason: 'ready' })
    expect(h.run().snapshot()).toEqual(original)
  } finally { await h.close() }
})

it.each([['json', 'transfer'], ['sqlite', 'transfer'], ['json', 'depart'], ['sqlite', 'depart'],
  ['json', 'hire-existing'], ['sqlite', 'hire-existing']] as const)(
  'previews and executes actual user %s %s through the original product owner', async (backend, family) => {
    const h = await fixture(backend)
    try {
      const initial = h.run().snapshot(), assigned = Object.values(initial.relations).find(value => value.relation === 'assignment')!
      const person = family === 'hire-existing' ? Object.values(initial.entities).find(value => value.kind === 'person'
      && value.profile['role'] !== 'director' && value.id !== initial.world!.definition.directorEntityId
      && !Object.values(initial.relations).some(relation => relation.relation === 'assignment' && relation.subject === value.id))!
          : initial.entities[assigned.subject]!, personId = person.id
      const target = Object.values(initial.entities).find(value => value.kind === 'position' && value.profile['name'] === 'Management role')!
      const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), model = vi.spyOn(h.ctx.llm, 'stream')
      const actions = family === 'depart' ? ['depart', 'hire-existing'] as const : [family]
      for (const [index, action] of actions.entries()) {
        await h.run().setPhase('running', h.run().snapshot().revision)
        expect((await h.run().drive({ until: simTimeSchema.parse(String(index + 2)) })).reason).toBe('until')
        await h.run().setPhase('paused', h.run().snapshot().revision)
        const state = h.run().snapshot(), current = Object.values(state.relations).find(value => value.relation === 'assignment'
        && value.subject === personId && (value.validUntil === null || BigInt(value.validUntil) > BigInt(state.time)))
        const fields = await response(h.client.simulations.worldManagementFields({ runId: h.created.runId, targetId: personId, action }))
        expect(fields.status).toBe('available')
        const draft = simulationProductWorldManagementDraftSchema.parse({ runId: h.created.runId, targetId: personId,
          expectedRevision: fields.targetRevision, action, values: action === 'hire-existing' ? { position: target.id, reason: 'Rehire original person' }
            : { assignmentId: current!.id, effective: 'boundary', reason: 'Original authenticated user request',
              ...action === 'transfer' ? { position: target.id } : { retire: 'no' } } })
        const preview = await response(h.client.simulations.previewWorldManagement(draft))
        expect(preview).toMatchObject({ admission: 'allowed', blockers: [], impact: { kind: action, personId } })
        expect(h.run().snapshot()).toEqual(state)
        const input = simulationProductWorldManagementSubmitInputSchema.parse({ runId: h.created.runId,
          commandId: `actual-human-${index}`, draft, previewRevision: preview.snapshotRevision, previewHash: preview.previewHash })
        const [first, duplicate] = await Promise.all([response(h.client.simulations.submitWorldManagement(input)),
          response(h.client.simulations.submitWorldManagement(input))])
        expect(first.commandId).toBe(duplicate.commandId)
        const completed = await h.finish(input.commandId)
        const after = h.run().snapshot(), requests = Object.values(after.world!.requests)
        expect(requests).toHaveLength(index + 1)
        expect(requests.at(-1)).toMatchObject({ operationId: null, requesterEntityId: null, notificationOperationId: null,
          source: { kind: 'authenticated-user', principalId: call().principal.id, commandId: input.commandId } })
        expect(after.decisions).toEqual(initial.decisions); expect(after.operations).toEqual(initial.operations)
        expect(after.entities[personId]?.binding).toEqual(person.binding)
        expect(after.entities[personId]?.profile).toEqual(person.profile)
        expect(after.phase).toBe('paused')
        expect(await h.administration.submitWorldManagement(input, call())).toEqual(completed.status === 'found' ? completed.request : undefined)
        expect(h.run().snapshot()).toEqual(after)
        const inspected = await h.ctx.simulationProducts.inspectWorldCase(simulationProductWorldCaseInputSchema.parse({
          runId: h.created.runId, requestId: requests.at(-1)!.id, section: 'request' }), call())
        expect(inspected).toMatchObject({ value: { summary: { apiVersion: 'clocky.world-case/v4', requesterEntityId: null,
          origin: { kind: 'authenticated-user', commandId: input.commandId } } } })
        await expect(h.administration.submitWorldManagement({ ...input, previewHash: `sha256:${'f'.repeat(64)}` }, call()))
          .rejects.toThrow(/another original payload/)
      }
      expect(open).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled(); expect(h.requests).toEqual([])
      expect(await h.ctx.sessionPersistence.list()).toEqual([])
    } catch (cause: unknown) {
      await writeFile(`.local/world-completion/u07-product/failed-${backend}.json`, JSON.stringify({ error: String(cause),
        state: h.run().snapshot() }, null, 2) + '\n')
      throw cause
    } finally { await h.close() }
  }, 10000)

async function original(h: Awaited<ReturnType<typeof fixture>>, action: 'transfer' | 'hire-existing' = 'transfer') {
  await h.run().setPhase('running', h.run().snapshot().revision)
  expect((await h.run().drive({ until: simTimeSchema.parse('2') })).reason).toBe('until')
  await h.run().setPhase('paused', h.run().snapshot().revision)
  const state = h.run().snapshot(), assignment = Object.values(state.relations).find(value => value.relation === 'assignment')!
  const personId = action === 'transfer' ? assignment.subject : Object.values(state.entities).find(value => value.kind === 'person'
    && value.id !== state.world!.definition.directorEntityId
    && !Object.values(state.relations).some(relation => relation.subject === value.id && relation.relation === 'assignment'))!.id
  const draft = simulationProductWorldManagementDraftSchema.parse({ runId: h.created.runId, action, targetId: personId,
    expectedRevision: state.entities[personId]!.revision, values: action === 'transfer' ? { assignmentId: assignment.id,
      effective: 'boundary', position: 'management-role', reason: 'Exact original transfer' }
      : { position: 'management-role', reason: 'Exact original existing hire' } })
  const preview = await response(h.client.simulations.previewWorldManagement(draft))
  const input = simulationProductWorldManagementSubmitInputSchema.parse({ runId: h.created.runId, commandId: 'original-management', draft,
    previewRevision: preview.snapshotRevision, previewHash: preview.previewHash })
  return { input, preview, state }
}

it.each(['json', 'sqlite'] as const)('retains %s Native acceptance after a lost callback and precisely resumes only its original plan', async (backend) => {
  const h = await fixture(backend)
  try {
    const { input } = await original(h), native = h.run(), submit = native.submitWorldManagement.bind(native)
    const accepted = Promise.withResolvers<undefined>()
    vi.spyOn(native, 'submitWorldManagement').mockImplementationOnce(async (...args) => {
      await submit(...args); accepted.resolve(undefined); throw new Error('Lost Native acceptance response')
    })
    await h.administration.submitWorldManagement(input, call()); await accepted.promise
    await vi.waitFor(async () =>{  expect((await h.administration.control({ runId: input.runId }, call())).inFlight).toBe(false) })
    const retained = Object.values(native.snapshot().world!.requests)[0]!
    expect(await h.administration.request({ commandId: input.commandId }, call())).toMatchObject({ status: 'found',
      request: { status: 'accepted' }, worldManagementOutcome: { requestId: retained.id } })
    expect(Object.values(native.snapshot().world!.plans)).toHaveLength(1)
    await h.administration.submitWorldManagement(input, call())
    await h.finish(input.commandId)
    expect(Object.values(native.snapshot().world!.requests)).toEqual([expect.objectContaining({ id: retained.id })])
    expect(Object.values(native.snapshot().world!.plans)).toHaveLength(1)
    expect(Object.values(native.snapshot().world!.results)).toHaveLength(1)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
}, 10000)

it.each(['json', 'sqlite'] as const)('rechecks actual %s credentials after Product acceptance and before Native queue admission', async (backend) => {
  const h = await fixture(backend), gate = Promise.withResolvers<undefined>(), entered = Promise.withResolvers<undefined>()
  try {
    const { input } = await original(h), before = h.run().snapshot(), submit = h.run().submitWorldManagement.bind(h.run())
    vi.spyOn(h.run(), 'submitWorldManagement').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined); await gate.promise; return await submit(...args)
    })
    const credential = new AbortController()
    const submitting = h.administration.submitWorldManagement(input, call(credential))
    const observed = submitting.catch((cause: unknown) => cause)
    await entered.promise
    credential.abort(); gate.resolve(undefined)
    await observed
    await vi.waitFor(async () =>{  expect(await h.administration.request({ commandId: input.commandId }, call()))
      .toMatchObject({ status: 'found', request: { status: 'failed', failure: 'world-management-failed' } }) })
    expect(h.run().snapshot()).toEqual(before)
    expect(h.requests).toEqual([])
  } finally { gate.resolve(undefined); await h.close() }
}, 10000)

it.each([['json', 'undelegated'], ['sqlite', 'undelegated'], ['json', 'delegated'], ['sqlite', 'delegated']] as const)(
  'requires explicit authenticated-controller delegation and pays one actual %s %s hiring fee', async (backend, funding) => {
    const h = await fixture(backend, funding)
    try {
      const { input, preview, state } = await original(h, 'hire-existing')
      expect(preview.hiringFee).toMatchObject({ quantity: '3', unit: 'credit' })
      if (funding === 'undelegated') {
        expect(preview).toMatchObject({ admission: 'blocked', blockers: ['authority-missing'] })
        await expect(h.administration.submitWorldManagement(input, call())).rejects.toMatchObject({
          code: 'SIMULATION_PRODUCT_MANAGEMENT_PREVIEW_CHANGED' })
        expect(await h.administration.request({ commandId: input.commandId }, call())).toMatchObject({ status: 'not-found' })
        expect(h.run().snapshot()).toEqual(state)
      } else {
        expect(preview.admission).toBe('allowed')
        await response(h.client.simulations.submitWorldManagement(input)); await h.finish(input.commandId)
        const after = h.run().snapshot()
        expect(after.resources[simulationResourceIdSchema.parse('management-cash')]?.quantity).toBe('7')
        expect(after.resources[simulationResourceIdSchema.parse('management-payee')]?.quantity).toBe('3')
        expect(Object.values(after.resourceReservations ?? {})).toEqual([expect.objectContaining({ createdOperationId: null,
          phase: 'committed', management: { kind: 'authenticated-user', principalId: call().principal.id,
            commandId: input.commandId, credentialGeneration: 1, policyRef: 'clocky.world-owner-management/1',
            policyGeneration: worldManagementFingerprint({ policyRef: 'clocky.world-owner-management/1', owner: call().principal.id,
              fundingDelegations: [{ principalId: call().principal.id, controllerEntityId: 'requester' }] }), time: '2' } })])
        expect(Object.values(after.resourceReservations)[0]?.management?.policyGeneration).toMatch(/^sha256:[a-f0-9]{64}$/)
        await h.administration.submitWorldManagement(input, call()); expect(h.run().snapshot()).toEqual(after)
        expect(after.operations).toEqual(state.operations); expect(after.decisions).toEqual(state.decisions)
      }
      expect(h.requests).toEqual([])
    } finally { await h.close() }
  }, 10000)

async function actualPrincipalLease(h: Awaited<ReturnType<typeof fixture>>) {
  await h.ctx.plugin(ProductPrincipals)
  h.ctx.productPrincipals.registerProvider({ name: 'management-lease-owner', async authenticate(request) {
    if (request.credential !== 'actual-owner-credential') throw new Error('Credential refused')
    const controller = new AbortController()
    return { principal: { ...call().principal, issuer: 'management-lease-owner', assurance: 'actual-provider' },
      signal: controller.signal, revoke: () => { controller.abort() } }
  } })
  return await h.ctx.productPrincipals.authenticate({ provider: 'management-lease-owner', credential: 'actual-owner-credential' })
}

it.each(['json', 'sqlite'] as const)('holds a real %s principal call through queued Native admission and rejects revocation with zero Native append', async (backend) => {
  const h = await fixture(backend), gate = Promise.withResolvers<undefined>(), entered = Promise.withResolvers<undefined>()
  try {
    const { input } = await original(h), before = h.run().snapshot(), submit = h.run().submitWorldManagement.bind(h.run())
    const lease = await actualPrincipalLease(h)
    vi.spyOn(h.run(), 'submitWorldManagement').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined); await gate.promise; return await submit(...args)
    })
    let returned = false
    const pending = lease.withCall(async principal => await h.administration.submitWorldManagement(input, principal))
      .finally(() => { returned = true })
    const response = pending.catch((cause: unknown) => cause)
    await entered.promise
    await new Promise<undefined>((resolve) => { setImmediate(() => { resolve(undefined) }) })
    expect(returned).toBe(false)
    const revoked = lease.revoke()
    gate.resolve(undefined)
    expect(await response).toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await revoked
    await vi.waitFor(async () => { expect(await h.administration.request({ commandId: input.commandId }, call()))
      .toMatchObject({ request: { status: 'failed', failure: 'world-management-failed' } }) })
    expect(h.run().snapshot()).toEqual(before)
    expect(h.requests).toEqual([])
  } finally { gate.resolve(undefined); await h.close() }
}, 10000)

it.each(['json', 'sqlite'] as const)('returns after real %s Native admission while the original provider continues beyond the principal call', async (backend) => {
  const h = await fixture(backend), gate = Promise.withResolvers<undefined>(), entered = Promise.withResolvers<undefined>()
  try {
    const { input } = await original(h), lease = await actualPrincipalLease(h)
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementationOnce(async (...args) => {
      const connection = await attach(...args), commit = connection.commitPersonnel.bind(connection)
      vi.spyOn(connection, 'commitPersonnel').mockImplementationOnce(async (...args) => {
        entered.resolve(undefined); await gate.promise; return await commit(...args)
      })
      return connection
    })
    const receipt = await lease.withCall(async principal => await h.administration.submitWorldManagement(input, principal))
    expect(receipt).toMatchObject({ status: 'accepted', commandId: input.commandId })
    const requests = Object.values(h.run().snapshot().world!.requests)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ operationId: null, source: { kind: 'authenticated-user', commandId: input.commandId } })
    await entered.promise
    expect(Object.values(h.run().snapshot().world!.results)).toHaveLength(0)
    expect(await h.administration.request({ commandId: input.commandId }, call())).toMatchObject({ request: { status: 'accepted' } })
    await lease.revoke()
    gate.resolve(undefined)
    await h.finish(input.commandId)
    expect(Object.values(h.run().snapshot().world!.results)).toHaveLength(1)
    expect(h.requests).toEqual([])
  } finally { gate.resolve(undefined); await h.close() }
}, 10000)

it.each(['json', 'sqlite'] as const)('previews actual %s handoff responsibility without treating the selected assignment as an independent duty', async (backend) => {
  const h = await fixture(backend, 'undelegated')
  try {
    const { preview, input, state } = await original(h)
    expect(preview.admission).toBe('allowed')
    expect(preview.settlementRequirements).toEqual(['handoff-required'])
    expect(preview.obligations.some(value => value.original?.ref.kind === 'relation'
      && input.draft.action === 'transfer' && value.original.ref.id === input.draft.values.assignmentId)).toBe(false)
    expect(preview.obligations.some(value => value.original?.ref.kind === 'resource'
      && value.original.ref.id === 'management-cash')).toBe(true)
    expect(h.run().snapshot()).toEqual(state)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
}, 10000)

async function cancellationFor(h: Awaited<ReturnType<typeof fixture>>, requestId: import('@clocky/clocky-simulation').WorldRequestId,
  commandId: string) {
  const detail = await h.ctx.simulationProducts.inspectWorldCase({ runId: h.created.runId, requestId, section: 'request' }, call())
  expect(detail.value?.summary.cancel.allowed).toBe(true)
  const preview = detail.value?.summary.cancel.preview
  if (preview === undefined) throw new Error('Actual fixed cancellation quote absent')
  return simulationProductWorldCaseCancelInputSchema.parse({ runId: h.created.runId, requestId, commandId,
    previewRevision: preview.snapshotRevision, previewHash: preview.previewHash })
}

it.each(['json', 'sqlite'] as const)('cancels the exact %s user case blocked on an independent duty and settles its original management ID', async (backend) => {
  const h = await fixture(backend, undefined, { resourceDuty: true })
  try {
    const { input, state } = await original(h), open = vi.spyOn(h.ctx.simulations, 'open').mockClear()
    await h.administration.submitWorldManagement(input, call())
    await vi.waitFor(async () => { expect(await h.administration.request({ commandId: input.commandId }, call())).toMatchObject({
      request: { status: 'accepted' }, worldManagementOutcome: { execution: { phase: 'blocked', reason: 'handoff-required' } } }) })
    const request = Object.values(h.run().snapshot().world!.requests)[0]!
    const control = await h.administration.control({ runId: input.runId }, call())
    expect(control.actions.pause).toEqual({ allowed: true, reason: 'ready' })
    expect(control.administration.actions.checkpoint).toEqual({ allowed: false, reason: 'management-in-progress' })
    expect(control.administration.actions.ingress).toEqual({ allowed: false, reason: 'management-in-progress' })
    expect(control.administration.actions.restore.allowed).toBe(true)
    await h.administration.manage(simulationProductManageInputSchema.parse({ runId: input.runId,
      managementId: 'pause-blocked-original', phase: 'paused' }), call())
    const cancel = await cancellationFor(h, request.id, 'cancel-blocked-original')
    await h.administration.cancelWorldCase(cancel, call())
    await vi.waitFor(async () => { expect(await h.administration.request({ commandId: cancel.commandId }, call()))
      .toMatchObject({ request: { status: 'completed' }, worldCancellation: cancel }) })
    const cancelled = h.run().snapshot()
    expect(cancelled.world!.requests[request.id]?.status).toBe('cancelled')
    expect(Object.values(cancelled.world!.results)).toHaveLength(1)
    expect(Object.values(cancelled.world!.results)[0]?.outcome.kind).toBe('cancelled')
    await h.administration.submitWorldManagement(input, call())
    await vi.waitFor(async () => { expect(await h.administration.request({ commandId: input.commandId }, call()))
      .toMatchObject({ request: { status: 'completed' }, worldManagementOutcome: { requestId: request.id, result: { status: 'cancelled' } } }) })
    expect(h.run().snapshot()).toEqual(cancelled)
    expect(cancelled.resources).toEqual(state.resources)
    expect(cancelled.relations).toEqual(state.relations)
    expect(cancelled.entities[input.draft.targetId]?.binding).toEqual(state.entities[input.draft.targetId]?.binding)
    expect(cancelled.decisions).toEqual(state.decisions); expect(cancelled.operations).toEqual(state.operations)
    expect(open).not.toHaveBeenCalled(); expect(h.requests).toEqual([])
  } finally { await h.close() }
}, 10000)

it.each(['json', 'sqlite'] as const)('records %s user cancellation before held provider IO releases and keeps pause independent', async (backend) => {
  const h = await fixture(backend), gate = Promise.withResolvers<undefined>(), entered = Promise.withResolvers<undefined>()
  try {
    const { input, state } = await original(h), attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), readTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
    let committing = false, held = false
    vi.spyOn(h.ctx.teams, 'getTeam').mockImplementation(async (...args) => {
      const observed = await readTeam(...args)
      if (committing && !held) { held = true; entered.resolve(undefined); await gate.promise }
      return observed
    })
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementationOnce(async (...args) => {
      const connection = await attach(...args), commit = connection.commitPersonnel.bind(connection)
      vi.spyOn(connection, 'commitPersonnel').mockImplementationOnce(async (...args) => {
        committing = true; return await commit(...args)
      })
      return connection
    })
    await h.administration.submitWorldManagement(input, call()); await entered.promise
    const request = Object.values(h.run().snapshot().world!.requests)[0]!
    const cancel = await cancellationFor(h, request.id, 'cancel-held-original')
    const receipt = await h.administration.cancelWorldCase(cancel, call())
    expect(receipt.status).toBe('accepted')
    const beforeRelease = h.run().snapshot()
    expect(Object.values(beforeRelease.world!.cancellations)).toHaveLength(1)
    // The real commit provider has already read canonical Team state; Native can cancel business before the held source read returns.
    expect(Object.values(beforeRelease.world!.cancellations)[0]?.status).toBe('cancelled')
    expect(beforeRelease.world!.requests[request.id]?.status).toBe('cancelled')
    expect(Object.values(beforeRelease.world!.results)[0]?.outcome.kind).toBe('cancelled')
    const control = await h.administration.control({ runId: input.runId }, call())
    expect(control.inFlight).toBe(true); expect(control.actions.pause.allowed).toBe(true)
    expect(control.administration.actions.checkpoint.reason).toBe('management-in-progress')
    const paused = await h.administration.manage(simulationProductManageInputSchema.parse({ runId: input.runId,
      managementId: 'pause-cancelled-original-io', phase: 'paused' }), call())
    expect(paused.operation.status).toBe('completed')
    const changed = simulationProductWorldManagementSubmitInputSchema.parse({ ...input, commandId: 'second-fresh-management' })
    await expect(h.administration.submitWorldManagement(changed, call())).rejects.toThrow()
    expect(await h.administration.request({ commandId: changed.commandId }, call())).toMatchObject({ status: 'not-found' })
    expect(Object.values(h.run().snapshot().world!.requests)).toHaveLength(1)
    expect(await h.administration.cancelWorldCase(cancel, call())).toMatchObject({ commandId: cancel.commandId })
    gate.resolve(undefined)
    await vi.waitFor(async () => {
      expect(await h.administration.request({ commandId: cancel.commandId }, call())).toMatchObject({ request: { status: 'completed' } })
      expect(await h.administration.request({ commandId: input.commandId }, call())).toMatchObject({ request: { status: 'completed' } })
    })
    const after = h.run().snapshot()
    expect(Object.values(after.world!.requests)).toHaveLength(1)
    expect(Object.values(after.world!.results)).toHaveLength(1)
    expect(Object.values(after.world!.results)[0]?.outcome.kind).toBe('cancelled')
    expect(after.decisions).toEqual(state.decisions); expect(after.operations).toEqual(state.operations)
    expect(Object.keys(after.entities)).toEqual(Object.keys(state.entities))
    expect(after.entities[input.draft.targetId]?.binding).toEqual(state.entities[input.draft.targetId]?.binding)
    expect(open).not.toHaveBeenCalled(); expect(h.requests).toEqual([])
  } finally { gate.resolve(undefined); await h.close() }
}, 10000)

it.each([['json', 'commands'], ['sqlite', 'commands'], ['json', 'pending'], ['sqlite', 'pending']] as const)(
  'refuses a fresh %s cancellation when its real %s allowance is full', async (backend, bound) => {
    const h = await fixture(backend, undefined, { resourceDuty: true,
      ...bound === 'commands' ? { maxCommands: 2 } : { maxPendingPreparations: 1 } })
    try {
      const { input } = await original(h)
      await h.administration.submitWorldManagement(input, call())
      await vi.waitFor(async () => { expect(await h.administration.request({ commandId: input.commandId }, call()))
        .toMatchObject({ worldManagementOutcome: { execution: { phase: 'blocked', reason: 'handoff-required' } } }) })
      const before = h.run().snapshot(), request = Object.values(before.world!.requests)[0]!
      const detail = await h.ctx.simulationProducts.inspectWorldCase({ runId: input.runId, requestId: request.id, section: 'request' }, call())
      expect(detail.value?.summary.cancel).toEqual({ allowed: false, reason: 'capacity' })
      const preview = worldCaseCancelPreview(before, request.id)!
      const cancel = simulationProductWorldCaseCancelInputSchema.parse({ runId: input.runId, requestId: request.id,
        commandId: 'full-cannot-cancel', previewRevision: preview.snapshotRevision, previewHash: preview.previewHash })
      await expect(h.administration.cancelWorldCase(cancel, call())).rejects.toThrow(/capacity/)
      expect(await h.administration.request({ commandId: cancel.commandId }, call())).toMatchObject({ status: 'not-found' })
      expect(h.run().snapshot()).toEqual(before)
    } finally { await h.close() }
  }, 10000)

it.each(['json', 'sqlite'] as const)('rejects oversized %s management IDs before warm or cold Host admission with zero durable append', async (backend) => {
  const h = await fixture(backend)
  try {
    const spec = h.run().snapshot().spec
    const original = { ...managementSubmit, runId: h.created.runId,
      draft: { ...managementSubmit.draft, runId: h.created.runId } }
    for (const phase of ['warm', 'cold'] as const) {
      const current = phase === 'warm' ? h : await h.coldAdministration()
      expect((await current.administration.control({ runId: h.created.runId }, call())).owner)
        .toBe(phase === 'warm' ? 'held' : 'not-held')
      const before = await h.ctx.simulations.inspect({ provider: 'local', spec, includeRecords: true })
      const book = await current.administration.listRequests({ runId: h.created.runId }, call())
      const journal = (await h.ctx.storageLog.list()).find(value => value.name === 'human-management-commands')
      expect(journal).toBeDefined()
      const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), inspect = vi.spyOn(h.ctx.simulations, 'inspect').mockClear()
      const attach = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear()
      for (const boundary of managementCommandBoundaries.filter(value => !value.allowed)) {
        const input = { ...original, commandId: boundary.commandId }
        const result = await current.client.simulations.submitWorldManagement(input as never)
        expect(result).toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
        await expect(current.administration.submitWorldManagement(input as never, call())).rejects.toThrow()
        if (boundary.commandId !== '') expect(await current.administration.request({
          commandId: simulationProductCommandIdSchema.parse(boundary.commandId) }, call())).toMatchObject({ status: 'not-found' })
      }
      expect(open).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled()
      expect(await current.administration.listRequests({ runId: h.created.runId }, call())).toEqual(book)
      expect((await h.ctx.storageLog.list()).find(value => value.name === 'human-management-commands')).toEqual(journal)
      expect(await h.ctx.simulations.inspect({ provider: 'local', spec, includeRecords: true })).toEqual(before)
    }
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it.each(['json', 'sqlite'].flatMap(backend => managementCommandBoundaries.filter(value => value.allowed)
  .map(boundary => ({ backend: backend as 'json' | 'sqlite', ...boundary }))))(
  'admits exact Native $backend $label management identities through authenticated Host', async ({ backend, commandId, label }) => {
    // Astral and escaped lone-unit provenance need larger predeclared test policies; ordinary fixtures retain 4 KiB.
    const managementBytes = label === 'astral128' ? 5120 : label.startsWith('lone-') && commandId.length === 256 ? 8192 : undefined
    const h = await fixture(backend, undefined, managementBytes === undefined ? {} : { managementBytes })
    try {
      const { input } = await original(h)
      const submitNative = h.run().submitWorldManagement.bind(h.run())
      vi.spyOn(h.run(), 'submitWorldManagement').mockImplementation(async (...args) => {
        try {
          const receipt = await submitNative(...args), state = h.run().snapshot()
          const observed = await h.ctx.simulations.inspect({ provider: 'local', spec: state.spec, includeRecords: true })
          const entry = observed?.records?.find(value => value.sequence === receipt.acceptedSequence)
          expect(entry).toBeDefined()
          const record = z.object({ change: z.unknown() }).parse(entry!.value).change
          const world = state.world!, intent = world.intents[receipt.intentId], request = world.requests[receipt.requestId]
          const plan = world.plans[receipt.planId]
          await writeFile(`.local/world-completion/u12-management-reason/bytes-${backend}-${label}.json`, JSON.stringify({
            commandUtf16Units: commandId.length, commandJsonUtf8Bytes: Buffer.byteLength(JSON.stringify(commandId)),
            limits: world.definition.limits,
            intentRequestBytes: Buffer.byteLength(JSON.stringify({ intent, request })),
            recordPlanBytes: Buffer.byteLength(JSON.stringify({ record, plan })), acceptance: entry }, null, 2))
          return receipt
        } catch (cause: unknown) {
          await writeFile(`.local/world-completion/u12-management-reason/admission-final-${backend}-${label}.json`,
            JSON.stringify({ error: String(cause), stack: cause instanceof Error ? cause.stack : undefined }, null, 2))
          throw cause
        }
      })
      const draft = simulationProductWorldManagementDraftSchema.parse({ ...input.draft, values: { ...input.draft.values, reason: 'x' } })
      const preview = await response(h.client.simulations.previewWorldManagement(draft))
      const submitted = simulationProductWorldManagementSubmitInputSchema.parse({ ...input, commandId, draft,
        previewRevision: preview.snapshotRevision, previewHash: preview.previewHash })
      expect((await response(h.client.simulations.submitWorldManagement(submitted))).commandId).toBe(commandId)
      await h.finish(submitted.commandId)
      const requests = Object.values(h.run().snapshot().world!.requests)
      expect(requests).toHaveLength(1)
      expect(requests[0]?.source).toMatchObject({ kind: 'authenticated-user', commandId })
      expect(h.requests).toEqual([])
    } finally { await h.close() }
  })

it.each(['json', 'sqlite'] as const)('rejects invalid %s reasons before warm and cold preview/submit without any durable append', async (backend) => {
  const h = await fixture(backend)
  try {
    const spec = h.run().snapshot().spec
    for (const phase of ['warm', 'cold'] as const) {
      const current = phase === 'warm' ? h : await h.coldAdministration()
      expect((await current.administration.control({ runId: h.created.runId }, call())).owner)
        .toBe(phase === 'warm' ? 'held' : 'not-held')
      const before = await h.ctx.simulations.inspect({ provider: 'local', spec, includeRecords: true })
      const book = await current.administration.listRequests({ runId: h.created.runId }, call())
      const journal = (await h.ctx.storageLog.list()).find(value => value.name === 'human-management-commands')
      expect(journal).toBeDefined()
      const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), inspect = vi.spyOn(h.ctx.simulations, 'inspect').mockClear()
      const attach = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear()
      for (const { reason, label } of managementReasonBoundaries.filter(value => !value.allowed)) {
        for (const action of ['transfer', 'depart', 'hire-existing'] as const) {
          const values = action === 'hire-existing' ? { position: 'position', reason }
            : { assignmentId: 'assignment', effective: 'boundary', reason, ...action === 'transfer' ? { position: 'position' } : { retire: 'no' } }
          const draft = { ...managementSubmit.draft, runId: h.created.runId, action, values }
          const input = { ...managementSubmit, runId: h.created.runId, commandId: `invalid-reason-${action}-${label}`, draft }
          expect(await current.client.simulations.previewWorldManagement(draft as never))
            .toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
          expect(await current.client.simulations.submitWorldManagement(input as never))
            .toMatchObject({ result: { ok: false, error: { code: 'bad-request' } } })
          await expect(current.administration.previewWorldManagement(draft as never, call())).rejects.toThrow()
          await expect(current.administration.submitWorldManagement(input as never, call())).rejects.toThrow()
        }
      }
      expect(open).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled()
      expect(await current.administration.listRequests({ runId: h.created.runId }, call())).toEqual(book)
      expect((await h.ctx.storageLog.list()).find(value => value.name === 'human-management-commands')).toEqual(journal)
      expect(await h.ctx.simulations.inspect({ provider: 'local', spec, includeRecords: true })).toEqual(before)
    }
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('queries and retries the %s actual short lone-unit management original while warm and cold', async (backend) => {
  const h = await fixture(backend)
  try {
    const { input } = await original(h)
    const selected = simulationProductWorldManagementSubmitInputSchema.parse({ ...input, commandId: '\ud800' })
    expect((await response(h.client.simulations.submitWorldManagement(selected))).commandId).toBe(selected.commandId)
    const completed = await h.finish(selected.commandId)
    const spec = h.run().snapshot().spec
    expect(h.run().snapshot().world!.definition.limits.maxBytesPerPlan).toBe(4096)
    for (const phase of ['warm', 'cold'] as const) {
      const current = phase === 'warm' ? h : await h.coldAdministration()
      expect((await current.administration.control({ runId: h.created.runId }, call())).owner)
        .toBe(phase === 'warm' ? 'held' : 'not-held')
      const before = await h.ctx.simulations.inspect({ provider: 'local', spec, includeRecords: true })
      const journal = (await h.ctx.storageLog.list()).find(value => value.name === 'human-management-commands')
      expect(journal).toBeDefined()
      const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), attach = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear()
      expect(await response(current.client.simulations.request({ commandId: selected.commandId }))).toEqual(completed)
      expect(await response(current.client.simulations.retryRequest({ runId: selected.runId, commandId: selected.commandId })))
        .toEqual(completed.status === 'found' ? completed.request : undefined)
      const unknown = simulationProductCommandIdSchema.parse('\udfff'.repeat(257))
      expect(await response(current.client.simulations.request({ commandId: unknown })))
        .toEqual({ status: 'not-found', commandId: unknown })
      expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled()
      expect((await h.ctx.storageLog.list()).find(value => value.name === 'human-management-commands')).toEqual(journal)
      expect(await h.ctx.simulations.inspect({ provider: 'local', spec, includeRecords: true })).toEqual(before)
    }
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s calendar administration previews without inference and retries one durable command', async (backend) => {
  const h = await fixture(backend, undefined, { calendar: true })
  const before = h.run().snapshot()
  const calendar = before.worldBootstrap!.request.data.behavior.calendars[0]!
  const input = { runId: h.created.runId, request: { commandId: 'user-calendar-change', expectedRuleRevision: 1,
    calendar: { ...calendar, startsAt: '6' as typeof calendar.startsAt, endsAt: '10' as typeof calendar.endsAt } } }
  const quote = await response(h.client.simulations.previewWorldCalendar(input))
  expect(h.run().snapshot()).toEqual(before)
  expect(quote.cancelled).toHaveLength(1)
  expect(quote.queued.map(value => value.time)).toEqual(['6'])
  const submit = { input, revision: quote.revision, previewHash: quote.previewHash }
  const retained = await response(h.client.simulations.retainWorldCalendar(submit))
  expect(retained.command?.status).toBe('retained')
  expect(h.run().snapshot().worldBootstrap!.calendarRevisions).toBeUndefined()
  expect(await response(h.client.simulations.readWorldCalendarCommand({ runId: input.runId }))).toEqual(retained)
  const receipt = await response(h.client.simulations.submitWorldCalendar(submit))
  expect(receipt.ruleRevision).toBe(2)
  expect(await response(h.client.simulations.submitWorldCalendar(submit))).toEqual(receipt)
  expect(h.run().snapshot().worldBootstrap!.calendarRevisions).toHaveLength(1)
  const denied = await h.client.simulations.submitWorldCalendar({ ...submit, input: { ...input,
    request: { ...input.request, calendar: { ...input.request.calendar, body: 'Changed after quote' } } } })
  expect(denied.result.ok).toBe(false)
})


it.each(['json', 'sqlite'] as const)('bridges authenticated %s generation into the actual A2 Persona draft owner', async (backend) => {
  const h = await fixture(backend, undefined, { generationMarket: true })
  try {
    const state = h.run().snapshot(), world = state.world!.definition, template = world.templates[0]!
    const persona = { name: template.names[0]!, skills: [], traits: [], goals: [] }
    h.modelRegistration.replace([])
    const model = new MockAdapter([textResponse(JSON.stringify(persona)), textResponse(JSON.stringify(persona))])
    h.ctx.llm.registerAdapter(['company'], model)
    const input = simulationProductGenerationRequestSchema.parse({ runId: h.created.runId, job: {
      id: 'human-persona', assistantEntityId: 'human-persona-helper', purpose: 'persona', scope: world.organizationEntityId,
      audience: [world.organizationEntityId], inputs: [{ source: 'user-authored', content: 'Select the installed finite Persona.', audience: [world.organizationEntityId] }],
      outputSchema: 'persona/1', model: { provider: 'company', name: 'scripted', version: '1' },
      promptVersion: 'clocky.product-generation/1', policyVersion: world.policyVersion,
      deadline: state.spec.maxTime, budget: { maxTokens: 500, maxOutputBytes: 512, maxAttempts: 1 },
    } })
    const denied = new AbortController(); denied.abort()
    await expect(h.administration.generationRequest(input, { ...call(), signal: denied.signal })).rejects.toThrow()
    await expect(h.administration.generationRequest({ ...input, job: { ...input.job, model: { ...input.job.model, name: 'another' } } }, call())).rejects.toThrow()
    await expect(h.administration.generationRequest({ ...input, job: { ...input.job, inputs: [{ ...input.job.inputs[0]!, source: 'private-director-history' }] } }, call())).rejects.toThrow()
    expect(h.run().snapshot().generationJobs).toBeUndefined()
    const accepted = await response(h.client.simulations.generationRequest(input))
    expect(accepted.job?.status).toBe('accepted')
    expect(h.run().snapshot().entities[input.job.assistantEntityId]?.kind).toBe('generation-assistant')
    const controls = await h.administration.control({ runId: input.runId }, call())
    expect(controls.administration.ingress.targets.some(value => value.id === input.job.assistantEntityId)).toBe(false)
    expect(controls.administration.ingress.targets.some(value => value.id === world.directorEntityId)).toBe(true)
    await expect(h.administration.ingress(simulationProductIngressInputSchema.parse({ runId: input.runId, ingressId: 'helper-input', entityId: input.job.assistantEntityId,
      text: 'ordinary input must not reach helper', availableAt: '0' }), call())).rejects.toThrow('not allowed')

    expect(Object.values(h.run().snapshot().entities).filter(value => value.kind === 'person')).toHaveLength(
      Object.values(state.entities).filter(value => value.kind === 'person').length)
    expect(accepted.job?.job.inputs[0]?.source).toMatch(/^authenticated-user:/)
    expect(accepted.job?.binding.sessionId).not.toBe(h.run().snapshot().entities[world.directorEntityId]?.binding?.sessionId)
    expect((await response(h.client.simulations.generationRead({ runId: input.runId, jobId: input.job.id }))).job).toEqual(accepted.job)
    expect(model.requests).toHaveLength(0)
    await h.run().setPhase('running', h.run().snapshot().revision)
    expect((await response(h.client.simulations.generationExecute({ runId: input.runId, jobId: input.job.id }))).job?.status).toBe('validated')
    expect(model.requests).toHaveLength(1)
    const placement = { runId: input.runId, jobId: input.job.id, positionEntityId: world.positions[0]!.entityId,
      templateId: template.id, templateVersion: template.version, draftId: 'generated-review', validUntil: state.spec.maxTime }
    const incorporated = await response(h.client.simulations.generationPersonaDraft(placement))
    expect(incorporated.job).toMatchObject({ status: 'incorporated', incorporatedReference: placement.draftId, incorporatedRevision: 1 })
    expect(hiringMarket(h.run().snapshot()).drafts.get(placement.draftId)).toMatchObject({ status: 'draft', body: { persona }, source: { kind: 'generation', generationJobId: input.job.id, modelVersion: '1' } })
    expect(await response(h.client.simulations.generationPersonaDraft(placement))).toEqual(incorporated)
    expect(model.requests).toHaveLength(1)
    const revision = h.run().snapshot().revision
    await expect(h.administration.generationPersonaDraft({ ...placement, templateId: 'replacement' }, call())).rejects.toThrow()
    expect(h.run().snapshot().revision).toBe(revision)
    expect((await response(h.client.simulations.generationRead({ runId: input.runId, jobId: simulationGenerationJobIdSchema.parse('toString') }))).job).toBeNull()
    const prototypeKey = { ...input, job: { ...input.job, id: simulationGenerationJobIdSchema.parse('constructor'), assistantEntityId: simulationEntityIdSchema.parse('constructor-helper') } }
    expect((await response(h.client.simulations.generationRequest(prototypeKey))).job?.job.id).toBe('constructor')
    await h.run().setPhase('running', h.run().snapshot().revision)
    expect((await response(h.client.simulations.generationExecute({ runId: input.runId, jobId: simulationGenerationJobIdSchema.parse('constructor') }))).job?.status).toBe('validated')
    expect(model.requests).toHaveLength(2)

  } finally { await h.close() }
}, 15000)
