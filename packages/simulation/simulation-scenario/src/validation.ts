/** Pure relationship checks over parsed scenario and installed catalog snapshots. */
import type { SimulationWorldPersona, SimulationWorldTemplate } from '@clocky/clocky-simulation/world-types'
import type { ScenarioCatalog, ScenarioDiagnostic, ScenarioLimits, ScenarioRuntimeProfile, WorldScenario } from './types.ts'

type Report = (source: ScenarioDiagnostic['source'], path: (string | number)[], code: ScenarioDiagnostic['code'], message: string) => void
const referenceKey = (value: { id: string; version: string }) => JSON.stringify([value.id, value.version])

/** @param defaults - Explicit deployed defaults. @param ceilings - Deployment hard caps.
 * @param requested - Portable reductions or requests.
 * @returns effective per-field minima; input records are never mutated.
 */
function capped<T extends Record<string, number>>(defaults: T, ceilings: T,
  requested: { [Key in keyof T]?: T[Key] | undefined } | undefined): T {
  // Both records passed the same strict complete shape; every default key has a ceiling.
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) =>
    [key, Math.min(requested?.[key] ?? fallback, ceilings[key] as number)])) as T
}

/**
 * Resolve every limit explicitly against the deployment ceiling.
 * @param definition - Strict portable scenario input.
 * @param catalog - Strict installed defaults and ceilings.
 * @returns complete effective limits without mutating either input.
 */
export function resolveLimits(definition: WorldScenario, catalog: ScenarioCatalog): ScenarioLimits {
  return {
    native: capped(catalog.limits.defaults.native, catalog.limits.ceilings.native, definition.limits?.native),
    team: capped(catalog.limits.defaults.team, catalog.limits.ceilings.team, definition.limits?.team),
    world: capped(catalog.limits.defaults.world, catalog.limits.ceilings.world, definition.limits?.world),
  }
}

/** @param template - Installed finite options. @param persona - Complete candidate.
 * @returns fields whose selections escape the template.
 */
function invalidChoices(template: SimulationWorldTemplate, persona: SimulationWorldPersona): (keyof SimulationWorldPersona)[] {
  return [
    ...template.names.includes(persona.name) ? [] : ['name' as const],
    ...(['skills', 'traits', 'goals'] as const).filter(key => persona[key].some(value => !template[key].includes(value))),
  ]
}

/**
 * Validate all owned references, roles, persona choices and initial capacity before materialization.
 * @param definition - Strict portable scenario input.
 * @param catalog - Strict installed metadata.
 * @param limits - Fully resolved deployment bounds.
 * @returns field-level diagnostics; an empty result permits materialization.
 */
