import { addAbortListener } from 'node:events'
import { validateCheckpointOwners } from './restore.ts'
import { simulationCheckpointRestoreRequestSchema } from '@clocky/clocky-simulation'
import { simulationCheckpointRequestSchema, assertCanonicalTeam } from '@clocky/clocky-simulation'
import { collectCheckpoint } from './checkpoint.ts'
import { SimulationTaskAuthority } from './task-transport.ts'
import { compactionStream } from './compaction.ts'
import { compactionRequestReference } from '@clocky/clocky-compaction'
import { meteredStream } from './metered-stream.ts'
import { summarizeKnowledge } from './summary.ts'
import { modelKnowledge, policyKnowledge, assertReportReferences, missingReportReferences } from './knowledge.ts'
import { executeDeterministic } from './deterministic.ts'
import { simulationPolicyRefSchema } from '@clocky/clocky-simulation'
import { SimulationBootstrapAuthority } from './bootstrap.ts'
import { ensureResident } from './residency.ts'
import { SimulationModelCapacity } from './model-capacity.ts'
import { SimulationDeadlines } from './deadline.ts'
import { executeDecision } from './decision.ts'
import { SimulationChannelAuthority } from './channels.ts'
import { SimulationParticipantAuthority } from './participants.ts'
import { modelAccess, SIMULATION_MODEL_TOOLS } from './model.ts'
import type {} from '@clocky/clocky-tools'
import { SimulationInvitationAuthority } from './invitation.ts'
import { driveTeam } from './driver.ts'
import { SimulationDeliveryAuthority } from './delivery.ts'
import { SimulationPostAuthority } from './transport.ts'
import { decisionInput, inputState } from './input.ts'
import { callConfigEquals, type StreamChunk } from '@clocky/clocky-llm'
/** Local cognition integration enforced by the existing activation controller. @module @clocky/clocky-simulation-team */
import z from '@clocky/schemastery'
import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@clocky/cordis'
import { SessionId } from '@clocky/clocky-session'
import { isInProcessAgentRuntimeProvider } from '@clocky/clocky-agent-runtime-in-process'
import type { Agent } from '@clocky/clocky-agent'
import type { AgentRuntimeProvider } from '@clocky/clocky-agent-runtime'
import type { ActivationBindingSnapshot, TeamId } from '@clocky/clocky-team'
import type { TeamActivationCoordinationLease, TeamActivationLifecycleOwner } from '@clocky/clocky-team-activation-controller'
import type { SimulationDecisionId, SimulationEntity, SimulationEntityId, SimulationRun, SimulationWriterActivation, SimulationWriterLease } from '@clocky/clocky-simulation'
import type { SimulationInputDispatch, SimulationTeamConnection, SimulationModelRequest, SimulationModelResult } from './types.ts'
export type * from './types.ts'
export { SIMULATION_MODEL_TOOLS } from './model.ts'

declare module '@clocky/cordis' {
  interface Context { simulationTeams: SimulationTeams }
}

/** Context budget and bounded recipient discovery for Simulation cognition. */
export interface Config {
  /** Maximum simultaneously reserved or executing Simulation model streams across this service. */
  readonly maxConcurrentModels: number
  /** Maximum model requests waiting for a permit; zero rejects when all permits are held. */
  readonly maxQueuedModels: number
  /** Positive bound on the JSON-encoded content-block array; the model route still owns its total token limit. */
  readonly maxContextBytes: number
  /** Maximum pending channel deliveries read per discovery page. */
  readonly deliveryPageSize: number
  /** Maximum local-drive/Team-IO rounds in one coordinator call. */
  readonly maxCoordinationRounds: number
}

