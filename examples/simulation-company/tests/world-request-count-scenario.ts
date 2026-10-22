import { hiringIntentFields, seedHiringIntent } from './world-domain-input.ts'
/** Real product execution retains a closed business application's historical request charge. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductWorldCreateInputSchema, simulationProductManageInputSchema,
  simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema, simulationProductRunIdSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductCommandId } from '@clocky/clocky-simulation-product/types'
import { SimulationWorldError, simulationCheckpointIdSchema, simulationHireIntentRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import type {} from './world-driver-model.ts'

const scenario = z.enum(['company', 'laboratory']).parse(process.env.WORLD_SCENARIO)
const recovering = process.env.WORLD_REQUEST_COUNT_RECOVER === 'true'
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
process.env.WORLD_PRODUCT_CONFIGURATION = JSON.stringify({ provider: 'local', catalog: installed,
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })
const ctx = await boot('world-request-count', process.argv[2]!)
const inputPath = resolve(root, 'world-request-count-input.json'), proofPath = resolve(root, 'world-request-count-proof.json')
const proofSchema = z.strictObject({ runId: simulationProductRunIdSchema, checkpointId: simulationCheckpointIdSchema, facts: z.json() })
let owned: SimulationRun | undefined
const open = ctx.simulations.open.bind(ctx.simulations)
ctx.simulations.open = async (...args) => { const run = await open(...args); owned = run; return run }
const calls = () => ctx.worldDriverProbe.requests.length
const held = (): SimulationRun => { assert.ok(owned); return owned }
try {
  const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential: ctx.productPrincipals.bootstrapCredential('local') })
  try {
    await lease.withCall(async (call) => {
      const api = createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
      const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call }))
      const waitCommand = async (commandId: SimulationProductCommandId) => {
        for (let attempt = 0; attempt < 2000; attempt++) {
          const found = await client.simulations.request({ commandId })
          assert.ok(found.result.ok && found.result.value.status === 'found')
          if (found.result.value.request.status !== 'accepted') return found.result.value.request
          await new Promise(done => setTimeout(done, 5))
        }
        throw new Error('Request-count product command did not settle')
      }
      const input = recovering
        ? simulationProductWorldCreateInputSchema.parse(JSON.parse(await readFile(inputPath, 'utf8')))
        : await (async () => {
          const definition = worldScenarioSchema.parse(JSON.parse(await readFile(
            resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
          definition.positions[0]!.capacity = 3
          definition.limits = { ...definition.limits, world: { ...definition.limits?.world, maxRequests: 1 } }
          const preview = await client.simulations.preflightWorld({ definition })
          assert.ok(preview.result.ok && preview.result.value.status === 'ready', JSON.stringify(preview.result))
          const createdInput = simulationProductWorldCreateInputSchema.parse({ commandId: 'request-count-original-create',
            name: 'Historical request quota', definition, preflight: { hash: preview.result.value.preview.hash,
              catalogGeneration: preview.result.value.preview.catalogGeneration } })
          await writeFile(inputPath, JSON.stringify(createdInput))
          return createdInput
        })()
      const created = await client.simulations.createWorld(input)
      assert.ok(created.result.ok)
      const runId = created.result.value.runId
      assert.equal((await waitCommand(input.commandId)).status, 'completed')
      assert.equal(calls(), 0)
      const start = simulationProductManageInputSchema.parse({ runId, managementId: 'request-count-original-start', phase: 'running' })
      const proof = recovering ? proofSchema.parse(JSON.parse(await readFile(proofPath, 'utf8'))) : undefined
      if (recovering) {
        assert.ok(proof)
        assert.equal(runId, proof.runId)
        const restoreInput = simulationProductRestoreInputSchema.parse({ runId, commandId: 'request-count-cold-restore',
          checkpointId: proof.checkpointId })
        const restored = await client.simulations.restore(restoreInput)
        assert.ok(restored.result.ok)
        assert.equal((await waitCommand(restoreInput.commandId)).status, 'completed')
      } else {
        const started = await client.simulations.manage(start)
        assert.ok(started.result.ok)
        let idle = false
        for (let attempt = 0; attempt < 2000; attempt++) {
          const control = await client.simulations.control({ runId })
          assert.ok(control.result.ok)
          assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result.value))
          if (control.result.value.stop === 'idle' && !control.result.value.inFlight) { idle = true; break }
          await new Promise(done => setTimeout(done, 5))
        }
        assert.equal(idle, true)
        assert.equal(calls(), 18)
        const paused = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
          managementId: 'request-count-original-pause', phase: 'paused' }))
        assert.ok(paused.result.ok)
      }
      const run = held(), state = run.snapshot(), world = state.world
      assert.ok(world)
      assert.equal(state.phase, 'paused')
      assert.equal(world.definition.limits.maxRequests, 1)
      assert.equal(Object.keys(world.intents).length, 1)
      assert.equal(Object.keys(world.requests).length, 1)
      assert.equal(Object.keys(world.results).length, 1)
      const original = Object.values(world.intents)[0]!, request = Object.values(world.requests)[0]!
      assert.equal(request.intentId, original.id)
      assert.equal(request.status, 'committed')
      const requester = state.entities[hiringIntentFields(original).requesterEntityId]!
      assert.equal(requester.readiness, 'ready')
      assert.equal(requester.phase, 'active')
      assert.ok(requester.binding)
      assert.notEqual(requester.id, world.definition.directorEntityId)
      const grant = world.definition.authorizations.find(value => value.requesterEntityId === requester.id
        && value.positionEntityId === hiringIntentFields(original).positionEntityId)
      assert.ok(grant)
      const relation = state.relations[grant.relationId]!
      assert.equal(relation.subject, requester.id)
      assert.equal(relation.object, hiringIntentFields(original).positionEntityId)
      assert.equal(relation.scope, hiringIntentFields(original).organizationEntityId)
      assert.equal(relation.relation, 'can-hire')
      assert.ok(BigInt(relation.validFrom) <= BigInt(state.time))
      assert.ok(relation.validUntil === null || BigInt(relation.validUntil) > BigInt(state.time))
      const position = world.definition.positions.find(value => value.entityId === hiringIntentFields(original).positionEntityId)!
      const occupied = Object.values(state.relations).filter(value => value.relation === 'assignment'
        && value.object === position.entityId && value.scope === hiringIntentFields(original).organizationEntityId
        && BigInt(value.validFrom) <= BigInt(state.time)
        && (value.validUntil === null || BigInt(value.validUntil) > BigInt(state.time))).length
      assert.equal(position.capacity, 3)
      assert.equal(occupied, 2)
      const facts = async () => {
        const current = run.snapshot()
        const team = await ctx.teams.getTeam({ teamId: requester.binding!.teamId })
        const envelopes = await Promise.all([...team.channelIds].sort().map(async (channelId) => {
          const log = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
          return { channelId, records: log.records.filter(value => value.type === 'channel/envelope') }
        }))
        return z.json().parse(JSON.parse(JSON.stringify({ world: current.world, operations: current.operations,
          scheduledEvents: current.scheduledEvents, wakes: current.wakes,
          bindings: Object.values(current.entities).map(value => ({ entityId: value.id, binding: value.binding ?? null })), envelopes })))
      }
      const before = await facts(), revision = run.snapshot().revision, modelCalls = calls()
      assert.deepEqual(await seedHiringIntent(run, hiringIntentFields(original)), original)
      const next = simulationHireIntentRequestSchema.parse({ ...hiringIntentFields(original), applicationId: 'request-count-second-valid-business' })
      assert.notEqual(next.applicationId, hiringIntentFields(original).applicationId)
      await assert.rejects(seedHiringIntent(run, next), (error: unknown) => error instanceof SimulationWorldError
        && error.failure.code === 'SIM_WORLD_LIMIT' && error.failure.limit === 'requests')
      assert.deepEqual(await seedHiringIntent(run, hiringIntentFields(original)), original)
      assert.equal(run.snapshot().revision, revision)
      assert.equal(calls(), modelCalls)
      assert.deepEqual(await facts(), before)
      if (recovering) { assert.ok(proof); assert.deepEqual(before, proof.facts) }
      const retriedCreate = await client.simulations.createWorld(input)
      assert.ok(retriedCreate.result.ok)
      assert.equal(retriedCreate.result.value.runId, runId)
      const retriedStart = await client.simulations.manage(start)
      assert.ok(retriedStart.result.ok)
      assert.equal(retriedStart.result.value.operation.status, 'completed')
      assert.equal(retriedStart.result.value.control.phase, 'paused')
      assert.equal(run.snapshot().revision, revision)
      assert.equal(calls(), modelCalls)
      assert.deepEqual(await facts(), before)
      if (!recovering) {
        const checkpointInput = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'request-count-complete' })
        const checkpoint = await client.simulations.checkpoint(checkpointInput)
        assert.ok(checkpoint.result.ok)
        const completed = await waitCommand(checkpointInput.commandId)
        assert.equal(completed.status, 'completed')
        assert.ok(completed.checkpointId)
        assert.deepEqual(await facts(), before)
        await writeFile(proofPath, JSON.stringify(proofSchema.parse({ runId, checkpointId: completed.checkpointId, facts: before })))
      }
      console.log(JSON.stringify({ scenario, maxRequests: 1, intents: 1, cases: 1, completed: true, sparePosition: 1,
        exactRetry: true, newApplicationRejected: 'requests', originalFacts: true, originalCommands: true,
        pausedRecovery: recovering, modelCalls: calls() }))
    })
  } finally { await lease.revoke() }
} finally { await ctx.fiber.dispose() }
