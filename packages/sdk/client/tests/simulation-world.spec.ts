/** World method correlation and required-event compatibility are enforced by both public SDK APIs. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, expectTypeOf, it, vi } from 'vitest'
import { Clocky, HarnessClient, SdkProtocolError } from '../src/index.ts'
import { simulationWorldPreflightParamsSchema, simulationWorldPreflightResultSchema } from '@clocky/clocky-sdk-protocol'
import { simulationWorldDomainParamsSchema, simulationWorldDomainResultSchema, type SimulationWorldDomainResult } from '@clocky/clocky-sdk-protocol'

it('preserves the branded World domain result through both public client return types', () => {
  expectTypeOf<Awaited<ReturnType<HarnessClient['readSimulationWorldDomain']>>>().toEqualTypeOf<SimulationWorldDomainResult>()
  expectTypeOf<Awaited<ReturnType<Clocky['readSimulationWorldDomain']>>>().toEqualTypeOf<SimulationWorldDomainResult>()
})

it.each([
  { kind: 'overview' }, { kind: 'organization', lens: 'people' }, { kind: 'person', personId: 'person', section: 'identity' },
  { kind: 'governance', lens: 'proposals' }, { kind: 'proposal', proposalId: 'proposal', section: 'votes' },
  { kind: 'norm', versionId: '["norm","1"]' }, { kind: 'external' }, { kind: 'identity', key: 'supplier', section: 'facts' },
  { kind: 'case-extensions', requestIds: ['case'] },
])('correlates both public domain clients for $kind and refuses another query or private payload', async (selector) => {
  const selected = simulationWorldDomainParamsSchema.parse({ ...selector, runId: 'run', limit: 1 })
  const output = simulationWorldDomainResultSchema.parse({ apiVersion: 'clocky.world-read/v1', kind: selected.kind,
    runId: 'run', selection: selected, snapshotRevision: 3, readVersion: 'policy', observedAt: 1, status: 'missing',
    coverage: { loaded: 0, total: 0, revision: 3, scope: selected.kind, complete: true } })
  const low = new HarnessClient({ command: process.execPath })
  const high = new Clocky({ launch: { command: process.execPath }, credential: 'fixture', provider: 'fixture', model: 'fixture' })
  vi.spyOn(high, 'start').mockResolvedValue(undefined)
  for (const [client, transport] of [[low, low], [high, high.client]] as const) {
    const send = vi.spyOn(transport, 'request').mockResolvedValue(output)
    expect(await client.readSimulationWorldDomain(selected)).toEqual(output)
    expect(send).toHaveBeenCalledWith('simulation/world-domain-read', selected)
    send.mockResolvedValue({ ...output, nativeSnapshot: {} })
    await expect(client.readSimulationWorldDomain(selected)).rejects.toBeInstanceOf(SdkProtocolError)
    send.mockResolvedValue({ ...output, selection: { ...selected, limit: 2 } })
    await expect(client.readSimulationWorldDomain(selected)).rejects.toBeInstanceOf(SdkProtocolError)
    await expect(client.readSimulationWorldDomain({ ...selected, principal: 'injected' } as never)).rejects.toBeInstanceOf(SdkProtocolError)
  }
})

function lifecycle(status: string, resultId = 'result') {
  const business = ['committed', 'rejected', 'cancelled'].includes(status) ? { status, resultId } : { status: 'none' }
  return { request: { status }, plan: { status: 'none' }, execution: { callback: { status: 'none' }, business },
    notification: { request: null } }
}

const source: unknown = JSON.parse(await readFile(resolve('examples/simulation-company/scenarios/world-company.json'), 'utf8'))
const definition = simulationWorldPreflightParamsSchema.parse({ definition: source }).definition
const v1Source: unknown = JSON.parse(await readFile('packages/sdk/protocol/tests/fixtures/world-v1-definition.json', 'utf8'))
const v1Definition = simulationWorldPreflightParamsSchema.parse({ definition: v1Source }).definition
const directorSource: unknown = JSON.parse(await readFile('packages/sdk/protocol/tests/fixtures/world-director-event-definition.json', 'utf8'))
const directorDefinition = simulationWorldPreflightParamsSchema.parse({ definition: directorSource }).definition
const v1Preview = simulationWorldPreflightResultSchema.parse(
  JSON.parse(await readFile('packages/sdk/protocol/tests/fixtures/world-v1-preview.json', 'utf8')))
if (v1Preview.status !== 'ready') throw new Error('Real v1 SDK fixture lost its actual preview')
const create = { commandId: 'world-original', name: 'World', definition, preflight: { hash: `sha256:${'1'.repeat(64)}`, catalogGeneration: '1' } }
const receipt = { commandId: 'world-original', runId: 'world', kind: 'world-create', status: 'completed', acceptedAt: 1 }
const cases = [
  ['preflightSimulationWorld', 'world-preflight', { definition },
    { status: 'invalid', diagnostics: [{ source: 'catalog', path: [], code: 'model-unavailable', message: 'Model is unavailable' }] }],
  ['createSimulationWorld', 'world-create', create, receipt],
  ['prepareSimulationWorld', 'world-prepare', { runId: 'world', commandId: 'world-original' }, { ...receipt, kind: 'world-prepare' }],
  ['exportSimulationWorldDefinition', 'world-export', { runId: 'world' }, { runId: 'world', definition }],
  ['preflightSimulationWorld', 'world-preflight', { definition: v1Definition }, v1Preview],
  ['createSimulationWorld', 'world-create', { ...create, definition: v1Definition, preflight: {
    hash: v1Preview.preview.hash, catalogGeneration: v1Preview.preview.catalogGeneration } }, receipt],
  ['exportSimulationWorldDefinition', 'world-export', { runId: 'world' }, { runId: 'world', definition: v1Definition }],
  ['preflightSimulationWorld', 'world-preflight', { definition: directorDefinition }, { status: 'invalid', diagnostics: [
    { source: 'scenario', path: ['behavior', 'directorEvents', 0], code: 'unsupported-feature', message: 'Installed capability required' }] }],
] as const

it.each(cases)('correlates %s and rejects injected authority or malformed original responses', async (method, route, input, output) => {
  const low = new HarnessClient({ command: process.execPath })
  const high = new Clocky({ launch: { command: process.execPath }, credential: 'fixture', provider: 'fixture', model: 'fixture' })
  const send = vi.spyOn(low, 'request').mockResolvedValue(output)
  vi.spyOn(high, 'start').mockResolvedValue(undefined)
  vi.spyOn(high.client, 'request').mockResolvedValue(output)
  for (const client of [low, high]) {
    expect(await (client[method] as (input: unknown) => Promise<unknown>).call(client, input)).toEqual(output)
  }
  expect(send).toHaveBeenCalledWith(`simulation/${route}`, input)
  send.mockResolvedValue({ ...output, nativeSnapshot: {} })
  await expect((low[method] as (input: unknown) => Promise<unknown>).call(low, input)).rejects.toBeInstanceOf(SdkProtocolError)
  await expect((low[method] as (input: unknown) => Promise<unknown>).call(low, { ...input, actor: 'injected' }))
    .rejects.toBeInstanceOf(SdkProtocolError)
  if (method !== 'preflightSimulationWorld') {
    send.mockResolvedValue({ ...output, ...method === 'exportSimulationWorldDefinition' ? { runId: 'another' } : { commandId: 'another' } })
    await expect((low[method] as (input: unknown) => Promise<unknown>).call(low, input)).rejects.toBeInstanceOf(SdkProtocolError)
  }
})

it('decodes common committed case payloads through both public APIs and rejects the former hiring outcome layout', async () => {
  const low = new HarnessClient({ command: process.execPath })
  const high = new Clocky({ launch: { command: process.execPath }, credential: 'fixture', provider: 'fixture', model: 'fixture' })
  vi.spyOn(high, 'start').mockResolvedValue(undefined)
  const selected = { runId: 'run', requestId: 'case', section: 'execution' as const }
  const response = { runId: 'run', snapshotRevision: 4, readVersion: 'policy', observedAt: 1,
    requestId: 'case', section: 'execution', status: 'found', value: { section: 'execution',
      summary: { apiVersion: 'clocky.world-case/v4', businessSummary: { status: 'unsupported' }, origin: { kind: 'decision' }, domain: 'organization', operation: 'generate-and-hire', version: '1', requestId: 'case', intentId: 'intent', status: 'committed', lifecycle: lifecycle('committed'), requesterEntityId: 'requester',
        organizationEntityId: 'organization', targetEntityId: 'position', cancel: { allowed: false, reason: 'terminal' } },
      result: { id: 'result', sequence: 4, time: '5', source: { kind: 'plan', planId: 'plan' },
        outcome: { kind: 'committed' }, payload: { entityId: 'newborn', relationId: 'assignment' } },
      reservation: { id: 'intent', planId: 'plan', status: 'committed', sequence: 3, updatedSequence: 4,
        newborn: { entityId: 'newborn', readiness: 'ready', phase: 'active' }, assignment: { relationId: 'assignment', status: 'retained' } } } }
  for (const [publicApi, transport] of [[low, low], [high, high.client]] as const) {
    const send = vi.spyOn(transport, 'request').mockResolvedValue(response)
    expect(await publicApi.inspectSimulationWorldCase(selected)).toEqual(response)
    expect(send).toHaveBeenCalledWith('simulation/world-case-inspect', selected)
    const original = response.value.result
    for (const changed of [
      { ...original, outcome: { kind: 'committed', entityId: 'newborn', relationId: 'assignment' }, payload: undefined },
      { ...original, payload: { entityId: 'newborn' } },
      { ...original, payload: { ...original.payload, privateRationale: 'secret' } },
      { ...original, payload: { ...original.payload, entityId: 'replacement' } },
    ]) {
      send.mockResolvedValue({ ...response, value: { ...response.value, result: changed } })
      await expect(publicApi.inspectSimulationWorldCase(selected)).rejects.toBeInstanceOf(SdkProtocolError)
    }
    await expect(publicApi.inspectSimulationWorldCase({ ...selected, actorId: 'forged' } as typeof selected))
      .rejects.toBeInstanceOf(SdkProtocolError)
  }
})

it('both public APIs preserve an explicit no-Channel notification and refuse a missing required request', async () => {
  const low = new HarnessClient({ command: process.execPath })
  const high = new Clocky({ launch: { command: process.execPath }, credential: 'fixture', provider: 'fixture', model: 'fixture' })
  vi.spyOn(high, 'start').mockResolvedValue(undefined)
  const input = { runId: 'run', requestId: 'case', section: 'notification' as const }
  const summary = { apiVersion: 'clocky.world-case/v4', businessSummary: { status: 'unsupported' }, origin: { kind: 'decision' }, domain: 'organization', operation: 'generate-and-hire', version: '1', requestId: 'case', intentId: 'intent', status: 'committed', lifecycle: lifecycle('committed'), requesterEntityId: 'director',
    organizationEntityId: 'scope', targetEntityId: 'target', cancel: { allowed: false, reason: 'terminal' } }
  const response = { ...input, snapshotRevision: 9, observedAt: 1, readVersion: 'read', status: 'found',
    value: { section: 'notification', summary, request: null,
      result: { resultId: 'result', wake: { id: 'wake', status: 'completed', decisionId: 'decision' } } } }
  summary.lifecycle.notification = { request: null, result: response.value.result } as typeof summary.lifecycle.notification
  for (const [api, transport] of [[low, low], [high, high.client]] as const) {
    const send = vi.spyOn(transport, 'request').mockResolvedValue(response)
    expect(await api.inspectSimulationWorldCase(input)).toEqual(response)
    const { request: _post, ...missing } = response.value
    send.mockResolvedValue({ ...response, value: missing })
    await expect(api.inspectSimulationWorldCase(input)).rejects.toBeInstanceOf(SdkProtocolError)
  }
})

it.each([undefined, false, 'true'] as const)('rejects an unknown required Session event with ignorable=%s', async (ignorable) => {
  const event = { seq: 0, time: 0, type: 'future/world-effect', data: {}, ...ignorable === undefined ? {} : { ignorable } }
  const high = new Clocky({ credential: 'sdk-client-test-credential', provider: 'provider', model: 'model', launch: {
    command: process.execPath, args: [resolve('packages/sdk/client/tests/fake-runtime.ts')],
    env: { ...process.env as Record<string, string>, FAKE_SESSION_EVENT_JSON: JSON.stringify(event) } } })
  try { await expect(high.run('Unknown required event')).rejects.toBeInstanceOf(SdkProtocolError) }
  finally { await high.close() }
})

it('omits an unknown ignorable Session event from the known typed transcript while retaining the raw notification', async () => {
  const event = { seq: 0, time: 0, type: 'future/world-effect', data: {}, ignorable: true }
  const high = new Clocky({ credential: 'sdk-client-test-credential', provider: 'provider', model: 'model', launch: {
    command: process.execPath, args: [resolve('packages/sdk/client/tests/fake-runtime.ts')],
    env: { ...process.env as Record<string, string>, FAKE_SESSION_EVENT_JSON: JSON.stringify(event) } } })
  try {
    const result = await high.run('Ignorable event')
    expect(result.events.filter(value => value.type === event.type)).toEqual([])
    expect(result.notifications.some(value => value.method === 'session.event' && JSON.stringify(value.params.event) === JSON.stringify(event)))
      .toBe(true)
  } finally { await high.close() }
})
