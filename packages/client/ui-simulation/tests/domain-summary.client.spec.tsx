// @vitest-environment jsdom
/** Business summaries come only from the domain projector; technical commits, unknowns and withheld values never read as success. */
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'
import { BusinessAction, DomainBusinessCard, ResultLayers, latestBusinessSummary, peopleNotApplicable } from '../src/client/DomainSummary.tsx'
import type { BusinessSummaryValue, SimulationProductWorldBusinessSummary } from '../src/client/DomainSummary.tsx'
import { DisclosedValue } from '../src/client/DisclosedValue.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'

afterEach(cleanup)
const translate = (locale: Record<Key, string>) => (key: Key, vars?: Record<string, unknown>) =>
  locale[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name]))
const known = (value: number) => ({ status: 'known' as const, value })
const value = (extra: Partial<BusinessSummaryValue> = {}): BusinessSummaryValue => ({ version: 1, label: 'Supplier delivers medicine order',
  submission: 'accepted', execution: 'accepted', businessOutcome: 'achieved',
  counts: { businessEntities: known(4), firms: known(2), alliances: { status: 'not-applicable' }, organizations: known(1), memberships: known(3),
    employmentRelationships: known(5), founderRepresentedEntities: { status: 'withheld' }, employedPeople: known(13), technicalRoles: known(14),
    independentSessions: known(9), openOrders: known(18), openLoans: { status: 'unknown' } },
  sources: [{ kind: 'result', sequence: 10241 }], nativeRevision: 10241, ...extra })

it('shows a recorded result that the judge rejected as judge rejected, never as success', () => {
  for (const locale of [en, zh]) {
    const t = translate(locale)
    const ui = render(<ResultLayers value={value({ execution: 'rejected', businessOutcome: 'not-achieved' })} t={t} />)
    const execution = ui.container.querySelector('[data-layer="execution"]')!
    expect(execution.textContent).toContain(locale['world.result.execution.rejected'])
    expect(execution.getAttribute('data-tone')).toBe('failed')
    expect(ui.container.querySelector('[data-tone="done"]')).toBeNull()
    expect(ui.container.textContent).toContain(locale['world.result.submission.accepted'])
    ui.unmount()
  }
})

it('never counts an unknown execution or outcome as success', () => {
  const ui = render(<ResultLayers value={value({ execution: 'unknown', businessOutcome: 'unknown' })} t={translate(en)} />)
  for (const layer of ['execution', 'outcome']) {
    expect(ui.container.querySelector(`[data-layer="${layer}"]`)?.getAttribute('data-tone')).toBe('needs-you')
  }
  expect(ui.container.querySelector('[data-tone="done"]')).toBeNull()
})

it('names the business action from the projector, or says why no summary is shown instead of "unknown domain"', () => {
  const t = translate(zh)
  const cases: [SimulationProductWorldBusinessSummary, string][] = [[{ status: 'allowed', value: value() }, 'Supplier delivers medicine order'],
    [{ status: 'unsupported' }, zh['world.cases.summary.unsupported']], [{ status: 'withheld' }, zh['world.cases.summary.withheld']],
    [{ status: 'unknown' }, zh['world.cases.summary.unknown']]]
  for (const [summary, text] of cases) {
    const ui = render(<BusinessAction summary={summary} operation="execute v3" t={t} />)
    expect(ui.container.textContent).toContain(text)
    expect(ui.container.textContent).toContain('execute v3')
    expect(ui.container.textContent).not.toContain('未知领域')
    ui.unmount()
  }
  expect(zh['world.cases.unknownDomain'].replace('{domain}', 'harbor')).toBe('自定义领域 harbor')
})

