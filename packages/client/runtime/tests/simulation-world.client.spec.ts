/** World windows and original commands use only the authenticated unary boundary. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { simulationProductWorldPreflightInputSchema, simulationProductWorldCreateInputSchema,
  simulationProductWorldCaseInspectionSchema, simulationProductWorldCasesPageSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductWorldPreflightResult, SimulationProductWatchResult } from '@clocky/clocky-simulation-product/types'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import { simulationCommandKey } from '../src/client/simulations/administration.ts'
import type { SimulationCommand } from '../src/client/simulations/administration.ts'
import { FakeApiClient, ok, err } from './fake-api.client.ts'

const runId = 'world-run' as never, requestId = 'world-request' as never
const input = simulationProductWorldPreflightInputSchema.parse({ definition: { apiVersion: 'clocky.world/v0',
  metadata: { id: 'world', name: 'World', description: 'A portable definition.' },
  organization: { id: 'organization', name: 'Organization', description: 'Public organization.' },
  positions: [{ id: 'position', name: 'Researcher', capacity: 1 }], runtimeProfile: { id: 'world-agent', version: '1' },
  templates: [{ id: 'researcher', version: '1' }], actors: [
    { id: 'director', role: 'director', template: { id: 'researcher', version: '1' } },
    { id: 'requester', role: 'member', template: { id: 'researcher', version: '1' } },
  ], assignments: [], authorizations: [{ id: 'can-hire', requesterId: 'requester', positionId: 'position' }], initialEvents: [] } })
const preview: SimulationProductWorldPreflightResult = { status: 'invalid', diagnostics: [] }
const page = simulationProductWorldCasesPageSchema.parse({ runId, snapshotRevision: 1, readVersion: 'v1', observedAt: 1,
  total: 0, items: [] })
const body = (readVersion = 'v1') => simulationProductWorldCaseInspectionSchema.parse({ runId, requestId, section: 'plans',
  snapshotRevision: 1, readVersion, observedAt: 1, status: 'found', value: { section: 'plans', total: 1,
    summary: { apiVersion: 'clocky.world-case/v4', businessSummary: { status: 'unsupported' }, origin: { kind: 'decision' }, domain: 'organization', operation: 'generate-and-hire', version: '1',
      requestId, intentId: 'intent', status: 'open', requesterEntityId: 'requester', organizationEntityId: 'organization',
      targetEntityId: 'position', cancel: { allowed: false, reason: 'recovery-required' }, lifecycle: {
        request: { status: 'open' }, plan: { status: 'accepted', id: 'plan', resolution: 'apply' },
        execution: { callback: { status: 'none' }, business: { status: 'none' } }, notification: { request: null } } },
    items: [{ id: 'plan', operationId: 'operation', sequence: 1, hash: 'sha256:original', predecessor: null, status: 'accepted',
      resolution: 'apply', rationale: { status: 'allowed', text: { text: 'private-case-body', truncated: false } },
      persona: { status: 'allowed', templateId: { text: 'researcher', truncated: false }, templateVersion: { text: '1', truncated: false },
        name: { text: 'private-persona', truncated: false }, skills: [], traits: [], goals: [] } }] } })
const detail = { runId, requestId, section: 'plans' as const }
const exported = { runId, definition: input.definition }
function fixture() {
  const ctx = new Context(), api = new FakeApiClient(), runtime = new SimulationRuntime(ctx, api)
  runtime.connected('original-authority' as never)
  return { ctx, api, runtime }
}

it('keeps the selected case list while forwarding the next-page revision fence unchanged', async () => {
  const h = fixture()
  try {
    const summary = { apiVersion: 'clocky.world-case/v4', businessSummary: { status: 'unsupported' }, origin: { kind: 'decision' }, domain: 'organization', operation: 'generate-and-hire', version: '1',
      status: 'committed', requesterEntityId: 'requester', organizationEntityId: 'organization',
      targetEntityId: 'position', cancel: { allowed: false, reason: 'terminal' }, lifecycle: {
        request: { status: 'committed' }, plan: { status: 'none' }, execution: { callback: { status: 'none' },
          business: { status: 'committed', resultId: 'result' } }, notification: { request: null } } }
    const first = simulationProductWorldCasesPageSchema.parse({ ...page, snapshotRevision: 7, total: 2, nextCursor: 'original-next',
      items: [{ ...summary, requestId: 'case-first', intentId: 'intent-first' }] })
    const second = simulationProductWorldCasesPageSchema.parse({ ...page, snapshotRevision: 7, total: 2,
      items: [{ ...summary, requestId: 'case-second', intentId: 'intent-second' }] })
    const cases = vi.spyOn(h.api.simulations, 'listWorldCases').mockResolvedValueOnce(ok(first)).mockResolvedValueOnce(ok(second))
    const selected = { runId, status: 'committed' as const, limit: 1 }
    await h.runtime.listWorldCases(selected)
    const originalScope = h.runtime.state.getSnapshot().worldCases.scope
    const next = { ...selected, expectedRevision: first.snapshotRevision, cursor: first.nextCursor }
    await h.runtime.listWorldCases(next)
    expect(cases).toHaveBeenLastCalledWith(next, expect.any(AbortSignal))
    expect(h.runtime.state.getSnapshot().worldCases.scope).toBe(originalScope)
    expect(h.runtime.state.getSnapshot().worldCases.value).toEqual(second)
    expect(h.runtime.state.getSnapshot().worldCases.value?.items[0]?.requestId).toBe('case-second')
  } finally { await h.ctx.fiber.dispose() }
})

it('publishes one World window per read family without sending a creation or scheduling command', async () => {
  const h = fixture()
  try {
    const preflight = vi.spyOn(h.api.simulations, 'preflightWorld').mockResolvedValue(ok(preview))
    const cases = vi.spyOn(h.api.simulations, 'listWorldCases').mockResolvedValue(ok(page))
    vi.spyOn(h.api.simulations, 'inspectWorldCase').mockResolvedValue(ok(body()))
    vi.spyOn(h.api.simulations, 'exportWorldDefinition').mockResolvedValue(ok(exported))
    const create = vi.spyOn(h.api.simulations, 'createWorld'), prepare = vi.spyOn(h.api.simulations, 'prepareWorld')
    const cancel = vi.spyOn(h.api.simulations, 'cancelWorldCase'), manage = vi.spyOn(h.api.simulations, 'manage')
    expect((await h.runtime.preflightWorld(input))?.value).toEqual(preview)
    await h.runtime.listWorldCases({ runId, limit: 1 })
    await h.runtime.inspectWorldCase(detail)
    await h.runtime.exportWorldDefinition({ runId })
    const state = h.runtime.state.getSnapshot()
    expect(state.worldPreflight.scope).toBe(JSON.stringify(['worldPreflight', input]))
    expect(state.worldCases.scope).toBe(JSON.stringify(['worldCases', { runId }]))
    expect(state.worldCase.scope).toBe(JSON.stringify(['worldCase', runId, requestId, 'plans']))
    expect(state.worldExport.scope).toBe(JSON.stringify(['worldExport', runId]))
    expect(state.worldCases.value).toEqual(page)
    expect(state.worldCase.value).toEqual(body())
    expect(state.worldExport.value).toEqual(exported)
    await h.runtime.listWorldCases({ runId, limit: 1, cursor: 'next' as never })
    expect(cases).toHaveBeenLastCalledWith({ runId, limit: 1, cursor: 'next' }, expect.any(AbortSignal))
    expect(state.catalog.value).toBeUndefined()
    expect(preflight).toHaveBeenCalledOnce()
    for (const command of [create, prepare, cancel, manage]) expect(command).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it('rejects a replaced World draft result and explicitly retires preview, case and export windows', async () => {
  const h = fixture()
  try {
    const pending = Promise.withResolvers<ReturnType<typeof ok<SimulationProductWorldPreflightResult>>>()
    const read = vi.spyOn(h.api.simulations, 'preflightWorld').mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ok(preview))
    const first = h.runtime.preflightWorld(input)
    const changed = { definition: { ...input.definition, metadata: { ...input.definition.metadata, name: 'Replacement' } } }
    expect((await h.runtime.preflightWorld(changed))?.value).toEqual(preview)
    pending.resolve(ok(preview)); expect(await first).toBeUndefined()
    expect(read.mock.calls[0]?.[1]?.aborted).toBe(true)
    vi.spyOn(h.api.simulations, 'inspectWorldCase').mockResolvedValue(ok(body()))
    vi.spyOn(h.api.simulations, 'exportWorldDefinition').mockResolvedValue(ok(exported))
    await h.runtime.inspectWorldCase(detail); await h.runtime.exportWorldDefinition({ runId })
    h.runtime.closeWorldPreflight(); h.runtime.closeWorldCase(); h.runtime.closeWorldExport()
    for (const key of ['worldPreflight', 'worldCase', 'worldExport'] as const) {
      expect(h.runtime.state.getSnapshot()[key]).toEqual({ loading: false, stale: false })
    }
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['disconnect', 'replacement', 'pause', 'denial', 'run-change'] as const)(
  'clears private World content and rejects a late response after %s', async (action) => {
    const h = fixture()
    try {
      const waiting = Promise.withResolvers<ReturnType<typeof ok<ReturnType<typeof body>>>>()
      const read = vi.spyOn(h.api.simulations, 'inspectWorldCase').mockResolvedValueOnce(ok(body())).mockReturnValueOnce(waiting.promise)
      vi.spyOn(h.api.simulations, 'listWorldCases').mockResolvedValue(ok(page))
      vi.spyOn(h.api.simulations, 'exportWorldDefinition').mockResolvedValue(ok(exported))
      await h.runtime.inspectWorldCase(detail); await h.runtime.listWorldCases({ runId }); await h.runtime.exportWorldDefinition({ runId })
      const pending = h.runtime.inspectWorldCase(detail)
      if (action === 'disconnect') h.runtime.disconnected()
      else if (action === 'replacement') h.runtime.connected('replacement-authority' as never)
      else if (action === 'pause') h.runtime.pause()
      else if (action === 'denial') h.runtime.clearAuthorization()
      else {
        vi.spyOn(h.api.simulations, 'inspect').mockResolvedValueOnce(ok({ run: { id: 'another-run' as never,
          name: { text: 'Other', truncated: false }, registeredAt: 1, observation: 'not-observed' }, status: 'missing' }))
        await h.runtime.inspect({ runId: 'another-run' as never })
      }
      expect(read.mock.calls[1]?.[1]?.aborted).toBe(true)
      expect(h.runtime.state.getSnapshot().worldCase.value).toBeUndefined()
      waiting.resolve(ok(body())); await pending
      expect(h.runtime.state.getSnapshot().worldCase.value).toBeUndefined()
      expect(JSON.stringify(h.runtime.state.getSnapshot())).not.toContain('private-persona')
      if (action === 'disconnect') {
        expect(h.runtime.state.getSnapshot().worldCases).toMatchObject({ value: page, stale: true })
        expect(h.runtime.state.getSnapshot().worldExport).toMatchObject({ value: exported, stale: true })
      }
    } finally { await h.ctx.fiber.dispose() }
  })

it('clears World case bodies and retires pending World reads on an observed policy reset', async () => {
  const h = fixture()
  try {
    const changed = Promise.withResolvers<ReturnType<typeof ok<SimulationProductWatchResult>>>()
    const hint = (readVersion: string, status: SimulationProductWatchResult['status']): SimulationProductWatchResult => ({
      runId, readVersion: readVersion as never, status, observedAt: 1, cursor: readVersion as never, world: { status: 'observed', revision: 1 } })
    const watch = vi.spyOn(h.api.simulations, 'watch').mockResolvedValueOnce(ok(hint('v1', 'changed')))
      .mockReturnValueOnce(changed.promise).mockImplementation((_input, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('retired')) }, { once: true })
      }))
    const stop = h.runtime.observe(runId, { waitMs: 10, retryMs: 1 })
    await vi.waitFor(() => { expect(watch).toHaveBeenCalledTimes(2) })
    const read = vi.spyOn(h.api.simulations, 'inspectWorldCase').mockResolvedValueOnce(ok(body()))
    await h.runtime.inspectWorldCase(detail)
    const waiting = Promise.withResolvers<ReturnType<typeof ok<ReturnType<typeof body>>>>()
    read.mockReturnValueOnce(waiting.promise)
    const pending = h.runtime.inspectWorldCase(detail)
    const authority = h.runtime.state.getSnapshot().authorizationVersion
    changed.resolve(ok(hint('v2', 'reset')))
    await vi.waitFor(() => { expect(h.runtime.state.getSnapshot().observation.value?.readVersion).toBe('v2') })
    expect(h.runtime.state.getSnapshot().authorizationVersion).toBe(authority)
    expect(h.runtime.state.getSnapshot().worldCase.value).toBeUndefined()
    waiting.resolve(ok(body())); await pending
    read.mockResolvedValueOnce(ok(body()))
    await h.runtime.inspectWorldCase(detail)
    expect(h.runtime.state.getSnapshot().worldCase).toMatchObject({ stale: true, error: 'stale' })
    expect(h.runtime.state.getSnapshot().worldCase.value).toBeUndefined()
    read.mockResolvedValueOnce(ok(body('v2'))); await h.runtime.inspectWorldCase(detail)
    expect(h.runtime.state.getSnapshot().worldCase.value).toEqual(body('v2'))
    stop()
  } finally { await h.ctx.fiber.dispose() }
})

const create: SimulationCommand = { kind: 'world-create', input: simulationProductWorldCreateInputSchema.parse({ ...input,
  name: 'World', commandId: 'world-original', preflight: { hash: `sha256:${'a'.repeat(64)}`, catalogGeneration: 'catalog-v1' } }) }
const prepare: SimulationCommand = { kind: 'world-prepare', input: { runId, commandId: 'prepare-original' as never } }
const cancellation: SimulationCommand = { kind: 'cancel-world-case', input: { runId, commandId: 'cancel-original' as never, requestId,
  previewRevision: 3, previewHash: `sha256:${'c'.repeat(64)}` } }
it.each([[create, 'createWorld'], [prepare, 'prepareWorld'], [cancellation, 'cancelWorldCase']] as const)(
  'retains %j as one exact original across lost replies, lookup and explicit retry', async (command, method) => {
    const h = fixture()
    try {
      const admin = h.runtime.administration(h.ctx, { maxCommands: 8, maxBytes: 65536 })
      const key = admin.retain(command, h.runtime.state.getSnapshot().authorizationVersion)
      expect(key).toBe(JSON.stringify(['request', command.input.commandId]))
      const receipt = { runId, commandId: command.input.commandId, kind: command.kind, status: 'accepted' as const, acceptedAt: 1 }
      const send = vi.spyOn(h.api.simulations, method).mockRejectedValueOnce(new Error('reply lost')).mockResolvedValueOnce(ok(receipt))
      expect(await admin.submit(key)).toMatchObject({ unknown: true, error: 'network' })
      vi.spyOn(h.api.simulations, 'request').mockResolvedValueOnce(ok({ status: 'found', request: receipt,
        ...command.kind === 'cancel-world-case' ? { worldCancellation: command.input } : {} }))
      expect(await admin.query(key)).toMatchObject({ unknown: false, receipt: { kind: 'request', value: receipt } })
      expect(await admin.submit(key)).toMatchObject({ receipt: { kind: 'request', value: receipt } })
      expect(send).toHaveBeenCalledTimes(2)
      expect(send.mock.calls[1]?.[0]).toEqual(command.input)
      expect(simulationCommandKey(command)).toBe(key)
      expect(() => admin.retain({ ...command, input: { ...command.input, name: 'changed' } } as SimulationCommand,
        h.runtime.state.getSnapshot().authorizationVersion)).toThrow(/another payload/)
    } finally { await h.ctx.fiber.dispose() }
  })

it.each(['runId', 'commandId', 'requestId', 'previewRevision', 'previewHash', 'missing', 'extra', 'wrong-kind'] as const)(
  'keeps World cancellation uncertainty when the original lookup substitutes %s', async (field) => {
    const h = fixture()
    try {
      const admin = h.runtime.administration(h.ctx, { maxCommands: 8, maxBytes: 65536 })
      const key = admin.retain(cancellation, h.runtime.state.getSnapshot().authorizationVersion)
      vi.spyOn(h.api.simulations, 'cancelWorldCase').mockRejectedValueOnce(new Error('reply lost'))
      await admin.submit(key)
      const original = field === 'wrong-kind' ? cancellation.input : { ...cancellation.input, [field]: 'foreign' }
      vi.spyOn(h.api.simulations, 'request').mockResolvedValueOnce(ok({ status: 'found',
        request: { runId, commandId: cancellation.input.commandId, kind: field === 'wrong-kind' ? 'world-prepare' : 'cancel-world-case',
          status: 'completed', acceptedAt: 1 }, ...field === 'missing' ? {} : { worldCancellation: original } }) as never)
      expect(await admin.query(key)).toMatchObject({ unknown: true, error: 'network' })
      expect(admin.state.getSnapshot().commands[key]?.receipt).toBeUndefined()
      expect(admin.release(key)).toBe(false)
    } finally { await h.ctx.fiber.dispose() }
  })

it('withholds refused case windows without turning an authored World draft refusal into authority replacement', async () => {
  const h = fixture()
  try {
    const failure = { code: 'simulation-product-forbidden', message: 'Withheld', details: {} } as const
    vi.spyOn(h.api.simulations, 'preflightWorld').mockResolvedValueOnce(err<SimulationProductWorldPreflightResult>(failure))
    const authority = h.runtime.state.getSnapshot().authorizationVersion
    expect((await h.runtime.preflightWorld(input))?.error).toBe('forbidden')
    expect(h.runtime.state.getSnapshot().authorizationVersion).toBe(authority)
    vi.spyOn(h.api.simulations, 'inspectWorldCase').mockResolvedValueOnce(ok(body())).mockResolvedValueOnce(err<ReturnType<typeof body>>(failure))
    await h.runtime.inspectWorldCase(detail); await h.runtime.inspectWorldCase(detail)
    expect(h.runtime.state.getSnapshot().worldCase).toMatchObject({ error: 'forbidden' })
    expect(h.runtime.state.getSnapshot().worldCase.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})

it('compares World creation journal metadata before a local run receipt exists and refuses another command family', async () => {
  const h = fixture()
  try {
    const admin = h.runtime.administration(h.ctx, { maxCommands: 8, maxBytes: 65536 })
    const key = admin.retain(create, h.runtime.state.getSnapshot().authorizationVersion)
    const metadata = { runId, commandId: create.input.commandId, kind: 'world-create' as const, status: 'completed' as const, acceptedAt: 1 }
    h.runtime.state.set({ ...h.runtime.state.getSnapshot(), persistentRequests: { loading: false, stale: false,
      value: { runId, snapshotRevision: 2, total: 1, items: [{ ...metadata, kind: 'create' }] } } })
    expect(admin.state.getSnapshot().commands[key]?.requestObservation).toBeUndefined()
    h.runtime.state.set({ ...h.runtime.state.getSnapshot(), persistentRequests: { loading: false, stale: false,
      value: { runId, snapshotRevision: 2, total: 1, items: [metadata] } } })
    expect(admin.state.getSnapshot().commands[key]?.requestObservation).toMatchObject({ status: 'completed', comparison: 'metadata-only' })
  } finally { await h.ctx.fiber.dispose() }
})

it('preserves an acknowledged terminal World receipt when a later lookup downgrades its status or changes acceptance', async () => {
  const h = fixture()
  try {
    const admin = h.runtime.administration(h.ctx, { maxCommands: 8, maxBytes: 65536 })
    const key = admin.retain(prepare, h.runtime.state.getSnapshot().authorizationVersion)
    const receipt = { runId, commandId: prepare.input.commandId, kind: 'world-prepare' as const, status: 'completed' as const, acceptedAt: 1 }
    vi.spyOn(h.api.simulations, 'prepareWorld').mockResolvedValueOnce(ok(receipt))
    await admin.submit(key)
    const lookup = vi.spyOn(h.api.simulations, 'request')
    for (const patch of [{ status: 'accepted' }, { acceptedAt: 2 }, { kind: 'prepare' }, { runId: 'foreign' }]) {
      lookup.mockResolvedValueOnce(ok({ status: 'found', request: { ...receipt, ...patch } }) as never)
      expect(await admin.query(key)).toMatchObject({ receipt: { kind: 'request', value: receipt }, error: 'network' })
    }
  } finally { await h.ctx.fiber.dispose() }
})

it('distinguishes an unaccepted World preview from an unknown original and preserves accepted receipts', async () => {
  const h = fixture()
  try {
    const admin = h.runtime.administration(h.ctx, { maxCommands: 8, maxBytes: 65536 })
    const retain = () => admin.retain(create, h.runtime.state.getSnapshot().authorizationVersion)
    const key = retain()
    const refused = { code: 'simulation-product-preflight-changed' as const, message: 'Preview again', details: {} }
    const send = vi.spyOn(h.api.simulations, 'createWorld').mockResolvedValueOnce(err(refused))
    expect(await admin.submit(key)).toMatchObject({ unknown: false, notAccepted: true, error: 'preflight-changed' })
    const lookup = vi.spyOn(h.api.simulations, 'request').mockResolvedValue(ok({ status: 'not-found', commandId: create.input.commandId }))
    expect(await admin.query(key)).toMatchObject({ unknown: false, notAccepted: true, notFound: true })
    expect(admin.release(key)).toBe(true)
    retain()
    send.mockResolvedValueOnce(err({ code: 'simulation-product-invalid', message: 'Invalid original', details: {} }))
    expect(await admin.submit(key)).toMatchObject({ unknown: true })
    expect(await admin.query(key)).toMatchObject({ unknown: true, notFound: true })
    expect(admin.release(key)).toBe(false)
    const receipt = { runId, commandId: create.input.commandId, kind: 'world-create' as const, status: 'completed' as const, acceptedAt: 1 }
    lookup.mockResolvedValueOnce(ok({ status: 'found', request: receipt }))
    await admin.query(key)
    send.mockResolvedValueOnce(err(refused))
    expect(await admin.submit(key)).toMatchObject({ receipt: { kind: 'request', value: receipt } })
    expect(admin.state.getSnapshot().commands[key]?.notAccepted).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})
