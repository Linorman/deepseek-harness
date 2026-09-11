import { describe, expect, it } from 'vitest'
import {
  TEAM_LINK_FRAME_VERSION,
  parseTeamLinkClientFrame,
  parseTeamLinkServerFrame,
} from '../src/index.ts'

const binding = {
  activationId: 'activation-frame',
  teamId: 'team-frame',
  participantId: 'participant-frame',
  sessionId: 'session-frame',
  provider: 'websocket',
}

describe('Team Link wire frames', () => {
  it('parses strict attach, subscription, request, nack, response, and notification frames', () => {
    expect(parseTeamLinkClientFrame({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'attach',
      id: 'attach-1',
      binding,
      capability: 'opaque-capability',
    })).toMatchObject({ type: 'attach', binding })
    expect(parseTeamLinkClientFrame({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'subscribe-1' }))
      .toEqual({ v: TEAM_LINK_FRAME_VERSION, type: 'subscribe', id: 'subscribe-1' })
    expect(parseTeamLinkClientFrame({
      v: TEAM_LINK_FRAME_VERSION, type: 'request', id: 'request-1', op: 'post', input: { channelId: 'channel-frame' },
    }))
      .toMatchObject({ type: 'request', op: 'post' })
    expect(parseTeamLinkClientFrame({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'request',
      id: 'final-1',
      op: 'final-result',
      input: { channelId: 'channel-frame', idempotencyKey: 'final-1', text: 'Done.' },
    })).toMatchObject({ type: 'request', op: 'final-result' })
    expect(parseTeamLinkClientFrame({
      v: TEAM_LINK_FRAME_VERSION, type: 'nack', deliveryId: 'delivery-1', channelId: 'channel-frame', envelopeId: 'envelope-frame', retryable: true,
    })).toMatchObject({ type: 'nack', retryable: true })
    expect(parseTeamLinkClientFrame({
      v: TEAM_LINK_FRAME_VERSION, type: 'request', id: 'interrupt-ack-1', op: 'interrupt-ack', input: { interruptId: 'interrupt-frame' },
    })).toMatchObject({ type: 'request', op: 'interrupt-ack' })
    expect(parseTeamLinkServerFrame({ v: TEAM_LINK_FRAME_VERSION, type: 'attached', id: 'attach-1', binding })).toMatchObject({ type: 'attached', binding })
    expect(parseTeamLinkServerFrame({ v: TEAM_LINK_FRAME_VERSION, type: 'response', id: 'request-1', ok: true, result: { accepted: true } }))
      .toMatchObject({ type: 'response', ok: true })
    expect(parseTeamLinkServerFrame({
      v: TEAM_LINK_FRAME_VERSION, type: 'response', id: 'request-1', ok: false, error: { code: 'denied', message: 'not authorized', retryAfterMs: 5 },
    })).toMatchObject({ type: 'response', ok: false })
    expect(parseTeamLinkServerFrame({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'notify',
      deliveryId: 'delivery-1',
      envelope: {
        id: 'envelope-frame', teamId: 'team-frame', channelId: 'channel-frame', sequence: 1, senderId: 'participant-frame',
        audience: ['participant-recipient'], kind: 'message', payload: { text: 'hello' }, delivery: 'turn', priority: 'normal', createdAt: 1,
      },
    })).toMatchObject({ type: 'notify', deliveryId: 'delivery-1' })
    expect(parseTeamLinkServerFrame({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'interrupt',
      deliveryId: 'interrupt-delivery-1',
      interrupt: {
        id: 'interrupt-frame',
        actorId: 'participant-actor',
        target: binding,
        requestedAt: 1,
      },
    })).toMatchObject({ type: 'interrupt', deliveryId: 'interrupt-delivery-1' })
    expect(parseTeamLinkClientFrame({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'cancelled',
      id: 'cancel-1',
      accepted: true,
    })).toEqual({ v: TEAM_LINK_FRAME_VERSION, type: 'cancelled', id: 'cancel-1', accepted: true })
    expect(parseTeamLinkServerFrame({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'cancel',
      id: 'cancel-1',
      reason: { code: 'TEAM_LINK_CREDENTIAL_REVOKED', message: 'stop Link-owned work' },
    })).toMatchObject({ type: 'cancel', id: 'cancel-1' })
  })

  it('rejects unknown fields, wrong versions, missing correlations, untrusted status, and malformed payloads', () => {
    expect(() => parseTeamLinkClientFrame({ v: TEAM_LINK_FRAME_VERSION, type: 'attach', id: 'attach-1', binding: { ...binding, status: 'idle' }, capability: 'x' })).toThrow()
    expect(() => parseTeamLinkClientFrame({ v: 1, type: 'subscribe', id: 'subscribe-1' })).toThrow()
    expect(() => parseTeamLinkClientFrame({ v: 2, type: 'subscribe', id: 'subscribe-1' })).toThrow()
    expect(() => parseTeamLinkClientFrame({ v: TEAM_LINK_FRAME_VERSION, type: 'request', id: '', op: 'post', input: {} })).toThrow()
    expect(() => parseTeamLinkClientFrame({ v: TEAM_LINK_FRAME_VERSION, type: 'request', id: 'request-1', op: 'unknown', input: {} })).toThrow()
    expect(() => parseTeamLinkServerFrame({ v: TEAM_LINK_FRAME_VERSION, type: 'response', id: 'request-1', ok: false, error: { code: '', message: 'no' } })).toThrow()
    expect(() => parseTeamLinkServerFrame({ v: TEAM_LINK_FRAME_VERSION, type: 'notify', deliveryId: 'delivery-1', envelope: { id: 'missing' } })).toThrow()
    expect(() => parseTeamLinkServerFrame({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'cancel',
      id: 'cancel-1',
      reason: { code: '', message: 'stop' },
    })).toThrow()
    expect(() => parseTeamLinkClientFrame({
      v: TEAM_LINK_FRAME_VERSION,
      type: 'cancelled',
      id: 'cancel-1',
      accepted: true,
      extra: true,
    })).toThrow()
  })
})
