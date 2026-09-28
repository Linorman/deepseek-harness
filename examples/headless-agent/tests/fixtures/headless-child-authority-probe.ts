/** Change a provider-owned startup scope at the real endpoint-binding policy boundary. @module */
import type { Context } from '@clocky/cordis'
import { TeamError } from '@clocky/clocky-team'

/** Read-only fault observations shared with the Loader scenario. */
export interface ChildAuthorityProbe { readonly denied: Promise<void>; readonly changed: boolean }
declare module '@clocky/cordis' {
  interface Context { childAuthorityProbe: ChildAuthorityProbe }
}

/** Install before the actual delegation Consumer registers its source. */
export const name = 'child-authority-probe'
/** Hub owns proof registration, authorization, and endpoint publication. */
export const inject = ['teams']
/** Observe real commands while changing only the external authorization fact.
 * @param ctx - Loader context that owns the temporary probe.
 */
export function apply(ctx: Context): void {
  const denied = Promise.withResolvers<undefined>()
  let changed = false
  ctx.provide('childAuthorityProbe', { denied: denied.promise, get changed() { return changed } })
  if (process.env.CLOCKY_CHILD_SCENARIO !== 'retarget') return
  const register = ctx.teams.registerSystemDelegationProofSource.bind(ctx.teams)
  const bind = ctx.teams.bindChildRun.bind(ctx.teams)
  ctx.effect(() => {
    ctx.teams.registerSystemDelegationProofSource = source => register({ ...source,
      resolveDelegationProof(proof) {
        const scope = source.resolveDelegationProof(proof)
        return changed && scope?.kind === 'delegation-authorize-run' && scope.operation === 'start'
          ? { ...scope, operation: 'cancel' } : scope
      },
    })
    ctx.teams.bindChildRun = async (request) => {
      try { return await bind(request) }
      catch (error: unknown) {
        if (changed && error instanceof TeamError && error.code === 'TEAM_ACTOR_PROOF_INVALID') denied.resolve(undefined)
        throw error
      }
    }
    return () => { ctx.teams.registerSystemDelegationProofSource = register; ctx.teams.bindChildRun = bind }
  }, 'childAuthorityProbe.commands()')
  ctx.effect(() => ctx.teams.registerPolicy('activate', { name: 'child-authority-retarget',
    async apply(request, next) {
      if (request.facts['operation'] === 'child-run-bind') changed = true
      return await next()
    },
  }), 'childAuthorityProbe.policy()')
}
