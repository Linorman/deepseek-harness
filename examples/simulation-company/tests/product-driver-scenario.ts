/** The production driver advances real model windows and procurement effects, including cold suffix recovery. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointRestoreRequestSchema, simulationPhaseManagementRequestSchema,
  simulationChangeSchema } from '@clocky/clocky-simulation'
import { prepareSimulationCompany, simulationCompanyPreparationSchema, SimulationCompanyDriver, simulationCompanyDriverSchema } from '@clocky/clocky-simulation-product'
import { companyModel } from '../../../packages/simulation/simulation-product/tests/company-model.ts'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('company-product-driver', process.argv[2]!)
const settings = simulationCompanyPreparationSchema.parse({ version: '1', ownerName: 'simulation/company-product',
  objective: 'Deliver one inventory unit', buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2',
  participant: { provider: 'in-process', preset: 'simulation', model: 'company/scripted' },
  checkpoint: { id: 'initial', maxDrainRounds: 4, maxAttempts: 3 } })
const config = simulationCompanyDriverSchema.parse({ version: '1', maxControlSteps: 2, model: { provider: 'company', name: 'scripted' },
  requestDelay: '5', reportDelay: '1', replyDelay: '20', completeDelay: '30' })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'open', spec: {
  runId: 'company-driver', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536,
  maxEntities: 16, maxResidentActors: Number(process.env.COMPANY_DRIVER_RESIDENTS ?? 2), maxTokensPerInterval: 1000000,
  tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
  maxPendingEvents: 100, maxPendingInteractions: 100, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 100,
  maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceQuantity: '10000', relationRules: [],
} })
const recovering = process.env.COMPANY_DRIVER_RECOVER === 'true'
const restored = recovering ? await ctx.simulationTeams.restore(selection, simulationCheckpointRestoreRequestSchema.parse({
  id: settings.checkpoint.id, implementationVersion: 'company/1', maxAttempts: 3,
})) : undefined
const run = restored?.run ?? await ctx.simulations.open({ ...selection, mode: 'create' })
const hold = async (stage: string): Promise<void> => {
  if (process.env.COMPANY_DRIVER_CRASH !== stage) return
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
try {
  const prepared = restored === undefined ? await prepareSimulationCompany(ctx.simulationTeams, run, settings) : undefined
  if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: 'buyer', entityRevision: run.snapshot().entities['buyer' as never]!.revision,
    profile: { name: 'Buyer', privateNote: 'PRIVATE_COMPANY_PROFILE' } }), run.snapshot().revision)
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, prepared!.teamId, settings.ownerName)
  const requests: Array<{ stage: string; tools: string[]; goal: string }> = []
  ctx.llm.registerAdapter(['company'], companyModel(run, requests))
  const submit = ctx.simulationTeams.modelRequest.bind(ctx.simulationTeams)
  ctx.simulationTeams.modelRequest = async (...args) => {
    const result = await submit(...args)
    const state = run.snapshot()
    const id = state.activeWindowId === undefined ? undefined : state.windows?.[state.activeWindowId]?.request.decisions[0]?.id
    if (args[1].kind === 'submit' && id?.startsWith('company/1/request/')) {
      await hold('request-submitted')
    }
    return result
  }
  const commit = run.commitWindow.bind(run)
  run.commitWindow = async (...args) => { const result = await commit(...args); await hold('request-committed'); return result }
  const drive = connection.driveResident.bind(connection)
  connection.driveResident = async (...args) => {
    const result = await drive(...args)
    const operations = Object.values(run.snapshot().operations)
    if (operations.some(value => value.action.kind === 'resource/transfer' && value.result?.status === 'applied')) await hold('transfer-applied')
    return result
  }
  const lifetime = new AbortController()
  const driver = new SimulationCompanyDriver(run, connection, settings, config, lifetime.signal)
  const before = run.snapshot()
  assert.equal((await driver.advance()).reason, 'paused')
  assert.deepEqual(run.snapshot(), before)
  assert.equal(requests.length, 0)
  await run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: recovering ? 'resume' : 'start', phase: 'running' }))
  let batches = 0
  while (true) {
    const pending = driver.advance()
    assert.equal(driver.advance(), pending)
    const result = await pending
    batches++
    assert.ok(result.controlSteps <= config.maxControlSteps)
    if (result.reason === 'completed') break
    assert.equal(result.reason, 'work-limit')
    assert.ok(batches < 30)
  }
  const state = run.snapshot()
  assert.equal(state.resources['stock' as never]?.quantity, '1')
  assert.equal(state.resources['received' as never]?.quantity, '1')
  assert.equal(Object.values(state.interactions)[0]?.execution, 'completed')
  const after = run.snapshot()
  const requestCount = requests.length
  assert.equal((await driver.advance()).reason, 'completed')
  assert.deepEqual(run.snapshot(), after)
  assert.equal(requests.length, requestCount)
  await driver.drain()
  console.log(JSON.stringify({ requests, time: state.time, quantities: ['stock', 'received'].map(id => state.resources[id as never]?.quantity),
    acceptedStages: Object.values(state.decisions).filter(value => value.status === 'accepted').map(value => value.id.split('/')[2]),
    cancelledDecisions: Object.values(state.decisions).filter(value => value.status === 'cancelled').length,
    interaction: Object.values(state.interactions)[0]?.execution, commitment: Object.values(state.commitments)[0]?.phase,
    deliveries: Object.values(state.operations).filter(value => value.delivery?.receipt !== undefined).length,
    boundedBatches: true, completedRetryWithoutInference: true, privateProfileWithheld: true }))
} finally { await run.close(); await ctx.fiber.dispose() }
