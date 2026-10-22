import { expect, it } from 'vitest'
import { TeamError } from '../src/error.ts'
import { envelopeByteLimitDetails, fingerprintTeamEnvelopeDraft } from '../src/envelope-byte-limit.ts'
import { channelIdSchema, teamEnvelopeByteLimitDetailsSchema } from '../src/schema.ts'

const draft = { channelId: channelIdSchema.parse('channel'), audience: null, kind: 'message', payload: { text: '中🙂' },
  delivery: 'context' as const, traceId: 'fingerprint', correlationId: 'original-operation' }
const details = { kind: 'envelope-byte-limit', teamId: 'team', teamCursor: 8, channelId: 'channel', channelCursor: 4,
  senderId: 'sender', idempotencyKey: 'original-post', traceId: draft.traceId, correlationId: draft.correlationId,
  draftFingerprint: fingerprintTeamEnvelopeDraft(draft), bytes: 512, limit: 256 }

it('recognizes only a strict direct pre-append byte refusal with the complete original post identity', () => {
  const error = new TeamError('Opaque diagnostic', 'TEAM_INVALID_ARGUMENT', { details })
  expect(envelopeByteLimitDetails(error)).toEqual(details)
  const optional = ['idempotencyKey', 'traceId', 'correlationId']
  for (const field of Object.keys(details).filter(value => !optional.includes(value))) {
    const missing: Record<string, unknown> = { ...details }
    Reflect.deleteProperty(missing, field)
    expect(teamEnvelopeByteLimitDetailsSchema.safeParse(missing).success).toBe(false)
  }
  for (const invalid of [{ ...details, bytes: 256 }, { ...details, limit: 0 }, { ...details, channelCursor: -1 },
    { ...details, draftFingerprint: 'invented' }, { ...details, idempotencyKey: '' }, { ...details, traceId: '' },
    { ...details, senderId: '' }, { ...details, extra: true }, { ...details, bytes: Number.MAX_SAFE_INTEGER + 1 }]) {
    expect(envelopeByteLimitDetails(new TeamError('Envelope exceeds limit', 'TEAM_INVALID_ARGUMENT', { details: invalid })))
      .toBeUndefined()
  }
  expect(envelopeByteLimitDetails(new AggregateError([error]))).toBeUndefined()
  expect(envelopeByteLimitDetails(new TeamError('Envelope exceeds limit', 'TEAM_CHANNEL_BACKPRESSURE', { details })))
    .toBeUndefined()
  expect(envelopeByteLimitDetails(new TeamError('Envelope exceeds limit', 'TEAM_INVALID_ARGUMENT'))).toBeUndefined()
})

it('fingerprints all caller-owned fields canonically while treating absent priority as normal', () => {
  const original = fingerprintTeamEnvelopeDraft(draft)
  expect(fingerprintTeamEnvelopeDraft({ ...draft, priority: 'normal' })).toBe(original)
  expect(fingerprintTeamEnvelopeDraft({ ...draft, payload: { b: 2, a: 1 } }))
    .toBe(fingerprintTeamEnvelopeDraft({ ...draft, payload: { a: 1, b: 2 } }))
  for (const changed of [{ ...draft, payload: { text: 'Different' } }, { ...draft, traceId: 'different' },
    { ...draft, correlationId: 'different' }, { ...draft, delivery: 'turn' as const }, { ...draft, ttlMs: 1 },
    { ...draft, channelId: channelIdSchema.parse('other-channel') }, { ...draft, kind: 'other' }]) {
    expect(fingerprintTeamEnvelopeDraft(changed)).not.toBe(original)
  }
  expect(() => fingerprintTeamEnvelopeDraft({ ...draft, extra: true } as typeof draft)).toThrow()
})
