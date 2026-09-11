/**
 * AgentRuntime Service Definition: a named activation-provider registry and
 * Participant-bound activation dispatch independent of Team Hub persistence.
 * @module @clocky/clocky-agent-runtime
 */

import { Context, Service } from '@clocky/cordis'
import { activationSnapshotSchema, assertActivationStatusTransition } from '@clocky/clocky-team'
import type { ActivationSnapshot, ActivationStatus } from '@clocky/clocky-team'
import { AgentRuntimeError } from './error.ts'
import type {
  ActivationHandle,
  AgentRuntimeActivationRequest,
  AgentRuntimeFencer,
  AgentRuntimeProvider,
  AgentRuntimeProviderRef,
} from './types.ts'

export {
  AgentRuntimeError,
  AgentRuntimeTerminationUnconfirmedError,
  isAgentRuntimeTerminationUnconfirmed,
} from './error.ts'
export type { AgentRuntimeErrorCode } from './error.ts'
export type * from './types.ts'

declare module '@clocky/cordis' {
  interface Context {
    agentRuntimes: AgentRuntime
  }

  interface Events {
    /**
     * An activation provider became available for new Participant activations.
     * @param provider - registered provider identity.
     * @mode emit
     */
    'agent-runtime/provider-added'(this: AgentRuntime, provider: AgentRuntimeProviderRef): void
    /**
     * An activation provider stopped accepting new activations. Existing handles
     * remain owned by the caller that received them.
     * @param provider - removed provider identity.
     * @mode emit
     */
    'agent-runtime/provider-removed'(this: AgentRuntime, provider: AgentRuntimeProviderRef): void
    /**
     * A provider published one Participant activation handle or observed a
     * later status change for that exact epoch.
     * Listener failure cannot revoke the accepted handle.
     * @param activation - immutable activation projection.
     * @mode emit
     */
    'agent-runtime/activation-changed'(this: AgentRuntime, activation: ActivationSnapshot): void
  }
}

/** Recursively freeze a detached activation or provider notification. */
function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) freeze(child)
  return value
}

/** Render a listener failure without allowing diagnostics to throw. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/**
 * Named activation-provider registry at `ctx.agentRuntimes`. It owns provider
 * registration and post-publication observation; a provider owns every live
 * activation handle it returns.
 */
export class AgentRuntime extends Service {
  private readonly providers = new Map<string, AgentRuntimeProvider>()
  private readonly fencers = new Map<string, AgentRuntimeFencer>()
  /** Accepted handle identities already announced to observers. */
  private readonly observedHandles = new WeakSet<ActivationHandle>()
  /** Status-listener disposers owned until their exact activation reaches offline. */
  private readonly statusObservers = new WeakMap<ActivationHandle, () => void>()
  /** Last lifecycle status accepted for each observed handle. */
  private readonly observedStatuses = new WeakMap<ActivationHandle, ActivationStatus>()

