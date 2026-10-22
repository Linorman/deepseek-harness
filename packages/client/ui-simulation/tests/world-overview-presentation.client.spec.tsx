// @vitest-environment jsdom
/** World presentation: the live-only pulse feed, the dial, readable proposal titles, the electorate arc and folded uniform columns. */
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en } from '../src/client/locales.ts'
import { WorldOverview } from '../src/client/WorldOverview.tsx'
import { overviewChanges } from '../src/client/WorldPulse.tsx'
import { proposalTitle } from '../src/client/WorldFacts.tsx'
import { ElectorateArc } from '../src/client/WorldVotes.tsx'
import { OrganizationModule } from '../src/client/WorldOrganization.tsx'
import type { WorldOverviewView, WorldWindow } from '../src/client/world-domain.ts'
import { organization, overview, proposal } from './world-fixtures.client.ts'

afterEach(cleanup)
const t = makeTranslate(en) as never
const ready = <T,>(value: T): WorldWindow<T> => ({ status: 'ready', value, stale: false })
const props = { people: { loading: false, stale: false }, refreshPeople: vi.fn(), engine: [], budget: null, reload: vi.fn(),
  exportDefinition: vi.fn(), exporting: false, connected: true,
  links: { attention: vi.fn(), module: vi.fn(), caseStatus: vi.fn(), proposal: vi.fn(), records: vi.fn() }, t }

it('describes each changed overview fact once and nothing for an identical projection', () => {
  expect(overviewChanges(overview, { ...overview, revision: overview.revision + 1 }, t)).toEqual([])
  const next: WorldOverviewView = { ...overview, revision: 383, now: '1250', norms: { active: 5, knownNotEffective: 1 },
    proposals: [{ ...overview.proposals[0]!, tally: { ...overview.proposals[0]!.tally, for: 3, pending: 1 } }],
    caseFlow: overview.caseFlow.map(item => item.status === 'committed' ? { ...item, count: 15 } : item),
    attention: { ...overview.attention, outcomeUnknown: 0 } }
  expect(overviewChanges(overview, next, t)).toEqual([
    { domain: 'time', text: 'Simulated time 1,240 → 1,250 minute' },
    { domain: 'governance', text: 'Active norms 4 → 5' },
    { domain: 'governance', text: '“招聘需委员会批准” votes: 3 for · 1 against · 0 abstain' },
    { domain: 'cases', text: 'Result recorded matters 14 → 15' },
    { domain: 'attention', text: '0 outcomes unknown' },
  ])
})

it('treats the first projection as a baseline, lists later live revisions and resets for another run', () => {
  const ui = render(<WorldOverview runId="run-1" window={ready(overview)} {...props} />)
  const pulse = within(ui.getByRole('region', { name: en['world.pulse.title'] }))
  expect(pulse.getByText(en['world.pulse.empty'])).toBeDefined()
  ui.rerender(<WorldOverview runId="run-1" window={ready({ ...overview, revision: 383, now: '1300' })} {...props} />)
  expect(pulse.getByText('Simulated time 1,240 → 1,300 minute')).toBeDefined()
  // A stale re-delivery of an older revision is not a new observation.
  ui.rerender(<WorldOverview runId="run-1" window={ready({ ...overview, revision: 382, now: '1240' })} {...props} />)
  expect(pulse.getAllByRole('listitem')).toHaveLength(1)
  ui.rerender(<WorldOverview runId="run-2" window={ready({ ...overview, runId: 'run-2' as never, revision: 1 })} {...props} />)
  expect(pulse.getByText(en['world.pulse.empty'])).toBeDefined()
})

