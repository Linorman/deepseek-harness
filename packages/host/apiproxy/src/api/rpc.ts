/**
 * Four-quadrant RPC message model. Channels and messages are decoupled: HTTP,
 * WebSocket, and in-process SSE are physical carriers, while logical messages
 * are channel-independent and form a four-member discriminated union.
 * api/ contract layer: zero Node dependencies, importable from the browser.
 */

import type { z as zCore } from 'zod'
type ZodIssue = zCore.core.$ZodIssue
import type { Branded } from '@clocky/clocky-brand'
import type { MessageId } from '@clocky/clocky-llm/brand'
import type { SessionId } from '@clocky/clocky-session/types'
import type { ChannelId, TeamId } from '@clocky/clocky-team/types'

/**
 * Message correlation id: the initiator mints it on a request; a response
 * echoes the matching request's rpcId and never mints a new one.
 */
export type RpcId = Branded<'rpc-id'>

/**
 * Brands a string as RpcId (same precedent as core `SessionId()`). Minted by the initiator:
 * client-request → client mints; server-request → host mints (answerable frames get a stable
 * logical id, pure pushes mint a fresh one each time).
 * @param id - Raw id string (implementations mint UUIDs; tests may pass fixtures).
 * @returns The same string, branded (compile-time cast, zero runtime cost).
 */
export function RpcId(id: string): RpcId {
  return id as RpcId
}

/** Error code → details type map (a second table isomorphic to RpcMethodMap). New code = one row here + one branch in the error schema. */
export interface RpcErrorDetailsMap {
  'bad-request': { issues: ZodIssue[] }
  'cancelled': {}
  'session-not-found': { sessionId: SessionId }
  'model-unavailable': { provider: string; model: string }
  'model-not-configured': {}
  'invalid-time-zone': { value: string }
  'workspace-not-found': { workspaceId: string }
  'workspace-invalid-path': { path: string }
  'workspace-name-conflict': { name: string }
  'workspace-move-invalid': { workspaceId: string; sessionId: SessionId; beforeSessionId?: SessionId }
  'directory-unreadable': { path: string }
  'directory-exists': { path: string }
  'directory-create-failed': { path: string }
  'directory-picker-unavailable': { capability: string }
  'agent-preset-read-only': { agentPreset: string; reason: string }
  'agent-preset-locked': { sessionId: SessionId; agentPreset: string }
  'agent-preset-not-found': { agentPreset: string; available: string[] }
  'agent-preset-invalid': { agentPreset: string; reason: string }
  'agent-busy': { reason: string }
  'attachment-error': { reason: string }
  'queue-item-not-found': { itemId: MessageId }
  'steer-unavailable': { itemId: MessageId }
  /** A known slash command reported a usage/state error; the message is the command's own text. */
  'command-error': {}
  /** A leading-/ prompt named no registered command; the message names the token. */
  'unknown-command': {}
  /**
   * A settings write was refused (schema validation, unknown namespace,
   * read-only provider, or storage failure); the message is the seam's text.
   */
  'settings-rejected': { ns: string }
  /**
   * A settings write carried an `expectedRevision` the namespace has already
   * moved past: another writer (tab, editor, or an external file edit) landed
   * first. The details carry both revisions so a client can re-read and retry.
   */
  'settings-conflict': { ns: string; expected: number; actual: number }
  /** A credential write was refused (read-only shadowing layer or storage failure); the message is the seam's own text. */
  'credential-rejected': { ref: string }
  /**
   * Interrogating a draft provider endpoint did not produce a model listing:
   * no adapter family serves the namespace, the protocol has no listing this
   * build can read, or the endpoint was unreachable, refused the credential,
   * or answered with something else. The message is the adapter's own text —
   * it is what the form shows before falling back to hand-entry — and the
   * details name the endpoint asked, never the credential offered.
   */
  'model-discovery-failed': { settingsNs: string; baseURL?: string }
  'title-invalid': { sessionId: SessionId }
  /** A Team mutation reached the Host API without a transport-authenticated product principal. */
  'PRODUCT_AUTH_REQUIRED': {}
  /** A transport credential or its retained product-principal lease is invalid. */
  'PRODUCT_AUTH_INVALID': {}
  /** The authenticated principal owns no active human participant in the selected Team. */
  'TEAM_HUMAN_ACTOR_NOT_FOUND': { teamId?: TeamId }
  /** The authenticated principal maps to more than one active human participant in the selected Team. */
  'TEAM_HUMAN_ACTOR_AMBIGUOUS': { teamId?: TeamId }
  /** The selected human participant's immutable grant denies this operation. */
  'TEAM_HUMAN_ACTOR_FORBIDDEN': { teamId?: TeamId }
  /** A runtime-only Team actor proof is forged, stale, revoked, or outside its payload fence. */
  'TEAM_ACTOR_PROOF_INVALID': { teamId?: TeamId }
  'team-service-unavailable': {}
  'team-run-unavailable': { teamId?: TeamId }
  'team-not-found': { teamId: TeamId }
  'team-model-required': {}
  'team-start-conflict': {}
  /** A Team cursor moved between the caller's read and its mutation. */
  'team-cursor-conflict': { teamId?: TeamId }
  /** A channel cursor or invitation revision moved before its mutation. */
  'team-invalid-argument': { teamId?: TeamId }
  'team-channel-cursor-conflict': { teamId?: TeamId; channelId?: ChannelId }
  /** A sender reused one channel post key with different canonical fields. */
  'team-channel-idempotency-conflict': { teamId?: TeamId; channelId?: ChannelId }
  'team-final-invalid': { teamId: TeamId }
  'team-not-quiescent': { teamId: TeamId }
  /** A channel read started before a physically compacted WAL prefix. */
  'team-channel-compacted': { teamId?: TeamId; channelId?: ChannelId; firstCursor?: number }
  /** An audit read started before a physically compacted audit prefix. */
  'team-audit-compacted': { teamId?: TeamId; channelId?: ChannelId; firstCursor?: number }
  'team-artifact-not-found': { teamId: TeamId; artifactId: string }
  'team-artifact-unavailable': { teamId: TeamId; artifactId: string }
  'internal': {}
}

