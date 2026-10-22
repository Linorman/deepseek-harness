/** Bounded JSON/YAML decoding. AST checks precede YAML conversion; decoded inputs share the same JSON admission. */
import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument, stringify } from 'yaml'
import type { Node } from 'yaml'
import type { ScenarioDiagnostic, ScenarioSourceFormat } from './types.ts'

/** Fixed parser ceilings, independent of a scenario's requested execution budgets. */
export const WORLD_SCENARIO_INPUT_LIMITS = Object.freeze({
  maxBytes: 262144, maxDepth: 32, maxNodes: 16384, maxCollectionItems: 2048,
  maxReferences: 4096, maxResolvedBytes: 1048576,
})
type Path = readonly (string | number)[]
type Decoded = { readonly ok: true; readonly value: unknown; readonly locate: (path: Path) => { line: number; column: number } | undefined }
  | { readonly ok: false; readonly diagnostics: readonly ScenarioDiagnostic[] }
const size = (text: string) => new TextEncoder().encode(text).byteLength
const unsafeKey = (key: string) => key === '<<' || key === '__proto__' || key === 'prototype' || key === 'constructor'
const referenceKey = (key: string) => key === 'id' || /Ids?$/.test(key)

function invalid(source: ScenarioDiagnostic['source'], path: Path, message: string,
  format?: ScenarioSourceFormat, location?: { line: number; column: number }): ScenarioDiagnostic {
  return { source, path, code: 'invalid-shape', message, ...format === undefined ? {} : { format }, ...location }
}

/**
 * Validate an inert JSON tree before recursive schema parsing or serialization.
 * @param input - Decoded boundary input; non-JSON objects and cycles are rejected.
 * @param source - Diagnostic owner.
 * @returns the first capacity/type violation, or undefined; no getters or custom serializers are invoked.
 */
export function validateScenarioJSON(input: unknown, source: ScenarioDiagnostic['source']): ScenarioDiagnostic | undefined {
  const pending: { value: unknown; path: Path; depth: number; reference: boolean; leave?: boolean }[] = [
    { value: input, path: [], depth: 0, reference: false },
  ]
  const seen = new Set<object>()
  let nodes = 0, references = 0
  while (pending.length > 0) {
    const item = pending.pop()
    if (item === undefined) break
    if (item.leave) { seen.delete(item.value as object); continue }
    if (++nodes > WORLD_SCENARIO_INPUT_LIMITS.maxNodes) return invalid(source, item.path, 'Scenario node limit exceeded')
    if (item.depth > WORLD_SCENARIO_INPUT_LIMITS.maxDepth) return invalid(source, item.path, 'Scenario depth limit exceeded')
    const value = item.value
    if (value === null || typeof value === 'boolean') continue
    if (typeof value === 'string') {
      if (item.reference && ++references > WORLD_SCENARIO_INPUT_LIMITS.maxReferences)
        return invalid(source, item.path, 'Scenario reference limit exceeded')
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) continue
    if (typeof value !== 'object') return invalid(source, item.path, 'Scenario values must be JSON scalars, arrays or objects')
    if (seen.has(value)) return invalid(source, item.path, 'Scenario cycles are unsupported')
    seen.add(value)
    pending.push({ ...item, leave: true })
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      return invalid(source, item.path, 'Scenario values must be plain JSON objects')
    const keys = Reflect.ownKeys(value).filter(key => !(Array.isArray(value) && key === 'length'))
    if (keys.length > WORLD_SCENARIO_INPUT_LIMITS.maxCollectionItems)
      return invalid(source, item.path, 'Scenario collection limit exceeded')
    if (Array.isArray(value) && (keys.length !== value.length || keys.some((key, index) => key !== String(index))))
      return invalid(source, item.path, 'Scenario arrays must be dense JSON arrays')
    for (const key of keys.reverse()) {
      if (typeof key !== 'string' || unsafeKey(key)) return invalid(source, item.path, 'Scenario key is unsupported')
      const path = [...item.path, Array.isArray(value) ? Number(key) : key]
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
        return invalid(source, path, 'Scenario accessors and hidden properties are unsupported')
      if (++nodes > WORLD_SCENARIO_INPUT_LIMITS.maxNodes) return invalid(source, path, 'Scenario node limit exceeded')
      pending.push({ value: descriptor.value, path, depth: item.depth + 1,
        reference: Array.isArray(value) ? item.reference : referenceKey(key) })
    }
  }
  if (size(JSON.stringify(input)) > WORLD_SCENARIO_INPUT_LIMITS.maxBytes)
    return invalid(source, [], 'Scenario serialized input byte limit exceeded')
  return undefined
}

/**
 * Decode one explicit format without resolving symbols, allocating identities or loading resources.
 * @param input - Original file text or decoded JSON value.
 * @param format - Explicit source syntax; YAML text is never guessed from a failed JSON parse.
 * @returns a bounded JSON value with optional source locations, or diagnostics without input contents.
 */