it('shows simulated time as the dial figure with a finite event axis and no axis motion on first load', () => {
  const ui = render(<WorldOverview runId="run-1" window={ready(overview)} {...props} />)
  const dial = ui.getByRole('region', { name: en['world.dial.title'] })
  expect(within(dial).getByRole('img', { name: 'Now 1,240 minute' })).toBeDefined()
  expect(within(dial).getByRole('img', { name: '2 scheduled events ahead; next at 1,300' })).toBeDefined()
  expect(dial.dataset.live).toBeUndefined()
  expect(within(dial).getByText(/^Next event: 1,300/)).toBeDefined()
  // An empty calendar leaves the hero instead of drawing an empty axis.
  ui.rerender(<WorldOverview runId="run-1" window={ready({ ...overview, upcoming: [] })} {...props} />)
  expect(dial.dataset.compact).toBe('true')
  expect(within(dial).queryByRole('img', { name: /scheduled events/ })).toBeNull()
  expect(within(dial).queryByText(en['world.overview.noEvents'])).toBeNull()
})

it('names a proposal by committee and short id only when the Host title is an opaque identifier', () => {
  expect(proposalTitle({ title: { text: '招聘需委员会批准' }, committee: { text: 'Policy' } }, t)).toBe('招聘需委员会批准')
  expect(proposalTitle({ title: { text: 'governance-proposal-1f7a9e1c33a04d6c9b7e0aa1c213c92e' }, committee: { text: 'Policy committee' } }, t))
    .toBe('Policy committee proposal · 13c92e')
})

it('draws the frozen electorate as seats whose shape encodes the ballot, and skips a single seat', () => {
  const ui = render(<ElectorateArc members={proposal.electorateMembers} identity="1200" t={t} />)
  const arc = ui.getByRole('img', { name: '5 seats: 2 for, 1 against, 0 abstain, 2 not yet voted' })
  expect(arc.querySelectorAll('[data-vote="for"] circle')).toHaveLength(2)
  expect(arc.querySelectorAll('[data-vote="against"] rect')).toHaveLength(1)
  expect(arc.querySelectorAll('[data-vote="pending"] circle[data-hollow]')).toHaveLength(2)
  ui.rerender(<ElectorateArc members={proposal.electorateMembers.slice(0, 1)} identity="1200" t={t} />)
  expect(ui.queryByRole('img')).toBeNull()
})

it('folds a people column whose loaded values are identical into one page summary', () => {
  const uniform = { ...organization, people: organization.people.map(row => ({ ...row, cognition: 'agent' as const })) }
  const ui = render(<OrganizationModule route={{ lens: 'people' }} window={ready(uniform)} person={{ status: 'idle' }} connected
    navigate={vi.fn()} reload={vi.fn()} openRef={vi.fn()} openAction={vi.fn()} dispose={vi.fn()} t={t} />)
  expect(ui.getByText(`All 4 on this page: ${en['world.org.people.cognition']}: ${en['world.org.cognition.agent']}`)).toBeDefined()
  const headers = within(ui.getByRole('table')).getAllByRole('columnheader').map(cell => cell.textContent)
  expect(headers).not.toContain(en['world.org.people.cognition'])
  expect(headers).toContain(en['world.org.people.residency'])
})

it('gathers low-frequency run tools in one collapsed section and states coverage only when the page is incomplete', () => {
  const extras = <button type="button">Open request history</button>
  const complete = { ...ready(overview), coverage: { scope: 'overview', complete: true, loaded: 4, total: 4, revision: 382 } }
  const ui = render(<WorldOverview runId="run-1" window={complete} {...props} budget={<p>Budget panel</p>} extras={extras} />)
  const management = ui.container.querySelector<HTMLDetailsElement>('details[data-world-management]')!
  expect(management.open).toBe(false)
  expect(within(management).getByText('Budget panel')).toBeDefined()
  expect(within(management).getByRole('button', { name: 'Open request history' })).toBeDefined()
  expect(ui.queryByText(/loaded/i)).toBeNull()
  ui.rerender(<WorldOverview runId="run-1" window={{ ...complete, coverage: { ...complete.coverage, complete: false, total: 9 } }} {...props} />)
  expect(ui.getByText(/4/, { selector: '[class*="coverage"] *, [class*="coverage"]' })).toBeDefined()
})
