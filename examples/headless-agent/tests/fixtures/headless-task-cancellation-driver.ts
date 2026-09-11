/** Model-driven single-task cancellation preserves approval and review authority while the Team continues. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import { CallId } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { ApiProxyService, RpcId } from '@clocky/clocky-host-apiproxy'
import type { MuxFrame, RpcRequest } from '@clocky/clocky-host-apiproxy'
import ApprovalService from '@clocky/clocky-user-approval'
import { channelPostIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamId } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-sandbox-policy'

import { ApprovalModel, MODEL, INPUT, DENIED_ID, APPROVAL_ID, BEFORE, REASON } from './headless-human-approval-driver.ts'

type Requested = Extract<MuxFrame, { type: 'approval/requested' }>
type Resolved = Extract<MuxFrame, { type: 'approval/resolved' }>

function tool(id: CallId, name: string, args: Record<string, unknown>): StreamChunk[] {
  const json = JSON.stringify(args)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: json },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: json } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}

function result(options: GenerateOptions, id: CallId) {
  return options.messages.flatMap(message => message.content)
    .find(block => block.type === 'tool-result' && block.toolCallId === id)
}

async function wait(gate: Promise<undefined>, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return false
  const aborted = Promise.withResolvers<undefined>()
  const abort = (): void => { aborted.resolve(undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try { return await Promise.race([gate.then(() => true), aborted.promise.then(() => false)]) }
  finally { signal?.removeEventListener('abort', abort) }
}

const FOLLOWUP = 'CONTINUE_AFTER_TASK_CANCEL'
const REVIEW_TASK = 'CANCEL_REVIEW_TASK'
const reviewMode = process.env.CLOCKY_TASK_CANCEL_KIND === 'review'
class CancellationModel extends ApprovalModel {
  readonly allowCancellation = Promise.withResolvers<undefined>()
  readonly completed = Promise.withResolvers<undefined>()
  readonly observations: Record<string, unknown>[] = []
  expectedCancellation: { readonly taskId: string; readonly attemptId: string; readonly revision: number } | undefined
  readonly reviewStarted = Promise.withResolvers<{ taskId: string; attemptId: string }>()
  readonly releaseReviewer = Promise.withResolvers<undefined>()
  readonly lateReviewRejected = Promise.withResolvers<undefined>()
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = options.messages.filter(message => message.role === 'user').flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    const value = (id: string): Record<string, unknown> | undefined => {
      const found = result(options, CallId(id))
      if (found === undefined) return undefined
      assert(found.type === 'tool-result' && !found.isError, JSON.stringify(found))
      const content = found.content.filter(block => block.type === 'text').map(block => block.text).join('')
      return JSON.parse(content) as Record<string, unknown>
    }
    if (options.purpose !== 'session-title' && text.includes(INPUT)) {
      const started = value('human-approval-task-start')
      if (started === undefined) {
        if (reviewMode) yield* tool(CallId('human-approval-task-start'), 'team_task_start', { subject: REVIEW_TASK, instructions: REVIEW_TASK, read_scopes: [], write_scopes: ['approval.txt'] })
        else yield* super.stream(options)
        return
      }
      if (!await wait(this.allowCancellation.promise, options.signal)) return
      const cancellation = value('single-task-cancel')
      if (cancellation === undefined) { yield* tool(CallId('single-task-cancel'), 'team_task_cancel', { task_id: started.task_id, reason: 'Stop this operation and continue the Team.' }); return }
      assert(this.expectedCancellation !== undefined)
      assert.equal(cancellation.task_id, this.expectedCancellation.taskId)
      assert.deepEqual(cancellation.cancellation, { requested_revision: this.expectedCancellation.revision,
        attempt_id: this.expectedCancellation.attemptId, expired: false })
      const cancelled = value('single-task-wait')
      if (cancelled === undefined) { this.observations.push({ phase: cancellation.phase, cancellation: cancellation.cancellation }); yield* tool(CallId('single-task-wait'), 'team_task_wait', { task_id: started.task_id }); return }
      assert.equal(cancelled.phase, 'cancelled')
      const next = value('single-task-followup')
      if (next === undefined) { yield* tool(CallId('single-task-followup'), 'team_task_start', { subject: FOLLOWUP, instructions: FOLLOWUP, read_scopes: [], write_scopes: [] }); return }
      const finished = value('single-task-followup-wait')
      if (finished === undefined) { yield* tool(CallId('single-task-followup-wait'), 'team_task_wait', { task_id: next.task_id }); return }
      assert.equal(finished.phase, 'completed')
      this.completed.resolve(undefined)
      await wait(this.holdCoordinator.promise, options.signal)
      return
    }
    if (reviewMode && text.includes('Review Team task ')) {
      const taskId = [...text.matchAll(/Review Team task ([^:]+):/gu)].at(-1)?.[1]
      const attemptId = [...text.matchAll(/"attemptId":"([^"]+)"/gu)].at(-1)?.[1]
      assert(taskId !== undefined && attemptId !== undefined)
      this.reviewStarted.resolve({ taskId, attemptId })
      const decision = result(options, CallId('cancelled-review-response'))
      if (decision !== undefined) {
        assert(decision.type === 'tool-result' && decision.isError, JSON.stringify(decision))
        this.lateReviewRejected.resolve(undefined)
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      if (!await wait(this.releaseReviewer.promise, options.signal)) return
      yield* tool(CallId('cancelled-review-response'), 'team_task_review', { task_id: taskId, decision: 'accepted', reason: 'A response to the cancelled review request.' })
      return
    }
    if (reviewMode && text.includes(REVIEW_TASK) && !text.includes(FOLLOWUP)) {
      const assignment = [...text.matchAll(/\nTask: (\S+)\nAttempt: (\S+)/gu)].at(-1)
      assert(assignment?.[1] !== undefined && assignment[2] !== undefined)
      if (value('cancel-review-report') === undefined) yield* tool(CallId('cancel-review-report'), 'team_task_report', {
        task_id: assignment[1], attempt_id: assignment[2], outcome: 'completed', summary: 'Completed attempt awaiting review.',
      })
      else yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (options.purpose !== 'session-title' && text.includes(FOLLOWUP)) {
      const assignment = [...text.matchAll(/\nTask: (\S+)\nAttempt: (\S+)/gu)].at(-1)
      assert(assignment?.[1] !== undefined && assignment[2] !== undefined)
      if (value('single-task-followup-report') === undefined) {
        yield* tool(CallId('single-task-followup-report'), 'team_task_report', { task_id: assignment[1], attempt_id: assignment[2], outcome: 'completed', summary: 'The Team continued after single-task cancellation.' })
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Done.' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
      return
    }
    yield* super.stream(options)
  }
}

async function actions(ctx: Context, teamId: TeamId) {
  const values = []
  let afterCursor = -1
  for (;;) {
    const page = await ctx.teams.readAudit({ teamId, afterCursor, limit: 32 })
    values.push(...page.items.filter(entry => entry.type === 'human-action/changed'))
    if (page.nextCursor === undefined) return values
    afterCursor = page.nextCursor
  }
}

/** A new mux subscriber reads the same actual pending registry entry without issuing any decision. */
async function assertPendingReplay(ctx: Context, expected: RpcRequest<Requested>): Promise<void> {
  const stop = new AbortController()
  try {
    for await (const frame of ctx.apiProxy.events.mux({ rpcId: RpcId('human-approval-late-observer'), payload: {} }, stop.signal)) {
      if (frame.payload.type !== 'approval/requested') continue
      assert.deepEqual(frame, expected)
      return
    }
    assert.fail('the Host pending registry must replay its live approval request')
  } finally { stop.abort() }
}

