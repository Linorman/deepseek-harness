import { withPrincipalAdmission } from './principal-admission.ts'
import { openAgentWorkspaceLease } from '@clocky/clocky-agent'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentDefaultModelConfig from '@clocky/clocky-agent-default-model'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import * as InProcessRuntime from '@clocky/clocky-agent-runtime-in-process'
import { CallId, createUserMessage, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import TeamChannelAdmission from '@clocky/clocky-team-channel-admission'
import * as TeamPlacement from '@clocky/clocky-team-placement-default'
import * as ToolTeam from '@clocky/clocky-tool-team'
import { jsonObjectSchema, fingerprintTeamChildResultContent, teamChildRunBindingSchema, teamDelegationResultAdmissionSchema, teamTaskSnapshotSchema, channelPostIdempotencyKeySchema, teamTaskCreateIdempotencyKeySchema, teamWorkflowPlanIdempotencyKeySchema, teamWorkflowTaskTemplateIdSchema, teamWorkflowPlanSchema, teamWorkspaceAllocationIdSchema, teamWorkspaceAllocationReserveInputSchema, teamWorkspaceAllocationPreserveInputSchema, teamWorkspaceAllocationReleaseRequestInputSchema, teamWorkspaceAllocationReleaseInputSchema, TeamError } from '@clocky/clocky-team'
import type {
  ActivationActorProofIssuer,
  ParticipantSnapshot,
  TeamMemberExecutionSources,
  TeamEnvelope,
  TeamId,
  TeamPhase,
  TeamSystemClosureProof,
  TeamSystemClosureScope,
  TeamSystemFinalReceiptProof,
  TeamSystemFinalReceiptScope,
  TeamSystemTopologyProof,
  TeamSystemTopologyScope,
  TeamSystemInterruptProof,
  TeamSystemInterruptScope,
  TeamSystemPhaseProof,
  TeamSystemPhaseScope,
  TeamSystemTaskControlProof,
  TeamSystemTaskControlScope,
  TeamSystemRootCreationProof,
  TeamSystemRootCreationScope,
  TeamSystemArchiveProof,
  TeamSystemArchiveScope,
  TeamSystemWorkflowProof,
  TeamSystemWorkflowScope,
  TeamTaskAttemptSettleInput,
  TeamTaskId,
  TeamTaskWorkspaceMode,
  TeamTaskSnapshot,
  TeamSystemWorkspaceAllocationProof,
  TeamSystemWorkspaceAllocationScope,
} from '@clocky/clocky-team'
import * as TeamActivationController from '@clocky/clocky-team-activation-controller'
import type { TeamActivationLease } from '@clocky/clocky-team-activation-controller'
import * as TeamAgentClient from '@clocky/clocky-team-agent-client'
import {
  DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
  DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
} from '@clocky/clocky-team-channel-direct'
import * as DirectChannel from '@clocky/clocky-team-channel-direct'
import * as TeamChannelTaskAssignment from '@clocky/clocky-team-channel-task-assignment'
import * as TeamChannelWorkflow from '@clocky/clocky-team-channel-workflow'
import TeamClosureDriverHub from '../../team-closure-driver/src/hub.ts'
import { TeamClosureDriveBackendRegistry } from '../../team-closure-driver/src/index.ts'
import * as TeamClosureDriver from '../../team-closure-driver/src/index.ts'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import * as TeamLinkLocal from '@clocky/clocky-team-link-local'
import * as TeamSchedulerDag from '@clocky/clocky-team-scheduler-dag'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import type { TeamWorkspaceProvider } from '@clocky/clocky-team-workspace'
import * as TeamRun from '../src/index.ts'
import { closeTestChannel, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'

const noReview = { reviewPolicy: { kind: 'none' as const }, reviewResult: null, cancellation: null }

const contexts = new Set<Context>()
const roots: string[] = []

afterEach(async () => {
  const failures: unknown[] = []
  for (const ctx of [...contexts]) {
    try {
      await ctx.fiber.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  contexts.clear()
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Team-run test cleanup failed')
})

/** Complete a short local coordinator turn after the Team Agent Client admits human input. */
class ReplyAdapter extends LlmAdapter {
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'coordinator observed the durable input' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'coordinator observed the durable input' } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Send one successful non-final Team message through the real coordinator tool path. */
class TeamMessageAdapter extends LlmAdapter {
  private requests = 0

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Team run' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Team run' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.requests += 1
    if (this.requests > 1) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'waiting for more Team input' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'waiting for more Team input' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const channelId = JSON.stringify(options.messages).match(/channel-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u)?.[0]
    if (channelId === undefined) throw new Error('Team message test request has no channel id')
    const id = CallId('team-message-turn')
    const argumentsText = JSON.stringify({ channel_id: channelId, text: 'A durable progress update.', delivery: 'context' })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: 'team_message', argumentsDelta: argumentsText }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'team_message', arguments: argumentsText } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

/** End one coordinator request with a model failure before it can post a final Envelope. */
class FailureAdapter extends LlmAdapter {
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'model unavailable' } } }
  }
}

/** End a coordinator turn at the output cap without making it a Team stall. */
class MaxTokensAdapter extends LlmAdapter {
  readonly continuationStarted = Promise.withResolvers<undefined>()
  readonly releaseContinuation = Promise.withResolvers<undefined>()
  private requests = 0

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Team run' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Team run' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.requests += 1
    if (this.requests === 2) {
      this.continuationStarted.resolve(undefined)
      const aborted = Promise.withResolvers<undefined>()
      options.signal?.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
      await Promise.race([this.releaseContinuation.promise, aborted.promise])
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'truncated coordinator output' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'truncated coordinator output' } }
    yield { type: 'finish', reason: { kind: 'max-tokens' } }
  }
}

class GateAdapter extends LlmAdapter {
  readonly started = Promise.withResolvers<undefined>()
  readonly release = Promise.withResolvers<undefined>()

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Team run' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Team run' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.started.resolve(undefined)
    await this.release.promise
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class CoordinatorGateWorkerReplyAdapter extends LlmAdapter {
  readonly coordinatorStarted = Promise.withResolvers<undefined>()
  readonly releaseCoordinator = Promise.withResolvers<undefined>()

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Team task' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Team task' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const assignment = options.messages.some(message => message.role === 'user'
      && message.content.some(block => block.type === 'text' && block.text.startsWith('Team task assignment:')))
    if (!assignment) {
      this.coordinatorStarted.resolve(undefined)
      await this.releaseCoordinator.promise
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: assignment ? 'worker received assignment' : 'coordinator resumed' }
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'text', text: assignment ? 'worker received assignment' : 'coordinator resumed' },
    }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Hold the coordinator's first turn while later worker and reviewer turns end without tools. */
class FirstCoordinatorTurnGateAdapter extends LlmAdapter {
  readonly coordinatorStarted = Promise.withResolvers<undefined>()
  readonly releaseCoordinator = Promise.withResolvers<undefined>()
  private requests = 0

  constructor(private readonly reviewerOutcome: 'stopped' | 'errored' = 'stopped') { super() }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.requests += 1
    if (this.requests === 1) {
      this.coordinatorStarted.resolve(undefined)
      await this.releaseCoordinator.promise
    }
    if (this.requests >= 3 && this.reviewerOutcome === 'errored') {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'REVIEW_MODEL_ERROR', message: 'review model unavailable' } } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'The turn ended without calling a Team tool.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'The turn ended without calling a Team tool.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Compose the real local Team execution path around one deterministic model adapter. */
async function setup(
  withModel = true,
  teamRunConfig: TeamRun.Config = {},
  adapter: LlmAdapter = new ReplyAdapter(),
  withClosureDriver = true,
  teamHubConfig?: { readonly maxTeamDepth?: number },
  withTeamTools = false,
): Promise<Context> {
  const root = await freshRoot()
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  if (withModel) ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(AgentDefaultModelConfig, withModel ? { provider: 'mock', model: 'mock' } : {})
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'hub') })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  if (teamHubConfig === undefined) await ctx.plugin(TeamHub)
  else await ctx.plugin(TeamHub, teamHubConfig)
  await ctx.plugin(TeamChannelAdmission, { scanIntervalMs: 100, teamPageSize: 64, maxChannelsPerPass: 128 })
  await ctx.plugin(DirectChannel)
  await ctx.plugin(TeamChannelWorkflow)
  if (withClosureDriver) {
    await ctx.plugin(TeamClosureDriveBackendRegistry)
    await ctx.plugin(TeamClosureDriverHub, { backend: 'hub' })
    await ctx.plugin(TeamClosureDriver, {
      backend: 'hub', maxTeamsPerDrive: 128, pageSize: 32, disposalTimeoutMs: 100,
    })
  }
  await ctx.plugin(TeamChannelTaskAssignment)
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(InProcessRuntime, { providerName: 'in-process' })
  await ctx.plugin(TeamActivationController)
  await ctx.plugin(TeamLinkRegistry)
  await ctx.plugin(TeamLinkLocal, {
    providerName: 'local', pageSize: 32, disposalTimeoutMs: 100, notificationRetryDelayMs: 1,
  })
  await ctx.plugin(TeamAgentClient, { reconnectDelayMs: 1, disposalTimeoutMs: 100, maxTaskReportReminders: 0 })
  if (withTeamTools) await ctx.plugin(ToolTeam, { linkProvider: 'local' })
  await ctx.plugin(TeamRun, teamRunConfig)
  return ctx
}

const taskWorkspaceProvider: TeamWorkspaceProvider = {
  name: 'team-run-task-workspace',
  modes: ['shared'],
  async eligible() { return true },
  async prepare() { throw new Error('Team-run scheduler test does not prepare a workspace') },
  async restore() { throw new Error('Team-run scheduler test does not restore a workspace') },
  async reconcileRelease() { throw new Error('Team-run scheduler test does not reconcile a workspace') },
}

async function setupTaskRun(adapter: LlmAdapter, teamRunConfig: TeamRun.Config = {}, withClosureDriver = true): Promise<Context> {
  const ctx = await setup(true, Object.assign({ workerPreset: 'worker' }, teamRunConfig), adapter, withClosureDriver)
  await ctx.plugin(TeamWorkspaceRegistry)
  ctx.teamWorkspaces.registerProvider(taskWorkspaceProvider)
  await ctx.plugin(TeamSchedulerDag, {
    leaseDurationMs: 30_000,
    maxAssignmentsPerDrive: 1,
    maxExpirationsPerDrive: 1,
    maxWakeDispatchesPerDrive: 1,
    // Worker activation and assignment delivery legitimately advance the Team cursor before a wake-channel CAS.
    maxConflictsPerDrive: 4,
    maxActiveAttemptsPerParticipant: 1,
    permittedWorkspaceModes: ['shared'],
    disposalTimeoutMs: 100,
  })
  return ctx
}

/** Build a small fan-out/fan-in plan using the default Team roles. */
function workflowPlan(
  taskCount = 2,
  workerRoles: readonly string[] = ['worker'],
  maxParallelism = 1,
  independentTasks = false,
  workspaceMode: TeamTaskWorkspaceMode = 'shared',
): TeamRun.TeamRunWorkflowPlanStartRequest['plan'] {
  const tasks = [
    {
      id: 'research',
      subject: 'Research the input',
      description: 'Collect the facts required by the final task.',
      blockedBy: [],
      requiredCapabilities: ['team-default-worker'],
      priority: 1,
      readScopes: [],
      writeScopes: [],
      workspaceMode,
      budget: {},
      reviewPolicy: { kind: 'none' as const },
      maxAttempts: 1,
    },
    ...(taskCount === 1 ? [] : [{
      id: 'synthesis',
      subject: 'Synthesize the input',
      description: 'Synthesize the completed research into a concise result.',
      blockedBy: independentTasks ? [] : ['research'],
      requiredCapabilities: ['team-default-worker'],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode,
      budget: {},
      reviewPolicy: { kind: 'none' as const },
      maxAttempts: 1,
    }]),
  ]
  return teamWorkflowPlanSchema.parse({
    version: 1,
    name: 'bounded-research',
    tasks,
    bounds: { maxTasks: tasks.length, maxParallelism, maxTotalAttempts: tasks.length },
    channel: {
      participantRoles: ['coordinator', ...workerRoles],
      viewPolicy: { type: 'recent-window', version: 1 },
      graph: {
        initial: { kind: 'participant', role: 'coordinator' },
        transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }],
        maxTurns: 1,
      },
    },
    result: { kind: 'task-results', taskTemplateIds: tasks.map(task => task.id) },
  })
}


/** Allocate one repository-local persistence root. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-run-'))
  roots.push(root)
  return root
}

async function postFinal(
  ctx: Context, run: TeamRun.TeamRunHandle, text = 'The review is complete.', idempotencyKey = 'team-run-post-final',
): Promise<TeamEnvelope> {
  const coordinatorLink = await ctx.teamLinks.connect({ provider: 'local', binding: run.coordinatorLease.binding })
  try {
    const channel = await ctx.teams.getChannel({ channelId: run.channel.manifest.id })
    return await coordinatorLink.post({
      expectedCursor: channel.cursor,
      idempotencyKey: channelPostIdempotencyKeySchema.parse(idempotencyKey),
      draft: {
        channelId: channel.manifest.id,
        audience: [run.recipient.id],
        kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
        payload: { text },
        delivery: 'turn',
      },
    })
  } finally {
    await coordinatorLink.close()
  }
}

type TestRunState = {
  readonly config: { readonly receiptRetryAttempts: number }
  readonly handle: TeamRun.TeamRunHandle
  readonly memberStates: Map<unknown, unknown>
  readonly disposePrompt: () => void
  readonly workerStates: Map<unknown, unknown>
  readonly workerActivations: Map<unknown, Promise<unknown>>
}

type FinalReceiptProofInternals = {
  readonly finalReceiptProofs: WeakMap<TeamSystemFinalReceiptProof, { readonly scope: TeamSystemFinalReceiptScope }>
  readonly finalReceiptProofsByRun: WeakMap<TestRunState, TeamSystemFinalReceiptProof>
}

type ClosureProofInternals = {
  readonly closureProofs: WeakMap<TeamSystemClosureProof, { readonly scope: TeamSystemClosureScope }>
}

type TopologyProofInternals = {
  readonly topologyProofs: Map<TeamSystemTopologyProof, { readonly scope: TeamSystemTopologyScope }>
  withRunTopologyProof<T>(
    state: unknown,
    scope: TeamSystemTopologyScope,
    operation: (actor: TeamSystemTopologyProof) => Promise<T>,
  ): Promise<T>
}

type TopologyReleaseInternals = {
  activateWorker(state: unknown, participantId: ParticipantSnapshot['id'], signal: AbortSignal | undefined): Promise<unknown>
  releaseRun(state: unknown): Promise<void>
}

type CoordinatorActorProofIssuerInternals = {
  readonly coordinatorActorProofIssuer: ActivationActorProofIssuer | undefined
}

type PhaseProofInternals = {
  readonly resumePhaseProofs: WeakMap<TeamSystemPhaseProof, { readonly scope: TeamSystemPhaseScope }>
  readonly resumePhaseProofByTeam: Map<TeamId, TeamSystemPhaseProof>
}

type InterruptProofInternals = {
  readonly interruptProofs: Map<TeamSystemInterruptProof, { readonly scope: TeamSystemInterruptScope }>
}

type TaskControlProofInternals = {
  readonly taskControlProofs: Map<TeamSystemTaskControlProof, { readonly scope: TeamSystemTaskControlScope }>
}

type RootCreationProofInternals = {
  readonly rootCreationProofs: Map<TeamSystemRootCreationProof, { readonly scope: TeamSystemRootCreationScope }>
}

type ArchiveProofInternals = {
  readonly terminalArchiveOwners: Map<TeamId, { readonly teamId: TeamId }>
  readonly archiveProofs: Map<TeamSystemArchiveProof, { readonly scope: TeamSystemArchiveScope }>
}

type WorkflowProofInternals = {
  readonly workflowProofs: Map<TeamSystemWorkflowProof, { readonly scope: TeamSystemWorkflowScope }>
}

function ownedRuns(service: TeamRun.TeamRunService): Map<TeamId, TestRunState> {
  return (service as unknown as { runs: Map<TeamId, TestRunState> }).runs
}

function finalReceiptProofInternals(service: TeamRun.TeamRunService): FinalReceiptProofInternals {
  return service as unknown as FinalReceiptProofInternals
}

function closureProofInternals(service: TeamRun.TeamRunService): ClosureProofInternals {
  return service as unknown as ClosureProofInternals
}


function topologyProofInternals(service: TeamRun.TeamRunService): TopologyProofInternals {
  return service as unknown as TopologyProofInternals
}

function topologyReleaseInternals(service: TeamRun.TeamRunService): TopologyReleaseInternals {
  return service as unknown as TopologyReleaseInternals
}

function coordinatorActorProofIssuerInternals(service: TeamRun.TeamRunService): CoordinatorActorProofIssuerInternals {
  return service as unknown as CoordinatorActorProofIssuerInternals
}

function phaseProofInternals(service: TeamRun.TeamRunService): PhaseProofInternals {
  return service as unknown as PhaseProofInternals
}

function interruptProofInternals(service: TeamRun.TeamRunService): InterruptProofInternals {
  return service as unknown as InterruptProofInternals
}

function taskControlProofInternals(service: TeamRun.TeamRunService): TaskControlProofInternals {
  return service as unknown as TaskControlProofInternals
}

function rootCreationProofInternals(service: TeamRun.TeamRunService): RootCreationProofInternals {
  return service as unknown as RootCreationProofInternals
}

function archiveProofInternals(service: TeamRun.TeamRunService): ArchiveProofInternals {
  return service as unknown as ArchiveProofInternals
}

function workflowProofInternals(service: TeamRun.TeamRunService): WorkflowProofInternals {
  return service as unknown as WorkflowProofInternals
}

/** Create one runtime-only system phase proof for a test-owned source. */
function testSystemPhaseProof(): TeamSystemPhaseProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test system phase proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemPhaseProof
}

/** Register one scheduler-shaped proof sufficient to prepare a stalled Team for the TeamRun resume path. */
function schedulerStallAuthority(ctx: Context, scope: Extract<TeamSystemPhaseScope, { readonly kind: 'scheduler-stall' }>): TeamSystemPhaseProof {
  const proof = testSystemPhaseProof()
  const proofs = new WeakMap<TeamSystemPhaseProof, TeamSystemPhaseScope>([[proof, scope]])
  ctx.teams.registerSystemPhaseProofSource({
    name: 'team-scheduler-dag',
    resolvePhaseProof: candidate => proofs.get(candidate),
  })
  return proof
}

/** Settle one active local-worker attempt through a proof minted for its exact durable activation. */
async function settleTaskAttemptAsOwner(
  ctx: Context,
  task: TeamTaskSnapshot,
  outcome: TeamTaskAttemptSettleInput['outcome'],
): Promise<TeamTaskSnapshot> {
  const lease = task.lease
  if (lease === undefined || lease.activationId === undefined) {
    throw new Error(`task '${task.id}' did not retain an activation-bound lease`)
  }
  const binding = await ctx.teams.getActivation({ teamId: task.teamId, activationId: lease.activationId })
  const issuer = ctx.teams.openActivationActorProofIssuer()
  const actorLease = issuer.issue(binding)
  try {
    return await ctx.teams.settleTaskAttempt({
      actor: actorLease.proof,
      taskId: task.id,
      expectedRevision: task.revision,
      attemptId: lease.attemptId,
      outcome,
    })
  } finally {
    actorLease.revoke()
    issuer.close()
  }
}

/** Submit a real consult response from the reviewer activation of one settled worker attempt. */
async function respondToTaskReview(ctx: Context, task: TeamTaskSnapshot, decision: 'accepted' | 'rework'): Promise<void> {
  const basic = await import('@clocky/clocky-team-channel-basic')
  const reviewerId = task.reviewPolicy.kind === 'participant' ? task.reviewPolicy.reviewerId : undefined
  const initiatorId = task.attemptHistory.at(-1)?.participantId
  if (reviewerId === undefined || initiatorId === undefined) throw new Error('Task has no review route')
  const state = await ctx.teams.getTeam({ teamId: task.teamId })
  const binding = state.activations.findLast(candidate => candidate.activation.participantId === reviewerId)
  if (binding === undefined) throw new Error('Reviewer has no activation')
  for (const channelId of state.channelIds) {
    const channel = await ctx.teams.getChannel({ channelId })
    if (channel.manifest.adapter.type !== basic.CONSULT_CHANNEL_TYPE) continue
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const read = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
      const request = read.records.find(record => record.type === 'channel/envelope'
        && record.envelope.kind === basic.CONSULT_REVIEW_REQUEST_KIND && record.envelope.taskId === task.id)
      if (request?.type !== 'channel/envelope') break
      const issuer = ctx.teams.openActivationActorProofIssuer()
      const reviewerActor = issuer.issue(binding)
      try {
        await ctx.teams.postChannelEnvelope({ actor: reviewerActor.proof, expectedCursor: read.channel.cursor,
          draft: { channelId, audience: [initiatorId], kind: basic.CONSULT_RESPONSE_KIND, delivery: 'turn',
            causationId: request.envelope.id, taskId: task.id,
            payload: { text: decision === 'accepted' ? 'The completed attempt is accepted.' : 'The attempt needs rework.', decision } },
        })
        return
      } catch (error: unknown) {
        if (!(error instanceof TeamError) || error.code !== 'TEAM_CHANNEL_CURSOR_CONFLICT' || attempt === 3) throw error
      } finally { reviewerActor.revoke(); issuer.close() }
    }
  }
  throw new Error('Task has no active review request')
}

function leaseWithoutLocalAgent(lease: TeamActivationLease): TeamActivationLease {
  return {
    binding: lease.binding,
    localAgent: undefined,
    health: () => lease.health(),
    interrupt: (...args) => { lease.interrupt(...args) },
    dispose: () => lease.dispose(),
  }
}

