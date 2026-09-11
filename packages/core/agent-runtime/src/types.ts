/** AgentRuntime provider, activation-handle, and activation-request types. @module @clocky/clocky-agent-runtime/types */

import type { Agent, AgentCancelCause, AgentOptions } from '@clocky/clocky-agent'
import type { SessionEvent, SessionId } from '@clocky/clocky-session'
import type {
  ActivationBindingSnapshot,
  ActivationRecoverySnapshot,
  ActivationSnapshot,
  ActivationTerminationMode,
  ParticipantSnapshot,
  TeamId,
} from '@clocky/clocky-team'

/** Fresh, fork-seeded, or persisted-resume context supplied to one activation provider. */
export type AgentRuntimeSeed =
  | { readonly kind: 'fresh' }
  | {
    readonly kind: 'fork'
    /** Session whose durable history supplied the fork prefix. */
    readonly sourceSessionId: SessionId
    /** Source history copied into the new Session before its seed marker. */
    readonly events: readonly SessionEvent[]
  }
  | { readonly kind: 'resume' }

/** Agent composition selected by the Team/Host before activation. */
export interface AgentRuntimeAgentSpec {
  /** Durable preset identifier selected for the local Session composition, if any. */
  readonly preset?: string
  /** Execution root recorded in a fresh local Session header when this provider owns one. */
  readonly cwd?: string
  /** Provider/model options supplied to the Agent factory. */
  readonly options: AgentOptions
}

/** Provider-resolved request to activate one existing Team participant. */
export interface AgentRuntimeActivationRequest {
  /** Registered activation provider selected by the caller. */
  readonly provider: string
  /** Team that owns the logical participant and activation epoch. */
  readonly teamId: TeamId
  /** Complete stable participant descriptor resolved by the Team owner. */
  readonly participant: ParticipantSnapshot
  /** Durable Session identity reserved for this local activation. */
  readonly sessionId: SessionId
  /** Fresh, fork-seeded, or persisted-resume context selected before activation. */
  readonly seed: AgentRuntimeSeed
  /** Agent preset and provider/model options for the activation. */
  readonly agent: AgentRuntimeAgentSpec
  /** Cancellation before the provider publishes an activation handle. */
  readonly signal: AbortSignal
}

/** One provider-owned live residency epoch for a Team participant. */
export interface ActivationHandle {
  /** Immutable provider-minted activation projection. */
  readonly activation: ActivationSnapshot
  /** Session selected for this activation, even if its Agent is remote. */
  readonly sessionId: SessionId
  /** Exact in-process Agent when the provider published one locally. */
  readonly localAgent: Agent | undefined
  /** Optional durable recovery facts returned by a provider that supports cold replacement. */
  readonly recovery?: ActivationRecoverySnapshot | undefined
  /**
   * Read the current immutable residency projection for this epoch.
   * @returns the provider's current activation status; an ended local epoch resolves as `offline`.
   */
  health(): Promise<ActivationSnapshot>
  /**
   * Observe later immutable residency changes for this exact activation epoch.
   * The provider contains listener failures; subscribing does not replay the
   * current status, so callers read {@link health} before relying on updates.
   * @param listener - callback for a subsequent provider-observed status change.
   * @returns an idempotent listener disposer.
   */
  onStatus(listener: (activation: ActivationSnapshot) => void): () => void
  /**
   * Stop the currently executing turn without asserting Team or parent authority.
   * @param cause - cancellation cause recorded by the local Agent when present.
   */
  interrupt(cause: AgentCancelCause): void
  /**
   * Stop admission owned by this activation and release its provider resources.
   * @returns resolution after the provider reaches its activation-local terminal state.
   */
  dispose(): Promise<void>
}

/** One named provider of participant activation epochs. */
export interface AgentRuntimeProvider {
  /** Unique registry name for this placement implementation. */
  readonly name: string
  /** Evidence the provider owns when terminating an activation. */
  readonly terminationMode: ActivationTerminationMode
  /**
   * Publish one Participant-bound activation handle.
   * A request joining an already-live epoch returns that epoch's exact existing
   * handle, so registry observers emit one notification per handle identity.
   * @param request - Team-resolved participant, Session, seed, composition, and cancellation data.
   * @returns a handle only after the provider has published its residency epoch.
   */
  activate(request: AgentRuntimeActivationRequest): Promise<ActivationHandle>
}

/** Diagnostic identity for one registered activation provider. */
export interface AgentRuntimeProviderRef {
  /** Unique registry name for this placement implementation. */
  readonly name: string
}

/** One trusted external owner able to fence a stale activation epoch before cold replacement. */
export interface AgentRuntimeFencer {
  /** AgentRuntime provider name whose activation epochs this owner can fence. */
  readonly provider: string
  /**
   * Verify that this deployment owns the persisted recovery plan without
   * signaling a process.
   * @param binding - durable epoch identity selected by the Team recovery owner.
   */
  validate(binding: ActivationBindingSnapshot): void
  /**
   * Stop and prove terminal one exact stale epoch before another epoch may use
   * its Participant and Session identity.
   * @param binding - durable epoch identity selected by the Team recovery owner.
   * @returns resolution only after the old execution cannot send or settle Team work.
   */
  fence(binding: ActivationBindingSnapshot): Promise<void>
}
