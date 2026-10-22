import { simulationProductWorldBusinessSummarySchema } from './case-schema.ts'
import { simulationHiringMarketResultSchema } from '@clocky/clocky-simulation/world-authoring'
import { simulationCalendarRecurrenceSchema, simulationCivilCalendarSchema, simulationNormImpactInputSchema, simulationNormImpactSchema } from '@clocky/clocky-simulation/world-authoring'
/** Strict browser-safe World read contracts; every continuation names one query and policy lifetime. */
import { z } from 'zod'
import type { SimulationEntityId, SimulationRelationId, SimulationDecisionId, SimulationOperationId,
  SimulationCheckpointId } from '@clocky/clocky-simulation/identities'
import type { WorldProposalId, WorldExternalIdentityId, WorldNormId, WorldIntentId,
  WorldFactId } from '@clocky/clocky-simulation/world-domain-types'
import type { WorldRequestId } from '@clocky/clocky-simulation/world-types'
import type { TeamId, ParticipantId, ChannelId, EnvelopeId, TeamTaskId } from '@clocky/clocky-team/types'
import type { SessionId } from '@clocky/clocky-session/types'
import { simulationProductReadVersionSchema } from './watch-schema.ts'
export { simulationProductReadVersionSchema } from './watch-schema.ts'
import { personnelObligationOwnerSchema, personnelObligationReferenceSchema } from '@clocky/clocky-simulation/personnel-obligations'
import { simulationProductRunIdSchema, simulationProductCursorSchema, simulationProductTextSchema as text } from './schema-common.ts'
import type { SimulationProductWorldDomainInput, SimulationProductWorldDomainResult } from './world-read-types.ts'

const id = z.string().min(1), count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Preserve the original SimulationEntityId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadEntityIdSchema = id.transform(value => value as SimulationEntityId)
/** Preserve the original SimulationRelationId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadRelationIdSchema = id.transform(value => value as SimulationRelationId)
/** Preserve the original SimulationDecisionId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadDecisionIdSchema = id.transform(value => value as SimulationDecisionId)
/** Preserve the original SimulationOperationId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadOperationIdSchema = id.transform(value => value as SimulationOperationId)
/** Preserve the original SimulationCheckpointId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadCheckpointIdSchema = id.transform(value => value as SimulationCheckpointId)
/** Preserve the original TeamId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadTeamIdSchema = id.transform(value => value as TeamId)
/** Preserve the original ParticipantId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadParticipantIdSchema = id.transform(value => value as ParticipantId)
/** Preserve the original ChannelId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadChannelIdSchema = id.transform(value => value as ChannelId)
/** Preserve the original EnvelopeId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadEnvelopeIdSchema = id.transform(value => value as EnvelopeId)
/** Preserve the original TeamTaskId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadTaskIdSchema = id.transform(value => value as TeamTaskId)
/** Preserve the original SessionId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadSessionIdSchema = id.transform(value => value as SessionId)
/** Preserve the original WorldProposalId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadProposalIdSchema = id.transform(value => value as WorldProposalId)
/** Preserve the original WorldExternalIdentityId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadExternalIdentityIdSchema = id.transform(value => value as WorldExternalIdentityId)
/** Preserve the original WorldRequestId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadRequestIdSchema = id.transform(value => value as WorldRequestId)
/** Preserve the original WorldNormId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadNormIdSchema = id.transform(value => value as WorldNormId)
/** Preserve the original WorldIntentId at the public parser boundary; the JSON value remains unchanged. */
export const worldReadIntentIdSchema = id.transform(value => value as WorldIntentId)
/** Preserve the original Native fact identity rather than treating it as a display key. */
export const worldReadFactIdSchema = id.transform(value => value as WorldFactId)

const time = z.string().regex(/^(0|[1-9][0-9]*)$/), version = z.string().regex(/^[1-9][0-9]*$/)
const common = { runId: simulationProductRunIdSchema, limit: count.positive().optional(), cursor: simulationProductCursorSchema.optional(),
  expectedRevision: count.optional(), readVersion: simulationProductReadVersionSchema.optional(), at: time.optional() }
