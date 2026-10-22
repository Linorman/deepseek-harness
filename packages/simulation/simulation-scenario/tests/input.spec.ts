import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
import { compileWorldScenario, exportWorldScenarioText, parseWorldScenario, verifyWorldScenario,
  worldScenarioSchema, WORLD_SCENARIO_INPUT_LIMITS as bounds } from '../src/index.ts'
import type { ScenarioCompilation, ScenarioParseResult } from '../src/index.ts'
import { validateScenarioJSON } from '../src/input.ts'
import { catalog } from './fixtures.ts'

const input = async () => worldScenarioSchema.parse(JSON.parse(await readFile(
  new URL('../../../../examples/simulation-company/scenarios/world-company.json', import.meta.url), 'utf8',
)))
function accepted(result: ScenarioCompilation) {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
}
function rejected(result: ScenarioParseResult | ScenarioCompilation, message?: RegExp) {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Unsafe input was accepted')
  if (message) expect(result.diagnostics[0]?.message).toMatch(message)
  return result.diagnostics
}

it('compiles JSON/YAML into the same immutable definition, defaults and preview without IO', async () => {
  const definition = await input(), installed = catalog()
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'))
  try {
    const json = accepted(await compileWorldScenario(JSON.stringify(definition), installed))
    const yaml = accepted(await compileWorldScenario(stringify(definition), installed, 'yaml'))
    expect(yaml).toEqual(json)
    expect(await verifyWorldScenario(stringify(definition), installed, json.preview, 'yaml')).toEqual(json)
    for (const format of ['json', 'yaml'] as const) {
      const exported = exportWorldScenarioText(yaml.resolved, format)
      expect(exported.endsWith('\n')).toBe(true)
      expect(exported).not.toMatch(/credential|sessionId|endpoint|participantId/)
      expect(await compileWorldScenario(exported, installed, format)).toEqual(json)
    }
    expect(fetch).not.toHaveBeenCalled()
  } finally { fetch.mockRestore() }
})

describe('unsafe YAML admission', () => {
  it.each([
    ['duplicate key', 'apiVersion: clocky.world/v0\napiVersion: clocky.world/v0'],
    ['custom tag', 'metadata: !include /private/credentials'],
    ['executable tag', 'metadata: !!js/function function() {}'],
    ['explicit scalar tag', 'metadata: !!str text'],
    ['explicit collection tag', 'metadata: !!map {id: company}'],
    ['anchor', 'metadata: &meta {id: company}'],
    ['anchored key', '&key metadata: value'],
    ['alias', 'metadata: *meta'],
    ['merge', 'metadata: {<<: {id: company}}'],
    ['numeric key', '1: metadata'],
    ['collection key', '? [metadata, id]\n: company'],
    ['multiple documents', '---\napiVersion: clocky.world/v0\n---\napiVersion: clocky.world/v0'],
    ['legacy directive', '%YAML 1.1\n---\napiVersion: clocky.world/v0'],
    ['tag directive', '%TAG !x! tag:example.com,2026:\n---\nmetadata: value'],
    ['infinity', 'metadata: .inf'],
    ['NaN', 'metadata: .nan'],
    ['hex number', 'metadata: 0x20'],
    ['octal number', 'metadata: 0o20'],
    ['prototype key', 'metadata: {__proto__: {polluted: true}}'],
    ['unsafe constructor', 'metadata: {constructor: {prototype: {polluted: true}}}'],
    ['executable include field', 'include: /host/config'],
  ])('rejects %s before catalog resolution and without disclosing contents', async (_name, source) => {
    const diagnostics = rejected(await compileWorldScenario(source, undefined, 'yaml'))
    expect(diagnostics[0]?.source).toBe('scenario')
    expect(JSON.stringify(diagnostics)).not.toMatch(/private\/credentials|function\(\)|host\/config/)
    expect(Object.prototype).not.toHaveProperty('polluted')
  })

  it('retains source format and one-based field locations', () => {
    const diagnostics = rejected(parseWorldScenario('apiVersion: clocky.world/v0\norganization:\n  id: company\n  name: 42\n', 'yaml'))
    expect(diagnostics).toContainEqual(expect.objectContaining({ path: ['organization', 'name'], format: 'yaml', line: 4, column: 9 }))
    const duplicate = rejected(parseWorldScenario('metadata: one\nmetadata: two\n', 'yaml'))
    expect(duplicate[0]).toMatchObject({ format: 'yaml', line: 2, column: 1 })
  })

  it('never guesses YAML after malformed JSON and rejects duplicate JSON keys', () => {
    expect(rejected(parseWorldScenario('apiVersion: clocky.world/v0'))[0]?.code).toBe('invalid-json')
    expect(rejected(parseWorldScenario('{"apiVersion":"clocky.world/v0","apiVersion":"clocky.world/v0"}'))[0])
      .toMatchObject({ code: 'invalid-shape', format: 'json' })
  })

  it('preserves quoted times and date-like text without producing Date objects', async () => {
    const definition = await input()
    definition.metadata.description = '2026-10-11'
    definition.initialEvents[0]!.at = '0'
    const source = stringify(definition)
    const parsed = parseWorldScenario(source, 'yaml')
    expect(parsed).toMatchObject({ ok: true, definition: { metadata: { description: '2026-10-11' }, initialEvents: [{ at: '0' }] } })
    rejected(parseWorldScenario(source.replace('at: "0"', 'at: 0').replace("at: '0'", 'at: 0'), 'yaml'))
  })
})

