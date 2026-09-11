/** Model tool calls exercise the assembled parent and child Team lifecycle. */
import assert from 'node:assert/strict'
import { writeSync } from 'node:fs'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk, LlmResolvedModelInfo } from '@clocky/clocky-llm'
import type {} from '@clocky/clocky-storage-log'
import { teamIdSchema } from '@clocky/clocky-team'
import type { ChannelId, TeamAuditEntry, TeamId, TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-run'

const MODEL = 'child-delegation-model'
const ROOT = 'CHILD_DELEGATION_PARENT_OBJECTIVE'
const RESULT = 'CHILD_DELEGATION_RESULT'
const FINAL = 'CHILD_DELEGATION_PARENT_FINAL'
type CrashAt = 'child-created' | 'child-run-bound' | 'child-cancelled' | 'response' | 'result-admission'
  | 'child-result-admitted' | 'child-receipt' | 'child-closure' | 'child-terminal'
  | 'parent-charge-pending' | 'parent-charge-accepted' | 'parent-charge-settled' | 'parent-settled'

function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected a durable JSON object')
  return value as Record<string, unknown>
}

function result(options: GenerateOptions, id: string): Record<string, unknown> | undefined {
  const block = options.messages.flatMap(message => message.content)
    .find(block => block.type === 'tool-result' && block.toolCallId === id)
  if (block === undefined || block.type !== 'tool-result') return undefined
  assert(!block.isError, JSON.stringify(block))
  const text = block.content.find(value => value.type === 'text')
  assert(text?.type === 'text')
  return JSON.parse(text.text) as Record<string, unknown>
}

function call(id: string, name: string, args: Record<string, unknown>): StreamChunk[] {
  const argumentsText = JSON.stringify(args)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: CallId(id), name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(id), name, arguments: argumentsText } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}

function text(): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Delegation observed.' } },
    { type: 'finish', reason: { kind: 'stop' } }]
}

async function waitForChild(started: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  assert(signal !== undefined)
  signal.throwIfAborted()
  const cancelled = Promise.withResolvers<never>()
  const abort = () => { cancelled.reject(signal.reason) }
  signal.addEventListener('abort', abort, { once: true })
  try { await Promise.race([started, cancelled.promise]) }
  finally { signal.removeEventListener('abort', abort) }
}

class DelegationModel extends LlmAdapter {
  readonly childStarted = Promise.withResolvers<undefined>()
  beforeChildWork?: () => Promise<void>
  readonly rootCalls: string[] = []
  readonly childCalls: string[] = []
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') { yield* text(); return }
    const input = options.messages.filter(message => message.role === 'user').flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    const parent = input.includes(ROOT)
    const channel = options.system?.match(/call team_final with channel_id ([^\s]+) and/u)?.[1]
    assert(channel !== undefined)
    const cancelled = process.env.CLOCKY_CHILD_SCENARIO === 'cancel'
    if (!parent) {
      if (this.childCalls.length === 0) await this.beforeChildWork?.()
      this.childStarted.resolve(undefined)
      if (cancelled) {
        const signal = options.signal
        assert(signal !== undefined)
        if (!signal.aborted) await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
        signal.throwIfAborted()
        return
      }
      if (result(options, 'child-final') !== undefined) { yield* text(); return }
      this.childCalls.push('team_final')
      yield* call('child-final', 'team_final', { channel_id: channel, text: RESULT })
      return
    }
    const delegated = result(options, 'parent-delegate')
    if (delegated === undefined) {
      this.rootCalls.push('team_task_delegate')
      yield* call('parent-delegate', 'team_task_delegate', { subject: 'Run delegated child work',
        instructions: 'Complete the delegated child objective.', read_scopes: [], write_scopes: [], budget: {} })
      return
    }
    assert(typeof delegated.task_id === 'string')
    if (cancelled && result(options, 'parent-cancel') === undefined) {
      await waitForChild(this.childStarted.promise, options.signal)
      this.rootCalls.push('team_task_cancel')
      yield* call('parent-cancel', 'team_task_cancel', { task_id: delegated.task_id, reason: 'Cancel the live child model turn.' })
      return
    }
    const waited = result(options, 'parent-wait')
    if (waited === undefined) {
      this.rootCalls.push('team_task_wait')
      yield* call('parent-wait', 'team_task_wait', { task_id: delegated.task_id })
      return
    }
    assert.equal(waited.phase, cancelled ? 'cancelled' : 'completed')
    if (result(options, 'parent-final') !== undefined) { yield* text(); return }
    this.rootCalls.push('team_final')
    yield* call('parent-final', 'team_final', { channel_id: channel, text: FINAL })
  }
}