/** Exact read-only selector; caller-supplied principal, body policy, Native or filesystem options reject. */
export const simulationProductWorldDomainInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('overview') }),
  z.strictObject({ ...common, kind: z.literal('hiring-market'), family: z.enum(['persona-draft', 'vacancy', 'application', 'offer-revision']) }),
  z.strictObject({ ...common, kind: z.literal('organization'), lens: z.enum(['structure', 'timeline', 'people']) }),
  z.strictObject({ ...common, kind: z.literal('person'), personId: worldReadEntityIdSchema, section: z.enum(['identity',
    'tenures', 'obligations']) }),
  z.strictObject({ ...common, kind: z.literal('governance'), lens: z.enum(['proposals', 'norms', 'history']) }),
  z.strictObject({ ...common, kind: z.literal('proposal'), proposalId: worldReadProposalIdSchema, section: z.enum(['record',
    'electorate', 'votes', 'impact']), normImpact: simulationNormImpactInputSchema.optional() })
    .refine(value => value.normImpact === undefined || value.section === 'impact', 'Impact parameters require the explicit impact section'),
  z.strictObject({ ...common, kind: z.literal('norm'), versionId: id }),
  z.strictObject({ ...common, kind: z.literal('external') }),
  z.strictObject({ ...common, kind: z.literal('identity'), key: worldReadExternalIdentityIdSchema, section: z.enum(['record',
    'facts', 'interactions',
    'representatives']) }),
  z.strictObject({ ...common, kind: z.literal('case-extensions'), requestIds: z.array(worldReadRequestIdSchema).min(1).max(128)
    .refine(values => new Set(values).size === values.length, 'Case selections must be distinct') }),
])
const refLabel = { label: id.optional() }
/** Metadata references carry canonical provenance but never source prose or Session read authority. */
export const worldEngineRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('entity'), id: worldReadEntityIdSchema, ...refLabel }),
  z.strictObject({ kind: z.literal('decision'), id: worldReadDecisionIdSchema, ...refLabel }),
  z.strictObject({ kind: z.literal('operation'), id: worldReadOperationIdSchema, ...refLabel }),
  z.strictObject({ kind: z.literal('checkpoint'), id: worldReadCheckpointIdSchema, ...refLabel }),
  z.strictObject({ kind: z.literal('record'), sequence: count, ...refLabel }),
  z.strictObject({ kind: z.literal('team-task'), id: worldReadTaskIdSchema, teamId: worldReadTeamIdSchema, ...refLabel }),
  z.strictObject({ kind: z.literal('envelope'), id: worldReadEnvelopeIdSchema, teamId: worldReadTeamIdSchema,
    channelId: worldReadChannelIdSchema, envelopeId: worldReadEnvelopeIdSchema, envelopeSequence: count.optional(),
    decisionId: worldReadDecisionIdSchema.optional(), sourceIndex: count.optional(), ...refLabel })
    .refine(value => value.id === value.envelopeId, 'Envelope identity must retain its canonical original')
    .refine(value => value.sourceIndex === undefined || value.decisionId !== undefined,
      'Frozen source ordinal requires its original decision')
    .refine(value => value.envelopeSequence !== undefined || value.decisionId !== undefined && value.sourceIndex !== undefined,
      'Envelope references require a canonical receipt sequence or frozen decision/source ordinal'),
])
const refs = z.array(worldEngineRefSchema)
/** Coverage applies to one explicitly named collection, not a full inferred world graph. */
export const worldReadCoverageSchema = z.strictObject({ loaded: count, total: count.optional(), revision: count,
  scope: id, complete: z.boolean(), reason: z.enum(['native-only', 'unavailable', 'source-moved']).optional(),
  at: time.optional(), nextCursor: simulationProductCursorSchema.optional(), pendingUpdates: count.optional() })
  .refine(value => value.total === undefined || value.loaded <= value.total, 'Coverage cannot load beyond its original total')
  .refine(value => !value.complete || value.reason === undefined && value.nextCursor === undefined,
    'Complete coverage cannot conceal omitted pages or unavailable sources')
const disclosure = <T extends z.ZodType>(schema: T) => z.discriminatedUnion('state', [
  z.strictObject({ state: z.enum(['withheld', 'redacted', 'not-applicable']) }),
  z.strictObject({ state: z.literal('allowed'), value: schema }),
])
const action = z.strictObject({ action: z.enum(['transfer', 'depart', 'rehire', 'hire-existing', 'hiring-market', 'cancel-case', 'dispose-obligation']),
  allowed: z.boolean(), reason: id.optional() })
