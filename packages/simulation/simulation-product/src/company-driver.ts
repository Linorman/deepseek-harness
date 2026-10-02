/** Bounded version 1 procurement driver over canonical actors and retained decision windows. */
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { simulationDecisionIdSchema, simulationEntityIdSchema, simulationWindowIdSchema, simulationChannelKeySchema,
  simulationInteractionIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot, SimulationDecision, SimulationContextRequest, SimulationEntityId,
  SimulationEventId, SimulationOperation, SimulationDecisionId, SimulationWindowId, SimulationWindow } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection, SimulationTeamDriveResult } from '@clocky/clocky-simulation-team'
import type { SimulationCompanyPreparation } from './company-preparation.ts'
import { SimulationTaskExecutor, simulationTaskExecutorSchema } from './task-executor.ts'
import type { SimulationTaskExecutorOptions } from './task-executor.ts'
import { companyTaskCognition, companyTaskCompletion, companyTaskReviewedCompletion, companyTaskTransfer, recoverCompanyTask } from './company-task-policies.ts'
import type { TeamTaskSnapshot } from '@clocky/clocky-team'
import { simulationTaskScenarioSchema } from './task-scenario-config.ts'
import { SimulationTaskScenarioDriver } from './task-scenario-driver.ts'

/** Deployment work bound, route and simulated delivery/deadline policy; no secrets or executable code. */
export const simulationCompanyDriverSchema = z.strictObject({ version: z.literal('1'), maxControlSteps: z.number().int().positive(),
  model: z.strictObject({ provider: z.string().trim().min(1), name: z.string().trim().min(1) }),
  requestDelay: simTimeSchema, reportDelay: simTimeSchema, replyDelay: simTimeSchema, completeDelay: simTimeSchema,
  tasks: z.strictObject({ version: z.literal('1'), cognition: z.enum(['model', 'deterministic']),
    leaseDurationMs: z.number().int().positive(), maxAttempts: z.number().int().positive(),
    retry: z.enum(['never', 'before-effects', 'scene']),
    review: z.enum(['none', 'buyer']).optional(),
  }).optional(),
  scenario: simulationTaskScenarioSchema.optional(),
}).refine(value => BigInt(value.replyDelay) > BigInt(value.requestDelay) && BigInt(value.completeDelay) > BigInt(value.replyDelay),
  'Company deadlines must follow request delivery in order')
  .refine(value => value.tasks === undefined || value.scenario === undefined, 'Select either company tasks or a task workflow')
/** Immutable settings selected by a trusted installed scenario. */
export type SimulationCompanyDriverConfig = z.infer<typeof simulationCompanyDriverSchema>
/** Finite procurement steps; each step must establish its evidenced effect before the next one. */
export type SimulationCompanyStage = 'request' | 'accept' | 'transfer' | 'task' | 'result' | 'report' | 'input'
/** Exact bounded stop, independent of durable scheduling phase or model permit occupancy. */
export interface SimulationCompanyDriveResult {
  readonly reason: SimulationTeamDriveResult['reason'] | 'completed' | 'scenario-blocked' | 'recovery-required' | 'review-required'
  readonly controlSteps: number
  readonly revision: number
  readonly time: import('@clocky/clocky-simulation').SimTime
  readonly stage?: SimulationCompanyStage
  readonly entityId?: SimulationEntityId
  readonly operationId?: import('@clocky/clocky-simulation').SimulationOperationId
  readonly nextAttemptAt?: number
  readonly decisionId?: SimulationDecisionId
  readonly interruption?: 'cancelled-before-submission'
}
const buyer = simulationEntityIdSchema.parse('buyer')
const supplier = simulationEntityIdSchema.parse('supplier')
const channelKey = simulationChannelKeySchema.parse('purchase')
const stages: readonly SimulationCompanyStage[] = ['request', 'accept', 'transfer', 'result', 'report']
const taskStages: readonly SimulationCompanyStage[] = ['request', 'accept', 'task', 'result', 'report']
const driverStages: readonly SimulationCompanyStage[] = [...stages, 'task', 'input']
const prefix = (stage: SimulationCompanyStage) => `company/1/${stage}/`
interface Selection { stage: SimulationCompanyStage; entityId: SimulationEntityId; wakeId?: SimulationEventId }

