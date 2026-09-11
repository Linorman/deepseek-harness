import type { Context } from '@clocky/cordis'
import ProductPrincipalRegistry, {
  ProductPrincipalError,
  productPrincipalId,
} from '@clocky/clocky-product-principal'
import type {
  AuthenticatedProductPrincipalLease,
  AuthenticatedProductCall,
  ProductPrincipal,
  ProductPrincipalProvider,
  ProductPrincipalProviderAuthenticateRequest,
  ProductPrincipalProviderLease,
} from '@clocky/clocky-product-principal'

/** Test-only credential sent through the SDK initialization boundary. */
export const SDK_TEST_CREDENTIAL = 'sdk-test-product-credential'

/** Test-only provider name selected by the SDK server's default configuration. */
const SDK_TEST_PRODUCT_PROVIDER = 'local'

/** Build a provider that never reflects its opaque test credential in an error. */
function testProductPrincipalProvider(
  credential = SDK_TEST_CREDENTIAL,
  name = SDK_TEST_PRODUCT_PROVIDER,
): ProductPrincipalProvider {
  return {
    name,
    async authenticate(request: ProductPrincipalProviderAuthenticateRequest): Promise<ProductPrincipalProviderLease> {
      if (request.credential === undefined || request.credential.length === 0) {
        throw new ProductPrincipalError('Product authentication is required', 'PRODUCT_AUTH_REQUIRED')
      }
      if (request.credential !== credential || request.signal?.aborted === true) {
        throw new ProductPrincipalError('Product authentication is invalid', 'PRODUCT_AUTH_INVALID')
      }
      const controller = new AbortController()
      const principal: ProductPrincipal = Object.freeze({
        id: productPrincipalId('sdk-test-principal'),
        issuer: name,
        subject: 'sdk-test-user',
        assurance: 'test',
        credentialGeneration: 1,
      })
      return {
        principal,
        signal: controller.signal,
        revoke: () => { controller.abort() },
      }
    },
  }
}

/** Mount the real registry with a deterministic local test provider. */
export async function installTestProductPrincipals(ctx: Context, credential = SDK_TEST_CREDENTIAL): Promise<void> {
  await ctx.plugin(ProductPrincipalRegistry)
  ctx.productPrincipals.registerProvider(testProductPrincipalProvider(credential))
}

/** Structural authentication registry for tests that intentionally use a partial Context. */
export function testProductPrincipals(credential = SDK_TEST_CREDENTIAL): Pick<ProductPrincipalRegistry, 'authenticate'> {
  return {
    async authenticate(request): Promise<AuthenticatedProductPrincipalLease> {
      const provider = testProductPrincipalProvider(credential)
      const providerLease = await provider.authenticate(request)
      let revoked = false
      return {
        async withCall<T>(operation: (call: AuthenticatedProductCall) => Promise<T>): Promise<T> {
          if (revoked || providerLease.signal.aborted) {
            throw new ProductPrincipalError('Product authentication is invalid', 'PRODUCT_AUTH_INVALID')
          }
          return await operation(Object.freeze({
            principal: providerLease.principal,
            credentialGeneration: providerLease.principal.credentialGeneration,
            signal: providerLease.signal,
          }))
        },
        async revoke(): Promise<void> {
          revoked = true
          await providerLease.revoke()
        },
      }
    },
  }
}
