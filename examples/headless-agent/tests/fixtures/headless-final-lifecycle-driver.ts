/** Real-owner final expiry and replacement through the assembled headless Loader profile. */

import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { channelPostIdempotencyKeySchema, fingerprintTeamFinalContent, TeamError } from '@clocky/clocky-team'
import type { ChannelRecord, TeamAuditEntry, TeamEnvelope, TeamId } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-link'
import type {} from '@clocky/clocky-team-run'

const MODEL = 'headless-final-lifecycle-model'
const EXPIRED_TEXT = 'EXPIRED_TEAM_FINAL'
const REPLACEMENT_TEXT = 'VALID_REPLACEMENT_TEAM_FINAL'

/** External model stand-in; lifecycle authority remains in the mounted production owners. */
class FinalLifecycleModel extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Deterministic lifecycle fixture.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Deterministic lifecycle fixture.' } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Read a bounded Team audit sequence after its owning producer has committed. */
async function audit(ctx: Context, teamId: TeamId): Promise<readonly TeamAuditEntry[]> {
  const entries: TeamAuditEntry[] = []
  let afterCursor = -1
  for (;;) {
    const page = await ctx.teams.readAudit({ teamId, afterCursor, limit: 32 })
    entries.push(...page.items)
    if (page.nextCursor === undefined) return entries
    afterCursor = page.nextCursor
  }
}

/** Wait for the scheduler's durable expiry record, never an elapsed-time assumption. */
async function waitForExpiry(ctx: Context, envelope: TeamEnvelope, signal: AbortSignal): Promise<void> {
  let afterCursor = -1
  for (;;) {
    signal.throwIfAborted()
    const read = await ctx.teams.readChannel({ channelId: envelope.channelId, afterCursor })
    if (read.records.some(record => record.type === 'channel/delivery-expired' && record.envelopeId === envelope.id)) return
    assert.equal(read.channel.phase, 'active', 'final channel closed before its pending delivery expired')
    afterCursor = read.channel.cursor
    await ctx.teams.watchChannel({ channelId: envelope.channelId, afterCursor, signal })
  }
}

/** Resolve an audit record's JSON-owned fields without relying on the Hub's private projection. */
function object(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  return value as Record<string, unknown>
}

/** Normalize only final identities while preserving every channel record discriminator and sequence. */
function channelRecord(record: ChannelRecord, expired: TeamEnvelope, replacement: TeamEnvelope): Record<string, unknown> {
  if (record.type === 'channel/envelope') {
    const final = record.envelope.id === expired.id ? 'expired' : 'replacement'
    return { type: record.type, sequence: record.envelope.sequence, final, text: record.envelope.payload.text }
  }
  if (record.type === 'channel/delivery-expired' || record.type === 'channel/receipt') {
    const final = record.envelopeId === expired.id ? 'expired' : 'replacement'
    assert(record.envelopeId === expired.id || record.envelopeId === replacement.id)
    return { type: record.type, sequence: record.sequence, final }
  }
  if (record.type === 'channel/phase' || record.type === 'channel/closed') {
    return { type: record.type, sequence: record.sequence, phase: record.phase }
  }
  return { type: record.type, sequence: record.sequence }
}

