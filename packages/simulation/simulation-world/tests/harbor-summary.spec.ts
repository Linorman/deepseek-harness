/** Business success uses exact retained receipts, independently authorized public context and no external owner. */
import { expect, it } from 'vitest'
import { SimulationWorldDomainRegistry, simulationWorldBusinessSummarySchema } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationWorldBusinessSummaryEvidence, SimulationWorldRequest, SimulationWorldResult } from '@clocky/clocky-simulation'
import { HarborNativeDomain } from '../src/harbor-domain.ts'
import { HARBOR_CONTRACTS } from '../src/harbor-protocol.ts'

function evidence(ok = true): SimulationWorldBusinessSummaryEvidence {
  const contract = HARBOR_CONTRACTS.at(-1)!
  // Pure projection fixture contains only the original fields consumed by this
  // domain. It cannot enter Native admission or create an execution lease.
  const request = { id: 'request', intentId: 'intent', sequence: 10, status: 'committed', pin: contract.pin,
    proposal: { kind: 'world/request', domain: 'harbor', operation: 'execute', version: contract.pin.version,
      businessKey: 'private-business-key', expectedTime: null, evidence: [], payload: {
        scopeEntityId: 'harbor', targetEntityId: 'harbor-environment', command: { kind: 'act',
          viewId: `view-${'0'.repeat(64)}`, rationale: 'PRIVATE_RATIONALE remains hidden in a bounded business summary.',
          actions: [{ kind: 'deliver', orderId: 'order-known' }] } } } } as unknown as SimulationWorldRequest
  const result = { id: 'result', requestId: request.id, intentId: request.intentId, sequence: 20,
    outcome: { kind: 'committed' }, payload: { ok, day: 12, command: 'act', receipt: {
      error: ok ? null : 'PRIVATE_JUDGE_ERROR', decisionId: 'decision', checkpointId: null,
      checkpointDay: null, restored: null, audit: null, report: null, wakeActors: [] } } } as unknown as SimulationWorldResult
  return { request: { id: request.id, intentId: request.intentId, pin: request.pin, sequence: request.sequence, status: request.status },
    requestBody: { status: 'allowed', proposal: request.proposal }, result, nativeRevision: 30, executionUnknown: false,
    environment: { status: 'allowed', profileRevision: 1, profile: { harbor: { revision: 7, day: 12, publishedAtNativeSequence: 30, overview: {
      actors: [{ id: 'coop', kind: 'firm' }, { id: 'new-firm', kind: 'firm' }],
      organizations: [{ founder: 'coop', members: { coop: 'founder', 'new-firm': 'member' } }],
      openOrders: 18, openLoans: 2, privateText: 'PRIVATE_ENVIRONMENT_BODY' } } } },
    targetEffects: { latestResultSequence: 20, unconfirmed: false }, technicalCounts: { roles: 14, independentSessions: 14 } }
}

it('separates Native committed from judge rejection without exposing private receipts', () => {
  const summary = new HarborNativeDomain().summary(evidence(false))
  expect(summary).toMatchObject({ submission: 'accepted', execution: 'rejected', businessOutcome: 'not-achieved' })
  expect(JSON.stringify(summary)).not.toContain('PRIVATE_')
  expect(JSON.stringify(summary)).not.toContain('private-business-key')
})

it('keeps accepted unfinished business unknown and counts business entities separately from Session roles', () => {
  const summary = new HarborNativeDomain().summary(evidence())
  expect(simulationWorldBusinessSummarySchema.parse(summary)).toMatchObject({ execution: 'accepted', businessOutcome: 'unknown',
    counts: { businessEntities: { status: 'known', value: 2 }, firms: { status: 'known', value: 2 },
      organizations: { status: 'known', value: 1 }, memberships: { status: 'known', value: 2 },
      founderRepresentedEntities: { status: 'known', value: 1 }, openOrders: { status: 'known', value: 18 },
      independentSessions: { status: 'known', value: 14 }, employmentRelationships: { status: 'not-applicable' } } })
  const limited: SimulationWorldBusinessSummaryEvidence = { ...evidence(), environment: { status: 'withheld' } }
  const { result: _limitedResult, ...pending } = limited
  expect(new HarborNativeDomain().summary(limited).counts.organizations).toEqual({ status: 'withheld' })
  expect(new HarborNativeDomain().summary(pending).businessOutcome).toBe('unknown')
  expect(new HarborNativeDomain().summary({ ...pending, executionUnknown: true }).execution).toBe('unknown')
  expect(new HarborNativeDomain().summary({ ...limited, environment: { status: 'allowed', profileRevision: 1, profile: {} } }).counts.organizations)
    .toMatchObject({ status: 'unknown' })
})

it.each(HARBOR_CONTRACTS)('uses exact v$pin.version projection and withdraws it on registration disposal', async (contract) => {
  const registry = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  const domain = new HarborNativeDomain(contract)
  const dispose = registry.register(domain.definition, domain)
  const input = evidence()
  const request = { ...input.request, pin: contract.pin }
  if (input.requestBody.status !== 'allowed') throw new Error('Fixture requires an authorized request body')
  const requestBody = { status: 'allowed' as const, proposal: { ...input.requestBody.proposal, version: contract.pin.version } }
  expect(registry.summarize(contract.pin, { ...input, request, requestBody })?.execution).toBe('accepted')
  expect(() => registry.summarize(contract.pin, { ...input, request, requestBody,
    result: { ...input.result!, requestId: 'foreign' as SimulationWorldRequest['id'] } })).toThrow(/another request/)
  await dispose()
  expect(registry.summarize(contract.pin, { ...input, request, requestBody })).toBeUndefined()
})


