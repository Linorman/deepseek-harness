/** Test-only registered route; company creation must never enter inference. */
import type { Context } from '@clocky/cordis'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { StreamChunk } from '@clocky/clocky-llm'

export let modelCalls = 0
class NeverInfer extends LlmAdapter {
  async * stream(): AsyncIterable<StreamChunk> { modelCalls++; throw new Error('Company creation inferred') }
}
export const inject = ['llm']
export function apply(ctx: Context): void { ctx.effect(() => ctx.llm.registerAdapter(['company'], new NeverInfer())) }
