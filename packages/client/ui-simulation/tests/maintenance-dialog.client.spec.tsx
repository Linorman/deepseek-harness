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
