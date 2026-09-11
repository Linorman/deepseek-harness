/** Real task dispatch allocates a shared workspace before a release-confirmation crash. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { CallId, LlmAdapter, resolveRetryPolicy } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from '@clocky/clocky-llm'
import { channelPostIdempotencyKeySchema, teamIdSchema } from '@clocky/clocky-team'
import type { TeamId, TeamStateSnapshot, TeamWorkspaceAllocationSnapshot } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-team-closure-driver'
import type {} from './headless-workspace-release-probe.ts'

const MODEL = 'workspace-release-model'
const FAILURE = { code: 'RELEASE_FIXTURE_COORDINATOR_FAILURE', message: 'Stop the Team while an allocated worker is running.' }

/** Independent process role; recovery receives only the durable Team identity. */
export interface Config { readonly stage: 'crash' | 'recover'; readonly teamId?: string }
/** Validate the parent process input. */
export const Config: z<Config> = z.object({
  stage: z.union(['crash', 'recover'] as const).required(), teamId: z.string(),
})

function taskStart(messages: GenerateOptions['messages']) {
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const call = message.content.find(block => block.type === 'tool-call' && block.name === 'team_task_start')
    if (call?.type === 'tool-call') return call
  }
  return undefined
}

function assignment(messages: GenerateOptions['messages']): { taskId: string; attemptId: string } | undefined {
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const block of message.content) {
      if (block.type !== 'text' || !block.text.startsWith('Team task assignment:')) continue
      const match = /\nTask: (\S+)\nAttempt: (\S+)/u.exec(block.text)
      assert(match?.[1] !== undefined && match[2] !== undefined)
      return { taskId: match[1], attemptId: match[2] }
    }
  }
  return undefined
}

/** Gate only external model responses, respecting normal request cancellation. */
async function releasedOrAborted(release: Promise<undefined>, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return false
  const aborted = Promise.withResolvers<undefined>()
  const cancel = (): void => { aborted.resolve(undefined) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    return await Promise.race([release.then(() => true), aborted.promise.then(() => false)])
  } finally { signal?.removeEventListener('abort', cancel) }
}

/** Deterministic model uses the actual task tool; workers keep running until production closure cancels them. */
class ReleaseModel extends LlmAdapter {
  readonly allowFailure = Promise.withResolvers<undefined>()
  readonly workerStarted = Promise.withResolvers<{ taskId: string; attemptId: string }>()
  readonly workerHold = Promise.withResolvers<undefined>()
  mainRequests = 0

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  override providerRetryPolicy(): ResolvedRetryPolicy {
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'workspace-release model')
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Workspace release recovery' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.mainRequests += 1
    const assigned = assignment(options.messages)
    if (assigned !== undefined) {
      this.workerStarted.resolve(assigned)
      await releasedOrAborted(this.workerHold.promise, options.signal)
      return
    }
    const started = taskStart(options.messages)
    if (started === undefined) {
      const id = CallId('workspace-release-task-start')
      const args = JSON.stringify({ subject: 'Retain a real workspace allocation.',
        instructions: 'Wait until the Team stops this allocated task.', read_scopes: [], write_scopes: [] })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'team_task_start', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'team_task_start', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (await releasedOrAborted(this.allowFailure.promise, options.signal)) {
      yield { type: 'finish', reason: { kind: 'error', failure: FAILURE } }
    }
  }
}

/** Wait for production task assignment and workspace publication without synthesizing a lease. */
async function activeAllocation(ctx: Context, teamId: TeamId): Promise<TeamWorkspaceAllocationSnapshot> {
  for (;;) {
    const state = await ctx.teams.getTeam({ teamId })
    const allocation = state.workspaceAllocations.find(candidate => candidate.lifecycle === 'active')
    if (allocation !== undefined) return allocation
    assert.equal(state.team.phase, 'active', `Team stopped before its real allocation: ${JSON.stringify(state.team)}`)
    await ctx.teams.watchTeam({ teamId, afterCursor: state.team.cursor })
  }
}

/** Require an exact task/attempt/participant/activation/Session relationship from public state. */
function assertProvenance(state: TeamStateSnapshot, allocation: TeamWorkspaceAllocationSnapshot): void {
  const task = state.tasks.find(candidate => candidate.id === allocation.taskId)
  assert(task?.lease !== undefined)
  assert.equal(task.phase, 'running')
  assert.equal(task.lease.attemptId, allocation.attemptId)
  assert.equal(task.lease.assignedRevision, allocation.assignedRevision)
  assert.equal(task.lease.participantId, allocation.participantId)
  assert.equal(task.lease.activationId, allocation.activationId)
  const binding = state.activations.find(candidate => candidate.activation.id === allocation.activationId)
  assert(binding !== undefined)
  assert.equal(binding.activation.participantId, allocation.participantId)
  assert.equal(binding.sessionId, allocation.sessionId)
  assert.equal(allocation.provider, 'shared-local')
  assert.equal(allocation.mode, 'shared')
}

