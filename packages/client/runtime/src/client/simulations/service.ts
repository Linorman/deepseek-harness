import type { SimulationProductTasksInput, SimulationProductTasksPage } from '@clocky/clocky-simulation-product/types'
import { SimulationSourceReader } from './source-reader.ts'
import type { SimulationProductSourceInput, SimulationProductSourceInspection } from '@clocky/clocky-simulation-product/types'
import { SimulationRecordExporter } from './records-export.ts'
import type { SimulationRecordExportOptions } from './records-export.ts'
import type { SimulationProductRecordsInput, SimulationProductRecordsPage } from '@clocky/clocky-simulation-product/types'
/** Read-only Simulation product state, isolated by connection authority and request generation. */
import type { Context } from '@clocky/cordis'
import type { IApiClient, RpcError } from '@clocky/clocky-client-connection/client'
import type { ProductAuthorizationScope } from '@clocky/clocky-host-apiproxy/api/rpc'
import type { SimulationProductListInput, SimulationProductRunPage, SimulationProductInspectInput, SimulationProductRunInspection,
  SimulationProductBrowseInput, SimulationProductCollectionPage, SimulationProductObjectInput,
  SimulationProductRunStatusesInput, SimulationProductRunStatusesPage, SimulationProductObjectInspection, SimulationProductCatalog, SimulationProductControl, SimulationProductTaskReviewListInput, SimulationProductTaskReviewPage } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductPreflightInput, SimulationProductPreflightResult } from '@clocky/clocky-simulation-product/types'
import type { SimulationProductRequestsInput, SimulationProductRequestsPage } from '@clocky/clocky-simulation-product/types'
import { SimulationAdministrationRuntime } from './administration.ts'
import type { SimulationAdministrationOptions } from './administration.ts'
import { createSnapshotStore } from '../contract/store.ts'
import { SimulationObserver } from './observer.ts'
import type { SimulationObservationOptions } from './observer.ts'
import type { SimulationProductWatchResult, SimulationProductRunId } from '@clocky/clocky-simulation-product/types'
export type * from '@clocky/clocky-simulation-product/types'

/** Localized UI recovery category; private transport/provider diagnostics are not displayed. */
export type SimulationReadError = 'forbidden' | 'unavailable' | 'stale' | 'invalid' | 'network' | 'internal'
/** One bounded response, its selection identity and independent pending/freshness state. */
export interface SimulationReadState<T> {
  readonly scope?: string | undefined
  readonly value?: T | undefined
  readonly loading: boolean
  readonly stale: boolean
  readonly error?: SimulationReadError | undefined
}
/** Snapshot contains at most one page per independently requested read family. */
export interface SimulationRuntimeState {
  readonly connected: boolean
  readonly generation: number
  readonly authorizationVersion: number
  readonly unknownOperations: SimulationReadState<SimulationProductCollectionPage>
  readonly statuses: SimulationReadState<SimulationProductRunStatusesPage>
  readonly reviews: SimulationReadState<SimulationProductTaskReviewPage>
  readonly catalog: SimulationReadState<SimulationProductCatalog>
  readonly preflight: SimulationReadState<SimulationProductPreflightResult>
  readonly tasks: SimulationReadState<SimulationProductTasksPage>
  readonly persistentRequests: SimulationReadState<SimulationProductRequestsPage>
  readonly control: SimulationReadState<SimulationProductControl>
  readonly directory: SimulationReadState<SimulationProductRunPage>
  readonly run: SimulationReadState<SimulationProductRunInspection>
  readonly collection: SimulationReadState<SimulationProductCollectionPage>
  readonly recovery: SimulationReadState<SimulationProductObjectInspection>
  readonly object: SimulationReadState<SimulationProductObjectInspection>
  readonly records: SimulationReadState<SimulationProductRecordsPage>
  readonly record: SimulationReadState<SimulationProductRecordsPage>
  readonly source: SimulationReadState<SimulationProductSourceInspection>
  readonly observation: SimulationReadState<SimulationProductWatchResult>
}
type Key = 'unknownOperations' | 'statuses' | 'reviews' | 'records' | 'record' | 'directory' | 'run' | 'collection' | 'object'
  | 'tasks' | 'catalog' | 'preflight' | 'persistentRequests' | 'control' | 'recovery'
