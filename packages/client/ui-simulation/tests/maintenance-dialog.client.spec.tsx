// @vitest-environment jsdom
/** Maintenance and input commands use Host hints, exact anchors and independently retained originals. */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MaintenanceDialog } from '../src/client/MaintenanceDialog.tsx'
import { createSimulationStore, EMPTY_INPUT } from '../src/client/store.ts'
import type { SimulationInputDraft } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import { simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import type { SimulationProductControl, SimulationCommand, SimulationCommandState, SimulationProductObjectInspection } from '@clocky/clocky-client-runtime/client'

afterEach(cleanup)
const t = (key: Key) => en[key]
const control: SimulationProductControl = { runId: 'run' as never, owner: 'held', phase: 'paused', revision: 10,
  driver: 'idle', inFlight: false, observedAt: 1, actions: { start: { allowed: true, reason: 'ready' }, pause: { allowed: true, reason: 'ready' } },
  budget: { model: { provider: 'company', name: 'scripted' }, tokensPerRequest: 10000, tokensPerInterval: 1000000,
    interval: '100' as never, residentActors: 2, sharedModelLimit: 1 },
  administration: { actions: { checkpoint: { allowed: true, reason: 'ready' }, restore: { allowed: true, reason: 'ready' },
    prepare: { allowed: true, reason: 'ready' }, ingress: { allowed: true, reason: 'ready' } },
  ingress: { maxTime: '10000000000000000000' as never, maxBytes: 65536, targets: [{ id: 'buyer' as never, name: { text: 'Buyer', truncated: false } }] },
  recovery: { checkpointId: 'full' as never, publishedAt: 100, time: '5' as never, revision: 7,
    references: { runs: 1, teams: 1, channels: 1, sessions: 2 } } } }
const references: SimulationProductObjectInspection = { runId: 'run' as never, selection: { collection: 'checkpoints', id: 'full' as never,
  section: 'references' }, status: 'found', snapshotRevision: 10, observedAt: 1,
value: { collection: 'checkpoints', section: 'references', id: 'full' as never,
  summary: { id: 'full' as never, status: 'completed', startedSequence: 1, finishedSequence: 2, publishedAt: 100,
    latestSuccessful: true, sourceValidation: 'not-performed' },
  references: { items: [{ kind: 'run', cursor: 7 }], total: 5, nextCursor: 'next' as never } } }
const base = () => ({ name: 'Company', control: { value: control, loading: false, stale: false }, connected: true,
  authorizationVersion: 1, recovery: { loading: false, stale: false }, readRecovery: vi.fn(async () => {}), closeRecovery: vi.fn(),
  pageSize: 2, commands: {}, input: vi.fn(), close: vi.fn(), retain: vi.fn((_command: SimulationCommand, _version: number) => 'key' as never),
  submit: vi.fn(async () => undefined), query: vi.fn(async () => undefined), t, date: (value: number) => String(value) })

it('requires loaded exact recovery references and confirms publication/current revisions without rollback', async () => {
  const props = base()
  const target = { runId: control.runId, kind: 'restore' as const }
  const view = render(<MaintenanceDialog {...props} target={target} />)
  await waitFor(() => { expect(props.readRecovery).toHaveBeenCalledWith({ runId: 'run', collection: 'checkpoints', id: 'full', section: 'references', limit: 2 }) })
  expect((view.getByRole('button', { name: 'Verify and recover run' }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.getByText(en['maintenanceNotice.restore'])).toBeDefined()
  view.rerender(<MaintenanceDialog {...props} target={target} recovery={{ value: references, loading: false, stale: false }} />)
  expect(view.getByText('100')).toBeDefined(); expect(view.getByText('10')).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: en.first }))
  expect(props.readRecovery).toHaveBeenLastCalledWith({ runId: 'run', collection: 'checkpoints', id: 'full', section: 'references', limit: 2 })
  fireEvent.click(view.getByRole('button', { name: 'Next page' }))
  expect(props.readRecovery).toHaveBeenLastCalledWith({ runId: 'run', collection: 'checkpoints', id: 'full', section: 'references', limit: 2, cursor: 'next' })
  fireEvent.click(view.getByRole('button', { name: 'Verify and recover run' }))
  await waitFor(() => { expect(props.submit).toHaveBeenCalledTimes(1) })
  const original = props.retain.mock.calls[0]?.[0]
  if (original === undefined) throw new Error('Recovery was not retained')
  expect(props.submit).toHaveBeenCalledWith(simulationCommandKey(original))
  expect(props.retain.mock.calls[0]?.[0]).toMatchObject({ kind: 'restore', input: { runId: 'run', checkpointId: 'full' } })
  expect(props.retain.mock.calls[0]?.[1]).toBe(1)
})

