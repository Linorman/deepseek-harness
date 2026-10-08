/** Public clients correlate Simulation results to exact object, section, revision and original command selections. */
import { expect, it, vi } from 'vitest'
import { HarnessClient, Clocky, SdkProtocolError } from '../src/index.ts'

const create = { commandId: 'original', templateId: 'company', templateVersion: '1' as const, expectedModel: { provider: 'company', name: 'scripted' }, name: 'Company',
  parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } }
const summary = { id: 'run', name: { text: 'Company', truncated: false }, registeredAt: 1, observation: 'not-observed' }
const receipt = { commandId: 'original', runId: 'run', kind: 'create', acceptedAt: 1, status: 'accepted' }
const selection = { collection: 'entities', id: 'entity', section: 'identity' }
const control = { runId: 'run', administration: { actions: { checkpoint: { allowed: true, reason: 'ready' }, restore: { allowed: false, reason: 'checkpoint-required' },
  prepare: { allowed: true, reason: 'ready' }, ingress: { allowed: true, reason: 'ready' } },
ingress: { maxTime: '1000', maxBytes: 65536, targets: [{ id: 'buyer', name: { text: 'Buyer', truncated: false } }] } }, budget: { model: { provider: 'company', name: 'scripted' }, tokensPerRequest: 10000,
  tokensPerInterval: 1000000, interval: '100', residentActors: 2, sharedModelLimit: 1 }, owner: 'held', phase: 'paused', revision: 1, driver: 'idle', inFlight: false,
observedAt: 1, actions: { start: { allowed: true, reason: 'ready' }, pause: { allowed: true, reason: 'ready' } } }
const management = { managementId: 'management', phase: 'running', status: 'completed', startedSequence: 1, finishedSequence: 2 }
const ingress = { runId: 'run', ingressId: 'input', entityId: 'entity', eventId: 'event', availableAt: '9007199254740993',
  assignedAt: '9007199254740993', sequence: 1, status: 'pending' }
