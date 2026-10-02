/** Deterministic credential input to the real product-principal registry; native journals and SDK transport remain production owners. */
import type { Context } from '@clocky/cordis'
import { ProductPrincipalError, productPrincipalId } from '@clocky/clocky-product-principal'

export const inject = ['productPrincipals']
export function apply(ctx: Context): void {
  const leases = new Set<AbortController>()
  ctx.effect(() => ctx.productPrincipals.registerProvider({
    name: 'local',
    async authenticate(request) {
      if (request.credential !== 'sdk-company-test-credential' || request.signal?.aborted) {
        throw new ProductPrincipalError('Product authentication is invalid', 'PRODUCT_AUTH_INVALID')
      }
      const lifetime = new AbortController()
      leases.add(lifetime)
      return { principal: { id: productPrincipalId('sdk-reader'), issuer: 'sdk-scenario', subject: 'reader',
        assurance: 'test', credentialGeneration: 1 }, signal: lifetime.signal,
      revoke: () => { lifetime.abort(); leases.delete(lifetime) } }
    },
  }))
  ctx.effect(() => () => { for (const lease of leases) lease.abort() })
}
