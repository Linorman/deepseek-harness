import { consentChannelEndpoints } from '../../../core/team/tests/channel-endpoint-consent.ts'
import { recordEnvelope } from '../../../core/team/tests/channel-envelope-record.ts'
import { fingerprintChannelSummarySources } from '@clocky/clocky-team'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { summarizeTestChannel } from '../../../core/team/tests/channel-summary-authority.ts'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import {
  TeamError,
  activationIdSchema,
  channelManifestSchema,
  channelSummaryIdempotencyKeySchema,
  envelopeIdSchema,
  participantIdSchema,
  teamEnvelopeDraftSchema,
  teamEnvelopeSchema,
  teamIdSchema,
} from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import type {
  ActivationBindingSnapshot,
  ChannelManifest,
  ChannelRecord,
  JsonObject,
  JsonValue,
  ParticipantSnapshot,
  TeamEnvelope,
  TeamEnvelopeDraft,
  TeamActorProof,
  TeamId,
  TeamSystemActivationProof,
  TeamSystemActivationScope,
} from '@clocky/clocky-team'
import * as DirectChannel from '../src/index.ts'
import {
  DIRECT_CHANNEL_ADAPTER_V1,
  DIRECT_CHANNEL_ADAPTER_V2,
  DIRECT_CHANNEL_ADAPTER_V3,
  DIRECT_CHANNEL_ADAPTER_V4,
  DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
  DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
  DIRECT_CHANNEL_TYPE,
  DIRECT_CHANNEL_VERSION_V1,
  DIRECT_CHANNEL_VERSION_V2,
  DIRECT_CHANNEL_VERSION_V3,
  directChannelAdapter,
  directChannelV2Adapter,
  directChannelV3Adapter,
  directChannelV2Peer,
  directChannelV3Peer,
  directProductChannelPeer,
  parseDirectChannelV2Manifest,
  parseDirectChannelV3Manifest,
  parseDirectChannelV3MessagePayload,
  parseDirectProductChannelManifest,
} from '../src/direct.ts'
import { SUMMARIZED_WINDOW_VIEW_POLICY } from '../src/view.ts'

const roots: string[] = []
const teamId = teamIdSchema.parse('team-direct')
const channelId = 'channel-direct' as const
const senderId = participantIdSchema.parse('participant-sender')
const recipientId = participantIdSchema.parse('participant-recipient')
const thirdId = participantIdSchema.parse('participant-third')
const outsiderId = participantIdSchema.parse('participant-outsider')
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'
type ControllerActivationBindScope = Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-bind' }>
const activationProofStores = new WeakMap<Context, WeakMap<TeamSystemActivationProof, ControllerActivationBindScope>>()

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Build one valid direct manifest, with optional schema-valid protocol variations. */
function directManifest(overrides: Record<string, unknown> = {}): ChannelManifest {
  return channelManifestSchema.parse({
    id: channelId,
    teamId,
    adapter: DIRECT_CHANNEL_ADAPTER_V1,
    participants: [
      { id: senderId, role: 'sender' },
      { id: recipientId, role: 'recipient' },
    ],
    limits: {},
    ...overrides,
  })
}

/** Build one generic Envelope draft that the direct adapter can refine. */
function directDraft(overrides: Record<string, unknown> = {}): TeamEnvelopeDraft {
  return teamEnvelopeDraftSchema.parse({
    channelId,
    audience: [recipientId],
    kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
    payload: { text: 'Review complete.' },
    delivery: 'turn',
    ...overrides,
  })
}

/** Build one Hub-stamped direct Envelope for pure adapter calls. */
function directEnvelope(overrides: Record<string, unknown> = {}): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: 'envelope-direct',
    teamId,
    sequence: 2,
    senderId,
    audience: [recipientId],
    kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
    payload: { text: 'Review complete.' },
    delivery: 'turn',
    priority: 'normal',
    createdAt: 1,
    channelId,
    ...overrides,
  })
}

/** Build one schema-valid version-two direct product-channel manifest. */
function directV2Manifest(overrides: Record<string, unknown> = {}): ChannelManifest {
  return channelManifestSchema.parse({
    id: channelId,
    teamId,
    adapter: DIRECT_CHANNEL_ADAPTER_V2,
    participants: [
      { id: senderId, role: 'sender' },
      { id: recipientId, role: 'recipient' },
    ],
    limits: {},
    ...overrides,
  })
}

/** Build one schema-valid version-three direct product-channel manifest. */
function directV3Manifest(overrides: Record<string, unknown> = {}): ChannelManifest {
  return channelManifestSchema.parse({
    id: channelId,
    teamId,
    adapter: DIRECT_CHANNEL_ADAPTER_V3,
    participants: [
      { id: senderId, role: 'sender' },
      { id: recipientId, role: 'recipient' },
    ],
    limits: {},
    ...overrides,
  })
}

/** Build one durable image reference with schema-valid JSON fields. */
function imageReference(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    attachmentId: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    mediaType: 'image/png',
    bytes: 4,
    width: 2,
    height: 2,
    ...overrides,
  }
}

/** Build one schema-valid v3 human-message draft. */
function directV3MessageDraft(
  content: readonly JsonValue[] = [{ type: 'text', text: 'Review the attached image.' }],
  overrides: Record<string, unknown> = {},
): TeamEnvelopeDraft {
  return directDraft({ payload: { content }, ...overrides })
}

/** Build one Hub-stamped version-two final Envelope for pure adapter calls. */
function directV2FinalEnvelope(overrides: Record<string, unknown> = {}): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: 'envelope-direct-final',
    teamId,
    sequence: 2,
    senderId,
    audience: [recipientId],
    kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
    payload: { text: 'The requested work is complete.' },
    delivery: 'turn',
    priority: 'normal',
    createdAt: 1,
    channelId,
    ...overrides,
  })
}