describe('local Team run', () => {
  it('observes managed member routes only for participants owned by the current run', async () => {
    const ctx = await setup(true, { workerCount: 1 }, new GateAdapter())
    const run = await ctx.teamRuns.create({ objective: 'Observe managed route ownership.', cwd: process.cwd() })
    const worker = run.workers[0]
    if (worker === undefined) throw new Error('run did not retain its configured worker')
    const observe = async (member: ParticipantSnapshot, sources: TeamMemberExecutionSources = {}, observedTeamId: TeamId = run.teamId) =>
      await ctx.waterfall(ctx.teams, 'team/member-execution-observe', { teamId: observedTeamId, participant: member },
        async () => sources)
    expect(await observe(run.recipient)).toEqual({})
    expect(await observe(worker, {}, 'unowned-team' as TeamId)).toEqual({})
    expect(await observe({ ...worker, id: 'unowned-worker' as ParticipantSnapshot['id'] })).toEqual({})
    expect(await observe(worker)).toMatchObject({ route: { kind: 'managed', provider: 'in-process' } })
    await expect(observe(worker, { route: { kind: 'managed', provider: 'other', configuration: 'fixture', reasons: [] } }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const provider = vi.spyOn(ctx.agentRuntimes, 'getProvider').mockReturnValueOnce(undefined)
    try {
      expect((await observe(worker)).route?.reasons).toContain('provider-unavailable')
      const runtime = ctx.agentRuntimes.getProvider('in-process')
      if (runtime === undefined) throw new Error('in-process provider disappeared')
      provider.mockReturnValueOnce({ ...runtime, participantKinds: [] })
      expect((await observe(worker)).route?.reasons).toContain('participant-kind-unsupported')
    } finally { provider.mockRestore() }
    await ctx.teamRuns.cancel(run.teamId)
  })

  it('reports the frozen provider route of one custom template member', async () => {
    const member: TeamRun.TeamRunMember = { role: 'builder', displayName: 'Builder', kind: 'local-agent',
      capabilities: ['build'], provider: 'in-process', modelProvider: 'mock', model: 'builder-model', maxTokens: 128 }
    const ctx = await setup(true, { members: [member], workerCount: 0, maxWorkerCount: 0 }, new GateAdapter())
    const run = await ctx.teamRuns.create({ objective: 'Observe the custom member.', cwd: process.cwd() })
    const builder = run.members[0]
    if (builder === undefined) throw new Error('TeamRun omitted the custom member')
    const sources = await ctx.waterfall(ctx.teams, 'team/member-execution-observe', {
      teamId: run.teamId, participant: builder,
    }, async () => ({}))
    expect(sources.route).toMatchObject({ kind: 'managed', provider: member.provider, configuration: 'team-run' })
    await ctx.teamRuns.cancel(run.teamId)
  })

  it('owns a declared member lease whose provider publishes no in-process Agent', async () => {
    const member: TeamRun.TeamRunMember = { role: 'builder', displayName: 'Builder', kind: 'local-agent',
      capabilities: ['build'], provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128 }
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0, members: [member] })
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      const state = await ctx.teams.getTeam({ teamId: request.teamId })
      const participant = state.participants.find(candidate => candidate.id === request.participantId)
      const lease = await activate(request)
      return participant?.role === member.role ? leaseWithoutLocalAgent(lease) : lease
    })
    const run = await ctx.teamRuns.create({ objective: 'Own a nonresident template member.', cwd: process.cwd() })
    expect(run.members.map(value => value.role)).toEqual(['builder'])
    const before = await ctx.teams.getTeam({ teamId: run.teamId })
    const builderId = run.members[0]?.id
    expect(before.activations.find(binding => binding.activation.participantId === builderId)?.activation.status).toBe('idle')
    await ctx.teamRuns.cancel(run.teamId)
    const after = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(after.activations.find(binding => binding.activation.participantId === builderId)?.activation.status).toBe('offline')
  })

  it('resolves only the selected child template version without creating a Team or lending mutable configuration', async () => {
    const ctx = await setup(true, {
      templateId: 'review-team', templateVersion: 2, workerCount: 0, maxWorkerCount: 0,
      placementDefaults: { roles: ['worker'] },
    })
    const description = ctx.teamRuns.describeChildTemplate('review-team', 2)
    expect(description).toMatchObject({ productTemplate: { id: 'review-team', version: 2 },
      childRuntime: { selection: { provider: 'mock', model: 'mock' }, config: { workerCount: 0, maxWorkerCount: 0 } } })
    vi.spyOn(ctx.agentDefaultModel, 'currentSelection').mockReturnValueOnce(undefined)
    expect(() => ctx.teamRuns.describeChildTemplate('review-team', 2)).toThrow('explicit coordinator model route')
    expect(description).toMatchObject({ productTemplate: { placement: { roles: ['worker'] } } })
    expect(description).not.toHaveProperty('workspacePath')
    const runtime = description.childRuntime as { config: { workerCount: number } }
    runtime.config.workerCount = 99
    expect(ctx.teamRuns.describeChildTemplate('review-team', 2)).toMatchObject({ childRuntime: { config: { workerCount: 0 } } })
    expect(() => ctx.teamRuns.describeChildTemplate('review-team', 1)).toThrow(/unavailable/u)
    expect(() => ctx.teamRuns.describeChildTemplate('missing', 2)).toThrow(/unavailable/u)
    expect((await ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items).toEqual([])
  })

  it('freezes explicit template routes and releases every additional member on Team cancellation', async () => {
    const members: TeamRun.TeamRunMember[] = [
      { role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: ['build'],
        provider: 'in-process', modelProvider: 'mock', model: 'builder-model', maxTokens: 128 },
      { role: 'security-review', displayName: 'Security review', kind: 'local-agent', capabilities: ['security'],
        provider: 'in-process', modelProvider: 'mock', model: 'security-model', maxTokens: 256 },
    ]
    const ctx = await setup(true, { members, workerCount: 0, maxWorkerCount: 0 })
    const run = await ctx.teamRuns.create({ objective: 'Use an explicit role template.', cwd: process.cwd() })
    expect(run.members.map(member => member.role)).toEqual(['builder', 'security-review'])
    expect(run.workers).toEqual([])
    const state = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(state.rules.productTemplate).toMatchObject({ members })
    expect(state.activations.filter(binding => binding.activation.participantId !== run.coordinator.id)
      .map(binding => binding.selection?.model)).toEqual(['builder-model', 'security-model'])
    await ctx.teamRuns.cancel(run.teamId)
    const ended = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(ended.team.phase).toBe('cancelled')
    expect(ended.activations).toHaveLength(3)
    expect(ended.activations.every(binding => binding.quiescedAt !== undefined)).toBe(true)
  })

  it('compiles workflow execution and distinct reviewer roles without requiring a default worker', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const members: TeamRun.TeamRunMember[] = ['builder', 'security-review', 'style-review'].map(role => ({
      role, displayName: role, kind: 'local-agent', capabilities: role === 'builder' ? ['build'] : ['review'],
      provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
    }))
    const ctx = await setup(true, { members, workerCount: 0, maxWorkerCount: 0 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Compile a routed workflow.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent!
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const base = workflowPlan(2, members.map(member => member.role), 2, true)
    const plan = teamWorkflowPlanSchema.parse({ ...base, tasks: base.tasks.map((task, index) => ({ ...task,
      requiredCapabilities: ['build'], reviewPolicy: { kind: 'participant', reviewerRole: index === 0 ? 'security-review' : 'style-review' },
    })) })
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Compile the explicit roles.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const compiled = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('explicit-role-workflow'), plan,
      }))
      expect(compiled.phase).toBe('ready')
      const state = await ctx.teams.getTeam({ teamId: run.teamId })
      const reviewerIds = state.tasks.map(task => task.reviewPolicy.kind === 'participant' ? task.reviewPolicy.reviewerId : undefined)
      expect(reviewerIds).toEqual(run.members.filter(member => member.role.endsWith('-review')).map(member => member.id))
      expect(state.participants.some(member => member.role === 'worker' || member.role === 'reviewer')).toBe(false)
    } finally {
      adapter.releaseCoordinator.resolve(undefined)
      await ctx.teamRuns.cancel(run.teamId)
    }
  })

  it('compiles built-in and registered workflow routes into the durable channel graph', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0, members: [{
      role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: [],
      provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
    }] }, adapter)
    ctx.workflowExtensions.register({ kind: 'condition', name: 'approved-condition', version: 1,
      validate() {}, evaluate() { return true } })
    ctx.workflowExtensions.register({ kind: 'target', name: 'finished-target', version: 1,
      validate() {}, resolve() { return { kind: 'terminate' } } })
    const run = await ctx.teamRuns.create({ objective: 'Compile every route kind.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no local coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Compile the route graph.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const base = workflowPlan(1, ['builder'])
      const graph = { initial: { kind: 'participant', role: 'coordinator' }, maxTurns: 5,
        transitions: [
          { condition: { kind: 'envelope-kind', value: 'message' }, target: { kind: 'round-robin' } },
          { condition: { kind: 'payload-present', path: 'text' }, target: { kind: 'stay' } },
          { condition: { kind: 'payload-equals', path: 'text', value: 'done' }, target: { kind: 'return-to-initiator' } },
          { condition: { kind: 'extension', name: 'approved-condition', version: 1, config: {} },
            target: { kind: 'extension', name: 'finished-target', version: 1, config: {} } },
        ], defaultTarget: { kind: 'terminate' },
      }
      const plan = teamWorkflowPlanSchema.parse({ ...base, tasks: base.tasks.map(task => ({
        ...task, requiredCapabilities: [],
      })), channel: { ...base.channel, graph } })
      const started = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-mixed-routes'), plan,
      }))
      expect(started.phase).toBe('ready')
      if (started.channelId === undefined) throw new Error('Compiled workflow has no channel')
      const channel = await ctx.teams.getChannel({ channelId: started.channelId })
      expect(channel.manifest.limits.graph).toMatchObject({
        initial: { kind: 'participant', participantId: run.coordinator.id },
        transitions: graph.transitions,
        defaultTarget: { kind: 'terminate' },
      })
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  })

  it('reactivates a dormant custom workflow role through placement before publishing its tasks', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0, members: [{
      role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: ['team-default-worker'],
      provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
    }] }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Resume a workflow role.', cwd: process.cwd() })
    const before = await ctx.teams.getTeam({ teamId: run.teamId })
    const old = before.activations.find(value => value.activation.participantId === run.members[0]!.id)!
    const lease = await ctx.teamActivations.activate({ teamId: run.teamId, participantId: old.activation.participantId,
      expectedCursor: before.team.cursor, provider: old.provider, sessionId: old.sessionId,
      seed: { kind: 'resume' }, agent: { cwd: process.cwd(), options: {} }, signal: new AbortController().signal })
    await lease.dispose()
    await ctx.plugin(TeamPlacement, { routes: [{ provider: 'in-process', roles: ['builder'], model: 'mock/mock',
      modelProvider: 'mock', modelId: 'mock', cwd: process.cwd(), maxTokens: 128 }],
    maxActivationsPerDrive: 2, maxCursorRetries: 3 })
    const coordinator = run.coordinatorLease.localAgent!
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Start the workflow.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const compiled = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('dormant-role-workflow'), plan: workflowPlan(2, ['builder']),
      }))
      expect(compiled.phase).toBe('ready')
      expect(await ctx.teamPlacement.prepare(run.teamId)).toBe(0)
      const after = await ctx.teams.getTeam({ teamId: run.teamId })
      const epochs = after.activations.filter(value => value.activation.participantId === old.activation.participantId)
      expect(epochs).toHaveLength(2)
      expect(epochs[0]?.quiescedAt).toBeDefined()
      expect(epochs[1]?.sessionId).toBe(old.sessionId)
      expect(epochs[1]?.activation.status).toBe('idle')
      expect(after.tasks.map(task => task.phase)).toEqual(['pending', 'pending'])
    } finally {
      adapter.releaseCoordinator.resolve(undefined)
      await ctx.teamRuns.cancel(run.teamId)
    }
  })

  it('compiles a non-shared workflow task when its workspace provider is explicitly mounted', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerPreset: 'worker' }, adapter)
    await ctx.plugin(TeamWorkspaceRegistry)
    ctx.teamWorkspaces.registerProvider({
      name: 'team-run-sandbox-workspace',
      modes: ['sandbox'],
      async eligible() { return true },
      async prepare() { throw new Error('compile-only provider must not prepare a workspace') },
      async restore() { throw new Error('compile-only provider must not restore a workspace') },
      async reconcileRelease() { throw new Error('compile-only provider must not reconcile a workspace') },
    })
    const run = await ctx.teamRuns.create({ objective: 'Compile an isolated workflow.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => request.participantId === run.worker!.id
      ? await activate({
        ...request,
        agent: {
          options: request.agent.options,
          ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
        },
      })
      : await activate(request))
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Compile the isolated workflow.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const compiled = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(
      ctx.teamRuns.coordinatorTaskAuthority(coordinator),
      {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-sandbox-start'),
        plan: workflowPlan(1, ['worker'], 1, false, 'sandbox'),
      },
    ))
    const state = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(compiled.phase).toBe('ready')
    expect(state.tasks).toEqual([expect.objectContaining({ workspaceMode: 'sandbox', phase: 'pending' })])
    adapter.releaseCoordinator.resolve(undefined)
  })

  it('rejects unroutable workflow tasks and channel extensions before admission', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0, members: [{
      role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: [],
      provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
    }] }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Validate workflow execution routes.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Validate workflow routes.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const isolatedBase = workflowPlan(1, ['builder'], 1, false, 'sandbox')
      const isolated = teamWorkflowPlanSchema.parse({ ...isolatedBase, tasks: isolatedBase.tasks.map(task => ({
        ...task, requiredCapabilities: [],
      })) })
      const cancelled = new AbortController()
      const cancellation = new Error('Stop workflow compilation')
      cancelled.abort(cancellation)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-cancelled-before-admission'),
        plan: isolated, signal: cancelled.signal,
      }))).rejects.toBe(cancellation)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-without-workspaces'), plan: isolated,
      }))).rejects.toThrow("has no provider for workspace mode 'sandbox'")

      await ctx.plugin(TeamWorkspaceRegistry)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-without-sandbox-provider'), plan: isolated,
      }))).rejects.toThrow("has no provider for workspace mode 'sandbox'")

      const base = workflowPlan(1, ['builder'])
      const incapable = teamWorkflowPlanSchema.parse({ ...base, tasks: base.tasks.map(task => ({
        ...task, requiredCapabilities: ['capability-no-participant-has'],
      })) })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-without-capable-participant'), plan: incapable,
      }))).rejects.toThrow('has no capable declared execution participant')

      const routed = teamWorkflowPlanSchema.parse({ ...base, tasks: base.tasks.map(task => ({
        ...task, requiredCapabilities: [],
      })) })
      const missingExtension = teamWorkflowPlanSchema.parse({ ...routed, channel: {
        ...routed.channel, graph: { ...routed.channel.graph,
          initial: { kind: 'extension', name: 'unregistered-route', version: 1, config: {} } },
      } })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-without-channel-extension'), plan: missingExtension,
      }))).rejects.toThrow("workflow target extension 'unregistered-route@1' is not registered")
      const missingCondition = teamWorkflowPlanSchema.parse({ ...routed, channel: {
        ...routed.channel, graph: { ...routed.channel.graph, transitions: [{
          condition: { kind: 'extension', name: 'unregistered-condition', version: 1, config: {} },
          target: { kind: 'terminate' },
        }] },
      } })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-without-condition-extension'), plan: missingCondition,
      }))).rejects.toThrow("workflow condition extension 'unregistered-condition@1' is not registered")

      const state = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(state.tasks).toEqual([])
      expect(state.workflowPlans ?? []).toEqual([])
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  })

  it('rejects a missing workflow view policy before durable admission and permits a corrected retry key', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerPreset: 'worker' }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Validate workflow input before admission.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent!
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const plan = workflowPlan(1)
    const { viewPolicy: _viewPolicy, ...channel } = plan.channel
    const idempotencyKey = teamWorkflowPlanIdempotencyKeySchema.parse('corrected-workflow-policy')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Compile a workflow.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const before = await ctx.teams.getTeam({ teamId: run.teamId })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey, plan: { ...plan, channel },
      }))).rejects.toThrow('explicit model view policy')
      const rejected = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(rejected.tasks).toEqual([])
      expect((await ctx.teams.listWorkflowPlansPage({ teamId: run.teamId, afterCursor: -1, limit: 1 })).items).toEqual([])
      expect(rejected.channelIds).toEqual(before.channelIds)
      expect(rejected.activations).toHaveLength(before.activations.length)
      const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
      vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
        const { preset: _preset, ...agent } = request.agent
        return await activate({ ...request, agent })
      })
      const corrected = await ctx.agents.withInitiator(coordinator,
        async () => await ctx.teamRuns.startWorkflowPlan(authority, { idempotencyKey, plan }))
      expect(corrected.phase).toBe('ready')
      expect((await ctx.teams.getTeam({ teamId: run.teamId })).workflowPlans).toHaveLength(1)
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  })

  it('compiles a declarative fan-out/fan-in plan into dormant durable tasks and a workflow channel', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerPreset: 'worker' }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Compile a durable workflow.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => request.participantId === run.worker!.id
      ? await activate({
        ...request,
        agent: {
          options: request.agent.options,
          ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
        },
      })
      : await activate(request))
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const request = {
      idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-start-1'),
      plan: workflowPlan(),
    }
    const admitWorkflowPlan = vi.spyOn(ctx.teams, 'admitWorkflowPlan')
    const createTask = vi.spyOn(ctx.teams, 'createTask')
    const openChannel = vi.spyOn(ctx.teams, 'openChannel')
    const bindWorkflowPlanChannel = vi.spyOn(ctx.teams, 'bindWorkflowPlanChannel')
    const bindWorkflowPlanTask = vi.spyOn(ctx.teams, 'bindWorkflowPlanTask')
    const transitionWorkflowPlan = vi.spyOn(ctx.teams, 'transitionWorkflowPlan')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Compile the workflow.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const compiled = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, request))
    const replay = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, request))
    expect(replay.id).toBe(compiled.id)
    expect(compiled.phase).toBe('ready')
    expect(compiled.taskBindings).toHaveLength(2)
    const state = await ctx.teams.getTeam({ teamId: run.teamId })
    const admission = admitWorkflowPlan.mock.calls[0]?.[0]
    if (admission === undefined) throw new Error('Team-run did not admit the workflow plan')
    expect(admission).toMatchObject({
      teamId: run.teamId,
      idempotencyKey: request.idempotencyKey,
      plan: request.plan,
    })
    expect(admission.actor).not.toHaveProperty('teamId')
    expect(() => JSON.stringify(admission.actor)).toThrow(/runtime-only/u)
    const workflowTaskCreates = createTask.mock.calls
      .map(([candidate]) => candidate)
      .filter(candidate => candidate.workflowPlanId === compiled.id)
    expect(workflowTaskCreates).toHaveLength(2)
    expect(workflowTaskCreates.every(candidate => candidate.createCommand?.idempotencyKey !== undefined)).toBe(true)
    expect(workflowTaskCreates.every(candidate => !('creator' in (candidate.createCommand ?? {})))).toBe(true)
    expect(new Set([admission.actor, ...workflowTaskCreates.map(candidate => candidate.actor)]).size).toBe(3)
    const workflowOpen = openChannel.mock.calls
      .map(([candidate]) => candidate)
      .find(candidate => candidate.workflowPlanId === compiled.id)
    const channelBinding = bindWorkflowPlanChannel.mock.calls[0]?.[0]
    const taskBindings = bindWorkflowPlanTask.mock.calls.map(([candidate]) => candidate)
    const readyTransition = transitionWorkflowPlan.mock.calls
      .map(([candidate]) => candidate)
      .find(candidate => candidate.planId === compiled.id && candidate.phase === 'ready')
    if (workflowOpen === undefined || channelBinding === undefined || readyTransition === undefined) {
      throw new Error('Team-run did not issue every workflow compiler mutation')
    }
    expect(workflowOpen).toMatchObject({
      workflowPlanId: compiled.id,
      expectedPlanRevision: 1,
      adapter: { type: 'workflow', version: 1 },
    })
    expect(workflowOpen.actor).not.toHaveProperty('teamId')
    expect(() => JSON.stringify(workflowOpen.actor)).toThrow(/runtime-only/u)
    expect(taskBindings).toHaveLength(2)
    expect(new Set([
      workflowOpen.actor,
      channelBinding.actor,
      ...taskBindings.map(candidate => candidate.actor),
      readyTransition.actor,
    ]).size).toBe(5)
    expect(workflowProofInternals(ctx.teamRuns).workflowProofs.size).toBe(0)
    await expect(ctx.teams.openChannel({
      ...workflowOpen,
      actor: {} as TeamSystemWorkflowProof,
      expectedCursor: state.team.cursor,
      authorityKind: undefined,
    } as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.admitWorkflowPlan({
      ...admission,
      expectedCursor: state.team.cursor,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(state.workflowPlans).toEqual([expect.objectContaining({ id: compiled.id, phase: 'ready' })])
    expect(state.tasks).toHaveLength(2)
    expect(state.tasks.every(task => task.phase === 'pending' && task.workflowPlanId === compiled.id)).toBe(true)
    expect(state.tasks.find(task => task.workflowTemplateId === 'synthesis')?.blockedBy).toEqual([
      state.tasks.find(task => task.workflowTemplateId === 'research')?.id,
    ])
    const channel = await ctx.teams.getChannel({ channelId: compiled.channelId as TeamRun.TeamRunHandle['channel']['manifest']['id'] })
    expect(channel.manifest).toMatchObject({
      workflowPlanId: compiled.id,
      adapter: { type: 'workflow', version: 1 },
      participants: [
        { id: run.coordinator.id, role: 'coordinator' },
        { id: run.worker!.id, role: 'worker' },
      ],
    })
    expect(channel.manifest.limits).toHaveProperty('graph')
    adapter.releaseCoordinator.resolve(undefined)
  })

  it.each(['TEAM_CURSOR_CONFLICT', 'TEAM_WORKFLOW_PLAN_STALE_REVISION'] as const)(
    'closes an unbound workflow channel and retries compiler binding after %s', async (code) => {
      const adapter = new CoordinatorGateWorkerReplyAdapter()
      const ctx = await setup(true, { workerPreset: 'worker' }, adapter)
      const run = await ctx.teamRuns.create({ objective: 'Close an unbound workflow channel.', cwd: process.cwd() })
      const coordinator = run.coordinatorLease.localAgent
      if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
      const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
      vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => request.participantId === run.worker!.id
        ? await activate({
          ...request,
          agent: {
            options: request.agent.options,
            ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
          },
        })
        : await activate(request))
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const bindFailure = new TeamError('workflow channel binding raced', code)
      vi.spyOn(ctx.teams, 'bindWorkflowPlanChannel').mockImplementationOnce(async () => { throw bindFailure })
      const closeWorkflowChannel = ctx.teams.closeWorkflowChannel.bind(ctx.teams)
      let cleanupRequest: Parameters<typeof ctx.teams.closeWorkflowChannel>[0] | undefined
      vi.spyOn(ctx.teams, 'closeWorkflowChannel').mockImplementation(async (request) => {
        cleanupRequest = request
        return await closeWorkflowChannel(request)
      })
      coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Compile and clean up the workflow.' }], source: { kind: 'user' } }))
      await adapter.coordinatorStarted.promise
      try {
        const compiled = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
          idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-cleanup-failure'),
          plan: workflowPlan(),
        }))
        expect(compiled).toMatchObject({ phase: 'ready' })
        const cleanup = cleanupRequest
        if (cleanup === undefined) throw new Error('Team-run did not request workflow channel cleanup')
        expect(cleanup).toMatchObject({
          teamId: run.teamId,
          expectedRevision: 1,
          reason: 'Workflow channel did not bind.',
        })
        expect(typeof cleanup.expectedTeamCursor).toBe('number')
        expect(cleanup.actor).not.toHaveProperty('teamId')
        expect(() => JSON.stringify(cleanup.actor)).toThrow(/runtime-only/u)
        expect(workflowProofInternals(ctx.teamRuns).workflowProofs.size).toBe(0)
        const state = await ctx.teams.getTeam({ teamId: run.teamId })
        const plan = (state.workflowPlans ?? []).find(candidate => candidate.id === cleanup.planId)
        expect(plan).toMatchObject({ phase: 'ready' })
        expect(plan?.channelId).not.toBe(cleanup.channelId)
        await expect(ctx.teams.getChannel({ channelId: cleanup.channelId })).resolves.toMatchObject({ phase: 'closed' })
        const boundChannelId = plan?.channelId
        if (boundChannelId === undefined) throw new Error('workflow retry did not bind a replacement channel')
        await expect(ctx.teams.getChannel({ channelId: boundChannelId })).resolves.toMatchObject({ phase: 'active' })
        await expect(ctx.teams.closeWorkflowChannel(cleanup)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        adapter.releaseCoordinator.resolve(undefined)
      }
    })

  it('resumes a durable compiling workflow while waiting after channel opening fails', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0, members: [{
      role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: [],
      provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
    }] }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Resume a compiling workflow.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Start the workflow.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const base = workflowPlan(1, ['builder'])
      const plan = teamWorkflowPlanSchema.parse({ ...base, tasks: base.tasks.map(task => ({
        ...task, requiredCapabilities: [],
      })) })
      const idempotencyKey = teamWorkflowPlanIdempotencyKeySchema.parse('resume-compiling-workflow')
      const failure = new Error('workflow channel unavailable during compilation')
      const opening = vi.spyOn(ctx.teams, 'openChannel').mockRejectedValueOnce(failure)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey, plan,
      }))).rejects.toBe(failure)
      opening.mockRestore()
      const retained = (await ctx.teams.getTeam({ teamId: run.teamId })).workflowPlans?.[0]
      if (retained === undefined) throw new Error('Workflow admission did not persist')
      expect(retained.phase).toBe('compiling')
      const waiting = ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForWorkflowPlan(authority, {
        planId: retained.id,
      }))
      await vi.waitFor(async () => {
        const current = await ctx.teams.getWorkflowPlan({ teamId: run.teamId, planId: retained.id })
        expect(current.phase).toBe('ready')
      }, { timeout: 5000 })
      await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelWorkflowTask(authority, {
        planId: retained.id, templateId: plan.tasks[0]!.id,
        reason: 'Withdraw the recovered workflow task.',
      }))
      await expect(waiting).resolves.toMatchObject({ id: retained.id, phase: 'cancelled' })
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  }, 15_000)

  it('reports workflow binding and cleanup failures, then reuses the durable channel', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0, members: [{
      role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: [],
      provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
    }] }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Report both workflow failures.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Compile the workflow.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const base = workflowPlan(1, ['builder'])
      const plan = teamWorkflowPlanSchema.parse({ ...base, tasks: base.tasks.map(task => ({
        ...task, requiredCapabilities: [],
      })) })
      const bindingFailure = new TeamError('workflow binding raced', 'TEAM_CURSOR_CONFLICT')
      const cleanupFailure = new Error('unbound channel storage unavailable')
      vi.spyOn(ctx.teams, 'bindWorkflowPlanChannel').mockRejectedValueOnce(bindingFailure)
      const close = vi.spyOn(ctx.teams, 'closeWorkflowChannel').mockRejectedValueOnce(cleanupFailure)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-double-failure'), plan,
      }))).rejects.toMatchObject({ errors: [bindingFailure, cleanupFailure] })
      expect(close).toHaveBeenCalledOnce()
      const current = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(current.workflowPlans?.[0]?.phase).toBe('compiling')
      const orphan = current.channelIds.find(channelId => channelId !== run.channel.manifest.id)
      if (orphan === undefined) throw new Error('Failed cleanup left no workflow channel to recover')
      const retried = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-double-failure'), plan,
      }))
      expect(retried.phase).toBe('ready')
      const after = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(after.channelIds.filter(channelId => channelId !== run.channel.manifest.id)).toEqual([orphan])
      expect(retried.channelId).toBe(orphan)
      expect((await ctx.teams.getChannel({ channelId: orphan })).phase).toBe('active')
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  })

  it('activates a configured worker pool and fans out independent workflow tasks across its members', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setupTaskRun(adapter, { workerCount: 2 })
    const run = await ctx.teamRuns.create({ objective: 'Compile a multi-worker workflow.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    expect(run.workers).toHaveLength(2)
    expect(run.workers.map(worker => worker.role)).toEqual(['worker', 'worker-2'])
    const workerIds = new Set(run.workers.map(worker => worker.id))
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => workerIds.has(request.participantId)
      ? await activate({
        ...request,
        agent: {
          options: request.agent.options,
          ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
        },
      })
      : await activate(request))
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Compile the multi-worker workflow.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const plan = workflowPlan(2, ['worker', 'worker-2'], 2, true)
    const started = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
      idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-multi-worker'),
      plan,
    }))
    expect(started.phase).toBe('ready')
    await vi.waitFor(async () => {
      const state = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(state.tasks.filter(task => task.workflowPlanId === started.id).map(task => task.phase))
        .toEqual(['running', 'running'])
    }, { timeout: 5000 })
    let state = await ctx.teams.getTeam({ teamId: run.teamId })
    for (const task of state.tasks.filter(candidate => candidate.workflowPlanId === started.id)) {
      await settleTaskAttemptAsOwner(ctx, task, {
        kind: 'completed',
        result: { summary: `Completed ${task.workflowTemplateId}.` },
      })
      state = await ctx.teams.getTeam({ teamId: run.teamId })
    }
    const completed = state.tasks.filter(task => task.workflowPlanId === started.id && task.phase === 'completed')
    expect(new Set(completed.flatMap(task => task.attemptHistory.map(attempt => attempt.participantId)))).toEqual(workerIds)
    const terminal = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForWorkflowPlan(authority, {
      planId: started.id,
    }))
    expect(terminal.phase).toBe('completed')
    adapter.releaseCoordinator.resolve(undefined)
  }, 30_000)

  it('projects terminal task attempts through a durable workflow result and survives a concurrent scheduler drive', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setupTaskRun(adapter)
    const run = await ctx.teamRuns.create({ objective: 'Execute a workflow.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => request.participantId === run.worker!.id
      ? await activate({
        ...request,
        agent: {
          options: request.agent.options,
          ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
        },
      })
      : await activate(request))
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Execute the workflow.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const plan = workflowPlan(1)
    const started = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
      idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-execute-1'),
      plan,
    }))
    const initialTask = (await ctx.teams.getTeam({ teamId: run.teamId })).tasks.find(candidate => candidate.workflowPlanId === started.id)
    if (initialTask === undefined) throw new Error('workflow compiler did not create its task')
    const taskId = initialTask.id
    let task = initialTask
    await vi.waitFor(async () => {
      task = await ctx.teams.getTask({ teamId: run.teamId, taskId })
      expect(task.phase).toBe('running')
    }, { timeout: 5000 })
    const settled = await settleTaskAttemptAsOwner(ctx, task, {
      kind: 'completed',
      result: { summary: 'Workflow task completed.' },
    })
    expect(settled.phase).toBe('completed')
    const terminal = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForWorkflowPlan(authority, {
      planId: started.id,
    }))
    expect(terminal).toMatchObject({
      id: started.id,
      phase: 'completed',
      result: { kind: 'task-results', tasks: [{ templateId: 'research', taskId: task.id, phase: 'completed' }] },
    })
    adapter.releaseCoordinator.resolve(undefined)
  })

  it('projects a failed workflow task with its durable failure fact', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setupTaskRun(adapter)
    const run = await ctx.teamRuns.create({ objective: 'Project a failed workflow.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => request.participantId === run.worker!.id
      ? await activate({
        ...request,
        agent: {
          options: request.agent.options,
          ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
        },
      })
      : await activate(request))
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Project the failed workflow.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const started = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
      idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-failed-result'),
      plan: workflowPlan(1),
    }))
    const initial = (await ctx.teams.getTeam({ teamId: run.teamId })).tasks.find(task => task.workflowPlanId === started.id)
    if (initial === undefined) throw new Error('failed workflow did not create its task')
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTask({ teamId: run.teamId, taskId: initial.id })).resolves.toMatchObject({ phase: 'running' })
    }, { timeout: 5000 })
    const running = await ctx.teams.getTask({ teamId: run.teamId, taskId: initial.id })
    await settleTaskAttemptAsOwner(ctx, running, {
      kind: 'failed',
      failure: { code: 'WORKER_FAILED', message: 'The workflow worker failed.' },
    })

    await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForWorkflowPlan(authority, {
      planId: started.id,
    }))).resolves.toMatchObject({
      id: started.id,
      phase: 'failed',
      result: {
        kind: 'task-results',
        tasks: [{
          templateId: 'research',
          taskId: initial.id,
          phase: 'failed',
          failure: { code: 'WORKER_FAILED', message: 'The workflow worker failed.' },
        }],
      },
    })
    adapter.releaseCoordinator.resolve(undefined)
  })

  it('reports an undecided reviewer turn while waiting for a workflow plan', async () => {
    const adapter = new FirstCoordinatorTurnGateAdapter()
    const ctx = await setupTaskRun(adapter, { workerPreset: 'worker', reviewerPreset: 'worker' })
    const basic = await import('@clocky/clocky-team-channel-basic')
    await ctx.plugin(basic)
    const run = await ctx.teamRuns.create({ objective: 'Detect an undecided workflow review.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no local coordinator')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      const { preset: _preset, ...agent } = request.agent
      return await activate({ ...request, agent })
    })
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Start reviewed workflow work.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const base = workflowPlan(1, ['worker', 'reviewer'])
      const plan = teamWorkflowPlanSchema.parse({ ...base, tasks: base.tasks.map(task => ({
        ...task, reviewPolicy: { kind: 'participant', reviewerRole: 'reviewer' },
      })) })
      const started = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-undecided-review'), plan,
      }))
      let task: TeamTaskSnapshot | undefined
      await vi.waitFor(async () => {
        task = (await ctx.teams.getTeam({ teamId: run.teamId })).tasks.find(candidate => candidate.workflowPlanId === started.id)
        expect(task?.phase).toBe('running')
      }, { timeout: 5000 })
      if (task === undefined) throw new Error('Workflow task did not begin')
      const reviewing = await settleTaskAttemptAsOwner(ctx, task, {
        kind: 'completed', result: { summary: 'Workflow change ready for review.' },
      })
      expect(reviewing.phase).toBe('review')
      const reviewerId = reviewing.reviewPolicy.kind === 'participant' ? reviewing.reviewPolicy.reviewerId : undefined
      if (reviewerId === undefined) throw new Error('Workflow task has no reviewer')
      await vi.waitFor(async () => {
        const state = await ctx.teams.getTeam({ teamId: run.teamId })
        const binding = state.activations.findLast(candidate => candidate.activation.participantId === reviewerId)
        const reviewer = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
        expect(reviewer?.session.events.some(event => event.type === 'turn/end')).toBe(true)
      }, { timeout: 5000 })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForWorkflowPlan(authority, {
        planId: started.id,
      }))).rejects.toMatchObject({ code: 'TEAM_RUN_REVIEW_FAILED' })
      expect((await ctx.teams.getTask({ teamId: run.teamId, taskId: reviewing.id })).phase).toBe('review')
      await respondToTaskReview(ctx, reviewing, 'accepted')
      await vi.waitFor(async () => {
        expect((await ctx.teams.getTask({ teamId: run.teamId, taskId: reviewing.id })).phase).toBe('completed')
      }, { timeout: 5000 })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForWorkflowPlan(authority, {
        planId: started.id,
      }))).resolves.toMatchObject({ phase: 'completed', result: { kind: 'task-results', tasks: [{
        taskId: reviewing.id, phase: 'completed',
      }] } })
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  }, 15_000)

  it('fails a workflow wait on a non-advancing Team watch', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, {
      workerCount: 0,
      maxWorkerCount: 0,
      members: [{ role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: [],
        provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128 }],
    }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Reject a repeated workflow watch.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Start the workflow watch.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const basePlan = workflowPlan(1, ['builder'], 1)
      const plan = teamWorkflowPlanSchema.parse({
        ...basePlan,
        tasks: basePlan.tasks.map(task => ({ ...task, requiredCapabilities: [] })),
      })
      const started = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-repeated-watch'),
        plan,
      }))
      const current = await ctx.teams.getTeam({ teamId: run.teamId })
      const watch = vi.spyOn(ctx.teams, 'watchTeam').mockResolvedValue({ kind: 'changed', cursor: current.team.cursor })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForWorkflowPlan(authority, {
        planId: started.id,
      }))).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_QUIESCENT' })
      expect(watch).toHaveBeenCalled()
      watch.mockResolvedValueOnce({ kind: 'closed' })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForWorkflowPlan(authority, {
        planId: started.id,
      }))).rejects.toThrow('closed before workflow plan')
      const aborted = new AbortController()
      const reason = new Error('Stop waiting for the workflow')
      aborted.abort(reason)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForWorkflowPlan(authority, {
        planId: started.id, signal: aborted.signal,
      }))).rejects.toBe(reason)
      const beforeStall = await ctx.teams.getTeam({ teamId: run.teamId })
      const scope: Extract<TeamSystemPhaseScope, { readonly kind: 'scheduler-stall' }> = {
        kind: 'scheduler-stall', teamId: run.teamId, phase: 'stalled',
        reason: { code: 'TASK_NO_ELIGIBLE_OWNER', message: 'The workflow has no eligible owner.' },
      }
      await ctx.teams.transitionTeamPhase({ actor: schedulerStallAuthority(ctx, scope), teamId: run.teamId,
        expectedCursor: beforeStall.team.cursor, phase: scope.phase, reason: scope.reason })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForWorkflowPlan(authority, {
        planId: started.id,
      }))).rejects.toThrow('stalled before workflow')
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  })

  it('binds workflow cancellation to its exact task and leaves another plan pending', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerPreset: 'worker' }, adapter)
    await ctx.plugin(TeamWorkspaceRegistry)
    ctx.teamWorkspaces.registerProvider(taskWorkspaceProvider)
    const run = await ctx.teamRuns.create({ objective: 'Cancel one owned workflow task.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => request.participantId === run.worker!.id
      ? await activate({ ...request, agent: { options: request.agent.options,
        ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd } } }) : await activate(request))
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Cancel one workflow.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const plans = []
      for (const id of ['selected', 'unrelated']) {
        plans.push(await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
          idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse(`cancel-workflow-${id}`), plan: workflowPlan(),
        })))
      }
      const selected = plans[0]!
      const unrelated = plans[1]!
      const before = await ctx.teams.getTeam({ teamId: run.teamId })
      const other = before.tasks.find(task => task.workflowPlanId === unrelated.id)!
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelWorkflowTask(authority, {
        planId: selected.id, templateId: teamWorkflowTaskTemplateIdSchema.parse('unbound-template'),
      }))).rejects.toThrow("workflow template 'unbound-template' is not bound")
      const cancel = ctx.teams.cancelTask.bind(ctx.teams)
      let accepted: Parameters<typeof cancel>[0] | undefined
      vi.spyOn(ctx.teams, 'cancelTask').mockImplementation(async (request) => {
        accepted = request
        await expect(cancel({ ...request, taskId: other.id, expectedRevision: other.revision }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        return await cancel(request)
      })
      const selection = { planId: selected.id, templateId: selected.plan.tasks[0]!.id }
      const result = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelWorkflowTask(authority, selection))
      expect(result).toMatchObject({ phase: 'cancelled', cancellation: { attemptId: null, expired: false }, blockedByOutcome: null })
      const request = accepted
      if (request === undefined) throw new Error('Workflow cancellation did not reach the Hub')
      expect(() => JSON.stringify(request.actor)).toThrow('runtime-only')
      await expect(cancel(request)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const after = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(after.workflowPlans?.find(plan => plan.id === selected.id)).toMatchObject({ phase: 'cancelled' })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForWorkflowPlan(authority, {
        planId: selected.id,
      }))).resolves.toMatchObject({ id: selected.id, phase: 'cancelled' })
      expect(after.workflowPlans?.find(plan => plan.id === unrelated.id)).toEqual(unrelated)
      expect(after.tasks.filter(task => task.workflowPlanId === unrelated.id))
        .toEqual(before.tasks.filter(task => task.workflowPlanId === unrelated.id))
      expect(after.team.phase).toBe('active')
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  })

  it.each(['TEAM_CURSOR_CONFLICT', 'TEAM_TASK_STALE_REVISION'] as const)(
    'retries workflow task cancellation after %s with fresh task authority', async (code) => {
      const adapter = new CoordinatorGateWorkerReplyAdapter()
      const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0, receiptRetryAttempts: 2, members: [{
        role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: [],
        provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
      }] }, adapter)
      const run = await ctx.teamRuns.create({ objective: 'Retry one workflow task cancellation.', cwd: process.cwd() })
      const coordinator = run.coordinatorLease.localAgent
      if (coordinator === undefined) throw new Error('Team run has no coordinator')
      coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Cancel one workflow task.' }], source: { kind: 'user' } }))
      await adapter.coordinatorStarted.promise
      try {
        const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
        const base = workflowPlan(1, ['builder'])
        const plan = teamWorkflowPlanSchema.parse({ ...base, tasks: base.tasks.map(task => ({
          ...task, requiredCapabilities: [],
        })) })
        const started = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
          idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse(`retry-workflow-cancel-${code}`), plan,
        }))
        const cancelTask = ctx.teams.cancelTask.bind(ctx.teams)
        const cancel = vi.spyOn(ctx.teams, 'cancelTask')
          .mockRejectedValueOnce(new TeamError('workflow task moved before cancellation', code))
          .mockImplementation(async request => await cancelTask(request))
        const result = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelWorkflowTask(authority, {
          planId: started.id, templateId: plan.tasks[0]!.id,
        }))
        expect(result.phase).toBe('cancelled')
        expect(cancel).toHaveBeenCalledTimes(2)
        expect(cancel.mock.calls[0]?.[0]?.actor).not.toBe(cancel.mock.calls[1]?.[0]?.actor)
        await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelWorkflowTask(authority, {
          planId: started.id, templateId: plan.tasks[0]!.id,
        }))).resolves.toMatchObject({ id: result.id, phase: 'cancelled' })
      } finally { adapter.releaseCoordinator.resolve(undefined) }
    })

  it('leaves a workflow task pending when cancellation exhausts its revision retries', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0, receiptRetryAttempts: 1, members: [{
      role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: [],
      provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
    }] }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Report exhausted workflow cancellation.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Cancel one workflow task.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const base = workflowPlan(1, ['builder'])
      const plan = teamWorkflowPlanSchema.parse({ ...base, tasks: base.tasks.map(task => ({
        ...task, requiredCapabilities: [],
      })) })
      const started = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-cancel-exhausted'), plan,
      }))
      const cancel = vi.spyOn(ctx.teams, 'cancelTask')
        .mockRejectedValue(new TeamError('workflow task revision remains stale', 'TEAM_TASK_STALE_REVISION'))
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelWorkflowTask(authority, {
        planId: started.id, templateId: plan.tasks[0]!.id,
      }))).rejects.toThrow('workflow task cancellation exhausted its revision retries')
      const pending = (await ctx.teams.getTeam({ teamId: run.teamId })).tasks.find(task => task.workflowPlanId === started.id)
      expect(pending?.phase).toBe('pending')
      cancel.mockRestore()
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelWorkflowTask(authority, {
        planId: started.id, templateId: plan.tasks[0]!.id,
      }))).resolves.toMatchObject({ phase: 'cancelled' })
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  })

  it('keeps retryable dependencies pending and projects only selected descendants after retry exhaustion', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setupTaskRun(adapter)
    const run = await ctx.teamRuns.create({ objective: 'Preserve retries before propagating dependency failure.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => request.participantId === run.worker!.id
      ? await activate({ ...request, agent: { options: request.agent.options,
        ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd } } }) : await activate(request))
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Execute the retry workflow.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const base = workflowPlan()
      const plan = teamWorkflowPlanSchema.parse({ ...base,
        tasks: base.tasks.map(task => ({ ...task, maxAttempts: task.id === 'research' ? 2 : 1 })),
        bounds: { ...base.bounds, maxTotalAttempts: 3 },
        result: { kind: 'task-results', taskTemplateIds: ['synthesis'] },
      })
      const started = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-retry-dependency'), plan,
      }))
      const tasks = (await ctx.teams.getTeam({ teamId: run.teamId })).tasks
      const target = tasks.find(task => task.workflowTemplateId === 'research')!
      const dependent = tasks.find(task => task.workflowTemplateId === 'synthesis')!
      for (const ordinal of [1, 2]) {
        await vi.waitFor(async () => {
          const current = await ctx.teams.getTask({ teamId: run.teamId, taskId: target.id })
          expect(current).toMatchObject({ phase: 'running', attemptCount: ordinal })
        }, { timeout: 5000 })
        expect(await ctx.teams.getTask({ teamId: run.teamId, taskId: dependent.id }))
          .toMatchObject({ phase: 'pending', attemptCount: 0 })
        await settleTaskAttemptAsOwner(ctx, await ctx.teams.getTask({ teamId: run.teamId, taskId: target.id }), {
          kind: 'failed', failure: { code: 'WORK_FAILED', message: 'Task attempt could not complete.' },
        })
      }
      const terminal = await ctx.agents.withInitiator(coordinator,
        async () => await ctx.teamRuns.waitForWorkflowPlan(authority, { planId: started.id }))
      const after = await ctx.teams.getTeam({ teamId: run.teamId })
      const failed = after.tasks.find(task => task.id === target.id)!
      expect(failed.attemptHistory.map(attempt => attempt.outcome.kind)).toEqual(['failed', 'failed'])
      expect(terminal).toMatchObject({ phase: 'failed', result: { kind: 'task-results', tasks: [{
        templateId: 'synthesis', taskId: dependent.id, phase: 'cancelled',
        blockedByOutcome: { taskId: target.id, revision: failed.revision, phase: 'failed' },
      }] } })
      const revisions = after.tasks.map(task => task.revision)
      await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelWorkflowTask(authority, {
        planId: started.id, templateId: plan.tasks[0]!.id, reason: 'Preserve the settled attempt.' } ))
      expect((await ctx.teams.getTeam({ teamId: run.teamId })).tasks.map(task => task.revision)).toEqual(revisions)
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  })

  it('binds one root creation proof to the exact default Team payload and revokes it after Hub admission', async () => {
    const ctx = await setup()
    const internals = rootCreationProofInternals(ctx.teamRuns)
    const createTeam = ctx.teams.createTeam.bind(ctx.teams)
    const objective = 'Create one proof-owned default Team.'
    let proof: TeamSystemRootCreationProof | undefined
    vi.spyOn(ctx.teams, 'createTeam').mockImplementationOnce(async (request) => {
      if (!('actor' in request)) throw new Error('Team-run did not submit a root creation proof')
      if ('parentTeamId' in request) throw new Error('Team-run submitted a child creation request for its root Team')
      proof = request.actor
      const record = internals.rootCreationProofs.get(proof)
      expect(record?.scope).toEqual({
        kind: 'team-run-root-create',
        goal: { objective, budgets: {} },
        rules: {
          productTemplate: { id: 'default-v1', version: 1 },
          workerPool: { count: 1 },
          workspacePath: process.cwd(),
        },
        budgets: {},
      })
      expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
      expect(() => structuredClone(proof)).toThrow()
      return await createTeam(request)
    })

    const run = await ctx.teamRuns.create({ objective, cwd: process.cwd() })
    if (proof === undefined) throw new Error('Team-run did not issue a root creation proof')
    expect(internals.rootCreationProofs.get(proof)).toBeUndefined()
    expect(run.team).toMatchObject({ createdBy: { kind: 'system', name: 'team-run' } })
    await expect(ctx.teams.createTeam({
      actor: proof,
      goal: { objective, budgets: {} },
      rules: {
        productTemplate: { id: 'default-v1', version: 1 },
        workerPool: { count: 1 },
      },
      budgets: {},
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })

  it('uses a runtime-only invitation proof for system human endpoint consent', async () => {
    const ctx = await setup()
    const acknowledge = vi.spyOn(ctx.teams, 'acknowledgeChannelInvitation')
    const run = await ctx.teamRuns.create({ objective: 'Accept the system result endpoint.', cwd: process.cwd() })
    const consent = acknowledge.mock.calls.find(([request]) => request.channelId === run.channel.manifest.id)?.[0]
    if (consent === undefined) throw new Error('TeamRun did not acknowledge the system human invitation')
    expect(() => JSON.stringify(consent.actor)).toThrow('runtime-only')
    await expect(ctx.teams.acknowledgeChannelInvitation(consent))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })

  it('grants the default human the immutable interactive product-control authority', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Grant authenticated channel posting.', cwd: process.cwd() })
    expect(run.recipient.owner).toEqual({ kind: 'system' })
    expect(run.recipient.authorityGrant).toEqual({
      operations: ['send', 'dispatch', 'human-action', 'goal-mutate', 'invite', 'activate', 'close', 'interrupt', 'channel-open', 'task-mutate'],
      workspaceModes: ['shared'],
      readScopes: [],
      writeScopes: [],
      budgets: {},
    })
  })

  it('creates the default topology, receives human content through a direct v3 channel, and completes only after explicit human-addressed final output', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(true, {}, adapter)
    const topology = topologyProofInternals(ctx.teamRuns)
    const inviteParticipant = ctx.teams.inviteParticipant.bind(ctx.teams)
    const transitionParticipantPhase = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
    const openChannel = ctx.teams.openChannel.bind(ctx.teams)
    const proofs: TeamSystemTopologyProof[] = []
    const scopes: TeamSystemTopologyScope[] = []
    const capture = (actor: TeamSystemTopologyProof): void => {
      const scope = topology.topologyProofs.get(actor)?.scope
      if (scope === undefined) throw new Error('Team-run did not retain topology proof during its Hub call')
      proofs.push(actor)
      scopes.push(scope)
      expect(Object.isFrozen(actor)).toBe(true)
      expect(() => JSON.stringify(actor)).toThrow(/runtime-only/u)
    }
    vi.spyOn(ctx.teams, 'inviteParticipant').mockImplementation(async (request) => {
      capture(request.actor as TeamSystemTopologyProof)
      return await inviteParticipant(request)
    })
    vi.spyOn(ctx.teams, 'transitionParticipantPhase').mockImplementation(async (request) => {
      capture(request.actor as TeamSystemTopologyProof)
      return await transitionParticipantPhase(request)
    })
    vi.spyOn(ctx.teams, 'openChannel').mockImplementation(async (request) => {
      capture(request.actor as TeamSystemTopologyProof)
      return await openChannel(request)
    })
    const run = await ctx.teamRuns.create({
      objective: 'Review the durable Team result.',
      cwd: process.cwd(),
    })
    expect(scopes.map(scope => scope.kind)).toEqual([
      'team-run-bootstrap-participant-invite',
      'team-run-bootstrap-participant-phase',
      'team-run-bootstrap-participant-phase',
      'team-run-bootstrap-participant-invite',
      'team-run-bootstrap-participant-phase',
      'team-run-bootstrap-participant-phase',
      'team-run-bootstrap-participant-invite',
      'team-run-bootstrap-participant-phase',
      'team-run-bootstrap-channel-open',
    ])
    const channelScope = scopes.at(-1)
    if (channelScope?.kind !== 'team-run-bootstrap-channel-open') {
      throw new Error('Team-run did not retain a bootstrap direct-channel scope')
    }
    expect(channelScope.expectedCursor).toBeTypeOf('number')
    expect(channelScope).toMatchObject({
      kind: 'team-run-bootstrap-channel-open',
      teamId: run.teamId,
      humanId: run.recipient.id,
      coordinatorId: run.coordinator.id,
      adapter: { type: 'direct', version: 4 },
      viewPolicy: { type: 'directed', version: 1 },
      participants: [{ id: run.recipient.id, role: 'human' }, { id: run.coordinator.id, role: 'coordinator' }],
      limits: {},
    })
    expect(proofs.every(proof => !topology.topologyProofs.has(proof))).toBe(true)
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
      rules: { productTemplate: { id: 'default-v1', version: 1 } },
    })
    expect([run.recipient, run.coordinator, run.worker]).toMatchObject([
      {
        kind: 'human', role: 'human', phase: 'active', authorityGrant: {
          operations: ['send', 'dispatch', 'human-action', 'goal-mutate', 'invite', 'activate', 'close', 'interrupt', 'channel-open', 'task-mutate'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {},
        },
      },
      { kind: 'local-agent', role: 'coordinator', phase: 'active' },
      { kind: 'local-agent', role: 'worker', phase: 'provisioning' },
    ])
    expect(run.channel.manifest.adapter).toEqual({ type: 'direct', version: 4 })
    if (run.coordinatorLease.localAgent === undefined) throw new Error('local Team-run coordinator was not published')
    expect(run.coordinatorLease.localAgent.session.header).toMatchObject({
      teamId: run.teamId,
      participantId: run.coordinator.id,
      cwd: process.cwd(),
    })

    const input = await ctx.teamRuns.postHumanInput({
      teamId: run.teamId,
      content: [{ type: 'text', text: 'Start the review.' }],
    })
    expect(input.kind).toBe(DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND)
    expect(input.payload).toEqual({ content: [{ type: 'text', text: 'Start the review.' }] })
    await vi.waitFor(() => {
      expect(run.coordinatorLease.localAgent?.session.events.some(event => event.type === 'user/message'
        && event.data.source.kind === 'team-envelope'
        && event.data.source.envelopeId === input.id)).toBe(true)
    })
    await adapter.started.promise

    const coordinatorLink = await ctx.teamLinks.connect({ provider: 'local', binding: run.coordinatorLease.binding })
    try {
      const channel = await ctx.teams.getChannel({ channelId: run.channel.manifest.id })
      const final = await coordinatorLink.post({
        expectedCursor: channel.cursor,
        idempotencyKey: channelPostIdempotencyKeySchema.parse('team-run-final'),
        draft: {
          channelId: channel.manifest.id,
          audience: [run.recipient.id],
          kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
          payload: { text: 'The review is complete.' },
          delivery: 'turn',
        },
      })
      const waiting = ctx.teamRuns.waitForFinal({ teamId: run.teamId })
      adapter.release.resolve(undefined)
      const result = await waiting
      expect(result).toEqual({
        teamId: run.teamId,
        channelId: run.channel.manifest.id,
        envelopeId: final.id,
        text: 'The review is complete.',
      })
    } finally {
      await coordinatorLink.close()
    }

    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
      team: { phase: 'completed' },
      activations: [{ activation: { participantId: run.coordinator.id, status: 'offline' } }],
    })
    const channel = await ctx.teams.readChannel({ channelId: run.channel.manifest.id, afterCursor: -1 })
    expect(channel.records.filter(record => record.type === 'channel/receipt')).toHaveLength(2)
  })

  it('admits a bounded child task with zero worker capacity and projects its service result', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0 }, adapter, true, { maxTeamDepth: 1 })
    const run = await ctx.teamRuns.create({ objective: 'Delegate bounded work.', cwd: process.cwd() })
    await ctx.teamRuns.postHumanInput({ teamId: run.teamId, content: [{ type: 'text', text: 'Create a child task.' }] })
    await adapter.started.promise
    const coordinator = run.coordinatorLease.localAgent!
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const request = { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('bounded-child-task'), subject: 'Nested research',
      instructions: 'Return a concise research result.', readScopes: [], writeScopes: [], budget: { maxTurns: 3, maxConcurrency: 1 } }
    const initiate = <T>(operation: () => Promise<T>) => ctx.agents.withInitiator(coordinator, operation)
    try {
      await expect(ctx.teamRuns.startDelegatedTask(authority, request)).rejects.toMatchObject({ code: 'TEAM_RUN_COORDINATOR_INVALID' })
      await expect(initiate(() => ctx.teamRuns.startDelegatedTask(authority, { ...request, templateId: 'default-v1' })))
        .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      const accepted = await initiate(() => ctx.teamRuns.startDelegatedTask(authority, request))
      expect(await initiate(() => ctx.teamRuns.startDelegatedTask(authority, request))).toEqual(accepted)
      const current = await ctx.teams.getTeam({ teamId: run.teamId })
      const task = current.tasks.find(candidate => candidate.id === accepted.id)!
      expect(task).toMatchObject({ execution: { kind: 'child-team', templateId: 'default-v1', templateVersion: 1,
        budget: request.budget, authorityGrant: { readScopes: [], writeScopes: [], workspaceModes: ['shared'], budgets: request.budget } },
      requiredCapabilities: [], reviewPolicy: { kind: 'none' }, maxAttempts: 1, delegation: { phase: 'requested' } })
      expect(await initiate(() => ctx.teamRuns.setWorkerPoolSize(authority, { targetCount: 0 })))
        .toMatchObject({ queuedTaskCount: 0, workerCount: 0 })
      const execution = task.execution
      const delegation = task.delegation
      if (execution.kind !== 'child-team' || delegation === undefined) throw new Error('Expected the admitted child task')
      const binding = teamChildRunBindingSchema.parse({ parentTeamId: run.teamId, parentTaskId: task.id, childTeamId: 'projected-child',
        delegationId: delegation.id, parentServiceId: run.recipient.id,
        coordinatorId: run.coordinator.id, channelId: run.channel.manifest.id })
      const text = 'Explicit child summary'
      const result = teamDelegationResultAdmissionSchema.parse({ binding, text, artifacts: [],
        requestEnvelopeId: 'projected-request', requestSequence: 1, responseEnvelopeId: 'projected-response', responseSequence: 2,
        contentFingerprint: fingerprintTeamChildResultContent({ text }), parentTaskRevision: task.revision + 3,
        parentCursor: current.team.cursor + 3, admittedAt: current.team.updatedAt + 3 })
      const completed = teamTaskSnapshotSchema.parse({ ...task, revision: task.revision + 4, phase: 'completed', attemptCount: 1,
        delegation: { ...delegation, phase: 'completed', childTeamId: binding.childTeamId, startedAt: current.team.updatedAt + 1,
          updatedAt: current.team.updatedAt + 4, childCursor: 9, result,
          creation: { parentTeamId: run.teamId, parentTaskId: task.id, delegationId: delegation.id,
            goal: { objective: request.instructions, budgets: { ...request.budget } }, rules: { workspacePath: process.cwd() },
            budgets: { ...request.budget }, authorityGrant: execution.authorityGrant } } })
      const getTeam = ctx.teams.getTeam.bind(ctx.teams)
      const projection = vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async input => input.teamId !== run.teamId ? await getTeam(input)
        : { ...current,
          team: { ...current.team, cursor: current.team.cursor + 4, updatedAt: current.team.updatedAt + 4 }, tasks: [completed] })
      try {
        expect(await initiate(() => ctx.teamRuns.listDefaultWorkerTasks(authority))).toMatchObject({ tasks: [{ id: task.id,
          childTeamId: binding.childTeamId, delegationResult: { text: result.text, artifacts: [] } }] })
        expect(await initiate(() => ctx.teamRuns.waitForDefaultWorkerTask(authority, { taskId: task.id })))
          .toMatchObject({ phase: 'completed', result: { summary: result.text, artifacts: [] } })
      } finally { projection.mockRestore() }
      await initiate(() => ctx.teamRuns.cancelDefaultWorkerTask(authority, { taskId: task.id }))
    } finally { adapter.release.resolve(undefined); await ctx.teamRuns.cancel(run.teamId) }
  })

  it('creates and completes a coordinator-only Team without silently provisioning a worker', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Complete local work without delegation.', cwd: process.cwd() })
    expect(run.worker).toBeUndefined()
    expect(run.workers).toEqual([])
    await ctx.teamRuns.postHumanInput({ teamId: run.teamId, content: [{ type: 'text', text: 'Complete the work yourself.' }] })
    await adapter.started.promise
    const coordinator = run.coordinatorLease.localAgent!
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('disabled-worker'), subject: 'No worker capacity',
      instructions: 'This task must not silently create a worker.', readScopes: [], writeScopes: [],
    }))).rejects.toMatchObject({ code: 'TEAM_RUN_INVALID_WORKER_POOL' })
    await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDelegatedTask(authority, {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('depth-disabled-child'), subject: 'No child depth',
      instructions: 'Reject before reserving a task.', readScopes: [], writeScopes: [], budget: { maxTurns: 1 },
    }))).rejects.toMatchObject({ code: 'TEAM_DELEGATION_INVALID' })
    const link = await ctx.teamLinks.connect({ provider: 'local', binding: run.coordinatorLease.binding })
    try {
      const channel = await ctx.teams.getChannel({ channelId: run.channel.manifest.id })
      await link.post({ expectedCursor: channel.cursor, idempotencyKey: channelPostIdempotencyKeySchema.parse('coordinator-only-final'),
        draft: { channelId: channel.manifest.id, audience: [run.recipient.id], kind: 'final', delivery: 'turn', payload: { text: 'Completed without delegation.' } } })
      adapter.release.resolve(undefined)
      expect(await ctx.teamRuns.waitForFinal({ teamId: run.teamId })).toMatchObject({ text: 'Completed without delegation.' })
      const state = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(state.team.phase).toBe('completed')
      expect(state.participants.map(participant => participant.role)).toEqual(['human', 'coordinator'])
      expect(state.tasks).toEqual([])
    } finally { await link.close() }
  })

  it('resumes a coordinator-only Team using the same Participant and Session', async () => {
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0 })
    const run = await ctx.teamRuns.create({ objective: 'Resume without a worker.', cwd: process.cwd() })
    await run.coordinatorLease.dispose()
    ownedRuns(ctx.teamRuns).delete(run.teamId)
    const resumed = await ctx.teamRuns.resume({ teamId: run.teamId })
    expect(resumed.workers).toEqual([])
    expect(resumed.worker).toBeUndefined()
    expect(resumed.coordinator.id).toBe(run.coordinator.id)
    expect(resumed.coordinatorLease.binding.sessionId).toBe(run.coordinatorLease.binding.sessionId)
  })

  it('preflights an authenticated product owner before cold coordinator recovery', async () => {
    const config = { workerCount: 0, maxWorkerCount: 0 }
    const ctx = await setup(true, config)
    const humanOwner = { kind: 'product-principal' as const, principalId: 'owner-a' as never }
    const original = await withPrincipalAdmission(ctx, 'owner-a', async admitHumanChannel => await ctx.teamRuns.create({
      objective: 'Recover a principal-owned Team.', cwd: process.cwd(), humanOwner, admitHumanChannel,
    }))
    const runtime = ctx.registry.get(TeamRun)
    if (runtime === undefined) throw new Error('TeamRun plugin is not mounted')
    for (const fiber of [...runtime.fibers]) await fiber.dispose()
    await ctx.plugin(TeamRun, config)
    const preflight = vi.spyOn(ctx.teamActivations, 'preflightResume')
    const recovered = await withPrincipalAdmission(ctx, 'owner-a', async (admitHumanChannel, call) => {
      const current = await ctx.teams.getTeam({ teamId: original.teamId })
      const input = { teamId: original.teamId, expectedCursor: current.team.cursor }
      return await ctx.teamHumanActors.withProof(call, {
        teamId: input.teamId, operation: 'activate', fence: { kind: 'cursor', cursor: input.expectedCursor },
        payload: jsonObjectSchema.parse(structuredClone(input)),
      }, async (actor) => {
        const authorization = await ctx.teams.authorizeHumanResume({ actor, ...input })
        try {
          return await ctx.teamRuns.resume({ teamId: original.teamId, humanOwner, admitHumanChannel, authorization })
        } finally { authorization.close() }
      })
    })
    expect(recovered.coordinator.id).toBe(original.coordinator.id)
    expect(recovered.coordinatorLease.binding.sessionId).toBe(original.coordinatorLease.binding.sessionId)
    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({
      teamId: original.teamId, participantId: original.coordinator.id,
      activationId: original.coordinatorLease.binding.activation.id,
    }))
  })

  it('requires a current model route when a cold Team has no persisted coordinator request', async () => {
    const config = { workerCount: 0, maxWorkerCount: 0 }
    const ctx = await setup(true, config)
    const run = await ctx.teamRuns.create({ objective: 'Resume only with an explicit model route.', cwd: process.cwd() })
    const runtime = ctx.registry.get(TeamRun)
    if (runtime === undefined) throw new Error('TeamRun plugin is not mounted')
    for (const fiber of [...runtime.fibers]) await fiber.dispose()
    await ctx.plugin(TeamRun, config)
    const selection = vi.spyOn(ctx.agentDefaultModel, 'currentSelection').mockReturnValueOnce(undefined)
    await expect(ctx.teamRuns.resume({ teamId: run.teamId })).rejects.toMatchObject({ code: 'TEAM_RUN_MODEL_REQUIRED' })
    selection.mockRestore()
    const inspect = ctx.sessionPersistence.inspect.bind(ctx.sessionPersistence)
    for (const changed of [{ teamId: 'foreign-team' }, { participantId: 'foreign-participant' }]) {
      const foreign = vi.spyOn(ctx.sessionPersistence, 'inspect').mockImplementationOnce(async (...args) => {
        const result = await inspect(...args)
        return { ...result, meta: { ...result.meta, ...changed } }
      })
      await expect(ctx.teamRuns.resume({ teamId: run.teamId })).rejects.toThrow('does not belong to Team coordinator')
      foreign.mockRestore()
    }
    const missingCwd = vi.spyOn(ctx.sessionPersistence, 'inspect').mockImplementationOnce(async (...args) => {
      const result = await inspect(...args)
      const { cwd: _cwd, ...meta } = result.meta
      return { ...result, meta }
    })
    await expect(ctx.teamRuns.resume({ teamId: run.teamId })).rejects.toThrow('no persisted coordinator cwd')
    missingCwd.mockRestore()
    await expect(ctx.teamRuns.resume({ teamId: run.teamId,
      humanOwner: { kind: 'product-principal', principalId: 'foreign-owner' as never },
    })).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_FOUND' })
    const getTeam = ctx.teams.getTeam.bind(ctx.teams)
    const missingActivation = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (...args) => {
      const result = await getTeam(...args)
      return { ...result, activations: [] }
    })
    await expect(ctx.teamRuns.resume({ teamId: run.teamId })).rejects.toThrow('no durable coordinator activation')
    missingActivation.mockRestore()
    const resumed = await ctx.teamRuns.resume({ teamId: run.teamId })
    expect(resumed.coordinatorLease.binding.sessionId).toBe(run.coordinatorLease.binding.sessionId)
  })

  it('joins concurrent cold resumes before publishing one coordinator epoch', async () => {
    const config = { workerCount: 0, maxWorkerCount: 0 }
    const ctx = await setup(true, config)
    const original = await ctx.teamRuns.create({ objective: 'Coalesce cold coordinator recovery.', cwd: process.cwd() })
    const runtime = ctx.registry.get(TeamRun)
    if (runtime === undefined) throw new Error('TeamRun plugin is not mounted')
    for (const fiber of [...runtime.fibers]) await fiber.dispose()
    await ctx.plugin(TeamRun, config)
    const inspect = ctx.sessionPersistence.inspect.bind(ctx.sessionPersistence)
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.sessionPersistence, 'inspect').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined)
      await release.promise
      return await inspect(...args)
    })
    const first = ctx.teamRuns.resume({ teamId: original.teamId })
    await entered.promise
    const second = ctx.teamRuns.resume({ teamId: original.teamId })
    release.resolve(undefined)
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(a.coordinatorLease.binding.sessionId).toBe(original.coordinatorLease.binding.sessionId)
    const state = await ctx.teams.getTeam({ teamId: original.teamId })
    expect(state.activations.filter(binding => binding.activation.participantId === original.coordinator.id)).toHaveLength(2)
  })

  it('recovers declared members and worker capacity with their durable identities after a cold restart', async () => {
    const config: TeamRun.Config = { workerCount: 1, maxWorkerCount: 2, members: [{
      role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: ['build'],
      provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
    }] }
    const ctx = await setup(true, config)
    const original = await ctx.teamRuns.create({ objective: 'Recover the exact Team execution roster.', cwd: process.cwd() })
    const runtime = ctx.registry.get(TeamRun)
    if (runtime === undefined) throw new Error('TeamRun plugin is not mounted')
    for (const fiber of [...runtime.fibers]) await fiber.dispose()
    await ctx.plugin(TeamRun, config)

    const resumed = await ctx.teamRuns.resume({ teamId: original.teamId })
    expect(resumed.coordinator.id).toBe(original.coordinator.id)
    expect(resumed.worker?.id).toBe(original.worker?.id)
    expect(resumed.members.map(member => member.id)).toEqual(original.members.map(member => member.id))
    const state = await ctx.teams.getTeam({ teamId: original.teamId })
    expect(state.activations.filter(binding => binding.activation.participantId === original.coordinator.id)).toHaveLength(2)
    expect(state.activations.filter(binding => binding.activation.participantId === original.members[0]?.id)).toHaveLength(2)
  })

  it('recovers coordinator ownership of pending tasks and workflow plans after a cold restart', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const config = { workerPreset: 'worker' }
    const ctx = await setup(true, config, adapter, false)
    const run = await ctx.teamRuns.create({ objective: 'Recover durable coordinator work.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no local coordinator')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      const { preset: _preset, ...agent } = request.agent
      return await activate({ ...request, agent })
    })
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Prepare recoverable work.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const pending = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('cold-owned-task'),
      subject: 'Pending durable work', instructions: 'Wait for recovery.', readScopes: [], writeScopes: [],
    }))
    const plan = workflowPlan(1)
    const started = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startWorkflowPlan(authority, {
      idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('cold-owned-workflow'), plan,
    }))
    adapter.releaseCoordinator.resolve(undefined)
    await coordinator.whenIdle()
    const runtime = ctx.registry.get(TeamRun)
    if (runtime === undefined) throw new Error('TeamRun plugin is not mounted')
    for (const fiber of [...runtime.fibers]) await fiber.dispose()
    await ctx.plugin(TeamRun, config)

    const resumeAdapter = new GateAdapter()
    ctx.llm.registerAdapter(['resume-mock'], resumeAdapter)
    const resumed = await ctx.teamRuns.resume({ teamId: run.teamId,
      selection: { provider: 'resume-mock', model: 'mock' } })
    const current = resumed.coordinatorLease.localAgent
    if (current === undefined) throw new Error('Cold recovery did not publish a coordinator')
    current.followup(createUserMessage({ content: [{ type: 'text', text: 'Resume durable work.' }], source: { kind: 'user' } }))
    await resumeAdapter.started.promise
    try {
      const recoveredAuthority = ctx.teamRuns.coordinatorTaskAuthority(current)
      const tasks = await ctx.agents.withInitiator(current, async () => await ctx.teamRuns.listDefaultWorkerTasks(recoveredAuthority))
      expect(tasks.tasks.map(task => task.id)).toContain(pending.id)
      const cancelled = await ctx.agents.withInitiator(current, async () => await ctx.teamRuns.cancelWorkflowTask(recoveredAuthority, {
        planId: started.id, templateId: plan.tasks[0]!.id, reason: 'Owner resumed and withdrew this work.',
      }))
      expect(cancelled.phase).toBe('cancelled')
    } finally { resumeAdapter.release.resolve(undefined) }
  })

  it('reactivates the durable reviewer when a cold Team still owns a task in review', async () => {
    const config = { workerPreset: 'worker', reviewerPreset: 'worker' }
    const adapter = new FirstCoordinatorTurnGateAdapter()
    const ctx = await setupTaskRun(adapter, config)
    const basic = await import('@clocky/clocky-team-channel-basic')
    await ctx.plugin(basic)
    const run = await ctx.teamRuns.create({ objective: 'Recover a pending task review.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no coordinator')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    const reviewerBlock: { id?: ParticipantSnapshot['id']; active: boolean } = { active: false }
    const reviewerFailure = new Error('reviewer activation unavailable during recovery')
    const cleanupFailure = new Error('coordinator cleanup reply failed after release')
    let failedCoordinatorCleanup = false
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      if (reviewerBlock.active && request.participantId === reviewerBlock.id) throw reviewerFailure
      const { preset: _preset, ...agent } = request.agent
      const lease = await activate({ ...request, agent })
      if (!reviewerBlock.active || request.participantId !== run.coordinator.id) return lease
      return { binding: lease.binding, localAgent: lease.localAgent,
        health: () => lease.health(), interrupt: (...args) => { lease.interrupt(...args) },
        dispose: async () => {
          await lease.dispose()
          if (!failedCoordinatorCleanup) { failedCoordinatorCleanup = true; throw cleanupFailure }
        },
      }
    })
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Prepare a review before restart.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const created = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('cold-review-task'),
      subject: 'Review durable work', instructions: 'Produce a result for review.',
      readScopes: ['packages/team'], writeScopes: ['packages/team'],
    }))
    let running: TeamTaskSnapshot = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
    await vi.waitFor(async () => {
      running = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
      expect(running.phase).toBe('running')
    }, { timeout: 5000 })
    const reviewing = await settleTaskAttemptAsOwner(ctx, running, {
      kind: 'completed', result: { summary: 'Review after recovery.' },
    })
    expect(reviewing.phase).toBe('review')
    const reviewerId = reviewing.reviewPolicy.kind === 'participant' ? reviewing.reviewPolicy.reviewerId : undefined
    if (reviewerId === undefined) throw new Error('Task has no reviewer')
    reviewerBlock.id = reviewerId
    const scheduler = ctx.registry.get(TeamSchedulerDag)
    if (scheduler === undefined) throw new Error('Team scheduler is not mounted')
    for (const fiber of [...scheduler.fibers]) await fiber.dispose()
    adapter.releaseCoordinator.resolve(undefined)
    await coordinator.whenIdle()
    const runtime = ctx.registry.get(TeamRun)
    if (runtime === undefined) throw new Error('TeamRun plugin is not mounted')
    for (const fiber of [...runtime.fibers]) await fiber.dispose()
    await ctx.plugin(TeamRun, config)
    reviewerBlock.active = true
    await expect(ctx.teamRuns.resume({ teamId: run.teamId })).rejects.toBe(reviewerFailure)
    expect(failedCoordinatorCleanup).toBe(true)
    const afterFailure = await ctx.teams.getTeam({ teamId: run.teamId })
    const coordinatorEpochs = afterFailure.activations.filter(binding =>
      binding.activation.participantId === run.coordinator.id)
    expect(coordinatorEpochs.at(-1)?.activation.status).toBe('offline')
    reviewerBlock.active = false
    const resumed = await ctx.teamRuns.resume({ teamId: run.teamId })
    expect(resumed.coordinator.id).toBe(run.coordinator.id)
    const state = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(state.tasks.find(task => task.id === created.id)?.phase).toBe('review')
    expect(state.activations.filter(binding => binding.activation.participantId === reviewerId)).toHaveLength(2)
  }, 15_000)

  it('releases a resumed coordinator when a declared member prompt fails, then retries recovery', async () => {
    const config: TeamRun.Config = { workerCount: 0, maxWorkerCount: 0, members: [{
      role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: ['build'],
      provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
    }] }
    const ctx = await setup(true, config)
    const original = await ctx.teamRuns.create({ objective: 'Recover after a member prompt fault.', cwd: process.cwd() })
    const runtime = ctx.registry.get(TeamRun)
    if (runtime === undefined) throw new Error('TeamRun plugin is not mounted')
    for (const fiber of [...runtime.fibers]) await fiber.dispose()
    await ctx.plugin(TeamRun, config)
    const section = ctx.systemPrompt.section.bind(ctx.systemPrompt)
    const failure = new Error('resumed member reporting prompt unavailable')
    const prompt = vi.spyOn(ctx.systemPrompt, 'section').mockImplementation((request) => {
      if (request.name === 'team-run:template-task-report') throw failure
      return section(request)
    })
    await expect(ctx.teamRuns.resume({ teamId: original.teamId })).rejects.toBe(failure)
    const afterFailure = await ctx.teams.getTeam({ teamId: original.teamId })
    const coordinatorEpochs = afterFailure.activations.filter(binding =>
      binding.activation.participantId === original.coordinator.id)
    expect(coordinatorEpochs).toHaveLength(2)
    expect(coordinatorEpochs.every(binding => binding.activation.status === 'offline')).toBe(true)
    prompt.mockRestore()
    const recovered = await ctx.teamRuns.resume({ teamId: original.teamId })
    expect(recovered.coordinator.id).toBe(original.coordinator.id)
    expect(recovered.members.map(member => member.id)).toEqual(original.members.map(member => member.id))
  })

  it('drains activated member and coordinator leases when cold recovery is cancelled before publication', async () => {
    const config: TeamRun.Config = { workerCount: 0, maxWorkerCount: 0, members: [{
      role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: ['build'],
      provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
    }] }
    const ctx = await setup(true, config)
    const original = await ctx.teamRuns.create({ objective: 'Cancel a partially resumed roster.', cwd: process.cwd() })
    const runtime = ctx.registry.get(TeamRun)
    if (runtime === undefined) throw new Error('TeamRun plugin is not mounted')
    for (const fiber of [...runtime.fibers]) await fiber.dispose()
    await ctx.plugin(TeamRun, config)
    const controller = new AbortController()
    const reason = new Error('caller cancelled recovery after member activation')
    const section = ctx.systemPrompt.section.bind(ctx.systemPrompt)
    const prompt = vi.spyOn(ctx.systemPrompt, 'section').mockImplementation((request) => {
      const dispose = section(request)
      if (request.name === 'team-run:template-task-report') controller.abort(reason)
      return dispose
    })
    await expect(ctx.teamRuns.resume({ teamId: original.teamId, signal: controller.signal })).rejects.toBe(reason)
    const afterFailure = await ctx.teams.getTeam({ teamId: original.teamId })
    for (const participant of [original.coordinator, ...original.members]) {
      const epochs = afterFailure.activations.filter(binding => binding.activation.participantId === participant.id)
      expect(epochs).toHaveLength(2)
      expect(epochs.at(-1)?.activation.status).toBe('offline')
    }
    prompt.mockRestore()
    const recovered = await ctx.teamRuns.resume({ teamId: original.teamId })
    expect(recovered.coordinator.id).toBe(original.coordinator.id)
    expect(recovered.members.map(member => member.id)).toEqual(original.members.map(member => member.id))
  })

  it('refuses cold recovery after the Session persistence provider has been unmounted', async () => {
    const config = { workerCount: 0, maxWorkerCount: 0 }
    const ctx = await setup(true, config)
    const run = await ctx.teamRuns.create({ objective: 'Require durable Session recovery.', cwd: process.cwd() })
    const teamRun = ctx.registry.get(TeamRun), persistence = ctx.registry.get(JsonlSessionPersistence)
    if (teamRun === undefined || persistence === undefined) throw new Error('Recovery fixture is missing a mounted owner')
    for (const fiber of [...teamRun.fibers]) await fiber.dispose()
    for (const fiber of [...persistence.fibers]) await fiber.dispose()
    await ctx.plugin(TeamRun, config)
    await expect(ctx.teamRuns.resume({ teamId: run.teamId })).rejects.toThrow('requires a mounted Session persistence provider')
    const state = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(state.activations.filter(value => value.activation.participantId === run.coordinator.id)).toHaveLength(1)
  })

  it('re-attaches an offline durable coordinator without creating a new Team or Session', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Resume the durable Team.', cwd: process.cwd() })
    const oldActivationId = run.coordinatorLease.binding.activation.id
    const oldSessionId = run.coordinatorLease.binding.sessionId
    await run.coordinatorLease.dispose()
    ownedRuns(ctx.teamRuns).delete(run.teamId)

    const resumed = await ctx.teamRuns.resume({ teamId: run.teamId })
    expect(resumed.teamId).toBe(run.teamId)
    expect(resumed.coordinatorLease.binding.sessionId).toBe(oldSessionId)
    expect(resumed.coordinatorLease.binding.activation.id).not.toBe(oldActivationId)
    expect(resumed.coordinatorLease.localAgent?.session.id).toBe(oldSessionId)
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
      team: { phase: 'active' },
      activations: [
        { activation: { id: oldActivationId, status: 'offline' }, sessionId: oldSessionId },
        { activation: { participantId: run.coordinator.id, status: 'idle' }, sessionId: oldSessionId },
      ],
    })
  })

  it('waits for a Team cursor change, accepts a closed watch, and honors caller cancellation', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Wait for Team quiescence.', cwd: process.cwd() })
    const observed = await ctx.teams.inspectQuiescence(run.teamId)
    const inspect = vi.spyOn(ctx.teams, 'inspectQuiescence')
      .mockResolvedValueOnce({ ...observed, quiescent: false, reasons: ['channels-open'] })
      .mockResolvedValueOnce({ ...observed, quiescent: true, reasons: [] })
    const watchTeam = ctx.teams.watchTeam.bind(ctx.teams)
    const initialTeam = await ctx.teams.getTeam({ teamId: run.teamId })
    let response: Awaited<ReturnType<typeof ctx.teams.watchTeam>> = {
      kind: 'changed', cursor: initialTeam.team.cursor + 1,
    }
    const watch = vi.spyOn(ctx.teams, 'watchTeam').mockImplementation(async request =>
      request.signal === undefined ? response : await watchTeam(request))

    await expect(ctx.teamRuns.waitForQuiescence(run.teamId)).resolves.toMatchObject({
      teamId: run.teamId,
      quiescent: true,
      reasons: [],
    })
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(watch.mock.calls.filter(([request]) => request.signal === undefined)).toHaveLength(1)

    const current = await ctx.teams.getTeam({ teamId: run.teamId })
    inspect.mockReset()
    inspect.mockResolvedValueOnce({ ...observed, quiescent: false, reasons: ['channels-open'] })
    response = { kind: 'changed', cursor: current.team.cursor }
    await expect(ctx.teamRuns.waitForQuiescence(run.teamId)).rejects.toMatchObject({
      code: 'TEAM_RUN_NOT_QUIESCENT',
    })

    inspect.mockReset()
    inspect.mockResolvedValueOnce({ ...observed, quiescent: false, reasons: ['channels-open'] })
    inspect.mockResolvedValueOnce({ ...observed, quiescent: true, reasons: [] })
    watch.mockClear()
    response = { kind: 'closed' }
    await expect(ctx.teamRuns.waitForQuiescence(run.teamId)).resolves.toMatchObject({
      teamId: run.teamId,
      quiescent: true,
    })
    expect(inspect).toHaveBeenCalledTimes(2)

    const reason = new Error('cancel quiescence wait')
    await expect(ctx.teamRuns.waitForQuiescence(run.teamId, AbortSignal.abort(reason))).rejects.toBe(reason)
    watch.mockRestore()
    inspect.mockRestore()
    await run.coordinatorLease.dispose()
  })

  it('resumes one stalled offline Team through an ephemeral exact TeamRun phase proof', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Resume through a source-owned phase proof.', cwd: process.cwd() })
    await run.coordinatorLease.dispose()
    ownedRuns(ctx.teamRuns).delete(run.teamId)
    const beforeStall = await ctx.teams.getTeam({ teamId: run.teamId })
    const stallScope: Extract<TeamSystemPhaseScope, { readonly kind: 'scheduler-stall' }> = {
      kind: 'scheduler-stall',
      teamId: run.teamId,
      phase: 'stalled',
      reason: { code: 'TASK_NO_ELIGIBLE_OWNER', message: 'Prepare the TeamRun resume test.' },
    }
    await ctx.teams.transitionTeamPhase({
      actor: schedulerStallAuthority(ctx, stallScope),
      teamId: run.teamId,
      expectedCursor: beforeStall.team.cursor,
      phase: stallScope.phase,
      reason: stallScope.reason,
    })
    const internals = phaseProofInternals(ctx.teamRuns)
    const transitionTeamPhase = ctx.teams.transitionTeamPhase.bind(ctx.teams)
    let actor: TeamSystemPhaseProof | undefined
    const transition = vi.spyOn(ctx.teams, 'transitionTeamPhase').mockImplementationOnce(async (request) => {
      actor = request.actor
      expect(internals.resumePhaseProofs.get(actor)?.scope)
        .toEqual({ kind: 'team-run-resume', teamId: run.teamId, phase: 'active' })
      return await transitionTeamPhase(request)
    })
    const resumed = await ctx.teamRuns.resume({ teamId: run.teamId })
    const request = transition.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('Team-run did not request its canonical phase resume')
    if (actor === undefined) throw new Error('Team-run did not submit a resume phase proof')
    expect(request).toMatchObject({ teamId: run.teamId, phase: 'active' })
    expect(request).not.toHaveProperty('participantId')
    expect(() => JSON.stringify(actor)).toThrow(/runtime-only/u)
    expect(() => structuredClone(actor)).toThrow()
    expect(resumed.team).toMatchObject({ phase: 'active' })
    expect(internals.resumePhaseProofs.get(actor)).toBeUndefined()
    expect(internals.resumePhaseProofByTeam.has(run.teamId)).toBe(false)
    const active = await ctx.teams.getTeam({ teamId: run.teamId })
    await expect(ctx.teams.transitionTeamPhase({
      actor,
      teamId: run.teamId,
      expectedCursor: active.team.cursor,
      phase: 'active',
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })

  it('requests one human-to-coordinator interrupt through an ephemeral exact TeamRun proof', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Interrupt the current coordinator safely.', cwd: process.cwd() })
    const internals = interruptProofInternals(ctx.teamRuns)
    const requestInterrupt = ctx.teams.requestParticipantInterrupt.bind(ctx.teams)
    let actor: TeamSystemInterruptProof | undefined
    const request = vi.spyOn(ctx.teams, 'requestParticipantInterrupt').mockImplementationOnce(async (input) => {
      const proof = input.actor as TeamSystemInterruptProof
      actor = proof
      expect(internals.interruptProofs.get(proof)?.scope).toEqual({
        kind: 'team-run-human-interrupt',
        teamId: run.teamId,
        channelId: run.channel.manifest.id,
        humanId: run.recipient.id,
        coordinatorId: run.coordinator.id,
      })
      expect(input).not.toHaveProperty('actorId')
      expect(input).not.toHaveProperty('participantId')
      expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
      expect(() => structuredClone(proof)).toThrow()
      return await requestInterrupt(input)
    })
    const interrupt = await ctx.teamRuns.requestCoordinatorInterrupt(run.teamId)
    if (interrupt === undefined) throw new Error('active TeamRun did not request a coordinator interrupt')
    if (actor === undefined) throw new Error('TeamRun did not submit an interrupt proof')
    expect(interrupt).toMatchObject({ actorId: run.recipient.id, target: { participantId: run.coordinator.id } })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ teamId: run.teamId, actor }))
    expect(internals.interruptProofs.get(actor)).toBeUndefined()
    const state = await ctx.teams.getTeam({ teamId: run.teamId })
    await expect(ctx.teams.requestParticipantInterrupt({
      actor,
      teamId: run.teamId,
      expectedCursor: state.team.cursor,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })

  it('uses a coordinator authority to create replay-safe scoped worker tasks and map their terminal outcomes', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setupTaskRun(adapter)
    const run = await ctx.teamRuns.create({ objective: 'Delegate durable work.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    expect(run.worker).toMatchObject({ phase: 'provisioning', capabilities: ['team-default-worker'] })
    const topology = topologyProofInternals(ctx.teamRuns)
    const transitionParticipantPhase = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
    const workerScopes: TeamSystemTopologyScope[] = []
    vi.spyOn(ctx.teams, 'transitionParticipantPhase').mockImplementation(async (request) => {
      if (request.participantId === run.worker!.id) {
        const scope = topology.topologyProofs.get(request.actor as TeamSystemTopologyProof)?.scope
        if (scope === undefined) throw new Error('Team-run did not retain worker topology proof during its Hub call')
        workerScopes.push(scope)
      }
      return await transitionParticipantPhase(request)
    })
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    let workerAgent: typeof coordinator | undefined
    let workerRequest: { readonly agent: { readonly cwd?: string; readonly preset?: string; readonly options: object } } | undefined
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      if (request.participantId !== run.worker!.id) return await activate(request)
      workerRequest = request
      const lease = await activate({
        ...request,
        agent: {
          options: request.agent.options,
          ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
        },
      })
      workerAgent = lease.localAgent
      return lease
    })
    coordinator.followup(createUserMessage({
      content: [{ type: 'text', text: 'Create one worker task.' }],
      source: { kind: 'user' },
    }))
    await adapter.coordinatorStarted.promise
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const request = {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('team-run-worker-task'),
      subject: 'Inspect Team task delivery',
      instructions: 'Verify that the worker receives this durable assignment.',
      readScopes: ['packages/team'],
      writeScopes: ['packages/team/team-run'],
    }
    const createTask = vi.spyOn(ctx.teams, 'createTask')
    await expect(ctx.teamRuns.startDefaultWorkerTask(authority, request)).rejects.toMatchObject({
      code: 'TEAM_RUN_COORDINATOR_INVALID',
    })
    const created = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, request))
    expect(workerScopes).toHaveLength(1)
    const workerScope = workerScopes[0]
    if (workerScope?.kind !== 'team-run-worker-activate') {
      throw new Error('Team-run did not retain a default-worker activation scope')
    }
    expect(workerScope.expectedCursor).toBeTypeOf('number')
    expect(workerScope).toMatchObject({
      kind: 'team-run-worker-activate',
      teamId: run.teamId,
      participantId: run.worker!.id,
      expectedPhase: 'provisioning',
      phase: 'active',
    })
    const replay = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, request))
    expect(replay.id).toBe(created.id)
    const creationRequests = createTask.mock.calls.map(([candidate]) => candidate)
    expect(creationRequests).toHaveLength(2)
    expect(creationRequests.every(candidate => candidate.createCommand?.idempotencyKey === request.idempotencyKey)).toBe(true)
    expect(creationRequests.every(candidate => !('creator' in (candidate.createCommand ?? {})))).toBe(true)
    expect(new Set(creationRequests.map(candidate => candidate.actor)).size).toBe(2)
    const initialCreate = creationRequests[0]
    if (initialCreate === undefined) throw new Error('Team-run did not create the default-worker task')
    expect(initialCreate.actor).not.toHaveProperty('participantId')
    expect(() => JSON.stringify(initialCreate.actor)).toThrow(/runtime-only/u)
    const afterCreate = await ctx.teams.getTeam({ teamId: run.teamId })
    await expect(ctx.teams.createTask({
      ...initialCreate,
      expectedCursor: afterCreate.team.cursor,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })).resolves.toMatchObject({
      requiredCapabilities: ['team-default-worker'],
      workspaceMode: 'shared',
      reviewPolicy: { kind: 'none' },
      maxAttempts: 1,
      description: request.instructions,
      readScopes: request.readScopes,
      writeScopes: request.writeScopes,
      createCommand: {
        creator: {
          teamId: run.teamId,
          participantId: run.coordinator.id,
          activationId: run.coordinatorLease.binding.activation.id,
          sessionId: run.coordinatorLease.binding.sessionId,
          provider: run.coordinatorLease.binding.provider,
        },
        idempotencyKey: request.idempotencyKey,
      },
    })
    const publishedWorker = workerAgent
    const activationRequest = workerRequest
    if (publishedWorker === undefined || activationRequest === undefined) throw new Error('Team-run did not publish a default worker Agent')
    expect(publishedWorker.session.header).toMatchObject({
      teamId: run.teamId,
      participantId: run.worker!.id,
      cwd: process.cwd(),
    })
    await vi.waitFor(async () => {
      const task = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
      const channelId = task.lease?.wakeChannelId
      if (channelId === undefined) throw new Error('Team-run worker task has no assignment channel')
      const channel = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
      const envelope = channel.records.find(record => record.type === 'channel/envelope')
      if (envelope?.type !== 'channel/envelope') throw new Error('Team-run worker task has no assignment Envelope')
      const source = publishedWorker.session.events.find(event => event.type === 'user/message'
        && event.data.source.kind === 'team-task-assignment'
        && event.data.source.envelopeId === envelope.envelope.id)
      expect(source).toBeDefined()
      expect(task.phase).toBe('running')
    })
    expect(activationRequest.agent).toEqual({
      cwd: process.cwd(),
      preset: 'worker',
      options: { provider: 'mock', model: 'mock' },
    })
    expect((await ctx.systemPrompt.assemble({ agent: publishedWorker, scope: publishedWorker })).sections)
      .toContainEqual(expect.objectContaining({ name: 'team-run:worker-task-report' }))

    const final = await postFinal(ctx, run)
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toMatchObject({
      code: 'TEAM_RUN_NOT_QUIESCENT',
    })
    const beforeSettlement = await ctx.teams.readChannel({ channelId: run.channel.manifest.id, afterCursor: -1 })
    expect(beforeSettlement.records.some(record => record.type === 'channel/receipt' && record.envelopeId === final.id)).toBe(false)
    const running = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
    await settleTaskAttemptAsOwner(ctx, running, {
      kind: 'completed',
      result: { summary: 'Worker completed the assignment.' },
    })
    await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForDefaultWorkerTask(authority, {
      taskId: created.id,
    }))).resolves.toEqual({
      ...noReview,
      id: created.id,
      phase: 'completed',
      result: { summary: 'Worker completed the assignment.' },
    })

    const failed = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('team-run-worker-task-failure'),
      subject: 'Capture a worker failure',
      instructions: 'Report the durable worker failure.',
      readScopes: [],
      writeScopes: [],
    }))
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTask({ teamId: run.teamId, taskId: failed.id })).resolves.toMatchObject({ phase: 'running' })
    })
    const failedRunning = await ctx.teams.getTask({ teamId: run.teamId, taskId: failed.id })
    await settleTaskAttemptAsOwner(ctx, failedRunning, {
      kind: 'failed',
      failure: { code: 'WORKER_FAILED', message: 'The worker could not complete the assignment.' },
    })
    await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForDefaultWorkerTask(authority, {
      taskId: failed.id,
    }))).resolves.toEqual({
      ...noReview,
      id: failed.id,
      phase: 'failed',
      outcome: { kind: 'failed', failure: { code: 'WORKER_FAILED', message: 'The worker could not complete the assignment.' } },
    })
    adapter.releaseCoordinator.resolve(undefined)
    await coordinator.whenIdle()
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({ envelopeId: final.id })
    expect(ctx.agents.get(publishedWorker.id)).toBeUndefined()
  })

  it('fans out independent tasks across the configured worker pool and delivers each assignment', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setupTaskRun(adapter, { workerCount: 3, receiptRetryAttempts: 8 })
    const run = await ctx.teamRuns.create({ objective: 'Fan out independent work.', cwd: process.cwd() })
    expect(run.workers).toHaveLength(3)
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      if (!run.workers.some(worker => worker.id === request.participantId)) return await activate(request)
      return await activate({
        ...request,
        agent: {
          options: request.agent.options,
          ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
        },
      })
    })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Create three independent worker tasks.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const tasks: TeamRun.TeamRunDefaultWorkerTask[] = []
    for (const index of [1, 2, 3]) {
      tasks.push(await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
        idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`team-run-worker-pool-${String(index)}`),
        subject: `Independent task ${String(index)}`,
        instructions: `Complete independent task ${String(index)} and report the result.`,
        readScopes: [],
        writeScopes: [],
      })))
    }

    await vi.waitFor(async () => {
      const state = await ctx.teams.getTeam({ teamId: run.teamId })
      const assigned = state.tasks.filter(task => tasks.some(candidate => candidate.id === task.id))
      expect(assigned).toHaveLength(3)
      expect(assigned.every(task => task.phase === 'running' || task.phase === 'completed')).toBe(true)
      const owners = assigned.map(task => task.lease?.participantId ?? task.attemptHistory.at(-1)?.participantId)
      expect(new Set(owners).size).toBe(3)
      for (const task of assigned) {
        const attempt = task.attemptHistory.at(-1)
        const binding = state.activations.find(candidate => candidate.activation.id === (task.lease?.activationId ?? attempt?.activationId))
        if (binding === undefined) throw new Error(`task '${task.id}' has no worker activation binding`)
        const worker = ctx.agents.get(binding.sessionId)
        if (worker === undefined) throw new Error(`task '${task.id}' worker Session is not live`)
        expect(worker.session.events.some(event => event.type === 'user/message' && event.data.source.kind === 'team-task-assignment')).toBe(true)
      }
    }, { timeout: 10_000 })

    for (const task of tasks) {
      const running = await ctx.teams.getTask({ teamId: run.teamId, taskId: task.id })
      if (running.phase === 'running') {
        await settleTaskAttemptAsOwner(ctx, running, { kind: 'completed', result: { summary: `Completed ${task.id}.` } })
      }
    }
    adapter.releaseCoordinator.resolve(undefined)
    await ctx.teamRuns.cancel(run.teamId)
  }, 30_000)

  it('lets the coordinator grow and shrink the durable worker pool around task pressure', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 1, maxWorkerCount: 4 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Resize the worker pool.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Resize workers as work changes.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    for (const targetCount of [-1, 1.5]) {
      await expect(ctx.agents.withInitiator(coordinator, async () =>
        await ctx.teamRuns.setWorkerPoolSize(authority, { targetCount })))
        .rejects.toMatchObject({ code: 'TEAM_RUN_INVALID_WORKER_POOL' })
    }

    const grown = await ctx.agents.withInitiator(coordinator, async () =>
      await ctx.teamRuns.setWorkerPoolSize(authority, { targetCount: 3 }))
    expect(grown).toMatchObject({
      requestedCount: 3, targetCount: 3, maxCount: 4, workerCount: 3,
      activeCount: 3, idleCount: 3, busyCount: 0, queuedTaskCount: 0, saturated: false,
    })
    const afterGrow = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(afterGrow.participants.filter(participant => /^worker(?:-\d+)?$/u.test(participant.role))).toHaveLength(3)
    expect(afterGrow.participants.filter(participant => /^worker(?:-\d+)?$/u.test(participant.role)).every(participant => participant.phase === 'active')).toBe(true)
    expect(afterGrow.activations.filter(binding => /^worker(?:-\d+)?$/u.test(afterGrow.participants.find(participant => participant.id === binding.activation.participantId)?.role ?? '')
      && binding.activation.status === 'idle')).toHaveLength(3)

    const capped = await ctx.agents.withInitiator(coordinator, async () =>
      await ctx.teamRuns.setWorkerPoolSize(authority, { targetCount: 8 }))
    expect(capped).toMatchObject({ requestedCount: 8, targetCount: 4, maxCount: 4, workerCount: 4, activeCount: 4, saturated: true })

    const shrunk = await ctx.agents.withInitiator(coordinator, async () =>
      await ctx.teamRuns.setWorkerPoolSize(authority, { targetCount: 1 }))
    expect(shrunk).toMatchObject({
      requestedCount: 1, targetCount: 1, workerCount: 1, activeCount: 1,
      idleCount: 1, busyCount: 0, queuedTaskCount: 0, saturated: false,
    })
    const afterShrink = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(afterShrink.participants.filter(participant => participant.role !== 'worker' && /^worker-\d+$/u.test(participant.role)
      && participant.phase === 'left')).toHaveLength(3)
    const regrown = await ctx.agents.withInitiator(coordinator, async () =>
      await ctx.teamRuns.setWorkerPoolSize(authority, { targetCount: 3 }))
    expect(regrown).toMatchObject({ requestedCount: 3, targetCount: 3, workerCount: 3, activeCount: 3, idleCount: 3, saturated: false })
    const afterRegrow = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(afterRegrow.participants.filter(participant => /^worker(?:-\d+)?$/u.test(participant.role)
      && participant.phase === 'active').map(participant => participant.role)).toEqual(['worker', 'worker-2', 'worker-3'])
    adapter.releaseCoordinator.resolve(undefined)
    await ctx.teamRuns.cancel(run.teamId)
  }, 30_000)

  it('recovers a worker invitation whose provisioning committed before a cursor-conflict reply', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 1, maxWorkerCount: 2 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Recover an admitted worker provisioning.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Grow the worker pool.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const transition = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
    let committed = false
    vi.spyOn(ctx.teams, 'transitionParticipantPhase').mockImplementation(async (request) => {
      const result = await transition(request)
      if (!committed && request.phase === 'provisioning' && request.participantId !== run.worker?.id) {
        committed = true
        throw new TeamError('worker provisioning committed before the reply', 'TEAM_CURSOR_CONFLICT')
      }
      return result
    })
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const pool = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 2,
      }))
      expect(committed).toBe(true)
      expect(pool).toMatchObject({ workerCount: 2, activeCount: 2 })
      const workers = (await ctx.teams.getTeam({ teamId: run.teamId })).participants.filter(participant =>
        participant.role === 'worker' || participant.role === 'worker-2')
      expect(workers.map(worker => worker.role)).toEqual(['worker', 'worker-2'])
      expect(workers.every(worker => worker.phase === 'active')).toBe(true)
    } finally {
      adapter.releaseCoordinator.resolve(undefined)
      await ctx.teamRuns.cancel(run.teamId)
    }
  })

  it('retries a worker invitation whose provisioning failed before commit without leaving an orphan', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 1, maxWorkerCount: 2 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Retry an unprovisioned invited worker.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Grow the worker pool.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const failure = new Error('worker provisioning storage unavailable')
    const transition = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
    const fault = vi.spyOn(ctx.teams, 'transitionParticipantPhase').mockImplementation(async (request) => {
      if (request.phase === 'provisioning' && request.participantId !== run.worker?.id) throw failure
      return await transition(request)
    })
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 2,
      }))).rejects.toBe(failure)
      const afterFailure = await ctx.teams.getTeam({ teamId: run.teamId })
      const invited = afterFailure.participants.find(participant => participant.role === 'worker-2')
      expect(invited?.phase).toBe('invited')
      if (invited === undefined) throw new Error('Worker invitation was not retained')
      const route = await ctx.waterfall(ctx.teams, 'team/member-execution-observe',
        { teamId: run.teamId, participant: invited }, async () => ({}))
      expect(route.route).toMatchObject({ kind: 'managed', provider: 'in-process', reasons: [] })
      fault.mockRestore()
      const retried = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 2,
      }))
      expect(retried).toMatchObject({ workerCount: 2, activeCount: 2 })
      const workers = (await ctx.teams.getTeam({ teamId: run.teamId })).participants.filter(participant =>
        participant.role === 'worker' || /^worker-\d+$/u.test(participant.role))
      expect(workers.map(worker => worker.role)).toEqual(['worker', 'worker-2'])
      expect(workers.every(worker => worker.phase === 'active')).toBe(true)
    } finally {
      fault.mockRestore()
      adapter.releaseCoordinator.resolve(undefined)
      await ctx.teamRuns.cancel(run.teamId)
    }
  })

  it('retains a durable worker invitation when provisioning and its recovery read both fail', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 1, maxWorkerCount: 2 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Recover an invited worker after two provider faults.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Grow the worker pool.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const writeFailure = new Error('worker provisioning write unavailable')
    const readFailure = new Error('worker provisioning recovery read unavailable')
    const transition = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
    const getTeam = ctx.teams.getTeam.bind(ctx.teams)
    let failRead = false
    const writeFault = vi.spyOn(ctx.teams, 'transitionParticipantPhase').mockImplementation(async (request) => {
      if (request.phase === 'provisioning' && request.participantId !== run.worker?.id) {
        failRead = true
        throw writeFailure
      }
      return await transition(request)
    })
    const readFault = vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
      if (failRead && request.teamId === run.teamId) {
        failRead = false
        throw readFailure
      }
      return await getTeam(request)
    })
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 2,
      }))).rejects.toMatchObject({ errors: [writeFailure, readFailure] })
      writeFault.mockRestore()
      readFault.mockRestore()
      const retried = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 2,
      }))
      expect(retried).toMatchObject({ workerCount: 2, activeCount: 2 })
      const workers = (await ctx.teams.getTeam({ teamId: run.teamId })).participants.filter(participant =>
        participant.role === 'worker' || /^worker-\d+$/u.test(participant.role))
      expect(workers.map(worker => worker.role)).toEqual(['worker', 'worker-2'])
    } finally {
      writeFault.mockRestore()
      readFault.mockRestore()
      adapter.releaseCoordinator.resolve(undefined)
      await ctx.teamRuns.cancel(run.teamId)
    }
  })

  it.each([false, true] as const)(
    'retries a worker after reporting prompt failure (cleanup fails: %s)', async (cleanupFails) => {
      const adapter = new CoordinatorGateWorkerReplyAdapter()
      const ctx = await setup(true, { workerCount: 1, maxWorkerCount: 1 }, adapter)
      const run = await ctx.teamRuns.create({ objective: 'Retry worker prompt registration.', cwd: process.cwd() })
      const coordinator = run.coordinatorLease.localAgent
      if (coordinator === undefined || run.worker === undefined) throw new Error('Team run has no coordinator or worker')
      coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Activate the worker.' }], source: { kind: 'user' } }))
      await adapter.coordinatorStarted.promise
      const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
      const cleanupFailure = new Error('worker lease cleanup failed')
      let failCleanup = cleanupFails
      vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
        const lease = await activate(request)
        if (request.participantId !== run.worker?.id || !failCleanup) return lease
        failCleanup = false
        return { binding: lease.binding, localAgent: lease.localAgent,
          health: () => lease.health(), interrupt: (...args) => { lease.interrupt(...args) },
          dispose: async () => { await lease.dispose(); throw cleanupFailure },
        }
      })
      const section = ctx.systemPrompt.section.bind(ctx.systemPrompt)
      const failure = new Error('worker reporting prompt unavailable')
      const prompt = vi.spyOn(ctx.systemPrompt, 'section').mockImplementation((request) => {
        if (request.name === 'team-run:worker-task-report') throw failure
        return section(request)
      })
      try {
        const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
        await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
          targetCount: 1,
        }))).rejects.toBe(failure)
        const afterFailure = await ctx.teams.getTeam({ teamId: run.teamId })
        const workerEpochs = afterFailure.activations.filter(binding => binding.activation.participantId === run.worker?.id)
        expect(workerEpochs).toHaveLength(1)
        expect(workerEpochs[0]?.activation.status).toBe('offline')
        prompt.mockRestore()
        const retried = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
          targetCount: 1,
        }))
        expect(retried).toMatchObject({ workerCount: 1, activeCount: 1 })
        const current = await ctx.teams.getTeam({ teamId: run.teamId })
        expect(current.participants.filter(participant => participant.role === 'worker')).toHaveLength(1)
        expect(current.activations.filter(binding => binding.activation.participantId === run.worker?.id)).toHaveLength(2)
      } finally {
        prompt.mockRestore()
        adapter.releaseCoordinator.resolve(undefined)
        await ctx.teamRuns.cancel(run.teamId)
      }
    })

  it('reuses a worker activation whose durable start committed before its reply failed', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 1, maxWorkerCount: 1 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Recover a lost worker activation reply.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined || run.worker === undefined) throw new Error('Team run has no coordinator or worker')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Activate the worker.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    const failure = new Error('worker activation reply lost after commit')
    let originalLease: TeamActivationLease | undefined
    const fault = vi.spyOn(ctx.teamActivations, 'activate').mockImplementationOnce(async (request) => {
      originalLease = await activate(request)
      throw failure
    })
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 1,
      }))).rejects.toBe(failure)
      fault.mockRestore()
      const retried = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 1,
      }))
      expect(retried).toMatchObject({ workerCount: 1, activeCount: 1 })
      const state = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(state.participants.filter(participant => participant.role === 'worker')).toHaveLength(1)
      expect(state.activations.filter(binding => binding.activation.participantId === run.worker?.id)).toHaveLength(1)
    } finally {
      fault.mockRestore()
      adapter.releaseCoordinator.resolve(undefined)
      await originalLease?.dispose()
      await ctx.teamRuns.cancel(run.teamId)
    }
  })

  it('rejects a worker lease without a local Agent and retries the same Session', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 1, maxWorkerCount: 1 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Require a local worker Agent.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined || run.worker === undefined) throw new Error('Team run has no coordinator or worker')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Activate the worker.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    let omitWorkerAgent = true
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      const lease = await activate(request)
      if (request.participantId === run.worker?.id && omitWorkerAgent) return leaseWithoutLocalAgent(lease)
      return lease
    })
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 1,
      }))).rejects.toThrow('did not publish a local default worker Agent')
      const afterFailure = await ctx.teams.getTeam({ teamId: run.teamId })
      const prior = afterFailure.activations.find(binding => binding.activation.participantId === run.worker?.id)
      expect(prior?.activation.status).toBe('offline')
      omitWorkerAgent = false
      const retried = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 1,
      }))
      expect(retried).toMatchObject({ workerCount: 1, activeCount: 1 })
      const afterRetry = await ctx.teams.getTeam({ teamId: run.teamId })
      const epochs = afterRetry.activations.filter(binding => binding.activation.participantId === run.worker?.id)
      expect(epochs).toHaveLength(2)
      expect(epochs[1]?.sessionId).toBe(prior?.sessionId)
    } finally {
      adapter.releaseCoordinator.resolve(undefined)
      await ctx.teamRuns.cancel(run.teamId)
    }
  })

  it('reports worker-pool saturation when the Hub refuses another participant slot', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 1, maxWorkerCount: 3 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Report temporary worker capacity.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Expand worker capacity.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
    const fault = vi.spyOn(ctx.teams, 'inviteParticipant').mockImplementation(async (request) => {
      if (request.role === 'worker-2') throw new TeamError('Team participant capacity reached', 'TEAM_CHANNEL_BACKPRESSURE')
      return await invite(request)
    })
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const saturated = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 2,
      }))
      expect(saturated).toMatchObject({ requestedCount: 2, targetCount: 2, workerCount: 1, saturated: true })
      expect((await ctx.teams.getTeam({ teamId: run.teamId })).participants.filter(participant => participant.role === 'worker-2'))
        .toEqual([])
      fault.mockRestore()
      const recovered = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 2,
      }))
      expect(recovered).toMatchObject({ workerCount: 2, activeCount: 2, saturated: false })
    } finally {
      fault.mockRestore()
      adapter.releaseCoordinator.resolve(undefined)
      await ctx.teamRuns.cancel(run.teamId)
    }
  })

  it('retires a dynamically invited default worker when the pool returns to zero', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 1 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Scale the default worker down to zero.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Resize the worker pool.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 1,
      }))).resolves.toMatchObject({ workerCount: 1, activeCount: 1 })
      const grown = await ctx.teams.getTeam({ teamId: run.teamId })
      const worker = grown.participants.find(participant => participant.role === 'worker')
      if (worker === undefined) throw new Error('Pool growth did not invite its worker')
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 0,
      }))).resolves.toMatchObject({ targetCount: 0, workerCount: 0 })
      const shrunk = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(shrunk.participants.find(participant => participant.id === worker.id)?.phase).toBe('left')
      expect(shrunk.activations.findLast(binding => binding.activation.participantId === worker.id)?.activation.status)
        .toBe('offline')
    } finally {
      adapter.releaseCoordinator.resolve(undefined)
      await ctx.teamRuns.cancel(run.teamId)
    }
  })

  it('retains a shrinking worker while its completed attempt still awaits review', async () => {
    const adapter = new FirstCoordinatorTurnGateAdapter()
    const ctx = await setupTaskRun(adapter, { workerCount: 0, maxWorkerCount: 1,
      workerPreset: 'worker', reviewerPreset: 'worker' })
    const basic = await import('@clocky/clocky-team-channel-basic')
    await ctx.plugin(basic)
    const run = await ctx.teamRuns.create({ objective: 'Keep review initiator through pool shrink.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team run has no coordinator')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      const { preset: _preset, ...agent } = request.agent
      return await activate({ ...request, agent })
    })
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Prepare reviewed work.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const created = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
        idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('review-pool-shrink'),
        subject: 'Review a change', instructions: 'Produce work for review.',
        readScopes: ['packages/team'], writeScopes: ['packages/team'],
      }))
      let running: TeamTaskSnapshot = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
      await vi.waitFor(async () => {
        running = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
        expect(running.phase).toBe('running')
      }, { timeout: 5000 })
      const reviewing = await settleTaskAttemptAsOwner(ctx, running, {
        kind: 'completed', result: { summary: 'Work ready for review.' },
      })
      expect(reviewing.phase).toBe('review')
      const workerId = reviewing.attemptHistory.at(-1)?.participantId
      if (workerId === undefined) throw new Error('Reviewed task has no worker attempt')
      const shrunk = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 0,
      }))
      expect(shrunk).toMatchObject({ targetCount: 0, workerCount: 1 })
      expect((await ctx.teams.getTeam({ teamId: run.teamId })).participants.find(participant => participant.id === workerId)?.phase)
        .toBe('active')
      await vi.waitFor(async () => {
        const state = await ctx.teams.getTeam({ teamId: run.teamId })
        const channels = await Promise.all(state.channelIds.map(async channelId => await ctx.teams.getChannel({ channelId })))
        expect(channels.some(channel => channel.manifest.adapter.type === basic.CONSULT_CHANNEL_TYPE)).toBe(true)
      }, { timeout: 5000 })
      const postChannel = ctx.teams.postChannelEnvelope.bind(ctx.teams)
      let conflicted = false
      vi.spyOn(ctx.teams, 'postChannelEnvelope').mockImplementation(async (request) => {
        if (!conflicted && request.draft.kind === basic.CONSULT_RESPONSE_KIND) {
          conflicted = true
          throw new TeamError('Reviewer receipt advanced the channel cursor', 'TEAM_CHANNEL_CURSOR_CONFLICT')
        }
        return await postChannel(request)
      })
      await respondToTaskReview(ctx, reviewing, 'accepted')
      expect(conflicted).toBe(true)
      await vi.waitFor(async () => {
        const state = await ctx.teams.getTeam({ teamId: run.teamId })
        expect(state.tasks.find(task => task.id === created.id)?.phase).toBe('completed')
      }, { timeout: 5000 })
      const released = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 0,
      }))
      expect(released).toMatchObject({ targetCount: 0, workerCount: 0 })
      expect((await ctx.teams.getTeam({ teamId: run.teamId })).participants.find(participant => participant.id === workerId)?.phase)
        .toBe('left')
    } finally {
      adapter.releaseCoordinator.resolve(undefined)
      await ctx.teamRuns.cancel(run.teamId)
    }
  }, 15_000)

  it('keeps a capped busy pool active and reports queued work instead of blocking', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setupTaskRun(adapter, { workerCount: 1, maxWorkerCount: 1, receiptRetryAttempts: 8 })
    const run = await ctx.teamRuns.create({ objective: 'Queue work at the worker ceiling.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Queue two independent tasks.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      const state = await ctx.teams.getTeam({ teamId: run.teamId })
      const participant = state.participants.find(candidate => candidate.id === request.participantId)
      return participant?.role === 'worker' || /^worker-\d+$/u.test(participant?.role ?? '')
        ? await activate({
          ...request,
          agent: {
            options: request.agent.options,
            ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
          },
        })
        : await activate(request)
    })
    const start = async (index: number): Promise<TeamRun.TeamRunDefaultWorkerTask> => {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
        idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`team-run-capped-${String(index)}`),
        subject: `Capped task ${String(index)}`,
        instructions: 'Complete the independent task and report the result.',
        readScopes: [],
        writeScopes: [],
      }))
    }
    const first = await start(1)
    const second = await start(2)
    await vi.waitFor(async () => {
      const state = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(state.team.phase).toBe('active')
      expect(state.tasks.find(task => task.id === first.id)).toMatchObject({ phase: 'running' })
      expect(state.tasks.find(task => task.id === second.id)).toMatchObject({ phase: 'pending' })
    }, { timeout: 10_000 })
    const pool = await ctx.agents.withInitiator(coordinator, async () =>
      await ctx.teamRuns.setWorkerPoolSize(authority, { targetCount: 1 }))
    expect(pool).toMatchObject({
      requestedCount: 1, targetCount: 1, workerCount: 1, activeCount: 1,
      busyCount: 1, idleCount: 0, queuedTaskCount: 1, saturated: true,
    })
    const firstRunning = await ctx.teams.getTask({ teamId: run.teamId, taskId: first.id })
    await settleTaskAttemptAsOwner(ctx, firstRunning, { kind: 'completed', result: { summary: 'First task completed.' } })
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTask({ teamId: run.teamId, taskId: second.id })).resolves.toMatchObject({ phase: 'running' })
    }, { timeout: 10_000 })
    const secondRunning = await ctx.teams.getTask({ teamId: run.teamId, taskId: second.id })
    await settleTaskAttemptAsOwner(ctx, secondRunning, { kind: 'completed', result: { summary: 'Second task completed.' } })
    adapter.releaseCoordinator.resolve(undefined)
    await ctx.teamRuns.cancel(run.teamId)
  }, 30_000)

  it.each(['failed', 'released'] as const)('returns a durable %s attempt from a default-worker task wait', async (outcomeKind) => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setupTaskRun(adapter, { workerTaskMaxAttempts: 1 })
    const run = await ctx.teamRuns.create({ objective: 'Report a failed worker attempt.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined || run.worker === undefined) throw new Error('Team run has no coordinator or worker')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => request.participantId === run.worker?.id
      ? await activate({ ...request, agent: { options: request.agent.options,
        ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd } } })
      : await activate(request))
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Start the worker task.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const created = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
        idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('failed-default-worker-task'),
        subject: 'Fail one attempt', instructions: 'Report the failure.', readScopes: [], writeScopes: [],
      }))
      let running: TeamTaskSnapshot = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
      await vi.waitFor(async () => {
        running = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
        expect(running.phase).toBe('running')
      }, { timeout: 5000 })
      const failure = { code: 'WORKER_TEST_FAILED', message: 'The worker could not finish.' }
      const outcome: TeamTaskAttemptSettleInput['outcome'] = outcomeKind === 'failed'
        ? { kind: 'failed', failure }
        : { kind: 'released' }
      const failed = await settleTaskAttemptAsOwner(ctx, running, outcome)
      expect(failed.phase).toBe('failed')
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForDefaultWorkerTask(authority, {
        taskId: created.id,
      }))).resolves.toMatchObject({ id: created.id, phase: 'failed', outcome })
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  }, 15_000)

  it('contains an automatic worker-pool read failure after task settlement and accepts a later pool request', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setupTaskRun(adapter, { workerCount: 1, maxWorkerCount: 1 })
    const run = await ctx.teamRuns.create({ objective: 'Recover after automatic pool reconciliation fails.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined || run.worker === undefined) throw new Error('Team run has no coordinator or worker')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => request.participantId === run.worker?.id
      ? await activate({ ...request, agent: { options: request.agent.options,
        ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd } } })
      : await activate(request))
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Settle one worker task.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const created = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
        idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('pool-observer-read-failure'),
        subject: 'Complete one task', instructions: 'Produce a result.', readScopes: [], writeScopes: [],
      }))
      let running: TeamTaskSnapshot = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
      await vi.waitFor(async () => {
        running = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
        expect(running.phase).toBe('running')
      }, { timeout: 5000 })
      const getTeam = ctx.teams.getTeam.bind(ctx.teams)
      const readFailure = new Error('Team projection temporarily unavailable during pool reconciliation')
      let failObserverRead = false
      const observe = ctx.on('team/changed', (event) => {
        if (event.type === 'task/changed' && event.task.id === created.id && event.task.phase === 'completed') {
          failObserverRead = true
        }
      })
      const serviceContext = (ctx.teamRuns as unknown as { readonly ctx: Context }).ctx
      const warning = vi.spyOn(serviceContext.logger, 'warn').mockImplementation(() => {})
      const read = vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
        if (failObserverRead && request.teamId === run.teamId) {
          failObserverRead = false
          throw readFailure
        }
        return await getTeam(request)
      })
      const settled = await settleTaskAttemptAsOwner(ctx, running, {
        kind: 'completed', result: { summary: 'Worker task completed.' },
      })
      expect(settled.phase).toBe('completed')
      await vi.waitFor(() => {
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('automatic worker-pool reconciliation failed'))
      })
      expect(failObserverRead).toBe(false)
      observe()
      warning.mockRestore()
      read.mockRestore()
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.setWorkerPoolSize(authority, {
        targetCount: 1,
      }))).resolves.toMatchObject({ workerCount: 1, activeCount: 1 })
    } finally {
      adapter.releaseCoordinator.resolve(undefined)
      await ctx.teamRuns.cancel(run.teamId)
    }
  }, 15_000)

  it('returns a durable deleted task from a default-worker task wait', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerPreset: 'worker' }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Observe a deleted pending worker task.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined || run.worker === undefined) throw new Error('Team run has no coordinator or worker')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => request.participantId === run.worker?.id
      ? await activate({ ...request, agent: { options: request.agent.options,
        ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd } } })
      : await activate(request))
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Create pending work.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const created = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
        idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('deleted-default-worker-task'),
        subject: 'Pending removable work', instructions: 'Wait for coordinator choice.', readScopes: [], writeScopes: [],
      }))
      const pending = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
      expect(pending.phase).toBe('pending')
      const issuer = ctx.teams.openActivationActorProofIssuer()
      const actor = issuer.issue(run.coordinatorLease.binding)
      try {
        await ctx.teams.deleteTask({ actor: actor.proof, teamId: run.teamId, taskId: created.id,
          expectedRevision: pending.revision })
      } finally { actor.revoke(); issuer.close() }
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForDefaultWorkerTask(authority, {
        taskId: created.id,
      }))).resolves.toMatchObject({ id: created.id, phase: 'deleted' })
    } finally { adapter.releaseCoordinator.resolve(undefined) }
  })

  it('reads and edits the Team objective through an exact coordinator authority during its human direct turn', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, {}, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Keep the original Team objective.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')

    expect(ctx.teamRuns.tryCoordinatorGoalAuthority({} as never)).toBeUndefined()
    const authority = ctx.teamRuns.tryCoordinatorGoalAuthority(coordinator)
    if (authority === undefined) throw new Error('Team-run did not mint a coordinator goal authority')
    await expect(ctx.teamRuns.readCoordinatorGoal(authority)).rejects.toMatchObject({
      code: 'TEAM_RUN_COORDINATOR_INVALID',
    })

    await ctx.teamRuns.postHumanInput({
      teamId: run.teamId,
      content: [{ type: 'text', text: 'Rename the Team objective.' }],
    })
    await adapter.coordinatorStarted.promise
    try {
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.readCoordinatorGoal(authority)))
        .resolves.toMatchObject({ objective: 'Keep the original Team objective.', revision: 1 })

      const update = vi.spyOn(ctx.teams, 'updateTeamGoal')
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.updateCoordinatorGoal(authority, {
        expectedRevision: 1,
        objective: 'Use the durable Team objective.',
      }))).resolves.toMatchObject({ objective: 'Use the durable Team objective.', revision: 2 })
      const updateRequest = update.mock.calls[0]?.[0]
      if (updateRequest === undefined) throw new Error('Team-run did not call the canonical goal update')
      const updateActor = updateRequest.actor
      expect(updateRequest).toMatchObject({
        teamId: run.teamId,
        expectedRevision: 1,
        objective: 'Use the durable Team objective.',
      })
      expect(updateRequest).not.toHaveProperty('participantId')
      expect(updateActor).not.toHaveProperty('teamId')
      expect(updateActor).not.toHaveProperty('participantId')
      expect(updateActor).not.toHaveProperty('activationId')
      expect(updateActor).not.toHaveProperty('sessionId')
      expect(() => JSON.stringify(updateActor)).toThrow(/runtime-only/u)
      expect(() => structuredClone(updateActor)).toThrow()
      await expect(ctx.teams.updateTeamGoal({
        teamId: run.teamId,
        actor: updateActor,
        expectedRevision: 2,
        objective: 'A revoked proof cannot make another update.',
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

      const transition = vi.spyOn(ctx.teams, 'transitionTeamGoalPhase')
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.transitionCoordinatorGoalPhase(authority, {
        expectedRevision: 2,
        phase: 'paused',
      }))).resolves.toMatchObject({ phase: 'paused', revision: 3 })
      const transitionRequest = transition.mock.calls[0]?.[0]
      if (transitionRequest === undefined) throw new Error('Team-run did not call the canonical goal transition')
      expect(transitionRequest).toMatchObject({ teamId: run.teamId, expectedRevision: 2, phase: 'paused' })
      expect(transitionRequest.actor).not.toBe(updateActor)
      expect(() => JSON.stringify(transitionRequest.actor)).toThrow(/runtime-only/u)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.transitionCoordinatorGoalPhase(authority, {
        expectedRevision: 3, phase: 'blocked', blocker: { code: 'AWAIT_INPUT', message: 'Need a human decision.' },
      }))).resolves.toMatchObject({ phase: 'blocked', revision: 4,
        blocker: { code: 'AWAIT_INPUT', message: 'Need a human decision.' } })
      expect(transition.mock.calls[1]?.[0]).toMatchObject({ teamId: run.teamId, expectedRevision: 3, phase: 'blocked',
        blocker: { code: 'AWAIT_INPUT', message: 'Need a human decision.' } })
      await expect(ctx.teams.transitionTeamGoalPhase({
        teamId: run.teamId,
        actor: transitionRequest.actor,
        expectedRevision: 4,
        phase: 'active',
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

      const taskAuthority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.readCoordinatorGoal(taskAuthority as never)))
        .rejects.toMatchObject({ code: 'TEAM_RUN_COORDINATOR_INVALID' })
    } finally {
      adapter.releaseCoordinator.resolve(undefined)
    }
    await coordinator.whenIdle()
    const issuer = coordinatorActorProofIssuerInternals(ctx.teamRuns).coordinatorActorProofIssuer
    await ctx.teamRuns.close()
    if (issuer === undefined) throw new Error('Team-run did not initialize its coordinator goal-proof issuer')
    expect(() => issuer.issue(run.coordinatorLease.binding)).toThrow(expect.objectContaining({
      code: 'TEAM_ACTOR_PROOF_INVALID',
    }))
  })

  it('rejects a coordinator objective edit without an exact current human direct source', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(true, {}, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Require a human source.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    const authority = ctx.teamRuns.tryCoordinatorGoalAuthority(coordinator)
    if (authority === undefined) throw new Error('Team-run did not mint a coordinator goal authority')

    coordinator.followup(createUserMessage({
      content: [{ type: 'text', text: 'Synthetic local follow-up.' }],
      source: { kind: 'user' },
    }))
    await adapter.started.promise
    try {
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.updateCoordinatorGoal(authority, {
        expectedRevision: 1,
        objective: 'This edit must be rejected.',
      }))).rejects.toMatchObject({ code: 'TEAM_RUN_COORDINATOR_INVALID' })
      await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
        team: { goal: { objective: 'Require a human source.', revision: 1 } },
      })
    } finally {
      adapter.release.resolve(undefined)
    }
    await coordinator.whenIdle()
  })

  it('revokes an in-flight coordinator goal proof when TeamRun releases its coordinator', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, {}, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Revoke a released goal proof.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    const authority = ctx.teamRuns.tryCoordinatorGoalAuthority(coordinator)
    if (authority === undefined) throw new Error('Team-run did not mint a coordinator goal authority')
    await ctx.teamRuns.postHumanInput({
      teamId: run.teamId,
      content: [{ type: 'text', text: 'Begin a release-race goal update.' }],
    })
    await adapter.coordinatorStarted.promise
    const updateTeamGoal = ctx.teams.updateTeamGoal.bind(ctx.teams)
    const admitted = Promise.withResolvers<undefined>()
    const continueUpdate = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.teams, 'updateTeamGoal').mockImplementation(async (request) => {
      admitted.resolve(undefined)
      await continueUpdate.promise
      return await updateTeamGoal(request)
    })
    const update = ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.updateCoordinatorGoal(authority, {
      expectedRevision: 1,
      objective: 'This released proof must not commit.',
    }))
    await admitted.promise
    adapter.releaseCoordinator.resolve(undefined)
    await coordinator.whenIdle()
    await ctx.teamRuns.close()
    continueUpdate.resolve(undefined)
    await expect(update).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
      team: { goal: { objective: 'Revoke a released goal proof.', revision: 1 } },
    })
  })

  it('revokes an in-flight default-worker task-control proof when cancellation releases its coordinator', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerPreset: 'worker' }, adapter, true)
    const run = await ctx.teamRuns.create({ objective: 'Revoke a released task-control proof.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      if (request.participantId !== run.worker!.id) return await activate(request)
      return await activate({
        ...request,
        agent: {
          options: request.agent.options,
          ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
        },
      })
    })
    await ctx.teamRuns.postHumanInput({
      teamId: run.teamId,
      content: [{ type: 'text', text: 'Begin a release-race owner proposal.' }],
    })
    await adapter.coordinatorStarted.promise
    const task = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('team-run-revoked-task-control-proof'),
      subject: 'Pending task control',
      instructions: 'Remain pending while cancellation releases the coordinator.',
      readScopes: [],
      writeScopes: [],
    }))
    const proposeTaskOwner = ctx.teams.proposeTaskOwner.bind(ctx.teams)
    const admitted = Promise.withResolvers<undefined>()
    const continueProposal = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.teams, 'proposeTaskOwner').mockImplementation(async (request) => {
      admitted.resolve(undefined)
      await continueProposal.promise
      return await proposeTaskOwner(request)
    })
    const proposal = ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.proposeDefaultWorkerTaskOwner(authority, {
      taskId: task.id,
      proposedOwnerId: run.coordinator.id,
    }))
    await admitted.promise
    expect(taskControlProofInternals(ctx.teamRuns).taskControlProofs.size).toBe(1)
    adapter.releaseCoordinator.resolve(undefined)
    await coordinator.whenIdle()
    await ctx.teamRuns.cancel(run.teamId)
    expect(taskControlProofInternals(ctx.teamRuns).taskControlProofs.size).toBe(0)
    continueProposal.resolve(undefined)
    await expect(proposal).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.getTask({ teamId: run.teamId, taskId: task.id })).resolves.toMatchObject({ phase: 'cancelled' })
  })

  it('rejects forged or borrowed coordinator authority and aborts only its local task wait', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(true, { workerPreset: 'worker' }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Keep a worker task pending.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      if (request.participantId !== run.worker!.id) return await activate(request)
      return await activate({
        ...request,
        agent: {
          options: request.agent.options,
          ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
        },
      })
    })
    expect(() => ctx.teamRuns.coordinatorTaskAuthority({} as never)).toThrow(expect.objectContaining({
      code: 'TEAM_RUN_COORDINATOR_INVALID',
    }))
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const request = {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('team-run-local-wait'),
      subject: 'Await only this task',
      instructions: 'Remain pending while the coordinator tests its local wait.',
      readScopes: [],
      writeScopes: [],
    }
    coordinator.followup(createUserMessage({
      content: [{ type: 'text', text: 'Begin a task wait.' }],
      source: { kind: 'user' },
    }))
    await adapter.started.promise
    try {
      await expect(ctx.teamRuns.startDefaultWorkerTask(authority, request)).rejects.toMatchObject({
        code: 'TEAM_RUN_COORDINATOR_INVALID',
      })
      const created = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, request))
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForDefaultWorkerTask(authority, {
        taskId: 'other-default-worker-task' as TeamTaskId,
      }))).rejects.toMatchObject({ code: 'TEAM_RUN_COORDINATOR_INVALID' })

      const controller = new AbortController()
      const watch = vi.spyOn(ctx.teams, 'watchTeam')
      const waiting = ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForDefaultWorkerTask(authority, {
        taskId: created.id,
        signal: controller.signal,
      }))
      await vi.waitFor(() => { expect(watch).toHaveBeenCalledOnce() })
      controller.abort(new Error('caller stopped waiting'))
      await expect(waiting).rejects.toThrow('caller stopped waiting')
      await expect(ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })).resolves.toMatchObject({ phase: 'pending' })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.listDefaultWorkerTasks(authority)))
        .resolves.toEqual({ tasks: [{ ...noReview, id: created.id, phase: 'pending' }] })
      const current = await ctx.teams.getTeam({ teamId: run.teamId })
      watch.mockResolvedValueOnce({ kind: 'changed', cursor: current.team.cursor })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForDefaultWorkerTask(authority, {
        taskId: created.id,
      }))).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_QUIESCENT' })
      watch.mockResolvedValueOnce({ kind: 'closed' })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForDefaultWorkerTask(authority, {
        taskId: created.id,
      }))).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_QUIESCENT' })
      watch.mockResolvedValueOnce({ kind: 'changed', cursor: current.team.cursor })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.watchDefaultWorkerTasks(authority, {
        afterCursor: current.team.cursor,
      }))).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_QUIESCENT' })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.watchDefaultWorkerTasks(authority, {
        afterCursor: current.team.cursor - 1,
      }))).resolves.toEqual({ cursor: current.team.cursor, tasks: [{ ...noReview, id: created.id, phase: 'pending' }] })
      watch.mockResolvedValueOnce({ kind: 'closed' })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.watchDefaultWorkerTasks(authority, {
        afterCursor: current.team.cursor,
      }))).resolves.toEqual({ cursor: current.team.cursor, tasks: [{ ...noReview, id: created.id, phase: 'pending' }] })
      const taskControl = taskControlProofInternals(ctx.teamRuns)
      const proposeTaskOwner = ctx.teams.proposeTaskOwner.bind(ctx.teams)
      let proposalRequest: Parameters<typeof ctx.teams.proposeTaskOwner>[0] | undefined
      const proposalSpy = vi.spyOn(ctx.teams, 'proposeTaskOwner').mockImplementation(async (input) => {
        proposalRequest = input
        const record = taskControl.taskControlProofs.get(input.actor)
        expect(record?.scope).toEqual({
          kind: 'team-run-default-worker-owner-proposal',
          teamId: run.teamId,
          coordinator: {
            teamId: run.teamId,
            participantId: run.coordinator.id,
            activationId: run.coordinatorLease.binding.activation.id,
            sessionId: run.coordinatorLease.binding.sessionId,
            provider: run.coordinatorLease.binding.provider,
          },
          taskId: created.id,
          expectedRevision: input.expectedRevision,
          proposedOwnerId: run.coordinator.id,
        })
        return await proposeTaskOwner(input)
      })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.proposeDefaultWorkerTaskOwner(authority, {
        taskId: created.id,
        proposedOwnerId: run.coordinator.id,
      }))).resolves.toEqual({ id: created.id, phase: 'pending', proposedOwnerId: run.coordinator.id })
      proposalSpy.mockRestore()
      expect(taskControl.taskControlProofs.size).toBe(0)
      const proposal = proposalRequest
      if (proposal === undefined) throw new Error('Team-run did not submit an owner-proposal proof')
      expect(() => JSON.stringify(proposal.actor)).toThrow(/runtime-only/u)
      await expect(ctx.teams.proposeTaskOwner(proposal)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

      const cancelTask = ctx.teams.cancelTask.bind(ctx.teams)
      let cancelRequest: Parameters<typeof ctx.teams.cancelTask>[0] | undefined
      const cancelSpy = vi.spyOn(ctx.teams, 'cancelTask').mockImplementation(async (input) => {
        cancelRequest = input
        if (input.actor === undefined) throw new Error('Team-run did not submit a cancellation proof')
        const record = taskControl.taskControlProofs.get(input.actor as TeamSystemTaskControlProof)
        expect(record?.scope).toEqual({
          kind: 'team-run-default-worker-cancel',
          teamId: run.teamId,
          coordinator: {
            teamId: run.teamId,
            participantId: run.coordinator.id,
            activationId: run.coordinatorLease.binding.activation.id,
            sessionId: run.coordinatorLease.binding.sessionId,
            provider: run.coordinatorLease.binding.provider,
          },
          taskId: created.id,
          expectedRevision: input.expectedRevision,
          reason: 'The coordinator no longer needs this task.',
        })
        return await cancelTask(input)
      })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelDefaultWorkerTask(authority, {
        taskId: created.id,
        reason: 'The coordinator no longer needs this task.',
      }))).resolves.toMatchObject({
        ...noReview, id: created.id, phase: 'cancelled', cancellation: { attemptId: null, expired: false },
      })
      cancelSpy.mockRestore()
      expect(taskControl.taskControlProofs.size).toBe(0)
      const cancellation = cancelRequest
      if (cancellation === undefined || cancellation.actor === undefined) {
        throw new Error('Team-run did not retain a cancellation proof request')
      }
      expect(() => JSON.stringify(cancellation.actor)).toThrow(/runtime-only/u)
      await expect(ctx.teams.cancelTask(cancellation)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelDefaultWorkerTask(authority, {
        taskId: created.id,
      }))).resolves.toMatchObject({ id: created.id, phase: 'cancelled' })
    } finally {
      adapter.release.resolve(undefined)
    }
  })

  it('fences an in-flight worker topology operation before it can issue a proof after release begins', async () => {
    const ctx = await setup(true, { workerPreset: 'worker' })
    const run = await ctx.teamRuns.create({ objective: 'Fence released topology authority.', cwd: process.cwd() })
    const state = ownedRuns(ctx.teamRuns).get(run.teamId)
    if (state === undefined) throw new Error('created Team run was not retained')
    const internals = topologyReleaseInternals(ctx.teamRuns)
    const getTeam = ctx.teams.getTeam.bind(ctx.teams)
    const transition = vi.spyOn(ctx.teams, 'transitionParticipantPhase')
    const reachedWorkerRead = Promise.withResolvers<undefined>()
    const continueWorker = Promise.withResolvers<undefined>()
    let pauseWorkerRead = true
    vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
      const current = await getTeam(request)
      if (pauseWorkerRead && request.teamId === run.teamId) {
        pauseWorkerRead = false
        reachedWorkerRead.resolve(undefined)
        await continueWorker.promise
      }
      return current
    })
    const activation = internals.activateWorker(state, run.worker!.id, undefined)
    await reachedWorkerRead.promise
    try {
      await internals.releaseRun(state)
    } finally {
      continueWorker.resolve(undefined)
    }
    await expect(activation).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_QUIESCENT' })
    expect(transition).not.toHaveBeenCalled()
    const afterRelease = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(afterRelease.participants.find(participant => participant.id === run.worker!.id))
      .toMatchObject({ phase: 'provisioning' })
    ownedRuns(ctx.teamRuns).delete(run.teamId)
  })

  it('provisions a reviewer and freezes participant review for mutating worker tasks', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerPreset: 'worker', reviewerPreset: 'worker' }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Review a mutation.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Prepare a reviewed task.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async request => await activate({
      ...request,
      // This fixture does not mount the preset registry; preserve the
      // reviewer route while exercising the same activation transaction.
      agent: {
        options: request.agent.options,
        ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
      },
    }))
    const topology = topologyProofInternals(ctx.teamRuns)
    const inviteParticipant = ctx.teams.inviteParticipant.bind(ctx.teams)
    const transitionParticipantPhase = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
    const reviewerScopes: TeamSystemTopologyScope[] = []
    const captureReviewerScope = (actor: TeamSystemTopologyProof): void => {
      const scope = topology.topologyProofs.get(actor)?.scope
      if (scope?.kind === 'team-run-reviewer-invite' || scope?.kind === 'team-run-reviewer-phase') reviewerScopes.push(scope)
    }
    vi.spyOn(ctx.teams, 'inviteParticipant').mockImplementation(async (request) => {
      captureReviewerScope(request.actor as TeamSystemTopologyProof)
      return await inviteParticipant(request)
    })
    vi.spyOn(ctx.teams, 'transitionParticipantPhase').mockImplementation(async (request) => {
      captureReviewerScope(request.actor as TeamSystemTopologyProof)
      return await transitionParticipantPhase(request)
    })
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const task = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('team-run-reviewer-task'),
      subject: 'Mutating task',
      instructions: 'Change the requested files and report the result.',
      readScopes: ['packages/team'],
      writeScopes: ['packages/team'],
    }))
    const state = await ctx.teams.getTeam({ teamId: run.teamId })
    const reviewer = state.participants.find(participant => participant.role === 'reviewer')
    expect(reviewer).toMatchObject({ phase: 'active', capabilities: ['team-default-reviewer'] })
    if (reviewer === undefined) throw new Error('reviewer participant was not provisioned')
    expect(task).toMatchObject({ reviewPolicy: { kind: 'participant', reviewerId: reviewer.id }, reviewResult: null })
    expect(reviewerScopes.map(scope => scope.kind)).toEqual([
      'team-run-reviewer-invite',
      'team-run-reviewer-phase',
      'team-run-reviewer-phase',
    ])
    const reviewerInviteScope = reviewerScopes[0]
    const reviewerProvisioningScope = reviewerScopes[1]
    const reviewerActiveScope = reviewerScopes[2]
    if (reviewerInviteScope?.kind !== 'team-run-reviewer-invite'
      || reviewerProvisioningScope?.kind !== 'team-run-reviewer-phase'
      || reviewerActiveScope?.kind !== 'team-run-reviewer-phase') {
      throw new Error('Team-run did not retain the reviewer topology scopes')
    }
    expect(reviewerInviteScope.expectedCursor).toBeTypeOf('number')
    expect(reviewerProvisioningScope.expectedCursor).toBeTypeOf('number')
    expect(reviewerActiveScope.expectedCursor).toBeTypeOf('number')
    expect(reviewerInviteScope).toMatchObject({
      kind: 'team-run-reviewer-invite',
      teamId: run.teamId,
      participant: {
        kind: 'local-agent',
        displayName: 'reviewer',
        role: 'reviewer',
        capabilities: ['team-default-reviewer'],
        preset: 'worker',
      },
    })
    expect(reviewerProvisioningScope).toMatchObject({
      kind: 'team-run-reviewer-phase',
      teamId: run.teamId,
      participantId: reviewer.id,
      expectedPhase: 'invited',
      phase: 'provisioning',
    })
    expect(reviewerActiveScope).toMatchObject({
      kind: 'team-run-reviewer-phase',
      teamId: run.teamId,
      participantId: reviewer.id,
      expectedPhase: 'provisioning',
      phase: 'active',
    })
    await expect(ctx.teams.getTask({ teamId: run.teamId, taskId: task.id })).resolves.toMatchObject({
      reviewPolicy: { kind: 'participant', reviewerId: reviewer.id },
    })
    adapter.releaseCoordinator.resolve(undefined)
  })

  it.each([false, true] as const)(
    'rejects a reviewer lease without a local Agent when its cleanup fails: %s', async (cleanupFails) => {
      const adapter = new CoordinatorGateWorkerReplyAdapter()
      const ctx = await setup(true, { workerPreset: 'worker', reviewerPreset: 'worker' }, adapter)
      const run = await ctx.teamRuns.create({ objective: 'Require a local reviewer Agent.', cwd: process.cwd() })
      const coordinator = run.coordinatorLease.localAgent
      if (coordinator === undefined) throw new Error('Team run has no coordinator')
      coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Create reviewed work.' }], source: { kind: 'user' } }))
      await adapter.coordinatorStarted.promise
      const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
      let omitReviewerAgent = true
      const cleanupFailure = new Error('reviewer lease cleanup failed')
      vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
        const state = await ctx.teams.getTeam({ teamId: request.teamId })
        const participant = state.participants.find(candidate => candidate.id === request.participantId)
        const { preset: _preset, ...agent } = request.agent
        const lease = await activate({ ...request, agent })
        if (participant?.role === 'reviewer' && omitReviewerAgent) {
          const withoutAgent = leaseWithoutLocalAgent(lease)
          return cleanupFails
            ? { ...withoutAgent, dispose: async () => { await withoutAgent.dispose(); throw cleanupFailure } }
            : withoutAgent
        }
        return lease
      })
      try {
        const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
        const request = { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('reviewer-without-local-agent'),
          subject: 'Review a change', instructions: 'Change the requested files.',
          readScopes: ['packages/team'], writeScopes: ['packages/team'] }
        await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, request)))
          .rejects.toThrow('reviewer activation did not publish a local Agent')
        const afterFailure = await ctx.teams.getTeam({ teamId: run.teamId })
        const reviewer = afterFailure.participants.find(participant => participant.role === 'reviewer')
        if (reviewer === undefined) throw new Error('Reviewer was not retained')
        expect(afterFailure.tasks).toEqual([])
        expect(afterFailure.activations.filter(binding => binding.activation.participantId === reviewer.id))
          .toMatchObject([{ activation: { status: 'offline' } }])
        omitReviewerAgent = false
        const created = await ctx.agents.withInitiator(coordinator,
          async () => await ctx.teamRuns.startDefaultWorkerTask(authority, request))
        expect(created.reviewPolicy).toMatchObject({ kind: 'participant', reviewerId: reviewer.id })
        const afterRetry = await ctx.teams.getTeam({ teamId: run.teamId })
        expect(afterRetry.participants.filter(participant => participant.role === 'reviewer')).toHaveLength(1)
        expect(afterRetry.activations.filter(binding => binding.activation.participantId === reviewer.id)).toHaveLength(2)
      } finally { adapter.releaseCoordinator.resolve(undefined) }
    })

  it.each([false, true] as const)(
    'releases a reviewer after prompt failure (cleanup fails: %s)', async (cleanupFails) => {
      const adapter = new CoordinatorGateWorkerReplyAdapter()
      const ctx = await setup(true, { workerPreset: 'worker', reviewerPreset: 'worker' }, adapter)
      const run = await ctx.teamRuns.create({ objective: 'Recover reviewer prompt setup.', cwd: process.cwd() })
      const coordinator = run.coordinatorLease.localAgent
      if (coordinator === undefined) throw new Error('Team run has no coordinator')
      coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Create reviewed work.' }], source: { kind: 'user' } }))
      await adapter.coordinatorStarted.promise
      const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
      const cleanupFailure = new Error('reviewer cleanup unavailable')
      let failCleanupOnce = cleanupFails
      vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
        const state = await ctx.teams.getTeam({ teamId: request.teamId })
        const participant = state.participants.find(candidate => candidate.id === request.participantId)
        const { preset: _preset, ...agent } = request.agent
        const lease = await activate({ ...request, agent })
        if (participant?.role !== 'reviewer' || !failCleanupOnce) return lease
        failCleanupOnce = false
        return { binding: lease.binding, localAgent: lease.localAgent,
          health: () => lease.health(), interrupt: (...args) => { lease.interrupt(...args) },
          dispose: async () => { await lease.dispose(); throw cleanupFailure },
        }
      })
      const section = ctx.systemPrompt.section.bind(ctx.systemPrompt)
      const failure = new Error('reviewer prompt unavailable')
      const prompt = vi.spyOn(ctx.systemPrompt, 'section').mockImplementation((request) => {
        if (request.name === 'team-run:reviewer-task') throw failure
        return section(request)
      })
      try {
        const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
        const request = { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('reviewer-prompt-retry'),
          subject: 'Review a change', instructions: 'Make the requested edit.',
          readScopes: ['packages/team'], writeScopes: ['packages/team'] }
        const rejected: unknown = await ctx.agents.withInitiator(coordinator,
          async () => await ctx.teamRuns.startDefaultWorkerTask(authority, request))
          .then(() => undefined, (error: unknown) => error)
        if (cleanupFails) expect(rejected).toMatchObject({ errors: [failure, cleanupFailure] })
        else expect(rejected).toBe(failure)
        const afterFailure = await ctx.teams.getTeam({ teamId: run.teamId })
        const reviewer = afterFailure.participants.find(participant => participant.role === 'reviewer')
        if (reviewer === undefined) throw new Error('Reviewer was not retained')
        expect(afterFailure.tasks).toEqual([])
        const prior = afterFailure.activations.find(binding => binding.activation.participantId === reviewer.id)
        expect(prior?.activation.status).toBe('offline')
        prompt.mockRestore()
        const created = await ctx.agents.withInitiator(coordinator,
          async () => await ctx.teamRuns.startDefaultWorkerTask(authority, request))
        expect(created.reviewPolicy).toMatchObject({ kind: 'participant', reviewerId: reviewer.id })
        const epochs = (await ctx.teams.getTeam({ teamId: run.teamId })).activations.filter(binding =>
          binding.activation.participantId === reviewer.id)
        expect(epochs).toHaveLength(2)
        expect(epochs[1]?.sessionId).toBe(prior?.sessionId)
      } finally {
        prompt.mockRestore()
        adapter.releaseCoordinator.resolve(undefined)
        await ctx.teamRuns.cancel(run.teamId)
      }
    })

  it.each(['stopped-accepted', 'stopped-rework', 'errored'] as const)(
    'reports a %s reviewer turn without a task decision', async (reviewerOutcome) => {
      const adapter = new FirstCoordinatorTurnGateAdapter(reviewerOutcome === 'errored' ? 'errored' : 'stopped')
      const ctx = await setupTaskRun(adapter, { workerPreset: 'worker', reviewerPreset: 'worker',
        ...reviewerOutcome === 'stopped-rework' ? { workerTaskMaxAttempts: 1 } : {} })
      const basic = await import('@clocky/clocky-team-channel-basic')
      await ctx.plugin(basic)
      const run = await ctx.teamRuns.create({ objective: 'Detect an undecided review.', cwd: process.cwd() })
      const coordinator = run.coordinatorLease.localAgent
      if (coordinator === undefined || run.worker === undefined) throw new Error('Team run has no local coordinator or worker')
      const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
      vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
        const { preset: _preset, ...agent } = request.agent
        return await activate({ ...request, agent })
      })
      coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Start reviewed work.' }], source: { kind: 'user' } }))
      await adapter.coordinatorStarted.promise
      try {
        const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
        const created = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
          idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('undecided-review-task'),
          subject: 'Review a change', instructions: 'Make a change and request review.',
          readScopes: ['packages/team'], writeScopes: ['packages/team'],
        }))
        let task: TeamTaskSnapshot = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
        await vi.waitFor(async () => {
          task = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
          expect(task.phase).toBe('running')
        }, { timeout: 5000 })
        const reviewing = await settleTaskAttemptAsOwner(ctx, task, {
          kind: 'completed', result: { summary: 'Change ready for review.' },
        })
        expect(reviewing.phase).toBe('review')
        const reviewerId = reviewing.reviewPolicy.kind === 'participant' ? reviewing.reviewPolicy.reviewerId : undefined
        if (reviewerId === undefined) throw new Error('Reviewed task has no reviewer')
        await vi.waitFor(async () => {
          const state = await ctx.teams.getTeam({ teamId: run.teamId })
          const binding = state.activations.findLast(candidate => candidate.activation.participantId === reviewerId)
          const reviewer = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
          expect(reviewer?.session.events.some(event => event.type === 'turn/end')).toBe(true)
        }, { timeout: 5000 })
        const failure: unknown = await ctx.agents.withInitiator(coordinator, async () =>
          await ctx.teamRuns.waitForDefaultWorkerTask(authority, { taskId: created.id }))
          .then(() => undefined, (error: unknown) => error)
        expect(failure).toMatchObject({ code: 'TEAM_RUN_REVIEW_FAILED' })
        if (reviewerOutcome === 'errored') {
          if (!(failure instanceof Error)) throw new Error('Review failure did not retain an Error')
          expect(failure.message).toContain('review model unavailable')
        }
        expect((await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })).phase).toBe('review')
        if (reviewerOutcome !== 'errored') {
          const decision = reviewerOutcome === 'stopped-rework' ? 'rework' : 'accepted'
          const phase = decision === 'accepted' ? 'completed' : 'pending'
          await respondToTaskReview(ctx, reviewing, decision)
          await vi.waitFor(async () => {
            expect((await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })).phase).toBe(phase)
          }, { timeout: 5000 })
          if (decision === 'accepted') {
            await expect(ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.waitForDefaultWorkerTask(authority, {
              taskId: created.id,
            }))).resolves.toMatchObject({ phase, reviewResult: { decision } })
          } else {
            const listed = await ctx.agents.withInitiator(coordinator,
              async () => await ctx.teamRuns.listDefaultWorkerTasks(authority))
            expect(listed.tasks.find(task => task.id === created.id))
              .toMatchObject({ phase, reviewResult: { decision } })
          }
        }
      } finally { adapter.releaseCoordinator.resolve(undefined) }
    }, 15_000)

  it.each([false, true] as const)(
    'defers reworked task cleanup until its prior attempt workspace is physically released (release after intent: %s)', async (releaseAfterIntent) => {
      const adapter = new FirstCoordinatorTurnGateAdapter()
      const ctx = await setupTaskRun(adapter, { workerPreset: 'worker', reviewerPreset: 'worker', workerTaskMaxAttempts: 1 }, !releaseAfterIntent)
      const basic = await import('@clocky/clocky-team-channel-basic')
      await ctx.plugin(basic)
      const run = await ctx.teamRuns.create({ objective: 'Cancel rework with a retained workspace.', cwd: process.cwd() })
      const coordinator = run.coordinatorLease.localAgent
      if (coordinator === undefined) throw new Error('Team run has no coordinator')
      const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
      vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
        const { preset: _preset, ...agent } = request.agent
        return await activate({ ...request, agent })
      })
      coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Start the reviewed work.' }], source: { kind: 'user' } }))
      await adapter.coordinatorStarted.promise
      const scopes = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()
      const unregister = ctx.teams.registerSystemWorkspaceAllocationProofSource({
        name: 'team-run-review-workspace', resolveWorkspaceAllocationProof: proof => scopes.get(proof),
      })
      const issue = (scope: TeamSystemWorkspaceAllocationScope): TeamSystemWorkspaceAllocationProof => {
        const proof = Object.freeze({}) as TeamSystemWorkspaceAllocationProof
        scopes.set(proof, scope)
        return proof
      }
      try {
        const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
        const created = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
          idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('rework-retained-workspace'),
          subject: 'Review this attempt', instructions: 'Prepare a result for review.',
          readScopes: ['packages/team'], writeScopes: ['packages/team'],
        }))
        let running: TeamTaskSnapshot = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
        await vi.waitFor(async () => {
          running = await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })
          expect(running.phase).toBe('running')
        }, { timeout: 5000 })
        const lease = running.lease
        if (lease?.activationId === undefined) throw new Error('Running attempt has no activation-bound lease')
        const binding = await ctx.teams.getActivation({ teamId: run.teamId, activationId: lease.activationId })
        const current = await ctx.teams.getTeam({ teamId: run.teamId })
        const reserve = teamWorkspaceAllocationReserveInputSchema.parse({
          teamId: run.teamId, expectedCursor: current.team.cursor, taskId: running.id,
          expectedTaskRevision: running.revision, attemptId: lease.attemptId,
          allocation: { id: teamWorkspaceAllocationIdSchema.parse('rework-retained-allocation'),
            provider: 'team-run-review-workspace', mode: 'shared', assignedRevision: lease.assignedRevision,
            participantId: lease.participantId, activationId: lease.activationId, sessionId: binding.sessionId },
        })
        const reserved = await ctx.teams.reserveWorkspaceAllocation({ actor: issue({ kind: 'workspace-allocation-reserve', ...reserve }), ...reserve })
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const afterReserve = await ctx.teams.getTeam({ teamId: run.teamId })
          const allocation = afterReserve.workspaceAllocations.find(item => item.id === reserved.id)
          if (allocation === undefined) throw new Error('Reserved workspace allocation disappeared')
          const preserve = teamWorkspaceAllocationPreserveInputSchema.parse({
            teamId: run.teamId, allocationId: reserved.id, expectedCursor: afterReserve.team.cursor,
            expectedRevision: allocation.revision,
            reason: { code: 'PROVIDER_UNAVAILABLE', message: 'The prior attempt workspace awaits physical cleanup.' },
          })
          try {
            await ctx.teams.preserveWorkspaceAllocation({ actor: issue({ kind: 'workspace-allocation-preserve', ...preserve }), ...preserve })
            break
          } catch (error: unknown) {
            if (!(error instanceof TeamError) || error.code !== 'TEAM_CURSOR_CONFLICT' || attempt === 19) throw error
          }
        }
        const reviewing = await settleTaskAttemptAsOwner(ctx, running, {
          kind: 'completed', result: { summary: 'The first attempt needs rework.' },
        })
        expect(reviewing.phase).toBe('review')
        await vi.waitFor(async () => { await respondToTaskReview(ctx, reviewing, 'rework') }, { timeout: 5000 })
        await vi.waitFor(async () => {
          expect((await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })).phase).toBe('pending')
        }, { timeout: 5000 })
        const requested = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelDefaultWorkerTask(authority, {
          taskId: created.id,
        }))
        expect(requested.phase).toBe('pending')
        expect((await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })).cancellation).toBeDefined()
        const cleanup = vi.spyOn(ctx.teams, 'cancelTeamCancellationTask')
        const releaseAllocation = async (): Promise<void> => {
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const beforeRequest = await ctx.teams.getTeam({ teamId: run.teamId })
            const allocation = beforeRequest.workspaceAllocations.find(item => item.id === reserved.id)
            if (allocation === undefined) throw new Error('Retained workspace allocation disappeared')
            if (allocation.lifecycle === 'released') return
            try {
              if (allocation.lifecycle !== 'release-requested') {
                const releaseRequest = teamWorkspaceAllocationReleaseRequestInputSchema.parse({
                  teamId: run.teamId, allocationId: allocation.id, expectedCursor: beforeRequest.team.cursor,
                  expectedRevision: allocation.revision,
                })
                await ctx.teams.requestWorkspaceAllocationRelease({
                  actor: issue({ kind: 'workspace-allocation-release-request', ...releaseRequest }), ...releaseRequest,
                })
              }
              const beforeRelease = await ctx.teams.getTeam({ teamId: run.teamId })
              const releasing = beforeRelease.workspaceAllocations.find(item => item.id === reserved.id)
              if (releasing === undefined) throw new Error('Release-requested allocation disappeared')
              const release = teamWorkspaceAllocationReleaseInputSchema.parse({ teamId: run.teamId,
                allocationId: releasing.id, expectedCursor: beforeRelease.team.cursor, expectedRevision: releasing.revision })
              await ctx.teams.confirmWorkspaceAllocationRelease({ actor: issue({ kind: 'workspace-allocation-release', ...release }), ...release })
              return
            } catch (error: unknown) {
              if (!(error instanceof TeamError) || error.code !== 'TEAM_CURSOR_CONFLICT' || attempt === 19) throw error
            }
          }
        }
        if (releaseAfterIntent) {
          const cancelTeam = ctx.teams.cancelTeam.bind(ctx.teams)
          let released = false
          vi.spyOn(ctx.teams, 'cancelTeam').mockImplementation(async (request) => {
            try {
              const result = await cancelTeam(request)
              if (!released && result.team.cancellation !== undefined) {
                released = true
                await releaseAllocation()
              }
              return result
            } catch (error: unknown) {
              const current = await ctx.teams.getTeam({ teamId: run.teamId })
              if (!released && current.team.cancellation !== undefined) {
                released = true
                await releaseAllocation()
              }
              throw error
            }
          })
        }
        adapter.releaseCoordinator.resolve(undefined)
        await coordinator.whenIdle()
        expect((await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })).phase).toBe('pending')
        const failure: unknown = await ctx.teamRuns.cancel(run.teamId).then(() => undefined, (error: unknown) => error)
        if (releaseAfterIntent) {
          expect(cleanup).toHaveBeenCalledWith(expect.objectContaining({ teamId: run.teamId, taskId: created.id }))
          expect((await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })).phase).toBe('cancelled')
          expect((await ctx.teams.getTeam({ teamId: run.teamId })).team.phase).toBe('cancelled')
          expect(failure).toBeUndefined()
        } else {
          expect(failure).toBeInstanceOf(Error)
          expect(cleanup).not.toHaveBeenCalled()
          expect((await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })).phase).toBe('pending')
          await releaseAllocation()
          await ctx.teamRuns.cancel(run.teamId)
        }
        expect((await ctx.teams.getTask({ teamId: run.teamId, taskId: created.id })).phase).toBe('cancelled')
        expect((await ctx.teams.getTeam({ teamId: run.teamId })).team.phase).toBe('cancelled')
      } finally {
        unregister()
        adapter.releaseCoordinator.resolve(undefined)
      }
    }, 15_000)

  it('gives task creation its own cursor retries after participant preparation succeeds', async () => {
    const adapter = new CoordinatorGateWorkerReplyAdapter()
    const ctx = await setup(true, { workerPreset: 'worker', reviewerPreset: 'worker', receiptRetryAttempts: 3 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Create work after concurrent participant preparation.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Team-run did not publish a local coordinator')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Prepare reviewed work.' }], source: { kind: 'user' } }))
    await adapter.coordinatorStarted.promise
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    let preparationConflicts = 0
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      if (preparationConflicts < 2) {
        preparationConflicts += 1
        throw new TeamError('Concurrent participant preparation.', 'TEAM_CURSOR_CONFLICT')
      }
      return await activate({ ...request, agent: {
        options: request.agent.options,
        ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
      } })
    })
    const create = ctx.teams.createTask.bind(ctx.teams)
    const creates = vi.spyOn(ctx.teams, 'createTask')
      .mockRejectedValueOnce(new TeamError('Concurrent task admission.', 'TEAM_CURSOR_CONFLICT'))
      .mockImplementation(create)
    try {
      const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
      const task = await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
        idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('separate-admission-retries'),
        subject: 'Reviewed work', instructions: 'Review the requested change.', readScopes: ['packages/team'], writeScopes: ['packages/team'],
      }))
      expect(preparationConflicts).toBe(2)
      expect(creates).toHaveBeenCalledTimes(2)
      const state = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(state.tasks.map(value => value.id)).toEqual([task.id])
      expect(state.participants.filter(value => value.role === 'reviewer')).toHaveLength(1)
      expect(state.activations).toHaveLength(3)
      expect(task.reviewPolicy.kind).toBe('participant')
    } finally {
      adapter.releaseCoordinator.resolve(undefined)
    }
  })

  it('creates and admits the first human input once for one retry key', async () => {
    const ctx = await setup()
    const post = vi.spyOn(ctx.teams, 'postChannelEnvelope')
    const request = {
      objective: 'Start one retryable Team task.',
      cwd: process.cwd(),
      idempotencyKey: channelPostIdempotencyKeySchema.parse('team-run-start'),
      content: [{ type: 'text' as const, text: 'Begin the task.' }],
      delivery: 'context' as const,
    }
    const [first, retry] = await Promise.all([
      ctx.teamRuns.start(request),
      ctx.teamRuns.start(request),
    ])

    expect(retry).toBe(first)
    expect(first.input.payload).toEqual({ content: request.content })
    expect(Array.isArray((await ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items)).toBe(true)
    const records = await ctx.teams.readChannel({ channelId: first.handle.channel.manifest.id, afterCursor: -1 })
    expect(records.records.filter(record => record.type === 'channel/envelope')).toHaveLength(1)
    const inputPost = post.mock.calls.find(([candidate]) => candidate.draft.channelId === first.handle.channel.manifest.id)?.[0]
    if (inputPost === undefined) throw new Error('TeamRun did not post the initial human input')
    expect(() => JSON.stringify(inputPost.actor)).toThrow('runtime-only')

    await expect(ctx.teamRuns.start({
      ...request,
      objective: 'Different request for the same key.',
    })).rejects.toMatchObject({ code: 'TEAM_RUN_START_CONFLICT' })

    const other = await ctx.teamRuns.start({
      ...request,
      objective: 'Keep another retry key while cancelling the first Team.',
      idempotencyKey: channelPostIdempotencyKeySchema.parse('team-run-start-other'),
    })
    await ctx.teamRuns.cancel(first.handle.teamId)
    await ctx.teamRuns.cancel(other.handle.teamId)
    await expect(ctx.teams.postChannelEnvelope(inputPost)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

    const ownedRequest = {
      ...request,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('team-run-start-owner-fence'),
      humanOwner: { kind: 'product-principal' as const, principalId: 'owner-a' as never },
    }
    const owned = await withPrincipalAdmission(ctx, 'owner-a', async admitHumanChannel =>
      await ctx.teamRuns.start({ ...ownedRequest, admitHumanChannel }))
    await expect(ctx.teamRuns.start({
      ...ownedRequest,
      humanOwner: { kind: 'product-principal', principalId: 'owner-b' as never },
    })).rejects.toMatchObject({ code: 'TEAM_RUN_START_CONFLICT' })
    await ctx.teamRuns.cancel(owned.handle.teamId)
  })

  it('retains unpublished coordinator cleanup failure alongside the topology failure', async () => {
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0 }, new ReplyAdapter(), false)
    const primary = new Error('coordinator prompt failed')
    const cleanup = new Error('coordinator lease cleanup failed')
    let owned: TeamActivationLease | undefined
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    const activation = vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      owned = await activate(request)
      return new Proxy(owned, { get(target, key) {
        if (key === 'dispose') return async () => { throw cleanup }
        return Reflect.get(target, key, target) as unknown
      } })
    })
    const section = ctx.systemPrompt.section.bind(ctx.systemPrompt)
    const prompt = vi.spyOn(ctx.systemPrompt, 'section').mockImplementation((options) => {
      if (options.name === 'team-run:delegation-guidance') throw primary
      return section(options)
    })
    try {
      await expect(ctx.teamRuns.create({ objective: 'Exercise topology cleanup.', cwd: process.cwd() }))
        .rejects.toHaveProperty('errors', expect.arrayContaining([primary, cleanup]))
    } finally {
      prompt.mockRestore(); activation.mockRestore()
      await owned?.dispose()
    }
  })

  it('removes the first scoped prompt when final-output prompt registration fails', async () => {
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0 }, new ReplyAdapter(), false)
    const section = ctx.systemPrompt.section.bind(ctx.systemPrompt)
    const releaseGuidance = vi.fn()
    const failure = new Error('final-output prompt registration failed')
    const prompt = vi.spyOn(ctx.systemPrompt, 'section').mockImplementation((options) => {
      if (options.name === 'team-run:final-output') throw failure
      const dispose = section(options)
      if (options.name !== 'team-run:delegation-guidance') return dispose
      return () => { releaseGuidance(); dispose() }
    })
    try {
      await expect(ctx.teamRuns.create({ objective: 'Reject partial prompt setup.', cwd: process.cwd() }))
        .rejects.toThrow('final-output prompt registration failed')
      expect(releaseGuidance).toHaveBeenCalledOnce()
    } finally { prompt.mockRestore() }
  })

  it('releases a start key when topology creation fails before publication', async () => {
    const ctx = await setup()
    const request = {
      objective: 'Retry after failed topology creation.',
      cwd: process.cwd(),
      idempotencyKey: channelPostIdempotencyKeySchema.parse('team-run-start-create-retry'),
      content: [{ type: 'text' as const, text: 'Begin the retryable task.' }],
    }
    const create = vi.spyOn(ctx.teamRuns, 'create').mockRejectedValueOnce(new Error('topology creation failed'))

    await expect(ctx.teamRuns.start(request)).rejects.toThrow('topology creation failed')
    create.mockRestore()
    await expect(ctx.teamRuns.start(request)).resolves.toMatchObject({
      handle: { team: { phase: 'active' } },
    })
  })

  it('cancels a created topology and releases its retry key when first input admission fails', async () => {
    const ctx = await setup()
    const request = {
      objective: 'Retry after failed first input.',
      cwd: process.cwd(),
      idempotencyKey: channelPostIdempotencyKeySchema.parse('team-run-start-retry'),
      content: [{ type: 'text' as const, text: 'Begin the retryable task.' }],
    }
    const post = vi.spyOn(ctx.teamRuns, 'postHumanInput').mockRejectedValueOnce(new Error('first input failed'))

    await expect(ctx.teamRuns.start(request)).rejects.toThrow('first input failed')
    await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [{ phase: 'cancelled' }] })
    post.mockRestore()

    await expect(ctx.teamRuns.start(request)).resolves.toMatchObject({
      handle: { team: { phase: 'active' } },
      input: { payload: { content: request.content } },
    })
  })

  it('preserves the input failure when rollback cannot settle the created run', async () => {
    const ctx = await setup()
    vi.spyOn(ctx.teamRuns, 'postHumanInput').mockRejectedValueOnce(new Error('first input failed'))
    vi.spyOn(ctx.teamRuns, 'cancel').mockRejectedValueOnce(new Error('rollback failed'))

    await expect(ctx.teamRuns.start({
      objective: 'Keep the first admission error.',
      cwd: process.cwd(),
      idempotencyKey: channelPostIdempotencyKeySchema.parse('team-run-start-rollback-failure'),
      content: [{ type: 'text', text: 'Begin.' }],
    })).rejects.toThrow('first input failed')
  })

  it('rejects a missing model before creating a durable Team topology', async () => {
    const ctx = await setup(false)
    await expect(ctx.teamRuns.create({ objective: 'Must not start.', cwd: process.cwd() })).rejects.toMatchObject({
      code: 'TEAM_RUN_MODEL_REQUIRED',
    })
    await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [] })
  })

  it('uses an explicit per-run selection and cap without changing the deployment default', async () => {
    const ctx = await setup()
    const defaultRun = await ctx.teamRuns.create({ objective: 'Use the deployment route.', cwd: process.cwd() })
    expect(defaultRun.coordinatorLease.localAgent?.options).toEqual({ provider: 'mock', model: 'mock' })

    const selectedRun = await ctx.teamRuns.create({
      objective: 'Use the caller route.',
      cwd: process.cwd(),
      selection: { provider: 'caller-provider', model: 'caller-model' },
      maxTokens: 17,
    })
    expect(selectedRun.coordinatorLease.localAgent?.options).toEqual({
      provider: 'caller-provider', model: 'caller-model', maxTokens: 17,
    })
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('forwards an explicit coordinator preset to its activation provider', async () => {
    const ctx = await setup()
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    let agent: { readonly cwd?: string; readonly preset?: string; readonly options: object } | undefined
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      agent = request.agent
      return await activate({
        ...request,
        agent: {
          options: request.agent.options,
          ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
        },
      })
    })
    await ctx.teamRuns.create({
      objective: 'Use the product preset.',
      cwd: process.cwd(),
      preset: 'web-coordinator',
    })
    expect(agent).toEqual({
      cwd: process.cwd(),
      preset: 'web-coordinator',
      options: { provider: 'mock', model: 'mock' },
    })
  })

  it('rejects an invalid per-run output cap before creating a Team', async () => {
    const ctx = await setup()
    await expect(ctx.teamRuns.create({
      objective: 'Reject the cap.',
      cwd: process.cwd(),
      maxTokens: 0,
    })).rejects.toThrow('maxTokens must be a positive safe integer')
    await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [] })
  })

  it('re-reads the channel after a live coordinator turn end and rejects a missing explicit final Envelope', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(true, {}, adapter, true)
    const run = await ctx.teamRuns.create({ objective: 'Require a final Envelope.', cwd: process.cwd() })
    await ctx.teamRuns.postHumanInput({ teamId: run.teamId, content: [{ type: 'text', text: 'Finish without a tool call.' }] })
    await adapter.started.promise
    const final = ctx.teamRuns.waitForFinal({ teamId: run.teamId })
    adapter.release.resolve(undefined)
    await expect(final).rejects.toMatchObject({
      code: 'TEAM_RUN_FINAL_INVALID',
    })
    await expect(final).rejects.toThrow('coordinator turn ended completed')
  })

  it('records a missing-final stall when the coordinator ends without a final and no caller is waiting', async () => {
    const ctx = await setup(true, {}, new ReplyAdapter(), true)
    const run = await ctx.teamRuns.create({ objective: 'Record an unattended missing final.', cwd: process.cwd() })
    await ctx.teamRuns.postHumanInput({ teamId: run.teamId, content: [{ type: 'text', text: 'End without a final.' }] })
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
        team: { phase: 'stalled', stallReason: { code: 'FINAL_ANSWER_MISSING' } },
      })
    })
    const interrupt = vi.spyOn(ctx.teams, 'requestParticipantInterrupt')
    await expect(ctx.teamRuns.requestCoordinatorInterrupt(run.teamId)).resolves.toBeUndefined()
    expect(interrupt).not.toHaveBeenCalled()
  })

  it('keeps the Team active after a successful non-final team message', async () => {
    const ctx = await setup(true, {}, new TeamMessageAdapter(), true, undefined, true)
    const run = await ctx.teamRuns.create({ objective: 'Keep a communicated Team active.', cwd: process.cwd() })
    await ctx.teamRuns.postHumanInput({ teamId: run.teamId, content: [{ type: 'text', text: 'Send a progress update, then wait.' }] })
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
        team: { phase: 'active' },
      })
    })
    const coordinatorSession = run.coordinatorLease.localAgent?.session
    if (coordinatorSession === undefined) throw new Error('Team run did not retain its coordinator Session')
    await vi.waitFor(() => {
      expect(coordinatorSession.events.some(event => event.type === 'turn/end')).toBe(true)
    })
    const channel = await ctx.teams.getChannel({ channelId: run.channel.manifest.id })
    await vi.waitFor(async () => {
      const page = await ctx.teams.readChannelPage({ channelId: channel.manifest.id, afterCursor: -1, limit: 32 })
      expect(page.records.some(record => record.type === 'channel/envelope' && record.envelope.kind === 'message')).toBe(true)
    })
    await expect(ctx.teamRuns.cancel(run.teamId)).resolves.toBeUndefined()
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
  })

  it('keeps a Team active after coordinator output truncation so a continuation can finish it', async () => {
    const adapter = new MaxTokensAdapter()
    const ctx = await setup(true, {}, adapter, true)
    const run = await ctx.teamRuns.create({ objective: 'Continue after output truncation.', cwd: process.cwd() })
    const lifecycleObservation = vi.spyOn(ctx.teamClosureDriver, 'recordTurnEnd')
    await ctx.teamRuns.postHumanInput({ teamId: run.teamId, content: [{ type: 'text', text: 'Start the answer.' }] })
    await vi.waitFor(async () => {
      const state = await ctx.teams.getTeam({ teamId: run.teamId })
      expect(state.team.phase).toBe('active')
      expect(run.coordinatorLease.localAgent?.session.events.some(event =>
        event.type === 'turn/end' && event.data.reason.kind === 'max-tokens')).toBe(true)
    })
    await adapter.continuationStarted.promise
    expect(lifecycleObservation).not.toHaveBeenCalled()
    await postFinal(ctx, run, 'The continuation finished.')
    adapter.releaseContinuation.resolve(undefined)
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({
      text: 'The continuation finished.',
    })
  })

  it('records a missing final after the coordinator exhausts its output-limit continuations', async () => {
    const adapter = new MaxTokensAdapter()
    const ctx = await setup(true, { maxCoordinatorOutputContinuations: 1 }, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Stop repeated truncated coordinator turns.', cwd: process.cwd() })
    const record = vi.spyOn(ctx.teamClosureDriver, 'recordTurnEnd')
    await ctx.teamRuns.postHumanInput({ teamId: run.teamId, content: [{ type: 'text', text: 'Finish the answer.' }] })
    await adapter.continuationStarted.promise
    expect((await ctx.teams.getTeam({ teamId: run.teamId })).team.phase).toBe('active')
    adapter.releaseContinuation.resolve(undefined)
    await vi.waitFor(async () => {
      expect((await ctx.teams.getTeam({ teamId: run.teamId })).team.phase).toBe('stalled')
    })
    expect(record.mock.calls.some(([input]) => input.teamId === run.teamId
      && input.reason.code === 'FINAL_ANSWER_MISSING'
      && input.outcome === 'missing-final')).toBe(true)
  })

  it('retries one trusted human input after a channel cursor conflict', async () => {
    const ctx = await setup(true, { humanInputRetryAttempts: 2 })
    const run = await ctx.teamRuns.create({ objective: 'Retry human input.', cwd: process.cwd() })
    const post = vi.spyOn(ctx.teams, 'postChannelEnvelope')
    post.mockImplementationOnce(async () => {
      throw new TeamError('channel moved', 'TEAM_CHANNEL_CURSOR_CONFLICT')
    })

    await expect(ctx.teamRuns.postHumanInput({
      teamId: run.teamId,
      content: [{ type: 'text', text: 'Retry the input.' }],
      idempotencyKey: channelPostIdempotencyKeySchema.parse('team-run-input-retry'),
    })).resolves.toMatchObject({ kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND })
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('preserves final cursor conflicts and non-cursor input failures', async () => {
    const ctx = await setup(true, { humanInputRetryAttempts: 1 })
    const run = await ctx.teamRuns.create({ objective: 'Preserve human input failures.', cwd: process.cwd() })
    const post = vi.spyOn(ctx.teams, 'postChannelEnvelope')
    post.mockRejectedValueOnce(new TeamError('channel moved', 'TEAM_CHANNEL_CURSOR_CONFLICT'))
    await expect(ctx.teamRuns.postHumanInput({
      teamId: run.teamId,
      content: [{ type: 'text', text: 'Do not retry the final conflict.' }],
    })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })

    post.mockRejectedValueOnce(new TeamError('channel rejected input', 'TEAM_CHANNEL_NOT_FOUND'))
    await expect(ctx.teamRuns.postHumanInput({
      teamId: run.teamId,
      content: [{ type: 'text', text: 'Preserve the non-cursor error.' }],
    })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_NOT_FOUND' })
  })

  it('preserves a coordinator model failure when no explicit final Envelope was accepted', async () => {
    const ctx = await setup(true, {}, new FailureAdapter(), true)
    const run = await ctx.teamRuns.create({ objective: 'Report the model failure.', cwd: process.cwd() })
    const lifecycleObservation = vi.spyOn(ctx.teamClosureDriver, 'recordTurnEnd')
    await ctx.teamRuns.postHumanInput({ teamId: run.teamId, content: [{ type: 'text', text: 'Fail before final output.' }] })
    await vi.waitFor(() => {
      expect(run.coordinatorLease.localAgent?.session.events.some(event => event.type === 'turn/end')).toBe(true)
    })
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toMatchObject({
      code: 'TEAM_RUN_FINAL_INVALID',
      message: 'coordinator turn failed before an explicit final Envelope: SERVER: model unavailable',
    })
    expect(lifecycleObservation).toHaveBeenCalledWith(expect.objectContaining({
      teamId: run.teamId,
      coordinatorId: run.coordinator.id,
      activationId: run.coordinatorLease.binding.activation.id,
      sessionId: run.coordinatorLease.binding.sessionId,
      provider: run.coordinatorLease.binding.provider,
      turn: 1,
      outcome: 'failure',
      reason: { code: 'SERVER', message: 'model unavailable' },
    }))
  })

  it('cancels a pending channel watch after final-wait admission', async () => {
    const adapter = new GateAdapter()
    const ctx = await setup(true, {}, adapter)
    const run = await ctx.teamRuns.create({ objective: 'Cancel a pending wait.', cwd: process.cwd() })
    await ctx.teamRuns.postHumanInput({ teamId: run.teamId, content: [{ type: 'text', text: 'Wait for cancellation.' }] })
    await adapter.started.promise
    const controller = new AbortController()
    const watch = vi.spyOn(ctx.teams, 'watchChannel')
    const final = ctx.teamRuns.waitForFinal({ teamId: run.teamId, signal: controller.signal })
    await vi.waitFor(() => { expect(watch).toHaveBeenCalled() })
    try {
      controller.abort()
      await expect(final).rejects.toThrow('This operation was aborted')
    } finally {
      adapter.release.resolve(undefined)
    }
  })

  it('rejects invalid direct configuration and accepts explicit deployment values', async () => {
    const ctx = new Context()
    ctx.provide('teams', { registerSystemChannelAdmissionProofSource: () => () => {},
      registerSystemChannelLifecycleProofSource: () => () => {}, registerSystemChildResultProofSource: () => () => {},
    } as unknown as Context['teams'])
    try {
      expect(() => new TeamRun.TeamRunService(ctx, {
        activationProvider: 'local',
        templateId: 'product-v2',
        templateVersion: 2,
        maxChildTeams: 0,
        humanName: 'Human',
        coordinatorName: 'Coordinator',
        workerName: 'Worker',
        workerCount: 2,
        maxLiveActivations: 3,
        workerPreset: 'worker-preset',
        reviewerPreset: 'reviewer-preset',
        workerTaskMaxAttempts: 2,
        workerTaskPriority: 3,
        finalPromptOrder: 10,
        workerPromptOrder: 11,
        maxCoordinatorOutputContinuations: 4,
        receiptRetryAttempts: 2,
        humanInputRetryAttempts: 2,
      })).not.toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
    for (const [config, message] of [
      [{ maxChildTeams: -1 }, 'maxChildTeams must be a non-negative safe integer'],
      [{ maxChildTeams: 1.5 }, 'maxChildTeams must be a non-negative safe integer'],
      [{ maxLiveActivations: -1 }, 'maxLiveActivations must be a non-negative safe integer'],
      [{ maxLiveActivations: 1.5 }, 'maxLiveActivations must be a non-negative safe integer'],
      [{ activationProvider: ' ' }, 'activationProvider must be non-empty'],
      [{ templateVersion: 1.5 }, 'templateVersion must be a positive safe integer'],
      [{ templateVersion: 0 }, 'templateVersion must be a positive safe integer'],
      [{ workerCount: 1.5 }, 'workerCount must be a non-negative safe integer'],
      [{ workerCount: -1 }, 'workerCount must be a non-negative safe integer'],
      [{ maxWorkerCount: 1.5 }, 'maxWorkerCount must be a non-negative safe integer'],
      [{ maxWorkerCount: -1 }, 'maxWorkerCount must be a non-negative safe integer'],
      [{ workerCount: 2, maxWorkerCount: 1 }, 'workerCount must not exceed maxWorkerCount'],
      [{ workerTaskMaxAttempts: 0 }, 'workerTaskMaxAttempts must be a positive safe integer'],
      [{ workerTaskMaxAttempts: 1.5 }, 'workerTaskMaxAttempts must be a positive safe integer'],
      [{ workerTaskPriority: -1 }, 'workerTaskPriority must be a non-negative safe integer'],
      [{ workerTaskPriority: 1.5 }, 'workerTaskPriority must be a non-negative safe integer'],
      [{ finalPromptOrder: Infinity }, 'finalPromptOrder must be finite'],
      [{ workerPromptOrder: Infinity }, 'workerPromptOrder must be finite'],
      [{ maxCoordinatorOutputContinuations: 0 }, 'maxCoordinatorOutputContinuations must be a positive safe integer'],
      [{ maxCoordinatorOutputContinuations: 1.5 }, 'maxCoordinatorOutputContinuations must be a positive safe integer'],
      [{ receiptRetryAttempts: 1.5 }, 'receiptRetryAttempts must be a positive safe integer'],
      [{ receiptRetryAttempts: 0 }, 'receiptRetryAttempts must be a positive safe integer'],
      [{ humanInputRetryAttempts: 1.5 }, 'humanInputRetryAttempts must be a positive safe integer'],
      [{ humanInputRetryAttempts: 0 }, 'humanInputRetryAttempts must be a positive safe integer'],
      [{ channelPageSize: 1.5 }, 'channelPageSize must be a positive safe integer'],
      [{ channelPageSize: 0 }, 'channelPageSize must be a positive safe integer'],
    ] as const) {
      const invalidContext = new Context()
      try {
        expect(() => new TeamRun.TeamRunService(invalidContext, config)).toThrow(message)
      } finally {
        await invalidContext.fiber.dispose()
      }
    }
  })

  it('rejects product operations for a Team not owned by this local run service', async () => {
    const ctx = await setup()
    const teamId = 'missing-team' as TeamId
    await expect(ctx.teamRuns.postHumanInput({ teamId, content: [{ type: 'text', text: 'No owner.' }] })).rejects.toMatchObject({
      code: 'TEAM_RUN_NOT_FOUND',
    })
    await expect(ctx.teamRuns.waitForFinal({ teamId })).rejects.toMatchObject({
      code: 'TEAM_RUN_NOT_FOUND',
    })
    await expect(ctx.teamRuns.cancel(teamId)).rejects.toMatchObject({
      code: 'TEAM_RUN_NOT_FOUND',
    })
  })

  it('rejects an authenticated owner fence that does not match the current TeamRun human', async () => {
    const ctx = await setup()
    const run = await withPrincipalAdmission(ctx, 'owner-a', async admitHumanChannel => await ctx.teamRuns.create({
      objective: 'Reject a mismatched current-run owner.',
      cwd: process.cwd(),
      humanOwner: { kind: 'product-principal', principalId: 'owner-a' as never },
      admitHumanChannel,
    }))
    try {
      await expect(ctx.teamRuns.postHumanInput({
        teamId: run.teamId,
        content: [{ type: 'text', text: 'Must not enter another owner\'s run.' }],
        humanOwner: { kind: 'product-principal', principalId: 'owner-b' as never },
      })).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_FOUND' })
    } finally {
      await ctx.teamRuns.cancel(run.teamId)
    }
  })

  it.each(['missing', 'non-acknowledging'] as const)('refuses a %s product human endpoint during Team creation', async (mode) => {
    const ctx = await setup()
    await expect(ctx.teamRuns.create({ objective: 'Require exact human invitation consent.', cwd: process.cwd(),
      humanOwner: { kind: 'product-principal', principalId: 'human-owner' as never },
      ...mode === 'missing' ? {} : { admitHumanChannel: async () => {} },
    })).rejects.toThrow(mode === 'missing' ? 'admission capability is required' : 'without durable invitation consent')
  })

  it('does not join a pending resume owned by another authenticated human', async () => {
    const ctx = await setup()
    const run = await withPrincipalAdmission(ctx, 'owner-a', async admitHumanChannel => await ctx.teamRuns.create({
      objective: 'Fence concurrent resume ownership.',
      cwd: process.cwd(),
      humanOwner: { kind: 'product-principal', principalId: 'owner-a' as never },
      admitHumanChannel,
    }))
    await run.coordinatorLease.dispose()
    const internals = ctx.teamRuns as unknown as {
      readonly runs: Map<TeamId, unknown>
      readonly resumes: Map<TeamId, Promise<TeamRun.TeamRunHandle>>
    }
    internals.runs.delete(run.teamId)
    const pending = Promise.withResolvers<TeamRun.TeamRunHandle>()
    internals.resumes.set(run.teamId, pending.promise)
    try {
      const joining = ctx.teamRuns.resume({
        teamId: run.teamId,
        humanOwner: { kind: 'product-principal', principalId: 'owner-b' as never },
      })
      pending.resolve(run)
      await expect(joining).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_FOUND' })
    } finally {
      internals.resumes.delete(run.teamId)
    }
  })

  it('cancels an active Team through its current local owner', async () => {
    const ctx = await setup()
    const active = await ctx.teamRuns.create({ objective: 'Cancel while active.', cwd: process.cwd() })
    await ctx.teamRuns.cancel(active.teamId)
    await expect(ctx.teams.getTeam({ teamId: active.teamId })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
    await expect(ctx.teamRuns.resume({ teamId: active.teamId })).rejects.toThrow('not resumable from phase')
    await expect(ctx.teamRuns.postHumanInput({ teamId: active.teamId, content: [{ type: 'text', text: 'No longer owned.' }] })).rejects.toMatchObject({
      code: 'TEAM_RUN_NOT_FOUND',
    })
  })

  it('returns the current local handle when its owner resumes an already resident Team', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Keep the resident coordinator epoch.', cwd: process.cwd() })
    const activation = run.coordinatorLease.binding.activation.id
    const resumed = await ctx.teamRuns.resume({ teamId: run.teamId })
    expect(resumed).toBe(run)
    expect((await ctx.teams.getTeam({ teamId: run.teamId })).activations.at(-1)?.activation.id).toBe(activation)
    await ctx.teamRuns.cancel(run.teamId)
  })

  it('waits for the parent delegation drive before releasing cancellation ownership', async () => {
    const ctx = await setup()
    const active = await ctx.teamRuns.create({ objective: 'Wait for child cancellation.', cwd: process.cwd() })
    const entered = Promise.withResolvers<TeamId>()
    const release = Promise.withResolvers<undefined>()
    const driver = {
      drive: vi.fn(async (teamId: TeamId) => {
        entered.resolve(teamId)
        await release.promise
      }),
    } satisfies TeamRun.TeamDelegationDriver
    const unregister = TeamRun.registerTeamDelegationDriver(ctx, driver)
    const dispose = vi.spyOn(active.coordinatorLease, 'dispose')
    try {
      const cancellation = ctx.teamRuns.cancel(active.teamId)
      await expect(entered.promise).resolves.toBe(active.teamId)
      expect(dispose).not.toHaveBeenCalled()
      release.resolve(undefined)
      await cancellation
      expect(dispose).toHaveBeenCalledOnce()
      await expect(ctx.teams.getTeam({ teamId: active.teamId })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
    } finally {
      unregister()
      release.resolve(undefined)
    }
  })

  it('retains a terminal cancellation owner, issues one exact archive proof, and clears it on disposal', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Archive a locally cancelled Team.', cwd: process.cwd() })
    const internals = archiveProofInternals(ctx.teamRuns)
    await ctx.teamRuns.cancel(run.teamId)
    const terminal = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(terminal.team.phase).toBe('cancelled')
    expect(internals.terminalArchiveOwners.get(run.teamId)).toEqual({ teamId: run.teamId })

    const archiveTeam = ctx.teams.archiveTeam.bind(ctx.teams)
    let proof: TeamSystemArchiveProof | undefined
    const archive = vi.spyOn(ctx.teams, 'archiveTeam').mockImplementation(async (request) => {
      const actor = request.actor as TeamSystemArchiveProof
      proof = actor
      const record = internals.archiveProofs.get(actor)
      expect(record?.scope).toEqual({
        kind: 'team-run-terminal-archive', teamId: run.teamId, expectedCursor: request.expectedCursor,
      })
      expect(() => JSON.stringify(actor)).toThrow(/runtime-only/u)
      expect(() => structuredClone(actor)).toThrow()
      return await archiveTeam(request)
    })
    const archived = await ctx.teamRuns.archiveTerminal({ teamId: run.teamId, expectedCursor: terminal.team.cursor })
    expect(archived.team.archivedAt).toBeDefined()
    await expect(ctx.teamRuns.resume({ teamId: run.teamId })).rejects.toThrow('not resumable from phase')
    if (proof === undefined) throw new Error('Team-run did not submit a terminal archive proof')
    expect(internals.archiveProofs.get(proof)).toBeUndefined()
    expect(internals.terminalArchiveOwners.get(run.teamId)).toEqual({ teamId: run.teamId })
    await expect(ctx.teamRuns.archiveTerminal({ teamId: run.teamId, expectedCursor: 0 }))
      .resolves.toMatchObject({ team: { archivedAt: archived.team.archivedAt } })
    expect(archive).toHaveBeenCalledTimes(2)

    await ctx.teamRuns.close()
    expect(internals.terminalArchiveOwners.size).toBe(0)
    await expect(ctx.teamRuns.archiveTerminal({ teamId: run.teamId, expectedCursor: archived.team.cursor }))
      .rejects.toMatchObject({ code: 'TEAM_RUN_DISPOSED' })
  })

  it('fails closed when TeamRun disposal revokes a terminal archive proof during Hub policy', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Revoke terminal archive authority during policy.', cwd: process.cwd() })
    await ctx.teamRuns.cancel(run.teamId)
    const terminal = await ctx.teams.getTeam({ teamId: run.teamId })
    const unregister = ctx.teams.registerPolicy('close', {
      name: 'dispose-terminal-archive-owner',
      apply: async (request, next) => {
        if (request.facts.operation === 'terminal-archive') await ctx.teamRuns.close()
        return await next()
      },
    })
    try {
      await expect(ctx.teamRuns.archiveTerminal({ teamId: run.teamId, expectedCursor: terminal.team.cursor }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.not.toHaveProperty('team.archivedAt')
    } finally {
      unregister()
    }
  })

  it('persists cancellation before releasing local leases or using a generic phase transition', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Persist cancellation before cleanup.', cwd: process.cwd() })
    const internals = closureProofInternals(ctx.teamRuns)
    const cancelTeam = ctx.teams.cancelTeam.bind(ctx.teams)
    const started = Promise.withResolvers<undefined>()
    const continueCancellation = Promise.withResolvers<undefined>()
    let proof: TeamSystemClosureProof | undefined
    const cancel = vi.spyOn(ctx.teams, 'cancelTeam').mockImplementationOnce(async (request) => {
      proof = request.actor as TeamSystemClosureProof
      expect(internals.closureProofs.get(proof)?.scope).toEqual({
        kind: 'team-run-cancel',
        teamId: run.teamId,
        channelId: run.channel.manifest.id,
        humanId: run.recipient.id,
        coordinatorId: run.coordinator.id,
      })
      started.resolve(undefined)
      await continueCancellation.promise
      return await cancelTeam(request)
    })
    const transition = vi.spyOn(ctx.teams, 'transitionTeamPhase')
    const dispose = vi.spyOn(run.coordinatorLease, 'dispose')

    const cancellation = ctx.teamRuns.cancel(run.teamId)
    await started.promise

    expect(dispose).not.toHaveBeenCalled()
    expect(transition).not.toHaveBeenCalled()

    continueCancellation.resolve(undefined)
    await cancellation

    if (proof === undefined) throw new Error('Team-run did not submit a cancellation proof')
    expect(internals.closureProofs.get(proof)).toBeUndefined()
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({
      teamId: run.teamId,
      actor: proof,
      reason: { code: 'USER_CANCELLED', message: 'The user cancelled the Team run.' },
    }))
    expect(dispose).toHaveBeenCalledOnce()
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
      team: {
        phase: 'cancelled',
        cancellation: { actor: { kind: 'system', name: 'team-run' } },
        closure: { actor: { kind: 'system', name: 'team-run' } },
      },
    })
  })

  it('marks the coordinator execution route closing while cancellation drains its owned lease', async () => {
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0 })
    const run = await ctx.teamRuns.create({ objective: 'Observe cancellation cleanup admission.', cwd: process.cwd() })
    const dispose = run.coordinatorLease.dispose.bind(run.coordinatorLease)
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    vi.spyOn(run.coordinatorLease, 'dispose').mockImplementationOnce(async () => {
      entered.resolve(undefined); await release.promise; await dispose()
    })
    try {
      const cancelling = ctx.teamRuns.cancel(run.teamId)
      await entered.promise
      const route = await ctx.waterfall(ctx.teams, 'team/member-execution-observe',
        { teamId: run.teamId, participant: run.coordinator }, async () => ({}))
      expect(route.route?.reasons).toContain('owner-closing')
      release.resolve(undefined)
      await cancelling
    } finally { release.resolve(undefined) }
  })

  it('retries a concurrent Team cursor advance before releasing the local run', async () => {
    const ctx = await setup(true, {}, new ReplyAdapter(), false)
    const run = await ctx.teamRuns.create({ objective: 'Retry cancellation after a cursor race.', cwd: process.cwd() })
    const internals = closureProofInternals(ctx.teamRuns)
    const topology = topologyProofInternals(ctx.teamRuns)
    const state = ownedRuns(ctx.teamRuns).get(run.teamId)
    if (state === undefined) throw new Error('created Team run was not retained')
    const cancelTeam = ctx.teams.cancelTeam.bind(ctx.teams)
    let advanced = false
    const proofs: TeamSystemClosureProof[] = []
    const cancel = vi.spyOn(ctx.teams, 'cancelTeam').mockImplementation(async (request) => {
      const proof = request.actor as TeamSystemClosureProof
      proofs.push(proof)
      expect(internals.closureProofs.get(proof)?.scope).toEqual({
        kind: 'team-run-cancel',
        teamId: run.teamId,
        channelId: run.channel.manifest.id,
        humanId: run.recipient.id,
        coordinatorId: run.coordinator.id,
      })
      if (!advanced) {
        advanced = true
        const current = await ctx.teams.getTeam({ teamId: run.teamId })
        const phaseInput = {
          teamId: run.teamId,
          participantId: run.worker!.id,
          expectedCursor: current.team.cursor,
          phase: 'active',
        } as const
        await topology.withRunTopologyProof(state, {
          kind: 'team-run-worker-activate',
          ...phaseInput,
          expectedPhase: 'provisioning',
        }, async actor => await ctx.teams.transitionParticipantPhase({ actor, ...phaseInput }))
      }
      return await cancelTeam(request)
    })

    await ctx.teamRuns.cancel(run.teamId)

    expect(cancel).toHaveBeenCalledTimes(3)
    expect(new Set(proofs).size).toBe(proofs.length)
    expect(proofs.every(proof => internals.closureProofs.get(proof) === undefined)).toBe(true)
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
    await expect(ctx.teamRuns.postHumanInput({
      teamId: run.teamId,
      content: [{ type: 'text', text: 'The cancelled run no longer owns input admission.' }],
    })).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_FOUND' })
  })

  it('retries cancellation after a cursor conflict even when its recovery read briefly fails', async () => {
    const ctx = await setup(true, { receiptRetryAttempts: 2 })
    const run = await ctx.teamRuns.create({ objective: 'Retry after an unavailable cancellation read.', cwd: process.cwd() })
    const cancelTeam = ctx.teams.cancelTeam.bind(ctx.teams)
    const getTeam = ctx.teams.getTeam.bind(ctx.teams)
    const conflict = new TeamError('Team cursor moved before cancellation', 'TEAM_CURSOR_CONFLICT')
    const readFailure = new Error('Team projection temporarily unavailable')
    let failRecoveryRead = false
    const cancel = vi.spyOn(ctx.teams, 'cancelTeam').mockImplementationOnce(async () => {
      failRecoveryRead = true
      throw conflict
    }).mockImplementation(async request => await cancelTeam(request))
    vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
      if (failRecoveryRead && request.teamId === run.teamId) {
        failRecoveryRead = false
        throw readFailure
      }
      return await getTeam(request)
    })
    await expect(ctx.teamRuns.cancel(run.teamId)).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(failRecoveryRead).toBe(false)
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
  })

  it('retains local ownership when the Hub cannot accept the cancellation intent', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Do not release before cancellation admission.', cwd: process.cwd() })
    const failure = new Error('cancellation intent unavailable')
    const cancel = vi.spyOn(ctx.teams, 'cancelTeam').mockRejectedValueOnce(failure)
    const dispose = vi.spyOn(run.coordinatorLease, 'dispose')

    await expect(ctx.teamRuns.cancel(run.teamId)).rejects.toBe(failure)
    expect(dispose).not.toHaveBeenCalled()
    await expect(ctx.teamRuns.postHumanInput({
      teamId: run.teamId,
      content: [{ type: 'text', text: 'The retained owner can retry cancellation.' }],
    })).resolves.toMatchObject({ channelId: run.channel.manifest.id })

    cancel.mockRestore()
    await ctx.teamRuns.cancel(run.teamId)
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
  })

  it('retains its released cancellation owner until the Hub durably reaches cancelled', async () => {
    const ctx = await setup(true, {}, new ReplyAdapter(), false)
    const run = await ctx.teamRuns.create({ objective: 'Retain cancellation ownership through quiescing.', cwd: process.cwd() })
    const runs = ownedRuns(ctx.teamRuns)
    const cancelTeam = ctx.teams.cancelTeam.bind(ctx.teams)
    const cancel = vi.spyOn(ctx.teams, 'cancelTeam')
      .mockImplementationOnce(async request => await cancelTeam(request))
      .mockImplementationOnce(async () => await ctx.teams.getTeam({ teamId: run.teamId }))

    await expect(ctx.teamRuns.cancel(run.teamId)).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_QUIESCENT' })
    expect(runs.get(run.teamId)).toBeDefined()
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'quiescing' } })

    cancel.mockRestore()
    await ctx.teamRuns.cancel(run.teamId)
    expect(runs.get(run.teamId)).toBeUndefined()
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
  })

  it('accepts terminal typed cancellation after a superseded local channel conflict', async () => {
    const ctx = await setup(true, { receiptRetryAttempts: 1 }, new ReplyAdapter(), false)
    const run = await ctx.teamRuns.create({ objective: 'Retry cancellation channel cleanup.', cwd: process.cwd() })
    const close = vi.spyOn(ctx.teams, 'closeTeamCancellationChannel')
      .mockRejectedValueOnce(new TeamError('channel changed before cancellation cleanup', 'TEAM_CHANNEL_CURSOR_CONFLICT'))
    await expect(ctx.teamRuns.cancel(run.teamId)).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
    const cleanup = close.mock.calls[0]?.[0]
    if (cleanup === undefined) throw new Error('Cancellation did not attempt channel cleanup')
    expect(() => JSON.stringify(cleanup.actor)).toThrow('runtime-only')
    await expect(ctx.teams.closeTeamCancellationChannel(cleanup)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
    await expect(ctx.teamRuns.cancel(run.teamId)).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_FOUND' })
  })

  it('reports a channel storage failure even when typed cancellation reaches terminal', async () => {
    const ctx = await setup(true, { receiptRetryAttempts: 1 }, new ReplyAdapter(), false)
    const run = await ctx.teamRuns.create({ objective: 'Preserve cancellation storage errors.', cwd: process.cwd() })
    const failure = new Error('channel storage unavailable')
    vi.spyOn(ctx.teams, 'closeTeamCancellationChannel').mockRejectedValueOnce(failure)
    await expect(ctx.teamRuns.cancel(run.teamId)).rejects.toBe(failure)
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
  })

  it('reports both cancellation cleanup and closure-driver failures after typed cancellation settles', async () => {
    const ctx = await setup(true, { receiptRetryAttempts: 1 })
    const run = await ctx.teamRuns.create({ objective: 'Retain cancellation after two cleanup failures.', cwd: process.cwd() })
    const progress = new TeamError('channel cleanup raced', 'TEAM_CHANNEL_CURSOR_CONFLICT')
    const driverFailure = new Error('closure driver unavailable')
    const close = vi.spyOn(ctx.teams, 'closeTeamCancellationChannel').mockRejectedValueOnce(progress)
    const drive = vi.spyOn(ctx.teamClosureDriver, 'drive').mockRejectedValue(driverFailure)
    await expect(ctx.teamRuns.cancel(run.teamId)).rejects.toMatchObject({ errors: [progress, driverFailure] })
    expect((await ctx.teams.getTeam({ teamId: run.teamId })).team.phase).toBe('cancelled')
    drive.mockRestore()
    close.mockRestore()
    await expect(ctx.teamRuns.cancel(run.teamId)).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_FOUND' })
  })

  it('stops a final wait when its caller cancels the watch', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Wait cancellation.', cwd: process.cwd() })
    const controller = new AbortController()
    controller.abort(new Error('caller stopped waiting'))
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId, afterCursor: 0, signal: controller.signal })).rejects.toThrow('caller stopped waiting')
  })

  it('rejects a closed channel when no explicit final output was retained', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Closed final wait.', cwd: process.cwd() })
    const channel = await ctx.teams.getChannel({ channelId: run.channel.manifest.id })
    await closeTestChannel(ctx, { channelId: channel.manifest.id, expectedCursor: channel.cursor })
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toMatchObject({
      code: 'TEAM_RUN_FINAL_INVALID',
    })
  })

  it('rejects a final wait when the channel watch closes before another record arrives', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Hub closure final wait.', cwd: process.cwd() })
    vi.spyOn(ctx.teams, 'watchChannel').mockResolvedValue({ kind: 'closed' })
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toMatchObject({
      code: 'TEAM_RUN_FINAL_INVALID',
    })
  })

  it('rejects final admission when an owned workspace settler fails', async () => {
    const ctx = await setup(true, {}, new ReplyAdapter(), false)
    const run = await ctx.teamRuns.create({ objective: 'Propagate workspace settlement failure.', cwd: process.cwd() })
    const coordinator = run.coordinatorLease.localAgent
    if (coordinator === undefined) throw new Error('Final settlement requires its actual local coordinator')
    const failure = new Error('provider cleanup failed before final admission')
    const settle = vi.fn(async (): Promise<void> => { throw failure })
    const ownership = openAgentWorkspaceLease(coordinator, { settleForActivationDisposal: settle })
    const complete = vi.spyOn(ctx.teams, 'completeTeam')
    const admit = vi.spyOn(ctx.teams, 'admitTeamFinalResult')
    try {
      await postFinal(ctx, run)
      await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toBe(failure)
      expect(settle).toHaveBeenCalledTimes(1)
      expect(complete).not.toHaveBeenCalled()
      expect(admit).not.toHaveBeenCalled()
      expect((await ctx.teams.getTeam({ teamId: run.teamId })).team).toMatchObject({ phase: 'active' })
    } finally { ownership.dispose() }
  })

  it('waits for a declared member workspace settler before admitting the final', async () => {
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0, members: [{
      role: 'builder', displayName: 'Builder', kind: 'local-agent', capabilities: ['build'],
      provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128,
    }] }, new ReplyAdapter(), false)
    const run = await ctx.teamRuns.create({ objective: 'Settle the member workspace.', cwd: process.cwd() })
    const state = await ctx.teams.getTeam({ teamId: run.teamId })
    const binding = state.activations.findLast(candidate => candidate.activation.participantId === run.members[0]?.id)
    const member = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
    if (member === undefined) throw new Error('Template member has no local Agent')
    const failure = new Error('member workspace settlement unavailable')
    const settle = vi.fn(async (): Promise<void> => { throw failure })
    const ownership = openAgentWorkspaceLease(member, { settleForActivationDisposal: settle })
    const final = await postFinal(ctx, run)
    try {
      await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toBe(failure)
      expect(settle).toHaveBeenCalledOnce()
      expect((await ctx.teams.getTeam({ teamId: run.teamId })).team.closure).toBeUndefined()
    } finally { ownership.dispose() }
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({ envelopeId: final.id })
  })

  it('re-reads channel records after a changed watch before accepting a final', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Watch for the final.', cwd: process.cwd() })
    await postFinal(ctx, run)
    const readChannelPage = ctx.teams.readChannelPage.bind(ctx.teams)
    let firstRead = true
    const pageRead = vi.spyOn(ctx.teams, 'readChannelPage').mockImplementation(async (request) => {
      const read = await readChannelPage(request)
      if (!firstRead) return read
      firstRead = false
      return { ...read, channel: { ...read.channel, cursor: 0 }, records: [] }
    })
    vi.spyOn(ctx.teams, 'watchChannel').mockResolvedValueOnce({ kind: 'changed', cursor: 1 })
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({ text: 'The review is complete.' })
    expect(pageRead).toHaveBeenCalledWith(expect.objectContaining({ afterCursor: -1, limit: 128 }))
  })

  it('fails a final wait on a non-advancing channel watch', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Reject a repeated channel watch.', cwd: process.cwd() })
    const current = await ctx.teams.getChannel({ channelId: run.channel.manifest.id })
    vi.spyOn(ctx.teams, 'watchChannel').mockResolvedValue({ kind: 'changed', cursor: current.cursor })
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toMatchObject({
      code: 'TEAM_CHANNEL_CURSOR_CONFLICT',
    })
  })

  it('reports aggregate cleanup when an incompletely created Team cannot prove coordinator termination', async () => {
    const ctx = await setup(true, {}, new ReplyAdapter(), false)
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    const releaseFailure = new Error('coordinator termination is unconfirmed')
    const release = vi.fn<() => Promise<void>>().mockRejectedValue(releaseFailure)
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      const lease = await activate(request)
      return {
        binding: lease.binding,
        localAgent: undefined,
        health: () => lease.health(),
        interrupt: (...args) => { lease.interrupt(...args) },
        dispose: release,
      }
    })
    await expect(ctx.teamRuns.create({ objective: 'Require a local coordinator.', cwd: process.cwd() }))
      .rejects.toMatchObject({ errors: [expect.objectContaining({ code: 'TEAM_RUN_NOT_QUIESCENT' }), releaseFailure] })
    expect(release).toHaveBeenCalledOnce()
    await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [{ phase: 'quiescing' }] })
  })

  it('releases the scoped prompt and local lease when projection fails after activation', async () => {
    const ctx = await setup()
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    const getTeam = ctx.teams.getTeam.bind(ctx.teams)
    const section = ctx.systemPrompt.section.bind(ctx.systemPrompt)
    const projectionFailure = new Error('projection unavailable after prompt registration')
    const disposePrompt = vi.fn()
    const disposeLease = vi.fn<() => Promise<void>>()
    let failProjection = false
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      const lease = await activate(request)
      disposeLease.mockImplementation(() => lease.dispose())
      return {
        binding: lease.binding,
        localAgent: lease.localAgent,
        health: () => lease.health(),
        interrupt: (...args) => { lease.interrupt(...args) },
        dispose: disposeLease,
      }
    })
    vi.spyOn(ctx.systemPrompt, 'section').mockImplementation((request) => {
      const dispose = section(request)
      if (request.name !== 'team-run:final-output') return dispose
      failProjection = true
      return () => {
        disposePrompt()
        dispose()
      }
    })
    vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
      if (failProjection) {
        failProjection = false
        throw projectionFailure
      }
      return await getTeam(request)
    })
    await expect(ctx.teamRuns.create({ objective: 'Rollback a post-activation failure.', cwd: process.cwd() })).rejects.toBe(projectionFailure)
    expect(disposePrompt).toHaveBeenCalledOnce()
    expect(disposeLease).toHaveBeenCalledOnce()
    await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [{ phase: 'failed' }] })
  })

  it('releases a declared member activation when its reporting prompt cannot mount', async () => {
    const member: TeamRun.TeamRunMember = { role: 'builder', displayName: 'Builder', kind: 'local-agent',
      capabilities: ['build'], provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128 }
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0, members: [member] })
    const section = ctx.systemPrompt.section.bind(ctx.systemPrompt)
    const failure = new Error('member reporting prompt unavailable')
    vi.spyOn(ctx.systemPrompt, 'section').mockImplementation((request) => {
      if (request.name === 'team-run:template-task-report') throw failure
      return section(request)
    })
    await expect(ctx.teamRuns.create({ objective: 'Release a failed template member.', cwd: process.cwd() }))
      .rejects.toBe(failure)
    const page = await ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })
    expect(page.items).toHaveLength(1)
    const team = await ctx.teams.getTeam({ teamId: page.items[0]!.id })
    expect(team.team.phase).toBe('failed')
    const builder = team.participants.find(participant => participant.role === member.role)
    expect(builder).toBeDefined()
    expect(team.activations.filter(binding => binding.activation.participantId === builder?.id))
      .toMatchObject([{ activation: { status: 'offline' } }])
  })

  it.each([false, true] as const)('reports coordinator startup failure after member activation (cleanup fails: %s)', async (cleanupFails) => {
    const member: TeamRun.TeamRunMember = { role: 'builder', displayName: 'Builder', kind: 'local-agent',
      capabilities: ['build'], provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128 }
    const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0, members: [member] })
    const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
    const failure = new Error('coordinator provider failed after member activation')
    const cleanupFailure = new Error('member lease cleanup failed')
    vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
      const state = await ctx.teams.getTeam({ teamId: request.teamId })
      const participant = state.participants.find(candidate => candidate.id === request.participantId)
      if (participant?.role === 'coordinator') throw failure
      const lease = await activate(request)
      if (!cleanupFails || participant?.role !== member.role) return lease
      return { binding: lease.binding, localAgent: lease.localAgent,
        health: () => lease.health(), interrupt: (...args) => { lease.interrupt(...args) },
        dispose: async () => { await lease.dispose(); throw cleanupFailure },
      }
    })
    const result: unknown = await ctx.teamRuns.create({ objective: 'Release an admitted member after coordinator failure.', cwd: process.cwd() })
      .then(() => undefined, (error: unknown) => error)
    if (cleanupFails) expect(result).toMatchObject({ errors: [failure, cleanupFailure] })
    else expect(result).toBe(failure)
    const page = await ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })
    expect(page.items).toHaveLength(1)
    const team = await ctx.teams.getTeam({ teamId: page.items[0]!.id })
    expect(team.team.phase).toBe('failed')
    const builder = team.participants.find(participant => participant.role === member.role)
    expect(builder).toBeDefined()
    expect(team.activations.filter(binding => binding.activation.participantId === builder?.id))
      .toMatchObject([{ activation: { status: 'offline' } }])
  })

  it('uses one ephemeral Team-run creation-failure proof before a local run exists', async () => {
    const ctx = await setup()
    const openingFailure = new Error('default channel could not open')
    const internals = closureProofInternals(ctx.teamRuns)
    const failTeam = ctx.teams.failTeam.bind(ctx.teams)
    let proof: TeamSystemClosureProof | undefined
    let failedTeamId: TeamId | undefined
    vi.spyOn(ctx.teams, 'openChannel').mockRejectedValueOnce(openingFailure)
    vi.spyOn(ctx.teams, 'failTeam').mockImplementation(async (request) => {
      proof = request.actor as TeamSystemClosureProof
      failedTeamId = request.teamId
      const record = internals.closureProofs.get(proof)
      expect(record?.scope).toEqual({ kind: 'team-run-create-failure', teamId: request.teamId })
      expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
      return await failTeam(request)
    })
    await expect(ctx.teamRuns.create({ objective: 'Record creation failure attribution.', cwd: process.cwd() }))
      .rejects.toBe(openingFailure)
    if (proof === undefined) throw new Error('Team-run did not submit a creation-failure proof')
    if (failedTeamId === undefined) throw new Error('Team-run creation failure did not select a Team')
    expect(internals.closureProofs.get(proof)).toBeUndefined()
    await expect(ctx.teams.getTeam({ teamId: failedTeamId })).resolves.toMatchObject({
      team: { phase: 'failed', closure: { actor: { kind: 'system', name: 'team-run' } } },
    })
  })

  it('reports a creation error together with a failed failure settlement', async () => {
    const ctx = await setup()
    const getTeam = ctx.teams.getTeam.bind(ctx.teams)
    const creationFailure = new Error('channel open failed')
    const settlementFailure = new Error('failed Team cannot be read')
    let settling = false
    vi.spyOn(ctx.teams, 'openChannel').mockImplementation(async () => {
      settling = true
      throw creationFailure
    })
    vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
      if (settling) throw settlementFailure
      return await getTeam(request)
    })
    await expect(ctx.teamRuns.create({ objective: 'Aggregate rollback failures.', cwd: process.cwd() })).rejects.toMatchObject({
      errors: [creationFailure, settlementFailure],
    })
  })

  it('settles provisioning failures but leaves an already terminal projection unchanged', async () => {
    const ctx = await setup()
    const getTeam = ctx.teams.getTeam.bind(ctx.teams)
    let failurePhase: TeamPhase | undefined
    let phaseOnOpenFailure: TeamPhase
    vi.spyOn(ctx.teams, 'openChannel').mockImplementation(async () => {
      failurePhase = phaseOnOpenFailure
      throw new Error('channel open failed')
    })
    vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
      const state = await getTeam(request)
      if (failurePhase === undefined) return state
      const phase = failurePhase
      failurePhase = undefined
      return { ...state, team: { ...state.team, phase } }
    })

    phaseOnOpenFailure = 'provisioning'
    await expect(ctx.teamRuns.create({ objective: 'Provisioning rollback.', cwd: process.cwd() })).rejects.toThrow('channel open failed')
    await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [{ phase: 'failed' }] })

    phaseOnOpenFailure = 'completed'
    const transitionTeam = vi.spyOn(ctx.teams, 'transitionTeamPhase')
    await expect(ctx.teamRuns.create({ objective: 'Terminal rollback.', cwd: process.cwd() })).rejects.toThrow('channel open failed')
    expect(transitionTeam).not.toHaveBeenCalled()
  })

  it('fails creation when the provisioned worker is absent from its committed Team projection', async () => {
    const ctx = await setup(true, {}, new ReplyAdapter(), false)
    const inviteParticipant = ctx.teams.inviteParticipant.bind(ctx.teams)
    const transitionParticipant = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
    const getTeam = ctx.teams.getTeam.bind(ctx.teams)
    let workerId: ParticipantSnapshot['id'] | undefined
    let workerProvisioned = false
    vi.spyOn(ctx.teams, 'inviteParticipant').mockImplementation(async (request) => {
      const participant = await inviteParticipant(request)
      if (request.role === 'worker') workerId = participant.id
      return participant
    })
    vi.spyOn(ctx.teams, 'transitionParticipantPhase').mockImplementation(async (request) => {
      const participant = await transitionParticipant(request)
      if (request.participantId === workerId && request.phase === 'provisioning') workerProvisioned = true
      return participant
    })
    vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
      const state = await getTeam(request)
      if (!workerProvisioned) return state
      // Every projection read exposes the fault; background discovery cannot consume a one-read trigger first.
      return { ...state, participants: state.participants.filter(participant => participant.id !== workerId) }
    })
    await expect(ctx.teamRuns.create({ objective: 'Require worker persistence.', cwd: process.cwd() })).rejects.toMatchObject({
      code: 'TEAM_RUN_NOT_QUIESCENT',
    })
  })

  it('retries a final receipt after one channel cursor conflict', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Retry the receipt.', cwd: process.cwd() })
    await postFinal(ctx, run)
    const acknowledge = vi.spyOn(ctx.teams, 'ackChannelEnvelope')
    acknowledge.mockImplementationOnce(async () => {
      throw new TeamError('channel moved', 'TEAM_CHANNEL_CURSOR_CONFLICT')
    })
    const result = await ctx.teamRuns.waitForFinal({ teamId: run.teamId })
    expect(result.text).toBe('The review is complete.')
    expect(acknowledge).toHaveBeenCalledTimes(2)
  })

  it('retries completion intent after a Team cursor conflict before final receipt', async () => {
    const ctx = await setup(true, { receiptRetryAttempts: 2 })
    const run = await ctx.teamRuns.create({ objective: 'Retry completion intent.', cwd: process.cwd() })
    const final = await postFinal(ctx, run)
    const completeTeam = ctx.teams.completeTeam.bind(ctx.teams)
    const complete = vi.spyOn(ctx.teams, 'completeTeam')
      .mockRejectedValueOnce(new TeamError('Team cursor moved before completion', 'TEAM_CURSOR_CONFLICT'))
      .mockImplementation(async request => await completeTeam(request))
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({ envelopeId: final.id })
    expect(complete).toHaveBeenCalledTimes(2)
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
      team: { closure: { kind: 'complete', finalEnvelopeId: final.id } },
    })
  })

  it('keeps a final eligible after completion intent exhausts its cursor retry', async () => {
    const ctx = await setup(true, { receiptRetryAttempts: 1 })
    const run = await ctx.teamRuns.create({ objective: 'Recover a rejected completion intent.', cwd: process.cwd() })
    const final = await postFinal(ctx, run)
    const conflict = new TeamError('Team cursor remains contended', 'TEAM_CURSOR_CONFLICT')
    const complete = vi.spyOn(ctx.teams, 'completeTeam').mockRejectedValueOnce(conflict)
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toBe(conflict)
    expect((await ctx.teams.getTeam({ teamId: run.teamId })).team.closure).toBeUndefined()
    complete.mockRestore()
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({ envelopeId: final.id })
    expect((await ctx.teams.getTeam({ teamId: run.teamId })).team.closure).toMatchObject({
      kind: 'complete', finalEnvelopeId: final.id,
    })
  })

  it('rejects a later final without changing the durable completion selection', async () => {
    const ctx = await setup(true, {}, new ReplyAdapter(), false)
    const run = await ctx.teamRuns.create({ objective: 'Keep the first admitted final selection.', cwd: process.cwd() })
    const selected = await postFinal(ctx, run, 'The selected final.', 'selected-final')
    const later = await postFinal(ctx, run, 'A different later final.', 'later-final')
    const sinkFailure = new Error('result sink unavailable after completion intent')
    const admit = vi.spyOn(ctx.teams, 'admitTeamFinalResult').mockRejectedValueOnce(sinkFailure)
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toBe(sinkFailure)
    expect((await ctx.teams.getTeam({ teamId: run.teamId })).team.closure).toMatchObject({
      kind: 'complete', finalEnvelopeId: selected.id,
    })
    admit.mockRestore()
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId, afterCursor: selected.sequence }))
      .rejects.toMatchObject({ code: 'TEAM_RUN_NOT_QUIESCENT' })
    expect((await ctx.teams.getTeam({ teamId: run.teamId })).team.closure).toMatchObject({
      kind: 'complete', finalEnvelopeId: selected.id,
    })
    expect(later.id).not.toBe(selected.id)
  })

  it('records a final human receipt through the current run private proof', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Use the exact local receipt authority.', cwd: process.cwd() })
    const state = ownedRuns(ctx.teamRuns).get(run.teamId)
    if (state === undefined) throw new Error('created Team run was not retained')
    const internals = finalReceiptProofInternals(ctx.teamRuns)
    const proof = internals.finalReceiptProofsByRun.get(state)
    if (proof === undefined) throw new Error('created Team run did not retain a final receipt proof')
    const record = internals.finalReceiptProofs.get(proof)
    if (record === undefined) throw new Error('created Team run final receipt proof has no retained scope')
    expect(record.scope).toEqual({
      teamId: run.teamId,
      channelId: run.channel.manifest.id,
      humanId: run.recipient.id,
      coordinatorId: run.coordinator.id,
    })
    expect(Object.isFrozen(proof)).toBe(true)
    expect(Object.isFrozen(record.scope)).toBe(true)
    expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
    expect(() => structuredClone(proof)).toThrow()

    const final = await postFinal(ctx, run)
    const acknowledge = vi.spyOn(ctx.teams, 'ackChannelEnvelope')
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({ envelopeId: final.id })
    const receiptCalls = acknowledge.mock.calls as unknown as readonly (readonly unknown[])[]
    const receipt = receiptCalls[0]?.[0]
    expect(receipt).toEqual(expect.objectContaining({
      actor: proof,
      channelId: run.channel.manifest.id,
      envelopeId: final.id,
    }))
    expect(typeof (receipt as { readonly expectedCursor?: unknown }).expectedCursor).toBe('number')
    expect(receipt).not.toHaveProperty('participantId')
    expect(receipt).not.toHaveProperty('activationId')
    expect(receipt).not.toHaveProperty('sessionId')
  })

  it('uses one ephemeral Team-run completion proof before local release', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Complete through a source-owned closure proof.', cwd: process.cwd() })
    const final = await postFinal(ctx, run)
    const internals = closureProofInternals(ctx.teamRuns)
    const completeTeam = ctx.teams.completeTeam.bind(ctx.teams)
    const dispose = vi.spyOn(run.coordinatorLease, 'dispose')
    const quiesce = vi.spyOn(ctx.teams, 'transitionTeamPhase')
    const finalization = vi.spyOn(ctx.teams, 'closeTeamFinalizationChannel')
    let proof: TeamSystemClosureProof | undefined
    const complete = vi.spyOn(ctx.teams, 'completeTeam').mockImplementation(async (request) => {
      expect(dispose).not.toHaveBeenCalled()
      proof = request.actor as TeamSystemClosureProof
      const record = internals.closureProofs.get(proof)
      expect(record?.scope).toEqual({
        kind: 'team-run-complete',
        teamId: run.teamId,
        channelId: run.channel.manifest.id,
        humanId: run.recipient.id,
        coordinatorId: run.coordinator.id,
        finalEnvelopeId: final.id,
      })
      expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
      expect(() => structuredClone(proof)).toThrow()
      return await completeTeam(request)
    })
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({ envelopeId: final.id })
    if (proof === undefined) throw new Error('Team-run did not submit a completion proof')
    expect(internals.closureProofs.get(proof)).toBeUndefined()
    expect(quiesce).not.toHaveBeenCalled()
    expect(finalization).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledOnce()
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
      team: { closure: { actor: { kind: 'system', name: 'team-run' } } },
    })
  })

  it('retains terminal completion ownership without reconstructing it after a new service starts', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Archive a locally completed Team.', cwd: process.cwd() })
    await postFinal(ctx, run)
    await ctx.teamRuns.waitForFinal({ teamId: run.teamId })
    const terminal = await ctx.teams.getTeam({ teamId: run.teamId })
    expect(terminal.team.phase).toBe('completed')
    expect(archiveProofInternals(ctx.teamRuns).terminalArchiveOwners.get(run.teamId)).toEqual({ teamId: run.teamId })
    const archived = await ctx.teamRuns.archiveTerminal({ teamId: run.teamId, expectedCursor: terminal.team.cursor })
    expect(archived.team.archivedAt).toBeTypeOf('number')

    const detached = await setup()
    await expect(detached.teamRuns.archiveTerminal({ teamId: run.teamId, expectedCursor: terminal.team.cursor }))
      .rejects.toMatchObject({ code: 'TEAM_RUN_NOT_FOUND' })
  })

  it('uses completion-specific finalization proofs for the final and every auxiliary channel', async () => {
    const ctx = await setup(true, {}, new ReplyAdapter(), false)
    const run = await ctx.teamRuns.create({ objective: 'Close every completed Team channel narrowly.', cwd: process.cwd() })
    const state = await ctx.teams.getTeam({ teamId: run.teamId })
    const auxiliary = await openTestChannel(ctx, {
      teamId: run.teamId,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 3 },
      participants: [{ id: run.recipient.id, role: 'human' }, { id: run.coordinator.id, role: 'coordinator' }],
      limits: {},
    })
    const final = await postFinal(ctx, run)
    const close = vi.spyOn(ctx.teams, 'closeTeamFinalizationChannel')
    const genericClose = vi.spyOn(ctx.teams, 'closeChannel')
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({ envelopeId: final.id })
    expect(genericClose).not.toHaveBeenCalled()
    expect(close.mock.calls.map(([request]) => ({
      channelId: request.channelId,
      finalChannelId: request.finalChannelId,
      finalEnvelopeId: request.finalEnvelopeId,
      reason: request.reason,
    }))).toEqual([
      {
        channelId: run.channel.manifest.id,
        finalChannelId: run.channel.manifest.id,
        finalEnvelopeId: final.id,
        reason: 'Team completed',
      },
      {
        channelId: auxiliary.manifest.id,
        finalChannelId: run.channel.manifest.id,
        finalEnvelopeId: final.id,
        reason: 'parent Team completed',
      },
    ])
    const firstCleanup = close.mock.calls[0]?.[0]
    if (firstCleanup === undefined) throw new Error('TeamRun did not close the final channel')
    expect(() => JSON.stringify(firstCleanup.actor)).toThrow('runtime-only')
    await expect(ctx.teams.closeTeamFinalizationChannel(firstCleanup))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })

  it.each(['TEAM_CHANNEL_CURSOR_CONFLICT', 'TEAM_ACTOR_PROOF_INVALID'] as const)(
    'retries finalization channel cleanup after a transient %s', async (code) => {
      const ctx = await setup(true, { receiptRetryAttempts: 2 }, new ReplyAdapter(), false)
      const run = await ctx.teamRuns.create({ objective: 'Retry finalization channel cleanup.', cwd: process.cwd() })
      const final = await postFinal(ctx, run)
      const closeChannel = ctx.teams.closeTeamFinalizationChannel.bind(ctx.teams)
      const close = vi.spyOn(ctx.teams, 'closeTeamFinalizationChannel')
        .mockRejectedValueOnce(new TeamError('channel cleanup authority changed', code))
        .mockImplementation(async request => await closeChannel(request))

      await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({ envelopeId: final.id })
      expect(close).toHaveBeenCalledTimes(2)
      await expect(ctx.teams.getChannel({ channelId: run.channel.manifest.id })).resolves.toMatchObject({ phase: 'closed' })
      await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { closure: { kind: 'complete' } } })
    })

  it('retains completion intent when finalization channel cleanup exhausts its retry limit', async () => {
    const ctx = await setup(true, { receiptRetryAttempts: 2 }, new ReplyAdapter(), false)
    const run = await ctx.teamRuns.create({ objective: 'Report finalization cleanup exhaustion.', cwd: process.cwd() })
    const final = await postFinal(ctx, run)
    const close = vi.spyOn(ctx.teams, 'closeTeamFinalizationChannel')
      .mockRejectedValue(new TeamError('channel remains contended', 'TEAM_CHANNEL_CURSOR_CONFLICT'))

    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId }))
      .rejects.toMatchObject({ code: 'TEAM_RUN_NOT_QUIESCENT' })
    expect(close).toHaveBeenCalledTimes(2)
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
      team: { closure: { kind: 'complete', finalEnvelopeId: final.id } },
    })
    await expect(ctx.teams.getChannel({ channelId: run.channel.manifest.id })).resolves.toMatchObject({ phase: 'active' })
    close.mockRestore()
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({ envelopeId: final.id })
    await expect(ctx.teams.getChannel({ channelId: run.channel.manifest.id })).resolves.toMatchObject({ phase: 'closed' })
  })

  for (const rejection of ['paused', 'blocked', 'unfinished', 'policy-denied'] as const) {
    it(`does not reserve a final sink after ${rejection} completion rejection and accepts a later eligible final`, async () => {
      const ctx = await setup()
      const run = await ctx.teamRuns.create({ objective: 'Keep rejected finals retryable.', cwd: process.cwd() })
      const issuer = ctx.teams.openActivationActorProofIssuer()
      const authority = issuer.issue(run.coordinatorLease.binding)
      let unblock = (): void => {}
      let unfinished: TeamTaskSnapshot | undefined
      try {
        if (rejection === 'paused' || rejection === 'blocked') {
          await ctx.teams.transitionTeamGoalPhase({ actor: authority.proof, teamId: run.teamId,
            expectedRevision: 1, phase: rejection,
            ...rejection === 'blocked' ? { blocker: { code: 'AWAIT_INPUT', message: 'Required input is missing.' } } : {} })
        } else if (rejection === 'unfinished') {
          const state = await ctx.teams.getTeam({ teamId: run.teamId })
          unfinished = await ctx.teams.createTask({ actor: authority.proof, teamId: run.teamId, expectedCursor: state.team.cursor,
            createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('unfinished-final-task') },
            subject: 'Unfinished work', description: 'This work prevents completion.', blockedBy: [], requiredCapabilities: [],
            priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 })
        } else {
          unblock = ctx.teams.registerPolicy('close', { name: 'reject-ineligible-final',
            async apply() { return { kind: 'deny', code: 'FINAL_REVIEW_REQUIRED', message: 'Final review is required.' } } })
        }
        const rejected = await postFinal(ctx, run, 'Unaccepted result.')
        await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toThrow()
        const before = await ctx.teams.getTeam({ teamId: run.teamId })
        expect(before.team.closure).toBeUndefined()
        const audit = await ctx.teams.readAudit({ teamId: run.teamId, afterCursor: -1, limit: 128 })
        expect(audit.items.filter(item => item.type === 'team/final-admitted')).toHaveLength(0)
        unblock()
        if (rejection === 'paused' || rejection === 'blocked') {
          await ctx.teams.transitionTeamGoalPhase({ actor: authority.proof, teamId: run.teamId,
            expectedRevision: before.team.goal.revision, phase: 'active' })
        }
        if (unfinished !== undefined) {
          await ctx.teams.deleteTask({ actor: authority.proof, teamId: run.teamId,
            taskId: unfinished.id, expectedRevision: unfinished.revision })
        }
        const accepted = await postFinal(ctx, run, 'Eligible replacement result.', 'eligible-final')
        await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId, afterCursor: rejected.sequence }))
          .resolves.toMatchObject({ envelopeId: accepted.id, text: 'Eligible replacement result.' })
        const after = await ctx.teams.readAudit({ teamId: run.teamId, afterCursor: -1, limit: 128 })
        expect(after.items.filter(item => item.type === 'team/final-admitted'))
          .toMatchObject([{ facts: { admission: { envelopeId: accepted.id } } }])
      } finally { unblock(); authority.revoke(); issuer.close() }
    })
  }

  it('persists completion intent before accepting local final settlement', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Fence late channel admission.', cwd: process.cwd() })
    await postFinal(ctx, run)
    const acknowledge = ctx.teams.ackChannelEnvelope.bind(ctx.teams)
    const receipt = vi.spyOn(ctx.teams, 'ackChannelEnvelope').mockImplementation(async (request) => {
      await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
        team: { closure: { kind: 'complete' } },
      })
      return await acknowledge(request)
    })
    const settling = ctx.teamRuns.waitForFinal({ teamId: run.teamId })
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
        team: { closure: { kind: 'complete' } },
      })
    })
    const current = await ctx.teams.getTeam({ teamId: run.teamId })
    await expect(openTestChannel(ctx, {
      teamId: run.teamId,
      expectedCursor: current.team.cursor,
      adapter: { type: 'direct', version: 3 },
      participants: [{ id: run.recipient.id, role: 'human' }, { id: run.coordinator.id, role: 'coordinator' }],
      limits: {},
    })).rejects.toThrow()
    await expect(settling).resolves.toMatchObject({ teamId: run.teamId })
    expect(receipt).toHaveBeenCalledOnce()
  })

  it('does not replace an accepted completion intent with cancellation', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Cancel a racing final result.', cwd: process.cwd() })
    await postFinal(ctx, run)
    const cleanupEntered = Promise.withResolvers<undefined>()
    const releaseCleanup = Promise.withResolvers<undefined>()
    const unregister = ctx.teams.registerPolicy('close', {
      name: 'hold-finalization-cleanup-for-cancel',
      async apply(request, next) {
        if (request.facts.operation !== 'closure-driver-completion-channel-close') return await next()
        cleanupEntered.resolve(undefined)
        await releaseCleanup.promise
        return await next()
      },
    })
    try {
      const settling = ctx.teamRuns.waitForFinal({ teamId: run.teamId })
      await cleanupEntered.promise
      const cancelling = ctx.teamRuns.cancel(run.teamId)
      releaseCleanup.resolve(undefined)
      await expect(cancelling).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_QUIESCENT' })
      await expect(settling).resolves.toMatchObject({ teamId: run.teamId })
      await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'completed' } })
    } finally {
      unregister()
    }
  })

  it('fails closed instead of receipting a final after this TeamRun lost the current run state', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Reject a detached final receipt.', cwd: process.cwd() })
    const final = await postFinal(ctx, run)
    const runs = ownedRuns(ctx.teamRuns)
    const state = runs.get(run.teamId)
    if (state === undefined) throw new Error('created Team run was not retained')
    const internals = finalReceiptProofInternals(ctx.teamRuns)
    const proof = internals.finalReceiptProofsByRun.get(state)
    if (proof === undefined) throw new Error('created Team run did not retain a final receipt proof')
    runs.delete(run.teamId)
    try {
      await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toMatchObject({
        code: 'TEAM_RUN_NOT_FOUND',
      })
      const current = await ctx.teams.getChannel({ channelId: run.channel.manifest.id })
      await expect(ctx.teams.ackChannelEnvelope({
        actor: proof,
        channelId: current.manifest.id,
        envelopeId: final.id,
        expectedCursor: current.cursor,
      })).rejects.toMatchObject({
        code: 'TEAM_ACTOR_PROOF_INVALID',
      })
      const channel = await ctx.teams.readChannel({ channelId: run.channel.manifest.id, afterCursor: -1 })
      expect(channel.records.some(record => record.type === 'channel/receipt' && record.envelopeId === final.id)).toBe(false)
    } finally {
      runs.set(run.teamId, state)
    }
  })

  it('preserves a final receipt error when retry cannot establish a fresh cursor', async () => {
    const ctx = await setup(true, { receiptRetryAttempts: 1 })
    const run = await ctx.teamRuns.create({ objective: 'Do not hide receipt failure.', cwd: process.cwd() })
    await postFinal(ctx, run)
    vi.spyOn(ctx.teams, 'ackChannelEnvelope').mockRejectedValue(new TeamError('invalid recipient', 'TEAM_CHANNEL_NOT_FOUND'))
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toMatchObject({
      code: 'TEAM_CHANNEL_NOT_FOUND',
    })
  })

  it('refuses final settlement when the coordinator is no longer locally resident', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Require coordinator residency.', cwd: process.cwd() })
    await postFinal(ctx, run)
    const state = ownedRuns(ctx.teamRuns).get(run.teamId)
    if (state === undefined) throw new Error('created Team run was not retained')
    ownedRuns(ctx.teamRuns).set(run.teamId, {
      ...state,
      handle: { ...state.handle, coordinatorLease: leaseWithoutLocalAgent(state.handle.coordinatorLease) },
    })
    await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).rejects.toMatchObject({
      code: 'TEAM_RUN_NOT_QUIESCENT',
    })
  })

  it('refuses completion when the retained lease loses its local Agent after final receipt', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Lose local residency during completion.', cwd: process.cwd() })
    const state = ownedRuns(ctx.teamRuns).get(run.teamId)
    if (state === undefined) throw new Error('created Team run was not retained')
    const internals = ctx.teamRuns as unknown as { complete(state: TestRunState): Promise<void> }
    await expect(internals.complete({
      ...state,
      handle: { ...state.handle, coordinatorLease: leaseWithoutLocalAgent(state.handle.coordinatorLease) },
    })).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_QUIESCENT' })
  })

  it('requires every default-channel recipient to have no pending delivery before completion', async () => {
    const ctx = await setup(true, {}, new ReplyAdapter(), false)
    const coordinatorPending = await ctx.teamRuns.create({ objective: 'Check coordinator delivery.', cwd: process.cwd() })
    const coordinatorFinal = await postFinal(ctx, coordinatorPending)
    const listCoordinatorPending = ctx.teams.listChannelPendingDeliveries.bind(ctx.teams)
    const pendingCoordinator = vi.spyOn(ctx.teams, 'listChannelPendingDeliveries').mockImplementation(async (request) => {
      const page = await listCoordinatorPending(request)
      if (request.participantId !== coordinatorPending.coordinator.id) return page
      return { ...page, deliveries: [{ envelope: coordinatorFinal, delivery: 'context' }] }
    })
    await expect(ctx.teamRuns.waitForFinal({ teamId: coordinatorPending.teamId })).rejects.toMatchObject({
      code: 'TEAM_RUN_NOT_QUIESCENT',
    })
    pendingCoordinator.mockRestore()
    await expect(ctx.teamRuns.cancel(coordinatorPending.teamId)).rejects.toMatchObject({ code: 'TEAM_CLOSURE_IDEMPOTENCY_CONFLICT' })

    const humanPending = await ctx.teamRuns.create({ objective: 'Check human delivery.', cwd: process.cwd() })
    const humanFinal = await postFinal(ctx, humanPending)
    const listHumanPending = ctx.teams.listChannelPendingDeliveries.bind(ctx.teams)
    vi.spyOn(ctx.teams, 'listChannelPendingDeliveries').mockImplementation(async (request) => {
      const page = await listHumanPending(request)
      if (request.participantId !== humanPending.recipient.id) return page
      return { ...page, deliveries: [{ envelope: humanFinal, delivery: 'context' }] }
    })
    await expect(ctx.teamRuns.waitForFinal({ teamId: humanPending.teamId })).rejects.toMatchObject({
      code: 'TEAM_RUN_NOT_QUIESCENT',
    })
  })

  it('settles a quiescing projection and does not rewrite an already completed projection', async () => {
    const ctx = await setup(true, {}, new ReplyAdapter(), false)
    const settleFrom = async (phase: 'quiescing' | 'completed') => {
      const run = await ctx.teamRuns.create({ objective: `Settle ${phase} projection.`, cwd: process.cwd() })
      await postFinal(ctx, run)
      const getTeam = ctx.teams.getTeam.bind(ctx.teams)
      const listPending = ctx.teams.listChannelPendingDeliveries.bind(ctx.teams)
      const completeTeam = ctx.teams.completeTeam.bind(ctx.teams)
      let pendingReads = 0
      let projectPhase = false
      const getTeamSpy = vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
        const state = await getTeam(request)
        if (!projectPhase) return state
        return { ...state, team: { ...state.team, phase } }
      })
      const listPendingSpy = vi.spyOn(ctx.teams, 'listChannelPendingDeliveries').mockImplementation(async (request) => {
        const page = await listPending(request)
        pendingReads += 1
        if (pendingReads === 2) projectPhase = true
        return page
      })
      const completeTeamSpy = vi.spyOn(ctx.teams, 'completeTeam').mockImplementation(async request => await completeTeam(request))
      try {
        await expect(ctx.teamRuns.waitForFinal({ teamId: run.teamId })).resolves.toMatchObject({ text: 'The review is complete.' })
        if (phase === 'quiescing') {
          const completion = completeTeamSpy.mock.calls[0]?.[0]
          expect(completion?.reason.code).toBe('FINAL_ANSWER_ACCEPTED')
        } else {
          expect(completeTeamSpy).toHaveBeenCalledOnce()
        }
      } finally {
        completeTeamSpy.mockRestore()
        listPendingSpy.mockRestore()
        getTeamSpy.mockRestore()
      }
    }
    await settleFrom('quiescing')
    await settleFrom('completed')
  })

  it('closes once, releases owned local leases, and rejects further product work', async () => {
    const ctx = await setup()
    const run = await ctx.teamRuns.create({ objective: 'Dispose a local run.', cwd: process.cwd() })
    const state = ownedRuns(ctx.teamRuns).get(run.teamId)
    if (state === undefined) throw new Error('created Team run was not retained')
    const internals = finalReceiptProofInternals(ctx.teamRuns)
    const proof = internals.finalReceiptProofsByRun.get(state)
    if (proof === undefined) throw new Error('created Team run did not retain a final receipt proof')
    const first = ctx.teamRuns.close()
    const second = ctx.teamRuns.close()
    expect(second).toBe(first)
    await first
    expect(internals.finalReceiptProofs.get(proof)).toBeUndefined()
    expect(internals.finalReceiptProofsByRun.get(state)).toBeUndefined()
    await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'active' } })
    await expect(ctx.teamRuns.postHumanInput({ teamId: run.teamId, content: [{ type: 'text', text: 'Too late.' }] })).rejects.toMatchObject({
      code: 'TEAM_RUN_DISPOSED',
    })
  })

  it('exposes an explicit function-plugin disposer', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    try {
      await ctx.plugin(Storage)
      await ctx.plugin(StorageJson, { root: join(root, 'bare-hub') })
      await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
      await ctx.plugin(TeamHub)
      const dispose = TeamRun.apply(ctx)
      const sources = ctx.teams as unknown as {
        readonly systemFinalReceiptProofSources: Map<string, unknown>
        readonly systemEnvelopePostProofSources: Map<string, unknown>
        readonly systemClosureProofSources: Map<string, unknown>
        readonly systemPhaseProofSources: Map<string, unknown>
        readonly systemInterruptProofSources: Map<string, unknown>
        readonly systemTaskControlProofSources: Map<string, unknown>
        readonly systemRootCreationProofSources: Map<string, unknown>
        readonly systemArchiveProofSources: Map<string, unknown>
        readonly systemCancellationCleanupProofSources: Map<string, unknown>
        readonly systemFinalizationCleanupProofSources: Map<string, unknown>
        readonly systemTopologyProofSources: Map<string, unknown>
      }
      expect(sources.systemFinalReceiptProofSources.has('team-run')).toBe(true)
      expect(sources.systemEnvelopePostProofSources.has('team-run')).toBe(true)
      expect(sources.systemClosureProofSources.has('team-run')).toBe(true)
      expect(sources.systemPhaseProofSources.has('team-run')).toBe(true)
      expect(sources.systemInterruptProofSources.has('team-run')).toBe(true)
      expect(sources.systemTaskControlProofSources.has('team-run')).toBe(true)
      expect(sources.systemRootCreationProofSources.has('team-run')).toBe(true)
      expect(sources.systemArchiveProofSources.has('team-run')).toBe(true)
      expect(sources.systemCancellationCleanupProofSources.has('team-run')).toBe(true)
      expect(sources.systemFinalizationCleanupProofSources.has('team-run')).toBe(true)
      expect(sources.systemTopologyProofSources.has('team-run')).toBe(true)
      await dispose()
      expect(sources.systemFinalReceiptProofSources.has('team-run')).toBe(false)
      expect(sources.systemEnvelopePostProofSources.has('team-run')).toBe(false)
      expect(sources.systemClosureProofSources.has('team-run')).toBe(false)
      expect(sources.systemPhaseProofSources.has('team-run')).toBe(false)
      expect(sources.systemInterruptProofSources.has('team-run')).toBe(false)
      expect(sources.systemTaskControlProofSources.has('team-run')).toBe(false)
      expect(sources.systemRootCreationProofSources.has('team-run')).toBe(false)
      expect(sources.systemArchiveProofSources.has('team-run')).toBe(false)
      expect(sources.systemCancellationCleanupProofSources.has('team-run')).toBe(false)
      expect(sources.systemFinalizationCleanupProofSources.has('team-run')).toBe(false)
      expect(sources.systemTopologyProofSources.has('team-run')).toBe(false)
      await expect(ctx.teamRuns.create({ objective: 'Closed bare owner.', cwd: process.cwd() })).rejects.toMatchObject({
        code: 'TEAM_RUN_DISPOSED',
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('aggregates failures that occur while closing owned local leases', async () => {
    const ctx = new Context()
    ctx.provide('teams', { registerSystemChannelAdmissionProofSource: () => () => {},
      registerSystemChannelLifecycleProofSource: () => () => {}, registerSystemChildResultProofSource: () => () => {},
    } as unknown as Context['teams'])
    try {
      const service = new TeamRun.TeamRunService(ctx)
      const teamId = 'disposal-failure' as TeamId
      const releaseFailure = new Error('lease disposal failed')
      const disposePrompt = vi.fn()
      const disposeLease = vi.fn<() => Promise<void>>().mockRejectedValue(releaseFailure)
      ownedRuns(service).set(teamId, {
        config: { receiptRetryAttempts: 1 },
        handle: {
          teamId,
          coordinatorLease: { dispose: disposeLease } as unknown as TeamActivationLease,
        } as TeamRun.TeamRunHandle,
        disposePrompt,
        memberStates: new Map(),
        workerStates: new Map(),
        workerActivations: new Map(),
      })
      await expect(service.close()).rejects.toMatchObject({ errors: [releaseFailure] })
      expect(disposePrompt).toHaveBeenCalledOnce()
      await expect(service.cancel(teamId)).rejects.toMatchObject({ code: 'TEAM_RUN_DISPOSED' })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

/** Reserve a real child and retain only the parent's scoped startup authority. */
async function reservedChild(childModel: LlmAdapter = new ReplyAdapter(), options: {
  readonly member?: TeamRun.TeamRunMember
  readonly withClosureDriver?: boolean
} = {}) {
  const model = new GateAdapter()
  try {
    const config: TeamRun.Config = { templateId: 'fixture', workerCount: 0, maxWorkerCount: 0,
      ...options.member === undefined ? {} : { members: [options.member] } }
    const ctx = await setup(true, config, model, options.withClosureDriver ?? true,
      { maxTeamDepth: 2 })
    const basic = await import('@clocky/clocky-team-channel-basic')
    await ctx.plugin(basic)
    const { createTestChildTeam } = await import('../../../core/team/tests/bootstrap-topology-authority.ts')
    const cwd = await freshRoot()
    const parent = await ctx.teamRuns.create({ objective: 'Own one child', cwd })
    await ctx.teamRuns.postHumanInput({ teamId: parent.teamId, content: [{ type: 'text', text: 'Delegate the work' }] })
    await model.started.promise
    const coordinator = parent.coordinatorLease.localAgent!
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const accepted = await ctx.agents.withInitiator(coordinator, () => ctx.teamRuns.startDelegatedTask(authority, {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('child-runtime'), subject: 'Child task',
      instructions: 'Perform the child task', readScopes: [], writeScopes: [], budget: {},
    }))
    const task = await ctx.teams.getTask({ teamId: parent.teamId, taskId: accepted.id })
    if (task.execution.kind !== 'child-team' || task.delegation === undefined) throw new Error('Fixture child task missing')
    const proofs = new Map<import('@clocky/clocky-team').TeamSystemDelegationProof, import('@clocky/clocky-team').TeamSystemDelegationScope>()
    ctx.teams.registerSystemDelegationProofSource({ name: 'team-delegation', resolveDelegationProof: proof => proofs.get(proof),
      resolveChildWorkspace: async () => cwd })
    const issue = (scope: import('@clocky/clocky-team').TeamSystemDelegationScope) => {
      const proof = Object.freeze({}) as import('@clocky/clocky-team').TeamSystemDelegationProof
      proofs.set(proof, scope)
      return proof
    }
    const current = async () => {
      const state = await ctx.teams.getTeam({ teamId: parent.teamId })
      const latest = state.tasks.find(candidate => candidate.id === task.id)!
      return { teamId: parent.teamId, taskId: task.id, expectedCursor: state.team.cursor,
        expectedRevision: latest.revision, delegationId: task.delegation!.id }
    }
    const childModelRegistration = ctx.llm.registerAdapter(['child-fixture'], childModel)
    const template = ctx.teamRuns.describeChildTemplate('fixture', 1)
    const runtime = jsonObjectSchema.parse(template['childRuntime'])
    const begin = { ...await current(), child: { goal: { objective: task.description, budgets: {} },
      rules: { ...template, childRuntime: { ...runtime, selection: { provider: 'child-fixture', model: 'mock' } }, workspacePath: cwd },
      budgets: {}, authorityGrant: task.execution.authorityGrant } }
    const reserved = await ctx.teams.beginTaskDelegation({ ...begin, actor: issue({ kind: 'delegation-begin', ...begin }) })
    const child = await createTestChildTeam(ctx, reserved.delegation!.creation!)
    const input = { ...await current(), childTeamId: child.team.id }
    await ctx.teams.bindTaskDelegation({ ...input, actor: issue({ kind: 'delegation-bind', ...input }) })
    const scope = { kind: 'delegation-authorize-run' as const, ...await current(), operation: 'start' as const }
    const actor = issue(scope)
    const authorization = await ctx.teams.authorizeChildRun({ ...await current(), operation: 'start', actor })
    const request = { parentTeamId: parent.teamId, parentTaskId: task.id, childTeamId: child.team.id,
      delegationId: task.delegation.id, authorization }
    return { ctx, parent, child, request, actor, scope, model, proofs, issue, current, config, childModelRegistration,
      cancelParent: () => ctx.agents.withInitiator(coordinator,
        () => ctx.teamRuns.cancelDefaultWorkerTask(authority, { taskId: task.id })) }
  } catch (error: unknown) { model.release.resolve(undefined); throw error }
}

describe('reserved child runtime ownership', () => {
  it('coalesces concurrent startup and retains one durable endpoint binding', async () => {
    const { ctx, child, request, model } = await reservedChild()
    try {
      const open = vi.spyOn(ctx.teams, 'openChannel')
      const [first, second] = await Promise.all([ctx.teamRuns.startChild(request), ctx.teamRuns.startChild(request)])
      expect(second).toEqual(first)
      expect(await ctx.teamRuns.startChild(request)).toEqual(first)
      const current = await ctx.teams.getTeam({ teamId: child.team.id })
      expect(current.team.childRun).toEqual(first)
      expect(current.participants.map(member => member.role).sort()).toEqual(['coordinator', 'parent-service'])
      expect(current.activations).toHaveLength(1)
      expect(current.channelIds).toEqual([first.channelId])
      await expect(ctx.teamRuns.postHumanInput({ teamId: child.team.id,
        content: [{ type: 'text', text: 'A parent service cannot impersonate a human endpoint.' }],
      })).rejects.toMatchObject({ code: 'TEAM_RUN_NOT_FOUND' })
      const resultChannel = open.mock.calls.find(([input]) => input.teamId === child.team.id
        && input.adapter.type === 'consult')?.[0]
      if (resultChannel === undefined) throw new Error('Child did not open its result channel')
      expect(() => JSON.stringify(resultChannel.actor)).toThrow('runtime-only')
      await expect(ctx.teams.openChannel({ ...resultChannel, expectedCursor: current.team.cursor }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    } finally { model.release.resolve(undefined); request.authorization.close() }
  })
})

it('cancels one child under fresh parent authority after releasing its execution lease', async () => {
  const f = await reservedChild()
  try {
    const binding = await f.ctx.teamRuns.startChild(f.request)
    await f.cancelParent()
    const input = { ...await f.current(), operation: 'cancel' as const }
    const authorization = await f.ctx.teams.authorizeChildRun({ ...input, actor: f.issue({ kind: 'delegation-authorize-run', ...input }) })
    try {
      let stopped = await f.ctx.teamRuns.cancelChild({ ...f.request, authorization })
      expect(stopped.team.cancellation).toMatchObject({ reason: { code: 'PARENT_DELEGATION_CANCELLED' } })
      await vi.waitFor(async () => {
        stopped = await f.ctx.teamRuns.cancelChild({ ...f.request, authorization })
        expect(stopped.team.phase).toBe('cancelled')
      })
      expect(stopped.team.childRun).toEqual(binding)
      expect(stopped.activations.every(value => value.activation.status === 'offline' && value.quiescedAt !== undefined)).toBe(true)
      expect((await f.ctx.teamRuns.cancelChild({ ...f.request, authorization })).team.phase).toBe('cancelled')
    } finally { authorization.close() }
  } finally { f.model.release.resolve(undefined); f.request.authorization.close() }
})

it.each(['missing', 'partial', 'invalid'] as const)('rejects %s frozen child runtime configuration before publishing resources', async (variant) => {
  const f = await reservedChild()
  const read = f.ctx.teams.getTeam.bind(f.ctx.teams)
  const fault = vi.spyOn(f.ctx.teams, 'getTeam').mockImplementation(async (request) => {
    const state = await read(request)
    if (request.teamId !== f.child.team.id) return state
    return { ...state, rules: { ...state.rules, childRuntime: variant === 'missing' ? null : {
      config: variant === 'partial' ? {} : { workerCount: -1 }, selection: { provider: 'mock', model: 'mock' },
    } } }
  })
  try {
    await expect(f.ctx.teamRuns.startChild(f.request)).rejects.toThrow()
    fault.mockRestore()
    const state = await read({ teamId: f.child.team.id })
    expect(state.participants).toEqual([])
    expect(state.activations).toEqual([])
    expect(state.channelIds).toEqual([])
    expect((await f.ctx.teamRuns.startChild(f.request)).childTeamId).toBe(f.child.team.id)
  } finally { fault.mockRestore(); f.model.release.resolve(undefined); f.request.authorization.close() }
})

it('retries child result-channel creation after a provider opening failure', async () => {
  const f = await reservedChild()
  const failure = new Error('result channel storage unavailable')
  const fault = vi.spyOn(f.ctx.teams, 'openChannel').mockImplementationOnce(async () => { throw failure })
  try {
    await expect(f.ctx.teamRuns.startChild(f.request)).rejects.toBe(failure)
    expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).channelIds).toEqual([])
    fault.mockRestore()
    const binding = await f.ctx.teamRuns.startChild(f.request)
    expect(binding.childTeamId).toBe(f.child.team.id)
    expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).channelIds).toEqual([binding.channelId])
  } finally {
    fault.mockRestore()
    f.model.release.resolve(undefined)
    f.request.authorization.close()
  }
})

it('reuses a child result channel whose durable open committed before the reply failed', async () => {
  const f = await reservedChild()
  const open = f.ctx.teams.openChannel.bind(f.ctx.teams)
  const failure = new Error('result channel reply lost after commit')
  const fault = vi.spyOn(f.ctx.teams, 'openChannel').mockImplementationOnce(async (request) => {
    await open(request)
    throw failure
  })
  try {
    await expect(f.ctx.teamRuns.startChild(f.request)).rejects.toBe(failure)
    const committed = await f.ctx.teams.getTeam({ teamId: f.child.team.id })
    expect(committed.channelIds).toHaveLength(1)
    fault.mockRestore()
    const binding = await f.ctx.teamRuns.startChild(f.request)
    expect(binding.channelId).toBe(committed.channelIds[0])
    expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).channelIds).toEqual(committed.channelIds)
  } finally {
    fault.mockRestore()
    f.model.release.resolve(undefined)
    f.request.authorization.close()
  }
})

it('drains cancelled child startup before acknowledging cancellation', async () => {
  const f = await reservedChild()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const activate = f.ctx.teamActivations.activate.bind(f.ctx.teamActivations)
  const hold = vi.spyOn(f.ctx.teamActivations, 'activate').mockImplementation(async (request) => {
    if (request.teamId === f.child.team.id) { entered.resolve(undefined); await release.promise }
    return await activate(request)
  })
  let authorization: typeof f.request.authorization | undefined
  try {
    const starting = f.ctx.teamRuns.startChild(f.request)
    const rejected = expect(starting).rejects.toThrow()
    await entered.promise
    await f.cancelParent()
    const input = { ...await f.current(), operation: 'cancel' as const }
    authorization = await f.ctx.teams.authorizeChildRun({ ...input, actor: f.issue({ kind: 'delegation-authorize-run', ...input }) })
    let settled = false
    const cancelling = f.ctx.teamRuns.cancelChild({ ...f.request, authorization }).then((result) => { settled = true; return result })
    await vi.waitFor(async () => { expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).team.cancellation).toBeDefined() })
    expect(settled).toBe(false)
    release.resolve(undefined)
    await rejected
    expect((await cancelling).team.phase).toBe('cancelled')
    expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).activations).toEqual([])
  } finally {
    release.resolve(undefined); hold.mockRestore(); authorization?.close()
    f.model.release.resolve(undefined); f.request.authorization.close()
  }
})

