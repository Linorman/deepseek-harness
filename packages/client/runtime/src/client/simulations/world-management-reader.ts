/** Inert personnel fields and quotes share the selected run's credential and Native observation lifetime. */
import type { Context } from '@clocky/cordis'
import type { IApiClient, RpcError } from '@clocky/clocky-client-connection/client'
import type { SimulationProductWorldManagementFieldsInput, SimulationProductWorldManagementFields,
  SimulationProductWorldManagementDraft, SimulationProductWorldManagementPreview } from '@clocky/clocky-simulation-product/world-management-types'
import { simulationProductWorldManagementFieldsInputSchema, simulationProductWorldManagementDraftSchema,
  simulationProductWorldManagementFieldsSchema, simulationProductWorldManagementPreviewSchema,
  matchesWorldManagementPreview } from '@clocky/clocky-simulation-product/world-management-schema'
import { createSnapshotStore } from '../contract/store.ts'
import type { SimulationRuntime, SimulationReadState, SimulationReadError } from './service.ts'

/** One complete original quote and its independently requested form metadata. */
export type SimulationWorldManagementReadState = { readonly [K in keyof Values]: SimulationReadState<Values[K]> }
type Values = { fields: SimulationProductWorldManagementFields; preview: SimulationProductWorldManagementPreview }
type Key = keyof Values
const empty = (): SimulationWorldManagementReadState => ({ fields: { loading: false, stale: false },
  preview: { loading: false, stale: false } })
/** Read ownership is independent of retained command execution; no read acquires a Native writable owner. */
export class SimulationWorldManagementReader {
  /** Complete typed fields and original quote; renderer adapters only project this state. */
  readonly state = createSnapshotStore<SimulationWorldManagementReadState>(empty())
  private readonly pending = new Map<Key, AbortController>()
  private readonly jobs = new Set<Promise<void>>()
  private epoch = 0
  private signature = ''
  private authority: number
  private runScope: string | undefined
  private readVersion: string | undefined
  private sourceGeneration = 0
  private retired = false

  /**
   * @param ctx - Registering view lifetime; unload aborts and drains admitted reads.
   * @param api - Shared authenticated unary transport with strict public parsers.
   * @param source - Existing selected run and credential observations.
   * @param denied - Withdraw private state after a current product refusal.
   */
  constructor(ctx: Context, private readonly api: IApiClient, private readonly source: SimulationRuntime,
    private readonly denied: () => void) {
    this.authority = source.state.getSnapshot().authorizationVersion
    ctx.effect(() => source.state.subscribe(() => { this.synchronize() }), 'World management reads: source lifetime')
    ctx.effect(() => async () => { this.retired = true; this.close(); await Promise.allSettled([...this.jobs]) },
      'World management reads: admitted lifetime')
  }

  /**
   * Read current exact real person and assignment choices without reserving a command.
   * @param raw - Owned run, original person and installed action.
   * @returns bounded read settlement; unavailable owner remains explicit.
   */
  fields(raw: SimulationProductWorldManagementFieldsInput): Promise<void> {
    const input = simulationProductWorldManagementFieldsInputSchema.parse(raw)
    return this.read('fields', input.runId, JSON.stringify(input), async (signal) => {
      const reply = await this.api.simulations.worldManagementFields(input, signal)
      if (!reply.result.ok) return reply.result
      const value = simulationProductWorldManagementFieldsSchema.parse(reply.result.value)
      if (value.runId !== input.runId || value.targetId !== input.targetId || value.action !== input.action)
        throw new Error('World management fields changed their original person or action')
      return { ok: true, value }
    })
  }

  /**
   * Observe actual Native impact with every original form choice retained, without inference or business allocation.
   * @param raw - Complete strict form and displayed person revision.
   * @returns read settlement; no transport retry or replacement quote is automatic.
   */
  preview(raw: SimulationProductWorldManagementDraft): Promise<void> {
    const input = simulationProductWorldManagementDraftSchema.parse(raw)
    return this.read('preview', input.runId, JSON.stringify(input), async (signal) => {
      const reply = await this.api.simulations.previewWorldManagement(input, signal)
      if (!reply.result.ok) return reply.result
      const value = simulationProductWorldManagementPreviewSchema.parse(reply.result.value)
      if (!matchesWorldManagementPreview(input, value)) throw new Error('World management quote changed its original choices')
      return { ok: true, value }
    })
  }

