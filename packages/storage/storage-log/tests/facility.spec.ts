import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage, { storageBackendServiceKey } from '@clocky/clocky-storage'
import type {
  LogAppendResult, LogCheckpoint, LogCompactionRequest, LogEntry, LogFacet, LogStream,
  LogStreamDescriptor, LogStreamInfo, StorageBackend,
} from '@clocky/clocky-storage'
import { Config, StorageLogFacility, apply, defineLogStream } from '../src/index.ts'

/** Minimal in-memory log facet used to exercise only routing and lifecycle. */
class MemoryLogFacet implements LogFacet {
  private readonly streams = new Map<string, LogStream>()

  constructor(
    private readonly create = (descriptor: LogStreamDescriptor, onClose: () => void): LogStream =>
      new MemoryLogStream(descriptor, onClose),
  ) {}

  async open(descriptor: LogStreamDescriptor): Promise<LogStream> {
    if (this.streams.has(descriptor.name)) throw new Error(`double open: ${descriptor.name}`)
    const stream = this.create(descriptor, () => this.streams.delete(descriptor.name))
    this.streams.set(descriptor.name, stream)
    return stream
  }

  async list(): Promise<readonly LogStreamInfo[]> { return [] }
}

/** Fixed durable metadata used to exercise route-aware listing. */
class ListedLogFacet extends MemoryLogFacet {
  constructor(private readonly listed: readonly LogStreamInfo[]) {
    super()
  }

  override async list(): Promise<readonly LogStreamInfo[]> {
    return this.listed
  }
}

/** One manually controlled LogFacet open used to exercise disposal races. */
class DeferredLogFacet implements LogFacet {
  private resolveOpen: ((stream: LogStream) => void) | undefined
  private rejectOpen: ((error: unknown) => void) | undefined
  readonly opened = new Promise<LogStream>((resolve, reject) => {
    this.resolveOpen = resolve
    this.rejectOpen = reject
  })

  async open(_descriptor: LogStreamDescriptor): Promise<LogStream> {
    return await this.opened
  }

  async list(): Promise<readonly LogStreamInfo[]> { return [] }

  resolve(stream: LogStream): void {
    if (this.resolveOpen === undefined) throw new Error('deferred stream already resolved')
    this.resolveOpen(stream)
    this.resolveOpen = undefined
  }

  reject(error: unknown): void {
    if (this.rejectOpen === undefined) throw new Error('deferred stream already settled')
    this.rejectOpen(error)
    this.rejectOpen = undefined
  }
}

/** One manually controlled log listing used to exercise disposal races. */
class DeferredListLogFacet implements LogFacet {
  private resolveList: ((streams: readonly LogStreamInfo[]) => void) | undefined
  private rejectList: ((error: unknown) => void) | undefined
  readonly listed = new Promise<readonly LogStreamInfo[]>((resolve, reject) => {
    this.resolveList = resolve
    this.rejectList = reject
  })

  async open(_descriptor: LogStreamDescriptor): Promise<LogStream> {
    throw new Error('not used by listing test')
  }

  async list(): Promise<readonly LogStreamInfo[]> {
    return await this.listed
  }

  resolve(streams: readonly LogStreamInfo[]): void {
    if (this.resolveList === undefined) throw new Error('deferred listing already resolved')
    this.resolveList(streams)
    this.resolveList = undefined
  }

  reject(error: unknown): void {
    if (this.rejectList === undefined) throw new Error('deferred listing already settled')
    this.rejectList(error)
    this.rejectList = undefined
  }
}

/** Basic caller-owned stream double. */
class MemoryLogStream implements LogStream {
  private closed = false
  private readonly values: unknown[] = []

  constructor(
    readonly descriptor: LogStreamDescriptor,
    private readonly onClose: () => void,
  ) {}

  get name(): string { return this.descriptor.name }
  get version(): number { return this.descriptor.version }
  get firstSequence(): number { return 0 }
  get tailSequence(): number { return this.values.length - 1 }

  async append(expectedSequence: number, values: readonly unknown[]): Promise<LogAppendResult> {
    this.ensureOpen()
    if (expectedSequence !== this.values.length - 1) throw new Error('stale')
    this.values.push(...values)
    return { tailSequence: this.values.length - 1 }
  }

