import { projectNormImpact, simulationNormImpactInputSchema } from '@clocky/clocky-simulation/world-authoring'
import { WORLD_HIRING_MARKET_PIN, simulationHiringMarketResultSchema } from '@clocky/clocky-simulation'
/** Pure metadata and independently granted bodies over one authoritative Native prefix; never an execution owner. */
import type { SimulationSnapshot, SimulationEntity, SimulationRelation, SimulationWorldRequest,
  SimulationGovernanceProposal, SimulationNormVersion, PersonnelObligationReport, PersonnelObligation, SimulationOperation,
  SimulationExternalContact, SimulationExternalIdentity } from '@clocky/clocky-simulation'
import type { SimulationProductRunId } from './types.ts'
import type { SimulationProductWorldDomainInput, BoundedText, Coverage, EngineRef, Tenure, PersonRow, Residency,
  EmploymentState, ProposalSummary, ProposalDetailView, TallyView, NormVersionView, ExternalIdentityRow, SourceKind, Obligation,
  Disclosure, WorldCaseExtension, ExternalInteraction } from './world-read-types.ts'
import { worldCaseSummary, worldCaseEvidence } from './cases.ts'
import { effectiveNorms, simTimeSchema } from '@clocky/clocky-simulation'

type World = NonNullable<SimulationSnapshot['world']>
function original<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('World read lost an original Native reference')
  return value
}
function ownedWorld(state: SimulationSnapshot): World { return original(state.world) }
/** Query-selected bounded window; scope explains exactly which original collection it covers. */
export interface WorldReadPage<T> { readonly items: readonly T[]; readonly coverage: Coverage }
/** Read policy belongs to the authenticated product service and is revalidated at publication. */
export interface WorldReadProjectionPolicy {
  readonly runId: SimulationProductRunId
  readonly at: string
  readonly limit: number
  readonly personnel?: PersonnelObligationReport | undefined
  /** Same policy-fenced exact-version mapper used by case lists and details. */
  businessSummary?(requestId: string): import('./case-types.ts').SimulationProductWorldBusinessSummary
  text(value: string): BoundedText
  context(entityId: string, content: 'context' | 'knowledge'): boolean
  case(requestId: string): boolean
  persona(requestId: string): boolean
  resident(entity: SimulationEntity): boolean
  page<T>(items: readonly T[], scope: string, incomplete?: boolean | Coverage['reason']): WorldReadPage<T>
  /** Optional original administration metadata; absence grants no management capability. */
  actions?(personId: SimulationEntity['id']): readonly import('./world-read-types.ts').ActionHint[]
}
/** A missing selected original differs from an explicitly empty bounded collection. */
export interface WorldReadProjection { readonly value?: unknown; readonly coverage: Coverage }

