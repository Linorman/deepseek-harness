// @vitest-environment jsdom
/** Canonical structured failure facts locate exact authorized references while private provider text stays absent. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { CheckpointDiagnostic } from '../src/client/CheckpointDiagnostic.tsx'
import { CommandRecord } from '../src/client/CommandRecord.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'

afterEach(cleanup)
it('locates a canonical channel within its exact owning Team', () => {
  const navigate = vi.fn()
  const view = render(<CheckpointDiagnostic runId={'run' as never} value={{ stage: 'restore', code: 'history-incomplete',
    subject: { kind: 'channel', teamId: 'team' as never, channelId: 'channel' as never } }}
  navigateApplication={navigate} t={key => en[key]} />)
  const link = view.getByRole('link', { name: `${en.inspectTeamChannel}: channel` }) as HTMLAnchorElement
  const query = new URL(link.href).searchParams
  expect(query.get('team')).toBe('team'); expect(query.get('channel')).toBe('channel')
  fireEvent.click(link)
  expect(navigate).toHaveBeenCalledWith(link.href)
})
it.each([en, zh])('renders only the fixed category/stage and canonical Session binding with independent cleanup', (locale) => {
  const view = render(<CheckpointDiagnostic runId={'run' as never} value={{ stage: 'collect', code: 'source-unavailable',
    subject: { kind: 'session', sessionId: 'session' as never, teamId: 'team' as never, participantId: 'member' as never },
    cleanup: 'unconfirmed' }} t={key => locale[key]} />)
  expect(view.getByText(`${locale['diagnostic.stage.collect']} · ${locale['diagnostic.code.source-unavailable']}`)).toBeDefined()
  const link = view.getByRole('link', { name: `${locale.inspectTeamSession}: session` }) as HTMLAnchorElement
  const query = new URL(link.href).searchParams
  expect(query.get('team')).toBe('team'); expect(query.get('session')).toBe('session'); expect(query.get('participant')).toBe('member')
  expect(view.getByText(locale['diagnostic.cleanup'])).toBeDefined()
  expect(view.container.textContent).not.toContain('PRIVATE_CHECKPOINT_STORAGE_ROOT')
})
it('keeps a failed diagnostic original query available separately from current checkpoint admission', () => {
  const query = vi.fn(async () => undefined)
  const view = render(<CommandRecord value={{ command: { kind: 'checkpoint', input: { runId: 'run' as never, commandId: 'checkpoint' as never } },
    pending: false, unknown: false, notFound: false, receipt: { kind: 'request', value: { runId: 'run' as never, commandId: 'checkpoint' as never,
      kind: 'checkpoint', acceptedAt: 1, status: 'failed', failure: 'checkpoint-failed', diagnostic: { stage: 'validate', code: 'binding-mismatch',
        subject: { kind: 'run' } } } } }} connected query={query} retry={vi.fn(async () => undefined)} t={(key: Key) => en[key]} />)
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  expect(query).toHaveBeenCalledOnce()
})