/** Named run attachments using durable Team rules to prevent controller bypass. */
export class SimulationTeams extends Service {
  static inject = ['simulations', 'teams', 'teamActivations', 'agentRuntimes', 'agents', 'sessions', 'sessionPersistence', 'llm', 'tools']
  static Config: z<Config> = z.object({ maxContextBytes: z.number().min(1).step(1).required(),
    maxConcurrentModels: z.number().min(1).step(1).required(), maxQueuedModels: z.number().min(0).step(1).required(),
    deliveryPageSize: z.number().min(1).step(1).required(), maxCoordinationRounds: z.number().min(1).step(1).required() })
  private taskAuthority?: SimulationTaskAuthority
  private readonly summaryPolicies = new Map<import('@clocky/clocky-simulation').SimulationPolicyId, import('@clocky/clocky-simulation').SimulationSummaryPolicy>()
  private readonly deterministicPolicies = new Map<import('@clocky/clocky-simulation').SimulationPolicyId, import('@clocky/clocky-simulation').SimulationDeterministicPolicy>()
  private readonly bootstrap: SimulationBootstrapAuthority
  private readonly modelCapacity: SimulationModelCapacity
  private readonly participants: SimulationParticipantAuthority
  private readonly channels: SimulationChannelAuthority
  private readonly modelHandlers = new WeakMap<Agent, ReturnType<typeof modelAccess>>()
  private readonly invitationAuthority: SimulationInvitationAuthority
  private readonly deliveryAuthority: SimulationDeliveryAuthority
  private readonly postAuthority: SimulationPostAuthority
  private readonly restorations = new Set<Promise<import('./types.ts').SimulationCheckpointRestoration>>()
  private closing = false
  private readonly attached = new Map<SimulationRun, SimulationTeamConnection>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'simulationTeams')
    if (!Number.isSafeInteger(config.maxConcurrentModels) || config.maxConcurrentModels < 1
      || !Number.isSafeInteger(config.maxQueuedModels) || config.maxQueuedModels < 0) throw new Error('Simulation model capacity limits are invalid')
    this.modelCapacity = new SimulationModelCapacity(config.maxConcurrentModels, config.maxQueuedModels)
    this.bootstrap = new SimulationBootstrapAuthority(ctx, () => !this.closing)
    this.participants = new SimulationParticipantAuthority(ctx)
    this.invitationAuthority = new SimulationInvitationAuthority(ctx)
    this.channels = new SimulationChannelAuthority(ctx, this.invitationAuthority)
    this.postAuthority = new SimulationPostAuthority(ctx)
    this.deliveryAuthority = new SimulationDeliveryAuthority(ctx, config.deliveryPageSize)
    if (!Number.isSafeInteger(config.maxCoordinationRounds) || config.maxCoordinationRounds < 1) throw new Error('Simulation coordination limit must be a positive safe integer')
    if (!Number.isSafeInteger(config.deliveryPageSize) || config.deliveryPageSize < 1) throw new Error('Simulation delivery page size must be a positive safe integer')
    if (!Number.isSafeInteger(config.maxContextBytes) || config.maxContextBytes < 1) throw new Error('Simulation context byte budget must be a positive safe integer')
    ctx.effect(() => async () => {
      this.closing = true
      this.modelCapacity.close()
      const connections = Promise.allSettled([...this.attached.values()].map(connection => connection.close()))
      await this.bootstrap.drain()
      await Promise.allSettled([...this.restorations])
      const results = await connections
      const failures = results.filter(result => result.status === 'rejected').map((result): unknown => result.reason)
      if (failures.length > 0) throw new AggregateError(failures, 'Simulation Team service retains unconfirmed activations')
    })
  }

  /**
   * Open an existing run, verify a completed manifest and every retained owner suffix, then retire old writers.
   * @param selection - Exact existing run configuration; create mode rejects.
   * @param request - Completed checkpoint id, required implementation version and owner-movement retry bound.
   * @param signal - Optional cancellation; admitted controller cleanup is still drained.
   * @returns caller-owned run and connection, paused without model calls or outbox effects. Repeated restores
   * revalidate current retained suffixes; they never roll state back to the checkpoint. Retired decision windows
   * close only after every slot is accepted or cancelled; restoration never accepts a submitted proposal.
   */
  restore(selection: import('@clocky/clocky-simulation').SimulationRunSelection,
    request: import('@clocky/clocky-simulation').SimulationCheckpointRestoreRequest, signal?: AbortSignal):
  Promise<import('./types.ts').SimulationCheckpointRestoration> {
    this.assertOpen()
    const accepted = simulationCheckpointRestoreRequestSchema.parse(request)
    if (selection.mode !== 'open') return Promise.reject(new Error('Checkpoint restoration requires an existing run'))
    const check = (): void => { this.assertOpen(); signal?.throwIfAborted() }
    const work = (async () => {
      check()
      const run = await this.ctx.simulations.open(selection)
      try {
        check()
        const operation = run.snapshot().checkpoints?.[accepted.id]
        if (operation?.status !== 'completed') throw new Error('Checkpoint restoration requires a completed manifest')
        const manifest = operation.manifest
        if (manifest.implementationVersion !== accepted.implementationVersion) throw new Error('Checkpoint implementation version differs')
        const ownerName = await validateCheckpointOwners(this.ctx, run, manifest, accepted.maxAttempts, check, signal)
        check()
        if (run.snapshot().phase !== 'paused') await run.setPhase('paused', run.snapshot().revision)
        check()
        const connection = await this.attach(run, manifest.team.owner.teamId, ownerName)
        const team = await this.ctx.teams.getTeam({ teamId: manifest.team.owner.teamId })
        for (const entity of Object.values(run.snapshot().entities)) {
          check()
          if (entity.binding === undefined) continue
          const participant = team.participants.find(value => value.id === entity.binding?.participantId)
          const reserved = participant?.activationReservation
          if (entity.writer !== undefined && entity.writer.phase !== 'released'
            || reserved !== undefined && reserved.releasedAt === undefined
              && !team.activations.some(value => value.reservationId === reserved.id)
            || team.activations.some(value => value.activation.participantId === entity.binding?.participantId
              && value.quiescedAt === undefined)) {
            await connection.recover(entity.id)
          }
        }
        check()
        const settled = run.snapshot()
        if (settled.activeWindowId !== undefined) {
          const window = settled.windows?.[settled.activeWindowId]
          if (window === undefined || window.request.decisions.some((slot) => {
            const status = settled.decisions[slot.id]?.status
            return status !== 'accepted' && status !== 'cancelled'
          })) throw new Error('Checkpoint recovery retains an unsettled decision window')
          await run.commitWindow(window.id)
          check()
        }
        return { run, connection, manifest }
      } catch (error: unknown) {
        try { await run.close() }
        catch (cleanup: unknown) { throw new AggregateError([error, cleanup], 'Checkpoint recovery cleanup failed') }
        throw error
      }
    })()
    this.restorations.add(work)
    void work.then(() => this.restorations.delete(work), () => this.restorations.delete(work))
    return work
  }

  /**
   * Inspect host-local Simulation model admission across all attached runs.
   * @returns reserved/executing permits, queued requests and their configured limits.
   */
  modelUsage(): { readonly active: number; readonly queued: number; readonly limit: number; readonly queueLimit: number } {
    return this.modelCapacity.snapshot()
  }

  /**
   * Create or reconcile the run's canonical execution Team before attaching its lifecycle owner.
   * @param run - Open, unattached run whose root identity is journal-owned.
   * @param creation - Explicit Team goal, budgets and optional authority grant.
   * @param ownerName - Immutable lifecycle owner used by the subsequent attachment.
   * @returns the confirmed Team; target response loss reuses the reserved identity.
   */
  ensureTeam(run: SimulationRun, creation: Omit<import('@clocky/clocky-team').TeamRootCreateInput, 'rules'>,
    ownerName: string): Promise<import('@clocky/clocky-team').TeamStateSnapshot> {
    this.assertOpen()
    if (this.attached.has(run)) return Promise.reject(new Error('Simulation bootstrap requires an unattached run'))
    return this.bootstrap.ensure(run, creation, ownerName)
  }

  /**
   * Register a versioned pure summary policy over explicitly selected authorized knowledge.
   * @param policy - Bounded synchronous, IO-free transformation; ambient histories must not be read.
   * @returns effect-scoped disposer; retained summaries do not depend on the implementation remaining loaded.
   */
  registerSummaryPolicy(policy: import('@clocky/clocky-simulation').SimulationSummaryPolicy): () => void {
    this.assertOpen()
    const ref = simulationPolicyRefSchema.parse({ id: policy.id, version: policy.version })
    const entry = { ...ref, summarize: policy.summarize }
    // oxlint-disable-next-line typescript/no-misused-promises -- Cordis effects return callable asynchronous disposers.
    return this.ctx.effect(() => {
      if (this.summaryPolicies.has(entry.id)) throw new Error('Simulation summary policy is already registered')
      this.summaryPolicies.set(entry.id, entry)
      return () => { this.summaryPolicies.delete(entry.id) }
    })
  }

  /**
   * Register an effect-scoped pure computation policy; duplicate ids reject even across versions.
   * @param policy - Explicit identity/version and bounded synchronous computation over a frozen authorized view.
   * @returns disposer stopping new computation; already recorded outputs remain durable.
   */
  registerDeterministicPolicy(policy: import('@clocky/clocky-simulation').SimulationDeterministicPolicy): () => void {
    this.assertOpen()
    const ref = simulationPolicyRefSchema.parse({ id: policy.id, version: policy.version })
    const entry = { ...ref, decide: policy.decide }
    // oxlint-disable-next-line typescript/no-misused-promises -- Cordis effects return callable asynchronous disposers.
    return this.ctx.effect(() => {
      if (this.deterministicPolicies.has(entry.id)) throw new Error('Simulation deterministic policy is already registered')
      this.deterministicPolicies.set(entry.id, entry)
      return () => { this.deterministicPolicies.delete(entry.id) }
    })
  }

  /**
   * Execute a model operation using its actual current Agent identity.
   * @param agent - Registry-owned local caller, supplied by tool execution.
   * @param request - Observation, replacement proposals or submission without caller-selected identities.
   * @param signal - Calling tool cancellation.
   * @returns authorized observations or proposal acknowledgement, never fabricated world results.
   */
  modelRequest(agent: Agent, request: SimulationModelRequest, signal: AbortSignal): Promise<SimulationModelResult> {
    const handler = this.modelHandlers.get(agent)
    if (handler === undefined || this.ctx.agents.get(agent.id) !== agent) return Promise.reject(new Error('Agent has no Simulation decision authority'))
    return handler(request, signal)
  }

  /**
   * Attach one run to a dedicated Team whose immutable activationLifecycleOwner rule names this owner.
   * @param run - Caller-owned open run.
   * @param teamId - Canonical Team selected by the deployment.
   * @param ownerName - Exact durable rule value, unique in this controller.
   * @returns a connection that derives entity identity and drains activation ownership on close.
   */
  async attach(run: SimulationRun, teamId: TeamId, ownerName: string): Promise<SimulationTeamConnection> {
    this.assertOpen()
    const checkIdentity = (): void => {
      const current = run.snapshot()
      assertCanonicalTeam(current, teamId)
      if (current.teamReservation !== undefined && !current.teamReservation.confirmed) {
        throw new Error('Simulation attachment requires its confirmed canonical Team')
      }
    }
    checkIdentity()
    const state = await this.ctx.teams.getTeam({ teamId })
    this.assertOpen()
    checkIdentity()
    if (state.rules['activationLifecycleOwner'] !== ownerName || ownerName.length === 0
      || state.rules['simulationRunId'] !== run.snapshot().spec.runId) {
      throw new Error('Simulation Team requires its exact durable activation lifecycle owner')
    }
    if (this.attached.has(run)) throw new Error('Simulation run is already attached to a Team')
    for (const entity of Object.values(run.snapshot().entities)) {
      if (entity.binding !== undefined && entity.binding.teamId !== teamId) throw new Error('Simulation run belongs to another canonical Team')
    }
    const entityFor = (participantId: string, sessionId: string): SimulationEntity => {
      const entity = Object.values(run.snapshot().entities).find(value => value.binding?.teamId === teamId
        && value.binding.participantId === participantId && value.binding.sessionId === sessionId)
      if (entity === undefined) throw new Error('Activation has no exact Simulation entity binding')
      return entity
    }
    const runtime = (name: string): AgentRuntimeProvider => {
      const provider = this.ctx.agentRuntimes.getProvider(name)
      if (provider === undefined || !isInProcessAgentRuntimeProvider(provider)) throw new Error('Simulation cognition requires the actual in-process runtime provider')
      return provider
    }
    let admitted = true
    const checkpointRequests = new Map<import('@clocky/clocky-simulation').SimulationCheckpointId, {
      request: import('@clocky/clocky-simulation').SimulationCheckpointRequest
      work: Promise<import('@clocky/clocky-simulation').SimulationCheckpointOperation>
    }>()
    let checkpointing: symbol | undefined
    let checkpointWork: Promise<import('./types.ts').SimulationCheckpointCollection> | undefined
    let checkpointRelease: (() => void) | undefined
    const assertAdmitted = (): void => {
      this.assertOpen()
      if (!admitted) throw new Error('Simulation Team connection is closed')
      if (checkpointing !== undefined) throw new Error('Simulation checkpoint collection blocks new admission')
    }
    const canPublish = (): boolean => admitted && checkpointing === undefined && !this.closing
    const admissionAbort = new AbortController()
    const modelCapacity = this.modelCapacity
    const sleeping = new Map<SimulationEntityId, { actor: Agent; activationId: import('@clocky/clocky-team').ActivationId; work?: Promise<void> }>()
    const assertActorAdmission = (id: SimulationEntityId): void => {
      this.assertOpen(); assertAdmitted()
      if (sleeping.has(id)) throw new Error('Simulation actor is closing admission for hibernation')
    }
    const writers = new Map<SimulationEntityId, SimulationWriterLease>()
    const auxiliaryStreams = new Set<{ writer: SimulationWriterLease; cancellation: AbortController; done: Promise<void> }>()
    const retireAuxiliary = async (writer: SimulationWriterLease): Promise<void> => {
      const pending = [...auxiliaryStreams].filter(stream => stream.writer === writer)
      for (const stream of pending) stream.cancellation.abort(new Error('Simulation auxiliary writer is retiring'))
      await Promise.all(pending.map(stream => stream.done))
    }
    const deadlines = new SimulationDeadlines((error) =>{  ctx.logger.warn('Simulation deadline persistence failed', error) })
    const owner: TeamActivationLifecycleOwner = {
      name: ownerName,
      reserve: async (request, reservation) => {
        if (request.teamId !== teamId) throw new Error('Simulation lifecycle owner cannot start another Team')
        if (request.seed.kind === 'fork') throw new Error('Simulation cognition does not admit forked Session history')
        const entity = entityFor(request.participantId, request.sessionId)
        assertActorAdmission(entity.id)
        const provider = runtime(request.provider)
        const writer = await run.reserveWriter(entity.id, request.provider, reservation.reservationId, run.snapshot().revision)
        let agent: Agent | undefined
        let actual: ActivationBindingSnapshot | undefined
        writer.bindDecisionAdmission(async () => {
          assertActorAdmission(entity.id)
          if (agent === undefined || actual === undefined || this.ctx.agents.get(agent.id) !== agent) {
            throw new Error('Simulation decision has no current local Agent')
          }
          const current = await this.ctx.teams.getTeam({ teamId })
          assertAdmitted()
          const member = current.participants.find(value => value.id === request.participantId)
          const epoch = current.activations.find(value => value.activation.id === actual?.activation.id)
          if (current.team.phase !== 'active' || member?.phase !== 'active'
            || epoch === undefined || epoch.quiescedAt !== undefined || epoch.fencedAt !== undefined
            || (epoch.activation.status !== 'idle' && epoch.activation.status !== 'running')) {
            throw new Error('Simulation decision authority is no longer active')
          }
        })
        writers.set(entity.id, writer)
        const scoped = coordination(writer, provider)
        return { ...scoped,
          bind: async (binding, local) => {
            await scoped.bind(binding, local)
            // The coordination lease rejects missing or mismatched actors before returning.
            const actor = local as Agent
            agent = actor; actual = binding
            this.modelHandlers.set(actor, modelAccess(actor, run, writer, () => {
              assertAdmitted()
              if (ctx.agents.get(actor.id) !== actor) throw new Error('Simulation model Agent is no longer current')
            }, (id) => { deadlines.finish(id) }))
          },
          revoke: async () => {
            await scoped.revoke()
            if (writers.get(entity.id) === writer) writers.delete(entity.id)
            await retireAuxiliary(writer)
          },
          checkpoint: async () => {
            if (agent !== undefined && (checkpointing !== undefined || sleeping.has(entity.id))
              && !await ctx.sessions.flush(agent.session)) {
              throw new Error('Simulation hibernation requires durable Session storage')
            }
          },
          release: async () => {
            if (agent !== undefined) {
              await deadlines.retire(agent)
            }
            await scoped.release()
            if (agent !== undefined) this.modelHandlers.delete(agent)
          },
        }
      },
      recover: async (binding) => {
        if (binding.activation.teamId !== teamId || binding.recovery !== undefined) throw new Error('Simulation does not support external activation recovery')
        const entity = entityFor(binding.activation.participantId, binding.sessionId)
        runtime(binding.provider)
        const writer = await run.recoverWriter(entity.id, activationFacts(binding))
        return coordination(writer)
      },
      recoverReservation: async (reservation) => {
        if (reservation.teamId !== teamId) throw new Error('Simulation lifecycle owner cannot recover another Team')
        const entity = entityFor(reservation.participantId, reservation.sessionId)
        runtime(reservation.provider)
        const writer = await run.recoverUnpublishedWriter(entity.id, {
          teamId, participantId: reservation.participantId, sessionId: reservation.sessionId,
          provider: reservation.provider, reservationId: reservation.reservationId,
        })
        if (writer !== undefined) return coordination(writer)
        return {
          localTerminationConfirmed: true,
          // No writer reservation exists, so this startup never passed the controller's domain admission.
          /* v8 ignore next -- this retirement-only receipt is never passed to the controller's startup bind path. */
          bind: () => Promise.reject(new Error('Unadmitted startup cannot become an active writer')),
          revoke: async () => {}, release: async () => {},
        }
      },
    }
    const unregister = this.ctx.teamActivations.registerLifecycleOwner(owner)
    let closed: Promise<void> | undefined
    let removeRetirement: (() => void) | undefined
    const allowedTools = new Set<string>(SIMULATION_MODEL_TOOLS)
    const removeToolGuard = this.ctx.tools.guard(exec => exec.agent?.session.header.teamId === teamId && !allowedTools.has(exec.name)
      ? 'Simulation actors may only observe, stage and submit through Simulation tools' : undefined)
    const removePreStep = this.ctx.on('agent/pre-step', async ({ agent }, next) => {
      if (agent.session.header.teamId !== teamId) return await next()
      assertAdmitted()
      // Session validation requires participantId whenever teamId is present.
      const entity = entityFor(agent.session.header.participantId as string, agent.session.id)
      const writer = writers.get(entity.id)
      const id = Object.values(run.snapshot().decisions).find(decision => decision.entityId === entity.id && decision.status === 'open')?.id
      if (writer === undefined || id === undefined) throw new Error('Simulation model request has no current decision owner')
      if (run.snapshot().decisions[id]?.deterministic !== undefined) throw new Error('Simulation deterministic decisions cannot request inference')
      let prepared = await writer.readPreparedContext(id)
      if (prepared.maxBytes !== this.config.maxContextBytes) throw new Error('Simulation context policy changed; cancel the decision before preparing another')
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const missing = missingReportReferences(run.snapshot(), prepared.referencedReports ?? [],
        [...agent.session.deriveMessages(), ...decision.messages])
      if (missing.length > 0) {
        const rebased = await writer.materializeCompactedReports(id, missing)
        if (rebased.status !== 'prepared') throw new Error('Simulation compacted report context exceeds its required byte budget')
        prepared = rebased
      }
      const visible = agent.session.surface.nodes.map(seq => agent.session.events[seq])
        .filter(event => event?.type === 'simulation/context-view')
      if (visible.length > 1) throw new Error('Simulation Session has multiple active context views')
      const current = visible[0]
      if (current?.type === 'simulation/context-view' && current.data.inputId === prepared.view.inputId
        && !isDeepStrictEqual(current.data, prepared.view)) await writer.validateContextPresentation(id, current.data)
      if (current?.type !== 'simulation/context-view' || !isDeepStrictEqual(current.data, prepared.view)) {
        agent.session.append('simulation/context-view', prepared.view, current === undefined ? { surfaceOp: 'append' } : {
          surfaceOp: { op: 'replace', start: current.seq, end: current.seq }, sourceEventSeqs: [current.seq],
        })
      }
      if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Simulation model context requires durable Session storage')
      await writer.readPreparedContext(id)
      return decision
    }, { prepend: true })
    const ctx = this.ctx
    const removeStream = ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
      const compaction = compactionRequestReference(options)
      const session = compaction?.session
        ?? (options.sessionId === undefined ? undefined : ctx.sessions.get(options.sessionId))
      if (session?.header.teamId !== teamId) return next()
      return (async function* (): AsyncIterable<StreamChunk> {
        assertAdmitted()
        const entity = entityFor(session.header.participantId as string, session.id)
        const writer = writers.get(entity.id)
        const id = Object.values(run.snapshot().decisions).find(decision => decision.entityId === entity.id && decision.status === 'open')?.id
        if (options.purpose === 'compaction' || compaction !== undefined) {
          const actor = ctx.agents.get(session.id)
          if (writer === undefined || actor === undefined) throw new Error('Simulation compaction requires its current canonical actor')
          const cancel = new AbortController()
          const done = Promise.withResolvers<void>()
          const owned = { writer, cancellation: cancel, done: done.promise }
          const signal = AbortSignal.any([admissionAbort.signal, cancel.signal, ...options.signal === undefined ? [] : [options.signal]])
          auxiliaryStreams.add(owned)
          try {
            yield* compactionStream(actor, writer, options, next, modelCapacity, signal, () => {
              assertActorAdmission(entity.id)
              if (ctx.agents.get(actor.id) !== actor || writers.get(entity.id) !== writer) throw new Error('Simulation compaction actor retired')
            }, () => ctx.sessions.flush(session))
          } finally { auxiliaryStreams.delete(owned); done.resolve() }
          return
        }
        if (writer === undefined || id === undefined || options.purpose !== undefined) {
          throw new Error('Simulation model dispatch requires its current conversation decision')
        }
        const prepared = await writer.readPreparedContext(id)
        const preparedInput = decisionInput(prepared.view)
        const actor = ctx.agents.get(session.id)
        if (actor === undefined || inputState(actor, preparedInput) !== 'consumed') {
          throw new Error('Simulation model dispatch has not consumed its exact prepared input')
        }
        const assertRecordedRequest = (): void => {
          const turn = session.events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
          if (actor.status !== 'running' || turn?.type !== 'turn/start'
            || !session.events.slice(turn.seq + 1).some(event => event.type === 'user/message' && event.surfaceOp === 'append'
              && event.data.id === preparedInput.id)) {
            throw new Error('Simulation model dispatch requires its prepared input in the active Agent turn')
          }
          const header = session.requestHeader()
          if (header === undefined || !callConfigEquals(options, header.config) || options.system !== header.system
            || !isDeepStrictEqual(options.tools ?? [], header.tools ?? [])) {
            throw new Error('Simulation model request differs from its recorded request header')
          }
          assertReportReferences(run.snapshot(), prepared.referencedReports ?? [], options.messages)
          const views = session.surface.nodes.map(seq => session.events[seq]).filter(event => event?.type === 'simulation/context-view')
          const view = views[0]
          if (views.length !== 1 || view?.type !== 'simulation/context-view' || !isDeepStrictEqual(view.data, prepared.view)
          || !isDeepStrictEqual(options.messages, session.deriveMessages())) {
            throw new Error('Simulation model request differs from its recorded decision context or conversation')
          }
        }
        assertRecordedRequest()
        if (!await ctx.sessions.flush(session)) throw new Error('Simulation model dispatch requires durable Session storage')
        await writer.readPreparedContext(id)
        options.signal?.throwIfAborted()
        await deadlines.start(writer, id, actor, prepared.view.inputId)
        const signal = options.signal === undefined ? admissionAbort.signal : AbortSignal.any([options.signal, admissionAbort.signal])
        const release = await modelCapacity.acquire(signal)
        try {
          signal.throwIfAborted()
          assertAdmitted()
          await writer.readPreparedContext(id)
          assertRecordedRequest()
          await deadlines.start(writer, id, actor, prepared.view.inputId)
          signal.throwIfAborted()
          const reservation = await writer.reserveModelTokens(id, { sessionSequence: session.events.length - 1,
            provider: options.provider, model: options.model })
          yield* meteredStream(writer, reservation, next, async () => {
            signal.throwIfAborted()
            assertAdmitted()
            await writer.readPreparedContext(id)
            assertRecordedRequest()
          }, () => ctx.sessions.flush(session), signal)
        } finally { release() }
      })()
    }, { prepend: true })
    const taskReconciliations = new Set<Promise<import('@clocky/clocky-simulation').SimulationInteraction>>()
    const modelDecisions = new Map<Promise<import('@clocky/clocky-simulation').SimulationDecision>, Agent>()
    const summaries = new Set<Promise<import('@clocky/clocky-simulation').SimulationKnowledge>>()
    const deterministicRuns = new Map<SimulationEntityId, { id: SimulationDecisionId; wakeId: import('@clocky/clocky-simulation').SimulationEventId | undefined; policy: import('@clocky/clocky-simulation').SimulationPolicyRef; work: Promise<import('@clocky/clocky-simulation').SimulationDecision> }>()
    const inputs = new Map<SimulationEntityId, { id: SimulationDecisionId; work: Promise<SimulationInputDispatch> }>()
    const dispatchInput = async (entityId: SimulationEntityId, id: SimulationDecisionId): Promise<SimulationInputDispatch> => {
      assertActorAdmission(entityId)
      const writer = writers.get(entityId)
      const binding = requireEntity(run, entityId).binding
      const agent = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
      if (agent === undefined) throw new Error('Simulation input has no current local actor')
      const recorded = run.snapshot().decisions[id]
      if (recorded?.deterministic !== undefined) throw new Error('Simulation deterministic decisions cannot dispatch model input')
      if (recorded?.entityId !== entityId || recorded.context?.status !== 'prepared') throw new Error('Simulation input has no owned prepared decision')
      const input = decisionInput(recorded.context.view)
      if (inputState(agent, input) === 'consumed') {
        if (!await ctx.sessions.flush(agent.session)) throw new Error('Simulation consumed input requires durable Session storage')
        assertAdmitted()
        return { status: 'consumed', inputId: recorded.context.view.inputId }
      }
      if (writer === undefined) throw new Error('Simulation input has no current writer')
      const prepared = await writer.readPreparedContext(id)
      if (agent.status === 'running') return { status: 'in-flight', inputId: prepared.view.inputId }
      return await agent.runMaintenance(async (signal) => {
        await writer.readPreparedContext(id)
        for (const previous of Object.values(run.snapshot().decisions)) {
          if (previous.entityId !== entityId || previous.status === 'open' || previous.context?.status !== 'prepared') continue
          const obsolete = decisionInput(previous.context.view)
          if (inputState(agent, obsolete) === 'queued') agent.inbox.remove(obsolete.id)
        }
        if (inputState(agent, input) === 'absent') agent.send(input, 'next-turn', false)
        if (!await ctx.sessions.flush(agent.session)) throw new Error('Simulation queued input requires durable Session storage')
        await writer.readPreparedContext(id)
        signal.throwIfAborted()
        assertActorAdmission(entityId)
        if (!agent.wakePending(input.id)) throw new Error('Simulation queued input is no longer available to wake')
        return { status: 'queued', inputId: prepared.view.inputId }
      })
    }
    const transport = this.postAuthority.transport(run, teamId, ownerName, canPublish)
    const receiving = new Map<import('@clocky/clocky-simulation').SimulationOperationId, Promise<import('@clocky/clocky-simulation').SimulationEventId>>()
    const deliveryReconciliations = new Set<Promise<'retained-input' | 'absent-input' | 'entity-terminated'>>()
    const recoveries = new Set<Promise<void>>()
    const dispatches = new Set<Promise<import('@clocky/clocky-simulation').SimulationDispatchResult>>()
    let driving: { until: import('@clocky/clocky-simulation').SimTime; work: Promise<import('./types.ts').SimulationTeamDriveResult> } | undefined
    let residentDrive: Promise<import('./types.ts').SimulationTeamDriveResult> | undefined
    const placements = new Map<SimulationEntityId, Promise<import('./types.ts').SimulationResidencyResult>>()
    const activations = new Set<Promise<import('@clocky/clocky-team-activation-controller').TeamActivationLease>>()
    const runDrive = (request: import('@clocky/clocky-simulation').SimulationDriveRequest, clock: () => number,
      ensure?: (id: SimulationEntityId) => Promise<'resident' | 'capacity' | 'recovery-required'>) =>
      driveTeam(run, connection, request, clock, this.config.maxCoordinationRounds, (id) => {
        const entity = run.inspectEntity(id).entity
        const actor = entity?.binding === undefined ? undefined : ctx.agents.get(entity.binding.sessionId)
        if (sleeping.has(id) || entity?.phase !== 'active' || entity.writer?.phase !== 'active' || actor === undefined) return 'unavailable'
        return actor.status === 'running' ? 'busy' : 'ready'
      }, id => this.deliveryAuthority.observeFailure(run, id, teamId, canPublish), assertAdmitted, ensure)
    const recoverEntity = async (entityId: SimulationEntityId, check: () => void): Promise<void> => {
      check()
      const binding = requireEntity(run, entityId).binding
      if (binding === undefined) throw new Error('Simulation entity has no cognition binding')
      const latest = await this.ctx.teams.getTeam({ teamId })
      const reservation = latest.participants.find(value => value.id === binding.participantId)?.activationReservation
      const activation = latest.activations.filter(value => value.activation.participantId === binding.participantId).at(-1)
      check()
      if (reservation !== undefined && !latest.activations.some(value => value.reservationId === reservation.id)) {
        await this.ctx.teamActivations.recoverCoordinatedReservation({
          teamId, participantId: binding.participantId, reservationId: reservation.id,
        })
      } else {
        if (activation === undefined) throw new Error('Simulation entity has no durable activation to recover')
        await this.ctx.teamActivations.recoverCoordinatedLocal({
          teamId, participantId: binding.participantId, activationId: activation.activation.id,
        })
      }
    }
    const connection: SimulationTeamConnection = {
      ensureResident: (entityId, choice) => {
        assertActorAdmission(entityId)
        if (placements.has(entityId)) return Promise.reject(new Error('Simulation residency transition is already in progress'))
        const work = ensureResident(run, connection, entityId, choice.activation, choice.evict, (id) => {
          const binding = run.inspectEntity(id).entity?.binding
          return binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
        }, () => { this.assertOpen(); assertAdmitted() })
        placements.set(entityId, work)
        void work.then(() => { placements.delete(entityId) }, () => { placements.delete(entityId) })
        return work
      },
      driveResident: (request, clock, choose) => {
        this.assertOpen(); assertAdmitted()
        if (residentDrive !== undefined) return Promise.reject(new Error('Simulation resident drive is already in progress'))
        if (driving !== undefined) return Promise.reject(new Error('Simulation coordinator is already driving'))
        const work = runDrive(request, clock, async id => (await connection.ensureResident(id, choose(id))).status)
        residentDrive = work
        void work.then(() => { residentDrive = undefined }, () => { residentDrive = undefined })
        return work
      },
      checkpoint: (request, signal) => {
        this.assertOpen()
        const accepted = simulationCheckpointRequestSchema.parse(request)
        const existing = checkpointRequests.get(accepted.id)
        if (existing !== undefined) {
          if (!isDeepStrictEqual(existing.request, accepted)) return Promise.reject(new Error('Checkpoint id changed its request'))
          return existing.work
        }
        assertAdmitted()
        const work = (async () => {
          const operation = await run.beginCheckpoint(accepted)
          if (operation.status !== 'in-progress') return operation
          let candidate: import('./types.ts').SimulationCheckpointCollection | undefined
          try {
            candidate = await connection.collectCheckpointCandidate(accepted.maxDrainRounds, accepted.maxAttempts, signal)
            return await candidate.publish(accepted.id)
          } catch (error: unknown) {
            candidate?.release()
            const prior = run.snapshot().checkpoints?.[accepted.id]
            if (prior?.status === 'completed') return prior
            return await run.failCheckpoint(accepted.id, error instanceof Error ? error.message : String(error))
          } finally { candidate?.release() }
        })()
        checkpointRequests.set(accepted.id, { request: accepted, work })
        void work.then(() => { checkpointRequests.delete(accepted.id) }, () => { checkpointRequests.delete(accepted.id) })
        return work
      },
      collectCheckpointCandidate: (maxDrainRounds, maxAttempts, signal) => {
        this.assertOpen(); assertAdmitted(); signal?.throwIfAborted()
        if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(maxDrainRounds) || maxDrainRounds < 1) {
          return Promise.reject(new TypeError('Checkpoint collection bounds must be positive safe integers'))
        }
        const token = Symbol('checkpoint-collection')
        checkpointing = token
        let cut: import('@clocky/clocky-simulation').SimulationCheckpointCut | undefined
        let released = false
        const release = (): void => {
          released = true
          cut?.release()
          if (checkpointing === token) checkpointing = undefined
          if (checkpointRelease === release) checkpointRelease = undefined
        }
        const check = (): void => {
          this.assertOpen(); signal?.throwIfAborted()
          if (!admitted || released || checkpointing !== token) throw new Error('Checkpoint collection is no longer admitted')
        }
        const waitAccepted = async (work: Promise<unknown>): Promise<void> => {
          signal?.throwIfAborted()
          if (signal === undefined) { await work; return }
          const aborted = Promise.withResolvers<never>()
          const listener = addAbortListener(signal, () => { aborted.reject(signal.reason) })
          try { await Promise.race([work, aborted.promise]) }
          finally { listener[Symbol.dispose]() }
        }
        const work = (async () => {
          try {
            for (let attempt = 0; ; attempt += 1) {
              check()
              const revision = run.snapshot().revision
              try { await run.setPhase('paused', revision); break }
              catch (error: unknown) { if (attempt + 1 >= maxAttempts || run.snapshot().revision === revision) throw error }
            }
            await waitAccepted(Promise.allSettled([...placements.values(), ...activations, ...recoveries]))
            check()
            for (const entity of Object.values(run.snapshot().entities)) {
              if (entity.binding !== undefined && entity.writer?.phase !== 'released') {
                ctx.agents.get(entity.binding.sessionId)?.cancel({ kind: 'hook', reason: 'Simulation checkpoint collection' })
              }
            }
            await waitAccepted(Promise.allSettled([...receiving.values(), ...[...inputs.values()].map(value => value.work), ...summaries,
              ...[...sleeping.values()].flatMap(value => value.work === undefined ? [] : [value.work]),
              ...taskReconciliations, ...deliveryReconciliations, ...dispatches, ...modelDecisions.keys(),
              ...[...deterministicRuns.values()].map(value => value.work),
              ...residentDrive === undefined ? [] : [residentDrive], ...driving === undefined ? [] : [driving.work]]))
            check()
            const teamState = await ctx.teams.getTeam({ teamId })
            check()
            for (const entity of Object.values(run.snapshot().entities)) {
              const reservation = teamState.participants.find(value => value.id === entity.binding?.participantId)?.activationReservation
              const unpublished = reservation !== undefined && reservation.releasedAt === undefined
                && !teamState.activations.some(value => value.reservationId === reservation.id)
              if (entity.writer === undefined || entity.writer.phase === 'released') {
                if (unpublished) { await recoverEntity(entity.id, check); check() }
                continue
              }
              if (entity.binding === undefined) throw new Error('Checkpoint writer has no canonical binding')
              if (ctx.agents.get(entity.binding.sessionId) === undefined) {
                await recoverEntity(entity.id, check)
                check()
                if (run.inspectEntity(entity.id).entity?.writer?.phase !== 'released') {
                  throw new Error('Checkpoint writer recovery has not confirmed release')
                }
                continue
              }
              if (entity.writer.activationId === undefined) throw new Error('Checkpoint actor has no recorded activation')
              await ctx.teamActivations.stopOwnedActivation({ teamId: entity.binding.teamId, participantId: entity.binding.participantId,
                activationId: entity.writer.activationId })
              check()
            }
            await waitAccepted(Promise.all([this.participants.drain(run), this.channels.drain(run), this.invitationAuthority.drain(run)]))
            check()
            for (const entity of Object.values(run.snapshot().entities)) {
              if (entity.writer?.phase === 'released') sleeping.delete(entity.id)
            }
            const window = run.snapshot().activeWindowId
            if (window !== undefined) await run.commitWindow(window)
            cut = await run.acquireCheckpointCut(maxDrainRounds, signal)
            check()
            const collection = await collectCheckpoint(ctx, run, cut, teamId, ownerName, maxAttempts, check, release, signal)
            check()
            checkpointRelease = release
            return collection
          } catch (error: unknown) { release(); throw error }
        })()
        checkpointWork = work
        // Successful candidates cannot release admission before this handler runs; failures can admit an immediate retry.
        void work.then(() => { checkpointWork = undefined },
          () => { if (checkpointWork === work) checkpointWork = undefined })
        return work
      },
      hibernate: (entityId) => {
        this.assertOpen(); assertAdmitted()
        const entity = requireEntity(run, entityId)
        if (entity.writer?.phase === 'released') { sleeping.delete(entityId); return Promise.resolve() }
        let entry = sleeping.get(entityId)
        if (entry?.work !== undefined) return entry.work
        if (entry === undefined) {
          const actor = entity.binding === undefined ? undefined : ctx.agents.get(entity.binding.sessionId)
          if (actor === undefined || entity.writer?.activationId === undefined || entity.writer.phase !== 'active') {
            return Promise.reject(new Error('Simulation hibernation requires a current local activation'))
          }
          if (actor.status !== 'idle' || Object.values(run.snapshot().decisions).some(decision => decision.entityId === entityId
            && (decision.status === 'open' || decision.status === 'submitted'))) {
            return Promise.reject(new Error('Simulation hibernation requires an idle actor with settled decisions'))
          }
          entry = { actor, activationId: entity.writer.activationId }
          sleeping.set(entityId, entry)
        }
        const owned = entry
        const work = (async () => {
          const pending = [...receiving.entries()].filter(([id]) => {
            const operation = run.snapshot().operations[id]
            return operation?.action.kind === 'communication/post' && operation.action.recipient === entityId
          }).map(([, operation]) => operation)
          await Promise.all(pending)
          if (inputs.has(entityId)) await inputs.get(entityId)?.work
          if (requireEntity(run, entityId).writer?.phase === 'active') {
            await this.deliveryAuthority.restorePending(run, entityId, teamId, canPublish)
            await owned.actor.runMaintenance(async (signal) => {
              if (!await ctx.sessions.flush(owned.actor.session)) throw new Error('Simulation hibernation requires durable Session storage')
              signal.throwIfAborted()
            })
          }
          const binding = requireEntity(run, entityId).binding
          if (binding === undefined) throw new Error('Simulation hibernation lost its canonical binding')
          await ctx.teamActivations.stopOwnedActivation({ teamId, participantId: binding.participantId, activationId: owned.activationId })
          if (requireEntity(run, entityId).writer?.phase !== 'released') throw new Error('Simulation hibernation has no confirmed writer release')
          sleeping.delete(entityId)
        })().catch((error: unknown) => {
          delete owned.work
          if (requireEntity(run, entityId).writer?.phase === 'active') sleeping.delete(entityId)
          throw error
        })
        owned.work = work
        return work
      },
      resume: (entityId, request) => {
        assertActorAdmission(entityId)
        const entity = requireEntity(run, entityId)
        if (entity.writer?.phase !== 'released' || entity.writer.activationId === undefined) {
          return Promise.reject(new Error('Simulation resume requires a proven-stopped Session activation'))
        }
        return connection.activate(entityId, { ...request, seed: { kind: 'resume' } })
      },
      openWindow: async (request) => {
        this.assertOpen(); assertAdmitted()
        const state = run.snapshot()
        const existing = Object.hasOwn(state.windows ?? {}, request.id) ? state.windows?.[request.id] : undefined
        for (const decision of request.decisions) {
          assertActorAdmission(decision.entityId)
          if (existing === undefined && decision.policy !== undefined
            && this.deterministicPolicies.get(decision.policy.id)?.version !== decision.policy.version) {
            throw new Error('Simulation deterministic window policy version is not registered')
          }
          await this.deliveryAuthority.restorePending(run, decision.entityId, teamId, canPublish)
        }
        const team = await ctx.teams.getTeam({ teamId })
        this.assertOpen(); assertAdmitted()
        return await run.openWindow({ id: request.id, decisions: request.decisions.map((decision, index) => {
          const previous = existing?.request.decisions[index]?.context
          let context = decision.context
          if (decision.policy !== undefined) context = policyKnowledge(context)
          else if (previous === undefined && context.knowledge !== undefined) {
            const binding = requireEntity(run, decision.entityId).binding
            const actor = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
            if (actor === undefined) throw new Error('Simulation window requires its canonical actor')
            context = modelKnowledge(run, actor, decision.entityId, context, run.snapshot().revision)
          } else if (previous !== undefined && context.knowledge !== undefined && previous.knowledge?.visibleReports !== undefined) {
            context = { ...context, knowledge: { ...context.knowledge, visibleReports: [...previous.knowledge.visibleReports] } }
          }
          return { ...decision, context: { ...context, maxBytes: this.config.maxContextBytes,
            teamCursor: previous?.teamCursor ?? team.team.cursor } }
        }) }, run.snapshot().revision)
      },
      cancelDecision: (entityId, id) => {
        this.assertOpen(); assertAdmitted()
        const writer = writers.get(entityId)
        if (writer === undefined) return Promise.reject(new Error('Simulation decision has no current writer'))
        return writer.cancelDecision(id).then((decision) => { deadlines.finish(id); return decision })
      },
      executeDeterministicDecision: (entityId, id, context, policy, wakeId) => {
        assertActorAdmission(entityId)
        const selected = simulationPolicyRefSchema.parse(policy)
        const pending = deterministicRuns.get(entityId)
        if (pending !== undefined) {
          if (pending.id !== id || pending.wakeId !== wakeId || !isDeepStrictEqual(pending.policy, selected)) {
            return Promise.reject(new Error('Simulation actor already has another deterministic computation'))
          }
          return pending.work
        }
        const binding = requireEntity(run, entityId).binding
        const actor = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
        const writer = writers.get(entityId)
        if (actor === undefined || writer === undefined) return Promise.reject(new Error('Simulation deterministic decision requires its local writer'))
        const resolve = () => {
          const implementation = this.deterministicPolicies.get(selected.id)
          if (implementation?.version !== selected.version) throw new Error('Simulation deterministic policy version is not registered')
          return implementation
        }
        const work = executeDeterministic(run, connection, actor, writer, entityId, id, context, selected, resolve, () => {
          assertActorAdmission(entityId)
          if (ctx.agents.get(actor.id) !== actor || writers.get(entityId) !== writer) throw new Error('Simulation deterministic actor is no longer current')
        }, () => ctx.sessions.flush(actor.session), wakeId).then(async (decision) => {
          if (decision.status === 'accepted') {
            await this.deliveryAuthority.restorePending(run, entityId, teamId, canPublish)
          }
          return decision
        })
        deterministicRuns.set(entityId, { id, wakeId, policy: selected, work })
        void work.then(() => { deterministicRuns.delete(entityId) }, () => { deterministicRuns.delete(entityId) })
        return work
      },
      reconcileTask: (interactionId, expectedRevision, taskId) => {
        this.assertOpen(); assertAdmitted()
        const work = (async () => {
          const task = await ctx.teams.getTask({ teamId, taskId })
          this.assertOpen(); assertAdmitted()
          if (task.teamId !== teamId || task.id !== taskId) throw new Error('Simulation task owner returned another task')
          return await run.reconcileTask({ interactionId, expectedRevision,
            task: { teamId: task.teamId, taskId: task.id, revision: task.revision, phase: task.phase } })
        })()
        taskReconciliations.add(work)
        void work.then(() => { taskReconciliations.delete(work) }, () => { taskReconciliations.delete(work) })
        return work
      },
      summarizeKnowledge: (entityId, policy, request) => {
        this.assertOpen(); assertAdmitted()
        const selected = simulationPolicyRefSchema.parse(policy)
        const work = summarizeKnowledge(run, entityId, selected, request, () => {
          const implementation = this.summaryPolicies.get(selected.id)
          if (implementation?.version !== selected.version) throw new Error('Simulation summary policy version is not registered')
          return implementation
        }, () => { this.assertOpen(); assertAdmitted() })
        summaries.add(work)
        void work.then(() => { summaries.delete(work) }, () => { summaries.delete(work) })
        return work
      },
      executeDecision: (entityId, id, context, wakeId) => {
        const binding = requireEntity(run, entityId).binding
        const agent = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
        if (agent === undefined) return Promise.reject(new Error('Simulation decision has no current local actor'))
        const work = executeDecision(run, connection, agent, entityId, id, context, () => ctx.sessions.flush(agent.session), () => {
          this.assertOpen(); assertAdmitted()
          if (ctx.agents.get(agent.id) !== agent) throw new Error('Simulation decision actor is no longer current')
        }, wakeId)
        modelDecisions.set(work, agent)
        void work.then(() => { modelDecisions.delete(work) }, () => { modelDecisions.delete(work) })
        return work
      },
      ensureChannel: request => this.channels.ensure(run, request, teamId, ownerName, () => { this.assertOpen(); assertAdmitted() }),
      ensureParticipant: (entityId, participant) => {
        this.assertOpen(); assertAdmitted()
        runtime(participant.provider)
        return this.participants.ensure(run, entityId, participant, teamId, ownerName, () => { this.assertOpen(); assertAdmitted() })
      },
      reconcileDeliveryFailure: (id) => {
        assertAdmitted()
        const work = this.deliveryAuthority.reconcileFailure(run, id, teamId, canPublish)
        deliveryReconciliations.add(work)
        void work.then(() => { deliveryReconciliations.delete(work) }, () => { deliveryReconciliations.delete(work) })
        return work
      },
      invitation: (entityId) => {
        assertAdmitted()
        const entity = requireEntity(run, entityId)
        if (entity.phase !== 'active' || entity.binding?.teamId !== teamId) throw new Error('Simulation invitation requires an active bound entity')
        return { participantId: entity.binding.participantId, required: true, sessionId: entity.binding.sessionId }
      },
      acknowledgeInvitation: (entityId, channelId) => {
        assertAdmitted()
        return this.invitationAuthority.acknowledge(run, entityId, channelId, teamId, ownerName, canPublish)
      },
      drive: (request, clock) => {
        assertAdmitted()
        if (residentDrive !== undefined) return Promise.reject(new Error('Simulation resident drive is already in progress'))
        if (driving !== undefined) {
          if (driving.until !== request.until) return Promise.reject(new Error('Simulation coordinator already has another horizon in flight'))
          return driving.work
        }
        const work = runDrive(request, clock)
        driving = { until: request.until, work }
        void work.then(() => { driving = undefined }, () => { driving = undefined })
        return work
      },
      receiveOperation: (id) => {
        assertAdmitted()
        const current = receiving.get(id)
        if (current !== undefined) return current
        const operation = run.snapshot().operations[id]
        if (operation?.action.kind === 'communication/post') assertActorAdmission(operation.action.recipient)
        const work = this.deliveryAuthority.receive(run, id, teamId, ownerName, canPublish)
        receiving.set(id, work)
        void work.then(() => { receiving.delete(id) }, () => { receiving.delete(id) })
        return work
      },
      dispatchOperation: (id, clock) => {
        assertAdmitted()
        const operation = run.snapshot().operations[id]
        const target = operation?.action.kind === 'task/create'
          ? (this.taskAuthority ??= new SimulationTaskAuthority(this.ctx)).transport(run, teamId, ownerName, canPublish)
          : transport
        const work = run.dispatchOperation(id, target, clock)
        dispatches.add(work)
        void work.then(() => { dispatches.delete(work) }, () => { dispatches.delete(work) })
        return work
      },
      dispatchDecision: (entityId, id) => {
        const pending = inputs.get(entityId)
        if (pending !== undefined) {
          if (pending.id !== id) return Promise.reject(new Error('Simulation actor already has another input admission in flight'))
          return pending.work
        }
        const work = dispatchInput(entityId, id)
        inputs.set(entityId, { id, work })
        void work.then(() => { inputs.delete(entityId) }, () => { inputs.delete(entityId) })
        return work
      },
      prepareContext: async (entityId, id, request) => {
        assertActorAdmission(entityId)
        const writer = writers.get(entityId)
        if (writer === undefined) throw new Error('Simulation entity has no live decision authority')
        const current = await this.ctx.teams.getTeam({ teamId })
        assertAdmitted()
        const existing = run.snapshot().decisions[id]?.context
        const teamCursor = existing === undefined ? current.team.cursor : existing.teamCursor
        const state = run.snapshot()
        const decision = state.decisions[id]
        const binding = requireEntity(run, entityId).binding
        const actor = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
        if (actor === undefined || decision === undefined) throw new Error('Simulation context has no canonical actor decision')
        const material = decision.deterministic !== undefined ? policyKnowledge(request) : existing === undefined
          ? modelKnowledge(run, actor, entityId, request, decision.snapshotRevision)
          : { ...request, ...request.knowledge === undefined ? {} : { knowledge: { ...request.knowledge,
            ...existing.visibleReports === undefined ? {} : { visibleReports: [...existing.visibleReports] },
          } } }
        return await writer.prepareContext(id, { ...material, teamCursor, maxBytes: this.config.maxContextBytes })
      },
      openDecision: async (entityId, id, wakeId) => {
        assertActorAdmission(entityId)
        const writer = writers.get(entityId)
        if (writer === undefined) throw new Error('Simulation entity has no live decision authority')
        if (!Object.hasOwn(run.snapshot().decisions, id)) {
          await this.deliveryAuthority.restorePending(run, entityId, teamId, canPublish)
        }
        return await writer.openDecision(id, run.snapshot().revision, wakeId)
      },
      submitDecision: async (entityId, id, proposals) => {
        assertActorAdmission(entityId)
        const writer = writers.get(entityId)
        if (writer === undefined) throw new Error('Simulation entity has no live decision authority')
        return await writer.submitDecision(id, proposals)
      },
      bind: async (entityId, participantId) => {
        assertAdmitted()
        const entity = requireEntity(run, entityId)
        if (entity.binding !== undefined) {
          if (entity.binding.teamId !== teamId || entity.binding.participantId !== participantId) throw new Error('Simulation entity binding is permanent')
          return structuredClone(entity.binding)
        }
        const latest = await this.ctx.teams.getTeam({ teamId })
        const participant = latest.participants.find(value => value.id === participantId)
        if (participant?.kind !== 'local-agent' || participant.phase !== 'active'
          || latest.activations.some(value => value.activation.participantId === participantId)) {
          throw new Error('Simulation binding requires a fresh active local participant')
        }
        assertAdmitted()
        const binding = entity.participantReservation?.binding ?? { teamId, participantId, sessionId: SessionId(randomUUID()) }
        if (binding.participantId !== participantId) throw new Error('Simulation participant differs from its reserved identity')
        await run.bindEntity(entityId, binding, run.snapshot().revision)
        return binding
      },
      activate: async (entityId, request) => {
        assertActorAdmission(entityId)
        const binding = requireEntity(run, entityId).binding
        if (binding === undefined) throw new Error('Simulation entity has no cognition binding')
        runtime(request.provider)
        const work = (async () => {
          const latest = await this.ctx.teams.getTeam({ teamId })
          assertAdmitted()
          return await this.ctx.teamActivations.activate({ ...request, ...binding, expectedCursor: latest.team.cursor })
        })()
        activations.add(work)
        void work.then(() => activations.delete(work), () => activations.delete(work))
        return await work
      },
      recover: (entityId) => {
        const work = recoverEntity(entityId, assertAdmitted)
        recoveries.add(work)
        void work.then(() => { recoveries.delete(work) }, () => { recoveries.delete(work) })
        return work
      },
      close: () => {
        admitted = false
        checkpointRelease?.()
        admissionAbort.abort(new Error('Simulation connection is closed'))
        // Cancel turns before waiting, but keep their Sessions live through the final persistence barrier.
        for (const actor of modelDecisions.values()) actor.cancel({ kind: 'hook', reason: 'Simulation connection is closed' })
        closed ??= Promise.all([Promise.allSettled(checkpointWork === undefined ? [] : [checkpointWork]),
          Promise.allSettled([...checkpointRequests.values()].map(value => value.work)),
          this.participants.drain(run), this.channels.drain(run),
          this.invitationAuthority.drain(run), deadlines.close(),
          Promise.allSettled([...summaries]),
          Promise.allSettled([...taskReconciliations]),
          Promise.allSettled([...modelDecisions.keys()]),
          Promise.allSettled([...receiving.values(), ...deliveryReconciliations, ...recoveries]),
          Promise.allSettled([...sleeping.values()].flatMap(value => value.work === undefined ? [] : [value.work])),
          Promise.allSettled([...dispatches]),
          Promise.allSettled([...inputs.values()].map(value => value.work)),
          Promise.allSettled([...deterministicRuns.values()].map(value => value.work)),
          Promise.allSettled([...placements.values(), ...activations, ...residentDrive === undefined ? [] : [residentDrive],
            ...driving === undefined ? [] : [driving.work]])])
          .then(() => unregister()).then(() => {
            removeRetirement?.()
            removeToolGuard(); removePreStep()
            removeStream()
            this.attached.delete(run)
          }).catch((error: unknown) => { closed = undefined; throw error })
        return closed
      },
    }
    try { removeRetirement = run.onClose(() => connection.close()) }
    catch (error) { removeToolGuard(); removePreStep(); removeStream(); await unregister(); throw error }
    this.attached.set(run, connection)
    this.ctx.effect(() => () => connection.close())
    return connection
  }
  private assertOpen(): void { if (this.closing) throw new Error('Simulation Team service is closed') }
}

