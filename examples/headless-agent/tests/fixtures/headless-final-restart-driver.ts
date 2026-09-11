/** Abrupt exit after a real storage append, followed by independent Loader recovery. */
import assert from 'node:assert/strict'
import { writeSync } from 'node:fs'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { channelPostIdempotencyKeySchema, fingerprintTeamFinalContent, teamIdSchema } from '@clocky/clocky-team'
import type { TeamAuditEntry, TeamEnvelope, TeamId } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-storage-log'
import type {} from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-team-link'
import type {} from '@clocky/clocky-team-closure-driver'

const MODEL = 'headless-final-restart-model'
const FINAL_TEXT = 'DURABLE_TEAM_FINAL_AFTER_HOST_LOSS'

/** Test process role and the storage append selected for abrupt exit. */
export interface Config {
  readonly stage: 'crash' | 'recover'
  readonly window: 'intent' | 'sink' | 'receipt'
  readonly teamId?: string
}

/** Validate parent-process inputs before any Team operation. */
export const Config: z<Config> = z.object({
  stage: z.union(['crash', 'recover'] as const).required(),
  window: z.union(['intent', 'sink', 'receipt'] as const).required(),
  teamId: z.string(),
})

/** Only the external model is substituted; no agent turn is required to publish a final. */
class RestartModel extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Read the authoritative Team journal through its public paged projection. */
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

/** Interrupt only after the configured storage backend has durably returned its append. */
function installCrashWindow(ctx: Context, window: Config['window']): void {
  const log = ctx.storage.log
  const open = log.open.bind(log)
  const restore: Array<() => void> = []
  const recordType = { intent: 'team/closure', sink: 'team/final-admitted', receipt: 'channel/receipt' }[window]
  ctx.effect(() => {
    log.open = async (descriptor) => {
      const stream = await open(descriptor)
      const append = stream.append.bind(stream)
      stream.append = async (expectedSequence, values) => {
        const result = await append(expectedSequence, values)
        if (values.some(value => object(value).type === recordType)) {
          writeSync(1, `${JSON.stringify({ stage: 'crash', window, pid: process.pid, stream: descriptor.name, tail: result.tailSequence })}\n`)
          process.kill(process.pid, 'SIGKILL')
          await new Promise<never>(() => {})
        }
        return result
      }
      restore.push(() => { stream.append = append })
      return stream
    }
    return () => {
      log.open = open
      for (const release of restore) release()
    }
  }, 'final-restart: post-append process-loss window')
}

/** The first Host creates all identities and closure authority through TeamRun and Link. */
async function crash(ctx: Context, config: Config): Promise<never> {
  installCrashWindow(ctx, config.window)
  await ctx.get('loader')?.await()
  const run = await ctx.teamRuns.create({
    objective: 'Recover the accepted final after abrupt Host loss.', cwd: process.cwd(),
    selection: { provider: MODEL, model: MODEL },
  })
  const link = await ctx.teamLinks.connect({ provider: 'local', binding: run.coordinatorLease.binding })
  await link.post({
    expectedCursor: (await ctx.teams.getChannel({ channelId: run.channel.manifest.id })).cursor,
    idempotencyKey: channelPostIdempotencyKeySchema.parse('headless-final-restart-final'),
    draft: {
      channelId: run.channel.manifest.id, audience: [run.recipient.id], kind: 'final',
      payload: { text: FINAL_TEXT }, delivery: 'turn',
    },
  })
  // Later windows retain controller-confirmed quiescence, so the new Host can
  // complete without inferring termination from a missing process-local handle.
  if (config.window !== 'intent') {
    await run.coordinatorLease.dispose()
    const stopped = await ctx.teams.getTeam({ teamId: run.teamId })
    assert.equal(stopped.activations.length, 1)
    assert(stopped.activations[0]?.quiescedAt !== undefined)
    assert.equal(stopped.activations[0]?.activation.status, 'offline')
  }
  await ctx.teamRuns.waitForFinal({ teamId: run.teamId })
  throw new Error(`final restart process passed its ${config.window} crash window`)
}

