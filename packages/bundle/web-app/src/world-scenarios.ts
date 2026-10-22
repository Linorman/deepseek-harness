/** Editable starter worlds; ordinary goals describe work rather than scripted model responses. */
import { worldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import type { ScenarioV1Catalog, WorldScenarioV1 } from '@clocky/clocky-simulation-scenario'

/**
 * Build the three public templates from the bundle's installed finite Personas and domain inventory.
 * @param catalog - Complete Web installation; each starter selects one installed Persona family.
 * @returns portable definitions for independent new runs, without deployment routes or allocated identities.
 */
export function webWorldTemplates(catalog: ScenarioV1Catalog): {
  id: string
  version: string
  name: string
  definition: WorldScenarioV1
}[] {
  return [
    { id: 'company', name: '软件工作室 / Software studio', template: 'company-person',
      description: 'A small software studio plans a collaborative prototype. Decide how one additional colleague could help.',
      position: 'Engineer' },
    { id: 'laboratory', name: '研究实验室 / Research laboratory', template: 'laboratory-person',
      description: 'An independent laboratory plans a reproducible research project. Decide how one additional researcher could help.',
      position: 'Researcher' },
    { id: 'association', name: '读书协会 / Reading association', template: 'association-person',
      description: 'A neighbourhood reading association plans a public reading event. Decide how one additional volunteer could help.',
      position: 'Volunteer' },
  ].map((scene) => {
    const family = catalog.templates.find(value => value.template.id === scene.template)
    if (family === undefined) throw new Error('Web starter requires its installed Persona family')
    const reference = { id: 'world-agent', version: '1' }, template = { id: family.template.id, version: family.template.version }
    const interval = { validFrom: '0', validUntil: null }
    const permission = (operation: string, targetId: string) => {
      const pin = catalog.domains.find(value => value.pin.operation === operation
        && (operation !== 'interact' || value.pin.version === '3'))?.pin
      if (pin === undefined) throw new Error('Web starter requires its installed operation')
      return { domain: pin.domain, operation: pin.operation, version: pin.version, scopeId: 'organization',
        targetId, relation: operation === 'generate-and-hire' ? 'can-hire' : `can-${operation}` }
    }
    const managerPermissions = ['generate-and-hire', 'hire-existing', 'transfer', 'depart']
      .map(operation => permission(operation, 'contributor-position'))
    const governancePermissions = ['propose-norm', 'vote', 'propose-hire-approval', 'enact-norm', 'revoke-norm']
      .map(operation => permission(operation, 'committee'))
    const externalPermissions = [permission('interact', 'partner')]
    const permissions = [...managerPermissions, ...governancePermissions, ...externalPermissions]
    const actors = ['director', 'organiser', 'reviewer'].map((id, index) => {
      const name = family.template.names[index]
      if (name === undefined) throw new Error('Web starter requires three named initial Personas')
      return { id, name, description: id === 'director'
        ? 'Coordinates permitted world requests; does not hold an organizational office.'
        : id === 'organiser' ? 'Organises work and may request staffing within the recorded permissions.' : 'Independently reviews committee proposals.',
      kind: 'person', cognition: 'agent', role: id === 'director' ? 'director' : 'member', runtimeProfile: reference, template,
      persona: { ...family.defaultPersona, name },
      }
    })
    const definition = worldScenarioV1Schema.parse({
      apiVersion: 'clocky.world/v1', metadata: { id: `web-${scene.id}`, name: scene.name, description: scene.description },
      runtimeProfiles: { allowed: [reference], generated: reference, templates: [template] },
      domains: catalog.domains.map(({ pin: { domain, operation, version } }) => ({ domain, operation, version })),
      entities: [{ id: 'organization', name: scene.name, description: scene.description, kind: 'organization', cognition: 'none' },
        { id: 'partner', name: 'External partner', description: 'A simulated potential partner. Inventory and contractual promises are unknown.',
          kind: 'organization', cognition: 'none' }, ...actors],
      organization: { rootId: 'organization', units: [],
        positions: [
          { id: 'organiser-position', name: 'Organiser', description: 'Coordinates staffing and work.', unitId: 'organization',
            capacity: 1, permissions },
          { id: 'reviewer-position', name: 'Reviewer', description: 'Reviews proposals independently.', unitId: 'organization',
            capacity: 1, permissions: [permission('vote', 'committee')] },
          { id: 'contributor-position', name: scene.position, description: 'An initially vacant contributor position.', unitId: 'organization',
            capacity: 1, permissions: [] },
        ],
        assignments: ['organiser', 'reviewer'].map(id => ({ id: `assignment-${id}`, personId: id, positionId: `${id}-position`, ...interval })),
        grants: [...permissions.map((value, index) => ({ id: `organiser-grant-${index}`, personId: 'organiser', ...value, ...interval })),
          { id: 'reviewer-vote', personId: 'reviewer', ...permission('vote', 'committee'), ...interval }] },
      governance: { committees: [{ id: 'committee', name: 'Review committee', description: 'Two independent members; both must agree.',
        scopeId: 'organization', members: ['organiser', 'reviewer'].map(personId => ({ id: `membership-${personId}`, personId, ...interval })),
        rule: { kind: 'unanimity' }, quorum: 2 }],
      norms: [{ id: 'working-principles', scopeId: 'organization', body: 'Discuss important decisions and distinguish facts from assumptions.',
        effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' }, enforcement: { kind: 'advisory' } }] },
      facts: [{ id: 'mission', subjectId: 'organization', scopeId: 'organization', body: scene.description,
        effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' } }],
      knowledge: [], resources: [],
      communication: { channels: [{ key: 'workroom', members: ['organiser', 'reviewer'].map(personId => ({ personId, role: 'member' })) }] },
      externalWorld: { mode: 'simulated-only', identities: [{ scopeId: 'organization', externalKey: 'partner',
        subjectId: 'partner', representation: 'director-mediated' }],
      adjudicationPolicy: { ref: 'clocky.external.adjudication/1', version: '1', generation: 1,
        conditionInstalls: [], futureConditionInstalls: [], allowedOutcomeKinds: ['failure', 'unverified-report'],
        maxDelay: '30', allowPublicDisclosure: false, allowScopeDisclosure: true, actorDisclosure: [] } },
      behavior: { initialGoals: [{ id: 'staffing', kind: 'goal', at: '1', target: { kind: 'person', personId: 'organiser' },
        body: `${scene.description} Inspect your current authority and the vacant contributor position. If useful, request one new colleague through the installed generate-and-hire operation. Use only the recorded scope and position; a submitted request is not a completed hire.` }],
      calendars: [], directorEvents: [] },
      limits: { native: {}, team: {}, world: {} },
    })
    return { id: `world-${scene.id}-v1`, version: '1', name: scene.name, definition }
  })
}
