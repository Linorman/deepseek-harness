import type { Context } from '@clocky/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@clocky/clocky-llm'

const FINAL_TEXT = 'HEADLESS_TEAM_RUN_FINAL'
const FINAL_CALL = 'headless-team-run-final'
const GOAL_READ_CALL = 'headless-team-run-goal-read'
const GOAL_UPDATE_CALL = 'headless-team-run-goal-update'
const UPDATED_OBJECTIVE = 'Use the durable Team objective.'
const TASK_FINAL_TEXT = 'HEADLESS_TEAM_TASK_FINAL'
const WORKFLOW_FINAL_TEXT = 'HEADLESS_TEAM_WORKFLOW_FINAL'
const TASK_SUBJECT = 'Complete the deterministic Team task.'
const TASK_INSTRUCTIONS = 'Return the deterministic worker summary.'
const TASK_SUMMARY = 'HEADLESS_TEAM_TASK_WORKER_SUMMARY'
const WORKFLOW_TASK = 'Compile one deterministic workflow.'
const WORKFLOW_TASK_SUMMARY = 'HEADLESS_TEAM_WORKFLOW_TASK_SUMMARY'
const MULTI_WORKFLOW_TASK = 'Compile one deterministic multi-worker workflow.'
const MULTI_WORKFLOW_TASK_SUMMARY = 'HEADLESS_TEAM_MULTI_WORKFLOW_TASK_SUMMARY'
const MULTI_WORKFLOW_FINAL_TEXT = 'HEADLESS_TEAM_MULTI_WORKFLOW_FINAL'
const OWNER_PROPOSAL_TASK = 'Propose one deterministic owner hint.'
const OWNER_PROPOSAL_FINAL_TEXT = 'HEADLESS_TEAM_OWNER_PROPOSAL_FINAL'

const WORKFLOW_PLAN = {
  version: 1,
  name: 'headless-workflow',
  tasks: [{
    id: 'research',
    subject: 'Compile the workflow task.',
    description: 'Return the deterministic workflow worker summary.',
    blockedBy: [],
    requiredCapabilities: ['team-default-worker'],
    priority: 0,
    readScopes: ['examples/headless-agent'],
    writeScopes: [],
    workspaceMode: 'shared',
    budget: {},
    reviewPolicy: { kind: 'none' },
    maxAttempts: 1,
  }],
  bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
  channel: {
    participantRoles: ['coordinator', process.env.CLOCKY_WORKFLOW_MEMBER_ROLE ?? 'worker'],
    viewPolicy: { type: 'recent-window', version: 1 },
    graph: {
      initial: { kind: 'participant', role: 'coordinator' },
      transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }],
      maxTurns: 1,
    },
  },
  result: { kind: 'task-results', taskTemplateIds: ['research'] },
}

const MULTI_WORKFLOW_PLAN = {
  version: 1,
  name: 'headless-multi-worker-workflow',
  tasks: [
    {
      id: 'research-a',
      subject: 'Compile the workflow task A.',
      description: 'Return the deterministic workflow worker summary for task A.',
      blockedBy: [],
      requiredCapabilities: ['team-default-worker'],
      priority: 1,
      readScopes: ['examples/headless-agent'],
      writeScopes: [],
      workspaceMode: 'shared',
      budget: {},
      reviewPolicy: { kind: 'none' },
      maxAttempts: 1,
    },
    {
      id: 'research-b',
      subject: 'Compile the workflow task B.',
      description: 'Return the deterministic workflow worker summary for task B.',
      blockedBy: [],
      requiredCapabilities: ['team-default-worker'],
      priority: 0,
      readScopes: ['examples/headless-agent'],
      writeScopes: [],
      workspaceMode: 'shared',
      budget: {},
      reviewPolicy: { kind: 'none' },
      maxAttempts: 1,
    },
  ],
  bounds: { maxTasks: 2, maxParallelism: 2, maxTotalAttempts: 2 },
  channel: {
    participantRoles: ['coordinator', 'worker'],
    viewPolicy: { type: 'recent-window', version: 1 },
    graph: {
      initial: { kind: 'participant', role: 'coordinator' },
      transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }],
      maxTurns: 1,
    },
  },
  result: { kind: 'task-results', taskTemplateIds: ['research-a', 'research-b'] },
}

function hasTeamFinal(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && block.name === 'team_final'))
}