const tenure = z.strictObject({ id: worldReadRelationIdSchema, personId: worldReadEntityIdSchema,
  positionId: worldReadEntityIdSchema, positionName: text, from: time, until: time.optional(),
  requestedAt: time.optional(), end: z.enum(['departed', 'terminated', 'transferred']).optional(), revision: count })
const employment = z.enum(['employed', 'departing', 'departed', 'terminated', 'candidate'])
const residency = z.enum(['resident', 'released', 'retiring', 'retirement-unconfirmed', 'not-applicable', 'unknown'])
const personRow = z.strictObject({ id: worldReadEntityIdSchema, name: text, unitId: worldReadEntityIdSchema.optional(),
  position: text.optional(), employment,
  cognition: z.enum(['agent', 'none']), residency, pendingObligations: count.nullable(), tenures: z.array(tenure) })
/** Exact original duty metadata shared by personnel inspection and inert management previews. */
export const worldReadObligationSchema = z.strictObject({ id, kind: z.enum(['decision', 'operation', 'task-attempt', 'commitment', 'resource',
  'wake', 'message', 'subordinate', 'owner-duty']),
label: text, owner: text, state: z.enum(['waiting', 'actionable', 'handoff-required', 'settled']), revision: count,
ref: worldEngineRefSchema.optional(), original: z.strictObject({ owner: personnelObligationOwnerSchema,
  ref: personnelObligationReferenceSchema, cursor: count }).optional(),
certainty: z.enum(['recorded', 'outcome-unknown', 'external-observation-required']).optional(), ownerState: id.optional(),
dispositions: z.array(z.enum(['wait', 'cancel-and-recreate'])) })
  .refine(value => value.kind !== 'owner-duty' || value.original !== undefined && value.certainty !== undefined
    && value.ownerState !== undefined && value.original.cursor === value.revision
    && value.dispositions.length === 1 && value.dispositions[0] === 'wait',
  'Owner duties require actual source evidence and confer only observation')
const tally = z.strictObject({ for: count, against: count, abstain: count, pending: count, electorate: count,
  threshold: count, quorum: count, rule: z.enum(['unanimous', 'absolute']), closure: z.enum(['open', 'can-still-change',
    'decided', 'closed']) })
const proposalFields = { id: worldReadProposalIdSchema, title: text, committee: text, status: z.enum(['voting', 'passed',
  'failed', 'enacted',
  'withdrawn']), deadline: time, tally }
const proposal = z.strictObject(proposalFields)
const member = z.strictObject({ proxy: z.strictObject({ delegateId: worldReadEntityIdSchema, delegationId: id }).optional(), personId: worldReadEntityIdSchema, name: text, ballot: z.enum(['for', 'against', 'abstain', 'none']),
  decision: worldEngineRefSchema.optional(), leftCommittee: z.boolean(), sources: refs.optional() })
const enforcement = z.discriminatedUnion('mode', [z.strictObject({ mode: z.literal('advisory') }),
  z.strictObject({ mode: z.literal('validated'), policyRef: id.optional() })])
const normAuditStep = z.strictObject({ id, kind: z.enum(['resolution', 'vote', 'decision', 'effective', 'notification']),
  state: z.enum(['pending', 'completed', 'cancelled', 'missing']), at: time.optional(), source: worldEngineRefSchema.optional() })
const norm = z.strictObject({ audit: z.array(normAuditStep).optional(), id, normId: worldReadNormIdSchema,
  title: text, version, enforcement, scope: text,
  recordedAt: time.optional(), effectiveFrom: time.optional(), knowableAt: time.optional(), until: time.optional(), body: disclosure(text),
  sourceProposalId: worldReadProposalIdSchema.optional(), sources: refs })
const sourceKind = z.enum(['rule', 'director-ruling', 'simulated-actor'])
const externalFields = { key: worldReadExternalIdentityIdSchema, name: text, kind: sourceKind, generation: count,
  latest: z.strictObject({ at: time, summary: text }).optional() }