interface Values {
  tasks: SimulationProductTasksPage
  persistentRequests: SimulationProductRequestsPage
  preflight: SimulationProductPreflightResult
  unknownOperations: SimulationProductCollectionPage
  statuses: SimulationProductRunStatusesPage
  reviews: SimulationProductTaskReviewPage
  records: SimulationProductRecordsPage
  record: SimulationProductRecordsPage
  catalog: SimulationProductCatalog
  control: SimulationProductControl
  directory: SimulationProductRunPage
  run: SimulationProductRunInspection
  collection: SimulationProductCollectionPage
  recovery: SimulationProductObjectInspection
  object: SimulationProductObjectInspection
}
const empty = (): SimulationRuntimeState => ({ tasks: { loading: false, stale: false }, unknownOperations: { loading: false, stale: false },
  persistentRequests: { loading: false, stale: false },
  statuses: { loading: false, stale: false }, reviews: { loading: false, stale: false },
  connected: false, generation: 0, authorizationVersion: 0,
  source: { loading: false, stale: false }, records: { loading: false, stale: false }, record: { loading: false, stale: false },
  catalog: { loading: false, stale: false }, preflight: { loading: false, stale: false }, control: { loading: false, stale: false },
  directory: { loading: false, stale: false }, run: { loading: false, stale: false },
  collection: { loading: false, stale: false },
  recovery: { loading: false, stale: false }, object: { loading: false, stale: false }, observation: { loading: false, stale: false } })

/** React-free business reads; no browsing method opens execution or publishes a management request. */
export class SimulationRuntime {
  /** Bare observable source bound into framework hooks by UI registrants. */
  readonly state = createSnapshotStore<SimulationRuntimeState>(empty())
  private readonly sourceReader: SimulationSourceReader
  private readonly requests = new Map<Key, { controller: AbortController; generation: number }>()
  private generation = 0
  private authorizationVersion = 0
  private readonly selections = new Map<Key, number>()
  private transitions = 0
  private authority: ProductAuthorizationScope | undefined
  private observer: SimulationObserver | undefined
  private readonly observationJobs = new Set<Promise<void>>()

  /** @param ctx - Owner of service and disposal. @param api - Shared authenticated transport. */
  constructor(ctx: Context, private readonly api: IApiClient) {
    this.sourceReader = new SimulationSourceReader(ctx, api, this, (source) => {
      this.state.set({ ...this.state.getSnapshot(), source })
    }, () => { this.denied() })
    ctx.reflect.provide('simulationRuns', this)
    ctx.effect(() => async () => {
      this.clearAuthorization()
      await Promise.allSettled([...this.observationJobs])
    }, 'simulation runtime: admitted read lifetime')
  }

  /**
   * Create a bounded command owner for a registering plugin; its waiters retire with that plugin.
   * @param ctx - Consumer effect lifetime.
   * @param options - Explicit validated retained-command allowances.
   * @returns command runtime sharing this connection's authorization observations.
   */
  administration(ctx: Context, options: SimulationAdministrationOptions): SimulationAdministrationRuntime {
    return new SimulationAdministrationRuntime(ctx, this.api, this, options, () => { this.denied() })
  }

  /**
   * Create an independent bounded journal export owner for the registering view.
   * @param ctx - Plugin lifetime; unload cancels export reads.
   * @param options - Maximum complete file bytes, pages and per-request rows.
   * @returns exporter sharing current authority, selection and policy observations.
   */
  recordExporter(ctx: Context, options: SimulationRecordExportOptions): SimulationRecordExporter {
    return new SimulationRecordExporter(ctx, this.api, this, options, () => { this.denied() })
  }

  /**
   * Watch a source while its inspector is visible; native Team authority is revalidated on a bounded real-time interval.
   * @param input - Frozen source and initial page selection.
   * @param intervalMs - Validated deployment interval.
   * @returns disposer for this exact inspector lifetime.
   */
  watchSource(input: SimulationProductSourceInput, intervalMs: number): () => void { return this.sourceReader.watch(input, intervalMs) }
  /** Continue the current source lookup or body page.
   * @param input - Same source with its returned continuation and position.
   * @returns bounded read settlement.
   */
  inspectSource(input: SimulationProductSourceInput): Promise<void> { return this.sourceReader.read(input) }
  /** Refresh the selected original without retaining obsolete continuation fences. @returns read settlement. */
  refreshSource(): Promise<void> { return this.sourceReader.refresh() }
  /** Remove a dismissed source and cancel all of its pending IO. */
  closeSource(): void { this.sourceReader.close() }
  /** Retire the single source on any Team revocation; canonical-parent read authority may belong to a different Team. */
  revokeSourceAccess(): void { this.sourceReader.revokeAccess() }

