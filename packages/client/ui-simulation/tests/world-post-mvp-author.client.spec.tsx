// @vitest-environment jsdom
/** Original saves and graph candidates remain separate from live commands and from subsequent local edits. */
import { useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import definition from '../../../sdk/protocol/tests/fixtures/world-v1-definition.json'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en } from '../src/client/locales.ts'
import { AuthorWorkbench } from '../src/client/WorldAuthorWorkbench.tsx'
import type { WorldAuthorDraft } from '../src/client/world-draft.ts'
import { createDraft, SECTIONS } from '../src/client/world-draft.ts'
import type { AuthorWorkbenchProps } from '../src/client/WorldAuthorWorkbench.tsx'
import { scenarioDraftSaveResultSchema, scenarioDraftRevisionSchema } from '@clocky/clocky-simulation-product/schema'

afterEach(cleanup)
Element.prototype.scrollIntoView = vi.fn()
function fixture(saveDraft: NonNullable<AuthorWorkbenchProps['saveDraft']>, preflight: AuthorWorkbenchProps['preflight'] = async () => undefined, readDraft?: AuthorWorkbenchProps['readDraft']) {
  const changed = vi.fn<(next: WorldAuthorDraft) => void>(), submit = vi.fn(async () => undefined), download = vi.fn()
  function Harness() {
    const [draft, setDraft] = useState(createDraft('draft', 'Draft', definition))
    return <AuthorWorkbench draft={draft} change={(next) => { changed(next); setDraft(next) }} maxBytes={1048576}
      undoDepth={20} supportedSections={SECTIONS} validation={{ loading: false, stale: false }} connected authorizationVersion={1}
      preflight={preflight} saveDraft={saveDraft} readDraft={readDraft} retain={() => 'original' as never} submit={submit} query={async () => undefined}
      inspectorWidth={320} resizeInspector={vi.fn()} back={vi.fn()} openRun={vi.fn()} discard={vi.fn()}
      download={download} t={makeTranslate(en)} />
  }
  return { ui: render(<Harness />), changed, submit, download }
}
it('retries the original unknown save while retaining edits typed after dispatch', async () => {
  const save = vi.fn<NonNullable<AuthorWorkbenchProps['saveDraft']>>()
    .mockRejectedValueOnce(new Error('lost reply')).mockImplementationOnce(async input => scenarioDraftSaveResultSchema.parse({ status: 'saved', value: {
      ...input, revision: 0, savedAt: 1, author: 'owner' } }))
  const h = fixture(save)
  fireEvent.click(h.ui.getByRole('radio', { name: en['world.author.source'] }))
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.save'] }))
  await h.ui.findByText(en['world.author.saveError'])
  fireEvent.change(h.ui.getByLabelText(en['world.author.rename']), { target: { value: 'Further edit' } })
  fireEvent.change(h.ui.getByLabelText(en['world.author.license']), { target: { value: 'LicenseRef-Local-Buffer' } })
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.retrySave'] }))
  await waitFor(() =>{  expect(save).toHaveBeenCalledTimes(2) })
  expect(save.mock.calls[1]?.[0]).toEqual(save.mock.calls[0]?.[0])
  await waitFor(() =>{  expect(h.changed.mock.lastCall?.[0]).toMatchObject({ name: 'Further edit', savedRevision: 0 }) })
  expect(h.ui.getByLabelText(en['world.author.license'])).toHaveProperty('value', 'LicenseRef-Local-Buffer')
  expect(h.submit).not.toHaveBeenCalled()
})
it('shows both conflicting definitions and requires an explicit choice before another save', async () => {
  const save = vi.fn<NonNullable<AuthorWorkbenchProps['saveDraft']>>(async input => scenarioDraftSaveResultSchema.parse({ status: 'conflict', attempted: input,
    current: { ...input, definition: { ...input.definition, metadata: { ...input.definition.metadata, name: 'Other author revision' } },
      name: 'Other', saveId: 'other', parentRevision: 0, revision: 1, savedAt: 1, author: 'owner' } }))
  const h = fixture(save)
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.save'] }))
  await h.ui.findByText(en['world.author.conflict'])
  expect(h.ui.getByRole('table', { name: en['world.author.changedFields'] })).toBeDefined()
  expect(h.ui.getByText('/definition/metadata/name')).toBeDefined()
  expect(h.ui.getAllByText(en['world.author.localVersion'])).toHaveLength(2)
  expect(h.ui.getAllByText(en['world.author.savedVersion'])).toHaveLength(2)
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.loadSaved'] }))
  expect(h.changed.mock.lastCall?.[0]).toMatchObject({ savedRevision: 1, model: { metadata: { name: 'Other author revision' } } })
  expect(h.submit).not.toHaveBeenCalled()
})
it('opens a bounded graph and refuses an unapproved edit without changing the canonical definition', async () => {
  const preflight = vi.fn(async () => ({ loading: false, stale: false, value: {
    status: 'invalid' as const, diagnostics: [{ source: 'scenario' as const, path: ['organization'], code: 'unknown-reference' as const, message: 'Unknown parent' }] } }))
  const h = fixture(vi.fn(), preflight)
  fireEvent.click(h.ui.getByRole('radio', { name: en['world.author.graph'] }))
  fireEvent.change(h.ui.getByLabelText(en['world.author.targetId']), { target: { value: 'missing' } })
  fireEvent.change(h.ui.getByLabelText(en['world.author.newId']), { target: { value: 'new-unit' } })
  fireEvent.change(h.ui.getByLabelText(en['world.author.nodeName']), { target: { value: 'New unit' } })
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.createUnit'] }))
  await h.ui.findByText(en['world.author.graphRejected'])
  expect(preflight).toHaveBeenCalledOnce()
  expect(h.changed.mock.lastCall?.[0].model).toEqual(definition)
  expect(h.submit).not.toHaveBeenCalled()
})

