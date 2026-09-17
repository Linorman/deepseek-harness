/** Actual workflow cancellation through coordinator tools or an authenticated Host API. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import { CallId } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { InProcessApiClient, RpcId, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import type { RpcResponse } from '@clocky/clocky-host-apiproxy'
import { teamWorkflowPlanSchema, teamWorkflowPlanIdSchema } from '@clocky/clocky-team'
import type { TeamId, TeamStateSnapshot } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-product-principal'
import { ApprovalModel, MODEL, BEFORE } from './headless-human-approval-driver.ts'

const INPUT = 'WORKFLOW_TASK_CANCELLATION'
const FINAL = 'WORKFLOW_CANCELLED_WITH_INDEPENDENT_RESULT'
const via = process.env.CLOCKY_WORKFLOW_CANCEL_VIA ?? 'tool'
const plan = teamWorkflowPlanSchema.parse({
  version: 1, name: 'cancel-one-workflow-branch',
  tasks: [
    ['target', [], 'Cancel the real pending approval.', ['approval.txt']],
    ['dependent', ['target'], 'This task must not execute after its prerequisite cancels.', []],
    ['transitive', ['dependent'], 'This task must not execute after its prerequisite cancels.', []],
    ['independent', [], 'WORKFLOW_INDEPENDENT', []],
  ].map(([id, blockedBy, description, writeScopes]) => ({
    id, blockedBy, subject: id === 'independent' ? 'WORKFLOW_INDEPENDENT' : id, description,
    requiredCapabilities: ['team-default-worker'], priority: id === 'target' ? 2 : 1,
    readScopes: [id === 'independent' ? 'independent.txt' : 'approval.txt'], writeScopes,
    workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
  })),
  bounds: { maxTasks: 4, maxParallelism: 2, maxTotalAttempts: 4 },
  channel: { participantRoles: ['coordinator', 'worker', 'worker-2'], viewPolicy: { type: 'recent-window', version: 1 },
    graph: { initial: { kind: 'participant', role: 'coordinator' }, transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
  result: { kind: 'task-results', taskTemplateIds: ['target', 'dependent', 'transitive', 'independent'] },
})

function chunks(id: string, name: string, args: Record<string, unknown>): StreamChunk[] {
  const argumentsText = JSON.stringify(args)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: CallId(id), name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(id), name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}
function text(): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Done.' } }, { type: 'finish', reason: { kind: 'stop' } }]
}
function value(options: GenerateOptions, id: string): Record<string, unknown> | undefined {
  const result = options.messages.flatMap(message => message.content).find(block => block.type === 'tool-result' && block.toolCallId === id)
  if (result === undefined) return undefined
  assert(result.type === 'tool-result' && !result.isError, JSON.stringify(result))
  return JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join('')) as Record<string, unknown>
}
async function wait(gate: Promise<undefined>, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return false
  const stopped = Promise.withResolvers<undefined>()
  const abort = (): void => { stopped.resolve(undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try { return await Promise.race([gate.then(() => true), stopped.promise.then(() => false)]) }
  finally { signal?.removeEventListener('abort', abort) }
}

class WorkflowCancellationModel extends ApprovalModel {
  readonly cancelAllowed = Promise.withResolvers<undefined>()
  readonly independentStarted = Promise.withResolvers<undefined>()
  readonly finishIndependent = Promise.withResolvers<undefined>()
  readonly planStarted = Promise.withResolvers<string>()
  readonly observed = Promise.withResolvers<undefined>()
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') { yield* text(); return }
    const input = options.messages.filter(message => message.role === 'user').flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (input.includes(INPUT)) {
      const start = value(options, 'workflow-start')
      if (start === undefined) { yield* chunks('workflow-start', 'team_workflow_start', { plan }); return }
      assert(typeof start.plan_id === 'string')
      this.planStarted.resolve(start.plan_id)
      if (!await wait(this.cancelAllowed.promise, options.signal)) return
      if (via === 'tool' && value(options, 'workflow-cancel') === undefined) {
        yield* chunks('workflow-cancel', 'team_workflow_task_cancel', { plan_id: start.plan_id, task_template_id: 'target', reason: 'Cancel only the selected branch.' })
        return
      }
      const result = value(options, 'workflow-wait')
      if (result === undefined) { yield* chunks('workflow-wait', 'team_workflow_wait', { plan_id: start.plan_id }); return }
      assert.equal(result.phase, 'cancelled')
      const rows = (result.result as { tasks: Array<Record<string, unknown>> }).tasks
      assert.deepEqual(rows.map(row => [row.templateId, row.phase]), [['target', 'cancelled'], ['dependent', 'cancelled'], ['transitive', 'cancelled'], ['independent', 'completed']])
      assert.equal((rows[1]!.blockedByOutcome as Record<string, unknown>).taskId, rows[0]!.taskId)
      assert.equal((rows[2]!.blockedByOutcome as Record<string, unknown>).taskId, rows[1]!.taskId)
      this.observed.resolve(undefined)
      if (value(options, 'workflow-final') === undefined) {
        const channelId = /call team_final with channel_id (\S+) and/u.exec(options.system ?? '')?.[1]
        assert(channelId !== undefined)
        yield* chunks('workflow-final', 'team_final', { channel_id: channelId, text: FINAL })
      } else yield* text()
      return
    }
    if (input.includes('WORKFLOW_INDEPENDENT')) {
      const assignment = [...input.matchAll(/\nTask: (\S+)\nAttempt: (\S+)/gu)].at(-1)
      assert(assignment?.[1] !== undefined && assignment[2] !== undefined)
      if (!options.messages.some(message => message.content.some(block => block.type === 'tool-result' && block.toolCallId === 'independent-read'))) {
        yield* chunks('independent-read', 'read', { file_path: join(process.cwd(), 'independent.txt') }); return
      }
      this.independentStarted.resolve(undefined)
      if (!await wait(this.finishIndependent.promise, options.signal)) return
      if (value(options, 'independent-report') === undefined) {
        yield* chunks('independent-report', 'team_task_report', { task_id: assignment[1], attempt_id: assignment[2], outcome: 'completed', summary: 'Independent branch completed.' })
      } else yield* text()
      return
    }
    yield* super.stream(options)
  }
}

async function until(ctx: Context, teamId: TeamId, predicate: (state: TeamStateSnapshot) => boolean) {
  let current = await ctx.teams.getTeam({ teamId })
  while (!predicate(current)) {
    await ctx.teams.watchTeam({ teamId, afterCursor: current.team.cursor })
    current = await ctx.teams.getTeam({ teamId })
  }
  return current
}
async function run(ctx: Context, model: WorkflowCancellationModel) {
  await ctx.get('loader')?.await()
  const authentication = await ctx.productPrincipals.authenticate({ provider: 'workflow-test-local',
    credential: ctx.productPrincipals.bootstrapCredential('workflow-test-local') })
  const call = async <T>(operation: (client: InProcessApiClient) => Promise<RpcResponse<T>>): Promise<T> =>
    await authentication.withCall(async (authenticatedProductCall) => {
      const response = await operation(new InProcessApiClient(toFetchHandler(ctx.apiProxy, { authenticatedProductCall })))
      if (!response.result.ok) throw new Error(response.result.error.message)
      return response.result.value
    })
  const stop = new AbortController()
  const approval = Promise.withResolvers<undefined>()
  const pump = (async () => {
    for await (const frame of ctx.apiProxy.events.mux({ rpcId: RpcId('workflow-cancel-observer'), payload: {} }, stop.signal)) {
      if (frame.payload.type === 'approval/requested') approval.resolve(undefined)
    }
  })()
  try {
    const created = await call(async client => await client.teams.create({ objective: 'Cancel a workflow branch and preserve independent work.', cwd: process.cwd() }))
    const teamId = created.team.id
    await call(async client => await client.teams.postInput({ teamId, text: INPUT }))
    model.allowOperation.resolve(undefined)
    model.allowEscalation.resolve(undefined)
    const planId = await model.planStarted.promise
    await Promise.all([approval.promise, model.independentStarted.promise])
    if (via === 'api') {
      const state = await ctx.teams.getTeam({ teamId })
      const target = state.tasks.find(task => task.workflowTemplateId === 'target')!
      await call(async client => await client.teams.taskCancel({ teamId, taskId: target.id, expectedRevision: target.revision, reason: 'Cancel only the selected branch.' }))
    }
    model.cancelAllowed.resolve(undefined)
    const partial = await until(ctx, teamId, state => state.tasks.filter(task => task.workflowTemplateId !== 'independent').every(task => task.phase === 'cancelled'))
    assert.equal(partial.workflowPlans?.find(candidate => candidate.id === planId)?.phase, 'ready')
    assert.equal(partial.tasks.find(task => task.workflowTemplateId === 'independent')?.phase, 'running')
    assert.equal(partial.team.phase, 'active')
    assert(partial.tasks.filter(task => task.blockedByOutcome !== undefined).every(task => task.attemptCount === 0))
    model.finishIndependent.resolve(undefined)
    await model.observed.promise
    await call(async client => await client.teams.waitFinal({ teamId }))
    const terminal = await ctx.teams.getTeam({ teamId })
    assert.equal(terminal.team.phase, 'completed')
    const sessions = await call(async client => await client.sessions.list({}))
    for (const binding of terminal.activations) {
      assert.deepEqual(sessions.items.find(row => row.sessionId === binding.sessionId)?.team,
        { teamId, participantId: binding.activation.participantId })
    }
    assert.equal(terminal.workflowPlans?.[0]?.phase, 'cancelled')
    const inspected = await call(async client => await client.teams.workflowPlanInspect({
      teamId, planId: teamWorkflowPlanIdSchema.parse(planId), limit: 1 }))
    assert.equal(inspected.record.phase, 'cancelled')
    assert.equal(inspected.items.length, 1)
    assert.equal(inspected.total, plan.tasks.length)
    assert(!('plan' in inspected.record) && !('result' in inspected.record))
    if (inspected.nextCursor !== undefined) {
      const next = await call(async client => await client.teams.workflowPlanInspect({
        teamId, planId: teamWorkflowPlanIdSchema.parse(planId), limit: 1,
        afterCursor: inspected.nextCursor, expectedRevision: inspected.record.revision }))
      assert.equal(next.record.revision, inspected.record.revision)
      assert.notEqual(next.items[0]?.templateId, inspected.items[0]?.templateId)
    }
    assert(terminal.workspaceAllocations.every(allocation => allocation.lifecycle === 'released'))
    assert.equal(await readFile(join(process.cwd(), 'approval.txt'), 'utf8'), BEFORE)
    return { via, authenticatedTeam: true, target: 'cancelled', dependent: 'cancelled', transitive: 'cancelled',
      independent: 'completed', descendantsNeverStarted: true, plan: 'cancelled', planResultObserved: true, team: 'completed', file: BEFORE }
  } finally { stop.abort(); await pump; await authentication.revoke() }
}

/** Loader identity. */
export const name = 'workflow-task-cancellation-driver'
/** Actual Host, authentication and Team owners used by the scenario. */
export const inject = ['apiProxy', 'teamRuns', 'teams', 'llm', 'agents', 'productPrincipals']
/** Execute the local workflow cancellation scenario. @param ctx - Loader context. */
export function apply(ctx: Context): void {
  const model = new WorkflowCancellationModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  const failure = Promise.withResolvers<never>()
  ctx.on('agent/error', ({ error }) => { failure.reject(error) })
  void Promise.race([run(ctx, model), failure.promise]).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); exit(0)
  }, (error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); exit(1) })
}