  /** Apply a completed handshake; replacing authority clears all old content before publication.
   * @param scope - Current non-authorizing credential discriminator.
   */
  connected(scope: ProductAuthorizationScope | undefined): void {
    if (this.authority !== scope) this.authorizationVersion++
    this.transition(() => {
      const state = this.authority === scope ? this.state.getSnapshot() : empty()
      this.authority = scope
      return { ...state, connected: true, generation: this.generation, record: { loading: false, stale: true },
        object: (state.object.value?.value?.section === 'context' || state.object.value?.value?.section === 'knowledge') ? { loading: false, stale: true } : state.object }
    })
  }
  /** Ordinary disconnection cancels old responses and preserves readable pages as stale. */
  disconnected(): void {
    this.transition(() => {
      const state = this.state.getSnapshot()
      return { ...state, connected: false, generation: this.generation,
        unknownOperations: { ...state.unknownOperations, stale: true },
        statuses: { ...state.statuses, stale: true }, reviews: { ...state.reviews, stale: true },
        persistentRequests: { ...state.persistentRequests, stale: true }, tasks: { ...state.tasks, stale: true },
        catalog: { ...state.catalog, stale: true }, preflight: { ...state.preflight, stale: true },
        control: { ...state.control, stale: true },
        directory: { ...state.directory, stale: true }, run: { ...state.run, stale: true },
        records: { ...state.records, stale: true }, record: { ...state.record, stale: true },
        collection: { ...state.collection, stale: true }, recovery: { ...state.recovery, stale: true },
        object: { ...state.object, stale: true } }
    })
  }
  /** Explicit authentication loss clears every business response, including late pending results. */
  clearAuthorization(): void {
    this.authorizationVersion++
    this.transition(() => {
      this.authority = undefined
      return { ...empty(), generation: this.generation }
    })
  }
  /** Cancel current view reads while retaining bounded pages and selected identities. */
  pause(): void {
    this.transition(() => {
      const state = this.state.getSnapshot()
      return { ...state, record: { loading: false, stale: true }, object: (state.object.value?.value?.section === 'context' || state.object.value?.value?.section === 'knowledge') ? { loading: false, stale: true } : state.object }
    })
  }

  /**
   * Observe invalidations for one visible run; new policy lifetimes clear private bodies without replacing authoring authority.
   * @param runId - Exact selected run.
   * @param options - Explicit positive real wait and retry pacing, independently validated from UI configuration.
   * @returns this observer's disposer; replacing it cannot be undone by an older disposer or response.
   */
  observe(runId: SimulationProductRunId, options: SimulationObservationOptions): () => void {
    if (this.transitions !== 0 || !this.state.getSnapshot().connected) return () => {}
    for (const value of [options.waitMs, options.retryMs]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error('Invalid Simulation observation timer')
    }
    const generation = this.generation
    const old = this.observer
    const active = () => this.observer === observer && generation === this.generation && this.state.getSnapshot().connected
    const observer = new SimulationObserver(this.api, runId, options,
      (value) => { if (active()) this.observed(value) },
      (error) => { if (active()) this.observationFailed(error) })
    this.observationJobs.add(observer.done)
    void observer.done.then(() => this.observationJobs.delete(observer.done), () => this.observationJobs.delete(observer.done))
    this.transitions++
    try {
      this.observer = observer
      const requests = this.retireReads(['object', 'record'])
      const state = this.state.getSnapshot()
      this.state.set({ ...state, record: { loading: false, stale: true }, object: (state.object.value?.value?.section === 'context' || state.object.value?.value?.section === 'knowledge')
        ? { scope: state.object.scope, loading: false, stale: true } : state.object,
      observation: { scope: JSON.stringify(['watch', runId]), loading: true, stale: false } })
      for (const request of requests) request.controller.abort()
      old?.close()
    } finally { this.transitions-- }
    return () => {
      if (this.observer !== observer) return
      this.transitions++
      try {
        this.observer = undefined
        this.invalidateViews(false, 'stale')
        this.state.set({ ...this.state.getSnapshot(), observation: { loading: false, stale: true } })
        observer.close()
      } finally { this.transitions-- }
    }
  }

