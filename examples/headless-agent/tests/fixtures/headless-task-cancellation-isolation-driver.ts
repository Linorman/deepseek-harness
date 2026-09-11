/** Real same-binding task cancellation with independent pending filesystem approvals. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { RpcId } from '@clocky/clocky-host-apiproxy'
import type { MuxFrame } from '@clocky/clocky-host-apiproxy'
import { teamTaskCreateIdempotencyKeySchema, channelPostIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamId, TeamStateSnapshot } from '@clocky/clocky-team'
import type { TeamLinkProvider } from '@clocky/clocky-team-link'
import { TeamAgentClient } from '@clocky/clocky-team-agent-client'
import type {} from '@clocky/clocky-team-run'

/** Scripted model identity for the real isolation fixture and SDK consumers. */
export const MODEL = 'task-isolation-model'
type Asked = Extract<MuxFrame, { type: 'approval/requested' }>

function tool(id: string, name: string, args: Record<string, unknown>): StreamChunk[] {
  const argumentsText = JSON.stringify(args)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: CallId(id), name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(id), name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}

/** External model that uses ordinary read/write tools to ask approval for either named task. */
export class IsolationApprovalModel extends LlmAdapter {
  /** Resolves when the actual coordinator model request is active. */
  readonly coordinatorStarted = Promise.withResolvers<undefined>()
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Isolated task cancellation' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const text = options.messages.filter(message => message.role === 'user').flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (text.includes('ISOLATION_COORDINATOR')) {
      this.coordinatorStarted.resolve(undefined)
      if (options.signal?.aborted) return
      await new Promise<void>((resolve) => { options.signal?.addEventListener('abort', () => { resolve() }, { once: true }) })
      return
    }
    const selected = [...text.matchAll(/Team task assignment: ISOLATION_([AB])/gu)].at(-1)?.[1]
    const taskId = [...text.matchAll(/\nTask: (\S+)\nAttempt: (\S+)/gu)].at(-1)?.[1]
    assert(selected !== undefined && taskId !== undefined)
    const file_path = join(process.cwd(), selected === 'A' ? 'approval.txt' : 'b.txt')
    const result = (suffix: string) => options.messages.flatMap(message => message.content)
      .find(block => block.type === 'tool-result' && block.toolCallId === `${taskId}:${suffix}`)
    const read = result('read')
    if (read === undefined) { yield* tool(`${taskId}:read`, 'read', { file_path }); return }
    assert(read.type === 'tool-result' && !read.isError, JSON.stringify(read))
    const denied = result('denied')
    if (denied === undefined) { yield* tool(`${taskId}:denied`, 'write', { file_path, content: 'after\n' }); return }
    assert(denied.type === 'tool-result' && denied.isError, JSON.stringify(denied))
    assert(JSON.stringify(denied.content).includes('[sandbox: file access denied under read-only mode]'))
    assert(result('approval') === undefined)
    yield* tool(`${taskId}:approval`, 'write', { file_path, content: 'after\n', sandbox_permissions: 'workspace-write',
      justification: `Allow the denied write for ISOLATION_${selected}.` })
  }
}

/**
 * Delay B's real accepted assignment notification until A has a Host approval wait.
 * Every operation and actor proof remains owned by the ordinary Local Link.
 * @param ctx - context carrying the real Team and Local Link services.
 * @param allowSecondary - external transport timing gate, not task state.
 * @param allowAssignments - optional gate before any task Envelope delivery.
 * @returns a transparent provider with a delayed B notification.
 */
export function gatedTaskLinkProvider(
  ctx: Context, allowSecondary: Promise<void>, allowAssignments: Promise<void> = Promise.resolve(),
): TeamLinkProvider {
  return {
    name: 'isolation-local',
    async connect(request) {
      const local = await ctx.teamLinks.connect({ ...request, provider: 'local' })
      return {
        provider: 'isolation-local', binding: local.binding, done: local.done,
        onNotify(listener) {
          return local.onNotify(async (envelope) => {
            if (envelope.kind === 'assignment' && envelope.taskId !== undefined) {
              await allowAssignments
              const task = await ctx.teams.getTask({ teamId: envelope.teamId, taskId: envelope.taskId })
              if (task.subject === 'ISOLATION_B') await allowSecondary
            }
            await listener(envelope)
          })
        },
        getChannel: local.getChannel.bind(local),
        onInvitation: local.onInvitation.bind(local),
        acknowledgeChannelInvitation: local.acknowledgeChannelInvitation.bind(local),
        onInterrupt: local.onInterrupt.bind(local),
        onTaskCancellation: local.onTaskCancellation.bind(local),
        acknowledgeTaskCancellation: local.acknowledgeTaskCancellation.bind(local),
        post: local.post.bind(local), postFinalResult: local.postFinalResult.bind(local),
        claim: local.claim.bind(local), claimTaskAttemptStart: local.claimTaskAttemptStart.bind(local),
        settleTaskAttempt: local.settleTaskAttempt.bind(local), integrateTask: local.integrateTask.bind(local),
        heartbeatTaskAttempt: local.heartbeatTaskAttempt.bind(local), resolveTaskReview: local.resolveTaskReview.bind(local),
        acknowledge: local.acknowledge.bind(local), acknowledgeInterrupt: local.acknowledgeInterrupt.bind(local),
        close: local.close.bind(local),
      }
    },
  }
}

