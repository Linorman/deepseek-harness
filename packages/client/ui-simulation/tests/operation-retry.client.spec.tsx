// @vitest-environment jsdom
/** Retry grants preserve original external intent; lookup never depends on current new-request capacity. */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { OperationRetry } from '../src/client/OperationRetry.tsx'
import { en } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import type { SimulationOperationRetryDraft } from '../src/client/store.ts'
import type { SimulationProductObjectInspection, SimulationCommand, SimulationCommandState } from '@clocky/clocky-client-runtime/client'

afterEach(cleanup)
const t = (key: Key) => en[key]
const detail: SimulationProductObjectInspection = { runId: 'run' as never, snapshotRevision: 3, observedAt: 1, status: 'found',
  selection: { collection: 'operations', section: 'execution', id: 'operation' as never }, value: { collection: 'operations',
    section: 'execution', id: 'operation' as never, dependencies: [], summary: { id: 'operation' as never, entityId: 'buyer' as never,
      decisionId: 'decision' as never, index: 0, kind: { text: 'communication/post', truncated: false }, status: 'outcome-unknown',
      publication: 'pending', delivery: 'pending', task: 'not-applicable' }, outbox: { ready: true, attemptCount: 1 },
    retry: { allowed: true, reason: 'ready', expectedAttemptCount: 1, maxAttempts: 1 } } }
const raw: SimulationOperationRetryDraft = { runId: 'run' as never, operationId: 'operation', expectedAttemptCount: 1, reason: '' }

it('retains normalized original grants and later raw input after transport loss without allocating another identity', async () => {
  let command: SimulationCommand | undefined
  const retain = vi.fn((value: SimulationCommand) => { command = structuredClone(value); return 'original' as never })
  const submit = vi.fn(), query = vi.fn(), close = vi.fn()
  function Harness() {
    const [draft, update] = useState(raw)
    const [commands, setCommands] = useState<Record<string, SimulationCommandState>>({})
    submit.mockImplementation(async () => {
      if (command === undefined) throw new Error('Original missing')
      const current = { command, pending: false, unknown: true, notFound: false, error: 'network' as const }
      setCommands({ original: current }); return current
    })
    query.mockImplementation(async () => {
      if (command?.kind !== 'retry-operation') throw new Error('Original missing')
      const current: SimulationCommandState = { command, pending: false, unknown: false, notFound: false,
        receipt: { kind: 'request', value: { commandId: command.input.commandId, runId: command.input.runId,
          kind: 'retry-operation', status: 'completed', acceptedAt: 1 } } }
      setCommands({ original: current }); return current
    })
    return <OperationRetry draft={draft} detail={{ value: detail, loading: false, stale: false }} connected authorizationVersion={1}
      commands={commands} retain={retain} submit={submit} query={query} close={close} refresh={async () => {}}
      change={(_key, value) => { if (value !== undefined) update(value) }} t={t} />
  }
  const view = render(<Harness />)
  fireEvent.change(view.getByLabelText(en['operationRetry.reason']), { target: { value: '  Original evidence  ' } })
  fireEvent.click(view.getByRole('button', { name: en['operationRetry.grant'] }))
  await waitFor(() => { expect(submit).toHaveBeenCalledOnce() })
  expect(command).toMatchObject({ kind: 'retry-operation', input: { operationId: 'operation', expectedAttemptCount: 1,
    reason: 'Original evidence' } })
  fireEvent.change(view.getByLabelText(en['operationRetry.reason']), { target: { value: '  Original evidence   ' } })
  fireEvent.click(view.getByRole('button', { name: en.retryOriginal }))
  await waitFor(() => { expect(submit).toHaveBeenCalledTimes(2) })
  expect(retain).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  await view.findByText(en['operationRetry.granted'])
  expect((view.getByLabelText(en['operationRetry.reason']) as HTMLTextAreaElement).value).toBe('  Original evidence   ')
  expect(close).not.toHaveBeenCalled()
})

