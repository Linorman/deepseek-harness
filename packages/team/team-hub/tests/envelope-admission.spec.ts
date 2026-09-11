import { admitTestFinal } from './final-admission-fixture.ts'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { closeTestChannel, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { activationIdSchema, channelInvitationIdempotencyKeySchema, channelPostIdempotencyKeySchema, fingerprintChannelManifest } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ChannelDeliveryClaimRequest,
  ChannelEnvelopeReceiptRequest,
  ChannelRecord,
  JsonValue,
  ParticipantSnapshot,
  SchedulerChannelDeliveryExpireInput,
  TeamActorProof,
  TeamChannelAdapter,
  TeamPolicyRequest,
  TeamSystemEnvelopePostProof,
  TeamSystemEnvelopePostScope,
  TeamSystemChannelAdmissionProof,
  TeamSystemChannelAdmissionScope,
  TeamSystemFinalReceiptProof,
  TeamSystemFinalReceiptScope,
  TeamSystemSchedulerChannelProof,
  TeamSystemSchedulerChannelProofSource,
  TeamSystemSchedulerChannelScope,
} from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import TeamHub from '../src/index.ts'
import type { Config as TeamHubConfig } from '../src/index.ts'
import type { TeamJournalRecord } from '../src/types.ts'
import { bindTestActivation, createTestCoordinatorTask, deleteTestCoordinatorTask, provisionTestCoordinator, seedTeamPhase, updateTestActivationStatus } from './fixtures.ts'

type Backend = 'json' | 'sqlite'

interface Harness {
  readonly ctx: Context
  readonly root: string
  dispose(): Promise<void>
}

const roots: string[] = []
const postBindings = new Map<string, ActivationBindingSnapshot>()
let postContext: Context | undefined
type FinalReceiptAuthority = {
  issue(scope: TeamSystemFinalReceiptScope): { readonly proof: TeamSystemFinalReceiptProof; revoke(): void }
}
type ChannelAdmissionAuthority = {
  issue(scope: Extract<TeamSystemChannelAdmissionScope, { readonly kind: 'channel-invitation-acknowledge' }>): TeamSystemChannelAdmissionProof
}
const finalReceiptAuthorities = new WeakMap<Context, Map<string, FinalReceiptAuthority>>()
const channelAdmissionAuthorities = new WeakMap<Context, ChannelAdmissionAuthority>()

const taskDefaults = {
  requiredCapabilities: [],
  priority: 0,
  readScopes: [],
  workspaceMode: 'shared' as const,
  budget: {},
  reviewPolicy: { kind: 'none' as const },
  maxAttempts: 3,
}

const LARGE_PENDING_DELIVERY_COUNT = 128

afterEach(async () => {
  postBindings.clear()
  postContext = undefined
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Compose the Hub over one real log provider with one exact adapter registration. */
async function setup(
  backend: Backend,
  adapter: TeamChannelAdapter,
  root?: string,
  config?: TeamHubConfig,
): Promise<Harness> {
  const durableRoot = root ?? await freshRoot()
  const ctx = new Context()
  postContext = ctx
  try {
    await ctx.plugin(Storage)
    if (backend === 'json') {
      await ctx.plugin(StorageJson, { root: durableRoot })
    } else {
      await ctx.plugin(StorageSqlite, { path: join(durableRoot, 'team-hub.db') })
    }
    await ctx.plugin(StorageLog, { backend, routes: {} })
    await ctx.plugin(TeamHub, config)
    ctx.teams.registerAdapter(adapter)
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
  return { ctx, root: durableRoot, async dispose() { await ctx.fiber.dispose() } }
}

/** Allocate test data beneath the project so cleanup remains scoped to the workspace. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-envelope-'))
  roots.push(root)
  return root
}

/** Build a pure adapter whose post-accept record proves atomic Envelope batching. */
function recordingAdapter(options: {
  readonly version?: number
  readonly rejectKind?: string
  readonly invalidAfterAccept?: boolean
  readonly nonArrayAfterAccept?: boolean
  readonly deriveDeliveries?: boolean
  readonly prepareFinal?: boolean
  readonly invalidFinal?: boolean
} = {}): TeamChannelAdapter {
  return {
    type: 'direct',
    version: options.version ?? 1,
    validateCreate() {},
    initialState() { return { accepted: 0 } },
    validateSend({ draft }) {
      if (draft.kind === options.rejectKind) throw new Error('adapter rejected draft')
    },
    ...options.prepareFinal === true ? {
      prepareFinal({ manifest, senderId, text }) {
        if (options.invalidFinal) return { audience: [], kind: '', payload: {}, delivery: 'turn' }
        const recipient = manifest.participants.find(participant => participant.id !== senderId)
        if (recipient === undefined) throw new Error('final sender has no peer')
        return { audience: [recipient.id], kind: 'final', payload: { text }, delivery: 'turn' as const }
      },
    } : {},
    fold(state, record) {
      if (record.type !== 'channel/envelope') return state
      return { accepted: acceptedCount(state) + 1 }
    },
    afterAccept({ state, record }) {
      if (options.nonArrayAfterAccept) return null as never
      if (options.invalidAfterAccept) return [{ payload: undefined } as never]
      return [{ payload: { acceptedEnvelopeId: record.envelope.id, count: acceptedCount(state) } }]
    },
    expectedNext() { return { kind: 'none' } },
    deliveryPlan({ envelope }) {
      if (!options.deriveDeliveries || envelope.audience === null) return []
      return envelope.audience.map(participantId => ({
        participantId,
        envelopeId: envelope.id,
        delivery: envelope.delivery,
      }))
    },
    projectView() { return {} },
  }
}

/** Read this test adapter's one documented fold-state field. */
function acceptedCount(state: JsonValue): number {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new Error('recording adapter state is malformed')
  }
  const count = (state as Record<string, JsonValue>).accepted
  if (typeof count !== 'number') throw new Error('recording adapter state is malformed')
  return count
}

/** Invite one participant and advance it to active membership. */
async function activeParticipant(
  ctx: Context,
  teamId: string,
  name: string,
  attributes: { readonly kind: 'human' | 'local-agent'; readonly role: string; readonly owner?: { readonly kind: 'system' } } = {
    kind: 'local-agent', role: 'worker',
  },
): Promise<ParticipantSnapshot> {
  let state = await ctx.teams.getTeam({ teamId: teamId as never })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    kind: attributes.kind,
    displayName: name,
    role: attributes.role,
    capabilities: [],
    ...attributes.owner === undefined ? {} : { owner: attributes.owner },
  })
  state = await ctx.teams.getTeam({ teamId: state.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: state.team.id,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId: state.team.id })
  const participant = await transitionBootstrapParticipant(ctx, {
    teamId: state.team.id,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
  if (attributes.kind !== 'human') {
    const binding = await bindRecipientActivation(ctx, participant.teamId, participant.id)
    postBindings.set(String(participant.id), binding)
  }
  return participant
}

/** Register one test-only TeamRun source for system-owned human invitation acknowledgement. */
function teamRunChannelAdmissionAuthority(
  ctx: Context,
): { issue(scope: Extract<TeamSystemChannelAdmissionScope, { readonly kind: 'channel-invitation-acknowledge' }>): TeamSystemChannelAdmissionProof } {
  const existing = channelAdmissionAuthorities.get(ctx)
  if (existing !== undefined) return existing
  const proofs = new WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>()
  ctx.teams.registerSystemChannelAdmissionProofSource({
    name: 'team-run',
    resolveChannelAdmissionProof: proof => proofs.get(proof),
  })
  const authority: ChannelAdmissionAuthority = {
    issue(scope) {
      const token: object = {}
      Object.defineProperty(token, 'toJSON', {
        enumerable: true,
        value: (): never => { throw new TypeError('Team-run channel admission proofs are runtime-only') },
      })
      const proof = Object.freeze(token) as TeamSystemChannelAdmissionProof
      proofs.set(proof, Object.freeze(structuredClone(scope)))
      return proof
    },
  }
  channelAdmissionAuthorities.set(ctx, authority)
  return authority
}

/** Seed an unavailable participant phase without fabricating a topology departure authority. */
async function seedParticipantPhase(
  ctx: Context,
  teamId: ParticipantSnapshot['teamId'],
  participantId: ParticipantSnapshot['id'],
  phase: 'left' | 'failed',
): Promise<void> {
  const hub = ctx.teams as unknown as {
    readonly teams: ReadonlyMap<ParticipantSnapshot['teamId'], {
      readonly queue: { run<T>(operation: () => Promise<T>): Promise<T> }
      readonly projection: {
        readonly team: { readonly updatedAt: number }
        readonly participants: ReadonlyMap<ParticipantSnapshot['id'], ParticipantSnapshot>
      }
    }>
    commitTeamCommand(
      loaded: unknown,
      records: readonly TeamJournalRecord[],
      code: 'TEAM_INVALID_ARGUMENT',
    ): Promise<void>
  }
  const loaded = hub.teams.get(teamId)
  if (loaded === undefined) throw new Error(`Team Hub did not retain participant fixture Team '${teamId}'`)
  await loaded.queue.run(async () => {
    const participant = loaded.projection.participants.get(participantId)
    if (participant === undefined) throw new Error(`Team '${teamId}' has no fixture participant '${participantId}'`)
    await hub.commitTeamCommand(loaded, [{
      type: 'participant/changed',
      participant: { ...participant, phase },
      createdAt: Math.max(Date.now(), loaded.projection.team.updatedAt + 1),
    }], 'TEAM_INVALID_ARGUMENT')
  })
}

/** Create one active Team with two active members and one direct channel. */
async function openedChannel(ctx: Context) {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Route one report', budgets: {} }, rules: {}, budgets: {} })
  const sender = await activeParticipant(ctx, created.team.id, 'Sender')
  const recipient = await activeParticipant(ctx, created.team.id, 'Recipient')
  const current = await ctx.teams.getTeam({ teamId: created.team.id })
  const channel = await openTestChannel(ctx, {
    teamId: current.team.id,
    expectedCursor: current.team.cursor,
    adapter: { type: 'direct', version: 1 },
    participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
    limits: {},
  })
  const issuer = ctx.teams.openActivationActorProofIssuer()
  const state = await ctx.teams.getTeam({ teamId: created.team.id })
  for (const invitation of (await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })).invitations) {
    const binding = state.activations.find(candidate => candidate.activation.participantId === invitation.participantId)
    if (binding === undefined) continue
    await ctx.teams.acknowledgeChannelInvitation({
      actor: issuer.issue(binding).proof,
      channelId: channel.manifest.id,
      revision: invitation.revision,
      manifestFingerprint: fingerprintChannelManifest(channel.manifest),
      idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`envelope-fixture:${String(invitation.participantId)}`),
    })
  }
  return { team: await ctx.teams.getTeam({ teamId: created.team.id }), sender, recipient,
    channel: await ctx.teams.getChannel({ channelId: channel.manifest.id }) }
}

