import { describe, expect, it } from 'vitest'
import { simulationKnowledgeRequestSchema, simulationKnowledgeQuerySchema, simulationDecisionIdSchema, simulationPolicyRefSchema } from '@clocky/clocky-simulation'
import type { SimulationKnowledge, SimulationSnapshot } from '@clocky/clocky-simulation'
import { assertKnowledgeProjection, selectKnowledge } from '../src/knowledge.ts'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

const belief = (id: string, readers: string[] = []) => simulationKnowledgeRequestSchema.parse({ id, owner: 'a', expectedRevision: 0,
  statement: `private-${id}`, source: { kind: 'belief', profileRevision: 1, policyVersion: '1' },
  observedAt: '0', availableAt: '0', validFrom: '0', validUntil: null, readers })

describe.each(['json', 'sqlite'] as const)('%s knowledge visibility', (backend) => {
  it('preserves versions while revoking historical retrieval and prepared-context access', async () => {
    const h = await createBusinessHarness(backend)
    try {
      await h.actor('a'); const b = await h.actor('b')
      const request = belief('shared', ['b'])
      const first = await h.run.recordKnowledge(request)
      expect(await h.run.recordKnowledge(request)).toEqual(first)
      const query = simulationKnowledgeQuerySchema.parse({ viewer: b.id, cursor: h.run.snapshot().revision, time: '0', limit: 10 })
      expect(h.run.queryKnowledge(query)).toHaveLength(1)
      const id = simulationDecisionIdSchema.parse('read')
      await b.lease.openDecision(id, h.run.snapshot().revision)
      await b.lease.prepareContext(id, { ...contextRequest(), knowledge: { ids: [first.id], required: true } })
      const before = await b.lease.readPreparedContext(id)
      expect(JSON.stringify(before.view)).toContain('private-shared')
      await h.run.recordKnowledge({ ...request, expectedRevision: 1, statement: 'revised', readers: [] })
      expect(h.run.queryKnowledge(query)).toEqual([])
      await expect(b.lease.readPreparedContext(id)).rejects.toThrow(/no longer authorized/)
      await expect(b.lease.submitDecision(id, [])).rejects.toThrow(/no longer authorized/)
      expect(h.run.snapshot().decisions[id]?.context).toEqual(before)
      await expect(h.run.recordKnowledge({ ...request, statement: 'changed retry' })).rejects.toThrow(/changed its version payload/)
      const owner = h.run.queryKnowledge({ ...query, viewer: request.owner })
      expect(owner.map(value => value.statement)).toEqual(['private-shared'])
    } finally { await h.close() }
  })

  it('distinguishes known future plans from unavailable future observations and enforces query budgets', async () => {
    const h = await createBusinessHarness(backend, { maxKnowledgePerQuery: 2 })
    try {
      const a = await h.actor('a'); const b = await h.actor('b')
      await h.run.recordKnowledge({ ...belief('plan'), statement: 'Delivery is planned for time 50' })
      await h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...belief('future'),
        source: { kind: 'observation', worldRevision: h.run.snapshot().revision, visibilityPolicy: '1' },
        statement: 'Delivery observed', observedAt: '50', availableAt: '50', validFrom: '50' }))
      const query = simulationKnowledgeQuerySchema.parse({ viewer: a.id, cursor: h.run.snapshot().revision, time: '0', limit: 2 })
      expect(h.run.queryKnowledge(query).map(value => value.id)).toEqual(['plan'])
      expect(h.run.queryKnowledge({ ...query, viewer: b.id })).toEqual([])
      expect(() => h.run.queryKnowledge({ ...query, limit: 3 })).toThrow(/bound/)
      expect(() => h.run.queryKnowledge({ ...query, time: simulationKnowledgeQuerySchema.parse({ ...query, time: '50' }).time }))
        .toThrow(/time/)
      const id = simulationDecisionIdSchema.parse('future-leak')
      await a.lease.openDecision(id, h.run.snapshot().revision)
      await expect(a.lease.prepareContext(id, { ...contextRequest(), knowledge: {
        ids: [simulationKnowledgeRequestSchema.parse({ ...belief('future') }).id], required: true,
      } })).rejects.toThrow(/unavailable/)
    } finally { await h.close() }
  })

  it('bounds retained records and omits optional knowledge without treating it as an inference premise', async () => {
    const h = await createBusinessHarness(backend, { maxKnowledgeBytes: 2048 })
    try {
      const a = await h.actor('a')
      const item = await h.run.recordKnowledge({ ...belief('large'), statement: 'x'.repeat(1000) })
      await expect(h.run.recordKnowledge({ ...belief('too-large'), statement: 'x'.repeat(5000) })).rejects.toThrow(/byte budget/)
      const optional = simulationDecisionIdSchema.parse('optional')
      await a.lease.openDecision(optional, h.run.snapshot().revision)
      const prepared = await a.lease.prepareContext(optional, { ...contextRequest(512), knowledge: { ids: [item.id], required: false } })
      expect(prepared.status).toBe('prepared')
      if (prepared.status !== 'prepared') throw new Error('fixture required sections overflowed')
      expect(prepared.omitted).toContain('knowledge')
      expect(prepared.knowledge).toBeUndefined()
      await a.lease.submitDecision(optional, [])
      await expect(h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...belief('unseen-inference'), source: {
        kind: 'inference', decisionId: optional, premises: [{ id: item.id, revision: 1 }],
      } }))).rejects.toThrow(/premises/)
      const required = simulationDecisionIdSchema.parse('required')
      await a.lease.openDecision(required, h.run.snapshot().revision)
      expect((await a.lease.prepareContext(required, { ...contextRequest(512), knowledge: { ids: [item.id], required: true } })).status)
        .toBe('overflow')
      expect(h.run.snapshot().stall?.code).toBe('SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW')
    } finally { await h.close() }
  })

  it('keeps confidence as policy data and selects the latest temporally available version', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const a = await h.actor('a'); const b = await h.actor('b')
      const first = simulationKnowledgeRequestSchema.parse({ ...belief('confidence'), source: {
        kind: 'belief', profileRevision: 1, policyVersion: '1', confidence: 0.2,
      } })
      await h.run.recordKnowledge(first)
      await h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...first, expectedRevision: 1, statement: 'Later belief',
        observedAt: '10', availableAt: '10', source: { ...first.source, confidence: 1 } }))
      const query = simulationKnowledgeQuerySchema.parse({ viewer: a.id, cursor: h.run.snapshot().revision, time: '0', limit: 10 })
      expect(h.run.queryKnowledge(query).map(value => value.revision)).toEqual([1])
      expect(h.run.queryKnowledge({ ...query, viewer: b.id })).toEqual([])
      expect(simulationKnowledgeRequestSchema.safeParse({ ...first, source: { ...first.source, confidence: 2 } }).success).toBe(false)
      expect(h.run.snapshot().resources).toEqual({})
      await h.run.drive({ until: simulationKnowledgeQuerySchema.parse({ ...query, time: '10' }).time })
      expect(h.run.queryKnowledge({ ...query, time: h.run.snapshot().time }).map(value => value.revision)).toEqual([2])
    } finally { await h.close() }
  })

  it('prevents inference audiences from laundering inaccessible premises and retains revocation after restart', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const a = await h.actor('a'); const b = await h.actor('b'); const c = await h.actor('c')
      const original = belief('premise', ['b'])
      const premise = await h.run.recordKnowledge(original)
      const id = simulationDecisionIdSchema.parse('derive')
      await b.lease.openDecision(id, h.run.snapshot().revision)
      await b.lease.prepareContext(id, { ...contextRequest(), knowledge: { ids: [premise.id], required: true } })
      const decision = await b.lease.submitDecision(id, [])
      const request = simulationKnowledgeRequestSchema.parse({ ...belief('derived'), owner: b.id, source: { kind: 'inference',
        decisionId: decision.id, premises: [{ id: premise.id, revision: 1 }] } })
      await expect(h.run.recordKnowledge({ ...request, readers: [c.id] })).rejects.toThrow(/cannot access every premise/)
      await h.run.recordKnowledge(request)
      const query = simulationKnowledgeQuerySchema.parse({ viewer: b.id, cursor: h.run.snapshot().revision, time: '0', limit: 10 })
      expect(h.run.queryKnowledge(query)).toHaveLength(2)
      await h.run.recordKnowledge({ ...original, expectedRevision: 1, readers: [] })
      expect(h.run.queryKnowledge(query)).toEqual([])
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(reopened.queryKnowledge({ ...query, viewer: a.id, cursor: reopened.snapshot().revision })).toHaveLength(1)
        expect(reopened.queryKnowledge({ ...query, cursor: reopened.snapshot().revision })).toEqual([])
      } finally { await reopened.close() }
    } finally { await h.close() }
  })
})

