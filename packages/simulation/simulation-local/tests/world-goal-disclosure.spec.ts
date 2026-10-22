/** Domain goal material must use the same current target authority as Native request admission. */
import { describe, expect, it } from 'vitest'
import { simulationEntityIdSchema, simulationRelationIdSchema, simulationHiringFeePolicySchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { OrganizationNativeWorldDomain } from '../src/world-organization.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

describe.each(['json', 'sqlite'] as const)('%s hiring goal disclosure', (backend) => {
  it('keeps a live target while withholding every invalid target fee from the same operation', async () => {
    const h = await hiringResourceHarness(backend, 'generate-and-hire')
    try {
      const original = h.run.snapshot(), world = original.world!, domain = new OrganizationNativeWorldDomain()
      const grant = world.definition.operationGrants[0]!, relation = original.relations[grant.relationId]!
      const id = simulationEntityIdSchema.parse('private-vacancy'), permission = simulationRelationIdSchema.parse('private-permission')
      const fee = simulationHiringFeePolicySchema.parse({ ...world.definition.hiringFees![0]!, id: 'PRIVATE-TARGET-FEE-CANARY', positionEntityId: id })
      const state: SimulationSnapshot = { ...original, time: simTimeSchema.parse('5'), entities: { ...original.entities,
        [id]: { ...original.entities[grant.targetEntityId]!, id } }, relations: { ...original.relations,
        [permission]: { ...relation, id: permission, object: id } }, world: { ...world, definition: { ...world.definition,
        operationGrants: [...world.definition.operationGrants, { ...grant, relationId: permission, targetEntityId: id }],
        hiringFees: [...world.definition.hiringFees!, fee] } } }
      expect(domain.goalContext(state, h.requester)).toEqual({ hiringFees: world.definition.hiringFees!.concat(fee) })
      for (const denied of [
        { ...state, relations: { ...state.relations, [permission]: { ...state.relations[permission]!, validUntil: state.time } } },
        { ...state, relations: { ...state.relations, [permission]: { ...state.relations[permission]!, validFrom: simTimeSchema.parse('6') } } },
        { ...state, relations: { ...state.relations, [permission]: { ...state.relations[permission]!, object: grant.targetEntityId } } },
        { ...state, entities: { ...state.entities, [id]: { ...state.entities[id]!, phase: 'inactive' as const } } },
      ]) {
        expect(domain.goalContext(denied, h.requester)).toEqual({ hiringFees: world.definition.hiringFees })
        expect(JSON.stringify(domain.goalContext(denied, h.requester))).not.toContain(fee.id)
      }
      for (const endpoint of [h.requester, grant.scopeEntityId]) {
        expect(domain.goalContext({ ...state, entities: { ...state.entities,
          [endpoint]: { ...state.entities[endpoint]!, phase: 'inactive' } } }, h.requester)).toEqual({ hiringFees: [] })
      }
      for (const rule of [undefined, { ...state.spec.relationRules.find(value => value.relation === 'can-hire')!,
        objectKinds: ['organization'] }]) {
        const relationRules = state.spec.relationRules.filter(value => value.relation !== 'can-hire')
        expect(domain.goalContext({ ...state, spec: { ...state.spec,
          relationRules: [...relationRules, ...rule === undefined ? [] : [rule]] } }, h.requester)).toEqual({ hiringFees: [] })
      }
      expect(h.run.snapshot()).toEqual(original)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })
})