it('disables a new grant on stale or absent hints but lets the existing original be queried when capacity is full', () => {
  const command: SimulationCommand = { kind: 'retry-operation', input: { runId: raw.runId, commandId: 'original' as never,
    operationId: 'operation' as never, expectedAttemptCount: 1, reason: 'Original evidence' } }
  const query = vi.fn(async () => undefined)
  const current: SimulationCommandState = { command, pending: false, unknown: true, notFound: false }
  if (detail.value?.collection !== 'operations' || detail.value.section !== 'execution') throw new Error('Fixture mismatch')
  const blocked = { ...detail, value: { ...detail.value, retry: { ...detail.value.retry!, allowed: false,
    reason: 'capacity-unavailable' as const } } }
  const props = { draft: { ...raw, reason: 'Original evidence', commandKey: 'original' as never }, connected: true,
    authorizationVersion: 1, commands: { original: current }, retain: vi.fn(() => 'new' as never), submit: vi.fn(async () => undefined),
    query, close: vi.fn(), refresh: vi.fn(async () => {}), change: vi.fn(), t }
  const view = render(<OperationRetry {...props} detail={{ value: blocked, loading: false, stale: true }} />)
  expect((view.getByRole('button', { name: en['operationRetry.grant'] }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: en['operationRetry.refresh'] }))
  expect(props.refresh).toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  expect(query).toHaveBeenCalledWith('original')
  expect(props.retain).not.toHaveBeenCalled()
})

it('discards a retry draft explicitly without discarding unrelated drafts', () => {
  const change = vi.fn(), close = vi.fn()
  const view = render(<OperationRetry draft={{ ...raw, reason: 'Private reason' }}
    detail={{ value: detail, loading: false, stale: false }} connected authorizationVersion={1} commands={{}}
    retain={vi.fn(() => 'original' as never)} submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)}
    close={close} refresh={vi.fn(async () => {})} change={change} t={t} />)
  fireEvent.click(view.getAllByRole('button', { name: en.discardDraft })[0]!)
  fireEvent.click(view.getAllByRole('button', { name: en.keepEditing }).at(-1)!)
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(view.getAllByRole('button', { name: en.discardDraft })[0]!)
  fireEvent.click(view.getAllByRole('button', { name: en.keepEditing })[0]!)
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(view.getAllByRole('button', { name: en.discardDraft })[0]!)
  fireEvent.click(view.getAllByRole('button', { name: en.discardDraft }).at(-1)!)
  const expectedKey = JSON.stringify([raw.runId, raw.operationId])
  expect(change).toHaveBeenCalledWith(expectedKey, undefined)
  expect(close).toHaveBeenCalledOnce()
})

it('retains the current reason when bounded draft storage rejects an edit', () => {
  const change = vi.fn(() => { throw new Error('Draft storage full') })
  const view = render(<OperationRetry draft={{ ...raw, reason: 'Original reason' }}
    detail={{ value: detail, loading: false, stale: false }} connected authorizationVersion={1} commands={{}}
    retain={vi.fn(() => 'original' as never)} submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)}
    close={vi.fn()} refresh={vi.fn(async () => {})} change={change} t={t} />)
  fireEvent.change(view.getByLabelText(en['operationRetry.reason']), { target: { value: 'Changed reason' } })
  expect(view.getByRole('alert').textContent).toBe(en.draftCapacity)
  expect((view.getByLabelText(en['operationRetry.reason']) as HTMLTextAreaElement).value).toBe('Original reason')
})

