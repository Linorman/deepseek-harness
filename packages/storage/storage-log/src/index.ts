/**
 * Routed append-only-log data form. Consumers open a declared stream through
 * `ctx.storage.log`; backend selection stays explicit in this consumer-facing
 * configuration instead of becoming a global storage-hub default.
 * @module @clocky/clocky-storage-log
 */

import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { storageBackendServiceKey } from '@clocky/clocky-storage'
import type {
  LogAppendOptions, LogAppendResult, LogCheckpoint, LogCompactionRequest, LogEntry, LogStream,
  LogStreamDescriptor, LogStreamInfo, LogSummary,
} from '@clocky/clocky-storage'
import { StorageLogError } from './error.ts'
import { NameScanner } from './name-scan.ts'
import type { LogNameScanRequest, LogNameScanPage, NameScanConfig } from './name-scan.ts'
export type { LogNameScanCursor, LogNameScanRequest, LogNameScanPage } from './name-scan.ts'

export { StorageLogError } from './error.ts'
export type { StorageLogErrorCode } from './error.ts'
export { defineLogStream } from './spec.ts'
export type {
  LogAppendOptions, LogAppendResult, LogCheckpoint, LogCompactionRequest, LogEntry, LogStream,
  LogStreamDescriptor, LogStreamInfo, LogSummary,
} from '@clocky/clocky-storage'

declare module '@clocky/clocky-storage' {
  interface StorageForms {
    log: StorageLogFacility
  }
}

declare module '@clocky/cordis' {
  interface Context {
    storageLog: StorageLogFacility
  }
}

/** Cordis plugin name. */
export const name = 'storage-log'
/** The storage hub must exist before the form mounts. */
export const inject = ['storage']

/** Route configuration for append-only streams. */
export interface Config extends NameScanConfig {
  /** Default backend name for streams without a more specific route. */
  readonly backend: string
  /** Per-stream backend route. */
  readonly routes: Record<string, string>
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  maxOpenScans: z.number().step(1).min(1).default(32),
  maxScanEntries: z.number().step(1).min(1).default(128),
  scanIdleMs: z.number().step(1).min(1).default(30000),
  maxScanNameBytes: z.number().step(1).min(1).default(4096),
  backend: z.string().required(),
  routes: z.dict(z.string()).default({}),
})

/**
 * The mounted facility. A caller owns each returned stream and closes it when
 * its projection/runtime stops. Unmount closes admission, drains accepted
 * backend calls, settles every returned handle, then releases the form.
 */
export class StorageLogFacility {
  private readonly config: Pick<Config, 'backend' | 'routes'>
  private readonly nameScanner: NameScanner
  private readonly backendNames: readonly string[]
  private readonly streams = new Map<string, RoutedLogStream>()
  /** A name remains reserved while an open is in flight, preventing racey double-open. */
  private readonly reserved = new Set<string>()
  /** Every accepted backend operation that must settle before form unmount completes. */
  private readonly pending = new Set<Promise<unknown>>()
  /** Admission closes synchronously when disposal begins. */
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * @param ctx - Plugin context that resolves backend routes.
   * @param config - Validated per-stream route table.
   */
  constructor(
    private readonly ctx: Context,
    config: Config,
  ) {
    this.config = { backend: config.backend, routes: Object.fromEntries(Object.entries(config.routes)) }
    this.backendNames = [...new Set([config.backend, ...Object.values(config.routes)])]
    this.nameScanner = new NameScanner(config, (prefix, maxBytes) => this.scanRoutedNames(prefix, maxBytes))
  }

  /**
   * Open a caller-owned log stream over its configured backend. The facility
   * preserves one open handle per stream name, so a Consumer has exactly one
   * local serialization owner for its expected-tail mutations.
   * @param descriptor - Stream declaration owned by the caller package.
   * @returns a routed handle that releases the name only after backend close.
   */
  async open(descriptor: LogStreamDescriptor): Promise<LogStream> {
    if (this.closing) {
      throw new StorageLogError('closed', `log facility is closed; cannot open '${descriptor.name}'`)
    }
    if (this.reserved.has(descriptor.name)) {
      throw new StorageLogError('already-open', `log stream '${descriptor.name}' is already open`)
    }
    this.reserved.add(descriptor.name)
    const opening = this.track(this.openRouted(descriptor))
    try {
      return await opening
    } catch (error) {
      this.reserved.delete(descriptor.name)
      throw error
    }
  }

