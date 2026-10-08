// @vitest-environment jsdom
/** Simulation visuals encode exactly the stage each summary asserts and nothing beyond it. */
import { afterEach, beforeAll, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { en } from '../src/client/locales.ts'
import { CheckpointRail, DriverRing, EffectsView, operationStage, residency, TimelineView, WorldView } from '../src/client/Visuals.tsx'

const t = makeTranslate(en) as never
beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as never })
afterEach(cleanup)

const op = (status: string, publication = 'not-applicable', delivery = 'not-applicable') => ({ id: `${status}-${publication}-${delivery}`,
  entityId: 'e', decisionId: 'd', index: 0, kind: { text: 'transfer', truncated: false }, status, publication, delivery, task: 'not-applicable' }) as never

it('places an operation at its furthest confirmed stage and never past a receipt', () => {
  expect(operationStage(op('pending'))).toBe('pending')
  expect(operationStage(op('rejected'))).toBe('settled')
  expect(operationStage(op('applied', 'pending', 'pending'))).toBe('settled')
  expect(operationStage(op('applied', 'published', 'pending'))).toBe('published')
  expect(operationStage(op('applied', 'published', 'input-persisted'))).toBe('persisted')
  expect(operationStage(op('applied', 'published', 'receipted'))).toBe('receipted')
  expect(operationStage(op('blocked-dependency'))).toBe('blocked')
  expect(operationStage(op('outcome-unknown', 'pending', 'pending'))).toBe('unknown')
})

it('keeps the receipt footnote visible and draws unknown outcomes as the needs-you hatch', () => {
  const page = { collection: 'operations', runId: 'r', total: 9, snapshotRevision: 1,
    items: [op('outcome-unknown'), op('applied', 'published', 'receipted')] } as never
  render(<EffectsView page={page} open={() => {}} t={t} />)
  expect(screen.getByRole('note').textContent).toBe(en['visual.effects.footnote'])
  expect(screen.getByText('Loaded 2/9')).toBeTruthy()
  const unknown = screen.getByRole('region', { name: `${en['visual.effects.unknown']} 1` })
  expect(unknown.querySelector('[data-state]')?.getAttribute('data-state')).toBe('needs-you')
})

it('derives residency from the writer state only', () => {
  expect(['active', 'reserved', 'revoked', 'none', 'released'].map(writer => residency(writer as never).state))
    .toEqual(['running', 'waiting', 'waiting', 'idle', 'idle'])
})

it('draws loaded entities with agent glow and states loaded versus total', () => {
  const page = { collection: 'entities', runId: 'r', total: 40, snapshotRevision: 1, items: [
    { id: 'a', name: { text: 'Buyer', truncated: false }, kind: { text: 'person', truncated: false }, phase: 'active', cognition: 'agent', writer: 'active' },
    { id: 'b', kind: { text: 'ledger', truncated: false }, phase: 'active', cognition: 'none', writer: 'released' },
  ] } as never
  const view = render(<WorldView page={page} runId="r" open={() => {}} t={t} />)
  expect(view.container.querySelector('[data-node-id="a"]')?.getAttribute('data-glow')).toBe('true')
  expect(view.container.querySelector('[data-node-id="b"]')?.getAttribute('data-glow')).toBeNull()
  expect(screen.getAllByText('Loaded 2/40').length).toBeGreaterThan(0)
})

it('marks decisions by status and places a now cursor beyond 2^53 exactly', () => {
  const page = { collection: 'decisions', runId: 'r', total: 2, snapshotRevision: 1, items: [
    { id: 'x', entityId: 'e', slot: '0', time: '9007199254740993', snapshotRevision: 1, status: 'cancelled', operationCount: 0 },
    { id: 'y', entityId: 'e', slot: '0', time: '9007199254741993', snapshotRevision: 1, status: 'accepted', operationCount: 1 },
  ] } as never
  const view = render(<TimelineView page={page} now="9007199254741993" open={() => {}} t={t} />)
  expect([...view.container.querySelectorAll('[data-marker]')].map(mark => mark.getAttribute('data-marker'))).toEqual(['cross', 'filled'])
  expect(screen.getByRole('button', { name: /9007199254740993/ })).toBeTruthy()
})

it('highlights only the latest successful checkpoint', () => {
  const page = { collection: 'checkpoints', runId: 'r', total: 2, snapshotRevision: 1, items: [
    { id: 'old', status: 'completed', startedSequence: 1, publishedAt: 1, latestSuccessful: false, sourceValidation: 'not-performed' },
    { id: 'new', status: 'completed', startedSequence: 2, publishedAt: 2, latestSuccessful: true, sourceValidation: 'not-performed' },
  ] } as never
  const view = render(<CheckpointRail page={page} open={() => {}} date={String} t={t} />)
  expect([...view.container.querySelectorAll('[data-latest]')].map(stop => stop.getAttribute('aria-label'))).toEqual([expect.stringContaining('new')])
})

it('turns the driver ring only for an observed active driver', () => {
  const view = render(<><DriverRing active label="advancing" /><DriverRing active={false} label="not observed" /></>)
  expect(view.getByRole('img', { name: 'advancing' }).getAttribute('data-active')).toBe('true')
  expect(view.getByRole('img', { name: 'not observed' }).getAttribute('data-active')).toBeNull()
})
