/** Real cancellation closes native task admission before draining an assigned or actively computing actor. */
import { afterEach, expect, it, vi } from 'vitest'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { SimulationWriterLease } from '@clocky/clocky-simulation'
import { ownerFixture } from './company-owner-fixture.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { call } from './fixtures.ts'

afterEach(() => { vi.restoreAllMocks() })
const driver = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1',
  topology: { actors: [{ id: 'auditor', name: 'Independent auditor' }], channels: [{ key: 'audit', members: [
    { entityId: 'buyer', role: 'author' }, { entityId: 'auditor', role: 'receiver' },
  ] }] }, steps: [{ id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'auditor', channelKey: 'audit',
    reviewerEntityId: 'auditor', subject: 'Cancelable report', description: 'Publish the installed report', text: 'Report',
    cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 3, retry: 'before-effects' }] } })

it.each(['json', 'sqlite'].flatMap(backend => ['pending', 'assigned', 'running', 'submitted'].map(stage => ({ backend, stage }))))
('cancels genuine $backend $stage task work without waiting for held computation before recording intent', async ({ backend, stage }) => {
  const h = await ownerFixture(backend as 'json' | 'sqlite', {}, driver, { maxTokensPerInterval: 0 })
  const release = Promise.withResolvers<undefined>(), held = Promise.withResolvers<undefined>()
  let connection: SimulationTeamConnection | undefined, writer: SimulationWriterLease | undefined
  const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
  vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementation(async (...args) => {
    connection = await attach(...args)
    return connection
  })
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    if (stage === 'submitted') {
      const nativeStop = h.ctx.teamActivations.stopOwnedActivation.bind(h.ctx.teamActivations)
      vi.spyOn(h.ctx.teamActivations, 'stopOwnedActivation').mockImplementation(async (request) => {
        if (Object.values(h.owned().snapshot().taskCancellations ?? {}).length > 0) await release.promise
        await nativeStop(request)
      })
    }
    const reserve = h.owned().reserveTaskExecution.bind(h.owned())
    if (stage === 'pending') vi.spyOn(h.owned(), 'reserveTaskExecution').mockImplementationOnce(async (...args) => {
      const result = await reserve(...args); held.resolve(undefined); await release.promise; return result
    })
    const confirm = h.owned().reserveWriter.bind(h.owned())
    vi.spyOn(h.owned(), 'reserveWriter').mockImplementation(async (...args) => {
      const lease = await confirm(...args)
      if (lease.entityId === 'buyer') {
        writer = lease
        if (stage === 'running') {
          const record = lease.recordDeterministicResult.bind(lease)
          vi.spyOn(lease, 'recordDeterministicResult').mockImplementation(async (id, proposals) => {
            const result = await record(id, proposals)
            if (h.owned().snapshot().taskDecisionOwners?.[id] !== undefined) { held.resolve(undefined); await release.promise }
            return result
          })
        }
        if (stage === 'submitted') {
          const submit = lease.submitDecision.bind(lease)
          vi.spyOn(lease, 'submitDecision').mockImplementation(async (...input) => {
            const result = await submit(...input)
            if (h.owned().snapshot().taskDecisionOwners?.[input[0]] !== undefined) { held.resolve(undefined); await release.promise }
            return result
          })
        }
      }
      return lease
    })
    if (stage === 'assigned') vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementation(async (...args) => {
      const attached = await attach(...args); connection = attached
      const decision = attached.executeTaskDecision.bind(attached)
      vi.spyOn(attached, 'executeTaskDecision').mockImplementationOnce(async (...input) => {
        held.resolve(undefined); await release.promise; return await decision(...input)
      })
      return attached
    })
    await service.manage({ runId, managementId: `start-cancel-${stage}` as never, phase: 'running' }, call())
    await held.promise
    const state = h.owned().snapshot(), execution = Object.values(state.taskExecutions ?? {})[0]
    if (execution === undefined || connection === undefined) throw new Error('Cancellation fixture has no actual task owner')
    const task = await h.ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
    expect(task.phase).toBe(stage === 'submitted' ? 'running' : stage)
    const selection = { operationId: execution.request.operationId, expectedRevision: task.revision,
      expectedAttemptId: task.lease?.attemptId ?? null, reason: 'Stop the exact report before publication' }
    const stopped = connection.cancelTask(selection, () => {})
    await vi.waitFor(() => { expect(h.owned().snapshot().taskCancellations?.[selection.operationId]).toBeDefined() })
    const persisted = h.owned().snapshot()
    const decision = execution.decisions?.[0]
    if (stage === 'submitted') {
      expect(persisted.decisions[decision!.request.decisionId]?.status).toBe('submitted')
      const revision = persisted.revision
      await expect(h.owned().commitWindow(persisted.activeWindowId!)).rejects.toThrow()
      expect(h.owned().snapshot().revision).toBe(revision)
    }
    if (decision !== undefined && writer !== undefined) {
      await expect(writer.submitDecision(decision.request.decisionId, [{ after: [], action: { kind: 'communication/post',
        recipient: 'auditor' as never, channelId: persisted.channelReservations!['audit' as never]!.channelId,
        text: 'Forbidden late report', deliverAt: persisted.time } }])).rejects.toThrow()
    }
    release.resolve(undefined)
    const result = await stopped
    expect(result.phase).toBe('cancelled')
    expect(result.cancellation?.reason).toBe(selection.reason)
    expect(result.lease).toBeUndefined()
    expect(result.attemptCount).toBe(stage === 'pending' ? 0 : 1)
    await vi.waitFor(async () => { expect((await service.control({ runId }, call())).stop).toBe('scenario-blocked') })
    expect(Object.values(h.owned().snapshot().operations).filter(value => value.action.kind === 'communication/post')).toHaveLength(0)
    expect(h.requests).toEqual([])
    const cut = { runId, commandId: `cancel-cut-${stage}` as never }
    await service.checkpoint(cut, call()); expect((await h.finished(cut.commandId)).status).toBe('completed')
    const snapshot = h.owned().snapshot()
    expect(snapshot.taskCancellations?.[selection.operationId]?.request.cancellation).toEqual(result.cancellation)
    expect(snapshot.resources['stock' as never]?.quantity).toBe('2')
    expect(snapshot.resources['received' as never]?.quantity).toBe('0')
  } finally { release.resolve(undefined); await h.close() }
}, 15000)

