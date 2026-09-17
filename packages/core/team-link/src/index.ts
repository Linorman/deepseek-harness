/**
 * Team Link Service Definition: a named activation-bound Link provider registry
 * at `ctx.teamLinks`, independent of Team Hub persistence and transport.
 *
 * @module @clocky/clocky-team-link
 */

import { Context, Service } from '@clocky/cordis'
import { activationBindingSnapshotSchema } from '@clocky/clocky-team'
import type { ActivationBindingSnapshot } from '@clocky/clocky-team'
import { TeamLinkError } from './error.ts'
import type {
  TeamLink,
  TeamLinkBoundLinkBorrower,
  TeamLinkConnectRequest,
  TeamLinkEnrollment,
  TeamLinkEnrollmentProvider,
  TeamLinkEnrollmentProviderRef,
  TeamLinkEnrollmentRequest,
  TeamLinkProvider,
  TeamLinkProviderRef,
} from './types.ts'

export { TeamLinkConnectionError, TeamLinkError } from './error.ts'
export type { TeamLinkErrorCode } from './error.ts'
export {
  TEAM_LINK_FRAME_VERSION,
  parseTeamLinkClientFrame,
  parseTeamLinkServerFrame,
  teamLinkBindingIdentitySchema,
  teamLinkClientFrameSchema,
  teamLinkDeliveryIdSchema,
  teamLinkServerFrameSchema,
} from './frame.ts'
export type {
  TeamLinkBindingIdentity,
  TeamLinkClientFrame,
  TeamLinkOperation,
  TeamLinkResponseError,
  TeamLinkServerFrame,
} from './frame.ts'
export type * from './types.ts'

declare module '@clocky/cordis' {
  interface Context {
    teamLinks: TeamLinkRegistry
  }

  interface Events {
    /**
     * A provider became available, including replacement after configuration changes.
     * @param provider - named provider available for fresh connections.
     * @mode emit
     */
    'team-link/provider-added'(this: TeamLinkRegistry, provider: TeamLinkProviderRef): void

    /**
     * An enrollment issuer became available for new remote Link credentials.
     * @param provider - registered issuer identity.
     * @mode emit
     */
    'team-link/enrollment-provider-added'(this: TeamLinkRegistry, provider: TeamLinkEnrollmentProviderRef): void
    /**
     * An enrollment issuer stopped accepting credentials. Existing credentials
     * may no longer attach after the issuer's transport listener is replaced.
     * @param provider - removed issuer identity.
     * @mode emit
     */
    'team-link/enrollment-provider-removed'(this: TeamLinkRegistry, provider: TeamLinkEnrollmentProviderRef): void
  }
}

/** Render a rejected Link cleanup error without allowing diagnostics to throw. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/** Freeze one detached enrollment-provider event payload. */
function providerRef(provider: TeamLinkEnrollmentProvider): TeamLinkEnrollmentProviderRef {
  return Object.freeze({ name: provider.name })
}

/** Compare the immutable fields that identify one activation-bound Link. */
function bindingIdentity(binding: ActivationBindingSnapshot): string {
  return JSON.stringify([
    binding.activation.id,
    binding.activation.teamId,
    binding.activation.participantId,
    binding.sessionId,
    binding.provider,
  ])
}

/**
 * Named Team Link provider registry at `ctx.teamLinks`. A provider owns every
 * published Link; the registry owns provider registration and connection-time
 * provider/binding verification.
 */
export class TeamLinkRegistry extends Service {
  private readonly providers = new Map<string, TeamLinkProvider>()
  private readonly enrollmentProviders = new Map<string, TeamLinkEnrollmentProvider>()
  private readonly boundLinkBorrowers = new WeakMap<object, TeamLinkBoundLinkBorrower>()

