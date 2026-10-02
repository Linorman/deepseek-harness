/** Same-host kernel-backed ownership, independent of log CAS. @module @clocky/clocky-simulation-local/owner */
import { DatabaseSync } from 'node:sqlite'
import { stat } from 'node:fs/promises'

/**
 * Hold an exclusive SQLite transaction for one run's entire live lifetime.
 * Process exit releases the OS lock; no timeout or PID heuristic can evict a live writer.
 * The stable owner file must never be removed or replaced while a coordinator is running.
 * @param path - Canonical run-directory owner database on a local filesystem.
 * @returns release callback, invoked only after run IO and cleanup settle.
 */
export function acquireRunOwner(path: string): () => void {
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE')
  } catch (error) {
    db.close()
    throw new Error('Simulation run already has a coordinator or its owner database is unavailable', { cause: error })
  }
  return () => { db.close() }
}

/**
 * Observe the existing owner lock using a read-only connection without reserving or replacing it.
 * @param path - Deployment-resolved stable owner database.
 * @returns observed absence of ownership, another live owner or unavailable evidence; this grants no takeover authority.
 */
export async function observeRunOwner(path: string): Promise<'unowned' | 'other-owner' | 'unavailable'> {
  try { await stat(path) }
  catch { return 'unavailable' }
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(path, { readOnly: true })
    db.exec('PRAGMA busy_timeout = 0')
    db.prepare('PRAGMA schema_version').get()
    return 'unowned'
  } catch (cause: unknown) {
    const error = cause as { errcode?: number }
    return typeof error.errcode === 'number' && [5, 6].includes(error.errcode & 0xff) ? 'other-owner' : 'unavailable'
  } finally { db?.close() }
}
