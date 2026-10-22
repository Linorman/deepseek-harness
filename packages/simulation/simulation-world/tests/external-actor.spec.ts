/** Stable external driver stops; the actual Loader matrix owns quota admission and retained IO evidence. */
import { expect, it, vi } from 'vitest'
import { SimulationWorldError, WORLD_EXTERNAL_ACTOR_PIN, simulationWorldResolveOperationSchema,
  worldPlanIdSchema, worldRequestIdSchema, simulationOperationIdSchema,
  simulationExternalRepresentativeReservationSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan, SimulationWorldLimit } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { ExternalActorWorldExecution } from '../src/external-actor.ts'
import type { SimulationWorldDriverAnchor } from '../src/types.ts'

function fixture(reuse: boolean, error: Error) {
  const plan: SimulationWorldPlan = { id: worldPlanIdSchema.parse('original-plan'), requestId: worldRequestIdSchema.parse('original-case'),
    operationId: simulationOperationIdSchema.parse('original-operation'), pin: WORLD_EXTERNAL_ACTOR_PIN,
    proposal: simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: 'original-case', supersedes: null,
      resolution: { kind: 'apply', payload: reuse ? { kind: 'reuse', identityId: 'original-identity', generation: 1 }
        : { templateId: 'external', templateVersion: '1', persona: { name: 'Representative', skills: [], traits: [], goals: [] } },
      rationale: 'Original private rationale' } }), reads: [], baseRevision: 1, sequence: 2, hash: 'original-hash', status: 'accepted' }
  const reserveExternalContact = vi.fn<SimulationRun['reserveExternalContact']>().mockRejectedValue(error)
  const reserveExternalRepresentative = vi.fn<SimulationRun['reserveExternalRepresentative']>().mockRejectedValue(error)
  // Both mocked Native methods refuse before canonical IO; the omitted services are deliberately unreachable in this unit.
  const run = { reserveExternalContact, reserveExternalRepresentative, snapshot: () => ({ world: undefined }) } as unknown as SimulationRun
  const connection = {} as SimulationTeamConnection, anchor = { ownerName: 'original-owner' } as SimulationWorldDriverAnchor
  const resolved = { generatedActorRuntime: { provider: 'in-process', preset: 'simulation',
    model: { provider: 'scripted', name: 'representative', version: '1' } } } as ResolvedWorldScenario
  return { plan, reserveExternalContact, reserveExternalRepresentative,
    adapter: new ExternalActorWorldExecution(run, connection, resolved, anchor, new AbortController().signal) }
}

const limits: readonly [SimulationWorldLimit, string][] = [
  ['position', 'position-capacity'], ['entities', 'entity-capacity'], ['participants', 'identity-capacity'],
  ['channels', 'channel-capacity'], ['bytes', 'world-byte-limit'], ['requests', 'world-request-limit'],
  ['commands', 'world-command-limit'], ['plans', 'plan-budget'],
  ['births', 'world-birth-limit'], ['expansions', 'world-expansion-limit'], ['mutations', 'world-mutation-limit'],
]

it('finds a retained representative before maintenance starts and holds it through unfinished maintenance', () => {
  const h = fixture(false, new Error('No Native write is reachable from pure responsibility inspection'))
  const reservation = simulationExternalRepresentativeReservationSchema.parse({ id: 'original-intent', identityId: 'original-identity',
    generation: 1, requestId: h.plan.requestId, request: { planId: h.plan.id,
      maintenance: { id: 'original-maintenance', owner: 'original-owner' },
      member: { displayName: 'Representative', role: 'member', capabilities: [], provider: 'in-process',
        preset: 'simulation', model: 'scripted/representative', modelVersion: '1' } },
    identities: { entityId: 'original-person', relationId: 'original-represents',
      binding: { teamId: 'original-team', participantId: 'original-participant', sessionId: 'original-session' },
      channels: [{ purpose: 'director', key: 'original-director', channelId: 'original-director-channel' },
        { purpose: 'requester', key: 'original-requester', channelId: 'original-requester-channel' }] },
    status: 'reserved', reservedAt: '0', sequence: 3, updatedSequence: 3 })
  // This unit inspects only retained responsibility metadata; the Loader fault matrix owns actual identity and maintenance IO.
  let current = reservation
  let maintenance: Record<string, {
    request: typeof reservation.request.maintenance
    status: 'quiescent'
    startedSequence: number
    quiescentSequence: number
  }> = {}
  const run = { snapshot: () => ({ world: { external: { representatives: { [current.id]: current }, contacts: {} } },
    maintenance }) } as unknown as SimulationRun
  const adapter = new ExternalActorWorldExecution(run, {} as SimulationTeamConnection, {} as ResolvedWorldScenario,
    {} as SimulationWorldDriverAnchor, new AbortController().signal)
  expect(adapter.reconciliationPlans()).toEqual([h.plan.id])
  expect(adapter.retainsResponsibility(h.plan)).toBe(true)
  current = { ...current, status: 'committed', prepared: { time: reservation.reservedAt, sequence: 4 }, updatedSequence: 4 }
  expect(adapter.reconciliationPlans()).toEqual([])
  expect(adapter.retainsResponsibility(h.plan)).toBe(false)
  maintenance = { [current.request.maintenance.id]: { request: current.request.maintenance,
    status: 'quiescent', startedSequence: 2, quiescentSequence: 3 } }
  expect(adapter.reconciliationPlans()).toEqual([h.plan.id])
  expect(adapter.retainsResponsibility(h.plan)).toBe(true)
})
for (const reuse of [false, true]) {
  it.each(limits)(`returns the typed %s stop before IO for ${reuse ? 'shared contact' : 'representative creation'}`, async (limit, reason) => {
    const h = fixture(reuse, new SimulationWorldError('SIM_WORLD_LIMIT', 'Unrelated trusted diagnostic', limit))
    await expect(h.adapter.execute(h.plan)).resolves.toBe(reason)
    expect(reuse ? h.reserveExternalContact : h.reserveExternalRepresentative).toHaveBeenCalledTimes(1)
    expect(reuse ? h.reserveExternalRepresentative : h.reserveExternalContact).not.toHaveBeenCalled()
  })
  it(`returns authority-missing and propagates unknown failures for ${reuse ? 'shared contact' : 'representative creation'}`, async () => {
    const h = fixture(reuse, new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Permission withdrawn'))
    await expect(h.adapter.execute(h.plan)).resolves.toBe('authority-missing')
    const unknown = new Error('Unknown canonical outcome'), unresolved = fixture(reuse, unknown)
    await expect(unresolved.adapter.execute(unresolved.plan)).rejects.toBe(unknown)
  })
}