async function crash(ctx: Context, model: ReleaseModel): Promise<never> {
  await ctx.get('loader')?.await()
  const run = await ctx.teamRuns.create({ objective: 'Recover provider cleanup after confirmation failure.', cwd: process.cwd(),
    selection: { provider: MODEL, model: MODEL } })
  await ctx.teamRuns.postHumanInput({ teamId: run.teamId,
    idempotencyKey: channelPostIdempotencyKeySchema.parse('workspace-release-input'),
    content: [{ type: 'text', text: 'Start the one allocated worker task.' }] })
  const allocation = await activeAllocation(ctx, run.teamId)
  const assignment = await model.workerStarted.promise
  assert.equal(assignment.taskId, allocation.taskId)
  assert.equal(assignment.attemptId, allocation.attemptId)
  assertProvenance(await ctx.teams.getTeam({ teamId: run.teamId }), allocation)
  const probe = ctx.workspaceReleaseProbe
  assert.equal(probe.activeAllocation?.id, allocation.id)
  assert(probe.manifestPath !== undefined && existsSync(probe.manifestPath))
  model.allowFailure.resolve(undefined)
  for (;;) {
    const state = await ctx.teams.getTeam({ teamId: run.teamId })
    assert.notEqual(state.team.phase, 'failed', 'Team passed its release confirmation crash window')
    assert.notEqual(state.team.phase, 'stalled', `Live release stalled before its confirmation retry: ${JSON.stringify(state.team)}`)
    await ctx.teams.watchTeam({ teamId: run.teamId, afterCursor: state.team.cursor })
  }
}

async function recover(ctx: Context, config: Config, model: ReleaseModel): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  const teamId = teamIdSchema.parse(config.teamId)
  const state = await ctx.teams.getTeam({ teamId })
  assert.equal(state.workspaceAllocations.length, 1)
  const allocation = state.workspaceAllocations[0]!
  assert.equal(allocation.lifecycle, 'released')
  assertProvenance(state, allocation)
  assert.equal(state.team.phase, 'stalled')
  assert.equal(state.team.stallReason?.code, 'ACTIVATION_TERMINATION_UNCONFIRMED')
  assert(state.team.stallReason.message.includes(allocation.activationId))
  assert.equal(state.team.closure?.kind, 'fail')
  assert.deepEqual(state.team.closure.reason, FAILURE)
  assert.equal(state.goal.phase, 'active')
  const worker = state.activations.find(binding => binding.activation.id === allocation.activationId)!
  assert.equal(worker.activation.status, 'stopping')
  assert.equal(worker.quiescedAt, undefined)
  assert.equal(worker.recovery, undefined)
  const others = state.activations.filter(binding => binding.activation.id !== allocation.activationId)
  assert.equal(others.length, 1)
  assert(others.every(binding => binding.activation.status === 'offline' && binding.quiescedAt !== undefined))
  const probe = ctx.workspaceReleaseProbe
  assert.equal(probe.confirmationAttempts, 2)
  assert.equal(probe.failedConfirmations, 1)
  assert.equal(probe.successfulConfirmations, 1)
  assert.equal(probe.removals.length, 1)
  assert.equal(probe.removals.filter(removal => removal.removed).length, 0)
  assert.equal(model.mainRequests, 0)
  return { stage: 'recover', pid: process.pid, allocation: 'released', task: 'running', attemptRetained: true,
    worker: 'stopping', workerQuiesced: false, coordinatorQuiesced: true,
    team: state.team.phase, goal: state.goal.phase, stallCode: state.team.stallReason.code, exactWorkerEpochInStall: true,
    confirmationAttempts: probe.confirmationAttempts, confirmationFailures: probe.failedConfirmations,
    confirmationCommits: probe.successfulConfirmations, cleanupReconciliations: probe.removals.length,
    repeatedPhysicalRelease: false, modelRequests: model.mainRequests }
}

/** Test-only Loader identity. */
export const name = 'workspace-release-driver'
/** Real startup owners settle before recovery assertions. */
export const inject = ['workspaceReleaseProbe', 'teamRuns', 'teams', 'llm', 'teamClosureDriver']
/** Drive the real producer or inspect a new Host. @param ctx - Loader context. @param config - role and durable Team identity. */
export function apply(ctx: Context, config: Config): void {
  const model = new ReleaseModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  const operation = config.stage === 'crash' ? crash(ctx, model) : recover(ctx, config, model)
  void operation.then((snapshot) => {
    process.stdout.write(`${JSON.stringify(snapshot)}\n`)
    exit(0)
  }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
