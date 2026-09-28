/** Knowledge writes and bounded reads reject invalid ownership, provenance and temporal positions. */
import { describe, expect, it } from 'vitest'
import { simulationChangeSchema, simulationKnowledgeRequestSchema, simulationKnowledgeQuerySchema,
  simulationDecisionIdSchema, simulationEntityIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { assertKnowledgeProjection } from '../src/knowledge.ts'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

const request = (id = 'source') => simulationKnowledgeRequestSchema.parse({ id, owner: 'a', expectedRevision: 0,
  statement: 'Known source', source: { kind: 'belief', profileRevision: 1, policyVersion: '1' },
  observedAt: '0', availableAt: '0', validFrom: '0', validUntil: null, readers: ['b'] })

describe.each(['json', 'sqlite'] as const)('%s knowledge admission', (backend) => {
  it('bounds authorized results in identity order and respects explicit empty, duplicate and missing selections', async () => {
    const h = await createBusinessHarness(backend)
    try {
      await h.actor('a'); const b = await h.actor('b')
      const query = simulationKnowledgeQuerySchema.parse({ viewer: b.id, cursor: h.run.snapshot().revision, time: '0', limit: 1 })
      expect(h.run.queryKnowledge(query)).toEqual([])
      await h.run.recordKnowledge({ ...request('a-hidden'), readers: [] })
      const second = await h.run.recordKnowledge(request('c-last'))
      const first = await h.run.recordKnowledge(request('b-first'))
      query.cursor = h.run.snapshot().revision
      expect(h.run.queryKnowledge(query).map(value => value.id)).toEqual([first.id])
      expect(h.run.queryKnowledge({ ...query, ids: [] })).toEqual([])
      const ids = [second.id, first.id, second.id, request('constructor').id]
      expect(h.run.queryKnowledge({ ...query, ids, limit: 2 }).map(value => value.id)).toEqual([first.id, second.id])
      const [detached] = h.run.queryKnowledge({ ...query, ids: [second.id] })
      expect(detached).toBeDefined()
      detached!.statement = 'Caller mutation'
      expect(h.run.queryKnowledge({ ...query, ids: [second.id] })[0]?.statement).toBe('Known source')
      await h.run.recordKnowledge({ ...request('c-last'), expectedRevision: 1, statement: 'Temporary version', validUntil: simTimeSchema.parse('1') })
      await h.run.drive({ until: simTimeSchema.parse('1') })
      expect(h.run.queryKnowledge({ ...query, cursor: h.run.snapshot().revision, time: simTimeSchema.parse('1'), ids: [second.id] })[0]?.revision).toBe(1)
      expect(() => h.run.queryKnowledge({ ...query, cursor: h.run.snapshot().revision + 1 })).toThrow(/bound/)
      expect(() => h.run.queryKnowledge({ ...query, viewer: simulationEntityIdSchema.parse('missing') })).toThrow(/bound/)
    } finally { await h.close() }
  })

  it('rejects ownership, audience, version and temporal changes before recording any version', async () => {
    const h = await createBusinessHarness(backend)
    try {
      await h.actor('a'); await h.actor('b')
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'inactive', entityKind: 'person', cognition: 'none', profile: {} }), h.run.snapshot().revision)
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: 'inactive', entityRevision: 1, phase: 'inactive' }), h.run.snapshot().revision)
      const first = await h.run.recordKnowledge(request())
      const before = h.run.snapshot()
      const invalid = [
        { ...request(), expectedRevision: 2 },
        { ...request(), expectedRevision: 1, owner: 'b' },
        { ...request(), expectedRevision: 1, source: { kind: 'observation', worldRevision: first.sequence, visibilityPolicy: '1' } },
        { ...request('invalid'), owner: 'inactive' }, { ...request('invalid'), readers: ['inactive'] },
        { ...request('invalid'), readers: ['missing'] }, { ...request('invalid'), observedAt: '1' },
        { ...request('invalid'), validUntil: '0' }, { ...request('invalid'), availableAt: '101' },
      ]
      for (const value of invalid) {
        await expect(h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse(value))).rejects.toThrow(/invalid/)
        expect(h.run.snapshot()).toEqual(before)
      }
      expect(simulationKnowledgeRequestSchema.safeParse({ ...request(), source: { kind: 'unknown' } }).success).toBe(false)
    } finally { await h.close() }
  })

  it('requires authoritative observation, belief and report origins', async () => {
    const h = await createBusinessHarness(backend)
    try {
      await h.actor('a'); await h.actor('b')
      const before = h.run.snapshot()
      for (const source of [
        { kind: 'observation', worldRevision: before.revision + 1, visibilityPolicy: '1' },
        { kind: 'observation', worldRevision: before.revision, visibilityPolicy: 'other' },
        { kind: 'belief', profileRevision: 2, policyVersion: '1' }, { kind: 'belief', profileRevision: 1, policyVersion: 'other' },
        { kind: 'report', operationId: 'missing' },
      ]) {
        await expect(h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...request(), source }))).rejects.toThrow()
        expect(h.run.snapshot()).toEqual(before)
      }
    } finally { await h.close() }
  })

  it('requires bounded distinct summary premises and the exact accepted inference selection', async () => {
    const h = await createBusinessHarness(backend, { maxKnowledgePerQuery: 1 })
    try {
      const a = await h.actor('a'); await h.actor('b')
      const root = await h.run.recordKnowledge(request())
      const refs = [{ id: root.id, revision: 1 }]
      const source = { kind: 'summary', policy: { id: 'extract', version: '1' }, cursor: root.sequence, premises: refs }
      for (const patch of [
        { source: { ...source, cursor: root.sequence + 1 } },
        { source, observedAt: '1', availableAt: '1' },
        { source: { ...source, premises: [...refs, { id: 'other', revision: 1 }] } },
        { source: { ...source, premises: [...refs, ...refs] } },
      ]) await expect(h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...request('derived'), ...patch }))).rejects.toThrow(/bounded fixed-cursor/)
      const id = simulationDecisionIdSchema.parse('inference')
      await a.lease.openDecision(id, h.run.snapshot().revision)
      const inference = { kind: 'inference', decisionId: id, premises: refs }
      await expect(h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...request('derived'), source: inference }))).rejects.toThrow(/accepted owner decision/)
      await a.lease.prepareContext(id, { ...contextRequest(), knowledge: { ids: [root.id], required: true } })
      await a.lease.submitDecision(id, [])
      for (const patch of [
        { owner: 'b' }, { observedAt: '1', availableAt: '1' },
        { source: { ...inference, premises: [...refs, ...refs] } },
        { source: { ...inference, premises: [{ id: root.id, revision: 2 }] } },
      ]) await expect(h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...request('derived'), source: inference, ...patch }))).rejects.toThrow(/accepted owner decision/)
      expect((await h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...request('derived'), source: inference }))).source.kind).toBe('inference')
    } finally { await h.close() }
  })

  it('rejects inconsistent retained version identity and ordering', async () => {
    const h = await createBusinessHarness(backend)
    try {
      await h.actor('a'); await h.actor('b')
      const first = await h.run.recordKnowledge(request())
      const second = await h.run.recordKnowledge({ ...request(), expectedRevision: 1, statement: 'Revision two' })
      const state = h.run.snapshot()
      expect(() => { assertKnowledgeProjection({ ...state, knowledge: { [first.id]: [] } }) }).toThrow(/empty/)
      for (const changed of [{ ...second, id: request('foreign').id }, { ...second, revision: 3 },
        { ...second, sequence: first.sequence }, { ...second, sequence: state.revision + 1 },
        { ...second, owner: simulationEntityIdSchema.parse('b') },
        { ...second, source: { kind: 'observation' as const, worldRevision: first.sequence, visibilityPolicy: '1' } }]) {
        expect(() => { assertKnowledgeProjection({ ...state, knowledge: { [first.id]: [first, changed] } }) }).toThrow(/inconsistent/)
      }
    } finally { await h.close() }
  })
})
