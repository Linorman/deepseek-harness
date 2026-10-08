import { describe, expect, it } from 'vitest'
import { channelManifestSchema, participantIdSchema, teamEnvelopeSchema, teamIdSchema } from '@clocky/clocky-team'
import {
  DIRECT_CHANNEL_ADAPTER_V4,
  directChannelV4Adapter,
  directChannelV4Recipients,
  parseDirectChannelV4Manifest,
  parseDirectProductChannelManifest,
} from '../src/direct.ts'

const human = participantIdSchema.parse('direct-v4-human')
const coordinator = participantIdSchema.parse('direct-v4-coordinator')
const worker = participantIdSchema.parse('direct-v4-worker')
const outsider = participantIdSchema.parse('direct-v4-outsider')
const teamId = teamIdSchema.parse('direct-v4-team')

function manifest(participants: { id: typeof human; role: string }[] = [
  { id: human, role: 'human' }, { id: coordinator, role: 'coordinator' },
]) {
  return channelManifestSchema.parse({ id: 'direct-v4-channel', teamId, adapter: DIRECT_CHANNEL_ADAPTER_V4,
    participants, limits: {} })
}

const message = { content: [{ type: 'text', text: 'Hello' }] }

describe('direct v4 contract', () => {
  it('rejects nonmembers and invalid explicit recipient subsets before delivery', () => {
    const channel = manifest([...manifest().participants, { id: worker, role: 'worker' }])
    expect(parseDirectChannelV4Manifest(channel).participantIds).toEqual([human, coordinator, worker])
    expect(directChannelV4Recipients(channel, human, null)).toEqual([coordinator, worker])
    for (const audience of [[], [human], [coordinator, coordinator], [outsider]]) {
      expect(() => directChannelV4Recipients(channel, human, audience)).toThrow(/audience/)
    }
    expect(() => directChannelV4Recipients(channel, outsider, [human])).toThrow(/sender/)
  })

  it('requires an exact product pair and a coordinator before preparing a final answer', () => {
    const channel = manifest()
    expect(parseDirectProductChannelManifest(channel).participantIds).toEqual([human, coordinator])
    expect(() => parseDirectProductChannelManifest(manifest([
      { id: human, role: 'human' }, { id: coordinator, role: 'worker' },
    ]))).toThrow(/human and one coordinator/)
    expect(() => parseDirectProductChannelManifest(manifest([
      ...channel.participants, { id: worker, role: 'worker' },
    ]))).toThrow(/exactly two/)
    expect(() => parseDirectProductChannelManifest({ ...channel, adapter: { type: 'other', version: 4 } })).toThrow(/does not select/)
    expect(() => directChannelV4Adapter.prepareFinal!({ manifest: channel, state: null, senderId: human, text: 'Done' }))
      .toThrow(/coordinator peer/)
    expect(directChannelV4Adapter.prepareFinal!({ manifest: channel, state: null, senderId: coordinator, text: 'Done' }))
      .toMatchObject({ audience: [human], kind: 'final', payload: { text: 'Done' } })
  })

  it('projects empty state and rejects malformed final envelopes', () => {
    const channel = manifest()
    directChannelV4Adapter.validateCreate(channel)
    expect(directChannelV4Adapter.initialState(channel)).toBeNull()
    expect(directChannelV4Adapter.fold(null, { type: 'channel/envelope' } as never)).toBeNull()
    expect(directChannelV4Adapter.afterAccept({ manifest: channel, state: null } as never)).toEqual([])
    expect(directChannelV4Adapter.expectedNext({ manifest: channel, state: null })).toEqual({ kind: 'none' })
    expect(directChannelV4Adapter.projectView({ manifest: channel, state: null, records: [] })).toEqual({})
    const base = { manifest: channel, state: null, senderId: coordinator, draft: {
      channelId: channel.id, audience: [human], kind: 'final', payload: { text: 'Done' }, delivery: 'turn' as const,
    } }
    directChannelV4Adapter.validateSend(base)
    expect(() => { directChannelV4Adapter.validateSend({ ...base, draft: { ...base.draft, kind: 'other' } }) })
      .toThrow(/only message or final/)
    for (const draft of [
      { ...base.draft, payload: {} },
      { ...base.draft, payload: { text: '' } },
      { ...base.draft, audience: null },
      { ...base.draft, delivery: 'context' as const },
    ]) expect(() => { directChannelV4Adapter.validateSend({ ...base, draft }) }).toThrow()
    expect(() => { directChannelV4Adapter.validateSend({ ...base, senderId: human,
      draft: { ...base.draft, audience: [coordinator] } }) }).toThrow(/final must use turn/)
    const envelope = teamEnvelopeSchema.parse({ id: 'direct-v4-envelope', teamId, channelId: channel.id,
      sequence: 1, senderId: coordinator, audience: [human], kind: 'message', payload: message,
      delivery: 'turn', priority: 'normal', createdAt: 1 })
    expect(directChannelV4Adapter.deliveryPlan({ manifest: channel, state: null, envelope }))
      .toEqual([{ participantId: human, envelopeId: envelope.id, delivery: 'turn' }])
  })

  it('permits removal only when the former member leaves at least two current members', () => {
    const channel = manifest([...manifest().participants, { id: worker, role: 'worker' }])
    const mayRemove = (participantId: typeof human, retainedParticipantIds: (typeof human)[]) =>
      directChannelV4Adapter.allowParticipantRemoval!({ manifest: channel, state: null,
        participantId, retainedParticipantIds })
    expect(mayRemove(worker, [human, coordinator])).toBe(true)
    expect(mayRemove(outsider, [human, coordinator])).toBe(false)
    expect(mayRemove(worker, [human, worker])).toBe(false)
    expect(mayRemove(worker, [human])).toBe(false)
    expect(mayRemove(worker, [human, outsider])).toBe(false)
  })
})
