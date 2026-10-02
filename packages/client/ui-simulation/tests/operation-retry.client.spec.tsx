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
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  expect(query).toHaveBeenCalledWith('original')
  expect(props.retain).not.toHaveBeenCalled()
})
