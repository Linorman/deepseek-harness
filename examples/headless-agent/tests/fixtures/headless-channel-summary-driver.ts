/** Explicit summaries through a real default coordinator and authenticated Host API. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { createApiProxy, InProcessApiClient, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import type { RpcResponse } from '@clocky/clocky-host-apiproxy/api'
import { channelInvitationIdempotencyKeySchema, channelSummaryIdempotencyKeySchema, jsonObjectSchema } from '@clocky/clocky-team'
import { createPrincipalChannelAdmission } from '@clocky/clocky-team-channel-admission/principal'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import type { ChannelId } from '@clocky/clocky-team'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type {} from '@clocky/clocky-team-run'
import { selection, started, toolFinished } from './headless-channel-summary-llm.ts'

function value<T>(response: RpcResponse<T>): T {
  if (!response.result.ok) throw new Error(JSON.stringify(response.result.error))
  return response.result.value
}

/** Observe the actual AgentClient Session write for one selected non-direct channel. */
function waitForView(ctx: Context, channelId: ChannelId): Promise<void> {
  const result = Promise.withResolvers<undefined>()
  const timer = setTimeout(() => { dispose(); result.reject(new Error('Summary channel view did not reach Session')) }, 10_000)
  const dispose = ctx.on('session/event', (_session, event) => {
    if (event.type !== 'team/channel-view' || event.data.channelId !== channelId) return
    clearTimeout(timer)
    dispose()
    result.resolve(undefined)
  })
  return result.promise
}