function lookup<T>(values: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(values, id) ? values[id] : undefined
}
function active(relation: SimulationRelation, at: string): boolean {
  return BigInt(relation.validFrom) <= BigInt(at) && (relation.validUntil === null || BigInt(at) < BigInt(relation.validUntil))
}
function label(state: SimulationSnapshot, id: string, policy: WorldReadProjectionPolicy): BoundedText {
  const name = lookup(state.entities, id)?.profile['name']
  return policy.text(typeof name === 'string' ? name : id)
}
function unique(refs: readonly EngineRef[]): EngineRef[] {
  return [...new Map(refs.map(ref => [JSON.stringify(ref), ref])).values()]
}
function operationSources(state: SimulationSnapshot, id: string | null): EngineRef[] {
  if (id === null) return []
  const operation = lookup(state.operations, id)
  if (operation === undefined) return []
  const refs: EngineRef[] = [{ kind: 'operation', id: operation.id }, { kind: 'decision', id: operation.decisionId },
    { kind: 'entity', id: operation.entityId }]
  const sequence = operation.result?.sequence ?? state.decisions[operation.decisionId]?.closedAt
  if (sequence !== undefined) refs.push({ kind: 'record', sequence })
  const receipt = operation.outbox?.receipt
  if (receipt !== undefined) refs.push({ kind: 'envelope', id: receipt.envelopeId, teamId: receipt.teamId,
    channelId: receipt.channelId, envelopeId: receipt.envelopeId, envelopeSequence: receipt.sequence, decisionId: operation.decisionId })
  const context = state.decisions[operation.decisionId]?.context
  if (context?.status === 'prepared') context.view.sources.forEach((source, sourceIndex) => {
    if (source.kind === 'team-envelope') refs.push({ kind: 'envelope', id: source.envelopeId, teamId: source.teamId,
      channelId: source.channelId, envelopeId: source.envelopeId, decisionId: operation.decisionId, sourceIndex })
  })
  return unique(refs)
}
function caseSources(state: SimulationSnapshot, request: SimulationWorldRequest): EngineRef[] {
  const world = state.world
  if (world === undefined) return []
  const refs: EngineRef[] = [...operationSources(state, request.operationId), { kind: 'record', sequence: request.sequence },
    ...request.requesterEntityId === null ? [] : [{ kind: 'entity' as const, id: request.requesterEntityId }],
    { kind: 'entity', id: original(world.intents[request.intentId]).targetEntityId }]
  if (request.notificationOperationId !== null) refs.push(...operationSources(state, request.notificationOperationId))
  const latest = request.plans.at(-1), plan = latest === undefined ? undefined : world.plans[latest]
  if (plan !== undefined) refs.push({ kind: 'record', sequence: plan.sequence }, ...operationSources(state, plan.operationId))
  const checkpoint = state.latestCheckpointId === undefined ? undefined : state.checkpoints?.[state.latestCheckpointId]
  if (checkpoint?.status === 'completed') refs.push({ kind: 'checkpoint', id: checkpoint.request.id,
    label: `Recovery anchor at Native #${checkpoint.manifest.run.cursor}` })
  return unique(refs)
}
function residency(entity: SimulationEntity, policy: WorldReadProjectionPolicy): Residency {
  if (entity.cognition === 'none') return 'not-applicable'
  if (entity.writer?.phase === 'released') return 'released'
  if (entity.writer?.phase === 'revoked') return 'retirement-unconfirmed'
  return policy.resident(entity) ? 'resident' : 'unknown'
}
function employment(state: SimulationSnapshot, entity: SimulationEntity, at: string): EmploymentState {
  if (entity.phase === 'terminated') return 'terminated'
  const world = state.world
  if (Object.values(world?.personnel.fences ?? {}).some(value => value.personId === entity.id
    && value.status === 'active')) return 'departing'
  const assignments = Object.values(state.relations).filter(value => value.subject === entity.id && value.relation === 'assignment')
  return assignments.some(value => active(value, at)) ? 'employed' : assignments.some(value => BigInt(value.validFrom) <= BigInt(at))
    ? 'departed' : 'candidate'
}
function tenure(state: SimulationSnapshot, relation: SimulationRelation, policy: WorldReadProjectionPolicy): Tenure {
  const reservation = Object.values(state.world?.personnel.reservations ?? {}).find(value => value.assignmentId === relation.id
    && value.status === 'committed' && relation.validUntil === value.actualEffectiveAt)
  const requested = reservation === undefined ? undefined : state.world?.intents[reservation.id]?.expectedTime
  return { id: relation.id, personId: relation.subject, positionId: relation.object, positionName: label(state, relation.object, policy),
    from: relation.validFrom, ...relation.validUntil === null ? {} : { until: relation.validUntil }, revision: relation.revision,
    ...requested === null || requested === undefined || requested === reservation?.actualEffectiveAt ? {} : { requestedAt: requested },
    ...reservation === undefined ? {} : { end: reservation.targetPositionId === null ? 'departed' : 'transferred' } }
}
function tenures(state: SimulationSnapshot, person: string, policy: WorldReadProjectionPolicy): Tenure[] {
  return Object.values(state.relations).filter(value => value.subject === person && value.relation === 'assignment'
    && BigInt(value.validFrom) <= BigInt(policy.at)).sort((a, b) => BigInt(a.validFrom) < BigInt(b.validFrom) ? -1
    : BigInt(a.validFrom) > BigInt(b.validFrom) ? 1 : a.id.localeCompare(b.id)).map(value => tenure(state, value, policy))
}
function personRow(state: SimulationSnapshot, entity: SimulationEntity, policy: WorldReadProjectionPolicy): PersonRow {
  const history = tenures(state, entity.id, policy), latest = history.filter(value => value.until === undefined
    || BigInt(value.until) > BigInt(policy.at)).at(-1)
  return { id: entity.id, name: label(state, entity.id, policy), employment: employment(state, entity, policy.at),
    cognition: entity.cognition, residency: residency(entity, policy), pendingObligations: null,
    ...latest === undefined ? {} : { position: latest.positionName }, tenures: latest === undefined ? [] : [latest] }
}
function proposalSummary(state: SimulationSnapshot, proposal: SimulationGovernanceProposal,
  policy: WorldReadProjectionPolicy): ProposalSummary {
  const world = ownedWorld(state)
  const votes = Object.values(world.governance.votes).filter(value => value.proposalId === proposal.id
    && BigInt(value.time) <= BigInt(policy.at))
  const resolution = Object.values(world.governance.resolutions).find(value => value.proposalId === proposal.id
    && BigInt(value.time) <= BigInt(policy.at))
  const enacted = Object.values(world.norms.versions).flat().some(value => value.origin === 'governance'
    && value.proposal.id === proposal.id && BigInt(original(world.mutations[value.source.mutationId]).time) <= BigInt(policy.at))
  const tally: TallyView = { for: votes.filter(value => value.choice === 'yes').length,
    against: votes.filter(value => value.choice === 'no').length, abstain: votes.filter(value => value.choice === 'abstain').length,
    pending: proposal.electorate.length - votes.length, electorate: proposal.electorate.length,
    threshold: proposal.rule.kind === 'unanimity' ? proposal.electorate.length : proposal.rule.yes,
    quorum: proposal.quorum, rule: proposal.rule.kind === 'unanimity' ? 'unanimous' : 'absolute',
    closure: resolution === undefined ? 'open' : 'closed' }
  return { id: proposal.id, title: policy.text(proposal.id), committee: label(state, proposal.committeeId, policy),
    deadline: proposal.deadline,
    status: enacted ? 'enacted' : resolution?.outcome ?? 'voting', tally }
}
function normObserved(state: SimulationSnapshot, norm: SimulationNormVersion, at: string): boolean {
  return norm.origin === 'scenario' || BigInt(original(ownedWorld(state).mutations[norm.source.mutationId]).time) <= BigInt(at)
}
function activeNorms(state: SimulationSnapshot, at: string): readonly SimulationNormVersion[] {
  return [...new Set(Object.values(ownedWorld(state).norms.versions).flat().map(value => value.scope))]
    .flatMap(scope => effectiveNorms(state, scope, simTimeSchema.parse(at), state.revision)).filter(norm => normObserved(state, norm, at))
}
function normRow(state: SimulationSnapshot, norm: SimulationNormVersion, policy: WorldReadProjectionPolicy): NormVersionView {
  const permitted = policy.context(norm.scope, 'knowledge') || policy.context(ownedWorld(state).definition.directorEntityId, 'context')
    || norm.origin === 'governance' && policy.case(norm.source.requestId)
  const until = [norm.effectiveUntil, ...ownedWorld(state).norms.closures.filter(value => value.norm.id === norm.id
    && value.norm.version === norm.version).map(value => value.at)].filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)[0]
  const governance = ownedWorld(state).governance
  const resolution = norm.origin === 'governance' ? governance.resolutions[norm.resolution.id] : undefined
  const route = norm.origin === 'governance' ? norm.reviewRoute ?? governance.proposals[norm.proposal.id]?.reviewRoute : undefined
  const approvals = [...resolution === undefined ? [] : [resolution], ...route?.steps.flatMap((step) => {
    const original = step.resolutionId === null ? undefined : governance.resolutions[step.resolutionId]
    return original === undefined || original.hash !== step.resolutionHash || BigInt(original.time) > BigInt(policy.at) ? [] : [original]
  }) ?? []]
  const causalVotes = approvals.flatMap(approval => [{ kind: 'record' as const, sequence: approval.sequence },
    ...approval.votes.flatMap((ref) => {
      const vote = governance.votes[ref.id]
      return vote === undefined || vote.hash !== ref.hash || BigInt(vote.time) > BigInt(policy.at)
        ? [] : operationSources(state, vote.source.operationId)
    })])
  const notifications = Object.values(state.scheduledEvents).filter(event => event.status === 'consumed'
    && BigInt(event.key.time) <= BigInt(policy.at) && (event.action.kind === 'norm-boundary'
      && event.action.norm.id === norm.id && event.action.norm.version === norm.version
      || event.action.kind === 'wake' && Object.values(ownedWorld(state).norms.announcements).some(announcement =>
        announcement.norm.id === norm.id && announcement.norm.version === norm.version
        && event.id === `simulation-norm-announcement:${announcement.id}:${event.action.kind === 'wake' ? event.action.entityId : ''}`)))
    .flatMap(event => event.settledAt === undefined ? [] : [{ kind: 'record' as const, sequence: event.settledAt }])
  const audit: NonNullable<NormVersionView['audit']>[number][] = []
  if (permitted) {
    for (const approval of approvals) {
      audit.push({ id: approval.id, kind: 'resolution', state: 'completed', at: approval.time,
        source: { kind: 'record', sequence: approval.sequence } })
      for (const ref of approval.votes) {
        const vote = governance.votes[ref.id]
        audit.push(vote === undefined || vote.hash !== ref.hash ? { id: ref.id, kind: 'vote', state: 'missing' }
          : { id: vote.id, kind: 'vote', state: 'completed', at: vote.time, source: { kind: 'record', sequence: vote.sequence } })
        if (vote !== undefined && vote.hash === ref.hash) {
          const decision = state.decisions[vote.source.decisionId]
          audit.push({ id: vote.source.decisionId, kind: 'decision', state: decision?.status === 'accepted' ? 'completed' : 'missing',
            ...decision === undefined ? {} : { at: decision.time, source: { kind: 'decision', id: decision.id } } })
        }
      }
    }
    const responsibility = (id: string, kind: 'effective' | 'notification', at: string) => {
      const event = Object.values(state.scheduledEvents).find(value => value.id === id)
      audit.push({ id, kind, at, state: event === undefined ? 'missing' : BigInt(event.key.time) > BigInt(policy.at) ? 'pending'
        : event.status === 'consumed' ? 'completed' : event.status,
      ...event?.settledAt === undefined ? {} : { source: { kind: 'record', sequence: event.settledAt } } })
    }
    responsibility(`simulation-norm-boundary:${norm.id}:${norm.version}:from`, 'effective', norm.effectiveFrom)
    if (norm.effectiveUntil !== null) responsibility(`simulation-norm-boundary:${norm.id}:${norm.version}:until`, 'effective', norm.effectiveUntil)
    for (const announcement of Object.values(ownedWorld(state).norms.announcements)) {
      if (announcement.norm.id === norm.id && announcement.norm.version === norm.version)
        for (const recipient of announcement.recipients)
          responsibility(`simulation-norm-announcement:${announcement.id}:${recipient}`, 'notification', announcement.availableAt)
    }
  }
  return { ...permitted ? { audit } : {}, id: JSON.stringify([norm.id, norm.version]), normId: norm.id,
    title: policy.text(norm.id), version: norm.version,
    scope: label(state, norm.scope, policy), enforcement: norm.enforcement.kind === 'advisory' ? { mode: 'advisory' }
      : { mode: 'validated', policyRef: norm.enforcement.policyRef }, effectiveFrom: norm.effectiveFrom,
    knowableAt: norm.availableAt, ...until === undefined ? {} : { until },
    body: permitted && BigInt(norm.availableAt) <= BigInt(policy.at) ? { state: 'allowed',
      value: policy.text(norm.body) } : { state: 'withheld' },
    ...norm.origin === 'scenario' ? {} : { sourceProposalId: norm.proposal.id },
    sources: unique([...permitted ? [...causalVotes, ...notifications] : [], { kind: 'record', sequence: norm.sequence }, ...norm.source.references.map(value => ({ kind: 'record' as const,
      sequence: value.sequence })), ...norm.origin === 'scenario' ? [] : caseSources(state,
      original(ownedWorld(state).requests[norm.source.requestId]))]) }
}
function sourceKind(value: 'simulated-rule' | 'simulated-actor' | 'director-mediated'): SourceKind {
  return value === 'simulated-rule' ? 'rule' : value === 'director-mediated' ? 'director-ruling' : 'simulated-actor'
}
type ExternalHistoryRow =
  | { readonly type: 'rule'; readonly value: World['external']['interactions'][keyof World['external']['interactions']] }
  | { readonly type: 'ruling'; readonly value: World['external']['adjudications'][keyof World['external']['adjudications']] }
  | { readonly type: 'contact'; readonly value: SimulationExternalContact }
