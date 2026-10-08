// @vitest-environment jsdom
/** Bounded draft admission preserves authorship when storage refuses an edit. */
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { useTaskDraft } from '../src/client/useTaskDraft.ts'

it('retains the prior draft on capacity refusal and clears the error after an admitted edit', () => {
  const original = { text: 'Original' }
  const save = vi.fn<(draft: typeof original) => void>().mockImplementationOnce(() => {
    throw new Error('Capacity exhausted')
  })
  const view = renderHook(() => {
    const [draft, setDraft] = useState(original)
    return useTaskDraft(draft, (next) => { save(next); setDraft(next) }, () => 'No draft capacity')
  })
  act(() => { view.result.current.change({ text: 'Rejected' }) })
  expect(view.result.current.error).toBe('No draft capacity')
  expect(view.result.current.latest.current).toBe(original)
  const accepted = { text: 'Accepted' }
  act(() => { view.result.current.change(accepted) })
  expect(view.result.current.error).toBeUndefined()
  expect(view.result.current.latest.current).toBe(accepted)
  expect(save).toHaveBeenLastCalledWith(accepted)
  const active = view.result.current.active
  expect(active.current).toBe(true)
  view.unmount()
  expect(active.current).toBe(false)
})