it('adopts the Host’s changed attempt fence and resets only the selected command identity', () => {
  const change = vi.fn()
  if (detail.value?.collection !== 'operations' || detail.value.section !== 'execution' || detail.value.retry === undefined) {
    throw new Error('Fixture mismatch')
  }
  const changed: SimulationProductObjectInspection = { ...detail,
    value: { ...detail.value, retry: { ...detail.value.retry, expectedAttemptCount: 2 } } }
  const view = render(<OperationRetry draft={{ ...raw, reason: 'Private reason' }} detail={{ value: changed, loading: false, stale: false }}
    connected authorizationVersion={1} commands={{}} retain={vi.fn(() => 'original' as never)}
    submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)} close={vi.fn()}
    refresh={vi.fn(async () => {})} change={change} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en['operationRetry.confirmFence'] }))
  const expectedKey = JSON.stringify([raw.runId, raw.operationId])
  expect(change).toHaveBeenCalledWith(expectedKey, { ...raw, reason: 'Private reason', expectedAttemptCount: 2, commandKey: undefined })
})

it('keeps a draft when command capacity is exhausted and reports it', async () => {
  const view = render(<OperationRetry draft={{ ...raw, reason: 'Private reason' }}
    detail={{ value: detail, loading: false, stale: false }} connected authorizationVersion={1} commands={{}}
    retain={vi.fn(() => { throw new Error('No capacity') })} submit={vi.fn(async () => undefined)}
    query={vi.fn(async () => undefined)} close={vi.fn()} refresh={vi.fn(async () => {})} change={vi.fn()} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en['operationRetry.grant'] }))
  await view.findByText(en.commandCapacity)
})

