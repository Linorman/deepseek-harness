import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import { activationIdSchema, teamTaskCreateIdempotencyKeySchema } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ParticipantSnapshot,
  TeamEnvelope,
  TeamSystemActivationProof,
  TeamSystemActivationScope,
  TeamSystemTaskControlProof,
  TeamSystemTaskControlScope,
} from '@clocky/clocky-team'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import * as TeamChannelDirect from '@clocky/clocky-team-channel-direct'
import { runTeamLinkDeliveryContract } from '../../../core/team-link/tests/delivery-contract.ts'
import * as TeamLinkLocal from '../src/index.ts'
import type { TeamLinkTaskCancellationNotification } from '@clocky/clocky-team-link'
import { assignTestTask, bindTestActivation, provisionTestCoordinator } from '../../team-hub/tests/fixtures.ts'

const contexts = new Set<Context>()
const roots: string[] = []
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'
type ControllerActivationBindScope = Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-bind' }>
const activationProofStores = new WeakMap<Context, WeakMap<TeamSystemActivationProof, ControllerActivationBindScope>>()

afterEach(async () => {
  const failures: unknown[] = []
  for (const ctx of [...contexts]) {
    try {
      await ctx.fiber.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  contexts.clear()
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Team Link local composition cleanup failed')
})

/** Compose the real local Hub, direct channel adapter, Link registry, and local provider. */
async function setup(): Promise<Context> {
  const root = await freshRoot()
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(TeamLinkRegistry)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(TeamChannelDirect)
  await ctx.plugin(TeamLinkLocal, {
    providerName: 'local', pageSize: 1, disposalTimeoutMs: 100, notificationRetryDelayMs: 1,
  })
  return ctx
}

/** Allocate a project-local durable root for one real Hub composition. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-link-local-'))
  roots.push(root)
  return root
}

/** Invite one participant and move it through the durable active membership lifecycle. */
async function activeParticipant(ctx: Context, teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'], name: string): Promise<ParticipantSnapshot> {
  let state = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName: name,
    role: 'worker',
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
}

/** Create one Team with a sender/recipient direct channel. */
async function directChannel(ctx: Context) {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Deliver local Link replay.', budgets: {} }, rules: {}, budgets: {} })
  const sender = await activeParticipant(ctx, created.team.id, 'Sender')
  const recipient = await activeParticipant(ctx, created.team.id, 'Recipient')
  const state = await ctx.teams.getTeam({ teamId: created.team.id })
  const channel = await openTestChannel(ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    adapter: { type: 'direct', version: 1 },
    participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
    limits: {},
  })
  const senderBinding = await bindParticipant(
    ctx,
    created.team.id,
    sender.id,
    'activation-team-link-local-sender',
    'session-team-link-local-sender',
  )
  return {
    teamId: created.team.id,
    sender,
    senderBinding,
    recipient,
    channel,
  }
}

/** Persist one test-owned activation binding through a single-call controller proof. */
async function bindActivation(
  ctx: Context,
  input: { readonly expectedCursor: number; readonly binding: ActivationBindingSnapshot },
): Promise<ActivationBindingSnapshot> {
  let proofs = activationProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemActivationProof, ControllerActivationBindScope>()
    proofs = sourceProofs
    activationProofStores.set(ctx, sourceProofs)
    ctx.teams.registerSystemActivationProofSource({
      name: TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE,
      resolveActivationProof: proof => sourceProofs.get(proof),
    })
  }
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test activation controller proofs are runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemActivationProof
  proofs.set(actor, { kind: 'activation-controller-bind', ...input })
  try {
    return await ctx.teams.bindActivation({ actor, ...input })
  } finally {
    proofs.delete(actor)
  }
}

/** Persist one active participant binding that an activation proof issuer can verify. */
async function bindParticipant(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participantId: ParticipantSnapshot['id'],
  activationId: string,
  sessionId: string,
): Promise<ActivationBindingSnapshot> {
  const state = await ctx.teams.getTeam({ teamId })
  return await bindActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(activationId),
        teamId,
        participantId,
        status: 'idle',
      },
      sessionId: sessionId as ActivationBindingSnapshot['sessionId'],
      provider: 'in-process',
    },
  })
}

