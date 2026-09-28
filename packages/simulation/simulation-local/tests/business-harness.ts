/** Real durable run and administrative writer fixtures for business and scheduler tests. */
import { simulationTemp } from './temp.ts'
import { rm } from 'node:fs/promises'
import { SessionId } from '@clocky/clocky-session'
import { activationIdSchema, activationReservationIdSchema, participantIdSchema, teamIdSchema } from '@clocky/clocky-team'
import {
  simulationChangeSchema, simulationDecisionIdSchema, simulationEntityIdSchema, simulationProposalSchema,
  simulationResourceSpecSchema, simulationRunSelectionSchema,
} from '@clocky/clocky-simulation'
import type { SimulationEntityId, SimulationWriterLease } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '../src/index.ts'

export async function createBusinessHarness(backend: 'json' | 'sqlite', overrides: Record<string, unknown> = {}) {
  const root = await simulationTemp('business')
  const provider = new LocalSimulationProvider({ name: 'local', root, backend, replayPageSize: 1 }, () => {})
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'business', tickUnit: 'minute', origin: '0', maxTime: '100', rulesVersion: '1', policyVersion: '1', relationRules: [],
    outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 8, maxResourceQuantity: '1000000', ...overrides,
  } })
  const run = await provider.open(selection)
  const leases: SimulationWriterLease[] = []
  const close = async () => {
    for (const lease of leases) { await lease.revoke(); await lease.release() }
    await run.close(); await provider.close(); await rm(root, { recursive: true, force: true })
  }
  const actor = async (name: string, authorize: () => Promise<void> = () => Promise.resolve()) => {
    const id = simulationEntityIdSchema.parse(name)
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    const binding = { teamId: teamIdSchema.parse('company'), participantId: participantIdSchema.parse(name), sessionId: SessionId(name) }
    await run.bindEntity(id, binding, run.snapshot().revision)
    const reservationId = activationReservationIdSchema.parse(`reservation-${name}`)
    const lease = await run.reserveWriter(id, 'local', reservationId, run.snapshot().revision)
    leases.push(lease)
    lease.bindDecisionAdmission(authorize)
    await lease.activate({ ...binding, reservationId, activationId: activationIdSchema.parse(`activation-${name}`), provider: 'local' })
    return { id, lease }
  }
  const account = async (id: string, owner: SimulationEntityId, quantity: string, controllers = [owner], kind = 'inventory', unit = 'item') => {
    await run.createResource(simulationResourceSpecSchema.parse({ id, owner, quantity, controllers, kind, unit }), run.snapshot().revision)
  }
  const submit = async (lease: SimulationWriterLease, id: string, actions: unknown[]) => {
    const decisionId = simulationDecisionIdSchema.parse(id)
    await lease.openDecision(decisionId, run.snapshot().revision)
    return await lease.submitDecision(decisionId, actions.map(action => simulationProposalSchema.parse(action)))
  }
  const apply = async (lease: SimulationWriterLease, decision: string, action: unknown) => {
    const accepted = await submit(lease, decision, [{ after: [], action }])
    const id = accepted.operationIds[0]
    if (id === undefined) throw new Error('fixture operation missing')
    return await run.executeOperation(id)
  }
  await run.setPhase('running', run.snapshot().revision)
  return { root, run, provider, selection, actor, account, submit, apply, leases, close }
}
