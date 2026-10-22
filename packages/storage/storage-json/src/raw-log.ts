/** Preserve an existing atomic log document without interpreting its consumer protocol. */
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { assertLogReadRequest, StorageError, StorageReadLimitError } from '@clocky/clocky-storage'
import type { LogReadLimits, RawLogArchive } from '@clocky/clocky-storage'
import { parseLogInfo, parseLog } from './log-format.ts'
import { logFileName } from './log.ts'

/**
 * Capture exact document bytes from one file descriptor under explicit whole-document bounds.
 * @param root - Fixed backend namespace selected by its owner; no caller filesystem paths are accepted by domain APIs.
 * @param name - Fixed original storage stream name.
 * @param limits - Raw byte, complete archive byte and retained-entry refusal bounds.
 * @returns a raw-only storage archive or absence; no consumer version parser, writer, migration or repair runs.
 */
export async function readJsonRawLogArchive(root: string, name: string, limits: LogReadLimits): Promise<RawLogArchive | undefined> {
  assertLogReadRequest({ name, version: 0 }, limits)
  let file
  try { file = await open(join(root, 'logs', logFileName(name)), 'r') }
  catch (cause: unknown) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw cause }
  try {
    const { size } = await file.stat()
    if (size > limits.maxBytes) throw new StorageReadLimitError('bytes', size, limits.maxBytes)
    const bytes = Buffer.alloc(size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const next = await file.read(bytes, offset, bytes.length - offset, offset)
      if (next.bytesRead === 0) break
      offset += next.bytesRead
    }
    if (offset !== size) throw new StorageError('malformed-medium', 'Raw JSON source moved within its captured file descriptor')
    const original = bytes.subarray(0, size), document = new TextDecoder('utf-8', { fatal: true }).decode(original)
    const info = parseLogInfo(document)
    if (info.name !== name) throw new StorageError('malformed-medium', 'Raw archive source has another storage stream identity')
    const state = parseLog(document, { name, version: info.version })
    if (state.entries.length > limits.maxEntries) throw new StorageReadLimitError('entries', state.entries.length, limits.maxEntries)
    const text = JSON.stringify({ format: 'clocky.raw-json-log/v1', name, version: info.version,
      documentBase64: original.toString('base64') }) + '\n'
    const result: RawLogArchive = { version: info.version, firstSequence: state.firstSequence ?? 0, tailSequence: info.tailSequence,
      entryCount: state.entries.length, representation: 'json-document-bytes', sourceHash: createHash('sha256').update(text).digest('hex'), text }
    const complete = Buffer.byteLength(JSON.stringify(result))
    if (complete > limits.maxBytes) throw new StorageReadLimitError('bytes', complete, limits.maxBytes)
    return result
  } finally { await file.close() }
}
