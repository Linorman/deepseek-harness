/** Typed errors raised by the AgentRuntime provider registry. @module @clocky/clocky-agent-runtime/error */

/** Stable machine-routable AgentRuntime failure code. */
export type AgentRuntimeErrorCode =
  | 'AGENT_RUNTIME_PROVIDER_INVALID'
  | 'AGENT_RUNTIME_PROVIDER_DUPLICATE'
  | 'AGENT_RUNTIME_PROVIDER_NOT_FOUND'
  | 'AGENT_RUNTIME_FENCER_INVALID'
  | 'AGENT_RUNTIME_FENCER_DUPLICATE'
  | 'AGENT_RUNTIME_ACTIVATION_MISMATCH'
  | 'AGENT_RUNTIME_ACTIVATION_STATUS_INVALID'
  | 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED'

/** Error raised when the AgentRuntime registry cannot honor its public contract. */
export class AgentRuntimeError extends Error {
  /** Stable machine-routable error classification. */
  readonly code: AgentRuntimeErrorCode

  /**
   * @param message - Human-readable rejection reason.
   * @param code - Stable machine-routable error classification.
   * @param options - Optional cause retained for diagnostics.
   */
  constructor(message: string, code: AgentRuntimeErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AgentRuntimeError'
    this.code = code
  }
}

/** Error raised when a provider cannot prove that a remote activation stopped. */
export class AgentRuntimeTerminationUnconfirmedError extends AgentRuntimeError {
  /** @param message - Diagnostic explaining which provider termination proof failed. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED', options)
    this.name = 'AgentRuntimeTerminationUnconfirmedError'
  }
}

/**
 * Test whether an unknown provider failure leaves a remote activation termination unconfirmed.
 * @param error - Unknown failure value raised by an AgentRuntime operation.
 * @returns whether the value carries the unconfirmed-termination error code.
 */
export function isAgentRuntimeTerminationUnconfirmed(
  error: unknown,
): error is AgentRuntimeError & { readonly code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED' } {
  return error instanceof AgentRuntimeError && error.code === 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED'
}