it('validates entity and canonical exact tick, protects IME, and retains raw later edits with original retries', async () => {
  const props = base()
  let original: SimulationCommand | undefined
  const sent: SimulationCommand[] = []
  function Harness() {
    const [draft, input] = useState<SimulationInputDraft>(EMPTY_INPUT)
    const [commands, change] = useState<Record<string, SimulationCommandState>>({})
    return <MaintenanceDialog {...props} target={{ runId: control.runId, kind: 'ingress' }} draft={draft}
      input={(next) => { input(next ?? EMPTY_INPUT) }} commands={commands}
      retain={(command) => { original = command; return 'key' as never }} submit={async () => {
        if (original === undefined) throw new Error('Original input missing')
        sent.push(original)
        const value = { command: original, unknown: true, pending: false, notFound: false, error: 'network' as const }
        change({ [draft.commandKey ?? 'key']: value }); return value
      }} />
  }
  const view = render(<Harness />)
  fireEvent.click(view.getByRole('button', { name: 'Input event' }))
  expect(view.getByText(en.inputTargetRequired)).toBeDefined()
  fireEvent.click(view.getByRole('radio'))
  fireEvent.change(view.getByLabelText('Authorized input text'), { target: { value: 'Original private input' } })
  fireEvent.change(view.getByLabelText('Earliest simulation tick'), { target: { value: '9007199254740993' } })
  fireEvent.compositionStart(view.getByLabelText('Authorized input text'))
  fireEvent.click(view.getByRole('button', { name: 'Input event' }))
  expect(sent).toEqual([])
  fireEvent.compositionEnd(view.getByLabelText('Authorized input text'))
  fireEvent.click(view.getByRole('button', { name: 'Input event' }))
  await view.findByText(en['commandError.network'])
  if (original === undefined) throw new Error('Original input was not retained')
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  expect(props.query).toHaveBeenCalledWith(simulationCommandKey(original))
  fireEvent.change(view.getByLabelText('Authorized input text'), { target: { value: 'Later private input' } })
  fireEvent.click(view.getByRole('button', { name: 'Retry original operation' }))
  await waitFor(() => { expect(sent).toHaveLength(2) })
  expect(sent[0]).toBe(sent[1]); expect(sent[0]).toMatchObject({ kind: 'ingress', input: { entityId: 'buyer',
    text: 'Original private input', availableAt: '9007199254740993' } })
  expect((view.getByLabelText('Authorized input text') as HTMLTextAreaElement).value).toBe('Later private input')
})

it('keeps quota-rejected and per-run drafts, purges them on authority change and does not store private bodies in URLs', () => {
  const store = createSimulationStore(1024, 1).create()
  store.actions.authorization(1)
  const input = { entityId: 'buyer', text: 'Sensitive draft', availableAt: '1' }
  store.actions.input('run' as never, input)
  store.actions.maintenance({ runId: 'run' as never, kind: 'ingress' })
  store.actions.maintenance(undefined)
  expect(store.store.getSnapshot().inputDrafts.run).toEqual(input)
  expect(() => { store.actions.input('other' as never, input) }).toThrow('capacity')
  expect(() => { store.actions.input('run' as never, { ...input, text: '汉字'.repeat(1000) }) }).toThrow('capacity')
  expect(store.store.getSnapshot().inputDrafts.run).toEqual(input)
  expect(window.location.search).not.toContain(input.text)
  store.actions.authorization(1); expect(store.store.getSnapshot().inputDrafts.run).toEqual(input)
  store.actions.authorization(2); expect(store.store.getSnapshot().inputDrafts).toEqual({})
})

it.each(['checkpoint', 'prepare'] as const)('retains and submits an exact %s command with Host admission', async (kind) => {
  const props = base()
  const view = render(<MaintenanceDialog {...props} target={{ runId: control.runId, kind }} />)
  fireEvent.click(view.getByRole('button', { name: en[`maintenance.${kind}`] }))
  await waitFor(() => { expect(props.submit).toHaveBeenCalledTimes(1) })
  const original = props.retain.mock.calls[0]?.[0]
  if (original === undefined) throw new Error('Command was not retained')
  expect(original).toMatchObject({ kind, input: { runId: 'run' } })
  expect(props.submit).toHaveBeenCalledWith(simulationCommandKey(original))
  expect(props.retain.mock.calls[0]?.[1]).toBe(1)
})

