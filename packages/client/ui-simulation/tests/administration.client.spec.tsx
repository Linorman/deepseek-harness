// @vitest-environment jsdom
/** Creation input and scheduling intent remain separate from authoritative receipts and observed permissions. */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
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
  kind: 'company-procurement', readiness: { status: 'ready', model: { provider: 'company', name: 'scripted' } }, tickUnit: { text: 'minute', truncated: false },
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
  renderSlot: () => null, returnFromModelSetup: () => {},
  release: () => true,
  validation: { loading: false, stale: false }, closePreflight: () => {},
  preflight: async () => ({ loading: false, stale: false, value: { status: 'ready' as const, readiness: { status: 'ready' as const, model: { provider: 'company', name: 'scripted' } },
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

it('keeps the pausing label and shows progress until the Host answers', async () => {
  let answer: (() => void) | undefined
  const props = { name: 'Company', connected: true, authorizationVersion: 1, blockedPhases: [], blockedMaintenance: [],
    openMaintenance: vi.fn(), retain: vi.fn(() => 'key' as never),
    submit: vi.fn(() => new Promise<undefined>((resolve) => { answer = () => { resolve(undefined) } })),
    refresh: vi.fn(async () => {}), t }
  const running = { ...control, phase: 'running' as const, actions: { start: { allowed: false, reason: 'ready' as const }, pause: { allowed: true, reason: 'ready' as const } } }
  const view = render(<Controls compact {...props} value={{ value: running, loading: false, stale: false }} />)
  const pause = view.getByRole('button', { name: en.pauseScheduling })
  fireEvent.click(pause)
  await waitFor(() => { expect(pause.getAttribute('aria-busy')).toBe('true') })
  expect(pause.textContent).toContain(en.pauseScheduling)
  await act(async () => { answer?.() })
  await waitFor(() => { expect(pause.getAttribute('aria-busy')).toBeNull() })
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
    templateVersion: '1', expectedModel: { provider: 'company', name: 'scripted' }, name: raw.name, parameters: { buyerName: raw.buyerName, supplierName: raw.supplierName, initialStock: raw.initialStock } } }
  const change = vi.fn()
  const view = render(<CreationDialog {...preflightProps} draft={{ ...raw, commandKey: 'key' as never }} command={{ command, pending: false, unknown: true, notFound: true }}
    catalog={{ value: catalog, loading: false, stale: false }} connected authorizationVersion={1} maxDraftBytes={65536}
    change={change} close={vi.fn()} openRun={vi.fn()} refreshCatalog={async () => {}} retain={() => 'key' as never}
    submit={async () => undefined} query={async () => undefined} t={t} />)
  // An unknown outcome wears the hatched unknown treatment and offers only query and exact retry.
  const record = view.getByRole('region', { name: en.originalCommand })
  expect(record.hasAttribute('data-outcome-unknown')).toBe(true)
  expect(within(record).getAllByRole('button').map(button => button.textContent)).toEqual([en.queryOriginal, en.retryOriginal])
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

it('lets the user refresh templates, change installed limits and explicitly keep or discard creation input', () => {
  const configured: SimulationProductCatalog = { items: [{ ...catalog.items[0]!, configuration: {
    limits: { maxEntities: 3, maxResidentActors: 2, tokensPerModelRequest: 10000,
      maxTokensPerInterval: 1000000, maxTime: '1000' }, budgetInterval: '100', sharedModelLimit: 1,
    tickUnit: { text: 'tick', truncated: false }, rulesVersion: { text: '1', truncated: false },
    policyVersion: { text: '1', truncated: false }, editable: ['maxEntities', 'maxTime'] } }] }
  const refreshCatalog = vi.fn(async () => {}), close = vi.fn()
  const change = vi.fn()
  function Harness() {
    const [draft, setDraft] = useState<SimulationCreationDraft | undefined>({ ...raw, templateId: '', limits: { maxEntities: '2' } })
    return <CreationDialog {...preflightProps} catalog={{ value: configured, loading: false, stale: false }}
      connected authorizationVersion={1} maxDraftBytes={65536} draft={draft}
      change={(next) => { change(next); setDraft(next) }} close={close} openRun={vi.fn()}
      refreshCatalog={refreshCatalog} retain={() => 'key' as never} submit={async () => undefined}
      query={async () => undefined} t={t} />
  }
  const view = render(<Harness />)
  fireEvent.click(view.getByRole('button', { name: en.refreshTemplates }))
  expect(refreshCatalog).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('radio', { name: /Installed company/ }))
  expect(change).toHaveBeenCalled()
  fireEvent.click(view.getByText(en.adjustLimits))
  const maxEntities = view.getByLabelText(en['limit.maxEntities'])
  fireEvent.change(maxEntities, { target: { value: '4' } })
  expect((maxEntities as HTMLInputElement).value).toBe('4')
  fireEvent.click(view.getByRole('button', { name: `${en.useInstalledDefault} · ${en['limit.maxEntities']}` }))
  expect((maxEntities as HTMLInputElement).value).toBe('')
  fireEvent.click(view.getByRole('button', { name: en.discardDraft }))
  fireEvent.click(view.getAllByRole('button', { name: en.keepEditing })[0]!)
  expect(view.queryByRole('dialog', { name: en.discardDraft })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en.discardDraft }))
  fireEvent.click(view.getAllByRole('button', { name: en.keepEditing }).at(-1)!)
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en.discardDraft }))
  fireEvent.click(view.getAllByRole('button', { name: en.discardDraft }).at(-1)!)
  expect(change).toHaveBeenLastCalledWith(undefined)
  expect(close).toHaveBeenCalledOnce()
})

