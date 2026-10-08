// @vitest-environment jsdom
/** Metadata navigation and continuation retain exact identities without implying execution or content grants. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { ObjectDetails } from '../src/client/ObjectDetails.tsx'
import { CollectionFilters } from '../src/client/CollectionFilters.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import type { SimulationProductObjectDetail } from '@clocky/clocky-client-runtime/client'
afterEach(cleanup)

it.each([en, zh])('keeps publication outcomes and independent continuation controls accessible in each locale', (locale) => {
  const readPage = vi.fn(), navigate = vi.fn()
  const value: SimulationProductObjectDetail = { collection: 'operations', section: 'attempts', id: 'operation' as never,
    attempts: { total: 3, items: [{ number: 1, outcome: 'uncertain', startedAt: 100, finishedAt: 200 }], nextCursor: 'next' as never } }
  const props = { value, view: { runId: 'run', module: 'operations' as const, search: '', objectId: 'operation', section: 'attempts' as const },
    navigate, readPage, blocked: false, canContinue: true, t: (key: Key) => locale[key], date: String }
  const view = render(<ObjectDetails {...props} />)
  expect(view.getByText(locale.uncertain)).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: locale.next }))
  expect(readPage).toHaveBeenLastCalledWith('next')
  view.rerender(<ObjectDetails {...props} canContinue={false} />)
  expect((view.getByRole('button', { name: locale.next }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: locale.first }))
  expect(readPage).toHaveBeenLastCalledWith()
  expect(view.getByText(locale.uncertain)).toBeDefined()
  view.rerender(<ObjectDetails {...props} value={{ ...value, attempts: { total: 0, items: [] } }} />)
  expect(view.getByText(locale.emptyCollection)).toBeDefined()
})

it('preserves exact decision time and links entity and operation scopes without copying hidden context', () => {
  const navigate = vi.fn()
  const value: SimulationProductObjectDetail = { collection: 'decisions', section: 'execution', id: 'decision' as never,
    summary: { id: 'decision' as never, entityId: 'entity' as never, slot: '9007199254740994' as never, time: '9007199254740993' as never,
      snapshotRevision: 4, status: 'accepted', operationCount: 2 },
    context: { status: 'prepared', retainedBytes: 40, maxBytes: 100, knowledgeCount: 1, sourceCount: 2, sectionCount: 3, content: 'withheld' },
    inference: { startedAt: 100, deadline: 200, expiredAt: 200 }, cancellation: 'timeout' }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'decisions', search: 'saved' }} navigate={navigate}
    readPage={vi.fn()} blocked={false} canContinue t={key => en[key]} date={String} />)
  expect(view.getByText('9007199254740993')).toBeDefined()
  expect(view.getByText(en.withheld)).toBeDefined()
  expect(view.getByText(en['cancellation.timeout'])).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: 'entity' }))
  expect(navigate).toHaveBeenLastCalledWith({ runId: 'run', module: 'entities', search: 'saved', objectId: 'entity' })
  fireEvent.click(view.getByRole('button', { name: en.decisionOperations }))
  expect(navigate).toHaveBeenLastCalledWith({ runId: 'run', module: 'operations', search: 'saved', decisionId: 'decision' })
})

it('clears a linked-object filter together with selection while retaining the selected run', () => {
  const change = vi.fn()
  const view = render(<CollectionFilters view={{ runId: 'run', module: 'operations', search: '', status: 'pending', entityId: 'entity',
    objectId: 'operation', section: 'attempts' }} change={change} t={key => en[key]} />)
  fireEvent.click(view.getByRole('button', { name: en.clearFilters }))
  expect(change).toHaveBeenCalledWith({ runId: 'run', module: 'operations', search: '', status: undefined, cognition: undefined,
    entityId: undefined, decisionId: undefined, objectId: undefined, section: undefined })
})

it('links exact Team and Session bindings from an entity identity and clears related filters without authority', () => {
  const navigate = vi.fn(), navigateApplication = vi.fn()
  const value: SimulationProductObjectDetail = { collection: 'entities', section: 'identity', id: 'entity' as never,
    summary: { id: 'entity' as never, name: { text: 'Display name', truncated: true }, kind: { text: 'company', truncated: false },
      phase: 'active', cognition: 'agent', writer: 'reserved' }, revision: 4, profileRevision: 2, writerEpoch: '1' as never,
    binding: { teamId: 'team' as never, participantId: 'member' as never, sessionId: 'session' as never } }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'entities', search: 'saved' }} navigate={navigate}
    readPage={vi.fn()} blocked={false} canContinue navigateApplication={navigateApplication} t={key => en[key]} date={String} />)
  expect(view.getByText('Display name')).toBeDefined()
  expect(view.getByText(en.truncate)).toBeDefined()
  fireEvent.click(view.getByRole('link', { name: `${en.inspectTeam}: team` }))
  expect(navigateApplication).toHaveBeenLastCalledWith(expect.stringContaining('team=team'))
  fireEvent.click(view.getByRole('button', { name: en.entityDecisions }))
  expect(navigate).toHaveBeenLastCalledWith({ runId: 'run', module: 'decisions', search: 'saved', entityId: 'entity' })
  fireEvent.click(view.getByRole('button', { name: en.entityOperations }))
  expect(navigate).toHaveBeenLastCalledWith({ runId: 'run', module: 'operations', search: 'saved', entityId: 'entity' })
})

it('exposes independent operation execution evidence, retry authorization and task references without leaking payloads', () => {
  const openRetry = vi.fn(), navigate = vi.fn(), navigateApplication = vi.fn()
  const value: SimulationProductObjectDetail = { collection: 'operations', section: 'execution', id: 'operation' as never,
    summary: { id: 'operation' as never, entityId: 'entity' as never, decisionId: 'decision' as never, index: 0,
      kind: { text: 'communication/post', truncated: false }, status: 'outcome-unknown', publication: 'pending',
      delivery: 'input-persisted', deliveryFailure: 'unresolved', task: 'created' }, dependencies: ['dep' as never],
    result: { status: 'applied', time: '100' as never, sequence: 7, code: { text: 'OK', truncated: false } },
    outbox: { ready: false, attemptCount: 2, nextAttemptAt: 200 },
    retry: { allowed: false, reason: 'not-due', expectedAttemptCount: 2, maxAttempts: 3 },
    taskReference: { teamId: 'team' as never, taskId: 'task' as never } }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'operations', search: '' }} navigate={navigate}
    readPage={vi.fn()} blocked={false} canContinue navigateApplication={navigateApplication} openRetry={openRetry}
    t={key => en[key]} date={String} />)
  fireEvent.click(view.getByRole('button', { name: 'dep' }))
  expect(navigate).toHaveBeenLastCalledWith({ runId: 'run', module: 'operations', search: '', objectId: 'dep', section: undefined })
  expect(view.getByText(en['operationRetry.reason.not-due'])).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: en['operationRetry.title'] }))
  expect(openRetry).toHaveBeenCalledWith('operation', 2)
  fireEvent.click(view.getByRole('link', { name: `${en.inspectTeamTask}: task` }))
  expect(navigateApplication).toHaveBeenLastCalledWith(expect.stringContaining('task=task'))
})

it('distinguishes completed, failed and in-progress checkpoint summaries with canonical reference kinds', () => {
  const navigate = vi.fn()
  const value: SimulationProductObjectDetail = { collection: 'checkpoints', section: 'references', id: 'checkpoint' as never,
    summary: { id: 'checkpoint' as never, status: 'completed', startedSequence: 1, finishedSequence: 2, time: '100' as never,
      publishedAt: 50, latestSuccessful: false, sourceValidation: 'not-performed' }, references: { total: 2, items: [
      { kind: 'run', cursor: 3 }, { kind: 'channel', id: 'channel' as never, cursor: 4 }] } }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'checkpoints', search: '' }} navigate={navigate}
    readPage={vi.fn()} blocked={false} canContinue t={key => en[key]} date={String} />)
  expect(view.getByText(en.no)).toBeDefined()
  expect(view.getByText('100')).toBeDefined()
  expect(view.getByText('50')).toBeDefined()
  expect(view.getByText(en['reference.run'])).toBeDefined()
  expect(view.getByText(en['reference.channel'])).toBeDefined()
})

it('keeps an identity keyboard-selectable and reports clipboard outcomes without losing the value', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const value: SimulationProductObjectDetail = { collection: 'entities', section: 'identity', id: 'entity' as never,
    summary: { id: 'entity' as never, kind: { text: 'company', truncated: false }, phase: 'inactive', cognition: 'none', writer: 'none' },
    revision: 1, profileRevision: 1 }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'entities', search: '' }} navigate={vi.fn()}
    readPage={vi.fn()} blocked={false} canContinue t={key => en[key]} date={String} />)
  fireEvent.click(view.getByRole('button', { name: en.copy }))
  await act(async () => { await Promise.resolve() })
  expect(writeText).toHaveBeenCalledWith('entity')
  expect(view.getByText(en.copied)).toBeDefined()
})

it('separates overflow context, inference completion and decision closure timing from execution content', () => {
  const value: SimulationProductObjectDetail = { collection: 'decisions', section: 'execution', id: 'decision' as never,
    summary: { id: 'decision' as never, entityId: 'entity' as never, slot: '1' as never, time: '2' as never,
      snapshotRevision: 5, status: 'submitted', operationCount: 0 },
    context: { status: 'overflow', requiredBytes: 200, maxBytes: 100 },
    inference: { startedAt: 10, deadline: 20, finishedAt: 30 }, closedAt: 40 }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'decisions', search: '' }} navigate={vi.fn()}
    readPage={vi.fn()} blocked={false} canContinue t={key => en[key]} date={String} />)
  expect(view.getByText(en.overflow)).toBeDefined()
  expect(view.getByText('30')).toBeDefined()
  expect(view.getByText('40')).toBeDefined()
})

it('renders publication readiness and a denied retry with an unavailable reason for a pending operation', () => {
  const value: SimulationProductObjectDetail = { collection: 'operations', section: 'execution', id: 'operation' as never,
    summary: { id: 'operation' as never, entityId: 'entity' as never, decisionId: 'decision' as never, index: 0,
      kind: { text: 'task/create', truncated: false }, status: 'pending', publication: 'not-applicable',
      delivery: 'not-applicable', task: 'not-applicable' }, dependencies: [],
    outbox: { ready: true, attemptCount: 0 },
    retry: { allowed: true, reason: 'ready', expectedAttemptCount: 0, maxAttempts: 1 } }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'operations', search: '' }} navigate={vi.fn()}
    readPage={vi.fn()} blocked={false} canContinue t={key => en[key]} date={String} />)
  expect(view.getByText(en.yes)).toBeDefined()
})

it('keeps checkpoint references to unmaterialized sessions and completed status without a diagnostic', () => {
  const value: SimulationProductObjectDetail = { collection: 'checkpoints', section: 'references', id: 'checkpoint' as never,
    summary: { id: 'checkpoint' as never, status: 'in-progress', startedSequence: 1, latestSuccessful: true,
      sourceValidation: 'not-performed' }, references: { total: 1, items: [
      { kind: 'session', id: 'session' as never, teamId: 'team' as never, participantId: 'member' as never,
        materialization: 'unmaterialized' }] } }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'checkpoints', search: '' }} navigate={vi.fn()}
    readPage={vi.fn()} blocked={false} canContinue t={key => en[key]} date={String} />)
  expect(view.getByText(en.yes)).toBeDefined()
  expect(view.getByText(en['reference.session'])).toBeDefined()
  expect(view.queryByRole('link', { name: /session/ })).toBeNull()
  expect(view.getByText('session')).toBeDefined()
})

it('reports a copy failure when clipboard access is denied without losing the identity', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } })
  const value: SimulationProductObjectDetail = { collection: 'entities', section: 'identity', id: 'entity' as never,
    summary: { id: 'entity' as never, kind: { text: 'company', truncated: false }, phase: 'inactive', cognition: 'none', writer: 'none' },
    revision: 1, profileRevision: 1 }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'entities', search: '' }} navigate={vi.fn()}
    readPage={vi.fn()} blocked={false} canContinue t={key => en[key]} date={String} />)
  fireEvent.click(view.getByRole('button', { name: en.copy }))
  await act(async () => { await Promise.resolve() })
  expect(view.getByText(en.copyFailed)).toBeDefined()
})

it('renders materialized session references and a failed checkpoint with diagnostic', () => {
  const navigate = vi.fn(), navigateApplication = vi.fn()
  const value: SimulationProductObjectDetail = { collection: 'checkpoints', section: 'references', id: 'checkpoint' as never,
    summary: { id: 'checkpoint' as never, status: 'failed', startedSequence: 1, finishedSequence: 2,
      latestSuccessful: false, sourceValidation: 'not-performed' }, references: { total: 2, items: [
      { kind: 'session', id: 'session' as never, teamId: 'team' as never, participantId: 'member' as never,
        materialization: 'materialized', sequence: 5 },
      { kind: 'team', id: 'team' as never, cursor: 1 }] }, failure: 'details-withheld',
    diagnostic: { stage: 'publish', code: 'cancelled', subject: { kind: 'run' } } }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'checkpoints', search: '' }} navigate={navigate}
    readPage={vi.fn()} blocked={false} canContinue navigateApplication={navigateApplication} t={key => en[key]} date={String} />)
  expect(view.getByRole('status').textContent).toBe(en.checkpointFailure)
  expect(view.getByText(en['reference.session'])).toBeDefined()
  expect(view.getByText('5')).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: en['diagnostic.locate'] }))
  expect(navigate).toHaveBeenLastCalledWith({ runId: 'run', module: 'overview', search: '' })
})

it('renders absent context and a withheld-cancellation decision without inference', () => {
  const value: SimulationProductObjectDetail = { collection: 'decisions', section: 'execution', id: 'decision' as never,
    summary: { id: 'decision' as never, entityId: 'entity' as never, slot: '1' as never, time: '2' as never,
      snapshotRevision: 5, status: 'open', operationCount: 0 }, context: { status: 'absent' } }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'decisions', search: '' }} navigate={vi.fn()}
    readPage={vi.fn()} blocked={false} canContinue t={key => en[key]} date={String} />)
  expect(view.getByText(en.absent)).toBeDefined()
})

it('delegates knowledge and relationship sections to their dedicated inspectors', () => {
  const navigate = vi.fn(), readPage = vi.fn()
  const knowledge: SimulationProductObjectDetail = { collection: 'entities', section: 'knowledge', id: 'entity' as never,
    readVersion: 'v1' as never, bodyAccess: 'withheld', entityId: 'entity' as never, time: '1' as never,
    cutoffRevision: 2, knowledge: { total: 0, items: [] } }
  const view = render(<ObjectDetails value={knowledge} view={{ runId: 'run', module: 'entities', search: '' }} navigate={navigate}
    readPage={readPage} blocked={false} canContinue t={key => en[key]} date={String} />)
  expect(view.getByText(en.knowledgeWithheld)).toBeDefined()
  cleanup()
  const relationships: SimulationProductObjectDetail = { collection: 'entities', section: 'relationships', id: 'entity' as never,
    time: '1' as never, relationships: { total: 0, items: [] } }
  const rel = render(<ObjectDetails value={relationships} view={{ runId: 'run', module: 'entities', search: '' }} navigate={navigate}
    readPage={readPage} blocked={false} canContinue t={key => en[key]} date={String} />)
  expect(rel.getByText(en.emptyCollection)).toBeDefined()
})

it('offers a blocked retry and an unavailable reason when retry capability is absent', () => {
  const value: SimulationProductObjectDetail = { collection: 'operations', section: 'execution', id: 'operation' as never,
    summary: { id: 'operation' as never, entityId: 'entity' as never, decisionId: 'decision' as never, index: 0,
      kind: { text: 'communication/post', truncated: false }, status: 'pending', publication: 'pending',
      delivery: 'pending', task: 'not-applicable' }, dependencies: [],
    outbox: { ready: false, attemptCount: 3 } }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'operations', search: '' }} navigate={vi.fn()}
    readPage={vi.fn()} blocked={true} canContinue openRetry={vi.fn()} t={key => en[key]} date={String} />)
  expect((view.getByRole('button', { name: en['operationRetry.title'] }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.getByText(en['operationRetry.unavailable'])).toBeDefined()
})

it('preserves zero as the valid retry fence when only outbox evidence exists', () => {
  const openRetry = vi.fn()
  const value: SimulationProductObjectDetail = { collection: 'operations', section: 'execution', id: 'operation' as never,
    summary: { id: 'operation' as never, entityId: 'entity' as never, decisionId: 'decision' as never, index: 0,
      kind: { text: 'communication/post', truncated: false }, status: 'pending', publication: 'pending',
      delivery: 'pending', task: 'not-applicable' }, dependencies: [], outbox: { ready: false, attemptCount: 2 } }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'operations', search: '' }} navigate={vi.fn()}
    readPage={vi.fn()} blocked={false} canContinue openRetry={openRetry} t={key => en[key]} date={String} />)
  fireEvent.click(view.getByRole('button', { name: en['operationRetry.title'] }))
  expect(openRetry).toHaveBeenCalledWith('operation', 2)
})

it('preserves zero as the last valid retry fence when no outbox evidence exists', () => {
  const openRetry = vi.fn()
  const value: SimulationProductObjectDetail = { collection: 'operations', section: 'execution', id: 'operation' as never,
    summary: { id: 'operation' as never, entityId: 'entity' as never, decisionId: 'decision' as never, index: 0,
      kind: { text: 'communication/post', truncated: false }, status: 'pending', publication: 'not-applicable',
      delivery: 'not-applicable', task: 'not-applicable' }, dependencies: [] }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'operations', search: '' }} navigate={vi.fn()}
    readPage={vi.fn()} blocked={false} canContinue openRetry={openRetry} t={key => en[key]} date={String} />)
  fireEvent.click(view.getByRole('button', { name: en['operationRetry.title'] }))
  expect(openRetry).toHaveBeenCalledWith('operation', 0)
})
