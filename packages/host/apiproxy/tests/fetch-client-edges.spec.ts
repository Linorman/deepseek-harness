/** Fetch client methods keep URL, rpcId and selected Team identities bound to each response. */
import { expect, it } from 'vitest'
import { simulationProductCreateInputSchema, simulationProductPrepareInputSchema,
  simulationProductRequestReceiptSchema, simulationProductRequestResultSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWatchResultSchema, simulationProductTasksPageSchema,
  simulationProductTaskReviewPageSchema, simulationProductTaskReviewResolveInputSchema,
  simulationProductObjectInputSchema, simulationProductObjectInspectionSchema } from '@clocky/clocky-simulation-product/schema'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { simulationProductCommandIdSchema, simulationProductRunIdSchema } from '@clocky/clocky-simulation-product/schema'
import { teamWorkflowInspectRequestSchema, teamTaskDetailsUpdateInputSchema } from '@clocky/clocky-team'

interface Sent {
  readonly url: URL
  readonly request: { readonly rpcId: string; readonly method: string; readonly payload: unknown }
}

function client(reply: (sent: Sent) => object) {
  const sent: Sent[] = []
  const api = new InProcessApiClient({ fetch: async (input, init) => {
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON fetch body')
    const url = input instanceof URL ? input : input instanceof Request ? new URL(input.url) : new URL(input)
    const item = { url, request: JSON.parse(init.body) as Sent['request'] }
    sent.push(item)
    return Response.json({ type: 'server-response', rpcId: item.request.rpcId, result: reply(item) })
  } })
  return { api, sent }
}

it('routes Team inbox watching and metrics through their public URLs with exact rpcId echoes', async () => {
  const { api, sent } = client(() => ({ ok: false, error: { code: 'internal', message: 'Try later', details: {} } }))
  const watched = await api.teams.inboxWatch({ afterCursor: -1, limit: 2 })
  const metrics = await api.teams.metrics({})
  expect(watched.result).toMatchObject({ ok: false, error: { code: 'internal' } })
  expect(metrics.result).toMatchObject({ ok: false, error: { code: 'internal' } })
  expect(sent.map(item => item.url.pathname)).toEqual(['/api/team.inbox.watch', '/api/team.metrics'])
  expect(sent.map(item => item.request.method)).toEqual(['team.inbox.watch', 'team.metrics'])
  expect([watched.rpcId, metrics.rpcId]).toEqual(sent.map(item => item.request.rpcId))
})

function workflow(teamId = 'team', planId = 'plan', revision = 1, startCursor = -1) {
  return { record: { id: planId, teamId, revision, phase: 'compiling', name: 'Plan',
    bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 } },
  teamCursor: 1, startCursor, total: 0, scanned: 0, items: [] }
}

it('accepts a selected workflow detail and rejects valid details from another selection', async () => {
  let result = workflow()
  const { api, sent } = client(() => ({ ok: true, value: result }))
  const selection = teamWorkflowInspectRequestSchema.parse({ teamId: 'team', planId: 'plan', expectedRevision: 1 })
  await expect(api.teams.workflowPlanInspect(selection)).resolves.toMatchObject({ result: { ok: true, value: workflow() } })
  expect(sent[0]?.url.pathname).toBe('/api/team.workflow.plan.inspect')
  for (const other of [workflow('foreign'), workflow('team', 'foreign'), workflow('team', 'plan', 2),
    workflow('team', 'plan', 1, 0)]) {
    result = other
    await expect(api.teams.workflowPlanInspect(selection)).rejects.toThrow('Workflow inspection response does not match its selection')
  }
})

function task(teamId = 'team', id = 'task', revision = 2) {
  return { id, teamId, createdAt: 1, revision, execution: { kind: 'participant' },
    createCommand: { creator: { teamId, participantId: 'human' }, idempotencyKey: 'create-task' },
    subject: 'Updated subject', description: 'Original description', phase: 'pending', blockedBy: [], requiredCapabilities: [],
    priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' },
    reviewHistory: [], maxAttempts: 1, attemptCount: 0, attemptHistory: [] }
}

