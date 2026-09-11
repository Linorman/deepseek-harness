/** Typed failures raised by the SDK AgentRuntime provider. @module @clocky/clocky-agent-runtime-sdk/error */

/** Stable machine-routable SDK activation failure code. */
export type AgentRuntimeSdkErrorCode =
  | 'AGENT_RUNTIME_SDK_CLOSED'
  | 'AGENT_RUNTIME_SDK_PARTICIPANT_UNSUPPORTED'
  | 'AGENT_RUNTIME_SDK_SEED_UNSUPPORTED'
  | 'AGENT_RUNTIME_SDK_PRESET_UNSUPPORTED'
  | 'AGENT_RUNTIME_SDK_AGENT_OPTIONS_INVALID'
  | 'AGENT_RUNTIME_SDK_SESSION_MISMATCH'
  | 'AGENT_RUNTIME_SDK_TARGET_MISMATCH'
  | 'AGENT_RUNTIME_SDK_STATUS_INVALID'
  | 'AGENT_RUNTIME_SDK_TEAM_LINK_UNAVAILABLE'
  | 'AGENT_RUNTIME_SDK_PRODUCT_AUTH_REQUIRED'
  | 'AGENT_RUNTIME_SDK_RECOVERY_UNAVAILABLE'
  | 'AGENT_RUNTIME_SDK_RECOVERY_BINDING_INVALID'
  | 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED'

/** Error raised when the SDK placement provider cannot honor an activation request. */
export class AgentRuntimeSdkError extends Error {
  /** Stable machine-routable SDK activation failure classification. */
  readonly code: AgentRuntimeSdkErrorCode

  /**
   * @param message - Human-readable rejection reason.
   * @param code - Stable machine-routable SDK activation failure classification.
   * @param options - Optional cause retained for diagnostics.
   */
  constructor(message: string, code: AgentRuntimeSdkErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = 'AgentRuntimeSdkError'
  }
}