it('retrieves deeply chained summaries and still applies ancestor revocation and fixed cutoffs', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const a = await h.actor('a'), b = await h.actor('b')
    const root = await h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...belief('root', ['b']), validUntil: '5' }))
    const id = belief('rollup').id
    const policy = simulationPolicyRefSchema.parse({ id: 'rollup', version: '1' })
    const history: SimulationKnowledge[] = []
    const depth = 12000
    for (let revision = 1; revision <= depth; revision += 1) {
      history.push({ ...root, id, revision, sequence: root.sequence + revision, statement: `Rollup ${revision}`, validUntil: null,
        source: { kind: 'summary', policy, cursor: root.sequence + revision - 1,
          premises: revision === 1 ? [{ id: root.id, revision: 1 }]
            : [{ id, revision: revision - 1 }, { id: root.id, revision: 1 }] } })
    }
    const state: SimulationSnapshot = { ...h.run.snapshot(), revision: root.sequence + depth,
      knowledge: { [root.id]: [root], [id]: history } }
    assertKnowledgeProjection(state)
    const query = simulationKnowledgeQuerySchema.parse({ viewer: b.id, cursor: state.revision, time: '0', limit: 1, ids: [id] })
    expect(selectKnowledge(state, query).map(value => value.revision)).toEqual([depth])
    expect(selectKnowledge(state, { ...query, cursor: state.revision - 1 }).map(value => value.revision)).toEqual([depth - 1])
    const revoked: SimulationSnapshot = { ...state, revision: state.revision + 1,
      knowledge: { ...state.knowledge, [root.id]: [root, { ...root, revision: 2, sequence: state.revision + 1, readers: [] }] } }
    expect(selectKnowledge(revoked, query)).toEqual([])
    expect(selectKnowledge(revoked, { ...query, viewer: a.id }).map(value => value.revision)).toEqual([depth])
    const expired = simulationKnowledgeQuerySchema.parse({ ...query, time: '5' })
    expect(selectKnowledge({ ...state, time: expired.time }, expired)).toEqual([])
  } finally { await h.close() }
})