/** Create the exact active human/coordinator topology whose final Team-run may receipt. */
async function openedSystemFinalChannel(ctx: Context) {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Return one final', budgets: {} }, rules: {}, budgets: {} })
  const human = await activeParticipant(ctx, created.team.id, 'Human', { kind: 'human', role: 'human', owner: { kind: 'system' } })
  const coordinator = await activeParticipant(ctx, created.team.id, 'Coordinator', {
    kind: 'local-agent', role: 'coordinator',
  })
  const current = await ctx.teams.getTeam({ teamId: created.team.id })
  const channel = await openTestChannel(ctx, {
    teamId: current.team.id,
    expectedCursor: current.team.cursor,
    adapter: { type: 'direct', version: 4 },
    participants: [{ id: human.id, role: 'human' }, { id: coordinator.id, role: 'coordinator' }],
    limits: {},
  })
  const admission = await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
  const activationIssuer = ctx.teams.openActivationActorProofIssuer()
  const systemIssuer = teamRunChannelAdmissionAuthority(ctx)
  const coordinatorBinding = postBindings.get(String(coordinator.id))
  if (coordinatorBinding === undefined) throw new Error('system final fixture omitted coordinator activation')
  for (const invitation of admission.invitations) {
    const idempotencyKey = channelInvitationIdempotencyKeySchema.parse(`system-final-consent:${String(invitation.participantId)}`)
    const actor = invitation.participantId === human.id
      ? systemIssuer.issue({ kind: 'channel-invitation-acknowledge', teamId: created.team.id,
        channelId: channel.manifest.id, participantId: human.id, revision: invitation.revision,
        manifestFingerprint: invitation.manifestFingerprint, idempotencyKey })
      : activationIssuer.issue(coordinatorBinding).proof
    await ctx.teams.acknowledgeChannelInvitation({ actor, channelId: channel.manifest.id,
      revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint,
      idempotencyKey })
  }
  return { team: await ctx.teams.getTeam({ teamId: created.team.id }), human, coordinator,
    channel: await ctx.teams.getChannel({ channelId: channel.manifest.id }) }
}

function postRequest(
  channelId: string,
  senderId: string,
  recipientId: string,
  expectedCursor: number,
  kind = 'report',
) {
  const binding = postBindings.get(senderId)
  if (binding === undefined || postContext === undefined) throw new Error(`no active post proof for '${senderId}'`)
  const actor = postContext.teams.openActivationActorProofIssuer().issue(binding).proof
  return {
    actor,
    expectedCursor,
    draft: {
      channelId: channelId as never,
      audience: [recipientId as never],
      kind,
      payload: { text: 'The review is complete.' },
      delivery: 'turn' as const,
    },
  }
}

/** Bind one active recipient to a Session selected by the delivery claimant. */
async function bindRecipientActivation(
  ctx: Context,
  teamId: string,
  participantId: string,
  status: 'idle' | 'running' = 'idle',
): Promise<ActivationBindingSnapshot> {
  const state = await ctx.teams.getTeam({ teamId: teamId as never })
  const existing = state.activations.find(candidate => candidate.activation.participantId === participantId as never)
  if (existing !== undefined) {
    if (existing.activation.status !== status) {
      await updateTestActivationStatus(ctx, {
        teamId: state.team.id,
        activationId: existing.activation.id,
        expectedCursor: state.team.cursor,
        status,
      })
      return await ctx.teams.getActivation({ teamId: state.team.id, activationId: existing.activation.id })
    }
    return existing
  }
  return await bindTestActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(`activation-delivery-${participantId}-${status}`),
        teamId: state.team.id,
        participantId: participantId as never,
        status,
      },
      sessionId: SessionId(`delivery-session-${participantId}-${status}`),
      provider: 'test-runtime',
    },
  })
}

/** Issue a current activation proof for one receipt recipient, creating its durable binding when needed. */
async function receiptActor(ctx: Context, teamId: string, participantId: string): Promise<TeamActorProof> {
  const current = await ctx.teams.getTeam({ teamId: teamId as never })
  const binding = current.activations.find(candidate => candidate.activation.participantId === participantId as never)
    ?? await bindRecipientActivation(ctx, teamId, participantId)
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}

/** Build a receipt request that contains no caller-selected recipient identity. */
async function activationReceiptRequest(
  ctx: Context,
  teamId: string,
  participantId: string,
  channelId: string,
  envelopeId: string,
  expectedCursor: number,
): Promise<ChannelEnvelopeReceiptRequest> {
  return {
    actor: await receiptActor(ctx, teamId, participantId),
    channelId: channelId as never,
    envelopeId: envelopeId as never,
    expectedCursor,
  }
}

/** Create one opaque Team-run-owned final-receipt proof. */
function teamRunFinalReceiptProof(): TeamSystemFinalReceiptProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team-run final-receipt proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamSystemFinalReceiptProof
}

/** Register one test-only source retaining independently revocable final-receipt proofs. */
function teamRunFinalReceiptAuthority(
  ctx: Context,
  sourceName = 'team-run',
): { issue(scope: TeamSystemFinalReceiptScope): { readonly proof: TeamSystemFinalReceiptProof; revoke(): void } } {
  const authorities = finalReceiptAuthorities.get(ctx) ?? new Map<string, FinalReceiptAuthority>()
  const existing = authorities.get(sourceName)
  if (existing !== undefined) return existing
  const proofs = new WeakMap<TeamSystemFinalReceiptProof, TeamSystemFinalReceiptScope>()
  ctx.teams.registerSystemFinalReceiptProofSource({
    name: sourceName,
    resolveFinalReceiptProof: candidate => proofs.get(candidate),
  })
  const authority: FinalReceiptAuthority = Object.freeze({
    issue(scope) {
      const proof = teamRunFinalReceiptProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: () => proofs.delete(proof) })
    },
  })
  authorities.set(sourceName, authority)
  finalReceiptAuthorities.set(ctx, authorities)
  return authority
}

/** Register one test-only TeamRun source retaining revocable human-input post proofs. */
function teamRunEnvelopePostAuthority(
  ctx: Context,
): { issue(scope: TeamSystemEnvelopePostScope): { readonly proof: TeamSystemEnvelopePostProof; revoke(): void } } {
  const proofs = new WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
  ctx.teams.registerSystemEnvelopePostProofSource({
    name: 'team-run',
    resolveEnvelopePostProof: candidate => proofs.get(candidate),
  })
  return Object.freeze({
    issue(scope) {
      const proof: object = {}
      Object.defineProperty(proof, 'toJSON', {
        enumerable: true,
        value: (): never => { throw new TypeError('Team-run Envelope-post proofs are runtime-only and cannot be serialized') },
      })
      const actor = Object.freeze(proof) as TeamSystemEnvelopePostProof
      proofs.set(actor, Object.freeze(structuredClone(scope)))
      return Object.freeze({ proof: actor, revoke: () => proofs.delete(actor) })
    },
  })
}

/** Expire one exact TTL batch through a temporary canonical scheduler proof source. */
async function expireSchedulerDeliveries(
  ctx: Context,
  input: SchedulerChannelDeliveryExpireInput,
) {
  const scope: TeamSystemSchedulerChannelScope = {
    kind: 'scheduler-channel-delivery-expire',
    ...input,
  }
  const proofs = new WeakMap<TeamSystemSchedulerChannelProof, TeamSystemSchedulerChannelScope>()
  const source: TeamSystemSchedulerChannelProofSource = {
    name: 'team-scheduler-dag',
    resolveSchedulerChannelProof: proof => proofs.get(proof),
  }
  const unregister = ctx.teams.registerSystemSchedulerChannelProofSource(source)
  const proof = schedulerDeliveryExpiryProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await ctx.teams.expireSchedulerChannelDeliveries({ actor: proof, ...input })
  } finally {
    proofs.delete(proof)
    unregister()
  }
}

/** Create one fixture-only scheduler proof that cannot cross a durable or wire boundary. */
function schedulerDeliveryExpiryProof(): TeamSystemSchedulerChannelProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('scheduler delivery-expiry proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemSchedulerChannelProof
}

/** Build a proof-only claim request from one activation binding that the Hub must revalidate. */
function claimRequest(
  ctx: Context,
  binding: ActivationBindingSnapshot,
  channelId: string,
  envelopeId: string,
): ChannelDeliveryClaimRequest {
  const actor = ctx.teams.openActivationActorProofIssuer().issue(binding).proof
  return {
    actor,
    channelId: channelId as never,
    envelopeId: envelopeId as never,
  }
}

/** Create one active recipient, resident activation, and pending direct delivery. */
async function pendingClaimHarness() {
  const harness = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
  const seeded = await openedChannel(harness.ctx)
  const binding = await bindRecipientActivation(harness.ctx, seeded.team.team.id, seeded.recipient.id)
  const envelope = await harness.ctx.teams.postChannelEnvelope(postRequest(
    seeded.channel.manifest.id,
    seeded.sender.id,
    seeded.recipient.id,
    seeded.channel.cursor,
  ))
  return {
    harness,
    seeded,
    binding,
    envelope,
    input: claimRequest(harness.ctx, binding, seeded.channel.manifest.id, envelope.id),
  }
}

