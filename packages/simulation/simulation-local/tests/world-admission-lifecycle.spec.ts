/** Actual endpoint lifecycle changes revoke fresh World admission without granting authority through profile text. */
import { describe, expect, it } from 'vitest'
import { simulationChangeSchema, simulationDecisionIdSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

describe.each(['json', 'sqlite'] as const)('%s World endpoint admission', (backend) => {
  it.each(['fee-role', 'fee-org', 'fee-vacancy'])('refuses new cases after actual %s termination while retaining exact existing request receipts', async (endpoint) => {
    const h = await hiringResourceHarness(backend, 'generate-and-hire')
    try {
      const plan = await h.plan('original-before-retirement'), original = h.run.snapshot().world!.requests[plan.requestId]!
      const entity = h.run.snapshot().entities[simulationEntityIdSchema.parse(endpoint)]!
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: entity.id, entityRevision: entity.revision,
        phase: 'terminated' }), h.run.snapshot().revision)
      const before = h.run.snapshot()
      await expect(h.propose(h.requester, 'forbidden-new-case', { ...original.proposal, businessKey: 'after-retirement' },
        { kind: 'goal' })).rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
      expect(h.run.snapshot().world).toEqual(before.world)
      expect(h.run.snapshot().operations).toEqual(before.operations)
      await h.connection.cancelDecision(h.requester, simulationDecisionIdSchema.parse('forbidden-new-case'))
      await h.propose(h.requester, 'exact-original-receipt', original.proposal, { kind: 'request', intentId: original.intentId })
      expect(h.run.snapshot().world).toEqual(before.world)
      expect(Object.values(h.run.snapshot().world!.requests)).toEqual([original])
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })

  it('does not let a forged director profile replace an inactive actual operation grant', async () => {
    const h = await hiringResourceHarness(backend, 'generate-and-hire')
    try {
      const plan = await h.plan('before-profile-forgery'), request = h.run.snapshot().world!.requests[plan.requestId]!
      const actor = h.run.snapshot().entities[h.requester]!
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: actor.id, entityRevision: actor.revision,
        profile: { ...actor.profile, role: 'director', director: true, requester: h.director } }), h.run.snapshot().revision)
      const grant = Object.values(h.run.snapshot().relations).find(value => value.relation === 'can-hire')!
      await h.run.change(simulationChangeSchema.parse({ kind: 'relation/update', id: grant.id, relationRevision: grant.revision,
        subject: grant.subject, relation: grant.relation, object: grant.object, scope: grant.scope, validFrom: '1', validUntil: null }),
      h.run.snapshot().revision)
      const before = h.run.snapshot()
      await expect(h.propose(h.requester, 'profile-does-not-authorize', { ...request.proposal, businessKey: 'profile-forgery' },
        { kind: 'goal' })).rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
      expect(h.run.snapshot().world).toEqual(before.world)
      expect(h.run.snapshot().operations).toEqual(before.operations)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })
})
