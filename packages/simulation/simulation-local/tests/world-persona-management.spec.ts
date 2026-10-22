/** Authenticated users review finite drafts without fabricating an actor Decision, Session or hiring acceptance. */
import { describe, expect, it } from 'vitest'
import { WORLD_HIRING_MARKET_PIN, hiringMarket, simulationWorldManagementActionSchema,
  simulationWorldManagementSubmitRequestSchema, simulationWorldAuthenticatedUserSourceSchema } from '@clocky/clocky-simulation'
import type { SimulationWorldManagementAction, SimulationWorldManagementAuthority } from '@clocky/clocky-simulation'
import { HiringMarketWorldExecution } from '../../simulation-world/src/hiring-market.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { businessFingerprint } from '../src/business.ts'

function authority(action: SimulationWorldManagementAction): SimulationWorldManagementAuthority {
  const source = simulationWorldAuthenticatedUserSourceSchema.parse({ kind: 'authenticated-user', principalId: 'reviewer',
    commandId: 'preview', credentialGeneration: 1, policyRef: 'test-persona-review/1', policyGeneration: '1', time: '0' })
  return { resolve: () => ({ source, actionHash: businessFingerprint(action), sourceFingerprint: businessFingerprint('finite-template'),
    sourceComplete: true, funding: null }) }
}

