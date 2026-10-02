/** Trusted installed scenario configuration used by the real SDK product composition. */
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
const { runId: _runId, ...spec } = simulationRunSpecSchema.parse({ runId: 'template', tickUnit: 'minute', origin: '9007199254740993',
  maxTime: '1000', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10,
  maxDriveSteps: 32, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000,
  maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 2, maxTokensPerInterval: 1000000,
  tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
  maxPendingEvents: 100, maxPendingInteractions: 100, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
  maxQueuedDecisions: 100, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16,
  maxResourceQuantity: '10000', relationRules: [] })
export const templateJSON = JSON.stringify([{ id: 'company', version: '1', name: 'Company procurement',
  editableLimits: ['maxEntities', 'maxResidentActors', 'tokensPerModelRequest', 'maxTokensPerInterval', 'maxTime'],
  provider: 'local', spec, preset: 'simulation', objective: 'Deliver one inventory unit',
  driver: { version: '1', maxControlSteps: 2, model: { provider: 'company', name: 'scripted' },
    requestDelay: '5', reportDelay: '1', replyDelay: '20', completeDelay: '30' },
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } }])