async function run(ctx: Context, exit: (code: number) => void): Promise<void> {
  await ctx.get('loader')?.await()
  const principalId = productPrincipalId('summary-fixture-human')
  const humanOwner = { kind: 'product-principal' as const, principalId }
  const call: AuthenticatedProductCall = { principal: { id: principalId, issuer: 'fixture', subject: 'summary-human',
    assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
  const handle = await ctx.teamRuns.create({ objective: 'Create explicit channel summaries.', cwd: process.cwd(), humanOwner,
    admitHumanChannel: createPrincipalChannelAdmission(ctx, call) })
  const coordinator = handle.coordinatorLease.localAgent
  if (coordinator === undefined) throw new Error('Summary fixture requires the real local coordinator')
  const envelope = await ctx.teamRuns.postHumanInput({ teamId: handle.teamId, humanOwner,
    content: [{ type: 'text', text: 'Alpha source. Beta detail.' }] })
  // The first real model request waits for the durable delivery receipt to settle before selecting its cursor.
  await started.promise
  const current = await ctx.teams.getChannel({ channelId: envelope.channelId })
  selection.resolve({ channelId: envelope.channelId, expectedCursor: current.cursor,
    coveredSequenceRange: { from: envelope.sequence, to: envelope.sequence },
    idempotencyKey: channelSummaryIdempotencyKeySchema.parse('coordinator-summary') })
  await toolFinished.promise
  await coordinator.whenIdle()
  const records = await ctx.teams.readChannel({ channelId: envelope.channelId, afterCursor: -1 })
  const toolSummary = records.records.find(record => record.type === 'channel/summary')
  assert(toolSummary?.type === 'channel/summary', JSON.stringify(coordinator.session.events))
  assert.equal(toolSummary.text, `[${String(envelope.sequence)}] Alpha source. Beta detail.`)
  assert(coordinator.session.events.some(event => event.type === 'tool/result'))

  const api = createApiProxy(ctx, { defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(), cwd: process.cwd() })
  const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call }))
  const humanInput = { channelId: envelope.channelId,
    expectedCursor: (await ctx.teams.getChannel({ channelId: envelope.channelId })).cursor,
    coveredSequenceRange: { from: envelope.sequence, to: envelope.sequence },
    idempotencyKey: channelSummaryIdempotencyKeySchema.parse('human-summary') }
  const humanSummary = value(await client.teams.channelSummarize(humanInput))
  assert.equal(humanSummary.text, toolSummary.text)
  assert.deepEqual(value(await client.teams.channelSummarize(humanInput)), humanSummary)
  const unauthenticated = new InProcessApiClient(toFetchHandler(api))
  assert.equal((await unauthenticated.teams.channelSummarize(humanInput)).result.ok, false)
  const viewChannel = value(await client.teams.channelOpen({ teamId: handle.teamId,
    expectedCursor: (await ctx.teams.getTeam({ teamId: handle.teamId })).team.cursor,
    adapter: { type: 'discussion', version: 1 }, viewPolicy: { type: 'summarized-window', version: 1 },
    participants: [{ id: handle.recipient.id, role: 'initiator' }, { id: handle.coordinator.id, role: 'respondent' }],
    limits: { maxTurns: 8, speakerPolicy: 'free-form' } }))
  const admission = await ctx.teams.getChannelAdmission({ channelId: viewChannel.manifest.id })
  assert.deepEqual(admission.channel.manifest.adapter, { type: 'discussion', version: 1 })
  assert.deepEqual(admission.channel.manifest.viewPolicy, { type: 'summarized-window', version: 1 })
  const invitation = admission.invitations.find(item => item.participantId === handle.recipient.id)
  assert(invitation?.endpoint.kind === 'human' && invitation.role === 'initiator')
  const consent = { channelId: viewChannel.manifest.id, revision: invitation.revision,
    manifestFingerprint: invitation.manifestFingerprint,
    idempotencyKey: channelInvitationIdempotencyKeySchema.parse('summary-discussion-human') }
  await ctx.teamHumanActors.withProof(call, { teamId: handle.teamId, operation: 'channel-open',
    fence: { kind: 'revision', revision: consent.revision }, payload: jsonObjectSchema.parse(consent) },
  async (actor) => { await ctx.teams.acknowledgeChannelInvitation({ actor, ...consent }) })
  const activeViewChannel = await ctx.teamChannelAdmission.waitUntilActive({ channelId: viewChannel.manifest.id, signal: call.signal })
  const sourceView = waitForView(ctx, viewChannel.manifest.id)
  const viewSource = value(await client.teams.channelPost({ channelId: viewChannel.manifest.id, expectedCursor: activeViewChannel.cursor,
    audience: [handle.coordinator.id], kind: 'message', payload: { text: 'Shared discussion source.' }, delivery: 'context' }))
  await sourceView
  const viewSummary = value(await client.teams.channelSummarize({ channelId: viewChannel.manifest.id,
    expectedCursor: (await ctx.teams.getChannel({ channelId: viewChannel.manifest.id })).cursor,
    coveredSequenceRange: { from: viewSource.sequence, to: viewSource.sequence },
    idempotencyKey: channelSummaryIdempotencyKeySchema.parse('discussion-summary') }))
  const tailView = waitForView(ctx, viewChannel.manifest.id)
  const tail = value(await client.teams.channelPost({ channelId: viewChannel.manifest.id,
    expectedCursor: (await ctx.teams.getChannel({ channelId: viewChannel.manifest.id })).cursor,
    audience: [handle.coordinator.id], kind: 'message', payload: { text: 'Uncovered discussion tail.' }, delivery: 'turn' }))
  await tailView
  await coordinator.whenIdle()
  const persistedView = coordinator.session.events.find(event => event.type === 'team/channel-view'
    && event.data.triggeringEnvelopeId === tail.id)
  assert(persistedView?.type === 'team/channel-view')
  assert.deepEqual(persistedView.data.sourceEnvelopeIds, [viewSource.id, tail.id])
  const content = persistedView.data.content[0]
  assert(content?.type === 'text')
  const rendered = JSON.parse(content.text) as { view: { messages: readonly { summary?: string; payload?: { text?: string } }[] } }
  assert.equal(rendered.view.messages[0]?.summary, viewSummary.text)
  assert.equal(rendered.view.messages[1]?.payload?.text, 'Uncovered discussion tail.')
  process.stdout.write(JSON.stringify({ coordinatorTool: toolSummary.text, humanApi: humanSummary.text,
    sameFingerprint: toolSummary.sourceFingerprint === humanSummary.sourceFingerprint, retry: 'same durable record',
    sessionView: { summary: viewSummary.text, tail: rendered.view.messages[1]?.payload?.text, sourceCount: persistedView.data.sourceEnvelopeIds.length } }) + '\n')
  exit(0)
}

export const name = 'headless-channel-summary-driver'
export const inject = ['teamRuns', 'teams', 'agents', 'teamChannelSummaries', 'agentDefaultModel', 'userQuestions', 'teamHumanActors', 'teamChannelAdmission']
export function apply(ctx: Context): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('Summary fixture requires appExit')
  void run(ctx, exit).catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); exit(1) })
}