  /** Invalidate original quotes when editing, closing the dialog or leaving the workspace. */
  close(): void {
    this.epoch++
    const requests = [...this.pending.values()]; this.pending.clear(); this.state.set(empty())
    for (const request of requests) request.abort()
  }

  private synchronize(): void {
    if (this.retired) return
    const source = this.source.state.getSnapshot(), observed = source.observation.value
    const revision = observed?.world.status === 'observed' ? observed.world.revision : undefined
    const signature = JSON.stringify([source.authorizationVersion, source.generation, source.connected, source.run.scope,
      observed?.readVersion, observed?.runId, revision])
    if (signature === this.signature) return
    this.signature = signature
    const changed = this.authority !== source.authorizationVersion || this.runScope !== source.run.scope
    const policyChanged = this.readVersion !== observed?.readVersion || this.sourceGeneration !== source.generation
    this.authority = source.authorizationVersion; this.runScope = source.run.scope
    this.readVersion = observed?.readVersion; this.sourceGeneration = source.generation
    if (changed) { this.close(); return }
    const invalidated = policyChanged || !source.connected || observed?.world.status !== 'observed'
    const requests = invalidated ? [...this.pending.values()] : []
    if (invalidated) { this.epoch++; this.pending.clear() }
    const state = this.state.getSnapshot()
    const stale = <T extends { snapshotRevision: number }>(value: SimulationReadState<T>): SimulationReadState<T> => ({ ...value,
      loading: !invalidated && value.loading, stale: value.stale || value.value !== undefined && (policyChanged || !source.connected
        || revision === undefined || value.value.snapshotRevision < revision) })
    this.state.set({ fields: stale(state.fields), preview: stale(state.preview) })
    for (const request of requests) request.abort()
  }
  private ready(runId: string): boolean {
    const source = this.source.state.getSnapshot()
    return !this.retired && source.connected && source.run.scope === JSON.stringify(['run', runId])
      && source.observation.value?.runId === runId && source.observation.value.world.status === 'observed'
  }
  private read<K extends Key>(key: K, runId: string, scope: string,
    operation: (signal: AbortSignal) => Promise<{ ok: true; value: Values[K] } | { ok: false; error: RpcError }>): Promise<void> {
    this.synchronize()
    if (!this.ready(runId)) return Promise.resolve()
    const task = this.load(key, runId, scope, operation)
    this.jobs.add(task); void task.then(() => this.jobs.delete(task), () => this.jobs.delete(task))
    return task
  }
  private async load<K extends Key>(key: K, runId: string, scope: string,
    operation: (signal: AbortSignal) => Promise<{ ok: true; value: Values[K] } | { ok: false; error: RpcError }>): Promise<void> {
    this.pending.get(key)?.abort()
    const request = new AbortController(), epoch = this.epoch
    this.pending.set(key, request)
    const previous = this.state.getSnapshot()[key]
    const current = previous.scope === scope ? previous : { loading: false, stale: false }
    const active = () => this.epoch === epoch && this.pending.get(key) === request && !request.signal.aborted && this.ready(runId)
    this.publish(key, { ...current, scope, loading: true, error: undefined })
    try {
      const result = await operation(request.signal)
      if (!active()) return
      if (!result.ok) {
        if (result.error.code === 'PRODUCT_AUTH_INVALID' || result.error.code === 'PRODUCT_AUTH_REQUIRED') {
          this.source.clearAuthorization(); return
        }
        if (result.error.code === 'simulation-product-forbidden') { this.denied(); return }
        const error: SimulationReadError = result.error.code === 'simulation-product-stale' ? 'stale'
          : result.error.code === 'simulation-product-invalid' ? 'invalid' : 'unavailable'
        this.publish(key, { scope, loading: false, stale: true, error }); return
      }
      const observed = this.source.state.getSnapshot().observation.value
      if (observed?.world.status !== 'observed' || result.value.snapshotRevision < observed.world.revision) {
        this.publish(key, { scope, loading: false, stale: true, error: 'stale' }); return
      }
      this.publish(key, { scope, value: result.value, loading: false, stale: false })
    } catch {
      if (active()) this.publish(key, { ...current, scope, loading: false, stale: true, error: 'network' })
    } finally { if (this.pending.get(key) === request) this.pending.delete(key) }
  }
  private publish<K extends Key>(key: K, value: SimulationReadState<Values[K]>): void {
    this.state.set({ ...this.state.getSnapshot(), [key]: value })
  }
}
