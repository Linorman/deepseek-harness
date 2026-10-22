/** Native deadline responsibilities are frozen with proposal acceptance and consumed without Agent inference. */
import { isDeepStrictEqual } from 'node:util'
import { simulationEventIdSchema, SimulationGovernanceError, SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationScheduledEvent, SimulationGovernanceProposal,
  WorldProposalId, SimulationOperationId } from '@clocky/clocky-simulation'
import { prepareGovernanceClose, foldWorldGovernance, governanceResolutionWakeRecords } from './world-governance.ts'
import { allocateEventKey, foldSchedulerRecord } from './scheduler.ts'
import type { SchedulerRecord } from './scheduler.ts'

/**
 * Derive the single original deadline identity, independent of a later decision or scheduler retry.
 * @param proposalId - Immutable Native proposal identity.
 * @returns its reserved scheduler identity.
 */
export function governanceDeadlineId(proposalId: WorldProposalId): SimulationScheduledEvent['id'] {
  return simulationEventIdSchema.parse(`simulation-governance-deadline:${proposalId}`)
}

/**
 * Retain all newly accepted proposals' exact deadlines in their acceptance append batch.
 * @param state - Projection after accepted requests and prior outbox scheduling.
 * @returns exact finite scheduler records; original identities are never queued twice.
 */
export function governanceDeadlineRecords(state: SimulationSnapshot): SchedulerRecord[] {
  const records: SchedulerRecord[] = []
  let projected = state
  for (const proposal of Object.values(state.world?.governance.proposals ?? {})) {
    const id = governanceDeadlineId(proposal.id)
    if (Object.hasOwn(projected.scheduledEvents, id)) continue
    const action = { kind: 'governance-deadline' as const, proposalId: proposal.id, bodyHash: proposal.bodyHash }
    const change: SchedulerRecord = { kind: 'event/queued', id, action, sourceOperationId: proposal.source.operationId,
      key: allocateEventKey(projected, proposal.deadline, action) }
    records.push(change)
    projected = { ...foldSchedulerRecord(projected, change, projected.revision + 1), revision: projected.revision + 1 }
  }
  return records
}

/**
 * Verify a queued responsibility against the actual proposal and accepted source, before scheduler effects.
 * @param state - Authoritative Native projection.
 * @param event - Proposed or retained original scheduler envelope.
 * @returns its frozen original proposal; forged time, body, source or identity rejects.
 */
export function assertGovernanceDeadlineSource(state: SimulationSnapshot,
  event: Pick<SimulationScheduledEvent, 'id' | 'action' | 'key'>
  & { readonly sourceOperationId?: SimulationOperationId | undefined }): SimulationGovernanceProposal {
  const proposal = event.action.kind === 'governance-deadline'
    ? state.world?.governance.proposals[event.action.proposalId] : undefined
  const operation = proposal === undefined ? undefined : state.operations[proposal.source.operationId]
  const request = Object.values(state.world?.requests ?? {}).find(value => value.operationId === operation?.id)
  if (proposal === undefined || event.action.kind !== 'governance-deadline' || operation === undefined
    || request?.source.kind !== 'decision' || request.source.decisionId !== proposal.source.decisionId || request.sequence !== proposal.sequence
    || state.decisions[operation.decisionId]?.status !== 'accepted'
    || event.id !== governanceDeadlineId(proposal.id) || event.key.time !== proposal.deadline
    || event.key.phase !== 'deadline' || event.action.bodyHash !== proposal.bodyHash
    || event.sourceOperationId !== proposal.source.operationId) {
    throw new SimulationGovernanceError('SIM_GOVERNANCE_INTEGRITY', 'Deadline lost its frozen proposal, body, time or accepted source')
  }
  return proposal
}

/**
 * Consume the exact due deadline and atomically derive its sole resolution plus canonical wake.
 * @param state - Scheduler projection at the original deadline, outside a decision window.
 * @param event - Exact just-consumed Native responsibility.
 * @returns complete resolution and wake projection at this same journal cursor; no model or provider IO occurs.
 */