const external = z.strictObject(externalFields)
const trackStep = z.strictObject({ id, label: z.string(), state: z.enum(['done', 'active', 'waiting', 'blocked', 'rejected',
  'unknown', 'pending']) })
const extension = z.strictObject({ requestId: worldReadRequestIdSchema, domain: id, operation: id,
  businessSummary: simulationProductWorldBusinessSummarySchema, businessKey: disclosure(text),
  target: text.optional(), updatedAt: time.optional(),
  tracks: z.array(z.strictObject({ kind: z.enum(['request', 'plan', 'execution', 'notification']), steps: z.array(trackStep),
    summary: z.string() })),
  evidence: z.strictObject({ fields: z.array(id), responders: z.array(text), deadline: time, remainingAttempts: count,
    revisions: z.array(z.strictObject({ at: time, summary: text })) }).optional(), sources: refs,
  mutation: z.strictObject({ phase: z.enum(['retained', 'reserved', 'quiescing', 'transferring', 'committed', 'notifying', 'done']),
    blocked: id.optional(), cancelRequested: z.boolean() }).optional() })
const calendarRuleView = z.strictObject({ id, ruleRevision: count.positive(),
  target: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('person'), personId: worldReadEntityIdSchema }),
    z.strictObject({ kind: z.literal('position'), positionId: worldReadEntityIdSchema })]),
  body: disclosure(text), startsAt: time, endsAt: time.nullable(), period: time, maxOccurrences: count.positive(),
  recurrence: simulationCalendarRecurrenceSchema.optional(), civil: simulationCivilCalendarSchema.optional(),
  priority: z.number().int().min(-1000).max(1000).optional() })
const overview = z.strictObject({ calendars: z.array(calendarRuleView).optional(), runId: simulationProductRunIdSchema,
  revision: count, now: time, tickUnit: id,
  attention: z.strictObject({ handoffRequired: count, outcomeUnknown: count, retirementUnconfirmed: count,
    implementationMissing: count, evidenceRequired: count }),
  upcoming: z.array(z.strictObject({ at: time, label: text, scope: text.optional() })), proposals: z.array(proposal),
  norms: z.strictObject({ active: count, knownNotEffective: count }), external: z.strictObject({ identities: count,
    byKind: z.strictObject({ rule: count.optional(), 'director-ruling': count.optional(), 'simulated-actor': count.optional() }),
    latest: z.strictObject({ at: time, summary: text }).optional() }), caseFlow: z.array(z.strictObject({ status: id, count })) })
const organization = z.strictObject({ runId: simulationProductRunIdSchema, coverage: worldReadCoverageSchema, now: time, tickUnit: id,
  nodes: z.array(z.strictObject({ id: worldReadEntityIdSchema, kind: z.enum(['unit', 'position']), name: text,
    parentId: worldReadEntityIdSchema.optional(),
    occupancy: z.strictObject({ occupied: count, reserved: count, capacity: count }).optional() })),
  edges: z.array(z.strictObject({ id: worldReadRelationIdSchema, from: worldReadEntityIdSchema, to: worldReadEntityIdSchema,
    kind: z.enum(['parent', 'reports-to']) })), people: z.array(personRow),
  range: z.strictObject({ from: time, until: time }), unloadedNodes: count })
const person = z.strictObject({ runId: simulationProductRunIdSchema, personId: worldReadEntityIdSchema, revision: count,
  name: text, employment, residency,
  participantId: worldReadParticipantIdSchema.optional(), sessionId: worldReadSessionIdSchema.optional(), entity: worldEngineRefSchema,
  persona: disclosure(z.strictObject({ summary: text })),
  tenures: z.array(tenure), obligations: z.array(worldReadObligationSchema), actions: z.array(action), sources: refs })
const governance = z.strictObject({ runId: simulationProductRunIdSchema, coverage: worldReadCoverageSchema, now: time, tickUnit: id,
  proposals: z.array(proposal), norms: z.array(norm) })
