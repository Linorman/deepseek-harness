/** Scripted external model observes the admitted production request and exposes one inference-cleanup barrier. */
import type { Context } from '@clocky/cordis'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { companyModel } from '../../../packages/simulation/simulation-product/tests/company-model.ts'

export const inject = ['llm', 'simulations']
export const entered = Promise.withResolvers<undefined>()
export const released = Promise.withResolvers<undefined>()
export const requests: Array<{ stage: string; tools: string[]; goal: string }> = []

export function apply(ctx: Context): void {
  let run: SimulationRun | undefined
  let adapter: LlmAdapter | undefined
  let first = true
  const nativeOpen = ctx.simulations.open.bind(ctx.simulations)
  const observe: typeof ctx.simulations.open = async (...args) => { run = await nativeOpen(...args); return run }
  ctx.effect(() => {
    ctx.simulations.open = observe
    return () => { ctx.simulations.open = nativeOpen }
  })
  class ScriptedModel extends LlmAdapter {
    async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (run === undefined) throw new Error('Model has no product-held run')
      if (first) { first = false; entered.resolve(undefined); await released.promise }
      adapter ??= companyModel(run, requests)
      yield* adapter.stream(options)
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['company'], new ScriptedModel()))
}
