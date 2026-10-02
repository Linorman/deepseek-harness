/** Checkpoint publication drains genuine link/delivery responsibility instead of omitting a held executor operation. */
import { afterEach, expect, it, vi } from 'vitest'
import { ownerFixture } from './company-owner-fixture.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { call } from './fixtures.ts'

afterEach(() => { vi.restoreAllMocks() })
const driver = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1',
  topology: { actors: [{ id: 'auditor', name: 'Independent auditor' }], channels: [{ key: 'audit', members: [
    { entityId: 'buyer', role: 'author' }, { entityId: 'auditor', role: 'receiver' },
  ] }] }, steps: [{ id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'auditor', channelKey: 'audit',
    subject: 'Checkpoint report', description: 'Publish exactly one report', text: 'Report', cognition: 'deterministic',
    leaseDurationMs: 60000, maxAttempts: 3, retry: 'before-effects' }] } })

it.each(['json', 'sqlite'].flatMap(backend => ['link', 'delivery'].map(stage => ({ backend, stage }))))
('includes held $backend $stage execution responsibility in a complete checkpoint after draining', async ({ backend, stage }) => {
  const h = await ownerFixture(backend as 'json' | 'sqlite', {}, driver, { maxTokensPerInterval: 0 })
  const release = Promise.withResolvers<undefined>(), held = Promise.withResolvers<undefined>()
  let interrupted = false
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    if (stage === 'link') {
      const reserve = h.owned().reserveTaskExecution.bind(h.owned())
      vi.spyOn(h.owned(), 'reserveTaskExecution').mockImplementationOnce(async (...args) => {
        const result = await reserve(...args); held.resolve(undefined); await release.promise; return result
      })
    } else {
      const attach = h.ctx.simulationTeams.attach.bind(h.ctx.simulationTeams)
      vi.spyOn(h.ctx.simulationTeams, 'attach').mockImplementation(async (...args) => {
        const connection = await attach(...args), receive = connection.receiveOperation.bind(connection)
        vi.spyOn(connection, 'receiveOperation').mockImplementation(async (id) => {
          const result = await receive(id)
          if (!interrupted && h.owned().snapshot().operations[id]?.action.kind === 'communication/post') {
            interrupted = true; held.resolve(undefined); await release.promise
          }
          return result
        })
        return connection
      })
    }
    await service.manage({ runId, managementId: `start-${stage}` as never, phase: 'running' }, call())
    await held.promise
    const before = h.owned().snapshot(), original = before.latestCheckpointId
    const request = { runId, commandId: `concurrent-cut-${stage}` as never }
    const accepted = await service.checkpoint(request, call())
    await vi.waitFor(() => { expect(h.owned().snapshot().phase).toBe('paused') })
    expect((await service.request({ commandId: request.commandId }, call())).status).toBe('found')
    expect(h.owned().snapshot().latestCheckpointId).toBe(original)
    expect(h.owned().snapshot().checkpoints?.[accepted.checkpointId!]?.status).not.toBe('completed')
    release.resolve(undefined)
    expect((await h.finished(request.commandId)).status).toBe('completed')
    const state = h.owned().snapshot(), checkpoint = state.checkpoints?.[accepted.checkpointId!]
    if (checkpoint?.status !== 'completed') throw new Error('Complete cross-owner checkpoint was not published')
    expect(checkpoint.manifest.channels).toHaveLength(2); expect(checkpoint.manifest.sessions).toHaveLength(3)
    const execution = Object.values(state.taskExecutions ?? {})[0]
    expect(execution?.retired).toBeDefined()
    const reports = Object.values(state.operations).filter(value => value.action.kind === 'communication/post')
    expect(reports).toHaveLength(stage === 'link' ? 0 : 1)
    if (stage === 'delivery') expect(reports[0]?.delivery?.receipt).toBeDefined()
    expect(state.resources['stock' as never]?.quantity).toBe('2'); expect(h.requests).toEqual([])
    const restore = { runId, commandId: `restore-${stage}` as never, checkpointId: checkpoint.request.id }
    await service.restore(restore, call()); expect((await h.finished(restore.commandId)).status).toBe('completed')
    await service.manage({ runId, managementId: `resume-${stage}` as never, phase: 'running' }, call())
    await vi.waitFor(async () => { expect((await service.control({ runId }, call())).stop).toBe('completed') }, { timeout: 5000 })
    expect(Object.values(h.owned().snapshot().operations).filter(value => value.action.kind === 'communication/post')).toHaveLength(1)
    expect(h.requests).toEqual([])
  } finally { release.resolve(undefined); await h.close() }
}, 15000)
