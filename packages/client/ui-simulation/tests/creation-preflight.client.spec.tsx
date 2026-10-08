// @vitest-environment jsdom
/** Preflight observes installed policy; only the unchanged validated draft can allocate a command. */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { SimulationProductCatalog, SimulationProductPreflightInput, SimulationProductPreflightResult,
  SimulationCommand, SimulationReadState } from '@clocky/clocky-client-runtime/client'
import { CreationDialog } from '../src/client/CreationDialog.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import type { SimulationCreationDraft } from '../src/client/store.ts'

afterEach(cleanup)
const configuration = { limits: { maxEntities: 16, maxResidentActors: 2, tokensPerModelRequest: 10000,
  maxTokensPerInterval: 1000000, maxTime: '90071992547409930' }, budgetInterval: '9007199254740993', sharedModelLimit: 3,
tickUnit: { text: 'minute', truncated: false }, rulesVersion: { text: '1', truncated: false }, policyVersion: { text: '1', truncated: false } }
const catalog: SimulationProductCatalog = { items: [{ id: 'company' as never, version: '1', name: { text: 'Company', truncated: false },
  kind: 'company-procurement', readiness: { status: 'ready', model: { provider: 'company', name: 'scripted' } }, tickUnit: configuration.tickUnit,
  execution: 'automatic-tasks', review: 'none', maxStock: '10000',
  configuration: { ...configuration, editable: ['maxEntities', 'maxResidentActors', 'tokensPerModelRequest', 'maxTokensPerInterval', 'maxTime'] } }] }
