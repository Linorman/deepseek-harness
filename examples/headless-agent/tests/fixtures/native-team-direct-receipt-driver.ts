#!/usr/bin/env node
/** Snapshot-only Loader driver for one native direct Team delivery and receipt. */

import { directChannelAdapter } from '@clocky/clocky-team-channel-direct'
import { channelInvitationIdempotencyKeySchema } from '@clocky/clocky-team'
import type { Context } from '@clocky/cordis'
import { openTestChannel } from '../../../../packages/core/team/tests/channel-lifecycle-authority.ts'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@clocky/clocky-app-boot'
import { fingerprintChannelSummarySources, activationIdSchema, channelPostIdempotencyKeySchema, channelSummaryIdempotencyKeySchema } from '@clocky/clocky-team'
import type {
  ActivationBindInput,
  ChannelSummarizeRequest,
  ChannelId,
  ChannelRecord,
  ParticipantSnapshot,
  TeamId,
  TeamRootCreateInput,
  TeamSystemActivationProof,
  TeamSystemActivationProofSource,
  TeamSystemActivationScope,
  TeamSystemRootCreationProof,
  TeamSystemRootCreationProofSource,
  TeamSystemRootCreationScope,
  TeamSystemChannelSummaryProof,
  TeamSystemChannelSummaryProofSource,
  TeamSystemChannelSummaryScope,
  SchedulerChannelDeliveryExpireInput,
  TeamSystemSchedulerChannelProof,
  TeamSystemSchedulerChannelProofSource,
  TeamSystemSchedulerChannelScope,
  TeamSystemTopologyProof,
  TeamSystemTopologyProofSource,
  TeamSystemTopologyScope,
} from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-link'
import { SessionId } from '@clocky/clocky-session'

const NAME = 'native-team-direct-receipt-driver'
const activationProofs = new WeakMap<Context, Map<TeamSystemActivationProof, TeamSystemActivationScope>>()
const rootCreationProofs = new WeakMap<Context, Map<TeamSystemRootCreationProof, TeamSystemRootCreationScope>>()
const topologyProofs = new WeakMap<Context, Map<TeamSystemTopologyProof, TeamSystemTopologyScope>>()
const channelSummaryProofs = new WeakMap<Context, Map<TeamSystemChannelSummaryProof, TeamSystemChannelSummaryScope>>()
const schedulerChannelProofs = new WeakMap<Context, Map<TeamSystemSchedulerChannelProof, TeamSystemSchedulerChannelScope>>()
const [configPath, ...extraArgs] = process.argv.slice(2)
if (configPath === undefined || extraArgs.length > 0) {
  throw new Error(`${NAME}: expected <config-path>`)
}

/** Invite one local participant and commit its active membership state. */
async function activeParticipant(
  ctx: Context,
  teamId: TeamId,
  displayName: string,
  role: string,
): Promise<ParticipantSnapshot> {
  let state = await ctx.teams.getTeam({ teamId })
  const invitation = {
    teamId,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName,
    role,
    capabilities: [],
  } as const
  const invited = await withTopologyProof(ctx, {
    kind: 'team-run-bootstrap-participant-invite',
    teamId,
    expectedCursor: invitation.expectedCursor,
    participant: {
      kind: invitation.kind,
      displayName: invitation.displayName,
      role: invitation.role,
      capabilities: invitation.capabilities,
    },
  }, async actor => await ctx.teams.inviteParticipant({ actor, ...invitation }))
  state = await ctx.teams.getTeam({ teamId })
  const provisioning = {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  } as const
  await withTopologyProof(ctx, {
    kind: 'team-run-bootstrap-participant-phase',
    teamId,
    participantId: invited.id,
    expectedCursor: provisioning.expectedCursor,
    expectedPhase: 'invited',
    phase: provisioning.phase,
  }, async actor => await ctx.teams.transitionParticipantPhase({ actor, ...provisioning }))
  state = await ctx.teams.getTeam({ teamId })
  const active = {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  } as const
  return await withTopologyProof(ctx, {
    kind: 'team-run-bootstrap-participant-phase',
    teamId,
    participantId: invited.id,
    expectedCursor: active.expectedCursor,
    expectedPhase: 'provisioning',
    phase: active.phase,
  }, async actor => await ctx.teams.transitionParticipantPhase({ actor, ...active }))
}

/** Retain one exact bootstrap topology proof only for the snapshot driver's next membership mutation. */
async function withTopologyProof<T>(
  ctx: Context,
  scope: TeamSystemTopologyScope,
  operation: (actor: TeamSystemTopologyProof) => Promise<T>,
): Promise<T> {
  const proofs = topologyProofsFor(ctx)
  const proof = createTopologyProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    proofs.delete(proof)
  }
}

