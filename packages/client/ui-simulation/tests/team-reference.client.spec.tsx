// @vitest-environment jsdom
/** Native inspection links preserve exact Session targets and modified-click behavior in both locales. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TeamReference } from '../src/client/TeamReference.tsx'
import { ObjectDetails } from '../src/client/ObjectDetails.tsx'
import { en, zh } from '../src/client/locales.ts'
afterEach(cleanup)

it.each([en, zh])('navigates an exact historical Session without interpreting its binding as authority', (locale) => {
  const navigateApplication = vi.fn()
  const view = render(<TeamReference target={{ kind: 'session', teamId: 'team' as never, sessionId: 'old-session' as never,
    participantId: 'member' as never }} id="old-session" navigateApplication={navigateApplication} t={key => locale[key]} />)
  const link = view.getByRole('link', { name: `${locale.inspectTeamSession}: old-session` })
  const url = new URL(link.getAttribute('href')!)
  expect(url.searchParams.get('session')).toBe('old-session')
  expect(url.searchParams.get('participant')).toBe('member')
  fireEvent.click(link, { ctrlKey: true })
  expect(navigateApplication).not.toHaveBeenCalled()
  fireEvent.click(link)
  expect(navigateApplication).toHaveBeenCalledWith(url.href)
})

it('keeps unmaterialized checkpoint Session references inert while linking complete read identities', () => {
  const view = render(<ObjectDetails value={{ collection: 'checkpoints', section: 'references', id: 'checkpoint' as never,
    summary: { id: 'checkpoint' as never, status: 'completed', startedSequence: 0, finishedSequence: 1,
      latestSuccessful: true, sourceValidation: 'not-performed' }, references: { total: 3, items: [
      { kind: 'team', id: 'team' as never, cursor: 1 },
      { kind: 'session', id: 'stored' as never, teamId: 'team' as never, participantId: 'member' as never, materialization: 'materialized', sequence: 2 },
      { kind: 'session', id: 'absent' as never, teamId: 'team' as never, participantId: 'other' as never, materialization: 'unmaterialized' }] } }}
  t={key => en[key]} date={String} view={{ runId: 'run', module: 'checkpoints', search: '' }} navigate={vi.fn()} readPage={vi.fn()}
  blocked={false} canContinue />)
  expect(view.getByRole('link', { name: `${en.inspectTeam}: team` })).toBeDefined()
  expect(view.getByRole('link', { name: `${en.inspectTeamSession}: stored` })).toBeDefined()
  expect(view.queryByRole('link', { name: /absent/ })).toBeNull()
  expect(view.getByText('absent')).toBeDefined()
})

it('labels exact Team task targets while preserving native modified-click behavior', () => {
  const navigateApplication = vi.fn()
  const view = render(<TeamReference target={{ kind: 'task', teamId: 'team' as never, taskId: 'task' as never }}
    id="task" navigateApplication={navigateApplication} t={key => en[key]} />)
  const link = view.getByRole('link', { name: `${en.inspectTeamTask}: task` }) as HTMLAnchorElement
  expect(new URL(link.getAttribute('href')!).searchParams.get('task')).toBe('task')
  fireEvent.click(link, { metaKey: true })
  expect(navigateApplication).not.toHaveBeenCalled()
})

it('labels exact Team targets without requiring a member-specific binding', () => {
  const view = render(<TeamReference target={{ kind: 'channel', teamId: 'team' as never,
    channelId: 'channel' as never }} id="channel" t={key => en[key]} />)
  expect(view.getByRole('link', { name: `${en.inspectTeamChannel}: channel` })).toBeDefined()
  const plain = render(<TeamReference target={{ kind: 'team', teamId: 'team' as never }} id="team" t={key => en[key]} />)
  const link = plain.getByRole('link', { name: `${en.inspectTeam}: team` }) as HTMLAnchorElement
  expect(new URL(link.getAttribute('href')!).searchParams.get('team')).toBe('team')
})