/** Persist the recipient activation binding that the local Link provider verifies. */
async function bindRecipient(ctx: Context, input: Awaited<ReturnType<typeof directChannel>>): Promise<ActivationBindingSnapshot> {
  const binding = await bindParticipant(
    ctx,
    input.teamId,
    input.recipient.id,
    'activation-team-link-local',
    'session-team-link-local',
  )
  await acknowledgeTestChannelActivations(ctx, input.channel.manifest.id)
  return binding
}

/** Post one direct recipient-visible Envelope through the real Team Hub. */
async function post(ctx: Context, input: Awaited<ReturnType<typeof directChannel>>, text: string): Promise<TeamEnvelope> {
  const current = await ctx.teams.getChannel({ channelId: input.channel.manifest.id })
  return await ctx.teams.postChannelEnvelope({
    actor: ctx.teams.openActivationActorProofIssuer().issue(input.senderBinding).proof,
    expectedCursor: current.cursor,
    draft: {
      channelId: current.manifest.id,
      audience: [input.recipient.id],
      kind: 'message',
      payload: { text },
      delivery: 'turn',
    },
  })
}

describe('local Team Link composition', () => {
  it('replays bounded real pending-delivery pages and follows later local channel WAL changes', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx)
    const binding = await bindRecipient(ctx, input)
    const first = await post(ctx, input, 'first pending')
    const second = await post(ctx, input, 'second pending')

    const link = await ctx.teamLinks.connect({ provider: 'local', binding })
    const observed: TeamEnvelope[] = []
    link.onNotify(async (envelope) => { observed.push(envelope) })
    await vi.waitFor(() => { expect(observed.map(envelope => envelope.id)).toEqual([first.id, second.id]) })

    const claim = await link.claim(input.channel.manifest.id, first.id)
    expect(claim).toMatchObject({ envelopeId: first.id, binding, delivery: 'turn' })
    if (claim === undefined) throw new Error('local Link did not retain a current pending delivery')
    await link.acknowledge(input.channel.manifest.id, first.id, claim.channel.cursor)

    const third = await post(ctx, input, 'third pending')
    await vi.waitFor(() => { expect(observed.map(envelope => envelope.id)).toContain(third.id) })
    await link.close()
  })

  it('ignores a Team channel whose immutable manifest excludes its bound recipient', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx)
    const binding = await bindRecipient(ctx, input)
    const other = await activeParticipant(ctx, input.teamId, 'Other recipient')
    const state = await ctx.teams.getTeam({ teamId: input.teamId })
    await openTestChannel(ctx, {
      teamId: input.teamId,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: input.sender.id, role: 'sender' }, { id: other.id, role: 'recipient' }],
      limits: {},
    })

    const link = await ctx.teamLinks.connect({ provider: 'local', binding })
    const observed: TeamEnvelope[] = []
    link.onNotify(async (envelope) => { observed.push(envelope) })
    const envelope = await post(ctx, input, 'bound recipient still receives delivery')

    await vi.waitFor(() => { expect(observed.map(item => item.id)).toEqual([envelope.id]) })
    await expect(link.claim(input.channel.manifest.id, envelope.id)).resolves.toMatchObject({ envelopeId: envelope.id })
    await link.close()
  })
})

runTeamLinkDeliveryContract('local', async () => {
  const ctx = await setup()
  const input = await directChannel(ctx)
  const binding = await bindRecipient(ctx, input)
  return {
    binding,
    post: async () => await post(ctx, input, 'delivery contract replay'),
    connect: async () => await ctx.teamLinks.connect({ provider: 'local', binding }),
    reconnect: async () => await ctx.teamLinks.connect({ provider: 'local', binding }),
    pendingEnvelopeIds: async () => {
      const pending = await ctx.teams.listChannelPendingDeliveries({
        channelId: input.channel.manifest.id,
        participantId: input.recipient.id,
        afterCursor: -1,
        limit: 8,
      })
      return pending.deliveries.map(delivery => delivery.envelope.id)
    },
  }
})


