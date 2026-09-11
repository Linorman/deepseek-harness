/** Real scheduler review delivery rejects an immutable oversized source and delivers an independent small source. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { TeamError, channelPostIdempotencyKeySchema } from '@clocky/clocky-team'
import type { ChannelId, EnvelopeId, TeamId } from '@clocky/clocky-team'
import { DIRECTED_VIEW_POLICY, directChannelAdapter, directChannelV2Adapter, directChannelV3Adapter, directChannelV4Adapter } from '@clocky/clocky-team-channel-direct'
import type {} from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-team-link'

const MODEL = 'channel-view-capacity-model'
const LIMIT = 32768

function chunks(text: string): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } }]
}

function tool(name: string, variant: string, args: Record<string, unknown>): StreamChunk[] {
  const id = CallId(`capacity-${variant}-${name}`)
  const argumentsText = JSON.stringify(args)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}

/** Hold only an external model response until the real activation owner cancels it. */
async function untilAborted(signal: AbortSignal | undefined): Promise<void> {
  assert(signal !== undefined)
  if (signal.aborted) return
  await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
}

class CapacityModel extends LlmAdapter {
  readonly reviewerSawView = Promise.withResolvers<undefined>()
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') { yield* chunks('Channel view capacity'); return }
    const userText = options.messages.filter(message => message.role === 'user')
      .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    const variant = userText.some(text => text.includes('CAPACITY_LARGE')) ? 'large' : 'small'
    if (userText.some(text => text.includes('"review-request"'))) {
      assert.equal(variant, 'small', 'the oversized review source must never reach a model')
      this.reviewerSawView.resolve(undefined)
      await untilAborted(options.signal)
      return
    }
    const assignment = userText.map(text => /\nTask: (\S+)\nAttempt: (\S+)/u.exec(text)).find(match => match !== null)
    const hasCall = (name: string): boolean => options.messages.some(message => message.role === 'assistant'
      && message.content.some(block => block.type === 'tool-call' && block.name === name))
    const summary = variant === 'large' ? 'CAPACITY_LARGE_RESULT' : 'CAPACITY_SMALL_RESULT'
    if (assignment !== undefined) {
      assert(assignment[1] !== undefined && assignment[2] !== undefined)
      yield* hasCall('team_task_report') ? chunks(summary) : tool('team_task_report', variant, {
        task_id: assignment[1], attempt_id: assignment[2], outcome: 'completed', summary,
      })
      return
    }
    if (!hasCall('team_task_start')) {
      yield* tool('team_task_start', variant, { subject: `Produce ${summary} for review.`,
        instructions: `Assess capacity-${variant}.txt without changing it and return ${summary}.`,
        read_scopes: [], write_scopes: [`capacity-${variant}.txt`] })
      return
    }
    await untilAborted(options.signal)
  }
}

async function trace(stage: string, facts: Record<string, unknown> = {}): Promise<void> {
  await writeFile(join(process.cwd(), 'capacity-stage.json'), `${JSON.stringify({ stage, ...facts }, null, 2)}\n`)
}

interface ViewTarget { readonly teamId: TeamId; readonly channelId: ChannelId; readonly envelopeId: EnvelopeId }

/** Find the genuine reviewer and its already-owned local Link from durable binding state. */
async function reviewer(ctx: Context, target: ViewTarget) {
  const state = await ctx.teams.getTeam({ teamId: target.teamId })
  const participant = state.participants.find(participant => participant.role === 'reviewer')
  assert(participant !== undefined)
  const binding = state.activations.find(binding => binding.activation.participantId === participant.id)
  assert(binding !== undefined)
  const agent = ctx.agents.list().find(agent => agent.session.id === binding.sessionId)
  assert(agent !== undefined)
  const borrower = ctx.teamLinks.getBoundLinkBorrower(agent)
  assert(borrower !== undefined)
  return { participant, agent, borrower }
}

