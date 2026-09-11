import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'

const REVIEWER_TEXT = 'HEADLESS_TEAM_CHANNEL_VIEW_REVIEWER_DONE'

export const coordinatorStarted = Promise.withResolvers<undefined>()
export const releaseCoordinator = Promise.withResolvers<undefined>()

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function reportChunks(taskId: string, attemptId: string): StreamChunk[] {
  const id = CallId('headless-team-channel-view-report')
  const argumentsText = JSON.stringify({
    task_id: taskId,
    attempt_id: attemptId,
    outcome: 'completed',
    summary: 'HEADLESS_TEAM_CHANNEL_VIEW_WORKER_DONE',
  })
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: 'team_task_report', argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'team_task_report', arguments: argumentsText } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function assignment(messages: GenerateOptions['messages']): { readonly taskId: string; readonly attemptId: string } | undefined {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = message.content.find(block => block.type === 'text')
    if (text?.type !== 'text') continue
    const match = /\nTask: (\S+)\nAttempt: (\S+)/u.exec(text.text)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { taskId: match[1], attemptId: match[2] }
    }
  }
  return undefined
}

function hasTaskReport(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && block.name === 'team_task_report'))
}

class HeadlessTeamChannelViewAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const task = assignment(options.messages)
    const coordinatorTurn = options.messages.some(message => message.role === 'user'
      && message.content.some(block => block.type === 'text' && block.text === 'P0_VIEW_COORDINATOR_WAKE'))
    if (coordinatorTurn) {
      coordinatorStarted.resolve(undefined)
      await releaseCoordinator.promise
    }
    const chunks = options.purpose === 'session-title'
      ? textChunks('Headless Team Channel View')
      : task !== undefined && !hasTaskReport(options.messages)
        ? reportChunks(task.taskId, task.attemptId)
        : textChunks(REVIEWER_TEXT)
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

export const name = 'headless-team-channel-view-llm'
export const inject = ['llm']

export function apply(ctx: import('@clocky/cordis').Context): void {
  ctx.llm.registerAdapter(['headless-team-channel-view-mock'], new HeadlessTeamChannelViewAdapter())
}
