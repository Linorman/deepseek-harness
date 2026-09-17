/**
 * JSON storage backend: one human-readable file per unit under a configured
 * root, published by atomic whole-file rewrite. Registers as backend `json`
 * on the storage hub.
 * @module @clocky/clocky-storage-json
 */

import { lstat, mkdir, open, opendir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { parseLogSummary, StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@clocky/clocky-storage'
import type {
  KvFacet, KvUnit, KvUnitDescriptor, LogFacet, LogStream, LogStreamDescriptor,
  LogStreamInfo, StorageBackend,
} from '@clocky/clocky-storage'
import { ensureLogDirectory, logFileName, openJsonLog } from './log.ts'
import { parseLogInfo } from './log-format.ts'
import { acquireJsonLogOwner } from './log-owner.ts'
import type { JsonLogOwner } from './log-owner.ts'
import { openJsonUnit } from './unit.ts'

/** Cordis plugin name. */
export const name = 'storage-json'
/** The hub must exist before the backend can register. */
export const inject = ['storage']

/**
 * Plugin configuration.
 * `root` has NO default on purpose: a `process.cwd()` fallback would scatter
 * unit files wherever the process happens to start; assemblies state the
 * location explicitly.
 */
export interface Config {
  /** Directory holding one `<unit>.json` file per unit. */
  root: string
}

/** Config schema. */
export const Config: z<Config> = z.object({
  root: z.string().required(),
})

/** JSON backend: owns the file-tree root and serves the `kv` facet. */
export class JsonStorageBackend implements StorageBackend {
  private readonly open = new Map<string, KvUnit>()
  // Reserved synchronously at open() entry so a concurrent open of the same
  // unit fails, and close() can await opens still in flight.
  private readonly opening = new Map<string, Promise<KvUnit>>()
  private readonly openLogs = new Map<string, LogStream>()
  /** In-flight log opens retain their names until they resolve or reject. */
  private readonly openingLogs = new Map<string, Promise<LogStream>>()
  /** Root-wide single-Hub reservation for JSON log operations. */
  private logOwner: Promise<JsonLogOwner> | undefined
  private closed = false

  constructor(private readonly root: string) {}

  readonly kv: KvFacet = {
    // The body up to the first await runs synchronously, so the opening-slot
    // reservation below still excludes a concurrent open of the same unit.
    open: async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
      if (this.closed) throw new StorageError('closed', 'json backend is closed')
      validateDescriptor(descriptor)
      if (this.open.has(descriptor.name) || this.opening.has(descriptor.name)) {
        // Double-open is a caller bug, not a medium condition.
        throw new Error(`unit '${descriptor.name}' is already open; a unit has exactly one live handle`)
      }
      const opening = this.openUnit(descriptor)
      this.opening.set(descriptor.name, opening)
      return opening.finally(() => this.opening.delete(descriptor.name))
    },
  }

  /** Append-only log streams under this backend's `logs/` directory. */
  readonly log: LogFacet = {
    readSummary: async (descriptor, maxBytes) => {
      if (this.closed) throw new StorageError('closed', 'json backend is closed')
      const path = join(await this.ensureLogOwner(), logFileName(descriptor.name))
      let handle
      try { handle = await open(path, 'r') }
      catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
      try {
        const buffer = Buffer.alloc(maxBytes)
        let used = 0
        let end = -1
        while (used < maxBytes && end < 0) {
          const { bytesRead } = await handle.read(buffer, used, maxBytes - used, used)
          if (bytesRead === 0) break
          const newline = buffer.subarray(used, used + bytesRead).indexOf(10)
          if (newline >= 0) end = used + newline
          used += bytesRead
        }
        if (end < 0) throw new StorageError('invalid-value', `log '${descriptor.name}' summary header exceeds ${maxBytes} bytes or is incomplete`)
        const line = buffer.subarray(0, end).toString('utf8')
        let document: unknown
        try { document = JSON.parse(`${line.slice(0, -1)}}`) }
        catch (error: unknown) { throw new StorageError('malformed-medium', `log '${descriptor.name}' has invalid summary JSON`, { cause: error }) }
        if (typeof document !== 'object' || document === null || !('stream' in document)) {
          throw new StorageError('malformed-medium', `log '${descriptor.name}' has no summary header`)
        }
        return parseLogSummary(document.stream, descriptor)
      } finally { await handle.close() }
    },
    has: async (name) => {
      if (this.closed) throw new StorageError('closed', 'json backend is closed')
      const path = join(await this.ensureLogOwner(), logFileName(name))
      let info
      try { info = await lstat(path) }
      catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
      if (!info.isFile()) throw new StorageError('malformed-medium', `log '${name}' is not a regular file`)
      return true
    },
    scanNames: (prefix, maxNameBytes) => this.scanLogNames(prefix, maxNameBytes),
    open: async (descriptor: LogStreamDescriptor): Promise<LogStream> => {
      if (this.closed) throw new StorageError('closed', 'json backend is closed')
      validateLogDescriptor(descriptor)
      if (this.openLogs.has(descriptor.name) || this.openingLogs.has(descriptor.name)) {
        throw new Error(`log stream '${descriptor.name}' is already open; a stream has exactly one live handle`)
      }
      const opening = this.openLog(descriptor)
      this.openingLogs.set(descriptor.name, opening)
      return opening.finally(() => this.openingLogs.delete(descriptor.name))
    },
    list: async (): Promise<readonly LogStreamInfo[]> => await this.listLogs(),
  }

  private async openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const path = join(this.root, `${descriptor.name}.json`)
    const unit = await openJsonUnit(descriptor, path, () => this.open.delete(descriptor.name))
    if (this.closed) {
      // The backend closed while this open was in flight: do not hand out a
      // live unit past close().
      await unit.close()
      throw new StorageError('closed', 'json backend is closed')
    }
    this.open.set(descriptor.name, unit)
    return unit
  }

  /** Materialize one log handle after reserving its name at `log.open()` entry. */
  private async openLog(descriptor: LogStreamDescriptor): Promise<LogStream> {
    const directory = await this.ensureLogOwner()
    const stream = await openJsonLog(
      descriptor,
      join(directory, logFileName(descriptor.name)),
      () => { this.openLogs.delete(descriptor.name) },
      () => this.closed,
    )
    if (this.closed) {
      await stream.close()
      throw new StorageError('closed', 'json backend is closed')
    }
    this.openLogs.set(descriptor.name, stream)
    return stream
  }

  /** Examine one directory entry per yield without reading any journal payload. */
  private async * scanLogNames(prefix: string, maxNameBytes: number): AsyncIterable<string | undefined> {
    if (this.closed) throw new StorageError('closed', 'json backend is closed')
    const directory = await opendir(await this.ensureLogOwner(), { bufferSize: 1 })
    for await (const entry of directory) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- backend disposal can race each directory read.
      if (this.closed) throw new StorageError('closed', 'json backend is closed')
      if (!entry.name.endsWith('.json')) { yield undefined; continue }
      if (!entry.isFile()) throw new StorageError('malformed-medium', `log entry '${entry.name}' is not a regular file`)
      const name = Buffer.from(entry.name.slice(0, -5), 'base64url').toString('utf8')
      if (!name || logFileName(name) !== entry.name) throw new StorageError('malformed-medium', `log entry '${entry.name}' has an invalid name`)
      if (!name.startsWith(prefix)) { yield undefined; continue }
      if (Buffer.byteLength(name) > maxNameBytes) throw new StorageError('invalid-value', 'log name exceeds the discovery byte limit')
      yield name
    }
  }

  /** Read every materialized stream header without opening a caller handle. */
  private async listLogs(): Promise<readonly LogStreamInfo[]> {
    if (this.closed) throw new StorageError('closed', 'json backend is closed')
    const directory = await this.ensureLogOwner()
    const files = await readdir(directory)
    const infos: LogStreamInfo[] = []
    for (const file of files.filter(file => file.endsWith('.json')).sort()) {
      const info = parseLogInfo(await readFile(join(directory, file), 'utf8'))
      if (logFileName(info.name) !== file) {
        throw new StorageError('malformed-medium', `log stream file '${file}' has an invalid stream header`)
      }
      infos.push(info)
    }
    return infos.sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Acquire the process-wide JSON-log owner before any log operation runs. */
  private async ensureLogOwner(): Promise<string> {
    if (this.logOwner === undefined) {
      const acquiring = ensureLogDirectory(this.root).then(acquireJsonLogOwner)
      this.logOwner = acquiring
      acquiring.catch(() => {
        /* v8 ignore next -- all public callers share this pending promise until rejection clears the slot. */
        if (this.logOwner === acquiring) this.logOwner = undefined
      })
    }
    const owner = this.logOwner
    await owner
    return join(this.root, 'logs')
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
    }
    await Promise.allSettled([...this.opening.values()])
    await Promise.allSettled([...this.openingLogs.values()])
    for (const unit of [...this.open.values()]) {
      await unit.close()
    }
    for (const stream of [...this.openLogs.values()]) {
      await stream.close()
    }
    const owner = await this.logOwner?.catch(() => undefined)
    await owner?.close()
  }
}

