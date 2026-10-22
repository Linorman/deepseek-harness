/** Native admission rejects before IO; each execution adapter must preserve its exact typed quota. */
import { expect, it, vi } from 'vitest'
import { SimulationWorldError, WORLD_GENERATE_AND_HIRE_PIN, WORLD_TRANSFER_PIN, WORLD_DEPART_PIN,
  worldPlanIdSchema, worldRequestIdSchema, simulationOperationIdSchema, simulationWorldResolveOperationSchema,
  simulationWorldSubmissionFailureSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan, SimulationWorldLimit } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { OrganizationWorldExecution } from '../src/organization.ts'
import { PersonnelWorldExecution } from '../src/personnel.ts'
import type { SimulationWorldDriverAnchor } from '../src/types.ts'

const limits: readonly [SimulationWorldLimit, string][] = [
  ['position', 'position-capacity'], ['entities', 'entity-capacity'], ['participants', 'identity-capacity'],
  ['channels', 'channel-capacity'], ['bytes', 'world-byte-limit'], ['requests', 'world-request-limit'],
  ['commands', 'world-command-limit'], ['plans', 'plan-budget'],
  ['births', 'world-birth-limit'], ['expansions', 'world-expansion-limit'], ['mutations', 'world-mutation-limit'],
]

for (const operation of ['hire', 'transfer', 'depart'] as const) {
  it.each(limits)(`${operation} preserves %s admission failure before any topology IO`, async (limit, reason) => {
    const refusal = new SimulationWorldError('SIM_WORLD_LIMIT', 'Diagnostic text cannot determine classification', limit)
    const reserveWorldHire = vi.fn<SimulationRun['reserveWorldHire']>().mockRejectedValue(refusal)
    const reservePersonnel = vi.fn<SimulationRun['reservePersonnel']>().mockRejectedValue(refusal)
    // Only Native admission executes; connection methods cannot be reached after the typed rejection.
    const run = { reserveWorldHire, reservePersonnel, snapshot: () => ({ world: undefined }) } as unknown as SimulationRun
    const connection = {} as SimulationTeamConnection
    const anchor = { ownerName: 'owner' } as SimulationWorldDriverAnchor
    const pin = operation === 'hire' ? WORLD_GENERATE_AND_HIRE_PIN : operation === 'transfer' ? WORLD_TRANSFER_PIN : WORLD_DEPART_PIN
    const plan: SimulationWorldPlan = { id: worldPlanIdSchema.parse('plan'), requestId: worldRequestIdSchema.parse('request'),
      operationId: simulationOperationIdSchema.parse('operation'), pin,
      proposal: simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: 'request', supersedes: null,
        resolution: { kind: 'apply', payload: { templateId: 'person', templateVersion: '1',
          persona: { name: 'Person', skills: [], traits: [], goals: [] } }, rationale: 'Original' } }),
      reads: [], baseRevision: 1, sequence: 2, hash: 'hash', status: 'accepted' }
    const resolved = { generatedActorRuntime: { provider: 'in-process', preset: 'simulation',
      model: { provider: 'scripted', name: 'person', version: '1' } } } as ResolvedWorldScenario
    const adapter = operation === 'hire'
      ? new OrganizationWorldExecution(run, connection, resolved, anchor, new AbortController().signal)
      : new PersonnelWorldExecution(run, connection, anchor, new AbortController().signal, operation)
    await expect(adapter.execute(plan)).resolves.toBe(reason)
    expect(operation === 'hire' ? reserveWorldHire : reservePersonnel).toHaveBeenCalledTimes(1)
  })
}

it.each(['births', 'expansions', 'mutations'])('does not broaden decision submission failures with structural %s quota', (limit) => {
  expect(simulationWorldSubmissionFailureSchema.safeParse({ code: 'SIM_WORLD_LIMIT', limit }).success).toBe(false)
})
