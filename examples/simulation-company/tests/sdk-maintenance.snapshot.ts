/** Production SDK stdio controls, input consumption and full recovery preserve original facts across cold restart. */
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { HarnessClient } from '@clocky/clocky-sdk-client'
import { templateJSON } from './sdk-product-template.ts'

it.each(['json', 'sqlite'])('controls, checkpoints and restores company runs through the SDK (%s)', async (backend) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/sdk-company-maintenance-'))
  await mkdir(resolve(root, 'sessions'))
  const launch = resolveExampleLaunch({ srcBin: resolve('packages/examples/jsonrpc-demo/src/bin.ts'),
    libBin: resolve('packages/examples/jsonrpc-demo/lib/bin.js'), tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/sdk-maintenance/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, COMPANY_PRODUCT_TEMPLATES: templateJSON } })
  const open = () => new HarnessClient({ command: launch.command, args: launch.args,
    env: { ...process.env as Record<string, string>, ...launch.env }, requestTimeoutMs: 30000 })
  const initialize = (client: HarnessClient) => client.initialize({ credential: 'sdk-company-test-credential',
    cwd: process.cwd(), provider: 'company', model: 'scripted' })
  let sdk = open()
  const settled = async (commandId: string) => {
    for (let round = 0; round < 500; round++) {
      const result = await sdk.getSimulationRequest({ commandId })
      if (result.status === 'found' && result.request.status !== 'accepted') return result.request
      await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    }
    throw new Error('SDK maintenance has no terminal receipt')
  }
  try {
    await initialize(sdk)
    const created = await sdk.createSimulation({ commandId: 'sdk-maintained', templateId: 'company', templateVersion: '1',
      name: 'Maintained SDK company', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
    const runId = created.runId
    expect((await settled(created.commandId)).status).toBe('completed')
    const initialWatch = await sdk.watchSimulation({ runId, waitMs: 0 })
    expect(initialWatch.status).toBe('changed')
    expect(initialWatch.world.status).toBe('observed')
    expect(await sdk.getSimulationControl({ runId })).toMatchObject({ phase: 'paused', owner: 'held', inFlight: false })
    expect((await readdir(resolve(root, 'sessions'))).filter(name => !name.startsWith('.'))).toEqual([])
    const input = { runId, ingressId: 'sdk-input', entityId: 'buyer', text: 'Consume the authorized input', availableAt: '7' }
    const pending = await sdk.ingressSimulation(input)
    expect(pending).toMatchObject({ status: 'pending', assignedAt: '7' })
    expect(await sdk.ingressSimulation(input)).toEqual(pending)
    await expect(sdk.ingressSimulation({ ...input, text: 'Changed original' }))
      .rejects.toMatchObject({ data: { code: 'SIMULATION_PRODUCT_INVALID' } })
    expect((await sdk.getSimulationManagement({ runId, managementId: 'sdk-start' })).status).toBe('not-found')
    const start = { runId, managementId: 'sdk-start', phase: 'running' as const }
    const started = await sdk.manageSimulation(start)
    let completed = false
    for (let round = 0; round < 500; round++) {
      if ((await sdk.getSimulationControl({ runId })).driver === 'completed') { completed = true; break }
      await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    }
    expect(completed).toBe(true)
    const consumed = await sdk.getSimulationIngress({ runId, ingressId: input.ingressId })
    expect(consumed.status).toBe('found')
    if (consumed.status !== 'found') throw new Error('Original input disappeared')
    expect(consumed.receipt).toMatchObject({ status: 'consumed', availableAt: '7' })
    expect(consumed.receipt.decisionId).toBeTruthy()
    expect(JSON.stringify(consumed)).not.toContain(input.text)
    const context = await sdk.inspectSimulationObject({ runId, collection: 'decisions', id: consumed.receipt.decisionId!, section: 'context', limit: 2 })
    if (context.value?.section !== 'context') throw new Error('SDK decision has no frozen context section')
    expect(context.value.bodyAccess).toBe('withheld')
    expect(context.value.frozen?.entityId).toBe('buyer')
    expect(JSON.stringify(context)).not.toContain(input.text)
    const knowledge = await sdk.inspectSimulationObject({ runId, collection: 'entities', id: 'buyer', section: 'knowledge', limit: 2 })
    expect(knowledge.value).toMatchObject({ bodyAccess: 'withheld', knowledge: { total: 0, items: [] } })
    const unselected = await sdk.inspectSimulationObject({ runId, collection: 'decisions', id: consumed.receipt.decisionId!,
      section: 'knowledge', reference: { id: 'unselected-private', revision: 1 }, limit: 2 })
    expect(unselected.status).toBe('missing')
    if (context.value.items.nextCursor !== undefined) {
      const next = await sdk.inspectSimulationObject({ runId, collection: 'decisions', id: context.selection.id, section: 'context',
        limit: 2, cursor: context.value.items.nextCursor, expectedRevision: context.snapshotRevision })
      expect(next.value?.section).toBe('context')
    }
    const relations = await sdk.inspectSimulationObject({ runId, collection: 'entities', id: 'buyer', section: 'relationships', limit: 2 })
    expect(relations.value).toMatchObject({ section: 'relationships', relationships: { total: 0, items: [] } })
    const pause = { runId, managementId: 'sdk-pause', phase: 'paused' as const }
    await sdk.manageSimulation(pause)
    expect((await sdk.manageSimulation(start)).operation).toEqual(started.operation)
    expect((await sdk.getSimulationControl({ runId })).phase).toBe('paused')
    const checkpoint = { runId, commandId: 'sdk-full-cut' }
    await sdk.checkpointSimulation(checkpoint)
    const full = await settled(checkpoint.commandId)
    expect(full).toMatchObject({ kind: 'checkpoint', status: 'completed', checkpointId: 'product-checkpoint/sdk-full-cut' })
    expect(await sdk.checkpointSimulation(checkpoint)).toEqual(full)
    const retained = await sdk.inspectSimulation({ runId })
    expect(retained.world?.decisionCount).toBeGreaterThan(0)
    const sessionFiles = (await readdir(resolve(root, 'sessions'))).filter(name => !name.startsWith('.'))
    expect(sessionFiles.length).toBeGreaterThan(0)
    await sdk.close()
    sdk = open(); await initialize(sdk)
    const restartedWatch = await sdk.watchSimulation({ runId, cursor: initialWatch.cursor, waitMs: 0 })
    expect(restartedWatch.status).toBe('reset')
    expect(restartedWatch.readVersion).not.toBe(initialWatch.readVersion)
    expect(await sdk.getSimulationControl({ runId })).toMatchObject({ owner: 'not-held', phase: 'paused' })
    expect((await sdk.getSimulationManagement({ runId, managementId: start.managementId })).status).toBe('found')
    expect((await sdk.manageSimulation(start)).operation).toEqual(started.operation)
    expect((await sdk.getSimulationControl({ runId })).owner).toBe('not-held')
    expect(await sdk.checkpointSimulation(checkpoint)).toEqual(full)
    expect((await sdk.getSimulationIngress({ runId, ingressId: input.ingressId }))).toEqual(consumed)
    await expect(sdk.manageSimulation({ runId, managementId: 'cold-start', phase: 'running' }))
      .rejects.toMatchObject({ data: { code: 'SIMULATION_PRODUCT_UNAVAILABLE' } })
    const restore = { runId, commandId: 'sdk-cold-restore', checkpointId: `product-initial/${created.commandId}` }
    await sdk.restoreSimulation(restore)
    const restored = await settled(restore.commandId)
    expect(restored).toMatchObject({ kind: 'restore', status: 'completed', checkpointId: restore.checkpointId })
    expect(await sdk.restoreSimulation(restore)).toEqual(restored)
    expect(await sdk.getSimulationControl({ runId })).toMatchObject({ owner: 'held', phase: 'paused', inFlight: false })
    const current = await sdk.inspectSimulation({ runId })
    expect(current.world?.time).toBe(retained.world?.time)
    expect(current.world?.decisionCount).toBe(retained.world?.decisionCount)
    expect((await sdk.getSimulationIngress({ runId, ingressId: input.ingressId }))).toEqual(consumed)
    expect((await readdir(resolve(root, 'sessions'))).filter(name => !name.startsWith('.'))).toEqual(sessionFiles)
    expect({ originalStartRetainedAfterPause: true, input: 'consumed', consumptionDecision: true,
      checkpoint: 'completed', coldReadsAcquireOwner: false, recoveredOwner: 'held', recoveredPhase: 'paused',
      rollback: false, recoveryInference: false, privateInput: 'withheld' }).toMatchSnapshot()
  } finally { await sdk.close(); await rm(root, { recursive: true, force: true }) }
})
