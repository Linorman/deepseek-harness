// @vitest-environment jsdom
/** Creation input and scheduling intent remain separate from authoritative receipts and observed permissions. */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { CreationDialog } from '../src/client/CreationDialog.tsx'
import { Controls } from '../src/client/Controls.tsx'
import { CommandRecord } from '../src/client/CommandRecord.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import { EMPTY_CREATION } from '../src/client/store.ts'
import type { SimulationCreationDraft } from '../src/client/store.ts'
import type { SimulationProductCatalog, SimulationProductControl, SimulationCommand, SimulationCommandState } from '@clocky/clocky-client-runtime/client'

afterEach(cleanup)
const t = (key: Key) => en[key]
const catalog: SimulationProductCatalog = { items: [{ id: 'company' as never, version: '1', name: { text: 'Installed company', truncated: false },
  kind: 'company-procurement', model: { provider: 'company', name: 'scripted' }, tickUnit: { text: 'minute', truncated: false },
  execution: 'cognition-only', review: 'none', maxStock: '10000000000000000000' }] }
const control: SimulationProductControl = { administration: { actions: { checkpoint: { allowed: true, reason: 'ready' }, restore: { allowed: false, reason: 'checkpoint-required' },
  prepare: { allowed: true, reason: 'ready' }, ingress: { allowed: true, reason: 'ready' } },
ingress: { maxTime: '1000' as never, maxBytes: 65536, targets: [{ id: 'buyer' as never, name: { text: 'Buyer', truncated: false } }] } }, runId: 'run' as never, owner: 'held', phase: 'paused', revision: 1, driver: 'idle', inFlight: false,
observedAt: 1, budget: { model: { provider: 'company', name: 'scripted' }, tokensPerRequest: 10000, tokensPerInterval: 1000000,
  interval: '9007199254740993' as never, residentActors: 2, sharedModelLimit: 1 },
actions: { start: { allowed: true, reason: 'ready' }, pause: { allowed: true, reason: 'ready' } } }
const raw: SimulationCreationDraft = { templateId: 'company', name: 'First company', buyerName: 'Buyer', supplierName: 'Supplier',
  initialStock: '9007199254740993' }

const preflightProps = {
  validation: { loading: false, stale: false }, closePreflight: () => {},
  preflight: async () => ({ loading: false, stale: false, value: { status: 'ready' as const,
    configuration: { limits: { maxEntities: 2, maxResidentActors: 2, tokensPerModelRequest: 10000,
      maxTokensPerInterval: 1000000, maxTime: '1000' }, budgetInterval: '100', sharedModelLimit: 1,
    tickUnit: { text: 'tick', truncated: false }, rulesVersion: { text: '1', truncated: false }, policyVersion: { text: '1', truncated: false } } } }),
}

it('retains one start confirmation while compact header observations update', () => {
  const props = { name: 'Company', connected: true, authorizationVersion: 1, blockedPhases: [], blockedMaintenance: [],
    openMaintenance: vi.fn(), retain: vi.fn(() => 'key' as never), submit: vi.fn(async () => undefined),
    refresh: vi.fn(async () => {}), t }
  const view = render(<Controls compact {...props} value={{ value: control, loading: false, stale: false }} />)
  expect(view.getAllByRole('button', { name: en.pauseScheduling })).toHaveLength(1)
  fireEvent.click(view.getByRole('button', { name: en.start }))
  expect(view.getAllByRole('dialog', { name: en.start })).toHaveLength(1)
  view.rerender(<Controls compact {...props} value={{ value: { ...control, inFlight: true }, loading: true, stale: false }} />)
  expect(view.getAllByRole('dialog', { name: en.start })).toHaveLength(1)
  expect(view.getByText(en.inFlight)).toBeDefined()
  expect(props.retain).not.toHaveBeenCalled()
})