  private observed(value: SimulationProductWatchResult): void {
    const state = this.state.getSnapshot()
    const previous = state.observation.value
    const context = state.object.value?.value
    const replaced = state.record.value !== undefined && state.record.value.readVersion !== value.readVersion
      || state.records.value !== undefined && state.records.value.readVersion !== value.readVersion
      || value.status === 'reset' || previous !== undefined && previous.readVersion !== value.readVersion
      || (context?.section === 'context' || context?.section === 'knowledge') && context.readVersion !== value.readVersion
    if (replaced) { this.sourceReader.revokeAccess(); this.invalidateViews(true, 'stale') }
    else if (context?.section === 'knowledge' && (value.world.status !== 'observed'
      || state.object.value !== undefined && state.object.value.snapshotRevision < value.world.revision)) this.invalidateViews(false, 'stale')
    const current = this.state.getSnapshot()
    const revision = value.world.status === 'observed' ? value.world.revision : undefined
    const stalePage = <T extends { snapshotRevision: number }>(page: SimulationReadState<T>): SimulationReadState<T> => ({ ...page,
      stale: page.stale || page.value !== undefined && (revision === undefined || page.value.snapshotRevision < revision) })
    this.state.set({ ...current, observation: { scope: JSON.stringify(['watch', value.runId]), value, loading: false, stale: false },
      run: { ...current.run, stale: current.run.stale || current.run.value?.world !== undefined
        && (revision === undefined || current.run.value.world.revision < revision) },
      unknownOperations: stalePage(current.unknownOperations),
      reviews: stalePage(current.reviews), records: stalePage(current.records), record: stalePage(current.record),
      collection: stalePage(current.collection), object: stalePage(current.object), recovery: stalePage(current.recovery) })
  }

  private observationFailed(error?: RpcError): void {
    if (error?.code === 'PRODUCT_AUTH_INVALID' || error?.code === 'PRODUCT_AUTH_REQUIRED') { this.clearAuthorization(); return }
    const kind = error === undefined ? 'network' : category(error)
    if (kind === 'forbidden') { this.denied('run'); return }
    if (kind !== 'network') { this.sourceReader.revokeAccess(); this.invalidateViews(false, kind) }
    const state = this.state.getSnapshot()
    this.state.set({ ...state, observation: { ...state.observation, loading: false, stale: true, error: kind,
      value: kind === 'network' ? state.observation.value : undefined } })
  }

  private invalidateViews(all: boolean, error: SimulationReadError): void {
    this.transitions++
    try {
      const requests = this.retireReads(all ? ['run', 'collection', 'object', 'recovery', 'records', 'record', 'reviews', 'unknownOperations'] : ['object', 'record'])
      const state = this.state.getSnapshot()
      const object = (state.object.value?.value?.section === 'context' || state.object.value?.value?.section === 'knowledge') || state.object.scope?.endsWith(',"context"]') === true || state.object.scope?.endsWith(',"knowledge"]') === true ? { scope: state.object.scope, loading: false, stale: true, error }
        : { ...state.object, loading: false, stale: true }
      this.state.set({ ...state, object, record: { scope: state.record.scope, loading: false, stale: true, error },
        ...all ? { unknownOperations: { ...state.unknownOperations, loading: false, stale: true },
          reviews: { ...state.reviews, loading: false, stale: true },
          records: { ...state.records, loading: false, stale: true },
          run: { ...state.run, loading: false, stale: true },
          collection: { ...state.collection, loading: false, stale: true },
          recovery: { ...state.recovery, loading: false, stale: true } } : {} })
      for (const request of requests) request.controller.abort()
    } finally { this.transitions-- }
  }

