import { simulationProductRawArchiveInputSchema, simulationProductRawArchivePageSchema } from './raw-archive-schema.ts'
import { textParts } from './context-details.ts'
/** Authenticated product registration and read routing; world and execution remain provider-owned. */
import { SimulationProductReadError, simulationProductReadFailure, simulationProductReadLimit } from './failure.ts'
import { SimulationRevisionConflictError } from '@clocky/clocky-simulation'
import type { SimulationProductRunId } from './types.ts'
import { simulationProductRebuildIndexInputSchema, simulationProductRebuildIndexResultSchema } from './index-maintenance-schema.ts'
import type { SimulationProductRebuildIndexInput, SimulationProductRebuildIndexResult } from './index-maintenance-schema.ts'
import { ScenarioDraftStore } from './draft-store.ts'
import type { ScenarioDraftSave, ScenarioDraftSaveResult, ScenarioDraftRead, ScenarioDraftReadResult } from './draft-schema.ts'
import { simulationProductWorldDomainInputSchema, simulationProductWorldDomainResultSchema, retireWorldReadBodies } from './world-read-schema.ts'
import { projectWorldDomain } from './world-read-projection.ts'
import type { SimulationProductWorldDomainInput, SimulationProductWorldDomainResult, Coverage } from './world-read-types.ts'
import { PERSONNEL_OBLIGATION_MAX_ITEMS, PERSONNEL_OBLIGATION_MAX_BYTES, simulationEntityIdSchema, worldRequestIdSchema } from '@clocky/clocky-simulation'
import { readEnvelopeSource, envelopeSourceParts } from './envelope-source.ts'
import { simulationProductSourceInputSchema, simulationProductSourceInspectionSchema } from './sources-schema.ts'
import type { SimulationProductSourceInput, SimulationProductSourceInspection } from './sources-types.ts'
import { recordRows } from './records.ts'
import { worldCaseSummary, worldCasePlans, worldCaseDetail } from './cases.ts'
import type { SimulationProductWorldCasesInput, SimulationProductWorldCasesPage, SimulationProductWorldCaseInput,
  SimulationProductWorldCaseInspection, SimulationProductWorldCaseSummary } from './case-types.ts'
import { simulationProductWorldCasesInputSchema, simulationProductWorldCasesPageSchema,
  simulationProductWorldCaseInputSchema, simulationProductWorldCaseInspectionSchema,
  simulationProductWorldCaseCancelCapabilitySchema } from './case-schema.ts'
import type { SimulationProductCaseReader, SimulationProductWorldCaseControlReader } from './registration-types.ts'
import type { SimulationProductWorldManagementReader } from './registration-types.ts'
import { simulationProductRecordsInputSchema, simulationProductRecordsPageSchema } from './records-schema.ts'
import type { SimulationProductRecordsInput, SimulationProductRecordsPage } from './records-types.ts'
import { Context, Service } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { LogStream } from '@clocky/clocky-storage'
import type {} from '@clocky/clocky-storage-log'
import type {} from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-team'
import type { SimulationRunObservation } from '@clocky/clocky-simulation'
import { simulationRuntimeMetrics, projectPersonnelCounts, combinePersonnelCounts } from '@clocky/clocky-simulation'
import { productPeopleCounts } from './people.ts'
import type { SimulationProductPeopleCounts } from './people-types.ts'
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
import { createHash, randomBytes } from 'node:crypto'
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
export { simulationProductWorldCasesInputSchema, simulationProductWorldCasesPageSchema,
  simulationProductWorldCaseInputSchema, simulationProductWorldCaseInspectionSchema } from './case-schema.ts'
export type { SimulationAdministration, Config as SimulationAdministrationConfig } from './administration.ts'
export { prepareSimulationCompany, simulationCompanyPreparationSchema } from './company-preparation.ts'
export type { SimulationCompanyPreparation, SimulationCompanyPrepared } from './company-preparation.ts'
export { prepareSimulationWorld } from './world-preparation.ts'
export type { SimulationWorldPreparation, SimulationWorldPrepared } from './world-preparation.ts'
export { preflightSimulationWorld } from './world-preflight.ts'
export { simulationProductWorldCreateInputSchema, simulationProductWorldPreflightInputSchema,
  simulationProductWorldPreflightResultSchema, simulationProductWorldExportResultSchema } from './world-schema.ts'
export type { SimulationProductWorldCreateInput, SimulationProductWorldPreflightInput,
  SimulationProductWorldPreflightResult, SimulationProductWorldExportResult } from './world-types.ts'
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
  /** Maximum immutable authoring revisions in the dedicated draft journal; ancestors are never silently evicted. */
  readonly maxDraftRevisions?: number
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
  /** Separate trusted World case prose and Persona grants; owning a run grants neither. */
  readonly caseReaders?: SimulationProductCaseReader[]
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
  maxDraftRevisions: z.number().min(1).step(1).default(10000),
  recoveryPageSize: z.number().min(1).step(1).default(64), maxPendingReads: z.number().min(1).step(1).default(32),
  maxPageSize: z.number().min(1).step(1).default(64),
  maxBytes: z.number().min(1).step(1).default(1048576), maxDirectoryEntryBytes: z.number().min(1).step(1).default(1048576),
  maxTextBytes: z.number().min(1).step(1).default(512),
  recordReaders: z.array(z.any()).default([]), contextReaders: z.array(z.any()).default([]),
  caseReaders: z.array(z.any()).default([]),
  maxContextPartBytes: z.number().min(4).step(1).default(16384),
  maxWatchers: z.number().min(1).step(1).default(32), maxWatchWaitMs: z.number().min(1).max(2147483647).step(1).default(20000),
  watchPollMs: z.number().min(1).max(2147483647).step(1).default(2000),
})
const recordReadersSchema = wire.array(wire.strictObject({ principalId: wire.string().min(1), runId: wire.string().min(1).optional(),
  includeProvenance: wire.boolean().optional() }).refine(reader => reader.includeProvenance !== true || reader.runId !== undefined,
  'Provenance disclosure requires an exact run identity'))
