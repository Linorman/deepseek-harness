/** Real child cancellation and retained input, completed through the SDK coordinator's Team final. */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Context } from '@clocky/cordis'
import { CallId, createUserMessage, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { defineTool } from '@clocky/clocky-tools'
import { SessionId } from '@clocky/clocky-session'
import type {} from '@clocky/clocky-agent'

const RESUMED_INPUT = 'SDK_RETAINED_INPUT'
const FINAL_TEXT = 'SDK_RESUMED_OK'
const CHILD_INPUT = 'SDK_CHILD_ABORT'

function text(value: string): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text: value } },
    { type: 'finish', reason: { kind: 'stop' } }]
}

function call(name: string, args: Record<string, string>): StreamChunk[] {
  const id = CallId(`sdk-${name}`)
  const argumentsText = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ResumePendingModel extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'SDK retained input' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const contains = (value: string) => options.messages.some(message => message.role === 'user'
      && message.content.some(block => block.type === 'text' && block.text === value))
    if (contains(RESUMED_INPUT)) { yield* text('SDK_CHILD_RESUMED'); return }
    if (contains(CHILD_INPUT)) { yield* call('snapshot_resume_pending', {}); return }
    const childResult = options.messages.flatMap(message => message.content)
      .find(block => block.type === 'tool-result' && block.toolCallId === 'sdk-snapshot_resume_child')
    if (childResult === undefined) { yield* call('snapshot_resume_child', {}); return }
    assert(childResult.type === 'tool-result' && !childResult.isError, JSON.stringify(childResult))
    if (options.messages.some(message => message.content.some(block => block.type === 'tool-call' && block.name === 'team_final'))) {
      yield* text(FINAL_TEXT)
      return
    }
    const channelId = options.system?.match(/call team_final with channel_id ([^\s]+) and/u)?.[1]
    assert(channelId !== undefined)
    yield* call('team_final', { channel_id: channelId, text: FINAL_TEXT })
  }
}

/** Loader identity for the SDK cancellation scenario. */
export const name = 'sdk-resume-pending'
/** Model routing and actual tool execution owners. */
export const inject = ['llm', 'tools', 'agents']

/**
 * Install the deterministic model and cooperative cancellation tool.
 * @param ctx - SDK runtime composition context.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['test-provider'], new ResumePendingModel())
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'snapshot_resume_child',
    description: 'Run a child whose retained input survives cancellation of its first tool turn.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, exec) {
      const coordinator = exec.agent
      assert(coordinator !== undefined)
      const handle = await ctx.agents.withInitiator(coordinator, async () => await ctx.agents.create({
        sessionId: SessionId(randomUUID()),
        meta: { parentSession: coordinator.id, cwd: process.cwd() },
        agentOptions: coordinator.options,
        signal: exec.signal,
      }))
      try {
        handle.agent.followup(createUserMessage({
          content: [{ type: 'text', text: CHILD_INPUT }], source: { kind: 'plugin', plugin: name },
        }))
        await handle.agent.whenIdle()
        const events = handle.agent.session.events
        assert(events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'aborted'))
        assert(events.some(event => event.type === 'user/message'
          && event.data.content.some(block => block.type === 'text' && block.text === RESUMED_INPUT)))
        assert(events.some(event => event.type === 'assistant/message'
          && event.data.message.content.some(block => block.type === 'text' && block.text === 'SDK_CHILD_RESUMED')))
        return 'SDK_CHILD_RESUMED'
      } finally {
        await handle.dispose()
      }
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'snapshot_resume_pending',
    description: 'Queue the retained SDK input and cancel this tool turn.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, exec) {
      const agent = exec.agent
      assert(agent !== undefined)
      return await new Promise<string>((_resolve, reject) => {
        exec.signal.addEventListener('abort', () => {
          reject(new Error('SDK child turn cancelled', { cause: exec.signal.reason }))
        }, { once: true })
        agent.send(createUserMessage({
          content: [{ type: 'text', text: RESUMED_INPUT }],
          source: { kind: 'plugin', plugin: name },
        }), 'next-turn', true)
        agent.cancel({ kind: 'hook', reason: 'SDK retained-input snapshot' }, { keepInbox: true, resumePending: true })
      })
    },
  })))
}
