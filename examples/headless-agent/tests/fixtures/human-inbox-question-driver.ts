/** Real worker question resumes from an authenticated principal inbox response. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { InProcessApiClient, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import type { RpcResponse } from '@clocky/clocky-host-apiproxy'
import { teamHumanActionResponseIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamHumanInboxAction } from '@clocky/clocky-team'
import { QuestionModel, MODEL, INPUT, ASK_ID } from './headless-human-question-driver.ts'

class AnswerModel extends QuestionModel {
  readonly sawAnswer = Promise.withResolvers<string>()
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const result = options.messages.flatMap(message => message.content)
      .find(block => block.type === 'tool-result' && block.toolCallId === ASK_ID)
    if (result?.type === 'tool-result') {
      assert(result.isError !== true)
      this.sawAnswer.resolve(JSON.stringify(result.content))
      const signal = options.signal
      assert(signal !== undefined)
      if (signal.aborted) return
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { resolve() }, { once: true }))
      return
    }
    yield* super.stream(options)
  }
}
function value<T>(response: RpcResponse<T>): T {
  assert(response.result.ok, JSON.stringify(response.result))
  return response.result.value
}
async function run(ctx: Context, model: AnswerModel) {
  await ctx.get('loader')?.await()
  const lease = await ctx.productPrincipals.authenticate({ provider: 'human-inbox-fixture', credential: 'keyless-human-inbox' })
  try {
    return await lease.withCall(async (call) => {
      const client = new InProcessApiClient(toFetchHandler(ctx.apiProxy, { authenticatedProductCall: call }))
      const state = value(await client.teams.create({ objective: 'Answer the worker through the durable human inbox.', cwd: process.cwd() }))
      value(await client.teams.postInput({ teamId: state.team.id, text: INPUT }))
      const started = await model.workerStarted.promise
      model.allowQuestion.resolve(undefined)
      let cursor = -1
      let delivered: TeamHumanInboxAction | undefined
      while (delivered === undefined) {
        const page = value(await client.teams.inboxWatch({ afterCursor: cursor, limit: 8 }))
        delivered = page.items.find((item): item is TeamHumanInboxAction => item.kind === 'action' && item.action.phase === 'pending')
        cursor = page.cursor
      }
      assert.equal(delivered.action.taskId, started.taskId)
      assert.equal(delivered.action.attemptId, started.attemptId)
      const answer = { kind: 'question' as const, answers: [{ id: 'format', selected: ['Text'] }] }
      const request = { teamId: state.team.id, actionId: delivered.action.id, expectedUpdatedAt: delivered.action.updatedAt,
        idempotencyKey: teamHumanActionResponseIdempotencyKeySchema.parse('snapshot-human-answer'), answer }
      const response = value(await client.teams.inboxRespond(request))
      assert.equal(response.kind, 'accepted')
      assert((await model.sawAnswer.promise).includes('Text'))
      const worker = ctx.agents.get(delivered.action.sessionId)
      assert(worker !== undefined)
      await ctx.sessions.flush(worker.session)
      assert(worker.session.events.some(event => event.type === 'tool/result' && event.data.message.source.callId === ASK_ID))
      const retry = value(await client.teams.inboxRespond(request))
      assert.equal(retry.kind, 'accepted')
      assert.deepEqual(retry.action.response?.answer, answer)
      value(await client.teams.inboxAcknowledge({ throughCursor: delivered.sequence }))
      value(await client.teams.cancel({ teamId: state.team.id }))
      const terminal = value(await client.teams.get({ teamId: state.team.id }))
      const action = terminal.humanActions?.find(item => item.id === delivered!.action.id)
      assert.equal(action?.phase, 'resolved')
      assert.equal(model.askCalls, 1)
      return { scenario: 'principal-human-question', backend: process.env.CLOCKY_QUESTION_BACKEND,
        authenticated: true, source: 'native-worker', attemptBound: true, questionCalls: model.askCalls,
        answer: action.response?.answer, modelReceivedAnswer: true, response: response.kind,
        retry: retry.kind, action: action.phase, team: terminal.team.phase }
    })
  } finally { await lease.revoke() }
}
export const name = 'human-inbox-question-driver'
export const inject = ['apiProxy', 'teamRuns', 'teams', 'llm', 'agents', 'sessions', 'productPrincipals', 'teamHumanDelivery']
/** Drive the Loader-owned real tool and authenticated Host APIs. @param ctx - Complete composition. */
export function apply(ctx: Context): void {
  const model = new AnswerModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void run(ctx, model).then((output) => { process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); exit(0) }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
