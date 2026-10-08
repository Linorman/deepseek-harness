// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { ParticipantId, TeamId, TeamIdentityState } from '@clocky/clocky-client-runtime/client'
import { MemberReference } from '../src/client/MemberReference.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

const id = 'worker-1' as ParticipantId
function identities(state: 'resolved' | 'unavailable'): TeamIdentityState {
  return { teamId: 'team' as TeamId, loading: false, disconnected: false, forbidden: false,
    items: [state === 'resolved'
      ? { participantId: id, state, displayName: { text: 'Researcher', truncated: false }, phase: 'active' }
      : { participantId: id, state }] }
}

it('previews a resolved member on hover and still opens the inspector', () => {
  vi.useFakeTimers()
  const inspect = vi.fn()
  render(<MemberReference id={id} identities={identities('resolved')} inspect={inspect} translate={makeTranslate(en)} />)
  const button = screen.getByRole('button', { name: 'Researcher' })
  const anchor = button.parentElement
  if (anchor === null) throw new Error('the reference has no hover anchor')
  fireEvent.pointerEnter(anchor)
  act(() => { vi.advanceTimersByTime(600) })
  const preview = document.querySelector('[data-member-preview]')
  expect(preview?.textContent).toContain('Researcher')
  expect(preview?.textContent).toContain(en['detail.participant.phase.active'])
  fireEvent.click(button)
  expect(inspect).toHaveBeenCalledWith(id)
})

it('offers neither preview nor inspector for an unavailable identity', () => {
  render(<MemberReference id={id} identities={identities('unavailable')} inspect={vi.fn()} translate={makeTranslate(en)} />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(document.querySelector('[data-member-preview]')).toBeNull()
})