/** Fresh Loader owners recover only durable state; no old TeamRun handle or proof is recreated. */
async function recover(ctx: Context, config: Config): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  const teamId = teamIdSchema.parse(config.teamId)
  const state = await ctx.teams.getTeam({ teamId })
  const closure = state.team.closure
  assert(closure?.kind === 'complete', 'the original completion intent must survive Host loss')
  assert(closure.finalChannelId !== undefined && closure.finalEnvelopeId !== undefined)
  const channel = await ctx.teams.readChannel({ channelId: closure.finalChannelId, afterCursor: -1 })
  const final = channel.records.find(record => record.type === 'channel/envelope')
  assert(final?.type === 'channel/envelope')
  const envelope: TeamEnvelope = final.envelope
  assert.equal(envelope.kind, 'final')
  assert(envelope.audience !== null && envelope.audience.length === 1)
  const humanId = envelope.audience[0]
  assert.equal(envelope.id, closure.finalEnvelopeId)
  assert.equal(envelope.payload.text, FINAL_TEXT)
  const entries = await audit(ctx, teamId)
  const admissions = entries.filter(entry => entry.type === 'team/final-admitted')
  assert.equal(admissions.length, 1, 'startup recovery must retain exactly one human sink admission')
  const admission = object(admissions[0]?.facts.admission)
  assert.equal(admission.envelopeId, envelope.id)
  assert.equal(admission.contentFingerprint, fingerprintTeamFinalContent(envelope.payload))
  assert.equal(admission.sink, 'team-run-result')
  assert.equal(admission.recipientId, humanId)
  const recipient = state.participants.find(participant => participant.id === humanId)
  assert(recipient?.kind === 'human')
  assert.deepEqual(admission.owner, recipient.owner)
  const receipts = channel.records.filter(record => record.type === 'channel/receipt')
  assert.equal(receipts.length, 1, 'startup recovery must retain exactly one durable human receipt')
  assert.equal(receipts[0]?.envelopeId, envelope.id)
  assert.equal(receipts[0]?.participantId, humanId)
  const quiesced = config.window !== 'intent'
  assert.equal(state.team.phase, quiesced ? 'completed' : 'stalled')
  assert.equal(state.goal.phase, 'complete')
  assert.equal(state.activations.length, 1)
  const binding = state.activations[0]!
  assert.equal(binding.recovery, undefined)
  assert.equal(binding.quiescedAt !== undefined, quiesced)
  if (quiesced) {
    assert.equal(binding.activation.status, 'offline')
    assert.equal(state.team.stallReason, undefined)
  } else {
    assert.notEqual(binding.activation.status, 'offline')
    assert.equal(state.team.stallReason?.code, 'ACTIVATION_TERMINATION_UNCONFIRMED')
    assert(state.team.stallReason.message.includes(binding.activation.id))
  }
  return {
    stage: 'recover', pid: process.pid, window: config.window,
    teamPhase: state.team.phase, goalPhase: state.goal.phase,
    stallCode: state.team.stallReason?.code ?? null, exactActivationInStall: !quiesced,
    quiesced, recoveryDescriptor: false,
    finalText: envelope.payload.text, sinkAdmissions: admissions.length, humanReceipts: receipts.length,
    closureCount: entries.filter(entry => entry.type === 'team/closure').length,
    channelPhase: channel.channel.phase,
  }
}

/** Test-only Loader identity. */
export const name = 'headless-final-restart-driver'
/** The production startup sweep must finish before the recovered journal is inspected. */
export const inject = ['storage', 'teamRuns', 'teams', 'teamLinks', 'llm', 'teamClosureDriver']

/** Launch one crash or recovery role. @param ctx - real Loader context. @param config - parent-selected role and window. */
export function apply(ctx: Context, config: Config): void {
  ctx.llm.registerAdapter([MODEL], new RestartModel())
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  const operation = config.stage === 'crash' ? crash(ctx, config) : recover(ctx, config)
  void operation.then((snapshot) => {
    process.stdout.write(`${JSON.stringify(snapshot)}\n`)
    exit(0)
  }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
