/** Public failure references survive cold original queries without disclosing provider text or resuming execution. */
import { afterEach, expect, it, vi } from 'vitest'
import { ownerFixture } from './company-owner-fixture.ts'
import { call } from './fixtures.ts'
import { simulationProductManageInputSchema } from '../src/control-schema.ts'
import { simulationProductCheckpointInputSchema } from '../src/maintenance-schema.ts'
import { simulationProductRequestReceiptSchema } from '../src/administration-schema.ts'
import { accepted } from './creation-fixture.ts'
import { foldCreationEntry } from '../src/creation-book.ts'

afterEach(() => { vi.restoreAllMocks() })

it.each(['json', 'sqlite'] as const)('retains the exact failed Session source across %s product journal reload', async (backend) => {
  const h = await ownerFixture(backend)
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    await service.manage(simulationProductManageInputSchema.parse({ runId, managementId: 'diagnostic-start', phase: 'running' }), call())
    await vi.waitFor(async () => { expect((await service.control({ runId }, call())).driver).toBe('completed') }, { timeout: 5000 })
    const before = h.owned().snapshot()
    const binding = before.entities['buyer' as never]?.binding
    if (binding === undefined) throw new Error('Company buyer has no canonical Session')
    const requests = h.requests.length
    const reference = h.ctx.sessionPersistence.getPersistenceReference.bind(h.ctx.sessionPersistence)
    let failedRead = false
    const fault = vi.spyOn(h.ctx.sessionPersistence, 'getPersistenceReference').mockImplementation(async (...args) => {
      if (!failedRead && args[0] === binding.sessionId) {
        failedRead = true
        throw new Error('Private provider secret /private/checkpoint-owner-key')
      }
      return await reference(...args)
    })
    const input = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'diagnostic-checkpoint' })
    await service.checkpoint(input, call())
    const failed = await h.finished(input.commandId)
    fault.mockRestore()
    expect(failedRead).toBe(true)
    const diagnostic = { stage: 'collect', code: 'source-unavailable', subject: { kind: 'session', ...binding } }
    expect(failed).toMatchObject({ status: 'failed', failure: 'checkpoint-failed', diagnostic })
    if (failed.checkpointId === undefined) throw new Error('Failed checkpoint receipt has no original checkpoint')
    const detail = await h.ctx.simulationProducts.inspectObject({ runId, collection: 'checkpoints', id: failed.checkpointId,
      section: 'references', limit: 1 }, call())
    expect(detail).toMatchObject({ status: 'found', value: { diagnostic, failure: 'details-withheld' } })
    expect(JSON.stringify({ failed, detail })).not.toContain('/private/checkpoint-owner-key')
    expect(h.owned().snapshot().latestCheckpointId).toBe(before.latestCheckpointId)
    expect(h.requests).toHaveLength(requests)
    await h.fiber.dispose(); await h.mount()
    const open = vi.spyOn(h.ctx.simulations, 'open')
    const opensBeforeQuery = open.mock.calls.length
    const found = await h.ctx.simulationAdministration.request({ commandId: input.commandId }, call())
    expect(found).toEqual({ status: 'found', request: failed })
    expect(open.mock.calls).toHaveLength(opensBeforeQuery)
    expect(h.requests).toHaveLength(requests)
  } finally { await h.close() }
})

it('rejects private diagnosis fields and diagnoses attached to another original command family', () => {
  const initial = accepted()
  const state = foldCreationEntry({ commands: new Map(), creations: new Map() }, initial)
  const diagnostic = { stage: 'collect', code: 'unavailable', subject: { kind: 'run' } }
  expect(() => foldCreationEntry(state, { kind: 'command/failed', commandId: 'create', failure: 'preparation-required', diagnostic }))
    .toThrow('Only failed checkpoint or restore')
  expect(state.commands.get('create')?.receipt.status).toBe('accepted')
  expect(simulationProductRequestReceiptSchema.safeParse({ commandId: 'cut', runId: 'run', kind: 'checkpoint', acceptedAt: 1,
    status: 'failed', checkpointId: 'checkpoint', failure: 'checkpoint-failed', diagnostic: { ...diagnostic, message: 'private secret' } }).success)
    .toBe(false)
})