it('recovers a stopped child with the same participants, channel and Session', async () => {
  const f = await reservedChild()
  try {
    const first = await f.ctx.teamRuns.startChild(f.request)
    const owner = ownedRuns(f.ctx.teamRuns).get(f.child.team.id)!
    const previous = owner.handle.coordinatorLease.binding
    await topologyReleaseInternals(f.ctx.teamRuns).releaseRun(owner)
    ownedRuns(f.ctx.teamRuns).delete(f.child.team.id)
    expect(await f.ctx.teamRuns.startChild(f.request)).toEqual(first)
    const current = await f.ctx.teams.getTeam({ teamId: f.child.team.id })
    expect(current.participants).toHaveLength(2)
    expect(current.channelIds).toEqual([first.channelId])
    expect(current.activations).toHaveLength(2)
    expect(current.activations[0]).toMatchObject({ activation: { id: previous.activation.id, status: 'offline' } })
    expect(current.activations[1]).toMatchObject({ sessionId: previous.sessionId, activation: { status: 'idle' } })
    expect(current.activations[1]!.activation.id).not.toBe(previous.activation.id)
  } finally { f.model.release.resolve(undefined); f.request.authorization.close() }
})

it('rebuilds child coordinator task and workflow ownership from durable Team state after plugin remount', async () => {
  const childModel = new GateAdapter()
  const member: TeamRun.TeamRunMember = { role: 'builder', displayName: 'Builder', kind: 'local-agent',
    capabilities: [], provider: 'in-process', modelProvider: 'mock', model: 'mock', maxTokens: 128 }
  const f = await reservedChild(childModel, { member, withClosureDriver: false })
  try {
    const first = await f.ctx.teamRuns.startChild(f.request)
    const initial = await f.ctx.teams.getTeam({ teamId: f.child.team.id })
    const coordinatorBinding = initial.activations.findLast(binding => binding.activation.participantId === first.coordinatorId)
    const coordinator = coordinatorBinding === undefined ? undefined : f.ctx.agents.get(coordinatorBinding.sessionId)
    if (coordinator === undefined) throw new Error('Child coordinator did not publish a local Agent')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Prepare durable child work.' }], source: { kind: 'user' } }))
    await childModel.started.promise
    const authority = f.ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const nested = await f.ctx.agents.withInitiator(coordinator, async () => await f.ctx.teamRuns.startDelegatedTask(authority, {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('cold-child-owned-task'),
      subject: 'Nested pending work', instructions: 'Retain this task after restart.',
      readScopes: [], writeScopes: [], budget: {},
    }))
    const base = workflowPlan(1, ['builder'])
    const plan = teamWorkflowPlanSchema.parse({ ...base, tasks: base.tasks.map(task => ({
      ...task, requiredCapabilities: [],
    })) })
    const workflow = await f.ctx.agents.withInitiator(coordinator, async () => await f.ctx.teamRuns.startWorkflowPlan(authority, {
      idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('cold-child-owned-workflow'), plan,
    }))
    childModel.release.resolve(undefined)
    f.model.release.resolve(undefined)
    await coordinator.whenIdle()
    await f.parent.coordinatorLease.localAgent?.whenIdle()
    const runtime = f.ctx.registry.get(TeamRun)
    if (runtime === undefined) throw new Error('TeamRun plugin is not mounted')
    for (const fiber of [...runtime.fibers]) await fiber.dispose()
    await f.ctx.plugin(TeamRun, f.config)
    f.childModelRegistration.replace([])
    const resumedModel = new GateAdapter()
    f.ctx.llm.registerAdapter(['child-fixture'], resumedModel)

    const recovered = await f.ctx.teamRuns.startChild(f.request)
    expect(recovered).toEqual(first)
    const state = await f.ctx.teams.getTeam({ teamId: f.child.team.id })
    expect(state.tasks.filter(task => task.id === nested.id)).toHaveLength(1)
    expect(state.workflowPlans?.filter(candidate => candidate.id === workflow.id)).toHaveLength(1)
    expect(state.channelIds.filter(channelId => channelId === first.channelId)).toHaveLength(1)
    const epochs = state.activations.filter(binding => binding.activation.participantId === first.coordinatorId)
    expect(epochs).toHaveLength(2)
    expect(epochs[1]?.sessionId).toBe(epochs[0]?.sessionId)
    const agent = epochs[1] === undefined ? undefined : f.ctx.agents.get(epochs[1].sessionId)
    if (agent === undefined) throw new Error('Recovered child has no coordinator Agent')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue the child work.' }], source: { kind: 'user' } }))
    await resumedModel.started.promise
    try {
      const recoveredAuthority = f.ctx.teamRuns.coordinatorTaskAuthority(agent)
      const tasks = await f.ctx.agents.withInitiator(agent,
        async () => await f.ctx.teamRuns.listDefaultWorkerTasks(recoveredAuthority))
      expect(tasks.tasks.map(task => task.id)).toContain(nested.id)
      await expect(f.ctx.agents.withInitiator(agent, async () => await f.ctx.teamRuns.cancelWorkflowTask(recoveredAuthority, {
        planId: workflow.id, templateId: plan.tasks[0]!.id,
      }))).resolves.toMatchObject({ phase: 'cancelled' })
    } finally { resumedModel.release.resolve(undefined) }
  } finally {
    childModel.release.resolve(undefined)
    f.model.release.resolve(undefined)
    f.request.authorization.close()
  }
}, 15_000)

