/** Bounded trusted report workflows reuse native windows, task attempts and recipient delivery. */
import { simulationDecisionIdSchema, simulationWindowIdSchema, simulationProposalSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot, SimulationContextRequest, SimulationEntityId, SimulationEventId } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { TeamTaskSnapshot } from '@clocky/clocky-team'
import type { SimulationCompanyDriveResult, SimulationCompanyDriverConfig } from './company-driver.ts'
import type { SimulationCompanyPreparation } from './company-preparation.ts'
import type { SimulationTaskScenario, SimulationTaskScenarioStep } from './task-scenario-config.ts'
import { taskScenarioPrefix } from './task-scenario-config.ts'
import { taskScenarioCognition, taskScenarioCompletion, taskScenarioInput, taskScenarioReportContinuation } from './task-scenario-policies.ts'
import { SimulationTaskExecutor, simulationTaskExecutorSchema } from './task-executor.ts'
import type { SimulationTaskExecutorOptions } from './task-executor.ts'

/** Serial helper owned and drained by the existing product scheduling driver. */
export class SimulationTaskScenarioDriver {
  private readonly executors = new Map<string, SimulationTaskExecutor>()

  /**
   * @param run - Exclusive prepared native run.
   * @param connection - Its canonical Team connection.
   * @param preparation - Immutable actor placement and checkpoint settings.
   * @param config - Trusted work bound and retained model route.
   * @param scenario - Versioned immutable report steps; no browser-supplied routes.
   * @param lifetime - Owner cancellation; admitted work is still drained before retirement.
   * @param readTask - Canonical Team reader used for exact attempt and review checks.
   */
  constructor(private readonly run: SimulationRun, private readonly connection: SimulationTeamConnection,
    private readonly preparation: SimulationCompanyPreparation, private readonly config: SimulationCompanyDriverConfig,
    private readonly scenario: SimulationTaskScenario, private readonly lifetime: AbortSignal,
    private readonly readTask: SimulationTaskExecutorOptions['readTask']) {}

