/** A real completed worker attempt awaits review when its Host loses terminal intent ownership. */
import assert from 'node:assert/strict'
import { writeSync } from 'node:fs'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { CallId, LlmAdapter, resolveRetryPolicy } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from '@clocky/clocky-llm'
import { channelPostIdempotencyKeySchema, teamIdSchema } from '@clocky/clocky-team'
import type { TeamEnvelope, TeamId, TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-team'
import { CONSULT_RESPONSE_KIND, CONSULT_REVIEW_REQUEST_KIND } from '@clocky/clocky-team-channel-basic'
import type {} from '@clocky/clocky-storage-log'
import type {} from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-team-closure-driver'

const MODEL = 'review-terminal-model'
const INPUT = 'START_REVIEW_RESOURCE'
const RESULT = 'The assigned source file requires no changes.'
const FAILURE = { code: 'REVIEW_TERMINAL_FAILURE', message: 'The coordinator failed while a completed task awaited review.' }

/** Independent Host role and real terminal intent producer. */
export interface Config { readonly stage: 'crash' | 'recover'; readonly outcome: 'failure' | 'cancellation'; readonly teamId?: string }
/** Validate the process configuration before selecting an owner. */
export const Config: z<Config> = z.object({
  stage: z.union(['crash', 'recover'] as const).required(),
  outcome: z.union(['failure', 'cancellation'] as const).required(), teamId: z.string(),
})

function text(text: string): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }]
}

function tool(name: string, args: Record<string, unknown>): StreamChunk[] {
  const id = CallId(`review-terminal-${name}`)
  const argumentsText = JSON.stringify(args)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}

function hasCall(messages: GenerateOptions['messages'], name: string): boolean {
  return messages.some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && block.name === name))
}

function userText(messages: GenerateOptions['messages']): string {
  return messages.filter(message => message.role === 'user').flatMap(message => message.content)
    .filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/** Only external model waits are controlled, and each respects actual request cancellation. */
async function released(gate: Promise<undefined>, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return false
  const abort = Promise.withResolvers<undefined>()
  const stop = (): void => { abort.resolve(undefined) }
  signal?.addEventListener('abort', stop, { once: true })
  try { return await Promise.race([gate.then(() => true), abort.promise.then(() => false)]) }
  finally { signal?.removeEventListener('abort', stop) }
}

/** Real task tools produce all assignments, completion facts, provider publications and review requests. */
class ReviewModel extends LlmAdapter {
  readonly fail = Promise.withResolvers<undefined>()
  readonly reviewerStarted = Promise.withResolvers<undefined>()
  readonly reviewHold = Promise.withResolvers<undefined>()
  requests = 0

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }
  override providerRetryPolicy(): ResolvedRetryPolicy {
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'review-terminal model')
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') { yield* text('Review resource recovery'); return }
    this.requests += 1
    const input = userText(options.messages)
    if (input.includes(INPUT)) {
      if (!hasCall(options.messages, 'team_task_start')) {
        yield* tool('team_task_start', { subject: 'Leave one completed task awaiting review.',
          instructions: 'Report completion without editing source.txt.', read_scopes: ['source.txt'], write_scopes: ['source.txt'] })
      } else if (await released(this.fail.promise, options.signal)) {
        yield { type: 'finish', reason: { kind: 'error', failure: FAILURE } }
      }
      return
    }
    if (input.includes('Review Team task ')) {
      this.reviewerStarted.resolve(undefined)
      await released(this.reviewHold.promise, options.signal)
      return
    }
    const assigned = /\nTask: (\S+)\nAttempt: (\S+)/u.exec(input)
    assert(assigned?.[1] !== undefined && assigned[2] !== undefined, 'worker must receive the real task assignment')
    if (hasCall(options.messages, 'team_task_report')) { yield* text('Worker report recorded.'); return }
    yield* tool('team_task_report', { task_id: assigned[1], attempt_id: assigned[2], outcome: 'completed', summary: RESULT,
      evidence: ['The source file was left unchanged.'], verification: 'No file edits were required.' })
  }
}

function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

