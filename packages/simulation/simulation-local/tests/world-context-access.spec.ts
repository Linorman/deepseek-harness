/** Real Native preparation must not inject revoked scope material into Session or a provider request. */
import { describe, expect, it, vi } from 'vitest'
import { simulationChangeSchema, simulationDecisionIdSchema, simulationWorldFactRequestSchema,
  simulationWakeRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { contextRequest } from './context-fixture.ts'
import { SimulationModelCapacity } from '../../simulation-team/src/model-capacity.ts'

type Harness = Awaited<ReturnType<typeof hiringResourceHarness>>
const canary = 'PRIVATE-PREPARED-SCOPE-ACCESS-CANARY'
async function publish(h: Harness) {
  const state = h.run.snapshot()
  await h.run.recordWorldFact(simulationWorldFactRequestSchema.parse({ factId: 'private-scope-context', version: '1',
    schemaRef: 'clocky.world-fact/text/1', subject: 'fee-org', scope: 'fee-org', payload: { body: canary },
    effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'scope-members' }, supersedes: null,
    sources: [{ kind: 'run-event', runId: state.spec.runId, sequence: state.world!.sequence }] }))
  await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'scope-test-clock', entityId: h.director,
    time: '5', reason: 'Reach a nonzero assignment boundary' }), h.run.snapshot().revision)
  await h.run.drive({ until: simTimeSchema.parse('5') })
  expect(h.run.snapshot().time).toBe('5')
}
async function revoke(h: Harness, endpoint: 'position' | 'organization' | 'assignment') {
  const state = h.run.snapshot()
  if (endpoint === 'assignment') {
    const relation = Object.values(state.relations).find(value => value.subject === h.requester && value.relation === 'assignment')!
    const { revision, ...fields } = relation
    await h.run.change(simulationChangeSchema.parse({ ...fields, kind: 'relation/update', relationRevision: revision,
      validUntil: state.time }), state.revision)
  } else {
    const entity = Object.values(state.entities).find(value => value.id === (endpoint === 'position' ? 'fee-role' : 'fee-org'))!
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: entity.id,
      entityRevision: entity.revision, phase: 'inactive' }), state.revision)
  }
}
function session(h: Harness) {
  const sessionId = h.run.snapshot().entities[h.requester]?.binding?.sessionId
  if (sessionId === undefined) throw new Error('Requester lost its canonical Session')
  const agent = h.ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error('Requester has no original Agent')
  return agent.session
}

