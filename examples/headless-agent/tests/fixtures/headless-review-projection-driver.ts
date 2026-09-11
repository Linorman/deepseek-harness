/** Real model tools expose current-attempt review facts through the assembled Team profile. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { channelPostIdempotencyKeySchema } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-run'

const MODEL = 'review-projection-model'
const INPUT = 'VERIFY_COORDINATOR_REVIEW_FACTS'
type Mode = 'none' | 'review' | 'rework'
interface Value {
  task_id: string
  phase: string
  review_policy: { kind: 'none' | 'participant'; reviewer_id?: string }
  review_result: { attempt_id: string; decision: 'accepted' | 'rework' } | null
}

function chunks(name: string, id: string, args: Record<string, unknown>): StreamChunk[] {
  const callId = CallId(id)
  const argumentsText = JSON.stringify(args)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}

function text(): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Recorded.' } },
    { type: 'finish', reason: { kind: 'stop' } }]
}

function result(options: GenerateOptions, id: string): unknown {
  for (const message of options.messages) {
    for (const block of message.content) {
      if (block.type !== 'tool-result' || block.toolCallId !== id) continue
      assert(!block.isError, JSON.stringify(block))
      const content = block.content.find(part => part.type === 'text')
      assert(content?.type === 'text')
      return JSON.parse(content.text) as unknown
    }
  }
  return undefined
}

/** Bound only the deterministic external model's response, respecting actual request cancellation. */
async function released(gate: Promise<undefined>, signal: AbortSignal | undefined): Promise<void> {
  signal?.throwIfAborted()
  const aborted = Promise.withResolvers<never>()
  const abort = (): void => { aborted.reject(signal?.reason) }
  signal?.addEventListener('abort', abort, { once: true })
  try { await Promise.race([gate, aborted.promise]) }
  finally { signal?.removeEventListener('abort', abort) }
}

class ReviewProjectionModel extends LlmAdapter {
  readonly attempts: string[] = []
  readonly firstReviewDecided = Promise.withResolvers<undefined>()
  readonly releaseFirst = Promise.withResolvers<undefined>()
  readonly secondStarted = Promise.withResolvers<undefined>()
  readonly releaseSecond = Promise.withResolvers<undefined>()
  readonly observations: Record<string, unknown>[] = []
  readonly descriptions: Record<string, string> = {}
  readonly reviewerIds = new Set<string>()
  readonly mode: Mode
  constructor(mode: Mode) { super(); this.mode = mode }

