/** A genuine pending Host approval is durably cancelled after terminal intent and abrupt Host loss. */
import assert from 'node:assert/strict'
import { writeSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionEvent } from '@clocky/clocky-session'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { resolveRetryPolicy } from '@clocky/clocky-llm'
import type { GenerateOptions, ResolvedRetryPolicy, StreamChunk } from '@clocky/clocky-llm'
import { ApiProxyService, RpcId } from '@clocky/clocky-host-apiproxy'
import type { MuxFrame, RpcRequest } from '@clocky/clocky-host-apiproxy'
import { channelPostIdempotencyKeySchema, teamIdSchema } from '@clocky/clocky-team'
import type { TeamHumanActionSnapshot, TeamTaskSnapshot } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-storage-log'
import type {} from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-team-closure-driver'
import { MODEL, APPROVAL_ID, DENIED_ID, INPUT, BEFORE, REASON, ApprovalModel } from './headless-human-approval-driver.ts'

const FAILURE = { code: 'APPROVAL_COORDINATOR_FAILURE', message: 'The coordinator failed while a worker awaited an approval decision.' }
type Requested = Extract<MuxFrame, { type: 'approval/requested' }>

/** Separate Host role and terminal intent producer. */
export interface Config { readonly stage: 'crash' | 'recover'; readonly outcome: 'failure' | 'cancellation'; readonly teamId?: string }
/** Parse process input before selecting durable resources. */
export const Config: z<Config> = z.object({
  stage: z.union(['crash', 'recover'] as const).required(),
  outcome: z.union(['failure', 'cancellation'] as const).required(), teamId: z.string(),
})

/** The shared actual approval producer additionally permits a coordinator model failure. */
class FaultModel extends ApprovalModel {
  requests = 0
  override providerRetryPolicy(): ResolvedRetryPolicy {
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'human-approval restart model')
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests += 1
    const afterTask = options.purpose !== 'session-title'
      && options.messages.some(message => message.role === 'user'
        && message.content.some(block => block.type === 'text' && block.text.includes(INPUT)))
      && options.messages.some(message => message.role === 'assistant'
        && message.content.some(block => block.type === 'tool-call' && block.name === 'team_task_start'))
    yield* super.stream(options)
    if (afterTask && !options.signal?.aborted) yield { type: 'finish', reason: { kind: 'error', failure: FAILURE } }
  }
}

function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

/** Hold only observations of real resources; kill after their real owner commits terminal intent. */
function crashOnIntent(ctx: Context, config: Config) {
  let checkpoint: { readonly approval: TeamHumanActionSnapshot; readonly task: TeamTaskSnapshot; readonly asked: SessionEvent } | undefined
  const log = ctx.storageLog
  const open = log.open.bind(log)
  ctx.effect(() => {
    log.open = async (descriptor) => {
      const stream = await open(descriptor)
      if (!descriptor.name.startsWith('team/')) return stream
      const append = stream.append.bind(stream)
      stream.append = async (cursor, values) => {
        const result = await append(cursor, values)
        const selected = values.some((value) => {
          const record = object(value)
          return config.outcome === 'failure' ? record.type === 'team/closure' && object(record.closure).kind === 'fail'
            : record.type === 'team/cancellation'
        })
        if (selected) {
          assert(checkpoint !== undefined)
          assert.equal(descriptor.name, `team/${checkpoint.approval.teamId}`)
          writeSync(1, `${JSON.stringify({ stage: 'crash', outcome: config.outcome, pid: process.pid,
            stream: descriptor.name, tail: result.tailSequence, ...checkpoint })}\n`)
          process.kill(process.pid, 'SIGKILL')
          await new Promise<never>(() => {})
        }
        return result
      }
      return stream
    }
    return () => { log.open = open }
  }, 'human-approval: committed terminal intent crash')
  return (value: NonNullable<typeof checkpoint>): void => { checkpoint = value }
}

