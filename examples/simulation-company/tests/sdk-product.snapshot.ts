/** Real Loader, authenticated SDK stdio and native journals preserve creation identity without inference. */
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { HarnessClient } from '@clocky/clocky-sdk-client'
import type { SimulationCreateParams } from '@clocky/clocky-sdk-client'
import { templateJSON } from './sdk-product-template.ts'

it.each(['json', 'sqlite'])('reads and prepares company runs over the authenticated SDK (%s)', async (backend) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/sdk-company-product-'))
  await mkdir(resolve(root, 'sessions'))
  const launch = resolveExampleLaunch({ srcBin: resolve('packages/examples/jsonrpc-demo/src/bin.ts'),
    libBin: resolve('packages/examples/jsonrpc-demo/lib/bin.js'), tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/sdk-product/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, COMPANY_PRODUCT_TEMPLATES: templateJSON } })
  const open = () => new HarnessClient({ command: launch.command, args: launch.args,
    env: { ...process.env as Record<string, string>, ...launch.env }, requestTimeoutMs: 30000 })
  const initialize = (client: HarnessClient) => client.initialize({ credential: 'sdk-company-test-credential',
    cwd: process.cwd(), provider: 'company', model: 'scripted' })
  let sdk = open()
  const input: SimulationCreateParams = { commandId: 'sdk-original', templateId: 'company', templateVersion: '1', expectedModel: { provider: 'company', name: 'scripted' }, name: 'SDK company',
    parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } }
  const settled = async (commandId: string) => {
    for (let round = 0; round < 200; round++) {
      const result = await sdk.getSimulationRequest({ commandId })
      if (result.status === 'found' && result.request.status !== 'accepted') return result.request
      await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    }
    throw new Error('SDK preparation has no terminal receipt')
  }
  try {
    await initialize(sdk)
    expect((await sdk.simulationCatalog()).items[0]).toMatchObject({ id: 'company', execution: 'cognition-only' })
    expect(await sdk.getSimulationRequest({ commandId: input.commandId })).toEqual({ status: 'not-found', commandId: input.commandId })
    const receipt = await sdk.createSimulation(input)
    expect((await settled(input.commandId)).status).toBe('completed')
    expect((await sdk.createSimulation(input)).runId).toBe(receipt.runId)
    expect((await sdk.listSimulations()).items).toHaveLength(1)
    const original = await sdk.inspectSimulation({ runId: receipt.runId })
    const journal = await sdk.readSimulationRecords({ runId: receipt.runId, mode: 'metadata', limit: 1 })
    expect(journal.items).toHaveLength(1)
    expect(journal.items[0]?.sequence).toBe(0)
    expect(journal.items[0]?.body.status).toBe('withheld')
    const originalRecord = await sdk.readSimulationRecords({ runId: receipt.runId, mode: 'original', sequence: 0,
      expectedRevision: journal.snapshotRevision })
    expect(originalRecord.bodyAccess).toBe('allowed')
    const originalJSON = originalRecord.items.map(item => item.body.status === 'text' ? item.body.text : '').join('')
    expect(JSON.parse(originalJSON)).toMatchObject({ kind: 'run/created', spec: { tickUnit: 'minute' } })
    expect((await sdk.inspectSimulation({ runId: receipt.runId })).world?.revision).toBe(original.world?.revision)
    expect(original.world).toMatchObject({ phase: 'paused', time: '0', entityCount: 2, decisionCount: 0 })
    const entities = await sdk.browseSimulation({ runId: receipt.runId, collection: 'entities', limit: 1 })
    expect(entities.collection).toBe('entities'); expect(entities.total).toBe(2)
    const next = await sdk.browseSimulation({ runId: receipt.runId, collection: 'entities', limit: 1, cursor: entities.nextCursor })
    expect(next.items[0]?.id).not.toBe(entities.items[0]?.id)
    const detail = await sdk.inspectSimulationObject({ runId: receipt.runId, collection: 'entities', id: entities.items[0]!.id,
      section: 'identity', expectedRevision: entities.snapshotRevision })
    expect(detail.status).toBe('found')
    expect((await sdk.browseSimulation({ runId: receipt.runId, collection: 'decisions' })).total).toBe(0)
    expect((await sdk.browseSimulation({ runId: receipt.runId, collection: 'operations' })).total).toBe(0)
    const checkpoints = await sdk.browseSimulation({ runId: receipt.runId, collection: 'checkpoints' })
    expect(checkpoints.total).toBe(1)
    expect((await sdk.inspectSimulationObject({ runId: receipt.runId, collection: 'checkpoints', id: checkpoints.items[0]!.id,
      section: 'references', limit: 1 })).status).toBe('found')
    await expect(sdk.inspectSimulation({ runId: 'hidden-or-missing' }))
      .rejects.toMatchObject({ data: { code: 'SIMULATION_PRODUCT_FORBIDDEN' } })
    await expect(sdk.createSimulation({ ...input, name: 'Changed payload' }))
      .rejects.toMatchObject({ data: { code: 'SIMULATION_PRODUCT_INVALID' } })
    await sdk.close()
    sdk = open()
    await initialize(sdk)
    expect((await sdk.inspectSimulation({ runId: receipt.runId })).world?.owner).toBe('unowned')
    expect((await sdk.getSimulationRequest({ commandId: input.commandId })).status).toBe('found')
    expect((await sdk.createSimulation(input)).status).toBe('completed')
    const prepare = { runId: receipt.runId, commandId: 'sdk-explicit-prepare' }
    await sdk.prepareSimulation(prepare)
    expect((await settled(prepare.commandId)).status).toBe('completed')
    expect((await sdk.browseSimulation({ runId: receipt.runId, collection: 'checkpoints' })).total).toBe(2)
    expect((await sdk.listSimulations()).items).toHaveLength(1)
    expect((await readdir(resolve(root, 'sessions'))).filter(name => !name.startsWith('.'))).toEqual([])
    expect({ identityRetainedAfterRestart: true, createRetryStatus: 'completed', explicitPreparation: 'completed',
      runs: 1, phase: 'paused', time: original.world?.time, entities: 2, decisions: 0, initialAndPreparationCheckpoints: 2,
      publicKnowledge: 'withheld', nativeSessions: 0 }).toMatchSnapshot()
  } finally { await sdk.close(); await rm(root, { recursive: true, force: true }) }
})
