/** Native retry hints are narrowed by the current Product owner, capacity, and accepted work. */
import { afterEach, expect, it, vi } from 'vitest'
import { ownerFixture } from './company-owner-fixture.ts'
import { call } from './fixtures.ts'
import { SimulationCompanyOwner } from '../src/company-owner.ts'
import { SimulationProductError } from '../src/index.ts'
import { simulationProductOperationRetryInputSchema } from '../src/operation-retry-schema.ts'

afterEach(() => { vi.restoreAllMocks() })

async function unknown(h: Awaited<ReturnType<typeof ownerFixture>>) {
  const runId = await h.create()
  const post = h.ctx.teams.postChannelEnvelope.bind(h.ctx.teams)
  let losses = h.owned().snapshot().spec.outboxMaxAttempts
  const lost = vi.spyOn(h.ctx.teams, 'postChannelEnvelope').mockImplementation(async (...args) => {
    const value = await post(...args)
    if (losses-- > 0) throw new Error('Canonical post response lost after acceptance')
    return value
  })
  await h.ctx.simulationAdministration.manage({ runId, managementId: 'retry-hint-start' as never, phase: 'running' }, call())
  const operation = await vi.waitFor(() => {
    const value = Object.values(h.owned().snapshot().operations).find(item => item.status === 'outcome-unknown')
    if (value === undefined) throw new Error('Original operation has not reached an unknown outcome')
    return value
  }, { timeout: 5000, interval: 5 })
  await vi.waitFor(async () => { expect((await h.ctx.simulationAdministration.control({ runId }, call())).inFlight).toBe(false) })
  lost.mockRestore()
  return { runId, operation }
}

it('withdraws a real retry hint when retained command capacity is occupied', async () => {
  const h = await ownerFixture('json', { maxCommands: 1 })
  try {
    const { runId, operation } = await unknown(h)
    const detail = await h.ctx.simulationProducts.inspectObject({ runId, collection: 'operations',
      id: operation.id, section: 'execution' }, call())
    expect(detail.value).toMatchObject({ retry: { allowed: false, reason: 'capacity-unavailable' } })
  } finally { await h.close() }
})

it('withdraws a real retry hint while an accepted checkpoint holds the run and after owner retirement', async () => {
  const h = await ownerFixture()
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  try {
    const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
    let connection: Awaited<ReturnType<typeof attach>> | undefined
    vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementation(async (...args) => {
      connection = await attach(...args); return connection
    })
    const { runId, operation } = await unknown(h)
    if (connection === undefined) throw new Error('Original run has no canonical Team connection')
    const checkpoint = connection.checkpoint.bind(connection)
    vi.spyOn(connection, 'checkpoint').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined); await release.promise; return checkpoint(...args)
    })
    const commandId = 'retry-hint-checkpoint' as never
    await h.ctx.simulationAdministration.checkpoint({ runId, commandId }, call())
    await entered.promise
    const during = await h.ctx.simulationProducts.inspectObject({ runId, collection: 'operations',
      id: operation.id, section: 'execution' }, call())
    expect(during.value).toMatchObject({ retry: { allowed: false, reason: 'request-in-progress' } })
    release.resolve(undefined)
    await h.finished(commandId)
    await h.fiber.dispose(); await h.mount()
    const cold = await h.ctx.simulationProducts.inspectObject({ runId, collection: 'operations',
      id: operation.id, section: 'execution' }, call())
    expect(cold.value).toMatchObject({ retry: { allowed: false, reason: 'recovery-required' } })
  } finally { release.resolve(undefined); await h.close() }
})

it('rejects a retry hint when the held owner observes a newer native attempt count', async () => {
  const h = await ownerFixture()
  try {
    const { runId, operation } = await unknown(h)
    // oxlint-disable-next-line typescript/unbound-method -- The probe calls the original with the current owner receiver.
    const read = SimulationCompanyOwner.prototype.retryCapability
    const changed = vi.spyOn(SimulationCompanyOwner.prototype, 'retryCapability').mockImplementation(function (this: SimulationCompanyOwner, operationId) {
      const current = read.call(this, operationId)
      return { ...current, expectedAttemptCount: current.expectedAttemptCount + 1 }
    })
    const detail = await h.ctx.simulationProducts.inspectObject({ runId, collection: 'operations',
      id: operation.id, section: 'execution' }, call())
    expect(detail.value).toMatchObject({ retry: { allowed: false, reason: 'request-in-progress' } })
    expect(changed).toHaveBeenCalledWith(operation.id)
  } finally { await h.close() }
})

it('records a definitive owner admission refusal as a terminal original retry failure', async () => {
  const h = await ownerFixture()
  try {
    const { runId, operation } = await unknown(h)
    const input = simulationProductOperationRetryInputSchema.parse({ runId, commandId: 'definitive-retry-denial',
      operationId: operation.id, expectedAttemptCount: operation.outbox!.attempts.length,
      reason: 'Confirm the canonical retry target' })
    vi.spyOn(SimulationCompanyOwner.prototype, 'retryOperation').mockRejectedValueOnce(
      new SimulationProductError('The native target changed', 'SIMULATION_PRODUCT_INVALID'))
    expect((await h.ctx.simulationAdministration.retryOperation(input, call())).status).toBe('accepted')
    expect(await h.finished(input.commandId)).toMatchObject({ status: 'failed', failure: 'retry-operation-failed' })
    expect(await h.ctx.simulationAdministration.request({ commandId: input.commandId }, call()))
      .toMatchObject({ status: 'found', request: { status: 'failed' }, retryOperation: input })
  } finally { await h.close() }
})

it('retires an accepted retry before its owner authority check without granting another attempt', async () => {
  const h = await ownerFixture()
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  try {
    const { runId, operation } = await unknown(h)
    const input = simulationProductOperationRetryInputSchema.parse({ runId, commandId: 'retiring-operation-retry',
      operationId: operation.id, expectedAttemptCount: operation.outbox!.attempts.length,
      reason: 'Stop before retry authority is checked' })
    vi.spyOn(SimulationCompanyOwner.prototype, 'retryOperation').mockImplementationOnce(async (_request, _acceptedAt, authorize) => {
      entered.resolve(undefined); await release.promise; authorize()
    })
    expect((await h.ctx.simulationAdministration.retryOperation(input, call())).status).toBe('accepted')
    await entered.promise
    const retiring = h.fiber.dispose()
    release.resolve(undefined)
    await retiring; await h.mount()
    expect(await h.ctx.simulationAdministration.request({ commandId: input.commandId }, call()))
      .toMatchObject({ status: 'found', request: { status: 'failed', failure: 'retry-operation-failed' } })
  } finally { release.resolve(undefined); await h.close() }
})
