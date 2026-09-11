/** Actual Host question admission and public TeamRun cancellation through a real worker tool. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { ApiProxyService, RpcId } from '@clocky/clocky-host-apiproxy'
import type { MuxFrame, RpcRequest } from '@clocky/clocky-host-apiproxy'
import { channelPostIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamId } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-run'

/** Deterministic external model route shared by genuine Host compositions. */
export const MODEL = 'human-question-model'
/** Real coordinator input shared by the producer and its Host-loss consumer. */
export const INPUT = 'START_PENDING_HUMAN_QUESTION'
/** Stable external model call id for the one actual question tool. */
export const ASK_ID = CallId('human-question-worker-ask')
/** Model-authored question batch validated by the real UserQuestions and Host providers. */
export const QUESTIONS = [{ id: 'format', header: 'Format', question: 'Which output format should this task use?',
  options: [{ label: 'Text', description: 'Return a plain text result.' }, { label: 'JSON', description: 'Return a structured JSON result.' }] }]
type Requested = Extract<MuxFrame, { type: 'question/requested' }>
type Resolved = Extract<MuxFrame, { type: 'question/resolved' }>

function tool(id: CallId, name: string, args: Record<string, unknown>): StreamChunk[] {
  const json = JSON.stringify(args)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: json },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: json } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}

