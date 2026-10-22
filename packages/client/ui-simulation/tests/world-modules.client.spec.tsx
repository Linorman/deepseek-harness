// @vitest-environment jsdom
/** World modules observe Host facts only: historical views disable management, votes stay read-only, management previews first. */
import { useState } from 'react'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en } from '../src/client/locales.ts'
import { OrganizationModule } from '../src/client/WorldOrganization.tsx'
import type { OrganizationRoute } from '../src/client/WorldOrganization.tsx'
import { GovernanceModule } from '../src/client/WorldGovernance.tsx'
import type { GovernanceRoute } from '../src/client/WorldGovernance.tsx'
import { ExternalModule } from '../src/client/WorldExternal.tsx'
import { WorldOverview } from '../src/client/WorldOverview.tsx'
import { ActionFlow } from '../src/client/WorldActionFlow.tsx'
import type { ActionFlowProps } from '../src/client/WorldActionFlow.tsx'
import type { WorldWindow } from '../src/client/world-domain.ts'
import { external, governance, identity, norm, organization, overview, person, proposal, transferFields, transferPreview } from './world-fixtures.client.ts'

afterEach(cleanup)
const t = makeTranslate(en) as never
const ready = <T,>(value: T): WorldWindow<T> => ({ status: 'ready', value, stale: false })

