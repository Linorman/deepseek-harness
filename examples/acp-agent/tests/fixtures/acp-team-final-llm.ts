import type { Context } from '@clocky/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@clocky/clocky-llm'

export const ACP_TEAM_FINAL_TEXT = 'ACP_TEAM_FINAL_OK'

function hasTeamFinal(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && block.name === 'team_final'))
}

function finalChannelId(system: string | undefined): string {
  const channelId = system?.match(/call team_final with channel_id ([^\s]+) and/u)?.[1]
  if (channelId === undefined) throw new Error('acp-team-final-llm: coordinator prompt did not supply a direct channel id')
  return channelId
}

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function finalChunks(channelId: string): StreamChunk[] {
  const argumentsText = JSON.stringify({ channel_id: channelId, text: ACP_TEAM_FINAL_TEXT })
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: CallId('acp-team-final'), name: 'team_final', argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('acp-team-final'), name: 'team_final', arguments: argumentsText } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class AcpTeamFinalAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const chunks = options.purpose === 'session-title' || hasTeamFinal(options.messages)
      ? textChunks(ACP_TEAM_FINAL_TEXT)
      : finalChunks(finalChannelId(options.system))
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

export const name = 'acp-team-final-llm'
export const inject = ['llm']

export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['acp-team-final'], new AcpTeamFinalAdapter())
}