const proposalDetail = z.strictObject({ normImpact: disclosure(simulationNormImpactSchema).optional(),
  normImpactInput: disclosure(simulationNormImpactInputSchema).optional(),
  normImpactChoices: disclosure(z.strictObject({ committeeId: worldReadEntityIdSchema,
    positionIds: z.array(worldReadEntityIdSchema) })).optional(),
  ...proposalFields, runId: simulationProductRunIdSchema, version, bodyHash: id,
  body: disclosure(text),
  routeDefinition: z.strictObject({ id, hash: id, bodyHash: id, mode: z.enum(['and', 'or', 'ordered']), deadline: time,
    steps: z.array(z.strictObject({ id, proposalId: id, committeeId: id, dependsOn: z.array(id), deadline: time,
      quorum: count.positive(), rule: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('unanimity') }),
        z.strictObject({ kind: z.literal('absolute-threshold'), yes: count.positive() })]), electorate: z.array(id),
      status: z.enum(['pending', 'passed', 'failed']), resolutionId: id.nullable(), resolutionHash: id.nullable() })) }).optional(),
  reviewRoute: z.strictObject({ id, revision: count.positive(), hash: id, mode: z.enum(['and', 'or', 'ordered']),
    steps: z.array(z.strictObject({ id, proposalId: worldReadProposalIdSchema, resolutionId: id.nullable(), resolutionHash: id.nullable(),
      dependsOn: z.array(id) })) }).optional(),
  targetNorm: z.strictObject({ id: worldReadNormIdSchema, version }).optional(), frozenAt: time,
  electorateMembers: z.array(member), sources: refs,
  resolution: z.strictObject({ at: time, outcome: z.enum(['passed', 'failed']) }).optional(),
  enactment: z.strictObject({ state: z.enum(['not-applicable', 'awaiting-request', 'enacted']),
    normVersion: z.strictObject({ id: worldReadNormIdSchema, version }).optional(),
    announcement: z.enum(['pending', 'published', 'unknown']).optional() }) })
const externalView = z.strictObject({ runId: simulationProductRunIdSchema, coverage: worldReadCoverageSchema,
  identities: z.array(external) })
const identity = z.strictObject({ ...externalFields, runId: simulationProductRunIdSchema, entity: worldEngineRefSchema,
  revision: count, expansion: text,
  facts: z.array(z.strictObject({ key: worldReadFactIdSchema, value: z.discriminatedUnion('state',
    [z.strictObject({ state: z.literal('unknown') }),
      z.strictObject({ state: z.literal('known'), text })]), report: z.boolean() })),
  representative: z.strictObject({ person: text, participantId: worldReadParticipantIdSchema.optional(),
    sessionId: worldReadSessionIdSchema.optional(),
    ready: z.enum(['ready', 'preparing', 'blocked']),
    steps: z.array(trackStep) }).optional(),
  representatives: z.array(z.strictObject({ entity: worldEngineRefSchema, person: text,
    participantId: worldReadParticipantIdSchema, sessionId: worldReadSessionIdSchema,
    ready: z.enum(['ready', 'preparing', 'blocked']), steps: z.array(trackStep) })).optional(),
  interactions: z.array(z.strictObject({ id: worldReadIntentIdSchema, at: time, requester: text,
    kind: z.enum(['rule', 'director-ruling', 'simulated-actor', 'authenticated-user', 'world-decision']), basis: text, outcome: text,
    sampled: z.boolean(), disclosure: disclosure(text) })), sources: refs })
const hiringMarketRow = z.strictObject({ id, current: z.boolean(), requestId: worldReadRequestIdSchema, sequence: count.positive(),
  revision: count.positive(), status: id, body: disclosure(text), detail: disclosure(simulationHiringMarketResultSchema), sources: refs }).refine(row => row.detail.state !== 'allowed'
  || 'kind' in row.detail.value && row.detail.value.id === row.id
    && (!('revision' in row.detail.value) || row.detail.value.revision === row.revision)
    && (!('status' in row.detail.value) || row.detail.value.status === row.status),
'Hiring detail must retain its original row identity, revision and status')
const hiringMarketView = z.strictObject({ runId: simulationProductRunIdSchema, coverage: worldReadCoverageSchema,
  rows: z.array(hiringMarketRow) })
const base = { apiVersion: z.literal('clocky.world-read/v1'), runId: simulationProductRunIdSchema, snapshotRevision: count,
  readVersion: simulationProductReadVersionSchema,
  observedAt: count, selection: simulationProductWorldDomainInputSchema, status: z.enum(['found', 'missing']),
  coverage: worldReadCoverageSchema }
