/** Exact-generation execution dispatch; Native journals remain the authority for unsettled responsibilities. */
import { SimulationWorldDomainRegistry, SimulationWorldDomainError, retainWorldExecutionCatalog,
  worldExecutionRequestSchema } from '@clocky/clocky-simulation'
import { isDeepStrictEqual } from 'node:util'
import type { SimulationSnapshot, SimulationWorldPlan, WorldPlanId, SimulationWorldDomainDefinition,
  SimulationWorldDomainImplementation, SimulationWorldDomainLease, SimulationRun,
  WorldExecutionReason, WorldExecutionObservation, SimulationWorldDomainPin } from '@clocky/clocky-simulation'
import type { SimulationWorldDriveResult } from './types.ts'

/** Installed runtime adapter with pure responsibility inspection and explicit reconciliation. */
export interface WorldExecutionHandler extends SimulationWorldDomainImplementation {
  /**
   * Settle at most one deterministic domain transition between decision windows, before another drive or clock advance.
   * @returns true only after one durable transition; false without work. Native must recheck productive phase and eligibility
   * in its write queue. This callback performs no inference/provider IO and is never called by paused reconciliation or reads.
   */
  settleBoundary?(): Promise<boolean>
  /**
   * Inspect whether an accepted plan can currently begin, without reserving identities or performing IO.
   * @param plan - Exact retained plan selected through its original implementation pin.
   * @returns a safe waiting reason, or undefined when execution may try the authoritative Native admission.
   */
  readiness?(plan: SimulationWorldPlan): SimulationWorldDriveResult['reason'] | undefined
  /**
   * Select only this implementation's original Native responsibilities requiring reconciliation.
   * @returns exact accepted plan IDs; inspecting responsibility performs no IO or inference.
   */
  reconciliationPlans(): readonly WorldPlanId[]
  /** Exact strict parser set shared with Native admission. */
  readonly definition: SimulationWorldDomainDefinition
  /**
   * Execute the original accepted plan outside Native's write queue.
   * @param plan - Exact pinned accepted plan.
   * @returns a stable stop or undefined after settlement; unknown IO rejects and retains its responsibility.
   */
  execute(plan: SimulationWorldPlan): Promise<SimulationWorldDriveResult['reason'] | undefined>
  /**
   * Reconcile retained responsibility without new inference or automatic resume.
   * @param plan - Original pinned plan.
   * @returns completion only after the original responsibility settles.
   */
  reconcile(plan: SimulationWorldPlan): Promise<void>
  /**
   * Inspect domain-owned Native facts without IO or releasing occupancy.
   * @param plan - Original pinned plan.
   * @returns true while accepted preparation/IO needs this exact implementation, including unknown outcomes.
   */
  retainsResponsibility(plan: SimulationWorldPlan): boolean
}

/** One run's dispatch keeps original implementations held across failed or unknown IO. */
export class WorldExecutionDispatcher {
  private readonly registry = new SimulationWorldDomainRegistry<WorldExecutionHandler>()

  private readonly leases = new Map<WorldPlanId, SimulationWorldDomainLease<WorldExecutionHandler>>()
  private readonly closed = new Set<WorldExecutionHandler>()
  private readonly active = new Map<WorldExecutionHandler, Set<Promise<unknown>>>()
  private readonly executing = new Set<WorldPlanId>()
  private readonly handlers = new Set<WorldExecutionHandler>()
  private boundary: Promise<boolean> | undefined

  /** @param run - Authoritative caller-owned Native run; construction performs no IO or inference. */
  constructor(private readonly run: { snapshot(): Pick<SimulationSnapshot, 'world' | 'phase' | 'activeWindowId'> }
    & Pick<SimulationRun, 'recordWorldExecution'>) {}

  /**
   * Capture the exact plan payload contract before its model-visible context is journaled.
   * @param pin - Original request's complete installed operation identity.
   * @returns detached input JSON schema; retired or mismatched providers refuse before preparation.
   */
  planSchema(pin: SimulationWorldDomainPin): ReturnType<SimulationWorldDomainDefinition['schemas']['plan']['toJSONSchema']> {
    const lease = this.registry.acquire(pin)
    try { return lease.implementation.definition.schemas.plan.toJSONSchema({ io: 'input', reused: 'ref' }) }
    finally { lease.release() }
  }

  /** Require the complete original manifest and retained payloads before any run-bound callback can enter. */
  validateProviders(): void { retainWorldExecutionCatalog(this.run.snapshot(), this.registry)() }

  /**
   * Admit one bounded native-only domain transition through its exact frozen implementation lease.
   * @returns shared admitted progress; paused/open-window calls do nothing. Disposal closes new callbacks and drains an admitted one.
   */
  settleBoundary(): Promise<boolean> {
    if (this.boundary !== undefined) return this.boundary
    const work = this.settleNextBoundary().finally(() => { this.boundary = undefined })
    this.boundary = work
    return work
  }