function requireEntity(run: SimulationRun, id: SimulationEntityId): SimulationEntity {
  const entity = run.inspectEntity(id).entity
  if (entity === undefined) throw new Error('Simulation entity does not exist')
  return entity
}
function activationFacts(binding: ActivationBindingSnapshot): SimulationWriterActivation {
  if (binding.reservationId === undefined) throw new Error('Simulation activation has no durable startup reservation')
  return { teamId: binding.activation.teamId, participantId: binding.activation.participantId,
    sessionId: binding.sessionId, activationId: binding.activation.id,
    reservationId: binding.reservationId, provider: binding.provider }
}
function coordination(writer: SimulationWriterLease, provider?: AgentRuntimeProvider): TeamActivationCoordinationLease {
  return {
    ...provider === undefined ? {} : { runtimeProvider: provider },
    localTerminationConfirmed: writer.priorCoordinatorExited,
    bind: async (binding, agent) => {
      if (agent === undefined || agent.session.id !== binding.sessionId
        || agent.session.header.teamId !== binding.activation.teamId
        || agent.session.header.participantId !== binding.activation.participantId) {
        throw new Error('Simulation writer requires its exact controller-owned local Agent')
      }
      await writer.activate(activationFacts(binding))
    },
    revoke: () => writer.revoke(), release: () => writer.release(),
  }
}
export default SimulationTeams