/** Build one Hub-stamped version-three direct human-content Envelope for pure adapter calls. */
function directV3MessageEnvelope(overrides: Record<string, unknown> = {}): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: 'envelope-direct-v3-message',
    teamId,
    sequence: 2,
    senderId,
    audience: [recipientId],
    kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
    payload: { content: [{ type: 'text', text: 'Review the attached image.' }] },
    delivery: 'turn',
    priority: 'normal',
    createdAt: 1,
    channelId,
    ...overrides,
  })
}

/** Build one Hub-stamped version-three direct final Envelope for pure adapter calls. */
function directV3FinalEnvelope(overrides: Record<string, unknown> = {}): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: 'envelope-direct-v3-final',
    teamId,
    sequence: 2,
    senderId,
    audience: [recipientId],
    kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
    payload: { text: 'The requested work is complete.' },
    delivery: 'turn',
    priority: 'normal',
    createdAt: 1,
    channelId,
    ...overrides,
  })
}

/** Invoke direct validation with a selected manifest, state, sender, and draft. */
function validateSend(
  draft: TeamEnvelopeDraft,
  options: {
    readonly manifest?: ChannelManifest
    readonly state?: JsonValue
    readonly senderId?: typeof senderId
  } = {},
): void {
  directChannelAdapter.validateSend({
    manifest: options.manifest ?? directManifest(),
    state: options.state ?? null,
    senderId: options.senderId ?? senderId,
    draft,
  })
}

/** Invoke direct version-two validation with a selected manifest, state, sender, and draft. */
function validateV2Send(
  draft: TeamEnvelopeDraft,
  options: {
    readonly manifest?: ChannelManifest
    readonly state?: JsonValue
    readonly senderId?: typeof senderId
  } = {},
): void {
  directChannelV2Adapter.validateSend({
    manifest: options.manifest ?? directV2Manifest(),
    state: options.state ?? null,
    senderId: options.senderId ?? senderId,
    draft,
  })
}

/** Invoke direct version-three validation with a selected manifest, state, sender, and draft. */
function validateV3Send(
  draft: TeamEnvelopeDraft,
  options: {
    readonly manifest?: ChannelManifest
    readonly state?: JsonValue
    readonly senderId?: typeof senderId
  } = {},
): void {
  directChannelV3Adapter.validateSend({
    manifest: options.manifest ?? directV3Manifest(),
    state: options.state ?? null,
    senderId: options.senderId ?? senderId,
    draft,
  })
}

/** Compose a real JSON-backed Team Hub plus this adapter-provider plugin. */
async function setup() {
  const root = await freshRoot()
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    const directFiber = await ctx.plugin(DirectChannel)
    return { ctx, directFiber }
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
}

/** Allocate a project-local durable root for one real Hub composition. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-channel-direct-'))
  roots.push(root)
  return root
}

/** Invite one local participant and progress it to active Team membership. */
async function activeParticipant(ctx: Context, id: TeamId, displayName: string, role = 'worker'): Promise<ParticipantSnapshot> {
  let state = await ctx.teams.getTeam({ teamId: id })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId: id,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName,
    role,
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId: id })
  await transitionBootstrapParticipant(ctx, {
    teamId: id,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId: id })
  return await transitionBootstrapParticipant(ctx, {
    teamId: id,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
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

/** Issue an opaque Hub actor proof for one active test participant. */
async function activeActor(ctx: Context, teamId: TeamId, participantId: ParticipantSnapshot['id']): Promise<TeamActorProof> {
  const current = await ctx.teams.getTeam({ teamId })
  const binding = current.activations.find(candidate => candidate.activation.participantId === participantId)
    ?? await bindActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse(`activation-direct-${participantId}`),
          teamId,
          participantId,
          status: 'idle',
        },
        sessionId: SessionId(`session-direct-${participantId}`),
        provider: 'direct-channel-test',
      },
    })
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}

/** Create one active Team containing two active direct-channel participants. */
async function openedDirectChannel(ctx: Context, viewPolicy?: { readonly type: string; readonly version: number }) {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Route one review', budgets: {} }, rules: {}, budgets: {} })
  const sender = await activeParticipant(ctx, created.team.id, 'Sender', viewPolicy?.type === 'summarized-window' ? 'coordinator' : 'worker')
  const recipient = await activeParticipant(ctx, created.team.id, 'Recipient')
  const state = await ctx.teams.getTeam({ teamId: created.team.id })
  let channel = await openTestChannel(ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    adapter: DIRECT_CHANNEL_ADAPTER_V1,
    ...viewPolicy === undefined ? {} : { viewPolicy },
    participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
    limits: {},
  })
  const senderActor = await activeActor(ctx, created.team.id, sender.id)
  channel = await consentChannelEndpoints(ctx, channel, [
    { participantId: sender.id, actor: senderActor },
    { participantId: recipient.id, actor: await activeActor(ctx, created.team.id, recipient.id) },
  ], (manifest) => { directChannelAdapter.validateCreate(manifest) })
  return { sender, recipient, channel, senderActor }
}

/** Create one active Team containing the exact two members of a direct v2 product channel. */
async function openedDirectV2Channel(ctx: Context) {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Return one final answer', budgets: {} }, rules: {}, budgets: {} })
  const sender = await activeParticipant(ctx, created.team.id, 'Coordinator')
  const recipient = await activeParticipant(ctx, created.team.id, 'Human')
  const state = await ctx.teams.getTeam({ teamId: created.team.id })
  let channel = await openTestChannel(ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    adapter: DIRECT_CHANNEL_ADAPTER_V2,
    participants: [{ id: sender.id, role: 'coordinator' }, { id: recipient.id, role: 'human' }],
    limits: {},
  })
  const senderActor = await activeActor(ctx, created.team.id, sender.id)
  channel = await consentChannelEndpoints(ctx, channel, [
    { participantId: sender.id, actor: senderActor },
    { participantId: recipient.id, actor: await activeActor(ctx, created.team.id, recipient.id) },
  ], (manifest) => { directChannelV2Adapter.validateCreate(manifest) })
  return { sender, recipient, channel, senderActor }
}

