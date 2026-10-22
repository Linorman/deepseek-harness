/** Real hiring owners install only the original declared position authority with their business result. */
import { describe, expect, it } from 'vitest'
import { WORLD_EXTERNAL_INTERACT_PIN, simulationWorldDomainRequestSchema, simulationRelationIdSchema, simulationChangeSchema,
  simulationEntityIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { installWorldRolePermissions } from '../src/world-role-permissions.ts'
const role = { positionEntityId: simulationEntityIdSchema.parse('fee-vacancy'), permissions: [{
  domain: 'external', operation: 'interact', version: '1', scopeEntityId: simulationEntityIdSchema.parse('fee-org'),
  targetEntityId: simulationEntityIdSchema.parse('role-vendor'), relation: 'can-interact' }] }
const request = simulationWorldDomainRequestSchema.parse({ kind: 'world/request', domain: 'external', operation: 'interact', version: '1',
  businessKey: 'new-employee-supplier', expectedTime: null, evidence: [], payload: { scope: 'fee-org', subjectRef: 'role-vendor',
    externalKey: 'supplier', sourceKind: 'simulated-rule', policyRef: 'clocky.external.availability/1', input: { kind: 'availability', unit: 'widget' } } })

describe.each(['json', 'sqlite'] as const)('%s committed position authority', (backend) => {
  it.each(['generate-and-hire', 'hire-existing'] as const)('%s grants at commit and preserves exact retry and ownership', async (mode) => {
    const h = await hiringResourceHarness(backend, mode, { positionRolePermissions: [role], installedPins: [WORLD_EXTERNAL_INTERACT_PIN],
      extraEntities: [{ id: 'role-vendor', entityKind: 'organization' }] })
    try {
      const plan = await h.plan(); await h.reserve(plan)
      expect(h.run.snapshot().world!.personnel.operationGrants).toEqual([])
      if (mode === 'generate-and-hire') await h.prepareGenerated(plan)
      expect(h.run.snapshot().world!.personnel.operationGrants).toEqual([])
      const result = mode === 'generate-and-hire'
        ? await h.run.commitWorldHire(h.run.snapshot().world!.requests[plan.requestId]!.intentId)
        : await h.run.commitWorldMutation({ planId: plan.id, payload: plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : {} })
      expect(result.outcome.kind).toBe('committed')
      const state = h.run.snapshot(), intentId = state.world!.requests[plan.requestId]!.intentId
      const personId = state.world!.personnel.operationGrants[0]!.requesterEntityId
      const relationId = simulationRelationIdSchema.parse(`world-role-authority:${intentId}:0`)
      expect(state.world!.personnel.operationGrants).toEqual([{ ...role.permissions[0], requesterEntityId: personId, relationId }])
      expect(state.relations[relationId]).toMatchObject({ subject: personId, object: 'role-vendor', relation: 'can-interact',
        scope: 'fee-org', validFrom: result.time, validUntil: null })
      const identity = state.entities[personId]!
      expect(identity).toMatchObject({ cognition: 'agent', readiness: 'ready' })
      expect(await h.run.openWorldIntent(personId, request)).toMatchObject({ requesterEntityId: personId, targetEntityId: 'role-vendor' })
      if (mode === 'generate-and-hire') {
        const original = state.world!.reservations[intentId]!
        expect(state.world!.channels[personId]).toBe(original.identities.channels[0].channelId)
        await h.run.finishMaintenance(original.request.maintenance)
        await h.run.setPhase('running', h.run.snapshot().revision)
      }
      await h.connection.ensureResident(personId, { activation: { provider: 'in-process', seed: { kind: 'fresh' },
        agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal },
      evict: [h.requester, h.director] })
      const requested = await h.propose(personId, 'actual-new-role-request', { ...request, businessKey: 'actual-new-role-request' }, { kind: 'goal' })
      expect(requested?.status).toBe('applied')
      const submitted = Object.values(h.run.snapshot().world!.requests).find(value => value.requesterEntityId === personId)!
      expect(submitted.notificationOperationId).not.toBeNull()
      const post = h.run.snapshot().operations[submitted.notificationOperationId!]!
      expect(post.action).toMatchObject({ kind: 'communication/post', recipient: h.director, channelId: state.world!.channels[personId] })
      const beforeRetry = h.run.snapshot()
      if (mode === 'generate-and-hire') expect(await h.run.commitWorldHire(intentId)).toEqual(result)
      else expect(await h.run.commitWorldMutation({ planId: plan.id,
        payload: plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : {} })).toEqual(result)
      expect(h.run.snapshot()).toEqual(beforeRetry)
      expect(h.run.snapshot().entities[personId]!.binding).toEqual(identity.binding)
      expect(h.run.snapshot().resources).toEqual(state.resources)
      const beforeInjection = h.run.snapshot()
      const malformed = { ...state, relations: { ...state.relations,
        [relationId]: { ...state.relations[relationId]!, subject: h.requester } } }
      expect(() => installWorldRolePermissions(malformed, intentId, result.sequence)).toThrow(/original committed assignment/)
      const changedResult = { ...result, payload: { entityId: h.director, relationId: 'foreign-assignment' } }
      expect(() => installWorldRolePermissions({ ...state, world: { ...state.world!, results: { [result.id]: changedResult } } },
        intentId, result.sequence)).toThrow()
      expect(h.run.snapshot()).toEqual(beforeInjection)
      const { revision, ...previousRelation } = state.relations[relationId]!
      await h.run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...previousRelation,
        relationRevision: revision, validUntil: '1' }), h.run.snapshot().revision)
      // Settle each original delivery and consume onboarding/result inputs with an explicitly empty actual decision.
      // These fixture decisions claim no business work; the request itself remains unresolved.
      for (let step = 0; step < 24 && h.run.snapshot().time === '0'; step++) {
        const driven = await h.run.drive({ until: simTimeSchema.parse('1') })
        if (driven.reason === 'dispatch-required' || driven.reason === 'delivery-required') {
          if (driven.operationId === undefined) throw new Error('Original fixture delivery has no operation')
          const operation = h.run.snapshot().operations[driven.operationId]!
          if (operation.action.kind !== 'communication/post') throw new Error('Unexpected fixture outbox action')
          const recipient = operation.action.recipient
          await h.connection.ensureResident(recipient, { activation: { provider: 'in-process', seed: { kind: 'resume' },
            agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal },
          evict: [h.requester, h.director, personId].filter(id => id !== recipient) })
          if (driven.reason === 'dispatch-required') await h.connection.dispatchOperation(operation.id, () => Date.now())
          await h.connection.receiveOperation(operation.id)
        } else if (driven.reason === 'decision-required') {
          const pending = Object.values(h.run.snapshot().wakes).find(value => value.status === 'pending')
          if (pending === undefined) throw new Error('Original fixture decision has no pending input')
          await h.connection.ensureResident(pending.entityId, { activation: { provider: 'in-process', seed: { kind: 'resume' },
            agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal },
          evict: [h.requester, h.director, personId].filter(id => id !== pending.entityId) })
          await h.propose(pending.entityId, `empty-original-input:${step}`, undefined, undefined, pending.eventId)
        }
      }
      expect(h.run.snapshot().time).toBe('1')
      await expect(h.run.openWorldIntent(personId, { ...request, businessKey: 'after-role-end' })).rejects.toThrow(/scoped operation grant/)
      expect(h.run.snapshot().world!.personnel.operationGrants).toHaveLength(1)
      expect(h.run.snapshot().relations[relationId]!.validUntil).toBe('1')
      const ended = h.run.snapshot()
      if (mode === 'generate-and-hire') await h.run.commitWorldHire(intentId)
      else await h.run.commitWorldMutation({ planId: plan.id,
        payload: plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : {} })
      expect(h.run.snapshot()).toEqual(ended)
    } finally { await h.close() }
  })
})
