/** A real workflow, review task and Host approval coexist before terminal cleanup. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import { CallId, resolveRetryPolicy } from '@clocky/clocky-llm'
import type { GenerateOptions, ResolvedRetryPolicy, StreamChunk } from '@clocky/clocky-llm'
import { ApiProxyService, RpcId } from '@clocky/clocky-host-apiproxy'
import type { MuxFrame, RpcRequest } from '@clocky/clocky-host-apiproxy'
import { channelPostIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamEnvelope, TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-team'
import { CONSULT_REVIEW_REQUEST_KIND, CONSULT_RESPONSE_KIND } from '@clocky/clocky-team-channel-basic'
import type {} from '@clocky/clocky-team-run'
import { ApprovalModel, APPROVAL_ID, BEFORE, DENIED_ID, REASON } from './headless-human-approval-driver.ts'

const MODEL = 'multi-resource-model'
const INPUT = 'START_MIXED_TERMINAL_RESOURCES'
const APPROVAL_WORK = 'MIXED_WORKFLOW_APPROVAL'
const REVIEW_WORK = 'MIXED_REVIEW_WORK'
const REVIEW_RESULT = 'review.txt was inspected and requires no changes.'
const FAILURE = { code: 'MIXED_COORDINATOR_FAILURE', message: 'The coordinator failed with workflow, review and approval work outstanding.' }
const PLAN = {
  version: 1, name: 'mixed-resources',
  tasks: [
    { id: 'approval', subject: 'Obtain approval for the workflow write.',
      description: `${APPROVAL_WORK}: Read approval.txt, then replace it with after and a newline. Follow the real read-only denial with a workspace-write approval retry.`,
      blockedBy: [], requiredCapabilities: ['team-default-worker'], priority: 1,
      readScopes: ['approval.txt'], writeScopes: ['approval.txt'], workspaceMode: 'shared', budget: {},
      reviewPolicy: { kind: 'none' }, maxAttempts: 1 },
    { id: 'dependent', subject: 'Wait for the approval task.', description: 'Run only after the approval task completes.',
      blockedBy: ['approval'], requiredCapabilities: ['team-default-worker'], priority: 0,
      readScopes: ['approval.txt'], writeScopes: [], workspaceMode: 'shared', budget: {},
      reviewPolicy: { kind: 'none' }, maxAttempts: 1 },
  ],
  bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 },
  channel: { participantRoles: ['coordinator', 'worker', 'worker-2'], viewPolicy: { type: 'recent-window', version: 1 },
    graph: { initial: { kind: 'participant', role: 'coordinator' },
      transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
  result: { kind: 'task-results', taskTemplateIds: ['approval', 'dependent'] },
}

type Requested = Extract<MuxFrame, { type: 'approval/requested' }>

function tool(id: string, name: string, args: Record<string, unknown>): StreamChunk[] {
  const callId = CallId(id)
  const argumentsText = JSON.stringify(args)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}

function response(options: GenerateOptions, id: string): Record<string, unknown> | undefined {
  const result = options.messages.flatMap(message => message.content)
    .find(block => block.type === 'tool-result' && block.toolCallId === id)
  if (result === undefined) return undefined
  assert(result.type === 'tool-result' && !result.isError, JSON.stringify(result))
  const text = result.content.find(block => block.type === 'text')
  assert(text?.type === 'text')
  return JSON.parse(text.text) as Record<string, unknown>
}

async function wait(gate: Promise<undefined>, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return false
  const stopped = Promise.withResolvers<undefined>()
  const abort = (): void => { stopped.resolve(undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try { return await Promise.race([gate.then(() => true), stopped.promise.then(() => false)]) }
  finally { signal?.removeEventListener('abort', abort) }
}

/** Existing tool and compiler paths create every resource; only external model responses are held. */
class MultiResourceModel extends ApprovalModel {
  readonly coordinatorReady = Promise.withResolvers<{ planId: string; reviewTaskId: string }>()
  readonly reviewerStarted = Promise.withResolvers<undefined>()
  readonly holdReviewer = Promise.withResolvers<undefined>()
  requests = 0

