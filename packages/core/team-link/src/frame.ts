/** Strict JSON frames for authenticated remote Team Link transports. @module @clocky/clocky-team-link/frame */

import { SessionId } from '@clocky/clocky-session'
import {
  channelSnapshotSchema,
  channelInvitationSnapshotSchema,
  activationIdSchema,
  channelIdSchema,
  envelopeIdSchema,
  jsonObjectSchema,
  jsonValueSchema,
  participantIdSchema,
  participantInterruptSnapshotSchema,
  teamTaskCancellationSnapshotSchema,
  teamTaskIdSchema,
  teamEnvelopeSchema,
  teamIdSchema,
} from '@clocky/clocky-team'
import type {
  ActivationId,
  ChannelId,
  EnvelopeId,
  JsonObject,
  JsonValue,
  ParticipantId,
  ParticipantInterruptSnapshot,
  TeamEnvelope,
  TeamId,
} from '@clocky/clocky-team'
import type { SessionId as SessionIdentifier } from '@clocky/clocky-session'
import type { TeamLinkDeliveryId, TeamLinkTerminationReason, TeamLinkTaskCancellationNotification, TeamLinkInvitationNotification } from './types.ts'
import { z } from 'zod'

/** Current framed Team Link wire protocol version. */
export const TEAM_LINK_FRAME_VERSION = 8

/** Immutable identity a capability binds to; mutable activation status never crosses the frame. */
export interface TeamLinkBindingIdentity {
  readonly activationId: ActivationId
  readonly teamId: TeamId
  readonly participantId: ParticipantId
  readonly sessionId: SessionIdentifier
  readonly provider: string
}

/** Operations a remote Link may request after a successful attach. */
export type TeamLinkOperation = 'post' | 'final-result' | 'claim' | 'task-start' | 'task-settle' | 'task-integrate' | 'task-heartbeat' | 'task-review' | 'receipt' | 'interrupt-ack' | 'task-cancellation-ack' | 'invitation-ack' | 'channel-get'

/** Sanitized failure returned to a remote Link caller. */
export interface TeamLinkResponseError {
  readonly code: string
  readonly message: string
  readonly retryAfterMs?: number
}

/** Remote-to-Hub frame union. */
export type TeamLinkClientFrame =
  | {
    readonly v: typeof TEAM_LINK_FRAME_VERSION
    readonly type: 'attach'
    readonly id: string
    readonly binding: TeamLinkBindingIdentity
    readonly capability: string
  }
  | {
    readonly v: typeof TEAM_LINK_FRAME_VERSION
    readonly type: 'subscribe'
    readonly id: string
  }
  | {
    readonly v: typeof TEAM_LINK_FRAME_VERSION
    readonly type: 'request'
    readonly id: string
    readonly op: TeamLinkOperation
    readonly input: JsonObject
  }
  | {
    readonly v: typeof TEAM_LINK_FRAME_VERSION
    readonly type: 'nack'
    readonly deliveryId: string
    readonly channelId: ChannelId
    readonly envelopeId: EnvelopeId
    readonly retryable: boolean
  }
  | {
    readonly v: typeof TEAM_LINK_FRAME_VERSION
    readonly type: 'cancelled'
    /** Hub-issued cancellation request identity being acknowledged. */
    readonly id: string
    /** Whether the endpoint stopped Link-owned admission. */
    readonly accepted: boolean
  }

/** Hub-to-remote frame union. */
export type TeamLinkServerFrame =
  | {
    readonly v: typeof TEAM_LINK_FRAME_VERSION
    readonly type: 'attached'
    readonly id: string
    readonly binding: TeamLinkBindingIdentity
  }
  | {
    readonly v: typeof TEAM_LINK_FRAME_VERSION
    readonly type: 'response'
    readonly id: string
    readonly ok: true
    readonly result: JsonValue
  }
  | {
    readonly v: typeof TEAM_LINK_FRAME_VERSION
    readonly type: 'response'
    readonly id: string
    readonly ok: false
    readonly error: TeamLinkResponseError
  }
  | {
    readonly v: typeof TEAM_LINK_FRAME_VERSION
    readonly type: 'notify'
    readonly deliveryId: TeamLinkDeliveryId
    readonly envelope: TeamEnvelope
  }
  | {
    readonly v: typeof TEAM_LINK_FRAME_VERSION
    readonly type: 'interrupt'
    readonly deliveryId: TeamLinkDeliveryId
    readonly interrupt: ParticipantInterruptSnapshot
  }
  | { readonly v: typeof TEAM_LINK_FRAME_VERSION; readonly type: 'invitation'; readonly notification: TeamLinkInvitationNotification }
  | { readonly v: typeof TEAM_LINK_FRAME_VERSION; readonly type: 'task-cancellation'; readonly notification: TeamLinkTaskCancellationNotification }
  | {
    readonly v: typeof TEAM_LINK_FRAME_VERSION
    readonly type: 'cancel'
    /** Hub-issued cancellation request identity. */
    readonly id: string
    /** Reason the remote endpoint must stop Link-owned admission. */
    readonly reason: TeamLinkTerminationReason
  }

