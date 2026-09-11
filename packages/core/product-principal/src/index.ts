/** Authenticated product-principal registry and revocable call-lease seam. @module @clocky/clocky-product-principal */

import { Context, Service } from '@clocky/cordis'
import type {
  AuthenticatedProductCall,
  AuthenticatedProductPrincipalLease,
  ProductPrincipal,
  ProductPrincipalAuthenticateRequest,
  ProductPrincipalBootstrapProvider,
  ProductPrincipalId,
  ProductPrincipalProvider,
  ProductPrincipalProviderLease,
  ProductPrincipalProviderRef,
} from './types.ts'

export type {
  AuthenticatedProductCall,
  AuthenticatedProductPrincipalLease,
  ProductPrincipal,
  ProductPrincipalAuthenticateRequest,
  ProductPrincipalBootstrapProvider,
  ProductPrincipalId,
  ProductPrincipalProvider,
  ProductPrincipalProviderAuthenticateRequest,
  ProductPrincipalProviderLease,
  ProductPrincipalProviderRef,
} from './types.ts'

/** Stable error codes for product-principal registration and authentication. */
export type ProductPrincipalErrorCode =
  | 'PRODUCT_AUTH_REQUIRED'
  | 'PRODUCT_AUTH_INVALID'
  | 'PRODUCT_PRINCIPAL_PROVIDER_DUPLICATE'
  | 'PRODUCT_PRINCIPAL_PROVIDER_INVALID'

/** Error raised by the product-principal seam without including credential material. */
export class ProductPrincipalError extends Error {
  /** Stable machine-readable classification. */
  readonly code: ProductPrincipalErrorCode

  /** @param message - Credential-safe public diagnostic. @param code - Stable classification. */
  constructor(message: string, code: ProductPrincipalErrorCode) {
    super(message)
    this.name = 'ProductPrincipalError'
    this.code = code
  }
}

declare module '@clocky/cordis' {
  interface Context {
    /** Registry of deployment-owned product-principal credential providers. */
    productPrincipals: ProductPrincipalRegistry
  }
}

interface ProviderEntry {
  readonly provider: ProductPrincipalProvider
  readonly leases: Set<AuthenticatedLease>
  accepting: boolean
}

/** Return a safe generic invalid-authentication error. */
function invalidAuthentication(): ProductPrincipalError {
  return new ProductPrincipalError('Product authentication is invalid', 'PRODUCT_AUTH_INVALID')
}

/** Return a safe generic absent-authentication error. */
function requiredAuthentication(): ProductPrincipalError {
  return new ProductPrincipalError('Product authentication is required', 'PRODUCT_AUTH_REQUIRED')
}

/** Read a mutable signal state without retaining a stale control-flow narrowing across awaits. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false
}

/** Read mutable provider admission state after an asynchronous provider operation. */
function isProviderEntryAccepting(entry: ProviderEntry): boolean {
  return entry.accepting
}

/** Validate the runtime result returned by a dynamically registered provider. */
function isProviderLease(value: unknown): value is ProductPrincipalProviderLease {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ProductPrincipalProviderLease>
  return typeof candidate.revoke === 'function' && candidate.signal instanceof AbortSignal
}

/** Narrow a provider that explicitly supports trusted bootstrap credential retrieval. */
function isBootstrapProvider(provider: ProductPrincipalProvider): provider is ProductPrincipalBootstrapProvider {
  return typeof (provider as Partial<ProductPrincipalBootstrapProvider>).bootstrapCredential === 'function'
}

/** Reject a label that cannot be used as a stable non-secret identifier. */
function requireLabel(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw invalidAuthentication()
  }
  return value
}

/**
 * Brand a non-secret durable product-principal identity.
 * @param value - nonempty principal identifier without surrounding whitespace.
 * @returns the validated value with its product-principal brand.
 */
export function productPrincipalId(value: string): ProductPrincipalId {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError('product principal id must be non-empty without surrounding whitespace')
  }
  return value as ProductPrincipalId
}

/** Detach and validate provider-owned principal facts before exposing them to a consumer. */
function freezePrincipal(value: unknown): ProductPrincipal {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidAuthentication()
  const candidate = value as Record<string, unknown>
  const generation = candidate['credentialGeneration']
  if (!Number.isSafeInteger(generation) || (generation as number) < 1) throw invalidAuthentication()
  return Object.freeze({
    id: productPrincipalId(requireLabel(candidate['id'])),
    issuer: requireLabel(candidate['issuer']),
    subject: requireLabel(candidate['subject']),
    assurance: requireLabel(candidate['assurance']),
    credentialGeneration: generation as number,
  })
}

