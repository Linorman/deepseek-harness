/** Check published projection revisions against durable log tails. @module @clocky/clocky-simulation-local/invariant */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'
import type {} from './index.ts'
import { assertWriterProjection, assertWriterAdmission } from './writers.ts'
import { assertBusinessProjection } from './decisions.ts'
import { assertSchedulerProjection } from './scheduler.ts'
/** Companion name. */
export const name = 'simulation-local-invariant'
/** Required diagnostic registry. */
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('simulation/committed', (snapshot, durableTail, previousRevision) => {
    if (snapshot.revision !== durableTail) fail('Published simulation revision differs from the committed journal tail')
    try {
      assertWriterProjection(snapshot); assertBusinessProjection(snapshot); assertSchedulerProjection(snapshot)
      if (previousRevision !== undefined) assertWriterAdmission(snapshot, previousRevision)
    }
    catch (error: unknown) { fail(error instanceof Error ? error.message : String(error)) }
  })
}
/**
 * Register the durable relationship check.
 * @param ctx - Diagnostic context.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@clocky/clocky-simulation-local', install))
