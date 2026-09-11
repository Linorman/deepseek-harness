/** Runtime-only product-call context for Host API dispatch. */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'

const calls = new AsyncLocalStorage<AuthenticatedProductCall | undefined>()

/**
 * Run one Host API dispatch with its already-authenticated product principal.
 * @param call - Immutable transport-authenticated call facts, absent only for an untrusted dispatch.
 * @param operation - API work that may read the current call without serializing it.
 * @returns the operation's value.
 */
export function withAuthenticatedProductCall<T>(
  call: AuthenticatedProductCall | undefined,
  operation: () => T,
): T {
  return calls.run(call, operation)
}

/**
 * Return the runtime-only product call for the current Host API dispatch.
 * @returns the authenticated context, or undefined when no transport admitted one.
 */
export function currentAuthenticatedProductCall(): AuthenticatedProductCall | undefined {
  return calls.getStore()
}
