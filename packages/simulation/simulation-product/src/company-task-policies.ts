/** Version 1 company task cognition and completion over the recorded authorized inventory view. */
import { z } from 'zod'
import { simulationPolicyRefSchema, simulationProposalSchema, simulationCommitmentIdSchema,
  simulationResourceIdSchema, simulationInteractionIdSchema, simulationOperationIdSchema } from '@clocky/clocky-simulation'
import { simTimeSchema } from '@clocky/clocky-simulation'
import { channelIdSchema } from '@clocky/clocky-team'
import type { SimulationSnapshot, SimulationTaskExecution, SimulationTaskCompletionAssessment,
  SimulationOperation, SimulationOperationId } from '@clocky/clocky-simulation'
import type { SimulationTeams } from '@clocky/clocky-simulation-team'

/** Fixed generation of the pure inventory-transfer scene policy. */
export const companyTaskCognition = simulationPolicyRefSchema.parse({ id: 'company/1/task-transfer', version: '1' })
/** Fixed generation of the company task's applied-transfer completion rule. */
export const companyTaskCompletion = simulationPolicyRefSchema.parse({ id: 'company/1/task-completion', version: '1' })
/** Reviewed delivery separates the original transfer from each attempt's persisted report. */
export const companyTaskReviewedCompletion = simulationPolicyRefSchema.parse({ id: 'company/1/task-reviewed-completion', version: '1' })
const prefix = 'Task inventory: '
const inventorySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('transfer'), commitmentId: simulationCommitmentIdSchema,
    reads: z.array(z.strictObject({ resourceId: simulationResourceIdSchema, revision: z.number().int().positive() })).length(2) }),
  z.strictObject({ kind: z.literal('confirm'), interactionId: simulationInteractionIdSchema,
    expectedRevision: z.number().int().positive(), evidence: simulationOperationIdSchema }),
  z.strictObject({ kind: z.literal('report'), channelId: channelIdSchema, text: z.string().min(1), deliverAt: simTimeSchema }),
])

/**
 * Register the company's versioned scene policies under the calling plugin's effect lifetime.
 * @param teams - Canonical cognition/completion registry; neither policy performs IO or obtains execution authority.
 * @returns disposer for both registrations; partial registration failure removes the first policy.
 */
export function registerCompanyTaskPolicies(teams: Pick<SimulationTeams, 'registerDeterministicPolicy' | 'registerTaskCompletionPolicy'>): () => void {
  const removeCognition = teams.registerDeterministicPolicy({ ...companyTaskCognition, decide(view) {
    const blocks = view.content.filter(section => section.kind === 'input').flatMap(section => section.blocks)
    const block = blocks.find(value => value.type === 'text' && value.text.startsWith(prefix))
    if (block?.type !== 'text') throw new Error('Company task has no recorded authorized inventory view')
    const selected = inventorySchema.parse(JSON.parse(block.text.slice(prefix.length)))
    if (selected.kind === 'confirm') return []
    if (selected.kind === 'report') return [simulationProposalSchema.parse({ after: [], action: {
      kind: 'communication/post', recipient: 'buyer', channelId: selected.channelId, text: selected.text, deliverAt: selected.deliverAt,
    } })]
    if (new Set(selected.reads.map(value => value.resourceId)).size !== 2
      || !selected.reads.some(value => value.resourceId === 'stock') || !selected.reads.some(value => value.resourceId === 'received')) {
      throw new Error('Company task inventory view has different transfer accounts')
    }
    return [simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
      commitmentId: selected.commitmentId, reads: selected.reads, transfers: [{ from: 'stock', to: 'received', quantity: '1' }],
    } } })]
  } })
  try {
    const removeCompletion = teams.registerTaskCompletionPolicy({ ...companyTaskCompletion, evaluate: assess })
    let removeReviewed: (() => void) | undefined
    try { removeReviewed = teams.registerTaskCompletionPolicy({ ...companyTaskReviewedCompletion, evaluate: assessReviewed }) }
    catch (cause: unknown) { removeCompletion(); throw cause }
    return () => { removeReviewed(); removeCompletion(); removeCognition() }
  } catch (cause: unknown) { removeCognition(); throw cause }
}

/** Each attempt completes only from its own delivered report; the original inventory effect remains single. */
function assessReviewed(state: SimulationSnapshot, execution: SimulationTaskExecution): SimulationTaskCompletionAssessment {
  const attempts = Object.values(state.taskExecutions ?? {}).filter(value => value.request.operationId === execution.request.operationId)
  const operations = taskOperations(state, attempts)
  const transfer = companyTaskTransfer(state, execution.request.operationId)
  if (operations.some(value => value?.result !== undefined && value.result.status !== 'applied')
    || operations.some(value => value?.result?.status === 'applied'
      && (value.action.kind === 'resource/transfer' && value.id !== transfer?.id
        || value.action.kind !== 'resource/transfer' && value.action.kind !== 'communication/post'))) {
    return { status: 'result', operations: [], outcome: { kind: 'failed', failure: {
      code: 'COMPANY_REVIEW_EFFECT_REJECTED', message: 'The reviewed company task produced unsupported or rejected effects',
    } } }
  }
  if (transfer === undefined) return { status: 'waiting', reason: 'The original inventory transfer has not been applied' }
  for (const association of execution.decisions ?? []) {
    const decision = state.decisions[association.request.decisionId]
    if (decision?.status !== 'accepted' || decision.context?.status !== 'prepared') continue
    const block = decision.context.view.content.filter(section => section.kind === 'input').flatMap(section => section.blocks)
      .find(value => value.type === 'text' && value.text.startsWith(prefix))
    if (block?.type !== 'text') continue
    const selected = inventorySchema.parse(JSON.parse(block.text.slice(prefix.length)))
    if (selected.kind !== 'report') continue
    const report = decision.operationIds.map(id => state.operations[id]).find(value => value?.action.kind === 'communication/post'
      && value.entityId === execution.request.entityId && value.action.recipient === 'buyer'
      && value.action.channelId === selected.channelId && value.action.text === selected.text
      && value.result?.status === 'applied' && value.delivery?.receipt !== undefined)
    if (report !== undefined) return { status: 'result', operations: [report.id], outcome: {
      kind: 'completed', result: { summary: 'Delivered the inventory report for review' },
    } }
  }
  return { status: 'waiting', reason: 'The current attempt inventory report has not been persisted by its recipient' }
}