it('closes automatically only when the completed result matches the submitted original', async () => {
  const change = vi.fn(), close = vi.fn()
  const command: SimulationCommand = { kind: 'retry-operation', input: { runId: raw.runId, commandId: 'original' as never,
    operationId: raw.operationId as never, expectedAttemptCount: 1, reason: 'Submitted reason' } }
  const draft = { ...raw, reason: 'Submitted reason', commandKey: 'original' as never,
    submitted: { reason: 'Submitted reason', expectedAttemptCount: 1 } }
  const result: SimulationCommandState = { command, pending: false, unknown: false, notFound: false,
    receipt: { kind: 'request', value: { commandId: 'original' as never, runId: raw.runId,
      kind: 'retry-operation', status: 'completed', acceptedAt: 1 } } }
  const view = render(<OperationRetry draft={draft} detail={{ value: detail, loading: false, stale: false }}
    connected authorizationVersion={1} commands={{ original: result }} retain={vi.fn(() => 'original' as never)}
    submit={vi.fn(async () => result)} query={vi.fn(async () => result)} close={close}
    refresh={vi.fn(async () => {})} change={change} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  expect(change).toHaveBeenCalledWith(JSON.stringify([raw.runId, raw.operationId]), undefined)
})

it('requires a changed reason before admitting a new command after the same original failed', () => {
  const command: SimulationCommand = { kind: 'retry-operation', input: { runId: raw.runId, commandId: 'original' as never,
    operationId: raw.operationId as never, expectedAttemptCount: 1, reason: 'Same reason' } }
  const failed: SimulationCommandState = { command, pending: false, unknown: false, notFound: false,
    receipt: { kind: 'request', value: { commandId: 'original' as never, runId: raw.runId,
      kind: 'retry-operation', acceptedAt: 1, status: 'failed', failure: 'retry-operation-failed' } } }
  const base = { detail: { value: detail, loading: false, stale: false }, connected: true, authorizationVersion: 1,
    commands: { original: failed }, retain: vi.fn(() => 'new' as never), submit: vi.fn(async () => undefined),
    query: vi.fn(async () => undefined), close: vi.fn(), refresh: vi.fn(async () => {}), change: vi.fn(), t }
  const view = render(<OperationRetry {...base} draft={{ ...raw, commandKey: 'original' as never, reason: 'Same reason' }} />)
  expect(view.getByText(en['operationRetry.sameFailed'])).toBeDefined()
  expect(view.getByRole('button', { name: en['operationRetry.grant'] }).hasAttribute('disabled')).toBe(true)
  view.rerender(<OperationRetry {...base} draft={{ ...raw, commandKey: 'original' as never, reason: 'A new reason' }} />)
  expect(view.queryByText(en['operationRetry.sameFailed'])).toBeNull()
  expect(view.getByRole('button', { name: en['operationRetry.grant'] }).hasAttribute('disabled')).toBe(false)
})

it('discovers the exact retained original after local selection is lost and refreshes only when connected', () => {
  const unrelatedRun: SimulationCommandState = { command: { kind: 'retry-operation', input: {
    runId: 'another-run' as never, commandId: 'unrelated-run' as never, operationId: raw.operationId as never,
    expectedAttemptCount: 1, reason: 'Other run' } }, pending: false, unknown: true, notFound: false }
  const unrelatedOperation: SimulationCommandState = { command: { kind: 'retry-operation', input: {
    runId: raw.runId, commandId: 'unrelated-operation' as never, operationId: 'other-operation' as never,
    expectedAttemptCount: 1, reason: 'Other operation' } }, pending: false, unknown: true, notFound: false }
  const original: SimulationCommandState = { command: { kind: 'retry-operation', input: {
    runId: raw.runId, commandId: 'original' as never, operationId: raw.operationId as never,
    expectedAttemptCount: 1, reason: 'Retained evidence' } }, pending: false, unknown: true, notFound: false }
  const refresh = vi.fn(async () => {})
  const props = { draft: { ...raw, reason: 'Later private edit' }, detail: { value: detail, loading: false, stale: false },
    authorizationVersion: 1, commands: { unrelatedRun, unrelatedOperation, original },
    retain: vi.fn(() => 'new' as never), submit: vi.fn(async () => undefined), query: vi.fn(async () => undefined),
    close: vi.fn(), refresh, change: vi.fn(), t }
  const view = render(<OperationRetry {...props} connected={false} />)
  expect(refresh).not.toHaveBeenCalled()
  expect(view.getByText(`${en['operationRetry.originalReason']}: Retained evidence`)).toBeTruthy()
  expect(view.queryByText('Other run')).toBeNull()
  expect(view.queryByText('Other operation')).toBeNull()
  view.rerender(<OperationRetry {...props} connected />)
  expect(refresh).toHaveBeenCalledOnce()
})

it('retains only one grant across repeated clicks while its original request is in flight', async () => {
  let complete!: (value: SimulationCommandState | undefined) => void
  const submit = vi.fn(() => new Promise<SimulationCommandState | undefined>((resolve) => { complete = resolve }))
  const retain = vi.fn(() => 'original' as never)
  const refresh = vi.fn(async () => {})
  const view = render(<OperationRetry draft={{ ...raw, reason: 'Evidence' }}
    detail={{ value: detail, loading: false, stale: false }} connected authorizationVersion={1} commands={{}}
    retain={retain} submit={submit} query={vi.fn(async () => undefined)} close={vi.fn()}
    refresh={refresh} change={vi.fn()} t={t} />)
  const grant = view.getByRole('button', { name: en['operationRetry.grant'] })
  fireEvent.click(grant)
  fireEvent.click(grant)
  expect(retain).toHaveBeenCalledOnce()
  expect(submit).toHaveBeenCalledOnce()
  complete(undefined)
  await waitFor(() => { expect(refresh).toHaveBeenCalledTimes(2) })
})

it('shows a runtime read error separately from an unavailable retry hint', () => {
  const view = render(<OperationRetry draft={{ ...raw, reason: 'Evidence' }}
    detail={{ loading: false, stale: false, error: 'network' }} connected authorizationVersion={1} commands={{}}
    retain={vi.fn(() => 'original' as never)} submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)}
    close={vi.fn()} refresh={vi.fn(async () => {})} change={vi.fn()} t={t} />)
  expect(view.getByRole('alert').textContent).toBe(en.network)
  expect(view.getByText(en['operationRetry.unavailable'])).toBeTruthy()
  expect(view.getByRole('button', { name: en['operationRetry.grant'] }).hasAttribute('disabled')).toBe(true)
})
