/** Complete bounded immutable log images for owner-coordinated backup and reference-preserving archives. */
import type { LogStream, LogEntry } from './log.ts'

/** Read and import budgets apply to the complete serialized image, including record envelopes. */
export interface LogArchiveLimits {
  readonly maxEntries: number
  readonly maxBytes: number
  readonly pageSize: number
}
/** Full original sequence range; projections and summaries are deliberately rebuilt by their owners. */
export interface LogArchive {
  readonly name: string
  readonly version: number
  readonly entries: readonly LogEntry[]
}
/**
 * Copy a full owner-held prefix without compaction or renumbering.
 * @param stream - Original stream held by its owning serializer or checkpoint barrier.
 * @param cursor - Exact final sequence expected by the collector.
 * @param limits - Finite complete-result bounds.
 * @returns original contiguous JSON records, or rejects on movement, gaps or excess size.
 */
export async function captureLogArchive(stream: LogStream, cursor: number, limits: LogArchiveLimits): Promise<LogArchive> {
  for (const value of [limits.maxEntries, limits.maxBytes, limits.pageSize]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Archive limits must be positive safe integers')
  if (!Number.isSafeInteger(cursor) || cursor < -1) throw new Error('Archive cursor must be an original sequence')
  if (stream.firstSequence !== 0 || stream.tailSequence !== cursor || cursor + 1 > limits.maxEntries)
    throw new Error('Archive requires complete original history at its exact bounded cursor')
  const entries: LogEntry[] = []
  let bytes = Buffer.byteLength(JSON.stringify({ name: stream.name, version: stream.version, entries: [] }))
  if (bytes > limits.maxBytes) throw new Error('Archive metadata exceeds complete byte budget')
  while (entries.length <= cursor) {
    const page = await stream.read(entries.length - 1, Math.min(limits.pageSize, cursor + 1 - entries.length))
    if (!page.length) throw new Error('Archive prefix is incomplete')
    for (const entry of page) {
      if (entry.sequence !== entries.length || entry.sequence > cursor) throw new Error('Archive prefix has a gap')
      bytes += Buffer.byteLength(JSON.stringify(entry)) + (entries.length ? 1 : 0)
      if (bytes > limits.maxBytes) throw new Error('Archive exceeds complete byte budget')
      entries.push(entry)
    }
  }
  if (stream.tailSequence !== cursor) throw new Error('Archive source moved during capture')
  return { name: stream.name, version: stream.version, entries }
}

/**
 * Expose verified original archives through the ordinary bounded storage read interface.
 * @param archives - Complete hash-verified images supplied by their archive owner.
 * @param limits - Per-read page cap and aggregate retained byte/entry bounds.
 * @returns read-only log facet; missing streams and writes fail instead of fabricating empty history.
 */
export function archiveLogFacet(archives: readonly LogArchive[], limits: LogArchiveLimits): import('./log.ts').LogFacet {
  for (const value of [limits.maxEntries, limits.maxBytes, limits.pageSize]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Archive limits must be positive safe integers')
  for (const archive of archives) if (archive.entries.some((entry, index) => entry.sequence !== index)) throw new Error('Archive catalog has a sequence gap')
  const images = new Map(archives.map(archive => [archive.name, structuredClone(archive)]))
  if (images.size !== archives.length || archives.reduce((count, archive) => count + archive.entries.length, 0) > limits.maxEntries
    || Buffer.byteLength(JSON.stringify(archives)) > limits.maxBytes) throw new Error('Archive read catalog is duplicate or exceeds bounds')
  const opened = new Set<string>()
  return {
    list() { return Promise.resolve([...images.values()].map(image => ({ name: image.name, version: image.version,
      tailSequence: image.entries.length - 1 }))) },
    has(name) { return Promise.resolve(images.has(name)) },
    async open(descriptor) {
      const image = images.get(descriptor.name)
      if (image === undefined) throw new Error('Archive stream is missing; empty history cannot substitute for an absent original')
      if (image.version !== descriptor.version) throw new Error('Archive stream version mismatch')
      if (opened.has(image.name)) throw new Error('Archive stream is already open')
      opened.add(image.name)
      let closed = false
      const assertOpen = () => { if (closed) throw new Error('Archive stream is closed') }
      const refuseWrite = () => { assertOpen(); return Promise.reject(new Error('Archive is read-only; restore into fresh storage before writing')) }
      return await Promise.resolve({ name: image.name, version: image.version, firstSequence: 0, tailSequence: image.entries.length - 1,
        async read(afterSequence, limit) {
          assertOpen()
          if (!Number.isSafeInteger(afterSequence) || afterSequence < -1
            || !Number.isSafeInteger(limit) || limit < 1 || limit > limits.pageSize)
            throw new Error('Archive read exceeds its declared page bound')
          return await Promise.resolve(structuredClone(image.entries.slice(afterSequence + 1, afterSequence + 1 + limit)))
        },
        readCheckpoint() { assertOpen(); return Promise.resolve(undefined) },
        append: refuseWrite, writeCheckpoint: refuseWrite, compact: refuseWrite,
        close() { closed = true; opened.delete(image.name); return Promise.resolve() },
      })
    },
  }
}
