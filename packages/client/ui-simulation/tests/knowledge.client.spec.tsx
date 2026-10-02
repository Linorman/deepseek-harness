// @vitest-environment jsdom
/** Knowledge text is literal, attributed and never conflated with world truth or raw-source permission. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { KnowledgeDetails } from '../src/client/KnowledgeDetails.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { SimulationProductKnowledgeDetail } from '@clocky/clocky-client-runtime/client'
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
