/** Bounded World domain windows retire with selection, credential and disclosure lifetimes. */
import type { Context } from '@clocky/cordis'
import type { IApiClient } from '@clocky/clocky-client-connection/client'
import type { SimulationProductWorldDomainInput, SimulationProductWorldDomainResult } from '@clocky/clocky-simulation-product/world-read-types'
import { matchesWorldDomainSelection, retireWorldReadBodies, simulationProductWorldDomainResultSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import { createSnapshotStore } from '../contract/store.ts'
import type { SimulationRuntime, SimulationReadState } from './service.ts'

/** Each family retains one bounded original page, including an inspector's selected child section. */
export type SimulationWorldDomainKind = SimulationProductWorldDomainInput['kind']
/** Runtime responses retain their coverage and selector; UI projections cannot claim a complete graph from a page. */
export type SimulationWorldDomainState = Readonly<Record<SimulationWorldDomainKind,
  SimulationReadState<SimulationProductWorldDomainResult>>>
const families: Record<SimulationWorldDomainKind, true> = { overview: true, organization: true, person: true, governance: true,
  proposal: true, norm: true, external: true, identity: true, 'case-extensions': true, 'hiring-market': true }
const kinds = Object.keys(families) as SimulationWorldDomainKind[]
const empty = (): SimulationWorldDomainState => Object.fromEntries(kinds.map(kind =>
  [kind, { loading: false, stale: false }])) as SimulationWorldDomainState
interface Pending { readonly controller: AbortController; readonly generation: number }

/** React-free read owner; no method acquires an execution owner or issues management commands. */
export class SimulationWorldDomainReader {
  /** One page per visible domain family, bound into the existing renderer observable. */
  readonly state = createSnapshotStore<SimulationWorldDomainState>(empty())
  private readonly requests = new Map<SimulationWorldDomainKind, Pending>()
  private readonly jobs = new Set<Promise<void>>()
  private authorization: number
  private generation = 0
  private signature = ''
  private runScope: string | undefined
  private readVersion: string | undefined
  private sourceGeneration = 0
  private retired = false

  /**
   * @param ctx - Consumer plugin lifetime; unload aborts and drains admitted reads.
   * @param api - Shared authenticated, strictly parsed transport.
   * @param source - Existing connection, selected run and metadata-observation owner.
   * @param denied - Retire private product state after an explicit authority refusal.
   */
  constructor(ctx: Context, private readonly api: IApiClient, private readonly source: SimulationRuntime,
    private readonly denied: () => void) {
    this.authorization = source.state.getSnapshot().authorizationVersion
    ctx.effect(() => source.state.subscribe(() => { this.synchronize() }), 'World domain reads: authority and selection')
    ctx.effect(() => async () => {
      this.retired = true; this.close(); await Promise.allSettled([...this.jobs])
    }, 'World domain reads: admitted lifetime')
  }

  /**
   * Replace one family's page, preserving other independently bounded windows.
   * @param input - Exact original query with optional continuation and its revision/policy fences.
   * @returns read settlement; stale/forbidden/transport failures remain visible and never execute work.
   */
  read(input: SimulationProductWorldDomainInput): Promise<void> {
    this.synchronize()
    const job = this.load(input)
    this.jobs.add(job)
    void job.then(() => this.jobs.delete(job), () => this.jobs.delete(job))
    return job
  }

  /**
   * Cancel pending queries and discard retained domain bodies when the workspace leaves.
   * @param kind - One family to close, or omit to retire every retained domain page.
   */
  close(kind?: SimulationWorldDomainKind): void {
    if (kind === undefined) { this.cancel(); this.state.set(empty()); return }
    const request = this.requests.get(kind); this.requests.delete(kind); request?.controller.abort()
    this.publish(kind, { loading: false, stale: false })
  }

  private synchronize(): void {
    if (this.retired) return
    const source = this.source.state.getSnapshot(), observed = source.observation.value
    const revision = observed?.world.status === 'observed' ? observed.world.revision : undefined
    const signature = JSON.stringify([source.authorizationVersion, source.generation, source.connected, source.run.scope,
      observed?.runId, observed?.readVersion, revision])
    if (signature === this.signature) return
    this.signature = signature
    const changed = this.authorization !== source.authorizationVersion || this.runScope !== source.run.scope
    const policyChanged = this.readVersion !== observed?.readVersion
    const generationChanged = this.sourceGeneration !== source.generation
    this.authorization = source.authorizationVersion; this.runScope = source.run.scope
    this.readVersion = observed?.readVersion
    this.sourceGeneration = source.generation
    if (changed || policyChanged || generationChanged || !source.connected || observed?.world.status !== 'observed') this.cancel()
    if (changed) this.state.set(empty())
    else {
      const previous = this.state.getSnapshot()
      this.state.set(Object.fromEntries(kinds.map((kind) => {
        const value = previous[kind]
        // Audience and premises may change with Native facts even when the configured disclosure policy is stable.
        const newerNative = value.value !== undefined && (revision === undefined || value.value.snapshotRevision < revision)
        return [kind, { ...value, loading: this.requests.has(kind),
          stale: value.stale || value.value !== undefined && (!source.connected || policyChanged || generationChanged || newerNative),
          ...value.value !== undefined && source.connected && (policyChanged || newerNative)
            ? { value: simulationProductWorldDomainResultSchema.parse(retireWorldReadBodies(value.value)) } : {} }]
      })) as SimulationWorldDomainState)
    }
  }

  private ready(input: SimulationProductWorldDomainInput): boolean {
    const source = this.source.state.getSnapshot(), observed = source.observation.value
    return !this.retired && source.connected && source.run.scope === JSON.stringify(['run', input.runId])
      && observed?.runId === input.runId && observed.world.status === 'observed'
  }

  private async load(input: SimulationProductWorldDomainInput): Promise<void> {
    if (!this.ready(input)) return
    this.requests.get(input.kind)?.controller.abort()
    const previous = this.state.getSnapshot()[input.kind]
    const scope = JSON.stringify(Object.entries(input).filter(([key, value]) => value !== undefined
      && key !== 'cursor' && key !== 'expectedRevision' && key !== 'readVersion')
      .sort(([a], [b]) => a.localeCompare(b)))
    const current = previous.scope === scope ? previous : { loading: false, stale: false }
    const request: Pending = { controller: new AbortController(), generation: this.generation }
    this.requests.set(input.kind, request)
    const active = () => this.requests.get(input.kind) === request && request.generation === this.generation
      && !request.controller.signal.aborted && this.ready(input)
    this.publish(input.kind, { ...current, scope, loading: true, error: undefined })
    try {
      if (!active()) return
      const reply = await this.api.simulations.readWorldDomain(input, request.controller.signal)
      if (!active()) return
      if (!reply.result.ok) {
        const code = reply.result.error.code
        if (code === 'PRODUCT_AUTH_INVALID' || code === 'PRODUCT_AUTH_REQUIRED' || code === 'simulation-product-forbidden') {
          this.close(); this.denied(); return
        }
        const error = code === 'simulation-product-stale' ? 'stale' : code === 'simulation-product-unavailable' ? 'unavailable' : 'invalid'
        this.publish(input.kind, { ...current, scope, loading: false, stale: true, error }); return
      }
      const value = reply.result.value, observed = this.source.state.getSnapshot().observation.value
      if (!matchesWorldDomainSelection(input, value) || value.readVersion !== observed?.readVersion) {
        this.publish(input.kind, { scope, loading: false, stale: true, error: 'stale' }); return
      }
      const stale = observed.world.status === 'observed' && value.snapshotRevision < observed.world.revision
      this.publish(input.kind, { scope, value: stale ? simulationProductWorldDomainResultSchema.parse(retireWorldReadBodies(value)) : value,
        loading: false, stale })
    } catch {
      if (active()) this.publish(input.kind, { ...current, scope, loading: false, stale: true, error: 'network' })
    } finally { if (this.requests.get(input.kind) === request) this.requests.delete(input.kind) }
  }

  private cancel(): void {
    this.generation++
    const requests = [...this.requests.values()]; this.requests.clear()
    for (const request of requests) request.controller.abort()
  }
  private publish(kind: SimulationWorldDomainKind, value: SimulationReadState<SimulationProductWorldDomainResult>): void {
    this.state.set({ ...this.state.getSnapshot(), [kind]: value })
  }
}
