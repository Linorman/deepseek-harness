/** Real Loader, native owners and authenticated fetch carrier inspect a frozen source without inference. */
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationWriterLease } from '@clocky/clocky-simulation'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductRunIdSchema } from '@clocky/clocky-simulation-product/schema'
import type {} from '@clocky/clocky-host-product-principal-local'
import { seedSource } from '../sources-fixture.ts'
const ctx = await boot('simulation-sources', process.argv[2]!)
const leases: SimulationWriterLease[] = []
try {
  const spec = simulationRunSpecSchema.parse(JSON.parse(process.env.SIMULATION_PRODUCT_SPEC!))
  const run = await ctx.simulations.open(ctx.simulations.resolve({ provider: 'local', spec, mode: 'create' }))
  try {
    await run.setPhase('running', run.snapshot().revision)
    const credential = ctx.productPrincipals.bootstrapCredential('local')
    const principal = await ctx.productPrincipals.authenticate({ provider: 'local', credential })
    try {
      const result = await principal.withCall(async (call) => {
        const seeded = await seedSource(ctx, { run, leases }, call)
        const before = JSON.stringify(run.snapshot())
        const api = createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
        const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call }))
        const input = { runId: simulationProductRunIdSchema.parse('public-run'), decisionId: seeded.decisionId, sourceIndex: 0, limit: 1 }
        const hidden = await client.simulations.inspectSource(input)
        if (!hidden.result.ok || hidden.result.value.status !== 'withheld') throw new Error('Source default permission failed')
        const remove = ctx.simulationProducts.contextReaderRegistrar()([{ principalId: call.principal.id, entityIds: [seeded.id], content: ['sources'] }])
        let response = await client.simulations.inspectSource(input), searches = 0
        while (response.result.ok && response.result.value.status === 'searching') {
          searches++
          if (searches > 100) throw new Error('Source lookup did not advance')
          response = await client.simulations.inspectSource({ ...input, cursor: response.result.value.nextCursor,
            expectedRevision: response.result.value.snapshotRevision })
        }
        const text: string[] = []
        for (;;) {
          if (!response.result.ok || response.result.value.status !== 'found') throw new Error('Source did not resolve')
          const value = response.result.value
          for (const item of value.items) if (item.body.status === 'text') text.push(item.body.text)
          if (value.nextCursor === undefined) break
          response = await client.simulations.inspectSource({ ...input, envelopeSequence: value.envelope!.sequence,
            expectedRevision: value.snapshotRevision, cursor: value.nextCursor })
        }
        remove()
        const hiddenAgain = await client.simulations.inspectSource({ ...input, envelopeSequence: seeded.original.sequence })
        if (!hiddenAgain.result.ok || hiddenAgain.result.value.status !== 'withheld') throw new Error('Source revocation failed')
        return { text: text.join(''), boundedLookup: searches > 0, defaultWithheld: true, revoked: true,
          unchanged: JSON.stringify(run.snapshot()) === before }
      })
      console.log(JSON.stringify(result))
    } finally { await principal.revoke() }
  } finally { for (const lease of leases) { await lease.revoke(); await lease.release() }; await run.close() }
} finally { await ctx.fiber.dispose() }
