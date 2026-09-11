import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@clocky/cordis'
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

/** SDK runtime's process-local product-principal provider for its private stdio pipe. */
export const name = 'sdk-product-principal'
export const inject = ['productPrincipals']

class SdkProductPrincipalProvider implements ProductPrincipalProvider {
  private readonly principal: ProductPrincipal = Object.freeze({
    id: productPrincipalId(randomUUID()),
    issuer: 'sdk-stdio',
    subject: 'sdk-pipe-owner',
    assurance: 'stdio-owner',
    credentialGeneration: 1,
  })
  private readonly leases = new Set<AbortController>()
  private digest: string | undefined
  private closed = false

  readonly name = 'local'

  async authenticate(request: ProductPrincipalProviderAuthenticateRequest): Promise<ProductPrincipalProviderLease> {
    if (this.closed || request.signal?.aborted === true) throw invalid()
    const credential = request.credential
    if (credential === undefined || credential.length === 0) {
      throw new ProductPrincipalError('Product authentication is required', 'PRODUCT_AUTH_REQUIRED')
    }
    const digest = createHash('sha256').update(credential, 'utf8').digest('hex')
    if (this.digest === undefined) this.digest = digest
    if (this.digest !== digest) throw invalid()
    const controller = new AbortController()
    this.leases.add(controller)
    return {
      principal: this.principal,
      signal: controller.signal,
      revoke: () => {
        controller.abort()
        this.leases.delete(controller)
      },
    }
  }

  close(): void {
    this.closed = true
    for (const lease of this.leases) lease.abort()
    this.leases.clear()
  }
}

function invalid(): ProductPrincipalError {
  return new ProductPrincipalError('Product authentication is invalid', 'PRODUCT_AUTH_INVALID')
}

export function apply(ctx: Context): void {
  const provider = new SdkProductPrincipalProvider()
  const dispose = ctx.productPrincipals.registerProvider(provider)
  ctx.effect(async () => async () => {
    await dispose()
    provider.close()
  }, 'sdk-product-principal: provider')
}
