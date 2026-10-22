import { controlObservation } from './control-observation.ts'
import { foldRunControl, runControlRecordSchema, assertRunControlAdmission, assertRunControlProjection,
  assertRunControlRequest, assertRunControlTime } from './run-control.ts'
import { simulationRunControlCommandSchema, SimulationStopBoundaryError } from '@clocky/clocky-simulation'
import { simulationDriverObservationSchema } from '@clocky/clocky-simulation'
import { SimulationCommunicationError } from '@clocky/clocky-simulation'
import { simulationFederationTimeSchema, simulationRequestBudgetBlockSchema } from '@clocky/clocky-simulation'
import { validateTokenRecovery } from './management.ts'
import { assertFederationTime } from './federation-time.ts'
import { simulationExperimentInitSchema } from '@clocky/clocky-simulation'
import { localObjectFallback, localObjectTarget } from './world-local-object.ts'
import { captureLogArchive } from '@clocky/clocky-storage'
import { simulationGenerationTransitionSchema, generationRecordAt } from '@clocky/clocky-simulation'
import { foldGeneration } from './world-generation.ts'
import { foldCalendarCommand, assertCalendarCommands } from './world-calendar-command.ts'
import { simulationCalendarCommandSchema } from '@clocky/clocky-simulation'
import { hiringMarketReservationAuthorized } from '@clocky/clocky-simulation'
import { foldCalendarRevision } from './world-calendar.ts'
import { simulationCalendarRevisionRequestSchema } from '@clocky/clocky-simulation'
import { previewWorldManagement, prepareWorldManagement, inspectWorldManagement } from './world-management.ts'
import { worldExecutionRequestSchema, worldExecutionObservationSchema, governanceEarlyClosure } from '@clocky/clocky-simulation'
import { sameWorldExecution } from './world-execution.ts'
import { parseSimulationWorldSchema } from '@clocky/clocky-simulation'
import { simulationEventIdSchema } from '@clocky/clocky-simulation'
import { worldEvidenceDeadlineRecords, assertWorldEvidenceDeadlineProjection } from './world-evidence-deadline.ts'
import { prepareWorldEvidenceChallenge, prepareWorldEvidenceRevision, foldWorldEvidence,
  worldEvidenceExhaustionRecords } from './world-evidence.ts'
import type { WorldEvidenceRecord } from './world-evidence.ts'
import { assertWorldMutationSlot, assertWorldBirthBudget } from './world-structure-budget.ts'
import { simulationWorldBootstrapRequestSchema } from '@clocky/clocky-simulation'
import { assertWorldBootstrapProjection } from './world-bootstrap.ts'
import { assertSimulationWorldPreparationAdmission } from '@clocky/clocky-simulation'
import { foldExternalRepresentative, requireExternalActorApplication, requireExternalRepresentative,
  assertExternalRepresentativeProjection, externalRepresentativeFor, assertExternalRepresentativeCancellationAdmission,
  assertExternalContactCancellationAdmission } from './world-external-actor.ts'
import { assertExternalProjection } from './world-external.ts'
import { foldPersonnel, assertPersonnelProjection, settlesOwnReference } from './world-personnel.ts'
import { worldExecutionTimeRecords, assertWorldExecutionTimeProjection } from './world-execution-time.ts'
import { scenarioRequestRecords } from './world-director-event.ts'
import { PersonnelDomainError, worldIntentIdSchema } from '@clocky/clocky-simulation'
import { preparePersonnelReservation } from './world-personnel.ts'
import { personnelReserveRequestSchema, personnelAuthorityGeneration, personnelRetired } from '@clocky/clocky-simulation'
import { inspectPersonnelObligations } from './personnel-obligations.ts'
import { foldWorldMutation, prepareWorldMutationRecord } from './world-mutation.ts'
import { assertNormProjection } from './world-norms.ts'
import { projectNorms } from '@clocky/clocky-simulation'
import { normAnnouncementRecords, normBoundaryRecords, assertNormAnnouncementProjection } from './world-norm-announcement.ts'
import { externalAdjudicatedEventRecords, externalAdjudicatedResultWakeRecords,
  assertExternalAdjudicatedEventSource, assertExternalAdjudicatedEventProjection } from './world-external-mediated-event.ts'
import { prepareExternalAdjudicatedEventConsumption, prepareExternalRepresentativeAdjudication,
  assertExternalAdjudicationProjection } from './world-external-mediated.ts'
import { WORLD_EXTERNAL_MEDIATED_PIN } from '@clocky/clocky-simulation'
import { requireHireApproval } from './world-hire-approval.ts'
import { SimulationHireApprovalError, worldPlanIdSchema } from '@clocky/clocky-simulation'
import { governanceDeadlineRecords, governanceDeadlineCancellation,
  assertGovernanceDeadlineProjection } from './world-governance-deadline.ts'
import { prepareGovernanceClose, foldWorldGovernance, governanceResolutionWakeRecords,
  assertWorldGovernanceProjection } from './world-governance.ts'
import { worldProposalIdSchema } from '@clocky/clocky-simulation'
import { originalWorldFact, worldFactInput, worldFactOwner, assertWorldFactsProjection } from './world-facts.ts'
import { simulationWorldFactRequestSchema, simulationWorldFactVersionSchema, projectWorldFacts,
  SimulationWorldFactError } from '@clocky/clocky-simulation'
import { simulationWorldMutationCommitRequestSchema, worldMutationIdSchema } from '@clocky/clocky-simulation'
import type { NativeWorldRuntime } from './world-runtime.ts'
import { requireWorldRuntime } from './world-runtime.ts'
import { simulationWorldRequestOperationSchema } from '@clocky/clocky-simulation'
import { SimulationDecisionPausedError, SimulationRevisionConflictError } from '@clocky/clocky-simulation'
import { canCancelDecisionForPause } from './decisions.ts'
import { createWorldIntent, assertWorldAdmission, expandWorldProposals, foldWorld, worldResultIdentity, requireWorld,
  worldPlanStaleReason } from './world.ts'
import { requireWorldHire, requireWorldHireApplication, foldWorldHire, assertWorldHireCancellationAdmission } from './world-hire.ts'
import { prepareHiringResourceReservation, hiringResourceSchedulerRecords, foldExistingHireResources,
  hiringResourceReservationId } from './world-hiring-resources.ts'
import { WORLD_HIRE_EXISTING_PIN } from '@clocky/clocky-simulation'
import { simulationExternalActorRequestSchema, simulationExternalContactSchema, simulationExternalContactCleanupEvidenceSchema,
  simulationWorldHireReserveRequestSchema,
  simulationEntityIdSchema, simulationRelationIdSchema,
  simulationChannelKeySchema, simulationWorldIdentityCleanupEvidenceSchema } from '@clocky/clocky-simulation'
import { worldResultWakeRecords, worldFirstActionWakeRecords, foldSchedulerRecord } from './scheduler.ts'
import { simulationWorldCancelRequestSchema } from '@clocky/clocky-simulation'
import { simulationWorldDefinitionSchema, SimulationWorldError } from '@clocky/clocky-simulation'
import { simulationContextConsumptionSchema } from '@clocky/clocky-simulation'
import { simulationModelAdmissionBlockSchema } from '@clocky/clocky-simulation'
import { simulationModelPoolUsageSchema } from '@clocky/clocky-simulation'
import { simulationActivationAdmissionRequestSchema } from '@clocky/clocky-simulation'
import { simulationWorldSubmissionFailureSchema, simulationWorldSubmissionHash } from '@clocky/clocky-simulation'
import { assertMaintenanceProjection } from './maintenance.ts'
import { activeSimulationMaintenance, assertSimulationMaintenanceAdmission, simulationMaintenanceRequestSchema,
  SimulationMaintenanceError } from '@clocky/clocky-simulation'
import type { SimulationMaintenanceRequest, SimulationMaintenanceOperation } from '@clocky/clocky-simulation'
import { simulationResidentSlots } from '@clocky/clocky-simulation'
import { simulationOutboxRetryRequestSchema } from '@clocky/clocky-simulation'
import { simulationTaskResultRequestSchema } from '@clocky/clocky-simulation'
import { simulationTaskDecisionRequestSchema, simulationTaskInputReceiptSchema } from '@clocky/clocky-simulation'
import { simulationTaskExecutionRequestSchema, simulationTaskExecutionObservationSchema,
  simulationTaskExecutionRetirementSchema } from '@clocky/clocky-simulation'
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
import { simulationCompactionTokenRequestSchema, simulationTokenUsageSchema, simulationTokenRequestSchema,
  simulationTokenOutcomeSchema } from '@clocky/clocky-simulation'
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
import type { SimulationWindow, SimulationWindowId, SimulationWindowRequest, SimulationDecision,
  SimulationProposal } from '@clocky/clocky-simulation'
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
import { simulationChangeSchema, simulationCoordinatorIdSchema, simulationEntityBindingSchema, simulationWriterActivationSchema,
  simulationWriterEpochSchema, simulationWriterReservationSchema, simulationProposalSchema, simulationResourceSpecSchema,
  simulationWakeRequestSchema, simulationDriveRequestSchema, parseSimTime, simulationWallTimeSchema } from '@clocky/clocky-simulation'
import type { SimTime, SimulationChange, SimulationEntityBinding, SimulationEntityId, SimulationRelation, SimulationRun,
  SimulationSnapshot, SimulationWriter, SimulationWriterActivation, SimulationWriterEpoch, SimulationWriterLease,
  SimulationWriterReservation } from '@clocky/clocky-simulation'
import { foldEntry, foldEntries } from './journal.ts'
import { selectRelations } from './entities.ts'
import { assertWriterProjection, assertWriterActivation, requireCognitionEntity, requireWriterEpoch } from './writers.ts'
import type { WriterChange } from './writers.ts'
import type { SimulationDecisionId, SimulationOperation, SimulationOperationId, SimulationOperationResult,
  SimulationResourceSpec } from '@clocky/clocky-simulation'
import { acceptanceRecords, assertBusinessProjection, assertDecisionOwner, requireDecision, nextLocalOperation } from './decisions.ts'
import type { BusinessRecord } from './decisions.ts'
import { computeOperation } from './business.ts'
import { allocateEventKey, assertSchedulerProjection, nextScheduledEvent, canCollectDecisionEvent, schedulerConsequences,
  outboxScheduleRecords } from './scheduler.ts'
import type { SchedulerRecord } from './scheduler.ts'
import { dependenciesReady, dependencyFailed, requireOutbox } from './outbox.ts'
import type { OutboxRecord } from './outbox.ts'
import type { SimulationDispatchResult, SimulationTeamTransport } from '@clocky/clocky-simulation'
import { foldBusinessRecord } from './decisions.ts'
import type { SimulationDriveRequest, SimulationDriveResult, SimulationEventId, SimulationWakeRequest } from '@clocky/clocky-simulation'

/** Internal run handle retaining its medium and process lock until successful cleanup. */
export class LocalSimulationRun implements SimulationRun {
  initializeBranch(request: import('@clocky/clocky-simulation').SimulationExperimentInit): Promise<SimulationSnapshot> {
    const accepted = simulationExperimentInitSchema.parse(request)
    return this.enqueue(async () => {
      if (this.state.experiment !== undefined) {
        if (!isDeepStrictEqual(this.state.experiment, accepted)) throw new Error('Branch retry changed immutable provenance')
        return this.snapshot()
      }
      await this.commit({ kind: 'run/branch-init', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, request: accepted })
      return this.snapshot()
    })
  }

  private readonly personnelCommitAuthorities = new Map<string, (proof: import('@clocky/clocky-simulation').PersonnelCommitProof) =>
    import('@clocky/clocky-simulation').PersonnelCommitEvidence | undefined>()
  recordActivationAdmissionBlock(request: import('@clocky/clocky-simulation').SimulationActivationAdmissionRequest):
  Promise<import('@clocky/clocky-simulation').SimulationActivationAdmissionBlock> {
    const accepted = simulationActivationAdmissionRequestSchema.parse(request)
    return this.enqueue(async () => {
      const original = this.state.activationAdmissionBlocks?.find(value => value.entityId === accepted.entityId)
      if (original !== undefined) {
        if (!isDeepStrictEqual(original.details,
          accepted.details)) throw new Error('Simulation Activation history refusal changed on retry')
        return structuredClone(original)
      }
      const writer = this.state.entities[accepted.entityId]?.writer
      if (writer === undefined) throw new Error('Simulation Activation history refusal has no retained writer')
      await this.commitBusiness([{ kind: 'activation/history-blocked', request: accepted, epoch: writer.epoch }])
      const block = this.state.activationAdmissionBlocks?.at(-1)
      if (block === undefined) throw new Error('Simulation Activation history refusal was not retained')
      return structuredClone(block)
    })
  }
  private readonly windowAdmissions = new Map<SimulationEntityId, { epoch: SimulationWriterEpoch; authorize: () => Promise<void> }>()
  private readonly coordinatorId = simulationCoordinatorIdSchema.parse(randomUUID())
  private readonly dispatches = new Map<SimulationOperationId, Promise<SimulationDispatchResult>>()
  private work: Promise<unknown> = Promise.resolve()
  private retirement: (() => Promise<void>) | undefined
  private worldHireCleanup: {
    readonly owner: string
    readonly verify: (reservation: import('@clocky/clocky-simulation').SimulationWorldHireReservation) =>
    Promise<import('@clocky/clocky-simulation').SimulationWorldIdentityCleanupEvidence>
  } | undefined
  private externalRepresentativeCleanup: {
    readonly owner: string
    readonly verify: (reservation: import('@clocky/clocky-simulation').SimulationExternalRepresentativeReservation) =>
    Promise<import('@clocky/clocky-simulation').SimulationWorldIdentityCleanupEvidence>
  } | undefined
  private externalContactCleanup: {
    readonly owner: string
    readonly verify: (reservation: import('@clocky/clocky-simulation').SimulationExternalContact) =>
    Promise<import('@clocky/clocky-simulation').SimulationExternalContactCleanupEvidence>
  } | undefined
  private checkpointBarrier: { readonly token: symbol; phase: 'draining' | 'sealed' } | undefined
  private inspectionOnly = true
  private closing = false
  private disposal: Promise<void> | undefined

  retryRunControlCheckpoint(commandId: string, previousCheckpointId: string, nextCheckpointId: string,
    authorize: () => void = () => {}): Promise<import('@clocky/clocky-simulation').SimulationRunControlState> {
    const change = runControlRecordSchema.parse({ kind: 'control/checkpoint-retry', commandId, previousCheckpointId, nextCheckpointId })
    return this.enqueue(async () => {
      authorize()
      const current = this.state.runControl?.current
      if (current?.commandId === commandId && current.checkpointId === nextCheckpointId
        && current.checkpointAttempts.at(-2) === previousCheckpointId) return structuredClone(current)
      await this.commit({ kind: 'run/control', runId: this.state.spec.runId, expectedRevision: this.state.revision, change })
      const recorded = this.state.runControl
      if (recorded === undefined) throw new Error('Committed stopping checkpoint retry is missing')
      return structuredClone(recorded.current)
    }, 'control')
  }