  /**
   * @param ctx - Cordis context that owns this registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'agentRuntimes')
  }

  /**
   * Register one named activation provider. Registration is effect-scoped and
   * its disposer removes only this provider instance.
   * @param provider - placement implementation for future activation requests.
   * @returns HMR-safe disposer for this registration.
   */
  registerProvider(provider: AgentRuntimeProvider): () => void {
    const ref: AgentRuntimeProviderRef = { name: provider.name }
    if (provider.name.length === 0 || provider.name.trim() !== provider.name) {
      throw new AgentRuntimeError('AgentRuntime provider name must be non-empty without surrounding whitespace', 'AGENT_RUNTIME_PROVIDER_INVALID')
    }
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: AgentRuntime) {
      if (this.providers.has(provider.name)) {
        throw new AgentRuntimeError(
          `AgentRuntime provider '${provider.name}' is already registered`,
          'AGENT_RUNTIME_PROVIDER_DUPLICATE',
        )
      }
      this.providers.set(provider.name, provider)
      yield () => {
        if (this.providers.get(provider.name) !== provider) return
        this.providers.delete(provider.name)
        this.emitContained('agent-runtime/provider-removed', freeze({ ...ref }))
      }
      this.emitContained('agent-runtime/provider-added', freeze({ ...ref }))
    }.bind(this), 'agentRuntimes.registerProvider()')
  }

  /**
   * Resolve one registered activation provider.
   * @param name - provider registry name.
   * @returns the live provider, or `undefined` when no matching provider remains.
   */
  getProvider(name: string): AgentRuntimeProvider | undefined {
    return this.providers.get(name)
  }

  /**
   * Register one trusted stale-epoch fencer. A fencer never starts an
   * activation; it only establishes the precondition for a cold replacement.
   * @param fencer - external owner for one runtime-provider epoch family.
   * @returns HMR-safe disposer for this fencer registration.
   */
  registerFencer(fencer: AgentRuntimeFencer): () => void {
    if (fencer.provider.length === 0 || fencer.provider.trim() !== fencer.provider) {
      throw new AgentRuntimeError('AgentRuntime fencer provider must be non-empty without surrounding whitespace', 'AGENT_RUNTIME_FENCER_INVALID')
    }
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: AgentRuntime) {
      if (this.fencers.has(fencer.provider)) {
        throw new AgentRuntimeError(
          `AgentRuntime fencer for '${fencer.provider}' is already registered`,
          'AGENT_RUNTIME_FENCER_DUPLICATE',
        )
      }
      this.fencers.set(fencer.provider, fencer)
      yield () => {
        if (this.fencers.get(fencer.provider) === fencer) this.fencers.delete(fencer.provider)
      }
    }.bind(this), 'agentRuntimes.registerFencer()')
  }

  /**
   * Resolve the current trusted fencer for one runtime provider.
   * @param provider - placement-provider name retained in a durable binding.
   * @returns the fencer, or `undefined` when no external owner can prove termination.
   */
  getFencer(provider: string): AgentRuntimeFencer | undefined {
    return this.fencers.get(provider)
  }

  /**
   * List registered provider identities in registration order.
   * @returns detached provider references.
   */
  listProviders(): AgentRuntimeProviderRef[] {
    return [...this.providers.values()].map(provider => ({ name: provider.name }))
  }

  /**
   * Resolve a provider, require its returned activation to match the requested
   * Team/Participant/Session binding, then publish its first observation. A
   * handle that fails post-return validation is disposed before rejection.
   * @param request - provider name and already-resolved activation inputs.
   * @returns the provider-owned published activation handle.
   */
  async activate(request: AgentRuntimeActivationRequest): Promise<ActivationHandle> {
    if (request.participant.teamId !== request.teamId) {
      throw new AgentRuntimeError(
        `Participant '${request.participant.id}' does not belong to Team '${request.teamId}'`,
        'AGENT_RUNTIME_ACTIVATION_MISMATCH',
      )
    }
    const provider = this.providers.get(request.provider)
    if (provider === undefined) {
      throw new AgentRuntimeError(
        `AgentRuntime provider '${request.provider}' is not registered`,
        'AGENT_RUNTIME_PROVIDER_NOT_FOUND',
      )
    }
    const handle = await provider.activate(request)
    try {
      const activation = activationSnapshotSchema.parse(handle.activation)
      try {
        assertActivationStatusTransition(undefined, activation.status)
      } catch (error: unknown) {
        throw new AgentRuntimeError(
          `AgentRuntime provider '${provider.name}' published activation '${activation.id}' with non-publishable status '${activation.status}'`,
          'AGENT_RUNTIME_ACTIVATION_STATUS_INVALID',
          { cause: error },
        )
      }
      if (activation.teamId !== request.teamId || activation.participantId !== request.participant.id) {
        throw new AgentRuntimeError(
          `AgentRuntime provider '${provider.name}' returned an activation for another Team or participant`,
          'AGENT_RUNTIME_ACTIVATION_MISMATCH',
        )
      }
      if (handle.sessionId !== request.sessionId) {
        throw new AgentRuntimeError(
          `AgentRuntime provider '${provider.name}' returned another Session identity`,
          'AGENT_RUNTIME_ACTIVATION_MISMATCH',
        )
      }
      if (!this.observedHandles.has(handle)) {
        this.observedHandles.add(handle)
        this.observedStatuses.set(handle, activation.status)
        this.emitContained('agent-runtime/activation-changed', freeze(activation))
        const unsubscribe = handle.onStatus((next) => { this.observeStatus(handle, activation, next) })
        this.statusObservers.set(handle, unsubscribe)
      }
      return handle
    } catch (error: unknown) {
      try {
        await handle.dispose()
      } catch (disposeError: unknown) {
        this.ctx.logger.warn(`agent-runtimes: failed to release rejected activation: ${renderError(disposeError)}`)
      }
      throw error
    }
  }

  /** Validate and publish one provider-observed status for an accepted handle. */
  private observeStatus(
    handle: ActivationHandle,
    initial: ActivationSnapshot,
    next: ActivationSnapshot,
  ): void {
    try {
      const activation = activationSnapshotSchema.parse(next)
      if (activation.id !== initial.id
        || activation.teamId !== initial.teamId
        || activation.participantId !== initial.participantId) {
        throw new AgentRuntimeError(
          `AgentRuntime provider status changed activation identity '${initial.id}'`,
          'AGENT_RUNTIME_ACTIVATION_MISMATCH',
        )
      }
      const previous = this.observedStatuses.get(handle)
      if (previous === undefined) {
        throw new AgentRuntimeError(
          `AgentRuntime provider status for activation '${initial.id}' arrived before initial publication`,
          'AGENT_RUNTIME_ACTIVATION_STATUS_INVALID',
        )
      }
      if (previous === activation.status) return
      try {
        assertActivationStatusTransition(previous, activation.status)
      } catch (error: unknown) {
        throw new AgentRuntimeError(
          `AgentRuntime provider status for activation '${initial.id}' changed from '${previous}' to '${activation.status}'`,
          'AGENT_RUNTIME_ACTIVATION_STATUS_INVALID',
          { cause: error },
        )
      }
      this.observedStatuses.set(handle, activation.status)
      this.emitContained('agent-runtime/activation-changed', freeze(activation))
      if (activation.status === 'offline') {
        this.statusObservers.get(handle)?.()
        this.statusObservers.delete(handle)
      }
    } catch (error: unknown) {
      this.ctx.logger.warn(`agent-runtimes: ignored invalid activation status: ${renderError(error)}`)
    }
  }

  /** Dispatch one notification while containing every observer failure. */
  private emitContained(
    name: 'agent-runtime/provider-added' | 'agent-runtime/provider-removed' | 'agent-runtime/activation-changed',
    payload: AgentRuntimeProviderRef | ActivationSnapshot,
  ): void {
    const args: unknown[] = [this, name, payload]
    for (const callback of this.ctx.events.dispatch('emit', args)) {
      try {
        const returned = (callback as (...args: unknown[]) => unknown)(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`agent-runtimes: ${name} listener rejected: ${renderError(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`agent-runtimes: ${name} listener threw: ${renderError(error)}`)
      }
    }
  }
}

export default AgentRuntime