it.each([en, zh])('displays the exact installed template task mode without creating or starting a run', (locale) => {
  const retain = vi.fn(() => 'key' as never), submit = vi.fn(async () => undefined)
  const base = { connected: true, authorizationVersion: 1, maxDraftBytes: 65536, draft: raw,
    change: vi.fn(), close: vi.fn(), openRun: vi.fn(), refreshCatalog: vi.fn(async () => {}), retain, submit,
    query: vi.fn(async () => undefined), t: (key: Key) => locale[key] }
  const view = render(<CreationDialog {...preflightProps} {...base} catalog={{ value: catalog, loading: false, stale: false }} />)
  expect(view.getByText(locale.cognitionOnly)).toBeDefined()
  const automatic: SimulationProductCatalog = { items: [{ ...catalog.items[0]!, execution: 'automatic-tasks' }] }
  view.rerender(<CreationDialog {...preflightProps} {...base} catalog={{ value: automatic, loading: false, stale: false }} />)
  expect(view.getByText(locale.automaticTasks)).toBeDefined()
  expect(view.queryByText(locale.cognitionOnly)).toBeNull()
  expect(retain).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled()
})

it('keeps later input across close/reopen and retries the exact original while its response is unknown', async () => {
  let original: SimulationCommand | undefined
  const retained = vi.fn((command: SimulationCommand, _version: number) => { original = command; return 'original-key' as never })
  const sends: SimulationCommand[] = []
  const opened = vi.fn()
  function Harness() {
    const [draft, change] = useState<SimulationCreationDraft | undefined>(raw)
    const [record, update] = useState<SimulationCommandState>()
    const [open, setOpen] = useState(true)
    const submit = async () => {
      if (original === undefined) throw new Error('No retained input')
      sends.push(original)
      const next: SimulationCommandState = { command: original, pending: false, unknown: true, notFound: false, error: 'network' }
      update(next); return next
    }
    const query = async () => {
      if (original === undefined) throw new Error('No retained input')
      const next: SimulationCommandState = { command: original, pending: false, unknown: false, notFound: false,
        receipt: { kind: 'request', value: { commandId: 'original' as never, runId: 'run' as never, kind: 'create', acceptedAt: 1, status: 'completed' } } }
      update(next); return next
    }
    return <><button onClick={() => { setOpen(true) }}>Reopen</button>{open && <CreationDialog {...preflightProps}
      draft={draft} command={record}
      catalog={{ value: catalog, loading: false, stale: false }} connected authorizationVersion={3} maxDraftBytes={65536}
      change={change} close={() => { setOpen(false) }} openRun={opened} refreshCatalog={async () => {}}
      retain={retained} submit={submit} query={query} t={t} />}</>
  }
  const view = render(<Harness />)
  fireEvent.click(view.getByRole('button', { name: 'Create paused run' }))
  await view.findByText(en['commandError.network'])
  expect(retained.mock.calls[0]?.[0]).toMatchObject({ kind: 'create', input: { name: raw.name,
    parameters: { initialStock: '9007199254740993' } } })
  expect(retained.mock.calls[0]?.[1]).toBe(3)
  fireEvent.change(view.getByLabelText('Run name'), { target: { value: 'Later input' } })
  fireEvent.click(view.getAllByRole('button', { name: 'Close and keep input' }).at(-1)!)
  fireEvent.click(view.getByRole('button', { name: 'Reopen' }))
  expect((view.getByLabelText('Run name') as HTMLInputElement).value).toBe('Later input')
  fireEvent.click(view.getByRole('button', { name: 'Retry original operation' }))
  await waitFor(() => { expect(sends).toHaveLength(2) })
  expect(sends[1]).toBe(sends[0]); expect(retained).toHaveBeenCalledTimes(1)
  fireEvent.click(view.getByRole('button', { name: 'Query original result' }))
  await view.findByRole('button', { name: 'Open registered run' })
  fireEvent.click(view.getByRole('button', { name: 'Open registered run' }))
  expect(opened).toHaveBeenCalledWith('run')
  expect((view.getByLabelText('Run name') as HTMLInputElement).value).toBe('Later input')
})

