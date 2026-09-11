/** Summary Consumer invariant ownership. @module @clocky/clocky-team-channel-summary/invariant */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

/** Companion plugin identity. */
export const name = 'team-channel-summary-invariant'
/** Invariant ownership registry. */
export const inject = ['invariants']
/** No runtime invariant: the Hub owns summary source, visibility, fingerprint and durable commit relationships. */
const install: InvariantInstaller = () => {}
/** Reserve the Consumer's invariant slot. @param ctx - Invariant-enabled context. @returns The registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@clocky/clocky-team-channel-summary', install))
