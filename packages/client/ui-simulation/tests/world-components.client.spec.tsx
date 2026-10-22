// @vitest-environment jsdom
/** World fact components keep unknown, unavailable, withheld and zero distinct and never merge independent states. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { worldReadTeamIdSchema, worldReadTaskIdSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import { simulationProductCursorSchema } from '@clocky/clocky-simulation-product/schema'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en } from '../src/client/locales.ts'
import { Count, CoverageNote, EnforcementBadge, PrivacyGate, SourceKindBadge, TemporalFacts, TimeInterval, WindowStatus, displayText,
  errorReason, shortId } from '../src/client/WorldFacts.tsx'
import { jsonSummary } from '../src/client/WorldDraftTable.tsx'
import { MutationSteps, OccupancyMeter, StatusTrack } from '../src/client/WorldTracks.tsx'
import { ElectorateGrid, ObligationList, VoteTally } from '../src/client/WorldVotes.tsx'
import { caseExtension, person, proposal } from './world-fixtures.client.ts'

afterEach(cleanup)
const t = makeTranslate(en) as never

it('renders four independent tracks with text for every node and a compact form carrying the same sentences', () => {
  const open = vi.fn()
  const ui = render(<StatusTrack tracks={caseExtension.tracks} open={open} t={t} />)
  expect(ui.getAllByRole('group').map(group => group.getAttribute('aria-label'))).toEqual([en['world.track.request'],
    en['world.track.plan'], en['world.track.execution'], en['world.track.notification']])
  expect(ui.getByText(`待补证: ${en['world.track.state.waiting']}`)).toBeDefined()
  expect(ui.getByText(en['world.track.notStarted'])).toBeDefined()
  fireEvent.click(ui.getByRole('button', { name: 'View Plan state' }))
  expect(open).toHaveBeenCalledWith('plan')
  ui.rerender(<StatusTrack tracks={caseExtension.tracks} compact t={t} />)
  expect(ui.getByRole('img').getAttribute('aria-label')).toContain(`${en['world.track.execution']}: 已阻塞`)
})

it('states half-open intervals and leaves missing temporal facts unavailable instead of omitting them', () => {
  const ui = render(<><TimeInterval from="1200" t={t} /><TemporalFacts times={{ effective: '1300' }} t={t} /></>)
  expect(ui.getByLabelText('from 1,200 until now')).toBeDefined()
  expect(ui.getByText('1,300')).toBeDefined()
  expect(ui.container.querySelectorAll('[data-fact="unavailable"]')).toHaveLength(4)
})

it('reports unavailable and failed reads while silently refreshing retained windows', () => {
  const retry = vi.fn()
  const ui = render(<WindowStatus window={{ status: 'unpublished' }} t={t} />)
  expect(ui.getByText(en['world.unpublished'])).toBeDefined()
  ui.rerender(<WindowStatus window={{ status: 'error', message: 'offline' }} retry={retry} t={t} />)
  fireEvent.click(ui.getByRole('button', { name: en['world.retry'] }))
  expect(retry).toHaveBeenCalledOnce()
  ui.rerender(<WindowStatus window={{ status: 'ready', value: 1, stale: true }} t={t} />)
  expect(ui.queryByText(en['world.stale'])).toBeNull()
  ui.rerender(<><Count value={undefined} t={t} /><Count value={0} t={t} /></>)
  expect(ui.container.querySelector('[data-fact="unavailable"]')).not.toBeNull()
  expect(ui.getByText('0')).toBeDefined()
})

it('states partial coverage with revision and offers continuation only when the Host returned a cursor', () => {
  const more = vi.fn()
  const ui = render(<CoverageNote value={{ scope: 'organization:structure', complete: false, loaded: 24, total: 31, revision: 382, at: '1100', nextCursor: simulationProductCursorSchema.parse('next') }} more={more} t={t} />)
  expect(ui.getByText('Loaded 24 of 31 · revision 382 · at 1,100')).toBeDefined()
  fireEvent.click(ui.getByRole('button', { name: en['world.coverage.more'] }))
  expect(more).toHaveBeenCalledOnce()
  ui.rerender(<CoverageNote value={{ scope: 'organization:people', complete: true, loaded: 2, total: 2, revision: 1 }} more={more} t={t} />)
  expect(ui.queryByRole('button')).toBeNull()
})

it('renders private content only when disclosed and replaces it immediately on revocation', () => {
  const ui = render(<PrivacyGate<string> value={{ state: 'allowed', value: 'Persona text' }} t={t}>{text => <p>{text}</p>}</PrivacyGate>)
  expect(ui.getByText('Persona text')).toBeDefined()
  ui.rerender(<PrivacyGate<string> value={{ state: 'withheld' }} t={t}>{text => <p>{text}</p>}</PrivacyGate>)
  expect(ui.queryByText('Persona text')).toBeNull()
  expect(ui.container.querySelector('[data-disclosure="withheld"]')?.textContent).toContain(en['disclosure.withheld'])
  expect(ui.container.querySelector('[data-disclosure="withheld"]')?.textContent).toContain(en['disclosure.withheld.why'])
})

it('flags validated enforcement without a policy and keeps unknown future source kinds literal', () => {
  const ui = render(<><EnforcementBadge value={{ mode: 'validated' }} t={t} /><SourceKindBadge kind="future-oracle" t={t} />
    <SourceKindBadge kind="director-ruling" t={t} /></>)
  expect(ui.getByText(en['world.enforcement.missingPolicy'])).toBeDefined()
  expect(ui.getByText('Unknown kind: future-oracle')).toBeDefined()
  expect(ui.getByText(en['world.source.director-ruling'])).toBeDefined()
})

it('reports occupancy beyond capacity as a data error instead of a full position', () => {
  const ui = render(<OccupancyMeter occupied={2} reserved={1} capacity={3} t={t} />)
  expect(ui.getByText(en['world.occupancy.full'])).toBeDefined()
  ui.rerender(<OccupancyMeter occupied={3} reserved={1} capacity={3} t={t} />)
  expect(ui.getByRole('alert').textContent).toBe(en['world.occupancy.over'])
  expect(ui.queryByText(en['world.occupancy.full'])).toBeNull()
})

it('shows tally thresholds, Host closure wording and an invalid rule without computing an outcome', () => {
  const tally = { ...proposal.tally, threshold: 6 }
  const ui = render(<VoteTally value={tally} t={t} />)
  expect(ui.getByText(en['world.vote.closure.can-still-change'])).toBeDefined()
  expect(ui.getByRole('alert').textContent).toBe(en['world.vote.invalidRule'])
  ui.rerender(<VoteTally value={proposal.tally} t={t} />)
  expect(ui.getByText(`${en['world.vote.quorum']} · ${en['world.vote.threshold']}`, { exact: false })).toBeDefined()
})

it('lists frozen electorate seats with their decisions and marks members who later left', () => {
  const openRef = vi.fn()
  const ui = render(<ElectorateGrid members={proposal.electorateMembers} frozenAt={proposal.frozenAt} openRef={openRef} t={t} />)
  expect(ui.getByText(en['world.electorate.left'])).toBeDefined()
  fireEvent.click(ui.getByRole('button', { name: 'Decision 420 ↗' }))
  expect(openRef).toHaveBeenCalledWith({ kind: 'decision', id: '420' })
})

it('renders only Host-declared dispositions and disables them with a stated reason', () => {
  const dispose = vi.fn()
  const ui = render(<ObligationList items={person.obligations} openRef={vi.fn()} dispose={dispose} t={t} />)
  expect(ui.queryByRole('button', { name: en['world.obligation.disposition.wait'] })).toBeNull()
  expect(ui.getAllByText(en['world.obligation.disposition.wait'])).toHaveLength(2)
  expect(ui.getAllByRole('button', { name: en['world.obligation.disposition.cancel-and-recreate'] })).toHaveLength(1)
  fireEvent.click(ui.getByRole('button', { name: en['world.obligation.disposition.cancel-and-recreate'] }))
  expect(dispose).toHaveBeenCalledWith(person.obligations.find(item => item.dispositions.includes('cancel-and-recreate')), 'cancel-and-recreate')
  ui.rerender(<ObligationList items={person.obligations} openRef={vi.fn()} disabledReason="offline" t={t} />)
  expect((ui.getByRole('button', { name: en['world.obligation.disposition.cancel-and-recreate'] }) as HTMLButtonElement).disabled).toBe(true)
  expect(ui.getByRole('button', { name: en['world.obligation.disposition.cancel-and-recreate'] }).title).toBe('offline')
  ui.rerender(<ObligationList items={[]} openRef={vi.fn()} t={t} />)
  expect(ui.getByText(en['world.obligations.none'])).toBeDefined()
  ui.rerender(<ObligationList items={[]} complete openRef={vi.fn()} t={t} />)
  expect(ui.getByText(en['world.obligations.completeEmpty'])).toBeDefined()
})

it('keeps unknown canonical owner duties visible with their exact original metadata and task reference', () => {
  const open = vi.fn()
  const ui = render(<ObligationList items={[{ id: 'original-duty', kind: 'owner-duty', label: { text: 'Original task owner', truncated: false },
    owner: { text: 'canonical-team', truncated: false }, state: 'handoff-required', revision: 8, dispositions: [],
    certainty: 'outcome-unknown', ownerState: 'running', original: { owner: { kind: 'team', teamId: 'canonical-team' as never },
      ref: { kind: 'team-task', teamId: 'canonical-team' as never, taskId: 'original-task' as never, revision: 4, relation: 'owner' }, cursor: 8 },
    ref: { kind: 'team-task', teamId: worldReadTeamIdSchema.parse('canonical-team'), id: worldReadTaskIdSchema.parse('original-task') } }]} openRef={open} t={t} />)
  expect(ui.getByText(en['world.obligation.certainty.outcome-unknown'])).toBeTruthy()
  fireEvent.click(ui.getByText(en['world.obligation.source']))
  expect(ui.getByText('running')).toBeTruthy()
  expect(ui.getByText(/"relation": "owner"/)).toBeTruthy()
  fireEvent.click(ui.getByRole('button', { name: 'original-task ↗' }))
  expect(open).toHaveBeenCalledWith({ kind: 'team-task', teamId: 'canonical-team', id: 'original-task' })
})

it('marks the current mutation phase and its blocked branch without implying progress past it', () => {
  const ui = render(<MutationSteps phase="quiescing" blocked="handoff-required" cancelRequested t={t} />)
  expect(ui.container.querySelector('[aria-current="step"]')?.textContent).toBe(en['world.mutation.quiescing'])
  expect(ui.getByText('Blocked: handoff-required')).toBeDefined()
  expect(ui.getByText(en['world.mutation.cancelRequested'])).toBeDefined()
  expect(ui.container.querySelector('li[data-state="done"]')?.textContent).toBe(en['world.mutation.retained'])
})

it('names a failed refresh separately from a failed first load and localizes known read codes only', () => {
  const ui = render(<WindowStatus window={{ status: 'error', message: 'internal' }} t={t} />)
  expect(ui.getByText(en['world.loadFailed'])).toBeDefined()
  expect(ui.getByText(en['world.error.internal'])).toBeDefined()
  ui.rerender(<WindowStatus window={{ status: 'error', message: 'network', previous: 1 }} t={t} />)
  expect(ui.getByText(en['world.loadFailedKept'])).toBeDefined()
  expect(ui.getByText(en['world.error.network'])).toBeDefined()
  expect(errorReason('future-host-code', t)).toBe('future-host-code')
})

it('keeps the Host scope key out of the coverage sentence but available as its tooltip', () => {
  const ui = render(<CoverageNote value={{ scope: 'organization/people', complete: true, loaded: 4, total: 4, revision: 56 }} t={t} />)
  expect(ui.container.textContent).not.toContain('organization/people')
  expect(ui.container.querySelector('p')?.getAttribute('title')).toContain('organization/people')
})

it('compacts only opaque identifiers and summarizes compound cells without losing their identity', () => {
  const hash = 'simulation-world-calendar-wake:d1f5688e9c73576d05e6babe44c48f4a'
  expect(shortId('short-id')).toBe('short-id')
  expect(shortId(hash)).toBe(`${hash.slice(0, 14)}…${hash.slice(-6)}`)
  expect(displayText(hash)).toBe(shortId(hash))
  expect(displayText('A title long enough to pass thirty-two characters')).toBe('A title long enough to pass thirty-two characters')
  expect(jsonSummary([], t)).toBe(en['world.json.none'])
  expect(jsonSummary(['a', 'b'], t)).toBe('a, b')
  expect(jsonSummary({ domain: 'external', operation: 'interact', version: '3' }, t)).toBe('external · interact · v3')
  expect(jsonSummary([{ kind: 'grant' }, { kind: 'grant' }, { kind: 'grant' }], t)).toBe('grant +2 more')
  expect(jsonSummary({ a: 1, b: 2 }, t)).toBe('2 fields')
})


it('keeps retained domain windows quiet while preserving the stale continuation guard', () => {
  const more = vi.fn()
  const coverage = { scope: 'people', complete: false, loaded: 1, revision: 1,
    nextCursor: simulationProductCursorSchema.parse('next') }
  const ui = render(<><WindowStatus window={{ status: 'ready', value: 1, stale: true }} t={t} />
    <CoverageNote value={coverage} stale more={more} t={t} /></>)
  expect(ui.queryByText(en['world.stale'])).toBeNull()
  expect(ui.getByRole('button', { name: en['world.coverage.more'] }).hasAttribute('disabled')).toBe(true)
  ui.rerender(<WindowStatus window={{ status: 'loading', previous: 1 }} t={t} />)
  expect(ui.container.innerHTML).toBe('')
  ui.rerender(<WindowStatus window={{ status: 'error', previous: 1, message: 'network' }} t={t} />)
  expect(ui.getByRole('alert')).toBeDefined()
})
