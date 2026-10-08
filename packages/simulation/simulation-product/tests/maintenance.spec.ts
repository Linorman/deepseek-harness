/** Original native maintenance/ingress operations retain facts across checkpoint collection and explicit cold recovery. */
import { Context } from '@clocky/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { SimulationCompanyOwner } from '../src/company-owner.ts'
import { simulationIngressRequestSchema } from '@clocky/clocky-simulation'
import { ownerFixture } from './company-owner-fixture.ts'
import { call } from './fixtures.ts'
import { simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema,
  simulationProductIngressInputSchema, simulationProductIngressQuerySchema } from '../src/maintenance-schema.ts'
import { simulationProductManageInputSchema } from '../src/control-schema.ts'

const phase = (runId: string, managementId: string, target: 'running' | 'paused' = 'running') =>
  simulationProductManageInputSchema.parse({ runId, managementId, phase: target })
afterEach(() => { vi.restoreAllMocks() })

async function capturedOwner(h: Awaited<ReturnType<typeof ownerFixture>>, runId: import('../src/types.ts').SimulationProductRunId) {
  // oxlint-disable-next-line typescript/unbound-method -- The probe forwards the original observer with its exact receiver.
  const observe = SimulationCompanyOwner.prototype.observe
  const owners = new Set<SimulationCompanyOwner>()
  const probe = vi.spyOn(SimulationCompanyOwner.prototype, 'observe').mockImplementation(function (this: SimulationCompanyOwner) {
    owners.add(this)
    return observe.call(this)
  })
  await h.ctx.simulationAdministration.control({ runId }, call())
  probe.mockRestore()
  const owner = owners.values().next().value
  if (owner === undefined) throw new Error('Prepared run has no product owner')
  return owner
}

it.each(['json', 'sqlite'] as const)('collects a complete original checkpoint and restores current history paused without inference (%s)', async (backend) => {
  const h = await ownerFixture(backend)
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    await service.manage(phase(runId, 'start'), call())
    await vi.waitFor(async () => { expect((await service.control({ runId }, call())).driver).toBe('completed') }, { timeout: 5000, interval: 5 })
    const before = h.owned().snapshot()
    const calls = h.requests.length
    const request = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'complete-cut' })
    const accepted = await service.checkpoint(request, call())
    expect(accepted).toMatchObject({ kind: 'checkpoint', status: 'accepted', checkpointId: 'product-checkpoint/complete-cut' })
    const checkpoint = await h.finished(request.commandId)
    expect(checkpoint.status).toBe('completed')
    expect(h.owned().snapshot().phase).toBe('paused')
    expect(h.owned().snapshot().resources).toEqual(before.resources)
    expect(Object.values(h.owned().snapshot().entities).every(entity => entity.writer === undefined || entity.writer.phase === 'released')).toBe(true)
    expect(h.requests).toHaveLength(calls)
    const current = h.owned().snapshot()
    expect(await service.checkpoint(request, call())).toEqual(checkpoint)
    expect(h.owned().snapshot()).toEqual(current)
    await h.fiber.dispose(); await h.mount()
    const next = h.ctx.simulationAdministration
    const input = simulationProductRestoreInputSchema.parse({ runId, commandId: 'recover-original', checkpointId: checkpoint.checkpointId })
    expect((await next.restore(input, call())).status).toBe('accepted')
    const restored = await h.finished(input.commandId)
    expect(restored.status).toBe('completed')
    expect(await next.control({ runId }, call())).toMatchObject({ owner: 'held', phase: 'paused', driver: 'idle' })
    expect(h.owned().snapshot().resources).toEqual(before.resources)
    expect(h.requests).toHaveLength(calls)
    const observations = vi.spyOn(h.ctx.simulationTeams, 'restore')
    expect(await next.restore(input, call())).toEqual(restored)
    expect(observations).not.toHaveBeenCalled()
    const second = { ...input, commandId: 'revalidate-suffix' as never }
    await next.restore(second, call())
    expect((await h.finished(second.commandId)).status).toBe('completed')
    expect(observations).toHaveBeenCalledTimes(1)
    expect(h.requests).toHaveLength(calls)
    await expect(next.restore({ ...input, checkpointId: 'other' as never }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
  } finally { await h.close() }
})

