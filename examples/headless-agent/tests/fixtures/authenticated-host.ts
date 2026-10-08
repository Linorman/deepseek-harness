/** Principal-owned Team and Host event access for real Loader fixtures. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { currentAuthenticatedProductCall, withAuthenticatedProductCall } from '@clocky/clocky-host-apiproxy'
import { ProductPrincipalError, productPrincipalId } from '@clocky/clocky-product-principal'
import { createPrincipalChannelAdmission } from '@clocky/clocky-team-channel-admission/principal'
import type { TeamRunCreateRequest, TeamRunHandle } from '@clocky/clocky-team-run'

/**
 * Authenticate a stable fixture principal for the complete Host operation, including its event subscription.
 * @param ctx - Loader-owned Host context.
 * @param operation - Scenario that needs authenticated product access.
 * @returns The scenario result after its lease and provider are retired.
 */
export async function withFixturePrincipal<T>(ctx: Context, operation: () => Promise<T>): Promise<T> {
  await ctx.get('loader')?.await()
  const principals = ctx.get('productPrincipals')
  assert(principals !== undefined)
  const credential = 'snapshot-host-credential'
  const unregister = principals.registerProvider({
    name: 'snapshot-host',
    async authenticate(request) {
      if (request.credential !== credential) throw new ProductPrincipalError('Invalid fixture credential', 'PRODUCT_AUTH_INVALID')
      const controller = new AbortController()
      return { principal: { id: productPrincipalId('snapshot-host-person'), issuer: 'snapshot-host', subject: 'snapshot-host-person',
        assurance: 'fixture', credentialGeneration: 1 }, signal: controller.signal, revoke: () => { controller.abort() } }
    },
  })
  const lease = await principals.authenticate({ provider: 'snapshot-host', credential })
  try { return await lease.withCall(call => withAuthenticatedProductCall(call, operation)) }
  finally { await lease.revoke(); await unregister() }
}

/**
 * Create a Team owned by the current fixture principal and acknowledge its exact human invitation.
 * @param ctx - Real Team and Host providers.
 * @param request - Scenario objective and model configuration.
 * @returns The created Team handle.
 */
export function createFixtureTeam(ctx: Context, request: TeamRunCreateRequest): Promise<TeamRunHandle> {
  const call = currentAuthenticatedProductCall()
  assert(call !== undefined)
  return ctx.teamRuns.create({ ...request, humanOwner: { kind: 'product-principal', principalId: call.principal.id },
    admitHumanChannel: createPrincipalChannelAdmission(ctx, call) })
}