const cases = [
  ['listSimulationTasks', 'tasks-list', { runId: 'run', limit: 1, expectedRevision: 1 },
    { runId: 'run', snapshotRevision: 1, observedAt: 1, total: 0, items: [] }],
  ['cancelSimulationTask', 'tasks-cancel', { runId: 'run', commandId: 'original', operationId: 'operation',
    expectedRevision: 2, expectedAttemptId: null, reason: 'Cancel the original task' }, { ...receipt, kind: 'cancel-task' }],
  ['retrySimulationOperation', 'operation-retry', { runId: 'run', commandId: 'original', operationId: 'operation',
    expectedAttemptCount: 1, reason: 'Reconcile the existing target' }, { ...receipt, kind: 'retry-operation' }],
  ['getSimulationRunStatuses', 'runs-statuses', { runIds: ['run'] }, { items: [{ run: summary, status: 'missing' }] }],
  ['listSimulationTaskReviews', 'task-reviews-list', { runId: 'run', limit: 1 },
    { runId: 'run', snapshotRevision: 1, observedAt: 1, total: 0, items: [] }],
  ['resolveSimulationTaskReview', 'task-reviews-resolve', { runId: 'run', commandId: 'original', operationId: 'operation',
    attemptId: 'attempt', expectedRevision: 2, nextPhase: 'completed', reason: 'Approved' }, { ...receipt, kind: 'review' }],
  ['getSimulationControl', 'runs-control', { runId: 'run' }, control],
  ['manageSimulation', 'runs-manage', { runId: 'run', managementId: 'management', phase: 'running' },
    { runId: 'run', operation: management, control }],
  ['getSimulationManagement', 'management-get', { runId: 'run', managementId: 'management' },
    { runId: 'run', managementId: 'management', status: 'found', operation: management }],
  ['checkpointSimulation', 'runs-checkpoint', { runId: 'run', commandId: 'original' },
    { ...receipt, kind: 'checkpoint', checkpointId: 'cut' }],
  ['restoreSimulation', 'runs-restore', { runId: 'run', commandId: 'original', checkpointId: 'cut' },
    { ...receipt, kind: 'restore', checkpointId: 'cut' }],
  ['ingressSimulation', 'runs-ingress', { runId: 'run', ingressId: 'input', entityId: 'entity', text: 'Input', availableAt: ingress.availableAt }, ingress],
  ['getSimulationIngress', 'ingress-get', { runId: 'run', ingressId: 'input' },
    { runId: 'run', ingressId: 'input', status: 'found', receipt: ingress }],
  ['simulationCatalog' , 'catalog', {}, { items: [] }],
  ['listSimulations', 'runs-list', {}, { items: [summary] }],
  ['inspectSimulation', 'runs-inspect', { runId: 'run' }, { run: summary, status: 'missing' }],
  ['browseSimulation', 'collections-list', { runId: 'run', collection: 'entities' },
    { runId: 'run', collection: 'entities', snapshotRevision: 1, observedAt: 1, total: 0, items: [] }],
  ['inspectSimulationSource', 'sources-inspect', { runId: 'run', decisionId: 'decision', sourceIndex: 0 },
    { runId: 'run', decisionId: 'decision', sourceIndex: 0, snapshotRevision: 1, readVersion: 'policy',
      observedAt: 1, status: 'missing', items: [] }],
  ['readSimulationRecords', 'records-list', { runId: 'run', mode: 'metadata' },
    { runId: 'run', mode: 'metadata', selection: {}, snapshotRevision: 1, readVersion: 'policy',
      observedAt: 1, bodyAccess: 'withheld', totalRecords: 0, items: [] }],
  ['watchSimulation', 'changes-watch', { runId: 'run', waitMs: 0 },
    { runId: 'run', readVersion: 'policy', cursor: 'watch-cursor', status: 'changed', observedAt: 1,
      world: { status: 'missing' } }],
  ['inspectSimulationObject', 'objects-inspect', { runId: 'run', ...selection },
    { runId: 'run', selection, snapshotRevision: 1, observedAt: 1, status: 'missing' }],
  ['createSimulation', 'runs-create', create, receipt],
  ['prepareSimulation', 'runs-prepare', { runId: 'run', commandId: 'original' }, { ...receipt, kind: 'prepare' }],
  ['listSimulationRequests', 'requests-list', { runId: 'run', limit: 1, expectedRevision: 2 },
    { runId: 'run', snapshotRevision: 2, items: [receipt], total: 1 }],
  ['retrySimulationRequest', 'requests-retry', { runId: 'run', commandId: 'original' }, receipt],
  ['getSimulationRequest', 'requests-get', { commandId: 'original' }, { status: 'found', request: receipt }],
] as const

it.each(cases)('validates and serializes %s through both public APIs', async (method, wire, input, output) => {
  const client = new HarnessClient({ command: process.execPath })
  const send = vi.spyOn(client, 'request').mockResolvedValue(output)
  const low = client[method] as (input: unknown) => Promise<unknown>
  expect(await low.call(client, input)).toEqual(output)
  expect(send).toHaveBeenCalledWith(`simulation/${wire}`, input)
  const clocky = new Clocky({ launch: { command: process.execPath }, credential: 'test', provider: 'test', model: 'test' })
  vi.spyOn(clocky, 'start').mockResolvedValue()
  const request = vi.spyOn(clocky.client, 'request').mockResolvedValue(output)
  const high = clocky[method] as (input: unknown) => Promise<unknown>
  expect(await high.call(clocky, input)).toEqual(output)
  expect(request).toHaveBeenCalledWith(`simulation/${wire}`, input)
})

