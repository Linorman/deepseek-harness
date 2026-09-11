import { settleAgentWorkspaceLease } from '@clocky/clocky-agent'
import type { HumanChannelAdmission } from '@clocky/clocky-team-channel-admission'
import type { TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope } from '@clocky/clocky-team'
import { channelInvitationIdempotencyKeySchema, fingerprintChannelManifest } from '@clocky/clocky-team'
/**
 * Product-level owner for the default local Team topology and its explicit
 * human input/final-output boundary. It coordinates existing Team services;
 * it does not drive model turns itself.
 *
 * @module @clocky/clocky-team-run
 */

import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Context, Service } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { z as durable } from 'zod'
import { jsonObjectSchema, teamTaskPlacementSchema } from '@clocky/clocky-team'
import type { TeamChildRunAuthorization, TeamChildRunScope, TeamChildRunIdentity, TeamChildRunBinding,
  TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope, ChannelOpenInput,
  TeamSystemChildResultProof, TeamSystemChildResultScope } from '@clocky/clocky-team'
import { CONSULT_CHANNEL_ADAPTER_V1 } from '@clocky/clocky-team-channel-basic'
import type { Agent, AgentOptions, ModelSelection } from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-agent-default-model'
import {
  parseDirectProductChannelManifest,
  DIRECT_CHANNEL_ADAPTER_V4,
  DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
  DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
} from '@clocky/clocky-team-channel-direct'
import type { DirectChannelHumanContentBlock } from '@clocky/clocky-team-channel-direct'
import {
  parseTransitionGraph,
  WORKFLOW_CHANNEL_ADAPTER,
} from '@clocky/clocky-team-channel-workflow'
import type { WorkflowExtensionResolver } from '@clocky/clocky-team-channel-workflow'
import type {} from '@clocky/clocky-team-activation-controller'
import {
  TeamError,
  fingerprintTeamFinalContent,
  teamFinalAdmissionIdempotencyKeySchema,
  teamClosureIdempotencyKeySchema,
  teamTaskCreateIdempotencyKeySchema,
  teamWorkflowPlanSchema,
  validateTeamWorkflowPlan,
} from '@clocky/clocky-team'
import type {
  ChannelId,
  ChannelPostIdempotencyKey,
  ChannelRecord,
  ChannelSnapshot,
  ActivationActorProofIssuer,
  JsonObject,
  JsonValue,
  ParticipantInterruptSnapshot,
  ParticipantSnapshot,
  ParticipantId,
  TaskAttemptOutcome,
  TaskAttemptResult,
  TeamResourceBudget,
  TeamArtifactReference,
  TaskAttemptId,
  TeamGoalSnapshot,
  TeamGoalBlocker,
  TeamGoalPhase,
  TeamTaskCreateIdempotencyKey,
  TeamTaskCreateCommandInput,
  TeamTaskCreator,
  TeamTaskCommandCreator,
  TeamTaskId,
  TeamTaskSnapshot,
  TeamTaskPlacement,
  TeamStateSnapshot,
  TeamStallReason,
  TeamArchiveInput,
  TeamHumanResumeAuthorization,
  TeamCancellationSnapshot,
  TeamSystemClosureProof,
  TeamSystemClosureProofSource,
  TeamSystemClosureScope,
  TeamSystemFinalReceiptProof,
  TeamSystemFinalReceiptScope,
  TeamSystemFinalReceiptProofSource,
  TeamSystemEnvelopePostProof,
  TeamSystemEnvelopePostScope,
  TeamSystemEnvelopePostProofSource,
  TeamSystemInterruptProof,
  TeamSystemInterruptProofSource,
  TeamSystemInterruptScope,
  TeamSystemTaskControlProof,
  TeamSystemTaskControlProofSource,
  TeamSystemTaskControlScope,
  TeamSystemRootCreationProof,
  TeamSystemRootCreationProofSource,
  TeamSystemRootCreationScope,
  TeamSystemArchiveProof,
  TeamSystemArchiveProofSource,
  TeamSystemArchiveScope,
  TeamSystemCancellationCleanupProof,
  TeamSystemCancellationCleanupProofSource,
  TeamSystemCancellationCleanupScope,
  TeamSystemFinalizationCleanupProof,
  TeamSystemFinalizationCleanupProofSource,
  TeamSystemFinalizationCleanupScope,
  TeamSystemTopologyProof,
  TeamSystemTopologyProofSource,
  TeamSystemTopologyScope,
  TeamSystemPhaseProof,
  TeamSystemPhaseProofSource,
  TeamSystemPhaseScope,
  TeamSystemWorkflowProof,
  TeamSystemWorkflowProofSource,
  TeamSystemWorkflowScope,
  TeamActorProof,
  TeamActorProofLease,
  TeamAuthorityGrant,
  TeamParticipantOwner,
  TeamEnvelope,
  TeamId,
  TeamRootCreateInput,
  TeamQuiescenceSnapshot,
  TeamSnapshot,
  TeamWorkflowPlan,
  TeamWorkflowPlanId,
  TeamWorkflowPlanIdempotencyKey,
  TeamWorkflowPlanResult,
  TeamWorkflowPlanSnapshot,
  TeamWorkflowCondition,
  TeamWorkflowGraph,
  TeamWorkflowTarget,
  TeamWorkflowTaskTemplate,
  ActivationBindingSnapshot,
  TeamWatchResult,
} from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import type { Session, SessionEvent } from '@clocky/clocky-session'
import { createUserMessage } from '@clocky/clocky-llm'
import type {} from '@clocky/clocky-system-prompt'
import type { TeamActivationLease } from '@clocky/clocky-team-activation-controller'
import type {} from '@clocky/clocky-team-workspace'
import { TeamRunError } from './error.ts'

export { TeamRunError } from './error.ts'
export type { TeamRunErrorCode } from './error.ts'

/** Cordis plugin name. */
export const name = 'team-run'
/** Services that own Team topology, coordinator activation, model choice, and coordinator prompt scope. */
export const inject = ['teamChannelAdmission', 'teams', 'teamActivations', 'agentDefaultModel', 'systemPrompt', 'agents']

declare module '@clocky/cordis' {
  interface Context {
    /** Local product-level Team lifecycle owner. */
    teamRuns: TeamRunService
  }
}

/**
 * Parent-owned child-Team saga driver used to finish cancellation work before
 * the product Team reports that its local cancellation has settled.
 */
export interface TeamDelegationDriver {
  /**
   * Drive one exact Team until the currently accepted bounded saga work yields.
   * @param teamId - parent Team selected by the durable lifecycle event.
   * @returns completion of work accepted by this drive.
   */
  drive(teamId: TeamId): Promise<void>
}

const teamDelegationDrivers = new WeakMap<Context, TeamDelegationDriver>()

/**
 * Register the optional parent-owned child-Team saga driver for one Context.
 * @param ctx - Context whose TeamRun consumer will use the driver.
 * @param driver - effect-owned delegation driver.
 * @returns a disposer that removes only this exact driver registration.
 */
export function registerTeamDelegationDriver(ctx: Context, driver: TeamDelegationDriver): () => void {
  const owner = ctx.root
  if (teamDelegationDrivers.has(owner)) throw new Error('A Team delegation driver is already registered for this Context')
  teamDelegationDrivers.set(owner, driver)
  return () => {
    if (teamDelegationDrivers.get(owner) === driver) teamDelegationDrivers.delete(owner)
  }
}

const DEFAULT_ACTIVATION_PROVIDER = 'in-process'
const DEFAULT_TEMPLATE_ID = 'default-v1'
const DEFAULT_TEMPLATE_VERSION = 1
const DEFAULT_HUMAN_NAME = 'human'
const DEFAULT_COORDINATOR_NAME = 'coordinator'
const DEFAULT_WORKER_NAME = 'worker'
const DEFAULT_WORKER_CAPABILITY = 'team-default-worker'
const DEFAULT_MAX_WORKER_COUNT = 32
const DEFAULT_HUMAN_AUTHORITY_GRANT: TeamAuthorityGrant = Object.freeze({
  operations: ['send', 'dispatch', 'human-action', 'goal-mutate', 'invite', 'activate', 'close', 'interrupt', 'channel-open', 'task-mutate'] as const,
  workspaceModes: ['shared'] as const,
  readScopes: [] as const,
  writeScopes: [] as const,
  budgets: {},
})
const DEFAULT_WORKER_TASK_MAX_ATTEMPTS = 1
const DEFAULT_WORKER_TASK_PRIORITY = 0
const DEFAULT_FINAL_PROMPT_ORDER = 200
const DEFAULT_WORKER_PROMPT_ORDER = 201
const DEFAULT_RECEIPT_RETRY_ATTEMPTS = 8
const DEFAULT_HUMAN_INPUT_RETRY_ATTEMPTS = 3
const DEFAULT_COORDINATOR_OUTPUT_CONTINUATIONS = 3
const DEFAULT_CHANNEL_PAGE_SIZE = 128
const TEAM_RUN_FINAL_RECEIPT_PROOF_SOURCE = 'team-run'
const TEAM_RUN_CLOSURE_PROOF_SOURCE = 'team-run'
const TEAM_RUN_PHASE_PROOF_SOURCE = 'team-run'
const TEAM_RUN_INTERRUPT_PROOF_SOURCE = 'team-run'
const TEAM_RUN_CANCELLATION_CLEANUP_PROOF_SOURCE = 'team-run'
const TEAM_RUN_FINALIZATION_CLEANUP_PROOF_SOURCE = 'team-run'
const TEAM_RUN_TOPOLOGY_PROOF_SOURCE = 'team-run'
const TEAM_RUN_TASK_CONTROL_PROOF_SOURCE = 'team-run'
const TEAM_RUN_WORKFLOW_PROOF_SOURCE = 'team-run'
const TEAM_RUN_ROOT_CREATION_PROOF_SOURCE = 'team-run'
const TEAM_RUN_ARCHIVE_PROOF_SOURCE = 'team-run'
const coordinatorTaskAuthorityToken: unique symbol = Symbol('teamRunCoordinatorTaskAuthority')
const coordinatorGoalAuthorityToken: unique symbol = Symbol('teamRunCoordinatorGoalAuthority')

/** Optional closure-driver bridge used to persist a current turn failure before it reaches the caller. */
interface TeamClosureDriverBridge {
  /** Drive one exact Team after its owner accepted a lifecycle fact. */
  drive(request: { readonly teamId: TeamId }): Promise<void>
  /** Admit one exact coordinator turn result through the mounted closure driver. */
  recordTurnEnd(request: {
    readonly teamId: TeamId
    readonly coordinatorId: ParticipantId
    readonly activationId: ActivationBindingSnapshot['activation']['id']
    readonly sessionId: ActivationBindingSnapshot['sessionId']
    readonly provider: string
    readonly turn: number
    readonly finalChannelId: ChannelId
    readonly humanId: ParticipantId
    readonly reason: TeamStallReason
    readonly outcome: 'missing-final' | 'failure'
  }): Promise<void>
}