async function run(ctx: Context, model: CancellationModel): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  assert(ctx.apiProxy instanceof ApiProxyService)
  assert(ctx.approval instanceof ApprovalService)
  const path = join(process.cwd(), 'approval.txt')
  assert.equal(await readFile(path, 'utf8'), BEFORE)
  const muxAbort = new AbortController()
  const requested = Promise.withResolvers<RpcRequest<Requested>>()
  const resolved = Promise.withResolvers<Resolved>()
  const frames: string[] = []
  const pump = (async () => {
    for await (const frame of ctx.apiProxy.events.mux({ rpcId: RpcId('human-approval-observer'), payload: {} }, muxAbort.signal)) {
      if (frame.payload.type === 'approval/requested') {
        frames.push(frame.payload.type)
        requested.resolve({ rpcId: frame.rpcId, payload: frame.payload })
      }
      if (frame.payload.type === 'approval/resolved') { frames.push(frame.payload.type); resolved.resolve(frame.payload) }
    }
  })()
  void pump.catch((error: unknown) => { requested.reject(error); resolved.reject(error) })
  try {
    const handle = await ctx.teamRuns.create({ objective: 'Obtain approval for a real denied project-file mutation.',
      cwd: process.cwd(), selection: { provider: MODEL, model: MODEL } })
    await ctx.teamRuns.postHumanInput({ teamId: handle.teamId,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('human-approval-input'), content: [{ type: 'text', text: INPUT }] })
    if (reviewMode) {
      const selected = await model.reviewStarted.promise
      const before = await ctx.teams.getTeam({ teamId: handle.teamId })
      const reviewed = before.tasks.find(task => task.id === selected.taskId)!
      assert.equal(reviewed.phase, 'review')
      assert.equal(reviewed.attemptHistory.at(-1)?.id, selected.attemptId)
      model.expectedCancellation = { taskId: reviewed.id, attemptId: selected.attemptId, revision: reviewed.revision }
      model.allowCancellation.resolve(undefined)
      await model.completed.promise
      model.releaseReviewer.resolve(undefined)
      await model.lateReviewRejected.promise
      let continued = await ctx.teams.getTeam({ teamId: handle.teamId })
      while (continued.workspaceAllocations.some(allocation => allocation.lifecycle !== 'released')) {
        await ctx.teams.watchTeam({ teamId: handle.teamId, afterCursor: continued.team.cursor })
        continued = await ctx.teams.getTeam({ teamId: handle.teamId })
      }
      const cancelled = continued.tasks.find(task => task.id === reviewed.id)!
      assert.equal(continued.team.phase, 'active')
      assert.equal(continued.team.cancellation, undefined)
      assert.equal(cancelled.phase, 'cancelled')
      assert.deepEqual(cancelled.attemptHistory, reviewed.attemptHistory)
      assert.deepEqual(cancelled.reviewHistory, [])
      let reviewChannels = 0
      for (const channelId of continued.channelIds) {
        const channel = await ctx.teams.getChannel({ channelId })
        if (channel.manifest.adapter.type !== 'consult') continue
        const records = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
        if (!records.records.some(record => record.type === 'channel/envelope' && record.envelope.kind === 'review-request'
          && record.envelope.taskId === reviewed.id && record.envelope.payload.attemptId === selected.attemptId)) continue
        assert.equal(channel.phase, 'closed')
        reviewChannels += 1
      }
      assert.equal(reviewChannels, 1)
      assert.equal(await readFile(path, 'utf8'), BEFORE)
      await ctx.teamRuns.cancel(handle.teamId)
      return { scenario: 'single-task-review-cancellation', teamAfterTaskCancellation: 'active', task: 'cancelled',
        originalAttempt: 'completed', attemptHistoryUnchanged: true, reviewHistory: [], correspondingConsult: 'closed',
        oldReviewToolRejected: true, followupTask: 'completed', allAllocationsReleased: true, file: BEFORE }
    }
    const started = await model.workerStarted.promise
    const state = await ctx.teams.getTeam({ teamId: handle.teamId })
    const task = state.tasks.find(candidate => candidate.id === started.taskId)
    assert(task?.lease !== undefined)
    assert.equal(task.lease.attemptId, started.attemptId)
    const binding = state.activations.find(candidate => candidate.activation.id === task.lease!.activationId)
    assert(binding !== undefined)
    const worker = ctx.agents.get(binding.sessionId)
    assert(worker !== undefined && ctx.agents.roots().includes(worker))
    assert.equal(ctx.sandboxPolicy.resolve({ agent: worker, session: worker.session }).mode, 'read-only')
    model.allowOperation.resolve(undefined)
    await model.denied.promise
    const deniedResult = worker.session.events.filter(event => event.type === 'tool/result')
      .find(event => event.data.message.source.callId === DENIED_ID)
    const denialCode = deniedResult?.data.error?.code
    assert.equal(denialCode, 'FS_SANDBOX_DENIED')
    assert.equal(await readFile(path, 'utf8'), BEFORE)
    assert.equal(worker.session.events.filter(event => event.type === 'approval/asked').length, 0)
    assert.equal((await ctx.teams.getTeam({ teamId: handle.teamId })).humanActions?.length, 0)
    model.allowEscalation.resolve(undefined)
    const frame = await requested.promise
    assert.deepEqual(frame.payload, { type: 'approval/requested', sessionId: worker.session.id,
      approvalId: frame.payload.approvalId, toolName: 'write', callId: APPROVAL_ID, reason: REASON,
      teamId: handle.teamId, participantId: binding.activation.participantId, taskId: task.id })
    const pendingState = await ctx.teams.getTeam({ teamId: handle.teamId })
    assert.equal(pendingState.humanActions?.length, 1)
    const pending = pendingState.humanActions[0]!
    assert.equal(pending.kind, 'approval')
    assert.equal(pending.phase, 'pending')
    assert.equal(pending.sourceId, frame.payload.approvalId)
    assert.equal(pending.id, `approval:${worker.session.id}:${frame.payload.approvalId}`)
    assert.equal(pending.sessionId, worker.session.id)
    assert.equal(pending.participantId, binding.activation.participantId)
    assert.equal(pending.taskId, task.id)
    assert.deepEqual(pending.details, { approvalId: frame.payload.approvalId, rpcId: frame.rpcId,
      toolName: 'write', callId: APPROVAL_ID, reason: REASON })
    const asked = worker.session.events.filter(event => event.type === 'approval/asked')
    assert.equal(asked.length, 1)
    assert.deepEqual(asked[0]!.data, { id: frame.payload.approvalId, toolName: 'write', callId: APPROVAL_ID, reason: REASON })
    assert.equal(worker.session.events.filter(event => event.type === 'approval/decided').length, 0)
    assert(!worker.session.events.some(event => event.type === 'tool/result' && event.data.message.source.callId === APPROVAL_ID))
    await ctx.sessions.flush(worker.session)
    assert.equal(await readFile(path, 'utf8'), BEFORE)
    await assertPendingReplay(ctx, frame)
    const history = await actions(ctx, handle.teamId)
    assert.equal(history.length, 1)
    assert.deepEqual(history[0]!.facts.action, pending)
    model.expectedCancellation = {
      taskId: task.id, attemptId: started.attemptId, revision: pendingState.tasks.find(candidate => candidate.id === task.id)!.revision,
    }
    model.allowCancellation.resolve(undefined)
    await model.completed.promise
    const terminalFrame = await resolved.promise
    assert.equal(terminalFrame.outcome, 'cancelled')
    let continued = await ctx.teams.getTeam({ teamId: handle.teamId })
    assert(continued.workspaceAllocations.filter(allocation => allocation.taskId === task.id).every(allocation => allocation.lifecycle === 'released'))
    while (continued.workspaceAllocations.some(allocation => allocation.lifecycle !== 'released')) {
      await ctx.teams.watchTeam({ teamId: handle.teamId, afterCursor: continued.team.cursor })
      continued = await ctx.teams.getTeam({ teamId: handle.teamId })
    }
    assert.equal(continued.team.phase, 'active')
    assert.equal(continued.team.cancellation, undefined)
    assert.equal(continued.team.closure, undefined)
    const stopped = continued.tasks.find(candidate => candidate.id === task.id)!
    assert.equal(stopped.phase, 'cancelled')
    assert.equal(stopped.lease, undefined)
    assert.equal(stopped.attemptHistory.at(-1)?.id, started.attemptId)
    assert.equal(stopped.attemptHistory.at(-1)?.outcome.kind, 'cancelled')
    assert.equal(continued.tasks.find(candidate => candidate.id !== task.id)?.phase, 'completed')
    assert(continued.workspaceAllocations.every(allocation => allocation.lifecycle === 'released'))
    assert.equal(continued.humanActions?.[0]?.phase, 'cancelled')
    assert.equal(await readFile(path, 'utf8'), BEFORE)
    assert.equal(worker.session.events.filter(event => event.type === 'approval/decided').length, 1)
    const output = { scenario: 'single-task-cancellation', teamAfterTaskCancellation: continued.team.phase,
      originalAttempt: stopped.attemptHistory.at(-1)!.outcome.kind,
      exactAttemptRetained: stopped.attemptHistory.at(-1)!.id === started.attemptId,
      cancellationReason: stopped.cancellation?.reason, followupTask: 'completed',
      allAllocationsReleased: true, approval: continued.humanActions?.[0]?.phase, mux: frames,
      modelSawCancellation: model.observations.length === 1, file: await readFile(path, 'utf8') }
    await ctx.teamRuns.cancel(handle.teamId)
    return output
  } finally { muxAbort.abort(); await pump }
}

/** Test-only Loader identity. */
export const name = 'task-cancellation-driver'
/** Real Host and Team owners required by the approval-producing task. */
export const inject = ['apiProxy', 'teamRuns', 'teams', 'llm', 'agents', 'sessions', 'approval', 'sandboxPolicy']
/** Run one real cancelled operation and a succeeding task in the same Team. @param ctx - Loader context. */
export function apply(ctx: Context): void {
  const model = new CancellationModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  const failure = Promise.withResolvers<never>()
  ctx.on('agent/error', ({ error }) => { failure.reject(error) })
  void Promise.race([run(ctx, model), failure.promise]).then((output) => { process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); exit(0) }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
