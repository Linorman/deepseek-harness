/** Product residency cannot recycle an unconfirmed provider stop or start another actor beyond its frozen slot count. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { AgentRuntimeTerminationUnconfirmedError, isAgentRuntimeTerminationUnconfirmed } from '@clocky/clocky-agent-runtime'
import { activationReservationIdSchema } from '@clocky/clocky-team'
import { simulationProductWorldCreateInputSchema, simulationProductManageInputSchema,
  simulationProductRestoreInputSchema, simulationProductRunIdSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductCommandId } from '@clocky/clocky-simulation-product/types'
import { simulationCheckpointIdSchema, simulationEntityIdSchema, simulationWriterEpochSchema,
  simulationRunSpecSchema, simulationResidentSlots } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationEntityId } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection, SimulationResidencyChoice, SimulationResidencyResult } from '@clocky/clocky-simulation-team'
import { worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import type {} from './world-driver-model.ts'

const scenario = z.enum(['company', 'laboratory']).parse(process.env.WORLD_SCENARIO)
const mode = z.enum(['director', 'newcomer']).parse(process.env.WORLD_RESIDENT_MODE)
const recovering = process.env.WORLD_RESIDENT_RECOVER === 'true', root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
process.env.WORLD_PRODUCT_CONFIGURATION = JSON.stringify({ provider: 'local', catalog: installed,
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })
const ctx = await boot('world-resident-capacity', process.argv[2]!)
const inputPath = resolve(root, 'world-resident-capacity-input.json'), proofPath = resolve(root, 'world-resident-capacity-proof.json')
const proofSchema = z.strictObject({ runId: simulationProductRunIdSchema, checkpointId: simulationCheckpointIdSchema,
  spec: simulationRunSpecSchema,
  blocker: simulationEntityIdSchema, epoch: simulationWriterEpochSchema, target: simulationEntityIdSchema,
  world: z.json(), operations: z.json(), selection: z.json().optional() })
let owned: SimulationRun | undefined, connection: SimulationTeamConnection | undefined
let armed = mode === 'director', refusal: { entityId: SimulationEntityId; choice: SimulationResidencyChoice } | undefined
let selected: { entityId: SimulationEntityId; choice: SimulationResidencyChoice } | undefined
let injected = false, providerRefusals = 0
const starts: SimulationEntityId[] = []
const calls = () => ctx.worldDriverProbe.requests.length
const held = (): SimulationRun => { assert.ok(owned); return owned }
const blockerId = (run: SimulationRun) => mode === 'director'
  ? run.snapshot().world!.definition.authorizations[0]!.requesterEntityId : run.snapshot().world!.definition.directorEntityId
const targetId = (run: SimulationRun) => mode === 'director' ? run.snapshot().world!.definition.directorEntityId
  : Object.values(run.snapshot().world!.reservations)[0]!.identities.entityId
const provider = ctx.agentRuntimes.getProvider('in-process')
assert.ok(provider)
const activate = provider.activate.bind(provider)
provider.activate = async (request) => {
  const started = Object.values(owned?.snapshot().entities ?? {}).find(value => value.binding?.sessionId === request.sessionId)
  if (started !== undefined) starts.push(started.id)
  const handle = await activate(request), dispose = handle.dispose.bind(handle)
  handle.dispose = async () => {
    const run = owned, entity = Object.values(run?.snapshot().entities ?? {}).find(value => value.binding?.sessionId === request.sessionId)
    if (!recovering && armed && run?.snapshot().world !== undefined && entity?.id === blockerId(run)) {
      providerRefusals++
      throw new AgentRuntimeTerminationUnconfirmedError('The real provider handle has no confirmed stop receipt')
    }
    await dispose()
  }
  return handle
}
const open = ctx.simulations.open.bind(ctx.simulations)
ctx.simulations.open = async (...args) => {
  const run = await open(...args)
  owned = run
  if (!recovering && mode === 'newcomer') {
    const finish = run.finishMaintenance.bind(run)
    run.finishMaintenance = async (...input) => {
      const result = await finish(...input)
      if (!injected && Object.values(run.snapshot().world?.results ?? {}).some(value => value.outcome.kind === 'committed')) {
        assert.ok(connection)
        injected = true
        armed = true
        const director = run.snapshot().world!.definition.directorEntityId
        await connection.activate(director, { provider: 'in-process', seed: { kind: 'resume' }, agent: { preset: 'simulation',
          options: { provider: 'world-driver-scripted', model: 'scripted' } }, signal: new AbortController().signal })
        assert.equal(calls(), 6)
      }
      return result
    }
  }
  return run
}
const attach = ctx.simulationTeams.attach.bind(ctx.simulationTeams)
ctx.simulationTeams.attach = async (...args) => {
  const attached = await attach(...args)
  connection = attached
  if (!recovering) {
    const ensure = attached.ensureResident.bind(attached)
    attached.ensureResident = async (...input) => {
      if (armed && args[0].snapshot().world !== undefined && input[0] === targetId(args[0])) {
        selected = { entityId: input[0], choice: input[1] }
      }
      try { return await ensure(...input) }
      catch (error: unknown) {
        if (isAgentRuntimeTerminationUnconfirmed(error) && providerRefusals > 0) refusal = { entityId: input[0], choice: input[1] }
        throw error
      }
    }
  }
  return attached
}
try {
  const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential: ctx.productPrincipals.bootstrapCredential('local') })
  try {
    await lease.withCall(async (call) => {
      const client = new InProcessApiClient(toFetchHandler(createApiProxy(ctx, { cwd: process.cwd(),
        defaultModelSelection: () => undefined }), { authenticatedProductCall: call }))
      const waitCommand = async (commandId: SimulationProductCommandId) => {
        for (let attempt = 0; attempt < 2000; attempt++) {
          const found = await client.simulations.request({ commandId })
          assert.ok(found.result.ok && found.result.value.status === 'found')
          if (found.result.value.request.status !== 'accepted') return found.result.value.request
          await new Promise(done => setTimeout(done, 5))
        }
        throw new Error('Resident product command did not settle')
      }
      const input = recovering ? simulationProductWorldCreateInputSchema.parse(JSON.parse(await readFile(inputPath, 'utf8')))
        : await (async () => {
          const definition = worldScenarioSchema.parse(JSON.parse(await readFile(
            resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
          definition.limits = { ...definition.limits, native: { ...definition.limits?.native, maxResidentActors: 1 } }
          const preview = await client.simulations.preflightWorld({ definition })
          assert.ok(preview.result.ok && preview.result.value.status === 'ready', JSON.stringify(preview.result))
          const original = simulationProductWorldCreateInputSchema.parse({ commandId: 'resident-original-create', name: 'Resident capacity',
            definition, preflight: { hash: preview.result.value.preview.hash,
              catalogGeneration: preview.result.value.preview.catalogGeneration } })
          await writeFile(inputPath, JSON.stringify(original))
          return original
        })()
      const created = await client.simulations.createWorld(input)
      assert.ok(created.result.ok)
      const runId = created.result.value.runId
      assert.equal((await waitCommand(input.commandId)).status, 'completed')
      assert.equal(calls(), 0)
      if (recovering) {
        const proof = proofSchema.parse(JSON.parse(await readFile(proofPath, 'utf8')))
        assert.equal(runId, proof.runId)
        const old = await client.simulations.inspect({ runId })
        assert.ok(old.result.ok)
        const native = await ctx.simulations.inspect({ provider: 'local', spec: proof.spec })
        assert.ok(native)
        assert.equal(native.snapshot.entities[proof.blocker]?.writer?.phase, 'revoked')
        assert.equal(simulationResidentSlots(native.snapshot, native.owner).used, 1)
        assert.equal(calls(), 0)
        const restore = simulationProductRestoreInputSchema.parse({ runId, commandId: 'resident-explicit-restore', checkpointId: proof.checkpointId })
        const restored = await client.simulations.restore(restore)
        assert.ok(restored.result.ok)
        assert.equal((await waitCommand(restore.commandId)).status, 'completed')
        const run = held(), state = run.snapshot()
        assert.equal(state.phase, 'paused')
        assert.equal(state.entities[proof.blocker]?.writer?.phase, 'released')
        assert.equal(state.entities[proof.blocker]?.writer?.epoch, proof.epoch)
        assert.equal(run.population().chargedActors, 0)
        assert.equal(calls(), 0)
        assert.equal(starts.length, 0)
        assert.deepEqual(state.world, proof.world)
        assert.deepEqual(state.operations, proof.operations)
        if (proof.selection !== undefined) assert.deepEqual(state.decisionDispatch, proof.selection)
        assert.equal(state.entities[proof.target]?.writer, undefined)
        console.log(JSON.stringify({ scenario, mode, coldRecovery: true, modelCalls: 0, releasedAfterRestore: true,
          originalResponsibility: true, chargedActors: 0, targetStarts: 0 }))
        return
      }
      const started = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
        managementId: 'resident-original-start', phase: 'running' }))
      assert.ok(started.result.ok)
      let observation
      for (let attempt = 0; attempt < 2000; attempt++) {
        const control = await client.simulations.control({ runId })
        assert.ok(control.result.ok)
        if (providerRefusals > 0 && !control.result.value.inFlight) { observation = control.result.value; break }
        await new Promise(done => setTimeout(done, 5))
      }
      assert.ok(observation)
      assert.ok(connection)
      const run = held(), state = run.snapshot(), blocker = blockerId(run), target = targetId(run)
      assert.equal(state.spec.maxResidentActors, 1)
      assert.equal(state.entities[blocker]?.writer?.phase, 'revoked')
      assert.equal(run.population().chargedActors, 1)
      assert.equal(state.entities[target]?.writer, undefined)
      assert.equal(calls(), mode === 'director' ? 3 : 6)
      assert.equal(ctx.worldDriverProbe.requests.filter(value => value.entityId === target).length, 0)
      assert.equal(starts.filter(value => value === target).length, 0)
      if (mode === 'director') {
        const original = Object.values(state.world!.requests)[0]!
        assert.ok(original.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
        assert.ok(state.operations[original.notificationOperationId]?.outbox?.receipt)
        assert.equal(state.operations[original.notificationOperationId]?.delivery, undefined)
        assert.equal(Object.keys(state.world!.plans).length, 0)
      } else {
        assert.equal(Object.values(state.world!.results)[0]?.outcome.kind, 'committed')
        const dispatch = state.decisionDispatch
        assert.ok(dispatch?.active)
        const selection = dispatch.selections[dispatch.active]
        assert.ok(selection)
        assert.equal(selection.status, 'reserved')
        const decisionId = selection.decisions[0]
        assert.ok(decisionId)
        assert.equal(dispatch.tickets[decisionId]?.candidate.entityId, target)
        assert.equal(state.activeWindowId, undefined)
      }
      const revision = state.revision
      assert.ok(selected)
      const originalStarts = starts.length, originalCalls = calls()
      for (let attempt = 0; attempt < 3; attempt++) {
        const observed: SimulationResidencyResult = await connection.ensureResident(selected.entityId, selected.choice)
        assert.equal(observed.status, 'recovery-required')
        if (observed.status === 'recovery-required') assert.equal(run.snapshot().entities[observed.entityId]?.writer?.phase, 'revoked')
        assert.equal(run.snapshot().revision, revision)
        assert.equal(run.population().chargedActors, 1)
        assert.equal(starts.length, originalStarts)
        assert.equal(calls(), originalCalls)
      }
      await assert.rejects(run.reserveWriter(target, 'in-process', activationReservationIdSchema.parse('resident-overflow-probe'), revision),
        /resident actor capacity exceeded/)
      assert.equal(run.snapshot().revision, revision)
      assert.equal(run.population().chargedActors, 1)
      const paused = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
        managementId: 'resident-original-pause', phase: 'paused' }))
      assert.ok(paused.result.ok)
      const retained = run.snapshot()
      assert.ok(retained.latestCheckpointId)
      await writeFile(proofPath, JSON.stringify(proofSchema.parse({ runId, checkpointId: retained.latestCheckpointId,
        spec: retained.spec,
        blocker, epoch: retained.entities[blocker]!.writer!.epoch, target, world: retained.world,
        operations: retained.operations, ...mode === 'newcomer' ? { selection: retained.decisionDispatch } : {} })))
      process.send?.({ event: 'world-resident-unconfirmed', mode, driver: observation.driver, stop: observation.stop ?? null,
        modelCalls: calls(), chargedActors: run.population().chargedActors, targetStarts: 0, originalResponsibility: true,
        capturedTypedRefusal: refusal !== undefined })
      await new Promise<undefined>((done) => { process.once('message', () => { done(undefined) }) })
    })
  } finally { await lease.revoke() }
} finally { await ctx.fiber.dispose() }