async function crash(ctx: Context, config: Config, model: FaultModel): Promise<never> {
  const arm = crashOnIntent(ctx, config)
  await ctx.get('loader')?.await()
  assert(ctx.apiProxy instanceof ApiProxyService)
  const muxAbort = new AbortController()
  const requested = Promise.withResolvers<RpcRequest<Requested>>()
  const pump = (async () => {
    for await (const frame of ctx.apiProxy.events.mux({ rpcId: RpcId('human-approval-crash-observer'), payload: {} }, muxAbort.signal)) {
      if (frame.payload.type === 'approval/requested') requested.resolve({ rpcId: frame.rpcId, payload: frame.payload })
    }
  })()
  void pump.catch((error: unknown) => { requested.reject(error) })
  const stopErrors = ctx.on('session/event', (_session, event) => {
    if (event.type !== 'tool/result' || event.data.message.source.callId !== APPROVAL_ID) return
    const result = event.data.message.content[0]
    if (result.isError === true) requested.reject(new Error(`actual approval failed before Host loss: ${JSON.stringify(result.content)}`))
  })
  try {
    const handle = await ctx.teamRuns.create({ objective: 'Retain a pending human approval across Host loss.', cwd: process.cwd(),
      selection: { provider: MODEL, model: MODEL } })
    await ctx.teamRuns.postHumanInput({ teamId: handle.teamId,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('human-approval-restart-input'), content: [{ type: 'text', text: INPUT }] })
    const assignment = await model.workerStarted.promise
    const before = await ctx.teams.getTeam({ teamId: handle.teamId })
    const task = before.tasks.find(candidate => candidate.id === assignment.taskId)
    assert(task?.lease !== undefined)
    assert.equal(task.lease.attemptId, assignment.attemptId)
    const binding = before.activations.find(candidate => candidate.activation.id === task.lease!.activationId)
    assert(binding !== undefined)
    const worker = ctx.agents.get(binding.sessionId)
    assert(worker !== undefined && ctx.agents.roots().includes(worker))
    model.allowOperation.resolve(undefined)
    await model.denied.promise
    const denied = worker.session.events.filter(event => event.type === 'tool/result')
      .find(event => event.data.message.source.callId === DENIED_ID)
    assert.equal(denied?.data.error?.code, 'FS_SANDBOX_DENIED')
    assert.equal(await readFile(join(process.cwd(), 'approval.txt'), 'utf8'), BEFORE)
    model.allowEscalation.resolve(undefined)
    const frame = await requested.promise
    assert.equal(frame.payload.taskId, task.id)
    assert.equal(frame.payload.participantId, binding.activation.participantId)
    assert.equal(frame.payload.sessionId, worker.session.id)
    assert.equal(frame.payload.teamId, handle.teamId)
    assert.equal(frame.payload.toolName, 'write')
    assert.equal(frame.payload.callId, APPROVAL_ID)
    assert.equal(frame.payload.reason, REASON)
    await ctx.sessions.flush(worker.session)
    const state = await ctx.teams.getTeam({ teamId: handle.teamId })
    assert.equal(state.team.phase, 'active')
    assert.equal(state.humanActions?.length, 1)
    const approval = state.humanActions[0]!
    assert.equal(approval.phase, 'pending')
    assert.equal(approval.kind, 'approval')
    assert.equal(approval.sourceId, frame.payload.approvalId)
    assert.equal(approval.id, `approval:${worker.session.id}:${frame.payload.approvalId}`)
    assert.equal(approval.taskId, task.id)
    assert.deepEqual(approval.details, { approvalId: frame.payload.approvalId, rpcId: frame.rpcId,
      toolName: 'write', callId: APPROVAL_ID, reason: REASON })
    assert.equal(state.workspaceAllocations.length, 1)
    assert.equal(state.workspaceAllocations[0]!.lifecycle, 'active')
    const currentTask = state.tasks[0]!
    assert.equal(currentTask.phase, 'running')
    const asked = worker.session.events.filter(event => event.type === 'approval/asked')
    assert.equal(asked.length, 1)
    assert.equal(asked[0]!.data.id, approval.sourceId)
    assert.equal(worker.session.events.filter(event => event.type === 'approval/decided').length, 0)
    assert.equal(await readFile(join(process.cwd(), 'approval.txt'), 'utf8'), BEFORE)
    arm({ approval, task: currentTask, asked: asked[0]! })
    if (config.outcome === 'cancellation') {
      await ctx.teamRuns.cancel(handle.teamId)
      throw new Error('cancellation passed its committed intent crash window')
    }
    model.holdCoordinator.resolve(undefined)
    for (;;) {
      const current = await ctx.teams.getTeam({ teamId: handle.teamId })
      assert.equal(current.team.phase, 'active')
      await ctx.teams.watchTeam({ teamId: handle.teamId, afterCursor: current.team.cursor })
    }
  } finally {
    stopErrors()
    muxAbort.abort()
    await pump
  }
}

