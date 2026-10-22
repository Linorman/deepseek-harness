import { simulationWorldHireCommittedResultPayloadSchema } from '@clocky/clocky-simulation'
/** Real authenticated product creation/start/pause/checkpoint/restore over a single World scheduling owner. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductWorldCreateInputSchema, simulationProductManageInputSchema,
  simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema,
  simulationProductRunIdSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationOperationIdSchema, worldRequestIdSchema, simulationWakeRequestSchema, simulationWorldGoalSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-driver-model.ts'
import { installWorldRetirementProbe, verifyWorldRetirementRestored } from './world-retirement-probe.ts'
import { applyWorldLimitScenario } from './world-limits-scenario.ts'
import { verifyProductWorldLimits } from './world-product-limits-scenario.ts'
import { verifyProductWorldModelPool } from './world-product-model-pool-scenario.ts'
import { verifyWorldActivationHistory } from './world-activation-history-scenario.ts'
import { verifyWorldSubmissionLimits } from './world-submission-limits-scenario.ts'
import { verifyWorldMessageBytes } from './world-message-bytes-scenario.ts'
import { verifyWorldOutboxRetry } from './world-outbox-retry-scenario.ts'
import { verifyWorldOwnerReplanning } from './world-owner-replanning-scenario.ts'

const scenario = z.enum(['company', 'laboratory']).parse(process.env.WORLD_SCENARIO)
const recovering = process.env.WORLD_OWNER_RECOVER === 'true', root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
process.env.WORLD_PRODUCT_CONFIGURATION = JSON.stringify({ provider: 'local', catalog: installed,
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })
const ctx = await boot('world-owner', process.argv[2]!)
const inputPath = resolve(root, 'world-owner-input.json'), proofPath = resolve(root, 'world-owner-proof.json')
const proofSchema = z.strictObject({ runId: simulationProductRunIdSchema, checkpointId: z.string(), world: z.json(),
  newcomer: z.json().optional(), assignment: z.json().optional(), notificationEnvelope: z.json().optional() })
let owned: SimulationRun | undefined
const open = ctx.simulations.open.bind(ctx.simulations)
const attach = ctx.simulationTeams.attach.bind(ctx.simulationTeams)
ctx.simulationTeams.attach = async (...args) => {
  const connection = await attach(...args), run = args[0]
  const participant = connection.ensureParticipant.bind(connection)
  connection.ensureParticipant = async (...input) => {
    const binding = await participant(...input)
    const original = Object.values(run.snapshot().world?.reservations ?? {}).find(value => value.identities.entityId === input[0])
    if (original?.status === 'preparing') {
      const team = await ctx.teams.getTeam({ teamId: binding.teamId })
      assert.equal(team.participants.find(value => value.id === binding.participantId)?.phase, 'active')
      await assert.rejects(ctx.teamActivations.activate({ ...binding, expectedCursor: team.team.cursor,
        provider: 'in-process', seed: { kind: 'fresh' }, agent: { preset: 'simulation',
          options: { provider: 'world-driver-scripted', model: 'scripted' } }, signal: new AbortController().signal }), /ready|maintenance/)
      assert.equal(run.snapshot().entities[input[0]]?.readiness, 'preparing')
      assert.equal(run.snapshot().entities[input[0]]?.writer, undefined)
    }
    return binding
  }
  return connection
}
let originalRunId: ReturnType<typeof simulationProductRunIdSchema.parse> | undefined
const hold = async (stage: string, notificationEnvelope?: unknown) => {
  if (recovering || process.env.WORLD_OWNER_CRASH !== stage) return
  assert.ok(owned)
  assert.ok(originalRunId)
  const state = owned.snapshot(), result = Object.values(state.world?.results ?? {})[0]
  assert.ok(state.latestCheckpointId)
  await writeFile(proofPath, JSON.stringify(proofSchema.parse({ runId: originalRunId, checkpointId: state.latestCheckpointId,
    world: state.world, ...notificationEnvelope === undefined ? {} : { notificationEnvelope },
    ...result?.outcome.kind !== 'committed' ? {} : {
      newcomer: state.entities[simulationWorldHireCommittedResultPayloadSchema.parse(result.payload).entityId],
      assignment: state.relations[simulationWorldHireCommittedResultPayloadSchema.parse(result.payload).relationId] } })))
  process.send?.('durable')
  await new Promise<void>((done) => { process.once('message', () => { done() }) })
}
ctx.simulations.open = async (...args) => {
  const run = await open(...args)
  if (run.snapshot().spec.runId === 'world-pool-holder') return run
  owned = run
  if (!recovering) {
    const commitWindow = run.commitWindow.bind(run)
    run.commitWindow = async (...input) => {
      const window = await commitWindow(...input)
      const request = Object.values(run.snapshot().world?.requests ?? {})[0]
      const notificationId = request?.notificationOperationId
      if (notificationId !== undefined) assert.ok(notificationId !== null, 'Ordinary request requires its Channel notification')
      if (notificationId !== undefined && Object.keys(run.snapshot().world?.plans ?? {}).length === 0
        && run.snapshot().operations[notificationId]?.outbox?.receipt === undefined) await hold('request-before-publish')
      return window
    }
    const reserve = run.reserveWorldHire.bind(run)
    run.reserveWorldHire = async (...input) => { await hold('accepted-before-reserve'); return await reserve(...input) }
    const commit = run.commitWorldHire.bind(run)
    run.commitWorldHire = async (...input) => {
      await hold('commit-before')
      const result = await commit(...input)
      await hold('committed-before-notification')
      return result
    }
  }
  return run
}
if (!recovering) {
  const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
  ctx.teams.postChannelEnvelope = async (...args) => {
    const envelope = await post(...args)
    const state = owned?.snapshot(), request = Object.values(state?.world?.requests ?? {})[0]
    const notificationId = request?.notificationOperationId
    if (notificationId !== undefined) assert.ok(notificationId !== null, 'Ordinary request requires its Channel notification')
    const operation = notificationId === undefined ? undefined : state?.operations[notificationId]
    if (operation?.action.kind === 'communication/post' && operation.outbox?.receipt === undefined
      && envelope.channelId === operation.action.channelId
      && JSON.stringify(envelope.payload) === JSON.stringify({ content: [{ type: 'text', text: operation.action.text }] })) {
      await hold('request-channel-afterIO', envelope)
    }
    return envelope
  }
  const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
  ctx.teams.inviteParticipant = async (...args) => {
    const target = await invite(...args)
    const id = Object.values(owned?.snapshot().world?.reservations ?? {})[0]?.identities.binding.participantId
    if (target.id === id) await hold('participant-afterIO')
    return target
  }
}
installWorldRetirementProbe(ctx, recovering, stage => hold(stage))
try {
  const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential: ctx.productPrincipals.bootstrapCredential('local') })
  try {
    await lease.withCall(async (call) => {
      const api = createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
      const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call }))
      const waitCommand = async (commandId: string) => {
        const until = Date.now() + 15000
        while (Date.now() < until) {
          const result = await client.simulations.request({ commandId: commandId as import('@clocky/clocky-simulation-product/types').SimulationProductCommandId })
          assert.ok(result.result.ok && result.result.value.status === 'found')
          if (result.result.value.request.status !== 'accepted') return result.result.value.request
          await new Promise(done => setTimeout(done, 5))
        }
        throw new Error('Original product command did not settle within the fixture bound')
      }
      if (process.env.WORLD_OWNER_LIMIT === 'true' && process.env.WORLD_DRIVER_LIMIT === 'context') {
        const definition = worldScenarioSchema.parse(JSON.parse(await readFile(
          resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
        const preview = await client.simulations.preflightWorld({ definition })
        assert.ok(preview.result.ok && preview.result.value.status === 'invalid', JSON.stringify(preview.result))
        assert.ok(preview.result.value.diagnostics.some(value => value.code === 'capacity'
          && value.message.includes('context-bytes') && value.message.includes('512')))
        const prior = await client.simulations.request({ commandId: 'original-world-owner' as import('@clocky/clocky-simulation-product/types').SimulationProductCommandId })
        assert.ok(prior.result.ok && prior.result.value.status === 'not-found')
        const listed = await client.simulations.list({})
        assert.ok(listed.result.ok && listed.result.value.items.length === 0)
        assert.equal(owned, undefined)
        assert.deepEqual(await ctx.sessionPersistence.list(), [])
        assert.equal(requests.length, 0)
        console.log(JSON.stringify({ scenario, mode: 'context', preflight: 'invalid', dimension: 'context-bytes',
          noRunAllocation: true, noAcceptedCommand: true, modelCalls: 0, repeatedColdPreflight: recovering }))
        return
      }
      const proof = recovering && process.env.WORLD_OWNER_LIMIT !== 'true' && process.env.WORLD_OWNER_POOL === undefined
        && process.env.WORLD_OWNER_ACTIVATION === undefined
        && process.env.WORLD_SUBMISSION_LIMIT === undefined
        && process.env.WORLD_MESSAGE_BYTES === undefined && process.env.WORLD_OUTBOX_RETRY === undefined
        ? proofSchema.parse(JSON.parse(await readFile(proofPath, 'utf8'))) : undefined
      let input
      if (recovering) input = simulationProductWorldCreateInputSchema.parse(JSON.parse(await readFile(inputPath, 'utf8')))
      else {
        const definition = worldScenarioSchema.parse(JSON.parse(await readFile(
          resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
        if (process.env.WORLD_AUTONOMOUS === 'true') definition.initialEvents = []
        applyWorldLimitScenario(definition)
        const preview = await client.simulations.preflightWorld({ definition })
        assert.ok(preview.result.ok && preview.result.value.status === 'ready', JSON.stringify(preview.result))
        input = simulationProductWorldCreateInputSchema.parse({ commandId: 'original-world-owner', name: 'World execution', definition,
          preflight: { hash: preview.result.value.preview.hash, catalogGeneration: preview.result.value.preview.catalogGeneration } })
        await writeFile(inputPath, JSON.stringify(input))
      }
      const created = await client.simulations.createWorld(input)
      assert.ok(created.result.ok, JSON.stringify(created.result))
      const runId = created.result.value.runId
      originalRunId = runId
      assert.equal((await waitCommand(input.commandId)).status, 'completed')
      if (!recovering && process.env.WORLD_AUTONOMOUS === 'true') {
        assert.ok(owned)
        assert.equal(Object.keys(owned.snapshot().world?.intents ?? {}).length, 0)
        assert.equal(Object.keys(owned.snapshot().world?.requests ?? {}).length, 0)
        await owned.scheduleWake(simulationWakeRequestSchema.parse({ id: 'organization-goal', time: '0',
          entityId: 'requester', reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1,
            goal: 'Meet the project goal by requesting one additional qualified colleague.' })) }), owned.snapshot().revision)
      }
      let control = await client.simulations.control({ runId })
      assert.ok(control.result.ok)
      if (!recovering || process.env.WORLD_OWNER_CRASH === '') assert.equal(control.result.value.phase, 'paused')
      assert.equal(requests.length, 0)
      const start = simulationProductManageInputSchema.parse({ runId, managementId: 'original-world-start', phase: 'running' })
      if (process.env.WORLD_OWNER_REPLAN === 'true') {
        assert.ok(owned)
        await verifyWorldOwnerReplanning(client, owned, input, scenario)
      } else if (process.env.WORLD_OUTBOX_RETRY !== undefined) {
        await verifyWorldOutboxRetry(ctx, client, () => owned, input, recovering, scenario)
      } else if (process.env.WORLD_MESSAGE_BYTES !== undefined) {
        await verifyWorldMessageBytes(client, () => owned, input, recovering, scenario)
      } else if (process.env.WORLD_SUBMISSION_LIMIT !== undefined) {
        await verifyWorldSubmissionLimits(ctx, client, () => owned, input, recovering, scenario)
      } else if (process.env.WORLD_OWNER_ACTIVATION !== undefined) {
        await verifyWorldActivationHistory(ctx, client, () => owned, input, recovering, scenario)
      } else if (process.env.WORLD_OWNER_POOL !== undefined) {
        await verifyProductWorldModelPool(ctx, client, () => owned, input, installed, recovering, scenario)
      } else if (process.env.WORLD_OWNER_LIMIT === 'true') {
        await verifyProductWorldLimits(client, () => owned, input, recovering, scenario)
      } else {
        if (recovering) {
          assert.ok(proof)
          assert.equal(runId, proof.runId)
          assert.equal(control.result.value.owner, 'not-held')
          assert.equal(control.result.value.actions.start.allowed, false)
          const restore = await client.simulations.restore(simulationProductRestoreInputSchema.parse({ runId,
            commandId: 'explicit-world-restore', checkpointId: proof.checkpointId }))
          assert.ok(restore.result.ok)
          assert.equal((await waitCommand('explicit-world-restore')).status, 'completed')
          control = await client.simulations.control({ runId })
          assert.ok(control.result.ok)
          assert.equal(control.result.value.phase, 'paused')
          const original = await client.simulations.manage(start)
          assert.ok(original.result.ok)
          assert.equal(original.result.value.operation.status, 'completed')
          assert.equal(original.result.value.control.phase, 'paused')
          assert.equal(requests.length, 0)
          if (process.env.WORLD_OWNER_CRASH?.startsWith('retirement-')) {
            assert.ok(owned)
            await verifyWorldRetirementRestored(owned)
          }
          if (process.env.WORLD_OWNER_CRASH !== '') {
            const continued = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
              managementId: 'explicit-continue-after-recovery', phase: 'running' }))
            assert.ok(continued.result.ok)
            const until = Date.now() + 15000
            while (Date.now() < until) {
              control = await client.simulations.control({ runId })
              assert.ok(control.result.ok)
              if (control.result.value.stop === 'idle' && !control.result.value.inFlight) break
              assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result.value))
              await new Promise(done => setTimeout(done, 5))
            }
            assert.ok(control.result.ok && control.result.value.stop === 'idle')
            await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
              managementId: 'pause-after-recovered-responsibility', phase: 'paused' }))
            assert.equal(requests.length, process.env.WORLD_OWNER_CRASH?.startsWith('request-') ? 15 : 12)
          }
        } else {
          assert.equal(control.result.value.owner, 'held')
          assert.equal(control.result.value.actions.start.allowed, true)
          assert.equal(control.result.value.budget.model.provider, 'world-driver-scripted')
          const [first, repeat] = await Promise.all([client.simulations.manage(start), client.simulations.manage(start)])
          assert.ok(first.result.ok && repeat.result.ok, JSON.stringify(first.result))
          assert.deepEqual(first.result.value.operation, repeat.result.value.operation)
          const until = Date.now() + 15000
          while (Date.now() < until) {
            control = await client.simulations.control({ runId })
            assert.ok(control.result.ok)
            if (control.result.value.stop === 'idle' && !control.result.value.inFlight) break
            assert.notEqual(control.result.value.driver, 'failed', JSON.stringify(control.result.value))
            await new Promise(done => setTimeout(done, 5))
          }
          assert.ok(control.result.ok && control.result.value.stop === 'idle')
          assert.equal(requests.length, 18)
          const pause = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId,
            managementId: 'explicit-world-pause', phase: 'paused' }))
          assert.ok(pause.result.ok)
          const lateStart = await client.simulations.manage(start)
          assert.ok(lateStart.result.ok)
          assert.equal(lateStart.result.value.control.phase, 'paused')
          const checkpoint = await client.simulations.checkpoint(simulationProductCheckpointInputSchema.parse({ runId, commandId: 'world-complete' }))
          assert.ok(checkpoint.result.ok)
          const completed = await waitCommand('world-complete')
          assert.equal(completed.status, 'completed')
          assert.ok(completed.checkpointId)
          assert.ok(owned)
          const state = owned.snapshot(), result = Object.values(state.world!.results)[0]!
          if (process.env.WORLD_AUTONOMOUS === 'true') {
            const request = Object.values(state.world!.requests)[0]
            assert.ok(request)
            assert.ok(request.source.kind === 'decision')
            const decision = state.decisions[request.source.decisionId]
            assert.ok(decision?.context?.status === 'prepared' && decision.context.world?.kind === 'goal')
            assert.ok(decision.consumption)
            assert.equal(request.source.epoch, decision.epoch)
            assert.equal(request.requesterEntityId, decision.entityId)
            assert.deepEqual(request.source.binding, state.entities[decision.entityId]?.binding)
            assert.deepEqual(state.operations[request.operationId]?.worldPin, request.pin)
            assert.equal(Object.keys(state.world!.intents).length, 1)
          }
          assert.equal(result.outcome.kind, 'committed')
          if (result.outcome.kind !== 'committed') throw new Error('World product must produce a real committed result')
          await writeFile(proofPath, JSON.stringify(proofSchema.parse({ runId, checkpointId: completed.checkpointId,
            world: state.world, newcomer: state.entities[simulationWorldHireCommittedResultPayloadSchema.parse(result.payload).entityId],
            assignment: state.relations[simulationWorldHireCommittedResultPayloadSchema.parse(result.payload).relationId] })))
        }
        assert.ok(owned)
        const state = owned.snapshot(), result = Object.values(state.world!.results)[0]!
        assert.equal(result.outcome.kind, 'committed')
        if (result.outcome.kind !== 'committed') throw new Error('World recovery lost its original employment')
        if (proof !== undefined) {
          const prefix = proof.world as { plans: unknown
            requests: unknown
            reservations: Record<string, { identities: unknown }> }
          if (process.env.WORLD_OWNER_CRASH?.startsWith('request-')) {
            const prefixRequests = z.record(z.string(), z.record(z.string(), z.json())).parse(prefix.requests)
            for (const [key, original] of Object.entries(prefixRequests)) {
              const requestId = worldRequestIdSchema.parse(original['id'])
              const operationId = simulationOperationIdSchema.parse(original['operationId'])
              const notificationOperationId = simulationOperationIdSchema.parse(original['notificationOperationId'])
              assert.equal(key, requestId)
              const { status: _status, plans: _plans, ...facts } = original
              const retained = state.world!.requests[requestId]!
              const { status: _currentStatus, plans: _currentPlans, ...current } = retained
              assert.deepEqual(current, facts)
              const notification = state.operations[notificationOperationId]!
              assert.deepEqual(notification.dependencies, [operationId])
              assert.ok(notification.outbox?.receipt)
              const receipt = notification.outbox.receipt
              const channel = await ctx.teams.readChannel({ channelId: receipt.channelId, afterCursor: -1 })
              assert.equal(channel.records.filter(value => value.type === 'channel/envelope'
              && value.envelope.id === receipt.envelopeId).length, 1)
              if (proof.notificationEnvelope !== undefined) {
                const envelope = proof.notificationEnvelope as { id: string; channelId: string; sequence: number }
                assert.equal(receipt.envelopeId, envelope.id)
                assert.equal(receipt.channelId, envelope.channelId)
                assert.equal(receipt.sequence, envelope.sequence)
              }
            }
            assert.equal(Object.keys(state.world!.requests).length, 1)
            assert.equal(Object.keys(state.world!.plans).length, 1)
          } else assert.deepEqual(state.world!.plans, prefix.plans)
          for (const [id, reservation] of Object.entries(prefix.reservations)) {
            assert.deepEqual(state.world!.reservations[id as import('@clocky/clocky-simulation').WorldIntentId]?.identities, reservation.identities)
          }
          if (process.env.WORLD_OWNER_CRASH === '') {
            assert.deepEqual(state.world, proof.world)
            assert.deepEqual(state.entities[simulationWorldHireCommittedResultPayloadSchema.parse(result.payload).entityId], proof.newcomer)
            assert.deepEqual(state.relations[simulationWorldHireCommittedResultPayloadSchema.parse(result.payload).relationId],
              proof.assignment)
          }
        }
        const calls = requests.length
        for (let index = 0; index < 3; index++) {
          await client.simulations.control({ runId })
          await client.simulations.inspect({ runId })
          await client.simulations.exportWorldDefinition({ runId })
        }
        assert.equal(requests.length, calls)
        console.log(JSON.stringify({ scenario, originalProduct: true, oneOwner: true, committed: true,
          independentNewcomer: true, phase: state.phase, originalStartRetryKeepsPause: true, restored: recovering, modelCalls: calls }))
      }
    })
  } finally { await lease.revoke() }
} finally { await ctx.fiber.dispose() }