/** Freeze the actual review resource only after its worker allocation has released. */
async function readyReview(ctx: Context, teamId: TeamId): Promise<{ state: TeamStateSnapshot; task: TeamTaskSnapshot }> {
  for (;;) {
    const state = await ctx.teams.getTeam({ teamId })
    assert.equal(state.team.phase, 'active')
    const task = state.tasks[0]
    if (task?.phase === 'review' && state.workspaceAllocations.length === 1
      && state.workspaceAllocations.every(allocation => allocation.lifecycle === 'released')) return { state, task }
    await ctx.teams.watchTeam({ teamId, afterCursor: state.team.cursor })
  }
}

/** Read the scheduler's exact consult request and wait for the reviewer's actual receipt. */
async function reviewRequest(ctx: Context, state: TeamStateSnapshot, task: TeamTaskSnapshot): Promise<TeamEnvelope> {
  assert(task.reviewPolicy.kind === 'participant')
  const reviewerId = task.reviewPolicy.reviewerId
  for (const channelId of state.channelIds) {
    const read = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
    const entry = read.records.find(record => record.type === 'channel/envelope'
      && record.envelope.kind === CONSULT_REVIEW_REQUEST_KIND && record.envelope.taskId === task.id)
    if (entry?.type !== 'channel/envelope') continue
    const envelope = entry.envelope
    assert.deepEqual(envelope.audience, [reviewerId])
    assert.equal(envelope.payload.attemptId, task.attemptHistory[0]?.id)
    assert.equal(envelope.payload.reviewRevision, task.revision)
    const attempt = task.attemptHistory[0]!
    assert(attempt.outcome.kind === 'completed')
    assert.deepEqual(envelope.payload.result, attempt.outcome.result)
    let cursor = -1
    for (;;) {
      const current = await ctx.teams.readChannel({ channelId, afterCursor: cursor })
      if (current.records.some(record => record.type === 'channel/receipt'
        && record.envelopeId === envelope.id && record.participantId === reviewerId)) return envelope
      cursor = current.channel.cursor
      await ctx.teams.watchChannel({ channelId, afterCursor: cursor })
    }
  }
  throw new Error('the running reviewer has no durable consult request')
}

/** Kill only after the real owner's terminal intent append has succeeded. */
function crashOnIntent(ctx: Context, config: Config) {
  let checkpoint: { readonly task: TeamTaskSnapshot; readonly review: TeamEnvelope } | undefined
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
          assert.equal(descriptor.name, `team/${checkpoint.task.teamId}`)
          writeSync(1, `${JSON.stringify({ stage: 'crash', pid: process.pid, outcome: config.outcome,
            stream: descriptor.name, tail: result.tailSequence, ...checkpoint })}\n`)
          process.kill(process.pid, 'SIGKILL')
          await new Promise<never>(() => {})
        }
        return result
      }
      return stream
    }
    return () => { log.open = open }
  }, 'review-terminal: committed intent crash')
  return (value: NonNullable<typeof checkpoint>): void => { checkpoint = value }
}

async function crash(ctx: Context, config: Config, model: ReviewModel): Promise<never> {
  const arm = crashOnIntent(ctx, config)
  await ctx.get('loader')?.await()
  const handle = await ctx.teamRuns.create({ objective: 'Retain a completed task when review is cancelled after Host loss.',
    cwd: process.cwd(), selection: { provider: MODEL, model: MODEL } })
  await ctx.teamRuns.postHumanInput({ teamId: handle.teamId,
    idempotencyKey: channelPostIdempotencyKeySchema.parse('review-terminal-input'), content: [{ type: 'text', text: INPUT }] })
  await model.reviewerStarted.promise
  const { state, task } = await readyReview(ctx, handle.teamId)
  const review = await reviewRequest(ctx, state, task)
  const reviewer = state.activations.find(binding => task.reviewPolicy.kind === 'participant'
    && binding.activation.participantId === task.reviewPolicy.reviewerId)
  assert(reviewer !== undefined)
  const reviewerAgent = ctx.agents.get(reviewer.sessionId)
  assert(reviewerAgent !== undefined)
  await ctx.sessions.flush(reviewerAgent.session)
  assert(reviewerAgent.session.events.some(event => event.type === 'team/channel-view' && event.data.channelId === review.channelId))
  arm({ task, review })
  if (config.outcome === 'cancellation') {
    await ctx.teamRuns.cancel(handle.teamId)
    throw new Error('cancellation passed its durable intent crash window')
  }
  model.fail.resolve(undefined)
  for (;;) {
    const latest = await ctx.teams.getTeam({ teamId: handle.teamId })
    assert.equal(latest.team.phase, 'active')
    await ctx.teams.watchTeam({ teamId: handle.teamId, afterCursor: latest.team.cursor })
  }
}

