/** Identity-derived model access to one prepared decision. @module @clocky/clocky-simulation-team/model */
import { isDeepStrictEqual } from 'node:util'
import type { Agent } from '@clocky/clocky-agent'
import { simulationProposalSchema } from '@clocky/clocky-simulation'
import type { SimulationDecisionId, SimulationProposal, SimulationRun, SimulationWriterLease } from '@clocky/clocky-simulation'
import { decisionInput, inputState } from './input.ts'
import type { SimulationModelRequest, SimulationModelResult } from './types.ts'

/** The closed model capability set of the Simulation role. */
export const SIMULATION_MODEL_TOOLS = ['simulation_observe', 'simulation_stage', 'simulation_submit'] as const

/**
 * Bind a model operation handler to one controller-owned Agent and writer epoch.
 * @param agent - Canonical local Agent.
 * @param run - Exclusive durable run.
 * @param writer - Current writer admission owner.
 * @param assertCurrent - Reject detached or retired Agents.
 * @param settled - Retire infrastructure timing after durable proposal completion.
 * @returns exact prepared-view observation, replaceable staging and durable proposal acceptance.
 */
export function modelAccess(
  agent: Agent, run: SimulationRun, writer: SimulationWriterLease, assertCurrent: () => void, settled: (id: SimulationDecisionId) => void,
): (request: SimulationModelRequest, signal: AbortSignal) => Promise<SimulationModelResult> {
  let staged: { id: SimulationDecisionId; proposals: SimulationProposal[] } | undefined
  const execute = async (request: SimulationModelRequest, signal: AbortSignal): Promise<SimulationModelResult> => {
    assertCurrent()
    signal.throwIfAborted()
    const view = agent.session.events.findLast(event => event.type === 'simulation/context-view')
    const decision = view?.type !== 'simulation/context-view' ? undefined : Object.values(run.snapshot().decisions)
      .find(value => value.context?.status === 'prepared' && value.context.view.inputId === view.data.inputId)
    if (decision?.context?.status !== 'prepared' || view?.type !== 'simulation/context-view'
      || decision.entityId !== writer.entityId || decision.epoch !== writer.epoch
      || !isDeepStrictEqual(decision.context.view, view.data) || inputState(agent, decisionInput(view.data)) !== 'consumed') {
      throw new Error('Simulation tool requires the current prepared decision input')
    }
    if ((decision.status === 'accepted' || decision.status === 'submitted') && request.kind === 'submit' && staged?.id === decision.id) {
      const accepted = await writer.submitDecision(decision.id, staged.proposals)
      settled(decision.id)
      return { status: accepted.status === 'submitted' ? 'submitted' : 'accepted', operationIds: [...accepted.operationIds], effects: 'pending' }
    }
    const prepared = await writer.readPreparedContext(decision.id)
    assertCurrent()
    signal.throwIfAborted()
    switch (request.kind) {
      case 'observe': return { status: 'observed', time: prepared.view.time, sections: prepared.view.content }
      case 'stage': {
        if (request.proposals.length > run.snapshot().spec.maxOperationsPerDecision) throw new Error('Simulation proposal limit exceeded')
        const proposals = request.proposals.map(value => simulationProposalSchema.parse(value))
        staged = { id: decision.id, proposals }
        return { status: 'staged', count: proposals.length, effects: 'none' }
      }
      case 'submit': {
        if (staged?.id !== decision.id) throw new Error('Stage the complete proposal list before submitting')
        const accepted = await writer.submitDecision(decision.id, staged.proposals)
        settled(decision.id)
        if (accepted.status === 'cancelled') throw new Error('Simulation decision deadline exceeded before submission')
        return { status: accepted.status === 'submitted' ? 'submitted' : 'accepted', operationIds: [...accepted.operationIds], effects: 'pending' }
      }
      /* v8 ignore next -- tool JSON is validated before this closed service request union. */
      default: return assertNever(request)
    }
  }
  let pending = Promise.resolve()
  return (request, signal) => {
    const work = pending.then(() => execute(request, signal))
    pending = work.then(() => {}, () => {})
    return work
  }
}
/* v8 ignore next -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never { throw new Error(`Unknown Simulation model request: ${String(value)}`) }