  private retireReads(keys: Key[]) {
    const requests = []
    for (const key of keys) {
      this.selections.set(key, (this.selections.get(key) ?? 0) + 1)
      const request = this.requests.get(key)
      this.requests.delete(key)
      if (request !== undefined) requests.push(request)
    }
    return requests
  }
  /** Clear a dismissed inspector without changing the run or its collection. */
  closeObject(): void {
    const selection = this.cancel('object')
    if (this.selections.get('object') !== selection) return
    this.state.set({ ...this.state.getSnapshot(), object: { loading: false, stale: false } })
  }
  /** Publish retired state before abort callbacks can request replacement work. */
  private transition(replace: () => SimulationRuntimeState): void {
    this.transitions++
    this.generation++
    const requests = [...this.requests.values()]
    const observer = this.observer
    this.observer = undefined
    this.requests.clear()
    try {
      const state = replace()
      this.state.set({ ...state, authorizationVersion: this.authorizationVersion, observation: { loading: false, stale: true },
        records: { ...state.records, loading: false }, record: { ...state.record, loading: false },
        unknownOperations: { ...state.unknownOperations, loading: false },
        statuses: { ...state.statuses, loading: false }, reviews: { ...state.reviews, loading: false },
        persistentRequests: { ...state.persistentRequests, loading: false, stale: true },
        tasks: { ...state.tasks, loading: false, stale: true },
        catalog: { ...state.catalog, loading: false }, preflight: { ...state.preflight, loading: false, stale: true },
        control: { ...state.control, loading: false },
        directory: { ...state.directory, loading: false }, run: { ...state.run, loading: false },
        collection: { ...state.collection, loading: false }, recovery: { ...state.recovery, loading: false },
        object: { ...state.object, loading: false } })
      for (const request of requests) request.controller.abort()
      observer?.close()
    } finally { this.transitions-- }
  }
  /** Read one bounded unknown-operation preview independently of the user's operation collection.
   * @param runId - Exact registered run.
   * @param limit - Explicit deployment row allowance, independently bounded by the Host.
   * @returns current preview settlement without executing or retrying any operation.
   */
  unknownOperations(runId: SimulationProductRunId, limit: number): Promise<void> {
    return this.read('unknownOperations', JSON.stringify(['unknownOperations', runId]), signal =>
      this.api.simulations.browse({ runId, collection: 'operations', status: 'outcome-unknown', limit }, signal))
  }

  /** Read one revision-pinned administrative task-review page without exposing Team task bodies.
   * @param input - Exact run and bounded continuation; changing run retires older reads.
   * @returns settlement after publication or cancellation; stale observations preserve the old page.
   */
  listTaskReviews(input: SimulationProductTaskReviewListInput): Promise<void> {
    return this.read('reviews', JSON.stringify(['reviews', input.runId]),
      signal => this.api.simulations.listTaskReviews(input, signal))
  }

