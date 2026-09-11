import type { Context } from '@clocky/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from '@clocky/clocky-llm'

/**
 * Scripted model for the CHILD runtime: answers every request with its own
 * process cwd, so the driving e2e can prove the parent session's workspace
 * reached the child process across the SDK wire. `options` carries the
 * request; the reply depends only on process state.
 */
class CwdEchoAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reply = `child cwd: ${process.cwd()}`
    const chunks = options.purpose === 'session-title'
      ? textChunks('Child SDK Team')
      : hasTeamFinal(options.messages)
        ? textChunks(reply)
        : finalChunks(finalChannelId(options.system), reply)
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

function hasTeamFinal(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && block.name === 'team_final'))
}

function finalChannelId(system: string | undefined): string {
  const channelId = system?.match(/call team_final with channel_id ([^\s]+) and/u)?.[1]
  if (channelId === undefined) throw new Error('child-mock-llm: coordinator prompt did not supply a direct channel id')
  return channelId
}

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function finalChunks(channelId: string, text: string): StreamChunk[] {
  const argumentsText = JSON.stringify({ channel_id: channelId, text })
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: CallId('child-team-final'), name: 'team_final', argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('child-team-final'), name: 'team_final', arguments: argumentsText } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

export const name = 'child-mock-llm'
export const inject = ['llm']

/**
 * Register the cwd-echo adapter under the `mock` provider.
 * @param ctx - the plugin context supplying `ctx.llm`.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['mock'], new CwdEchoAdapter())
}
