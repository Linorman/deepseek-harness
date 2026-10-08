/** Settlement ownership shared by Team providers with accepted background work. */

/** Observe an accepted operation without replacing the caller's original result.
 * @param accepted - Provider-owned operations retained until settlement.
 * @param operation - Original operation to observe exactly once.
 * @param onRejected - Synchronous provider diagnostic, invoked after ownership is released; failures are contained.
 */
export function trackTeamOperation<T>(
  accepted: Set<Promise<T>>, operation: Promise<T>, onRejected: (error: unknown) => void,
): void {
  if (accepted.has(operation)) return
  accepted.add(operation)
  void operation.then(
    () => { accepted.delete(operation) },
    (error: unknown) => {
      accepted.delete(operation)
      try { onRejected(error) }
      catch (_diagnosticFailure: unknown) {
        // A diagnostic failure cannot restore settled ownership or create another unobserved rejection.
      }
    },
  )
}