/** Closed error-code union (the keys of RpcErrorDetailsMap). */
export type RpcErrorCode = keyof RpcErrorDetailsMap

/**
 * Distributive union expanded from the map: code is the discriminant, so
 * `switch (error.code)` narrows details. details is required (internal uses an explicit {}).
 */
export type RpcError = {
  [C in RpcErrorCode]: { code: C; message: string; details: RpcErrorDetailsMap[C] }
}[RpcErrorCode]

/** Business success/failure result: the result slot of a unary response; methods never throw business errors. */
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError }

/**
 * Fold a transport exception into the RpcResult error branch (unified error
 * API; 'internal' as the catch-all code). Lives with RpcResult so every
 * carrier consumer folds the same way.
 * @param error - the thrown value from the carrier.
 * @returns the error branch of an RpcResult.
 */
export function transportError<T>(error: unknown): RpcResult<T> {
  return {
    ok: false,
    error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} },
  }
}

/**
 * Signature-layer narrow form, request side (domain-interface view, shared by
 * both directions): rpcId is explicit in the signature, never mixed into the
 * business payload; the type tag and method are filled in by the carrier layer.
 */
export interface RpcRequest<P> {
  rpcId: RpcId
  payload: P
}

/** Signature-layer narrow form, response side: rpcId always echoes the matching request. */
export interface RpcResponse<T> {
  rpcId: RpcId
  result: RpcResult<T>
}

// ---- Wire full forms: four named members of a discriminated union (discriminant = the four `type` literals) ----

/** Call initiated by the client (wire carrier: POST /api/<method> body). */
export interface ClientRequest {
  type: 'client-request'
  rpcId: RpcId
  method: string
  payload: unknown
}

/** Response to a ClientRequest (wire carrier: the HTTP response body of that POST); rpcId echoed. */
export interface ServerResponse {
  type: 'server-response'
  rpcId: RpcId
  result: RpcResult<unknown>
}

/**
 * Message initiated by the server (wire carrier: downstream stream frame). Answerable interactions
 * (approval/question requested — stable rpcId, reused on replay) and pure pushes
 * (session/event etc. — rpcId identifies that one push) share this shape; whether a
 * response is expected is determined statically by method (a strict dichotomy, no third kind).
 */
export interface ServerRequest {
  type: 'server-request'
  rpcId: RpcId
  method: string
  payload: unknown
}

/** Response to a ServerRequest (wire carrier: POST /api/respond body); rpcId echoed, never minted anew. */
export interface ClientResponse {
  type: 'client-response'
  rpcId: RpcId
  result: RpcResult<unknown>
}

/** Authoritative wire full-form union; narrow via `switch (message.type)`. */
export type RpcMessage = ClientRequest | ServerResponse | ServerRequest | ClientResponse

/**
 * Carrier receipt (not an RpcMessage — it belongs to the carrier layer, same
 * discipline as "HTTP status describes only the carrier"): the HTTP response
 * body of the POST carrying a client-response. Late/duplicate responses yield not-pending.
 */
export type RpcReceipt = { accepted: true } | { accepted: false; reason: 'not-pending' | 'bad-response' }
