/** Dispatch identity and disposal are tested separately from the real Loader hiring scenarios. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { worldPlanIdSchema, worldRequestIdSchema, worldIntentIdSchema, simulationOperationIdSchema,
  simulationEntityIdSchema, simulationDecisionIdSchema, simulationWriterEpochSchema, simulationEntityBindingSchema,
  simulationWorldDefinitionSchema, simulationWorldRequestOperationSchema, simulationWorldResolveOperationSchema,
  WORLD_GENERATE_AND_HIRE_PIN, WORLD_GENERATE_AND_HIRE_DEFINITION, WORLD_EXTERNAL_MEDIATED_PIN,
  WORLD_EXTERNAL_MEDIATED_DEFINITION, worldExecutionObservationSchema,
  WORLD_GOVERNANCE_VOTE_PIN, WORLD_GOVERNANCE_VOTE_DEFINITION, simulationWorldDomainPinSchema, simulationWindowIdSchema } from '@clocky/clocky-simulation'
import type { SimulationWorldPlan, SimulationWorldRequest, SimulationWorldState, WorldExecutionObservation, WorldExecutionRequest } from '@clocky/clocky-simulation'
import { WorldExecutionDispatcher } from '../src/execution.ts'

function fixture() {
  const request: SimulationWorldRequest = { id: worldRequestIdSchema.parse('case'), intentId: worldIntentIdSchema.parse('intent'),
    operationId: simulationOperationIdSchema.parse('request-operation'), notificationOperationId: simulationOperationIdSchema.parse('post'),
    requesterEntityId: simulationEntityIdSchema.parse('requester'), proposal: simulationWorldRequestOperationSchema.parse({
      kind: 'world/request', domain: 'organization', operation: 'generate-and-hire', version: '1', businessKey: 'case',
      expectedTime: null, evidence: [], payload: { organizationEntityId: 'organization', positionEntityId: 'position', description: 'Need help' } }),
    pin: WORLD_GENERATE_AND_HIRE_PIN, source: { kind: 'decision', decisionId: simulationDecisionIdSchema.parse('decision'),
      epoch: simulationWriterEpochSchema.parse('1'), binding: simulationEntityBindingSchema.parse({ teamId: 'team', participantId: 'requester',
        sessionId: '74e8d1fd-a1bb-4e2b-81fa-a7a15ae23ce7' }) },
    description: 'Need help', payloadHash: 'hash', sequence: 1, plans: [worldPlanIdSchema.parse('plan')], status: 'open' }
  const plan: SimulationWorldPlan = { id: worldPlanIdSchema.parse('plan'), requestId: request.id,
    operationId: simulationOperationIdSchema.parse('plan-operation'), pin: request.pin,
    proposal: simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: request.id, supersedes: null,
      resolution: { kind: 'apply', payload: { templateId: 'person', templateVersion: '1', persona: { name: 'Person', skills: [], traits: [], goals: [] } }, rationale: 'Private' } }),
    reads: [], baseRevision: 1, sequence: 2, hash: 'hash', status: 'accepted' }
  const plans: Record<string, SimulationWorldPlan> = { [plan.id]: plan }
  const executions: Record<string, WorldExecutionObservation> = {}
  const world: SimulationWorldState = { executions, external: { identities: {}, interactions: {}, representatives: {}, contacts: {}, adjudications: {}, events: {} }, personnel: { reservations: {}, fences: {}, generations: {}, operationGrants: [] }, definition: simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], operations: [WORLD_GENERATE_AND_HIRE_PIN], operationGrants: [], directorEntityId: 'director', organizationEntityId: 'organization', positions: [{ entityId: 'position', capacity: 1 }],
    authorizations: [], templates: [{ id: 'person', version: '1', names: ['Person'], skills: [], traits: [], goals: [], description: 'Person' }],
    policyVersion: '1', limits: { maxRequests: 10,
      maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
      maxRequestsPerActorPerInterval: 10,
      maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 4096, maxBytesPerPlan: 4096 } }),
  sequence: 1, channels: {}, intents: {}, requests: { [request.id]: request }, plans,
  results: {}, cancellations: {}, reservations: {}, mutations: {}, facts: {}, evidence: { challenges: {}, revisions: {} },
  governance: { proposals: {}, votes: {}, resolutions: {} }, norms: { versions: {}, closures: [], announcements: {} } }
  let sequence = 3
  const recordWorldExecution = vi.fn(async (input: WorldExecutionRequest) => {
    const prior = executions[input.planId]
    expect(input.expectedSequence).toBe(prior?.sequence ?? null)
    const value = worldExecutionObservationSchema.parse({ ...input, requestId: request.id, intentId: request.intentId,
      pin: plan.pin, sequence: sequence++, updates: (prior?.updates ?? 0) + 1, time: '0' })
    executions[input.planId] = value
    return value
  })
  let phase: 'running' | 'paused' = 'running'
  let activeWindowId: ReturnType<typeof simulationWindowIdSchema.parse> | undefined
  const dispatcher = new WorldExecutionDispatcher({ snapshot: () => ({ world, phase,
    ...activeWindowId === undefined ? {} : { activeWindowId } }), recordWorldExecution })
  let pending = false
  const handler = { definition: WORLD_GENERATE_AND_HIRE_DEFINITION, ref: request.pin.implementationRef, generation: 1,
    reconciliationPlans: () => [], execute: vi.fn(async () => undefined), reconcile: vi.fn(async () => { pending = false }),
    retainsResponsibility: () => pending }
  return { dispatcher, handler, plan, world, plans, recordWorldExecution,
    openWindow: () => { activeWindowId = simulationWindowIdSchema.parse('unsettled') },
    pause: () => { phase = 'paused' }, pending: (value: boolean) => { pending = value } }
}

it('captures only the original installed plan schema and releases its lease before provider disposal', async () => {
  const h = fixture(), dispose = h.dispatcher.register(h.handler)
  expect(h.dispatcher.planSchema(h.plan.pin)).toMatchObject({ type: 'object', additionalProperties: false,
    required: ['templateId', 'templateVersion', 'persona'], properties: { templateVersion: { type: 'string' } } })
  expect(() => h.dispatcher.planSchema({ ...h.plan.pin, generation: 2 })).toThrow('does not match')
  expect(h.handler.execute).not.toHaveBeenCalled()
  await dispose()
  expect(() => h.dispatcher.planSchema(h.plan.pin)).toThrow('no longer admits')
})

it('shares repeated mediated payload definitions so the complete schema fits the ordinary context allowance', async () => {
  const h = fixture()
  const dispose = h.dispatcher.register({ ...h.handler, definition: WORLD_EXTERNAL_MEDIATED_DEFINITION,
    ref: WORLD_EXTERNAL_MEDIATED_PIN.implementationRef, generation: WORLD_EXTERNAL_MEDIATED_PIN.generation })
  const schema = h.dispatcher.planSchema(WORLD_EXTERNAL_MEDIATED_PIN)
  expect(schema.$defs).toBeDefined()
  expect(JSON.stringify(schema).length).toBeLessThan(20000)
  await dispose()
})

it('dispatches only the exact retained pin and rejects another payload or generation before calling IO', async () => {
  const h = fixture(), dispose = h.dispatcher.register(h.handler)
  await h.dispatcher.execute(h.plan)
  expect(h.handler.execute).toHaveBeenCalledWith(h.plan)
  await expect(h.dispatcher.execute({ ...h.plan, hash: 'changed' })).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  const changed = { ...h.plan, pin: { ...h.plan.pin, generation: 2 } }
  h.plans[changed.id] = changed
  await expect(h.dispatcher.execute(changed)).rejects.toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_MISMATCH' })
  expect(h.handler.execute).toHaveBeenCalledOnce()
  await dispose()
})

it('retains unknown Native duty across execution failure and settles through the original handler after admission closes', async () => {
  const h = fixture(), dispose = h.dispatcher.register(h.handler)
  h.pending(true)
  h.handler.execute.mockRejectedValueOnce(new Error('Unknown accepted IO'))
  await expect(h.dispatcher.execute(h.plan)).rejects.toThrow('Unknown accepted IO')
  await expect(dispose()).rejects.toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' })
  await expect(h.dispatcher.execute(h.plan)).rejects.toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' })
  await h.dispatcher.reconcile(h.plan)
  await dispose()
  expect(h.handler.reconcile).toHaveBeenCalledWith(h.plan)
  await expect(h.dispatcher.execute(h.plan)).rejects.toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' })
})

it('drains an admitted callback before reporting unresolved duty and refuses concurrent execution of the same plan', async () => {
  const h = fixture(), dispose = h.dispatcher.register(h.handler)
  let finish!: () => void
  h.pending(true)
  h.handler.execute.mockImplementationOnce(() => new Promise((resolve) => { finish = () =>{  resolve(undefined) } }))
  const executing = h.dispatcher.execute(h.plan)
  await vi.waitFor(() => { expect(h.handler.execute).toHaveBeenCalledOnce() })
  await expect(h.dispatcher.reconcile(h.plan)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  let ended = false
  const closing = dispose().catch((error: unknown) => { ended = true; return error })
  await Promise.resolve()
  expect(ended).toBe(false)
  finish()
  await executing
  expect(await closing).toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' })
  await h.dispatcher.reconcile(h.plan)
  await dispose()
})

it('reports retained unknown duty through Cordis logging without hanging Fiber unload or admitting replacement IO', async () => {
  const h = fixture(), ctx = new Context(), errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
  ctx.effect(() => h.dispatcher.register(h.handler))
  h.pending(true)
  h.handler.execute.mockRejectedValueOnce(new Error('Unknown accepted IO'))
  await expect(h.dispatcher.execute(h.plan)).rejects.toThrow('Unknown accepted IO')
  await ctx.fiber.dispose()
  expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' }))
  await expect(h.dispatcher.execute(h.plan)).rejects.toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' })
  expect(() => h.dispatcher.register(h.handler)).toThrow('already registered')
  await h.dispatcher.reconcile(h.plan)
  errors.mockRestore()
})

it('removes fresh execution through the actual Cordis effect lifecycle', async () => {
  const h = fixture(), ctx = new Context()
  ctx.effect(() => h.dispatcher.register(h.handler))
  await h.dispatcher.execute(h.plan)
  await ctx.fiber.dispose()
  await expect(h.dispatcher.execute(h.plan)).rejects.toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' })
  expect(h.handler.execute).toHaveBeenCalledOnce()
})

it('persists callback admission before IO and never executes uncertain work a second time', async () => {
  const h = fixture(), dispose = h.dispatcher.register(h.handler)
  h.pending(true)
  h.handler.execute.mockImplementationOnce(async () => {
    expect(h.world.executions[h.plan.id]).toMatchObject({ phase: 'armed', mode: 'execute', reason: null })
    throw new Error('Response lost after original IO')
  })
  await expect(h.dispatcher.execute(h.plan)).rejects.toThrow('Response lost')
  expect(h.world.executions[h.plan.id]).toMatchObject({ phase: 'outcome-unknown', reason: 'callback-unconfirmed' })
  await expect(h.dispatcher.execute(h.plan)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
  expect(h.handler.execute).toHaveBeenCalledOnce()
  await h.dispatcher.reconcile(h.plan)
  expect(h.world.executions[h.plan.id]).toMatchObject({ phase: 'settled', mode: 'reconcile', reason: null })
  await dispose()
})

it('records a typed blocker independently of unknown IO and business results', async () => {
  const h = fixture(), dispose = h.dispatcher.register(h.handler)
  h.handler.execute.mockResolvedValueOnce('handoff-required' as never)
  await expect(h.dispatcher.execute(h.plan)).resolves.toBe('handoff-required')
  expect(h.world.executions[h.plan.id]).toMatchObject({ phase: 'blocked', reason: 'handoff-required' })
  expect(h.world.results).toEqual({})
  h.handler.execute.mockResolvedValueOnce('retirement-unknown' as never)
  await expect(h.dispatcher.execute(h.plan)).resolves.toBe('retirement-unknown')
  expect(h.world.executions[h.plan.id]).toMatchObject({ phase: 'outcome-unknown', reason: 'retirement-unknown' })
  await h.dispatcher.blocked(h.plan, 'implementation-unavailable')
  expect(h.world.executions[h.plan.id]).toMatchObject({ phase: 'outcome-unknown', reason: 'retirement-unknown' })
  await h.dispatcher.reconcile(h.plan)
  await dispose()
})

it('retains an armed callback before reservation and reconciles absence without sending new IO', async () => {
  const h = fixture(), dispose = h.dispatcher.register(h.handler)
  h.handler.execute.mockRejectedValueOnce(new Error('Callback interrupted before reservation'))
  await expect(h.dispatcher.execute(h.plan)).rejects.toThrow('interrupted')
  await expect(dispose()).rejects.toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' })
  await h.dispatcher.reconcile(h.plan)
  expect(h.handler.reconcile).not.toHaveBeenCalled()
  expect(h.handler.execute).toHaveBeenCalledOnce()
  expect(h.world.executions[h.plan.id]).toMatchObject({ phase: 'settled', mode: 'reconcile' })
  await dispose()
})

it('honors a newer pause while callback admission is being persisted', async () => {
  const h = fixture(), dispose = h.dispatcher.register(h.handler)
  const record = h.recordWorldExecution.getMockImplementation()!
  h.recordWorldExecution.mockImplementationOnce(async (input) => { const value = await record(input); h.pause(); return value })
  await expect(h.dispatcher.execute(h.plan)).resolves.toBe('paused')
  expect(h.handler.execute).not.toHaveBeenCalled()
  expect(h.world.executions[h.plan.id]).toMatchObject({ phase: 'blocked', reason: 'paused' })
  await dispose()
})

it('bounds generic boundary work to one exact provider callback and coalesces concurrent callers through disposal', async () => {
  const h = fixture(), gate = Promise.withResolvers<boolean>()
  const settleBoundary = vi.fn(() => gate.promise), handler = { ...h.handler, settleBoundary }
  const dispose = h.dispatcher.register(handler)
  const first = h.dispatcher.settleBoundary(), duplicate = h.dispatcher.settleBoundary()
  expect(first).toBe(duplicate)
  await vi.waitFor(() => { expect(settleBoundary).toHaveBeenCalledOnce() })
  let closed = false
  const closing = dispose().then(() => { closed = true })
  await Promise.resolve()
  expect(closed).toBe(false)
  gate.resolve(true)
  expect(await first).toBe(true)
  await closing
  expect(closed).toBe(true)
  await expect(h.dispatcher.settleBoundary()).rejects.toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' })
  expect(h.recordWorldExecution).not.toHaveBeenCalled()
})

it('never invokes deterministic boundary work from a paused reader or paused reconciliation', async () => {
  const h = fixture(), settleBoundary = vi.fn(async () => true)
  const dispose = h.dispatcher.register({ ...h.handler, settleBoundary })
  h.pause()
  expect(await h.dispatcher.settleBoundary()).toBe(false)
  expect(await h.dispatcher.reconcilePending()).toBe(0)
  expect(settleBoundary).not.toHaveBeenCalled()
  expect(h.recordWorldExecution).not.toHaveBeenCalled()
  await dispose()
})

it('propagates a boundary owner failure and releases its lease without fabricating a plan observation', async () => {
  const h = fixture(), settleBoundary = vi.fn(async (): Promise<boolean> => { throw new Error('Native append unavailable') })
  const dispose = h.dispatcher.register({ ...h.handler, settleBoundary })
  await expect(h.dispatcher.settleBoundary()).rejects.toThrow('Native append unavailable')
  expect(h.recordWorldExecution).not.toHaveBeenCalled()
  await dispose()
})


it('refuses the old vote artifact at a productive boundary instead of aliasing it to the new implementation', async () => {
  const h = fixture(), settleBoundary = vi.fn(async () => true)
  const old = simulationWorldDomainPinSchema.parse({ ...WORLD_GOVERNANCE_VOTE_PIN,
    schemaRef: 'clocky.governance.vote/schema/2', implementationRef: 'clocky.governance.vote/native/3', generation: 2 })
  const world = { ...h.world, definition: { ...h.world.definition, operations: [old] } }
  const dispatcher = new WorldExecutionDispatcher({ snapshot: () => ({ world, phase: 'running' }),
    recordWorldExecution: h.recordWorldExecution })
  const dispose = dispatcher.register({ ...h.handler, definition: WORLD_GOVERNANCE_VOTE_DEFINITION,
    ref: WORLD_GOVERNANCE_VOTE_PIN.implementationRef, generation: WORLD_GOVERNANCE_VOTE_PIN.generation, settleBoundary })
  await expect(dispatcher.settleBoundary()).rejects.toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_MISMATCH' })
  expect(settleBoundary).not.toHaveBeenCalled()
  expect(h.recordWorldExecution).not.toHaveBeenCalled()
  await dispose()
})

it('waits for the actual active decision window before admitting a generic domain boundary', async () => {
  const h = fixture(), settleBoundary = vi.fn(async () => true)
  const dispose = h.dispatcher.register({ ...h.handler, settleBoundary })
  h.openWindow()
  expect(await h.dispatcher.settleBoundary()).toBe(false)
  expect(settleBoundary).not.toHaveBeenCalled()
  expect(h.recordWorldExecution).not.toHaveBeenCalled()
  await dispose()
})