it('publishes safe label and judge disposition using public evidence while request prose and context stay withheld', () => {
  const original: SimulationWorldBusinessSummaryEvidence = { ...evidence(false), environment: { status: 'withheld' } }
  const input: SimulationWorldBusinessSummaryEvidence = { ...original, requestBody: { status: 'withheld' } }
  expect(JSON.stringify(input.request)).not.toContain('PRIVATE_')
  const summary = new HarborNativeDomain().summary(input)
  expect(summary).toMatchObject({ label: 'Harbor act', submission: 'accepted', execution: 'rejected', businessOutcome: 'not-achieved',
    counts: { organizations: { status: 'withheld' }, technicalRoles: { status: 'known', value: 14 } } })
  expect(JSON.stringify(summary)).not.toContain('PRIVATE_')
  const { result: _publicResult, ...withoutResult } = input
  const pending = new HarborNativeDomain().summary(withoutResult)
  expect(pending).toMatchObject({ label: 'Harbor execution', submission: 'accepted', execution: 'pending', businessOutcome: 'unknown' })
})

it('marks day-boundary and same-day counts stale when the original publication predates an accepted receipt', () => {
  const input = evidence()
  if (input.environment.status !== 'allowed') throw new Error('Fixture public environment unavailable')
  const original = input.environment.profile.harbor as Record<string, import('@clocky/clocky-simulation').SimulationWorldJsonValue>
  for (const day of [11, 12]) {
    const stale = { ...input, environment: { ...input.environment, profile: { harbor: {
      ...original, day, revision: 6, publishedAtNativeSequence: 15 } } } }
    const summary = new HarborNativeDomain().summary(stale)
    expect(summary.execution).toBe('accepted')
    expect(summary.counts.organizations).toEqual({ status: 'unknown', reason: 'stale-evidence' })
    expect(summary.counts.openOrders).toEqual({ status: 'unknown', reason: 'stale-evidence' })
    expect(summary.sources.find(source => source.kind === 'environment')).toMatchObject({
      sequence: 15, domainRevision: 6, domainTime: String(day), profileRevision: 1 })
  }
})

it('refuses legacy, future and unconfirmed publication evidence without hiding independent public outcomes', () => {
  const input = evidence()
  if (input.environment.status !== 'allowed') throw new Error('Fixture public environment unavailable')
  const original = input.environment.profile.harbor as Record<string, import('@clocky/clocky-simulation').SimulationWorldJsonValue>
  const { publishedAtNativeSequence: _absent, ...legacy } = original
  const missing = new HarborNativeDomain().summary({ ...input, environment: { ...input.environment, profile: { harbor: legacy } } })
  expect(missing.counts.businessEntities).toEqual({ status: 'unknown', reason: 'missing-evidence' })
  expect(missing.sources.some(source => source.kind === 'environment')).toBe(false)
  const future = new HarborNativeDomain().summary({ ...input, environment: { ...input.environment,
    profile: { harbor: { ...original, publishedAtNativeSequence: 40 } } } })
  expect(future.counts.businessEntities).toEqual({ status: 'unknown', reason: 'invalid-evidence' })
  const unconfirmed = new HarborNativeDomain().summary({ ...input, targetEffects: { latestResultSequence: 20, unconfirmed: true } })
  expect(unconfirmed.counts.businessEntities).toEqual({ status: 'unknown', reason: 'unconfirmed-effects' })
  expect([missing.execution, future.execution, unconfirmed.execution]).toEqual(['accepted', 'accepted', 'accepted'])
})

it('uses a current public audit without a context grant but never reuses a superseded audit as current counts', () => {
  const input = evidence()
  const audit = { kind: 'report', mechanicallyComplete: false, day: 12,
    checks: { worldIntegrity: true, horizon: false, decisionCoverage: false, checkpointCoverage: false, recoveryCheck: false },
    coverage: { decisions: 1, materialDecisions: 1, activeWeeks: 1, actors: 1, teamIdentities: 1,
      checkpoints: 0, checkpointDays: 0, maxCheckpointGap: 12 },
    balances: { cash: 100, stocks: { food: 1, water: 1, medicine: 1, fuel: 1 } },
    openOrders: [{ id: 'order-known', seller: 'coop', buyer: 'clinic', resource: 'food', quantity: 1,
      dueDay: 13, escrow: 0, breachedAt: null }], openLoans: [], unpaidCosts: [] }
  if (input.result === undefined) throw new Error('Fixture public result unavailable')
  const receipt = input.result.payload as Record<string, import('@clocky/clocky-simulation').SimulationWorldJsonValue>
  const publicReceipt = receipt.receipt as Record<string, import('@clocky/clocky-simulation').SimulationWorldJsonValue>
  const publicOnly: SimulationWorldBusinessSummaryEvidence = { ...input, requestBody: { status: 'withheld' },
    environment: { status: 'withheld' }, result: { ...input.result, payload: { ...receipt,
      command: 'audit', receipt: { ...publicReceipt, audit } } } }
  expect(new HarborNativeDomain().summary(publicOnly).counts.openOrders).toEqual({ status: 'known', value: 1 })
  const superseded = new HarborNativeDomain().summary({ ...publicOnly,
    targetEffects: { latestResultSequence: 25, unconfirmed: false } })
  expect(superseded.counts.openOrders).toEqual({ status: 'unknown', reason: 'stale-evidence' })
  expect(superseded.execution).toBe('accepted')
})