  /**
   * @param ctx - Cordis context that owns this registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'teamLinks')
  }

  /**
   * Register one named Team Link provider. Registration is effect-scoped and
   * its disposer removes only this provider instance.
   * @param provider - local or remote Link implementation for future connections.
   * @returns HMR-safe disposer for this registration.
   */
  registerProvider(provider: TeamLinkProvider): () => void {
    if (provider.name.length === 0 || provider.name.trim() !== provider.name) {
      throw new TeamLinkError(
        'Team Link provider name must be non-empty without surrounding whitespace',
        'TEAM_LINK_PROVIDER_INVALID',
      )
    }
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamLinkRegistry) {
      if (this.providers.has(provider.name)) {
        throw new TeamLinkError(
          `Team Link provider '${provider.name}' is already registered`,
          'TEAM_LINK_PROVIDER_DUPLICATE',
        )
      }
      this.providers.set(provider.name, provider)
      this.emitProviderEvent('team-link/provider-added', { name: provider.name })
      yield () => {
        if (this.providers.get(provider.name) !== provider) return
        this.providers.delete(provider.name)
      }
    }.bind(this), 'teamLinks.registerProvider()')
  }

  /**
   * Resolve one registered Team Link provider.
   * @param name - provider registry name.
   * @returns the live provider, or `undefined` when no matching provider remains.
   */
  getProvider(name: string): TeamLinkProvider | undefined {
    return this.providers.get(name)
  }

  /**
   * List registered Team Link provider identities in registration order.
   * @returns detached provider references.
   */
  listProviders(): TeamLinkProviderRef[] {
    return [...this.providers.values()].map(provider => ({ name: provider.name }))
  }

  /**
   * Register callback-only access to one owner's existing bound Link. The
   * caller retains Link lifetime and may remove this access at any time.
   * @param owner - exact same-process owner identity that may later borrow.
   * @param borrower - callback-only accessor for the owner's current Link.
   * @returns HMR-safe disposer for this owner registration.
   */
  registerBoundLinkBorrower(owner: object, borrower: TeamLinkBoundLinkBorrower): () => void {
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamLinkRegistry) {
      if (this.boundLinkBorrowers.has(owner)) {
        throw new TeamLinkError('Team Link bound-Link borrower already exists for this owner', 'TEAM_LINK_BOUND_LINK_BORROWER_DUPLICATE')
      }
      this.boundLinkBorrowers.set(owner, borrower)
      yield () => {
        if (this.boundLinkBorrowers.get(owner) === borrower) this.boundLinkBorrowers.delete(owner)
      }
    }.bind(this), 'teamLinks.registerBoundLinkBorrower()')
  }

  /**
   * Resolve callback-only access to an owner's existing bound Link.
   * @param owner - exact owner identity that registered the Link accessor.
   * @returns the current borrower, or `undefined` when that owner has no live Link delivery.
   */
  getBoundLinkBorrower(owner: object): TeamLinkBoundLinkBorrower | undefined {
    return this.boundLinkBorrowers.get(owner)
  }

  /**
   * Register one remote-Link enrollment provider. Registration is effect-scoped
   * and does not expose credentials to ordinary Link consumers.
   * @param provider - issuer for exact activation-bound remote credentials.
   * @returns HMR-safe disposer for this registration.
   */
  registerEnrollmentProvider(provider: TeamLinkEnrollmentProvider): () => void {
    const ref = providerRef(provider)
    if (provider.name.length === 0 || provider.name.trim() !== provider.name) {
      throw new TeamLinkError(
        'Team Link enrollment provider name must be non-empty without surrounding whitespace',
        'TEAM_LINK_ENROLLMENT_PROVIDER_INVALID',
      )
    }
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamLinkRegistry) {
      if (this.enrollmentProviders.has(provider.name)) {
        throw new TeamLinkError(
          `Team Link enrollment provider '${provider.name}' is already registered`,
          'TEAM_LINK_ENROLLMENT_PROVIDER_DUPLICATE',
        )
      }
      this.enrollmentProviders.set(provider.name, provider)
      yield () => {
        if (this.enrollmentProviders.get(provider.name) !== provider) return
        this.enrollmentProviders.delete(provider.name)
        this.emitProviderEvent('team-link/enrollment-provider-removed', ref)
      }
      this.emitProviderEvent('team-link/enrollment-provider-added', ref)
    }.bind(this), 'teamLinks.registerEnrollmentProvider()')
  }

  /**
   * Resolve one remote-Link enrollment provider.
   * @param name - provider registry name.
   * @returns the live credential issuer, or `undefined` when no matching provider remains.
   */
  getEnrollmentProvider(name: string): TeamLinkEnrollmentProvider | undefined {
    return this.enrollmentProviders.get(name)
  }

  /**
   * List registered remote-Link enrollment provider identities in registration order.
   * @returns detached provider references.
   */
  listEnrollmentProviders(): TeamLinkEnrollmentProviderRef[] {
    return [...this.enrollmentProviders.values()].map(provider => ({ name: provider.name }))
  }

  /**
   * Reserve one short-lived credential for an exact active activation binding.
   * @param request - selected enrollment provider and durable binding.
   * @returns opaque credential material owned by the caller until it is revoked.
   */
  async reserveEnrollment(request: TeamLinkEnrollmentRequest): Promise<TeamLinkEnrollment> {
    const provider = this.enrollmentProviders.get(request.provider)
    if (provider === undefined) {
      throw new TeamLinkError(
        `Team Link enrollment provider '${request.provider}' is not registered`,
        'TEAM_LINK_ENROLLMENT_PROVIDER_NOT_FOUND',
      )
    }
    const enrollment = await provider.reserve(request.binding)
    if (enrollment.provider !== request.provider
      || enrollment.endpoint.length === 0
      || enrollment.capability.length === 0) {
      try {
        await enrollment.revoke()
      } catch (error: unknown) {
        this.ctx.logger.warn(`team-links: failed to revoke rejected enrollment: ${renderError(error)}`)
      }
      throw new TeamLinkError(
        `Team Link enrollment provider '${request.provider}' returned invalid credential material`,
        'TEAM_LINK_ENROLLMENT_MISMATCH',
      )
    }
    return enrollment
  }

  /**
   * Connect through one registered provider. A returned Link must retain the
   * selected provider name and exact durable activation binding; otherwise the
   * registry closes it before rejecting the connection.
   * @param request - provider name, exact durable activation binding, and optional cancellation signal.
   * @returns the provider-owned Link after connection-time verification.
   */
  async connect(request: TeamLinkConnectRequest): Promise<TeamLink> {
    const provider = this.providers.get(request.provider)
    if (provider === undefined) {
      throw new TeamLinkError(
        `Team Link provider '${request.provider}' is not registered`,
        'TEAM_LINK_PROVIDER_NOT_FOUND',
      )
    }
    const link = await provider.connect(request)
    try {
      const binding = activationBindingSnapshotSchema.parse(link.binding)
      if (link.provider !== request.provider || bindingIdentity(binding) !== bindingIdentity(request.binding)) {
        throw new TeamLinkError(
          `Team Link provider '${request.provider}' returned another provider or activation binding`,
          'TEAM_LINK_CONNECTION_MISMATCH',
        )
      }
      return link
    } catch (error: unknown) {
      try {
        await link.close()
      } catch (closeError: unknown) {
        this.ctx.logger.warn(`team-links: failed to close rejected Link: ${renderError(closeError)}`)
      }
      throw error
    }
  }

  /** Emit provider topology changes without allowing observers to veto registration. */
  private emitProviderEvent(
    name: 'team-link/provider-added' | 'team-link/enrollment-provider-added' | 'team-link/enrollment-provider-removed',
    provider: TeamLinkProviderRef,
  ): void {
    const args: unknown[] = [this, name, provider]
    for (const callback of this.ctx.events.dispatch('emit', args)) {
      try {
        const returned = (callback as (...args: unknown[]) => unknown)(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`team-links: ${name} listener rejected: ${renderError(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`team-links: ${name} listener threw: ${renderError(error)}`)
      }
    }
  }
}

export default TeamLinkRegistry
