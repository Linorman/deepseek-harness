// @vitest-environment jsdom
/** Refs preview metadata only; newer revisions never replace a page; live changes mark rows; inspectors resize in bounds. */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en } from '../src/client/locales.ts'
import { worldReadDecisionIdSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import { EngineRefLink } from '../src/client/WorldRefs.tsx'
import { InspectorDock } from '../src/client/WorldInspector.tsx'
import { OrganizationModule } from '../src/client/WorldOrganization.tsx'
import type { OrganizationView } from '../src/client/world-domain.ts'
import { organization, person } from './world-fixtures.client.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })
const t = makeTranslate(en) as never

it('previews only the reference metadata after a dwell and navigates on activation', () => {
  vi.useFakeTimers()
  const open = vi.fn()
  const ui = render(<EngineRefLink value={{ kind: 'decision', id: worldReadDecisionIdSchema.parse('decision-412'), label: 'Li Hua decision' }} open={open} t={t} />)
  const link = ui.getByRole('button', { name: 'decision-412 ↗' })
  expect(link.getAttribute('aria-describedby')).not.toBeNull()
  expect(document.getElementById(link.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Decision · decision-412 · Li Hua decision')
  fireEvent.pointerEnter(link.parentElement as HTMLElement)
  act(() => { vi.advanceTimersByTime(399) })
  expect(document.body.textContent).not.toContain(en['world.ref.identity'])
  act(() => { vi.advanceTimersByTime(1) })
  expect(document.body.textContent).toContain(en['world.ref.identity'])
  fireEvent.click(link)
  expect(open).toHaveBeenCalledWith({ kind: 'decision', id: 'decision-412', label: 'Li Hua decision' })
  ui.rerender(<EngineRefLink value={{ kind: 'record', sequence: 88 }} t={t} />)
  expect((ui.getByRole('button', { name: '#88 ↗' }) as HTMLButtonElement).disabled).toBe(true)
})


function people(view: OrganizationView) {
  return <OrganizationModule route={{ lens: 'people' }} window={{ status: 'ready', value: view, stale: false }} person={{ status: 'idle' }}
    connected navigate={vi.fn()} reload={vi.fn()} openRef={vi.fn()} openAction={vi.fn()} dispose={vi.fn()} t={t} />
}

it('marks only rows that changed live and summarizes them politely, never on the first load', () => {
  const ui = render(people(organization))
  expect(ui.container.querySelector('tr[data-changed]')).toBeNull()
  const changed = { ...organization, people: organization.people.map(row => row.id === 'wang' ? { ...row, pendingObligations: 2 } : row) }
  ui.rerender(people(changed))
  const marked = Array.from(ui.container.querySelectorAll('tr[data-changed]'))
  expect(marked.map(row => row.getAttribute('data-row'))).toEqual(['wang'])
  expect(ui.getByText('1 rows updated')).toBeDefined()
  ui.rerender(people({ ...changed, coverage: { ...changed.coverage, pendingUpdates: 2 } }))
  expect(ui.queryByText('2 newer updates')).toBeNull()
})

it('resizes the inspector by keyboard within the minimum and configured maximum', () => {
  const resize = vi.fn()
  const ui = render(<InspectorDock title={person.name.text} identity="wang" close={vi.fn()} sizing={{ width: 512, maxWidth: 520, resize }} t={t}>
    <p>body</p></InspectorDock>)
  const handle = ui.getByRole('separator', { name: en['world.inspector.resize'] })
  expect(handle.getAttribute('aria-valuenow')).toBe('512')
  fireEvent.keyDown(handle, { key: 'ArrowLeft' })
  expect(resize).toHaveBeenLastCalledWith(520)
  ui.rerender(<InspectorDock title="x" identity="wang" close={vi.fn()} sizing={{ width: 300, maxWidth: 520, resize }} t={t}><p>body</p></InspectorDock>)
  expect(ui.getByRole('separator').getAttribute('aria-valuenow')).toBe('360')
  fireEvent.keyDown(ui.getByRole('separator'), { key: 'ArrowRight' })
  expect(resize).toHaveBeenLastCalledWith(360)
})