it.each(cases.filter(([method]) => method !== 'simulationCatalog' && method !== 'listSimulations'))('refuses a foreign %s result', async (method, _wire, input, output) => {
  const client = new HarnessClient({ command: process.execPath })
  const foreign = structuredClone(output) as Record<string, unknown>
  if (method === 'getSimulationRunStatuses') foreign.items = [{ run: { ...summary, id: 'foreign' }, status: 'missing' }]
  else if (method === 'inspectSimulation') foreign.run = { ...summary, id: 'foreign' }
  else if (method === 'getSimulationRequest') foreign.request = { ...receipt, commandId: 'foreign' }
  else if (method === 'createSimulation' || method === 'prepareSimulation') foreign.commandId = 'foreign'
  else foreign.runId = 'foreign'
  vi.spyOn(client, 'request').mockResolvedValue(foreign)
  await expect((client[method] as (input: unknown) => Promise<unknown>).call(client, input)).rejects.toBeInstanceOf(SdkProtocolError)
})

it('keeps not-found distinct and refuses mismatched absence, sections, revisions, collections, kinds and preparation targets', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const send = vi.spyOn(client, 'request').mockResolvedValue({ status: 'not-found', commandId: 'original' })
  expect(await client.getSimulationRequest({ commandId: 'original' })).toEqual({ status: 'not-found', commandId: 'original' })
  send.mockResolvedValue({ status: 'not-found', commandId: 'foreign' })
  await expect(client.getSimulationRequest({ commandId: 'original' })).rejects.toThrow('different selection')
  send.mockResolvedValue({ ...receipt, kind: 'prepare' })
  await expect(client.createSimulation(create)).rejects.toThrow('different selection')
  send.mockResolvedValue({ ...receipt, kind: 'prepare', runId: 'foreign' })
  await expect(client.prepareSimulation({ runId: 'run', commandId: 'original' })).rejects.toThrow('different selection')
  send.mockResolvedValue({ runId: 'run', collection: 'operations', snapshotRevision: 1, observedAt: 1, items: [], total: 0 })
  await expect(client.browseSimulation({ runId: 'run', collection: 'entities' })).rejects.toThrow('different selection')
  for (const foreign of [{ ...selection, id: 'foreign' }, { collection: 'operations', id: 'entity', section: 'attempts' },
    { collection: 'operations', id: 'entity', section: 'execution' }]) {
    send.mockResolvedValue({ runId: 'run', selection: foreign, snapshotRevision: 1, observedAt: 1, status: 'missing' })
    await expect(client.inspectSimulationObject({ runId: 'run', ...selection } as never)).rejects.toThrow('different selection')
  }
  send.mockResolvedValue({ runId: 'run', selection, snapshotRevision: 2, observedAt: 1, status: 'missing' })
  await expect(client.inspectSimulationObject({ runId: 'run', ...selection, expectedRevision: 1 } as never)).rejects.toThrow('different selection')
})

it('binds a decision knowledge inspection to the exact frozen reference', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const input = { runId: 'run', collection: 'decisions' as const, id: 'decision', section: 'knowledge' as const,
    reference: { id: 'knowledge', revision: 1 } }
  const result = { runId: 'run', selection: { collection: 'decisions', id: 'decision', section: 'knowledge',
    reference: input.reference }, snapshotRevision: 1, observedAt: 1, status: 'missing' }
  const request = vi.spyOn(client, 'request').mockResolvedValue(result)
  expect(await client.inspectSimulationObject(input)).toEqual(result)
  for (const reference of [{ id: 'other', revision: 1 }, { id: 'knowledge', revision: 2 }, undefined]) {
    request.mockResolvedValueOnce({ ...result, selection: { ...result.selection, reference } })
    await expect(client.inspectSimulationObject(input)).rejects.toThrow('different selection')
  }
})

it('rejects a Simulation review page from a different observed revision', async () => {
  const client = new HarnessClient({ command: process.execPath })
  vi.spyOn(client, 'request').mockResolvedValue({ runId: 'run', snapshotRevision: 2,
    observedAt: 1, total: 0, items: [] })
  await expect(client.listSimulationTaskReviews({ runId: 'run', expectedRevision: 1 }))
    .rejects.toThrow('another selection')
})

