/** Human channel reads bind each selected record to a current authenticated principal. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { consultChannelAdapter, discussionChannelAdapter } from '../../team-channel-basic/src/index.ts'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import { channelInvitationIdempotencyKeySchema, fingerprintTeamHumanActorPayload, jsonObjectSchema, jsonValueSchema,
  participantIdSchema, envelopeIdSchema } from '@clocky/clocky-team'
import type { JsonObject, TeamChannelAdapter, TeamHumanActorProof, TeamHumanActorProofInput,
  TeamHumanActorScope } from '@clocky/clocky-team'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { closeTestChannel, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { postActor } from './fixtures.ts'
import TeamHub from '../src/index.ts'

const roots: string[] = []
const contexts = new Set<Context>()
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function setup(backend: 'json' | 'sqlite', maxSelectionBytes?: number, registerBasic = true) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'human-channel-read-'))
  roots.push(root)
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, { maxEnvelopeBytes: 1024, maxChannelViewBytes: 18432,
    ...maxSelectionBytes === undefined ? {} : { maxSelectionBytes } })
  await ctx.plugin(Direct)
  if (registerBasic) {
    ctx.teams.registerAdapter(consultChannelAdapter)
    ctx.teams.registerAdapter(discussionChannelAdapter)
  }
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Read a selected human channel.', budgets: {} },
    rules: {}, budgets: {} })
  const teamId = created.team.id
  const members = []
  for (const role of ['human', 'coordinator'] as const) {
    const member = await inviteBootstrapParticipant(ctx, { teamId,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: role === 'human' ? 'human' : 'local-agent', role, displayName: role, capabilities: [],
      ...role === 'human' ? { owner: { kind: 'product-principal' as const,
        principalId: productPrincipalId('human-channel-reader') } } : {} })
    for (const phase of ['provisioning', 'active'] as const) await transitionBootstrapParticipant(ctx, {
      teamId, participantId: member.id, phase, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    })
    members.push(member)
  }
  const [human, coordinator] = members
  if (human === undefined || coordinator === undefined) throw new Error('Human channel fixture needs two members')
  const coordinatorActor = await postActor(ctx, teamId, coordinator.id)
  const channel = await openTestChannel(ctx, { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    adapter: { type: 'direct', version: 4 }, participants: members.map(member => ({ id: member.id, role: member.role })), limits: {} })
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  ctx.teams.registerHumanActorProofSource({ name: 'human-channel-reader', resolveHumanActorProof: proof => scopes.get(proof) })
  const issue = (operation: TeamHumanActorProofInput['operation'], payload: JsonObject,
    fence: TeamHumanActorProofInput['fence'] = { kind: 'read' }): TeamHumanActorProof => {
    const proof = Object.freeze({}) as TeamHumanActorProof
    const bound: TeamHumanActorProofInput = { teamId, operation, fence, payload }
    scopes.set(proof, { teamId, participantId: human.id, operation, fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
    return proof
  }
  return { ctx, teamId, human, coordinator, coordinatorActor, channel, issue, scopes }
}

it.each(['json', 'sqlite'] as const)('reads one human invitation, channel status, and exact retained Envelope (%s)', async (backend) => {
  const f = await setup(backend)
  const channelId = f.channel.manifest.id
  expect(await f.ctx.teams.getChannelOwner({ channelId })).toEqual({ channelId, teamId: f.teamId })
  const invitationInput = { channelId }
  const humanInvitation = await f.ctx.teams.getHumanChannelInvitation({ ...invitationInput,
    actor: f.issue('channel-invitation-read', jsonObjectSchema.parse(invitationInput)) })
  expect(humanInvitation.invitation).toMatchObject({ participantId: f.human.id, status: 'pending' })
  const admissionInput = { teamId: f.teamId, channelId }
  const pending = await f.ctx.teams.getHumanChannelAdmission({ ...admissionInput,
    actor: f.issue('channel-admission-read', jsonObjectSchema.parse(admissionInput)) })
  expect(pending.channel.phase).toBe('pending')
  expect(pending.protocolStatus).toEqual({ kind: 'other' })

  const admission = await f.ctx.teams.getChannelAdmission({ channelId })
  for (const invitation of admission.invitations) {
    const input = { channelId, revision: invitation.revision,
      manifestFingerprint: invitation.manifestFingerprint,
      idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`human-channel-consent:${invitation.participantId}`) }
    const actor = invitation.participantId === f.human.id
      ? f.issue('channel-open', jsonObjectSchema.parse(input), { kind: 'revision', revision: input.revision })
      : f.coordinatorActor
    await f.ctx.teams.acknowledgeChannelInvitation({ ...input, actor })
  }
  const active = await f.ctx.teams.getHumanChannelAdmission({ ...admissionInput,
    actor: f.issue('channel-admission-read', jsonObjectSchema.parse(admissionInput)) })
  expect(active.channel.phase).toBe('active')
  const posted = await f.ctx.teams.postChannelEnvelope({ actor: f.coordinatorActor,
    expectedCursor: active.channel.cursor,
    draft: { channelId, audience: [f.human.id], kind: 'message',
      payload: { content: [{ type: 'text', text: 'Visible to the human.' }] }, delivery: 'context' } })
  const envelopeInput = { teamId: f.teamId, channelId, envelopeId: posted.id, envelopeSequence: posted.sequence }
  const received = await f.ctx.teams.getHumanChannelEnvelope({ ...envelopeInput,
    actor: f.issue('channel-content-read', jsonObjectSchema.parse(envelopeInput)) })
  expect(received).toEqual(posted)
  const stream = f.ctx.storageLog.get(`channel/${channelId}`)
  if (stream === undefined) throw new Error('Fixture channel WAL is not retained')
  const compacted = vi.spyOn(stream, 'firstSequence', 'get').mockReturnValue(posted.sequence + 1)
  try {
    await expect(f.ctx.teams.getHumanChannelEnvelope({ ...envelopeInput,
      actor: f.issue('channel-content-read', jsonObjectSchema.parse(envelopeInput)) }))
      .rejects.toMatchObject({ code: 'TEAM_CHANNEL_ENVELOPE_NOT_FOUND' })
  } finally { compacted.mockRestore() }
  const row = (await stream.read(posted.sequence - 1, 1))[0]
  if (row === undefined || typeof row.value !== 'object' || row.value === null || Array.isArray(row.value)) {
    throw new Error('Fixture WAL omitted its Envelope row')
  }
  const corrupted = vi.spyOn(stream, 'read').mockResolvedValueOnce([{ ...row,
    value: jsonValueSchema.parse({ ...row.value, envelope: { ...posted, sequence: posted.sequence + 1 } }) }])
  try {
    await expect(f.ctx.teams.getHumanChannelEnvelope({ ...envelopeInput,
      actor: f.issue('channel-content-read', jsonObjectSchema.parse(envelopeInput)) }))
      .rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
  } finally { corrupted.mockRestore() }
  await expect(f.ctx.teams.getHumanChannelEnvelope({ ...envelopeInput, envelopeSequence: posted.sequence + 1,
    actor: f.issue('channel-content-read', jsonObjectSchema.parse({ ...envelopeInput, envelopeSequence: posted.sequence + 1 })) }))
    .rejects.toMatchObject({ code: 'TEAM_CHANNEL_ENVELOPE_NOT_FOUND' })
  await expect(f.ctx.teams.getHumanChannelInvitation({ channelId, actor: Object.freeze({}) as TeamHumanActorProof }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  const coordinatorProof = f.issue('channel-invitation-read', jsonObjectSchema.parse(invitationInput))
  const coordinatorScope = f.scopes.get(coordinatorProof)
  if (coordinatorScope === undefined) throw new Error('Fixture did not retain its proof scope')
  f.scopes.set(coordinatorProof, { ...coordinatorScope, participantId: f.coordinator.id })
  await expect(f.ctx.teams.getHumanChannelInvitation({ channelId, actor: coordinatorProof }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})

it.each(['consult', 'discussion'] as const)('returns bounded %s protocol status without exposing adapter state', async (type) => {
  const f = await setup('json')
  const participants = [{ id: f.human.id, role: 'initiator' }, { id: f.coordinator.id, role: 'respondent' }]
  const channel = await openTestChannel(f.ctx, { teamId: f.teamId,
    expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
    adapter: { type, version: 1 }, viewPolicy: { type: Direct.FULL_TRANSCRIPT_VIEW_POLICY.type,
      version: Direct.FULL_TRANSCRIPT_VIEW_POLICY.version }, participants,
    limits: type === 'consult' ? {} : { maxTurns: 3, speakerPolicy: 'free-form' } })
  const input = { teamId: f.teamId, channelId: channel.manifest.id }
  const admission = await f.ctx.teams.getHumanChannelAdmission({ ...input,
    actor: f.issue('channel-admission-read', jsonObjectSchema.parse(input)) })
  if (type === 'consult') expect(admission.protocolStatus).toEqual({ kind: 'consult', phase: 'request' })
  else expect(admission.protocolStatus).toEqual({ kind: 'discussion', turnCount: 0, maxTurns: 3, speakerPolicy: 'free-form' })
  expect(JSON.stringify(admission)).not.toContain('human-channel-reader')
})

it('rejects an authenticated human close after the channel has already settled', async () => {
  const f = await setup('json')
  const channelId = f.channel.manifest.id
  const closed = await closeTestChannel(f.ctx, { channelId, expectedCursor: f.channel.cursor,
    reason: 'The channel owner completed the exchange.' })
  const input = { channelId, expectedCursor: closed.cursor }
  await expect(f.ctx.teams.closeChannel({ ...input,
    actor: f.issue('close', jsonObjectSchema.parse(input), { kind: 'cursor', cursor: input.expectedCursor }) }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect((await f.ctx.teams.getChannel({ channelId })).phase).toBe('closed')
})

it('bounds the attached channel owner tuple before returning it', async () => {
  const f = await setup('json', 32)
  await expect(f.ctx.teams.getChannelOwner({ channelId: f.channel.manifest.id }))
    .rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
})

it('rejects a channel adapter that nominates someone outside its immutable roster', async () => {
  const f = await setup('json')
  const adapter: TeamChannelAdapter = { type: 'foreign-next', version: 1,
    validateCreate() {}, initialState() { return null }, validateSend() {}, fold(state) { return state },
    afterAccept() { return [] }, deliveryPlan() { return [] }, projectView() { return {} },
    expectedNext() { return { kind: 'participant', participantId: participantIdSchema.parse('foreign-next-member') } },
  }
  f.ctx.teams.registerAdapter(adapter)
  const channel = await openTestChannel(f.ctx, { teamId: f.teamId,
    expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
    adapter: { type: adapter.type, version: adapter.version },
    participants: [{ id: f.human.id, role: 'human' }, { id: f.coordinator.id, role: 'coordinator' }], limits: {} })
  const input = { teamId: f.teamId, channelId: channel.manifest.id }
  await expect(f.ctx.teams.getHumanChannelAdmission({ ...input,
    actor: f.issue('channel-admission-read', jsonObjectSchema.parse(input)) }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
})

it('does not let an active human send before acknowledging an optional channel invitation', async () => {
  const f = await setup('json')
  const opened = await openTestChannel(f.ctx, { teamId: f.teamId,
    expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
    adapter: { type: 'direct', version: 4 },
    participants: [{ id: f.human.id, role: 'human' }, { id: f.coordinator.id, role: 'coordinator' }],
    invitations: [{ participantId: f.human.id, required: false }, { participantId: f.coordinator.id, required: true }],
    limits: {} })
  const channelId = opened.manifest.id
  const invitation = (await f.ctx.teams.getChannelAdmission({ channelId })).invitations
    .find(value => value.participantId === f.coordinator.id)
  if (invitation === undefined) throw new Error('Fixture channel has no coordinator invitation')
  await f.ctx.teams.acknowledgeChannelInvitation({ actor: f.coordinatorActor, channelId,
    revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint,
    idempotencyKey: channelInvitationIdempotencyKeySchema.parse('coordinator-consent') })
  const active = await f.ctx.teams.getChannel({ channelId })
  expect(active.phase).toBe('active')
  const input = { expectedCursor: active.cursor, draft: { channelId, audience: [f.coordinator.id],
    kind: 'message' as const, payload: { content: [{ type: 'text', text: 'Unacknowledged human message.' }] },
    delivery: 'context' as const } }
  await expect(f.ctx.teams.postChannelEnvelope({ ...input,
    actor: f.issue('send', jsonObjectSchema.parse(input), { kind: 'cursor', cursor: input.expectedCursor }) }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  expect((await f.ctx.teams.getChannel({ channelId })).cursor).toBe(active.cursor)
})

it('rejects a human member as a soft interrupt target before any durable request', async () => {
  const f = await setup('json')
  const input = { teamId: f.teamId, expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
    participantId: f.human.id }
  const before = await f.ctx.teams.getTeam({ teamId: f.teamId })
  await expect(f.ctx.teams.requestParticipantInterrupt({ ...input,
    actor: f.issue('interrupt', jsonObjectSchema.parse(input), { kind: 'cursor', cursor: input.expectedCursor }) }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  expect(await f.ctx.teams.getTeam({ teamId: f.teamId })).toEqual(before)
})

it('fails closed when a human proof source throws during interrupt admission', async () => {
  const f = await setup('json')
  const failure = new Error('human proof source unavailable')
  f.ctx.teams.registerHumanActorProofSource({ name: 'broken-human-proof-source',
    resolveHumanActorProof() { throw failure } })
  const input = { teamId: f.teamId, expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
    participantId: f.coordinator.id }
  await expect(f.ctx.teams.requestParticipantInterrupt({ ...input,
    actor: Object.freeze({}) as TeamHumanActorProof }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})

it('invalidates a cached channel after an external writer appends malformed WAL data', async () => {
  const f = await setup('json')
  const channelId = f.channel.manifest.id
  const stream = f.ctx.storageLog.get(`channel/${channelId}`)
  if (stream === undefined) throw new Error('Fixture channel WAL is not retained')
  const close = vi.spyOn(stream, 'close')
  await stream.append(stream.tailSequence, [jsonValueSchema.parse({ type: 'unknown-external-channel-record' })])
  await expect(f.ctx.teams.getChannel({ channelId })).rejects.toThrow()
  expect(close).toHaveBeenCalledOnce()
  const open = vi.spyOn(f.ctx.storageLog, 'open')
  await expect(f.ctx.teams.getChannel({ channelId })).rejects.toThrow()
  expect(open.mock.calls.some(([descriptor]) => descriptor.name === `channel/${channelId}`)).toBe(true)
})

it('hides a channel selected through a different Team identity', async () => {
  const f = await setup('json')
  const foreign = await createTestRootTeam(f.ctx, { goal: { objective: 'Another independent Team.', budgets: {} },
    rules: {}, budgets: {} })
  const input = { teamId: foreign.team.id, channelId: f.channel.manifest.id }
  await expect(f.ctx.teams.getHumanChannelAdmission({ ...input,
    actor: f.issue('channel-admission-read', jsonObjectSchema.parse(input)) }))
    .rejects.toMatchObject({ code: 'TEAM_CHANNEL_NOT_FOUND' })
  const envelopeInput = { ...input, envelopeId: envelopeIdSchema.parse('selected-envelope'), envelopeSequence: 0 }
  await expect(f.ctx.teams.getHumanChannelEnvelope({ ...envelopeInput,
    actor: f.issue('channel-content-read', jsonObjectSchema.parse(envelopeInput)) }))
    .rejects.toMatchObject({ code: 'TEAM_CHANNEL_NOT_FOUND' })
})

it('refuses a consult adapter state that claims a missing durable request', async () => {
  const f = await setup('json', undefined, false)
  const adapter: TeamChannelAdapter = { type: 'consult', version: 1,
    validateCreate() {}, initialState() { return { phase: 'response', requestId: 'missing-request' } },
    validateSend() {}, fold(state) { return state }, afterAccept() { return [] },
    deliveryPlan() { return [] }, projectView() { return {} }, expectedNext() { return { kind: 'none' } },
  }
  f.ctx.teams.registerAdapter(adapter)
  const channel = await openTestChannel(f.ctx, { teamId: f.teamId,
    expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
    adapter: { type: adapter.type, version: adapter.version },
    viewPolicy: { type: Direct.FULL_TRANSCRIPT_VIEW_POLICY.type, version: Direct.FULL_TRANSCRIPT_VIEW_POLICY.version },
    participants: [{ id: f.human.id, role: 'initiator' }, { id: f.coordinator.id, role: 'respondent' }], limits: {} })
  const input = { teamId: f.teamId, channelId: channel.manifest.id }
  await expect(f.ctx.teams.getHumanChannelAdmission({ ...input,
    actor: f.issue('channel-admission-read', jsonObjectSchema.parse(input)) }))
    .rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
})

it('refuses a consult adapter state that points to a non-request Envelope', async () => {
  const f = await setup('json', undefined, false)
  const adapter: TeamChannelAdapter = { type: 'consult', version: 1,
    validateCreate() {}, initialState() { return { phase: 'request' } }, validateSend() {},
    fold(state, record) { return record.type === 'channel/envelope'
      ? { phase: 'response', requestId: record.envelope.id } : state },
    afterAccept() { return [] }, deliveryPlan() { return [] }, projectView() { return {} },
    expectedNext() { return { kind: 'none' } },
  }
  f.ctx.teams.registerAdapter(adapter)
  const opened = await openTestChannel(f.ctx, { teamId: f.teamId,
    expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
    adapter: { type: adapter.type, version: adapter.version },
    viewPolicy: { type: Direct.FULL_TRANSCRIPT_VIEW_POLICY.type, version: Direct.FULL_TRANSCRIPT_VIEW_POLICY.version },
    participants: [{ id: f.human.id, role: 'initiator' }, { id: f.coordinator.id, role: 'respondent' }], limits: {} })
  const channelId = opened.manifest.id
  for (const invitation of (await f.ctx.teams.getChannelAdmission({ channelId })).invitations) {
    const input = { channelId, revision: invitation.revision,
      manifestFingerprint: invitation.manifestFingerprint,
      idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`malformed-consent:${invitation.participantId}`) }
    const actor = invitation.participantId === f.human.id
      ? f.issue('channel-open', jsonObjectSchema.parse(input), { kind: 'revision', revision: input.revision })
      : f.coordinatorActor
    await f.ctx.teams.acknowledgeChannelInvitation({ ...input, actor })
  }
  const active = await f.ctx.teams.getChannel({ channelId })
  await f.ctx.teams.postChannelEnvelope({ actor: f.coordinatorActor, expectedCursor: active.cursor,
    draft: { channelId, audience: [f.human.id], kind: 'message', payload: { text: 'Wrong consult kind.' }, delivery: 'turn' } })
  const input = { teamId: f.teamId, channelId }
  await expect(f.ctx.teams.getHumanChannelAdmission({ ...input,
    actor: f.issue('channel-admission-read', jsonObjectSchema.parse(input)) }))
    .rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
})
