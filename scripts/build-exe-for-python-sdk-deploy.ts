/** Restore workspace dependencies after pnpm's legacy production deployment. */

/**
 * Finish staging before restoring source-workspace links, including after failure.
 * @param stage - Deploy and detach the carrier from workspace dependency links.
 * @param restore - Reinstall the existing frozen workspace graph without network or lifecycle scripts.
 * @returns completion only when both staging and workspace restoration succeed.
 */
export async function stageWithWorkspaceRestore(stage: () => Promise<void>, restore: () => Promise<void>): Promise<void> {
  let failed = false
  let failure: unknown
  try { await stage() }
  catch (error: unknown) { failed = true; failure = error }
  try { await restore() }
  catch (error: unknown) {
    if (failed) throw new AggregateError([failure, error], 'Runtime staging and workspace dependency restoration failed')
    throw error
  }
  if (failed) throw failure
}