it('reports command capacity failures and clears the selected original for another admission', async () => {
  const props = base()
  props.retain = vi.fn(() => { throw new Error('No command capacity') })
  const view = render(<MaintenanceDialog {...props} target={{ runId: control.runId, kind: 'prepare' }} />)
  fireEvent.click(view.getByRole('button', { name: en['maintenance.prepare'] }))
  await view.findByText(en.commandCapacity)
  expect(props.submit).not.toHaveBeenCalled()
})

it('closes an unchanged received ingress draft while preserving later unrelated edits', async () => {
  const props = base()
  const received: SimulationCommandState = { command: { kind: 'ingress', input: { runId: 'run' as never,
    ingressId: 'ingress' as never, entityId: 'buyer' as never, text: 'Original input', availableAt: '1' as never } },
  pending: false, unknown: false, notFound: false,
  receipt: { kind: 'ingress', value: { runId: 'run' as never, ingressId: 'ingress' as never,
    entityId: 'buyer' as never, eventId: 'event' as never, availableAt: '1' as never,
    assignedAt: '2' as never, sequence: 1, status: 'consumed', decisionId: 'decision' as never } } }
  const key = simulationCommandKey(received.command)
  let currentDraft: SimulationInputDraft = { ...EMPTY_INPUT, commandKey: key, entityId: 'buyer',
    text: 'Original input', availableAt: '1' }
  function Harness() {
    return <MaintenanceDialog {...props} target={{ runId: control.runId, kind: 'ingress' }} draft={currentDraft}
      commands={{ [key]: received }} input={(next) => { if (next !== undefined) currentDraft = next; props.input(next) }}
      retain={() => key} />
  }
  const view = render(<Harness />)
  fireEvent.click(view.getByRole('button', { name: en.inputReceivedClose }))
  expect(props.input).toHaveBeenCalledWith(undefined)
  expect(props.close).toHaveBeenCalledOnce()
  props.input.mockClear(); props.close.mockClear()
  currentDraft = { ...currentDraft, text: 'Later private edit' }
  view.rerender(<Harness />)
  fireEvent.click(view.getByRole('button', { name: en.inputReceivedClose }))
  expect(props.input).toHaveBeenCalledWith({ ...currentDraft, commandKey: undefined })
  expect(props.close).toHaveBeenCalledOnce()
})

it('retains an unresolved ingress original while discarding only its editable fields', () => {
  const props = base()
  const command: SimulationCommand = { kind: 'ingress', input: { runId: control.runId,
    ingressId: 'ingress' as never, entityId: 'buyer' as never, text: 'Original', availableAt: '1' as never } }
  const key = simulationCommandKey(command)
  const draft: SimulationInputDraft = { ...EMPTY_INPUT, commandKey: key, entityId: 'buyer',
    text: 'Later private edit', availableAt: '1' }
  const view = render(<MaintenanceDialog {...props} target={{ runId: control.runId, kind: 'ingress' }}
    draft={draft} commands={{ [key]: { command, pending: false, unknown: true, notFound: false } }} />)
  fireEvent.click(view.getByRole('button', { name: en.discardDraft }))
  fireEvent.click(view.getAllByRole('button', { name: en.discardDraft }).at(-1)!)
  expect(props.input).toHaveBeenCalledExactlyOnceWith({ ...EMPTY_INPUT, commandKey: key })
  expect(props.close).toHaveBeenCalledOnce()
})

it('shows denied maintenance and read errors without offering a new operation', () => {
  const props = base()
  const denied: SimulationProductControl = { ...control, administration: { ...control.administration,
    actions: { ...control.administration.actions, prepare: { allowed: false, reason: 'recovery-required' } } } }
  const view = render(<MaintenanceDialog {...props} target={{ runId: control.runId, kind: 'prepare' }}
    control={{ value: denied, loading: false, stale: false, error: 'forbidden' }} />)
  expect(view.getByText(en['maintenanceReason.recovery-required'])).toBeTruthy()
  expect(view.getByRole('alert').textContent).toBe(en.noControlAccess)
  expect(view.getByRole('button', { name: en['maintenance.prepare'] }).hasAttribute('disabled')).toBe(true)
  view.rerender(<MaintenanceDialog {...props} target={{ runId: control.runId, kind: 'ingress' }}
    control={{ loading: false, stale: false, error: 'network' }} />)
  expect(view.getByRole('alert').textContent).toBe(en.network)
  expect(view.getByText(`${en.inputHorizon}: ${en.unavailable}`)).toBeTruthy()
})

