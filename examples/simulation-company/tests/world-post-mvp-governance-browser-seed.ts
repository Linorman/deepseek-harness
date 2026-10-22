/** Freeze real composite-governance execution before institution publication for read-only browser verification. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { runPostMvpRoute } from '../../../packages/simulation/simulation-local/tests/world-post-mvp-flow.ts'
const backend = process.env.SIMULATION_COMPANY_BACKEND
assert.ok(backend === 'json' || backend === 'sqlite')
const root = process.env.SIMULATION_COMPANY_ROOT!
const ctx = await boot('world-governance-browser-seed', process.argv[2]!)
const open = ctx.simulations.open.bind(ctx.simulations)
ctx.simulations.open = async (...args) => {
  const run = await open(...args), commit = run.commitWorldMutation.bind(run)
  run.commitWorldMutation = async (...input) => {
    const state = run.snapshot(), plan = state.world?.plans[input[0].planId]
    if (plan?.pin.operation === 'enact-norm') {
      const proposal = Object.values(state.world!.governance.proposals).find(value => value.reviewRoute !== undefined)
      assert.ok(proposal && proposal.reviewRoute?.steps.length === 2)
      assert.equal(Object.keys(state.world!.governance.votes).length, 3)
      assert.equal(state.world!.requests[plan.requestId]?.status, 'open')
      await writeFile(resolve(root, 'browser-proof.json'), JSON.stringify({ spec: state.spec, proposalId: proposal.id,
        proposer: proposal.proposer, scopeId: proposal.scopeId, requestId: plan.requestId, revision: state.revision,
        routeId: proposal.reviewRoute.id, source: proposal.source }) + '\n')
      process.send?.('ready')
      await new Promise<never>(() => { setInterval(() => {}, 1000) })
    }
    return await commit(...input)
  }
  return run
}
try { await runPostMvpRoute(backend, { loadedContext: { ctx, serviceFiber: ctx.fiber }, evidenceRoot: root }) }
finally { await ctx.fiber.dispose() }
