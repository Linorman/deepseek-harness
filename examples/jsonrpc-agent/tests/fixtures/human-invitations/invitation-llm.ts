/** Deterministic keyless model that leaves the Team open for invitation operations. */
import type { Context } from '@clocky/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@clocky/clocky-llm'

class InvitationModel extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted()
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Ready for explicit channel consent.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Ready for explicit channel consent.' } }
    yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'human-invitation-snapshot-model'
export const inject = ['llm']

/** @param ctx - real model registry for this runnable example. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.llm.registerAdapter(['sdk-subagent-team-snapshot'], new InvitationModel()))
}