export function validateRelationships(definition: WorldScenario, catalog: ScenarioCatalog, limits: ScenarioLimits): ScenarioDiagnostic[] {
  const diagnostics: ScenarioDiagnostic[] = []
  const report: Report = (source, path, code, message) => { diagnostics.push({ source, path, code, message }) }
  // The description becomes the Team objective, whose bootstrap rejects whitespace-only text.
  if (definition.metadata.description.trim().length === 0) {
    report('scenario', ['metadata', 'description'], 'invalid-shape', 'Scenario description must contain non-whitespace text')
  }
  const unique = (values: readonly { key: string; path: (string | number)[] }[], source: ScenarioDiagnostic['source']) => {
    const seen = new Set<string>()
    for (const value of values) {
      if (seen.has(value.key)) report(source, value.path, 'duplicate-id', 'Identity must be unique within its namespace')
      seen.add(value.key)
    }
  }
  unique(catalog.runtimeProfiles.map((value, index) => ({ key: referenceKey(value), path: ['runtimeProfiles', index, 'id'] })), 'catalog')
  unique(catalog.templates.map((value, index) => ({ key: referenceKey(value.template), path: ['templates', index, 'template', 'id'] })), 'catalog')
  catalog.templates.forEach((value, index) => {
    for (const key of invalidChoices(value.template, value.defaultPersona)) {
      report('catalog', ['templates', index, 'defaultPersona', key], 'template-choice', 'Default persona must use the installed template options')
    }
  })
  for (const group of ['native', 'team', 'world'] as const) {
    const ceilings: Readonly<Record<string, number>> = catalog.limits.ceilings[group]
    for (const [key, requested] of Object.entries(definition.limits?.[group] ?? {})) {
      const ceiling = ceilings[key]
      if (requested !== undefined && ceiling !== undefined && requested > ceiling) {
        report('scenario', ['limits', group, key], 'capacity', 'Requested limit exceeds the deployment ceiling')
      }
    }
  }
  const profiles = new Map(catalog.runtimeProfiles.map(value => [referenceKey(value), value]))
  const templates = new Map(catalog.templates.map(value => [referenceKey(value.template), value]))
  const installedProfile = (reference: { id: string; version: string }, role: 'member' | 'director', path: (string | number)[]) => {
    const profile = profiles.get(referenceKey(reference))
    if (profile === undefined) report('scenario', path, 'unknown-reference', 'Runtime profile and version must be installed')
    else {
      if (!profile.available || !profile.model.available) report('scenario', path, 'model-unavailable', 'Runtime profile and model must be available')
      if (!profile.roles.includes(role)) report('scenario', path, 'unauthorized-role', 'Installed runtime profile does not permit this actor role')
    }
  }
  installedProfile(definition.runtimeProfile, 'member', ['runtimeProfile'])
  unique([
    { key: definition.organization.id, path: ['organization', 'id'] },
    ...definition.positions.map((value, index) => ({ key: value.id, path: ['positions', index, 'id'] })),
    ...definition.actors.map((value, index) => ({ key: value.id, path: ['actors', index, 'id'] })),
  ], 'scenario')
  unique(definition.templates.map((value, index) => ({ key: value.id, path: ['templates', index, 'id'] })), 'scenario')
  definition.templates.forEach((reference, index) => {
    if (!templates.has(referenceKey(reference))) report('scenario', ['templates', index], 'unknown-reference', 'Persona template and version must be installed')
  })
  const directors = definition.actors.filter(value => value.role === 'director')
  if (directors.length !== 1) report('scenario', ['actors'], 'unauthorized-role', 'Exactly one initial actor must have the director role')
  const actors = new Map(definition.actors.map(value => [value.id, value]))
  const positions = new Map(definition.positions.map(value => [value.id, value]))
  const selectedTemplates = new Set(definition.templates.map(referenceKey))
  definition.actors.forEach((actor, index) => {
    installedProfile(actor.runtimeProfile ?? definition.runtimeProfile, actor.role, ['actors', index, 'runtimeProfile'])
    const key = referenceKey(actor.template), installed = templates.get(key)
    if (installed === undefined || !selectedTemplates.has(key)) {
      report('scenario', ['actors', index, 'template'], 'unknown-reference', 'Actor template must be selected by this scenario and installed')
    } else {
      for (const key of invalidChoices(installed.template, resolvePersona(installed.defaultPersona, actor.persona))) {
        report('scenario', ['actors', index, 'persona', key], 'template-choice', 'Persona must use the selected template options')
      }
    }
  })
  unique([
    ...definition.assignments.map((value, index) => ({ key: value.id, path: ['assignments', index, 'id'] })),
    ...definition.authorizations.map((value, index) => ({ key: value.id, path: ['authorizations', index, 'id'] })),
  ], 'scenario')
  unique(definition.assignments.map((value, index) => ({ key: value.personId, path: ['assignments', index, 'personId'] })), 'scenario')
  const occupied = new Map<string, number>()
  definition.assignments.forEach((assignment, index) => {
    if (!actors.has(assignment.personId)) report('scenario', ['assignments', index, 'personId'], 'unknown-reference', 'Assignment requires an initial actor')
    if (!positions.has(assignment.positionId)) report('scenario', ['assignments', index, 'positionId'], 'unknown-reference', 'Assignment requires a declared position')
    occupied.set(assignment.positionId, (occupied.get(assignment.positionId) ?? 0) + 1)
  })
  definition.positions.forEach((position, index) => {
    if ((occupied.get(position.id) ?? 0) > position.capacity) report('scenario', ['positions', index, 'capacity'], 'capacity', 'Initial assignments exceed position capacity')
  })
  const grantKey = (value: { requesterId: string; positionId: string }) => JSON.stringify([value.requesterId, value.positionId])
  unique(definition.authorizations.map((value, index) => ({ key: grantKey(value), path: ['authorizations', index] })), 'scenario')
  const grants = new Set(definition.authorizations.map(grantKey))
  definition.authorizations.forEach((authorization, index) => {
    const actor = actors.get(authorization.requesterId)
    if (actor === undefined) report('scenario', ['authorizations', index, 'requesterId'], 'unknown-reference', 'Hiring authorization requires an initial actor')
    else if (actor.role !== 'member') report('scenario', ['authorizations', index, 'requesterId'], 'unauthorized-role', 'The director cannot authorize its own hiring request')
    if (!positions.has(authorization.positionId)) report('scenario', ['authorizations', index, 'positionId'], 'unknown-reference', 'Hiring authorization requires a declared position')
  })
  unique(definition.initialEvents.map((value, index) => ({ key: value.applicationId, path: ['initialEvents', index, 'applicationId'] })), 'scenario')
  definition.initialEvents.forEach((event, index) => {
    if (!actors.has(event.requesterId)) report('scenario', ['initialEvents', index, 'requesterId'], 'unknown-reference', 'Initial request requires an initial actor')
    if (!positions.has(event.positionId)) report('scenario', ['initialEvents', index, 'positionId'], 'unknown-reference', 'Initial request requires a declared position')
    if (!grants.has(grantKey(event))) report('scenario', ['initialEvents', index], 'unauthorized-role', 'Initial request requires the matching hiring authorization')
    if (BigInt(event.at) > BigInt(catalog.native.maxTime)) report('scenario', ['initialEvents', index, 'at'], 'capacity', 'Initial event exceeds the configured simulation time')
  })
  const needs: readonly [number, number, (string | number)[], string][] = [
    [1 + definition.positions.length + definition.actors.length, limits.native.maxEntities, ['limits', 'native', 'maxEntities'], 'Initial entities'],
    [definition.actors.length, limits.team.maxParticipants, ['limits', 'team', 'maxParticipants'], 'Initial participants and their Sessions'],
    [definition.actors.length, limits.team.maxActivations, ['limits', 'team', 'maxActivations'], 'Initial actor activations'],
    [definition.actors.length - 1, limits.team.maxChannels, ['limits', 'team', 'maxChannels'], 'Private director channels'],
    [definition.initialEvents.length, limits.native.maxPendingEvents, ['limits', 'native', 'maxPendingEvents'], 'Initial events'],
    [definition.initialEvents.length, limits.world.maxRequests, ['limits', 'world', 'maxRequests'], 'Initial business applications'],
    [2, limits.native.maxOperationsPerDecision, ['limits', 'native', 'maxOperationsPerDecision'], 'Expanded world request and notification'],
  ]
  for (const [needed, available, path, subject] of needs) {
    if (needed > available) report('scenario', path, 'capacity', `${subject} exceed the effective limit`)
  }
  return diagnostics
}

/**
 * Resolve a profile already proven present by relationship validation.
 * @param definition - The selected runtime profile reference.
 * @param catalog - The same validated installed metadata snapshot.
 * @returns the exact installed version; callers must first validate relationships.
 */
export function selectedProfile(definition: { runtimeProfile: WorldScenario['runtimeProfile'] }, catalog: ScenarioCatalog): ScenarioRuntimeProfile {
  // Relationship validation establishes this exact installed version before materialization.
  return catalog.runtimeProfiles.find(value => referenceKey(value) === referenceKey(definition.runtimeProfile)) as ScenarioRuntimeProfile
}

/**
 * Resolve omitted persona fields from the explicit installed defaults.
 * @param defaults - Complete trusted template defaults.
 * @param requested - Optional scenario overrides validated against finite template choices.
 * @returns a complete persona selection without mutating either input.
 */
export function resolvePersona(defaults: SimulationWorldPersona, requested: WorldScenario['actors'][number]['persona']): SimulationWorldPersona {
  return { name: requested?.name ?? defaults.name, skills: requested?.skills ?? defaults.skills,
    traits: requested?.traits ?? defaults.traits, goals: requested?.goals ?? defaults.goals }
}