const raw: SimulationCreationDraft = { templateId: 'company', name: 'Report', buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' }
const ready: SimulationReadState<SimulationProductPreflightResult> = { loading: false, stale: false, value: { status: 'ready', configuration, readiness: { status: 'ready', model: { provider: 'company', name: 'scripted' } } } }
function setup(check: (input: SimulationProductPreflightInput) =>
Promise<SimulationReadState<SimulationProductPreflightResult> | undefined>, locale = en) {
  const retain = vi.fn((_command: SimulationCommand) => 'original' as never), submit = vi.fn(async () => undefined), closePreflight = vi.fn()
  function Harness() {
    const [draft, change] = useState<SimulationCreationDraft | undefined>(raw)
    const [validation, update] = useState<SimulationReadState<SimulationProductPreflightResult>>({ loading: false, stale: false })
    return <CreationDialog draft={draft} change={change} catalog={{ value: catalog, loading: false, stale: false }}
      validation={validation} preflight={async (input) => {
        update({ loading: true, stale: false })
        const result = await check(input)
        if (result !== undefined) update(result)
        return result
      }} closePreflight={() => { closePreflight(); update({ loading: false, stale: false }) }}
      connected authorizationVersion={1} maxDraftBytes={65536} close={() => {}} openRun={() => {}} refreshCatalog={async () => {}}
      renderSlot={() => null} returnFromModelSetup={() => {}} retain={retain} release={() => true}
      submit={submit} query={async () => undefined} t={(key: Key) => locale[key]} />
  }
  return { view: render(<Harness />), retain, submit, closePreflight }
}

it.each([en, zh])('checks exact limits without allocating an identity and creates only after a fresh second check', async (locale) => {
  const check = vi.fn(async (_input: SimulationProductPreflightInput) => ready)
  const h = setup(check, locale)
  fireEvent.change(h.view.getByLabelText(locale['limit.maxTime']), { target: { value: '90071992547409929' } })
  fireEvent.change(h.view.getByLabelText(locale['limit.maxResidentActors']), { target: { value: '1' } })
  fireEvent.change(h.view.getByLabelText(locale['limit.maxTokensPerInterval']), { target: { value: '0' } })
  fireEvent.click(h.view.getByRole('button', { name: locale.preflight }))
  await h.view.findByText(locale.preflightReady)
  expect(check).toHaveBeenCalledWith(expect.objectContaining({ limits: {
    maxTime: '90071992547409929', maxResidentActors: 1, maxTokensPerInterval: 0 } }))
  expect(check.mock.calls[0]?.[0]).not.toHaveProperty('commandId')
  expect(h.retain).not.toHaveBeenCalled()
  fireEvent.click(h.view.getByRole('button', { name: locale.createPaused }))
  await waitFor(() => { expect(h.submit).toHaveBeenCalledOnce() })
  expect(check).toHaveBeenCalledTimes(2)
  expect(h.retain.mock.calls[0]?.[0]).toMatchObject({ input: { limits: {
    maxTime: '90071992547409929', maxResidentActors: 1, maxTokensPerInterval: 0 } } })
})

it('keeps field input, focuses the Host rejection and allocates no command on invalid or unavailable checks', async () => {
  const check = vi.fn(async () => ({ loading: false, stale: false, value: { status: 'invalid' as const, readiness: { status: 'ready' as const, model: { provider: 'company', name: 'scripted' } },
    issues: [{ field: 'limits.maxResidentActors', code: 'invalid' as const, message: { text: 'Review needs two residents', truncated: false } }] } }))
  const h = setup(check)
  fireEvent.change(h.view.getByLabelText(en['limit.maxResidentActors']), { target: { value: '1' } })
  fireEvent.click(h.view.getByRole('button', { name: en.createPaused }))
  await waitFor(() => { expect(h.view.getByLabelText(en['limit.maxResidentActors']).getAttribute('aria-invalid')).toBe('true') })
  expect(document.activeElement).toBe(h.view.getByLabelText(en['limit.maxResidentActors']))
  expect((h.view.getByLabelText(en['limit.maxResidentActors']) as HTMLInputElement).value).toBe('1')
  expect(h.retain).not.toHaveBeenCalled()
})

it('does not create from a late successful check after the user changes input', async () => {
  const pending = Promise.withResolvers<SimulationReadState<SimulationProductPreflightResult>>()
  const h = setup(async () => pending.promise)
  fireEvent.click(h.view.getByRole('button', { name: en.createPaused }))
  fireEvent.change(h.view.getByLabelText(en.name), { target: { value: 'Later input' } })
  pending.resolve(ready)
  await waitFor(() => { expect(h.view.queryByText(en.preflightLoading)).toBeNull() })
  expect(h.retain).not.toHaveBeenCalled()
  expect((h.view.getByLabelText(en.name) as HTMLInputElement).value).toBe('Later input')
})

it('rejects unsafe numeric capacity before IO while preserving exact tick strings', async () => {
  const check = vi.fn(async () => ready)
  const h = setup(check)
  fireEvent.change(h.view.getByLabelText(en['limit.maxEntities']), { target: { value: '9007199254740993' } })
  fireEvent.click(h.view.getByRole('button', { name: en.createPaused }))
  await h.view.findByText(en.limitInvalid)
  expect(check).not.toHaveBeenCalled(); expect(h.retain).not.toHaveBeenCalled()
})

it('requires an explicit semantic change before detaching an unknown original and keeps it queryable', () => {
  const query = vi.fn(async () => undefined), change = vi.fn()
  const command = { kind: 'create' as const, input: { commandId: 'first' as never,
    templateId: 'company' as never, templateVersion: '1' as const, expectedModel: { provider: 'company', name: 'scripted' }, name: raw.name,
    parameters: { buyerName: raw.buyerName, supplierName: raw.supplierName, initialStock: raw.initialStock } } }
  const base = { catalog: { value: catalog, loading: false, stale: false }, validation: { loading: false, stale: false },
    preflight: async () => ready, closePreflight: () => {}, connected: true, authorizationVersion: 1,
    maxDraftBytes: 65536, change, close: () => {}, openRun: () => {}, refreshCatalog: async () => {},
    renderSlot: () => null, returnFromModelSetup: () => {}, retain: vi.fn(() => 'next' as never), release: () => true, submit: async () => undefined, query, t: (key: Key) => en[key],
    command: { command, pending: false, unknown: true, notFound: false } }
  const view = render(<CreationDialog {...base} draft={{ ...raw, commandKey: 'first-key' as never }} />)
  expect(view.queryByRole('button', { name: en.useChangedCreation })).toBeNull()
  view.rerender(<CreationDialog {...base} draft={{ ...raw, name: 'Changed', commandKey: 'first-key' as never }} />)
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  expect(query).toHaveBeenCalledWith('first-key')
  fireEvent.click(view.getByRole('button', { name: en.useChangedCreation }))
  expect(change).toHaveBeenCalledWith({ ...raw, name: 'Changed', commandKey: undefined })
  expect(base.retain).not.toHaveBeenCalled()
  expect(command.input.name).toBe(raw.name)
})

it('never silently submits a different model returned by a later preflight', async () => {
  const h = setup(async () => ({ ...ready, value: { status: 'ready', configuration,
    readiness: { status: 'ready', model: { provider: 'company', name: 'changed-after-preview' } } } }))
  fireEvent.click(h.view.getByRole('button', { name: en.createPaused }))
  await h.view.findByText(en['model-changed'])
  expect(h.retain).not.toHaveBeenCalled()
  expect(h.submit).not.toHaveBeenCalled()
  expect((h.view.getByLabelText(en.name) as HTMLInputElement).value).toBe(raw.name)
})