/** Build one recipient page request over channel Envelope cursor order. */
function pendingDeliveryPageRequest(
  channelId: string,
  participantId: string,
  afterCursor: number,
  limit: number,
) {
  return {
    channelId: channelId as never,
    participantId: participantId as never,
    afterCursor,
    limit,
  }
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`Envelope admission (${backend})`, () => {
    it('stamps and atomically persists one Envelope plus adapter records across restart', async () => {
      const first = await setup(backend, recordingAdapter())
      const seeded = await openedChannel(first.ctx)
      const events: ChannelRecord[] = []
      first.ctx.on('channel/changed', ({ record }) => { events.push(record) })
      const envelope = await first.ctx.teams.postChannelEnvelope(postRequest(
        seeded.channel.manifest.id,
        seeded.sender.id,
        seeded.recipient.id,
        seeded.channel.cursor,
      ))

      expect(envelope).toMatchObject({
        teamId: seeded.team.team.id,
        channelId: seeded.channel.manifest.id,
        sequence: seeded.channel.cursor + 1,
        senderId: seeded.sender.id,
        priority: 'normal',
      })
      expect(Object.isFrozen(envelope)).toBe(true)
      expect(events).toMatchObject([
        { type: 'channel/envelope', envelope: { id: envelope.id } },
        { type: 'channel/adapter', payload: { acceptedEnvelopeId: envelope.id, count: 1 } },
      ])
      const beforeRestart = await first.ctx.teams.readChannel({ channelId: seeded.channel.manifest.id, afterCursor: -1 })
      expect(beforeRestart.records.map(record => record.type)).toEqual([
        'channel/opened', 'channel/phase', 'channel/invitation', 'channel/invitation',
        'channel/acknowledged', 'channel/acknowledged', 'channel/phase', 'channel/envelope', 'channel/adapter',
      ])
      const root = first.root
      await first.dispose()

      const second = await setup(backend, recordingAdapter(), root)
      const recovered = await second.ctx.teams.readChannel({ channelId: seeded.channel.manifest.id, afterCursor: 1 })
      expect(recovered.records.filter(record => record.type === 'channel/envelope' || record.type === 'channel/adapter')).toMatchObject([
        { type: 'channel/envelope', envelope: { id: envelope.id } },
        { type: 'channel/adapter', payload: { acceptedEnvelopeId: envelope.id, count: 1 } },
      ])
      await second.dispose()
    })

    it('returns one sender-keyed accepted post after restart before stale-cursor checks', async () => {
      const first = await setup(backend, recordingAdapter())
      const root = first.root
      const seeded = await openedChannel(first.ctx)
      const idempotencyKey = channelPostIdempotencyKeySchema.parse(`post-${backend}-retry`)
      const request = {
        ...postRequest(
          seeded.channel.manifest.id,
          seeded.sender.id,
          seeded.recipient.id,
          seeded.channel.cursor,
        ),
        idempotencyKey,
      }
      let accepted: Awaited<ReturnType<typeof first.ctx.teams.postChannelEnvelope>>
      try {
        accepted = await first.ctx.teams.postChannelEnvelope(request)
      } finally {
        await first.dispose()
      }

      const recovered = await setup(backend, recordingAdapter(), root)
      try {
        const recoveredRequest = {
          ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, seeded.channel.cursor),
          idempotencyKey,
        }
        await expect(recovered.ctx.teams.postChannelEnvelope(recoveredRequest)).resolves.toEqual(accepted!)
        const records = await recovered.ctx.teams.readChannel({
          channelId: seeded.channel.manifest.id,
          afterCursor: -1,
        })
        const envelopes = records.records.filter((record): record is Extract<ChannelRecord, { readonly type: 'channel/envelope' }> => record.type === 'channel/envelope')
        expect(envelopes).toHaveLength(1)
        expect(envelopes[0]).toMatchObject({ idempotencyKey, envelope: { id: accepted!.id } })
        await expect(recovered.ctx.teams.postChannelEnvelope({
          ...recoveredRequest,
          draft: { ...recoveredRequest.draft, correlationId: 'different-correlation' },
        })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT' })
      } finally {
        await recovered.dispose()
      }
    })

    it('prepares a final under the channel lock and replays its durable post key without a caller cursor', async () => {
      const harness = await setup(backend, recordingAdapter({ prepareFinal: true }))
      try {
        const seeded = await openedChannel(harness.ctx)
        const binding = await bindRecipientActivation(harness.ctx, seeded.team.team.id, seeded.recipient.id)
        await harness.ctx.teams.postChannelEnvelope(postRequest(
          seeded.channel.manifest.id,
          seeded.sender.id,
          seeded.recipient.id,
          seeded.channel.cursor,
        ))
        const issuer = harness.ctx.teams.openActivationActorProofIssuer()
        const actorLease = issuer.issue(binding)
        const request = {
          actor: actorLease.proof,
          channelId: seeded.channel.manifest.id,
          idempotencyKey: channelPostIdempotencyKeySchema.parse(`final-${backend}`),
          text: 'Prepared under the Hub channel lock.',
        }
        const accepted = await harness.ctx.teams.postChannelFinalEnvelope(request)
        expect(accepted).toMatchObject({
          senderId: seeded.recipient.id,
          audience: [seeded.sender.id],
          kind: 'final',
          payload: { text: request.text },
          delivery: 'turn',
        })
        await expect(harness.ctx.teams.postChannelFinalEnvelope({
          channelId: seeded.channel.manifest.id,
          idempotencyKey: channelPostIdempotencyKeySchema.parse(`final-unbound-${backend}`),
          text: 'A final without an activation proof.',
        } as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        await expect(harness.ctx.teams.postChannelFinalEnvelope(request)).resolves.toEqual(accepted)
        await expect(harness.ctx.teams.postChannelFinalEnvelope({
          ...request, text: 'A conflicting final.',
        })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT' })
        const foreign = await openedChannel(harness.ctx)
        const foreignBinding = await bindRecipientActivation(
          harness.ctx,
          foreign.team.team.id,
          foreign.recipient.id,
        )
        const foreignLease = issuer.issue(foreignBinding)
        await expect(harness.ctx.teams.postChannelFinalEnvelope({
          ...request,
          actor: foreignLease.proof,
          idempotencyKey: channelPostIdempotencyKeySchema.parse(`final-foreign-${backend}`),
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        actorLease.revoke()
        await expect(harness.ctx.teams.postChannelFinalEnvelope({
          ...request,
          idempotencyKey: channelPostIdempotencyKeySchema.parse(`final-revoked-${backend}`),
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        await harness.dispose()
      }
    })

    it('rejects final admission when the current adapter has no final capability or returns an invalid draft', async () => {
      const unsupported = await setup(backend, recordingAdapter())
      try {
        const seeded = await openedChannel(unsupported.ctx)
        const binding = await bindRecipientActivation(unsupported.ctx, seeded.team.team.id, seeded.sender.id)
        const actorLease = unsupported.ctx.teams.openActivationActorProofIssuer().issue(binding)
        await expect(unsupported.ctx.teams.postChannelFinalEnvelope({
          actor: actorLease.proof,
          channelId: seeded.channel.manifest.id,
          idempotencyKey: channelPostIdempotencyKeySchema.parse(`unsupported-final-${backend}`),
          text: 'Unsupported.',
        })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      } finally {
        await unsupported.dispose()
      }

      const invalid = await setup(backend, recordingAdapter({ prepareFinal: true, invalidFinal: true }))
      try {
        const seeded = await openedChannel(invalid.ctx)
        const binding = await bindRecipientActivation(invalid.ctx, seeded.team.team.id, seeded.sender.id)
        const actorLease = invalid.ctx.teams.openActivationActorProofIssuer().issue(binding)
        await expect(invalid.ctx.teams.postChannelFinalEnvelope({
          actor: actorLease.proof,
          channelId: seeded.channel.manifest.id,
          idempotencyKey: channelPostIdempotencyKeySchema.parse(`invalid-final-${backend}`),
          text: 'Invalid draft.',
        })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_ADAPTER_REJECTED' })
      } finally {
        await invalid.dispose()
      }
    })

    it('keeps the same opaque post key independent for different channel senders', async () => {
      const harness = await setup(backend, recordingAdapter())
      try {
        const seeded = await openedChannel(harness.ctx)
        const idempotencyKey = channelPostIdempotencyKeySchema.parse(`post-${backend}-same-key`)
        const first = await harness.ctx.teams.postChannelEnvelope({
          ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, seeded.channel.cursor),
          idempotencyKey,
        })
        const current = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
        const second = await harness.ctx.teams.postChannelEnvelope({
          ...postRequest(current.manifest.id, seeded.recipient.id, seeded.sender.id, current.cursor),
          idempotencyKey,
          draft: {
            channelId: current.manifest.id,
            audience: [seeded.sender.id],
            kind: 'report',
            payload: { text: 'A distinct sender owns this retry key.' },
            delivery: 'turn',
          },
        })
        expect(second.id).not.toBe(first.id)
      } finally {
        await harness.dispose()
      }
    })

    it('persists one idempotent direct receipt and rebuilds its pending delivery state after restart', async () => {
      const first = await setup(backend, recordingAdapter({ deriveDeliveries: true }))
      const seeded = await openedChannel(first.ctx)
      const envelope = await first.ctx.teams.postChannelEnvelope(postRequest(
        seeded.channel.manifest.id,
        seeded.sender.id,
        seeded.recipient.id,
        seeded.channel.cursor,
      ))
      const current = await first.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
      const receipt = await first.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
        first.ctx,
        seeded.team.team.id,
        seeded.recipient.id,
        seeded.channel.manifest.id,
        envelope.id,
        current.cursor,
      ))
      expect(receipt).toMatchObject({
        participantId: seeded.recipient.id,
        envelopeId: envelope.id,
        cursor: envelope.sequence,
      })
      const duplicate = await first.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
        first.ctx,
        seeded.team.team.id,
        seeded.recipient.id,
        seeded.channel.manifest.id,
        envelope.id,
        0,
      ))
      expect(duplicate).toEqual(receipt)
      const beforeRestart = await first.ctx.teams.readChannel({ channelId: seeded.channel.manifest.id, afterCursor: -1 })
      expect(beforeRestart.records.filter(record => record.type === 'channel/receipt')).toEqual([receipt])
      const root = first.root
      await first.dispose()

      const second = await setup(backend, recordingAdapter({ deriveDeliveries: true }), root)
      await expect(second.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
        second.ctx,
        seeded.team.team.id,
        seeded.recipient.id,
        seeded.channel.manifest.id,
        envelope.id,
        0,
      ))).resolves.toEqual(receipt)
      const restored = await second.ctx.teams.readChannel({ channelId: seeded.channel.manifest.id, afterCursor: -1 })
      expect(restored.records.filter(record => record.type === 'channel/receipt')).toEqual([receipt])
      await second.dispose()
    })

    it('retains pending-delivery capacity across restart and releases it after a durable receipt', async () => {
      const first = await setup(backend, recordingAdapter({ deriveDeliveries: true }), undefined, {
        maxPendingDeliveriesPerChannel: 1,
      })
      const seeded = await openedChannel(first.ctx)
      const accepted = await first.ctx.teams.postChannelEnvelope(postRequest(
        seeded.channel.manifest.id,
        seeded.sender.id,
        seeded.recipient.id,
        seeded.channel.cursor,
      ))
      let current = await first.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
      await expect(first.ctx.teams.postChannelEnvelope(postRequest(
        seeded.channel.manifest.id,
        seeded.sender.id,
        seeded.recipient.id,
        current.cursor,
      ))).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
      await expect(first.ctx.teams.readChannel({ channelId: seeded.channel.manifest.id, afterCursor: -1 }))
        .resolves.toMatchObject({ records: [
          { type: 'channel/opened' }, { type: 'channel/phase' }, { type: 'channel/invitation' }, { type: 'channel/invitation' },
          { type: 'channel/acknowledged' }, { type: 'channel/acknowledged' }, { type: 'channel/phase' },
          { type: 'channel/envelope' }, { type: 'channel/adapter' },
        ] })
      const root = first.root
      await first.dispose()

      const second = await setup(backend, recordingAdapter({ deriveDeliveries: true }), root, {
        maxPendingDeliveriesPerChannel: 1,
      })
      current = await second.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
      await expect(second.ctx.teams.postChannelEnvelope(postRequest(
        seeded.channel.manifest.id,
        seeded.sender.id,
        seeded.recipient.id,
        current.cursor,
      ))).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
      await second.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
        second.ctx,
        seeded.team.team.id,
        seeded.recipient.id,
        seeded.channel.manifest.id,
        accepted.id,
        current.cursor,
      ))
      current = await second.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
      await expect(second.ctx.teams.postChannelEnvelope(postRequest(
        seeded.channel.manifest.id,
        seeded.sender.id,
        seeded.recipient.id,
        current.cursor,
      ))).resolves.toMatchObject({ channelId: seeded.channel.manifest.id })
      await second.dispose()
    })

    it('bounds retained post retry keys across durable receipts and restart', async () => {
      const first = await setup(backend, recordingAdapter({ deriveDeliveries: true }), undefined, {
        maxPostIdempotencyEntriesPerChannel: 1,
      })
      const root = first.root
      const seeded = await openedChannel(first.ctx)
      const firstRequest = {
        ...postRequest(
          seeded.channel.manifest.id,
          seeded.sender.id,
          seeded.recipient.id,
          seeded.channel.cursor,
        ),
        idempotencyKey: channelPostIdempotencyKeySchema.parse(`post-${backend}-retained-a`),
      }
      const accepted = await first.ctx.teams.postChannelEnvelope(firstRequest)
      let channel = await first.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
      await first.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
        first.ctx,
        seeded.team.team.id,
        seeded.recipient.id,
        seeded.channel.manifest.id,
        accepted.id,
        channel.cursor,
      ))
      channel = await first.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
      const secondRequest = {
        ...postRequest(
          seeded.channel.manifest.id,
          seeded.recipient.id,
          seeded.sender.id,
          channel.cursor,
        ),
        idempotencyKey: channelPostIdempotencyKeySchema.parse(`post-${backend}-retained-b`),
      }
      await expect(first.ctx.teams.postChannelEnvelope(secondRequest)).rejects.toMatchObject({
        code: 'TEAM_CHANNEL_BACKPRESSURE',
      })
      await expect(first.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id }))
        .resolves.toMatchObject({ cursor: channel.cursor })
      await expect(first.ctx.teams.postChannelEnvelope(firstRequest)).resolves.toEqual(accepted)
      await first.dispose()

      const second = await setup(backend, recordingAdapter({ deriveDeliveries: true }), root, {
        maxPostIdempotencyEntriesPerChannel: 1,
      })
      try {
        const recoveredFirstRequest = {
          ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, channel.cursor),
          idempotencyKey: firstRequest.idempotencyKey,
        }
        const recoveredSecondRequest = {
          ...postRequest(seeded.channel.manifest.id, seeded.recipient.id, seeded.sender.id, channel.cursor),
          idempotencyKey: secondRequest.idempotencyKey,
        }
        await expect(second.ctx.teams.postChannelEnvelope(recoveredSecondRequest)).rejects.toMatchObject({
          code: 'TEAM_CHANNEL_BACKPRESSURE',
        })
        await expect(second.ctx.teams.postChannelEnvelope(recoveredFirstRequest)).resolves.toEqual(accepted)
      } finally {
        await second.dispose()
      }
    })
  })
}

