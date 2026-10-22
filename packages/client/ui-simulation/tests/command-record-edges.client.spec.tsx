// @vitest-environment jsdom
/** Original-command feedback keeps historical receipts separate from a newer request journal. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { SimulationCommandState } from '@clocky/clocky-client-runtime/client'
import { CommandRecord } from '../src/client/CommandRecord.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]
const command = { kind: 'create' as const, input: { runId: 'run' as never, commandId: 'original' as never,
  templateId: 'company' as never, templateVersion: '1' as const, expectedModel: { provider: 'company', name: 'scripted' }, name: 'Company',
  parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } } }

it('shows a newer terminal journal and the retained earlier receipt when a query fails', () => {
  const query = vi.fn(async () => undefined)
  const value: SimulationCommandState = { command, pending: false, unknown: true, notFound: false, error: 'network',
    receipt: { kind: 'request', value: { commandId: 'original' as never, runId: 'run' as never,
      kind: 'create', acceptedAt: 1, status: 'accepted' } },
    requestObservation: { runId: 'run' as never, status: 'completed', journalRevision: 2,
      comparison: 'receipt-older', stale: true } }
  const view = render(<CommandRecord value={value} connected query={query} retry={vi.fn(async () => undefined)} t={t} />)
  expect(view.getByRole('alert').textContent).toBe(en['requests.queryFailed'])
  expect(view.getByText(en['requests.earlierReceipt'])).toBeTruthy()
  expect(view.getByText(en['requests.retainedObservation'])).toBeTruthy()
  expect(view.queryByText(en.commandUnknown)).toBeNull()
  expect(view.queryByRole('button', { name: en.retryOriginal })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  expect(query).toHaveBeenCalledOnce()
})

it('does not imply another lookup for a completed management receipt', () => {
  const value: SimulationCommandState = { command: { kind: 'manage', input: { runId: 'run' as never,
    managementId: 'management' as never, phase: 'running' } }, pending: false, unknown: false, notFound: false,
  receipt: { kind: 'management', value: { managementId: 'management' as never, phase: 'running', status: 'completed',
    startedSequence: 1, finishedSequence: 2 } } }
  const query = vi.fn(async () => undefined)
  const view = render(<CommandRecord value={value} connected query={query} retry={vi.fn(async () => undefined)} t={t} />)
  expect(view.getByText(`${en.originalResult}: ${en['receipt.completed']}`)).toBeTruthy()
  expect(view.queryByRole('button', { name: en.queryOriginal })).toBeNull()
  expect(query).not.toHaveBeenCalled()
})

it('shows a local transport error while the original outcome remains unknown', () => {
  const value: SimulationCommandState = { command, pending: false, unknown: true, notFound: false, error: 'network' }
  const view = render(<CommandRecord value={value} connected query={vi.fn(async () => undefined)}
    retry={vi.fn(async () => undefined)} t={t} />)
  expect(view.getByRole('alert').textContent).toBe(en['commandError.network'])
  expect(view.getByText(en.commandUnknown)).toBeTruthy()
  expect(view.queryByRole('button', { name: en.retryOriginal })).toBeNull()
  expect(view.getByRole('button', { name: en.queryOriginal })).toBeDefined()
})

it('offers an explicit follow-up query for a completed original when its owner requests one', () => {
  const value: SimulationCommandState = { command: { kind: 'manage', input: { runId: 'run' as never,
    managementId: 'management' as never, phase: 'running' } }, pending: false, unknown: false, notFound: false,
  receipt: { kind: 'management', value: { managementId: 'management' as never, phase: 'running', status: 'completed',
    startedSequence: 1, finishedSequence: 2 } } }
  const query = vi.fn(async () => undefined)
  const view = render(<CommandRecord value={value} connected alwaysQuery query={query}
    retry={vi.fn(async () => undefined)} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  expect(query).toHaveBeenCalledOnce()
})

it('names a review that returns the selected attempt for rework', () => {
  const value: SimulationCommandState = { command: { kind: 'review', input: { runId: 'run' as never,
    commandId: 'review' as never, operationId: 'operation' as never, attemptId: 'attempt' as never,
    expectedRevision: 2, nextPhase: 'pending', reason: 'Needs changes' } },
  pending: false, unknown: true, notFound: false }
  const view = render(<CommandRecord value={value} connected query={vi.fn(async () => undefined)}
    retry={vi.fn(async () => undefined)} t={t} />)
  expect(view.getByText((_, element) => element?.tagName === 'P' && (element.textContent?.includes(en['reviews.rework']) ?? false))).toBeTruthy()
  expect(view.getByText('attempt')).toBeTruthy()
})

it('shows a real human case blocker independently of its accepted receipt and opens that original case', async () => {
  const { managementSubmit } = await import('../../../simulation/simulation-product/tests/world-management-fixture.ts')
  const { simulationProductWorldManagementOutcomeSchema } = await import('@clocky/clocky-simulation-product/world-management-schema')
  const outcome = simulationProductWorldManagementOutcomeSchema.parse({ runId: 'run', commandId: 'original-user', acceptedSequence: 4,
    requestId: 'case', intentId: 'intent', planId: 'plan', execution: { requestId: 'case', intentId: 'intent', planId: 'plan',
      expectedSequence: 4, sequence: 5, updates: 1, time: '2', mode: 'execute', phase: 'blocked', reason: 'handoff-required',
      pin: { domain: 'organization', operation: 'transfer', version: '1', schemaRef: 'clocky.organization.transfer/schema/1',
        implementationRef: 'clocky.organization.transfer/native/1', generation: 1 } } })
  const value: SimulationCommandState = { command: { kind: 'world-management', input: managementSubmit },
    pending: false, unknown: false, notFound: false, receipt: { kind: 'request', worldManagementOutcome: outcome,
      value: { commandId: managementSubmit.commandId, runId: managementSubmit.runId,
        kind: 'world-management', acceptedAt: 1, status: 'accepted' } } }
  const navigate = vi.fn()
  const view = render(<CommandRecord value={value} connected navigate={navigate} query={vi.fn(async () => undefined)}
    retry={vi.fn(async () => undefined)} t={t} />)
  expect(view.getByText(en['status.stop.handoff-required'])).toBeTruthy()
  expect(view.getByText(en['cases.noResult'])).toBeTruthy()
  expect(view.getByText(`${en.originalResult}: ${en['receipt.accepted']}`)).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: en['cases.openOriginal'] }))
  expect(navigate).toHaveBeenCalledWith({ runId: 'run', module: 'cases', objectId: 'case', caseSection: 'execution', search: '' })
})
