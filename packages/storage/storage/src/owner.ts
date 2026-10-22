/** Same-host kernel ownership shared by durable run and archive-publication owners. */
import { DatabaseSync } from 'node:sqlite'

/**
 * Hold an exclusive SQLite transaction until release; process exit releases the operating-system lock.
 * @param path - Stable owner-database path on a local filesystem; never unlink or replace it while owners may run.
 * @returns release callback to invoke after all owned IO settles; ambiguous or live ownership rejects immediately.
 */
export function acquireLocalFileOwner(path: string): () => void {
  const database = new DatabaseSync(path)
  try { database.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE') }
  catch (error) { database.close(); throw error }
  return () => { database.close() }
}
