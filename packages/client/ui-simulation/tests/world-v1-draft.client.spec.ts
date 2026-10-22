// @vitest-environment jsdom
/** V1 tables share the complete canonical source and preserve nullable intervals, compound values and unknown fields. */
import { expect, it } from 'vitest'
import definition from '../../../sdk/protocol/tests/fixtures/world-v1-definition.json'
import { blankModel, createDraft, editModel, editSource, switchFormat, parseDraft, sectionSpecs, getPath, setPath,
  symbols, cellOf, sectionOf, cellValue, sourceOnlyPaths } from '../src/client/world-draft.ts'
import type { Json } from '../src/client/world-draft.ts'

const model = definition as Json

it('uses the same thirteen-group v1 skeleton for a blank draft without an implicit prebuilt request', () => {
  const blank = blankModel()
  expect(getPath(blank, ['apiVersion'])).toBe('clocky.world/v1')
  expect(getPath(blank, ['behavior'])).toEqual({ initialGoals: [], calendars: [], directorEvents: [] })
  expect(getPath(blank, ['limits'])).toEqual({ native: {}, team: {}, world: {} })
  expect(Object.keys(sectionSpecs(blank))).toHaveLength(11)
  expect(parseDraft(blank, 'json', blank).ok).toBe(false)
})

it('edits all complete v1 groups through exact paths, then round-trips safe YAML without dropping data', () => {
  const current = setPath(model, ['facts', 0, 'extraField'], 'kept until explicit correction')
  let draft = createDraft('v1', 'Full scene', current)
  draft = editModel(draft, setPath(draft.model, ['governance', 'committees', 0, 'quorum'], 1))
  draft = switchFormat(draft, 'yaml')
  draft = editSource(draft, draft.source.text)
  expect(draft.model).toEqual(setPath(current, ['governance', 'committees', 0, 'quorum'], 1))
  expect(getPath(draft.model, ['facts', 0, 'effectiveUntil'])).toBe(null)
  expect(getPath(draft.model, ['facts', 0, 'extraField'])).toBe('kept until explicit correction')
  const corrected = setPath(draft.model, ['facts', 0, 'extraField'], undefined)
  expect(parseDraft(corrected, 'json', corrected).ok).toBe(true)
})

it('maps nested committee, institution, permission and goal diagnostics to the actual field', () => {
  expect(sectionOf(['governance', 'norms', 0, 'enforcement'], model)).toBe('norms')
  expect(sectionOf(['governance', 'committees', 0, 'members', 0, 'personId'], model)).toBe('committees')
  expect(cellOf(['governance', 'committees', 0, 'members', 0, 'personId'], model))
    .toEqual({ table: 'committees', row: 0, column: 'members' })
  expect(cellOf(['organization', 'grants', 0, 'scopeId'], model)).toEqual({ table: 'grants', row: 0, column: 'scopeId' })
  expect(cellOf(['behavior', 'calendars', 0, 'target', 'positionId'], model))
    .toEqual({ table: 'calendars', row: 0, column: 'target' })
  expect(symbols(model, 'actor').every(value => getPath(model, ['entities']) !== undefined && value.id !== '')).toBe(true)
  expect(symbols(model, 'organization').map(value => value.id)).toContain('studio')
})

it('keeps incomplete compound JSON as a correctable draft and writes blank interval ends as null', () => {
  const members = sectionSpecs(model).committees.tables[0]!.columns.find(value => value.id === 'members')!
  expect(cellValue(members, '[{"id":')).toBe('[{"id":')
  expect(cellValue(members, '[{"id":"member","personId":"requester","validFrom":"0","validUntil":null}]'))
    .toEqual([{ id: 'member', personId: 'requester', validFrom: '0', validUntil: null }])
  const until = sectionSpecs(model).organization.tables.find(value => value.id === 'assignments')!.columns.find(value => value.id === 'validUntil')!
  expect(cellValue(until, '')).toBe(null)
  expect(cellValue(until, '9007199254740993')).toBe('9007199254740993')
})

it('exposes unknown container fields without mistaking complete compound fields for lost source-only data', () => {
  const current = setPath(setPath(model, ['organization', 'extra'], { note: 'preserve' }),
    ['externalWorld', 'extra'], 'preserve')
  expect(sourceOnlyPaths(current, sectionSpecs(current).organization)).toEqual([['organization', 'extra']])
  expect(sourceOnlyPaths(current, sectionSpecs(current).external)).toEqual([['externalWorld', 'extra']])
  expect(sourceOnlyPaths(current, sectionSpecs(current).committees)).toEqual([])
  expect(sourceOnlyPaths(current, sectionSpecs(current).events)).toEqual([])
})

it('owns the director declaration request budget separately and locates its malformed value without dropping fields', () => {
  const declaration = { id: 'director-event', calendarId: 'calendar', maxRequests: 2, domain: 'external', operation: 'interact',
    version: '3', scopeId: 'studio', targetId: 'outside-vendor' }
  const current = setPath(model, ['behavior', 'directorEvents'], [declaration])
  const table = sectionSpecs(current).events.tables.find(value => value.id === 'directorEvents')!
  const limit = table.columns.find(value => value.id === 'maxRequests')!
  const changed = setPath(current, ['behavior', 'directorEvents', 0, 'maxRequests'], cellValue(limit, 'many'))
  expect(getPath(changed, ['behavior', 'directorEvents', 0])).toEqual({ ...declaration, maxRequests: 'many' })
  expect(getPath(changed, ['limits'])).toEqual(getPath(model, ['limits']))
  expect(cellOf(['behavior', 'directorEvents', 0, 'maxRequests'], changed)).toEqual({ table: 'directorEvents', row: 0, column: 'maxRequests' })
  expect(parseDraft(changed, 'json', changed).ok).toBe(false)
  expect(getPath(table.blank(), ['maxRequests'])).toBe(1)
})