/** Exercise only the public TeamRun handle, local Link, scheduler, and durable read APIs. */
async function run(ctx: Context): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  const handle = await ctx.teamRuns.create({
    objective: 'Reject an expired final and accept its later replacement.', cwd: process.cwd(),
    selection: { provider: MODEL, model: MODEL },
  })
  const coordinator = handle.coordinatorLease.localAgent
  assert(coordinator !== undefined, 'TeamRun must publish a real local coordinator')
  const link = await ctx.teamLinks.connect({ provider: 'local', binding: handle.coordinatorLease.binding })
  const abort = new AbortController()
  const deadline = setTimeout(() => { abort.abort(new Error('final lifecycle snapshot timed out')) }, 10_000)
  // Exact post-commit notification cursors preserve ordering between the Team and channel streams.
  const observed: { readonly stream: 'team' | 'channel'; readonly cursor: number }[] = []
  const stopTeam = ctx.on('team/changed', (event) => {
    if (event.type === 'team/changed' && event.team.id === handle.teamId) {
      observed.push({ stream: 'team', cursor: event.team.cursor })
    } else if (event.type === 'activation/changed' && event.binding.activation.teamId === handle.teamId) {
      observed.push({ stream: 'team', cursor: event.cursor })
    }
  })
  const stopChannel = ctx.on('channel/changed', (event) => {
    if (event.channelId === handle.channel.manifest.id && event.record.type === 'channel/receipt') {
      observed.push({ stream: 'channel', cursor: event.record.sequence })
    }
  })
  try {
    const channel = await ctx.teams.getChannel({ channelId: handle.channel.manifest.id })
    const expired = await link.post({
      expectedCursor: channel.cursor,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('headless-expired-final'),
      draft: {
        channelId: channel.manifest.id, audience: [handle.recipient.id], kind: 'final',
        payload: { text: EXPIRED_TEXT }, delivery: 'turn', ttlMs: 1,
      },
    })
    await waitForExpiry(ctx, expired, abort.signal)
    let rejectionCode: string | undefined
    try {
      await ctx.teamRuns.waitForFinal({ teamId: handle.teamId, signal: abort.signal })
    } catch (error: unknown) {
      if (!(error instanceof TeamError)) throw error
      rejectionCode = error.code
    }
    const rejected = await ctx.teams.getTeam({ teamId: handle.teamId })
    const rejectedAudit = await audit(ctx, handle.teamId)
    const rejectedChannel = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
    const rejectedSummary = {
      code: rejectionCode, teamPhase: rejected.team.phase, goalPhase: rejected.goal.phase,
      closure: rejected.team.closure !== undefined,
      sinkAdmissions: rejectedAudit.filter(entry => entry.type === 'team/final-admitted').length,
      humanReceipts: rejectedChannel.records.filter(record => record.type === 'channel/receipt').length,
    }
    assert.deepEqual(rejectedSummary, {
      code: 'TEAM_FINAL_INVALID', teamPhase: 'active', goalPhase: 'active',
      closure: false, sinkAdmissions: 0, humanReceipts: 0,
    })

    const replacement = await link.post({
      expectedCursor: rejectedChannel.channel.cursor,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('headless-replacement-final'),
      draft: {
        channelId: channel.manifest.id, audience: [handle.recipient.id], kind: 'final',
        payload: { text: REPLACEMENT_TEXT }, delivery: 'turn',
      },
    })
    const final = await ctx.teamRuns.waitForFinal({ teamId: handle.teamId, afterCursor: expired.sequence, signal: abort.signal })
    assert.equal(final.envelopeId, replacement.id)
    assert.equal(final.text, REPLACEMENT_TEXT)
    const completed = await ctx.teams.getTeam({ teamId: handle.teamId })
    const finalAudit = await audit(ctx, handle.teamId)
    const finalChannel = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
    const admissions = finalAudit.filter(entry => entry.type === 'team/final-admitted')
    assert.equal(admissions.length, 1)
    const admission = object(admissions[0]?.facts.admission, 'final admission')
    assert.equal(admission.envelopeId, replacement.id)
    assert.equal(admission.envelopeSequence, replacement.sequence)
    assert.equal(admission.contentFingerprint, fingerprintTeamFinalContent(replacement.payload))
    assert.equal(admission.recipientId, handle.recipient.id)
    assert.deepEqual(admission.owner, handle.recipient.owner)
    assert.equal(completed.team.phase, 'completed')
    assert.equal(completed.goal.phase, 'complete')
    assert.equal(finalChannel.channel.phase, 'closed')
    assert.equal(ctx.agents.get(coordinator.id) === undefined, true, 'the coordinator Agent must be released')
    const coordinatorBinding = completed.activations.find(binding => (
      binding.activation.id === handle.coordinatorLease.binding.activation.id
    ))
    assert.equal(coordinatorBinding?.activation.status, 'offline')
    const receipt = finalChannel.records.filter(record => record.type === 'channel/receipt')
    assert.equal(receipt.length, 1)
    assert.equal(receipt[0]?.envelopeId, replacement.id)

    const byCursor = new Map(finalAudit.map(entry => [entry.cursor, entry]))
    const commitOrder = observed.flatMap((entry) => {
      if (entry.stream === 'channel') return ['channel/receipt']
      const committed = byCursor.get(entry.cursor)
      return committed?.type === 'team/closure' || committed?.type === 'team/final-admitted' ? [committed.type] : []
    })
    assert.deepEqual(commitOrder, ['team/closure', 'team/final-admitted', 'channel/receipt'])
    const activationProgress = observed.flatMap((entry) => {
      if (entry.stream !== 'team') return []
      const committed = byCursor.get(entry.cursor)
      if (committed?.type !== 'activation/changed') return []
      const binding = object(committed.facts.binding, 'activation binding')
      const activation = object(binding.activation, 'activation')
      return activation.id === handle.coordinatorLease.binding.activation.id ? [activation.status] : []
    })
    return {
      scenario: 'headless-final-lifecycle',
      rejected: rejectedSummary,
      accepted: {
        text: final.text, exactReplacement: final.envelopeId === replacement.id, teamPhase: completed.team.phase,
        goalPhase: completed.goal.phase, sink: admission.sink, humanReceipts: receipt.length,
        channelPhase: finalChannel.channel.phase,
      },
      commitOrder,
      activationProgress,
      channelRecords: finalChannel.records.map(record => channelRecord(record, expired, replacement)),
    }
  } finally {
    clearTimeout(deadline)
    stopTeam()
    stopChannel()
    await link.close()
  }
}

/** Test-only plugin name. */
export const name = 'headless-final-lifecycle-driver'
/** Real owners must be available before the fixture creates its run. */
export const inject = ['teamRuns', 'teams', 'teamLinks', 'agents', 'llm', 'teamClosureDriver']

/** Start the scenario after Loader settlement. @param ctx - assembled headless context. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([MODEL], new FinalLifecycleModel())
  const exit = ctx.get('appExit')
  assert(exit !== undefined, 'final lifecycle fixture requires the real appExit service')
  void run(ctx).then((snapshot) => {
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`)
    exit(0)
  }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