describe('Channel delivery claims', () => {
  it('returns one detached pending delivery, leaves a normal claim ephemeral, and suppresses receipt and causal-result replays', async () => {
    const harness = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
    const seeded = await openedChannel(harness.ctx)
    const binding = await bindRecipientActivation(harness.ctx, seeded.team.team.id, seeded.recipient.id)
    const dispatches: TeamPolicyRequest[] = []
    const policy = harness.ctx.teams.registerPolicy('dispatch', {
      name: 'observe-delivery-claim',
      async apply(request, next) {
        dispatches.push(request)
        return await next()
      },
    })
    const source = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      seeded.channel.cursor,
    ))
    const beforeClaim = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    const claim = await harness.ctx.teams.claimChannelDelivery(claimRequest(
      harness.ctx,
      binding,
      seeded.channel.manifest.id,
      source.id,
    ))
    if (claim === undefined) throw new Error('pending delivery did not produce a claim')
    expect(claim).toMatchObject({
      binding,
      channel: { manifest: { id: seeded.channel.manifest.id }, cursor: beforeClaim.cursor },
      envelopeId: source.id,
      delivery: 'turn',
    })
    expect(Object.isFrozen(claim)).toBe(true)
    expect(Object.isFrozen(claim.binding)).toBe(true)
    expect(Object.isFrozen(claim.channel)).toBe(true)
    expect(claim.channel.cursor).toBe(beforeClaim.cursor)
    expect(dispatches).toHaveLength(1)
    expect(dispatches[0]).toMatchObject({
      hook: 'dispatch',
      teamId: seeded.team.team.id,
      actorId: seeded.recipient.id,
      facts: {
        activationId: binding.activation.id,
        sessionId: binding.sessionId,
        channelId: seeded.channel.manifest.id,
        participantId: seeded.recipient.id,
        envelopeId: source.id,
        delivery: 'turn',
      },
    })
    await expect(harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id }))
      .resolves.toMatchObject({ cursor: beforeClaim.cursor })

    const receipt = await harness.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
      harness.ctx,
      seeded.team.team.id,
      seeded.recipient.id,
      seeded.channel.manifest.id,
      source.id,
      claim.channel.cursor,
    ))
    const afterReceipt = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    await expect(harness.ctx.teams.claimChannelDelivery(claimRequest(
      harness.ctx,
      binding,
      seeded.channel.manifest.id,
      source.id,
    ))).resolves.toBeUndefined()
    await expect(harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id }))
      .resolves.toMatchObject({ cursor: afterReceipt.cursor })
    expect(receipt.envelopeId).toBe(source.id)

    const nextSource = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      afterReceipt.cursor,
    ))
    const afterNextSource = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    await harness.ctx.teams.postChannelEnvelope({
      ...postRequest(seeded.channel.manifest.id, seeded.recipient.id, seeded.sender.id, afterNextSource.cursor),
      draft: {
        channelId: seeded.channel.manifest.id,
        audience: [seeded.sender.id],
        kind: 'delivery-result',
        payload: { text: 'already handled' },
        delivery: 'context',
        causationId: nextSource.id,
      },
    })
    const beforeCausalClaim = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    await expect(harness.ctx.teams.claimChannelDelivery(claimRequest(
      harness.ctx,
      binding,
      seeded.channel.manifest.id,
      nextSource.id,
    ))).resolves.toBeUndefined()
    const afterCausalClaim = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    expect(afterCausalClaim.cursor).toBe(beforeCausalClaim.cursor + 1)
    const causalTail = await harness.ctx.teams.readChannel({
      channelId: seeded.channel.manifest.id,
      afterCursor: beforeCausalClaim.cursor,
    })
    expect(causalTail.records).toMatchObject([{
      type: 'channel/receipt',
      participantId: seeded.recipient.id,
      envelopeId: nextSource.id,
    }])
    policy()
    await harness.dispose()
  })

  it('rejects raw, forged, foreign, revoked, inactive, missing, and denied claims without appending a receipt', async () => {
    const harness = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
    const seeded = await openedChannel(harness.ctx)
    const binding = await bindRecipientActivation(harness.ctx, seeded.team.team.id, seeded.recipient.id, 'running')
    const envelope = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      seeded.channel.cursor,
    ))
    const input = claimRequest(harness.ctx, binding, seeded.channel.manifest.id, envelope.id)
    await expect(harness.ctx.teams.claimChannelDelivery({ ...input, teamId: seeded.team.team.id } as never)).rejects.toThrow()
    await expect(harness.ctx.teams.claimChannelDelivery({ ...input, participantId: seeded.recipient.id } as never)).rejects.toThrow()
    await expect(harness.ctx.teams.claimChannelDelivery({ ...input, activationId: binding.activation.id } as never)).rejects.toThrow()
    await expect(harness.ctx.teams.claimChannelDelivery({ ...input, sessionId: binding.sessionId } as never)).rejects.toThrow()
    await expect(harness.ctx.teams.claimChannelDelivery({ ...input, actor: {} as never }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const foreign = await openedChannel(harness.ctx)
    const foreignBinding = await bindRecipientActivation(harness.ctx, foreign.team.team.id, foreign.recipient.id)
    const foreignProof = harness.ctx.teams.openActivationActorProofIssuer().issue(foreignBinding).proof
    await expect(harness.ctx.teams.claimChannelDelivery({ ...input, actor: foreignProof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const revokedLease = harness.ctx.teams.openActivationActorProofIssuer().issue(binding)
    revokedLease.revoke()
    await expect(harness.ctx.teams.claimChannelDelivery({ ...input, actor: revokedLease.proof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.claimChannelDelivery({ ...input, envelopeId: 'missing-envelope' as never }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const deny = harness.ctx.teams.registerPolicy('dispatch', {
      name: 'deny-delivery-claim',
      async apply() { return { kind: 'deny', code: 'denied', message: 'delivery paused' } },
    })
    await expect(harness.ctx.teams.claimChannelDelivery(input)).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    deny()
    await seedParticipantPhase(harness.ctx, seeded.team.team.id, seeded.recipient.id, 'left')
    await expect(harness.ctx.teams.claimChannelDelivery(input)).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
    const records = await harness.ctx.teams.readChannel({ channelId: seeded.channel.manifest.id, afterCursor: -1 })
    expect(records.records.filter(record => record.type === 'channel/receipt')).toEqual([])
    await harness.dispose()
  })

  it('revalidates a claimant revoked by dispatch policy before a causal result appends its receipt', async () => {
    const { harness, seeded, binding, envelope } = await pendingClaimHarness()
    const beforeReply = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    await harness.ctx.teams.postChannelEnvelope({
      ...postRequest(seeded.channel.manifest.id, seeded.recipient.id, seeded.sender.id, beforeReply.cursor),
      draft: {
        channelId: seeded.channel.manifest.id,
        audience: [seeded.sender.id],
        kind: 'delivery-result',
        payload: { text: 'already handled' },
        delivery: 'context',
        causationId: envelope.id,
      },
    })
    const beforeClaim = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    const lease = harness.ctx.teams.openActivationActorProofIssuer().issue(binding)
    const policy = harness.ctx.teams.registerPolicy('dispatch', {
      name: 'revoke-causal-claimant-after-policy',
      async apply(_request, next) {
        lease.revoke()
        return await next()
      },
    })
    await expect(harness.ctx.teams.claimChannelDelivery({
      actor: lease.proof,
      channelId: seeded.channel.manifest.id,
      envelopeId: envelope.id,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    policy()
    await expect(harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id }))
      .resolves.toMatchObject({ cursor: beforeClaim.cursor })
    await harness.dispose()
  })

  it('requires an active Team, active channel, and running-or-idle activation before delivery', async () => {
    const inactiveTeam = await pendingClaimHarness()
    let team = await inactiveTeam.harness.ctx.teams.getTeam({ teamId: inactiveTeam.seeded.team.team.id })
    await seedTeamPhase(inactiveTeam.harness.ctx, team.team.id, 'quiescing')
    await expect(inactiveTeam.harness.ctx.teams.claimChannelDelivery(inactiveTeam.input))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await inactiveTeam.harness.dispose()

    const inactiveChannel = await pendingClaimHarness()
    const closed = await closeTestChannel(inactiveChannel.harness.ctx, {
      channelId: inactiveChannel.seeded.channel.manifest.id,
      expectedCursor: (await inactiveChannel.harness.ctx.teams.getChannel({
        channelId: inactiveChannel.seeded.channel.manifest.id,
      })).cursor,
    })
    expect(closed.phase).toBe('closed')
    await expect(inactiveChannel.harness.ctx.teams.claimChannelDelivery(inactiveChannel.input))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await inactiveChannel.harness.dispose()

    const stoppingActivation = await pendingClaimHarness()
    team = await stoppingActivation.harness.ctx.teams.getTeam({ teamId: stoppingActivation.seeded.team.team.id })
    await updateTestActivationStatus(stoppingActivation.harness.ctx, {
      teamId: team.team.id,
      activationId: stoppingActivation.binding.activation.id,
      expectedCursor: team.team.cursor,
      status: 'stopping',
    })
    await expect(stoppingActivation.harness.ctx.teams.claimChannelDelivery(stoppingActivation.input))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await stoppingActivation.harness.dispose()
  })
})

describe('Activation-bound channel authorization', () => {
  it('revalidates a receipt actor revoked by dispatch policy before appending a receipt', async () => {
    const harness = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
    const seeded = await openedChannel(harness.ctx)
    const recipient = await bindRecipientActivation(harness.ctx, seeded.team.team.id, seeded.recipient.id)
    const accepted = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      seeded.channel.cursor,
    ))
    const beforeReceipt = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    const lease = harness.ctx.teams.openActivationActorProofIssuer().issue(recipient)
    const policy = harness.ctx.teams.registerPolicy('dispatch', {
      name: 'revoke-receipt-actor-after-policy',
      async apply(_request, next) {
        lease.revoke()
        return await next()
      },
    })
    await expect(harness.ctx.teams.ackChannelEnvelope({
      actor: lease.proof,
      channelId: seeded.channel.manifest.id,
      envelopeId: accepted.id,
      expectedCursor: beforeReceipt.cursor,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    policy()
    await expect(harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id }))
      .resolves.toMatchObject({ cursor: beforeReceipt.cursor })
    await harness.dispose()
  })

  it('derives the receipt recipient from an exact current activation proof', async () => {
    const harness = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
    const seeded = await openedChannel(harness.ctx)
    await bindRecipientActivation(harness.ctx, seeded.team.team.id, seeded.sender.id, 'running')
    const recipient = await bindRecipientActivation(harness.ctx, seeded.team.team.id, seeded.recipient.id)
    const accepted = await harness.ctx.teams.postChannelEnvelope({
      ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, seeded.channel.cursor),
    })
    const afterPost = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    const receiptLease = harness.ctx.teams.openActivationActorProofIssuer().issue(recipient)
    const receiptRequest: ChannelEnvelopeReceiptRequest = {
      actor: receiptLease.proof,
      channelId: seeded.channel.manifest.id,
      envelopeId: accepted.id,
      expectedCursor: afterPost.cursor,
    }
    await expect(harness.ctx.teams.ackChannelEnvelope(receiptRequest))
      .resolves.toMatchObject({ envelopeId: accepted.id, participantId: seeded.recipient.id })
    const afterReceipt = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    await expect(harness.ctx.teams.ackChannelEnvelope({
      ...receiptRequest,
      expectedCursor: 0,
      participantId: seeded.recipient.id,
    } as never)).rejects.toThrow()
    await expect(harness.ctx.teams.ackChannelEnvelope({ ...receiptRequest, expectedCursor: 0 }))
      .resolves.toMatchObject({ envelopeId: accepted.id, participantId: seeded.recipient.id })
    receiptLease.revoke()
    await expect(harness.ctx.teams.ackChannelEnvelope({ ...receiptRequest, expectedCursor: 0 }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id }))
      .resolves.toMatchObject({ cursor: afterReceipt.cursor })
    await harness.dispose()
  })

  it('rejects forged, cross-Team, revoked, and stale activation proofs before a receipt append', async () => {
    const harness = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
    const seeded = await openedChannel(harness.ctx)
    const recipient = await bindRecipientActivation(harness.ctx, seeded.team.team.id, seeded.recipient.id)
    const accepted = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      seeded.channel.cursor,
    ))
    const afterPost = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    await expect(harness.ctx.teams.ackChannelEnvelope({
      channelId: seeded.channel.manifest.id,
      envelopeId: accepted.id,
      expectedCursor: afterPost.cursor,
    } as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.ackChannelEnvelope({
      participantId: seeded.recipient.id,
      channelId: seeded.channel.manifest.id,
      envelopeId: accepted.id,
      expectedCursor: afterPost.cursor,
    } as never)).rejects.toThrow()
    await expect(harness.ctx.teams.ackChannelEnvelope({
      actor: {} as TeamActorProof,
      channelId: seeded.channel.manifest.id,
      envelopeId: accepted.id,
      expectedCursor: afterPost.cursor,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const foreign = await openedChannel(harness.ctx)
    const foreignBinding = await bindRecipientActivation(harness.ctx, foreign.team.team.id, foreign.recipient.id)
    const foreignLease = harness.ctx.teams.openActivationActorProofIssuer().issue(foreignBinding)
    await expect(harness.ctx.teams.ackChannelEnvelope({
      actor: foreignLease.proof,
      channelId: seeded.channel.manifest.id,
      envelopeId: accepted.id,
      expectedCursor: afterPost.cursor,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const revokedLease = harness.ctx.teams.openActivationActorProofIssuer().issue(recipient)
    revokedLease.revoke()
    const staleLease = harness.ctx.teams.openActivationActorProofIssuer().issue(recipient)
    await updateTestActivationStatus(harness.ctx, {
      teamId: seeded.team.team.id,
      activationId: recipient.activation.id,
      expectedCursor: (await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })).team.cursor,
      status: 'stopping',
    })
    await expect(harness.ctx.teams.ackChannelEnvelope({
      actor: revokedLease.proof,
      channelId: seeded.channel.manifest.id,
      envelopeId: accepted.id,
      expectedCursor: afterPost.cursor,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.ackChannelEnvelope({
      actor: staleLease.proof,
      channelId: seeded.channel.manifest.id,
      envelopeId: accepted.id,
      expectedCursor: afterPost.cursor,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const records = await harness.ctx.teams.readChannel({ channelId: seeded.channel.manifest.id, afterCursor: -1 })
    expect(records.records.filter(record => record.type === 'channel/receipt')).toEqual([])
    await harness.dispose()
  })
})

describe('System final-receipt authorization', () => {
  it('admits Team-run’s exact active direct-v3 coordinator final and validates proof before replay', async () => {
    const harness = await setup('sqlite', recordingAdapter({ version: 4, deriveDeliveries: true }))
    const seeded = await openedSystemFinalChannel(harness.ctx)
    const final = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.coordinator.id,
      seeded.human.id,
      seeded.channel.cursor,
      'final',
    ))
    const source = teamRunFinalReceiptAuthority(harness.ctx)
    const authority = source.issue({
      teamId: seeded.team.team.id,
      channelId: seeded.channel.manifest.id,
      humanId: seeded.human.id,
      coordinatorId: seeded.coordinator.id,
    })
    const current = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    const receiptRequest: ChannelEnvelopeReceiptRequest = {
      actor: authority.proof,
      channelId: seeded.channel.manifest.id,
      envelopeId: final.id,
      expectedCursor: current.cursor,
    }
    await admitTestFinal(harness.ctx, authority.proof, final)
    await expect(harness.ctx.teams.ackChannelEnvelope(receiptRequest))
      .resolves.toMatchObject({ participantId: seeded.human.id, envelopeId: final.id })
    const afterReceipt = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    authority.revoke()
    await expect(harness.ctx.teams.ackChannelEnvelope({ ...receiptRequest, expectedCursor: 0 }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id }))
      .resolves.toMatchObject({ cursor: afterReceipt.cursor })
    await harness.dispose()
  })

  it('rejects forged, wrong-source, cross-scope, non-final, and stale system proofs before policy or receipt append', async () => {
    const harness = await setup('sqlite', recordingAdapter({ version: 4, deriveDeliveries: true }))
    const seeded = await openedSystemFinalChannel(harness.ctx)
    const final = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.coordinator.id,
      seeded.human.id,
      seeded.channel.cursor,
      'final',
    ))
    const normal = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    const nonFinal = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.coordinator.id,
      seeded.human.id,
      normal.cursor,
      'message',
    ))
    const dispatches: TeamPolicyRequest[] = []
    const policy = harness.ctx.teams.registerPolicy('dispatch', {
      name: 'observe-system-receipt-validation',
      async apply(request, next) {
        dispatches.push(request)
        return await next()
      },
    })
    const current = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    const input = { channelId: seeded.channel.manifest.id, envelopeId: final.id, expectedCursor: current.cursor }
    await expect(harness.ctx.teams.ackChannelEnvelope({
      actor: {} as TeamSystemFinalReceiptProof,
      ...input,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const scope: TeamSystemFinalReceiptScope = {
      teamId: seeded.team.team.id,
      channelId: seeded.channel.manifest.id,
      humanId: seeded.human.id,
      coordinatorId: seeded.coordinator.id,
    }
    const otherSource = teamRunFinalReceiptAuthority(harness.ctx, 'another-system')
    await expect(harness.ctx.teams.ackChannelEnvelope({
      actor: otherSource.issue(scope).proof,
      ...input,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const teamRun = teamRunFinalReceiptAuthority(harness.ctx)
    const foreign = await openedSystemFinalChannel(harness.ctx)
    await expect(harness.ctx.teams.ackChannelEnvelope({
      actor: teamRun.issue({
        teamId: foreign.team.team.id,
        channelId: foreign.channel.manifest.id,
        humanId: foreign.human.id,
        coordinatorId: foreign.coordinator.id,
      }).proof,
      ...input,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const staleAuthority = teamRun.issue(scope)
    await expect(harness.ctx.teams.ackChannelEnvelope({
      actor: staleAuthority.proof,
      channelId: seeded.channel.manifest.id,
      envelopeId: nonFinal.id,
      expectedCursor: current.cursor,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await seedParticipantPhase(harness.ctx, seeded.team.team.id, seeded.human.id, 'left')
    await expect(harness.ctx.teams.ackChannelEnvelope({ actor: staleAuthority.proof, ...input }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(dispatches).toEqual([])
    const records = await harness.ctx.teams.readChannel({ channelId: seeded.channel.manifest.id, afterCursor: -1 })
    expect(records.records.filter(record => record.type === 'channel/receipt')).toEqual([])
    policy()
    await harness.dispose()
  })
})

for (const backend of ['json', 'sqlite'] as const) {
  describe(`Pending delivery paging (${backend})`, () => {
    it('records TTL expiry durably before removing a pending delivery', async () => {
      const first = await setup(backend, recordingAdapter({ deriveDeliveries: true }))
      const seeded = await openedChannel(first.ctx)
      const accepted = await first.ctx.teams.postChannelEnvelope({
        ...postRequest(
          seeded.channel.manifest.id,
          seeded.sender.id,
          seeded.recipient.id,
          seeded.channel.cursor,
        ),
        draft: {
          ...postRequest(
            seeded.channel.manifest.id,
            seeded.sender.id,
            seeded.recipient.id,
            seeded.channel.cursor,
          ).draft,
          ttlMs: 10,
        },
      })
      const ttlMs = accepted.ttlMs
      if (ttlMs === undefined) throw new Error('TTL was not retained on the accepted Envelope')
      const expiryTeam = await first.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const expiryChannel = await first.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
      const expired = await expireSchedulerDeliveries(first.ctx, {
        teamId: seeded.team.team.id,
        channelId: seeded.channel.manifest.id,
        expectedTeamCursor: expiryTeam.team.cursor,
        expectedChannelCursor: expiryChannel.cursor,
        now: accepted.createdAt + ttlMs,
        limit: 1,
      })
      expect(expired.expired).toMatchObject([{
        type: 'channel/delivery-expired',
        participantId: seeded.recipient.id,
        envelopeId: accepted.id,
        envelopeSequence: accepted.sequence,
      }])
      await expect(first.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
        seeded.channel.manifest.id,
        seeded.recipient.id,
        -1,
        1,
      ))).resolves.toMatchObject({ deliveries: [] })
      await expect(first.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
        first.ctx,
        seeded.team.team.id,
        seeded.recipient.id,
        seeded.channel.manifest.id,
        accepted.id,
        expired.channel.cursor,
      ))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      const records = await first.ctx.teams.readChannel({ channelId: seeded.channel.manifest.id, afterCursor: -1 })
      expect(records.records.filter(record => record.type === 'channel/delivery-expired')).toEqual(expired.expired)
      const root = first.root
      await first.dispose()

      const second = await setup(backend, recordingAdapter({ deriveDeliveries: true }), root)
      await expect(second.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
        seeded.channel.manifest.id,
        seeded.recipient.id,
        -1,
        1,
      ))).resolves.toMatchObject({ deliveries: [] })
      const replayTeam = await second.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const replayChannel = await second.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
      await expect(expireSchedulerDeliveries(second.ctx, {
        teamId: seeded.team.team.id,
        channelId: seeded.channel.manifest.id,
        expectedTeamCursor: replayTeam.team.cursor,
        expectedChannelCursor: replayChannel.cursor,
        now: accepted.createdAt + ttlMs,
        limit: 1,
      })).resolves.toMatchObject({ expired: [] })
      await second.dispose()
    })

    it('pages current pending Envelopes in durable order across restart without using receipt high-water cursors', async () => {
      const first = await setup(backend, recordingAdapter({ deriveDeliveries: true }))
      const seeded = await openedChannel(first.ctx)
      const firstEnvelope = await first.ctx.teams.postChannelEnvelope(postRequest(
        seeded.channel.manifest.id,
        seeded.sender.id,
        seeded.recipient.id,
        seeded.channel.cursor,
      ))
      let current = await first.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
      const secondEnvelope = await first.ctx.teams.postChannelEnvelope(postRequest(
        seeded.channel.manifest.id,
        seeded.sender.id,
        seeded.recipient.id,
        current.cursor,
      ))
      current = await first.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
      const thirdEnvelope = await first.ctx.teams.postChannelEnvelope(postRequest(
        seeded.channel.manifest.id,
        seeded.sender.id,
        seeded.recipient.id,
        current.cursor,
      ))
      current = await first.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
      await first.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
        first.ctx,
        seeded.team.team.id,
        seeded.recipient.id,
        seeded.channel.manifest.id,
        secondEnvelope.id,
        current.cursor,
      ))
      const afterReceipt = await first.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })

      const firstPage = await first.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
        seeded.channel.manifest.id,
        seeded.recipient.id,
        -1,
        1,
      ))
      expect(firstPage.deliveries).toMatchObject([{
        envelope: { id: firstEnvelope.id, payload: { text: 'The review is complete.' } },
        delivery: 'turn',
      }])
      expect(firstPage.nextCursor).toBe(firstEnvelope.sequence)
      expect(Object.isFrozen(firstPage)).toBe(true)
      expect(Object.isFrozen(firstPage.channel)).toBe(true)
      expect(Object.isFrozen(firstPage.deliveries)).toBe(true)
      expect(Object.isFrozen(firstPage.deliveries[0]?.envelope)).toBe(true)

      const secondPage = await first.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
        seeded.channel.manifest.id,
        seeded.recipient.id,
        firstPage.nextCursor,
        1,
      ))
      expect(secondPage.deliveries).toMatchObject([{
        envelope: { id: thirdEnvelope.id },
        delivery: 'turn',
      }])
      expect(secondPage.nextCursor).toBe(afterReceipt.cursor)
      const exhausted = await first.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
        seeded.channel.manifest.id,
        seeded.recipient.id,
        afterReceipt.cursor + 50,
        1,
      ))
      expect(exhausted).toMatchObject({ deliveries: [], nextCursor: afterReceipt.cursor + 50 })
      const noRecipientDeliveries = await first.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
        seeded.channel.manifest.id,
        seeded.sender.id,
        -1,
        1,
      ))
      expect(noRecipientDeliveries).toMatchObject({ deliveries: [], nextCursor: afterReceipt.cursor })

      const root = first.root
      await first.dispose()
      const second = await setup(backend, recordingAdapter({ deriveDeliveries: true }), root)
      const restored = await second.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
        seeded.channel.manifest.id,
        seeded.recipient.id,
        -1,
        2,
      ))
      expect(restored.deliveries.map(delivery => delivery.envelope.id)).toEqual([firstEnvelope.id, thirdEnvelope.id])
      expect(restored.nextCursor).toBe(afterReceipt.cursor)
      await second.dispose()
    })

    it('replays a checkpointed large pending-delivery set in source order', async () => {
      const first = await setup(backend, recordingAdapter({ deriveDeliveries: true }), undefined, {
        checkpointEvery: 16,
      })
      const seeded = await openedChannel(first.ctx)
      const envelopeIds: string[] = []
      let cursor = seeded.channel.cursor
      for (let index = 0; index < LARGE_PENDING_DELIVERY_COUNT; index += 1) {
        const accepted = await first.ctx.teams.postChannelEnvelope(postRequest(
          seeded.channel.manifest.id,
          seeded.sender.id,
          seeded.recipient.id,
          cursor,
          `bulk-${String(index)}`,
        ))
        envelopeIds.push(accepted.id)
        cursor = (await first.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })).cursor
      }
      const root = first.root
      await first.dispose()

      const second = await setup(backend, recordingAdapter({ deriveDeliveries: true }), root, {
        checkpointEvery: 16,
      })
      const delivered: string[] = []
      let afterCursor = -1
      while (true) {
        const page = await second.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
          seeded.channel.manifest.id,
          seeded.recipient.id,
          afterCursor,
          17,
        ))
        delivered.push(...page.deliveries.map(delivery => String(delivery.envelope.id)))
        if (page.deliveries.length === 0) break
        afterCursor = page.nextCursor
      }
      expect(delivered).toEqual(envelopeIds)
      await second.dispose()
    })
  })
}