  recordRunControlCheckpoint(commandId: string, checkpointId: string,
    status: 'completed' | 'failed' | 'external-state-required', authorize: () => void = () => {}):
  Promise<import('@clocky/clocky-simulation').SimulationRunControlState> {
    const change = runControlRecordSchema.parse({ kind: 'control/checkpoint', commandId, checkpointId, status })
    return this.enqueue(async () => {
      authorize()
      const current = this.state.runControl?.current
      if (current?.commandId === commandId && current.checkpointId === checkpointId && current.checkpoint === status)
        return structuredClone(current)
      await this.commit({ kind: 'run/control', runId: this.state.spec.runId, expectedRevision: this.state.revision, change })
      const recorded = this.state.runControl
      if (recorded === undefined) throw new Error('Committed stopping control is missing')
      return structuredClone(recorded.current)
    }, 'control')
  }

  private async expireDrainBudget(): Promise<void> {
    const control = this.state.runControl?.current
    if (control?.state !== 'draining' || control.target === null || control.cut === null
      || Date.now() - control.cut.recordedAt < control.target.drainBudget.maxWallTimeMs) return
    await this.commit({ kind: 'run/control', runId: this.state.spec.runId, expectedRevision: this.state.revision,
      change: { kind: 'control/refresh', recordedAt: Date.now() } })
  }

  checkStopBoundary(request: import('@clocky/clocky-simulation').SimulationWorldDomainRequest,
    responsibility?: { readonly requestId: string }): void {
    assertRunControlRequest(this.state, request, this.worldRuntime, responsibility)
  }

