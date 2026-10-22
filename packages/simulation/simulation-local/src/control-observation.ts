import { observeSimulationRunControl } from '@clocky/clocky-simulation/run-control-observation'
/** Metadata projection scans owned relationships without cloning retained world or model bodies. */
import { budgetUsage, simulationTokenCount } from '@clocky/clocky-simulation'
import type { SimulationControlObservation, SimulationSnapshot } from '@clocky/clocky-simulation'

/**
 * Read a bounded control result at one synchronous owner revision.
 * @param state - Native-owned state, never returned or exposed to a consumer callback.
 * @param checkpointId - Optional exact preparation anchor to compare; no manifest bodies are copied.
 * @returns detached scalar metadata, at most 32 ingress targets, and current original recovery quotes.
 */
export function controlObservation(state: SimulationSnapshot, checkpointId?: string): SimulationControlObservation {
  let unconfirmedWorldExecutions = 0, activeDecisions = 0, checkpointInProgress = false, managementInProgress = false
  let maintenanceInProgress = false, unknownOperations = false, messageByteBlocked = false, decisionCount = 0, operationCount = 0
  let managementCount = 0
  let ingressCount = 0, targetCount = 0, hasWriter = false
  let tokenOverrun = false
  let recovery: SimulationControlObservation['token']['recovery']
  const targets: Array<SimulationControlObservation['targets'][number]> = []
  const executions = state.world?.executions
  if (executions !== undefined) for (const id in executions) {
    const value = executions[id as keyof typeof executions]
    if (value?.phase === 'armed' || value?.phase === 'outcome-unknown') unconfirmedWorldExecutions++
  }
  for (const id in state.decisions) {
    decisionCount++
    const value = state.decisions[id as keyof typeof state.decisions]
    if (value?.status === 'open' || value?.status === 'submitted') activeDecisions++
  }
  for (const id in state.operations) {
    operationCount++
    const value = state.operations[id as keyof typeof state.operations]
    unknownOperations ||= value?.status === 'outcome-unknown'
    messageByteBlocked ||= value?.result?.code === 'SIM_ENVELOPE_BYTE_LIMIT'
  }
  for (const id in state.checkpoints) checkpointInProgress ||= state.checkpoints[id as keyof typeof state.checkpoints]?.status === 'in-progress'
  for (const id in state.management) {
    managementCount++
    managementInProgress ||= state.management[id as keyof typeof state.management]?.status === 'in-progress'
  }
  for (const id in state.maintenance) maintenanceInProgress ||= state.maintenance[id as keyof typeof state.maintenance]?.status !== 'completed'
  for (const _id in state.ingresses) ingressCount++
  for (const id in state.entities) {
    const entity = state.entities[id as keyof typeof state.entities]
    if (entity === undefined) continue
    hasWriter ||= entity.writer !== undefined
    if (entity.phase !== 'active' || entity.cognition !== 'agent' || entity.readiness !== 'ready' || entity.kind === 'generation-assistant') continue
    targetCount++
    if (targets.length < 32) {
      const original = typeof entity.profile['name'] === 'string' ? entity.profile['name'] : entity.id
      let name = ''
      for (const char of original) { if (name.length + char.length > 256) break; name += char }
      targets.push({ id: entity.id, name, truncated: name.length < original.length })
    }
  }
  for (const id in state.tokenReservations) {
    const reservation = state.tokenReservations[id as keyof typeof state.tokenReservations]
    if (reservation?.overrunAcknowledged !== false) continue
    tokenOverrun = true
    const usage = reservation.usage ?? reservation.observedUsage
    if (usage === undefined) break
    const budget = budgetUsage(state, reservation.interval).tokens
    recovery = { request: { reservationId: reservation.id, reserved: reservation.reserved, used: simulationTokenCount(usage),
      interval: reservation.interval, additionalTokens: Math.max(0, budget.used - budget.limit) },
    complete: reservation.usage !== undefined, settled: reservation.status === 'settled' }
    break
  }
  const block = state.stall?.code === 'SIM_REQUEST_BUDGET_EXCEEDED' ? state.decisions[state.stall.decisionId] : undefined
  const submission = state.stall?.code === 'SIM_WORLD_SUBMISSION_BLOCKED' ? state.decisions[state.stall.decisionId]?.worldSubmissionBlock?.failure : undefined
  const selected = checkpointId === undefined ? undefined : state.checkpoints?.[checkpointId as keyof NonNullable<typeof state.checkpoints>]
  const latest = state.latestCheckpointId === undefined ? undefined : state.checkpoints?.[state.latestCheckpointId]
  const stalled = state.stall?.code === 'SIM_OUTBOX_OUTCOME_UNKNOWN' ? state.operations[state.stall.operationId] : undefined
  let retryAuthorized = false
  if (stalled?.status === 'pending') for (const id in stalled.outbox?.retryAuthorizations)
    retryAuthorized ||= stalled.outbox.retryAuthorizations[id as keyof NonNullable<typeof stalled.outbox>['retryAuthorizations']]?.budgetStart === stalled.outbox.budgetStart
  const budget = state.stall?.code === 'SIM_BUDGET_LIMIT' ? budgetUsage(state, state.stall.interval)[state.stall.budget] : undefined
  const activation = state.activationAdmissionBlocks
  return structuredClone({ runId: state.spec.runId, revision: state.revision, phase: state.phase, time: state.time, observedAt: Date.now(),
    budget: { tokensPerModelRequest: state.spec.tokensPerModelRequest, maxTokensPerInterval: state.spec.maxTokensPerInterval,
      budgetInterval: state.spec.budgetInterval, maxResidentActors: state.spec.maxResidentActors,
      maxConflictRetries: state.spec.maxConflictRetries },
    ...state.teamReservation === undefined ? {} : { teamId: state.teamReservation.teamId },
    unconfirmedWorldExecutions, activeDecisions, checkpointInProgress, managementCount, managementInProgress, maintenanceInProgress,
    unknownOperations, messageByteBlocked, retryAuthorized,
    budgetRecovered: state.stall?.code === 'SIM_BUDGET_LIMIT' && budget !== undefined && state.stall.requested <= budget.limit - budget.used,
    activationHistory: !activation?.length ? 'clear' : activation.some(value => state.entities[value.entityId]?.writer?.phase !== 'released')
      ? 'recovery-required' : 'blocked',
    unstarted: state.phase === 'paused' && state.time === '0' && decisionCount === 0 && operationCount === 0 && ingressCount === 0 && !hasWriter,
    ingressCount, targets, targetCount,
    tokenOverrun, token: { ...recovery === undefined ? {} : { recovery }, ...block?.requestBudgetBlock === undefined ? {} : {
      requestBudget: { ...block.requestBudgetBlock, decisionId: block.id } } },
    ...state.stall === undefined ? {} : { stall: state.stall },
    ...submission === undefined ? {} : { submissionFailure: submission },
    tokenStallAcknowledged: state.stall?.code === 'SIM_TOKEN_RESERVATION_EXCEEDED'
      && state.tokenReservations?.[state.stall.reservationId]?.overrunAcknowledged === true,
    ...selected === undefined ? {} : { selectedCheckpoint: { status: selected.status,
      ...selected.status !== 'completed' ? {} : { implementationVersion: selected.manifest.implementationVersion, teamId: selected.manifest.team.owner.teamId } } },
    ...latest?.status !== 'completed' ? {} : { latestCheckpoint: { id: latest.request.id, implementationVersion: latest.manifest.implementationVersion,
      publishedAt: latest.publishedAt, time: latest.manifest.state.time, revision: latest.manifest.run.cursor,
      references: { runs: 1, teams: 1, channels: latest.manifest.channels.length, sessions: latest.manifest.sessions.length } } },
    executionPins: state.world?.definition.operations ?? [],
    ...state.runControl === undefined ? {} : { stopTarget: observeSimulationRunControl(state.runControl.current) },
    checkpointCoverage: 'native',
    ...state.driverObservation === undefined ? {} : { driverObservation: state.driverObservation },
  } satisfies SimulationControlObservation)
}