it.each(['json', 'sqlite'] as const)('fences a genuinely prepared model task before tokens or effects while physical cleanup is held (%s)', async (backend) => {
  const modelDriver = simulationCompanyDriverSchema.parse({ ...companyConfig,
    tasks: { version: '1', cognition: 'model', leaseDurationMs: 60000, maxAttempts: 2, retry: 'before-effects' } })
  const h = await ownerFixture(backend, {}, modelDriver)
  const held = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const cleanup = Promise.withResolvers<undefined>(), cleanupEntered = Promise.withResolvers<undefined>()
  let connection: SimulationTeamConnection | undefined, writer: SimulationWriterLease | undefined
  let input: Parameters<SimulationWriterLease['reserveModelTokens']> | undefined
  let reserve: SimulationWriterLease['reserveModelTokens'] | undefined
  const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
  vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementation(async (...args) => {
    connection = await attach(...args); return connection
  })
  const nativeStop = h.ctx.teamActivations.stopOwnedActivation.bind(h.ctx.teamActivations)
  vi.spyOn(h.ctx.teamActivations, 'stopOwnedActivation').mockImplementation(async (request) => {
    if (Object.values(h.owned().snapshot().taskCancellations ?? {}).length > 0) {
      cleanupEntered.resolve(undefined); await cleanup.promise
    }
    await nativeStop(request)
  })
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const nativeWriter = h.owned().reserveWriter.bind(h.owned())
    vi.spyOn(h.owned(), 'reserveWriter').mockImplementation(async (...args) => {
      const lease = await nativeWriter(...args), tokens = lease.reserveModelTokens.bind(lease)
      vi.spyOn(lease, 'reserveModelTokens').mockImplementation(async (...request) => {
        if (h.owned().snapshot().taskDecisionOwners?.[request[0]] !== undefined) {
          writer = lease; input = request; reserve = tokens; held.resolve(undefined); await release.promise
        }
        return await tokens(...request)
      })
      return lease
    })
    await service.manage({ runId, managementId: 'start-model-task-cancel' as never, phase: 'running' }, call())
    await held.promise
    if (connection === undefined || writer === undefined || input === undefined || reserve === undefined) {
      throw new Error('Actual task inference did not reach token admission')
    }
    const before = h.owned().snapshot(), execution = Object.values(before.taskExecutions ?? {})[0]!
    const task = await h.ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
    const selection = { operationId: execution.request.operationId, expectedRevision: task.revision,
      expectedAttemptId: task.lease!.attemptId, reason: 'Stop before actual task model token dispatch' }
    const stopped = connection.cancelTask(selection)
    await cleanupEntered.promise
    const fenced = h.owned().snapshot(), decision = fenced.decisions[input[0]]!
    expect(decision.status).toBe('open'); expect(decision.context?.status).toBe('prepared'); expect(decision.inference).toBeDefined()
    expect(fenced.entities[writer.entityId]?.writer?.phase).toBe('active')
    const revision = fenced.revision, reservationCount = Object.keys(fenced.tokenReservations ?? {}).length, calls = h.requests.length
    await expect(reserve(...input)).rejects.toThrow('no longer owns its live attempt')
    await expect(writer.reserveCompactionTokens({ compactionId: 'cancelled-task-compaction' as never,
      sessionSequence: input[1].sessionSequence, provider: input[1].provider, model: input[1].model }))
      .rejects.toThrow('no longer owns its live attempt')
    expect(h.owned().snapshot().revision).toBe(revision)
    expect(Object.keys(h.owned().snapshot().tokenReservations ?? {})).toHaveLength(reservationCount)
    const cut = { runId, commandId: 'model-task-cancel-cut' as never }
    await service.checkpoint(cut, call())
    expect((await service.request({ commandId: cut.commandId }, call())).status).toBe('found')
    expect(h.owned().snapshot().checkpoints?.[`product-checkpoint/${cut.commandId}` as never]?.status).not.toBe('completed')
    release.resolve(undefined); cleanup.resolve(undefined)
    expect((await stopped).phase).toBe('cancelled')
    expect((await h.finished(cut.commandId)).status).toBe('completed')
    expect(h.requests).toHaveLength(calls)
    const after = h.owned().snapshot()
    expect(after.resources['stock' as never]?.quantity).toBe('2'); expect(after.resources['received' as never]?.quantity).toBe('0')
    expect(after.taskExecutions?.[execution.request.attemptId]?.retired).toBeDefined()
  } finally { release.resolve(undefined); cleanup.resolve(undefined); await h.close() }
}, 15000)
