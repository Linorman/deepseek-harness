// @vitest-environment jsdom
/** Sub-page presentation: labelled, toned engine rows; a named group for unplaced people; one shared scale for norm history. */
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { CollectionTable } from '../src/client/CollectionTable.tsx'
import { en } from '../src/client/locales.ts'
import { OrganizationModule } from '../src/client/WorldOrganization.tsx'
import { GovernanceModule } from '../src/client/WorldGovernance.tsx'
import type { WorldWindow } from '../src/client/world-domain.ts'
import { governance, norm, organization, proposal } from './world-fixtures.client.ts'

afterEach(cleanup)
const t = makeTranslate(en) as never
const ready = <T,>(value: T): WorldWindow<T> => ({ status: 'ready', value, stale: false })
const base = { runId: 'run' as never, snapshotRevision: 2, observedAt: 1, total: 1 }

it('labels every engine cell with its column and tones known states while keeping their words', () => {
  const ui = render(<CollectionTable page={{ ...base, collection: 'entities', items: [{ id: 'buyer' as never, name: { text: 'Buyer', truncated: false },
    kind: { text: 'person', truncated: false }, cognition: 'agent', phase: 'terminated', writer: 'released' }] }}
  open={vi.fn()} t={key => en[key]} date={String} />)
  const cells = [...ui.container.querySelectorAll('tbody td')]
  expect(cells.map(cell => cell.getAttribute('data-label'))).toEqual([en.entityName, en.kind, en.cognition, en.status])
  const status = ui.getByText(en.terminated)
  expect(status.dataset.tone).toBe('failed')
  expect(ui.getByText(en.agent).dataset.tone).toBe('agent')
  // An extension state without a known role keeps its text with a neutral marker.
  ui.rerender(<CollectionTable page={{ ...base, collection: 'decisions', items: [{ id: 'd' as never, entityId: 'e' as never, time: '1' as never,
    slot: '0' as never, snapshotRevision: 1, status: 'future-state' as never, operationCount: 0 }] }} open={vi.fn()} t={key => (en as Record<string, string>)[key] ?? key} date={String} />)
  expect(ui.getByText('future-state').dataset.tone).toBeUndefined()
})

it('names the timeline group of people without a unit instead of drawing a dash', () => {
  const unplaced = { ...organization, people: organization.people.map(person => ({ ...person, unitId: undefined })) }
  const ui = render(<OrganizationModule route={{ lens: 'timeline' }} window={ready(unplaced)} person={{ status: 'idle' }} connected
    navigate={vi.fn()} reload={vi.fn()} openRef={vi.fn()} openAction={vi.fn()} dispose={vi.fn()} t={t} />)
  expect(ui.getByRole('button', { name: new RegExp(en['world.org.noUnit']) })).toBeDefined()
  expect(ui.queryByRole('button', { name: /^▾ — / })).toBeNull()
})

it('shows the root unit neighbourhood before any structure row is selected', () => {
  const ui = render(<OrganizationModule route={{ lens: 'structure' }} window={ready(organization)} person={{ status: 'idle' }} connected
    navigate={vi.fn()} reload={vi.fn()} openRef={vi.fn()} openAction={vi.fn()} dispose={vi.fn()} t={t} />)
  expect(ui.queryByText(en['world.org.graph.select'])).toBeNull()
})

it('puts every norm version on one scale with the viewing time marked', () => {
  const ui = render(<GovernanceModule route={{ lens: 'history' }} window={ready(governance)} proposal={ready(proposal)} norm={ready(norm)}
    connected navigate={vi.fn()} reload={vi.fn()} openRef={vi.fn()} t={t} />)
  expect(ui.getByText(`${en['world.org.now']} 1,240`)).toBeDefined()
  const version = ui.getAllByRole('button', { name: /^Select / })[0]!
  expect(within(version).getByText(/^\[/)).toBeDefined()
  fireEvent.click(version)
  expect(version.getAttribute('aria-pressed')).toBe('true')
})
