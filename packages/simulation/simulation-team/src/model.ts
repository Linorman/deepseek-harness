/** Identity-derived model access to one prepared decision. @module @clocky/clocky-simulation-team/model */
import { isDeepStrictEqual } from 'node:util'
import type { Agent } from '@clocky/clocky-agent'
import { validateSimulationCommunication, validateWorldHiringEnvelope, simulationContextConsumptionHash, assertSimulationStopTime } from '@clocky/clocky-simulation'
import type { SimulationDecisionId, SimulationProposal, SimulationRun, SimulationWriterLease } from '@clocky/clocky-simulation'
import { SimulationContextIntegrityError } from './integrity.ts'
import { preflightProposals } from './preflight.ts'
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
 * @param catalog - Pure exact-version payload catalog for World contexts.
 * @returns exact prepared-view observation, replaceable staging and durable proposal acceptance.
 */
export function modelAccess(
  agent: Agent, run: SimulationRun, writer: SimulationWriterLease, assertCurrent: () => void, settled: (id: SimulationDecisionId) => void,
  catalog?: Pick<import('@clocky/clocky-simulation').SimulationWorldDomainRegistry, 'payloadSchema'>,
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
      throw new SimulationContextIntegrityError('Simulation tool requires the current prepared decision input')
    }
    if (request.kind === 'submit' && request.notification !== undefined
      && (decision.context.world?.kind !== 'result' || decision.context.world.resultId !== request.notification.resultId))
      throw new Error('Notification must name the current frozen result')
    if ((decision.status === 'accepted' || decision.status === 'submitted' || decision.worldSubmissionBlock !== undefined)
      && request.kind === 'submit' && staged?.id === decision.id) {
      const accepted = await writer.submitDecision(decision.id, staged.proposals)
      settled(decision.id)
      return { status: accepted.status === 'submitted' ? 'submitted' : 'accepted', operationIds: [...accepted.operationIds], effects: 'pending' }
    }
    const prepared = await writer.readPreparedContext(decision.id)
    assertCurrent()
    signal.throwIfAborted()
    switch (request.kind) {
      case 'observe': {
        if (request.sections !== undefined) {
          if (request.detail !== undefined) throw new Error('Choose sections or detail: full, not both')
          if (request.sections.length === 0 || new Set(request.sections).size !== request.sections.length
            || request.sections.some(kind => !prepared.view.content.some(section => section.kind === kind)))
            throw new Error('Choose distinct section kinds present in the current frozen context')
          return { status: 'observed', time: prepared.view.time,
            sections: prepared.view.content.filter(section => request.sections?.includes(section.kind)),
            context: { inputId: prepared.view.inputId, hash: simulationContextConsumptionHash(prepared.view) } }
        }
        return run.snapshot().world?.definition.modelProtocol === 'bounded-v1' && request.detail !== 'full'
          ? { status: 'observed', time: prepared.view.time, sections: [],
            context: { inputId: prepared.view.inputId, hash: simulationContextConsumptionHash(prepared.view) } }
          : { status: 'observed', time: prepared.view.time, sections: prepared.view.content }
      }
      case 'stage': {
        if (request.proposals.length > run.snapshot().spec.maxOperationsPerDecision) throw new Error('Simulation proposal limit exceeded')
        const proposals = preflightProposals(request.proposals, prepared.world, catalog)
        for (const { action } of proposals) if (action.kind === 'communication/post')
          validateSimulationCommunication(run.snapshot(), writer.entityId, action)
        for (const { action } of proposals) if (action.kind === 'world/request' && action.domain === 'organization'
          && action.operation === 'generate-and-hire' && action.version === '1') validateWorldHiringEnvelope(action)
        const scope = prepared.world
        for (const { action } of proposals) {
          if ('deliverAt' in action) assertSimulationStopTime(run.snapshot(), action.deliverAt)
          if (action.kind === 'world/request') run.checkStopBoundary(action)
          if (action.kind === 'world/resolve' && (scope?.kind === 'resolve' || scope?.kind === 'scenario-resolve')) {
            const original = run.snapshot().world?.requests[scope.requestId]
            if (original !== undefined) run.checkStopBoundary(original.proposal, { requestId: original.id })
          }
        }
        if (scope?.kind === 'resolve' || scope?.kind === 'scenario-resolve') {
          for (const { action } of proposals) if (action.kind === 'world/resolve' && action.requestId !== scope.requestId) {
            throw new Error(`Use the current requestId ${scope.requestId}. Observe its current payload; do not reuse another request's resolution.`)
          }
        }
        staged = { id: decision.id, proposals }
        return { status: 'staged', count: proposals.length, effects: 'none' }
      }
      case 'submit': {
        if (request.notification !== undefined) {
          const scope = prepared.world
          if (scope?.kind !== 'result' || scope.resultId !== request.notification.resultId)
            throw new Error('Notification must name the current frozen result')
          const proposals: SimulationProposal[] = [{ after: [], action: scope.notification }]
          if (staged?.id === decision.id && staged.proposals.length > 0 && !isDeepStrictEqual(staged.proposals, proposals))
            throw new Error('Clear conflicting staged proposals before submitting the frozen result notification')
          staged = { id: decision.id, proposals }
        }
        if (staged?.id !== decision.id) throw new Error('Stage the complete proposal list before submitting')
        if (prepared.world !== undefined || staged.proposals.some(value => value.action.kind.startsWith('world/'))) {
          try { await writer.recordContextConsumption(decision.id) }
          catch (cause: unknown) {
            if (!signal.aborted && run.snapshot().phase === 'running' && run.snapshot().decisions[decision.id]?.status === 'open')
              throw new SimulationContextIntegrityError('Canonical context consumption failed', { cause })
            throw cause
          }
        }
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
    const work = pending.then(() => execute(request, signal)).catch(async (error: unknown) => {
      if (error instanceof SimulationContextIntegrityError && agent.status === 'running') {
        const decision = Object.values(run.snapshot().decisions).find(value => value.context?.status === 'prepared'
          && value.entityId === writer.entityId && value.epoch === writer.epoch && value.status === 'open')
        if (decision !== undefined) {
          try { await writer.failContextIntegrity(decision.id) }
          finally {
            settled(decision.id)
            agent.cancel({ kind: 'hook', reason: error.code }, { keepInbox: true })
          }
        }
      }
      throw error
    })
    pending = work.then(() => {}, () => {})
    return work
  }
}
/* v8 ignore next -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never { throw new Error(`Unknown Simulation model request: ${String(value)}`) }
