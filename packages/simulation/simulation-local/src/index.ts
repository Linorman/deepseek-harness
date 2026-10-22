import { z as archiveZod } from 'zod'
import { simulationArchivePrefixSchema } from '@clocky/clocky-simulation'
import { LocalObjectNativeWorldDomain } from './world-local-object.ts'
import { buildInspectionIndex, readInspectionIndex, publishInspectionIndex, inspectionPrefixHash } from './inspection-index.ts'
import type { InspectionIndex } from './inspection-index.ts'
import { EvolutionNativeWorldDomain } from './world-environment-domain.ts'
import { RepresentationNativeWorldDomain } from './world-representation-domain.ts'
import { assertCalendarCommands } from './world-calendar-command.ts'
import { HiringMarketNativeWorldDomain } from './world-hiring-market.ts'
import { previewWorldManagement } from './world-management.ts'
import { inspectPersonnelObligations } from './personnel-obligations.ts'
import { ExternalActorNativeWorldDomain, assertExternalRepresentativeProjection } from './world-external-actor.ts'
import { assertWorldBootstrapProjection } from './world-bootstrap.ts'
import { ExternalInteractNativeWorldDomain, assertExternalProjection } from './world-external.ts'
import { ExternalMediatedNativeWorldDomain, assertExternalAdjudicationProjection } from './world-external-mediated.ts'
import { TransferNativeWorldDomain, DepartNativeWorldDomain } from './world-personnel-domain.ts'
import { personnelDomainOwner, assertPersonnelProjection } from './world-personnel.ts'
import { assertWorldExecutionTimeProjection } from './world-execution-time.ts'
import { NativeWorldRuntime } from './world-runtime.ts'
import { ExistingHireNativeWorldDomain } from './world-hire-existing.ts'
import { OrganizationNativeWorldDomain } from './world-organization.ts'
import { assertNormAnnouncementProjection } from './world-norm-announcement.ts'
import { NormEnactNativeWorldDomain, NormRevokeNativeWorldDomain, assertNormProjection } from './world-norms.ts'
export { prepareInitialNorm, foldInitialNorm, assertFrozenCommitteeProposal,
  assertFrozenCommitteeMembership, assertFrozenCommitteeInitialization } from './world-norm-bootstrap.ts'
import { HireApprovalNativeWorldDomain } from './world-hire-approval.ts'
import { assertGovernanceDeadlineProjection } from './world-governance-deadline.ts'
import { GovernanceRouteNativeWorldDomain, GovernanceDelegationNativeWorldDomain, GovernanceProposalNativeWorldDomain, GovernanceVoteNativeWorldDomain, assertWorldGovernanceProjection } from './world-governance.ts'
import { SimulationWorldDomainRegistry } from '@clocky/clocky-simulation'
import type { NativeWorldDomain } from '@clocky/clocky-simulation'
import { assertMaintenanceProjection } from './maintenance.ts'
import { assertExternalAdjudicatedEventProjection } from './world-external-mediated-event.ts'
/** Local run ownership and JSON/SQLite journal composition. @module @clocky/clocky-simulation-local */
import { createHash } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { JsonStorageBackend, readJsonLogSnapshot, readJsonRawLogArchive } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend, readSqliteLogSnapshot, readSqliteLogPages, readSqliteRawLogArchive } from '@clocky/clocky-storage-sqlite'
import { simulationRunSelectionSchema, simulationInspectionSelectionSchema, SimulationRevisionConflictError } from '@clocky/clocky-simulation'
import type { SimulationInspectionSelection, SimulationRunObservation, SimulationRunId } from '@clocky/clocky-simulation'
import { SimulationWorldDomainError } from '@clocky/clocky-simulation'
import { assertLogReadRequest, StorageError } from '@clocky/clocky-storage'
import type { LogReadLimits } from '@clocky/clocky-storage'
import type { SimulationProvider, SimulationRunSelection, SimulationSnapshot } from '@clocky/clocky-simulation'
import type { LogEntry, StorageBackend } from '@clocky/clocky-storage'
import { acquireRunOwner, observeRunOwner } from './owner.ts'
import { foldEntry, foldEntries, SIMULATION_JOURNAL_VERSION } from './journal.ts'
import { LocalSimulationRun } from './run.ts'
import { assertWriterProjection } from './writers.ts'
import { assertBusinessProjection } from './decisions.ts'
import { assertSchedulerProjection } from './scheduler.ts'