function validateDescriptor(descriptor: KvUnitDescriptor): void {
  if (!UNIT_NAME_RE.test(descriptor.name)) {
    throw new StorageError('malformed-medium', `invalid unit name '${descriptor.name}'`)
  }
  for (const table of descriptor.tables) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new StorageError('malformed-medium', `invalid table name '${table}' in unit '${descriptor.name}'`)
    }
  }
}

/** Reject invalid stream identity/version before it reaches the medium. */
function validateLogDescriptor(descriptor: LogStreamDescriptor): void {
  if (descriptor.name.length === 0) {
    throw new StorageError('malformed-medium', 'log stream name must be non-empty')
  }
  if (!Number.isSafeInteger(descriptor.version) || descriptor.version < 0) {
    throw new StorageError('malformed-medium', `invalid log stream version ${descriptor.version} for '${descriptor.name}'`)
  }
}

/**
 * Register the `json` backend on the storage hub.
 * @param ctx - Plugin context.
 * @param config - Validated configuration.
 */
export function apply(ctx: Context, config: Config) {
  const backend = new JsonStorageBackend(config.root)
  ctx.effect(() => {
    const unregister = ctx.storage.backend.register('json', backend)
    return async () => {
      unregister()
      await backend.close()
    }
  })
  ctx.provide(storageBackendServiceKey('json'), backend)
}