  override providerRetryPolicy(): ResolvedRetryPolicy {
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'multi-resource model')
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests += 1
    if (options.purpose === 'session-title') { yield* super.stream(options); return }
    const text = options.messages.filter(message => message.role === 'user').flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (text.includes(INPUT)) {
      const workflow = response(options, 'mixed-workflow-start')
      if (workflow === undefined) { yield* tool('mixed-workflow-start', 'team_workflow_start', { plan: PLAN }); return }
      const review = response(options, 'mixed-review-start')
      if (review === undefined) {
        yield* tool('mixed-review-start', 'team_task_start', { subject: 'Inspect review.txt before independent review.',
          instructions: `${REVIEW_WORK}: Read review.txt and report that no changes are needed.`,
          read_scopes: ['review.txt'], write_scopes: ['review.txt'] })
        return
      }
      assert(typeof workflow.plan_id === 'string' && typeof review.task_id === 'string')
      this.coordinatorReady.resolve({ planId: workflow.plan_id, reviewTaskId: review.task_id })
      if (await wait(this.holdCoordinator.promise, options.signal)) yield { type: 'finish', reason: { kind: 'error', failure: FAILURE } }
      return
    }
    if (text.includes('Review Team task ')) {
      this.reviewerStarted.resolve(undefined)
      await wait(this.holdReviewer.promise, options.signal)
      return
    }
    if (text.includes(REVIEW_WORK)) {
      const assigned = [...text.matchAll(/\nTask: (\S+)\nAttempt: (\S+)/gu)].at(-1)
      assert(assigned?.[1] !== undefined && assigned[2] !== undefined)
      const read = options.messages.flatMap(message => message.content)
        .find(block => block.type === 'tool-result' && block.toolCallId === 'mixed-review-read')
      if (read === undefined) { yield* tool('mixed-review-read', 'read', { file_path: join(process.cwd(), 'review.txt') }); return }
      assert(read.type === 'tool-result' && !read.isError)
      if (response(options, 'mixed-review-report') === undefined) {
        yield* tool('mixed-review-report', 'team_task_report', { task_id: assigned[1], attempt_id: assigned[2],
          outcome: 'completed', summary: REVIEW_RESULT })
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Review work reported.' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
      return
    }
    assert(text.includes(APPROVAL_WORK), 'the dependent workflow task must remain pending')
    yield* super.stream(options)
  }
}

/** Read the real scheduler consult and wait for the reviewer's source-bound receipt. */
async function reviewEnvelope(ctx: Context, state: TeamStateSnapshot, task: TeamTaskSnapshot): Promise<TeamEnvelope> {
  assert(task.reviewPolicy.kind === 'participant')
  const reviewerId = task.reviewPolicy.reviewerId
  for (const channelId of state.channelIds) {
    const read = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
    const found = read.records.find(record => record.type === 'channel/envelope'
      && record.envelope.kind === CONSULT_REVIEW_REQUEST_KIND && record.envelope.taskId === task.id)
    if (found?.type !== 'channel/envelope') continue
    const envelope = found.envelope
    assert.deepEqual(envelope.audience, [reviewerId])
    assert.equal(envelope.payload.attemptId, task.attemptHistory[0]!.id)
    const attempt = task.attemptHistory[0]!
    assert(attempt.outcome.kind === 'completed')
    assert.deepEqual(envelope.payload.result, attempt.outcome.result)
    for (;;) {
      const current = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
      assert(!current.records.some(record => record.type === 'channel/envelope' && record.envelope.kind === CONSULT_RESPONSE_KIND))
      if (current.records.some(record => record.type === 'channel/receipt'
        && record.envelopeId === envelope.id && record.participantId === reviewerId)) return envelope
      await ctx.teams.watchChannel({ channelId, afterCursor: current.channel.cursor })
    }
  }
  throw new Error('reviewer has no real consult request')
}

