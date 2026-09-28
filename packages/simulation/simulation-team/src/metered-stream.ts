/** Token settlement shared by conversation and owned auxiliary model calls. @module @clocky/clocky-simulation-team/metered-stream */
import type { StreamChunk } from '@clocky/clocky-llm'
import type { SimulationTokenReservation, SimulationTokenUsage, SimulationWriterLease } from '@clocky/clocky-simulation'

/**
 * Preserve complete, partial and proven-undispatched accounting through downstream cleanup.
 * @param writer - Reservation-owning epoch, still able to settle after revocation.
 * @param reservation - Durable token reservation preceding downstream dispatch.
 * @param next - The remaining LLM waterfall.
 * @param check - Final asynchronous admission check before entering downstream code.
 * @param flush - Canonical Session durability barrier before token settlement.
 * @param signal - Final cancellation check after asynchronous authority validation.
 * @returns forwarded chunks while retaining accurate terminal accounting.
 */
export async function* meteredStream(writer: SimulationWriterLease, reservation: SimulationTokenReservation,
  next: () => AsyncIterable<StreamChunk>, check: () => void | Promise<void>, flush: () => Promise<boolean>,
  signal: AbortSignal): AsyncIterable<StreamChunk> {
  let usage: SimulationTokenUsage | undefined
  let complete = false
  let dispatched = false
  try {
    await check()
    signal.throwIfAborted()
    dispatched = true
    for await (const chunk of next()) {
      if (chunk.type === 'usage') usage = { inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens,
        ...chunk.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: chunk.usage.cacheReadTokens },
        ...chunk.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: chunk.usage.cacheWriteTokens } }
      if (chunk.type === 'finish') complete = chunk.reason.kind === 'stop' || chunk.reason.kind === 'tool-calls'
        || chunk.reason.kind === 'max-tokens'
      yield chunk
    }
  } finally {
    if (!await flush()) throw new Error('Simulation token settlement requires durable Session usage')
    await writer.settleModelTokens(reservation.id, !dispatched ? { kind: 'not-dispatched' }
      : complete && usage !== undefined ? { kind: 'complete', usage }
        : { kind: 'unknown', ...usage === undefined ? {} : { observedUsage: usage } })
  }
}
