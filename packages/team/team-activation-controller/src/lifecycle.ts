/** Durable-rule-selected lifecycle coordination outside Team/channel locks. @module @clocky/clocky-team-activation-controller/lifecycle */
import type { Context } from '@clocky/cordis'
import type { AgentRuntimeProvider } from '@clocky/clocky-agent-runtime'
import type { Agent } from '@clocky/clocky-agent'
import { TeamError } from '@clocky/clocky-team'
import type { ActivationBindingSnapshot, ActivationReservationInput, JsonObject, TeamId } from '@clocky/clocky-team'
import type { TeamActivationRequest } from './index.ts'

/** One domain writer reservation retained until the corresponding runtime is proven stopped. */
export interface TeamActivationCoordinationLease {
  /** Exact implementation pinned before provider startup; absent on retirement-only recovery leases. */
  readonly runtimeProvider?: AgentRuntimeProvider
  /** True only when the owner has independent proof that this recovered in-process runtime cannot still execute. */
  readonly localTerminationConfirmed: boolean
  /**
   * Complete domain admission after the Team binding is durable.
   * @param binding - Exact binding returned by the Hub.
   * @param agent - Actual local Agent, absent for external runtimes.
   * @returns durable domain writer admission.
   */
  bind(binding: ActivationBindingSnapshot, agent: Agent | undefined): Promise<void>
  /** Revoke domain writes before runtime shutdown. @returns durable revocation. */
  revoke(): Promise<void>
  /** Flush domain-owned input/results after local work stops but before the runtime detaches its Session. */
  checkpoint?(): Promise<void>
  /** Release domain ownership after confirmed shutdown. @returns durable release. */
  release(): Promise<void>
}
/** Owner selected by immutable Team rules.activationLifecycleOwner. */
export interface TeamActivationLifecycleOwner {
  readonly name: string
  /**
   * Reserve domain authority before provider startup, outside all Hub serializers.
   * @param request - Controller-resolved placement.
   * @param reservation - Exact durable Team startup reservation.
   * @returns a capability owned by this startup and its eventual activation.
   */
  reserve(request: TeamActivationRequest, reservation: ActivationReservationInput): Promise<TeamActivationCoordinationLease>
  /**
   * Recover domain responsibility for an existing durable epoch; must not grant new decision authority.
   * @param binding - Existing binding read from the Hub.
   * @returns retirement capability, with localTerminationConfirmed only when independently proven.
   */
  recover(binding: ActivationBindingSnapshot): Promise<TeamActivationCoordinationLease>
  /**
   * Reconcile an unpublished startup; no activation binding may exist for its reservation.
   * @param reservation - Exact durable startup selection.
   * @returns a retirement capability backed by no-start or prior-Host termination evidence.
   */
  recoverReservation(reservation: ActivationReservationInput): Promise<TeamActivationCoordinationLease>
}
/** Registration stays present but rejects starts while accepted activations drain. */
export interface LifecycleOwnerEntry {
  readonly owner: TeamActivationLifecycleOwner
  accepting: boolean
  disposal?: Promise<void> | undefined
}
interface CoordinationEntry {
  readonly teamId: TeamId
  readonly owner: LifecycleOwnerEntry
  readonly lease: Promise<TeamActivationCoordinationLease>
  binding?: ActivationBindingSnapshot
}

/** Controller-private registry retaining startup and retirement ownership across awaits. */
export class LifecycleOwners {
  private readonly owners = new Map<string, LifecycleOwnerEntry>()
  private readonly entries = new Map<string, CoordinationEntry>()

  constructor(private readonly drain: (keys: readonly string[], teamIds: readonly TeamId[]) => Promise<void>) {}

  /**
   * Register a domain owner; failed drain keeps its name reserved and stops new starts.
   * @param ctx - Contribution lifetime.
   * @param owner - Named domain lifecycle implementation.
   * @returns Retryable asynchronous disposer.
   */
  register(ctx: Context, owner: TeamActivationLifecycleOwner): () => Promise<void> {
    if (owner.name.length === 0 || this.owners.has(owner.name)) throw new TeamError('Activation lifecycle owner name is empty or already registered', 'TEAM_INVALID_ARGUMENT')
    const entry: LifecycleOwnerEntry = { owner, accepting: true }
    this.owners.set(owner.name, entry)
    const release = (): Promise<void> => {
      entry.accepting = false
      entry.disposal ??= this.closeOwner(entry).catch((error: unknown) => { entry.disposal = undefined; throw error })
      return entry.disposal
    }
    ctx.effect(() => release)
    return release
  }

  /**
   * Resolve the immutable Team rule; unconfigured Teams remain unmanaged.
   * @param rules - Durable Team rules.
   * @returns Accepting owner, or undefined without a rule; missing or retiring referents reject.
   */
  resolve(rules: JsonObject): LifecycleOwnerEntry | undefined {
    const name = rules['activationLifecycleOwner']
    if (name === undefined) return undefined
    if (typeof name !== 'string' || name.length === 0) throw new TeamError('Team activationLifecycleOwner must be a nonempty registered name', 'TEAM_INVALID_ARGUMENT')
    const entry = this.owners.get(name)
    if (entry === undefined || !entry.accepting) throw new TeamError(`Activation lifecycle owner '${name}' is unavailable`, 'TEAM_ACTIVATION_RECOVERY_CONFLICT')
    return entry
  }