  /** Track an accepted backend operation until it settles during disposal. */
  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation)
    void operation.then(
      () => { this.pending.delete(operation) },
      () => { this.pending.delete(operation) },
    )
    return operation
  }

  /** Resolve the configured backend for one stream name. */
  private backendNameFor(name: string): string {
    let backendName = this.config.backend
    if (Object.hasOwn(this.config.routes, name)) {
      const route = this.config.routes[name]
      /* v8 ignore next -- Config validates every own route value as a string. */
      if (route === undefined) throw new Error(`log stream '${name}' has an undefined backend route`)
      backendName = route
    }
    return backendName
  }

  /** Resolve one backend and bind a returned handle only while admission remains open. */
  private async openRouted(descriptor: LogStreamDescriptor): Promise<LogStream> {
    const backendName = this.backendNameFor(descriptor.name)
    const backend = this.ctx.storage.backend.get(backendName)
    if (backend.log === undefined) {
      throw new StorageLogError(
        'facet-unsupported',
        `backend '${backendName}' routed for log stream '${descriptor.name}' has no log facet`,
      )
    }
    const inner = await backend.log.open(descriptor)
    if (this.closing) {
      await inner.close()
      throw new StorageLogError('closed', `log facility closed while opening '${descriptor.name}'`)
    }
    const stream = new RoutedLogStream(inner, () => {
      this.streams.delete(descriptor.name)
      this.reserved.delete(descriptor.name)
    }, backend.log.readSummary !== undefined)
    this.streams.set(descriptor.name, stream)
    return stream
  }

  /**
   * Enumerate materialized streams through their configured backends. An entry
   * stored on a backend that no longer owns its name under this route table is
   * excluded, so recovery cannot accidentally reopen it through the wrong
   * provider.
   * @returns durable stream metadata in stable stream-name order.
   */
  async list(): Promise<readonly LogStreamInfo[]> {
    if (this.closing) {
      throw new StorageLogError('closed', 'log facility is closed; cannot list streams')
    }
    return await this.track(this.listRouted())
  }

  /** Scan bounded physical entries instead of reading complete journal metadata or values.
   * @param request - Prefix, optional local cursor, and requested scan work.
   * @returns names and a continuation; empty pages still advance. Expired cursors require a fresh scan.
   */
  async scanNames(request: LogNameScanRequest): Promise<LogNameScanPage> {
    if (this.closing) throw new StorageLogError('closed', 'log facility is closed; cannot scan names')
    return await this.track(this.nameScanner.scan(request))
  }

  /** Distinguish a concurrently deleted stream from a materialized malformed journal.
   * @param name - Exact routed stream name.
   * @returns whether its configured backend retains durable metadata.
   */
  async hasStream(name: string): Promise<boolean> {
    if (this.closing) throw new StorageLogError('closed', 'log facility is closed; cannot inspect stream materialization')
    const backend = this.ctx.storage.backend.get(this.backendNameFor(name))
    if (backend.log?.has === undefined) throw new StorageLogError('facet-unsupported', 'backend cannot inspect stream materialization')
    return await this.track(backend.log.has(name))
  }

  /** Read bounded tail metadata through the stream's configured backend.
   * @param descriptor - Exact journal identity and durable version.
   * @param maxBytes - Positive metadata byte budget, including its wrapper.
   * @returns a detached tail summary, or undefined if absent.
   */
  async readSummary(descriptor: LogStreamDescriptor, maxBytes: number): Promise<LogSummary | undefined> {
    if (this.closing) throw new StorageLogError('closed', 'log facility is closed')
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new StorageLogError('scan-invalid', 'maxBytes must be a positive safe integer')
    const backend = this.ctx.storage.backend.get(this.backendNameFor(descriptor.name))
    if (backend.log?.readSummary === undefined) throw new StorageLogError('facet-unsupported', 'backend cannot read bounded log summaries')
    return await this.track(backend.log.readSummary(descriptor, maxBytes))
  }

  private async * scanRoutedNames(prefix: string, maxBytes: number): AsyncIterable<string | undefined> {
    for (const backendName of this.backendNames) {
      const backend = this.ctx.storage.backend.get(backendName)
      if (backend.log?.scanNames === undefined) throw new StorageLogError('facet-unsupported',
        `backend '${backendName}' does not support bounded stream-name discovery`)
      for await (const name of backend.log.scanNames(prefix, maxBytes)) {
        yield name !== undefined && this.backendNameFor(name) === backendName ? name : undefined
      }
      // Finishing an empty backend still consumes one scan unit before another backend is consulted.
      yield undefined
    }
  }

  /** Query every configured log backend and retain the streams it currently owns. */
  private async listRouted(): Promise<readonly LogStreamInfo[]> {
    const listings = await Promise.all(this.backendNames.map(async (backendName) => {
      const backend = this.ctx.storage.backend.get(backendName)
      if (backend.log === undefined) {
        throw new StorageLogError(
          'facet-unsupported',
          `backend '${backendName}' routed for log listing has no log facet`,
        )
      }
      const streams = await backend.log.list()
      return streams.filter(stream => this.backendNameFor(stream.name) === backendName)
    }))
    return listings.flat().sort(compareStreamNames)
  }

  /**
   * Read an open handle for diagnostics. Consumers hold the typed result of
   * `open`; this method does not infer a descriptor's value type.
   * @param name - Stream name.
   * @returns its live routed handle, or `undefined`.
   */
  get(name: string): LogStream | undefined {
    return this.streams.get(name)
  }

  /**
   * Close admission, settle accepted backend calls, then close every resolved caller
   * handle. All owned work settles before an aggregate failure is reported.
   * @returns resolution after every accepted call and returned handle settles.
   */
  closeAll(): Promise<void> {
    this.disposal ??= this.disposeAll()
    return this.disposal
  }

  /** Run the one facility-owned shutdown sequence. */
  private async disposeAll(): Promise<void> {
    this.closing = true
    const failures: unknown[] = []
    while (this.pending.size > 0) {
      const settled = await Promise.allSettled([...this.pending])
      for (const result of settled) {
        if (result.status === 'rejected' && !isClosedAdmission(result.reason)) failures.push(result.reason)
      }
    }
    try { await this.nameScanner.close() }
    catch (error: unknown) { failures.push(error) }
    const closed = await Promise.allSettled([...this.streams.values()].map(stream => stream.close()))
    for (const result of closed) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'storage log facility disposal failed')
  }
}