async function run(ctx: Context, model: CapacityModel): Promise<Record<string, unknown>> {
  await ctx.get('loader')?.await()
  const teams = ctx.teams
  const rejected = Promise.withResolvers<ViewTarget>()
  const accepted = Promise.withResolvers<ViewTarget>()
  const receipt = Promise.withResolvers<{ envelopeId: EnvelopeId; afterFlush: boolean }>()
  const claim = teams.claimChannelDelivery.bind(teams)
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const flushed = new Set<string>()
  const consultChannels = new Set<ChannelId>()
  let current: 'large' | 'small' | undefined
  let deliveredBytes = 0
  const stop = ctx.on('channel/changed', (event) => {
    if (event.record.type === 'channel/opened' && event.record.manifest.adapter.type === 'consult') consultChannels.add(event.channelId)
    if (event.record.type === 'channel/receipt' && consultChannels.has(event.channelId)) {
      receipt.resolve({ envelopeId: event.record.envelopeId, afterFlush: flushed.has(event.record.envelopeId) })
    }
  })
  teams.claimChannelDelivery = async (request) => {
    try {
      const result = await claim(request)
      if (result?.view !== undefined && result.channel.manifest.adapter.type === 'consult') {
        const text = result.view.content[0]
        assert(text?.type === 'text')
        deliveredBytes = Buffer.byteLength(text.text, 'utf8')
        accepted.resolve({ teamId: result.channel.manifest.teamId, channelId: request.channelId, envelopeId: request.envelopeId })
      }
      return result
    } catch (error: unknown) {
      if (current === 'large' && error instanceof TeamError && error.code === 'TEAM_CHANNEL_BACKPRESSURE') {
        assert(error.message.includes(`exceeding maxChannelViewBytes ${LIMIT}`))
        const channel = await teams.getChannel({ channelId: request.channelId })
        assert.equal(channel.manifest.adapter.type, 'consult')
        rejected.resolve({ teamId: channel.manifest.teamId, channelId: request.channelId, envelopeId: request.envelopeId })
      } else if (current === 'large') rejected.reject(error)
      else if (current === 'small') accepted.reject(error)
      throw error
    }
  }
  ctx.sessions.flush = async (session) => {
    const written = await flush(session)
    for (const event of session.events) if (event.type === 'team/channel-view') flushed.add(event.data.triggeringEnvelopeId)
    return written
  }
  const start = async (variant: 'large' | 'small') => {
    current = variant
    const run = await ctx.teamRuns.create({ objective: `Observe ${variant} immutable non-direct delivery.`, cwd: process.cwd(),
      selection: { provider: MODEL, model: MODEL } })
    await ctx.teamRuns.postHumanInput({ teamId: run.teamId,
      idempotencyKey: channelPostIdempotencyKeySchema.parse(`view-capacity-${variant}-input`),
      content: [{ type: 'text', text: `Start the CAPACITY_${variant.toUpperCase()} task and retain its review.` }] })
    return run
  }
  try {
    const large = await start('large')
    const failed = await rejected.promise
    const owner = await reviewer(ctx, failed)
    const before = await teams.getChannel({ channelId: failed.channelId })
    const pending = await teams.listChannelPendingDeliveries({ channelId: failed.channelId,
      participantId: owner.participant.id, afterCursor: -1, limit: 16 })
    const source = pending.deliveries.find(item => item.envelope.id === failed.envelopeId)
    assert(source !== undefined)
    assert(Buffer.byteLength(JSON.stringify(source.envelope), 'utf8') < LIMIT)
    const rejectedViews = (): number => owner.agent.session.events.filter(event => event.type === 'team/channel-view'
      && event.data.triggeringEnvelopeId === failed.envelopeId).length
    assert.equal(rejectedViews(), 0)
    await owner.borrower.withLink(async (link) => {
      await assert.rejects(link.claim(failed.channelId, failed.envelopeId), (error: unknown) =>
        error instanceof TeamError && error.code === 'TEAM_CHANNEL_BACKPRESSURE')
    })
    await ctx.sessions.flush(owner.agent.session)
    assert.equal(rejectedViews(), 0)
    const beforeRecords = await teams.readChannelPage({ channelId: failed.channelId, afterCursor: -1, limit: 64 })
    assert(!beforeRecords.records.some(record => record.type === 'channel/receipt' && record.envelopeId === failed.envelopeId))
    assert.equal((await teams.getChannel({ channelId: failed.channelId })).cursor, before.cursor)
    await trace('immutable-source-rejected', { ...failed, repeatedClaimRejected: true, sessionViews: 0, receipts: 0 })
    current = undefined
    await ctx.teamRuns.cancel(large.teamId)
    assert.equal((await teams.getTeam({ teamId: large.teamId })).team.phase, 'cancelled')

    const small = await start('small')
    const delivered = await accepted.promise
    const deliveredOwner = await reviewer(ctx, delivered)
    const acknowledged = await receipt.promise
    assert.equal(acknowledged.envelopeId, delivered.envelopeId)
    assert(acknowledged.afterFlush)
    await model.reviewerSawView.promise
    assert(deliveredBytes > 0 && deliveredBytes <= LIMIT)
    assert.equal(deliveredOwner.agent.session.events.filter(event => event.type === 'team/channel-view'
      && event.data.triggeringEnvelopeId === delivered.envelopeId).length, 1)
    const after = await teams.readChannelPage({ channelId: delivered.channelId, afterCursor: -1, limit: 64 })
    assert.equal(after.records.filter(record => record.type === 'channel/receipt' && record.envelopeId === delivered.envelopeId).length, 1)
    const remaining = await teams.listChannelPendingDeliveries({ channelId: delivered.channelId,
      participantId: deliveredOwner.participant.id, afterCursor: -1, limit: 16 })
    assert(!remaining.deliveries.some(item => item.envelope.id === delivered.envelopeId))
    current = undefined
    await ctx.teamRuns.cancel(small.teamId)
    assert.equal((await teams.getTeam({ teamId: small.teamId })).team.phase, 'cancelled')
    await trace('complete')
    return { scenario: 'channel-view-capacity', adapter: 'consult/1', purePolicy: true, utf8Limit: LIMIT,
      oversizedSource: { rejected: 'TEAM_CHANNEL_BACKPRESSURE', repeatedClaimRejected: true, pendingRetained: true,
        cursorUnchanged: true, sessionViews: 0, receipts: 0 },
      smallerSource: { sessionViews: 1, receipts: 1, receiptAfterFlush: true, modelSawView: true },
      teamsCancelledAfterVerification: 2 }
  } finally {
    teams.claimChannelDelivery = claim
    ctx.sessions.flush = flush
    stop()
  }
}

