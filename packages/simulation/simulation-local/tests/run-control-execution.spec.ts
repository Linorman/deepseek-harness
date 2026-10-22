/** Actual pinned plans retain external responsibility through stopping updates and both cold storage owners. */
import { expect, it } from 'vitest'
import { simulationRunControlCommandSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

const target = (id: string, boundary = '0') => simulationRunControlCommandSchema.parse({ commandId: id, target: {
  targetId: id, clock: { kind: 'native' }, boundary, mode: 'at-boundary', checkpointPolicy: 'request',
  drainBudget: { maxSteps: 10, maxTokens: 1000, maxWallTimeMs: 10000 },
} })

it.each(['json', 'sqlite'] as const)('%s records an effective tightening before a queued external arm and refuses dispatch', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.tmp/w1/execution-cuts' })
  try {
    const plan = await h.plan('tighten-before-dispatch')
    const revision = h.run.snapshot().revision
    const update = h.run.updateRunControl(target('before-arm'), revision)
    const dispatch = h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute', reason: null, expectedSequence: null })
    expect((await update).activation).toBe('effective')
    await expect(dispatch).rejects.toThrow(/stop target/)
    expect(h.run.snapshot().phase).toBe('paused')
    expect(h.run.snapshot().world?.executions[plan.id]).toBeUndefined()
    expect(h.run.snapshot().world?.requests[plan.requestId]?.status).toBe('open')
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s retains an armed unknown external effect across pause, cold recovery and exact reconciliation', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.tmp/w1/execution-cuts' })
  try {
    const plan = await h.plan('unknown-before-target')
    const armed = await h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute', reason: null, expectedSequence: null })
    const receipt = await h.run.updateRunControl(target('pending-target'), h.run.snapshot().revision)
    expect(receipt.activation).toBe('pending')
    expect(h.run.snapshot().phase).toBe('paused')
    expect(h.run.snapshot().runControl?.current.cut).toBeNull()
    const unknown = await h.run.recordWorldExecution({ planId: plan.id, phase: 'outcome-unknown', mode: 'execute',
      reason: 'callback-unconfirmed', expectedSequence: armed.sequence })
    const requests = h.run.snapshot().world?.requests
    await h.connection.close()
    await h.run.close()
    const cold = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    try {
      expect(cold.snapshot().runControl?.current.activation).toBe('pending')
      expect(cold.snapshot().world?.executions[plan.id]).toEqual(unknown)
      expect(cold.snapshot().world?.results).toEqual({})
      await expect(cold.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute', reason: null,
        expectedSequence: unknown.sequence })).rejects.toThrow()
      const reconciled = await cold.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'reconcile', reason: null,
        expectedSequence: unknown.sequence })
      await cold.recordWorldExecution({ planId: plan.id, phase: 'settled', mode: 'reconcile', reason: null,
        expectedSequence: reconciled.sequence })
      expect(cold.snapshot().runControl?.current).toMatchObject({ activation: 'effective', state: 'paused', reason: 'target-reached' })
      expect(cold.snapshot().world?.requests).toEqual(requests)
      expect(cold.snapshot().world?.results).toEqual({})
      expect(h.requests).toHaveLength(0)
      await expect(cold.setPhase('running', cold.snapshot().revision)).rejects.toThrow(/stop target/)
    } finally { await cold.close() }
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s reports a dispatched effect that confirms past a newly tightened domain target without rewinding it', async (backend) => {
  const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const resolve = (...parts: string[]) => path.resolve(...parts)
  const { z } = await import('zod')
  const { default: Loader } = await import('@clocky/cordis-plugin-loader')
  const { default: Presets } = await import('@clocky/clocky-agent-presets')
  const Direct = await import('@clocky/clocky-team-channel-direct')
  const Tools = await import('@clocky/clocky-tool-simulation')
  const { createContext } = await import('../../simulation-team/tests/harness.ts')
  const { simulationWorldDomainPinSchema, simulationChangeSchema, simTimeSchema } = await import('@clocky/clocky-simulation')
  const root = await mkdtemp(resolve('.tmp/w1/domain-clock-'))
  const { ctx, serviceFiber } = await createContext(root, backend)
  let h: Awaited<ReturnType<typeof hiringResourceHarness>> | undefined
  try {
    await ctx.plugin(Direct); await ctx.plugin(Tools); await ctx.plugin(Loader)
    const presets = resolve(root, 'presets')
    await mkdir(resolve(presets, 'simulation'), { recursive: true })
    await writeFile(resolve(presets, 'simulation/agent.cordis.yml'), '[{"name":"cordis:company-role"}]\n')
    await ctx.plugin(Presets, { default: 'simulation', includeUserRoot: false, roots: [{ path: presets, trust: 'system' }] })
    const pin = simulationWorldDomainPinSchema.parse({ domain: 'confirmed-clock', operation: 'record', version: '1',
      schemaRef: 'confirmed-clock/schema/1', implementationRef: 'confirmed-clock/implementation/1', generation: 1 })
    const empty = z.strictObject({})
    const clockEntity = 'confirmed-clock-source' as import('@clocky/clocky-simulation').SimulationEntityId
    const domain: import('@clocky/clocky-simulation').NativeWorldDomain = {
      ref: pin.implementationRef, generation: pin.generation,
      definition: { ...pin, schemas: { request: empty, plan: empty, result: empty, mutation: empty } },
      stopClock: { name: 'confirmed-day', nativeBoundary: (_state, boundary) => boundary, observe: state => ({
        value: simTimeSchema.parse(z.number().int().parse(state.entities[clockEntity]?.profile.day ?? 11).toString()),
        revision: state.revision }), effect: () => simTimeSchema.parse('13') },
      personnelSubjects: () => [], admitRequest: () => { throw new Error('Clock source accepts no model actions') },
      planningContext: () => ({}), validatePlan: () => {}, executionReads: () => [],
      reduceMutation: () => ({ changes: [], resultPayload: {} }),
    }
    ctx.simulations.domains('local').register(domain.definition, domain)
    h = await hiringResourceHarness(backend, 'hire-existing', { loadedContext: { ctx, serviceFiber },
      evidenceRoot: '.tmp/w1/execution-cuts', installedPins: [pin], extraEntities: [{ id: clockEntity, entityKind: 'environment' }] })
    const plan = await h.plan('already-dispatched')
    const mapped = target('mapped-native-bound', '12')
    mapped.target!.clock = { kind: 'domain', pin, name: 'confirmed-day' }
    await h.run.updateRunControl(mapped, h.run.snapshot().revision)
    const mappedState = h.run.snapshot()
    expect(mappedState.runControl?.current.nativeBoundary).toBe('12')
    const { simulationWakeRequestSchema, validateSimulationCommunication } = await import('@clocky/clocky-simulation')
    const { foldSchedulerRecord } = await import('../src/scheduler.ts')
    await expect(h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'past-mapped-boundary', time: '13',
      entityId: h.requester, reason: 'Cannot cross the mapped Native boundary' }), mappedState.revision)).rejects.toThrow(/stop target/)
    expect(() => foldSchedulerRecord(mappedState, { kind: 'clock/advanced', time: simTimeSchema.parse('13') }, mappedState.revision + 1))
      .toThrow(/stop target/)
    expect(() => { validateSimulationCommunication(mappedState, h!.requester, { kind: 'communication/post', recipient: h!.director,
      channelId: mappedState.world!.channels[h!.requester]!, text: 'A future post must not bypass a domain target', deliverAt: simTimeSchema.parse('13') }) })
      .toThrow(/stop target/)
    await h.run.drive({ until: simTimeSchema.parse('13') })
    expect(h.run.snapshot().time).toBe('12')
    expect(h.run.snapshot().phase).toBe('paused')
    expect(h.run.snapshot().runControl?.current).toMatchObject({ reason: 'native-boundary-reached',
      cut: { clockValue: '11', nativeTime: '12' } })
    await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toThrow(/stop target/)
    await h.run.updateRunControl({ commandId: 'clear-mapped-test', target: null }, h.run.snapshot().revision)
    const armed = await h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute', reason: null, expectedSequence: null })
    const command = target('tighten-domain', '12')
    command.target!.clock = { kind: 'domain', pin, name: 'confirmed-day' }
    expect((await h.run.updateRunControl(command, h.run.snapshot().revision)).activation).toBe('pending')
    const before = h.run.snapshot().entities[clockEntity]!
    // Host confirmation models an already dispatched external receipt; no model action or clock rollback is fabricated.
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: clockEntity,
      entityRevision: before.revision, profile: { day: 13 } }), h.run.snapshot().revision)
    await h.run.recordWorldExecution({ planId: plan.id, phase: 'settled', mode: 'execute', reason: null, expectedSequence: armed.sequence })
    const state = h.run.snapshot()
    expect(state.phase).toBe('paused')
    expect(state.entities[clockEntity]?.profile.day).toBe(13)
    expect(state.runControl?.current).toMatchObject({ activation: 'rejected', reason: 'past-boundary', cut: null })
    expect(state.world?.requests[plan.requestId]?.status).toBe('open')
    expect(state.world?.results).toEqual({})
    expect(h.requests).toHaveLength(0)
  } finally { if (h !== undefined) await h.close(); else await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