/**
 * One serial pump bound to a caller-owned run and canonical connection. It never opens/restores a run or changes phase.
 * The caller stops admission, drains advance(), and closes its connection/run on retirement; HTTP cancellation is separate.
 */
export class SimulationCompanyDriver {
  private readonly config: SimulationCompanyDriverConfig
  private readonly lifetime: AbortSignal
  private pending: Promise<SimulationCompanyDriveResult> | undefined
  private taskExecutor: SimulationTaskExecutor | undefined
  private scenarioDriver: SimulationTaskScenarioDriver | undefined

  /**
   * @param run - Exclusive run already prepared or restored by its owner.
   * @param connection - The same run's canonical Team connection.
   * @param preparation - Retained immutable company topology and initial checkpoint identity.
   * @param request - Trusted validated version, work and route policy.
   * @param lifetime - Owner lifetime; retirement stops new control work but still requires draining admitted work.
   * @param taskOptions - Canonical task reader required by task-enabled scenarios; policies are installed by the scene owner.
   */
  constructor(private readonly run: SimulationRun, private readonly connection: SimulationTeamConnection,
    private readonly preparation: SimulationCompanyPreparation, request: SimulationCompanyDriverConfig, lifetime: AbortSignal,
    private readonly taskOptions?: Pick<SimulationTaskExecutorOptions, 'readTask'>) {
    this.config = simulationCompanyDriverSchema.parse(request)
    this.lifetime = lifetime
    if ((this.config.tasks !== undefined || this.config.scenario !== undefined) && taskOptions === undefined) throw new Error('Company task execution requires its canonical task reader')
    if ((this.config.tasks?.review === 'buyer' || this.config.scenario !== undefined) && run.snapshot().spec.maxResidentActors < 2) {
      throw new Error('Reviewed company tasks require two resident actors for report persistence')
    }
    if (preparation.participant.model !== `${this.config.model.provider}/${this.config.model.name}`) {
      throw new Error('Company model route differs from its retained participant configuration')
    }
    if (!isDeepStrictEqual(preparation.topology, this.config.scenario?.topology)) {
      throw new Error('Workflow topology differs from its retained preparation')
    }
    if (run.snapshot().spec.rulesVersion !== '1' || run.snapshot().spec.policyVersion !== '1') {
      throw new Error('Company driver does not support the retained rules or policy version')
    }
  }

  /**
   * Advance one finite control batch through real residency, windows, inference and native effect/delivery owners.
   * @returns shared current batch or its exact stop; paused/missing initial checkpoint never activates or infers.
   * Prepared current-epoch decisions retry their recorded input; retired epochs require explicit recovery.
   */
  advance(): Promise<SimulationCompanyDriveResult> {
    if (this.pending !== undefined) return this.pending
    if (this.config.scenario !== undefined) {
      if (this.taskOptions === undefined) throw new Error('Task workflow requires its canonical task reader')
      this.scenarioDriver ??= new SimulationTaskScenarioDriver(this.run, this.connection, this.preparation,
        this.config, this.config.scenario, this.lifetime, this.taskOptions.readTask)
    }
    const work = (this.scenarioDriver?.advance() ?? this.pump()).finally(() => { this.pending = undefined })
    this.pending = work
    return work
  }

  /** Await the currently admitted batch; cancellation never reports early quiescence. */
  async drain(): Promise<void> {
    await Promise.allSettled(this.pending === undefined ? [] : [this.pending])
    await this.taskExecutor?.drain()
    await this.scenarioDriver?.drain()
  }