/** Create one active Team containing the exact two members of a direct v3 product channel. */
async function openedDirectV3Channel(ctx: Context) {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Review one image', budgets: {} }, rules: {}, budgets: {} })
  const sender = await activeParticipant(ctx, created.team.id, 'Human')
  const recipient = await activeParticipant(ctx, created.team.id, 'Coordinator')
  const state = await ctx.teams.getTeam({ teamId: created.team.id })
  let channel = await openTestChannel(ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    adapter: DIRECT_CHANNEL_ADAPTER_V3,
    participants: [{ id: sender.id, role: 'human' }, { id: recipient.id, role: 'coordinator' }],
    limits: {},
  })
  const senderActor = await activeActor(ctx, created.team.id, sender.id)
  channel = await consentChannelEndpoints(ctx, channel, [
    { participantId: sender.id, actor: senderActor },
    { participantId: recipient.id, actor: await activeActor(ctx, created.team.id, recipient.id) },
  ], (manifest) => { directChannelV3Adapter.validateCreate(manifest) })
  return { sender, recipient, channel, senderActor }
}

describe('direct channel adapter', () => {
  it('accepts two or more distinct members and rejects unsupported manifests', () => {
    expect(() => { directChannelAdapter.validateCreate(directManifest()) }).not.toThrow()
    expect(() => { directChannelAdapter.validateCreate(directManifest({ participants: [{ id: senderId, role: 'sender' }] })) })
      .toThrow(/at least two participants/)
    expect(() => { directChannelAdapter.validateCreate(directManifest({
      participants: [{ id: senderId, role: 'sender' }, { id: senderId, role: 'duplicate' }],
    })) }).toThrow(/must be distinct/)
    expect(() => { directChannelAdapter.validateCreate(directManifest({ adapter: { type: 'other', version: 1 } })) })
      .toThrow(/does not select direct version 1/)
    expect(() => { directChannelAdapter.validateCreate(directManifest({ adapter: { type: 'direct', version: 2 } })) })
      .toThrow(/does not select direct version 1/)
    expect(() => { directChannelAdapter.validateCreate(directManifest({ limits: { turns: 2 } })) })
      .toThrow(/does not accept adapter limits/)
  })

  it('allows only one explicit non-self recipient and one text-message payload', () => {
    const triad = directManifest({
      participants: [
        { id: senderId, role: 'sender' },
        { id: recipientId, role: 'recipient' },
        { id: thirdId, role: 'third' },
      ],
    })
    expect(() => { validateSend(directDraft()) }).not.toThrow()
    expect(() => { validateSend(directDraft({ audience: null })) }).toThrow(/exactly one explicit recipient/)
    expect(() => { validateSend(directDraft({ audience: [] })) }).toThrow(/exactly one explicit recipient/)
    expect(() => { validateSend(directDraft({ audience: [recipientId, thirdId] }), { manifest: triad }) })
      .toThrow(/exactly one explicit recipient/)
    expect(() => { validateSend(directDraft({ audience: [senderId] })) }).toThrow(/cannot be the sender/)
    expect(() => { validateSend(directDraft({ audience: [outsiderId] })) }).toThrow(/must be channel participants/)
    expect(() => { validateSend(directDraft(), { senderId: outsiderId }) }).toThrow(/must be channel participants/)
    expect(() => { validateSend(directDraft({ kind: 'notice' })) }).toThrow(/only message Envelopes/)
    expect(() => { validateSend(directDraft({ kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND })) }).toThrow(/only message Envelopes/)
    expect(() => { validateSend(directDraft({ payload: {} })) }).toThrow(/must contain only text/)
    expect(() => { validateSend(directDraft({ payload: { body: 'Review complete.' } })) }).toThrow(/must contain only text/)
    expect(() => { validateSend(directDraft({ payload: { text: 'Review complete.', extra: true } })) })
      .toThrow(/must contain only text/)
    expect(() => { validateSend({ ...directDraft(), payload: { text: 1 } }) })
      .toThrow(/must be a nonempty string/)
    expect(() => { validateSend(directDraft({ payload: { text: '' } })) }).toThrow(/must be a nonempty string/)
  })

  it('retains no fold state, adds no reply record, and derives one immutable delivery intent', () => {
    const manifest = directManifest()
    const envelope = directEnvelope()
    const record = recordEnvelope(envelope)
    const initial = directChannelAdapter.initialState(manifest)
    expect(initial).toBeNull()
    expect(directChannelAdapter.fold(initial, {
      type: 'channel/phase', sequence: 1, createdAt: 1, phase: 'active',
    } satisfies ChannelRecord)).toBeNull()
    expect(directChannelAdapter.afterAccept({ manifest, state: null, record })).toEqual([])
    expect(directChannelAdapter.expectedNext({ manifest, state: null })).toEqual({ kind: 'none' })
    expect(directChannelAdapter.projectView({ manifest, state: null, records: [record] })).toEqual({})

    const plan = directChannelAdapter.deliveryPlan({ manifest, state: null, envelope })
    expect(plan).toEqual([{ participantId: recipientId, envelopeId: envelope.id, delivery: 'turn' }])
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan[0])).toBe(true)
    expect(Object.isFrozen(directChannelAdapter.afterAccept({ manifest, state: null, record }))).toBe(true)
    expect(Object.isFrozen(directChannelAdapter.expectedNext({ manifest, state: null }))).toBe(true)
    expect(Object.isFrozen(directChannelAdapter.projectView({ manifest, state: null, records: [] }))).toBe(true)
  })

  it('rejects non-null fold state through every state-dependent operation', () => {
    const manifest = directManifest()
    const envelope = directEnvelope()
    const record = recordEnvelope(envelope)
    const invalid: JsonValue = {}
    expect(() => { directChannelAdapter.validateSend({ manifest, state: invalid, senderId, draft: directDraft() }) })
      .toThrow(/state must be null/)
    expect(() => { directChannelAdapter.fold(invalid, record) }).toThrow(/state must be null/)
    expect(() => { directChannelAdapter.afterAccept({ manifest, state: invalid, record }) }).toThrow(/state must be null/)
    expect(() => { directChannelAdapter.expectedNext({ manifest, state: invalid }) }).toThrow(/state must be null/)
    expect(() => { directChannelAdapter.deliveryPlan({ manifest, state: invalid, envelope }) }).toThrow(/state must be null/)
    expect(() => { directChannelAdapter.projectView({ manifest, state: invalid, records: [] }) }).toThrow(/state must be null/)
  })
})

