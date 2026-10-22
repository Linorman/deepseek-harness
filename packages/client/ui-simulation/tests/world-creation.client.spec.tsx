// @vitest-environment jsdom
/** World imports preserve drafts and original commands; previews alone never start a run. */
import { readFileSync } from 'node:fs'
import { useState, useSyncExternalStore } from 'react'
import { Context } from '@clocky/cordis'
import { SimulationRuntime } from '../../runtime/src/client/simulations/service.ts'
import { FakeApiClient, err, ok } from '../../runtime/tests/fake-api.client.ts'
import { simulationProductWorldCreateInputSchema } from '@clocky/clocky-simulation-product/schema'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { SimulationProductWorldPreflightResult, SimulationReadState, SimulationCommand } from '@clocky/clocky-client-runtime/client'
import { WorldCreationDialog } from '../src/client/WorldCreationDialog.tsx'
import type { SimulationWorldCreationDraft } from '../src/client/store.ts'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'

afterEach(cleanup)
const json = readFileSync('examples/simulation-company/scenarios/world-company.json', 'utf8')
// This is the unary preview boundary; business execution is exercised by the real browser/Loader test.
const initialLimits = {
  native: { maxQueuedDecisions: 100, maxDispatchWaitRounds: 8, maxTokensPerInterval: 1000000,
    tokensPerModelRequest: 10000, maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
    maxPendingEvents: 100, maxPendingInteractions: 100, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
    maxEntities: 16, maxResidentActors: 2, maxIngressBytes: 65536, maxConflictRetries: 2, decisionTimeoutMs: 60000,
    maxDecisionsPerWindow: 2, outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32,
    maxMicrostepsPerTime: 32, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128 },
  team: { maxParticipants: 16, maxActivations: 100, maxTasks: 100, maxChannels: 100,
    maxEnvelopeBytes: 65536, maxChannelViewBytes: 65536, maxPendingDeliveriesPerChannel: 100,
    maxPendingDeliveriesPerParticipant: 100, maxPendingDeliveryPageSize: 100,
    maxPostIdempotencyEntriesPerChannel: 100, maxTaskAttemptsPerTask: 3, maxTaskLeaseDurationMs: 60000,
    maxTurnsPerTeam: 1000, maxModelTokensPerTeam: 1000000, maxWallTimeMsPerTeam: 100000,
    maxCostUnitsPerTeam: 1000, maxRetriesPerTeam: 100, maxInboxItemsPerParticipant: 100, maxRatePerParticipantPerMinute: 100 },
  world: { maxRequests: 10,
    maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1 as const,
    maxRequestsPerActorPerInterval: 10,
    maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 4096, maxBytesPerPlan: 4096 },
}
const ready: SimulationProductWorldPreflightResult = { status: 'ready', preview: { hash: `sha256:${'a'.repeat(64)}`,
  catalogGeneration: 'installed', organizationName: 'Company', actorCount: 2, positionCount: 1, initialRequestCount: 1,
  directorEntityId: 'director' }, policyVersion: '1', organization: { id: 'company', name: 'Company', description: 'Public organization' },
actors: [{ entityId: 'director', name: 'Director', role: 'director', template: { id: 'member', version: '1' },
  model: { provider: 'scripted', name: 'scripted', version: '1' } }, { entityId: 'requester', name: 'Member', role: 'member',
  template: { id: 'member', version: '1' }, model: { provider: 'scripted', name: 'scripted', version: '1' } }],
positions: [{ entityId: 'position', name: 'Engineer', occupied: 1, capacity: 2 }],
authorizations: [{ requesterEntityId: 'requester', positionEntityId: 'position' }], limits: initialLimits,
maxTime: '9007199254740993', budgetInterval: '100', tickUnit: 'minute',
scope: { source: 'simulated-only', operation: 'organization.generate-and-hire/v1', payroll: false, committeeApproval: false } }

function setup(locale: Record<Key, string> = en) {
  const check = vi.fn(async () => ({ loading: false, stale: false, value: ready })), close = vi.fn()
  const retain = vi.fn((_command: SimulationCommand) => 'original-world' as never), submit = vi.fn(async () => undefined)
  let draft: SimulationWorldCreationDraft | undefined
  function Harness() {
    const [value, change] = useState<SimulationWorldCreationDraft>({ name: 'World', json })
    draft = value
    const [validation, update] = useState<SimulationReadState<SimulationProductWorldPreflightResult>>({ loading: false, stale: false })
    return <WorldCreationDialog draft={value} change={(next) => { change(next ?? { name: '', json: '' }) }} validation={validation}
      connected authorizationVersion={1} maxDraftBytes={65536} close={close} openRun={() => {}}
      preflight={async (input) => { const result = { ...await check(), scope: JSON.stringify(['worldPreflight', input]) }
        update(result); return result }}
      closePreflight={() => { update({ loading: false, stale: false }) }} retain={retain} submit={submit}
      query={async () => undefined} t={key => locale[key]} />
  }
  return { view: render(<Harness />), check, retain, submit, close, draft: () => draft }
}

