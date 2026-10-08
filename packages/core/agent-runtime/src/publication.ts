/** Provider-owned activation publication and status-subscription rules. */
import type { ActivationSnapshot } from '@clocky/clocky-team'
import type { ActivationHandle } from './types.ts'

/** Retain one materialization slot and retire it after failure only while that exact entry still owns it.
 * @param entries - Calling provider's independent activation registry.
 * @param key - Exact provider-owned Team/Participant identity.
 * @param entry - Pending activation whose operation is being published.
 * @param operation - Current materialization; callers continue to observe its rejection.
 * @returns the same operation after installing its identity-fenced rejection cleanup.
 */
export function retainActivationPublication<Entry extends { operation: Promise<ActivationHandle> }>(
  entries: Map<string,Entry>, key: string, entry: Entry, operation: Promise<ActivationHandle>,
): Promise<ActivationHandle> {
  entry.operation = operation
  entries.set(key, entry)
  void operation.catch(() => { if (entries.get(key) === entry) entries.delete(key) })
  return operation
}

/** Subscribe to later status observations without replaying the current snapshot.
 * @param listeners - Provider-owned observer set.
 * @param listener - Consumer's status observer.
 * @param offline - Exact activation epoch has already reached terminal residency.
 * @returns idempotent observer removal, or an inert disposer for an offline epoch.
 */
export function subscribeActivationStatus(
  listeners: Set<(activation: ActivationSnapshot) => void>, listener: (activation: ActivationSnapshot) => void, offline: boolean,
): () => void {
  if (offline) return () => {}
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
