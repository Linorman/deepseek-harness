import { simulationResidentSlots } from '@clocky/clocky-simulation'
import { simulationOutboxRetryRequestSchema } from '@clocky/clocky-simulation'
import { simulationTaskResultRequestSchema } from '@clocky/clocky-simulation'
import { simulationTaskDecisionRequestSchema, simulationTaskInputReceiptSchema } from '@clocky/clocky-simulation'
import { simulationTaskExecutionRequestSchema, simulationTaskExecutionObservationSchema, simulationTaskExecutionRetirementSchema } from '@clocky/clocky-simulation'
import { simulationTaskCancellationSchema } from '@clocky/clocky-simulation'
import { simulationCheckpointRequestSchema, simulationCheckpointManifestSchema } from '@clocky/clocky-simulation'
import { addAbortListener } from 'node:events'
import { simulationPhaseManagementRequestSchema } from '@clocky/clocky-simulation'
import { isOutboxAction } from './outbox.ts'
import { outboundPayload, receiptMatches } from './outbox.ts'
import { simulationDispatchOutcomeSchema } from '@clocky/clocky-simulation'
import { simulationTaskReconcileRequestSchema } from '@clocky/clocky-simulation'
/** Serialized writes publish only after the journal batch is durable. @module @clocky/clocky-simulation-local/run */
import { assertKnowledgeAccess } from './context.ts'
import { selectKnowledge } from '@clocky/clocky-simulation'
import { simulationKnowledgeRequestSchema } from '@clocky/clocky-simulation'
import { simulationPolicyRefSchema } from '@clocky/clocky-simulation'
import { queueUsage, SimulationCapacityExceeded } from './capacity.ts'
import { simulationCapacityGrantRequestSchema } from '@clocky/clocky-simulation'
import { nextTokenId, requireTokenReservation, tokenSettlementRetained } from './tokens.ts'
import { simulationCompactionTokenRequestSchema, simulationTokenUsageSchema, simulationTokenRequestSchema, simulationTokenOutcomeSchema } from '@clocky/clocky-simulation'
import { assertBudget, budgetUsage, SimulationBudgetExceeded } from './budget.ts'
import { simulationBudgetGrantRequestSchema } from '@clocky/clocky-simulation'
import { decisionDispatch, selectDecisions } from './dispatch.ts'
import { simulationDispatchCandidateSchema, simulationDispatchSelectionRequestSchema } from '@clocky/clocky-simulation'
import { teamIdSchema, teamRootCreateInputSchema } from '@clocky/clocky-team'
import { participantIdSchema } from '@clocky/clocky-team'
import { channelIdSchema } from '@clocky/clocky-team'
import { simulationChannelSpecSchema } from '@clocky/clocky-simulation'
import { simulationWindowRequestSchema } from '@clocky/clocky-simulation'
import { simulationIngressRequestSchema, simulationEventSlotSchema } from '@clocky/clocky-simulation'
import { ingressEventId } from './scheduler.ts'
import type { SimulationWindow, SimulationWindowId, SimulationWindowRequest, SimulationDecision, SimulationProposal } from '@clocky/clocky-simulation'
import { currentDecision } from './decisions.ts'
import { SessionId } from '@clocky/clocky-session'
import { simulationParticipantSpecSchema } from '@clocky/clocky-simulation'
import { simulationContextRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationContextPreparation } from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { ActivationReservationId } from '@clocky/clocky-team'
import type { LogStream } from '@clocky/clocky-storage'
import { simulationChangeSchema, simulationCoordinatorIdSchema, simulationEntityBindingSchema, simulationWriterActivationSchema, simulationWriterEpochSchema, simulationWriterReservationSchema, simulationProposalSchema, simulationResourceSpecSchema, simulationWakeRequestSchema, simulationDriveRequestSchema, parseSimTime, simulationWallTimeSchema } from '@clocky/clocky-simulation'
import type { SimTime, SimulationChange, SimulationEntityBinding, SimulationEntityId, SimulationRelation, SimulationRun, SimulationSnapshot, SimulationWriter, SimulationWriterActivation, SimulationWriterEpoch, SimulationWriterLease, SimulationWriterReservation } from '@clocky/clocky-simulation'
import { foldEntry, foldEntries } from './journal.ts'
import { selectRelations } from './entities.ts'
import { assertWriterProjection, assertWriterActivation, requireCognitionEntity, requireWriterEpoch } from './writers.ts'
import type { WriterChange } from './writers.ts'
import type { SimulationDecisionId, SimulationOperation, SimulationOperationId, SimulationOperationResult, SimulationResourceSpec } from '@clocky/clocky-simulation'
import { acceptanceRecords, assertBusinessProjection, assertDecisionOwner, requireDecision, nextLocalOperation } from './decisions.ts'
import type { BusinessRecord } from './decisions.ts'
import { computeOperation } from './business.ts'
import { allocateEventKey, assertSchedulerProjection, nextScheduledEvent, canCollectDecisionEvent, schedulerConsequences, outboxScheduleRecords } from './scheduler.ts'
import type { SchedulerRecord } from './scheduler.ts'
import { dependenciesReady, dependencyFailed, requireOutbox } from './outbox.ts'
import type { OutboxRecord } from './outbox.ts'
import type { SimulationDispatchResult, SimulationTeamTransport } from '@clocky/clocky-simulation'
import { foldBusinessRecord } from './decisions.ts'
import type { SimulationDriveRequest, SimulationDriveResult, SimulationEventId, SimulationWakeRequest } from '@clocky/clocky-simulation'

/** Internal run handle retaining its medium and process lock until successful cleanup. */
export class LocalSimulationRun implements SimulationRun {
  private readonly windowAdmissions = new Map<SimulationEntityId, { epoch: SimulationWriterEpoch; authorize: () => Promise<void> }>()
  private readonly coordinatorId = simulationCoordinatorIdSchema.parse(randomUUID())
  private readonly dispatches = new Map<SimulationOperationId, Promise<SimulationDispatchResult>>()
  private work: Promise<unknown> = Promise.resolve()
  private retirement: (() => Promise<void>) | undefined
  private checkpointBarrier: { readonly token: symbol; phase: 'draining' | 'sealed' } | undefined
  private inspectionOnly = true
  private closing = false
  private disposal: Promise<void> | undefined

  constructor(
    private readonly stream: LogStream,
    private state: SimulationSnapshot,
    private readonly backend: 'json' | 'sqlite',
    private readonly release: () => Promise<void>,
    private readonly committed: (snapshot: SimulationSnapshot, durableTail: number, previousRevision?: number) => void,
  ) { assertWriterProjection(state); assertBusinessProjection(state); assertSchedulerProjection(state) }

