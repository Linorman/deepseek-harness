/** Bounded, retryable discovery sessions over backend-owned stream-name iterators. */
import { randomUUID } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import type { Branded } from '@clocky/clocky-brand'
import { StorageLogError } from './error.ts'

/** A cursor identifies one scan position, not stream ordering or read authority. */
export type LogNameScanCursor = Branded<'LogNameScanCursor'>

/** Deployment bounds for retained discovery state and one page's actual work. */
export interface NameScanConfig {
  /** Maximum retained discovery iterators or retry pages. */
  readonly maxOpenScans?: number
  /** Maximum directory entries or indexed rows examined per page. */
  readonly maxScanEntries?: number
  /** Cursor idle validity; expired resources are reclaimed on the next scan or disposal. */
  readonly scanIdleMs?: number
  /** Maximum UTF-8 bytes in a discovered stream name or query prefix. */
  readonly maxScanNameBytes?: number
}

/** Request a bounded scan without reading any stream payload. */
export interface LogNameScanRequest {
  readonly prefix: string
  readonly afterCursor?: LogNameScanCursor
  readonly limit: number
}

/** Names examined by a scan; empty pages may still carry a continuation. */
export interface LogNameScanPage {
  readonly names: readonly string[]
  readonly scanned: number
  readonly nextCursor?: LogNameScanCursor
}

interface Scan {
  readonly id: string
  readonly prefix: string
  readonly iterator: AsyncIterator<string | undefined>
  position: number
  touched: number
  last?: { readonly cursor: string | undefined; readonly page: LogNameScanPage }
  pending?: { readonly cursor: string | undefined; readonly result: Promise<LogNameScanPage> }
  closing?: Promise<void>
}

/** Iterator owner that caps both retained scans and work per response. */
export class NameScanner {
  private readonly scans = new Map<string, Scan>()
  private readonly limits: Required<NameScanConfig>
  private closed = false

  /**
   * @param config - Deployment limits resolved before admitting any scan.
   * @param open - Backend iterator factory; each yield accounts for bounded physical discovery work.
   */
  constructor(config: NameScanConfig, private readonly open: (prefix: string, maxBytes: number) => AsyncIterable<string | undefined>) {
    this.limits = resolveLimits(config)
  }

  /** Read a page or replay its last response when it fits the caller's work bound.
   * @param request - Prefix, optional continuation, and maximum work units.
   * @returns a bounded page; invalid, expired or unavailable scan positions reject.
   */
  async scan(request: LogNameScanRequest): Promise<LogNameScanPage> {
    this.assertOpen()
    if (!request.prefix.isWellFormed() || Buffer.byteLength(request.prefix) > this.limits.maxScanNameBytes
      || !Number.isSafeInteger(request.limit) || request.limit < 1) {
      throw new StorageLogError('scan-invalid', 'stream-name discovery prefix or limit is invalid')
    }
    // A UUID and safe-integer position fit within this protocol bound.
    if (request.afterCursor !== undefined && request.afterCursor.length > 64) {
      throw new StorageLogError('scan-expired', 'stream-name cursor is not recognized; restart discovery')
    }
    await this.expire()
    this.assertOpen()
    const limit = Math.min(request.limit, this.limits.maxScanEntries)
    let scan: Scan
    if (request.afterCursor === undefined) {
      if (this.scans.size >= this.limits.maxOpenScans) {
        const complete = [...this.scans.values()].find(value => !value.pending && !value.closing
          && value.last !== undefined && value.last.page.nextCursor === undefined)
        if (complete !== undefined) await this.retire(complete)
      }
      this.assertOpen()
      if (this.scans.size >= this.limits.maxOpenScans) throw new StorageLogError('scan-limit', 'stream-name discovery has no free scan slot')
      scan = { id: randomUUID(), prefix: request.prefix,
        iterator: this.open(request.prefix, this.limits.maxScanNameBytes)[Symbol.asyncIterator](),
        position: 0, touched: performance.now() }
      this.scans.set(scan.id, scan)
    } else {
      const selected = this.scans.get(request.afterCursor.split(':')[0] ?? '')
      if (selected === undefined || selected.closing !== undefined) throw new StorageLogError('scan-expired', 'stream-name cursor expired; restart discovery')
      scan = selected
      if (scan.prefix !== request.prefix) throw new StorageLogError('scan-invalid', 'stream-name cursor belongs to another prefix')
      if (scan.last?.cursor === request.afterCursor) {
        if (scan.last.page.scanned > limit) throw new StorageLogError('scan-invalid', 'cached stream-name page exceeds the requested limit')
        scan.touched = performance.now()
        return scan.last.page
      }
      if (scan.last !== undefined && scan.last.page.nextCursor === undefined) throw new StorageLogError('scan-invalid', 'stream-name scan is complete')
      if (request.afterCursor !== `${scan.id}:${scan.position}`) throw new StorageLogError('scan-invalid', 'stream-name cursor is not the next scan position')
    }
    if (scan.pending !== undefined) {
      if (scan.pending.cursor !== request.afterCursor) {
        throw new StorageLogError('scan-invalid', 'stream-name scan already has a different page in flight')
      }
      const page = await scan.pending.result
      if (page.scanned > limit) throw new StorageLogError('scan-invalid', 'pending stream-name page exceeds the requested limit')
      return page
    }
    const result = Promise.resolve().then(() => this.read(scan, request.afterCursor, limit))
    scan.pending = { cursor: request.afterCursor, result }
    try { return await result }
    finally { delete scan.pending }
  }