describe.each(['json', 'sqlite'] as const)('%s prepared scope access', (backend) => {
  it.each(['position', 'organization', 'assignment'] as const)(
    'rejects retry and dispatch after %s revocation without changing viewer revision or exposing prepared text', async (endpoint) => {
      const h = await hiringResourceHarness(backend, 'hire-existing')
      try {
        await publish(h)
        const id = simulationDecisionIdSchema.parse(`prepared-${endpoint}`)
        const request = { ...contextRequest(), world: { kind: 'goal' as const } }
        await h.connection.openDecision(h.requester, id)
        const prepared = await h.connection.prepareContext(h.requester, id, request)
        expect(prepared.status).toBe('prepared')
        expect(JSON.stringify(prepared)).toContain(canary)
        const original = structuredClone(prepared), revision = h.run.snapshot().entities[h.requester]!.revision
        expect(JSON.stringify(session(h).events)).not.toContain(canary)
        await revoke(h, endpoint)
        expect(h.run.snapshot().entities[h.requester]!.revision).toBe(revision)
        await expect(h.connection.prepareContext(h.requester, id, request)).rejects.toThrow()
        await expect(h.connection.executeDecision(h.requester, id, request)).rejects.toThrow()
        expect(h.run.snapshot().decisions[id]?.context).toEqual(original)
        expect(h.requests).toHaveLength(0)
        expect(JSON.stringify(session(h).events)).not.toContain(canary)
      } finally { await h.close() }
    })

  it('refuses a prepared goal after its operation grant expires while scope membership stays live', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      await publish(h)
      const id = simulationDecisionIdSchema.parse('prepared-grant-revoked')
      const request = { ...contextRequest(), world: { kind: 'goal' as const } }
      await h.connection.openDecision(h.requester, id)
      const prepared = await h.connection.prepareContext(h.requester, id, request)
      const relation = Object.values(h.run.snapshot().relations).find(value => value.subject === h.requester && value.relation === 'can-hire')!
      const { revision, ...fields } = relation
      await h.run.change(simulationChangeSchema.parse({ ...fields, kind: 'relation/update', relationRevision: revision,
        validUntil: h.run.snapshot().time }), h.run.snapshot().revision)
      expect(h.run.queryWorldFacts({ viewer: h.requester, time: h.run.snapshot().time,
        cursor: h.run.snapshot().revision, limit: 4 }).items).toHaveLength(1)
      await expect(h.connection.prepareContext(h.requester, id, request)).rejects.toThrow(/goal authority/)
      await expect(h.connection.executeDecision(h.requester, id, request)).rejects.toThrow(/goal authority/)
      expect(h.run.snapshot().decisions[id]?.context).toEqual(prepared)
      expect(h.requests).toHaveLength(0)
      expect(JSON.stringify(session(h).events)).not.toContain(canary)
    } finally { await h.close() }
  })

  it.each(['position', 'organization'] as const)(
    'does not append prepared scope text after a downstream pre-step wait loses %s access', async (endpoint) => {
      const h = await hiringResourceHarness(backend, 'hire-existing')
      const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      let work: Promise<unknown> | undefined, remove: (() => void) | undefined
      try {
        await publish(h)
        const id = simulationDecisionIdSchema.parse(`prestep-scope-${endpoint}`)
        const request = { ...contextRequest(), world: { kind: 'goal' as const } }
        await h.connection.openDecision(h.requester, id)
        const prepared = await h.connection.prepareContext(h.requester, id, request)
        expect(JSON.stringify(prepared)).toContain(canary)
        const targetSession = session(h)
        // Default-order listener runs inside the Simulation owner's awaited next(), after its initial Native access read.
        remove = h.ctx.on('agent/pre-step', async ({ agent }, next) => {
          if (agent.session !== targetSession) return await next()
          entered.resolve(undefined)
          await release.promise
          return await next()
        })
        work = h.connection.executeDecision(h.requester, id, request).catch((error: unknown) => error)
        await Promise.race([entered.promise, work.then(() => { throw new Error('Decision ended before the downstream pre-step barrier') })])
        expect(JSON.stringify(targetSession.events)).not.toContain(canary)
        const revision = h.run.snapshot().entities[h.requester]!.revision
        await revoke(h, endpoint)
        expect(h.run.snapshot().entities[h.requester]!.revision).toBe(revision)
        release.resolve(undefined)
        expect(await work).toBeInstanceOf(Error)
        expect(h.requests).toHaveLength(0)
        expect(JSON.stringify(targetSession.events)).not.toContain(canary)
        expect(h.run.snapshot().decisions[id]?.context).toEqual(prepared)
      } finally {
        release.resolve(undefined)
        if (work !== undefined) await work
        remove?.()
        await h.close()
      }
    })

  it('rechecks current scope after a real model-pool wait and releases capacity without dispatch', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    const releases: Array<() => void> = []
    // oxlint-disable-next-line typescript/unbound-method -- Every invocation below supplies the original pool receiver through .call(this).
    const acquire = SimulationModelCapacity.prototype.acquire
    let occupied = false
    const spy = vi.spyOn(SimulationModelCapacity.prototype, 'acquire').mockImplementation(async function (
      this: SimulationModelCapacity, signal?: AbortSignal,
    ) {
      if (!occupied) {
        occupied = true
        // Occupy actual FIFO permits without dispatching unrelated provider work; the target joins the real bounded queue.
        releases.push(...await Promise.all(Array.from({ length: this.snapshot().limit }, () => acquire.call(this))))
      }
      return acquire.call(this, signal)
    })
    let work: Promise<unknown> | undefined
    try {
      await publish(h)
      const id = simulationDecisionIdSchema.parse('queued-scope-access')
      const request = { ...contextRequest(), world: { kind: 'goal' as const } }
      work = h.connection.executeDecision(h.requester, id, request).catch((error: unknown) => error)
      await expect.poll(() => h.ctx.simulationTeams.modelUsage().queued).toBe(1)
      const history = structuredClone(session(h).events), context = structuredClone(h.run.snapshot().decisions[id]?.context)
      expect(JSON.stringify(history)).toContain(canary)
      const revision = h.run.snapshot().entities[h.requester]!.revision
      await revoke(h, 'assignment')
      expect(h.run.snapshot().entities[h.requester]!.revision).toBe(revision)
      for (const release of releases.splice(0)) release()
      expect(await work).toBeInstanceOf(Error)
      expect(h.requests).toHaveLength(0)
      expect(h.ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
      expect(h.run.snapshot().decisions[id]?.context).toEqual(context)
      expect(session(h).events.slice(0, history.length)).toEqual(history)
    } finally {
      occupied = true
      for (const release of releases.splice(0)) release()
      if (work !== undefined) await work
      spy.mockRestore()
      await h.close()
    }
  })

  it('preserves previously consumed Session history when current scope membership is revoked', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      await publish(h)
      await h.propose(h.requester, 'already-consumed-scope', undefined, { kind: 'goal' })
      const before = structuredClone(session(h).events)
      expect(JSON.stringify(before)).toContain(canary)
      const revision = h.run.snapshot().entities[h.requester]!.revision
      await revoke(h, 'assignment')
      expect(h.run.snapshot().entities[h.requester]!.revision).toBe(revision)
      expect(session(h).events).toEqual(before)
      expect(h.requests).toHaveLength(0)
      expect(h.run.queryWorldFacts({ viewer: h.requester, cursor: h.run.snapshot().revision,
        time: h.run.snapshot().time, limit: 1 }).items).toEqual([])
    } finally { await h.close() }
  })
})