/** Compare stream metadata without locale-dependent ordering. */
function compareStreamNames(left: LogStreamInfo, right: LogStreamInfo): number {
  // v8 ignore next -- each backend listing has unique stream names by the LogFacet contract.
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

/** A pending open rejected because disposal closed admission is expected cleanup. */
function isClosedAdmission(error: unknown): boolean {
  return error instanceof StorageLogError && error.code === 'closed'
}

/** Delegating stream that frees its Facility name after durable handle close. */
class RoutedLogStream implements LogStream {
  private disposal: Promise<void> | undefined

  constructor(
    private readonly inner: LogStream,
    private readonly onClosed: () => void,
    private readonly supportsSummary: boolean,
  ) {}

  get name(): string { return this.inner.name }
  get version(): number { return this.inner.version }
  get firstSequence(): number { return this.inner.firstSequence }
  get tailSequence(): number { return this.inner.tailSequence }

  append(expectedSequence: number, values: readonly unknown[], options?: LogAppendOptions): Promise<LogAppendResult> {
    if (options !== undefined && !this.supportsSummary) return Promise.reject(new StorageLogError('facet-unsupported', 'backend cannot atomically commit log summaries'))
    return this.inner.append(expectedSequence, values, options)
  }

  read(afterSequence: number, limit: number): Promise<readonly LogEntry[]> {
    return this.inner.read(afterSequence, limit)
  }

  readCheckpoint(): Promise<LogCheckpoint | undefined> {
    return this.inner.readCheckpoint()
  }

  writeCheckpoint(checkpoint: LogCheckpoint): Promise<void> {
    return this.inner.writeCheckpoint(checkpoint)
  }

  compact(request: LogCompactionRequest): Promise<void> {
    return this.inner.compact(request)
  }

  close(): Promise<void> {
    this.disposal ??= this.inner.close().finally(this.onClosed)
    return this.disposal
  }
}

/**
 * Mount the log form after every configured backend registration exists.
 * @param ctx - Plugin context.
 * @param config - Validated stream routes.
 * @returns resolution after the form has mounted.
 */
export function apply(ctx: Context, config: Config): Promise<void> {
  const backendServices = [...new Set([
    config.backend,
    ...Object.values(config.routes),
  ])].map(storageBackendServiceKey)
  const fiber = ctx.inject(backendServices, (storageCtx) => {
    const facility = new StorageLogFacility(storageCtx, config)
    storageCtx.effect(() => {
      const unmount = storageCtx.storage.mount('log', facility)
      return async () => {
        try {
          await facility.closeAll()
        } finally {
          unmount()
        }
      }
    })
    storageCtx.provide('storageLog', facility)
  })
  return Promise.resolve(fiber).then(() => {})
}