it('keeps child startup in disposal until admitted activation IO stops', async () => {
  const f = await reservedChild()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const activate = f.ctx.teamActivations.activate.bind(f.ctx.teamActivations)
  const hold = vi.spyOn(f.ctx.teamActivations, 'activate').mockImplementation(async (request) => {
    if (request.teamId === f.child.team.id) { entered.resolve(undefined); await release.promise }
    return await activate(request)
  })
  try {
    const rejected = expect(f.ctx.teamRuns.startChild(f.request)).rejects.toThrow()
    await entered.promise
    f.model.release.resolve(undefined)
    let closed = false
    const closing = f.ctx.teamRuns.close().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    release.resolve(undefined)
    await rejected
    await closing
    expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).activations).toEqual([])
    await expect(f.ctx.teamRuns.startChild(f.request)).rejects.toMatchObject({ code: 'TEAM_RUN_DISPOSED' })
  } finally { release.resolve(undefined); hold.mockRestore(); f.model.release.resolve(undefined); f.request.authorization.close() }
})

it.each(['missing-result', 'model-error'] as const)('records a child %s after its coordinator turn ends', async (outcome) => {
  const f = await reservedChild(outcome === 'model-error' ? new FailureAdapter() : new ReplyAdapter())
  const missing = vi.spyOn(f.ctx.teams, 'recordChildResultMissing')
  try {
    await f.ctx.teamRuns.startChild(f.request)
    const owner = ownedRuns(f.ctx.teamRuns).get(f.child.team.id)!
    const agent = owner.handle.coordinatorLease.localAgent!
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Perform the delegated work' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    await vi.waitFor(async () => {
      const state = await f.ctx.teams.getTeam({ teamId: f.child.team.id })
      if (outcome === 'model-error') expect(state.team.closure).toMatchObject({ kind: 'fail', reason: { code: 'SERVER' } })
      else expect(state.team.phase).toBe('stalled')
    })
    if (outcome === 'missing-result') {
      const command = missing.mock.calls[0]?.[0]
      if (command === undefined) throw new Error('Child did not record its missing result')
      expect(() => JSON.stringify(command.actor)).toThrow('runtime-only')
      await expect(f.ctx.teams.recordChildResultMissing(command))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
  } finally { f.model.release.resolve(undefined); f.request.authorization.close() }
})

