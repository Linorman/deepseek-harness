/** Narrow SDK-client dependency used by one remote AgentRuntime activation. @module @clocky/clocky-agent-runtime-sdk/client */

import { HarnessClient } from '@clocky/clocky-sdk-client'
import type { HarnessClientOptions } from '@clocky/clocky-sdk-client'

/** Public SDK client operations required to own one remote activation process. */
export interface SdkActivationClient {
  /** Local child-process id after initialization, when this client can expose one. */
  readonly pid?: number | undefined
  /** Initialize the process-wide SDK route. */
  readonly initialize: HarnessClient['initialize']
  /** Open one exact remote activation epoch. */
  readonly openActivation: HarnessClient['openActivation']
  /** Attach one post-bind remote Team Link delivery. */
  readonly enrollActivationLink: HarnessClient['enrollActivationLink']
  /** Read the current exact remote activation state. */
  readonly getActivationStatus: HarnessClient['getActivationStatus']
  /** Interrupt one exact remote activation epoch. */
  readonly interruptActivation: HarnessClient['interruptActivation']
  /** Dispose one exact remote activation epoch. */
  readonly disposeActivation: HarnessClient['disposeActivation']
  /** Subscribe to later protocol notifications. */
  readonly subscribe: HarnessClient['subscribe']
  /** Close and reap the child runtime process. */
  readonly close: HarnessClient['close']
}

/** Factory boundary for the SDK runtime process client. */
export interface SdkActivationClientFactory {
  /**
   * Create an unshared SDK client for one prospective activation process.
   * @param options - Complete child launch specification.
   * @returns a client that owns the newly configured process.
   */
  create(options: HarnessClientOptions): SdkActivationClient
}

/** Production factory: each call creates one client and therefore one child process after its first request. */
export const harnessSdkActivationClientFactory: SdkActivationClientFactory = {
  create: options => new HarnessClient(options),
}
