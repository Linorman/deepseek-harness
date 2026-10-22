/** Current scope access on real Native state; historical content selection cannot restore revoked membership. */
import { describe, expect, it } from 'vitest'
import { simulationWorldFactRequestSchema, simulationNormVersionSchema, simulationChangeSchema,
  simulationWakeRequestSchema, simTimeSchema, projectWorldFacts, projectNorms } from '@clocky/clocky-simulation'
import { governanceBodyHash } from '../src/world-governance.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'

describe.each(['json', 'sqlite'] as const)('%s scope disclosure', (backend) => {
  it.each(['position', 'organization', 'assignment'] as const)('refuses new historical reads after actual %s authority ends', async (ending) => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      const state = h.run.snapshot()
      const fact = await h.run.recordWorldFact(simulationWorldFactRequestSchema.parse({ factId: 'scope-fact', version: '1',
        schemaRef: 'clocky.world-fact/text/1', subject: 'fee-org', scope: 'fee-org', payload: { body: 'SCOPE-FACT-CANARY' },
        effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'scope-members' }, supersedes: null,
        sources: [{ kind: 'run-event', runId: state.spec.runId, sequence: state.world!.sequence }] }))
      const before = h.run.snapshot(), query = { viewer: h.requester, cursor: before.revision, time: before.time, limit: 4 }
      // Norm provenance is tested by its governance owner; this strict fixture isolates the common reader decision.
      const norm = simulationNormVersionSchema.parse({ origin: 'governance', id: 'scope-norm', version: '1',
        schemaRef: 'clocky.world-norm/1', subject: 'fee-org', scope: 'fee-org', body: 'SCOPE-NORM-CANARY',
        bodyHash: governanceBodyHash('SCOPE-NORM-CANARY'), proposal: { id: 'norm-proposal', revision: 1, bodyHash: `sha256:${'1'.repeat(64)}` },
        resolution: { id: 'norm-resolution', hash: `sha256:${'2'.repeat(64)}` }, status: 'enacted', enforcement: { kind: 'advisory' },
        supersedes: null, effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'scope-members' },
        source: { requestId: 'norm-request', planId: 'norm-plan', mutationId: 'norm-mutation', references: [] }, recordedAt: 0, sequence: 1 })
      const withNorm = (snapshot: SimulationSnapshot): SimulationSnapshot => ({ ...snapshot, world: { ...snapshot.world!,
        norms: { ...snapshot.world!.norms, versions: { [norm.id]: [norm] } } } })
      const originalFacts = projectWorldFacts(before, query), originalNorms = projectNorms(withNorm(before), query)
      expect(originalFacts.items).toHaveLength(1); expect(originalNorms.items).toHaveLength(1)
      if (ending === 'assignment') {
        await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'membership-clock', entityId: h.requester,
          time: '5', reason: 'Advance to the current membership boundary' }), h.run.snapshot().revision)
        await h.run.drive({ until: simTimeSchema.parse('5') })
        expect(h.run.snapshot().time).toBe('5')
        const relation = Object.values(h.run.snapshot().relations).find(value => value.subject === h.requester && value.relation === 'assignment')!
        const { revision, ...fields } = relation
        await h.run.change(simulationChangeSchema.parse({ ...fields, kind: 'relation/update', relationRevision: revision, validUntil: '5' }),
          h.run.snapshot().revision)
      } else {
        const endpoint = Object.values(h.run.snapshot().entities).find(value => value.id === (ending === 'position' ? 'fee-role' : 'fee-org'))!
        await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: endpoint.id,
          entityRevision: endpoint.revision, phase: 'inactive' }), h.run.snapshot().revision)
      }
      const after = h.run.snapshot()
      expect(projectWorldFacts(after, { ...query, ids: [fact.factId] })).toMatchObject({ items: [], unknown: [fact.factId] })
      expect(projectNorms(withNorm(after), { ...query, ids: [norm.id] })).toMatchObject({ items: [], unknown: [norm.id] })
      expect(projectWorldFacts(before, query)).toEqual(originalFacts)
      expect(projectNorms(withNorm(before), query)).toEqual(originalNorms)
      await h.connection.close(); await h.run.close()
      const cold = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
      try {
        expect(cold.queryWorldFacts({ ...query, ids: [fact.factId] })).toMatchObject({ items: [], unknown: [fact.factId] })
        expect(h.requests).toHaveLength(0)
      } finally { await cold.close() }
    } finally { await h.close() }
  })
})