  private result(reason: SimulationCompanyDriveResult['reason'], controlSteps: number,
    facts: Omit<Partial<SimulationCompanyDriveResult>, 'reason' | 'controlSteps' | 'revision' | 'time'> = {}): SimulationCompanyDriveResult {
    const state = this.run.snapshot()
    return { reason, controlSteps, revision: state.revision, time: state.time,
      ...facts.stage === undefined ? {} : { stage: facts.stage },
      ...facts.entityId === undefined ? {} : { entityId: facts.entityId },
      ...facts.operationId === undefined ? {} : { operationId: facts.operationId },
      ...facts.nextAttemptAt === undefined ? {} : { nextAttemptAt: facts.nextAttemptAt },
      ...facts.decisionId === undefined ? {} : { decisionId: facts.decisionId },
      ...facts.interruption === undefined ? {} : { interruption: facts.interruption } }
  }
  private async pump(): Promise<SimulationCompanyDriveResult> {
    for (let step = 0; step < this.config.maxControlSteps; step++) {
      this.lifetime.throwIfAborted()
      let state = this.run.snapshot()
      if (state.phase !== 'running') return this.result(state.phase, step)
      const checkpoint = state.checkpoints?.[this.preparation.checkpoint.id]
      if (checkpoint?.status !== 'completed' || checkpoint.manifest.implementationVersion !== 'company/1'
        || checkpoint.manifest.team.owner.teamId !== state.teamReservation?.teamId) return this.result('recovery-required', step)
      if (state.activeWindowId !== undefined) {
        // Native journal folding verifies the active window and every retained decision referent.
        const window = state.windows?.[state.activeWindowId] as SimulationWindow
        const slot = window.request.decisions[0] as SimulationWindow['request']['decisions'][number]
        const decision = state.decisions[slot.id] as SimulationDecision
        const stage = driverStages.find(value => decision.id.startsWith(prefix(value)))
        if (window.request.decisions.length !== 1 || stage === undefined) {
          return this.result('recovery-required', step)
        }
        if (decision.status === 'accepted' || decision.status === 'cancelled') { await this.run.commitWindow(state.activeWindowId); continue }
        const actor = state.entities[decision.entityId]
        if (actor?.writer?.phase !== 'active' || actor.writer.epoch !== decision.epoch || decision.context?.status !== 'prepared'
          || decision.context.view.versions.persona !== 'company/1'
          || decision.context.view.versions.model !== `${this.config.model.provider}/${this.config.model.name}`) {
          return this.result('recovery-required', step, { entityId: decision.entityId })
        }
        const stopped = await this.executeWindow(state, state.activeWindowId, decision.id,
          { stage, entityId: decision.entityId, ...decision.wakeId === undefined ? {} : { wakeId: decision.wakeId } }, step + 1)
        if (stopped !== undefined) return stopped
        continue
      }
      const current = await this.connection.driveResident({ until: state.time }, Date.now, id => this.residency(id))
      if (!['until', 'decision-required'].includes(current.reason)) return this.result(current.reason, step + 1, current)
      state = this.run.snapshot()
      let taskInputRequired = false
      const task = this.config.tasks === undefined ? undefined : acceptedStage(state, 'task')?.operationIds[0]
      const creation = task === undefined ? undefined : state.operations[task]
      if (creation?.result?.status === 'applied' && creation.outbox?.taskReceipt !== undefined) {
        const stopped = await this.advanceTask(creation, step + 1)
        if (stopped === 'input-required') taskInputRequired = true
        else if (stopped !== undefined) return stopped
        state = this.run.snapshot()
      }
      let choice = select(state, this.config.tasks !== undefined)
      const wake = Object.values(state.wakes).find(value => value.status === 'pending'
        && (value.entityId === buyer || value.entityId === supplier))
      if ((choice !== 'scenario-blocked' || taskInputRequired) && wake !== undefined
        && (choice === undefined || choice === 'completed' || choice === 'scenario-blocked' || choice.wakeId !== wake.eventId)) {
        choice = { stage: 'input', entityId: wake.entityId, wakeId: wake.eventId }
      }
      if (choice === 'completed' && Object.values(state.scheduledEvents).some(event =>
        event.status === 'pending' && event.action.kind === 'ingress')) choice = undefined
      if (choice === 'completed' || choice === 'scenario-blocked') return this.result(choice, step + 1)
      if (choice === undefined) {
        const times = Object.values(state.scheduledEvents).filter(event => event.status === 'pending')
          .map(event => event.key.time).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)
        /* v8 ignore next -- awaiting native publication/receipt retains a scheduled event; cancellation settles its operation. */
        if (times[0] === undefined) throw new Error('Company awaited input has no retained scheduled event')
        const driven = await this.connection.driveResident({ until: times[0] }, Date.now, id => this.residency(id))
        if (!['until', 'decision-required'].includes(driven.reason)) return this.result(driven.reason, step + 1, driven)
        continue
      }
      const resident = await this.connection.ensureResident(choice.entityId, this.residency(choice.entityId))
      this.lifetime.throwIfAborted()
      if (resident.status !== 'resident') return this.result(resident.status === 'capacity' ? 'resident-capacity' : 'recovery-required', step + 1,
        { stage: choice.stage, entityId: choice.entityId })
      state = this.run.snapshot()
      if (state.phase !== 'running') return this.result(state.phase, step + 1)
      const id = simulationDecisionIdSchema.parse(`${prefix(choice.stage)}${state.nextDecisionSlot}`)
      const windowId = simulationWindowIdSchema.parse(id)
      await this.connection.openWindow({ id: windowId, decisions: [{ id, entityId: choice.entityId,
        ...choice.wakeId === undefined ? {} : { wakeId: choice.wakeId }, context: this.context(state, choice.stage, choice.entityId) }] })
      const stopped = await this.executeWindow(state, windowId, id, choice, step + 1)
      if (stopped !== undefined) return stopped
    }
    return this.result('work-limit', this.config.maxControlSteps)
  }

  private async advanceTask(operation: SimulationOperation, step: number): Promise<SimulationCompanyDriveResult | 'input-required' | undefined> {
    const settings = this.config.tasks, options = this.taskOptions
    /* v8 ignore next -- constructor rejects missing task readers; only configured task stages call this method. */
    if (settings === undefined || options === undefined) throw new Error('Company task stage has no retained execution configuration')
    const reviewed = settings.review === 'buyer'
    // The company has one transfer task; an outer control step admits at most that one task batch.
    this.taskExecutor ??= new SimulationTaskExecutor(this.run, this.connection, simulationTaskExecutorSchema.parse({
      version: '1', maxControlSteps: 1, maxDecisionsPerAttempt: reviewed ? 2 : 1,
      leaseDurationMs: settings.leaseDurationMs, retry: settings.retry,
      routes: [{ sourceEntityId: supplier, entityId: supplier, operationId: operation.id,
        ...settings.cognition === 'deterministic' ? { cognition: companyTaskCognition } : {},
        completion: reviewed ? companyTaskReviewedCompletion : companyTaskCompletion,
        ...reviewed ? {} : { interactionId: simulationInteractionIdSchema.parse('purchase') },
        reason: 'Transfer the purchased inventory unit',
      }],
    }), { ...options, lifetime: this.lifetime, residency: id => this.residency(id), recover: recoverCompanyTask,
      ...reviewed ? { nextDecision: () => ({ kind: 'decision' as const, reason: 'Report the evidenced purchased inventory unit',
        ...settings.cognition === 'deterministic' ? { policy: companyTaskCognition } : {} }) } : {},
      context: (state, execution, task) => this.context(state, 'transfer', supplier, execution.request.operationId, reviewed ? task : undefined) })
    const result = await this.taskExecutor.advance()
    if (result.reason === 'idle') return undefined
    if (result.reason === 'task-waiting') {
      const receipt = operation.outbox?.taskReceipt
      if (receipt === undefined) throw new Error('Company task stage lost its original creation receipt')
      const task = await options.readTask({ teamId: receipt.teamId, taskId: receipt.taskId })
      this.lifetime.throwIfAborted()
      if (reviewed && task.phase === 'review') return this.result('review-required', step, { stage: 'task', operationId: operation.id })
      const state = this.run.snapshot()
      if (Object.values(state.wakes).some(value => value.status === 'pending' && (value.entityId === buyer || value.entityId === supplier))) {
        return 'input-required'
      }
      const next = Object.values(state.scheduledEvents).filter(value => value.status === 'pending')
        .map(value => value.key.time).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)[0]
      if (next !== undefined) {
        const driven = await this.connection.driveResident({ until: next }, Date.now, id => this.residency(id))
        return this.result(driven.reason === 'until' || driven.reason === 'decision-required' ? 'work-limit' : driven.reason,
          step, { stage: 'task', operationId: operation.id,
            ...driven.nextAttemptAt === undefined ? {} : { nextAttemptAt: driven.nextAttemptAt } })
      }
    }
    return this.result(result.reason === 'task-blocked' || result.reason === 'task-waiting' ? 'scenario-blocked' : result.reason,
      step, { stage: 'task', operationId: operation.id,
        ...result.nextAttemptAt === undefined ? {} : { nextAttemptAt: result.nextAttemptAt } })
  }

  /** A pause retains submitted work; an ended unsubmitted turn is cancelled before its wake can be retried. */
  private async executeWindow(state: SimulationSnapshot, windowId: SimulationWindowId, id: SimulationDecisionId,
    choice: Selection, step: number): Promise<SimulationCompanyDriveResult | undefined> {
    try {
      await this.connection.executeDecision(choice.entityId, id, this.context(state, choice.stage, choice.entityId), choice.wakeId)
      const current = this.run.snapshot()
      if (current.phase === 'paused' && current.decisions[id]?.status === 'submitted') {
        return this.result('paused', step, { stage: choice.stage, entityId: choice.entityId, decisionId: id })
      }
      await this.run.commitWindow(windowId)
    } catch (error: unknown) {
      const current = this.run.snapshot()
      if (this.lifetime.aborted || current.phase !== 'paused' || current.activeWindowId !== windowId) throw error
      const decision = current.decisions[id]
      if (decision?.status === 'submitted') {
        return this.result('paused', step, { stage: choice.stage, entityId: choice.entityId, decisionId: id })
      }
      if (decision?.status !== 'open') throw error
      await this.connection.cancelDecision(choice.entityId, id)
      await this.run.commitWindow(windowId)
      return this.result('paused', step, { stage: choice.stage, entityId: choice.entityId, decisionId: id,
        interruption: 'cancelled-before-submission' })
    }
  }

  private residency(entityId: SimulationEntityId) {
    const entity = this.run.snapshot().entities[entityId]
    return { activation: { provider: this.preparation.participant.provider,
      seed: { kind: entity?.writer === undefined ? 'fresh' as const : 'resume' as const },
      agent: { preset: this.preparation.participant.preset,
        options: { provider: this.config.model.provider, model: this.config.model.name } }, signal: this.lifetime },
    evict: [buyer, supplier] }
  }
  private context(state: SimulationSnapshot, stage: SimulationCompanyStage, entityId: SimulationEntityId,
    taskOperationId?: import('@clocky/clocky-simulation').SimulationOperationId, reviewedTask?: TeamTaskSnapshot):
  Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'> {
    const purchase = Object.values(state.interactions).find(value => value.id === 'purchase'
      && value.requester === buyer && value.assignee === supplier)
    const interaction = purchase === undefined ? undefined : { id: purchase.id, revision: purchase.revision, reply: purchase.reply,
      ...entityId === supplier ? { commitmentId: purchase.commitmentId, fulfillment: purchase.fulfillment,
        execution: purchase.execution } : {} }
    const taskSource = taskOperationId ?? acceptedStage(state, 'task')?.operationIds[0]
    const transfer = entityId !== supplier && stage !== 'report' ? undefined : this.config.tasks !== undefined && taskSource !== undefined
      ? companyTaskTransfer(state, taskSource) : Object.values(state.operations)
        .find(value => value.entityId === supplier && value.action.kind === 'resource/transfer' && value.result?.status === 'applied')
    const requestTime = acceptedStage(state, 'request')?.time ?? state.time
    const add = (delay: string) => simTimeSchema.parse((BigInt(requestTime) + BigInt(delay)).toString())
    const reviewer = this.config.tasks?.review === 'buyer' ? state.entities[buyer]?.binding : undefined
    if (this.config.tasks?.review === 'buyer' && reviewer === undefined) throw new Error('Company reviewer has no retained buyer binding')
    const task = this.config.tasks === undefined ? undefined : { subject: 'Deliver one purchased inventory unit',
      description: this.config.tasks.review === 'buyer'
        ? 'Transfer one purchased stock item and publish its inventory report. After review rework, revise only the report from recorded feedback; never repeat the original transfer.'
        : 'Transfer one stock item to received for the accepted purchase commitment, using the authorized resource revisions.',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      reviewPolicy: reviewer !== undefined ? { kind: 'participant', reviewerId: reviewer.participantId } : { kind: 'none' },
      budget: {}, maxAttempts: this.config.tasks.maxAttempts }
    const confirming = taskOperationId !== undefined && transfer !== undefined
    const reporting = reviewedTask !== undefined && transfer !== undefined
    const review = reviewedTask?.reviewHistory.at(-1)
    const reportText = `Inventory report: delivered one purchased unit.${review?.nextPhase === 'pending' ? ` Review feedback: ${review.reason}` : ''}`
    const input = { stage: reporting ? 'task-report' : confirming ? 'task-recovery' : stage, channelId: state.channelReservations?.[channelKey]?.channelId,
      ...reporting ? { reportText, reviewFeedback: review?.reason } : {},
      ...stage === 'task' ? { task } : {},
      interaction, transfer: transfer === undefined ? undefined : { id: transfer.id, result: transfer.result },
      resources: Object.values(state.resources).filter(value => value.id === 'stock' || value.id === 'received').map(value => ({
        id: value.id, revision: value.revision,
        ...value.owner === entityId ? { quantity: value.quantity } : {} })),
      requestAt: add(this.config.requestDelay),
      reportAt: simTimeSchema.parse((BigInt(state.time) + BigInt(this.config.reportDelay)).toString()),
      replyBy: add(this.config.replyDelay), completeBy: add(this.config.completeDelay) }
    const instructions = {
      input: 'Inspect the selected authorized input. Submit an empty proposal list to acknowledge this notification.',
      request: 'Request purchase from supplier: one stock item to received, then post the request to supplier with that request as dependency.',
      accept: 'Accept purchase at its current interaction revision. Submit only that acceptance.',
      task: 'Create the supplied inventory task unchanged at the current simulation time. Submit only that task creation.',
      transfer: 'Transfer one stock item to received for the accepted commitment, using the supplied resource revisions. Submit only the transfer.',
      result: 'Record purchase result with the applied transfer as evidence, then post its evidenced result to buyer depending on that result.',
      report: 'Inspect the delivered purchase evidence. Submit an empty proposal list to acknowledge this report.',
    }
    return { personaVersion: 'company/1', modelVersion: `${this.config.model.provider}/${this.config.model.name}`,
      sources: [{ kind: 'run-event', runId: state.spec.runId, sequence: state.revision }],
      sections: [{ kind: 'identity', required: true, blocks: [{ type: 'text', text: `You are ${entityId}.` }] },
        { kind: 'authority', required: true, blocks: [{ type: 'text',
          text: 'Use only Simulation observe, stage and submit. Effects follow their dependencies.' }] },
        { kind: 'input', required: true, blocks: [{ type: 'text', text: `Company decision: ${JSON.stringify(input)}` },
          ...this.config.tasks === undefined || stage !== 'transfer' ? [] : [{ type: 'text' as const,
            text: `Task inventory: ${JSON.stringify(reporting ? { kind: 'report', channelId: input.channelId,
              text: reportText, deliverAt: state.time } : confirming ? { kind: 'confirm', interactionId: purchase?.id,
              expectedRevision: purchase?.revision, evidence: transfer.id } : { kind: 'transfer', commitmentId: purchase?.commitmentId,
              reads: input.resources.map(value => ({ resourceId: value.id, revision: value.revision })) })}` }]] },
        { kind: 'goals', required: true, blocks: [{ type: 'text', text: reporting
          ? 'The original inventory unit is already delivered. Post only the supplied inventory report to buyer at the current time. Do not repeat the transfer. Include the recorded review feedback.' : confirming
            ? 'The original inventory transfer is applied. Submit an empty proposal list to acknowledge its supplied evidence; do not repeat world operations.'
            : instructions[stage] }] },
        { kind: 'commitments', required: true, blocks: [{ type: 'text', text: JSON.stringify(Object.values(state.commitments)
          .filter(value => value.debtor === entityId || value.creditor === entityId)) }] }] }
  }
}

