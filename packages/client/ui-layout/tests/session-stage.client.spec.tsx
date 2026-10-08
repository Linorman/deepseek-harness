// @vitest-environment jsdom
/** The conversation pane changes presentation without replacing the conversation subtree. */
import { Modal } from '@clocky/clocky-client-ui-primitives'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionStage } from '../src/client/SessionStage.tsx'
import type { PaneMode } from '../src/client/columns.ts'

afterEach(cleanup)

const labels = { title: 'Worker A', closeLabel: 'Close conversation', expandLabel: 'Expand conversation', restoreLabel: 'Restore split view' }

it('retains an unsent input and its DOM identity across inline, pane, expanded, and closed presentation', () => {
  const close = vi.fn()
  const toggle = vi.fn()
  const content = (inspecting: boolean, visible: boolean, mode: PaneMode = 'split') => (
    <SessionStage inspecting={inspecting} visible={visible} mode={mode} {...labels} close={close} toggleExpanded={toggle}>
      <textarea aria-label="Draft" defaultValue="Unsent instructions" />
    </SessionStage>
  )
  const view = render(content(false, true))
  const input = view.getByLabelText('Draft')
  fireEvent.change(input, { target: { value: 'Keep this draft' } })
  expect(view.queryByRole('button', { name: 'Close conversation' })).toBeNull()
  view.rerender(content(true, true))
  const pane = view.getByRole('region', { name: 'Worker A' })
  expect(pane.getAttribute('data-conversation-pane')).toBe('split')
  expect(pane.getAttribute('aria-modal')).toBeNull()
  expect(view.getByLabelText('Draft')).toBe(input)
  fireEvent.click(view.getByRole('button', { name: 'Expand conversation' }))
  expect(toggle).toHaveBeenCalledOnce()
  view.rerender(content(true, true, 'expanded'))
  expect(view.getByRole('button', { name: 'Restore split view' }).getAttribute('aria-pressed')).toBe('true')
  view.rerender(content(true, false))
  expect(view.queryByRole('region')).toBeNull()
  view.rerender(content(true, true))
  expect((view.getByLabelText('Draft') as HTMLTextAreaElement).value).toBe('Keep this draft')
  expect(view.getByLabelText('Draft')).toBe(input)
  expect(close).not.toHaveBeenCalled()
})

it('moves focus into the pane, closes on Escape, and returns focus to the opener', () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const close = vi.fn()
  const view = render(<SessionStage inspecting visible {...labels} close={close}><p>Execution record</p></SessionStage>)
  const pane = view.getByRole('region', { name: 'Worker A' })
  expect(document.activeElement).toBe(pane)
  fireEvent.keyDown(pane, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
  view.unmount()
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})

it('leaves Escape to inner controls that consume it and to input methods', () => {
  const close = vi.fn()
  const view = render(<SessionStage inspecting visible {...labels} close={close}>
    <input aria-label="Inner" onKeyDown={(event) => { if (event.key === 'Escape') event.preventDefault() }} />
  </SessionStage>)
  fireEvent.keyDown(view.getByLabelText('Inner'), { key: 'Escape' })
  fireEvent.keyDown(view.getByRole('region'), { key: 'Escape', isComposing: true })
  expect(close).not.toHaveBeenCalled()
})

it('leaves Escape from a portaled layer opened inside the pane to that layer', () => {
  const close = vi.fn()
  const view = render(<SessionStage inspecting visible {...labels} close={close}>
    <Modal open title="Original image" onClose={() => {}}><button type="button">Preview</button></Modal>
  </SessionStage>)
  fireEvent.keyDown(view.getByRole('button', { name: 'Preview' }), { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
})

it('offers no expansion while presented as a sheet', () => {
  const view = render(<SessionStage inspecting visible mode="sheet" {...labels} close={() => {}} toggleExpanded={() => {}}>x</SessionStage>)
  expect(view.queryByRole('button', { name: 'Expand conversation' })).toBeNull()
  expect(view.getByRole('button', { name: 'Close conversation' })).toBeDefined()
})