describe('Pending delivery paging rejection', () => {
  it('enforces the configured page limit and validates dispatch policy, membership, attachment, and channel phase', async () => {
    const harness = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }), undefined, {
      maxPendingDeliveryPageSize: 1,
    })
    const seeded = await openedChannel(harness.ctx)
    const envelope = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      seeded.channel.cursor,
    ))
    const input = pendingDeliveryPageRequest(seeded.channel.manifest.id, seeded.recipient.id, -1, 1)
    await expect(harness.ctx.teams.listChannelPendingDeliveries({ ...input, limit: 2 }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const dispatches: TeamPolicyRequest[] = []
    const observe = harness.ctx.teams.registerPolicy('dispatch', {
      name: 'observe-pending-page',
      async apply(request, next) {
        dispatches.push(request)
        return await next()
      },
    })
    await expect(harness.ctx.teams.listChannelPendingDeliveries(input)).resolves.toMatchObject({
      deliveries: [{ envelope: { id: envelope.id } }],
    })
    expect(dispatches[0]).toMatchObject({
      hook: 'dispatch',
      teamId: seeded.team.team.id,
      actorId: seeded.recipient.id,
      facts: { channelId: seeded.channel.manifest.id, participantId: seeded.recipient.id, afterCursor: -1, limit: 1 },
    })
    observe()
    const deny = harness.ctx.teams.registerPolicy('dispatch', {
      name: 'deny-pending-page',
      async apply() { return { kind: 'deny', code: 'denied', message: 'delivery page paused' } },
    })
    await expect(harness.ctx.teams.listChannelPendingDeliveries(input)).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    deny()
    const nonmember = await activeParticipant(harness.ctx, seeded.team.team.id, 'Nonmember')
    await expect(harness.ctx.teams.listChannelPendingDeliveries({ ...input, participantId: nonmember.id }))
      .rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
    const hub = harness.ctx.teams as unknown as {
      teams: Map<string, { projection: { channelIds: Set<string> } }>
    }
    const loaded = hub.teams.get(seeded.team.team.id)
    if (loaded === undefined) throw new Error('Team Hub did not retain the seeded Team')
    loaded.projection.channelIds.delete(seeded.channel.manifest.id)
    await expect(harness.ctx.teams.listChannelPendingDeliveries(input))
      .rejects.toMatchObject({ code: 'TEAM_CHANNEL_NOT_FOUND' })
    await harness.dispose()

    const closed = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
    const closedSeed = await openedChannel(closed.ctx)
    await closeTestChannel(closed.ctx, {
      channelId: closedSeed.channel.manifest.id,
      expectedCursor: closedSeed.channel.cursor,
    })
    await expect(closed.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
      closedSeed.channel.manifest.id,
      closedSeed.recipient.id,
      -1,
      1,
    ))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await closed.dispose()
  })

  it('rejects inactive Teams and incomplete or contradictory pending-delivery projections', async () => {
    const inactive = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
    const inactiveSeed = await openedChannel(inactive.ctx)
    const inactiveTeam = await inactive.ctx.teams.getTeam({ teamId: inactiveSeed.team.team.id })
    await seedTeamPhase(inactive.ctx, inactiveTeam.team.id, 'quiescing')
    await expect(inactive.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
      inactiveSeed.channel.manifest.id,
      inactiveSeed.recipient.id,
      -1,
      1,
    ))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await inactive.dispose()

    const missingEnvelope = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
    const missingSeed = await openedChannel(missingEnvelope.ctx)
    await missingEnvelope.ctx.teams.postChannelEnvelope(postRequest(
      missingSeed.channel.manifest.id,
      missingSeed.sender.id,
      missingSeed.recipient.id,
      missingSeed.channel.cursor,
    ))
    const missingCurrent = await missingEnvelope.ctx.teams.getChannel({ channelId: missingSeed.channel.manifest.id })
    const missingHub = missingEnvelope.ctx.teams as unknown as {
      channels: Map<string, {
        projection: {
          cursor: number
          pendingDeliveries: Map<string, Map<string, { envelopeId: string; envelopeSequence: number; delivery: 'turn' }>>
        }
      }>
    }
    const missingLoaded = missingHub.channels.get(missingSeed.channel.manifest.id)
    if (missingLoaded === undefined) throw new Error('Team Hub did not retain the seeded channel')
    const missingDeliveries = missingLoaded.projection.pendingDeliveries.get(missingSeed.recipient.id)
    if (missingDeliveries === undefined) throw new Error('test channel has no recipient delivery row')
    // A recovered projection must never invent a payload when its durable Envelope is absent.
    missingDeliveries.set('missing-envelope', {
      envelopeId: 'missing-envelope',
      envelopeSequence: missingCurrent.cursor + 1,
      delivery: 'turn',
    })
    await expect(missingEnvelope.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
      missingSeed.channel.manifest.id,
      missingSeed.recipient.id,
      missingCurrent.cursor,
      1,
    ))).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
    await missingEnvelope.dispose()

    const contradictory = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
    const contradictorySeed = await openedChannel(contradictory.ctx)
    const accepted = await contradictory.ctx.teams.postChannelEnvelope(postRequest(
      contradictorySeed.channel.manifest.id,
      contradictorySeed.sender.id,
      contradictorySeed.recipient.id,
      contradictorySeed.channel.cursor,
    ))
    const contradictoryHub = contradictory.ctx.teams as unknown as {
      channels: Map<string, {
        projection: {
          pendingDeliveries: Map<string, Map<string, { envelopeId: string; envelopeSequence: number; delivery: 'turn' }>>
        }
      }>
    }
    const contradictoryLoaded = contradictoryHub.channels.get(contradictorySeed.channel.manifest.id)
    if (contradictoryLoaded === undefined) throw new Error('Team Hub did not retain the seeded channel')
    const contradictoryDeliveries = contradictoryLoaded.projection.pendingDeliveries.get(contradictorySeed.recipient.id)
    const pending = contradictoryDeliveries?.get(accepted.id)
    if (contradictoryDeliveries === undefined || pending === undefined) {
      throw new Error('test channel has no accepted pending delivery')
    }
    contradictoryDeliveries.set(accepted.id, { ...pending, envelopeSequence: pending.envelopeSequence + 1 })
    await expect(contradictory.ctx.teams.listChannelPendingDeliveries(pendingDeliveryPageRequest(
      contradictorySeed.channel.manifest.id,
      contradictorySeed.recipient.id,
      -1,
      1,
    ))).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
    await contradictory.dispose()
  })
})

