/** Read bodies require independent case/Persona authority and preserve original paginated source identity. */
import { describe, expect, it } from 'vitest'
import { WORLD_HIRING_MARKET_PIN, simulationWorldResultSchema } from '@clocky/clocky-simulation'
import { marketFixture } from '../../simulation-local/tests/world-hiring-market-fixture.ts'
import { projectHiringMarket } from '../../simulation-local/src/world-hiring-market.ts'
import { simulationHiringMarketCommandSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { projectWorldDomain } from '../src/world-read-projection.ts'
import type { WorldReadProjectionPolicy } from '../src/world-read-projection.ts'
import { simulationProductRunIdSchema } from '../src/schema-common.ts'
import { simulationProductWorldDomainInputSchema, retireWorldReadBodies } from '../src/world-read-schema.ts'

describe('hiring market content boundaries', () => {
  it('requires both case and Persona grants for a draft and retires already-read content', async () => {
    const f = marketFixture()
    try {
      const value = projectHiringMarket(f.state, simulationEntityIdSchema.parse('requester'), simulationHiringMarketCommandSchema.parse({
        kind: 'draft', id: 'private-draft', organizationEntityId: 'organization', positionEntityId: 'vacancy', validUntil: '90', expectedRevision: 0,
        body: { templateId: 'original-template', templateVersion: '1', persona: { name: 'New', skills: [], traits: [], goals: [] } } }))
      if (value.kind !== 'persona-draft') throw new Error('Expected original finite draft')
      const result = simulationWorldResultSchema.parse({ id: 'market-result', intentId: f.intent.id, requestId: f.request.id,
        source: { kind: 'plan', planId: f.plan.id }, outcome: { kind: 'committed' }, payload: value, time: '2', sequence: 5 })
      const future = simulationWorldResultSchema.parse({ ...result, id: 'future-review-result', time: '9', sequence: 6,
        payload: { ...value, status: 'reviewed', reviewerId: 'requester', reviewReason: 'Future review.' } })
      const state = { ...f.state, world: { ...f.state.world!, intents: { [f.intent.id]: { ...f.intent, pin: WORLD_HIRING_MARKET_PIN } },
        results: { [result.id]: result, [future.id]: future } } }
      const input = simulationProductWorldDomainInputSchema.parse({
        runId: 'product', kind: 'hiring-market', family: 'persona-draft' })
      const read = (cases: boolean, persona: boolean, at = '2') => {
        const policy: WorldReadProjectionPolicy = { runId: simulationProductRunIdSchema.parse('product'), at, limit: 1,
          text: text => ({ text, truncated: false }), context: () => false, case: () => cases, persona: () => persona,
          resident: () => false,
          page: (items, scope) => ({ items: items.slice(0, 1), coverage: { loaded: Math.min(1, items.length), total: items.length,
            revision: state.revision, scope, complete: items.length <= 1 } }) }
        return projectWorldDomain(state, input, policy)
      }
      for (const grants of [[false, false], [true, false], [false, true]] as const) {
        expect(JSON.stringify(read(grants[0], grants[1]))).not.toContain('original-template')
        expect(JSON.stringify(read(grants[0], grants[1]))).toContain('withheld')
      }
      const allowed = read(true, true)
      expect(JSON.stringify(allowed)).toContain('original-template')
      expect(JSON.stringify(retireWorldReadBodies(allowed))).not.toContain('original-template')
      expect(allowed.coverage).toMatchObject({ loaded: 1, total: 1, scope: 'hiring-market/persona-draft' })
      expect(JSON.stringify(allowed)).toContain('\"current\":true')
      const later = read(true, true, '9')
      expect(later.coverage).toMatchObject({ loaded: 1, total: 2, complete: false })
      expect(JSON.stringify(later)).toContain('\"current\":false')
    } finally { await f.close() }
  })
})