it('rejects caller-supplied execution configuration before sending and refuses malformed public results', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const send = vi.spyOn(client, 'request').mockResolvedValue({ items: [], private: 'not public' })
  await expect(client.createSimulation({ ...create, provider: 'arbitrary' } as never)).rejects.toBeInstanceOf(SdkProtocolError)
  expect(send).not.toHaveBeenCalled()
  await expect(client.simulationCatalog()).rejects.toBeInstanceOf(SdkProtocolError)
  send.mockResolvedValue({ items: [] })
  expect(await client.listSimulations()).toEqual({ items: [] })
})

it('rejects substituted scheduling intent, checkpoint target and ingress metadata while retaining exact absence', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const send = vi.spyOn(client, 'request')
  for (const operation of [{ ...management, managementId: 'foreign' }, { ...management, phase: 'paused' }]) {
    send.mockResolvedValue({ runId: 'run', operation, control })
    await expect(client.manageSimulation({ runId: 'run', managementId: 'management', phase: 'running' })).rejects.toThrow('different selection')
  }
  for (const result of [{ ...receipt, kind: 'prepare' }, { ...receipt, kind: 'checkpoint', checkpointId: 'cut', commandId: 'foreign' }]) {
    send.mockResolvedValue(result)
    await expect(client.checkpointSimulation({ runId: 'run', commandId: 'original' })).rejects.toThrow('different selection')
  }
  for (const result of [{ ...receipt, kind: 'checkpoint', checkpointId: 'cut' },
    { ...receipt, kind: 'restore', checkpointId: 'foreign' }, { ...receipt, kind: 'restore', checkpointId: 'cut', commandId: 'foreign' }]) {
    send.mockResolvedValue(result)
    await expect(client.restoreSimulation({ runId: 'run', commandId: 'original', checkpointId: 'cut' })).rejects.toThrow('different selection')
  }
  for (const result of [{ ...ingress, ingressId: 'foreign' }, { ...ingress, entityId: 'foreign' }, { ...ingress, availableAt: '2' }]) {
    send.mockResolvedValue(result)
    await expect(client.ingressSimulation({ runId: 'run', ingressId: 'input', entityId: 'entity', text: 'Input', availableAt: ingress.availableAt }))
      .rejects.toThrow('different selection')
  }
  send.mockResolvedValue({ runId: 'run', managementId: 'management', status: 'not-found' })
  expect((await client.getSimulationManagement({ runId: 'run', managementId: 'management' })).status).toBe('not-found')
  send.mockResolvedValue({ runId: 'run', managementId: 'foreign', status: 'not-found' })
  await expect(client.getSimulationManagement({ runId: 'run', managementId: 'management' })).rejects.toThrow('different selection')
  send.mockResolvedValue({ runId: 'run', ingressId: 'input', status: 'not-found' })
  expect((await client.getSimulationIngress({ runId: 'run', ingressId: 'input' })).status).toBe('not-found')
  send.mockResolvedValue({ runId: 'run', ingressId: 'foreign', status: 'not-found' })
  await expect(client.getSimulationIngress({ runId: 'run', ingressId: 'input' })).rejects.toThrow('different selection')
})

it.each([
  ['manageSimulation', { runId: 'run', managementId: 'management', phase: 'running', expectedRevision: 1 }],
  ['restoreSimulation', { runId: 'run', commandId: 'original', checkpointId: 'cut', rollback: true }],
  ['checkpointSimulation', { runId: 'run', commandId: 'original', maxAttempts: 99 }],
  ['ingressSimulation', { runId: 'run', ingressId: 'input', entityId: 'entity', text: 'Input', availableAt: '01' }],
  ['ingressSimulation', { runId: 'run', ingressId: 'input', entityId: 'entity', text: 'Input', availableAt: '1', source: 'admin' }],
] as const)('rejects unsupported %s parameters before sending', async (method, input) => {
  const client = new HarnessClient({ command: process.execPath })
  const send = vi.spyOn(client, 'request')
  await expect((client[method] as (input: unknown) => Promise<unknown>).call(client, input)).rejects.toBeInstanceOf(SdkProtocolError)
  expect(send).not.toHaveBeenCalled()
})

