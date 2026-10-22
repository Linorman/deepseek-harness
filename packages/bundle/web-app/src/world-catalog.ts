/** Bounded installed World metadata shipped with the Web bundle, independent of test fixtures. */
import { WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN, WORLD_GOVERNANCE_PROPOSE_PIN,
  WORLD_GOVERNANCE_VOTE_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN,
  WORLD_TRANSFER_PIN, WORLD_DEPART_PIN, WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_ACTOR_PIN,
  WORLD_EXTERNAL_MEDIATED_PIN } from '@clocky/clocky-simulation'
import { scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import type { ScenarioV1Catalog, ScenarioLimits } from '@clocky/clocky-simulation-scenario'

/**
 * Resolve the versioned Web installation; actual model settings are resolved by administration at preflight.
 * @returns a new strict catalog with finite Native, Team and World defaults and ceilings, without IO.
 */
export function webWorldCatalog(): ScenarioV1Catalog {
  const limits: ScenarioLimits = {
    native: { maxEntities: 32, maxResidentActors: 3, tokensPerModelRequest: 65536, maxTokensPerInterval: 1048576,
      maxDecisionsPerInterval: 128, maxMessagesPerInterval: 128, maxQueuedDecisions: 64, maxDispatchWaitRounds: 8,
      maxPendingEvents: 128, maxPendingInteractions: 64, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
      maxIngressBytes: 65536, maxConflictRetries: 2, decisionTimeoutMs: 60000, maxDecisionsPerWindow: 2,
      maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, outboxMaxAttempts: 3,
      outboxRetryDelayMs: 1000, maxDriveSteps: 32, maxMicrostepsPerTime: 128 },
    team: { maxParticipants: 32, maxActivations: 256, maxTasks: 128, maxChannels: 128,
      maxEnvelopeBytes: 65536, maxChannelViewBytes: 65536, maxPendingDeliveriesPerChannel: 128,
      maxPendingDeliveriesPerParticipant: 128, maxPendingDeliveryPageSize: 64,
      maxPostIdempotencyEntriesPerChannel: 256, maxTaskAttemptsPerTask: 3, maxTaskLeaseDurationMs: 60000,
      maxTurnsPerTeam: 1024, maxModelTokensPerTeam: 2000000, maxWallTimeMsPerTeam: 3600000,
      maxCostUnitsPerTeam: 1000, maxRetriesPerTeam: 128, maxInboxItemsPerParticipant: 128,
      maxRatePerParticipantPerMinute: 128 },
    world: { maxRequests: 32, maxBirthsPerInterval: 8, maxExternalExpansionsPerInterval: 8, maxPendingMutations: 1,
      maxRequestsPerActorPerInterval: 8, maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3,
      maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 },
  }
  const pins = [WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN, WORLD_GOVERNANCE_PROPOSE_PIN,
    WORLD_GOVERNANCE_VOTE_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN,
    WORLD_TRANSFER_PIN, WORLD_DEPART_PIN, WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_ACTOR_PIN, WORLD_EXTERNAL_MEDIATED_PIN]
  return scenarioV1CatalogSchema.parse({
    generation: 'web-world/2', policyVersion: 'web-world-policy/1', modelProtocol: 'bounded-v1',
    native: { tickUnit: 'minute', origin: '0', maxTime: '360', rulesVersion: 'web-world-rules/1',
      budgetInterval: '60', maxResourceQuantity: '100000000', phaseOrder: ['delivery', 'decision', 'deadline'] },
    runtimeProfiles: [{ id: 'world-agent', version: '1', available: true, roles: ['director', 'member'],
      provider: 'in-process', preset: 'simulation-world', capabilities: [],
      model: { provider: 'unconfigured', name: 'unconfigured', version: 'agent-default/1', available: false } }],
    templates: [
      { template: { id: 'company-person', version: '1', names: ['Director', 'Recruiter', 'Observer', 'Lin'],
        skills: ['engineering'], traits: ['patient'], goals: ['build'], description: 'A colleague building a small software studio.' },
      defaultPersona: { name: 'Lin', skills: ['engineering'], traits: ['patient'], goals: ['build'] } },
      { template: { id: 'laboratory-person', version: '1', names: ['Coordinator', 'Research Lead', 'Observer', 'Kai'],
        skills: ['analysis'], traits: ['careful'], goals: ['research'], description: 'A colleague in an independent research laboratory.' },
      defaultPersona: { name: 'Kai', skills: ['analysis'], traits: ['careful'], goals: ['research'] } },
      { template: { id: 'association-person', version: '1', names: ['Coordinator', 'Organiser', 'Reviewer', 'Sam'],
        skills: ['organising'], traits: ['considerate'], goals: ['community'], description: 'A volunteer in a neighbourhood reading association.' },
      defaultPersona: { name: 'Sam', skills: ['organising'], traits: ['considerate'], goals: ['community'] } },
    ],
    domains: pins.map(pin => ({ pin, available: true })),
    factSchemas: ['clocky.world-fact/text/1'], normPolicies: ['clocky.organization.hiring-approval/1'],
    limits: { defaults: structuredClone(limits), ceilings: structuredClone(limits) },
  })
}
