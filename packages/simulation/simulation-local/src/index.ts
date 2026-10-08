/** Local run ownership and JSON/SQLite journal composition. @module @clocky/clocky-simulation-local */
import { createHash } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { JsonStorageBackend, readJsonLogSnapshot } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend, readSqliteLogSnapshot } from '@clocky/clocky-storage-sqlite'
import { simulationRunSelectionSchema, simulationInspectionSelectionSchema } from '@clocky/clocky-simulation'
import type { SimulationInspectionSelection, SimulationRunObservation, SimulationRunId } from '@clocky/clocky-simulation'
import { assertLogReadRequest } from '@clocky/clocky-storage'
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
  readonly name: string
  private readonly openings = new Set<Promise<LocalSimulationRun>>()
  private readonly runs = new Map<SimulationRunId, LocalSimulationRun>()
  private readonly observations = new Set<Promise<SimulationRunObservation | undefined>>()
  private readonly inspectionLimits: LogReadLimits
  private readonly cleanups = new Set<() => Promise<void>>()
  private closing = false
  private disposal: Promise<void> | undefined

  constructor(private readonly config: Config,
    private readonly committed: (snapshot: SimulationSnapshot, tail: number, previousRevision?: number) => void) {
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

  private async inspectExisting(selection: SimulationInspectionSelection): Promise<SimulationRunObservation | undefined> {
    const directory = join(this.config.root, createHash('sha256').update(selection.spec.runId).digest('hex'))
    const other = await stat(join(directory, this.config.backend === 'json' ? 'journal.sqlite' : 'journal')).catch((cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw cause
    })
    if (other !== undefined) throw new Error('Simulation run storage backend does not match')
    const descriptor = { name: 'simulation', version: SIMULATION_JOURNAL_VERSION }
    const log = this.config.backend === 'json'
      ? await readJsonLogSnapshot(join(directory, 'journal'), descriptor, this.inspectionLimits)
      : await readSqliteLogSnapshot(join(directory, 'journal.sqlite'), descriptor, this.inspectionLimits)
    // Explicit arms keep V8 from deriving a negative implicit fallthrough count across awaited snapshot readers.
    if (log === undefined) {
      return undefined
    } else {
      const first = log.entries[0]
      if (log.firstSequence !== 0 || first === undefined) throw new Error('Simulation inspection has no complete retained history')
      const initial = foldEntry(undefined, first, selection.spec, this.config.backend)
      const state = foldEntries(initial, log.entries.slice(1), selection.spec, this.config.backend)
      assertWriterProjection(state); assertBusinessProjection(state); assertSchedulerProjection(state)
      const owner = this.runs.has(selection.spec.runId) ? 'this-provider' : await observeRunOwner(join(directory, 'owner.sqlite'))
      return { snapshot: state, owner, ...selection.includeRecords === true ? { records: log.entries } : {} }
    }
  }

  private async openOwned(selection: SimulationRunSelection): Promise<LocalSimulationRun> {
    const directory = join(this.config.root, createHash('sha256').update(selection.spec.runId).digest('hex'))
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const canonical = await realpath(directory)
    const unlock = acquireRunOwner(join(canonical, 'owner.sqlite'))
    let medium: StorageBackend | undefined
    let run: LocalSimulationRun | undefined
    const cleanup = async (): Promise<void> => {
      await medium?.close()
      if (run !== undefined && this.runs.get(selection.spec.runId) === run) this.runs.delete(selection.spec.runId)
      unlock()
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
        state = foldEntry(undefined, { sequence: 0, value }, selection.spec, this.config.backend)
        await stream.append(-1, [value])
      } else {
        if (selection.mode === 'create') throw new Error('Simulation run already exists')
        // A nonempty, uncompacted LogStream retains sequence zero.
        const first = (await stream.read(-1, 1))[0] as LogEntry
        state = foldEntry(undefined, first, selection.spec, this.config.backend)
        let after = first.sequence
        while (after < stream.tailSequence) {
          const entries = await stream.read(after, this.config.replayPageSize)
          if (entries.length === 0) throw new Error('Simulation journal suffix is incomplete')
          state = foldEntries(state, entries, selection.spec, this.config.backend)
          after = state.revision
        }
      }
      run = new LocalSimulationRun(stream, state, this.config.backend, cleanup, this.committed)
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
  }
}

/**
 * Mount the local provider.
 * @param ctx - Registry context.
 * @param config - Validated local deployment.
 */
export function apply(ctx: Context, config: Config): void {
  const provider = new LocalSimulationProvider(config, (snapshot, tail, previousRevision) => {
    for (const callback of ctx.events.dispatch('emit', [ctx, 'simulation/committed', snapshot, tail, previousRevision])) {
      try {
        const notify = callback as (value: SimulationSnapshot, durableTail: number, previousRevision?: number) => unknown
        const result = notify(snapshot, tail, previousRevision)
        void Promise.resolve(result).catch((error: unknown) => { ctx.logger.warn(error) })
      } catch (error) { ctx.logger.warn(error) }
    }
  })
  ctx.effect(() => {
    const unregister = ctx.simulations.registerProvider(provider)
    return async () => { unregister(); await provider.close() }
  })
}
