/** Parent-service result acceptance and child lifecycle authority. @module @clocky/clocky-team/child-result-types */
import type { Branded } from '@clocky/clocky-brand'
import type { SessionId } from '@clocky/clocky-session/types'
import type {
  ActivationId, EnvelopeId, TeamArtifactReference, TeamChildRunAuthorization, TeamChildRunBinding,
  TeamClosureIdempotencyKey, TeamId, TeamStallReason, TeamSystemDelegationProof, TeamTaskDelegationInput,
} from './types.ts'

/** Canonical content identity of one child coordinator response. */
export type TeamChildResultFingerprint = Branded<'TeamChildResultFingerprint'>

/** Parent-task sink fact accepted before the child's service receipt or completion. */
export interface TeamDelegationResultAdmission {
  readonly binding: TeamChildRunBinding
  readonly requestEnvelopeId: EnvelopeId
  readonly requestSequence: number
  readonly responseEnvelopeId: EnvelopeId
  readonly responseSequence: number
  readonly contentFingerprint: TeamChildResultFingerprint
  readonly text: string
  readonly artifacts: readonly TeamArtifactReference[]
  /** Parent task revision containing this immutable result. */
  readonly parentTaskRevision: number
  /** Parent journal sequence that first retains this result. */
  readonly parentCursor: number
  readonly admittedAt: number
}

/** Exact parent task fence and immutable child response selected by its delegation owner. */
export interface TeamTaskDelegationResultAdmitInput extends TeamTaskDelegationInput {
  readonly childTeamId: TeamId
  readonly responseEnvelopeId: EnvelopeId
}
/** The delegation source may admit one result, but cannot settle the task before its child finishes. */
export interface TeamTaskDelegationResultAdmitScope extends TeamTaskDelegationResultAdmitInput {
  readonly kind: 'delegation-result-admit'
}
/** Runtime-only source authority accompanies the complete JSON result selection. */
export interface TeamTaskDelegationResultAdmitRequest extends TeamTaskDelegationResultAdmitInput {
  readonly actor: TeamSystemDelegationProof
}

/** Child-journal evidence that its exact result was accepted by the parent-task sink. */
export interface TeamChildResultAdmission {
  readonly parent: TeamDelegationResultAdmission
  readonly admittedAt: number
}

declare const teamSystemChildResultProofBrand: unique symbol
/** One live child-result owner proof; it grants neither human output nor generic service receipts. */
export interface TeamSystemChildResultProof { readonly [teamSystemChildResultProofBrand]: never }

/** Complete only the child whose exact parent result has already been durably admitted. */
export interface TeamChildResultCompleteScope {
  readonly kind: 'child-result-complete'
  readonly binding: TeamChildRunBinding
  readonly admission: TeamDelegationResultAdmission
  readonly expectedCursor: number
}
/** The current TeamRun owner may report an actual coordinator turn ending without a service response. */
export interface TeamChildResultMissingScope {
  readonly kind: 'child-result-missing'
  readonly binding: TeamChildRunBinding
  readonly expectedCursor: number
  readonly activationId: ActivationId
  readonly sessionId: SessionId
  readonly provider: string
  readonly turn: number
}
/** Child-only result and missing-response operations. */
export type TeamSystemChildResultScope = TeamChildResultCompleteScope | TeamChildResultMissingScope
/** Sources retain their own runtime owner or delegation saga; durable ids are not proof. */
export interface TeamSystemChildResultProofSource {
  readonly name: 'team-run' | 'team-delegation'
  /** Resolve a live exact-result proof. @param proof - Source token. @returns Scope, or undefined after revocation. */
  resolveChildResultProof(proof: TeamSystemChildResultProof): TeamSystemChildResultScope | undefined
}
/** Source attribution retained only during the Hub command. */
export interface TeamSystemChildResultProofResolution {
  readonly sourceName: 'team-run' | 'team-delegation'
  readonly scope: TeamSystemChildResultScope
}
/** Child result commands select only their owned child and current journal cursor on the JSON plane. */
export interface TeamChildResultCommandRequest {
  readonly actor: TeamSystemChildResultProof
  readonly childTeamId: TeamId
  readonly expectedCursor: number
}
/** Record cancellation before the runtime releases even an unpublished child bootstrap. */
export interface TeamChildCancelRequest {
  readonly authorization: TeamChildRunAuthorization
  readonly childTeamId: TeamId
  readonly expectedCursor: number
  readonly idempotencyKey: TeamClosureIdempotencyKey
  readonly reason: TeamStallReason
}
