/** Principal inbox invariant ownership. @module @clocky/clocky-team-human-client/invariant */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'
/** Companion plugin identity. */
export const name = 'team-human-client-invariant'
/** Invariant ownership registry. */
export const inject = ['invariants']
/** No runtime invariant: durable reads validate inbox ownership, sequence and display; the Hub owns admission-before-receipt. */
const install: InvariantInstaller = () => {}
/** Register inbox invariant ownership. @param ctx - Invariant registry context. @returns Effect disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@clocky/clocky-team-human-client', install))