it('reports child cleanup failure after a durable coordinator failure without losing the closure', async () => {
  const f = await reservedChild(new FailureAdapter())
  const activate = f.ctx.teamActivations.activate.bind(f.ctx.teamActivations)
  const cleanupFailure = new Error('child coordinator dispose reply failed')
  let failedCleanup = false
  vi.spyOn(f.ctx.teamActivations, 'activate').mockImplementation(async (request) => {
    const lease = await activate(request)
    if (request.teamId !== f.child.team.id) return lease
    return { binding: lease.binding, localAgent: lease.localAgent,
      health: () => lease.health(), interrupt: (...args) => { lease.interrupt(...args) },
      dispose: async () => {
        await lease.dispose()
        if (!failedCleanup) { failedCleanup = true; throw cleanupFailure }
      },
    }
  })
  const serviceContext = (f.ctx.teamRuns as unknown as { readonly ctx: Context }).ctx
  const warning = vi.spyOn(serviceContext.logger, 'warn').mockImplementation(() => {})
  try {
    const binding = await f.ctx.teamRuns.startChild(f.request)
    const state = await f.ctx.teams.getTeam({ teamId: f.child.team.id })
    const coordinatorBinding = state.activations.findLast(candidate => candidate.activation.participantId === binding.coordinatorId)
    const coordinator = coordinatorBinding === undefined ? undefined : f.ctx.agents.get(coordinatorBinding.sessionId)
    if (coordinator === undefined) throw new Error('Child coordinator has no local Agent')
    coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Fail the delegated work.' }], source: { kind: 'user' } }))
    await coordinator.whenIdle()
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('child cleanup remains incomplete'))
    })
    expect(failedCleanup).toBe(true)
    expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).team.closure).toMatchObject({
      kind: 'fail', reason: { code: 'SERVER' },
    })
  } finally {
    warning.mockRestore()
    f.model.release.resolve(undefined)
    f.request.authorization.close()
  }
})