/** Only the original attempt's applied, exact one-unit purchase transfer completes the task. */
function assess(state: SimulationSnapshot, execution: SimulationTaskExecution): SimulationTaskCompletionAssessment {
  const purchase = Object.values(state.interactions).find(value => value.id === 'purchase')
  const operations = execution.decisions?.flatMap(value => state.decisions[value.request.decisionId]?.operationIds ?? [])
    .map(id => state.operations[id]) ?? []
  const transfer = operations.find(value => value?.entityId === execution.request.entityId
    && value.action.kind === 'resource/transfer' && value.result?.status === 'applied'
    && value.action.transaction.commitmentId === purchase?.commitmentId
    && value.action.transaction.transfers.length === 1 && value.action.transaction.transfers[0]?.from === 'stock'
    && value.action.transaction.transfers[0].to === 'received' && value.action.transaction.transfers[0].quantity === '1')
  if (purchase?.assignee === execution.request.entityId && transfer !== undefined) {
    return { status: 'result', operations: [transfer.id], outcome: { kind: 'completed', result: { summary: 'Delivered one inventory unit' } } }
  }
  const retained = companyTaskTransfer(state, execution.request.operationId)
  const acknowledged = execution.request.interaction?.execution === 'continuation'
    && execution.decisions?.some(value => value.input !== undefined && state.decisions[value.request.decisionId]?.status === 'accepted')
  if (purchase?.assignee === execution.request.entityId && retained !== undefined && acknowledged) {
    return { status: 'result', operations: [retained.id], outcome: {
      kind: 'completed', result: { summary: 'Confirmed the original delivered inventory unit' },
    } }
  }
  if (operations.some(value => value?.result !== undefined && value.result.status !== 'applied')) {
    return { status: 'result', operations: [], outcome: { kind: 'failed', failure: {
      code: 'COMPANY_TASK_EFFECT_REJECTED', message: 'The company task world operation was rejected',
    } } }
  }
  return { status: 'waiting', reason: 'The original company task inventory transfer has not been applied' }
}

/**
 * Resolve the single evidenced inventory transfer from the original task's accepted attempt history.
 * @param state - Committed detached run projection.
 * @param operationId - Canonical task creation whose attempts own the evidence.
 * @returns original applied transfer; absence or multiple transfers cannot authorize a confirmation.
 */
export function companyTaskTransfer(state: SimulationSnapshot, operationId: SimulationOperationId): SimulationOperation | undefined {
  const purchase = Object.values(state.interactions).find(value => value.id === 'purchase')
  if (purchase === undefined) return undefined
  const attempts = Object.values(state.taskExecutions ?? {}).filter(value => value.request.operationId === operationId)
  const transfers = taskOperations(state, attempts)
    .filter(value => value?.action.kind === 'resource/transfer' && value.entityId === purchase.assignee
      && value.result?.status === 'applied' && value.action.transaction.commitmentId === purchase.commitmentId
      && value.action.transaction.transfers.length === 1 && value.action.transaction.transfers[0]?.from === 'stock'
      && value.action.transaction.transfers[0].to === 'received' && value.action.transaction.transfers[0].quantity === '1')
  return transfers.length === 1 ? transfers[0] : undefined
}

/**
 * Select recovery from already retired task attempts without repeating their accepted inventory effects.
 * @param state - Frozen current run projection after due original effects have been driven.
 * @param attempts - Original task's retained attempts, including physical retirement evidence.
 * @returns retry before effects, or confirm one applied transfer; pending/unsupported effects stay waiting/blocked.
 */
export function recoverCompanyTask(state: SimulationSnapshot, attempts: readonly SimulationTaskExecution[]): 'retry' | 'waiting' | 'blocked' {
  const operations = taskOperations(state, attempts)
  if (operations.length === 0) return 'retry'
  if (operations.some(value => value === undefined)) return 'blocked'
  if (operations.some(value => value?.result === undefined)) return 'waiting'
  const original = attempts.find(value => value.decisions?.some(decision =>
    state.decisions[decision.request.decisionId]?.operationIds.length))
  /* v8 ignore next -- nonempty taskOperations above requires an owning attempt with accepted operations. */
  if (original === undefined) throw new Error('Company task recovery lost its accepted operation owner')
  const transfer = companyTaskTransfer(state, original.request.operationId)
  if (transfer === undefined) return 'blocked'
  const purchase = Object.values(state.interactions).find(value => value.id === 'purchase')
  return operations.every(value => value?.id === transfer.id) && purchase?.assignee === original.request.entityId ? 'retry' : 'blocked'
}

/** Attempt-owned accepted operations keep their original identities across writer replacement. */
function taskOperations(state: SimulationSnapshot, attempts: readonly SimulationTaskExecution[]): (SimulationOperation | undefined)[] {
  return attempts.flatMap(value => value.decisions ?? []).flatMap(value => state.decisions[value.request.decisionId]?.operationIds ?? [])
    .map(id => state.operations[id])
}