  beginCheckpoint(request: import('@clocky/clocky-simulation').SimulationCheckpointRequest):
  Promise<import('@clocky/clocky-simulation').SimulationCheckpointOperation> {
    const accepted = simulationCheckpointRequestSchema.parse(request)
    return this.enqueue(async () => {
      const prior = Object.hasOwn(this.state.checkpoints ?? {}, accepted.id) ? this.state.checkpoints?.[accepted.id] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted)) throw new Error('Checkpoint id changed its request')
        return structuredClone(prior)
      }
      const started = { kind: 'run/checkpoint', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        change: { kind: 'checkpoint/requested', request: accepted } }
      await this.commitValues([started, ...this.state.phase === 'paused' ? [] : [{ kind: 'run/phase', runId: this.state.spec.runId,
        expectedRevision: this.state.revision + 1, phase: 'paused' }]])
      return this.checkpointOperation(accepted.id)
    })
  }

  failCheckpoint(id: import('@clocky/clocky-simulation').SimulationCheckpointId, error: string,
    diagnostic?: import('@clocky/clocky-simulation').SimulationCheckpointDiagnostic):
  Promise<import('@clocky/clocky-simulation').SimulationCheckpointOperation> {
    return this.enqueue(async () => {
      const prior = this.checkpointOperation(id)
      if (prior.status !== 'in-progress') return prior
      await this.commit({ kind: 'run/checkpoint', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        change: { kind: 'checkpoint/failed', id, error, ...diagnostic === undefined ? {} : { diagnostic } } })
      return this.checkpointOperation(id)
    })
  }

  private checkpointOperation(id: import('@clocky/clocky-simulation').SimulationCheckpointId):
  import('@clocky/clocky-simulation').SimulationCheckpointOperation {
    const value = Object.hasOwn(this.state.checkpoints ?? {}, id) ? this.state.checkpoints?.[id] : undefined
    if (value === undefined) throw new Error('Checkpoint request does not exist')
    return structuredClone(value)
  }

  async acquireCheckpointCut(maxDrainRounds: number, signal?: AbortSignal): Promise<import('@clocky/clocky-simulation').SimulationCheckpointCut> {
    if (!Number.isSafeInteger(maxDrainRounds) || maxDrainRounds < 1) throw new TypeError('Checkpoint drain rounds must be a positive safe integer')
    signal?.throwIfAborted()
    if (this.closing || this.checkpointBarrier !== undefined) throw new Error('Simulation checkpoint cut is already held or the run is closing')
    const token = Symbol('checkpoint-cut')
    this.checkpointBarrier = { token, phase: 'draining' }
    const aborted = Promise.withResolvers<never>()
    const subscription = signal === undefined ? undefined : addAbortListener(signal, () => { aborted.reject(signal.reason) })
    const observe = <T>(work: Promise<T>): Promise<T> => signal === undefined ? work : Promise.race([work, aborted.promise])
    let publishing = 0
    let releaseRequested = false
    const release = (): void => {
      releaseRequested = true
      if (publishing === 0 && this.checkpointBarrier?.token === token) this.checkpointBarrier = undefined
    }
    try {
      await observe(Promise.allSettled([...this.dispatches.values()]))
      let stable = false
      for (let round = 0; round < maxDrainRounds; round += 1) {
        const observed = this.work
        await observe(observed)
        if (observed === this.work) { stable = true; break }
      }
      signal?.throwIfAborted()
      if (!stable) throw new Error('Simulation checkpoint retirement queue did not stabilize')
      if (this.state.phase === 'running' || this.state.activeDecisionId !== undefined || this.state.activeWindowId !== undefined
        || Object.values(this.state.entities).some(entity => entity.writer !== undefined && entity.writer.phase !== 'released')) {
        throw new Error('Simulation checkpoint requires paused scheduling and retired writers/windows')
      }
      if (Object.values(this.state.management ?? {}).some(operation => operation.status === 'in-progress')) {
        throw new Error('Simulation checkpoint cannot seal an unfinished phase-management request')
      }
      if (Object.values(this.state.taskExecutions ?? {}).some(value => value.retired === undefined
        && value.task?.executor?.outcome === undefined)) {
        throw new Error('Simulation checkpoint cannot seal an unresolved task attempt')
      }
      this.checkpointBarrier.phase = 'sealed'
      const reference = this.persistenceReference()
      return { snapshot: this.snapshot(), reference, release, publish: (manifest) => {
        const accepted = simulationCheckpointManifestSchema.parse(manifest)
        publishing += 1
        return this.enqueue(async () => {
          if (releaseRequested || this.checkpointBarrier?.token !== token || this.checkpointBarrier.phase !== 'sealed') {
            throw new Error('Checkpoint publication has no live sealed cut')
          }
          const prior = this.checkpointOperation(accepted.id)
          if (prior.status === 'completed') {
            if (!isDeepStrictEqual(prior.manifest, accepted)) throw new Error('Checkpoint publication retry changed its manifest')
            return prior
          }
          if (!isDeepStrictEqual(accepted.run, reference) || this.state.revision !== reference.cursor) {
            throw new Error('Checkpoint publication changed its run cut')
          }
          await this.commit({ kind: 'run/checkpoint', runId: this.state.spec.runId, expectedRevision: this.state.revision,
            change: { kind: 'checkpoint/published', publishedAt: Date.now(), manifest: accepted } })
          return this.checkpointOperation(accepted.id)
        }, 'checkpoint').finally(() => { publishing -= 1; if (releaseRequested) release() })
      } }
    } catch (error: unknown) { release(); throw error }
    finally { subscription?.[Symbol.dispose]() }
  }

  getPersistenceReference(expectedRevision: number): Promise<import('@clocky/clocky-simulation').SimulationRunPersistenceReference> {
    return this.enqueue(() => {
      this.assertRevision(expectedRevision)
      return this.persistenceReference()
    }, 'read')
  }

  private persistenceReference(): import('@clocky/clocky-simulation').SimulationRunPersistenceReference {
    if (this.stream.tailSequence !== this.state.revision) throw new Error('Simulation projection does not match its durable journal')
    return { runId: this.state.spec.runId, backend: this.backend, retention: 'full',
      stream: { name: this.stream.name, version: this.stream.version },
      cursor: this.state.revision, firstSequence: this.stream.firstSequence,
      fingerprint: businessFingerprint(this.state) as import('@clocky/clocky-brand').Branded<'SimulationRunFingerprint'> }
  }

  inspectEntity(id: SimulationEntityId): import('@clocky/clocky-simulation').SimulationEntitySnapshot {
    const state = this.state
    const entity = Object.hasOwn(state.entities, id) ? state.entities[id] : undefined
    return structuredClone({ runId: state.spec.runId, revision: state.revision, ...entity === undefined ? {} : { entity } })
  }

  snapshot(): SimulationSnapshot { return structuredClone(this.state) }

  population(): { readonly entities: number; readonly chargedActors: number } {
    const entities = Object.values(this.state.entities)
    return { entities: entities.filter(entity => entity.phase !== 'terminated').length,
      chargedActors: simulationResidentSlots(this.state).used }
  }

  ingest(request: import('@clocky/clocky-simulation').SimulationIngressRequest): Promise<import('@clocky/clocky-simulation').SimulationIngress> {
    const accepted = simulationIngressRequestSchema.parse(request)
    return this.enqueue(async () => {
      const prior = Object.hasOwn(this.state.ingresses ?? {}, accepted.id) ? this.state.ingresses?.[accepted.id] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted)) throw new Error('Simulation ingress retry changed its payload')
        return structuredClone(prior)
      }
      if (Object.values(this.state.checkpoints ?? {}).some(operation => operation.status === 'in-progress')) {
        throw new Error('Simulation checkpoint request blocks new external input')
      }
      const action = { kind: 'ingress' as const, ingressId: accepted.id }
      const eventId = ingressEventId(this.state, accepted.id)
      const time = BigInt(accepted.availableAt) < BigInt(this.state.time) ? this.state.time : accepted.availableAt
      const key = allocateEventKey(this.state, time, action)
      await this.commitScheduler([
        { kind: 'ingress/received', request: accepted, ordinal: this.state.nextIngressSlot ?? simulationEventSlotSchema.parse('0'), eventId, key },
        { kind: 'event/queued', id: eventId, action, key },
      ])
      return structuredClone(this.state.ingresses?.[accepted.id] as import('@clocky/clocky-simulation').SimulationIngress)
    })
  }

  acknowledgeConflict(id: SimulationOperationId, expectedRevision: number): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      const operation = Object.hasOwn(this.state.operations, id) ? this.state.operations[id] : undefined
      if (operation?.conflictRetry?.kind === 'exhausted' && operation.conflictRetry.acknowledged) return this.snapshot()
      this.assertRevision(expectedRevision)
      await this.commitScheduler([{ kind: 'conflict/acknowledged', id }])
      return this.snapshot()
    })
  }

  reconcileTokenUsage(id: import('@clocky/clocky-simulation').SimulationTokenReservationId,
    usage: import('@clocky/clocky-simulation').SimulationTokenUsage): Promise<import('@clocky/clocky-simulation').SimulationTokenReservation> {
    const accepted = simulationTokenUsageSchema.parse(usage)
    return this.enqueue(async () => {
      const reservation = requireTokenReservation(this.state, id)
      const writer = this.state.entities[reservation.entityId]?.writer
      if (reservation.status === 'reserved' && writer?.epoch === reservation.epoch && writer.phase !== 'released') {
        throw new Error('Simulation live token reservation must settle through its writer')
      }
      return await this.settleTokens(id, { kind: 'complete', usage: accepted })
    })
  }

  acknowledgeTokenOverrun(id: import('@clocky/clocky-simulation').SimulationTokenReservationId,
    expectedRevision: number): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      if (requireTokenReservation(this.state, id).overrunAcknowledged === true) return this.snapshot()
      this.assertRevision(expectedRevision)
      await this.commitBusiness([{ kind: 'token/acknowledged', id }])
      return this.snapshot()
    })
  }

  private async settleTokens(id: import('@clocky/clocky-simulation').SimulationTokenReservationId,
    outcome: import('@clocky/clocky-simulation').SimulationTokenOutcome): Promise<import('@clocky/clocky-simulation').SimulationTokenReservation> {
    const prior = requireTokenReservation(this.state, id)
    if (!tokenSettlementRetained(prior, outcome)) await this.commitBusiness([{ kind: 'token/settled', id, outcome }])
    return structuredClone(requireTokenReservation(this.state, id))
  }

  queueUsage(): import('@clocky/clocky-simulation').SimulationQueueUsage { return queueUsage(this.state) }

  extendCapacity(request: import('@clocky/clocky-simulation').SimulationCapacityGrantRequest,
    expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = simulationCapacityGrantRequestSchema.parse(request)
    return this.enqueue(async () => {
      const grants = this.state.capacityGrants ?? {}
      const prior = Object.hasOwn(grants, accepted.id) ? grants[accepted.id] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior, accepted)) throw new Error('Simulation capacity addition retry changed its payload')
        return this.snapshot()
      }
      this.assertRevision(expectedRevision)
      await this.commitBusiness([{ kind: 'capacity/extended', request: accepted }])
      return this.snapshot()
    })
  }

  budgetUsage(): import('@clocky/clocky-simulation').SimulationBudgetUsage { return budgetUsage(this.state) }

  extendBudget(request: import('@clocky/clocky-simulation').SimulationBudgetGrantRequest, expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = simulationBudgetGrantRequestSchema.parse(request)
    return this.enqueue(async () => {
      const grants = this.state.budgetGrants ?? {}
      const prior = Object.hasOwn(grants, accepted.id) ? grants[accepted.id] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior, accepted)) throw new Error('Simulation budget addition retry changed its payload')
        return this.snapshot()
      }
      this.assertRevision(expectedRevision)
      await this.commitBusiness([{ kind: 'budget/extended', request: accepted }])
      return this.snapshot()
    })
  }

  queueDecision(candidate: import('@clocky/clocky-simulation').SimulationDispatchCandidate):
  Promise<import('@clocky/clocky-simulation').SimulationDispatchTicket> {
    const accepted = simulationDispatchCandidateSchema.parse(candidate)
    return this.enqueue(async () => {
      const tickets = decisionDispatch(this.state).tickets
      const prior = Object.hasOwn(tickets, accepted.id) ? tickets[accepted.id] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.candidate, accepted)) throw new Error('Simulation nomination retry changed its payload')
        return structuredClone(prior)
      }
      await this.commitBusiness([{ kind: 'dispatch/queued', candidate: accepted }])
      return structuredClone(decisionDispatch(this.state).tickets[accepted.id] as import('@clocky/clocky-simulation').SimulationDispatchTicket)
    })
  }

  reserveDecisionWindow(request: import('@clocky/clocky-simulation').SimulationDispatchSelectionRequest, expectedRevision: number):
  Promise<import('@clocky/clocky-simulation').SimulationDispatchSelection | undefined> {
    const accepted = simulationDispatchSelectionRequestSchema.parse(request)
    return this.enqueue(async () => {
      const selections = decisionDispatch(this.state).selections
      const prior = Object.hasOwn(selections, accepted.id) ? selections[accepted.id] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted)) throw new Error('Simulation allocation retry changed its request')
        return structuredClone(prior)
      }
      this.assertRevision(expectedRevision)
      const decisions = selectDecisions(this.state, accepted)
      if (decisions.length === 0) return undefined
      await this.commitBusiness([{ kind: 'dispatch/reserved', request: accepted, decisions }])
      return structuredClone(decisionDispatch(this.state).selections[accepted.id] as import('@clocky/clocky-simulation').SimulationDispatchSelection)
    })
  }

  cancelQueuedDecision(id: SimulationDecisionId, expectedRevision: number): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      if (decisionDispatch(this.state).tickets[id]?.status === 'cancelled') return this.snapshot()
      this.assertRevision(expectedRevision)
      await this.commitBusiness([{ kind: 'dispatch/cancelled', id }])
      return this.snapshot()
    })
  }

  openWindow(request: SimulationWindowRequest, expectedRevision: number): Promise<SimulationWindow> {
    const accepted = simulationWindowRequestSchema.parse(request)
    return this.enqueue(async () => {
      const existing = Object.hasOwn(this.state.windows ?? {}, accepted.id) ? this.state.windows?.[accepted.id] : undefined
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing.request, accepted)) throw new Error('Simulation window retry changed its frozen inputs')
        return structuredClone(existing)
      }
      this.assertRevision(expectedRevision)
      for (const decision of accepted.decisions) {
        const admission = this.windowAdmissions.get(decision.entityId)
        if (admission === undefined) throw new Error('Simulation window actor has no live admission owner')
        await admission.authorize()
      }
      await this.commitBusiness([{ kind: 'window/opened', request: accepted }])
      return this.window(accepted.id)
    })
  }

  commitWindow(id: SimulationWindowId): Promise<SimulationWindow> {
    return this.enqueue(async () => {
      const window = this.window(id)
      if (window.status === 'closed') return window
      for (const selected of window.request.decisions) {
        const decision = requireDecision(this.state, selected.id)
        if (decision.status === 'open') return this.window(id)
        if (decision.status !== 'submitted') continue
        const admission = this.windowAdmissions.get(decision.entityId)
        if (admission?.epoch !== decision.epoch) throw new Error('Simulation window decision lost its writer')
        await admission.authorize()
        await this.acceptDecision(decision, decision.submission as readonly SimulationProposal[])
      }
      await this.commitBusiness([{ kind: 'window/closed', id }])
      return this.window(id)
    })
  }

  private window(id: SimulationWindowId): SimulationWindow {
    const window = Object.hasOwn(this.state.windows ?? {}, id) ? this.state.windows?.[id] : undefined
    if (window === undefined) throw new Error('Simulation window does not exist')
    return structuredClone(window)
  }

  private async acceptDecision(decision: SimulationDecision, proposals: readonly SimulationProposal[], finishedAt?: number): Promise<void> {
    assertKnowledgeAccess(this.state, decision)
    assertBudget(this.state, 'messages', proposals.filter(proposal => proposal.action.kind === 'communication/post').length)
    const records: BusinessRecord[] = [
      ...finishedAt === undefined ? [] : [{ kind: 'decision/finished' as const, id: decision.id, finishedAt }],
      ...acceptanceRecords(this.state, decision, proposals),
    ]
    let projected = this.state
    for (const record of records) {
      projected = { ...foldBusinessRecord(projected, record, projected.revision + 1), revision: projected.revision + 1 }
    }
    const operations = requireDecision(projected, decision.id).operationIds.map(id => projected.operations[id] as SimulationOperation)
    const events = outboxScheduleRecords(projected, operations)
    await this.commitDomain([...records.map(change => ({ kind: 'run/business', change })),
      ...events.map(change => ({ kind: 'run/scheduler', change }))])
  }

  reserveChannel(channel: import('@clocky/clocky-simulation').SimulationChannelSpec, expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = simulationChannelSpecSchema.parse(channel)
    return this.enqueue(async () => {
      const existing = Object.hasOwn(this.state.channelReservations ?? {}, accepted.key)
        ? this.state.channelReservations?.[accepted.key] : undefined
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing.spec, accepted)) throw new Error('Simulation channel retry changed its membership or limits')
        return this.snapshot()
      }
      this.assertRevision(expectedRevision)
      await this.commit({ kind: 'run/channel-reserved', runId: this.state.spec.runId, expectedRevision,
        channelId: channelIdSchema.parse(`channel-${randomUUID()}`), spec: accepted })
      return this.snapshot()
    })
  }

  confirmChannel(key: import('@clocky/clocky-simulation').SimulationChannelKey, channelId: import('@clocky/clocky-team').ChannelId,
    expectedRevision: number): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      const existing = Object.hasOwn(this.state.channelReservations ?? {}, key) ? this.state.channelReservations?.[key] : undefined
      if (existing?.confirmed && existing.channelId === channelId) return this.snapshot()
      this.assertRevision(expectedRevision)
      await this.commit({ kind: 'run/channel-confirmed', runId: this.state.spec.runId, expectedRevision, key, channelId })
      return this.snapshot()
    })
  }

  reserveParticipant(entityId: SimulationEntityId, participant: import('@clocky/clocky-simulation').SimulationParticipantSpec,
    expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = simulationParticipantSpecSchema.parse(participant)
    return this.enqueue(async () => {
      const entity = requireCognitionEntity(this.state, entityId)
      if (entity.participantReservation !== undefined) {
        if (!isDeepStrictEqual(entity.participantReservation.participant, accepted)) throw new Error('Simulation participant reservation changed its payload')
        return this.snapshot()
      }
      this.assertRevision(expectedRevision)
      const teamId = this.state.teamReservation?.teamId
      if (teamId === undefined) throw new Error('Simulation participant requires a reserved canonical Team')
      await this.commit({ kind: 'run/participant-reserved', runId: this.state.spec.runId, expectedRevision, entityId,
        binding: { teamId, participantId: participantIdSchema.parse(`participant-${randomUUID()}`), sessionId: SessionId(randomUUID()) },
        participant: accepted })
      return this.snapshot()
    })
  }

  scheduleWake(request: SimulationWakeRequest, expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = simulationWakeRequestSchema.parse(request)
    return this.enqueue(async () => {
      if (accepted.id.startsWith('simulation-event:') || accepted.id.startsWith('simulation-delivery:')
        || accepted.id.startsWith('simulation-ingress:')) throw new Error('Internal simulation event ids are reserved')
      const action = { kind: 'wake' as const, entityId: accepted.entityId, reason: accepted.reason }
      const existing = Object.hasOwn(this.state.scheduledEvents, accepted.id) ? this.state.scheduledEvents[accepted.id] : undefined
      if (existing !== undefined) {
        if (existing.key.time !== accepted.time || !isDeepStrictEqual(existing.action, action)) throw new Error('Simulation event id was reused with a different payload')
        return this.snapshot()
      }
      this.assertRevision(expectedRevision)
      const entity = Object.hasOwn(this.state.entities, accepted.entityId) ? this.state.entities[accepted.entityId] : undefined
      if (entity?.phase !== 'active' || entity.cognition !== 'agent') throw new Error('Simulation wake requires an active cognitive entity')
      await this.commitScheduler([{ kind: 'event/queued', id: accepted.id,
        key: allocateEventKey(this.state, accepted.time, action), action }])
      return this.snapshot()
    })
  }

  cancelEvent(id: SimulationEventId, reason: string, expectedRevision: number): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      this.assertRevision(expectedRevision)
      await this.commitScheduler([{ kind: 'event/cancelled', id, reason }])
      return this.snapshot()
    })
  }

  drive(request: SimulationDriveRequest): Promise<SimulationDriveResult> { return this.driveEvents(request, false) }

  collectDecisionWakes(request: SimulationDriveRequest): Promise<SimulationDriveResult> { return this.driveEvents(request, true) }

  private driveEvents(request: SimulationDriveRequest, collect: boolean): Promise<SimulationDriveResult> {
    const selected = simulationDriveRequestSchema.parse(request)
    return this.enqueue(async () => {
      parseSimTime(selected.until, this.state.spec.maxTime)
      if (BigInt(selected.until) < BigInt(this.state.time)) throw new Error('Simulation drive cannot rewind time')
      let steps = 0
      const result = (reason: SimulationDriveResult['reason']): SimulationDriveResult => ({ steps, reason, revision: this.state.revision })
      while (steps < this.state.spec.maxDriveSteps) {
        if (this.state.phase === 'paused') return result('paused')
        if (this.state.phase === 'stalled') return result('stalled')
        if (this.state.activeWindowId !== undefined || decisionDispatch(this.state).active !== undefined) return result('decision-required')
        const pending = nextLocalOperation(this.state)
        if (pending !== undefined && dependenciesReady(this.state, pending)) {
          await this.executeOwned(pending.id); steps += 1; continue
        }
        const outbound = Object.values(this.state.operations).find(operation => isOutboxAction(operation.action)
          && operation.outbox?.ready === true && operation.result === undefined && dependenciesReady(this.state, operation))
        if (outbound !== undefined) return { ...result('dispatch-required'), operationId: outbound.id }
        const receiving = Object.values(this.state.operations).find(operation => operation.action.kind === 'communication/post'
          && operation.result?.status === 'applied' && operation.delivery?.receipt === undefined && operation.deliveryFailure?.resolution === undefined)
        if (receiving !== undefined) return { ...result('delivery-required'), operationId: receiving.id }
        const unavailable = Object.values(this.state.wakes).find(wake => wake.status === 'pending'
          && this.state.entities[wake.entityId]?.phase !== 'active')
        if (unavailable !== undefined) {
          await this.commitScheduler([{ kind: 'wake/cancelled', id: unavailable.eventId, reason: 'Entity unavailable' }])
          steps += 1
          continue
        }
        const cohortEvent = nextScheduledEvent(this.state)
        const collecting = collect && cohortEvent !== undefined && canCollectDecisionEvent(this.state, cohortEvent)
        if (Object.values(decisionDispatch(this.state).tickets).some(ticket => ticket.status === 'queued')
          || this.state.activeDecisionId !== undefined
          || Object.values(this.state.wakes).some(wake => wake.status === 'claimed' || wake.status === 'pending' && !collecting)) {
          return result('decision-required')
        }
        const next = cohortEvent
        if (next === undefined || BigInt(next.key.time) > BigInt(selected.until)) {
          if (selected.until !== this.state.time) {
            await this.commitScheduler([{ kind: 'clock/advanced', time: selected.until }])
            steps += 1
          }
          return result('until')
        }
        if (BigInt(next.key.microstep) >= BigInt(this.state.spec.maxMicrostepsPerTime)) {
          await this.commitScheduler([{ kind: 'run/stalled', id: next.id }])
          steps += 1
          return result('stalled')
        }
        await this.commitScheduler([{ kind: collecting ? 'event/cohort-consumed' : 'event/consumed', id: next.id }])
        steps += 1
      }
      return result('work-limit')
    })
  }

  reserveTeam(creation: import('@clocky/clocky-team').TeamRootCreateInput, expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = { ...teamRootCreateInputSchema.parse(creation) }
    if (accepted.authorityGrant === undefined) delete accepted.authorityGrant
    return this.enqueue(async () => {
      if (this.state.teamReservation !== undefined) {
        if (!isDeepStrictEqual(this.state.teamReservation.creation, accepted)) throw new Error('Simulation Team reservation changed its creation payload')
        return this.snapshot()
      }
      this.assertRevision(expectedRevision)
      await this.commit({ kind: 'run/team-reserved', runId: this.state.spec.runId, expectedRevision,
        teamId: teamIdSchema.parse(`team-${randomUUID()}`), creation: accepted })
      return this.snapshot()
    })
  }

  confirmTeam(teamId: import('@clocky/clocky-team').TeamId, expectedRevision: number): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      if (this.state.teamReservation?.confirmed && this.state.teamReservation.teamId === teamId) return this.snapshot()
      this.assertRevision(expectedRevision)
      await this.commit({ kind: 'run/team-confirmed', runId: this.state.spec.runId, expectedRevision, teamId })
      return this.snapshot()
    })
  }

  resolveDeliveryFailure(id: SimulationOperationId, resolution: { readonly kind: 'retained-input' | 'entity-terminated' }
    | { readonly kind: 'absent-input'; readonly epoch: SimulationWriterEpoch }, expectedRevision: number): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      const operation = requireOutbox(this.state, id)
      if (operation.deliveryFailure?.resolution !== undefined) {
        if (operation.deliveryFailure.resolution.kind !== resolution.kind) throw new Error('Simulation failure resolution retry changed its disposition')
        return this.snapshot()
      }
      this.assertRevision(expectedRevision)
      await this.commitOutbox([{ kind: 'outbox/delivery-failure-resolved', id, resolution }])
      return this.snapshot()
    })
  }

  recordDeliveryFailure(id: SimulationOperationId, record: import('@clocky/clocky-team').ChannelDeliveryExpiredRecord,
    expectedRevision: number): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      const operation = requireOutbox(this.state, id)
      if (operation.deliveryFailure !== undefined) {
        if (!isDeepStrictEqual(operation.deliveryFailure.record, record)) throw new Error('Simulation delivery failure retry changed its evidence')
        return this.snapshot()
      }
      this.assertRevision(expectedRevision)
      await this.commitOutbox([{ kind: 'outbox/delivery-failed', id, record }])
      return this.snapshot()
    })
  }

  confirmDelivery(id: SimulationOperationId, receipt: import('@clocky/clocky-team').ChannelReceiptRecord,
    expectedRevision: number): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      const operation = requireOutbox(this.state, id)
      if (operation.delivery?.receipt !== undefined) {
        if (!isDeepStrictEqual(operation.delivery.receipt, receipt)) throw new Error('Simulation receipt retry changed its target result')
        return this.snapshot()
      }
      this.assertRevision(expectedRevision)
      await this.commitOutbox([{ kind: 'outbox/delivery-receipted', id, receipt }])
      return this.snapshot()
    })
  }

  recordDelivery(id: SimulationOperationId, epoch: SimulationWriterEpoch, expectedRevision: number): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      const operation = requireOutbox(this.state, id)
      if (operation.delivery !== undefined) return this.snapshot()
      this.assertRevision(expectedRevision)
      if (operation.action.kind !== 'communication/post') throw new Error('Task creation cannot produce message delivery')
      const action = { kind: 'wake' as const, entityId: operation.action.recipient, reason: `Team message ${operation.outbox.receipt?.envelopeId}` }
      await this.commitDomain([
        { kind: 'run/outbox', change: { kind: 'outbox/received', id, epoch } },
        { kind: 'run/scheduler', change: { kind: 'event/queued', id: `simulation-delivery:${id}` as SimulationEventId,
          key: allocateEventKey(this.state, this.state.time, action), action } },
      ])
      return this.snapshot()
    })
  }

  createResource(spec: SimulationResourceSpec, expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = simulationResourceSpecSchema.parse(spec)
    return this.enqueue(async () => {
      this.assertRevision(expectedRevision)
      await this.commitBusiness([{ kind: 'resource/created', resource: accepted }])
      return this.snapshot()
    })
  }

  executeOperation(operationId: SimulationOperationId): Promise<SimulationOperationResult> {
    return this.enqueue(() => this.executeOwned(operationId))
  }

  private async executeOwned(operationId: SimulationOperationId): Promise<SimulationOperationResult> {
    const operation = Object.hasOwn(this.state.operations, operationId) ? this.state.operations[operationId] : undefined
    if (operation === undefined) throw new Error('Simulation operation does not exist')
    if (operation.result !== undefined) return structuredClone(operation.result)
    if (this.state.activeWindowId !== undefined) throw new Error('Simulation world execution waits for its window to close')
    if (isOutboxAction(operation.action)) throw new Error('Simulation external effects must use their outbox dispatcher')
    const outcome = computeOperation(this.state, operation)
    const settled: BusinessRecord = { kind: 'operation/settled', id: operationId, status: outcome.status, code: outcome.code }
    const next = { ...foldBusinessRecord(this.state, settled, this.state.revision + 1), revision: this.state.revision + 1 }
    const effects = schedulerConsequences(next, next.operations[operationId] as SimulationOperation)
    await this.commitDomain([{ kind: 'run/business', change: settled }, ...effects.map(change => ({ kind: 'run/scheduler', change }))])
    return structuredClone(this.state.operations[operationId]?.result as SimulationOperationResult)
  }

  dispatchOperation(
    operationId: SimulationOperationId, transport: SimulationTeamTransport | import('@clocky/clocky-simulation').SimulationTaskTransport, clock: () => number,
  ): Promise<SimulationDispatchResult> {
    const existing = this.dispatches.get(operationId)
    if (existing !== undefined) return existing
    if (this.closing) return Promise.reject(new Error('Simulation run is closed'))
    if (this.checkpointBarrier !== undefined) return Promise.reject(new Error('Simulation checkpoint cut blocks new dispatch'))
    const operation = this.dispatchOwned(operationId, transport, clock)
    this.dispatches.set(operationId, operation)
    void operation.then(() => { this.dispatches.delete(operationId) }, () => { this.dispatches.delete(operationId) })
    return operation
  }

  private async dispatchOwned(
    id: SimulationOperationId, transport: SimulationTeamTransport | import('@clocky/clocky-simulation').SimulationTaskTransport, clock: () => number,
  ): Promise<SimulationDispatchResult> {
    const prepared = await this.enqueue(async () => {
      const operation = requireOutbox(this.state, id)
      if (operation.action.kind === 'task/create' ? !('createTask' in transport) : !('post' in transport)) {
        throw new Error('Simulation outbox transport does not implement its target kind')
      }
      if (operation.result !== undefined) return { status: 'settled' as const, result: structuredClone(operation.result) }
      if (operation.status === 'outcome-unknown') return { status: 'outcome-unknown' as const }
      if (this.state.phase !== 'running' || this.state.activeWindowId !== undefined || !operation.outbox.ready || BigInt(this.state.time) < BigInt(operation.action.deliverAt)) {
        throw new Error('Simulation outbox is not running or the message is not due')
      }
      if (!dependenciesReady(this.state, operation)) throw new Error('Simulation outbox dependency is pending')
      const message = structuredClone(outboundPayload(this.state, operation))
      if (dependencyFailed(this.state, operation) || !message.publishAllowed && operation.outbox.attempts.length === 0) {
        const code = dependencyFailed(this.state, operation) ? 'SIM_DEPENDENCY_FAILED' as const : 'SIM_ENTITY_UNAVAILABLE' as const
        await this.commitOutbox([{ kind: 'outbox/blocked', id, code }])
        return { status: 'settled' as const, result: structuredClone(requireOutbox(this.state, id).result as SimulationOperationResult) }
      }
      const at = simulationWallTimeSchema.parse(clock())
      if (operation.outbox.nextAttemptAt !== undefined && at < operation.outbox.nextAttemptAt) {
        return { status: 'retry' as const, nextAttemptAt: operation.outbox.nextAttemptAt }
      }
      if (operation.outbox.attempts.length - operation.outbox.budgetStart >= this.state.spec.outboxMaxAttempts) {
        await this.commitOutbox([{ kind: 'outbox/exhausted', id }])
        return { status: 'outcome-unknown' as const }
      }
      const number = operation.outbox.attempts.length + 1
      await this.commitOutbox([{ kind: 'outbox/started', id, number, at }])
      return { status: 'ready' as const, number, message }
    })
    if (prepared.status !== 'ready') return prepared
    let outcome: import('@clocky/clocky-simulation').SimulationDispatchOutcome | undefined
    let failure: string | undefined
    try {
      const message = structuredClone(prepared.message)
      if ('task' in message) {
        outcome = simulationDispatchOutcomeSchema.parse(await (transport as import('@clocky/clocky-simulation').SimulationTaskTransport).createTask(message))
      } else {
        outcome = simulationDispatchOutcomeSchema.parse(await (transport as SimulationTeamTransport).post(message))
      }
      if (outcome.status === 'applied' && !receiptMatches(this.state, requireOutbox(this.state, id), outcome)) {
        throw new Error('Transport receipt does not match the accepted communication')
      }
    } catch (error: unknown) { failure = error instanceof Error ? error.message : String(error) }
    const at = simulationWallTimeSchema.parse(clock())
    return await this.enqueue(async () => {
      if (outcome !== undefined && failure === undefined) {
        await this.commitOutbox([{ kind: 'outbox/finished', id, number: prepared.number, at, outcome }])
        return { status: 'settled', result: structuredClone(requireOutbox(this.state, id).result as SimulationOperationResult) }
      }
      await this.commitOutbox([{ kind: 'outbox/uncertain', id, number: prepared.number, at, detail: failure || 'Unknown transport outcome' }])
      const current = requireOutbox(this.state, id)
      return current.status === 'outcome-unknown' ? { status: 'outcome-unknown' }
        : { status: 'retry', nextAttemptAt: current.outbox.nextAttemptAt as number }
    }, 'retirement')
  }

  retryOutbox(request: import('@clocky/clocky-simulation').SimulationOutboxRetryRequest, authorize?: () => void):
  Promise<import('@clocky/clocky-simulation').SimulationOutboxRetryGrant> {
    const accepted = simulationOutboxRetryRequestSchema.parse(request)
    return this.enqueue(async () => {
      authorize?.()
      for (const operation of Object.values(this.state.operations)) {
        const grants = operation.outbox?.retryAuthorizations ?? {}
        if (!Object.hasOwn(grants, accepted.id)) continue
        const prior = grants[accepted.id]
        if (prior === undefined || !isDeepStrictEqual(prior.request, accepted)) throw new Error('Simulation retry identity changed its original payload')
        return structuredClone(prior)
      }
      if (this.state.activeWindowId !== undefined || Object.values(this.state.checkpoints ?? {}).some(value => value.status === 'in-progress')) {
        throw new Error('Simulation retry authorization is blocked by native maintenance')
      }
      await this.commitOutbox([{ kind: 'outbox/retry-authorized', id: accepted.operationId, request: accepted }])
      authorize?.()
      const grant = requireOutbox(this.state, accepted.operationId).outbox.retryAuthorizations?.[accepted.id]
      /* v8 ignore next -- successful retry-authorized folding installs this exact original grant. */
      if (grant === undefined) throw new Error('Simulation retry authorization has no retained grant')
      return structuredClone(grant)
    })
  }

  managePhase(request: import('@clocky/clocky-simulation').SimulationPhaseManagementRequest):
  Promise<import('@clocky/clocky-simulation').SimulationManagementOperation> {
    const accepted = simulationPhaseManagementRequestSchema.parse(request)
    return this.enqueue(async () => {
      const get = () => this.state.management?.[accepted.id]
      const prior = Object.hasOwn(this.state.management ?? {}, accepted.id) ? get() : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted)) throw new Error('Simulation management id changed its request')
        if (prior.status !== 'in-progress') return structuredClone(prior)
      } else {
        const start = { kind: 'run/management', runId: this.state.spec.runId, expectedRevision: this.state.revision,
          change: { kind: 'management/started', request: accepted } }
        // Pause admission and retain the request in one atomic batch; resume stays closed until its terminal batch.
        await this.commitValues(accepted.phase === 'paused' && this.state.phase !== 'paused' ? [start, { kind: 'run/phase', runId: this.state.spec.runId,
          expectedRevision: this.state.revision + 1, phase: 'paused', managementId: accepted.id }] : [start])
      }
      const phase = { kind: 'run/phase', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        phase: accepted.phase, managementId: accepted.id }
      const changesPhase = this.state.phase !== accepted.phase
      let failure: string | undefined
      if (changesPhase) {
        try { foldEntry(this.state, { sequence: this.state.revision + 1, value: phase }, this.state.spec, this.backend) }
        catch (error: unknown) { failure = (error as Error).message }
      }
      if (failure !== undefined) {
        await this.commit({ kind: 'run/management', runId: this.state.spec.runId, expectedRevision: this.state.revision,
          change: { kind: 'management/failed', id: accepted.id, error: failure } })
      } else {
        await this.commitValues([...changesPhase ? [phase] : [], { kind: 'run/management', runId: this.state.spec.runId,
          expectedRevision: this.state.revision + (changesPhase ? 1 : 0),
          change: { kind: 'management/completed', id: accepted.id } }])
      }
      return structuredClone(get() as import('@clocky/clocky-simulation').SimulationManagementOperation)
    })
  }

  setPhase(phase: 'paused' | 'running', expectedRevision: number): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      this.assertRevision(expectedRevision)
      if (phase === this.state.phase) return this.snapshot()
      await this.commit({ kind: 'run/phase', runId: this.state.spec.runId, expectedRevision, phase })
      return this.snapshot()
    })
  }

  reserveTaskExecution(request: import('@clocky/clocky-simulation').SimulationTaskExecutionRequest, expectedRevision: number):
  Promise<import('@clocky/clocky-simulation').SimulationTaskExecution> {
    const accepted = simulationTaskExecutionRequestSchema.parse(request)
    return this.enqueue(async () => {
      const entries = this.state.taskExecutions ?? {}
      const prior = Object.hasOwn(entries, accepted.attemptId) ? entries[accepted.attemptId] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted)) throw new Error('Simulation task retry changed its reservation')
        return structuredClone(prior)
      }
      this.assertRevision(expectedRevision)
      await this.commitBusiness([{ kind: 'task/execution-reserved', request: accepted }])
      return structuredClone(this.state.taskExecutions?.[accepted.attemptId] as import('@clocky/clocky-simulation').SimulationTaskExecution)
    })
  }

  recordTaskCancellation(request: import('@clocky/clocky-simulation').SimulationTaskCancellation):
  Promise<import('@clocky/clocky-simulation').SimulationTaskCancellationRecord> {
    const accepted = simulationTaskCancellationSchema.parse(request)
    return this.enqueue(async () => {
      const prior = this.state.taskCancellations?.[accepted.operationId]
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted)) throw new Error('Simulation task cancellation changed its original intent')
        return structuredClone(prior)
      }
      await this.commitBusiness([{ kind: 'task/cancellation', request: accepted }])
      const result = this.state.taskCancellations?.[accepted.operationId]
      /* v8 ignore next -- successful task/cancellation folding installs this exact record; retain the runtime invariant guard. */
      if (result === undefined) throw new Error('Simulation task cancellation was not published')
      return structuredClone(result)
    }, 'retirement')
  }

  observeTaskExecution(observation: import('@clocky/clocky-simulation').SimulationTaskExecutionObservation):
  Promise<import('@clocky/clocky-simulation').SimulationTaskExecution> {
    const accepted = simulationTaskExecutionObservationSchema.parse(observation)
    return this.enqueue(async () => {
      const prior = this.state.taskExecutions?.[accepted.attemptId]
      if (prior?.task !== undefined && isDeepStrictEqual(prior.task, accepted.task)) return structuredClone(prior)
      await this.commitBusiness([{ kind: 'task/execution-observed', observation: accepted }])
      return structuredClone(this.state.taskExecutions?.[accepted.attemptId] as import('@clocky/clocky-simulation').SimulationTaskExecution)
    }, 'retirement')
  }

  associateTaskDecision(request: import('@clocky/clocky-simulation').SimulationTaskDecisionRequest):
  Promise<import('@clocky/clocky-simulation').SimulationTaskDecision> {
    const accepted = simulationTaskDecisionRequestSchema.parse(request)
    return this.enqueue(async () => {
      const decisions = this.state.taskExecutions?.[accepted.attemptId]?.decisions
      const prior = decisions?.find(value => value.request.decisionId === accepted.decisionId)
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted)) throw new Error('Simulation task decision retry changed its source selection')
        return structuredClone(prior)
      }
      await this.commitBusiness([{ kind: 'task/execution-decision', request: accepted }])
      return structuredClone(this.state.taskExecutions?.[accepted.attemptId]?.decisions?.at(-1) as import('@clocky/clocky-simulation').SimulationTaskDecision)
    })
  }

  recordTaskInput(receipt: import('@clocky/clocky-simulation').SimulationTaskInputReceipt):
  Promise<import('@clocky/clocky-simulation').SimulationTaskDecision> {
    const accepted = simulationTaskInputReceiptSchema.parse(receipt)
    return this.enqueue(async () => {
      const decisions = this.state.taskExecutions?.[accepted.attemptId]?.decisions
      const prior = decisions?.find(value => value.request.decisionId === accepted.decisionId)
      if (prior?.input !== undefined) {
        if (prior.input.id !== accepted.inputId) throw new Error('Simulation task input retry changed its identity')
        return structuredClone(prior)
      }
      await this.commitBusiness([{ kind: 'task/execution-input', receipt: accepted }])
      const current = this.state.taskExecutions?.[accepted.attemptId]?.decisions
      const association = current?.find(value => value.request.decisionId === accepted.decisionId)
      return structuredClone(association as import('@clocky/clocky-simulation').SimulationTaskDecision)
    })
  }

  selectTaskCompletionPolicy(attemptId: import('@clocky/clocky-team').TaskAttemptId,
    policy: import('@clocky/clocky-simulation').SimulationPolicyRef): Promise<import('@clocky/clocky-simulation').SimulationTaskExecution> {
    const accepted = simulationPolicyRefSchema.parse(policy)
    return this.enqueue(async () => {
      const prior = this.state.taskExecutions?.[attemptId]
      if (prior?.completionPolicy !== undefined) {
        if (!isDeepStrictEqual(prior.completionPolicy, accepted)) throw new Error('Simulation task retry changed its completion policy')
        return structuredClone(prior)
      }
      await this.commitBusiness([{ kind: 'task/execution-policy', attemptId, policy: accepted }])
      return structuredClone(this.state.taskExecutions?.[attemptId] as import('@clocky/clocky-simulation').SimulationTaskExecution)
    })
  }

  recordTaskResult(request: import('@clocky/clocky-simulation').SimulationTaskResultRequest, expectedRevision: number):
  Promise<import('@clocky/clocky-simulation').SimulationTaskResult> {
    const accepted = simulationTaskResultRequestSchema.parse(request)
    return this.enqueue(async () => {
      const prior = this.state.taskExecutions?.[accepted.attemptId]?.result
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted)) throw new Error('Simulation task retry changed its accepted result')
        return structuredClone(prior)
      }
      this.assertRevision(expectedRevision)
      await this.commitBusiness([{ kind: 'task/execution-result', request: accepted }])
      return structuredClone(this.state.taskExecutions?.[accepted.attemptId]?.result as import('@clocky/clocky-simulation').SimulationTaskResult)
    })
  }

  retireTaskExecution(retirement: import('@clocky/clocky-simulation').SimulationTaskExecutionRetirement):
  Promise<import('@clocky/clocky-simulation').SimulationTaskExecution> {
    const accepted = simulationTaskExecutionRetirementSchema.parse(retirement)
    return this.enqueue(async () => {
      const prior = this.state.taskExecutions?.[accepted.attemptId]
      if (prior?.retired !== undefined) {
        const { sequence: _sequence, ...payload } = prior.retired
        const { attemptId: _attempt, ...request } = accepted
        if (!isDeepStrictEqual(payload, request)) throw new Error('Simulation task retry changed its retirement evidence')
        return structuredClone(prior)
      }
      await this.commitBusiness([{ kind: 'task/execution-retired', retirement: accepted }])
      return structuredClone(this.state.taskExecutions?.[accepted.attemptId] as import('@clocky/clocky-simulation').SimulationTaskExecution)
    }, 'retirement')
  }

  reconcileTask(request: import('@clocky/clocky-simulation').SimulationTaskReconcileRequest):
  Promise<import('@clocky/clocky-simulation').SimulationInteraction> {
    const accepted = simulationTaskReconcileRequestSchema.parse(request)
    return this.enqueue(async () => {
      const prior = this.state.interactions[accepted.interactionId]
      if (prior?.task !== undefined && isDeepStrictEqual(prior.task, accepted.task)) return structuredClone(prior)
      await this.commitBusiness([{ kind: 'task/reconciled', request: accepted }])
      return structuredClone(this.state.interactions[accepted.interactionId] as import('@clocky/clocky-simulation').SimulationInteraction)
    })
  }

  recordKnowledge(request: import('@clocky/clocky-simulation').SimulationKnowledgeRequest):
  Promise<import('@clocky/clocky-simulation').SimulationKnowledge> {
    const accepted = simulationKnowledgeRequestSchema.parse(request)
    return this.enqueue(async () => {
      const histories = this.state.knowledge ?? {}
      const history = Object.hasOwn(histories, accepted.id) ? histories[accepted.id] : undefined
      const retained = history?.find(value => value.revision === accepted.expectedRevision + 1)
      if (retained !== undefined) {
        const { sequence: _sequence, revision: _revision, ...prior } = retained
        const { expectedRevision: _expected, ...payload } = accepted
        if (!isDeepStrictEqual(prior, payload)) throw new Error('Simulation knowledge retry changed its version payload')
        return structuredClone(retained)
      }
      await this.commitBusiness([{ kind: 'knowledge/recorded', request: accepted }])
      return structuredClone(this.state.knowledge?.[accepted.id]?.at(-1) as import('@clocky/clocky-simulation').SimulationKnowledge)
    })
  }

  queryKnowledge(query: import('@clocky/clocky-simulation').SimulationKnowledgeQuery): readonly import('@clocky/clocky-simulation').SimulationKnowledge[] {
    return selectKnowledge(this.state, query)
  }

  change(command: SimulationChange, expectedRevision: number): Promise<SimulationSnapshot> {
    return this.changeMany([command], expectedRevision)
  }

  changeMany(commands: readonly SimulationChange[], expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = z.array(simulationChangeSchema).min(1).parse(commands)
    return this.enqueue(async () => {
      this.assertRevision(expectedRevision)
      await this.commitValues(accepted.map((command, index) => ({ kind: 'run/change', runId: this.state.spec.runId,
        expectedRevision: expectedRevision + index, command })))
      return this.snapshot()
    })
  }

  relationsAt(time: SimTime, scope?: SimulationEntityId | null): readonly SimulationRelation[] {
    return selectRelations(this.state, time, scope)
  }

  bindEntity(entityId: SimulationEntityId, binding: SimulationEntityBinding, expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = simulationEntityBindingSchema.parse(binding)
    return this.enqueue(async () => {
      this.assertRevision(expectedRevision)
      const entity = requireCognitionEntity(this.state, entityId)
      if (isDeepStrictEqual(entity.binding, accepted)) return this.snapshot()
      await this.commitWriter({ kind: 'entity/bound', entityId, binding: accepted })
      return this.snapshot()
    })
  }

  reserveWriter(
    entityId: SimulationEntityId, provider: string, reservationId: ActivationReservationId, expectedRevision: number,
  ): Promise<SimulationWriterLease> {
    return this.enqueue(async () => {
      this.assertRevision(expectedRevision)
      const entity = requireCognitionEntity(this.state, entityId)
      const epoch = simulationWriterEpochSchema.parse(String(BigInt(entity.writer?.epoch ?? '0') + 1n))
      await this.commitWriter({ kind: 'writer/reserved', entityId, epoch, coordinatorId: this.coordinatorId, reservationId, provider })
      return this.writerLease(entityId, epoch, false, true)
    })
  }

  recoverWriter(entityId: SimulationEntityId, activation: SimulationWriterActivation): Promise<SimulationWriterLease> {
    const accepted = simulationWriterActivationSchema.parse(activation)
    return this.enqueue(() => {
      const entity = requireCognitionEntity(this.state, entityId)
      assertWriterActivation(entity, accepted)
      const writer = entity.writer as SimulationWriter
      return this.writerLease(entityId, writer.epoch, writer.coordinatorId !== this.coordinatorId, false)
    }, 'retirement')
  }

  recoverUnpublishedWriter(
    entityId: SimulationEntityId, reservation: SimulationWriterReservation,
  ): Promise<SimulationWriterLease | undefined> {
    const accepted = simulationWriterReservationSchema.parse(reservation)
    return this.enqueue(() => {
      const entity = requireCognitionEntity(this.state, entityId)
      const binding = { teamId: accepted.teamId, participantId: accepted.participantId, sessionId: accepted.sessionId }
      if (!isDeepStrictEqual(entity.binding, binding)) throw new Error('Unpublished writer does not match its canonical binding')
      const writer = entity.writer
      if (writer === undefined || writer.phase === 'released' && writer.reservationId !== accepted.reservationId) return undefined
      if (writer.reservationId !== accepted.reservationId || writer.provider !== accepted.provider || writer.activationId !== undefined) {
        throw new Error('Unpublished writer recovery does not match its startup reservation')
      }
      return this.writerLease(entityId, writer.epoch, writer.coordinatorId !== this.coordinatorId, false)
    }, 'retirement')
  }

  private writerLease(
    entityId: SimulationEntityId, epoch: SimulationWriterEpoch, priorCoordinatorExited: boolean, canAdmit: boolean,
  ): SimulationWriterLease {
    let admission: { state: 'unconfigured' | 'closed' } | { state: 'open'; authorize: () => Promise<void> } = { state: canAdmit ? 'unconfigured' : 'closed' }
    const authorize = async (): Promise<void> => {
      if (admission.state !== 'open') throw new Error('Simulation writer has no live decision admission owner')
      const current = admission
      await current.authorize()
      if (admission !== current) throw new Error('Simulation writer retired during decision admission')
      const entity = requireWriterEpoch(this.state, entityId, epoch)
      if (entity.writer?.phase !== 'active' || entity.writer.coordinatorId !== this.coordinatorId) throw new Error('Simulation writer cannot admit a decision')
    }
    const owned = (id: SimulationDecisionId) => {
      const decision = requireDecision(this.state, id)
      assertDecisionOwner(decision, entityId, epoch)
      return decision
    }
    return {
      reserveCompactionTokens: (request) => {
        const accepted = simulationCompactionTokenRequestSchema.parse(request)
        return this.enqueue(async () => {
          await authorize()
          const id = nextTokenId(this.state)
          await this.commitBusiness([{ kind: 'token/compaction-reserved', id, entityId, epoch, request: accepted }])
          return structuredClone(requireTokenReservation(this.state, id))
        })
      },
      materializeCompactedReports: (id, reports) => this.enqueue(async () => {
        await authorize()
        owned(id)
        await this.commitBusiness([{ kind: 'decision/rebased', id, reports: [...reports] }])
        return structuredClone(owned(id).context as SimulationContextPreparation)
      }),
      validateContextPresentation: (id, view) => this.enqueue(async () => {
        await authorize()
        const context = owned(id).context
        if (context?.status !== 'prepared' || (businessFingerprint(view) !== businessFingerprint(context.view)
          && !context.previousPresentationHashes?.includes(businessFingerprint(view)))) {
          throw new Error('Simulation Session view is not a retained presentation of this decision')
        }
      }),
      selectDeterministicPolicy: (id, policy) => {
        const accepted = simulationPolicyRefSchema.parse(policy)
        return this.enqueue(async () => {
          await authorize()
          const decision = owned(id)
          if (decision.deterministic !== undefined) {
            if (!isDeepStrictEqual(decision.deterministic.policy, accepted)) throw new Error('Simulation deterministic policy changed on retry')
            return structuredClone(decision)
          }
          await this.commitBusiness([{ kind: 'deterministic/selected', id, policy: accepted }])
          return structuredClone(owned(id))
        })
      },
      recordDeterministicResult: (id, proposals) => {
        const accepted = z.array(simulationProposalSchema).parse(proposals)
        return this.enqueue(async () => {
          await authorize()
          const decision = owned(id)
          if (decision.deterministic?.proposals !== undefined) {
            if (!isDeepStrictEqual(decision.deterministic.proposals, accepted)) throw new Error('Simulation deterministic output changed on retry')
            return structuredClone(decision)
          }
          await this.commitBusiness([{ kind: 'deterministic/result', id, proposals: accepted }])
          return structuredClone(owned(id))
        })
      },
      reserveModelTokens: (id, request) => {
        const accepted = simulationTokenRequestSchema.parse(request)
        return this.enqueue(async () => {
          await authorize()
          owned(id)
          const reservationId = nextTokenId(this.state)
          await this.commitBusiness([{ kind: 'token/reserved', id: reservationId, decisionId: id, request: accepted }])
          return structuredClone(requireTokenReservation(this.state, reservationId))
        })
      },
      settleModelTokens: (id, outcome) => {
        const accepted = simulationTokenOutcomeSchema.parse(outcome)
        return this.enqueue(async () => {
          const reservation = requireTokenReservation(this.state, id)
          if (reservation.entityId !== entityId || reservation.epoch !== epoch) throw new Error('Simulation token reservation belongs to another writer')
          return await this.settleTokens(id, accepted)
        }, 'retirement')
      },
      entityId, epoch, priorCoordinatorExited,
      startDecision: (id, now) => {
        const startedAt = simulationWallTimeSchema.parse(now)
        return this.enqueue(async () => {
          await authorize()
          const decision = owned(id)
          if (decision.inference !== undefined) return structuredClone(decision.inference)
          await this.commitBusiness([{ kind: 'decision/started', id, startedAt }])
          return structuredClone(owned(id).inference as NonNullable<SimulationDecision['inference']>)
        })
      },
      expireDecision: (id, now) => {
        const expiredAt = simulationWallTimeSchema.parse(now)
        return this.enqueue(async () => {
          const decision = owned(id)
          if (decision.status !== 'open' || decision.inference === undefined || expiredAt < decision.inference.deadline) {
            return structuredClone(decision)
          }
          await this.commitBusiness([{ kind: 'decision/expired', id, expiredAt }])
          return structuredClone(owned(id))
        })
      },
      bindDecisionAdmission: (guard) => {
        if (admission.state !== 'unconfigured') throw new Error('Simulation decision admission is already bound or closed')
        admission = { state: 'open', authorize: guard }
        this.windowAdmissions.set(entityId, { epoch, authorize })
      },
      openDecision: (id, expectedRevision, wakeId) => this.enqueue(async () => {
        await authorize()
        if (Object.hasOwn(this.state.decisions, id)) return structuredClone(owned(id))
        this.assertRevision(expectedRevision)
        const entity = requireWriterEpoch(this.state, entityId, epoch)
        await this.commitBusiness([{ kind: 'decision/opened', id, entityId, epoch,
          slot: this.state.nextDecisionSlot, snapshotRevision: this.state.revision, entityRevision: entity.revision,
          ...wakeId === undefined ? {} : { wakeId } }])
        return structuredClone(owned(id))
      }),
      prepareContext: (id, request) => {
        const parsed = simulationContextRequestSchema.parse(request)
        return this.enqueue(async () => {
          await authorize()
          const decision = owned(id)
          const entity = requireWriterEpoch(this.state, entityId, epoch)
          if (decision.status !== 'open' || !currentDecision(this.state, decision) || entity.phase !== 'active'
            || entity.revision !== decision.entityRevision
            || this.state.phase !== 'running' && decision.context?.status !== 'overflow') throw new Error('Simulation context decision is no longer current')
          if (decision.context !== undefined) {
            if (decision.context.fingerprint !== businessFingerprint(parsed)) throw new Error('Simulation context retry changed its candidates or policy')
            return structuredClone(decision.context)
          }
          await this.commitBusiness([{ kind: 'decision/context', id, request: parsed }])
          return structuredClone(owned(id).context as SimulationContextPreparation)
        })
      },
      readPreparedContext: id => this.enqueue(async () => {
        await authorize()
        const decision = owned(id)
        const entity = requireWriterEpoch(this.state, entityId, epoch)
        if (this.state.phase !== 'running' || decision.status !== 'open' || !currentDecision(this.state, decision)
          || entity.phase !== 'active' || entity.revision !== decision.entityRevision || decision.context?.status !== 'prepared') {
          throw new Error('Simulation inference requires its current prepared context')
        }
        assertKnowledgeAccess(this.state, decision)
        return structuredClone(decision.context)
      }),
      submitDecision: (id, proposals) => {
        const parsed = z.array(simulationProposalSchema).parse(proposals)
        return this.enqueue(async () => {
          await authorize()
          const decision = owned(id)
          if (decision.status !== 'accepted') assertKnowledgeAccess(this.state, decision)
          const finishedAt = decision.status === 'open' && decision.inference !== undefined ? Date.now() : undefined
          if (finishedAt !== undefined && decision.inference !== undefined && finishedAt >= decision.inference.deadline) {
            await this.commitBusiness([{ kind: 'decision/expired', id, expiredAt: finishedAt }])
            return structuredClone(owned(id))
          }
          if (decision.windowId !== undefined && decision.status !== 'accepted') {
            if (decision.status === 'submitted') {
              if (!isDeepStrictEqual(decision.submission, parsed)) throw new Error('Simulation submitted proposal changed its payload')
              return structuredClone(decision)
            }
            await this.commitBusiness([
              ...finishedAt === undefined ? [] : [{ kind: 'decision/finished' as const, id, finishedAt }],
              { kind: 'decision/submitted', id, proposals: parsed },
            ])
            return structuredClone(owned(id))
          }
          const records = acceptanceRecords(this.state, decision, parsed)
          const accepted = records[0] as Extract<BusinessRecord, { kind: 'decision/accepted' }>
          if (decision.status === 'accepted') {
            if (decision.fingerprint !== accepted.fingerprint) throw new Error('Simulation decision id was reused with a different payload')
            return structuredClone(decision)
          }
          await this.acceptDecision(decision, parsed, finishedAt)
          return structuredClone(owned(id))
        })
      },
      cancelDecision: id => this.enqueue(async () => {
        const decision = owned(id)
        if (decision.status === 'cancelled') return structuredClone(decision)
        await this.commitBusiness([{ kind: 'decision/cancelled', id }])
        return structuredClone(owned(id))
      }),
      activate: (activation) => {
        const accepted = simulationWriterActivationSchema.parse(activation)
        return this.enqueue(async () => {
          const entity = requireWriterEpoch(this.state, entityId, epoch)
          if (priorCoordinatorExited) throw new Error('A recovered writer cannot authorize a new activation')
          assertWriterActivation(entity, accepted)
          if (entity.writer?.phase === 'active') return
          await this.commitWriter({ kind: 'writer/activated', entityId, epoch, activation: accepted })
        })
      },
      revoke: () => {
        admission = { state: 'closed' }
        if (this.windowAdmissions.get(entityId)?.epoch === epoch) this.windowAdmissions.delete(entityId)
        return this.enqueue(async () => {
          const entity = requireWriterEpoch(this.state, entityId, epoch)
          if (entity.writer?.phase === 'revoked' || entity.writer?.phase === 'released') return
          await this.commitWriter({ kind: 'writer/revoked', entityId, epoch })
        }, 'retirement')
      },
      release: () => this.enqueue(async () => {
        const entity = requireWriterEpoch(this.state, entityId, epoch)
        const writer = entity.writer as SimulationWriter
        if (writer.phase === 'released') return
        await this.commitWriter({ kind: 'writer/released', entityId, epoch,
          ...writer.activationId === undefined ? {} : { activationId: writer.activationId } })
      }, 'retirement'),
    }
  }

  private commitWriter(change: WriterChange): Promise<void> {
    return this.commit({ kind: 'run/writer', runId: this.state.spec.runId, expectedRevision: this.state.revision, change })
  }

  private commitBusiness(changes: readonly BusinessRecord[]): Promise<void> {
    return this.commitDomain(changes.map(change => ({ kind: 'run/business', change })))
  }

  private commitOutbox(changes: readonly OutboxRecord[]): Promise<void> {
    return this.commitDomain(changes.map(change => ({ kind: 'run/outbox', change })))
  }

  private commitScheduler(changes: readonly SchedulerRecord[]): Promise<void> {
    return this.commitDomain(changes.map(change => ({ kind: 'run/scheduler', change })))
  }

  private commitDomain(
    changes: readonly { kind: string; change: BusinessRecord | SchedulerRecord | OutboxRecord }[],
  ): Promise<void> {
    return this.commitValues(changes.map((entry, index) => ({ ...entry, runId: this.state.spec.runId,
      expectedRevision: this.state.revision + index })))
  }

  private assertRevision(expectedRevision: number): void {
    if (expectedRevision !== this.state.revision) throw new Error('Simulation revision conflict')
  }

  private commit(value: unknown): Promise<void> { return this.commitValues([value]) }

  private async commitValues(values: readonly unknown[]): Promise<void> {
    const next = foldEntries(this.state, values.map((value, index) => ({ sequence: this.state.revision + index + 1, value })),
      this.state.spec, this.backend)
    assertWriterProjection(next)
    assertBusinessProjection(next)
    assertSchedulerProjection(next)
    const previousRevision = this.state.revision
    const result = await this.stream.append(previousRevision, values)
    this.state = next
    this.committed(this.snapshot(), result.tailSequence, previousRevision)
  }

  private enqueue<T>(action: () => T | Promise<T>, mode: 'mutation' | 'retirement' | 'read' | 'checkpoint' = 'mutation'): Promise<T> {
    if (this.closing && mode !== 'retirement') return Promise.reject(new Error('Simulation run is closed'))
    if (this.checkpointBarrier !== undefined && mode !== 'read' && mode !== 'checkpoint'
      && (mode !== 'retirement' || this.checkpointBarrier.phase === 'sealed')) {
      return Promise.reject(new Error('Simulation checkpoint cut blocks new writes'))
    }
    if (mode !== 'read') this.inspectionOnly = false
    const operation = this.work.then(async () => {
      try { return await action() }
      catch (error) {
        if (error instanceof SimulationCapacityExceeded) {
          const requested = error.used + error.requested - queueUsage(this.state)[error.capacity].used
          await this.commitBusiness([{ kind: 'capacity/exhausted', capacity: error.capacity, requested }])
        }
        if (error instanceof SimulationBudgetExceeded) {
          await this.commitBusiness([{ kind: 'budget/exhausted', budget: error.budget, requested: error.requested }])
        }
        throw error
      }
    })
    // Each caller receives its write failure; the queue continues admitting later commands.
    this.work = operation.then(() => undefined, () => undefined)
    return operation
  }

  onClose(retire: () => Promise<void>): () => void {
    if (this.closing || this.retirement !== undefined) throw new Error('Simulation run already has a retirement owner or is closing')
    this.inspectionOnly = false
    this.retirement = retire
    return () => { if (this.retirement === retire) this.retirement = undefined }
  }

  close(): Promise<void> {
    if (this.checkpointBarrier !== undefined) return Promise.reject(new Error('Release the Simulation checkpoint cut before closing'))
    this.closing = true
    this.disposal ??= (async () => {
      await this.retirement?.()
      await Promise.allSettled([...this.dispatches.values()])
      await this.work
      // A replay-only handle has admitted no activation or recovery work and owns no live writer.
      if (!this.inspectionOnly && Object.values(this.state.entities).some(entity => entity.writer !== undefined && entity.writer.phase !== 'released')) {
        throw new Error('Simulation run retains a writer without confirmed quiescence')
      }
      await this.release()
    })().catch((error: unknown) => {
      this.disposal = undefined
      throw error
    })
    return this.disposal
  }
}