it('continues a child coordinator after an output-limit turn before declaring its result missing', async () => {
  const childModel = new MaxTokensAdapter()
  const f = await reservedChild(childModel)
  try {
    await f.ctx.teamRuns.startChild(f.request)
    const owner = ownedRuns(f.ctx.teamRuns).get(f.child.team.id)!
    const agent = owner.handle.coordinatorLease.localAgent!
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Complete the delegated objective.' }], source: { kind: 'user' } }))
    await childModel.continuationStarted.promise
    expect(agent.session.events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'max-tokens')).toBe(true)
    expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).team.phase).toBe('active')
    childModel.releaseContinuation.resolve(undefined)
    await vi.waitFor(async () => {
      expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).team.phase).toBe('stalled')
    })
  } finally {
    childModel.releaseContinuation.resolve(undefined)
    f.model.release.resolve(undefined)
    f.request.authorization.close()
  }
})

it('retries a child failure after a Team cursor conflict with the same durable failure key', async () => {
  const f = await reservedChild(new FailureAdapter())
  const fail = f.ctx.teams.failTeam.bind(f.ctx.teams)
  const requests: import('@clocky/clocky-team').TeamFailRequest[] = []
  const conflict = vi.spyOn(f.ctx.teams, 'failTeam').mockImplementation(async (request) => {
    if (request.teamId === f.child.team.id) {
      requests.push(request)
      if (requests.length === 1) throw new TeamError('Concurrent activation status update', 'TEAM_CURSOR_CONFLICT')
    }
    return await fail(request)
  })
  try {
    await f.ctx.teamRuns.startChild(f.request)
    const owner = ownedRuns(f.ctx.teamRuns).get(f.child.team.id)!
    const agent = owner.handle.coordinatorLease.localAgent!
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Fail this delegated attempt' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    await vi.waitFor(async () => {
      expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).team.closure).toMatchObject({ kind: 'fail' })
    })
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(new Set(requests.map(request => request.idempotencyKey)).size).toBe(1)
    expect(requests[0]!.actor).not.toBe(requests[1]!.actor)
    await expect(fail(requests[0]!)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  } finally { conflict.mockRestore(); f.model.release.resolve(undefined); f.request.authorization.close() }
})

