import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@clocky/cordis'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import {
  channelInvitationSnapshotSchema,
  channelManifestSchema,
  channelPostIdempotencyKeySchema,
  fingerprintChannelManifest,
  participantIdSchema,
  teamTaskIdSchema,
  teamIdSchema,
} from '@clocky/clocky-team'
import type { ChannelAdmissionSnapshot, ChannelHumanAdmissionSnapshot, ChannelHumanInvitationSnapshot, ChannelManifest,
  ChannelSnapshot, ParticipantId } from '@clocky/clocky-team'
import {
  acknowledgePrincipalChannelInvitation,
  createPrincipalChannelAdmission,
  getPrincipalChannelInvitation,
  resolvePrincipalChannelText,
} from '../src/principal.ts'

const teamId = teamIdSchema.parse('principal-team')
const human = participantIdSchema.parse('principal-human')
const coordinator = participantIdSchema.parse('principal-coordinator')
const outsider = participantIdSchema.parse('principal-outsider')
const call = { principal: { id: 'principal-owner' }, signal: new AbortController().signal } as AuthenticatedProductCall

function manifest(adapter = { type: 'direct', version: 4 }, participants = [
  { id: human, role: 'human' }, { id: coordinator, role: 'coordinator' },
], viewPolicy: ChannelManifest['viewPolicy'] = { type: 'directed', version: 1 }, limits = {}): ChannelManifest {
  return channelManifestSchema.parse({ id: 'principal-channel', teamId, adapter, participants, viewPolicy, limits })
}

function channel(selected: ChannelManifest = manifest(), phase: ChannelSnapshot['phase'] = 'active'): ChannelSnapshot {
  return { manifest: selected, phase, cursor: 3 }
}

function invitation(selected: ChannelManifest = manifest(), participantId: ParticipantId = human,
  endpoint: 'human' | 'service' = 'human') {
  return channelInvitationSnapshotSchema.parse({ participantId, role: 'human', visibility: 'channel', required: true,
    deadline: 50, endpoint: endpoint === 'human' ? { kind: 'human' } : { kind: 'service', name: 'other' },
    revision: 1, manifestFingerprint: fingerprintChannelManifest(selected), status: 'acknowledged' })
}

function harness(selected = manifest()) {
  const current = channel(selected)
  const own: ChannelHumanInvitationSnapshot = { channel: current, invitation: invitation(selected) }
  const admission: ChannelAdmissionSnapshot = { channel: current, invitations: [own.invitation] }
  const status: ChannelHumanAdmissionSnapshot = { ...admission, expectedNext: { kind: 'none' }, protocolStatus: { kind: 'other' } }
  const teams = {
    getChannel: vi.fn(async () => current),
    getHumanChannelInvitation: vi.fn(async () => own),
    acknowledgeChannelInvitation: vi.fn(async () => admission),
    getHumanChannelAdmission: vi.fn(async () => status),
  }
  const humanActors = { withProof: vi.fn(async (_call: unknown, _selection: unknown,
    operation: (actor: object) => Promise<unknown>) => await operation(Object.freeze({ proof: 'principal' }))) }
  const ctx = { get: (name: string) => name === 'teams' ? teams : name === 'teamHumanActors' ? humanActors : undefined } as unknown as Context
  return { ctx, teams, humanActors, own, admission, status }
}

