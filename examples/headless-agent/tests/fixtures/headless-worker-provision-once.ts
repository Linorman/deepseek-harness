/** Deny one worker provisioning at the real Hub policy boundary. @module */
import type { Context } from '@clocky/cordis'

export const name = 'headless-worker-provision-once'
export const inject = ['teams']

/** Leave the durable invitation in place so TeamRun must resume that worker on retry. */
export function apply(ctx: Context): void {
  let rejected = false
  ctx.effect(() => ctx.teams.registerPolicy('activate', {
    name: 'headless-worker-provision-once',
    async apply(request, next) {
      if (!rejected && request.facts.operation === 'topology-participant-phase'
        && request.facts.topologyOperation === 'team-run-worker-activate'
        && request.facts.phase === 'provisioning') {
        rejected = true
        return { kind: 'deny', code: 'WORKER_PROVISION_ONCE', message: 'The invited worker could not provision yet.' }
      }
      return await next()
    },
  }), 'headless-worker-provision-once.policy()')
}
