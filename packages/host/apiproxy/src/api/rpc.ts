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
import type { ChannelId, TeamId, TeamTaskId } from '@clocky/clocky-team/types'

/**
 * Message correlation id: the initiator mints it on a request; a response
 * echoes the matching request's rpcId and never mints a new one.
 */
export type RpcId = Branded<'rpc-id'>

/** Opaque principal-generation discriminator; possession grants no authorization. */
export type ProductAuthorizationScope = Branded<'ProductAuthorizationScope'>

/** Private WebSocket protocol code for retirement of an authenticated product call. */
export const PRODUCT_AUTHENTICATION_RETIRED_CLOSE_CODE = 4001

/** Structured transport denial which consumers can distinguish from ordinary network failure. */
export class ApiAccessDeniedError extends Error {
  /** Stable product-access classification shared by physical carriers. */
  readonly code = 'PRODUCT_AUTH_INVALID'
  /**
   * @param path - Logical transport path without request data.
   * @param status - HTTP denial status.
   */
  constructor(path: string, readonly status: 401 | 403) {
    super(`transport failure for ${path}: HTTP ${status}`)
  }
}

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
  /** The actor grant excludes a requested workspace mode, path scope, or budget. */
  'TEAM_GRANT_DENIED': { teamId?: TeamId }
  /** Immutable Team rules require the dedicated execution owner for this product mutation. */
  'TEAM_POLICY_DENIED': { teamId?: TeamId }
  /** A runtime-only Team actor proof is forged, stale, revoked, or outside its payload fence. */
  'TEAM_ACTOR_PROOF_INVALID': { teamId?: TeamId }
  'team-service-unavailable': {}
  'team-run-unavailable': { teamId?: TeamId }
  'team-not-found': { teamId: TeamId }
  'team-model-required': {}
  'team-start-conflict': {}
  /** A Team cursor moved between the caller's read and its mutation. */
  'team-cursor-conflict': { teamId?: TeamId }
  /** Product discovery continuation expired; restart at the first page without changing the selected Team. */
  'team-discovery-expired': {}
  /** A task changed after its inspection or mutation revision was selected. */
  'team-task-update-conflict': { teamId?: TeamId }
  /** Simulation product opt-in is absent; read requests cannot open native execution as a fallback. */
  'simulation-product-unavailable': {}
  /** The current principal cannot read this registered product identity. */
  'simulation-product-forbidden': {}
  /** Simulation directory query or continuation no longer satisfies its declared observation. */
  'simulation-product-invalid': {}
  /** Selected world revision, object section or authenticated continuation expired; refresh the first page. */
  'simulation-product-stale': {}
  /** Creation was not accepted because its confirmed model changed; preview and confirm again. */
  'simulation-product-model-changed': {}
  /** World creation was not accepted because its preview changed or became invalid; preview and confirm again. */
  'simulation-product-preflight-changed': {}
  /** Personnel management was not accepted because the confirmed original quote changed before durable acceptance. */
  'simulation-product-management-preview-changed': {}
  /** The provider durably refused this original update; the command cannot execute later. */
  'team-task-update-rejected': { rejection: import('@clocky/clocky-team/types').TeamTaskUpdateRejection }
  'team-task-stale-revision': { teamId?: TeamId; taskId?: TeamTaskId }
  /** The selected Team has no task with this identity. */
  /** A requested member does not belong to the selected Team. */
  'team-profile-stale': { teamId?: TeamId }
  'team-profile-unavailable': { teamId?: TeamId }
  'team-member-not-found': { teamId?: TeamId }
  'team-task-not-found': { teamId?: TeamId; taskId?: TeamTaskId }
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
  /** Inbox history before firstCursor is unavailable; read after firstCursor - 1 to inspect retained history. */
  'team-inbox-compacted': { firstCursor?: number }
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
 * Classify a thrown carrier failure for presentation. Explicit product-access
 * refusals keep their access code so a view can defer to the shell's
 * reauthentication banner instead of printing the transport message;
 * everything else becomes `internal`. Unlike {@link transportError}, which
 * keeps every carrier failure `internal` for retry and outcome logic, this is
 * for display state only.
 * @param error - the thrown value from the carrier.
 * @returns the classified error.
 */
export function rpcErrorFrom(error: unknown): RpcError {
  const message = error instanceof Error ? error.message : String(error)
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === 'PRODUCT_AUTH_INVALID') return { code: 'PRODUCT_AUTH_INVALID', message, details: {} }
    if (error.code === 'PRODUCT_AUTH_REQUIRED') return { code: 'PRODUCT_AUTH_REQUIRED', message, details: {} }
  }
  return { code: 'internal', message, details: {} }
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