function externalHistory(state: SimulationSnapshot, identityId: SimulationExternalIdentity['id']): ExternalHistoryRow[] {
  const world = ownedWorld(state)
  return [...Object.values(world.external.interactions).filter(value => value.identityId === identityId)
    .map(value => ({ type: 'rule' as const, value })),
  ...Object.values(world.external.adjudications).filter(value => value.identityId === identityId)
    .map(value => ({ type: 'ruling' as const, value })),
  ...Object.values(world.external.contacts).filter(value => value.identityId === identityId)
    .map(value => ({ type: 'contact' as const, value }))].sort((a, b) => historySequence(state, a) - historySequence(state, b))
}
function contactPosts(state: SimulationSnapshot, contact: SimulationExternalContact) {
  const representative = original(ownedWorld(state).external.representatives[contact.representativeIntentId])
  const posts = Object.values(state.operations).filter(value => value.action.kind === 'communication/post'
    && value.action.channelId === contact.channel.channelId)
  const inquiries = posts.filter((value) => {
    if (value.action.kind !== 'communication/post' || value.entityId !== contact.requesterEntityId
      || value.action.recipient !== representative.identities.entityId) return false
    const context = state.decisions[value.decisionId]?.context
    return context?.status === 'prepared' && context.world?.kind === 'first-action' && context.world.intentId === contact.id
  })
  const delivered = inquiries.filter(value => value.outbox?.receipt !== undefined && value.delivery?.receipt !== undefined
    && value.delivery.receipt.envelopeId === value.outbox.receipt.envelopeId
    && value.delivery.receipt.cursor === value.outbox.receipt.sequence)
  const replies = posts.filter((value) => {
    if (value.action.kind !== 'communication/post' || value.entityId !== representative.identities.entityId
      || value.action.recipient !== contact.requesterEntityId) return false
    const decision = state.decisions[value.decisionId]
    // Native delivery and wake ownership prove which inquiry caused this post. Ordinary communication
    // enters Session independently of frozen Native context sources; this does not prove Session consumption.
    return decision?.wakeId !== undefined && delivered.some((inquiry) => {
      const delivery = inquiry.delivery
      if (delivery === undefined) return false
      const wake = state.wakes[delivery.wakeId]
      return delivery.wakeId === decision.wakeId && wake?.status === 'completed'
        && wake.entityId === representative.identities.entityId && wake.decisionId === value.decisionId
    })
  })
  const order = (a: SimulationOperation, b: SimulationOperation) => (a.result?.sequence ?? state.decisions[a.decisionId]?.closedAt ?? 0)
    - (b.result?.sequence ?? state.decisions[b.decisionId]?.closedAt ?? 0) || a.id.localeCompare(b.id)
  return { representative, inquiry: inquiries.sort(order).at(-1), reply: replies.sort(order).at(-1) }
}
function historySequence(state: SimulationSnapshot, row: ExternalHistoryRow): number {
  if (row.type !== 'contact') return row.value.sequence
  const { inquiry, reply } = contactPosts(state, row.value)
  return Math.max(row.value.updatedSequence, ...[inquiry, reply].map(post => post === undefined ? 0
    : post.result?.sequence ?? state.decisions[post.decisionId]?.closedAt ?? 0))
}
function contactTime(state: SimulationSnapshot, contact: SimulationExternalContact, post: SimulationOperation | undefined): string {
  if (post?.result !== undefined) return post.result.time
  if (post !== undefined) return original(state.decisions[post.decisionId]).time
  const result = Object.values(ownedWorld(state).results).find(value => value.requestId === contact.requestId)
  if (result !== undefined) return result.time
  // A pending contact has no retained reservation time. Name its original request time, never the observation clock.
  const request = original(ownedWorld(state).requests[contact.requestId])
  return request.source.kind === 'authenticated-user' ? request.source.time
    : original(state.decisions[request.source.decisionId]).time
}
function interactionRow(state: SimulationSnapshot, identity: SimulationExternalIdentity, row: ExternalHistoryRow,
  policy: WorldReadProjectionPolicy): ExternalInteraction {
  const world = ownedWorld(state), value = row.value, request = original(world.requests[value.requestId])
  if (request.requesterEntityId === null) throw new Error('External interaction lost its original actor requester')
  if (row.type === 'rule') return { id: row.value.intentId, at: row.value.time,
    requester: label(state, request.requesterEntityId, policy), kind: 'rule', basis: policy.text(identity.policyRef),
    outcome: policy.text(row.value.result.availability.status), sampled: false,
    disclosure: disclosed(policy.case(value.requestId), policy.text(JSON.stringify(row.value.result))) }
  if (row.type === 'ruling') return { id: row.value.intentId, at: row.value.time,
    requester: label(state, request.requesterEntityId, policy), kind: 'director-ruling', basis: policy.text(identity.policyRef),
    outcome: policy.text(row.value.proposal.outcome.kind), sampled: false,
    disclosure: disclosed(policy.case(value.requestId), policy.text(JSON.stringify(row.value.actualPublication?.payload ?? {}))) }
  const contact = row.value, { inquiry, reply } = contactPosts(state, contact)
  return { id: contact.id, at: contactTime(state, contact, reply ?? inquiry),
    requester: label(state, contact.requesterEntityId, policy), kind: 'simulated-actor',
    basis: policy.text(`${identity.policyRef}; contact-request${reply === undefined ? '' : '; delivery-wake'}`),
    outcome: policy.text(`contact:${contact.status}; reply-post:${reply?.status ?? 'unobserved'}; publication:${reply?.outbox?.receipt === undefined
      ? 'unconfirmed' : 'published'}; delivery:${reply?.delivery?.receipt === undefined ? 'unconfirmed' : 'received'}`),
    sampled: false, disclosure: { state: 'not-applicable' } }
}
function interactionSources(state: SimulationSnapshot, row: ExternalHistoryRow): EngineRef[] {
  const request = original(ownedWorld(state).requests[row.value.requestId])
  const sources: EngineRef[] = [...caseSources(state, request), { kind: 'record', sequence: row.value.sequence }]
  if (row.type !== 'contact') return sources
  const contact = row.value, { representative, inquiry, reply } = contactPosts(state, contact)
  sources.push({ kind: 'record', sequence: contact.updatedSequence }, { kind: 'entity', id: representative.identities.entityId })
  for (const post of [inquiry, reply]) if (post !== undefined) sources.push(...operationSources(state, post.id)
    .filter(ref => ref.kind !== 'envelope' || ref.channelId === contact.channel.channelId))
  return unique(sources)
}
function identityRow(state: SimulationSnapshot, identity: SimulationExternalIdentity,
  policy: WorldReadProjectionPolicy): ExternalIdentityRow {
  const last = externalHistory(state, identity.id).at(-1)
  const latest = last === undefined ? undefined : interactionRow(state, identity, last, policy)
  return { key: identity.id, name: label(state, identity.subjectRef, policy), kind: sourceKind(identity.representation),
    generation: identity.revision,
    ...latest === undefined ? {} : { latest: { at: latest.at, summary: latest.outcome } } }
}
function obligationRef(state: SimulationSnapshot, item: PersonnelObligation, personId: string): EngineRef | undefined {
  const ref = item.ref
  switch (ref.kind) {
    case 'decision': return { kind: 'decision', id: ref.id }
    case 'operation': return { kind: 'operation', id: ref.id }
    case 'outbox': return { kind: 'operation', id: ref.operationId }
    case 'task-assignment': case 'task-execution': case 'task-target': case 'team-task': case 'team-attempt': case 'team-workspace':
      return { kind: 'team-task', id: ref.taskId, teamId: ref.teamId }
    case 'interaction': {
      const operationId = lookup(state.interactions, ref.id)?.createdBy
      return operationId === undefined ? undefined : { kind: 'operation', id: operationId }
    }
    case 'commitment': {
      const operationId = lookup(state.commitments, ref.id)?.createdBy
      return operationId === undefined ? undefined : { kind: 'operation', id: operationId }
    }
    case 'resource': {
      const owner = lookup(state.resources, ref.id)?.owner
      return owner === undefined ? undefined : { kind: 'entity', id: owner }
    }
    case 'resource-grant': {
      const operationId = lookup(state.grants, ref.id)?.operationId
      return operationId === undefined ? undefined : { kind: 'operation', id: operationId }
    }
    case 'wake': return ref.decisionId === null ? undefined : { kind: 'decision', id: ref.decisionId }
    case 'message': return { kind: 'operation', id: ref.operationId }
    case 'relation': return { kind: 'entity', id: ref.subject }
    case 'writer': return { kind: 'entity', id: ref.entityId }
    case 'world-reservation': case 'world-case': {
      const operationId = state.world?.requests[ref.requestId]?.operationId
      return operationId === undefined || operationId === null ? undefined : { kind: 'operation', id: operationId }
    }
    case 'channel-delivery': {
      const teamId = lookup(state.entities, personId)?.binding?.teamId
      return teamId === undefined ? undefined : { kind: 'envelope', id: ref.envelopeId, envelopeId: ref.envelopeId,
        teamId, channelId: ref.channelId, envelopeSequence: ref.sequence }
    }
    case 'scheduled-event': case 'team-activation': case 'team-startup': return undefined
    default: return assertNever(ref)
  }
}
function ownerObligations(state: SimulationSnapshot, report: PersonnelObligationReport, policy: WorldReadProjectionPolicy): Obligation[] {
  return report.items.map((item) => {
    const ref = obligationRef(state, item, report.selector.personId)
    return { id: JSON.stringify([item.owner, item.ref]), kind: 'owner-duty', label: policy.text(`${item.category}: ${item.state}`),
      owner: policy.text(item.owner.kind === 'native' ? `native/${item.owner.subsystem}` : item.owner.kind),
      state: item.dispositions.includes('handoff-required') ? 'handoff-required' : 'waiting', revision: report.cursor,
      ...ref === undefined ? {} : { ref }, original: { owner: item.owner, ref: item.ref, cursor: report.cursor },
      certainty: item.certainty, ownerState: item.state, dispositions: ['wait'] }
  })
}
function disclosed<T>(allowed: boolean, value: T): Disclosure<T> {
  return allowed ? { state: 'allowed', value } : { state: 'withheld' }
}

