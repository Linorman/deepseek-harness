/** Original authenticated product cancellations race real Native hiring, without replacement identities or inference on replay. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductWorldCreateInputSchema, simulationProductWorldCaseCancelInputSchema,
  simulationProductManageInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-driver-model.ts'

const scenario = z.enum(['company', 'laboratory']).parse(process.env.WORLD_SCENARIO)
const stage = z.enum(['accepted-before-reserve', 'participant-afterIO', 'committed-before-notification']).parse(process.env.WORLD_CANCEL_STAGE)
const recovering = process.env.WORLD_CASE_RECOVER === 'true', root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
process.env.WORLD_PRODUCT_CONFIGURATION = JSON.stringify({ provider: 'local', catalog: installed,
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })
const ctx = await boot('world-case-cancel', process.argv[2]!)
const proofPath = resolve(root, 'world-case-proof.json')
let owned: SimulationRun | undefined
const release = Promise.withResolvers<undefined>()
let atStage = false
const hold = async (selected: string) => {
  if (!recovering && selected === stage) { atStage = true; await release.promise }
}
const open = ctx.simulations.open.bind(ctx.simulations)
ctx.simulations.open = async (...args) => {
  const run = await open(...args)
  owned = run
  if (!recovering) {
    const reserve = run.reserveWorldHire.bind(run), commit = run.commitWorldHire.bind(run)
    run.reserveWorldHire = async (...input) => { await hold('accepted-before-reserve'); return await reserve(...input) }
    run.commitWorldHire = async (...input) => {
      const result = await commit(...input)
      await hold('committed-before-notification')
      return result
    }
  }
  return run
}
const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
ctx.teams.inviteParticipant = async (...args) => {
  const participant = await invite(...args)
  const reservation = Object.values(owned?.snapshot().world?.reservations ?? {})[0]
  if (participant.id === reservation?.identities.binding.participantId) await hold('participant-afterIO')
  return participant
}
try {
  const credential = ctx.productPrincipals.bootstrapCredential('local')
  const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential })
  try {
    await lease.withCall(async (call) => {
      const api = createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
      const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call }))
      const waitCommand = async (commandId: string) => {
        const until = Date.now() + 15000
        while (Date.now() < until) {
          const result = await client.simulations.request({ commandId: commandId as import('@clocky/clocky-simulation-product/types').SimulationProductCommandId })
          assert.ok(result.result.ok && result.result.value.status === 'found')
          if (result.result.value.request.status !== 'accepted') return result.result.value
          await new Promise(done => setTimeout(done, 5))
        }
        throw new Error('Original World cancellation failed to settle')
      }
      if (recovering) {
        const proof = JSON.parse(await readFile(proofPath, 'utf8')) as { cancel: unknown; receipt: unknown; runId: string; terminalRefusal?: true }
        // A terminal fixture retains its rejected incomplete payload only as a negative ingress probe.
        const incompleteSchema = simulationProductWorldCaseCancelInputSchema.pick({ runId: true, commandId: true, requestId: true })
        const cancel = proof.terminalRefusal ? incompleteSchema.parse(proof.cancel)
          : simulationProductWorldCaseCancelInputSchema.parse(proof.cancel)
        const queried = await client.simulations.request({ commandId: cancel.commandId })
        assert.ok(queried.result.ok)
        assert.deepEqual(queried.result.value, proof.receipt)
        const retry = await client.simulations.cancelWorldCase(cancel as never)
        if (proof.terminalRefusal) assert.ok(!retry.result.ok && retry.result.error.code === 'bad-request', JSON.stringify(retry.result))
        else {
          assert.ok(retry.result.ok && queried.result.value.status === 'found')
          assert.deepEqual(retry.result.value, queried.result.value.request)
        }
        const control = await client.simulations.control({ runId: cancel.runId })
        assert.ok(control.result.ok)
        assert.equal(control.result.value.owner, 'not-held')
        assert.equal(control.result.value.phase, 'paused')
        assert.equal(requests.length, 0)
        console.log(JSON.stringify({ scenario, stage, restored: true, modelCalls: 0 }))
        return
      }
      const definition = worldScenarioSchema.parse(JSON.parse(await readFile(
        resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
      const preview = await client.simulations.preflightWorld({ definition })
      assert.ok(preview.result.ok && preview.result.value.status === 'ready')
      const created = await client.simulations.createWorld(simulationProductWorldCreateInputSchema.parse({ commandId: 'case-world-create',
        name: 'Original case cancellation', definition,
        preflight: { hash: preview.result.value.preview.hash, catalogGeneration: preview.result.value.preview.catalogGeneration } }))
      assert.ok(created.result.ok)
      const runId = created.result.value.runId
      assert.equal((await waitCommand('case-world-create')).request.status, 'completed')
      const started = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'case-start', phase: 'running' }))
      assert.ok(started.result.ok)
      const reachedDeadline = Date.now() + 15000
      while (!atStage && Date.now() < reachedDeadline) {
        const control = await client.simulations.control({ runId })
        assert.ok(control.result.ok)
        assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result.value))
        await new Promise(done => setTimeout(done, 5))
      }
      assert.equal(atStage, true, 'Real World hiring did not reach the selected fault boundary')
      assert.ok(owned)
      const before = owned.snapshot(), original = Object.values(before.world!.requests)[0]!
      const callsBeforeReads = requests.length
      const cases = await client.simulations.listWorldCases({ runId, limit: 1, expectedRevision: before.revision })
      assert.ok(cases.result.ok, JSON.stringify(cases.result))
      assert.equal(cases.result.value.total, 1)
      assert.equal(cases.result.value.items[0]?.requestId, original.id)
      assert.equal(cases.result.value.items[0]?.cancel.allowed, stage !== 'committed-before-notification')
      const wire: unknown[] = [cases.result.value]
      for (const section of ['request', 'plans', 'execution', 'notification'] as const) {
        const detail = await client.simulations.inspectWorldCase({ runId, requestId: original.id, section })
        assert.ok(detail.result.ok && detail.result.value.status === 'found', JSON.stringify(detail.result))
        const value = detail.result.value.value
        assert.ok(value)
        wire.push(detail.result.value)
        if (value.section === 'request') assert.equal(value.description.status, 'withheld')
        if (value.section === 'plans') {
          assert.equal(value.items[0]?.rationale.status, 'withheld')
          assert.equal(value.items[0]?.persona.status, 'withheld')
        }
        assert.ok(!JSON.stringify(detail.result.value).includes('Director-private rationale'))
      }
      assert.equal(requests.length, callsBeforeReads)
      await writeFile(resolve(root, 'world-case-wire.json'), JSON.stringify(wire))
      const register = ctx.simulationProducts.caseReaderRegistrar()
      const discloseCase = register([{ principalId: call.principal.id, runId, requestIds: [original.id], content: ['case'] }])
      const prose = await client.simulations.inspectWorldCase({ runId, requestId: original.id, section: 'plans' })
      assert.ok(prose.result.ok && prose.result.value.value?.section === 'plans')
      assert.equal(prose.result.value.value.items[0]?.rationale.status, 'allowed')
      assert.equal(prose.result.value.value.items[0]?.persona.status, 'withheld')
      discloseCase()
      const disclosePersona = register([{ principalId: call.principal.id, runId, requestIds: [original.id], content: ['persona'] }])
      const persona = await client.simulations.inspectWorldCase({ runId, requestId: original.id, section: 'plans' })
      assert.ok(persona.result.ok && persona.result.value.value?.section === 'plans')
      assert.equal(persona.result.value.value.items[0]?.rationale.status, 'withheld')
      assert.equal(persona.result.value.value.items[0]?.persona.status, 'allowed')
      disclosePersona()
      const both = register([{ principalId: call.principal.id, runId, requestIds: [original.id], content: ['case', 'persona'] }])
      const observe = ctx.simulations.inspect.bind(ctx.simulations), observed = Promise.withResolvers<undefined>()
      const returnObservation = Promise.withResolvers<undefined>()
      ctx.simulations.inspect = async (...args) => {
        const result = await observe(...args)
        observed.resolve(undefined); await returnObservation.promise
        return result
      }
      const late = client.simulations.inspectWorldCase({ runId, requestId: original.id, section: 'plans' })
      await observed.promise
      both(); returnObservation.resolve(undefined)
      const withheld = await late
      ctx.simulations.inspect = observe
      assert.ok(withheld.result.ok && withheld.result.value.value?.section === 'plans')
      assert.equal(withheld.result.value.value.items[0]?.rationale.status, 'withheld')
      assert.equal(withheld.result.value.value.items[0]?.persona.status, 'withheld')
      const newPolicy = register([{ principalId: call.principal.id, runId, requestIds: [original.id], content: ['case', 'persona'] }])
      const oldPolicy = await client.simulations.inspectWorldCase({ runId, requestId: original.id, section: 'plans',
        readVersion: withheld.result.value.readVersion })
      assert.ok(oldPolicy.result.ok && oldPolicy.result.value.value?.section === 'plans')
      assert.equal(oldPolicy.result.value.value.items[0]?.rationale.status, 'withheld')
      assert.equal(oldPolicy.result.value.value.items[0]?.persona.status, 'withheld')
      newPolicy()
      assert.equal(requests.length, callsBeforeReads)
      if (stage === 'committed-before-notification') {
        assert.equal(cases.result.value.items[0].cancel.preview, undefined)
        const incomplete = { runId, commandId: 'original-case-cancel', requestId: original.id }
        assert.equal(simulationProductWorldCaseCancelInputSchema.safeParse(incomplete).success, false)
        const refused = await client.simulations.cancelWorldCase(incomplete as never)
        assert.ok(!refused.result.ok && refused.result.error.code === 'bad-request', JSON.stringify(refused.result))
        const receipt = await client.simulations.request({ commandId: incomplete.commandId as typeof created.result.value.commandId })
        assert.ok(receipt.result.ok && receipt.result.value.status === 'not-found')
        const pause = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
          managementId: 'case-pause', phase: 'paused' }))
        assert.ok(pause.result.ok); release.resolve(undefined)
        const until = Date.now() + 15000
        let drained = false
        while (Date.now() < until) {
          const control = await client.simulations.control({ runId }); assert.ok(control.result.ok)
          if (!control.result.value.inFlight) { drained = true; assert.notEqual(control.result.value.driver, 'failed'); break }
          await new Promise(done => setTimeout(done, 5))
        }
        assert.equal(drained, true)
        const state = owned.snapshot()
        assert.equal(state.phase, 'paused'); assert.equal(Object.values(state.world!.results)[0]?.outcome.kind, 'committed')
        assert.equal(Object.keys(state.world!.results).length, 1); assert.equal(Object.keys(state.world!.cancellations).length, 0)
        assert.equal(requests.length, callsBeforeReads)
        await writeFile(proofPath, JSON.stringify({ cancel: incomplete, receipt: receipt.result.value, runId, terminalRefusal: true }))
        console.log(JSON.stringify({ scenario, stage, restored: false, modelCalls: requests.length })); return
      }
      const quote = cases.result.value.items[0].cancel.preview
      assert.ok(quote, 'Original open case requires its actual cancellation impact preview')
      const cancel = simulationProductWorldCaseCancelInputSchema.parse({ runId, commandId: 'original-case-cancel', requestId: original.id,
        previewRevision: quote.snapshotRevision, previewHash: quote.previewHash })
      const accepted = await client.simulations.cancelWorldCase(cancel)
      assert.ok(accepted.result.ok)
      const repeat = await client.simulations.cancelWorldCase(cancel)
      assert.ok(repeat.result.ok)
      const pause = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'case-pause', phase: 'paused' }))
      assert.ok(pause.result.ok, JSON.stringify(pause.result))
      assert.equal(pause.result.value.control.phase, 'paused')
      if (stage === 'participant-afterIO') {
        assert.equal(owned.snapshot().world!.requests[original.id]?.status, 'cancel-requested')
        const reservation = Object.values(owned.snapshot().world!.reservations)[0]!
        assert.equal(owned.snapshot().entities[reservation.identities.entityId]?.readiness, 'preparing')
        assert.equal(owned.snapshot().entities[reservation.identities.entityId]?.writer, undefined)
      }
      release.resolve(undefined)
      const receipt = await waitCommand(cancel.commandId)
      assert.equal(receipt.request.status, 'completed')
      assert.deepEqual(receipt.worldCancellation, cancel)
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const control = await client.simulations.control({ runId })
        assert.ok(control.result.ok)
        if (!control.result.value.inFlight) { assert.notEqual(control.result.value.driver, 'failed'); break }
        await new Promise(done => setTimeout(done, 5))
      }
      const settled = await client.simulations.control({ runId })
      assert.ok(settled.result.ok && !settled.result.value.inFlight, 'Cancellation cleanup retained in-flight work')
      const state = owned.snapshot(), result = Object.values(state.world!.results)[0]!
      assert.equal(state.phase, 'paused')
      assert.equal(result.outcome.kind, 'cancelled')
      assert.equal(Object.keys(state.world!.results).length, 1)
      assert.deepEqual(state.world!.plans, before.world!.plans)
      const reservation = Object.values(state.world!.reservations)[0]
      if (stage === 'participant-afterIO') {
        assert.ok(reservation)
        assert.equal(reservation.status, 'abandoned')
        assert.equal(state.entities[reservation.identities.entityId]?.readiness, 'abandoned')
        assert.equal(state.entities[reservation.identities.entityId]?.phase, 'terminated')
        assert.deepEqual(reservation.identities, Object.values(before.world!.reservations)[0]!.identities)
        assert.ok(reservation.cleanup)
      }
      if (stage === 'accepted-before-reserve') assert.equal(reservation, undefined)
      const changed = await client.simulations.cancelWorldCase({ ...cancel, requestId: 'different-case' as typeof cancel.requestId })
      assert.equal(changed.result.ok, false)
      await writeFile(proofPath, JSON.stringify({ cancel, receipt, runId }))
      console.log(JSON.stringify({ scenario, stage, restored: false, modelCalls: requests.length }))
    })
  } finally { await lease.revoke() }
} finally { release.resolve(undefined); await ctx.fiber.dispose() }
