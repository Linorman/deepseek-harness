/** Bounded provider-operation waits with caller-owned failure diagnostics. */

/**
 * Wait for a Team provider operation while retaining no timer after either settlement path.
 * The caller still owns cancellation and draining of an operation that exceeds the deadline.
 * @param operation - Already admitted provider work.
 * @param timeoutMs - Validated positive deadline in milliseconds.
 * @param failure - Construct the provider's exact timeout error only when the deadline expires.
 * @returns The operation result, or rejection with the provider-owned timeout failure.
 */
export async function withTeamOperationTimeout<T>(operation: Promise<T>, timeoutMs: number, failure: () => Error): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(failure()) }, timeoutMs)
  })
  try { return await Promise.race([operation, timeout]) }
  finally { clearTimeout(timer) }
}
