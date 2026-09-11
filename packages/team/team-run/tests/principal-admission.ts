/** Authenticated product endpoint consent for TeamRun fixtures. */
import type { Context } from '@clocky/cordis'
import ProductPrincipals, { ProductPrincipalError, productPrincipalId } from '@clocky/clocky-product-principal'
import * as HumanActors from '@clocky/clocky-team-human-actor'
import type { HumanChannelAdmission } from '@clocky/clocky-team-channel-admission'
import { createPrincipalChannelAdmission } from '@clocky/clocky-team-channel-admission/principal'

/**
 * Authenticate one test credential and retain endpoint consent only for the supplied operation.
 * @param ctx - Real Team/provider fixture context.
 * @param owner - Stable principal issued by this fixture provider.
 * @param operation - Product creation that validates its exact invitation manifest.
 * @returns The operation result after its credential lease is revoked.
 */
export async function withPrincipalAdmission<T>(
  ctx: Context, owner: string, operation: (admit: HumanChannelAdmission) => Promise<T>,
): Promise<T> {
  if (ctx.get('productPrincipals') === undefined) await ctx.plugin(ProductPrincipals)
  if (ctx.get('teamHumanActors') === undefined) await ctx.plugin(HumanActors)
  const credential = 'team-run-fixture-credential'
  const unregister = ctx.productPrincipals.registerProvider({
    name: 'team-run-fixture',
    async authenticate(request) {
      if (request.credential !== credential) throw new ProductPrincipalError('Fixture credential is invalid', 'PRODUCT_AUTH_INVALID')
      const controller = new AbortController()
      return { principal: { id: productPrincipalId(owner), issuer: 'team-run-fixture', subject: owner,
        assurance: 'fixture', credentialGeneration: 1 }, signal: controller.signal, revoke: () => { controller.abort() } }
    },
  })
  const lease = await ctx.productPrincipals.authenticate({ provider: 'team-run-fixture', credential })
  try { return await lease.withCall(async call => await operation(createPrincipalChannelAdmission(ctx, call))) }
  finally { await lease.revoke(); unregister() }
}
