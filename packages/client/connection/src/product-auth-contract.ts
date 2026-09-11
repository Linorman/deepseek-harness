/** Browser/Host names for the local product-auth bootstrap exchange. */

import { API_PATH } from './api-path.ts'

/** Loopback-only endpoint that exchanges a private handoff credential body for an HttpOnly cookie. */
export const PRODUCT_AUTH_BOOTSTRAP_PATH = `${API_PATH}/bootstrap`
/** Path-scoped, Host-memory-backed browser session cookie. */
export const PRODUCT_AUTH_COOKIE_NAME = 'clocky_product_auth'
/** Browser global whose promise settles after a Host-injected product-auth exchange. */
export const PRODUCT_AUTH_BOOTSTRAP_PROMISE = '__CLOCKY_PRODUCT_AUTH_BOOTSTRAP__'

/** Page-global shape shared by the early bootstrap script and browser carrier. */
export interface ProductAuthBootstrapGlobal {
  /** Resolves once the bootstrap cookie exchange finishes; rejects without credential text. */
  [PRODUCT_AUTH_BOOTSTRAP_PROMISE]?: Promise<void>
}
