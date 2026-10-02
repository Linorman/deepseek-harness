/** Journal versions order metadata only; incomparable terminal receipts need explicit verification. */
import { expect, it } from 'vitest'
import { observeRequest } from '../src/client/simulations/request-presentation.ts'
import type { SimulationCommandState } from '../src/client/simulations/administration.ts'
import type { SimulationProductRequestsPage } from '../src/client/simulations/service.ts'
const receipt = { runId: 'run' as never, commandId: 'command' as never, kind: 'create' as const, acceptedAt: 1, status: 'accepted' as const }
const original: SimulationCommandState = { command: { kind: 'retry-request', input: receipt }, pending: false, unknown: false, notFound: false }
const page: SimulationProductRequestsPage = { runId: receipt.runId, snapshotRevision: 2, total: 1, items: [receipt] }
it.each([
  ['accepted', 'completed', 'receipt-older'], ['completed', 'accepted', 'metadata-older'],
  ['completed', 'failed', 'conflict'], ['failed', 'completed', 'conflict'], ['completed', 'completed', 'consistent'],
] as const)('compares local %s with journal %s as %s', (local, persisted, comparison) => {
  const result = observeRequest({ ...original, receipt: { kind: 'request', value: { ...receipt, status: local } } },
    { loading: false, stale: false, value: { ...page, items: [{ ...receipt, status: persisted }] } })
  expect(result?.comparison).toBe(comparison)
})
it('does not match another run, infer absence from another page, or retain metadata after denial', () => {
  const requestObservation = observeRequest(original, { loading: false, stale: false, value: page })!
  expect(requestObservation.comparison).toBe('metadata-only')
  const retained = { ...original, requestObservation }
  expect(observeRequest(retained, { loading: false, stale: true, error: 'network' })).toMatchObject({ ...requestObservation, stale: true })
  expect(observeRequest(retained, { loading: false, stale: false, error: 'forbidden' })).toBeUndefined()
  expect(observeRequest(original, { loading: false, stale: false, value: { ...page, items: [{ ...receipt, runId: 'other' as never }] } })).toBeUndefined()
})
