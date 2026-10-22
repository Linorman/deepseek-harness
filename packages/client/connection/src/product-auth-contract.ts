/** Browser/Host names for the local product-auth bootstrap exchange. */

import { API_PATH } from './api-path.ts'

/** Loopback-only endpoint that exchanges a private handoff credential body for an HttpOnly cookie. */
export const PRODUCT_AUTH_BOOTSTRAP_PATH = `${API_PATH}/bootstrap`
/** Resolve the listener-specific browser cookie name; cookies themselves do not distinguish ports.
 * @param port - Actual trusted listening port, including an OS-assigned port resolved after startup.
 * @returns stable cookie name for this listener, independent of untrusted request headers.
 * @throws when the listener has not resolved a valid port.
 */
export function productAuthCookieName(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Product authentication requires a resolved listening port')
  return `clocky_product_auth_${port}`
}
/** Browser global whose promise settles after a Host-injected product-auth exchange. */
export const PRODUCT_AUTH_BOOTSTRAP_PROMISE = '__CLOCKY_PRODUCT_AUTH_BOOTSTRAP__'

/** Page-global shape shared by the early bootstrap script and browser carrier. */
export interface ProductAuthBootstrapGlobal {
  /** Resolves once the bootstrap cookie exchange finishes; rejects without credential text. */
  [PRODUCT_AUTH_BOOTSTRAP_PROMISE]?: Promise<void>
}
