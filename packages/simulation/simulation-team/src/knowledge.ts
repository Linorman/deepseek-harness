/** Match report references to canonical messages already entering a model request. @module @clocky/clocky-simulation-team/knowledge */
import { isDeepStrictEqual } from 'node:util'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import type { Agent } from '@clocky/clocky-agent'
import type { Message, UserMessage } from '@clocky/clocky-llm'
import type { SimulationSnapshot, SimulationOperationId, SimulationRun, SimulationEntityId, SimulationContextRequest } from '@clocky/clocky-simulation'

function reportInput(state: SimulationSnapshot, id: SimulationOperationId): UserMessage {
  const operation = Object.hasOwn(state.operations, id) ? state.operations[id] : undefined
  const sender = operation === undefined ? undefined : state.entities[operation.entityId]?.binding
  if (operation?.action.kind !== 'communication/post' || operation.outbox?.receipt === undefined || sender === undefined) {
    throw new Error('Simulation report reference has no canonical publication')
  }
  return renderDirectV4EnvelopeInput({ id: operation.outbox.receipt.envelopeId, channelId: operation.outbox.receipt.channelId,
    teamId: sender.teamId, senderId: sender.participantId, delivery: 'context', payload: { content: [{ type: 'text', text: operation.action.text }] } })
}
/**
 * Mark only exact report messages already present in the conversation or next-step input batch.
 * @param run - Authoritative versions and publication records.
 * @param actor - Canonical model actor.
 * @param entityId - Server-derived viewer.
 * @param context - Requested knowledge ids.
 * @param cursor - Fixed decision/window cursor.
 * @returns context selection with validated reference-only reports.
 */
export function modelKnowledge(run: SimulationRun, actor: Agent, entityId: SimulationEntityId,
  context: Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'>, cursor: number): typeof context {
  if (context.knowledge === undefined) return context
  const state = run.snapshot()
  const messages = [...actor.session.deriveMessages(), ...actor.inbox.nextStep]
  const items = run.queryKnowledge({ viewer: entityId, time: state.time, cursor,
    ids: context.knowledge.ids, limit: context.knowledge.ids.length })
  const visibleReports = items.flatMap((item) => {
    const source = item.source
    if (source.kind !== 'report') return []
    return messages.some(message => isDeepStrictEqual(message, reportInput(state, source.operationId))) ? [source.operationId] : []
  })
  return { ...context, knowledge: { ...context.knowledge, visibleReports } }
}
/**
 * Identify report originals removed from a conversation prefix or prospective step input.
 * @param state - Immutable publication evidence.
 * @param references - Currently reference-only reports.
 * @param messages - Exact currently visible and incoming messages.
 * @returns the references whose bodies must be rematerialized before another model request.
 */
export function missingReportReferences(state: SimulationSnapshot, references: readonly SimulationOperationId[],
  messages: readonly Message[]): SimulationOperationId[] {
  return references.filter(id => !messages.some(message => isDeepStrictEqual(message, reportInput(state, id))))
}
/**
 * Reject a prepared reference if its canonical original disappeared before model dispatch.
 * @param state - Immutable publication evidence.
 * @param references - Reports omitted from the supplementary knowledge section.
 * @param messages - Exact model request messages, already checked against Session reconstruction.
 */
export function assertReportReferences(state: SimulationSnapshot, references: readonly SimulationOperationId[],
  messages: readonly Message[]): void {
  if (missingReportReferences(state, references, messages).length > 0) {
    throw new Error('Simulation referenced report is absent from the model request; prepare a new decision')
  }
}

/**
 * Keep policy views self-contained instead of trusting model-Session report visibility hints.
 * @param context - Authorized selection before first preparation or window freezing.
 * @returns the same selection with report bodies eligible for materialization.
 */
export function policyKnowledge(context: Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'>): typeof context {
  if (context.knowledge === undefined) return context
  const { visibleReports: _hints, ...knowledge } = context.knowledge
  return { ...context, knowledge }
}