/** The original accepted stage owns its effect identities; a later duplicate cannot replace its result. */
function acceptedStage(state: SimulationSnapshot, stage: SimulationCompanyStage): SimulationDecision | undefined {
  return Object.values(state.decisions).find(decision => decision.id.startsWith(prefix(stage)) && decision.status === 'accepted')
}
/** Inspect actual effects and recipient wake consumption; a submitted decision alone does not complete a stage. */
function select(state: SimulationSnapshot, tasks: boolean): Selection | 'completed' | 'scenario-blocked' | undefined {
  for (const stage of tasks ? taskStages : stages) {
    const done = acceptedStage(state, stage)
    if (done !== undefined) {
      const operations = done.operationIds.map(id => state.operations[id] as SimulationOperation)
      if (operations.some(operation => operation.result !== undefined && operation.result.status !== 'applied')) return 'scenario-blocked'
      if (operations.some(operation => operation.result === undefined)) return undefined
      if (stage === 'request' && !Object.values(state.interactions).some(value => value.id === 'purchase' && value.requester === buyer
        && value.assignee === supplier && value.fulfillment.kind === 'transfer' && value.fulfillment.from === 'stock'
        && value.fulfillment.to === 'received' && value.fulfillment.quantity === '1')) return 'scenario-blocked'
      if (stage === 'accept' && !Object.values(state.interactions).some(value => value.id === 'purchase' && value.reply === 'accepted')) {
        return 'scenario-blocked'
      }
      if (stage === 'transfer' && !operations.some(operation => operation.action.kind === 'resource/transfer')) return 'scenario-blocked'
      if (stage === 'task' && (operations.length !== 1 || operations[0]?.action.kind !== 'task/create'
        || !Object.values(state.taskExecutions ?? {}).some(value => value.request.operationId === operations[0]?.id
          && value.task?.phase === 'completed'))) return 'scenario-blocked'
      if (stage === 'result' && !operations.some(operation => operation.action.kind === 'interaction/result' && operation.action.id === 'purchase')) {
        return 'scenario-blocked'
      }
      continue
    }
    const entityId = stage === 'request' || stage === 'report' ? buyer : supplier
    let wakeId
    if (stage === 'accept' || stage === 'report') {
      const source = acceptedStage(state, stage === 'accept' ? 'request' : 'result')
      const post = source?.operationIds.map(id => state.operations[id] as SimulationOperation)
        .find(operation => operation.action.kind === 'communication/post' && operation.action.recipient === entityId)
      if (post === undefined) return 'scenario-blocked'
      if (post.delivery?.receipt === undefined) return undefined
      wakeId = post.delivery.wakeId
      const wake = state.wakes[wakeId]
      if (wake === undefined) return undefined
      if (wake.status !== 'pending') return 'scenario-blocked'
    }
    return { stage, entityId, ...wakeId === undefined ? {} : { wakeId } }
  }
  return 'completed'
}
