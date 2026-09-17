/**
 * Model-facing Team task-reporting and final-answer operations.
 *
 * @module @clocky/clocky-tool-team
 */

import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type { Agent } from '@clocky/clocky-agent'
import { HarnessError } from '@clocky/clocky-llm'
import type { SessionEvent, TeamChannelViewEventData } from '@clocky/clocky-session'
import {
  DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
} from '@clocky/clocky-team-channel-direct'
import { CONSULT_RESPONSE_KIND, resolveConsultTextDraft } from '@clocky/clocky-team-channel-basic'
import type { ConsultTextRequestAnchor } from '@clocky/clocky-team-channel-basic'
import {
  activationIdSchema,
  channelIdSchema,
  channelPostIdempotencyKeySchema,
  envelopeIdSchema,
  participantIdSchema,
  taskAttemptIdSchema,
  teamIdSchema,
  teamTaskSnapshotSchema,
  teamTaskIdSchema,
  taskAttemptResultSchema,
} from '@clocky/clocky-team'
import type {
  JsonObject,
  ActivationBindingSnapshot,
  ChannelId,
  ChannelSnapshot,
  EnvelopeId,
  ParticipantId,
  TaskAttemptIntegrationResult,
  TaskAttemptId,
  TaskAttemptOutcome,
  TeamReviewAssignmentSource,
  TeamId,
  TeamEnvelope,
  TeamTaskId,
  TeamTaskSnapshot,
  TeamStateSnapshot,
} from '@clocky/clocky-team'
import type { TeamLink, TeamLinkBoundLinkBorrower } from '@clocky/clocky-team-link'
import type {} from '@clocky/clocky-team-workspace'
import { defineTool } from '@clocky/clocky-tools'
import type { GenericCallView, ToolRunContext } from '@clocky/clocky-tools'

/** Cordis plugin name. */
export const name = 'tool-team'
/** Link transport, Agent registry, and scoped Tool registry must exist before installation. */
export const inject = ['teamLinks', 'agents', 'tools']

const DEFAULT_LINK_PROVIDER = 'local'

/** Deployment choice selecting the bound Team Link provider used by model-originated Team operations. */
export interface Config {
  /** Named Team Link provider used for model-originated task reports and final answers. */
  readonly linkProvider?: string
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  linkProvider: z.string().default(DEFAULT_LINK_PROVIDER),
})

/** Outcome forms that a task-owning model may report. Scheduler-only expiry and external cancellation stay unavailable. */
type ReportedOutcome = Extract<TaskAttemptOutcome, { readonly kind: 'released' | 'failed' | 'completed' }>

/** Exact durable review provenance accepted by the review-resolution tool. */
interface CurrentReviewAssignment {
  readonly teamId: TeamId
  readonly channelId: ChannelId
  readonly envelopeId: EnvelopeId
  readonly taskId: TeamTaskId
  readonly attemptId: TaskAttemptId
  readonly reviewRevision: number
  readonly reviewerId: ParticipantId
  readonly initiatorId: ParticipantId
}

/** Compact model-visible result for one renewed task lease. */
interface TaskHeartbeatValue {
  readonly task: {
    readonly id: string
    readonly revision: number
    readonly phase: 'running'
  }
  readonly attempt: {
    readonly id: string
    readonly expiresAt: number
  }
}

/** Compact model-visible result for one reviewer decision. */
interface TaskReviewValue {
  readonly task: {
    readonly id: string
    readonly revision: number
    readonly phase: 'pending' | 'completed'
  }
  readonly decision: 'accepted' | 'rework'
  readonly reason: string
}

/** Compact model-visible confirmation for one explicit Team channel message. */
interface TeamMessageValue {
  readonly channel_id: string
  readonly envelope_id: string
}

/** Persisted task-assignment provenance parsed from one durable `user/message` source. */
interface TaskAssignmentSource {
  readonly kind: 'team-task-assignment'
  readonly teamId: ReturnType<typeof teamIdSchema.parse>
  readonly channelId: ReturnType<typeof channelIdSchema.parse>
  readonly envelopeId: ReturnType<typeof envelopeIdSchema.parse>
  readonly taskId: ReturnType<typeof teamTaskIdSchema.parse>
  readonly attemptId: ReturnType<typeof taskAttemptIdSchema.parse>
  readonly assignedRevision: number
  readonly runningRevision: number
  readonly activationId: ReturnType<typeof activationIdSchema.parse>
}

/** Compact model-visible result for one accepted or replayed task report. */
interface TaskReportValue {
  readonly task: {
    readonly id: string
    readonly revision: number
    readonly phase: TeamTaskSnapshot['phase']
  }
  readonly attempt: {
    readonly id: string
    readonly outcome: ToolReportedOutcome
  }
  readonly status: 'settled' | 'already-recorded'
}

/** JSON-shaped artifact reference returned by a model-facing integration operation. */
type ToolArtifact = {
  readonly id: string
  readonly kind: 'file' | 'patch' | 'log' | 'screenshot' | 'report'
  readonly uri: string
  readonly contentHash?: string
  readonly sourceAttemptId?: string
  readonly visibility: 'private' | 'team' | 'human'
}

/** Compact provider result returned after one integration task settles. */
interface ToolIntegrationResult {
  readonly target: string
  readonly expectedTarget?: string
  readonly status: 'proposed' | 'integrated' | 'conflict'
  readonly targetVersion?: string
  readonly proposalArtifact?: ToolArtifact
  readonly conflictPaths?: string[]
  readonly verification?: string
  readonly artifacts?: ToolArtifact[]
}

/** Compact model-visible confirmation for one artifact-sourced integration task. */
interface TaskIntegrationValue {
  readonly task: {
    readonly id: string
    readonly revision: number
    readonly phase: TeamTaskSnapshot['phase']
  }
  readonly attempt: {
    readonly id: string
    readonly outcome: {
      readonly kind: 'completed'
      readonly result: {
        readonly summary: string
        readonly integration: ToolIntegrationResult
        readonly verification?: string
      }
    }
  }
  readonly status: 'settled' | 'already-recorded'
}

/** JSON-schema-shaped report outcome used by the model-facing output renderer. */
type ToolReportedOutcome =
  | { readonly kind: 'released' }
  | { readonly kind: 'failed'; readonly failure: { readonly code: string; readonly message: string } }
  | {
    readonly kind: 'completed'
    readonly result: {
      readonly summary: string
      readonly evidence?: string[]
      readonly artifacts?: ToolArtifact[]
      readonly changedPaths?: string[]
      readonly verification?: string
      readonly integration?: ToolIntegrationResult
    }
  }

const TOOL_ARTIFACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['file', 'patch', 'log', 'screenshot', 'report'] },
    uri: { type: 'string', required: true },
    contentHash: { type: 'string' },
    sourceAttemptId: { type: 'string' },
    visibility: { type: 'string', required: true, enum: ['private', 'team', 'human'] },
  },
} as const

const TOOL_INTEGRATION_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    expectedTarget: { type: 'string' },
    status: { type: 'string', required: true, enum: ['proposed', 'integrated', 'conflict'] },
    targetVersion: { type: 'string' },
    proposalArtifact: TOOL_ARTIFACT_SCHEMA,
    conflictPaths: { type: 'array', items: { type: 'string' } },
    verification: { type: 'string' },
    artifacts: { type: 'array', items: TOOL_ARTIFACT_SCHEMA },
  },
} as const

/** Compact model-visible confirmation for one accepted direct final Envelope. */
interface TeamFinalValue {
  /** Channel that accepted the final Envelope. */
  readonly channel_id: string
  /** Hub-stamped identity of the accepted final Envelope. */
  readonly envelope_id: string
}

const TASK_REPORT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        id: { type: 'string', required: true },
        revision: { type: 'integer', required: true },
        phase: {
          type: 'string',
          required: true,
          enum: ['pending', 'assigned', 'running', 'review', 'completed', 'failed', 'cancelled', 'deleted'],
        },
      },
    },
    attempt: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        id: { type: 'string', required: true },
        outcome: {
          required: true,
          oneOf: [
            { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'released' } } },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'failed' },
                failure: {
                  type: 'object',
                  additionalProperties: false,
                  required: true,
                  properties: {
                    code: { type: 'string', required: true },
                    message: { type: 'string', required: true },
                  },
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'completed' },
                result: {
                  type: 'object',
                  additionalProperties: false,
                  required: true,
                  properties: {
                    summary: { type: 'string', required: true },
                    evidence: { type: 'array', items: { type: 'string' } },
                    artifacts: { type: 'array', items: TOOL_ARTIFACT_SCHEMA },
                    changedPaths: { type: 'array', items: { type: 'string' } },
                    verification: { type: 'string' },
                    integration: TOOL_INTEGRATION_RESULT_SCHEMA,
                  },
                },
              },
            },
          ],
        },
      },
    },
    status: { type: 'string', required: true, enum: ['settled', 'already-recorded'] },
  },
} as const