  /**
   * Advance at most the configured number of control steps without changing durable management phase.
   * @returns current stop and committed revision/time; prepared retries preserve their original recorded context.
   */
  async advance(): Promise<SimulationCompanyDriveResult> {
    for (let round = 0; round < this.config.maxControlSteps; round++) {
      this.lifetime.throwIfAborted()
      let state = this.run.snapshot()
      if (state.phase !== 'running') return this.result(state.phase, round)
      const initial = state.checkpoints?.[this.preparation.checkpoint.id]
      if (initial?.status !== 'completed' || initial.manifest.implementationVersion !== 'company/1'
        || initial.manifest.team.owner.teamId !== state.teamReservation?.teamId) return this.result('recovery-required', round)
      if (state.activeWindowId !== undefined) {
        const window = state.windows?.[state.activeWindowId], slot = window?.request.decisions[0]
        const decision = slot === undefined ? undefined : state.decisions[slot.id]
        const taskOwner = slot === undefined ? undefined : state.taskDecisionOwners?.[slot.id]
        if (taskOwner !== undefined) {
          const execution = state.taskExecutions?.[taskOwner.attemptId]
          const operation = execution === undefined ? undefined : state.operations[execution.request.operationId]
          const step = this.scenario.steps.find((value, index) => operation?.decisionId.startsWith(taskScenarioPrefix(index))
            && operation.entityId === value.sourceEntityId && execution?.request.entityId === value.entityId)
          if (window?.request.decisions.length !== 1 || execution === undefined || step === undefined) {
            return this.result('recovery-required', round)
          }
          const advanced = await this.executor(step, execution.request.operationId).advance()
          if (advanced.reason === 'task-waiting') {
            const task = await this.readTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
            if (task.phase === 'review') return this.result('review-required', round + 1)
          }
          if (advanced.reason === 'idle' || advanced.reason === 'work-limit' || advanced.reason === 'task-waiting') continue
          return this.result(advanced.reason === 'task-blocked' ? 'scenario-blocked' : advanced.reason, round + 1, advanced.nextAttemptAt)
        }
        if (window?.request.decisions.length !== 1 || decision === undefined
          || !decision.id.startsWith('task-workflow/1/') || decision.context?.status !== 'prepared'
          || decision.deterministic?.policy.id !== taskScenarioCognition.id
          || decision.deterministic.policy.version !== taskScenarioCognition.version
          || decision.context.view.versions.persona !== 'task-workflow/1'
          || decision.context.view.versions.model !== `${this.config.model.provider}/${this.config.model.name}`) return this.result('recovery-required', round)
        if (decision.status !== 'accepted' && decision.status !== 'cancelled') {
          if (state.entities[decision.entityId]?.writer?.phase !== 'active'
            || state.entities[decision.entityId]?.writer?.epoch !== decision.epoch) return this.result('recovery-required', round)
          // Prepared retries read the original native view; executeDeterministicDecision ignores replacement context.
          await this.connection.executeDeterministicDecision(decision.entityId, decision.id,
            this.context(state, decision.entityId, null), taskScenarioCognition, decision.wakeId)
        }
        if (this.run.snapshot().phase === 'paused') return this.result('paused', round + 1)
        await this.run.commitWindow(window.id)
        continue
      }
      const driven = await this.connection.driveResident({ until: state.time }, Date.now, id => this.residency(id))
      if (!['until', 'decision-required'].includes(driven.reason)) return this.result(driven.reason, round + 1, driven.nextAttemptAt)
      state = this.run.snapshot()
      const wake = Object.values(state.wakes).find(value => value.status === 'pending')
      if (wake !== undefined) {
        const stop = await this.decision(wake.entityId, `task-workflow/1/input/${state.nextDecisionSlot}`, null, wake.eventId)
        if (stop !== undefined) return this.result(stop, round + 1)
        continue
      }
      let selected: { step: SimulationTaskScenarioStep; index: number; operationId?: import('@clocky/clocky-simulation').SimulationOperationId } | undefined
      for (const [index, step] of this.scenario.steps.entries()) {
        const creation = Object.values(state.decisions).find(value => value.id.startsWith(taskScenarioPrefix(index)) && value.status === 'accepted')
        if (creation === undefined) { selected = { step, index }; break }
        if (creation.operationIds.length !== 1) return this.result('scenario-blocked', round + 1)
        const operationId = creation.operationIds[0]
        const operation = operationId === undefined ? undefined : state.operations[operationId]
        if (operation?.action.kind !== 'task/create') return this.result('scenario-blocked', round + 1)
        if (operation.result !== undefined && operation.result.status !== 'applied') return this.result('scenario-blocked', round + 1)
        const receipt = operation.outbox?.taskReceipt
        if (receipt === undefined) return this.result('work-limit', round + 1)
        const task = await this.readTask({ teamId: receipt.teamId, taskId: receipt.taskId })
        this.lifetime.throwIfAborted()
        if (task.teamId !== receipt.teamId || task.id !== receipt.taskId) throw new Error('Task workflow reader returned another task')
        if (task.phase === 'completed' && Object.values(state.taskExecutions ?? {}).some(value =>
          value.request.operationId === operation.id && value.task?.phase === 'completed')) continue
        selected = { step, index, operationId: operation.id }; break
      }
      if (selected === undefined) {
        state = this.run.snapshot()
        const events = Object.values(state.scheduledEvents).filter(event => event.status === 'pending')
        if (!events.some(event => event.action.kind === 'ingress')) return this.result('completed', round + 1)
        const next = events.map(event => event.key.time)
          .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)[0]
        /* v8 ignore next -- the pending ingress above belongs to this same nonempty frozen event set. */
        if (next === undefined) throw new Error('Task workflow ingress lost its scheduled event')
        const future = await this.connection.driveResident({ until: next }, Date.now, id => this.residency(id))
        if (!['until', 'decision-required'].includes(future.reason)) return this.result(future.reason, round + 1, future.nextAttemptAt)
        continue
      }
      const { step, index, operationId } = selected
      if (operationId === undefined) {
        const reviewer = step.reviewerEntityId === undefined ? undefined : state.entities[step.reviewerEntityId]?.binding
        if (step.reviewerEntityId !== undefined && reviewer === undefined) return this.result('scenario-blocked', round + 1)
        const proposal = simulationProposalSchema.parse({ after: [], action: { kind: 'task/create', deliverAt: state.time,
          task: { subject: step.subject, description: step.description, blockedBy: [], requiredCapabilities: [],
            priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, maxAttempts: step.maxAttempts,
            reviewPolicy: reviewer === undefined ? { kind: 'none' } : { kind: 'participant', reviewerId: reviewer.participantId } } } })
        const stop = await this.decision(step.sourceEntityId, `${taskScenarioPrefix(index)}${state.nextDecisionSlot}`, proposal)
        if (stop !== undefined) return this.result(stop, round + 1)
        continue
      }
      const executor = this.executor(step, operationId)
      const result = await executor.advance()
      if (result.reason === 'idle') continue
      if (result.reason === 'task-waiting') {
        const receipt = this.run.snapshot().operations[operationId]?.outbox?.taskReceipt
        if (receipt === undefined) throw new Error('Task workflow lost its creation receipt')
        const task = await this.readTask({ teamId: receipt.teamId, taskId: receipt.taskId })
        if (task.phase === 'review') return this.result('review-required', round + 1)
        continue
      }
      return this.result(result.reason === 'task-blocked' ? 'scenario-blocked' : result.reason, round + 1, result.nextAttemptAt)
    }
    return this.result('work-limit', this.config.maxControlSteps)
  }

  /** Drain all accepted task batches before the caller releases its connection. */
  async drain(): Promise<void> { await Promise.all([...this.executors.values()].map(value => value.drain())) }

  private executor(step: SimulationTaskScenarioStep, operationId: import('@clocky/clocky-simulation').SimulationOperationId) {
    const existing = this.executors.get(step.id)
    if (existing !== undefined) return existing
    const executor = new SimulationTaskExecutor(this.run, this.connection, simulationTaskExecutorSchema.parse({ version: '1',
      maxControlSteps: 1, leaseDurationMs: step.leaseDurationMs, retry: step.retry,
      routes: [{ sourceEntityId: step.sourceEntityId, entityId: step.entityId, operationId,
        cognition: taskScenarioCognition, completion: taskScenarioCompletion, reason: step.description }] }), {
      readTask: this.readTask, lifetime: this.lifetime, residency: id => this.residency(id),
      reportContinuation: taskScenarioReportContinuation,
      context: (current, execution, task) => execution.request.reportContinuation === undefined
        ? this.reportContext(current, step, task) : this.context(current, step.entityId, null),
    })
    this.executors.set(step.id, executor)
    return executor
  }

  private result(reason: SimulationCompanyDriveResult['reason'], controlSteps: number, nextAttemptAt?: number): SimulationCompanyDriveResult {
    const state = this.run.snapshot()
    return { reason, controlSteps, revision: state.revision, time: state.time,
      ...nextAttemptAt === undefined ? {} : { nextAttemptAt } }
  }
  private residency(entityId: SimulationEntityId) {
    const entity = this.run.snapshot().entities[entityId]
    return { activation: { provider: this.preparation.participant.provider,
      seed: { kind: entity?.writer === undefined ? 'fresh' as const : 'resume' as const },
      agent: { preset: this.preparation.participant.preset,
        options: { provider: this.config.model.provider, model: this.config.model.name } },
      signal: this.lifetime }, evict: Object.keys(this.run.snapshot().entities) as SimulationEntityId[] }
  }
  private context(state: SimulationSnapshot, entityId: SimulationEntityId, proposal: Parameters<typeof taskScenarioInput>[0]):
  Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'> {
    return { personaVersion: 'task-workflow/1', modelVersion: `${this.config.model.provider}/${this.config.model.name}`,
      sources: [{ kind: 'run-event', runId: state.spec.runId, sequence: state.revision }], sections: [
        { kind: 'identity', required: true, blocks: [{ type: 'text', text: `You are ${entityId}.` }] },
        { kind: 'authority', required: true, blocks: [{ type: 'text', text: 'Use only Simulation observe, stage and submit.' }] },
        { kind: 'input', required: true, blocks: [{ type: 'text', text: taskScenarioInput(proposal) }] },
        { kind: 'goals', required: true, blocks: [{ type: 'text', text: proposal === null
          ? 'Acknowledge the selected notification with an empty proposal list.'
          : 'Submit only the supplied authorized proposal unchanged.' }] },
        { kind: 'commitments', required: true, blocks: [{ type: 'text', text: JSON.stringify(Object.values(state.commitments)
          .filter(value => value.debtor === entityId || value.creditor === entityId)) }] },
      ] }
  }
  private reportContext(state: SimulationSnapshot, step: SimulationTaskScenarioStep, task: TeamTaskSnapshot) {
    const channel = state.channelReservations?.[step.channelKey]
    if (channel?.confirmed !== true) throw new Error('Task workflow report channel is not prepared')
    const feedback = task.reviewHistory.at(-1)
    const text = step.text + (feedback?.nextPhase === 'pending' ? ` Review feedback: ${feedback.reason}` : '')
    return this.context(state, step.entityId, simulationProposalSchema.parse({ after: [], action: {
      kind: 'communication/post', recipient: step.recipientEntityId, channelId: channel.channelId, text, deliverAt: state.time,
    } }))
  }
  private async decision(entityId: SimulationEntityId, identity: string,
    proposal: Parameters<typeof taskScenarioInput>[0], wakeId?: SimulationEventId) {
    const resident = await this.connection.ensureResident(entityId, this.residency(entityId))
    this.lifetime.throwIfAborted()
    if (resident.status !== 'resident') return resident.status === 'capacity' ? 'resident-capacity' as const : 'recovery-required' as const
    const state = this.run.snapshot()
    if (state.phase !== 'running') return state.phase
    const id = simulationDecisionIdSchema.parse(identity), windowId = simulationWindowIdSchema.parse(identity)
    const context = this.context(state, entityId, proposal)
    await this.connection.openWindow({ id: windowId, decisions: [{ id, entityId, context, policy: taskScenarioCognition,
      ...wakeId === undefined ? {} : { wakeId } }] })
    try { await this.connection.executeDeterministicDecision(entityId, id, context, taskScenarioCognition, wakeId) }
    catch (cause: unknown) {
      const current = this.run.snapshot()
      if (this.lifetime.aborted || current.phase !== 'paused' || current.activeWindowId !== windowId) throw cause
      if (current.decisions[id]?.status === 'open') { await this.connection.cancelDecision(entityId, id); await this.run.commitWindow(windowId) }
      return 'paused' as const
    }
    if (this.run.snapshot().phase === 'paused') return 'paused' as const
    await this.run.commitWindow(windowId)
    return undefined
  }
}
