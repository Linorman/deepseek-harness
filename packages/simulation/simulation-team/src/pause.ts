/** Settle only a Native refusal of this writer's prepared model decision. */
import { SimulationDecisionPausedError, type SimulationDecisionId, type SimulationWriterLease } from '@clocky/clocky-simulation'

/**
 * Confirm durable pause cancellation after the serialized admission refusal.
 * @param error - Original admission error; unrelated failures propagate unchanged.
 * @param writer - Canonical writer that attempted the model admission.
 * @param id - Exact prepared decision being dispatched.
 * @returns Whether Native recorded or already retained this pause cancellation.
 */
export async function settleDecisionPause(error: unknown, writer: SimulationWriterLease, id: SimulationDecisionId): Promise<boolean> {
  if (!(error instanceof SimulationDecisionPausedError) || error.decisionId !== id) return false
  const cancelled = await writer.cancelDecisionForPause(id)
  return cancelled?.status === 'cancelled' && cancelled.cancellation === 'paused'
}