/** Retain one exact root-creation proof only for the snapshot driver's next Team admission. */
async function createRootTeam(ctx: Context, input: TeamRootCreateInput) {
  const scope: TeamSystemRootCreationScope = { kind: 'team-run-root-create', ...input }
  const proofs = rootCreationProofsFor(ctx)
  const proof = createRootCreationProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await ctx.teams.createTeam({ actor: proof, ...input })
  } finally {
    proofs.delete(proof)
  }
}

/** Register the canonical TeamRun root-creation source only inside this bare snapshot driver Context. */
function rootCreationProofsFor(ctx: Context): Map<TeamSystemRootCreationProof, TeamSystemRootCreationScope> {
  const existing = rootCreationProofs.get(ctx)
  if (existing !== undefined) return existing
  const proofs = new Map<TeamSystemRootCreationProof, TeamSystemRootCreationScope>()
  const source: TeamSystemRootCreationProofSource = {
    name: 'team-run',
    resolveRootCreationProof: proof => proofs.get(proof),
  }
  ctx.teams.registerSystemRootCreationProofSource(source)
  rootCreationProofs.set(ctx, proofs)
  return proofs
}

/** Create one fixture-only root-creation proof that cannot cross a durable or wire boundary. */
function createRootCreationProof(): TeamSystemRootCreationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Native Team snapshot root-creation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemRootCreationProof
}

/** Register the canonical TeamRun topology source only inside this bare snapshot driver Context. */
function topologyProofsFor(ctx: Context): Map<TeamSystemTopologyProof, TeamSystemTopologyScope> {
  const existing = topologyProofs.get(ctx)
  if (existing !== undefined) return existing
  const proofs = new Map<TeamSystemTopologyProof, TeamSystemTopologyScope>()
  const source: TeamSystemTopologyProofSource = {
    name: 'team-run',
    resolveTopologyProof: proof => proofs.get(proof),
  }
  ctx.teams.registerSystemTopologyProofSource(source)
  topologyProofs.set(ctx, proofs)
  return proofs
}

/** Create one fixture-only proof that cannot cross a durable or wire boundary. */
function createTopologyProof(): TeamSystemTopologyProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Native Team snapshot topology proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemTopologyProof
}

/** Retain one exact summary proof only for the snapshot driver's next summary append. */
async function summarizeChannel(ctx: Context, input: Omit<ChannelSummarizeRequest, 'actor'>): Promise<void> {
  const { requester, ...payload } = input
  const scope: TeamSystemChannelSummaryScope = { kind: 'channel-summary', ...payload }
  const proofs = channelSummaryProofsFor(ctx)
  const proof = createChannelSummaryProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    await ctx.teams.summarizeChannel({ actor: proof, requester, ...payload })
  } finally {
    proofs.delete(proof)
  }
}

/** Register the canonical summary source only inside this bare snapshot driver Context. */
function channelSummaryProofsFor(ctx: Context): Map<TeamSystemChannelSummaryProof, TeamSystemChannelSummaryScope> {
  const existing = channelSummaryProofs.get(ctx)
  if (existing !== undefined) return existing
  const proofs = new Map<TeamSystemChannelSummaryProof, TeamSystemChannelSummaryScope>()
  const source: TeamSystemChannelSummaryProofSource = {
    name: 'team-channel-summary',
    resolveChannelSummaryProof: proof => proofs.get(proof),
  }
  ctx.teams.registerSystemChannelSummaryProofSource(source)
  channelSummaryProofs.set(ctx, proofs)
  return proofs
}

/** Create one fixture-only proof that cannot cross a durable or wire boundary. */
function createChannelSummaryProof(): TeamSystemChannelSummaryProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Native Team snapshot channel-summary proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemChannelSummaryProof
}

/** Expire one exact snapshot delivery batch through the canonical scheduler channel source. */
async function expireSchedulerDeliveries(
  ctx: Context,
  input: SchedulerChannelDeliveryExpireInput,
): Promise<void> {
  const scope: TeamSystemSchedulerChannelScope = {
    kind: 'scheduler-channel-delivery-expire',
    ...input,
  }
  const proofs = schedulerChannelProofsFor(ctx)
  const proof = createSchedulerChannelProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    await ctx.teams.expireSchedulerChannelDeliveries({ actor: proof, ...input })
  } finally {
    proofs.delete(proof)
  }
}

