// @vitest-environment jsdom
/** Session inspection changes presentation without replacing the conversation subtree. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionStage } from '../src/client/SessionStage.tsx'

afterEach(cleanup)

it('retains an unsent input and its DOM identity across embedded, modal, and closed presentation', () => {
  const close = vi.fn()
  const content = (inspecting: boolean, visible: boolean) => <SessionStage inspecting={inspecting} visible={visible}
    title="Worker A" backLabel="Back to team" expandLabel="Expand" restoreLabel="Restore" close={close}>
    <textarea aria-label="Draft" defaultValue="Unsent instructions" />
  </SessionStage>
  const view = render(content(false, true))
  const input = view.getByLabelText('Draft')
  fireEvent.change(input, { target: { value: 'Keep this draft' } })
  view.rerender(content(true, true))
  expect(view.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
  expect(view.getByLabelText('Draft')).toBe(input)
  fireEvent.click(view.getByRole('button', { name: 'Expand' }))
  expect(view.getByRole('button', { name: 'Restore' })).toBeDefined()
  view.rerender(content(true, false))
  expect(view.queryByRole('dialog')).toBeNull()
  view.rerender(content(true, true))
  expect((view.getByLabelText('Draft') as HTMLTextAreaElement).value).toBe('Keep this draft')
  expect(view.getByLabelText('Draft')).toBe(input)
  expect(close).not.toHaveBeenCalled()
})

it('restores the invoking control and delegates dismissal without owning task cancellation', () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const close = vi.fn()
  const view = render(<SessionStage inspecting visible title="Worker A" backLabel="Back to team"
    expandLabel="Expand" restoreLabel="Restore" close={close}><p>Execution record</p></SessionStage>)
  fireEvent(view.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }))
  expect(close).toHaveBeenCalledOnce()
  view.unmount()
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})
