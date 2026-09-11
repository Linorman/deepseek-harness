/** Versioned activation supervisor registry; accepted operations retain their provider during retirement. */

import { isDeepStrictEqual } from 'node:util'
import { Context, Service } from '@clocky/cordis'
import type { ActivationBindingSnapshot } from '@clocky/clocky-team'
import type { ActivationSupervisorObservation, ActivationSupervisorProvider } from './types.ts'

export type * from './types.ts'

declare module '@clocky/cordis' {
  interface Context {
    activationSupervisors: ActivationSupervisors
  }
}

/** Stable failures distinguishing absent implementations, stale epochs, and unconfirmed execution. */
export class ActivationSupervisorError extends Error {
  /** Machine-readable supervisor failure classification. */
  readonly code: 'SUPERVISOR_UNAVAILABLE' | 'SUPERVISOR_INVALID' | 'SUPERVISOR_GENERATION_MISMATCH' | 'SUPERVISOR_TERMINATION_UNCONFIRMED'

  /** @param message - diagnostic without endpoint credentials.
   * @param code - machine-readable supervisor failure classification.
   */
  constructor(message: string, code: 'SUPERVISOR_UNAVAILABLE' | 'SUPERVISOR_INVALID' | 'SUPERVISOR_GENERATION_MISMATCH' | 'SUPERVISOR_TERMINATION_UNCONFIRMED') {
    super(message)
    this.code = code
    this.name = 'ActivationSupervisorError'
  }
}

/** Resolver of named and versioned execution health/fence providers. */
export class ActivationSupervisors extends Service {
  private readonly providers = new Map<string, ActivationSupervisorProvider>()
  /** @param ctx - Cordis registry owner. */
  constructor(ctx: Context) { super(ctx, 'activationSupervisors') }

  /** Register a provider until its owning effect retires.
   * @param provider - exact implementation and execution owner.
   * @returns idempotent registration disposer; admitted operations continue.
   */
  registerProvider(provider: ActivationSupervisorProvider): () => void {
    if (!provider.name || provider.name.trim() !== provider.name || !Number.isSafeInteger(provider.version) || provider.version < 1) {
      throw new ActivationSupervisorError('Supervisor requires a canonical name and positive version', 'SUPERVISOR_INVALID')
    }
    const key = JSON.stringify([provider.name, provider.version])
    // oxlint-disable-next-line typescript/no-misused-promises -- preserve the Cordis effect disposer identity.
    return this.ctx.effect(() => {
      if (this.providers.has(key)) throw new ActivationSupervisorError(`Supervisor '${provider.name}' version ${provider.version} is registered`, 'SUPERVISOR_INVALID')
      this.providers.set(key, provider)
      return () => { if (this.providers.get(key) === provider) this.providers.delete(key) }
    }, 'activationSupervisors.registerProvider()')
  }

  /** Resolve and validate one exact durable descriptor without side effects.
   * @param binding - Team-owned epoch and recovery descriptor.
   * @returns retained provider for one admitted operation.
   */
  resolve(binding: ActivationBindingSnapshot): ActivationSupervisorProvider {
    const descriptor = binding.recovery?.supervisor
    if (descriptor === undefined) throw new ActivationSupervisorError('Activation has no supervisor descriptor', 'SUPERVISOR_UNAVAILABLE')
    if (descriptor.generation !== binding.activation.id || descriptor.hostId !== binding.recovery?.process.hostId) {
      throw new ActivationSupervisorError('Supervisor descriptor differs from activation epoch or host', 'SUPERVISOR_GENERATION_MISMATCH')
    }
    const provider = this.providers.get(JSON.stringify([descriptor.name, descriptor.version]))
    if (provider === undefined) throw new ActivationSupervisorError(`Supervisor '${descriptor.name}' version ${descriptor.version} is unavailable`, 'SUPERVISOR_UNAVAILABLE')
    provider.validate(binding)
    return provider
  }

  /** Persist an epoch produced by a trusted runtime on this execution host.
   * @param input - provider-minted process facts before activation publication.
   * @returns resolution after the selected execution owner durably accepts that epoch.
   */
  async admitOwned(input: ActivationBindingSnapshot): Promise<void> {
    const binding = structuredClone(input)
    const provider = this.resolve(binding)
    if (provider.admitOwned === undefined) throw new ActivationSupervisorError('Remote supervisor cannot enroll local process ownership', 'SUPERVISOR_INVALID')
    await provider.admitOwned(binding)
  }

  /** Observe an exact generation through its retained provider.
   * @param binding - immutable durable execution identity.
   * @param signal - observation cancellation.
   * @returns validated health; unreachable and unknown never become terminated.
   */
  async health(binding: ActivationBindingSnapshot, signal: AbortSignal): Promise<ActivationSupervisorObservation> {
    return await this.observe('health', binding, signal)
  }

  /** Fence an exact generation through its retained provider.
   * @param binding - immutable durable execution identity.
   * @param signal - request cancellation.
   * @returns exact terminated observation; all other states reject.
   */
  async fence(binding: ActivationBindingSnapshot, signal: AbortSignal): Promise<ActivationSupervisorObservation> {
    return await this.observe('fence', binding, signal)
  }

  private async observe(operation: 'health' | 'fence', input: ActivationBindingSnapshot, signal: AbortSignal): Promise<ActivationSupervisorObservation> {
    signal.throwIfAborted()
    const binding = structuredClone(input)
    const provider = this.resolve(binding)
    const observed = await provider[operation](binding, signal)
    if (!isDeepStrictEqual(observed.descriptor, binding.recovery?.supervisor)) {
      throw new ActivationSupervisorError('Supervisor returned another fence generation', 'SUPERVISOR_GENERATION_MISMATCH')
    }
    if (operation === 'fence' && observed.status !== 'terminated') {
      throw new ActivationSupervisorError('Supervisor did not prove execution termination', 'SUPERVISOR_TERMINATION_UNCONFIRMED')
    }
    return observed
  }
}

export default ActivationSupervisors
