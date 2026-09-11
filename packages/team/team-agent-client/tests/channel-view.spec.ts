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
import { FixedBindingTeamAgentLinkDelivery } from '../src/index.ts'

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

/** Log one successful model step for a batch claimed through the real Inbox. */
function claimAndStep(mounted: Awaited<ReturnType<typeof harness>>, turn = 1): void {
  mounted.session.append('turn/start', { turn })
  mounted.inbox.claim('next-turn', turn)
  mounted.session.append('step/start', { turn, step: 1 })
  mounted.session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('Team channel-view delivery recovery', () => {
  it.each(['context', 'turn', 'steer'] as const)('persists and queues one %s view while duplicate notifications await receipt', async (delivery) => {
    const mounted = await harness(delivery)
    await mounted.emit()
    await mounted.emit()
    expect(mounted.session.events.filter(event => event.type === 'team/channel-view')).toHaveLength(1)
    expect([...mounted.inbox.nextStep, ...mounted.inbox.nextTurn]).toHaveLength(1)
    expect(mounted.acknowledge).toHaveBeenCalledTimes(2)
    expect(mounted.inject).toHaveBeenCalledTimes(delivery === 'context' ? 1 : 0)
    expect(mounted.followup).toHaveBeenCalledTimes(delivery === 'turn' ? 1 : 0)
    expect(mounted.steer).toHaveBeenCalledTimes(delivery === 'steer' ? 1 : 0)
  })

  it('does not queue a view again after its claimed batch reached a durable model step', async () => {
    const mounted = await harness()
    await mounted.emit()
    claimAndStep(mounted)
    await mounted.emit()
    expect(mounted.followup).toHaveBeenCalledTimes(1)
    expect(mounted.inbox.hasPending).toBe(false)
    expect(mounted.flush).toHaveBeenCalledTimes(2)
  })

  it('continues a running task after a worker turn reaches the output limit', async () => {
    const mounted = await harness()
    const assignment = createUserMessage({
      content: [{ type: 'text', text: 'Task assignment' }],
      source: {
        kind: 'team-task-assignment',
        teamId: mounted.binding.activation.teamId,
        channelId: 'channel-task',
        envelopeId: 'envelope-task',
        taskId: 'task-output-limit',
        attemptId: 'attempt-output-limit',
        assignedRevision: 1,
        runningRevision: 2,
        activationId: mounted.binding.activation.id,
      } as never,
    })
    mounted.session.append('agent/inbox/spliced', {
      target: 'next-turn', start: 0, inserted: [assignment],
    })
    mounted.session.append('turn/start', { turn: 1 })
    mounted.session.append('agent/inbox/spliced', {
      target: 'next-turn', start: 0, removedCount: 1, inserted: [],
    })
    mounted.session.append('step/start', { turn: 1, step: 1 })
    const ended = mounted.session.append('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
    const state = {
      tasks: [{
        id: 'task-output-limit', phase: 'running', lease: {
          attemptId: 'attempt-output-limit', participantId: mounted.binding.activation.participantId,
          activationId: mounted.binding.activation.id, expiresAt: Date.now() + 60_000,
        },
      }],
      activations: [mounted.binding],
    }
    mounted.ctx.provide('teams', { getTeam: vi.fn(async () => state) } as never)
    mounted.client.observeTurnEnd(ended)
    await vi.waitFor(() => { expect(mounted.followup).toHaveBeenCalledTimes(1) })
    expect(mounted.followup).toHaveBeenCalledWith(expect.objectContaining({
      source: { kind: 'plugin', plugin: 'team-agent-client' },
    }))
    expect(mounted.flush).toHaveBeenCalled()
  })

  it('settles a running task after its continuation budget is exhausted', async () => {
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

  it('keeps a claimed view out of a second inbox insertion before its model step begins', async () => {
    const mounted = await harness()
    await mounted.emit()
    mounted.session.append('turn/start', { turn: 1 })
    mounted.inbox.claim('next-turn', 1)
    const unrelated = mounted.ctx.sessions.create(SessionId('unrelated-view-session'))
    unrelated.append('turn/start', { turn: 1 })
    unrelated.append('step/start', { turn: 1, step: 1 })
    unrelated.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await mounted.emit()
    expect(mounted.followup).toHaveBeenCalledTimes(1)
    expect(mounted.inbox.hasPending).toBe(false)
    mounted.session.append('step/start', { turn: 1, step: 1 })
    mounted.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  })

  it('re-admits a claimed view whose turn ended before its first step', async () => {
    const mounted = await harness()
    await mounted.emit()
    mounted.session.append('turn/start', { turn: 1 })
    mounted.inbox.claim('next-turn', 1)
    mounted.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await mounted.emit()
    expect(mounted.followup).toHaveBeenCalledTimes(2)
    expect(mounted.inbox.nextTurn).toHaveLength(1)
  })

  it('reuses the stored view after a flush failure and does not acknowledge before the retry persists', async () => {
    const mounted = await harness()
    mounted.flush.mockRejectedValueOnce(new Error('Session flush failed'))
    await expect(mounted.emit()).rejects.toThrow('Session flush failed')
    expect(mounted.acknowledge).not.toHaveBeenCalled()
    await mounted.emit()
    expect(mounted.session.events.filter(event => event.type === 'team/channel-view')).toHaveLength(1)
    expect(mounted.followup).toHaveBeenCalledTimes(1)
    expect(mounted.acknowledge).toHaveBeenCalledTimes(1)
  })

  it('holds a claimed view at pre-step until its Session flush settles', async () => {
    const mounted = await harness()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<boolean>()
    mounted.flush.mockImplementationOnce(async () => { entered.resolve(undefined); return await release.promise })
    const delivering = mounted.emit()
    await entered.promise
    mounted.session.append('turn/start', { turn: 1 })
    const messages = mounted.inbox.claim('next-turn', 1)
    let admitted = false
    const step = mounted.preStep(messages).then((result) => { admitted = true; return result })
    await Promise.resolve()
    expect(admitted).toBe(false)
    release.resolve(true)
    await delivering
    await expect(step).resolves.toMatchObject({ kind: 'enter' })
    mounted.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  })

  it('rejects changed view content on redelivery before making another Session change', async () => {
    const mounted = await harness()
    await mounted.emit()
    const count = mounted.session.events.length
    mounted.claim.mockResolvedValueOnce({ ...mounted.accepted, view: { ...mounted.view, content: [{ type: 'text', text: 'Changed content.' }] } })
    await expect(mounted.emit()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(mounted.session.events).toHaveLength(count)
    expect(mounted.acknowledge).toHaveBeenCalledTimes(1)
  })

  it('re-admits a canceled queued view using its stored content', async () => {
    const mounted = await harness('context')
    await mounted.emit()
    mounted.inbox.clear()
    await mounted.emit()
    expect(mounted.inject).toHaveBeenCalledTimes(2)
    expect(mounted.inbox.nextStep).toHaveLength(1)
  })

  it('ignores unrelated model steps while recovering a discarded view', async () => {
    const mounted = await harness('steer')
    await mounted.emit()
    mounted.inbox.clear()
    mounted.session.append('turn/start', { turn: 1 })
    mounted.session.append('step/start', { turn: 1, step: 1 })
    mounted.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await mounted.emit()
    expect(mounted.steer).toHaveBeenCalledTimes(2)
  })

  it('rejects a discarded view that was already waiting at pre-step', async () => {
    const mounted = await harness()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<boolean>()
    mounted.flush.mockImplementationOnce(async () => { entered.resolve(undefined); return await release.promise })
    const delivering = mounted.emit()
    await entered.promise
    const messages = [...mounted.inbox.nextTurn]
    const step = mounted.preStep(messages)
    mounted.inbox.clear()
    await expect(step).resolves.toEqual({ kind: 'reject' })
    release.resolve(true)
    await delivering
  })

  it('rejects new steps and pending view barriers as soon as delivery closes', async () => {
    const mounted = await harness()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<boolean>()
    mounted.flush.mockImplementationOnce(async () => { entered.resolve(undefined); return await release.promise })
    const delivering = mounted.emit()
    await entered.promise
    const messages = [...mounted.inbox.nextTurn]
    const step = mounted.preStep(messages)
    const closing = mounted.client.close()
    await expect(step).resolves.toEqual({ kind: 'reject' })
    await expect(mounted.preStep(messages)).resolves.toEqual({ kind: 'reject' })
    release.resolve(true)
    await Promise.all([delivering, closing])
    expect(mounted.acknowledge).not.toHaveBeenCalled()
  })

  it.each<Partial<TeamChannelViewEventData>>([
    { sourceEnvelopeIds: [] },
    { sourceEnvelopeIds: ['envelope-view', 'envelope-view'] },
    { sourceEnvelopeIds: ['another-source'] },
    { content: [] },
    { teamId: 'another-team' },
    { channelId: 'another-channel' },
    { taskId: 'another-task' },
    { causationId: 'another-cause' },
    { triggeringEnvelopeId: 'another-envelope' },
    { adapter: { type: 'discussion', version: 1 } },
    { viewPolicy: { type: 'another-policy', version: 1 } },
    { review: { attemptId: 'review-attempt', reviewRevision: 1, reviewerId: 'recipient' } },
  ])('rejects a mismatched claimed view before Session admission: %j', async (changes) => {
    const mounted = await harness()
    mounted.claim.mockResolvedValueOnce({ ...mounted.accepted, view: { ...mounted.view, ...changes } })
    await expect(mounted.emit()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(mounted.session.events.filter(event => event.type === 'team/channel-view')).toEqual([])
    expect(mounted.acknowledge).not.toHaveBeenCalled()
  })

  it('rejects a review claim whose view omits the durable attempt fence', async () => {
    const mounted = await harness()
    const review = { attemptId: 'attempt-review', reviewRevision: 3, reviewerId: 'recipient', initiatorId: 'sender' }
    const envelope = { ...mounted.envelope, kind: 'review-request', payload: review }
    const claim = { ...mounted.accepted, view: { ...mounted.view, review: { ...review, reviewRevision: 2 } } }
    mounted.claim.mockResolvedValue(claim)
    await expect(mounted.emit(envelope)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(mounted.acknowledge).not.toHaveBeenCalled()
  })


  it('recovers a consumed view from a restored Session without starting another model turn', async () => {
    const original = await harness()
    await original.emit()
    claimAndStep(original)
    const restored = await harness('turn', original.session.events)
    await restored.emit()
    expect(restored.followup).not.toHaveBeenCalled()
    expect(restored.inbox.hasPending).toBe(false)
    expect(restored.acknowledge).toHaveBeenCalledTimes(1)
  })

  it('does not credit a fork seed model step as consumption by its current Agent', async () => {
    const original = await harness()
    await original.emit()
    claimAndStep(original)
    const seed = original.session.events
    const fork = await harness('turn', seed, seed.length)
    await fork.emit()
    expect(fork.followup).toHaveBeenCalledTimes(1)
    expect(fork.inbox.nextTurn).toHaveLength(1)
  })

  it('does not treat an inbox insertion during a running turn as a model claim', async () => {
    const mounted = await harness()
    mounted.session.append('turn/start', { turn: 1 })
    await mounted.emit()
    mounted.session.append('step/start', { turn: 1, step: 1 })
    mounted.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    mounted.inbox.clear()
    await mounted.emit()
    expect(mounted.followup).toHaveBeenCalledTimes(2)
  })

  it('ignores a broadcast view addressed to another channel participant', async () => {
    const mounted = await harness()
    await mounted.emit({ ...mounted.envelope, audience: ['another-recipient' as never] })
    expect(mounted.claim).not.toHaveBeenCalled()
    expect(mounted.followup).not.toHaveBeenCalled()
  })


  it('rejects a retired fixed Link before running a borrower operation', async () => {
    const mounted = await harness()
    await mounted.client.close()
    const operation = vi.fn(async () => undefined)
    await expect(mounted.client.withLink(operation)).rejects.toMatchObject({ code: 'TEAM_LINK_BOUND_LINK_UNAVAILABLE' })
    expect(operation).not.toHaveBeenCalled()
  })

  it('requires local Team authority before opting a remote fixed binding into workspace consumption', async () => {
    const mounted = await harness()
    await mounted.client.close()
    const local = new FixedBindingTeamAgentLinkDelivery(mounted.ctx, { agent: mounted.target, binding: mounted.binding },
      { consumeWorkspace: true })
    expect(() => { local.start() }).toThrow('requires local Team authority')
    await local.close()
  })

  it.each([1, 2, 3])('keeps direct v%s control Envelopes outside channel-view admission', async (version) => {
    const mounted = await harness()
    mounted.claim.mockResolvedValueOnce({ ...mounted.accepted, channel: { ...mounted.accepted.channel, manifest: {
      ...mounted.accepted.channel.manifest, adapter: { type: 'direct', version },
    } } })
    await mounted.emit({ ...mounted.envelope, kind: 'final' })
    expect(mounted.followup).not.toHaveBeenCalled()
    expect(mounted.acknowledge).not.toHaveBeenCalled()
  })


  it('delegates cooperative endpoint termination to the current runtime owner', async () => {
    const mounted = await harness()
    await mounted.client.close()
    const onTerminate = vi.fn(async () => {})
    const replacement = new FixedBindingTeamAgentLinkDelivery(mounted.ctx,
      { agent: mounted.target, binding: mounted.binding, onTerminate })
    try {
      replacement.start()
      await vi.waitFor(() => { expect(mounted.request()?.onTerminate).toBeTypeOf('function') })
      const reason = { code: 'TEAM_LINK_CREDENTIAL_REVOKED', message: 'Stop the exact runtime.' }
      await mounted.request()!.onTerminate!(reason)
      expect(onTerminate).toHaveBeenCalledWith(reason)
      expect(mounted.cancel).not.toHaveBeenCalled()
    } finally { await replacement.close() }
  })

  it('lets unrelated input proceed while rejecting a queued task whose allocation is absent', async () => {
    const mounted = await harness()
    const plain = createUserMessage({ content: [{ type: 'text', text: 'Unrelated input.' }], source: { kind: 'user' } })
    await expect(mounted.preStep([plain])).resolves.toMatchObject({ kind: 'enter' })
    const task = createUserMessage({ content: [{ type: 'text', text: 'Resume an assigned task.' }], source: {
      kind: 'team-task-assignment', teamId: mounted.envelope.teamId, channelId: mounted.envelope.channelId,
      envelopeId: mounted.envelope.id, taskId: 'retained-task' as never, attemptId: 'retained-attempt' as never,
      activationId: mounted.binding.activation.id, assignedRevision: 1, runningRevision: 2,
      workspaceAllocationId: 'retained-allocation' as never,
    } })
    mounted.target.inject(task)
    await expect(mounted.preStep([...mounted.inbox.nextStep])).resolves.toEqual({ kind: 'reject' })
  })


  it('does not admit a view claimed for a different participant binding', async () => {
    const mounted = await harness()
    mounted.claim.mockResolvedValueOnce({ ...mounted.accepted, binding: { ...mounted.binding, activation: {
      ...mounted.binding.activation, participantId: 'another-participant' as never,
    } } })
    await mounted.emit()
    expect(mounted.followup).not.toHaveBeenCalled()
    expect(mounted.acknowledge).not.toHaveBeenCalled()
  })


  it('accepts the same persisted view when transport serialization changes object-key order', async () => {
    const mounted = await harness()
    await mounted.emit()
    const { content, ...provenance } = mounted.view
    mounted.claim.mockResolvedValueOnce({ ...mounted.accepted, view: { content, ...provenance } })
    await mounted.emit()
    expect(mounted.followup).toHaveBeenCalledTimes(1)
    expect(mounted.acknowledge).toHaveBeenCalledTimes(2)
  })

})
