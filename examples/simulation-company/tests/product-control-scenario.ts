/** Real authenticated Host control reaches production background batches, pause, immutable retry and cold read-only observation. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import { boot } from '@clocky/clocky-app-boot'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductCreateInputSchema, simulationProductManageInputSchema, simulationProductManagementInputSchema }
  from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductControl, SimulationProductRunId } from '@clocky/clocky-simulation-product/types'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { templateJSON } from './sdk-product-template.ts'
import { entered, released, requests } from './product-control-model.ts'

process.env.COMPANY_PRODUCT_TEMPLATES = templateJSON
const ctx = await boot('company-product-control', process.argv[2]!)
const call: AuthenticatedProductCall = { principal: { id: 'reader' as never, issuer: 'scenario', subject: 'reader',
  assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
const client = new InProcessApiClient(toFetchHandler(createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined }),
  { authenticatedProductCall: call }))
const create = simulationProductCreateInputSchema.parse({ commandId: 'control-create', templateId: 'company', templateVersion: '1',
  expectedModel: { provider: 'company', name: 'scripted' },
  name: 'Controlled company', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
const management = (runId: SimulationProductRunId, managementId: string, phase: 'running' | 'paused' = 'running') =>
  simulationProductManageInputSchema.parse({ runId, managementId, phase })
const readControl = async (runId: SimulationProductRunId) => {
  const value = await client.simulations.control({ runId }); assert.ok(value.result.ok); return value.result.value
}
const wait = async (runId: SimulationProductRunId, predicate: (value: SimulationProductControl) => boolean) => {
  for (let round = 0; round < 500; round++) {
    const control = await readControl(runId)
    if (predicate(control)) return control
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
  }
  throw new Error('Product background driver did not settle')
}
const proof = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'product-control-id.json')
try {
  if (process.env.COMPANY_CONTROL_RESTART === 'true') {
    const { runId } = JSON.parse(await readFile(proof, 'utf8')) as { runId: SimulationProductRunId }
    assert.equal(requests.length, 0)
    const control = await readControl(runId)
    assert.equal(control.owner, 'not-held'); assert.equal(control.phase, 'paused'); assert.equal(control.actions.start.allowed, false)
    const old = await client.simulations.manage(management(runId, 'start'))
    assert.ok(old.result.ok); assert.equal(old.result.value.operation.phase, 'running'); assert.equal(old.result.value.control.phase, 'paused')
    const known = await client.simulations.managementRequest(simulationProductManagementInputSchema.parse({ runId, managementId: 'resume' }))
    assert.ok(known.result.ok); assert.equal(known.result.value.status, 'found')
    const denied = await client.simulations.manage(management(runId, 'unrecovered-start'))
    assert.ok(!denied.result.ok); assert.equal(denied.result.error.code, 'simulation-product-unavailable')
    assert.equal(requests.length, 0)
    console.log(JSON.stringify({ coldOwner: 'not-held', phase: 'paused', historicalStart: 'running',
      originalResume: 'found', requiresRecovery: true, modelRequests: 0 }))
  } else {
    const receipt = await client.simulations.create(create)
    assert.ok(receipt.result.ok)
    const runId = receipt.result.value.runId
    for (let round = 0; round < 500; round++) {
      const current = await client.simulations.request({ commandId: create.commandId })
      assert.ok(current.result.ok)
      if (current.result.value.status === 'found' && current.result.value.request.status === 'completed') break
      await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    }
    assert.equal((await readControl(runId)).phase, 'paused'); assert.equal(requests.length, 0)
    const start = await client.simulations.manage(management(runId, 'start'))
    assert.ok(start.result.ok); assert.equal(start.result.value.operation.status, 'completed')
    await entered.promise
    const pause = await client.simulations.manage(management(runId, 'pause', 'paused'))
    assert.ok(pause.result.ok); assert.equal(pause.result.value.control.phase, 'paused'); assert.equal(pause.result.value.control.inFlight, true)
    released.resolve(undefined)
    await wait(runId, value => !value.inFlight)
    const before = requests.length
    const retry = await client.simulations.manage(management(runId, 'start'))
    assert.ok(retry.result.ok); assert.equal(retry.result.value.control.phase, 'paused'); assert.equal(requests.length, before)
    const resume = await client.simulations.manage(management(runId, 'resume'))
    assert.ok(resume.result.ok)
    const completed = await wait(runId, value => value.driver === 'completed')
    assert.equal(completed.inFlight, false); assert.equal(completed.actions.start.reason, 'scenario-completed')
    assert.ok(requests.length > before)
    const creation = ctx.simulationProducts
    const entityPage = await creation.browse({ runId, collection: 'entities' }, call)
    assert.equal(entityPage.total, 2)
    const stopped = await client.simulations.manage(management(runId, 'final-pause', 'paused'))
    assert.ok(stopped.result.ok); assert.equal(stopped.result.value.control.phase, 'paused')
    const input = simulationProductManagementInputSchema.parse({ runId, managementId: 'resume' })
    const original = await client.simulations.managementRequest(input)
    assert.ok(original.result.ok); assert.equal(original.result.value.status, 'found')
    const directory = await client.simulations.list({})
    assert.ok(directory.result.ok); assert.equal(directory.result.value.items.length, 1)
    const observation = await client.simulations.inspect({ runId })
    assert.ok(observation.result.ok); assert.equal(observation.result.value.world?.phase, 'paused')
    const operations = await creation.browse({ runId, collection: 'operations' }, call)
    assert.equal(operations.collection, 'operations')
    assert.ok(operations.items.every(value => value.status === 'applied'))
    assert.ok(operations.items.some(value => value.kind.text === 'resource/transfer'))
    const templates = JSON.parse(templateJSON) as Array<{ spec: Record<string, unknown> }>
    const template = templates[0]
    assert.ok(template)
    const spec = simulationRunSpecSchema.parse({ ...template.spec, runId })
    const native = await ctx.simulations.inspect(ctx.simulations.resolveInspection({ provider: 'local', spec }))
    assert.ok(native)
    assert.equal(native.snapshot.resources['stock' as never]?.quantity, '1')
    assert.equal(native.snapshot.resources['received' as never]?.quantity, '1')
    assert.ok(requests.every(value => value.tools.join(',') === 'simulation_observe,simulation_stage,simulation_submit'))
    await writeFile(proof, JSON.stringify({ runId }))
    console.log(JSON.stringify({ preparedWithoutInference: true, pausedDuringInference: true, originalRetryKeptPause: true,
      driver: 'completed', phase: 'paused', entities: 2, stock: '1', received: '1', appliedOperations: operations.total,
      scopedToolsOnly: true, originalResume: 'found', directoryRuns: 1 }))
  }
} finally { released.resolve(undefined); await ctx.fiber.dispose() }
