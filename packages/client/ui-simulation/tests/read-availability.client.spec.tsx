// @vitest-environment jsdom
/** A temporarily unavailable administrative read must keep an explicit recovery path. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskReviews } from '../src/client/TaskReviews.tsx'
import { TaskControls } from '../src/client/TaskControls.tsx'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)

it.each([
  { View: TaskReviews, label: 'reviews.refresh' },
  { View: TaskControls, label: 'taskControl.refresh' },
] as const)('keeps $label available after a cold Host read fails', ({ View, label }) => {
  const read = vi.fn(async () => {})
  const submit = vi.fn(async () => undefined)
  const view = render(<View runId={'run' as never} ready connected authorizationVersion={1} pageSize={2}
    value={{ loading: false, stale: false, error: 'unavailable' }} read={read} drafts={{}} commands={{}}
    select={() => {}} change={() => {}} retain={() => 'unused' as never} submit={submit} query={async () => undefined}
    t={key => en[key]} />)
  read.mockClear()
  fireEvent.click(view.getByRole('button', { name: en[label] }))
  expect(read).toHaveBeenCalledWith({ runId: 'run', limit: 2 })
  expect(submit).not.toHaveBeenCalled()
  expect(view.getByRole('alert').textContent).toBe(en.unavailable)
})
