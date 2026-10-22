// @vitest-environment jsdom
/** One canonical draft model backs form and source; syntax errors freeze the form and unknown fields survive form edits. */
import { expect, it } from 'vitest'
import { laboratory } from './world-fixtures.client.ts'
import { asArray, blankModel, cellOf, createDraft, draftBytes, editModel, editSource, getPath, locatePath, pathModified,
  readablePath, sectionOf, setPath, sourceOnlyPaths, SECTION_SPECS, step, switchFormat, symbols } from '../src/client/world-draft.ts'
import type { Json } from '../src/client/world-draft.ts'
import { en } from '../src/client/locales.ts'

const model = laboratory as Json

it('round-trips form edits through YAML source without losing fields the form cannot edit', () => {
  const withExtra = setPath(model, ['positions', 0, 'futureField'], 'kept')
  let draft = createDraft('slot', 'Lab', withExtra)
  draft = editModel(draft, setPath(draft.model, ['positions', 0, 'capacity'], 3))
  expect(getPath(draft.model, ['positions', 0, 'futureField'])).toBe('kept')
  draft = switchFormat(draft, 'yaml')
  expect(draft.source.text).toContain('futureField: kept')
  draft = editSource(draft, draft.source.text.replace('capacity: 3', 'capacity: 4'))
  expect(getPath(draft.model, ['positions', 0, 'capacity'])).toBe(4)
  expect(getPath(draft.model, ['positions', 0, 'futureField'])).toBe('kept')
  expect(sourceOnlyPaths(draft.model, SECTION_SPECS.organization)).toEqual([['positions', 0, 'futureField']])
})

it('keeps raw text and freezes the model while source has a syntax error', () => {
  let draft = createDraft('slot', 'Lab', model)
  draft = editSource(draft, '{ "apiVersion": ')
  expect(draft.syntax.ok).toBe(false)
  expect(draft.source.text).toBe('{ "apiVersion": ')
  expect(draft.model).toEqual(model)
  expect(switchFormat(draft, 'yaml')).toBe(draft)
  const imported = createDraft('import', 'Broken', blankModel(), { text: 'a: [', format: 'yaml' })
  expect(imported.view).toBe('source')
  expect(imported.syntax).toMatchObject({ ok: false, line: expect.any(Number) as number })
})

it('bounds undo history and clears redo after a new edit', () => {
  let draft = createDraft('slot', 'Lab', model)
  for (let index = 1; index <= 5; index++) draft = editModel(draft, setPath(draft.model, ['positions', 0, 'capacity'], index), 3)
  expect(draft.past).toHaveLength(3)
  draft = step(draft, 'undo')
  expect(getPath(draft.model, ['positions', 0, 'capacity'])).toBe(4)
  draft = step(draft, 'redo')
  expect(getPath(draft.model, ['positions', 0, 'capacity'])).toBe(5)
  draft = step(step(draft, 'undo'), 'undo')
  draft = editModel(draft, setPath(draft.model, ['metadata', 'name'], 'Renamed'))
  expect(draft.future).toEqual([])
  expect(editModel(draft, draft.model)).toBe(draft)
})

it('lists only draft-declared symbols and maps diagnostic paths to sections, cells and readable breadcrumbs', () => {
  expect(symbols(model, 'actor').map(symbol => symbol.id)).toEqual(['director', 'requester', 'observer'])
  expect(symbols(model, 'actor')[1]?.name).toBe('Research Lead')
  expect(symbols(model, 'position')).toEqual([{ id: 'research', name: 'Research assistant' }])
  expect(sectionOf(['limits', 'world', 'maxRequests'])).toBe('runtime')
  expect(sectionOf(['authorizations', 0, 'positionId'])).toBe('people')
  expect(sectionOf(['unknownTopLevel'])).toBe('basics')
  expect(cellOf(['actors', 1, 'template', 'id'])).toEqual({ table: 'actors', row: 1, column: 'template' })
  expect(readablePath(model, ['positions', 0, 'capacity'], key => en[key])).toBe('Positions › Research assistant › Capacity')
  expect(readablePath(model, ['metadata', 'name'], key => en[key])).toBe('Name')
})

it('marks a diagnostic modified only when its own value changed since the check', () => {
  const edited = setPath(model, ['positions', 0, 'capacity'], 9)
  expect(pathModified(model, edited, ['positions', 0, 'capacity'])).toBe(true)
  expect(pathModified(model, edited, ['actors', 0, 'id'])).toBe(false)
})

it('deletes array rows and object keys immutably and measures complete UTF-8 bytes', () => {
  const removed = setPath(model, ['actors', 2], undefined)
  expect(asArray(getPath(removed, ['actors']))).toHaveLength(2)
  expect(asArray(getPath(model, ['actors']))).toHaveLength(3)
  const draft = createDraft('slot', '名称', model)
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength
  expect(draftBytes(draft)).toBe(bytes('名称') + Math.max(bytes(JSON.stringify(model)), bytes(draft.source.text)))
  // A file at the source ceiling must fit: the model and its source text are not double-counted.
  expect(draftBytes(draft)).toBeLessThan(bytes('名称') + bytes(JSON.stringify(model)) + bytes(draft.source.text))
  expect(locatePath(draft.source.text, 'json', ['positions', 0, 'capacity'])?.line).toBeGreaterThan(1)
})
