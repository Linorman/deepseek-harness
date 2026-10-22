// @vitest-environment jsdom
/** Calendar controls only prepare a quote; unknown submissions retain their original runtime action. */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SimulationProductCalendarInput } from '@clocky/clocky-client-runtime/client'
import { CalendarEditor } from '../src/client/WorldCalendarEditor.tsx'
import { overview } from './world-fixtures.client.ts'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en } from '../src/client/locales.ts'
import type { WorldOverviewView } from '../src/client/world-domain.ts'
import { simulationProductCalendarInputSchema } from '@clocky/clocky-simulation-product/schema'

const rule = { id: 'shift', ruleRevision: 1, startsAt: '1300', endsAt: '1500', period: '100', maxOccurrences: 3,
  target: { kind: 'person' as const, personId: 'person' as never }, body: { state: 'allowed' as const, value: { text: 'Original work', truncated: false } } }
const view: WorldOverviewView = { ...overview, calendars: [rule] }
const t = makeTranslate(en) as never
afterEach(cleanup)
it('previews finite shifts and never submits from a form edit', async () => {
  const preview = vi.fn<(input: SimulationProductCalendarInput) => Promise<void>>(async () => {})
  const submit = vi.fn(async () => {})
  const ui = render(<CalendarEditor view={view} state={{ status: 'idle' }} connected preview={preview} submit={submit} close={() => true} t={t} />)
  fireEvent.click(ui.getByRole('button', { name: 'shift · 1' }))
  fireEvent.change(ui.getByLabelText(en['world.calendar.shifts']), { target: { value: '0,5' } })
  fireEvent.click(ui.getByRole('button', { name: en['world.calendar.preview'] }))
  await waitFor(() =>{  expect(preview).toHaveBeenCalledOnce() })
  expect(preview.mock.calls[0]?.[0]).toMatchObject({ runId: overview.runId, request: { expectedRuleRevision: 1,
    calendar: { id: 'shift', body: 'Original work', recurrence: { clock: 'simulation', shifts: ['0', '5'] } } } })
  expect(submit).not.toHaveBeenCalled()
})
it('offers exact retry after unknown submission and refuses hidden rule bodies', () => {
  const input = simulationProductCalendarInputSchema.parse({ runId: view.runId, request: { commandId: 'original', expectedRuleRevision: 1,
    calendar: { id: rule.id, startsAt: rule.startsAt, endsAt: rule.endsAt, period: rule.period,
      maxOccurrences: rule.maxOccurrences, target: rule.target, body: 'Original work' } } })
  const preview = vi.fn<(input: SimulationProductCalendarInput) => Promise<void>>(async () => {})
  const submit = vi.fn(async () => {}), close = vi.fn(() => false)
  const quote = { input, revision: 382, previewHash: `sha256:${'a'.repeat(64)}`, cancelled: [], queued: [] }
  const ui = render(<CalendarEditor view={view} state={{ status: 'unknown', input, preview: quote }} connected preview={preview} submit={submit} close={close} t={t} />)
  expect((ui.getByRole('button', { name: 'shift · 1' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(ui.getByRole('button', { name: en['world.calendar.retry'] }))
  expect(submit).toHaveBeenCalledOnce(); expect(preview).not.toHaveBeenCalled()
  ui.rerender(<CalendarEditor view={{ ...view, calendars: [{ ...rule, body: { state: 'withheld' } }] }} state={{ status: 'idle' }}
    connected preview={preview} submit={submit} close={close} t={t} />)
  expect(ui.queryByText('Original work')).toBeNull()
  expect((ui.getByRole('button', { name: 'shift · 1' }) as HTMLButtonElement).disabled).toBe(true)
})
it('quotes explicit civil clock, weekdays and ambiguity without inferring a browser timezone', async () => {
  const preview = vi.fn<(input: SimulationProductCalendarInput) => Promise<void>>(async () => {})
  const ui = render(<CalendarEditor view={view} state={{ status: 'idle' }} connected preview={preview}
    submit={async () => {}} close={() => true} t={t} />)
  fireEvent.click(ui.getByRole('button', { name: 'shift · 1' }))
  fireEvent.click(ui.getByRole('button', { name: en['world.calendar.clock.civil'] }))
  for (const [key, value] of [['timeZone', 'America/New_York'], ['origin', '2026-01-01T00:00:00Z'],
    ['tickMilliseconds', '60000'], ['from', '2026-11-01'], ['until', '2026-11-01'], ['weekdays', '7'],
    ['civilShifts', '01:30:00'], ['priority', '9']] as const)
    fireEvent.change(ui.getByLabelText(en[`world.calendar.${key}`]), { target: { value } })
  fireEvent.click(ui.getByRole('button', { name: en['world.calendar.disambiguation.later'] }))
  fireEvent.click(ui.getByRole('button', { name: en['world.calendar.preview'] }))
  await waitFor(() => { expect(preview).toHaveBeenCalledOnce() })
  expect(preview.mock.calls[0]?.[0].request.calendar).toMatchObject({ priority: 9, civil: {
    version: 1, timeZone: 'America/New_York', origin: '2026-01-01T00:00:00Z', tickMilliseconds: 60000,
    from: '2026-11-01', until: '2026-11-01', weekdays: [7], shifts: ['01:30:00'], disambiguation: 'later' } })
})
it('disables new edits during refresh recovery before the original input is known', () => {
  const close = vi.fn(() => false), preview = vi.fn(async () => {})
  const ui = render(<CalendarEditor view={view} state={{ status: 'recovering' }} connected preview={preview}
    submit={async () => {}} close={close} t={t} />)
  const edit = ui.getByRole('button', { name: 'shift · 1' }) as HTMLButtonElement
  expect(edit.disabled).toBe(true)
  fireEvent.click(edit)
  expect(close).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled()
})