describe('Envelope admission rejection', () => {
  it('revalidates activation and TeamRun post proofs revoked by send policy before WAL admission', async () => {
    const activation = await setup('sqlite', recordingAdapter())
    const seeded = await openedChannel(activation.ctx)
    const binding = postBindings.get(String(seeded.sender.id))
    if (binding === undefined) throw new Error('sender fixture did not retain an activation binding')
    const lease = activation.ctx.teams.openActivationActorProofIssuer().issue(binding)
    const beforeActivationPost = await activation.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    const activationPolicy = activation.ctx.teams.registerPolicy('send', {
      name: 'revoke-envelope-sender-after-policy',
      async apply(_request, next) {
        lease.revoke()
        return await next()
      },
    })
    await expect(activation.ctx.teams.postChannelEnvelope({
      ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, beforeActivationPost.cursor),
      actor: lease.proof,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    activationPolicy()
    await expect(activation.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id }))
      .resolves.toMatchObject({ cursor: beforeActivationPost.cursor })
    await activation.dispose()

    const system = await setup('sqlite', recordingAdapter({ version: 4 }))
    const systemSeed = await openedSystemFinalChannel(system.ctx)
    const source = teamRunEnvelopePostAuthority(system.ctx)
    const authority = source.issue({
      kind: 'team-run-human-input',
      teamId: systemSeed.team.team.id,
      channelId: systemSeed.channel.manifest.id,
      humanId: systemSeed.human.id,
      coordinatorId: systemSeed.coordinator.id,
    })
    const beforeSystemPost = await system.ctx.teams.getChannel({ channelId: systemSeed.channel.manifest.id })
    const systemPolicy = system.ctx.teams.registerPolicy('send', {
      name: 'revoke-team-run-post-after-policy',
      async apply(_request, next) {
        authority.revoke()
        return await next()
      },
    })
    await expect(system.ctx.teams.postChannelEnvelope({
      actor: authority.proof,
      expectedCursor: beforeSystemPost.cursor,
      draft: {
        channelId: systemSeed.channel.manifest.id,
        audience: [systemSeed.coordinator.id],
        kind: 'message',
        payload: { text: 'Please start the review.' },
        delivery: 'turn',
      },
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    systemPolicy()
    await expect(system.ctx.teams.getChannel({ channelId: systemSeed.channel.manifest.id }))
      .resolves.toMatchObject({ cursor: beforeSystemPost.cursor })
    await system.dispose()
  })

  it('rejects stale cursors, nonmembers, invalid audiences, policy denials, and closed channels before append', async () => {
    const harness = await setup('sqlite', recordingAdapter())
    const seeded = await openedChannel(harness.ctx)
    const request = postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, seeded.channel.cursor)
    await expect(harness.ctx.teams.postChannelEnvelope({ ...request, expectedCursor: request.expectedCursor - 1 }))
      .rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })
    await expect(harness.ctx.teams.postChannelEnvelope({ ...request, senderId: 'missing-participant' as never } as never))
      .rejects.toMatchObject({ name: 'ZodError' })
    await expect(harness.ctx.teams.postChannelEnvelope({
      ...request,
      draft: { ...request.draft, audience: ['missing-participant' as never] },
    })).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
    const deny = harness.ctx.teams.registerPolicy('send', {
      name: 'deny-envelope',
      async apply() { return { kind: 'deny', code: 'denied', message: 'Envelope admission is paused' } },
    })
    await expect(harness.ctx.teams.postChannelEnvelope(request)).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    deny()
    const closed = await closeTestChannel(harness.ctx, {
      channelId: seeded.channel.manifest.id,
      expectedCursor: seeded.channel.cursor,
    })
    await expect(harness.ctx.teams.postChannelEnvelope({ ...request, expectedCursor: closed.cursor }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const records = await harness.ctx.teams.readChannel({ channelId: seeded.channel.manifest.id, afterCursor: -1 })
    expect(records.records.map(record => record.type)).toEqual([
      'channel/opened', 'channel/phase', 'channel/invitation', 'channel/invitation',
      'channel/acknowledged', 'channel/acknowledged', 'channel/phase', 'channel/phase', 'channel/closed',
    ])
    await harness.dispose()
  })

  it('keeps the WAL unchanged when an adapter rejects input or returns an invalid post-accept record', async () => {
    const rejected = await setup('sqlite', recordingAdapter({ rejectKind: 'reject' }))
    const first = await openedChannel(rejected.ctx)
    await expect(rejected.ctx.teams.postChannelEnvelope(postRequest(
      first.channel.manifest.id,
      first.sender.id,
      first.recipient.id,
      first.channel.cursor,
      'reject',
    ))).rejects.toMatchObject({ code: 'TEAM_CHANNEL_ADAPTER_REJECTED' })
    await expect(rejected.ctx.teams.readChannel({ channelId: first.channel.manifest.id, afterCursor: -1 }))
      .resolves.toMatchObject({ records: [
        { type: 'channel/opened' }, { type: 'channel/phase' }, { type: 'channel/invitation' }, { type: 'channel/invitation' },
        { type: 'channel/acknowledged' }, { type: 'channel/acknowledged' }, { type: 'channel/phase' },
      ] })
    await rejected.dispose()

    const malformed = await setup('sqlite', recordingAdapter({ invalidAfterAccept: true }))
    const second = await openedChannel(malformed.ctx)
    await expect(malformed.ctx.teams.postChannelEnvelope(postRequest(
      second.channel.manifest.id,
      second.sender.id,
      second.recipient.id,
      second.channel.cursor,
    ))).rejects.toMatchObject({ code: 'TEAM_CHANNEL_ADAPTER_REJECTED' })
    const records = await malformed.ctx.teams.readChannel({ channelId: second.channel.manifest.id, afterCursor: -1 })
    expect(records.records.map(record => record.type)).toEqual([
      'channel/opened', 'channel/phase', 'channel/invitation', 'channel/invitation',
      'channel/acknowledged', 'channel/acknowledged', 'channel/phase',
    ])
    await malformed.dispose()

    const nonArray = await setup('sqlite', recordingAdapter({ nonArrayAfterAccept: true }))
    const third = await openedChannel(nonArray.ctx)
    await expect(nonArray.ctx.teams.postChannelEnvelope(postRequest(
      third.channel.manifest.id,
      third.sender.id,
      third.recipient.id,
      third.channel.cursor,
    ))).rejects.toMatchObject({ code: 'TEAM_CHANNEL_ADAPTER_REJECTED' })
    await expect(nonArray.ctx.teams.readChannel({ channelId: third.channel.manifest.id, afterCursor: -1 }))
      .resolves.toMatchObject({ records: [
        { type: 'channel/opened' }, { type: 'channel/phase' }, { type: 'channel/invitation' }, { type: 'channel/invitation' },
        { type: 'channel/acknowledged' }, { type: 'channel/acknowledged' }, { type: 'channel/phase' },
      ] })
    await nonArray.dispose()
  })

  it('enforces the configured complete Envelope byte limit before adapter admission', async () => {
    const harness = await setup('sqlite', recordingAdapter(), undefined, { maxEnvelopeBytes: 1 })
    const seeded = await openedChannel(harness.ctx)
    await expect(harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      seeded.channel.cursor,
    ))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const records = await harness.ctx.teams.readChannel({ channelId: seeded.channel.manifest.id, afterCursor: -1 })
    expect(records.records.map(record => record.type)).toEqual([
      'channel/opened', 'channel/phase', 'channel/invitation', 'channel/invitation',
      'channel/acknowledged', 'channel/acknowledged', 'channel/phase',
    ])
    await harness.dispose()
  })

  it('does not consume pending-delivery capacity when an adapter derives no recipients', async () => {
    const harness = await setup('sqlite', recordingAdapter(), undefined, { maxPendingDeliveriesPerChannel: 1 })
    const seeded = await openedChannel(harness.ctx)
    await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      seeded.channel.cursor,
    ))
    const current = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    await expect(harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      current.cursor,
    ))).resolves.toMatchObject({ channelId: seeded.channel.manifest.id })
    await harness.dispose()
  })

  it('validates active Team membership, audience uniqueness, task binding, and every optional Envelope fact', async () => {
    const harness = await setup('sqlite', recordingAdapter())
    const seeded = await openedChannel(harness.ctx)
    await expect(harness.ctx.teams.postChannelEnvelope({
      ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, seeded.channel.cursor),
      draft: {
        channelId: seeded.channel.manifest.id,
        audience: [seeded.recipient.id],
        kind: 'report',
        payload: { text: 'Missing causal predecessor.' },
        delivery: 'turn',
        causationId: 'missing-envelope' as never,
      },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const causalParent = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      seeded.channel.cursor,
    ))
    const policyRequests: TeamPolicyRequest[] = []
    const policy = harness.ctx.teams.registerPolicy('send', {
      name: 'record-envelope-facts',
      async apply(request, next) {
        policyRequests.push(request)
        return await next()
      },
    })
    await provisionTestCoordinator(harness.ctx, seeded.team.team.id)
    const team = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
    const task = await createTestCoordinatorTask(harness.ctx, {
      teamId: team.team.id,
      expectedCursor: team.team.cursor,
      subject: 'Bind Envelope',
      description: 'Retain a valid task reference.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
    })
    const channel = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    await expect(harness.ctx.teams.postChannelEnvelope({
      ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, channel.cursor),
      draft: {
        channelId: seeded.channel.manifest.id,
        audience: [seeded.recipient.id],
        kind: 'report',
        payload: { text: 'Optional facts are retained.' },
        delivery: 'turn',
        causationId: causalParent.id,
        correlationId: 'operation-1',
        taskId: task.id,
        traceId: 'trace-1',
        priority: 'urgent',
        ttlMs: 10,
      },
    })).resolves.toMatchObject({
      causationId: causalParent.id,
      correlationId: 'operation-1',
      taskId: task.id,
      traceId: 'trace-1',
      priority: 'urgent',
      ttlMs: 10,
    })
    expect(policyRequests).toHaveLength(1)
    expect(policyRequests[0]?.actorId).toBe(seeded.sender.id)
    expect(policyRequests[0]?.facts.taskId).toBe(task.id)
    expect(policyRequests[0]?.facts.priority).toBe('urgent')
    const cursor = (await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })).cursor
    await expect(harness.ctx.teams.postChannelEnvelope({
      ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, cursor),
      draft: {
        channelId: seeded.channel.manifest.id,
        audience: null,
        kind: 'report',
        payload: { text: 'Broadcast remains adapter-owned.' },
        delivery: 'context',
      },
    })).resolves.toMatchObject({ audience: null })
    const afterBroadcast = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    await expect(harness.ctx.teams.postChannelEnvelope({
      ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, afterBroadcast.cursor),
      draft: {
        channelId: seeded.channel.manifest.id,
        audience: [seeded.recipient.id, seeded.recipient.id],
        kind: 'report',
        payload: { text: 'Duplicate audience.' },
        delivery: 'context',
      },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(harness.ctx.teams.postChannelEnvelope({
      ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, afterBroadcast.cursor),
      draft: {
        channelId: seeded.channel.manifest.id,
        audience: [],
        kind: 'report',
        payload: { text: 'Missing task.' },
        delivery: 'context',
        taskId: 'missing-task' as never,
      },
    })).rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
    const currentTeam = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
    const deleted = await deleteTestCoordinatorTask(harness.ctx, {
      teamId: currentTeam.team.id,
      taskId: task.id,
      expectedRevision: task.revision,
    })
    await expect(harness.ctx.teams.postChannelEnvelope({
      ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, afterBroadcast.cursor),
      draft: {
        channelId: seeded.channel.manifest.id,
        audience: [],
        kind: 'report',
        payload: { text: 'Deleted task.' },
        delivery: 'context',
        taskId: deleted.id,
      },
    })).rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
    const active = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
    await seedTeamPhase(harness.ctx, active.team.id, 'quiescing')
    await expect(harness.ctx.teams.postChannelEnvelope({
      ...postRequest(seeded.channel.manifest.id, seeded.sender.id, seeded.recipient.id, afterBroadcast.cursor),
      draft: {
        channelId: seeded.channel.manifest.id,
        audience: [],
        kind: 'report',
        payload: { text: 'Inactive Team.' },
        delivery: 'context',
      },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    policy()
    await harness.dispose()
  })

  it('rejects an internally detached channel before accepting a draft', async () => {
    const harness = await setup('sqlite', recordingAdapter())
    const seeded = await openedChannel(harness.ctx)
    const hub = harness.ctx.teams as unknown as {
      teams: Map<string, { projection: { channelIds: Set<string> } }>
    }
    const loaded = hub.teams.get(seeded.team.team.id)
    if (loaded === undefined) throw new Error('Team Hub did not retain the seeded Team')
    loaded.projection.channelIds.delete(seeded.channel.manifest.id)
    await expect(harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      seeded.channel.cursor,
    ))).rejects.toMatchObject({ code: 'TEAM_CHANNEL_NOT_FOUND' })
    await harness.dispose()
  })

  it('rejects stale cursors, unauthorized recipients, and policy-denied receipts while preserving pending direct delivery', async () => {
    const harness = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
    const seeded = await openedChannel(harness.ctx)
    const first = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      seeded.channel.cursor,
    ))
    const current = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    await expect(harness.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
      harness.ctx,
      seeded.team.team.id,
      seeded.recipient.id,
      seeded.channel.manifest.id,
      first.id,
      current.cursor - 1,
    ))).rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })
    await expect(harness.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
      harness.ctx,
      seeded.team.team.id,
      seeded.sender.id,
      seeded.channel.manifest.id,
      first.id,
      current.cursor,
    ))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const deny = harness.ctx.teams.registerPolicy('dispatch', {
      name: 'deny-receipts',
      async apply() { return { kind: 'deny', code: 'denied', message: 'receipt dispatch is paused' } },
    })
    await expect(harness.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
      harness.ctx,
      seeded.team.team.id,
      seeded.recipient.id,
      seeded.channel.manifest.id,
      first.id,
      current.cursor,
    ))).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    deny()
    await expect(harness.ctx.teams.ackChannelEnvelope({
      actor: {} as TeamActorProof,
      channelId: seeded.channel.manifest.id,
      envelopeId: first.id,
      expectedCursor: current.cursor,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await harness.dispose()
  })

  it('keeps a recipient high-water cursor monotonic while acknowledgements arrive out of Envelope order', async () => {
    const harness = await setup('sqlite', recordingAdapter({ deriveDeliveries: true }))
    const seeded = await openedChannel(harness.ctx)
    const first = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      seeded.channel.cursor,
    ))
    const afterFirst = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    const second = await harness.ctx.teams.postChannelEnvelope(postRequest(
      seeded.channel.manifest.id,
      seeded.sender.id,
      seeded.recipient.id,
      afterFirst.cursor,
    ))
    const afterSecond = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    const secondReceipt = await harness.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
      harness.ctx,
      seeded.team.team.id,
      seeded.recipient.id,
      seeded.channel.manifest.id,
      second.id,
      afterSecond.cursor,
    ))
    const afterSecondReceipt = await harness.ctx.teams.getChannel({ channelId: seeded.channel.manifest.id })
    const firstReceipt = await harness.ctx.teams.ackChannelEnvelope(await activationReceiptRequest(
      harness.ctx,
      seeded.team.team.id,
      seeded.recipient.id,
      seeded.channel.manifest.id,
      first.id,
      afterSecondReceipt.cursor,
    ))
    expect(firstReceipt.cursor).toBe(secondReceipt.cursor)
    expect(firstReceipt.cursor).toBe(second.sequence)
    await harness.dispose()
  })
})