it('rejects unselected templates, out-of-range stock and retained limits the new template cannot edit', () => {
  const configured: SimulationProductCatalog = { items: [{ ...catalog.items[0]!, configuration: {
    limits: { maxEntities: 3, maxResidentActors: 2, tokensPerModelRequest: 10000,
      maxTokensPerInterval: 1000000, maxTime: '1000' }, budgetInterval: '100', sharedModelLimit: 1,
    tickUnit: { text: 'tick', truncated: false }, rulesVersion: { text: '1', truncated: false },
    policyVersion: { text: '1', truncated: false }, editable: [] } }] }
  const preflight = vi.fn(preflightProps.preflight)
  const props = { ...preflightProps, preflight, connected: true, authorizationVersion: 1,
    maxDraftBytes: 65536, change: vi.fn(), close: vi.fn(), openRun: vi.fn(), refreshCatalog: vi.fn(async () => {}),
    retain: vi.fn(() => 'key' as never), submit: vi.fn(async () => undefined), query: vi.fn(async () => undefined), t }
  const view = render(<CreationDialog {...props} draft={{ ...raw, templateId: '', initialStock: '0' }}
    catalog={{ value: configured, loading: false, stale: false }} />)
  fireEvent.click(view.getByRole('button', { name: en.createPaused }))
  expect(view.getByText(en.templateRequired)).toBeTruthy()
  expect(view.getByText(en.stockInvalid)).toBeTruthy()
  expect(document.activeElement).toBe(view.getByRole('radio', { name: /Installed company/ }))
  view.rerender(<CreationDialog {...props} draft={{ ...raw, initialStock: '10000000000000000001' }}
    catalog={{ value: configured, loading: false, stale: false }} />)
  fireEvent.click(view.getByRole('button', { name: en.createPaused }))
  expect(view.getByText(en.stockInvalid)).toBeTruthy()
  view.rerender(<CreationDialog {...props} draft={{ ...raw, initialStock: '2', limits: { maxEntities: '4' } }}
    catalog={{ value: configured, loading: false, stale: false }} />)
  fireEvent.click(view.getByRole('button', { name: en.createPaused }))
  expect(view.getByText(en.limitNotEditable)).toBeTruthy()
  expect(preflight).not.toHaveBeenCalled()
})

