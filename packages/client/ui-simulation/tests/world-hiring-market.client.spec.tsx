// @vitest-environment jsdom
/** Review controls use complete authorized originals, never truncated summaries or stale history rows. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { simulationPersonaDraftSchema } from '@clocky/clocky-simulation'
import { HiringMarket } from '../src/client/WorldHiringMarket.tsx'
import type { HiringMarketView } from '../src/client/world-domain.ts'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en } from '../src/client/locales.ts'
const t = makeTranslate(en) as never
afterEach(cleanup)
const detail = simulationPersonaDraftSchema.parse({ kind: 'persona-draft', id: 'review-original', revision: 1,
  organizationEntityId: 'organization', positionEntityId: 'position', validUntil: '50',
  body: { templateId: 'finite', templateVersion: '1', persona: { name: 'Private original', skills: [], traits: [], goals: [] } },
  bodyHash: `sha256:${'a'.repeat(64)}`, prior: null, editedBy: { actorId: 'author', user: null }, source: { kind: 'finite-template', actorId: 'author', user: null,
    generatorVersion: 'finite-template/1', modelVersion: null, templateId: 'finite', templateVersion: '1', policyVersion: '1' },
  status: 'draft', reviewerId: null, reviewerSource: null, reviewReason: null })
const value: HiringMarketView = { runId: 'run' as never, coverage: { scope: 'hiring-market/persona-draft', loaded: 1, total: 1, revision: 42, complete: true },
  rows: [{ id: detail.id, requestId: 'request' as never, sequence: 40, revision: 1, status: 'draft', current: true,
    body: { state: 'allowed', value: { text: 'short summary', truncated: true } }, detail: { state: 'allowed', value: detail }, sources: [] }] }
it('refreshes an open market on revision changes without replacing the review reason and stops when collapsed', () => {
  const read = vi.fn(), review = vi.fn(), openRef = vi.fn()
  const props = { connected: true, read, review, openRef, t }
  const ui = render(<HiringMarket {...props} revision={42} window={{ status: 'ready', stale: false, value }} />)
  fireEvent.click(ui.getByRole('button', { name: en['world.market.title'] }))
  fireEvent.change(ui.getByLabelText(en['world.market.reason']), { target: { value: 'Keep my review' } })
  read.mockClear()
  ui.rerender(<HiringMarket {...props} revision={43} window={{ status: 'ready', stale: true, value }} />)
  expect(read).toHaveBeenCalledOnce()
  expect((ui.getByLabelText(en['world.market.reason']) as HTMLInputElement).value).toBe('Keep my review')
  fireEvent.click(ui.getByRole('button', { name: en['world.market.title'] }))
  ui.rerender(<HiringMarket {...props} revision={44} window={{ status: 'ready', stale: true, value }} />)
  expect(read).toHaveBeenCalledOnce()
  expect(review).not.toHaveBeenCalled()
})

it('prepares a review of the exact current complete Persona and preserves its hash', () => {
  const review = vi.fn(), read = vi.fn()
  const ui = render(<HiringMarket window={{ status: 'ready', stale: false, value }} connected read={read} review={review} openRef={vi.fn()} t={t} />)
  fireEvent.click(ui.getByRole('button', { name: en['world.market.title'] }))
  expect(read).toHaveBeenCalledWith('persona-draft')
  expect(ui.getByText('Private original')).toBeDefined()
  expect(ui.queryByRole('button', { name: en['world.market.accepted'] })).toBeNull()
  fireEvent.change(ui.getByLabelText(en['world.market.reason']), { target: { value: 'Reviewed against finite template' } })
  fireEvent.click(ui.getByRole('button', { name: en['world.market.reviewed'] }))
  expect(review).toHaveBeenCalledWith('position', 42, JSON.stringify({ kind: 'review', id: detail.id,
    organizationEntityId: detail.organizationEntityId, positionEntityId: detail.positionEntityId, revision: 1,
    bodyHash: detail.bodyHash, decision: 'reviewed', reason: 'Reviewed against finite template' }))
})
it('shows historical originals read-only and removes revoked private bodies immediately', () => {
  const row = value.rows[0]!, review = vi.fn()
  const ui = render(<HiringMarket window={{ status: 'ready', stale: false, value: { ...value, rows: [{ ...row, current: false }] } }}
    connected read={vi.fn()} review={review} openRef={vi.fn()} t={t} />)
  fireEvent.click(ui.getByRole('button', { name: en['world.market.title'] }))
  expect(ui.queryByRole('button', { name: en['world.market.reviewed'] })).toBeNull()
  ui.rerender(<HiringMarket window={{ status: 'ready', stale: true, value: { ...value, rows: [{ ...row,
    body: { state: 'withheld' }, detail: { state: 'withheld' } }] } }} connected read={vi.fn()} review={review} openRef={vi.fn()} t={t} />)
  expect(ui.queryByText('Private original')).toBeNull()
  expect(ui.queryByText('short summary')).toBeNull()
  expect(review).not.toHaveBeenCalled()
})

it('starts a finite draft only for a selected authorized position and retains revision CAS', () => {
  const review = vi.fn()
  const ui = render(<HiringMarket window={{ status: 'ready', stale: false, value }} connected
    positions={[{ id: 'position', name: { text: 'Research role' } }]} revision={42}
    read={vi.fn()} review={review} openRef={vi.fn()} t={t} />)
  fireEvent.click(ui.getByRole('button', { name: en['world.market.title'] }))
  expect(ui.getByRole('button', { name: en['world.market.createDraft'] }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(ui.getByLabelText('Research role'))
  fireEvent.click(ui.getByRole('button', { name: en['world.market.createDraft'] }))
  expect(review).toHaveBeenLastCalledWith('position', 42, '')
  fireEvent.click(ui.getByRole('button', { name: en['world.market.revise'] }))
  expect(JSON.parse(review.mock.lastCall![2] as string)).toMatchObject({ kind: 'draft', id: detail.id, expectedRevision: 1, body: detail.body })
})
it('compares authorized revisions in chronological order and drops the comparison on revocation', () => {
  const row = value.rows[0]!, newer = { ...detail, revision: 2, body: { ...detail.body,
    persona: { ...detail.body.persona, name: 'Revised original' } } }
  const rows = [{ ...row, sequence: 42, detail: { state: 'allowed' as const, value: newer } }, { ...row, current: false }]
  const ui = render(<HiringMarket window={{ status: 'ready', stale: false, value: { ...value, rows } }} connected
    read={vi.fn()} review={vi.fn()} openRef={vi.fn()} t={t} />)
  fireEvent.click(ui.getByRole('button', { name: en['world.market.title'] }))
  for (const checkbox of ui.getAllByRole('checkbox')) fireEvent.click(checkbox)
  expect(ui.getByRole('columnheader', { name: `${en['world.market.before']} r1` })).toBeDefined()
  ui.rerender(<HiringMarket window={{ status: 'ready', stale: false, value: { ...value, rows: [] } }} connected
    read={vi.fn()} review={vi.fn()} openRef={vi.fn()} t={t} />)
  expect(ui.queryByRole('table')).toBeNull()
  expect(ui.queryByText('Revised original')).toBeNull()
})
