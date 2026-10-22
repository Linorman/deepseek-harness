/**
 * React-free World authoring draft: one canonical JSON model, the last raw source text and its format,
 * bounded undo history, and the section/column map the form editor renders.
 *
 * The form edits exact model paths; source text is regenerated only when the source view opens. Syntax-only
 * decoding uses the Host's own decoder; semantic rules stay in the shared compiler and Host preflight.
 */
import { parseWorldTemplatePackage, decodeScenarioInput, scenarioLimitsSchema, serializeScenarioDefinition } from '@clocky/clocky-simulation-scenario'
import type { ScenarioDiagnostic, ScenarioV1SourceDiagnostic, ScenarioSourceFormat } from '@clocky/clocky-simulation-scenario'
import type { SimulationCommandKey } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'
import { V1_SECTION_SPECS } from './world-v1-draft.ts'
import { parseWorldScenario, parseWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'

/** JSON path into the canonical model. */
export type DraftPath = readonly (string | number)[]
/** Plain JSON value. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }

/** Last explicit check: what was checked and the locally derived diagnostics, if any. */
export interface DraftCheck {
  /** Canonical model exactly as checked; diagnostics whose path value changed since are marked modified. */
  readonly model: Json
  readonly templateManifest?: import('@clocky/clocky-simulation-scenario').ScenarioTemplateManifest | undefined
  /** Source text checked from the source view, for line/column mapping. */
  readonly text?: string | undefined
  readonly format: ScenarioSourceFormat
  /** Shared-compiler diagnostics found before contacting the Host; absent when the Host preflight ran. */
  readonly local?: readonly (ScenarioDiagnostic | ScenarioV1SourceDiagnostic)[] | undefined
}

/** One retained authoring slot; body text never enters URLs or browser storage. */
export interface WorldAuthorDraft {
  readonly layout?: readonly { readonly id: string; readonly x: number; readonly y: number }[] | undefined
  readonly templateManifest?: import('@clocky/clocky-simulation-scenario').ScenarioTemplateManifest | undefined
  readonly savedDraftId?: string | undefined
  readonly savedRevision?: number | undefined
  readonly pendingSave?: import('@clocky/clocky-client-runtime/client').ScenarioDraftSave | undefined
  readonly slot: string
  readonly name: string
  /** Canonical model; `undefined` only while source text has a syntax error and was never parsed. */
  readonly model: Json
  /** Raw source the user last typed, or regenerated text; `edited` marks hand-authored layout. */
  readonly source: { readonly text: string; readonly format: ScenarioSourceFormat; readonly edited: boolean }
  /** Whether the source text currently decodes to `model`. */
  readonly syntax: { readonly ok: true } | { readonly ok: false; readonly line?: number | undefined; readonly column?: number | undefined }
  readonly view: 'form' | 'source' | 'graph'
  /** User acknowledged that form edits regenerate hand-authored source. */
  readonly regenerateAcknowledged: boolean
  readonly past: readonly Json[]
  readonly future: readonly Json[]
  readonly check?: DraftCheck | undefined
  readonly commandKey?: SimulationCommandKey | undefined
  /** Display counter written by the workbench after each check, used by the chooser. */
  readonly diagnosticCount: number
}

/**
 * Required skeleton for a blank definition; empty strings are deliberately invalid until filled.
 * @returns a fresh editable JSON model requiring completion before preflight.
 */
export function blankModel(): Json {
  return { apiVersion: 'clocky.world/v1', metadata: { id: '', name: '', description: '' },
    runtimeProfiles: { allowed: [], generated: { id: '', version: '1' }, templates: [] }, domains: [], entities: [],
    organization: { rootId: '', units: [], positions: [], assignments: [], grants: [] }, governance: { committees: [], norms: [] },
    facts: [], knowledge: [], resources: [], communication: { channels: [] }, externalWorld: { mode: 'simulated-only', identities: [] },
    behavior: { initialGoals: [], calendars: [], directorEvents: [] }, limits: { native: {}, team: {}, world: {} } }
}

/**
 * Create a new slot from a model and optional raw source.
 * @param slot - Opaque slot identity.
 * @param name - Draft display name.
 * @param model - Initial canonical model.
 * @param source - Imported raw text, preserved verbatim.
 * @returns a form-view draft, or a source-view draft when the imported text has a syntax error.
 */
export function createDraft(slot: string, name: string, model: Json,
  source?: { text: string; format: ScenarioSourceFormat }): WorldAuthorDraft {
  if (source !== undefined) {
    const packageValue = parseWorldTemplatePackage(source.text, source.format)
    if (packageValue.ok) return { ...createDraft(slot, name, packageValue.value.definition as Json),
      templateManifest: packageValue.value.manifest }
    const decoded = decodeSyntax(source.text, source.format)
    return { slot, name, model: decoded.ok ? decoded.value : model, source: { ...source, edited: true },
      syntax: decoded.ok ? { ok: true } : { ok: false, line: decoded.line, column: decoded.column },
      view: decoded.ok ? 'form' : 'source', regenerateAcknowledged: false, past: [], future: [], diagnosticCount: decoded.ok ? 0 : 1 }
  }
  return { slot, name, model, source: { text: serializeScenarioDefinition(model, 'json'), format: 'json', edited: false },
    syntax: { ok: true }, view: 'form', regenerateAcknowledged: false, past: [], future: [], diagnosticCount: 0 }
}

/**
 * Syntax-only decoding with the Host decoder; no semantic checks run.
 * @param text - Raw source.
 * @param format - Explicit syntax; never guessed.
 * @returns decoded JSON or the first syntax location.
 */
export function decodeSyntax(text: string, format: ScenarioSourceFormat):
{ ok: true; value: Json } | { ok: false; line?: number | undefined; column?: number | undefined; message: string } {
  const decoded = decodeScenarioInput(text, format)
  if (decoded.ok) return { ok: true, value: decoded.value as Json }
  const first = decoded.diagnostics[0]
  return { ok: false, line: first?.line, column: first?.column, message: first?.message ?? 'Invalid source' }
}

/**
 * Locate a model path inside source text.
 * @param text - Raw source.
 * @param format - Source syntax.
 * @param path - Model path.
 * @returns one-based location when the decoder can map it.
 */
export function locatePath(text: string, format: ScenarioSourceFormat, path: DraftPath): { line: number; column: number } | undefined {
  const decoded = decodeScenarioInput(text, format)
  if (!decoded.ok) return undefined
  for (let length = path.length; length >= 0; length--) {
    const found = decoded.locate(path.slice(0, length))
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Serialize the model in an explicit syntax.
 * @param model - Canonical model.
 * @param format - Output syntax.
 * @returns text with one final newline.
 */
export function serialize(model: Json, format: ScenarioSourceFormat): string {
  return serializeScenarioDefinition(model, format)
}

/**
 * Read one path; missing segments return undefined.
 * @param model - Canonical model.
 * @param path - JSON path.
 * @returns the value at the path.
 */
export function getPath(model: Json | undefined, path: DraftPath): Json | undefined {
  let current: Json | undefined = model
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = Array.isArray(current) ? (current as readonly Json[])[segment as number]
      : (current as { readonly [key: string]: Json })[segment as string]
  }
  return current
}

/**
 * Immutable path write; `undefined` deletes an object key or array element.
 * @param model - Canonical model.
 * @param path - JSON path, creating missing objects along the way.
 * @param value - New value.
 * @returns a new model sharing untouched branches.
 */
export function setPath(model: Json, path: DraftPath, value: Json | undefined): Json {
  if (path.length === 0) return value ?? null
  const [head, ...rest] = path as [string | number, ...(string | number)[]]
  if (Array.isArray(model) && typeof head === 'number') {
    const copy = [...model as readonly Json[]]
    if (rest.length === 0 && value === undefined) copy.splice(head, 1)
    else copy[head] = setPath(copy[head] ?? (typeof rest[0] === 'number' ? [] : {}), rest, value)
    return copy
  }
  const object = model !== null && typeof model === 'object' && !Array.isArray(model) ? model as { readonly [key: string]: Json } : {}
  if (rest.length === 0 && value === undefined) {
    const { [String(head)]: _removed, ...retained } = object
    return retained
  }
  return { ...object, [head]: setPath(object[String(head)] ?? (typeof rest[0] === 'number' ? [] : {}), rest, value) }
}

const HISTORY = 20

/**
 * Apply a form edit: record undo history, invalidate redo, and mark source for regeneration.
 * @param draft - Current draft.
 * @param model - Next canonical model.
 * @param depth - Undo depth.
 * @returns next draft; the source text is regenerated lazily when the source view opens.
 */
export function editModel(draft: WorldAuthorDraft, model: Json, depth = HISTORY): WorldAuthorDraft {
  if (JSON.stringify(model) === JSON.stringify(draft.model)) return draft
  return { ...draft, model, past: [...draft.past, draft.model].slice(-depth), future: [],
    source: { ...draft.source, text: serialize(model, draft.source.format), edited: false }, syntax: { ok: true } }
}

/**
 * Apply raw source typing. Syntax errors keep the text and freeze the form until fixed.
 * @param draft - Current draft.
 * @param text - New raw text.
 * @param depth - Undo depth.
 * @returns next draft with the decoded model when syntax is valid.
 */
export function editSource(draft: WorldAuthorDraft, text: string, depth = HISTORY): WorldAuthorDraft {
  const decoded = decodeSyntax(text, draft.source.format)
  const source = { ...draft.source, text, edited: true }
  if (!decoded.ok) return { ...draft, source, syntax: { ok: false, line: decoded.line, column: decoded.column } }
  const changed = JSON.stringify(decoded.value) !== JSON.stringify(draft.model)
  return { ...draft, source, syntax: { ok: true }, model: decoded.value,
    past: changed ? [...draft.past, draft.model].slice(-depth) : draft.past, future: changed ? [] : draft.future }
}

/**
 * Switch syntax for the source view; regenerates text from the model when syntax is valid.
 * @param draft - Current draft.
 * @param format - Requested syntax.
 * @returns next draft, unchanged when the current text cannot be decoded.
 */
export function switchFormat(draft: WorldAuthorDraft, format: ScenarioSourceFormat): WorldAuthorDraft {
  if (!draft.syntax.ok || draft.source.format === format) return draft
  return { ...draft, source: { text: serialize(draft.model, format), format, edited: false } }
}

/**
 * Step undo history.
 * @param draft - Current draft.
 * @param direction - `undo` or `redo`.
 * @returns next draft, or the same draft when no step exists.
 */
export function step(draft: WorldAuthorDraft, direction: 'undo' | 'redo'): WorldAuthorDraft {
  const from = direction === 'undo' ? draft.past : draft.future
  const target = from.at(-1)
  if (target === undefined) return draft
  const rest = from.slice(0, -1)
  const next = direction === 'undo' ? { past: rest, future: [...draft.future, draft.model] } : { past: [...draft.past, draft.model], future: rest }
  return { ...draft, ...next, model: target, syntax: { ok: true },
    source: { ...draft.source, text: serialize(target, draft.source.format), edited: false } }
}

/**
 * Authored UTF-8 bytes compared against `maxWorldDraftBytes`: the name plus the larger of the canonical model and
 * the raw source. Both hold the same definition, so the allowance matches the Host's source ceiling instead of
 * refusing a file that fits it.
 * @param draft - Draft slot.
 * @returns byte count of the larger authored representation.
 */
export function draftBytes(draft: Pick<WorldAuthorDraft, 'model' | 'source' | 'name' | 'pendingSave' | 'layout' | 'templateManifest'>): number {
  const encoder = new TextEncoder()
  return encoder.encode(draft.name).byteLength
    + (draft.layout === undefined && draft.templateManifest === undefined ? 0
      : encoder.encode(JSON.stringify({ layout: draft.layout, templateManifest: draft.templateManifest })).byteLength)
    + (draft.pendingSave === undefined ? 0 : encoder.encode(JSON.stringify(draft.pendingSave)).byteLength)
    + Math.max(encoder.encode(JSON.stringify(draft.model)).byteLength, encoder.encode(draft.source.text).byteLength)
}

/**
 * Parse the explicitly tagged draft through its exact public compiler version.
 * @param model - Canonical draft or raw source text.
 * @param format - Selected source syntax.
 * @param versionModel - Canonical model used to select the version for raw source checks.
 * @returns the strict v0/v1 definition or field diagnostics without model or owner IO.
 */
export function parseDraft(model: unknown, format: ScenarioSourceFormat, versionModel: Json):
ReturnType<typeof parseWorldScenario> | ReturnType<typeof parseWorldScenarioV1> {
  return asObject(versionModel).apiVersion === 'clocky.world/v1'
    ? parseWorldScenarioV1(model, format) : parseWorldScenario(model, format)
}

/**
 * Select exact field ownership for this explicitly tagged draft.
 * @param model - Canonical model whose version selects the v0 or v1 field map.
 * @returns all section contracts for that compiler version.
 */
export function sectionSpecs(model: Json): Readonly<Record<SectionId, SectionSpec>> {
  return asObject(model).apiVersion === 'clocky.world/v1' ? V1_SECTION_SPECS : SECTION_SPECS
}

/**
 * Convert edited compound JSON without dropping malformed text or turning null interval ends into empty strings.
 * @param column - Original owned column contract.
 * @param value - User text, including incomplete input.
 * @returns exact parsed JSON or the original invalid text for a later field diagnostic.
 */
export function cellValue(column: Column, value: string): Json | undefined {
  if (column.optional && value === '') return undefined
  if (column.kind === 'nullable-time' && value === '') return null
  if (column.kind === 'json') {
    const decoded = decodeSyntax(value, 'json')
    return decoded.ok ? decoded.value : value
  }
  return column.kind === 'integer' && /^-?[0-9]+$/.test(value.trim()) ? Number(value.trim()) : value
}

// ── Sections and columns ──

/** Section identity, in display order. */
export type SectionId = 'basics' | 'organization' | 'people' | 'committees' | 'norms' | 'knowledge' | 'resources'
  | 'external' | 'channels' | 'events' | 'runtime'
/** Sections the installed `clocky.world/v0` compiler accepts; the rest are reserved. */
export const V0_SECTIONS: readonly SectionId[] = ['basics', 'organization', 'people', 'events', 'runtime']
/** Every section in display order. */
export const SECTIONS: readonly SectionId[] = ['basics', 'organization', 'people', 'committees', 'norms', 'knowledge',
  'resources', 'external', 'channels', 'events', 'runtime']

/** Symbol kinds a reference column can select. */
export type SymbolKind = 'entity' | 'organization' | 'position' | 'actor' | 'template' | 'committee' | 'channel' | 'external' | 'account'
/** One editable column. */
export type Column = (
  | { readonly id: string; readonly label: Key; readonly kind: 'text' | 'time' | 'nullable-time' | 'longtext' | 'json'; readonly path: DraftPath }
  | { readonly id: string; readonly label: Key; readonly kind: 'integer'; readonly path: DraftPath }
  | { readonly id: string; readonly label: Key; readonly kind: 'choice'; readonly path: DraftPath; readonly options: readonly { id: string; label: Key }[] }
  | { readonly id: string; readonly label: Key; readonly kind: 'ref'; readonly path: DraftPath; readonly symbol: SymbolKind }
) & { readonly optional?: boolean | undefined }
/** One table bound to an array path. */
export interface TableSpec {
  readonly id: string
  readonly title: Key
  readonly path: DraftPath
  readonly columns: readonly Column[]
  /** New row template. */
  readonly blank: () => Json
}
/** One scalar field bound to a path. */
export interface FieldSpec { readonly id: string; readonly label: Key; readonly path: DraftPath; readonly kind: 'text' | 'longtext' | 'integer' | 'json' }
/** Section contents. */
export interface SectionSpec {
  readonly id: SectionId
  readonly title: Key
  readonly fields: readonly FieldSpec[]
  readonly tables: readonly TableSpec[]
  /** Top-level model keys this section owns; used to find source-only fields. */
  readonly owns: readonly string[]
}

const role = [{ id: 'director', label: 'world.role.director' }, { id: 'member', label: 'world.role.member' }] as const
const text = (id: string, label: Key, path: DraftPath = [id]): Column => ({ id, label, kind: 'text', path })
const ref = (id: string, label: Key, symbol: SymbolKind, path: DraftPath = [id]): Column => ({ id, label, kind: 'ref', path, symbol })

/** Section map. Reserved sections use proposed paths and stay read-only until the compiler accepts them. */
export const SECTION_SPECS: Readonly<Record<SectionId, SectionSpec>> = {
  basics: { id: 'basics', title: 'world.section.basics', owns: ['apiVersion', 'metadata', 'organization', 'runtimeProfile', 'templates'], fields: [
    { id: 'metadata.name', label: 'world.field.name', path: ['metadata', 'name'], kind: 'text' },
    { id: 'metadata.id', label: 'world.field.metadataId', path: ['metadata', 'id'], kind: 'text' },
    { id: 'metadata.description', label: 'world.field.description', path: ['metadata', 'description'], kind: 'longtext' },
    { id: 'organization.name', label: 'world.field.organizationName', path: ['organization', 'name'], kind: 'text' },
    { id: 'organization.id', label: 'world.field.organizationId', path: ['organization', 'id'], kind: 'text' },
    { id: 'organization.description', label: 'world.field.organizationDescription', path: ['organization', 'description'], kind: 'longtext' },
    { id: 'runtimeProfile.id', label: 'world.field.runtimeProfile', path: ['runtimeProfile', 'id'], kind: 'text' },
    { id: 'runtimeProfile.version', label: 'world.field.version', path: ['runtimeProfile', 'version'], kind: 'text' },
  ], tables: [{ id: 'templates', title: 'world.field.templates', path: ['templates'], blank: () => ({ id: '', version: '1' }),
    columns: [text('id', 'world.field.id'), text('version', 'world.field.version')] }] },
  organization: { id: 'organization', title: 'world.section.organization', owns: ['positions'], fields: [], tables: [
    { id: 'positions', title: 'world.subsection.positions', path: ['positions'], blank: () => ({ id: '', name: '', capacity: 1 }),
      columns: [text('name', 'world.field.name'), text('id', 'world.field.id'),
        { id: 'capacity', label: 'world.field.capacity', kind: 'integer', path: ['capacity'] }] }] },
  people: { id: 'people', title: 'world.section.people', owns: ['actors', 'assignments', 'authorizations'], fields: [], tables: [
    { id: 'actors', title: 'world.subsection.actors', path: ['actors'],
      blank: () => ({ id: '', role: 'member', template: { id: '', version: '1' }, persona: { name: '' } }),
      columns: [text('persona', 'world.field.persona', ['persona', 'name']), text('id', 'world.field.id'),
        { id: 'role', label: 'world.field.role', kind: 'choice', path: ['role'], options: role },
        ref('template', 'world.field.template', 'template', ['template', 'id'])] },
    { id: 'assignments', title: 'world.subsection.assignments', path: ['assignments'], blank: () => ({ id: '', personId: '', positionId: '' }),
      columns: [text('id', 'world.field.id'), ref('personId', 'world.field.person', 'actor'), ref('positionId', 'world.field.position', 'position')] },
    { id: 'authorizations', title: 'world.subsection.authorizations', path: ['authorizations'], blank: () => ({ id: '', requesterId: '', positionId: '' }),
      columns: [text('id', 'world.field.id'), ref('requesterId', 'world.field.requester', 'actor'), ref('positionId', 'world.field.position', 'position')] },
  ] },
  committees: { id: 'committees', title: 'world.section.committees', owns: ['committees'], fields: [], tables: [
    { id: 'committees', title: 'world.section.committees', path: ['committees'],
      blank: () => ({ id: '', name: '', members: '', rule: 'absolute', threshold: 1, quorum: 1, term: '' }),
      columns: [text('name', 'world.field.name'), text('id', 'world.field.id'), text('members', 'world.field.members'),
        { id: 'rule', label: 'world.field.rule', kind: 'choice', path: ['rule'],
          options: [{ id: 'unanimous', label: 'world.vote.rule.unanimous' }, { id: 'absolute', label: 'world.field.threshold' }] },
        { id: 'threshold', label: 'world.field.threshold', kind: 'integer', path: ['threshold'] },
        { id: 'quorum', label: 'world.field.quorum', kind: 'integer', path: ['quorum'] },
        { id: 'term', label: 'world.field.term', kind: 'time', path: ['term'] }] }] },
  norms: { id: 'norms', title: 'world.section.norms', owns: ['norms'], fields: [], tables: [
    { id: 'norms', title: 'world.section.norms', path: ['norms'],
      blank: () => ({ id: '', text: '', scope: '', audience: '', from: '0', knowable: '0', enforcement: 'advisory' }),
      columns: [text('id', 'world.field.id'), { id: 'text', label: 'world.field.text', kind: 'longtext', path: ['text'] },
        text('scope', 'world.field.scope'), text('audience', 'world.field.audience'),
        { id: 'from', label: 'world.field.from', kind: 'time', path: ['from'] },
        { id: 'until', label: 'world.field.until', kind: 'time', path: ['until'] },
        { id: 'knowable', label: 'world.field.knowable', kind: 'time', path: ['knowable'] },
        { id: 'enforcement', label: 'world.field.enforcement', kind: 'choice', path: ['enforcement'],
          options: [{ id: 'advisory', label: 'world.enforcement.advisory' }, { id: 'validated', label: 'world.enforcement.validated' }] },
        text('policy', 'world.field.policy')] }] },
  knowledge: { id: 'knowledge', title: 'world.section.knowledge', owns: ['knowledge'], fields: [], tables: [
    { id: 'knowledge', title: 'world.section.knowledge', path: ['knowledge'], blank: () => ({ id: '', owner: '', source: '', text: '' }),
      columns: [text('id', 'world.field.id'), ref('owner', 'world.field.owner', 'actor'), text('source', 'world.field.source'),
        { id: 'text', label: 'world.field.text', kind: 'longtext', path: ['text'] }] }] },
  resources: { id: 'resources', title: 'world.section.resources', owns: ['resources'], fields: [], tables: [
    { id: 'resources', title: 'world.section.resources', path: ['resources'], blank: () => ({ id: '', unit: '', quantity: '0', controller: '' }),
      columns: [text('id', 'world.field.account'), text('unit', 'world.field.unit'),
        { id: 'quantity', label: 'world.field.quantity', kind: 'time', path: ['quantity'] }, ref('controller', 'world.field.controller', 'actor')] }] },
  external: { id: 'external', title: 'world.section.external', owns: ['externalParties'], fields: [], tables: [
    { id: 'externalParties', title: 'world.section.external', path: ['externalParties'],
      blank: () => ({ key: '', name: '', representation: 'rule', facts: '' }),
      columns: [text('key', 'world.field.externalKey'), text('name', 'world.field.name'),
        { id: 'representation', label: 'world.field.representation', kind: 'choice', path: ['representation'],
          options: [{ id: 'rule', label: 'world.source.rule' }, { id: 'director-ruling', label: 'world.source.director-ruling' },
            { id: 'simulated-actor', label: 'world.source.simulated-actor' }] },
        { id: 'facts', label: 'world.field.facts', kind: 'longtext', path: ['facts'] }] }] },
  channels: { id: 'channels', title: 'world.section.channels', owns: ['channels'], fields: [], tables: [
    { id: 'channels', title: 'world.section.channels', path: ['channels'], blank: () => ({ id: '', members: '' }),
      columns: [text('id', 'world.field.channel'), text('members', 'world.field.members')] }] },
  events: { id: 'events', title: 'world.section.events', owns: ['initialEvents', 'calendars'], fields: [], tables: [
    { id: 'initialEvents', title: 'world.subsection.initialEvents', path: ['initialEvents'],
      blank: () => ({ kind: 'hire-request', applicationId: '', requesterId: '', positionId: '', at: '0', description: '' }),
      columns: [text('applicationId', 'world.field.application'),
        { id: 'kind', label: 'world.field.kind', kind: 'choice', path: ['kind'], options: [{ id: 'hire-request', label: 'world.action.hire-existing' }] },
        ref('requesterId', 'world.field.requester', 'actor'), ref('positionId', 'world.field.position', 'position'),
        { id: 'at', label: 'world.field.at', kind: 'time', path: ['at'] },
        { id: 'description', label: 'world.field.description', kind: 'longtext', path: ['description'] }] },
  ] },
  runtime: { id: 'runtime', title: 'world.section.runtime', owns: ['limits'], fields: [], tables: [] },
}

/** Allowance keys grouped as the shared limits schema declares them. */
export const LIMIT_GROUPS: readonly { readonly group: 'native' | 'team' | 'world'; readonly keys: readonly string[] }[] = [
  { group: 'native', keys: Object.keys(scenarioLimitsSchema.shape.native.shape) },
  { group: 'team', keys: Object.keys(scenarioLimitsSchema.shape.team.shape) },
  { group: 'world', keys: Object.keys(scenarioLimitsSchema.shape.world.shape) },
]

/**
 * Whether a section has any authored content.
 * @param model - Canonical model.
 * @param section - Section spec.
 * @returns true when any owned field or table has content.
 */
export function sectionFilled(model: Json, section: SectionSpec): boolean {
  if (section.id === 'runtime' && asObject(model).apiVersion !== 'clocky.world/v1')
    return Object.keys(asObject(getPath(model, ['limits']))).length > 0
  return section.fields.some((field) => { const value = getPath(model, field.path); return value !== undefined && value !== '' })
    || section.tables.some(table => asArray(getPath(model, table.path)).length > 0)
}

/**
 * Paths inside a section that the form cannot edit and which therefore remain source-only.
 * @param model - Canonical model.
 * @param section - Section spec.
 * @returns exact source-only paths (never deleted by form edits).
 */
export function sourceOnlyPaths(model: Json, section: SectionSpec): DraftPath[] {
  const paths: DraftPath[] = []
  if (asObject(model).apiVersion === 'clocky.world/v1') {
    const specs = Object.values(sectionSpecs(model))
    const editable = specs.flatMap(spec => [...spec.fields.map(value => value.path), ...spec.tables.map(value => value.path)])
    const known: readonly DraftPath[] = [...editable, ['apiVersion'], ['externalWorld', 'mode'],
      ...LIMIT_GROUPS.flatMap(group => group.keys.map(key => ['limits', group.group, key]))]
    const startsWith = (path: DraftPath, prefix: DraftPath) => prefix.every((part, index) => path[index] === part)
    const walk = (value: Json | undefined, path: DraftPath) => {
      if (known.some(item => item.length === path.length && startsWith(item, path))) return
      if (!known.some(item => startsWith(item, path))) {
        if (sectionOf(path, model) === section.id) paths.push(path)
        return
      }
      for (const [key, nested] of Object.entries(asObject(value))) walk(nested, [...path, key])
    }
    for (const [key, value] of Object.entries(asObject(model))) walk(value, [key])
  }
  if (section.id === 'basics') {
    const owned = new Set(Object.values(sectionSpecs(model)).flatMap(item => item.owns))
    for (const key of Object.keys(asObject(model))) if (!owned.has(key)) paths.push([key])
    for (const group of (asObject(model).apiVersion === 'clocky.world/v1' ? ['metadata'] : ['metadata', 'organization', 'runtimeProfile'])) {
      const known = new Set(section.fields.filter(field => field.path[0] === group).map(field => field.path[1]))
      for (const key of Object.keys(asObject(getPath(model, [group])))) if (!known.has(key)) paths.push([group, key])
    }
  }
  for (const table of section.tables) {
    const known = new Set(table.columns.map(column => column.path[0]))
    if (asObject(model).apiVersion === 'clocky.world/v1' && table.id === 'initialGoals') known.add('kind')
    asArray(getPath(model, table.path)).forEach((row, index) => {
      for (const key of Object.keys(asObject(row))) if (!known.has(key)) paths.push([...table.path, index, key])
      for (const column of table.columns) {
        if (column.path.length < 2) continue
        const nested = asObject(getPath(row, column.path.slice(0, -1)))
        const allowed = new Set(table.columns.filter(item => item.path[0] === column.path[0]).map(item => item.path[1]))
        if (column.path[0] === 'template') allowed.add('version')
        for (const key of Object.keys(nested)) if (!allowed.has(key)) paths.push([...table.path, index, column.path[0] as string, key])
      }
    })
  }
  return paths.filter((path, index, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(path)) === index)
}

/** Declared symbols of one kind, as `{ id, name }`. */
export interface DraftSymbol { readonly id: string; readonly name: string }

/**
 * Symbols declared inside the draft only; nothing is read from the Host.
 * @param model - Canonical model.
 * @param kind - Symbol kind.
 * @returns declared identities with display names.
 */
export function symbols(model: Json, kind: SymbolKind): DraftSymbol[] {
  const label = (value: Json | undefined) => typeof value === 'string' ? value : JSON.stringify(value)
  const rows = (path: string) => asArray(getPath(model, [path])).map(row => asObject(row))
  const named = (path: string, idKey = 'id', nameOf: (row: { readonly [key: string]: Json }) => unknown = row => row.name) =>
    rows(path).flatMap(row => typeof row[idKey] === 'string' && row[idKey] !== ''
      ? [{ id: row[idKey], name: typeof nameOf(row) === 'string' && nameOf(row) !== '' ? nameOf(row) as string : row[idKey] }] : [])
  if (asObject(model).apiVersion === 'clocky.world/v1') {
    const from = (path: DraftPath, predicate: (value: Readonly<Record<string, Json>>) => boolean = () => true): DraftSymbol[] =>
      asArray(getPath(model, path)).map(asObject).filter(predicate).flatMap(row => typeof row.id === 'string' && row.id !== ''
        ? [{ id: row.id, name: typeof row.name === 'string' ? row.name : row.id }] : [])
    switch (kind) {
      case 'entity': return [...from(['entities']), ...from(['organization', 'positions']), ...from(['governance', 'committees'])]
      case 'organization': return from(['entities'], row => row.kind === 'organization')
      case 'actor': return from(['entities'], row => row.kind === 'person' && row.cognition === 'agent')
      case 'position': return from(['organization', 'positions'])
      case 'committee': return from(['governance', 'committees'])
      case 'template': return from(['runtimeProfiles', 'templates'])
      case 'account': return from(['resources'])
      case 'channel': return asArray(getPath(model, ['communication', 'channels'])).map(asObject).flatMap(row =>
        typeof row.key === 'string' ? [{ id: row.key, name: row.key }] : [])
      case 'external': return asArray(getPath(model, ['externalWorld', 'identities'])).map(asObject).flatMap(row =>
        typeof row.subjectId === 'string' ? [{ id: row.subjectId, name: typeof row.externalKey === 'string' ? row.externalKey : row.subjectId }] : [])
    }
  }
  switch (kind) {
    case 'entity': return [...named('actors'), ...named('positions')]
    case 'organization': { const value = asObject(getPath(model, ['organization']))
      return typeof value.id === 'string' ? [{ id: value.id, name: label(value.name) || value.id }] : [] }
    case 'position': return named('positions')
    case 'actor': return named('actors', 'id', row => asObject(row.persona).name)
    case 'template': return named('templates', 'id', row => `${label(row.id)} v${label(row.version)}`)
    case 'committee': return named('committees')
    case 'channel': return named('channels')
    case 'external': return named('externalParties', 'key')
    case 'account': return named('resources')
    default: { const unreachable: never = kind; throw new Error(`Unknown symbol kind ${String(unreachable)}`) }
  }
}

/**
 * Section owning a diagnostic path.
 * @param path - Diagnostic path.
 * @param model - Canonical draft selecting exact v1 ownership; omitted for legacy paths.
 * @returns owning section; unknown paths belong to basics.
 */
export function sectionOf(path: DraftPath, model?: Json): SectionId {
  const head = path[0]
  if (head === 'limits' || head === 'domains' || head === 'runtimeProfiles') return 'runtime'
  if (head === 'governance') return path[1] === 'norms' ? 'norms' : 'committees'
  if (head === 'organization' && model !== undefined && asObject(model).apiVersion === 'clocky.world/v1') return 'organization'
  return SECTIONS.find(id => (model === undefined ? SECTION_SPECS : sectionSpecs(model))[id].owns.includes(String(head))) ?? 'basics'
}

/**
 * Cell position of a diagnostic inside a section table, for locating.
 * @param path - Diagnostic path.
 * @param model - Canonical draft selecting its version's table map; omitted for legacy paths.
 * @returns table id, row index and column id when the path lands in a table.
 */
export function cellOf(path: DraftPath, model?: Json): { table: string; row: number; column?: string | undefined } | undefined {
  for (const section of SECTIONS) {
    for (const table of (model === undefined ? SECTION_SPECS : sectionSpecs(model))[section].tables) {
      if (path.length <= table.path.length || table.path.some((segment, index) => path[index] !== segment)) continue
      const row = path[table.path.length]
      if (typeof row !== 'number') return undefined
      const rest = path.slice(table.path.length + 1)
      const column = table.columns.find(item => item.path.every((segment, index) => rest[index] === segment))
        ?? table.columns.find(item => item.path[0] === rest[0])
      return { table: table.id, row, column: column?.id }
    }
  }
  return undefined
}

/**
 * Human-readable path: "Positions › Chief scientist › Capacity".
 * @param model - Canonical model.
 * @param path - Diagnostic path.
 * @param label - Translator for column titles.
 * @returns readable breadcrumb.
 */
export function readablePath(model: Json, path: DraftPath, label: (key: Key) => string): string {
  const cell = cellOf(path, model)
  if (cell === undefined) {
    const field = Object.values(sectionSpecs(model)).flatMap(section => section.fields)
      .find(item => item.path.length === path.length && item.path.every((segment, index) => segment === path[index]))
    return field === undefined ? path.join('.') || '/' : label(field.label)
  }
  const table = Object.values(sectionSpecs(model)).flatMap(section => section.tables).find(item => item.id === cell.table)
  if (table === undefined) return path.join('.')
  const row = asObject(getPath(model, [...table.path, cell.row]))
  const persona = asObject(row.persona).name
  const name = [row.name, persona, row.id, row.applicationId, row.key].find(value => typeof value === 'string' && value !== '') as string | undefined
  const column = table.columns.find(item => item.id === cell.column)
  return [label(table.title), name ?? `#${String(cell.row + 1)}`, ...column === undefined ? [] : [label(column.label)]].join(' › ')
}

/**
 * Whether a diagnostic's path value changed since the checked model.
 * @param checked - Model as checked.
 * @param current - Current model.
 * @param path - Diagnostic path.
 * @returns true when the user edited the value the diagnostic is about.
 */
export function pathModified(checked: Json, current: Json, path: DraftPath): boolean {
  const scope = cellOf(path, current) === undefined ? path : path.slice(0, Math.max(path.length - 1, 1))
  return JSON.stringify(getPath(checked, scope)) !== JSON.stringify(getPath(current, scope))
}

/**
 * Display text for a scalar cell or field; structured values stay visible as JSON.
 * @param value - Any JSON value at a form path.
 * @returns empty text for absent values, the string itself, or canonical JSON.
 */
export function scalarText(value: Json | undefined): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * Object view of a JSON value.
 * @param value - Any JSON.
 * @returns the object, or an empty object for non-objects.
 */
export function asObject(value: Json | undefined): { readonly [key: string]: Json } {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as { readonly [key: string]: Json } : {}
}
/**
 * Array view of a JSON value.
 * @param value - Any JSON.
 * @returns the array, or empty for non-arrays.
 */
export function asArray(value: Json | undefined): readonly Json[] {
  return Array.isArray(value) ? value as readonly Json[] : []
}