const values = { overview, organization, person, governance, proposal: proposalDetail, norm, external: externalView, identity,
  'case-extensions': z.array(extension) }
/** One kind-specific bounded response; no Native snapshots, callbacks or untyped payload escape this DTO. */
export const simulationProductWorldDomainResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('overview'), value: values.overview.optional() }),
  z.strictObject({ ...base, kind: z.literal('hiring-market'), value: hiringMarketView.optional() }),
  z.strictObject({ ...base, kind: z.literal('organization'), value: values.organization.optional() }),
  z.strictObject({ ...base, kind: z.literal('person'), value: values.person.optional() }),
  z.strictObject({ ...base, kind: z.literal('governance'), value: values.governance.optional() }),
  z.strictObject({ ...base, kind: z.literal('proposal'), value: values.proposal.optional() }),
  z.strictObject({ ...base, kind: z.literal('norm'), value: values.norm.optional() }),
  z.strictObject({ ...base, kind: z.literal('external'), value: values.external.optional() }),
  z.strictObject({ ...base, kind: z.literal('identity'), value: values.identity.optional() }),
  z.strictObject({ ...base, kind: z.literal('case-extensions'), value: values['case-extensions'].optional() }),
]).refine(value => (value.status === 'found') === (value.value !== undefined), 'Only a found original carries its selected projection')
  .refine(value => value.kind === value.selection.kind && value.runId === value.selection.runId
    && value.coverage.revision === value.snapshotRevision
    && (value.selection.expectedRevision === undefined || value.selection.expectedRevision === value.snapshotRevision)
    && (value.selection.readVersion === undefined || value.selection.readVersion === value.readVersion),
  'World read response must retain its original kind, run, revision and policy selector')
  .superRefine((result, ctx) => {
    const fail = (message: string) => { ctx.addIssue({ code: 'custom', message }) }
    if (result.selection.at !== undefined && result.selection.at !== result.coverage.at)
      fail('Coverage must retain the selected simulation time')
    const value = result.value
    if (value === undefined) return
    if ('runId' in value && value.runId !== result.runId) fail('Projected run must match its wrapper')
    if ('coverage' in value && JSON.stringify(value.coverage) !== JSON.stringify(result.coverage))
      fail('Projected collection must retain the original coverage')
    if ('now' in value && value.now !== result.coverage.at) fail('Projected time must match its original coverage')
    switch (result.kind) {
      case 'overview':
        if (result.value?.revision !== result.snapshotRevision) fail('Overview revision must match its Native prefix')
        break
      case 'organization': {
        if (result.selection.kind !== 'organization' || result.value === undefined) break
        const { lens } = result.selection, original = result.value
        if (result.coverage.scope !== `organization/${lens}`) fail('Organization lens must match its coverage')
        if (lens === 'structure' ? original.people.length !== 0 || original.nodes.length !== result.coverage.loaded
          : original.nodes.length !== 0 || original.edges.length !== 0 || (lens === 'people'
            ? original.people.length !== result.coverage.loaded
            : original.people.reduce((total, person) => total + person.tenures.length, 0) !== result.coverage.loaded))
          fail('Organization window must contain only its selected lens')
        break
      }
      case 'person': {
        if (result.selection.kind !== 'person' || result.value === undefined) break
        const selected = result.selection, original = result.value
        if (original.personId !== selected.personId || original.entity.kind !== 'entity' || original.entity.id !== selected.personId
          || result.coverage.scope !== `person/${selected.section}`) fail('Person original must match its exact selector')
        if (selected.section !== 'tenures' && original.tenures.length !== 0
          || selected.section !== 'obligations' && original.obligations.length !== 0
          || original.tenures.some(item => item.personId !== selected.personId)
          || selected.section === 'tenures' && original.tenures.length !== result.coverage.loaded
          || selected.section === 'obligations' && (original.obligations.length !== result.coverage.loaded
            || original.obligations.some(item => item.original !== undefined
              && item.original.cursor !== result.snapshotRevision))) fail('Person window must retain its selected section')
        break
      }
      case 'governance': {
        if (result.selection.kind !== 'governance' || result.value === undefined) break
        const { lens } = result.selection, original = result.value
        if (result.coverage.scope !== `governance/${lens}` || (lens === 'proposals'
          ? original.norms.length !== 0 || original.proposals.length !== result.coverage.loaded
          : original.proposals.length !== 0 || original.norms.length !== result.coverage.loaded))
          fail('Governance window must retain its selected lens')
        break
      }
      case 'proposal':
        if (result.selection.kind === 'proposal' && result.value !== undefined
          && (result.value.id !== result.selection.proposalId || result.coverage.scope !== `proposal/${result.selection.section}`
            || ['record', 'impact'].includes(result.selection.section) && result.value.electorateMembers.length !== 0))
          fail('Proposal original must match its exact selector and section')
        break
      case 'norm':
        if (result.selection.kind === 'norm' && result.value !== undefined
          && (result.value.id !== result.selection.versionId
            || result.value.id !== JSON.stringify([result.value.normId, result.value.version])))
          fail('Norm original must match its canonical version selector')
        break
      case 'external':
        if (result.value?.identities.length !== result.coverage.loaded) fail('External window must match its coverage')
        break
      case 'identity':
        if (result.selection.kind === 'identity' && result.value !== undefined
          && (result.value.key !== result.selection.key || result.coverage.scope !== `identity/${result.selection.section}`
            || result.selection.section !== 'facts' && result.value.facts.length !== 0
            || result.selection.section !== 'interactions' && result.value.interactions.length !== 0
            || result.selection.section !== 'representatives' && result.value.representatives !== undefined
            || result.selection.section === 'facts' && result.value.facts.length !== result.coverage.loaded
            || result.selection.section === 'interactions' && result.value.interactions.length !== result.coverage.loaded
            || result.selection.section === 'representatives' && (result.value.representatives === undefined
              || result.value.representatives.length !== result.coverage.loaded)
            || result.selection.section === 'record' && result.coverage.loaded !== 1))
          fail('External identity original must match its exact selector and section')
        break
      case 'hiring-market':
        if (result.selection.kind === 'hiring-market' && result.value !== undefined
          && (result.value.rows.length !== result.coverage.loaded || result.coverage.scope !== `hiring-market/${result.selection.family}`
            || result.value.rows.some(row => row.detail.state === 'allowed' && (!('kind' in row.detail.value)
              || result.selection.kind !== 'hiring-market' || row.detail.value.kind !== result.selection.family))))
          fail('Hiring market history must retain its selected family and page coverage')
        break
      case 'case-extensions':
        if (result.selection.kind === 'case-extensions' && result.value !== undefined
          && (result.value.length !== result.coverage.loaded
            || new Set(result.value.map(item => item.requestId)).size !== result.value.length
            || result.value.some(item => result.selection.kind !== 'case-extensions'
              || !result.selection.requestIds.includes(item.requestId)
              || item.businessSummary.status === 'allowed' && item.businessSummary.value.nativeRevision !== result.snapshotRevision)))
          fail('Case extensions must retain distinct selected originals')
        break
    }
  })

