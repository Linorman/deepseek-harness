/** Complete v1 form ownership mirrors the portable schema; compound cells retain complete JSON values. */
import type { Column, DraftPath, FieldSpec, Json, SectionId, SectionSpec, SymbolKind, TableSpec } from './world-draft.ts'
import type { Key } from './locales.ts'

const text = (id: string, label: Key, path: DraftPath = [id]): Column => ({ id, label, kind: 'text', path })
const json = (id: string, label: Key, path: DraftPath = [id]): Column => ({ id, label, kind: 'json', path })
const ref = (id: string, label: Key, symbol: SymbolKind, path: DraftPath = [id]): Column => ({ id, label, kind: 'ref', symbol, path })
const time = (id: string, label: Key, nullable = false): Column => ({ id, label, kind: nullable ? 'nullable-time' : 'time', path: [id] })
const body = (id = 'body'): Column => ({ id, label: id === 'description' ? 'world.field.description' : 'world.field.text', kind: 'longtext', path: [id] })
const temporal = [time('validFrom', 'world.field.from'), time('validUntil', 'world.field.until', true)]
const effective = [time('effectiveFrom', 'world.field.from'), time('effectiveUntil', 'world.field.until', true),
  time('availableAt', 'world.field.knowable')]
const field = (id: string, label: Key, path: DraftPath, kind: FieldSpec['kind'] = 'text'): FieldSpec => ({ id, label, path, kind })
const table = (id: string, title: Key, path: DraftPath, columns: readonly Column[], blank: () => Json): TableSpec =>
  ({ id, title, path, columns, blank })
const section = (id: SectionId, title: Key, owns: readonly string[], tables: readonly TableSpec[] = [],
  fields: readonly FieldSpec[] = []): SectionSpec => ({ id, title, owns, tables, fields })