const caseReadersSchema = wire.array(wire.strictObject({ principalId: wire.string().min(1), runId: wire.string().min(1).optional(),
  requestIds: wire.array(wire.string().min(1)).min(1).refine(ids => new Set(ids).size === ids.length,
    'Case reader request identities must be distinct').optional(),
  content: wire.array(wire.enum(['case', 'persona'])).min(1).refine(values => new Set(values).size === values.length,
    'Case reader domains must be distinct') }))
const contextReadersSchema = wire.array(wire.strictObject({ principalId: wire.string().min(1), runId: wire.string().min(1).optional(),
  content: wire.array(wire.enum(['context', 'knowledge', 'sources'])).min(1).optional(),
  entityIds: wire.array(wire.string().min(1)).min(1).refine(ids => new Set(ids).size === ids.length, 'Context reader entities must be distinct') }))

/** Public product read failures do not reveal private provider diagnostics. */
export class SimulationProductError extends Error {
  /** Stable public category. */
  readonly code: 'SIMULATION_PRODUCT_FORBIDDEN' | 'SIMULATION_PRODUCT_INVALID' | 'SIMULATION_PRODUCT_UNAVAILABLE' | 'SIMULATION_PRODUCT_STALE'
    | 'SIMULATION_PRODUCT_MODEL_CHANGED' | 'SIMULATION_PRODUCT_PREFLIGHT_CHANGED' | 'SIMULATION_PRODUCT_MANAGEMENT_PREVIEW_CHANGED'
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
  private readonly caseContributions = new Map<symbol, readonly SimulationProductCaseReader[]>()
  private caseControlReader: { readonly read: SimulationProductWorldCaseControlReader } | undefined
  private managementReader: { readonly read: SimulationProductWorldManagementReader } | undefined
  private operationRetryReader?: { readonly read: SimulationProductOperationRetryReader } | undefined
  private readonly watchers = new Map<AbortController, Promise<SimulationProductWatchResult>>()
  private records = new Map<string, SimulationProductRecord>()
  private stream: LogStream | undefined
  private directoryRevision = -1
  private readonly pending = new Set<Promise<unknown>>()
  private closing = false
  private readonly ready: Promise<void>
  private draftStream: LogStream | undefined
  private drafts: ScenarioDraftStore | undefined
  private registrationTail: Promise<unknown> = Promise.resolve()

