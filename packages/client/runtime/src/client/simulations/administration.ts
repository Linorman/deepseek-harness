import type { SimulationProductTaskCancelInput } from '@clocky/clocky-simulation-product/types'
/** Original Simulation commands outlive view changes; transport uncertainty never allocates another identity. */
import { observeRequest } from './request-presentation.ts'
import type { SimulationRequestObservation } from './request-presentation.ts'
import type { Branded } from '@clocky/clocky-brand'
import type { Context } from '@clocky/cordis'
import type { IApiClient, RpcError } from '@clocky/clocky-client-connection/client'
import type { SimulationProductCreateInput, SimulationProductPrepareInput, SimulationProductCheckpointInput,
  SimulationProductRestoreInput, SimulationProductManageInput, SimulationProductIngressInput, SimulationProductRequestReceipt,
  SimulationProductManagementReceipt, SimulationProductIngressReceipt, SimulationProductTaskReviewResolveInput, SimulationProductOperationRetryInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductRetryRequestInput } from '@clocky/clocky-simulation-product/types'
import { createSnapshotStore } from '../contract/store.ts'
import type { SimulationRuntime, SimulationReadError } from './service.ts'

/** Local original-operation selector, distinct from its durable command, management or ingress ID. */
export type SimulationCommandKey = Branded<'SimulationCommandKey'>

/** Each input preserves its original domain identity independently of transport rpcId. */
export type SimulationCommand = { readonly kind: 'create'; readonly input: SimulationProductCreateInput }
  | { readonly kind: 'retry-request'; readonly input: SimulationProductRetryRequestInput }
  | { readonly kind: 'prepare'; readonly input: SimulationProductPrepareInput }
  | { readonly kind: 'checkpoint'; readonly input: SimulationProductCheckpointInput }
  | { readonly kind: 'restore'; readonly input: SimulationProductRestoreInput }
  | { readonly kind: 'manage'; readonly input: SimulationProductManageInput }
  | { readonly kind: 'retry-operation'; readonly input: SimulationProductOperationRetryInput }
  | { readonly kind: 'review'; readonly input: SimulationProductTaskReviewResolveInput }
  | { readonly kind: 'cancel-task'; readonly input: SimulationProductTaskCancelInput }
  | { readonly kind: 'ingress'; readonly input: SimulationProductIngressInput }
/** Exact original result; input assignment does not imply consumption and scheduling receipt does not describe current phase. */
export type SimulationCommandReceipt = { readonly kind: 'request'; readonly value: SimulationProductRequestReceipt }
  | { readonly kind: 'management'; readonly value: SimulationProductManagementReceipt }
  | { readonly kind: 'ingress'; readonly value: SimulationProductIngressReceipt }
/** Transport rejection and non-authoritative absence remain independent of any known durable result. */
export interface SimulationCommandState {
  readonly command: SimulationCommand
  readonly pending: boolean
  readonly unknown: boolean
  readonly notFound: boolean
  /** Definitive Host refusal before acceptance; a mismatched creation model carries this proof. */
  readonly notAccepted?: true | undefined
  readonly receipt?: SimulationCommandReceipt | undefined
  /** Separately observed request-journal metadata; it never overwrites the original receipt. */
  readonly requestObservation?: SimulationRequestObservation | undefined
  /** A newer journal observation could not fit; query remains available but retry/release require reconciliation. */
  readonly requestObservationUnavailable?: true | undefined
  readonly error?: SimulationReadError | undefined
}
/** Bounded original operation records contain business facts, never view state. */
export interface SimulationAdministrationState {
  readonly connected: boolean
  readonly authorizationVersion: number
  readonly commands: Readonly<Record<string, SimulationCommandState>>
}
/** Deployment bounds apply to complete serialized retained records including private original input. */
export interface SimulationAdministrationOptions {
  readonly maxCommands: number
  readonly maxBytes: number
}

/**
 * Derive a map identity from the complete original domain selection, including its identity family.
 * @param command - Typed original command, never a transport request.
 * @returns collision-free local key; payload text is excluded.
 */