/** Cordis plugin identity. */
export const name = 'simulation-local'
/** Registry must exist before this provider registers. */
export const inject = ['simulations']
/** Explicit local storage and replay bounds. */
export interface Config {
  /** Registry identity selected by run requests. */
  readonly name: string
  /** Dedicated local storage root shared by all coordinators for these runs. */
  readonly root: string
  /** Durable journal medium; changing it for an existing run rejects. */
  readonly backend: 'json' | 'sqlite'
  /** Positive maximum journal entries read per recovery page. */
  readonly replayPageSize: number
  /** Maximum retained entries observed without a writer handle. */
  readonly inspectionMaxEntries?: number
  /** Maximum serialized retained journal bytes observed without writer ownership. */
  readonly inspectionMaxBytes?: number
}
/** Deployment choices have no hidden runtime defaults. */
export const Config: z<Config> = z.object({
  name: z.string().required(), root: z.string().required(),
  backend: z.union(['json', 'sqlite'] as const).required(),
  replayPageSize: z.number().min(1).step(1).required(),
  inspectionMaxEntries: z.number().min(1).step(1).default(100000),
  inspectionMaxBytes: z.number().min(1).step(1).default(16777216),
})

declare module '@clocky/cordis' {
  interface Events {
    /**
     * Projection published after the matching journal append or replay.
     * The run may contain several independently bound Sessions.
     * @mode emit
     * @param snapshot - Committed detached projection.
     * @param durableTail - Tail returned by storage.
     * @param previousRevision - Tail before this append; absent for initial replay publication.
     */
    'simulation/committed'(snapshot: SimulationSnapshot, durableTail: number, previousRevision?: number): void
  }
}

/** Provider retaining every admitted open and run until teardown settles. */
export class LocalSimulationProvider implements SimulationProvider {
  validateArchivePrefix(input: import('@clocky/clocky-simulation').SimulationArchivePrefix): SimulationSnapshot {
    if (this.closing) throw new Error('Simulation provider is closed')
    if (Buffer.byteLength(JSON.stringify(input)) > this.inspectionLimits.maxBytes
      || input.entries.length > this.inspectionLimits.maxEntries) throw new Error('Portable prefix exceeds provider scan bounds')
    const original = simulationArchivePrefixSchema.parse(input)
    if (original.version !== SIMULATION_JOURNAL_VERSION) throw new Error('Portable prefix journal version is unsupported')
    const first = original.entries[0]
    if (first === undefined) throw new Error('Portable prefix has no creation record')
    const backend = archiveZod.object({ backend: archiveZod.enum(['json', 'sqlite']) }).parse(first.value).backend
    const runtime = this.worldDomains === undefined ? undefined : new NativeWorldRuntime(this.worldDomains)
    try {
      let state = foldEntry(undefined, first, original.spec, backend, runtime)
      state = foldEntries(state, original.entries.slice(1), original.spec, backend, runtime)
      runtime?.assertMigrationComplete()
      this.assertProjection(state, runtime)
      return structuredClone(state)
    } finally { runtime?.close() }
  }

  private assertProjection(state: SimulationSnapshot, runtime: NativeWorldRuntime | undefined): void {
    assertMaintenanceProjection(state); assertWorldBootstrapProjection(state); assertWriterProjection(state)
    assertBusinessProjection(state, runtime); assertSchedulerProjection(state, runtime); assertWorldGovernanceProjection(state)
    assertCalendarCommands(state)
    assertGovernanceDeadlineProjection(state)
    assertNormAnnouncementProjection(state)
    assertNormProjection(state)
    assertExternalProjection(state)
    assertExternalAdjudicationProjection(state)
    assertExternalRepresentativeProjection(state)
    assertPersonnelProjection(state)
    assertWorldExecutionTimeProjection(state)
    assertExternalAdjudicatedEventProjection(state)
  }

