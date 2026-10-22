/** Authenticated creation reconciles original durable allocations after real process exits. */
import assert from 'node:assert/strict'
import { writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import { simulationProductCreateInputSchema } from '@clocky/clocky-simulation-product/schema'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type {} from '@clocky/clocky-simulation-product/administration'
import { modelCalls } from './product-administration-model.ts'

const { runId: _runId, ...spec } = simulationRunSpecSchema.parse({ runId: 'template', tickUnit: 'minute', origin: '9007199254740993',
  maxTime: '1000', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10,
  maxDriveSteps: 32, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000,
  maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 2, maxTokensPerInterval: 1000000,
  tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
  maxPendingEvents: 100, maxPendingInteractions: 100, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
  maxQueuedDecisions: 100, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16,
  maxResourceReservationHistory: 128,
  maxResourceQuantity: '10000', relationRules: [] })
process.env.COMPANY_PRODUCT_TEMPLATES = JSON.stringify([{ id: 'company', version: '1', name: 'Company procurement',
  provider: 'local', spec, preset: 'simulation', objective: 'Deliver one inventory unit',
  driver: { version: '1', maxControlSteps: 2, model: { provider: 'company', name: 'scripted' },
    requestDelay: '5', reportDelay: '1', replyDelay: '20', completeDelay: '30' },
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } }])
const ctx = await boot('company-product-administration', process.argv[2]!)
const call: AuthenticatedProductCall = { principal: { id: 'reader' as never, issuer: 'scenario', subject: 'reader',
  assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
const client = new InProcessApiClient(toFetchHandler(createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined }),
  { authenticatedProductCall: call }))
const input = simulationProductCreateInputSchema.parse({ commandId: 'original-create', templateId: 'company', templateVersion: '1',
  expectedModel: { provider: 'company', name: 'scripted' },
  name: 'Original company', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'original-proof.json')
const originalTerminal = Promise.withResolvers<'command/completed' | 'command/failed'>()
const hold = async (stage: string): Promise<void> => {
  if (process.env.COMPANY_PRODUCT_CRASH !== stage) return
  const commands = ctx.storageLog.get('product-commands')!
  const accepted = (await commands.read(-1, 1))[0]!.value as { command: { creation: { record: unknown } } }
  await writeFile(proofPath, JSON.stringify(accepted.command.creation.record))
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
try {
  for (const name of ['product-commands', 'product-directory']) {
    const stream = ctx.storageLog.get(name)!
    const append = stream.append.bind(stream)
    stream.append = async (...args) => {
      const result = await append(...args)
      const entry = args[1][0] as { kind: string; commandId?: string }
      await hold(name === 'product-directory' ? 'directory' : entry.kind === 'command/accepted' ? 'accepted' : 'terminal')
      if (name === 'product-commands' && entry.commandId === input.commandId
        && (entry.kind === 'command/completed' || entry.kind === 'command/failed')) {
        const kind = entry.kind
        // The next IO turn observes the command store's post-append fold, without imposing a fixture-only startup budget.
        setImmediate(() => { originalTerminal.resolve(kind) })
      }
      return result
    }
  }
  const open = ctx.simulations.open.bind(ctx.simulations)
  ctx.simulations.open = async (...args) => {
    const run = await open(...args)
    await hold('native')
    const change = run.change.bind(run)
    run.change = async (...input) => {
      const value = await change(...input)
      if (input[0].kind === 'entity/create') assert.equal(value.entities[input[0].id]?.readiness, 'preparing')
      await hold(input[0].kind === 'entity/readiness' ? 'ready' : 'entity')
      return value
    }
    const acquire = run.acquireCheckpointCut.bind(run)
    run.acquireCheckpointCut = async (...input) => {
      assert.ok(Object.values(run.snapshot().entities).every(entity => entity.readiness === 'ready'))
      const cut = await acquire(...input)
      const publish = cut.publish.bind(cut)
      cut.publish = async (manifest) => { const value = await publish(manifest); await hold('checkpoint'); return value }
      return cut
    }
    return run
  }
  const recovered = process.env.COMPANY_PRODUCT_RECOVER === 'true'
  const prior = await client.simulations.request({ commandId: input.commandId })
  assert.ok(prior.result.ok)
  assert.equal(prior.result.value.status, recovered ? 'found' : 'not-found')
  const priorDirectory = await client.simulations.list({})
  assert.ok(priorDirectory.result.ok)
  if (recovered) {
    assert.equal(priorDirectory.result.value.items.length, 1)
    const observation = await client.simulations.inspect({ runId: priorDirectory.result.value.items[0]!.id })
    assert.ok(observation.result.ok)
    if (observation.result.value.world !== undefined) assert.equal(observation.result.value.world.owner, 'unowned')
  }
  assert.equal(modelCalls, 0)
  if (process.env.COMPANY_PRODUCT_SLOW_ATTACH === 'true') {
    const attach = ctx.simulationTeams.attach.bind(ctx.simulationTeams)
    ctx.simulationTeams.attach = async (...args) => {
      const connection = await attach(...args)
      await new Promise<void>((resolve) => { setTimeout(resolve, 1100) })
      return connection
    }
  }
  const receipt = await client.simulations.create(input)
  assert.ok(receipt.result.ok)
  const id = receipt.result.value.runId
  if (recovered) {
    const original = JSON.parse(await readFile(proofPath, 'utf8')) as { id: string }
    assert.equal(id, original.id)
  }
  // The observer is installed before submission; re-read afterward so a completed retry cannot leave a subscription gap.
  const current = await client.simulations.request({ commandId: input.commandId })
  assert.ok(current.result.ok)
  if (current.result.value.status === 'found' && current.result.value.request.status === 'accepted') {
    assert.equal(await originalTerminal.promise, 'command/completed')
  }
  const settled = await client.simulations.request({ commandId: input.commandId })
  assert.ok(settled.result.ok)
  assert.equal(settled.result.value.status, 'found')
  if (settled.result.value.status === 'found') assert.equal(settled.result.value.request.status, 'completed')
  const journal = ctx.storageLog.get('product-commands')!
  const tail = journal.tailSequence
  const retry = await client.simulations.create(input)
  assert.ok(retry.result.ok)
  assert.equal(retry.result.value.runId, id)
  assert.equal(retry.result.value.status, 'completed')
  assert.equal(journal.tailSequence, tail)
  const conflict = await client.simulations.create({ ...input, name: 'Changed original command' })
  assert.ok(!conflict.result.ok)
  assert.equal(conflict.result.error.code, 'simulation-product-invalid')
  assert.equal(journal.tailSequence, tail)
  const observed = await client.simulations.inspect({ runId: id })
  assert.ok(observed.result.ok)
  assert.equal(observed.result.value.world?.phase, 'paused')
  assert.equal(observed.result.value.world?.entityCount, 2)
  assert.equal(observed.result.value.world?.decisionCount, 0)
  const checkpoints = await client.simulations.browse({ runId: id, collection: 'checkpoints' })
  assert.ok(checkpoints.result.ok)
  assert.equal(checkpoints.result.value.total, 1)
  assert.equal(modelCalls, 0)
  assert.deepEqual(await ctx.sessionPersistence.list(), [])
  console.log(JSON.stringify({ originalIdentityRetained: true, commandEntries: tail + 1, directoryEntries: 1,
    phase: 'paused', entities: 2, decisions: 0, completeInitialCheckpoints: 1, modelCalls, completedRetryWrites: 0 }))
} finally { await ctx.fiber.dispose() }
