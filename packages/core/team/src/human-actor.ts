/** Canonical payload binding for authenticated human proofs and durable Team results. @module @clocky/clocky-team/human-actor */

import { createHash } from 'node:crypto'
import { channelManifestSchema, teamHumanActorProofInputSchema } from './schema.ts'
import type {
  ChannelManifest,
  ChannelManifestFingerprint,
  JsonObject,
  JsonValue,
  TeamHumanActorPayloadFingerprint,
  TeamFinalContentFingerprint,
  TeamHumanActorProofInput,
  ChannelSummarySourceFingerprint,
  TeamEnvelope,
  TeamId,
  ChannelSummarySelectionInput,
} from './types.ts'

/** Return a key-order-independent lossless JSON rendering for one already JSON-safe value. */
function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as JsonObject
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key] as JsonValue)}`).join(',')}}`
}

/**
 * Fingerprint the exact Team, operation, optimistic fence, and JSON-only
 * payload selected for one authenticated human mutation.
 * @param input - complete parsed mutation facts excluding every runtime proof.
 * @returns a SHA-256 payload fingerprint that a provider can independently recompute.
 */
export function fingerprintTeamHumanActorPayload(
  input: TeamHumanActorProofInput,
): TeamHumanActorPayloadFingerprint {
  const parsed = teamHumanActorProofInputSchema.parse(input)
  return `sha256:${createHash('sha256').update(canonicalJson(parsed), 'utf8').digest('hex')}` as TeamHumanActorPayloadFingerprint
}

/**
 * Fingerprint the exact content retained by a final Envelope.
 * @param payload - committed JSON payload owned by the channel WAL.
 * @returns a key-order-independent SHA-256 content fingerprint.
 */
export function fingerprintTeamFinalContent(payload: JsonObject): TeamFinalContentFingerprint {
  return `sha256:${createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')}` as TeamFinalContentFingerprint
}

/**
 * Bind a summary to its complete ordered source Envelope values.
 * @param envelopes - Exact committed source values in WAL order.
 * @returns A key-order-independent SHA-256 source fingerprint.
 */
export function fingerprintChannelSummarySources(envelopes: readonly TeamEnvelope[]): ChannelSummarySourceFingerprint {
  return `sha256:${createHash('sha256').update(canonicalJson(envelopes as unknown as JsonValue), 'utf8').digest('hex')}` as ChannelSummarySourceFingerprint
}

/**
 * Bind an authenticated human to an explicit summary selection rather than generated text.
 * @param teamId - Team owning the selected channel.
 * @param input - Exact channel, source range, cursor and retry identity.
 * @returns Complete facts for the current human proof binder.
 */
export function channelSummaryHumanProofInput(teamId: TeamId, input: ChannelSummarySelectionInput): TeamHumanActorProofInput {
  return {
    teamId, operation: 'send', fence: { kind: 'cursor', cursor: input.expectedCursor },
    payload: { operation: 'channel-summary', channelId: input.channelId, expectedCursor: input.expectedCursor,
      coveredSequenceRange: { ...input.coveredSequenceRange }, idempotencyKey: input.idempotencyKey },
  }
}

/**
 * Fingerprint the exact immutable channel manifest accepted by an endpoint.
 * @param manifest - complete channel configuration supplied in its invitation.
 * @returns a key-order-independent SHA-256 manifest fingerprint.
 */
export function fingerprintChannelManifest(manifest: ChannelManifest): ChannelManifestFingerprint {
  const parsed = channelManifestSchema.parse(manifest)
  return `sha256:${createHash('sha256').update(canonicalJson(parsed as unknown as JsonObject), 'utf8').digest('hex')}` as ChannelManifestFingerprint
}

/** Fingerprint the exact child service-response payload without borrowing human receipt authority.
 * @param payload - Committed child consult response content.
 * @returns Canonical SHA-256 content identity.
 */
export function fingerprintTeamChildResultContent(payload: JsonObject): import('./child-result-types.ts').TeamChildResultFingerprint {
  return `sha256:${createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')}` as import('./child-result-types.ts').TeamChildResultFingerprint
}