async function prepare(ctx: Context, model: MultiResourceModel) {
  await ctx.get('loader')?.await()
  assert(ctx.apiProxy instanceof ApiProxyService)
  const stop = new AbortController()
  const requested = Promise.withResolvers<RpcRequest<Requested>>()
  const pump = (async () => {
    for await (const frame of ctx.apiProxy.events.mux({ rpcId: RpcId('mixed-resource-observer'), payload: {} }, stop.signal)) {
      if (frame.payload.type === 'approval/requested') requested.resolve({ rpcId: frame.rpcId, payload: frame.payload })
    }
  })()
  void pump.catch((error: unknown) => { requested.reject(error) })
  try {
    const handle = await ctx.teamRuns.create({ objective: 'Verify independent cleanup of mixed Team resources.', cwd: process.cwd(), selection: { provider: MODEL, model: MODEL } })
    await ctx.teamRuns.postHumanInput({ teamId: handle.teamId,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('mixed-resource-input'), content: [{ type: 'text', text: INPUT }] })
    const identities = await model.coordinatorReady.promise
    const assigned = await model.workerStarted.promise
    model.allowOperation.resolve(undefined)
    await model.denied.promise
    assert.equal(await readFile(join(process.cwd(), 'approval.txt'), 'utf8'), BEFORE)
    model.allowEscalation.resolve(undefined)
    const frame = await requested.promise
    await model.reviewerStarted.promise
    for (;;) {
      const state = await ctx.teams.getTeam({ teamId: handle.teamId })
      assert.equal(state.team.phase, 'active')
      const reviewTask = state.tasks.find(task => task.id === identities.reviewTaskId)
      const reviewAllocation = state.workspaceAllocations.find(allocation => allocation.taskId === reviewTask?.id)
      if (reviewTask?.phase !== 'review' || reviewAllocation?.lifecycle !== 'released') {
        await ctx.teams.watchTeam({ teamId: handle.teamId, afterCursor: state.team.cursor }); continue
      }
      assert.equal(state.tasks.length, 3)
      assert(state.workflowPlans !== undefined)
      const plan = state.workflowPlans.find(plan => plan.id === identities.planId)
      assert(plan !== undefined && plan.phase === 'ready' && plan.channelId !== undefined)
      assert.equal(plan.taskBindings.length, 2)
      const approvalTask = state.tasks.find(task => task.id === assigned.taskId)!
      assert.equal(approvalTask.workflowPlanId, plan.id)
      assert.equal(approvalTask.workflowTemplateId, 'approval')
      assert.equal(approvalTask.phase, 'running')
      assert.equal(approvalTask.lease?.attemptId, assigned.attemptId)
      const pendingTask = state.tasks.find(task => task.workflowTemplateId === 'dependent')!
      assert.equal(pendingTask.phase, 'pending')
      assert.deepEqual(pendingTask.blockedBy, [approvalTask.id])
      assert.equal(pendingTask.attemptCount, 0)
      assert(state.humanActions !== undefined)
      assert.equal(state.humanActions.length, 1)
      const approval = state.humanActions[0]!
      assert.equal(approval.kind, 'approval'); assert.equal(approval.phase, 'pending')
      assert.equal(approval.taskId, approvalTask.id)
      assert.equal(approval.sourceId, frame.payload.approvalId)
      assert.equal(approval.details.rpcId, frame.rpcId)
      assert.equal(approval.details.callId, APPROVAL_ID); assert.equal(approval.details.reason, REASON)
      assert.equal(frame.payload.teamId, handle.teamId)
      assert.equal(frame.payload.taskId, approvalTask.id)
      assert.equal(frame.payload.sessionId, approval.sessionId)
      assert.equal(frame.payload.participantId, approval.participantId)
      assert.equal(state.activations.length, 4)
      assert(state.activations.every(binding => binding.quiescedAt === undefined && binding.recovery === undefined))
      const worker = ctx.agents.get(approval.sessionId)
      assert(worker !== undefined && ctx.agents.roots().includes(worker))
      const denied = worker.session.events.filter(event => event.type === 'tool/result')
        .find(event => event.data.message.source.callId === DENIED_ID)
      assert.equal(denied?.data.error?.code, 'FS_SANDBOX_DENIED')
      assert.equal(worker.session.events.filter(event => event.type === 'approval/asked').length, 1)
      assert.equal(worker.session.events.filter(event => event.type === 'approval/decided').length, 0)
      await ctx.sessions.flush(worker.session)
      assert.equal(state.workspaceAllocations.length, 2)
      assert.equal(state.workspaceAllocations.find(allocation => allocation.taskId === approvalTask.id)?.lifecycle, 'active')
      assert.equal(reviewTask.attemptHistory.length, 1)
      assert.deepEqual(reviewTask.reviewHistory, [])
      const review = await reviewEnvelope(ctx, state, reviewTask)
      const workflowChannel = await ctx.teams.getChannel({ channelId: plan.channelId })
      assert.equal(workflowChannel.manifest.adapter.type, 'workflow')
      assert.equal(workflowChannel.manifest.workflowPlanId, plan.id)
      return { state: await ctx.teams.getTeam({ teamId: handle.teamId }), approvalTask, pendingTask, reviewTask, approval, review, plan }
    }
  } finally { stop.abort(); await pump }
}

