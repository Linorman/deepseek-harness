// @vitest-environment jsdom
/** Finite selections remain editable through incomplete input; no model request or actor impersonation occurs. */
import { useState } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ActionFlow } from '../src/client/WorldActionFlow.tsx'
import { PersonaEditor } from '../src/client/WorldPersonaEditor.tsx'
import type { PersonaField } from '../src/client/world-domain.ts'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en } from '../src/client/locales.ts'
const t = makeTranslate(en) as never
const field: PersonaField = { kind: 'persona', id: 'command', required: true, maxBytes: 8192,
  organizationEntityId: 'organization' as never, positionEntityId: 'position' as never, now: '0', maxTime: '100',
  maxRevisions: 16, templates: [{ id: 'finite', version: '1', description: 'Finite options.', names: ['Ada', 'Lin'],
    skills: ['analysis'], traits: ['patient'], goals: ['research'] }] }
afterEach(cleanup)
function Editor() {
  const [value, setValue] = useState('')
  return <><PersonaEditor field={field} value={value} id="finite-command" change={setValue} t={t} /><output>{value}</output></>
}
it('creates a finite draft, preserves incomplete deadline input, and explicitly regenerates only allowed values', () => {
  const ui = render(<Editor />)
  fireEvent.click(ui.getByRole('button', { name: en['world.market.createDraft'] }))
  const original = JSON.parse(ui.getByRole('status').textContent) as { id: string; expectedRevision: number }
  expect(original.expectedRevision).toBe(0)
  fireEvent.click(ui.getByLabelText('Lin'))
  fireEvent.click(ui.getByLabelText('analysis'))
  fireEvent.change(ui.getByLabelText(en['world.market.reviewDeadline']), { target: { value: '' } })
  expect((ui.getByLabelText(en['world.market.reviewDeadline']) as HTMLInputElement).value).toBe('')
  fireEvent.click(ui.getByRole('button', { name: en['world.market.regenerate'] }))
  expect(JSON.parse(ui.getByRole('status').textContent)).toMatchObject({ id: original.id, expectedRevision: 0, validUntil: '',
    body: { persona: { name: 'Ada', skills: ['analysis'], traits: ['patient'], goals: ['research'] } } })
  expect(ui.queryByRole('textbox', { name: en['world.author.nodeName'] })).toBeNull()
})

it('keeps the finite Persona editor visible through ActionFlow creation, selection and repeated edits', () => {
  const requestPreview = vi.fn<(values: Readonly<Record<string, string>>) => void>()
  function Flow() {
    const [values, change] = useState<Readonly<Record<string, string>>>({ command: '' })
    return <ActionFlow action="hiring-market" target="Research role" expectedRevision={42}
      fields={{ status: 'ready', stale: false, value: [field] }} preview={{ status: 'idle' }}
      values={values} connected change={change} requestPreview={requestPreview}
      openRef={vi.fn()} close={vi.fn()} t={t} />
  }
  const ui = render(<Flow />)
  fireEvent.click(ui.getByRole('button', { name: en['world.market.createDraft'] }))
  fireEvent.click(ui.getByRole('radio', { name: 'Lin' }))
  expect((ui.getByRole('radio', { name: 'Lin' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(ui.getByRole('checkbox', { name: 'analysis' }))
  fireEvent.change(ui.getByLabelText(en['world.market.reviewDeadline']), { target: { value: '60' } })
  fireEvent.click(ui.getByRole('radio', { name: 'Ada' }))
  expect((ui.getByRole('checkbox', { name: 'analysis' }) as HTMLInputElement).checked).toBe(true)
  expect((ui.getByLabelText(en['world.market.reviewDeadline']) as HTMLInputElement).value).toBe('60')
  fireEvent.click(ui.getByRole('button', { name: en['world.action.next'] }))
  expect(requestPreview).toHaveBeenCalledOnce()
  expect(JSON.parse(requestPreview.mock.calls[0]![0].command as string)).toMatchObject({ kind: 'draft',
    expectedRevision: 0, validUntil: '60', body: { persona: { name: 'Ada', skills: ['analysis'] } } })
})