describe('direct version-two product channel adapter', () => {
  it('parses exactly two distinct members and exposes their peer identities', () => {
    const manifest = directV2Manifest()
    const parsed = parseDirectChannelV2Manifest(manifest)
    expect(parsed).toEqual({ channelId, teamId, participantIds: [senderId, recipientId] })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.participantIds)).toBe(true)
    expect(DIRECT_CHANNEL_TYPE).toBe('direct')
    expect(DIRECT_CHANNEL_VERSION_V1).toBe(1)
    expect(DIRECT_CHANNEL_VERSION_V2).toBe(2)
    expect(DIRECT_CHANNEL_ADAPTER_V2).toEqual({ type: DIRECT_CHANNEL_TYPE, version: DIRECT_CHANNEL_VERSION_V2 })
    expect(directChannelV2Peer(manifest, senderId)).toBe(recipientId)
    expect(directChannelV2Peer(manifest, recipientId)).toBe(senderId)

    expect(() => parseDirectChannelV2Manifest(directV2Manifest({ adapter: { type: 'other', version: 2 } })))
      .toThrow(/does not select direct version 2/)
    expect(() => parseDirectChannelV2Manifest(directV2Manifest({ adapter: DIRECT_CHANNEL_ADAPTER_V1 })))
      .toThrow(/does not select direct version 2/)
    expect(() => parseDirectChannelV2Manifest(directV2Manifest({ participants: [{ id: senderId, role: 'sender' }] })))
      .toThrow(/exactly two participants/)
    expect(() => parseDirectChannelV2Manifest(directV2Manifest({
      participants: [
        { id: senderId, role: 'sender' },
        { id: recipientId, role: 'recipient' },
        { id: thirdId, role: 'third' },
      ],
    }))).toThrow(/exactly two participants/)
    expect(() => parseDirectChannelV2Manifest(directV2Manifest({
      participants: [{ id: senderId, role: 'sender' }, { id: senderId, role: 'duplicate' }],
    }))).toThrow(/must be distinct/)
    expect(() => parseDirectChannelV2Manifest(directV2Manifest({ limits: { turns: 1 } })))
      .toThrow(/does not accept adapter limits/)
    expect(() => directChannelV2Peer(manifest, outsiderId)).toThrow(/must be one of the two channel participants/)
  })

  it('accepts only direct text messages and final answers for one other member', () => {
    expect(() => { directChannelV2Adapter.validateCreate(directV2Manifest()) }).not.toThrow()
    expect(() => { validateV2Send(directDraft()) }).not.toThrow()
    expect(() => { validateV2Send(directDraft({ kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND })) }).not.toThrow()
    expect(() => { validateV2Send(directDraft({ audience: null })) }).toThrow(/exactly one explicit recipient/)
    expect(() => { validateV2Send(directDraft({ audience: [] })) }).toThrow(/exactly one explicit recipient/)
    expect(() => { validateV2Send(directDraft({ audience: [recipientId, thirdId] })) }).toThrow(/exactly one explicit recipient/)
    expect(() => { validateV2Send(directDraft({ audience: [senderId] })) }).toThrow(/cannot be the sender/)
    expect(() => { validateV2Send(directDraft({ audience: [outsiderId] })) }).toThrow(/must be channel participants/)
    expect(() => { validateV2Send(directDraft(), { senderId: outsiderId }) }).toThrow(/must be channel participants/)
    expect(() => { validateV2Send(directDraft({ kind: 'notice' })) }).toThrow(/message or final Envelopes/)
    expect(() => { validateV2Send(directDraft({ payload: {} })) }).toThrow(/message payload must contain only text/)
    expect(() => {
      validateV2Send(directDraft({ kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND, payload: { text: 'Done.', extra: true } }))
    }).toThrow(/final payload must contain only text/)
    expect(() => { validateV2Send({ ...directDraft(), payload: { text: 1 } }) })
      .toThrow(/message text must be a nonempty string/)
    expect(() => { validateV2Send(directDraft({ kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND, payload: { text: '' } })) })
      .toThrow(/final text must be a nonempty string/)
    expect(directChannelV2Adapter.prepareFinal?.({
      manifest: directV2Manifest(), state: null, senderId, text: 'Prepared v2 final.',
    })).toEqual({
      audience: [recipientId], kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND, payload: { text: 'Prepared v2 final.' }, delivery: 'turn',
    })
  })

  it('keeps no fold state or reply obligation while delivering text and final Envelopes', () => {
    const manifest = directV2Manifest()
    const envelope = directV2FinalEnvelope()
    const record = recordEnvelope(envelope)
    const initial = directChannelV2Adapter.initialState(manifest)
    expect(initial).toBeNull()
    expect(directChannelV2Adapter.fold(initial, {
      type: 'channel/phase', sequence: 1, createdAt: 1, phase: 'active',
    } satisfies ChannelRecord)).toBeNull()
    expect(directChannelV2Adapter.afterAccept({ manifest, state: null, record })).toEqual([])
    expect(directChannelV2Adapter.expectedNext({ manifest, state: null })).toEqual({ kind: 'none' })
    expect(directChannelV2Adapter.projectView({ manifest, state: null, records: [record] })).toEqual({})

    const plan = directChannelV2Adapter.deliveryPlan({ manifest, state: null, envelope })
    expect(plan).toEqual([{ participantId: recipientId, envelopeId: envelope.id, delivery: 'turn' }])
    expect(directChannelV2Adapter.deliveryPlan({ manifest, state: null, envelope: directEnvelope() }))
      .toEqual([{ participantId: recipientId, envelopeId: 'envelope-direct', delivery: 'turn' }])
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan[0])).toBe(true)
    expect(Object.isFrozen(directChannelV2Adapter.afterAccept({ manifest, state: null, record }))).toBe(true)
    expect(Object.isFrozen(directChannelV2Adapter.expectedNext({ manifest, state: null }))).toBe(true)
    expect(Object.isFrozen(directChannelV2Adapter.projectView({ manifest, state: null, records: [] }))).toBe(true)
  })

  it('rejects invalid v2 fold state through every state-dependent operation', () => {
    const manifest = directV2Manifest()
    const envelope = directV2FinalEnvelope()
    const record = recordEnvelope(envelope)
    const invalid: JsonValue = {}
    expect(() => { directChannelV2Adapter.validateSend({ manifest, state: invalid, senderId, draft: directDraft() }) })
      .toThrow(/state must be null/)
    expect(() => directChannelV2Adapter.fold(invalid, record)).toThrow(/state must be null/)
    expect(() => directChannelV2Adapter.afterAccept({ manifest, state: invalid, record })).toThrow(/state must be null/)
    expect(() => directChannelV2Adapter.expectedNext({ manifest, state: invalid })).toThrow(/state must be null/)
    expect(() => directChannelV2Adapter.deliveryPlan({ manifest, state: invalid, envelope })).toThrow(/state must be null/)
    expect(() => directChannelV2Adapter.projectView({ manifest, state: invalid, records: [] })).toThrow(/state must be null/)
    expect(() => directChannelV2Adapter.prepareFinal?.({ manifest, state: invalid, senderId, text: 'invalid state' }))
      .toThrow(/state must be null/)
  })
})

