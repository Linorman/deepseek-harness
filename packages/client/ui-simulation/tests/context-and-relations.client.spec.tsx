// @vitest-environment jsdom
/** Plain recorded text and metadata references retain separate read permissions in both locales. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ContextAndRelations } from '../src/client/ContextAndRelations.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import type { SimulationProductObjectDetail } from '@clocky/clocky-client-runtime/client'
afterEach(cleanup)

it.each([en, zh])('renders only authorized recorded text without executing embedded markup or claiming a complete request', (locale) => {
  const value: Extract<SimulationProductObjectDetail, { section: 'context' }> = { collection: 'decisions', section: 'context', id: 'decision' as never, readVersion: 'v1' as never,
    accounting: { status: 'prepared', retainedBytes: 100, maxBytes: 200, knowledgeCount: 0, sourceCount: 0, sectionCount: 1, content: 'withheld' },
    bodyAccess: 'allowed', frozen: { entityId: 'entity' as never, time: '9007199254740993' as never, slot: '10' as never, epoch: '1' as never,
      projections: { run: 3, entity: 2, team: 1 }, versions: Object.fromEntries(['rules', 'policy', 'persona', 'model']
        .map(key => [key, { text: '1', truncated: false }])) as never },
    items: { total: 2, nextCursor: 'next' as never, items: [{ kind: 'section', index: 0, block: 0, section: { text: 'input', truncated: false },
      required: true, body: { status: 'text', text: '<script>private_input()</script>', part: 0, parts: 2 } }] } }
  const readPage = vi.fn(), navigate = vi.fn()
  const props = { value, view: { runId: 'run', module: 'decisions' as const, search: '', section: 'context' as const }, navigate,
    readPage, blocked: false, canContinue: true, t: (key: Key) => locale[key] }
  const view = render(<ContextAndRelations {...props} />)
  expect(view.getByText(locale.contextPartial)).toBeDefined()
  expect(view.getByText('<script>private_input()</script>')).toBeDefined()
  expect(view.container.querySelector('script')).toBeNull()
  expect(view.getByText('9007199254740993')).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: locale.next }))
  expect(readPage).toHaveBeenLastCalledWith('next')
  view.rerender(<ContextAndRelations {...props} value={{ ...value, bodyAccess: 'withheld', items: { total: 1,
    items: [{ kind: 'section', index: 0, block: 0, section: { text: 'input', truncated: false }, required: true, body: { status: 'withheld' } }] } }} />)
  expect(view.queryByText('<script>private_input()</script>')).toBeNull()
  expect(view.getAllByText(locale.contextBodyWithheld).length).toBeGreaterThan(0)
})

it('keeps relation endpoints, scope and exact historical ticks available without mutating the world', () => {
  const navigate = vi.fn()
  const value: Extract<SimulationProductObjectDetail, { section: 'relationships' }> = { collection: 'entities', section: 'relationships',
    id: 'entity' as never, time: '9007199254740993' as never, relationships: { total: 1, items: [{ id: 'relation' as never,
      subject: 'entity' as never, object: 'org' as never, relation: { text: 'member-of', truncated: false }, scope: 'scope' as never,
      validFrom: '9007199254740992' as never, validUntil: '9007199254740993' as never, revision: 1, active: false }] } }
  const view = render(<ContextAndRelations value={value} view={{ runId: 'run', module: 'entities', search: '' }} navigate={navigate}
    readPage={vi.fn()} blocked={false} canContinue t={key => en[key]} />)
  expect(view.getByText('9007199254740992')).toBeDefined()
  expect(view.getByText(en.no)).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: 'scope' }))
  expect(navigate).toHaveBeenCalledWith({ runId: 'run', module: 'entities', search: '', objectId: 'scope' })
})