  readonly name: string
  private readonly openings = new Set<Promise<LocalSimulationRun>>()
  private readonly runs = new Map<SimulationRunId, LocalSimulationRun>()
  private readonly observations = new Set<Promise<unknown>>()
  private readonly inspectionLimits: LogReadLimits
  private readonly cleanups = new Set<() => Promise<void>>()
  private inspectionCache: { index: InspectionIndex } | undefined
  private closing = false
  private disposal: Promise<void> | undefined

  constructor(private readonly config: Config,
    private readonly committed: (snapshot: SimulationSnapshot, tail: number, previousRevision?: number) => void,
    readonly worldDomains?: SimulationWorldDomainRegistry<NativeWorldDomain>) {
    this.name = config.name
    this.inspectionLimits = { maxEntries: config.inspectionMaxEntries ?? 100000, maxBytes: config.inspectionMaxBytes ?? 16777216 }
    assertLogReadRequest({ name: 'simulation', version: SIMULATION_JOURNAL_VERSION }, this.inspectionLimits)
  }

  open(selection: SimulationRunSelection): Promise<LocalSimulationRun> {
    if (this.closing) return Promise.reject(new Error('Simulation provider is closed'))
    const selected = simulationRunSelectionSchema.parse(selection)
    if (selected.provider !== this.name) return Promise.reject(new Error('Simulation provider selection mismatch'))
    const opening = this.openOwned(selected)
    this.openings.add(opening)
    void opening.then(() => this.openings.delete(opening), () => this.openings.delete(opening))
    return opening
  }

  /**
   * Preserve the original stream header and logical record bytes without loading a Native runtime.
   * @param selection - Exact configured source namespace; includeRecords does not change raw preservation.
   * @returns bounded raw-only storage archive or absence; provider inspection limits still apply.
   */
  rawArchive(selection: SimulationInspectionSelection):
  Promise<import('@clocky/clocky-simulation').SimulationRawArchiveObservation | undefined> {
    if (this.closing) return Promise.reject(new StorageError('closed', 'Simulation raw preservation owner is closed'))
    const selected = simulationInspectionSelectionSchema.parse(selection)
    if (selected.provider !== this.name) return Promise.reject(new Error('Simulation raw preservation provider mismatch'))
    const observation = this.rawArchiveExisting(selected)
    this.observations.add(observation)
    void observation.then(() => this.observations.delete(observation), () => this.observations.delete(observation))
    return observation
  }

  private async rawArchiveExisting(selected: SimulationInspectionSelection):
  Promise<import('@clocky/clocky-simulation').SimulationRawArchiveObservation | undefined> {
    const directory = join(this.config.root, createHash('sha256').update(selected.spec.runId).digest('hex'))
    const archive = this.config.backend === 'json'
      ? await readJsonRawLogArchive(join(directory, 'journal'), 'simulation', this.inspectionLimits)
      : await readSqliteRawLogArchive(join(directory, 'journal.sqlite'), 'simulation', this.inspectionLimits)
    if (archive === undefined) return undefined
    return { journalVersion: archive.version, firstSequence: archive.firstSequence, tailSequence: archive.tailSequence,
      entryCount: archive.entryCount, representation: archive.representation, sourceHash: archive.sourceHash,
      nativeValidation: 'not-performed', physicalDatabaseCopy: false, text: archive.text }
  }

