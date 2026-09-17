// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { ITeamTasks } from '@clocky/clocky-client-runtime/client'
import { MemberDetail } from '../src/client/MemberDetail.tsx'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
type Inspect = NonNullable<ITeamTasks['inspectMember']>
const detail: Awaited<ReturnType<Inspect>> = { record: { id: 'member' as never, teamId: 'team' as never,
  kind: 'local-agent', phase: 'active', displayName: 'Researcher', role: 'research', provider: 'local' },
teamCursor: 7, startCursor: -1, total: 3, scanned: 2, items: ['first', 'second'], nextCursor: 1 }

it('replaces capability pages, pins continuation, and retains the page when a read fails', async () => {
  const inspect = vi.fn<Inspect>().mockResolvedValueOnce(detail)
    .mockRejectedValueOnce(new Error('Team changed; refresh'))
    .mockResolvedValueOnce({ ...detail, teamCursor: 8 })
    .mockResolvedValueOnce({ ...detail, teamCursor: 8, startCursor: 1, scanned: 1, items: ['third'], nextCursor: undefined })
  const view = render(<MemberDetail teamId={detail.record.teamId} participantId={detail.record.id} inspect={inspect}
    translate={makeTranslate(en)} onClose={vi.fn()} />)
  await view.findByText('first')
  fireEvent.click(view.getByRole('button', { name: 'Next capability page' }))
  await view.findByText('Team changed; refresh')
  expect(view.getByText('first')).toBeTruthy()
  expect(inspect).toHaveBeenNthCalledWith(2, { teamId: 'team', participantId: 'member', afterCursor: 1, expectedTeamCursor: 7 }, expect.any(AbortSignal))
  fireEvent.click(view.getByRole('button', { name: 'Refresh current page' }))
  await waitFor(() => { expect(view.queryByRole('alert')).toBeNull() })
  fireEvent.click(view.getByRole('button', { name: 'Next capability page' }))
  await view.findByText('third')
  expect(view.queryByText('first')).toBeNull()
  expect(inspect).toHaveBeenLastCalledWith({ teamId: 'team', participantId: 'member', afterCursor: 1, expectedTeamCursor: 8 }, expect.any(AbortSignal))
})

it('cancels a pending detail read when the dialog leaves', async () => {
  let signal: AbortSignal | undefined
  const inspect: Inspect = async (_input, inputSignal) => {
    signal = inputSignal
    return await new Promise(resolve => inputSignal?.addEventListener('abort', () => { resolve(detail) }, { once: true }))
  }
  const view = render(<MemberDetail teamId={detail.record.teamId} participantId={detail.record.id} inspect={inspect}
    translate={makeTranslate(en)} onClose={vi.fn()} />)
  view.unmount()
  expect(signal?.aborted).toBe(true)
})
