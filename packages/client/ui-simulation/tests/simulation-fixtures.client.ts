/** Complete public DTO fixtures keep component tests aligned with the current wire contracts. */
import type { SimulationProductControl, SimulationProductRunInspection, SimulationRuntimeState } from '@clocky/clocky-client-runtime/client'

type Attribution = NonNullable<NonNullable<SimulationProductRunInspection['world']>['metrics']>['tokenAttribution']

/** A fresh reconciled empty ledger does not infer usage from unrelated budget charges. */
export function emptyTokenAttribution(): Attribution {
  const bucket = (): Attribution['total'] => ({ attempts: 0,
    statuses: { reserved: 0, unknown: 0, settled: 0, 'not-dispatched': 0 }, outstandingReservedTokens: 0,
    settled: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    unknownReported: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })
  return { total: bucket(), categories: { 'business-choice': bucket(), adjudication: bucket(), 'result-closeout': bucket(),
    communication: bucket(), compaction: bucket(), unknown: bucket() } }
}

/** Complete safe control; a test overrides only the facts relevant to its visible behavior. */
export function simulationControlFixture(overrides: Partial<SimulationProductControl> = {}): SimulationProductControl {
  return { runId: 'run' as never, owner: 'held', phase: 'paused', driver: 'idle', inFlight: false, observedAt: 1,
    budget: { model: { provider: 'fixture', name: 'scripted' }, tokensPerRequest: 1000, tokensPerInterval: 10000,
      interval: '100' as never, residentActors: 2, sharedModelLimit: 4 },
    actions: { start: { allowed: true, reason: 'ready' }, pause: { allowed: true, reason: 'ready' } },
    administration: { actions: { checkpoint: { allowed: false, reason: 'recovery-required' },
      restore: { allowed: false, reason: 'recovery-required' }, prepare: { allowed: false, reason: 'recovery-required' },
      ingress: { allowed: false, reason: 'recovery-required' } }, ingress: { maxTime: '100' as never, maxBytes: 1000, targets: [] } },
    ...overrides }
}

/** Fresh unloaded public read slots with no retained run invalidations. */
export function simulationRuntimeFixture(overrides: Partial<SimulationRuntimeState> = {}): SimulationRuntimeState {
  const empty = { loading: false, stale: false }
  return { connected: true, generation: 1, authorizationVersion: 1, invalidatedRuns: {},
    worldPreflight: empty, worldCases: empty, worldCase: empty, worldExport: empty, unknownOperations: empty,
    statuses: empty, reviews: empty, catalog: empty, preflight: empty, tasks: empty, persistentRequests: empty,
    control: empty, directory: empty, run: empty, collection: empty, recovery: empty, object: empty,
    records: empty, record: empty, source: empty, observation: empty, ...overrides }
}