  private async read(scan: Scan, cursor: string | undefined, limit: number): Promise<LogNameScanPage> {
    try {
      const names: string[] = []
      let scanned = 0
      let done = false
      while (scanned < limit) {
        const entry = await scan.iterator.next()
        if (entry.done) { done = true; break }
        scanned += 1
        if (entry.value !== undefined) {
          if (!entry.value.startsWith(scan.prefix) || !entry.value.isWellFormed()
            || Buffer.byteLength(entry.value) > this.limits.maxScanNameBytes) {
            throw new StorageLogError('scan-invalid', 'backend returned a stream name outside the scan bounds')
          }
          names.push(entry.value)
        }
      }
      if (scan.position === Number.MAX_SAFE_INTEGER) throw new StorageLogError('scan-expired', 'stream-name scan position exhausted')
      scan.position += 1
      const page: LogNameScanPage = Object.freeze({ names: Object.freeze(names), scanned,
        ...done ? {} : { nextCursor: `${scan.id}:${scan.position}` as LogNameScanCursor } })
      await setImmediate()
      scan.last = { cursor, page }
      scan.touched = performance.now()
      return page
    } catch (error: unknown) {
      try { await this.retire(scan) }
      catch (cleanupError: unknown) { throw new AggregateError([error, cleanupError], 'stream-name scan and iterator cleanup failed') }
      throw error
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new StorageLogError('closed', 'stream-name discovery is closed')
  }

  private async expire(): Promise<void> {
    const now = performance.now()
    await Promise.all([...this.scans.values()]
      .filter(scan => !scan.pending && !scan.closing && now - scan.touched >= this.limits.scanIdleMs)
      .map(scan => this.retire(scan)))
  }

  private async retire(scan: Scan): Promise<void> {
    scan.closing ??= (async () => {
      await scan.iterator.return?.()
      this.scans.delete(scan.id)
    })()
    await scan.closing
  }

  /** Wait for accepted page reads, then close every retained backend iterator. */
  async close(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.scans.values()].flatMap(scan => scan.pending ? [scan.pending.result] : []))
    const results = await Promise.allSettled([...this.scans.values()].map(scan => this.retire(scan)))
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'stream-name discovery cleanup failed')
  }
}

/** Resolve Config once so page execution never invents a deployment bound. */
function resolveLimits(config: NameScanConfig): Required<NameScanConfig> {
  const limits = { maxOpenScans: config.maxOpenScans ?? 32, maxScanEntries: config.maxScanEntries ?? 128,
    scanIdleMs: config.scanIdleMs ?? 30000, maxScanNameBytes: config.maxScanNameBytes ?? 4096 }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${key} must be a positive safe integer`)
  }
  return limits
}