  /** @param ctx - Required directory storage and native inspection services. @param config - Trusted deployment registration. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'simulationProducts')
    this.options = { directoryStream: config.directoryStream, imports: config.imports ?? [], maxRuns: config.maxRuns ?? 10000,
      maxDraftRevisions: config.maxDraftRevisions ?? 10000,
      recoveryPageSize: config.recoveryPageSize ?? 64, maxPendingReads: config.maxPendingReads ?? 32, maxPageSize: config.maxPageSize ?? 64,
      maxBytes: config.maxBytes ?? 1048576, maxDirectoryEntryBytes: config.maxDirectoryEntryBytes ?? 1048576,
      maxTextBytes: config.maxTextBytes ?? 512, contextReaders: structuredClone(config.contextReaders ?? []),
      recordReaders: structuredClone(config.recordReaders ?? []),
      caseReaders: structuredClone(config.caseReaders ?? []),
      maxContextPartBytes: config.maxContextPartBytes ?? 16384, maxWatchers: config.maxWatchers ?? 32,
      maxWatchWaitMs: config.maxWatchWaitMs ?? 20000, watchPollMs: config.watchPollMs ?? 2000 }
    contextReadersSchema.parse(this.options.contextReaders)
    recordReadersSchema.parse(this.options.recordReaders)
    caseReadersSchema.parse(this.options.caseReaders)
    if (!Number.isSafeInteger(this.options.maxContextPartBytes) || this.options.maxContextPartBytes < 4) {
      throw invalid('Simulation context text parts require an allowance of at least four bytes')
    }
    if (this.options.directoryStream.trim().length === 0) throw invalid('Simulation directory stream must have a name')
    for (const value of [this.options.maxRuns, this.options.maxDraftRevisions, this.options.recoveryPageSize,
      this.options.maxPendingReads, this.options.maxPageSize,
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
      await this.drafts?.drain()
      await this.draftStream?.close()
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
    this.draftStream = await this.ctx.storageLog.open({ name: `${this.options.directoryStream}:author-drafts`, version: 2 })
    this.drafts = new ScenarioDraftStore(this.draftStream, { maxEntries: this.options.maxDraftRevisions,
      maxResultBytes: this.options.maxBytes, maxBytes: this.options.maxDirectoryEntryBytes, pageSize: this.options.recoveryPageSize })
    await this.drafts.load()
  }

  /** Read the current author's original saved definition.
   * @param request - Exact private draft and optional revision.
   * @param call - Authenticated author.
   * @returns the original saved definition without opening a run or invoking a model. */
  readScenarioDraft(request: ScenarioDraftRead, call: AuthenticatedProductCall): Promise<ScenarioDraftReadResult> {
    return this.admit(call, () => {
      if (this.drafts === undefined) throw invalid('Draft owner is unavailable')
      const result = this.drafts.read(request, call); this.checkBytes(result); return result
    })
  }
  /** Save one private immutable revision without editing any running world.
   * @param request - Original save intent and parent revision.
   * @param call - Authenticated author.
   * @returns saved revision or explicit conflict; no running world is changed. */
  saveScenarioDraft(request: ScenarioDraftSave, call: AuthenticatedProductCall): Promise<ScenarioDraftSaveResult> {
    return this.admit(call, async () => {
      if (this.drafts === undefined) throw invalid('Draft owner is unavailable')
      const result = await this.drafts.save(request, call); this.checkBytes(result); return result
    })
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
      const people = observation === undefined ? undefined : await this.observePeople(record, observation, call)
      let value: SimulationProductRunInspection
      try { value = this.runInspection(record, observation, people) }
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
          const people = observation === undefined ? undefined : await this.observePeople(record, observation, call)
          this.authorize(call); this.readable(record.id, call)
          return this.runInspection(record, observation, people)
        } catch (cause: unknown) {
          this.authorize(call); this.readable(record.id, call)
          return { reason: simulationProductReadFailure(cause),
            ...simulationProductReadLimit(cause) === undefined ? {} : { readLimit: simulationProductReadLimit(cause) }, run: this.summary(record), status: 'unavailable', errorSummary: this.text('Simulation observation is unavailable'),
            operational: { status: 'unavailable', observedAt: Date.now(), scenario: { status: 'unavailable' } } }
        }
      }))
      this.authorize(call)
      for (const record of records) this.readable(record.id, call)
      const items: SimulationProductRunStatus[] = []
      for (const result of results) {
        /* v8 ignore next -- Per-run errors become unavailable; monotonic authority failures fail the batch recheck above. */
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
    observation: SimulationRunObservation | undefined, people?: SimulationProductPeopleCounts): SimulationProductRunInspection {
    return { run: this.summary(record), status: observation === undefined ? 'missing' : 'observed',
      operational: { status: 'unavailable', observedAt: Date.now(), scenario: { status: 'unavailable' } },
      ...observation === undefined ? {} : { world: { worldInitialized: observation.snapshot.world !== undefined,
        revision: observation.snapshot.revision, phase: observation.snapshot.phase,
        time: observation.snapshot.time, tickUnit: this.text(observation.snapshot.spec.tickUnit),
        rulesVersion: this.text(observation.snapshot.spec.rulesVersion), policyVersion: this.text(observation.snapshot.spec.policyVersion),
        metrics: simulationRuntimeMetrics(observation.snapshot, observation.owner), owner: observation.owner,
        ...people === undefined ? {} : { people },
        ...observation.snapshot.stall === undefined ? {} : { schedulerStop: {
          code: observation.snapshot.stall.code, recovery: observation.snapshot.stall.recovery } },
        entityCount: Object.keys(observation.snapshot.entities).length, decisionCount: Object.keys(observation.snapshot.decisions).length,
        operationCount: Object.keys(observation.snapshot.operations).length, observedAt: Date.now() } } }
  }

  /** Observe complete Team history between matching Native cursors; unavailable history never becomes zero. */
  private async observePeople(record: SimulationProductRecord, observation: SimulationRunObservation,
    call: AuthenticatedProductCall): Promise<SimulationProductPeopleCounts> {
    const state = observation.snapshot, native = projectPersonnelCounts(state)
    const unknown = (reason: 'unavailable' | 'unsupported' | 'source-moved') =>
      productPeopleCounts(combinePersonnelCounts(state, native, { kind: 'unknown', reason }))
    const teams = this.ctx.get('teams')
    if (teams === undefined) return unknown('unsupported')
    const reservation = state.teamReservation
    if (reservation?.confirmed !== true) return unknown('unavailable')
    const version = this.readVersion
    let team
    try { team = await teams.getTeam({ teamId: reservation.teamId }) }
    catch {
      // A missing or unsupported Team source withholds history; current authentication still decides the whole response.
      this.authorize(call); this.readable(record.id, call)
      return unknown('unavailable')
    }
    this.authorize(call); this.readable(record.id, call)
    const after = await this.observe(record, call)
    if (version !== this.readVersion || after?.snapshot.revision !== state.revision) return unknown('source-moved')
    let counts
    try { counts = combinePersonnelCounts(state, native, { kind: 'full', runId: state.spec.runId,
      nativeCursor: state.revision, teamCursor: team.team.cursor, team }) }
    catch {
      // Inconsistent cross-owner identity evidence cannot support complete history counts.
      return unknown('unavailable')
    }
    return productPeopleCounts(counts)
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
      // A frozen source is bound to its exact Envelope, decision revision and read version, not to the moving observation
      // hash: World advancement must not expire a lookup or body continuation.
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

  /** Current whole-record disclosure authority shared by live and archived source readers; ownership alone is insufficient.
   * @param runId - Original directory run, resolved only after caller validation.
   * @param call - Current principal credential lifetime.
   * @returns current independent whole-record grant without opening execution.
   */
  recordBodyAllowed(runId: SimulationProductRunId, call: AuthenticatedProductCall): boolean {
    this.authorize(call); this.readable(runId, call)
    const matches = (reader: SimulationProductRecordReader) => reader.principalId === call.principal.id
      && (reader.runId === undefined || reader.runId === runId)
    return !this.closing && (this.options.recordReaders.some(matches)
      || [...this.recordContributions.values()].some(readers => readers.some(matches)))
  }

  /** Explicit whole-ancestor closure permission for this exact owned branch; a wildcard run grant cannot supply it.
   * @param runId - Exact current branch registration.
   * @param call - Current authenticated owner and disclosure lifetime.
   * @returns current explicit closure permission; absence never infers permission from shared principal identity.
   */
  provenanceBodyAllowed(runId: SimulationProductRunId, call: AuthenticatedProductCall): boolean {
    this.authorize(call); this.readable(runId, call)
    const matches = (reader: SimulationProductRecordReader) => reader.principalId === call.principal.id
      && reader.runId === runId && reader.includeProvenance === true
    return !this.closing && (this.options.recordReaders.some(matches)
      || [...this.recordContributions.values()].some(readers => readers.some(matches)))
  }

  /**
   * Preserve original source bytes under an explicit whole-record grant even when its Native parser is unavailable.
   * @param request - Registered run and encrypted source/policy-bound text continuation; no caller paths or role hints.
   * @param call - Current owner and whole-record permission, rechecked after storage IO and before publication.
   * @returns bounded raw-only text parts; this never opens a writer, interprets Native state or claims a complete checkpoint.
   */
  archiveRaw(request: import('./raw-archive-types.ts').SimulationProductRawArchiveInput, call: AuthenticatedProductCall):
  Promise<import('./raw-archive-types.ts').SimulationProductRawArchivePage> {
    return this.admit(call, async () => {
      const input = simulationProductRawArchiveInputSchema.parse(request); this.checkBytes(input)
      const record = this.readable(input.runId, call), version = this.readVersion, limit = this.pageLimit(input.limit)
      const authorize = () => {
        this.authorize(call); this.readable(input.runId, call)
        if (version !== this.readVersion || !this.recordBodyAllowed(input.runId, call)) throw forbidden()
      }
      authorize()
      let archive
      try { archive = await this.ctx.simulations.rawArchive({ provider: record.provider, spec: record.spec }) }
      catch (cause: unknown) {
        authorize()
        throw new SimulationProductReadError(simulationProductReadFailure(cause), simulationProductReadLimit(cause))
      }
      authorize()
      if (archive === undefined) throw new SimulationProductReadError('unavailable')
      const { text, ...source } = archive
      const originalText = text
      const query = { scope: JSON.stringify(['raw-archive', input.runId, source.sourceHash]), revision: source.tailSequence,
        search: JSON.stringify([version, source.journalVersion, this.options.maxContextPartBytes]), limit }
      const start = this.readPosition(input.cursor, call, query)
      let totalParts = 0
      for (const _part of textParts(text, this.options.maxContextPartBytes)) totalParts++
      function* rows(maxBytes: number) { let part = 0; for (const text of textParts(originalText, maxBytes)) yield { part: part++, text } }
      const base = { runId: input.runId, readVersion: version, observedAt: Date.now(), source, totalParts }
      const page = this.boundedParts(rows(this.options.maxContextPartBytes), start, query, call, window => ({ ...base, ...window }))
      authorize()
      const result = { ...base, ...page }
      this.checkBytes(result)
      return simulationProductRawArchivePageSchema.parse(result)
    }, (page) => {
      this.authorize(call); this.readable(page.runId, call)
      if (this.closing || page.readVersion !== this.readVersion || !this.recordBodyAllowed(page.runId, call)) throw forbidden()
      return page
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
      const allowed = this.recordBodyAllowed(input.runId, call)
      const { cursor: _cursor, limit: _limit, expectedRevision: _expectedRevision, ...filter } = input
      const query = { scope: JSON.stringify(['records', input.runId]), revision: observation.snapshot.revision,
        search: JSON.stringify([filter, version, allowed]), limit }
      const start = this.readPosition(input.cursor, call, query, observation)
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
   * Explicitly rebuild derived references for the authenticated owner's exact source prefix.
   * @param request - Owned run and expected revision; retries preserve the selected source.
   * @param call - Live transport identity; revocation prevents new publication admission.
   * @returns published metadata without source bodies, model calls or world mutations.
   */
  rebuildIndex(request: SimulationProductRebuildIndexInput, call: AuthenticatedProductCall): Promise<SimulationProductRebuildIndexResult> {
    return this.admit(call, async () => {
      const input = simulationProductRebuildIndexInputSchema.parse(request), version = this.readVersion
      const record = this.readable(input.runId, call)
      const observation = await this.observe(record, call)
      if (observation?.snapshot.revision !== input.expectedRevision) throw stale()
      const authorize = () => {
        this.authorize(call); this.readable(input.runId, call)
        if (this.closing || version !== this.readVersion) throw stale()
      }
      let manifest: import('@clocky/clocky-simulation').SimulationIndexManifest
      try { manifest = await this.ctx.simulations.rebuildIndex(
        { provider: record.provider, spec: record.spec }, input.expectedRevision, authorize) }
      catch (cause: unknown) {
        authorize()
        if (cause instanceof SimulationRevisionConflictError) throw stale()
        throw new SimulationProductError('Simulation index maintenance is unavailable', 'SIMULATION_PRODUCT_UNAVAILABLE')
      }
      authorize()
      const { cursor, ...metadata } = manifest
      return simulationProductRebuildIndexResultSchema.parse({ runId: input.runId, snapshotRevision: cursor, ...metadata })
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
      const limit = this.pageLimit(input.limit), version = this.readVersion
      const observation = await this.observe(this.readable(input.runId, call), call)
      if (observation === undefined) throw new SimulationProductError('Simulation history is not materialized', 'SIMULATION_PRODUCT_UNAVAILABLE')
      const { cursor: _cursor, limit: _limit, ...filter } = input
      const query = { scope: JSON.stringify(['collection', input.runId, input.collection]),
        revision: observation.snapshot.revision, search: JSON.stringify([filter, version]), limit }
      const start = this.readPosition(input.cursor, call, query, observation)
      const rows = collectionRows(input, observation.snapshot, value => this.text(value))
      const base = { runId: input.runId, snapshotRevision: observation.snapshot.revision,
        observedAt: Date.now(), collection: rows.collection }
      const page = this.boundedPage(rows.items, start, query, call, page => ({ ...base, ...page }))
      if (this.closing || this.readVersion !== version) throw stale()
      return simulationProductCollectionPageSchema.parse({ ...base, ...page })
    })
  }

  /**
   * Discover original World cases without private bodies or execution allocation.
   * @param request - Owned run, exact filter and revision-bound continuation.
   * @param call - Current authenticated credential.
   * @returns bounded original case metadata; this never invokes a model.
   */
  listWorldCases(request: SimulationProductWorldCasesInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldCasesPage> {
    return this.admit(call, async () => {
      const input = simulationProductWorldCasesInputSchema.parse(request); this.checkBytes(input)
      const limit = this.pageLimit(input.limit), version = this.readVersion
      const observation = await this.observe(this.readable(input.runId, call), call)
      const state = observation?.snapshot
      if (state?.world === undefined) throw new SimulationProductError('World case history is unavailable', 'SIMULATION_PRODUCT_UNAVAILABLE')
      if (input.expectedRevision !== undefined && input.expectedRevision !== state.revision) throw stale()
      const rows: SimulationProductWorldCaseSummary[] = []
      for (const original of Object.values(state.world.requests).sort((a, b) => a.sequence - b.sequence)) {
        if (input.status === undefined || original.status === input.status) rows.push(await this.caseSummary(input.runId,
          worldCaseSummary(original, state, this.businessSummary(input.runId, state, original, call)), call, state.revision))
      }
      const query = { scope: JSON.stringify(['world-cases', input.runId]), revision: state.revision, limit,
        search: JSON.stringify([input.status, version, createHash('sha256').update(JSON.stringify(
          rows.map(row => [row.cancel, row.businessSummary]))).digest('hex')]) }
      const base = { runId: input.runId, snapshotRevision: state.revision, readVersion: version, observedAt: Date.now() }
      const page = this.boundedPage(rows, this.readPosition(input.cursor, call, query, observation),
        query, call, page => ({ ...base, ...page }))
      if (this.closing || this.readVersion !== version) throw stale()
      return simulationProductWorldCasesPageSchema.parse({ ...base, ...page })
    })
  }

  /**
   * Read one exact bounded World domain window without acquiring a writable run or execution connection.
   * @param request - Kind-specific selector, exact temporal and continuation fences, with no caller-selected policy.
   * @param call - Authenticated owner; private bodies require additional current context/case/Persona grants.
   * @returns one detached public projection and explicit source coverage, or a strict missing original.
   * Pages shrink to the complete reply byte allowance; an oversized single row refuses without truncating its structure.
   */
  readWorldDomain(request: SimulationProductWorldDomainInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldDomainResult> {
    return this.admit(call, async () => {
      const input = simulationProductWorldDomainInputSchema.parse(request); this.checkBytes(input)
      const limit = this.pageLimit(input.limit), version = this.readVersion
      if (input.readVersion !== undefined && input.readVersion !== version) throw stale()
      const record = this.readable(input.runId, call)
      const observation = await this.observe(record, call)
      let state = observation?.snapshot
      if (state?.world === undefined) throw new SimulationProductError('World domain history is unavailable', 'SIMULATION_PRODUCT_UNAVAILABLE')
      let personnel: import('@clocky/clocky-simulation').PersonnelObligationReport | undefined
      if (input.kind === 'person' && input.section === 'obligations') {
        const person = state.entities[simulationEntityIdSchema.parse(input.personId)]
        if (person?.kind === 'person') {
          const inventory = await this.observePersonnel(record, { selector: { kind: 'person', personId: person.id,
            personRevision: person.revision }, limit: PERSONNEL_OBLIGATION_MAX_ITEMS,
          maxBytes: Math.min(this.options.maxBytes, PERSONNEL_OBLIGATION_MAX_BYTES) }, call)
          if (inventory === undefined) throw new SimulationProductError('World personnel source is unavailable', 'SIMULATION_PRODUCT_UNAVAILABLE')
          state = inventory.snapshot
          personnel = inventory.report
        }
      }
      if (input.expectedRevision !== undefined && input.expectedRevision !== state.revision) throw stale()
      const at = input.at ?? state.time
      if (at !== state.time && input.kind !== 'governance' && input.kind !== 'proposal' && input.kind !== 'norm')
        throw new SimulationProductError('Historical lifecycle requires its original Native prefix', 'SIMULATION_PRODUCT_UNAVAILABLE')
      if (BigInt(at) > BigInt(state.time)) throw invalid('World reads cannot select an unobserved future Native time')
      const { cursor: _cursor, expectedRevision: _revision, readVersion: _readVersion, ...selection } = input
      const canonical = Object.entries(selection).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))
      const summarySources = input.kind !== 'case-extensions' ? undefined : input.requestIds.map((requestId) => {
        const selected = state.world?.requests[worldRequestIdSchema.parse(requestId)]
        return selected === undefined ? null : this.businessSummary(input.runId, state, selected, call)
      })
      const summaryFingerprint = summarySources === undefined ? null
        : createHash('sha256').update(JSON.stringify(summarySources)).digest('hex')
      const query = { scope: JSON.stringify(['world-domain', input.runId, input.kind]), revision: state.revision,
        search: JSON.stringify([canonical, version, summaryFingerprint, personnel === undefined ? null
          : createHash('sha256').update(JSON.stringify(personnel)).digest('hex')]), limit }
      const offset = this.readPosition(input.cursor, call, query, observation)
      const projectPage = (pageSize: number) => {
        const projected = projectWorldDomain(state, input, { runId: input.runId, at, limit, personnel,
          businessSummary: (requestId) => {
            const selected = state.world?.requests[worldRequestIdSchema.parse(requestId)]
            return selected === undefined ? { status: 'unknown' } : this.businessSummary(input.runId, state, selected, call)
          },
          actions: personId => this.managementReader?.read(input.runId, state, personId, call) ?? [],
          text: value => this.text(value),
          context: (entityId, content) => version === this.readVersion
            && this.contextReadable(input.runId, simulationEntityIdSchema.parse(entityId), call, content),
          case: requestId => version === this.readVersion
            && this.caseReadable(input.runId, worldRequestIdSchema.parse(requestId), call, 'case'),
          persona: requestId => version === this.readVersion
            && this.caseReadable(input.runId, worldRequestIdSchema.parse(requestId), call, 'persona'),
          resident: (entity) => {
            if (entity.writer?.phase !== 'active' || entity.binding === undefined) return false
            const agent = this.ctx.get('agents')?.get(entity.binding.sessionId)
            return agent !== undefined && agent.session.header.teamId === entity.binding.teamId
              && agent.session.header.participantId === entity.binding.participantId
          },
          page: <T>(items: readonly T[], scope: string, incomplete: boolean | Coverage['reason'] = false) => {
            const selected = items.slice(offset, offset + pageSize), more = offset + selected.length < items.length
            const coverage: Coverage = { loaded: selected.length, revision: state.revision, at, scope,
              complete: offset === 0 && !more && !incomplete, ...incomplete
                ? { reason: typeof incomplete === 'string' ? incomplete : 'native-only' } : { total: items.length },
              ...!more ? {} : { nextCursor: this.codec.encode(call, { ...query, offset: offset + selected.length }) } }
            return { items: selected, coverage }
          } })
        return { apiVersion: 'clocky.world-read/v1', kind: input.kind, runId: input.runId,
          snapshotRevision: state.revision, readVersion: version, observedAt: Date.now(), selection: input,
          status: projected.value === undefined ? 'missing' : 'found', coverage: projected.coverage,
          ...projected.value === undefined ? {} : { value: projected.value } }
      }
      let result = projectPage(limit)
      while (Buffer.byteLength(JSON.stringify(result)) > this.options.maxBytes && result.coverage.loaded > 1) {
        result = projectPage(result.coverage.loaded - 1)
      }
      this.checkBytes(result)
      return simulationProductWorldDomainResultSchema.parse(result)
    }, result => this.closing || result.readVersion !== this.readVersion
      ? simulationProductWorldDomainResultSchema.parse(retireWorldReadBodies(result)) : result)
  }

  /**
   * Read one original World case section with separate case-prose and Persona permission.
   * @param request - Original case, independently authorized section and continuation.
   * @param call - Current authenticated credential.
   * @returns bounded details; revoked policy strips private bodies before the response settles.
   */
  inspectWorldCase(request: SimulationProductWorldCaseInput,
    call: AuthenticatedProductCall): Promise<SimulationProductWorldCaseInspection> {
    let summaryOriginal: { state: import('@clocky/clocky-simulation').SimulationSnapshot
      request: import('@clocky/clocky-simulation').SimulationWorldRequest } | undefined
    return this.admit(call, async () => {
      const input = simulationProductWorldCaseInputSchema.parse(request); this.checkBytes(input)
      const limit = this.pageLimit(input.limit), version = this.readVersion
      const observation = await this.observe(this.readable(input.runId, call), call)
      const state = observation?.snapshot
      if (state?.world === undefined) throw new SimulationProductError('World case history is unavailable', 'SIMULATION_PRODUCT_UNAVAILABLE')
      if (input.expectedRevision !== undefined && input.expectedRevision !== state.revision) throw stale()
      const base = { runId: input.runId, requestId: input.requestId, section: input.section,
        snapshotRevision: state.revision, readVersion: version, observedAt: Date.now() }
      const original = state.world.requests[input.requestId]
      if (original === undefined) return simulationProductWorldCaseInspectionSchema.parse({ ...base, status: 'missing' })
      summaryOriginal = { state, request: original }
      const summary = await this.caseSummary(input.runId,
        worldCaseSummary(original, state, this.businessSummary(input.runId, state, original, call)), call, state.revision)
      const current = !this.closing && version === this.readVersion && (input.readVersion === undefined || input.readVersion === version)
      const grants = { case: current && this.caseReadable(input.runId, input.requestId, call, 'case'),
        persona: current && this.caseReadable(input.runId, input.requestId, call, 'persona') }
      let value
      if (input.section === 'plans') {
        const rows = worldCasePlans(input.requestId, state, value => this.text(value), grants)
        const query = { scope: JSON.stringify(['world-case', input.runId, input.requestId, 'plans']), revision: state.revision,
          limit, search: JSON.stringify([version, grants, summary.cancel]) }
        const page = this.boundedPage(rows, this.readPosition(input.cursor, call, query, observation), query, call, page => ({ ...base, status: 'found',
          value: { section: 'plans', summary, ...page } }))
        value = { section: 'plans' as const, summary, ...page }
      } else value = worldCaseDetail(input, summary, state, value => this.text(value), grants.case)
      const result = { ...base, status: 'found' as const, value }; this.checkBytes(result)
      return simulationProductWorldCaseInspectionSchema.parse(result)
    }, (result) => {
      if (!this.closing && result.readVersion === this.readVersion || result.value === undefined) return result
      const protectedResult = { ...result, value: { ...result.value, summary: { ...result.value.summary,
        businessSummary: summaryOriginal === undefined ? { status: 'unknown' as const }
          : this.businessSummary(request.runId, summaryOriginal.state, summaryOriginal.request, call) } } }
      const value = protectedResult.value
      if (value.section === 'request') return { ...result, value: { ...value, description: { status: 'withheld' },
        ...value.evidence?.latestRevision === undefined ? {} : { evidence: { ...value.evidence,
          latestRevision: { ...value.evidence.latestRevision, answers: { status: 'withheld' as const } } } } } }
      if (value.section === 'plans') return { ...result, value: { ...value, nextCursor: undefined, items: value.items.map(plan => ({ ...plan,
        rationale: { status: 'withheld' as const }, persona: { status: plan.resolution === 'reject' ? 'not-applicable' as const : 'withheld' as const } })) } }
      return protectedResult
    })
  }

  /**
   * Obtain a trusted case-policy registrar without granting disclosure merely by discovering it.
   * @returns process-local disposable grants; installing or retiring a contribution invalidates private read lifetimes.
   */
  caseReaderRegistrar(): (readers: readonly SimulationProductCaseReader[]) => () => void {
    const register = (readers: readonly SimulationProductCaseReader[]): (() => void) => {
      if (this.closing) throw new SimulationProductError('Case policy registration is closed', 'SIMULATION_PRODUCT_UNAVAILABLE')
      const accepted = structuredClone(readers); caseReadersSchema.parse(accepted)
      const key = Symbol('case readers'); this.caseContributions.set(key, accepted); this.policyChanged()
      return () => { if (this.caseContributions.delete(key)) this.policyChanged() }
    }
    Object.defineProperty(register, 'toJSON', { value: (): never => { throw new TypeError('Case reader registration is process-local') } })
    return register
  }

  /**
   * Obtain the single original-administration case-control reader capability.
   * @returns a process-local registrar whose disposal invalidates observations without Native effects.
   */
  worldCaseControlReaderRegistrar(): (reader: SimulationProductWorldCaseControlReader) => () => void {
    const register = (read: SimulationProductWorldCaseControlReader): (() => void) => {
      if (this.closing || this.caseControlReader !== undefined) throw new SimulationProductError(
        'World case controls are unavailable', 'SIMULATION_PRODUCT_UNAVAILABLE')
      const entry = { read }; this.caseControlReader = entry; this.policyChanged()
      return () => { if (this.caseControlReader === entry) { this.caseControlReader = undefined; this.policyChanged() } }
    }
    Object.defineProperty(register, 'toJSON', { value: (): never => { throw new TypeError('World case control registration is process-local') } })
    return register
  }

  /**
   * Obtain the single original administration's read-only personnel action registrar.
   * @returns process-local metadata registration; disposal retires the hints and invalidates read continuations.
   */
  worldManagementReaderRegistrar(): (reader: SimulationProductWorldManagementReader) => () => void {
    const register = (read: SimulationProductWorldManagementReader): (() => void) => {
      if (this.closing || this.managementReader !== undefined) throw new SimulationProductError(
        'World management hints are unavailable', 'SIMULATION_PRODUCT_UNAVAILABLE')
      const entry = { read }; this.managementReader = entry; this.policyChanged()
      return () => { if (this.managementReader === entry) { this.managementReader = undefined; this.policyChanged() } }
    }
    Object.defineProperty(register, 'toJSON', { value: (): never => { throw new TypeError('World management registration is process-local') } })
    return register
  }

  /** Pure exact-version projection; body and target context permissions remain independent. */
  private businessSummary(runId: import('./types.ts').SimulationProductRunId,
    state: import('@clocky/clocky-simulation').SimulationSnapshot,
    request: import('@clocky/clocky-simulation').SimulationWorldRequest,
    call: AuthenticatedProductCall): import('./case-types.ts').SimulationProductWorldBusinessSummary {
    const record = this.readable(runId, call)
    let catalog
    try { catalog = this.ctx.simulations.domains(record.provider) }
    catch { return { status: 'unsupported' } } // This provider supplies no read-only World catalog.
    const targetId = state.world?.intents[request.intentId]?.targetEntityId
    const target = targetId === undefined ? undefined : state.entities[targetId]
    const result = Object.values(state.world?.results ?? {}).find(value => value.requestId === request.id)
    const latestPlan = request.plans.at(-1)
    const execution = latestPlan === undefined ? undefined : state.world?.executions[latestPlan]
    const people = Object.values(state.entities).filter(entity => entity.cognition === 'agent')
    const sameTarget = (candidate: import('@clocky/clocky-simulation').SimulationWorldRequest | undefined): boolean =>
      candidate !== undefined && candidate.pin.domain === request.pin.domain && candidate.pin.operation === request.pin.operation
        && state.world?.intents[candidate.intentId]?.targetEntityId === targetId
    const targetResults = Object.values(state.world?.results ?? {}).filter(value => sameTarget(state.world?.requests[value.requestId]))
    const evidence: import('@clocky/clocky-simulation').SimulationWorldBusinessSummaryEvidence = {
      request: { id: request.id, intentId: request.intentId, pin: request.pin, sequence: request.sequence, status: request.status },
      requestBody: this.caseReadable(runId, request.id, call, 'case')
        ? { status: 'allowed', proposal: request.proposal } : { status: 'withheld' },
      nativeRevision: state.revision,
      executionUnknown: execution?.phase === 'armed' || execution?.phase === 'outcome-unknown',
      ...result === undefined ? {} : { result },
      environment: target === undefined ? { status: 'unknown' }
        : !this.contextReadable(runId, target.id, call, 'context') ? { status: 'withheld' }
          : { status: 'allowed', profile: target.profile, profileRevision: target.profileRevision },
      targetEffects: {
        latestResultSequence: targetResults.length === 0 ? null
          : targetResults.reduce((latest, value) => Math.max(latest, value.sequence), 0),
        unconfirmed: Object.values(state.world?.executions ?? {}).some((observation) => {
          if (observation.phase !== 'armed' && observation.phase !== 'outcome-unknown') return false
          const plan = state.world?.plans[observation.planId]
          return plan !== undefined && sameTarget(state.world?.requests[plan.requestId])
            && !targetResults.some(result => result.source.kind === 'plan' && result.source.planId === observation.planId)
        }),
      },
      technicalCounts: { roles: people.length,
        independentSessions: new Set(people.flatMap(entity => entity.binding === undefined ? [] : [entity.binding.sessionId])).size } }
    try {
      const value = catalog.summarize(request.pin, evidence)
      return value === undefined ? { status: 'unsupported' } : { status: 'allowed', value }
    } catch { return { status: 'unknown' } } // An invalid or unavailable original projection proves no business outcome.
  }

  private async caseSummary(runId: import('./types.ts').SimulationProductRunId, native: SimulationProductWorldCaseSummary,
    call: AuthenticatedProductCall, snapshotRevision: number): Promise<SimulationProductWorldCaseSummary> {
    const reader = this.caseControlReader
    if (reader === undefined) return native
    const cancel = simulationProductWorldCaseCancelCapabilitySchema.parse(
      await reader.read(runId, native.requestId, native.cancel, call, snapshotRevision))
    this.authorize(call); this.readable(runId, call)
    return this.caseControlReader === reader ? { ...native, cancel } : native
  }
  /**
   * Recheck the actual private-case read policy at a cross-owner disclosure boundary.
   * @param runId - Registered run, checked against the current principal.
   * @param requestId - Original case identity; this does not infer its existence or read its body.
   * @param call - Current credential lifetime.
   * @param domain - Independently authorized case or Persona prose.
   * @returns whether a currently installed reader grants this exact disclosure; revocation is immediate.
   */
  caseReadable(runId: import('./types.ts').SimulationProductRunId,
    requestId: import('@clocky/clocky-simulation/world-types').WorldRequestId, call: AuthenticatedProductCall, domain: 'case' | 'persona'): boolean {
    this.authorize(call); this.readable(runId, call)
    const matches = (reader: SimulationProductCaseReader) => reader.principalId === call.principal.id
      && (reader.runId === undefined || reader.runId === runId)
      && (reader.requestIds === undefined || reader.requestIds.includes(requestId))
      && reader.content.includes(domain)
    return !this.closing && (this.options.caseReaders.some(matches)
      || [...this.caseContributions.values()].some(rows => rows.some(matches)))
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
      const start = this.readPosition('cursor' in input ? input.cursor : undefined, call, query, observation)
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
    catch (cause: unknown) {
      this.authorize(call); this.readable(record.id, call)
      throw new SimulationProductReadError(simulationProductReadFailure(cause), simulationProductReadLimit(cause))
    }
    this.authorize(call); this.readable(record.id, call)
    if (observation === undefined) return undefined
    return { ...observation, sourceHash: observation.sourceHash
      ?? createHash('sha256').update(JSON.stringify(observation.snapshot)).digest('hex') }
  }

  /** Inventory errors and successful observations settle under the same current run authority. */
  private async observePersonnel(record: SimulationProductRecord, query: import('@clocky/clocky-simulation').PersonnelObligationQuery,
    call: AuthenticatedProductCall): Promise<import('@clocky/clocky-simulation').SimulationPersonnelObligationObservation | undefined> {
    const selection = { provider: record.provider, spec: record.spec }, team = this.ctx.get('simulationTeams')
    let observation
    try { observation = await (team === undefined ? this.ctx.simulations.inspectPersonnelObligations(selection, query)
      : team.inspectPersonnelObligations(selection, query, call.signal)) }
    catch (error) {
      this.authorize(call); this.readable(record.id, call)
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'SIM_PERSONNEL_STALE') throw stale()
      throw new SimulationProductError('Personnel owner sources are unavailable for inspection', 'SIMULATION_PRODUCT_UNAVAILABLE')
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
    query: { scope: string; revision: number; search: string; limit: number }, observation?: SimulationRunObservation): number {
    if (observation?.sourceHash !== undefined) query.scope = JSON.stringify([query.scope, observation.sourceHash])
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

export { productWorldBackupCreation, productWorldBackupDescriptor, restoreProductWorldBackup } from './backup-import.ts'
export type { ProductWorldBackupTarget } from './backup-import.ts'

export { captureFederationCheckpoint, verifyFederationCheckpoint, federationCheckpointStreams } from './federation-checkpoint.ts'
export type { FederationCheckpoint } from './federation-checkpoint.ts'
