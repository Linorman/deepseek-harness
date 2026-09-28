import { expect, it } from 'vitest'
import { Session, SessionId } from '@clocky/clocky-session'
import { createUserMessage } from '@clocky/clocky-llm'
import { CompactionId, compactionRequestReference, recordCompactionRequest } from '@clocky/clocky-compaction'

it('binds immutable request content to the canonical active compaction transaction', () => {
  const session = Session.create(SessionId('compaction-request'))
  const options = { sessionId: session.id, purpose: 'compaction' as const, provider: 'mock', model: 'mock',
    messages: [createUserMessage({ content: [{ type: 'text', text: 'Private source' }], source: { kind: 'user' } })] }
  expect(() => recordCompactionRequest(session, options)).toThrow(/active canonical transaction/)
  const compactionId = CompactionId('request-owner')
  const start = session.append('compaction/start', { compactionId, turn: null })
  expect(() => recordCompactionRequest(session, { ...options, sessionId: SessionId('other') })).toThrow(/canonical/)
  expect(() => recordCompactionRequest(session, { ...options, purpose: 'session-title' })).toThrow(/canonical/)
  const request = recordCompactionRequest(session, options)
  const reference = compactionRequestReference(request)
  expect(reference?.session).toBe(session)
  expect(reference?.event.data).toEqual({ compactionId, startSequence: start.seq,
    request: { provider: options.provider, model: options.model, messages: options.messages } })
  expect(Object.isFrozen(request.messages[0]!.content)).toBe(true)
  expect(compactionRequestReference({ ...request })).toBeUndefined()
  expect(compactionRequestReference(options)).toBeUndefined()
  session.append('compaction/end', { compactionId, turn: null, error: 'cancelled' })
  expect(() => recordCompactionRequest(session, options)).toThrow(/active canonical transaction/)
})