async function run(ctx: Context, model: DelegationModel) {
  await ctx.get('loader')?.await()
  const handle = await ctx.teamRuns.create({ objective: ROOT, cwd: process.cwd() })
  let parentArchiveRejected = false
  model.beforeChildWork = async () => {
    const pending = await ctx.teams.getTeam({ teamId: handle.teamId })
    const delegated = pending.tasks.find(task => task.execution.kind === 'child-team')
    assert.equal(delegated?.phase, 'running')
    await assert.rejects(ctx.teamRuns.archiveTerminal({ teamId: handle.teamId, expectedCursor: pending.team.cursor }),
      { code: 'TEAM_RUN_NOT_FOUND' })
    assert.equal((await ctx.teams.getTeam({ teamId: handle.teamId })).team.archivedAt, undefined)
    parentArchiveRejected = true
  }
  await ctx.teamRuns.postHumanInput({ teamId: handle.teamId, content: [{ type: 'text', text: ROOT }] })
  const final = await ctx.teamRuns.waitForFinal({
    teamId: handle.teamId, signal: AbortSignal.timeout(15_000),
  }).catch(async (cause: unknown) => {
    const state = await ctx.teams.getTeam({ teamId: handle.teamId })
    throw new Error(`Child scenario did not settle: ${JSON.stringify({ phase: state.team.phase,
      tasks: state.tasks.map(task => ({ phase: task.phase, delegation: task.delegation })) })}`, { cause })
  })
  assert.equal(final.text, FINAL)
  const parent = await ctx.teams.getTeam({ teamId: handle.teamId })
  const task = parent.tasks.find(task => task.execution.kind === 'child-team')
  assert(task?.delegation?.childTeamId !== undefined)
  const child = await ctx.teams.getTeam({ teamId: task.delegation.childTeamId })
  const cancelled = process.env.CLOCKY_CHILD_SCENARIO === 'cancel'
  assert.equal(parent.team.phase, 'completed')
  assert.equal(child.team.phase, cancelled ? 'cancelled' : 'completed')
  assert.equal(task.phase, child.team.phase)
  assert(child.participants.every(participant => participant.kind !== 'human'))
  assert(child.activations.every(binding => binding.activation.status === 'offline' && binding.quiescedAt !== undefined))
  assert.equal((await ctx.teams.inspectQuiescence(child.team.id)).quiescent, true)
  assert((parent.usage?.inputTokens ?? 0) >= (child.usage?.inputTokens ?? 0))
  const binding = child.team.childRun
  assert(binding !== undefined)
  const page = await ctx.teams.readChannelPage({ channelId: binding.channelId, afterCursor: -1, limit: 64 })
  const request = page.records.find(record => record.type === 'channel/envelope' && record.envelope.kind === 'request')
  assert(request?.type === 'channel/envelope')
  assert.equal(request.envelope.senderId, binding.parentServiceId)
  if (!cancelled) {
    assert.equal(task.delegation.result?.text, RESULT)
    assert.deepEqual(child.team.childResultAdmission?.parent, task.delegation.result)
    const response = page.records.find(record => record.type === 'channel/envelope' && record.envelope.kind === 'response')
    assert(response?.type === 'channel/envelope')
    assert.equal(response.envelope.causationId, request.envelope.id)
    assert.equal(response.envelope.senderId, binding.coordinatorId)
    assert(page.records.some(record => record.type === 'channel/receipt' && record.participantId === binding.parentServiceId
      && record.envelopeId === response.envelope.id))
  }
  assert.equal(parentArchiveRejected, true)
  await crossLogEvidence(ctx, parent, child, task)
  assert.equal((await ctx.teams.inspectQuiescence(parent.team.id)).quiescent, true)
  const archived = await ctx.teamRuns.archiveTerminal({ teamId: parent.team.id, expectedCursor: parent.team.cursor })
  assert(archived.team.archivedAt !== undefined)
  assert.deepEqual(await ctx.teamRuns.archiveTerminal({ teamId: parent.team.id, expectedCursor: parent.team.cursor }), archived)
  assert.equal((await audit(ctx, parent.team.id)).filter(item => item.type === 'team/archived').length, 1)
  return { scenario: cancelled ? 'cancel' : 'complete', parent: parent.team.phase, task: task.phase, child: child.team.phase,
    parentCalls: model.rootCalls, childCalls: model.childCalls, humanChildParticipants: 0,
    childActivationsQuiesced: true, childQuiescent: true, parentArchiveRejected, parentArchived: true,
    result: task.delegation.result?.text ?? null }
}

