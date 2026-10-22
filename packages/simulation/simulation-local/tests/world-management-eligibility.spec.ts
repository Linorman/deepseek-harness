/** Actual user hire/depart/rehire preserves independent eligibility and closes only explicitly installed role qualification. */
import { expect, it } from 'vitest'
import { simulationWorldManagementActionSchema, worldManagementCommandIdSchema, simTimeSchema,
  simulationCheckpointIdSchema, simulationWorldAuthenticatedUserSourceSchema, personnelObligationQuerySchema, simulationEntityIdSchema,
  WORLD_TRANSFER_PIN, WORLD_DEPART_PIN } from '@clocky/clocky-simulation'
import type { SimulationWorldManagementAction, SimulationWorldManagementAuthority } from '@clocky/clocky-simulation'
import { WorldExecutionDispatcher } from '../../simulation-world/src/execution.ts'
import { ExistingHireWorldExecution } from '../../simulation-world/src/hire-existing.ts'
import { PersonnelWorldExecution } from '../../simulation-world/src/personnel.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { businessFingerprint } from '../src/business.ts'
import { independentPersonnelEligibility } from '../src/personnel-authorities.ts'

for (const backend of ['json', 'sqlite'] as const) for (const roleBound of [false, true]) {
  it(`${backend} keeps independent candidate qualification across departure/rehire and ends declared role qualification=${roleBound}`, async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/world-completion/u07-native', balance: '20',
      candidateEligibility: true, installedPins: [WORLD_TRANSFER_PIN, WORLD_DEPART_PIN],
      positionRolePermissions: roleBound ? [{ positionEntityId: simulationEntityIdSchema.parse('fee-vacancy'), permissions: [{ domain: 'organization',
        operation: 'hire-existing', version: '1', scopeEntityId: simulationEntityIdSchema.parse('fee-org'), targetEntityId: simulationEntityIdSchema.parse('fee-org'),
        relation: 'eligible-for-hire' }] }] : [] })
    const releases: Array<() => Promise<void>> = []
    try {
      const identity = h.run.snapshot().entities[h.candidate], dispatcher = new WorldExecutionDispatcher(h.run)
      releases.push(dispatcher.register(new ExistingHireWorldExecution(h.run)))
      releases.push(dispatcher.register(new PersonnelWorldExecution(h.run, h.connection, {
        checkpointId: simulationCheckpointIdSchema.parse('owner-anchor'), ownerName: 'simulation/company-product',
        maxDrainRounds: 4, maxAttempts: 3 }, h.lifetime.signal, 'depart')))
      const principalId = simulationWorldAuthenticatedUserSourceSchema.parse({ kind: 'authenticated-user', commandId: 'parse-only',
        principalId: 'original-human-manager', credentialGeneration: 1, policyRef: 'fixture-management/1', policyGeneration: '1', time: '0' }).principalId
      const execute = async (name: string, selected: SimulationWorldManagementAction) => {
        const authority: SimulationWorldManagementAuthority = { resolve: () => ({ source: { kind: 'authenticated-user', principalId,
          credentialGeneration: 1, policyRef: 'fixture-management/1', policyGeneration: '1' }, actionHash: businessFingerprint(selected),
        sourceFingerprint: businessFingerprint(['observed-fixture-cut', h.run.snapshot().revision]), sourceComplete: true,
        funding: selected.kind === 'hire-existing' ? { kind: 'native-controller', entityId: h.requester,
          policyRef: 'fixture-cash-delegation/1', policyGeneration: '1' } : null }) }
        const preview = await h.run.previewWorldManagement({ action: selected, expectedRevision: h.run.snapshot().revision }, authority)
        expect(preview.admission).toBe('allowed')
        const receipt = await h.run.submitWorldManagement({ action: selected, commandId: worldManagementCommandIdSchema.parse(name),
          expectedRevision: preview.snapshotRevision, previewHash: preview.previewHash }, authority)
        const plan = h.run.snapshot().world!.plans[receipt.planId]!
        expect(await dispatcher.execute(plan)).toBeUndefined()
        return h.run.inspectWorldManagement(receipt.commandId, principalId)!
      }
      const hire = simulationWorldManagementActionSchema.parse({ kind: 'hire-existing', payload: { organizationEntityId: 'fee-org',
        personId: h.candidate, positionEntityId: 'fee-vacancy', description: 'Hire the original qualified person' } })
      await h.run.drive({ until: simTimeSchema.parse('2') }); await h.run.setPhase('paused', h.run.snapshot().revision)
      const first = await execute('first-hire', hire), hired = h.run.snapshot()
      const qualification = Object.values(hired.relations).find(value => value.id === 'fee-eligibility')!
      expect(independentPersonnelEligibility(hired, qualification)).toBe(true)
      const role = hired.world!.personnel.operationGrants.find(value => value.relation === 'eligible-for-hire')
      expect(role !== undefined).toBe(roleBound)
      if (role !== undefined) expect(independentPersonnelEligibility(hired, hired.relations[role.relationId]!)).toBe(false)
      const declared = hired.world!.definition.operationGrants.find(value => value.relationId === qualification.id)!
      const ambiguous = { ...hired, world: { ...hired.world!, personnel: { ...hired.world!.personnel,
        operationGrants: [...hired.world!.personnel.operationGrants, declared] } } }
      expect(() => independentPersonnelEligibility(ambiguous, qualification)).toThrow(/conflicting/)
      const onboarding = Object.values(hired.scheduledEvents).find(value => value.action.kind === 'wake'
        && value.id === `simulation-world-first:${first.intentId}`)!
      // Explicit owner-supported cancellation settles this never-started original wake; it does not claim model consumption.
      await h.run.cancelEvent(onboarding.id, 'Fixture explicitly settles the original pending onboarding', h.run.snapshot().revision)
      await h.run.setPhase('running', h.run.snapshot().revision); await h.run.drive({ until: simTimeSchema.parse('4') })
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const assignment = Object.values(h.run.snapshot().relations).find(value => value.subject === h.candidate
        && value.relation === 'assignment' && value.validUntil === null)!
      const inventory = h.run.inspectPersonnelObligations(personnelObligationQuerySchema.parse({ selector: { kind: 'assignment',
        personId: h.candidate, personRevision: h.run.snapshot().entities[h.candidate]!.revision,
        assignmentId: assignment.id, assignmentRevision: assignment.revision }, limit: 1024, maxBytes: 1048576 }))
      expect(inventory.items.some(item => item.ref.kind === 'relation' && item.ref.id === qualification.id)).toBe(false)
      if (role !== undefined) expect(inventory.items.some(item => item.ref.kind === 'relation' && item.ref.id === role.relationId)).toBe(true)
      const departure = await execute('original-departure', simulationWorldManagementActionSchema.parse({ kind: 'depart', payload: {
        organizationEntityId: 'fee-org', personId: h.candidate, assignmentId: assignment.id, assignmentRevision: assignment.revision,
        requestedEffectiveAt: null, retire: false, description: 'Depart without deleting independent candidate qualification' } }))
      const departed = h.run.snapshot(), reservation = departed.world!.personnel.reservations[departure.intentId]!
      expect(departed.relations[qualification.id]).toEqual(qualification)
      expect(reservation.revokedAuthorityRelationIds).not.toContain(qualification.id)
      if (role !== undefined) {
        expect(reservation.revokedAuthorityRelationIds).toContain(role.relationId)
        expect(departed.relations[role.relationId]?.validUntil).toBe('4')
        expect(independentPersonnelEligibility(departed, departed.relations[role.relationId]!)).toBe(false)
      }
      const rehired = await execute('original-rehire', hire), final = h.run.snapshot()
      expect(rehired.result?.outcome.kind).toBe('committed')
      expect(Object.values(final.world!.results)).toHaveLength(3)
      expect(final.entities[h.candidate]?.binding).toEqual(identity?.binding)
      expect(final.entities[h.candidate]?.profile).toEqual(identity?.profile)
      expect(final.relations[qualification.id]).toEqual(qualification)
      expect(Object.values(final.resources).map(value => value.quantity)).toEqual(['8', '12'])
      expect(h.requests).toHaveLength(0)
    } finally { for (const release of releases.reverse()) await release(); await h.close() }
  })
}
