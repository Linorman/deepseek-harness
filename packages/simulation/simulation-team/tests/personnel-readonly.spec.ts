/** Read-only cross-owner inventory reaches actual canonical books without acquiring a Simulation connection. */
import { describe, expect, it, vi } from 'vitest'
import { personnelObligationQuerySchema, simulationChangeSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { taskExecutorFixture } from '../../simulation-product/tests/task-executor-fixture.ts'

function query(h: Awaited<ReturnType<typeof taskExecutorFixture>>) {
  const personId = simulationEntityIdSchema.parse('buyer')
  return personnelObligationQuerySchema.parse({ selector: { kind: 'person', personId,
    personRevision: h.run.snapshot().entities[personId]?.revision }, limit: 1024, maxBytes: 1048576 })
}
function selection(h: Awaited<ReturnType<typeof taskExecutorFixture>>) { return { provider: h.selection.provider, spec: h.selection.spec } }

describe.each(['json', 'sqlite'] as const)('%s detached personnel inventory', (backend) => {
  it('reads a real Native task and canonical Team creator duty without open, attach, claim or inference', async () => {
    const h = await taskExecutorFixture(backend)
    try {
      await h.start(); const operation = await h.createTask(), receipt = operation.outbox?.taskReceipt
      if (receipt === undefined) throw new Error('Actual task creation receipt is absent')
      const state = h.run.snapshot(), team = await h.ctx.teams.getTeam({ teamId: receipt.teamId })
      const open = vi.spyOn(h.ctx.simulations, 'open'), attach = vi.spyOn(h.ctx.simulationTeams, 'attach')
      const restore = vi.spyOn(h.ctx.simulationTeams, 'restore'), activate = vi.spyOn(h.ctx.teamActivations, 'activate')
      const report = await h.ctx.simulationTeams.inspectPersonnelObligations(selection(h), query(h))
      expect(report).toMatchObject({ snapshot: state, report: { complete: true, status: 'covered' } })
      expect(report?.report.items).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'team-task',
        ref: { kind: 'team-task', teamId: receipt.teamId, taskId: receipt.taskId, revision: team.tasks[0]!.revision, relation: 'creator' } })]))
      expect(JSON.stringify(report?.report)).not.toContain('Transfer one stock unit')
      expect(h.run.snapshot()).toEqual(state)
      expect(await h.ctx.teams.getTeam({ teamId: receipt.teamId })).toEqual(team)
      expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled()
      expect(activate).not.toHaveBeenCalled(); expect(h.requests).toHaveLength(0)
    } finally { vi.restoreAllMocks(); await h.close() }
  })
  it('reads the same canonical duties after the actual run and connection close without reviving ownership', async () => {
    const h = await taskExecutorFixture(backend)
    try {
      await h.connection.close(); await h.run.close()
      const state = h.run.snapshot(), selected = state.entities[simulationEntityIdSchema.parse('buyer')]
      if (selected?.binding === undefined) throw new Error('Original canonical person binding is absent')
      const team = await h.ctx.teams.getTeam({ teamId: selected.binding.teamId })
      const open = vi.spyOn(h.ctx.simulations, 'open'), attach = vi.spyOn(h.ctx.simulationTeams, 'attach')
      const restore = vi.spyOn(h.ctx.simulationTeams, 'restore')
      const result = await h.ctx.simulationTeams.inspectPersonnelObligations(selection(h), query(h))
      expect(result).toMatchObject({ snapshot: state, report: { status: 'covered', complete: true } })
      expect(await h.ctx.teams.getTeam({ teamId: selected.binding.teamId })).toEqual(team)
      expect(h.run.snapshot()).toEqual(state)
      expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled()
      expect(h.requests).toHaveLength(0)
    } finally { vi.restoreAllMocks(); await h.close() }
  })
  it('marks actual Native movement during canonical owner IO partial instead of reporting clearance', async () => {
    const h = await taskExecutorFixture(backend)
    try {
      const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams), otherId = simulationEntityIdSchema.parse('supplier')
      const source = h.run.snapshot().entities[otherId]!
      vi.spyOn(h.ctx.teams, 'getTeam').mockImplementationOnce(async (...args) => {
        const team = await getTeam(...args)
        await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: source.id, entityRevision: source.revision,
          phase: 'inactive' }), h.run.snapshot().revision)
        return team
      })
      const result = await h.ctx.simulationTeams.inspectPersonnelObligations(selection(h), query(h))
      expect(result?.report).toMatchObject({ status: 'partial', complete: false,
        coverage: { team: { kind: 'partial', reason: 'source-moved' } } })
      expect(result?.snapshot).toEqual(h.run.snapshot()); expect(h.requests).toHaveLength(0)
    } finally { vi.restoreAllMocks(); await h.close() }
  })
  it('drains an admitted cancelled read and cannot publish its late owner result', async () => {
    const h = await taskExecutorFixture(backend), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    try {
      const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams), abort = new AbortController()
      vi.spyOn(h.ctx.teams, 'getTeam').mockImplementationOnce(async (...args) => {
        const team = await getTeam(...args); entered.resolve(undefined); await release.promise; return team
      })
      const before = h.run.snapshot()
      const reading = h.ctx.simulationTeams.inspectPersonnelObligations(selection(h), query(h), abort.signal)
      const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' })
      await entered.promise; abort.abort(); release.resolve(undefined); await rejected
      expect(h.run.snapshot()).toEqual(before); expect(h.requests).toHaveLength(0)
    } finally { release.resolve(undefined); vi.restoreAllMocks(); await h.close() }
  })
  it('closes read admission and drains owner IO before service disposal completes', async () => {
    const h = await taskExecutorFixture(backend), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const service = h.ctx.simulationTeams
    let disposal: Promise<unknown> | undefined
    try {
      const getTeam = h.ctx.teams.getTeam.bind(h.ctx.teams)
      vi.spyOn(h.ctx.teams, 'getTeam').mockImplementationOnce(async (...args) => {
        const team = await getTeam(...args); entered.resolve(undefined); await release.promise; return team
      })
      const reading = service.inspectPersonnelObligations(selection(h), query(h))
      const rejected = expect(reading).rejects.toThrow(/closed/)
      await entered.promise
      let disposed = false
      disposal = h.serviceFiber.dispose().then(() => { disposed = true })
      await Promise.resolve()
      expect(() => service.inspectPersonnelObligations(selection(h), query(h))).toThrow(/closed/)
      expect(disposed).toBe(false)
      release.resolve(undefined); await rejected; await disposal
      expect(disposed).toBe(true)
      expect(h.requests).toHaveLength(0)
    } finally { release.resolve(undefined); await disposal; vi.restoreAllMocks(); await h.close() }
  })

})
