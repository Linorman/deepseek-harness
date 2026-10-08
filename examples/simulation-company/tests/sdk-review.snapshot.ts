/** Keyless production Loader/SDK stdio review preserves original commands, canonical attempts and cold suffix facts. */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { HarnessClient, RequestTimeoutError } from '@clocky/clocky-sdk-client'
import type { SimulationTaskReviewResolveParams } from '@clocky/clocky-sdk-client'
import { reviewTemplateJSON } from './sdk-review-template.ts'

it.each(['json', 'sqlite'])('reviews and restores company attempts through production SDK stdio (%s)', async (backend) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/sdk-company-review-'))
  await mkdir(resolve(root, 'sessions'))
  const launch = resolveExampleLaunch({ srcBin: resolve('packages/examples/jsonrpc-demo/src/bin.ts'),
    libBin: resolve('packages/examples/jsonrpc-demo/lib/bin.js'), tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/sdk-review/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, COMPANY_PRODUCT_TEMPLATES: reviewTemplateJSON } })
  const open = (drop = false) => new HarnessClient({ command: launch.command, args: launch.args,
    env: { ...process.env as Record<string, string>, ...launch.env, SDK_REVIEW_DROP_RESPONSE: String(drop) }, requestTimeoutMs: 30000 })
  const initialize = (sdk: HarnessClient) => sdk.initialize({ credential: 'sdk-company-test-credential',
    cwd: process.cwd(), provider: 'company', model: 'scripted' })
  let sdk = open(true)
  const modelCount = async (): Promise<number> => {
    const audit = JSON.parse(await readFile(resolve(root, 'sdk-review-model-count.json'), 'utf8')) as { requests: number }
    return audit.requests
  }
  const wait = async <T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> => {
    for (let round = 0; round < 1000; round++) {
      const value = await read()
      if (ready(value)) return value
      await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    }
    throw new Error('SDK review scenario did not reach its authoritative state')
  }
  const settled = async (commandId: string) => {
    const value = await wait(() => sdk.getSimulationRequest({ commandId }),
      value => value.status === 'found' && value.request.status !== 'accepted')
    if (value.status !== 'found') throw new Error('Original command result disappeared')
    return value
  }
  try {
    await initialize(sdk)
    expect((await sdk.simulationCatalog()).items[0]).toMatchObject({ review: 'buyer', execution: 'automatic-tasks' })
    const created = await sdk.createSimulation({ commandId: 'sdk-review-create', templateId: 'company', templateVersion: '1', expectedModel: { provider: 'company', name: 'scripted' },
      name: 'SDK reviewed company', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
    const runId = created.runId
    expect((await settled(created.commandId)).request.status).toBe('completed')
    const initialStatuses = await sdk.getSimulationRunStatuses({ runIds: [runId] })
    expect(initialStatuses.modelPool).toMatchObject({ status: 'observed', clock: 'real', active: 0, queued: 0 })
    expect(initialStatuses.items[0]).toMatchObject({ status: 'observed', world: {
      rulesVersion: { text: '1' }, policyVersion: { text: '1' }, metrics: { budgets: { tokens: { charged: 0 } },
        residentSlots: { used: 0, limit: 2 }, pendingDecisionCount: 0, pendingExternalOperationCount: 0 },
    }, operational: { status: 'observed', owner: 'held', scenario: { status: 'observed', templateId: { text: 'company' } } } })
    await sdk.manageSimulation({ runId, managementId: 'sdk-review-start', phase: 'running' })
    const firstPage = await wait(() => sdk.listSimulationTaskReviews({ runId }), value => value.items.some(item => item.action.allowed))
    const first = firstPage.items.find(item => item.action.allowed)
    if (first?.evidence === undefined) throw new Error('First reviewed attempt has no scene evidence')
    const rework: SimulationTaskReviewResolveParams = { runId, commandId: 'sdk-review-rework', operationId: first.operationId,
      attemptId: first.attemptId, expectedRevision: first.taskRevision, nextPhase: 'pending', reason: 'Revise the delivered report' }
    const request = sdk.request.bind(sdk)
    sdk.request = (method, input, timeout) => request(method, input, method === 'simulation/task-reviews-resolve' ? 100 : timeout)
    await expect(sdk.resolveSimulationTaskReview(rework)).rejects.toBeInstanceOf(RequestTimeoutError)
    sdk.request = request
    const originalRework = await settled(rework.commandId)
    expect(originalRework).toMatchObject({ request: { kind: 'review', status: 'completed' }, review: rework })
    const secondPage = await wait(() => sdk.listSimulationTaskReviews({ runId }),
      value => value.items.some(item => item.action.allowed && item.attemptId !== first.attemptId))
    const second = secondPage.items.find(item => item.action.allowed && item.attemptId !== first.attemptId)
    if (second?.evidence === undefined) throw new Error('Rework attempt has no new report evidence')
    expect(second.attemptCount).toBe(2)
    if (second.evidence.inventoryTransfer === undefined || first.evidence.inventoryTransfer === undefined) {
      throw new Error('Procurement review requires its original inventory evidence')
    }
    expect(second.evidence.inventoryTransfer.operationId).toBe(first.evidence.inventoryTransfer.operationId)
    expect(second.evidence.report.operationId).not.toBe(first.evidence.report.operationId)
    expect(await sdk.resolveSimulationTaskReview(rework)).toEqual(originalRework.request)
    const retried = await sdk.listSimulationTaskReviews({ runId })
    expect(retried.items[0]?.taskRevision).toBe(second.taskRevision)
    expect(retried.items[0]?.phase).toBe('review')
    await sdk.manageSimulation({ runId, managementId: 'sdk-review-pause', phase: 'paused' })
    const beforeApproval = await sdk.inspectSimulation({ runId })
    const beforeModels = await modelCount()
    const approve: SimulationTaskReviewResolveParams = { runId, commandId: 'sdk-review-approve', operationId: second.operationId,
      attemptId: second.attemptId, expectedRevision: second.taskRevision, nextPhase: 'completed', reason: 'Approved the revised report' }
    await sdk.resolveSimulationTaskReview(approve)
    const originalApproval = await settled(approve.commandId)
    expect(originalApproval).toMatchObject({ request: { kind: 'review', status: 'completed' }, review: approve })
    const approved = await sdk.listSimulationTaskReviews({ runId })
    expect(approved.items[0]).toMatchObject({ phase: 'completed', attemptCount: 2 })
    const afterApproval = await sdk.inspectSimulation({ runId })
    expect(afterApproval.world?.phase).toBe('paused')
    expect(afterApproval.world?.decisionCount).toBe(beforeApproval.world?.decisionCount)
    expect(await modelCount()).toBe(beforeModels)
    await sdk.checkpointSimulation({ runId, commandId: 'sdk-review-cut' })
    expect((await settled('sdk-review-cut')).request.status).toBe('completed')
    const retained = await sdk.inspectSimulation({ runId })
    await sdk.close(); sdk = open(); await initialize(sdk)
    expect(await sdk.getSimulationRequest({ commandId: rework.commandId })).toEqual(originalRework)
    expect(await sdk.getSimulationRequest({ commandId: approve.commandId })).toEqual(originalApproval)
    expect(await sdk.resolveSimulationTaskReview(rework)).toEqual(originalRework.request)
    const coldStatuses = await sdk.getSimulationRunStatuses({ runIds: [runId] })
    expect(coldStatuses.modelPool).toMatchObject({ status: 'observed', clock: 'real', active: 0 })
    expect(coldStatuses.items[0]?.operational).toMatchObject({ owner: 'not-held', driver: 'idle', inFlight: false })
    const cold = await sdk.getSimulationControl({ runId })
    expect(cold).toMatchObject({ owner: 'not-held', phase: 'paused' })
    expect((await sdk.listSimulationTaskReviews({ runId })).items[0]).toMatchObject({ phase: 'completed', action: { reason: 'recovery-required' } })
    expect((await sdk.inspectSimulation({ runId })).world?.owner).toBe('unowned')
    expect(await modelCount()).toBe(0)
    await expect(sdk.resolveSimulationTaskReview({ ...approve, commandId: 'cold-new-review' })).rejects.toMatchObject({ data: { code: 'SIMULATION_PRODUCT_UNAVAILABLE' } })
    await sdk.restoreSimulation({ runId, commandId: 'sdk-review-restore', checkpointId: `product-initial/${created.commandId}` })
    expect((await settled('sdk-review-restore')).request.status).toBe('completed')
    const restored = await sdk.inspectSimulation({ runId })
    expect(restored.world?.phase).toBe('paused')
    expect(restored.world?.time).toBe(retained.world?.time)
    expect(restored.world?.decisionCount).toBe(retained.world?.decisionCount)
    expect(await modelCount()).toBe(0)
    expect((await sdk.listSimulationTaskReviews({ runId })).items[0]?.taskRevision).toBe(approved.items[0]?.taskRevision)
    await sdk.manageSimulation({ runId, managementId: 'sdk-review-resume', phase: 'running' })
    await wait(() => sdk.getSimulationControl({ runId }), value => value.driver === 'completed')
    const operations = await sdk.browseSimulation({ runId, collection: 'operations', limit: 32 })
    if (operations.collection !== 'operations') throw new Error('SDK operation page belongs to another collection')
    expect(operations.nextCursor).toBeUndefined()
    expect(operations.items.filter(item => item.kind.text === 'resource/transfer' && item.status === 'applied')).toHaveLength(1)
    expect((await sdk.listSimulationTaskReviews({ runId })).items[0]).toMatchObject({ phase: 'completed', attemptCount: 2 })
    expect({ originalReworkResponse: 'lost', originalQueryRetainsInput: true, oldRetryCannotReviewNewAttempt: true,
      attempts: 2, appliedInventoryTransfers: 1, eachAttemptOwnsPersistedReport: true, pausedApprovalInference: false,
      coldOriginalReadsAcquireOwner: false, explicitRestore: 'paused', rollback: false, restoredReviewRevisionRetained: true,
      explicitResume: 'completed' }).toMatchSnapshot()
  } finally { await sdk.close(); await rm(root, { recursive: true, force: true }) }
})
