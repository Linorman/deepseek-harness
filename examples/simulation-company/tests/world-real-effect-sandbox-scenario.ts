/** Real Loader, actual credential lease and durable adapter sink; no model or external provider is contacted. */
import { boot } from '@clocky/clocky-app-boot'
import type {} from '@clocky/clocky-simulation-product/external-effect-sandbox'
import type {} from '@clocky/clocky-host-product-principal-local'
const ctx = await boot('external-effect-sandbox-test', process.argv[2]!)
try {
  const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential: ctx.productPrincipals.bootstrapCredential('local') })
  try {
    const result = await lease.withCall(async (call) => {
      const sandbox = ctx.externalEffectSandbox
      if (process.argv[3] === 'create') {
        await sandbox.propose({ effectId: 'loader-action', adapterId: 'local-sandbox', action: 'record-test-action',
          target: 'local-test-ledger', units: 2, payload: 'finite sandbox request' }, call)
        await sandbox.grant({ grantId: 'loader-grant', effectId: 'loader-action', action: 'record-test-action',
          target: 'local-test-ledger', maxUnits: 2, expiresAt: 4102444800000, environment: 'test' }, call)
        const sink = ctx.storageLog.get('loader-effect-test:sink')!, append = sink.append.bind(sink)
        sink.append = async (...args) => { await append(...args); throw new Error('lost provider receipt') }
      }
      return sandbox.execute('loader-action', call)
    })
    console.log(JSON.stringify({ result, sinkTail: ctx.storageLog.get('loader-effect-test:sink')!.tailSequence }))
  } finally { await lease.revoke() }
} finally { await ctx.fiber.dispose() }