export function consumeGovernanceDeadline(state: SimulationSnapshot, event: SimulationScheduledEvent): SimulationSnapshot {
  const proposal = assertGovernanceDeadlineSource(state, event), world = state.world
  if (world === undefined || state.time !== proposal.deadline || state.lastEventKey?.phase !== 'deadline'
    || state.scheduledEvents[event.id]?.status !== 'consumed' || state.activeWindowId !== undefined) {
    throw new SimulationGovernanceError('SIM_GOVERNANCE_TIME', 'Governance closure requires its actual settled deadline phase')
  }
  if (Object.values(world.governance.resolutions).some(value => value.proposalId === proposal.id)) {
    throw new SimulationGovernanceError('SIM_GOVERNANCE_INTEGRITY', 'An already resolved proposal cannot retain a live deadline')
  }
  const sequence = state.revision + 1
  const resolution = prepareGovernanceClose(state, world.governance, proposal.id, sequence)
  const change = { kind: 'world/governance-closed' as const, resolution }
  if (Buffer.byteLength(JSON.stringify(change), 'utf8') > world.definition.limits.maxBytesPerPlan) {
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Complete deadline resolution exceeds its retained plan allowance', 'bytes')
  }
  const governance = foldWorldGovernance(state, world.governance, change, sequence)
  let next: SimulationSnapshot = { ...state, world: { ...world, governance } }
  for (const wake of governanceResolutionWakeRecords(next, governance, resolution)) next = foldSchedulerRecord(next, wake, sequence)
  return next
}

/**
 * Cancel only a pending original deadline after its sole resolution has been retained.
 * @param state - Resolution-retaining Native projection in the same append batch.
 * @param proposalId - Exact resolved proposal identity.
 * @returns its cancellation record, or none after the original deadline was consumed/cancelled.
 */
export function governanceDeadlineCancellation(state: SimulationSnapshot, proposalId: WorldProposalId): SchedulerRecord[] {
  const id = governanceDeadlineId(proposalId), event = state.scheduledEvents[id]
  return event?.status === 'pending' ? [{ kind: 'event/cancelled', id, reason: 'Governance resolution retained' }] : []
}

/**
 * Verify every proposal retains its exact deadline and resolved deadlines cannot reopen on replay.
 * @param state - Complete Native append tail, never an intermediate acceptance record.
 * @returns normally only for complete original responsibility relationships.
 */
export function assertGovernanceDeadlineProjection(state: SimulationSnapshot): void {
  for (const proposal of Object.values(state.world?.governance.proposals ?? {})) {
    const event = state.scheduledEvents[governanceDeadlineId(proposal.id)]
    if (event === undefined) throw new SimulationGovernanceError('SIM_GOVERNANCE_INTEGRITY', 'Proposal omitted its original deadline')
    assertGovernanceDeadlineSource(state, event)
    const resolution = Object.values(state.world?.governance.resolutions ?? {}).find(value => value.proposalId === proposal.id)
    if (resolution === undefined ? event.status !== 'pending' : event.status === 'pending'
      || event.status === 'consumed' && event.settledAt !== resolution.sequence
      || event.status === 'cancelled' && (event.cancellation !== 'Governance resolution retained'
        || event.settledAt === undefined || event.settledAt < resolution.sequence)) {
      throw new SimulationGovernanceError('SIM_GOVERNANCE_INTEGRITY', 'Proposal deadline contradicts its sole resolution responsibility')
    }
  }
  for (const event of Object.values(state.scheduledEvents)) {
    if (event.action.kind === 'governance-deadline') assertGovernanceDeadlineSource(state, event)
    if (event.id.startsWith('simulation-governance-resolution:') && event.action.kind === 'wake') {
      const resolution = Object.values(state.world?.governance.resolutions ?? {}).find(value => event.id === value.wakeId)
      const proposal = resolution === undefined ? undefined : state.world?.governance.proposals[resolution.proposalId]
      if (resolution === undefined || proposal === undefined || event.key.time !== resolution.time
        || !isDeepStrictEqual(event.action, { kind: 'wake', entityId: proposal.proposer,
          reason: JSON.stringify({ kind: 'governance-resolution', proposalId: proposal.id,
            resolutionId: resolution.id, hash: resolution.hash }) })) {
        throw new SimulationGovernanceError('SIM_GOVERNANCE_INTEGRITY', 'Resolution wake lost its exact original resolution')
      }
    }
  }
}
