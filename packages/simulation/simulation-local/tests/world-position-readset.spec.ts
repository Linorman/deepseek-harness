/** A real occupied hiring position invalidates its accepted reads without reclassifying independent World quotas. */
import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { simulationChangeSchema, SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationWorldLimit } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { worldPlanStaleReason } from '../src/world.ts'
import type { NativeWorldRuntime } from '../src/world-runtime.ts'

describe.each(['json', 'sqlite'] as const)('%s occupied position reads', (backend) => {
  it('retains its exact accepted plan as stale when a later real assignment consumes its sole vacancy', async () => {
    const evidence = resolve('.local/world-completion/thread-01a1336a-readset/position')
    await mkdir(evidence, { recursive: true }); const output = await mkdtemp(resolve(evidence, `${backend}-`))
    const h = await hiringResourceHarness(backend, 'hire-existing', { capacity: 1 })
    try {
      const plan = await h.plan('original-vacancy'), prepared = h.run.snapshot()
      const runtime = Reflect.get(h.run, 'worldRuntime') as NativeWorldRuntime
      expect(worldPlanStaleReason(prepared, plan, runtime)).toBeUndefined()
      await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'later-vacancy-occupant',
        subject: h.director, relation: 'assignment', object: 'fee-vacancy', scope: 'fee-org', validFrom: '0', validUntil: null }),
      h.run.snapshot().revision)
      const occupied = h.run.snapshot()
      expect(occupied.world!.plans[plan.id]).toEqual(plan)
      expect(worldPlanStaleReason(occupied, plan, runtime)).toBe('read-set-changed')
      await expect(h.run.reserveExistingHireResources(plan.id)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      const stale = h.run.snapshot(), retained = stale.world!.plans[plan.id]!
      expect(retained).toMatchObject({ status: 'stale', stale: { phase: 'execution', reason: 'read-set-changed' } })
      const { status: _status, stale: _stale, ...retainedInput } = retained
      const { status: _originalStatus, ...originalInput } = plan
      expect(retainedInput).toEqual(originalInput)
      expect(stale.resourceReservations).toEqual(occupied.resourceReservations)
      expect(stale.resources).toEqual(occupied.resources)
      expect(stale.world!.requests).toEqual(occupied.world!.requests)
      expect(stale.world!.results).toEqual({})
      await h.connection.close()
      const original = h.run.snapshot()
      await writeFile(resolve(output, 'original.json'), JSON.stringify({ prepared, occupied, original }, null, 2) + '\n')
      await h.run.close()
      const cold = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
      try {
        expect(cold.snapshot().world).toEqual(original.world)
        expect(cold.snapshot().relations).toEqual(original.relations)
        expect(cold.snapshot().resourceReservations).toEqual(original.resourceReservations)
        expect(h.requests).toHaveLength(0)
        await writeFile(resolve(output, 'reopened.json'), JSON.stringify(cold.snapshot(), null, 2) + '\n')
      } finally { await cold.close() }
    } finally { await h.close() }
  })

  it('marks a second real case stale when the same candidate is retained by another hiring hold', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { capacity: 2, balance: '20' })
    try {
      const first = await h.plan('first-candidate-case'), second = await h.plan('second-candidate-case')
      const runtime = Reflect.get(h.run, 'worldRuntime') as NativeWorldRuntime
      await h.reserve(first)
      const held = h.run.snapshot(), request = held.world!.requests[second.requestId]!
      const intent = held.world!.intents[request.intentId]!
      expect(() => runtime.original(second.pin).admitRequest(held, h.requester, request.proposal, intent))
        .toThrow('Existing person has another original uncommitted hiring reservation')
      expect(worldPlanStaleReason(held, second, runtime)).toBe('read-set-changed')
      await expect(h.run.reserveExistingHireResources(second.id)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      const state = h.run.snapshot()
      expect(state.world!.plans[second.id]).toMatchObject({ status: 'stale',
        stale: { phase: 'execution', reason: 'read-set-changed' } })
      expect(state.world!.plans[first.id]).toEqual(first)
      expect(state.world!.plans[second.id]!.proposal).toEqual(second.proposal)
      expect(state.world!.plans[second.id]!.reads).toEqual(second.reads)
      expect(state.resourceReservations).toEqual(held.resourceReservations)
      expect(state.resources).toEqual(held.resources)
      expect(state.relations).toEqual(held.relations)
      expect(state.world!.results).toEqual({})
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })

  it('preserves each non-position quota failure from the original domain instead of recording stale reads', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      const plan = await h.plan('unchanged-quota'), state = h.run.snapshot()
      const runtime = Reflect.get(h.run, 'worldRuntime') as NativeWorldRuntime
      const domain = runtime.original(plan.pin)
      const limits: readonly SimulationWorldLimit[] = ['entities', 'participants', 'channels', 'bytes', 'requests', 'commands',
        'plans', 'births', 'expansions', 'mutations']
      for (const limit of limits) {
        const failure = new SimulationWorldError('SIM_WORLD_LIMIT', `Original ${limit} refusal`, limit)
        const refuse = vi.spyOn(domain, 'admitRequest').mockImplementation(() => { throw failure })
        try {
          let observed: unknown
          try { observed = worldPlanStaleReason(state, plan, runtime) }
          catch (error) { observed = error }
          expect(observed).toBe(failure)
        } finally { refuse.mockRestore() }
      }
      expect(h.run.snapshot()).toEqual(state)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })
})
