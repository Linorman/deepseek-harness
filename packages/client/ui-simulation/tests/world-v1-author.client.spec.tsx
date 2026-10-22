// @vitest-environment jsdom
/** Compound v1 fields preserve the canonical draft across confirmation, refusal and incomplete authoring. */
import { useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import definition from '../../../sdk/protocol/tests/fixtures/world-v1-definition.json'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en } from '../src/client/locales.ts'
import { AuthorWorkbench } from '../src/client/WorldAuthorWorkbench.tsx'
import { createDraft, decodeSyntax, getPath, setPath, sectionSpecs, SECTIONS } from '../src/client/world-draft.ts'
import { ReferencePicker } from '../src/client/WorldReferencePicker.tsx'
import type { Json, WorldAuthorDraft } from '../src/client/world-draft.ts'

afterEach(cleanup)
afterEach(() => { vi.restoreAllMocks() })
Element.prototype.scrollIntoView = vi.fn()
const t = makeTranslate(en) as never

function setup(imported = false, refuse = false, model: Json = definition) {
  const changes = vi.fn((_value: WorldAuthorDraft) => {})
  const preflight = vi.fn(async () => undefined)
  function Harness() {
    const [draft, setDraft] = useState(createDraft('v1', 'Original v1', model,
      imported ? { text: JSON.stringify(model), format: 'json' } : undefined))
    return <AuthorWorkbench draft={draft} change={(next) => {
      if (refuse) throw new Error('Draft capacity exceeded')
      changes(next); setDraft(next)
    }} maxBytes={262144} undoDepth={20} supportedSections={SECTIONS} validation={{ loading: false, stale: false }}
    connected authorizationVersion={1} preflight={preflight} retain={() => 'original' as never}
    submit={async () => undefined} query={async () => undefined} inspectorWidth={320} resizeInspector={vi.fn()}
    back={vi.fn()} openRun={vi.fn()} discard={vi.fn()} download={vi.fn()} t={t} />
  }
  return { ui: render(<Harness />), changes, preflight }
}

it('keeps the existing closed table choice on Enter and returns focus to its original cell', async () => {
  const model = setPath(definition, ['externalWorld', 'identities', 0, 'representation'], 'simulated-actor')
  const h = setup(false, false, model), spec = sectionSpecs(model).external.tables[0]!
  const column = spec.columns.findIndex(item => item.path.join('.') === 'representation')
  expect(column).toBeGreaterThanOrEqual(0)
  const cell = h.ui.getByRole('grid', { name: en['world.section.external'] }).querySelector(`[data-cell="0:${String(column)}"]`) as HTMLElement
  act(() => { cell.focus() }); fireEvent.keyDown(cell, { key: 'F2' })
  const editor = h.ui.getByRole('combobox')
  const active = document.getElementById(editor.getAttribute('aria-activedescendant')!)
  expect(active?.textContent).toBe(en['world.source.simulated-actor'])
  fireEvent.keyDown(editor, { key: 'Enter' })
  expect(h.changes).not.toHaveBeenCalled()
  await waitFor(() => { expect(document.activeElement).toBe(cell) })
})

it('does not commit an unmatched closed choice and cancels it on blur', () => {
  const commit = vi.fn(), cancel = vi.fn()
  const ui = render(<ReferencePicker value="second" symbols={[{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }]}
    label="Closed choice" allowUnknown={false} showIds={false} emptyLabel="No choices" commit={commit} cancel={cancel} t={t} />)
  const editor = ui.getByRole('combobox')
  fireEvent.change(editor, { target: { value: 'uninstalled-choice' } }); fireEvent.keyDown(editor, { key: 'Enter' })
  expect(ui.getByText('No choices')).toBeDefined(); expect(commit).not.toHaveBeenCalled()
  fireEvent.blur(editor); expect(cancel).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled()
})

it('keeps the original symbol selectable beyond the bounded suggestion prefix', () => {
  const commit = vi.fn(), options = Array.from({ length: 60 }, (_, index) => ({ id: `id-${index}`, name: `Choice ${index}` }))
  const ui = render(<ReferencePicker value="id-55" symbols={options} label="Declared symbol" commit={commit} cancel={vi.fn()} t={t} />)
  expect(ui.getAllByRole('option')).toHaveLength(50)
  fireEvent.keyDown(ui.getByRole('combobox'), { key: 'Enter' })
  expect(commit).toHaveBeenCalledWith('id-55', undefined)
})

