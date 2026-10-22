/** Plain Node consumes the distributed TypeScript client and a built runtime; the build is an explicit prerequisite. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sdkEntry = pathToFileURL(resolve('packages/sdk/client/lib/index.js')).href
const { HarnessClient, Clocky, SdkProtocolError } = await import(sdkEntry)
const scenario = process.env.WORLD_SCENARIO, root = process.env.SIMULATION_COMPANY_ROOT
const launch = JSON.parse(process.env.SDK_WORLD_LAUNCH)
const wire = [], pids = []
const open = () => {
  const client = new HarnessClient({ command: launch.command, args: launch.args,
    env: { ...process.env, ...launch.env }, requestTimeoutMs: 30000 })
  const request = client.request.bind(client)
  client.request = async (method, params) => {
    const result = await request(method, params)
    if (method.startsWith('simulation/')) wire.push({ pid: client.pid, method, params, result })
    return result
  }
  return client
}
let sdk = open()
const initialize = async () => {
  await sdk.initialize({ credential: 'sdk-company-test-credential', cwd: process.cwd(),
    provider: 'world-driver-scripted', model: 'scripted' })
  assert.ok(Number.isSafeInteger(sdk.pid))
  pids.push(sdk.pid)
}
const wait = async (read, ready) => {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const value = await read()
    if (ready(value)) return value
    await new Promise(done => setTimeout(done, 5))
  }
  throw new Error('Distributed World SDK operation did not settle')
}
const settled = async commandId => {
  const value = await wait(() => sdk.getSimulationRequest({ commandId }), result => result.status === 'found' && result.request.status !== 'accepted')
  assert.equal(value.request.status, 'completed')
  return value
}
const calls = async () => JSON.parse(await readFile(resolve(root, 'sdk-world-model-count.json'), 'utf8')).calls
try {
  await initialize()
  const definition = JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8'))
  const preview = await sdk.preflightSimulationWorld({ definition })
  assert.equal(preview.status, 'ready')
  assert.equal(await calls(), 0)
  const input = { commandId: 'built-world-create', name: 'Built SDK World', definition,
    preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } }
  const created = await sdk.createSimulationWorld(input), runId = created.runId
  await settled(input.commandId)
  assert.equal((await sdk.createSimulationWorld(input)).runId, runId)
  const prepared = { runId, commandId: 'built-world-prepare' }
  await sdk.prepareSimulationWorld(prepared)
  await settled(prepared.commandId)
  assert.equal((await sdk.getSimulationControl({ runId })).phase, 'paused')
  const exported = await sdk.exportSimulationWorldDefinition({ runId })
  assert.deepEqual(exported.definition, definition)
  assert.equal((await sdk.preflightSimulationWorld({ definition: exported.definition })).status, 'ready')
  assert.equal(await calls(), 0)
  const start = { runId, managementId: 'built-world-start', phase: 'running' }
  await sdk.manageSimulation(start)
  await wait(() => sdk.getSimulationControl({ runId }), value => value.stop === 'idle' && !value.inFlight)
  assert.equal(await calls(), 18)
  const page = await sdk.listSimulationWorldCases({ runId, limit: 1 })
  assert.equal(page.total, 1)
  const original = page.items[0]
  assert.equal(original.status, 'committed')
  const sections = {}
  for (const section of ['request', 'plans', 'execution', 'notification']) {
    sections[section] = await sdk.inspectSimulationWorldCase({ runId, requestId: original.requestId, section })
    assert.equal(sections[section].status, 'found')
  }
  const cancel = { runId, requestId: original.requestId, commandId: 'built-world-cancel' }
  assert.deepEqual(original.cancel, { allowed: false, reason: 'terminal' })
  await assert.rejects(sdk.cancelSimulationWorldCase(cancel), SdkProtocolError)
  assert.deepEqual(await sdk.getSimulationRequest({ commandId: cancel.commandId }), { status: 'not-found', commandId: cancel.commandId })
  assert.equal((await sdk.listSimulationWorldCases({ runId })).items[0].status, 'committed')
  assert.equal(await calls(), 18)
  await sdk.manageSimulation({ runId, managementId: 'built-world-pause', phase: 'paused' })
  await sdk.checkpointSimulation({ runId, commandId: 'built-world-checkpoint' })
  const checkpointId = (await settled('built-world-checkpoint')).request.checkpointId
  assert.ok(checkpointId)
  await sdk.close()
  sdk = open()
  await initialize()
  assert.equal((await sdk.getSimulationControl({ runId })).owner, 'not-held')
  assert.equal(await calls(), 0)
  await sdk.restoreSimulation({ runId, commandId: 'built-world-restore', checkpointId })
  await settled('built-world-restore')
  assert.equal((await sdk.getSimulationControl({ runId })).phase, 'paused')
  assert.equal((await sdk.manageSimulation(start)).control.phase, 'paused')
  assert.equal((await sdk.createSimulationWorld(input)).runId, runId)
  assert.equal((await sdk.prepareSimulationWorld(prepared)).status, 'completed')
  await assert.rejects(sdk.cancelSimulationWorldCase(cancel), SdkProtocolError)
  assert.deepEqual(await sdk.getSimulationRequest({ commandId: cancel.commandId }), { status: 'not-found', commandId: cancel.commandId })
  assert.deepEqual((await sdk.exportSimulationWorldDefinition({ runId })).definition, exported.definition)
  assert.deepEqual((await sdk.listSimulationWorldCases({ runId })).items, page.items)
  for (const section of Object.keys(sections)) {
    assert.deepEqual((await sdk.inspectSimulationWorldCase({ runId, requestId: original.requestId, section })).value, sections[section].value)
  }
  assert.equal(await calls(), 0)
  const originalRequest = sdk.request.bind(sdk)
  sdk.request = async (method, params) => {
    const result = await originalRequest(method, params)
    return method === 'simulation/runs-control' ? { ...result, stop: 'future-world-stop' } : result
  }
  await assert.rejects(sdk.getSimulationControl({ runId }), SdkProtocolError)
  sdk.request = originalRequest
  for (const ignorable of [undefined, true]) {
    const event = { type: 'future/world-effect', seq: 0, time: 0, data: {}, ...ignorable === undefined ? {} : { ignorable } }
    const transcript = new Clocky({ credential: 'sdk-client-test-credential', provider: 'provider', model: 'model', launch: {
      command: process.execPath, args: [resolve('packages/sdk/client/tests/fake-runtime.ts')],
      env: { ...process.env, FAKE_SESSION_EVENT_JSON: JSON.stringify(event) } } })
    try {
      if (ignorable === undefined) await assert.rejects(transcript.run('Unknown required event'), SdkProtocolError)
      else {
        const result = await transcript.run('Ignorable event')
        assert.equal(result.events.some(value => value.type === event.type), false)
        assert.equal(result.notifications.some(value => value.method === 'session.event' && value.params.event.type === event.type), true)
      }
    } finally { await transcript.close() }
  }
  assert.equal(new Set(pids).size, 2)
  await writeFile(resolve(root, 'proof.json'), JSON.stringify({ scenario, mode: 'lib', language: 'typescript',
    backend: process.env.SIMULATION_COMPANY_BACKEND, sdkEntry, pids, driverPid: process.pid,
    modelCalls: 18, coldModelCalls: 0, originalCommands: true, caseSections: 4, cancellation: 'blocked-terminal' }, null, 2) + '\n')
  console.log(JSON.stringify({ scenario, builtClient: true, modelCalls: 18, coldModelCalls: 0, originalCommands: true,
    caseSections: 4, cancellation: 'blocked-terminal', unknownRequiredRejected: true, unknownStopRejected: true }))
} finally {
  await sdk.close()
  await writeFile(resolve(root, 'wire.json'), JSON.stringify(wire, null, 2) + '\n')
}
