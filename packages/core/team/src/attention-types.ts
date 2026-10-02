/** Team-scoped pending responsibilities and revision-pinned product pagination. */
import type { TeamId, TeamTaskId, TeamHumanActionId, TeamSelectionText, TeamDelegationId, ParticipantId, TeamHumanActorProof } from './types.ts'

/** Authoritative pending counts, independent of loaded task or inbox windows. */
export interface TeamAttentionCounts {
  readonly recovery: number
  readonly humanActions: number
  readonly reviews: number
  readonly total: number
}

/** Current permission/lifecycle hint; the eventual command revalidates it. */
export type TeamAttentionHandling =
  | { readonly kind: 'actionable' }
  | { readonly kind: 'waiting'
    readonly reason: 'parent-inspection' | 'not-authorized' | 'team-inactive'
    | 'simulation-managed' | 'closure-in-progress' | 'reviewer-required' | 'response-accepted'
    | 'source-changed' | 'recovery-owner-required' | 'already-processed' }

/** Exact source identities used to sort and continue the pending collection. */
export type TeamAttentionPosition =
  | { readonly kind: 'team-recovery'
    readonly id: TeamId
    readonly createdAt: number }
  | { readonly kind: 'task-recovery' | 'task-review'
    readonly id: TeamTaskId
    readonly createdAt: number }
  | { readonly kind: 'human-action'
    readonly id: TeamHumanActionId
    readonly createdAt: number }

/** Bounded responsibility summary; action bodies and task results have separate readers. */
export type TeamAttentionItem = TeamAttentionPosition & { readonly handling: TeamAttentionHandling } & (
  | { readonly kind: 'team-recovery'
    readonly reason: { readonly code: string
      readonly message: TeamSelectionText } }
  | { readonly kind: 'task-recovery'
    readonly revision: number
    readonly subject: TeamSelectionText
    readonly delegationId: TeamDelegationId
    readonly childTeamId?: TeamId | undefined
    readonly reason?: { readonly code: string
      readonly message: TeamSelectionText } | undefined }
  | { readonly kind: 'task-review'
    readonly revision: number
    readonly subject: TeamSelectionText
    readonly reviewerId: ParticipantId }
  | { readonly kind: 'human-action'
    readonly updatedAt: number
    readonly actionKind: 'approval' | 'question' }
)

/** A continuation identifies one exact pending position, never an authority grant. */
export interface TeamAttentionCursor {
  readonly teamId: TeamId
  readonly teamCursor: number
  readonly order: 'attention-priority-time-id-v1'
  readonly position: TeamAttentionPosition
}

/** Product input without a caller-selected actor or permission set. */
export interface TeamAttentionReadInput {
  readonly teamId: TeamId
  readonly cursor?: TeamAttentionCursor | undefined
  readonly limit?: number | undefined
}

/** Current human or canonical parent read proof retained through the owning serializer. */
export interface TeamAttentionReadRequest extends TeamAttentionReadInput {
  readonly actor: TeamHumanActorProof
}

/** One internally consistent, bounded pending page. */
export interface TeamAttentionPage {
  readonly teamId: TeamId
  readonly teamCursor: number
  readonly counts: TeamAttentionCounts
  readonly items: readonly TeamAttentionItem[]
  readonly nextCursor?: TeamAttentionCursor | undefined
}

/** Exact human request selected independently of pending-list pagination. */
export interface TeamActionInspectInput {
  readonly teamId: TeamId
  readonly actionId: TeamHumanActionId
}

/** Current read proof bound to this exact request identity. */
export interface TeamActionInspectRequest extends TeamActionInspectInput {
  readonly actor: TeamHumanActorProof
}

/** Current request body and handling hint at one Team journal revision. */
export interface TeamActionInspection {
  readonly teamId: TeamId
  readonly teamCursor: number
  readonly action: import('./types.ts').TeamHumanActionSnapshot
  readonly handling: TeamAttentionHandling
}
