/**
 * Single-Hub ownership lock for JSON log streams. JSON files provide atomic
 * replacement, not cross-process compare-and-set, so a root admits exactly
 * one live log backend. Stale same-host locks are reclaimed after their owner
 * process exits; ambiguous or malformed locks fail closed.
 * @module @clocky/clocky-storage-json/src/log-owner
 */

import type { FileHandle } from 'node:fs/promises'
import { open, readFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { StorageError } from '@clocky/clocky-storage'

/** Acquired file lock owned by one live JSON log backend. */
export interface JsonLogOwner {
  /** Release the owner record after every stream has closed. */
  close(): Promise<void>
}

/**
 * Acquire a root-wide log owner record, recovering a proven stale local PID.
 * @param directory - Existing backend-owned log directory.
 * @returns a caller-owned owner record released after every stream closes.
 */
export async function acquireJsonLogOwner(directory: string): Promise<JsonLogOwner> {
  const path = join(directory, '.clocky-log-owner.lock')
  for (;;) {
    let handle: FileHandle | undefined
    let created = false
    try {
      handle = await open(path, 'wx', 0o600)
      created = true
      const ownership = `${JSON.stringify({ host: hostname(), pid: process.pid, nonce: randomUUID() })}\n`
      await handle.writeFile(ownership, 'utf8')
      await handle.sync()
      return new FileLogOwner(path, handle)
    } catch (error) {
      /* v8 ignore next -- a fault after exclusive creation requires filesystem-error injection outside this owner contract. */
      if (created) {
        try {
          await handle?.close()
        } finally {
          await rm(path, { force: true })
        }
        throw error
      }
      await handle?.close()
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await reclaimStaleOwner(path)
    }
  }
}

/** Read one existing lock and atomically quarantine it only when its local owner is conclusively dead. */
async function reclaimStaleOwner(path: string): Promise<void> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    /* v8 ignore next -- another process can remove a lock between exclusive-open failure and this read. */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    /* v8 ignore next -- non-ENOENT read faults require an injected filesystem failure after the exclusive-open race. */
    throw error
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch (error) {
    throw new StorageError('malformed-medium', `JSON log owner lock '${path}' is not valid JSON`, { cause: error })
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new StorageError('malformed-medium', `JSON log owner lock '${path}' has no valid ownership record`)
  }
  const record = decoded as Record<string, unknown>
  const host = record['host']
  const pid = record['pid']
  const nonce = record['nonce']
  if (
    typeof host !== 'string' || host.length === 0
    || typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1
    || typeof nonce !== 'string' || nonce.length === 0
  ) {
    throw new StorageError('malformed-medium', `JSON log owner lock '${path}' has no valid ownership record`)
  }
  if (host !== hostname()) {
    throw new StorageError('writer-locked', `JSON log root is owned by ${host}; cross-host recovery is unsupported`)
  }
  try {
    process.kill(pid, 0)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    /* v8 ignore next -- a valid foreign-owner probe cannot take the non-ESRCH path under this process's credentials. */
    if (code === 'ESRCH') {
      await quarantineStaleOwner(path, nonce)
      return
    }
    /* v8 ignore next -- a validated local PID yields only ESRCH, EPERM, or success on supported hosts. */
    if (code !== 'EPERM') throw error
  }
  throw new StorageError('writer-locked', `JSON log root is owned by live process ${pid}`)
}

/**
 * Move the observed lock away from its canonical name before deletion. A
 * competing reclaimer that arrives after this rename can create a new owner,
 * but this process never unlinks that successor.
 */
async function quarantineStaleOwner(path: string, nonce: string): Promise<void> {
  const quarantine = `${path}.${nonce}.${randomUUID()}.stale`
  try {
    await rename(path, quarantine)
  } catch (error) {
    /* v8 ignore next -- another reclaimer can move the stale lock before this atomic rename. */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    /* v8 ignore next -- non-ENOENT rename faults require an injected filesystem failure during the cross-process race. */
    throw error
  }
  await rm(quarantine, { force: true })
}

/** One owner lock's release operation. */
class FileLogOwner implements JsonLogOwner {
  private closed = false

  constructor(
    private readonly path: string,
    private readonly handle: FileHandle,
  ) {}

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    let closeError: Error | undefined
    /* v8 ignore start -- close/remove failures require a filesystem-fault injector after the handle has been acquired. */
    try {
      await this.handle.close()
    } catch (error) {
      closeError = asError(error)
    }
    try {
      await rm(this.path, { force: true })
    } catch (error) {
      if (closeError === undefined) throw error
      throw new AggregateError([closeError, error], 'JSON log owner release failed')
    }
    if (closeError !== undefined) throw closeError
    /* v8 ignore stop */
  }
}

/** Normalize a caught value before an owner-release error escapes. */
/* v8 ignore next -- called only from the filesystem-fault cleanup branch above. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