  /**
   * Observe a complete bounded existing journal without opening or restoring its run.
   * @param selection - Expected immutable spec and selected provider.
   * @returns detached state and owner observation, or undefined for absent history.
   */
  inspect(selection: SimulationInspectionSelection): Promise<SimulationRunObservation | undefined> {
    if (this.closing) return Promise.reject(new Error('Simulation provider is closed'))
    const selected = simulationInspectionSelectionSchema.parse(selection)
    if (selected.provider !== this.name) return Promise.reject(new Error('Simulation provider inspection mismatch'))
    const observation = this.inspectExisting(selected)
    this.observations.add(observation)
    void observation.then(() => this.observations.delete(observation), () => this.observations.delete(observation))
    return observation
  }

  /**
   * Replay an existing bounded journal and inspect actual installed personnel capabilities without writer ownership.
   * @param selection - Exact existing provider/spec, with no creation or restoration mode.
   * @param query - Strict original person/assignment revisions and complete output bounds.
   * @returns detached Native prefix and actual metadata report; absent history stays absent.
   */
  inspectPersonnelObligations(selection: SimulationInspectionSelection, query: import('@clocky/clocky-simulation').PersonnelObligationQuery):
  Promise<import('@clocky/clocky-simulation').SimulationPersonnelObligationObservation | undefined> {
    if (this.closing) return Promise.reject(new Error('Simulation provider is closed'))
    const selected = simulationInspectionSelectionSchema.parse(selection)
    if (selected.provider !== this.name) return Promise.reject(new Error('Simulation provider inspection mismatch'))
    const work = (async () => {
      const observation = await this.inspectExisting(selected)
      if (this.closing) throw new Error('Simulation provider is closed')
      if (observation === undefined) return undefined
      const runtime = this.worldDomains === undefined ? undefined : new NativeWorldRuntime(this.worldDomains)
      try { return { snapshot: observation.snapshot,
        report: inspectPersonnelObligations(observation.snapshot, query, runtime) } }
      finally { runtime?.close() }
    })()
    this.observations.add(work)
    void work.then(() => this.observations.delete(work), () => this.observations.delete(work))
    return work
  }

  previewWorldManagement(selection: SimulationInspectionSelection,
    request: import('@clocky/clocky-simulation').SimulationWorldManagementPreviewRequest,
    authority: import('@clocky/clocky-simulation').SimulationWorldManagementAuthority):
  Promise<import('@clocky/clocky-simulation').SimulationWorldManagementPreview | undefined> {
    if (this.closing) return Promise.reject(new Error('Simulation provider is closed'))
    const selected = simulationInspectionSelectionSchema.parse(selection)
    if (selected.provider !== this.name) return Promise.reject(new Error('Simulation provider inspection mismatch'))
    const work = (async () => {
      const observation = await this.inspectExisting(selected)
      if (this.closing) throw new Error('Simulation provider is closed')
      if (observation === undefined) return undefined
      const runtime = this.worldDomains === undefined ? undefined : new NativeWorldRuntime(this.worldDomains)
      try { return previewWorldManagement(observation.snapshot, request, authority, runtime) }
      finally { runtime?.close() }
    })()
    this.observations.add(work)
    void work.then(() => this.observations.delete(work), () => this.observations.delete(work))
    return work
  }

  /**
   * Explicitly rebuild derived references from validated authority without taking a world writer.
   * @param selection - Exact existing run and backend selection.
   * @param expectedRevision - Optional exact source revision; movement refuses publication.
   * @param authorize - Synchronous trusted authorization fence checked after source reads and before publication.
   * @returns published prefix manifest; missing or invalid history rejects and leaves the old index.
   */
  rebuildInspectionIndex(selection: SimulationInspectionSelection, expectedRevision?: number,
    authorize: () => void = () => {}): Promise<InspectionIndex> {
    if (this.closing) return Promise.reject(new Error('Simulation provider is closed'))
    const work = (async () => {
      const observation = await this.inspect({ ...selection, includeRecords: true })
      if (observation?.records === undefined) throw new Error('Index rebuild requires existing complete history')
      if (this.closing) throw new Error('Simulation provider is closed')
      if (expectedRevision !== undefined && observation.snapshot.revision !== expectedRevision)
        throw new SimulationRevisionConflictError(expectedRevision, observation.snapshot.revision)
      authorize()
      const index = buildInspectionIndex(observation.records, SIMULATION_JOURNAL_VERSION)
      const directory = join(this.config.root, createHash('sha256').update(selection.spec.runId).digest('hex'))
      await publishInspectionIndex(directory, index, () => {
        if (this.closing) throw new Error('Simulation provider is closed')
        authorize()
      })
      return index
    })()
    this.observations.add(work)
    void work.then(() => this.observations.delete(work), () => this.observations.delete(work))
    return work
  }

