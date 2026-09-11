/** Typed failures raised by the in-process AgentRuntime provider. @module @clocky/clocky-agent-runtime-in-process/error */

/** Stable machine-routable in-process activation failure code. */
export type AgentRuntimeInProcessErrorCode =
  | 'AGENT_RUNTIME_IN_PROCESS_CLOSED'
  | 'AGENT_RUNTIME_IN_PROCESS_PARTICIPANT_UNSUPPORTED'
  | 'AGENT_RUNTIME_IN_PROCESS_PRESET_UNAVAILABLE'
  | 'AGENT_RUNTIME_IN_PROCESS_SESSION_PROVENANCE_MISMATCH'
  | 'AGENT_RUNTIME_IN_PROCESS_SESSION_MISMATCH'

/** Error raised when the local placement provider cannot honor an activation request. */
export class AgentRuntimeInProcessError extends Error {
  /** Stable machine-routable error classification. */
  readonly code: AgentRuntimeInProcessErrorCode

  /**
   * @param message - Human-readable rejection reason.
   * @param code - Stable machine-routable error classification.
   * @param options - Optional cause retained for diagnostics.
   */
  constructor(message: string, code: AgentRuntimeInProcessErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AgentRuntimeInProcessError'
    this.code = code
  }
}
