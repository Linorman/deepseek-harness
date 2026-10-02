/** Bounded, cancellable journal export; only a complete revalidated observation reaches the download consumer. */
import type { Context } from '@clocky/cordis'
import type { IApiClient } from '@clocky/clocky-client-connection/client'
import type { SimulationProductRecordsInput, SimulationProductRecordsPage } from '@clocky/clocky-simulation-product/types'
import { createSnapshotStore } from '../contract/store.ts'
import type { SimulationRuntime, SimulationReadError } from './service.ts'

/** Explicit deployment bounds apply to the complete serialized file, not only original text. */
export interface SimulationRecordExportOptions {
  readonly maxBytes: number
  readonly maxPages: number
  readonly pageSize: number
}
/** Progress contains no private body; bytes and records count only validated retained output. */
export interface SimulationRecordExportState {
  readonly runId?: SimulationProductRecordsInput['runId'] | undefined
  readonly pending: boolean
  readonly records: number
  readonly bytes: number
  readonly status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed'
  readonly error?: SimulationReadError | 'exportLimit' | 'exportDenied' | 'downloadFailed' | undefined
}
/** Complete JSON file delivered synchronously while selection and authority remain current. */
export interface SimulationRecordDownload { readonly text: string; readonly name: string }
const idle = (): SimulationRecordExportState => ({ pending: false, records: 0, bytes: 0, status: 'idle' })
type Query = Omit<SimulationProductRecordsInput, 'cursor' | 'limit' | 'expectedRevision'>
interface Job {
  chunks: string[]
  controller: AbortController
  input: Query
  generation: number
  authorizationVersion: number
  readVersion: string
  revision?: number
}
class ExportError extends Error {
  constructor(readonly code: NonNullable<SimulationRecordExportState['error']>) { super(code); this.name = 'SimulationRecordExportError' }
}

/** Per-plugin export lifetime watches the existing runtime authority without retaining body data in React. */
export class SimulationRecordExporter {
  /** Metadata-only export progress bound by the registering framework. */
  readonly state = createSnapshotStore<SimulationRecordExportState>(idle())
  private readonly pending = new Set<Promise<void>>()
  private job: Job | undefined
  private retired = false

