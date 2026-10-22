/** Real authenticated case projections and exact recovery after an armed callback process is killed. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { simulationRunSpecSchema, simulationOperationIdSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot } from '@clocky/clocky-simulation'
import { teamEnvelopeSchema } from '@clocky/clocky-team'
import { simulationProductWorldCreateInputSchema, simulationProductRunIdSchema, simulationProductManageInputSchema,
  simulationProductRestoreInputSchema } from '@clocky/clocky-simulation-product/schema'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), stage = process.env.WORLD_EXECUTION_STAGE!
assert.ok(['rejected', 'blocked', 'armed', 'participant', 'committed', 'notification'].includes(stage))
const round = Number(process.env.WORLD_EXECUTION_ROUND ?? '0'), face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local',
  '@clocky/clocky-simulation-product', '@clocky/clocky-simulation-world'].map(name => [name, import.meta.resolve(name)]))
assert.ok(Object.values(runtimePaths).every(path => path.includes(face === 'lib' ? '/lib/' : '/src/')))
if (face === 'lib') assert.deepEqual(process.execArgv, [])
const installed = catalog()
if (stage === 'rejected') process.env.WORLD_DRIVER_REJECT_DESCRIPTION = 'Missing second case requirements'
installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
process.env.WORLD_PRODUCT_CONFIGURATION = JSON.stringify({ provider: 'local', catalog: installed,
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })
const ctx = await boot('world-execution-observation', process.argv[2]!)
let owned: SimulationRun | undefined, reached = false
function currentOwner(): SimulationRun | undefined { return owned }
const open = ctx.simulations.open.bind(ctx.simulations)
const second = (state: SimulationSnapshot) => Object.values(state.world?.requests ?? {}).find(value =>
  value.proposal.businessKey === 'second-colleague')
const proofPath = resolve(root, 'barrier.json'), identityPath = resolve(root, 'identity.json')
let capture: (() => Promise<void>) | undefined
async function hold(selected: string) {
  if (round !== 0 || selected !== stage || reached || !owned || !second(owned.snapshot())) return
  reached = true
  assert.ok(capture); await capture()
  process.send?.('durable')
  await new Promise<void>((done) => { process.once('message', () => { done() }) })
}
ctx.simulations.open = async (...args) => {
  const run = await open(...args); owned = run
  if (round === 0) {
    const record = run.recordWorldExecution.bind(run), commit = run.commitWorldHire.bind(run)
    run.recordWorldExecution = async (...input) => {
      const value = await record(...input)
      if (value.phase === 'armed' && value.mode === 'execute') await hold('armed')
      return value
    }
    run.commitWorldHire = async (...input) => { const value = await commit(...input); await hold('committed'); return value }
  }
  return run
}
const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
ctx.teams.inviteParticipant = async (...args) => {
  const participant = await invite(...args), state = owned?.snapshot(), request = state && second(state)
  const reservation = request && state?.world?.reservations[request.intentId]
  if (participant.id === reservation?.identities.binding.participantId) await hold('participant')
  return participant
}
const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
ctx.teams.postChannelEnvelope = async (...args) => {
  const receipt = await post(...args)
  if (round === 0 && stage === 'notification' && args[0].idempotencyKey) {
    const key: unknown = JSON.parse(args[0].idempotencyKey)
    assert.ok(Array.isArray(key) && typeof key[2] === 'string')
    const state = owned?.snapshot(), request = state && second(state)
    const operation = state?.operations[simulationOperationIdSchema.parse(key[2])]
    const context = operation && state?.decisions[operation.decisionId]?.context
    if (operation && request && context?.status === 'prepared' && context.world?.kind === 'result'
      && context.world.intentId === request.intentId) {
      await writeFile(resolve(root, 'canonical-notification.json'), JSON.stringify({ key, receipt, operationId: operation.id }))
      throw new Error('Actual canonical Envelope accepted; original receipt was lost')
    }
  }
  return receipt
}
const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential: ctx.productPrincipals.bootstrapCredential('local') })
try {
  await lease.withCall(async (call) => {
    const api = createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call }))
    const wait = async (condition: () => Promise<boolean>) => {
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) { if (await condition()) return; await new Promise(done => setTimeout(done, 5)) }
      throw new Error('Actual product flow did not reach its declared boundary')
    }
    const command = async (id: string) => {
      await wait(async () => {
        const result = await client.simulations.request({ commandId: id as never })
        assert.ok(result.result.ok && result.result.value.status === 'found')
        return result.result.value.request.status !== 'accepted'
      })
      const result = await client.simulations.request({ commandId: id as never })
      assert.ok(result.result.ok && result.result.value.status === 'found')
      assert.equal(result.result.value.request.status, 'completed', JSON.stringify(result.result.value))
      return result.result.value
    }
    const notificationEvidence = async (state: SimulationSnapshot, expected?: SimulationSnapshot) => {
      if (stage !== 'notification') return undefined
      const canonical = z.strictObject({ key: z.array(z.string()), receipt: teamEnvelopeSchema,
        operationId: simulationOperationIdSchema }).parse(JSON.parse(await readFile(resolve(root, 'canonical-notification.json'), 'utf8')))
      const operation = state.operations[canonical.operationId]; assert.ok(operation)
      assert.equal(operation.status, 'outcome-unknown')
      if (expected) assert.deepEqual(operation, expected.operations[canonical.operationId])
      const page = await ctx.teams.readChannelPage({ channelId: canonical.receipt.channelId, afterCursor: -1, limit: 128 })
      assert.equal(page.nextCursor, undefined, 'This finite fixture must inspect the complete canonical Channel prefix')
      const matches = page.records.filter(value => value.type === 'channel/envelope'
        && value.envelope.id === canonical.receipt.id)
      assert.equal(matches.length, 1)
      assert.equal(page.records.filter(value => value.type === 'channel/envelope'
        && value.envelope.senderId === canonical.receipt.senderId
        && JSON.stringify(value.envelope.payload) === JSON.stringify(canonical.receipt.payload)).length, 1)
      const target = matches[0]; assert.ok(target?.type === 'channel/envelope')
      assert.deepEqual(target.envelope, canonical.receipt)
      return { canonical, record: target, channelCursor: page.channel.cursor }
    }
    const inspectCases = async (runId: ReturnType<typeof simulationProductRunIdSchema.parse>, state: SimulationSnapshot,
      reconciled = round > 1) => {
      const items = []
      for (const request of Object.values(state.world!.requests)) {
        const views = []
        for (const section of ['request', 'plans', 'execution', 'notification'] as const) {
          const result = await client.simulations.inspectWorldCase({ runId, requestId: request.id, section })
          assert.ok(result.result.ok && result.result.value.status === 'found', JSON.stringify(result.result))
          const view = result.result.value.value; assert.ok(view)
          assert.equal(view.summary.status, request.status)
          if (view.section === 'request') assert.deepEqual(view.source, {
            operationId: request.operationId, sequence: request.sequence, payloadHash: request.payloadHash })
          if (view.section === 'plans') {
            assert.equal(view.total, request.plans.length)
            assert.deepEqual(view.items.map(value => ({ id: value.id, status: value.status, resolution: value.resolution })),
              request.plans.map(id => ({ id, status: state.world!.plans[id]!.status,
                resolution: state.world!.plans[id]!.proposal.resolution.kind })))
          }
          if (view.section === 'execution') {
            if (request.proposal.businessKey === 'first-colleague') {
              assert.equal(view.result?.outcome.kind, 'committed'); assert.equal(view.observation?.status, 'settled')
            } else {
              if (stage === 'rejected') {
                assert.equal(view.observation, undefined); assert.equal(view.result?.outcome.kind, 'rejected')
                views.push(result.result.value); continue
              }
              assert.equal(view.observation?.status, stage === 'blocked' ? 'blocked'
                : stage === 'notification' || reconciled ? 'settled' : 'outcome-unknown')
              if (stage === 'blocked') assert.equal(view.observation.reason, 'position-capacity')
              assert.equal(view.result?.outcome.kind, stage === 'committed' || stage === 'notification'
                || reconciled && stage === 'participant' ? 'committed' : undefined)
            }
          }
          if (view.section === 'notification' && stage === 'notification'
            && request.proposal.businessKey === 'second-colleague') {
            assert.equal(view.result?.post?.status, 'outcome-unknown')
            assert.equal(view.result?.post?.publication, 'unknown')
          }
          views.push(result.result.value)
        }
        items.push({ requestId: request.id, businessKey: request.proposal.businessKey, views })
      }
      assert.equal(items.length, 2)
      return items
    }
    if (round === 0) {
      const definition = worldScenarioSchema.parse(JSON.parse(await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8')))
      if (stage !== 'blocked') definition.positions[0]!.capacity = 3
      const event = definition.initialEvents[0]!
      assert.equal(event.kind, 'hire-request')
      definition.initialEvents.push({ ...event, applicationId: 'second-colleague', at: '100' })
      if (stage === 'rejected') definition.initialEvents[1]!.description = 'Missing second case requirements'
      const preview = await client.simulations.preflightWorld({ definition })
      assert.ok(preview.result.ok && preview.result.value.status === 'ready')
      const created = await client.simulations.createWorld(simulationProductWorldCreateInputSchema.parse({ commandId: 'observation-create',
        name: 'Independent execution observations', definition,
        preflight: { hash: preview.result.value.preview.hash, catalogGeneration: preview.result.value.preview.catalogGeneration } }))
      assert.ok(created.result.ok); const runId = created.result.value.runId
      await command('observation-create'); assert.ok(owned)
      await writeFile(identityPath, JSON.stringify({ runId, spec: owned.snapshot().spec,
        checkpointId: owned.snapshot().latestCheckpointId }))
      capture = async () => {
        assert.ok(owned); const state = owned.snapshot(), calls = ctx.worldDriverProbe.requests.length
        const views = await inspectCases(runId, state)
        const control = await client.simulations.control({ runId }); assert.ok(control.result.ok)
        if (stage !== 'rejected') assert.equal(control.result.value.actions.start.allowed, false)
        if (stage !== 'blocked' && stage !== 'rejected') assert.equal(control.result.value.stop, 'outcome-unknown')
        assert.deepEqual(owned.snapshot(), state); assert.equal(ctx.worldDriverProbe.requests.length, calls)
        const notification = await notificationEvidence(state)
        await writeFile(proofPath, JSON.stringify({ stage, state, views, notification, calls,
          control: control.result.value, runtimePaths }, null, 2))
      }
      const started = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'observation-start', phase: 'running' }))
      assert.ok(started.result.ok)
      if (stage === 'blocked' || stage === 'notification' || stage === 'rejected') {
        await wait(async () => {
          const state = owned!.snapshot(), request = second(state), plan = request?.plans.at(-1)
          if (stage === 'rejected') return request?.status === 'rejected'
          if (stage === 'notification') return Object.values(state.operations).some(value => value.status === 'outcome-unknown')
          return plan !== undefined && state.world!.executions[plan]?.phase === 'blocked'
        })
        const pause = await client.simulations.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'blocked-pause', phase: 'paused' }))
        assert.ok(pause.result.ok)
        await wait(async () => {
          const control = await client.simulations.control({ runId }); assert.ok(control.result.ok)
          return !control.result.value.inFlight
        })
        await hold(stage)
      } else await new Promise<void>(() => {})
      throw new Error('Producer must be killed at its durable barrier')
    }
    const identity = JSON.parse(await readFile(identityPath, 'utf8')) as { runId: string; spec: unknown; checkpointId: string }
    const runId = simulationProductRunIdSchema.parse(identity.runId), spec = simulationRunSpecSchema.parse(identity.spec)
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as { state: SimulationSnapshot }
    const before = await ctx.simulations.inspect({ provider: 'local', spec }); assert.ok(before)
    const expected = round === 1 ? proof.state : (JSON.parse(await readFile(resolve(root, 'recovered-1.json'), 'utf8')) as { state: SimulationSnapshot }).state
    assert.deepEqual(before.snapshot, expected)
    const views = await inspectCases(runId, before.snapshot)
    const notification = await notificationEvidence(before.snapshot, proof.state)
    const cold = await client.simulations.control({ runId }); assert.ok(cold.result.ok)
    assert.equal(cold.result.value.owner, 'not-held'); assert.equal(cold.result.value.actions.start.reason, 'recovery-required')
    if (round === 1 && stage !== 'blocked' && stage !== 'rejected') assert.equal(cold.result.value.stop, 'outcome-unknown')
    const readOnly = await ctx.simulations.inspect({ provider: 'local', spec }); assert.ok(readOnly)
    assert.deepEqual(readOnly.snapshot, before.snapshot); assert.equal(currentOwner(), undefined)
    assert.equal(ctx.worldDriverProbe.requests.length, 0)
    const request = simulationProductRestoreInputSchema.parse({ runId, commandId: 'observation-restore', checkpointId: identity.checkpointId })
    const restore = await client.simulations.restore(request); assert.ok(restore.result.ok)
    if (round > 1) {
      assert.equal(restore.result.value.status, 'completed')
      const unchanged = await ctx.simulations.inspect({ provider: 'local', spec }); assert.ok(unchanged)
      assert.deepEqual(unchanged.snapshot, expected); assert.equal(currentOwner(), undefined)
      assert.equal(ctx.worldDriverProbe.requests.length, 0)
      await writeFile(resolve(root, `recovered-${round}.json`), JSON.stringify({ state: unchanged.snapshot, views,
        notification, receipt: restore.result.value, modelCalls: 0, runtimePaths }, null, 2))
      process.stdout.write(JSON.stringify({ stage, round, phase: unchanged.snapshot.phase, modelCalls: 0 }) + '\n')
      return
    }
    const receipt = await command(request.commandId)
    const after = owned?.snapshot(); assert.ok(after, JSON.stringify(receipt))
    assert.equal(after.phase, 'paused'); assert.equal(ctx.worldDriverProbe.requests.length, 0)
    const original = second(proof.state)!, current = second(after)!
    assert.deepEqual({ ...current, status: original.status }, original)
    assert.deepEqual(after.world!.plans, proof.state.world!.plans)
    const originalReservation = proof.state.world!.reservations[original.intentId]
    const reservation = after.world!.reservations[original.intentId]
    if (originalReservation) { assert.ok(reservation); assert.deepEqual(reservation.identities, originalReservation.identities) }
    assert.deepEqual(after.resources, proof.state.resources)
    const observation = after.world!.executions[current.plans.at(-1)!]
    assert.equal(observation?.phase, stage === 'rejected' ? undefined : stage === 'blocked' ? 'blocked' : 'settled', JSON.stringify(receipt))
    assert.deepEqual(Object.values(after.world!.results).filter(value => value.requestId !== current.id),
      Object.values(proof.state.world!.results).filter(value => value.requestId !== original.id))
    assert.equal(Object.values(after.world!.results).filter(value => value.requestId === current.id).length,
      stage === 'participant' || stage === 'committed' || stage === 'notification' || stage === 'rejected' ? 1 : 0)
    const afterViews = await inspectCases(runId, after, true), afterNotification = await notificationEvidence(after, proof.state)
    await writeFile(resolve(root, `recovered-${round}.json`), JSON.stringify({ state: after, views, afterViews,
      notification: afterNotification, cold, receipt,
      pid: process.pid, modelCalls: ctx.worldDriverProbe.requests.length, runtimePaths }, null, 2))
    process.stdout.write(JSON.stringify({ stage, round, phase: after.phase, modelCalls: 0 }) + '\n')
  })
} finally { await lease.revoke(); await ctx.fiber.dispose() }
