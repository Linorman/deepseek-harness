/** Recompile a branch's runtime metadata; a parent compiler commitment is never relabelled as a new projection. */
import { isDeepStrictEqual } from 'node:util'
import { compileWorldScenarioV1, compileWorldScenario, worldScenarioV1Schema, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario, ResolvedWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { simulationWorldPersonaSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'

/**
 * Compile fresh driver metadata with branch identities and an explicitly empty initial-work schedule.
 * Native facts and obligations already came from the branch seed; this metadata must never initialize the run again.
 * @param source - Original complete accepted compiler output, including the v1 catalog.
 * @param target - Actual newly seeded paused branch snapshot.
 * @param lineage - Exact original-to-branch entity identity mapping returned by the owner initializer.
 * @param catalog - Original v0 catalog when the source predates self-contained v1 resolutions.
 * @returns newly hashed valid compiler output; mismatched world/native semantics reject before driver installation.
 */
export async function compileWorldExperimentRuntime(source: ResolvedWorldScenario | ResolvedWorldScenarioV1,
  target: SimulationSnapshot, lineage: Readonly<Record<string, string>>, catalog?: unknown):
Promise<ResolvedWorldScenario | ResolvedWorldScenarioV1> {
  const experiment = target.experiment
  if (experiment === undefined || target.phase !== 'paused' || target.world === undefined)
    throw new Error('Branch runtime requires its actual paused seeded World')
  const identityFields = new Set(['rootId', 'parentId', 'owner', 'subjectId', 'scopeId', 'subject', 'object', 'scope',
    'personId', 'positionId', 'positionIds', 'committeeId', 'requesterId', 'targetId', 'unitId', 'ownerId', 'controllers', 'readers', 'entityIds', 'actorDisclosure'])
  const remap = (value: unknown, field = ''): unknown => {
    if (['runtimeProfiles', 'runtimeProfile', 'template'].includes(field)) return value
    if (typeof value === 'string') return identityFields.has(field) ? lineage[value] ?? value : value
    if (Array.isArray(value)) return value.map(child => remap(child, field))
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, remap(child, key)]))
    return value
  }
  let compiled: Awaited<ReturnType<typeof compileWorldScenarioV1>> | Awaited<ReturnType<typeof compileWorldScenario>>
  if (source.apiVersion === 'clocky.world/v1') {
    const definition = worldScenarioV1Schema.parse(remap(source.definition))
    const entityId = (id: string): string => {
      const mapped = Object.hasOwn(lineage, id) ? lineage[id] : undefined
      if (mapped === undefined) throw new Error('Branch runtime Entity declaration has no source owner')
      return mapped
    }
    for (const entity of definition.entities) entity.id = entityId(entity.id)
    for (const unit of definition.organization.units) unit.id = entityId(unit.id)
    for (const position of definition.organization.positions) position.id = entityId(position.id)
    for (const committee of definition.governance.committees) committee.id = entityId(committee.id)
    definition['metadata'] = { ...source.definition.metadata, id: `experiment-${experiment.namespace}` }
    for (const entity of Object.values(target.entities)) {
      if (entity.cognition !== 'agent' || definition.entities.some(value => value.id === entity.id)) continue
      const persona = simulationWorldPersonaSchema.parse(entity.profile.persona)
      const participant = entity.participantReservation?.participant
      const runtime = source.runtimeProfiles.find(profile => participant !== undefined && profile.provider === participant.provider
        && profile.preset === participant.preset && `${profile.model.provider}/${profile.model.name}` === participant.model
        && isDeepStrictEqual(profile.capabilities, participant.capabilities))
      const template = source.catalog.templates.find(value => value.template.names.includes(persona.name)
        && persona.skills.every(skill => value.template.skills.includes(skill))
        && persona.traits.every(trait => value.template.traits.includes(trait))
        && persona.goals.every(goal => value.template.goals.includes(goal)))?.template
      if (runtime === undefined || template === undefined) throw new Error('Branch actor has no representable original runtime or persona template')
      definition.entities.push({ id: entity.id, name: persona.name, description: template.description,
        kind: 'person', cognition: 'agent', role: entity.id === target.world.definition.directorEntityId ? 'director' : 'member',
        runtimeProfile: { id: runtime.id, version: runtime.version }, template: { id: template.id, version: template.version }, persona })
    }
    definition['behavior'] = { initialGoals: [], calendars: [], directorEvents: [] }
    definition['resources'] = Object.values(target.resources).map(({ revision: _revision, ...resource }) => resource)
    // The seed owns current dynamic facts. Compiler metadata carries no duplicate model input or fake historical approval.
    definition['facts'] = []; definition['knowledge'] = []
    const native = Object.fromEntries(Object.keys(source.limits.native).map(key =>
      [key, target.spec[key as keyof typeof target.spec]]))
    definition['limits'] = { ...source.definition.limits, native: Object.assign({}, definition.limits.native, native) }
    const selectedCatalog = structuredClone(source.catalog)
    Object.assign(selectedCatalog, { generation: `${source.catalogGeneration}/experiment/${experiment.namespace}` })
    Object.assign(selectedCatalog.native, Object.fromEntries(Object.keys(selectedCatalog.native).map(key =>
      [key, target.spec[key as keyof typeof target.spec]])))
    Object.assign(selectedCatalog.limits.defaults.native, native)
    compiled = await compileWorldScenarioV1(definition, selectedCatalog, 'json', source.teamCeilings)
  } else {
    if (catalog === undefined) throw new Error('Legacy branch runtime requires its original complete compiler catalog')
    const definition = worldScenarioSchema.parse(remap(source.definition))
    const entityId = (id: string): string => {
      const mapped = Object.hasOwn(lineage, id) ? lineage[id] : undefined
      if (mapped === undefined) throw new Error('Legacy branch runtime Entity declaration has no source owner')
      return mapped
    }
    definition.organization.id = entityId(definition.organization.id)
    for (const position of definition.positions) position.id = entityId(position.id)
    for (const actor of definition.actors) actor.id = entityId(actor.id)
    definition.initialEvents = []
    compiled = await compileWorldScenario(definition, catalog)
  }
  if (!compiled.ok) throw new Error('Branch runtime cannot be represented by the installed scenario compiler')
  const { runId: _runId, ...native } = target.spec
  if (!isDeepStrictEqual(compiled.resolved.native, native) || !isDeepStrictEqual(compiled.resolved.world, target.world.definition))
    throw new Error('Compiled branch runtime differs from its actual Native/world seed')
  return compiled.resolved
}