/** Build a signal that follows both lease revocation and one carrier operation. */
function operationSignal(leaseSignal: AbortSignal, operationSignal: AbortSignal | undefined): {
  readonly signal: AbortSignal
  readonly dispose: () => void
} {
  const controller = new AbortController()
  const abort = () => { controller.abort() }
  leaseSignal.addEventListener('abort', abort, { once: true })
  operationSignal?.addEventListener('abort', abort, { once: true })
  return {
    signal: controller.signal,
    dispose: () => {
      leaseSignal.removeEventListener('abort', abort)
      operationSignal?.removeEventListener('abort', abort)
    },
  }
}

/** Registry-owned wrapper that tracks admitted calls before provider revocation. */
class AuthenticatedLease implements AuthenticatedProductPrincipalLease {
  private readonly controller = new AbortController()
  private readonly onProviderAbort = () => { void this.revoke() }
  private activeCalls = 0
  private revoking = false
  private finalization: Promise<void> | undefined
  private resolveFinalization: (() => void) | undefined
  private finalizing = false

  /**
   * @param entry - Provider registration that owns this lease.
   * @param lease - Provider-issued credential lease.
   * @param principal - Detached principal facts captured at authentication.
   * @param onFinalized - Removes this wrapper from the provider entry.
   */
  constructor(
    private readonly entry: ProviderEntry,
    private readonly lease: ProductPrincipalProviderLease,
    private readonly principal: ProductPrincipal,
    private readonly onFinalized: (lease: AuthenticatedLease) => void,
  ) {
    lease.signal.addEventListener('abort', this.onProviderAbort, { once: true })
  }

  /** Run one operation only while this provider and credential lease remain accepting. */
  async withCall<T>(
    operation: (call: AuthenticatedProductCall) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.isActive()) {
      throw invalidAuthentication()
    }
    if (signal?.aborted === true) throw invalidAuthentication()
    try {
      await this.lease.validate?.()
    } catch {
      await this.revoke()
      throw invalidAuthentication()
    }
    if (!this.isActive()) {
      throw invalidAuthentication()
    }
    this.activeCalls += 1
    const combined = operationSignal(this.controller.signal, signal)
    try {
      const callPrincipal = Object.freeze({ ...this.principal })
      return await operation(Object.freeze({
        principal: callPrincipal,
        credentialGeneration: callPrincipal.credentialGeneration,
        signal: combined.signal,
      }))
    } finally {
      combined.dispose()
      this.activeCalls -= 1
      if (this.isDrainedWhileRevoking()) void this.finalize()
    }
  }

  /** Stop new calls immediately and defer provider revocation until accepted work drains. */
  revoke(): Promise<void> {
    this.revoking = true
    return this.finalize()
  }

  /** Read mutable provider and lease state before admitting or retaining a call. */
  private isActive(): boolean {
    return isProviderEntryAccepting(this.entry)
      && !this.revoking
      && !this.controller.signal.aborted
      && !this.lease.signal.aborted
  }

  /** Whether the final admitted call drained after this lease began revocation. */
  private isDrainedWhileRevoking(): boolean {
    return this.activeCalls === 0 && this.revoking
  }

  /** Create the settled lease promise and begin cleanup after accepted work drains. */
  private finalize(): Promise<void> {
    if (this.finalization === undefined) {
      this.finalization = new Promise<void>((resolve) => { this.resolveFinalization = resolve })
    }
    if (this.activeCalls === 0 && !this.finalizing) {
      this.finalizing = true
      void this.finish()
    }
    return this.finalization
  }

  /** Abort future context signals, retire registry state, and contain provider cleanup failures. */
  private async finish(): Promise<void> {
    this.controller.abort()
    this.lease.signal.removeEventListener('abort', this.onProviderAbort)
    this.onFinalized(this)
    try {
      await this.lease.revoke()
    } catch {
      // Provider cleanup has no credential-safe diagnostic surface here.
    } finally {
      this.resolveFinalization?.()
    }
  }
}

/** Registry of named product-principal authenticators at `ctx.productPrincipals`. */
export class ProductPrincipalRegistry extends Service {
  private readonly providers = new Map<string, ProviderEntry>()

