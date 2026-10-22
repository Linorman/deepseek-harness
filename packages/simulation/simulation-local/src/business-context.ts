/** The Native context owner derives safe current responsibilities from the actor and its actual consumed wake. */
import { isDeepStrictEqual } from 'node:util'
import { simulationBusinessContextSchema } from '@clocky/clocky-simulation'
import type { SimulationBusinessContext, SimulationDecision, SimulationSnapshot, SimulationInteractionId, SimulationOperationAction } from '@clocky/clocky-simulation'

/**
 * Select every active responsibility and only terminal business linked to this actor's actual current wake.
 * @param state - Current Native owner prefix; changed responsibility after decision selection refuses preparation.
 * @param decision - Owner-selected current actor/slot; there is no alternate viewer parameter.
 * @returns complete safe material, or undefined when this actor has no applicable responsibility.
 */
export function businessContext(state: SimulationSnapshot, decision: SimulationDecision): SimulationBusinessContext | undefined {
  const actor = decision.entityId, related = new Set<SimulationInteractionId>()
  // Immutable party history also detects a duty cancelled after claim; filtering terminal state must not erase that check.
  // The sole decision/opened record changes no business fields; other intervening records require unavailable historical evidence.
  const partyHistory = Object.values(state.interactions).some(item => item.requester === actor || item.assignee === actor)
    || Object.values(state.commitments).some(item => item.debtor === actor || item.creditor === actor)
  if (partyHistory && (state.revision < decision.snapshotRevision || state.revision > decision.snapshotRevision + 1))
    throw new Error('Business context requires its original unchanged decision prefix')
  const wake = decision.wakeId === undefined ? undefined : state.wakes[decision.wakeId]
  const event = wake === undefined ? undefined : state.scheduledEvents[wake.eventId]
  if (wake?.entityId === actor && wake.status === 'claimed' && wake.decisionId === decision.id && event?.status === 'consumed') {
    if (event.action.kind === 'reply-wake' || event.action.kind === 'reply-deadline') related.add(event.action.interactionId)
    else if (event.action.kind === 'commitment-deadline') {
      const commitment = state.commitments[event.action.commitmentId]
      if (commitment !== undefined) related.add(commitment.interactionId)
    }
    const operation = event.sourceOperationId === undefined ? undefined : state.operations[event.sourceOperationId]
    if (operation?.result?.status === 'applied') {
      const id = interactionActionId(operation.action)
      if (id !== undefined) related.add(id)
    }
    for (const post of Object.values(state.operations)) {
      if (post.action.kind !== 'communication/post' || post.action.recipient !== actor || post.result?.status !== 'applied'
        || post.delivery?.wakeId !== wake.eventId || post.delivery.receipt === undefined) continue
      const source = state.decisions[post.decisionId]
      if (source?.status !== 'accepted' || !source.operationIds.includes(post.id))
        throw new Error('Business message wake lost its original accepted source')
      for (const id of source.operationIds) {
        const effect = state.operations[id]
        if (effect?.result?.status !== 'applied') continue
        const interactionId = interactionActionId(effect.action)
        if (interactionId !== undefined) related.add(interactionId)
      }
    }
  }
  const applicable = Object.values(state.interactions).filter((item) => {
    if (item.requester !== actor && item.assignee !== actor) return false
    const commitment = item.commitmentId === undefined ? undefined : state.commitments[item.commitmentId]
    return active(item, commitment?.phase) || related.has(item.id)
  }).sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1)
  const interactions = applicable.map((item) => {
    const { task: _task, ...safe } = item
    const commitment = item.commitmentId === undefined ? undefined : state.commitments[item.commitmentId]
    return { ...safe, selection: active(item, commitment?.phase) ? 'active' as const : 'current-wake' as const }
  })
  const selected = new Set(applicable.map(item => item.id))
  const commitments = Object.values(state.commitments).filter(item => (item.debtor === actor || item.creditor === actor)
    && (item.phase === 'open' || selected.has(item.interactionId))).sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1).map((item) => {
    const { taskEvidence: _taskEvidence, ...safe } = item
    return { ...safe, selection: item.phase === 'open' ? 'active' as const : 'current-wake' as const }
  })
  if (interactions.length === 0 && commitments.length === 0) return undefined
  const selectedCommitments = new Set(commitments.map(item => item.id))
  const originalOperation = (id: import('@clocky/clocky-simulation').SimulationOperationId) => {
    const result = state.operations[id]?.result
    if (result?.status !== 'applied' || result.sequence > decision.snapshotRevision)
      throw new Error('Business context source operation is absent or newer than its original decision prefix')
  }
  for (const item of interactions) {
    originalOperation(item.createdBy)
    if (item.resultOperationId !== undefined) originalOperation(item.resultOperationId)
  }
  for (const item of commitments) { originalOperation(item.createdBy); for (const id of item.evidence) originalOperation(id) }
  for (const operation of Object.values(state.operations)) {
    if (operation.result?.status !== 'applied') continue
    const action = operation.action
    const interactionId = interactionActionId(action)
    if (interactionId !== undefined && selected.has(interactionId)
      || 'transaction' in action && action.transaction.commitmentId !== null && selectedCommitments.has(action.transaction.commitmentId))
      originalOperation(operation.id)
  }
  for (const event of Object.values(state.scheduledEvents)) if (event.status === 'consumed' && event.settledAt !== undefined
    && event.settledAt > decision.snapshotRevision && (event.action.kind === 'reply-deadline' && selected.has(event.action.interactionId)
      || event.action.kind === 'commitment-deadline' && selectedCommitments.has(event.action.commitmentId)))
    throw new Error('Business context deadline changed after its original decision prefix')
  const routes = Object.values(state.channelReservations ?? {}).filter(item => item.confirmed
    && item.spec.members.some(member => member.entityId === actor)).sort((a, b) => a.spec.key < b.spec.key ? -1 : 1).map(item => ({
    channelId: item.channelId, key: item.spec.key, confirmation: 'native-confirmed-membership' as const,
    members: item.spec.members.map(member => member.entityId),
  }))
  return simulationBusinessContextSchema.parse({ kind: 'simulation-business-context', version: 1, actorId: actor,
    coverage: 'active-and-current-wake-only', source: { kind: 'run-event', runId: state.spec.runId, sequence: decision.snapshotRevision },
    decisionSnapshotRevision: decision.snapshotRevision,
    ...[...interactions, ...commitments].some(item => item.selection === 'current-wake') ? { currentWakeId: decision.wakeId } : {},
    interactions, commitments, routes })
}
function active(item: SimulationSnapshot['interactions'][SimulationInteractionId], phase: string | undefined): boolean {
  return phase === 'open' || item.execution === 'pending' && item.replyExpiredAt === undefined
    && (item.reply === 'pending' || item.reply === 'deferred')
}

