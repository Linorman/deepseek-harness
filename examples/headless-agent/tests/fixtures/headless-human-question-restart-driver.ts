/** A genuine pending Host question is durably cancelled after terminal intent and abrupt Host loss. */
import assert from 'node:assert/strict'
import { writeSync } from 'node:fs'
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
import { ASK_ID, INPUT, QUESTIONS, QuestionModel } from './headless-human-question-driver.ts'

const MODEL = 'human-question-model'
const FAILURE = { code: 'QUESTION_COORDINATOR_FAILURE', message: 'The coordinator failed while a worker awaited a human answer.' }
type Requested = Extract<MuxFrame, { type: 'question/requested' }>

/** Separate Host role and terminal intent producer. */
export interface Config { readonly stage: 'crash' | 'recover'; readonly outcome: 'failure' | 'cancellation'; readonly teamId?: string }
/** Parse process input before selecting durable resources. */
export const Config: z<Config> = z.object({
  stage: z.union(['crash', 'recover'] as const).required(),
  outcome: z.union(['failure', 'cancellation'] as const).required(), teamId: z.string(),
})

/** The shared actual question producer additionally permits a coordinator model failure. */
class FaultModel extends QuestionModel {
  requests = 0
  override providerRetryPolicy(): ResolvedRetryPolicy {
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'human-question restart model')
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
  let checkpoint: { readonly question: TeamHumanActionSnapshot; readonly task: TeamTaskSnapshot } | undefined
  const log = ctx.storageLog
  const open = log.open.bind(log)
  ctx.effect(() => {
    log.open = async (descriptor) => {
      const stream = await open(descriptor)
      if (!descriptor.name.startsWith('team/')) return stream
      const append = stream.append.bind(stream)
      stream.append = async (cursor, values, options) => {
        const result = await append(cursor, values, options)
        const selected = values.some((value) => {
          const record = object(value)
          return config.outcome === 'failure' ? record.type === 'team/closure' && object(record.closure).kind === 'fail'
            : record.type === 'team/cancellation'
        })
        if (selected) {
          assert(checkpoint !== undefined)
          assert.equal(descriptor.name, `team/${checkpoint.question.teamId}`)
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
  }, 'human-question: committed terminal intent crash')
  return (value: NonNullable<typeof checkpoint>): void => { checkpoint = value }
}

async function crash(ctx: Context, config: Config, model: FaultModel): Promise<never> {
  const arm = crashOnIntent(ctx, config)
  await ctx.get('loader')?.await()
  assert(ctx.apiProxy instanceof ApiProxyService)
  const muxAbort = new AbortController()
  const requested = Promise.withResolvers<RpcRequest<Requested>>()
  const pump = (async () => {
    for await (const frame of ctx.apiProxy.events.mux({ rpcId: RpcId('human-question-crash-observer'), payload: {} }, muxAbort.signal)) {
      if (frame.payload.type === 'question/requested') requested.resolve({ rpcId: frame.rpcId, payload: frame.payload })
    }
  })()
  void pump.catch((error: unknown) => { requested.reject(error) })
  const stopErrors = ctx.on('session/event', (_session, event) => {
    if (event.type !== 'tool/result' || event.data.message.source.callId !== ASK_ID) return
    const result = event.data.message.content[0]
    if (result.isError === true) requested.reject(new Error(`actual question failed before Host loss: ${JSON.stringify(result.content)}`))
  })
  try {
    const handle = await ctx.teamRuns.create({ objective: 'Retain a pending human question across Host loss.', cwd: process.cwd(),
      selection: { provider: MODEL, model: MODEL } })
    await ctx.teamRuns.postHumanInput({ teamId: handle.teamId,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('human-question-restart-input'), content: [{ type: 'text', text: INPUT }] })
    const assignment = await model.workerStarted.promise
    const before = await ctx.teams.getTeam({ teamId: handle.teamId })
    const task = before.tasks.find(candidate => candidate.id === assignment.taskId)
    assert(task?.lease !== undefined)
    assert.equal(task.lease.attemptId, assignment.attemptId)
    const binding = before.activations.find(candidate => candidate.activation.id === task.lease!.activationId)
    assert(binding !== undefined)
    const worker = ctx.agents.get(binding.sessionId)
    assert(worker !== undefined && ctx.agents.roots().includes(worker))
    model.allowQuestion.resolve(undefined)
    const frame = await requested.promise
    assert.equal(frame.payload.taskId, task.id)
    assert.equal(frame.payload.participantId, binding.activation.participantId)
    assert.equal(frame.payload.sessionId, worker.session.id)
    assert.deepEqual(frame.payload.questions, QUESTIONS)
    await ctx.sessions.flush(worker.session)
    const state = await ctx.teams.getTeam({ teamId: handle.teamId })
    assert.equal(state.team.phase, 'active')
    assert.equal(state.humanActions?.length, 1)
    const question = state.humanActions[0]!
    assert.deepEqual(await ctx.teams.getHumanAction({ teamId: state.team.id, actionId: question.id }), question)
    assert.equal(question.phase, 'pending')
    assert.equal(question.kind, 'question')
    assert.equal(question.sourceId, frame.rpcId)
    assert.equal(question.id, `question:${worker.session.id}:${frame.rpcId}`)
    assert.equal(question.taskId, task.id)
    assert.deepEqual(question.details, { questionRpcId: frame.rpcId, questions: QUESTIONS })
    assert.equal(state.workspaceAllocations.length, 1)
    assert.equal(state.workspaceAllocations[0]!.lifecycle, 'active')
    const currentTask = state.tasks[0]!
    assert.equal(currentTask.phase, 'running')
    arm({ question, task: currentTask })
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
  const question = state.humanActions[0]!
  assert.deepEqual(await ctx.teams.getHumanAction({ teamId: state.team.id, actionId: question.id }), question)
  assert.equal(question.kind, 'question')
  assert.equal(question.phase, 'cancelled')
  assert.deepEqual(question.details, { questionRpcId: question.sourceId, questions: QUESTIONS })
  assert.deepEqual(question.outcome, config.outcome === 'failure' ? { kind: 'team-failed', reason: FAILURE } : { kind: 'team-cancelled' })
  assert.equal(state.team.phase, 'stalled')
  assert.equal(state.goal.phase, 'active')
  assert.equal(state.team.stallReason?.code, 'ACTIVATION_TERMINATION_UNCONFIRMED')
  assert.equal(state.activations.length, 2)
  assert(state.activations.every(binding => binding.quiescedAt === undefined && binding.recovery === undefined))
  assert(state.activations.some(binding => state.team.stallReason!.message.includes(binding.activation.id)))
  assert.equal(state.tasks.length, 1)
  const task = state.tasks[0]!
  assert.equal(task.id, question.taskId)
  assert.equal(task.phase, 'running')
  assert.equal(task.attemptCount, 1)
  assert.equal(task.attemptHistory.length, 0)
  assert(task.lease !== undefined)
  assert.equal(task.lease.participantId, question.participantId)
  assert.equal(state.workspaceAllocations.length, 1)
  const allocation = state.workspaceAllocations[0]!
  assert.equal(allocation.lifecycle, 'active')
  assert.equal(allocation.taskId, task.id)
  assert.equal(allocation.attemptId, task.lease.attemptId)
  assert.equal(allocation.sessionId, question.sessionId)
  assert.equal(model.requests, 0)
  assert.equal(model.askCalls, 0)
  return { stage: 'recover', outcome: config.outcome, pid: process.pid, question: question.kind,
    questionPhase: question.phase, questionOutcome: question.outcome, detailsRetained: true,
    task: task.phase, taskAttempt: 'retained-unsettled', workspace: allocation.lifecycle,
    oldEpochs: state.activations.length, quiescedEpochs: 0, team: state.team.phase, goal: state.goal.phase,
    stallCode: state.team.stallReason.code, exactUnprovenEpoch: true, modelRequests: model.requests, newQuestionCalls: model.askCalls }
}

/** Test-only Loader identity. */
export const name = 'human-question-restart-driver'
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
