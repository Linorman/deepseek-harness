/** Failure and cancellation originate in real TeamRun owners, then survive abrupt Host loss. */
import assert from 'node:assert/strict'
import { writeSync } from 'node:fs'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { LlmAdapter, resolveRetryPolicy } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from '@clocky/clocky-llm'
import { channelPostIdempotencyKeySchema, teamIdSchema } from '@clocky/clocky-team'
import type { TeamAuditEntry, TeamEnvelope, TeamId } from '@clocky/clocky-team'
import { DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND } from '@clocky/clocky-team-channel-direct'
import type {} from '@clocky/clocky-storage-log'
import type {} from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-team-link'
import type {} from '@clocky/clocky-team-closure-driver'

const MODEL = 'headless-terminal-restart-model'
const PENDING_TEXT = 'UNREAD_HUMAN_MESSAGE_AT_HOST_LOSS'
const FAILURE = { code: 'TERMINAL_FIXTURE_FAILURE', message: 'The external model cannot finish this turn.' }

/** Parent-selected lifecycle path and exact durable checkpoint. */
export interface Config {
  readonly stage: 'crash' | 'recover'
  readonly outcome: 'failure' | 'cancellation'
  readonly window: 'intent' | 'quiesced'
  readonly teamId?: string
}

/** Validate process inputs before accessing any Team. */
export const Config: z<Config> = z.object({
  stage: z.union(['crash', 'recover'] as const).required(),
  outcome: z.union(['failure', 'cancellation'] as const).required(),
  window: z.union(['intent', 'quiesced'] as const).required(),
  teamId: z.string(),
})

/** External model gate permits the real input receipt to commit before the real turn fails. */
class TerminalModel extends LlmAdapter {
  readonly fail = Promise.withResolvers<undefined>()
  mainRequests = 0

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  override providerRetryPolicy(): ResolvedRetryPolicy {
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'terminal-restart model')
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Terminal recovery fixture' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.mainRequests += 1
    await this.fail.promise
    yield { type: 'finish', reason: { kind: 'error', failure: FAILURE } }
  }
}

function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected a durable JSON object')
  return value as Record<string, unknown>
}

async function audit(ctx: Context, teamId: TeamId): Promise<TeamAuditEntry[]> {
  const entries: TeamAuditEntry[] = []
  let afterCursor = -1
  for (;;) {
    const page = await ctx.teams.readAudit({ teamId, afterCursor, limit: 32 })
    entries.push(...page.items)
    if (page.nextCursor === undefined) return entries
    afterCursor = page.nextCursor
  }
}

/** Fault only the successful return from a real Team source-stream append. */
function installCrashWindow(ctx: Context, config: Config, model: TerminalModel): void {
  const log = ctx.storage.log
  const open = log.open.bind(log)
  const restore: Array<() => void> = []
  ctx.effect(() => {
    log.open = async (descriptor) => {
      const stream = await open(descriptor)
      if (!descriptor.name.startsWith('team/')) return stream
      const append = stream.append.bind(stream)
      stream.append = async (expectedSequence, values, options) => {
        const result = await append(expectedSequence, values, options)
        const selected = values.some((value) => {
          const record = object(value)
          if (config.window === 'quiesced') {
            return record.type === 'activation/changed' && object(record.binding).quiescedAt !== undefined
          }
          return config.outcome === 'failure'
            ? record.type === 'team/closure' && object(record.closure).kind === 'fail'
            : record.type === 'team/cancellation'
        })
        if (selected) {
          writeSync(1, `${JSON.stringify({ stage: 'crash', outcome: config.outcome, window: config.window,
            pid: process.pid, stream: descriptor.name, tail: result.tailSequence, modelRequests: model.mainRequests })}\n`)
          process.kill(process.pid, 'SIGKILL')
          await new Promise<never>(() => {})
        }
        return result
      }
      restore.push(() => { stream.append = append })
      return stream
    }
    return () => { log.open = open; for (const release of restore) release() }
  }, 'terminal-restart: post-append process loss')
}

/** Receipt proves the real Agent Client flushed the input Session before model failure is released. */
async function waitForInputReceipt(ctx: Context, input: TeamEnvelope): Promise<void> {
  assert(input.audience !== null && input.audience.length === 1)
  const recipientId = input.audience[0]
  let afterCursor = -1
  for (;;) {
    const read = await ctx.teams.readChannel({ channelId: input.channelId, afterCursor })
    if (read.records.some(record => record.type === 'channel/receipt'
      && record.envelopeId === input.id && record.participantId === recipientId)) return
    assert.equal(read.channel.phase, 'active')
    afterCursor = read.channel.cursor
    await ctx.teams.watchChannel({ channelId: input.channelId, afterCursor })
  }
}

/** Enter closure through TeamRun cancellation or its observer of a real failed Agent turn. */
async function crash(ctx: Context, config: Config, model: TerminalModel): Promise<never> {
  installCrashWindow(ctx, config, model)
  await ctx.get('loader')?.await()
  const run = await ctx.teamRuns.create({
    objective: 'Recover terminal work after abrupt Host loss.', cwd: process.cwd(),
    selection: { provider: MODEL, model: MODEL },
  })
  const link = await ctx.teamLinks.connect({ provider: 'local', binding: run.coordinatorLease.binding })
  await link.post({
    expectedCursor: (await ctx.teams.getChannel({ channelId: run.channel.manifest.id })).cursor,
    idempotencyKey: channelPostIdempotencyKeySchema.parse('terminal-restart-pending-human'),
    draft: {
      channelId: run.channel.manifest.id, audience: [run.recipient.id], kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
      payload: { content: [{ type: 'text', text: PENDING_TEXT }] }, delivery: 'context',
    },
  })
  if (config.outcome === 'cancellation') {
    await ctx.teamRuns.cancel(run.teamId)
    throw new Error('cancellation passed the selected crash window')
  }
  const input = await ctx.teamRuns.postHumanInput({
    teamId: run.teamId, content: [{ type: 'text', text: 'Fail this real coordinator turn.' }],
    idempotencyKey: channelPostIdempotencyKeySchema.parse('terminal-restart-input'),
  })
  await waitForInputReceipt(ctx, input)
  model.fail.resolve(undefined)
  for (;;) {
    const state = await ctx.teams.getTeam({ teamId: run.teamId })
    assert.notEqual(state.team.phase, 'failed', 'failure passed the selected crash window')
    await ctx.teams.watchTeam({ teamId: run.teamId, afterCursor: state.team.cursor })
  }
}