it('shows loading, failed and stale recovery references while preserving the published anchor', () => {
  const props = base()
  const target = { runId: control.runId, kind: 'restore' as const }
  const view = render(<MaintenanceDialog {...props} target={target}
    recovery={{ loading: true, stale: false }} />)
  expect(view.getByRole('status').textContent).toBe(en.loading)
  view.rerender(<MaintenanceDialog {...props} target={target}
    recovery={{ loading: false, stale: true, error: 'network', value: references }} />)
  expect(view.getByText(en.stale)).toBeTruthy()
  expect(view.getByRole('alert').textContent).toBe(en.network)
  expect(view.getByText('run:')).toBeTruthy()
  expect(view.getByRole('button', { name: en.next }).hasAttribute('disabled')).toBe(true)
  if (references.value?.collection !== 'checkpoints' || references.value.section !== 'references') {
    throw new Error('Recovery fixture has no checkpoint references')
  }
  const withTeam: SimulationProductObjectInspection = { ...references,
    value: { ...references.value, references: { ...references.value.references,
      items: [{ kind: 'team', id: 'retained-team' as never, cursor: 8 }] } } }
  view.rerender(<MaintenanceDialog {...props} target={target}
    recovery={{ loading: false, stale: false, value: withTeam }} />)
  expect(view.getByText('retained-team')).toBeTruthy()
})

it('keeps exact ingress input when draft storage refuses the original selector', async () => {
  const props = base()
  const draft: SimulationInputDraft = { ...EMPTY_INPUT, entityId: 'buyer', text: 'Retained private input', availableAt: '1' }
  const input = vi.fn((next?: SimulationInputDraft) => {
    if (next?.commandKey !== undefined) throw new Error('Draft quota reached')
  })
  const view = render(<MaintenanceDialog {...props} target={{ runId: control.runId, kind: 'ingress' }}
    draft={draft} input={input} />)
  fireEvent.click(view.getByRole('button', { name: en['maintenance.ingress'] }))
  expect(view.getByRole('alert').textContent).toBe(en.draftCapacity)
  expect(props.retain).not.toHaveBeenCalled()
  expect(props.submit).not.toHaveBeenCalled()
  expect((view.getByLabelText(en.inputText) as HTMLTextAreaElement).value).toBe(draft.text)
})

it('clears only the failed ingress command selector after command admission is refused', async () => {
  const props = base()
  const draft: SimulationInputDraft = { ...EMPTY_INPUT, entityId: 'buyer', text: 'Private input', availableAt: '1' }
  const input = vi.fn<(next?: SimulationInputDraft) => void>()
  const retain = vi.fn(() => { throw new Error('No command capacity') })
  const view = render(<MaintenanceDialog {...props} target={{ runId: control.runId, kind: 'ingress' }}
    draft={draft} input={input} retain={retain} />)
  fireEvent.click(view.getByRole('button', { name: en['maintenance.ingress'] }))
  await view.findByText(en.commandCapacity)
  expect(retain).toHaveBeenCalledOnce()
  expect(input.mock.calls[0]?.[0]?.text).toBe(draft.text)
  expect(typeof input.mock.calls[0]?.[0]?.commandKey).toBe('string')
  expect(input).toHaveBeenLastCalledWith({ ...draft, commandKey: undefined })
  expect(props.submit).not.toHaveBeenCalled()
})

it('keeps or discards only the editable ingress draft through explicit confirmation', () => {
  const props = base()
  const draft: SimulationInputDraft = { ...EMPTY_INPUT, entityId: 'buyer', text: 'Private input', availableAt: '1' }
  const view = render(<MaintenanceDialog {...props} target={{ runId: control.runId, kind: 'ingress' }}
    draft={draft} />)
  fireEvent.click(view.getByRole('button', { name: en.discardDraft }))
  expect(view.getByRole('dialog', { name: en.discardDraft })).toBeTruthy()
  fireEvent.click(view.getAllByRole('button', { name: en.keepEditing })[0]!)
  expect(view.queryByRole('dialog', { name: en.discardDraft })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en.discardDraft }))
  fireEvent.click(view.getAllByRole('button', { name: en.keepEditing }).at(-1)!)
  expect(view.queryByRole('dialog', { name: en.discardDraft })).toBeNull()
  expect(props.input).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en.discardDraft }))
  fireEvent.click(view.getAllByRole('button', { name: en.discardDraft }).at(-1)!)
  expect(props.input).toHaveBeenCalledExactlyOnceWith(undefined)
  expect(props.close).toHaveBeenCalledOnce()
})
