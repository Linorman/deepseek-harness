import { compileCalendarTimes } from '@clocky/clocky-simulation/world-authoring'
/** Pure field diagnostics for the portable v1 definition; no Native, Team, model or identity provider is called. */
import type { WorldScenarioV1, ScenarioV1Catalog, ScenarioV1Diagnostic } from './v1-schema.ts'

function effectiveLimits<T extends Record<string, number>>(defaults: T, ceilings: T,
  requested: { [Key in keyof T]?: T[Key] | undefined }): T {
  return Object.fromEntries(Object.entries(defaults)
    .map(([key, value]) => [key, Math.min(requested[key] ?? value, ceilings[key] ?? value)])) as T
}

const versionKey = (value: { id: string; version: string }) => JSON.stringify([value.id, value.version])
const operationKey = (value: { domain: string; operation: string; version: string }) =>
  JSON.stringify([value.domain, value.operation, value.version])

/** Validate cross-owner symbols and temporal relationships before materializing any command.
 * @param definition - Strict portable v1 authoring input.
 * @param catalog - Exact installed deployment choices and ceilings.
 * @returns field diagnostics without allocating identities or executing world IO.
 */
export function validateV1Relationships(definition: WorldScenarioV1, catalog: ScenarioV1Catalog): ScenarioV1Diagnostic[] {
  const diagnostics: ScenarioV1Diagnostic[] = []
  const report = (path: (string | number)[], code: ScenarioV1Diagnostic['code'], message: string) => {
    diagnostics.push({ path, code, message })
  }
  if (definition.metadata.description.trim().length === 0) report(['metadata', 'description'], 'invalid-shape',
    'The initial Team objective must contain non-whitespace text')
  const limits = { native: effectiveLimits(catalog.limits.defaults.native, catalog.limits.ceilings.native, definition.limits.native),
    team: effectiveLimits(catalog.limits.defaults.team, catalog.limits.ceilings.team, definition.limits.team),
    world: effectiveLimits(catalog.limits.defaults.world, catalog.limits.ceilings.world, definition.limits.world) }
  for (const group of ['native', 'team', 'world'] as const) {
    const ceilings: Readonly<Record<string, number>> = catalog.limits.ceilings[group]
    for (const [key, value] of Object.entries(definition.limits[group])) {
      if (value !== undefined && ceilings[key] !== undefined && value > ceilings[key])
        report(['limits', group, key], 'capacity', 'Explicit limit exceeds its deployment ceiling; select a supported value instead of clamping')
    }
  }
  const duplicate = <T>(rows: readonly T[], field: (value: T) => string, path: (string | number)[]) => {
    const seen = new Set<string>()
    rows.forEach((row, index) => {
      const id = field(row)
      if (seen.has(id)) report([...path, index], 'duplicate-id', 'Identity must be unique in its owner namespace')
      seen.add(id)
    })
  }
  const entities = new Map<string, { kind: string; cognitive: boolean }>()
  const declare = (id: string, kind: string, cognitive: boolean, path: (string | number)[]) => {
    if (entities.has(id)) report([...path, 'id'], 'duplicate-id', 'Entity identity is already declared')
    else entities.set(id, { kind, cognitive })
  }
  definition.entities.forEach((value, index) => { declare(value.id, value.kind, value.cognition === 'agent', ['entities', index]) })
  definition.organization.positions.forEach((value, index) => { declare(value.id, 'position', false, ['organization', 'positions', index]) })
  definition.governance.committees.forEach((value, index) => { declare(value.id, 'organization', false, ['governance', 'committees', index]) })
  const reference = (id: string, path: (string | number)[], kind?: string, cognitive = false) => {
    const value = entities.get(id)
    if (value === undefined) report(path, 'unknown-reference', 'Referenced Entity must be declared')
    else if (kind !== undefined && value.kind !== kind || cognitive && !value.cognitive)
      report(path, 'invalid-reference', 'Referenced Entity has an incompatible kind or cognition')
  }
  const time = (value: string | null, path: (string | number)[]) => {
    if (value !== null && BigInt(value) > BigInt(catalog.native.maxTime)) report(path, 'time-horizon', 'Time exceeds the frozen horizon')
  }
  const interval = (value: { validFrom: string; validUntil: string | null }, path: (string | number)[]) => {
    time(value.validFrom, [...path, 'validFrom']); time(value.validUntil, [...path, 'validUntil'])
  }
  const audience = (value: { kind: string; entityIds?: readonly string[] }, path: (string | number)[]) => {
    value.entityIds?.forEach((id, index) => { reference(id, [...path, 'entityIds', index]) })
  }
  definition.entities.forEach((value, index) => {
    if (value.kind !== 'person-state') return
    reference(value.evolution.personId, ['entities', index, 'evolution', 'personId'], 'person', true)
    value.evolution.audience.forEach((id, audienceIndex) =>{  reference(id, ['entities', index, 'evolution', 'audience', audienceIndex], 'person', true) })
  })
  reference(definition.organization.rootId, ['organization', 'rootId'], 'organization')
  const directors = definition.entities.filter(value => value.kind === 'person' && value.cognition === 'agent' && value.role === 'director')
  if (directors.length !== 1) report(['entities'], 'unauthorized-role', 'Exactly one cognitive director must be declared')
  duplicate(definition.runtimeProfiles.allowed, versionKey, ['runtimeProfiles', 'allowed'])
  duplicate(definition.runtimeProfiles.templates, versionKey, ['runtimeProfiles', 'templates'])
  duplicate(definition.runtimeProfiles.templates, value => value.id, ['runtimeProfiles', 'templates'])
  const allowedProfiles = new Set(definition.runtimeProfiles.allowed.map(versionKey))
  const allowedTemplates = new Set(definition.runtimeProfiles.templates.map(versionKey))
  const installedProfiles = new Map(catalog.runtimeProfiles.map(value => [versionKey(value), value]))
  const installedTemplates = new Map(catalog.templates.map(value => [versionKey(value.template), value]))
  definition.runtimeProfiles.allowed.forEach((value, index) => {
    const installed = installedProfiles.get(versionKey(value))
    if (installed === undefined) report(['runtimeProfiles', 'allowed', index], 'unknown-reference', 'Runtime profile version must be installed')
    else if (!installed.available || !installed.model.available)
      report(['runtimeProfiles', 'allowed', index], 'model-unavailable', 'Selected runtime and model route must be available')
  })
  definition.runtimeProfiles.templates.forEach((value, index) => {
    if (!installedTemplates.has(versionKey(value))) report(['runtimeProfiles', 'templates', index], 'unknown-reference', 'Template version must be installed')
  })
  const generated = installedProfiles.get(versionKey(definition.runtimeProfiles.generated))
  if (!allowedProfiles.has(versionKey(definition.runtimeProfiles.generated)) || generated === undefined || !generated.roles.includes('member'))
    report(['runtimeProfiles', 'generated'], 'unauthorized-role', 'Generated actors require a declared member-capable runtime')
  definition.entities.forEach((value, index) => {
    if (value.kind !== 'person' || value.cognition !== 'agent') return
    const path = ['entities', index], installed = installedProfiles.get(versionKey(value.runtimeProfile))
    if (value.persona.name.trim().length === 0) report([...path, 'persona', 'name'], 'invalid-shape',
      'The initial Participant display name must contain non-whitespace text')
    if (!allowedProfiles.has(versionKey(value.runtimeProfile)) || installed === undefined)
      report([...path, 'runtimeProfile'], 'unknown-reference', 'Actor runtime must be declared and installed')
    else if (!installed.roles.includes(value.role)) report([...path, 'role'], 'unauthorized-role', 'Selected runtime does not admit this role')
    const template = installedTemplates.get(versionKey(value.template))?.template
    if (!allowedTemplates.has(versionKey(value.template)) || template === undefined)
      report([...path, 'template'], 'unknown-reference', 'Actor template must be declared and installed')
    else {
      if (!template.names.includes(value.persona.name)) report([...path, 'persona', 'name'], 'template-choice', 'Name must belong to the finite template')
      for (const key of ['skills', 'traits', 'goals'] as const) if (value.persona[key].some(item => !template[key].includes(item)))
        report([...path, 'persona', key], 'template-choice', 'Persona choice exceeds its finite template')
    }
  })
  duplicate(definition.domains, operationKey, ['domains'])
  const domains = new Set(definition.domains.map(operationKey))
  const installedDomains = new Map(catalog.domains.map(value => [operationKey(value.pin), value]))
  definition.domains.forEach((value, index) => {
    if (!installedDomains.get(operationKey(value))?.available)
      report(['domains', index], 'domain-unavailable', 'Exact domain operation version must be installed and accepting')
  })
  const units = new Map(definition.organization.units.map(value => [value.id, value.parentId]))
  duplicate(definition.organization.units, value => value.id, ['organization', 'units'])
  definition.organization.units.forEach((value, index) => {
    reference(value.id, ['organization', 'units', index, 'id'], 'organization')
    reference(value.parentId, ['organization', 'units', index, 'parentId'], 'organization')
    if (value.id === definition.organization.rootId) report(['organization', 'units', index, 'id'], 'organization-cycle',
      'The declared root cannot be its own managed descendant')
    const visited = new Set<string>(), path = ['organization', 'units', index, 'parentId']
    let current: string | undefined = value.id
    while (current !== undefined && current !== definition.organization.rootId) {
      if (visited.has(current)) { report(path, 'organization-cycle', 'Organization parent relationships must be acyclic'); break }
      visited.add(current); current = units.get(current)
    }
    if (current === undefined) report(path, 'unknown-reference', 'Managed unit must lead to the declared root organization')
  })
  const relations = [
    ...definition.organization.assignments.map((value, index) => ({ id: value.id, path: ['organization', 'assignments', index, 'id'] })),
    ...definition.organization.grants.map((value, index) => ({ id: value.id, path: ['organization', 'grants', index, 'id'] })),
    ...definition.governance.committees.flatMap((value, index) => value.members.map((member, offset) =>
      ({ id: member.id, path: ['governance', 'committees', index, 'members', offset, 'id'] }))),
    ...definition.organization.units.map((value, index) => ({ id: `unit-parent:${value.id}`, path: ['organization', 'units', index, 'id'] })),
  ]
  const relationIds = new Set<string>()
  for (const value of relations) {
    if (relationIds.has(value.id)) report(value.path, 'duplicate-id', 'Relation identity is already declared')
    relationIds.add(value.id)
  }
  definition.organization.assignments.forEach((value, index) => {
    const path = ['organization', 'assignments', index]
    reference(value.personId, [...path, 'personId'], 'person', true); reference(value.positionId, [...path, 'positionId'], 'position')
    interval(value, path)
    if (definition.organization.assignments.slice(0, index).some(prior => prior.personId === value.personId
      && (prior.validUntil === null || BigInt(value.validFrom) < BigInt(prior.validUntil))
      && (value.validUntil === null || BigInt(prior.validFrom) < BigInt(value.validUntil))))
      report(path, 'assignment-overlap', 'A person cannot hold overlapping assignments')
  })
  const permission = (value: { domain: string; operation: string; version: string; scopeId: string; targetId: string },
    path: (string | number)[]) => {
    if (!domains.has(operationKey(value))) report(path, 'domain-unavailable', 'Permission operation must be declared')
    reference(value.scopeId, [...path, 'scopeId'], 'organization'); reference(value.targetId, [...path, 'targetId'])
  }
  const reservedRelations = new Set(['assignment', 'committee-member', 'represents', 'organization-parent'])
  definition.organization.positions.forEach((value, index) => {
    const path = ['organization', 'positions', index]
    reference(value.unitId, [...path, 'unitId'], 'organization')
    if (value.unitId !== definition.organization.rootId && !units.has(value.unitId))
      report([...path, 'unitId'], 'unknown-reference', 'Position must belong to a managed organization unit')
    value.permissions.forEach((item, offset) => {
      const itemPath = [...path, 'permissions', offset]
      permission(item, itemPath)
      if (reservedRelations.has(item.relation)) report([...itemPath, 'relation'], 'invalid-reference', 'Permission cannot create a structural relationship')
      if (item.scopeId !== definition.organization.rootId)
        report([...itemPath, 'scopeId'], 'unsupported-scope', 'Position permissions currently require the primary World scope')
    })
    duplicate(value.permissions, item => JSON.stringify(item), [...path, 'permissions'])
    const assignments = definition.organization.assignments.filter(item => item.positionId === value.id)
    const boundaries = new Set(assignments.flatMap(item => item.validUntil === null ? [item.validFrom] : [item.validFrom, item.validUntil]))
    for (const boundary of boundaries) if (assignments.filter(item => BigInt(item.validFrom) <= BigInt(boundary)
      && (item.validUntil === null || BigInt(boundary) < BigInt(item.validUntil))).length > value.capacity)
      report([...path, 'capacity'], 'capacity', 'Overlapping assignments exceed position capacity')
  })
  definition.organization.grants.forEach((value, index) => {
    const path = ['organization', 'grants', index]
    reference(value.personId, [...path, 'personId'], 'person', true); permission(value, path); interval(value, path)
    if (reservedRelations.has(value.relation)) report([...path, 'relation'], 'invalid-reference', 'Grant cannot create a structural relationship')
    if (value.personId === directors[0]?.id) report([...path, 'personId'], 'unauthorized-role', 'Director world events require their explicit calendar authorization')
    if (value.domain === 'organization' && value.operation === 'generate-and-hire') reference(value.targetId, [...path, 'targetId'], 'position')
    if (BigInt(value.validFrom) > 0n) report([...path, 'validFrom'], 'unsupported-feature',
      'Native World installation requires live permission at time zero; future grants need a supported later-admission owner')
    if (value.domain === 'organization' && value.operation === 'generate-and-hire' || value.domain === 'external' && value.operation === 'interact') {
      if (value.scopeId !== definition.organization.rootId) report([...path, 'scopeId'], 'unsupported-scope',
        'This installed operation requires the primary World scope; select the declared root organization')
    }
    if (value.domain === 'external' && value.operation === 'interact') reference(value.targetId, [...path, 'targetId'], 'organization')
    if (value.domain === 'organization' && value.operation === 'generate-and-hire' && value.version === '1'
      && definition.organization.grants.slice(0, index).some(prior => prior.domain === value.domain
        && prior.operation === value.operation && prior.version === value.version
        && prior.personId === value.personId && prior.targetId === value.targetId))
      report(path, 'duplicate-id', 'Native hiring authorizations require a distinct actor-position pair')
  })
  definition.governance.committees.forEach((value, index) => {
    const path = ['governance', 'committees', index]
    reference(value.scopeId, [...path, 'scopeId'], 'organization')
    value.members.forEach((item, offset) => { reference(item.personId, [...path, 'members', offset, 'personId'], 'person', true)
      interval(item, [...path, 'members', offset]) })
    value.members.forEach((member, offset) => {
      if (value.members.slice(0, offset).some(prior => prior.personId === member.personId
        && (prior.validUntil === null || BigInt(member.validFrom) < BigInt(prior.validUntil))
        && (member.validUntil === null || BigInt(prior.validFrom) < BigInt(member.validUntil))))
        report([...path, 'members', offset], 'membership-overlap', 'Committee membership for one person cannot overlap')
    })
    const boundaries = new Set(value.members.flatMap(member => member.validUntil === null
      ? [member.validFrom] : [member.validFrom, member.validUntil]))
    const peak = Math.max(0, ...[...boundaries].map(at => new Set(value.members.filter(member => BigInt(member.validFrom) <= BigInt(at)
      && (member.validUntil === null || BigInt(at) < BigInt(member.validUntil))).map(member => member.personId)).size))
    if (value.quorum > peak || value.rule.kind === 'absolute-threshold' && value.rule.yes > peak)
      report([...path, 'rule'], 'committee-threshold', 'Quorum and yes threshold must be reachable by declared members')
  })
  duplicate(definition.facts, value => value.id, ['facts'])
  definition.facts.forEach((value, index) => {
    const path = ['facts', index]
    reference(value.subjectId, [...path, 'subjectId']); reference(value.scopeId, [...path, 'scopeId'], 'organization')
    time(value.effectiveFrom, [...path, 'effectiveFrom']); time(value.effectiveUntil, [...path, 'effectiveUntil'])
    time(value.availableAt, [...path, 'availableAt']); audience(value.audience, [...path, 'audience'])
  })
  duplicate(definition.governance.norms, value => value.id, ['governance', 'norms'])
  definition.governance.norms.forEach((value, index) => {
    const path = ['governance', 'norms', index]
    reference(value.scopeId, [...path, 'scopeId'], 'organization'); time(value.effectiveFrom, [...path, 'effectiveFrom'])
    time(value.effectiveUntil, [...path, 'effectiveUntil']); time(value.availableAt, [...path, 'availableAt'])
    audience(value.audience, [...path, 'audience'])
    if (value.enforcement.kind === 'validated') {
      if (!catalog.normPolicies.includes(value.enforcement.policyRef)) report([...path, 'enforcement'], 'policy-unavailable', 'Validated primitive must be installed')
      reference(value.enforcement.params.committeeId, [...path, 'enforcement', 'params', 'committeeId'], 'organization')
      if (!definition.governance.committees.some(item => value.enforcement.kind === 'validated'
        && item.id === value.enforcement.params.committeeId))
        report([...path, 'enforcement', 'params', 'committeeId'], 'invalid-reference', 'Hiring policy requires a declared committee')
      if (value.scopeId !== definition.organization.rootId) report([...path, 'scopeId'], 'unsupported-scope',
        'Initial validated hiring policy currently enforces only the primary World organization')
      if (!definition.governance.committees.some(item => value.enforcement.kind === 'validated'
        && item.id === value.enforcement.params.committeeId && item.scopeId === value.scopeId))
        report([...path, 'enforcement', 'params', 'committeeId'], 'invalid-reference', 'Hiring policy committee must own the same institution scope')
      value.enforcement.params.positionIds.forEach((id, offset) => {
        reference(id, [...path, 'enforcement', 'params', 'positionIds', offset], 'position')
      })
    }
  })
  duplicate(definition.knowledge, value => value.id, ['knowledge'])
  definition.knowledge.forEach((value, index) => {
    const path = ['knowledge', index]
    reference(value.ownerId, [...path, 'ownerId'], 'person', true); interval(value, path)
    time(value.observedAt, [...path, 'observedAt']); time(value.availableAt, [...path, 'availableAt'])
    if (BigInt(value.availableAt) < BigInt(value.observedAt)) report([...path, 'availableAt'], 'invalid-reference',
      'Authored belief cannot become available before its observedAt timestamp')
    value.readers.forEach((id, offset) => { reference(id, [...path, 'readers', offset]) }); duplicate(value.readers, id => id, [...path, 'readers'])
  })
  duplicate(definition.resources, value => value.id, ['resources'])
  definition.resources.forEach((value, index) => {
    const path = ['resources', index]
    reference(value.owner, [...path, 'owner'])
    value.controllers.forEach((id, offset) => { reference(id, [...path, 'controllers', offset], 'person', true) })
    duplicate(value.controllers, id => id, [...path, 'controllers'])
    if (BigInt(value.quantity) > BigInt(catalog.native.maxResourceQuantity)) report([...path, 'quantity'], 'capacity', 'Quantity exceeds its frozen owner bound')
  })
  const fees = definition.organization.hiringFees ?? []
  duplicate(fees, value => value.id, ['organization', 'hiringFees'])
  duplicate(fees, value => JSON.stringify([value.operation, value.positionEntityId]), ['organization', 'hiringFees'])
  fees.forEach((fee, index) => {
    const path = ['organization', 'hiringFees', index]
    reference(fee.positionEntityId, [...path, 'positionEntityId'], 'position')
    if (!definition.domains.some(value => value.domain === 'organization' && value.operation === fee.operation && value.version === '1'))
      report([...path, 'operation'], 'domain-unavailable', 'Hiring fee requires its explicitly declared installed operation')
    for (const field of ['from', 'to'] as const) {
      const account = definition.resources.find(value => value.id === fee[field])
      if (account === undefined) report([...path, field], 'unknown-reference', 'Hiring fee requires an existing authored account')
      else if (account.kind !== 'money' || account.unit !== fee.unit)
        report([...path, field], 'invalid-reference', 'Hiring fee requires matching money account units')
    }
    if (BigInt(fee.quantity) > BigInt(catalog.native.maxResourceQuantity))
      report([...path, 'quantity'], 'capacity', 'Hiring fee exceeds the frozen quantity bound')
    if (BigInt(fee.reservationPeriod) > BigInt(catalog.native.maxTime) - BigInt(catalog.native.origin))
      report([...path, 'reservationPeriod'], 'time-horizon', 'Hiring fee validity exceeds the simulated horizon')
  })
  duplicate(definition.communication.channels, value => value.key, ['communication', 'channels'])
  definition.communication.channels.forEach((value, index) => {
    const path = ['communication', 'channels', index]
    value.members.forEach((member, offset) => { reference(member.personId, [...path, 'members', offset, 'personId'], 'person', true) })
    duplicate(value.members, item => item.personId, [...path, 'members'])
  })
  duplicate(definition.externalWorld.identities, value => JSON.stringify([value.scopeId, value.externalKey]), ['externalWorld', 'identities'])
  definition.externalWorld.identities.forEach((value, index) => {
    reference(value.scopeId, ['externalWorld', 'identities', index, 'scopeId'], 'organization')
    reference(value.subjectId, ['externalWorld', 'identities', index, 'subjectId'], 'organization')
    if (value.subjectId === definition.organization.rootId || units.has(value.subjectId))
      report(['externalWorld', 'identities', index, 'subjectId'], 'invalid-reference', 'External subject must be outside the managed organization')
    if (value.scopeId !== definition.organization.rootId) report(['externalWorld', 'identities', index, 'scopeId'], 'unsupported-scope',
      'Initial Native external identity requires the primary World organization scope')
    const version = value.representation === 'simulated-rule' ? '1' : value.representation === 'simulated-actor' ? '2' : '3'
    if (!domains.has(operationKey({ domain: 'external', operation: 'interact', version })))
      report(['externalWorld', 'identities', index, 'representation'], 'domain-unavailable',
        'Initial representation requires its exact external.interact operation; declare that installed version')
  })
  const mediated = definition.domains.some(value => value.domain === 'external' && value.operation === 'interact' && value.version === '3')
  if (mediated && definition.externalWorld.adjudicationPolicy === undefined)
    report(['externalWorld', 'adjudicationPolicy'], 'policy-unavailable', 'Mediated operation requires its complete frozen policy')
  definition.externalWorld.adjudicationPolicy?.actorDisclosure.forEach((id, index) => {
    reference(id, ['externalWorld', 'adjudicationPolicy', 'actorDisclosure', index])
  })
  if (mediated && definition.externalWorld.adjudicationPolicy !== undefined)
    time(definition.externalWorld.adjudicationPolicy.maxDelay, ['externalWorld', 'adjudicationPolicy', 'maxDelay'])
  const target = (value: { kind: 'person'; personId: string } | { kind: 'position'; positionId: string }, path: (string | number)[]) => {
    if (value.kind === 'person') reference(value.personId, [...path, 'personId'], 'person', true)
    else reference(value.positionId, [...path, 'positionId'], 'position')
  }
  const eventIds = new Set<string>()
  for (const group of ['initialGoals', 'calendars'] as const) definition.behavior[group].forEach((value, index) => {
    if (eventIds.has(value.id)) report(['behavior', group, index, 'id'], 'duplicate-id',
      'Initial goals and calendars must have distinct source identities')
    eventIds.add(value.id)
  })
  definition.behavior.initialGoals.forEach((value, index) => {
    target(value.target, ['behavior', 'initialGoals', index, 'target']); time(value.at, ['behavior', 'initialGoals', index, 'at'])
  })
  definition.behavior.calendars.forEach((value, index) => {
    const path = ['behavior', 'calendars', index]
    target(value.target, [...path, 'target']); time(value.startsAt, [...path, 'startsAt']); time(value.endsAt, [...path, 'endsAt'])
    if (value.recurrence !== undefined || value.civil !== undefined) {
      try { for (const occurrence of compileCalendarTimes(value)) time(occurrence, [...path, 'recurrence']) }
      catch (error) { report([...path, 'recurrence'], 'time-horizon', error instanceof Error ? error.message : 'Invalid finite recurrence') }
    }
    if (value.recurrence === undefined && value.civil === undefined
      && BigInt(value.startsAt) + BigInt(value.period) * BigInt(value.maxOccurrences - 1) > BigInt(catalog.native.maxTime))
      report([...path, 'maxOccurrences'], 'time-horizon', 'Last finite occurrence exceeds the frozen horizon')
  })
  duplicate(definition.behavior.directorEvents, value => value.id, ['behavior', 'directorEvents'])
  definition.behavior.directorEvents.forEach((value, index) => {
    const path = ['behavior', 'directorEvents', index]
    const calendar = definition.behavior.calendars.find(item => item.id === value.calendarId)
    if (calendar === undefined) report([...path, 'calendarId'], 'unknown-reference', 'Director event requires its declared finite calendar')
    else if (value.maxRequests > calendar.maxOccurrences) report([...path, 'maxRequests'], 'capacity',
      'Director request budget cannot exceed its finite calendar occurrences')
    permission(value, path)
    if (value.scopeId !== definition.organization.rootId) report([...path, 'scopeId'], 'unknown-reference',
      'Director environment declaration requires the exact World root scope')
    const installed = catalog.domains.find(item => operationKey(item.pin) === operationKey(value))
    if (installed?.directorEvents !== true) report(path, 'unsupported-feature',
      'The exact installed operation does not admit scenario-authorized director events')
  })
  const actors = definition.entities.filter(value => value.kind === 'person' && value.cognition === 'agent')
  const actorIds = new Set(actors.map(value => value.id))
  const announcements = definition.governance.norms.reduce((total, norm) => total + actors.filter((actor) => {
    if (norm.audience.kind === 'public') return true
    if (norm.audience.kind === 'actors') return norm.audience.entityIds.some(id => id === actor.id)
    return norm.scopeId === definition.organization.rootId && definition.organization.assignments.some(value => value.personId === actor.id
      && BigInt(value.validFrom) <= 0n && (value.validUntil === null || BigInt(value.validUntil) > 0n))
  }).length, 0)
  const boundaryCount = definition.governance.norms.reduce((total, norm) => total + (norm.effectiveUntil === null ? 1 : 2), 0)
  const capacities: readonly [number, number, (string | number)[], string][] = [
    [entities.size, limits.native.maxEntities, ['limits', 'native', 'maxEntities'], 'Complete initial entities, positions and committees'],
    [actors.length, limits.team.maxParticipants, ['limits', 'team', 'maxParticipants'], 'Initial canonical participants'],
    [Math.max(0, actors.length - 1) + definition.communication.channels.length, limits.team.maxChannels,
      ['limits', 'team', 'maxChannels'], 'Initial generated director and authored channels'],
    [definition.behavior.initialGoals.length + definition.behavior.calendars.length + boundaryCount + announcements,
      limits.native.maxPendingEvents, ['limits', 'native', 'maxPendingEvents'], 'Initial calendars, institution boundaries and frozen announcement duties'],
  ]
  for (const [required, available, path, subject] of capacities) if (required > available)
    report(path, 'capacity', `${subject} exceed the effective initialization limit`)
  // Only a proven lower bound is rejected here: Native still verifies its complete UUID- and cursor-bearing projection.
  const data = { resources: definition.resources, facts: definition.facts, knowledge: definition.knowledge,
    norms: definition.governance.norms, committeePolicies: definition.governance.committees,
    externalIdentities: definition.externalWorld.identities, behavior: definition.behavior }
  const initialLowerBound = { request: { definitionHash: `sha256:${'0'.repeat(64)}`, actorIds: [...actorIds], data,
    definition: { templates: definition.runtimeProfiles.templates.flatMap((value) => {
      const installed = installedTemplates.get(versionKey(value))
      return installed === undefined ? [] : [installed.template]
    }), limits: limits.world } }, sequence: 1, status: 'retained', occurrences: [] }
  if (new TextEncoder().encode(JSON.stringify(initialLowerBound)).byteLength > limits.native.maxKnowledgeBytes)
    report(['limits', 'native', 'maxKnowledgeBytes'], 'capacity',
      'Even the known original bootstrap data and template bytes exceed this bound; reduce source data or select a supported allowance')
  return diagnostics
}
