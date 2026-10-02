/** Product-owned paused runs keep real deadlines, shared permits and native token charges independently accountable. */
import { afterEach, expect, it, vi } from 'vitest'
import { simulationProductCreateInputSchema } from '../src/administration-schema.ts'
import { ownerFixture } from './company-owner-fixture.ts'
import { call } from './fixtures.ts'
import type { SimulationRun } from '@clocky/clocky-simulation'

afterEach(() => { vi.restoreAllMocks() })

it.each(['json', 'sqlite'] as const)('keeps shared permits until actual timeout cleanup while every run is paused (%s)', async (backend) => {
  const h = await ownerFixture(backend, {}, undefined, { decisionTimeoutMs: 750 })
  const cleanup = Promise.withResolvers<undefined>()
  const runs: SimulationRun[] = []
  let entered = 0, aborted = 0
  vi.spyOn(h.adapter, 'stream').mockImplementation(async function* (options) {
    const signal = options.signal
    if (signal === undefined) throw new Error('Native model dispatch has no cancellation lifetime')
    entered++
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } }
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
    aborted++
    await cleanup.promise
    signal.throwIfAborted()
  })
  try {
    const service = h.ctx.simulationAdministration
    for (let index = 0; index < 3; index++) {
      const request = simulationProductCreateInputSchema.parse({ ...h.input, commandId: `shared-run-${index}`, name: `Run ${index}` })
      await service.create(request, call()); await h.finished(request.commandId)
      runs.push(h.owned())
    }
    const firstBudget = runs[0]!.snapshot().spec.maxTokensPerInterval
    for (const [index, run] of runs.entries()) {
      await service.manage({ runId: run.snapshot().spec.runId as never, managementId: `start-${index}` as never, phase: 'running' }, call())
    }
    await vi.waitFor(() => { expect(h.ctx.simulationTeams.modelUsage()).toMatchObject({ active: 2, queued: 1, limit: 2 }) })
    expect(entered).toBe(2)
    for (const [index, run] of runs.entries()) {
      await service.manage({ runId: run.snapshot().spec.runId as never, managementId: `pause-${index}` as never, phase: 'paused' }, call())
    }
    const times = runs.map(run => run.snapshot().time)
    await vi.waitFor(() => { expect(aborted).toBe(2) }, { timeout: 2000 })
    await vi.waitFor(() => {
      for (const run of runs) expect(Object.values(run.snapshot().decisions)[0]?.cancellation).toBe('timeout')
    }, { timeout: 2000 })
    expect(h.ctx.simulationTeams.modelUsage()).toMatchObject({ active: 2, queued: 0, limit: 2 })
    expect(entered).toBe(2)
    for (const run of runs) {
      const state = run.snapshot()
      expect(state.phase).toBe('paused')
      const decision = Object.values(state.decisions)[0]!
      expect(decision.cancellation).toBe('timeout')
      expect(decision.inference?.expiredAt).toBeGreaterThanOrEqual(decision.inference!.deadline)
      expect(state.spec.maxTokensPerInterval).toBe(firstBudget)
    }
    const held = runs.filter(run => Object.values(run.snapshot().tokenReservations ?? {}).length > 0)
    expect(held).toHaveLength(2)
    for (const run of held) {
      expect(Object.values(run.snapshot().tokenReservations ?? {})).toMatchObject([{ status: 'reserved', reserved: 10000 }])
    }
    cleanup.resolve(undefined)
    await vi.waitFor(() => { expect(h.ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 }) })
    await vi.waitFor(() => {
      for (const run of held) expect(Object.values(run.snapshot().tokenReservations ?? {})).toMatchObject([
        { status: 'unknown', observedUsage: { inputTokens: 7, outputTokens: 2 }, reserved: 10000 },
      ])
    })
    expect(runs.map(run => run.snapshot().time)).toEqual(times)
    expect(runs.map(run => run.budgetUsage().tokens.used).sort((a, b) => a - b)).toEqual([0, 10000, 10000])
    for (const run of runs) expect(Object.values(run.snapshot().operations)).toHaveLength(0)
  } finally { cleanup.resolve(undefined); await h.close() }
})

it.each(['json', 'sqlite'] as const)('refuses the next model reservation after the run token budget is exhausted (%s)', async (backend) => {
  const h = await ownerFixture(backend, {}, undefined, { maxTokensPerInterval: 10000 })
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const original = { runId, managementId: 'bounded-start' as never, phase: 'running' as const }
    const started = await service.manage(original, call())
    await vi.waitFor(() => { expect(h.owned().snapshot().stall?.code).toBe('SIM_BUDGET_LIMIT') }, { timeout: 3000 })
    const state = h.owned().snapshot()
    expect(state.phase).toBe('stalled')
    expect(state.stall).toMatchObject({ code: 'SIM_BUDGET_LIMIT', budget: 'tokens', used: 10000, limit: 10000, requested: 10000 })
    expect(h.requests).toHaveLength(1)
    expect((await service.control({ runId }, call())).actions.start.allowed).toBe(false)
    expect((await service.manage(original, call())).operation).toEqual(started.operation)
    await expect(service.manage({ ...original, managementId: 'another-start' as never }, call())).rejects.toThrow()
    expect(h.requests).toHaveLength(1)
    expect(Object.values(h.owned().snapshot().operations)).toHaveLength(0)
    expect(h.owned().snapshot().spec).toEqual(state.spec)
  } finally { await h.close() }
})