it('keeps a cold restore failure attributed to unavailable native history', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    await h.fiber.dispose(); await h.mount()
    vi.spyOn(h.ctx.simulations, 'inspect').mockRejectedValueOnce(new Error('Native history volume is offline'))
    const input = simulationProductRestoreInputSchema.parse({ runId, commandId: 'offline-native-restore',
      checkpointId: `product-initial/${h.input.commandId}` })
    expect((await h.ctx.simulationAdministration.restore(input, call())).status).toBe('accepted')
    expect(await h.finished(input.commandId)).toMatchObject({ status: 'failed', failure: 'restore-failed',
      diagnostic: { stage: 'restore', code: 'source-unavailable' } })
    expect(await h.ctx.simulationAdministration.request({ commandId: input.commandId }, call()))
      .toMatchObject({ status: 'found', request: { status: 'failed' } })
  } finally { await h.close() }
})

it('retains a native failed checkpoint result with its safe diagnostic', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const native = vi.spyOn(SimulationCompanyOwner.prototype, 'checkpoint').mockImplementationOnce(async request => ({ request,
      startedSequence: 1, finishedSequence: 2, status: 'failed', error: 'private collector details',
      diagnostic: { stage: 'collect', code: 'source-unavailable', subject: { kind: 'run' } },
    }))
    const input = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'native-failed-cut' })
    await h.ctx.simulationAdministration.checkpoint(input, call())
    const failed = await h.finished(input.commandId)
    expect(native).toHaveBeenCalledOnce()
    expect(failed).toMatchObject({ status: 'failed', failure: 'checkpoint-failed',
      diagnostic: { stage: 'collect', code: 'source-unavailable' } })
    expect(JSON.stringify(failed)).not.toContain('private collector details')
  } finally { await h.close() }
})

it('keeps a nonterminal checkpoint reply as a failed original without inventing a diagnostic', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const native = vi.spyOn(SimulationCompanyOwner.prototype, 'checkpoint').mockImplementationOnce(async request => ({
      request, startedSequence: 1, status: 'in-progress',
    }))
    const input = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'in-progress-cut' })
    await h.ctx.simulationAdministration.checkpoint(input, call())
    const failed = await h.finished(input.commandId)
    expect(native).toHaveBeenCalledOnce()
    expect(failed).toMatchObject({ status: 'failed', failure: 'checkpoint-failed' })
    expect(failed.diagnostic).toBeUndefined()
  } finally { await h.close() }
})

it('retires an accepted inference during checkpoint collection and keeps the browser waiter independent', async () => {
  const h = await ownerFixture()
  const started = Promise.withResolvers<undefined>()
  const cancelled = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const stream = h.adapter.stream.bind(h.adapter)
  vi.spyOn(h.adapter, 'stream').mockImplementationOnce(async function* (options) {
    options.signal?.addEventListener('abort', () => { cancelled.resolve(undefined) }, { once: true })
    started.resolve(undefined); await finish.promise; yield* stream(options)
  })
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    await service.manage(phase(runId, 'start'), call())
    await started.promise
    const input = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'during-inference' })
    const receipt = await service.checkpoint(input, call())
    expect(receipt.status).toBe('accepted')
    await cancelled.promise
    expect((await service.control({ runId }, call()))).toMatchObject({ phase: 'paused', inFlight: true, driver: 'checkpointing' })
    finish.resolve(undefined)
    expect((await h.finished(input.commandId)).status).toBe('completed')
    expect(h.owned().snapshot().activeWindowId).toBeUndefined()
    expect(h.owned().snapshot().phase).toBe('paused')
    expect((await service.control({ runId }, call())).inFlight).toBe(false)
    expect(h.owned().snapshot().resources['received' as never]?.quantity).toBe('0')
  } finally { finish.resolve(undefined); await h.close() }
})