it('replays an exact durable task stop after reconnect and rejects an older attempt acknowledgement', async () => {
  const ctx = await setup()
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Reconnect a cancelled task', budgets: {} }, rules: {}, budgets: {} })
  const actor = await provisionTestCoordinator(ctx, created.team.id)
  const owner = await activeParticipant(ctx, created.team.id, 'Cancellation worker')
  let state = await ctx.teams.getTeam({ teamId: created.team.id })
  const binding = await bindTestActivation(ctx, { expectedCursor: state.team.cursor, binding: {
    activation: { id: activationIdSchema.parse('task-cancellation-owner'), teamId: created.team.id, participantId: owner.id, status: 'idle' },
    sessionId: 'task-cancellation-session' as ActivationBindingSnapshot['sessionId'], provider: 'in-process',
  } })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  let task = await ctx.teams.createTask({ actor, teamId: created.team.id, expectedCursor: state.team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('reconnected-cancel') },
    subject: 'Cancel attempt two', description: 'Keep the first immutable attempt.', blockedBy: [], requiredCapabilities: [],
    priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 3 })
  const assign = async () => await assignTestTask(ctx, { teamId: task.teamId, taskId: task.id, expectedRevision: task.revision,
    participantId: owner.id, activationId: binding.activation.id, leaseDurationMs: 60_000 })
  task = await assign()
  const firstAttempt = task.lease!.attemptId
  const ownerProof = ctx.teams.openActivationActorProofIssuer().issue(binding)
  task = await ctx.teams.settleTaskAttempt({ actor: ownerProof.proof, taskId: task.id, attemptId: firstAttempt,
    expectedRevision: task.revision, outcome: { kind: 'released' } })
  const history = task.attemptHistory
  task = await assign()
  const secondAttempt = task.lease!.attemptId
  const coordinator = state.activations.find(candidate => state.participants.find(participant => participant.id === candidate.activation.participantId)?.role === 'coordinator')!
  const scope: TeamSystemTaskControlScope = { kind: 'team-run-default-worker-cancel', teamId: task.teamId, taskId: task.id,
    expectedRevision: task.revision, coordinator: { teamId: task.teamId, participantId: coordinator.activation.participantId,
      activationId: coordinator.activation.id, sessionId: coordinator.sessionId, provider: coordinator.provider } }
  const proof = Object.freeze({}) as TeamSystemTaskControlProof
  const dispose = ctx.teams.registerSystemTaskControlProofSource({ name: 'team-run', resolveTaskControlProof: candidate => candidate === proof ? scope : undefined })
  const firstLink = await ctx.teamLinks.connect({ provider: 'local', binding })
  const observed = Promise.withResolvers<TeamLinkTaskCancellationNotification>()
  const unsubscribe = firstLink.onTaskCancellation(async (notification) => { observed.resolve(notification) })
  task = await ctx.teams.cancelTask({ actor: proof, teamId: task.teamId, taskId: task.id, expectedRevision: task.revision })
  const firstNotice = await observed.promise
  expect(firstNotice.cancellation.target).toMatchObject({ attemptId: secondAttempt, activationId: binding.activation.id })
  unsubscribe()
  await firstLink.close()
  const resumed = await ctx.teamLinks.connect({ provider: 'local', binding })
  const replayed = Promise.withResolvers<TeamLinkTaskCancellationNotification>()
  const stop = resumed.onTaskCancellation(async (notification) => { replayed.resolve(notification) })
  expect(await replayed.promise).toEqual(firstNotice)
  await expect(resumed.acknowledgeTaskCancellation({ taskId: task.id, attemptId: firstAttempt, expectedRevision: task.revision }))
    .rejects.toMatchObject({ code: 'TEAM_LINK_LOCAL_BINDING_MISMATCH' })
  expect((await ctx.teams.getTask({ teamId: task.teamId, taskId: task.id })).lease?.attemptId).toBe(secondAttempt)
  const terminal = await resumed.acknowledgeTaskCancellation({ taskId: task.id, attemptId: secondAttempt, expectedRevision: task.revision })
  expect(terminal.phase).toBe('cancelled')
  expect(terminal.attemptHistory.slice(0, 1)).toEqual(history)
  expect(terminal.attemptHistory.at(-1)).toMatchObject({ id: secondAttempt, outcome: { kind: 'cancelled' } })
  expect((await ctx.teams.getTeam({ teamId: task.teamId })).team.phase).toBe('active')
  stop()
  await resumed.close()
  dispose()
  ownerProof.revoke()
})