it('rejects missing or forward premise versions without changing retained knowledge', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    await h.actor('a')
    const root = await h.run.recordKnowledge(belief('root'))
    const request = simulationKnowledgeRequestSchema.parse({ ...belief('summary'), source: {
      kind: 'summary', policy: { id: 'rollup', version: '1' }, cursor: root.sequence, premises: [{ id: root.id, revision: 2 }],
    } })
    const before = h.run.snapshot()
    await expect(h.run.recordKnowledge(request)).rejects.toThrow(/cannot access every premise/)
    expect(h.run.snapshot()).toEqual(before)
    const summary = await h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...request,
      source: { ...request.source, premises: [{ id: root.id, revision: 1 }] } }))
    const invalid: SimulationKnowledge = { ...summary, source: { kind: 'summary', policy: simulationPolicyRefSchema.parse({ id: 'rollup', version: '1' }),
      cursor: root.sequence, premises: [{ id: root.id, revision: 2 }] } }
    const corrupt = (): SimulationSnapshot => ({ ...h.run.snapshot(), knowledge: {
      ...h.run.snapshot().knowledge, [summary.id]: [invalid],
    } })
    expect(() => { assertKnowledgeProjection(corrupt()) }).toThrow(/lost its prior premise version/)
    await h.run.recordKnowledge({ ...belief('root'), expectedRevision: 1, statement: 'Later source' })
    expect(() => { assertKnowledgeProjection(corrupt()) }).toThrow(/lost its prior premise version/)
    expect(() => { assertKnowledgeProjection(h.run.snapshot()) }).not.toThrow()
  } finally { await h.close() }
})
