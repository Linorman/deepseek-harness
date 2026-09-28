import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { Inbox } from '@clocky/clocky-agent'
import type { Agent, PreStepDecision } from '@clocky/clocky-agent'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import type { SessionEvent, TeamChannelViewEventData } from '@clocky/clocky-session'
import { createUserMessage } from '@clocky/clocky-llm'
import type { UserMessage } from '@clocky/clocky-llm'
import {
  activationBindingSnapshotSchema,
  channelDeliveryClaimSchema,
  channelSnapshotSchema,
  teamChannelViewEventDataSchema,
  teamEnvelopeSchema,
} from '@clocky/clocky-team'
import type { ChannelDeliveryClaim, TeamEnvelope } from '@clocky/clocky-team'
import type { TeamLink, TeamLinkConnectRequest } from '@clocky/clocky-team-link'
import { FixedBindingTeamAgentLinkDelivery } from '../../../packages/team/team-agent-client/src/index.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

/** Real Session and Inbox records with transport and persistence controlled at their public APIs. */
async function harness(
  delivery: TeamEnvelope['delivery'] = 'turn',
  seed?: readonly SessionEvent[],
  seedLength?: number,
  maxTaskOutputContinuations = 3,
) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('channel-view-recipient'), {
    ...seed === undefined ? {} : { seed },
    meta: { teamId: 'team-channel-view', participantId: 'recipient', ...seedLength === undefined ? {} : { seedLength } },
  })
  const flush = vi.spyOn(ctx.sessions, 'flush').mockResolvedValue(true)
  const inbox = new Inbox(session, {
    inserted() {},
    discarded(message) { ctx.emit('agent/inbox/discarded', { agent: target, message }) },
    claimed(message, turn) { ctx.emit('agent/inbox/claimed', { agent: target, message, turn }) },
  })
  const inject = vi.fn((message: UserMessage) => { inbox.append('next-step', message) })
  const followup = vi.fn((message: UserMessage) => { inbox.append('next-turn', message) })
  const steer = vi.fn((message: UserMessage) => { inbox.prepend('next-step', message) })
  const cancel = vi.fn()
  const target = {
    id: session.id,
    ctx,
    session,
    inbox,
    inject,
    followup,
    steer,
    cancel,
    whenIdle: vi.fn(async () => {}),
  } as unknown as Agent
  const agents = { get: vi.fn(() => target), list: vi.fn(() => [target]) }
  ctx.provide('agents', agents as never)
  const binding = activationBindingSnapshotSchema.parse({
    activation: { id: 'activation-view', teamId: 'team-channel-view', participantId: 'recipient', status: 'idle' },
    sessionId: session.id,
    provider: 'in-process',
  })
  const envelope = teamEnvelopeSchema.parse({
    id: 'envelope-view', teamId: 'team-channel-view', channelId: 'channel-view', sequence: 2,
    senderId: 'sender', audience: ['recipient'], kind: 'request', payload: { text: 'Review this result.' },
    delivery, priority: 'normal', createdAt: 1,
  })
  const channel = channelSnapshotSchema.parse({
    manifest: {
      id: envelope.channelId, teamId: envelope.teamId,
      adapter: { type: 'consult', version: 1 }, viewPolicy: { type: 'recent-window', version: 1 },
      participants: [{ id: 'sender', role: 'initiator' }, { id: 'recipient', role: 'respondent' }], limits: {},
    }, phase: 'active', cursor: 2,
  })
  const view = teamChannelViewEventDataSchema.parse({
    teamId: envelope.teamId, channelId: envelope.channelId, triggeringEnvelopeId: envelope.id,
    sourceEnvelopeIds: [envelope.id], delivery,
    adapter: channel.manifest.adapter, viewPolicy: channel.manifest.viewPolicy,
    content: [{ type: 'text', text: 'Review this result.' }],
  })
  const accepted = channelDeliveryClaimSchema.parse({ binding, channel, envelopeId: envelope.id, delivery, view })
  const claim = vi.fn(async (): Promise<ChannelDeliveryClaim | undefined> => accepted)
  const acknowledge = vi.fn(async () => undefined)
  const settleTaskAttempt = vi.fn(async () => undefined)
  let notify: ((envelope: TeamEnvelope) => Promise<void>) | undefined
  let request: TeamLinkConnectRequest | undefined
  const link = {
    provider: 'controlled-view', binding, done: new Promise<void>(() => {}), claim, acknowledge,
    onInvitation() { return () => {} },
    onNotify(listener: (envelope: TeamEnvelope) => Promise<void>) { notify = listener; return () => { notify = undefined } },
    onInterrupt() { return () => {} },
    onTaskCancellation() { return () => {} },
    settleTaskAttempt,
    close: vi.fn(async () => {}),
  } as unknown as TeamLink
  ctx.provide('teamLinks', {
    registerBoundLinkBorrower: () => () => {},
    async connect(value: TeamLinkConnectRequest) { request = value; return link },
  } as never)
  const client = new FixedBindingTeamAgentLinkDelivery(ctx, { agent: target, binding }, {
    linkProvider: 'controlled-view', maxTaskOutputContinuations,
  })
  cleanups.push(async () => { await client.close(); await ctx.fiber.dispose() })
  client.start()
  await vi.waitFor(() => { expect(notify).toBeTypeOf('function') })
  return {
    ctx, target, session, inbox, client, cancel, agents, binding, envelope, accepted, view,
    flush, claim, acknowledge, settleTaskAttempt, inject, followup, steer,
    async emit(value: TeamEnvelope = envelope) {
      if (notify === undefined) throw new Error('view Link is not subscribed')
      await notify(value)
    },
    request: () => request,
    async preStep(messages: UserMessage[]): Promise<PreStepDecision> {
      return await ctx.waterfall('agent/pre-step', {
        agent: target, messages, turn: 1, step: 1, signal: new AbortController().signal,
      }, async () => ({ kind: 'enter', messages }))
    },
  }
}

