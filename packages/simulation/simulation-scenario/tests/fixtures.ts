/** Explicit installed metadata used by both portable example definitions. */
import type { ScenarioCatalog, ScenarioLimits } from '../src/index.ts'

export function catalog(): ScenarioCatalog {
  const limits: ScenarioLimits = {
    native: { maxQueuedDecisions: 100, maxDispatchWaitRounds: 8, maxTokensPerInterval: 1000000,
      tokensPerModelRequest: 10000, maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
      maxPendingEvents: 100, maxPendingInteractions: 100, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
      maxEntities: 16, maxResidentActors: 2, maxIngressBytes: 65536, maxConflictRetries: 2, decisionTimeoutMs: 60000,
      maxDecisionsPerWindow: 2, outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32,
      maxMicrostepsPerTime: 32, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128 },
    team: { maxParticipants: 16, maxActivations: 100, maxTasks: 100, maxChannels: 100,
      maxEnvelopeBytes: 65536, maxChannelViewBytes: 65536, maxPendingDeliveriesPerChannel: 100,
      maxPendingDeliveriesPerParticipant: 100, maxPendingDeliveryPageSize: 100,
      maxPostIdempotencyEntriesPerChannel: 100, maxTaskAttemptsPerTask: 3, maxTaskLeaseDurationMs: 60000,
      maxTurnsPerTeam: 1000, maxModelTokensPerTeam: 1000000, maxWallTimeMsPerTeam: 100000,
      maxCostUnitsPerTeam: 1000, maxRetriesPerTeam: 100, maxInboxItemsPerParticipant: 100, maxRatePerParticipantPerMinute: 100 },
    world: { maxRequests: 10,
      maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
      maxRequestsPerActorPerInterval: 10,
      maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 4096, maxBytesPerPlan: 4096 },
  }
  return {
    generation: 'deployment-1', policyVersion: 'world-policy-1',
    native: { tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: 'world-rules-1', budgetInterval: '100',
      maxResourceQuantity: '10000', phaseOrder: ['delivery', 'decision', 'deadline'] },
    runtimeProfiles: [{ id: 'world-agent', version: '1', available: true, roles: ['director', 'member'],
      provider: 'in-process', preset: 'simulation', capabilities: [],
      model: { provider: 'scripted', name: 'world', version: 'model-1', available: true } }],
    templates: [
      { template: { id: 'company-person', version: '1', names: ['Director', 'Recruiter', 'Observer', 'Lin'],
        skills: ['engineering'], traits: ['patient'], goals: ['build'], description: 'A colleague at Northstar Studio.' },
      defaultPersona: { name: 'Lin', skills: ['engineering'], traits: ['patient'], goals: ['build'] } },
      { template: { id: 'laboratory-person', version: '1', names: ['Coordinator', 'Research Lead', 'Observer', 'Kai'],
        skills: ['analysis'], traits: ['careful'], goals: ['research'], description: 'A colleague at Horizon Laboratory.' },
      defaultPersona: { name: 'Kai', skills: ['analysis'], traits: ['careful'], goals: ['research'] } },
    ],
    limits: { defaults: structuredClone(limits), ceilings: structuredClone(limits) },
  }
}