async function probe(ctx: Context, model: MultiResourceModel): Promise<Record<string, unknown>> {
  const ready = await prepare(ctx, model)
  await ctx.teamRuns.cancel(ready.state.team.id)
  const state = await ctx.teams.getTeam({ teamId: ready.state.team.id })
  assert.equal(state.team.phase, 'cancelled')
  assert(state.tasks.every(task => task.phase === 'cancelled'))
  assert(state.workflowPlans !== undefined && state.humanActions !== undefined)
  assert.equal(state.workflowPlans[0]!.phase, 'cancelled')
  assert.equal(state.humanActions[0]!.phase, 'cancelled')
  assert(state.workspaceAllocations.every(allocation => allocation.lifecycle === 'released'))
  assert(state.activations.every(binding => binding.quiescedAt !== undefined && binding.activation.status === 'offline'))
  assert.equal(await readFile(join(process.cwd(), 'approval.txt'), 'utf8'), BEFORE)
  assert.equal(await readFile(join(process.cwd(), 'review.txt'), 'utf8'), BEFORE)
  return { scenario: 'multi-resource-producer', initial: { workflow: ready.plan.phase,
    tasks: [ready.approvalTask.phase, ready.pendingTask.phase, ready.reviewTask.phase], approval: ready.approval.phase,
    activeAllocations: 1, releasedAllocations: 1, epochs: ready.state.activations.length, completedReviewAttempts: 1, reviewDecisions: 0 },
  terminal: { team: state.team.phase, workflow: state.workflowPlans[0]!.phase, tasks: state.tasks.map(task => task.phase),
    approval: state.humanActions[0]!.phase, releasedAllocations: state.workspaceAllocations.length,
    quiescedEpochs: state.activations.length, filesUnchanged: true } }
}

/** Test-only Loader identity. */
export const name = 'multi-resource-driver'
/** Formal Host and native Team owners precede the producer. */
export const inject = ['apiProxy', 'teamRuns', 'teams', 'llm', 'agents', 'sessions']
/** Assemble real mixed resources and cancel through their current owner. @param ctx - Loader context. */
export function apply(ctx: Context): void {
  const model = new MultiResourceModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit'); assert(exit !== undefined)
  void probe(ctx, model).then((output) => { process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); exit(0) }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); exit(1)
  })
}
