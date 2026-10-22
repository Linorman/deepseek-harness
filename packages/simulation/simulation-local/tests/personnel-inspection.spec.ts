/** Provider inventory observes actual durable personnel references without opening an owner or trusting absent Team sources. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import Simulations, { personnelObligationQuerySchema, simulationChangeSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { LocalSimulationProvider } from '../src/index.ts'

it.each(['json', 'sqlite'] as const)('inspects actual %s obligations through the provider seam while owned and cold without creating history', async (backend) => {
  const h = await createBusinessHarness(backend), ctx = new Context()
  const reader = new LocalSimulationProvider({ name: 'readonly', root: h.root, backend, replayPageSize: 2 }, () => {})
  try {
    const personId = simulationEntityIdSchema.parse('duty-owner')
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: personId, entityKind: 'person',
      cognition: 'none', readiness: 'ready', profile: { private: 'PERSONNEL-BODY-CANARY' } }), h.run.snapshot().revision)
    await h.account('owned-resource', personId, '1')
    await h.account('second-owned-resource', personId, '1')
    const state = h.run.snapshot(), query = personnelObligationQuerySchema.parse({ selector: { kind: 'person', personId,
      personRevision: state.entities[personId]?.revision }, limit: 1024, maxBytes: 1048576 })
    await ctx.plugin(Simulations); const remove = ctx.simulations.registerProvider(reader)
    const open = vi.spyOn(reader, 'open'), selection = { provider: 'readonly', spec: h.selection.spec }
    const actual = await ctx.simulations.inspectPersonnelObligations(selection, query)
    expect(actual?.snapshot).toEqual(state)
    expect(actual?.report).toMatchObject({ complete: false, status: 'native-only', coverage: { team: { kind: 'required' } } })
    expect(actual?.report.items).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'resource-control',
      ref: { kind: 'resource', id: 'owned-resource', revision: 1, relation: 'owner' } })]))
    const bounded = await ctx.simulations.inspectPersonnelObligations(selection, { ...query, limit: 1 })
    expect(bounded?.report).toMatchObject({ complete: false, status: 'overflow', items: [], overflow: { reason: 'item-limit' } })
    expect(JSON.stringify(actual?.report)).not.toContain('PERSONNEL-BODY-CANARY')
    await h.run.close()
    expect(await ctx.simulations.inspectPersonnelObligations(selection, query)).toEqual(actual)
    await expect(ctx.simulations.inspectPersonnelObligations(selection,
      { ...query, selector: { ...query.selector, personRevision: query.selector.personRevision + 1 } }))
      .rejects.toMatchObject({ code: 'SIM_PERSONNEL_STALE' })
    expect(await ctx.simulations.inspectPersonnelObligations({ ...selection,
      spec: { ...selection.spec, runId: 'absent-personnel-history' as never } }, query)).toBeUndefined()
    expect(open).not.toHaveBeenCalled()
    remove(); await reader.close()
    await expect(reader.inspectPersonnelObligations(selection, query)).rejects.toThrow(/closed/)
  } finally { vi.restoreAllMocks(); await ctx.fiber.dispose(); await reader.close(); await h.close() }
})
