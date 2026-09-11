/**
 * JSON implementation of the append-only storage-log facet. Each stream is a
 * human-readable document under `logs/`, rewritten atomically after a complete
 * compare-and-set batch or checkpoint update.
 * @module @clocky/clocky-storage-json/src/log
 */

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertLogCompactionBounds,
  assertLogCompactionRequest,
  EMPTY_LOG_SEQUENCE,
  StorageError,
} from '@clocky/clocky-storage'
import type {
  LogAppendResult, LogCheckpoint, LogCompactionRequest, LogEntry, LogStream, LogStreamDescriptor,
} from '@clocky/clocky-storage'
import { writeAtomic } from './atomic.ts'
import { parseLog, serializeLog } from './log-format.ts'
import type { LogState } from './log-format.ts'

/**
 * Open one JSON log stream, deferring physical materialization until its first
 * durable mutation.
 * @param descriptor - Expected stream identity and version.
 * @param path - Target file beneath the backend-owned log directory.
 * @param onClose - Backend callback that releases the open stream name.
 * @param isBackendClosed - Reads whether backend shutdown has closed admission.
 * @returns a caller-owned stream handle.
 */
export async function openJsonLog(
  descriptor: LogStreamDescriptor,
  path: string,
  onClose: () => void,
  isBackendClosed: () => boolean,
): Promise<LogStream> {
  let text: string | undefined
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const state = text === undefined ? emptyState(descriptor.version) : parseLog(text, descriptor)
  return new JsonLogStream(descriptor, path, state, onClose, isBackendClosed)
}

/**
 * Ensure the backend-owned JSON log directory exists before a stream opens.
 * @param root - Configured JSON backend root.
 * @returns the ensured log directory path.
 */
export async function ensureLogDirectory(root: string): Promise<string> {
  const directory = join(root, 'logs')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return directory
}

/**
 * Encode an opaque stream name as one collision-free JSON file stem.
 * @param name - Opaque durable stream name.
 * @returns a base64url file name ending in `.json`.
 */
export function logFileName(name: string): string {
  return `${Buffer.from(name, 'utf8').toString('base64url')}.json`
}

/** One in-process JSON stream. Its chain serializes expected-tail checks with writes. */
class JsonLogStream implements LogStream {
  private chain: Promise<void> = Promise.resolve()
  private disposing = false
  private closed = false
  private disposal: Promise<void> | undefined

  constructor(
    readonly descriptor: LogStreamDescriptor,
    private readonly path: string,
    private state: LogState,
    private readonly onClose: () => void,
    private readonly isBackendClosed: () => boolean,
  ) {}

  get name(): string { return this.descriptor.name }
  get version(): number { return this.descriptor.version }
  get firstSequence(): number { return this.state.firstSequence ?? 0 }
  get tailSequence(): number { return tailOf(this.state) }

  async append(expectedSequence: number, values: readonly unknown[]): Promise<LogAppendResult> {
    assertSequence('expectedSequence', expectedSequence)
    if (values.length === 0) throw new Error(`log stream '${this.name}' append values must be non-empty`)
    const snapshots = values.map(value => jsonSnapshot(value, `log stream '${this.name}' append value`))
    return await this.enqueue(async () => {
      const tail = tailOf(this.state)
      if (tail !== expectedSequence) {
        throw new StorageError(
          'sequence-conflict',
          `log stream '${this.name}' tail is ${tail}, expected ${expectedSequence}`,
        )
      }
      const nextEntries = [
        ...this.state.entries,
        ...snapshots.map((value, index) => ({ sequence: tail + index + 1, value })),
      ]
      const next: LogState = { ...this.state, entries: nextEntries }
      await writeAtomic(this.path, serializeLog(this.descriptor, next))
      this.state = next
      return { tailSequence: tailOf(next) }
    })
  }

  read(afterSequence: number, limit: number): Promise<readonly LogEntry[]> {
    try {
      assertSequence('afterSequence', afterSequence)
      assertPositiveLimit(limit)
      this.assertReadable()
      const firstSequence = this.state.firstSequence ?? 0
      if (this.state.entries.length > 0 && afterSequence < firstSequence - 1) {
        throw new StorageError(
          'compacted',
          `log stream '${this.name}' compacted through ${firstSequence - 1}; cursor ${afterSequence} is no longer readable`,
        )
      }
      return Promise.resolve(this.state.entries
        .filter(entry => entry.sequence > afterSequence)
        .slice(0, limit)
        .map(entry => ({ sequence: entry.sequence, value: jsonSnapshot(entry.value, `log stream '${this.name}' entry`) })))
    } catch (error) {
      /* v8 ignore next -- validated in-memory JSON state cannot fail a read without private-state corruption. */
      return Promise.reject(asError(error))
    }
  }