/** Test-only Loader identity. */
export const name = 'channel-view-capacity-driver'
/** Actual Team, Link, Agent, model and Session owners. */
export const inject = ['teamRuns', 'teams', 'agents', 'teamLinks', 'llm', 'sessions']

/** Register an actual pure protocol policy and drive independent source cases. @param ctx - Loader context. */
export function apply(ctx: Context): void {
  ctx.teams.registerAdapter(directChannelAdapter)
  ctx.teams.registerAdapter(directChannelV2Adapter)
  ctx.teams.registerAdapter(directChannelV3Adapter)
  ctx.teams.registerAdapter(directChannelV4Adapter)
  ctx.teams.registerViewPolicy({ ...DIRECTED_VIEW_POLICY, project(input) {
    const large = input.records.some(record => record.type === 'channel/envelope'
      && record.envelope.kind === 'review-request' && JSON.stringify(record.envelope.payload).includes('CAPACITY_LARGE_RESULT'))
    const view = { ...DIRECTED_VIEW_POLICY.project(input), padding: large ? '中'.repeat(LIMIT / 2) : '' }
    if (large) {
      const text = JSON.stringify(view)
      assert(text.length < LIMIT && Buffer.byteLength(text, 'utf8') > LIMIT)
    }
    return view
  } })
  const model = new CapacityModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void run(ctx, model).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    exit(0)
  }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