it('correlates journal mode, filters, revision, sequence and bounded page size', async () => {
  const client = new HarnessClient({ command: 'unused' })
  const page = { runId: 'run', mode: 'original', selection: { sequence: 2 }, snapshotRevision: 3,
    readVersion: 'policy', observedAt: 1, bodyAccess: 'allowed', totalRecords: 1,
    items: [{ sequence: 2, kind: { text: 'run/change', truncated: false }, body: { status: 'text', text: '{}', part: 0, parts: 1 } }] }
  const request = vi.spyOn(client, 'request').mockResolvedValue(page)
  const input = { runId: 'run', mode: 'original' as const, sequence: 2, expectedRevision: 3, limit: 1 }
  expect(await client.readSimulationRecords(input)).toEqual(page)
  for (const patch of [{ runId: 'other' }, { mode: 'metadata' }, { selection: { sequence: 1 } },
    { snapshotRevision: 4 }, { items: [{ ...page.items[0], sequence: 1 }] }, { items: [...page.items, ...page.items] }]) {
    request.mockResolvedValueOnce({ ...page, ...patch })
    await expect(client.readSimulationRecords(input)).rejects.toThrow()
  }
})

it('correlates frozen source identity and refuses content on redacted replies', async () => {
  const client = new HarnessClient({ command: 'unused' })
  const value = { runId: 'run', decisionId: 'decision', sourceIndex: 2, snapshotRevision: 4, readVersion: 'policy',
    observedAt: 1, status: 'found', source: { kind: 'team-envelope', teamId: 'team', channelId: 'channel', envelopeId: 'original' },
    envelope: { sequence: 5, kind: { text: 'message', truncated: false }, createdAt: 1 },
    items: [{ block: 0, body: { status: 'text', text: 'original', part: 0, parts: 1 } }] }
  const request = vi.spyOn(client, 'request').mockResolvedValue(value)
  const input = { runId: 'run', decisionId: 'decision', sourceIndex: 2, expectedRevision: 4, envelopeSequence: 5, limit: 1 }
  expect(await client.inspectSimulationSource(input)).toEqual(value)
  for (const patch of [{ decisionId: 'other' }, { sourceIndex: 1 }, { snapshotRevision: 3 }, { runId: 'other' },
    { envelope: { ...value.envelope, sequence: 6 } }, { status: 'withheld' }, { items: [...value.items, ...value.items] }]) {
    request.mockResolvedValueOnce({ ...value, ...patch })
    await expect(client.inspectSimulationSource(input)).rejects.toThrow()
  }
})

it('correlates every exact status identity in order and distinguishes malformed or unavailable usage from zero', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const run = { run: summary, status: 'missing' as const }
  const other = { run: { ...summary, id: 'other' as never }, status: 'missing' as const }
  const send = vi.spyOn(client, 'request').mockResolvedValue({ items: [run, other],
    modelPool: { status: 'unavailable', clock: 'real', observedAt: 1 } })
  expect((await client.getSimulationRunStatuses({ runIds: ['run', 'other'] })).modelPool).toEqual({ status: 'unavailable', clock: 'real', observedAt: 1 })
  for (const items of [[other, run], [run, run], [run]]) {
    send.mockResolvedValueOnce({ items })
    await expect(client.getSimulationRunStatuses({ runIds: ['run', 'other'] })).rejects.toThrow('exact run batch')
  }
  for (const modelPool of [{ status: 'unavailable', clock: 'real', observedAt: 1, active: 0 },
    { status: 'observed', clock: 'real', observedAt: 1, active: 2, queued: 0, limit: 1, queueLimit: 1 },
    { status: 'observed', clock: 'simulated', observedAt: 1, active: 0, queued: 0, limit: 1, queueLimit: 1 }]) {
    send.mockResolvedValueOnce({ items: [run], modelPool })
    await expect(client.getSimulationRunStatuses({ runIds: ['run'] })).rejects.toBeInstanceOf(SdkProtocolError)
  }
  await expect(client.getSimulationRunStatuses({ runIds: ['run', 'run'] })).rejects.toBeInstanceOf(SdkProtocolError)
})


