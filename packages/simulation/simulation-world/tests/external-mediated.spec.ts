/** Adapter refusal paths; real Loader scenarios own adjudication, topology and cold-recovery evidence. */
import { expect, it, vi } from 'vitest'
import { SimulationWorldError, WORLD_EXTERNAL_MEDIATED_PIN, simulationWorldResolveOperationSchema,
  worldPlanIdSchema, worldRequestIdSchema, simulationOperationIdSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import type { SimulationWorldDriverAnchor } from '../src/types.ts'
import { ExternalMediatedWorldExecution } from '../src/external-mediated.ts'

function refusingAdapter(preparation: boolean, error: Error) {
  const common = { subjectRef: 'original-subject', sourceKind: 'director-mediated', policyRef: 'clocky.external.adjudication/1',
    attribution: 'scenario-generated', evidence: [], disclosure: { kind: 'requester' } }
  const outcome = preparation ? { ...common, kind: 'representative-preparation-plan', contactUnit: 'widget',
    preparation: { templateId: 'external', templateVersion: '1',
      persona: { name: 'Representative', skills: [], traits: [], goals: [] } } }
    : { ...common, kind: 'failure', code: 'unavailable', description: 'Original bounded simulated outcome' }
  const plan: SimulationWorldPlan = { id: worldPlanIdSchema.parse('original-plan'), requestId: worldRequestIdSchema.parse('original-case'),
    operationId: simulationOperationIdSchema.parse('original-operation'), pin: WORLD_EXTERNAL_MEDIATED_PIN,
    proposal: simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: 'original-case', supersedes: null,
      resolution: { kind: 'apply', payload: { kind: 'adjudicate', outcome }, rationale: 'Original private rationale' } }),
    reads: [], baseRevision: 1, sequence: 2, hash: 'original-hash', status: 'accepted' }
  const commitWorldMutation = vi.fn<SimulationRun['commitWorldMutation']>().mockRejectedValue(error)
  const reserveExternalRepresentative = vi.fn<SimulationRun['reserveExternalRepresentative']>().mockRejectedValue(error)
  // Native refuses before canonical IO; unreachable services are intentionally absent from this adapter-only unit.
  const run = { commitWorldMutation, reserveExternalRepresentative, snapshot: () => ({ world: undefined }) } as unknown as SimulationRun
  const resolved = { generatedActorRuntime: { provider: 'in-process', preset: 'simulation',
    model: { provider: 'scripted', name: 'representative', version: '1' } } } as ResolvedWorldScenario
  return { plan, commitWorldMutation, reserveExternalRepresentative,
    adapter: new ExternalMediatedWorldExecution(run, {} as SimulationTeamConnection, resolved,
      { ownerName: 'original-owner' } as SimulationWorldDriverAnchor, new AbortController().signal) }
}

it('preserves an uncommitted leaf and returns the typed complete-record byte refusal', async () => {
  const h = refusingAdapter(false, new SimulationWorldError('SIM_WORLD_LIMIT', 'Unrelated diagnostic', 'bytes'))
  await expect(h.adapter.execute(h.plan)).resolves.toBe('world-byte-limit')
  expect(h.commitWorldMutation).toHaveBeenCalledExactlyOnceWith({ planId: h.plan.id, payload: { kind: 'apply-original-adjudication' } })
  expect(h.reserveExternalRepresentative).not.toHaveBeenCalled()
})

it('returns original representative admission refusal before topology IO', async () => {
  const h = refusingAdapter(true, new SimulationWorldError('SIM_WORLD_LIMIT', 'Unrelated diagnostic', 'participants'))
  await expect(h.adapter.execute(h.plan)).resolves.toBe('identity-capacity')
  expect(h.reserveExternalRepresentative).toHaveBeenCalledTimes(1)
  expect(h.commitWorldMutation).not.toHaveBeenCalled()
})

it('propagates an unknown actual leaf execution failure without classifying it as cancellation', async () => {
  const error = new Error('Unknown retained execution outcome'), h = refusingAdapter(false, error)
  await expect(h.adapter.execute(h.plan)).rejects.toBe(error)
})