/**
 * Project exactly the selected bounded family; policy.page owns authenticated continuation and total envelope limits.
 * @param state - Validated detached Native prefix.
 * @param input - Exact original public selector.
 * @param policy - Current authenticated content policy and bounded window owner.
 * @returns finite public fields or explicit missing identity; no model, mutation, sampling or attachment runs.
 */
export function projectWorldDomain(state: SimulationSnapshot, input: SimulationProductWorldDomainInput,
  policy: WorldReadProjectionPolicy): WorldReadProjection {
  const world = state.world
  if (world === undefined) throw new Error('World domain read requires an original World')
  const empty = () => policy.page([], input.kind).coverage
  switch (input.kind) {
    case 'hiring-market': {
      const history = Object.values(world.results).filter(result => result.outcome.kind === 'committed'
        && BigInt(result.time) <= BigInt(policy.at)
        && world.intents[result.intentId]?.pin.implementationRef === WORLD_HIRING_MARKET_PIN.implementationRef)
        .sort((a, b) => a.sequence - b.sequence).flatMap((result) => {
          const value = simulationHiringMarketResultSchema.parse(result.payload)
          return 'kind' in value && value.kind === input.family ? [{ result, value }] : []
        })
      const latest = new Map(history.map(({ result, value }) => [value.id, result.sequence]))
      const page = policy.page(history, `hiring-market/${input.family}`)
      return { coverage: page.coverage, value: { runId: policy.runId, coverage: page.coverage,
        rows: page.items.map(({ result, value }) => ({ id: value.id, current: latest.get(value.id) === result.sequence,
          requestId: result.requestId, sequence: result.sequence,
          revision: 'revision' in value ? value.revision : 1, status: 'status' in value ? value.status : 'recorded',
          body: disclosed(policy.case(result.requestId) && (value.kind !== 'persona-draft' || policy.persona(result.requestId)),
            policy.text(JSON.stringify(value))),
          detail: disclosed(policy.case(result.requestId) && (value.kind !== 'persona-draft' || policy.persona(result.requestId)), value),
          sources: caseSources(state, original(world.requests[result.requestId])) })) } }
    }
    case 'organization': {
      const assignments = Object.values(state.relations).filter(value => value.relation === 'assignment' && active(value, policy.at))
      const parents = Object.values(state.relations).filter(value => value.relation === 'organization-parent' && active(value, policy.at))
      const nodeIds = new Set([world.definition.organizationEntityId, ...world.definition.positions.map(value => value.entityId),
        ...parents.flatMap(value => [value.subject, value.object])])
      const people = Object.values(state.entities).filter(value => value.kind === 'person').sort((a, b) => a.id.localeCompare(b.id))
      if (input.lens === 'structure') {
        const page = policy.page([...nodeIds].sort(), 'organization/structure')
        const selected = new Set(page.items)
        return { coverage: page.coverage, value: { runId: policy.runId, coverage: page.coverage, now: policy.at,
          tickUnit: state.spec.tickUnit, nodes: page.items.map((id) => {
            const position = world.definition.positions.find(value => value.entityId === id)
            const reserved = Object.values(world.reservations).filter(value => world.intents[value.id]?.targetEntityId === id
              && !['committed', 'abandoned'].includes(value.status)).length + Object.values(world.personnel.reservations)
              .filter(value => value.targetPositionId === id && !['committed', 'cancelled'].includes(value.status)).length
            return { id, kind: position === undefined ? 'unit' : 'position', name: label(state, id, policy),
              ...parents.find(value => value.subject === id) === undefined ? {}
                : { parentId: original(parents.find(value => value.subject === id)).object },
              ...position === undefined ? {} : { occupancy: { occupied: assignments.filter(value => value.object === id).length,
                reserved, capacity: position.capacity } } }
          }), edges: parents.filter(value => selected.has(value.subject) && selected.has(value.object))
            .map(value => ({ id: value.id, from: value.object, to: value.subject, kind: 'parent' })), people: [],
          range: { from: '0', until: policy.at }, unloadedNodes: nodeIds.size - page.items.length } }
      }
      const histories = people.flatMap(value => tenures(state, value.id, policy))
      const page = input.lens === 'people' ? policy.page(people, 'organization/people') : policy.page(histories, 'organization/timeline')
      const rows = input.lens === 'people' ? (page.items as readonly SimulationEntity[]).map(value => personRow(state, value, policy))
        : people.filter(value => page.items.some(item => 'personId' in item && item.personId === value.id)).map(value => ({
          ...personRow(state, value, policy), tenures: page.items.filter((item): item is Tenure => 'personId' in item
            && item.personId === value.id),
        }))
      return { coverage: page.coverage, value: { runId: policy.runId, coverage: page.coverage, now: policy.at,
        tickUnit: state.spec.tickUnit, nodes: [], edges: [], people: rows, range: { from: '0', until: policy.at }, unloadedNodes: 0 } }
    }
    case 'person': {
      const person = lookup(state.entities, input.personId)
      if (person?.kind !== 'person') return { coverage: empty() }
      const items = input.section === 'tenures' ? tenures(state, person.id, policy)
        : input.section === 'obligations' ? policy.personnel === undefined ? []
          : ownerObligations(state, policy.personnel, policy) : [person]
      const incomplete = input.section !== 'obligations' || policy.personnel?.complete === true ? false
        : policy.personnel?.coverage.team.kind === 'partial' && policy.personnel.coverage.team.reason === 'source-moved'
          ? 'source-moved' : 'unavailable'
      const page = policy.page<SimulationEntity | Tenure | Obligation>(items, `person/${input.section}`, incomplete)
      const birth = Object.values(world.reservations).find(value => value.identities.entityId === person.id)
      const selected = birth === undefined ? undefined : world.plans[birth.request.planId]?.proposal.resolution
      const selectedPersona = selected?.kind === 'apply' && selected.payload !== null && typeof selected.payload === 'object'
        && !Array.isArray(selected.payload) && 'persona' in selected.payload ? selected.payload['persona'] : undefined
      const allowed = birth !== undefined && world.intents[birth.id]?.requestId !== undefined
        && policy.persona(original(original(world.intents[birth.id]).requestId ?? undefined))
      return { coverage: page.coverage, value: { runId: policy.runId, personId: person.id, revision: person.revision,
        name: label(state, person.id, policy), employment: employment(state, person, policy.at), residency: residency(person,
          policy), entity: { kind: 'entity', id: person.id },
        ...person.binding === undefined ? {} : { participantId: person.binding.participantId, sessionId: person.binding.sessionId },
        persona: disclosed(allowed && selectedPersona !== undefined, { summary: policy.text(selectedPersona === undefined ? '' : JSON.stringify(selectedPersona)) }),
        tenures: input.section === 'tenures' ? page.items : [], obligations: input.section === 'obligations' ? page.items : [],
        actions: policy.actions?.(person.id) ?? [], sources: unique([{ kind: 'entity', id: person.id }, ...Object.values(world.requests).filter(value =>
          value.requesterEntityId === person.id || world.intents[value.intentId]?.targetEntityId === person.id
          || Object.values(world.personnel.reservations).some(reservation => reservation.personId === person.id
            && world.plans[reservation.request.planId]?.requestId === value.id)
          || Object.values(world.reservations).some(reservation => reservation.identities.entityId === person.id
            && world.plans[reservation.request.planId]?.requestId === value.id))
          .slice(0, policy.limit).flatMap(value => caseSources(state, value))]) } }
    }
    case 'governance': {
      if (input.lens === 'proposals') {
        const page = policy.page(Object.values(world.governance.proposals).filter(value => BigInt(value.time) <= BigInt(policy.at))
          .sort((a, b) => a.sequence - b.sequence), 'governance/proposals')
        return { coverage: page.coverage, value: { runId: policy.runId, coverage: page.coverage, now: policy.at,
          tickUnit: state.spec.tickUnit, proposals: page.items.map(value => proposalSummary(state, value, policy)), norms: [] } }
      }
      const norms = (input.lens === 'history' ? Object.values(world.norms.versions).flat().filter(value => normObserved(state, value, policy.at))
        : [...activeNorms(state, policy.at)])
        .sort((a, b) => a.sequence - b.sequence)
      const page = policy.page(norms, `governance/${input.lens}`)
      return { coverage: page.coverage, value: { runId: policy.runId, coverage: page.coverage, now: policy.at,
        tickUnit: state.spec.tickUnit, proposals: [], norms: page.items.map(value => normRow(state, value, policy)) } }
    }
    case 'proposal': {
      const proposal = lookup(world.governance.proposals, input.proposalId)
      if (proposal === undefined || BigInt(proposal.time) > BigInt(policy.at)) return { coverage: empty() }
      const votes = Object.values(world.governance.votes).filter(value => value.proposalId === proposal.id
        && BigInt(value.time) <= BigInt(policy.at))
      const rows = input.section === 'votes' ? proposal.electorate.filter(value => votes.some(vote => vote.voter === value.entityId))
        : input.section === 'electorate' ? proposal.electorate : proposal.electorate.slice(0, 1)
      const page = policy.page(rows, `proposal/${input.section}`), resolution = Object.values(world.governance.resolutions)
        .find(value => value.proposalId === proposal.id && BigInt(value.time) <= BigInt(policy.at))
      const source = Object.values(world.requests).find(value => value.operationId === proposal.source.operationId)
      const norm = Object.values(world.norms.versions).flat().find(value => value.origin === 'governance'
        && value.proposal.id === proposal.id
        && normObserved(state, value, policy.at))
      const allowed = policy.context(proposal.proposer, 'context') || source !== undefined && policy.case(source.id)
      const root = allowed ? Object.values(world.governance.routes ?? {}).find(value =>
        BigInt(value.time) <= BigInt(policy.at) && value.steps.some(step => step.proposalId === proposal.id)) : undefined
      const routeDefinition: ProposalDetailView['routeDefinition'] = root === undefined ? undefined : {
        id: root.id, hash: root.hash, bodyHash: root.bodyHash, mode: root.mode, deadline: root.deadline,
        steps: root.steps.map((step) => {
          const frozen = original(root.proposals.find(value => value.id === step.proposalId))
          const outcome = Object.values(world.governance.resolutions).find(value => value.proposalId === frozen.id
            && BigInt(value.time) <= BigInt(policy.at))
          return { id: step.id, proposalId: frozen.id, committeeId: frozen.committeeId, dependsOn: step.dependsOn,
            deadline: frozen.deadline, quorum: frozen.quorum, rule: frozen.rule,
            electorate: frozen.electorate.map(member => member.entityId), status: outcome?.outcome ?? 'pending',
            resolutionId: outcome?.id ?? null, resolutionHash: outcome?.hash ?? null }
        }) }
      let normImpact: ProposalDetailView['normImpact'], normImpactInput: ProposalDetailView['normImpactInput'],
        normImpactChoices: ProposalDetailView['normImpactChoices']
      if (input.section === 'impact') {
        if (input.at !== undefined && input.at !== state.time) throw new Error('Institution impact requires the current Native prefix')
        if (proposal.target.kind !== 'norm') throw new Error('Institution impact requires a normative proposal')
        const scopeAllowed = allowed && (policy.context(proposal.scopeId, 'knowledge')
          || policy.context(world.definition.directorEntityId, 'context'))
        if (!scopeAllowed) {
          normImpact = { state: 'withheld' }; normImpactInput = { state: 'withheld' }; normImpactChoices = { state: 'withheld' }
        }
        else {
          const previous = world.norms.versions[proposal.target.norm.id]?.at(-1)
          const draft = simulationNormImpactInputSchema.parse(input.normImpact ?? {
            normId: proposal.target.norm.id, scope: proposal.scopeId,
            effectiveFrom: state.time, effectiveUntil: null, enforcement: previous?.enforcement ?? { kind: 'advisory' }, impact: 'future-admissions' })
          if (draft.normId !== proposal.target.norm.id || draft.scope !== proposal.scopeId)
            throw new Error('Institution preview cannot substitute the original proposal scope or norm')
          if (draft.enforcement.kind === 'validated' && draft.enforcement.params.committeeId !== proposal.committeeId)
            throw new Error('Institution preview must retain its original approving committee')
          normImpactChoices = { state: 'allowed', value: { committeeId: proposal.committeeId,
            positionIds: world.definition.positions.map(position => position.entityId) } }
          normImpactInput = { state: 'allowed', value: draft }
          const report = projectNormImpact(state, draft)
          // A proposal disclosure never grants access to another private case or operational responsibility.
          const dutiesAllowed = report.existingObligations.every(duty => duty.kind === 'world-case'
            ? policy.case(duty.id) : policy.context(world.definition.directorEntityId, 'context'))
          normImpact = disclosed(dutiesAllowed, report)
        }
      }

      return { coverage: page.coverage, value: { ...proposalSummary(state, proposal, policy), runId: policy.runId,
        ...normImpact === undefined ? {} : { normImpact, normImpactInput, normImpactChoices },
        ...routeDefinition === undefined ? {} : { routeDefinition },
        version: String(proposal.revision), bodyHash: proposal.bodyHash, body: disclosed(allowed, policy.text(proposal.body)),
        ...!allowed || proposal.reviewRoute === undefined ? {} : { reviewRoute: { id: proposal.reviewRoute.id,
          revision: proposal.reviewRoute.revision, hash: proposal.reviewRoute.hash,
          mode: proposal.reviewRoute.mode, steps: proposal.reviewRoute.steps } },
        ...proposal.target.kind !== 'norm' ? {} : { targetNorm: proposal.target.norm }, frozenAt: proposal.time,
        electorateMembers: (input.section === 'record' || input.section === 'impact' ? [] : page.items).map((member) => {
          const vote = votes.find(value => value.voter === member.entityId)
          const delegation = vote?.delegationId === undefined ? undefined
            : world.governance.delegations?.find(value => value.id === vote.delegationId)
          return { ...delegation === undefined ? {} : { proxy: { delegateId: delegation.delegateId, delegationId: delegation.id } },
            personId: member.entityId, name: label(state, member.entityId, policy),
            ballot: vote?.choice === 'yes' ? 'for' : vote?.choice === 'no' ? 'against' : vote?.choice === 'abstain' ? 'abstain' : 'none',
            ...vote === undefined ? {} : { decision: { kind: 'decision', id: vote.source.decisionId },
              sources: operationSources(state, vote.source.operationId) },
            leftCommittee: !Object.values(state.relations).some(value => value.relation === 'committee-member'
              && value.subject === member.entityId && value.object === proposal.committeeId && active(value, policy.at)) }
        }), ...resolution === undefined ? {} : { resolution: { at: resolution.time, outcome: resolution.outcome } },
        enactment: { state: norm !== undefined ? 'enacted' : resolution?.outcome === 'passed' ? 'awaiting-request' : 'not-applicable',
          ...norm === undefined ? {} : { normVersion: { id: norm.id, version: norm.version } } },
        sources: unique([...operationSources(state, proposal.source.operationId), ...resolution === undefined ? []
          : [{ kind: 'record' as const, sequence: resolution.sequence }]]) } }
    }
    case 'norm': {
      let selected: unknown
      try { selected = JSON.parse(input.versionId) } catch { return { coverage: empty() } }
      if (!Array.isArray(selected) || selected.length !== 2
        || selected.some(value => typeof value !== 'string')) return { coverage: empty() }
      const norm = Object.values(world.norms.versions).flat().find(value => value.id === selected[0] && value.version === selected[1]
        && normObserved(state, value, policy.at))
      const page = policy.page(norm === undefined ? [] : [norm], 'norm/record')
      return { coverage: page.coverage, ...page.items[0] === undefined ? {} : { value: normRow(state, page.items[0], policy) } }
    }
    case 'external': {
      const page = policy.page(Object.values(world.external.identities).sort((a, b) => a.id.localeCompare(b.id)), 'external/identities')
      return { coverage: page.coverage, value: { runId: policy.runId, coverage: page.coverage,
        identities: page.items.map(value => identityRow(state, value, policy)) } }
    }
    case 'identity': {
      const identity = Object.values(world.external.identities).find(value => value.id === input.key)
      if (identity === undefined) return { coverage: empty() }
      const facts = Object.values(world.facts).flat().filter(value => value.subject === identity.subjectRef
        && BigInt(value.availableAt) <= BigInt(policy.at))
      const history = externalHistory(state, identity.id)
      const representatives = Object.values(world.external.representatives).filter(value => value.identityId === identity.id)
      const rows = input.section === 'facts' ? facts.map(value => ({ type: 'fact' as const, value }))
        : input.section === 'interactions' ? history
          : input.section === 'representatives' ? representatives.map(value => ({ type: 'representative' as const, value }))
            : [{ type: 'identity' as const, value: identity }]
      const page = policy.page<(typeof rows)[number]>(rows, `identity/${input.section}`), representative = representatives.at(-1)
      const interactions = page.items.flatMap(row => row.type === 'rule' || row.type === 'ruling' || row.type === 'contact'
        ? [interactionRow(state, identity, row, policy)] : [])
      const selectedSources = page.items.flatMap<EngineRef>((row) => {
        if (row.type === 'rule' || row.type === 'ruling' || row.type === 'contact') return interactionSources(state, row)
        if (row.type === 'representative') return [{ kind: 'entity', id: row.value.identities.entityId },
          { kind: 'record', sequence: row.value.updatedSequence }, ...caseSources(state, original(world.requests[row.value.requestId]))]
        if (row.type === 'fact') return [{ kind: 'record', sequence: row.value.sequence },
          ...row.value.source.references.map(value => ({ kind: 'record' as const, sequence: value.sequence }))]
        return []
      })
      return { coverage: page.coverage, value: { ...identityRow(state, identity, policy), runId: policy.runId,
        entity: { kind: 'entity', id: identity.subjectRef }, revision: identity.revision, expansion: policy.text(identity.representation),
        facts: page.items.flatMap(row => row.type !== 'fact' ? [] : [{ key: row.value.factId,
          value: policy.context(identity.subjectRef, 'knowledge') ? { state: 'known',
            text: policy.text(JSON.stringify(row.value.payload)) } : { state: 'unknown' },
          report: false }]),
        ...input.section !== 'representatives' ? {} : { representatives: page.items.flatMap(row => row.type !== 'representative' ? [] : [{
          entity: { kind: 'entity', id: row.value.identities.entityId }, person: label(state, row.value.identities.entityId, policy),
          participantId: row.value.identities.binding.participantId, sessionId: row.value.identities.binding.sessionId,
          ready: row.value.status === 'committed' ? 'ready' : row.value.status === 'abandoned' || row.value.status === 'cancel-requested'
            ? 'blocked' : 'preparing', steps: [],
        }]) },
        ...representative === undefined ? {} : { representative: { person: label(state, representative.identities.entityId, policy),
          participantId: representative.identities.binding.participantId, sessionId: representative.identities.binding.sessionId,
          ready: representative.status === 'committed' ? 'ready' : representative.status === 'cancel-requested'
            || representative.status === 'abandoned'
            ? 'blocked' : 'preparing', steps: [] } }, interactions,
        sources: unique([{ kind: 'entity', id: identity.subjectRef }, { kind: 'record', sequence: identity.sequence },
          ...selectedSources]) } }
    }
    case 'case-extensions': {
      const rows = input.requestIds.flatMap((id) => { const request = lookup(world.requests,
        id); return request === undefined ? [] : [request] })
      const page = policy.page(rows, 'case-extensions')
      const value: WorldCaseExtension[] = page.items.map((request) => {
        const intent = original(world.intents[request.intentId]), summary = worldCaseSummary(request, state), planId = request.plans.at(-1)
        const observation = planId === undefined ? undefined : world.executions[planId]
        const challenge = worldCaseEvidence(request, state, world.evidence, value => policy.text(value), false).latestChallenge
        return { requestId: request.id, domain: intent.pin.domain, operation: intent.pin.operation,
          businessSummary: policy.businessSummary?.(request.id) ?? { status: 'unsupported' },
          businessKey: disclosed(policy.case(request.id), policy.text(intent.businessKey)),
          target: policy.text(intent.targetEntityId), tracks: [],
          ...challenge === undefined || request.status !== 'awaiting-evidence' ? {} : { evidence: {
            fields: challenge.fields.map(field => field.code), responders: challenge.responders.map(id => label(state, id, policy)),
            deadline: challenge.deadline, remainingAttempts: challenge.maxAttempts - challenge.attemptsUsed,
            revisions: Object.values(world.evidence.revisions).filter(value => value.requestId === request.id)
              .sort((a, b) => a.revision - b.revision).map(value => ({ at: value.time, summary: policy.text(`r${value.revision}`) })),
          } },
          sources: caseSources(state, request), ...observation?.phase !== 'blocked' ? {} : { mutation: {
            phase: 'retained', blocked: observation.reason, cancelRequested: summary.status === 'cancel-requested' } } }
      })
      return { coverage: page.coverage, value }
    }
    case 'overview': {
      const pending = Object.values(state.scheduledEvents).filter(value => value.status === 'pending').sort((a, b) =>
        BigInt(a.key.time) < BigInt(b.key.time) ? -1 : BigInt(a.key.time) > BigInt(b.key.time) ? 1 : a.id.localeCompare(b.id))
      const page = policy.page(pending, 'overview/upcoming')
      const observations = Object.values(world.executions), norms = Object.values(world.norms.versions).flat()
      const identities = Object.values(world.external.identities), byKind: Partial<Record<SourceKind, number>> = {}
      for (const identity of identities) { const kind = sourceKind(identity.representation); byKind[kind] = (byKind[kind] ?? 0) + 1 }
      return { coverage: page.coverage, value: { runId: policy.runId, revision: state.revision, now: policy.at,
        tickUnit: state.spec.tickUnit,
        attention: { handoffRequired: observations.filter(value => value.reason === 'handoff-required').length,
          outcomeUnknown: observations.filter(value => value.phase === 'armed' || value.phase === 'outcome-unknown').length,
          retirementUnconfirmed: observations.filter(value => value.reason === 'retirement-unknown').length,
          implementationMissing: observations.filter(value => value.reason === 'implementation-unavailable').length,
          evidenceRequired: Object.values(world.requests).filter(value => value.status === 'awaiting-evidence').length },
        calendars: page.items.flatMap((event) => {
          if (event.action.kind !== 'world-calendar' || event.action.source.kind !== 'calendar') return []
          const source = event.action.source, saved = state.worldBootstrap?.calendarRevisions?.find(value =>
            value.request.calendar.id === source.id && value.revision === source.revision)
          const calendar = saved?.request.calendar
            ?? state.worldBootstrap?.request.data.behavior.calendars.find(value => value.id === source.id)
          if (calendar === undefined) return []
          const permitted = policy.context(world.definition.organizationEntityId, 'knowledge') || policy.context(world.definition.directorEntityId, 'context')
          return [{ ...calendar, ruleRevision: source.revision ?? 1, body: disclosed(permitted, policy.text(calendar.body)) }]
        }),
        upcoming: page.items.map(value => ({ at: value.key.time, label: policy.text(value.action.kind) })), proposals: [],
        norms: { active: activeNorms(state, policy.at).length,
          knownNotEffective: norms.filter(value => BigInt(value.availableAt) <= BigInt(policy.at)
            && BigInt(value.effectiveFrom) > BigInt(policy.at)).length },
        external: { identities: identities.length, byKind },
        caseFlow: [...new Set(Object.values(world.requests).map(value => value.status))]
          .map(status => ({ status, count: Object.values(world.requests).filter(value => value.status === status).length })) } }
    }
    default: return assertNever(input)
  }
}
function assertNever(value: never): never { throw new Error(`Unknown World read kind: ${JSON.stringify(value)}`) }