async function until(ctx: Context, teamId: TeamId, predicate: (state: TeamStateSnapshot) => boolean) {
  let state = await ctx.teams.getTeam({ teamId })
  while (!predicate(state)) {
    await ctx.teams.watchTeam({ teamId, afterCursor: state.team.cursor })
    state = await ctx.teams.getTeam({ teamId })
  }
  return state
}

async function run(ctx: Context, model: IsolationApprovalModel): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  const mode = process.env.CLOCKY_TASK_CANCEL_ISOLATION ?? 'queued'
  const gate = Promise.withResolvers<undefined>()
  const assignments = Promise.withResolvers<undefined>()
  const unregister = ctx.teamLinks.registerProvider(gatedTaskLinkProvider(ctx, gate.promise, assignments.promise))
  const muxStop = new AbortController()
  const asked = new Map<string, Asked>()
  const changed = new Set<() => void>()
  const pump = (async () => {
    for await (const frame of ctx.apiProxy.events.mux({ rpcId: RpcId('task-isolation-observer'), payload: {} }, muxStop.signal)) {
      if (frame.payload.type === 'approval/requested' && frame.payload.taskId !== undefined) {
        asked.set(frame.payload.taskId, frame.payload)
        for (const wake of changed) wake()
      }
    }
  })()
  const waitAsked = async (taskId: string): Promise<Asked> => {
    while (!asked.has(taskId)) {
      const next = Promise.withResolvers<undefined>()
      const wake = (): void => { next.resolve(undefined) }
      changed.add(wake)
      try { await next.promise } finally { changed.delete(wake) }
    }
    return asked.get(taskId)!
  }
  let client: TeamAgentClient | undefined
  try {
    const handle = await ctx.teamRuns.create({ objective: 'Cancel one task while another waits for approval.', cwd: process.cwd(),
      selection: { provider: MODEL, model: MODEL } })
    const coordinator = handle.coordinatorLease.localAgent
    assert(coordinator !== undefined)
    client = new TeamAgentClient(ctx, { consumeWorkspace: true, linkProvider: 'isolation-local' })
    client.start()
    await ctx.teamRuns.postHumanInput({ teamId: handle.teamId, idempotencyKey: channelPostIdempotencyKeySchema.parse('isolation-input'),
      content: [{ type: 'text', text: 'ISOLATION_COORDINATOR' }] })
    await model.coordinatorStarted.promise
    const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
    const create = async (letter: 'A' | 'B') => await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.startDefaultWorkerTask(authority, {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`isolation-${letter}`), subject: `ISOLATION_${letter}`, instructions: `ISOLATION_${letter}`,
      readScopes: [letter === 'A' ? 'approval.txt' : 'b.txt'], writeScopes: [letter === 'A' ? 'approval.txt' : 'b.txt'],
    }))
    const a = await create('A')
    const b = await create('B')
    const assigned = await until(ctx, handle.teamId, state => state.tasks.every(task => task.phase === 'assigned'))
    const aLease = assigned.tasks.find(task => task.id === a.id)!.lease!
    const bLease = assigned.tasks.find(task => task.id === b.id)!.lease!
    assert.equal(aLease.activationId, bLease.activationId)
    const binding = assigned.activations.find(candidate => candidate.activation.id === aLease.activationId)!
    const worker = ctx.agents.get(binding.sessionId)
    assert(worker !== undefined)
    const queuedB = Promise.withResolvers<undefined>()
    const stopQueued = ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (agent === worker && message.source.kind === 'team-task-assignment' && message.source.taskId === b.id) queuedB.resolve(undefined)
    })
    assignments.resolve(undefined)
    const firstAsked = await waitAsked(a.id)
    assert.equal(firstAsked.sessionId, worker.session.id)
    if (mode === 'rebuild') {
      const closing = client.close()
      gate.resolve(undefined)
      await closing
      client = new TeamAgentClient(ctx, { consumeWorkspace: true, linkProvider: 'isolation-local' })
      client.start()
    } else gate.resolve(undefined)
    await queuedB.promise
    stopQueued()
    assert(worker.inbox.nextTurn.some(message => message.source.kind === 'team-task-assignment' && message.source.taskId === b.id))
    const beforePublication = await ctx.teams.getTeam({ teamId: handle.teamId })
    const queuedAllocation = beforePublication.workspaceAllocations.find(allocation =>
      allocation.taskId === b.id && allocation.attemptId === bLease.attemptId)
    assert(queuedAllocation?.lifecycle === 'active')
    const beforeObservations = (await ctx.teams.readAudit({ teamId: handle.teamId, afterCursor: -1, limit: 128 })).items
      .filter(entry => entry.type === 'workspace/observed').length
    const workspaces = ctx.get('teamWorkspaces')
    assert(workspaces !== undefined)
    let publicationCalls = 0
    // oxlint-disable-next-line typescript/unbound-method -- the wrapper supplies the receiver and restores this exact method.
    const publish = workspaces.publish
    workspaces.publish = async (workspaceMode, request) => {
      publicationCalls += 1
      return await publish.call(workspaces, workspaceMode, request)
    }
    try {
      await assert.rejects(workspaces.publishForOwner(worker, { taskId: b.id, attemptId: bLease.attemptId,
        allocationId: queuedAllocation.id, expectedRevision: queuedAllocation.revision, signal: muxStop.signal }),
      error => error instanceof Error && error.message.includes('current claimed task allocation'))
    } finally { workspaces.publish = publish }
    assert.equal(publicationCalls, 0)

    assert.equal((await ctx.teams.readAudit({ teamId: handle.teamId, afterCursor: -1, limit: 128 })).items
      .filter(entry => entry.type === 'workspace/observed').length, beforeObservations)
    assert.equal((await ctx.teams.getTask({ teamId: handle.teamId, taskId: b.id })).attemptHistory.length, 0)
    const cancel = async (taskId: typeof a.id) => await ctx.agents.withInitiator(coordinator, async () => await ctx.teamRuns.cancelDefaultWorkerTask(authority, { taskId, reason: `Isolate ${taskId === a.id ? 'A' : 'B'}.` }))
    if (mode === 'queued') {
      await cancel(b.id)
      const state = await until(ctx, handle.teamId, value => value.tasks.find(task => task.id === b.id)?.phase === 'cancelled')
      assert.equal(state.tasks.find(task => task.id === a.id)?.phase, 'running')
      assert.equal(state.humanActions?.find(action => action.taskId === a.id)?.phase, 'pending')
      assert(!asked.has(b.id))
      assert(state.workspaceAllocations.filter(allocation => allocation.taskId === a.id).every(allocation => allocation.lifecycle === 'active'))
      await cancel(a.id)
    } else {
      await cancel(a.id)
      const state = await until(ctx, handle.teamId, value => value.tasks.find(task => task.id === a.id)?.phase === 'cancelled'
        && value.humanActions?.find(action => action.taskId === a.id)?.phase === 'cancelled')
      assert.equal(state.humanActions?.find(action => action.taskId === a.id)?.phase, 'cancelled')
      await waitAsked(b.id)
      const waiting = await ctx.teams.getTeam({ teamId: handle.teamId })
      assert.equal(waiting.tasks.find(task => task.id === a.id)?.phase, 'cancelled')
      assert.equal(waiting.tasks.find(task => task.id === b.id)?.phase, 'running')
      assert.equal(waiting.humanActions?.find(action => action.taskId === b.id)?.phase, 'pending')
      await cancel(b.id)
    }
    const stopped = await until(ctx, handle.teamId, state => state.tasks.every(task => task.phase === 'cancelled')
      && state.humanActions?.every(action => action.phase === 'cancelled') === true)
    assert.equal(stopped.team.phase, 'active')
    assert(stopped.workspaceAllocations.every(allocation => allocation.lifecycle === 'released'))
    assert(stopped.humanActions?.every(action => action.phase === 'cancelled'))
    assert.equal(await readFile(join(process.cwd(), 'approval.txt'), 'utf8'), 'before\n')
    assert.equal(await readFile(join(process.cwd(), 'b.txt'), 'utf8'), 'before\n')
    await ctx.teamRuns.cancel(handle.teamId)
    return { scenario: mode, sameActivation: true, firstApprovalReal: true, otherApprovalRetained: true,
      queuedTaskWasNotRun: mode === 'queued', resumedOtherTask: mode !== 'queued', clientReconstructed: mode === 'rebuild',
      taskOutcomes: stopped.tasks.map(task => task.attemptHistory.at(-1)!.outcome.kind), teamBeforeCleanup: 'active', allocationsReleased: true, files: 'before' }
  } finally {
    assignments.resolve(undefined)
    gate.resolve(undefined)
    await client?.close()
    unregister()
    muxStop.abort()
    await pump
  }
}

/** Loader identity for the task isolation fixture. */
export const name = 'task-cancellation-isolation-driver'
/** Real Host, Team, Link and execution owners used by this fixture. */
export const inject = ['apiProxy', 'teamRuns', 'teams', 'llm', 'agents', 'sessions', 'teamLinks']
/** Run the real same-binding cancellation scenario. @param ctx - Loader context. */
export function apply(ctx: Context): void {
  const model = new IsolationApprovalModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  const failure = Promise.withResolvers<never>()
  ctx.on('agent/error', ({ error }) => { failure.reject(error) })
  ctx.logger.exporter({ levels: { default: 4 }, export(record) {
    if (record.type !== 'warn') return
    const text = record.args.map(String).join(' ')
    if (!text.includes('human-action')) return
    appendFileSync(join(process.cwd(), 'task-cancellation-host-diagnostics.jsonl'), `${JSON.stringify({ type: record.type, text })}\n`)
  } })
  void Promise.race([run(ctx, model), failure.promise]).then((output) => {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    exit(0)
  }, (error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); exit(1) })
}
