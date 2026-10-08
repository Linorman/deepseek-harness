// @vitest-environment jsdom
/** Knowledge text is literal, attributed and never conflated with world truth or raw-source permission. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { KnowledgeDetails } from '../src/client/KnowledgeDetails.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { SimulationProductKnowledgeDetail, SimulationProductKnowledgeItem } from '@clocky/clocky-client-runtime/client'
afterEach(cleanup)
it.each([en, zh])('distinguishes exact unavailable selection from disclosure refusal and empty authorized knowledge', (locale) => {
  const value: SimulationProductKnowledgeDetail = { collection: 'decisions', id: 'decision' as never, section: 'knowledge',
    readVersion: 'version' as never, bodyAccess: 'allowed', entityId: 'actor' as never, time: '9007199254740993' as never,
    cutoffRevision: 3, selected: { id: 'knowledge' as never, revision: 1 }, knowledge: { items: [], total: 0 } }
  const props = { value, view: { module: 'decisions' as const, search: '' }, navigate: vi.fn(), readPage: vi.fn(), blocked: false,
    canContinue: true, t: (key: keyof typeof en) => locale[key] }
  const view = render(<KnowledgeDetails {...props} />)
  expect(view.getByText(locale.knowledgeNotice)).toBeDefined()
  expect(view.getByText(locale.knowledgeUnavailable)).toBeDefined()
  view.rerender(<KnowledgeDetails {...props} value={{ ...value, bodyAccess: 'withheld' }} />)
  expect(view.getByText(locale.knowledgeWithheld)).toBeDefined()
  expect(view.queryByText(locale.knowledgeUnavailable)).toBeNull()
})

it('keeps literal knowledge, report source access and temporal provenance independently visible', () => {
  const base: SimulationProductKnowledgeItem = { reference: { id: 'knowledge' as never, revision: 1 }, owner: 'actor' as never,
    observedAt: '1' as never, availableAt: '2' as never, validFrom: '3' as never, validUntil: null, sequence: 1,
    body: { status: 'text', text: '<b>Literal knowledge</b>', part: 0, parts: 1 },
    source: { kind: 'observation', worldRevision: 4, visibilityPolicy: { text: 'Current audience', truncated: false } }, premises: [] }
  const items: SimulationProductKnowledgeItem[] = [base,
    { ...base, source: { kind: 'report', operationId: 'report' as never, body: { status: 'text', text: 'Literal source', part: 0, parts: 1 } },
      validUntil: '9' as never, premises: [{ id: 'premise' as never, revision: 2 }] },
    { ...base, body: { status: 'withheld' }, source: { kind: 'report', operationId: 'private-report' as never, body: { status: 'withheld' } } },
    { ...base, source: { kind: 'report', operationId: 'unsupported-report' as never, body: { status: 'unsupported' } } },
    { ...base, source: { kind: 'inference', decisionId: 'decision' as never } },
    { ...base, source: { kind: 'summary', cursor: 12, policy: { text: 'Summary policy', truncated: false },
      policyVersion: { text: 'Version 1', truncated: false } } },
    { ...base, source: { kind: 'belief', profileRevision: 13, policyVersion: { text: 'Belief version', truncated: false } } },
  ]
  const value: SimulationProductKnowledgeDetail = { collection: 'entities', id: 'actor' as never, section: 'knowledge',
    readVersion: 'version' as never, bodyAccess: 'allowed', entityId: 'actor' as never, time: '9' as never,
    cutoffRevision: 4, knowledge: { items, total: items.length, nextCursor: 'next' as never } }
  const navigate = vi.fn(), readPage = vi.fn()
  const ui = render(<KnowledgeDetails value={value} view={{ runId: 'run', module: 'entities', search: 'Saved' }}
    navigate={navigate} readPage={readPage} blocked={false} canContinue t={key => en[key]} />)
  expect(ui.getAllByText('<b>Literal knowledge</b>').length).toBeGreaterThan(0)
  expect(ui.getByText('Literal source')).toBeDefined()
  expect(ui.getByText(en.knowledgeSourceWithheld)).toBeDefined()
  expect(ui.getByText(en.contextBodyUnsupported)).toBeDefined()
  expect(ui.getByText('premise')).toBeDefined()
  fireEvent.click(ui.getAllByRole('button', { name: en.knowledgeReportOperation })[0]!)
  expect(navigate).toHaveBeenLastCalledWith({ runId: 'run', module: 'operations', search: 'Saved', objectId: 'report' })
  fireEvent.click(ui.getByRole('button', { name: en.knowledgeInferenceDecision }))
  expect(navigate).toHaveBeenLastCalledWith({ runId: 'run', module: 'decisions', search: 'Saved', objectId: 'decision' })
  fireEvent.click(ui.getByRole('button', { name: en.next }))
  expect(readPage).toHaveBeenLastCalledWith('next')
})
