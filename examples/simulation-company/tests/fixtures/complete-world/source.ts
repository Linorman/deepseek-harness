/** The same explicit deployment admits three portable author definitions; it does not synthesize runtime events. */
import { readFile } from 'node:fs/promises'
import { WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN, WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN,
  WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, WORLD_NORM_ENACT_PIN, WORLD_TRANSFER_PIN, WORLD_DEPART_PIN,
  WORLD_EXTERNAL_MEDIATED_PIN } from '@clocky/clocky-simulation'
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../../../../packages/simulation/simulation-scenario/tests/fixtures.ts'

// The plain browser lane replays the company definition; scenario sweeps select the others explicitly.
const scene = process.env.WORLD_SCENARIO ?? 'company'
if (scene !== 'company' && scene !== 'laboratory' && scene !== 'association') throw new Error('An explicit supported author definition is required')
export const definition = worldScenarioV1Schema.parse(JSON.parse(await readFile(
  `examples/simulation-company/scenarios/world-${scene}-v1.json`, 'utf8')))
const installed = catalog()
for (const row of installed.runtimeProfiles) row.model = { provider: 'complete-world-scripted', name: 'world', version: '1', available: true }
// These declared bounds cover the authored workload; they do not grow when a run reaches a limit.
for (const limits of [installed.limits.defaults, installed.limits.ceilings]) {
  limits.world = { ...limits.world, maxRequests: 32,
    maxBirthsPerInterval: 32, maxExternalExpansionsPerInterval: 32, maxPendingMutations: 1,
    maxRequestsPerActorPerInterval: 32, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 }
  limits.native = { ...limits.native, maxDecisionsPerInterval: 256, maxMessagesPerInterval: 256, maxMicrostepsPerTime: 128 }
  // The complete authored workflow runs well past the shared fixture's 100 s Team wall-time bound in real time.
  limits.team = { ...limits.team, maxWallTimeMsPerTeam: 7200000 }
}
const pins = [WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN, WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN,
  WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, WORLD_NORM_ENACT_PIN, WORLD_TRANSFER_PIN, WORLD_DEPART_PIN, WORLD_EXTERNAL_MEDIATED_PIN]
export const deployment = scenarioV1CatalogSchema.parse({ ...installed, domains: pins.map(pin => ({ pin, available: true })),
  factSchemas: ['clocky.world-fact/text/1'], normPolicies: ['clocky.organization.hiring-approval/1'] })
