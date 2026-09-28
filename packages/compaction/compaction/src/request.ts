/** Exact compaction model requests and process-local ownership references. @module @clocky/clocky-compaction/request */
import { deepFreeze } from '@clocky/clocky-llm'
import type { GenerateOptions } from '@clocky/clocky-llm'
import type { Session, SessionEvent } from '@clocky/clocky-session'
import type {} from './types.ts'

/** A request is identified by its canonical Session object and append position. */
export interface CompactionRequestReference {
  readonly session: Session
  readonly event: SessionEvent<'compaction/request'>
}
const references = new WeakMap<GenerateOptions, CompactionRequestReference>()

/**
 * Record a complete auxiliary request before dispatch and bind its options to that record.
 * @param session - Canonical Session with an active compaction transaction.
 * @param options - Fully assembled compaction request, including the final instruction.
 * @returns options with immutable content and an ownership reference; ordinary routing scalars remain mutable.
 */
export function recordCompactionRequest(session: Session, options: GenerateOptions): GenerateOptions {
  const start = session.events.findLast(event => event.type === 'compaction/start')
  if (start?.type !== 'compaction/start' || session.events.some(event => event.seq > start.seq
    && event.type === 'compaction/end' && event.data.compactionId === start.data.compactionId)
    || options.sessionId !== session.id || options.purpose !== 'compaction') {
    throw new Error('Compaction model request requires its active canonical transaction')
  }
  const { signal, sessionId: _sessionId, purpose: _purpose, ...body } = options
  const request = deepFreeze(structuredClone(body))
  const event = session.append('compaction/request', { compactionId: start.data.compactionId, startSequence: start.seq, request })
  const stamped = { ...request, sessionId: session.id, purpose: 'compaction' as const,
    ...signal === undefined ? {} : { signal } }
  references.set(stamped, { session, event })
  return stamped
}

/**
 * Read the ownership reference installed by the compaction request recorder.
 * @param options - Exact options entering the LLM waterfall.
 * @returns its canonical Session event, or undefined for unowned/cloned requests.
 */
export function compactionRequestReference(options: GenerateOptions): CompactionRequestReference | undefined {
  return references.get(options)
}
