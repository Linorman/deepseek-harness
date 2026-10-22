import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { simulationProductGenerationReadSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductGenerationResult } from '@clocky/clocky-simulation-product/types'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok } from './fake-api.client.ts'

it('generation reads never execute and discard late private results after authority replacement', async () => {
  const ctx = new Context(), api = new FakeApiClient(), runtime = new SimulationRuntime(ctx, api)
  runtime.connected('reader' as never)
  const input = simulationProductGenerationReadSchema.parse({ runId: 'run', jobId: 'job' })
  const pending = Promise.withResolvers<ReturnType<typeof ok<SimulationProductGenerationResult>>>()
  const read = vi.spyOn(api.simulations, 'generationRead').mockReturnValueOnce(pending.promise)
  const execute = vi.spyOn(api.simulations, 'generationExecute')
  try {
    const work = runtime.generationRead(input)
    const denied = expect(work).rejects.toThrow(/authorization changed/)
    expect(read).toHaveBeenCalledWith(input)
    runtime.connected('replacement' as never)
    pending.resolve(ok({ apiVersion: 'clocky.generation/v1', runId: input.runId, job: null }))
    await denied
    expect(execute).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})