/** Kill the independent Loader at one selected durable child-saga window. */
function installCrashWindow(ctx: Context, parentTeamId: () => string | undefined, crashAt: CrashAt): void {
  const log = ctx.storage.log
  const open = log.open.bind(log)
  const restore: Array<() => void> = []
  const responseEnvelopeIds = new Set<string>()
  ctx.effect(() => {
    log.open = async (descriptor) => {
      const stream = await open(descriptor)
      if (!descriptor.name.startsWith('channel/') && !descriptor.name.startsWith('team/')) return stream
      const append = stream.append.bind(stream)
      stream.append = async (expectedSequence, values) => {
        const result = await append(expectedSequence, values)
        for (const value of values) {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
          const record = value as Record<string, unknown>
          if (record.type !== 'channel/envelope') continue
          const envelope = object(record.envelope)
          if (envelope.kind === 'response' && typeof envelope.id === 'string') responseEnvelopeIds.add(envelope.id)
        }
        const selected = values.some((value) => {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
          const record = value as Record<string, unknown>
          if (crashAt === 'child-created') {
            if (record.type !== 'team/created') return false
            return typeof record.parentTeamId === 'string'
          }
          if (crashAt === 'child-run-bound') return record.type === 'team/child-run-bound'
          if (crashAt === 'child-cancelled') {
            if (record.type !== 'team/cancellation') return false
            return descriptor.name !== `team/${parentTeamId()}`
          }
          if (crashAt === 'response') {
            if (record.type !== 'channel/envelope') return false
            const envelope = object(record.envelope)
            return envelope.kind === 'response' && JSON.stringify(envelope.payload).includes(RESULT)
          }
          if (crashAt === 'child-result-admitted') return record.type === 'team/child-result-admitted'
          if (crashAt === 'child-receipt') {
            return record.type === 'channel/receipt' && typeof record.envelopeId === 'string'
              && responseEnvelopeIds.has(record.envelopeId)
          }
          if (crashAt === 'child-closure') return record.type === 'team/closure'
          if (crashAt === 'child-terminal') return record.type === 'team/phase' && record.phase === 'completed'
          if (crashAt === 'parent-charge-pending') {
            return record.type === 'usage/parent-charge-pending' && descriptor.name !== `team/${parentTeamId()}`
          }
          if (crashAt === 'parent-charge-accepted') {
            return record.type === 'usage/child-charged' && descriptor.name === `team/${parentTeamId()}`
          }
          if (crashAt === 'parent-charge-settled') {
            return record.type === 'usage/parent-charge-settled' && descriptor.name !== `team/${parentTeamId()}`
          }
          if (crashAt === 'parent-settled') {
            if (record.type !== 'task/changed' || descriptor.name !== `team/${parentTeamId()}`) return false
            const task = object(record.task)
            const delegation = task.delegation
            return typeof delegation === 'object' && delegation !== null
              && !Array.isArray(delegation) && 'phase' in delegation && delegation.phase === 'completed'
          }
          if (record.type !== 'task/changed') return false
          const task = object(record.task)
          const delegation = task.delegation
          return typeof delegation === 'object' && delegation !== null
            && !Array.isArray(delegation) && 'result' in delegation
        })
        if (selected) {
          writeSync(1, `${JSON.stringify({ stage: 'crash', crashAt, pid: process.pid,
            backend: process.env.CLOCKY_CHILD_RESTART_BACKEND, parentTeamId: parentTeamId(),
            stream: descriptor.name, tail: result.tailSequence })}\n`)
          process.kill(process.pid, 'SIGKILL')
          await new Promise<never>(() => {})
        }
        return result
      }
      restore.push(() => { stream.append = append })
      return stream
    }
    return () => { log.open = open; for (const release of restore) release() }
  }, 'child-delegation-restart: response process loss')
}

