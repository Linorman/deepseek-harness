/** Browser-side wait point for a Host-injected product-auth bootstrap exchange. */

import {
  PRODUCT_AUTH_BOOTSTRAP_PROMISE,
  type ProductAuthBootstrapGlobal,
} from '../product-auth-contract.ts'

/**
 * Await the page's Host-injected credential-to-cookie exchange before opening any API carrier.
 * @returns a resolved promise when this transport has no local bootstrap script.
 */
export function waitForProductAuthBootstrap(): Promise<void> {
  const value = (globalThis as ProductAuthBootstrapGlobal)[PRODUCT_AUTH_BOOTSTRAP_PROMISE]
  if (value === undefined) return Promise.resolve()
  if (typeof value.then !== 'function') {
    return Promise.reject(new Error('Product authentication bootstrap is unavailable'))
  }
  return value
}
