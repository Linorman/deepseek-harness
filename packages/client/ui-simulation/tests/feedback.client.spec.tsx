// @vitest-environment jsdom
/** Read errors, stale content and pending reads remain distinguishable. */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Feedback } from '../src/client/Feedback.tsx'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
it('prioritizes a read failure over stale/pending indicators without hiding a healthy idle state', () => {
  const ui = render(<Feedback value={{ loading: true, stale: true, error: 'network' }} t={key => en[key]} />)
  expect(ui.getByRole('alert').textContent).toBe(en.network)
  expect(ui.queryByText(en.stale)).toBeNull()
  ui.rerender(<Feedback value={{ loading: true, stale: true }} t={key => en[key]} />)
  expect(ui.getByText(en.stale)).toBeDefined()
  ui.rerender(<Feedback value={{ loading: true, stale: false }} t={key => en[key]} />)
  expect(ui.getByText(en.loading)).toBeDefined()
  ui.rerender(<Feedback value={{ loading: false, stale: false }} t={key => en[key]} />)
  expect(ui.container.textContent).toBe('')
})