/** Start one parent and let an independent process die at the selected child-saga window. */
async function runCrash(ctx: Context, crashAt: CrashAt): Promise<never> {
  const parent = { teamId: undefined as string | undefined }
  installCrashWindow(ctx, () => parent.teamId, crashAt)
  await ctx.get('loader')?.await()
  const handle = await ctx.teamRuns.create({ objective: ROOT, cwd: process.cwd() })
  parent.teamId = handle.teamId
  await ctx.teamRuns.postHumanInput({ teamId: handle.teamId, content: [{ type: 'text', text: ROOT }] })
  await new Promise<never>(() => {})
  throw new Error('Child crash window returned without terminating the process')
}

/** Read complete durable evidence through bounded audit pages. */
async function audit(ctx: Context, teamId: TeamId, channelId?: ChannelId): Promise<TeamAuditEntry[]> {
  const entries: TeamAuditEntry[] = []
  let afterCursor = -1
  while (true) {
    const page = await ctx.teams.readAudit({ teamId, afterCursor, limit: 32,
      ...channelId === undefined ? {} : { channelId } })
    entries.push(...page.items)
    if (page.nextCursor === undefined) return entries
    assert(page.nextCursor > afterCursor)
    afterCursor = page.nextCursor
  }
}

/** Check child identity, result receipts and usage transfer against their owning journals. */
async function crossLogEvidence(ctx: Context, parent: TeamStateSnapshot, child: TeamStateSnapshot, task: TeamTaskSnapshot) {
  const children: TeamId[] = []
  let afterCursor = -1
  while (true) {
    const page = await ctx.teams.listTeamsPage({ afterCursor, limit: 1 })
    children.push(...page.items.filter(item => item.parentTeamId === parent.team.id).map(item => item.id))
    if (page.nextCursor === undefined) break
    assert(page.nextCursor > afterCursor)
    afterCursor = page.nextCursor
  }
  assert.deepEqual(children, [child.team.id])
  assert.equal(parent.tasks.filter(item => item.execution.kind === 'child-team').length, 1)
  assert.equal(child.team.parentTaskId, task.id)
  const childAudit = await audit(ctx, child.team.id)
  const parentAudit = await audit(ctx, parent.team.id)
  const admissions = childAudit.filter(item => item.type === 'team/child-result-admitted')
  assert(admissions.length <= 1)
  assert(childAudit.filter(item => item.type === 'team/child-run-bound').length <= 1)
  const pending = childAudit.filter(item => item.type === 'usage/parent-charge-pending').map(item => object(item.facts.charge))
  const accepted = parentAudit.filter(item => item.type === 'usage/child-charged').map(item => object(item.facts.charge))
  const settled = childAudit.filter(item => item.type === 'usage/parent-charge-settled').map(item => item.facts.chargeId)
  for (const values of [pending.map(item => item.id), accepted.map(item => item.id), settled]) {
    assert.equal(new Set(values).size, values.length, 'duplicate durable usage charge')
  }
  for (const charge of accepted) {
    const source = pending.find(item => item.id === charge.id)
    assert(source !== undefined)
    assert.equal(charge.sourceTeamId, child.team.id)
    assert.equal(charge.parentTaskId, task.id)
    for (const field of ['originTeamId', 'sourceSampleId', 'participantId', 'sessionId', 'provider', 'model', 'turn', 'step', 'usage']) {
      assert.deepEqual(charge[field], source[field])
    }
  }
  assert(settled.every(id => accepted.some(item => item.id === id)))
  const run = child.team.childRun
  const channelAudit = run === undefined ? [] : await audit(ctx, child.team.id, run.channelId)
  const responses = channelAudit.filter(item => item.type === 'channel/envelope')
    .map(item => object(item.facts.envelope)).filter(item => item.kind === 'response')
  assert(responses.length <= 1)
  const receipts = channelAudit.filter(item => item.type === 'channel/receipt'
    && item.facts.participantId === run?.parentServiceId && item.facts.envelopeId === responses[0]?.id)
  assert(receipts.length <= 1)
  if (task.delegation?.result !== undefined) {
    assert.equal(responses.length, 1)
    assert.equal(task.delegation.result.responseEnvelopeId, responses[0]?.id)
  }
  if (task.phase === 'completed') {
    assert(pending.length > 0, 'completed child must retain its model usage charges')
    assert.equal(child.team.phase, 'completed')
    assert.equal(admissions.length, 1)
    assert.equal(receipts.length, 1)
    assert.deepEqual(child.team.childResultAdmission?.parent, task.delegation?.result)
    assert.deepEqual([...settled].sort(), pending.map(item => item.id).sort())
    assert.deepEqual(accepted.map(item => item.id).sort(), [...settled].sort())
  }
  return { childTeamId: child.team.id, admissions: admissions.length, responseIds: responses.map(item => item.id),
    serviceReceipts: receipts.length, pendingChargeIds: pending.map(item => item.id).sort(),
    acceptedChargeIds: accepted.map(item => item.id).sort(), settledChargeIds: [...settled].sort() }
}