describe('direct version-three product channel adapter', () => {
  it('parses v3 and compatible product manifests while preserving exact peer identity', () => {
    const manifest = directV3Manifest()
    const parsed = parseDirectChannelV3Manifest(manifest)
    expect(parsed).toEqual({ channelId, teamId, participantIds: [senderId, recipientId] })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.participantIds)).toBe(true)
    expect(DIRECT_CHANNEL_VERSION_V3).toBe(3)
    expect(DIRECT_CHANNEL_ADAPTER_V3).toEqual({ type: DIRECT_CHANNEL_TYPE, version: DIRECT_CHANNEL_VERSION_V3 })
    expect(directChannelV3Peer(manifest, senderId)).toBe(recipientId)
    expect(directChannelV3Peer(manifest, recipientId)).toBe(senderId)
    expect(parseDirectProductChannelManifest(directV2Manifest())).toEqual({
      channelId, teamId, version: DIRECT_CHANNEL_VERSION_V2, participantIds: [senderId, recipientId],
    })
    expect(parseDirectProductChannelManifest(manifest)).toEqual({
      channelId, teamId, version: DIRECT_CHANNEL_VERSION_V3, participantIds: [senderId, recipientId],
    })
    expect(directProductChannelPeer(directV2Manifest(), senderId)).toBe(recipientId)
    expect(directProductChannelPeer(manifest, recipientId)).toBe(senderId)

    expect(() => parseDirectChannelV3Manifest(directV3Manifest({ adapter: { type: 'other', version: 3 } })))
      .toThrow(/does not select direct version 3/)
    expect(() => parseDirectChannelV3Manifest(directV3Manifest({ adapter: DIRECT_CHANNEL_ADAPTER_V2 })))
      .toThrow(/does not select direct version 3/)
    expect(() => parseDirectChannelV3Manifest(directV3Manifest({ participants: [{ id: senderId, role: 'sender' }] })))
      .toThrow(/exactly two participants/)
    expect(() => parseDirectChannelV3Manifest(directV3Manifest({
      participants: [{ id: senderId, role: 'sender' }, { id: senderId, role: 'duplicate' }],
    }))).toThrow(/must be distinct/)
    expect(() => parseDirectChannelV3Manifest(directV3Manifest({ limits: { turns: 1 } })))
      .toThrow(/does not accept adapter limits/)
    expect(() => parseDirectProductChannelManifest(directManifest())).toThrow(/does not select direct version 2, 3 or 4/)
    expect(() => directChannelV3Peer(manifest, outsiderId)).toThrow(/must be one of the two channel participants/)
    expect(() => directProductChannelPeer(manifest, outsiderId)).toThrow(/must be one of the two channel participants/)
  })

  it('parses only ordered human text and durable image references', () => {
    const payload = parseDirectChannelV3MessagePayload({
      content: [
        { type: 'text', text: 'Please inspect this.' },
        {
          type: 'image',
          attachment: imageReference({
            mediaType: 'image/jpeg',
            name: 'photo.jpg',
            originalDimensions: { width: 4, height: 3 },
          }),
        },
      ],
    })
    expect(payload).toEqual({
      content: [
        { type: 'text', text: 'Please inspect this.' },
        {
          type: 'image',
          attachment: imageReference({
            mediaType: 'image/jpeg',
            name: 'photo.jpg',
            originalDimensions: { width: 4, height: 3 },
          }),
        },
      ],
    })
    expect(Object.isFrozen(payload)).toBe(true)
    expect(Object.isFrozen(payload.content)).toBe(true)
    expect(Object.isFrozen(payload.content[0])).toBe(true)
    expect(Object.isFrozen(payload.content[1])).toBe(true)
    const image = payload.content[1]
    expect(image?.type).toBe('image')
    if (image?.type === 'image') {
      expect(Object.isFrozen(image.attachment)).toBe(true)
      expect(Object.isFrozen(image.attachment.originalDimensions)).toBe(true)
    }

    for (const mediaType of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(() => parseDirectChannelV3MessagePayload({
        content: [{ type: 'image', attachment: imageReference({ mediaType }) }],
      })).not.toThrow()
    }
    expect(() => parseDirectChannelV3MessagePayload({})).toThrow(/must contain only content/)
    expect(() => parseDirectChannelV3MessagePayload({ content: [], extra: true })).toThrow(/must contain only content/)
    expect(() => parseDirectChannelV3MessagePayload({ content: [] })).toThrow(/nonempty array/)
    expect(() => parseDirectChannelV3MessagePayload({ content: {} })).toThrow(/nonempty array/)
    expect(() => parseDirectChannelV3MessagePayload({ content: [null] })).toThrow(/only text or image blocks/)
    expect(() => parseDirectChannelV3MessagePayload({ content: [[]] })).toThrow(/only text or image blocks/)
    expect(() => parseDirectChannelV3MessagePayload({ content: [{ type: 'reasoning', text: 'hidden' }] }))
      .toThrow(/only text or image blocks/)
    expect(() => parseDirectChannelV3MessagePayload({ content: [{ type: 'tool-call', id: 'call', name: 'bash', arguments: '{}' }] }))
      .toThrow(/only text or image blocks/)
    expect(() => parseDirectChannelV3MessagePayload({ content: [{ type: 'text', text: 'x', extra: true }] }))
      .toThrow(/text block must contain only type and text/)
    expect(() => parseDirectChannelV3MessagePayload({ content: [{ type: 'text' }] })).toThrow(/text block must contain only type and text/)
    expect(() => parseDirectChannelV3MessagePayload({ content: [{ type: 'text', text: '' }] }))
      .toThrow(/text must be a nonempty string/)
    expect(() => parseDirectChannelV3MessagePayload({ content: [{ type: 'text', text: 1 }] })).toThrow(/text must be a nonempty string/)
  })

  it('rejects encoded bytes, non-image content, and malformed image references', () => {
    const image = (attachment: unknown) => ({ content: [{ type: 'image', attachment }] }) as JsonObject
    expect(() => parseDirectChannelV3MessagePayload({ content: [{ type: 'image', data: 'AQ==' }] }))
      .toThrow(/image block must contain only type and attachment/)
    expect(() => parseDirectChannelV3MessagePayload(image('AQ=='))).toThrow(/attachment must be an image reference/)
    expect(() => parseDirectChannelV3MessagePayload(image({ ...imageReference(), data: 'AQ==' }))).toThrow(/contains unsupported fields/)
    expect(() => parseDirectChannelV3MessagePayload(image({ mediaType: 'image/png' }))).toThrow(/contains unsupported fields/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({ attachmentId: '' })))).toThrow(/attachmentId must be a nonempty string/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({ attachmentId: 1 }))))
      .toThrow(/attachmentId must be a nonempty string/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({ mediaType: 'image/svg+xml' }))))
      .toThrow(/mediaType is unsupported/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({ bytes: 0 }))))
      .toThrow(/bytes must be a positive safe integer/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({ width: Number.MAX_SAFE_INTEGER + 1 }))))
      .toThrow(/width must be a positive safe integer/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({ height: '2' }))))
      .toThrow(/height must be a positive safe integer/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({ name: 1 })))).toThrow(/name must be a string/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({ originalDimensions: null }))))
      .toThrow(/originalDimensions must contain only width and height/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({ originalDimensions: { width: 2 } }))))
      .toThrow(/originalDimensions must contain only width and height/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({
      originalDimensions: { width: 2, height: 2, extra: true },
    })))).toThrow(/originalDimensions must contain only width and height/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({
      originalDimensions: { width: -1, height: 2 },
    })))).toThrow(/originalDimensions.width must be a positive safe integer/)
    expect(() => parseDirectChannelV3MessagePayload(image(imageReference({
      originalDimensions: { width: 2, height: 0 },
    })))).toThrow(/originalDimensions.height must be a positive safe integer/)
  })

  it('accepts v3 human messages and final answers only for the other exact member', () => {
    expect(() => { directChannelV3Adapter.validateCreate(directV3Manifest()) }).not.toThrow()
    expect(() => { validateV3Send(directV3MessageDraft()) }).not.toThrow()
    expect(() => { validateV3Send(directV3MessageDraft([{ type: 'image', attachment: imageReference() }])) }).not.toThrow()
    expect(() => { validateV3Send(directDraft({ kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND })) }).not.toThrow()
    expect(() => { validateV3Send(directV3MessageDraft([], { audience: null })) }).toThrow(/exactly one explicit recipient/)
    expect(() => { validateV3Send(directV3MessageDraft([], { audience: [senderId] })) }).toThrow(/cannot be the sender/)
    expect(() => { validateV3Send(directV3MessageDraft([], { audience: [outsiderId] })) }).toThrow(/must be channel participants/)
    expect(() => { validateV3Send(directV3MessageDraft(), { senderId: outsiderId }) }).toThrow(/must be channel participants/)
    expect(() => { validateV3Send(directDraft({ kind: 'notice', payload: { text: 'Unsupported.' } })) }).toThrow(/message or final Envelopes/)
    expect(() => { validateV3Send(directDraft({ kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND, payload: { content: [] } })) })
      .toThrow(/final payload must contain only text/)
    expect(() => { validateV3Send(directDraft({ kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND, payload: { text: '' } })) })
      .toThrow(/final text must be a nonempty string/)
    expect(directChannelV3Adapter.prepareFinal?.({
      manifest: directV3Manifest(), state: null, senderId: recipientId, text: 'Prepared v3 final.',
    })).toEqual({
      audience: [senderId], kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND, payload: { text: 'Prepared v3 final.' }, delivery: 'turn',
    })
  })

  it('keeps no fold state or reply obligation while delivering human messages and finals', () => {
    const manifest = directV3Manifest()
    const message = directV3MessageEnvelope()
    const final = directV3FinalEnvelope()
    const record = recordEnvelope(message)
    const initial = directChannelV3Adapter.initialState(manifest)
    expect(initial).toBeNull()
    expect(directChannelV3Adapter.fold(initial, {
      type: 'channel/phase', sequence: 1, createdAt: 1, phase: 'active',
    } satisfies ChannelRecord)).toBeNull()
    expect(directChannelV3Adapter.afterAccept({ manifest, state: null, record })).toEqual([])
    expect(directChannelV3Adapter.expectedNext({ manifest, state: null })).toEqual({ kind: 'none' })
    expect(directChannelV3Adapter.projectView({ manifest, state: null, records: [record] })).toEqual({})
    expect(directChannelV3Adapter.deliveryPlan({ manifest, state: null, envelope: message }))
      .toEqual([{ participantId: recipientId, envelopeId: message.id, delivery: 'turn' }])
    expect(directChannelV3Adapter.deliveryPlan({ manifest, state: null, envelope: final }))
      .toEqual([{ participantId: recipientId, envelopeId: final.id, delivery: 'turn' }])
  })

  it('rejects invalid v3 fold state through every state-dependent operation', () => {
    const manifest = directV3Manifest()
    const envelope = directV3MessageEnvelope()
    const record = recordEnvelope(envelope)
    const invalid: JsonValue = {}
    expect(() => { directChannelV3Adapter.validateSend({ manifest, state: invalid, senderId, draft: directV3MessageDraft() }) })
      .toThrow(/state must be null/)
    expect(() => directChannelV3Adapter.fold(invalid, record)).toThrow(/state must be null/)
    expect(() => directChannelV3Adapter.afterAccept({ manifest, state: invalid, record })).toThrow(/state must be null/)
    expect(() => directChannelV3Adapter.expectedNext({ manifest, state: invalid })).toThrow(/state must be null/)
    expect(() => directChannelV3Adapter.deliveryPlan({ manifest, state: invalid, envelope })).toThrow(/state must be null/)
    expect(() => directChannelV3Adapter.projectView({ manifest, state: invalid, records: [] })).toThrow(/state must be null/)
    expect(() => directChannelV3Adapter.prepareFinal?.({ manifest, state: invalid, senderId, text: 'invalid state' }))
      .toThrow(/state must be null/)
  })
})

