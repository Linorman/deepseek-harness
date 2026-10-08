/** Canonical payload binding for authenticated human proofs and durable Team results. @module @clocky/clocky-team/human-actor */

import { createHash } from 'node:crypto'
import { channelManifestSchema, jsonObjectSchema, teamHumanActorProofInputSchema } from './schema.ts'
import type {
  ChannelManifest,
  ChannelOpenInput,
  ChannelCloseInput,
  TeamTaskCreateInput,
  TeamTaskDetailsUpdateInput,
  TeamTaskCancelInput,
  TeamTaskDeleteInput,
  TeamTaskReviewResolveInput,
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

/**
 * Fingerprint one complete durable owner projection for checkpoint reference verification.
 * @param payload - JSON projection with optional undefined fields already removed by serialization.
 * @returns canonical SHA-256 projection identity.
 */
export function fingerprintTeamPersistenceProjection(payload: JsonValue): import('./persistence-reference.ts').TeamPersistenceFingerprint {
  return `sha256:${createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')}` as import('./persistence-reference.ts').TeamPersistenceFingerprint
}

/** Bind the complete actor-free channel-open facts to the current authenticated human.
 * @param input - Parsed channel request, including the owning Team and cursor fence.
 * @returns the exact payload admitted by the human proof binder.
 */
export function channelOpenHumanProofInput(input: ChannelOpenInput): TeamHumanActorProofInput {
  return channelCursorProofInput(input.teamId, 'channel-open', input)
}

/** Bind channel-close facts to the Team resolved by the serving transport.
 * @param teamId - Server-resolved channel owner.
 * @param input - Parsed actor-free close request and cursor fence.
 * @returns the exact payload admitted by the human proof binder.
 */
export function channelCloseHumanProofInput(teamId: TeamId, input: ChannelCloseInput): TeamHumanActorProofInput {
  return channelCursorProofInput(teamId, 'close', input)
}

/** Capture the complete parsed payload; transport-specific lookup stays with the caller. */
function channelCursorProofInput(
  teamId: TeamId, operation: 'channel-open' | 'close', input: ChannelOpenInput | ChannelCloseInput,
): TeamHumanActorProofInput {
  return { teamId, operation, fence: { kind: 'cursor', cursor: input.expectedCursor },
    payload: jsonObjectSchema.parse(structuredClone(input)) }
}

/** Bind the complete parsed task creation to the current authenticated human.
 * @param input - Actor-free task creation and Team cursor fence.
 * @returns exact complete payload for task-mutation admission.
 */
export function taskCreateHumanProofInput(input: TeamTaskCreateInput): TeamHumanActorProofInput {
  return { teamId: input.teamId, operation: 'task-mutate', fence: { kind: 'cursor', cursor: input.expectedCursor },
    payload: jsonObjectSchema.parse(structuredClone(input)) }
}

/** Bind the complete parsed revision-fenced task mutation to the current authenticated human.
 * @param input - Actor-free details update, cancellation or tombstone.
 * @returns exact payload and task revision fence for admission.
 */
export function taskRevisionHumanProofInput(
  input: TeamTaskDetailsUpdateInput | TeamTaskCancelInput | TeamTaskDeleteInput,
): TeamHumanActorProofInput {
  return { teamId: input.teamId, operation: 'task-mutate', fence: { kind: 'revision', revision: input.expectedRevision },
    payload: jsonObjectSchema.parse(structuredClone(input)) }
}

/** Bind the server-selected Team together with every parsed task-review fact.
 * @param teamId - Team selected by the authenticated serving transport.
 * @param input - Actor-free review decision and task revision fence.
 * @returns exact Team-qualified payload for review admission.
 */
export function taskReviewHumanProofInput(teamId: TeamId, input: TeamTaskReviewResolveInput): TeamHumanActorProofInput {
  return { teamId, operation: 'task-mutate', fence: { kind: 'revision', revision: input.expectedRevision },
    payload: jsonObjectSchema.parse({ teamId, ...structuredClone(input) }) }
}