it('renders projector counts with their scope, keeps unknown, withheld and not applicable distinct from zero, and marks technical counts', () => {
  const t = translate(en)
  const ui = render(<DomainBusinessCard summaries={[{ status: 'unsupported' }, { status: 'allowed', value: value({ nativeRevision: 5 }) },
    { status: 'allowed', value: value() }]} loaded open={() => {}} t={t} />)
  const card = within(ui.getByRole('region', { name: en['world.business.title'] }))
  expect(card.getByText(t('world.business.scope', { revision: 10241 }))).toBeDefined()
  const count = (id: string) => ui.container.querySelector(`[data-count="${id}"] dd`)!
  expect(count('openOrders').textContent).toBe('18')
  expect(count('openLoans').textContent).toBe(en['disclosure.unknown'])
  expect(count('founderRepresentedEntities').textContent).toBe(en['disclosure.withheld'])
  expect(count('alliances').textContent).toBe(en['disclosure.not-applicable'])
  expect(ui.container.querySelector('[data-count="technicalRoles"]')?.hasAttribute('data-technical')).toBe(true)
  expect(card.getByText(en['world.business.definition'])).toBeDefined()
})

it('says "not provided" when no projector exists and keeps withheld summaries from leaking after revocation', () => {
  const t = translate(en)
  const ui = render(<DomainBusinessCard summaries={[{ status: 'unsupported' }]} loaded open={() => {}} t={t} />)
  expect(ui.getByText(en['world.cases.summary.unsupported'])).toBeDefined()
  expect(ui.container.textContent).not.toMatch(/\b0\b/)
  ui.rerender(<DomainBusinessCard summaries={[{ status: 'allowed', value: value() }]} loaded open={() => {}} t={t} />)
  expect(ui.container.textContent).toContain('18')
  ui.rerender(<DomainBusinessCard summaries={[{ status: 'withheld' }]} loaded open={() => {}} t={t} />)
  expect(ui.container.textContent).not.toContain('18')
  expect(ui.getByText(en['world.cases.summary.withheld'])).toBeDefined()
  ui.rerender(<DomainBusinessCard summaries={[]} loaded={false} open={() => {}} t={t} />)
  expect(ui.getByText(en['world.business.notLoaded'])).toBeDefined()
})

it('collapses the people card only when the projector declares employment not applicable', () => {
  expect(peopleNotApplicable(undefined)).toBe(false)
  expect(peopleNotApplicable(value())).toBe(false)
  const declared = value({ counts: { ...value().counts, employedPeople: { status: 'not-applicable' }, employmentRelationships: { status: 'not-applicable' } } })
  expect(peopleNotApplicable(declared)).toBe(true)
  expect(latestBusinessSummary([{ status: 'withheld' }, { status: 'allowed', value: declared }])).toBe(declared)
})

it('distinguishes every absent state in one component and replaces content on revocation', () => {
  const t = translate(en)
  const ui = render(<DisclosedValue state="allowed" t={t}><p>Private persona</p></DisclosedValue>)
  expect(ui.getByText('Private persona')).toBeDefined()
  for (const state of ['withheld', 'redacted', 'not-applicable', 'unknown', 'unsupported', 'read-failed'] as const) {
    ui.rerender(<DisclosedValue state={state} t={t}><p>Private persona</p></DisclosedValue>)
    expect(ui.queryByText('Private persona')).toBeNull()
    expect(ui.container.querySelector(`[data-disclosure="${state}"]`)?.textContent).toContain(en[`disclosure.${state}`])
  }
})

it('keeps the newest allowed summary regardless of order and explains an empty or unknown window', () => {
  expect(latestBusinessSummary([{ status: 'allowed', value: value({ nativeRevision: 9 }) },
    { status: 'allowed', value: value({ nativeRevision: 4 }) }])?.nativeRevision).toBe(9)
  const t = translate(en)
  const empty = render(<DomainBusinessCard summaries={[]} loaded open={() => {}} t={t} />)
  expect(empty.getByText(en['world.business.noCases'])).toBeDefined()
  empty.unmount()
  const unknown = render(<DomainBusinessCard summaries={[{ status: 'unknown' }]} loaded open={() => {}} t={t} />)
  expect(unknown.getByText(en['world.cases.summary.unknown'])).toBeDefined()
})
