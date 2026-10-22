/** Real canonical requests and plans commit one isolated name while an unrelated window remains admitted. */
import { expect, it, vi } from 'vitest'
import { simulationWindowRequestSchema,
  simulationDecisionIdSchema, simulationChangeSchema, simulationResourceSpecSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { localObjectFixture as setup } from './world-local-object-fixture.ts'
import { contextRequest } from './context-fixture.ts'
import { LocalObjectNativeWorldDomain } from '../src/world-local-object.ts'

it.each(['json', 'sqlite'] as const)('commits with an unrelated live window and preserves exact retries (%s)', async (backend) => {
  const h = await setup(backend)
  try {
    const second = await h.request(h.targets[1]!)
    const id = simulationDecisionIdSchema.parse('unrelated-window')
    const window = await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'rename-window', decisions: [{
      id, entityId: h.requester, context: { ...contextRequest(), world: { kind: 'request', intentId: second.request.intentId } },
    }] }), h.run.snapshot().revision)
    const context = structuredClone(h.run.snapshot().decisions[id]!.context)
    expect(h.run.inspectLocalObjectMutation!(h.targets[0]!)).toEqual({ kind: 'local', owner: 'native' })
    await h.handler.execute(h.plan)
    const after = h.run.snapshot()
    expect(after.activeWindowId).toBe(window.id)
    expect(after.decisions[id]!.status).toBe('open')
    expect(after.decisions[id]!.context).toEqual(context)
    expect(after.entities[h.targets[0]!]!.profile.name).toBe(h.first.input.name)
    expect(Object.values(after.maintenance ?? {})).toHaveLength(0)
    const result = Object.values(after.world!.results).find(value => value.requestId === h.first.request.id)!
    expect(result.payload).toMatchObject({ execution: { kind: 'local', owner: 'native' } })
    const revision = after.revision
    await h.handler.execute(h.plan)
    expect(h.run.snapshot().revision).toBe(revision)
    await expect(h.propose(h.requester, id, second.action, { kind: 'request', intentId: second.request.intentId }))
      .rejects.toThrow('Original hiring proposal was not accepted')
    expect(h.run.snapshot().decisions[id]!.status).toBe('submitted')
    await h.run.commitWindow(window.id)
    expect(h.run.snapshot().decisions[id]!.status).toBe('accepted')
  } finally { await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('refuses arbitrary profile changes and uses visible maintenance for unknown reads (%s)', async (backend) => {
  const h = await setup(backend)
  try {
    const id = simulationDecisionIdSchema.parse('unknown-read')
    await h.connection.openDecision(h.requester, id)
    await h.connection.prepareContext(h.requester, id, { ...contextRequest(), world: { kind: 'goal' } })
    expect(h.run.inspectLocalObjectMutation!(h.targets[0]!)).toEqual({ kind: 'maintenance', reason: 'window-read-set-unknown' })
    await h.handler.execute(h.plan)
    const state = h.run.snapshot()
    expect(Object.values(state.world!.results).find(value => value.requestId === h.first.request.id)?.payload)
      .toMatchObject({ execution: { kind: 'maintenance', reason: 'window-read-set-unknown' } })
    expect(state.maintenance?.[`local-object:${h.plan.id}` as never]?.status).toBe('completed')
    const module = new LocalObjectNativeWorldDomain(), intent = state.world!.intents[h.first.request.intentId]!
    expect(() => module.reduceMutation(state, intent, h.plan, { ...h.first.input, profile: { permissions: ['all'] } })).toThrow()
  } finally { await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('cancels admission and refuses stale target revisions before publication (%s)', async (backend) => {
  const h = await setup(backend)
  try {
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const state = h.run.snapshot()
    await h.run.change({ kind: 'entity/profile', id: h.targets[0]!, entityRevision: state.entities[h.targets[0]!]!.revision,
      profile: { name: 'Changed independently' } }, state.revision)
    await h.start()
    await expect(h.handler.execute(h.plan)).rejects.toThrow()
    expect(h.run.snapshot().world!.plans[h.plan.id]!.status).toBe('stale')
    expect(h.run.snapshot().entities[h.targets[0]!]!.profile.name).toBe('Changed independently')
    expect(Object.values(h.run.snapshot().world!.results).some(value => value.requestId === h.first.request.id)).toBe(false)
    h.lifetime.abort()
    const revision = h.run.snapshot().revision
    await expect(h.handler.execute(h.plan)).rejects.toThrow()
    expect(h.run.snapshot().revision).toBe(revision)
  } finally { await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('recognizes an overlapping retained director read before using whole-run maintenance (%s)', async (backend) => {
  const h = await setup(backend)
  try {
    const id = simulationDecisionIdSchema.parse('overlapping-director')
    await h.connection.openDecision(h.director, id)
    await h.connection.prepareContext(h.director, id, { ...contextRequest(), world: { kind: 'resolve', requestId: h.first.request.id } })
    expect(h.run.inspectLocalObjectMutation!(h.targets[0]!)).toEqual({ kind: 'maintenance', reason: 'window-overlap' })
    await h.handler.execute(h.plan)
    expect(Object.values(h.run.snapshot().world!.results).find(value => value.requestId === h.first.request.id)?.payload)
      .toMatchObject({ execution: { kind: 'maintenance', reason: 'window-overlap' } })
  } finally { await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('rechecks revoked authority and never changes a protected profile (%s)', async (backend) => {
  const h = await setup(backend)
  try {
    const state = h.run.snapshot(), relation = state.relations[`rename:${h.targets[0]}` as never]!
    const { revision, ...fields } = relation
    await h.run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...fields,
      relationRevision: revision, validFrom: '1', validUntil: null }), state.revision)
    await expect(h.handler.execute(h.plan)).rejects.toThrow()
    expect(h.run.snapshot().world!.plans[h.plan.id]!.status).toBe('stale')
    expect(h.run.snapshot().entities[h.targets[0]!]!.profile.name).toBe('object-a')
  } finally { await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('keeps the checkpoint cut exclusive and retries the exact plan after release (%s)', async (backend) => {
  const h = await setup(backend)
  try {
    const candidate = await h.connection.collectCheckpointCandidate(4, 3)
    try {
      await candidate.validate()
      await expect(h.handler.execute(h.plan)).rejects.toThrow(/checkpoint|cut/)
      expect(h.run.snapshot().entities[h.targets[0]!]!.profile.name).toBe('object-a')
    } finally { candidate.release() }
    await h.handler.execute(h.plan)
    expect(h.run.snapshot().entities[h.targets[0]!]!.profile.name).toBe('Renamed object-a')
  } finally { await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('uses whole-run maintenance when the target owns a resource (%s)', async (backend) => {
  const h = await setup(backend)
  try {
    await h.run.createResource(simulationResourceSpecSchema.parse({ id: 'object-stock', owner: h.targets[0]!,
      kind: 'inventory', unit: 'item', quantity: '1', controllers: [h.requester] }), h.run.snapshot().revision)
    expect(h.run.inspectLocalObjectMutation!(h.targets[0]!)).toEqual({ kind: 'maintenance', reason: 'related-object' })
    await h.handler.execute(h.plan)
    const state = h.run.snapshot()
    expect(state.resources['object-stock' as never]!.quantity).toBe('1')
    const observation = await h.ctx.simulations.inspect({ provider: 'local', spec: h.selection.spec, includeRecords: true })
    const { z } = await import('zod')
    const original = observation!.records!.map(value => value.value).find(value =>
      z.object({ kind: z.literal('run/world-mutation') }).safeParse(value).success)
    expect(original).toMatchObject({ change: { localFootprint: { resources: ['object-stock'] } } })
    const publicResult = Object.values(state.world!.results).find(value => value.requestId === h.first.request.id)!
    expect(JSON.stringify(publicResult.payload)).not.toContain('object-stock')
    expect(JSON.stringify(publicResult.payload)).not.toContain('permissionRelations')
    expect(Object.values(state.world!.results).find(value => value.requestId === h.first.request.id)?.payload)
      .toMatchObject({ execution: { kind: 'maintenance', reason: 'related-object' } })
  } finally { await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('retains accepted maintenance when cancellation interrupts cross-owner collection (%s)', async (backend) => {
  const h = await setup(backend)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  try {
    const id = simulationDecisionIdSchema.parse('cancelled-unknown-read')
    await h.connection.openDecision(h.requester, id)
    await h.connection.prepareContext(h.requester, id, { ...contextRequest(), world: { kind: 'goal' } })
    const collect = h.connection.collectCheckpointCandidate.bind(h.connection)
    const spy = vi.spyOn(h.connection, 'collectCheckpointCandidate').mockImplementation(async (...args) => {
      const candidate = await collect(...args)
      entered.resolve(undefined); await release.promise
      return candidate
    })
    const work = h.handler.execute(h.plan)
    await entered.promise
    h.lifetime.abort(); release.resolve(undefined)
    await expect(work).rejects.toThrow()
    spy.mockRestore()
    expect(h.handler.retainsResponsibility(h.plan)).toBe(true)
    expect(h.run.snapshot().entities[h.targets[0]!]!.profile.name).toBe('object-a')
  } finally { release.resolve(undefined); await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('preserves unrelated accepted task responsibility while committing a local name (%s)', async (backend) => {
  const h = await setup(backend)
  try {
    await expect(h.propose(h.requester, 'retained-task', { kind: 'task/create', deliverAt: '5', task: {
      subject: 'Unrelated retained task', description: 'Keep the original task responsibility', blockedBy: [], requiredCapabilities: [],
      priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 2,
    } }, { kind: 'goal' })).rejects.toThrow(/outbox dispatcher/)
    const queued = Object.values(h.run.snapshot().operations).find(value => value.action.kind === 'task/create')!
    await h.run.drive({ until: simTimeSchema.parse('5') })
    await h.connection.dispatchOperation(queued.id, () => Date.now())
    const task = h.run.snapshot().operations[queued.id]!, receipt = task.outbox?.taskReceipt
    if (receipt === undefined) throw new Error('Canonical task receipt was not retained')
    const canonical = await h.ctx.teams.getTask({ teamId: receipt.teamId, taskId: receipt.taskId })
    await h.handler.execute(h.plan)
    expect(h.run.snapshot().operations[task.id]).toEqual(task)
    expect(await h.ctx.teams.getTask({ teamId: receipt.teamId, taskId: receipt.taskId })).toEqual(canonical)
    expect(h.run.snapshot().entities[h.targets[0]!]!.profile.name).toBe('Renamed object-a')
  } finally { await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('preserves a newer pause through the full-run fallback collector (%s)', async (backend) => {
  const h = await setup(backend)
  try {
    const id = simulationDecisionIdSchema.parse('pause-unknown-read')
    await h.connection.openDecision(h.requester, id)
    await h.connection.prepareContext(h.requester, id, { ...contextRequest(), world: { kind: 'goal' } })
    const { simulationPhaseManagementRequestSchema } = await import('@clocky/clocky-simulation')
    const collect = h.connection.collectCheckpointCandidate.bind(h.connection)
    let paused = false
    const spy = vi.spyOn(h.connection, 'collectCheckpointCandidate').mockImplementation(async (...args) => {
      const candidate = await collect(...args)
      if (!paused) {
        paused = true
        await h.run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'newer-local-pause', phase: 'paused' }))
      }
      return candidate
    })
    await h.handler.execute(h.plan)
    spy.mockRestore()
    expect(h.run.snapshot().phase).toBe('paused')
    expect(h.run.snapshot().entities[h.targets[0]!]!.profile.name).toBe('Renamed object-a')
  } finally { await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('rejects a tampered private footprint during replay without putting it into model results (%s)', async (backend) => {
  const h = await setup(backend)
  const { NativeWorldRuntime } = await import('../src/world-runtime.ts')
  const { worldMutationRecordSchema, foldWorldMutation } = await import('../src/world-mutation.ts')
  const { z } = await import('zod')
  const runtime = new NativeWorldRuntime(h.ctx.simulations.domains('local'))
  try {
    const before = h.run.snapshot()
    await h.handler.execute(h.plan)
    const observation = await h.ctx.simulations.inspect({ provider: 'local', spec: h.selection.spec, includeRecords: true })
    const raw = observation!.records!.map(value => value.value).find(value =>
      z.object({ kind: z.literal('run/world-mutation') }).safeParse(value).success)
    const record = z.object({ change: worldMutationRecordSchema }).parse(raw).change
    expect(record.localFootprint?.permissionRelations).toContain('rename:object-a')
    expect(foldWorldMutation(before, record, record.mutation.sequence, runtime).entities[h.targets[0]!]!.profile.name)
      .toBe('Renamed object-a')
    const corrupted = { ...record, localFootprint: { ...record.localFootprint!, resources: ['forged-resource'] } }
    expect(() => foldWorldMutation(before, corrupted, record.mutation.sequence, runtime)).toThrow(/footprint/)
    const { localFootprint: _footprint, ...missing } = record
    expect(() => foldWorldMutation(before, missing, record.mutation.sequence, runtime)).toThrow(/footprint/)
    expect(() => worldMutationRecordSchema.parse({ ...record, localFootprint: { ...record.localFootprint, writerEpoch: '1' } })).toThrow()
  } finally { runtime.close(); await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('drains an accepted local append before disposing its original owners (%s)', async (backend) => {
  const h = await setup(backend)
  const stream = (h.run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const append = stream.append.bind(stream), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const { z } = await import('zod')
  const spy = vi.spyOn(stream, 'append').mockImplementation(async (expected, values, options) => {
    if (values.some(value => z.object({ kind: z.literal('run/world-mutation') }).safeParse(value).success)) {
      entered.resolve(undefined); await release.promise
    }
    return await append(expected, values, options)
  })
  let disposed = false
  try {
    const work = h.handler.execute(h.plan)
    await entered.promise
    const closing = h.close().then(() => { disposed = true })
    await Promise.resolve(); await Promise.resolve()
    expect(disposed).toBe(false)
    release.resolve(undefined)
    await work; await closing
    expect(h.run.snapshot().entities[h.targets[0]!]!.profile.name).toBe('Renamed object-a')
  } finally { release.resolve(undefined); spy.mockRestore(); if (!disposed) await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('rechecks cancellation after waiting behind another Native append (%s)', async (backend) => {
  const h = await setup(backend)
  const stream = (h.run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const append = stream.append.bind(stream), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  let blocked = false
  const spy = vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
    if (!blocked) { blocked = true; entered.resolve(undefined); await release.promise }
    return await append(...args)
  })
  try {
    const earlier = h.run.setPhase('paused', h.run.snapshot().revision)
    await entered.promise
    const later = expect(h.handler.execute(h.plan)).rejects.toThrow()
    h.lifetime.abort(); release.resolve(undefined)
    await earlier; await later
    await expect(h.run.setPhase('running', h.run.snapshot().revision, () => { h.lifetime.signal.throwIfAborted() })).rejects.toThrow()
    expect(h.run.snapshot().phase).toBe('paused')
    expect(h.run.snapshot().entities[h.targets[0]!]!.profile.name).toBe('object-a')
    expect(Object.values(h.run.snapshot().world!.results).some(value => value.requestId === h.first.request.id)).toBe(false)
  } finally { release.resolve(undefined); spy.mockRestore(); await h.close() }
}, 30000)

it.each(['json', 'sqlite'] as const)('serializes unrelated writer retirement behind an accepted local append (%s)', async (backend) => {
  const h = await setup(backend)
  const stream = (h.run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const append = stream.append.bind(stream), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const { z } = await import('zod')
  const spy = vi.spyOn(stream, 'append').mockImplementation(async (expected, values, options) => {
    if (values.some(value => z.object({ kind: z.literal('run/world-mutation') }).safeParse(value).success)) {
      entered.resolve(undefined); await release.promise
    }
    return await append(expected, values, options)
  })
  try {
    const original = structuredClone(h.run.snapshot().entities[h.requester]!)
    const work = h.handler.execute(h.plan)
    await entered.promise
    let retired = false
    const retirement = h.connection.hibernate(h.requester).then(() => { retired = true })
    await Promise.resolve(); await Promise.resolve()
    expect(retired).toBe(false)
    expect(h.run.snapshot().entities[h.requester]!.writer).toEqual(original.writer)
    release.resolve(undefined)
    await work; await retirement
    const state = h.run.snapshot()
    expect(state.entities[h.requester]!.writer).toMatchObject({ phase: 'released', epoch: original.writer!.epoch })
    expect(state.entities[h.requester]!.binding).toEqual(original.binding)
    expect(state.entities[h.targets[0]!]!.profile.name).toBe('Renamed object-a')
    expect(Object.values(state.world!.mutations).filter(value => value.planId === h.plan.id)).toHaveLength(1)
    expect(Object.values(state.maintenance ?? {})).toHaveLength(0)
  } finally { release.resolve(undefined); spy.mockRestore(); await h.close() }
}, 30000)