it.each(['replaced', 'released'] as const)('does not publish a late child failure from a %s local owner', async (lifecycle) => {
  const f = await reservedChild(new FailureAdapter())
  await f.ctx.teamRuns.startChild(f.request)
  const owner = ownedRuns(f.ctx.teamRuns).get(f.child.team.id)!
  const agent = owner.handle.coordinatorLease.localAgent!
  const read = f.ctx.teams.getTeam.bind(f.ctx.teams)
  let retired = false
  const serviceContext = (f.ctx.teamRuns as unknown as { readonly ctx: Context }).ctx
  const warning = vi.spyOn(serviceContext.logger, 'warn').mockImplementation(() => {})
  const fail = vi.spyOn(f.ctx.teams, 'failTeam')
  const retire = vi.spyOn(f.ctx.teams, 'getTeam').mockImplementation(async (request) => {
    const state = await read(request)
    if (!retired && request.teamId === f.child.team.id && agent.session.events.at(-1)?.type === 'turn/end') {
      retired = true
      if (lifecycle === 'replaced') ownedRuns(f.ctx.teamRuns).delete(f.child.team.id)
      else await topologyReleaseInternals(f.ctx.teamRuns).releaseRun(owner)
    }
    return state
  })
  try {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Fail the retired child' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    await vi.waitFor(() => { expect(warning).toHaveBeenCalled() })
    expect(retired).toBe(true)
    expect(fail).not.toHaveBeenCalled()
    expect((await read({ teamId: f.child.team.id })).team.closure).toBeUndefined()
  } finally {
    retire.mockRestore(); fail.mockRestore(); warning.mockRestore()
    if (lifecycle === 'replaced') ownedRuns(f.ctx.teamRuns).set(f.child.team.id, owner)
    f.model.release.resolve(undefined); f.request.authorization.close()
  }
})

