/** Stop saving uses the original collector queue and never depends on another browser command. */
import { expect, it, vi } from 'vitest'
import { simulationRunControlStateSchema, simulationStopTargetSchema } from '@clocky/clocky-simulation'
import { StopCheckpointScheduler } from '../src/stop-checkpoint.ts'
import { ownerFixture } from './company-owner-fixture.ts'
import { call } from './fixtures.ts'

const target = simulationStopTargetSchema.parse({ targetId: 'automatic-save', clock: { kind: 'native' }, boundary: '0', mode: 'at-boundary',
  checkpointPolicy: 'request', drainBudget: { maxSteps: 10, maxTokens: 1000, maxWallTimeMs: 10000 } })

it.each(['json', 'sqlite'] as const)('automatically collects the reached %s target and stays paused without inference', async (backend) => {
  const h = await ownerFixture(backend)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.updateRunControl({ runId, commandId: 'automatic-save', target }, call())
    await vi.waitFor(async () => {
      expect((await service.control({ runId }, call())).stopTarget).toMatchObject({ state: 'paused', checkpoint: 'completed' })
    })
    const state = h.owned().snapshot(), stop = state.runControl?.current
    expect(stop?.checkpointId).toMatch(/^stop-target\/[a-f0-9]{64}$/)
    if (stop?.checkpointId === undefined) throw new Error('Automatic checkpoint identity missing')
    expect(Object.values(state.checkpoints ?? {}).find(value => value.request.id === stop.checkpointId)?.status).toBe('completed')
    const revision = state.revision
    for (let index = 0; index < 3; index++) await service.control({ runId }, call())
    expect(h.owned().snapshot().revision).toBe(revision)
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})

it('does not repeat a rejected automatic collection and keeps its original save identity', async () => {
  const scheduler = new StopCheckpointScheduler()
  const stop = simulationRunControlStateSchema.parse({ commandId: 'original', revision: 0, target,
    activation: 'effective', state: 'paused', reason: 'target-reached', steps: 0, tokens: 0, checkpoint: 'pending',
    checkpointId: null, checkpointAttempts: [], nativeBoundary: '0',
    cut: { nativeRevision: 0, nativeTime: '0', clockRevision: 0, clockValue: '0', recordedAt: 0,
      tokenBaseline: 0, tokenReservations: {}, operationIds: [], requestIds: [], decisionIds: [] } })
  const policy = { implementationVersion: 'company/1', maxDrainRounds: 4, maxAttempts: 2 }
  const collect = vi.fn().mockRejectedValue(new Error('Collector storage unavailable'))
  scheduler.schedule(stop, policy, collect)
  await Promise.resolve()
  scheduler.schedule(structuredClone(stop), policy, collect)
  expect(collect).toHaveBeenCalledTimes(1)
  expect(collect.mock.calls[0]?.[1]).toBe('original')
  const otherOwner = new StopCheckpointScheduler(), recovered = vi.fn().mockResolvedValue(undefined)
  otherOwner.schedule(stop, policy, recovered)
  expect(recovered.mock.calls[0]?.[0]).toEqual(collect.mock.calls[0]?.[0])
  expect(stop.checkpoint).toBe('pending')
})

it.each(['json', 'sqlite'] as const)('retries a failed %s automatic save explicitly under the same logical stop command', async (backend) => {
  const h = await ownerFixture(backend)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementationOnce(async (...args) => {
      const connection = await attach(...args)
      vi.spyOn(connection, 'checkpoint').mockImplementationOnce(async (request) => {
        const run = h.owned()
        await run.beginCheckpoint(request)
        await run.failCheckpoint(request.id, 'Injected collector failure before publication')
        const failed = Object.values(run.snapshot().checkpoints ?? {}).find(value => value.request.id === request.id)
        if (failed === undefined) throw new Error('Expected original failed checkpoint')
        return failed
      })
      return connection
    })
    await service.updateRunControl({ runId, commandId: 'retry-automatic', target }, call())
    await vi.waitFor(async () => {
      expect((await service.control({ runId }, call())).stopTarget?.checkpoint).toBe('failed')
    })
    const before = h.owned().snapshot().runControl?.current
    expect(before?.state).toBe('paused')
    const commandId = 'explicit-save-retry' as never
    await service.checkpoint({ runId, commandId }, call())
    expect(await h.finished(commandId)).toMatchObject({ status: 'completed' })
    const state = h.owned().snapshot(), after = state.runControl?.current
    expect(after).toMatchObject({ commandId: 'retry-automatic', checkpoint: 'completed', state: 'paused', cut: before?.cut })
    expect(after?.checkpointAttempts).toHaveLength(2)
    expect(Object.values(state.checkpoints ?? {}).find(value => value.request.id === before?.checkpointId)?.status).toBe('failed')
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})
