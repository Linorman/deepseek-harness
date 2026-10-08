/** TypeScript SDK reconstructs source-backed report continuation from authorized frozen context through real stdio. */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { HarnessClient } from '@clocky/clocky-sdk-client'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { Session, type SessionHeader, type SessionEvent, type SimulationContextViewEventData } from '@clocky/clocky-session'
import { isSimulationContextViewEvent } from '@clocky/clocky-session/surface'
import { executionTemplateJSON } from './sdk-execution-template.ts'

it.each(['json', 'sqlite'])('preserves original report inputs across actual TypeScript SDK process restart (%s)', async (backend) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/sdk-execution-'))
  const launch = resolveExampleLaunch({ srcBin: resolve('packages/examples/jsonrpc-demo/src/bin.ts'),
    libBin: resolve('packages/examples/jsonrpc-demo/lib/bin.js'), tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/sdk-execution/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, COMPANY_PRODUCT_TEMPLATES: executionTemplateJSON } })
  const open = (fault: boolean) => new HarnessClient({ command: launch.command, args: launch.args,
    env: { ...process.env as Record<string, string>, ...launch.env, SDK_EXECUTION_FAULT: String(fault) }, requestTimeoutMs: 30000 })
  const wait = async <T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> => {
    for (let round = 0; round < 1000; round++) {
      const value = await read(); if (ready(value)) return value
      await new Promise<void>((resolveWait) => { setTimeout(resolveWait, 5) })
    }
    throw new Error('SDK execution did not settle')
  }
  let sdk = open(true)
  const initialize = () => sdk.initialize({ credential: 'sdk-company-test-credential', cwd: process.cwd(), provider: 'company', model: 'scripted' })
  const finished = async (commandId: string) => {
    const response = await wait(() => sdk.getSimulationRequest({ commandId }), value => value.status === 'found' && value.request.status !== 'accepted')
    expect(response).toMatchObject({ status: 'found', request: { status: 'completed' } })
  }
  try {
    await initialize()
    const created = await sdk.createSimulation({ commandId: 'sdk-execution-create', templateId: 'company', templateVersion: '1', expectedModel: { provider: 'company', name: 'scripted' },
      name: 'SDK report continuation', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
    const runId = created.runId; await finished(created.commandId)
    await sdk.manageSimulation({ runId, managementId: 'first-start', phase: 'running' })
    await wait(() => sdk.getSimulationControl({ runId }), value => value.driver === 'failed')
    const reports = await sdk.browseSimulation({ runId, collection: 'operations', limit: 32 })
    if (reports.collection !== 'operations') throw new Error('Wrong operation collection')
    const original = reports.items.find(value => value.kind.text === 'communication/post'); expect(original).toBeDefined()
    await sdk.checkpointSimulation({ runId, commandId: 'sdk-execution-cut' }); await finished('sdk-execution-cut')
    await sdk.close(); sdk = open(false); await initialize()
    expect((await sdk.getSimulationControl({ runId })).owner).toBe('not-held')
    await sdk.restoreSimulation({ runId, commandId: 'sdk-execution-restore', checkpointId: 'product-checkpoint/sdk-execution-cut' })
    await finished('sdk-execution-restore')
    expect((await sdk.getSimulationControl({ runId })).phase).toBe('paused')
    await sdk.manageSimulation({ runId, managementId: 'second-start', phase: 'running' })
    const reviews = await wait(() => sdk.listSimulationTaskReviews({ runId }), value => value.items.some(item => item.action.allowed))
    const target = reviews.items.find(item => item.action.allowed)
    if (target === undefined) throw new Error('Continued review is unavailable')
    expect(target.attemptCount).toBe(2); expect(target.evidence?.report.operationId).toBe(original?.id)
    const selector = JSON.parse(await readFile(resolve(root, 'sdk-execution-continuation.json'), 'utf8')) as {
      decisionId: string
      report: { attemptId: string; operationId: string; contextFingerprint: string }
      history: { meta: SessionHeader; events: SessionEvent[] }
      originalContext: SimulationContextViewEventData
      scope: { teamId: string; participantId: string; sessionId: string }
    }
    const context = await sdk.inspectSimulationObject({ runId, collection: 'decisions', id: selector.decisionId, section: 'context', limit: 32 })
    if (context.value?.section !== 'context') throw new Error('Frozen task input is unavailable')
    const texts = context.value.items.items.filter(value => value.kind === 'section' && value.body.status === 'text')
      .map(value => value.kind === 'section' && value.body.status === 'text' ? value.body.text : '').join('\n')
    expect(texts).toContain('reportContinuation'); expect(texts).toContain(selector.report.operationId)
    expect(texts).toContain(selector.report.contextFingerprint)
    const recorded = selector.history.events.filter(event => event.type === 'simulation/context-view')
    expect(recorded.length).toBeGreaterThanOrEqual(2)
    for (const event of recorded) expect(isSimulationContextViewEvent(event)).toBe(true)
    expect(recorded.find(event => event.data.inputId === selector.originalContext.inputId)?.data).toEqual(selector.originalContext)
    expect(selector.history.meta).toMatchObject({ id: selector.scope.sessionId,
      teamId: selector.scope.teamId, participantId: selector.scope.participantId })
    expect(selector.scope.teamId).toBe(target.teamId)
    const recoveredInput = recorded.find(event => JSON.stringify(event.data.content).includes('reportContinuation'))
    expect(recoveredInput).toBeDefined()
    expect(JSON.stringify(recoveredInput?.data.content)).toContain(selector.report.operationId)
    expect(JSON.stringify(recoveredInput?.data.content)).toContain(selector.report.contextFingerprint)
    const rebuilt = Session.create(selector.history.meta.id, selector.history.events)
    const rendered = JSON.stringify(rebuilt.deriveMessages())
    expect(rendered).toContain('reportContinuation'); expect(rendered).toContain(selector.report.contextFingerprint)
    expect(recorded.every(event => event.data.runId === selector.originalContext.runId && event.data.entityId === 'buyer')).toBe(true)
    await sdk.resolveSimulationTaskReview({ runId, commandId: 'sdk-execution-approve', operationId: target.operationId,
      attemptId: target.attemptId, expectedRevision: target.taskRevision, nextPhase: 'completed', reason: 'Verified original report and context' })
    await finished('sdk-execution-approve')
    await wait(() => sdk.getSimulationControl({ runId }), value => value.stop === 'completed')
    const final = await sdk.browseSimulation({ runId, collection: 'operations', limit: 32 })
    if (final.collection !== 'operations') throw new Error('Wrong final operation collection')
    expect(final.items.filter(value => value.kind.text === 'communication/post')).toHaveLength(1)
    expect({ sdk: 'typescript', originalReport: 'preserved', continuationInput: 'recorded-and-authorized',
      attempts: 2, reports: 1, inference: false, restored: 'paused', review: 'completed' }).toMatchSnapshot()
  } finally { await sdk.close(); await rm(root, { recursive: true, force: true }) }
}, 60000)
