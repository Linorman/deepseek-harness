/** Simulation dispatch preserves product authorization and exposes only stable public failure categories. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { SimulationProductError } from '@clocky/clocky-simulation-product'
import type { SimulationProducts, SimulationAdministration } from '@clocky/clocky-simulation-product'
import { dispatchSimulation } from '../src/simulation.ts'
import { HarnessSdkJsonRpcServer } from '../src/server.ts'
import { installTestProductPrincipals, SDK_TEST_CREDENTIAL } from './product-auth.ts'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'

const call: AuthenticatedProductCall = { principal: { id: 'reader' as never, issuer: 'test', subject: 'reader', assurance: 'test',
  credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
const create = { commandId: 'original', templateId: 'company', templateVersion: '1', name: 'Company',
  parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } }
const selections = [
  ['tasks-list', 'listTasks', { runId: 'run', limit: 1 }],
  ['tasks-cancel', 'cancelTask', { runId: 'run', commandId: 'original-cancel', operationId: 'created-task',
    expectedAttemptId: null, expectedRevision: 3, reason: 'Cancel original task' }],
  ['operation-retry', 'retryOperation', { runId: 'run', commandId: 'retry-original', operationId: 'unknown-operation',
    expectedAttemptCount: 3, reason: 'Reconcile the existing target' }],
  ['runs-statuses', 'runStatuses', { runIds: ['run'] }],
  ['task-reviews-list', 'listTaskReviews', { runId: 'run', limit: 1 }],
  ['task-reviews-resolve', 'resolveTaskReview', { runId: 'run', commandId: 'original-review', operationId: 'created-task',
    attemptId: 'attempt', expectedRevision: 3, nextPhase: 'completed', reason: 'Approved' }],
  ['sources-inspect', 'inspectSource', { runId: 'run', decisionId: 'decision', sourceIndex: 0 }],
  ['records-list', 'readRecords', { runId: 'run', mode: 'original', sequence: 2 }],
  ['catalog', 'catalog', {}], ['runs-list', 'list', {}], ['runs-inspect', 'inspect', { runId: 'run' }],
  ['collections-list', 'browse', { runId: 'run', collection: 'entities' }],
  ['objects-inspect', 'inspectObject', { runId: 'run', collection: 'entities', id: 'entity', section: 'identity' }],
  ['runs-preflight', 'preflight', { templateId: 'company', templateVersion: '1', name: 'Company', parameters: create.parameters }],
  ['runs-create', 'create', create], ['runs-prepare', 'prepare', { runId: 'run', commandId: 'prepare' }],
  ['requests-list', 'listRequests', { runId: 'run', limit: 1, expectedRevision: 2 }],
  ['requests-retry', 'retryRequest', { runId: 'run', commandId: 'original' }],
  ['requests-get', 'request', { commandId: 'original' }],
  ['runs-control', 'control', { runId: 'run' }],
  ['runs-manage', 'manage', { runId: 'run', managementId: 'management', phase: 'running' }],
  ['management-get', 'managementRequest', { runId: 'run', managementId: 'management' }],
  ['runs-checkpoint', 'checkpoint', { runId: 'run', commandId: 'original' }],
  ['runs-restore', 'restore', { runId: 'run', commandId: 'original', checkpointId: 'cut' }],
  ['runs-ingress', 'ingress', { runId: 'run', ingressId: 'input', entityId: 'entity', text: 'Input', availableAt: '9007199254740993' }],
  ['ingress-get', 'ingressRequest', { runId: 'run', ingressId: 'input' }],
] as const

it.each(selections)('routes %s to its current optional product owner with the transport call', async (method, handler, input) => {
  const ctx = new Context()
  const result = { original: 'receipt' }
  const operation = vi.fn(async () => result)
  const admin = !['list', 'inspect', 'browse', 'inspectObject', 'readRecords', 'inspectSource'].includes(handler)
  if (admin) ctx.provide('simulationAdministration', { [handler]: operation } as unknown as SimulationAdministration)
  else ctx.provide('simulationProducts', { [handler]: operation } as unknown as SimulationProducts)
  try {
    expect(await dispatchSimulation(ctx, `simulation/${method}`, input, call)).toBe(result)
    expect(operation).toHaveBeenCalledWith(...handler === 'catalog' ? [call] : [input, call])
  } finally { await ctx.fiber.dispose() }
})

it('parses empty catalog/list parameters and refuses missing optional owners without native fallback', async () => {
  const ctx = new Context()
  try {
    for (const method of ['catalog', 'runs-list']) {
      await expect(dispatchSimulation(ctx, `simulation/${method}`, undefined, call))
        .rejects.toMatchObject({ code: -32002, data: { code: 'SIMULATION_PRODUCT_UNAVAILABLE' } })
    }
    await expect(dispatchSimulation(ctx, 'simulation/unknown', {}, call)).rejects.toMatchObject({ code: -32601 })
    await expect(dispatchSimulation(ctx, 'simulation/runs-create', { ...create, provider: 'arbitrary' }, call))
      .rejects.toMatchObject({ code: -32602 })
  } finally { await ctx.fiber.dispose() }
})

it.each(['SIMULATION_PRODUCT_FORBIDDEN', 'SIMULATION_PRODUCT_INVALID', 'SIMULATION_PRODUCT_UNAVAILABLE', 'SIMULATION_PRODUCT_STALE'] as const)
('preserves the %s product category', async (code) => {
  const ctx = new Context()
  ctx.provide('simulationProducts', { list: () => { throw new SimulationProductError('Public reason', code) } } as unknown as SimulationProducts)
  try {
    await expect(dispatchSimulation(ctx, 'simulation/runs-list', {}, call)).rejects.toMatchObject({ code: -32002, message: 'Public reason', data: { code } })
  } finally { await ctx.fiber.dispose() }
})

it('withholds uncategorized provider diagnostics and preserves intentional JSON-RPC failures', async () => {
  const ctx = new Context()
  const operation = vi.fn().mockRejectedValue(new Error('secret storage /absolute/path'))
  ctx.provide('simulationProducts', { list: operation } as unknown as SimulationProducts)
  try {
    await expect(dispatchSimulation(ctx, 'simulation/runs-list', {}, call)).rejects.toMatchObject({ code: -32603,
      message: 'Simulation request could not be completed', data: { code: 'SIMULATION_PRODUCT_INTERNAL' } })
  } finally { await ctx.fiber.dispose() }
})

it('rejects unauthenticated Simulation requests before product lookup', async () => {
  const ctx = new Context()
  const server = new HarnessSdkJsonRpcServer(ctx, { request: vi.fn(), notify: vi.fn() })
  try {
    await expect(server.handleRequest('simulation/runs-list', {})).rejects.toMatchObject({ data: { code: 'PRODUCT_AUTH_REQUIRED' } })
    await installTestProductPrincipals(ctx)
    ctx.provide('llm', { listProviders: () => [{ id: 'test-provider' }] } as never)
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    await expect(server.handleRequest('simulation/runs-list', {}))
      .rejects.toMatchObject({ data: { code: 'SIMULATION_PRODUCT_UNAVAILABLE' } })
    const read = Promise.withResolvers<unknown>()
    ctx.provide('simulationProducts', { list: () => read.promise } as unknown as SimulationProducts)
    const pending = server.handleRequest('simulation/runs-list', {})
    await Promise.resolve(); await Promise.resolve()
    await server.initialize({ credential: SDK_TEST_CREDENTIAL, cwd: process.cwd(), provider: 'test-provider', model: 'test-model' })
    read.resolve({ items: [] })
    await expect(pending).rejects.toMatchObject({ data: { code: 'PRODUCT_AUTH_INVALID' } })
  } finally { await server.shutdown(); await ctx.fiber.dispose() }
})

it.each(selections.filter(([, handler]) => !['list', 'inspect', 'browse', 'inspectObject', 'readRecords', 'inspectSource'].includes(handler)))('validates %s before resolving missing administration', async (method, _handler, input) => {
  const ctx = new Context()
  try {
    await expect(dispatchSimulation(ctx, `simulation/${method}`, { ...input, principalId: 'forged' }, call)).rejects.toMatchObject({ code: -32602 })
    await expect(dispatchSimulation(ctx, `simulation/${method}`, input, call)).rejects.toMatchObject({ data: { code: 'SIMULATION_PRODUCT_UNAVAILABLE' } })
    const server = new HarnessSdkJsonRpcServer(ctx, { request: vi.fn(), notify: vi.fn() })
    try { await expect(server.handleRequest(`simulation/${method}`, input)).rejects.toMatchObject({ data: { code: 'PRODUCT_AUTH_REQUIRED' } }) }
    finally { await server.shutdown() }
  } finally { await ctx.fiber.dispose() }
})

it('rejects original-request retry payload replacement before owner resolution', async () => {
  const ctx = new Context()
  try {
    await expect(dispatchSimulation(ctx, 'simulation/requests-retry', { runId: 'run', commandId: 'original', input: create }, call))
      .rejects.toMatchObject({ code: -32602 })
    await expect(dispatchSimulation(ctx, 'simulation/requests-list', { runId: 'run', limit: 0 }, call))
      .rejects.toMatchObject({ code: -32602 })
  } finally { await ctx.fiber.dispose() }
})

it('refuses a missing nullable cancellation fence and forged Team authority before dispatch', async () => {
  const ctx = new Context()
  const cancelTask = vi.fn()
  ctx.provide('simulationAdministration', { cancelTask } as unknown as SimulationAdministration)
  const input = { runId: 'run', commandId: 'original-cancel', operationId: 'created-task',
    expectedAttemptId: null, expectedRevision: 3, reason: 'Cancel original task' }
  const { expectedAttemptId: _fence, ...missing } = input
  try {
    for (const invalid of [missing, { ...input, actor: { kind: 'human' } }, { ...input, reason: ' ' }]) {
      await expect(dispatchSimulation(ctx, 'simulation/tasks-cancel', invalid, call)).rejects.toMatchObject({ code: -32602 })
    }
    expect(cancelTask).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})