it('restores the saved compound value when regeneration is cancelled and commits it only after confirmation', async () => {
  const h = setup(true)
  const field = h.ui.getByLabelText(en['world.field.policy']) as HTMLTextAreaElement
  const original = field.value
  const next = { ...definition.externalWorld.adjudicationPolicy, maxDelay: '8' }
  fireEvent.change(field, { target: { value: JSON.stringify(next) } })
  const dialog = await h.ui.findByRole('dialog', { name: en['world.author.regenerateConfirm'] })
  fireEvent.click(h.ui.getAllByRole('button', { name: en.keepEditing }).find(button => dialog.contains(button))!)
  expect(field.value).toBe(original)
  expect(h.changes).not.toHaveBeenCalled()
  fireEvent.change(field, { target: { value: JSON.stringify(next) } })
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.regenerateConfirm'] }))
  await waitFor(() => { expect(JSON.parse(field.value)).toEqual(next) })
  expect(getPath(h.changes.mock.lastCall![0].model, ['externalWorld', 'adjudicationPolicy'])).toEqual(next)
})

it('retains incomplete compound JSON in the parent and restores the original when capacity refuses it', () => {
  const h = setup()
  const field = h.ui.getByLabelText(en['world.field.policy']) as HTMLTextAreaElement
  fireEvent.change(field, { target: { value: '{"ref":' } })
  expect(field.value).toBe('{"ref":')
  expect(field.getAttribute('aria-invalid')).toBe('true')
  expect(getPath(h.changes.mock.lastCall![0].model, ['externalWorld', 'adjudicationPolicy'])).toBe('{"ref":')
  cleanup()
  const rejected = setup(false, true)
  const rejectedField = rejected.ui.getByLabelText(en['world.field.policy']) as HTMLTextAreaElement
  const original = rejectedField.value
  fireEvent.change(rejectedField, { target: { value: '{"ref":' } })
  expect(rejectedField.value).toBe(original)
  expect(rejected.ui.getByRole('alert').textContent).toContain(en['world.author.capacityRefused'])
  expect(rejected.changes).not.toHaveBeenCalled()
})

it('keeps a compound editor focused when the prior cell selection focus runs after Enter', () => {
  const h = setup(), queued: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { queued.push(callback); return queued.length })
  const cell = h.ui.getByRole('grid', { name: en['world.section.committees'] }).querySelector('[data-cell="0:4"]') as HTMLElement
  fireEvent.click(cell)
  fireEvent.keyDown(cell, { key: 'Enter' })
  const input = h.ui.getByLabelText(`${en['world.field.members']} · 1`) as HTMLTextAreaElement
  expect(document.activeElement).toBe(input)
  act(() => { for (const callback of queued.splice(0)) callback(0) })
  expect(document.activeElement).toBe(input)
  expect(input.isConnected).toBe(true)
  fireEvent.change(input, { target: { value: '[{"id":' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(getPath(h.changes.mock.lastCall![0].model, ['governance', 'committees', 0, 'members'])).toBe('[{"id":')
})

it('edits a director declaration budget without changing world limits and locates malformed source before Host preflight', async () => {
  const event = { id: 'event', calendarId: 'finite-stock-calendar', maxRequests: 1, domain: 'external', operation: 'interact',
    version: '3', scopeId: 'studio', targetId: 'outside-vendor' }
  const h = setup(false, false, setPath(definition, ['behavior', 'directorEvents'], [event]))
  const grid = h.ui.getByRole('grid', { name: en['world.field.directorEvents'] })
  const cell = grid.querySelector('[data-cell="0:2"]') as HTMLElement
  fireEvent.doubleClick(cell)
  const input = h.ui.getByLabelText(`${en['world.field.directorRequestLimit']} · 1`)
  fireEvent.change(input, { target: { value: 'many' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  const current = h.changes.mock.lastCall![0].model
  expect(getPath(current, ['behavior', 'directorEvents', 0])).toEqual({ ...event, maxRequests: 'many' })
  expect(getPath(current, ['limits'])).toEqual(definition.limits)
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.check'] }))
  await h.ui.findAllByText(/behavior\.directorEvents\.0\.maxRequests/)
  expect(h.preflight).not.toHaveBeenCalled()
  fireEvent.click(h.ui.getByRole('radio', { name: en['world.author.source'] }))
  const source = h.ui.getByRole('textbox', { name: en['world.author.sourceLabel'].replace('{format}', 'JSON') }) as HTMLTextAreaElement
  const parsed = decodeSyntax(source.value, 'json')
  if (!parsed.ok) throw new Error('Canonical malformed field still requires syntactically valid source')
  expect(getPath(parsed.value, ['behavior', 'directorEvents', 0])).toEqual({ ...event, maxRequests: 'many' })
})