  /** Read installed versioned templates without execution ownership. @returns catalog read settlement. */
  catalog(): Promise<void> {
    return this.read('catalog', 'catalog', signal => this.api.simulations.catalog({}, signal))
  }
  /** Read one current canonical task-control window without creating or cancelling a task.
   * @param input - Authorized run, exact read fence and bounded cursor.
   * @returns metadata read settlement; cancellation permission is independently rechecked at native admission.
   */
  listTasks(input: SimulationProductTasksInput): Promise<void> {
    return this.read('tasks', JSON.stringify(['tasks', input.runId]), signal => this.api.simulations.listTasks(input, signal))
  }
  /** Discover a bounded original-request window after reload or authenticated Host restart, without executing it.
   * @param input - Exact authorized run, observed request revision and sealed continuation.
   * @returns current metadata read settlement; private originals and execution remain with the Host.
   */
  listRequests(input: SimulationProductRequestsInput): Promise<void> {
    return this.read('persistentRequests', JSON.stringify(['persistentRequests', input.runId]),
      signal => this.api.simulations.listRequests(input, signal))
  }
  /** Validate an exact creation draft without allocating a run, reserving capacity or starting inference.
   * @param input - Installed template selection and allowed raw parameters, without a command identity.
   * @returns current matching result, or undefined when another read, disconnect or authority replacement retired it.
   */
  async preflight(input: SimulationProductPreflightInput): Promise<SimulationReadState<SimulationProductPreflightResult> | undefined> {
    if (this.transitions !== 0 || !this.state.getSnapshot().connected) return undefined
    const generation = this.generation
    const scope = JSON.stringify(input)
    const selection = (this.selections.get('preflight') ?? 0) + 1
    await this.read('preflight', scope, signal => this.api.simulations.preflight(input, signal))
    const state = this.state.getSnapshot()
    return this.generation === generation && this.selections.get('preflight') === selection && state.connected
      && state.preflight.scope === scope ? state.preflight : undefined
  }
  /** Retire validation for a changed or dismissed draft; a late result cannot authorize a new creation. */
  closePreflight(): void {
    const selection = this.cancel('preflight')
    if (this.selections.get('preflight') !== selection) return
    this.state.set({ ...this.state.getSnapshot(), preflight: { loading: false, stale: false } })
  }
  /**
   * Read action hints without acquiring ownership.
   * @param runId - Exact registered run.
   * @returns read settlement.
   */
  control(runId: SimulationProductInspectInput['runId']): Promise<void> {
    return this.read('control', JSON.stringify(['control', runId]), signal => this.api.simulations.control({ runId }, signal))
  }
  /**
   * Read the authorized directory.
   * @param input - Exact bounded query.
   * @returns read settlement.
   */
  async directory(input: SimulationProductListInput): Promise<void> {
    if (this.transitions !== 0 || !this.state.getSnapshot().connected) return
    const generation = this.generation
    const runSelection = this.selections.get('run')
    const retired = this.retireReads(['directory', 'statuses'])
    const reservation = this.selections.get('directory')
    const current = () => this.generation === generation && this.selections.get('directory') === reservation
      && this.selections.get('run') === runSelection && this.state.getSnapshot().connected
    this.state.set({ ...this.state.getSnapshot(), statuses: { ...this.state.getSnapshot().statuses, loading: false, stale: true } })
    for (const request of retired) request.controller.abort()
    if (!current()) return
    const selection = (reservation ?? 0) + 1
    const reading = this.read('directory', JSON.stringify(['directory', (input.search ?? '').trim().toLowerCase()]),
      signal => this.api.simulations.list(input, signal))
    await reading
    const state = this.state.getSnapshot()
    if (this.generation !== generation || this.selections.get('directory') !== selection || !state.connected
      || this.selections.get('run') !== runSelection
      || state.directory.error !== undefined || state.directory.value === undefined) return
    await this.runStatuses({ runIds: state.directory.value.items.map(item => item.id) })
  }
  /** Read one ordered status batch for exactly the retained directory window.
   * @param input - Current authorized directory IDs in their original order.
   * @returns read settlement; mismatched selections retire without IO and failures preserve marked stale observations.
   */
  runStatuses(input: SimulationProductRunStatusesInput): Promise<void> {
    if (this.transitions !== 0 || !this.state.getSnapshot().connected) return Promise.resolve()
    const ids = this.state.getSnapshot().directory.value?.items.map(item => item.id)
    if (ids === undefined || JSON.stringify(ids) !== JSON.stringify(input.runIds)) return Promise.resolve()
    return this.read('statuses', JSON.stringify(['statuses', input.runIds]), signal => this.api.simulations.runStatuses(input, signal))
  }
  /**
   * Read one exact run; changing identity cancels and clears dependent object pages.
   * @param input - Registered product identity only.
   * @returns settlement after authorized observation or a recoverable failure.
   */
  inspect(input: SimulationProductInspectInput): Promise<void> {
    const scope = JSON.stringify(['run', input.runId])
    if (this.transitions !== 0) return Promise.resolve()
    if (this.state.getSnapshot().run.scope !== scope) {
      const generation = this.generation
      const selection = this.cancel('run')
      const current = () => generation === this.generation && this.selections.get('run') === selection
      if (!current()) return Promise.resolve()
      this.cancel('unknownOperations')
      if (!current()) return Promise.resolve()
      this.cancel('statuses')
      if (!current()) return Promise.resolve()
      this.cancel('reviews')
      if (!current()) return Promise.resolve()
      this.cancel('tasks')
      if (!current()) return Promise.resolve()
      this.cancel('persistentRequests')
      if (!current()) return Promise.resolve()
      this.cancel('collection')
      if (!current()) return Promise.resolve()
      this.cancel('object')
      if (!current()) return Promise.resolve()
      this.cancel('recovery')
      if (!current()) return Promise.resolve()
      this.cancel('records')
      if (!current()) return Promise.resolve()
      this.cancel('record')
      if (!current()) return Promise.resolve()
      this.state.set({ ...this.state.getSnapshot(), unknownOperations: { loading: false, stale: false },
        persistentRequests: { loading: false, stale: false }, tasks: { loading: false, stale: false },
        statuses: { loading: false, stale: false }, reviews: { loading: false, stale: false },
        records: { loading: false, stale: false }, record: { loading: false, stale: false },
        collection: { loading: false, stale: false },
        recovery: { loading: false, stale: false }, object: { loading: false, stale: false } })
      if (!current()) return Promise.resolve()
    }
    return this.read('run', scope, signal => this.api.simulations.inspect(input, signal))
  }
  /**
   * Read a revision-bound collection without appending different observations together.
   * @param input - Exact run/collection filters, explicit page limit and continuation.
   * @returns settlement; stale pages require first-page refresh and preserve old content.
   */
  browse(input: SimulationProductBrowseInput): Promise<void> {
    const { cursor: _cursor, limit: _limit, ...query } = input
    const scope = JSON.stringify(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)))
    return this.read('collection', scope, signal => this.api.simulations.browse(input, signal))
  }
  /**
   * Read metadata or an exact original journal record in independent bounded windows.
   * @param input - Safe sequence/kind selection; original mode needs independent Host permission.
   * @returns settlement after current publication or cancellation; failures preserve authorized pages.
   */
  readRecords(input: SimulationProductRecordsInput): Promise<void> {
    return this.read(input.mode === 'metadata' ? 'records' : 'record', simulationRecordsScope(input),
      signal => this.api.simulations.records(input, signal))
  }

  /** Cancel journal pages and discard original content when their view leaves.
   * @param originalOnly - Retain the metadata page when dismissing only the original-record inspector. */
  closeRecords(originalOnly = false): void {
    const requests = this.retireReads(originalOnly ? ['record'] : ['records', 'record'])
    this.state.set({ ...this.state.getSnapshot(), ...originalOnly ? {} : { records: { loading: false, stale: false } },
      record: { loading: false, stale: false } })
    for (const request of requests) request.controller.abort()
  }

  /**
   * Read exact metadata or one supported detail page; selecting a different object clears the previous one.
   * @param input - Exact object/section, optional selected revision and section continuation.
   * @returns settlement after publishing or discarding the response.
   */
  inspectObject(input: SimulationProductObjectInput): Promise<void> {
    return this.read('object', JSON.stringify([input.runId, input.collection, input.collection === 'decisions' && input.section === 'knowledge' && input.reference !== undefined
      ? JSON.stringify([input.id, input.reference.id, input.reference.revision]) : input.id, input.section]),
    signal => this.api.simulations.inspectObject(input, signal))
  }

  /**
   * Read one recovery anchor's immutable source references independently of the browsing inspector.
   * @param input - Exact registered run/checkpoint reference section and bounded page.
   * @returns read settlement; no verification, restore or execution is performed.
   */
  inspectRecovery(input: Extract<SimulationProductObjectInput, { collection: 'checkpoints' }>): Promise<void> {
    return this.read('recovery', JSON.stringify([input.runId, input.id, input.section]),
      signal => this.api.simulations.inspectObject(input, signal))
  }
  /** Retire the recovery dialog's source read and clear its independently bounded page. */
  closeRecovery(): void {
    const selection = this.cancel('recovery')
    if (this.selections.get('recovery') !== selection) return
    this.state.set({ ...this.state.getSnapshot(), recovery: { loading: false, stale: false } })
  }

  private cancel(key: Key): number {
    const selection = (this.selections.get(key) ?? 0) + 1
    this.selections.set(key, selection)
    const request = this.requests.get(key)
    this.requests.delete(key)
    request?.controller.abort()
    return selection
  }
  private async read<K extends Key>(key: K, scope: string, operation: (signal: AbortSignal) => Promise<{
    result: { ok: true; value: Values[K] } | { ok: false; error: RpcError }
  }>): Promise<void> {
    if (this.transitions !== 0) return
    const generation = this.generation
    const selection = this.cancel(key)
    if (generation !== this.generation || this.selections.get(key) !== selection) return
    // Each public entry selects the matching response type; TypeScript loses that relation at a generic indexed read.
    const previous = this.state.getSnapshot()[key] as SimulationReadState<Values[K]>
    const current: SimulationReadState<Values[K]> = previous.scope === scope ? previous : { loading: false, stale: false }
    const request = { controller: new AbortController(), generation: this.generation }
    this.requests.set(key, request)
    this.publish(key, { ...current, scope, loading: true, error: undefined })
    const active = () => this.requests.get(key) === request && request.generation === this.generation && !request.controller.signal.aborted
    if (!active() || !this.state.getSnapshot().connected) return
    try {
      const response = await operation(request.controller.signal)
      if (!active()) return
      if (!response.result.ok) {
        const error = category(response.result.error)
        if (response.result.error.code === 'PRODUCT_AUTH_INVALID' || response.result.error.code === 'PRODUCT_AUTH_REQUIRED') {
          this.clearAuthorization(); return
        }
        if (error === 'forbidden') {
          if (key === 'control' || key === 'reviews' || key === 'preflight' || key === 'persistentRequests' || key === 'tasks') {
            this.publish(key, { scope, loading: false, stale: false, error }); return
          }
          this.denied(key, scope)
          return
        }
        this.publish(key, { ...current, scope, loading: false, error, stale: current.stale || error === 'stale' || (key === 'statuses' || key === 'preflight') && current.value !== undefined,
          value: current.value })
        return
      }
      const value = response.result.value
      if (key === 'record') {
        const page = value as SimulationProductRecordsPage
        const watched = this.state.getSnapshot().observation.value
        if (this.observer !== undefined && (watched === undefined || page.readVersion !== watched.readVersion)) {
          this.invalidateViews(false, 'stale'); return
        }
      }
      if (key === 'object') {
        const object = value as SimulationProductObjectInspection
        const watched = this.state.getSnapshot().observation.value
        if ((object.value?.section === 'context' || object.value?.section === 'knowledge') && this.observer !== undefined
          && (watched === undefined || object.value.readVersion !== watched.readVersion
            || object.value.section === 'knowledge' && (watched.world.status !== 'observed' || object.snapshotRevision < watched.world.revision))) {
          this.invalidateViews(false, 'stale'); return
        }
      }
      const observation = this.state.getSnapshot().observation.value
      const runRevision = key === 'run' ? (value as SimulationProductRunInspection).world?.revision : undefined
      const stale = key !== 'persistentRequests' && observation?.world.status === 'observed'
        && ('snapshotRevision' in value ? value.snapshotRevision < observation.world.revision
          : runRevision !== undefined && runRevision < observation.world.revision)
      this.publish(key, { scope, value, loading: false, stale })
    } catch {
      if (active()) this.publish(key, { ...current, scope, loading: false, error: 'network',
        stale: current.stale || (key === 'statuses' || key === 'preflight') && current.value !== undefined })
    } finally { if (this.requests.get(key) === request) this.requests.delete(key) }
  }
  private denied(key?: Key, scope?: string): void {
    this.authorizationVersion++
    this.transition(() => ({ ...empty(), connected: this.state.getSnapshot().connected,
      ...key === undefined ? { directory: { loading: false, stale: false, error: 'forbidden' as const },
        run: { loading: false, stale: false, error: 'forbidden' as const }, control: { loading: false, stale: false, error: 'forbidden' as const } }
        : { [key]: { scope, loading: false, stale: false, error: 'forbidden' } } }))
  }
  private publish<K extends Key>(key: K, value: SimulationReadState<Values[K]>): void {
    this.state.set({ ...this.state.getSnapshot(), [key]: value })
  }
}

/** Stable presentation categories use protocol codes, never English-message parsing. */
function category(error: RpcError): SimulationReadError {
  if (error.code === 'simulation-product-forbidden' || error.code === 'PRODUCT_AUTH_INVALID' || error.code === 'PRODUCT_AUTH_REQUIRED') return 'forbidden'
  if (error.code === 'simulation-product-unavailable') return 'unavailable'
  if (error.code === 'simulation-product-stale') return 'stale'
  if (error.code === 'simulation-product-invalid' || error.code === 'bad-request') return 'invalid'
  return 'internal'
}

/** Stable journal-view scope excludes transient continuation and observation fences.
 * @param input - Exact public selection.
 * @returns canonical identity shared by runtime and its view consumer.
 */
export function simulationRecordsScope(input: SimulationProductRecordsInput): string {
  return JSON.stringify([input.runId, input.mode, input.kind ?? null, input.sequence ?? null])
}