it.each(['json', 'sqlite'] as const)('retains one attributed input, consumes it after explicit scheduling and preserves current suffix on restore (%s)', async (backend) => {
  const h = await ownerFixture(backend)
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    const input = simulationProductIngressInputSchema.parse({ runId, ingressId: 'original-input', entityId: 'buyer',
      text: 'Observe this authorized input.', availableAt: '7' })
    const before = h.owned().snapshot()
    const receipt = await service.ingress(input, call())
    expect(receipt).toMatchObject({ ingressId: input.ingressId, entityId: 'buyer', availableAt: '7', assignedAt: '7', status: 'pending' })
    expect(JSON.stringify(receipt)).not.toContain(input.text)
    expect(JSON.stringify(receipt)).not.toContain('product-principal')
    expect(h.owned().snapshot().resources).toEqual(before.resources)
    expect(h.owned().snapshot().phase).toBe('paused')
    expect(h.requests).toEqual([])
    const snapshot = h.owned().snapshot()
    expect(await service.ingress(input, call())).toEqual(receipt)
    expect(h.owned().snapshot()).toEqual(snapshot)
    await expect(service.ingress({ ...input, text: 'changed' }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    await service.manage(phase(runId, 'start'), call())
    await vi.waitFor(async () => {
      const result = await service.ingressRequest(simulationProductIngressQuerySchema.parse({ runId, ingressId: input.ingressId }), call())
      expect(result).toMatchObject({ status: 'found', receipt: { status: 'consumed' } })
    }, { timeout: 5000, interval: 5 })
    await vi.waitFor(async () => { expect((await service.control({ runId }, call())).driver).toBe('completed') }, { timeout: 5000, interval: 5 })
    const future = { ...input, ingressId: 'future-input' as never, text: 'Another authorized input.', availableAt: '30' as never }
    await service.ingress(future, call())
    await vi.waitFor(async () => {
      const result = await service.ingressRequest({ runId, ingressId: future.ingressId }, call())
      expect(result).toMatchObject({ status: 'found', receipt: { assignedAt: '30', status: 'consumed' } })
    }, { timeout: 5000, interval: 5 })
    const calls = h.requests.length
    const initial = simulationProductRestoreInputSchema.parse({ runId, commandId: 'suffix-restore', checkpointId: `product-initial/${h.input.commandId}` })
    const facts = h.owned().snapshot()
    await service.restore(initial, call())
    expect((await h.finished(initial.commandId)).status).toBe('completed')
    expect(h.owned().snapshot().resources).toEqual(facts.resources)
    expect(Object.keys(h.owned().snapshot().ingresses ?? {})).toEqual(Object.keys(facts.ingresses ?? {}))
    expect(h.owned().snapshot().phase).toBe('paused')
    expect(h.requests).toHaveLength(calls)
  } finally { await h.close() }
})

it('refuses attribution overrides, unauthorized targets and cold new input while preserving known receipts', async () => {
  const h = await ownerFixture('json', { maxIngressRequestsPerRun: 1 })
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    const input = simulationProductIngressInputSchema.parse({ runId, ingressId: 'constructor', entityId: 'supplier', text: 'Private input', availableAt: '0' })
    expect(() => simulationProductIngressInputSchema.parse({ ...input, source: 'forged' })).toThrow()
    await expect(service.ingress({ ...input, entityId: 'unallowed' as never }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    await expect(service.ingress({ ...input, availableAt: '1001' as never }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    await expect(service.ingress(input, call(undefined, 'other'))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    const receipt = await service.ingress(input, call())
    await expect(service.ingress({ ...input, ingressId: 'second' as never }, call())).rejects.toThrow('capacity')
    expect(await service.ingress(input, call())).toEqual(receipt)
    await h.fiber.dispose(); await h.mount()
    const next = h.ctx.simulationAdministration
    expect(await next.ingress(input, call())).toEqual(receipt)
    await expect(next.ingress({ ...input, ingressId: 'cold-new' as never }, call())).rejects.toThrow('recovered owner')
    expect(await next.ingressRequest({ runId, ingressId: 'unknown' as never }, call())).toMatchObject({ status: 'not-found' })
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('preserves failed checkpoint history and requires a new command after collector failure', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    const before = h.owned().snapshot().latestCheckpointId
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementationOnce(async (...args) => {
      const connection = await attach(...args)
      vi.spyOn(connection, 'collectCheckpointCandidate').mockRejectedValueOnce(new Error('private failed collection source'))
      return connection
    })
    const original = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'failed-cut' })
    await service.checkpoint(original, call())
    const failed = await h.finished(original.commandId)
    expect(failed).toMatchObject({ status: 'failed', failure: 'checkpoint-failed' })
    expect(h.owned().snapshot().latestCheckpointId).toBe(before)
    expect(await service.checkpoint(original, call())).toEqual(failed)
    const next = { ...original, commandId: 'new-cut' as never }
    await service.checkpoint(next, call())
    expect((await h.finished(next.commandId)).status).toBe('completed')
    expect((await service.request({ commandId: original.commandId }, call()))).toMatchObject({ status: 'found', request: failed })
    expect(h.owned().snapshot().checkpoints?.[failed.checkpointId!]?.status).toBe('failed')
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('leaves a terminal-write failure queryable and retries original completed checkpoint collection without another cut', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const stream = h.ctx.storageLog.get('owner-commands')!
    const append = stream.append.bind(stream)
    let refused = false
    vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
      const entry = args[1][0] as { kind: string }
      if (!refused && entry.kind === 'command/completed') { refused = true; throw new Error('terminal-checkpoint-write-failed') }
      return append(...args)
    })
    const input = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'original-cut' })
    const accepted = await h.ctx.simulationAdministration.checkpoint(input, call())
    await vi.waitFor(() => { expect(h.owned().snapshot().checkpoints?.[accepted.checkpointId!]?.status).toBe('completed') })
    expect((await h.ctx.simulationAdministration.request({ commandId: input.commandId }, call()))).toMatchObject({ status: 'found', request: { status: 'accepted' } })
    const count = Object.keys(h.owned().snapshot().checkpoints ?? {}).length
    await h.ctx.simulationAdministration.checkpoint(input, call())
    expect((await h.finished(input.commandId)).status).toBe('completed')
    expect(Object.keys(h.owned().snapshot().checkpoints ?? {})).toHaveLength(count)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('refuses missing/incompatible recovery anchors before retiring a live owner, and preserves original failures', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    const close = vi.spyOn(h.owned(), 'close')
    const input = simulationProductRestoreInputSchema.parse({ runId, commandId: 'unknown-anchor', checkpointId: 'constructor' })
    await service.restore(input, call())
    const failed = await h.finished(input.commandId)
    expect(failed).toMatchObject({ status: 'failed', failure: 'restore-failed' })
    expect(close).not.toHaveBeenCalled()
    expect(await service.restore(input, call())).toEqual(failed)
    await expect(service.restore(input, call(undefined, 'other'))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect((await service.control({ runId }, call())).owner).toBe('held')
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('refuses a complete checkpoint from another implementation before retiring its owner (%s)', async (backend) => {
  const h = await ownerFixture(backend)
  try {
    const runId = await h.create()
    const teamId = h.owned().snapshot().teamReservation!.teamId
    const team = await h.ctx.teams.getTeam({ teamId })
    const ownerName = team.rules['activationLifecycleOwner']
    if (typeof ownerName !== 'string') throw new Error('Canonical Simulation Team has no activation owner')
    const connection = await h.ctx.simulationTeams.attach(h.owned(), teamId, ownerName)
    const checkpointId = 'foreign-implementation' as never
    expect(await connection.checkpoint({ id: checkpointId, implementationVersion: 'foreign/2', maxDrainRounds: 4, maxAttempts: 3 }))
      .toMatchObject({ status: 'completed' })
    await connection.close()
    const state = h.owned().snapshot(), close = vi.spyOn(h.owned(), 'close')
    const input = simulationProductRestoreInputSchema.parse({ runId, commandId: 'incompatible-restore', checkpointId })
    await h.ctx.simulationAdministration.restore(input, call())
    expect(await h.finished(input.commandId)).toMatchObject({ status: 'failed', failure: 'restore-failed', diagnostic: {
      stage: 'restore', code: 'version-mismatch', subject: { kind: 'checkpoint', checkpointId },
    } })
    expect(close).not.toHaveBeenCalled()
    expect(h.owned().snapshot()).toEqual(state)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('retains accepted work after credential retirement and refuses overlapping maintenance on the same run', async () => {
  const h = await ownerFixture()
  const finish = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  try {
    const runId = await h.create()
    const controller = new AbortController()
    const stream = h.ctx.storageLog.get('owner-commands')!
    const append = stream.append.bind(stream)
    vi.spyOn(stream, 'append').mockImplementationOnce(async (...args) => { const value = await append(...args); controller.abort(); return value })
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined); await finish.promise; return attach(...args)
    })
    const input = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'retired-waiter' })
    await expect(h.ctx.simulationAdministration.checkpoint(input, call(controller)))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await entered.promise
    await expect(h.ctx.simulationAdministration.checkpoint({ ...input, commandId: 'another' as never }, call())).rejects.toThrow('in progress')
    await expect(h.ctx.simulationAdministration.ingress(simulationProductIngressInputSchema.parse({ runId, ingressId: 'during-maintenance',
      entityId: 'buyer', text: 'Blocked input', availableAt: '0' }), call())).rejects.toThrow('maintenance is in progress')
    finish.resolve(undefined)
    expect((await h.finished(input.commandId)).status).toBe('completed')
    expect(h.requests).toEqual([])
  } finally { finish.resolve(undefined); await h.close() }
})

it('rechecks a cold input query after provider IO retires its authentication', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const input = simulationProductIngressInputSchema.parse({ runId, ingressId: 'read-race', entityId: 'buyer', text: 'Private source', availableAt: '0' })
    await h.ctx.simulationAdministration.ingress(input, call())
    await h.fiber.dispose(); await h.mount()
    const controller = new AbortController()
    const inspect = h.ctx.simulations.inspect.bind(h.ctx.simulations)
    vi.spyOn(h.ctx.simulations, 'inspect').mockImplementationOnce(async (...args) => {
      const value = await inspect(...args); controller.abort(); return value
    })
    await expect(h.ctx.simulationAdministration.ingressRequest({ runId, ingressId: input.ingressId }, call(controller)))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  } finally { await h.close() }
})

it('resumes an accepted checkpoint after cold restart through full history validation and the original identity', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const stream = h.ctx.storageLog.get('owner-commands')!
    const append = stream.append.bind(stream)
    vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
      if ((args[1][0] as { kind: string }).kind === 'command/completed') throw new Error('terminal publication unavailable')
      return append(...args)
    })
    const input = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'interrupted-cold-cut' })
    const accepted = await h.ctx.simulationAdministration.checkpoint(input, call())
    await vi.waitFor(() => { expect(h.owned().snapshot().checkpoints?.[accepted.checkpointId!]?.status).toBe('completed') })
    await h.fiber.dispose()
    vi.restoreAllMocks()
    await h.mount()
    const restore = vi.spyOn(h.ctx.simulationTeams, 'restore')
    await h.ctx.simulationAdministration.retryRequest({ runId, commandId: input.commandId }, call())
    expect((await h.finished(input.commandId)).status).toBe('completed')
    expect(restore).toHaveBeenCalledTimes(1)
    expect(h.owned().snapshot().phase).toBe('paused')
    expect(Object.keys(h.owned().snapshot().checkpoints ?? {})).toHaveLength(2)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('preserves an unreleased restored handle after temporary connection close fails', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const restore = h.ctx.simulationTeams.restore.bind(h.ctx.simulationTeams)
    vi.spyOn(h.ctx.simulationTeams, 'restore').mockImplementationOnce(async (...args) => {
      const restored = await restore(...args)
      vi.spyOn(restored.connection, 'close').mockRejectedValueOnce(new Error('recovery-close-unconfirmed'))
      return restored
    })
    const input = simulationProductRestoreInputSchema.parse({ runId, commandId: 'uncertain-close', checkpointId: `product-initial/${h.input.commandId}` })
    await h.ctx.simulationAdministration.restore(input, call())
    expect(await h.finished(input.commandId)).toMatchObject({ status: 'failed', diagnostic: {
      stage: 'retire', code: 'unavailable', subject: { kind: 'run' }, cleanup: 'unconfirmed',
    } })
    const spec = h.owned().snapshot().spec
    expect((await h.ctx.simulations.inspect(h.ctx.simulations.resolveInspection({ provider: 'local', spec })))?.owner).toBe('this-provider')
    expect((await h.ctx.simulationAdministration.control({ runId }, call())).actions.start.allowed).toBe(false)
    const retry = { ...input, commandId: 'confirm-recovery' as never }
    await h.ctx.simulationAdministration.restore(retry, call())
    expect((await h.finished(retry.commandId)).status).toBe('completed')
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('queries a claimed input separately from a consumed one and leaves unknown lookups read-only', async () => {
  const h = await ownerFixture()
  const started = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const stream = h.adapter.stream.bind(h.adapter)
  vi.spyOn(h.adapter, 'stream').mockImplementationOnce(async function* (options) {
    started.resolve(undefined); await finish.promise; yield* stream(options)
  })
  try {
    const runId = await h.create()
    const input = simulationProductIngressInputSchema.parse({ runId, ingressId: 'claimed-input', entityId: 'buyer', text: 'Authorized text', availableAt: '0' })
    await h.ctx.simulationAdministration.ingress(input, call())
    await h.ctx.simulationAdministration.manage(phase(runId, 'start'), call())
    await started.promise
    const result = await h.ctx.simulationAdministration.ingressRequest({ runId, ingressId: input.ingressId }, call())
    expect(result).toMatchObject({ status: 'found', receipt: { status: 'claimed' } })
    expect((await h.ctx.simulationAdministration.ingressRequest({ runId, ingressId: 'unknown' as never }, call())).status).toBe('not-found')
    finish.resolve(undefined)
  } finally { finish.resolve(undefined); await h.close() }
})

it('keeps queued original input retries idempotent inside the owner and refuses its retired admission', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const owner = await capturedOwner(h, runId)
    const request = simulationIngressRequestSchema.parse({ id: 'queued-input', entityId: 'buyer', source: 'product-principal/reader', text: 'One input', availableAt: '0' })
    const [one, two] = await Promise.all([owner.ingest(request, () => {}), owner.ingest(request, () => {})])
    expect(one).toEqual(two)
    await expect(owner.ingest({ ...request, text: 'changed' }, () => {})).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    await owner.close()
    await expect(owner.ingest(request, () => {})).rejects.toThrow('retiring')
    await expect(owner.checkpoint({ id: 'no-cut' as never, implementationVersion: 'company/1', maxDrainRounds: 4, maxAttempts: 3 }))
      .rejects.toThrow('retiring')
  } finally { await h.close() }
})

