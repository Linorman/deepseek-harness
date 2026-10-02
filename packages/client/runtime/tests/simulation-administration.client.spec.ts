/** Original commands preserve exact payloads across disconnects and view changes; authority retirement clears them. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import { simulationCommandKey } from '../src/client/simulations/administration.ts'
import type { SimulationProductRequestReceipt, SimulationProductPrepareInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationCommand } from '../src/client/simulations/administration.ts'
import { FakeApiClient, ok, err } from './fake-api.client.ts'
import type { ProductAuthorizationScope } from '@clocky/clocky-host-apiproxy/api/rpc'

const create: SimulationCommand = { kind: 'create', input: { commandId: 'original', templateId: 'company', templateVersion: '1',
  name: 'Company', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } } } as SimulationCommand
const receipt: SimulationProductRequestReceipt = { commandId: 'original' as never, runId: 'run' as never,
  kind: 'create', status: 'accepted', acceptedAt: 1 }
const call: SimulationProductPrepareInput = { runId: 'run' as never, commandId: 'original' as never }
const cases: ReadonlyArray<[SimulationCommand, keyof FakeApiClient['simulations'], unknown]> = [
  [create, 'create', receipt],
  [{ kind: 'retry-request', input: call }, 'retryRequest', receipt],
  [{ kind: 'retry-operation', input: { ...call, operationId: 'operation', expectedAttemptCount: 1,
    reason: 'Reconcile persisted original target' } as never }, 'retryOperation', { ...receipt, kind: 'retry-operation' }],
  [{ kind: 'review', input: { ...call, operationId: 'operation', attemptId: 'attempt', expectedRevision: 2,
    nextPhase: 'completed', reason: 'Approve original attempt' } as never }, 'resolveTaskReview', { ...receipt, kind: 'review' }],
  [{ kind: 'prepare', input: call }, 'prepare', { ...receipt, kind: 'prepare' }],
  [{ kind: 'checkpoint', input: call }, 'checkpoint', { ...receipt, kind: 'checkpoint', checkpointId: 'full' }],
  [{ kind: 'restore', input: { ...call, checkpointId: 'full' } as never }, 'restore', { ...receipt, kind: 'restore', checkpointId: 'full' }],
  [{ kind: 'manage', input: { runId: 'run', managementId: 'original', phase: 'running' } as never }, 'manage',
    { runId: 'run', operation: { managementId: 'original', phase: 'running', status: 'completed', startedSequence: 1, finishedSequence: 2 } }],
  [{ kind: 'ingress', input: { runId: 'run', ingressId: 'original', entityId: 'buyer', text: 'Input', availableAt: '9007199254740993' } as never }, 'ingress',
    { runId: 'run', ingressId: 'original', entityId: 'buyer', eventId: 'event', availableAt: '9007199254740993',
      assignedAt: '9007199254740993', sequence: 1, status: 'pending' }],
]
function fixture(maxCommands = 8, maxBytes = 65536) {
  const ctx = new Context()
  const api = new FakeApiClient()
  const source = new SimulationRuntime(ctx, api)
  source.connected('reader' as ProductAuthorizationScope)
  const admin = source.administration(ctx, { maxCommands, maxBytes })
  return { ctx, api, source, admin,
    retain: (command: SimulationCommand) => admin.retain(command, source.state.getSnapshot().authorizationVersion) }
}

it('preserves a refused review original and independent viewing until actual authentication retires', async () => {
  const h = fixture()
  try {
    const review: SimulationCommand = { kind: 'review', input: { ...call, operationId: 'operation' as never,
      attemptId: 'attempt' as never, expectedRevision: 2, nextPhase: 'completed', reason: 'Original reason' } }
    const key = h.retain(review)
    const version = h.source.state.getSnapshot().authorizationVersion
    vi.spyOn(h.api.simulations, 'resolveTaskReview').mockResolvedValueOnce(err({ code: 'simulation-product-forbidden',
      message: 'Review permission denied', details: {} }))
      .mockResolvedValueOnce(err({ code: 'PRODUCT_AUTH_INVALID', message: 'Authentication retired', details: {} }))
    expect(await h.admin.submit(key)).toMatchObject({ command: review, pending: false, error: 'forbidden', unknown: true })
    expect(h.source.state.getSnapshot().authorizationVersion).toBe(version)
    expect(h.source.state.getSnapshot().connected).toBe(true)
    expect(h.admin.state.getSnapshot().commands[key]?.command).toEqual(review)
    await h.admin.submit(key)
    expect(h.admin.state.getSnapshot().commands).toEqual({})
    expect(h.source.state.getSnapshot().authorizationVersion).toBeGreaterThan(version)
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps the retry grant original uncertain when lookup returns another attempt fence or reason', async () => {
  const h = fixture()
  try {
    const command: SimulationCommand = { kind: 'retry-operation', input: { ...call, operationId: 'operation' as never,
      expectedAttemptCount: 1, reason: 'Original target evidence' } }
    const key = h.retain(command)
    const send = vi.spyOn(h.api.simulations, 'retryOperation').mockRejectedValueOnce(new Error('Response lost'))
    await h.admin.submit(key)
    const query = vi.spyOn(h.api.simulations, 'request').mockResolvedValueOnce(ok({ status: 'found',
      request: { ...receipt, kind: 'retry-operation', status: 'completed' }, retryOperation: { ...command.input, expectedAttemptCount: 2 } }))
    expect(await h.admin.query(key)).toMatchObject({ command, unknown: true, error: 'network' })
    expect(h.admin.state.getSnapshot().commands[key]?.receipt).toBeUndefined()
    expect(() => h.retain({ ...command, input: { ...command.input, reason: 'Changed intent' } })).toThrow(/another payload/)
    expect(send).toHaveBeenCalledOnce(); expect(query).toHaveBeenCalledOnce()
  } finally { await h.ctx.fiber.dispose() }
})

it.each(cases)('submits the retained %s to the existing authenticated API and independently reads its result', async (command, method, result) => {
  const h = fixture()
  try {
    const operation = vi.spyOn(h.api.simulations, method).mockResolvedValue(ok(result) as never)
    const key = h.retain(command)
    expect(h.retain(structuredClone(command))).toBe(key)
    expect((await h.admin.submit(key))?.receipt).toBeDefined()
    expect(operation).toHaveBeenCalledWith(command.input, expect.any(AbortSignal))
    expect(operation).toHaveBeenCalledTimes(1)
    const queryMethod = command.kind === 'manage' ? 'managementRequest' : command.kind === 'ingress' ? 'ingressRequest' : 'request'
    const found = command.kind === 'manage' ? { runId: 'run', managementId: 'original', status: 'found', operation: (result as { operation: unknown }).operation }
      : command.kind === 'ingress' ? { runId: 'run', ingressId: 'original', status: 'found', receipt: result } : { status: 'found', request: result,
        ...command.kind === 'retry-operation' ? { retryOperation: command.input } : {},
        ...command.kind === 'review' ? { review: { ...command.input, reason: command.input.reason.trim() } } : {} }
    const query = vi.spyOn(h.api.simulations, queryMethod).mockResolvedValueOnce(ok(found) as never)
      .mockResolvedValueOnce(ok({ status: 'not-found' }) as never)
    expect((await h.admin.query(key))?.receipt).toBeDefined()
    expect(operation).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(command.kind === 'manage' ? { runId: 'run', managementId: 'original' }
      : command.kind === 'ingress' ? { runId: 'run', ingressId: 'original' } : { commandId: 'original' }, expect.any(AbortSignal))
    expect(await h.admin.query(key)).toMatchObject({ notFound: true, unknown: false })
    await h.admin.submit(key)
    expect(operation).toHaveBeenCalledTimes(2)
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps uncertain original input, ignores later input and explicitly retries after not-found without allocating an identity', async () => {
  const h = fixture()
  try {
    const send = vi.spyOn(h.api.simulations, 'create').mockRejectedValueOnce(new Error('Lost response')).mockResolvedValueOnce(ok(receipt))
    const key = h.retain(create)
    expect(await h.admin.submit(key)).toMatchObject({ unknown: true, error: 'network', command: create })
    vi.spyOn(h.api.simulations, 'request').mockResolvedValueOnce(ok({ status: 'not-found', commandId: 'original' }) as never)
    expect(await h.admin.query(key)).toMatchObject({ unknown: true, notFound: true })
    expect(() => h.retain({ ...create, input: { ...create.input, name: 'Later' } } as SimulationCommand)).toThrow('another payload')
    h.source.pause()
    h.source.disconnected()
    h.source.connected('reader' as ProductAuthorizationScope)
    await h.admin.submit(key)
    expect(send.mock.calls.map(([input]) => input)).toEqual([create.input, create.input])
    expect(Object.keys(h.admin.state.getSnapshot().commands)).toEqual([key])
  } finally { await h.ctx.fiber.dispose() }
})

it('coalesces competing submits and refuses unresolved release while preserving a terminal original', async () => {
  const h = fixture()
  try {
    const response = Promise.withResolvers<ReturnType<typeof ok<typeof receipt>>>()
    const send = vi.spyOn(h.api.simulations, 'create').mockReturnValue(response.promise)
    const key = h.retain(create)
    const pending = h.admin.submit(key)
    expect(await h.admin.submit(key)).toMatchObject({ pending: true })
    expect(h.admin.release(key)).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    response.resolve(ok({ ...receipt, status: 'completed' } as never)); await pending
    expect(h.admin.release(key)).toBe(true)
    expect(h.admin.release(key)).toBe(false)
    expect(await h.admin.query(key)).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['consumed', 'cancelled', 'pending'] as const)('distinguishes ingress %s from terminal creation or management results', async (status) => {
  const h = fixture()
  try {
    const [command, , result] = cases.find(([command]) => command.kind === 'ingress')!
    vi.spyOn(h.api.simulations, 'ingress').mockResolvedValue(ok({ ...result as object, status }) as never)
    const key = h.retain(command); await h.admin.submit(key)
    expect(h.admin.release(key)).toBe(status !== 'pending')
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['simulation-product-unavailable', 'simulation-product-stale', 'simulation-product-invalid', 'bad-request', 'internal'] as const)
('retains the original after %s without exposing private messages or inferring failure', async (code) => {
  const h = fixture()
  try {
    vi.spyOn(h.api.simulations, 'create').mockResolvedValue(err({ code, message: 'secret provider data', details: {} } as import('@clocky/clocky-client-connection/client').RpcError) as never)
    const key = h.retain(create)
    expect(await h.admin.submit(key)).toMatchObject({ unknown: true, error: code === 'bad-request' ? 'invalid' : code.replace('simulation-product-', '') })
    expect(JSON.stringify(h.admin.state.getSnapshot())).not.toContain('secret provider data')
    expect(h.admin.release(key)).toBe(false)
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['PRODUCT_AUTH_INVALID', 'PRODUCT_AUTH_REQUIRED', 'simulation-product-forbidden'] as const)
('clears old originals on explicit %s', async (code) => {
  const h = fixture()
  try {
    vi.spyOn(h.api.simulations, 'create').mockResolvedValue(err({ code, message: 'Denied', details: {} }) as never)
    const key = h.retain(create)
    expect(await h.admin.submit(key)).toBeUndefined()
    expect(h.admin.state.getSnapshot().commands).toEqual({})
    expect(h.source.state.getSnapshot().connected).toBe(code === 'simulation-product-forbidden')
  } finally { await h.ctx.fiber.dispose() }
})

it('discards old responses after ordinary disconnect and keeps originals, then clears them on account replacement', async () => {
  const h = fixture()
  try {
    const response = Promise.withResolvers<ReturnType<typeof ok<typeof receipt>>>()
    vi.spyOn(h.api.simulations, 'create').mockReturnValue(response.promise)
    const key = h.retain(create)
    const pending = h.admin.submit(key)
    h.source.disconnected()
    await h.admin.query(key)
    response.resolve(ok(receipt)); expect(await pending).toBeUndefined()
    expect(h.admin.state.getSnapshot().commands[key]).toMatchObject({ pending: false, unknown: true })
    expect(() => h.retain(create)).toThrow('unavailable')
    h.source.connected('replacement' as ProductAuthorizationScope)
    expect(await h.admin.query(key)).toBeUndefined()
    expect(h.admin.state.getSnapshot().commands).toEqual({})
  } finally { await h.ctx.fiber.dispose() }
})

it('enforces retained count and UTF-8 bytes without displacing original inputs or accepting oversized receipts', async () => {
  const h = fixture(1, 1024)
  const tiny = fixture(1, 1)
  try {
    expect(() => tiny.retain(create)).toThrow('capacity')
    const key = h.retain(create)
    expect(() => h.retain({ ...create, input: { ...create.input, commandId: 'other' } } as SimulationCommand)).toThrow('capacity')
    expect(() => h.retain({ ...create, input: { ...create.input, commandId: 'other', name: '汉字'.repeat(200) } } as SimulationCommand)).toThrow('capacity')
    vi.spyOn(h.api.simulations, 'create').mockResolvedValue(ok({ ...receipt, runId: 'a'.repeat(2000) }) as never)
    expect(await h.admin.submit(key)).toMatchObject({ unknown: true, error: 'unavailable' })
    expect(h.admin.state.getSnapshot().commands[key]?.command).toEqual(create)
    expect(h.admin.state.getSnapshot().commands[key]?.receipt).toBeUndefined()
  } finally { await h.ctx.fiber.dispose(); await tiny.ctx.fiber.dispose() }
})

it('retires callbacks before abort, rejects new work during teardown and clears private originals', async () => {
  const h = fixture()
  const response = Promise.withResolvers<ReturnType<typeof ok<typeof receipt>>>()
  let prevented = false
  vi.spyOn(h.api.simulations, 'create').mockImplementation((_input, signal) => {
    signal?.addEventListener('abort', () => {
      try { h.retain(create) } catch { prevented = true }
      void h.admin.submit(simulationCommandKey(create))
    })
    return response.promise
  })
  const key = h.retain(create)
  const pending = h.admin.submit(key)
  await h.ctx.fiber.dispose()
  response.resolve(ok(receipt)); expect(await pending).toBeUndefined()
  expect(prevented).toBe(true)
  expect(h.admin.state.getSnapshot().commands).toEqual({})
})

it('rejects stale authoring context, retires before send when an observer disconnects, and ignores a cancelled transport failure', async () => {
  const h = fixture()
  try {
    const authored = h.source.state.getSnapshot().authorizationVersion
    h.source.connected('replacement' as ProductAuthorizationScope)
    expect(() => h.admin.retain(create, authored)).toThrow('unavailable')
    const key = h.retain(create)
    const send = vi.spyOn(h.api.simulations, 'create')
    const off = h.admin.state.subscribe(() => {
      if (h.admin.state.getSnapshot().commands[key]?.pending) h.source.disconnected()
    })
    expect(await h.admin.submit(key)).toBeUndefined()
    off(); expect(send).not.toHaveBeenCalled()
    h.source.connected('replacement' as ProductAuthorizationScope)
    const response = Promise.withResolvers<ReturnType<typeof ok<SimulationProductRequestReceipt>>>()
    send.mockReturnValue(response.promise)
    const pending = h.admin.submit(key)
    h.source.disconnected()
    response.reject(new Error('Cancelled response'))
    expect(await pending).toBeUndefined()
    expect(h.admin.state.getSnapshot().commands[key]?.error).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})

it('allows release of a known failed original but refuses in-progress results and missing local keys', async () => {
  const h = fixture()
  try {
    const key = h.retain(create)
    vi.spyOn(h.api.simulations, 'create').mockResolvedValue(ok({ ...receipt, status: 'failed', failure: 'preparation-required' }))
    await h.admin.submit(key); expect(h.admin.release(key)).toBe(true)
    const [command] = cases.find(([command]) => command.kind === 'manage')!
    const managed = h.retain(command)
    vi.spyOn(h.api.simulations, 'manage').mockResolvedValue(ok({ runId: 'run', operation: { managementId: 'original',
      phase: 'running', status: 'in-progress', startedSequence: 1 } }) as never)
    await h.admin.submit(managed); expect(h.admin.release(managed)).toBe(false)
    expect(await h.admin.submit('missing' as never)).toBeUndefined()
    expect(await h.admin.query('missing' as never)).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})
