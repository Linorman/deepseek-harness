/** Replay real AgentClient usage while its originating coordinator remains active. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { channelPostIdempotencyKeySchema, teamUsageSampleIdSchema } from '@clocky/clocky-team'
import type { TeamAuditEntry, TeamId, TeamUsageSampleInput } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-tools'

const MODEL = 'priced-usage-model'

/** Only the model is substituted; the emitted tool call traverses the real tool and Session pipeline. */
class UsageModel extends LlmAdapter {
  mainRequests = 0

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Priced usage replay' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.mainRequests += 1
    assert.equal(this.mainRequests, 1, 'the held tool must keep the original model turn open')
    const id = CallId('priced-usage-list')
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: 'team_task_list', argumentsDelta: '{}' }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'team_task_list', arguments: '{}' } }
    yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Read the authoritative audit without assuming a fixed Team creation record count. */
async function usageRecords(ctx: Context, teamId: TeamId): Promise<TeamAuditEntry[]> {
  const records: TeamAuditEntry[] = []
  let afterCursor = -1
  for (;;) {
    const page = await ctx.teams.readAudit({ teamId, afterCursor, limit: 32 })
    records.push(...page.items.filter(record => record.type === 'usage/changed'))
    if (page.nextCursor === undefined) return records
    afterCursor = page.nextCursor
  }
}

/** Wait for the real AgentClient observer to commit its Session-derived sample. */
async function observedUsage(ctx: Context, teamId: TeamId): Promise<TeamAuditEntry> {
  for (;;) {
    const state = await ctx.teams.getTeam({ teamId })
    const records = await usageRecords(ctx, teamId)
    if (records.length > 0) {
      assert.equal(records.length, 1)
      return records[0]!
    }
    assert.equal(state.team.phase, 'active')
    await ctx.teams.watchTeam({ teamId, afterCursor: state.team.cursor })
  }
}

/** Keep a completed real tool in its post-execute waterfall until actual TeamRun cancellation. */
async function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
}

async function run(ctx: Context, model: UsageModel): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  const handle = await ctx.teamRuns.create({ objective: 'Replay one priced model usage sample.', cwd: process.cwd(),
    selection: { provider: MODEL, model: MODEL } })
  const coordinator = handle.coordinatorLease.localAgent
  assert(coordinator !== undefined)
  const toolEntered = Promise.withResolvers<undefined>()
  let toolCancelled = false
  const removeGate = coordinator.ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.name === 'team_task_list') {
      assert.equal(result.isError, false)
      assert.deepEqual(result.value, { tasks: [] })
      toolEntered.resolve(undefined)
      await untilAborted(exec.signal)
      toolCancelled = true
    }
    return await next()
  })
  const issuer = ctx.teams.openActivationActorProofIssuer()
  try {
    await ctx.teamRuns.postHumanInput({ teamId: handle.teamId,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('priced-usage-input'),
      content: [{ type: 'text', text: 'List the current tasks once.' }] })
    await toolEntered.promise
    await ctx.sessions.flush(coordinator.session)
    const messages = coordinator.session.events.filter(event => event.type === 'assistant/message' && event.data.usage !== undefined)
    assert.equal(messages.length, 1)
    const event = messages[0]!
    assert(event.type === 'assistant/message' && event.data.usage !== undefined)
    const sample: TeamUsageSampleInput = {
      id: teamUsageSampleIdSchema.parse(`${coordinator.session.id}:${event.data.turn}:${event.data.step}`),
      provider: event.data.message.source.provider, model: event.data.message.source.model,
      turn: event.data.turn, step: event.data.step,
      usage: { inputTokens: event.data.usage.inputTokens, outputTokens: event.data.usage.outputTokens },
    }
    assert.equal('costUnits' in sample, false)
    const committed = await observedUsage(ctx, handle.teamId)
    const stored = object(committed.facts.sample)
    assert.equal(stored.id, sample.id)
    assert.equal(stored.sessionId, coordinator.session.id)
    assert.equal(stored.participantId, handle.coordinator.id)
    assert.equal(stored.provider, sample.provider)
    assert.equal(stored.model, sample.model)
    assert.deepEqual(stored.usage, sample.usage)
    assert.equal(stored.costUnits, 7)
    const before = await ctx.teams.getTeam({ teamId: handle.teamId })
    assert.equal(before.team.phase, 'active')
    assert.equal(coordinator.status, 'running')
    assert.equal(before.usage?.costUnits, stored.costUnits)
    const actor = issuer.issue(handle.coordinatorLease.binding)
    try {
      const old = await ctx.teams.recordUsage({ actor: actor.proof, expectedCursor: committed.cursor - 1, sample })
      assert.deepEqual(old, before.usage)
      assert.deepEqual(await ctx.teams.getTeam({ teamId: handle.teamId }), before)
      const fresh = await ctx.teams.recordUsage({ actor: actor.proof, expectedCursor: before.team.cursor, sample })
      assert.deepEqual(fresh, before.usage)
      assert.deepEqual(await ctx.teams.getTeam({ teamId: handle.teamId }), before)
      assert.deepEqual(await usageRecords(ctx, handle.teamId), [committed])
    } finally { actor.revoke() }
    await ctx.teamRuns.cancel(handle.teamId)
    const terminal = await ctx.teams.getTeam({ teamId: handle.teamId })
    assert.equal(terminal.team.phase, 'cancelled')
    assert.equal(terminal.goal.phase, 'active')
    assert(terminal.activations.every(binding => binding.activation.status === 'offline' && binding.quiescedAt !== undefined))
    assert.equal(toolCancelled, true)
    assert.equal(model.mainRequests, 1)
    assert.deepEqual(await usageRecords(ctx, handle.teamId), [committed])
    return { scenario: 'priced-usage-replay', sessionUsageMessages: messages.length,
      producer: 'team-agent-client', provider: sample.provider, model: sample.model, usage: sample.usage,
      costUnits: stored.costUnits, oldCursorReplay: 'unchanged', freshCursorReplay: 'unchanged', usageRecords: 1,
      realTaskList: 'empty', toolCancelled, modelRequests: model.mainRequests,
      terminal: terminal.team.phase, goal: terminal.goal.phase, coordinatorQuiesced: true }
  } finally {
    issuer.close()
    removeGate()
  }
}

/** Test-only Loader identity. */
export const name = 'priced-usage-driver'
/** Production usage and tool owners must be installed before dispatch. */
export const inject = ['teamRuns', 'teams', 'llm', 'tools', 'sessions']
/** Run the model-controlled accounting scenario. @param ctx - actual Loader context. */
export function apply(ctx: Context): void {
  const model = new UsageModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void run(ctx, model).then((output) => {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    exit(0)
  }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