  /** @param ctx - Cordis context that owns the registry. */
  constructor(ctx: Context) {
    super(ctx, 'productPrincipals')
  }

  /**
   * Register one named provider through an HMR-safe Cordis effect.
   * @param provider - credential validator that owns its issued leases.
   * @returns an asynchronous disposer that revokes outstanding provider leases after admitted calls settle.
   */
  registerProvider(provider: ProductPrincipalProvider): () => Promise<void> {
    const name = requireLabel(provider.name)
    if (typeof provider.authenticate !== 'function') {
      throw new ProductPrincipalError('Product principal provider is invalid', 'PRODUCT_PRINCIPAL_PROVIDER_INVALID')
    }
    return this.ctx.effect(function* (this: ProductPrincipalRegistry) {
      if (this.providers.has(name)) {
        throw new ProductPrincipalError(
          `Product principal provider '${name}' is already registered`,
          'PRODUCT_PRINCIPAL_PROVIDER_DUPLICATE',
        )
      }
      const entry: ProviderEntry = { provider, leases: new Set(), accepting: true }
      this.providers.set(name, entry)
      yield async () => {
        /* v8 ignore next -- Cordis makes effect disposers idempotent before this registry guard can run twice. */
        if (this.providers.get(name) !== entry) return
        entry.accepting = false
        this.providers.delete(name)
        await Promise.all([...entry.leases].map(lease => lease.revoke()))
      }
    }.bind(this), 'productPrincipals.registerProvider()')
  }

  /**
   * Return accepting provider names without exposing provider implementation objects.
   * @returns detached accepting provider identities.
   */
  listProviders(): readonly ProductPrincipalProviderRef[] {
    return [...this.providers.keys()].map(name => Object.freeze({ name }))
  }

  /**
   * Return one provider-owned bootstrap credential only to a trusted transport bootstrap owner.
   * @param provider - accepting provider selected by the trusted transport.
   * @returns the current opaque bootstrap credential.
   */
  bootstrapCredential(provider: string): string {
    const entry = this.providers.get(requireLabel(provider))
    if (entry === undefined || !entry.accepting || !isBootstrapProvider(entry.provider)) {
      throw invalidAuthentication()
    }
    try {
      const credential = entry.provider.bootstrapCredential()
      if (credential.length === 0) throw invalidAuthentication()
      return credential
    } catch {
      throw invalidAuthentication()
    }
  }

  /**
   * Authenticate one credential and retain the resulting provider lease.
   * @param request - provider selection, opaque credential, and optional cancellation signal.
   * @returns a revocable lease that creates runtime-only product call contexts.
   */
  async authenticate(request: ProductPrincipalAuthenticateRequest): Promise<AuthenticatedProductPrincipalLease> {
    const providerName = requireLabel(request.provider)
    if (request.credential === undefined || request.credential.length === 0) throw requiredAuthentication()
    if (isAborted(request.signal)) throw invalidAuthentication()
    const entry = this.providers.get(providerName)
    if (entry === undefined || !isProviderEntryAccepting(entry)) throw invalidAuthentication()
    let providerLease: ProductPrincipalProviderLease
    let principal: ProductPrincipal
    let issuedLease: ProductPrincipalProviderLease | undefined
    try {
      const authenticatedLease: unknown = await entry.provider.authenticate({
        credential: request.credential,
        ...request.signal === undefined ? {} : { signal: request.signal },
      })
      if (!isProviderEntryAccepting(entry) || isAborted(request.signal)) {
        if (isProviderLease(authenticatedLease)) {
          await Promise.resolve(authenticatedLease.revoke()).catch(() => {})
        }
        throw invalidAuthentication()
      }
      if (!isProviderLease(authenticatedLease)) {
        throw invalidAuthentication()
      }
      providerLease = authenticatedLease
      issuedLease = providerLease
      principal = freezePrincipal(providerLease.principal)
    } catch (error: unknown) {
      if (issuedLease !== undefined) await Promise.resolve(issuedLease.revoke()).catch(() => {})
      if (error instanceof ProductPrincipalError && error.code === 'PRODUCT_AUTH_REQUIRED') throw requiredAuthentication()
      throw invalidAuthentication()
    }
    const wrapped = new AuthenticatedLease(entry, providerLease, principal, (lease) => { entry.leases.delete(lease) })
    entry.leases.add(wrapped)
    return wrapped
  }
}

export default ProductPrincipalRegistry