const TASK_REPORT_OUTPUT = {
  schema: TASK_REPORT_VALUE_SCHEMA,
  render: (_args: unknown, value: TaskReportValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

const TASK_INTEGRATION_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      task: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          id: { type: 'string', required: true },
          revision: { type: 'integer', required: true },
          phase: {
            type: 'string',
            required: true,
            enum: ['pending', 'assigned', 'running', 'review', 'completed', 'failed', 'cancelled', 'deleted'],
          },
        },
      },
      attempt: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          id: { type: 'string', required: true },
          outcome: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              kind: { type: 'string', required: true, const: 'completed' },
              result: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  summary: { type: 'string', required: true },
                  integration: TOOL_INTEGRATION_RESULT_SCHEMA,
                  verification: { type: 'string' },
                },
              },
            },
          },
        },
      },
      status: { type: 'string', required: true, enum: ['settled', 'already-recorded'] },
    },
  } as const,
  render: (_args: unknown, value: TaskIntegrationValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

const TASK_HEARTBEAT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      task: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          id: { type: 'string', required: true },
          revision: { type: 'integer', required: true },
          phase: { type: 'string', required: true, const: 'running' },
        },
      },
      attempt: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          id: { type: 'string', required: true },
          expiresAt: { type: 'integer', required: true },
        },
      },
    },
  } as const,
  render: (_args: unknown, value: TaskHeartbeatValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

const TASK_REVIEW_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      task: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          id: { type: 'string', required: true },
          revision: { type: 'integer', required: true },
          phase: { type: 'string', required: true, enum: ['pending', 'completed'] },
        },
      },
      decision: { type: 'string', required: true, enum: ['accepted', 'rework'] },
      reason: { type: 'string', required: true },
    },
  } as const,
  render: (_args: unknown, value: TaskReviewValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

const TEAM_MESSAGE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      channel_id: { type: 'string', required: true },
      envelope_id: { type: 'string', required: true },
    },
  } as const,
  render: (_args: unknown, value: TeamMessageValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

const TEAM_FINAL_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    channel_id: { type: 'string', required: true },
    envelope_id: { type: 'string', required: true },
  },
} as const

const TEAM_FINAL_OUTPUT = {
  schema: TEAM_FINAL_VALUE_SCHEMA,
  render: (_args: unknown, value: TeamFinalValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/** Validate configuration when callers mount the plugin directly without Loader normalization. */
function resolveConfig(config: Config): { readonly linkProvider: string } {
  const linkProvider = config.linkProvider ?? DEFAULT_LINK_PROVIDER
  if (linkProvider.length === 0 || linkProvider.trim() !== linkProvider) {
    throw new TypeError('linkProvider must be non-empty without surrounding whitespace')
  }
  return { linkProvider }
}

/** Register Team task-reporting and final-answer tools in one Team-bound Agent's exact scope. */
function install(agent: Agent, ctx: Context, linkProvider: string): () => void {
  const unregisterReport = agent.ctx.tools.register(defineTool({
    name: 'team_task_report',
    description: 'Report completion, failure, or release for one running Team task attempt assigned to you. '
      + 'Use the exact task_id and attempt_id from the task assignment message. completed records summary and enters review only when the task names a reviewer; '
      + 'otherwise it completes the task directly; '
      + 'failed or released returns it to pending unless its attempt limit is exhausted.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Exact Team task id from the task assignment message.' },
      attempt_id: { type: 'string', required: true, description: 'Exact attempt id from the task assignment message.' },
      outcome: { type: 'string', required: true, enum: ['completed', 'failed', 'released'] },
      summary: { type: 'string', description: 'Concise result summary; required only with completed.' },
      evidence: { type: 'array', items: { type: 'string' }, description: 'Optional evidence statements supporting the result.' },
      artifacts: { type: 'array', items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          kind: { type: 'string', required: true, enum: ['file', 'patch', 'log', 'screenshot', 'report'] },
          uri: { type: 'string', required: true },
          contentHash: { type: 'string' },
          sourceAttemptId: { type: 'string' },
          visibility: { type: 'string', required: true, enum: ['private', 'team', 'human'] },
        },
      }, description: 'Optional artifact references produced by this attempt.' },
      changed_paths: { type: 'array', items: { type: 'string' }, description: 'Optional changed paths from the execution workspace.' },
      verification: { type: 'string', description: 'Optional verification command or summary.' },
      failure_code: { type: 'string', description: 'Stable failure classification; required only with failed.' },
      failure_message: { type: 'string', description: 'Concrete failure explanation; required only with failed.' },
    },
    output: TASK_REPORT_OUTPUT,
    async execute(args, exec) {
      const outcome = reportOutcome(args)
      return await report(ctx, requireExecution(ctx, exec, agent, 'team_task_report'), linkProvider, args.task_id, args.attempt_id, outcome, exec.signal)
    },
    presentCall: args => presentReport(args.outcome, args.task_id),
  }))
  const unregisterIntegration = agent.ctx.tools.register(defineTool({
    name: 'team_task_integrate',
    description: 'Execute the current assigned Team integration task from its completed source attempt. '
      + 'The Hub derives the source task, provider, target, expected target revision, and operation mode from the durable task; '
      + 'use the exact task_id and attempt_id from the task assignment message. The provider validates the source attempt artifact manifest; '
      + 'integration-capable providers consume one provenance-bound patch artifact in their provider-owned format; directory providers use the portable change-set encoding.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Exact integration task id from the task assignment message.' },
      attempt_id: { type: 'string', required: true, description: 'Exact integration attempt id from the task assignment message.' },
      verification: { type: 'string', description: 'Optional verification command or summary to retain with the integration result.' },
    },
    output: TASK_INTEGRATION_OUTPUT,
    async execute(args, exec) {
      return await integrateTask(
        ctx,
        requireExecution(ctx, exec, agent, 'team_task_integrate'),
        linkProvider,
        args.task_id,
        args.attempt_id,
        args.verification,
      )
    },
    presentCall: args => presentIntegration(args.task_id),
  }))
  const unregisterHeartbeat = agent.ctx.tools.register(defineTool({
    name: 'team_task_heartbeat',
    description: 'Renew the lease for one running Team task attempt assigned to you. '
      + 'Use the exact task_id and attempt_id from the task assignment message before the lease expires.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Exact Team task id from the task assignment message.' },
      attempt_id: { type: 'string', required: true, description: 'Exact attempt id from the task assignment message.' },
    },
    output: TASK_HEARTBEAT_OUTPUT,
    async execute(args, exec) {
      return await heartbeat(ctx, requireExecution(ctx, exec, agent, 'team_task_heartbeat'), linkProvider, args.task_id, args.attempt_id)
    },
    presentCall: args => presentHeartbeat(args.task_id),
  }))
  const unregisterReview = agent.ctx.tools.register(defineTool({
    name: 'team_task_review',
    description: 'Accept or return one Team task result for rework when you are the configured reviewer. '
      + 'Use the task_id from the current review assignment and a concise reason; its durable revision fence is derived from that assignment.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Exact Team task id awaiting your review.' },
      decision: { type: 'string', required: true, enum: ['accepted', 'rework'] },
      reason: { type: 'string', required: true, description: 'Non-empty explanation for the review decision.' },
    },
    output: TASK_REVIEW_OUTPUT,
    async execute(args, exec) {
      return await reviewTask(
        ctx,
        requireExecution(ctx, exec, agent, 'team_task_review'),
        linkProvider,
        args.task_id,
        args.decision,
        args.reason,
      )
    },
    presentCall: args => presentReview(args.task_id),
  }))
  const unregisterMessage = agent.ctx.tools.register(defineTool({
    name: 'team_message',
    description: 'Send an explicit text message to a Team channel. The sender is derived from your current activation; '
      + 'the channel adapter validates recipients, turn order, and delivery intent. For an ordinary consult, answer its logged request with turn delivery; task reviews require team_task_review.',
    parameters: {
      channel_id: { type: 'string', required: true, description: 'Exact Team channel id.' },
      text: { type: 'string', required: true, description: 'Non-empty message text.' },
      audience: { type: 'array', items: { type: 'string' }, description: 'Optional explicit recipients; omit for adapter-defined broadcast.' },
      delivery: { type: 'string', required: true, enum: ['context', 'turn', 'steer'] },
    },
    output: TEAM_MESSAGE_OUTPUT,
    async execute(args, exec) {
      return await sendMessage(
        ctx,
        requireExecution(ctx, exec, agent, 'team_message'),
        linkProvider,
        messageIdempotencyKey(exec),
        args.channel_id,
        args.text,
        args.audience,
        args.delivery,
      )
    },
    presentCall: args => presentMessage(args.channel_id),
  }))
  const unregisterFinal = agent.ctx.tools.register(defineTool({
    name: 'team_final',
    description: 'Send the final answer through the assigned Team result channel. '
      + 'Use the exact channel_id of the final-answer channel; the recipient is derived from that channel.',
    parameters: {
      channel_id: { type: 'string', required: true, description: 'Exact two-party direct Team channel id.' },
      text: { type: 'string', required: true, description: 'Non-empty final answer for the other channel participant.' },
    },
    output: TEAM_FINAL_OUTPUT,
    async execute(args, exec) {
      const parsed = finalArguments(args)
      return await sendFinal(
        ctx,
        requireExecution(ctx, exec, agent, 'team_final'),
        linkProvider,
        finalIdempotencyKey(exec),
        parsed.channelId,
        parsed.text,
      )
    },
    presentCall: args => presentFinal(args.channel_id),
  }))
  return () => {
    unregisterIntegration()
    unregisterFinal()
    unregisterMessage()
    unregisterReview()
    unregisterHeartbeat()
    unregisterReport()
  }
}