describe('direct channel plugin composition', () => {
  it('projects bounded summaries with source ids and sequence provenance', () => {
    const first = directEnvelope({ id: envelopeIdSchema.parse('first'), sequence: 2, payload: { text: 'one' } })
    const second = directEnvelope({ id: envelopeIdSchema.parse('second'), sequence: 4, payload: { text: 'two' } })
    const records = [
      recordEnvelope(first),
      recordEnvelope(second),
      {
        type: 'channel/summary' as const,
        sequence: 5,
        createdAt: 5,
        coveredSequenceRange: { from: 2, to: 4 },
        sourceEnvelopeIds: [first.id, second.id],
        sourceFingerprint: fingerprintChannelSummarySources([first, second]),
        text: 'one and two',
        policy: { type: SUMMARIZED_WINDOW_VIEW_POLICY.type, version: SUMMARIZED_WINDOW_VIEW_POLICY.version },
        idempotencyKey: channelSummaryIdempotencyKeySchema.parse('summary-one'),
      },
    ] satisfies ChannelRecord[]
    expect(SUMMARIZED_WINDOW_VIEW_POLICY.project({ manifest: directManifest(), records })).toEqual({
      messages: [
        { id: 'summary-one', sequence: 4, kind: 'summary', summary: 'one and two' },
      ],
      sourceEnvelopeIds: [first.id, second.id],
      sourceFingerprint: fingerprintChannelSummarySources([first, second]),
      coveredSequenceRange: { from: 2, to: 4 },
      policy: { type: SUMMARIZED_WINDOW_VIEW_POLICY.type, version: SUMMARIZED_WINDOW_VIEW_POLICY.version },
    })
  })

  it('registers all direct versions on TeamRuntime and removes them with the contributing fiber', async () => {
    const harness = await setup()
    expect(harness.ctx.teams.listAdapters()).toEqual([
      DIRECT_CHANNEL_ADAPTER_V1,
      DIRECT_CHANNEL_ADAPTER_V2,
      DIRECT_CHANNEL_ADAPTER_V3,
      DIRECT_CHANNEL_ADAPTER_V4,
    ])
    await harness.directFiber.dispose()
    expect(() => harness.ctx.teams.getAdapter(DIRECT_CHANNEL_ADAPTER_V1))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ADAPTER_NOT_FOUND' }))
    expect(() => harness.ctx.teams.getAdapter(DIRECT_CHANNEL_ADAPTER_V2))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ADAPTER_NOT_FOUND' }))
    expect(() => harness.ctx.teams.getAdapter(DIRECT_CHANNEL_ADAPTER_V3))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ADAPTER_NOT_FOUND' }))
    expect(() => harness.ctx.teams.getAdapter(DIRECT_CHANNEL_ADAPTER_V4))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ADAPTER_NOT_FOUND' }))
    await harness.ctx.fiber.dispose()
  })

  it('commits one direct Envelope with no automatic reply and exposes one recipient delivery intent', async () => {
    const harness = await setup()
    try {
      const { recipient, channel, senderActor } = await openedDirectChannel(harness.ctx)
      const envelope = await harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: 'message',
          payload: { text: 'The review is complete.' },
          delivery: 'turn',
        },
      })
      const records = await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(records.records.map(record => record.type)).toEqual(['channel/opened', 'channel/phase', 'channel/invitation', 'channel/invitation',
        'channel/acknowledged', 'channel/acknowledged', 'channel/phase', 'channel/envelope'])
      expect(harness.ctx.teams.getAdapter(DIRECT_CHANNEL_ADAPTER_V1).deliveryPlan({
        manifest: channel.manifest,
        state: null,
        envelope,
      })).toEqual([{ participantId: recipient.id, envelopeId: envelope.id, delivery: 'turn' }])

      await expect(harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: envelope.sequence,
        draft: {
          channelId: channel.manifest.id,
          audience: null,
          kind: 'message',
          payload: { text: 'Broadcast is not direct.' },
          delivery: 'turn',
        },
      })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_ADAPTER_REJECTED' })
      const unchanged = await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(unchanged.records.map(record => record.type)).toEqual(['channel/opened', 'channel/phase', 'channel/invitation', 'channel/invitation',
        'channel/acknowledged', 'channel/acknowledged', 'channel/phase', 'channel/envelope'])
    } finally {
      await harness.ctx.fiber.dispose()
    }
  })

  it('projects a full summarized view when a later read starts after an earlier cursor', async () => {
    const harness = await setup()
    try {
      const { recipient, channel, senderActor } = await openedDirectChannel(harness.ctx, {
        type: SUMMARIZED_WINDOW_VIEW_POLICY.type,
        version: SUMMARIZED_WINDOW_VIEW_POLICY.version,
      })
      const first = await harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
          payload: { text: 'first durable message' },
          delivery: 'context',
        },
      })
      const second = await harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: first.sequence,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
          payload: { text: 'second durable message' },
          delivery: 'context',
        },
      })
      const summary = await summarizeTestChannel(harness.ctx, {
        requester: senderActor,
        channelId: channel.manifest.id,
        expectedCursor: second.sequence,
        coveredSequenceRange: { from: first.sequence, to: second.sequence },
        sourceEnvelopeIds: [first.id, second.id],
        sourceFingerprint: fingerprintChannelSummarySources([first, second]),
        text: 'first and second durable messages',
        policy: { type: SUMMARIZED_WINDOW_VIEW_POLICY.type, version: SUMMARIZED_WINDOW_VIEW_POLICY.version },
        idempotencyKey: channelSummaryIdempotencyKeySchema.parse('direct-summary'),
      })
      expect(summary).toMatchObject({ type: 'channel/summary', sourceEnvelopeIds: [first.id, second.id] })
      const read = await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: first.sequence })
      expect(read.records).toHaveLength(2)
      expect(read.view).toMatchObject({
        sourceEnvelopeIds: [first.id, second.id],
        sourceFingerprint: fingerprintChannelSummarySources([first, second]),
        coveredSequenceRange: { from: first.sequence, to: second.sequence },
        policy: { type: SUMMARIZED_WINDOW_VIEW_POLICY.type, version: SUMMARIZED_WINDOW_VIEW_POLICY.version },
      })
    } finally {
      await harness.ctx.fiber.dispose()
    }
  })

  it('commits v2 text and final Envelopes for the other product participant without a reply record', async () => {
    const harness = await setup()
    try {
      const { recipient, channel, senderActor } = await openedDirectV2Channel(harness.ctx)
      const message = await harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
          payload: { text: 'The work is ready for review.' },
          delivery: 'turn',
        },
      })
      const final = await harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: message.sequence,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
          payload: { text: 'The requested work is complete.' },
          delivery: 'turn',
        },
      })
      const records = await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(records.records.map(record => record.type)).toEqual([
        'channel/opened', 'channel/phase', 'channel/invitation', 'channel/invitation',
        'channel/acknowledged', 'channel/acknowledged', 'channel/phase', 'channel/envelope', 'channel/envelope',
      ])
      expect(harness.ctx.teams.getAdapter(DIRECT_CHANNEL_ADAPTER_V2).deliveryPlan({
        manifest: channel.manifest,
        state: null,
        envelope: final,
      })).toEqual([{ participantId: recipient.id, envelopeId: final.id, delivery: 'turn' }])

      await expect(harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: final.sequence,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: 'notice',
          payload: { text: 'Unsupported.' },
          delivery: 'turn',
        },
      })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_ADAPTER_REJECTED' })
      const unchanged = await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(unchanged.records.map(record => record.type)).toEqual([
        'channel/opened', 'channel/phase', 'channel/invitation', 'channel/invitation',
        'channel/acknowledged', 'channel/acknowledged', 'channel/phase', 'channel/envelope', 'channel/envelope',
      ])
    } finally {
      await harness.ctx.fiber.dispose()
    }
  })

  it('commits v3 human text and image references with a text-only final Envelope', async () => {
    const harness = await setup()
    try {
      const { recipient, channel, senderActor } = await openedDirectV3Channel(harness.ctx)
      const message = await harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
          payload: {
            content: [
              { type: 'text', text: 'Inspect this image.' },
              { type: 'image', attachment: imageReference() },
            ],
          },
          delivery: 'turn',
        },
      })
      const final = await harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: message.sequence,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
          payload: { text: 'Image review is complete.' },
          delivery: 'turn',
        },
      })
      const records = await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(records.records.map(record => record.type)).toEqual([
        'channel/opened', 'channel/phase', 'channel/invitation', 'channel/invitation',
        'channel/acknowledged', 'channel/acknowledged', 'channel/phase', 'channel/envelope', 'channel/envelope',
      ])
      expect(harness.ctx.teams.getAdapter(DIRECT_CHANNEL_ADAPTER_V3).deliveryPlan({
        manifest: channel.manifest,
        state: null,
        envelope: final,
      })).toEqual([{ participantId: recipient.id, envelopeId: final.id, delivery: 'turn' }])

      await expect(harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: final.sequence,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
          payload: { content: [{ type: 'image', data: 'AQ==' }] },
          delivery: 'turn',
        },
      })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_ADAPTER_REJECTED' })
    } finally {
      await harness.ctx.fiber.dispose()
    }
  })
})