/** Let the restarted Loader's delegation Consumer admit and settle the retained child response. */
async function runRecover(ctx: Context, model: DelegationModel, parentTeamId: string): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  const teamId = teamIdSchema.parse(parentTeamId)
  const crashAt: CrashAt = process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-created'
    ? 'child-created' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-run-bound'
      ? 'child-run-bound' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-cancelled'
        ? 'child-cancelled' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'result-admission'
          ? 'result-admission' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-result-admitted'
            ? 'child-result-admitted' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-receipt'
              ? 'child-receipt' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-closure'
                ? 'child-closure' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-terminal'
                  ? 'child-terminal' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'parent-charge-pending'
                    ? 'parent-charge-pending' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'parent-charge-settled'
                      ? 'parent-charge-settled' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'parent-charge-accepted'
                        ? 'parent-charge-accepted' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'parent-settled'
                          ? 'parent-settled' : 'response'
  const signal = AbortSignal.timeout(15_000)
  let parent = await ctx.teams.getTeam({ teamId })
  const parentTaskSettled = (): boolean => parent.tasks.some(candidate => candidate.execution.kind === 'child-team'
    && candidate.phase === 'completed' && candidate.delegation?.phase === 'completed')
  try {
    while (parent.team.phase !== 'completed' && parent.team.phase !== 'stalled'
      && !(['child-terminal', 'parent-settled'].includes(crashAt) && parentTaskSettled())) {
      signal.throwIfAborted()
      await ctx.teams.watchTeam({ teamId, afterCursor: parent.team.cursor, signal })
      parent = await ctx.teams.getTeam({ teamId })
    }
  } catch (error: unknown) {
    throw new Error(`Child restart did not settle: ${JSON.stringify({ phase: parent.team.phase,
      stall: parent.team.stallReason, tasks: parent.tasks.map(task => ({ phase: task.phase, delegation: task.delegation })) })}`, { cause: error })
  }
  const task = parent.tasks.find(candidate => candidate.execution.kind === 'child-team')
  assert(task?.delegation?.childTeamId !== undefined)
  const child = await ctx.teams.getTeam({ teamId: task.delegation.childTeamId })
  if (crashAt === 'child-terminal' || crashAt === 'parent-settled') {
    assert.equal(parent.team.phase, 'active')
    assert.equal(task.phase, 'completed')
  } else {
    assert.equal(parent.team.phase, 'stalled')
    assert.equal(task.phase, 'running')
  }
  const result = task.delegation.result?.text ?? null
  const resultRequired = [
    'response', 'result-admission', 'child-result-admitted', 'child-receipt', 'child-closure', 'child-terminal', 'parent-settled',
  ].includes(crashAt)
  const resultMayRace = ['parent-charge-pending', 'parent-charge-accepted', 'parent-charge-settled'].includes(crashAt)
  if (resultRequired) assert.equal(result, RESULT)
  else if (resultMayRace) assert(result === null || result === RESULT)
  else assert.equal(result, null)
  assert.equal(model.rootCalls.length, 0)
  assert.equal(model.childCalls.length, 0)
  const crossLog = await crossLogEvidence(ctx, parent, child, task)
  return { stage: 'recover', crashAt, pid: process.pid, parent: parent.team.phase, task: task.phase,
    child: child.team.phase, stallCode: parent.team.stallReason?.code ?? null, result,
    modelRequests: model.rootCalls.length + model.childCalls.length, crossLog }
}

