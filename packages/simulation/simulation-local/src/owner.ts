/** Same-host kernel-backed ownership, independent of log CAS. @module @clocky/clocky-simulation-local/owner */
import { DatabaseSync } from 'node:sqlite'

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