it.each([en, zh])('checks before creating one locked original and shows permissions, model and exact allowances', async (locale) => {
  const h = setup(locale)
  fireEvent.click(h.view.getByRole('button', { name: locale.preflight }))
  await h.view.findByRole('region', { name: locale['world.preview'] })
  expect(h.retain).not.toHaveBeenCalled()
  expect(h.view.getAllByText('scripted/scripted', { exact: false }).length).toBeGreaterThan(0)
  expect(h.view.getByText('9007199254740993', { exact: false })).toBeTruthy()
  expect(h.view.getByText(locale['world.scope'])).toBeTruthy()
  fireEvent.click(h.view.getByRole('button', { name: locale.createPaused }))
  fireEvent.click(h.view.getByRole('button', { name: locale.createPaused }))
  expect(h.retain).toHaveBeenCalledOnce(); expect(h.submit).toHaveBeenCalledOnce()
  const command = h.retain.mock.calls[0]?.[0]
  expect(command).toMatchObject({ kind: 'world-create', input: { name: 'World', preflight: {
    hash: ready.preview.hash, catalogGeneration: ready.preview.catalogGeneration } } })
  expect(h.draft()?.commandKey).toBe(JSON.stringify(['request', command?.input && 'commandId' in command.input ? command.input.commandId : '']))
  expect((h.view.getByLabelText(locale['world.definition']) as HTMLTextAreaElement).disabled).toBe(true)
})

it('rejects invalid JSON without allocation and discards no raw draft on cancel', async () => {
  const h = setup()
  fireEvent.change(h.view.getByLabelText(en['world.definition']), { target: { value: '{ invalid' } })
  fireEvent.click(h.view.getByRole('button', { name: en.preflight }))
  await h.view.findByText(en['world.invalidJson'])
  expect(h.check).not.toHaveBeenCalled(); expect(h.retain).not.toHaveBeenCalled()
  fireEvent.click(h.view.getByRole('button', { name: en.close }))
  await h.view.findByText(en.discardDraftNotice)
  fireEvent.click(h.view.getAllByRole('button', { name: en.keepEditing }).at(-1)!)
  expect(h.draft()?.json).toBe('{ invalid'); expect(h.close).not.toHaveBeenCalled()
})

it('retires a preview after JSON changes and requires a fresh check', async () => {
  const h = setup()
  fireEvent.click(h.view.getByRole('button', { name: en.preflight }))
  await h.view.findByRole('region', { name: en['world.preview'] })
  fireEvent.change(h.view.getByLabelText(en['world.definition']), { target: { value: json + '\n' } })
  await waitFor(() => { expect((h.view.getByRole('button', { name: en.createPaused }) as HTMLButtonElement).disabled).toBe(true) })
  expect(h.retain).not.toHaveBeenCalled()
})


it('preserves the rejected World draft and obtains a new preview before creating a replacement original', async () => {
  const ctx = new Context(), api = new FakeApiClient(), runtime = new SimulationRuntime(ctx, api)
  runtime.connected('world-authority' as never)
  try {
    const admin = runtime.administration(ctx, { maxCommands: 8, maxBytes: 65536 })
    const definition: unknown = JSON.parse(json)
    const input = simulationProductWorldCreateInputSchema.parse({ commandId: 'expired-original', name: 'World',
      definition, preflight: { hash: ready.preview.hash, catalogGeneration: ready.preview.catalogGeneration } })
    const version = runtime.state.getSnapshot().authorizationVersion
    const key = admin.retain({ kind: 'world-create', input }, version)
    const send = vi.spyOn(api.simulations, 'createWorld').mockResolvedValueOnce(err({
      code: 'simulation-product-preflight-changed', message: 'Preview again', details: {},
    })).mockImplementationOnce(async request => ok({ kind: 'world-create', commandId: request.commandId,
      runId: 'replacement-run' as never, status: 'accepted', acceptedAt: 1 }))
    await admin.submit(key)
    const replacement = { ...ready, preview: { ...ready.preview, hash: `sha256:${'b'.repeat(64)}` } }
    const preflight = vi.fn(async () => ({ loading: false, stale: false, value: replacement }))
    const subscribe = (listener: () => void) => admin.state.subscribe(listener), snapshot = () => admin.state.getSnapshot()
    function Harness() {
      const [draft, change] = useState<SimulationWorldCreationDraft | undefined>({ name: input.name, json, commandKey: key })
      const [validation, update] = useState<SimulationReadState<SimulationProductWorldPreflightResult>>({ loading: false, stale: false })
      const commands = useSyncExternalStore(subscribe, snapshot).commands
      return <WorldCreationDialog draft={draft} command={draft?.commandKey === undefined ? undefined : commands[draft.commandKey]}
        change={change} validation={validation} connected authorizationVersion={version} maxDraftBytes={65536}
        close={() => {}} openRun={() => {}} closePreflight={() => { update({ loading: false, stale: false }) }}
        preflight={async (request) => { const value = { ...await preflight(), scope: JSON.stringify(['worldPreflight', request]) }
          update(value); return value }} retain={(command, authority) => admin.retain(command, authority)}
        submit={id => admin.submit(id)} query={id => admin.query(id)} t={id => en[id]} />
    }
    const view = render(<Harness />)
    expect(view.getByText(en['commandError.preflight-changed'])).toBeTruthy()
    expect(view.queryByText(en.commandUnknown)).toBeNull()
    expect(view.queryByRole('button', { name: en.retryOriginal })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: en['world.newIntent'] }))
    expect((view.getByLabelText(en['world.definition']) as HTMLTextAreaElement).value).toBe(json)
    expect((view.getByRole('button', { name: en.createPaused }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(view.getByRole('button', { name: en.preflight }))
    await view.findByRole('region', { name: en['world.preview'] })
    fireEvent.click(view.getByRole('button', { name: en.createPaused }))
    fireEvent.click(view.getByRole('button', { name: en.createPaused }))
    await waitFor(() => { expect(send).toHaveBeenCalledTimes(2) })
    const next = send.mock.calls[1]![0]
    expect(next.commandId).not.toBe(input.commandId)
    expect(next.definition).toEqual(input.definition)
    expect(next.preflight.hash).toBe(replacement.preview.hash)
    expect(admin.state.getSnapshot().commands[key]?.notAccepted).toBe(true)
  } finally { cleanup(); await ctx.fiber.dispose() }
})