  private async settleNextBoundary(): Promise<boolean> {
    for (const pin of this.run.snapshot().world?.definition.operations ?? []) {
      const state = this.run.snapshot()
      if (state.phase !== 'running' || state.activeWindowId !== undefined) return false
      const lease = this.registry.acquire(pin), handler = lease.implementation
      const settle = handler.settleBoundary?.bind(handler)
      if (settle === undefined) { lease.release(); continue }
      const active = this.active.get(handler) ?? new Set<Promise<unknown>>()
      this.active.set(handler, active)
      const task = Promise.resolve().then(() => settle()).finally(() => {
        lease.release()
        active.delete(task)
      })
      active.add(task)
      if (await task) return true
    }
    return false
  }

  /**
   * Register a provider under its exact schema/artifact/generation.
   * @param handler - Trusted domain adapter; duplicate/loose registrations reject.
   * @returns disposer which closes fresh execution immediately and drains admitted callbacks; unresolved
   * Native duty rejects with implementation-unavailable while retaining its original lease for reconciliation.
   */
  register(handler: WorldExecutionHandler): () => Promise<void> {
    const close = this.registry.register(handler.definition, handler)
    this.handlers.add(handler)
    return async () => {
      this.closed.add(handler)
      const drained = close()
      const active = this.active.get(handler)
      while (active?.size) await Promise.allSettled([...active])
      if ([...this.leases.values()].some(lease => lease.implementation === handler)) {
        throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_UNAVAILABLE',
          'Original Native responsibilities remain unresolved after execution admission closed')
      }
      await drained
      this.handlers.delete(handler)
    }
  }

  /**
   * Settle domain-selected retained responsibilities through their exact original implementations.
   * @returns the number of reconciled original plans; no domain name selects behavior.
   */
  async reconcilePending(): Promise<number> {
    let count = 0
    const reconciled = new Set<WorldPlanId>()
    for (const handler of this.handlers) {
      const unresolved = Object.values(this.run.snapshot().world?.executions ?? {}).filter(value =>
        (value.phase === 'armed' || value.phase === 'outcome-unknown') && value.pin.implementationRef === handler.ref
        && value.pin.generation === handler.generation).map(value => value.planId)
      for (const id of new Set([...handler.reconciliationPlans(), ...unresolved])) {
        if (reconciled.has(id)) continue
        const plan = this.run.snapshot().world?.plans[id]
        if (plan === undefined || plan.pin.implementationRef !== handler.ref || plan.pin.generation !== handler.generation)
          throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_MISMATCH', 'Responsibility lost its original accepted implementation')
        await this.reconcile(plan)
        reconciled.add(id)
        count++
      }
    }
    return count
  }

  /**
   * Execute only the recorded implementation, retaining its lease when Native duty remains.
   * @param plan - Original accepted plan.
   * @returns stable domain stop or settlement; missing/replaced providers explicitly reject.
   */
  async execute(plan: SimulationWorldPlan): Promise<SimulationWorldDriveResult['reason'] | undefined> {
    this.assertIdle(plan)
    let lease: SimulationWorldDomainLease<WorldExecutionHandler>
    try { lease = this.acquire(plan) }
    catch (error) {
      if (error instanceof SimulationWorldDomainError && error.code === 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE')
        await this.blocked(plan, 'implementation-unavailable')
      throw error
    }
    if (this.closed.has(lease.implementation)) {
      await this.blocked(plan, 'implementation-unavailable')
      throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_UNAVAILABLE', 'The original implementation closed fresh execution')
    }
    const prior = this.run.snapshot().world?.executions[plan.id]
    if (prior?.phase === 'armed' || prior?.phase === 'outcome-unknown') throw new SimulationWorldDomainError('SIM_WORLD_CONFLICT',
      'Unconfirmed original execution requires reconciliation before another execution callback')
    return this.invoke(plan, lease, 'execute', () => lease.implementation.execute(plan))
  }

  /**
   * Retain an actual readiness or admission refusal without executing the plan or overwriting uncertain IO.
   * @param plan - Exact original plan whose executor reported this blocker.
   * @param reason - Typed executor observation, never diagnostic prose or a run-wide stop.
   * @returns after the original Native record is durable; identical observations do not append.
   */
  async blocked(plan: SimulationWorldPlan, reason: WorldExecutionReason): Promise<void> {
    const prior = this.run.snapshot().world?.executions[plan.id]
    if (prior?.phase === 'armed' || prior?.phase === 'outcome-unknown') return
    await this.observe(plan, 'blocked', 'execute', reason)
  }

  /**
   * Read the original handler's pure readiness while preserving unknown responsibilities and exact generation selection.
   * @param plan - Original accepted Native plan; replacements or altered payloads reject.
   * @returns safe waiting reason or undefined; this does not execute a callback or manufacture a new plan.
   */
  readiness(plan: SimulationWorldPlan): SimulationWorldDriveResult['reason'] | undefined {
    this.assertIdle(plan)
    const lease = this.acquire(plan)
    try {
      if (this.closed.has(lease.implementation)) throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_UNAVAILABLE',
        'The original implementation closed fresh execution')
      return lease.implementation.readiness?.(plan)
    } finally { this.releaseSettled(plan, lease) }
  }

  /**
   * Reconcile only the original responsibility through its original leased provider.
   * @param plan - Retained accepted plan selected by Native maintenance.
   * @returns completion after exact duty settlement; no model or alternative implementation is selected.
   */
  async reconcile(plan: SimulationWorldPlan): Promise<void> {
    this.assertIdle(plan)
    const lease = this.acquire(plan)
    await this.invoke(plan, lease, 'reconcile', async () => {
      // Every supported adapter reserves Native responsibility before IO; no retained duty means there is nothing to resend.
      if (lease.implementation.retainsResponsibility(plan)) await lease.implementation.reconcile(plan)
      return undefined
    })
  }

  private invoke(plan: SimulationWorldPlan, lease: SimulationWorldDomainLease<WorldExecutionHandler>,
    mode: 'execute' | 'reconcile', call: () => Promise<SimulationWorldDriveResult['reason'] | undefined>):
  Promise<SimulationWorldDriveResult['reason'] | undefined> {
    const handler = lease.implementation, active = this.active.get(handler) ?? new Set<Promise<unknown>>()
    this.active.set(handler, active)
    this.executing.add(plan.id)
    const task = (async () => {
      // Persist before entering any handler: a process loss cannot erase the admitted callback responsibility.
      await this.observe(plan, 'armed', mode, null)
      let reason: SimulationWorldDriveResult['reason'] | undefined
      try {
        const phase = this.run.snapshot().phase
        reason = mode === 'execute' && phase !== 'running' && !(phase === 'paused' && plan.operationId === null) ? phase : await call()
      }
      catch (error) {
        try { await this.observe(plan, 'outcome-unknown', mode, 'callback-unconfirmed') }
        catch (recordError) { throw new AggregateError([error, recordError], 'Original callback and its observation both failed') }
        throw error
      }
      const uncertain = reason === 'retirement-unknown' || reason === 'outcome-unknown' || reason === 'recovery-required'
      await this.observe(plan, reason === undefined
        ? handler.retainsResponsibility(plan) ? 'outcome-unknown' : 'settled' : uncertain ? 'outcome-unknown' : 'blocked', mode,
      reason ?? (handler.retainsResponsibility(plan) ? 'callback-unconfirmed' : null))
      if (mode === 'reconcile' && handler.retainsResponsibility(plan)) throw new SimulationWorldDomainError('SIM_WORLD_CONFLICT',
        'Original reconciliation did not confirm settlement of its retained responsibility')
      return reason ?? (handler.retainsResponsibility(plan) ? 'recovery-required' : undefined)
    })().finally(() => {
      try { this.releaseSettled(plan, lease) }
      finally { active.delete(task); this.executing.delete(plan.id) }
    })
    active.add(task)
    return task
  }

  private observe(plan: SimulationWorldPlan, phase: WorldExecutionObservation['phase'], mode: 'execute' | 'reconcile',
    reason: WorldExecutionReason | null): Promise<WorldExecutionObservation> {
    const prior = this.run.snapshot().world?.executions[plan.id]
    return this.run.recordWorldExecution(worldExecutionRequestSchema.parse({ planId: plan.id, phase, mode, reason,
      expectedSequence: prior?.sequence ?? null }))
  }

  private assertIdle(plan: SimulationWorldPlan): void {
    if (this.executing.has(plan.id)) {
      throw new SimulationWorldDomainError('SIM_WORLD_CONFLICT', 'The original plan already has an admitted execution callback')
    }
  }

  private acquire(plan: SimulationWorldPlan): SimulationWorldDomainLease<WorldExecutionHandler> {
    const state = this.run.snapshot(), original = state.world?.plans[plan.id], request = state.world?.requests[plan.requestId]
    if (original === undefined || request === undefined || !isDeepStrictEqual(original, plan) || plan.proposal.resolution.kind !== 'apply')
      throw new SimulationWorldDomainError('SIM_WORLD_CONFLICT', 'Execution requires its exact retained Native apply plan')
    this.registry.parsePlan({ kind: 'world/plan', id: plan.id, requestId: plan.requestId, intentId: request.intentId,
      pin: plan.pin, requestRevision: request.sequence, supersedes: plan.proposal.supersedes,
      expectedTime: request.proposal.expectedTime, reads: plan.reads, authority: [], payload: plan.proposal.resolution.payload })
    const retained = this.leases.get(plan.id)
    if (retained !== undefined) return retained
    const lease = this.registry.acquire(plan.pin)
    this.leases.set(plan.id, lease)
    return lease
  }

  private releaseSettled(plan: SimulationWorldPlan, lease: SimulationWorldDomainLease<WorldExecutionHandler>): void {
    const observation = this.run.snapshot().world?.executions[plan.id]
    if (observation?.phase === 'armed' || observation?.phase === 'outcome-unknown') return
    if (lease.implementation.retainsResponsibility(plan)) return
    lease.release()
    this.leases.delete(plan.id)
  }
}
