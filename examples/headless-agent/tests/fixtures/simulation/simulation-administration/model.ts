/** Only external inference is scripted; production Simulation owns tools, actors, delivery and durable outcomes. */
import type { Context } from '@clocky/cordis'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { companyModel } from '../../../../../../packages/simulation/simulation-product/tests/company-model.ts'

interface Probe {
  adapter: LlmAdapter
  run: SimulationRun | undefined
  entered: boolean
  systemPrompts: string[]
  requests: Array<{ stage: string; tools: string[]; goal: string }>
  release: () => void
}
declare module '@clocky/cordis' { interface Context { simulationBrowserProbe: Probe } }
export const inject = ['llm', 'simulations']

export function apply(ctx: Context): void {
  const barrier = Promise.withResolvers<undefined>()
  const original = ctx.simulations.open.bind(ctx.simulations)
  ctx.effect(() => {
    ctx.simulations.open = async (...args) => { probe.run = await original(...args); return probe.run }
    return () => { ctx.simulations.open = original }
  })
  const models = new WeakMap<SimulationRun, LlmAdapter>()
  class Model extends LlmAdapter {
    async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      probe.systemPrompts.push(options.system ?? '')
      const run = probe.run
      if (run === undefined) throw new Error('Browser model has no product-held run')
      if (!probe.entered) { probe.entered = true; await barrier.promise }
      let model = models.get(run)
      if (model === undefined) { model = companyModel(run, probe.requests); models.set(run, model) }
      yield* model.stream(options)
    }
  }
  const adapter = new Model()
  const probe: Probe = { adapter, run: undefined, entered: false, systemPrompts: [], requests: [],
    release: () => { barrier.resolve(undefined) } }
  ctx.provide('simulationBrowserProbe', probe)
  ctx.effect(() => ctx.llm.registerAdapter(['company'], adapter))
}