  /**
   * Publish an exact source-bound index through the Native registry contract.
   * @param selection - Existing run selection.
   * @param expectedRevision - Original requested source revision.
   * @param authorize - Live trusted authorization check before publication admission.
   * @returns metadata only, without protected source references.
   */
  async rebuildIndex(selection: SimulationInspectionSelection, expectedRevision: number, authorize: () => void):
  Promise<import('@clocky/clocky-simulation').SimulationIndexManifest> {
    const { rows: _rows, ...manifest } = await this.rebuildInspectionIndex(selection, expectedRevision, authorize)
    return manifest
  }

  private async inspectExisting(selection: SimulationInspectionSelection): Promise<SimulationRunObservation | undefined> {
    const directory = join(this.config.root, createHash('sha256').update(selection.spec.runId).digest('hex'))
    const other = await stat(join(directory, this.config.backend === 'json' ? 'journal.sqlite' : 'journal')).catch((cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw cause
    })
    if (other !== undefined) throw new Error('Simulation run storage backend does not match')
    const descriptor = { name: 'simulation', version: SIMULATION_JOURNAL_VERSION }
    if (this.config.backend === 'sqlite' && selection.includeRecords !== true) return await this.inspectPaged(selection, directory, descriptor)
    const log = this.config.backend === 'json'
      ? await readJsonLogSnapshot(join(directory, 'journal'), descriptor, this.inspectionLimits)
      : await readSqliteLogSnapshot(join(directory, 'journal.sqlite'), descriptor, this.inspectionLimits)
    // Explicit arms keep V8 from deriving a negative implicit fallthrough count across awaited snapshot readers.
    if (log === undefined) {
      return undefined
    } else {
      const first = log.entries[0]
      if (log.firstSequence !== 0 || first === undefined) throw new StorageError('compacted', 'Simulation inspection has no complete retained history')
      const cached = this.inspectionCache
      const sourceHash = inspectionPrefixHash(log.entries)
      const source = cached?.index.sourceHash === sourceHash ? cached.index
        : buildInspectionIndex(log.entries, SIMULATION_JOURNAL_VERSION)
      const index = cached?.index === source ? source : await readInspectionIndex(directory, source) ?? source
      const runtime = this.worldDomains === undefined ? undefined : new NativeWorldRuntime(this.worldDomains)
      let state: SimulationSnapshot
      try {
        const initial = foldEntry(undefined, first, selection.spec, this.config.backend, runtime)
        // Source decoding is already complete; retain references rather than a duplicate full business projection.
        state = foldEntries(initial, log.entries.slice(1), selection.spec, this.config.backend, runtime)
        runtime?.assertMigrationComplete()
        this.assertProjection(state, runtime)
      } catch (cause: unknown) {
        if (cause instanceof SimulationWorldDomainError || cause instanceof StorageError) throw cause
        throw new StorageError('malformed-medium', 'Simulation history cannot be replayed at its retained revision', { cause })
      } finally { runtime?.close() }
      // Publish only after every projection invariant passed; failed suffixes retain the old prefix.
      this.inspectionCache = { index }
      const owner = this.runs.has(selection.spec.runId) ? 'this-provider' : await observeRunOwner(join(directory, 'owner.sqlite'))
      return { snapshot: state, owner, sourceHash, ...selection.includeRecords === true ? { records: log.entries } : {} }
    }
  }

