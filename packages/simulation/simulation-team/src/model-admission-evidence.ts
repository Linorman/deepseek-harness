/** Reconstruct a refused model attempt from its canonical persisted Session prefix. */
import { foldRequestHeader } from '@clocky/clocky-session'
import { createHash } from 'node:crypto'
import type { SessionEvent, SessionId } from '@clocky/clocky-session'
import type { SimulationDecision, SimulationSnapshot } from '@clocky/clocky-simulation'
import type { SimulationCompactionAdmissionBlock } from '@clocky/clocky-simulation'
import { contextConsumption } from './context-consumption.ts'

/**
 * Verify the logged request still follows its exact consumed input in the original active turn.
 * @param decision - Retained cancelled attempt with owner-attested refusal evidence.
 * @param sessionId - Its canonical bound Session.
 * @param events - Full durable Session history.
 * @param state - Native original notification/delivery facts required by a director.
 * @returns false for absent, changed or out-of-order request/input evidence; live occupancy is not reconstructed.
 */
export function modelAdmissionEvidenceMatches(decision: SimulationDecision, sessionId: SessionId,
  events: readonly SessionEvent[], state: SimulationSnapshot): boolean {
  const blocked = decision.modelAdmissionBlock
  if (blocked === undefined || events[blocked.sessionSequence]?.seq !== blocked.sessionSequence) return false
  const prefix = events.slice(0, blocked.sessionSequence + 1)
  const turn = prefix.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  if (turn?.type !== 'turn/start' || foldRequestHeader(prefix) === undefined) return false
  let consumed
  try { consumed = contextConsumption(decision, sessionId, prefix, state) }
  catch { return false } // Changed or missing canonical consumption cannot attest a refused request.
  return consumed.consumedSequence > turn.seq
}

/**
 * Match a refused auxiliary call to its recorded canonical compaction transaction.
 * @param block - Native writer-attested refusal.
 * @param events - Full durable history of the block's bound Session.
 * @returns whether the request and preceding start retain the original transaction/provider/model identity.
 */
export function compactionAdmissionEvidenceMatches(block: SimulationCompactionAdmissionBlock, events: readonly SessionEvent[]): boolean {
  const event = events[block.request.sessionSequence]
  if (event?.type !== 'compaction/request' || event.seq !== block.request.sessionSequence
    || event.data.compactionId !== block.request.compactionId || event.data.request.provider !== block.request.provider
    || event.data.request.model !== block.request.model || compactionAdmissionRequestHash(event.data) !== block.requestHash) return false
  const start = events[event.data.startSequence]
  return start?.type === 'compaction/start' && start.data.compactionId === block.request.compactionId && start.seq < event.seq
    && !events.slice(start.seq + 1, event.seq).some(value => value.type === 'compaction/end'
      && value.data.compactionId === block.request.compactionId)
}

/**
 * Freeze the complete auxiliary input identity without copying it into Native history.
 * @param data - Complete canonical request event data.
 * @returns its SHA-256 identity retained by the refusal owner.
 */
export function compactionAdmissionRequestHash(data: SessionEvent<'compaction/request'>['data']): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex')
}