it('queries unavailable cold history without opening execution or exposing provider diagnostics', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    await h.fiber.dispose(); await h.mount()
    const inspect = vi.spyOn(h.ctx.simulations, 'inspect').mockRejectedValueOnce(new Error('private unavailable filesystem'))
    await expect(h.ctx.simulationAdministration.ingressRequest({ runId, ingressId: 'unknown' as never }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE', message: 'Simulation scheduling history is unavailable' })
    inspect.mockResolvedValueOnce(undefined)
    expect(await h.ctx.simulationAdministration.ingressRequest({ runId, ingressId: 'unknown' as never }, call())).toMatchObject({ status: 'not-found' })
    const input = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'new-cold-cut' })
    await expect(h.ctx.simulationAdministration.checkpoint(input, call())).rejects.toThrow('prepared live owner')
    const unavailableRestore = simulationProductRestoreInputSchema.parse({ runId, commandId: 'unavailable-native-history',
      checkpointId: `product-initial/${h.input.commandId}` })
    inspect.mockRejectedValueOnce(new Error('private unavailable restore source'))
    await h.ctx.simulationAdministration.restore(unavailableRestore, call())
    const failedSource = await h.finished(unavailableRestore.commandId)
    expect(failedSource).toMatchObject({ status: 'failed', failure: 'restore-failed', diagnostic: {
      stage: 'restore', code: 'source-unavailable', subject: { kind: 'run' },
    } })
    expect(JSON.stringify(failedSource)).not.toContain('private unavailable restore source')
    const restore = simulationProductRestoreInputSchema.parse({ runId, commandId: 'missing-native', checkpointId: 'absent' })
    inspect.mockResolvedValueOnce(undefined)
    await h.ctx.simulationAdministration.restore(restore, call())
    expect((await h.finished(restore.commandId)).status).toBe('failed')
  } finally { await h.close() }
})

