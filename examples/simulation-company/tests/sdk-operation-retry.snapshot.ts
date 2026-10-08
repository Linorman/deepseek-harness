/** Real authenticated SDK/Loader retries retain original grants and reconcile one durable target without duplicating model effects. */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { HarnessClient, RequestTimeoutError } from '@clocky/clocky-sdk-client'
import type { SimulationOperationRetryParams } from '@clocky/clocky-sdk-client'
import { templateJSON } from './sdk-product-template.ts'

it.each(['json', 'sqlite'])('grants and reconciles an unknown outbox operation through actual SDK stdio (%s)', async (backend) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/sdk-operation-retry-'))
  await mkdir(resolve(root, 'sessions'))
  const templates = JSON.parse(templateJSON) as Array<{ spec: Record<string, unknown> }>
  if (templates[0] === undefined) throw new Error('Operation retry fixture has no installed template')
  templates[0].spec.outboxMaxAttempts = 1
  const launch = resolveExampleLaunch({ srcBin: resolve('packages/examples/jsonrpc-demo/src/bin.ts'),
    libBin: resolve('packages/examples/jsonrpc-demo/lib/bin.js'), tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/sdk-operation-retry/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, COMPANY_PRODUCT_TEMPLATES: JSON.stringify(templates) } })
  const open = (fault = false) => new HarnessClient({ command: launch.command, args: launch.args,
    env: { ...process.env as Record<string, string>, ...launch.env, SDK_OPERATION_TARGET_FAULT: String(fault),
      SDK_OPERATION_DROP_RESPONSE: String(fault) }, requestTimeoutMs: 30000 })
  const initialize = (sdk: HarnessClient) => sdk.initialize({ credential: 'sdk-company-test-credential', cwd: process.cwd(),
    provider: 'company', model: 'scripted' })
  let sdk = open(true)
  const models = async (): Promise<number> => (JSON.parse(await readFile(resolve(root, 'sdk-operation-model-count.json'), 'utf8')) as { requests: number }).requests
  const wait = async <T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> => {
    for (let round = 0; round < 1000; round++) {
      const value = await read()
      if (done(value)) return value
      await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    }
    throw new Error('SDK operation retry scenario did not reach the authoritative expected state')
  }
  const settled = async (commandId: string) => {
    const result = await wait(() => sdk.getSimulationRequest({ commandId }), value => value.status === 'found' && value.request.status !== 'accepted')
    if (result.status !== 'found') throw new Error('Original operation result disappeared')
    return result
  }
  try {
    await initialize(sdk)
    const created = await sdk.createSimulation({ commandId: 'sdk-operation-create', templateId: 'company', templateVersion: '1', expectedModel: { provider: 'company', name: 'scripted' },
      name: 'Unknown publication company', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
    const runId = created.runId
    expect((await settled(created.commandId)).request.status).toBe('completed')
    await sdk.manageSimulation({ runId, managementId: 'sdk-operation-start', phase: 'running' })
    const unknown = await wait(() => sdk.browseSimulation({ runId, collection: 'operations', status: 'outcome-unknown' }), value => value.items.length === 1)
    const operation = unknown.items[0]
    if (unknown.collection !== 'operations' || operation === undefined) throw new Error('SDK has no exact unknown operation')
    const details = await sdk.inspectSimulationObject({ runId, collection: 'operations', id: operation.id, section: 'execution' })
    if (details.value?.collection !== 'operations' || details.value.section !== 'execution' || details.value.outbox === undefined) {
      throw new Error('Unknown operation has no retained outbox attempt metadata')
    }
    const original: SimulationOperationRetryParams = { runId, commandId: 'sdk-operation-retry', operationId: operation.id,
      expectedAttemptCount: details.value.outbox.attemptCount, reason: 'Reconcile the original committed target receipt' }
    expect(original.expectedAttemptCount).toBe(1)
    const beforeModels = await models()
    const request = sdk.request.bind(sdk)
    sdk.request = (method, input, timeout) => request(method, input, method === 'simulation/operation-retry' ? 100 : timeout)
    await expect(sdk.retrySimulationOperation(original)).rejects.toBeInstanceOf(RequestTimeoutError)
    sdk.request = request
    const result = await settled(original.commandId)
    expect(result).toMatchObject({ request: { kind: 'retry-operation', status: 'completed' }, retryOperation: original })
    expect(await sdk.retrySimulationOperation(original)).toEqual(result.request)
    await expect(sdk.retrySimulationOperation({ ...original, operationId: 'another-operation' }))
      .rejects.toMatchObject({ data: { code: 'SIMULATION_PRODUCT_INVALID' } })
    await expect(sdk.retrySimulationOperation({ ...original, reason: 'Changed original reason' }))
      .rejects.toMatchObject({ data: { code: 'SIMULATION_PRODUCT_INVALID' } })
    await expect(sdk.retrySimulationOperation({ ...original, expectedAttemptCount: original.expectedAttemptCount + 1 }))
      .rejects.toMatchObject({ data: { code: 'SIMULATION_PRODUCT_INVALID' } })
    expect(await models()).toBe(beforeModels)
    const authorized = await sdk.inspectSimulationObject({ runId, collection: 'operations', id: operation.id, section: 'execution' })
    expect(authorized.value).toMatchObject({ collection: 'operations', summary: { status: 'pending' }, outbox: { attemptCount: 1 } })
    expect(['paused', 'stalled']).toContain((await sdk.getSimulationControl({ runId })).phase)
    await sdk.close(); sdk = open(); await initialize(sdk)
    expect(await sdk.getSimulationRequest({ commandId: original.commandId })).toEqual(result)
    expect(await sdk.retrySimulationOperation(original)).toEqual(result.request)
    expect((await sdk.getSimulationControl({ runId })).owner).toBe('not-held')
    expect((await sdk.inspectSimulation({ runId })).world?.owner).toBe('unowned')
    expect(await models()).toBe(0)
    await expect(sdk.retrySimulationOperation({ ...original, commandId: 'cold-new-grant' }))
      .rejects.toMatchObject({ data: { code: 'SIMULATION_PRODUCT_UNAVAILABLE' } })
    await sdk.restoreSimulation({ runId, commandId: 'sdk-operation-restore', checkpointId: `product-initial/${created.commandId}` })
    expect((await settled('sdk-operation-restore')).request.status).toBe('completed')
    expect((await sdk.getSimulationControl({ runId })).phase).toBe('paused')
    expect(await models()).toBe(0)
    await sdk.manageSimulation({ runId, managementId: 'sdk-operation-explicit-resume', phase: 'running' })
    await wait(() => sdk.getSimulationControl({ runId }), value => value.driver === 'completed')
    const completed = await sdk.inspectSimulationObject({ runId, collection: 'operations', id: operation.id, section: 'execution' })
    expect(completed.value).toMatchObject({ collection: 'operations', summary: { status: 'applied' }, outbox: { attemptCount: 2 } })
    expect(await sdk.retrySimulationOperation(original)).toEqual(result.request)
    const afterOldRetry = await sdk.inspectSimulationObject({ runId, collection: 'operations', id: operation.id, section: 'execution' })
    expect(afterOldRetry.value).toEqual(completed.value)
    const all = await sdk.browseSimulation({ runId, collection: 'operations', limit: 32 })
    if (all.collection !== 'operations') throw new Error('Operations page belongs to another collection')
    expect(all.items.filter(item => item.kind.text === 'resource/transfer' && item.status === 'applied')).toHaveLength(1)
    const target = JSON.parse(await readFile(resolve(root, 'sdk-operation-target.json'), 'utf8')) as {
      envelopes: Array<{ id: string; sequence: number }>
    }
    expect(target.envelopes).toHaveLength(2)
    expect(target.envelopes[1]).toEqual(target.envelopes[0])
    expect({ originalGrantResponse: 'lost', originalInputRetained: true, grantAndQueryInference: false, grantPublishesTarget: false,
      coldReadsAcquireOwner: false, restoreInference: false, explicitResume: 'completed', originalOperationIdentity: true,
      observedAttemptCounts: [1, 2], targetEnvelopes: 1, oldGrantAllocatesAnotherBudget: false, inventoryTransfers: 1 }).toMatchSnapshot()
  } finally { await sdk.close(); await rm(root, { recursive: true, force: true }) }
})