describe('authenticated principal channel admission', () => {
  it('discovers only the caller invitation and acknowledges its exact revision through a proof', async () => {
    const fixture = harness()
    const discovered = await getPrincipalChannelInvitation(fixture.ctx, call, { channelId: fixture.own.channel.manifest.id })
    expect(discovered).toEqual(fixture.own)
    expect(fixture.humanActors.withProof).toHaveBeenCalledWith(call, expect.objectContaining({
      operation: 'channel-invitation-read', teamId,
    }), expect.any(Function))
    const accepted = await acknowledgePrincipalChannelInvitation(fixture.ctx, call, {
      channelId: fixture.own.channel.manifest.id, revision: 1,
      manifestFingerprint: fixture.own.invitation.manifestFingerprint, idempotencyKey: 'accept-principal' as never,
    })
    expect(accepted).toEqual(fixture.own)
    expect(fixture.teams.acknowledgeChannelInvitation).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }))
  })

  it('fails closed when providers disappear or acknowledgement omits the caller invitation', async () => {
    const absent = { get: () => undefined } as unknown as Context
    const fixture = harness()
    await expect(getPrincipalChannelInvitation(absent, call, { channelId: fixture.own.channel.manifest.id }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(createPrincipalChannelAdmission(absent, call)({ admission: fixture.admission, participantId: human,
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(resolvePrincipalChannelText(absent, call, fixture.own, { text: 'hello', delivery: 'turn', audience: null }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    fixture.teams.acknowledgeChannelInvitation.mockResolvedValueOnce({ ...fixture.admission, invitations: [] })
    await expect(acknowledgePrincipalChannelInvitation(fixture.ctx, call, { channelId: fixture.own.channel.manifest.id,
      revision: 1, manifestFingerprint: fixture.own.invitation.manifestFingerprint, idempotencyKey: 'missing' as never }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    let teamReads = 0
    const disappearing = { get: (name: string) => name === 'teams'
      ? teamReads++ === 0 ? fixture.teams : undefined : fixture.humanActors } as unknown as Context
    await expect(acknowledgePrincipalChannelInvitation(disappearing, call, { channelId: fixture.own.channel.manifest.id,
      revision: 1, manifestFingerprint: fixture.own.invitation.manifestFingerprint, idempotencyKey: 'gone' as never }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })

  it('requires product human role, directed view, and an exact invitation before proof issuance', async () => {
    const fixture = harness()
    const admit = createPrincipalChannelAdmission(fixture.ctx, call)
    await expect(admit({ admission: fixture.admission, participantId: human, signal: new AbortController().signal }))
      .resolves.toBeUndefined()
    expect(fixture.teams.acknowledgeChannelInvitation).toHaveBeenCalledOnce()
    for (const selected of [
      manifest({ type: 'direct', version: 2 }),
      manifest({ type: 'direct', version: 3 }, [{ id: human, role: 'human' }, { id: coordinator, role: 'worker' }]),
      manifest({ type: 'direct', version: 4 }, undefined, { type: 'other', version: 1 }),
    ]) {
      await expect(admit({ admission: { channel: channel(selected), invitations: [invitation(selected)] },
        participantId: human, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    }
    await expect(admit({ admission: fixture.admission, participantId: coordinator, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    for (const item of [
      invitation(fixture.own.channel.manifest, human, 'service'),
      { ...fixture.own.invitation, manifestFingerprint: fingerprintChannelManifest(manifest({ type: 'direct', version: 3 })) },
    ]) await expect(admit({ admission: { ...fixture.admission, invitations: [item] }, participantId: human,
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(fixture.teams.acknowledgeChannelInvitation).toHaveBeenCalledOnce()
  })

  it('refuses text before acknowledgement or outside the current turn', async () => {
    const fixture = harness()
    const text = { text: 'hello', delivery: 'turn' as const, audience: null }
    await expect(resolvePrincipalChannelText(fixture.ctx, call, { ...fixture.own,
      invitation: { ...fixture.own.invitation, status: 'pending' } }, text)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(resolvePrincipalChannelText(fixture.ctx, call, { ...fixture.own,
      channel: channel(fixture.own.channel.manifest, 'pending') }, text)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    fixture.teams.getHumanChannelAdmission.mockResolvedValueOnce({ ...fixture.status,
      expectedNext: { kind: 'participant', participantId: outsider } })
    await expect(resolvePrincipalChannelText(fixture.ctx, call, fixture.own, text)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(resolvePrincipalChannelText(fixture.ctx, call, fixture.own, { ...text,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('retry') })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('derives consult request and response routing from the retained request anchor', async () => {
    const taskId = teamTaskIdSchema.parse('consult-task')
    const requestManifest = manifest({ type: 'consult', version: 1 }, [
      { id: human, role: 'initiator' }, { id: coordinator, role: 'respondent' },
    ], undefined)
    const initial = harness(requestManifest)
    initial.teams.getHumanChannelAdmission.mockResolvedValue({ ...initial.status,
      protocolStatus: { kind: 'consult', phase: 'request' } })
    const request = await resolvePrincipalChannelText(initial.ctx, call, initial.own,
      { text: 'What changed?', delivery: 'turn', audience: [coordinator], taskId })
    expect(request).toMatchObject({ kind: 'request', audience: [coordinator], taskId })
    await expect(resolvePrincipalChannelText(initial.ctx, call, initial.own,
      { text: 'Invalid delivery', delivery: 'context', audience: [coordinator] }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(resolvePrincipalChannelText(initial.ctx, call, initial.own,
      { text: 'Wrong causation', delivery: 'turn', audience: [coordinator], causationId: 'foreign' as never }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const responseManifest = manifest({ type: 'consult', version: 1 }, [
      { id: coordinator, role: 'initiator' }, { id: human, role: 'respondent' },
    ], undefined)
    const responding = harness(responseManifest)
    responding.teams.getHumanChannelAdmission.mockResolvedValue({ ...responding.status,
      protocolStatus: { kind: 'consult', phase: 'response', request: {
        teamId, channelId: responseManifest.id, envelopeId: 'consult-request' as never,
        envelopeSequence: 1, taskId, review: false,
      } } })
    const response = await resolvePrincipalChannelText(responding.ctx, call, responding.own,
      { text: 'The change is ready.', delivery: 'turn', audience: [coordinator],
        causationId: 'consult-request' as never, taskId })
    expect(response).toMatchObject({ kind: 'response', causationId: 'consult-request', taskId })
    await expect(resolvePrincipalChannelText(responding.ctx, call, responding.own,
      { text: 'Wrong task', delivery: 'turn', audience: [coordinator], taskId: teamTaskIdSchema.parse('other-task') }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })

  it('addresses all discussion peers and preserves optional causal task metadata', async () => {
    const selected = manifest({ type: 'discussion', version: 1 }, [
      { id: human, role: 'speaker' }, { id: coordinator, role: 'speaker' },
    ], undefined, { maxTurns: 2, speakerPolicy: 'free-form' })
    const fixture = harness(selected)
    fixture.teams.getHumanChannelAdmission.mockResolvedValue({ ...fixture.status,
      protocolStatus: { kind: 'discussion', turnCount: 0, maxTurns: 2, speakerPolicy: 'free-form' } })
    const taskId = teamTaskIdSchema.parse('discussion-task')
    const text = { text: 'Keep working.', delivery: 'context' as const, audience: [coordinator],
      causationId: 'prior-message' as never, taskId }
    expect(await resolvePrincipalChannelText(fixture.ctx, call, fixture.own, text))
      .toMatchObject({ kind: 'message', audience: [coordinator], causationId: 'prior-message', taskId })
    for (const input of [
      { ...text, text: '  ' },
      { ...text, delivery: 'steer' as const },
      { ...text, audience: [] },
      { ...text, audience: [outsider] },
    ]) await expect(resolvePrincipalChannelText(fixture.ctx, call, fixture.own, input))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const retry = await resolvePrincipalChannelText(fixture.ctx, call, { ...fixture.own,
      channel: channel(selected, 'pending') }, { text: 'Retry', delivery: 'context', audience: null,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('retry-discussion') })
    expect(retry).toMatchObject({ kind: 'message', audience: [coordinator] })
  })
})