describe('bounded parser and compilation', () => {
  it('measures raw UTF-8 bytes before parsing, including comments and multibyte text', () => {
    const source = `#${'界'.repeat(Math.ceil(bounds.maxBytes / 3))}\n`
    expect(source.length).toBeLessThan(bounds.maxBytes)
    rejected(parseWorldScenario(source, 'yaml'), /source byte limit/)
    rejected(parseWorldScenario(' '.repeat(bounds.maxBytes + 1)), /source byte limit/)
  })

  it('admits an exact source byte limit and rejects the next byte', async () => {
    const json = JSON.stringify(await input())
    const source = json + ' '.repeat(bounds.maxBytes - new TextEncoder().encode(json).byteLength)
    expect(parseWorldScenario(source).ok).toBe(true)
    rejected(parseWorldScenario(source + ' '), /source byte limit/)
  })

  it('checks decoded serialized bytes and YAML escape expansion separately from raw file bytes', async () => {
    const definition = await input()
    definition.metadata.description = '界'.repeat(bounds.maxBytes / 3)
    rejected(parseWorldScenario(definition), /serialized input byte limit/)
    const source = `metadata: "${'\\0'.repeat(Math.ceil(bounds.maxBytes / 6))}"`
    expect(new TextEncoder().encode(source).byteLength).toBeLessThan(bounds.maxBytes)
    rejected(parseWorldScenario(source, 'yaml'), /serialized input byte limit/)
  })

  it('rejects excessive depth before schema recursion and YAML conversion', () => {
    const deep = '['.repeat(bounds.maxDepth + 1) + 'null' + ']'.repeat(bounds.maxDepth + 1)
    for (const format of ['json', 'yaml'] as const) rejected(parseWorldScenario(deep, format), /depth limit/)
    rejected(parseWorldScenario(JSON.parse(deep)), /depth limit/)
    expect(validateScenarioJSON(JSON.parse('['.repeat(bounds.maxDepth) + 'null' + ']'.repeat(bounds.maxDepth)), 'scenario')).toBeUndefined()
  })

  it('bounds collection items, aggregate nodes and references across collections', () => {
    rejected(parseWorldScenario({ items: Array(bounds.maxCollectionItems + 1).fill(null) }), /collection limit/)
    const many = Array.from({ length: 16 }, () => Array<null>(1024).fill(null))
    rejected(parseWorldScenario(many), /node limit/)
    rejected(parseWorldScenario(stringify(many), 'yaml'), /node limit/)
    const references = Array.from({ length: 3 }, () => ({ personIds: Array<string>(1400).fill('person') }))
    rejected(parseWorldScenario(references), /reference limit/)
    expect(validateScenarioJSON([Array(2048).fill('actor'), Array(2048).fill('actor')].map(ids => ({ actorIds: ids })), 'scenario')).toBeUndefined()
  })

  it('rejects cyclic, non-JSON, accessor and sparse inputs without invoking user code', () => {
    const cyclic: Record<string, unknown> = {}; cyclic['child'] = cyclic
    const getter = vi.fn(() => 'secret'), serializer = vi.fn(() => 'secret')
    for (const value of [cyclic, new Date(), NaN, Infinity, 1n, undefined, Array(2),
      Object.defineProperty({}, 'value', { enumerable: true, get: getter }), { toJSON: serializer }]) {
      rejected(parseWorldScenario(value))
    }
    expect(getter).not.toHaveBeenCalled(); expect(serializer).not.toHaveBeenCalled()
  })

  it('counts serialized shared input occurrences while allowing normal in-memory metadata reuse', () => {
    const child = { text: 'safe' }
    expect(validateScenarioJSON({ one: child, two: child }, 'catalog')).toBeUndefined()
    const shared = { text: 'x'.repeat(2048) }
    rejected(parseWorldScenario(Array(128).fill(shared)), /serialized input byte limit/)
  })

  it('bounds the complete resolved result including repeated templates and metadata', async () => {
    const installed = catalog()
    installed.templates[0]!.template.description = '界'.repeat(65000)
    rejected(await compileWorldScenario(await input(), installed), /compilation byte limit/)
    const oversized = catalog()
    oversized.templates[0]!.template.description = 'x'.repeat(bounds.maxBytes)
    const diagnostics = rejected(await compileWorldScenario(await input(), oversized), /serialized input byte limit/)
    expect(diagnostics[0]?.source).toBe('catalog')
  })
})
