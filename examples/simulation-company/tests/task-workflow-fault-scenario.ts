/** Real Loader scheduler/executor resumes three-actor report work at cross-owner durable process-exit points. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { SimulationProductRunId } from '@clocky/clocky-simulation-product/types'
import { templateJSON } from './sdk-product-template.ts'
import { released, requests } from './product-control-model.ts'

const templates = JSON.parse(templateJSON) as Array<{ driver: Record<string, unknown>; spec: Record<string, unknown> }>
templates[0]!.spec.maxTokensPerInterval = 0
templates[0]!.driver.scenario = { kind: 'task-workflow', version: '1',
  topology: { actors: [{ id: 'auditor', name: 'Independent auditor' }], channels: [{ key: 'audit', members: [
    { entityId: 'buyer', role: 'author' }, { entityId: 'auditor', role: 'receiver' },
  ] }] }, steps: [
    { id: 'audit', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'auditor', channelKey: 'audit',
      reviewerEntityId: 'auditor', subject: 'Audit report', description: 'Publish the installed audit report', text: '原始审计报告',
      cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 3, retry: 'before-effects' },
    { id: 'response', sourceEntityId: 'buyer', entityId: 'supplier', recipientEntityId: 'buyer', channelKey: 'purchase',
      subject: 'Supplier response', description: 'Publish the installed response', text: 'Supplier acknowledged audit',
      cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 3, retry: 'before-effects' },
  ] }
process.env.COMPANY_PRODUCT_TEMPLATES = JSON.stringify(templates)
const ctx = await boot('task-workflow-fault', process.argv[2]!)
released.resolve(undefined)
const call: AuthenticatedProductCall = { principal: { id: 'reader' as never, issuer: 'scenario', subject: 'reader',
  assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
const client = new InProcessApiClient(toFetchHandler(createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined }),
  { authenticatedProductCall: call }))
const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'workflow-fault-proof.json')
const cold = process.env.WORKFLOW_FAULT_COLD === 'true'
let owned: SimulationRun | undefined, runId: SimulationProductRunId, held = false, originalTaskId: string | undefined
const hold = async (stage: string, taskId?: string) => {
  if (cold || held || process.env.WORKFLOW_FAULT_STAGE !== stage) return
  held = true
  const state = owned?.snapshot()
  await writeFile(proofPath, JSON.stringify({ runId, taskId: taskId ?? originalTaskId,
    reportIds: Object.values(state?.operations ?? {}).filter(value => value.action.kind === 'communication/post').map(value => value.id) }))
  process.send?.('durable')
  await new Promise<void>(() => {})
}
const wait = async (predicate: () => Promise<boolean>) => {
  for (let step = 0; step < 2000; step++) {
    if (await predicate()) return
    await new Promise<void>((resolveWait) => { setTimeout(resolveWait, 5) })
  }
  throw new Error('Task workflow fault scenario did not settle')
}
const finished = async (commandId: string) => wait(async () => {
  const response = await client.simulations.request({ commandId: commandId as never }); assert.ok(response.result.ok)
  const result = response.result.value
  if (result.status === 'found' && result.request.status === 'failed') throw new Error('Workflow administration failed')
  return result.status === 'found' && result.request.status === 'completed'
})
const open = ctx.simulations.open.bind(ctx.simulations)
ctx.simulations.open = async (...args) => {
  const run = await open(...args); owned = run
  const reserve = run.reserveTaskExecution.bind(run)
  run.reserveTaskExecution = async (...input) => { const result = await reserve(...input); await hold('reserved'); return result }
  const recordInput = run.recordTaskInput.bind(run)
  run.recordTaskInput = async (...input) => { const result = await recordInput(...input); await hold('input'); return result }
  const commit = run.commitWindow.bind(run)
  run.commitWindow = async (id) => {
    const window = run.snapshot().windows?.[id]
    const taskWindow = window?.request.decisions.some(value => run.snapshot().taskDecisionOwners?.[value.id] !== undefined)
    if (taskWindow) await hold('submitted')
    const result = await commit(id)
    if (taskWindow) await hold('window')
    return result
  }
  const recordResult = run.recordTaskResult.bind(run)
  run.recordTaskResult = async (...input) => {
    assert.ok(Object.values(run.snapshot().operations).some(value => value.action.kind === 'communication/post'
      && value.result?.status === 'applied' && value.delivery?.receipt !== undefined))
    await hold('effect')
    const result = await recordResult(...input); await hold('result'); return result
  }
  const observe = run.observeTaskExecution.bind(run)
  run.observeTaskExecution = async (...input) => {
    const result = await observe(...input)
    if (result.task?.executor?.outcome === 'completed') await hold('observed')
    return result
  }
  return run
}
const createTask = ctx.teams.createSimulationTask.bind(ctx.teams)
ctx.teams.createSimulationTask = async (input) => {
  const task = await createTask(input); originalTaskId ??= task.id; await hold('created', task.id); return task
}
const assign = ctx.teams.assignSimulationTask.bind(ctx.teams)
ctx.teams.assignSimulationTask = async (input) => { const task = await assign(input); await hold('assigned'); return task }
const settle = ctx.teams.settleSimulationTaskAttempt.bind(ctx.teams)
ctx.teams.settleSimulationTaskAttempt = async (input) => { const task = await settle(input); await hold('settled'); return task }

try {
  let originalReports: string[] = []
  if (cold) {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as { runId: SimulationProductRunId; taskId?: string; reportIds: string[] }
    runId = proof.runId; originalTaskId = proof.taskId; originalReports = proof.reportIds
    const control = await client.simulations.control({ runId }); assert.ok(control.result.ok)
    assert.equal(control.result.value.owner, 'not-held'); assert.equal(requests.length, 0)
    const anchor = control.result.value.administration.recovery; assert.ok(anchor)
    const restore = await client.simulations.restore({ runId, commandId: 'workflow-restore' as never, checkpointId: anchor.checkpointId })
    assert.ok(restore.result.ok); await finished('workflow-restore')
    const paused = await client.simulations.control({ runId }); assert.ok(paused.result.ok)
    assert.equal(paused.result.value.phase, 'paused'); assert.equal(requests.length, 0)
  } else {
    const creation = await client.simulations.create({ commandId: 'workflow-create' as never, templateId: 'company' as never,
      templateVersion: '1', name: 'Recoverable report workflow', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
    assert.ok(creation.result.ok); runId = creation.result.value.runId; await finished('workflow-create')
  }
  const started = await client.simulations.manage({ runId, managementId: (cold ? 'cold-start' : 'start') as never, phase: 'running' })
  assert.ok(started.result.ok)
  let approved = false
  await wait(async () => {
    const control = await client.simulations.control({ runId }); assert.ok(control.result.ok)
    if (control.result.value.driver === 'failed' || control.result.value.stop === 'scenario-blocked'
      || control.result.value.stop === 'recovery-required') throw new Error('Report workflow cannot recover its owned responsibility')
    if (!approved && control.result.value.stop === 'review-required') {
      const reviews = await client.simulations.listTaskReviews({ runId }); assert.ok(reviews.result.ok)
      const target = reviews.result.value.items.find(value => value.action.allowed); assert.ok(target)
      assert.equal(target.reviewerEntityId, 'auditor')
      const response = await client.simulations.resolveTaskReview({ runId, commandId: 'workflow-approve' as never,
        operationId: target.operationId, attemptId: target.attemptId, expectedRevision: target.taskRevision,
        nextPhase: 'completed', reason: 'Verified the original exact delivered report' })
      assert.ok(response.result.ok); await finished('workflow-approve'); approved = true
    }
    return control.result.value.stop === 'completed'
  })
  const state = owned?.snapshot(); assert.ok(state?.teamReservation)
  const tasks = (await ctx.teams.getTeam({ teamId: state.teamReservation.teamId })).tasks
  assert.equal(tasks.length, 2); assert.ok(tasks.every(task => task.phase === 'completed'))
  if (originalTaskId !== undefined) assert.ok(tasks.some(task => task.id === originalTaskId))
  const reports = Object.values(state.operations).filter(value => value.action.kind === 'communication/post')
  assert.equal(reports.length, 2); assert.ok(originalReports.every(id => reports.some(value => value.id === id)))
  assert.ok(reports.every(value => value.delivery?.receipt !== undefined))
  assert.equal(state.resources['stock' as never]?.quantity, '2'); assert.equal(state.resources['received' as never]?.quantity, '0')
  assert.equal(Object.keys(state.entities).length, 3); assert.equal(Object.keys(state.channelReservations ?? {}).length, 2)
  assert.equal(requests.length, 0)
  const checkpoint = await client.simulations.checkpoint({ runId, commandId: 'workflow-final-cut' as never })
  assert.ok(checkpoint.result.ok); await finished('workflow-final-cut')
  const snapshot = owned?.snapshot(); assert.ok(snapshot)
  const final = snapshot.checkpoints?.['product-checkpoint/workflow-final-cut' as never]; assert.equal(final?.status, 'completed')
  if (final?.status === 'completed') { assert.equal(final.manifest.sessions.length, 3); assert.equal(final.manifest.channels.length, 2) }
  process.stdout.write(JSON.stringify({ recovered: cold, completedTasks: 2, reports: 2, originalTaskPreserved: true,
    originalReportsPreserved: true, inventory: ['2', '0'], actorCount: 3, channelCount: 2, modelRequests: 0,
    phase: snapshot.phase,
    retiredAttempts: Object.values(snapshot.taskExecutions ?? {}).filter(value => value.retired !== undefined).length,
    reportContinuations: Object.values(snapshot.taskExecutions ?? {})
      .filter(value => value.request.reportContinuation !== undefined).length }) + '\n')
} finally { await ctx.fiber.dispose() }
