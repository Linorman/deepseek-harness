/** Public World readers preserve owner identities while retaining their exact JSON string encodings. */
import { expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type { SimulationEntityId, SimulationRelationId, SimulationDecisionId, SimulationOperationId,
  SimulationCheckpointId } from '@clocky/clocky-simulation/identities'
import type { WorldProposalId, WorldExternalIdentityId, WorldNormId, WorldFactId } from '@clocky/clocky-simulation/world-domain-types'
import type { WorldRequestId } from '@clocky/clocky-simulation/world-types'
import type { TeamId, ParticipantId, ChannelId, EnvelopeId, TeamTaskId } from '@clocky/clocky-team/types'
import type { SessionId } from '@clocky/clocky-session/types'
import type { SimulationProductReadVersion } from '../src/watch-types.ts'
import type { SimulationProductWorldDomainInput, SimulationProductWorldDomainResult, EngineRef, PersonRow,
  PersonDetailView, OrganizationView, ProposalDetailView, GovernanceView, NormVersionView, ExternalIdentityDetail,
  Tenure, OrgNode, OrgEdge, ProposalSummary, ExternalIdentityRow,
  WorldCaseExtension, KnownFact } from '../src/world-read-types.ts'
import * as schemas from '../src/world-read-schema.ts'

type Input = SimulationProductWorldDomainInput
type Result = SimulationProductWorldDomainResult

it('retains Native/Team/Session brands in both parsed public selectors and exported view models', () => {
  expectTypeOf<Extract<Input, { kind: 'person' }>['personId']>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<Extract<Input, { kind: 'proposal' }>['proposalId']>().toEqualTypeOf<WorldProposalId>()
  expectTypeOf<Extract<Input, { kind: 'identity' }>['key']>().toEqualTypeOf<WorldExternalIdentityId>()
  expectTypeOf<Extract<Input, { kind: 'case-extensions' }>['requestIds'][number]>().toEqualTypeOf<WorldRequestId>()
  expectTypeOf<NonNullable<Input['readVersion']>>().toEqualTypeOf<SimulationProductReadVersion>()
  expectTypeOf<Result['readVersion']>().toEqualTypeOf<SimulationProductReadVersion>()
  expectTypeOf<NonNullable<Extract<Result, { kind: 'person' }>['value']>>().toExtend<PersonDetailView>()
  expectTypeOf<NonNullable<Extract<Result, { kind: 'organization' }>['value']>>().toExtend<OrganizationView>()
  expectTypeOf<NonNullable<Extract<Result, { kind: 'proposal' }>['value']>>().toExtend<ProposalDetailView>()
  expectTypeOf<NonNullable<Extract<Result, { kind: 'governance' }>['value']>>().toExtend<GovernanceView>()
  expectTypeOf<NonNullable<Extract<Result, { kind: 'norm' }>['value']>>().toExtend<NormVersionView>()
  expectTypeOf<NonNullable<Extract<Result, { kind: 'identity' }>['value']>>().toExtend<ExternalIdentityDetail>()

  expectTypeOf<NonNullable<Extract<Result, { kind: 'external' }>['value']>['identities'][number]>().toExtend<ExternalIdentityRow>()
  expectTypeOf<NonNullable<Extract<Result, { kind: 'case-extensions' }>['value']>[number]>().toExtend<WorldCaseExtension>()
  expectTypeOf<z.output<typeof schemas.worldEngineRefSchema>>().toExtend<EngineRef>()

  expectTypeOf<PersonRow['id']>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<NonNullable<PersonRow['unitId']>>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<PersonDetailView['personId']>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<NonNullable<PersonDetailView['participantId']>>().toEqualTypeOf<ParticipantId>()
  expectTypeOf<NonNullable<PersonDetailView['sessionId']>>().toEqualTypeOf<SessionId>()
  expectTypeOf<Tenure['id']>().toEqualTypeOf<SimulationRelationId>()
  expectTypeOf<Tenure['personId']>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<Tenure['positionId']>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<OrgNode['id']>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<NonNullable<OrgNode['parentId']>>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<OrgEdge['id']>().toEqualTypeOf<SimulationRelationId>()
  expectTypeOf<OrgEdge['from']>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<OrgEdge['to']>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<ProposalSummary['id']>().toEqualTypeOf<WorldProposalId>()
  expectTypeOf<ExternalIdentityRow['key']>().toEqualTypeOf<WorldExternalIdentityId>()
  expectTypeOf<WorldCaseExtension['requestId']>().toEqualTypeOf<WorldRequestId>()
  expectTypeOf<KnownFact['key']>().toEqualTypeOf<WorldFactId>()
  expectTypeOf<z.output<typeof schemas.worldReadFactIdSchema>>().toEqualTypeOf<WorldFactId>()
  expectTypeOf<Extract<EngineRef, { kind: 'entity' }>['id']>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<Extract<EngineRef, { kind: 'decision' }>['id']>().toEqualTypeOf<SimulationDecisionId>()
  expectTypeOf<Extract<EngineRef, { kind: 'operation' }>['id']>().toEqualTypeOf<SimulationOperationId>()
  expectTypeOf<Extract<EngineRef, { kind: 'checkpoint' }>['id']>().toEqualTypeOf<SimulationCheckpointId>()
  expectTypeOf<Extract<EngineRef, { kind: 'team-task' }>['id']>().toEqualTypeOf<TeamTaskId>()
  expectTypeOf<Extract<EngineRef, { kind: 'team-task' }>['teamId']>().toEqualTypeOf<TeamId>()
  expectTypeOf<Extract<EngineRef, { kind: 'envelope' }>['id']>().toEqualTypeOf<EnvelopeId>()
  expectTypeOf<Extract<EngineRef, { kind: 'envelope' }>['envelopeId']>().toEqualTypeOf<EnvelopeId>()
  expectTypeOf<Extract<EngineRef, { kind: 'envelope' }>['channelId']>().toEqualTypeOf<ChannelId>()
  expectTypeOf<z.output<typeof schemas.worldReadEntityIdSchema>>().toEqualTypeOf<SimulationEntityId>()
  expectTypeOf<z.output<typeof schemas.worldReadNormIdSchema>>().toEqualTypeOf<WorldNormId>()
  expectTypeOf<SimulationEntityId>().not.toExtend<SimulationOperationId>()
  expectTypeOf<WorldRequestId>().not.toExtend<WorldProposalId>()
})

it('brands opaque boundary values without changing their JSON values or accepting empty identities', () => {
  for (const parser of [schemas.worldReadEntityIdSchema, schemas.worldReadRelationIdSchema, schemas.worldReadDecisionIdSchema,
    schemas.worldReadOperationIdSchema, schemas.worldReadCheckpointIdSchema, schemas.worldReadTeamIdSchema,
    schemas.worldReadParticipantIdSchema, schemas.worldReadChannelIdSchema, schemas.worldReadEnvelopeIdSchema,
    schemas.worldReadTaskIdSchema, schemas.worldReadSessionIdSchema, schemas.worldReadProposalIdSchema,
    schemas.worldReadExternalIdentityIdSchema, schemas.worldReadRequestIdSchema, schemas.worldReadNormIdSchema,
    schemas.worldReadIntentIdSchema, schemas.worldReadFactIdSchema, schemas.simulationProductReadVersionSchema]) {
    expect(JSON.stringify(parser.parse('same-owner-id'))).toBe('"same-owner-id"')
    expect(parser.safeParse('').success).toBe(false)
  }
  const source = { kind: 'envelope', id: 'envelope', envelopeId: 'envelope', teamId: 'team', channelId: 'channel',
    decisionId: 'decision', envelopeSequence: 1 }
  expect(schemas.worldEngineRefSchema.parse(source)).toEqual(source)
})

it('requires canonical locatable Envelope references and refuses contradictory frozen metadata', () => {
  const envelope = { kind: 'envelope', id: 'original', envelopeId: 'original', teamId: 'team', channelId: 'channel' }
  expect(schemas.worldEngineRefSchema.safeParse({ ...envelope, envelopeSequence: 1 }).success).toBe(true)
  expect(schemas.worldEngineRefSchema.safeParse({ ...envelope, decisionId: 'decision', sourceIndex: 0 }).success).toBe(true)
  for (const changed of [envelope, { ...envelope, decisionId: 'decision' },
    { ...envelope, envelopeSequence: 1, sourceIndex: 0 }, { ...envelope, envelopeSequence: 1, id: 'substituted' }])
    expect(schemas.worldEngineRefSchema.safeParse(changed).success).toBe(false)
})

it('binds every selected identity array and its explicit empty representation page to exact coverage', () => {
  const base = { apiVersion: 'clocky.world-read/v1', kind: 'identity', runId: 'run', snapshotRevision: 1, readVersion: 'policy',
    observedAt: 1, status: 'found' }
  const value = { runId: 'run', key: 'identity', name: { text: 'Original', truncated: false }, kind: 'simulated-actor', generation: 1,
    entity: { kind: 'entity', id: 'subject' }, revision: 1, expansion: { text: 'simulated-actor', truncated: false },
    facts: [], interactions: [], sources: [] }
  for (const section of ['record', 'facts', 'interactions', 'representatives']) {
    const coverage = { loaded: section === 'record' ? 1 : 0, total: section === 'record' ? 1 : 0,
      revision: 1, scope: `identity/${section}`, complete: true, at: '0' }
    const original = { ...base, selection: { kind: 'identity', runId: 'run', key: 'identity', section }, coverage,
      value: { ...value, ...section === 'representatives' ? { representatives: [] } : {} } }
    expect(schemas.simulationProductWorldDomainResultSchema.safeParse(original).success).toBe(true)
    expect(schemas.simulationProductWorldDomainResultSchema.safeParse({ ...original, coverage: {
      ...coverage, loaded: section === 'record' ? 0 : 1, total: 1 } }).success).toBe(false)
    if (section === 'representatives') expect(schemas.simulationProductWorldDomainResultSchema.safeParse({ ...original, value }).success).toBe(false)
  }
})
