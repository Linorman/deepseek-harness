/** Real product-held task execution and cold suffix recovery at cross-owner commit points. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductCreateInputSchema, simulationProductManageInputSchema, simulationProductRestoreInputSchema,
  simulationProductCheckpointInputSchema, simulationProductRequestInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductRunId, SimulationProductControl } from '@clocky/clocky-simulation-product/types'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { templateJSON } from './sdk-product-template.ts'
import { released, requests } from './product-control-model.ts'

const cognition = process.env.COMPANY_TASK_COGNITION!
const templates = JSON.parse(templateJSON) as Array<{ driver: Record<string, unknown>; spec: Record<string, unknown> }>
templates[0]!.driver.tasks = { version: '1', cognition, leaseDurationMs: 60000, maxAttempts: 2, retry: 'scene' }
process.env.COMPANY_PRODUCT_TEMPLATES = JSON.stringify(templates)
const ctx = await boot('company-product-task', process.argv[2]!)
released.resolve(undefined)
const call: AuthenticatedProductCall = { principal: { id: 'reader' as never, issuer: 'scenario', subject: 'reader',
  assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
const client = new InProcessApiClient(toFetchHandler(createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined }),
  { authenticatedProductCall: call }))
const proof = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'product-task-proof.json')
let runId: SimulationProductRunId, owned: SimulationRun | undefined, held = false
const cold = process.env.COMPANY_TASK_COLD === 'true'
const hold = async (stage: string) => {
  if (cold || held || process.env.COMPANY_TASK_CRASH !== stage) return
  held = true
  await writeFile(proof, JSON.stringify({ runId, stages: requests.map(value => value.stage) }))
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
const wait = async (predicate: () => Promise<boolean>) => {
  for (let round = 0; round < 2000; round++) {
    if (await predicate()) return
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
  }
  throw new Error('Company product task did not settle')
}
const control = async (): Promise<SimulationProductControl> => {
  const value = await client.simulations.control({ runId }); assert.ok(value.result.ok); return value.result.value
}
const start = async (managementId: string) => {
  const value = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId, managementId, phase: 'running' }))
  assert.ok(value.result.ok)
}
const open = ctx.simulations.open.bind(ctx.simulations)
ctx.simulations.open = async (...args) => {
  const run = await open(...args); owned = run
  const reserve = run.reserveTaskExecution.bind(run)
  run.reserveTaskExecution = async (...input) => { const result = await reserve(...input); await hold('reserved'); return result }
  const input = run.recordTaskInput.bind(run)
  run.recordTaskInput = async (...args) => { const result = await input(...args); await hold('input'); return result }
  const result = run.recordTaskResult.bind(run)
  run.recordTaskResult = async (...args) => {
    // Native drive applies effects internally; result admission observes that durable write before retaining terminal intent.
    assert.ok(Object.values(run.snapshot().operations).some(value => value.action.kind === 'resource/transfer' && value.result?.status === 'applied'))
    await hold('effect')
    const accepted = await result(...args); await hold('result'); return accepted
  }
  const observe = run.observeTaskExecution.bind(run)
  run.observeTaskExecution = async (...args) => {
    const observed = await observe(...args)
    if (observed.task?.executor?.outcome === 'completed') await hold('observed')
    return observed
  }
  return run
}
const createTask = ctx.teams.createSimulationTask.bind(ctx.teams)
ctx.teams.createSimulationTask = async (request) => { const task = await createTask(request); await hold('created'); return task }
const assign = ctx.teams.assignSimulationTask.bind(ctx.teams)
ctx.teams.assignSimulationTask = async (request) => { const task = await assign(request); await hold('assigned'); return task }
const settle = ctx.teams.settleSimulationTaskAttempt.bind(ctx.teams)
ctx.teams.settleSimulationTaskAttempt = async (request) => { const task = await settle(request); await hold('settled'); return task }
const model = ctx.simulationTeams.modelRequest.bind(ctx.simulationTeams)
ctx.simulationTeams.modelRequest = async (...args) => {
  const result = await model(...args)
  if (args[1].kind === 'submit' && Object.values(owned?.snapshot().taskExecutions ?? {}).some(execution =>
    execution.decisions?.some(value => owned?.snapshot().decisions[value.request.decisionId]?.status === 'accepted'))) await hold('decision')
  return result
}
const dispatch = ctx.simulationTeams.attach.bind(ctx.simulationTeams)
ctx.simulationTeams.attach = async (...args) => {
  const connection = await dispatch(...args)
  const execute = connection.executeTaskDecision.bind(connection)
  connection.executeTaskDecision = async (...request) => { const decision = await execute(...request); await hold('decision'); return decision }
  return connection
}
try {
  let stages: string[] = []
  if (cold) {
    const original = JSON.parse(await readFile(proof, 'utf8')) as { runId: SimulationProductRunId; stages: string[] }
    runId = original.runId; stages = original.stages
    const before = await control()
    assert.equal(before.owner, 'not-held'); assert.equal(requests.length, 0)
    assert.ok(before.administration.recovery)
    const restored = await client.simulations.restore(simulationProductRestoreInputSchema.parse({ runId, commandId: 'task-restore',
      checkpointId: before.administration.recovery.checkpointId }))
    assert.ok(restored.result.ok)
    await wait(async () => {
      const value = await client.simulations.request(simulationProductRequestInputSchema.parse({ commandId: 'task-restore' })); assert.ok(value.result.ok)
      return value.result.value.status === 'found' && value.result.value.request.status === 'completed'
    })
    assert.equal((await control()).phase, 'paused'); assert.equal(requests.length, 0)
  } else {
    const creation = await client.simulations.create(simulationProductCreateInputSchema.parse({ commandId: 'task-create', templateId: 'company',
      templateVersion: '1', name: 'Task company', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } }))
    assert.ok(creation.result.ok); runId = creation.result.value.runId
    await writeFile(proof, JSON.stringify({ runId, stages: [] }))
    await wait(async () => {
      const value = await client.simulations.request(simulationProductRequestInputSchema.parse({ commandId: 'task-create' })); assert.ok(value.result.ok)
      return value.result.value.status === 'found' && value.result.value.request.status === 'completed'
    })
    assert.equal(requests.length, 0)
  }
  await start(cold ? 'recovered-start' : 'start')
  await wait(async () => {
    const value = await control()
    if (value.driver === 'failed' || value.stop === 'scenario-blocked') throw new Error(`Task scheduling stopped: ${value.driver}/${value.stop}`)
    return value.driver === 'completed'
  })
  const spec = simulationRunSpecSchema.parse({ ...templates[0]!.spec, runId })
  const observation = await ctx.simulations.inspect(ctx.simulations.resolveInspection({ provider: 'local', spec }))
  assert.ok(observation)
  const state = observation.snapshot, executions = Object.values(state.taskExecutions!)
  const task = await ctx.teams.getTask({ teamId: executions[0]!.request.teamId, taskId: executions[0]!.request.taskId })
  assert.equal(task.phase, 'completed')
  assert.equal(Object.values(state.operations).filter(value => value.action.kind === 'task/create').length, 1)
  assert.equal(Object.values(state.operations).filter(value => value.action.kind === 'resource/transfer').length, 1)
  assert.equal(state.resources['stock' as never]!.quantity, '1'); assert.equal(state.resources['received' as never]!.quantity, '1')
  stages.push(...requests.map(value => value.stage))
  assert.equal(stages.filter(stage => stage === 'transfer').length, cognition === 'model' ? 3 : 0)
  assert.equal(stages.filter(stage => stage === 'task').length, 3)
  assert.ok(requests.every(value => value.tools.join(',') === 'simulation_observe,simulation_stage,simulation_submit'))
  const checkpoint = await client.simulations.checkpoint(simulationProductCheckpointInputSchema.parse({ runId, commandId: 'finished-task-cut' }))
  assert.ok(checkpoint.result.ok)
  await wait(async () => {
    const value = await client.simulations.request(simulationProductRequestInputSchema.parse({ commandId: 'finished-task-cut' })); assert.ok(value.result.ok)
    return value.result.value.status === 'found' && value.result.value.request.status === 'completed'
  })
  assert.equal((await control()).phase, 'paused')
  console.log(JSON.stringify({ cognition, recovered: cold, phase: 'paused', tasks: 1, task: task.phase, attempts: task.attemptCount,
    inventory: ['1', '1'], originalEffects: 1, retired: executions.filter(value => value.retired !== undefined).length,
    continuation: executions.at(-1)!.request.interaction!.execution, taskInputsRecorded: true,
    transferRequests: cognition === 'model' ? 3 : 0, scopedToolsOnly: true, checkpoint: 'completed' }))
} finally { await ctx.fiber.dispose() }