  /**
   * Retain one exact domain startup capability before the runtime is invoked.
   * @param owner - Previously resolved owner.
   * @param key - Controller-owned participant key.
   * @param request - Resolved startup request.
   * @param reservation - Durable Team reservation.
   */
  async reserve(
    owner: LifecycleOwnerEntry, key: string, request: TeamActivationRequest, reservation: ActivationReservationInput,
  ): Promise<void> {
    if (!owner.accepting || this.entries.has(key)) throw new TeamError('Activation lifecycle ownership is retiring or unresolved', 'TEAM_ACTIVATION_RECOVERY_CONFLICT')
    const entry: CoordinationEntry = { owner, teamId: request.teamId, lease: owner.owner.reserve(request, reservation) }
    await this.retain(key, entry)
  }

  /**
   * Complete domain admission after the Team binding is durable.
   * @param key - Controller-owned participant key.
   * @param binding - Authoritative Hub result.
   * @param agent - Actual local Agent when present.
   */
  async bind(key: string, binding: ActivationBindingSnapshot, agent: Agent | undefined): Promise<void> {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    entry.binding = binding
    await (await entry.lease).bind(binding, agent)
  }

  /**
   * Retain a retirement capability for one existing epoch without authorizing a new writer.
   * @param rules - Durable Team rules.
   * @param key - Controller-owned participant key.
   * @param binding - Exact existing activation.
   * @returns Domain retirement capability, or undefined for unmanaged Teams.
   */
  async recover(rules: JsonObject, key: string, binding: ActivationBindingSnapshot): Promise<TeamActivationCoordinationLease | undefined> {
    const owner = this.resolve(rules)
    if (owner === undefined) return undefined
    const existing = this.entries.get(key)
    if (existing !== undefined) {
      if (existing.binding?.activation.id !== binding.activation.id) throw new TeamError('Unpublished startup cannot be replaced by another activation', 'TEAM_ACTIVATION_RECOVERY_CONFLICT')
      return await existing.lease
    }
    const entry: CoordinationEntry = { owner, teamId: binding.activation.teamId, binding, lease: owner.owner.recover(binding) }
    return await this.retain(key, entry)
  }

  /**
   * Recover an unpublished startup without substituting a different activation.
   * @param rules - Durable Team rules.
   * @param key - Controller-owned participant key.
   * @param reservation - Exact startup reservation.
   * @returns Domain retirement capability, or undefined for unmanaged Teams.
   */
  async recoverReservation(
    rules: JsonObject, key: string, reservation: ActivationReservationInput,
  ): Promise<TeamActivationCoordinationLease | undefined> {
    const owner = this.resolve(rules)
    if (owner === undefined) return undefined
    const existing = this.entries.get(key)
    if (existing !== undefined) {
      if (existing.binding !== undefined) throw new TeamError('Published activation requires epoch recovery', 'TEAM_ACTIVATION_RECOVERY_CONFLICT')
      return await existing.lease
    }
    const entry: CoordinationEntry = { owner, teamId: reservation.teamId, lease: owner.owner.recoverReservation(reservation) }
    return await this.retain(key, entry)
  }

  private async retain(key: string, entry: CoordinationEntry): Promise<TeamActivationCoordinationLease> {
    this.entries.set(key, entry)
    try { return await entry.lease }
    catch (error) { this.entries.delete(key); throw error }
  }

  /**
   * Read the startup implementation pinned by the domain owner.
   * @param key - Controller-owned participant key.
   * @returns Pinned implementation when this startup has one.
   */
  async provider(key: string): Promise<AgentRuntimeProvider | undefined> { return (await this.entries.get(key)?.lease)?.runtimeProvider }

  /**
   * Persist domain revocation before terminating the corresponding runtime.
   * @param key - Controller-owned participant key.
   */
  async revoke(key: string): Promise<void> { await (await this.entries.get(key)?.lease)?.revoke() }

  /** Flush an owner's stopped local state before provider disposal.
   * @param key - Exact controller-owned participant key.
   * @returns completion of the optional owner checkpoint.
   */
  async checkpoint(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (entry !== undefined) await (await entry.lease).checkpoint?.()
  }

  /**
   * Drop a capability only after its owner acknowledges confirmed termination.
   * @param key - Controller-owned participant key.
   */
  async release(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    await (await entry.lease).release()
    if (this.entries.get(key) === entry) this.entries.delete(key)
  }

  /**
   * Reject shutdown while a startup or activation still has unresolved domain ownership.
   */
  assertSettled(): void {
    if (this.entries.size > 0) throw new TeamError('Activation domain ownership has no confirmed termination', 'TEAM_ACTIVATION_RECOVERY_CONFLICT')
  }

  private async closeOwner(entry: LifecycleOwnerEntry): Promise<void> {
    const keys = [...this.entries].filter(([, current]) => current.owner === entry).map(([key]) => key)
    const teams = [...new Set([...this.entries.values()].filter(current => current.owner === entry).map(current => current.teamId))]
    await this.drain(keys, teams)
    if ([...this.entries.values()].some(current => current.owner === entry)) {
      throw new TeamError('Activation lifecycle owner retains an unconfirmed startup', 'TEAM_ACTIVATION_RECOVERY_CONFLICT')
    }
    this.owners.delete(entry.owner.name)
  }
}