/** Install Team tools only for live Agents whose Session header identifies a Team Participant. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const installed = new Map<Agent, () => void>()
  const installAgent = (agent: Agent): void => {
    if (installed.has(agent) || teamParticipant(agent) === undefined) return
    installed.set(agent, install(agent, ctx, resolved.linkProvider))
  }
  for (const agent of ctx.agents.list()) installAgent(agent)
  ctx.on('agent/created', ({ agent }) => { installAgent(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'toolTeam.scopedTools()')
}

/** Extract an exact Team/Participant header pair or reject model use outside a Team-bound Session. */
function teamParticipant(agent: Agent): {
  readonly teamId: ReturnType<typeof teamIdSchema.parse>
  readonly participantId: ReturnType<typeof participantIdSchema.parse>
} | undefined {
  const teamId = teamIdSchema.safeParse(agent.session.header.teamId)
  const participantId = participantIdSchema.safeParse(agent.session.header.participantId)
  return teamId.success && participantId.success ? { teamId: teamId.data, participantId: participantId.data } : undefined
}

/** Recover an exact live calling Agent under the active Agent driver. */
function requireExecution(
  ctx: Context,
  exec: ToolRunContext,
  scopedAgent: Agent,
  tool: 'team_task_report' | 'team_task_integrate' | 'team_task_heartbeat' | 'team_task_review' | 'team_message' | 'team_final',
): Agent {
  const agent = exec.agent
  if (agent === undefined) throw executionError(tool, `${tool} requires a calling Agent`, 'AGENT_REQUIRED')
  if (agent !== scopedAgent || ctx.agents.get(agent.id) !== agent || agent.status !== 'running'
    || ctx.agents.currentInitiator() !== agent) {
    throw executionError(tool, `${tool} requires its exact live scoped Agent inside an active driver`, 'DRIVER_REQUIRED')
  }
  return agent
}

/** Create the execution-authentication failure for one scoped Team tool. */
function executionError(
  tool: 'team_task_report' | 'team_task_integrate' | 'team_task_heartbeat' | 'team_task_review' | 'team_message' | 'team_final',
  message: string,
  suffix: 'AGENT_REQUIRED' | 'DRIVER_REQUIRED',
): HarnessError {
  const prefix = tool === 'team_task_report'
    ? 'TEAM_TASK_REPORT'
    : tool === 'team_task_integrate'
      ? 'TEAM_TASK_INTEGRATE'
      : tool === 'team_task_heartbeat'
        ? 'TEAM_TASK_HEARTBEAT'
        : tool === 'team_task_review'
          ? 'TEAM_TASK_REVIEW'
          : tool === 'team_message' ? 'TEAM_MESSAGE' : 'TEAM_FINAL'
  return new HarnessError(message, `${prefix}_${suffix}`)
}

/** Validate model arguments into the closed worker-report outcome vocabulary. */
function reportOutcome(args: {
  readonly outcome: 'completed' | 'failed' | 'released'
  readonly summary?: string
  readonly evidence?: readonly string[]
  readonly artifacts?: readonly {
    readonly id: string
    readonly kind: 'file' | 'patch' | 'log' | 'screenshot' | 'report'
    readonly uri: string
    readonly contentHash?: string
    readonly sourceAttemptId?: string
    readonly visibility: 'private' | 'team' | 'human'
  }[]
  readonly changed_paths?: readonly string[]
  readonly verification?: string
  readonly failure_code?: string
  readonly failure_message?: string
}): ReportedOutcome {
  switch (args.outcome) {
    case 'completed':
      requireAbsent(args.failure_code, 'failure_code', 'completed')
      requireAbsent(args.failure_message, 'failure_message', 'completed')
      return {
        kind: 'completed',
        result: taskAttemptResultSchema.parse({
          summary: requireText(args.summary, 'summary', 'completed'),
          ...args.evidence === undefined ? {} : { evidence: [...args.evidence] },
          ...args.artifacts === undefined ? {} : { artifacts: args.artifacts.map(artifact => ({ ...artifact })) },
          ...args.changed_paths === undefined ? {} : { changedPaths: [...args.changed_paths] },
          ...args.verification === undefined ? {} : { verification: args.verification },
        }),
      }
    case 'failed':
      requireAbsent(args.summary, 'summary', 'failed')
      return {
        kind: 'failed',
        failure: {
          code: requireText(args.failure_code, 'failure_code', 'failed'),
          message: requireText(args.failure_message, 'failure_message', 'failed'),
        },
      }
    case 'released':
      requireAbsent(args.summary, 'summary', 'released')
      requireAbsent(args.failure_code, 'failure_code', 'released')
      requireAbsent(args.failure_message, 'failure_message', 'released')
      return { kind: 'released' }
    /* v8 ignore next 2 -- tool schema fixes the closed outcome union. */
    default:
      args.outcome satisfies never
      throw reportError('team_task_report received an unsupported outcome', 'TEAM_TASK_REPORT_INVALID_OUTCOME')
  }
}

/** Require a non-blank action-specific model argument. */
function requireText(value: string | undefined, name: string, outcome: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw reportError(`${name} is required with outcome ${outcome}`, 'TEAM_TASK_REPORT_INVALID_OUTCOME')
  }
  return value
}

/** Reject meaningful arguments that are invalid for the selected outcome. */
function requireAbsent(value: string | undefined, name: string, outcome: string): void {
  if (value !== undefined && value.trim().length > 0) {
    throw reportError(`${name} is valid only with its matching task outcome, not ${outcome}`, 'TEAM_TASK_REPORT_INVALID_OUTCOME')
  }
}

/** Require one consistent durable assignment across original and continuation inputs. */
function assignmentSource(agent: Agent, taskId: string, attemptId: string, operation = 'team_task_report'): TaskAssignmentSource {
  const parsedTaskId = parseIdentifier(teamTaskIdSchema, taskId, 'task_id')
  const parsedAttemptId = parseIdentifier(taskAttemptIdSchema, attemptId, 'attempt_id')
  const sources = agent.session.events.flatMap((event) => {
    const source = sourceFromEvent(event)
    return source !== undefined && source.taskId === parsedTaskId && source.attemptId === parsedAttemptId ? [source] : []
  })
  const source = sources[0]
  if (source === undefined || sources.some(candidate => !isDeepStrictEqual(candidate, source))) {
    throw reportError(
      `${operation} requires one consistent durable task-assignment source for task '${taskId}' attempt '${attemptId}'`,
      'TEAM_TASK_REPORT_ASSIGNMENT_REQUIRED',
    )
  }
  return source
}

/** Parse a future-compatible task-assignment source from one durable user message. */
function sourceFromEvent(event: SessionEvent): TaskAssignmentSource | undefined {
  if (event.type !== 'user/message') return undefined
  const source = event.data.source as unknown
  if (!isRecord(source) || source.kind !== 'team-task-assignment') return undefined
  const teamId = teamIdSchema.safeParse(source.teamId)
  const channelId = channelIdSchema.safeParse(source.channelId)
  const envelopeId = envelopeIdSchema.safeParse(source.envelopeId)
  const taskId = teamTaskIdSchema.safeParse(source.taskId)
  const attemptId = taskAttemptIdSchema.safeParse(source.attemptId)
  const activationId = activationIdSchema.safeParse(source.activationId)
  if (!teamId.success || !channelId.success || !envelopeId.success || !taskId.success || !attemptId.success || !activationId.success
    || !isPositiveSafeInteger(source.assignedRevision) || !isPositiveSafeInteger(source.runningRevision)) return undefined
  return {
    kind: 'team-task-assignment',
    teamId: teamId.data,
    channelId: channelId.data,
    envelopeId: envelopeId.data,
    taskId: taskId.data,
    attemptId: attemptId.data,
    assignedRevision: source.assignedRevision,
    runningRevision: source.runningRevision,
    activationId: activationId.data,
  }
}