  observe(stage: string, value: Value): void {
    assert.equal(value.review_policy.kind, this.mode === 'none' ? 'none' : 'participant')
    if (value.review_policy.kind === 'participant') {
      assert(typeof value.review_policy.reviewer_id === 'string')
      this.reviewerIds.add(value.review_policy.reviewer_id)
    }
    this.observations.push({ stage, review_policy: value.review_policy.kind,
      review_result: value.review_result === null ? null : { decision: value.review_result.decision,
        attempt: this.attempts.indexOf(value.review_result.attempt_id) + 1 } })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') { yield* text(); return }
    const input = options.messages.filter(message => message.role === 'user').flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (input.includes(INPUT)) {
      for (const name of ['team_task_start', 'team_task_list', 'team_task_watch', 'team_task_wait']) {
        const tool = options.tools?.find(candidate => candidate.name === name)
        assert(tool !== undefined)
        this.descriptions[name] = tool.description
      }
      const start = result(options, 'start') as Value | undefined
      if (start === undefined) {
        yield* chunks('team_task_start', 'start', { subject: 'Verify the review projection.', instructions: 'Report the assigned work.',
          read_scopes: ['task.txt'], write_scopes: this.mode === 'none' ? [] : ['task.txt'] })
        return
      }
      const reworked = result(options, 'list-rework') as { tasks: Value[] } | undefined
      if (this.mode === 'rework' && reworked === undefined) {
        this.observe('start', start)
        assert.equal(start.review_result, null)
        await released(this.firstReviewDecided.promise, options.signal)
        yield* chunks('team_task_list', 'list-rework', {})
        return
      }
      const listed = result(options, 'list') as { tasks: Value[] } | undefined
      if (listed === undefined) {
        if (this.mode !== 'rework') this.observe('start', start)
        assert.equal(start.review_result, null)
        if (this.mode === 'rework') {
          const previous = reworked!.tasks[0]!
          this.observe('rework', previous)
          assert.equal(previous.phase, 'pending')
          assert.deepEqual(previous.review_result, { attempt_id: this.attempts[0], decision: 'rework' })
          this.releaseFirst.resolve(undefined)
          await released(this.secondStarted.promise, options.signal)
        }
        yield* chunks('team_task_list', 'list', {})
        return
      }
      const watched = result(options, 'watch') as { tasks: Value[] } | undefined
      if (watched === undefined) {
        assert.equal(listed.tasks.length, 1)
        this.observe('list', listed.tasks[0]!)
        if (this.mode === 'rework') {
          assert.equal(listed.tasks[0]!.phase, 'running')
          assert.equal(listed.tasks[0]!.review_result, null, 'the new running attempt must not inherit its predecessor review')
        }
        yield* chunks('team_task_watch', 'watch', {})
        return
      }
      const waited = result(options, 'wait') as Value | undefined
      if (waited === undefined) {
        this.observe('watch', watched.tasks[0]!)
        if (this.mode === 'rework') assert.equal(watched.tasks[0]!.review_result, null)
        this.releaseSecond.resolve(undefined)
        yield* chunks('team_task_wait', 'wait', { task_id: start.task_id })
        return
      }
      if (result(options, 'final') === undefined) {
        this.observe('wait', waited)
        assert.equal(waited.phase, 'completed')
        if (this.mode === 'none') assert.equal(waited.review_result, null)
        else assert.deepEqual(waited.review_result, { attempt_id: this.attempts.at(-1), decision: 'accepted' })
        const channel = /call team_final with channel_id (\S+) and/u.exec(options.system ?? '')?.[1]
        assert(channel !== undefined)
        yield* chunks('team_final', 'final', { channel_id: channel, text: 'REVIEW_PROJECTION_VERIFIED' })
      } else yield* text()
      return
    }
    if (input.includes('Review Team task ')) {
      const taskId = [...input.matchAll(/Review Team task ([^:]+):/gu)].at(-1)?.[1]
      const attemptId = [...input.matchAll(/"attemptId":"([^"]+)"/gu)].at(-1)?.[1]
      assert(taskId !== undefined && attemptId !== undefined)
      const id = `review-${attemptId}`
      if (result(options, id) !== undefined) {
        if (this.mode === 'rework' && attemptId === this.attempts[0]) this.firstReviewDecided.resolve(undefined)
        yield* text(); return
      }
      yield* chunks('team_task_review', id, { task_id: taskId,
        decision: this.mode === 'rework' && attemptId === this.attempts[0] ? 'rework' : 'accepted',
        reason: 'Review the current assigned attempt.' })
      return
    }
    const assignment = [...input.matchAll(/\nTask: (\S+)\nAttempt: (\S+)/gu)].at(-1)
    assert(assignment?.[1] !== undefined && assignment[2] !== undefined)
    const [, taskId, attemptId] = assignment
    if (!this.attempts.includes(attemptId)) this.attempts.push(attemptId)
    const id = `report-${attemptId}`
    if (result(options, id) !== undefined) {
      if (this.mode === 'rework' && attemptId === this.attempts[0]) await released(this.releaseFirst.promise, options.signal)
      yield* text(); return
    }
    if (this.mode !== 'rework') await released(this.releaseSecond.promise, options.signal)
    if (this.mode === 'rework' && this.attempts.length === 2) {
      this.secondStarted.resolve(undefined)
      await released(this.releaseSecond.promise, options.signal)
    }
    yield* chunks('team_task_report', id, { task_id: taskId, attempt_id: attemptId, outcome: 'completed', summary: 'Assigned work completed.' })
  }
}

/** Test-only Loader identity. */
export const name = 'review-projection-driver'
/** Real Team owner and model registry are resolved by the Loader. */
export const inject = ['teamRuns', 'teams', 'llm']
/** Run one configured real task and inspect its durable review lineage. @param ctx - Loader context. */
export function apply(ctx: Context): void {
  const mode = process.env.CLOCKY_REVIEW_MODE
  assert(mode === 'none' || mode === 'review' || mode === 'rework')
  const model = new ReviewProjectionModel(mode)
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  const run = async (): Promise<void> => {
    await ctx.get('loader')?.await()
    const started = await ctx.teamRuns.start({ objective: INPUT, cwd: process.cwd(), idempotencyKey: channelPostIdempotencyKeySchema.parse('review-projection-start'), content: [{ type: 'text', text: INPUT }] })
    const final = await ctx.teamRuns.waitForFinal({ teamId: started.handle.teamId })
    assert.equal(final.text, 'REVIEW_PROJECTION_VERIFIED')
    const state = await ctx.teams.getTeam({ teamId: started.handle.teamId })
    assert.equal(state.team.phase, 'completed')
    const task = state.tasks[0]!
    assert.deepEqual([...model.reviewerIds], task.reviewPolicy.kind === 'none' ? [] : [task.reviewPolicy.reviewerId])
    assert.equal(task.attemptHistory.length, mode === 'rework' ? 2 : 1)
    assert.deepEqual(task.reviewHistory.map(review => review.nextPhase), mode === 'none' ? [] : mode === 'rework' ? ['pending', 'completed'] : ['completed'])
    assert.deepEqual(task.attemptHistory.map(attempt => attempt.id), model.attempts)
    for (const review of task.reviewHistory) assert(model.attempts.includes(review.attemptId))
    process.stdout.write(`${JSON.stringify({ mode, descriptions: model.descriptions, observations: model.observations,
      attempts: task.attemptHistory.length, reviewDecisions: task.reviewHistory.map(review => review.nextPhase), team: state.team.phase }, null, 2)}\n`)
  }
  void run().then(() => { exit(0) }, (error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); exit(1) })
}
