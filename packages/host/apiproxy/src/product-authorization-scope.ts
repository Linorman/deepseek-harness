/** Non-secret cache identity for the authenticated product principal generation. */
import { createHash } from 'node:crypto'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { ProductAuthorizationScope } from './api/rpc.ts'

/** Derive cache isolation metadata without granting read or mutation authority.
 * @param call - Principal facts established by the live transport lease.
 * @returns an opaque discriminator for this principal and credential generation.
 */
export function productAuthorizationScope(call: AuthenticatedProductCall): ProductAuthorizationScope {
  return createHash('sha256').update(JSON.stringify([call.principal.id, call.principal.issuer,
    call.principal.subject, call.credentialGeneration])).digest('hex') as ProductAuthorizationScope
}