function finalChannelId(system: string | undefined): string {
  const channelId = system?.match(/call team_final with channel_id ([^\s]+) and/u)?.[1]
  if (channelId === undefined) throw new Error('headless-team-run-llm: coordinator prompt did not supply a direct channel id')
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

function toolChunks(callId: string, name: string, args: Record<string, unknown>): StreamChunk[] {
  const id = CallId(callId)
  const argumentsText = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function finalChunks(channelId: string): StreamChunk[] {
  return toolChunks(FINAL_CALL, 'team_final', { channel_id: channelId, text: FINAL_TEXT })
}

function toolCall(messages: GenerateOptions['messages'], name: string) {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue
    const call = message.content.find(block => block.type === 'tool-call' && block.name === name)
    if (call !== undefined && call.type === 'tool-call') return call
  }
  return undefined
}

function toolResultText(messages: GenerateOptions['messages'], callId: string): string | undefined {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const result = message.content.find(block => block.type === 'tool-result' && block.toolCallId === callId)
    if (result === undefined || result.type !== 'tool-result') continue
    const text = result.content.find(block => block.type === 'text')
    if (text !== undefined && text.type === 'text') return text.text
  }
  return undefined
}

function taskId(messages: GenerateOptions['messages'], callId: string): string {
  const result = toolResultText(messages, callId)
  if (result === undefined) throw new Error('headless-team-run-llm: coordinator task start has no result')
  const value = JSON.parse(result) as { task_id?: unknown }
  if (typeof value.task_id !== 'string') throw new Error('headless-team-run-llm: task start result has no task_id')
  return value.task_id
}

function workflowPlanId(messages: GenerateOptions['messages'], callId: string): string {
  const result = toolResultText(messages, callId)
  if (result === undefined) throw new Error('headless-team-run-llm: workflow start has no result')
  const value = JSON.parse(result) as { plan_id?: unknown }
  if (typeof value.plan_id !== 'string') throw new Error('headless-team-run-llm: workflow start result has no plan_id')
  return value.plan_id
}

function isWorkflowRequest(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'user'
    && message.content.some(block => block.type === 'text'
      && (block.text === WORKFLOW_TASK || block.text === MULTI_WORKFLOW_TASK)))
}

function isMultiWorkflowRequest(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'user'
    && message.content.some(block => block.type === 'text' && block.text === MULTI_WORKFLOW_TASK))
}

function isMultiWorkflowAssignment(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'user'
    && message.content.some(block => block.type === 'text'
      && (block.text.includes('workflow task A.') || block.text.includes('workflow task B.'))))
}

function isOwnerProposalRequest(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'user'
    && message.content.some(block => block.type === 'text' && block.text === OWNER_PROPOSAL_TASK))
}

function goalRevision(messages: GenerateOptions['messages'], callId: string): number {
  const result = toolResultText(messages, callId)
  if (result === undefined) throw new Error('headless-team-run-llm: Team goal read has no result')
  const value = JSON.parse(result) as { revision?: unknown }
  const revision = value.revision
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('headless-team-run-llm: Team goal read has no revision')
  }
  return revision
}

function assignment(messages: GenerateOptions['messages']): { readonly taskId: string; readonly attemptId: string } {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = message.content.find(block => block.type === 'text')
    if (text === undefined || text.type !== 'text' || !text.text.startsWith('Team task assignment:')) continue
    const task = /\nTask: (\S+)\nAttempt: (\S+)/u.exec(text.text)
    if (task?.[1] !== undefined && task[2] !== undefined) return { taskId: task[1], attemptId: task[2] }
  }
  throw new Error('headless-team-run-llm: worker did not receive a Team task assignment')
}

function hasAssignment(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'user'
    && message.content.some(block => block.type === 'text' && block.text.startsWith('Team task assignment:')))
}

function isWorkflowAssignment(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'user'
    && message.content.some(block => block.type === 'text' && block.text.includes('Compile the workflow task')))
}

class HeadlessTeamRunAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const chunks = options.purpose === 'session-title'
      ? textChunks('Headless Team Run')
      : hasTeamFinal(options.messages)
        ? textChunks('The final result was delivered.')
        : toolCall(options.messages, 'get_goal') === undefined
          ? toolChunks(GOAL_READ_CALL, 'get_goal', {})
          : toolCall(options.messages, 'update_goal') === undefined
            ? toolChunks(GOAL_UPDATE_CALL, 'update_goal', {
              revision: goalRevision(options.messages, GOAL_READ_CALL),
              objective: UPDATED_OBJECTIVE,
            })
            : finalChunks(finalChannelId(options.system))
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

class HeadlessTeamTaskAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    let chunks: StreamChunk[]
    if (options.purpose === 'session-title') {
      chunks = textChunks('Headless Team Task')
    } else if (hasAssignment(options.messages)) {
      const report = toolCall(options.messages, 'team_task_report')
      if (report === undefined) {
        const task = assignment(options.messages)
        chunks = toolChunks('headless-team-task-report', 'team_task_report', {
          task_id: task.taskId,
          attempt_id: task.attemptId,
          outcome: 'completed',
          summary: isWorkflowAssignment(options.messages)
            ? isMultiWorkflowAssignment(options.messages) ? MULTI_WORKFLOW_TASK_SUMMARY : WORKFLOW_TASK_SUMMARY
            : TASK_SUMMARY,
        })
      } else {
        chunks = textChunks(isWorkflowAssignment(options.messages) ? WORKFLOW_TASK_SUMMARY : TASK_SUMMARY)
      }
    } else if (isWorkflowRequest(options.messages)) {
      const start = toolCall(options.messages, 'team_workflow_start')
      if (start === undefined) {
        chunks = toolChunks('headless-team-workflow-start', 'team_workflow_start', {
          plan: isMultiWorkflowRequest(options.messages) ? MULTI_WORKFLOW_PLAN : WORKFLOW_PLAN,
        })
      } else {
        const wait = toolCall(options.messages, 'team_workflow_wait')
        if (wait === undefined) {
          chunks = toolChunks('headless-team-workflow-wait', 'team_workflow_wait', {
            plan_id: workflowPlanId(options.messages, start.id),
          })
        } else if (toolCall(options.messages, 'team_final') === undefined) {
          if (toolResultText(options.messages, wait.id) === undefined) {
            throw new Error('headless-team-run-llm: workflow wait has no result')
          }
          chunks = toolChunks('headless-team-workflow-final', 'team_final', {
            channel_id: finalChannelId(options.system),
            text: isMultiWorkflowRequest(options.messages) ? MULTI_WORKFLOW_FINAL_TEXT : WORKFLOW_FINAL_TEXT,
          })
        } else {
          chunks = textChunks(isMultiWorkflowRequest(options.messages) ? MULTI_WORKFLOW_FINAL_TEXT : WORKFLOW_FINAL_TEXT)
        }
      }
    } else if (isOwnerProposalRequest(options.messages)) {
      const start = toolCall(options.messages, 'team_task_start')
      if (start === undefined) {
        chunks = toolChunks('headless-team-owner-proposal-start', 'team_task_start', {
          subject: 'Reserve a task for owner proposal.',
          instructions: 'Leave the task pending while its advisory owner proposal is tested.',
          read_scopes: [],
          write_scopes: [],
        })
      } else {
        const proposal = toolCall(options.messages, 'team_task_propose_owner')
        if (proposal === undefined) {
          chunks = toolChunks('headless-team-owner-proposal-propose', 'team_task_propose_owner', {
            task_id: taskId(options.messages, start.id),
          })
        } else {
          const cancel = toolCall(options.messages, 'team_task_cancel')
          if (cancel === undefined) {
            chunks = toolChunks('headless-team-owner-proposal-cancel', 'team_task_cancel', {
              task_id: taskId(options.messages, start.id),
            })
          } else if (toolCall(options.messages, 'team_final') === undefined) {
            if (toolResultText(options.messages, cancel.id) === undefined) {
              throw new Error('headless-team-run-llm: owner proposal cancel has no result')
            }
            chunks = toolChunks('headless-team-owner-proposal-final', 'team_final', {
              channel_id: finalChannelId(options.system), text: OWNER_PROPOSAL_FINAL_TEXT,
            })
          } else {
            chunks = textChunks(OWNER_PROPOSAL_FINAL_TEXT)
          }
        }
      }
    } else {
      const start = toolCall(options.messages, 'team_task_start')
      if (start === undefined) {
        chunks = toolChunks('headless-team-task-start', 'team_task_start', {
          subject: TASK_SUBJECT,
          instructions: TASK_INSTRUCTIONS,
          read_scopes: ['examples/headless-agent'],
          write_scopes: [],
        })
      } else {
        const wait = toolCall(options.messages, 'team_task_wait')
        if (wait === undefined) {
          chunks = toolChunks('headless-team-task-wait', 'team_task_wait', { task_id: taskId(options.messages, start.id) })
        } else if (toolCall(options.messages, 'team_final') === undefined) {
          if (toolResultText(options.messages, wait.id) === undefined) {
            throw new Error('headless-team-run-llm: coordinator task wait has no result')
          }
          chunks = toolChunks('headless-team-task-final', 'team_final', {
            channel_id: finalChannelId(options.system), text: TASK_FINAL_TEXT,
          })
        } else {
          chunks = textChunks(TASK_FINAL_TEXT)
        }
      }
    }
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

export const name = 'headless-team-run-llm'
export const inject = ['llm']

/** Register the isolated snapshot model route. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['headless-team-run-mock'], new HeadlessTeamRunAdapter())
  ctx.llm.registerAdapter(['headless-team-task-mock'], new HeadlessTeamTaskAdapter())
}
