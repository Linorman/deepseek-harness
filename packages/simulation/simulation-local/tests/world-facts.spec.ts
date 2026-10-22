/** Real Native backends pin immutable fact history; full Loader/tool consumption has a separate runnable scenario. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionId } from '@clocky/clocky-session/types'
import { participantIdSchema, teamRootCreateInputSchema } from '@clocky/clocky-team/schema'
import {
  SimulationWorldDomainRegistry, WORLD_GENERATE_AND_HIRE_PIN, WORLD_FACT_TEXT_SCHEMA_REF, simulationRunSelectionSchema,
  simulationChangeSchema, simulationEntityIdSchema, simulationWorldDefinitionSchema, simulationWorldFactRequestSchema,
  simulationWorldFactQuerySchema, worldFactVersionSchema, simTimeSchema,
  simulationWorldFactAdjudicatedRequestSchema, WORLD_FACT_EXTERNAL_ADJUDICATED_SCHEMA_REF,
} from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationWorldFactRequest } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '../src/index.ts'
import { OrganizationNativeWorldDomain } from '../src/world-organization.ts'

async function harness(backend: 'json' | 'sqlite', bytes = 1500) {
  const temp = join(process.cwd(), '.local/world-completion/tmp')
  await mkdir(temp, { recursive: true })
  const root = await mkdtemp(join(temp, 'native-facts-'))
  const domains = new SimulationWorldDomainRegistry<NativeWorldDomain>(), organization = new OrganizationNativeWorldDomain()
  const unregister = domains.register(organization.definition, organization)
  const provider = new LocalSimulationProvider({ name: 'facts', root, backend, replayPageSize: 1 }, () => {}, domains)
  const selection = simulationRunSelectionSchema.parse({ provider: 'facts', mode: 'create', spec: {
    runId: 'facts-native', tickUnit: 'minute', origin: '0', maxTime: '100', rulesVersion: '1', policyVersion: '1',
    outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
    phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536,
    maxEntities: 16, maxResidentActors: 2, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100',
    maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100, maxPendingEvents: 100, maxPendingInteractions: 100,
    maxKnowledgeBytes: bytes, maxKnowledgePerQuery: 4, maxQueuedDecisions: 100, maxDispatchWaitRounds: 8,
    maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '10000', relationRules: [],
  } })
  const run = await provider.open(selection)
  await run.reserveTeam(teamRootCreateInputSchema.parse({ goal: { objective: 'Retain authoritative facts', budgets: {} }, budgets: {},
    rules: { simulationRunId: selection.spec.runId, activationLifecycleOwner: 'facts-owner' } }), run.snapshot().revision)
  const teamId = run.snapshot().teamReservation!.teamId
  await run.confirmTeam(teamId, run.snapshot().revision)
  for (const [id, entityKind, cognition] of [['director', 'person', 'agent'], ['organization', 'organization', 'none'],
    ['position', 'position', 'none']]) {
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind, cognition, readiness: 'ready', profile: {} }),
      run.snapshot().revision)
  }
  const director = simulationEntityIdSchema.parse('director')
  await run.bindEntity(director, { teamId, participantId: participantIdSchema.parse('director'),
    sessionId: SessionId('87797687-8653-4a13-9495-a59940f40c3b') }, run.snapshot().revision)
  await run.configureWorld(simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], directorEntityId: director, organizationEntityId: 'organization',
    operations: [WORLD_GENERATE_AND_HIRE_PIN], operationGrants: [], positions: [{ entityId: 'position', capacity: 1 }], authorizations: [],
    templates: [{ id: 'person', version: '1', names: ['Lin'], skills: [], traits: [], goals: [], description: 'Person' }], policyVersion: '1',
    limits: { maxRequests: 10,
      maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
      maxRequestsPerActorPerInterval: 10, maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 4096,
      maxBytesPerPlan: 4096 } }), run.snapshot().revision)
  const input = (id = 'fact', body = 'Published'): SimulationWorldFactRequest => simulationWorldFactRequestSchema.parse({
    factId: id, version: '1', schemaRef: WORLD_FACT_TEXT_SCHEMA_REF, subject: 'organization', scope: 'organization',
    payload: { body }, effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' }, supersedes: null,
    sources: [{ kind: 'run-event', runId: selection.spec.runId, sequence: run.snapshot().world!.sequence }],
  })
  const query = () => simulationWorldFactQuerySchema.parse({ viewer: director, cursor: run.snapshot().revision,
    time: run.snapshot().time, limit: 4 })
  return { run, provider, selection, input, query,
    close: async () => { await provider.close(); await unregister(); await rm(root, { recursive: true, force: true }) } }
}

describe.each(['json', 'sqlite'] as const)('%s authoritative fact append/replay', (backend) => {
  it('bounds all history together across small IDs and versions without losing the last committed prefix', async () => {
    const h = await harness(backend, 1500)
    try {
      const firstInput = h.input('history', '世界'.repeat(20))
      const first = await h.run.recordWorldFact(firstInput)
      const second = await h.run.recordWorldFact({ ...firstInput, version: worldFactVersionSchema.parse('2'),
        supersedes: { factId: first.factId, version: first.version }, payload: { body: 'Second small complete version.' } })
      const thirdInput = h.input('independent', 'Another small complete publication.')
      let retained = 2
      try { await h.run.recordWorldFact(thirdInput); retained++ }
      catch (error) { expect(error).toMatchObject({ code: 'SIM_WORLD_FACT_LIMIT' }) }
      let rejected = false
      for (let index = 0; index < 10; index++) {
        const before = h.run.snapshot()
        try { await h.run.recordWorldFact(h.input(`small-${index}`, 'Small.')); retained++ }
        catch (error) {
          expect(error).toMatchObject({ code: 'SIM_WORLD_FACT_LIMIT' })
          expect(h.run.snapshot()).toEqual(before)
          rejected = true
          break
        }
      }
      expect(rejected).toBe(true)
      const before = h.run.snapshot()
      expect(Object.values(before.world!.facts).flat()).toHaveLength(retained)
      expect(Buffer.byteLength(JSON.stringify(before.world!.facts), 'utf8')).toBeLessThanOrEqual(1500)
      await expect(h.run.recordWorldFact({ ...firstInput, version: worldFactVersionSchema.parse('3'),
        supersedes: { factId: second.factId, version: second.version }, payload: { body: '世界'.repeat(1000) } }))
        .rejects.toMatchObject({ code: 'SIM_WORLD_FACT_LIMIT' })
      expect(h.run.snapshot()).toEqual(before)
      await h.run.close()
      const inspected = await h.provider.inspect({ provider: 'facts', spec: h.selection.spec, includeRecords: true })
      expect(inspected?.snapshot.world!.facts).toEqual(before.world!.facts)
      expect(inspected?.records?.filter(entry => (entry.value as { kind: string }).kind === 'run/world-facts')).toHaveLength(retained)
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      expect(reopened.snapshot().world!.facts).toEqual(before.world!.facts)
      expect(await reopened.recordWorldFact(firstInput)).toEqual(first)
      expect(reopened.snapshot().revision).toBe(before.revision)
      await reopened.close()
    } finally { await h.close() }
  })

  it('rejects nonadjacent replacements, changed subjects, unknown audiences and future causal sources before append', async () => {
    const h = await harness(backend)
    try {
      const input = h.input(), first = await h.run.recordWorldFact(input), before = h.run.snapshot()
      for (const changed of [
        { ...input, version: worldFactVersionSchema.parse('3'), supersedes: { factId: first.factId, version: first.version } },
        { ...input, version: worldFactVersionSchema.parse('2'), supersedes: null },
        { ...input, version: worldFactVersionSchema.parse('2'), supersedes: { factId: first.factId, version: first.version },
          subject: simulationEntityIdSchema.parse('position') },
        { ...input, factId: h.input('audience').factId, audience: { kind: 'actors' as const,
          entityIds: [simulationEntityIdSchema.parse('absent')] } },
        { ...input, factId: h.input('future-source').factId, sources: [{ kind: 'run-event' as const,
          runId: h.selection.spec.runId, sequence: before.revision + 1 }] },
      ]) await expect(h.run.recordWorldFact(changed)).rejects.toBeInstanceOf(Error)
      expect(h.run.snapshot()).toEqual(before)
      const query = h.query()
      expect(() => h.run.queryWorldFacts({ ...query, cursor: before.revision + 1 })).toThrow()
      expect(() => h.run.queryWorldFacts({ ...query, time: simTimeSchema.parse('1') })).toThrow()
      expect(() => h.run.queryWorldFacts({ ...query, limit: 5 })).toThrow()
    } finally { await h.close() }
  })

  it('rejects forged external origins through the actual publisher without appending or rewriting any Native responsibility', async () => {
    const h = await harness(backend, 20000)
    try {
      const original = await h.run.recordWorldFact(h.input('original', 'Keep original text.'))
      const before = h.run.snapshot()
      const input = simulationWorldFactAdjudicatedRequestSchema.parse({ ...h.input('forged-external'),
        schemaRef: WORLD_FACT_EXTERNAL_ADJUDICATED_SCHEMA_REF, payload: {
          claim: { kind: 'condition', predicate: 'weather', schemaRef: 'weather/1', value: { status: 'rain' } }, asOf: '0',
          provenance: { kind: 'external-adjudication', identityId: 'absent-identity', intentId: 'absent-intent',
            requestId: 'absent-request', planId: 'absent-plan', adjudicationSequence: before.revision,
            policyFingerprint: `sha256:${'a'.repeat(64)}` },
        } })
      await expect(h.run.recordWorldFact(input)).rejects.toMatchObject({ code: 'SIM_WORLD_FACT_SOURCE' })
      await expect(h.run.recordWorldFact(simulationWorldFactAdjudicatedRequestSchema.parse({ ...input,
        payload: { ...input.payload, provenance: { ...input.payload.provenance,
          event: { eventId: 'absent-event', consumedSequence: before.revision } } } })))
        .rejects.toMatchObject({ code: 'SIM_WORLD_FACT_SOURCE' })
      expect(h.run.snapshot()).toEqual(before)
      await h.run.close()
      const inspected = await h.provider.inspect({ provider: 'facts', spec: h.selection.spec, includeRecords: true })
      expect(inspected?.snapshot).toEqual(before)
      expect(inspected?.records?.filter(entry => (entry.value as { kind: string }).kind === 'run/world-facts')).toHaveLength(1)
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      expect(reopened.snapshot().world!.facts[original.factId]).toEqual([original])
      await expect(reopened.recordWorldFact(input)).rejects.toMatchObject({ code: 'SIM_WORLD_FACT_SOURCE' })
      expect(reopened.snapshot()).toEqual(before)
      await reopened.close()
    } finally { await h.close() }
  })

})