describe('Team audit continuation regression', () => {
  it('control: duplicate original turn notification reaches existing exhaustion branch', async () => {
    const mounted = await harness('turn', undefined, undefined, 1)
    const assignment = createUserMessage({
      content: [{ type: 'text', text: 'Task assignment' }],
      source: {
        kind: 'team-task-assignment', teamId: mounted.binding.activation.teamId,
        channelId: 'channel-task', envelopeId: 'envelope-task', taskId: 'task-output-limit',
        attemptId: 'attempt-output-limit', assignedRevision: 1, runningRevision: 2,
        activationId: mounted.binding.activation.id,
      } as never,
    })
    mounted.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [assignment] })
    mounted.session.append('turn/start', { turn: 1 })
    mounted.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
    mounted.session.append('step/start', { turn: 1, step: 1 })
    const ended = mounted.session.append('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
    const state = {
      tasks: [{ id: 'task-output-limit', revision: 3, phase: 'running', lease: {
        attemptId: 'attempt-output-limit', participantId: mounted.binding.activation.participantId,
        activationId: mounted.binding.activation.id, expiresAt: Date.now() + 60_000,
      } }],
      activations: [mounted.binding],
    }
    mounted.ctx.provide('teams', { getTeam: vi.fn(async () => state) } as never)
    mounted.client.observeTurnEnd(ended)
    await vi.waitFor(() => { expect(mounted.followup).toHaveBeenCalledTimes(1) })
    mounted.client.observeTurnEnd(ended)
    await vi.waitFor(() => { expect(mounted.settleTaskAttempt).toHaveBeenCalledTimes(1) })
    expect(mounted.settleTaskAttempt).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-output-limit', attemptId: 'attempt-output-limit', expectedRevision: 3,
      outcome: expect.objectContaining({
        kind: 'failed', failure: expect.objectContaining({ code: 'TEAM_WORKER_OUTPUT_LIMIT' }),
      }),
    }))
  })

  it('settles output exhaustion after a distinct continuation turn claims its real inbox message', async () => {
    const mounted = await harness('turn', undefined, undefined, 1)
    const assignment = createUserMessage({
      content: [{ type: 'text', text: 'Task assignment' }],
      source: {
        kind: 'team-task-assignment', teamId: mounted.binding.activation.teamId,
        channelId: 'channel-task', envelopeId: 'envelope-task', taskId: 'task-output-limit',
        attemptId: 'attempt-output-limit', assignedRevision: 1, runningRevision: 2,
        activationId: mounted.binding.activation.id,
      } as never,
    })
    mounted.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [assignment] })
    mounted.session.append('turn/start', { turn: 1 })
    mounted.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
    mounted.session.append('step/start', { turn: 1, step: 1 })
    const ended = mounted.session.append('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
    const state = {
      tasks: [{ id: 'task-output-limit', revision: 3, phase: 'running', lease: {
        attemptId: 'attempt-output-limit', participantId: mounted.binding.activation.participantId,
        activationId: mounted.binding.activation.id, expiresAt: Date.now() + 60_000,
      } }],
      activations: [mounted.binding],
    }
    mounted.ctx.provide('teams', { getTeam: vi.fn(async () => state) } as never)
    mounted.client.observeTurnEnd(ended)
    await vi.waitFor(() => { expect(mounted.followup).toHaveBeenCalledTimes(1) })
    mounted.session.append('turn/start', { turn: 2 })
    mounted.inbox.claim('next-turn', 2)
    mounted.session.append('step/start', { turn: 2, step: 1 })
    const secondEnd = mounted.session.append('turn/end', { turn: 2, reason: { kind: 'max-tokens' } })
    mounted.client.observeTurnEnd(secondEnd)
    await vi.waitFor(() => { expect(mounted.settleTaskAttempt).toHaveBeenCalledTimes(1) })
    expect(mounted.settleTaskAttempt).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-output-limit', attemptId: 'attempt-output-limit', expectedRevision: 3,
      outcome: expect.objectContaining({
        kind: 'failed', failure: expect.objectContaining({ code: 'TEAM_WORKER_OUTPUT_LIMIT' }),
      }),
    }))
  })

})