it('refuses cold recovery when another coordinator owns the observed native history', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    await h.fiber.dispose(); await h.mount()
    const inspect = h.ctx.simulations.inspect.bind(h.ctx.simulations)
    vi.spyOn(h.ctx.simulations, 'inspect').mockImplementationOnce(async (...args) => {
      const value = await inspect(...args)
      return value === undefined ? undefined : { ...value, owner: 'other-owner' }
    })
    const restore = vi.spyOn(h.ctx.simulationTeams, 'restore')
    const input = simulationProductRestoreInputSchema.parse({ runId, commandId: 'foreign-owner', checkpointId: `product-initial/${h.input.commandId}` })
    await h.ctx.simulationAdministration.restore(input, call())
    expect((await h.finished(input.commandId)).status).toBe('failed')
    expect(restore).not.toHaveBeenCalled()
  } finally { await h.close() }
})

it('refuses out-of-range timer configuration before opening administration history', async () => {
  const ctx = new Context()
  try {
    const { default: Administration } = await import('../src/administration.ts')
    expect(() => new Administration(ctx, { journalStream: 'invalid-timer', templates: [], driverIntervalMs: 2147483648 }))
      .toThrow('timer range')
  } finally { await ctx.fiber.dispose() }
})

it('reports cancellation independently of input assignment and original payload retention', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const input = simulationProductIngressInputSchema.parse({ runId, ingressId: 'cancelled-input', entityId: 'buyer', text: 'One input', availableAt: '0' })
    const receipt = await h.ctx.simulationAdministration.ingress(input, call())
    await h.owned().cancelEvent(receipt.eventId, 'Explicit cancellation', h.owned().snapshot().revision)
    const result = await h.ctx.simulationAdministration.ingressRequest({ runId, ingressId: input.ingressId }, call())
    expect(result).toMatchObject({ status: 'found', receipt: { status: 'cancelled' } })
    expect((await h.ctx.simulationAdministration.ingress(input, call())).status).toBe('cancelled')
  } finally { await h.close() }
})

