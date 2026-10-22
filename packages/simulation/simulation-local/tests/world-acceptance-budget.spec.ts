import { worldDecisionSource } from '@clocky/clocky-simulation'
/** Complete accepted Native batches, measured at the actual storage append boundary. */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { LogStream } from '@clocky/clocky-storage'
import { budgetUsage, simulationDecisionIdSchema, simulationWindowRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationOperationAction } from '@clocky/clocky-simulation'
import { contextRequest } from './context-fixture.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

type ObservedValue = {
  kind: string
  expectedRevision: number
  change: { kind: string; id?: string; action?: SimulationOperationAction }
}
const description = '请为团队招聘同事。🧪'.repeat(12)
function observe(stream: LogStream, decision: string, reject = false) {
  const append = stream.append.bind(stream)
  const captured: unknown[][] = []
  const spy = vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
    if ((args[1] as readonly ObservedValue[]).some(value => value.kind === 'run/business'
      && value.change.kind === 'decision/accepted' && value.change.id === decision)) {
      captured.push([...args[1]])
      if (reject) throw new Error('Acceptance append refused')
    }
    return await append(...args)
  })
  return { spy, captured }
}

describe.each(['json', 'sqlite'] as const)('%s complete World acceptance', (backend) => {
  describe.each(['request', 'resolve'] as const)('%s byte boundary', (stage) => {
    let bytes = 0
    beforeAll(async () => {
      const h = await hiringResourceHarness(backend, 'hire-existing', { description })
      try {
        const tap = observe(Reflect.get(h.run, 'stream') as LogStream, `boundary/${stage}`)
        await h.plan('boundary')
        expect(tap.captured).toHaveLength(1)
        const batch = tap.captured[0]!, internal = (batch as ObservedValue[])
          .filter(value => value.kind === 'run/business').map(value => value.change)
        bytes = Buffer.byteLength(JSON.stringify(batch), 'utf8')
        expect(bytes).toBeGreaterThan(Buffer.byteLength(JSON.stringify(internal), 'utf8'))
        expect(bytes).toBeGreaterThan(JSON.stringify(batch).length)
        expect((batch as ObservedValue[]).some(value => value.kind === 'run/scheduler')).toBe(stage === 'request')
        tap.spy.mockRestore()
      } finally { await h.close() }
    })
    it.each([0, -1])('uses complete UTF-8 bytes with boundary offset %i', async (offset) => {
      const h = await hiringResourceHarness(backend, 'hire-existing', { description,
        ...stage === 'request' ? { requestBytes: bytes + offset } : { planBytes: bytes + offset } })
      try {
        const tap = observe(Reflect.get(h.run, 'stream') as LogStream, `boundary/${stage}`)
        if (offset === 0) {
          await h.plan('boundary')
          expect(tap.captured).toHaveLength(1)
          expect(Buffer.byteLength(JSON.stringify(tap.captured[0]), 'utf8')).toBe(bytes)
          const state = h.run.snapshot(), request = Object.values(state.world!.requests)[0]!
          const decision = state.decisions[worldDecisionSource(request).decisionId]!
          expect(decision.worldExpansion).toEqual({ logicalIndex: 0, operationIds: decision.operationIds })
          expect(decision.operationIds).toHaveLength(2)
          expect(request.operationId).toBe(decision.operationIds[0])
          expect(request.notificationOperationId).toBe(decision.operationIds[1])
          expect(state.operations[request.notificationOperationId!]!.dependencies).toEqual([request.operationId])
          expect(budgetUsage(state).messages.used).toBe(1)
        } else {
          await expect(h.plan('boundary')).rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT',
            failure: { code: 'SIM_WORLD_LIMIT', limit: 'bytes' } })
          expect(tap.captured).toEqual([])
          expect(Object.keys(h.run.snapshot().world!.requests)).toHaveLength(stage === 'request' ? 0 : 1)
          expect(Object.keys(h.run.snapshot().operations)).toHaveLength(stage === 'request' ? 0 : 2)
          expect(h.run.snapshot().world!.plans).toEqual({})
          expect(budgetUsage(h.run.snapshot()).messages.used).toBe(stage === 'request' ? 0 : 1)
        }
        tap.spy.mockRestore()
      } finally { await h.close() }
    })
  })

  it('an append refusal publishes neither request nor notification and exact retry retains one mapping', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { description })
    try {
      const tap = observe(Reflect.get(h.run, 'stream') as LogStream, 'atomic/request', true)
      await expect(h.plan('atomic')).rejects.toThrow('Acceptance append refused')
      expect(tap.captured).toHaveLength(1)
      const values = tap.captured[0] as ObservedValue[], request = values.find(value => value.change.action?.kind === 'world/request')!
      expect(h.run.snapshot().world!.requests).toEqual({})
      expect(h.run.snapshot().operations).toEqual({})
      expect(budgetUsage(h.run.snapshot()).messages.used).toBe(0)
      tap.spy.mockRestore()
      const id = simulationDecisionIdSchema.parse('atomic/request'), proposals = [{ after: [], action: request.change.action! }]
      const accepted = await h.connection.submitDecision(h.requester, id, proposals)
      expect(accepted.status).toBe('accepted')
      const state = h.run.snapshot()
      expect(await h.connection.submitDecision(h.requester, id, proposals)).toEqual(accepted)
      expect(h.run.snapshot()).toEqual(state)
      expect(Object.keys(state.world!.requests)).toHaveLength(1)
      expect(Object.keys(state.operations)).toHaveLength(2)
      expect(budgetUsage(state).messages.used).toBe(1)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })

  describe('window acceptance', () => {
    let bytes = 0
    const prepare = async (requestBytes?: number) => {
      const h = await hiringResourceHarness(backend, 'hire-existing', { description, ...requestBytes === undefined ? {} : { requestBytes } })
      const id = simulationDecisionIdSchema.parse('window-request')
      const window = await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'byte-window', decisions: [{
        id, entityId: h.requester, context: { ...contextRequest(), world: { kind: 'goal' } },
      }] }), h.run.snapshot().revision)
      await expect(h.propose(h.requester, id, { kind: 'world/request', domain: 'organization', operation: 'hire-existing',
        version: '1', businessKey: 'window-case', expectedTime: null, evidence: [],
        payload: { organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy', personId: h.candidate, description } },
      { kind: 'goal' })).rejects.toThrow('Original hiring proposal was not accepted')
      expect(h.run.snapshot().decisions[id]!.status).toBe('submitted')
      expect(h.run.snapshot().world!.requests).toEqual({})
      return { ...h, window, id }
    }
    beforeAll(async () => {
      const h = await prepare()
      try {
        const tap = observe(Reflect.get(h.run, 'stream') as LogStream, h.id)
        await h.run.commitWindow(h.window.id)
        expect(tap.captured).toHaveLength(1)
        bytes = Buffer.byteLength(JSON.stringify(tap.captured[0]), 'utf8')
        expect((tap.captured[0] as ObservedValue[]).some(value => value.change.kind === 'decision/submitted')).toBe(false)
        tap.spy.mockRestore()
      } finally { await h.close() }
    })
    it.each([0, -1])('checks the final window batch at byte offset %i', async (offset) => {
      const h = await prepare(bytes + offset)
      try {
        if (offset === 0) {
          expect((await h.run.commitWindow(h.window.id)).status).toBe('closed')
          expect(Object.keys(h.run.snapshot().world!.requests)).toHaveLength(1)
          expect(Object.keys(h.run.snapshot().operations)).toHaveLength(2)
        } else {
          const before = h.run.snapshot()
          await expect(h.run.commitWindow(h.window.id)).rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT',
            failure: { code: 'SIM_WORLD_LIMIT', limit: 'bytes' } })
          expect(h.run.snapshot()).toEqual(before)
        }
      } finally { await h.close() }
    })
  })

  it.each([{ operationLimit: 1 }, { messageLimit: 0 }])('counts expanded operations and messages before admission: %j', async (limits) => {
    const h = await hiringResourceHarness(backend, 'hire-existing', limits)
    try {
      await expect(h.plan('expanded')).rejects.toThrow()
      expect(h.run.snapshot().world!.requests).toEqual({})
      expect(h.run.snapshot().operations).toEqual({})
      expect(budgetUsage(h.run.snapshot()).messages.used).toBe(0)
    } finally { await h.close() }
  })
})