it.each(['before-activation', 'after-activation'] as const)('drains an accepted coordinator resume %s before disposal returns', async (stage) => {
  const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0 })
  const original = await ctx.teamRuns.create({ objective: 'Drain resumed activation', cwd: process.cwd() })
  await original.coordinatorLease.dispose()
  ownedRuns(ctx.teamRuns).delete(original.teamId)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
  const hold = vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
    const lease = stage === 'after-activation' ? await activate(request) : undefined
    entered.resolve(undefined)
    await release.promise
    return lease ?? await activate(request)
  })
  const resuming = ctx.teamRuns.resume({ teamId: original.teamId, signal: new AbortController().signal })
  const rejected = expect(resuming).rejects.toThrow()
  await entered.promise
  let closed = false
  const closing = ctx.teamRuns.close().then(() => { closed = true })
  try {
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(closed).toBe(false)
  } finally {
    release.resolve(undefined)
    await rejected
    await closing
    hold.mockRestore()
  }
  const state = await ctx.teams.getTeam({ teamId: original.teamId })
  expect(state.activations.every(binding => binding.activation.status === 'offline' && binding.quiescedAt !== undefined)).toBe(true)
  expect(state.activations).toHaveLength(stage === 'before-activation' ? 1 : 2)
  expect(ctx.agents.list()).toEqual([])
})

it('selects the newest coordinator epoch before attempting another resume', async () => {
  const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0 })
  const first = await ctx.teamRuns.create({ objective: 'Keep a live successor fenced', cwd: process.cwd() })
  await first.coordinatorLease.dispose()
  ownedRuns(ctx.teamRuns).delete(first.teamId)
  const second = await ctx.teamRuns.resume({ teamId: first.teamId })
  const retained = ownedRuns(ctx.teamRuns).get(first.teamId)!
  ownedRuns(ctx.teamRuns).delete(first.teamId)
  const activate = vi.spyOn(ctx.teamActivations, 'activate')
  try {
    await expect(ctx.teamRuns.resume({ teamId: first.teamId })).rejects.toMatchObject({ code: 'TEAM_RUN_START_CONFLICT' })
    expect(activate).not.toHaveBeenCalled()
    const current = await ctx.teams.getTeam({ teamId: first.teamId })
    expect(current.activations).toHaveLength(2)
    expect(current.activations[1]!.activation.id).toBe(second.coordinatorLease.binding.activation.id)
    expect(current.activations[1]!.activation.status).toBe('idle')
  } finally { activate.mockRestore(); ownedRuns(ctx.teamRuns).set(first.teamId, retained) }
})

it('quiesces retained coordinator leases when the TeamRun plugin fiber is removed', async () => {
  const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0 })
  const service = ctx.teamRuns
  const run = await service.create({ objective: 'Unload the owner plugin', cwd: process.cwd() })
  const runtime = ctx.registry.get(TeamRun)
  if (runtime === undefined) throw new Error('Fixture TeamRun plugin missing')
  for (const fiber of [...runtime.fibers]) await fiber.dispose()
  const state = await ctx.teams.getTeam({ teamId: run.teamId })
  expect(state.activations).toHaveLength(1)
  expect(state.activations[0]).toMatchObject({ activation: { status: 'offline' } })
  expect(state.activations[0]!.quiescedAt).toBeTypeOf('number')
  expect(ctx.agents.list()).toEqual([])
  await expect(service.create({ objective: 'Late create', cwd: process.cwd() })).rejects.toMatchObject({ code: 'TEAM_RUN_DISPOSED' })
  await ctx.plugin(TeamRun, { workerCount: 0, maxWorkerCount: 0 })
  const resumed = await ctx.teamRuns.resume({ teamId: run.teamId })
  expect(resumed.coordinatorLease.binding.sessionId).toBe(run.coordinatorLease.binding.sessionId)
})

it('reports coordinator cleanup failure to both the resume caller and the closing owner', async () => {
  const ctx = await setup(true, { workerCount: 0, maxWorkerCount: 0 })
  const original = await ctx.teamRuns.create({ objective: 'Retain failed resume cleanup', cwd: process.cwd() })
  await original.coordinatorLease.dispose()
  ownedRuns(ctx.teamRuns).delete(original.teamId)
  const entered = Promise.withResolvers<TeamActivationLease>()
  const release = Promise.withResolvers<undefined>()
  const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
  let restore = () => {}
  const hold = vi.spyOn(ctx.teamActivations, 'activate').mockImplementation(async (request) => {
    const lease = await activate(request)
    const dispose = vi.spyOn(lease, 'dispose').mockRejectedValue(new Error('Resume lease cleanup failed'))
    restore = () => { dispose.mockRestore() }
    entered.resolve(lease)
    await release.promise
    return lease
  })
  const resuming = ctx.teamRuns.resume({ teamId: original.teamId })
  const resumed = resuming.then(() => undefined, (error: unknown) => error)
  const lease = await entered.promise
  const closing = ctx.teamRuns.close().then(() => undefined, (error: unknown) => error)
  try {
    release.resolve(undefined)
    expect(await resumed).toBeInstanceOf(AggregateError)
    expect(await closing).toBeInstanceOf(AggregateError)
  } finally { restore(); hold.mockRestore(); await lease.dispose() }
})