  updateRunControl(command: import('@clocky/clocky-simulation').SimulationRunControlCommand, expectedRevision: number,
    authorize: () => void = () => {}): Promise<import('@clocky/clocky-simulation').SimulationRunControlReceipt> {
    const accepted = simulationRunControlCommandSchema.parse(command)
    return this.enqueue(async () => {
      authorize()
      const commands = this.state.runControl?.commands ?? {}
      const prior = Object.hasOwn(commands, accepted.commandId) ? commands[accepted.commandId] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.command, accepted)) throw new Error('Control command identity changed its input')
        return structuredClone(prior.receipt)
      }
      this.assertRevision(expectedRevision)
      const record = { kind: 'run/control', runId: this.state.spec.runId, expectedRevision,
        change: { kind: 'control/update', command: accepted, recordedAt: Date.now() } }
      try { await this.commit(record) }
      catch (cause) {
        if (cause instanceof SimulationStopBoundaryError && this.state.phase !== 'paused') {
          await this.commit({ kind: 'run/phase', runId: this.state.spec.runId,
            expectedRevision: this.state.revision, phase: 'paused' })
        }
        throw cause
      }
      const recorded = this.state.runControl?.commands[accepted.commandId]
      if (recorded === undefined) throw new Error('Committed stopping command receipt is missing')
      return structuredClone(recorded.receipt)
    }, 'control')
  }

  worldPayloadSchema(pin: import('@clocky/clocky-simulation').SimulationWorldDomainPin,
    kind: 'request' | 'plan'): import('zod').z.ZodType {
    return requireWorldRuntime(this.worldRuntime).payloadSchema(pin, kind)
  }

  constructor(
    private readonly stream: LogStream,
    private state: SimulationSnapshot,
    private readonly backend: 'json' | 'sqlite',
    private readonly release: () => Promise<void>,
    private readonly committed: (snapshot: SimulationSnapshot, durableTail: number, previousRevision?: number) => void,
    private readonly worldRuntime?: NativeWorldRuntime,
  ) {
    assertRunControlProjection(state)
    assertMaintenanceProjection(state); assertWriterProjection(state); assertBusinessProjection(state, this.worldRuntime)
    assertSchedulerProjection(state, this.worldRuntime); assertWorldFactsProjection(state); assertWorldGovernanceProjection(state)
    assertCalendarCommands(state)
    assertGovernanceDeadlineProjection(state)
    assertNormAnnouncementProjection(state)
    assertNormProjection(state)
    assertExternalProjection(state)
    assertExternalAdjudicationProjection(state)
    assertExternalRepresentativeProjection(state)
    assertWorldExecutionTimeProjection(state)
    assertExternalAdjudicatedEventProjection(state)
    assertPersonnelProjection(state)
  }

  private federationTimeAuthority: symbol | undefined
  bindFederationTime(ownerId: string, resolve: () => import('@clocky/clocky-simulation').SimulationFederationTime | undefined): import('@clocky/clocky-simulation').SimulationFederationTimeBinding {
    if (this.closing || this.federationTimeAuthority || (this.state.federationTime && this.state.federationTime.ownerId !== ownerId)) throw new Error('Federation Native time authority unavailable')
    const token = Symbol(ownerId); this.federationTimeAuthority = token
    return {
      sync: () => this.enqueue(async () => {
        if (this.federationTimeAuthority !== token) throw new Error('Federation Native time authority retired')
        const evidence = simulationFederationTimeSchema.parse(resolve())
        if (evidence.ownerId !== ownerId) throw new Error('Federation Native time owner changed')
        await this.commit({ kind: 'run/federation-time', runId: this.state.spec.runId, expectedRevision: this.state.revision, evidence })
        return this.snapshot()
      }),
      dispose: () => { if (this.federationTimeAuthority === token) this.federationTimeAuthority = undefined },
    }
  }

  onPersonnelCommitAuthority(owner: string, resolve: (proof: import('@clocky/clocky-simulation').PersonnelCommitProof) =>
    import('@clocky/clocky-simulation').PersonnelCommitEvidence | undefined): () => void {
    if (this.closing || this.state.teamReservation?.confirmed !== true
      || owner !== this.state.teamReservation.creation.rules['activationLifecycleOwner'])
      throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY',
        'Personnel commit source requires the original admitted canonical lifecycle owner')
    if (this.personnelCommitAuthorities.has(owner)) throw new Error('Personnel commit owner is already registered')
    this.personnelCommitAuthorities.set(owner, resolve)
    return () => { if (this.personnelCommitAuthorities.get(owner) === resolve) this.personnelCommitAuthorities.delete(owner) }
  }

  commitPersonnel(id: import('@clocky/clocky-simulation').WorldIntentId,
    proof: import('@clocky/clocky-simulation').PersonnelCommitProof): Promise<import('@clocky/clocky-simulation').SimulationWorldResult> {
    const accepted = worldIntentIdSchema.parse(id)
    return this.enqueue(async () => {
      const world = requireWorld(this.state), reservation = world.personnel.reservations[accepted]
      if (reservation === undefined) throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel original reservation is missing')
      const prior = world.results[worldResultIdentity(accepted)]
      if (reservation.status === 'committed' && prior !== undefined) return structuredClone(prior)
      await this.revalidateWorldPlan(reservation.request.planId)
      const source = this.personnelCommitAuthorities.get(reservation.request.maintenance.owner)?.(proof)
      const report = source?.report
      if (source?.reservationId !== accepted || report?.runId !== this.state.spec.runId || report.cursor !== this.state.revision
        || report.selector.kind !== 'assignment' || report.selector.personId !== reservation.personId
        || report.selector.personRevision !== this.state.entities[reservation.personId]?.revision
        || report.selector.assignmentId !== reservation.assignmentId
        || report.selector.assignmentRevision !== reservation.assignmentRevision) {
        throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY', 'Personnel commit requires its live original held Team/channel cut proof')
      }
      if (!report.complete || report.status !== 'covered' || report.items.some(item => !settlesOwnReference(reservation, item.ref)))
        throw new PersonnelDomainError('SIM_PERSONNEL_HANDOFF_REQUIRED', 'Original held personnel source cut retains unresolved duties')
      const ready = { kind: 'personnel/ready' as const, id: accepted, team: report.coverage.team, terminalTasks: [...source.terminalTasks] }
      let projected = { ...foldPersonnel(this.state, ready, this.state.revision + 1, requireWorldRuntime(this.worldRuntime)),
        revision: this.state.revision + 1 }
      const plan = world.plans[reservation.request.planId]
      if (plan?.proposal.resolution.kind !== 'apply')
        throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel original apply plan is missing')
      const mutation = { kind: 'world/mutation' as const, mutation: { kind: 'world/mutation' as const,
        id: worldMutationIdSchema.parse(`world-mutation:${plan.id}`), requestId: plan.requestId, planId: plan.id, pin: plan.pin,
        payload: plan.proposal.resolution.payload, time: this.state.time, recordedAt: Date.now(), sequence: projected.revision + 1 } }
      const records: unknown[] = [{ kind: 'run/personnel', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, change: ready },
      { kind: 'run/world-mutation', runId: this.state.spec.runId, expectedRevision: projected.revision, change: mutation }]
      projected = { ...foldWorldMutation(projected, mutation, projected.revision + 1, this.worldRuntime), revision: projected.revision + 1 }
      const result = requireWorld(projected).results[worldResultIdentity(accepted)]
      if (result === undefined) throw new Error('Personnel mutation lost its atomic original result')
      for (const event of worldFirstActionWakeRecords(projected, result, this.worldRuntime)) {
        records.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      for (const event of worldResultWakeRecords(projected, result, this.worldRuntime)) {
        records.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      if (Buffer.byteLength(JSON.stringify(records), 'utf8') > world.definition.limits.maxBytesPerPlan)
        throw new SimulationWorldError('SIM_WORLD_LIMIT',
          'Personnel complete atomic records exceed the original plan envelope allowance', 'bytes')
      await this.commitValues(records)
      return structuredClone(result)
    })
  }

  reservePersonnel(request: import('@clocky/clocky-simulation').PersonnelReserveRequest):
  Promise<import('@clocky/clocky-simulation').PersonnelReservation> {
    const accepted = personnelReserveRequestSchema.parse(request)
    return this.enqueue(async () => {
      const world = requireWorld(this.state), plan = world.plans[accepted.planId]
      const originalRequest = plan === undefined ? undefined : world.requests[plan.requestId]
      const prior = originalRequest === undefined ? undefined : world.personnel.reservations[originalRequest.intentId]
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted))
          throw new Error('Personnel reservation retry changed its original maintenance or plan')
        return structuredClone(prior)
      }
      await this.revalidateWorldPlan(accepted.planId)
      const reservation = preparePersonnelReservation(this.state, accepted, this.state.revision + 1, requireWorldRuntime(this.worldRuntime))
      const existingFence = world.personnel.fences[reservation.id]
      const fence = { assignmentId: reservation.assignmentId, personId: reservation.personId,
        intentId: reservation.id, requestId: reservation.requestId,
        generation: personnelAuthorityGeneration(this.state, reservation.personId) + 1,
        sequence: this.state.revision + 2, status: 'active' as const }
      await this.commitValues([
        { kind: 'run/personnel', runId: this.state.spec.runId, expectedRevision: this.state.revision,
          change: { kind: 'personnel/reserved', reservation } },
        ...existingFence?.status === 'active' && existingFence.intentId === reservation.id ? []
          : [{ kind: 'run/personnel', runId: this.state.spec.runId, expectedRevision: this.state.revision + 1,
            change: { kind: 'personnel/fenced', fence } }],
      ])
      const retained = requireWorld(this.state).personnel.reservations[reservation.id]
      if (retained === undefined) throw new Error('Personnel reservation lost its atomic fence')
      return structuredClone(retained)
    })
  }

  inspectPersonnelObligations(request: import('@clocky/clocky-simulation').PersonnelObligationQuery):
  import('@clocky/clocky-simulation').PersonnelObligationReport {
    return inspectPersonnelObligations(this.state, request, this.worldRuntime)
  }

  settlePersonnelCancellation(id: import('@clocky/clocky-simulation').WorldIntentId):
  Promise<import('@clocky/clocky-simulation').SimulationWorldResult> {
    const accepted = worldIntentIdSchema.parse(id)
    return this.enqueue(async () => {
      const world = requireWorld(this.state), prior = world.results[worldResultIdentity(accepted)]
      if (prior !== undefined && world.personnel.reservations[accepted]?.status === 'cancelled') return structuredClone(prior)
      const change = { kind: 'personnel/cancelled' as const, id: accepted }
      let projected = { ...foldPersonnel(this.state, change, this.state.revision + 1, requireWorldRuntime(this.worldRuntime)),
        revision: this.state.revision + 1 }
      const result = requireWorld(projected).results[worldResultIdentity(accepted)]
      if (result === undefined) throw new Error('Personnel cancellation lost its atomic original result')
      const records: unknown[] = [{ kind: 'run/personnel', runId: this.state.spec.runId, expectedRevision: this.state.revision, change }]
      for (const event of worldResultWakeRecords(projected, result, this.worldRuntime)) {
        records.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      if (Buffer.byteLength(JSON.stringify(records), 'utf8') > world.definition.limits.maxBytesPerPlan)
        throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Personnel cancellation batch exceeds its original envelope allowance', 'bytes')
      await this.commitValues(records)
      return structuredClone(result)
    }, 'retirement')
  }

  inspectWorldHireAuthorization(planId: import('@clocky/clocky-simulation').WorldPlanId):
  { readonly allowed: true } | { readonly allowed: false; readonly reason: 'approval-required' | 'plan-stale' | 'authority-missing' } {
    const accepted = worldPlanIdSchema.parse(planId), world = requireWorld(this.state)
    const plan = world.plans[accepted], request = plan === undefined ? undefined : world.requests[plan.requestId]
    const intent = request === undefined ? undefined : world.intents[request.intentId]
    if (plan === undefined || intent === undefined || plan.status !== 'accepted' || request?.status !== 'open')
      return { allowed: false, reason: 'plan-stale' }
    try {
      requireHireApproval(this.state, intent, plan, world.reservations[intent.id]?.approvals)
      return { allowed: true }
    } catch (error) {
      if (!(error instanceof SimulationHireApprovalError)) throw error
      return { allowed: false, reason: error.code === 'SIM_HIRE_APPROVAL_REQUIRED' ? 'approval-required'
        : error.code === 'SIM_HIRE_APPROVAL_STALE' ? 'plan-stale' : 'authority-missing' }
    }
  }

  retainWorldCalendarCommand(request: import('@clocky/clocky-simulation').SimulationCalendarRevisionRequest,
    quoteRevision: number, quoteHash: string, principalId: string): Promise<import('@clocky/clocky-simulation').SimulationCalendarCommand> {
    const original = simulationCalendarCommandSchema.omit({ sequence: true, preview: true, cancelledAt: true }).parse({
      request, quoteRevision, quoteHash, principalId })
    return this.enqueue(async () => {
      const prior = this.state.worldBootstrap?.calendarCommands?.find(value => value.request.commandId === original.request.commandId)
      if (prior !== undefined) {
        const { cancelledAt: _cancelled, sequence: _sequence, preview: _preview, ...retained } = prior
        if (!isDeepStrictEqual(retained, original)) throw new Error('Retained calendar command changed its original author or quote')
        return structuredClone(prior)
      }
      this.assertRevision(quoteRevision)
      const { cancelled, queued } = this.previewWorldCalendar(original.request)
      const command = simulationCalendarCommandSchema.parse({ ...original, sequence: this.state.revision + 1,
        preview: { cancelled, queued } })
      const change = { kind: 'calendar-command/retained' as const, command }
      foldCalendarCommand(this.state, change, this.state.revision + 1)
      await this.commitValues([{ kind: 'run/calendar-command', runId: this.state.spec.runId, expectedRevision: this.state.revision, change }])
      return structuredClone(command)
    })
  }

  cancelWorldCalendarCommand(commandId: string, principalId: string): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      const command = this.state.worldBootstrap?.calendarCommands?.find(value => value.request.commandId === commandId)
      if (command === undefined || command.principalId !== principalId) throw new Error('Calendar command is unavailable to this author')
      if (command.cancelledAt !== undefined
        || this.state.worldBootstrap?.calendarRevisions?.some(value => value.request.commandId === commandId))
        return this.snapshot()
      const change = { kind: 'calendar-command/cancelled' as const, commandId, principalId }
      foldCalendarCommand(this.state, change, this.state.revision + 1)
      await this.commitValues([{ kind: 'run/calendar-command', runId: this.state.spec.runId, expectedRevision: this.state.revision, change }])
      return this.snapshot()
    })
  }

  previewWorldCalendar(request: ReturnType<typeof simulationCalendarRevisionRequestSchema.parse>) {
    const retained = this.state.worldBootstrap?.calendarRevisions?.find(value => value.request.commandId === request.commandId)
    if (retained !== undefined) {
      if (!isDeepStrictEqual(retained.request, request)) throw new Error('Calendar command identity has different original content')
      return { revision: this.state.revision, cancelled: [], queued: [] }
    }
    const projected = foldCalendarRevision(this.state, request, this.state.revision + 1)
    return { revision: this.state.revision,
      cancelled: Object.values(projected.scheduledEvents).filter(event => event.status === 'cancelled'
        && this.state.scheduledEvents[event.id]?.status === 'pending').map(event => event.id),
      queued: Object.values(projected.scheduledEvents).filter(event => this.state.scheduledEvents[event.id] === undefined)
        .map(event => ({ id: event.id, time: event.key.time })) }
  }

  reviseWorldCalendar(request: ReturnType<typeof simulationCalendarRevisionRequestSchema.parse>, expectedRevision: number,
    principalId?: string): Promise<SimulationSnapshot> {
    const accepted = simulationCalendarRevisionRequestSchema.parse(request)
    return this.enqueue(async () => {
      const retry = this.state.worldBootstrap?.calendarRevisions?.find(value => value.request.commandId === accepted.commandId)
      if (retry !== undefined) {
        if (!isDeepStrictEqual(retry.request, accepted) || retry.author.principalId !== (principalId ?? null))
          throw new Error('Calendar command identity has different original content or author')
        return this.snapshot()
      }
      const command = principalId === undefined ? undefined
        : this.state.worldBootstrap?.calendarCommands?.find(value => value.request.commandId === accepted.commandId)
      if (principalId !== undefined && (command === undefined || command.principalId !== principalId
        || command.cancelledAt !== undefined || command.quoteRevision !== expectedRevision
        || !isDeepStrictEqual(command.request, accepted)))
        throw new Error('Calendar execution requires its original retained authenticated quote')
      if (command === undefined) this.assertRevision(expectedRevision)
      const author = { kind: 'host' as const, principalId: principalId ?? null }
      foldCalendarRevision(this.state, accepted, this.state.revision + 1, author)
      await this.commitValues([{ kind: 'run/calendar-revision', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, request: accepted, author }])
      return this.snapshot()
    })
  }

  closeWorldGovernance(proposalId: import('@clocky/clocky-simulation').WorldProposalId):
  Promise<import('@clocky/clocky-simulation').SimulationGovernanceResolution>
  closeWorldGovernance(proposalId: import('@clocky/clocky-simulation').WorldProposalId, options: { readonly boundary: true }):
  Promise<import('@clocky/clocky-simulation').SimulationGovernanceResolution | undefined>
  closeWorldGovernance(proposalId: import('@clocky/clocky-simulation').WorldProposalId, options?: { readonly boundary: true }):
  Promise<import('@clocky/clocky-simulation').SimulationGovernanceResolution | undefined> {
    const accepted = worldProposalIdSchema.parse(proposalId)
    const boundary = options === undefined ? undefined : z.strictObject({ boundary: z.literal(true) }).parse(options)
    return this.enqueue(async () => {
      const world = requireWorld(this.state)
      const original = Object.values(world.governance.resolutions).find(value => value.proposalId === accepted)
      if (original !== undefined) return structuredClone(original)
      if (boundary !== undefined && governanceEarlyClosure(this.state, world.governance, accepted) === undefined) return undefined
      const resolution = prepareGovernanceClose(this.state, world.governance, accepted, this.state.revision + 1)
      const change = { kind: 'world/governance-closed' as const, resolution }
      if (Buffer.byteLength(JSON.stringify(change), 'utf8') > world.definition.limits.maxBytesPerPlan)
        throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Complete governance resolution exceeds its retained plan allowance', 'bytes')
      const governance = foldWorldGovernance(this.state, world.governance, change, this.state.revision + 1)
      let projected = { ...this.state, revision: this.state.revision + 1, world: { ...world, governance } }
      const records: unknown[] = [{ kind: 'run/world-governance', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, change }]
      for (const event of governanceResolutionWakeRecords(projected, governance, resolution)) {
        records.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime), revision: projected.revision + 1,
          world: projected.world }
      }
      for (const event of governanceDeadlineCancellation(projected, accepted)) {
        records.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime), revision: projected.revision + 1,
          world: projected.world }
      }
      await this.commitValues(records)
      return structuredClone(resolution)
    })
  }

  recordWorldFact(request: import('@clocky/clocky-simulation').SimulationWorldFactRequest):
  Promise<import('@clocky/clocky-simulation').SimulationWorldFact> {
    const accepted = simulationWorldFactRequestSchema.parse(request)
    return this.enqueue(async () => {
      const original = originalWorldFact(this.state, accepted.factId, accepted.version)
      if (original !== undefined) {
        if (!isDeepStrictEqual(worldFactInput(original), accepted)) {
          throw new SimulationWorldFactError('SIM_WORLD_FACT_VERSION', 'An existing fact version cannot change its original publication')
        }
        return structuredClone(original)
      }
      const { sources, ...fields } = accepted
      const fact = simulationWorldFactVersionSchema.parse({ ...fields, sequence: this.state.revision + 1, recordedAt: Date.now(),
        source: { kind: 'owner', owner: worldFactOwner(this.state), references: sources } })
      await this.commit({ kind: 'run/world-facts', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        change: { kind: 'world/fact-recorded', fact } })
      const retained = originalWorldFact(this.state, fact.factId, fact.version)
      if (retained === undefined)
        throw new SimulationWorldFactError('SIM_WORLD_FACT_INTEGRITY', 'Committed fact lost its original publication')
      return structuredClone(retained)
    })
  }

  queryWorldFacts(request: import('@clocky/clocky-simulation').SimulationWorldFactQuery):
  import('@clocky/clocky-simulation').SimulationWorldFactProjection {
    return structuredClone(projectWorldFacts(this.state, request))
  }

  queryWorldNorms(request: import('@clocky/clocky-simulation').SimulationNormQuery):
  import('@clocky/clocky-simulation').SimulationNormProjection {
    return structuredClone(projectNorms(this.state, request))
  }

  transitionGeneration(change: import('@clocky/clocky-simulation').SimulationGenerationTransition,
    authorize: (job: import('@clocky/clocky-simulation').SimulationGenerationJob) => void):
  Promise<import('@clocky/clocky-simulation').SimulationGenerationRecord> {
    const accepted = simulationGenerationTransitionSchema.parse(change)
    return this.enqueue(async () => {
      const id = accepted.kind === 'accept' ? accepted.job.id : accepted.id
      const prior = generationRecordAt(this.state, id)
      const job = accepted.kind === 'accept' ? accepted.job : prior?.job
      if (job === undefined) throw new Error('Generation job is not retained')
      authorize(structuredClone(job))
      if (accepted.kind === 'accept' && prior !== undefined) {
        if (!isDeepStrictEqual(prior.job, accepted.job)) throw new Error('Generation retry changed its original job')
        return structuredClone(prior)
      }
      const projected = foldGeneration(this.state, accepted, this.state.revision + 1, this.worldRuntime)
      if (prior !== undefined && isDeepStrictEqual(generationRecordAt(projected, id), prior)) return structuredClone(prior)
      authorize(structuredClone(job))
      await this.commit({ kind: 'run/generation', runId: this.state.spec.runId, expectedRevision: this.state.revision, change: accepted })
      const retained = generationRecordAt(this.state, id)
      if (retained === undefined) throw new Error('Generation append lost its original responsibility')
      return structuredClone(retained)
    })
  }

  configureWorld(definition: import('@clocky/clocky-simulation').SimulationWorldDefinition,
    expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = simulationWorldDefinitionSchema.parse(definition)
    return this.enqueue(async () => {
      if (this.state.world !== undefined) {
        if (!isDeepStrictEqual(this.state.world.definition, accepted)) throw new Error('World definition changed its frozen payload')
        return this.snapshot()
      }
      this.assertRevision(expectedRevision)
      await this.commit({ kind: 'run/world', runId: this.state.spec.runId, expectedRevision,
        change: { kind: 'world/defined', definition: accepted } })
      return this.snapshot()
    })
  }

  initializeWorld(request: import('@clocky/clocky-simulation').SimulationWorldBootstrapRequest,
    expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = simulationWorldBootstrapRequestSchema.parse(request)
    return this.enqueue(async () => {
      const original = this.state.worldBootstrap
      if (original !== undefined && !isDeepStrictEqual(original.request, accepted))
        throw new Error('Scenario bootstrap retry changed its original request')
      if (original?.status === 'applied') return this.snapshot()
      if (original === undefined) {
        this.assertRevision(expectedRevision)
        await this.commit({ kind: 'run/world-bootstrap', runId: this.state.spec.runId, expectedRevision,
          change: { kind: 'world-bootstrap/retained', request: accepted } })
      }
      const book = this.state.worldBootstrap
      if (book === undefined) throw new Error('World initialization lost its original retained responsibility')
      await this.commit({ kind: 'run/world-bootstrap', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        change: { kind: 'world-bootstrap/applied', bootstrapSequence: book.sequence, recordedAt: Date.now() } })
      return this.snapshot()
    })
  }

  openWorldIntent(actorId: SimulationEntityId, request: import('@clocky/clocky-simulation').SimulationWorldRequestOperation):
  Promise<import('@clocky/clocky-simulation').SimulationWorldIntent> {
    const accepted = parseSimulationWorldSchema(simulationWorldRequestOperationSchema, request)
    return this.enqueue(async () => {
      const pin = requireWorld(this.state).definition.operations.find(value => value.domain === accepted.domain
        && value.operation === accepted.operation && value.version === accepted.version)
      if (pin === undefined) throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
        'Bootstrap request operation is absent from the frozen manifest')
      requireWorldRuntime(this.worldRuntime).admitting(pin)
      const intent = createWorldIntent(this.state, actorId, accepted, pin, this.state.revision + 1, this.worldRuntime)
      if (this.state.world?.intents[intent.id] !== undefined) return structuredClone(intent)
      await this.commit({ kind: 'run/world', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        change: { kind: 'world/intent', intent } })
      return structuredClone(intent)
    })
  }

  previewWorldManagement(request: import('@clocky/clocky-simulation').SimulationWorldManagementPreviewRequest,
    authority: import('@clocky/clocky-simulation').SimulationWorldManagementAuthority):
  Promise<import('@clocky/clocky-simulation').SimulationWorldManagementPreview> {
    return this.enqueue(() => Promise.resolve(previewWorldManagement(this.state, request, authority, this.worldRuntime)))
  }
  inspectWorldManagement(commandId: import('@clocky/clocky-simulation').WorldManagementCommandId,
    principalId: import('@clocky/clocky-simulation').SimulationWorldAuthenticatedUserSource['principalId']):
  import('@clocky/clocky-simulation').SimulationWorldManagementReceipt | undefined {
    return structuredClone(inspectWorldManagement(this.state, commandId, principalId))
  }
  submitWorldManagement(request: import('@clocky/clocky-simulation').SimulationWorldManagementSubmitRequest,
    authority: import('@clocky/clocky-simulation').SimulationWorldManagementAuthority):
  Promise<import('@clocky/clocky-simulation').SimulationWorldManagementReceipt> {
    return this.enqueue(async () => {
      const prepared = prepareWorldManagement(this.state, request, authority, this.worldRuntime)
      if (!('kind' in prepared)) return structuredClone(prepared)
      // Live authentication and policy are checked again after preparing the actual prospective record.
      const repeated = prepareWorldManagement(this.state, request, authority, this.worldRuntime)
      if (!('kind' in repeated) || !isDeepStrictEqual(prepared, repeated))
        throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Management authority changed before Native acceptance')
      let projected = { ...foldWorld(this.state, prepared, this.state.revision + 1, this.worldRuntime), revision: this.state.revision + 1 }
      const values: unknown[] = [{ kind: 'run/world', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        change: prepared }]
      for (const event of worldExecutionTimeRecords(projected)) {
        values.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      // Final authorization immediately precedes the one durable acceptance batch.
      const finalAuthority = authority.resolve()
      if (finalAuthority === undefined || finalAuthority.source.principalId !== prepared.source.principalId
        || finalAuthority.actionHash !== businessFingerprint(prepared.admission.input.action)
        || finalAuthority.sourceFingerprint !== prepared.admission.sourceFingerprint
        || finalAuthority.source.policyRef !== prepared.source.policyRef
          || finalAuthority.source.policyGeneration !== prepared.source.policyGeneration
        || !finalAuthority.sourceComplete || !isDeepStrictEqual(finalAuthority.funding, prepared.admission.funding))
        throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Management authorization retired before its original acceptance append')
      await this.commitValues(values)
      const receipt = inspectWorldManagement(this.state, prepared.source.commandId, prepared.source.principalId)
      if (receipt === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Management append lost its original receipt')
      return structuredClone(receipt)
    }, 'control')
  }

  recordWorldExecution(request: import('@clocky/clocky-simulation').WorldExecutionRequest):
  Promise<import('@clocky/clocky-simulation').WorldExecutionObservation> {
    const accepted = parseSimulationWorldSchema(worldExecutionRequestSchema, request)
    return this.enqueue(async () => {
      if (accepted.phase === 'armed' && accepted.mode === 'execute') await this.expireDrainBudget()
      const world = requireWorld(this.state), plan = world.plans[accepted.planId]
      if (plan === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Execution observation has no original accepted plan')
      const original = world.executions[plan.id]
      if (original !== undefined && sameWorldExecution(original, accepted)) return structuredClone(original)
      const source = world.requests[plan.requestId]
      if (source === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Execution plan lost its original request')
      const observation = parseSimulationWorldSchema(worldExecutionObservationSchema, { ...accepted,
        requestId: source.id, intentId: source.intentId, pin: plan.pin, sequence: this.state.revision + 1,
        updates: (original?.updates ?? 0) + 1, time: this.state.time })
      await this.commit({ kind: 'run/world-execution', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        change: { kind: 'world/execution', observation } })
      const recorded = requireWorld(this.state).executions[plan.id]
      if (recorded === undefined)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Execution observation lost its accepted durable record')
      return structuredClone(recorded)
    })
  }

  inspectLocalObjectMutation(targetId: SimulationEntityId): ReturnType<NonNullable<SimulationRun['inspectLocalObjectMutation']>> {
    const selected = simulationEntityIdSchema.parse(targetId)
    localObjectTarget(this.state, selected)
    const reason = localObjectFallback(this.state, selected)
    return reason === undefined ? { kind: 'local', owner: 'native' } : { kind: 'maintenance', reason }
  }

  commitWorldMutation(request: { readonly planId: import('@clocky/clocky-simulation').WorldPlanId
    readonly payload: import('@clocky/clocky-simulation').SimulationWorldJsonValue }, authorize: () => void = () => {}): Promise<import('@clocky/clocky-simulation').SimulationWorldResult> {
    const accepted = parseSimulationWorldSchema(simulationWorldMutationCommitRequestSchema, request)
    return this.enqueue(async () => {
      authorize()
      const world = requireWorld(this.state), plan = world.plans[accepted.planId]
      if (plan === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Mutation has no original accepted plan')
      const module = requireWorldRuntime(this.worldRuntime).original(plan.pin)
      const payload = parseSimulationWorldSchema(z.json(), parseSimulationWorldSchema(module.definition.schemas.mutation, accepted.payload))
      const id = worldMutationIdSchema.parse(`world-mutation:${plan.id}`), prior = world.mutations[id]
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.payload, payload)) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
          'Mutation retry changed its original input')
        const original = world.requests[plan.requestId]
        const result = original === undefined ? undefined : world.results[worldResultIdentity(original.intentId)]
        if (result === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Mutation lost its atomic original result')
        return structuredClone(result)
      }
      const execution = world.executions[plan.id]
      if (execution?.phase !== 'armed' && execution?.phase !== 'outcome-unknown') {
        const original = world.requests[plan.requestId]
        if (original === undefined) throw new Error('Mutation lost its original request')
        assertRunControlRequest(this.state, original.proposal, this.worldRuntime, { requestId: original.id })
      }
      await this.revalidateWorldPlan(plan.id)
      const change = prepareWorldMutationRecord(this.state, { kind: 'world/mutation', id,
        requestId: plan.requestId, planId: plan.id, pin: plan.pin, payload, time: this.state.time,
        sequence: this.state.revision + 1, recordedAt: Date.now() }, this.worldRuntime)
      let projected = { ...foldWorldMutation(this.state, change, this.state.revision + 1, this.worldRuntime),
        revision: this.state.revision + 1 }
      const original = world.requests[plan.requestId]
      const result = original === undefined ? undefined : projected.world?.results[worldResultIdentity(original.intentId)]
      if (result === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Domain mutation did not produce its original result')
      const records: unknown[] = [{ kind: 'run/world-mutation', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, change }]
      for (const event of worldFirstActionWakeRecords(projected, result, this.worldRuntime)) {
        records.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      for (const event of worldResultWakeRecords(projected, result, this.worldRuntime)) {
        records.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      for (const event of normAnnouncementRecords(projected)) {
        records.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      for (const event of normBoundaryRecords(projected)) {
        records.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      for (const event of externalAdjudicatedEventRecords(projected)) {
        records.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      if (Buffer.byteLength(JSON.stringify(records), 'utf8') > world.definition.limits.maxBytesPerPlan)
        throw new SimulationWorldError('SIM_WORLD_LIMIT',
          'Complete mutation and disclosure batch exceeds its retained plan allowance', 'bytes')
      authorize()
      await this.commitValues(records)
      return structuredClone(result)
    })
  }

  reserveExternalContact(planId: import('@clocky/clocky-simulation').WorldPlanId):
  Promise<import('@clocky/clocky-simulation').SimulationExternalContact> {
    const accepted = worldPlanIdSchema.parse(planId)
    return this.enqueue(async () => {
      const world = requireWorld(this.state), plan = world.plans[accepted]
      const request = plan === undefined ? undefined : world.requests[plan.requestId]
      const intent = request === undefined ? undefined : world.intents[request.intentId]
      if (intent === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'External contact lost its original accepted case')
      const prior = world.external.contacts[intent.id]
      if (prior !== undefined) {
        if (prior.planId !== accepted)
          throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Contact retry changed its original accepted plan')
        return structuredClone(prior)
      }
      await this.revalidateWorldPlan(accepted)
      assertWorldMutationSlot(this.state)
      const representative = externalRepresentativeFor(this.state, simulationExternalActorRequestSchema.parse(intent.payload))
      if (representative === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Original shared generation is unavailable')
      const conversation = Object.values(world.external.contacts).find(value => value.identityId === representative.identityId
        && value.requesterEntityId === intent.requesterEntityId && value.status !== 'cancelled')
      const channel = conversation?.channel ?? { key: simulationChannelKeySchema.parse(`external-contact:${businessFingerprint([
        representative.identityId, intent.requesterEntityId, intent.id])}`), channelId: channelIdSchema.parse(`channel-${randomUUID()}`) }
      await this.commit({ kind: 'run/external-representative', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        change: { kind: 'external/contact-reserved', planId: accepted, channel } })
      return structuredClone(simulationExternalContactSchema.parse(requireWorld(this.state).external.contacts[intent.id]))
    })
  }

  commitExternalContact(id: import('@clocky/clocky-simulation').WorldIntentId):
  Promise<import('@clocky/clocky-simulation').SimulationWorldResult> {
    const accepted = worldIntentIdSchema.parse(id)
    return this.enqueue(async () => {
      const world = requireWorld(this.state), contact = world.external.contacts[accepted]
      const prior = world.results[worldResultIdentity(accepted)]
      if (contact?.status === 'committed' && prior?.outcome.kind === 'committed') return structuredClone(prior)
      if (contact === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Original external contact is not retained')
      await this.revalidateWorldPlan(contact.planId)
      const change = { kind: 'external/contact-committed' as const, id: accepted }
      let projected = { ...foldExternalRepresentative(this.state, change, this.state.revision + 1, this.worldRuntime),
        revision: this.state.revision + 1 }
      const result = requireWorld(projected).results[worldResultIdentity(accepted)]
      if (result === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External contact lost its atomic result')
      const records: unknown[] = [{ kind: 'run/external-representative', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, change }]
      for (const event of worldResultWakeRecords(projected, result, this.worldRuntime)) {
        records.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      if (Buffer.byteLength(JSON.stringify(records), 'utf8') > world.definition.limits.maxBytesPerPlan)
        throw new SimulationWorldError('SIM_WORLD_LIMIT',
          'Complete external result and contact wake batch exceeds its retained plan allowance', 'bytes')
      await this.commitValues(records)
      return structuredClone(result)
    })
  }

  reserveExternalRepresentative(request: import('@clocky/clocky-simulation').SimulationWorldHireReserveRequest):
  Promise<import('@clocky/clocky-simulation').SimulationExternalRepresentativeReservation> {
    const accepted = simulationWorldHireReserveRequestSchema.parse(request)
    return this.enqueue(async () => {
      const world = requireWorld(this.state), plan = world.plans[accepted.planId]
      const original = plan === undefined ? undefined : world.requests[plan.requestId]
      if (original === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Representative has no original accepted request')
      const prior = world.external.representatives[original.intentId]
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted))
          throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Representative retry changed its original route or plan')
        return structuredClone(prior)
      }
      await this.revalidateWorldPlan(accepted.planId)
      requireExternalActorApplication(this.state, accepted.planId, this.worldRuntime)
      assertWorldMutationSlot(this.state)
      assertWorldBirthBudget(this.state, true)
      const teamId = this.state.teamReservation?.teamId
      if (teamId === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative has no canonical Team')
      const adjudication = isDeepStrictEqual(plan?.pin, WORLD_EXTERNAL_MEDIATED_PIN)
        ? prepareExternalRepresentativeAdjudication(this.state, accepted.planId, this.state.revision + 1, Date.now()) : undefined
      const change = { kind: 'external/reserved' as const, request: accepted,
        ...adjudication === undefined ? {} : { adjudication }, identities: {
          entityId: simulationEntityIdSchema.parse(`world-representative:${randomUUID()}`),
          relationId: simulationRelationIdSchema.parse(`world-represents:${original.intentId}`),
          binding: { teamId, participantId: participantIdSchema.parse(`participant-${randomUUID()}`), sessionId: SessionId(randomUUID()) },
          channels: [
            { purpose: 'director' as const, key: simulationChannelKeySchema.parse(`external-director:${original.intentId}`),
              channelId: channelIdSchema.parse(`channel-${randomUUID()}`) },
            { purpose: 'requester' as const, key: simulationChannelKeySchema.parse(`external-requester:${original.intentId}`),
              channelId: channelIdSchema.parse(`channel-${randomUUID()}`) },
          ] as const,
        } }
      await this.commit({ kind: 'run/external-representative', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, change })
      return structuredClone(requireExternalRepresentative(this.state, original.intentId))
    })
  }

  prepareExternalRepresentative(id: import('@clocky/clocky-simulation').WorldIntentId):
  Promise<import('@clocky/clocky-simulation').SimulationExternalRepresentativeReservation> {
    return this.enqueue(async () => {
      const original = requireExternalRepresentative(this.state, id)
      if (original.status === 'preparing' || original.status === 'committed') return structuredClone(original)
      await this.revalidateWorldPlan(original.request.planId)
      await this.commit({ kind: 'run/external-representative', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, change: { kind: 'external/preparing', id } })
      return structuredClone(requireExternalRepresentative(this.state, id))
    })
  }

  commitExternalRepresentative(id: import('@clocky/clocky-simulation').WorldIntentId):
  Promise<import('@clocky/clocky-simulation').SimulationWorldResult> {
    return this.enqueue(async () => {
      const original = requireExternalRepresentative(this.state, id), world = requireWorld(this.state)
      const prior = world.results[worldResultIdentity(id)]
      if (original.status === 'committed' && prior?.outcome.kind === 'committed') return structuredClone(prior)
      await this.revalidateWorldPlan(original.request.planId)
      const change = { kind: 'external/committed' as const, id }
      let projected = { ...foldExternalRepresentative(this.state, change, this.state.revision + 1, this.worldRuntime),
        revision: this.state.revision + 1 }
      const result = requireWorld(projected).results[worldResultIdentity(id)]
      if (result === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative commit lost its atomic result')
      const values: unknown[] = [{ kind: 'run/external-representative', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, change }]
      for (const event of worldFirstActionWakeRecords(projected, result, this.worldRuntime)) {
        values.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      for (const event of worldResultWakeRecords(projected, result, this.worldRuntime)) {
        values.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      if (Buffer.byteLength(JSON.stringify(values), 'utf8') > world.definition.limits.maxBytesPerPlan)
        throw new SimulationWorldError('SIM_WORLD_LIMIT',
          'Complete external result and contact wake batch exceeds its retained plan allowance', 'bytes')
      await this.commitValues(values)
      return structuredClone(result)
    })
  }

  reserveWorldHire(request: import('@clocky/clocky-simulation').SimulationWorldHireReserveRequest):
  Promise<import('@clocky/clocky-simulation').SimulationWorldHireReservation> {
    const accepted = simulationWorldHireReserveRequestSchema.parse(request)
    return this.enqueue(async () => {
      const world = requireWorld(this.state), plan = world.plans[accepted.planId]
      const original = plan === undefined ? undefined : world.requests[plan.requestId]
      if (original === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
        'Hire reservation requires its accepted original plan')
      const prior = world.reservations[original.intentId]
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted)) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
          'Hire reservation changed its original plan or member configuration')
        return structuredClone(prior)
      }
      await this.revalidateWorldPlan(accepted.planId)
      const teamId = this.state.teamReservation?.teamId
      if (teamId === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire has no canonical execution Team')
      const intent = this.state.world?.intents[original.intentId]
      if (plan === undefined || intent === undefined)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire lost its original accepted input')
      requireWorldHireApplication(this.state, plan.id, this.worldRuntime)
      assertWorldMutationSlot(this.state)
      assertWorldBirthBudget(this.state, false)
      const approvals = requireHireApproval(this.state, intent, plan)
      const resourceHold = prepareHiringResourceReservation(this.state, plan, this.state.revision + 1)
      const change = { kind: 'hire/reserved' as const, request: accepted, approvals,
        ...resourceHold === undefined ? {} : { resourceHold }, identities: {
          entityId: simulationEntityIdSchema.parse(`world-person:${randomUUID()}`),
          relationId: simulationRelationIdSchema.parse(`world-assignment:${original.intentId}`),
          binding: { teamId, participantId: participantIdSchema.parse(`participant-${randomUUID()}`), sessionId: SessionId(randomUUID()) },
          channels: [
            { purpose: 'director' as const, key: simulationChannelKeySchema.parse(`world-director:${original.intentId}`),
              channelId: channelIdSchema.parse(`channel-${randomUUID()}`) },
            { purpose: 'requester' as const, key: simulationChannelKeySchema.parse(`world-requester:${original.intentId}`),
              channelId: channelIdSchema.parse(`channel-${randomUUID()}`) },
          ] as const,
        } }
      const record = { kind: 'run/world-hire', runId: this.state.spec.runId, expectedRevision: this.state.revision, change }
      if (Buffer.byteLength(JSON.stringify(record), 'utf8') > world.definition.limits.maxBytesPerPlan) {
        throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Hire reservation exceeds its complete retained byte allowance', 'bytes')
      }
      await this.commit(record)
      return structuredClone(requireWorldHire(this.state, original.intentId))
    })
  }

  prepareWorldHire(id: import('@clocky/clocky-simulation').WorldIntentId): Promise<import('@clocky/clocky-simulation').SimulationWorldHireReservation> {
    return this.enqueue(async () => {
      const original = requireWorldHire(this.state, id)
      if (original.status === 'preparing' || original.status === 'candidate' || original.status === 'committed') return structuredClone(original)
      await this.revalidateWorldPlan(original.request.planId)
      await this.commit({ kind: 'run/world-hire', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        change: { kind: 'hire/preparing', id } })
      return structuredClone(requireWorldHire(this.state, id))
    })
  }

  readyWorldCandidate(id: import('@clocky/clocky-simulation').WorldIntentId):
  Promise<import('@clocky/clocky-simulation').SimulationWorldHireReservation> {
    return this.enqueue(async () => {
      const original = requireWorldHire(this.state, id)
      if (original.candidate !== undefined) return structuredClone(original)
      await this.revalidateWorldPlan(original.request.planId)
      await this.commit({ kind: 'run/world-hire', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        change: { kind: 'hire/candidate-ready', id } })
      return structuredClone(requireWorldHire(this.state, id))
    })
  }

  reserveExistingHireResources(planId: import('@clocky/clocky-simulation').WorldPlanId):
  Promise<import('@clocky/clocky-simulation').SimulationResourceReservation | undefined> {
    const id = worldPlanIdSchema.parse(planId)
    return this.enqueue(async () => {
      const plan = requireWorld(this.state).plans[id]
      if (plan === undefined || !isDeepStrictEqual(plan.pin, WORLD_HIRE_EXISTING_PIN))
        throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Existing-person resources require the original installed plan')
      if (!hiringMarketReservationAuthorized(this.state, plan.id))
        throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring resources require the original offer reservation boundary')
      const prior = this.state.resourceReservations[hiringResourceReservationId(plan.id)]
      if (prior !== undefined) return structuredClone(prior)
      await this.revalidateWorldPlan(plan.id)
      assertWorldMutationSlot(this.state, requireWorld(this.state).requests[plan.requestId]?.intentId)
      const hold = prepareHiringResourceReservation(this.state, plan, this.state.revision + 1)
      if (hold === undefined) return undefined
      if (Object.hasOwn(this.state.resourceReservations, hold.id)) return structuredClone(hold)
      const change = { kind: 'hire-existing/resources-reserved' as const, planId: plan.id, hold }
      foldExistingHireResources(this.state, change, this.state.revision + 1, this.worldRuntime)
      await this.commit({ kind: 'run/existing-hire-resources', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, change })
      const retained = this.state.resourceReservations[hold.id]
      if (retained === undefined)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Existing-person funding lost its original retained hold')
      return structuredClone(retained)
    })
  }

  commitWorldHire(id: import('@clocky/clocky-simulation').WorldIntentId): Promise<import('@clocky/clocky-simulation').SimulationWorldResult> {
    return this.enqueue(async () => {
      const original = requireWorldHire(this.state, id), resultId = worldResultIdentity(id)
      const prior = requireWorld(this.state).results[resultId]
      if (original.status === 'committed' && prior?.outcome.kind === 'committed') return structuredClone(prior)
      await this.revalidateWorldPlan(original.request.planId)
      const change = { kind: 'hire/committed' as const, id }
      let projected = { ...foldWorldHire(this.state, change, this.state.revision + 1, this.worldRuntime),
        revision: this.state.revision + 1 }
      const result = requireWorld(projected).results[resultId]
      if (result === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire commit lost its atomic result')
      const values: unknown[] = [{ kind: 'run/world-hire', runId: this.state.spec.runId, expectedRevision: this.state.revision, change }]
      const first = worldFirstActionWakeRecords(projected, result, this.worldRuntime)
      let withFirst = projected
      for (const event of first) withFirst = { ...foldSchedulerRecord(withFirst, event, withFirst.revision + 1, this.worldRuntime),
        revision: withFirst.revision + 1 }
      for (const event of [...first, ...worldResultWakeRecords(withFirst, result, this.worldRuntime)]) {
        values.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      if (Buffer.byteLength(JSON.stringify(values), 'utf8') > requireWorld(this.state).definition.limits.maxBytesPerPlan)
        throw new SimulationWorldError('SIM_WORLD_LIMIT',
          'Complete hire payment, result and wake batch exceeds its retained plan allowance', 'bytes')
      await this.commitValues(values)
      return structuredClone(result)
    })
  }

  onWorldHireCleanup(owner: string, verify: (reservation: import('@clocky/clocky-simulation').SimulationWorldHireReservation) =>
  Promise<import('@clocky/clocky-simulation').SimulationWorldIdentityCleanupEvidence>): () => void {
    if (this.closing || this.worldHireCleanup !== undefined) {
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Simulation run already has a hire cleanup owner or is closing')
    }
    if (this.state.teamReservation?.confirmed !== true
      || owner !== this.state.teamReservation.creation.rules['activationLifecycleOwner']) {
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Hire cleanup requires the canonical Team activation lifecycle owner')
    }
    const source = { owner, verify }
    this.worldHireCleanup = source
    return () => { if (this.worldHireCleanup === source) this.worldHireCleanup = undefined }
  }

  async settleWorldHireCancellation(id: import('@clocky/clocky-simulation').WorldIntentId):
  Promise<import('@clocky/clocky-simulation').SimulationWorldResult> {
    const preparation = await this.enqueue(() => {
      const reservation = requireWorldHire(this.state, id), result = requireWorld(this.state).results[worldResultIdentity(id)]
      if (reservation.status === 'abandoned' && reservation.cleanup !== undefined && result?.outcome.kind === 'cancelled') {
        return { kind: 'settled' as const, result: structuredClone(result) }
      }
      assertWorldHireCancellationAdmission(this.state, reservation)
      const source = this.worldHireCleanup
      if (source === undefined) throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
        'Hire cancellation has no registered canonical cleanup owner')
      return { kind: 'pending' as const, reservation: structuredClone(reservation), source }
    })
    if (preparation.kind === 'settled') return preparation.result
    const evidence = simulationWorldIdentityCleanupEvidenceSchema.parse(
      await preparation.source.verify(structuredClone(preparation.reservation)))
    return this.enqueue(async () => {
      const reservation = requireWorldHire(this.state, id), result = requireWorld(this.state).results[worldResultIdentity(id)]
      if (reservation.status === 'abandoned' && reservation.cleanup !== undefined && result?.outcome.kind === 'cancelled') {
        return structuredClone(result)
      }
      if (this.worldHireCleanup !== preparation.source) {
        throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Hire cleanup source was revoked before Native settlement')
      }
      if (reservation.id !== preparation.reservation.id || reservation.requestId !== preparation.reservation.requestId
        || reservation.sequence !== preparation.reservation.sequence
        || !isDeepStrictEqual(reservation.request, preparation.reservation.request)
        || !isDeepStrictEqual(reservation.identities, preparation.reservation.identities)) {
        throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hire cancellation changed its original reservation during cleanup')
      }
      const change = { kind: 'hire/abandoned' as const, id, evidence }
      let projected = { ...foldWorldHire(this.state, change, this.state.revision + 1, this.worldRuntime),
        revision: this.state.revision + 1 }
      const cancelled = requireWorld(projected).results[worldResultIdentity(id)]
      if (cancelled === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire cleanup lost its atomic cancellation result')
      const values: unknown[] = [{ kind: 'run/world-hire', runId: this.state.spec.runId, expectedRevision: this.state.revision, change }]
      for (const event of worldResultWakeRecords(projected, cancelled, this.worldRuntime)) {
        values.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      if (Buffer.byteLength(JSON.stringify(values), 'utf8') > requireWorld(this.state).definition.limits.maxBytesPerPlan) {
        throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Hire cleanup exceeds its complete retained batch byte allowance', 'bytes')
      }
      await this.commitValues(values)
      return structuredClone(cancelled)
    }, 'retirement')
  }

  onExternalRepresentativeCleanup(owner: string,
    verify: (reservation: import('@clocky/clocky-simulation').SimulationExternalRepresentativeReservation) =>
    Promise<import('@clocky/clocky-simulation').SimulationWorldIdentityCleanupEvidence>): () => void {
    if (this.closing || this.externalRepresentativeCleanup !== undefined) {
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Simulation run already has a hire cleanup owner or is closing')
    }
    if (this.state.teamReservation?.confirmed !== true
      || owner !== this.state.teamReservation.creation.rules['activationLifecycleOwner']) {
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Representative cleanup requires the canonical Team activation lifecycle owner')
    }
    const source = { owner, verify }
    this.externalRepresentativeCleanup = source
    return () => { if (this.externalRepresentativeCleanup === source) this.externalRepresentativeCleanup = undefined }
  }

  async settleExternalRepresentativeCancellation(id: import('@clocky/clocky-simulation').WorldIntentId):
  Promise<import('@clocky/clocky-simulation').SimulationWorldResult> {
    const preparation = await this.enqueue(() => {
      const reservation = requireExternalRepresentative(this.state, id), result = requireWorld(this.state).results[worldResultIdentity(id)]
      if (reservation.status === 'abandoned' && reservation.cleanup !== undefined && result?.outcome.kind === 'cancelled') {
        return { kind: 'settled' as const, result: structuredClone(result) }
      }
      assertExternalRepresentativeCancellationAdmission(this.state, reservation)
      const source = this.externalRepresentativeCleanup
      if (source === undefined) throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
        'Representative cancellation has no registered canonical cleanup owner')
      return { kind: 'pending' as const, reservation: structuredClone(reservation), source }
    })
    if (preparation.kind === 'settled') return preparation.result
    const evidence = simulationWorldIdentityCleanupEvidenceSchema.parse(
      await preparation.source.verify(structuredClone(preparation.reservation)))
    return this.enqueue(async () => {
      const reservation = requireExternalRepresentative(this.state, id), result = requireWorld(this.state).results[worldResultIdentity(id)]
      if (reservation.status === 'abandoned' && reservation.cleanup !== undefined && result?.outcome.kind === 'cancelled') {
        return structuredClone(result)
      }
      if (this.externalRepresentativeCleanup !== preparation.source) {
        throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Representative cleanup source was revoked before Native settlement')
      }
      if (reservation.id !== preparation.reservation.id || reservation.requestId !== preparation.reservation.requestId
        || reservation.sequence !== preparation.reservation.sequence
        || !isDeepStrictEqual(reservation.request, preparation.reservation.request)
        || !isDeepStrictEqual(reservation.identities, preparation.reservation.identities)) {
        throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Representative cancellation changed its original reservation during cleanup')
      }
      const change = { kind: 'external/abandoned' as const, id, evidence }
      let projected = { ...foldExternalRepresentative(this.state, change, this.state.revision + 1, this.worldRuntime),
        revision: this.state.revision + 1 }
      const cancelled = requireWorld(projected).results[worldResultIdentity(id)]
      if (cancelled === undefined)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative cleanup lost its atomic cancellation result')
      const values: unknown[] = [{ kind: 'run/external-representative', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, change }]
      for (const event of worldResultWakeRecords(projected, cancelled, this.worldRuntime)) {
        values.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      if (Buffer.byteLength(JSON.stringify(values), 'utf8') > requireWorld(this.state).definition.limits.maxBytesPerPlan) {
        throw new SimulationWorldError('SIM_WORLD_LIMIT',
          'Representative cleanup exceeds its complete retained batch byte allowance', 'bytes')
      }
      await this.commitValues(values)
      return structuredClone(cancelled)
    }, 'retirement')
  }

  onExternalContactCleanup(owner: string, verify: (reservation: import('@clocky/clocky-simulation').SimulationExternalContact) =>
  Promise<import('@clocky/clocky-simulation').SimulationExternalContactCleanupEvidence>): () => void {
    if (this.closing || this.externalContactCleanup !== undefined) {
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Simulation run already has a contact cleanup owner or is closing')
    }
    if (this.state.teamReservation?.confirmed !== true
      || owner !== this.state.teamReservation.creation.rules['activationLifecycleOwner']) {
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Contact cleanup requires the canonical Team activation lifecycle owner')
    }
    const source = { owner, verify }
    this.externalContactCleanup = source
    return () => { if (this.externalContactCleanup === source) this.externalContactCleanup = undefined }
  }

  async settleExternalContactCancellation(id: import('@clocky/clocky-simulation').WorldIntentId):
  Promise<import('@clocky/clocky-simulation').SimulationWorldResult> {
    const preparation = await this.enqueue(() => {
      const reservation = requireWorld(this.state).external.contacts[id], result = requireWorld(this.state).results[worldResultIdentity(id)]
      if (reservation === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Original withdrawn contact is not retained')
      if (reservation.status === 'cancelled' && reservation.cleanup !== undefined && result?.outcome.kind === 'cancelled') {
        return { kind: 'settled' as const, result: structuredClone(result) }
      }
      assertExternalContactCancellationAdmission(this.state, reservation)
      const source = this.externalContactCleanup
      if (source === undefined) throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
        'Contact cancellation has no registered canonical cleanup owner')
      return { kind: 'pending' as const, reservation: structuredClone(reservation), source }
    })
    if (preparation.kind === 'settled') return preparation.result
    const evidence = simulationExternalContactCleanupEvidenceSchema.parse(
      await preparation.source.verify(structuredClone(preparation.reservation)))
    return this.enqueue(async () => {
      const reservation = requireWorld(this.state).external.contacts[id], result = requireWorld(this.state).results[worldResultIdentity(id)]
      if (reservation === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Original withdrawn contact is not retained')
      if (reservation.status === 'cancelled' && reservation.cleanup !== undefined && result?.outcome.kind === 'cancelled') {
        return structuredClone(result)
      }
      if (this.externalContactCleanup !== preparation.source) {
        throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Contact cleanup source was revoked before Native settlement')
      }
      if (reservation.id !== preparation.reservation.id || reservation.requestId !== preparation.reservation.requestId
        || reservation.sequence !== preparation.reservation.sequence
        || !isDeepStrictEqual(reservation.channel, preparation.reservation.channel)
        || !isDeepStrictEqual(reservation.cancellation, preparation.reservation.cancellation)
        || reservation.requesterEntityId !== preparation.reservation.requesterEntityId
        || reservation.representativeIntentId !== preparation.reservation.representativeIntentId) {
        throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Contact cancellation changed its original reservation during cleanup')
      }
      const change = { kind: 'external/contact-cancelled' as const, id, evidence }
      let projected = { ...foldExternalRepresentative(this.state, change, this.state.revision + 1, this.worldRuntime),
        revision: this.state.revision + 1 }
      const cancelled = requireWorld(projected).results[worldResultIdentity(id)]
      if (cancelled === undefined)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact cleanup lost its atomic cancellation result')
      const values: unknown[] = [{ kind: 'run/external-representative', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, change }]
      for (const event of worldResultWakeRecords(projected, cancelled, this.worldRuntime)) {
        values.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      if (Buffer.byteLength(JSON.stringify(values), 'utf8') > requireWorld(this.state).definition.limits.maxBytesPerPlan) {
        throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Contact cleanup exceeds its complete retained batch byte allowance', 'bytes')
      }
      await this.commitValues(values)
      return structuredClone(cancelled)
    }, 'retirement')
  }

  private async revalidateWorldPlan(planId: import('@clocky/clocky-simulation').WorldPlanId): Promise<void> {
    const world = requireWorld(this.state), plan = world.plans[planId]
    const request = plan === undefined ? undefined : world.requests[plan.requestId]
    if (plan?.status !== 'accepted' || request?.status !== 'open' || request.plans.at(-1) !== plan.id) return
    const reason = worldPlanStaleReason(this.state, plan, this.worldRuntime)
    if (reason === undefined) return
    await this.commit({ kind: 'run/world', runId: this.state.spec.runId, expectedRevision: this.state.revision,
      change: { kind: 'world/plan-stale', planId, reason } })
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hire plan is stale; its original proposal and invalidation cause are retained')
  }

  cancelWorldCase(request: import('@clocky/clocky-simulation').SimulationWorldCancelRequest,
    authorize?: () => void): Promise<import('@clocky/clocky-simulation').SimulationWorldCancellation> {
    const accepted = simulationWorldCancelRequestSchema.parse(request)
    return this.enqueue(async () => {
      authorize?.()
      const history = this.state.world?.cancellations
      const prior = history !== undefined && Object.hasOwn(history, accepted.id) ? history[accepted.id] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted)) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
          'World cancellation command changed its original case')
        return structuredClone(prior)
      }
      const change = { kind: 'world/cancelled' as const, request: accepted }
      let projected = { ...foldWorld(this.state, change, this.state.revision + 1, this.worldRuntime), revision: this.state.revision + 1 }
      const values: unknown[] = [{ kind: 'run/world', runId: this.state.spec.runId, expectedRevision: this.state.revision, change }]
      // Submitted window slots must settle as cancelled before the window can accept a late plan.
      for (const decision of Object.values(projected.decisions)) {
        const context = decision.context?.status === 'prepared' ? decision.context.world : undefined
        if ((decision.status === 'open' || decision.status === 'submitted') && (context?.kind === 'resolve'
          || context?.kind === 'scenario-resolve' || context?.kind === 'evidence')
          && context.requestId === accepted.requestId) {
          const cancellation = { kind: 'decision/cancelled' as const, id: decision.id }
          values.push({ kind: 'run/business', runId: this.state.spec.runId, expectedRevision: projected.revision, change: cancellation })
          projected = { ...foldBusinessRecord(projected, cancellation, projected.revision + 1, this.worldRuntime),
            revision: projected.revision + 1 }
        }
      }
      const world = requireWorld(projected), original = world.requests[accepted.requestId]
      if (original === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cancellation lost its original request')
      const notificationWake = (original.notificationOperationId === null ? `simulation-world-scenario-resolve:${original.id}`
        : `simulation-delivery:${original.notificationOperationId}`) as SimulationEventId
      const obsolete: SchedulerRecord[] = []
      const notificationWakes = [notificationWake,
        ...Object.values(world.evidence.challenges).filter(value => value.requestId === original.id)
          .map(value => simulationEventIdSchema.parse(`simulation-delivery:${value.notificationOperationId}`)),
        ...Object.values(world.evidence.revisions).filter(value => value.requestId === original.id)
          .map(value => simulationEventIdSchema.parse(`simulation-delivery:${value.notificationOperationId}`)),
      ]
      for (const id of notificationWakes) {
        if (projected.scheduledEvents[id]?.status === 'pending')
          obsolete.push({ kind: 'event/cancelled', id, reason: 'World case resolved' })
        if (projected.wakes[id]?.status === 'pending')
          obsolete.push({ kind: 'wake/cancelled', id, reason: 'World case resolved' })
      }
      for (const event of obsolete) {
        values.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      const result = world.results[worldResultIdentity(original.intentId)]
      if (result === undefined && world.cancellations[accepted.id]?.status !== 'cancel-requested') {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cancellation lost its terminal result')
      }
      for (const event of result === undefined ? [] : worldResultWakeRecords(projected, result, this.worldRuntime)) {
        values.push({ kind: 'run/scheduler', runId: this.state.spec.runId, expectedRevision: projected.revision, change: event })
        projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
          revision: projected.revision + 1 }
      }
      if (Buffer.byteLength(JSON.stringify(values), 'utf8') > world.definition.limits.maxBytesPerRequest) {
        throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World cancellation exceeds its complete retained batch byte limit', 'bytes')
      }
      await this.commitValues(values)
      const cancellation = requireWorld(this.state).cancellations[accepted.id]
      if (cancellation === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cancellation lost its original command')
      return structuredClone(cancellation)
    }, 'control')
  }

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

  async acquireCheckpointCut(maxDrainRounds: number,
    signal?: AbortSignal): Promise<import('@clocky/clocky-simulation').SimulationCheckpointCut> {
    if (!Number.isSafeInteger(maxDrainRounds)
      || maxDrainRounds < 1) throw new TypeError('Checkpoint drain rounds must be a positive safe integer')
    signal?.throwIfAborted()
    if (this.closing || this.checkpointBarrier !== undefined)
      throw new Error('Simulation checkpoint cut is already held or the run is closing')
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
      return { snapshot: this.snapshot(), reference, release, exportArchive: async (limits) => {
        // The collector may release this cut while storage awaits; read the current barrier on each side of IO.
        const assertArchiveCut = (): void => {
          if (releaseRequested || this.checkpointBarrier?.token !== token || this.checkpointBarrier.phase !== 'sealed')
            throw new Error('Archive export requires its live sealed checkpoint cut')
        }
        assertArchiveCut()
        const archive = await captureLogArchive(this.stream, reference.cursor, limits)
        assertArchiveCut()
        return archive
      }, publish: (manifest) => {
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

  runControlCommandObservation(commandId: string): {
    readonly command: import('@clocky/clocky-simulation').SimulationRunControlCommand
    readonly receipt: import('@clocky/clocky-simulation').SimulationRunControlReceipt
  } | undefined {
    const history = this.state.runControl?.commands ?? {}
    const original = Object.hasOwn(history, commandId) ? history[commandId] : undefined
    return original === undefined ? undefined : structuredClone(original)
  }

  managementObservation(id: import('@clocky/clocky-simulation').SimulationManagementId):
  import('@clocky/clocky-simulation').SimulationManagementOperation | undefined {
    const history = this.state.management ?? {}
    const operation = Object.hasOwn(history, id) ? history[id] : undefined
    return operation === undefined ? undefined : structuredClone(operation)
  }

  controlObservation(checkpointId?: string): import('@clocky/clocky-simulation').SimulationControlObservation {
    const observation = controlObservation(this.state, checkpointId)
    return { ...observation, checkpointCoverage: this.state.world?.definition.operations.some(pin =>
      requireWorldRuntime(this.worldRuntime).original(pin).checkpointCoverage !== 'native') === true ? 'external-state-required' : 'native' }
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
        { kind: 'ingress/received', request: accepted, ordinal: this.state.nextIngressSlot ?? simulationEventSlotSchema.parse('0'),
          eventId, key },
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

  extendBudget(request: import('@clocky/clocky-simulation').SimulationBudgetGrantRequest,
    expectedRevision: number): Promise<SimulationSnapshot> {
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
      if (personnelRetired(this.state, accepted.entityId)) throw new Error('Confirmed personnel retirement does not admit a new nomination')
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
        try { await this.acceptDecision(decision, decision.submission as readonly SimulationProposal[]) }
        catch (error) {
          if (error instanceof SimulationCommunicationError) {
            await this.commitBusiness([{ kind: 'decision/message-rejected', id: decision.id,
              code: error.code, proposalHash: businessFingerprint(decision.submission) }])
            if (this.state.phase !== 'running' && window.request.decisions.some(value =>
              ['open', 'submitted'].includes(requireDecision(this.state, value.id).status))) return this.window(id)
            continue
          }
          if (await this.recordWorldSubmissionBlock(decision.id, decision.submission as readonly SimulationProposal[], error))
            return this.window(id)
          throw error
        }
      }
      await this.commitBusiness([{ kind: 'window/closed', id }])
      return this.window(id)
    })
  }

  /** Retain a final refusal of the exact consumed input, including a window proposal submitted in an earlier batch. */
  private async recordWorldSubmissionBlock(id: SimulationDecisionId,
    proposals: readonly SimulationProposal[], error: unknown): Promise<boolean> {
    const current = requireDecision(this.state, id)
    const failure = error instanceof SimulationWorldError ? simulationWorldSubmissionFailureSchema.safeParse(error.failure) : undefined
    const eligible = current.inference !== undefined && (current.status === 'open' && current.inference.finishedAt === undefined
      || current.status === 'submitted' && current.windowId !== undefined && current.inference.finishedAt !== undefined
        && isDeepStrictEqual(current.submission, proposals))
    if (!failure?.success || !eligible || !currentDecision(this.state, current)
      || current.context?.status !== 'prepared' || current.context.world === undefined || current.consumption === undefined
      || failure.data.code !== 'SIM_WORLD_LIMIT' && current.context.world.kind !== 'request'
        && current.context.world.kind !== 'resolve' && current.context.world.kind !== 'evidence') return false
    const records: BusinessRecord[] = [{ kind: 'decision/world-blocked', id,
      block: { proposalHash: simulationWorldSubmissionHash(proposals), failure: failure.data } }]
    if (current.windowId !== undefined && this.state.windows?.[current.windowId]?.request.decisions.every(value =>
      value.id === id || !['open', 'submitted'].includes(requireDecision(this.state, value.id).status)))
      records.push({ kind: 'window/closed', id: current.windowId })
    await this.commitBusiness(records)
    return true
  }

  private window(id: SimulationWindowId): SimulationWindow {
    const window = Object.hasOwn(this.state.windows ?? {}, id) ? this.state.windows?.[id] : undefined
    if (window === undefined) throw new Error('Simulation window does not exist')
    return structuredClone(window)
  }

  private async acceptDecision(decision: SimulationDecision, proposals: readonly SimulationProposal[], finishedAt?: number): Promise<void> {
    assertKnowledgeAccess(this.state, decision)
    assertWorldAdmission(this.state, proposals, this.worldRuntime)
    assertBudget(this.state, 'messages', expandWorldProposals(this.state, decision, proposals,
      this.worldRuntime).filter(proposal => proposal.action.kind === 'communication/post').length)
    const records: BusinessRecord[] = [
      ...finishedAt === undefined ? [] : [{ kind: 'decision/finished' as const, id: decision.id, finishedAt }],
      ...acceptanceRecords(this.state, decision, proposals, this.worldRuntime),
    ]
    let projected = this.state
    for (const record of records) {
      projected = { ...foldBusinessRecord(projected, record, projected.revision + 1, this.worldRuntime),
        revision: projected.revision + 1 }
    }
    const operations = requireDecision(projected, decision.id).operationIds.map(id => projected.operations[id] as SimulationOperation)
    const evidence: WorldEvidenceRecord[] = []
    for (const operation of operations) {
      if (operation.action.kind === 'world/resolve' && operation.action.resolution.kind === 'awaiting-evidence') {
        const plan = requireWorld(projected).plans[worldPlanIdSchema.parse(`world-plan:${operation.id}`)]
        if (plan === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence lost its asking plan')
        evidence.push({ kind: 'evidence/opened', challenge: prepareWorldEvidenceChallenge(projected, plan,
          projected.revision + 1, requireWorldRuntime(this.worldRuntime)) })
      } else if (operation.action.kind === 'world/evidence') {
        evidence.push({ kind: 'evidence/answered', revision: prepareWorldEvidenceRevision(projected, operation, projected.revision + 1) })
      } else continue
      const record = evidence.at(-1)
      if (record === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Evidence acceptance omitted its record')
      projected = { ...foldWorldEvidence(projected, record, projected.revision + 1, requireWorldRuntime(this.worldRuntime)),
        revision: projected.revision + 1 }
    }
    const events = outboxScheduleRecords(projected, operations)
    for (const event of events) projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
      revision: projected.revision + 1 }
    const deadlines = governanceDeadlineRecords(projected)
    for (const event of deadlines) projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
      revision: projected.revision + 1 }
    const executionTimes = worldExecutionTimeRecords(projected)
    for (const event of executionTimes) projected = { ...foldSchedulerRecord(projected, event, projected.revision + 1, this.worldRuntime),
      revision: projected.revision + 1 }
    const scenarioRequests = scenarioRequestRecords(projected)
    const changes = [...records.map(change => ({ kind: 'run/business', change })),
      ...evidence.map(change => ({ kind: 'run/world-evidence', change })),
      ...[...events, ...deadlines, ...executionTimes, ...scenarioRequests].map(change => ({ kind: 'run/scheduler', change }))]
    await this.commitDomain(changes)
  }

  reserveChannel(channel: import('@clocky/clocky-simulation').SimulationChannelSpec,
    expectedRevision: number): Promise<SimulationSnapshot> {
    const accepted = simulationChannelSpecSchema.parse(channel)
    return this.enqueue(async () => {
      assertSimulationWorldPreparationAdmission(this.state, accepted.members.map(member => member.entityId), accepted.key)
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
      assertSimulationWorldPreparationAdmission(this.state, existing?.spec.members.map(member => member.entityId) ?? [], key)
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
        if (!isDeepStrictEqual(entity.participantReservation.participant,
          accepted)) throw new Error('Simulation participant reservation changed its payload')
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
        || accepted.id.startsWith('simulation-ingress:') || accepted.id.startsWith('simulation-world-result:')
        || accepted.id.startsWith('simulation-world-first:') || accepted.id.startsWith('simulation-governance-deadline:')
          || accepted.id.startsWith('simulation-world-evidence-deadline:')
        || accepted.id.startsWith('simulation-governance-resolution:') || accepted.id.startsWith('simulation-norm-announcement:')
        || accepted.id.startsWith('simulation-norm-boundary:') || accepted.id.startsWith('simulation-world-execution-time:')
        || accepted.id.startsWith('simulation-external-adjudication:') || accepted.id.startsWith('simulation-external-adjudication-result:')
        || accepted.id.startsWith('simulation-world-calendar:') || accepted.id.startsWith('simulation-world-calendar-wake:'))
        throw new Error('Internal simulation event ids are reserved')
      const action = { kind: 'wake' as const, entityId: accepted.entityId, reason: accepted.reason }
      const existing = Object.hasOwn(this.state.scheduledEvents, accepted.id) ? this.state.scheduledEvents[accepted.id] : undefined
      if (existing !== undefined) {
        if (existing.key.time !== accepted.time || !isDeepStrictEqual(existing.action,
          action)) throw new Error('Simulation event id was reused with a different payload')
        return this.snapshot()
      }
      assertRunControlAdmission(this.state)
      assertRunControlTime(this.state, accepted.time)
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
      const boundary = this.state.runControl?.current.nativeBoundary
      const until = boundary != null && BigInt(selected.until) > BigInt(boundary) ? boundary : selected.until
      if (BigInt(until) < BigInt(this.state.time)) throw new Error('Simulation drive cannot rewind time')
      let steps = 0
      const result = (reason: SimulationDriveResult['reason']): SimulationDriveResult => ({ steps, reason, revision: this.state.revision })
      while (steps < this.state.spec.maxDriveSteps) {
        assertSimulationMaintenanceAdmission(this.state)
        if (this.state.phase === 'paused') return result('paused')
        if (this.state.phase === 'stalled') return result('stalled')
        assertFederationTime(this.state, this.state.time)
        if (this.state.activeWindowId !== undefined || decisionDispatch(this.state).active !== undefined) return result('decision-required')
        const pending = nextLocalOperation(this.state)
        if (pending !== undefined && dependenciesReady(this.state, pending)) {
          await this.executeOwned(pending.id); steps += 1; continue
        }
        const outbound = Object.values(this.state.operations).find(operation => isOutboxAction(operation.action)
          && operation.outbox?.ready === true && operation.result === undefined && dependenciesReady(this.state, operation))
        if (outbound !== undefined) return { ...result('dispatch-required'), operationId: outbound.id }
        const receiving = Object.values(this.state.operations).find(operation => operation.action.kind === 'communication/post'
          && operation.result?.status === 'applied' && operation.delivery?.receipt === undefined
            && operation.deliveryFailure?.resolution === undefined)
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
        if (Object.values(decisionDispatch(this.state).tickets).some(ticket => ticket.status === 'queued'
          && !personnelRetired(this.state, ticket.candidate.entityId))
          || this.state.activeDecisionId !== undefined
          || Object.values(this.state.wakes).some(wake => wake.status === 'claimed'
            || wake.status === 'pending' && !collecting && !personnelRetired(this.state, wake.entityId))) {
          return result('decision-required')
        }
        const next = cohortEvent
        if (next === undefined || BigInt(next.key.time) > BigInt(until)) {
          assertFederationTime(this.state, until)
          if (until !== this.state.time) {
            await this.commitScheduler([{ kind: 'clock/advanced', time: until }])
            steps += 1
          }
          return result('until')
        }
        assertFederationTime(this.state, next.key.time)
        if (BigInt(next.key.microstep) >= BigInt(this.state.spec.maxMicrostepsPerTime)) {
          await this.commitScheduler([{ kind: 'run/stalled', id: next.id }])
          steps += 1
          return result('stalled')
        }
        if (next.action.kind === 'external-adjudicated-event') {
          const checked = prepareExternalAdjudicatedEventConsumption({ ...this.state, time: next.key.time },
            assertExternalAdjudicatedEventSource(this.state, next), this.state.revision + 1)
          if ('block' in checked) {
            await this.commitScheduler([{ kind: 'external-event/blocked', id: next.id,
              block: { ...checked.block, time: next.key.time } }])
            steps += 1
            return result('stalled')
          }
          const consumed: SchedulerRecord = { kind: 'event/consumed', id: next.id,
            externalConsumption: checked.consumption, recordedAt: Date.now() }
          const projected = { ...foldSchedulerRecord(this.state, consumed, this.state.revision + 1, this.worldRuntime),
            revision: this.state.revision + 1 }
          const changes = [consumed, ...externalAdjudicatedResultWakeRecords(projected)]
          if (Buffer.byteLength(JSON.stringify(changes.map((change, index) => ({ kind: 'run/scheduler',
            runId: this.state.spec.runId, expectedRevision: this.state.revision + index, change }))), 'utf8')
            > requireWorld(this.state).definition.limits.maxBytesPerPlan)
            throw new SimulationWorldError('SIM_WORLD_LIMIT',
              'Complete finite adjudication consumption batch exceeds its retained plan allowance', 'bytes')
          await this.commitScheduler(changes)
        } else {
          await this.commitScheduler([{ kind: collecting ? 'event/cohort-consumed' : 'event/consumed', id: next.id }])
        }
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
        if (!isDeepStrictEqual(this.state.teamReservation.creation,
          accepted)) throw new Error('Simulation Team reservation changed its creation payload')
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
        if (operation.deliveryFailure.resolution.kind !== resolution.kind)
          throw new Error('Simulation failure resolution retry changed its disposition')
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
        if (!isDeepStrictEqual(operation.deliveryFailure.record,
          record)) throw new Error('Simulation delivery failure retry changed its evidence')
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
      const action = { kind: 'wake' as const, entityId: operation.action.recipient,
        reason: `Team message ${operation.outbox.receipt?.envelopeId}` }
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
    await this.expireDrainBudget()
    const operation = Object.hasOwn(this.state.operations, operationId) ? this.state.operations[operationId] : undefined
    if (operation === undefined) throw new Error('Simulation operation does not exist')
    if (operation.result !== undefined) return structuredClone(operation.result)
    assertRunControlAdmission(this.state, { operationId: operation.id })
    if (this.state.activeWindowId !== undefined) throw new Error('Simulation world execution waits for its window to close')
    if (isOutboxAction(operation.action)) throw new Error('Simulation external effects must use their outbox dispatcher')
    const outcome = computeOperation(this.state, operation, this.worldRuntime)
    const settled: BusinessRecord = { kind: 'operation/settled', id: operationId, status: outcome.status, code: outcome.code }
    const next = { ...foldBusinessRecord(this.state, settled, this.state.revision + 1, this.worldRuntime),
      revision: this.state.revision + 1 }
    const effects = schedulerConsequences(next, next.operations[operationId] as SimulationOperation, this.worldRuntime)
    await this.commitDomain([{ kind: 'run/business', change: settled }, ...effects.map(change => ({ kind: 'run/scheduler', change }))])
    return structuredClone(this.state.operations[operationId]?.result as SimulationOperationResult)
  }

  dispatchOperation(
    operationId: SimulationOperationId,
    transport: SimulationTeamTransport | import('@clocky/clocky-simulation').SimulationTaskTransport, clock: () => number,
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
    id: SimulationOperationId, transport: SimulationTeamTransport | import('@clocky/clocky-simulation').SimulationTaskTransport,
    clock: () => number,
  ): Promise<SimulationDispatchResult> {
    const prepared = await this.enqueue(async () => {
      await this.expireDrainBudget()
      const operation = requireOutbox(this.state, id)
      if (operation.action.kind === 'task/create' ? !('createTask' in transport) : !('post' in transport)) {
        throw new Error('Simulation outbox transport does not implement its target kind')
      }
      if (operation.result !== undefined) return { status: 'settled' as const, result: structuredClone(operation.result) }
      if (operation.status === 'outcome-unknown') return { status: 'outcome-unknown' as const }
      assertRunControlAdmission(this.state, { operationId: operation.id })
      if (this.state.phase !== 'running' || this.state.activeWindowId !== undefined || !operation.outbox.ready
        || BigInt(this.state.time) < BigInt(operation.action.deliverAt)) {
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
      await this.commitOutbox([{ kind: 'outbox/uncertain', id, number: prepared.number, at, detail: failure
        || 'Unknown transport outcome' }])
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
        if (prior === undefined || !isDeepStrictEqual(prior.request,
          accepted)) throw new Error('Simulation retry identity changed its original payload')
        return structuredClone(prior)
      }
      if (this.state.activeWindowId !== undefined
        || Object.values(this.state.checkpoints ?? {}).some(value => value.status === 'in-progress')) {
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

  beginMaintenance(request: SimulationMaintenanceRequest): Promise<SimulationMaintenanceOperation> {
    return this.transitionMaintenance(request, 'draining')
  }

  quiesceMaintenance(request: SimulationMaintenanceRequest): Promise<SimulationMaintenanceOperation> {
    return this.transitionMaintenance(request, 'quiescent')
  }

  finishMaintenance(request: SimulationMaintenanceRequest): Promise<SimulationMaintenanceOperation> {
    return this.transitionMaintenance(request, 'completed')
  }

  private transitionMaintenance(request: SimulationMaintenanceRequest,
    status: SimulationMaintenanceOperation['status']): Promise<SimulationMaintenanceOperation> {
    const accepted = simulationMaintenanceRequestSchema.parse(request)
    return this.enqueue(async () => {
      const history = this.state.maintenance ?? {}
      const prior = Object.hasOwn(history, accepted.id) ? history[accepted.id] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, accepted)) {
          throw new SimulationMaintenanceError('SIM_MAINTENANCE_CONFLICT', 'Simulation maintenance retry changed its original owner')
        }
        if (status === 'draining' || prior.status === status || prior.status === 'completed') return structuredClone(prior)
      }
      await this.commit({ kind: 'run/maintenance', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        change: { request: accepted, status } })
      return structuredClone(this.state.maintenance?.[accepted.id] as SimulationMaintenanceOperation)
    })
  }

  recordDriverObservation(observation: import('@clocky/clocky-simulation').SimulationDriverObservation): Promise<number> {
    const accepted = simulationDriverObservationSchema.parse(observation)
    return this.enqueue(async () => {
      await this.commit({ kind: 'run/driver-observation', runId: this.state.spec.runId,
        expectedRevision: this.state.revision, observation: accepted })
      return this.state.revision
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
        if (accepted.tokenRecovery !== undefined) validateTokenRecovery(this.state, accepted.tokenRecovery)
        const start = { kind: 'run/management', runId: this.state.spec.runId, expectedRevision: this.state.revision,
          change: { kind: 'management/started', request: accepted } }
        // Pause admission and retain the request in one atomic batch; resume stays closed until its terminal batch.
        await this.commitValues(accepted.phase === 'paused' && this.state.phase !== 'paused' ? [start, { kind: 'run/phase',
          runId: this.state.spec.runId,
          expectedRevision: this.state.revision + 1, phase: 'paused', managementId: accepted.id }] : [start])
      }
      const phase = { kind: 'run/phase', runId: this.state.spec.runId, expectedRevision: this.state.revision,
        phase: accepted.phase, managementId: accepted.id }
      const changesPhase = this.state.phase !== accepted.phase
      let failure: string | undefined
      if (accepted.tokenRecovery !== undefined) {
        try { validateTokenRecovery(this.state, accepted.tokenRecovery) }
        catch (error: unknown) { failure = error instanceof Error ? error.message : String(error) }
      }
      if (changesPhase || accepted.phase === 'running' && activeSimulationMaintenance(this.state) !== undefined) {
        try { foldEntry(this.state, { sequence: this.state.revision + 1, value: phase }, this.state.spec, this.backend, this.worldRuntime) }
        catch (error: unknown) { failure = (error as Error).message }
      }
      if (failure !== undefined) {
        await this.commit({ kind: 'run/management', runId: this.state.spec.runId, expectedRevision: this.state.revision,
          change: { kind: 'management/failed', id: accepted.id, error: failure } })
      } else {
        const recovery: unknown[] = []
        if (accepted.tokenRecovery !== undefined) {
          const quote = accepted.tokenRecovery
          recovery.push({ kind: 'run/business', runId: this.state.spec.runId, expectedRevision: this.state.revision,
            change: { kind: 'token/acknowledged', id: quote.reservationId } })
          if (quote.additionalTokens > 0) recovery.push({ kind: 'run/business', runId: this.state.spec.runId,
            expectedRevision: this.state.revision + recovery.length, change: { kind: 'budget/extended',
              request: { id: `token-recovery:${accepted.id}`, interval: quote.interval, budget: 'tokens', amount: quote.additionalTokens,
                reason: `Acknowledged original overrun ${quote.reservationId}` } } })
          const window = this.state.activeWindowId === undefined ? undefined : this.state.windows?.[this.state.activeWindowId]
          if (window !== undefined && window.request.decisions.every(value =>
            !['open', 'submitted'].includes(requireDecision(this.state, value.id).status)))
            recovery.push({ kind: 'run/business', runId: this.state.spec.runId, expectedRevision: this.state.revision + recovery.length,
              change: { kind: 'window/closed', id: this.state.activeWindowId } })
        }
        await this.commitValues([...changesPhase ? [phase] : [], ...recovery, { kind: 'run/management', runId: this.state.spec.runId,
          expectedRevision: this.state.revision + (changesPhase ? 1 : 0) + recovery.length,
          change: { kind: 'management/completed', id: accepted.id } }])
      }
      return structuredClone(get() as import('@clocky/clocky-simulation').SimulationManagementOperation)
    }, accepted.phase === 'paused' ? 'control' : 'mutation')
  }

  setPhase(phase: 'paused' | 'running', expectedRevision: number, authorize: () => void = () => {}): Promise<SimulationSnapshot> {
    return this.enqueue(async () => {
      authorize()
      this.assertRevision(expectedRevision)
      if (phase === 'running') { assertSimulationMaintenanceAdmission(this.state); assertRunControlAdmission(this.state) }
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
    let consumption: ((decision: SimulationDecision) => Promise<import('@clocky/clocky-simulation').SimulationContextConsumption>) | undefined
    let admission: { state: 'unconfigured' | 'closed' } | { state: 'open'; authorize: () => Promise<void> } = { state: canAdmit ? 'unconfigured' : 'closed' }
    const authorize = async (): Promise<void> => {
      if (admission.state !== 'open') throw new Error('Simulation writer has no live decision admission owner')
      const current = admission
      await current.authorize()
      if (admission !== current) throw new Error('Simulation writer retired during decision admission')
      const entity = requireWriterEpoch(this.state, entityId, epoch)
      if (entity.readiness !== 'ready' || entity.writer?.phase !== 'active'
        || entity.writer.coordinatorId !== this.coordinatorId) throw new Error('Simulation writer cannot admit a decision')
    }
    const owned = (id: SimulationDecisionId) => {
      const decision = requireDecision(this.state, id)
      assertDecisionOwner(decision, entityId, epoch)
      return decision
    }
    return {
      blockCompactionModelAdmission: (request, pool, requestHash) => {
        const accepted = simulationCompactionTokenRequestSchema.parse(request), usage = simulationModelPoolUsageSchema.parse(pool)
        const hash = z.string().regex(/^[a-f0-9]{64}$/).parse(requestHash)
        return this.enqueue(async () => {
          await authorize()
          const original = this.state.compactionAdmissionBlocks?.find(value => value.entityId === entityId
            && value.request.compactionId === accepted.compactionId)
          if (original !== undefined) {
            if (original.epoch !== epoch || original.requestHash !== hash
              || !isDeepStrictEqual(original.request, accepted) || !isDeepStrictEqual(original.pool, usage)) {
              throw new Error('Simulation compaction refusal changed on retry')
            }
            return structuredClone(original)
          }
          const decision = Object.values(this.state.decisions).find(value => value.entityId === entityId && value.epoch === epoch
            && value.status === 'open' && currentDecision(this.state, value))
          const records: BusinessRecord[] = [{ kind: 'compaction/model-blocked', entityId, epoch, request: accepted, pool: usage,
            requestHash: hash,
            ...decision === undefined ? {} : { decisionId: decision.id } }]
          if (decision?.windowId !== undefined && this.state.windows?.[decision.windowId]?.request.decisions.every(value =>
            value.id === decision.id || !['open', 'submitted'].includes(requireDecision(this.state, value.id).status))) {
            records.push({ kind: 'window/closed', id: decision.windowId })
          }
          await this.commitBusiness(records)
          const block = this.state.compactionAdmissionBlocks?.at(-1)
          if (block === undefined) throw new Error('Simulation compaction refusal was not retained')
          return structuredClone(block)
        })
      },
      failContextIntegrity: id => this.enqueue(async () => {
        await authorize()
        const decision = owned(id)
        if (decision.status === 'cancelled' && this.state.stall?.code === 'SIM_CONTEXT_INTEGRITY'
          && this.state.stall.decisionId === id) return structuredClone(decision)
        const records: BusinessRecord[] = [{ kind: 'decision/context-failed', id }]
        if (decision.windowId !== undefined && this.state.windows?.[decision.windowId]?.request.decisions.every(value =>
          value.id === id || !['open', 'submitted'].includes(requireDecision(this.state, value.id).status)))
          records.push({ kind: 'window/closed', id: decision.windowId })
        await this.commitBusiness(records)
        return structuredClone(owned(id))
      }),
      blockRequestBudget: (id, block) => {
        const accepted = simulationRequestBudgetBlockSchema.parse(block)
        return this.enqueue(async () => {
          await authorize()
          const decision = owned(id)
          if (decision.requestBudgetBlock !== undefined) {
            if (!isDeepStrictEqual(decision.requestBudgetBlock, accepted)) throw new Error('Request-budget retry changed its original measurement')
            return structuredClone(decision)
          }
          const records: BusinessRecord[] = [{ kind: 'decision/request-budget-blocked', id, block: accepted }]
          if (decision.windowId !== undefined && this.state.windows?.[decision.windowId]?.request.decisions.every(value =>
            value.id === id || !['open', 'submitted'].includes(requireDecision(this.state, value.id).status)))
            records.push({ kind: 'window/closed', id: decision.windowId })
          await this.commitBusiness(records)
          return structuredClone(owned(id))
        })
      },
      blockModelAdmission: (id, block) => {
        const accepted = simulationModelAdmissionBlockSchema.parse(block)
        return this.enqueue(async () => {
          await authorize()
          const decision = owned(id)
          if (decision.modelAdmissionBlock !== undefined) {
            if (!isDeepStrictEqual(decision.modelAdmissionBlock, accepted)) throw new Error('Simulation model refusal changed on retry')
            return structuredClone(decision)
          }
          const records: BusinessRecord[] = [{ kind: 'decision/model-blocked', id, block: accepted }]
          if (decision.windowId !== undefined) {
            const window = this.state.windows?.[decision.windowId]
            if (window?.request.decisions.every(value => value.id === id
              || !['open', 'submitted'].includes(requireDecision(this.state, value.id).status))) {
              records.push({ kind: 'window/closed', id: decision.windowId })
            }
          }
          await this.commitBusiness(records)
          return structuredClone(owned(id))
        })
      },
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
            if (!isDeepStrictEqual(decision.deterministic.policy,
              accepted)) throw new Error('Simulation deterministic policy changed on retry')
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
            if (!isDeepStrictEqual(decision.deterministic.proposals,
              accepted)) throw new Error('Simulation deterministic output changed on retry')
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
          const decision = owned(id)
          if (canCancelDecisionForPause(this.state, decision)) throw new SimulationDecisionPausedError(id)
          const reservationId = nextTokenId(this.state)
          await this.commitBusiness([{ kind: 'token/reserved', id: reservationId, decisionId: id, request: accepted }])
          return structuredClone(requireTokenReservation(this.state, reservationId))
        })
      },
      settleModelTokens: (id, outcome) => {
        const accepted = simulationTokenOutcomeSchema.parse(outcome)
        return this.enqueue(async () => {
          const reservation = requireTokenReservation(this.state, id)
          if (reservation.entityId !== entityId
            || reservation.epoch !== epoch) throw new Error('Simulation token reservation belongs to another writer')
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
          const records: BusinessRecord[] = [{ kind: 'decision/expired', id, expiredAt, stop: true }]
          if (decision.windowId !== undefined && this.state.windows?.[decision.windowId]?.request.decisions.every(value =>
            value.id === id || !['open', 'submitted'].includes(requireDecision(this.state, value.id).status)))
            records.push({ kind: 'window/closed', id: decision.windowId })
          await this.commitBusiness(records)
          return structuredClone(owned(id))
        })
      },
      recordContextConsumption: async (id) => {
        await authorize()
        const decision = owned(id)
        if (decision.consumption !== undefined) return structuredClone(decision.consumption)
        if (consumption === undefined) throw new Error('Simulation writer has no canonical consumption verifier')
        const receipt = simulationContextConsumptionSchema.parse(await consumption(structuredClone(decision)))
        return this.enqueue(async () => {
          await authorize()
          const current = owned(id)
          if (current.consumption !== undefined) {
            if (!isDeepStrictEqual(current.consumption, receipt)) throw new Error('Simulation consumption retry changed its receipt')
            return structuredClone(current.consumption)
          }
          await this.commitBusiness([{ kind: 'decision/consumed', id, receipt }])
          return structuredClone(owned(id).consumption as import('@clocky/clocky-simulation').SimulationContextConsumption)
        })
      },
      bindDecisionAdmission: (guard, consume) => {
        if (admission.state !== 'unconfigured') throw new Error('Simulation decision admission is already bound or closed')
        consumption = consume
        admission = { state: 'open', authorize: guard }
        this.windowAdmissions.set(entityId, { epoch, authorize })
      },
      openDecision: (id, expectedRevision, wakeId) => this.enqueue(async () => {
        if (Object.values(this.state.generationJobs ?? {}).some(value => value.job.assistantEntityId === entityId))
          throw new Error('Generation assistant has no world or tool effect authority')
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
            || this.state.phase !== 'running'
              && decision.context?.status !== 'overflow') throw new Error('Simulation context decision is no longer current')
          if (decision.context !== undefined) {
            if (decision.context.fingerprint !== businessFingerprint(parsed))
              throw new Error('Simulation context retry changed its candidates or policy')
            assertKnowledgeAccess(this.state, decision)
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
        if (canCancelDecisionForPause(this.state, decision)) throw new SimulationDecisionPausedError(id)
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
          if (parsed.length > 0 && Object.values(this.state.generationJobs ?? {})
            .some(value => value.job.assistantEntityId === decision.entityId))
            throw new Error('Generation assistant has no world or tool effect authority')
          if (decision.worldSubmissionBlock !== undefined) {
            if (simulationWorldSubmissionHash(parsed) !== decision.worldSubmissionBlock.proposalHash) {
              throw new Error('Simulation rejected world submission changed its original payload')
            }
            const failure = decision.worldSubmissionBlock.failure
            throw failure.code === 'SIM_WORLD_LIMIT'
              ? new SimulationWorldError(failure.code, 'Original world submission exceeded its retained quota', failure.limit)
              : new SimulationWorldError(failure.code, 'Original world submission lacked its exact authority')
          }
          if (decision.status !== 'accepted') assertKnowledgeAccess(this.state, decision)
          try {
            const finishedAt = decision.status === 'open' && decision.inference !== undefined ? Date.now() : undefined
            if (finishedAt !== undefined && decision.inference !== undefined && finishedAt >= decision.inference.deadline) {
              const records: BusinessRecord[] = [{ kind: 'decision/expired', id, expiredAt: finishedAt, stop: true }]
              if (decision.windowId !== undefined && this.state.windows?.[decision.windowId]?.request.decisions.every(value =>
                value.id === id || !['open', 'submitted'].includes(requireDecision(this.state, value.id).status)))
                records.push({ kind: 'window/closed', id: decision.windowId })
              await this.commitBusiness(records)
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
            assertWorldAdmission(this.state, parsed, this.worldRuntime)
            const records = acceptanceRecords(this.state, decision, parsed, this.worldRuntime)
            const accepted = records[0] as Extract<BusinessRecord, { kind: 'decision/accepted' }>
            if (decision.status === 'accepted') {
              if (decision.fingerprint !== accepted.fingerprint)
                throw new Error('Simulation decision id was reused with a different payload')
              return structuredClone(decision)
            }
            await this.acceptDecision(decision, parsed, finishedAt)
            return structuredClone(owned(id))
          } catch (error) {
            await this.recordWorldSubmissionBlock(id, parsed, error)
            throw error
          }
        })
      },
      cancelDecisionForPause: id => this.enqueue(async () => {
        await authorize()
        const decision = owned(id)
        if (decision.status === 'cancelled' && decision.cancellation === 'paused') return structuredClone(decision)
        if (!canCancelDecisionForPause(this.state, decision)) return undefined
        const records: BusinessRecord[] = [{ kind: 'decision/paused', id }]
        if (decision.windowId !== undefined && this.state.windows?.[decision.windowId]?.request.decisions.every(value =>
          value.id === id || !['open', 'submitted'].includes(requireDecision(this.state, value.id).status))) {
          records.push({ kind: 'window/closed', id: decision.windowId })
        }
        await this.commitBusiness(records)
        return structuredClone(owned(id))
      }),
      cancelDecision: id => this.enqueue(async () => {
        const decision = owned(id)
        if (decision.status === 'cancelled') return structuredClone(decision)
        const records: BusinessRecord[] = [{ kind: 'decision/cancelled', id }]
        const overrun = this.state.stall?.code === 'SIM_TOKEN_RESERVATION_EXCEEDED'
          ? this.state.tokenReservations?.[this.state.stall.reservationId] : undefined
        if (overrun !== undefined && (overrun.decisionId === id
          || overrun.compactionId !== undefined && overrun.entityId === decision.entityId && overrun.epoch === decision.epoch)
          && decision.windowId !== undefined && this.state.windows?.[decision.windowId]?.request.decisions.every(value =>
          value.id === id || !['open', 'submitted'].includes(requireDecision(this.state, value.id).status)))
          records.push({ kind: 'window/closed', id: decision.windowId })
        await this.commitBusiness(records)
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
    changes: readonly { kind: string; change: BusinessRecord | SchedulerRecord | OutboxRecord | WorldEvidenceRecord }[],
  ): Promise<void> {
    return this.commitValues(changes.map((entry, index) => ({ ...entry, runId: this.state.spec.runId,
      expectedRevision: this.state.revision + index })))
  }

  private assertRevision(expectedRevision: number): void {
    if (expectedRevision !== this.state.revision) throw new SimulationRevisionConflictError(expectedRevision, this.state.revision)
  }

  private commit(value: unknown): Promise<void> { return this.commitValues([value]) }

  private async commitValues(values: readonly unknown[]): Promise<void> {
    const batch = [...values]
    let next = foldEntries(this.state, batch.map((value, index) => ({ sequence: this.state.revision + index + 1, value })),
      this.state.spec, this.backend, this.worldRuntime)
    for (const change of hiringResourceSchedulerRecords(next)) {
      const value = { kind: 'run/scheduler', runId: next.spec.runId, expectedRevision: next.revision, change }
      batch.push(value)
      next = foldEntries(next, [{ sequence: next.revision + 1, value }], this.state.spec, this.backend, this.worldRuntime)
    }
    for (const change of worldEvidenceExhaustionRecords(next)) {
      const value = { kind: 'run/world-evidence', runId: next.spec.runId, expectedRevision: next.revision, change }
      batch.push(value)
      next = foldEntries(next, [{ sequence: next.revision + 1, value }], this.state.spec, this.backend, this.worldRuntime)
    }
    for (const change of worldEvidenceDeadlineRecords(next)) {
      const value = { kind: 'run/scheduler', runId: next.spec.runId, expectedRevision: next.revision, change }
      batch.push(value)
      next = foldEntries(next, [{ sequence: next.revision + 1, value }], this.state.spec, this.backend, this.worldRuntime)
    }
    if (this.state.world !== undefined && next.world !== undefined && !isDeepStrictEqual(next.world.evidence, this.state.world.evidence)) {
      const asks = Object.keys(next.world.evidence.challenges).some(id => !Object.hasOwn(this.state.world?.evidence.challenges ?? {}, id))
      const limit = asks ? next.world.definition.limits.maxBytesPerPlan : next.world.definition.limits.maxBytesPerRequest
      if (Buffer.byteLength(JSON.stringify(batch), 'utf8') > limit)
        throw new SimulationWorldError('SIM_WORLD_LIMIT',
          'Complete evidence transition and scheduler batch exceeds its frozen allowance', 'bytes')
    }
    const financialChange = Object.values(next.resourceReservations).some(hold => hold.world !== undefined
      && !isDeepStrictEqual(hold, this.state.resourceReservations[hold.id]))
    if (financialChange && next.world !== undefined
      && Buffer.byteLength(JSON.stringify(batch), 'utf8') > next.world.definition.limits.maxBytesPerPlan)
      throw new SimulationWorldError('SIM_WORLD_LIMIT',
        'Complete hiring resource and scheduler batch exceeds its frozen plan allowance', 'bytes')
    for (const decision of Object.values(next.decisions)) {
      if (decision.status !== 'accepted' || decision.worldExpansion === undefined
        || this.state.decisions[decision.id]?.status === 'accepted') continue
      const first = decision.operationIds[0], action = first === undefined ? undefined : next.operations[first]?.action
      if (action?.kind !== 'world/request' && action?.kind !== 'world/resolve' && action?.kind !== 'world/evidence')
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World acceptance lost its original expanded operation')
      const limits = requireWorld(next).definition.limits
      const limit = action.kind === 'world/resolve' ? limits.maxBytesPerPlan : limits.maxBytesPerRequest
      if (Buffer.byteLength(JSON.stringify(batch), 'utf8') > limit)
        throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Complete World acceptance exceeds its original envelope allowance', 'bytes')
    }
    if (next.runControl?.current.target != null && !batch.some(value => typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'run/control')) {
      const change = { kind: 'control/refresh' as const, recordedAt: Date.now() }
      const projected = foldRunControl(next, change, next.revision + 1, this.worldRuntime)
      if (!isDeepStrictEqual(projected.runControl, next.runControl) || projected.phase !== next.phase) {
        const value = { kind: 'run/control', runId: next.spec.runId, expectedRevision: next.revision, change }
        batch.push(value)
        next = foldEntries(next, [{ sequence: next.revision + 1, value }], this.state.spec, this.backend, this.worldRuntime)
      }
    }
    assertRunControlProjection(next)
    assertMaintenanceProjection(next)
    assertWorldBootstrapProjection(next)
    assertWriterProjection(next)
    assertBusinessProjection(next, this.worldRuntime)
    assertWorldEvidenceDeadlineProjection(next)
    assertWorldGovernanceProjection(next); assertCalendarCommands(next)
    assertGovernanceDeadlineProjection(next)
    assertNormAnnouncementProjection(next)
    assertNormProjection(next)
    assertWorldExecutionTimeProjection(next)
    assertExternalAdjudicatedEventProjection(next)
    assertExternalAdjudicationProjection(next)
    assertSchedulerProjection(next, this.worldRuntime)
    const previousRevision = this.state.revision
    const result = await this.stream.append(previousRevision, batch)
    this.state = next
    this.committed(this.snapshot(), result.tailSequence, previousRevision)
  }

  private enqueue<T>(action: () => T | Promise<T>,
    mode: 'mutation' | 'retirement' | 'read' | 'checkpoint' | 'control' = 'mutation'): Promise<T> {
    if (this.closing && mode !== 'retirement') return Promise.reject(new Error('Simulation run is closed'))
    // New pause/cancel intent may invalidate a held reference; its old cut still cannot publish the changed prefix.
    if (this.checkpointBarrier !== undefined && mode !== 'read' && mode !== 'checkpoint' && mode !== 'control'
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
      if (!this.inspectionOnly && Object.values(this.state.entities).some(entity => entity.writer !== undefined
        && entity.writer.phase !== 'released')) {
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