async function wait(gate: Promise<undefined>, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return false
  const aborted = Promise.withResolvers<undefined>()
  const abort = (): void => { aborted.resolve(undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try { return await Promise.race([gate.then(() => true), aborted.promise.then(() => false)]) }
  finally { signal?.removeEventListener('abort', abort) }
}

/** External model emits the real task and question calls, then waits for ordinary cancellation. */
export class QuestionModel extends LlmAdapter {
  readonly workerStarted = Promise.withResolvers<{ taskId: string; attemptId: string }>()
  readonly allowQuestion = Promise.withResolvers<undefined>()
  readonly holdCoordinator = Promise.withResolvers<undefined>()
  askCalls = 0

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Pending human question' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const text = options.messages.filter(message => message.role === 'user').flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (text.includes(INPUT)) {
      const started = options.messages.some(message => message.role === 'assistant'
        && message.content.some(block => block.type === 'tool-call' && block.name === 'team_task_start'))
      if (!started) yield* tool(CallId('human-question-task-start'), 'team_task_start', {
        subject: 'Ask the user for an output format.',
        instructions: 'Use ask_user_question to request an output format. Wait for the answer before reporting.',
        read_scopes: [], write_scopes: [],
      })
      else await wait(this.holdCoordinator.promise, options.signal)
      return
    }
    const assignment = /\nTask: (\S+)\nAttempt: (\S+)/u.exec(text)
    assert(assignment?.[1] !== undefined && assignment[2] !== undefined)
    this.workerStarted.resolve({ taskId: assignment[1], attemptId: assignment[2] })
    if (!await wait(this.allowQuestion.promise, options.signal)) return
    this.askCalls += 1
    assert.equal(this.askCalls, 1, 'the actual question tool must wait for its owner cancellation')
    yield* tool(ASK_ID, 'ask_user_question', { questions: QUESTIONS })
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

/**
 * Produce a real pending question, then complete public TeamRun cancellation.
 * @param ctx - composed formal Host and Team context.
 * @param model - deterministic external model registered by the caller.
 * @returns verified model, question, provenance, history and cancellation observations.
 */
export async function runQuestionProducer(ctx: Context, model: QuestionModel): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  assert(ctx.apiProxy instanceof ApiProxyService)
  const muxAbort = new AbortController()
  const requested = Promise.withResolvers<RpcRequest<Requested>>()
  const resolved = Promise.withResolvers<Resolved>()
  const frames: string[] = []
  const pump = (async () => {
    for await (const frame of ctx.apiProxy.events.mux({ rpcId: RpcId('human-question-observer'), payload: {} }, muxAbort.signal)) {
      if (frame.payload.type === 'question/requested') {
        frames.push(frame.payload.type)
        requested.resolve({ rpcId: frame.rpcId, payload: frame.payload })
      }
      if (frame.payload.type === 'question/resolved') {
        frames.push(frame.payload.type)
        resolved.resolve(frame.payload)
      }
    }
  })()
  void pump.catch((error: unknown) => { requested.reject(error); resolved.reject(error) })
  const stopErrors = ctx.on('session/event', (_session, event) => {
    if (event.type !== 'tool/result' || event.data.message.source.callId !== ASK_ID) return
    const result = event.data.message.content[0]
    if (result.isError === true && !muxAbort.signal.aborted) {
      requested.reject(new Error(`actual ask_user_question failed: ${JSON.stringify(result.content)}`))
    }
  })
  try {
    const handle = await ctx.teamRuns.create({ objective: 'Ask one human question through the real Host provider.',
      cwd: process.cwd(), selection: { provider: MODEL, model: MODEL } })
    await ctx.teamRuns.postHumanInput({ teamId: handle.teamId,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('human-question-input'), content: [{ type: 'text', text: INPUT }] })
    const started = await model.workerStarted.promise
    const state = await ctx.teams.getTeam({ teamId: handle.teamId })
    const task = state.tasks.find(candidate => candidate.id === started.taskId)
    assert(task?.lease !== undefined)
    assert.equal(task.lease.attemptId, started.attemptId)
    const binding = state.activations.find(candidate => candidate.activation.id === task.lease!.activationId)
    assert(binding !== undefined)
    const worker = ctx.agents.get(binding.sessionId)
    assert(worker !== undefined && ctx.agents.roots().includes(worker), 'the genuine native worker must be a live runtime root')
    model.allowQuestion.resolve(undefined)
    const frame = await requested.promise
    assert.equal(frame.payload.sessionId, worker.session.id)
    assert.equal(frame.payload.teamId, handle.teamId)
    assert.equal(frame.payload.participantId, binding.activation.participantId)
    assert.equal(frame.payload.taskId, task.id)
    assert.deepEqual(frame.payload.questions, QUESTIONS)
    await ctx.sessions.flush(worker.session)
    assert(worker.session.events.some(event => event.type === 'tool/call' && event.data.name === 'ask_user_question'))
    const pendingState = await ctx.teams.getTeam({ teamId: handle.teamId })
    assert.equal(pendingState.humanActions?.length, 1)
    const pending = pendingState.humanActions[0]!
    assert.equal(pending.kind, 'question')
    assert.equal(pending.phase, 'pending')
    assert.equal(pending.sourceId, frame.rpcId)
    assert.equal(pending.id, `question:${worker.session.id}:${frame.rpcId}`)
    assert.equal(pending.sessionId, worker.session.id)
    assert.equal(pending.participantId, binding.activation.participantId)
    assert.equal(pending.taskId, task.id)
    assert.deepEqual(pending.details, { questionRpcId: frame.rpcId, questions: QUESTIONS })
    const history = await actions(ctx, handle.teamId)
    assert.equal(history.length, 1)
    assert.deepEqual(history[0]!.facts.action, pending)
    await ctx.teamRuns.cancel(handle.teamId)
    const terminalFrame = await resolved.promise
    assert.equal(terminalFrame.questionRpcId, frame.rpcId)
    assert.equal(terminalFrame.outcome, 'cancelled')
    const terminal = await ctx.teams.getTeam({ teamId: handle.teamId })
    assert.equal(terminal.team.phase, 'cancelled')
    assert.equal(terminal.goal.phase, 'active')
    const cancelled = terminal.humanActions![0]!
    assert.equal(cancelled.phase, 'cancelled')
    assert.deepEqual(cancelled.outcome, { kind: 'team-cancelled' })
    const { phase: _phase, updatedAt: _updatedAt, outcome: _outcome, ...identity } = cancelled
    const { phase: _pendingPhase, updatedAt: _pendingUpdatedAt, ...original } = pending
    assert.deepEqual(identity, original)
    const finalHistory = await actions(ctx, handle.teamId)
    assert.equal(finalHistory.length, 2)
    assert.deepEqual(finalHistory[0], history[0])
    assert.deepEqual(finalHistory[1]!.facts.action, cancelled)
    assert.equal(model.askCalls, 1)
    assert.deepEqual(frames, ['question/requested', 'question/resolved'])
    return { scenario: 'human-question-producer', gateway: 'ApiProxyService', questionToolCalls: model.askCalls,
      caller: 'live-native-worker-root', pendingKind: pending.kind, pendingPhase: pending.phase,
      questions: frame.payload.questions, sourceIdCorrelated: true, taskAndSessionCorrelated: true,
      mux: frames, finalAction: cancelled.phase, outcome: cancelled.outcome, historyRecords: finalHistory.length,
      originalPendingRetained: true, team: terminal.team.phase, goal: terminal.goal.phase }
  } finally {
    stopErrors()
    muxAbort.abort()
    await pump
  }
}

/** Test-only Loader identity. */
export const name = 'human-question-driver'
/** The formal Host gateway and the real Team/Agent owners precede the producer. */
export const inject = ['apiProxy', 'teamRuns', 'teams', 'llm', 'agents', 'sessions']
/** Run the actual question producer and public cancellation. @param ctx - Loader context. */
export function apply(ctx: Context): void {
  const model = new QuestionModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void runQuestionProducer(ctx, model).then((output) => { process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); exit(0) }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
