/** Real Host maintenance preserves current suffix facts and consumes original inputs through the scoped production driver. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductCreateInputSchema, simulationProductManageInputSchema, simulationProductRestoreInputSchema,
  simulationProductCheckpointInputSchema, simulationProductIngressInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { SimulationProductCommandId } from '@clocky/clocky-simulation-product/types'
import { templateJSON } from './sdk-product-template.ts'
import { released, requests } from './product-control-model.ts'

process.env.COMPANY_PRODUCT_TEMPLATES = templateJSON
const ctx = await boot('company-product-maintenance', process.argv[2]!)
released.resolve(undefined)
const call: AuthenticatedProductCall = { principal: { id: 'reader' as never, issuer: 'scenario', subject: 'reader',
  assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
const client = new InProcessApiClient(toFetchHandler(createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined }),
  { authenticatedProductCall: call }))
const create = simulationProductCreateInputSchema.parse({ commandId: 'maintenance-create', templateId: 'company', templateVersion: '1',
  name: 'Maintained company', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
const proof = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'maintenance-id.json')
const settled = async (commandId: SimulationProductCommandId) => {
  for (let round = 0; round < 500; round++) {
    const response = await client.simulations.request({ commandId }); assert.ok(response.result.ok)
    const value = response.result.value
    if (value.status === 'found' && value.request.status !== 'accepted') return value.request
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
  }
  throw new Error('Native maintenance request did not settle')
}
const hold = async (stage: string, runId: string): Promise<void> => {
  if (process.env.COMPANY_MAINTENANCE_CRASH !== stage) return
  await writeFile(proof, JSON.stringify({ runId, checkpointId: 'product-checkpoint/full-cut' }))
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
const commands = ctx.storageLog.get('control-commands')!
const append = commands.append.bind(commands)
commands.append = async (...args) => {
  const result = await append(...args)
  const entry = args[1][0] as { kind: string; commandId?: string; command?: { kind: string; receipt: { runId: string } } }
  if (entry.kind === 'command/accepted' && entry.command?.kind === 'checkpoint') await hold('accepted', entry.command.receipt.runId)
  if (entry.kind === 'command/completed' && entry.commandId === 'full-cut') {
    const original = JSON.parse(await readFile(proof, 'utf8')) as { runId: string }
    await hold('terminal', original.runId)
  }
  return result
}
const open = ctx.simulations.open.bind(ctx.simulations)
ctx.simulations.open = async (...args) => {
  const run = await open(...args)
  const begin = run.beginCheckpoint.bind(run)
  run.beginCheckpoint = async (request) => {
    const value = await begin(request)
    if (request.id === 'product-checkpoint/full-cut') await hold('native-begin', run.snapshot().spec.runId)
    return value
  }
  return run
}
const attach = ctx.simulationTeams.attach.bind(ctx.simulationTeams)
ctx.simulationTeams.attach = async (...args) => {
  const connection = await attach(...args)
  const checkpoint = connection.checkpoint.bind(connection)
  connection.checkpoint = async (...input) => {
    const value = await checkpoint(...input)
    if (input[0].id === 'product-checkpoint/full-cut') await hold('native-complete', args[0].snapshot().spec.runId)
    return value
  }
  return connection
}
try {
  if (process.env.COMPANY_MAINTENANCE_COLD === 'true') {
    const original = JSON.parse(await readFile(proof, 'utf8')) as { runId: string; checkpointId: string }
    const originalCut = simulationProductCheckpointInputSchema.parse({ runId: original.runId, commandId: 'full-cut' })
    const retry = await client.simulations.checkpoint(originalCut)
    assert.ok(retry.result.ok)
    assert.equal((await settled(originalCut.commandId)).status, 'completed')
    const restore = simulationProductRestoreInputSchema.parse({ ...original, commandId: 'cold-recovery' })
    const receipt = await client.simulations.restore(restore); assert.ok(receipt.result.ok)
    assert.equal((await settled(restore.commandId)).status, 'completed')
    const control = await client.simulations.control({ runId: restore.runId }); assert.ok(control.result.ok)
    assert.equal(control.result.value.phase, 'paused'); assert.equal(control.result.value.owner, 'held')
    const initial = { ...restore, checkpointId: `product-initial/${create.commandId}` as typeof restore.checkpointId,
      commandId: 'old-cut-current-suffix' as typeof restore.commandId }
    await client.simulations.restore(initial)
    assert.equal((await settled(initial.commandId)).status, 'completed')
    const templates = JSON.parse(templateJSON) as Array<{ spec: Record<string, unknown> }>
    const spec = simulationRunSpecSchema.parse({ ...templates[0]!.spec, runId: restore.runId })
    const state = await ctx.simulations.inspect(ctx.simulations.resolveInspection({ provider: 'local', spec }))
    assert.ok(state); assert.equal(state.snapshot.resources['stock' as never]?.quantity, '1')
    assert.equal(state.snapshot.resources['received' as never]?.quantity, '1')
    assert.equal(Object.keys(state.snapshot.ingresses ?? {}).length, 1)
    assert.equal(requests.length, 0)
    console.log(JSON.stringify({ restoredPaused: true, suffixStock: '1', suffixReceived: '1', retainedInputs: 1,
      fullSourceRevalidated: true, modelRequests: 0, rollback: false }))
  } else {
    const created = await client.simulations.create(create); assert.ok(created.result.ok)
    const runId = created.result.value.runId
    assert.equal((await settled(create.commandId)).status, 'completed')
    const input = simulationProductIngressInputSchema.parse({ runId, ingressId: 'authorized-input', entityId: 'buyer',
      text: 'Consume this authorized scenario input.', availableAt: '7' })
    const posted = await client.simulations.ingress(input); assert.ok(posted.result.ok)
    assert.equal(posted.result.value.status, 'pending'); assert.equal(posted.result.value.assignedAt, '7')
    assert.equal(requests.length, 0)
    const retry = await client.simulations.ingress(input); assert.ok(retry.result.ok)
    assert.deepEqual(retry.result.value, posted.result.value)
    const start = simulationProductManageInputSchema.parse({ runId, managementId: 'execute', phase: 'running' })
    const started = await client.simulations.manage(start); assert.ok(started.result.ok)
    let completed = false
    for (let round = 0; round < 500; round++) {
      const control = await client.simulations.control({ runId }); assert.ok(control.result.ok)
      if (control.result.value.driver === 'completed') { completed = true; break }
      await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    }
    assert.ok(completed)
    const consumed = await client.simulations.ingressRequest({ runId, ingressId: input.ingressId }); assert.ok(consumed.result.ok)
    assert.equal(consumed.result.value.status, 'found')
    if (consumed.result.value.status !== 'found') throw new Error('Original input disappeared')
    assert.equal(consumed.result.value.receipt.status, 'consumed')
    assert.ok(consumed.result.value.receipt.decisionId)
    const checkpoint = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'full-cut' })
    await writeFile(proof, JSON.stringify({ runId, checkpointId: 'product-checkpoint/full-cut' }))
    const collecting = await client.simulations.checkpoint(checkpoint); assert.ok(collecting.result.ok)
    const full = await settled(checkpoint.commandId)
    assert.equal(full.status, 'completed'); assert.ok(full.checkpointId)
    const metadata = await client.simulations.control({ runId }); assert.ok(metadata.result.ok)
    assert.equal(metadata.result.value.phase, 'paused'); assert.equal(metadata.result.value.inFlight, false)
    const calls = requests.length
    const original = await client.simulations.checkpoint(checkpoint); assert.ok(original.result.ok)
    assert.deepEqual(original.result.value, full); assert.equal(requests.length, calls)
    await writeFile(proof, JSON.stringify({ runId, checkpointId: full.checkpointId }))
    console.log(JSON.stringify({ preparedPaused: true, pendingAssignedAt: '7', originalInputRetained: true,
      inputConsumed: true, consumptionDecision: true, fullCheckpoint: 'completed', phase: 'paused',
      retiredActors: true, checkpointRetryInferred: false }))
  }
} finally { await ctx.fiber.dispose() }