  readCheckpoint(): Promise<LogCheckpoint | undefined> {
    try {
      this.assertReadable()
      const checkpoint = this.state.checkpoint
      return Promise.resolve(checkpoint === undefined
        ? undefined
        : { sequence: checkpoint.sequence, value: jsonSnapshot(checkpoint.value, `log stream '${this.name}' checkpoint`) })
    } catch (error) {
      return Promise.reject(asError(error))
    }
  }

  async writeCheckpoint(checkpoint: LogCheckpoint): Promise<void> {
    assertSequence('checkpoint.sequence', checkpoint.sequence)
    const snapshot = { sequence: checkpoint.sequence, value: jsonSnapshot(checkpoint.value, `log stream '${this.name}' checkpoint`) }
    await this.enqueue(async () => {
      const tail = tailOf(this.state)
      if (snapshot.sequence > tail || snapshot.sequence < (this.state.checkpoint?.sequence ?? EMPTY_LOG_SEQUENCE)) {
        throw new StorageError(
          'checkpoint-conflict',
          `log stream '${this.name}' cannot store checkpoint ${snapshot.sequence} at tail ${tail}`,
        )
      }
      const next: LogState = { ...this.state, checkpoint: snapshot }
      await writeAtomic(this.path, serializeLog(this.descriptor, next))
      this.state = next
    })
  }

  async compact(request: LogCompactionRequest): Promise<void> {
    assertLogCompactionRequest(request)
    await this.enqueue(async () => {
      const tail = tailOf(this.state)
      assertLogCompactionBounds(this.name, tail, this.state.checkpoint?.sequence, request)
      const firstSequence = this.state.firstSequence ?? 0
      if (request.throughSequence < firstSequence) return
      const entries = this.state.entries.filter(entry => entry.sequence > request.throughSequence)
      if (entries.length === 0) {
        throw new StorageError('checkpoint-conflict', `log stream '${this.name}' compaction would remove its complete retained history`)
      }
      const next: LogState = {
        ...this.state,
        firstSequence: Math.max(firstSequence, request.throughSequence + 1),
        entries,
      }
      await writeAtomic(this.path, serializeLog(this.descriptor, next))
      this.state = next
    })
  }

  close(): Promise<void> {
    this.disposal ??= this.runClose()
    return this.disposal
  }

  private async runClose(): Promise<void> {
    this.disposing = true
    await this.chain
    this.closed = true
    this.onClose()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposing || this.isBackendClosed()) {
      return Promise.reject(new StorageError('closed', `log stream '${this.name}' is closed`))
    }
    const result = this.chain.then(operation)
    this.chain = result.then(() => {}, () => {})
    return result
  }

  private assertReadable(): void {
    if (this.closed || this.disposing || this.isBackendClosed()) {
      throw new StorageError('closed', `log stream '${this.name}' is closed`)
    }
  }
}

/** Empty state for a missing stream, retained only in memory until a write. */
function emptyState(version: number): LogState {
  return { version, entries: [] }
}

/** Current tail sequence of one validated stream state. */
function tailOf(state: LogState): number {
  return state.entries.at(-1)?.sequence ?? (state.firstSequence ?? 0) - 1
}

/** Reject malformed sequence inputs before they enter the serialized chain. */
function assertSequence(name: string, sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < EMPTY_LOG_SEQUENCE) {
    throw new Error(`${name} must be a safe integer at least ${EMPTY_LOG_SEQUENCE}`)
  }
}

/** Reject unbounded or empty result pages. */
function assertPositiveLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive safe integer')
  }
}

/** Clone one value through JSON before it crosses the durable boundary. */
function jsonSnapshot(value: unknown, subject: string): unknown {
  let text: unknown
  try {
    text = JSON.stringify(value)
  } catch (error) {
    throw new StorageError('invalid-value', `${subject} is not JSON-serializable`, { cause: error })
  }
  if (typeof text !== 'string') {
    throw new StorageError('invalid-value', `${subject} is not JSON-serializable`)
  }
  return JSON.parse(text)
}

/** Promise-returning log methods never synchronously throw non-Error values. */
/* v8 ignore next -- reached only by the private-state-corruption read guard above. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
