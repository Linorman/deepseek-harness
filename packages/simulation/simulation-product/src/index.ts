import { readEnvelopeSource, envelopeSourceParts } from './envelope-source.ts'
import { simulationProductSourceInputSchema, simulationProductSourceInspectionSchema } from './sources-schema.ts'
import type { SimulationProductSourceInput, SimulationProductSourceInspection } from './sources-types.ts'
import { recordRows } from './records.ts'
import { simulationProductRecordsInputSchema, simulationProductRecordsPageSchema } from './records-schema.ts'
import type { SimulationProductRecordsInput, SimulationProductRecordsPage } from './records-types.ts'
/** Authenticated product registration and read routing; world and execution remain provider-owned. */
import { Context, Service } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { LogStream } from '@clocky/clocky-storage'
import type {} from '@clocky/clocky-storage-log'
import type {} from '@clocky/clocky-simulation'
import type { SimulationRunObservation } from '@clocky/clocky-simulation'
import { simulationRuntimeMetrics } from '@clocky/clocky-simulation'
import { simulationProductImportSchema, simulationProductRecordSchema, foldDirectoryEntry, sameImport } from './directory.ts'
import { simulationProductListInputSchema, simulationProductInspectInputSchema,
  simulationProductRunPageSchema, simulationProductRunInspectionSchema, simulationProductBrowseInputSchema,
  simulationProductRunStatusesInputSchema, simulationProductRunStatusesPageSchema,
  simulationProductCollectionPageSchema, simulationProductObjectInputSchema, simulationProductObjectInspectionSchema } from './schema.ts'