export function simulationCommandKey(command: SimulationCommand): SimulationCommandKey {
  switch (command.kind) {
    case 'manage': return JSON.stringify(['management', command.input.runId, command.input.managementId]) as SimulationCommandKey
    case 'ingress': return JSON.stringify(['ingress', command.input.runId, command.input.ingressId]) as SimulationCommandKey
    case 'create': case 'prepare': case 'checkpoint': case 'restore': case 'review': case 'retry-operation': case 'retry-request': case 'cancel-task':
      return JSON.stringify(['request', command.input.commandId]) as SimulationCommandKey
    /* v8 ignore next -- SimulationCommand is a closed typed union; unknown wire tags reject in the carrier parser. */
    default: return assertNever(command)
  }
}

/** React-free command owner tied to the connection authority and the registering plugin's lifetime. */
export class SimulationAdministrationRuntime {
  /** Framework-bound observable source of original commands and outcomes. */
  readonly state = createSnapshotStore<SimulationAdministrationState>({ connected: false, authorizationVersion: 0, commands: {} })
  private readonly requests = new Map<SimulationCommandKey, AbortController>()
  private retired = false
  private transitioning = false
  private epoch = 0
  private authorizationVersion: number

  /**
   * @param ctx - Registering plugin's effect lifetime; disposal ends waiters without cancelling Host work.
   * @param api - Authenticated unary carrier with strict product DTO validation.
   * @param source - Current connection/authorization observations.
   * @param options - Validated deployment bounds for retained original commands.
   * @param onForbidden - Withdraw affected readable content while preserving a valid transport connection.
   */
  constructor(ctx: Context, private readonly api: IApiClient, private readonly source: SimulationRuntime,
    private readonly options: SimulationAdministrationOptions, private readonly onForbidden: () => void) {
    this.authorizationVersion = source.state.getSnapshot().authorizationVersion
    this.synchronize()
    ctx.effect(() => source.state.subscribe(() => { this.synchronize() }), 'Simulation administration: authority observations')
    ctx.effect(() => () => { this.retired = true; this.transition(false, true) }, 'Simulation administration: waiter lifetime')
  }