it('associates field errors, blocks IME submits and refuses draft-capacity excess before retaining an operation', async () => {
  const retain = vi.fn(() => 'key' as never)
  const submit = vi.fn(async () => undefined)
  const change = vi.fn()
  const base = { catalog: { value: catalog, loading: false, stale: false }, connected: true, authorizationVersion: 1,
    maxDraftBytes: 65536, change, close: vi.fn(), openRun: vi.fn(), refreshCatalog: vi.fn(async () => {}), retain, submit,
    query: vi.fn(async () => undefined), t }
  const view = render(<CreationDialog {...preflightProps} {...base} draft={{ ...raw, name: '' }} />)
  fireEvent.click(view.getByRole('button', { name: 'Create paused run' }))
  expect(view.getByLabelText('Run name').getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(view.getByLabelText('Run name'))
  expect(retain).not.toHaveBeenCalled()
  view.rerender(<CreationDialog {...preflightProps} {...base} draft={raw} />)
  fireEvent.compositionStart(view.getByLabelText('Run name'))
  const form = view.getByLabelText('Run name').closest('form')
  if (form === null) throw new Error('Creation input has no form')
  fireEvent.submit(form)
  expect(retain).not.toHaveBeenCalled()
  fireEvent.compositionEnd(view.getByLabelText('Run name'))
  view.rerender(<CreationDialog {...preflightProps} {...base} draft={raw} maxDraftBytes={1} />)
  fireEvent.click(view.getByRole('button', { name: 'Create paused run' }))
  await view.findByText(en.draftCapacity)
  expect(retain).not.toHaveBeenCalled()
  expect(change).not.toHaveBeenCalled()
})

it('retains an unresolved original selector when explicitly discarding its editable input', () => {
  const command: SimulationCommand = { kind: 'create', input: { commandId: 'original' as never, templateId: 'company' as never,
    templateVersion: '1', name: raw.name, parameters: { buyerName: raw.buyerName, supplierName: raw.supplierName, initialStock: raw.initialStock } } }
  const change = vi.fn()
  const view = render(<CreationDialog {...preflightProps} draft={{ ...raw, commandKey: 'key' as never }} command={{ command, pending: false, unknown: true, notFound: true }}
    catalog={{ value: catalog, loading: false, stale: false }} connected authorizationVersion={1} maxDraftBytes={65536}
    change={change} close={vi.fn()} openRun={vi.fn()} refreshCatalog={async () => {}} retain={() => 'key' as never}
    submit={async () => undefined} query={async () => undefined} t={t} />)
  fireEvent.click(view.getByRole('button', { name: 'Discard input' }))
  const discard = view.getAllByRole('button', { name: 'Discard input' }).at(-1)
  if (discard === undefined) throw new Error('No explicit discard confirmation')
  fireEvent.click(discard)
  expect(change).toHaveBeenCalledWith({ ...EMPTY_CREATION, commandKey: 'key' as never })
})

it('requires explicit start confirmation with exact budget time and permits a separate pause while a start outcome is unresolved', async () => {
  const retain = vi.fn((_command: SimulationCommand, _version: number) => 'original' as never)
  const submit = vi.fn(async () => undefined)
  const refresh = vi.fn(async () => {})
  const props = { name: 'Company', value: { value: control, loading: false, stale: false }, connected: true,
    authorizationVersion: 1, blockedPhases: [], blockedMaintenance: [], openMaintenance: vi.fn(), retain, submit, refresh, t }
  const view = render(<Controls {...props} />)
  fireEvent.click(view.getByRole('button', { name: 'Start scheduling' }))
  expect(view.getByText('1000000 / 9007199254740993 simulation ticks')).toBeDefined()
  expect(retain).not.toHaveBeenCalled()
  fireEvent.click(view.getAllByRole('button', { name: 'Cancel' }).at(-1)!)
  view.rerender(<Controls {...props} blockedPhases={['running']} />)
  expect((view.getByRole('button', { name: 'Start scheduling' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Pause scheduling' }))
  await waitFor(() => { expect(submit).toHaveBeenCalledWith('original') })
  expect(retain.mock.calls[0]?.[0]).toMatchObject({ kind: 'manage', input: { phase: 'paused' } })
  expect(retain.mock.calls[0]?.[1]).toBe(1)
})

it('follows denied or stale Host action hints and keeps terminal receipt distinct from scenario execution', () => {
  const retain = vi.fn(() => 'key' as never)
  const value = { ...control, inFlight: true, actions: { ...control.actions, start: { allowed: false, reason: 'recovery-required' as const } } }
  const view = render(<Controls name="Company" value={{ value, loading: false, stale: true }} connected authorizationVersion={1}
    blockedPhases={[]} blockedMaintenance={[]} openMaintenance={vi.fn()} retain={retain}
    submit={async () => undefined} refresh={async () => {}} t={t} />)
  expect((view.getByRole('button', { name: 'Start scheduling' }) as HTMLButtonElement).disabled).toBe(true)
  expect((view.getByRole('button', { name: 'Pause scheduling' }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.getByText(en.inFlight)).toBeDefined()
  expect(view.getByText(en['controlReason.recovery-required'])).toBeDefined()
  const command: SimulationCommand = { kind: 'manage', input: { runId: 'run' as never, managementId: 'original' as never, phase: 'running' } }
  view.rerender(<CommandRecord value={{ command, pending: false, unknown: false, notFound: false,
    receipt: { kind: 'management', value: { managementId: 'original' as never, phase: 'running', status: 'completed', startedSequence: 1, finishedSequence: 2 } } }}
  connected query={async () => undefined} retry={async () => undefined} t={t} />)
  expect(view.getByText('Original receipt: Request completed')).toBeDefined()
  expect(view.queryByText('Scenario completed')).toBeNull()
  expect(view.queryByRole('button', { name: 'Retry original operation' })).toBeNull()
})

it('labels continuation only from the Host execution-history hint and retains its budget confirmation', () => {
  const retain = vi.fn(), submit = vi.fn(async () => undefined)
  const progressed: SimulationProductControl = { ...control, administration: { ...control.administration,
    actions: { ...control.administration.actions, prepare: { allowed: false, reason: 'scenario-progressed' } } } }
  const view = render(<Controls name="Existing run" value={{ value: progressed, loading: false, stale: false }} connected
    authorizationVersion={1} blockedPhases={[]} blockedMaintenance={[]} openMaintenance={vi.fn()}
    retain={retain} submit={submit} refresh={vi.fn(async () => {})} t={t} />)
  expect(view.queryByRole('button', { name: en.start })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en.resumeScheduling }))
  expect(view.getByRole('dialog', { name: en.resumeScheduling })).toBeDefined()
  expect(view.getByText(en.startNotice)).toBeDefined()
  expect(retain).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
})

it('does not refresh an old run after a retained scheduling operation settles outside its view', async () => {
  const pending = Promise.withResolvers<undefined>()
  const refresh = vi.fn(async () => {})
  const submit = vi.fn(() => pending.promise)
  const view = render(<Controls name="Original run" value={{ value: control, loading: false, stale: false }} connected
    authorizationVersion={1} blockedPhases={[]} blockedMaintenance={[]} openMaintenance={vi.fn()}
    retain={vi.fn(() => 'original' as never)} submit={submit} refresh={refresh} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en.start }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en.start }))
  expect(submit).toHaveBeenCalledOnce()
  view.unmount()
  pending.resolve(undefined)
  await pending.promise
  expect(refresh).not.toHaveBeenCalled()
})