  /** SQLite details replay a consistent prefix with bounded entry pages, without constructing a second full journal/index array. */
  private async inspectPaged(selection: SimulationInspectionSelection, directory: string,
    descriptor: { name: string; version: number }): Promise<SimulationRunObservation | undefined> {
    const runtime = this.worldDomains === undefined ? undefined : new NativeWorldRuntime(this.worldDomains)
    let state: SimulationSnapshot | undefined
    const sourceHash = createHash('sha256')
    try {
      for await (const page of readSqliteLogPages(join(directory, 'journal.sqlite'), descriptor, {
        ...this.inspectionLimits, pageEntries: this.config.replayPageSize, pageBytes: this.inspectionLimits.maxBytes,
      })) {
        if (page.firstSequence !== 0 || page.entries.length === 0) throw new StorageError('compacted', 'Simulation inspection requires its full creation prefix')
        for (const entry of page.entries) {
          const encoded = JSON.stringify(entry)
          sourceHash.update(`${Buffer.byteLength(encoded)}:`).update(encoded)
          state = foldEntry(state, entry, selection.spec, 'sqlite', runtime)
        }
      }
      if (state === undefined) return undefined
      runtime?.assertMigrationComplete()
      this.assertProjection(state, runtime)
      const owner = this.runs.has(selection.spec.runId) ? 'this-provider' : await observeRunOwner(join(directory, 'owner.sqlite'))
      return { snapshot: state, owner, sourceHash: sourceHash.digest('hex') }
    } catch (cause: unknown) {
      if (cause instanceof SimulationWorldDomainError || cause instanceof StorageError) throw cause
      throw new StorageError('malformed-medium', 'Simulation history cannot be replayed at its retained revision', { cause })
    } finally { runtime?.close() }
  }

  private async openOwned(selection: SimulationRunSelection): Promise<LocalSimulationRun> {
    const directory = join(this.config.root, createHash('sha256').update(selection.spec.runId).digest('hex'))
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const canonical = await realpath(directory)
    const unlock = acquireRunOwner(join(canonical, 'owner.sqlite'))
    const runtime = this.worldDomains === undefined ? undefined : new NativeWorldRuntime(this.worldDomains)
    let medium: StorageBackend | undefined
    let run: LocalSimulationRun | undefined
    const cleanup = async (): Promise<void> => {
      await medium?.close()
      if (run !== undefined && this.runs.get(selection.spec.runId) === run) this.runs.delete(selection.spec.runId)
      unlock()
      runtime?.close()
      this.cleanups.delete(cleanup)
    }
    this.cleanups.add(cleanup)
    try {
      const other = this.config.backend === 'json' ? 'journal.sqlite' : 'journal'
      const existing = await stat(join(canonical, other)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      })
      if (existing !== undefined) throw new Error('Simulation run storage backend does not match')
      const backend = this.config.backend === 'json'
        ? new JsonStorageBackend(join(canonical, 'journal'))
        : new SqliteStorageBackend({ path: join(canonical, 'journal.sqlite'), journalMode: 'wal' })
      medium = backend
      const log = backend.log
      const stream = await log.open({ name: 'simulation', version: SIMULATION_JOURNAL_VERSION })
      if (stream.firstSequence !== 0) throw new Error('Simulation journal prefix has been removed')
      let state: SimulationSnapshot
      if (stream.tailSequence === -1) {
        if (selection.mode !== 'create') throw new Error('Simulation run does not exist')
        const value = { kind: 'run/created', spec: selection.spec, backend: this.config.backend }
        state = foldEntry(undefined, { sequence: 0, value }, selection.spec, this.config.backend, runtime)
        await stream.append(-1, [value])
      } else {
        if (selection.mode === 'create') throw new Error('Simulation run already exists')
        // A nonempty, uncompacted LogStream retains sequence zero.
        const first = (await stream.read(-1, 1))[0] as LogEntry
        state = foldEntry(undefined, first, selection.spec, this.config.backend, runtime)
        let after = first.sequence
        while (after < stream.tailSequence) {
          const entries = await stream.read(after, this.config.replayPageSize)
          if (entries.length === 0) throw new Error('Simulation journal suffix is incomplete')
          state = foldEntries(state, entries, selection.spec, this.config.backend, runtime)
          after = state.revision
        }
      }
      runtime?.assertMigrationComplete()
      run = new LocalSimulationRun(stream, state, this.config.backend, cleanup, this.committed, runtime)
      this.runs.set(selection.spec.runId, run)
      this.cleanups.delete(cleanup)
      this.committed(run.snapshot(), stream.tailSequence)
      return run
    } catch (error) {
      // Failed cleanup retains the kernel lock; releasing it would allow an overlapping writer.
      await cleanup()
      throw error
    }
  }

  /**
   * Stop admission and drain every accepted open/run.
   * @returns successful release of all owners.
   */
  close(): Promise<void> {
    this.closing = true
    this.disposal ??= this.closeOwned().catch((error: unknown) => {
      this.disposal = undefined
      throw error
    })
    return this.disposal
  }

  private async closeOwned(): Promise<void> {
    await Promise.allSettled([...this.openings, ...this.observations])
    const results = await Promise.allSettled([...this.runs.values()].map(run => run.close()))
    results.push(...await Promise.allSettled([...this.cleanups].map(cleanup => cleanup())))
    const errors = results.filter(result => result.status === 'rejected').map((result): unknown => result.reason)
    if (errors.length > 0) throw new AggregateError(errors, 'Simulation provider cleanup failed')
    this.inspectionCache = undefined
  }
}

