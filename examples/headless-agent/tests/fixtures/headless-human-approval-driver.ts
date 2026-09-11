/** A denied real filesystem mutation enters the formal Host approval path before public Team cancellation. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { ApiProxyService, RpcId } from '@clocky/clocky-host-apiproxy'
import type { MuxFrame, RpcRequest } from '@clocky/clocky-host-apiproxy'
import ApprovalService from '@clocky/clocky-user-approval'
import { channelPostIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamId } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-sandbox-policy'

/** Deterministic external model route shared by the real producer and Host-loss scenarios. */
export const MODEL = 'human-approval-model'
/** Coordinator input that starts the actual approval-producing task. */
export const INPUT = 'START_PENDING_HUMAN_APPROVAL'
const READ_ID = CallId('human-approval-read')
/** Original write call whose real denial permits the same-operation retry. */
export const DENIED_ID = CallId('human-approval-denied-write')
/** Escalated write call that creates the actual UserApproval request. */
export const APPROVAL_ID = CallId('human-approval-escalated-write')
/** Original project-file bytes retained until an actual approval grant. */
export const BEFORE = 'before\n'
const AFTER = 'after\n'
const JUSTIFICATION = 'Allow replacing approval.txt after the read-only sandbox denied this exact write.'
/** Reason emitted by the shared production escalation helper for the model justification. */
export const REASON = `escalate sandbox to workspace-write: ${JUSTIFICATION}`
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

/** Only the external model's next response is gated; filesystem denial and approval are real operations. */
export class ApprovalModel extends LlmAdapter {
  readonly workerStarted = Promise.withResolvers<{ taskId: string; attemptId: string }>()
  readonly allowOperation = Promise.withResolvers<undefined>()
  readonly denied = Promise.withResolvers<undefined>()
  readonly allowEscalation = Promise.withResolvers<undefined>()
  readonly holdCoordinator = Promise.withResolvers<undefined>()
  escalationCalls = 0

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Pending human approval' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const text = options.messages.filter(message => message.role === 'user').flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (text.includes(INPUT)) {
      const started = options.messages.some(message => message.role === 'assistant'
        && message.content.some(block => block.type === 'tool-call' && block.name === 'team_task_start'))
      if (!started) yield* tool(CallId('human-approval-task-start'), 'team_task_start', {
        subject: 'Replace approval.txt after obtaining the required approval.',
        instructions: 'Read approval.txt, then replace its contents with after followed by a newline. Follow a real sandbox denial with one approved retry.',
        read_scopes: ['approval.txt'], write_scopes: ['approval.txt'],
      })
      else await wait(this.holdCoordinator.promise, options.signal)
      return
    }
    const assignment = /\nTask: (\S+)\nAttempt: (\S+)/u.exec(text)
    assert(assignment?.[1] !== undefined && assignment[2] !== undefined)
    this.workerStarted.resolve({ taskId: assignment[1], attemptId: assignment[2] })
    if (!await wait(this.allowOperation.promise, options.signal)) return
    const file_path = join(process.cwd(), 'approval.txt')
    const read = result(options, READ_ID)
    if (read === undefined) { yield* tool(READ_ID, 'read', { file_path }); return }
    assert(read.type === 'tool-result' && !read.isError)
    const denied = result(options, DENIED_ID)
    if (denied === undefined) { yield* tool(DENIED_ID, 'write', { file_path, content: AFTER }); return }
    assert(denied.type === 'tool-result' && denied.isError === true)
    assert(JSON.stringify(denied.content).includes('[sandbox: file access denied under read-only mode]'))
    this.denied.resolve(undefined)
    if (!await wait(this.allowEscalation.promise, options.signal)) return
    this.escalationCalls += 1
    assert.equal(this.escalationCalls, 1, 'the escalated write must remain pending until ordinary cancellation')
    yield* tool(APPROVAL_ID, 'write', { file_path, content: AFTER,
      sandbox_permissions: 'workspace-write', justification: JUSTIFICATION })
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

async function run(ctx: Context, model: ApprovalModel): Promise<Record<string, unknown>> {
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
    await ctx.teamRuns.cancel(handle.teamId)
    const terminalFrame = await resolved.promise
    assert.deepEqual(terminalFrame, { type: 'approval/resolved', sessionId: worker.session.id,
      approvalId: frame.payload.approvalId, outcome: 'cancelled' })
    const terminal = await ctx.teams.getTeam({ teamId: handle.teamId })
    assert.equal(terminal.team.phase, 'cancelled')
    const cancelled = terminal.humanActions![0]!
    assert.deepEqual(cancelled, { ...pending, phase: 'cancelled', outcome: { kind: 'team-cancelled' }, updatedAt: cancelled.updatedAt })
    assert.equal(await readFile(path, 'utf8'), BEFORE)
    const decisions = worker.session.events.filter(event => event.type === 'approval/decided')
    assert.equal(decisions.length, 1)
    assert.deepEqual(decisions[0]!.data, { id: frame.payload.approvalId, outcome: 'cancelled' })
    const finalHistory = await actions(ctx, handle.teamId)
    assert.equal(finalHistory.length, 2)
    assert.deepEqual(finalHistory[0], history[0])
    assert.deepEqual(finalHistory[1]!.facts.action, cancelled)
    assert.deepEqual(frames, ['approval/requested', 'approval/resolved'])
    return { scenario: 'human-approval-producer', gateway: 'ApiProxyService', operation: 'write approval.txt',
      standingMode: 'read-only', firstWrite: denialCode, requestedMode: 'workspace-write',
      approvalToolCalls: model.escalationCalls, callId: frame.payload.callId, reason: frame.payload.reason,
      pendingKind: pending.kind, pendingPhase: pending.phase,
      approvalAuditCorrelated: true, sourceIdIsApprovalId: true, taskAndSessionCorrelated: true,
      pendingRegistryReplay: true, mux: frames, finalAction: cancelled.phase, outcome: cancelled.outcome,
      approvalDecision: 'cancelled', historyRecords: finalHistory.length, originalPendingRetained: true,
      fileBefore: BEFORE, fileAfter: await readFile(path, 'utf8'), team: terminal.team.phase }
  } finally { muxAbort.abort(); await pump }
}

/** Test-only Loader identity. */
export const name = 'human-approval-driver'
/** The real Host, approval service, file policy and Team owners precede the producer. */
export const inject = ['apiProxy', 'teamRuns', 'teams', 'llm', 'agents', 'sessions', 'approval', 'sandboxPolicy']
/** Run the actual denied write, approval wait, and public cancellation. @param ctx - Loader context. */
export function apply(ctx: Context): void {
  const model = new ApprovalModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void run(ctx, model).then((output) => { process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); exit(0) }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