/** Every supported v1 authoring group has exact form paths; execution-only director declarations remain explicitly diagnosed. */
export const V1_SECTION_SPECS: Readonly<Record<SectionId, SectionSpec>> = {
  basics: section('basics', 'world.section.basics', ['apiVersion', 'metadata'], [], [
    field('metadata.id', 'world.field.metadataId', ['metadata', 'id']),
    field('metadata.name', 'world.field.name', ['metadata', 'name']),
    field('metadata.description', 'world.field.description', ['metadata', 'description'], 'longtext'),
  ]),
  organization: section('organization', 'world.section.organization', ['organization'], [
    table('units', 'world.field.units', ['organization', 'units'],
      [ref('id', 'world.field.unit', 'organization'), ref('parentId', 'world.field.parent', 'organization')], () => ({ id: '', parentId: '' })),
    table('positions', 'world.subsection.positions', ['organization', 'positions'], [text('id', 'world.field.id'), text('name', 'world.field.name'),
      body('description'), ref('unitId', 'world.field.unit', 'organization'), { id: 'capacity', label: 'world.field.capacity', kind: 'integer', path: ['capacity'] },
      json('permissions', 'world.field.permissions')], () => ({ id: '', name: '', description: '', unitId: '', capacity: 1, permissions: [] })),
    table('assignments', 'world.subsection.assignments', ['organization', 'assignments'], [text('id', 'world.field.id'),
      ref('personId', 'world.field.person', 'actor'), ref('positionId', 'world.field.position', 'position'), ...temporal],
    () => ({ id: '', personId: '', positionId: '', validFrom: '0', validUntil: null })),
    table('grants', 'world.field.grants', ['organization', 'grants'], [text('id', 'world.field.id'), ref('personId', 'world.field.person', 'actor'),
      text('domain', 'world.field.domain'), text('operation', 'world.field.operation'), text('version', 'world.field.version'),
      ref('scopeId', 'world.field.scope', 'organization'), ref('targetId', 'world.field.target', 'entity'), text('relation', 'world.field.relation'), ...temporal],
    () => ({ id: '', personId: '', domain: '', operation: '', version: '1', scopeId: '', targetId: '', relation: '', validFrom: '0', validUntil: null })),
  ], [field('organization.rootId', 'world.field.organizationId', ['organization', 'rootId'])]),
  people: section('people', 'world.section.people', ['entities'], [
    table('entities', 'world.field.entities', ['entities'], [text('id', 'world.field.id'), text('name', 'world.field.name'), body('description'),
      { id: 'kind', label: 'world.field.kind', kind: 'choice', path: ['kind'], options: [
        { id: 'person', label: 'world.field.person' }, { id: 'organization', label: 'world.section.organization' }] },
      { id: 'cognition', label: 'world.field.cognition', kind: 'choice', path: ['cognition'], options: [
        { id: 'agent', label: 'world.field.agent' }, { id: 'none', label: 'world.preview.none' }] },
      { id: 'role', label: 'world.field.role', kind: 'choice', path: ['role'], optional: true, options: [
        { id: 'director', label: 'world.role.director' }, { id: 'member', label: 'world.role.member' }] },
      { ...json('runtimeProfile', 'world.field.runtimeProfile'), optional: true },
      { ...json('template', 'world.field.template'), optional: true }, { ...json('persona', 'world.field.personaDetails'), optional: true }],
    () => ({ id: '', name: '', description: '', kind: 'person', cognition: 'agent', role: 'member',
      runtimeProfile: { id: '', version: '1' }, template: { id: '', version: '1' }, persona: { name: '', skills: [], traits: [], goals: [] } })),
  ]),
  committees: section('committees', 'world.section.committees', ['governance'], [
    table('committees', 'world.section.committees', ['governance', 'committees'], [text('id', 'world.field.id'), text('name', 'world.field.name'),
      body('description'), ref('scopeId', 'world.field.scope', 'organization'), json('members', 'world.field.members'), json('rule', 'world.field.rule'),
      { id: 'quorum', label: 'world.field.quorum', kind: 'integer', path: ['quorum'] }],
    () => ({ id: '', name: '', description: '', scopeId: '', members: [], rule: { kind: 'unanimity' }, quorum: 1 })),
  ]),
  norms: section('norms', 'world.section.norms', ['governance', 'facts'], [
    table('norms', 'world.section.norms', ['governance', 'norms'], [text('id', 'world.field.id'), ref('scopeId', 'world.field.scope', 'organization'),
      body(), ...effective, json('audience', 'world.field.audience'), json('enforcement', 'world.field.enforcement')],
    () => ({ id: '', scopeId: '', body: '', effectiveFrom: '0', effectiveUntil: null, availableAt: '0',
      audience: { kind: 'public' }, enforcement: { kind: 'advisory' } })),
    table('facts', 'world.field.facts', ['facts'], [text('id', 'world.field.id'), ref('subjectId', 'world.field.target', 'entity'),
      ref('scopeId', 'world.field.scope', 'organization'), body(), ...effective, json('audience', 'world.field.audience')],
    () => ({ id: '', subjectId: '', scopeId: '', body: '', effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' } })),
  ]),
  knowledge: section('knowledge', 'world.section.knowledge', ['knowledge'], [
    table('knowledge', 'world.section.knowledge', ['knowledge'], [text('id', 'world.field.id'), ref('ownerId', 'world.field.owner', 'actor'), body(),
      time('observedAt', 'world.field.observed'), time('availableAt', 'world.field.knowable'), ...temporal, json('readers', 'world.field.readers')],
    () => ({ id: '', ownerId: '', body: '', observedAt: '0', availableAt: '0', validFrom: '0', validUntil: null, readers: [] })),
  ]),
  resources: section('resources', 'world.section.resources', ['resources'], [
    table('resources', 'world.section.resources', ['resources'], [text('id', 'world.field.id'), ref('owner', 'world.field.owner', 'entity'),
      { id: 'kind', label: 'world.field.kind', kind: 'choice', path: ['kind'], options: [
        { id: 'money', label: 'world.field.money' }, { id: 'inventory', label: 'world.field.inventory' }] },
      text('unit', 'world.field.unit'), text('quantity', 'world.field.quantity'), json('controllers', 'world.field.controllers')],
    () => ({ id: '', owner: '', kind: 'inventory', unit: '', quantity: '0', controllers: [] })),
  ]),
  external: section('external', 'world.section.external', ['externalWorld'], [
    table('identities', 'world.section.external', ['externalWorld', 'identities'], [ref('scopeId', 'world.field.scope', 'organization'),
      text('externalKey', 'world.field.externalKey'), ref('subjectId', 'world.field.target', 'entity'),
      { id: 'representation', label: 'world.field.representation', kind: 'choice', path: ['representation'], options: [
        { id: 'simulated-rule', label: 'world.source.rule' }, { id: 'simulated-actor', label: 'world.source.simulated-actor' },
        { id: 'director-mediated', label: 'world.source.director-ruling' }] }],
    () => ({ scopeId: '', externalKey: '', subjectId: '', representation: 'simulated-rule' })),
  ], [field('externalWorld.adjudicationPolicy', 'world.field.policy', ['externalWorld', 'adjudicationPolicy'], 'json')]),
  channels: section('channels', 'world.section.channels', ['communication'], [
    table('channels', 'world.section.channels', ['communication', 'channels'], [text('key', 'world.field.channel'), json('members', 'world.field.members')],
      () => ({ key: '', members: [] })),
  ]),
  events: section('events', 'world.section.events', ['behavior'], [
    table('initialGoals', 'world.field.goals', ['behavior', 'initialGoals'], [text('id', 'world.field.id'),
      time('at', 'world.field.at'), json('target', 'world.field.target'), body()],
    () => ({ id: '', kind: 'goal', at: '0', target: { kind: 'person', personId: '' }, body: '' })),
    table('calendars', 'world.field.calendar', ['behavior', 'calendars'], [text('id', 'world.field.id'), json('target', 'world.field.target'), body(),
      time('startsAt', 'world.field.from'), time('endsAt', 'world.field.until', true), time('period', 'world.field.period'),
      { id: 'maxOccurrences', label: 'world.field.maxFires', kind: 'integer', path: ['maxOccurrences'] }],
    () => ({ id: '', target: { kind: 'person', personId: '' }, body: '', startsAt: '0', endsAt: null, period: '1', maxOccurrences: 1 })),
    table('directorEvents', 'world.field.directorEvents', ['behavior', 'directorEvents'], [text('id', 'world.field.id'),
      text('calendarId', 'world.field.calendar'),
      { id: 'maxRequests', label: 'world.field.directorRequestLimit', kind: 'integer', path: ['maxRequests'] },
      text('domain', 'world.field.domain'), text('operation', 'world.field.operation'), text('version', 'world.field.version'),
      ref('scopeId', 'world.field.scope', 'organization'), ref('targetId', 'world.field.target', 'entity')],
    () => ({ id: '', calendarId: '', maxRequests: 1, domain: '', operation: '', version: '1', scopeId: '', targetId: '' })),
  ]),
  runtime: section('runtime', 'world.section.runtime', ['runtimeProfiles', 'domains', 'limits'], [
    table('allowedProfiles', 'world.field.runtimeProfile', ['runtimeProfiles', 'allowed'], [text('id', 'world.field.id'), text('version', 'world.field.version')],
      () => ({ id: '', version: '1' })),
    table('templates', 'world.field.templates', ['runtimeProfiles', 'templates'], [text('id', 'world.field.id'), text('version', 'world.field.version')],
      () => ({ id: '', version: '1' })),
    table('domains', 'world.field.domain', ['domains'], [text('domain', 'world.field.domain'), text('operation', 'world.field.operation'), text('version', 'world.field.version')],
      () => ({ domain: '', operation: '', version: '1' })),
  ], [field('generated.id', 'world.field.generatedRuntime', ['runtimeProfiles', 'generated', 'id']),
    field('generated.version', 'world.field.version', ['runtimeProfiles', 'generated', 'version'])]),
}
