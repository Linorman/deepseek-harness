/** Keyless model script selecting the real coordinator summary tool. */
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import type { ChannelSummarySelectionInput } from '@clocky/clocky-team'

export const started = Promise.withResolvers<undefined>()
export const selection = Promise.withResolvers<ChannelSummarySelectionInput>()
export const toolFinished = Promise.withResolvers<undefined>()
let issued = false

class SummaryAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose !== 'session-title' && !issued) {
      issued = true
      started.resolve(undefined)
      const input = await selection.promise
      const id = CallId('explicit-channel-summary')
      const args = JSON.stringify({ channel_id: input.channelId, expected_cursor: input.expectedCursor,
        from_sequence: input.coveredSequenceRange.from, to_sequence: input.coveredSequenceRange.to,
        idempotency_key: input.idempotencyKey })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'team_channel_summarize', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'team_channel_summarize', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (options.purpose !== 'session-title') toolFinished.resolve(undefined)
    const text = options.purpose === 'session-title' ? 'Explicit Channel Summary' : 'SUMMARY_TOOL_FINISHED'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'headless-channel-summary-llm'
export const inject = ['llm']
export function apply(ctx: import('@clocky/cordis').Context): void {
  ctx.effect(() => ctx.llm.registerAdapter(['channel-summary-mock'], new SummaryAdapter()), 'summaryFixture.model()')
}