import { collectionRows, objectDetail } from './collections.ts'
import { DirectoryCursorCodec } from './cursor.ts'
import type { SimulationProductImport, SimulationProductRecord, SimulationProductContextReader, SimulationProductRecordReader } from './registration-types.ts'
import type { SimulationProductOperationRetryReader } from './registration-types.ts'
import { z as wire } from 'zod'
import { randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { simulationProductWatchInputSchema, simulationProductWatchResultSchema } from './watch-schema.ts'
import type { SimulationProductReadVersion, SimulationProductWatchInput, SimulationProductWatchResult,
  SimulationProductWatchWorld } from './watch-types.ts'
import type { SimulationAdministration } from './administration.ts'
import type { SimulationProductText, SimulationProductRunSummary,
  SimulationProductListInput, SimulationProductRunPage, SimulationProductInspectInput, SimulationProductRunInspection,
  SimulationProductRunStatusesInput, SimulationProductRunStatusesPage, SimulationProductRunStatus,
  SimulationProductBrowseInput, SimulationProductCollectionPage, SimulationProductObjectInput,
  SimulationProductObjectInspection } from './types.ts'
export type * from './types.ts'
export type * from './registration-types.ts'
export type { SimulationAdministration, Config as SimulationAdministrationConfig } from './administration.ts'
export { prepareSimulationCompany, simulationCompanyPreparationSchema } from './company-preparation.ts'
export type { SimulationCompanyPreparation, SimulationCompanyPrepared } from './company-preparation.ts'
export { SimulationCompanyDriver, simulationCompanyDriverSchema } from './company-driver.ts'
export type { SimulationCompanyDriverConfig, SimulationCompanyDriveResult, SimulationCompanyStage } from './company-driver.ts'
export { SimulationTaskExecutor, simulationTaskExecutorSchema } from './task-executor.ts'
export type { SimulationTaskExecutorConfig, SimulationTaskExecutorOptions, SimulationTaskExecutorResult } from './task-executor.ts'
export { registerCompanyTaskPolicies } from './company-task-policies.ts'

/** Deployment registration and complete-response allowances. */
export interface Config {
  /** Dedicated directory stream routed by storage-log; it cannot share another consumer's format. */
  readonly directoryStream: string
  /** Trusted imports of existing provider history; no run creation or execution occurs. */
  readonly imports?: SimulationProductImport[]
  /** Maximum retained registered runs on this Host. */
  readonly maxRuns?: number
  /** Maximum entries read per directory recovery page. */
  readonly recoveryPageSize?: number
  /** Maximum admitted reads, including those waiting for directory initialization. */
  readonly maxPendingReads?: number
  /** Maximum public list rows. */
  readonly maxPageSize?: number
  /** Maximum complete public JSON request/result bytes. */
  readonly maxBytes?: number
  /** Maximum complete durable registration entry bytes, checked during import and replay. */
  readonly maxDirectoryEntryBytes?: number
  /** Maximum UTF-8 display text bytes before explicit truncation. */
  readonly maxTextBytes?: number
  /** Trusted private-body readers; omitted means every context body is withheld, including from run owners. */
  readonly contextReaders?: SimulationProductContextReader[]
  /** Whole-run original journal readers; includes retained private history, independently of entity-context grants. */
  readonly recordReaders?: SimulationProductRecordReader[]
  /** Maximum bytes in one Unicode-safe text part, before complete-response accounting. Must be at least four. */
  readonly maxContextPartBytes?: number
  /** Maximum independent authenticated waits; watch sleeps do not occupy ordinary read admission. */
  readonly maxWatchers?: number
  /** Maximum real milliseconds held by one watch, independently of simulation time. */
  readonly maxWatchWaitMs?: number
  /** Minimum real milliseconds between native revision observations within one watch. */
  readonly watchPollMs?: number
}
/** Configuration resolves public operational allowances before IO. */
export const Config: z<Config> = z.object({ directoryStream: z.string().required(),
  // Schemastery admits opaque deployment values; the constructor immediately validates each through the owning Zod schema before IO.
  imports: z.array(z.any()).default([]), maxRuns: z.number().min(1).step(1).default(10000),
  recoveryPageSize: z.number().min(1).step(1).default(64), maxPendingReads: z.number().min(1).step(1).default(32),
  maxPageSize: z.number().min(1).step(1).default(64),
  maxBytes: z.number().min(1).step(1).default(1048576), maxDirectoryEntryBytes: z.number().min(1).step(1).default(1048576),
  maxTextBytes: z.number().min(1).step(1).default(512),
  recordReaders: z.array(z.any()).default([]), contextReaders: z.array(z.any()).default([]),
  maxContextPartBytes: z.number().min(4).step(1).default(16384),
  maxWatchers: z.number().min(1).step(1).default(32), maxWatchWaitMs: z.number().min(1).max(2147483647).step(1).default(20000),
  watchPollMs: z.number().min(1).max(2147483647).step(1).default(2000),
})
const recordReadersSchema = wire.array(wire.strictObject({ principalId: wire.string().min(1), runId: wire.string().min(1).optional() }))
const contextReadersSchema = wire.array(wire.strictObject({ principalId: wire.string().min(1), runId: wire.string().min(1).optional(),
  content: wire.array(wire.enum(['context', 'knowledge', 'sources'])).min(1).optional(),
  entityIds: wire.array(wire.string().min(1)).min(1).refine(ids => new Set(ids).size === ids.length, 'Context reader entities must be distinct') }))

/** Public product read failures do not reveal private provider diagnostics. */
export class SimulationProductError extends Error {
  /** Stable public category. */
  readonly code: 'SIMULATION_PRODUCT_FORBIDDEN' | 'SIMULATION_PRODUCT_INVALID' | 'SIMULATION_PRODUCT_UNAVAILABLE' | 'SIMULATION_PRODUCT_STALE'
  /** @param message - Public diagnostic. @param code - Stable failure category. */
  constructor(message: string, code: SimulationProductError['code']) { super(message); this.name = 'SimulationProductError'; this.code = code }
}

declare module '@clocky/cordis' {
  interface Context {
    simulationProducts: SimulationProducts
    simulationAdministration: SimulationAdministration
  }
}

/** One Host-owned metadata directory; list/inspect never take Simulation execution ownership. */
export class SimulationProducts extends Service<Config> {
  static inject = ['storageLog', 'simulations']
  static Config = Config
  private readonly options: Required<Config>
  private readonly codec = new DirectoryCursorCodec()
  private readVersion = randomBytes(16).toString('hex') as SimulationProductReadVersion
  private policyWake = new AbortController()
  private readonly recordContributions = new Map<symbol, readonly SimulationProductRecordReader[]>()
  private readonly contextContributions = new Map<symbol, readonly SimulationProductContextReader[]>()
  private operationRetryReader?: { readonly read: SimulationProductOperationRetryReader } | undefined
  private readonly watchers = new Map<AbortController, Promise<SimulationProductWatchResult>>()
  private records = new Map<string, SimulationProductRecord>()
  private stream: LogStream | undefined
  private directoryRevision = -1
  private readonly pending = new Set<Promise<unknown>>()
  private closing = false
  private readonly ready: Promise<void>
  private registrationTail: Promise<unknown> = Promise.resolve()

  /** @param ctx - Required directory storage and native inspection services. @param config - Trusted deployment registration. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'simulationProducts')
    this.options = { directoryStream: config.directoryStream, imports: config.imports ?? [], maxRuns: config.maxRuns ?? 10000,
      recoveryPageSize: config.recoveryPageSize ?? 64, maxPendingReads: config.maxPendingReads ?? 32, maxPageSize: config.maxPageSize ?? 64,
      maxBytes: config.maxBytes ?? 1048576, maxDirectoryEntryBytes: config.maxDirectoryEntryBytes ?? 1048576,
      maxTextBytes: config.maxTextBytes ?? 512, contextReaders: structuredClone(config.contextReaders ?? []),
      recordReaders: structuredClone(config.recordReaders ?? []),
      maxContextPartBytes: config.maxContextPartBytes ?? 16384, maxWatchers: config.maxWatchers ?? 32,
      maxWatchWaitMs: config.maxWatchWaitMs ?? 20000, watchPollMs: config.watchPollMs ?? 2000 }
    contextReadersSchema.parse(this.options.contextReaders)
    recordReadersSchema.parse(this.options.recordReaders)
    if (!Number.isSafeInteger(this.options.maxContextPartBytes) || this.options.maxContextPartBytes < 4) {
      throw invalid('Simulation context text parts require an allowance of at least four bytes')
    }
    if (this.options.directoryStream.trim().length === 0) throw invalid('Simulation directory stream must have a name')
    for (const value of [this.options.maxRuns, this.options.recoveryPageSize, this.options.maxPendingReads, this.options.maxPageSize,
      this.options.maxBytes, this.options.maxDirectoryEntryBytes, this.options.maxTextBytes, this.options.maxWatchers,
      this.options.maxWatchWaitMs, this.options.watchPollMs]) {
      if (!Number.isSafeInteger(value) || value < 1) throw invalid('Invalid Simulation product allowance')
    }
    if (this.options.maxWatchWaitMs > 2147483647 || this.options.watchPollMs > 2147483647) throw invalid('Simulation watch timer exceeds host range')
    const imports = this.options.imports.map(value => simulationProductImportSchema.parse(value))
    let configured = new Map<string, SimulationProductRecord>()
    for (const input of imports) {
      this.checkDirectoryEntry({ kind: 'run/registered', record: { ...input, registeredAt: Date.now() } })
      configured = foldDirectoryEntry(configured, { kind: 'run/registered', record: { ...input, registeredAt: 0 } })
    }
    if (configured.size > this.options.maxRuns) throw invalid('Simulation configured imports exceed directory capacity')
    this.ready = this.load(imports)
    void this.ready.catch((_cause: unknown) => {
      // List/inspect and teardown await this same initialization result; this observer only contains unhandled rejection reporting.
    })
    ctx.effect(() => async () => {
      this.closing = true
      for (const controller of this.watchers.keys()) controller.abort()
      await Promise.allSettled([this.ready, this.registrationTail, ...this.pending, ...this.watchers.values()])
      await this.stream?.close()
    })
  }

  /** Complete registration recovery before Cordis reports this service as active. */
  protected async [Service.init](): Promise<void> { await this.ready }

  private async load(imports: readonly SimulationProductImport[]): Promise<void> {
    const stream = await this.ctx.storageLog.open({ name: this.options.directoryStream, version: 1 })
    this.stream = stream
    if (stream.firstSequence !== 0) throw invalid('Simulation directory has no complete retained prefix')
    let after = -1
    while (after < stream.tailSequence) {
      const rows = await stream.read(after, this.options.recoveryPageSize)
      if (rows.length === 0) throw invalid('Simulation directory suffix is incomplete')
      for (const row of rows) {
        if (row.sequence !== after + 1) throw invalid('Simulation directory history is not contiguous')
        this.checkDirectoryEntry(row.value)
        this.records = foldDirectoryEntry(this.records, row.value); this.checkCapacity(); after = row.sequence
      }
    }
    for (const input of imports) {
      const prior = this.records.get(input.id)
      if (prior !== undefined) {
        if (!sameImport(prior, input)) throw invalid('Simulation configured import changed retained registration')
        continue
      }
      const record = { ...input, registeredAt: Date.now() }
      const entry = { kind: 'run/registered', record }
      const next = foldDirectoryEntry(this.records, entry)
      if (next.size > this.options.maxRuns) throw invalid('Simulation directory capacity exceeded')
      this.checkDirectoryEntry(entry)
      await stream.append(stream.tailSequence, [entry])
      this.records = next
    }
    this.directoryRevision = stream.tailSequence
  }

  /**
   * Obtain a process-local registration capability for the trusted creation owner; it cannot cross JSON transports.
   * @returns a writer that persists the original allocated registration, coalesces exact retries and refuses changed ownership/spec.
   * The caller persists its creation intent first and drains this capability before its own teardown. Reads never invoke it.
   */
  creationRegistrar(): (record: SimulationProductRecord) => Promise<void> {
    const retain = (request: SimulationProductRecord): Promise<void> => {
      if (this.closing) return Promise.reject(new SimulationProductError('Simulation directory is closed', 'SIMULATION_PRODUCT_UNAVAILABLE'))
      const record = simulationProductRecordSchema.parse(request)
      const work = this.registrationTail.then(async () => {
        await this.ready
        const prior = this.records.get(record.id)
        if (prior !== undefined) {
          const { registeredAt: _registeredAt, ...binding } = record
          if (!sameImport(prior, binding) || prior.registeredAt !== record.registeredAt) throw invalid('Simulation allocated registration changed')
          return
        }
        const entry = { kind: 'run/registered', record }
        this.checkDirectoryEntry(entry)
        const next = foldDirectoryEntry(this.records, entry)
        if (next.size > this.options.maxRuns) throw invalid('Simulation directory capacity exceeded')
        const stream = this.stream
        /* v8 ignore next -- successful ready owns an opened stream; teardown drains admitted registration before closing it. */
        if (stream === undefined) throw new Error('Simulation initialized directory has no stream')
        await stream.append(stream.tailSequence, [entry])
        this.records = next; this.directoryRevision = stream.tailSequence
      })
      this.registrationTail = work.then(() => {}, () => {})
      return work
    }
    Object.defineProperty(retain, 'toJSON', { value: (): never => { throw new TypeError('Simulation registration writer is process-local') } })
    return retain
  }

  /**
   * Read safe metadata for the current principal without opening provider history.
   * @param request - Actor-free query and opaque continuation.
   * @param call - Transport-authenticated current principal and cancellation lifetime.
   * @returns complete bounded authorized directory window; new observations require first-page restart.
   */
  list(request: SimulationProductListInput, call: AuthenticatedProductCall): Promise<SimulationProductRunPage> {
    return this.admit(call, () => {
      const input = simulationProductListInputSchema.parse(request)
      this.checkBytes(input)
      const limit = input.limit ?? this.options.maxPageSize
      if (limit > this.options.maxPageSize) throw invalid('Simulation directory page size exceeds deployment allowance')
      const search = (input.search ?? '').trim().toLowerCase()
      const query = { scope: 'directory', revision: this.directoryRevision, search, limit }
      const all = [...this.records.values()].filter(record => record.ownerPrincipalId === call.principal.id
        && record.name.toLowerCase().includes(search)).sort((a, b) => a.id < b.id ? -1 : 1)
      let start = 0
      if (input.cursor !== undefined) {
        try { start = this.codec.decode(input.cursor, call, query) }
        catch { throw invalid('Simulation directory continuation expired; restart from the first page') }
      }
      const items = all.slice(start, start + limit).map(record => this.summary(record))
      let offset = start + items.length
      let page = { items, ...offset < all.length ? { nextCursor: this.codec.encode(call, { ...query, offset }) } : {} }
      while (Buffer.byteLength(JSON.stringify(page)) > this.options.maxBytes && items.length > 0) {
        if (items.length === 1) throw invalid('Simulation directory row exceeds complete response allowance')
        items.pop(); offset--
        page = { items, nextCursor: this.codec.encode(call, { ...query, offset }) }
      }
      this.checkBytes(page)
      return simulationProductRunPageSchema.parse(page)
    })
  }

  /**
   * Inspect exact registered history under current ownership association before and after provider IO.
   * @param request - Registered run identity only.
   * @param call - Transport-authenticated principal and cancellation lifetime.
   * @returns bounded administrative world summary without knowledge, instructions or physical paths.
   */
  inspect(request: SimulationProductInspectInput, call: AuthenticatedProductCall): Promise<SimulationProductRunInspection> {
    return this.admit(call, async () => {
      const input = simulationProductInspectInputSchema.parse(request)
      this.checkBytes(input)
      const record = this.readable(input.runId, call)
      const observation = await this.observe(record, call)
      let value: SimulationProductRunInspection
      try { value = this.runInspection(record, observation) }
      catch { throw new SimulationProductError('Simulation usage observation is unavailable', 'SIMULATION_PRODUCT_UNAVAILABLE') }
      this.checkBytes(value)
      return simulationProductRunInspectionSchema.parse(value)
    })
  }

  /**
   * Observe a finite authorized directory window without opening, restoring or executing any native run.
   * @param request - Distinct registered run identities bounded by maxPageSize and complete request bytes.
   * @param call - Current authenticated principal and credential-retirement lifetime.
   * @returns request-ordered observations; independent provider or accounting failures yield safe per-run unavailability.
   * Missing authorization or credential retirement rejects the whole batch, and complete response overflow rejects without partial rows.
   */
  runStatuses(request: SimulationProductRunStatusesInput, call: AuthenticatedProductCall): Promise<SimulationProductRunStatusesPage> {
    return this.admit(call, async () => {
      const input = simulationProductRunStatusesInputSchema.parse(request)
      this.checkBytes(input)
      if (input.runIds.length > this.options.maxPageSize) throw invalid('Simulation status batch exceeds deployment page allowance')
      const records = input.runIds.map(id => this.readable(id, call))
      const results = await Promise.allSettled(records.map(async (record): Promise<SimulationProductRunStatus> => {
        this.authorize(call); this.readable(record.id, call)
        try {
          const observation = await this.observe(record, call)
          this.authorize(call); this.readable(record.id, call)
          return this.runInspection(record, observation)
        } catch {
          this.authorize(call); this.readable(record.id, call)
          return { run: this.summary(record), status: 'unavailable', errorSummary: this.text('Simulation observation is unavailable'),
            operational: { status: 'unavailable', observedAt: Date.now(), scenario: { status: 'unavailable' } } }
        }
      }))
      this.authorize(call)
      for (const record of records) this.readable(record.id, call)
      const items: SimulationProductRunStatus[] = []
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason
        items.push(result.value)
      }
      const value: SimulationProductRunStatusesPage = { items,
        modelPool: { status: 'unavailable', clock: 'real', observedAt: Date.now() } }
      this.checkBytes(value)
      return simulationProductRunStatusesPageSchema.parse(value)
    })
  }

  /** Project only authoritative public metadata; unknown or rounded numeric consumption must fail observation. */
  private runInspection(record: SimulationProductRecord,
    observation: SimulationRunObservation | undefined): SimulationProductRunInspection {
    return { run: this.summary(record), status: observation === undefined ? 'missing' : 'observed',
      operational: { status: 'unavailable', observedAt: Date.now(), scenario: { status: 'unavailable' } },
      ...observation === undefined ? {} : { world: { revision: observation.snapshot.revision, phase: observation.snapshot.phase,
        time: observation.snapshot.time, tickUnit: this.text(observation.snapshot.spec.tickUnit),
        rulesVersion: this.text(observation.snapshot.spec.rulesVersion), policyVersion: this.text(observation.snapshot.spec.policyVersion),
        metrics: simulationRuntimeMetrics(observation.snapshot, observation.owner), owner: observation.owner,
        ...observation.snapshot.stall === undefined ? {} : { schedulerStop: {
          code: observation.snapshot.stall.code, recovery: observation.snapshot.stall.recovery } },
        entityCount: Object.keys(observation.snapshot.entities).length, decisionCount: Object.keys(observation.snapshot.decisions).length,
        operationCount: Object.keys(observation.snapshot.operations).length, observedAt: Date.now() } } }
  }

  /**
   * Inspect one exact Team Envelope reference retained by a prepared decision.
   * @param request - Frozen source ordinal, bounded lookup/body continuation and optional exact position.
   * @param call - Authenticated owner; Simulation disclosure and Team membership remain independent.
   * @returns inert source text, explicit lookup progress or redacted absence; every IO is followed by authority checks.
   */
  inspectSource(request: SimulationProductSourceInput, call: AuthenticatedProductCall): Promise<SimulationProductSourceInspection> {
    return this.admit(call, async () => {
      const input = simulationProductSourceInputSchema.parse(request)
      this.checkBytes(input)
      const limit = this.pageLimit(input.limit), version = this.readVersion
      const observation = await this.observe(this.readable(input.runId, call), call)
      if (observation === undefined) throw new SimulationProductError('Simulation history is unavailable', 'SIMULATION_PRODUCT_UNAVAILABLE')
      if (input.expectedRevision !== undefined && input.expectedRevision !== observation.snapshot.revision) throw stale()
      const decision = observation.snapshot.decisions[input.decisionId]
      const reference = decision?.context?.status === 'prepared' ? decision.context.view.sources[input.sourceIndex] : undefined
      const base = { runId: input.runId, decisionId: input.decisionId, sourceIndex: input.sourceIndex,
        snapshotRevision: observation.snapshot.revision, readVersion: version, observedAt: Date.now(), items: [] }
      if (reference?.kind !== 'team-envelope' || decision === undefined) return { ...base, status: 'missing' as const }
      const source = { kind: reference.kind, teamId: reference.teamId, channelId: reference.channelId, envelopeId: reference.envelopeId }
      const allowed = () => this.contextReadable(input.runId, decision.entityId, call, 'sources')
      const check = () => {
        this.authorize(call); this.readable(input.runId, call)
        if (this.closing || version !== this.readVersion) throw stale()
      }
      check()
      if (!allowed()) return { ...base, source, status: 'withheld' as const }
      const query = { scope: JSON.stringify(['source', input.runId, input.decisionId, input.sourceIndex, input.envelopeSequence ?? null]),
        revision: decision.snapshotRevision, search: JSON.stringify([source, version]), limit }
      const start = this.readPosition(input.cursor, call, query)
      const result = await readEnvelopeSource(this.ctx, source, call,
        { afterCursor: start - 1, limit, envelopeSequence: input.envelopeSequence }, check)
      check()
      let value: SimulationProductSourceInspection
      if (result.status === 'searching') value = { ...base, source, status: 'searching',
        nextCursor: this.codec.encode(call, { ...query, offset: result.afterCursor + 1 }) }
      else if (result.status !== 'found') value = { ...base, source, status: result.status }
      else {
        const envelope = { sequence: result.envelope.sequence, kind: this.text(result.envelope.kind), createdAt: result.envelope.createdAt }
        const bodyQuery = { ...query, scope: JSON.stringify(['source', input.runId, input.decisionId, input.sourceIndex, envelope.sequence]) }
        const rows = envelopeSourceParts(result.envelope, this.options.maxContextPartBytes)
        const wrap = (page: { items: SimulationProductSourceInspection['items']; nextCursor?: import('./types.ts').SimulationProductCursor | undefined }) =>
          ({ ...base, source, status: 'found' as const, envelope, items: page.items,
            ...page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor } })
        value = wrap(this.boundedParts(rows, input.envelopeSequence === undefined ? 0 : start, bodyQuery, call, wrap))
      }
      this.checkBytes(value)
      return simulationProductSourceInspectionSchema.parse(value)
    }, (value) => {
      if (this.closing || value.readVersion !== this.readVersion) throw stale()
      this.checkBytes(value)
      return value
    })
  }

  /**
   * Browse original journal sequences without opening execution or inferring history from snapshots.
   * @param request - Exact run, optional kind/sequence and policy-bound continuation.
   * @param call - Current authenticated owner and transport lifetime.
   * @returns bounded metadata or explicit whole-run-authorized JSON text parts; policy changes reject the old page.
   */
  readRecords(request: SimulationProductRecordsInput, call: AuthenticatedProductCall): Promise<SimulationProductRecordsPage> {
    return this.admit(call, async () => {
      const input = simulationProductRecordsInputSchema.parse(request)
      this.checkBytes(input)
      const limit = this.pageLimit(input.limit)
      const version = this.readVersion
      const record = this.readable(input.runId, call)
      const observation = await this.observe(record, call, true)
      if (version !== this.readVersion) throw stale()
      if (observation?.records === undefined) throw new SimulationProductError('Simulation journal inspection is unavailable', 'SIMULATION_PRODUCT_UNAVAILABLE')
      if (input.expectedRevision !== undefined && input.expectedRevision !== observation.snapshot.revision) throw stale()
      const matches = (reader: SimulationProductRecordReader) => reader.principalId === call.principal.id
        && (reader.runId === undefined || reader.runId === input.runId)
      const allowed = !this.closing && (this.options.recordReaders.some(matches)
        || [...this.recordContributions.values()].some(readers => readers.some(matches)))
      const { cursor: _cursor, limit: _limit, expectedRevision: _expectedRevision, ...filter } = input
      const query = { scope: JSON.stringify(['records', input.runId]), revision: observation.snapshot.revision,
        search: JSON.stringify([filter, version, allowed]), limit }
      const start = this.readPosition(input.cursor, call, query)
      const rows = recordRows(input, observation.records, value => this.text(value), allowed, this.options.maxContextPartBytes)
      const base = { runId: input.runId, snapshotRevision: observation.snapshot.revision, readVersion: version,
        observedAt: Date.now(), mode: input.mode, selection: { ...input.kind === undefined ? {} : { kind: input.kind },
          ...input.sequence === undefined ? {} : { sequence: input.sequence } }, bodyAccess: allowed ? 'allowed' as const : 'withheld' as const, totalRecords: rows.totalRecords }
      const wrap = (page: { items: readonly import('./records-types.ts').SimulationProductRecordItem[]
        nextCursor?: import('./types.ts').SimulationProductCursor | undefined }) => ({ ...base, items: page.items,
        ...page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor } })
      const page = wrap(this.boundedParts(rows.items, start, query, call, wrap))
      return simulationProductRecordsPageSchema.parse(page)
    }, (page) => {
      if (this.closing || page.readVersion !== this.readVersion) throw stale()
      return page
    })
  }

  /**
   * Read one filtered administrative collection at an exact native world revision.
   * @param request - Registered run, collection-specific filters and opaque continuation.
   * @param call - Current transport-authenticated principal and cancellation lifetime.
   * @returns bounded redacted rows and authoritative filtered total; changed revision/query rejects continuation.
   */
  browse(request: SimulationProductBrowseInput, call: AuthenticatedProductCall): Promise<SimulationProductCollectionPage> {
    return this.admit(call, async () => {
      const input = simulationProductBrowseInputSchema.parse(request)
      this.checkBytes(input)
      const limit = this.pageLimit(input.limit)
      const observation = await this.observe(this.readable(input.runId, call), call)
      if (observation === undefined) throw new SimulationProductError('Simulation history is not materialized', 'SIMULATION_PRODUCT_UNAVAILABLE')
      const { cursor: _cursor, limit: _limit, ...filter } = input
      const query = { scope: JSON.stringify(['collection', input.runId, input.collection]),
        revision: observation.snapshot.revision, search: JSON.stringify(filter), limit }
      const start = this.readPosition(input.cursor, call, query)
      const rows = collectionRows(input, observation.snapshot, value => this.text(value))
      const base = { runId: input.runId, snapshotRevision: observation.snapshot.revision,
        observedAt: Date.now(), collection: rows.collection }
      const page = this.boundedPage(rows.items, start, query, call, page => ({ ...base, ...page }))
      return simulationProductCollectionPageSchema.parse({ ...base, ...page })
    })
  }

  /**
   * Read exact object sections; private context text requires a separate trusted entity-scoped reader.
   * @param request - Registered run, branded object and section, optional revision fence and section page.
   * @param call - Current authenticated principal and cancellation lifetime.
   * @returns bounded section or authorized absence; stale revision/page requires explicit refresh.
   */
  inspectObject(request: SimulationProductObjectInput, call: AuthenticatedProductCall): Promise<SimulationProductObjectInspection> {
    let contextRun: SimulationProductInspectInput['runId'] | undefined
    return this.admit(call, async () => {
      const input = simulationProductObjectInputSchema.parse(request)
      this.checkBytes(input)
      const limit = this.pageLimit('limit' in input ? input.limit : undefined)
      if (input.section === 'context' || input.section === 'knowledge') { contextRun = input.runId; this.contextReadable(contextRun, undefined, call) }
      const observation = await this.observe(this.readable(input.runId, call), call)
      if (observation === undefined) throw new SimulationProductError('Simulation history is not materialized', 'SIMULATION_PRODUCT_UNAVAILABLE')
      if (input.expectedRevision !== undefined && input.expectedRevision !== observation.snapshot.revision) throw stale()
      const selection = { collection: input.collection, id: input.id, section: input.section,
        ...input.collection === 'decisions' && input.section === 'knowledge' && input.reference !== undefined ? { reference: input.reference } : {} }
      const viewer = input.collection === 'entities' ? input.id : input.collection === 'decisions'
        ? observation.snapshot.decisions[input.id]?.entityId : undefined
      const knowledgeAllowed = input.section === 'knowledge' && this.contextReadable(input.runId, viewer, call, 'knowledge')
      const sourcesAllowed = knowledgeAllowed && this.contextReadable(input.runId, viewer, call, 'sources')
      const bodyAllowed = input.collection === 'decisions' && input.section === 'context'
        && this.contextReadable(input.runId, observation.snapshot.decisions[input.id]?.entityId, call)
      const query = { scope: JSON.stringify(['object', input.runId, input.collection, input.id, input.section]),
        revision: observation.snapshot.revision, search: input.section === 'knowledge'
          ? JSON.stringify([input.collection === 'decisions' ? input.reference : undefined, knowledgeAllowed, sourcesAllowed, this.readVersion])
          : input.section === 'context'
            ? JSON.stringify([bodyAllowed, this.options.maxContextPartBytes, this.readVersion]) : '', limit }
      const start = this.readPosition('cursor' in input ? input.cursor : undefined, call, query)
      const base = { runId: input.runId, snapshotRevision: observation.snapshot.revision, observedAt: Date.now(), selection }
      let value = objectDetail(input, observation.snapshot, value => this.text(value),
        (rows, wrap) => wrap(this.boundedPage(rows, start, query, call, page => ({ ...base, status: 'found', value: wrap(page) }))),
        { allowed: bodyAllowed, knowledge: knowledgeAllowed, sources: sourcesAllowed, maxPartBytes: this.options.maxContextPartBytes,
          readVersion: this.readVersion })
      if (value?.collection === 'operations' && value.section === 'execution' && value.retry !== undefined) {
        const reader = this.operationRetryReader
        if (reader !== undefined) {
          const retry = await reader.read(input.runId, value.id, value.retry, call)
          this.authorize(call); this.readable(input.runId, call)
          if (this.operationRetryReader === reader) value = { ...value, retry }
        }
      }
      const result = { ...base, status: value === undefined ? 'missing' : 'found', ...value === undefined ? {} : { value } }
      this.checkBytes(result)
      return simulationProductObjectInspectionSchema.parse(result)
    }, (result) => {
      if (contextRun === undefined || result.value === undefined
        || result.value.section !== 'context' && result.value.section !== 'knowledge'
        || !this.closing && result.value.readVersion === this.readVersion) return result
      const value = result.value
      if (value.section === 'knowledge') return { ...result, value: { ...value,
        bodyAccess: 'withheld' as const, knowledge: { items: [], total: 0 } } }
      return { ...result, value: { ...value, bodyAccess: 'withheld' as const, items: { ...value.items,
        items: value.items.items.map(item => item.kind === 'section' ? { ...item, body: { status: 'withheld' as const } } : item) } } }
    })
  }

  /**
   * Obtain the process-local registration capability for the original administration owner.
   * @returns single-reader registrar; its disposer removes hints and invalidates pending observations without native effects.
   */
  operationRetryReaderRegistrar(): (reader: SimulationProductOperationRetryReader) => () => void {
    const register = (reader: SimulationProductOperationRetryReader): (() => void) => {
      if (this.closing || this.operationRetryReader !== undefined) throw new SimulationProductError(
        'Simulation operation retry reader is unavailable', 'SIMULATION_PRODUCT_UNAVAILABLE')
      // Contextual service proxies wrap callable fields; reader/disposal identity belongs to this entry object.
      const entry = { read: reader }
      this.operationRetryReader = entry
      this.policyChanged()
      return () => { if (this.operationRetryReader === entry) { this.operationRetryReader = undefined; this.policyChanged() } }
    }
    Object.defineProperty(register, 'toJSON', { value: (): never => { throw new TypeError('Operation retry reader registration is process-local') } })
    return register
  }

  /**
   * Obtain a runtime-only policy registration capability for trusted deployment plugins, with no effect merely from discovery.
   * @returns a registrar whose validated grants retire with their disposer. It cannot be serialized or used after this service closes.
   */
  contextReaderRegistrar(): (readers: readonly SimulationProductContextReader[]) => () => void {
    const register = (readers: readonly SimulationProductContextReader[]): (() => void) => {
      if (this.closing) throw new SimulationProductError('Simulation policy registration is closed', 'SIMULATION_PRODUCT_UNAVAILABLE')
      const accepted = structuredClone(readers)
      contextReadersSchema.parse(accepted)
      const key = Symbol('context readers')
      this.contextContributions.set(key, accepted)
      this.policyChanged()
      return () => { if (this.contextContributions.delete(key)) this.policyChanged() }
    }
    Object.defineProperty(register, 'toJSON', { value: (): never => { throw new TypeError('Context reader registration is process-local') } })
    return register
  }

  /**
   * Obtain the trusted whole-run historical journal policy registrar.
   * @returns process-local registrar; disposal revokes content and invalidates waiting readers without stopping execution.
   */
  recordReaderRegistrar(): (readers: readonly SimulationProductRecordReader[]) => () => void {
    const register = (readers: readonly SimulationProductRecordReader[]): (() => void) => {
      if (this.closing) throw new SimulationProductError('Simulation policy registration is closed', 'SIMULATION_PRODUCT_UNAVAILABLE')
      const accepted = structuredClone(readers)
      recordReadersSchema.parse(accepted)
      const key = Symbol('record readers')
      this.recordContributions.set(key, accepted)
      this.policyChanged()
      return () => { if (this.recordContributions.delete(key)) this.policyChanged() }
    }
    Object.defineProperty(register, 'toJSON', { value: (): never => { throw new TypeError('Record reader registration is process-local') } })
    return register
  }

  private policyChanged(): void {
    const previous = this.policyWake
    this.readVersion = randomBytes(16).toString('hex') as SimulationProductReadVersion
    this.policyWake = new AbortController()
    previous.abort()
  }

  /**
   * Wait for metadata invalidation without opening execution or returning bodies. Polls use ordinary bounded read admission.
   * @param request - Exact run, prior authenticated cursor and optional real wait; zero is an immediate probe.
   * @param call - Current credential lease; cancellation and unload retire the wait and drain admitted native IO.
   * @returns current policy lifetime and world observation. Expired/foreign cursors reset; provider absence is explicit.
   */
  watch(request: SimulationProductWatchInput, call: AuthenticatedProductCall): Promise<SimulationProductWatchResult> {
    if (this.closing) return Promise.reject(new SimulationProductError('Simulation reads are retiring', 'SIMULATION_PRODUCT_UNAVAILABLE'))
    if (call.signal.aborted) return Promise.reject(forbidden())
    if (this.watchers.size >= this.options.maxWatchers) return Promise.reject(new SimulationProductError(
      'Simulation watch capacity is occupied', 'SIMULATION_PRODUCT_UNAVAILABLE'))
    const input = simulationProductWatchInputSchema.parse(request)
    this.checkBytes(input)
    const controller = new AbortController()
    const signal = AbortSignal.any([call.signal, controller.signal])
    const work = this.ready.then(() => this.waitChanges(input, { ...call, signal }, call))
    this.watchers.set(controller, work)
    void work.then(() => this.watchers.delete(controller), () => this.watchers.delete(controller))
    return work
  }

  private async waitChanges(input: SimulationProductWatchInput, linked: AuthenticatedProductCall,
    original: AuthenticatedProductCall): Promise<SimulationProductWatchResult> {
    this.authorize(linked); this.readable(input.runId, linked)
    const scope = JSON.stringify(['watch', input.runId])
    let prior: { revision: number; readVersion: string } | undefined, reset = false
    if (input.cursor !== undefined) {
      try { prior = this.codec.watchRevision(input.cursor, linked, scope) }
      catch { reset = true }
    }
    const deadline = performance.now() + Math.min(input.waitMs ?? this.options.maxWatchWaitMs, this.options.maxWatchWaitMs)
    try {
      for (;;) {
        const policyWake = this.policyWake.signal
        this.authorize(linked); this.readable(input.runId, linked)
        let world: SimulationProductWatchWorld
        try {
          const observation = await this.inspect({ runId: input.runId }, linked)
          world = observation.world === undefined ? { status: 'missing' } : { status: 'observed', revision: observation.world.revision }
        } catch (cause: unknown) {
          this.authorize(linked); this.readable(input.runId, linked)
          if (!(cause instanceof SimulationProductError) || cause.code !== 'SIMULATION_PRODUCT_UNAVAILABLE') throw cause
          world = { status: 'unavailable' }
        }
        const revision = world.status === 'observed' ? world.revision : world.status === 'missing' ? -1 : -2
        const policyReset = reset || prior !== undefined && prior.readVersion !== this.readVersion
        if (policyReset || prior === undefined || revision !== prior.revision || performance.now() >= deadline) {
          this.authorize(linked); this.readable(input.runId, linked)
          const value = { runId: input.runId, readVersion: this.readVersion, observedAt: Date.now(), world,
            status: policyReset ? 'reset' as const : prior?.revision === revision ? 'unchanged' as const : 'changed' as const,
            cursor: this.codec.encode(linked, { scope, revision, search: `watch:${this.readVersion}`, limit: 1, offset: 0 }) }
          this.checkBytes(value)
          return simulationProductWatchResultSchema.parse(value)
        }
        try {
          await delay(Math.min(this.options.watchPollMs, Math.max(0, deadline - performance.now())), undefined,
            { signal: AbortSignal.any([linked.signal, policyWake]) })
        } catch (cause: unknown) { if (!policyWake.aborted || linked.signal.aborted) throw cause }
      }
    } catch (cause: unknown) {
      this.authorize(original)
      if (this.closing) throw new SimulationProductError('Simulation reads are retiring', 'SIMULATION_PRODUCT_UNAVAILABLE')
      throw cause
    }
  }

  /** Provider success and failure settle under the same post-IO authorization check. */
  private async observe(record: SimulationProductRecord, call: AuthenticatedProductCall,
    includeRecords = false): Promise<SimulationRunObservation | undefined> {
    let observation
    const selection = { provider: record.provider, spec: record.spec, ...includeRecords ? { includeRecords: true } : {} }
    try { observation = await this.ctx.simulations.inspect(this.ctx.simulations.resolveInspection(selection)) }
    catch {
      this.authorize(call); this.readable(record.id, call)
      throw new SimulationProductError('Simulation history is unavailable for inspection', 'SIMULATION_PRODUCT_UNAVAILABLE')
    }
    this.authorize(call); this.readable(record.id, call)
    return observation
  }

  private pageLimit(value: number | undefined): number {
    const limit = value ?? this.options.maxPageSize
    if (limit > this.options.maxPageSize) throw invalid('Simulation object page size exceeds deployment allowance')
    return limit
  }
  private readPosition(cursor: import('./types.ts').SimulationProductCursor | undefined, call: AuthenticatedProductCall,
    query: { scope: string; revision: number; search: string; limit: number }): number {
    if (cursor === undefined) return 0
    // Authentication, revision and selector mismatch share one public refresh instruction.
    try { return this.codec.decode(cursor, call, query) }
    catch { throw stale() }
  }
  /** Account for the complete wrapper while retaining at most one iterable text window. */
  private boundedParts<T>(rows: Iterable<T>, start: number, query: { scope: string; revision: number; search: string; limit: number },
    call: AuthenticatedProductCall, wrap: (page: { items: readonly T[]; nextCursor?: import('./types.ts').SimulationProductCursor | undefined }) => unknown) {
    const items: T[] = []
    let position = 0, more = false
    for (const item of rows) {
      if (position++ < start) continue
      if (items.length === query.limit) { more = true; break }
      items.push(item)
    }
    const continuation = () => more ? this.codec.encode(call, { ...query, offset: start + items.length }) : undefined
    let page = { items, nextCursor: continuation() }
    while (Buffer.byteLength(JSON.stringify(wrap(page))) > this.options.maxBytes && items.length > 1) {
      items.pop(); more = true
      page = { items, nextCursor: continuation() }
    }
    this.checkBytes(wrap(page))
    return page
  }

  private boundedPage<T>(rows: readonly T[], start: number, query: { scope: string; revision: number; search: string; limit: number },
    call: AuthenticatedProductCall, wrap: (page: { items: readonly T[]
      total: number
      nextCursor?: import('./types.ts').SimulationProductCursor | undefined }) => unknown) {
    const items = rows.slice(start, start + query.limit)
    let offset = start + items.length
    let page = { items, total: rows.length, ...offset < rows.length ? { nextCursor: this.codec.encode(call, { ...query, offset }) } : {} }
    while (Buffer.byteLength(JSON.stringify(wrap(page))) > this.options.maxBytes && items.length > 0) {
      if (items.length === 1) throw invalid('Simulation object row exceeds complete response allowance')
      items.pop(); offset--
      page = { items, total: rows.length, nextCursor: this.codec.encode(call, { ...query, offset }) }
    }
    this.checkBytes(wrap(page))
    return page
  }

  private admit<T>(call: AuthenticatedProductCall, operation: () => T | Promise<T>, settled?: (value: T) => T): Promise<T> {
    if (this.closing) return Promise.reject(new SimulationProductError('Simulation directory is closed', 'SIMULATION_PRODUCT_UNAVAILABLE'))
    if (call.signal.aborted) return Promise.reject(forbidden())
    if (this.pending.size >= this.options.maxPendingReads) return Promise.reject(new SimulationProductError(
      'Simulation product read capacity is occupied', 'SIMULATION_PRODUCT_UNAVAILABLE'))
    const result = this.ready.then(async () => {
      this.authorize(call)
      const value = await operation(); this.authorize(call); return settled === undefined ? value : settled(value)
    })
    this.pending.add(result)
    void result.then(() => this.pending.delete(result), () => this.pending.delete(result))
    return result
  }
  private authorize(call: AuthenticatedProductCall): void { if (call.signal.aborted) throw forbidden() }
  private contextReadable(runId: SimulationProductInspectInput['runId'], entityId: import('@clocky/clocky-simulation/identities').SimulationEntityId | undefined,
    call: AuthenticatedProductCall, content: 'context' | 'knowledge' | 'sources' = 'context'): boolean {
    this.authorize(call); this.readable(runId, call)
    if (this.closing) return false
    const matches = (reader: SimulationProductContextReader) => reader.principalId === call.principal.id
      && (reader.runId === undefined || reader.runId === runId) && entityId !== undefined && reader.entityIds.includes(entityId) && (reader.content ?? ['context']).includes(content)
    return this.options.contextReaders.some(matches) || [...this.contextContributions.values()].some(readers => readers.some(matches))
  }
  private readable(id: string, call: AuthenticatedProductCall): SimulationProductRecord {
    const record = this.records.get(id)
    if (record === undefined || record.ownerPrincipalId !== call.principal.id) throw forbidden()
    return record
  }
  private checkCapacity(): void { if (this.records.size > this.options.maxRuns) throw invalid('Retained Simulation directory exceeds capacity') }
  private checkBytes(value: unknown): void {
    if (Buffer.byteLength(JSON.stringify(value)) > this.options.maxBytes) throw invalid('Simulation product value exceeds complete byte allowance')
  }
  private checkDirectoryEntry(value: unknown): void {
    if (Buffer.byteLength(JSON.stringify(value)) > this.options.maxDirectoryEntryBytes) {
      throw invalid('Simulation directory registration exceeds durable entry byte allowance')
    }
  }
  private text(value: string): SimulationProductText {
    let text = ''
    for (const character of value) {
      if (Buffer.byteLength(text + character) > this.options.maxTextBytes) break
      text += character
    }
    return { text, truncated: text !== value }
  }
  private summary(record: SimulationProductRecord): SimulationProductRunSummary {
    return { id: record.id, name: this.text(record.name), registeredAt: record.registeredAt, observation: 'not-observed' }
  }
}
export default SimulationProducts

/** Missing/private records share one public refusal. */
function forbidden(): SimulationProductError { return new SimulationProductError('Simulation product access is unavailable', 'SIMULATION_PRODUCT_FORBIDDEN') }
/** Return an explicit deployment/query refusal without silently truncating data. */
function invalid(message: string): SimulationProductError { return new SimulationProductError(message, 'SIMULATION_PRODUCT_INVALID') }
/** All stale object selectors require rereading from the first page. */
function stale(): SimulationProductError {
  return new SimulationProductError('Simulation observation expired; refresh from the first page', 'SIMULATION_PRODUCT_STALE')
}