it.each(['management-in-progress', 'extension-pending'])(
  'keeps denied %s management unavailable and offers its original obligations', (reason) => {
    const navigate = vi.fn(), openAction = vi.fn()
    const detail = { ...person, actions: [{ action: 'transfer' as const, allowed: false, reason }] }
    const ui = render(<OrganizationModule route={{ lens: 'people', objectId: person.personId, section: 'actions' }}
      window={ready(organization)} person={ready(detail)} connected navigate={navigate} reload={vi.fn()}
      openRef={vi.fn()} openAction={openAction} dispose={vi.fn()} t={t} />)
    expect(ui.getByText(reason === 'management-in-progress' ? en['world.action.reason.management-in-progress'] : reason)).toBeDefined()
    expect((ui.getByRole('button', { name: en['world.action.transfer'] }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(ui.getByRole('button', { name: en['world.action.viewObligations'] }))
    expect(navigate).toHaveBeenCalledWith({ section: 'obligations' }); expect(openAction).not.toHaveBeenCalled()
  })

function Organization({ initial, openAction = vi.fn() }: { initial: OrganizationRoute; openAction?: () => void }) {
  const [route, setRoute] = useState(initial)
  return <OrganizationModule route={route} window={ready(organization)} person={ready(person)} connected
    navigate={(next) => { setRoute({ ...route, ...next }) }} reload={vi.fn()} openRef={vi.fn()}
    openAction={openAction} dispose={vi.fn()} t={t} />
}

it('commits only valid viewing times and disables management while a past organization is shown', () => {
  const openAction = vi.fn()
  const ui = render(<Organization initial={{ lens: 'people', objectId: 'wang', section: 'actions' }} openAction={openAction} />)
  const time = ui.getByLabelText(en['world.org.at'], { selector: 'input' })
  fireEvent.change(time, { target: { value: '1.5' } })
  fireEvent.keyDown(time, { key: 'Enter' })
  expect(ui.getByRole('alert').textContent).toBe(en['world.org.at.invalid'])
  expect(ui.queryByText(/Viewing the organization/)).toBeNull()
  fireEvent.click(ui.getByRole('button', { name: en['world.action.transfer'] }))
  expect(openAction).toHaveBeenCalledWith(person, { action: 'transfer', allowed: true })
  expect((ui.getByRole('button', { name: en['world.action.depart'] }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(time, { target: { value: '1100' } })
  fireEvent.keyDown(time, { key: 'Enter' })
  expect(ui.getByText('Viewing the organization at 1,100, not the current state')).toBeDefined()
  expect((ui.getByRole('button', { name: en['world.action.transfer'] }) as HTMLButtonElement).disabled).toBe(true)
  expect(ui.getAllByText(en['world.org.historicalDisabled']).length).toBeGreaterThan(0)
  fireEvent.click(ui.getByRole('button', { name: en['world.org.backToLatest'] }))
  expect((ui.getByRole('button', { name: en['world.action.transfer'] }) as HTMLButtonElement).disabled).toBe(false)
})

it('shows structure occupancy with an explicit unloaded placeholder and filters people from attention links', () => {
  const ui = render(<Organization initial={{ lens: 'structure' }} />)
  expect(ui.getByText('+7 not loaded')).toBeDefined()
  expect(ui.getByText(en['world.occupancy.full'])).toBeDefined()
  cleanup()
  const people = render(<Organization initial={{ lens: 'people', filter: 'handoff-required' }} />)
  const rows = people.getByRole('table').querySelectorAll('tbody tr')
  expect(rows).toHaveLength(1)
  expect(rows[0]?.textContent).toContain('王强')
})

it('never offers voting or enactment and keeps passing separate from enactment', () => {
  function Harness() {
    const [route, setRoute] = useState<GovernanceRoute>({ lens: 'proposals', objectId: 'p-hire' })
    return <GovernanceModule route={route} window={ready(governance)} proposal={ready(proposal)} norm={ready(norm)} connected
      navigate={(next) => { setRoute({ ...route, ...next }) }} reload={vi.fn()} openRef={vi.fn()} t={t} />
  }
  const ui = render(<Harness />)
  const inspector = ui.getByRole('complementary')
  expect(within(inspector).getByText(en['world.gov.passNotEnact'])).toBeDefined()
  expect(within(inspector).getByText(en['world.gov.enactment.awaiting-request'])).toBeDefined()
  expect(inspector.querySelector('[data-disclosure="withheld"]')?.textContent).toContain(en['disclosure.withheld'])
  expect(ui.queryByRole('button', { name: /vote|enact/i })).toBeNull()
  fireEvent.click(ui.getByRole('radio', { name: en['world.gov.lens.history'] }))
  fireEvent.click(ui.getByRole('button', { name: 'Select 招聘审批 v2' }))
  fireEvent.click(ui.getByRole('button', { name: 'Select 季度预算上限 v1' }))
  expect((ui.getByRole('button', { name: en['world.gov.compare'] }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(ui.getByRole('button', { name: 'Select 招聘审批 v3' }))
  fireEvent.click(ui.getByRole('button', { name: 'Select 招聘审批 v2' }))
  fireEvent.click(ui.getByRole('button', { name: en['world.gov.compare'] }))
  expect(ui.getByText('招聘需委员会 4 票批准。', { exact: false })).toBeDefined()
})

it('states the simulated external world permanently and shows unknown facts as unknown, never zero', () => {
  const ui = render(<ExternalModule route={{ objectId: 'biosupply', section: 'facts' }} window={ready(external)} identity={ready(identity)}
    connected navigate={vi.fn()} reload={vi.fn()} openRef={vi.fn()} t={t} />)
  expect(ui.getByRole('note').textContent).toContain(en['world.ext.notice'])
  expect(ui.container.querySelector('[data-fact="unknown"]')?.closest('dd')?.textContent).not.toContain('0')
  expect(ui.getAllByText(en['world.unknown']).length).toBeGreaterThan(0)
  expect(ui.getByText(en['world.ext.report'])).toBeDefined()
  expect(ui.queryByRole('button', { name: /dismiss/i })).toBeNull()
})

it('opens the exact enacted norm version when several versions share the same Native norm identity', () => {
  const navigate = vi.fn()
  const ui = render(<GovernanceModule route={{ lens: 'proposals', objectId: proposal.id }} window={ready(governance)}
    proposal={ready({ ...proposal, enactment: { state: 'enacted', normVersion: { id: norm.normId, version: '3' } } })}
    norm={ready(norm)} connected navigate={navigate} reload={vi.fn()} openRef={vi.fn()} t={t} />)
  fireEvent.click(within(ui.getByRole('complementary')).getByRole('button', { name: /Enacted/ }))
  expect(navigate).toHaveBeenCalledWith({ lens: 'norms', objectId: JSON.stringify([norm.normId, '3']) })
})

it('renders the selected representation page and does not substitute a latest summary for an empty page', () => {
  const ui = render(<ExternalModule route={{ objectId: identity.key, section: 'representative' }} window={ready(external)}
    identity={ready({ ...identity, representatives: [] })} connected navigate={vi.fn()} reload={vi.fn()} openRef={vi.fn()} t={t} />)
  expect(ui.getByText(en['world.ext.noRepresentative'])).toBeDefined()
  expect(ui.queryByText(identity.representative!.person.text)).toBeNull()
  const selected = { ...identity.representative!, entity: identity.entity, participantId: identity.representative!.participantId!,
    sessionId: person.sessionId!, person: { text: 'Selected original representative', truncated: false } }
  ui.rerender(<ExternalModule route={{ objectId: identity.key, section: 'representative' }} window={ready(external)}
    identity={ready({ ...identity, representatives: [selected] })} connected navigate={vi.fn()} reload={vi.fn()} openRef={vi.fn()} t={t} />)
  expect(ui.getByText(selected.person.text)).toBeDefined()
  expect(ui.queryByText(identity.representative!.person.text)).toBeNull()
})

it('keeps a mediated ruling and its subsequent actor contact visible when they share one original intent', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const original = identity.interactions[0]!
    const ui = render(<ExternalModule route={{ objectId: identity.key, section: 'interactions' }} window={ready(external)}
      identity={ready({ ...identity, interactions: [
        { ...original, kind: 'director-ruling', outcome: { text: 'Original mediated ruling', truncated: false } },
        { ...original, kind: 'simulated-actor', outcome: { text: 'Actual original actor contact', truncated: false } },
      ] })} connected navigate={vi.fn()} reload={vi.fn()} openRef={vi.fn()} t={t} />)
    expect(ui.getByText('Original mediated ruling')).toBeDefined()
    expect(ui.getByText('Actual original actor contact')).toBeDefined()
    expect(errors).not.toHaveBeenCalled()
  } finally { errors.mockRestore() }
})

it('hides zero attention, keeps unpublished counts unavailable and links flow segments to filtered matters', () => {
  const links = { attention: vi.fn(), module: vi.fn(), caseStatus: vi.fn(), proposal: vi.fn(), records: vi.fn() }
  const props = { runId: 'run-1', people: { loading: false, stale: false }, refreshPeople: vi.fn(),
    engine: [], budget: null, links, reload: vi.fn(), exportDefinition: vi.fn(), exporting: false, connected: true, t }
  const ui = render(<WorldOverview window={ready(overview)} {...props} />)
  expect(ui.queryByText('0 implementations missing')).toBeNull()
  fireEvent.click(ui.getByRole('button', { name: /1 handoffs unresolved/ }))
  expect(links.attention).toHaveBeenCalledWith('handoffRequired')
  fireEvent.click(ui.getByRole('button', { name: /Result recorded 14/ }))
  expect(links.caseStatus).toHaveBeenCalledWith('committed')
  ui.rerender(<WorldOverview window={{ status: 'unpublished' }} {...props} />)
  expect(ui.getByText(en['world.unpublished'])).toBeDefined()
  expect(ui.container.querySelectorAll('[data-fact="unavailable"]').length).toBeGreaterThan(5)
  expect(ui.queryByText('12')).toBeNull()
})

it('shows independent actual run counts while other World reads remain unpublished and never invents Team history', () => {
  const counts = { scope: 'run' as const, snapshotRevision: 5, time: '2' as never, employed: 1, nonTerminalPersons: 3,
    resident: 0, residentLimit: 2, unreleasedWriters: 1,
    history: { status: 'observed' as const, teamCursor: 19, participants: 7, activations: 17 } }
  const refreshPeople = vi.fn()
  const props = { runId: 'run-1', refreshPeople, engine: [], budget: null, reload: vi.fn(), exportDefinition: vi.fn(), exporting: false,
    connected: true, links: { attention: vi.fn(), module: vi.fn(), caseStatus: vi.fn(), proposal: vi.fn(), records: vi.fn() }, t }
  const ui = render(<WorldOverview window={{ status: 'unpublished' }} people={{ loading: false, stale: false, value: counts }} {...props} />)
  const people = within(ui.getByRole('region', { name: en['world.overview.people'] }))
  // Technical bindings live under Run management, apart from the social people figures.
  const technical = within(ui.container.querySelector<HTMLElement>('[data-people-technical]')!)
  const figure = (key: 'employed' | 'nonTerminal' | 'resident' | 'writers' | 'history' | 'activations') =>
    (key === 'employed' || key === 'nonTerminal' ? people : technical)
      .getByText(en[`world.overview.people.${key}`]).closest('div')?.querySelector('dd')?.textContent
  expect(people.queryByText(en['world.overview.people.writers'])).toBeNull()
  expect(people.getByText(en['world.overview.people.technicalMoved'])).toBeDefined()
  // Residency reads as seats: zero filled of a limit of two, never a bare ratio string.
  expect(technical.getByRole('img', { name: '0 of 2 resident seats in use' })).toBeDefined()
  expect(technical.getByRole('img', { name: '0 of 2 resident seats in use' }).querySelectorAll('[data-seat="free"]')).toHaveLength(2)
  expect(figure('writers')).toBe('1')
  expect(figure('history')).toBe('7')
  expect(figure('activations')).toBe('17')
  fireEvent.click(people.getByRole('button', { name: en['world.refresh'] }))
  expect(refreshPeople).toHaveBeenCalledOnce()
  ui.rerender(<WorldOverview window={{ status: 'unpublished' }} people={{ loading: false, stale: true,
    value: { ...counts, history: { status: 'unavailable', reason: 'source-moved' } } }} {...props} />)
  expect(figure('history')).not.toContain('0')
  expect(figure('activations')).not.toContain('0')
  expect(technical.getByText(en['world.overview.people.historyUnavailable'])).toBeDefined()
  expect(people.queryByText(en['world.stale'])).toBeNull()
  expect(people.queryByText(en.stale)).toBeNull()
  ui.rerender(<WorldOverview window={{ status: 'unpublished' }} people={{ loading: false, stale: false, error: 'forbidden' }} {...props} />)
  expect(figure('employed')).not.toContain('1')
  expect(figure('history')).not.toContain('7')
  expect(people.getByRole('alert').textContent).toBe(en.forbidden)
})

function Flow(overrides: Partial<ActionFlowProps>) {
  const [values, setValues] = useState<Readonly<Record<string, string>>>({})
  const [preview, setPreview] = useState<ActionFlowProps['preview']>({ status: 'idle' })
  return <ActionFlow action="transfer" target="王强 · 研究员" expectedRevision={7} fields={ready(transferFields)} preview={preview}
    values={values} connected change={setValues} requestPreview={() => { setPreview(ready({ ...transferPreview, blockers: [] })) }}
    openRef={vi.fn()} close={vi.fn()} t={t} {...overrides} />
}

it('validates Host-declared fields, previews before submitting once, and invalidates a preview after edits', () => {
  const submit = vi.fn()
  const ui = render(<Flow submit={submit} />)
  fireEvent.click(ui.getByRole('button', { name: en['world.action.next'] }))
  expect(ui.getAllByText(en['world.action.required'])).toHaveLength(2)
  fireEvent.click(ui.getByRole('radio', { name: '首席科学家' }))
  fireEvent.click(ui.getByRole('radio', { name: en['world.action.effective.at'] }))
  expect(ui.getByText(en['world.action.effective.notice'])).toBeDefined()
  fireEvent.click(ui.getByRole('button', { name: en['world.action.next'] }))
  expect(ui.getByText(en['world.action.required'])).toBeDefined()
  fireEvent.change(ui.getByLabelText(en['world.action.field.at']), { target: { value: '5' } })
  fireEvent.click(ui.getByRole('button', { name: en['world.action.next'] }))
  const confirm = ui.getByRole('button', { name: en['world.action.confirm'] }) as HTMLButtonElement
  expect(confirm.disabled).toBe(false)
  fireEvent.click(ui.getByRole('button', { name: en['world.action.back'] }))
  fireEvent.click(ui.getByRole('radio', { name: en['world.action.effective.boundary'] }))
  fireEvent.click(ui.getByRole('button', { name: en['world.action.next'] }))
  fireEvent.click(ui.getByRole('button', { name: en['world.action.confirm'] }))
  fireEvent.click(ui.getByRole('button', { name: en['world.action.confirm'] }))
  expect(submit).toHaveBeenCalledOnce()
})

it('blocks submission on Host blockers, revision changes and while the Host accepts no such command', () => {
  const blocked = render(<Flow submit={vi.fn()} requestPreview={vi.fn()} preview={ready(transferPreview)} />)
  fireEvent.click(blocked.getByRole('radio', { name: '首席科学家' }))
  fireEvent.click(blocked.getByRole('radio', { name: en['world.action.effective.boundary'] }))
  fireEvent.click(blocked.getByRole('button', { name: en['world.action.next'] }))
  expect(blocked.getByText('2 项义务需先处理')).toBeDefined()
  expect((blocked.getByRole('button', { name: en['world.action.confirm'] }) as HTMLButtonElement).disabled).toBe(true)
  cleanup()
  const changed = render(<Flow submit={vi.fn()} requestPreview={vi.fn()}
    preview={ready({ ...transferPreview, blockers: [], revision: 8 })} />)
  fireEvent.click(changed.getByRole('radio', { name: '首席科学家' }))
  fireEvent.click(changed.getByRole('radio', { name: en['world.action.effective.boundary'] }))
  fireEvent.click(changed.getByRole('button', { name: en['world.action.next'] }))
  expect(changed.getByText('Target changed (r7 → r8)')).toBeDefined()
  expect((changed.getByRole('button', { name: en['world.action.confirm'] }) as HTMLButtonElement).disabled).toBe(true)
  cleanup()
  const unpublished = render(<Flow />)
  fireEvent.click(unpublished.getByRole('radio', { name: '首席科学家' }))
  fireEvent.click(unpublished.getByRole('radio', { name: en['world.action.effective.boundary'] }))
  fireEvent.click(unpublished.getByRole('button', { name: en['world.action.next'] }))
  expect(unpublished.getByText(en['world.action.submitUnpublished'])).toBeDefined()
  expect((unpublished.getByRole('button', { name: en['world.action.confirm'] }) as HTMLButtonElement).disabled).toBe(true)
})

it('requires a distinct confirmation click and keeps the original visible through the second submit click', () => {
  const close = vi.fn(), submit = vi.fn()
  function Confirmed() {
    const [retained, setRetained] = useState(false)
    return <Flow close={close} original={retained ? <p>Retained exact command</p> : undefined}
      submit={() => { submit(); setRetained(true) }} />
  }
  const ui = render(<Confirmed />)
  fireEvent.click(ui.getByRole('radio', { name: '首席科学家' }))
  fireEvent.click(ui.getByRole('radio', { name: en['world.action.effective.boundary'] }))
  fireEvent.click(ui.getByRole('button', { name: en['world.action.next'] }), { detail: 1 })
  const confirm = ui.getByRole('button', { name: en['world.action.confirm'] })
  fireEvent.click(confirm, { detail: 2 })
  expect(submit).not.toHaveBeenCalled()
  fireEvent.click(confirm, { detail: 1 })
  expect(submit).toHaveBeenCalledOnce(); expect(ui.getByText('Retained exact command')).toBeTruthy()
  const dismiss = ui.getAllByRole('button', { name: en['world.close'] }).at(-1)!
  fireEvent.click(dismiss, { detail: 2 })
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(dismiss, { detail: 0 })
  expect(close).toHaveBeenCalledOnce()
})

it('gives each table one keyboard tab stop that follows the selection', () => {
  const ui = render(<Organization initial={{ lens: 'people' }} />)
  const stops = () => Array.from(ui.container.querySelectorAll('tbody tr')).filter(row => row.getAttribute('tabindex') === '0')
    .map(row => row.getAttribute('data-row'))
  expect(stops()).toEqual(['li'])
  const first = ui.container.querySelector('tr[data-row="li"]') as HTMLElement
  first.focus()
  fireEvent.keyDown(first, { key: 'ArrowDown' })
  expect(document.activeElement?.getAttribute('data-row')).toBe('wang')
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' })
  expect(stops()).toEqual(['wang'])
})

it('lists units before unplaced positions at each tree level so the hierarchy reads top-down', () => {
  // Positions without a placement arrive first, as a Host page sorted by identity may return them.
  const positions = organization.nodes.filter(node => node.kind === 'position' && node.id !== 'researcher')
    .map(({ parentId: _parent, ...node }) => node)
  const unplaced = { ...organization, nodes: [...positions, ...organization.nodes.filter(node => node.kind === 'unit')] }
  const ui = render(<OrganizationModule route={{ lens: 'structure' }} window={ready(unplaced)} person={ready(person)} connected
    navigate={vi.fn()} reload={vi.fn()} openRef={vi.fn()} openAction={vi.fn()} dispose={vi.fn()} t={t} />)
  const rows = [...ui.getByRole('treegrid').querySelectorAll('[data-row]')].map(row => [row.getAttribute('data-row'), row.getAttribute('aria-level')])
  expect(rows).toEqual([['lab', '1'], ['rd', '2'], ['ops', '2'], ['chief', '1'], ['buyer', '1']])
})

it('raises a failed scheduler as an attention item that opens its recovery', () => {
  const open = vi.fn()
  const props = { runId: 'run-1', people: { loading: false, stale: false }, refreshPeople: vi.fn(), budget: null, reload: vi.fn(),
    exportDefinition: vi.fn(), exporting: false, connected: true,
    links: { attention: vi.fn(), module: vi.fn(), caseStatus: vi.fn(), proposal: vi.fn(), records: vi.fn() }, t }
  const ui = render(<WorldOverview window={{ status: 'unpublished' }} engine={[{ id: 'scheduler', count: 0, open }]} {...props} />)
  expect(ui.queryByRole('button', { name: en['needsYou.scheduler'] })).toBeNull()
  ui.rerender(<WorldOverview window={{ status: 'unpublished' }} engine={[{ id: 'scheduler', count: 1, open }]} {...props} />)
  fireEvent.click(ui.getByRole('button', { name: en['needsYou.scheduler'] }))
  expect(open).toHaveBeenCalledOnce()
})

it('keeps a running structure drag as a blocked preview without issuing a personnel command', () => {
  const openAction = vi.fn(), before = structuredClone(organization)
  const ui = render(<OrganizationModule route={{ lens: 'structure', objectId: 'lab' }} window={ready(organization)}
    person={{ status: 'idle' }} connected navigate={vi.fn()} reload={vi.fn()} openRef={vi.fn()} openAction={openAction} dispose={vi.fn()} t={t} />)
  const frame = ui.getByRole('group', { name: /新药研发实验室/ })
  const from = within(frame).getByRole('button', { name: /^研发部/ }), to = within(frame).getByRole('button', { name: /^运营部/ })
  const point = (element: HTMLElement) => ({ clientX: Number.parseFloat(element.style.left),
    clientY: Number.parseFloat(element.style.top), button: 0 })
  fireEvent.pointerDown(frame, point(from)); fireEvent.pointerMove(frame, point(to)); fireEvent.pointerUp(frame, point(to))
  expect(ui.getByText(en['world.org.structurePreviewBlocked'])).toBeDefined()
  expect(openAction).not.toHaveBeenCalled(); expect(organization).toEqual(before)
})
