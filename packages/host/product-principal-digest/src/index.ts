/** Configured SHA-256 digest product-principal provider. @module @clocky/clocky-host-product-principal-digest */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import {
  ProductPrincipalError,
  productPrincipalId,
} from '@clocky/clocky-product-principal'
import type {
  ProductPrincipal,
  ProductPrincipalProvider,
  ProductPrincipalProviderAuthenticateRequest,
  ProductPrincipalProviderLease,
} from '@clocky/clocky-product-principal'

/** Cordis plugin name. */
export const name = 'product-principal-digest'
/** The product-principal registry must exist before this provider registers. */
export const inject = ['productPrincipals']

/** Default registry name for the SDK runtime's configured digest provider. */
export const DEFAULT_DIGEST_PRODUCT_PRINCIPAL_PROVIDER_NAME = 'sdk-digest'
/** Fixed assurance class for a principal authenticated against a configured digest. */
export const DIGEST_PRODUCT_PRINCIPAL_ASSURANCE = 'configured-sha256'

/** Loader configuration for one configured digest-backed principal. */
export interface Config {
  /** Registry name used by the SDK JSON-RPC server. */
  readonly providerName?: string
  /** Lowercase SHA-256 hex digest of the initialization credential. */
  readonly credentialSha256: string
  /** Stable non-secret principal id retained in Team ownership records. */
  readonly principalId: string
  /** Stable non-secret subject emitted by the authenticated principal. */
  readonly subject: string
  /** Non-secret credential generation used to invalidate external configuration revisions. */
  readonly credentialGeneration?: number
}

/** Schemastery boundary for the digest provider configuration. */
export const Config: z<Config> = z.object({
  providerName: z.string().min(1).pattern(/^\S(?:.*\S)?$/).default(DEFAULT_DIGEST_PRODUCT_PRINCIPAL_PROVIDER_NAME),
  credentialSha256: z.string().required().pattern(/^[a-f0-9]{64}$/),
  principalId: z.string().min(1).required().pattern(/^\S(?:.*\S)?$/),
  subject: z.string().min(1).required().pattern(/^\S(?:.*\S)?$/),
  credentialGeneration: z.number().step(1).min(1).default(1),
})

/** Fully validated immutable provider configuration. */
export interface DigestProductPrincipalSpec {
  /** Registry name. */
  readonly providerName: string
  /** Fixed SHA-256 digest bytes; no plaintext credential is retained. */
  readonly credentialDigest: Uint8Array
  /** Stable principal id. */
  readonly principalId: string
  /** Stable principal subject. */
  readonly subject: string
  /** Non-secret credential generation. */
  readonly credentialGeneration: number
}

/** Return a credential-safe invalid-authentication rejection. */
function invalidAuthentication(): ProductPrincipalError {
  return new ProductPrincipalError('Product authentication is invalid', 'PRODUCT_AUTH_INVALID')
}

/** Return a credential-safe missing-authentication rejection. */
function requiredAuthentication(): ProductPrincipalError {
  return new ProductPrincipalError('Product authentication is required', 'PRODUCT_AUTH_REQUIRED')
}

/** Reject a malformed non-secret config value at load instead of weakening authentication. */
function requireConfiguredName(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`product-principal-digest: ${field} must be non-empty without surrounding whitespace`)
  }
  return value
}

/**
 * Resolve and validate a digest provider configuration before it registers.
 * @param config - deployment-owned digest and non-secret principal facts.
 * @returns immutable provider facts with digest bytes detached from the Loader value.
 */
export function resolveDigestProductPrincipalSpec(config: Config): DigestProductPrincipalSpec {
  const providerName = requireConfiguredName(
    'providerName', config.providerName ?? DEFAULT_DIGEST_PRODUCT_PRINCIPAL_PROVIDER_NAME,
  )
  const principalId = requireConfiguredName('principalId', config.principalId)
  const subject = requireConfiguredName('subject', config.subject)
  const credentialSha256 = config.credentialSha256
  if (typeof credentialSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(credentialSha256)) {
    throw new Error('product-principal-digest: credentialSha256 must be a lowercase SHA-256 hex digest')
  }
  const credentialGeneration = config.credentialGeneration ?? 1
  if (!Number.isSafeInteger(credentialGeneration) || credentialGeneration < 1) {
    throw new Error('product-principal-digest: credentialGeneration must be a positive safe integer')
  }
  productPrincipalId(principalId)
  return Object.freeze({
    providerName,
    credentialDigest: new Uint8Array(Buffer.from(credentialSha256, 'hex')),
    principalId,
    subject,
    credentialGeneration,
  })
}

/** One provider-owned authenticated lease, revoked when its provider leaves. */
class DigestProductPrincipalLease implements ProductPrincipalProviderLease {
  private readonly controller = new AbortController()

  /**
   * @param principal - immutable non-secret principal authenticated by this lease.
   * @param onRevoke - removes this lease from its provider.
   */
  constructor(
    readonly principal: ProductPrincipal,
    private readonly onRevoke: (lease: DigestProductPrincipalLease) => void,
  ) {}

  /** Abort signal owned by this exact provider lease. */
  get signal(): AbortSignal { return this.controller.signal }

  /** Reject use after provider retirement or explicit lease revocation. */
  validate(): void {
    if (this.controller.signal.aborted) throw invalidAuthentication()
  }

  /** Revoke this lease exactly once. */
  revoke(): void {
    if (this.controller.signal.aborted) return
    this.controller.abort()
    this.onRevoke(this)
  }
}

/** Product-principal provider that compares handshake credentials against a configured SHA-256 digest. */
export class DigestProductPrincipalProvider implements ProductPrincipalProvider {
  readonly name: string
  private readonly expectedDigest: Uint8Array
  private readonly principal: ProductPrincipal
  private readonly leases = new Set<DigestProductPrincipalLease>()
  private closed = false

  /** @param spec - immutable non-secret digest and principal configuration. */
  constructor(spec: DigestProductPrincipalSpec) {
    this.name = spec.providerName
    this.expectedDigest = new Uint8Array(spec.credentialDigest)
    this.principal = Object.freeze({
      id: productPrincipalId(spec.principalId),
      issuer: spec.providerName,
      subject: spec.subject,
      assurance: DIGEST_PRODUCT_PRINCIPAL_ASSURANCE,
      credentialGeneration: spec.credentialGeneration,
    })
  }

  /** Authenticate one plaintext handshake credential without retaining or emitting it. */
  authenticate(request: ProductPrincipalProviderAuthenticateRequest): Promise<ProductPrincipalProviderLease> {
    try {
      if (this.closed || request.signal?.aborted === true) throw invalidAuthentication()
      const credential = request.credential
      if (credential === undefined || credential.length === 0) throw requiredAuthentication()
      const actual = createHash('sha256').update(credential, 'utf8').digest()
      if (!timingSafeEqual(actual, this.expectedDigest)) throw invalidAuthentication()
      const lease = new DigestProductPrincipalLease(this.principal, (revokedLease) => {
        this.leases.delete(revokedLease)
      })
      this.leases.add(lease)
      return Promise.resolve(lease)
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : invalidAuthentication())
    }
  }

  /** Stop new authentication and revoke every provider-owned lease. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const lease of [...this.leases]) lease.revoke()
  }
}

/** Create and register one configured digest provider. */
export function apply(ctx: Context, config: Config): void {
  const provider = new DigestProductPrincipalProvider(resolveDigestProductPrincipalSpec(config))
  const dispose = ctx.productPrincipals.registerProvider(provider)
  ctx.effect(() => async () => {
    await dispose()
    provider.close()
  }, 'product-principal-digest: provider')
}