it('accepts an update receipt only for its original Team, task, command and revision', async () => {
  const command = teamTaskDetailsUpdateInputSchema.parse({ teamId: 'team', taskId: 'task', commandId: 'update-task', expectedRevision: 1, subject: 'Updated subject' })
  const receipt = { teamId: 'team', taskId: 'task', commandId: 'update-task', expectedRevision: 1,
    appliedRevision: 2, appliedAt: 3 }
  let value = { receipt, task: task() }
  const { api, sent } = client(() => ({ ok: true, value }))
  await expect(api.teams.taskUpdate(command)).resolves.toMatchObject({ result: { ok: true, value: { receipt } } })
  expect(sent[0]?.url.pathname).toBe('/api/team.task.update')
  for (const other of [
    { receipt: { ...receipt, teamId: 'foreign' }, task: task('foreign') },
    { receipt: { ...receipt, taskId: 'foreign' }, task: task('team', 'foreign') },
    { receipt: { ...receipt, commandId: 'foreign' }, task: task() },
    { receipt: { ...receipt, expectedRevision: 2, appliedRevision: 3 }, task: task('team', 'task', 3) },
  ]) {
    value = other
    await expect(api.teams.taskUpdate(command)).rejects.toThrow('Task update receipt does not match its original command')
  }
})

