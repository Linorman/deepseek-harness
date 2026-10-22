/** Actual authenticated control races canonical owner IO and the final automatic-resume CAS. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductWorldCreateInputSchema, simulationProductManageInputSchema,
  simulationProductWorldCaseCancelInputSchema, simulationProductRestoreInputSchema,
  simulationProductCheckpointInputSchema } from '@clocky/clocky-simulation-product/schema'
import { activeSimulationMaintenance, worldExecutionObservationSchema, worldRequestIdSchema } from '@clocky/clocky-simulation'
import type { SimulationProductRequestReceipt } from '@clocky/clocky-simulation-product/types'
import type { SimulationSnapshot, SimulationRun, SimulationCheckpointCut } from '@clocky/clocky-simulation'
import { definition as originalDefinition, deployment } from './fixtures/complete-world/source.ts'
import { requests } from './fixtures/complete-world/model.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), kind = process.env.WORLD_MAINTENANCE_KIND!
const boundary = process.env.WORLD_MAINTENANCE_BOUNDARY!, intent = process.env.WORLD_MAINTENANCE_INTENT!
const recovering = process.env.WORLD_MAINTENANCE_RECOVER === 'true', face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const earlyStop = process.env.WORLD_MAINTENANCE_EARLY_STOP === 'true'
assert.ok(['hire', 'representative', 'transfer', 'depart'].includes(kind))
assert.ok(['retirement', 'sealed', 'resume'].includes(boundary)); assert.ok(['pause', 'cancel', 'none'].includes(intent))
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation-local', '@clocky/clocky-simulation-team',
  '@clocky/clocky-simulation-product', '@clocky/clocky-simulation-world'].map(name => [name, import.meta.resolve(name)]))
assert.ok(Object.values(runtimePaths).every(path => path.includes(face === 'lib' ? '/lib/' : '/src/')))
if (face === 'lib') assert.deepEqual(process.execArgv, [])
process.env.WORLD_PRODUCT_CONFIGURATION = JSON.stringify({ provider: 'local', catalog: deployment,
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })
const ctx = await boot('world-maintenance-intent', process.argv[2]!)
const entered = Promise.withResolvers<undefined>(), released = Promise.withResolvers<undefined>()
let owned: SimulationRun | undefined, selectedRequestId: string | undefined, heldCut: SimulationCheckpointCut | undefined
let resumeSelected = false, reached = false, cutAttempts = 0, barrierState: SimulationSnapshot | undefined
const errors: string[] = []
ctx.on('agent/error', ({ error }) => { errors.push(String(error)) })
const operation = kind === 'hire' ? 'generate-and-hire' : kind === 'representative' ? 'interact' : kind
function target(state: SimulationSnapshot, maintenanceId?: string) {
  const world = state.world
  if (world === undefined) return undefined
  return [...Object.values(world.reservations), ...Object.values(world.external.representatives),
    ...Object.values(world.personnel.reservations)].find((value) => {
    const plan = world.plans[value.request.planId]
    return plan?.pin.operation === operation && (maintenanceId === undefined || value.request.maintenance.id === maintenanceId)
  })
}
async function hold() {
  if (recovering || reached) return
  assert.ok(owned)
  const state = owned.snapshot(), reservation = target(state, activeSimulationMaintenance(state)?.request.id)
  assert.ok(reservation)
  selectedRequestId = reservation.requestId; barrierState = state; reached = true
  await writeFile(resolve(root, 'barrier.json'), JSON.stringify({ kind, boundary, intent, state, selectedRequestId,
    calls: requests.length, cutReference: heldCut?.reference }, null, 2))
  entered.resolve(undefined); await released.promise
}
const open = ctx.simulations.open.bind(ctx.simulations)
ctx.simulations.open = async (...args) => {
  const run = await open(...args); owned = run
  if (!recovering) {
    const acquire = run.acquireCheckpointCut.bind(run), finish = run.finishMaintenance.bind(run), phase = run.setPhase.bind(run)
    run.acquireCheckpointCut = async (...input) => {
      const cut = await acquire(...input)
      if (target(run.snapshot(), activeSimulationMaintenance(run.snapshot())?.request.id) !== undefined
        && activeSimulationMaintenance(run.snapshot()) !== undefined) { cutAttempts++; heldCut = cut }
      return cut
    }
    run.finishMaintenance = async (...input) => {
      const selected = target(run.snapshot(), input[0].id) !== undefined
      const done = await finish(...input)
      if (selected) resumeSelected = true
      return done
    }
    run.setPhase = async (...input) => {
      if (resumeSelected && input[0] === 'running' && boundary === 'resume') await hold()
      return await phase(...input)
    }
  }
  return run
}
const persistence = ctx.teams.getPersistenceReference.bind(ctx.teams)
ctx.teams.getPersistenceReference = async (...args) => {
  const reference = await persistence(...args)
  if (boundary === 'sealed' && heldCut !== undefined && !reached) await hold()
  return reference
}
const stop = ctx.teamActivations.stopOwnedActivation.bind(ctx.teamActivations)
ctx.teamActivations.stopOwnedActivation = async (...args) => {
  await stop(...args)
  const state = owned?.snapshot(), maintenance = state === undefined ? undefined : activeSimulationMaintenance(state)
  if (boundary === 'retirement' && state !== undefined && maintenance !== undefined && target(state, maintenance.request.id) !== undefined) await hold()
}
try {
  const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential: ctx.productPrincipals.bootstrapCredential('local') })
  try {
    await lease.withCall(async (call) => {
      const api = createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
      const handler = toFetchHandler(api, { authenticatedProductCall: call })
      const client = new InProcessApiClient(handler)
      const wait = async (condition: () => Promise<boolean>, reason: string) => {
        const deadline = Date.now() + 20000
        while (Date.now() < deadline) { if (await condition()) return; await new Promise(done => setTimeout(done, 5)) }
        throw new Error(reason)
      }
      const command = async (commandId: string) => {
        let value: SimulationProductRequestReceipt | undefined
        await wait(async () => {
          const found = await client.simulations.request({ commandId: commandId as import('@clocky/clocky-simulation-product').SimulationProductCommandId })
          assert.ok(found.result.ok && found.result.value.status === 'found'); value = found.result.value.request
          return found.result.value.request.status !== 'accepted'
        }, 'Original management command did not settle')
        assert.ok(value)
        return value
      }
      const rejectTerminalCancel = async (
        payload: { runId: string; requestId: string; commandId: string }, snapshot: SimulationSnapshot,
      ) => {
        const before = owned!.snapshot(), cancellations = structuredClone(before.world!.cancellations)
        const malformed = await handler.fetch(new Request('http://localhost/api/simulation.world.cases.cancel', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request',
            rpcId: 'terminal-without-quote', method: 'simulation.world.cases.cancel', payload }),
        }))
        const bad = z.object({ result: z.object({ ok: z.literal(false), error: z.object({ code: z.literal('bad-request') }) }) })
          .parse(await malformed.json())
        const quoteLess = simulationProductWorldCaseCancelInputSchema.parse({ ...payload,
          previewRevision: snapshot.revision, previewHash: `sha256:${'0'.repeat(64)}` })
        const rejected = await client.simulations.cancelWorldCase(quoteLess)
        assert.ok(!rejected.result.ok && rejected.result.error.code === 'simulation-product-management-preview-changed')
        const command = await client.simulations.request({ commandId: quoteLess.commandId })
        assert.ok(command.result.ok && command.result.value.status === 'not-found')
        assert.deepEqual(owned!.snapshot(), before); assert.deepEqual(owned!.snapshot().world!.cancellations, cancellations)
        return { payload, malformed: bad.result.error.code, refusal: rejected.result.error.code }
      }
      if (recovering) {
        const proof = JSON.parse(await readFile(resolve(root, 'proof.json'), 'utf8')) as {
          runId: string
          checkpointId: string
          state: SimulationSnapshot
          controlInput: unknown
          controlReceipt: unknown
          terminalCancelRefusal?: { payload: { runId: string; requestId: string; commandId: string } }
        }
        const restored = await client.simulations.restore(simulationProductRestoreInputSchema.parse({ runId: proof.runId,
          commandId: 'cold-explicit-restore', checkpointId: proof.checkpointId }))
        assert.ok(restored.result.ok)
        assert.equal((await command('cold-explicit-restore')).status, 'completed'); assert.ok(owned)
        assert.equal(owned.snapshot().phase, 'paused')
        const observed = await ctx.simulations.inspect({ provider: 'local', spec: owned.snapshot().spec, includeRecords: true })
        assert.ok(observed?.records); assert.deepEqual(observed.snapshot, owned.snapshot())
        const added = observed.records.filter(value => value.sequence > proof.state.revision)
        const record = z.strictObject({ kind: z.literal('run/world-execution'), runId: z.literal(proof.state.spec.runId),
          expectedRevision: z.number().int().nonnegative(), change: z.strictObject({ kind: z.literal('world/execution'),
            observation: worldExecutionObservationSchema }) })
        const originals = Object.values(proof.state.world?.executions ?? {}).filter(value => value.phase === 'armed' || value.phase === 'outcome-unknown')
        assert.equal(added.length, originals.length * 2)
        const confirmed = new Set<string>()
        let expected = structuredClone(proof.state)
        for (let i = 0; i < added.length; i += 2) {
          const arm = record.parse(added[i]!.value), settled = record.parse(added[i + 1]!.value)
          const prior = expected.world!.executions[arm.change.observation.planId]
          assert.ok(prior && (prior.phase === 'armed' || prior.phase === 'outcome-unknown') && !confirmed.has(prior.planId))
          assert.equal(arm.expectedRevision, expected.revision); assert.equal(added[i]!.sequence, expected.revision + 1)
          assert.deepEqual(arm.change.observation, { ...prior, mode: 'reconcile', phase: 'armed', reason: null,
            expectedSequence: prior.sequence, sequence: added[i]!.sequence, updates: prior.updates + 1, time: expected.time })
          assert.equal(settled.expectedRevision, added[i]!.sequence); assert.equal(added[i + 1]!.sequence, added[i]!.sequence + 1)
          assert.deepEqual(settled.change.observation, { ...arm.change.observation, phase: 'settled', reason: null,
            expectedSequence: added[i]!.sequence, sequence: added[i + 1]!.sequence, updates: prior.updates + 2 })
          confirmed.add(prior.planId)
          expected = { ...expected, revision: added[i + 1]!.sequence, world: { ...expected.world!,
            executions: { ...expected.world!.executions, [prior.planId]: settled.change.observation } } }
        }
        assert.deepEqual(owned.snapshot(), expected)
        assert.deepEqual(owned.snapshot().world, expected.world)
        assert.deepEqual(owned.snapshot().management, proof.state.management)
        assert.deepEqual(owned.snapshot().entities, proof.state.entities)
        assert.deepEqual(owned.snapshot().resources, proof.state.resources)
        const before = owned.snapshot()
        if (proof.terminalCancelRefusal !== undefined) {
          await rejectTerminalCancel(proof.terminalCancelRefusal.payload, proof.state)
          const repeat = await client.simulations.manage(simulationProductManageInputSchema.parse(proof.controlInput))
          assert.ok(repeat.result.ok); assert.deepEqual(repeat.result.value.operation, proof.controlReceipt)
        } else if (intent === 'pause') {
          const repeat = await client.simulations.manage(simulationProductManageInputSchema.parse(proof.controlInput))
          assert.ok(repeat.result.ok)
        } else if (intent === 'cancel') {
          const repeat = await client.simulations.cancelWorldCase(simulationProductWorldCaseCancelInputSchema.parse(proof.controlInput))
          assert.ok(repeat.result.ok)
          assert.deepEqual(repeat.result.value, proof.controlReceipt)
        }
        assert.deepEqual(owned.snapshot(), before); assert.equal(requests.length, 0)
        await writeFile(resolve(root, 'cold.json'), JSON.stringify({ pid: process.pid, runtimePaths, phase: 'paused', modelCalls: 0,
          originalStateUnchanged: added.length === 0, originalBusinessStateUnchanged: true, callbackConfirmationRecords: added,
          originalEntitiesResourcesManagementUnchanged: true,
          repeatedControlUnchanged: true, state: owned.snapshot() }, null, 2))
        console.log(JSON.stringify({ kind, boundary, intent, recovering, phase: 'paused', modelCalls: 0 })); return
      }
      // Keep the original actors, templates, permissions and resources; schedule only the target's real prerequisite chain.
      const definition = structuredClone(originalDefinition)
      definition.behavior.initialGoals = definition.behavior.initialGoals.filter(value => value.body === 'request-hire')
      const calendars = kind === 'representative' ? ['supplier-contact'] : kind === 'transfer' ? ['transfer-review']
        : kind === 'depart' ? ['transfer-review', 'departure-review'] : []
      definition.behavior.calendars = definition.behavior.calendars.filter(value => calendars.includes(value.id))
      const preview = await client.simulations.preflightWorld({ definition }); assert.ok(preview.result.ok && preview.result.value.status === 'ready')
      const input = simulationProductWorldCreateInputSchema.parse({ commandId: 'maintenance-world-create', name: 'Actual maintenance control race', definition,
        preflight: { hash: preview.result.value.preview.hash, catalogGeneration: preview.result.value.preview.catalogGeneration } })
      await writeFile(resolve(root, 'input.json'), JSON.stringify(input, null, 2))
      const created = await client.simulations.createWorld(input); assert.ok(created.result.ok); const runId = created.result.value.runId
      assert.equal((await command(input.commandId)).status, 'completed')
      const started = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'original-start', phase: 'running' })); assert.ok(started.result.ok)
      await wait(async () => { const control = await client.simulations.control({ runId }); assert.ok(control.result.ok)
        assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result)); return reached }, 'Actual target maintenance did not reach the barrier')
      await entered.promise; assert.ok(owned && barrierState && selectedRequestId)
      const calls = requests.length
      let controlInput: unknown, controlReceipt: unknown
      let terminalCancelRefusal: Awaited<ReturnType<typeof rejectTerminalCancel>> | undefined
      if (intent === 'pause') {
        controlInput = simulationProductManageInputSchema.parse({ runId, managementId: 'new-pause-during-maintenance', phase: 'paused' })
        const pause = await client.simulations.manage(simulationProductManageInputSchema.parse(controlInput)); assert.ok(pause.result.ok)
        assert.equal(pause.result.value.operation.status, 'completed'); controlReceipt = pause.result.value.operation
        assert.ok(Object.values(owned.snapshot().management ?? {}).some(value => value.request.id === 'new-pause-during-maintenance'))
      } else if (intent === 'cancel') {
        const observed = await client.simulations.inspectWorldCase({ runId, requestId: worldRequestIdSchema.parse(selectedRequestId), section: 'request' })
        assert.ok(observed.result.ok && observed.result.value.status === 'found')
        const quote = observed.result.value.value?.summary.cancel.preview
        if (quote === undefined && boundary === 'resume') {
          assert.equal(observed.result.value.value?.summary.cancel.allowed, false)
          assert.equal(observed.result.value.value?.summary.cancel.reason, 'terminal')
          terminalCancelRefusal = await rejectTerminalCancel({ runId, commandId: 'new-cancel-during-maintenance', requestId: selectedRequestId }, owned.snapshot())
          // The refusal records no intent; a separate explicit pause safely stops the already-committed callback's automatic resume.
          controlInput = simulationProductManageInputSchema.parse({ runId, managementId: 'pause-after-terminal-cancel-refusal', phase: 'paused' })
          const pause = await client.simulations.manage(simulationProductManageInputSchema.parse(controlInput))
          assert.ok(pause.result.ok); controlReceipt = pause.result.value.operation
        } else {
          assert.ok(quote, 'Original maintenance case requires its actual cancellation impact preview')
          controlInput = simulationProductWorldCaseCancelInputSchema.parse({ runId, commandId: 'new-cancel-during-maintenance',
            requestId: selectedRequestId, previewRevision: quote.snapshotRevision, previewHash: quote.previewHash })
          const cancel = await client.simulations.cancelWorldCase(simulationProductWorldCaseCancelInputSchema.parse(controlInput))
          assert.ok(cancel.result.ok)
          await wait(async () => {
            return Object.values(owned!.snapshot().world!.cancellations).some(value => value.request.requestId === selectedRequestId)
          }, 'Accepted product cancellation failed to enter Native before IO release')
        }
      }
      if (intent !== 'none') {
        assert.ok(owned.snapshot().revision > barrierState.revision)
        assert.equal(owned.snapshot().phase, 'paused'); assert.equal(requests.length, calls)
        if (boundary === 'sealed') await assert.rejects(owned.getPersistenceReference(heldCut!.reference.cursor), { code: 'SIM_REVISION_CONFLICT' })
      }
      await writeFile(resolve(root, 'intent-before-release.json'), JSON.stringify({ state: owned.snapshot(), calls: requests.length,
        controlInput, controlReceipt, terminalCancelRefusal, nativeQueueProgressBeforeIoRelease: intent !== 'none' }, null, 2))
      released.resolve(undefined)
      if (intent === 'none' && earlyStop) {
        await wait(async () => owned!.snapshot().phase === 'running' && activeSimulationMaintenance(owned!.snapshot()) === undefined,
          'Original maintenance did not automatically resume without new intent')
        const pause = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
          managementId: 'checkpoint-stop', phase: 'paused' }))
        assert.ok(pause.result.ok)
      }
      await wait(async () => { const control = await client.simulations.control({ runId }); assert.ok(control.result.ok)
        assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result))
        return !control.result.value.inFlight && (intent !== 'none' || earlyStop || control.result.value.stop === 'idle')
      }, 'Accepted maintenance did not drain')
      if (intent === 'cancel' && terminalCancelRefusal === undefined) controlReceipt = await command('new-cancel-during-maintenance')
      assert.equal(errors.length, 0, errors.join('\n'))
      if (intent === 'none' && !earlyStop) {
        assert.equal(owned.snapshot().phase, 'running')
        const pause = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
          managementId: 'checkpoint-stop', phase: 'paused' }))
        assert.ok(pause.result.ok)
      } else {
        assert.equal(owned.snapshot().phase, 'paused')
        if (intent !== 'none') assert.equal(requests.length, calls)
      }
      assert.equal(activeSimulationMaintenance(owned.snapshot()), undefined)
      const checkpoint = await client.simulations.checkpoint(simulationProductCheckpointInputSchema.parse({ runId, commandId: 'final-race-checkpoint' })); assert.ok(checkpoint.result.ok)
      assert.equal((await command('final-race-checkpoint')).status, 'completed')
      const state = owned.snapshot(); assert.ok(state.latestCheckpointId)
      const selected = target(state)!; assert.ok(selected)
      if (intent === 'cancel' && boundary !== 'resume') assert.ok(['cancelled', 'abandoned'].includes(selected.status))
      else assert.equal(selected.status, 'committed')
      if (boundary === 'sealed' && intent !== 'none') assert.equal(cutAttempts, 2)
      await writeFile(resolve(root, 'proof.json'), JSON.stringify({ pid: process.pid, runtimePaths, runId, checkpointId: state.latestCheckpointId,
        kind, boundary, intent, earlyStop, cutAttempts, controlInput, controlReceipt,
        terminalCancelRefusal, state, modelCalls: requests.length,
        authenticatedProductControl: true, noAutomaticResumeAfterNewIntent: intent !== 'none' }, null, 2))
      console.log(JSON.stringify({ kind, boundary, intent, recovering, phase: state.phase, modelCalls: requests.length }))
    })
  } finally { await lease.revoke() }
} catch (error: unknown) {
  await writeFile(resolve(root, 'failed.json'), JSON.stringify({ error: error instanceof Error ? error.stack : String(error),
    errors, state: owned?.snapshot(), reached, cutAttempts, selectedRequestId }, null, 2))
  throw error
} finally { released.resolve(undefined); await ctx.fiber.dispose() }