it('validates original operation retry family, safe observed attempts and exact queried input ownership without implicit requests', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const input = { runId: 'run', commandId: 'retry-original', operationId: 'unknown-operation', expectedAttemptCount: 3, reason: 'Recover receipt' }
  const send = vi.spyOn(client, 'request').mockResolvedValue({ ...receipt, commandId: input.commandId, kind: 'retry-operation' })
  expect((await client.retrySimulationOperation(input)).kind).toBe('retry-operation')
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith('simulation/operation-retry', input)
  for (const wrong of [{ ...receipt, commandId: input.commandId, kind: 'review' },
    { ...receipt, commandId: input.commandId, kind: 'retry-operation', runId: 'other' },
    { ...receipt, commandId: 'other', kind: 'retry-operation' }]) {
    send.mockResolvedValueOnce(wrong)
    await expect(client.retrySimulationOperation(input)).rejects.toBeInstanceOf(SdkProtocolError)
  }
  for (const expectedAttemptCount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(client.retrySimulationOperation({ ...input, expectedAttemptCount })).rejects.toBeInstanceOf(SdkProtocolError)
  }
  await expect(client.retrySimulationOperation({ ...input, commandId: ' surrounding-space ' })).rejects.toBeInstanceOf(SdkProtocolError)
  const found = { status: 'found', request: { ...receipt, commandId: input.commandId, kind: 'retry-operation' }, retryOperation: input }
  send.mockResolvedValueOnce(found)
  expect(await client.getSimulationRequest({ commandId: input.commandId })).toEqual(found)
  for (const retryOperation of [undefined, { ...input, runId: 'other' }, { ...input, commandId: 'other' },
    { ...input, expectedAttemptCount: 0 }]) {
    send.mockResolvedValueOnce({ ...found, retryOperation })
    await expect(client.getSimulationRequest({ commandId: input.commandId })).rejects.toBeInstanceOf(SdkProtocolError)
  }
  send.mockResolvedValueOnce({ status: 'not-found', commandId: input.commandId })
  expect(await client.getSimulationRequest({ commandId: input.commandId })).toEqual({ status: 'not-found', commandId: input.commandId })
})


it('retains exact safe recovery diagnoses while rejecting private error payloads and wrong operation families', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const input = { runId: 'run', commandId: 'original', checkpointId: 'cut' }
  const diagnostic = { stage: 'validate', code: 'binding-mismatch',
    subject: { kind: 'session', sessionId: 'session', teamId: 'team', participantId: 'participant' }, cleanup: 'unconfirmed' }
  const failed = { ...receipt, kind: 'restore', status: 'failed', failure: 'restore-failed', checkpointId: 'cut', diagnostic }
  const send = vi.spyOn(client, 'request').mockResolvedValue(failed)
  expect(await client.restoreSimulation(input)).toEqual(failed)
  for (const invalid of [{ ...failed, diagnostic: { ...diagnostic, message: 'Private provider path' } },
    { ...failed, diagnostic: { ...diagnostic, subject: { ...diagnostic.subject, path: '/private' } } },
    { ...receipt, kind: 'retry-operation', diagnostic }]) {
    send.mockResolvedValueOnce(invalid)
    await expect(client.restoreSimulation(input)).rejects.toBeInstanceOf(SdkProtocolError)
  }
})

const configuration = { limits: { maxEntities: 2, maxResidentActors: 2, tokensPerModelRequest: 1000,
  maxTokensPerInterval: 2000, maxTime: '9007199254740993' }, budgetInterval: '100',
tickUnit: { text: 'minute', truncated: false }, rulesVersion: { text: '1', truncated: false },
policyVersion: { text: '1', truncated: false }, sharedModelLimit: 1 }