  /**
   * @param ctx - Registering view lifetime.
   * @param api - Shared authenticated record carrier.
   * @param source - Current selected run and authority owner.
   * @param options - Positive file/page bounds.
   * @param denied - Clear product content after explicit permission refusal.
   */
  constructor(ctx: Context, private readonly api: IApiClient, private readonly source: SimulationRuntime,
    private readonly options: SimulationRecordExportOptions, private readonly denied: () => void) {
    for (const value of Object.values(options)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid Simulation export allowance')
    ctx.effect(() => source.state.subscribe(() => {
      const job = this.job
      if (job !== undefined && !this.current(job)) this.cancel()
    }), 'Simulation journal export: authority and selection')
    ctx.effect(() => async () => { this.retired = true; this.cancel(); await Promise.allSettled([...this.pending]) },
      'Simulation journal export: read lifetime')
  }

  /** Cancel pending reads and discard private output without triggering a download. */
  cancel(): void {
    const job = this.job
    this.job = undefined
    if (job !== undefined) this.state.set({ ...idle(), runId: job.input.runId, status: 'cancelled' })
    if (job !== undefined) job.chunks.length = 0
    job?.controller.abort()
  }

  /**
   * Export all matching records under a single observed revision and policy.
   * @param input - Original metadata/original selection, never a continuation of the visible page.
   * @param deliver - Synchronous file consumer invoked only after final permission and revision revalidation.
   * @returns settlement with progress/error in state; incomplete or invalidated output is discarded.
   */
  start(input: Query, deliver: (value: SimulationRecordDownload) => void): Promise<void> {
    const operation = this.execute({ ...input }, deliver)
    this.pending.add(operation)
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation))
    return operation
  }

  private async execute(input: Query, deliver: (value: SimulationRecordDownload) => void): Promise<void> {
    if (this.retired || this.job !== undefined) return
    const source = this.source.state.getSnapshot()
    const observed = source.observation.value
    if (!source.connected || observed?.world.status !== 'observed' || observed.runId !== input.runId || source.run.scope !== JSON.stringify(['run', input.runId])) return
    const job: Job = { chunks: [], input: { ...input }, controller: new AbortController(), generation: source.generation,
      authorizationVersion: source.authorizationVersion, readVersion: observed.readVersion }
    this.job = job
    this.state.set({ ...idle(), runId: input.runId, pending: true, status: 'running' })
    const chunks = job.chunks
    let bytes = 0, count = 0, partialSequence: number | undefined, nextPart = 0, partCount = 0, lastSequence = -1
    const append = (value: string) => {
      const size = new TextEncoder().encode(value).byteLength
      if (bytes + size > this.options.maxBytes) throw new ExportError('exportLimit')
      chunks.push(value); bytes += size
    }
    const read = async (query: SimulationProductRecordsInput): Promise<SimulationProductRecordsPage> => {
      if (!this.current(job)) throw new ExportError('stale')
      const response = await this.api.simulations.records(query, job.controller.signal)
      if (!this.current(job)) throw new ExportError('stale')
      if (!response.result.ok) {
        const code = response.result.error.code
        if (code === 'simulation-product-forbidden' || code === 'PRODUCT_AUTH_INVALID' || code === 'PRODUCT_AUTH_REQUIRED') {
          this.denied(); throw new ExportError('forbidden')
        }
        throw new ExportError(code === 'simulation-product-stale' ? 'stale'
          : code === 'simulation-product-unavailable' ? 'unavailable' : 'invalid')
      }
      const page = response.result.value
      if (page.readVersion !== job.readVersion || job.revision !== undefined && page.snapshotRevision !== job.revision) throw new ExportError('stale')
      if (input.mode === 'original' && page.bodyAccess !== 'allowed') throw new ExportError('exportDenied')
      return page
    }
    try {
      let page = await read({ ...input, limit: this.options.pageSize })
      job.revision = page.snapshotRevision
      const total = page.totalRecords
      const header = { format: 'clocky-simulation-records-v1', runId: input.runId, mode: input.mode,
        selection: page.selection, snapshotRevision: job.revision, readVersion: job.readVersion }
      append(JSON.stringify(header).slice(0, -1) + ',"records":[')
      // Reserve the complete suffix before accepting any record bytes.
      bytes += new TextEncoder().encode(']}\n').byteLength
      if (bytes > this.options.maxBytes) throw new ExportError('exportLimit')
      const cursors = new Set<string>()
      for (let pages = 1; ; pages++) {
        if (page.totalRecords !== total || page.items.length === 0 && page.nextCursor !== undefined) throw new ExportError('invalid')
        for (const item of page.items) {
          if (input.mode === 'metadata') {
            if (item.sequence <= lastSequence) throw new ExportError('invalid')
            append((count === 0 ? '' : ',') + JSON.stringify(item))
            lastSequence = item.sequence; count++
          } else {
            const body = item.body
            if (body.status !== 'text') throw new ExportError('exportDenied')
            if (partialSequence === undefined) {
              if (item.sequence <= lastSequence || body.part !== 0) throw new ExportError('invalid')
              partialSequence = item.sequence; nextPart = 0; partCount = body.parts
              append((count === 0 ? '' : ',') + `{"sequence":${item.sequence},"value":`)
            }
            if (item.sequence !== partialSequence || body.part !== nextPart || body.parts !== partCount) throw new ExportError('invalid')
            append(body.text); nextPart++
            if (nextPart === partCount) { append('}'); lastSequence = partialSequence; partialSequence = undefined; count++ }
          }
        }
        this.state.set({ runId: input.runId, pending: true, status: 'running', records: count, bytes })
        if (!this.current(job)) throw new ExportError('stale')
        if (page.nextCursor === undefined) break
        if (pages >= this.options.maxPages) throw new ExportError('exportLimit')
        if (cursors.has(page.nextCursor)) throw new ExportError('invalid')
        cursors.add(page.nextCursor)
        page = await read({ ...input, limit: this.options.pageSize, expectedRevision: job.revision, cursor: page.nextCursor })
      }
      if (partialSequence !== undefined || count !== total) throw new ExportError('invalid')
      const verified = await read({ ...input, expectedRevision: job.revision, limit: 1 })
      if (verified.totalRecords !== total) throw new ExportError('invalid')
      if (!this.current(job)) throw new ExportError('stale')
      chunks.push(']}\n')
      const text = chunks.join('')
      try { JSON.parse(text) } catch { throw new ExportError('invalid') }
      try { deliver({ text, name: `simulation-records-${input.mode}-${job.revision}.json` }) }
      catch { throw new ExportError('downloadFailed') }
      if (this.current(job)) this.state.set({ runId: input.runId, pending: false, status: 'completed', records: count, bytes })
    } catch (cause: unknown) {
      if (this.current(job)) this.state.set({ ...idle(), runId: input.runId, status: 'failed', error: cause instanceof ExportError ? cause.code : 'network' })
    } finally {
      chunks.length = 0
      if (this.job === job) this.job = undefined
    }
  }

  private current(job: Job): boolean {
    const state = this.source.state.getSnapshot()
    const observation = state.observation.value
    return !this.retired && this.job === job && !job.controller.signal.aborted && state.connected
      && state.generation === job.generation && state.authorizationVersion === job.authorizationVersion
      && state.run.scope === JSON.stringify(['run', job.input.runId]) && observation?.runId === job.input.runId
      && observation.readVersion === job.readVersion && observation.world.status === 'observed'
      && (job.revision === undefined || observation.world.revision <= job.revision)
  }
}