export function decodeScenarioInput(input: unknown, format: ScenarioSourceFormat): Decoded {
  if (typeof input !== 'string') {
    const error = validateScenarioJSON(input, 'scenario')
    if (error !== undefined) return { ok: false, diagnostics: [error] }
    if (size(JSON.stringify(input)) > WORLD_SCENARIO_INPUT_LIMITS.maxBytes)
      return { ok: false, diagnostics: [invalid('scenario', [], 'Scenario serialized input byte limit exceeded', format)] }
    return { ok: true, value: input, locate: () => undefined }
  }
  if (size(input) > WORLD_SCENARIO_INPUT_LIMITS.maxBytes)
    return { ok: false, diagnostics: [invalid('scenario', [], 'Scenario source byte limit exceeded', format)] }
  let json: unknown
  if (format === 'json') {
    try { json = JSON.parse(input) }
    catch { return { ok: false, diagnostics: [{ source: 'scenario', path: [], code: 'invalid-json', message: 'Expected one valid JSON definition' }] } }
  }
  // YAML's maintained parser also detects duplicate keys in JSON flow mappings.
  const lines = new LineCounter()
  let document: ReturnType<typeof parseDocument>
  try { document = parseDocument(input, { version: '1.2', schema: 'core', strict: true, uniqueKeys: true,
    merge: false, resolveKnownTags: false, lineCounter: lines, prettyErrors: false }) }
  catch { return { ok: false, diagnostics: [invalid('scenario', [], 'Scenario parser capacity exceeded', format)] } }
  const problem = document.errors[0] ?? document.warnings[0]
  if (problem !== undefined) {
    const location = lines.linePos(problem.pos[0])
    return { ok: false, diagnostics: [invalid('scenario', [], `Invalid ${format.toUpperCase()} definition (${problem.code})`,
      format, { line: location.line, column: location.col })] }
  }
  if (document.directives?.yaml.explicit || (document.directives?.tags && Object.keys(document.directives.tags).some(key => key !== '!!')))
    return { ok: false, diagnostics: [invalid('scenario', [], 'YAML directives are unsupported', format)] }
  const locations = new Map<string, { line: number; column: number }>()
  const pending: { node: unknown; path: Path; depth: number }[] = [{ node: document.contents, path: [], depth: 0 }]
  let nodes = 0
  while (pending.length > 0) {
    const item = pending.pop()
    if (item === undefined) break
    const node = item.node
    const offset = node !== null && typeof node === 'object' && 'range' in node ? (node as Node).range?.[0] : undefined
    const position = offset === undefined ? undefined : lines.linePos(offset)
    const location = position === undefined ? undefined : { line: position.line, column: position.col }
    if (location !== undefined) locations.set(JSON.stringify(item.path), location)
    const fail = (message: string): Decoded => ({ ok: false, diagnostics: [invalid('scenario', item.path, message, format, location)] })
    if (++nodes > WORLD_SCENARIO_INPUT_LIMITS.maxNodes) return fail('Scenario node limit exceeded')
    if (item.depth > WORLD_SCENARIO_INPUT_LIMITS.maxDepth) return fail('Scenario depth limit exceeded')
    if (isAlias(node)) return fail('YAML aliases are unsupported')
    if (isScalar(node) || isMap(node) || isSeq(node)) {
      if (node.anchor !== undefined || node.tag !== undefined) return fail('YAML anchors and explicit tags are unsupported')
    }
    if (isMap(node)) {
      if (node.items.length > WORLD_SCENARIO_INPUT_LIMITS.maxCollectionItems) return fail('Scenario collection limit exceeded')
      for (const pair of [...node.items].reverse()) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || unsafeKey(pair.key.value)) return fail('YAML mapping keys must be supported strings')
        if (pair.key.anchor !== undefined || pair.key.tag !== undefined) return fail('YAML anchors and explicit tags are unsupported')
        if (++nodes > WORLD_SCENARIO_INPUT_LIMITS.maxNodes) return fail('Scenario node limit exceeded')
        pending.push({ node: pair.value, path: [...item.path, pair.key.value], depth: item.depth + 1 })
      }
    } else if (isSeq(node)) {
      if (node.items.length > WORLD_SCENARIO_INPUT_LIMITS.maxCollectionItems) return fail('Scenario collection limit exceeded')
      for (let index = node.items.length - 1; index >= 0; index--)
        pending.push({ node: node.items[index], path: [...item.path, index], depth: item.depth + 1 })
    } else if (isScalar(node)) {
      if (node.value === undefined || typeof node.value === 'number' && (!Number.isFinite(node.value) || node.format !== undefined))
        return fail('YAML scalars must have JSON-compatible values')
    } else if (node !== null) return fail('YAML node is unsupported')
  }
  const value: unknown = format === 'json' ? json : document.toJS({ maxAliasCount: 0 })
  const error = validateScenarioJSON(value, 'scenario')
  if (error !== undefined) return { ok: false, diagnostics: [{ ...error, format, ...locations.get(JSON.stringify(error.path)) }] }
  if (size(JSON.stringify(value)) > WORLD_SCENARIO_INPUT_LIMITS.maxBytes)
    return { ok: false, diagnostics: [invalid('scenario', [], 'Scenario serialized input byte limit exceeded', format)] }
  return { ok: true, value, locate: path => locations.get(JSON.stringify(path)) }
}

/**
 * Measure the complete frozen compiler result at its acceptance boundary.
 * @param value - Previously validated compiler JSON output.
 * @returns a capacity diagnostic if its serialized bytes exceed the fixed ceiling.
 */
export function validateScenarioResultSize(value: unknown): ScenarioDiagnostic | undefined {
  return size(JSON.stringify(value)) > WORLD_SCENARIO_INPUT_LIMITS.maxResolvedBytes
    ? invalid('preflight', [], 'Complete scenario compilation byte limit exceeded') : undefined
}

/**
 * Serialize a portable definition only; canonical hashes are independent of the chosen syntax.
 * @param definition - Strict parsed portable JSON definition.
 * @param format - Requested export syntax.
 * @returns JSON or YAML text with one final newline and no aliases, tags or live runtime state.
 */
export function serializeScenarioDefinition(definition: unknown, format: ScenarioSourceFormat): string {
  return format === 'json' ? `${JSON.stringify(definition, null, 2)}\n`
    : stringify(definition, { version: '1.2', schema: 'core', aliasDuplicateObjects: false, lineWidth: 0 })
}
