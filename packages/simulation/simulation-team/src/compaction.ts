/**
 * Admit compaction-owner requests under the canonical writer and model budget.
 * @module @clocky/clocky-simulation-team/compaction
 */
import { isDeepStrictEqual } from 'node:util'
import { compactionRequestReference } from '@clocky/clocky-compaction'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import type { Agent } from '@clocky/clocky-agent'
import type { SimulationWriterLease } from '@clocky/clocky-simulation'
import type { SimulationModelCapacity } from './model-capacity.ts'
import { meteredStream } from './metered-stream.ts'

/**
 * Check the durable transaction and exact model envelope before and after waiting for model capacity.
 * @param actor - Canonical actor whose Session is being compacted.
 * @param writer - Its current controller-owned writer.
 * @param options - Immutable options stamped by the compaction request recorder.
 * @param next - Remaining LLM waterfall.
 * @param capacity - Shared Simulation model permits.
 * @param signal - Combined caller and connection cancellation.
 * @param check - Live connection and actor validation.
 * @param flush - Canonical request/usage persistence barrier.
 * @returns metered auxiliary chunks without creating a world decision.
 */
export async function* compactionStream(actor: Agent, writer: SimulationWriterLease, options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>, capacity: SimulationModelCapacity, signal: AbortSignal,
  check: () => void, flush: () => Promise<boolean>): AsyncIterable<StreamChunk> {
  const reference = compactionRequestReference(options)
  if (reference === undefined) throw new Error('Simulation auxiliary request has no active exact compaction ownership')
  const validate = (): void => {
    check(); signal.throwIfAborted()
    const event = reference.event
    const current = actor.session.events[event.seq]
    const start = actor.session.events[event.data.startSequence]
    const { signal: _signal, sessionId: _sessionId, purpose: _purpose, ...request } = options
    if (options.sessionId !== actor.session.id || options.purpose !== 'compaction'
      || reference.session !== actor.session || current?.type !== 'compaction/request'
      || start?.type !== 'compaction/start' || start.data.compactionId !== event.data.compactionId
      || !isDeepStrictEqual(current.data, event.data) || !isDeepStrictEqual(event.data.request, request)
      || actor.session.events.some(value => value.seq > start.seq && value.type === 'compaction/end'
        && value.data.compactionId === start.data.compactionId)) {
      throw new Error('Simulation auxiliary request has no active exact compaction ownership')
    }
  }
  validate()
  options.signal = signal
  Object.freeze(options)
  if (!await flush()) throw new Error('Simulation compaction request requires durable Session storage')
  const release = await capacity.acquire(signal)
  try {
    validate()
    const reservation = await writer.reserveCompactionTokens({ provider: options.provider, model: options.model,
      sessionSequence: reference.event.seq, compactionId: reference.event.data.compactionId })
    yield* meteredStream(writer, reservation, next, validate, flush, signal)
  } finally { release() }
}