/**
 * Check the frozen block's actor, Native prefix and required-source attribution without replacing historical business state.
 * @param state - Published Native projection after context preparation or later business transitions.
 * @param decision - Original decision retaining its immutable recorded view.
 */
export function assertBusinessContextProjection(state: SimulationSnapshot, decision: SimulationDecision): void {
  const context = decision.context
  if (context?.status !== 'prepared') return
  const found = context.view.content.flatMap(section => section.blocks.flatMap((block) => {
    const material = businessMaterial(block)
    return material === undefined ? [] : [{ section, material: simulationBusinessContextSchema.parse(material) }]
  }))
  if (found.length > 1) throw new Error('Business context cannot repeat its original complete responsibility block')
  for (const { material } of found) for (const route of material.routes) {
    const retained = state.channelReservations?.[route.key]
    if (retained?.confirmed !== true || retained.channelId !== route.channelId
      || !isDeepStrictEqual(retained.spec.members.map(member => member.entityId), route.members))
      throw new Error('Business context route lost its original Native-confirmed membership')
  }
  for (const { section, material } of found) if (section.kind !== 'commitments' || !context.requiredSections.includes('commitments')
    || material.actorId !== decision.entityId || material.source.runId !== state.spec.runId
    || material.source.sequence !== decision.snapshotRevision || material.source.sequence >= state.revision
    || material.currentWakeId !== undefined && material.currentWakeId !== decision.wakeId
    || !context.view.sources.some(value => isDeepStrictEqual(value, material.source)))
    throw new Error('Business context lost its original actor, prefix, current wake or required source')
}
/**
 * Recognize reserved Native material without interpreting ordinary prose or nested quoted messages as authority.
 * @param block - One prospective context text block.
 * @returns the reserved material candidate, or undefined for unrelated prose.
 */
export function businessMaterial(block: { readonly type: string }): unknown {
  if (block.type !== 'text' || !('text' in block) || typeof block.text !== 'string') return undefined
  let value: unknown
  try { value = JSON.parse(block.text) }
  catch { return undefined /* Ordinary context prose does not declare Native responsibility material. */ }
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'simulation-business-context' ? value : undefined
}

function interactionActionId(action: SimulationOperationAction): SimulationInteractionId | undefined {
  switch (action.kind) {
    case 'interaction/request': case 'interaction/accept': case 'interaction/reject': case 'interaction/defer':
    case 'interaction/cancel': case 'interaction/confirm': case 'interaction/result': return action.id
    default: return undefined // Other installed operations cannot establish an interaction identity.
  }
}