/** Register the canonical scheduler channel proof source only inside this snapshot driver Context. */
function schedulerChannelProofsFor(
  ctx: Context,
): Map<TeamSystemSchedulerChannelProof, TeamSystemSchedulerChannelScope> {
  const existing = schedulerChannelProofs.get(ctx)
  if (existing !== undefined) return existing
  const proofs = new Map<TeamSystemSchedulerChannelProof, TeamSystemSchedulerChannelScope>()
  const source: TeamSystemSchedulerChannelProofSource = {
    name: 'team-scheduler-dag',
    resolveSchedulerChannelProof: proof => proofs.get(proof),
  }
  ctx.teams.registerSystemSchedulerChannelProofSource(source)
  schedulerChannelProofs.set(ctx, proofs)
  return proofs
}

/** Create one fixture-only scheduler proof that cannot cross a durable or wire boundary. */
function createSchedulerChannelProof(): TeamSystemSchedulerChannelProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Native Team snapshot scheduler channel proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemSchedulerChannelProof
}

/** Persist one idle local activation that a local Link may authenticate. */
async function bindActivation(
  ctx: Context,
  teamId: TeamId,
  participant: ParticipantSnapshot,
  activation: string,
  session: string,
) {
  const state = await ctx.teams.getTeam({ teamId })
  const input = {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(activation),
        teamId,
        participantId: participant.id,
        status: 'idle',
      },
      sessionId: SessionId(session),
      provider: 'in-process',
    },
  } satisfies ActivationBindInput
  return await withActivationProof(ctx, {
    kind: 'activation-controller-bind',
    expectedCursor: input.expectedCursor,
    binding: input.binding,
  }, async actor => await ctx.teams.bindActivation({ actor, ...input }))
}

/** Retain one exact controller-shaped proof only for the fixture's binding append. */
async function withActivationProof<T>(
  ctx: Context,
  scope: TeamSystemActivationScope,
  operation: (actor: TeamSystemActivationProof) => Promise<T>,
): Promise<T> {
  const proofs = activationProofsFor(ctx)
  const proof = createActivationProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    proofs.delete(proof)
  }
}

/** Register the canonical controller source only inside this snapshot driver Context. */
function activationProofsFor(ctx: Context): Map<TeamSystemActivationProof, TeamSystemActivationScope> {
  const existing = activationProofs.get(ctx)
  if (existing !== undefined) return existing
  const proofs = new Map<TeamSystemActivationProof, TeamSystemActivationScope>()
  const source: TeamSystemActivationProofSource = {
    name: 'team-activation-controller',
    resolveActivationProof: proof => proofs.get(proof),
  }
  ctx.teams.registerSystemActivationProofSource(source)
  activationProofs.set(ctx, proofs)
  return proofs
}

/** Create a fixture-only proof that cannot cross a durable or wire boundary. */
function createActivationProof(): TeamSystemActivationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Native Team snapshot activation proof is runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemActivationProof
}

/** Render one channel WAL record without volatile Team, channel, or Envelope ids. */
function projectRecord(
  record: ChannelRecord,
  names: ReadonlyMap<string, string>,
  teamId: TeamId,
  channelId: ChannelId,
  envelopeId: string,
): Record<string, unknown> {
  switch (record.type) {
    case 'channel/opened':
      return {
        type: record.type,
        sequence: record.sequence,
        adapter: `${record.manifest.adapter.type}@${record.manifest.adapter.version}`,
        participants: record.manifest.participants.map(participant => names.get(participant.id) ?? participant.id),
      }
    case 'channel/invitation':
    case 'channel/acknowledged':
    case 'channel/invitation-ended':
      return { type: record.type, sequence: record.sequence,
        participant: names.get(record.invitation.participantId) ?? record.invitation.participantId,
        required: record.invitation.required, revision: record.invitation.revision, status: record.invitation.status }
    case 'channel/phase':
      return { type: record.type, sequence: record.sequence, phase: record.phase }
    case 'channel/envelope':
      return {
        type: record.type,
        sequence: record.envelope.sequence,
        sender: names.get(record.envelope.senderId) ?? record.envelope.senderId,
        audience: record.envelope.audience?.map(participant => names.get(participant) ?? participant) ?? 'broadcast',
        delivery: record.envelope.delivery,
        kind: record.envelope.kind,
        text: record.envelope.payload['text'],
        teamMatchesChannel: record.envelope.teamId === teamId,
        channelMatchesWal: record.envelope.channelId === channelId,
      }
    case 'channel/receipt':
      return {
        type: record.type,
        sequence: record.sequence,
        recipient: names.get(record.participantId) ?? record.participantId,
        envelopeMatchesDelivery: record.envelopeId === envelopeId,
        acknowledgedEnvelopeSequence: record.cursor,
      }
    case 'channel/delivery-expired':
      return {
        type: record.type,
        sequence: record.sequence,
        recipient: names.get(record.participantId) ?? record.participantId,
        envelopeMatchesDelivery: record.envelopeId === envelopeId,
        expiredEnvelopeSequence: record.envelopeSequence,
      }
    case 'channel/summary':
      return {
        type: record.type,
        sequence: record.sequence,
        sourceEnvelopeCount: record.sourceEnvelopeIds.length,
        coveredSequenceRange: record.coveredSequenceRange,
      }
    case 'channel/adapter':
      return { type: record.type, sequence: record.sequence }
    case 'channel/closed':
      return { type: record.type, sequence: record.sequence, phase: record.phase }
  }
}