it('preflights through both SDK APIs with exact decimal allowances and rejects native configuration before sending', async () => {
  const { commandId: _commandId, expectedModel: _expectedModel, ...draft } = create
  const input = { ...draft, limits: { maxTime: configuration.limits.maxTime } }
  const output = { status: 'ready', configuration, readiness: { status: 'ready', model: create.expectedModel } }
  for (const high of [false, true]) {
    const client = new HarnessClient({ command: process.execPath })
    const clocky = new Clocky({ launch: { command: process.execPath }, credential: 'test', provider: 'test', model: 'test' })
    vi.spyOn(clocky, 'start').mockResolvedValue()
    const transport = high ? clocky.client : client
    const api = high ? clocky : client
    const send = vi.spyOn(transport, 'request').mockResolvedValue(output)
    expect(await api.preflightSimulation(input)).toEqual(output)
    expect(send).toHaveBeenCalledWith('simulation/runs-preflight', input)
    send.mockClear()
    for (const unsafe of [{ ...input, commandId: 'allocated' }, { ...input, provider: 'arbitrary' },
      { ...input, limits: { sharedModelLimit: 100 } }]) {
      await expect(api.preflightSimulation(unsafe as never)).rejects.toBeInstanceOf(SdkProtocolError)
    }
    expect(send).not.toHaveBeenCalled()
    send.mockResolvedValue({ status: 'ready', configuration: { ...configuration, cwd: '/private' } })
    await expect(api.preflightSimulation(input)).rejects.toBeInstanceOf(SdkProtocolError)
    const invalid = { status: 'invalid', readiness: { status: 'needs-model', reason: 'default-model-missing' }, issues: [{ field: 'limits.maxEntities', code: 'not-allowed',
      message: { text: 'This allowance is fixed by deployment.', truncated: false } }] }
    send.mockResolvedValue(invalid)
    expect(await api.preflightSimulation(input)).toEqual(invalid)
  }
})

it('validates bounded original request pages and refuses retry payload substitution before sending', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const send = vi.spyOn(client, 'request')
  const input = { runId: 'run', expectedRevision: 2, limit: 1 }
  for (const result of [
    { runId: 'run', snapshotRevision: 3, items: [receipt], total: 1 },
    { runId: 'run', snapshotRevision: 2, items: [receipt, { ...receipt, commandId: 'second' }], total: 2 },
    { runId: 'run', snapshotRevision: 2, items: [{ ...receipt, runId: 'private' }], total: 1 },
    { runId: 'run', snapshotRevision: 2, items: [receipt], total: 1, input: create },
  ]) {
    send.mockResolvedValue(result)
    await expect(client.listSimulationRequests(input)).rejects.toBeInstanceOf(SdkProtocolError)
  }
  send.mockClear()
  await expect(client.retrySimulationRequest({ runId: 'run', commandId: 'original', input: create } as never))
    .rejects.toBeInstanceOf(SdkProtocolError)
  expect(send).not.toHaveBeenCalled()
  send.mockResolvedValue({ ...receipt, commandId: 'different-original' })
  await expect(client.retrySimulationRequest({ runId: 'run', commandId: 'original' })).rejects.toThrow('different original request')
})

it('requires an explicit no-lease cancellation fence and correlates the original command and operation family', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const input = { runId: 'run', commandId: 'original', operationId: 'operation', expectedRevision: 2,
    expectedAttemptId: null, reason: 'Cancel original task' }
  const send = vi.spyOn(client, 'request').mockResolvedValue({ ...receipt, kind: 'cancel-task' })
  await client.cancelSimulationTask(input)
  expect(send).toHaveBeenCalledWith('simulation/tasks-cancel', input)
  const { expectedAttemptId: _fence, ...missing } = input
  for (const invalid of [missing, { ...input, actor: {} }, { ...input, expectedRevision: 0 }, { ...input, reason: ' ' }]) {
    send.mockClear()
    await expect(client.cancelSimulationTask(invalid as typeof input)).rejects.toBeInstanceOf(SdkProtocolError)
    expect(send).not.toHaveBeenCalled()
  }
  for (const output of [{ ...receipt, kind: 'cancel-task', commandId: 'another' }, { ...receipt, kind: 'review' }]) {
    send.mockResolvedValueOnce(output)
    await expect(client.cancelSimulationTask(input)).rejects.toBeInstanceOf(SdkProtocolError)
  }
})