/**
 * Correlate the complete caller query with one parsed response without importing Host or Native services.
 * @param input - Validated original query, including its exact optional fields and continuation.
 * @param result - Strict response from the selected carrier.
 * @returns true only for the same selection and requested revision/policy lifetime.
 */
export function matchesWorldDomainSelection(input: SimulationProductWorldDomainInput, result: SimulationProductWorldDomainResult): boolean {
  const canonical = (value: SimulationProductWorldDomainInput) => JSON.stringify(Object.entries(value).filter(([,
    item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)))
  return input.kind === result.kind && input.runId === result.runId && canonical(input) === canonical(result.selection)
    && (input.expectedRevision === undefined || input.expectedRevision === result.snapshotRevision)
    && (input.readVersion === undefined || input.readVersion === result.readVersion)
}

/**
 * Remove every independently granted body at final publication after a policy change.
 * @param value - Strict detached result; this never edits the retained Native source or its prior view.
 * @returns metadata with all private body/known-fact windows retired.
 */
export function retireWorldReadBodies(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(retireWorldReadBodies)
  if (value === null || typeof value !== 'object') return value
  if ('state' in value && value.state === 'allowed') return { state: 'withheld' }
  if ('state' in value && value.state === 'known') return { state: 'unknown' }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, retireWorldReadBodies(item)]))
}