async function recover(ctx: Context, config: Config, model: ReviewModel): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  const state = await ctx.teams.getTeam({ teamId: teamIdSchema.parse(config.teamId) })
  assert.equal(state.tasks.length, 1)
  const task = state.tasks[0]!
  assert.equal(task.phase, 'cancelled')
  assert.equal(task.attemptHistory.length, 1)
  assert.equal(task.attemptCount, 1)
  assert.equal(task.lease, undefined)
  assert.deepEqual(task.reviewHistory, [])
  assert(task.reviewPolicy.kind === 'participant')
  const attempt = task.attemptHistory[0]!
  assert(attempt.outcome.kind === 'completed')
  assert.equal(attempt.outcome.result.summary, RESULT)
  assert.equal(state.goal.phase, 'active')
  assert.equal(state.team.phase, 'stalled')
  assert.equal(state.team.stallReason?.code, 'ACTIVATION_TERMINATION_UNCONFIRMED')
  const unresolved = state.activations.find(binding => state.team.stallReason?.message.includes(binding.activation.id))
  assert(unresolved !== undefined && unresolved.quiescedAt === undefined && unresolved.recovery === undefined)
  assert.equal(state.workspaceAllocations.length, 1)
  assert.equal(state.workspaceAllocations[0]!.lifecycle, 'released')
  assert.equal(state.workspaceAllocations[0]!.attemptId, attempt.id)
  const requests: TeamEnvelope[] = []
  for (const channelId of state.channelIds) {
    const channel = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
    const envelopes = channel.records.filter(record => record.type === 'channel/envelope').map(record => record.envelope)
    requests.push(...envelopes.filter(envelope => envelope.kind === CONSULT_REVIEW_REQUEST_KIND))
    assert(!envelopes.some(envelope => envelope.kind === CONSULT_RESPONSE_KIND))
  }
  assert.equal(requests.length, 1)
  assert.equal(requests[0]!.payload.taskId, task.id)
  assert.deepEqual(requests[0]!.payload.result, attempt.outcome.result)
  if (config.outcome === 'failure') {
    assert.equal(state.team.closure?.kind, 'fail')
    assert.deepEqual(state.team.closure.reason, FAILURE)
    assert.equal(state.team.cancellation, undefined)
  } else {
    assert.equal(state.team.cancellation?.reason.code, 'USER_CANCELLED')
    assert.equal(state.team.closure, undefined)
  }
  assert.equal(model.requests, 0)
  return { stage: 'recover', pid: process.pid, outcome: config.outcome, task: task.phase,
    completedAttempts: task.attemptHistory.length, result: attempt.outcome.result.summary, reviewPolicy: task.reviewPolicy.kind,
    reviewDecisions: task.reviewHistory.length, retainedReviewRequests: requests.length, workspace: 'released',
    team: state.team.phase, goal: state.goal.phase, stallCode: state.team.stallReason.code, exactUnprovenEpoch: true,
    modelRequests: model.requests }
}

/** Test-only Loader identity. */
export const name = 'review-terminal-driver'
/** Actual task, Session, durable stream and closure owners. */
export const inject = ['teamRuns', 'teams', 'storageLog', 'llm', 'agents', 'sessions', 'teamClosureDriver']
/** Drive one real Host role. @param ctx - Loader context. @param config - role and terminal outcome. */
export function apply(ctx: Context, config: Config): void {
  const model = new ReviewModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  const operation = config.stage === 'crash' ? crash(ctx, config, model) : recover(ctx, config, model)
  void operation.then((output) => { process.stdout.write(`${JSON.stringify(output)}\n`); exit(0) }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