it('shows preflight read failures and exact field rejection before allocating a create command', async () => {
  const preflight = vi.fn<Parameters<typeof CreationDialog>[0]['preflight']>()
    .mockResolvedValueOnce({ loading: false, stale: true, error: 'network' })
    .mockResolvedValueOnce({ loading: false, stale: false, value: { status: 'invalid', readiness: { status: 'ready', model: { provider: 'company', name: 'scripted' } }, issues: [
      { field: 'parameters.initialStock', code: 'invalid', message: { text: 'Stock exceeds installed limit', truncated: false } },
    ] } })
  const retain = vi.fn(() => 'key' as never)
  const view = render(<CreationDialog {...preflightProps} preflight={preflight} draft={raw}
    catalog={{ value: catalog, loading: false, stale: false }} connected authorizationVersion={1} maxDraftBytes={65536}
    change={vi.fn()} close={vi.fn()} openRun={vi.fn()} refreshCatalog={vi.fn(async () => {})}
    retain={retain} submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en.preflight }))
  await view.findByText(en.network)
  fireEvent.click(view.getByRole('button', { name: en.preflight }))
  expect(await view.findAllByText('Stock exceeds installed limit')).toHaveLength(2)
  expect(view.getByLabelText(en.initialStock).getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(view.getByLabelText(en.initialStock))
  expect(retain).not.toHaveBeenCalled()
})

it('keeps raw creation fields when the draft store refuses a new edit', () => {
  const change = vi.fn(() => { throw new Error('Draft quota reached') })
  const view = render(<CreationDialog {...preflightProps} draft={raw}
    catalog={{ value: catalog, loading: false, stale: false }} connected authorizationVersion={1} maxDraftBytes={65536}
    change={change} close={vi.fn()} openRun={vi.fn()} refreshCatalog={vi.fn(async () => {})}
    retain={vi.fn(() => 'key' as never)} submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)} t={t} />)
  fireEvent.change(view.getByLabelText(en.name), { target: { value: 'Later name' } })
  expect(view.getByRole('alert').textContent).toBe(en.draftCapacity)
  expect((view.getByLabelText(en.name) as HTMLInputElement).value).toBe(raw.name)
})

it('blocks repeated preflight clicks while the first exact input is still being checked', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<Parameters<typeof CreationDialog>[0]['preflight']>>>()
  const preflight = vi.fn(() => pending.promise)
  const retain = vi.fn(() => 'key' as never)
  const view = render(<CreationDialog {...preflightProps} preflight={preflight} draft={raw}
    catalog={{ value: catalog, loading: false, stale: false }} connected authorizationVersion={1} maxDraftBytes={65536}
    change={vi.fn()} close={vi.fn()} openRun={vi.fn()} refreshCatalog={vi.fn(async () => {})}
    retain={retain} submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)} t={t} />)
  const check = view.getByRole('button', { name: en.preflight })
  fireEvent.click(check)
  fireEvent.click(check)
  expect(preflight).toHaveBeenCalledOnce()
  expect(retain).not.toHaveBeenCalled()
  pending.resolve({ loading: false, stale: true })
  await view.findByText(en.stale)
})

it('retains entered creation fields when command admission fails after a ready preflight', async () => {
  const change = vi.fn<(draft?: SimulationCreationDraft) => void>()
  const retain = vi.fn(() => { throw new Error('Command capacity exhausted') })
  const view = render(<CreationDialog {...preflightProps} draft={raw}
    catalog={{ value: catalog, loading: false, stale: false }} connected authorizationVersion={1} maxDraftBytes={65536}
    change={change} close={vi.fn()} openRun={vi.fn()} refreshCatalog={vi.fn(async () => {})}
    retain={retain} submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en.createPaused }))
  await view.findByText(en.commandCapacity)
  expect(retain).toHaveBeenCalledOnce()
  expect(change.mock.calls[0]?.[0]?.name).toBe(raw.name)
  expect(typeof change.mock.calls[0]?.[0]?.commandKey).toBe('string')
  expect(change).toHaveBeenLastCalledWith({ ...raw, commandKey: undefined })
})

