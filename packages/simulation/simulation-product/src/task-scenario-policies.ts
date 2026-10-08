/** Pure report policies consume recorded authorized input and never acquire IO authority. */
import { z } from 'zod'
import { simulationProposalSchema, simulationPolicyRefSchema, taskReportContinuationEvidence } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationTaskExecution, SimulationDeterministicPolicy, SimulationOperation } from '@clocky/clocky-simulation'
import type { SimulationTeams } from '@clocky/clocky-simulation-team'

/** Versioned deterministic creation and report policy. */
export const taskScenarioCognition = simulationPolicyRefSchema.parse({ id: 'task-workflow/report', version: '1' })
/** Exact one-operation persisted-report completion generation. */
export const taskScenarioCompletion = simulationPolicyRefSchema.parse({ id: 'task-workflow/report-completion', version: '1' })
const prefix = 'Authorized task workflow: '
const inputSchema = z.strictObject({ proposal: simulationProposalSchema.nullable() })

/**
 * Encode the scene's single permitted proposal into the durable decision input.
 * @param proposal - Trusted task creation/report proposal, or null for notification acknowledgement.
 * @returns JSON material consumed only from the recorded authorized input section.
 */
export function taskScenarioInput(proposal: z.infer<typeof simulationProposalSchema> | null): string {
  return prefix + JSON.stringify(inputSchema.parse({ proposal }))
}

function proposal(view: Parameters<SimulationDeterministicPolicy['decide']>[0]): z.infer<typeof simulationProposalSchema> | null {
  const block = view.content.filter(section => section.kind === 'input').flatMap(section => section.blocks)
    .find(value => value.type === 'text' && value.text.startsWith(prefix))
  if (block?.type !== 'text') throw new Error('Task workflow has no recorded authorized input')
  const selected = inputSchema.parse(JSON.parse(block.text.slice(prefix.length))).proposal
  if (selected !== null && selected.action.kind !== 'task/create' && selected.action.kind !== 'communication/post') {
    throw new Error('Task workflow input contains an unsupported effect')
  }
  return selected
}

/**
 * Install pure task workflow cognition/completion until the registration owner retires.
 * @param teams - Native policy registry; neither callback publishes to Team or invokes tools.
 * @returns disposer removing both policies; partial failure removes cognition.
 */
export function registerTaskScenarioPolicies(teams: Pick<SimulationTeams, 'registerDeterministicPolicy' | 'registerTaskCompletionPolicy'>): () => void {
  const remove = teams.registerDeterministicPolicy({ ...taskScenarioCognition, decide(view) {
    const selected = proposal(view)
    return selected === null ? [] : [selected]
  } })
  try {
    const complete = teams.registerTaskCompletionPolicy({ ...taskScenarioCompletion, evaluate(state, execution) {
      const operation = taskScenarioReport(state, execution)
      if (operation !== undefined) return { status: 'result', operations: [operation.id], outcome: {
        kind: 'completed', result: { summary: 'Persisted the authorized task report' },
      } }
      const effects = execution.decisions?.flatMap(value => state.decisions[value.request.decisionId]?.operationIds ?? []) ?? []
      if (effects.some(id => state.operations[id]?.result !== undefined && state.operations[id].result.status !== 'applied'
        || state.operations[id]?.action.kind !== 'communication/post')) {
        return { status: 'result', operations: [], outcome: { kind: 'failed', failure: {
          code: 'TASK_WORKFLOW_REPORT_REJECTED', message: 'The authorized report produced an unsupported or rejected effect',
        } } }
      }
      return { status: 'waiting', reason: 'The exact task report has not been persisted by its recipient' }
    } })
    return () => { complete(); remove() }
  } catch (cause: unknown) { remove(); throw cause }
}

/**
 * Select only this attempt's exact authorized report and both canonical delivery receipts.
 * @param state - Committed run projection containing actor bindings and accepted effects.
 * @param execution - Native task attempt whose recorded context selects the report.
 * @returns persisted exact report, or undefined for incomplete, changed or unsupported evidence.
 */
export function taskScenarioReport(state: SimulationSnapshot, execution: SimulationTaskExecution): SimulationOperation | undefined {
  if (execution.request.reportContinuation !== undefined) return taskReportContinuationEvidence(state, execution.request)
  const decisions = execution.decisions ?? []
  const association = decisions[0]
  if (decisions.length !== 1 || association === undefined) return undefined
  const decision = state.decisions[association.request.decisionId]
  if (decision?.status !== 'accepted' || decision.context?.status !== 'prepared' || decision.operationIds.length !== 1) return undefined
  const selected = proposal(decision.context.view)
  if (selected?.action.kind !== 'communication/post') return undefined
  const operationId = decision.operationIds[0]
  /* v8 ignore next -- the accepted decision above has exactly one native operation identity. */
  if (operationId === undefined) return undefined
  const report = state.operations[operationId]
  const recipient = state.entities[selected.action.recipient]?.binding
  const receipt = report?.outbox?.receipt, delivered = report?.delivery?.receipt
  if (report?.action.kind !== 'communication/post' || report.entityId !== execution.request.entityId
    || report.decisionId !== decision.id || report.result?.status !== 'applied'
    || report.action.recipient !== selected.action.recipient || report.action.channelId !== selected.action.channelId
    || report.action.text !== selected.action.text || report.action.deliverAt !== selected.action.deliverAt
    || recipient?.teamId !== execution.request.teamId || receipt?.runId !== state.spec.runId
    || receipt.operationId !== report.id || receipt.teamId !== execution.request.teamId
    || receipt.channelId !== selected.action.channelId || receipt.recipientId !== recipient.participantId
    || delivered?.participantId !== recipient.participantId || delivered.envelopeId !== receipt.envelopeId
    || report.delivery?.sessionId !== recipient.sessionId || report.deliveryFailure !== undefined) return undefined
  return report
}

/**
 * Select a physically retired attempt's original delivered report without repeating its business proposal.
 * @param state - Authoritative current report/receipt projection.
 * @param execution - Latest retired responsibility for this exact task.
 * @returns original source selector, including when an interrupted acknowledgement already retained it.
 */
export function taskScenarioReportContinuation(state: SimulationSnapshot, execution: SimulationTaskExecution):
import('@clocky/clocky-simulation').SimulationTaskReportContinuation | undefined {
  const report = taskScenarioReport(state, execution)
  if (execution.retired === undefined || report === undefined) return undefined
  if (execution.request.reportContinuation !== undefined) return execution.request.reportContinuation
  const context = state.decisions[report.decisionId]?.context
  /* v8 ignore next -- taskScenarioReport selected this exact report from an accepted prepared decision in the same snapshot. */
  if (context?.status !== 'prepared') return undefined
  return { attemptId: execution.request.attemptId,
    operationId: report.id, contextFingerprint: context.fingerprint }
}
