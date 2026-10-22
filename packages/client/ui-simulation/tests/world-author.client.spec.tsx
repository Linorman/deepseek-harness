// @vitest-environment jsdom
/** The workbench checks explicitly, locates diagnostics, dims stale previews and locks a retained original. */
import { useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { laboratory } from './world-fixtures.client.ts'
import { en, zh } from '../src/client/locales.ts'
import { AuthorWorkbench } from '../src/client/WorldAuthorWorkbench.tsx'
import type { AuthorWorkbenchProps } from '../src/client/WorldAuthorWorkbench.tsx'
import { NewWorldChooser } from '../src/client/WorldChooser.tsx'
import { V0_SECTIONS, createDraft, getPath, setPath } from '../src/client/world-draft.ts'
import type { Json, WorldAuthorDraft } from '../src/client/world-draft.ts'

afterEach(cleanup)
// jsdom has no layout; locating scrolls the responsible cell into view.
Element.prototype.scrollIntoView = vi.fn()
const t = makeTranslate(en) as never
const limits = { native: { maxQueuedDecisions: 1, maxDispatchWaitRounds: 1, maxTokensPerInterval: 1, tokensPerModelRequest: 1,
  maxDecisionsPerInterval: 1, maxMessagesPerInterval: 1, maxPendingEvents: 1, maxPendingInteractions: 1, maxKnowledgeBytes: 1,
  maxKnowledgePerQuery: 1, maxEntities: 8, maxResidentActors: 4, maxIngressBytes: 1, maxConflictRetries: 1, decisionTimeoutMs: 1,
  maxDecisionsPerWindow: 1, outboxMaxAttempts: 1, outboxRetryDelayMs: 1, maxDriveSteps: 1,
  maxMicrostepsPerTime: 1, maxOperationsPerDecision: 1, maxResourceReservationHistory: 128 },
team: {}, world: { maxRequests: 1,
  maxBirthsPerInterval: 1, maxExternalExpansionsPerInterval: 1, maxPendingMutations: 1,
  maxRequestsPerActorPerInterval: 1, maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 1, maxBytesPerPlan: 1 } }
const model = { provider: 'p', name: 'm', version: 'v1' }
const ready = { status: 'ready', policyVersion: 'p', preview: { hash: `sha256:${'a'.repeat(64)}`, catalogGeneration: 'g1',
  organizationName: 'Horizon Laboratory', actorCount: 3, positionCount: 1, initialRequestCount: 1, directorEntityId: 'director' },
organization: { id: 'laboratory', name: 'Horizon Laboratory', description: 'd' },
actors: ['director', 'requester', 'observer'].map((id, index) => ({ entityId: id, role: index === 0 ? 'director' : 'member', name: id,
  template: { id: 'laboratory-person', version: '1' }, model })),
positions: [{ entityId: 'research', name: 'Research assistant', capacity: 2, occupied: 1 }],
authorizations: [{ requesterEntityId: 'requester', positionEntityId: 'research' }], limits, maxTime: '100', budgetInterval: '10',
tickUnit: 'minute', scope: { source: 'simulated-only', operation: 'hire', payroll: false, committeeApproval: false } }

function setup(options: { result?: 'ready' | 'invalid'; draft?: WorldAuthorDraft; overrides?: Partial<AuthorWorkbenchProps> } = {}) {
  const retain = vi.fn((_command: unknown, _version: number) => 'original' as never), submit = vi.fn(async () => undefined)
  const preflight = vi.fn(async (_input: unknown) => {})
  const change = vi.fn((_draft: WorldAuthorDraft) => {})
  function Harness() {
    const [draft, setDraft] = useState(options.draft ?? createDraft('slot', 'Lab', laboratory as Json))
    const [validation, setValidation] = useState<AuthorWorkbenchProps['validation']>({ loading: false, stale: false })
    return <AuthorWorkbench draft={draft} change={(next) => { change(next); setDraft(next) }} maxBytes={262144} undoDepth={20}
      supportedSections={V0_SECTIONS} validation={validation} connected authorizationVersion={1}
      preflight={async (input) => {
        await preflight(input)
        setValidation({ loading: false, stale: false, scope: JSON.stringify(['worldPreflight', input]),
          value: (options.result === 'ready' ? ready : { status: 'invalid', diagnostics: [{ source: 'catalog',
            path: ['positions', 0, 'capacity'], code: 'capacity', message: 'Capacity exceeded' }] }) as never })
      }}
      retain={retain} submit={submit} query={async () => undefined} inspectorWidth={320} resizeInspector={vi.fn()}
      back={vi.fn()} openRun={vi.fn()} discard={vi.fn()} download={vi.fn()} t={t} {...options.overrides} />
  }
  return { ui: render(<Harness />), retain, submit, preflight, change }
}

it('checks only on request, shows Host diagnostics by section and marks an edited value as awaiting another check', async () => {
  const h = setup()
  expect(h.ui.getAllByText(en['world.diag.notChecked']).length).toBeGreaterThan(0)
  expect(h.preflight).not.toHaveBeenCalled()
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.check'] }))
  await h.ui.findAllByText('Capacity exceeded')
  expect(h.preflight).toHaveBeenCalledOnce()
  const rail = h.ui.getByRole('navigation', { name: en['world.author.sections'] })
  expect(rail.textContent).toContain('1 issues')
  fireEvent.click(h.ui.getByRole('button', { name: /Locate: Organization and positions/ }))
  const cell = h.ui.getByRole('grid', { name: en['world.subsection.positions'] }).querySelector('[data-cell="0:2"]') as HTMLElement
  await waitFor(() => { expect(document.activeElement).toBe(cell) })
  fireEvent.keyDown(cell, { key: 'Enter' })
  const input = h.ui.getByLabelText(`${en['world.field.capacity']} · 1`)
  fireEvent.change(input, { target: { value: '1' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(getPath(h.change.mock.lastCall?.[0].model as Json, ['positions', 0, 'capacity'])).toBe(1)
  expect(h.ui.getByText(en['world.diag.modified'])).toBeDefined()
  expect(h.preflight).toHaveBeenCalledOnce()
})

it('reports shared-compiler shape errors locally without contacting the Host', async () => {
  const draft = createDraft('slot', 'Lab', setPath(laboratory, ['positions', 0, 'capacity'], 'many'))
  const h = setup({ draft })
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.check'] }))
  await h.ui.findAllByText(/positions\.0\.capacity/)
  expect(h.preflight).not.toHaveBeenCalled()
  expect((h.ui.getByRole('button', { name: `${en['world.author.create']} ▸` }) as HTMLButtonElement).disabled).toBe(true)
})

it('dims an outdated preview, disables creation, and locks the draft after retaining one original command', async () => {
  const h = setup({ result: 'ready' })
  const create = () => h.ui.getByRole('button', { name: `${en['world.author.create']} ▸` }) as HTMLButtonElement
  expect(create().disabled).toBe(true)
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.check'] }))
  await waitFor(() => { expect(create().disabled).toBe(false) })
  expect(h.ui.getByText(en['world.ext.notice']).closest('[role="note"]')).toBeTruthy()
  expect(h.ui.getByText(en['world.ext.notice']).closest('details')).toBeNull()
  fireEvent.change(h.ui.getByLabelText(en['world.field.description']), { target: { value: 'Changed' } })
  expect(h.ui.getAllByText(en['world.preview.outdated']).length).toBeGreaterThan(0)
  expect(create().disabled).toBe(true)
  fireEvent.click(h.ui.getByRole('button', { name: en['world.preview.recheck'] }))
  await waitFor(() => { expect(create().disabled).toBe(false) })
  fireEvent.click(create())
  const dialog = await h.ui.findByRole('dialog', { name: en['world.create.confirmTitle'] })
  expect(dialog.textContent).toContain('p/m@v1')
  await act(async () => { fireEvent.click(h.ui.getByRole('button', { name: en['world.create.confirm'] })) })
  expect(h.retain).toHaveBeenCalledOnce()
  expect(h.retain.mock.lastCall?.[0]).toMatchObject({ kind: 'world-create', input: { name: 'Lab',
    preflight: { hash: ready.preview.hash, catalogGeneration: 'g1' } } })
  expect(h.submit).toHaveBeenCalledOnce()
  expect(h.ui.getByText(en['world.author.locked'])).toBeDefined()
  expect((h.ui.getByLabelText(en['world.field.description']) as HTMLTextAreaElement).readOnly).toBe(true)
})

it('freezes the form while source has a syntax error and offers a jump to its location', async () => {
  const draft = createDraft('slot', 'Lab', laboratory, { text: '{ "apiVersion": [', format: 'json' })
  const h = setup({ draft: { ...draft, view: 'form' } })
  expect(h.ui.getByRole('alert').textContent).toContain('syntax error')
  expect((h.ui.getByLabelText(en['world.field.name']) as HTMLInputElement).readOnly).toBe(true)
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.locateSource'] }))
  await h.ui.findByLabelText(en['world.author.sourceLabel'].replace('{format}', 'JSON'))
})

it('prompts once before form edits regenerate hand-authored source', () => {
  const draft = createDraft('slot', 'Lab', laboratory, { text: JSON.stringify(laboratory), format: 'json' })
  const h = setup({ draft })
  fireEvent.change(h.ui.getByLabelText(en['world.field.description']), { target: { value: 'Edited' } })
  expect(h.ui.getByText(en['world.author.regenerate'])).toBeDefined()
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.regenerateConfirm'] }))
  expect(h.change.mock.lastCall?.[0]).toMatchObject({ regenerateAcknowledged: true })
  fireEvent.change(h.ui.getByLabelText(en['world.field.description']), { target: { value: 'Edited again' } })
  expect(h.ui.queryByText(en['world.author.regenerate'])).toBeNull()
})

it('refuses oversized or unsupported files inside the chooser and lists retained drafts', async () => {
  const choose = vi.fn()
  const draft = { ...createDraft('slot', 'Draft lab', laboratory), diagnosticCount: 3 }
  const ui = render(<NewWorldChooser templates={{ status: 'unpublished' }} drafts={[draft]} maxBytes={4} maxSlots={4} slotsFull={false}
    choose={choose} close={vi.fn()} t={t} />)
  expect(ui.getByText('“Draft lab” · 3 diagnostics')).toBeDefined()
  fireEvent.click(ui.getByRole('button', { name: en['world.new.continue'] }))
  expect(choose).toHaveBeenCalledWith({ kind: 'continue', slot: 'slot' })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['{}'], 'world.txt')] } })
  await ui.findByText(en['world.new.import.type'])
  fireEvent.change(input, { target: { files: [new File(['{"too":"large"}'], 'world.yaml')] } })
  await ui.findByText('The file exceeds the draft limit (4 bytes)')
  expect(choose).toHaveBeenCalledOnce()
  // Arrow keys move between every card's action; the actions are real buttons, not nested inside radios.
  const file = ui.getByRole('button', { name: en['world.new.import.choose'] }), blank = ui.getByRole('button', { name: en['world.new.blank.start'] })
  file.focus()
  fireEvent.keyDown(file, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(blank)
  fireEvent.keyDown(blank, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(file)
  expect(ui.queryByRole('radio')).toBeNull()
  fireEvent.click(blank)
  expect(choose).toHaveBeenLastCalledWith({ kind: 'blank' })
})

it('discards a cell edit on Escape even when the editor blurs afterwards', () => {
  const h = setup()
  const grid = h.ui.getByRole('grid', { name: en['world.subsection.positions'] })
  const cell = grid.querySelector('[data-cell="0:0"]') as HTMLElement
  fireEvent.doubleClick(cell)
  const input = h.ui.getByLabelText(`${en['world.field.name']} · 1`)
  fireEvent.change(input, { target: { value: 'Discarded' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  fireEvent.blur(input)
  expect(h.change.mock.calls.some(([draft]) => getPath(draft.model, ['positions', 0, 'name']) === 'Discarded')).toBe(false)
  expect(cell.textContent).toContain('Research assistant')
})

it.each([en, zh])('exports only the authored definition and identifies it as a new-world input', (locale) => {
  const download = vi.fn((_name: string, _text: string, _format: string) => {})
  const h = setup({ overrides: { download, t: makeTranslate(locale) } })
  fireEvent.click(h.ui.getByRole('button', { name: locale['world.author.export'] }))
  expect(h.ui.getByText(locale['world.overview.exportNotice'])).toBeDefined()
  fireEvent.click(h.ui.getByRole('menuitem', { name: 'JSON' }))
  expect(download).toHaveBeenCalledOnce()
  const exported = download.mock.lastCall
  if (exported === undefined) throw new Error('Expected one definition download')
  expect(exported[0]).toBe('Lab.world.json')
  expect(JSON.parse(exported[1])).toEqual(laboratory)
  expect(h.preflight).not.toHaveBeenCalled()
  expect(h.retain).not.toHaveBeenCalled()
  expect(h.submit).not.toHaveBeenCalled()
})
