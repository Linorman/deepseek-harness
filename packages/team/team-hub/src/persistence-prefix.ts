/** Read-only prefix reconstruction without trusting projection checkpoints. @module @clocky/clocky-team-hub/persistence-prefix */
import type { LogEntry, LogStream } from '@clocky/clocky-storage'

/**
 * Reconstruct a retained prefix using the owning domain's parser and fold.
 * @param stream - Owner-serialized durable stream.
 * @param cursor - Included last sequence.
 * @param pageSize - Configured recovery read bound.
 * @param fold - Domain parser and pure projection reducer.
 * @returns the projection at exactly cursor; truncated or noncontiguous history rejects.
 */
export async function readPersistencePrefix<T>(stream: LogStream, cursor: number, pageSize: number,
  fold: (previous: T | undefined, entry: LogEntry) => T): Promise<T> {
  if (stream.firstSequence !== 0 || cursor > stream.tailSequence) throw new Error('Checkpoint prefix is not retained')
  let projection: T | undefined
  let after = -1
  while (after < cursor) {
    const entries = await stream.read(after, Math.min(pageSize, cursor - after))
    if (entries.length === 0) throw new Error('Checkpoint prefix is incomplete')
    for (const entry of entries) {
      if (entry.sequence !== after + 1 || entry.sequence > cursor) throw new Error('Checkpoint prefix has a cursor gap')
      projection = fold(projection, entry)
      after = entry.sequence
    }
  }
  if (projection === undefined) throw new Error('Checkpoint prefix is empty')
  return projection
}