  private synchronize(): void {
    if (this.retired) return
    const source = this.source.state.getSnapshot()
    const changed = this.authorizationVersion !== source.authorizationVersion
    if (changed || source.connected !== this.state.getSnapshot().connected) {
      this.authorizationVersion = source.authorizationVersion
      this.transition(source.connected, changed)
    }
    const current = this.state.getSnapshot()
    let commands = current.commands
    for (const [key, record] of Object.entries(current.commands)) {
      const projected = this.project(key as SimulationCommandKey, record, commands)
      if (JSON.stringify(projected) !== JSON.stringify(record)) commands = { ...commands, [key]: projected }
    }
    if (commands !== current.commands) this.state.set({ ...current, commands })
  }
  private transition(connected: boolean, clear: boolean): void {
    this.transitioning = true
    this.epoch++
    const requests = [...this.requests.values()]
    this.requests.clear()
    const previous = this.state.getSnapshot().commands
    const commands = clear ? {} : Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, { ...value, pending: false }]))
    try {
      this.state.set({ connected, authorizationVersion: this.authorizationVersion, commands })
      for (const request of requests) request.abort()
    } finally { this.transitioning = false }
  }

  /**
   * Retain an exact immutable original before any IO; changed reuse and capacity excess fail without displacing old records.
   * @param command - Original actor-free domain request.
   * @param expectedAuthorizationVersion - Credential context in which the caller authored its input.
   * @returns local original-selection key, including on exact retry.
   */
  retain(command: SimulationCommand, expectedAuthorizationVersion: number): SimulationCommandKey {
    this.synchronize()
    if (expectedAuthorizationVersion !== this.authorizationVersion || this.retired || this.transitioning || !this.state.getSnapshot().connected) throw new Error('Simulation connection is unavailable')
    const key = simulationCommandKey(command)
    const previous = this.state.getSnapshot().commands
    const existing = previous[key]
    if (existing !== undefined) {
      if (JSON.stringify(existing.command) !== JSON.stringify(command)) throw new Error('Simulation original command identity has another payload')
      return key
    }
    const next = { ...previous, [key]: { command: structuredClone(command), pending: false, unknown: false, notFound: false } }
    if (Object.keys(next).length > this.options.maxCommands || this.bytes(next) > this.options.maxBytes) {
      throw new Error('Simulation retained command capacity is occupied')
    }
    this.state.set({ ...this.state.getSnapshot(), commands: next })
    return key
  }

  /**
   * Submit or explicitly retry only the retained original; no changed input or new identity is inferred.
   * @param key - Local original-selection identity returned by retain.
   * @returns current original record; undefined after authorization retirement or disposal.
   */
  async submit(key: SimulationCommandKey): Promise<SimulationCommandState | undefined> {
    return this.perform(key, false)
  }
  /**
   * Read the original durable outcome without repeating its operation; not-found remains uncertain.
   * @param key - Retained original-selection identity.
   * @returns current original record, or undefined after authorization retirement or disposal.
   */
  async query(key: SimulationCommandKey): Promise<SimulationCommandState | undefined> {
    return this.perform(key, true)
  }
  /**
   * Release a known terminal original; unresolved, accepted or in-progress operations remain recoverable.
   * @param key - Retained original-selection identity.
   * @returns whether a terminal record was removed.
   */
  release(key: SimulationCommandKey): boolean {
    this.synchronize()
    const current = this.state.getSnapshot().commands[key]
    if (current === undefined || current.pending || !terminal(current)) return false
    const { [key]: _removed, ...commands } = this.state.getSnapshot().commands
    this.state.set({ ...this.state.getSnapshot(), commands })
    return true
  }

  private async perform(key: SimulationCommandKey, query: boolean): Promise<SimulationCommandState | undefined> {
    this.synchronize()
    if (this.retired || this.transitioning || !this.state.getSnapshot().connected) return undefined
    const current = this.state.getSnapshot().commands[key]
    if (current === undefined || current.pending) return current
    const observed = observeRequest(current, this.source.state.getSnapshot().persistentRequests)
    if (!query && (current.requestObservationUnavailable || observed !== undefined
      && observed.status !== 'accepted')) return current
    const epoch = this.epoch
    const request = new AbortController()
    this.requests.set(key, request)
    const active = () => !this.retired && !request.signal.aborted && this.epoch === epoch && this.requests.get(key) === request
      && this.source.state.getSnapshot().connected
      && this.source.state.getSnapshot().authorizationVersion === this.authorizationVersion
    const waiting = { ...current, pending: true, error: undefined, ...query ? {} : { unknown: !terminal(current), notFound: false } }
    this.publish(key, waiting)
    if (!active()) return undefined
    try {
      const response = query ? await this.lookup(current.command, request.signal) : await this.send(current.command, request.signal)
      if (!active()) return undefined
      if (!response.result.ok) {
        const code = response.result.error.code
        if (code === 'simulation-product-forbidden' && (current.command.kind === 'review'
          || current.command.kind === 'retry-operation' || current.command.kind === 'retry-request' || current.command.kind === 'cancel-task')) {
          this.publish(key, { ...waiting, pending: false, error: 'forbidden' })
          return this.state.getSnapshot().commands[key]
        }
        if (code === 'PRODUCT_AUTH_INVALID' || code === 'PRODUCT_AUTH_REQUIRED' || code === 'simulation-product-forbidden') {
          if (code === 'simulation-product-forbidden') this.onForbidden()
          else this.source.clearAuthorization()
          this.synchronize(); return undefined
        }
        this.publish(key, { ...waiting, pending: false, error: category(response.result.error),
          ...!query && current.command.kind === 'create' && current.receipt === undefined && observed === undefined
            && code === 'simulation-product-model-changed' ? { unknown: false, notAccepted: true } : {} })
      } else {
        const receipt = response.result.value
        const next: SimulationCommandState = { ...current, pending: false,
          unknown: receipt === undefined && (current.unknown || current.receipt === undefined), notFound: receipt === undefined,
          ...receipt === undefined ? {} : { receipt, notAccepted: undefined }, error: undefined }
        const commands = { ...this.state.getSnapshot().commands, [key]: next }
        if (this.bytes(commands) > this.options.maxBytes) {
          this.publish(key, { ...waiting, pending: false, error: 'unavailable' })
        } else this.publish(key, next)
      }
    } catch {
      if (active()) this.publish(key, { ...waiting, pending: false, error: 'network' })
    } finally { if (this.requests.get(key) === request) this.requests.delete(key) }
    this.synchronize()
    return this.epoch === epoch ? this.state.getSnapshot().commands[key] : undefined
  }
  private bytes(commands: Readonly<Record<string, SimulationCommandState>>): number {
    // Reserve each record's complete transient metadata before IO; a refused result cannot evict its original payload.
    const reserved = Object.fromEntries(Object.entries(commands).map(([key, value]) => [key,
      { ...value, pending: false, unknown: false, notFound: false, error: 'unavailable', requestObservationUnavailable: true }]))
    return new TextEncoder().encode(JSON.stringify({ commands: reserved })).byteLength
  }
  private project(key: SimulationCommandKey, value: SimulationCommandState,
    commands: Readonly<Record<string, SimulationCommandState>>): SimulationCommandState {
    const requestObservation = observeRequest(value, this.source.state.getSnapshot().persistentRequests)
    // A missing/off-page observation cannot reconcile a previously refused projection.
    const projected = { ...value, requestObservation,
      requestObservationUnavailable: requestObservation !== undefined && !requestObservation.stale
        ? undefined : value.requestObservationUnavailable }
    return this.bytes({ ...commands, [key]: projected }) <= this.options.maxBytes
      ? projected : { ...value, requestObservationUnavailable: true }
  }
  private publish(key: SimulationCommandKey, value: SimulationCommandState): void {
    const commands = this.state.getSnapshot().commands
    this.state.set({ ...this.state.getSnapshot(), commands: { ...commands, [key]: this.project(key, value, commands) } })
  }
  private async send(command: SimulationCommand, signal: AbortSignal) {
    const api = this.api.simulations
    switch (command.kind) {
      case 'create': return map(await api.create(command.input, signal), value => ({ kind: 'request', value }))
      case 'retry-request': return map(await api.retryRequest(command.input, signal), (value) => {
        if (value.runId !== command.input.runId || value.commandId !== command.input.commandId) {
          throw new Error('Retried request names another original target')
        }
        return { kind: 'request', value }
      })
      case 'prepare': return map(await api.prepare(command.input, signal), value => ({ kind: 'request', value }))
      case 'checkpoint': return map(await api.checkpoint(command.input, signal), value => ({ kind: 'request', value }))
      case 'retry-operation': return map(await api.retryOperation(command.input, signal), value => ({ kind: 'request', value }))
      case 'review': return map(await api.resolveTaskReview(command.input, signal), value => ({ kind: 'request', value }))
      case 'cancel-task': return map(await api.cancelTask(command.input, signal), value => ({ kind: 'request', value }))
      case 'restore': return map(await api.restore(command.input, signal), value => ({ kind: 'request', value }))
      case 'manage': return map(await api.manage(command.input, signal), value => ({ kind: 'management', value: value.operation }))
      case 'ingress': return map(await api.ingress(command.input, signal), value => ({ kind: 'ingress', value }))
      /* v8 ignore next -- SimulationCommand is a closed typed union; unknown wire tags reject in the carrier parser. */
      default: return assertNever(command)
    }
  }
  private async lookup(command: SimulationCommand, signal: AbortSignal) {
    const api = this.api.simulations
    switch (command.kind) {
      case 'retry-request': return map(await api.request({ commandId: command.input.commandId }, signal), (value) => {
        if (value.status === 'not-found') return undefined
        if (value.request.runId !== command.input.runId || value.request.commandId !== command.input.commandId) {
          throw new Error('Original request lookup names another target')
        }
        return { kind: 'request', value: value.request }
      })
      case 'manage': return map(await api.managementRequest({ runId: command.input.runId, managementId: command.input.managementId }, signal),
        value => value.status === 'not-found' ? undefined : { kind: 'management', value: value.operation })
      case 'ingress': return map(await api.ingressRequest({ runId: command.input.runId, ingressId: command.input.ingressId }, signal),
        value => value.status === 'not-found' ? undefined : { kind: 'ingress', value: value.receipt })
      case 'retry-operation': return map(await api.request({ commandId: command.input.commandId }, signal), (value) => {
        if (value.status === 'not-found') return undefined
        const original = value.retryOperation
        if (original === undefined || original.runId !== command.input.runId || original.commandId !== command.input.commandId
          || original.operationId !== command.input.operationId || original.expectedAttemptCount !== command.input.expectedAttemptCount
          || original.reason !== command.input.reason.trim()) throw new Error('Original operation retry response names another target or payload')
        return { kind: 'request', value: value.request }
      })
      case 'cancel-task': return map(await api.request({ commandId: command.input.commandId }, signal), (value) => {
        if (value.status === 'not-found') return undefined
        const original = value.cancellation
        if (original === undefined || original.runId !== command.input.runId || original.commandId !== command.input.commandId
          || original.operationId !== command.input.operationId || original.expectedRevision !== command.input.expectedRevision
          || original.expectedAttemptId !== command.input.expectedAttemptId || original.reason !== command.input.reason.trim()) {
          throw new Error('Original cancellation response names another target or payload')
        }
        return { kind: 'request', value: value.request }
      })
      case 'review': return map(await api.request({ commandId: command.input.commandId }, signal), (value) => {
        if (value.status === 'not-found') return undefined
        const original = value.review
        if (original === undefined || original.runId !== command.input.runId || original.commandId !== command.input.commandId
          || original.operationId !== command.input.operationId || original.attemptId !== command.input.attemptId
          || original.expectedRevision !== command.input.expectedRevision || original.nextPhase !== command.input.nextPhase
          || original.reason !== command.input.reason.trim()) throw new Error('Original review response names another target or payload')
        return { kind: 'request', value: value.request }
      })
      case 'create': case 'prepare': case 'checkpoint': case 'restore':
        return map(await api.request({ commandId: command.input.commandId }, signal),
          value => value.status === 'not-found' ? undefined : { kind: 'request', value: value.request })
      /* v8 ignore next -- SimulationCommand is a closed typed union; unknown wire tags reject in the carrier parser. */
      default: return assertNever(command)
    }
  }
}

function map<T>(response: { result: { ok: true; value: T } | { ok: false; error: RpcError } },
  convert: (value: T) => SimulationCommandReceipt | undefined) {
  return { result: response.result.ok ? { ok: true as const, value: convert(response.result.value) } : response.result }
}
function terminal(value: SimulationCommandState): boolean {
  if (value.requestObservationUnavailable || value.requestObservation?.comparison === 'conflict') return false
  if (value.notAccepted) return true
  const receipt = value.receipt
  return !value.unknown && receipt !== undefined && (receipt.kind === 'ingress'
    ? receipt.value.status === 'consumed' || receipt.value.status === 'cancelled'
    : receipt.value.status === 'completed' || receipt.value.status === 'failed')
}
function category(error: RpcError): SimulationReadError {
  if (error.code === 'simulation-product-model-changed') return 'model-changed'
  if (error.code === 'simulation-product-unavailable') return 'unavailable'
  if (error.code === 'simulation-product-stale') return 'stale'
  if (error.code === 'simulation-product-invalid' || error.code === 'bad-request') return 'invalid'
  return 'internal'
}
/* v8 ignore next -- SimulationCommand is a closed discriminated union. */
function assertNever(value: never): never { void value; throw new Error('Unhandled Simulation command') }