/** Loader identity. */
export const name = 'child-delegation-driver'
/** Real runtime owners needed by the model-driven scenario. */
export const inject = ['teamRuns', 'teams', 'llm', 'agents', 'storage']
/** Run the configured child flow after Loader readiness. @param ctx - Loader-owned context. */
export function apply(ctx: Context): void {
  const model = new DelegationModel()
  ctx.llm.registerAdapter([MODEL], model)
  const failure = Promise.withResolvers<never>()
  ctx.on('agent/error', ({ error }) => { failure.reject(error) })
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  const stage = process.env.CLOCKY_CHILD_RESTART_STAGE
  const crashAt: CrashAt = process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-created'
    ? 'child-created' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-run-bound'
      ? 'child-run-bound' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-cancelled'
        ? 'child-cancelled' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'result-admission'
          ? 'result-admission' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-result-admitted'
            ? 'child-result-admitted' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-receipt'
              ? 'child-receipt' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-closure'
                ? 'child-closure' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'child-terminal'
                  ? 'child-terminal' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'parent-charge-pending'
                    ? 'parent-charge-pending' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'parent-charge-settled'
                      ? 'parent-charge-settled' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'parent-charge-accepted'
                        ? 'parent-charge-accepted' : process.env.CLOCKY_CHILD_RESTART_CRASH_AT === 'parent-settled'
                          ? 'parent-settled' : 'response'
  const operation = stage === 'crash'
    ? runCrash(ctx, crashAt)
    : stage === 'recover'
      ? runRecover(ctx, model, process.env.CLOCKY_CHILD_RESTART_PARENT_ID ?? '')
      : run(ctx, model)
  void Promise.race([operation, failure.promise]).then((value) => { process.stdout.write(`${JSON.stringify(value)}\n`); exit(0) },
    (error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); exit(1) })
}