/** Install the coordinator's delegation contract and final-output contract for one channel. */
function coordinatorPrompt(
  agent: Agent,
  channelId: ChannelId,
  finalPromptOrder: number,
  maxWorkerCount: number,
): () => void {
  const disposers: (() => void)[] = []
  try {
    disposers.push(agent.ctx.systemPrompt.section({
      name: 'team-run:delegation-guidance',
      order: finalPromptOrder - 1,
      text: maxWorkerCount === 0
        ? 'You coordinate a Team with no worker pool. Complete work using the coordinator tools available in this session. '
          + 'Use team_task_delegate for bounded work that needs a separate child Team when depth and authority permit it. Supply a self-contained brief, narrow workspace scopes, and an explicit budget; template_id and template_version must be selected together when supplied. '
          + 'Observe the parent task with team_task_list, team_task_watch, or team_task_wait. Its child_team_id identifies the child, and delegation_result contains its admitted text and artifact references. Wait for task settlement before claiming completion. '
          + 'This configuration cannot execute team_task_start or worker-only workflow routes. Finish with team_final using the required channel_id.'
        : 'You are the commander and coordinator of a Team. Turn the user objective into an executable plan, direct workers, monitor delivery, and synthesize the final result. '
        + 'You are not the default executor for substantive work. First classify the objective and deliverables as research, analysis, writing or editing, planning, data work, operations, coding or building, testing or QA, or a mix. '
        + 'Identify the smallest feasible workstreams, dependencies, acceptance criteria, risks, and the handoff needed between them. Do not assume every request is coding; choose task instructions and validation for the actual domain. '
        + (maxWorkerCount === 1
          ? 'This Team permits one worker. Use team_task_start for bounded work and let additional tasks queue for that worker. '
          : 'For every non-trivial objective with two or more feasible workstreams, set worker_count to useful parallelism within the configured limit, start independent worker tasks, and call team_task_start once per bounded workstream before waiting. ')
        + 'Keep independent workstreams running concurrently. Use team_workflow_start when dependencies, fan-in, or ordered stages need a declarative task graph; otherwise start independent default tasks directly. '
        + 'Give every task a self-contained brief with its purpose, inputs, exact deliverable, constraints, validation, and handoff. Assign one owner per task; workers execute their assignment and do not delegate it. '
        + 'Only declare read_scopes or write_scopes when a task touches the shared workspace. For research, analysis, writing, planning, data, or review tasks with no filesystem changes, leave both arrays empty. '
        + 'When a task writes shared files, use narrow workspace-relative scopes with no overlap between concurrent writers; never use a shared project directory or workspace root as a shortcut because overlapping writes are serialized. '
        + 'If one worker must own a shared artifact, assign the other workers read-only research, analysis, or review tasks. Use the current workspace, permission mode, model limits, and available capabilities from runtime context; never invent access. '
        + 'When the pool limit is reached, keep admitting ready tasks so they queue for the next idle worker instead of waiting or doing the work yourself. Monitor with team_task_list, team_task_watch, and team_task_wait; cancel or replace failed work when needed, and use settled worker evidence in your synthesis. '
        + 'You may perform coordination, integration, and final synthesis, but delegate substantive work whenever a worker can make progress. A trivial one-step answer may stay with you. Never claim worker output before its task settles. '
        + 'Use team_task_delegate when a bounded workstream needs its own child Team. Supply an explicit budget and narrow scopes; optional template_id and template_version must be paired. The parent task exposes child_team_id and the admitted delegation_result text and artifact references; wait for its terminal settlement before using it as completed evidence. '
        + 'Finish with team_final using the required channel_id.',
    }))
    disposers.push(agent.ctx.systemPrompt.section({
      name: 'team-run:final-output',
      order: finalPromptOrder,
      text: `When you have completed the user's objective, call team_final with channel_id ${channelId} and your final answer text. Do not present the final answer only as an assistant message.`,
    }))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

/** One explicitly routed model participant frozen with its Team template. */
export interface TeamRunMember {
  /** Unique workflow role, distinct from the built-in human/coordinator/worker/reviewer roles. */
  readonly role: string
  /** Display name retained in the Team participant roster. */
  readonly displayName: string
  /** Runtime participant kind selected for this member. */
  readonly kind: 'local-agent' | 'remote-agent'
  /** Capabilities required when this member is assigned work. */
  readonly capabilities: string[]
  /** AgentRuntime placement provider. */
  readonly provider: string
  /** LLM provider selected for this member. */
  readonly modelProvider: string
  /** LLM model identifier selected for this member. */
  readonly model: string
  /** Optional preset resolved by the activation provider. */
  readonly preset?: string
  /** Positive per-request output-token allowance. */
  readonly maxTokens: number
}

/** JSON-friendly placement restrictions frozen into a Team product template. */
export interface TeamRunPlacementDefaults {
  /** Eligible durable Participant identities. */
  readonly participantIds?: string[]
  /** Eligible Participant roles. */
  readonly roles?: string[]
  /** Eligible AgentRuntime provider names. */
  readonly providers?: string[]
  /** Eligible named Agent presets. */
  readonly presets?: string[]
  /** Eligible provider/model route identifiers. */
  readonly models?: string[]
}

/** Validate frozen member routes when restoring a Team independently of current deployment defaults. */
const templateMembersSchema = durable.array(durable.object({
  role: durable.string().trim().min(1), displayName: durable.string().trim().min(1),
  kind: durable.enum(['local-agent', 'remote-agent']), capabilities: durable.array(durable.string().trim().min(1)),
  provider: durable.string().trim().min(1), modelProvider: durable.string().trim().min(1), model: durable.string().trim().min(1),
  preset: durable.string().trim().min(1).optional(), maxTokens: durable.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict()).superRefine((members, context) => {
  const roles = new Set<string>()
  for (const [index, member] of members.entries()) {
    if (['human', 'coordinator', 'reviewer'].includes(member.role) || isWorkerRole(member.role) || roles.has(member.role)) {
      context.addIssue({ code: 'custom', path: [index, 'role'], message: 'template member role must be unique and cannot shadow a built-in role' })
    }
    if (new Set(member.capabilities).size !== member.capabilities.length) {
      context.addIssue({ code: 'custom', path: [index, 'capabilities'], message: 'template capabilities must be duplicate-free' })
    }
    roles.add(member.role)
  }
})

/** Deployment-selected default Team topology and bounded receipt retry policy. */
export interface Config {
  /** Additional eager model participants with complete execution routes. */
  readonly members?: TeamRunMember[]
  /** Registered AgentRuntime provider that owns coordinator residency. */
  readonly activationProvider?: string
  /** Stable product template name recorded inside the initial Team rules projection. */
  readonly templateId?: string
  /** Positive immutable template revision recorded inside the initial Team rules projection. */
  readonly templateVersion?: number
  /** Optional placement restrictions frozen into tasks that omit an explicit placement. */
  readonly placementDefaults?: TeamRunPlacementDefaults
  /** Display name of the durable human participant. */
  readonly humanName?: string
  /** Display name of the default active local coordinator participant. */
  readonly coordinatorName?: string
  /** Display name of the default provisioned but inactive local worker participant. */
  readonly workerName?: string
  /** Number of local worker Participants created before the coordinator chooses a target. */
  readonly workerCount?: number
  /** Maximum worker-pool size a coordinator may request for one local Team. */
  readonly maxWorkerCount?: number
  /** Exclusive capability required by default-worker tasks. */
  readonly workerCapability?: string
  /** Named Agent preset composed for a default worker; it must not expose delegation controls. */
  readonly workerPreset?: string
  /** Display name of a reviewer provisioned for mutating default-worker tasks. */
  readonly reviewerName?: string
  /** Capability required by the provisioned reviewer Participant. */
  readonly reviewerCapability?: string
  /** Named non-delegating Agent preset composed for the reviewer. */
  readonly reviewerPreset?: string
  /** Bounded attempt limit frozen on every default-worker task. */
  readonly workerTaskMaxAttempts?: number
  /** Scheduler priority frozen on every default-worker task. */
  readonly workerTaskPriority?: number
  /** Order of the coordinator-only explicit-final-output system-prompt section. */
  readonly finalPromptOrder?: number
  /** Order of the worker-only task-reporting system-prompt section. */
  readonly workerPromptOrder?: number
  /** Bounded retries for trusted Team mutations after a concurrent cursor change. */
  readonly receiptRetryAttempts?: number
  /** Bounded retries for trusted human input after a concurrent channel cursor change. */
  readonly humanInputRetryAttempts?: number
  /** Maximum automatic coordinator continuation turns after a model output limit. */
  readonly maxCoordinatorOutputContinuations?: number
  /** Maximum channel records read by one final-output wait page. */
  readonly channelPageSize?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  members: z.array(z.object({ role: z.string().min(1), displayName: z.string().min(1),
    kind: z.union(['local-agent', 'remote-agent'] as const), capabilities: z.array(z.string().min(1)),
    provider: z.string().min(1), modelProvider: z.string().min(1), model: z.string().min(1),
    preset: z.string().default(undefined as unknown as string), maxTokens: z.number().step(1).min(1),
  })).default([]),
  activationProvider: z.string().default(DEFAULT_ACTIVATION_PROVIDER),
  templateId: z.string().default(DEFAULT_TEMPLATE_ID),
  templateVersion: z.number().step(1).min(1).default(DEFAULT_TEMPLATE_VERSION),
  placementDefaults: z.object({
    participantIds: z.array(z.string().min(1)).default(undefined as unknown as string[]),
    roles: z.array(z.string().min(1)).default(undefined as unknown as string[]),
    providers: z.array(z.string().min(1)).default(undefined as unknown as string[]),
    presets: z.array(z.string().min(1)).default(undefined as unknown as string[]),
    models: z.array(z.string().min(1)).default(undefined as unknown as string[]),
  }).default(undefined as unknown as {
    participantIds: string[]
    roles: string[]
    providers: string[]
    presets: string[]
    models: string[]
  }),
  humanName: z.string().default(DEFAULT_HUMAN_NAME),
  coordinatorName: z.string().default(DEFAULT_COORDINATOR_NAME),
  workerName: z.string().default(DEFAULT_WORKER_NAME),
  workerCount: z.number().step(1).min(0).default(1),
  maxWorkerCount: z.number().step(1).min(0).default(DEFAULT_MAX_WORKER_COUNT),
  workerCapability: z.string().default(DEFAULT_WORKER_CAPABILITY),
  workerPreset: z.string().default(undefined as unknown as string),
  reviewerName: z.string().default('reviewer'),
  reviewerCapability: z.string().default('team-default-reviewer'),
  reviewerPreset: z.string().default(undefined as unknown as string),
  workerTaskMaxAttempts: z.number().step(1).min(1).default(DEFAULT_WORKER_TASK_MAX_ATTEMPTS),
  workerTaskPriority: z.number().step(1).min(0).default(DEFAULT_WORKER_TASK_PRIORITY),
  finalPromptOrder: z.number().default(DEFAULT_FINAL_PROMPT_ORDER),
  workerPromptOrder: z.number().default(DEFAULT_WORKER_PROMPT_ORDER),
  receiptRetryAttempts: z.number().step(1).min(1).default(DEFAULT_RECEIPT_RETRY_ATTEMPTS),
  humanInputRetryAttempts: z.number().step(1).min(1).default(DEFAULT_HUMAN_INPUT_RETRY_ATTEMPTS),
  maxCoordinatorOutputContinuations: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_COORDINATOR_OUTPUT_CONTINUATIONS),
  channelPageSize: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CHANNEL_PAGE_SIZE),
})

/** One user-owned Team objective plus the local execution root for its coordinator Session. */
export interface TeamRunCreateRequest {
  /** Runtime-only authenticated endpoint capability; required for a product-principal human invitation. */
  readonly admitHumanChannel?: HumanChannelAdmission | undefined
  /** Non-empty durable user objective. */
  readonly objective: string
  /** Absolute execution root recorded in the coordinator Session header. */
  readonly cwd: string
  /** Model route for this Team coordinator; falls back to the current deployment default. */
  readonly selection?: ModelSelection
  /** Named Agent preset composed in the coordinator's unpublished activation scope. */
  readonly preset?: string
  /** Optional positive output-token cap for every coordinator model request. */
  readonly maxTokens?: number
  /** Non-secret authenticated product principal that owns the default human participant. */
  readonly humanOwner?: Extract<TeamParticipantOwner, { readonly kind: 'product-principal' }>
  /** Optional cancellation before the coordinator activation publishes. */
  readonly signal?: AbortSignal
}

/** Runtime-only request from a parent delegation owner; the authorization supplies the execution root. */
export interface TeamRunChildRequest extends TeamChildRunIdentity {
  readonly authorization: TeamChildRunAuthorization
}

interface ChildTopologyContext {
  readonly authorization: TeamChildRunAuthorization
  readonly scope: Extract<TeamChildRunScope, { readonly operation: 'start' }>
}

/** Request to re-own one durable default Team after a prior process unloaded. */
export interface TeamRunResumeRequest {
  /** Runtime-only authenticated endpoint capability; required for a product-principal human invitation. */
  readonly admitHumanChannel?: HumanChannelAdmission | undefined
  /** Durable Team identity to re-attach. */
  readonly teamId: TeamId
  /** Optional replacement execution root; absent reuses the persisted Session header. */
  readonly cwd?: string
  /** Optional replacement coordinator preset; absent reuses the persisted Session header. */
  readonly preset?: string
  /** Optional replacement model route; absent reuses the latest persisted request context. */
  readonly selection?: ModelSelection
  /** Optional replacement output-token cap for future coordinator requests. */
  readonly maxTokens?: number
  /** Runtime-only authenticated-human authorization retained through coordinator recovery. */
  readonly authorization?: TeamHumanResumeAuthorization
  /** Non-secret product owner that must match the resumed run's selected human participant. */
  readonly humanOwner?: Extract<TeamParticipantOwner, { readonly kind: 'product-principal' }>
  /** Cancellation before the replacement coordinator publishes. */
  readonly signal?: AbortSignal
}

/** Durable default topology plus the live local coordinator lease for one active product Team. */
export interface TeamRunHandle {
  /** Additional template participants; each retains its declared workflow role and execution route. */
  readonly members: readonly ParticipantSnapshot[]
  /** Product-level Team identity. */
  readonly teamId: TeamId
  /** Current Team projection after default topology and coordinator activation commit. */
  readonly team: TeamSnapshot
  /** Trusted human participant that owns input and final-result receipts. */
  readonly recipient: ParticipantSnapshot
  /** Active local coordinator participant that receives human Envelope input. */
  readonly coordinator: ParticipantSnapshot
  /** First provisioned local worker participant used as the default worker. */
  readonly worker: ParticipantSnapshot | undefined
  /** All provisioned local worker participants, in durable invitation order. */
  readonly workers: readonly ParticipantSnapshot[]
  /** Versioned direct channel connecting the human and coordinator. */
  readonly channel: ChannelSnapshot
  /** Exact local coordinator residency lease. */
  readonly coordinatorLease: TeamActivationLease
}

/** Request to append trusted human content to a current Team's coordinator channel. */
export interface TeamRunHumanInputRequest {
  /** Team selected from a previously created local Team run. */
  readonly teamId: TeamId
  /** Non-empty text/image content accepted by the direct v3 human-message protocol. */
  readonly content: readonly DirectChannelHumanContentBlock[]
  /** Sender-scoped key retained by the Team channel for retry-safe human admission. */
  readonly idempotencyKey?: ChannelPostIdempotencyKey
  /** Human input delivery intent; headless initial input normally wakes a turn. */
  readonly delivery?: 'context' | 'turn' | 'steer'
  /** Optional runtime-only owner fence used by authenticated product transports. */
  readonly humanOwner?: Extract<TeamParticipantOwner, { readonly kind: 'product-principal' }>
}

/** Opaque capability for one exact local default-run coordinator. */
export interface TeamRunCoordinatorTaskAuthority {
  /** Module-private proof that callers can obtain only from {@link TeamRunService.coordinatorTaskAuthority}. */
  readonly [coordinatorTaskAuthorityToken]: undefined
}

/** Opaque capability for reading or editing the current local coordinator's Team objective. */
export interface TeamRunCoordinatorGoalAuthority {
  /** Module-private proof that callers can obtain only from {@link TeamRunService.tryCoordinatorGoalAuthority}. */
  readonly [coordinatorGoalAuthorityToken]: undefined
}

/** Coordinator-supplied compare-and-set fields for one Team-objective edit. */
export interface TeamRunCoordinatorGoalUpdateRequest {
  /** Exact revision read from the current Team objective. */
  readonly expectedRevision: number
  /** Replacement non-empty Team objective. */
  readonly objective: string
}

/** Coordinator-supplied durable objective phase control. */
export interface TeamRunCoordinatorGoalPhaseRequest {
  /** Exact goal revision read from the current objective. */
  readonly expectedRevision: number
  /** Next objective phase. */
  readonly phase: TeamGoalPhase
  /** Required when phase is blocked. */
  readonly blocker?: TeamGoalBlocker
}

/** Coordinator-supplied fields for one retry-safe default-worker task. */
export interface TeamRunDefaultWorkerTaskStartRequest {
  /** Caller-selected retry identity scoped to the exact coordinator activation. */
  readonly idempotencyKey: TeamTaskCreateIdempotencyKey
  /** Short durable task subject. */
  readonly subject: string
  /** Complete durable task instructions. */
  readonly instructions: string
  /** Declared filesystem regions the task may read. */
  readonly readScopes: readonly string[]
  /** Declared filesystem regions the task may modify. */
  readonly writeScopes: readonly string[]
}

/** Coordinator task fields plus the explicit child budget and optional named template selection. */
export interface TeamRunDelegatedTaskStartRequest extends TeamRunDefaultWorkerTaskStartRequest {
  /** Frozen ceilings applied to both the parent task and its delegated child. */
  readonly budget: TeamResourceBudget
  /** Named deployment template; supplied together with templateVersion. */
  readonly templateId?: string
  /** Exact template revision; supplied together with templateId. */
  readonly templateVersion?: number
}

/** Coordinator-selected worker-pool target for one active local Team. */
export interface TeamRunWorkerPoolSetRequest {
  /** Requested number of live worker Participants, including slot zero. */
  readonly targetCount: number
}

/** Bounded worker-pool capacity and queue status returned to the coordinator. */
export interface TeamRunWorkerPoolStatus {
  /** Requested target before applying the deployment ceiling. */
  readonly requestedCount: number
  /** Effective target after applying the deployment ceiling. */
  readonly targetCount: number
  /** Deployment ceiling for this TeamRun. */
  readonly maxCount: number
  /** Durable worker Participants that have not been retired. */
  readonly workerCount: number
  /** Workers with active membership and a non-offline activation. */
  readonly activeCount: number
  /** Active workers with no assigned or running task. */
  readonly idleCount: number
  /** Active workers currently holding a task lease. */
  readonly busyCount: number
  /** Ready or assigned tasks waiting for an available worker. */
  readonly queuedTaskCount: number
  /** True when the requested target was capped or capacity is currently saturated. */
  readonly saturated: boolean
}

/** Review facts for the active attempt, or the latest settled attempt when no lease exists. */
export interface TeamRunDefaultWorkerTaskReview {
  /** Frozen route selected at task creation; omitted tool arguments do not disable review. */
  readonly reviewPolicy: TeamTaskSnapshot['reviewPolicy']
  /** Matching attempt decision, or null when that attempt has no review decision. */
  readonly reviewResult: { readonly attemptId: TaskAttemptId; readonly decision: 'accepted' | 'rework' } | null
}

/** Bounded durable review and stop-request facts shared by every task observation. */
export interface TeamRunDefaultWorkerTaskStatus extends TeamRunDefaultWorkerTaskReview {
  /** Reserved child Team, when this task delegates execution. */
  readonly childTeamId?: TeamId
  /** Explicit child response already admitted to this parent task. */
  readonly delegationResult?: { readonly text: string; readonly artifacts: readonly TeamArtifactReference[] }

  /** Null without a single-task intent; expiry still waits for owner termination. */
  readonly cancellation: { readonly requestedRevision: number; readonly attemptId: TaskAttemptId | null; readonly expired: boolean } | null
}

/** Compact durable identity returned after a default-worker task is accepted or replayed. */
export interface TeamRunDefaultWorkerTask extends TeamRunDefaultWorkerTaskStatus {
  /** Team-local task identity. */
  readonly id: TeamTaskId
  /** Current task phase at the operation's snapshot. */
  readonly phase: TeamTaskSnapshot['phase']
}

/** Request to await one default-worker task previously accepted through an exact coordinator authority. */
export interface TeamRunDefaultWorkerTaskWaitRequest {
  /** Default-worker task accepted under this coordinator authority. */
  readonly taskId: TeamTaskId
  /** Cancels only this local Team-journal wait. */
  readonly signal?: AbortSignal
}

/** Request to await one Team cursor advance for the owned default-worker task set. */
export interface TeamRunDefaultWorkerTaskWatchRequest {
  /** Last Team-journal cursor already observed, or `-1` for an immediate snapshot. */
  readonly afterCursor?: number
  /** Cancels only this local progress watch. */
  readonly signal?: AbortSignal
}

/** Bounded progress snapshot for coordinator-owned default-worker tasks. */
export interface TeamRunDefaultWorkerTaskWatch {
  /** Team-journal cursor represented by this snapshot. */
  readonly cursor: number
  /** Current compact state of every task owned by this coordinator. */
  readonly tasks: readonly TeamRunDefaultWorkerTask[]
}

/** Request to stop one coordinator-owned task while its Team keeps running. */
export interface TeamRunDefaultWorkerTaskCancelRequest {
  /** Task previously accepted through this coordinator authority. */
  readonly taskId: TeamTaskId
  /** Optional caller explanation retained with the accepted cancellation. */
  readonly reason?: string | undefined
}

/** Compact list result for coordinator-owned default-worker tasks. */
export interface TeamRunDefaultWorkerTaskList {
  /** Current compact task projections in durable task order. */
  readonly tasks: readonly TeamRunDefaultWorkerTask[]
}

/** Request to set or clear an advisory owner proposal for an owned pending task. */
export interface TeamRunDefaultWorkerTaskOwnerProposalRequest {
  /** Task previously accepted through this coordinator authority. */
  readonly taskId: TeamTaskId
  /** Preferred Team Participant, or omitted to clear the scheduler hint. */
  readonly proposedOwnerId?: ParticipantId | undefined
}

/** Compact result of an advisory owner proposal mutation. */
export interface TeamRunDefaultWorkerTaskOwnerProposal {
  /** Team-local task identity. */
  readonly id: TeamTaskId
  /** Current task phase after the proposal mutation. */
  readonly phase: TeamTaskSnapshot['phase']
  /** Durable preferred owner hint, when one is retained. */
  readonly proposedOwnerId?: ParticipantId | undefined
}

/** Request to compile one complete declarative workflow through the current coordinator. */
export interface TeamRunWorkflowPlanStartRequest {
  /** Retry identity derived from the complete model-call lineage. */
  readonly idempotencyKey: TeamWorkflowPlanIdempotencyKey
  /** Complete task/channel graph with an explicit channel view policy for model delivery. */
  readonly plan: TeamWorkflowPlan
  /** Cancels only local compilation; the admitted plan remains recoverable. */
  readonly signal?: AbortSignal
}

/** Request to stop one task selected by its owning workflow template. */
export interface TeamRunWorkflowTaskCancelRequest {
  /** Plan previously admitted by this coordinator. */
  readonly planId: TeamWorkflowPlanId
  /** Template whose exact durable task binding is selected. */
  readonly templateId: TeamWorkflowTaskTemplate['id']
  /** Optional explanation retained by the task cancellation intent. */
  readonly reason?: string | undefined
}

/** Bounded workflow task cancellation progress with its durable plan binding. */
export interface TeamRunWorkflowTaskCancelResult extends TeamRunDefaultWorkerTask {
  /** Owning workflow plan. */
  readonly planId: TeamWorkflowPlanId
  /** Template corresponding to this task id. */
  readonly templateId: TeamWorkflowTaskTemplate['id']
  /** Retained prerequisite outcome, or null when no dependency cancelled this task. */
  readonly blockedByOutcome: NonNullable<TeamTaskSnapshot['blockedByOutcome']> | null
}

/** Request to await one workflow plan's durable terminal projection. */
export interface TeamRunWorkflowPlanWaitRequest {
  /** Workflow plan previously admitted through this coordinator. */
  readonly planId: TeamWorkflowPlanId
  /** Cancels only this local wait. */
  readonly signal?: AbortSignal
}

/** Compact workflow plan terminal value exposed by the TeamRun Consumer. */
export type TeamRunWorkflowPlanTerminal =
  | { readonly id: TeamWorkflowPlanId; readonly phase: 'completed'; readonly result: TeamWorkflowPlanResult }
  | { readonly id: TeamWorkflowPlanId; readonly phase: 'failed'; readonly failure: NonNullable<TeamWorkflowPlanSnapshot['failure']>; readonly result?: TeamWorkflowPlanResult }
  | { readonly id: TeamWorkflowPlanId; readonly phase: 'cancelled'; readonly cancellation?: NonNullable<TeamWorkflowPlanSnapshot['cancellation']>; readonly result?: TeamWorkflowPlanResult }

/** Terminal default-worker task projection with its retained result or terminal attempt fact. */
export type TeamRunDefaultWorkerTaskTerminal = TeamRunDefaultWorkerTaskStatus & (
  | {
    /** Team-local task identity. */
    readonly id: TeamTaskId
    /** Successful completion, including any configured participant review. */
    readonly phase: 'completed'
    /** Result retained by the completed worker attempt. */
    readonly result: TaskAttemptResult
  }
  | {
    /** Team-local task identity. */
    readonly id: TeamTaskId
    /** Exhausted worker task. */
    readonly phase: 'failed'
    /** Final retained failure, release, or expiry fact. */
    readonly outcome: Extract<TaskAttemptOutcome, { readonly kind: 'failed' | 'released' | 'lease-expired' }>
  }
  | {
    /** Team-local task identity. */
    readonly id: TeamTaskId
    /** Externally cancelled worker task. */
    readonly phase: 'cancelled'
  }
  | {
    /** Team-local task identity. */
    readonly id: TeamTaskId
    /** Externally deleted worker task. */
    readonly phase: 'deleted'
  }
)

/** Request that creates one local Team and admits its first human Envelope as one retryable product operation. */
export interface TeamRunStartRequest extends TeamRunCreateRequest {
  /** Sender-scoped key reused only for this exact create-and-admit operation. */
  readonly idempotencyKey: ChannelPostIdempotencyKey
  /** First nonempty human content admitted after the topology is active. */
  readonly content: readonly DirectChannelHumanContentBlock[]
  /** Delivery intent for the first human Envelope. */
  readonly delivery?: 'context' | 'turn' | 'steer'
}

/** Durable default topology and accepted first human Envelope from one product start. */
export interface TeamRunStartResult {
  /** Created local Team topology and coordinator lease. */
  readonly handle: TeamRunHandle
  /** First human Envelope accepted by the default direct channel. */
  readonly input: TeamEnvelope
}

/** Request to await an explicit coordinator final Envelope for one local Team run. */
export interface TeamRunFinalWaitRequest {
  /** Team selected from a previously created local Team run. */
  readonly teamId: TeamId
  /** Last observed channel-WAL cursor, or `-1` before the first read. */
  readonly afterCursor?: number
  /** Cancels only the local wait. */
  readonly signal?: AbortSignal
  /** Optional runtime-only owner fence used by authenticated product transports. */
  readonly humanOwner?: Extract<TeamParticipantOwner, { readonly kind: 'product-principal' }>
}

/** Human-addressed final result retained in the default Team channel WAL. */
export interface TeamRunFinal {
  /** Team that completed the local product run. */
  readonly teamId: TeamId
  /** Channel that retained the explicit final Envelope. */
  readonly channelId: ChannelId
  /** Immutable coordinator final Envelope identity. */
  readonly envelopeId: TeamEnvelope['id']
  /** Exact final text accepted by the direct v3 channel. */
  readonly text: string
}

interface RunState {
  /** Creation-time execution policy retained independently from future deployment template changes. */
  readonly config: ResolvedConfig
  readonly memberStates: Map<ParticipantId, WorkerState>
  readonly handle: TeamRunHandle
  readonly disposePrompt: () => void
  readonly workerAgent: WorkerAgentSpec
  readonly workerAgents: Map<ParticipantId, WorkerAgentSpec>
  /** Durable worker roster currently retained by this run; retired rows are omitted. */
  readonly workers: ParticipantSnapshot[]
  /** Current coordinator-selected worker target. */
  targetWorkerCount: number
  /** Smallest pool retained by automatic task-pressure scaling. */
  minimumWorkerCount: number
  readonly defaultWorkerTaskIds: Set<TeamTaskId>
  readonly workflowPlanIds: Set<TeamWorkflowPlanId>
  readonly workerStates: Map<ParticipantId, WorkerState>
  readonly workerActivations: Map<ParticipantId, Promise<WorkerState>>
  /** Serializes coordinator pool mutations while leaving already admitted tasks concurrent. */
  workerPoolMutation: Promise<void>
  /** Number of automatic coordinator continuations admitted for the current run. */
  coordinatorOutputContinuations: number
  /** Release has begun, so no new worker or reviewer topology proof may be issued. */
  topologyReleased: boolean
  reviewer?: ReviewerState | undefined
  reviewerActivation?: Promise<ReviewerState> | undefined
}

/** Private proof record tying one opaque final-receipt token to its current local run. */
interface FinalReceiptProofRecord {
  readonly state: RunState
  readonly scope: TeamSystemFinalReceiptScope
}

/** Private proof record tying one opaque human-input token to its current local run. */
interface EnvelopePostProofRecord {
  readonly state: RunState
  readonly scope: TeamSystemEnvelopePostScope
}

/** Private ephemeral closure authority retained only around one Hub closure command. */
interface ClosureProofRecord {
  /** Exact local run for completion/cancellation scopes; creation failures have no published run. */
  readonly state?: RunState | undefined
  /** Closed source operation and its Hub-validated durable attribution. */
  readonly scope: TeamSystemClosureScope
}

/** Private source-owned stalled-Team recovery proof retained only during its canonical phase call. */
interface ResumePhaseProofRecord {
  /** Exact stalled-Team recovery scope accepted by the Hub. */
  readonly scope: Extract<TeamSystemPhaseScope, { readonly kind: 'team-run-resume' }>
  /** Authenticated-human authorization that must remain live through the phase append. */
  readonly authorization?: TeamHumanResumeAuthorization
}

/** Private source-owned completion-admission proof retained only around one quiescing phase command. */
interface FinalizationQuiescePhaseProofRecord {
  /** Exact current local run whose accepted final result is being fenced. */
  readonly state: RunState
  /** Exact final-result identity and Team cursor accepted by the Hub. */
  readonly scope: Extract<TeamSystemPhaseScope, { readonly kind: 'team-run-finalization-quiesce' }>
}

/** Private human-to-coordinator interrupt proof retained only while one current TeamRun asks the Hub to commit it. */
interface InterruptProofRecord {
  /** Exact locally owned run whose topology derives requester and target identity. */
  readonly state: RunState
  /** Exact TeamRun interrupt topology accepted by the Hub. */
  readonly scope: TeamSystemInterruptScope
}

/** Private source-owned default-worker task-control proof retained for one exact Hub mutation. */
interface TaskControlProofRecord {
  /** Exact local run whose current coordinator owns the task-control operation. */
  readonly state: RunState
  /** Exact currently running coordinator turn that issued the proof. */
  readonly coordinator: Agent
  /** Closed task-control operation and every durable fact it permits. */
  readonly scope: TeamSystemTaskControlScope
}

/** Private source-owned root-creation proof retained for one exact Hub admission. */
interface RootCreationProofRecord {
  /** Exact root payload and closed source operation selected before Team identity minting. */
  readonly scope: TeamSystemRootCreationScope
}

/** Private in-memory product ownership retained only after this service settles a terminal Team. */
interface TerminalArchiveOwner {
  /** Terminal Team whose archive marker this local service may request. */
  readonly teamId: TeamId
}

/** Private source-owned proof retained only around one terminal archive Hub call. */
interface ArchiveProofRecord {
  /** Exact process-local terminal owner that retained this authority. */
  readonly owner: TerminalArchiveOwner
  /** Closed archive operation and its Team/cursor compare-and-set fields. */
  readonly scope: TeamSystemArchiveScope
}

/** Private source-owned post-release cancellation cleanup proof retained for one exact Hub mutation. */
interface CancellationCleanupProofRecord {
  /** Exact local run that remains retained throughout cancellation cleanup. */
  readonly state: RunState
  /** Exact durable cancellation identity that owns the cleanup window. */
  readonly cancellation: TeamCancellationSnapshot
  /** Closed cleanup operation and every durable fact it permits. */
  readonly scope: TeamSystemCancellationCleanupScope
}

/** Private source-owned post-release finalization cleanup proof retained for one exact Hub mutation. */
interface FinalizationCleanupProofRecord {
  /** Exact local run retained after release until final Team closure settles. */
  readonly state: RunState
  /** Closed cleanup operation and every durable final-result fact it permits. */
  readonly scope: TeamSystemFinalizationCleanupScope
}

/** Private un-published bootstrap state that owns one in-flight topology proof. */
interface BootstrapTopologyState {
  /** Team being assembled before a current local run exists. */
  readonly teamId: TeamId
  /** The sole proof admitted for the current sequential bootstrap mutation. */
  proof?: TeamSystemTopologyProof | undefined
}

/** Private source-owned topology proof retained only around one exact Hub mutation. */
interface TopologyProofRecord {
  /** Closed topology operation and every immutable durable fact it permits. */
  readonly scope: TeamSystemTopologyScope
  /** Bootstrap owner before publication, or retained local run after publication. */
  readonly owner: BootstrapTopologyState | RunState
}

/** Private source-owned workflow compiler proof retained only around one exact Hub mutation. */
interface WorkflowProofRecord {
  /** Exact local run whose coordinator owns the compiler mutation. */
  readonly state: RunState
  /** Exact currently running coordinator turn that issued the proof. */
  readonly coordinator: Agent
  /** Closed workflow compiler operation and every immutable payload fact it permits. */
  readonly scope: TeamSystemWorkflowScope
}

interface CoordinatorAuthorityState {
  readonly state: RunState
  readonly coordinator: Agent
}

interface WorkerAgentSpec {
  readonly cwd: string
  readonly options: AgentOptions
  readonly preset?: string
  readonly sessionId?: SessionId
}

/** Narrow persistence read face needed to reconstruct a Team coordinator before resume. */
interface SessionPersistenceReader {
  inspect(id: SessionId, signal?: AbortSignal): Promise<{
    readonly meta: { readonly teamId?: string; readonly participantId?: string; readonly cwd?: string; readonly agentPreset?: string }
    readonly events: readonly SessionEvent[]
  }>
}

interface WorkerState {
  readonly lease: TeamActivationLease
  readonly disposePrompt: () => void
}

interface ReviewerState extends WorkerState {
  readonly participant: ParticipantSnapshot
}

interface StartState {
  readonly fingerprint: string
  readonly result: Promise<TeamRunStartResult>
  teamId?: TeamId
}

interface WorkflowStartState {
  readonly fingerprint: string
  readonly result: Promise<TeamWorkflowPlanSnapshot>
  teamId?: TeamId
}

interface ResolvedConfig {
  readonly members: readonly TeamRunMember[]
  readonly activationProvider: string
  readonly templateId: string
  readonly templateVersion: number
  readonly placementDefaults?: TeamTaskPlacement
  readonly humanName: string
  readonly coordinatorName: string
  readonly workerName: string
  readonly workerCount: number
  readonly maxWorkerCount: number
  readonly workerCapability: string
  readonly workerPreset?: string
  readonly reviewerName: string
  readonly reviewerCapability: string
  readonly reviewerPreset?: string
  readonly workerTaskMaxAttempts: number
  readonly workerTaskPriority: number
  readonly finalPromptOrder: number
  readonly workerPromptOrder: number
  readonly receiptRetryAttempts: number
  readonly humanInputRetryAttempts: number
  readonly maxCoordinatorOutputContinuations: number
  readonly channelPageSize: number
}

/**
 * Owns the current local default Team topology, trusted human ingress, and
 * explicit final-output receipt. Existing Team services retain authority for
 * durable state, activation, Envelope admission, and Agent turns.
 */
export class TeamRunService extends Service {
  private readonly childStarts = new Map<TeamId, { readonly operation: Promise<TeamChildRunBinding>; readonly abort: AbortController }>()
  private readonly childChannelProofs = new Map<TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope>()
  private readonly childResultProofs = new Map<TeamSystemChildResultProof, { readonly state: RunState; readonly scope: TeamSystemChildResultScope }>()
  private readonly runs = new Map<TeamId, RunState>()
  private readonly resumes = new Map<TeamId, Promise<TeamRunHandle>>()
  private readonly starts = new Map<ChannelPostIdempotencyKey, StartState>()
  private readonly workflowStarts = new Map<TeamWorkflowPlanIdempotencyKey, WorkflowStartState>()
  private readonly listeners: (() => void)[] = []
  private readonly coordinatorTaskAuthorities = new WeakMap<TeamRunCoordinatorTaskAuthority, CoordinatorAuthorityState>()
  private readonly coordinatorGoalAuthorities = new WeakMap<TeamRunCoordinatorGoalAuthority, CoordinatorAuthorityState>()
  private coordinatorActorProofIssuer: ActivationActorProofIssuer | undefined
  private readonly coordinatorActorProofLeases = new Map<TeamActorProofLease, RunState>()
  private readonly invitationProofs = new WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>()
  private readonly admissionAbort = new AbortController()
  private readonly finalReceiptProofs = new WeakMap<TeamSystemFinalReceiptProof, FinalReceiptProofRecord>()
  private readonly finalReceiptProofsByRun = new WeakMap<RunState, TeamSystemFinalReceiptProof>()
  private readonly envelopePostProofs = new WeakMap<TeamSystemEnvelopePostProof, EnvelopePostProofRecord>()
  private readonly envelopePostProofsByRun = new WeakMap<RunState, TeamSystemEnvelopePostProof>()
  private readonly closureProofs = new WeakMap<TeamSystemClosureProof, ClosureProofRecord>()
  private readonly resumePhaseProofs = new WeakMap<TeamSystemPhaseProof, ResumePhaseProofRecord>()
  private readonly resumePhaseProofByTeam = new Map<TeamId, TeamSystemPhaseProof>()
  private readonly finalizationQuiescePhaseProofs = new Map<TeamSystemPhaseProof, FinalizationQuiescePhaseProofRecord>()
  private readonly interruptProofs = new Map<TeamSystemInterruptProof, InterruptProofRecord>()
  private readonly taskControlProofs = new Map<TeamSystemTaskControlProof, TaskControlProofRecord>()
  private readonly rootCreationProofs = new Map<TeamSystemRootCreationProof, RootCreationProofRecord>()
  private readonly terminalArchiveOwners = new Map<TeamId, TerminalArchiveOwner>()
  private readonly archiveProofs = new Map<TeamSystemArchiveProof, ArchiveProofRecord>()
  private readonly cancellationCleanupProofs = new Map<TeamSystemCancellationCleanupProof, CancellationCleanupProofRecord>()
  private readonly finalizationCleanupProofs = new Map<TeamSystemFinalizationCleanupProof, FinalizationCleanupProofRecord>()
  private readonly bootstrapTopologies = new Map<TeamId, BootstrapTopologyState>()
  private readonly topologyProofs = new Map<TeamSystemTopologyProof, TopologyProofRecord>()
  private readonly workflowProofs = new Map<TeamSystemWorkflowProof, WorkflowProofRecord>()
  private readonly config: ResolvedConfig
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * @param ctx - Context carrying Team, activation, model-selection, and prompt services.
   * @param config - validated deployment topology and receipt settings.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'teamRuns')
    this.config = resolveConfig(config)
    ctx.teams.registerSystemChannelAdmissionProofSource({ name: 'team-run',
      resolveChannelAdmissionProof: proof => this.closing ? undefined : this.invitationProofs.get(proof) })
    ctx.teams.registerSystemChannelLifecycleProofSource({ name: 'team-run-child',
      resolveChannelLifecycleProof: proof => this.closing ? undefined : this.childChannelProofs.get(proof) })
    ctx.teams.registerSystemChildResultProofSource({ name: 'team-run', resolveChildResultProof: (proof) => {
      const record = this.childResultProofs.get(proof)
      return !this.closing && record !== undefined && this.runs.get(record.scope.binding.childTeamId) === record.state
        && isDeepStrictEqual(record.state.handle.team.childRun, record.scope.binding) ? record.scope : undefined
    } })
    const finalReceiptProofSource: TeamSystemFinalReceiptProofSource = Object.freeze({
      name: TEAM_RUN_FINAL_RECEIPT_PROOF_SOURCE,
      resolveFinalReceiptProof: (proof: TeamSystemFinalReceiptProof): TeamSystemFinalReceiptScope | undefined =>
        this.resolveFinalReceiptProof(proof),
    })
    teamRunFinalReceiptProofSources.set(this, finalReceiptProofSource)
    const envelopePostProofSource: TeamSystemEnvelopePostProofSource = Object.freeze({
      name: TEAM_RUN_FINAL_RECEIPT_PROOF_SOURCE,
      resolveEnvelopePostProof: (proof: TeamSystemEnvelopePostProof): TeamSystemEnvelopePostScope | undefined =>
        this.resolveEnvelopePostProof(proof),
    })
    teamRunEnvelopePostProofSources.set(this, envelopePostProofSource)
    const closureProofSource: TeamSystemClosureProofSource = Object.freeze({
      name: TEAM_RUN_CLOSURE_PROOF_SOURCE,
      resolveClosureProof: (proof: TeamSystemClosureProof): TeamSystemClosureScope | undefined =>
        this.resolveClosureProof(proof),
    })
    teamRunClosureProofSources.set(this, closureProofSource)
    const phaseProofSource: TeamSystemPhaseProofSource = Object.freeze({
      name: TEAM_RUN_PHASE_PROOF_SOURCE,
      resolvePhaseProof: (proof: TeamSystemPhaseProof): TeamSystemPhaseScope | undefined =>
        this.resolveTeamRunPhaseProof(proof),
    })
    teamRunPhaseProofSources.set(this, phaseProofSource)
    const interruptProofSource: TeamSystemInterruptProofSource = Object.freeze({
      name: TEAM_RUN_INTERRUPT_PROOF_SOURCE,
      resolveInterruptProof: (proof: TeamSystemInterruptProof): TeamSystemInterruptScope | undefined =>
        this.resolveInterruptProof(proof),
    })
    teamRunInterruptProofSources.set(this, interruptProofSource)
    const taskControlProofSource: TeamSystemTaskControlProofSource = Object.freeze({
      name: TEAM_RUN_TASK_CONTROL_PROOF_SOURCE,
      resolveTaskControlProof: (proof: TeamSystemTaskControlProof): TeamSystemTaskControlScope | undefined =>
        this.resolveTaskControlProof(proof),
    })
    teamRunTaskControlProofSources.set(this, taskControlProofSource)
    const rootCreationProofSource: TeamSystemRootCreationProofSource = Object.freeze({
      name: TEAM_RUN_ROOT_CREATION_PROOF_SOURCE,
      resolveRootCreationProof: (proof: TeamSystemRootCreationProof): TeamSystemRootCreationScope | undefined =>
        this.resolveRootCreationProof(proof),
    })
    teamRunRootCreationProofSources.set(this, rootCreationProofSource)
    const archiveProofSource: TeamSystemArchiveProofSource = Object.freeze({
      name: TEAM_RUN_ARCHIVE_PROOF_SOURCE,
      resolveArchiveProof: (proof: TeamSystemArchiveProof): TeamSystemArchiveScope | undefined =>
        this.resolveArchiveProof(proof),
    })
    teamRunArchiveProofSources.set(this, archiveProofSource)
    const cancellationCleanupProofSource: TeamSystemCancellationCleanupProofSource = Object.freeze({
      name: TEAM_RUN_CANCELLATION_CLEANUP_PROOF_SOURCE,
      resolveCancellationCleanupProof: (proof: TeamSystemCancellationCleanupProof): TeamSystemCancellationCleanupScope | undefined =>
        this.resolveCancellationCleanupProof(proof),
    })
    teamRunCancellationCleanupProofSources.set(this, cancellationCleanupProofSource)
    const finalizationCleanupProofSource: TeamSystemFinalizationCleanupProofSource = Object.freeze({
      name: TEAM_RUN_FINALIZATION_CLEANUP_PROOF_SOURCE,
      resolveFinalizationCleanupProof: (proof: TeamSystemFinalizationCleanupProof): TeamSystemFinalizationCleanupScope | undefined =>
        this.resolveFinalizationCleanupProof(proof),
    })
    teamRunFinalizationCleanupProofSources.set(this, finalizationCleanupProofSource)
    const topologyProofSource: TeamSystemTopologyProofSource = Object.freeze({
      name: TEAM_RUN_TOPOLOGY_PROOF_SOURCE,
      resolveTopologyProof: (proof: TeamSystemTopologyProof): TeamSystemTopologyScope | undefined =>
        this.resolveTopologyProof(proof),
    })
    teamRunTopologyProofSources.set(this, topologyProofSource)
    const workflowProofSource: TeamSystemWorkflowProofSource = Object.freeze({
      name: TEAM_RUN_WORKFLOW_PROOF_SOURCE,
      resolveWorkflowProof: (proof: TeamSystemWorkflowProof): TeamSystemWorkflowScope | undefined =>
        this.resolveWorkflowProof(proof),
    })
    teamRunWorkflowProofSources.set(this, workflowProofSource)
    teamRunTurnEndObservers.set(this, (session, event) => {
      this.observeCoordinatorTurnEnd(session, event)
    })
    this.listeners.push(this.ctx.on('team/changed', (event) => {
      if (event.type === 'team/changed' && event.team.childRun !== undefined) {
        const child = this.runs.get(event.team.id)
        if (child !== undefined && !child.topologyReleased
          && (event.team.closure !== undefined || event.team.cancellation !== undefined)) {
          void this.releaseRunWithRetries(child).catch((error: unknown) => {
            this.ctx.logger.warn(`team-run: child cleanup remains incomplete: ${String(error)}`)
          })
        }
        if (isTerminalTeamPhase(event.team.phase)) this.runs.delete(event.team.id)
        return
      }
      if (event.type !== 'task/changed' || event.task.execution.kind !== 'participant' || !isWorkerTaskTerminal(event.task.phase)) return
      const state = this.runs.get(event.task.teamId)
      if (state === undefined || state.topologyReleased || !state.defaultWorkerTaskIds.has(event.task.id)) return
      void this.enqueueWorkerPoolMutation(state, async () => {
        await this.reconcileWorkerPool(state)
      }).catch((error: unknown) => {
        if (!this.closing) this.ctx.logger.warn(`team-run: automatic worker-pool reconciliation failed: ${String(error)}`)
      })
    }))
  }

  /**
   * Resolve a named child template before the parent task reserves its durable child identity.
   * @param templateId - exact deployment template name; unavailable versions never fall back.
   * @param templateVersion - exact positive template revision selected by the parent task.
   * @returns detached JSON rules with execution configuration and an explicit coordinator model route; no workspace authority.
   */
  describeChildTemplate(templateId: string, templateVersion: number): JsonObject {
    this.assertOpen()
    if (templateId !== this.config.templateId || templateVersion !== this.config.templateVersion) {
      throw new TeamRunError(`Child template '${templateId}' version ${templateVersion} is unavailable`, 'TEAM_RUN_NOT_FOUND')
    }
    const selection = this.ctx.agentDefaultModel.currentSelection()
    if (selection === undefined) throw new TeamRunError('Child template requires an explicit coordinator model route', 'TEAM_RUN_MODEL_REQUIRED')
    return jsonObjectSchema.parse(structuredClone({
      productTemplate: { id: templateId, version: templateVersion, members: this.config.members,
        ...this.config.placementDefaults === undefined ? {} : { placement: placementDefaultsJson(this.config.placementDefaults) } },
      childRuntime: { config: this.config, selection },
    }))
  }

  /**
   * Publish a reserved child Team's model residency and parent-service result endpoints.
   * The parent service owns invitation consent and the initial consult request.
   * @param request - opaque parent authorization and its exact child identity.
   * @returns durable endpoints, including an identical already-published binding on retry.
   */
  async startChild(request: TeamRunChildRequest): Promise<TeamChildRunBinding> {
    this.assertOpen()
    const scope = await this.ctx.teams.assertChildRunAuthorization(request.authorization)
    assertChildIdentity(request, scope, 'start')
    if (scope.operation !== 'start') throw new TeamRunError('Child start requires start authority', 'TEAM_RUN_NOT_FOUND')
    const retained = this.runs.get(scope.childTeamId)
    if (retained !== undefined) {
      const binding = retained.handle.team.childRun
      if (binding === undefined || binding.delegationId !== scope.delegationId) {
        throw new TeamRunError('Child identity belongs to another local run', 'TEAM_RUN_START_CONFLICT')
      }
      return binding
    }
    const pending = this.childStarts.get(scope.childTeamId)
    if (pending !== undefined) return await pending.operation
    const abort = new AbortController()
    const operation = this.startChildOwned({ authorization: request.authorization, scope }, abort.signal)
      .finally(() => { this.childStarts.delete(scope.childTeamId) })
    this.childStarts.set(scope.childTeamId, { operation, abort })
    return await operation
  }

  /** Cancel a child under fresh parent authority before releasing its local execution leases.
   * @param request - exact cancellation authority and child identity.
   * @returns terminal state or explicit durable cleanup progress.
   */
  async cancelChild(request: TeamRunChildRequest): Promise<TeamStateSnapshot> {
    this.assertOpen()
    const scope = await this.ctx.teams.assertChildRunAuthorization(request.authorization)
    assertChildIdentity(request, scope, 'cancel')
    let current = await this.ctx.teams.getTeam({ teamId: scope.childTeamId })
    const command = { authorization: request.authorization, childTeamId: scope.childTeamId,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse(`child-cancel:${scope.delegationId}`),
      reason: { code: 'PARENT_DELEGATION_CANCELLED', message: 'The parent delegation cancelled this child.' } }
    if (!isTerminalTeamPhase(current.team.phase)) {
      current = await this.ctx.teams.cancelChildTeam({ ...command, expectedCursor: current.team.cursor })
    }
    const startup = this.childStarts.get(scope.childTeamId)
    startup?.abort.abort(new Error('Parent delegation cancelled child startup'))
    if (startup !== undefined) await Promise.allSettled([startup.operation])
    const retained = this.runs.get(scope.childTeamId)
    if (retained !== undefined) await this.releaseRunWithRetries(retained)
    current = await this.ctx.teams.getTeam({ teamId: scope.childTeamId })
    if (!isTerminalTeamPhase(current.team.phase)) {
      current = await this.ctx.teams.cancelChildTeam({ ...command, expectedCursor: current.team.cursor })
    }
    if (isTerminalTeamPhase(current.team.phase)) this.runs.delete(scope.childTeamId)
    return current
  }

  private async startChildOwned(child: ChildTopologyContext, signal: AbortSignal): Promise<TeamChildRunBinding> {
    const created = await this.ctx.teams.getTeam({ teamId: child.scope.childTeamId })
    if (created.team.parentTeamId !== child.scope.parentTeamId || created.team.parentTaskId !== child.scope.parentTaskId) {
      throw new TeamRunError('Reserved child has different durable ancestry', 'TEAM_RUN_NOT_FOUND')
    }
    if (isTerminalTeamPhase(created.team.phase) && created.team.childRun !== undefined) return created.team.childRun
    if (created.team.phase !== 'active') throw new TeamRunError('Child start requires an active reserved Team', 'TEAM_RUN_NOT_QUIESCENT')
    const frozen = parseChildRuntime(created.rules.childRuntime)
    const scope = await this.ctx.teams.assertChildRunAuthorization(child.authorization)
    assertChildIdentity(child.scope, scope, 'start')
    const handle = await this.createTopology({ objective: created.goal.objective, cwd: child.scope.workspacePath,
      selection: frozen.selection, signal }, created, frozen.config,
    coordinatorOptions(frozen.selection, undefined), child)
    if (handle.team.childRun === undefined) throw new TeamRunError('Child endpoint publication did not commit', 'TEAM_RUN_NOT_QUIESCENT')
    return handle.team.childRun
  }

  private async openChildResultChannel(child: ChildTopologyContext, input: ChannelOpenInput): Promise<ChannelSnapshot> {
    const scope = await this.ctx.teams.assertChildRunAuthorization(child.authorization)
    assertChildIdentity(child.scope, scope, 'start')
    const state = await this.ctx.teams.getTeam({ teamId: child.scope.childTeamId })
    const candidates: ChannelSnapshot[] = []
    for (const channelId of state.channelIds) {
      const channel = await this.ctx.teams.getChannel({ channelId })
      if (channel.manifest.adapter.type === 'consult' && channel.manifest.adapter.version === 1
        && isDeepStrictEqual(channel.manifest.participants, input.participants)) candidates.push(channel)
    }
    if (candidates.length > 1) throw new TeamRunError('Child has ambiguous result channels', 'TEAM_RUN_START_CONFLICT')
    if (candidates[0] !== undefined) return candidates[0]
    const { workflowPlanId, expectedPlanRevision, ...generic } = input
    if (workflowPlanId !== undefined || expectedPlanRevision !== undefined) throw new TeamRunError('Child result channel cannot be workflow-owned', 'TEAM_RUN_NOT_FOUND')
    const token: object = Object.freeze({ toJSON(): never { throw new TypeError('Child channel proof is runtime-only') } })
    const proof = token as TeamSystemChannelLifecycleProof
    this.childChannelProofs.set(proof, { kind: 'channel-open', ...generic })
    try { return await this.ctx.teams.openChannel({ actor: proof, authorityKind: 'channel-lifecycle', ...generic }) }
    finally { this.childChannelProofs.delete(proof) }
  }

  /** Observe coordinator turn termination even when no product caller is waiting for a final. */
  private observeCoordinatorTurnEnd(session: Session, event: SessionEvent): void {
    if (event.type !== 'turn/end') return
    const state = [...this.runs.values()].find(run => run.handle.coordinatorLease.localAgent?.session === session)
    if (state === undefined || state.handle.team.parentTeamId === undefined && this.ctx.get('teamClosureDriver') === undefined) return
    void this.recordCoordinatorTurnEnd(state, event).catch((error: unknown) => {
      if (!this.closing) this.ctx.logger.warn(`team-run: coordinator turn lifecycle observation failed: ${String(error)}`)
    })
  }

  /**
   * Create the default human/coordinator/worker-pool Team topology and publish
   * its local coordinator residency before any human input enters its channel.
   * @param request - objective, coordinator execution root, and optional activation cancellation.
   * @returns the durable topology and current local coordinator lease.
   */
  async create(request: TeamRunCreateRequest): Promise<TeamRunHandle> {
    this.assertOpen()
    const objective = requiredText(request.objective, 'objective')
    const selection = request.selection ?? this.ctx.agentDefaultModel.currentSelection()
    if (selection === undefined) {
      throw new TeamRunError('a default provider and model are required to activate the Team coordinator', 'TEAM_RUN_MODEL_REQUIRED')
    }
    const options = coordinatorOptions(selection, request.maxTokens)
    const rootInput: TeamRootCreateInput = {
      goal: { objective, budgets: {} },
      rules: {
        productTemplate: { id: this.config.templateId, version: this.config.templateVersion,
          ...this.config.members.length === 0 ? {} : { members: this.config.members.map(member => ({ ...member })) },
          ...this.config.placementDefaults === undefined ? {} : { placement: placementDefaultsJson(this.config.placementDefaults) } },
        workerPool: { count: this.config.workerCount },
        workspacePath: request.cwd,
      },
      budgets: {},
    }
    const created = await this.withRootCreationProof({
      kind: 'team-run-root-create',
      ...rootInput,
    }, async actor => await this.ctx.teams.createTeam({
      actor,
      ...rootInput,
    }))
    return await this.createTopology(request, created, this.config, options)
  }

  /** Build one Team's execution topology from a resolved creation-time policy. */
  private async createTopology(
    request: TeamRunCreateRequest, created: TeamStateSnapshot, config: ResolvedConfig, options: AgentOptions,
    child?: ChildTopologyContext,
  ): Promise<TeamRunHandle> {
    const admissionSignal = request.signal === undefined ? this.admissionAbort.signal
      : AbortSignal.any([request.signal, this.admissionAbort.signal])
    const bootstrap = this.beginBootstrapTopology(created.team.id)
    let lease: TeamActivationLease | undefined
    let disposePrompt: (() => void) | undefined
    const memberStates = new Map<ParticipantId, WorkerState>()
    try {
      const recipient = await this.activateBootstrapParticipant(bootstrap, {
        kind: child === undefined ? 'human' : 'service', displayName: child === undefined ? config.humanName : 'Parent delegation',
        role: child === undefined ? 'human' : 'parent-service', capabilities: [], active: true, recover: child !== undefined,
        ...child === undefined ? { authorityGrant: DEFAULT_HUMAN_AUTHORITY_GRANT, owner: request.humanOwner ?? { kind: 'system' as const } } : {},
      })
      const coordinator = await this.activateBootstrapParticipant(bootstrap, {
        kind: 'local-agent', displayName: config.coordinatorName, role: 'coordinator', capabilities: [], active: true,
        recover: child !== undefined,
      })
      const workers: ParticipantSnapshot[] = []
      if (child !== undefined && created.team.childRun !== undefined) workers.push(...workerParticipants(created))
      for (let index = 0; created.team.childRun === undefined && index < config.workerCount; index += 1) {
        workers.push(await this.activateBootstrapParticipant(bootstrap, {
          kind: 'local-agent',
          displayName: index === 0 ? config.workerName : `${config.workerName} ${String(index + 1)}`,
          role: workerRole(index),
          capabilities: [config.workerCapability],
          active: false,
          recover: child !== undefined,
        }))
      }
      const worker = workers[0]
      const members: ParticipantSnapshot[] = []
      for (const member of config.members) {
        if (child !== undefined) await this.ctx.teams.assertChildRunAuthorization(child.authorization)
        const participant = await this.activateBootstrapParticipant(bootstrap, {
          kind: member.kind, displayName: member.displayName, role: member.role, capabilities: member.capabilities,
          provider: member.provider, model: `${member.modelProvider}/${member.model}`,
          ...member.preset === undefined ? {} : { preset: member.preset }, active: true,
          recover: child !== undefined,
        })
        members.push(participant)
        memberStates.set(participant.id, await this.activateTemplateMember(created.team.id, participant, member,
          request.cwd, admissionSignal, config.workerPromptOrder))
      }
      let state = await this.ctx.teams.getTeam({ teamId: created.team.id })
      const channelInput = {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: child === undefined ? DIRECT_CHANNEL_ADAPTER_V4 : CONSULT_CHANNEL_ADAPTER_V1,
        viewPolicy: { type: child === undefined ? 'directed' : 'recent-window', version: 1 },
        participants: [
          { id: recipient.id, role: child === undefined ? 'human' : 'initiator' },
          { id: coordinator.id, role: child === undefined ? 'coordinator' : 'respondent' },
        ],
        limits: {},
      }
      let channel = child === undefined ? await this.withBootstrapTopologyProof(bootstrap, {
        kind: 'team-run-bootstrap-channel-open',
        ...channelInput,
        humanId: recipient.id,
        coordinatorId: coordinator.id,
      }, async actor => await this.ctx.teams.openChannel({ actor, ...channelInput }))
        : await this.openChildResultChannel(child, channelInput)
      if (child === undefined) await this.admitHumanEndpoint(channel, recipient, request.admitHumanChannel, admissionSignal)
      state = await this.ctx.teams.getTeam({ teamId: created.team.id })
      if (child !== undefined) await this.ctx.teams.assertChildRunAuthorization(child.authorization)
      const priorCoordinator = child === undefined ? undefined
        : state.activations.findLast(binding => binding.activation.participantId === coordinator.id)
      if (priorCoordinator !== undefined && priorCoordinator.quiescedAt === undefined) {
        if (priorCoordinator.recovery === undefined) throw new TeamRunError('Child coordinator requires confirmed recovery', 'TEAM_RUN_NOT_QUIESCENT')
        lease = await this.ctx.teamActivations.coldReplace({ teamId: created.team.id, participantId: coordinator.id,
          activationId: priorCoordinator.activation.id, signal: admissionSignal })
      } else lease = await this.ctx.teamActivations.activate({
        teamId: created.team.id,
        participantId: coordinator.id,
        expectedCursor: state.team.cursor,
        provider: config.activationProvider,
        sessionId: priorCoordinator?.sessionId ?? SessionId(`team-coordinator-${randomUUID()}`),
        seed: { kind: priorCoordinator === undefined ? 'fresh' : 'resume' },
        agent: {
          cwd: request.cwd,
          options,
          ...request.preset === undefined ? {} : { preset: request.preset },
        },
        signal: admissionSignal,
      })
      if (lease.localAgent === undefined) {
        throw new TeamRunError(
          `activation provider '${config.activationProvider}' did not publish a local coordinator Agent`,
          'TEAM_RUN_NOT_QUIESCENT',
        )
      }
      if (child === undefined) {
        channel = await this.ctx.teamChannelAdmission.waitUntilActive({ channelId: channel.manifest.id, signal: admissionSignal })
      } else {
        const current = await this.ctx.teams.getTeam({ teamId: created.team.id })
        await this.ctx.teams.bindChildRun({ authorization: child.authorization, expectedCursor: current.team.cursor,
          binding: { parentTeamId: child.scope.parentTeamId, parentTaskId: child.scope.parentTaskId,
            childTeamId: created.team.id, delegationId: child.scope.delegationId,
            parentServiceId: recipient.id, coordinatorId: coordinator.id, channelId: channel.manifest.id } })
        assertChildIdentity(child.scope, await this.ctx.teams.assertChildRunAuthorization(child.authorization), 'start')
      }
      disposePrompt = coordinatorPrompt(lease.localAgent, channel.manifest.id, config.finalPromptOrder, config.maxWorkerCount)
      const team = (await this.ctx.teams.getTeam({ teamId: created.team.id })).team
      const handle: TeamRunHandle = Object.freeze({
        members: Object.freeze(members),
        teamId: created.team.id,
        team,
        recipient: recipient,
        coordinator,
        worker,
        workers: Object.freeze([...workers]),
        channel,
        coordinatorLease: lease,
      })
      const workerAgent: WorkerAgentSpec = {
        cwd: request.cwd,
        options,
        ...config.workerPreset === undefined ? {} : { preset: config.workerPreset },
      }
      const run: RunState = {
        config: config,
        memberStates,
        handle,
        disposePrompt,
        workerAgent,
        workerAgents: new Map(workers.map((participant) => {
          const prior = state.activations.findLast(binding => binding.activation.participantId === participant.id)
          return [participant.id, { ...workerAgent, ...prior === undefined ? {} : { sessionId: prior.sessionId } }]
        })),
        workers: [...workers],
        targetWorkerCount: workers.length,
        minimumWorkerCount: config.workerCount === 0 ? 0 : 1,
        defaultWorkerTaskIds: new Set(created.tasks.filter(task => task.workflowPlanId === undefined
          && task.createCommand.creator.participantId === coordinator.id).map(task => task.id)),
        workflowPlanIds: new Set((created.workflowPlans ?? []).filter(plan => plan.actor?.participantId === coordinator.id).map(plan => plan.id)),
        workerStates: new Map(),
        workerActivations: new Map(),
        workerPoolMutation: Promise.resolve(),
        coordinatorOutputContinuations: 0,
        topologyReleased: false,
      }
      this.runs.set(created.team.id, run)
      this.releaseBootstrapTopology(bootstrap)
      if (child === undefined) {
        this.mintFinalReceiptProof(run)
        this.mintEnvelopePostProof(run)
      }
      return handle
    } catch (error: unknown) {
      this.releaseBootstrapTopology(bootstrap)
      const failures: unknown[] = []
      try { disposePrompt?.() } catch (cleanup: unknown) { failures.push(cleanup) }
      const cleanup = await Promise.allSettled([
        ...[...memberStates.values()].map(async (member) => {
          member.disposePrompt()
          await member.lease.dispose()
        }),
        ...lease === undefined ? [] : [this.disposeUnpublishedCoordinator(lease, config.receiptRetryAttempts)],
      ])
      failures.push(...cleanup.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []))
      if (child === undefined) {
        try { await this.failCreation(created.team.id, error) } catch (cleanup: unknown) { failures.push(cleanup) }
      }
      if (failures.length > 0) throw new AggregateError([error, ...failures], 'Team topology creation cleanup failed')
      throw error
    }
  }

  /** Retry only journal contention while disposing an unpublished coordinator lease. */
  private async disposeUnpublishedCoordinator(lease: TeamActivationLease, attempts: number): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try { await lease.dispose(); return } catch (error: unknown) {
        if (!hasTeamCursorConflict(error) || attempt + 1 >= attempts) throw error
      }
    }
  }

  /** Require actual endpoint confirmation before coordinator dispatch; callback rejection enters creation cleanup. */
  private async admitHumanEndpoint(
    channel: ChannelSnapshot, human: ParticipantSnapshot, capability: HumanChannelAdmission | undefined, signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    const admission = await this.ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
    const invitation = admission.invitations.find(value => value.participantId === human.id)
    if (invitation?.status === 'acknowledged') return
    if (human.owner?.kind === 'system') {
      await this.acknowledgeSystemHumanInvitation(channel, human)
    } else {
      if (capability === undefined) throw new TeamRunError('Product human endpoint admission capability is required', 'TEAM_RUN_NOT_QUIESCENT')
      await capability({ admission, participantId: human.id, signal })
      signal.throwIfAborted()
      const current = await this.ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
      if (current.invitations.find(value => value.participantId === human.id)?.status !== 'acknowledged') {
        throw new TeamRunError('Product endpoint returned without durable invitation consent', 'TEAM_RUN_NOT_QUIESCENT')
      }
    }
  }

  /** The system result Consumer explicitly accepts its exact supported human/coordinator manifest. */
  private async acknowledgeSystemHumanInvitation(channel: ChannelSnapshot, human: ParticipantSnapshot): Promise<void> {
    const manifest = parseDirectProductChannelManifest(channel.manifest)
    if (human.kind !== 'human' || human.owner?.kind !== 'system' || ![3, 4].includes(manifest.version)
      || !manifest.participantIds.includes(human.id)) throw new TeamRunError('System result endpoint cannot accept this channel', 'TEAM_RUN_NOT_QUIESCENT')
    const admission = await this.ctx.teams.getChannelAdmission({ channelId: manifest.channelId })
    const invitation = admission.invitations.find(value => value.participantId === human.id)
    if (invitation === undefined) throw new TeamRunError('System result endpoint lacks its invitation', 'TEAM_RUN_NOT_QUIESCENT')
    if (invitation.status === 'acknowledged') return
    const input = { channelId: manifest.channelId, revision: invitation.revision,
      manifestFingerprint: fingerprintChannelManifest(channel.manifest),
      idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`team-run:${String(manifest.channelId)}:${invitation.revision}`) }
    const token: object = { toJSON(): never { throw new TypeError('System result invitation proof is runtime-only') } }
    const proof = Object.freeze(token) as TeamSystemChannelAdmissionProof
    this.invitationProofs.set(proof, { kind: 'channel-invitation-acknowledge', teamId: human.teamId, participantId: human.id, ...input })
    try { await this.ctx.teams.acknowledgeChannelInvitation({ actor: proof, ...input }) }
    finally { this.invitationProofs.delete(proof) }
  }

  /**
   * Re-attach a durable default Team to a fresh local coordinator activation.
   * The persisted Session header and request context provide the exact identity
   * and model route; no new Team, Participant, channel, or Session is created.
   * @param request - Team identity and optional replacement coordinator choices.
   * @returns the re-owned durable topology and current coordinator lease.
   */
  async resume(request: TeamRunResumeRequest): Promise<TeamRunHandle> {
    this.assertOpen()
    try {
      await request.authorization?.assert()
      const existing = this.runs.get(request.teamId)
      if (existing !== undefined) {
        this.assertHumanOwner(existing, request.humanOwner)
        return existing.handle
      }
      const pending = this.resumes.get(request.teamId)
      if (pending !== undefined) {
        const joined = await pending
        await request.authorization?.assert()
        this.assertHandleHumanOwner(joined, request.humanOwner)
        return joined
      }
      const operation = this.resumeAuthorized(request)
      this.resumes.set(request.teamId, operation)
      try {
        return await operation
      } finally {
        if (this.resumes.get(request.teamId) === operation) this.resumes.delete(request.teamId)
      }
    } finally {
      request.authorization?.close()
    }
  }

  /** Resume one Team while any Host-provided human authorization remains retained. */
  private async resumeAuthorized(request: TeamRunResumeRequest): Promise<TeamRunHandle> {
    this.assertOpen()
    const authorization = request.authorization
    const authorizedState = authorization === undefined ? undefined : await authorization.assert()
    const existing = this.runs.get(request.teamId)
    if (existing !== undefined) {
      this.assertHumanOwner(existing, request.humanOwner)
      return existing.handle
    }
    const state = authorizedState ?? await this.ctx.teams.getTeam({ teamId: request.teamId })
    if (state.team.archivedAt !== undefined
      || state.team.phase === 'completed'
      || state.team.phase === 'failed'
      || state.team.phase === 'cancelled') {
      throw new TeamRunError(`Team '${request.teamId}' is not resumable from phase '${state.team.phase}'`, 'TEAM_RUN_NOT_FOUND')
    }
    let resumableState = state
    const human = request.humanOwner === undefined
      ? requiredRoleParticipant(resumableState, 'human')
      : resumableState.participants.find(participant => (
        participant.kind === 'human'
        && participant.phase === 'active'
        && participant.role === 'human'
        && participant.owner?.kind === 'product-principal'
        && participant.owner.principalId === request.humanOwner?.principalId
      ))
    if (human === undefined) {
      throw new TeamRunError(
        `Team '${request.teamId}' has no active human participant for the authenticated product owner`,
        'TEAM_RUN_NOT_FOUND',
      )
    }
    const coordinator = requiredRoleParticipant(resumableState, 'coordinator')
    const workers = workerParticipants(resumableState)
    const worker = workers.find(participant => participant.role === 'worker')
    const memberSpecs = retainedTemplateMembers(resumableState)
    const members = memberSpecs.map(spec => requiredRoleParticipant(resumableState, spec.role))
    let binding = resumableState.activations.find(item => item.activation.participantId === coordinator.id)
    if (binding === undefined) {
      throw new TeamRunError(`Team '${request.teamId}' has no durable coordinator activation`, 'TEAM_RUN_NOT_QUIESCENT')
    }
    if (binding.activation.status !== 'offline') {
      throw new TeamRunError(
        `Team '${request.teamId}' coordinator activation '${binding.activation.id}' is still ${binding.activation.status}`,
        'TEAM_RUN_START_CONFLICT',
      )
    }
    const channel = await this.defaultChannel(resumableState, human.id, coordinator.id)
    const persistence = this.ctx.get('sessionPersistence') as SessionPersistenceReader | undefined
    if (persistence === undefined) {
      throw new TeamRunError('Team resume requires a mounted Session persistence provider', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const inspected = await persistence.inspect(binding.sessionId, request.signal)
    if (inspected.meta.teamId !== String(request.teamId) || inspected.meta.participantId !== String(coordinator.id)) {
      throw new TeamRunError(
        `Session '${binding.sessionId}' does not belong to Team coordinator '${coordinator.id}'`,
        'TEAM_RUN_NOT_QUIESCENT',
      )
    }
    const selection = request.selection ?? latestRequestSelection(inspected.events) ?? this.ctx.agentDefaultModel.currentSelection()
    if (selection === undefined) {
      throw new TeamRunError('a persisted coordinator model route is required to resume the Team', 'TEAM_RUN_MODEL_REQUIRED')
    }
    const options = coordinatorOptions(selection, request.maxTokens)
    const cwd = request.cwd ?? inspected.meta.cwd
    if (cwd === undefined) {
      throw new TeamRunError(`Session '${binding.sessionId}' has no persisted coordinator cwd`, 'TEAM_RUN_NOT_QUIESCENT')
    }
    if (authorization !== undefined) {
      await this.ctx.teamActivations.preflightResume({
        teamId: request.teamId,
        participantId: coordinator.id,
        activationId: binding.activation.id,
        provider: binding.provider,
        sessionId: binding.sessionId,
        authorization,
      })
    }
    let lease: TeamActivationLease | undefined
    let disposePrompt: (() => void) | undefined
    const memberStates = new Map<ParticipantId, WorkerState>()
    try {
      await authorization?.assert()
      if (resumableState.team.phase === 'stalled') {
        resumableState = await this.resumeStalledTeam(resumableState, authorization)
      }
      if (binding.recovery !== undefined && binding.quiescedAt === undefined) {
        lease = await this.ctx.teamActivations.coldReplace({
          teamId: request.teamId,
          participantId: coordinator.id,
          activationId: binding.activation.id,
          signal: request.signal ?? new AbortController().signal,
          ...authorization === undefined ? {} : { authorization },
        })
        const replaced = (await this.ctx.teams.getTeam({ teamId: request.teamId })).activations
          .find(item => item.activation.participantId === coordinator.id && item.activation.status !== 'offline')
        if (replaced === undefined) throw new TeamRunError('cold-replaced coordinator activation was not durably published', 'TEAM_RUN_NOT_QUIESCENT')
        binding = replaced
      } else {
        lease = await this.ctx.teamActivations.activate({
          teamId: request.teamId,
          participantId: coordinator.id,
          expectedCursor: resumableState.team.cursor,
          provider: binding.provider,
          sessionId: binding.sessionId,
          seed: { kind: 'resume' },
          agent: {
            cwd,
            options,
            ...request.preset === undefined && inspected.meta.agentPreset === undefined
              ? {}
              : { preset: request.preset ?? inspected.meta.agentPreset },
          },
          signal: request.signal ?? new AbortController().signal,
          ...authorization === undefined ? {} : { authorization },
        })
      }
      if (lease.localAgent === undefined) {
        throw new TeamRunError('the resumed coordinator activation did not publish a local Agent', 'TEAM_RUN_NOT_QUIESCENT')
      }
      await authorization?.assert()
      const admissionSignal = request.signal === undefined ? this.admissionAbort.signal
        : AbortSignal.any([request.signal, this.admissionAbort.signal])
      await this.admitHumanEndpoint(channel, human, request.admitHumanChannel, admissionSignal)
      await this.ctx.teamChannelAdmission.waitUntilActive({ channelId: channel.manifest.id, signal: admissionSignal })
      disposePrompt = coordinatorPrompt(lease.localAgent, channel.manifest.id, this.config.finalPromptOrder, this.config.maxWorkerCount)
      for (const spec of memberSpecs) {
        const participant = members.find(member => member.role === spec.role) as ParticipantSnapshot
        memberStates.set(participant.id, await this.activateTemplateMember(request.teamId, participant, spec,
          cwd, request.signal ?? this.admissionAbort.signal, this.config.workerPromptOrder))
      }
      const handle: TeamRunHandle = Object.freeze({
        members: Object.freeze(members),
        teamId: request.teamId,
        team: resumableState.team,
        recipient: human,
        coordinator,
        worker,
        workers: Object.freeze([...workers]),
        channel,
        coordinatorLease: lease,
      })
      const workerAgents = new Map(workers.map((participant) => {
        const workerBinding = resumableState.activations.find(item => item.activation.participantId === participant.id)
        return [participant.id, {
          cwd,
          options,
          ...this.config.workerPreset === undefined ? {} : { preset: this.config.workerPreset },
          ...workerBinding === undefined ? {} : { sessionId: workerBinding.sessionId },
        } satisfies WorkerAgentSpec]
      }))
      const workerAgent: WorkerAgentSpec = worker === undefined
        ? { cwd, options, ...this.config.workerPreset === undefined ? {} : { preset: this.config.workerPreset } }
        : workerAgents.get(worker.id) as WorkerAgentSpec
      const run: RunState = {
        config: this.config,
        memberStates,
        handle,
        disposePrompt,
        defaultWorkerTaskIds: new Set(resumableState.tasks.flatMap(task =>
          task.workflowPlanId === undefined && task.createCommand.creator.participantId === coordinator.id ? [task.id] : [])),
        workflowPlanIds: new Set((resumableState.workflowPlans ?? []).flatMap(plan =>
          plan.actor?.participantId === coordinator.id ? [plan.id] : [])),
        workerAgent,
        workerAgents,
        workers: [...workers],
        targetWorkerCount: workers.length,
        minimumWorkerCount: workers.length === 0 ? 0 : 1,
        workerStates: new Map(),
        workerActivations: new Map(),
        workerPoolMutation: Promise.resolve(),
        coordinatorOutputContinuations: 0,
        topologyReleased: false,
      }
      this.runs.set(request.teamId, run)
      this.mintFinalReceiptProof(run)
      this.mintEnvelopePostProof(run)
      if (resumableState.tasks.some((task) => {
        const policy = task.reviewPolicy
        return task.phase === 'review' && policy.kind === 'participant'
          && resumableState.participants.find(participant => participant.id === policy.reviewerId)?.role === 'reviewer'
      })) {
        try {
          await authorization?.assert()
          await this.ensureReviewer(run)
          await authorization?.assert()
        } catch (error: unknown) {
          this.runs.delete(request.teamId)
          await this.releaseRun(run).catch(() => {})
          throw error
        }
      }
      return handle
    } catch (error: unknown) {
      disposePrompt?.()
      const cleanup = await Promise.allSettled([...memberStates.values()].map(async (member) => {
        member.disposePrompt()
        await member.lease.dispose()
      }))
      if (lease !== undefined) await lease.dispose().catch(() => {})
      const failures = cleanup.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length > 0) throw new AggregateError([error, ...failures], 'Template member resume cleanup failed')
      throw error
    }
  }

  /**
   * Wait for durable Team quiescence without assuming a local coordinator owner.
   * @param teamId - Team identity to inspect.
   * @param signal - optional cancellation for the local wait.
   * @returns the latest quiescence diagnostics.
   */
  async waitForQuiescence(teamId: TeamId, signal?: AbortSignal): Promise<TeamQuiescenceSnapshot> {
    for (;;) {
      if (signal?.aborted) throw signal.reason
      const state = await this.ctx.teams.getTeam({ teamId })
      const snapshot = await this.ctx.teams.inspectQuiescence(teamId)
      if (snapshot.quiescent || state.team.phase === 'stalled' || state.team.phase === 'failed' || state.team.phase === 'cancelled') return snapshot
      const watched = await this.ctx.teams.watchTeam({ teamId, afterCursor: state.team.cursor, ...signal === undefined ? {} : { signal } })
      if (watched.kind === 'closed') return await this.ctx.teams.inspectQuiescence(teamId)
      assertTeamWatchAdvance(watched, state.team.cursor, 'quiescence wait')
    }
  }

  /**
   * Create the default topology and admit its first human Envelope. Retries
   * with the same key return the same accepted result while this local owner lives.
   * @param request - topology inputs, first human content, and retry identity.
   * @returns the created topology plus its accepted first human Envelope.
   */
  async start(request: TeamRunStartRequest): Promise<TeamRunStartResult> {
    this.assertOpen()
    const fingerprint = startFingerprint(request)
    const existing = this.starts.get(request.idempotencyKey)
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        throw new TeamRunError(
          `Team start key '${request.idempotencyKey}' was already used with a different request`,
          'TEAM_RUN_START_CONFLICT',
        )
      }
      return await existing.result
    }
    const deferred = Promise.withResolvers<TeamRunStartResult>()
    const state: StartState = { fingerprint, result: deferred.promise }
    this.starts.set(request.idempotencyKey, state)
    void (async (): Promise<void> => {
      let handle: TeamRunHandle | undefined
      try {
        handle = await this.create(request)
        state.teamId = handle.teamId
        const input = await this.postHumanInput({
          teamId: handle.teamId,
          content: request.content,
          idempotencyKey: request.idempotencyKey,
          ...request.delivery === undefined ? {} : { delivery: request.delivery },
        })
        deferred.resolve(Object.freeze({ handle, input }))
      } catch (error: unknown) {
        if (handle !== undefined) {
          await this.cancel(handle.teamId).catch(() => {
            // Best-effort cleanup cannot replace the failed start result.
          })
        }
        this.starts.delete(request.idempotencyKey)
        deferred.reject(error)
      }
    })()
    return await state.result
  }

  /**
   * Append trusted human content only after the default topology and coordinator
   * residency have committed.
   * @param request - Team identity, human content, and requested delivery intent.
   * @returns the immutable channel Envelope accepted by the Team Hub.
   */
  async postHumanInput(request: TeamRunHumanInputRequest): Promise<TeamEnvelope> {
    const state = this.requireRun(request.teamId)
    if (state.handle.recipient.kind !== 'human') throw new TeamRunError('Child input belongs to its parent service', 'TEAM_RUN_NOT_FOUND')
    this.assertHumanOwner(state, request.humanOwner)
    await this.ctx.teamChannelAdmission.waitUntilActive({ channelId: state.handle.channel.manifest.id, signal: this.admissionAbort.signal })
    let attempt = 0
    while (true) {
      const channel = await this.ctx.teams.getChannel({ channelId: state.handle.channel.manifest.id })
      try {
        return await this.ctx.teams.postChannelEnvelope({
          actor: this.requireEnvelopePostProof(state),
          expectedCursor: channel.cursor,
          draft: {
            channelId: channel.manifest.id,
            audience: [state.handle.coordinator.id],
            kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
            payload: { content: request.content as unknown as JsonValue },
            delivery: request.delivery ?? 'turn',
          },
          ...request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey },
        })
      } catch (error: unknown) {
        attempt += 1
        if (!isChannelCursorConflict(error) || attempt === state.config.humanInputRetryAttempts) throw error
      }
    }
  }

  /**
   * Request one soft interrupt from this TeamRun's durable human participant
   * to its current local coordinator. A non-active Team has no interruptable
   * product run, so this returns `undefined` without touching the Hub.
   * @param teamId - current locally owned Team run selected by ACP.
   * @returns the committed interrupt, or `undefined` when the Team is no longer active.
   */
  async requestCoordinatorInterrupt(teamId: TeamId): Promise<ParticipantInterruptSnapshot | undefined> {
    const state = this.requireRun(teamId)
    const current = await this.ctx.teams.getTeam({ teamId })
    if (current.team.phase !== 'active') return undefined
    return await this.withCoordinatorInterruptProof(state, async actor =>
      await this.ctx.teams.requestParticipantInterrupt({
        actor,
        teamId,
        expectedCursor: current.team.cursor,
      }))
  }

  /**
   * Mint a capability for one exact local coordinator without exposing Team,
   * participant, activation, or Session identity to its consumer.
   * @param coordinator - current local coordinator Agent selected by a scoped consumer.
   * @returns an opaque capability accepted only while this exact coordinator remains current.
  */
  coordinatorTaskAuthority(coordinator: Agent): TeamRunCoordinatorTaskAuthority {
    this.assertOpen()
    const retained = this.mintCoordinatorAuthority(coordinator, 'default-worker task creation')
    const authority = Object.freeze({ [coordinatorTaskAuthorityToken]: undefined }) as TeamRunCoordinatorTaskAuthority
    this.coordinatorTaskAuthorities.set(authority, retained)
    return authority
  }

  /**
   * Set the coordinator's desired local worker-pool size and reconcile durable
   * worker Participants. Requests above the deployment ceiling are clamped and
   * returned as saturated capacity so a coordinator can keep queueing work.
   * @param authority - opaque capability for the exact current coordinator.
   * @param request - requested worker count, including the default `worker` slot.
   * @returns bounded pool and queued-task status after reconciliation.
   */
  async setWorkerPoolSize(
    authority: TeamRunCoordinatorTaskAuthority,
    request: TeamRunWorkerPoolSetRequest,
  ): Promise<TeamRunWorkerPoolStatus> {
    const retained = await this.requireCoordinatorTaskControlAuthority(authority)
    const requestedCount = request.targetCount
    if (!Number.isSafeInteger(requestedCount) || requestedCount < 0) {
      throw new TeamRunError('worker pool target must be a non-negative safe integer', 'TEAM_RUN_INVALID_WORKER_POOL')
    }
    const state = retained.state
    return await this.enqueueWorkerPoolMutation(state, async () => {
      const targetCount = Math.min(requestedCount, state.config.maxWorkerCount)
      state.minimumWorkerCount = Math.min(state.minimumWorkerCount, targetCount)
      state.targetWorkerCount = targetCount
      let capacityLimited = requestedCount > targetCount
      const topologyCapacityLimited = await this.ensureWorkerPoolWithRetries(state, targetCount)
      capacityLimited = capacityLimited || topologyCapacityLimited
      await this.retireExcessWorkersWithRetries(state)
      return await this.workerPoolStatus(state, requestedCount, capacityLimited)
    })
  }

  /**
   * Mint a capability for an exact local coordinator, or leave ordinary Agents outside the scoped Team-goal tools.
   * @param coordinator - candidate current local coordinator Agent selected by a scoped consumer.
   * @returns an opaque capability, or `undefined` when the Agent owns no current default Team run.
   */
  tryCoordinatorGoalAuthority(coordinator: Agent): TeamRunCoordinatorGoalAuthority | undefined {
    this.assertOpen()
    const state = [...this.runs.values()].find(run => run.handle.coordinatorLease.localAgent === coordinator)
    if (state === undefined || state.handle.team.parentTeamId !== undefined || this.ctx.agents.get(coordinator.id) !== coordinator) return undefined
    const authority = Object.freeze({ [coordinatorGoalAuthorityToken]: undefined }) as TeamRunCoordinatorGoalAuthority
    this.coordinatorGoalAuthorities.set(authority, { state, coordinator })
    return authority
  }

  /**
   * Read the durable objective visible to the exact current coordinator.
   * @param authority - opaque capability minted for the exact current coordinator.
   * @returns the current detached Team objective.
   */
  async readCoordinatorGoal(authority: TeamRunCoordinatorGoalAuthority): Promise<TeamGoalSnapshot> {
    const retained = await this.requireCoordinatorGoalAuthority(authority)
    return (await this.ctx.teams.getTeam({ teamId: retained.state.handle.teamId })).goal
  }

  /**
   * Compare-and-set the durable objective from an active coordinator turn carrying its trusted human input.
   * @param authority - opaque capability minted for the exact current coordinator.
   * @param request - observed revision and replacement objective.
   * @returns the committed detached Team objective.
   */
  async updateCoordinatorGoal(
    authority: TeamRunCoordinatorGoalAuthority,
    request: TeamRunCoordinatorGoalUpdateRequest,
  ): Promise<TeamGoalSnapshot> {
    const retained = await this.requireCoordinatorGoalAuthority(authority)
    this.assertHumanDirectGoalInput(retained.state, retained.coordinator)
    return await this.withCoordinatorActorProof(retained, async actor =>
      (await this.ctx.teams.updateTeamGoal({
        teamId: retained.state.handle.teamId,
        actor,
        expectedRevision: request.expectedRevision,
        objective: request.objective,
      })).goal)
  }

  /**
   * Compare-and-set the durable objective phase from an exact coordinator activation.
   * @param authority - opaque capability for the current coordinator.
   * @param request - expected revision, next phase, and optional blocker.
   * @returns the committed durable objective.
   */
  async transitionCoordinatorGoalPhase(
    authority: TeamRunCoordinatorGoalAuthority,
    request: TeamRunCoordinatorGoalPhaseRequest,
  ): Promise<TeamGoalSnapshot> {
    const retained = await this.requireCoordinatorGoalAuthority(authority)
    this.assertHumanDirectGoalInput(retained.state, retained.coordinator)
    return await this.withCoordinatorActorProof(retained, async actor =>
      (await this.ctx.teams.transitionTeamGoalPhase({
        teamId: retained.state.handle.teamId,
        actor,
        expectedRevision: request.expectedRevision,
        phase: request.phase,
        ...request.blocker === undefined ? {} : { blocker: request.blocker },
      })).goal)
  }

  /**
   * Lazily activate the default worker and create one bounded scheduler-owned task.
   * @param authority - opaque capability minted for the exact current coordinator.
   * @param request - caller retry key and durable task fields.
   * @returns the accepted or replayed task's compact durable identity.
   */
  async startDefaultWorkerTask(
    authority: TeamRunCoordinatorTaskAuthority,
    request: TeamRunDefaultWorkerTaskStartRequest,
  ): Promise<TeamRunDefaultWorkerTask> {
    const state = await this.requireCoordinatorTaskAuthority(authority)
    if (state.config.maxWorkerCount === 0) {
      throw new TeamRunError('This Team configuration does not permit worker tasks', 'TEAM_RUN_INVALID_WORKER_POOL')
    }
    return await this.enqueueWorkerPoolMutation(state, async () => {
      await this.prepareWorkerCapacity(state, request.idempotencyKey)
      const task = await this.createDefaultWorkerTask(state, {
        createCommand: {
          idempotencyKey: request.idempotencyKey,
        },
        subject: request.subject,
        instructions: request.instructions,
        readScopes: request.readScopes,
        writeScopes: request.writeScopes,
      })
      state.defaultWorkerTaskIds.add(task.id)
      return defaultWorkerTaskValue(task)
    })
  }

  /**
   * Admit one child-Team task under the current coordinator's narrowed authority.
   * @param authority - Opaque authority of this Team's current coordinator.
   * @param request - Durable objective, requested scopes and budget, and optional complete template identity.
   * @returns The accepted or replayed parent task; its Consumer owns child startup.
   */
  async startDelegatedTask(
    authority: TeamRunCoordinatorTaskAuthority,
    request: TeamRunDelegatedTaskStartRequest,
  ): Promise<TeamRunDefaultWorkerTask> {
    const retained = await this.requireCoordinatorTaskControlAuthority(authority)
    const { state } = retained
    if ((request.templateId === undefined) !== (request.templateVersion === undefined)) {
      throw new TeamError('Child template id and version must be selected together', 'TEAM_INVALID_ARGUMENT')
    }
    const templateId = request.templateId ?? state.config.templateId
    const templateVersion = request.templateVersion ?? state.config.templateVersion
    this.describeChildTemplate(templateId, templateVersion)
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt++) {
      try {
        const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
        if (current.team.depth >= current.team.maxTeamDepth) {
          throw new TeamError(`Team '${current.team.id}' has reached its child-Team depth limit`, 'TEAM_DELEGATION_INVALID')
        }
        const coordinator = current.participants.find(member => member.id === state.handle.coordinator.id)
        const sourceGrant = coordinator?.authorityGrant ?? current.team.authorityGrant
        if (sourceGrant === undefined) throw new TeamError('Coordinator delegation authority is unavailable', 'TEAM_GRANT_DENIED')
        const authorityGrant: TeamAuthorityGrant = { ...sourceGrant, workspaceModes: ['shared'],
          readScopes: [...request.readScopes], writeScopes: [...request.writeScopes], budgets: { ...request.budget } }
        const task = await this.withCoordinatorActorProof(retained, actor => this.ctx.teams.createTask({
          actor, teamId: state.handle.teamId, expectedCursor: current.team.cursor,
          createCommand: { idempotencyKey: request.idempotencyKey }, subject: request.subject, description: request.instructions,
          execution: { kind: 'child-team', templateId, templateVersion, authorityGrant, budget: { ...request.budget } },
          blockedBy: [], requiredCapabilities: [], priority: state.config.workerTaskPriority,
          readScopes: request.readScopes, writeScopes: request.writeScopes, workspaceMode: 'shared', budget: { ...request.budget },
          reviewPolicy: { kind: 'none' }, maxAttempts: 1,
        }))
        state.defaultWorkerTaskIds.add(task.id)
        return defaultWorkerTaskValue(task)
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) || attempt + 1 === state.config.receiptRetryAttempts) throw error
      }
    }
    throw new TeamRunError('Child task admission exhausted its Team cursor retries', 'TEAM_RUN_NOT_QUIESCENT')
  }

  /**
   * Wait for one task previously accepted through this coordinator authority.
   * @param authority - opaque capability minted for the exact current coordinator.
   * @param request - owned task identity and optional local wait cancellation.
   * @returns the task's terminal result or retained terminal attempt fact.
   */
  async waitForDefaultWorkerTask(
    authority: TeamRunCoordinatorTaskAuthority,
    request: TeamRunDefaultWorkerTaskWaitRequest,
  ): Promise<TeamRunDefaultWorkerTaskTerminal> {
    while (true) {
      const state = await this.requireCoordinatorTaskAuthority(authority)
      this.requireDefaultWorkerTask(state, request.taskId)
      if (request.signal?.aborted) throw request.signal.reason
      const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
      const task = current.tasks.find(candidate => candidate.id === request.taskId)
      if (task === undefined) {
        throw new TeamRunError(`default-worker task '${request.taskId}' is no longer available`, 'TEAM_RUN_COORDINATOR_INVALID')
      }
      this.requireDefaultWorkerTask(state, task.id, task)
      const terminal = terminalDefaultWorkerTask(task)
      if (terminal !== undefined) {
        if (task.execution.kind === 'participant') await this.enqueueWorkerPoolMutation(state, async () => {
          await this.reconcileWorkerPool(state)
        })
        return terminal
      }
      const watched = await this.ctx.teams.watchTeam({
        teamId: state.handle.teamId,
        afterCursor: current.team.cursor,
        ...request.signal === undefined ? {} : { signal: request.signal },
      })
      if (watched.kind === 'closed') {
        throw new TeamRunError(`Team '${state.handle.teamId}' closed before default-worker task '${task.id}' settled`, 'TEAM_RUN_NOT_QUIESCENT')
      }
      assertTeamWatchAdvance(watched, current.team.cursor, `default-worker task '${task.id}' wait`)
    }
  }

  /**
   * List compact task state owned by the exact current coordinator.
   * @param authority - opaque capability for the exact current coordinator.
   * @returns the current bounded list of non-workflow default-worker tasks.
   */
  async listDefaultWorkerTasks(authority: TeamRunCoordinatorTaskAuthority): Promise<TeamRunDefaultWorkerTaskList> {
    const state = await this.requireCoordinatorTaskAuthority(authority)
    const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    return Object.freeze({ tasks: Object.freeze(defaultWorkerTaskValues(state, current.tasks)) })
  }

  /**
   * Set or clear an advisory owner proposal for one pending coordinator-owned task.
   * @param authority - opaque capability for the exact current coordinator.
   * @param request - owned task identity and optional preferred Participant.
   * @returns the task phase and retained scheduler hint after the CAS.
   */
  async proposeDefaultWorkerTaskOwner(
    authority: TeamRunCoordinatorTaskAuthority,
    request: TeamRunDefaultWorkerTaskOwnerProposalRequest,
  ): Promise<TeamRunDefaultWorkerTaskOwnerProposal> {
    const retained = await this.requireCoordinatorTaskControlAuthority(authority)
    const { state, coordinator } = retained
    this.requireDefaultWorkerTask(state, request.taskId)
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      const current = await this.ctx.teams.getTask({ teamId: state.handle.teamId, taskId: request.taskId })
      this.requireDefaultWorkerTask(state, request.taskId, current)
      if (current.phase !== 'pending') {
        throw new TeamRunError(`default-worker task '${current.id}' cannot receive an owner proposal from '${current.phase}'`, 'TEAM_RUN_NOT_QUIESCENT')
      }
      try {
        const scope: TeamSystemTaskControlScope = Object.freeze({
          kind: 'team-run-default-worker-owner-proposal',
          teamId: state.handle.teamId,
          coordinator: activationActor(state.handle.coordinatorLease.binding),
          taskId: current.id,
          expectedRevision: current.revision,
          ...request.proposedOwnerId === undefined ? {} : { proposedOwnerId: request.proposedOwnerId },
        })
        const proposed = await this.withTaskControlProof(state, coordinator, scope, async actor =>
          await this.ctx.teams.proposeTaskOwner({
            actor,
            teamId: state.handle.teamId,
            taskId: current.id,
            expectedRevision: current.revision,
            ...request.proposedOwnerId === undefined ? {} : { proposedOwnerId: request.proposedOwnerId },
          }))
        return Object.freeze({
          id: proposed.id,
          phase: proposed.phase,
          ...proposed.proposedOwnerId === undefined ? {} : { proposedOwnerId: proposed.proposedOwnerId },
        })
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) && !(error instanceof TeamError && error.code === 'TEAM_TASK_STALE_REVISION')) throw error
      }
    }
    throw new TeamRunError('default-worker task owner proposal exhausted its Team cursor retries', 'TEAM_RUN_NOT_QUIESCENT')
  }

  /**
   * Wait for a Team cursor advance, then return the bounded owned-task snapshot.
   * This observes unrelated Team changes too; the returned cursor lets the
   * coordinator establish the next no-gap watch.
   * @param authority - opaque capability for the exact current coordinator.
   * @param request - last observed cursor and local cancellation.
   * @returns the current cursor and compact owned-task state.
   */
  async watchDefaultWorkerTasks(
    authority: TeamRunCoordinatorTaskAuthority,
    request: TeamRunDefaultWorkerTaskWatchRequest = {},
  ): Promise<TeamRunDefaultWorkerTaskWatch> {
    const state = await this.requireCoordinatorTaskAuthority(authority)
    const afterCursor = request.afterCursor ?? -1
    while (true) {
      if (request.signal?.aborted) throw request.signal.reason
      const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
      if (current.team.cursor > afterCursor) {
        return Object.freeze({ cursor: current.team.cursor, tasks: Object.freeze(defaultWorkerTaskValues(state, current.tasks)) })
      }
      const watched = await this.ctx.teams.watchTeam({
        teamId: state.handle.teamId,
        afterCursor: current.team.cursor,
        ...request.signal === undefined ? {} : { signal: request.signal },
      })
      if (watched.kind === 'closed') {
        const closed = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
        return Object.freeze({ cursor: closed.team.cursor, tasks: Object.freeze(defaultWorkerTaskValues(state, closed.tasks)) })
      }
      assertTeamWatchAdvance(watched, current.team.cursor, 'default-worker task watch')
    }
  }

  /**
   * Request cancellation of one coordinator-owned task through the durable Team CAS.
   * @param authority - opaque capability for the exact current coordinator.
   * @param request - owned task identity.
   * @returns accepted stop progress, or an unchanged terminal task.
   */
  async cancelDefaultWorkerTask(
    authority: TeamRunCoordinatorTaskAuthority,
    request: TeamRunDefaultWorkerTaskCancelRequest,
  ): Promise<TeamRunDefaultWorkerTask> {
    const retained = await this.requireCoordinatorTaskControlAuthority(authority)
    const { state, coordinator } = retained
    this.requireDefaultWorkerTask(state, request.taskId)
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      const current = await this.ctx.teams.getTask({ teamId: state.handle.teamId, taskId: request.taskId })
      this.requireDefaultWorkerTask(state, request.taskId, current)
      if (current.phase === 'completed' || current.phase === 'failed' || current.phase === 'cancelled' || current.phase === 'deleted') {
        return defaultWorkerTaskValue(current)
      }
      try {
        const scope: TeamSystemTaskControlScope = Object.freeze({
          kind: 'team-run-default-worker-cancel',
          teamId: state.handle.teamId,
          coordinator: activationActor(state.handle.coordinatorLease.binding),
          taskId: current.id,
          expectedRevision: current.revision,
          ...request.reason === undefined ? {} : { reason: request.reason },
        })
        const cancelled = await this.withTaskControlProof(state, coordinator, scope, async actor =>
          await this.ctx.teams.cancelTask({
            actor,
            teamId: state.handle.teamId,
            taskId: current.id,
            expectedRevision: current.revision,
            ...request.reason === undefined ? {} : { reason: request.reason },
          }))
        return defaultWorkerTaskValue(cancelled)
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) && !(error instanceof TeamError && error.code === 'TEAM_TASK_STALE_REVISION')) throw error
      }
    }
    throw new TeamRunError('default-worker task cancellation exhausted its Team cursor retries', 'TEAM_RUN_NOT_QUIESCENT')
  }

  /**
   * Validate and durably compile one declarative workflow plan. Compilation is
   * retry-safe: the plan, each task binding, and the workflow channel are all
   * recovered from Team records rather than inferred from model code.
   * @param authority - opaque capability minted for the exact coordinator.
   * @param request - complete plan, retry identity, and optional local cancellation.
   * @returns the ready or already-terminal durable workflow plan.
   */
  async startWorkflowPlan(
    authority: TeamRunCoordinatorTaskAuthority,
    request: TeamRunWorkflowPlanStartRequest,
  ): Promise<TeamWorkflowPlanSnapshot> {
    const state = await this.requireCoordinatorTaskAuthority(authority)
    const plan = parseWorkflowPlan(request.plan)
    if (plan.channel.viewPolicy === undefined) {
      throw workflowInvalid('workflow channel requires an explicit model view policy in channel.viewPolicy')
    }
    const fingerprint = JSON.stringify(plan)
    const existing = this.workflowStarts.get(request.idempotencyKey)
    if (existing !== undefined) {
      if (existing.teamId !== state.handle.teamId || existing.fingerprint !== fingerprint) {
        throw new TeamRunError(
          `workflow plan key '${request.idempotencyKey}' was already used by another Team or with different plan fields`,
          'TEAM_RUN_START_CONFLICT',
        )
      }
      return await existing.result
    }
    const deferred = Promise.withResolvers<TeamWorkflowPlanSnapshot>()
    const workflowStart: WorkflowStartState = { fingerprint, result: deferred.promise }
    workflowStart.teamId = state.handle.teamId
    this.workflowStarts.set(request.idempotencyKey, workflowStart)
    void (async (): Promise<void> => {
      try {
        const compiled = await this.compileWorkflowPlan(state, {
          idempotencyKey: request.idempotencyKey,
          plan,
          ...request.signal === undefined ? {} : { signal: request.signal },
        })
        state.workflowPlanIds.add(compiled.id)
        deferred.resolve(compiled)
      } catch (error: unknown) {
        this.workflowStarts.delete(request.idempotencyKey)
        deferred.reject(error)
      }
    })()
    return await deferred.promise
  }

  /**
   * Cancel one exact task binding owned by the current coordinator's workflow.
   * @param authority - current coordinator capability.
   * @param request - plan/template selection and optional cancellation reason.
   * @returns task stop progress; independent workflow tasks remain available.
   */
  async cancelWorkflowTask(
    authority: TeamRunCoordinatorTaskAuthority,
    request: TeamRunWorkflowTaskCancelRequest,
  ): Promise<TeamRunWorkflowTaskCancelResult> {
    const { state, coordinator } = await this.requireCoordinatorTaskControlAuthority(authority)
    this.requireWorkflowPlan(state, request.planId)
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      const plan = await this.ctx.teams.getWorkflowPlan({ teamId: state.handle.teamId, planId: request.planId })
      const binding = plan.taskBindings.find(candidate => candidate.templateId === request.templateId)
      if (binding === undefined) throw workflowInvalid(`workflow template '${request.templateId}' is not bound`)
      const task = await this.ctx.teams.getTask({ teamId: state.handle.teamId, taskId: binding.taskId })
      if (task.workflowPlanId !== plan.id || task.workflowTemplateId !== binding.templateId) throw workflowInvalid('workflow task binding changed')
      const value = (current: TeamTaskSnapshot): TeamRunWorkflowTaskCancelResult => ({
        ...defaultWorkerTaskValue(current), planId: plan.id, templateId: binding.templateId,
        blockedByOutcome: current.blockedByOutcome ?? null,
      })
      if (isWorkflowTaskTerminal(task.phase)) return value(task)
      try {
        const input = { teamId: state.handle.teamId, taskId: task.id, expectedRevision: task.revision,
          ...request.reason === undefined ? {} : { reason: request.reason } }
        return value(await this.withTaskControlProof(state, coordinator, {
          kind: 'team-run-workflow-task-cancel', coordinator: activationActor(state.handle.coordinatorLease.binding), planId: plan.id, ...input,
        }, async actor => await this.ctx.teams.cancelTask({ actor, ...input })))
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) && !(error instanceof TeamError && error.code === 'TEAM_TASK_STALE_REVISION')) throw error
      }
    }
    throw workflowInvalid('workflow task cancellation exhausted its revision retries')
  }

  /**
   * Wait for all bound tasks to settle and read the Hub-owned terminal result.
   * @param authority - opaque capability minted for the exact coordinator.
   * @param request - owned workflow plan identity and local wait cancellation.
   * @returns the durable workflow terminal phase and projected task results.
   */
  async waitForWorkflowPlan(
    authority: TeamRunCoordinatorTaskAuthority,
    request: TeamRunWorkflowPlanWaitRequest,
  ): Promise<TeamRunWorkflowPlanTerminal> {
    while (true) {
      const state = await this.requireCoordinatorTaskAuthority(authority)
      this.requireWorkflowPlan(state, request.planId)
      if (request.signal?.aborted) throw request.signal.reason
      const team = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
      let plan = team.workflowPlans?.find(candidate => candidate.id === request.planId)
      if (plan === undefined) throw workflowInvalid(`workflow plan '${request.planId}' is not retained by its Team`)
      if (plan.phase === 'compiling') {
        plan = await this.compileWorkflowPlan(state, {
          idempotencyKey: plan.idempotencyKey,
          plan: plan.plan,
          ...request.signal === undefined ? {} : { signal: request.signal },
          planId: plan.id,
        })
        continue
      }
      if (plan.phase === 'completed') return { id: plan.id, phase: plan.phase, result: plan.result as TeamWorkflowPlanResult }
      if (plan.phase === 'failed') return { id: plan.id, phase: plan.phase, failure: plan.failure as NonNullable<TeamWorkflowPlanSnapshot['failure']>,
        ...plan.result === undefined ? {} : { result: plan.result } }
      if (plan.phase === 'cancelled') return { id: plan.id, phase: plan.phase,
        ...plan.cancellation === undefined ? {} : { cancellation: plan.cancellation },
        ...plan.result === undefined ? {} : { result: plan.result } }
      const watched = await this.ctx.teams.watchTeam({
        teamId: state.handle.teamId,
        afterCursor: team.team.cursor,
        ...request.signal === undefined ? {} : { signal: request.signal },
      })
      if (watched.kind === 'closed') {
        throw new TeamRunError(`Team '${state.handle.teamId}' closed before workflow plan '${plan.id}' settled`, 'TEAM_RUN_NOT_QUIESCENT')
      }
      assertTeamWatchAdvance(watched, team.team.cursor, `workflow plan '${plan.id}' wait`)
    }
  }

  /** Compile an admitted plan, recovering already durable bindings on every retry. */
  private async compileWorkflowPlan(
    state: RunState,
    request: TeamRunWorkflowPlanStartRequest & { readonly planId?: TeamWorkflowPlanId },
  ): Promise<TeamWorkflowPlanSnapshot> {
    const coordinator = state.handle.coordinatorLease.localAgent
    if (coordinator === undefined) throw new TeamRunError('workflow compilation requires a resident coordinator', 'TEAM_RUN_COORDINATOR_INVALID')
    await this.assertCoordinatorAuthority(state, coordinator, 'workflow plan compilation')
    const order = validateTeamWorkflowPlan(request.plan)
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      let unboundWorkflowChannel: { readonly planId: TeamWorkflowPlanId; readonly channelId: ChannelId } | undefined
      try {
        if (request.signal?.aborted) throw request.signal.reason
        if (request.plan.channel.participantRoles.some(isWorkerRole)) await this.ensureWorkerPool(state, request.signal)
        const reviewerRoles = new Set(request.plan.tasks.flatMap(task =>
          task.reviewPolicy.kind === 'participant' ? [task.reviewPolicy.reviewerRole] : []))
        if (request.plan.channel.participantRoles.includes('reviewer')) reviewerRoles.add('reviewer')
        for (const role of reviewerRoles) {
          if (role === 'reviewer') await this.ensureReviewer(state)
        }
        const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
        const participants = resolveWorkflowParticipants(current, request.plan)
        for (const role of reviewerRoles) requiredWorkflowParticipant(participants, role)
        for (const template of request.plan.tasks) {
          if (template.workspaceMode !== 'shared') {
            const workspaces = this.ctx.get('teamWorkspaces')
            if (workspaces === undefined) {
              throw workflowInvalid(`workflow task '${template.id}' has no provider for workspace mode '${template.workspaceMode}'`)
            }
            try {
              workspaces.resolve(template.workspaceMode)
            } catch (error: unknown) {
              throw workflowInvalid(`workflow task '${template.id}' has no provider for workspace mode '${template.workspaceMode}': ${errorMessage(error)}`)
            }
          }
          if (![...participants.values()].some(participant => participant.id !== state.handle.coordinator.id
            && (participant.kind === 'local-agent' || participant.kind === 'remote-agent')
            && template.requiredCapabilities.every(capability => participant.capabilities.includes(capability)))) {
            throw workflowInvalid(`workflow task '${template.id}' has no capable declared execution participant`)
          }
        }
        const resolver = workflowExtensionResolver(this.ctx)
        const graph = materializeWorkflowGraph(request.plan.channel.graph, participants)
        try {
          parseTransitionGraph(graph, resolver)
        } catch (error: unknown) {
          throw workflowInvalid(errorMessage(error))
        }

        let plan = request.planId === undefined
          ? await this.admitWorkflowPlanWithRetry(state, request, coordinator)
          : await this.ctx.teams.getWorkflowPlan({ teamId: state.handle.teamId, planId: request.planId })
        if (!sameWorkflowPlan(plan.plan, request.plan) || (request.planId !== undefined && plan.id !== request.planId)) {
          throw workflowInvalid(`workflow plan '${plan.id}' does not match the requested immutable plan`)
        }
        state.workflowPlanIds.add(plan.id)
        if (plan.phase !== 'compiling') return plan

        const teamBeforeChannel = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
        const channelParticipants = request.plan.channel.participantRoles.map((role) => {
          const participant = participants.get(role)
          if (participant === undefined) throw workflowInvalid(`workflow channel role '${role}' has no active participant`)
          return { id: participant.id, role }
        })
        const channelInput = {
          teamId: state.handle.teamId,
          expectedCursor: teamBeforeChannel.team.cursor,
          adapter: WORKFLOW_CHANNEL_ADAPTER,
          ...request.plan.channel.viewPolicy === undefined ? {} : { viewPolicy: request.plan.channel.viewPolicy },
          workflowPlanId: plan.id,
          expectedPlanRevision: plan.revision,
          participants: channelParticipants,
          limits: { graph },
        }
        const channel = await this.withWorkflowProof(state, coordinator, {
          kind: 'team-run-workflow-channel-open',
          teamId: channelInput.teamId,
          coordinator: this.workflowScopeCoordinator(state),
          planId: plan.id,
          expectedCursor: channelInput.expectedCursor,
          expectedRevision: plan.revision,
          adapter: channelInput.adapter,
          ...channelInput.viewPolicy === undefined ? {} : { viewPolicy: channelInput.viewPolicy },
          participants: channelInput.participants,
          limits: channelInput.limits,
        }, async actor => await this.ctx.teams.openChannel({ actor, ...channelInput }))
        unboundWorkflowChannel = { planId: plan.id, channelId: channel.manifest.id }
        await this.ctx.teamChannelAdmission.waitUntilActive({ channelId: channel.manifest.id,
          signal: request.signal === undefined ? this.admissionAbort.signal
            : AbortSignal.any([request.signal, this.admissionAbort.signal]),
        })
        plan = await this.ctx.teams.getWorkflowPlan({ teamId: state.handle.teamId, planId: plan.id })
        if (plan.channelId === undefined) {
          const afterChannel = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
          plan = await this.withWorkflowProof(state, coordinator, {
            kind: 'team-run-workflow-channel-bind',
            teamId: state.handle.teamId,
            coordinator: this.workflowScopeCoordinator(state),
            planId: plan.id,
            expectedCursor: afterChannel.team.cursor,
            expectedRevision: plan.revision,
            channelId: channel.manifest.id,
          }, async actor => await this.ctx.teams.bindWorkflowPlanChannel({
            actor,
            teamId: state.handle.teamId,
            planId: plan.id,
            expectedCursor: afterChannel.team.cursor,
            expectedRevision: plan.revision,
            channelId: channel.manifest.id,
          }))
        }
        unboundWorkflowChannel = undefined
        for (const template of order) {
          if (request.signal?.aborted) throw request.signal.reason
          plan = await this.ctx.teams.getWorkflowPlan({ teamId: state.handle.teamId, planId: plan.id })
          if (plan.phase !== 'compiling') return plan
          const existing = plan.taskBindings.find(binding => binding.templateId === template.id)
          if (existing !== undefined) continue
          const blockedBy = template.blockedBy.map((dependency) => {
            const binding = plan.taskBindings.find(candidate => candidate.templateId === dependency)
            if (binding === undefined) throw workflowInvalid(`workflow template '${template.id}' is missing dependency binding '${dependency}'`)
            return binding.taskId
          })
          const reviewPolicy = template.reviewPolicy.kind === 'none'
            ? { kind: 'none' as const }
            : { kind: 'participant' as const, reviewerId: requiredWorkflowParticipant(participants, template.reviewPolicy.reviewerRole).id }
          const team = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
          const task = await this.withCoordinatorActorProof({ state, coordinator }, async actor =>
            await this.ctx.teams.createTask({
              actor,
              teamId: state.handle.teamId,
              expectedCursor: team.team.cursor,
              createCommand: {
                idempotencyKey: workflowTaskIdempotencyKey(plan.id, template.id),
              },
              workflowPlanId: plan.id,
              workflowTemplateId: template.id,
              subject: template.subject,
              description: template.description,
              blockedBy,
              requiredCapabilities: template.requiredCapabilities,
              priority: template.priority,
              readScopes: template.readScopes,
              writeScopes: template.writeScopes,
              workspaceMode: template.workspaceMode,
              budget: template.budget,
              reviewPolicy,
              maxAttempts: template.maxAttempts,
            }))
          const afterTask = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
          plan = await this.ctx.teams.getWorkflowPlan({ teamId: state.handle.teamId, planId: plan.id })
          if (plan.taskBindings.some(binding => binding.templateId === template.id)) continue
          plan = await this.withWorkflowProof(state, coordinator, {
            kind: 'team-run-workflow-task-bind',
            teamId: state.handle.teamId,
            coordinator: this.workflowScopeCoordinator(state),
            planId: plan.id,
            expectedCursor: afterTask.team.cursor,
            expectedRevision: plan.revision,
            templateId: template.id,
            taskId: task.id,
          }, async actor => await this.ctx.teams.bindWorkflowPlanTask({
            actor,
            teamId: state.handle.teamId,
            planId: plan.id,
            expectedCursor: afterTask.team.cursor,
            expectedRevision: plan.revision,
            templateId: template.id,
            taskId: task.id,
          }))
        }
        plan = await this.ctx.teams.getWorkflowPlan({ teamId: state.handle.teamId, planId: plan.id })
        if (plan.phase !== 'compiling') return plan
        const readyTeam = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
        return await this.withWorkflowProof(state, coordinator, {
          kind: 'team-run-workflow-plan-phase',
          teamId: state.handle.teamId,
          coordinator: this.workflowScopeCoordinator(state),
          planId: plan.id,
          expectedCursor: readyTeam.team.cursor,
          expectedRevision: plan.revision,
          phase: 'ready',
        }, async actor => await this.ctx.teams.transitionWorkflowPlan({
          actor,
          teamId: state.handle.teamId,
          planId: plan.id,
          expectedCursor: readyTeam.team.cursor,
          expectedRevision: plan.revision,
          phase: 'ready',
        }))
      } catch (error: unknown) {
        if (unboundWorkflowChannel !== undefined) {
          try {
            await this.closeUnboundWorkflowChannel(state, coordinator, unboundWorkflowChannel)
          } catch (cleanupError: unknown) {
            throw new AggregateError([error, cleanupError], 'workflow compilation and unbound-channel cleanup both failed')
          }
        }
        if (!isWorkflowPlanRace(error) || attempt + 1 === state.config.receiptRetryAttempts) throw error
      }
    }
    throw new TeamRunError('workflow plan compilation exhausted its Team cursor retries', 'TEAM_RUN_NOT_QUIESCENT')
  }

  /** Close an active workflow channel only while its compiling plan still has no channel binding. */
  private async closeUnboundWorkflowChannel(
    state: RunState,
    coordinator: Agent,
    target: { readonly planId: TeamWorkflowPlanId; readonly channelId: ChannelId },
  ): Promise<void> {
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      const plan = await this.ctx.teams.getWorkflowPlan({ teamId: state.handle.teamId, planId: target.planId })
      if (plan.phase !== 'compiling' || plan.channelId !== undefined) return
      const channel = await this.ctx.teams.getChannel({ channelId: target.channelId })
      if (!['active', 'pending'].includes(channel.phase)
        || channel.manifest.teamId !== state.handle.teamId
        || channel.manifest.workflowPlanId !== target.planId
        || channel.manifest.adapter.type !== WORKFLOW_CHANNEL_ADAPTER.type
        || channel.manifest.adapter.version !== WORKFLOW_CHANNEL_ADAPTER.version) {
        return
      }
      const team = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
      try {
        await this.withWorkflowProof(state, coordinator, {
          kind: 'team-run-workflow-channel-close',
          teamId: state.handle.teamId,
          coordinator: this.workflowScopeCoordinator(state),
          planId: target.planId,
          expectedTeamCursor: team.team.cursor,
          expectedRevision: plan.revision,
          channelId: target.channelId,
          expectedCursor: channel.cursor,
          reason: 'Workflow channel did not bind.',
        }, async actor => await this.ctx.teams.closeWorkflowChannel({
          actor,
          teamId: state.handle.teamId,
          planId: target.planId,
          expectedTeamCursor: team.team.cursor,
          expectedRevision: plan.revision,
          channelId: target.channelId,
          expectedCursor: channel.cursor,
          reason: 'Workflow channel did not bind.',
        }))
        return
      } catch (error: unknown) {
        if (error instanceof TeamError && (error.code === 'TEAM_CURSOR_CONFLICT'
          || error.code === 'TEAM_WORKFLOW_PLAN_STALE_REVISION'
          || error.code === 'TEAM_ACTOR_PROOF_INVALID')) {
          await this.assertCoordinatorAuthority(state, coordinator, 'workflow channel cleanup')
          continue
        }
        throw error
      }
    }
    throw new TeamRunError('workflow channel cleanup exhausted its Team cursor retries', 'TEAM_RUN_NOT_QUIESCENT')
  }

  /** Admit a new plan through a fresh coordinator proof, retrying only cursor races. */
  private async admitWorkflowPlanWithRetry(
    state: RunState,
    request: TeamRunWorkflowPlanStartRequest,
    coordinator: Agent,
  ): Promise<TeamWorkflowPlanSnapshot> {
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      const team = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
      try {
        return await this.withCoordinatorActorProof({ state, coordinator }, async actor =>
          await this.ctx.teams.admitWorkflowPlan({
            actor,
            teamId: state.handle.teamId,
            expectedCursor: team.team.cursor,
            idempotencyKey: request.idempotencyKey,
            plan: request.plan,
          }))
      } catch (error: unknown) {
        if (!isWorkflowPlanRace(error) || attempt + 1 === state.config.receiptRetryAttempts) throw error
        await this.assertCoordinatorAuthority(state, coordinator, 'workflow plan admission')
      }
    }
    throw new TeamRunError('workflow plan admission exhausted its Team cursor retries', 'TEAM_RUN_NOT_QUIESCENT')
  }

  /** Reject a plan id that was not admitted through this coordinator capability. */
  private requireWorkflowPlan(state: RunState, planId: TeamWorkflowPlanId): void {
    if (!state.workflowPlanIds.has(planId)) {
      throw new TeamRunError(`workflow plan '${planId}' is not owned by this coordinator`, 'TEAM_RUN_WORKFLOW_NOT_FOUND')
    }
  }

  /**
   * Await and receipt the coordinator's explicit final Envelope, then settle
   * the narrow default topology from active through quiescing to completed.
   * @param request - Team identity, last observed channel cursor, and local wait cancellation.
   * @returns the exact human-addressed final value retained in the channel WAL.
   */
  async waitForFinal(request: TeamRunFinalWaitRequest): Promise<TeamRunFinal> {
    const state = this.requireRun(request.teamId)
    if (state.handle.recipient.kind !== 'human') throw new TeamRunError('Child results belong to the parent delegation', 'TEAM_RUN_NOT_FOUND')
    this.assertHumanOwner(state, request.humanOwner)
    const coordinator = state.handle.coordinatorLease.localAgent
    if (coordinator === undefined) {
      throw new TeamRunError('the default local coordinator is no longer resident', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const terminal = Promise.withResolvers<SessionEvent<'turn/end'>>()
    const disposeTerminal = this.ctx.on('session/event', (session, event) => {
      if (session !== coordinator.session || event.type !== 'turn/end') return
      terminal.resolve(event)
    })
    let ended = [...coordinator.session.events].reverse().find((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
    let afterCursor = request.afterCursor ?? -1
    try {
      while (true) {
        const read = await this.ctx.teams.readChannelPage({
          channelId: state.handle.channel.manifest.id,
          afterCursor,
          limit: state.config.channelPageSize,
        })
        const final = findFinal(read.records, state.handle)
        if (final !== undefined) {
          await this.assertNoUnfinishedTasks(state)
          await this.settleFinalWorkspaces(state)
          await this.admitCompletionIntent(state, final.id)
          await this.admitHumanFinal(state, final)
          await this.acknowledgeHumanFinal(state, final)
          await this.complete(state, final.id)
          return Object.freeze({
            teamId: state.handle.teamId,
            channelId: state.handle.channel.manifest.id,
            envelopeId: final.id,
            text: final.payload.text as string,
          })
        }
        if (ended?.data.reason.kind === 'max-tokens') ended = undefined
        if (ended !== undefined) {
          const failure = finalMissing(ended)
          try {
            await this.recordCoordinatorTurnEnd(state, ended)
          } catch (error: unknown) {
            throw new AggregateError([failure, error], 'Team final wait failed after lifecycle admission failure')
          }
          throw failure
        }
        if (read.channel.phase !== 'active') {
          throw new TeamRunError(`Team channel '${state.handle.channel.manifest.id}' closed before an explicit final Envelope`, 'TEAM_RUN_FINAL_INVALID')
        }
        afterCursor = read.nextCursor ?? read.channel.cursor
        const watched = await this.waitForChannelOrTurn(
          state.handle.channel.manifest.id,
          afterCursor,
          terminal.promise,
          request.signal,
        )
        if (watched.kind === 'turn-end') {
          ended = watched.event
          continue
        }
        if (watched.value.kind === 'closed') {
          throw new TeamRunError(`Team channel '${state.handle.channel.manifest.id}' closed before an explicit final Envelope`, 'TEAM_RUN_FINAL_INVALID')
        }
      }
    } finally {
      disposeTerminal()
    }
  }

  /**
   * Cancel a current local Team run after the Hub has durably closed admission.
   * @param teamId - Team selected from the current local product run map.
   * @param humanOwner - optional authenticated product owner that must match the run's durable human.
   * @returns resolution after Team terminal state and local coordinator lease settle.
   */
  async cancel(
    teamId: TeamId,
    humanOwner?: Extract<TeamParticipantOwner, { readonly kind: 'product-principal' }>,
  ): Promise<void> {
    const state = this.requireRun(teamId)
    if (state.handle.team.parentTeamId !== undefined) throw new TeamRunError('Child cancellation requires parent authorization', 'TEAM_RUN_NOT_FOUND')
    this.assertHumanOwner(state, humanOwner)
    const failures: unknown[] = []
    let current = await this.requestCancellationIntent(state)
    const cancellation = current.team.cancellation
    if (cancellation !== undefined) {
      const delegation = teamDelegationDrivers.get(this.ctx.root)
      if (delegation !== undefined) {
        try {
          await delegation.drive(teamId)
        } catch (error: unknown) {
          failures.push(error)
        }
      }
    }
    try {
      await this.releaseRunWithRetries(state)
    } catch (error: unknown) {
      failures.push(error)
    }
    if (cancellation !== undefined) {
      try {
        await this.cancelPendingTasks(state, cancellation)
      } catch (error: unknown) {
        failures.push(error)
      }
      try {
        await this.closeCancelledRunChannels(state, cancellation, state.handle.channel.manifest.id)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (cancellation !== undefined && failures.some(isCancellationProgressFailure)) {
      const driver = this.ctx.get('teamClosureDriver') as TeamClosureDriverBridge | undefined
      if (driver !== undefined) {
        try {
          await driver.drive({ teamId })
        } catch (error: unknown) {
          failures.push(error)
        }
      }
    }
    try {
      current = await this.ctx.teams.getTeam({ teamId })
      if (current.team.phase === 'quiescing' || current.team.phase === 'stalled') {
        current = await this.requestCancellationIntent(state, true)
      }
      if (current.team.phase === 'cancelled') {
        this.retainTerminalArchiveOwner(state, current)
        this.revokeCancellationCleanupProofs(state)
        this.runs.delete(teamId)
        this.forgetStarts(teamId)
        if (failures.every(isCancellationProgressFailure)) failures.length = 0
      }
    } catch (error: unknown) {
      failures.push(error)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, `Team '${teamId}' cancellation failed`)
    if (current.team.phase !== 'cancelled') {
      throw new TeamRunError(`Team '${teamId}' cancellation remains ${current.team.phase}`, 'TEAM_RUN_NOT_QUIESCENT')
    }
  }

  /** Persist a missing-final or structured turn failure before returning it to a product caller. */
  private async recordCoordinatorTurnEnd(
    state: RunState,
    event: SessionEvent<'turn/end'>,
  ): Promise<void> {
    if (state.handle.team.childRun !== undefined) {
      await this.recordChildCoordinatorTurnEnd(state, event)
      return
    }
    // Reaching the provider output cap is an expected continuation point. Keep
    // the Team active while a bounded automatic continuation resumes the
    // coordinator from the same Session context. Exhaustion is converted into
    // the normal missing-final stall so final-wait and stop/delete can settle.
    if (event.data.reason.kind === 'max-tokens') {
      await this.continueCoordinatorAfterOutputLimit(state, event)
      return
    }
    if (event.data.reason.kind === 'completed' && coordinatorTurnPostedMessage(state.handle.coordinatorLease.localAgent?.session, event.data.turn)) return
    const driver = this.ctx.get('teamClosureDriver') as TeamClosureDriverBridge | undefined
    if (driver === undefined) return
    const reason = event.data.reason.kind === 'error'
      ? {
        code: event.data.reason.error.code,
        message: event.data.reason.error.message,
      }
      : {
        code: 'FINAL_ANSWER_MISSING',
        message: `coordinator turn ended ${event.data.reason.kind} before an explicit final Envelope`,
      }
    await driver.recordTurnEnd({
      teamId: state.handle.teamId,
      coordinatorId: state.handle.coordinator.id,
      activationId: state.handle.coordinatorLease.binding.activation.id,
      sessionId: state.handle.coordinatorLease.binding.sessionId,
      provider: state.handle.coordinatorLease.binding.provider,
      turn: event.data.turn,
      finalChannelId: state.handle.channel.manifest.id,
      humanId: state.handle.recipient.id,
      reason,
      outcome: event.data.reason.kind === 'error' ? 'failure' : 'missing-final',
    })
  }

  /** Record child failure or a missing service response without granting human final authority. */
  private async recordChildCoordinatorTurnEnd(state: RunState, event: SessionEvent<'turn/end'>): Promise<void> {
    const binding = state.handle.team.childRun
    const coordinator = state.handle.coordinatorLease.localAgent
    if (binding === undefined || coordinator === undefined) return
    for (let retry = 0; retry < state.config.receiptRetryAttempts; retry += 1) {
      const current = await this.ctx.teams.getTeam({ teamId: binding.childTeamId })
      if (current.team.phase !== 'active' || current.team.closure !== undefined || current.team.cancellation !== undefined) return
      if (event.data.reason.kind === 'max-tokens' && state.coordinatorOutputContinuations < state.config.maxCoordinatorOutputContinuations) {
        state.coordinatorOutputContinuations += 1
        coordinator.followup(createUserMessage({ content: [{ type: 'text',
          text: 'Continue the delegated objective from the existing context and send its result with team_final.' }],
        source: { kind: 'plugin', plugin: 'team-run' } }))
        return
      }
      if (event.data.reason.kind === 'error') {
        const reason = event.data.reason.error
        await this.withCoordinatorActorProof({ state, coordinator }, async actor => await this.ctx.teams.failTeam({
          actor, teamId: binding.childTeamId, expectedCursor: current.team.cursor,
          idempotencyKey: closureKey('fail', binding.childTeamId), reason: { code: reason.code, message: reason.message },
        }))
        return
      }
      const token: object = Object.freeze({ toJSON(): never { throw new TypeError('Child result proof is runtime-only') } })
      const actor = token as TeamSystemChildResultProof
      this.childResultProofs.set(actor, { state, scope: { kind: 'child-result-missing', binding,
        expectedCursor: current.team.cursor, activationId: state.handle.coordinatorLease.binding.activation.id,
        sessionId: state.handle.coordinatorLease.binding.sessionId, provider: state.handle.coordinatorLease.binding.provider,
        turn: event.data.turn } })
      try {
        await this.ctx.teams.recordChildResultMissing({ actor, childTeamId: binding.childTeamId, expectedCursor: current.team.cursor })
        return
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) || retry + 1 === state.config.receiptRetryAttempts) throw error
      } finally { this.childResultProofs.delete(actor) }
    }
  }

  /** Continue one live coordinator turn after an output-limit boundary. */
  private async continueCoordinatorAfterOutputLimit(
    state: RunState,
    event: SessionEvent<'turn/end'>,
  ): Promise<void> {
    if (this.closing || state.topologyReleased) return
    const coordinator = state.handle.coordinatorLease.localAgent
    if (coordinator === undefined) return
    const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    if (current.team.phase !== 'active') return
    const driver = this.ctx.get('teamClosureDriver') as TeamClosureDriverBridge | undefined
    if (state.coordinatorOutputContinuations >= state.config.maxCoordinatorOutputContinuations) {
      if (driver === undefined) return
      await driver.recordTurnEnd({
        teamId: state.handle.teamId,
        coordinatorId: state.handle.coordinator.id,
        activationId: state.handle.coordinatorLease.binding.activation.id,
        sessionId: state.handle.coordinatorLease.binding.sessionId,
        provider: state.handle.coordinatorLease.binding.provider,
        turn: event.data.turn,
        finalChannelId: state.handle.channel.manifest.id,
        humanId: state.handle.recipient.id,
        reason: {
          code: 'FINAL_ANSWER_MISSING',
          message: `coordinator reached the output limit ${String(state.config.maxCoordinatorOutputContinuations)} times without posting a final Envelope`,
        },
        outcome: 'missing-final',
      })
      return
    }
    state.coordinatorOutputContinuations += 1
    try {
      coordinator.followup(createUserMessage({
        content: [{
          type: 'text',
          text: 'The previous coordinator response reached the model output limit before the Team objective was complete. Continue from the existing context. Finish pending worker coordination and call team_final with the final answer when the objective is complete; do not stop with an assistant message only.',
        }],
        source: { kind: 'plugin', plugin: 'team-run' },
      }))
    } catch (error: unknown) {
      if (driver === undefined) throw error
      await driver.recordTurnEnd({
        teamId: state.handle.teamId,
        coordinatorId: state.handle.coordinator.id,
        activationId: state.handle.coordinatorLease.binding.activation.id,
        sessionId: state.handle.coordinatorLease.binding.sessionId,
        provider: state.handle.coordinatorLease.binding.provider,
        turn: event.data.turn,
        finalChannelId: state.handle.channel.manifest.id,
        humanId: state.handle.recipient.id,
        reason: {
          code: 'FINAL_ANSWER_MISSING',
          message: `coordinator output-limit continuation failed: ${String(error)}`,
        },
        outcome: 'missing-final',
      })
    }
  }

  /** Reject an authenticated product call that names another human than this current TeamRun. */
  private assertHumanOwner(
    state: RunState,
    owner: Extract<TeamParticipantOwner, { readonly kind: 'product-principal' }> | undefined,
  ): void {
    this.assertHandleHumanOwner(state.handle, owner)
  }

  /** Reject an authenticated resume or current-run call that names another run owner. */
  private assertHandleHumanOwner(
    handle: TeamRunHandle,
    owner: Extract<TeamParticipantOwner, { readonly kind: 'product-principal' }> | undefined,
  ): void {
    if (owner === undefined) return
    const actual = handle.recipient.owner
    if (actual?.kind !== 'product-principal' || actual.principalId !== owner.principalId) {
      throw new TeamRunError(
        `Team '${handle.teamId}' is owned by another authenticated human participant`,
        'TEAM_RUN_NOT_FOUND',
      )
    }
  }

  /**
   * Archive one terminal Team only when this service retained the local owner
   * after settling that Team. The opaque proof is minted for this single Hub
   * call and cannot be reconstructed from a Team id or terminal snapshot.
   * @param request - terminal Team identity and observed Team-journal cursor.
   * @returns the Team state with its durable archive marker.
   */
  async archiveTerminal(request: TeamArchiveInput): Promise<TeamStateSnapshot> {
    this.assertOpen()
    const owner = this.terminalArchiveOwners.get(request.teamId)
    if (owner === undefined) {
      throw new TeamRunError(`Terminal Team '${request.teamId}' is not owned by this local Team-run instance`, 'TEAM_RUN_NOT_FOUND')
    }
    const scope: TeamSystemArchiveScope = Object.freeze({
      kind: 'team-run-terminal-archive',
      teamId: request.teamId,
      expectedCursor: request.expectedCursor,
    })
    const proof = createTeamRunArchiveProof()
    this.archiveProofs.set(proof, Object.freeze({ owner, scope }))
    try {
      return await this.ctx.teams.archiveTeam({ actor: proof, ...request })
    } finally {
      this.revokeArchiveProof(proof)
    }
  }

  /**
   * Commit or observe the durable cancellation intent before local cleanup.
   * A concurrent Team record can advance the cursor between the product read
   * and the typed closure command; retry only that expected cursor race while
   * retaining local ownership until the Hub accepts or exposes the intent.
   * @param state - exact locally owned Team run that owns the cancellation authority.
   * @param driveExisting - re-enter the typed command after cleanup so the Hub can settle an existing intent.
   * @returns the current Team state after cancellation becomes durable or terminal.
   */
  private async requestCancellationIntent(state: RunState, driveExisting = false): Promise<TeamStateSnapshot> {
    let lastConflict: unknown
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
      if (isTerminalTeamPhase(current.team.phase)
        || (current.team.cancellation !== undefined && !driveExisting)) return current
      const actor = this.mintCancelClosureProof(state)
      let commandError: unknown
      try {
        return await this.ctx.teams.cancelTeam({
          teamId: state.handle.teamId,
          expectedCursor: current.team.cursor,
          idempotencyKey: closureKey('cancel', state.handle.teamId),
          actor,
          reason: { code: 'USER_CANCELLED', message: 'The user cancelled the Team run.' },
        })
      } catch (error: unknown) {
        commandError = error
      } finally {
        this.revokeClosureProof(actor)
      }
      const recovered = await this.ctx.teams.getTeam({ teamId: state.handle.teamId }).catch(() => undefined)
      if (recovered?.team.cancellation !== undefined || (recovered !== undefined && isTerminalTeamPhase(recovered.team.phase))) {
        return recovered
      }
      if (!isTeamCursorConflict(commandError)) throw commandError
      lastConflict = commandError
    }
    throw lastConflict
  }

  /** Release current local coordinator leases without mutating durable Team phase on plugin disposal. */
  close(): Promise<void> {
    this.disposal ??= this.dispose()
    return this.disposal
  }

  /** Activate one frozen template route and retain its reporting prompt with its execution lease. */
  private async activateTemplateMember(
    teamId: TeamId, participant: ParticipantSnapshot, spec: TeamRunMember, cwd: string | undefined, signal: AbortSignal,
    promptOrder: number,
  ): Promise<WorkerState> {
    const current = await this.ctx.teams.getTeam({ teamId })
    const member = current.participants.find(value => value.id === participant.id)
    if (member === undefined || member.phase !== 'active' || member.role !== spec.role || member.kind !== spec.kind
      || member.provider !== spec.provider || member.preset !== spec.preset || member.model !== `${spec.modelProvider}/${spec.model}`
      || member.capabilities.length !== spec.capabilities.length
      || !spec.capabilities.every(capability => member.capabilities.includes(capability))) {
      throw new TeamRunError(`Template member '${participant.id}' no longer matches its frozen execution route`, 'TEAM_RUN_NOT_QUIESCENT')
    }
    const previous = current.activations.findLast(binding => binding.activation.participantId === participant.id)
    let lease: TeamActivationLease | undefined
    try {
      if (previous !== undefined && previous.quiescedAt === undefined) {
        if (previous.recovery === undefined) {
          throw new TeamRunError(`Template member '${participant.id}' requires confirmed activation recovery`, 'TEAM_RUN_NOT_QUIESCENT')
        }
        lease = await this.ctx.teamActivations.coldReplace({ teamId, participantId: participant.id,
          activationId: previous.activation.id, signal })
      } else {
        lease = await this.ctx.teamActivations.activate({ teamId, participantId: participant.id,
          expectedCursor: current.team.cursor, provider: spec.provider,
          sessionId: previous?.sessionId ?? SessionId(`team-member-${randomUUID()}`),
          seed: { kind: previous === undefined ? 'fresh' : 'resume' },
          agent: { ...cwd === undefined ? {} : { cwd }, ...spec.preset === undefined ? {} : { preset: spec.preset },
            options: { provider: spec.modelProvider, model: spec.model, maxTokens: spec.maxTokens } }, signal })
      }
      signal.throwIfAborted()
      const disposePrompt = lease.localAgent === undefined ? () => {} : lease.localAgent.ctx.systemPrompt.section({
        name: 'team-run:template-task-report', order: promptOrder,
        text: 'Follow the assigned Team task or review. Report task work with team_task_report. Resolve a review only from its supplied review assignment.',
      })
      return { lease, disposePrompt }
    } catch (error: unknown) {
      if (lease !== undefined) {
        try { await lease.dispose() } catch (cleanup: unknown) {
          throw new AggregateError([error, cleanup], `Template member '${participant.id}' cleanup failed`)
        }
      }
      throw error
    }
  }

  /** Commit one sequential bootstrap participant and select its active or provisioned membership. */
  private async activateBootstrapParticipant(
    bootstrap: BootstrapTopologyState,
    input: {
      readonly kind: ParticipantSnapshot['kind']
      readonly displayName: string
      readonly role: string
      readonly capabilities: readonly string[]
      readonly active: boolean
      readonly owner?: TeamParticipantOwner
      readonly authorityGrant?: TeamAuthorityGrant
      readonly provider?: string
      readonly model?: string
      readonly preset?: string
      readonly recover?: boolean
    },
  ): Promise<ParticipantSnapshot> {
    let state = await this.ctx.teams.getTeam({ teamId: bootstrap.teamId })
    const existing = input.recover === true ? state.participants.filter(participant => participant.role === input.role) : []
    if (existing.length > 1) throw new TeamRunError(`Child has ambiguous '${input.role}' identities`, 'TEAM_RUN_START_CONFLICT')
    const retained = existing[0]
    if (retained !== undefined && (retained.kind !== input.kind || retained.phase === 'left' || retained.phase === 'failed'
      || retained.provider !== input.provider || retained.model !== input.model || retained.preset !== input.preset
      || !isDeepStrictEqual(retained.capabilities, input.capabilities))) {
      throw new TeamRunError(`Child '${input.role}' differs from its reserved template`, 'TEAM_RUN_START_CONFLICT')
    }
    const inviteInput = {
      teamId: bootstrap.teamId,
      expectedCursor: state.team.cursor,
      kind: input.kind,
      displayName: input.displayName,
      role: input.role,
      capabilities: input.capabilities,
      ...input.provider === undefined ? {} : { provider: input.provider },
      ...input.model === undefined ? {} : { model: input.model },
      ...input.preset === undefined ? {} : { preset: input.preset },
      ...input.owner === undefined ? {} : { owner: input.owner },
      ...input.authorityGrant === undefined ? {} : { authorityGrant: input.authorityGrant },
    }
    const invited = retained ?? await this.withBootstrapTopologyProof(bootstrap, {
      kind: 'team-run-bootstrap-participant-invite',
      teamId: inviteInput.teamId,
      expectedCursor: inviteInput.expectedCursor,
      participant: {
        kind: inviteInput.kind,
        displayName: inviteInput.displayName,
        role: inviteInput.role,
        capabilities: inviteInput.capabilities,
        ...inviteInput.provider === undefined ? {} : { provider: inviteInput.provider },
        ...inviteInput.model === undefined ? {} : { model: inviteInput.model },
        ...inviteInput.preset === undefined ? {} : { preset: inviteInput.preset },
        ...inviteInput.owner === undefined ? {} : { owner: inviteInput.owner },
        ...inviteInput.authorityGrant === undefined ? {} : { authorityGrant: inviteInput.authorityGrant },
      },
    }, async actor => await this.ctx.teams.inviteParticipant({ actor, ...inviteInput }))
    if (invited.phase === 'active') return invited
    state = await this.ctx.teams.getTeam({ teamId: bootstrap.teamId })
    const provisioningInput = {
      teamId: bootstrap.teamId,
      participantId: invited.id,
      expectedCursor: state.team.cursor,
      phase: 'provisioning',
    } as const
    if (invited.phase === 'invited') await this.withBootstrapTopologyProof(bootstrap, {
      kind: 'team-run-bootstrap-participant-phase',
      ...provisioningInput,
      expectedPhase: 'invited',
    }, async actor => await this.ctx.teams.transitionParticipantPhase({ actor, ...provisioningInput }))
    if (!input.active) {
      return await this.ctx.teams.getTeam({ teamId: bootstrap.teamId }).then(current => requiredParticipant(current, invited.id))
    }
    state = await this.ctx.teams.getTeam({ teamId: bootstrap.teamId })
    const activeInput = {
      teamId: bootstrap.teamId,
      participantId: invited.id,
      expectedCursor: state.team.cursor,
      phase: 'active',
    } as const
    return await this.withBootstrapTopologyProof(bootstrap, {
      kind: 'team-run-bootstrap-participant-phase',
      ...activeInput,
      expectedPhase: 'provisioning',
    }, async actor => await this.ctx.teams.transitionParticipantPhase({ actor, ...activeInput }))
  }

  /** Resolve the default human/coordinator direct channel from durable Team state. */
  private async defaultChannel(
    state: Awaited<ReturnType<Context['teams']['getTeam']>>,
    humanId: ParticipantSnapshot['id'],
    coordinatorId: ParticipantSnapshot['id'],
  ): Promise<ChannelSnapshot> {
    for (const channelId of state.channelIds) {
      const channel = await this.ctx.teams.getChannel({ channelId })
      if (channel.manifest.adapter.type !== DIRECT_CHANNEL_ADAPTER_V4.type
        || channel.manifest.adapter.version !== DIRECT_CHANNEL_ADAPTER_V4.version) continue
      const participants = channel.manifest.participants.map(participant => participant.id)
      if (participants.length === 2 && participants.includes(humanId) && participants.includes(coordinatorId)) return channel
    }
    throw new TeamRunError(`Team '${state.team.id}' has no default human/coordinator channel`, 'TEAM_RUN_NOT_QUIESCENT')
  }

  /** Serialize pool topology and task-admission mutations without serializing worker execution. */
  private async enqueueWorkerPoolMutation<T>(state: RunState, operation: () => Promise<T>): Promise<T> {
    const previous = state.workerPoolMutation
    const current = previous.then(operation, operation)
    state.workerPoolMutation = current.then(() => undefined, () => undefined)
    return await current
  }

  /** Activate the coordinator-selected worker target before the scheduler can fan out work. */
  private async ensureWorkerPool(
    state: RunState,
    signal: AbortSignal | undefined,
    desiredCount = state.targetWorkerCount,
  ): Promise<void> {
    const target = Math.min(state.config.maxWorkerCount, Math.max(0, desiredCount))
    while (state.workers.length < target) {
      await this.inviteWorkerParticipant(state)
    }
    for (const worker of state.workers.slice(0, target)) {
      await this.ensureWorkerParticipant(state, worker.id, signal)
    }
  }

  /** Retry pool topology reconciliation across scheduler cursor advances and report capacity refusal. */
  private async ensureWorkerPoolWithRetries(state: RunState, desiredCount: number): Promise<boolean> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.ensureWorkerPool(state, undefined, desiredCount)
        return false
      } catch (error: unknown) {
        if (isWorkerCapacityError(error)) return true
        if (!isTeamCursorConflict(error) || attempt + 1 >= state.config.receiptRetryAttempts) throw error
      }
    }
  }

  /** Retry idle-worker retirement across scheduler cursor advances. */
  private async retireExcessWorkersWithRetries(state: RunState): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.retireExcessWorkers(state)
        return
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) || attempt + 1 >= state.config.receiptRetryAttempts) throw error
      }
    }
  }

  /** Prepare enough workers for the next coordinator task without blocking at the pool ceiling. */
  private async prepareWorkerCapacity(state: RunState, idempotencyKey: TeamTaskCreateIdempotencyKey): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
        if (current.tasks.some(task => task.createCommand.idempotencyKey === idempotencyKey)) return
        const outstanding = current.tasks
          .filter(task => task.execution.kind === 'participant' && state.defaultWorkerTaskIds.has(task.id) && !isWorkerTaskTerminal(task.phase)).length
        const desired = Math.min(state.config.maxWorkerCount, Math.max(state.targetWorkerCount, outstanding + 1))
        if (desired > state.targetWorkerCount) state.targetWorkerCount = desired
        await this.ensureWorkerPoolWithRetries(state, desired)
        return
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) || attempt + 1 >= state.config.receiptRetryAttempts) throw error
      }
    }
  }

  /** Invite one new local worker with a durable TeamRun topology proof. */
  private async inviteWorkerParticipant(state: RunState): Promise<ParticipantSnapshot> {
    const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    const role = nextWorkerRole(current.participants)
    const inviteInput = {
      teamId: state.handle.teamId,
      expectedCursor: current.team.cursor,
      kind: 'local-agent' as const,
      displayName: role === 'worker' ? state.config.workerName : `${state.config.workerName} ${role.slice('worker-'.length)}`,
      role,
      capabilities: [state.config.workerCapability],
    }
    const invited = await this.withRunTopologyProof(state, {
      kind: 'team-run-worker-invite',
      teamId: inviteInput.teamId,
      expectedCursor: inviteInput.expectedCursor,
      participant: {
        kind: inviteInput.kind,
        displayName: inviteInput.displayName,
        role: inviteInput.role,
        capabilities: inviteInput.capabilities,
      },
    }, async actor => await this.ctx.teams.inviteParticipant({ actor, ...inviteInput }))
    state.workers.push(invited)
    state.workerAgents.set(invited.id, state.workerAgent)
    const afterInvite = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    const provisioningInput = {
      teamId: state.handle.teamId,
      participantId: invited.id,
      expectedCursor: afterInvite.team.cursor,
      phase: 'provisioning' as const,
    }
    try {
      await this.withRunTopologyProof(state, {
        kind: 'team-run-worker-activate',
        ...provisioningInput,
        expectedPhase: 'invited' as const,
      }, async actor => await this.ctx.teams.transitionParticipantPhase({ actor, ...provisioningInput }))
      return requiredParticipant(await this.ctx.teams.getTeam({ teamId: state.handle.teamId }), invited.id)
    } catch (error: unknown) {
      if (isTeamCursorConflict(error)) {
        const latest = (await this.ctx.teams.getTeam({ teamId: state.handle.teamId })).participants
          .find(participant => participant.id === invited.id)
        if (latest !== undefined && latest.phase !== 'left' && latest.phase !== 'failed') return latest
      }
      state.workers.splice(state.workers.findIndex(worker => worker.id === invited.id), 1)
      state.workerAgents.delete(invited.id)
      throw error
    }
  }

  /** Retire idle workers above the coordinator's current target and leave busy workers untouched. */
  private async retireExcessWorkers(state: RunState): Promise<void> {
    // A pending review retains its completed attempt's participant as consult initiator.
    for (const worker of [...state.workers].reverse()) {
      if (state.workers.length <= state.targetWorkerCount) break
      if (state.workerActivations.has(worker.id)) continue
      if (worker.role === DEFAULT_WORKER_NAME && state.minimumWorkerCount > 0) continue
      const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
      const participant = current.participants.find(candidate => candidate.id === worker.id)
      if (participant === undefined || participant.phase === 'left' || participant.phase === 'failed') continue
      if (current.tasks.some(task => (task.phase === 'assigned' || task.phase === 'running') && task.lease?.participantId === worker.id)) continue
      if (current.tasks.some(task => task.phase === 'review'
        && task.attemptHistory.at(-1)?.participantId === worker.id)) continue
      const live = state.workerStates.get(worker.id)
      if (live !== undefined) {
        await live.lease.dispose()
        state.workerStates.delete(worker.id)
      }
      const afterRelease = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
      const latest = afterRelease.participants.find(candidate => candidate.id === worker.id)
      if (latest === undefined || latest.phase === 'left' || latest.phase === 'failed') continue
      const retireInput = {
        teamId: state.handle.teamId,
        participantId: worker.id,
        expectedCursor: afterRelease.team.cursor,
        phase: 'left' as const,
      }
      await this.withRunTopologyProof(state, {
        kind: 'team-run-worker-retire',
        ...retireInput,
        expectedPhase: latest.phase,
      }, async actor => await this.ctx.teams.transitionParticipantPhase({ actor, ...retireInput }))
      const index = state.workers.findIndex(candidate => candidate.id === worker.id)
      if (index >= 0) state.workers.splice(index, 1)
      state.workerAgents.delete(worker.id)
    }
  }

  /** Reconcile automatic task-pressure scaling after a task reaches a terminal state. */
  private async reconcileWorkerPool(state: RunState): Promise<void> {
    const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    const outstanding = current.tasks.filter(task => task.execution.kind === 'participant' && state.defaultWorkerTaskIds.has(task.id) && !isWorkerTaskTerminal(task.phase)).length
    const desired = Math.max(state.minimumWorkerCount, Math.min(state.targetWorkerCount, outstanding))
    if (desired < state.targetWorkerCount) state.targetWorkerCount = desired
    if (state.workers.length > state.targetWorkerCount) await this.retireExcessWorkersWithRetries(state)
  }

  /** Return compact capacity facts so a saturated pool never leaves the coordinator guessing. */
  private async workerPoolStatus(
    state: RunState,
    requestedCount: number,
    capacityLimited: boolean,
  ): Promise<TeamRunWorkerPoolStatus> {
    const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    const workers = current.participants.filter(participant => isWorkerRole(participant.role)
      && participant.phase !== 'left' && participant.phase !== 'failed')
    const workerIds = new Set(workers.map(worker => worker.id))
    const busyIds = new Set(current.tasks.flatMap(task => (
      (task.phase === 'assigned' || task.phase === 'running')
        && task.lease !== undefined && workerIds.has(task.lease.participantId)
        ? [task.lease.participantId] : [])))
    const activeBindings = current.activations.filter(binding => workerIds.has(binding.activation.participantId)
      && (binding.activation.status === 'idle' || binding.activation.status === 'running'))
    const activeIds = new Set(activeBindings.map(binding => binding.activation.participantId))
    const queuedTaskCount = current.tasks.filter(task => task.execution.kind === 'participant' && state.defaultWorkerTaskIds.has(task.id)
      && task.phase === 'pending' && task.cancellation === undefined).length
    const activeCount = activeIds.size
    const busyCount = [...busyIds].filter(id => activeIds.has(id)).length
    const idleCount = Math.max(0, activeCount - busyCount)
    return Object.freeze({
      requestedCount,
      targetCount: state.targetWorkerCount,
      maxCount: state.config.maxWorkerCount,
      workerCount: workers.length,
      activeCount,
      idleCount,
      busyCount,
      queuedTaskCount,
      saturated: capacityLimited || requestedCount > state.config.maxWorkerCount
        || (queuedTaskCount > 0 && idleCount === 0 && activeCount >= state.targetWorkerCount),
    })
  }

  /** Activate one worker Participant once and coalesce concurrent requests for its residency. */
  private async ensureWorkerParticipant(
    state: RunState,
    participantId: ParticipantId,
    signal: AbortSignal | undefined,
  ): Promise<WorkerState> {
    const existing = state.workerStates.get(participantId)
    if (existing !== undefined) return existing
    const inFlight = state.workerActivations.get(participantId)
    if (inFlight !== undefined) return await inFlight
    const activation = this.activateWorker(state, participantId, signal)
    state.workerActivations.set(participantId, activation)
    try {
      const worker = await activation
      state.workerStates.set(participantId, worker)
      return worker
    } finally {
      if (state.workerActivations.get(participantId) === activation) state.workerActivations.delete(participantId)
    }
  }

  private async activateWorker(state: RunState, participantId: ParticipantId, signal: AbortSignal | undefined): Promise<WorkerState> {
    let current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    const worker = requiredParticipant(current, participantId)
    const workerAgent = state.workerAgents.get(participantId)
    if (workerAgent === undefined) {
      throw new TeamRunError(`Team-run has no execution profile for worker '${participantId}'`, 'TEAM_RUN_NOT_QUIESCENT')
    }
    if (worker.phase === 'invited') {
      const phaseInput = {
        teamId: state.handle.teamId,
        participantId: worker.id,
        expectedCursor: current.team.cursor,
        phase: 'provisioning',
      } as const
      await this.withRunTopologyProof(state, {
        kind: 'team-run-worker-activate',
        ...phaseInput,
        expectedPhase: 'invited',
      }, async actor => await this.ctx.teams.transitionParticipantPhase({ actor, ...phaseInput }))
      current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    }
    if (worker.phase === 'provisioning' || current.participants.find(participant => participant.id === worker.id)?.phase === 'provisioning') {
      const phaseInput = {
        teamId: state.handle.teamId,
        participantId: worker.id,
        expectedCursor: current.team.cursor,
        phase: 'active',
      } as const
      await this.withRunTopologyProof(state, {
        kind: 'team-run-worker-activate',
        ...phaseInput,
        expectedPhase: 'provisioning',
      }, async actor => await this.ctx.teams.transitionParticipantPhase({ actor, ...phaseInput }))
      current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    } else if (worker.phase !== 'active') {
      throw new TeamRunError(`default worker '${worker.id}' is not available for activation`, 'TEAM_RUN_NOT_QUIESCENT')
    }
    let lease: TeamActivationLease | undefined
    let disposePrompt: (() => void) | undefined
    try {
      lease = await this.ctx.teamActivations.activate({
        teamId: state.handle.teamId,
        participantId: worker.id,
        expectedCursor: current.team.cursor,
        provider: state.config.activationProvider,
        sessionId: workerAgent.sessionId ?? SessionId(`team-worker-${randomUUID()}`),
        seed: workerAgent.sessionId === undefined ? { kind: 'fresh' } : { kind: 'resume' },
        agent: workerAgent,
        signal: signal ?? new AbortController().signal,
      })
      if (lease.localAgent === undefined) {
        throw new TeamRunError(
          `activation provider '${state.config.activationProvider}' did not publish a local default worker Agent`,
          'TEAM_RUN_NOT_QUIESCENT',
        )
      }
      disposePrompt = lease.localAgent.ctx.systemPrompt.section({
        name: 'team-run:worker-task-report',
        order: state.config.workerPromptOrder,
        text: 'Complete only the assigned Team task. Do not delegate task work. Report completion, failure, or release with team_task_report using the task_id and attempt_id from the assignment.',
      })
      return { lease, disposePrompt }
    } catch (error: unknown) {
      disposePrompt?.()
      if (lease !== undefined) await lease.dispose().catch(() => {})
      throw error
    }
  }

  /** Ensure a non-delegating reviewer Agent is active for mutating default-worker work. */
  private async ensureReviewer(state: RunState): Promise<ReviewerState> {
    if (state.reviewer !== undefined) return state.reviewer
    if (state.reviewerActivation !== undefined) return await state.reviewerActivation
    const activation = this.activateReviewer(state)
    state.reviewerActivation = activation
    try {
      const reviewer = await activation
      state.reviewer = reviewer
      return reviewer
    } finally {
      if (state.reviewerActivation === activation) state.reviewerActivation = undefined
    }
  }

  /** Invite/activate the reviewer Participant and publish its local residency epoch. */
  private async activateReviewer(state: RunState): Promise<ReviewerState> {
    let conflicts = 0
    for (;;) {
      const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
      const participant = current.participants.find(candidate => candidate.role === 'reviewer')
      try {
        if (participant === undefined) {
          const inviteInput = {
            teamId: state.handle.teamId,
            expectedCursor: current.team.cursor,
            kind: 'local-agent',
            displayName: state.config.reviewerName,
            role: 'reviewer',
            capabilities: [state.config.reviewerCapability],
            ...state.config.reviewerPreset === undefined ? {} : { preset: state.config.reviewerPreset },
          } as const
          await this.withRunTopologyProof(state, {
            kind: 'team-run-reviewer-invite',
            teamId: inviteInput.teamId,
            expectedCursor: inviteInput.expectedCursor,
            participant: {
              kind: inviteInput.kind, displayName: inviteInput.displayName, role: inviteInput.role,
              capabilities: inviteInput.capabilities,
              ...inviteInput.preset === undefined ? {} : { preset: inviteInput.preset },
            },
          }, async actor => await this.ctx.teams.inviteParticipant({ actor, ...inviteInput }))
        } else if (participant.phase === 'invited' || participant.phase === 'provisioning') {
          const phaseInput = {
            teamId: state.handle.teamId,
            participantId: participant.id,
            expectedCursor: current.team.cursor,
            phase: participant.phase === 'invited' ? 'provisioning' : 'active',
          } as const
          await this.withRunTopologyProof(state, {
            kind: 'team-run-reviewer-phase', ...phaseInput, expectedPhase: participant.phase,
          }, async actor => await this.ctx.teams.transitionParticipantPhase({ actor, ...phaseInput }))
        } else {
          if (participant.phase !== 'active') {
            throw new TeamRunError(`reviewer '${participant.id}' is not active`, 'TEAM_RUN_NOT_QUIESCENT')
          }
          const priorBinding = current.activations.find(binding => binding.activation.participantId === participant.id)
          const lease = await this.ctx.teamActivations.activate({
            teamId: state.handle.teamId,
            participantId: participant.id,
            expectedCursor: current.team.cursor,
            provider: state.config.activationProvider,
            sessionId: priorBinding?.sessionId ?? SessionId(`team-reviewer-${randomUUID()}`),
            seed: priorBinding === undefined ? { kind: 'fresh' } : { kind: 'resume' },
            agent: {
              cwd: state.workerAgent.cwd,
              options: state.workerAgent.options,
              ...state.config.reviewerPreset === undefined ? {} : { preset: state.config.reviewerPreset },
            },
            signal: new AbortController().signal,
          })
          if (lease.localAgent === undefined) {
            await lease.dispose().catch(() => {})
            throw new TeamRunError('reviewer activation did not publish a local Agent', 'TEAM_RUN_NOT_QUIESCENT')
          }
          const disposePrompt = lease.localAgent.ctx.systemPrompt.section({
            name: 'team-run:reviewer-task',
            order: state.config.workerPromptOrder,
            text: 'Review the assigned Team task result. Use team_task_review with the task_id, decision, and reason; the current review assignment supplies the revision fence. Do not modify files or delegate work.',
          })
          return { participant, lease, disposePrompt }
        }
        conflicts = 0
      } catch (error: unknown) {
        conflicts += 1
        if (!isTeamCursorConflict(error) || conflicts >= state.config.receiptRetryAttempts) throw error
      }
    }
  }

  /** Prepare reusable task participants without consuming the later task mutation's cursor retries. */
  private async prepareDefaultWorkerTaskParticipants(
    state: RunState,
    needsReview: boolean,
  ): Promise<TeamTaskSnapshot['reviewPolicy']> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.ensureWorkerPoolWithRetries(state, state.targetWorkerCount)
        break
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) || attempt + 1 >= state.config.receiptRetryAttempts) throw error
      }
    }
    const reviewer = !needsReview || state.config.reviewerPreset === undefined
      ? undefined
      : await this.ensureReviewer(state)
    return reviewer === undefined
      ? { kind: 'none' }
      : { kind: 'participant', reviewerId: reviewer.participant.id }
  }

  /** Create a default-worker task after coordinator authority has already been established. */
  private async createDefaultWorkerTask(
    state: RunState,
    request: {
      readonly createCommand: TeamTaskCreateCommandInput
      readonly subject: string
      readonly instructions: string
      readonly readScopes: readonly string[]
      readonly writeScopes: readonly string[]
    },
  ): Promise<TeamTaskSnapshot> {
    this.requireWorkerPreset(state)
    const reviewPolicy = await this.prepareDefaultWorkerTaskParticipants(state, request.writeScopes.length > 0)
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      try {
        const afterReviewer = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
        const coordinator = state.handle.coordinatorLease.localAgent
        if (coordinator === undefined) {
          throw new TeamRunError('default-worker task creation requires a resident coordinator', 'TEAM_RUN_COORDINATOR_INVALID')
        }
        return await this.withCoordinatorActorProof({ state, coordinator }, async actor =>
          await this.ctx.teams.createTask({
            actor,
            teamId: state.handle.teamId,
            expectedCursor: afterReviewer.team.cursor,
            createCommand: request.createCommand,
            subject: request.subject,
            description: request.instructions,
            blockedBy: [],
            requiredCapabilities: [state.config.workerCapability],
            priority: state.config.workerTaskPriority,
            readScopes: request.readScopes,
            writeScopes: request.writeScopes,
            workspaceMode: 'shared',
            budget: {},
            reviewPolicy,
            maxAttempts: state.config.workerTaskMaxAttempts,
          }))
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) || attempt + 1 === state.config.receiptRetryAttempts) throw error
      }
    }
    throw new TeamRunError('default-worker task creation exhausted its Team cursor retries', 'TEAM_RUN_NOT_QUIESCENT')
  }

  /** Revalidate an opaque coordinator capability and retain its exact current coordinator. */
  private async requireCoordinatorTaskControlAuthority(
    authority: TeamRunCoordinatorTaskAuthority,
  ): Promise<CoordinatorAuthorityState> {
    this.assertOpen()
    const retained = this.coordinatorTaskAuthorities.get(authority)
    if (retained === undefined || this.runs.get(retained.state.handle.teamId) !== retained.state) {
      throw new TeamRunError('default-worker tasks require the exact current coordinator activation', 'TEAM_RUN_COORDINATOR_INVALID')
    }
    await this.assertCoordinatorAuthority(retained.state, retained.coordinator, 'default-worker task control')
    return retained
  }

  /** Revalidate an opaque coordinator capability at its task-operation boundary. */
  private async requireCoordinatorTaskAuthority(authority: TeamRunCoordinatorTaskAuthority): Promise<RunState> {
    return (await this.requireCoordinatorTaskControlAuthority(authority)).state
  }

  /** Revalidate an opaque coordinator capability before a Team-goal operation. */
  private async requireCoordinatorGoalAuthority(
    authority: TeamRunCoordinatorGoalAuthority,
  ): Promise<CoordinatorAuthorityState> {
    this.assertOpen()
    const retained = this.coordinatorGoalAuthorities.get(authority)
    if (retained === undefined || this.runs.get(retained.state.handle.teamId) !== retained.state) {
      throw new TeamRunError('Team goal access requires the exact current coordinator activation', 'TEAM_RUN_COORDINATOR_INVALID')
    }
    await this.assertCoordinatorAuthority(retained.state, retained.coordinator, 'Team goal access')
    return retained
  }

  /** Issue one exact coordinator proof for one canonical Hub call and revoke it after settlement. */
  private async withCoordinatorActorProof<T>(
    retained: CoordinatorAuthorityState,
    operation: (actor: TeamActorProof) => Promise<T>,
  ): Promise<T> {
    this.assertOpen()
    await this.assertCoordinatorAuthority(retained.state, retained.coordinator, 'coordinator proof issuance')
    const issuer = this.coordinatorActorProofIssuer ??= this.ctx.teams.openActivationActorProofIssuer()
    const lease = issuer.issue(retained.state.handle.coordinatorLease.binding)
    this.coordinatorActorProofLeases.set(lease, retained.state)
    try {
      return await operation(lease.proof)
    } finally {
      lease.revoke()
      this.coordinatorActorProofLeases.delete(lease)
    }
  }

  /** Revoke every in-flight coordinator proof for one released run, or for the whole service during disposal. */
  private revokeCoordinatorActorProofLeases(state?: RunState): void {
    for (const [lease, owner] of this.coordinatorActorProofLeases) {
      if (state !== undefined && owner !== state) continue
      lease.revoke()
      this.coordinatorActorProofLeases.delete(lease)
    }
  }

  /** Retain a coordinator identity only while this local Team-run still owns it. */
  private mintCoordinatorAuthority(coordinator: Agent, operation: string): CoordinatorAuthorityState {
    const state = [...this.runs.values()].find(run => run.handle.coordinatorLease.localAgent === coordinator)
    if (state === undefined || this.ctx.agents.get(coordinator.id) !== coordinator) {
      throw new TeamRunError(`${operation} requires the exact current coordinator activation`, 'TEAM_RUN_COORDINATOR_INVALID')
    }
    return { state, coordinator }
  }

  /** Reject a task identifier that was not accepted through this coordinator's default-worker capability. */
  private requireDefaultWorkerTask(state: RunState, taskId: TeamTaskId, task?: TeamTaskSnapshot): void {
    if (!state.defaultWorkerTaskIds.has(taskId)
      || (task !== undefined && !sameStableTaskCreator(task.createCommand.creator, state.handle.coordinatorLease.binding))) {
      throw new TeamRunError('default-worker task access requires its creating coordinator authority', 'TEAM_RUN_COORDINATOR_INVALID')
    }
  }

  /** Verify that the coordinator capability still names the exact running Agent and durable activation. */
  private async assertCoordinatorAuthority(state: RunState, coordinator: Agent, operation: string): Promise<void> {
    const currentCoordinator = state.handle.coordinatorLease.localAgent
    const binding = state.handle.coordinatorLease.binding
    if (coordinator !== currentCoordinator
      || coordinator.status !== 'running'
      || this.ctx.agents.get(coordinator.id) !== coordinator
      || this.ctx.agents.currentInitiator() !== coordinator) {
      throw new TeamRunError(`${operation} requires the exact current coordinator activation`, 'TEAM_RUN_COORDINATOR_INVALID')
    }
    const current = await this.ctx.teams.getActivation({
      teamId: state.handle.teamId,
      activationId: binding.activation.id,
    })
    if (!sameStableTaskCreator(activationActor(binding), current)
      || (current.activation.status !== 'idle' && current.activation.status !== 'running')) {
      throw new TeamRunError(`${operation} requires a current coordinator activation`, 'TEAM_RUN_COORDINATOR_INVALID')
    }
  }

  /** Require a current coordinator turn to have admitted an exact trusted human direct Envelope. */
  private assertHumanDirectGoalInput(state: RunState, coordinator: Agent): void {
    const events = coordinator.session.events
    const boundary = events.findLastIndex(event => event.type === 'turn/start' || event.type === 'turn/end')
    const currentTurnHasHumanInput = boundary >= 0
      && events[boundary]?.type === 'turn/start'
      && events.slice(boundary + 1).some(event => event.type === 'user/message'
        && isExactHumanDirectSource(event.data.source, state))
    if (!currentTurnHasHumanInput) {
      throw new TeamRunError(
        'Team goal updates require a current human direct message from this Team channel',
        'TEAM_RUN_COORDINATOR_INVALID',
      )
    }
  }

  private requireWorkerPreset(state: RunState): void {
    if (state.config.workerPreset !== undefined) return
    throw new TeamRunError('default-worker task creation requires a configured non-delegating workerPreset', 'TEAM_RUN_WORKER_PRESET_REQUIRED')
  }

  /** Persist final acceptance through the current run's private proof after completion intent and before receipt. */
  private async admitHumanFinal(state: RunState, envelope: TeamEnvelope): Promise<void> {
    const actor = this.requireFinalReceiptProof(state)
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      try {
        await this.ctx.teams.admitTeamFinalResult({
          actor, teamId: state.handle.teamId, channelId: envelope.channelId, envelopeId: envelope.id,
          envelopeSequence: envelope.sequence, contentFingerprint: fingerprintTeamFinalContent(envelope.payload),
          idempotencyKey: teamFinalAdmissionIdempotencyKeySchema.parse(`team-run-final:${state.handle.teamId}`),
        })
        break
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) || attempt + 1 === state.config.receiptRetryAttempts) throw error
      }
    }
  }

  /** Record the already accepted final's human receipt through the current run's private proof. */
  private async acknowledgeHumanFinal(state: RunState, envelope: TeamEnvelope): Promise<void> {
    const actor = this.requireFinalReceiptProof(state)
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      const channel = await this.ctx.teams.getChannel({ channelId: state.handle.channel.manifest.id })
      try {
        await this.ctx.teams.ackChannelEnvelope({
          actor,
          channelId: channel.manifest.id,
          envelopeId: envelope.id,
          expectedCursor: channel.cursor,
        })
        return
      } catch (error: unknown) {
        if (!isChannelCursorConflict(error) || attempt + 1 === state.config.receiptRetryAttempts) throw error
      }
    }
  }

  /** Await the current run's actual workspace owners before final admission can require durable release. */
  private async settleFinalWorkspaces(state: RunState): Promise<void> {
    const owners = new Set([
      state.handle.coordinatorLease.localAgent,
      ...[...state.workerStates.values()].map(worker => worker.lease.localAgent),
      ...[...state.memberStates.values()].map(member => member.lease.localAgent),
      state.reviewer?.lease.localAgent,
    ].filter((agent): agent is Agent => agent !== undefined))
    const settled = await Promise.allSettled([...owners].map(agent => settleAgentWorkspaceLease(agent)))
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason as unknown)
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Team final workspace settlement failed')
  }

  private async assertNoUnfinishedTasks(state: RunState): Promise<void> {
    let afterCursor = -1
    for (;;) {
      const page = await this.ctx.teams.listTasksPage({
        teamId: state.handle.teamId,
        afterCursor,
        limit: Math.max(1, state.config.maxWorkerCount),
      })
      const unfinished = page.items.find(task => task.phase === 'pending'
        || task.phase === 'assigned'
        || task.phase === 'running'
        || task.phase === 'review')
      if (unfinished !== undefined) {
        throw new TeamRunError(`default Team retains unfinished task '${unfinished.id}'`, 'TEAM_RUN_NOT_QUIESCENT')
      }
      if (page.nextCursor === undefined) return
      if (page.nextCursor <= afterCursor) throw new TeamRunError('task list returned a non-advancing cursor', 'TEAM_RUN_NOT_QUIESCENT')
      afterCursor = page.nextCursor
    }
  }

  /** Cancel every pending task through the exact retained TeamRun cancellation identity after release. */
  private async cancelPendingTasks(state: RunState, cancellation: TeamCancellationSnapshot): Promise<void> {
    let current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    for (const task of current.tasks) {
      if (task.phase !== 'pending') continue
      let candidate = task
      for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
        try {
          const scope: TeamSystemCancellationCleanupScope = Object.freeze({
            kind: 'team-run-cancellation-task-cancel',
            teamId: state.handle.teamId,
            cancellationIdempotencyKey: cancellation.idempotencyKey,
            cancellationRequestedAt: cancellation.requestedAt,
            expectedTeamCursor: current.team.cursor,
            taskId: candidate.id,
            expectedRevision: candidate.revision,
          })
          await this.withCancellationCleanupProof(state, cancellation, scope, async actor =>
            await this.ctx.teams.cancelTeamCancellationTask({
              actor,
              teamId: state.handle.teamId,
              cancellationIdempotencyKey: cancellation.idempotencyKey,
              cancellationRequestedAt: cancellation.requestedAt,
              expectedTeamCursor: current.team.cursor,
              taskId: candidate.id,
              expectedRevision: candidate.revision,
            }))
          break
        } catch (error: unknown) {
          if (!(error instanceof TeamError) || (error.code !== 'TEAM_TASK_STALE_REVISION'
            && error.code !== 'TEAM_INVALID_ARGUMENT'
            && error.code !== 'TEAM_ACTOR_PROOF_INVALID')) {
            throw error
          }
          current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
          const refreshed = current.tasks.find(item => item.id === candidate.id)
          if (refreshed === undefined || refreshed.phase !== 'pending') break
          candidate = refreshed
          if (attempt + 1 === state.config.receiptRetryAttempts) {
            throw new TeamRunError('cancellation task cleanup exhausted its Team cursor retries', 'TEAM_RUN_NOT_QUIESCENT')
          }
        }
      }
      current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    }
  }

  /** Close every active channel through the exact retained TeamRun cancellation identity after release. */
  private async closeCancelledRunChannels(
    state: RunState,
    cancellation: TeamCancellationSnapshot,
    knownChannelId: ChannelId,
  ): Promise<void> {
    const initial = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    for (const channelId of initial.channelIds) {
      for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
        const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
        const channel = await this.ctx.teams.getChannel({ channelId })
        if (channel.phase === 'closed' || channel.phase === 'expired' || channel.phase === 'failed') break
        const reason = channelId === knownChannelId ? 'Team cancelled' : 'parent Team cancelled'
        try {
          const scope: TeamSystemCancellationCleanupScope = Object.freeze({
            kind: 'team-run-cancellation-channel-close',
            teamId: state.handle.teamId,
            cancellationIdempotencyKey: cancellation.idempotencyKey,
            cancellationRequestedAt: cancellation.requestedAt,
            expectedTeamCursor: current.team.cursor,
            channelId,
            expectedCursor: channel.cursor,
            reason,
          })
          await this.withCancellationCleanupProof(state, cancellation, scope, async actor =>
            await this.ctx.teams.closeTeamCancellationChannel({
              actor,
              teamId: state.handle.teamId,
              cancellationIdempotencyKey: cancellation.idempotencyKey,
              cancellationRequestedAt: cancellation.requestedAt,
              expectedTeamCursor: current.team.cursor,
              channelId,
              expectedCursor: channel.cursor,
              reason,
            }))
          break
        } catch (error: unknown) {
          if (!(error instanceof TeamError) || (error.code !== 'TEAM_CHANNEL_CURSOR_CONFLICT'
            && error.code !== 'TEAM_ACTOR_PROOF_INVALID')) {
            throw error
          }
          if (attempt + 1 === state.config.receiptRetryAttempts) {
            throw new TeamRunError('cancellation channel cleanup exhausted its Team cursor retries', 'TEAM_RUN_NOT_QUIESCENT')
          }
        }
      }
    }
  }

  /** Close every active channel through one exact post-release finalization proof per retry. */
  private async closeFinalizationChannels(state: RunState, finalEnvelopeId: TeamEnvelope['id']): Promise<void> {
    const finalChannelId = state.handle.channel.manifest.id
    const initial = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    for (const channelId of initial.channelIds) {
      for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
        const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
        const channel = await this.ctx.teams.getChannel({ channelId })
        if (channel.phase === 'closed' || channel.phase === 'expired' || channel.phase === 'failed') break
        const reason = channelId === finalChannelId ? 'Team completed' : 'parent Team completed'
        const scope: TeamSystemFinalizationCleanupScope = Object.freeze({
          kind: 'team-run-finalization-channel-close',
          teamId: state.handle.teamId,
          finalChannelId,
          finalEnvelopeId,
          humanId: state.handle.recipient.id,
          coordinatorId: state.handle.coordinator.id,
          expectedTeamCursor: current.team.cursor,
          channelId,
          expectedCursor: channel.cursor,
          reason,
        })
        try {
          await this.withFinalizationCleanupProof(state, scope, async actor =>
            await this.ctx.teams.closeTeamFinalizationChannel({
              actor,
              teamId: state.handle.teamId,
              finalChannelId,
              finalEnvelopeId,
              expectedTeamCursor: current.team.cursor,
              channelId,
              expectedCursor: channel.cursor,
              reason,
            }))
          break
        } catch (error: unknown) {
          if (!(error instanceof TeamError) || (error.code !== 'TEAM_CHANNEL_CURSOR_CONFLICT'
            && error.code !== 'TEAM_ACTOR_PROOF_INVALID')) {
            throw error
          }
          if (attempt + 1 === state.config.receiptRetryAttempts) {
            throw new TeamRunError('finalization channel cleanup exhausted its Team cursor retries', 'TEAM_RUN_NOT_QUIESCENT')
          }
        }
      }
    }
  }

  /** Settle only the default topology after final receipt and all local delivery work become durable. */
  private async complete(state: RunState, finalEnvelopeId: TeamEnvelope['id']): Promise<void> {
    const agent = state.handle.coordinatorLease.localAgent
    if (agent === undefined) {
      throw new TeamRunError('the default local coordinator is no longer resident', 'TEAM_RUN_NOT_QUIESCENT')
    }
    await this.assertNoUnfinishedTasks(state)
    await agent.whenIdle()
    if (this.ctx.get('teamClosureDriver') !== undefined) {
      await this.releaseRunWithRetries(state)
    } else {
      const coordinatorPending = await this.pendingCount(state.handle.channel.manifest.id, state.handle.coordinator.id)
      const humanPending = await this.pendingCount(state.handle.channel.manifest.id, state.handle.recipient.id)
      if (coordinatorPending !== 0 || humanPending !== 0) {
        throw new TeamRunError('the default Team channel retains unacknowledged delivery work', 'TEAM_RUN_NOT_QUIESCENT')
      }
      await this.fenceFinalizationAdmission(state, finalEnvelopeId)
      await this.releaseRun(state)
      await this.closeFinalizationChannels(state, finalEnvelopeId)
    }
    const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
    if (current.team.closure?.kind === 'complete') {
      const driver = this.ctx.get('teamClosureDriver') as TeamClosureDriverBridge | undefined
      await driver?.drive({ teamId: state.handle.teamId })
      const terminal = await this.waitForTerminalTeam(current)
      if (isTerminalTeamPhase(terminal.team.phase)) this.retainTerminalArchiveOwner(state, terminal)
    } else if (current.team.phase === 'active' || current.team.phase === 'quiescing') {
      const actor = this.mintCompleteClosureProof(state, finalEnvelopeId)
      try {
        const completed = await this.ctx.teams.completeTeam({
          teamId: state.handle.teamId,
          expectedCursor: current.team.cursor,
          idempotencyKey: closureKey('complete', state.handle.teamId),
          actor,
          reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'The coordinator final answer was accepted by the human participant.' },
          finalChannelId: state.handle.channel.manifest.id,
          finalEnvelopeId,
        })
        const terminal = isTerminalTeamPhase(completed.team.phase)
          ? completed
          : await this.waitForTerminalTeam(completed)
        if (isTerminalTeamPhase(terminal.team.phase)) this.retainTerminalArchiveOwner(state, terminal)
      } finally {
        this.revokeClosureProof(actor)
      }
    }
    this.runs.delete(state.handle.teamId)
    this.forgetStarts(state.handle.teamId)
  }

  /** Persist the completion intent before the final receipt or local teardown can race process loss. */
  private async admitCompletionIntent(
    state: RunState,
    finalEnvelopeId: TeamEnvelope['id'],
  ): Promise<TeamStateSnapshot> {
    let last: unknown
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
      if (current.team.closure?.kind === 'complete') return current
      if (current.team.cancellation !== undefined) {
        throw new TeamRunError('Team cancellation won before completion intent admission', 'TEAM_RUN_NOT_QUIESCENT')
      }
      const actor = this.mintCompleteClosureProof(state, finalEnvelopeId)
      try {
        return await this.ctx.teams.completeTeam({
          teamId: state.handle.teamId,
          expectedCursor: current.team.cursor,
          idempotencyKey: closureKey('complete', state.handle.teamId),
          actor,
          reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'The coordinator final answer was accepted by the human participant.' },
          finalChannelId: state.handle.channel.manifest.id,
          finalEnvelopeId,
        })
      } catch (error: unknown) {
        last = error
        if (!isTeamCursorConflict(error) || attempt + 1 === state.config.receiptRetryAttempts) throw error
      } finally {
        this.revokeClosureProof(actor)
      }
    }
    throw last
  }

  /** Wait for the durable terminal phase after completion intent acceptance. */
  private async waitForTerminalTeam(initial: TeamStateSnapshot): Promise<TeamStateSnapshot> {
    if (this.ctx.get('teamClosureDriver') === undefined) return initial
    let current = initial
    while (!isTerminalTeamPhase(current.team.phase)) {
      const watched = await this.ctx.teams.watchTeam({
        teamId: current.team.id,
        afterCursor: current.team.cursor,
      })
      assertTeamWatchAdvance(watched, current.team.cursor, 'completion wait')
      current = await this.ctx.teams.getTeam({ teamId: current.team.id })
      if (watched.kind === 'closed' && !isTerminalTeamPhase(current.team.phase)) {
        throw new TeamRunError(
          `Team '${current.team.id}' closed before completion reached a terminal phase`,
          'TEAM_RUN_NOT_QUIESCENT',
        )
      }
    }
    return current
  }

  /** Count recipient-visible pending delivery work for exactly one default direct channel participant. */
  private async pendingCount(channelId: ChannelId, participantId: ParticipantSnapshot['id']): Promise<number> {
    const pending = await this.ctx.teams.listChannelPendingDeliveries({
      channelId,
      participantId,
      afterCursor: -1,
      limit: 1,
    })
    return pending.deliveries.length
  }

  /** Wait for a channel advance or coordinator turn end without retaining a stale watch. */
  private async waitForChannelOrTurn(
    channelId: ChannelId,
    afterCursor: number,
    terminal: Promise<SessionEvent<'turn/end'>>,
    signal: AbortSignal | undefined,
  ): Promise<
    | { readonly kind: 'channel'; readonly value: Awaited<ReturnType<Context['teams']['watchChannel']>> }
    | { readonly kind: 'turn-end'; readonly event: SessionEvent<'turn/end'> }
  > {
    if (signal?.aborted) throw signal.reason
    const controller = new AbortController()
    const cancelled = Promise.withResolvers<never>()
    const abort = () => {
      cancelled.reject(signal?.reason)
      controller.abort(signal?.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
    const watch = this.ctx.teams.watchChannel({
      channelId,
      afterCursor,
      signal: controller.signal,
    })
    void watch.catch(() => {})
    try {
      const next = await Promise.race([
        watch.then((value) => {
          if (value.kind === 'changed' && value.cursor <= afterCursor) {
            throw new TeamError('channel wait received a non-advancing cursor', 'TEAM_CHANNEL_CURSOR_CONFLICT')
          }
          return { kind: 'channel' as const, value }
        }),
        terminal.then(event => ({ kind: 'turn-end' as const, event })),
        cancelled.promise,
      ])
      return next
    } finally {
      controller.abort()
      signal?.removeEventListener('abort', abort)
    }
  }

  /** Mark an incompletely created Team failed after releasing any published local resources. */
  private async failCreation(teamId: TeamId, original: unknown): Promise<void> {
    const state = await this.ctx.teams.getTeam({ teamId })
    if (state.team.phase === 'active' || state.team.phase === 'provisioning') {
      const actor = this.mintCreateFailureClosureProof(teamId)
      try {
        await this.ctx.teams.failTeam({
          teamId,
          expectedCursor: state.team.cursor,
          idempotencyKey: closureKey('fail', teamId),
          actor,
          reason: { code: 'TEAM_RUN_CREATION_FAILED', message: errorMessage(original) },
        })
        const driver = this.ctx.get('teamClosureDriver') as TeamClosureDriverBridge | undefined
        await driver?.drive({ teamId })
      } finally {
        this.revokeClosureProof(actor)
      }
    }
  }

  /** Release all current local leases while leaving durable Teams available for a later resume owner. */
  private async dispose(): Promise<void> {
    this.closing = true
    for (const dispose of this.listeners.splice(0)) dispose()
    this.admissionAbort.abort()
    const childStarts = [...this.childStarts.values()]
    for (const child of childStarts) child.abort.abort(this.admissionAbort.signal.reason)
    await Promise.allSettled(childStarts.map(child => child.operation))
    this.childChannelProofs.clear()
    this.childResultProofs.clear()
    this.coordinatorActorProofIssuer?.close()
    this.revokeCoordinatorActorProofLeases()
    this.revokeTaskControlProofs()
    this.rootCreationProofs.clear()
    this.archiveProofs.clear()
    this.terminalArchiveOwners.clear()
    this.revokeCancellationCleanupProofs()
    this.revokeFinalizationCleanupProofs()
    this.revokeTopologyProofs()
    this.bootstrapTopologies.clear()
    this.revokeWorkflowProofs()
    this.revokeAllResumePhaseProofs()
    this.revokeFinalizationQuiescePhaseProofs()
    this.revokeInterruptProofs()
    const states = [...this.runs.values()]
    const results = await Promise.allSettled(states.map(async (state) => { await this.releaseRunWithRetries(state) }))
    this.runs.clear()
    this.resumes.clear()
    this.starts.clear()
    this.workflowStarts.clear()
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason as unknown)
    if (failures.length > 0) throw new AggregateError(failures, 'Team-run disposal failed')
  }

  /** Release the default worker before its coordinator, while attempting every owned cleanup. */
  private async releaseRunWithRetries(state: RunState): Promise<void> {
    let last: unknown
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      try {
        await this.releaseRun(state)
        return
      } catch (error: unknown) {
        last = error
        if (!hasTeamCursorConflict(error) || attempt + 1 === state.config.receiptRetryAttempts) throw error
      }
    }
    throw last
  }

  /** Release the default worker before its coordinator, while attempting every owned cleanup. */
  private async releaseRun(state: RunState): Promise<void> {
    state.topologyReleased = true
    this.revokeCoordinatorActorProofLeases(state)
    this.revokeTaskControlProofs(state)
    this.revokeFinalizationCleanupProofs(state)
    this.revokeTopologyProofs(state)
    this.revokeWorkflowProofs(state)
    this.revokeFinalizationQuiescePhaseProofs(state)
    this.revokeInterruptProofs(state)
    this.revokeFinalReceiptProof(state)
    this.revokeEnvelopePostProof(state)
    const failures: unknown[] = []
    try {
      await this.releaseReviewer(state)
    } catch (error: unknown) {
      failures.push(error)
    }
    try {
      await state.workerPoolMutation
    } catch (error: unknown) {
      // A queued coordinator operation may already have failed after release began.
      failures.push(error)
    }
    try {
      await this.releaseWorker(state)
    } catch (error: unknown) {
      failures.push(error)
    }
    const members = await Promise.allSettled([...state.memberStates.values()].map(async (member) => {
      member.disposePrompt()
      await member.lease.dispose()
    }))
    failures.push(...members.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []))
    if (members.every(result => result.status === 'fulfilled')) state.memberStates.clear()
    try {
      state.disposePrompt()
      await state.handle.coordinatorLease.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Team-run lease disposal failed')
  }

  private async releaseWorker(state: RunState): Promise<void> {
    await Promise.allSettled([...state.workerActivations.values()])
    const workers = [...state.workerStates.entries()]
    const results = await Promise.allSettled(workers.map(async ([, worker]) => {
      worker.disposePrompt()
      await worker.lease.dispose()
    }))
    for (const [index, result] of results.entries()) {
      const worker = workers[index]
      if (worker !== undefined && result.status === 'fulfilled' && state.workerStates.get(worker[0]) === worker[1]) {
        state.workerStates.delete(worker[0])
      }
    }
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason as unknown)
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Team-run worker-pool lease disposal failed')
  }

  /** Release the lazily provisioned reviewer before its coordinator owner. */
  private async releaseReviewer(state: RunState): Promise<void> {
    if (state.reviewer === undefined && state.reviewerActivation !== undefined) {
      try {
        state.reviewer = await state.reviewerActivation
      } catch {
        return
      }
    }
    const reviewer = state.reviewer
    if (reviewer === undefined) return
    state.reviewer = undefined
    reviewer.disposePrompt()
    await reviewer.lease.dispose()
  }

  /** Resolve a current local run without guessing durable topology after process restart. */
  private requireRun(teamId: TeamId): RunState {
    this.assertOpen()
    const state = this.runs.get(teamId)
    if (state === undefined) {
      throw new TeamRunError(`Team '${teamId}' is not owned by this local Team-run instance`, 'TEAM_RUN_NOT_FOUND')
    }
    return state
  }

  /** Issue one exact root-creation proof and revoke it after the single Hub admission settles. */
  private async withRootCreationProof<T>(
    scope: TeamSystemRootCreationScope,
    operation: (actor: TeamSystemRootCreationProof) => Promise<T>,
  ): Promise<T> {
    this.assertOpen()
    const proof = createTeamRunRootCreationProof()
    this.rootCreationProofs.set(proof, Object.freeze({ scope: structuredClone(scope) }))
    try {
      return await operation(proof)
    } finally {
      this.revokeRootCreationProof(proof)
    }
  }

  /** Resolve one root-creation proof only while this TeamRun service remains open. */
  private resolveRootCreationProof(proof: TeamSystemRootCreationProof): TeamSystemRootCreationScope | undefined {
    if (this.closing) return undefined
    return this.rootCreationProofs.get(proof)?.scope
  }

  /** Revoke one transient root-creation proof after its canonical Hub admission settles. */
  private revokeRootCreationProof(proof: TeamSystemRootCreationProof): void {
    this.rootCreationProofs.delete(proof)
  }

  /** Retain terminal archive ownership only for a Team this service itself settled. */
  private retainTerminalArchiveOwner(state: RunState, terminal: TeamStateSnapshot): void {
    if (this.runs.get(state.handle.teamId) !== state
      || terminal.team.id !== state.handle.teamId
      || !isTerminalTeamPhase(terminal.team.phase)) {
      throw new TeamRunError('terminal archive ownership requires this current local Team-run terminal state', 'TEAM_RUN_NOT_QUIESCENT')
    }
    this.terminalArchiveOwners.set(terminal.team.id, Object.freeze({ teamId: terminal.team.id }))
  }

  /** Resolve one terminal archive proof only while its local terminal owner remains retained. */
  private resolveArchiveProof(proof: TeamSystemArchiveProof): TeamSystemArchiveScope | undefined {
    const record = this.archiveProofs.get(proof)
    if (record === undefined || this.closing || this.terminalArchiveOwners.get(record.scope.teamId) !== record.owner) return undefined
    return record.scope
  }

  /** Revoke one transient terminal archive proof after its canonical Hub call settles. */
  private revokeArchiveProof(proof: TeamSystemArchiveProof): void {
    this.archiveProofs.delete(proof)
  }

  /** Mint the one source-owned proof for an already retained default topology. */
  private mintFinalReceiptProof(state: RunState): void {
    if (this.runs.get(state.handle.teamId) !== state) {
      throw new TeamRunError('final receipt proof requires the current local Team-run state', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const proof = createTeamRunFinalReceiptProof()
    const scope: TeamSystemFinalReceiptScope = Object.freeze({
      teamId: state.handle.teamId,
      channelId: state.handle.channel.manifest.id,
      humanId: state.handle.recipient.id,
      coordinatorId: state.handle.coordinator.id,
    })
    this.finalReceiptProofs.set(proof, Object.freeze({ state, scope }))
    this.finalReceiptProofsByRun.set(state, proof)
  }

  /** Resolve one source-owned proof only while its exact state remains the current local run. */
  private resolveFinalReceiptProof(proof: TeamSystemFinalReceiptProof): TeamSystemFinalReceiptScope | undefined {
    const record = this.finalReceiptProofs.get(proof)
    if (record === undefined || this.runs.get(record.scope.teamId) !== record.state) return undefined
    const { state, scope } = record
    if (scope.teamId !== state.handle.teamId
      || scope.channelId !== state.handle.channel.manifest.id
      || scope.humanId !== state.handle.recipient.id
      || scope.coordinatorId !== state.handle.coordinator.id) {
      return undefined
    }
    return scope
  }

  /** Resolve only the proof whose retained scope still exactly matches this local default topology. */
  private requireFinalReceiptProof(state: RunState): TeamSystemFinalReceiptProof {
    const proof = this.finalReceiptProofsByRun.get(state)
    const record = proof === undefined ? undefined : this.finalReceiptProofs.get(proof)
    if (proof === undefined || record === undefined) {
      throw new TeamRunError('final receipt authority is no longer current for this local Team run', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const { scope } = record
    if (record.state !== state
      || this.runs.get(state.handle.teamId) !== state
      || scope.teamId !== state.handle.teamId
      || scope.channelId !== state.handle.channel.manifest.id
      || scope.humanId !== state.handle.recipient.id
      || scope.coordinatorId !== state.handle.coordinator.id) {
      throw new TeamRunError('final receipt authority is no longer current for this local Team run', 'TEAM_RUN_NOT_QUIESCENT')
    }
    return proof
  }

  /** Revoke this run's proof before any local lease can leave the current owner. */
  private revokeFinalReceiptProof(state: RunState): void {
    const proof = this.finalReceiptProofsByRun.get(state)
    if (proof === undefined) return
    this.finalReceiptProofsByRun.delete(state)
    this.finalReceiptProofs.delete(proof)
  }

  /** Mint the one source-owned proof for an already retained default human-input topology. */
  private mintEnvelopePostProof(state: RunState): void {
    if (this.runs.get(state.handle.teamId) !== state) {
      throw new TeamRunError('human-input proof requires the current local Team-run state', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const proof = createTeamRunEnvelopePostProof()
    const scope: TeamSystemEnvelopePostScope = Object.freeze({
      kind: 'team-run-human-input',
      teamId: state.handle.teamId,
      channelId: state.handle.channel.manifest.id,
      humanId: state.handle.recipient.id,
      coordinatorId: state.handle.coordinator.id,
    })
    this.envelopePostProofs.set(proof, Object.freeze({ state, scope }))
    this.envelopePostProofsByRun.set(state, proof)
  }

  /** Resolve one source-owned human-input proof only while its run remains current. */
  private resolveEnvelopePostProof(proof: TeamSystemEnvelopePostProof): TeamSystemEnvelopePostScope | undefined {
    const record = this.envelopePostProofs.get(proof)
    if (record === undefined || record.scope.kind !== 'team-run-human-input'
      || this.runs.get(record.scope.teamId) !== record.state) return undefined
    const { state, scope } = record
    if (scope.kind !== 'team-run-human-input'
      || scope.teamId !== state.handle.teamId
      || scope.channelId !== state.handle.channel.manifest.id
      || scope.humanId !== state.handle.recipient.id
      || scope.coordinatorId !== state.handle.coordinator.id) return undefined
    return scope
  }

  /** Resolve only the human-input proof whose retained scope matches this current default topology. */
  private requireEnvelopePostProof(state: RunState): TeamSystemEnvelopePostProof {
    const proof = this.envelopePostProofsByRun.get(state)
    const record = proof === undefined ? undefined : this.envelopePostProofs.get(proof)
    if (proof === undefined || record === undefined
      || record.state !== state
      || this.runs.get(state.handle.teamId) !== state
      || record.scope.kind !== 'team-run-human-input'
      || record.scope.teamId !== state.handle.teamId
      || record.scope.channelId !== state.handle.channel.manifest.id
      || record.scope.humanId !== state.handle.recipient.id
      || record.scope.coordinatorId !== state.handle.coordinator.id) {
      throw new TeamRunError('human-input authority is no longer current for this local Team run', 'TEAM_RUN_NOT_QUIESCENT')
    }
    return proof
  }

  /** Revoke this run's human-input proof before local ownership can leave the current TeamRun. */
  private revokeEnvelopePostProof(state: RunState): void {
    const proof = this.envelopePostProofsByRun.get(state)
    if (proof === undefined) return
    this.envelopePostProofsByRun.delete(state)
    this.envelopePostProofs.delete(proof)
  }

  /** Mint one completion proof tied to the retained default topology and final Envelope. */
  private mintCompleteClosureProof(state: RunState, finalEnvelopeId: TeamEnvelope['id']): TeamSystemClosureProof {
    return this.mintClosureProof(state, Object.freeze({
      kind: 'team-run-complete' as const,
      teamId: state.handle.teamId,
      channelId: state.handle.channel.manifest.id,
      humanId: state.handle.recipient.id,
      coordinatorId: state.handle.coordinator.id,
      finalEnvelopeId,
    }))
  }

  /** Mint one cancellation proof tied to the retained default human/coordinator topology. */
  private mintCancelClosureProof(state: RunState): TeamSystemClosureProof {
    return this.mintClosureProof(state, Object.freeze({
      kind: 'team-run-cancel' as const,
      teamId: state.handle.teamId,
      channelId: state.handle.channel.manifest.id,
      humanId: state.handle.recipient.id,
      coordinatorId: state.handle.coordinator.id,
    }))
  }

  /** Mint one failure proof only while no local run has been published for the partially created Team. */
  private mintCreateFailureClosureProof(teamId: TeamId): TeamSystemClosureProof {
    if (this.runs.has(teamId)) {
      throw new TeamRunError('creation-failure closure authority requires no current local Team run', 'TEAM_RUN_NOT_QUIESCENT')
    }
    return this.mintClosureProof(undefined, Object.freeze({ kind: 'team-run-create-failure' as const, teamId }))
  }

  /** Retain one source-owned closure token until its single Hub call completes. */
  private mintClosureProof(
    state: RunState | undefined,
    scope: TeamSystemClosureScope,
  ): TeamSystemClosureProof {
    if (state !== undefined && this.runs.get(scope.teamId) !== state) {
      throw new TeamRunError('closure authority requires the current local Team-run state', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const proof = createTeamRunClosureProof()
    this.closureProofs.set(proof, Object.freeze({
      scope,
      ...state === undefined ? {} : { state },
    }))
    return proof
  }

  /** Resolve one closure proof only while its exact TeamRun operation remains current. */
  private resolveClosureProof(proof: TeamSystemClosureProof): TeamSystemClosureScope | undefined {
    const record = this.closureProofs.get(proof)
    if (record === undefined) return undefined
    const { scope, state } = record
    switch (scope.kind) {
      case 'team-run-create-failure':
        return state === undefined && !this.runs.has(scope.teamId) ? scope : undefined
      case 'team-run-complete':
      case 'team-run-cancel':
        return state !== undefined && this.matchesCurrentClosureScope(state, scope) ? scope : undefined
      default:
        return assertNever(scope, 'Team-run closure scope')
    }
  }

  /** Require a retained completion/cancellation scope to match the exact current default topology. */
  private matchesCurrentClosureScope(
    state: RunState,
    scope: Exclude<TeamSystemClosureScope, { readonly kind: 'team-run-create-failure' }>,
  ): boolean {
    return this.runs.get(scope.teamId) === state
      && scope.teamId === state.handle.teamId
      && scope.channelId === state.handle.channel.manifest.id
      && scope.humanId === state.handle.recipient.id
      && scope.coordinatorId === state.handle.coordinator.id
  }

  /** Revoke a closure proof immediately after its one Hub call settles. */
  private revokeClosureProof(proof: TeamSystemClosureProof): void {
    this.closureProofs.delete(proof)
  }

  /** Resume one stalled Team only through a source-owned active-phase proof. */
  private async resumeStalledTeam(
    state: TeamStateSnapshot,
    authorization?: TeamHumanResumeAuthorization,
  ): Promise<TeamStateSnapshot> {
    await authorization?.assert()
    const actor = this.mintResumePhaseProof(state, authorization)
    try {
      const resumed = await this.ctx.teams.transitionTeamPhase({
        teamId: state.team.id,
        expectedCursor: state.team.cursor,
        phase: 'active',
        actor,
      })
      await authorization?.assert()
      return resumed
    } finally {
      this.revokeResumePhaseProof(actor)
    }
  }

  /** Fence new channel admission after a human-receipted final and before local coordinator release. */
  private async fenceFinalizationAdmission(
    state: RunState,
    finalEnvelopeId: TeamEnvelope['id'],
  ): Promise<TeamStateSnapshot> {
    let lastConflict: unknown
    for (let attempt = 0; attempt < state.config.receiptRetryAttempts; attempt += 1) {
      const current = await this.ctx.teams.getTeam({ teamId: state.handle.teamId })
      if (current.team.cancellation !== undefined) {
        throw new TeamRunError('Team cancellation won before final result admission could quiesce the Team', 'TEAM_RUN_NOT_QUIESCENT')
      }
      if (current.team.closure?.kind === 'complete'
        && current.team.closure.finalChannelId === state.handle.channel.manifest.id
        && current.team.closure.finalEnvelopeId === finalEnvelopeId) return current
      if (current.team.phase === 'completed') return current
      if (current.team.phase !== 'active' && current.team.phase !== 'quiescing') {
        throw new TeamRunError(`Team '${state.handle.teamId}' cannot admit a final result from '${current.team.phase}'`, 'TEAM_RUN_NOT_QUIESCENT')
      }
      const actor = this.mintFinalizationQuiescePhaseProof(state, current, finalEnvelopeId)
      try {
        return await this.ctx.teams.transitionTeamPhase({
          teamId: state.handle.teamId,
          expectedCursor: current.team.cursor,
          phase: 'quiescing',
          actor,
        })
      } catch (error: unknown) {
        const recovered = await this.ctx.teams.getTeam({ teamId: state.handle.teamId }).catch(() => undefined)
        if (recovered?.team.cancellation !== undefined) {
          throw new TeamRunError('Team cancellation won before final result admission could quiesce the Team', 'TEAM_RUN_NOT_QUIESCENT')
        }
        if (state.topologyReleased
          || (!isTeamCursorConflict(error) && !(error instanceof TeamError && error.code === 'TEAM_ACTOR_PROOF_INVALID'))
          || attempt + 1 === state.config.receiptRetryAttempts) {
          throw error
        }
        lastConflict = error
      } finally {
        this.revokeFinalizationQuiescePhaseProof(actor)
      }
    }
    throw lastConflict
  }

  /** Mint one exact current-run final-result admission proof before coordinator release begins. */
  private mintFinalizationQuiescePhaseProof(
    state: RunState,
    current: TeamStateSnapshot,
    finalEnvelopeId: TeamEnvelope['id'],
  ): TeamSystemPhaseProof {
    if (this.runs.get(state.handle.teamId) !== state
      || state.topologyReleased
      || current.team.id !== state.handle.teamId
      || current.team.phase !== 'active' && current.team.phase !== 'quiescing') {
      throw new TeamRunError('final result admission authority is no longer current for this local Team run', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const proof = createTeamRunPhaseProof()
    const scope = Object.freeze({
      kind: 'team-run-finalization-quiesce' as const,
      teamId: state.handle.teamId,
      expectedCursor: current.team.cursor,
      phase: 'quiescing' as const,
      finalChannelId: state.handle.channel.manifest.id,
      finalEnvelopeId,
      humanId: state.handle.recipient.id,
      coordinatorId: state.handle.coordinator.id,
    })
    this.finalizationQuiescePhaseProofs.set(proof, Object.freeze({ state, scope }))
    return proof
  }

  /** Resolve a final-result admission proof only while its exact current TeamRun is still unreleased. */
  private resolveFinalizationQuiescePhaseProof(
    proof: TeamSystemPhaseProof,
  ): TeamSystemPhaseScope | undefined {
    const record = this.finalizationQuiescePhaseProofs.get(proof)
    if (record === undefined
      || this.closing
      || record.state.topologyReleased
      || this.runs.get(record.scope.teamId) !== record.state
      || record.scope.teamId !== record.state.handle.teamId
      || record.scope.finalChannelId !== record.state.handle.channel.manifest.id
      || record.scope.humanId !== record.state.handle.recipient.id
      || record.scope.coordinatorId !== record.state.handle.coordinator.id) {
      return undefined
    }
    return record.scope
  }

  /** Resolve either a stalled-Team resume proof or an exact final-result admission proof. */
  private resolveTeamRunPhaseProof(proof: TeamSystemPhaseProof): TeamSystemPhaseScope | undefined {
    return this.resolveResumePhaseProof(proof) ?? this.resolveFinalizationQuiescePhaseProof(proof)
  }

  /** Revoke one final-result admission proof after its canonical phase command settles. */
  private revokeFinalizationQuiescePhaseProof(proof: TeamSystemPhaseProof): void {
    this.finalizationQuiescePhaseProofs.delete(proof)
  }

  /** Revoke final-result admission proofs owned by one released run, or all proofs during disposal. */
  private revokeFinalizationQuiescePhaseProofs(state?: RunState): void {
    for (const [proof, record] of this.finalizationQuiescePhaseProofs) {
      if (state !== undefined && record.state !== state) continue
      this.finalizationQuiescePhaseProofs.delete(proof)
    }
  }

  /** Mint one proof for the current stalled Team only while no replacement local run is published. */
  private mintResumePhaseProof(
    state: TeamStateSnapshot,
    authorization?: TeamHumanResumeAuthorization,
  ): TeamSystemPhaseProof {
    if (state.team.phase !== 'stalled'
      || this.runs.has(state.team.id)
      || this.resumePhaseProofByTeam.has(state.team.id)) {
      throw new TeamRunError('stalled-Team resume authority is not current', 'TEAM_RUN_START_CONFLICT')
    }
    const proof = createTeamRunPhaseProof()
    const scope = Object.freeze({
      kind: 'team-run-resume' as const,
      teamId: state.team.id,
      phase: 'active' as const,
    })
    this.resumePhaseProofs.set(proof, Object.freeze({
      scope,
      ...authorization === undefined ? {} : { authorization },
    }))
    this.resumePhaseProofByTeam.set(scope.teamId, proof)
    return proof
  }

  /** Resolve only the transient proof for an unreclaimed stalled Team. */
  private resolveResumePhaseProof(proof: TeamSystemPhaseProof): TeamSystemPhaseScope | undefined {
    const record = this.resumePhaseProofs.get(proof)
    if (record === undefined
      || this.resumePhaseProofByTeam.get(record.scope.teamId) !== proof
      || this.runs.has(record.scope.teamId)
      || record.authorization?.isLive() === false) return undefined
    return record.scope
  }

  /** Revoke one transient resume proof after its canonical Hub call settles. */
  private revokeResumePhaseProof(proof: TeamSystemPhaseProof): void {
    const record = this.resumePhaseProofs.get(proof)
    this.resumePhaseProofs.delete(proof)
    if (record !== undefined && this.resumePhaseProofByTeam.get(record.scope.teamId) === proof) {
      this.resumePhaseProofByTeam.delete(record.scope.teamId)
    }
  }

  /** Revoke every transient resume proof while this TeamRun service is disposing. */
  private revokeAllResumePhaseProofs(): void {
    for (const proof of this.resumePhaseProofByTeam.values()) this.resumePhaseProofs.delete(proof)
    this.resumePhaseProofByTeam.clear()
  }

  /** Issue one exact human-to-coordinator interrupt proof for a single Hub request and revoke it after settlement. */
  private async withCoordinatorInterruptProof<T>(
    state: RunState,
    operation: (actor: TeamSystemInterruptProof) => Promise<T>,
  ): Promise<T> {
    if (this.runs.get(state.handle.teamId) !== state) {
      throw new TeamRunError('coordinator interrupt authority is no longer current for this local Team run', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const proof = createTeamRunInterruptProof()
    const scope = Object.freeze({
      kind: 'team-run-human-interrupt' as const,
      teamId: state.handle.teamId,
      channelId: state.handle.channel.manifest.id,
      humanId: state.handle.recipient.id,
      coordinatorId: state.handle.coordinator.id,
    })
    this.interruptProofs.set(proof, Object.freeze({ state, scope }))
    try {
      return await operation(proof)
    } finally {
      this.revokeInterruptProof(proof)
    }
  }

  /** Resolve one interrupt proof only while its exact TeamRun and default topology remain current. */
  private resolveInterruptProof(proof: TeamSystemInterruptProof): TeamSystemInterruptScope | undefined {
    const record = this.interruptProofs.get(proof)
    if (record === undefined || this.runs.get(record.scope.teamId) !== record.state) return undefined
    const { state, scope } = record
    if (scope.teamId !== state.handle.teamId
      || scope.channelId !== state.handle.channel.manifest.id
      || scope.humanId !== state.handle.recipient.id
      || scope.coordinatorId !== state.handle.coordinator.id) return undefined
    return scope
  }

  /** Revoke one transient interrupt proof after its canonical Hub request settles. */
  private revokeInterruptProof(proof: TeamSystemInterruptProof): void {
    this.interruptProofs.delete(proof)
  }

  /** Revoke all interrupt proofs owned by one released TeamRun, or every proof during service disposal. */
  private revokeInterruptProofs(state?: RunState): void {
    for (const [proof, record] of this.interruptProofs) {
      if (state !== undefined && record.state !== state) continue
      this.interruptProofs.delete(proof)
    }
  }

  /** Issue one exact default-worker task-control proof for a canonical Hub mutation and revoke it after settlement. */
  private async withTaskControlProof<T>(
    state: RunState,
    coordinator: Agent,
    scope: TeamSystemTaskControlScope,
    operation: (actor: TeamSystemTaskControlProof) => Promise<T>,
  ): Promise<T> {
    this.assertOpen()
    await this.assertCoordinatorAuthority(state, coordinator, 'default-worker task-control proof issuance')
    const binding = state.handle.coordinatorLease.binding
    if (scope.teamId !== state.handle.teamId
      || this.runs.get(scope.teamId) !== state
      || scope.coordinator.teamId !== binding.activation.teamId
      || scope.coordinator.participantId !== binding.activation.participantId
      || scope.coordinator.activationId !== binding.activation.id
      || scope.coordinator.sessionId !== binding.sessionId
      || scope.coordinator.provider !== binding.provider) {
      throw new TeamRunError('default-worker task-control authority is no longer current for this local Team run', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const proof = createTeamRunTaskControlProof()
    this.taskControlProofs.set(proof, Object.freeze({ state, coordinator, scope: structuredClone(scope) }))
    try {
      return await operation(proof)
    } finally {
      this.revokeTaskControlProof(proof)
    }
  }

  /** Resolve one task-control proof only while its exact TeamRun and coordinator remain current. */
  private resolveTaskControlProof(proof: TeamSystemTaskControlProof): TeamSystemTaskControlScope | undefined {
    const record = this.taskControlProofs.get(proof)
    if (record === undefined || this.closing || this.runs.get(record.scope.teamId) !== record.state) return undefined
    const binding = record.state.handle.coordinatorLease.binding
    if (record.scope.teamId !== record.state.handle.teamId
      || record.state.handle.coordinatorLease.localAgent !== record.coordinator
      || record.coordinator.status !== 'running'
      || this.ctx.agents.get(record.coordinator.id) !== record.coordinator
      || this.ctx.agents.currentInitiator() !== record.coordinator
      || record.scope.coordinator.teamId !== binding.activation.teamId
      || record.scope.coordinator.participantId !== binding.activation.participantId
      || record.scope.coordinator.activationId !== binding.activation.id
      || record.scope.coordinator.sessionId !== binding.sessionId
      || record.scope.coordinator.provider !== binding.provider) return undefined
    return record.scope
  }

  /** Revoke one transient default-worker task-control proof after its canonical Hub call settles. */
  private revokeTaskControlProof(proof: TeamSystemTaskControlProof): void {
    this.taskControlProofs.delete(proof)
  }

  /** Revoke task-control proofs owned by one released run, or every proof during service disposal. */
  private revokeTaskControlProofs(state?: RunState): void {
    for (const [proof, record] of this.taskControlProofs) {
      if (state !== undefined && record.state !== state) continue
      this.taskControlProofs.delete(proof)
    }
  }

  /** Issue one exact post-release cancellation-cleanup proof and revoke it after its Hub mutation settles. */
  private async withCancellationCleanupProof<T>(
    state: RunState,
    cancellation: TeamCancellationSnapshot,
    scope: TeamSystemCancellationCleanupScope,
    operation: (actor: TeamSystemCancellationCleanupProof) => Promise<T>,
  ): Promise<T> {
    this.assertOpen()
    if (this.runs.get(state.handle.teamId) !== state
      || scope.teamId !== state.handle.teamId
      || scope.cancellationIdempotencyKey !== cancellation.idempotencyKey
      || scope.cancellationRequestedAt !== cancellation.requestedAt) {
      throw new TeamRunError('cancellation cleanup authority is no longer current for this local Team run', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const proof = createTeamRunCancellationCleanupProof()
    this.cancellationCleanupProofs.set(proof, Object.freeze({
      state,
      cancellation: structuredClone(cancellation),
      scope: structuredClone(scope),
    }))
    try {
      return await operation(proof)
    } finally {
      this.revokeCancellationCleanupProof(proof)
    }
  }

  /** Resolve one cleanup proof only while the exact local run and cancellation identity remain retained. */
  private resolveCancellationCleanupProof(
    proof: TeamSystemCancellationCleanupProof,
  ): TeamSystemCancellationCleanupScope | undefined {
    const record = this.cancellationCleanupProofs.get(proof)
    if (record === undefined || this.closing || this.runs.get(record.scope.teamId) !== record.state) return undefined
    if (record.scope.teamId !== record.state.handle.teamId
      || record.scope.cancellationIdempotencyKey !== record.cancellation.idempotencyKey
      || record.scope.cancellationRequestedAt !== record.cancellation.requestedAt
      || record.cancellation.teamId !== record.state.handle.teamId
      || record.cancellation.actor.kind !== 'system'
      || record.cancellation.actor.name !== TEAM_RUN_CANCELLATION_CLEANUP_PROOF_SOURCE) return undefined
    return record.scope
  }

  /** Revoke one transient cancellation-cleanup proof after its canonical Hub mutation settles. */
  private revokeCancellationCleanupProof(proof: TeamSystemCancellationCleanupProof): void {
    this.cancellationCleanupProofs.delete(proof)
  }

  /** Revoke cancellation-cleanup proofs owned by one retained run, or every proof during service disposal. */
  private revokeCancellationCleanupProofs(state?: RunState): void {
    for (const [proof, record] of this.cancellationCleanupProofs) {
      if (state !== undefined && record.state !== state) continue
      this.cancellationCleanupProofs.delete(proof)
    }
  }

  /** Issue one exact post-release finalization-cleanup proof and revoke it after its Hub mutation settles. */
  private async withFinalizationCleanupProof<T>(
    state: RunState,
    scope: TeamSystemFinalizationCleanupScope,
    operation: (actor: TeamSystemFinalizationCleanupProof) => Promise<T>,
  ): Promise<T> {
    this.assertOpen()
    if (this.runs.get(state.handle.teamId) !== state
      || scope.teamId !== state.handle.teamId
      || scope.finalChannelId !== state.handle.channel.manifest.id
      || scope.humanId !== state.handle.recipient.id
      || scope.coordinatorId !== state.handle.coordinator.id) {
      throw new TeamRunError('finalization cleanup authority is no longer current for this local Team run', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const proof = createTeamRunFinalizationCleanupProof()
    this.finalizationCleanupProofs.set(proof, Object.freeze({ state, scope: structuredClone(scope) }))
    try {
      return await operation(proof)
    } finally {
      this.revokeFinalizationCleanupProof(proof)
    }
  }

  /** Resolve one finalization-cleanup proof only while its exact released TeamRun remains retained. */
  private resolveFinalizationCleanupProof(
    proof: TeamSystemFinalizationCleanupProof,
  ): TeamSystemFinalizationCleanupScope | undefined {
    const record = this.finalizationCleanupProofs.get(proof)
    if (record === undefined || this.closing || this.runs.get(record.scope.teamId) !== record.state) return undefined
    if (record.scope.teamId !== record.state.handle.teamId
      || record.scope.finalChannelId !== record.state.handle.channel.manifest.id
      || record.scope.humanId !== record.state.handle.recipient.id
      || record.scope.coordinatorId !== record.state.handle.coordinator.id) return undefined
    return record.scope
  }

  /** Revoke one transient finalization-cleanup proof after its canonical Hub call settles. */
  private revokeFinalizationCleanupProof(proof: TeamSystemFinalizationCleanupProof): void {
    this.finalizationCleanupProofs.delete(proof)
  }

  /** Revoke finalization-cleanup proofs owned by one retained run, or every proof during service disposal. */
  private revokeFinalizationCleanupProofs(state?: RunState): void {
    for (const [proof, record] of this.finalizationCleanupProofs) {
      if (state !== undefined && record.state !== state) continue
      this.finalizationCleanupProofs.delete(proof)
    }
  }

  /** Begin the sequential default-topology window after the Team itself is durable but before a local run is published. */
  private beginBootstrapTopology(teamId: TeamId): BootstrapTopologyState {
    if (this.bootstrapTopologies.has(teamId) || this.runs.has(teamId)) {
      throw new TeamRunError(`Team '${teamId}' already has topology authority`, 'TEAM_RUN_START_CONFLICT')
    }
    const bootstrap: BootstrapTopologyState = { teamId }
    this.bootstrapTopologies.set(teamId, bootstrap)
    return bootstrap
  }

  /** Revoke every bootstrap token and remove its pre-publication authority window. */
  private releaseBootstrapTopology(bootstrap: BootstrapTopologyState): void {
    if (this.bootstrapTopologies.get(bootstrap.teamId) === bootstrap) {
      this.bootstrapTopologies.delete(bootstrap.teamId)
    }
    if (bootstrap.proof !== undefined) this.revokeTopologyProof(bootstrap.proof)
    for (const [proof, record] of this.topologyProofs) {
      if (record.owner !== bootstrap) continue
      this.topologyProofs.delete(proof)
    }
  }

  /** Issue one exact bootstrap topology proof and revoke it when its one Hub mutation settles. */
  private async withBootstrapTopologyProof<T>(
    bootstrap: BootstrapTopologyState,
    scope: TeamSystemTopologyScope,
    operation: (actor: TeamSystemTopologyProof) => Promise<T>,
  ): Promise<T> {
    this.assertOpen()
    if (scope.teamId !== bootstrap.teamId
      || this.bootstrapTopologies.get(scope.teamId) !== bootstrap
      || this.runs.has(scope.teamId)
      || bootstrap.proof !== undefined) {
      throw new TeamRunError('bootstrap topology authority is no longer current', 'TEAM_RUN_NOT_QUIESCENT')
    }
    return await this.withTopologyProof(bootstrap, scope, operation)
  }

  /** Issue one exact current-run topology proof and revoke it when its one Hub mutation settles. */
  private async withRunTopologyProof<T>(
    state: RunState,
    scope: TeamSystemTopologyScope,
    operation: (actor: TeamSystemTopologyProof) => Promise<T>,
  ): Promise<T> {
    this.assertOpen()
    if (state.topologyReleased
      || scope.teamId !== state.handle.teamId
      || this.runs.get(scope.teamId) !== state) {
      throw new TeamRunError('Team topology authority is no longer current for this local run', 'TEAM_RUN_NOT_QUIESCENT')
    }
    switch (scope.kind) {
      case 'team-run-worker-activate':
      case 'team-run-worker-retire':
        if (!state.workers.some(worker => worker.id === scope.participantId)) {
          throw new TeamRunError('worker topology authority does not own the selected participant', 'TEAM_RUN_NOT_QUIESCENT')
        }
        break
      case 'team-run-worker-invite':
        break
      case 'team-run-reviewer-invite':
      case 'team-run-reviewer-phase':
        break
      case 'team-run-bootstrap-participant-invite':
      case 'team-run-bootstrap-participant-phase':
      case 'team-run-bootstrap-channel-open':
        throw new TeamRunError('bootstrap topology scope cannot be issued after local run publication', 'TEAM_RUN_NOT_QUIESCENT')
      default:
        return assertNever(scope, 'Team-run topology scope')
    }
    return await this.withTopologyProof(state, scope, operation)
  }

  /** Retain one source-owned topology token until its single Hub call completes. */
  private async withTopologyProof<T>(
    owner: BootstrapTopologyState | RunState,
    scope: TeamSystemTopologyScope,
    operation: (actor: TeamSystemTopologyProof) => Promise<T>,
  ): Promise<T> {
    const proof = createTeamRunTopologyProof()
    if (this.isBootstrapTopologyOwner(owner, scope.teamId)) owner.proof = proof
    this.topologyProofs.set(proof, Object.freeze({ owner, scope: structuredClone(scope) }))
    try {
      return await operation(proof)
    } finally {
      this.revokeTopologyProof(proof)
    }
  }

  /** Resolve one topology proof only while its exact bootstrap or current local run remains authoritative. */
  private resolveTopologyProof(proof: TeamSystemTopologyProof): TeamSystemTopologyScope | undefined {
    const record = this.topologyProofs.get(proof)
    if (record === undefined || this.closing) return undefined
    const { owner, scope } = record
    if (this.isBootstrapTopologyOwner(owner, scope.teamId)) {
      return owner.proof === proof && !this.runs.has(scope.teamId) ? scope : undefined
    }
    return !owner.topologyReleased && this.runs.get(scope.teamId) === owner ? scope : undefined
  }

  /** Revoke one transient topology proof after its canonical Hub mutation settles. */
  private revokeTopologyProof(proof: TeamSystemTopologyProof): void {
    const record = this.topologyProofs.get(proof)
    this.topologyProofs.delete(proof)
    if (record !== undefined
      && this.isBootstrapTopologyOwner(record.owner, record.scope.teamId)
      && record.owner.proof === proof) {
      record.owner.proof = undefined
    }
  }

  /** Revoke current-run topology proofs, or every topology proof during service disposal. */
  private revokeTopologyProofs(state?: RunState): void {
    for (const [proof, record] of this.topologyProofs) {
      if (state !== undefined && record.owner !== state) continue
      this.revokeTopologyProof(proof)
    }
  }

  /** Identify a retained pre-publication owner without treating a current run as bootstrap state. */
  private isBootstrapTopologyOwner(
    owner: BootstrapTopologyState | RunState,
    teamId: TeamId,
  ): owner is BootstrapTopologyState {
    return this.bootstrapTopologies.get(teamId) === owner
  }

  /** Derive the exact durable coordinator attribution retained in every workflow compiler proof scope. */
  private workflowScopeCoordinator(state: RunState): TeamTaskCreator {
    return activationActor(state.handle.coordinatorLease.binding)
  }

  /** Issue one exact workflow compiler proof for a canonical Hub mutation and revoke it after settlement. */
  private async withWorkflowProof<T>(
    state: RunState,
    coordinator: Agent,
    scope: TeamSystemWorkflowScope,
    operation: (actor: TeamSystemWorkflowProof) => Promise<T>,
  ): Promise<T> {
    this.assertOpen()
    await this.assertCoordinatorAuthority(state, coordinator, 'workflow compiler proof issuance')
    if (scope.teamId !== state.handle.teamId || this.runs.get(scope.teamId) !== state) {
      throw new TeamRunError('workflow compiler authority is no longer current for this local Team run', 'TEAM_RUN_NOT_QUIESCENT')
    }
    const proof = createTeamRunWorkflowProof()
    this.workflowProofs.set(proof, Object.freeze({ state, coordinator, scope: structuredClone(scope) }))
    try {
      return await operation(proof)
    } finally {
      this.revokeWorkflowProof(proof)
    }
  }

  /** Resolve one workflow proof only while its exact TeamRun and coordinator remain current. */
  private resolveWorkflowProof(proof: TeamSystemWorkflowProof): TeamSystemWorkflowScope | undefined {
    const record = this.workflowProofs.get(proof)
    if (record === undefined || this.closing || this.runs.get(record.scope.teamId) !== record.state) return undefined
    if (record.scope.teamId !== record.state.handle.teamId
      || record.state.handle.coordinatorLease.localAgent !== record.coordinator
      || record.coordinator.status !== 'running'
      || this.ctx.agents.get(record.coordinator.id) !== record.coordinator
      || this.ctx.agents.currentInitiator() !== record.coordinator
      || record.scope.coordinator.teamId !== record.state.handle.coordinatorLease.binding.activation.teamId
      || record.scope.coordinator.participantId !== record.state.handle.coordinatorLease.binding.activation.participantId
      || record.scope.coordinator.activationId !== record.state.handle.coordinatorLease.binding.activation.id
      || record.scope.coordinator.sessionId !== record.state.handle.coordinatorLease.binding.sessionId
      || record.scope.coordinator.provider !== record.state.handle.coordinatorLease.binding.provider) return undefined
    return record.scope
  }

  /** Revoke one transient workflow compiler proof after its canonical Hub call settles. */
  private revokeWorkflowProof(proof: TeamSystemWorkflowProof): void {
    this.workflowProofs.delete(proof)
  }

  /** Revoke every workflow compiler proof owned by one released run, or all proofs during service disposal. */
  private revokeWorkflowProofs(state?: RunState): void {
    for (const [proof, record] of this.workflowProofs) {
      if (state !== undefined && record.state !== state) continue
      this.workflowProofs.delete(proof)
    }
  }

  /** Release retry records once their Team no longer has a current local owner. */
  private forgetStarts(teamId: TeamId): void {
    for (const [key, state] of this.starts) {
      if (state.teamId === teamId) this.starts.delete(key)
    }
    for (const [key, state] of this.workflowStarts) {
      if (state.teamId === teamId) this.workflowStarts.delete(key)
    }
  }

  /** Reject new product work once the Team-run provider begins teardown. */
  private assertOpen(): void {
    if (this.closing) throw new TeamRunError('Team-run provider is disposing', 'TEAM_RUN_DISPOSED')
  }
}

/** Install one local Team-run service. */
export function apply(ctx: Context, config: Config = {}): () => Promise<void> {
  const service = new TeamRunService(ctx, config)
  const finalReceiptSource = teamRunFinalReceiptProofSources.get(service)
  const envelopePostSource = teamRunEnvelopePostProofSources.get(service)
  const closureSource = teamRunClosureProofSources.get(service)
  const phaseSource = teamRunPhaseProofSources.get(service)
  const interruptSource = teamRunInterruptProofSources.get(service)
  const taskControlSource = teamRunTaskControlProofSources.get(service)
  const rootCreationSource = teamRunRootCreationProofSources.get(service)
  const archiveSource = teamRunArchiveProofSources.get(service)
  const cancellationCleanupSource = teamRunCancellationCleanupProofSources.get(service)
  const finalizationCleanupSource = teamRunFinalizationCleanupProofSources.get(service)
  const topologySource = teamRunTopologyProofSources.get(service)
  const workflowSource = teamRunWorkflowProofSources.get(service)
  const observeTurnEnd = teamRunTurnEndObservers.get(service)
  if (finalReceiptSource === undefined
    || envelopePostSource === undefined
    || closureSource === undefined
    || phaseSource === undefined
    || interruptSource === undefined
    || taskControlSource === undefined
    || rootCreationSource === undefined
    || archiveSource === undefined
    || cancellationCleanupSource === undefined
    || finalizationCleanupSource === undefined
    || topologySource === undefined
    || workflowSource === undefined
    || observeTurnEnd === undefined) {
    throw new Error('Team-run proof sources were not initialized')
  }
  const unregisterFinalReceipt = ctx.teams.registerSystemFinalReceiptProofSource(finalReceiptSource)
  const unregisterEnvelopePost = ctx.teams.registerSystemEnvelopePostProofSource(envelopePostSource)
  const unregisterClosure = ctx.teams.registerSystemClosureProofSource(closureSource)
  const unregisterPhase = ctx.teams.registerSystemPhaseProofSource(phaseSource)
  const unregisterInterrupt = ctx.teams.registerSystemInterruptProofSource(interruptSource)
  const unregisterTaskControl = ctx.teams.registerSystemTaskControlProofSource(taskControlSource)
  const unregisterRootCreation = ctx.teams.registerSystemRootCreationProofSource(rootCreationSource)
  const unregisterArchive = ctx.teams.registerSystemArchiveProofSource(archiveSource)
  const unregisterCancellationCleanup = ctx.teams.registerSystemCancellationCleanupProofSource(cancellationCleanupSource)
  const unregisterFinalizationCleanup = ctx.teams.registerSystemFinalizationCleanupProofSource(finalizationCleanupSource)
  const unregisterTopology = ctx.teams.registerSystemTopologyProofSource(topologySource)
  const unregisterWorkflow = ctx.teams.registerSystemWorkflowProofSource(workflowSource)
  const disposeTurnEndObserver = ctx.on('session/event', observeTurnEnd)
  return async () => {
    disposeTurnEndObserver()
    try {
      await service.close()
    } finally {
      unregisterWorkflow()
      unregisterTopology()
      unregisterFinalizationCleanup()
      unregisterCancellationCleanup()
      unregisterArchive()
      unregisterRootCreation()
      unregisterTaskControl()
      unregisterInterrupt()
      unregisterPhase()
      unregisterClosure()
      unregisterEnvelopePost()
      unregisterFinalReceipt()
    }
  }
}

/** Keep each opaque Team-run proof source private to its service instance. */
const teamRunFinalReceiptProofSources = new WeakMap<TeamRunService, TeamSystemFinalReceiptProofSource>()
const teamRunEnvelopePostProofSources = new WeakMap<TeamRunService, TeamSystemEnvelopePostProofSource>()
const teamRunClosureProofSources = new WeakMap<TeamRunService, TeamSystemClosureProofSource>()
const teamRunPhaseProofSources = new WeakMap<TeamRunService, TeamSystemPhaseProofSource>()
const teamRunInterruptProofSources = new WeakMap<TeamRunService, TeamSystemInterruptProofSource>()
const teamRunTaskControlProofSources = new WeakMap<TeamRunService, TeamSystemTaskControlProofSource>()
const teamRunRootCreationProofSources = new WeakMap<TeamRunService, TeamSystemRootCreationProofSource>()
const teamRunArchiveProofSources = new WeakMap<TeamRunService, TeamSystemArchiveProofSource>()
const teamRunCancellationCleanupProofSources = new WeakMap<TeamRunService, TeamSystemCancellationCleanupProofSource>()
const teamRunFinalizationCleanupProofSources = new WeakMap<TeamRunService, TeamSystemFinalizationCleanupProofSource>()
const teamRunTopologyProofSources = new WeakMap<TeamRunService, TeamSystemTopologyProofSource>()
const teamRunWorkflowProofSources = new WeakMap<TeamRunService, TeamSystemWorkflowProofSource>()
const teamRunTurnEndObservers = new WeakMap<TeamRunService, (session: Session, event: SessionEvent) => void>()

/** Create one non-serializable proof that only Team-run's registered source can resolve. */
function createTeamRunFinalReceiptProof(): TeamSystemFinalReceiptProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run final receipt proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemFinalReceiptProof
}

/** Create one non-serializable proof that only Team-run's input source can resolve. */
function createTeamRunEnvelopePostProof(): TeamSystemEnvelopePostProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run Envelope-post proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemEnvelopePostProof
}

/** Create one non-serializable proof that only Team-run's closure source can resolve. */
function createTeamRunClosureProof(): TeamSystemClosureProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run closure proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemClosureProof
}

/** Create one non-serializable proof that only Team-run's phase source can resolve. */
function createTeamRunPhaseProof(): TeamSystemPhaseProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run phase proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemPhaseProof
}

/** Create one non-serializable proof that only Team-run's interrupt source can resolve. */
function createTeamRunInterruptProof(): TeamSystemInterruptProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run interrupt proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemInterruptProof
}

/** Create one non-serializable proof that only Team-run's task-control source can resolve. */
function createTeamRunTaskControlProof(): TeamSystemTaskControlProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run task-control proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemTaskControlProof
}

/** Create one non-serializable proof that only Team-run's root-creation source can resolve. */
function createTeamRunRootCreationProof(): TeamSystemRootCreationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run root-creation proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemRootCreationProof
}

/** Create one non-serializable proof that only Team-run's terminal archive source can resolve. */
function createTeamRunArchiveProof(): TeamSystemArchiveProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run archive proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemArchiveProof
}

/** Create one non-serializable proof that only Team-run's cancellation-cleanup source can resolve. */
function createTeamRunCancellationCleanupProof(): TeamSystemCancellationCleanupProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run cancellation-cleanup proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemCancellationCleanupProof
}

/** Create one non-serializable proof that only Team-run's finalization-cleanup source can resolve. */
function createTeamRunFinalizationCleanupProof(): TeamSystemFinalizationCleanupProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run finalization-cleanup proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemFinalizationCleanupProof
}

/** Create one non-serializable proof that only Team-run's topology source can resolve. */
function createTeamRunTopologyProof(): TeamSystemTopologyProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run topology proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemTopologyProof
}

/** Create one non-serializable proof that only Team-run's workflow source can resolve. */
function createTeamRunWorkflowProof(): TeamSystemWorkflowProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team-run workflow proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemWorkflowProof
}

/** Parse and semantically validate one workflow plan at the model boundary. */
function parseWorkflowPlan(value: TeamWorkflowPlan): TeamWorkflowPlan {
  try {
    const plan = teamWorkflowPlanSchema.parse(value)
    validateTeamWorkflowPlan(plan)
    return plan
  } catch (error: unknown) {
    throw workflowInvalid(errorMessage(error))
  }
}

/** Compare the immutable part of a workflow plan across a retry or restart. */
function sameWorkflowPlan(left: TeamWorkflowPlan, right: TeamWorkflowPlan): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Build a typed Team-run error for a plan rejected before or during admission. */
function workflowInvalid(message: string): TeamRunError {
  return new TeamRunError(`invalid workflow plan: ${message}`, 'TEAM_RUN_WORKFLOW_INVALID')
}

/** Resolve every plan channel role to exactly one active Team participant. */
function resolveWorkflowParticipants(
  state: Awaited<ReturnType<Context['teams']['getTeam']>>,
  plan: TeamWorkflowPlan,
): Map<string, ParticipantSnapshot> {
  const participants = new Map<string, ParticipantSnapshot>()
  for (const role of plan.channel.participantRoles) {
    const matches = state.participants.filter(participant => participant.role === role && participant.phase === 'active')
    if (matches.length !== 1) throw workflowInvalid(`channel role '${role}' must resolve to exactly one active participant`)
    participants.set(role, matches[0] as ParticipantSnapshot)
  }
  return participants
}

/** Resolve one required role or raise a plan-specific error. */
function requiredWorkflowParticipant(
  participants: ReadonlyMap<string, ParticipantSnapshot>,
  role: string,
): ParticipantSnapshot {
  const participant = participants.get(role)
  if (participant === undefined) throw workflowInvalid(`workflow role '${role}' has no active participant`)
  return participant
}

/** Convert plan role targets to the participant-id graph expected by the channel adapter. */
function materializeWorkflowGraph(
  graph: TeamWorkflowGraph,
  participants: ReadonlyMap<string, ParticipantSnapshot>,
): JsonObject {
  const target = (value: TeamWorkflowTarget): JsonObject => {
    switch (value.kind) {
      case 'participant':
        return { kind: value.kind, participantId: requiredWorkflowParticipant(participants, value.role).id }
      case 'round-robin':
      case 'stay':
      case 'return-to-initiator':
      case 'terminate':
        return { kind: value.kind }
      case 'extension':
        return { kind: value.kind, name: value.name, version: value.version, config: structuredClone(value.config) }
      default:
        return assertNever(value, 'workflow target')
    }
  }
  const condition = (value: TeamWorkflowCondition): JsonObject => {
    switch (value.kind) {
      case 'always':
        return { kind: value.kind }
      case 'envelope-kind':
        return { kind: value.kind, value: value.value }
      case 'payload-present':
        return { kind: value.kind, path: value.path }
      case 'payload-equals':
        return { kind: value.kind, path: value.path, value: structuredClone(value.value) }
      case 'extension':
        return { kind: value.kind, name: value.name, version: value.version, config: structuredClone(value.config) }
      default:
        return assertNever(value, 'workflow condition')
    }
  }
  return {
    initial: target(graph.initial),
    transitions: graph.transitions.map(transition => ({
      condition: condition(transition.condition),
      target: target(transition.target),
    })),
    ...graph.defaultTarget === undefined ? {} : { defaultTarget: target(graph.defaultTarget) },
    maxTurns: graph.maxTurns,
  }
}

/** Read the optional deployed workflow-extension registry without making it a Team-run dependency. */
function workflowExtensionResolver(ctx: Context): WorkflowExtensionResolver | undefined {
  const registry = ctx.get('workflowExtensions') as {
    get: WorkflowExtensionResolver['get']
  } | undefined
  if (registry === undefined) return undefined
  return { get: (kind, name, version) => registry.get(kind, name, version) }
}

/** Derive one retry-safe task-create key from the durable plan and template. */
function workflowTaskIdempotencyKey(
  planId: TeamWorkflowPlanId,
  templateId: TeamWorkflowTaskTemplate['id'],
): ReturnType<typeof teamTaskCreateIdempotencyKeySchema.parse> {
  return teamTaskCreateIdempotencyKeySchema.parse(JSON.stringify(['team_workflow_plan_task', planId, templateId]))
}

/** Return whether a task phase is terminal for workflow result projection. */
function isWorkflowTaskTerminal(phase: TeamTaskSnapshot['phase']): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled' || phase === 'deleted'
}

/** Project only the compact task facts owned by one coordinator authority. */
function defaultWorkerTaskValues(
  state: RunState,
  tasks: TeamStateSnapshot['tasks'],
): TeamRunDefaultWorkerTask[] {
  return tasks
    .filter(task => task.workflowPlanId === undefined && state.defaultWorkerTaskIds.has(task.id))
    .map(defaultWorkerTaskValue)
}

/** Preserve review identity without exposing unrelated attempts or unbounded review reasons. */
function defaultWorkerTaskReview(task: TeamTaskSnapshot): TeamRunDefaultWorkerTaskReview {
  const attemptId = task.lease?.attemptId ?? task.attemptHistory.at(-1)?.id
  const policy = task.reviewPolicy
  const decision = policy.kind === 'none' || attemptId === undefined ? undefined
    : task.reviewHistory.findLast(review => review.attemptId === attemptId && review.reviewerId === policy.reviewerId)
  return {
    reviewPolicy: policy,
    reviewResult: decision === undefined ? null : {
      attemptId: decision.attemptId,
      decision: decision.nextPhase === 'completed' ? 'accepted' : 'rework',
    },
  }
}

/** Project one bounded cancellation alongside the selected attempt's review facts. */
function defaultWorkerTaskStatus(task: TeamTaskSnapshot): TeamRunDefaultWorkerTaskStatus {
  const cancellation = task.cancellation
  return {
    ...defaultWorkerTaskReview(task),
    ...task.delegation?.childTeamId === undefined ? {} : { childTeamId: task.delegation.childTeamId },
    ...task.delegation?.result === undefined ? {} : { delegationResult: { text: task.delegation.result.text, artifacts: structuredClone(task.delegation.result.artifacts) } },
    cancellation: cancellation === undefined ? null : {
      requestedRevision: cancellation.requestedRevision,
      attemptId: cancellation.target.kind === 'pending' || cancellation.target.kind === 'delegation' ? null : cancellation.target.attemptId,
      expired: cancellation.expiredAt !== undefined,
    },
  }
}

/** Compact phase and review facts from one authoritative task snapshot. */
function defaultWorkerTaskValue(task: TeamTaskSnapshot): TeamRunDefaultWorkerTask {
  return Object.freeze({ id: task.id, phase: task.phase, ...defaultWorkerTaskStatus(task) })
}

/** Compare task creator provenance across coordinator activation epochs. */
function sameStableTaskCreator(
  left: TeamTaskCommandCreator,
  right: ActivationBindingSnapshot,
): boolean {
  return 'activationId' in left
    && left.teamId === right.activation.teamId
    && left.participantId === right.activation.participantId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
}

/** Recognize a bounded CAS race that is safe for the workflow compiler to retry. */
function isWorkflowPlanRace(error: unknown): boolean {
  if (error instanceof TeamRunError && error.code === 'TEAM_RUN_WORKFLOW_INVALID') return false
  if (!(error instanceof TeamError)) return false
  return error.code === 'TEAM_CURSOR_CONFLICT'
    || error.code === 'TEAM_WORKFLOW_PLAN_STALE_REVISION'
    || error.code === 'TEAM_CHANNEL_CURSOR_CONFLICT'
    || error.code === 'TEAM_TASK_STALE_REVISION'
}

/** Keep local workflow union switches exhaustive. */
function assertNever(value: never, label: string): never {
  throw new TypeError(`unknown ${label}: ${String(value)}`)
}

/** Validate deployment-facing template and retry fields when direct callers bypass Loader normalization. */
function resolveConfig(config: Config): ResolvedConfig {
  const members = resolveTemplateMembers(config.members ?? [])
  const activationProvider = requiredText(config.activationProvider ?? DEFAULT_ACTIVATION_PROVIDER, 'activationProvider')
  const templateId = requiredText(config.templateId ?? DEFAULT_TEMPLATE_ID, 'templateId')
  const templateVersion = config.templateVersion ?? DEFAULT_TEMPLATE_VERSION
  const placementDefaults = config.placementDefaults === undefined
    ? undefined
    : teamTaskPlacementSchema.parse(structuredClone(config.placementDefaults))
  const humanName = requiredText(config.humanName ?? DEFAULT_HUMAN_NAME, 'humanName')
  const coordinatorName = requiredText(config.coordinatorName ?? DEFAULT_COORDINATOR_NAME, 'coordinatorName')
  const workerName = requiredText(config.workerName ?? DEFAULT_WORKER_NAME, 'workerName')
  const workerCount = config.workerCount ?? 1
  const maxWorkerCount = config.maxWorkerCount ?? DEFAULT_MAX_WORKER_COUNT
  const workerCapability = requiredText(config.workerCapability ?? DEFAULT_WORKER_CAPABILITY, 'workerCapability')
  const workerPreset = config.workerPreset === undefined ? undefined : requiredText(config.workerPreset, 'workerPreset')
  const reviewerName = requiredText(config.reviewerName ?? 'reviewer', 'reviewerName')
  const reviewerCapability = requiredText(config.reviewerCapability ?? 'team-default-reviewer', 'reviewerCapability')
  const reviewerPreset = config.reviewerPreset === undefined ? undefined : requiredText(config.reviewerPreset, 'reviewerPreset')
  const workerTaskMaxAttempts = config.workerTaskMaxAttempts ?? DEFAULT_WORKER_TASK_MAX_ATTEMPTS
  const workerTaskPriority = config.workerTaskPriority ?? DEFAULT_WORKER_TASK_PRIORITY
  const finalPromptOrder = config.finalPromptOrder ?? DEFAULT_FINAL_PROMPT_ORDER
  const workerPromptOrder = config.workerPromptOrder ?? DEFAULT_WORKER_PROMPT_ORDER
  const receiptRetryAttempts = config.receiptRetryAttempts ?? DEFAULT_RECEIPT_RETRY_ATTEMPTS
  const humanInputRetryAttempts = config.humanInputRetryAttempts ?? DEFAULT_HUMAN_INPUT_RETRY_ATTEMPTS
  const maxCoordinatorOutputContinuations = config.maxCoordinatorOutputContinuations ?? DEFAULT_COORDINATOR_OUTPUT_CONTINUATIONS
  const channelPageSize = config.channelPageSize ?? DEFAULT_CHANNEL_PAGE_SIZE
  if (!Number.isSafeInteger(templateVersion) || templateVersion < 1) throw new TypeError('templateVersion must be a positive safe integer')
  if (!Number.isSafeInteger(workerCount) || workerCount < 0) {
    throw new TypeError('workerCount must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(maxWorkerCount) || maxWorkerCount < 0) {
    throw new TypeError('maxWorkerCount must be a non-negative safe integer')
  }
  if (workerCount > maxWorkerCount) {
    throw new TypeError('workerCount must not exceed maxWorkerCount')
  }
  if (!Number.isSafeInteger(workerTaskMaxAttempts) || workerTaskMaxAttempts < 1) {
    throw new TypeError('workerTaskMaxAttempts must be a positive safe integer')
  }
  if (!Number.isSafeInteger(workerTaskPriority) || workerTaskPriority < 0) {
    throw new TypeError('workerTaskPriority must be a non-negative safe integer')
  }
  if (!Number.isFinite(finalPromptOrder)) throw new TypeError('finalPromptOrder must be finite')
  if (!Number.isFinite(workerPromptOrder)) throw new TypeError('workerPromptOrder must be finite')
  if (!Number.isSafeInteger(receiptRetryAttempts) || receiptRetryAttempts < 1) {
    throw new TypeError('receiptRetryAttempts must be a positive safe integer')
  }
  if (!Number.isSafeInteger(humanInputRetryAttempts) || humanInputRetryAttempts < 1) {
    throw new TypeError('humanInputRetryAttempts must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxCoordinatorOutputContinuations) || maxCoordinatorOutputContinuations < 1) {
    throw new TypeError('maxCoordinatorOutputContinuations must be a positive safe integer')
  }
  if (!Number.isSafeInteger(channelPageSize) || channelPageSize < 1) {
    throw new TypeError('channelPageSize must be a positive safe integer')
  }
  return {
    members,
    activationProvider,
    templateId,
    templateVersion,
    ...placementDefaults === undefined ? {} : { placementDefaults },
    humanName,
    coordinatorName,
    workerName,
    workerCount,
    maxWorkerCount,
    workerCapability,
    ...workerPreset === undefined ? {} : { workerPreset },
    reviewerName,
    reviewerCapability,
    ...reviewerPreset === undefined ? {} : { reviewerPreset },
    workerTaskMaxAttempts,
    workerTaskPriority,
    finalPromptOrder,
    workerPromptOrder,
    receiptRetryAttempts,
    humanInputRetryAttempts,
    maxCoordinatorOutputContinuations,
    channelPageSize,
  }
}

/** Compare operation and identity without trusting any caller-selected workspace path. */
function assertChildIdentity(identity: TeamChildRunIdentity, scope: TeamChildRunScope, operation: TeamChildRunScope['operation']): void {
  if (scope.operation !== operation || scope.childTeamId !== identity.childTeamId || scope.parentTeamId !== identity.parentTeamId
    || scope.parentTaskId !== identity.parentTaskId || scope.delegationId !== identity.delegationId) {
    throw new TeamRunError('Child operation does not match its parent authorization', 'TEAM_RUN_NOT_FOUND')
  }
}

/** Convert branded placement values into the JSON-only product-template rule. */
function placementDefaultsJson(value: TeamTaskPlacement): JsonObject {
  return Object.fromEntries(Object.entries(value).flatMap(([key, values]) =>
    values === undefined ? [] : [[key, [...(values as readonly string[])]]]))
}

/** Parse a complete frozen child runtime instead of applying new deployment defaults during recovery. */
function parseChildRuntime(value: unknown): { readonly config: ResolvedConfig; readonly selection: ModelSelection } {
  const input = durable.object({ config: durable.record(durable.string(), durable.json()),
    selection: durable.object({ provider: durable.string().min(1), model: durable.string().min(1) }).strict() }).strict().parse(value)
  const validated = Config['~standard'].validate(input.config)
  if (validated instanceof Promise || validated.issues !== undefined) {
    throw new TeamRunError('Frozen child configuration is invalid', 'TEAM_RUN_NOT_FOUND')
  }
  // Schemastery's Standard Schema view erases the output type after validation.
  const config = resolveConfig(validated.value as Config)
  if (!isDeepStrictEqual(config, input.config)) throw new TeamRunError('Frozen child configuration is incomplete', 'TEAM_RUN_NOT_FOUND')
  return { config, selection: input.selection }
}

/** Validate a complete member list at the deployment or durable-record parser. */
function resolveTemplateMembers(input: unknown): TeamRunMember[] {
  return templateMembersSchema.parse(input).map((member) => {
    const { preset, ...rest } = member
    return { ...rest, ...preset === undefined ? {} : { preset } }
  })
}

/** Restore the exact member routes recorded at creation instead of reinterpreting current configuration. */
function retainedTemplateMembers(state: TeamStateSnapshot): TeamRunMember[] {
  const template = state.rules.productTemplate
  if (template === undefined) return []
  if (template === null || typeof template !== 'object' || Array.isArray(template)) {
    throw new TeamRunError('Team product template must be a durable object', 'TEAM_RUN_NOT_FOUND')
  }
  return resolveTemplateMembers((template as JsonObject).members ?? [])
}

/** Return one required non-whitespace deployment or product text field. */
function requiredText(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new TypeError(`${field} must be non-empty`)
  return trimmed
}

/** Resolve the per-run model selection and optional request cap before activation begins. */
function coordinatorOptions(selection: ModelSelection, maxTokens: number | undefined): AgentOptions {
  if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    throw new TypeError('maxTokens must be a positive safe integer')
  }
  return {
    ...selection,
    ...maxTokens === undefined ? {} : { maxTokens },
  }
}

/** Canonical semantic identity for a retryable local Team start request. */
function startFingerprint(request: TeamRunStartRequest): string {
  return stableJson({
    objective: request.objective,
    cwd: request.cwd,
    selection: request.selection,
    preset: request.preset,
    maxTokens: request.maxTokens,
    humanOwner: request.humanOwner,
    content: request.content,
    delivery: request.delivery,
  })
}

/** Render JSON-like product input with sorted object keys for exact retry comparison. */
function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

/** Derive one task-creator identity from an exact coordinator lease. */
function activationActor(binding: TeamActivationLease['binding']): TeamTaskCreator {
  return {
    teamId: binding.activation.teamId,
    participantId: binding.activation.participantId,
    activationId: binding.activation.id,
    sessionId: binding.sessionId,
    provider: binding.provider,
  }
}

/** Match the direct-v3 human input that authorizes a coordinator objective edit. */
function isExactHumanDirectSource(source: object, state: RunState): boolean {
  const record = source as Record<string, unknown>
  return record.kind === 'team-envelope'
    && record.teamId === state.handle.teamId
    && record.channelId === state.handle.channel.manifest.id
    && record.senderId === state.handle.recipient.id
    && typeof record.envelopeId === 'string'
}

/** Project a terminal default-worker task with the review decision for its latest attempt. */
function terminalDefaultWorkerTask(task: TeamTaskSnapshot): TeamRunDefaultWorkerTaskTerminal | undefined {
  switch (task.phase) {
    case 'completed': {
      if (task.execution.kind === 'child-team') {
        const result = task.delegation?.result
        if (result === undefined) throw new TeamRunError(`Completed child task '${task.id}' has no admitted result`, 'TEAM_RUN_NOT_QUIESCENT')
        return Object.freeze({ id: task.id, phase: 'completed', result: { summary: result.text, artifacts: structuredClone(result.artifacts) }, ...defaultWorkerTaskStatus(task) })
      }
      const outcome = task.attemptHistory.at(-1)?.outcome
      if (outcome?.kind !== 'completed') {
        throw new TeamRunError(`completed default-worker task '${task.id}' has no completed attempt`, 'TEAM_RUN_NOT_QUIESCENT')
      }
      return Object.freeze({ id: task.id, phase: 'completed', result: outcome.result, ...defaultWorkerTaskStatus(task) })
    }
    case 'failed': {
      if (task.execution.kind === 'child-team') {
        const failure = task.delegation?.failure
        if (failure === undefined) throw new TeamRunError(`Failed child task '${task.id}' has no retained failure`, 'TEAM_RUN_NOT_QUIESCENT')
        return Object.freeze({ id: task.id, phase: 'failed', outcome: { kind: 'failed' as const, failure }, ...defaultWorkerTaskStatus(task) })
      }
      const outcome = task.attemptHistory.at(-1)?.outcome
      if (outcome === undefined || (outcome.kind !== 'failed' && outcome.kind !== 'released' && outcome.kind !== 'lease-expired')) {
        throw new TeamRunError(`failed default-worker task '${task.id}' has no terminal worker attempt`, 'TEAM_RUN_NOT_QUIESCENT')
      }
      return Object.freeze({ id: task.id, phase: 'failed', outcome, ...defaultWorkerTaskStatus(task) })
    }
    case 'cancelled':
      return Object.freeze({ id: task.id, phase: 'cancelled', ...defaultWorkerTaskStatus(task) })
    case 'deleted':
      return Object.freeze({ id: task.id, phase: 'deleted', ...defaultWorkerTaskStatus(task) })
    case 'pending':
    case 'assigned':
    case 'running':
    case 'review':
      return undefined
    /* v8 ignore next 2 -- TeamTaskPhase is closed and every tag is handled above. */
    default:
      task.phase satisfies never
      throw new Error('unreachable task phase')
  }
}

/** Resolve a committed participant by opaque id after a durable phase transition. */
function requiredParticipant(
  state: Awaited<ReturnType<Context['teams']['getTeam']>>,
  participantId: ParticipantSnapshot['id'],
): ParticipantSnapshot {
  const participant = state.participants.find(item => item.id === participantId)
  if (participant === undefined) throw new TeamRunError(`Team participant '${participantId}' was not persisted`, 'TEAM_RUN_NOT_QUIESCENT')
  return participant
}

/** Resolve one default-topology participant by its durable role. */
function requiredRoleParticipant(
  state: Awaited<ReturnType<Context['teams']['getTeam']>>,
  role: string,
): ParticipantSnapshot {
  const participant = state.participants.find(item => item.role === role)
  if (participant === undefined) {
    throw new TeamRunError(`Team '${state.team.id}' has no '${role}' participant`, 'TEAM_RUN_NOT_QUIESCENT')
  }
  return participant
}

/** Name the durable role for one worker-pool slot while keeping slot zero as `worker`. */
function workerRole(index: number): string {
  return index === 0 ? 'worker' : `worker-${String(index + 1)}`
}

/** Recognize the durable worker-pool role namespace. */
function isWorkerRole(role: string): boolean {
  return role === 'worker' || /^worker-(?:[2-9]|[1-9][0-9]+)$/u.test(role)
}

/** Recover the default worker pool from its durable role namespace. */
function workerParticipants(
  state: Awaited<ReturnType<Context['teams']['getTeam']>>,
): readonly ParticipantSnapshot[] {
  const workers = state.participants.filter(participant => participant.role === 'worker'
    || /^worker-(?:[2-9]|[1-9][0-9]+)$/u.test(participant.role))
    .filter(participant => participant.phase !== 'left' && participant.phase !== 'failed')
  return workers
}

/** Return whether an exception means the Team has reached its participant capacity. */
function isWorkerCapacityError(error: unknown): boolean {
  return error instanceof TeamError && error.code === 'TEAM_CHANNEL_BACKPRESSURE'
}

/** Return whether a task still occupies a worker-pool slot. */
function isWorkerTaskTerminal(phase: TeamTaskSnapshot['phase']): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled' || phase === 'deleted'
}

/** Select the next unused durable worker role after coordinator-driven scaling. */
function nextWorkerRole(participants: readonly ParticipantSnapshot[]): string {
  const indexes = participants.filter(participant => participant.phase !== 'left' && participant.phase !== 'failed').flatMap((participant) => {
    if (participant.role === 'worker') return [1]
    const match = /^worker-(\d+)$/u.exec(participant.role)
    return match?.[1] === undefined ? [] : [Number(match[1])]
  })
  const occupied = new Set(indexes)
  for (let index = 1; ; index += 1) {
    if (!occupied.has(index)) return workerRole(index - 1)
  }
}

/** Recover the latest provider/model route recorded in a persisted Session log. */
function latestRequestSelection(events: readonly SessionEvent[]): ModelSelection | undefined {
  const event = [...events].reverse().find(candidate => candidate.type === 'request/context')
  if (event?.type !== 'request/context') return undefined
  return { provider: event.data.provider, model: event.data.model }
}

/** Identify a valid explicit human-addressed final Envelope in one direct v3 channel suffix. */
function findFinal(records: readonly ChannelRecord[], handle: TeamRunHandle): TeamEnvelope | undefined {
  return findFinalForParticipants(records, handle.coordinator.id, handle.recipient.id)
}

/** Identify a valid final Envelope using durable participant ids after local ownership is gone. */
function findFinalForParticipants(
  records: readonly ChannelRecord[],
  coordinatorId: ParticipantSnapshot['id'],
  humanId: ParticipantSnapshot['id'],
): TeamEnvelope | undefined {
  for (const record of records) {
    if (record.type !== 'channel/envelope') continue
    const envelope = record.envelope
    if (envelope.kind !== DIRECT_CHANNEL_FINAL_ENVELOPE_KIND
      || envelope.senderId !== coordinatorId
      || envelope.audience?.length !== 1
      || envelope.audience[0] !== humanId
      || typeof envelope.payload.text !== 'string'
      || envelope.payload.text.length === 0) continue
    return envelope
  }
  return undefined
}

/** Recognize the Hub conflict that permits a fresh trusted-human receipt read and retry. */
function isChannelCursorConflict(error: unknown): boolean {
  return error instanceof TeamError && error.code === 'TEAM_CHANNEL_CURSOR_CONFLICT'
}

/** Recognize the Hub conflict that permits a fresh Team-state reread and retry. */
function isTeamCursorConflict(error: unknown): boolean {
  return error instanceof TeamError && error.code === 'TEAM_CURSOR_CONFLICT'
    || typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { readonly code?: unknown }).code === 'TEAM_CURSOR_CONFLICT'
}

/** Reject a provider watch result that cannot establish progress for a local wait. */
function assertTeamWatchAdvance(result: TeamWatchResult, afterCursor: number, operation: string): void {
  if (result.kind === 'changed' && result.cursor <= afterCursor) {
    throw new TeamRunError(`${operation} received a non-advancing Team cursor`, 'TEAM_RUN_NOT_QUIESCENT')
  }
}

/** Recognize a Team cursor race retained directly or inside aggregate cleanup failure. */
function hasTeamCursorConflict(error: unknown): boolean {
  if (isTeamCursorConflict(error)) return true
  if (!(error instanceof AggregateError)) return false
  return error.errors.some(candidate => hasTeamCursorConflict(candidate))
}

/** Recognize cleanup races that are safe to supersede once the driver reaches cancellation. */
function isCancellationProgressFailure(error: unknown): boolean {
  if (error instanceof TeamError) {
    return error.code === 'TEAM_CURSOR_CONFLICT'
      || error.code === 'TEAM_CHANNEL_CURSOR_CONFLICT'
      || error.code === 'TEAM_NOT_QUIESCENT'
  }
  if (error instanceof AggregateError) return error.errors.every(isCancellationProgressFailure)
  return false
}

/** Return whether a durable Team phase admits no further cancellation intent. */
function isTerminalTeamPhase(phase: TeamStateSnapshot['team']['phase']): boolean {
  return phase === 'completed' || phase === 'cancelled' || phase === 'failed'
}

/** Derive one stable per-Team closure retry key without rebranding an id. */
function closureKey(kind: 'complete' | 'fail' | 'cancel', teamId: TeamId) {
  return teamClosureIdempotencyKeySchema.parse(`team-run:${kind}:${teamId}`)
}

/** Render an arbitrary creation failure into the structured Team reason. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Turn-end result that cannot satisfy a Team run without an explicit final Envelope. */
function finalMissing(event: SessionEvent<'turn/end'>): TeamRunError {
  const reason = event.data.reason
  if (reason.kind === 'error') {
    return new TeamRunError(
      `coordinator turn failed before an explicit final Envelope: ${reason.error.code}: ${reason.error.message}`,
      'TEAM_RUN_FINAL_INVALID',
    )
  }
  return new TeamRunError(`coordinator turn ended ${reason.kind} before an explicit final Envelope`, 'TEAM_RUN_FINAL_INVALID')
}

/** Keep a successfully communicated non-final Team turn active for later input or final synthesis. */
function coordinatorTurnPostedMessage(session: Session | undefined, turn: number): boolean {
  if (session === undefined) return false
  const calls = new Set(session.events.flatMap(event =>
    event.type === 'tool/call' && event.data.turn === turn && event.data.name === 'team_message'
      ? [event.data.callId] : []))
  return session.events.some(event => event.type === 'tool/result'
    && event.data.turn === turn
    && calls.has(event.data.message.source.callId)
    && event.data.message.content[0].isError !== true)
}