it('discards a late graph preview after the user starts an incomplete source edit', async () => {
  let finish!: (value: Awaited<ReturnType<AuthorWorkbenchProps['preflight']>>) => void
  const pending = new Promise<Awaited<ReturnType<AuthorWorkbenchProps['preflight']>>>((resolve) => { finish = resolve })
  const h = fixture(vi.fn(), () => pending)
  fireEvent.click(h.ui.getByRole('radio', { name: en['world.author.graph'] }))
  fireEvent.change(h.ui.getByLabelText(en['world.author.targetId']), { target: { value: definition.organization.rootId } })
  fireEvent.change(h.ui.getByLabelText(en['world.author.newId']), { target: { value: 'late-unit' } })
  fireEvent.change(h.ui.getByLabelText(en['world.author.nodeName']), { target: { value: 'Late unit' } })
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.createUnit'] }))
  fireEvent.click(h.ui.getByRole('radio', { name: en['world.author.source'] }))
  const source = h.ui.getByRole('textbox', { name: /Definition source/ })
  fireEvent.change(source, { target: { value: '{ "unfinished":' } })
  await act(async () => { finish({ loading: false, stale: false, value: { status: 'ready' } as never }) })
  await waitFor(() =>{  expect(h.changed.mock.lastCall?.[0].source.text).toBe('{ "unfinished":') })
  expect(h.changed.mock.lastCall?.[0].syntax.ok).toBe(false)
  expect(h.changed.mock.lastCall?.[0].model).toEqual(definition)
})

it('does not replace an incomplete source edit with a late saved-draft read', async () => {
  let finish!: (value: Awaited<ReturnType<NonNullable<AuthorWorkbenchProps['readDraft']>>>) => void
  const pending = new Promise<Awaited<ReturnType<NonNullable<AuthorWorkbenchProps['readDraft']>>>>((resolve) => { finish = resolve })
  const h = fixture(vi.fn(), async () => undefined, () => pending)
  fireEvent.change(h.ui.getByLabelText(en['world.author.savedDraftId']), { target: { value: 'saved' } })
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.openSavedDraft'] }))
  fireEvent.click(h.ui.getByRole('radio', { name: en['world.author.source'] }))
  fireEvent.change(h.ui.getByRole('textbox', { name: /Definition source/ }), { target: { value: '{ "unfinished":' } })
  await act(async () => { finish({ value: scenarioDraftRevisionSchema.parse({ draftId: 'saved', saveId: 'save',
    parentRevision: null, revision: 0, author: 'owner', savedAt: 1, name: 'Saved', definition }) }) })
  expect(h.changed.mock.lastCall?.[0].source.text).toBe('{ "unfinished":')
  expect(h.changed.mock.lastCall?.[0].syntax.ok).toBe(false)
})

it('replaces export metadata when a saved draft reload changes its manifest under the same draft identity', async () => {
  const manifest = { id: 'package', version: '1', license: { identifier: 'LicenseRef-First', notice: 'First notice' }, attribution: [],
    dependencies: { domains: definition.domains.map(domain => ({ ...domain, schemaRef: 'schema/1', implementationRef: 'impl/1', generation: 1 })),
      runtimeProfiles: definition.runtimeProfiles.allowed, templates: definition.runtimeProfiles.templates,
      policyVersion: 'policy/1', normPolicies: [] } }
  const first = scenarioDraftRevisionSchema.parse({ draftId: 'saved', saveId: 'first', parentRevision: null, revision: 0,
    name: 'Saved', definition, author: 'owner', savedAt: 1, templateManifest: manifest })
  const second = scenarioDraftRevisionSchema.parse({ ...first, saveId: 'second', parentRevision: 0, revision: 1,
    templateManifest: { ...manifest, version: '2', license: { identifier: 'LicenseRef-Second', notice: 'Second notice' } } })
  const read = vi.fn<NonNullable<AuthorWorkbenchProps['readDraft']>>()
    .mockResolvedValueOnce({ value: first }).mockResolvedValueOnce({ value: second })
  const h = fixture(vi.fn(), undefined, read)
  fireEvent.click(h.ui.getByRole('radio', { name: en['world.author.source'] }))
  fireEvent.change(h.ui.getByLabelText(en['world.author.savedDraftId']), { target: { value: 'saved' } })
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.openSavedDraft'] }))
  await waitFor(() => { expect(h.ui.getByLabelText(en['world.author.license'])).toHaveProperty('value', 'LicenseRef-First') })
  fireEvent.change(h.ui.getByRole('textbox', { name: /Definition source/ }), { target: { value: '{ unfinished' } })
  expect(h.changed.mock.lastCall?.[0].syntax.ok).toBe(false)
  fireEvent.click(h.ui.getByRole('button', { name: en['world.author.openSavedDraft'] }))
  await waitFor(() => { expect(h.ui.getByLabelText(en['world.author.license'])).toHaveProperty('value', 'LicenseRef-Second') })
  expect(h.ui.getByLabelText(en['world.author.packageVersion'])).toHaveProperty('value', '2')
  expect(h.ui.getByLabelText(en['world.author.licenseNotice'])).toHaveProperty('value', 'Second notice')
  expect(h.changed.mock.lastCall?.[0].syntax.ok).toBe(true)
  expect(JSON.parse(h.changed.mock.lastCall?.[0].source.text ?? 'null')).toEqual(definition)
})
