import { seedHiringIntent, hiringIntentFields } from './world-domain-input.ts'
/** Real product case pagination binds two completed business applications to one revision and separate disclosure grants. */
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
import { simulationCheckpointIdSchema, simulationHireIntentRequestSchema, simulationWakeRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import type {} from './world-driver-model.ts'

const scenario = z.enum(['company', 'laboratory']).parse(process.env.WORLD_SCENARIO)
const recovering = process.env.WORLD_CASE_PAGINATION_RECOVER === 'true'
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
process.env.WORLD_PRODUCT_CONFIGURATION = JSON.stringify({ provider: 'local', catalog: installed,
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })
const ctx = await boot('world-case-pagination', process.argv[2]!)
const inputPath = resolve(root, 'world-case-pagination-input.json'), proofPath = resolve(root, 'world-case-pagination-proof.json')
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
        throw new Error('Case-pagination product command did not settle')
      }
      const input = recovering
        ? simulationProductWorldCreateInputSchema.parse(JSON.parse(await readFile(inputPath, 'utf8')))
        : await (async () => {
          const definition = worldScenarioSchema.parse(JSON.parse(await readFile(
            resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
          definition.positions[0]!.capacity = 4
          definition.limits = { ...definition.limits, world: { ...definition.limits?.world, maxRequests: 8 } }
          const preview = await client.simulations.preflightWorld({ definition })
          assert.ok(preview.result.ok && preview.result.value.status === 'ready', JSON.stringify(preview.result))
          const createdInput = simulationProductWorldCreateInputSchema.parse({ commandId: 'case-pagination-original-create',
            name: 'Revision-bound case pages', definition, preflight: { hash: preview.result.value.preview.hash,
              catalogGeneration: preview.result.value.preview.catalogGeneration } })
          await writeFile(inputPath, JSON.stringify(createdInput))
          return createdInput
        })()
      const created = await client.simulations.createWorld(input)
      assert.ok(created.result.ok)
      const runId = created.result.value.runId
      assert.equal((await waitCommand(input.commandId)).status, 'completed')
      assert.equal(calls(), 0)
      const start = simulationProductManageInputSchema.parse({ runId, managementId: 'case-pagination-original-start', phase: 'running' })
      const proof = recovering ? proofSchema.parse(JSON.parse(await readFile(proofPath, 'utf8'))) : undefined
      if (recovering) {
        assert.ok(proof)
        assert.equal(runId, proof.runId)
        const restoreInput = simulationProductRestoreInputSchema.parse({ runId, commandId: 'case-pagination-cold-restore',
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
          managementId: 'case-pagination-original-pause', phase: 'paused' }))
        assert.ok(paused.result.ok)
      }
      const run = held()
      if (!recovering) {
        const original = Object.values(run.snapshot().world!.intents)[0]!
        const next = await seedHiringIntent(run, simulationHireIntentRequestSchema.parse({ ...hiringIntentFields(original),
          applicationId: 'second-paginated-application' }))
        await run.scheduleWake(simulationWakeRequestSchema.parse({ id: `world-initial:${next.id}`, time: run.snapshot().time,
          entityId: hiringIntentFields(next).requesterEntityId, reason: 'Request a second specialist for the same authorized position' }), run.snapshot().revision)
        const started = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
          managementId: 'case-pagination-second-start', phase: 'running' }))
        assert.ok(started.result.ok)
        let idle = false
        for (let attempt = 0; attempt < 2000; attempt++) {
          const control = await client.simulations.control({ runId })
          assert.ok(control.result.ok)
          assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result.value))
          if (control.result.value.stop === 'idle' && control.result.value.driver === 'idle' && !control.result.value.inFlight
            && Object.keys(run.snapshot().world!.requests).length === 2) { idle = true; break }
          await new Promise(done => setTimeout(done, 5))
        }
        assert.equal(idle, true)
        const paused = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
          managementId: 'case-pagination-second-pause', phase: 'paused' }))
        assert.ok(paused.result.ok)
        assert.equal(calls(), 36)
      }
      const state = run.snapshot(), world = state.world
      assert.ok(world)
      assert.equal(state.phase, 'paused')
      assert.equal(world.definition.limits.maxRequests, 8)
      assert.equal(Object.keys(world.intents).length, 2)
      assert.equal(Object.keys(world.requests).length, 2)
      assert.equal(Object.keys(world.results).length, 2)
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
      assert.equal(position.capacity, 4)
      assert.equal(occupied, 3)
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
      const before = await facts(), modelCalls = calls()
      let revision = run.snapshot().revision
      assert.deepEqual(await seedHiringIntent(run, hiringIntentFields(original)), original)
      const first = await client.simulations.listWorldCases({ runId, limit: 1, expectedRevision: revision })
      assert.ok(first.result.ok)
      assert.equal(first.result.value.total, 2)
      assert.equal(first.result.value.items.length, 1)
      assert.ok(first.result.value.nextCursor)
      const second = await client.simulations.listWorldCases({ runId, limit: 1, expectedRevision: revision,
        cursor: first.result.value.nextCursor })
      assert.ok(second.result.ok)
      assert.equal(second.result.value.total, 2)
      assert.equal(second.result.value.items.length, 1)
      assert.equal(second.result.value.nextCursor, undefined)
      const ids = [...first.result.value.items, ...second.result.value.items].map(value => value.requestId)
      assert.deepEqual(ids, Object.values(world.requests).sort((a, b) => a.sequence - b.sequence).map(value => value.id))
      const staleRevision = await client.simulations.listWorldCases({ runId, limit: 1, expectedRevision: revision + 1,
        cursor: first.result.value.nextCursor })
      assert.equal(staleRevision.result.ok, false)
      const changedQuery = await client.simulations.listWorldCases({ runId, limit: 1, expectedRevision: revision,
        status: 'committed', cursor: first.result.value.nextCursor })
      assert.equal(changedQuery.result.ok, false)
      const empty = await client.simulations.listWorldCases({ runId, limit: 1, status: 'open', expectedRevision: revision })
      assert.ok(empty.result.ok)
      assert.equal(empty.result.value.total, 0)
      assert.deepEqual(empty.result.value.items, [])
      const metadata = JSON.stringify([first.result.value, second.result.value, empty.result.value])
      assert.doesNotMatch(metadata, /"(world|description|rationale|persona|Session|tokenReservations|messages|context)":/)
      for (const requestId of ids) {
        const detail = await client.simulations.inspectWorldCase({ runId, requestId, section: 'plans', expectedRevision: revision })
        assert.ok(detail.result.ok && detail.result.value.value?.section === 'plans')
        assert.equal(detail.result.value.value.items[0]?.rationale.status, 'withheld')
        assert.equal(detail.result.value.value.items[0]?.persona.status, 'withheld')
      }
      const register = ctx.simulationProducts.caseReaderRegistrar()
      const revoke = register([{ principalId: call.principal.id, runId, requestIds: [ids[0]!], content: ['case'] }])
      try {
        const changedPolicy = await client.simulations.listWorldCases({ runId, limit: 1, expectedRevision: revision,
          cursor: first.result.value.nextCursor })
        assert.equal(changedPolicy.result.ok, false)
        const allowed = await client.simulations.inspectWorldCase({ runId, requestId: ids[0]!, section: 'plans', expectedRevision: revision })
        assert.ok(allowed.result.ok && allowed.result.value.value?.section === 'plans')
        assert.equal(allowed.result.value.value.items[0]?.rationale.status, 'allowed')
        assert.equal(allowed.result.value.value.items[0]?.persona.status, 'withheld')
        const withheld = await client.simulations.inspectWorldCase({ runId, requestId: ids[1]!, section: 'plans', expectedRevision: revision })
        assert.ok(withheld.result.ok && withheld.result.value.value?.section === 'plans')
        assert.equal(withheld.result.value.value.items[0]?.rationale.status, 'withheld')
        assert.equal(withheld.result.value.value.items[0]?.persona.status, 'withheld')
      } finally { revoke() }
      const after = await client.simulations.inspectWorldCase({ runId, requestId: ids[0]!, section: 'plans', expectedRevision: revision })
      assert.ok(after.result.ok && after.result.value.value?.section === 'plans')
      assert.equal(after.result.value.value.items[0]?.rationale.status, 'withheld')
      const fresh = await client.simulations.listWorldCases({ runId, limit: 1, expectedRevision: revision })
      assert.ok(fresh.result.ok && fresh.result.value.nextCursor)
      const fence = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
        managementId: recovering ? 'case-pagination-cold-paused-observation' : 'case-pagination-new-paused-observation', phase: 'paused' }))
      assert.ok(fence.result.ok)
      const changedRevision = run.snapshot().revision
      assert.ok(changedRevision > revision)
      const oldRevision = await client.simulations.listWorldCases({ runId, limit: 1, expectedRevision: changedRevision,
        cursor: fresh.result.value.nextCursor })
      assert.equal(oldRevision.result.ok, false)
      const refreshed = await client.simulations.listWorldCases({ runId, limit: 1, expectedRevision: changedRevision })
      assert.ok(refreshed.result.ok)
      assert.equal(refreshed.result.value.total, 2)
      revision = changedRevision
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
        const checkpointInput = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'case-pagination-complete' })
        const checkpoint = await client.simulations.checkpoint(checkpointInput)
        assert.ok(checkpoint.result.ok)
        const completed = await waitCommand(checkpointInput.commandId)
        assert.equal(completed.status, 'completed')
        assert.ok(completed.checkpointId)
        assert.deepEqual(await facts(), before)
        await writeFile(proofPath, JSON.stringify(proofSchema.parse({ runId, checkpointId: completed.checkpointId, facts: before })))
      }
      console.log(JSON.stringify({ scenario, cases: 2, boundPagination: true, separateGrants: true,
        originalFacts: true, originalCommands: true,
        pausedRecovery: recovering, modelCalls: calls() }))
    })
  } finally { await lease.revoke() }
} finally { await ctx.fiber.dispose() }