async function recover(ctx: Context, config: Config, model: FaultModel): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  assert(ctx.apiProxy instanceof ApiProxyService)
  const state = await ctx.teams.getTeam({ teamId: teamIdSchema.parse(config.teamId) })
  assert.equal(state.humanActions?.length, 1)
  const approval = state.humanActions[0]!
  assert.equal(approval.kind, 'approval')
  assert.equal(approval.phase, 'cancelled')
  assert.equal(approval.details.approvalId, approval.sourceId)
  assert.equal(typeof approval.details.rpcId, 'string')
  assert.equal(approval.details.toolName, 'write')
  assert.equal(approval.details.callId, APPROVAL_ID)
  assert.equal(approval.details.reason, REASON)
  assert.deepEqual(approval.outcome, config.outcome === 'failure' ? { kind: 'team-failed', reason: FAILURE } : { kind: 'team-cancelled' })
  assert.equal(state.team.phase, 'stalled')
  assert.equal(state.goal.phase, 'active')
  assert.equal(state.team.stallReason?.code, 'ACTIVATION_TERMINATION_UNCONFIRMED')
  assert.equal(state.activations.length, 2)
  assert(state.activations.every(binding => binding.quiescedAt === undefined && binding.recovery === undefined))
  assert(state.activations.some(binding => state.team.stallReason!.message.includes(binding.activation.id)))
  assert.equal(state.tasks.length, 1)
  const task = state.tasks[0]!
  assert.equal(task.id, approval.taskId)
  assert.equal(task.phase, 'running')
  assert.equal(task.attemptCount, 1)
  assert.equal(task.attemptHistory.length, 0)
  assert(task.lease !== undefined)
  assert.equal(task.lease.participantId, approval.participantId)
  assert.equal(state.workspaceAllocations.length, 1)
  const allocation = state.workspaceAllocations[0]!
  assert.equal(allocation.lifecycle, 'active')
  assert.equal(allocation.taskId, task.id)
  assert.equal(allocation.attemptId, task.lease.attemptId)
  assert.equal(allocation.sessionId, approval.sessionId)
  assert.equal(model.requests, 0)
  assert.equal(model.escalationCalls, 0)
  assert.equal(await readFile(join(process.cwd(), 'approval.txt'), 'utf8'), BEFORE)
  return { stage: 'recover', outcome: config.outcome, pid: process.pid, approval: approval.kind,
    approvalPhase: approval.phase, approvalOutcome: approval.outcome, detailsRetained: true,
    task: task.phase, taskAttempt: 'retained-unsettled', workspace: allocation.lifecycle,
    oldEpochs: state.activations.length, quiescedEpochs: 0, team: state.team.phase, goal: state.goal.phase,
    stallCode: state.team.stallReason.code, exactUnprovenEpoch: true, modelRequests: model.requests,
    newApprovalCalls: model.escalationCalls, fileUnchanged: true }
}

/** Test-only Loader identity. */
export const name = 'human-approval-restart-driver'
/** Formal Host and durable lifecycle providers precede the scenario. */
export const inject = ['apiProxy', 'teamRuns', 'teams', 'storageLog', 'llm', 'agents', 'sessions', 'teamClosureDriver']
/** Run one real Host lifetime. @param ctx - Loader context. @param config - role and lifecycle path. */
export function apply(ctx: Context, config: Config): void {
  const model = new FaultModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  const operation = config.stage === 'crash' ? crash(ctx, config, model) : recover(ctx, config, model)
  void operation.then((output) => { process.stdout.write(`${JSON.stringify(output)}\n`); exit(0) }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
