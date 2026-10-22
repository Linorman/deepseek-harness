/** The same real stdio workflow imports the source SDK or the compiled package under plain Node. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const entry = pathToFileURL(process.env.SDK_WORLD_CLIENT_ENTRY).href
const { HarnessClient } = await import(entry)
const launch = JSON.parse(process.env.SDK_WORLD_LAUNCH), root = process.env.SIMULATION_COMPANY_ROOT
const mode = process.env.SDK_WORLD_MODE, wire = [], pids = []
const read = async name => JSON.parse(await readFile(resolve(root, name), 'utf8'))
const open = async () => {
  const client = new HarnessClient({ command: launch.command, args: launch.args,
    env: { ...process.env, ...launch.env }, requestTimeoutMs: 30000 })
  const request = client.request.bind(client)
  client.request = async (method, params) => {
    const result = await request(method, params)
    if (method.startsWith('simulation/')) wire.push({ pid: client.pid, method, params, result })
    return result
  }
  await client.initialize({ credential: 'sdk-company-test-credential', cwd: process.cwd(),
    provider: 'world-driver-scripted', model: 'scripted' })
  assert.ok(Number.isSafeInteger(client.pid))
  pids.push(client.pid)
  return client
}
let sdk
const wait = async (readValue, ready) => {
  for (let i = 0; i < 2000; i++) {
    const value = await readValue()
    if (ready(value)) return value
    await new Promise(done => setTimeout(done, 5))
  }
  throw new Error('Original SDK v1 command did not settle')
}
const settled = async commandId => {
  const value = await wait(() => sdk.getSimulationRequest({ commandId }), result => result.status === 'found' && result.request.status !== 'accepted')
  assert.equal(value.request.status, 'completed', JSON.stringify(value))
  return value
}
const sections = async (runId, requestId) => Object.fromEntries(await Promise.all(
  ['request', 'plans', 'execution', 'notification'].map(async section => [section,
    await sdk.inspectSimulationWorldCase({ runId, requestId, section })])))
try {
  sdk = await open()
  const definition = await read('definition.json')
  assert.equal(definition.apiVersion, 'clocky.world/v1')
  const preview = await sdk.preflightSimulationWorld({ definition })
  assert.equal(preview.status, 'ready')
  const creation = { commandId: 'sdk-v1-create', name: 'SDK v1 existing-person hire', definition,
    preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } }
  const runId = (await sdk.createSimulationWorld(creation)).runId
  await settled(creation.commandId)
  const preparation = { runId, commandId: 'sdk-v1-prepare' }
  await sdk.prepareSimulationWorld(preparation); await settled(preparation.commandId)
  assert.equal((await sdk.getSimulationControl({ runId })).phase, 'paused')
  const people = await sdk.readSimulationWorldDomain({ kind: 'organization', runId, lens: 'people', limit: 16 })
  assert.equal(people.kind, 'organization'); assert.equal(people.coverage.complete, true)
  const candidate = people.value.people.find(value => value.name.text === 'Observer')
  assert.ok(candidate); assert.equal(candidate.employment, 'candidate')
  const fields = await sdk.readSimulationWorldManagementFields({ runId, targetId: candidate.id, action: 'hire-existing' })
  assert.equal(fields.apiVersion, 'clocky.world-management/v1'); assert.equal(fields.status, 'available')
  const position = fields.fields.find(value => value.id === 'position').options.find(value => value.label === 'Engineer')
  assert.ok(position)
  const draft = { runId, targetId: candidate.id, action: 'hire-existing', expectedRevision: fields.targetRevision,
    values: { position: position.id, reason: 'SDK original existing-person hire' } }
  const quote = await sdk.previewSimulationWorldManagement(draft)
  assert.equal(quote.admission, 'allowed'); assert.deepEqual(quote.blockers, []); assert.equal(quote.coverage.complete, true)
  const original = { runId, commandId: 'sdk-v1-hire-existing', draft,
    previewRevision: quote.snapshotRevision, previewHash: quote.previewHash }
  await sdk.submitSimulationWorldManagement(original)
  const completed = await settled(original.commandId), outcome = completed.worldManagementOutcome
  assert.deepEqual(completed.worldManagement, original)
  assert.equal(outcome.result.status, 'committed'); assert.equal(outcome.execution.phase, 'settled')
  const page = await sdk.listSimulationWorldCases({ runId })
  assert.equal(page.total, 1); assert.equal(page.items[0].apiVersion, 'clocky.world-case/v3')
  assert.equal(page.items[0].requestId, outcome.requestId)
  assert.deepEqual(page.items[0].origin, { kind: 'authenticated-user', commandId: original.commandId })
  assert.equal(page.items[0].requesterEntityId, null)
  const before = await sections(runId, outcome.requestId)
  assert.ok(Object.values(before).every(value => value.status === 'found'))
  assert.equal(before.plans.value.items.length, 1)
  assert.equal(before.plans.value.items[0].id, outcome.planId)
  assert.equal(before.plans.value.items[0].operationId, null)
  assert.equal(before.notification.value.request, null)
  const afterPeople = await sdk.readSimulationWorldDomain({ kind: 'organization', runId, lens: 'people', limit: 16 })
  const employed = afterPeople.value.people.find(value => value.id === candidate.id)
  assert.equal(employed.employment, 'employed'); assert.equal(employed.tenures.at(-1).positionId, position.id)
  const checkpoint = { runId, commandId: 'sdk-v1-checkpoint' }
  await sdk.checkpointSimulation(checkpoint)
  const checkpointId = (await settled(checkpoint.commandId)).request.checkpointId
  assert.ok(checkpointId)
  assert.equal((await read('sdk-world-model-count.json')).calls, 0)
  await sdk.close(); sdk = undefined
  sdk = await open()
  assert.equal((await sdk.getSimulationControl({ runId })).owner, 'not-held')
  assert.deepEqual(await sdk.getSimulationRequest({ commandId: original.commandId }), completed)
  assert.equal((await sdk.submitSimulationWorldManagement(original)).status, 'completed')
  assert.equal((await sdk.retrySimulationRequest({ runId, commandId: original.commandId })).status, 'completed')
  assert.equal((await sdk.createSimulationWorld(creation)).runId, runId)
  assert.equal((await sdk.prepareSimulationWorld(preparation)).status, 'completed')
  assert.deepEqual((await sdk.listSimulationWorldCases({ runId })).items, page.items)
  for (const [section, value] of Object.entries(await sections(runId, outcome.requestId))) assert.deepEqual(value.value, before[section].value)
  assert.equal((await read('sdk-world-model-count.json')).calls, 0)
  await sdk.close(); sdk = undefined
  const cold = await read(`runtime-${pids[1]}.json`)
  assert.equal(cold.opens, 0); assert.equal(cold.attaches, 0); assert.equal(cold.modelCalls, 0)
  sdk = await open()
  await sdk.restoreSimulation({ runId, commandId: 'sdk-v1-restore', checkpointId }); await settled('sdk-v1-restore')
  assert.equal((await sdk.getSimulationControl({ runId })).phase, 'paused')
  assert.deepEqual((await sdk.listSimulationWorldCases({ runId })).items, page.items)
  assert.deepEqual(await sdk.getSimulationRequest({ commandId: original.commandId }), completed)
  assert.equal((await sdk.submitSimulationWorldManagement(original)).status, 'completed')
  assert.equal((await read('sdk-world-model-count.json')).calls, 0)
  await sdk.close(); sdk = undefined
  assert.equal(new Set(pids).size, 3)
  const runtimes = await Promise.all(pids.map(pid => read(`runtime-${pid}.json`)))
  assert.ok(runtimes.every(value => value.modelCalls === 0))
  assert.ok(runtimes.every(value => Object.values(value.modules).every(path => path.includes(mode === 'src' ? '/src/' : '/lib/'))))
  assert.ok(runtimes.every(value => mode === 'src' ? value.execArgv.includes('--import') : value.execArgv.length === 0))
  assert.ok(entry.endsWith(mode === 'src' ? '/src/index.ts' : '/lib/index.js'))
  const proof = { apiVersion: 'clocky.world/v1', language: 'typescript', mode, backend: process.env.SIMULATION_COMPANY_BACKEND,
    sdkEntry: entry, driverPid: process.pid, pids, runtimes, runId, original, outcome, checkpointId,
    business: outcome.result.status, modelCalls: 0, coldModelCalls: 0, exactOriginal: true, caseSections: 4, coldReadonlyOpens: cold.opens }
  await writeFile(resolve(root, 'proof.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log(JSON.stringify(proof))
} finally {
  if (sdk !== undefined) await sdk.close()
  await writeFile(resolve(root, 'wire.json'), JSON.stringify(wire, null, 2) + '\n')
}
