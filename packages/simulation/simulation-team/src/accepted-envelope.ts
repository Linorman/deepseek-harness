/** Exact retained publication attribution shared by live delivery and cross-owner recovery. */
import { isDeepStrictEqual } from 'node:util'
import type { TeamEnvelope } from '@clocky/clocky-team'
import type { SimulationOperation, SimulationSnapshot } from '@clocky/clocky-simulation'

/**
 * Verify the complete publication identity before rendering can discard transport provenance.
 * @param state - Original Native projection containing the accepted decision and canonical bindings.
 * @param operation - Applied communication whose exact publication receipt is retained.
 * @param envelope - Actual persisted Team Envelope selected by the receipt.
 */
export function assertAcceptedSimulationEnvelope(state: SimulationSnapshot,
  operation: SimulationOperation, envelope: TeamEnvelope): void {
  const receipt = operation.outbox?.receipt, decision = state.decisions[operation.decisionId]
  const sender = state.entities[operation.entityId]?.binding
  const recipient = operation.action.kind === 'communication/post' ? state.entities[operation.action.recipient]?.binding : undefined
  if (operation.action.kind !== 'communication/post' || operation.result?.status !== 'applied'
    || receipt === undefined || decision?.status !== 'accepted' || decision.closedAt === undefined
    || sender === undefined || recipient === undefined || BigInt(state.time) < BigInt(operation.action.deliverAt)
    || receipt.operationId !== operation.id || receipt.fingerprint !== operation.fingerprint || receipt.runId !== state.spec.runId
    || receipt.teamId !== sender.teamId || receipt.teamId !== recipient.teamId || receipt.recipientId !== recipient.participantId
    || receipt.channelId !== operation.action.channelId || envelope.id !== receipt.envelopeId
    || envelope.teamId !== receipt.teamId || envelope.channelId !== receipt.channelId || envelope.sequence !== receipt.sequence
    || envelope.senderId !== sender.participantId || envelope.kind !== 'message' || envelope.delivery !== 'context'
    || !isDeepStrictEqual(envelope.audience, [recipient.participantId])
    || !isDeepStrictEqual(envelope.payload, { content: [{ type: 'text', text: operation.action.text }] })
    || envelope.traceId !== operation.fingerprint
    || envelope.correlationId !== JSON.stringify([state.spec.runId, operation.decisionId, operation.id, decision.closedAt])
    || envelope.causationId !== undefined || envelope.taskId !== undefined || envelope.ttlMs !== undefined) {
    throw new Error('Simulation publication Envelope differs from its original accepted attribution')
  }
}