/** Report a source-authorized outcome through a short-lived bound Link. */
async function report(
  ctx: Context,
  agent: Agent,
  linkProvider: string,
  rawTaskId: string,
  rawAttemptId: string,
  outcome: ReportedOutcome,
  signal: AbortSignal,
): Promise<TaskReportValue> {
  const owner = teamParticipant(agent)
  if (owner === undefined) {
    throw reportError('team_task_report requires a Team and Participant Session header', 'TEAM_TASK_REPORT_ASSIGNMENT_REQUIRED')
  }
  const source = assignmentSource(agent, rawTaskId, rawAttemptId)
  if (source.teamId !== owner.teamId) {
    throw reportError('task-assignment source belongs to another Team', 'TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  }
  const teams = ctx.get('teams')
  if (teams === undefined) {
    const borrower = ctx.teamLinks.getBoundLinkBorrower(agent)
    if (borrower === undefined) {
      throw reportError('task-assignment source has no current bound Team Link', 'TEAM_TASK_REPORT_ASSIGNMENT_STALE')
    }
    return await reportBorrowed(borrower, agent, owner.participantId, source, outcome)
  }
  let task = await teams.getTask({ teamId: source.teamId, taskId: source.taskId })
  const recorded = recordedOutcome(task, source, outcome)
  if (recorded !== undefined) return reportValue(task, source, recorded, 'already-recorded')
  const binding = await teams.getActivation({ teamId: source.teamId, activationId: source.activationId })
  assertBinding(binding, agent, owner.participantId, source)
  assertRunningLease(task, owner.participantId, source)
  outcome = await publishWorkspaceOutcome(ctx, agent, teams, task, source.attemptId, outcome, signal)
  const link = await ctx.teamLinks.connect({ provider: linkProvider, binding })
  let settled: TeamTaskSnapshot | undefined
  let settlementFailure: unknown
  try {
    settled = await link.settleTaskAttempt({
      taskId: source.taskId,
      attemptId: source.attemptId,
      expectedRevision: task.revision,
      outcome,
    })
  } catch (error: unknown) {
    settlementFailure = error
    task = await teams.getTask({ teamId: source.teamId, taskId: source.taskId })
    const retried = recordedOutcome(task, source, outcome)
    if (retried !== undefined) return reportValue(task, source, retried, 'already-recorded')
    throw error
  } finally {
    try {
      await link.close()
    } catch (error: unknown) {
      if (settled === undefined && settlementFailure === undefined) throw error
      ctx.logger.warn(`tool-team: failed to close task-report Link: ${renderError(error)}`)
    }
  }
  const reported = teamTaskSnapshotSchema.safeParse(settled)
  if (!reported.success) {
    throw reportError('task-report Link settled without a valid task result', 'TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  }
  assertReportedTask(reported.data, source, outcome)
  return reportValue(reported.data, source, outcome, 'settled')
}

/** Execute the current integration task through its activation-bound Link. */
async function integrateTask(
  ctx: Context,
  agent: Agent,
  linkProvider: string,
  rawTaskId: string,
  rawAttemptId: string,
  rawVerification: string | undefined,
): Promise<TaskIntegrationValue> {
  const owner = teamParticipant(agent)
  if (owner === undefined) {
    throw reportError('team_task_integrate requires a Team and Participant Session header', 'TEAM_TASK_INTEGRATE_ASSIGNMENT_REQUIRED')
  }
  const source = assignmentSource(agent, rawTaskId, rawAttemptId, 'team_task_integrate')
  if (source.teamId !== owner.teamId) {
    throw reportError('integration task-assignment source belongs to another Team', 'TEAM_TASK_INTEGRATE_ASSIGNMENT_STALE')
  }
  const verification = rawVerification === undefined ? undefined : requireIntegrationVerification(rawVerification)
  const teams = ctx.get('teams')
  if (teams === undefined) {
    const borrower = ctx.teamLinks.getBoundLinkBorrower(agent)
    if (borrower === undefined) {
      throw reportError('team_task_integrate requires a current bound Team Link', 'TEAM_TASK_INTEGRATE_ASSIGNMENT_STALE')
    }
    const settled = await borrower.withLink(async (link) => {
      assertBorrowedBinding(link, agent, owner.participantId, source)
      return await link.integrateTask({
        taskId: source.taskId,
        attemptId: source.attemptId,
        expectedRevision: source.runningRevision,
        ...verification === undefined ? {} : { verification },
      })
    })
    return integrationTaskValue(settled, source, 'settled')
  }
  let task = await teams.getTask({ teamId: source.teamId, taskId: source.taskId })
  const recorded = task.attemptHistory.find(attempt => attempt.id === source.attemptId)
  if (recorded !== undefined) {
    if (recorded.outcome.kind === 'completed' && recorded.outcome.result.integration !== undefined) {
      return integrationTaskValue(task, source, 'already-recorded')
    }
    throw reportError('integration task attempt already recorded a different terminal outcome', 'TEAM_TASK_INTEGRATE_ASSIGNMENT_STALE')
  }
  const binding = await teams.getActivation({ teamId: source.teamId, activationId: source.activationId })
  assertBinding(binding, agent, owner.participantId, source)
  assertRunningLease(task, owner.participantId, source)
  const link = await ctx.teamLinks.connect({ provider: linkProvider, binding })
  let settled: TeamTaskSnapshot | undefined
  let integrationFailure: unknown
  try {
    settled = await link.integrateTask({
      taskId: source.taskId,
      attemptId: source.attemptId,
      expectedRevision: task.revision,
      ...verification === undefined ? {} : { verification },
    })
  } catch (error: unknown) {
    integrationFailure = error
    task = await teams.getTask({ teamId: source.teamId, taskId: source.taskId })
    const retry = task.attemptHistory.find(attempt => attempt.id === source.attemptId)
    if (retry?.outcome.kind === 'completed' && retry.outcome.result.integration !== undefined) {
      return integrationTaskValue(task, source, 'already-recorded')
    }
    throw error
  } finally {
    try {
      await link.close()
    } catch (error: unknown) {
      if (settled === undefined && integrationFailure === undefined) throw error
      ctx.logger.warn(`tool-team: failed to close task-integration Link: ${renderError(error)}`)
    }
  }
  return integrationTaskValue(settled, source, 'settled')
}

/** Require optional integration verification text to remain non-empty at the model boundary. */
function requireIntegrationVerification(value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw reportError('verification must be non-empty without surrounding whitespace', 'TEAM_TASK_INTEGRATE_INVALID_ARGUMENT')
  }
  return value
}

/** Convert a settled integration task into its compact model-visible result. */
function integrationTaskValue(
  task: TeamTaskSnapshot,
  source: TaskAssignmentSource,
  status: TaskIntegrationValue['status'],
): TaskIntegrationValue {
  const attempt = task.attemptHistory.find(candidate => candidate.id === source.attemptId)
  if (task.teamId !== source.teamId || task.id !== source.taskId
    || attempt?.outcome.kind !== 'completed' || attempt.outcome.result.integration === undefined) {
    throw reportError('Team Link returned a task without a durable integration result', 'TEAM_TASK_INTEGRATE_ASSIGNMENT_STALE')
  }
  return {
    task: { id: task.id, revision: task.revision, phase: task.phase },
    attempt: {
      id: source.attemptId,
      outcome: {
        kind: 'completed',
        result: {
          summary: attempt.outcome.result.summary,
          integration: toolIntegrationResult(attempt.outcome.result.integration),
          ...attempt.outcome.result.verification === undefined ? {} : { verification: attempt.outcome.result.verification },
        },
      },
    },
    status,
  }
}

/** Copy one durable integration result into the model-facing JSON vocabulary. */
function toolIntegrationResult(result: TaskAttemptIntegrationResult): ToolIntegrationResult {
  return {
    target: result.target,
    ...result.expectedTarget === undefined ? {} : { expectedTarget: result.expectedTarget },
    status: result.status,
    ...result.targetVersion === undefined ? {} : { targetVersion: result.targetVersion },
    ...result.proposalArtifact === undefined ? {} : { proposalArtifact: toolArtifact(result.proposalArtifact) },
    ...result.conflictPaths === undefined ? {} : { conflictPaths: [...result.conflictPaths] },
    ...result.verification === undefined ? {} : { verification: result.verification },
    ...result.artifacts === undefined ? {} : { artifacts: result.artifacts.map(artifact => toolArtifact(artifact)) },
  }
}

/** Convert one durable artifact reference into a model-facing detached value. */
function toolArtifact(artifact: TaskAttemptIntegrationResult['proposalArtifact']): ToolArtifact {
  /* v8 ignore next 2 -- toolIntegrationResult calls this only after checking the optional artifact. */
  if (artifact === undefined) throw new Error('integration artifact is undefined')
  return {
    id: artifact.id,
    kind: artifact.kind,
    uri: artifact.uri,
    ...artifact.contentHash === undefined ? {} : { contentHash: artifact.contentHash },
    ...artifact.sourceAttemptId === undefined ? {} : { sourceAttemptId: String(artifact.sourceAttemptId) },
    visibility: artifact.visibility,
  }
}

/** Add a provider-owned workspace change manifest before durable task settlement. */
async function publishWorkspaceOutcome(
  ctx: Context,
  agent: Agent,
  teams: Context['teams'],
  task: TeamTaskSnapshot,
  attemptId: TaskAttemptId,
  outcome: ReportedOutcome,
  signal: AbortSignal,
): Promise<ReportedOutcome> {
  if (outcome.kind !== 'completed') return outcome
  const state = await teams.getTeam({ teamId: task.teamId })
  const allocation = state.workspaceAllocations.find(value => value.taskId === task.id && value.attemptId === attemptId)
  if (allocation === undefined) return outcome
  const workspaces = ctx.get('teamWorkspaces')
  if (workspaces === undefined) throw reportError('The retained workspace allocation has no publisher registry', 'TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  const published = await workspaces.publishForOwner(agent, { taskId: task.id, attemptId, allocationId: allocation.id,
    expectedRevision: allocation.revision, signal })
  if (published === undefined) return outcome
  signal.throwIfAborted()
  const changedPaths = new Set([...(outcome.result.changedPaths ?? []), ...published.changedPaths])
  const artifacts = [...(outcome.result.artifacts ?? [])]
  for (const artifact of published.artifacts) {
    artifacts.push({
      ...artifact,
      sourceAttemptId: artifact.sourceAttemptId ?? allocation.attemptId,
    })
  }
  return {
    kind: 'completed',
    result: taskAttemptResultSchema.parse({
      ...outcome.result,
      ...changedPaths.size === 0 ? {} : { changedPaths: [...changedPaths].sort() },
      ...artifacts.length === 0 ? {} : { artifacts },
    }),
  }
}

/** Renew a source-authorized running task attempt through a bound Team Link. */
async function heartbeat(
  ctx: Context,
  agent: Agent,
  linkProvider: string,
  rawTaskId: string,
  rawAttemptId: string,
): Promise<TaskHeartbeatValue> {
  const owner = teamParticipant(agent)
  if (owner === undefined) {
    throw reportError('team_task_heartbeat requires a Team and Participant Session header', 'TEAM_TASK_HEARTBEAT_ASSIGNMENT_REQUIRED')
  }
  const source = assignmentSource(agent, rawTaskId, rawAttemptId, 'team_task_heartbeat')
  if (source.teamId !== owner.teamId) {
    throw reportError('task-assignment source belongs to another Team', 'TEAM_TASK_HEARTBEAT_ASSIGNMENT_STALE')
  }
  const teams = ctx.get('teams')
  if (teams === undefined) {
    const borrower = ctx.teamLinks.getBoundLinkBorrower(agent)
    if (borrower === undefined) {
      throw reportError('task-assignment source has no current bound Team Link', 'TEAM_TASK_HEARTBEAT_ASSIGNMENT_STALE')
    }
    return await borrower.withLink(async (link) => {
      assertBorrowedBinding(link, agent, owner.participantId, source)
      const renewed = await link.heartbeatTaskAttempt({
        taskId: source.taskId,
        attemptId: source.attemptId,
        expectedRevision: source.runningRevision,
      })
      return heartbeatValue(renewed, source)
    })
  }
  let task = await teams.getTask({ teamId: source.teamId, taskId: source.taskId })
  assertRunningLease(task, owner.participantId, source)
  const binding = await teams.getActivation({ teamId: source.teamId, activationId: source.activationId })
  assertBinding(binding, agent, owner.participantId, source)
  const link = await ctx.teamLinks.connect({ provider: linkProvider, binding })
  let renewed: TeamTaskSnapshot
  try {
    renewed = await link.heartbeatTaskAttempt({
      taskId: source.taskId,
      attemptId: source.attemptId,
      expectedRevision: task.revision,
    })
  } catch (error: unknown) {
    task = await teams.getTask({ teamId: source.teamId, taskId: source.taskId })
    if (task.phase === 'running' && task.lease?.attemptId === source.attemptId) {
      renewed = task
    } else {
      throw error
    }
  } finally {
    try {
      await link.close()
    } catch (error: unknown) {
      ctx.logger.warn(`tool-team: failed to close task-heartbeat Link: ${renderError(error)}`)
    }
  }
  return heartbeatValue(renewed, source)
}

/** Resolve one review task through the exact active Team participant identity. */
async function reviewTask(
  ctx: Context,
  agent: Agent,
  linkProvider: string,
  rawTaskId: string,
  rawDecision: string,
  rawReason: string,
): Promise<TaskReviewValue> {
  const owner = teamParticipant(agent)
  if (owner === undefined) {
    throw reportError('team_task_review requires a Team and Participant Session header', 'TEAM_TASK_REVIEW_ACTIVATION_REQUIRED')
  }
  /* v8 ignore next 2 -- defineTool validates this closed decision enum before execution. */
  if (rawDecision !== 'accepted' && rawDecision !== 'rework') {
    throw reportError('decision must be accepted or rework', 'TEAM_TASK_REVIEW_INVALID_DECISION')
  }
  const reason = rawReason.trim()
  if (reason.length === 0) throw reportError('reason must be non-empty', 'TEAM_TASK_REVIEW_INVALID_REASON')
  const taskId = parseIdentifier(teamTaskIdSchema, rawTaskId, 'task_id')
  const source = currentReviewAssignment(agent, taskId)
  if (source === undefined) {
    throw reportError('team_task_review requires the current durable review assignment source', 'TEAM_TASK_REVIEW_SOURCE_REQUIRED')
  }
  const rawRevision = source.reviewRevision
  if (source.reviewerId !== owner.participantId || source.teamId !== owner.teamId) {
    throw reportError('review assignment is not addressed to this participant', 'TEAM_TASK_REVIEW_UNAUTHORIZED')
  }
  const teams = ctx.get('teams')
  const nextPhase = rawDecision === 'accepted' ? 'completed' as const : 'pending' as const
  if (teams === undefined) {
    const borrower = ctx.teamLinks.getBoundLinkBorrower(agent)
    if (borrower === undefined) throw reportError('team_task_review requires a current bound Team Link', 'TEAM_TASK_REVIEW_UNAVAILABLE')
    const updated = await borrower.withLink(async (link) => {
      await postReviewResponse(link, source, taskId, rawDecision, reason)
      return await link.resolveTaskReview({ taskId, expectedRevision: rawRevision, nextPhase, reason })
    })
    if (updated.phase !== 'pending' && updated.phase !== 'completed') {
      throw reportError('Team review returned an unexpected task phase', 'TEAM_TASK_REVIEW_INVALID_STATE')
    }
    return { task: { id: updated.id, revision: updated.revision, phase: updated.phase }, decision: rawDecision, reason }
  }
  const state = await teams.getTeam({ teamId: owner.teamId })
  const task = state.tasks.find(candidate => candidate.id === taskId)
  if (task === undefined || task.phase !== 'review' || task.reviewPolicy.kind !== 'participant'
    || task.reviewPolicy.reviewerId !== owner.participantId
    || source.reviewerId !== owner.participantId
    || source.teamId !== owner.teamId
    || source.attemptId !== task.attemptHistory.at(-1)?.id
    || source.reviewRevision !== task.revision) {
    throw reportError('task is not awaiting review by this participant', 'TEAM_TASK_REVIEW_UNAUTHORIZED')
  }
  const binding = state.activations.find(candidate => candidate.activation.participantId === owner.participantId
    && candidate.sessionId === agent.session.id
    && (candidate.activation.status === 'idle' || candidate.activation.status === 'running'))
  if (binding === undefined) throw reportError('reviewer activation is not current', 'TEAM_TASK_REVIEW_ACTIVATION_REQUIRED')
  const link = await ctx.teamLinks.connect({ provider: linkProvider, binding })
  let updated: TeamTaskSnapshot
  try {
    await postReviewResponse(link, source, taskId, rawDecision, reason)
    updated = await link.resolveTaskReview({
      taskId,
      expectedRevision: rawRevision,
      nextPhase,
      reason,
    })
  } finally {
    await link.close().catch((error: unknown) => {
      ctx.logger.warn(`tool-team: failed to close task-review Link: ${renderError(error)}`)
    })
  }
  if (updated.phase !== 'pending' && updated.phase !== 'completed') {
    throw reportError('Team review returned an unexpected task phase', 'TEAM_TASK_REVIEW_INVALID_STATE')
  }
  return {
    task: { id: updated.id, revision: updated.revision, phase: updated.phase },
    decision: rawDecision,
    reason,
  }
}

/** Send one explicit model-authored message through a local activation-bound Link. */
async function sendMessage(
  ctx: Context,
  agent: Agent,
  linkProvider: string,
  idempotencyKey: ReturnType<typeof channelPostIdempotencyKeySchema.parse>,
  rawChannelId: string,
  rawText: string,
  rawAudience: unknown,
  rawDelivery: string,
): Promise<TeamMessageValue> {
  const owner = teamParticipant(agent)
  if (owner === undefined) throw reportError('team_message requires a Team and Participant Session header', 'TEAM_MESSAGE_ACTIVATION_REQUIRED')
  const channelId = parseMessageChannelId(rawChannelId)
  const text = requireMessageText(rawText)
  /* v8 ignore next 2 -- defineTool validates this closed delivery enum before execution. */
  if (rawDelivery !== 'context' && rawDelivery !== 'turn' && rawDelivery !== 'steer') {
    throw reportError('delivery must be context, turn, or steer', 'TEAM_MESSAGE_INVALID_DELIVERY')
  }
  const teams = ctx.get('teams')
  if (teams === undefined) {
    const borrower = ctx.teamLinks.getBoundLinkBorrower(agent)
    if (borrower === undefined) throw reportError('team_message requires a current bound Team Link', 'TEAM_MESSAGE_UNAVAILABLE')
    const envelope = await borrower.withLink(async (link) => {
      assertMessageBorrowedBinding(link, agent, owner.teamId, owner.participantId)
      const channel = await link.getChannel(channelId)
      if (channel.manifest.teamId !== owner.teamId || channel.manifest.id !== channelId || channel.phase !== 'active') {
        throw reportError('channel is not an active channel in this Team', 'TEAM_MESSAGE_CHANNEL_INVALID')
      }
      const audience = messageAudience(channel, owner.participantId, rawAudience)
      const draft = messageDraft(agent, channel, owner.participantId, text, audience, rawDelivery)
      const accepted = await link.post({
        idempotencyKey,
        draft,
      })
      if (accepted.senderId !== owner.participantId || accepted.channelId !== channelId
        || accepted.kind !== draft.kind || accepted.causationId !== draft.causationId) {
        throw reportError('team_message Link response does not match the requested message', 'TEAM_MESSAGE_CHANNEL_INVALID')
      }
      return accepted
    })
    return { channel_id: String(channelId), envelope_id: String(envelope.id) }
  }
  const team = await teams.getTeam({ teamId: owner.teamId })
  const channel = await teams.getChannel({ channelId })
  if (channel.manifest.teamId !== owner.teamId || channel.phase !== 'active') {
    throw reportError('channel is not an active channel in this Team', 'TEAM_MESSAGE_CHANNEL_INVALID')
  }
  const binding = activeFinalBinding(team, owner.teamId, owner.participantId, agent.session.id)
  const audience = messageAudience(channel, owner.participantId, rawAudience)
  const draft = messageDraft(agent, channel, owner.participantId, text, audience, rawDelivery)
  const link = await ctx.teamLinks.connect({ provider: linkProvider, binding })
  try {
    const envelope = await link.post({
      expectedCursor: channel.cursor,
      idempotencyKey,
      draft,
    })
    if (envelope.senderId !== owner.participantId || envelope.channelId !== channelId
      || envelope.kind !== draft.kind || envelope.causationId !== draft.causationId) {
      throw reportError('team_message Link response does not match the requested message', 'TEAM_MESSAGE_CHANNEL_INVALID')
    }
    return { channel_id: String(channelId), envelope_id: String(envelope.id) }
  } finally {
    await link.close().catch((error: unknown) => {
      ctx.logger.warn(`tool-team: failed to close team-message Link: ${renderError(error)}`)
    })
  }
}

/** Derive consult turns from immutable roles and logged source identities; other channels keep ordinary messages. */
function messageDraft(agent: Agent, channel: ChannelSnapshot, senderId: ParticipantId, text: string,
  audience: readonly ParticipantId[] | null, delivery: 'context' | 'turn' | 'steer'): import('@clocky/clocky-team').TeamEnvelopeDraft {
  if (channel.manifest.adapter.type !== 'consult') return { channelId: channel.manifest.id, audience,
    kind: 'message', payload: messagePayload(channel, text), delivery }
  return resolveConsultTextDraft({ manifest: channel.manifest, senderId, text, audience, delivery,
    request: loggedConsultRequest(agent, channel) })
}

/** Resolve a logged consult delivery without depending on view-policy rendering or remote adapter state. */
function loggedConsultRequest(agent: Agent, channel: ChannelSnapshot): ConsultTextRequestAnchor | undefined {
  for (const event of [...agent.session.events].reverse()) {
    const candidate: unknown = event.type === 'user/message' ? event.data.source : undefined
    if (isReviewAssignmentSource(candidate) && candidate.teamId === channel.manifest.teamId
      && candidate.channelId === channel.manifest.id) {
      return { teamId: channel.manifest.teamId, channelId: channel.manifest.id, envelopeId: envelopeIdSchema.parse(candidate.envelopeId),
        taskId: teamTaskIdSchema.parse(candidate.taskId), review: true }
    }
    const source = event.type === 'team/channel-view' ? event.data
      : event.type === 'user/message' && event.data.source.kind === 'team-channel-view' ? event.data.source : undefined
    if (source === undefined || source.teamId !== channel.manifest.teamId || source.channelId !== channel.manifest.id) continue
    return { teamId: channel.manifest.teamId, channelId: channel.manifest.id,
      envelopeId: envelopeIdSchema.parse(source.triggeringEnvelopeId),
      review: source.review !== undefined, ...source.taskId === undefined ? {} : { taskId: teamTaskIdSchema.parse(source.taskId) } }
  }
  return undefined
}

/** Prepare text using the exact immutable channel protocol selected by the authorized metadata read. */
function messagePayload(channel: ChannelSnapshot, text: string): JsonObject {
  return channel.manifest.adapter.type === 'direct'
    && (channel.manifest.adapter.version === 3 || channel.manifest.adapter.version === 4)
    ? { content: [{ type: 'text', text }] } : { text }
}

/** Resolve the explicit recipient list or the direct channel's unique peer. */
function messageAudience(
  channel: ChannelSnapshot,
  senderId: ReturnType<typeof participantIdSchema.parse>,
  rawAudience: unknown,
): readonly ReturnType<typeof participantIdSchema.parse>[] | null {
  if (rawAudience !== undefined) {
    return parseMessageAudience(rawAudience, senderId)
  }
  if (channel.manifest.adapter.type === 'direct' && (channel.manifest.adapter.version === 1
    || channel.manifest.adapter.version === 2 || channel.manifest.adapter.version === 3)) {
    const peer = channel.manifest.participants.find(participant => participant.id !== senderId)
    if (peer === undefined) throw reportError('direct channel has no peer recipient', 'TEAM_MESSAGE_CHANNEL_INVALID')
    return [peer.id]
  }
  return null
}

/** Parse and fence an explicit Team-message audience at the model boundary. */
function parseMessageAudience(
  rawAudience: unknown,
  senderId: ReturnType<typeof participantIdSchema.parse>,
): readonly ReturnType<typeof participantIdSchema.parse>[] {
  if (!Array.isArray(rawAudience) || rawAudience.length === 0) {
    throw reportError('audience must be a non-empty array when supplied', 'TEAM_MESSAGE_INVALID_AUDIENCE')
  }
  const audience = rawAudience.map((value) => {
    /* v8 ignore next 2 -- defineTool validates audience items as strings before execution. */
    if (typeof value !== 'string') throw reportError('audience participant ids must be strings', 'TEAM_MESSAGE_INVALID_AUDIENCE')
    const parsed = participantIdSchema.safeParse(value)
    if (!parsed.success) throw reportError('audience contains an invalid participant id', 'TEAM_MESSAGE_INVALID_AUDIENCE')
    return parsed.data
  })
  if (new Set(audience).size !== audience.length || audience.includes(senderId)) {
    throw reportError('audience must contain distinct participants other than the sender', 'TEAM_MESSAGE_INVALID_AUDIENCE')
  }
  return audience
}

/** Verify that a borrowed remote Link still names this Team Participant binding. */
function assertMessageBorrowedBinding(
  link: TeamLink,
  agent: Agent,
  teamId: ReturnType<typeof teamIdSchema.parse>,
  participantId: ReturnType<typeof participantIdSchema.parse>,
): void {
  const binding = link.binding
  if (binding.activation.teamId !== teamId
    || binding.activation.participantId !== participantId
    || binding.sessionId !== agent.session.id
    || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')) {
    throw reportError('Team Link is not bound to the current model Participant', 'TEAM_MESSAGE_UNAVAILABLE')
  }
}

/** Settle one remote-assigned task through its delivery owner's existing fixed Link. */
async function reportBorrowed(
  borrower: TeamLinkBoundLinkBorrower,
  agent: Agent,
  participantId: ReturnType<typeof participantIdSchema.parse>,
  source: TaskAssignmentSource,
  outcome: ReportedOutcome,
): Promise<TaskReportValue> {
  const settled = await borrower.withLink(async (link) => {
    assertBorrowedBinding(link, agent, participantId, source)
    return await link.settleTaskAttempt({
      taskId: source.taskId,
      attemptId: source.attemptId,
      expectedRevision: source.runningRevision,
      outcome,
    })
  })
  const reported = teamTaskSnapshotSchema.safeParse(settled)
  if (!reported.success) {
    throw reportError('task-report bound Link settled without a valid task result', 'TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  }
  assertReportedTask(reported.data, source, outcome)
  return reportValue(reported.data, source, outcome, 'settled')
}

/** Verify that an owner-scoped borrowed Link still names the exact assigned remote Agent. */
function assertBorrowedBinding(
  link: TeamLink,
  agent: Agent,
  participantId: ReturnType<typeof participantIdSchema.parse>,
  source: TaskAssignmentSource,
): void {
  const binding = link.binding
  if (binding.activation.id !== source.activationId
    || binding.activation.teamId !== source.teamId
    || binding.activation.participantId !== participantId
    || binding.sessionId !== agent.session.id
    || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')) {
    throw reportError('task-assignment source no longer has its active bound Agent residency', 'TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  }
}

/** Verify the source activation is still the exact live binding for the scoped Agent. */
function assertBinding(
  binding: ActivationBindingSnapshot,
  agent: Agent,
  participantId: ReturnType<typeof participantIdSchema.parse>,
  source: TaskAssignmentSource,
): void {
  if (binding.activation.id !== source.activationId
    || binding.activation.teamId !== source.teamId
    || binding.activation.participantId !== participantId
    || binding.sessionId !== agent.session.id
    || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')) {
    throw reportError('task-assignment source no longer has its active bound Agent residency', 'TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  }
}

/** Verify the source still selects the one active running lease that this Agent owns. */
function assertRunningLease(
  task: TeamTaskSnapshot,
  participantId: ReturnType<typeof participantIdSchema.parse>,
  source: TaskAssignmentSource,
): void {
  const lease = task.lease
  if (task.teamId !== source.teamId
    || task.id !== source.taskId
    || task.phase !== 'running'
    || lease === undefined
    || lease.attemptId !== source.attemptId
    || lease.assignedRevision !== source.assignedRevision
    || lease.participantId !== participantId
    || lease.activationId !== source.activationId
    || lease.wakeChannelId !== source.channelId) {
    throw reportError('task-assignment source no longer selects a current running lease', 'TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  }
}

/** Send one final answer through the caller's exact active two-party direct channel. */
async function sendFinal(
  ctx: Context,
  agent: Agent,
  linkProvider: string,
  idempotencyKey: ReturnType<typeof channelPostIdempotencyKeySchema.parse>,
  rawChannelId: unknown,
  rawText: unknown,
): Promise<TeamFinalValue> {
  const owner = teamParticipant(agent)
  if (owner === undefined) {
    throw finalError('team_final requires a Team and Participant Session header', 'TEAM_FINAL_ACTIVATION_REQUIRED')
  }
  const channelId = parseFinalChannelId(rawChannelId)
  const text = requireFinalText(rawText)
  const borrower = ctx.teamLinks.getBoundLinkBorrower(agent)
  if (borrower !== undefined) {
    return await sendFinalBorrowed(borrower, agent, owner, channelId, text, idempotencyKey)
  }
  const teams = ctx.get('teams')
  if (teams === undefined) {
    throw finalError('team_final requires one current bound Team Link', 'TEAM_FINAL_ACTIVATION_REQUIRED')
  }
  const team = await teams.getTeam({ teamId: owner.teamId })
  const binding = activeFinalBinding(team, owner.teamId, owner.participantId, agent.session.id)
  const link = await ctx.teamLinks.connect({ provider: linkProvider, binding })
  try {
    const envelope = await link.postFinalResult({ channelId, idempotencyKey, text })
    const value = finalValue(assertFinalEnvelope(envelope, owner, channelId, text))
    try {
      await link.close()
    } catch (error: unknown) {
      ctx.logger.warn(`tool-team: failed to close team-final Link: ${renderError(error)}`)
    }
    return value
  } catch (error: unknown) {
    try {
      await link.close()
    } catch (closeError: unknown) {
      ctx.logger.warn(`tool-team: failed to close team-final Link: ${renderError(closeError)}`)
    }
    throw error
  }
}

/** Post one final through the remote delivery owner's already-connected exact Link. */
async function sendFinalBorrowed(
  borrower: TeamLinkBoundLinkBorrower,
  agent: Agent,
  owner: NonNullable<ReturnType<typeof teamParticipant>>,
  channelId: ReturnType<typeof channelIdSchema.parse>,
  text: string,
  idempotencyKey: ReturnType<typeof channelPostIdempotencyKeySchema.parse>,
): Promise<TeamFinalValue> {
  const envelope = await borrower.withLink(async (link) => {
    assertFinalBorrowedBinding(link, agent, owner)
    return await link.postFinalResult({ channelId, idempotencyKey, text })
  })
  return finalValue(assertFinalEnvelope(envelope, owner, channelId, text))
}

/** Parse the complete closed model argument set for one final-answer post. */
function finalArguments(args: unknown): { readonly channelId: unknown; readonly text: unknown } {
  if (!isRecord(args)
    || Object.keys(args).length !== 2
    || !Object.hasOwn(args, 'channel_id')
    || !Object.hasOwn(args, 'text')) {
    throw finalError('team_final accepts only channel_id and text', 'TEAM_FINAL_ARGUMENTS_REQUIRED')
  }
  return { channelId: args.channel_id, text: args.text }
}

/** Parse the only model-provided Team identifier accepted by `team_final`. */
function parseFinalChannelId(value: unknown): ReturnType<typeof channelIdSchema.parse> {
  const parsed = channelIdSchema.safeParse(value)
  if (!parsed.success) {
    throw finalError('channel_id must be a valid Team channel identifier', 'TEAM_FINAL_CHANNEL_REQUIRED')
  }
  return parsed.data
}

/** Require the direct-product final payload text that the model is allowed to provide. */
function requireFinalText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw finalError('text must be a non-empty string', 'TEAM_FINAL_TEXT_REQUIRED')
  }
  return value
}

/** Parse the channel identifier for an explicit message without borrowing final-answer diagnostics. */
function parseMessageChannelId(value: unknown): ReturnType<typeof channelIdSchema.parse> {
  const parsed = channelIdSchema.safeParse(value)
  if (!parsed.success) {
    throw reportError('channel_id must be a valid Team channel identifier', 'TEAM_MESSAGE_CHANNEL_INVALID')
  }
  return parsed.data
}

/** Require non-empty text for an explicit message. */
function requireMessageText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw reportError('text must be a non-empty string', 'TEAM_MESSAGE_INVALID_TEXT')
  }
  return value
}

/** Derive a durable retry key from the complete model-tool call lineage. */
function finalIdempotencyKey(exec: ToolRunContext): ReturnType<typeof channelPostIdempotencyKeySchema.parse> {
  return channelPostIdempotencyKeySchema.parse(JSON.stringify(['team_final', exec.rootCallId, exec.callId]))
}

/** Derive a retry key whose operation identity cannot collide with a final-answer post. */
function messageIdempotencyKey(exec: ToolRunContext): ReturnType<typeof channelPostIdempotencyKeySchema.parse> {
  return channelPostIdempotencyKeySchema.parse(JSON.stringify(['team_message', exec.rootCallId, exec.callId]))
}

/** Locate the one current activation that the header-derived caller may use for a Team Link. */
function activeFinalBinding(
  team: TeamStateSnapshot,
  teamId: ReturnType<typeof teamIdSchema.parse>,
  participantId: ReturnType<typeof participantIdSchema.parse>,
  sessionId: Agent['session']['id'],
): ActivationBindingSnapshot {
  const bindings = team.activations.filter(binding => binding.activation.teamId === teamId
    && binding.activation.participantId === participantId
    && binding.sessionId === sessionId
    && isFinalActivationStatus(binding.activation.status))
  if (bindings.length !== 1) {
    throw finalError('team_final requires one current activation bound to the calling Agent Session', 'TEAM_FINAL_ACTIVATION_REQUIRED')
  }
  return bindings[0] as ActivationBindingSnapshot
}

/** Return whether one activation remains eligible to authenticate a final Envelope post. */
function isFinalActivationStatus(status: ActivationBindingSnapshot['activation']['status']): boolean {
  return status === 'idle' || status === 'running'
}

/** Derive the exact non-caller recipient after validating a current direct v2 or v3 channel. */
/** Build the compact model-visible confirmation for one Hub-accepted final Envelope. */
function finalValue(envelope: TeamEnvelope): TeamFinalValue {
  return { channel_id: envelope.channelId, envelope_id: envelope.id }
}

/** Verify that a borrowed Link still belongs to the current Team-bound calling Agent. */
function assertFinalBorrowedBinding(
  link: TeamLink,
  agent: Agent,
  owner: NonNullable<ReturnType<typeof teamParticipant>>,
): void {
  const binding = link.binding
  if (binding.activation.teamId !== owner.teamId
    || binding.activation.participantId !== owner.participantId
    || binding.sessionId !== agent.session.id
    || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')) {
    throw finalError('team_final requires one current bound Team Link', 'TEAM_FINAL_ACTIVATION_REQUIRED')
  }
}

/** Reject a Link response that did not retain the exact requested final. */
function assertFinalEnvelope(
  envelope: TeamEnvelope,
  owner: NonNullable<ReturnType<typeof teamParticipant>>,
  channelId: ReturnType<typeof channelIdSchema.parse>,
  text: string,
): TeamEnvelope {
  if (envelope.teamId !== owner.teamId
    || envelope.channelId !== channelId
    || envelope.senderId !== owner.participantId
    || (envelope.kind !== DIRECT_CHANNEL_FINAL_ENVELOPE_KIND && envelope.kind !== 'response')
    || envelope.delivery !== 'turn'
    || envelope.audience === null
    || envelope.audience.length !== 1
    || envelope.audience[0] === owner.participantId
    || Object.keys(envelope.payload).length !== 1
    || envelope.payload.text !== text) {
    throw finalError('team_final Link response does not match the requested final Envelope', 'TEAM_FINAL_CHANNEL_REQUIRED')
  }
  return envelope
}

/** Return an identical already-settled outcome, or reject an attempt that settled differently. */
function recordedOutcome(
  task: TeamTaskSnapshot,
  source: TaskAssignmentSource,
  desired: ReportedOutcome,
): ReportedOutcome | undefined {
  const recorded = task.attemptHistory.find(attempt => attempt.id === source.attemptId)
  if (recorded === undefined) return undefined
  const outcome = recorded.outcome
  if (!sameOutcome(outcome, desired)) {
    throw reportError('task attempt already recorded a different terminal outcome', 'TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  }
  return desired
}

/** Verify that a Link settlement result still proves the requested source-owned attempt. */
function assertReportedTask(task: TeamTaskSnapshot, source: TaskAssignmentSource, outcome: ReportedOutcome): void {
  if (task.id !== source.taskId || task.teamId !== source.teamId || recordedOutcome(task, source, outcome) === undefined) {
    throw reportError('Team Link returned a task that did not retain the reported attempt', 'TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  }
}

/** Project a renewed running task into the compact model-facing heartbeat result. */
function heartbeatValue(task: TeamTaskSnapshot, source: TaskAssignmentSource): TaskHeartbeatValue {
  if (task.id !== source.taskId || task.teamId !== source.teamId || task.phase !== 'running'
    || task.lease?.attemptId !== source.attemptId || task.lease.expiresAt <= task.lease.renewedAt) {
    throw reportError('Team Link returned a task that did not retain the renewed running lease', 'TEAM_TASK_HEARTBEAT_ASSIGNMENT_STALE')
  }
  return {
    task: { id: task.id, revision: task.revision, phase: 'running' },
    attempt: { id: source.attemptId, expiresAt: task.lease.expiresAt },
  }
}

/** Compare the closed reportable outcome vocabulary without accepting scheduler expiry or cancellation. */
function sameOutcome(left: TaskAttemptOutcome, right: ReportedOutcome): boolean {
  switch (left.kind) {
    case 'released':
      return right.kind === 'released'
    case 'failed':
      return right.kind === 'failed'
        && left.failure.code === right.failure.code
        && left.failure.message === right.failure.message
    case 'completed':
      return right.kind === 'completed' && JSON.stringify(left.result) === JSON.stringify(right.result)
    case 'lease-expired':
    case 'cancelled':
      return false
    /* v8 ignore next 2 -- TaskAttemptOutcome is closed and every tag is handled above. */
    default:
      left satisfies never
      throw new Error('unreachable task-attempt outcome')
  }
}

/** Build the compact durable report result returned to the model. */
function reportValue(
  task: TeamTaskSnapshot,
  source: TaskAssignmentSource,
  outcome: ReportedOutcome,
  status: TaskReportValue['status'],
): TaskReportValue {
  return {
    task: { id: task.id, revision: task.revision, phase: task.phase },
    attempt: { id: source.attemptId, outcome: toolOutcome(outcome) },
    status,
  }
}

/** Convert a branded durable outcome into the JSON-schema-shaped tool value. */
function toolOutcome(outcome: ReportedOutcome): ToolReportedOutcome {
  switch (outcome.kind) {
    case 'released': return { kind: 'released' }
    case 'failed': return { kind: 'failed', failure: { ...outcome.failure } }
    case 'completed':
      return {
        kind: 'completed',
        result: {
          summary: outcome.result.summary,
          ...outcome.result.evidence === undefined ? {} : { evidence: [...outcome.result.evidence] },
          ...outcome.result.artifacts === undefined ? {} : {
            artifacts: outcome.result.artifacts.map(artifact => ({
              id: artifact.id,
              kind: artifact.kind,
              uri: artifact.uri,
              visibility: artifact.visibility,
              ...artifact.contentHash === undefined ? {} : { contentHash: artifact.contentHash },
              ...artifact.sourceAttemptId === undefined ? {} : { sourceAttemptId: String(artifact.sourceAttemptId) },
            })),
          },
          ...outcome.result.changedPaths === undefined ? {} : { changedPaths: [...outcome.result.changedPaths] },
          ...outcome.result.verification === undefined ? {} : { verification: outcome.result.verification },
          /* v8 ignore next 2 -- the report schema accepts artifacts but never an integration result. */
          ...outcome.result.integration === undefined ? {} : { integration: toolIntegrationResult(outcome.result.integration) },
        },
      }
    /* v8 ignore next 2 -- the report outcome union is closed by the tool schema and TypeScript. */
    default:
      outcome satisfies never
      throw new Error('unreachable report outcome')
  }
}

/** Resolve the current-turn review input that supplies the exact CAS revision. */
function currentReviewAssignment(agent: Agent, taskId: TeamTaskId): CurrentReviewAssignment | undefined {
  const events = agent.session.events
  const turnStart = events.findLastIndex(event => event.type === 'turn/start')
  if (turnStart < 0) return undefined
  const priorTurnEnd = events.findLastIndex((event, index) => index < turnStart && event.type === 'turn/end')
  for (let index = events.length - 1; index > priorTurnEnd; index -= 1) {
    const event = events[index]
    if (event?.type === 'user/message') {
      const source = event.data.source as unknown
      if (!isReviewAssignmentSource(source) || source.taskId !== taskId) continue
      return source
    }
    if (event?.type === 'team/channel-view') {
      const source = reviewSourceFromChannelView(event.data, taskId)
      if (source !== undefined) return source
    }
  }
  return undefined
}

/** Parse the narrow review fields carried by one pre-rendered Team channel view. */
function reviewSourceFromChannelView(
  source: TeamChannelViewEventData,
  taskId: TeamTaskId,
): CurrentReviewAssignment | undefined {
  const review = source.review
  if (source.taskId !== taskId || review?.initiatorId === undefined) return undefined
  try {
    return {
      teamId: parseIdentifier(teamIdSchema, source.teamId, 'team id'),
      channelId: parseIdentifier(channelIdSchema, source.channelId, 'channel id'),
      envelopeId: parseIdentifier(envelopeIdSchema, source.triggeringEnvelopeId, 'Envelope id'),
      taskId,
      attemptId: parseIdentifier(taskAttemptIdSchema, review.attemptId, 'attempt id'),
      reviewRevision: review.reviewRevision,
      reviewerId: parseIdentifier(participantIdSchema, review.reviewerId, 'reviewer id'),
      initiatorId: parseIdentifier(participantIdSchema, review.initiatorId, 'initiator id'),
    }
  } catch {
    return undefined
  }
}

/** Narrow a durable Session source to the review-assignment provenance contract. */
function isReviewAssignmentSource(value: unknown): value is TeamReviewAssignmentSource {
  if (!isRecord(value) || value.kind !== 'team-review-assignment') return false
  return typeof value.teamId === 'string'
    && typeof value.channelId === 'string'
    && typeof value.envelopeId === 'string'
    && typeof value.taskId === 'string'
    && typeof value.attemptId === 'string'
    && isPositiveSafeInteger(value.reviewRevision)
    && typeof value.reviewerId === 'string'
    && typeof value.initiatorId === 'string'
    && isRecord(value.result)
}

/** Post the consult response before resolving its task so the response is the durable review outbox. */
async function postReviewResponse(
  link: TeamLink,
  source: CurrentReviewAssignment,
  taskId: TeamTaskId,
  decision: 'accepted' | 'rework',
  reason: string,
): Promise<void> {
  const response = await link.post({
    idempotencyKey: channelPostIdempotencyKeySchema.parse(`team-review-response:${String(source.taskId)}:${String(source.attemptId)}`),
    draft: {
      channelId: source.channelId,
      audience: [source.initiatorId],
      kind: CONSULT_RESPONSE_KIND,
      payload: { text: reason, decision },
      delivery: 'turn',
      causationId: source.envelopeId,
      taskId,
    },
  })
  if (response.channelId !== source.channelId
    || response.senderId !== source.reviewerId
    || response.kind !== CONSULT_RESPONSE_KIND
    || response.causationId !== source.envelopeId
    || response.taskId !== taskId
    || response.audience === null
    || response.audience.length !== 1
    || response.audience[0] !== source.initiatorId) {
    throw reportError('Team review response did not match its assignment source', 'TEAM_TASK_REVIEW_RESPONSE_INVALID')
  }
}

/** Parse an opaque id under the same runtime validation used by Team operations. */
function parseIdentifier<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: string,
  name: string,
): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw reportError(`${name} must be a valid Team identifier`, 'TEAM_TASK_REPORT_ASSIGNMENT_REQUIRED')
  return parsed.data
}

/** Narrow a durable extensible source without trusting its object prototype or fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype
}

/** Validate one revision copied from a durable task-assignment source. */
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Render one task-report mutation as a pure args-only generic tool card. */
function presentReport(outcome: string, taskId: string): GenericCallView | undefined {
  void outcome
  return { card: 'generic', title: 'Report Team task', kind: 'other', rawInput: taskId }
}

/** Render one lease-renewal mutation as a pure args-only generic tool card. */
function presentHeartbeat(taskId: string): GenericCallView {
  return { card: 'generic', title: 'Renew Team task lease', kind: 'other', rawInput: taskId }
}

/** Render one review mutation as a pure args-only generic tool card. */
function presentReview(taskId: string): GenericCallView {
  return { card: 'generic', title: 'Review Team task', kind: 'other', rawInput: taskId }
}

/** Render one explicit channel message as a pure args-only generic tool card. */
function presentMessage(channelId: string): GenericCallView {
  return { card: 'generic', title: 'Send Team message', kind: 'other', rawInput: channelId }
}

/** Render one artifact-sourced integration operation without exposing provider internals. */
function presentIntegration(taskId: string): GenericCallView | undefined {
  return { card: 'generic', title: 'Integrate Team task', kind: 'other', rawInput: taskId }
}

/** Render one final-answer mutation as a pure channel-targeted generic tool card. */
function presentFinal(channelId: string): GenericCallView | undefined {
  return { card: 'generic', title: 'Send Team final answer', kind: 'other', rawInput: channelId }
}

/** Create a structured tool failure without exposing authority fields to the model. */
function reportError(message: string, code: string): HarnessError {
  return new HarnessError(message, code)
}

/** Create a structured final-answer failure without exposing derived authority to the model. */
function finalError(message: string, code: string): HarnessError {
  return new HarnessError(message, code)
}

/** Render a contained Link-close diagnostic without allowing hostile coercion to escape. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