it('keeps queued management/input admission fenced when a maintenance acceptance wins before native write', async () => {
  const h = await ownerFixture()
  const entered = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  try {
    const runId = await h.create()
    const owner = await capturedOwner(h, runId)
    const settings = { ...h.input.parameters, version: '1' as const, ownerName: `simulation-product/${runId}`,
      objective: 'One unit', participant: { provider: 'in-process' as const, preset: 'simulation', model: 'company/scripted' },
      checkpoint: { id: 'held-admission' as never, maxDrainRounds: 4, maxAttempts: 3 } }
    const { simulationCompanyPreparationSchema } = await import('../src/company-preparation.ts')
    const holding = owner.prepare(simulationCompanyPreparationSchema.parse(settings), async () => {
      entered.resolve(undefined); await finish.promise
    })
    await entered.promise
    const input = simulationProductIngressInputSchema.parse({ runId, ingressId: 'queued-input', entityId: 'buyer', text: 'One input', availableAt: '0' })
    const posted = h.ctx.simulationAdministration.ingress(input, call())
    const managing = h.ctx.simulationAdministration.manage(phase(runId, 'queued-start'), call())
    const checkpoint = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'wins-admission' })
    const accepted = await h.ctx.simulationAdministration.checkpoint(checkpoint, call())
    expect(accepted.status).toBe('accepted')
    const rejected = Promise.allSettled([posted, managing])
    finish.resolve(undefined); await holding
    expect(await rejected).toMatchObject([{ status: 'rejected', reason: { code: 'SIMULATION_PRODUCT_UNAVAILABLE' } },
      { status: 'rejected', reason: { code: 'SIMULATION_PRODUCT_UNAVAILABLE' } }])
    expect((await h.finished(checkpoint.commandId)).status).toBe('completed')
    expect(Object.keys(h.owned().snapshot().ingresses ?? {})).toHaveLength(0)
  } finally { finish.resolve(undefined); await h.close() }
})