describe.each(['json', 'sqlite'] as const)('%s human Persona management', (backend) => {
  it('retains human provenance and invalidates old reviews without inference or identity effects', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.tmp/world-post-mvp', installedPins: [WORLD_HIRING_MARKET_PIN] })
    try {
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const original = h.run.snapshot(), template = original.world!.definition.templates[0]!
      const body = { templateId: template.id, templateVersion: template.version,
        persona: { name: template.names[0], skills: [], traits: [], goals: [] } }
      async function submit(command: object, id: string) {
        const action = simulationWorldManagementActionSchema.parse({ kind: 'hiring-market', payload: {
          organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy', ...command } })
        const before = h.run.snapshot(), auth = authority(action)
        const preview = await h.run.previewWorldManagement({ action, expectedRevision: before.revision }, auth)
        expect(preview.admission).toBe('allowed')
        expect(h.run.snapshot()).toEqual(before)
        const input = simulationWorldManagementSubmitRequestSchema.parse({ action, expectedRevision: before.revision,
          commandId: id, previewHash: preview.previewHash })
        const accepted = await h.run.submitWorldManagement(input, auth)
        await new HiringMarketWorldExecution(h.run).execute(h.run.snapshot().world!.plans[accepted.planId]!)
        return accepted
      }
      await submit({ kind: 'draft', id: 'human-draft', expectedRevision: 0, validUntil: '90', body }, 'draft-1')
      const first = hiringMarket(h.run.snapshot()).drafts.get('human-draft')!
      expect(first.source).toMatchObject({ actorId: null, user: { kind: 'authenticated-user', principalId: 'reviewer', commandId: 'draft-1' } })
      await submit({ kind: 'review', id: first.id, revision: 1, bodyHash: first.bodyHash, decision: 'reviewed', reason: 'Checked finite template.' }, 'review-1')
      await submit({ kind: 'draft', id: first.id, expectedRevision: 1, validUntil: '90', body }, 'draft-2')
      const second = hiringMarket(h.run.snapshot()).drafts.get(first.id)!
      expect(second).toMatchObject({ revision: 2, status: 'draft', reviewerId: null, reviewerSource: null })
      await submit({ kind: 'review', id: first.id, revision: 2, bodyHash: second.bodyHash, decision: 'reviewed', reason: 'Checked revised draft.' }, 'review-2')
      await submit({ kind: 'review', id: first.id, revision: 2, bodyHash: second.bodyHash, decision: 'accepted', reason: 'Accept exact birth content.' }, 'accept-2')
      const rejectedAction = simulationWorldManagementActionSchema.parse({ kind: 'hiring-market', payload: {
        kind: 'draft', organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy', id: first.id,
        expectedRevision: 2, validUntil: '90', body } })
      expect((await h.run.previewWorldManagement({ action: rejectedAction, expectedRevision: h.run.snapshot().revision },
        authority(rejectedAction))).admission).toBe('blocked')
      expect(h.run.snapshot().decisions).toEqual(original.decisions)
      expect(h.run.snapshot().operations).toEqual(original.operations)
      expect(h.run.snapshot().entities).toEqual(original.entities)
      expect(() => simulationWorldManagementActionSchema.parse({ kind: 'hiring-market', payload: {
        kind: 'offer-response', organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy', id: 'offer', revision: 1,
        bodyHash: first.bodyHash, decision: 'accepted' } })).toThrow()
      await h.connection.close(); await h.run.close()
      const cold = await h.ctx.simulations.inspect({ provider: h.selection.provider, spec: h.selection.spec })
      expect(cold).toBeDefined()
      expect(hiringMarket(cold!.snapshot).drafts.get(first.id)).toMatchObject({ status: 'accepted', revision: 2,
        reviewerSource: { kind: 'authenticated-user', principalId: 'reviewer', commandId: 'accept-2' } })
    } finally { await h.close() }
  })
  it('prepares the reviewed independent identity but refuses assignment before candidate consent', async () => {
    const h = await hiringResourceHarness(backend, 'generate-and-hire', { evidenceRoot: '.tmp/world-post-mvp', installedPins: [WORLD_HIRING_MARKET_PIN] })
    try {
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const template = h.run.snapshot().world!.definition.templates[0]!
      const body = { templateId: template.id, templateVersion: template.version,
        persona: { name: template.names[0]!, skills: [], traits: [], goals: [] } }
      for (const decision of ['draft', 'reviewed', 'accepted'] as const) {
        const prior = hiringMarket(h.run.snapshot()).drafts.get('birth')
        const payload = { organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy', id: 'birth',
          ...decision === 'draft' ? { kind: 'draft', expectedRevision: 0, validUntil: '90', body }
            : { kind: 'review', revision: 1, bodyHash: prior!.bodyHash, decision, reason: 'Approve exact finite birth.' } }
        const action = simulationWorldManagementActionSchema.parse({ kind: 'hiring-market', payload }), auth = authority(action)
        const expectedRevision = h.run.snapshot().revision
        const preview = await h.run.previewWorldManagement({ action, expectedRevision }, auth)
        expect(preview.admission).toBe('allowed')
        const accepted = await h.run.submitWorldManagement(simulationWorldManagementSubmitRequestSchema.parse({ action,
          expectedRevision, commandId: `birth-${decision}`, previewHash: preview.previewHash }), auth)
        await new HiringMarketWorldExecution(h.run).execute(h.run.snapshot().world!.plans[accepted.planId]!)
      }
      const draft = hiringMarket(h.run.snapshot()).drafts.get('birth')!
      const reference = { id: draft.id, revision: draft.revision, bodyHash: draft.bodyHash }
      await h.start()
      const plan = await h.plan('reviewed-birth', 'generate-and-hire', { kind: 'apply', rationale: 'Use the exact reviewed selection.',
        payload: { ...body, personaDraft: reference } })
      const prepared = await h.prepareGenerated(plan)
      const independent = await h.run.readyWorldCandidate(prepared.id)
      await h.run.finishMaintenance(prepared.request.maintenance)
      await h.connection.quiesceForMaintenance(independent.candidate!.maintenance, 4, 3, h.lifetime.signal)
      const state = h.run.snapshot()
      expect(state.entities[prepared.identities.entityId]?.profile).toMatchObject({ persona: body.persona, personaDraft: reference })
      expect(state.entities[prepared.identities.entityId]?.binding).toEqual(prepared.identities.binding)
      expect(hiringMarket(state).drafts.get('birth')?.source.user?.principalId).toBe('reviewer')
      const before = h.run.snapshot()
      await expect(h.run.commitWorldHire(prepared.id)).rejects.toThrow(/candidate acceptance/)
      expect(h.run.snapshot()).toEqual(before)
      expect(Object.values(before.resourceReservations).filter(value => value.phase === 'active')).toHaveLength(1)
      await h.connection.close(); await h.run.close()
      const cold = await h.ctx.simulations.inspect({ provider: h.selection.provider, spec: h.selection.spec })
      expect(cold?.snapshot.entities[prepared.identities.entityId]?.profile['personaDraft']).toEqual(reference)
      expect(hiringMarket(cold!.snapshot).drafts.get('birth')?.source).toEqual(draft.source)
    } finally { await h.close() }
  })

  it('refuses direct Native fee reservation until the original candidate accepts', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.tmp/world-post-mvp', installedPins: [WORLD_HIRING_MARKET_PIN] })
    try {
      const input = simulationWorldManagementActionSchema.parse({ kind: 'hire-existing', payload: {
        organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy', personId: h.candidate, description: 'Direct human hire' } })
      const base = authority(input), delegated: SimulationWorldManagementAuthority = { resolve: () => {
        const original = base.resolve()
        return original === undefined ? undefined : { ...original, funding: { kind: 'native-controller', entityId: h.requester,
          policyRef: 'test-funded-user/1', policyGeneration: '1' } }
      } }
      const beforePreview = h.run.snapshot()
      expect(await h.run.previewWorldManagement({ action: input, expectedRevision: beforePreview.revision }, delegated))
        .toMatchObject({ admission: 'blocked', blockers: ['authority-missing'] })
      expect(h.run.snapshot()).toEqual(beforePreview)
      const plan = await h.plan('unaccepted-market-hire'), before = h.run.snapshot()
      await expect(h.run.reserveExistingHireResources(plan.id)).rejects.toThrow(/offer reservation boundary/)
      expect(h.run.snapshot()).toEqual(before)
      expect(Object.keys(h.run.snapshot().resourceReservations)).toHaveLength(0)
    } finally { await h.close() }
  })

})