it('distinguishes template loading, denied catalog access and an available empty catalog', () => {
  const props = { ...preflightProps, draft: raw, connected: true, authorizationVersion: 1, maxDraftBytes: 65536,
    change: vi.fn(), close: vi.fn(), openRun: vi.fn(), refreshCatalog: vi.fn(async () => {}),
    retain: vi.fn(() => 'key' as never), submit: vi.fn(async () => undefined), query: vi.fn(async () => undefined), t }
  const view = render(<CreationDialog {...props} catalog={{ loading: true, stale: false }} />)
  expect(view.getByText(en.loading)).toBeTruthy()
  view.rerender(<CreationDialog {...props} catalog={{ loading: false, stale: false, error: 'unavailable' }} />)
  expect(view.getByRole('alert').textContent).toBe(en.noManagement)
  view.rerender(<CreationDialog {...props} catalog={{ loading: false, stale: false, error: 'network' }} />)
  expect(view.getByRole('alert').textContent).toBe(en.network)
  view.rerender(<CreationDialog {...props} catalog={{ value: { items: [] }, loading: false, stale: false }} />)
  expect(view.getByText(en.noTemplates)).toBeTruthy()
  expect(view.getByRole('button', { name: en.createPaused }).hasAttribute('disabled')).toBe(true)
})

it('labels installed cognition and reviewer choices without inferring a different template', () => {
  const props = { ...preflightProps, draft: raw, connected: true, authorizationVersion: 1, maxDraftBytes: 65536,
    change: vi.fn(), close: vi.fn(), openRun: vi.fn(), refreshCatalog: vi.fn(async () => {}),
    retain: vi.fn(() => 'key' as never), submit: vi.fn(async () => undefined), query: vi.fn(async () => undefined), t }
  const entry = catalog.items[0]!
  const view = render(<CreationDialog {...props} catalog={{ value: { items: [{ ...entry,
    cognition: 'deterministic', review: 'buyer' }] }, loading: false, stale: false }} />)
  fireEvent.click(view.getByText(en.installedConfiguration))
  expect(view.getByText(en.deterministicStrategy)).toBeTruthy()
  expect(view.getByText(en.reviewBuyer)).toBeTruthy()
  view.rerender(<CreationDialog {...props} catalog={{ value: { items: [{ ...entry,
    cognition: 'model', review: 'participant' }] }, loading: false, stale: false }} />)
  expect(view.getByText(en.modelStrategy)).toBeTruthy()
  expect(view.getByText(en.reviewParticipant)).toBeTruthy()
})

it('opens a registered run and clears a creation draft unchanged from its accepted original', () => {
  const command: SimulationCommand = { kind: 'create', input: { commandId: 'created' as never,
    templateId: 'company' as never, templateVersion: '1', expectedModel: { provider: 'company', name: 'scripted' }, name: raw.name,
    parameters: { buyerName: raw.buyerName, supplierName: raw.supplierName, initialStock: raw.initialStock } } }
  const change = vi.fn(), openRun = vi.fn()
  const view = render(<CreationDialog {...preflightProps} draft={{ ...raw, commandKey: 'created' as never }}
    command={{ command, pending: false, unknown: false, notFound: false, receipt: { kind: 'request', value: {
      commandId: 'created' as never, runId: 'created-run' as never, kind: 'create', acceptedAt: 1, status: 'accepted' } } }}
    catalog={{ value: catalog, loading: false, stale: false }} connected authorizationVersion={1} maxDraftBytes={65536}
    change={change} close={vi.fn()} openRun={openRun} refreshCatalog={vi.fn(async () => {})}
    retain={vi.fn(() => 'key' as never)} submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en.openCreatedRun }))
  expect(change).toHaveBeenCalledExactlyOnceWith(undefined)
  expect(openRun).toHaveBeenCalledExactlyOnceWith('created-run')
})
