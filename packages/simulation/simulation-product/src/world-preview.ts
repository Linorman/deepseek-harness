/** Initial public World projection; accepted private compilation remains with the creation owner. */
import type { ScenarioCompilation, ScenarioV1Compilation } from '@clocky/clocky-simulation-scenario'
import { simulationProductWorldPreflightResultSchema } from './world-schema.ts'
import type { SimulationProductWorldPreflightResult } from './world-types.ts'

/**
 * Project an original inert compilation into its closed public summary without changing it.
 * @param result - Actual preflight outcome, including its exact complete preview commitment.
 * @returns initial organization, people, position occupancy, authorizations and quotas, or field diagnostics;
 * parsing rejects an inconsistent source. No current metadata lookup, identity allocation, IO or inference occurs.
 */
export function worldPreflightPreview(result: ScenarioCompilation | ScenarioV1Compilation): SimulationProductWorldPreflightResult {
  if (!result.ok) return simulationProductWorldPreflightResultSchema.parse({ status: 'invalid', diagnostics: result.diagnostics })
  const { resolved, preview } = result
  if (resolved.apiVersion === 'clocky.world/v1') {
    const { definition } = resolved
    const organization = definition.entities.find(value => value.id === definition.organization.rootId)
    if (organization === undefined) throw new Error('Validated v1 preview lost its original primary organization')
    return simulationProductWorldPreflightResultSchema.parse({ status: 'ready', apiVersion: resolved.apiVersion,
      preview: { hash: preview.hash, catalogGeneration: preview.catalogGeneration, organizationName: organization.name,
        actorCount: resolved.actors.length, positionCount: definition.organization.positions.length, initialRequestCount: 0,
        directorEntityId: resolved.world.directorEntityId, creationMode: 'paused', source: 'simulated-only',
        entityCount: resolved.entities.length },
      policyVersion: resolved.policyVersion, organization: { id: organization.id, name: organization.name,
        description: organization.description },
      actors: resolved.actors.map(actor => ({ entityId: actor.entityId, role: actor.role, name: actor.persona.name,
        template: { id: actor.template.id, version: actor.template.version }, model: { provider: actor.runtime.model.provider,
          name: actor.runtime.model.name, version: actor.runtime.model.version } })),
      positions: definition.organization.positions.map(position => ({ entityId: position.id, name: position.name,
        capacity: position.capacity,
        occupied: definition.organization.assignments.filter(value =>
          value.positionId === position.id && value.validFrom === '0'
          && (value.validUntil === null || BigInt(value.validUntil) > 0n)).length })),
      authorizations: resolved.world.authorizations.map(value => ({ requesterEntityId: value.requesterEntityId,
        positionEntityId: value.positionEntityId })),
      limits: resolved.limits, maxTime: resolved.native.maxTime, budgetInterval: resolved.native.budgetInterval,
      tickUnit: resolved.native.tickUnit,
      scope: { source: 'simulated-only', payroll: false, committeeApproval: resolved.world.operations.some(value =>
        value.domain === 'governance' && value.operation === 'propose-hire-approval'),
      domains: resolved.world.operations },
      units: definition.organization.units.map(unit => ({ ...unit,
        name: definition.entities.find(value => value.id === unit.id)?.name })),
      committees: definition.governance.committees, institutions: definition.governance.norms.map(({ body: _body, ...value }) => value),
      permissions: definition.organization.grants, assignments: definition.organization.assignments,
      positionPermissions: definition.organization.positions.map(value => ({ positionEntityId: value.id, permissions: value.permissions })),
      sources: { facts: definition.facts.length, privateBeliefs: definition.knowledge.length, resources: definition.resources.length,
        externalIdentities: definition.externalWorld.identities.length, initialGoals: definition.behavior.initialGoals.length,
        calendars: definition.behavior.calendars.length, directorEvents: definition.behavior.directorEvents.length },
    })
  }
  const { definition } = resolved
  return simulationProductWorldPreflightResultSchema.parse({ status: 'ready', preview, policyVersion: resolved.policyVersion,
    organization: definition.organization,
    actors: resolved.actors.map(actor => ({ entityId: actor.entityId, role: actor.role, name: actor.persona.name,
      template: { id: actor.template.id, version: actor.template.version }, model: { provider: actor.runtime.model.provider,
        name: actor.runtime.model.name, version: actor.runtime.model.version } })),
    positions: definition.positions.map(position => ({ entityId: position.id, name: position.name, capacity: position.capacity,
      occupied: definition.assignments.filter(assignment => assignment.positionId === position.id).length })),
    authorizations: definition.authorizations.map(grant => ({ requesterEntityId: grant.requesterId, positionEntityId: grant.positionId })),
    limits: resolved.limits, maxTime: resolved.native.maxTime, budgetInterval: resolved.native.budgetInterval,
    tickUnit: resolved.native.tickUnit,
    scope: { source: 'simulated-only', operation: 'organization.generate-and-hire/v1', payroll: false, committeeApproval: false },
  })
}
