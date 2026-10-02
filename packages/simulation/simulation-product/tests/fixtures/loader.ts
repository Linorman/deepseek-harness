/** Real Loader and credential lease exercise public product reads independently of a native writer. */
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSpecSchema, simulationChangeSchema, simTimeSchema, simulationEntityIdSchema,
  simulationWriterReservationSchema, simulationWriterActivationSchema, simulationResourceSpecSchema,
  simulationDecisionIdSchema, simulationProposalSchema } from '@clocky/clocky-simulation'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductRunIdSchema } from '@clocky/clocky-simulation-product/schema'
import type {} from '@clocky/clocky-host-product-principal-local'

const ctx = await boot('simulation-product-test', process.argv[2]!)
try {
  if (process.argv[3] === 'seed') {
    const spec = simulationRunSpecSchema.parse(JSON.parse(process.env.SIMULATION_PRODUCT_SPEC!))
    const run = await ctx.simulations.open(ctx.simulations.resolve({ provider: 'local', spec, mode: 'create' }))
    await run.setPhase('running', 0)
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'private-entity', entityKind: 'org',
      cognition: 'none', profile: { name: 'Private world profile', secret: 'not-public' } }), run.snapshot().revision)
    await run.drive({ until: simTimeSchema.parse('9007199254740993') })
    const entityId = simulationEntityIdSchema.parse('decision-maker')
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entityId, entityKind: 'person', cognition: 'agent',
      profile: { name: 'Decision maker', secret: 'not-public' } }), run.snapshot().revision)
    const reservation = simulationWriterReservationSchema.parse({ teamId: 'source-team', participantId: 'source-participant',
      sessionId: 'source-session', reservationId: 'source-reservation', provider: 'local' })
    await run.bindEntity(entityId, { teamId: reservation.teamId, participantId: reservation.participantId,
      sessionId: reservation.sessionId }, run.snapshot().revision)
    const writer = await run.reserveWriter(entityId, 'local', reservation.reservationId, run.snapshot().revision)
    try {
      writer.bindDecisionAdmission(() => Promise.resolve())
      await writer.activate(simulationWriterActivationSchema.parse({ ...reservation, activationId: 'source-activation' }))
      for (const [id, quantity] of [['left', '1'], ['right', '0']]) {
        await run.createResource(simulationResourceSpecSchema.parse({ id, owner: entityId, kind: 'money', unit: 'token',
          quantity, controllers: [entityId] }), run.snapshot().revision)
      }
      const decisionId = simulationDecisionIdSchema.parse('source-decision')
      await writer.openDecision(decisionId, run.snapshot().revision)
      const accepted = await writer.submitDecision(decisionId, [simulationProposalSchema.parse({ after: [],
        action: { kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
          reads: [{ resourceId: 'left', revision: 1 }, { resourceId: 'right', revision: 1 }],
          transfers: [{ from: 'left', to: 'right', quantity: '1' }] } } })])
      const operationId = accepted.operationIds[0]
      if (operationId === undefined) throw new Error('Durable source decision has no accepted transfer')
      await run.executeOperation(operationId)
    } finally { await writer.revoke(); await writer.release() }
    console.log(JSON.stringify(run.snapshot()))
    process.send?.('durable')
    await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
    await run.close()
  } else {
    const credential = ctx.productPrincipals.bootstrapCredential('local')
    const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential })
    try {
      const api = createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
      const output = await lease.withCall(async (call) => {
        const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call }))
        const first = await client.simulations.list({})
        const inspect = await client.simulations.inspect({ runId: simulationProductRunIdSchema.parse('public-run') })
        const privateRun = await client.simulations.inspect({ runId: simulationProductRunIdSchema.parse('private-run') })
        const missing = await client.simulations.inspect({ runId: simulationProductRunIdSchema.parse('absent') })
        const runId = simulationProductRunIdSchema.parse('public-run')
        const records = await client.simulations.records({ runId, mode: 'original', kind: 'run/change', limit: 1 })
        const entities = await client.simulations.browse({ runId, collection: 'entities' })
        const decisions = await client.simulations.browse({ runId, collection: 'decisions' })
        const operations = await client.simulations.browse({ runId, collection: 'operations' })
        const checkpoints = await client.simulations.browse({ runId, collection: 'checkpoints' })
        const detail = await client.simulations.inspectObject({ runId, collection: 'decisions',
          id: simulationDecisionIdSchema.parse('source-decision'), section: 'execution' })
        return { first: first.result, inspect: inspect.result, privateRun: privateRun.result, missing: missing.result,
          records: records.result, entities: entities.result, decisions: decisions.result, operations: operations.result,
          checkpoints: checkpoints.result, detail: detail.result }
      })
      console.log(JSON.stringify(output))
    } finally { await lease.revoke() }
  }
} finally { await ctx.fiber.dispose() }
