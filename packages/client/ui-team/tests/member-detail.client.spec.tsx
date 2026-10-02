// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamMemberDetailState } from '@clocky/clocky-client-runtime/client'
import { MemberDetail } from '../src/client/MemberDetail.tsx'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
const detail: NonNullable<TeamMemberDetailState['value']> = { record: { id: 'member' as never, teamId: 'team' as never,
  kind: 'local-agent', phase: 'active', displayName: 'Researcher', role: 'research', provider: 'local' },
teamCursor: 7, startCursor: -1, total: 3, scanned: 2, items: ['first', 'second'], nextCursor: 1 }

it('renders runtime pages, delegates paging, and releases the selected detail on close', () => {
  const read = vi.fn().mockResolvedValue(undefined)
  const closeDetail = vi.fn()
  const props = { teamId: detail.record.teamId, participantId: detail.record.id, read, closeDetail,
    translate: makeTranslate(en), onClose: vi.fn() }
  const state = { teamId: detail.record.teamId, participantId: detail.record.id, value: detail,
    loading: false, disconnected: false, hasNewer: false }
  const view = render(<MemberDetail {...props} detail={state} />)
  expect(read).toHaveBeenCalledWith('team', 'member', 'first')
  fireEvent.click(view.getByRole('button', { name: 'Next capability page' }))
  expect(read).toHaveBeenLastCalledWith('team', 'member', 'next')
  view.rerender(<MemberDetail {...props} detail={{ ...state, error: 'Refresh required', hasNewer: true }} />)
  expect(view.getByText('first')).toBeTruthy()
  expect(view.getByRole('button', { name: 'Next capability page' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Refresh current page' }))
  expect(read).toHaveBeenLastCalledWith('team', 'member', 'refresh')
  view.rerender(<MemberDetail {...props} detail={{ ...state, disconnected: true }} />)
  expect(view.getByText(en['attention.disconnected'])).toBeTruthy()
  expect(view.getByRole('button', { name: 'Refresh current page' }).hasAttribute('disabled')).toBe(true)
  view.rerender(<MemberDetail {...props} detail={undefined} />)
  expect(view.queryByText('Researcher')).toBeNull()
  expect(view.queryByRole('button', { name: 'Copy member ID' })).toBeNull()
  view.unmount()
  expect(closeDetail).toHaveBeenCalledOnce()
})

it('copies the exact member ID and reports clipboard denial without claiming success', async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce(new Error('Clipboard denied')).mockResolvedValueOnce(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  try {
    const read = vi.fn().mockResolvedValue(undefined)
    const view = render(<MemberDetail teamId={detail.record.teamId} participantId={detail.record.id} read={read} closeDetail={vi.fn()}
      detail={{ teamId: detail.record.teamId, participantId: detail.record.id,
        value: detail, loading: false, disconnected: false, hasNewer: false }}
      translate={makeTranslate(en)} onClose={vi.fn()} />)
    await view.findByText('Researcher')
    expect(view.getByText('member', { selector: 'code' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Copy member ID' }))
    await view.findByText(en['memberDetail.copyFailed'])
    expect(view.queryByText('Member ID copied')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Copy member ID' }))
    await view.findByText('Member ID copied')
    expect(writeText).toHaveBeenLastCalledWith('member')
    expect(view.queryByText(en['memberDetail.copyFailed'])).toBeNull()
  } finally {
    if (original === undefined) Reflect.deleteProperty(navigator, 'clipboard')
    else Object.defineProperty(navigator, 'clipboard', original)
  }
})