  async read(afterSequence: number, limit: number): Promise<readonly LogEntry[]> {
    this.ensureOpen()
    return this.values.slice(afterSequence + 1, afterSequence + 1 + limit)
      .map((value, offset) => ({ sequence: afterSequence + offset + 1, value }))
  }

  async readCheckpoint(): Promise<LogCheckpoint | undefined> { this.ensureOpen(); return undefined }
  async writeCheckpoint(_checkpoint: LogCheckpoint): Promise<void> { this.ensureOpen() }
  async compact(_request: LogCompactionRequest): Promise<void> { this.ensureOpen() }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.onClose()
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('closed')
  }
}

/** A stream whose backend close settles as a failure after releasing itself. */
class FailingCloseStream extends MemoryLogStream {
  override async close(): Promise<void> {
    await super.close()
    throw new Error('close failed')
  }
}

function setup(log: LogFacet = new MemoryLogFacet()) {
  const ctx = new Context()
  const backend: StorageBackend = { log, close: async () => {} }
  return ctx.plugin(Storage).then(async () => {
    ctx.storage.backend.register('memory', backend)
    const facility = new StorageLogFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('log', facility)
    return { ctx, facility }
  })
}

describe('StorageLogFacility', () => {
  it('rejects summary writes and reads when the routed backend lacks atomic summaries', async () => {
    const { facility } = await setup()
    const descriptor = { name: 'team/no-summary', version: 1 }
    const stream = await facility.open(descriptor)
    await expect(stream.append(-1, [{}], { summary: {} })).rejects.toMatchObject({ code: 'facet-unsupported' })
    expect(stream.tailSequence).toBe(-1)
    await expect(facility.readSummary(descriptor, 1024)).rejects.toMatchObject({ code: 'facet-unsupported' })
    await expect(facility.readSummary(descriptor, 0)).rejects.toMatchObject({ code: 'scan-invalid' })
    await facility.closeAll()
    await expect(facility.readSummary(descriptor, 1024)).rejects.toMatchObject({ code: 'closed' })
    await expect(facility.scanNames({ prefix: 'team/', limit: 1 })).rejects.toMatchObject({ code: 'closed' })
    await expect(facility.hasStream(descriptor.name)).rejects.toMatchObject({ code: 'closed' })
  })

  it('refuses recovery discovery on a provider that lacks bounded physical metadata capabilities', async () => {
    const { facility } = await setup()
    await expect(facility.hasStream('team/absent')).rejects.toMatchObject({ code: 'facet-unsupported' })
    await expect(facility.scanNames({ prefix: 'team/', limit: 1 })).rejects.toMatchObject({ code: 'facet-unsupported' })
    await facility.closeAll()
  })

  it('drains owned streams even when a retained discovery iterator refuses cleanup', async () => {
    const log = new MemoryLogFacet()
    const cleanupError = new Error('discovery cleanup failed')
    const { facility } = await setup({
      open: descriptor => log.open(descriptor),
      list: () => log.list(),
      async * scanNames() {
        try { yield 'team/a'; yield 'team/b' }
        finally { throw cleanupError }
      },
    })
    const stream = await facility.open({ name: 'team/a', version: 1 })
    expect((await facility.scanNames({ prefix: 'team/', limit: 1 })).names).toEqual(['team/a'])
    await expect(facility.closeAll()).rejects.toThrow('storage log facility disposal failed')
    await expect(stream.read(-1, 1)).rejects.toThrow('closed')
    await expect(facility.closeAll()).rejects.toThrow('storage log facility disposal failed')
  })

  it('filters historical names by their current route while forwarding bounded existence and summary reads', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const physical = new MemoryLogFacet()
    const reads: Array<{ name: string; maxBytes: number }> = []
    ctx.storage.backend.register('primary', {
      close: async () => {},
      log: {
        open: descriptor => physical.open(descriptor), list: () => physical.list(),
        has: async name => name === 'team/a',
        readSummary: async (descriptor, maxBytes) => {
          reads.push({ name: descriptor.name, maxBytes })
          return { sequence: 0, value: { label: 'bounded header' } }
        },
        async * scanNames() { yield undefined; yield 'team/a'; yield 'team/child/historical' },
      },
    })
    ctx.storage.backend.register('secondary', {
      close: async () => {},
      log: {
        open: descriptor => physical.open(descriptor), list: () => physical.list(),
        async * scanNames() { yield 'team/child/current' },
      },
    })
    const facility = new StorageLogFacility(ctx, { backend: 'primary', routes: {
      'team/child/historical': 'secondary', 'team/child/current': 'secondary',
    } })
    try {
      expect(await facility.hasStream('team/a')).toBe(true)
      expect(await facility.hasStream('team/absent')).toBe(false)
      expect(await facility.readSummary({ name: 'team/a', version: 1 }, 64))
        .toEqual({ sequence: 0, value: { label: 'bounded header' } })
      expect(reads).toEqual([{ name: 'team/a', maxBytes: 64 }])
      expect(await facility.scanNames({ prefix: 'team/', limit: 16 }))
        .toEqual({ names: ['team/a', 'team/child/current'], scanned: 6 })
    } finally { await facility.closeAll(); await ctx.fiber.dispose() }
  })

  it('routes a declared stream, exposes the mounted form, and frees its name after close', async () => {
    const { ctx, facility } = await setup()
    const descriptor = defineLogStream({ name: 'team_alpha', version: 1 })
    const stream = await facility.open(descriptor)
    expect(ctx.storage.log).toBe(facility)
    await stream.append(-1, [{ accepted: true }])
    await stream.writeCheckpoint({ sequence: 0, value: { folded: true } })
    await expect(stream.compact({ throughSequence: -1, expectedCheckpointSequence: 0 })).resolves.toBeUndefined()
    await expect(stream.readCheckpoint()).resolves.toBeUndefined()
    expect(await stream.read(-1, 10)).toEqual([{ sequence: 0, value: { accepted: true } }])
    await expect(facility.open(descriptor)).rejects.toMatchObject({ code: 'already-open' })
    await stream.close()
    const reopened = await facility.open(descriptor)
    expect(reopened).toMatchObject({ name: 'team_alpha', version: 1 })
    await reopened.close()
  })

  it('fails loud when a configured backend lacks the log facet', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('none', { close: async () => {} })
    const facility = new StorageLogFacility(ctx, { backend: 'none', routes: {} })
    await expect(facility.open({ name: 'team_beta', version: 1 })).rejects.toMatchObject({
      code: 'facet-unsupported',
    })
    await expect(facility.hasStream('team_beta')).rejects.toMatchObject({ code: 'facet-unsupported' })
    await expect(facility.scanNames({ prefix: 'team/', limit: 1 })).rejects.toMatchObject({ code: 'facet-unsupported' })
    await facility.closeAll()
  })

  it('uses the default route for an opaque inherited-property stream name', async () => {
    const { facility } = await setup()
    const stream = await facility.open({ name: 'constructor', version: 1 })
    await expect(stream.append(-1, [{ routed: true }])).resolves.toEqual({ tailSequence: 0 })
    await stream.close()
  })

  it('uses an own route override', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const defaultBackend: StorageBackend = { log: new MemoryLogFacet(), close: async () => {} }
    const routedBackend: StorageBackend = { log: new MemoryLogFacet(), close: async () => {} }
    ctx.storage.backend.register('default', defaultBackend)
    ctx.storage.backend.register('routed', routedBackend)
    const facility = new StorageLogFacility(ctx, {
      backend: 'default',
      routes: { 'team/routed': 'routed' },
    })
    const stream = await facility.open({ name: 'team/routed', version: 1 })
    await stream.close()

  })

  it('lists only streams assigned to each configured route in stable name order', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const defaultBackend: StorageBackend = {
      log: new ListedLogFacet([
        { name: 'team/routed', version: 1, tailSequence: 0 },
        { name: 'team/unrouted', version: 1, tailSequence: 2 },
      ]),
      close: async () => {},
    }
    const routedBackend: StorageBackend = {
      log: new ListedLogFacet([
        { name: 'team/unrouted', version: 1, tailSequence: 4 },
        { name: 'team/routed', version: 1, tailSequence: 3, checkpointSequence: 1 },
      ]),
      close: async () => {},
    }
    ctx.storage.backend.register('default', defaultBackend)
    ctx.storage.backend.register('routed', routedBackend)
    const facility = new StorageLogFacility(ctx, {
      backend: 'default',
      routes: { 'team/routed': 'routed' },
    })
    await expect(facility.list()).resolves.toEqual([
      { name: 'team/routed', version: 1, tailSequence: 3, checkpointSequence: 1 },
      { name: 'team/unrouted', version: 1, tailSequence: 2 },
    ])
  })

  it('fails loud when a listing route lacks the log facet', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('none', { close: async () => {} })
    const facility = new StorageLogFacility(ctx, { backend: 'none', routes: {} })
    await expect(facility.list()).rejects.toMatchObject({ code: 'facet-unsupported' })
  })

  it('reports a backend-open failure only after disposal drains the accepted open', async () => {
    const delayed = new DeferredLogFacet()
    const { facility } = await setup(delayed)
    const opening = facility.open({ name: 'team/rejected', version: 1 })
    const closing = facility.closeAll()
    delayed.reject(new Error('backend open failed'))
    await expect(opening).rejects.toThrow('backend open failed')
    await expect(closing).rejects.toThrow('storage log facility disposal failed')
  })

  it('rejects invalid stream declarations before backend routing', () => {
    expect(() => defineLogStream({ name: '', version: 1 })).toThrow(/non-empty/)
    expect(() => defineLogStream({ name: 'team/invalid', version: -1 })).toThrow(/non-negative/)
  })

  it('closes admission, drains an accepted open, and never returns an escaped stream', async () => {
    const delayed = new DeferredLogFacet()
    const { facility } = await setup(delayed)
    const descriptor = { name: 'team/pending', version: 1 }
    const opening = facility.open(descriptor)
    const closing = facility.closeAll()
    delayed.resolve(new MemoryLogStream(descriptor, () => {}))
    await expect(opening).rejects.toMatchObject({ code: 'closed' })
    await expect(closing).resolves.toBeUndefined()
    await expect(facility.open({ name: 'team/after-close', version: 1 })).rejects.toMatchObject({ code: 'closed' })
  })

  it('drains an accepted listing before close and refuses later listings', async () => {
    const delayed = new DeferredListLogFacet()
    const { facility } = await setup(delayed)
    const listing = facility.list()
    const closing = facility.closeAll()
    delayed.resolve([{ name: 'team/persisted', version: 1, tailSequence: 0 }])
    await expect(listing).resolves.toEqual([{ name: 'team/persisted', version: 1, tailSequence: 0 }])
    await expect(closing).resolves.toBeUndefined()
    await expect(facility.list()).rejects.toMatchObject({ code: 'closed' })
  })

  it('reports a listing failure only after disposal drains the accepted listing', async () => {
    const delayed = new DeferredListLogFacet()
    const { facility } = await setup(delayed)
    const listing = facility.list()
    const closing = facility.closeAll()
    delayed.reject(new Error('backend list failed'))
    await expect(listing).rejects.toThrow('backend list failed')
    await expect(closing).rejects.toThrow('storage log facility disposal failed')
  })

  it('settles every stream and then aggregates close failures', async () => {
    const facet = new MemoryLogFacet((descriptor, onClose) =>
      descriptor.name === 'bad' ? new FailingCloseStream(descriptor, onClose) : new MemoryLogStream(descriptor, onClose))
    const { facility } = await setup(facet)
    const bad = await facility.open({ name: 'bad', version: 1 })
    const good = await facility.open({ name: 'good', version: 1 })
    await expect(facility.closeAll()).rejects.toThrow('storage log facility disposal failed')
    await expect(bad.read(-1, 1)).rejects.toThrow('closed')
    await expect(good.read(-1, 1)).rejects.toThrow('closed')
    expect(facility.get('bad')).toBeUndefined()
    expect(facility.get('good')).toBeUndefined()
  })

  it('mounts and unmounts through the real plugin entry point', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend: StorageBackend = { log: new MemoryLogFacet(), close: async () => {} }
    ctx.storage.backend.register('memory', backend)
    ctx.provide(storageBackendServiceKey('memory'), backend)
    const fiber = await ctx.plugin({ apply, Config, inject: ['storage'] }, { backend: 'memory', routes: {} })
    expect(ctx.storage.log).toBe(ctx.storageLog)
    await fiber.dispose()
    expect(() => ctx.storage.form('log')).toThrow(/not mounted/)
  })

})