it('does not open a run when an interrupted accepted checkpoint no longer has readable recovery history', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const stream = h.ctx.storageLog.get('owner-commands')!
    const append = stream.append.bind(stream)
    vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
      if ((args[1][0] as { kind: string }).kind === 'command/completed') throw new Error('original terminal unavailable')
      return append(...args)
    })
    const input = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'missing-cold-anchor' })
    const accepted = await h.ctx.simulationAdministration.checkpoint(input, call())
    await vi.waitFor(() => { expect(h.owned().snapshot().checkpoints?.[accepted.checkpointId!]?.status).toBe('completed') })
    await h.fiber.dispose(); vi.restoreAllMocks(); await h.mount()
    const open = vi.spyOn(h.ctx.simulations, 'open')
    vi.spyOn(h.ctx.simulations, 'inspect').mockResolvedValueOnce(undefined)
    await h.ctx.simulationAdministration.checkpoint(input, call())
    expect((await h.finished(input.commandId))).toMatchObject({ status: 'failed', failure: 'checkpoint-failed' })
    expect(open).not.toHaveBeenCalled()
  } finally { await h.close() }
})

it('returns a redacted terminal failure when checkpoint attachment fails before collection', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockRejectedValueOnce(new Error('private temporary attachment failure'))
    const input = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'unattached-cut' })
    await h.ctx.simulationAdministration.checkpoint(input, call())
    const failed = await h.finished(input.commandId)
    expect(failed).toMatchObject({ status: 'failed', failure: 'checkpoint-failed' })
    expect(JSON.stringify(failed)).not.toContain('private')
  } finally { await h.close() }
})

it('keeps an allocated but not yet created native run distinct from missing readable history', async () => {
  const h = await ownerFixture()
  const entered = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  try {
    const open = h.ctx.simulations.open.bind(h.ctx.simulations)
    vi.spyOn(h.ctx.simulations, 'open').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined); await finish.promise; return open(...args)
    })
    const accepted = await h.ctx.simulationAdministration.create(h.input, call())
    await entered.promise
    expect(await h.ctx.simulationAdministration.control({ runId: accepted.runId }, call())).toMatchObject({ owner: 'not-held', driver: 'idle',
      actions: { start: { allowed: false, reason: 'preparation-in-progress' } } })
    finish.resolve(undefined); expect((await h.finished()).status).toBe('completed')
  } finally { finish.resolve(undefined); await h.close() }
})