/** Run the direct-channel vertical slice through only Loader-mounted native Team services. */
async function runScenario(ctx: Context): Promise<Record<string, unknown>> {
  const created = await createRootTeam(ctx, {
    goal: { objective: 'Prove a native direct delivery receives one durable receipt.', budgets: {} },
    rules: {},
    budgets: {},
  })
  const coordinator = await activeParticipant(ctx, created.team.id, 'coordinator', 'coordinator')
  const worker = await activeParticipant(ctx, created.team.id, 'worker', 'worker')
  let state = await ctx.teams.getTeam({ teamId: created.team.id })
  let channel = await openTestChannel(ctx, {
    teamId: created.team.id,
    expectedCursor: state.team.cursor,
    adapter: { type: 'direct', version: 1 },
    viewPolicy: { type: 'summarized-window', version: 1 },
    participants: [
      { id: coordinator.id, role: 'sender' },
      { id: worker.id, role: 'recipient' },
    ],
    limits: {},
  })
  const coordinatorBinding = await bindActivation(
    ctx,
    created.team.id,
    coordinator,
    'activation-native-team-coordinator',
    'session-native-team-coordinator',
  )
  const workerBinding = await bindActivation(
    ctx,
    created.team.id,
    worker,
    'activation-native-team-worker',
    'session-native-team-worker',
  )
  const coordinatorLink = await ctx.teamLinks.connect({ provider: 'local', binding: coordinatorBinding })
  const workerLink = await ctx.teamLinks.connect({ provider: 'local', binding: workerBinding })

  try {
    directChannelAdapter.validateCreate(channel.manifest)
    for (const link of [coordinatorLink, workerLink]) {
      const admission = await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
      const invitation = admission.invitations.find(value => value.participantId === link.binding.activation.participantId)
      if (invitation === undefined) throw new Error('Native endpoint has no invitation')
      await link.acknowledgeChannelInvitation({ channelId: channel.manifest.id, revision: invitation.revision,
        manifestFingerprint: invitation.manifestFingerprint,
        idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`native-endpoint:${String(invitation.participantId)}`) })
    }
    channel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
    const envelope = await coordinatorLink.post({
      expectedCursor: channel.cursor,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('native-team-direct-receipt'),
      draft: {
        channelId: channel.manifest.id,
        audience: [worker.id],
        kind: 'message',
        payload: { text: 'Review the durable receipt.' },
        delivery: 'context',
      },
    })
    const claim = await workerLink.claim(channel.manifest.id, envelope.id)
    if (claim === undefined) throw new Error(`${NAME}: worker did not receive the pending direct delivery`)
    const receipt = await workerLink.acknowledge(channel.manifest.id, envelope.id, claim.channel.cursor)
    const afterReceiptChannel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
    const expiringEnvelope = await coordinatorLink.post({
      expectedCursor: afterReceiptChannel.cursor,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('native-team-direct-expiring'),
      draft: {
        channelId: channel.manifest.id,
        audience: [worker.id],
        kind: 'message',
        payload: { text: 'This delivery expires before acknowledgement.' },
        delivery: 'context',
        ttlMs: 1,
      },
    })
    const ttlMs = expiringEnvelope.ttlMs
    if (ttlMs === undefined) throw new Error(`${NAME}: expiring Envelope lost its TTL`)
    const expiryTeam = await ctx.teams.getTeam({ teamId: created.team.id })
    const expiryChannel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
    await expireSchedulerDeliveries(ctx, {
      teamId: created.team.id,
      channelId: channel.manifest.id,
      expectedTeamCursor: expiryTeam.team.cursor,
      expectedChannelCursor: expiryChannel.cursor,
      now: expiringEnvelope.createdAt + ttlMs,
      limit: 1,
    })
    await summarizeChannel(ctx, {
      requester: ctx.teams.openActivationActorProofIssuer().issue(coordinatorBinding).proof,
      sourceFingerprint: fingerprintChannelSummarySources([envelope, expiringEnvelope]),
      channelId: channel.manifest.id,
      expectedCursor: (await ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      coveredSequenceRange: { from: envelope.sequence, to: expiringEnvelope.sequence },
      sourceEnvelopeIds: [envelope.id, expiringEnvelope.id],
      text: 'The durable receipt is complete; the second delivery expired.',
      policy: { type: 'summarized-window', version: 1 },
      idempotencyKey: channelSummaryIdempotencyKeySchema.parse('native-team-direct-summary'),
    })
    const channelState = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
    const pending = await ctx.teams.listChannelPendingDeliveries({
      channelId: channel.manifest.id,
      participantId: worker.id,
      afterCursor: -1,
      limit: 1,
    })
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const discovery = await ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })
    const discovered = discovery.items.find(team => team.id === state.team.id)
    if (discovered?.cursor !== state.team.cursor || discovered.phase !== state.team.phase) {
      throw new Error('Discovery summary disagrees with the authoritative Team')
    }
    const names = new Map(state.participants.map(participant => [participant.id, participant.displayName]))

    const firstMembers = await ctx.teams.browse({ teamId: created.team.id, kind: 'members', limit: 1 })
    const nextMembers = await ctx.teams.browse({ teamId: created.team.id, kind: 'members', limit: 1,
      afterCursor: firstMembers.nextCursor })
    if (firstMembers.kind !== 'members' || nextMembers.kind !== 'members') throw new Error('Member browse kind changed')
    for (const member of [...firstMembers.items, ...nextMembers.items]) {
      if (member.role !== state.participants.find(value => value.id === member.id)?.role) {
        throw new Error('Member summary changed its protocol role')
      }
      if ('stats' in member || 'authorityGrant' in member) throw new Error('Member summary contains execution history or grants')
    }
    const memberSession = await ctx.teams.getMemberSession({ teamId: created.team.id, participantId: worker.id })
    const selected = await ctx.teams.getTeamSelection({ teamId: created.team.id })
    if (selected.coordinator.kind !== 'bound') throw new Error('Coordinator selection binding is unavailable')
    const metadata = await ctx.teams.getTeamSelection({ teamId: created.team.id, includeMetadata: true })
    if (metadata.metadata?.kind !== 'available' || metadata.metadata.goal.objective !== state.goal.objective
      || metadata.team.cursor !== selected.team.cursor) throw new Error('Bounded selection metadata disagrees with the durable goal')
    return {
      scenario: 'native-team-direct-receipt',
      browse: { total: firstMembers.total, first: firstMembers.items.map(member => member.displayName.text),
        next: nextMembers.items.map(member => member.displayName.text), firstScanned: firstMembers.scanned,
        sameCursor: firstMembers.teamCursor === state.team.cursor
          && nextMembers.teamCursor === state.team.cursor },
      memberSession: { sessionId: memberSession.sessionId, status: memberSession.activation.status,
        matchesWorker: memberSession.activation.participantId === worker.id,
        matchesTeam: memberSession.activation.teamId === created.team.id },
      selection: {
        objective: selected.goal.objective,
        phase: selected.team.phase,
        coordinator: selected.coordinator.name,
        sessionId: selected.coordinator.binding.sessionId,
        counts: selected.counts,
        sameCursor: selected.team.cursor === state.team.cursor,
      },
      team: {
        objective: state.goal.objective,
        phase: state.team.phase,
        participants: state.participants.map(participant => ({
          name: participant.displayName,
          role: participant.role,
          phase: participant.phase,
        })),
        activations: state.activations.map(binding => ({
          participant: names.get(binding.activation.participantId),
          provider: binding.provider,
          sessionId: binding.sessionId,
          status: binding.activation.status,
        })),
      },
      channel: {
        adapter: `${channelState.channel.manifest.adapter.type}@${channelState.channel.manifest.adapter.version}`,
        phase: channelState.channel.phase,
        records: channelState.records.map(record => projectRecord(
          record,
          names,
          created.team.id,
          channel.manifest.id,
          envelope.id,
        )),
        pendingDeliveriesForWorker: pending.deliveries.length,
      },
      delivery: {
        intent: claim.delivery,
        claimBindsWorkerActivation: claim.binding.activation.id === workerBinding.activation.id,
        receiptBindsWorker: receipt.participantId === worker.id,
        receiptMatchesEnvelope: receipt.envelopeId === envelope.id,
      },
    }
  } finally {
    await Promise.all([coordinatorLink.close(), workerLink.close()])
  }
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  process.stdout.write(`${JSON.stringify(await runScenario(ctx), null, 2)}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
