/** Corrupt reads from real retained owners must fail original product recovery without repairing or inferring. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import { simulationProductWorldCreateInputSchema, simulationProductRestoreInputSchema,
  simulationProductCommandIdSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-driver-model.ts'
import type {} from '@clocky/clocky-storage-log'

const modes = ['compiler-version', 'model-version', 'template-version', 'checkpoint-version',
  'newcomer-channel', 'newcomer-session', 'notification-envelope'] as const
const mode = z.enum(modes).parse(process.env.WORLD_RECOVERY_DAMAGE)
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
process.env.WORLD_PRODUCT_CONFIGURATION = JSON.stringify({ provider: 'local', catalog: installed,
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })
const json = z.json()
type Json = z.infer<typeof json>
function object(value: Json | undefined): Record<string, Json> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value
}
const versionDamage = mode === 'compiler-version' || mode === 'model-version' || mode === 'template-version'
let changed = false, nativeOpens = 0
const openedStreams: string[] = []
let probedRows = 0
const opening = boot('world-recovery-admission', process.argv[2]!, [], (ctx) => {
  let nativePatched = false, logPatched = false
  ctx.on('internal/service', (name) => {
    if (name === 'simulations' && !nativePatched) {
      const native = ctx.get('simulations')
      if (native === undefined) return
      nativePatched = true
      const open = native.open.bind(native)
      native.open = async (...args) => { nativeOpens += 1; return await open(...args) }
    }
    if (!versionDamage || name !== 'storageLog' || logPatched) return
    const facility = ctx.get('storageLog')
    if (facility === undefined) return
    logPatched = true
    const open = facility.open.bind(facility)
    facility.open = async (descriptor) => {
      openedStreams.push(descriptor.name)
      const stream = await open(descriptor)
      if (descriptor.name !== 'world-owner-commands') return stream
      const read = stream.read.bind(stream)
      stream.read = async (...args) => (await read(...args)).map((row) => {
        probedRows += 1
        const value = object(json.parse(structuredClone(row.value)))
        if (value['kind'] !== 'command/accepted') return row
        const command = object(value['command'])
        if (command['kind'] !== 'world-create') return row
        const resolved = object(object(object(command['creation'])['preparation'])['resolved'])
        if (mode === 'compiler-version') resolved['compilerVersion'] = 'unsupported'
        else if (mode === 'model-version') delete object(object(resolved['generatedActorRuntime'])['model'])['version']
        else {
          const templates = object(resolved['world'])['templates']
          assert.ok(Array.isArray(templates))
          delete object(templates[0])['version']
        }
        changed = true
        return { ...row, value }
      })
      return stream
    }
  })
})

if (versionDamage) {
  await assert.rejects(opening, /plugin tree failed to load/)
  assert.equal(changed, true)
  assert.equal(nativeOpens, 0)
  assert.equal(requests.length, 0)
  console.log(JSON.stringify({ mode, rejected: true, stage: 'original-creation-parser', modelCalls: 0, repaired: false }))
} else {
  const ctx = await opening
  try {
    const proof = object(json.parse(JSON.parse(await readFile(resolve(root, 'world-owner-proof.json'), 'utf8'))))
    const newcomer = object(proof['newcomer']), binding = object(newcomer['binding'])
    const world = object(proof['world']), reservations = Object.values(object(world['reservations']))
    const channels = object(reservations[0])['identities']
    const identities = object(channels), channelList = identities['channels']
    assert.ok(Array.isArray(channelList))
    const channelId = object(channelList[0])['channelId']
    const sessionId = binding['sessionId']
    let opened: SimulationRun | undefined, originalRevision: number | undefined
    const open = ctx.simulations.open.bind(ctx.simulations)
    ctx.simulations.open = async (...args) => {
      opened = await open(...args)
      originalRevision = opened.snapshot().revision
      return opened
    }
    if (mode === 'checkpoint-version') {
      const restore = ctx.simulationTeams.restore.bind(ctx.simulationTeams)
      ctx.simulationTeams.restore = async (selection, request, signal) => {
        changed = true
        return await restore(selection, { ...request, implementationVersion: 'world/unavailable' }, signal)
      }
    } else if (mode === 'newcomer-channel') {
      const get = ctx.teams.getChannel.bind(ctx.teams)
      ctx.teams.getChannel = async (input) => {
        if (input.channelId === channelId) { changed = true; throw new Error('Original newcomer Channel evidence is absent') }
        return await get(input)
      }
    } else if (mode === 'newcomer-session') {
      const read = ctx.sessionPersistence.readFrom.bind(ctx.sessionPersistence)
      ctx.sessionPersistence.readFrom = async (...args) => {
        if (args[0] === sessionId) { changed = true; throw new Error('Original newcomer Session evidence is absent') }
        return await read(...args)
      }
    } else {
      const read = ctx.teams.readChannelPage.bind(ctx.teams)
      ctx.teams.readChannelPage = async (input) => {
        const page = await read(input), state = opened?.snapshot()
        const request = Object.values(state?.world?.requests ?? {})[0]
        const notificationId = request?.notificationOperationId
        if (notificationId !== undefined) assert.ok(notificationId !== null, 'Ordinary request requires its Channel notification')
        const envelope = notificationId === undefined ? undefined : state?.operations[notificationId]?.outbox?.receipt
        const records = page.records.filter(value => !(value.type === 'channel/envelope' && value.envelope.id === envelope?.envelopeId))
        if (records.length !== page.records.length) changed = true
        return { ...page, records }
      }
    }
    const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential: ctx.productPrincipals.bootstrapCredential('local') })
    try {
      await lease.withCall(async (call) => {
        const api = createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
        const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call }))
        const input = simulationProductWorldCreateInputSchema.parse(JSON.parse(await readFile(resolve(root, 'world-owner-input.json'), 'utf8')))
        const created = await client.simulations.createWorld(input)
        assert.ok(created.result.ok)
        assert.equal(requests.length, 0)
        const commandId = simulationProductCommandIdSchema.parse(`reject-world-recovery-${mode}`)
        const request = simulationProductRestoreInputSchema.parse({ runId: created.result.value.runId, commandId,
          checkpointId: proof['checkpointId'] })
        const response = await client.simulations.restore(request)
        assert.ok(response.result.ok)
        let terminal = false
        for (let attempt = 0; attempt < 2000; attempt++) {
          const query = await client.simulations.request({ commandId })
          assert.ok(query.result.ok && query.result.value.status === 'found')
          const receipt = query.result.value.request
          if (receipt.status !== 'accepted') {
            assert.equal(receipt.status, 'failed')
            assert.equal(receipt.failure, 'restore-failed')
            assert.ok(receipt.diagnostic)
            terminal = true
            break
          }
          await new Promise(done => setTimeout(done, 5))
        }
        assert.equal(terminal, true)
        assert.equal(changed, true)
        const control = await client.simulations.control({ runId: created.result.value.runId })
        assert.ok(control.result.ok)
        assert.equal(control.result.value.owner, 'not-held')
        assert.equal(control.result.value.actions.start.allowed, false)
        assert.equal(opened?.snapshot().revision, originalRevision)
        assert.equal(requests.length, 0)
      })
    } finally { await lease.revoke() }
    console.log(JSON.stringify({ mode, rejected: true, stage: 'authenticated-restore', modelCalls: 0, repaired: false }))
  } finally { await ctx.fiber.dispose() }
}
