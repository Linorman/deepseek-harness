/** Principal inbox contracts, independent of Agent Activations and Session transcripts. @module @clocky/clocky-team/human-delivery-types */
import type { AuthenticatedProductCall, ProductPrincipalId } from '@clocky/clocky-product-principal'
import type { TeamChannelViewEventData } from '@clocky/clocky-session/types'
import type { TeamFinalAdmissionInput, ParticipantId, TeamId, ChannelId, EnvelopeId, TeamEnvelope, ChannelReceiptRecord, TeamHumanActionSnapshot, TeamHumanActionId } from './types.ts'

/** Exact Hub-authorized final content submitted to a principal-owned durable sink. */
export interface TeamHumanFinalInput extends TeamFinalAdmissionInput {
  /** Durable principal identity derived by the Hub from the human owner. */
  readonly principalId: ProductPrincipalId
  /** Human Participant selected from the committed final audience. */
  readonly recipientId: ParticipantId
  /** Exact final text retained by the channel WAL. */
  readonly text: string
}
/** One durable principal delivery; its sequence belongs exclusively to the inbox. */
export interface TeamHumanInboxFinal extends TeamHumanFinalInput {
  /** Closed delivery kind. */
  readonly kind: 'final'
  /** Zero-based inbox log sequence, independent of channel and Team cursors. */
  readonly sequence: number
}
/** Actor-free bounded page selection. Omission resumes after the shared display cursor. */
export interface TeamHumanInboxReadInput {
  readonly afterCursor?: number | undefined
  readonly limit?: number | undefined
}
/** Shared principal display acknowledgement; this never creates a channel receipt. */
export interface TeamHumanInboxAcknowledgeInput {
  readonly throughCursor: number
}
/** Page with monotonic principal-wide display position and bounded continuation. */
export interface TeamHumanInboxPage {
  readonly items: readonly TeamHumanInboxItem[]
  readonly displayCursor: number
  readonly cursor: number
  readonly nextCursor?: number | undefined
}
/** Durable display position returned after acknowledgement. */
export interface TeamHumanInboxAcknowledgement {
  readonly displayCursor: number
}
/** Provider-owned principal inbox consumed by Hub admission and authenticated product APIs. */
export interface TeamHumanDeliveryRuntime {
  /**
   * Persist the exact authorized final before Hub admission or receipt.
   * @param input - Hub-authorized exact final content.
   * @param proof - Runtime-only Hub final-admission proof.
   * @returns Durable inbox delivery.
   */
  admitFinal(input: TeamHumanFinalInput, proof: TeamHumanSinkProof): Promise<TeamHumanInboxFinal>
  /**
   * Persist a Hub-authorized ordinary delivery.
   * @param input - Exact Envelope and optional rendered view.
   * @param proof - Runtime-only Hub human-delivery proof.
   * @returns Durable inbox item.
   */
  admitMessage(input: TeamHumanMessageInput, proof: TeamHumanSinkProof): Promise<TeamHumanInboxMessage>
  /**
   * Recover a receipt's existing sink.
   * @param input - Hub-validated owner and Envelope.
   * @param proof - Runtime-only Hub human-delivery proof.
   * @returns Exact admission, or undefined.
   */
  getMessageAdmission(input: Pick<TeamHumanMessageInput, 'principalId' | 'teamId' | 'envelopeId'>, proof: TeamHumanSinkProof): Promise<TeamHumanInboxMessage | undefined>
  /**
   * Register a live action continuation owner.
   * @param responder - Host-owned continuation resolver.
   * @returns Registration disposer.
   */
  registerActionResponder(responder: TeamHumanActionResponder): () => void
  /**
   * Answer one exact durable request.
   * @param call - Authenticated principal.
   * @param input - Actor-free answer and retry fence.
   * @returns Durable acceptance or unavailable result.
   */
  respond(call: AuthenticatedProductCall, input: TeamHumanActionResponseInput): Promise<TeamHumanActionResponseResult>
  /**
   * Read one bounded authorized page.
   * @param call - Current authenticated transport lease.
   * @param input - Actor-free pagination.
   * @returns Visible inbox page.
   */
  read(call: AuthenticatedProductCall, input: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage>
  /**
   * Wait within the deployment timeout for a fresh page.
   * @param call - Revocable authenticated call.
   * @param input - Actor-free pagination.
   * @returns Visible page or an empty timeout result.
   */
  watch(call: AuthenticatedProductCall, input: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage>
  /**
   * Persist a monotonic shared display position.
   * @param call - Current authenticated call.
   * @param input - Retained delivery selected by the client.
   * @returns Durable shared display cursor.
   */
  acknowledge(call: AuthenticatedProductCall, input: TeamHumanInboxAcknowledgeInput): Promise<TeamHumanInboxAcknowledgement>
}
declare module '@clocky/cordis' {
  interface Context {
    /** Durable principal inbox; mounting it enables principal-owned final admission. */
    teamHumanDelivery: TeamHumanDeliveryRuntime
  }
}

/** Ordinary channel content routed to an active principal-owned human recipient. */
export interface TeamHumanMessageInput {
  readonly principalId: ProductPrincipalId
  readonly recipientId: ParticipantId
  readonly teamId: TeamId
  readonly channelId: ChannelId
  readonly envelopeId: EnvelopeId
  readonly envelope: TeamEnvelope
  readonly view?: TeamChannelViewEventData | undefined
  readonly text: string
}
/** Durable ordinary human message with exact Envelope and rendered-view provenance. */
export interface TeamHumanInboxMessage extends TeamHumanMessageInput {
  readonly kind: 'message'
  readonly sequence: number
}
/** Principal-visible deliveries share a display cursor without sharing admission authority. */
export type TeamHumanInboxItem = TeamHumanInboxFinal | TeamHumanInboxMessage | TeamHumanInboxAction

declare const teamSystemHumanDeliveryProofBrand: unique symbol
/** Runtime-only exact ordinary-delivery authority, distinct from final admission. */
export interface TeamSystemHumanDeliveryProof {
  readonly [teamSystemHumanDeliveryProofBrand]: never
}
/** One observed human pending-delivery relation selected by its Consumer. */
export interface TeamSystemHumanDeliveryScope {
  readonly teamId: TeamId
  readonly channelId: ChannelId
  readonly envelopeId: EnvelopeId
  readonly recipientId: ParticipantId
  readonly principalId: ProductPrincipalId
  readonly expectedCursor: number
}
/** Effect-scoped owner of exact ordinary human delivery proofs. */
export interface TeamSystemHumanDeliveryProofSource {
  readonly name: 'team-human-client'
  /** Resolve a live exact-delivery token. @param proof - Source-owned runtime proof. @returns Scope, or undefined after revocation. */
  resolveHumanDeliveryProof(proof: TeamSystemHumanDeliveryProof): TeamSystemHumanDeliveryScope | undefined
}
/** Trusted Consumer request; none of its identities grant authority without the proof. */
export interface TeamHumanChannelDeliveryRequest extends TeamSystemHumanDeliveryScope {
  readonly actor: TeamSystemHumanDeliveryProof
}
/** Already-durable admission and recipient receipt for one ordinary human delivery. */
export interface TeamHumanChannelDeliveryResult {
  readonly item: TeamHumanInboxMessage
  readonly receipt: ChannelReceiptRecord
}

/** Principal-owned projection of one durable approval/question revision. */
export interface TeamHumanInboxAction {
  readonly kind: 'action'
  readonly sequence: number
  readonly principalId: ProductPrincipalId
  readonly recipientId: ParticipantId
  readonly teamId: TeamId
  readonly action: TeamHumanActionSnapshot
  readonly text: string
}
/** Closed human answers; the continuation owner validates selected question options. */
export type TeamHumanActionAnswer =
  | { readonly kind: 'approval'; readonly outcome: 'allowed-once' | 'rejected' }
  | { readonly kind: 'question'; readonly answers: readonly { readonly id: string; readonly selected: readonly string[]; readonly custom?: string | undefined }[] }
/** Stable retry identity for one exact human response. */
export type TeamHumanActionResponseIdempotencyKey = import('@clocky/clocky-brand').Branded<'TeamHumanActionResponseIdempotencyKey'>
/** Actor-free response binds a request revision and the complete typed answer. */
export interface TeamHumanActionResponseInput {
  readonly teamId: TeamId
  readonly actionId: TeamHumanActionId
  readonly expectedUpdatedAt: number
  readonly idempotencyKey: TeamHumanActionResponseIdempotencyKey
  readonly answer: TeamHumanActionAnswer
}
/** Durable answer acceptance precedes notifying the original continuation. */
export interface TeamHumanActionResponseSnapshot {
  readonly expectedUpdatedAt: number
  readonly idempotencyKey: TeamHumanActionResponseIdempotencyKey
  readonly answer: TeamHumanActionAnswer
  readonly respondedBy: ParticipantId
  readonly acceptedAt: number
}
/** Accepted is an answer-admission fact, not proof of tool completion. */
export interface TeamHumanActionResponseResult {
  readonly kind: 'accepted' | 'unavailable'
  readonly action: TeamHumanActionSnapshot
}
/** Runtime provider retains actual callbacks; durable ids alone cannot recreate them. */
export interface TeamHumanActionResponder {
  /**
   * Answer only a currently owned callback.
   * @param call - Authenticated principal.
   * @param input - Exact answer.
   * @returns Result or undefined when not owned.
   */
  respond(call: AuthenticatedProductCall, input: TeamHumanActionResponseInput): Promise<TeamHumanActionResponseResult | undefined>
  /**
   * Settle a verified missing continuation safely.
   * @param call - Authenticated principal.
   * @param input - Exact requested action.
   * @returns Existing acceptance or explicit unavailability.
   */
  unavailable(call: AuthenticatedProductCall, input: TeamHumanActionResponseInput): Promise<TeamHumanActionResponseResult>
}


declare const teamHumanSinkProofBrand: unique symbol
/** Runtime-only admission capability minted by the authoritative Team provider. */
export interface TeamHumanSinkProof { readonly [teamHumanSinkProofBrand]: never }
/** Exact sink operation authorized only during its corresponding Hub command. */
export type TeamHumanSinkScope =
  | { readonly kind: 'final'; readonly input: TeamHumanFinalInput }
  | { readonly kind: 'message'; readonly input: TeamHumanMessageInput }
  | { readonly kind: 'message-read'; readonly input: Pick<TeamHumanMessageInput, 'principalId' | 'teamId' | 'envelopeId'> }