/**
 * Mount the local provider.
 * @param ctx - Registry context.
 * @param config - Validated local deployment.
 */
export function apply(ctx: Context, config: Config): void {
  const domains = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  const modules = [new LocalObjectNativeWorldDomain(), new RepresentationNativeWorldDomain(), new EvolutionNativeWorldDomain('supply'), new EvolutionNativeWorldDomain('experience'), new HiringMarketNativeWorldDomain(), new ExternalActorNativeWorldDomain(), new ExternalInteractNativeWorldDomain(),
    new ExternalMediatedNativeWorldDomain(),
    new OrganizationNativeWorldDomain(), new ExistingHireNativeWorldDomain(),
    new GovernanceRouteNativeWorldDomain(), new GovernanceDelegationNativeWorldDomain(),
    new GovernanceProposalNativeWorldDomain(), new GovernanceVoteNativeWorldDomain(),
    new TransferNativeWorldDomain(personnelDomainOwner), new DepartNativeWorldDomain(personnelDomainOwner),
    new HireApprovalNativeWorldDomain(), new NormEnactNativeWorldDomain(), new NormRevokeNativeWorldDomain()]
  const provider = new LocalSimulationProvider(config, (snapshot, tail, previousRevision) => {
    for (const callback of ctx.events.dispatch('emit', [ctx, 'simulation/committed', snapshot, tail, previousRevision])) {
      try {
        const notify = callback as (value: SimulationSnapshot, durableTail: number, previousRevision?: number) => unknown
        const result = notify(snapshot, tail, previousRevision)
        void Promise.resolve(result).catch((error: unknown) => { ctx.logger.warn(error) })
      } catch (error) { ctx.logger.warn(error) }
    }
  }, domains)
  ctx.effect(() => {
    const retireDomains = modules.map(module => domains.register(module.definition, module))
    const unregister = ctx.simulations.registerProvider(provider)
    return async () => {
      // Closing admission is synchronous; failed owner cleanup retains original leases and reports its error.
      // A separate disposer awaiting those retained leases would prevent Fiber unload from reporting that failure.
      const drains = retireDomains.map(retire => retire())
      unregister()
      await provider.close()
      await Promise.all(drains)
    }
  })
}
