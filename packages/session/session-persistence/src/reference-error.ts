/** A collector may retry when an observed physical Session prefix advances. @module @clocky/clocky-session-persistence/reference-error */
import type { SessionId } from '@clocky/clocky-session'

/** A valid source moved during optimistic checkpoint collection. */
export class SessionPersistenceReferenceChanged extends Error {
  override readonly name = 'SessionPersistenceReferenceChanged'
  /**
   * Identify the changed source without treating corruption as retryable movement.
   * @param sessionId - Session whose capture must be discarded.
   * @param kind - Cursor mismatch or revision movement during the physical read.
   */
  constructor(readonly sessionId: SessionId, readonly kind: 'cursor' | 'source') {
    super(kind === 'cursor' ? 'Session checkpoint cursor moved' : 'Session checkpoint source changed during collection')
  }
}
