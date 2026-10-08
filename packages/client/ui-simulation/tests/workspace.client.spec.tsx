// @vitest-environment jsdom
/** Workspace assembly derives reads, navigation and draft lifetime from authoritative public snapshots. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@clocky/clocky-client-test-runtime'
import { createSnapshotStore, simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import type { SimulationRuntimeState, SimulationAdministrationState, SimulationRecordExportState, SimulationCommand,
  SimulationProductControl, SimulationProductRunInspection } from '@clocky/clocky-client-runtime/client'
import { Workspace, type Props } from '../src/client/Workspace.tsx'
import { createSimulationStore, operationRetryDraftKey, taskCancelDraftKey, reviewDraftKey } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import { collectionInput } from '../src/client/selection.ts'
import { Navigation } from '../src/client/Navigation.tsx'
import { WORKSPACE_NAVIGATION_EVENT } from '@clocky/clocky-client-ui-layout/client'
import type {} from '../src/client/index.ts'

// jsdom has no layout observer; browser evidence owns real measurements.
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

function fixture(href = '?workspace=simulation', visible = true) {
  window.history.replaceState(null, '', href)
  const empty = { loading: false, stale: false }
  const state = createSnapshotStore<SimulationRuntimeState>({ connected: true, generation: 1, authorizationVersion: 1,
    unknownOperations: empty, statuses: empty, reviews: empty, catalog: empty, preflight: empty, tasks: empty,
    persistentRequests: empty, control: empty, directory: empty, run: empty, collection: empty, recovery: empty,
    object: empty, records: empty, record: empty, source: empty, observation: empty })
  const administration = createSnapshotStore<SimulationAdministrationState>({ connected: true, authorizationVersion: 1, commands: {} })
  const exportState = createSnapshotStore<SimulationRecordExportState>({ pending: false, records: 0, bytes: 0, status: 'idle' })
  const view = createSimulationStore(65536, 16).create()
  const format = createSnapshotStore({ active: 'en' })
  const off = vi.fn()
  const methods = {
    unknownOperations: vi.fn(async () => {}), runStatuses: vi.fn(async () => {}), listTaskReviews: vi.fn(async () => {}),
    listTasks: vi.fn(async () => {}), listRequests: vi.fn(async () => {}), navigateApplication: vi.fn(), watchSource: vi.fn(() => off),
    inspectSource: vi.fn(async () => {}), refreshSource: vi.fn(async () => {}), readRecords: vi.fn(async () => {}), closeRecords: vi.fn(),
    exportRecords: vi.fn(async () => {}), cancelExport: vi.fn(), observe: vi.fn(() => off), catalog: vi.fn(async () => {}),
    preflight: vi.fn(async () => undefined), closePreflight: vi.fn(), control: vi.fn(async () => {}),
    retain: vi.fn(() => 'original' as never), submit: vi.fn(async () => undefined), query: vi.fn(async () => undefined), release: vi.fn(() => true),
    directory: vi.fn(async () => {}), inspect: vi.fn(async () => {}), browse: vi.fn(async () => {}), readRecovery: vi.fn(async () => {}),
    closeRecovery: vi.fn(), inspectObject: vi.fn(async () => {}), closeObject: vi.fn(), pause: vi.fn(),
  }
  const neverHook = (() => { throw new Error('Workspace must not read unrelated global stores') }) as never
  const props: Props = { ...methods, visible, actions: view.actions, renderSlot: () => null, useStore: bindSnapshotSelector(view.store),
    useSimulation: bindSnapshotSelector(state), useAdministration: bindSnapshotSelector(administration),
    useRecordsExport: bindSnapshotSelector(exportState), useFormatLocale: bindSnapshotSelector(format),
    useSessions: neverHook, useWorkspaces: neverHook, t: makeTranslate(en), maxDraftBytes: 65536,
    controlRefreshMs: 60000, pageSize: 2 }
  return { state, administration, view, props, methods, off, format }
}

it('restores the retained safe selection before opening the same-level Simulation navigation', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  const open = vi.fn()
  const props: Parameters<typeof Navigation>[0] = { wide: true, workspace: 'simulation', open,
    expandSidebar: vi.fn(), useStore: h.props.useStore, actions: h.props.actions,
    useSessions: h.props.useSessions, useWorkspaces: h.props.useWorkspaces, t: h.props.t }
  const ui = render(<Navigation {...props} />)
  expect(screen.getByRole('button', { name: en.title }).getAttribute('aria-current')).toBe('page')
  fireEvent.click(screen.getByRole('button', { name: en.title }))
  expect(open).toHaveBeenCalledOnce()
  ui.rerender(<Navigation {...props} wide={false} workspace="team" />)
  expect(screen.getByRole('button', { name: en.title }).getAttribute('aria-current')).toBeNull()
})

it('refreshes only the current bounded directory status batch and cancels polling when hidden', () => {
  vi.useFakeTimers()
  const h = fixture()
  const run = { id: 'run' as never, name: { text: 'Registered', truncated: true }, registeredAt: 1, observation: 'not-observed' as const }
  h.state.set({ ...h.state.getSnapshot(), directory: { loading: false, stale: false,
    value: { items: [run], nextCursor: 'next' as never } }, statuses: { loading: false, stale: false,
    scope: JSON.stringify(['statuses', [run.id]]), value: { items: [{ run, status: 'missing' }] } } })
  h.format.set({ active: 'zh' })
  const ui = render(<Workspace {...h.props} />)
  act(() => { vi.advanceTimersByTime(60000) })
  expect(h.methods.runStatuses).toHaveBeenCalledWith({ runIds: ['run'] })
  fireEvent.click(screen.getByRole('button', { name: en.next }))
  expect(h.methods.directory).toHaveBeenLastCalledWith('', 'next')
  fireEvent.click(screen.getByRole('button', { name: /^Registered/ }))
  expect(h.view.getSnapshot().runId).toBe('run')
  ui.rerender(<Workspace {...h.props} visible={false} />)
  h.methods.runStatuses.mockClear()
  act(() => { vi.advanceTimersByTime(60000) })
  expect(h.methods.runStatuses).not.toHaveBeenCalled()
})

it('refreshes the exact records module and follows independently committed browser navigation', () => {
  const h = fixture('?workspace=simulation&simulation=run&simulationModule=records')
  render(<Workspace {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  expect(h.methods.readRecords).toHaveBeenCalledWith({ runId: 'run', mode: 'metadata', kind: undefined, limit: 2 })
  act(() => {
    window.history.replaceState(null, '', '?workspace=simulation&simulation=run&simulationModule=decisions&simulationObject=decision')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(h.view.getSnapshot()).toMatchObject({ module: 'decisions', objectId: 'decision' })
  expect(h.methods.inspectObject).toHaveBeenCalledWith({ runId: 'run', collection: 'decisions', id: 'decision', section: 'execution' })
  act(() => { h.state.set({ ...h.state.getSnapshot(), connected: false }) })
  expect(screen.getByText(en.connection)).toBeDefined()
})

it('waits for the selected run policy before reading private context and rereads a changed knowledge revision', () => {
  const h = fixture('?workspace=simulation&simulation=run&simulationModule=entities&simulationObject=entity&simulationSection=knowledge')
  render(<Workspace {...h.props} />)
  expect(h.methods.inspectObject).not.toHaveBeenCalled()
  const observation = { runId: 'other' as never, readVersion: 'policy' as never, cursor: 'cursor' as never,
    status: 'changed' as const, world: { status: 'unavailable' as const }, observedAt: 1 }
  act(() => { h.state.set({ ...h.state.getSnapshot(), observation: { loading: false, stale: false, value: observation } }) })
  expect(h.methods.inspectObject).not.toHaveBeenCalled()
  // SimulationRuntime.observe clears the previous run before publishing its new observation.
  act(() => { h.state.set({ ...h.state.getSnapshot(), observation: { loading: true, stale: false } }) })
  act(() => { h.state.set({ ...h.state.getSnapshot(), observation: { loading: false, stale: false,
    value: { ...observation, runId: 'run' as never } } }) })
  expect(h.methods.inspectObject).toHaveBeenCalledWith({ runId: 'run', collection: 'entities', id: 'entity', section: 'knowledge', limit: 2 })
  h.methods.inspectObject.mockClear()
  act(() => { h.state.set({ ...h.state.getSnapshot(), observation: { loading: false, stale: false,
    value: { ...observation, runId: 'run' as never, world: { status: 'observed', revision: 2 } } } }) })
  expect(h.methods.inspectObject).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: en.refreshDetail }))
  expect(h.methods.inspectObject).toHaveBeenCalledTimes(2)
  const detail = within(screen.getByRole('navigation', { name: en.detailSections }))
  fireEvent.click(detail.getByRole('button', { name: en.relationships }))
  expect(h.methods.inspectObject).toHaveBeenLastCalledWith({ runId: 'run', collection: 'entities', id: 'entity', section: 'relationships', limit: 2 })
})

it('closes readers while hidden and reads only the current directory when shown', () => {
  const h = fixture(undefined, false)
  const ui = render(<Workspace {...h.props} />)
  expect(screen.queryByRole('main')).toBeNull()
  expect(h.methods.pause).toHaveBeenCalledOnce()
  expect(h.methods.directory).not.toHaveBeenCalled()
  ui.rerender(<Workspace {...h.props} visible />)
  expect(h.methods.directory).toHaveBeenCalledWith('')
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  expect(h.methods.directory).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: en.createTitle }))
  expect(screen.getByRole('dialog', { name: en.createTitle })).toBeDefined()
  expect(h.methods.catalog).toHaveBeenCalledTimes(2)
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(h.view.getSnapshot().creating).toBe(false)
})

it('navigates exact bounded collection reads through module controls and releases observation on hide', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  const ui = render(<Workspace {...h.props} />)
  expect(h.methods.observe).toHaveBeenCalledWith('run')
  expect(h.methods.inspect).toHaveBeenCalledWith('run')
  expect(h.methods.control).toHaveBeenCalledWith('run')
  const navigation = within(screen.getByRole('navigation', { name: en.modules }))
  fireEvent.click(navigation.getByRole('button', { name: en.entities }))
  expect(h.methods.browse).toHaveBeenCalledWith(expect.objectContaining({ collection: 'entities', runId: 'run', limit: 2 }))
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  expect(h.methods.browse).toHaveBeenCalledTimes(2)
  fireEvent.click(navigation.getByRole('button', { name: en['modules.more'] }))
  fireEvent.click(screen.getByRole('menuitem', { name: en.requests }))
  expect(h.view.getSnapshot().module).toBe('requests')
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  expect(h.methods.listRequests).toHaveBeenCalledWith({ runId: 'run', limit: 2 })
  fireEvent.click(navigation.getByRole('button', { name: en.overview }))
  fireEvent.click(screen.getByRole('button', { name: en.back }))
  expect(h.view.getSnapshot().runId).toBeUndefined()
  ui.rerender(<Workspace {...h.props} visible={false} />)
  expect(h.off).toHaveBeenCalled()
})

it('protects unsent drafts from unload and withdraws them when authority changes', () => {
  const h = fixture()
  render(<Workspace {...h.props} />)
  act(() => { h.view.actions.input('run' as never, { entityId: 'entity', text: 'Private', availableAt: '0' }) })
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  act(() => { h.state.set({ ...h.state.getSnapshot(), authorizationVersion: 2 }) })
  expect(h.view.getSnapshot().inputDrafts).toEqual({})
  const safe = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(safe)
  expect(safe.defaultPrevented).toBe(false)
})

const originalCommands: SimulationCommand[] = [
  { kind: 'retry-operation', input: { runId: 'run' as never, commandId: 'retry' as never,
    operationId: 'operation' as never, expectedAttemptCount: 1, reason: 'Original retry reason' } },
  { kind: 'cancel-task', input: { runId: 'run' as never, commandId: 'cancel' as never,
    operationId: 'operation' as never, expectedRevision: 2, expectedAttemptId: null, reason: 'Original cancellation' } },
  { kind: 'review', input: { runId: 'run' as never, commandId: 'review' as never, operationId: 'operation' as never,
    attemptId: 'attempt' as never, expectedRevision: 2, nextPhase: 'completed', reason: 'Original review reason' } },
]

it.each(originalCommands)('restores only the exact retained $kind original into its own draft slot', (command) => {
  const h = fixture()
  h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [simulationCommandKey(command)]: { command, pending: false, unknown: true, notFound: false },
  } })
  render(<Workspace {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: en.inspectOriginal }))
  expect(h.view.getSnapshot().runId).toBe('run')
  if (command.kind === 'retry-operation') {
    expect(Object.values(h.view.getSnapshot().operationRetryDrafts)).toMatchObject([{ operationId: 'operation', reason: command.input.reason }])
    expect(h.view.getSnapshot().module).toBe('operations')
  } else if (command.kind === 'cancel-task') {
    expect(Object.values(h.view.getSnapshot().cancelDrafts)).toMatchObject([
      { expectedRevision: 2, expectedAttemptId: null, reason: command.input.reason },
    ])
  } else if (command.kind === 'review') {
    expect(Object.values(h.view.getSnapshot().reviewDrafts)).toMatchObject([{ attemptId: 'attempt', expectedRevision: 2, reason: command.input.reason }])
  }
  expect(h.methods.retain).not.toHaveBeenCalled()
  expect(h.methods.submit).not.toHaveBeenCalled()
})

it.each(originalCommands)('reopens a $kind original without overwriting later retained input', (command) => {
  const h = fixture()
  h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [simulationCommandKey(command)]: { command, pending: false, unknown: true, notFound: false },
  } })
  render(<Workspace {...h.props} />)
  if (command.kind === 'retry-operation') {
    const target = { runId: command.input.runId, operationId: command.input.operationId }
    const key = operationRetryDraftKey(target)
    act(() => { h.view.actions.operationRetry(key, { ...target, expectedAttemptCount: 1, reason: 'Later retry evidence' }) })
    fireEvent.click(screen.getByRole('button', { name: en.inspectOriginal }))
    expect(h.view.getSnapshot().operationRetryDrafts[key]?.reason).toBe('Later retry evidence')
  } else if (command.kind === 'cancel-task') {
    const target = { runId: command.input.runId, operationId: command.input.operationId }
    const key = taskCancelDraftKey(target)
    act(() => { h.view.actions.cancel(key, { ...target, expectedRevision: 2, expectedAttemptId: null,
      reason: 'Later cancellation reason' }) })
    fireEvent.click(screen.getByRole('button', { name: en.inspectOriginal }))
    expect(h.view.getSnapshot().cancelDrafts[key]?.reason).toBe('Later cancellation reason')
  } else if (command.kind === 'review') {
    const target = { runId: command.input.runId, operationId: command.input.operationId, attemptId: command.input.attemptId }
    const key = reviewDraftKey(target)
    act(() => { h.view.actions.review(key, { ...target, expectedRevision: 2, nextPhase: 'completed',
      reason: 'Later review reason' }) })
    fireEvent.click(screen.getByRole('button', { name: en.inspectOriginal }))
    expect(h.view.getSnapshot().reviewDrafts[key]?.reason).toBe('Later review reason')
  }
  expect(h.methods.retain).not.toHaveBeenCalled()
})

it('opens a retained maintenance original from the directory in its exact registered run', () => {
  const h = fixture()
  const command: SimulationCommand = { kind: 'prepare', input: { runId: 'run' as never, commandId: 'prepare' as never } }
  h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [simulationCommandKey(command)]: { command, pending: false, unknown: true, notFound: false },
  } })
  render(<Workspace {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: en.queryOriginal }))
  expect(h.methods.query).toHaveBeenCalledWith(simulationCommandKey(command))
  fireEvent.click(screen.getByRole('button', { name: en.retryOriginal }))
  expect(h.methods.submit).toHaveBeenCalledWith(simulationCommandKey(command))
  fireEvent.click(screen.getByRole('button', { name: en.inspectOriginal }))
  expect(h.view.getSnapshot().runId).toBe('run')
  expect(h.view.getSnapshot().maintenance).toMatchObject({ runId: 'run', kind: 'prepare' })
  expect(screen.getByRole('dialog')).toBeDefined()
  expect(h.methods.retain).not.toHaveBeenCalled()
  expect(h.methods.submit).toHaveBeenCalledOnce()
})

it('opens current cancellation input, preserves it through close and discards only after explicit confirmation', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  h.state.set({ ...h.state.getSnapshot(), run: { loading: false, stale: false, scope: JSON.stringify(['run', 'run']) },
    tasks: { loading: false, stale: false, value: { runId: 'run' as never, snapshotRevision: 3, observedAt: 1,
      total: 1, nextCursor: 'tasks-next' as never, items: [{ operationId: 'operation' as never, taskId: 'task' as never,
        teamId: 'team' as never, taskRevision: 2, phase: 'running', attemptCount: 1, maxAttempts: 2,
        expectedAttemptId: null, cancel: { allowed: true, reason: 'ready' } }] } } })
  render(<Workspace {...h.props} />)
  const controls = within(screen.getByRole('region', { name: en['taskControl.title'] }))
  fireEvent.click(controls.getByRole('button', { name: en.next }))
  expect(h.methods.listTasks).toHaveBeenLastCalledWith({ runId: 'run', limit: 2, cursor: 'tasks-next', expectedRevision: 3 })
  fireEvent.click(controls.getByRole('button', { name: en['taskControl.open'] }))
  let dialog = within(screen.getByRole('dialog', { name: en['taskControl.open'] }))
  fireEvent.change(dialog.getByLabelText(en['taskControl.reason']), { target: { value: 'Later private reason' } })
  fireEvent(screen.getByRole('dialog', { name: en['taskControl.open'] }), new Event('cancel', { cancelable: true }))
  fireEvent.click(controls.getByRole('button', { name: en['taskControl.open'] }))
  dialog = within(screen.getByRole('dialog', { name: en['taskControl.open'] }))
  expect(dialog.getByLabelText<HTMLTextAreaElement>(en['taskControl.reason']).value).toBe('Later private reason')
  fireEvent.click(dialog.getByRole('button', { name: en.discardDraft }))
  fireEvent(screen.getByRole('dialog', { name: en.discardDraft }), new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog', { name: en.discardDraft })).toBeNull()
  fireEvent.click(dialog.getByRole('button', { name: en.discardDraft }))
  fireEvent.click(within(screen.getByRole('dialog', { name: en.discardDraft })).getByRole('button', { name: en.discardDraft }))
  expect(h.view.getSnapshot().cancelDrafts).toEqual({})
  expect(h.methods.submit).not.toHaveBeenCalled()
})

it('renders unknown-operation work with exact navigation and bounded list reads', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  const runPage = { run: { id: 'run' as never, name: { text: 'Run', truncated: false }, registeredAt: 1 },
    operational: { scenario: { status: 'observed', execution: 'automatic-tasks',
      templateId: { text: 'Scenario' }, version: '1', driverVersion: '1' } },
    world: { metrics: { unknownOperationCount: 2 } } }
  h.state.set({ ...h.state.getSnapshot(),
    run: { loading: false, stale: false, scope: JSON.stringify(['run', 'run']), value: runPage as never },
    unknownOperations: { loading: false, stale: false, value: { runId: 'run' as never, collection: 'operations',
      snapshotRevision: 1, total: 1, items: [{ id: 'unknown-operation' as never }] } as never } })
  render(<Workspace {...h.props} />)
  expect(h.methods.unknownOperations).toHaveBeenCalledWith('run', 2)
  expect(screen.getByText(`${en['operationRetry.unknownWork']} · 2`)).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: `${en['operationRetry.viewExact']} · unknown-operation` }))
  expect(h.view.getSnapshot()).toMatchObject({ module: 'operations', objectId: 'unknown-operation' })
  fireEvent.click(screen.getByRole('button', { name: en.overview }))
  fireEvent.click(screen.getByRole('button', { name: h.props.t('needsYou.unknown', { count: 2 }) }))
  expect(h.view.getSnapshot()).toMatchObject({ module: 'operations', status: 'outcome-unknown' })
  fireEvent.click(screen.getByRole('button', { name: en.overview }))
  fireEvent.click(screen.getByRole('button', { name: en['operationRetry.viewUnknown'] }))
  expect(h.view.getSnapshot()).toMatchObject({ module: 'operations', status: 'outcome-unknown' })
})

it('refreshes requests from their module and navigates to a collection object page', () => {
  const h = fixture('?workspace=simulation&simulation=run&simulationModule=requests')
  h.state.set({ ...h.state.getSnapshot(), run: { loading: false, stale: false,
    scope: JSON.stringify(['run', 'run']), value: { run: { id: 'run' as never,
      name: { text: 'Run', truncated: false }, registeredAt: 1 } } as never } })
  render(<Workspace {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  expect(h.methods.listRequests).toHaveBeenLastCalledWith({ runId: 'run', limit: 2 })
  window.history.replaceState(null, '', '?workspace=simulation&simulation=run&simulationModule=entities&simulationObject=entity&simulationSection=relationships')
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
  expect(h.methods.browse).toHaveBeenCalledWith(expect.objectContaining({ collection: 'entities', runId: 'run', limit: 2 }))
  expect(h.methods.inspectObject).toHaveBeenCalledWith({ runId: 'run', collection: 'entities', id: 'entity', section: 'relationships', limit: 2 })
})

it('opens the requests module from a run and closes retained terminal originals after acknowledgment', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  const command: SimulationCommand = { kind: 'prepare', input: { runId: 'run' as never, commandId: 'prepare' as never } }
  const key = simulationCommandKey(command)
  h.state.set({ ...h.state.getSnapshot(), run: { loading: false, stale: false,
    scope: JSON.stringify(['run', 'run']), value: { run: { id: 'run' as never,
      name: { text: 'Run', truncated: false }, registeredAt: 1 } } as never } })
  h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [key]: { command, pending: false, unknown: false, notFound: false,
      receipt: { kind: 'request', value: { runId: 'run' as never, commandId: 'prepare' as never,
        kind: 'prepare', acceptedAt: 1, status: 'completed' } } } } })
  render(<Workspace {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(en['requests.open']) }))
  expect(h.view.getSnapshot().module).toBe('requests')
  fireEvent.click(screen.getByRole('button', { name: en.acknowledgeReceipt }))
  expect(h.methods.release).toHaveBeenCalledWith(key)
})

it('polls only the visible run and refreshes its exact overview observations', () => {
  vi.useFakeTimers()
  const h = fixture('?workspace=simulation&simulation=run')
  const view = render(<Workspace {...h.props} />)
  expect(h.methods.control).toHaveBeenCalledOnce()
  act(() => { vi.advanceTimersByTime(60000) })
  expect(h.methods.control).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  expect(h.methods.inspect).toHaveBeenCalledTimes(2)
  expect(h.methods.control).toHaveBeenCalledTimes(3)
  const page = screen.getByRole('main')
  page.scrollTop = 42
  fireEvent.scroll(page)
  expect(h.view.getSnapshot().collectionScroll).toBe(42)
  view.rerender(<Workspace {...h.props} visible={false} />)
  act(() => { vi.advanceTimersByTime(60000) })
  expect(h.methods.control).toHaveBeenCalledTimes(3)
})

it('uses the compact module picker to change the shareable collection route', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  render(<Workspace {...h.props} />)
  const picker = screen.getByRole('button', { name: `${en.modules}: ${en.overview}` })
  fireEvent.click(picker)
  fireEvent.click(screen.getByRole('menuitem', { name: en.operations }))
  expect(h.view.getSnapshot().module).toBe('operations')
  expect(new URL(window.location.href).searchParams.get('simulationModule')).toBe('operations')
  fireEvent.click(screen.getByRole('button', { name: `${en.modules}: ${en.operations}` }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('button', { name: `${en.modules}: ${en.operations}` }).getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: en['modules.more'] }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('button', { name: en['modules.more'] }).getAttribute('aria-expanded')).toBe('false')
})

it('opens a registered run from the retained create receipt and closes its creation surface', () => {
  const h = fixture()
  const command: SimulationCommand = { kind: 'create', input: { commandId: 'created' as never,
    templateId: 'company' as never, templateVersion: '1', expectedModel: { provider: 'company', name: 'scripted' }, name: 'Created company',
    parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } } }
  const key = simulationCommandKey(command)
  h.administration.set({ connected: true, authorizationVersion: 1, commands: { [key]: {
    command, pending: false, unknown: false, notFound: false, receipt: { kind: 'request', value: {
      commandId: 'created' as never, runId: 'created-run' as never, kind: 'create', acceptedAt: 1, status: 'accepted' } },
  } } })
  render(<Workspace {...h.props} />)
  act(() => {
    h.view.actions.creation({ templateId: 'company', name: 'Created company', buyerName: 'Buyer', supplierName: 'Supplier',
      initialStock: '2', commandKey: key })
    h.view.actions.creating(true)
  })
  fireEvent.click(within(screen.getByRole('dialog', { name: en.createTitle }))
    .getByRole('button', { name: en.openCreatedRun }))
  expect(h.view.getSnapshot().runId).toBe('created-run')
  expect(h.view.getSnapshot().creating).toBe(false)
})

it('routes review and original-lookup attention to their exact resolution surfaces', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  const runId = 'run' as never
  h.state.set({ ...h.state.getSnapshot(), run: { loading: false, stale: false,
    scope: JSON.stringify(['run', runId]), value: { run: { id: runId,
      name: { text: 'Run', truncated: false }, registeredAt: 1, observation: 'not-observed' }, status: 'missing' } },
  reviews: { loading: false, stale: false, value: { runId, snapshotRevision: 1, observedAt: 1, total: 1,
    items: [{ operationId: 'operation' as never, teamId: 'team' as never, taskId: 'task' as never,
      attemptId: 'attempt' as never, taskRevision: 1, reviewerEntityId: 'buyer' as never, phase: 'review',
      attemptCount: 1, maxAttempts: 2, action: { allowed: true, reason: 'ready' } }] } } })
  const command: SimulationCommand = { kind: 'prepare', input: { runId, commandId: 'prepare' as never } }
  h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [simulationCommandKey(command)]: { command, pending: false, unknown: true, notFound: false },
  } })
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  const scrollIntoView = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
  try {
    render(<Workspace {...h.props} />)
    fireEvent.click(screen.getByRole('button', { name: h.props.t('needsYou.reviews', { count: 1 }) }))
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start' })
    fireEvent.click(screen.getByRole('button', { name: h.props.t('needsYou.requests', { count: 1 }) }))
    expect(h.view.getSnapshot().module).toBe('requests')
  } finally {
    if (original === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    else Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
  }
})

it('reopens a retained external retry draft through its exact operation and run identity', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  render(<Workspace {...h.props} />)
  const target = { runId: 'run' as never, operationId: 'operation' }
  const key = operationRetryDraftKey(target)
  act(() => { h.view.actions.operationRetry(key, { ...target, expectedAttemptCount: 2, reason: 'Retained evidence' }) })
  fireEvent.click(screen.getByRole('button', { name: `${en['operationRetry.openDraft']} · operation` }))
  expect(h.view.getSnapshot()).toMatchObject({ runId: 'run', module: 'operations', objectId: 'operation',
    operationRetryTarget: target })
  const dialog = within(screen.getByRole('dialog', { name: en['operationRetry.title'] }))
  const reason = dialog.getByLabelText(en['operationRetry.reason'])
  if (!(reason instanceof HTMLTextAreaElement)) throw new Error('Retry reason is not editable')
  expect(reason.value).toBe('Retained evidence')
  expect(h.view.getSnapshot().operationRetryDrafts[key]?.reason).toBe('Retained evidence')
  fireEvent.click(dialog.getAllByRole('button', { name: en.closeKeepDraft }).at(-1)!)
  expect(h.view.getSnapshot().operationRetryTarget).toBeUndefined()
  expect(h.view.getSnapshot().operationRetryDrafts[key]?.reason).toBe('Retained evidence')
})

it('resumes a retained private ingress draft through the owning maintenance surface', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  render(<Workspace {...h.props} />)
  act(() => { h.view.actions.input('run' as never, { entityId: 'buyer', text: 'Private input', availableAt: '1' }) })
  fireEvent.click(screen.getByRole('button', { name: en.resumeInput }))
  expect(h.view.getSnapshot().maintenance).toMatchObject({ runId: 'run', kind: 'ingress' })
  const dialog = within(screen.getByRole('dialog', { name: en['maintenance.ingress'] }))
  fireEvent.change(dialog.getByLabelText(en.inputText), { target: { value: 'Later private edit' } })
  expect(h.view.getSnapshot().inputDrafts.run?.text).toBe('Later private edit')
  fireEvent.click(dialog.getAllByRole('button', { name: en.closeKeepDraft }).at(-1)!)
  expect(h.view.getSnapshot().maintenance).toBeUndefined()
  expect(h.view.getSnapshot().inputDrafts.run?.text).toBe('Later private edit')
})

it('keeps the requests continuation reachable from a non-overview module with a retained original', () => {
  const h = fixture('?workspace=simulation&simulation=run&simulationModule=operations')
  const command: SimulationCommand = { kind: 'prepare', input: { runId: 'run' as never, commandId: 'prepare' as never } }
  h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [simulationCommandKey(command)]: { command, pending: false, unknown: true, notFound: false },
  } })
  render(<Workspace {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: en['requests.open'] }))
  expect(h.view.getSnapshot().module).toBe('requests')
})

it('pages the selected operation attempt history with its exact revision and retains collection scroll', () => {
  const h = fixture('?workspace=simulation&simulation=run&simulationModule=operations&simulationObject=operation&simulationSection=attempts')
  const runId = 'run' as never
  const summary = { id: 'operation' as never, entityId: 'entity' as never, decisionId: 'decision' as never,
    index: 0, kind: { text: 'communication/post', truncated: false }, status: 'pending' as const,
    publication: 'pending' as const, delivery: 'pending' as const, task: 'not-applicable' as const }
  const collection = collectionInput({ runId, module: 'operations', search: '', objectId: 'operation', section: 'attempts' }, 2)
  const scope = JSON.stringify(Object.entries(collection).filter(([key]) => key !== 'limit')
    .sort(([a], [b]) => a.localeCompare(b)))
  h.state.set({ ...h.state.getSnapshot(), collection: { loading: false, stale: false, scope,
    value: { runId, collection: 'operations', snapshotRevision: 4, observedAt: 1, total: 1, items: [summary] } },
  object: { loading: false, stale: false, value: { runId, snapshotRevision: 4, observedAt: 1, status: 'found',
    selection: { collection: 'operations', id: summary.id, section: 'attempts' },
    value: { collection: 'operations', section: 'attempts', id: summary.id,
      attempts: { total: 3, items: [{ number: 1, outcome: 'uncertain', startedAt: 1 }], nextCursor: 'attempt-next' as never } } } } })
  render(<Workspace {...h.props} />)
  const scroll = screen.getByRole('table').parentElement
  if (scroll === null) throw new Error('Operation table has no scroll viewport')
  scroll.scrollTop = 17
  fireEvent.scroll(scroll)
  expect(h.view.getSnapshot().collectionScroll).toBe(17)
  fireEvent.click(within(screen.getByRole('complementary', { name: en.view })).getByRole('button', { name: en.next }))
  expect(h.methods.inspectObject).toHaveBeenLastCalledWith({ runId, collection: 'operations', id: summary.id,
    section: 'attempts', limit: 2, cursor: 'attempt-next', expectedRevision: 4 })
  fireEvent.click(within(screen.getByRole('complementary', { name: en.view })).getByRole('button', { name: en.first }))
  expect(h.methods.inspectObject).toHaveBeenLastCalledWith({ runId, collection: 'operations', id: summary.id,
    section: 'attempts', limit: 2, cursor: undefined, expectedRevision: undefined })
})

it('refreshes the displayed Host control and opens only an allowed maintenance action', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  const control: SimulationProductControl = { runId: 'run' as never, owner: 'held', phase: 'paused', revision: 1,
    driver: 'idle', inFlight: false, observedAt: 1,
    actions: { start: { allowed: true, reason: 'ready' }, pause: { allowed: false, reason: 'stalled' } },
    budget: { model: { provider: 'company', name: 'scripted' }, tokensPerRequest: 1000,
      tokensPerInterval: 10000, interval: '100' as never, residentActors: 2, sharedModelLimit: 4 },
    administration: { actions: { checkpoint: { allowed: true, reason: 'ready' },
      restore: { allowed: false, reason: 'checkpoint-required' }, prepare: { allowed: true, reason: 'ready' },
      ingress: { allowed: true, reason: 'ready' } },
    ingress: { maxTime: '1000' as never, maxBytes: 1000, targets: [] } } }
  h.state.set({ ...h.state.getSnapshot(), control: { loading: false, stale: false,
    scope: JSON.stringify(['control', 'run']), value: control } })
  render(<Workspace {...h.props} />)
  const management = within(screen.getByRole('region', { name: en.management }))
  fireEvent.click(management.getByText(en['status.moreActions']))
  fireEvent.click(management.getByRole('button', { name: en.refreshControl }))
  expect(h.methods.control).toHaveBeenCalledTimes(2)
  expect(management.getByRole('button', { name: en['maintenance.restore'] }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(management.getByRole('button', { name: en['maintenance.prepare'] }))
  expect(h.view.getSnapshot().maintenance).toMatchObject({ runId: 'run', kind: 'prepare' })
  fireEvent.click(within(screen.getByRole('dialog', { name: en['maintenance.prepare'] }))
    .getAllByRole('button', { name: en.closeKeepDraft }).at(-1)!)
  expect(h.view.getSnapshot().maintenance).toBeUndefined()
  const manage: SimulationCommand = { kind: 'manage', input: { runId: 'run' as never,
    managementId: 'manage' as never, phase: 'running' } }
  const checkpoint: SimulationCommand = { kind: 'checkpoint', input: { runId: 'run' as never,
    commandId: 'checkpoint' as never } }
  act(() => { h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [simulationCommandKey(manage)]: { command: manage, pending: false, unknown: true, notFound: false },
    [simulationCommandKey(checkpoint)]: { command: checkpoint, pending: false, unknown: true, notFound: false },
  } }) })
  expect(management.getByRole('button', { name: en.start }).hasAttribute('disabled')).toBe(true)
  expect(management.getByRole('button', { name: en['maintenance.checkpoint'] }).hasAttribute('disabled')).toBe(true)
  act(() => { h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [simulationCommandKey(manage)]: { command: manage, pending: true, unknown: false, notFound: false },
  } }) })
  expect(management.getByRole('button', { name: en.start }).hasAttribute('disabled')).toBe(true)
  act(() => { h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [simulationCommandKey(manage)]: { command: manage, pending: false, unknown: false, notFound: false,
      receipt: { kind: 'management', value: { managementId: 'manage' as never, phase: 'running',
        status: 'in-progress', startedSequence: 1 } } },
  } }) })
  expect(management.getByRole('button', { name: en.start }).hasAttribute('disabled')).toBe(true)
})

it('opens the exact run attached to a retained directory receipt', () => {
  const h = fixture()
  const command: SimulationCommand = { kind: 'prepare', input: { runId: 'run' as never, commandId: 'prepare' as never } }
  h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [simulationCommandKey(command)]: { command, pending: false, unknown: false, notFound: false,
      receipt: { kind: 'request', value: { commandId: 'prepare' as never, runId: 'run' as never,
        kind: 'prepare', acceptedAt: 1, status: 'completed' } } },
  } })
  render(<Workspace {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: en.openCreatedRun }))
  expect(h.view.getSnapshot()).toMatchObject({ runId: 'run', module: 'overview' })
  expect(h.methods.retain).not.toHaveBeenCalled()
})

it('refreshes the selected run only after retrying an accepted persistent request with a receipt', async () => {
  const h = fixture('?workspace=simulation&simulation=run&simulationModule=requests')
  const runId = 'run' as never, commandId = 'request' as never
  const receipt = { commandId, runId, kind: 'create' as const, acceptedAt: 1, status: 'accepted' as const }
  h.state.set({ ...h.state.getSnapshot(), run: { loading: false, stale: false,
    scope: JSON.stringify(['run', runId]), value: { run: { id: runId,
      name: { text: 'Run', truncated: false }, registeredAt: 1, observation: 'not-observed' }, status: 'missing' } },
  persistentRequests: { loading: false, stale: false, value: {
    runId, snapshotRevision: 1, total: 1, items: [receipt] } } })
  const submit = vi.fn(async () => ({ command: { kind: 'retry-request' as const, input: { runId, commandId } },
    pending: false, unknown: false, notFound: false,
    receipt: { kind: 'request' as const, value: { ...receipt, status: 'completed' as const } } }))
  render(<Workspace {...h.props} submit={submit} />)
  const requests = within(screen.getByRole('region', { name: en['requests.title'] }))
  fireEvent.click(requests.getByRole('button', { name: en['requests.retry'] }))
  await vi.waitFor(() => { expect(submit).toHaveBeenCalledOnce() })
  await vi.waitFor(() => { expect(h.methods.inspect).toHaveBeenCalledTimes(2) })
  expect(h.methods.control).toHaveBeenCalledTimes(2)
  expect(h.methods.listRequests).toHaveBeenCalledWith({ runId, limit: 2 })
})

it('closes maintenance before following canonical diagnostic links to Simulation and Team', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  const runId = 'run' as never
  const command: SimulationCommand = { kind: 'checkpoint', input: { runId, commandId: 'checkpoint' as never } }
  const key = simulationCommandKey(command)
  const receipt = { kind: 'request' as const, value: { runId, commandId: 'checkpoint' as never,
    kind: 'checkpoint' as const, acceptedAt: 1, status: 'failed' as const, failure: 'checkpoint-failed' as const,
    diagnostic: { stage: 'validate' as const, code: 'binding-mismatch' as const,
      subject: { kind: 'entity' as const, entityId: 'entity' as never } } } }
  h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [key]: { command, pending: false, unknown: false, notFound: false, receipt },
  } })
  render(<Workspace {...h.props} />)
  act(() => { h.view.actions.maintenance({ runId, kind: 'checkpoint', commandKey: key }) })
  fireEvent.click(within(screen.getByRole('dialog', { name: en['maintenance.checkpoint'] }))
    .getByRole('button', { name: en['diagnostic.locate'] }))
  expect(h.view.getSnapshot()).toMatchObject({ runId: 'run', module: 'entities', objectId: 'entity' })
  expect(h.view.getSnapshot().maintenance).toBeUndefined()
  act(() => {
    h.administration.set({ connected: true, authorizationVersion: 1, commands: { [key]: {
      command, pending: false, unknown: false, notFound: false,
      receipt: { ...receipt, value: { ...receipt.value,
        diagnostic: { ...receipt.value.diagnostic, subject: { kind: 'team' as const, teamId: 'team' as never } } } },
    } } })
    h.view.actions.maintenance({ runId, kind: 'checkpoint', commandKey: key })
  })
  const link = within(screen.getByRole('dialog', { name: en['maintenance.checkpoint'] }))
    .getByRole('link', { name: `${en.inspectTeam}: team` }) as HTMLAnchorElement
  fireEvent.click(link)
  expect(h.methods.navigateApplication).toHaveBeenCalledExactlyOnceWith(link.href)
  expect(h.view.getSnapshot().maintenance).toBeUndefined()
})

it('starts an external retry from the exact inspected operation and preserves its attempt fence', () => {
  const h = fixture('?workspace=simulation&simulation=run&simulationModule=operations&simulationObject=operation')
  const runId = 'run' as never, operationId = 'operation' as never
  h.state.set({ ...h.state.getSnapshot(), object: { loading: false, stale: false,
    value: { runId, snapshotRevision: 3, observedAt: 1, status: 'found',
      selection: { collection: 'operations', id: operationId, section: 'execution' },
      value: { collection: 'operations', section: 'execution', id: operationId, dependencies: [],
        summary: { id: operationId, entityId: 'entity' as never, decisionId: 'decision' as never, index: 0,
          kind: { text: 'communication/post', truncated: false }, status: 'outcome-unknown',
          publication: 'pending', delivery: 'pending', task: 'not-applicable' },
        retry: { allowed: true, reason: 'ready', expectedAttemptCount: 2, maxAttempts: 3 } } } } })
  render(<Workspace {...h.props} />)
  fireEvent.click(within(screen.getByRole('complementary', { name: en.view }))
    .getByRole('button', { name: en['operationRetry.title'] }))
  const target = { runId, operationId }
  const key = operationRetryDraftKey(target)
  expect(h.view.getSnapshot().operationRetryDrafts[key]).toMatchObject({ expectedAttemptCount: 2, reason: '' })
  expect(h.view.getSnapshot().operationRetryTarget).toEqual(target)
  expect(screen.getByRole('dialog', { name: en['operationRetry.title'] })).toBeTruthy()
})

it('remembers directory scrolling without borrowing a collection scroll position', () => {
  const h = fixture()
  render(<Workspace {...h.props} />)
  const page = screen.getByRole('main')
  page.scrollTop = 29
  fireEvent.scroll(page)
  expect(h.view.getSnapshot().directoryScroll).toBe(29)
  act(() => { h.view.actions.restore({ runId: 'run', module: 'operations', search: '' }) })
  page.scrollTop = 40
  fireEvent.scroll(page)
  expect(h.view.getSnapshot().collectionScroll).toBe(0)
})

it('shows a cognition-only run without offering automatic task controls', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  const runId = 'run' as never
  const run: SimulationProductRunInspection = { run: { id: runId,
    name: { text: 'Cognition run', truncated: false }, registeredAt: 1, observation: 'not-observed' },
  status: 'missing', operational: { status: 'observed', observedAt: 1, owner: 'held', driver: 'idle', inFlight: false,
    scenario: { status: 'observed', templateId: { text: 'Company', truncated: false }, version: '1',
      driverVersion: '1', execution: 'cognition-only' } } }
  h.state.set({ ...h.state.getSnapshot(), run: { loading: false, stale: false,
    scope: JSON.stringify(['run', runId]), value: run } })
  render(<Workspace {...h.props} />)
  expect(screen.getByText(en.cognitionOnly)).toBeTruthy()
  expect(screen.queryByRole('region', { name: en['taskControl.title'] })).toBeNull()
  expect(screen.queryByRole('region', { name: en['reviews.title'] })).toBeNull()
})

it('labels an exact entity from its inspected summary and falls back to the loaded row when detail leaves', () => {
  const h = fixture('?workspace=simulation&simulation=run&simulationModule=entities&simulationObject=entity')
  const runId = 'run' as never, id = 'entity' as never
  const row = { id, name: { text: 'Listed buyer', truncated: false }, kind: { text: 'buyer', truncated: false },
    cognition: 'agent' as const, phase: 'active' as const, writer: 'released' as const }
  const collection = collectionInput({ runId, module: 'entities', search: '', objectId: id }, 2)
  const scope = JSON.stringify(Object.entries(collection).filter(([key]) => key !== 'limit')
    .sort(([a], [b]) => a.localeCompare(b)))
  h.state.set({ ...h.state.getSnapshot(), collection: { loading: false, stale: false, scope,
    value: { runId, collection: 'entities', snapshotRevision: 2, observedAt: 1, total: 1, items: [row] } },
  object: { loading: false, stale: false, value: { runId, snapshotRevision: 2, observedAt: 1,
    status: 'found', selection: { collection: 'entities', id, section: 'identity' },
    value: { collection: 'entities', section: 'identity', id, summary: { ...row,
      name: { text: 'Inspected buyer', truncated: false } }, revision: 2, profileRevision: 1 } } } })
  render(<Workspace {...h.props} />)
  expect(screen.getByRole('heading', { name: 'Inspected buyer' })).toBeTruthy()
  act(() => { h.state.set({ ...h.state.getSnapshot(), object: { loading: false, stale: false } }) })
  expect(screen.getByRole('heading', { name: 'Listed buyer' })).toBeTruthy()
})

it('reads selected decision context only after this run publishes its policy observation', () => {
  const h = fixture('?workspace=simulation&simulation=run&simulationModule=decisions&simulationObject=decision&simulationSection=context')
  render(<Workspace {...h.props} />)
  expect(h.methods.inspectObject).not.toHaveBeenCalled()
  const observation = { runId: 'run' as never, readVersion: 'policy' as never, cursor: 'watch' as never,
    status: 'changed' as const, observedAt: 1, world: { status: 'observed' as const, revision: 2 } }
  act(() => { h.state.set({ ...h.state.getSnapshot(), observation: { loading: false, stale: false, value: observation } }) })
  expect(h.methods.inspectObject).toHaveBeenCalledWith({ runId: 'run', collection: 'decisions', id: 'decision',
    section: 'context', limit: 2 })
})

it('surfaces a conflicting request observation on its observed run without reassigning the original command', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  const command: SimulationCommand = { kind: 'prepare', input: { runId: 'original-run' as never,
    commandId: 'original-command' as never } }
  h.administration.set({ connected: true, authorizationVersion: 1, commands: {
    [simulationCommandKey(command)]: { command, pending: false, unknown: false, notFound: false,
      requestObservation: { runId: 'run' as never, status: 'accepted', journalRevision: 2,
        comparison: 'conflict', stale: false } },
  } })
  render(<Workspace {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: h.props.t('needsYou.requests', { count: 1 }) }))
  expect(h.view.getSnapshot().module).toBe('requests')
  expect(screen.getByText('original-command')).toBeTruthy()
  expect(h.methods.retain).not.toHaveBeenCalled()
})

it('protects a retained limits-only creation edit and releases unload protection after clearing it', () => {
  const h = fixture()
  render(<Workspace {...h.props} />)
  act(() => { h.view.actions.creation({ templateId: '', name: '', buyerName: '', supplierName: '',
    initialStock: '', limits: { maxTime: '10' } }) })
  const pending = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(pending)
  expect(pending.defaultPrevented).toBe(true)
  act(() => { h.view.actions.creation(undefined) })
  const cleared = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(cleared)
  expect(cleared.defaultPrevented).toBe(false)
})

it('does not import another product domain route into a retained Simulation workspace', () => {
  const h = fixture('?workspace=simulation&simulation=run')
  render(<Workspace {...h.props} />)
  window.history.replaceState(null, '', '?workspace=team&team=other')
  act(() => { window.dispatchEvent(new Event(WORKSPACE_NAVIGATION_EVENT)) })
  expect(h.view.getSnapshot().runId).toBe('run')
  expect(h.methods.inspect).toHaveBeenCalledWith('run')
})

it('shows only the decision knowledge result for the exact selected reference and revision', () => {
  const h = fixture('?workspace=simulation&simulation=run&simulationModule=decisions&simulationObject=decision&simulationSection=knowledge&simulationKnowledge=knowledge&simulationKnowledgeRevision=1')
  const runId = 'run' as never, id = 'decision' as never
  const selection = { collection: 'decisions' as const, id, section: 'knowledge' as const,
    reference: { id: 'knowledge' as never, revision: 1 } }
  const value = { runId, snapshotRevision: 3, observedAt: 1, status: 'missing' as const, selection }
  h.state.set({ ...h.state.getSnapshot(), object: { value, loading: false, stale: false },
    observation: { loading: false, stale: false, value: { runId, readVersion: 'policy' as never,
      cursor: 'watch' as never, status: 'changed', observedAt: 1, world: { status: 'observed', revision: 3 } } } })
  render(<Workspace {...h.props} />)
  expect(screen.getByText(en.detailMissing)).toBeTruthy()
  for (const reference of [{ id: 'another' as never, revision: 1 }, { id: 'knowledge' as never, revision: 2 }]) {
    act(() => { h.state.set({ ...h.state.getSnapshot(), object: { value: { ...value,
      selection: { ...selection, reference } }, loading: false, stale: false } }) })
    expect(screen.queryByText(en.detailMissing)).toBeNull()
  }
})
