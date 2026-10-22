/** Read an existing atomic JSON log file without backend creation or writer locking. */
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { assertLogReadRequest, boundedLogReadSnapshot, StorageError, StorageReadLimitError } from '@clocky/clocky-storage'
import type { LogReadLimits, LogReadSnapshot, LogStreamDescriptor } from '@clocky/clocky-storage'
import { parseLog } from './log-format.ts'
import { logFileName } from './log.ts'

/**
 * Observe an existing atomic-rewrite document through a read-only file descriptor.
 * @param root - Deployment-resolved JSON backend root; no directories are created.
 * @param descriptor - Expected stream identity and format.
 * @param limits - Explicit retained-row and complete-byte allowances.
 * @returns one detached consistent observation, or undefined for an absent stream.
 */
export async function readJsonLogSnapshot(root: string, descriptor: LogStreamDescriptor, limits: LogReadLimits):
Promise<LogReadSnapshot | undefined> {
  assertLogReadRequest(descriptor, limits)
  let handle
  try { handle = await open(join(root, 'logs', logFileName(descriptor.name)), 'r') }
  catch (cause: unknown) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
  try {
    const { size } = await handle.stat()
    if (size > limits.maxBytes) throw new StorageReadLimitError('bytes', size, limits.maxBytes)
    const buffer = Buffer.alloc(size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== size) throw new StorageError('malformed-medium', 'JSON log document changed within its read-only file observation')
    const state = parseLog(buffer.subarray(0, offset).toString('utf8'), descriptor)
    return boundedLogReadSnapshot({ ...descriptor, firstSequence: state.firstSequence ?? 0,
      tailSequence: state.entries.at(-1)?.sequence ?? -1, entries: state.entries,
      ...state.checkpoint === undefined ? {} : { checkpoint: state.checkpoint } }, limits)
  } finally { await handle.close() }
}
