/** Runtime-only authenticated product-principal vocabulary. @module @clocky/clocky-product-principal/types */

import type { Branded } from '@clocky/clocky-brand'

/** Stable non-secret identity for one authenticated product principal. */
export type ProductPrincipalId = Branded<'ProductPrincipalId'>

/** Immutable identity facts established by one credential validation. */
export interface ProductPrincipal {
  /** Durable non-secret product identity. */
  readonly id: ProductPrincipalId
  /** Provider identity that authenticated the credential. */
  readonly issuer: string
  /** Provider-local stable subject. */
  readonly subject: string
  /** Provider-defined assurance classification. */
  readonly assurance: string
  /** Credential generation accepted for this lease. */
  readonly credentialGeneration: number
}

/** Runtime-only product-call context passed beside a parsed transport request. */
export interface AuthenticatedProductCall {
  /** Principal authenticated for this exact call. */
  readonly principal: ProductPrincipal
  /** Credential generation independently available to dispatch policy. */
  readonly credentialGeneration: number
  /** Aborts when the carrier, credential lease, or provider retires the call. */
  readonly signal: AbortSignal
}

/** Credential facts a named principal provider receives at its authentication boundary. */
export interface ProductPrincipalProviderAuthenticateRequest {
  /** Opaque credential supplied only at the authentication boundary. */
  readonly credential?: string | undefined
  /** Stops an authentication attempt before it creates a lease. */
  readonly signal?: AbortSignal | undefined
}

/** Provider-owned lease retained after a successful credential validation. */
export interface ProductPrincipalProviderLease {
  /** Immutable non-secret principal facts established by the provider. */
  readonly principal: ProductPrincipal
  /** Aborts when the provider revokes this credential generation or lease. */
  readonly signal: AbortSignal
  /** Revalidate provider-owned credential state before one protected dispatch. */
  validate?(): void | Promise<void>
  /** Revoke this exact provider-owned lease. */
  revoke(): void | Promise<void>
}

/** Named provider that authenticates one product credential into a private lease. */
export interface ProductPrincipalProvider {
  /** Registry identity for this provider. */
  readonly name: string
  /** Authenticate one credential without exposing it beyond this boundary. */
  authenticate(request: ProductPrincipalProviderAuthenticateRequest): Promise<ProductPrincipalProviderLease>
}

/** Optional provider capability that exposes one fresh bootstrap credential to a trusted Host owner. */
export interface ProductPrincipalBootstrapProvider extends ProductPrincipalProvider {
  /** Return the current plaintext bootstrap credential without serializing it. */
  bootstrapCredential(): string
}

/** Input selecting a registered provider for one product authentication attempt. */
export interface ProductPrincipalAuthenticateRequest extends ProductPrincipalProviderAuthenticateRequest {
  /** Registered provider selected by the transport or deployment. */
  readonly provider: string
}

/** A revocable authenticated connection or request lease. */
export interface AuthenticatedProductPrincipalLease {
  /**
   * Run one admitted operation with a fresh immutable call context. Callers
   * must use this method rather than retaining a principal independently.
   */
  withCall<T>(
    operation: (call: AuthenticatedProductCall) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>
  /** Stop future calls and release after any already admitted call settles. */
  revoke(): Promise<void>
}

/** Safe registry projection of one currently accepting provider. */
export interface ProductPrincipalProviderRef {
  /** Registered provider identity. */
  readonly name: string
}
