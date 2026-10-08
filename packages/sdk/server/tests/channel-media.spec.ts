/** SDK media calls authorize the exact channel before image storage or byte disclosure. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AttachmentLocal from '@clocky/clocky-attachment-local'
import { channelHumanAdmissionSnapshotSchema, envelopeIdSchema, teamTaskIdSchema,
  type ChannelProtocolStatus, channelSnapshotSchema, channelHumanInvitationSnapshotSchema, teamEnvelopeSchema, fingerprintChannelManifest,
  TeamError, type TeamEnvelope, type TeamHumanActorProof, type TeamHumanActorProofInput, type ChannelEnvelopePostRequest } from '@clocky/clocky-team'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { TeamChannelInvitationResult } from '@clocky/clocky-sdk-protocol'
import { HarnessSdkJsonRpcServer } from '../src/index.ts'
import { SDK_TEST_CREDENTIAL, testProductPrincipals } from './product-auth.ts'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function setup(version: 2 | 3 | 4 = 4) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/sdk-channel-media-'))
  cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
  const storage = new Context()
  await storage.plugin(AttachmentLocal, { clockyHome: root })
  cleanup.push(async () => { await storage.fiber.dispose() })
  let channel = channelSnapshotSchema.parse({ manifest: { id: 'media-channel', teamId: 'media-team',
    adapter: { type: 'direct', version }, participants: [{ id: 'human', role: 'human' }, { id: 'peer', role: 'coordinator' }], limits: {} },
  phase: 'active', cursor: 7 })
  let protocolStatus: ChannelProtocolStatus = { kind: 'other' }
  let revoked = false
  const mounted = { teams: true, humanActors: true, attachments: true }
  const actor = Object.freeze({}) as TeamHumanActorProof
  const scopes: TeamHumanActorProofInput[] = []
  const envelopes = new Map<string, TeamEnvelope>()
  const humanActors = { async withProof<T>(call: AuthenticatedProductCall, input: TeamHumanActorProofInput,
    operation: (proof: TeamHumanActorProof) => Promise<T>): Promise<T> {
    call.signal.throwIfAborted()
    if (revoked || input.teamId !== 'media-team') throw new TeamError('Current membership is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
    scopes.push(input)
    return await operation(actor)
  } }
  const teams = {
    getChannel: vi.fn(async () => channel),
    getHumanChannelInvitation: vi.fn(async () => channelHumanInvitationSnapshotSchema.parse({ channel, invitation: {
      participantId: 'human', role: channel.manifest.participants.find(member => member.id === 'human')!.role,
      visibility: 'channel', required: true, deadline: 100,
      endpoint: { kind: 'human' }, revision: 1, manifestFingerprint: fingerprintChannelManifest(channel.manifest),
      status: channel.phase === 'pending' ? 'pending' : 'acknowledged',
      ...channel.phase === 'pending' ? {} : { acknowledgementKey: 'consent', settledAt: 1 },
    } })),
    acknowledgeChannelInvitation: vi.fn(async () => {
      channel = { ...channel, phase: 'active' }
      const own = await teams.getHumanChannelInvitation()
      return { channel, invitations: [own.invitation] }
    }),
    getHumanChannelAdmission: vi.fn(async () => channelHumanAdmissionSnapshotSchema.parse({ channel, invitations: [], protocolStatus,
      expectedNext: protocolStatus.kind === 'discussion' ? { kind: 'none' } : { kind: 'participant', participantId: 'human' } })),
    postChannelEnvelope: vi.fn(async (request: ChannelEnvelopePostRequest) => {
      expect(request.actor).toBe(actor)
      if (revoked) throw new TeamError('Send membership revoked', 'TEAM_ACTOR_PROOF_INVALID')
      const prior = envelopes.get('media-envelope')
      if (prior !== undefined) {
        expect(isDeepStrictEqual(prior.payload, request.draft.payload)).toBe(true)
        return prior
      }
      const envelope = teamEnvelopeSchema.parse({ ...request.draft, id: 'media-envelope', teamId: 'media-team',
        senderId: 'human', sequence: 8, priority: 'normal', createdAt: 2 })
      envelopes.set(envelope.id, envelope)
      channel = { ...channel, cursor: 8 }
      return envelope
    }),
    getHumanChannelEnvelope: vi.fn(async (input: {
      actor: TeamHumanActorProof
      teamId: string
      channelId: string
      envelopeId: string
      envelopeSequence: number
    }) => {
      expect(input.actor).toBe(actor)
      if (revoked || input.teamId !== 'media-team' || input.channelId !== 'media-channel') {
        throw new TeamError('Envelope membership denied', 'TEAM_ACTOR_PROOF_INVALID')
      }
      const envelope = envelopes.get(input.envelopeId)
      if (envelope === undefined || envelope.sequence !== input.envelopeSequence) throw new TeamError('Envelope not retained', 'TEAM_CHANNEL_ENVELOPE_NOT_FOUND')
      return envelope
    }),
  }
  const ctx = { on: vi.fn(() => () => undefined), agents: { create: vi.fn(), get: vi.fn() }, teamRuns: {},
    get: (name: string) => name === 'productPrincipals' ? testProductPrincipals() : name === 'teamHumanActors' ? mounted.humanActors ? humanActors : undefined
      : name === 'teams' ? mounted.teams ? teams : undefined : name === 'attachments' ? mounted.attachments ? storage.attachments : undefined
        : { listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }] },
  } as unknown as Context
  const server = new HarnessSdkJsonRpcServer(ctx, { async request() { throw new Error('Unexpected host request') }, notify() {} })
  cleanup.push(async () => { await server.shutdown() })
  await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
  return { server, storage, teams, scopes, revoke: () => { revoked = true }, pending: () => { channel = { ...channel, phase: 'pending' } },
    close: () => { channel = { ...channel, phase: 'closed' } },
    mount: (name: keyof typeof mounted, available: boolean) => { mounted[name] = available },
    basic(kind: 'request' | 'response' | 'review' | 'discussion') {
      const discussion = kind === 'discussion'
      channel = { ...channel, manifest: { ...channel.manifest, adapter: { type: discussion ? 'discussion' : 'consult', version: 1 },
        participants: [{ id: channel.manifest.participants[0]!.id, role: discussion ? 'speaker' : kind === 'request' ? 'initiator' : 'respondent' },
          { id: channel.manifest.participants[1]!.id, role: discussion ? 'speaker' : kind === 'request' ? 'respondent' : 'initiator' }],
        limits: discussion ? { maxTurns: 2, speakerPolicy: 'free-form' } : {} } }
      protocolStatus = discussion ? { kind: 'discussion', turnCount: 0, maxTurns: 2, speakerPolicy: 'free-form' }
        : { kind: 'consult', phase: kind === 'request' ? 'request' : 'response',
          ...kind === 'request' ? {} : { request: { teamId: channel.manifest.teamId, channelId: channel.manifest.id,
            envelopeId: envelopeIdSchema.parse('basic-request'), envelopeSequence: 3, taskId: teamTaskIdSchema.parse('basic-task'), review: kind === 'review' } } }
    },
  }
}
const input = { channelId: 'media-channel', expectedCursor: 7, audience: ['peer'], delivery: 'turn', idempotencyKey: 'media-retry',
  content: [{ type: 'text', text: 'Before' }, { type: 'image', mediaType: 'image/png', data: PNG, name: 'pixel.png' }, { type: 'text', text: 'After' }] }

describe('SDK channel media', () => {
  it('refuses media and attachment access when their exact runtime owners retire', async () => {
    const f = await setup()
    f.mount('attachments', false)
    await expect(f.server.handleRequest('team/channel-input', input)).rejects.toThrow('Image attachment storage is unavailable')
    await expect(f.server.handleRequest('team/channel-input', { ...input, content: [{ type: 'text', text: 'Text without storage' }] }))
      .resolves.toMatchObject({ value: { payload: { content: [{ type: 'text', text: 'Text without storage' }] } } })
    const selected = { teamId: 'media-team', channelId: 'media-channel', envelopeId: 'media-envelope',
      envelopeSequence: 8, attachmentId: 'image' }
    for (const service of ['attachments', 'humanActors', 'teams'] as const) {
      f.mount('attachments', true)
      f.mount(service, false)
      await expect(f.server.readTeamChannelAttachment(selected)).rejects.toThrow('Authenticated channel attachment access is unavailable')
      f.mount(service, true)
    }
    const post = { channelId: 'media-channel', expectedCursor: 7, audience: ['peer'], kind: 'message' as const,
      payload: { text: 'No owner' }, delivery: 'turn' as const }
    f.mount('humanActors', false)
    await expect(f.server.listTeamChannels({ teamId: 'media-team' })).rejects.toMatchObject({
      data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' },
    })
    await expect(f.server.getTeamChannelAdmission({ teamId: 'media-team', channelId: 'media-channel' })).rejects.toMatchObject({
      data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' },
    })
    await expect(f.server.postTeamChannel(post)).rejects.toMatchObject({ data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' } })
    f.mount('humanActors', true)
    f.mount('teams', false)
    await expect(f.server.listTeamChannels({ teamId: 'media-team' })).rejects.toThrow('Team provider')
    await expect(f.server.getTeamChannelAdmission({ teamId: 'media-team', channelId: 'media-channel' })).rejects.toThrow('Team provider')
    await expect(f.server.postTeamChannel(post)).rejects.toThrow('Team provider')
  })
  it('rejects media input on a direct-v2 channel and unkeyed input after direct-v4 closure', async () => {
    const older = await setup(2)
    await expect(older.server.handleRequest('team/channel-input', input)).rejects.toThrow('acknowledged active direct channel')
    const current = await setup(4)
    const { idempotencyKey: _retry, ...unkeyed } = input
    await expect(current.server.handleRequest('team/channel-input', { ...unkeyed,
      content: [{ type: 'text', text: 'Active unkeyed input' }] })).resolves.toMatchObject({
      value: { kind: 'message', payload: { content: [{ type: 'text', text: 'Active unkeyed input' }] } },
    })
    current.close()
    await expect(current.server.handleRequest('team/channel-input', { ...unkeyed,
      content: [{ type: 'text', text: 'New input after closure' }] })).rejects.toThrow('acknowledged active direct channel')
  })
  it('admits an ordinary unkeyed consult request without creating a retry key', async () => {
    const f = await setup()
    f.basic('request')
    await expect(f.server.inputTeamChannel({ channelId: input.channelId, expectedCursor: input.expectedCursor,
      audience: null, delivery: 'turn',
      content: [{ type: 'text', text: 'One ordinary request' }] })).resolves.toMatchObject({
      value: { kind: 'request', payload: { text: 'One ordinary request' } },
    })
    expect(f.teams.postChannelEnvelope).toHaveBeenCalledOnce()
  })
  it('enforces the same principal invitation and admission rules through direct SDK methods', async () => {
    const { server, teams, scopes, pending, revoke } = await setup()
    pending()
    const discovered = await server.getTeamChannelInvitation({ channelId: 'media-channel' })
    expect(discovered.value.invitation.status).toBe('pending')
    expect(scopes.at(-1)).toMatchObject({ operation: 'channel-invitation-read', fence: { kind: 'read' } })
    const consent = { channelId: 'media-channel', revision: discovered.value.invitation.revision,
      manifestFingerprint: discovered.value.invitation.manifestFingerprint, idempotencyKey: 'direct-consent' as never }
    const accepted = await server.acknowledgeTeamChannelInvitation(consent)
    expect(accepted.value.invitation.status).toBe('acknowledged')
    expect(teams.acknowledgeChannelInvitation).toHaveBeenCalledOnce()
    const admission = await server.getTeamChannelAdmission({ teamId: 'media-team', channelId: 'media-channel' })
    expect(admission.value.channel.phase).toBe('active')
    expect(scopes.at(-1)).toMatchObject({ operation: 'channel-admission-read', fence: { kind: 'read' } })
    revoke()
    await expect(server.getTeamChannelInvitation({ channelId: 'media-channel' }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(server.getTeamChannelAdmission({ teamId: 'media-team', channelId: 'media-channel' }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })

  it('discovers and acknowledges only the current principal invitation through scoped proofs', async () => {
    const { server, teams, scopes, pending } = await setup()
    pending()
    const discovered = await server.handleRequest('team/channel-invitation', { channelId: 'media-channel' }) as TeamChannelInvitationResult
    expect(discovered).toMatchObject({ value: { channel: { manifest: { teamId: 'media-team' } }, invitation: { status: 'pending' } } })
    expect(scopes.at(-1)).toMatchObject({ teamId: 'media-team', operation: 'channel-invitation-read', fence: { kind: 'read' } })
    const fingerprint = discovered.value.invitation.manifestFingerprint
    const acknowledged = await server.handleRequest('team/channel-invitation-acknowledge', {
      channelId: 'media-channel', revision: 1, manifestFingerprint: fingerprint,
      idempotencyKey: 'consent',
    }) as TeamChannelInvitationResult
    expect(acknowledged).toMatchObject({ value: { channel: { phase: 'active' }, invitation: { status: 'acknowledged' } } })
    expect(scopes.at(-1)).toMatchObject({ teamId: 'media-team', operation: 'channel-open', fence: { kind: 'revision', revision: 1 } })
    expect(teams.acknowledgeChannelInvitation).toHaveBeenCalledOnce()
    await expect(server.handleRequest('team/channel-invitation-acknowledge', {
      channelId: 'media-channel', revision: 1, manifestFingerprint: fingerprint,
      idempotencyKey: 'consent', actor: 'forged',
    })).rejects.toMatchObject({ code: -32_602 })
  })
  it.each(['request', 'response'] as const)('derives an ordinary consult %s with exact peer and retained causation', async (phase) => {
    const f = await setup(); f.basic(phase)
    const args = { ...input, audience: null, content: [{ type: 'text', text: 'Ordinary text' }] }
    const posted = await f.server.handleRequest('team/channel-input', args)
    expect(posted).toMatchObject({ value: { kind: phase, audience: ['peer'], payload: { text: 'Ordinary text' },
      ...phase === 'response' ? { causationId: 'basic-request', taskId: 'basic-task' } : {} } })
    await expect(f.server.handleRequest('team/channel-input', { ...args, audience: ['wrong-peer'] })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    if (phase === 'response') await expect(f.server.handleRequest('team/channel-input', { ...args, causationId: 'wrong-request' })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(f.teams.postChannelEnvelope).toHaveBeenCalledTimes(1)
  })
  it('replays a keyed consult response after the channel closes without another post', async () => {
    const f = await setup()
    f.basic('response')
    const args = { ...input, audience: null, content: [{ type: 'text', text: 'Retryable response' }] }
    const first = await f.server.handleRequest('team/channel-input', args)
    f.close()
    await expect(f.server.handleRequest('team/channel-input', args)).resolves.toEqual(first)
    expect(f.teams.postChannelEnvelope).toHaveBeenCalledTimes(2)
  })
  it('preserves an explicit task on an initiating consult request and rejects a response with another task', async () => {
    const f = await setup()
    f.basic('request')
    const args = { ...input, audience: null, taskId: 'linked-task', content: [{ type: 'text', text: 'Task question' }] }
    await expect(f.server.handleRequest('team/channel-input', args)).resolves.toMatchObject({
      value: { kind: 'request', taskId: 'linked-task', audience: ['peer'] },
    })
    f.basic('response')
    await expect(f.server.handleRequest('team/channel-input', args)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(f.teams.postChannelEnvelope).toHaveBeenCalledTimes(1)
  })
  it('keeps review decisions and image uploads out of ordinary consult text', async () => {
    const f = await setup(); f.basic('review')
    const save = vi.spyOn(f.storage.attachments, 'saveImages')
    await expect(f.server.handleRequest('team/channel-input', { ...input, content: [{ type: 'text', text: 'Not a decision' }] })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(f.server.handleRequest('team/channel-input', { ...input, content: [input.content[1]] })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(save.mock.calls).toHaveLength(0)
    expect(f.teams.postChannelEnvelope).not.toHaveBeenCalled()
  })
  it.each(['turn', 'context'] as const)('accepts discussion %s text while rejecting steer and a partial audience', async (delivery) => {
    const f = await setup(); f.basic('discussion')
    const args = { ...input, audience: null, delivery, content: [{ type: 'text', text: 'Discussion text' }] }
    await expect(f.server.handleRequest('team/channel-input', args)).resolves.toMatchObject({ value: { kind: 'message', audience: ['peer'], delivery } })
    await expect(f.server.handleRequest('team/channel-input', { ...args, delivery: 'steer' })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(f.server.handleRequest('team/channel-input', { ...args, audience: [] })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(f.teams.postChannelEnvelope).toHaveBeenCalledTimes(1)
  })

  it.each([3, 4] as const)('archives direct v%s ordered media with stable references and reads only the selected Envelope', async (version) => {
    const { server, storage, teams, scopes } = await setup(version)
    const first = await server.handleRequest('team/channel-input', input)
    if (version === 4) await expect(server.inputTeamChannel(input as never)).resolves.toEqual(first)
    expect(first).toMatchObject({ value: { kind: 'message', payload: { content: [
      { type: 'text', text: 'Before' }, { type: 'image', attachment: { width: 1, height: 1 } }, { type: 'text', text: 'After' },
    ] } } })
    expect(await server.handleRequest('team/channel-input', input)).toEqual(first)
    const envelope = teams.postChannelEnvelope.mock.results[0]
    if (envelope?.type !== 'return') throw new Error('Media was not posted')
    const posted: TeamEnvelope = await envelope.value
    const content: unknown = posted.payload.content
    if (!Array.isArray(content)) throw new Error('Media content is missing')
    const image: unknown = content[1]
    if (image === null || typeof image !== 'object' || Array.isArray(image)) throw new Error('Image reference is missing')
    if (!('attachment' in image)) throw new Error('Image reference is missing')
    const attachment: unknown = image.attachment
    if (attachment === null || typeof attachment !== 'object' || Array.isArray(attachment)) throw new Error('Image reference is missing')
    if (!('attachmentId' in attachment) || typeof attachment.attachmentId !== 'string') throw new Error('Image identity is missing')
    const read = vi.spyOn(storage.attachments, 'readImage')
    const params = { teamId: 'media-team', channelId: 'media-channel', envelopeId: posted.id,
      envelopeSequence: posted.sequence, attachmentId: attachment.attachmentId }
    await expect(server.handleRequest('team/channel-attachment', params)).resolves.toMatchObject({ attachment, data: expect.any(String) as unknown })
    if (version === 4) {
      await expect(server.readTeamChannelAttachment(params)).resolves.toMatchObject({ attachment, data: expect.any(String) as unknown })
    }
    expect(scopes.at(-1)).toMatchObject({ operation: 'channel-content-read', fence: { kind: 'read' },
      payload: { teamId: 'media-team', channelId: 'media-channel', envelopeId: posted.id, envelopeSequence: posted.sequence } })
    const calls = read.mock.calls.length
    await expect(server.handleRequest('team/channel-attachment', { ...params, attachmentId: 'unreferenced' })).rejects.toThrow('not referenced')
    await expect(server.handleRequest('team/channel-attachment', { ...params, teamId: 'foreign-team' })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(server.handleRequest('team/channel-attachment', { ...params, envelopeId: 'missing' })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_ENVELOPE_NOT_FOUND' })
    await expect(server.handleRequest('team/channel-attachment', { ...params, envelopeSequence: posted.sequence + 1 })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_ENVELOPE_NOT_FOUND' })
    expect(read).toHaveBeenCalledTimes(calls)
  })
  it('rejects inactive admission, forged fields and invalid image batches before storage publishes references', async () => {
    const { server, storage, pending } = await setup()
    const save = vi.spyOn(storage.attachments, 'saveImages')
    await expect(server.handleRequest('team/channel-input', { ...input, actor: 'forged' })).rejects.toMatchObject({ code: -32_602 })
    await expect(server.handleRequest('team/channel-input', { ...input, content: [...input.content, { type: 'image', mediaType: 'image/png', data: 'invalid' }] }))
      .rejects.toMatchObject({ code: 'INVALID_IMAGE_BASE64' })
    expect(save.mock.calls).toHaveLength(0)
    pending()
    await expect(server.handleRequest('team/channel-input', input)).rejects.toThrow('acknowledged active direct')
    expect(save.mock.calls).toHaveLength(0)
  })
  it('denies a revoked principal before admitting any encoded image', async () => {
    const { server, storage, revoke } = await setup()
    const save = vi.spyOn(storage.attachments, 'saveImages')
    revoke()
    await expect(server.handleRequest('team/channel-input', input)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(save.mock.calls).toHaveLength(0)
  })
  it('does not return image bytes when membership is revoked during the storage read', async () => {
    const { server, storage, teams, revoke } = await setup()
    await server.handleRequest('team/channel-input', input)
    const result = teams.postChannelEnvelope.mock.results[0]
    if (result?.type !== 'return') throw new Error('Media was not posted')
    const posted: TeamEnvelope = await result.value
    const content: unknown = posted.payload.content
    if (!Array.isArray(content)) throw new Error('Media content is missing')
    const part: unknown = content[1]
    if (part === null || typeof part !== 'object' || Array.isArray(part)) throw new Error('Image block is missing')
    if (!('attachment' in part)) throw new Error('Image reference is missing')
    const ref: unknown = part.attachment
    if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) throw new Error('Image reference is missing')
    if (!('attachmentId' in ref) || typeof ref.attachmentId !== 'string') throw new Error('Image identity is missing')
    const read = storage.attachments.readImage.bind(storage.attachments)
    vi.spyOn(storage.attachments, 'readImage').mockImplementation(async (reference, signal) => { const value = await read(reference, signal); revoke(); return value })
    await expect(server.handleRequest('team/channel-attachment', { teamId: 'media-team', channelId: 'media-channel',
      envelopeId: posted.id, envelopeSequence: posted.sequence, attachmentId: ref.attachmentId }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })
})
