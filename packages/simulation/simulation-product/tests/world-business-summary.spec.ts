/** Actual Native requests and authenticated Product readers share one pure summary and policy lifetime. */
import { expect, it, vi } from 'vitest'
import { SimulationWorldDomainRegistry } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationWorldBusinessSummaryEvidence } from '@clocky/clocky-simulation'
import { OrganizationNativeWorldDomain } from '../../simulation-local/src/world-organization.ts'
import { hiringResourceHarness } from '../../simulation-local/tests/hiring-resource-harness.ts'
import Products from '../src/index.ts'
import { simulationProductWorldCaseInspectionSchema } from '../src/case-schema.ts'
import { simulationProductWorldDomainResultSchema } from '../src/world-read-schema.ts'
import { registration, call } from './fixtures.ts'

class SummaryDomain extends OrganizationNativeWorldDomain {
  readonly summary = (input: SimulationWorldBusinessSummaryEvidence) => {
    const unknown = { status: 'unknown' as const }
    return { version: 1 as const, label: input.requestBody.status === 'allowed' ? 'Authorized hiring submission' : 'Public hiring submission', submission: 'accepted' as const,
      execution: 'pending' as const, businessOutcome: 'unknown' as const, nativeRevision: input.nativeRevision,
      counts: { businessEntities: unknown, firms: unknown, alliances: unknown, organizations: unknown, memberships: unknown,
        founderRepresentedEntities: unknown, employedPeople: unknown, employmentRelationships: unknown,
        technicalRoles: { status: 'known' as const, value: input.technicalCounts.roles },
        independentSessions: { status: 'known' as const, value: input.technicalCounts.independentSessions },
        openOrders: unknown, openLoans: unknown },
      sources: [{ kind: 'request' as const, sequence: input.request.sequence }] }
  }
}

it.each(['json', 'sqlite'] as const)('shares %s list/detail/export mappings without acquiring execution and revokes summary grants', async (backend) => {
  const h = await hiringResourceHarness(backend, 'generate-and-hire')
  try {
    const planned = await h.plan('summary-original')
    await h.plan('summary-second')
    const before = h.run.snapshot(), requestId = planned.requestId
    const catalog = new SimulationWorldDomainRegistry<NativeWorldDomain>()
    const domain = new SummaryDomain()
    const dispose = catalog.register(domain.definition, domain)
    const projection = vi.spyOn(domain, 'summary')
    const providerRead = vi.spyOn(h.ctx.simulations, 'domains').mockReturnValue(catalog)
    const acquire = vi.spyOn(catalog, 'acquire')
    const registered = { ...registration('summary-product'), spec: h.selection.spec }
    await h.ctx.plugin(Products, { directoryStream: 'summary-directory', imports: [registered] })
    const products = h.ctx.simulationProducts, principal = call()
    const input = { runId: registered.id, requestId, section: 'request' } as const
    expect((await products.inspectWorldCase(input, principal)).value?.summary.businessSummary)
      .toMatchObject({ status: 'allowed', value: { label: 'Public hiring submission' } })
    expect(projection.mock.calls.at(-1)?.[0].requestBody).toEqual({ status: 'withheld' })
    expect(projection.mock.calls.at(-1)?.[0].request).not.toHaveProperty('proposal')
    const personaOnly = products.caseReaderRegistrar()([{ principalId: principal.principal.id, runId: registered.id,
      requestIds: [requestId], content: ['persona'] }])
    expect((await products.inspectWorldCase(input, principal)).value?.summary.businessSummary)
      .toMatchObject({ status: 'allowed', value: { label: 'Public hiring submission' } })
    expect(projection.mock.calls.at(-1)?.[0].requestBody).toEqual({ status: 'withheld' })
    expect(projection.mock.calls.at(-1)?.[0].request).not.toHaveProperty('proposal')
    personaOnly()
    const grant = () => products.caseReaderRegistrar()([{ principalId: principal.principal.id, runId: registered.id,
      requestIds: [requestId], content: ['case'] }])
    let revoke = grant()
    const list = await products.listWorldCases({ runId: registered.id }, principal)
    const detail = await products.inspectWorldCase(input, principal)
    const exported = await products.readWorldDomain({ runId: registered.id, kind: 'case-extensions', requestIds: [requestId] }, principal)
    if (exported.kind !== 'case-extensions' || exported.value === undefined) throw new Error('Original case export missing')
    expect(list.items[0]?.businessSummary).toEqual(detail.value?.summary.businessSummary)
    expect(exported.value[0]?.businessSummary).toEqual(detail.value?.summary.businessSummary)
    const publishedSummary = exported.value[0]?.businessSummary
    if (publishedSummary?.status !== 'allowed') throw new Error('Public summary missing')
    expect(simulationProductWorldDomainResultSchema.safeParse({ ...exported, value: exported.value.map(item => ({ ...item,
      businessSummary: { status: 'allowed', value: { ...publishedSummary.value, nativeRevision: before.revision + 1 } },
    })) }).success).toBe(false)
    expect(detail.value?.summary.businessSummary).toMatchObject({ status: 'allowed', value: { execution: 'pending', businessOutcome: 'unknown' } })
    await expect(products.inspectWorldCase(input, call(new AbortController(), 'foreign'))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    const parse = simulationProductWorldCaseInspectionSchema.parse.bind(simulationProductWorldCaseInspectionSchema)
    const publication = vi.spyOn(simulationProductWorldCaseInspectionSchema, 'parse').mockImplementationOnce((...args) => {
      const result = parse(...args)
      queueMicrotask(revoke)
      return result
    })
    expect((await products.inspectWorldCase(input, principal)).value?.summary.businessSummary)
      .toMatchObject({ status: 'allowed', value: { label: 'Public hiring submission' } })
    publication.mockRestore()
    revoke = grant()
    const page = await products.listWorldCases({ runId: registered.id, limit: 1 }, principal)
    expect(page.nextCursor).toBeDefined()
    await dispose()
    await expect(products.listWorldCases({ runId: registered.id, limit: 1, cursor: page.nextCursor }, principal))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    expect((await products.inspectWorldCase(input, principal)).value?.summary.businessSummary).toEqual({ status: 'unsupported' })
    revoke()
    expect(acquire).not.toHaveBeenCalled()
    expect(h.run.snapshot()).toEqual(before)
    expect(h.requests).toHaveLength(0)
    providerRead.mockRestore()
  } finally { await h.close() }
})