it('keeps Simulation creation and preparation receipts bound to the original command', async () => {
  const create = simulationProductCreateInputSchema.parse({ commandId: 'create-command', templateId: 'company',
    expectedModel: { provider: 'company', name: 'scripted' },
    templateVersion: '1', name: 'Company', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
  const prepare = simulationProductPrepareInputSchema.parse({ runId: 'run', commandId: 'prepare-command' })
  let receipt = simulationProductRequestReceiptSchema.parse({ commandId: create.commandId, runId: 'run',
    kind: 'create', acceptedAt: 1, status: 'accepted' })
  const { api, sent } = client(() => ({ ok: true, value: receipt }))
  await expect(api.simulations.create(create)).resolves.toMatchObject({ result: { ok: true, value: receipt } })
  expect(sent[0]?.url.pathname).toBe('/api/simulation.runs.create')
  for (const patch of [{ commandId: 'foreign' }, { kind: 'prepare' as const }]) {
    receipt = simulationProductRequestReceiptSchema.parse({ ...receipt, ...patch })
    await expect(api.simulations.create(create)).rejects.toThrow('administration response does not match its original command')
  }
  receipt = simulationProductRequestReceiptSchema.parse({ commandId: prepare.commandId, runId: prepare.runId,
    kind: 'prepare', acceptedAt: 2, status: 'accepted' })
  await expect(api.simulations.prepare(prepare)).resolves.toMatchObject({ result: { ok: true, value: receipt } })
  expect(sent.at(-1)?.url.pathname).toBe('/api/simulation.runs.prepare')
  for (const patch of [{ commandId: 'foreign' }, { kind: 'create' as const }, { runId: 'foreign' }]) {
    receipt = simulationProductRequestReceiptSchema.parse({ ...receipt, ...patch })
    await expect(api.simulations.prepare(prepare)).rejects.toThrow('administration response does not match its original command')
  }
})

it('matches found and absent Simulation request results to the exact command', async () => {
  const originalId = simulationProductCommandIdSchema.parse('original')
  let result = simulationProductRequestResultSchema.parse({ status: 'not-found', commandId: 'original' })
  const { api, sent } = client(() => ({ ok: true, value: result }))
  await expect(api.simulations.request({ commandId: originalId })).resolves.toMatchObject({ result: { ok: true } })
  expect(sent[0]?.url.pathname).toBe('/api/simulation.requests.get')
  result = simulationProductRequestResultSchema.parse({ status: 'not-found', commandId: 'foreign' })
  await expect(api.simulations.request({ commandId: originalId })).rejects.toThrow('response does not match its original command')
  result = simulationProductRequestResultSchema.parse({ status: 'found', request: {
    commandId: 'original', runId: 'run', kind: 'create', acceptedAt: 1, status: 'accepted',
  } })
  await expect(api.simulations.request({ commandId: originalId })).resolves.toMatchObject({ result: { ok: true } })
  result = simulationProductRequestResultSchema.parse({ status: 'found', request: {
    commandId: 'foreign', runId: 'run', kind: 'create', acceptedAt: 1, status: 'accepted',
  } })
  await expect(api.simulations.request({ commandId: originalId })).rejects.toThrow('response does not match its original command')
})

it('preserves valid business errors from Simulation reads and maintenance calls', async () => {
  const { api, sent } = client(() => ({ ok: false, error: { code: 'simulation-product-unavailable', message: 'No run here', details: {} } }))
  const runId = simulationProductRunIdSchema.parse('run')
  const decisionId = 'decision' as never
  const commandId = simulationProductCommandIdSchema.parse('checkpoint')
  const restoreId = simulationProductCommandIdSchema.parse('restore')
  const checkpointId = 'checkpoint' as never
  const ingressId = 'ingress' as never
  const entityId = 'entity' as never
  const availableAt = '1' as never
  const operations = [
    () => api.simulations.inspectSource({ runId, decisionId, sourceIndex: 0 }),
    () => api.simulations.records({ runId, mode: 'metadata' }),
    () => api.simulations.watch({ runId }),
    () => api.simulations.checkpoint({ runId, commandId }),
    () => api.simulations.restore({ runId, commandId: restoreId, checkpointId }),
    () => api.simulations.ingress({ runId, ingressId, entityId, text: 'Notice', availableAt }),
    () => api.simulations.ingressRequest({ runId, ingressId }),
  ]
  for (const operation of operations) {
    await expect(operation()).resolves.toMatchObject({ result: { ok: false, error: { code: 'simulation-product-unavailable' } } })
  }
  expect(sent.map(item => item.request.method)).toEqual([
    'simulation.sources.inspect', 'simulation.records.list', 'simulation.changes.watch', 'simulation.checkpoints.create',
    'simulation.runs.restore', 'simulation.ingress.create', 'simulation.ingress.get',
  ])
})

it('rejects a watch or bounded page from a different run revision', async () => {
  const runId = simulationProductRunIdSchema.parse('run')
  const watch = simulationProductWatchResultSchema.parse({ runId: 'foreign', readVersion: 'policy', cursor: 'next',
    status: 'changed', observedAt: 1, world: { status: 'missing' } })
  const watched = client(() => ({ ok: true, value: watch }))
  await expect(watched.api.simulations.watch({ runId })).rejects.toThrow('watch response does not match its run')

  const tasks = simulationProductTasksPageSchema.parse({ runId: 'run', snapshotRevision: 2,
    observedAt: 1, total: 0, items: [] })
  const taskPage = client(() => ({ ok: true, value: tasks }))
  await expect(taskPage.api.simulations.listTasks({ runId, expectedRevision: 3 }))
    .rejects.toThrow('task page does not match its original selection')

  const reviews = simulationProductTaskReviewPageSchema.parse({ runId: 'run', snapshotRevision: 2,
    observedAt: 1, total: 0, items: [] })
  const reviewPage = client(() => ({ ok: true, value: reviews }))
  await expect(reviewPage.api.simulations.listTaskReviews({ runId, expectedRevision: 3 }))
    .rejects.toThrow('review page does not match its original selection')
})

it('rejects a schema-valid review receipt with another original operation kind', async () => {
  const input = simulationProductTaskReviewResolveInputSchema.parse({ runId: 'run', commandId: 'review',
    operationId: 'operation', attemptId: 'attempt', expectedRevision: 1, nextPhase: 'completed', reason: 'Approved' })
  const receipt = simulationProductRequestReceiptSchema.parse({ runId: 'run', commandId: 'review',
    kind: 'create', acceptedAt: 1, status: 'accepted' })
  const { api } = client(() => ({ ok: true, value: receipt }))
  await expect(api.simulations.resolveTaskReview(input)).rejects.toThrow('review receipt does not match its original selection')
})

it('rejects a schema-valid knowledge observation for a different exact reference', async () => {
  const input = simulationProductObjectInputSchema.parse({ runId: 'run', collection: 'decisions', id: 'decision',
    section: 'knowledge', reference: { id: 'knowledge', revision: 1 } })
  const base = { runId: 'run', snapshotRevision: 1, observedAt: 1, status: 'missing' as const,
    selection: { collection: 'decisions' as const, id: 'decision', section: 'knowledge' as const,
      reference: { id: 'knowledge', revision: 1 } } }
  const current = simulationProductObjectInspectionSchema.parse(base)
  const { api } = client(() => ({ ok: true, value: current }))
  await expect(api.simulations.inspectObject(input)).resolves.toMatchObject({ result: { ok: true, value: current } })
  for (const reference of [{ id: 'other', revision: 1 }, { id: 'knowledge', revision: 2 }]) {
    const changed = simulationProductObjectInspectionSchema.parse({ ...base,
      selection: { ...base.selection, reference } })
    const wrong = client(() => ({ ok: true, value: changed }))
    await expect(wrong.api.simulations.inspectObject(input)).rejects.toThrow('object response does not match its exact selection')
  }
})