const frameIdSchema = z.string().min(1)
const providerSchema = z.string().min(1).refine(value => value.trim() === value, {
  message: 'provider must not have surrounding whitespace',
})
const sessionIdSchema = z.string().min(1).transform(value => SessionId(value)) as z.ZodType<SessionIdentifier>
const retryAfterMsSchema = z.number().int().min(0)

/** Parse one opaque Link-issued delivery correlation at the transport boundary. */
export const teamLinkDeliveryIdSchema = frameIdSchema.transform(value => value as TeamLinkDeliveryId)

/** Parse one immutable capability-bound remote activation identity. */
export const teamLinkBindingIdentitySchema = z.object({
  activationId: activationIdSchema,
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  sessionId: sessionIdSchema,
  provider: providerSchema,
}).strict() as z.ZodType<TeamLinkBindingIdentity>

const teamLinkOperationSchema = z.enum([
  'post', 'final-result', 'claim', 'task-start', 'task-settle', 'task-integrate', 'task-heartbeat', 'task-review', 'receipt', 'interrupt-ack', 'task-cancellation-ack', 'invitation-ack', 'channel-get',
]) satisfies z.ZodType<TeamLinkOperation>
const teamLinkResponseErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryAfterMs: retryAfterMsSchema.optional(),
}).strict() as z.ZodType<TeamLinkResponseError>

/** Parse one strict remote-to-Hub Team Link frame. */
export const teamLinkClientFrameSchema = z.discriminatedUnion('type', [
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('attach'),
    id: frameIdSchema,
    binding: teamLinkBindingIdentitySchema,
    capability: z.string().min(1),
  }).strict(),
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('subscribe'),
    id: frameIdSchema,
  }).strict(),
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('request'),
    id: frameIdSchema,
    op: teamLinkOperationSchema,
    input: jsonObjectSchema,
  }).strict(),
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('nack'),
    deliveryId: frameIdSchema,
    channelId: channelIdSchema,
    envelopeId: envelopeIdSchema,
    retryable: z.boolean(),
  }).strict(),
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('cancelled'),
    id: frameIdSchema,
    accepted: z.boolean(),
  }).strict(),
]) as z.ZodType<TeamLinkClientFrame>

/** Parse one strict Hub-to-remote Team Link frame. */
export const teamLinkServerFrameSchema = z.union([
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION), type: z.literal('invitation'),
    notification: z.object({ channel: channelSnapshotSchema, invitation: channelInvitationSnapshotSchema }).strict(),
  }).strict(),
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('attached'),
    id: frameIdSchema,
    binding: teamLinkBindingIdentitySchema,
  }).strict(),
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('response'),
    id: frameIdSchema,
    ok: z.literal(true),
    result: jsonValueSchema,
  }).strict(),
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('response'),
    id: frameIdSchema,
    ok: z.literal(false),
    error: teamLinkResponseErrorSchema,
  }).strict(),
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('notify'),
    deliveryId: teamLinkDeliveryIdSchema,
    envelope: teamEnvelopeSchema,
  }).strict(),
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('interrupt'),
    deliveryId: teamLinkDeliveryIdSchema,
    interrupt: participantInterruptSnapshotSchema,
  }).strict(),
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('task-cancellation'),
    notification: z.object({
      taskId: teamTaskIdSchema,
      phase: z.enum(['assigned', 'running']),
      revision: z.number().int().positive(),
      cancellation: teamTaskCancellationSnapshotSchema,
    }).strict(),
  }).strict(),
  z.object({
    v: z.literal(TEAM_LINK_FRAME_VERSION),
    type: z.literal('cancel'),
    id: frameIdSchema,
    reason: z.object({
      code: z.string().min(1),
      message: z.string().min(1),
    }).strict() satisfies z.ZodType<TeamLinkTerminationReason>,
  }).strict(),
]) as z.ZodType<TeamLinkServerFrame>

/**
 * Parse one untrusted remote-to-Hub frame at the WebSocket boundary.
 * @param value - Untrusted decoded JSON frame.
 * @returns the validated client frame.
 */
export function parseTeamLinkClientFrame(value: unknown): TeamLinkClientFrame {
  return teamLinkClientFrameSchema.parse(value)
}

/**
 * Parse one untrusted Hub-to-remote frame at the WebSocket boundary.
 * @param value - Untrusted decoded JSON frame.
 * @returns the validated server frame.
 */
export function parseTeamLinkServerFrame(value: unknown): TeamLinkServerFrame {
  return teamLinkServerFrameSchema.parse(value)
}