/** Only the new Loader's production closure and activation owners may continue the retained intent. */
async function recover(ctx: Context, config: Config, model: TerminalModel): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  const teamId = teamIdSchema.parse(config.teamId)
  const state = await ctx.teams.getTeam({ teamId })
  const entries = await audit(ctx, teamId)
  const quiesced = config.window === 'quiesced'
  const terminal = config.outcome === 'failure' ? 'failed' : 'cancelled'
  assert.equal(state.team.phase, quiesced ? terminal : 'stalled')
  assert.equal(state.goal.phase, 'active')
  assert.equal(state.activations.length, 1)
  const binding = state.activations[0]!
  assert.equal(binding.recovery, undefined)
  assert.equal(binding.quiescedAt !== undefined, quiesced)
  if (quiesced) {
    assert.equal(binding.activation.status, 'offline')
    assert.equal(state.team.stallReason, undefined)
  } else {
    assert.equal(state.team.stallReason?.code, 'ACTIVATION_TERMINATION_UNCONFIRMED')
    assert(state.team.stallReason.message.includes(binding.activation.id))
    assert.notEqual(binding.activation.status, 'offline')
  }
  if (config.outcome === 'failure') {
    assert.equal(state.team.cancellation, undefined)
    assert.equal(state.team.closure?.kind, 'fail')
    assert.deepEqual(state.team.closure.reason, FAILURE)
    assert.deepEqual(state.team.closure.actor, { kind: 'system', name: 'team-closure-driver' })
  } else {
    assert.equal(state.team.cancellation?.reason.code, 'USER_CANCELLED')
    assert.deepEqual(state.team.cancellation.actor, { kind: 'system', name: 'team-run' })
    assert.equal(state.team.closure?.kind, quiesced ? 'cancel' : undefined)
  }
  assert.equal(state.workspaceAllocations.length, 0)
  assert.equal(state.tasks.length, 0)
  const channelIds = state.channelIds
  assert.equal(channelIds.length, 1)
  const channel = await ctx.teams.readChannel({ channelId: channelIds[0]!, afterCursor: -1 })
  const envelopes = channel.records.filter(record => record.type === 'channel/envelope')
  const human = state.participants.find(participant => participant.kind === 'human')
  assert(human !== undefined)
  const humanMessage = envelopes.find(record => record.envelope.audience?.includes(human.id))
  assert(humanMessage !== undefined)
  assert.deepEqual(humanMessage.envelope.payload, { content: [{ type: 'text', text: PENDING_TEXT }] })
  const expired = channel.records.filter(record => record.type === 'channel/delivery-expired')
  assert.equal(expired.length, 1)
  assert.equal(expired[0]?.envelopeId, humanMessage.envelope.id)
  assert.equal(expired[0]?.reason, config.outcome === 'failure' ? 'closure' : 'cancellation')
  const receipts = channel.records.filter(record => record.type === 'channel/receipt')
  assert.equal(receipts.length, config.outcome === 'failure' ? 1 : 0)
  assert(receipts.every(record => record.envelopeId !== humanMessage.envelope.id))
  assert.equal(entries.filter(entry => entry.type === 'team/final-admitted').length, 0)
  assert.equal(model.mainRequests, 0)
  assert.equal(channel.channel.phase, quiesced ? 'closed' : 'active')
  return {
    stage: 'recover', pid: process.pid, outcome: config.outcome, window: config.window,
    teamPhase: state.team.phase, goalPhase: state.goal.phase, quiesced,
    stallCode: state.team.stallReason?.code ?? null,
    intentCode: config.outcome === 'failure' ? state.team.closure?.reason.code : state.team.cancellation?.reason.code,
    closureCount: entries.filter(entry => entry.type === 'team/closure').length,
    cancellationCount: entries.filter(entry => entry.type === 'team/cancellation').length,
    expiredHumanMessages: expired.length, expiryReason: expired[0]?.reason,
    coordinatorReceipts: receipts.length, humanReceipts: 0, finalAdmissions: 0,
    channelPhase: channel.channel.phase, modelRequests: model.mainRequests,
  }
}

/** Test-only Loader identity. */
export const name = 'headless-terminal-restart-driver'
/** The production startup sweep precedes the recovery assertions. */
export const inject = ['storage', 'teamRuns', 'teams', 'teamLinks', 'llm', 'teamClosureDriver']

/** Start one independent Host role. @param ctx - actual Loader context. @param config - parent-selected lifecycle and checkpoint. */
export function apply(ctx: Context, config: Config): void {
  const model = new TerminalModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  const operation = config.stage === 'crash' ? crash(ctx, config, model) : recover(ctx, config, model)
  void operation.then((snapshot) => {
    process.stdout.write(`${JSON.stringify(snapshot)}\n`)
    exit(0)
  }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
