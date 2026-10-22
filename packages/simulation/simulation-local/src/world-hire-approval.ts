import { currentWorldOperationGrants, SimulationWorldError } from '@clocky/clocky-simulation'
/** Exact single-hire approval enforcement over immutable Native requests, committee receipts and current Norms. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { businessFingerprint } from './business.ts'
import { frozenCommitteeProposalPolicies } from './world-norm-bootstrap.ts'
import { SimulationHireApprovalError, simulationHireApprovalTargetSchema, simulationHireApprovalProposalInputSchema,
  simulationHireApprovalBasisSchema, hireApprovalBody, effectiveNorms, WORLD_GOVERNANCE_HIRE_APPROVAL_DEFINITION,
  WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, simulationGovernanceAcknowledgeSchema, simulationWorldHirePayloadSchema,
  simulationWorldHirePlanPayloadSchema, simulationWorldHireExistingPayloadSchema, WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN, simulationWorldReadSetSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationHireApprovalTarget, SimulationHireApprovalBasis, SimulationEntityId,
  SimulationWorldIntent, SimulationWorldPlan, SimulationWorldDomainRequest, SimulationWorldBusinessResolution,
  SimulationWorldJsonValue, NativeWorldDomain } from '@clocky/clocky-simulation'

function lookup<T>(values: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(values, id) ? values[id] : undefined
}
function deny(code: SimulationHireApprovalError['code'], message: string): never {
  throw new SimulationHireApprovalError(code, message)
}
function world(state: SimulationSnapshot) {
  if (state.world === undefined) deny('SIM_HIRE_APPROVAL_INVALID', 'Hiring approval requires its configured Native World')
  return state.world
}

/**
 * Check current hard policy before creating a hiring request; case-specific approval follows its accepted identity.
 * @param state - Authoritative Native state, regardless of a policy's audience or announcement time.
 * @param scope - Original hiring organization.
 * @param position - Requested hiring position.
 */
export function assertHiringRequestPolicy(state: SimulationSnapshot, scope: SimulationEntityId, position: SimulationEntityId): void {
  if (effectiveNorms(state, scope, state.time, state.revision).some(value => value.enforcement.kind === 'validated'
    && !value.enforcement.params.positionIds.includes(position)))
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Hiring request is outside current authoritative policy')
}

/**
 * Validate proposed approval metadata against the actual retained hiring case and current authoritative policy.
 * @param state - Current Native state; availability and audience cannot hide an effective hard policy.
 * @param target - Strict original request, fixed norm version and bounded finite selection.
 * @param committeeId - Actual proposed committee whose independent members Native freezes.
 * @param scopeId - Actual approval scope, compared with both the original hire and enforced policy.
 * @returns validated target; no vote, money or authorization conclusion is created.
 */
export function validateHireApprovalTarget(state: SimulationSnapshot, target: SimulationHireApprovalTarget,
  committeeId: SimulationEntityId, scopeId: SimulationEntityId): SimulationHireApprovalTarget {
  const parsed = simulationHireApprovalTargetSchema.parse(target), owned = world(state)
  const intent = lookup(owned.intents, parsed.intentId), request = lookup(owned.requests, parsed.requestId)
  if (intent === undefined || request === undefined || intent.requestId !== request.id || request.intentId !== intent.id
    || request.payloadHash !== parsed.requestHash || intent.scopeEntityId !== scopeId || parsed.scopeId !== scopeId
    || intent.pin.domain !== 'organization' || !['generate-and-hire', 'hire-existing'].includes(intent.pin.operation) || intent.pin.version !== '1'
    || request.status !== 'open') {
    deny('SIM_HIRE_APPROVAL_INVALID', 'Approval must refer to one exact original open hiring request and scope')
  }
  const hired = intent.pin.operation === 'hire-existing' ? simulationWorldHireExistingPayloadSchema.parse(intent.payload)
    : simulationWorldHirePayloadSchema.parse(intent.payload)
  if (hired.organizationEntityId !== scopeId || hired.positionEntityId !== parsed.positionId) {
    deny('SIM_HIRE_APPROVAL_INVALID', 'Approval differs from its original hiring position or organization')
  }
  const policy = effectiveNorms(state, scopeId, state.time, state.revision).find(value =>
    value.id === parsed.norm.id && value.version === parsed.norm.version)
  if (policy?.enforcement.kind !== 'validated') {
    deny('SIM_HIRE_APPROVAL_STALE', 'Approval requires its exact current validated hiring policy version')
  }
  if (policy.enforcement.params.committeeId !== committeeId || !policy.enforcement.params.positionIds.includes(parsed.positionId)) {
    deny('SIM_HIRE_APPROVAL_INVALID', 'Approval committee and position must match the current hiring policy')
  }
  if (parsed.quantity > policy.enforcement.params.maxHires) {
    deny('SIM_HIRE_APPROVAL_LIMIT', 'Approved hiring quantity exceeds its current committee policy allowance')
  }
  const selection = parsed.selection
  if (selection.kind === 'existing-person') {
    const person = lookup(state.entities, selection.personId)
    if (intent.pin.operation !== 'hire-existing' || !('personId' in hired) || hired.personId !== selection.personId
      || person?.kind !== 'person' || person.cognition !== 'agent' || person.phase !== 'active'
      || person.readiness !== 'ready' || person.revision !== selection.entityRevision
      || businessFingerprint(person.profile) !== selection.profileHash) {
      deny('SIM_HIRE_APPROVAL_SELECTION', 'Approval must retain its exact existing person revision and original profile')
    }
  } else {
    const template = owned.definition.templates.find(value => value.id === selection.templateId
      && value.version === selection.templateVersion)
    if (intent.pin.operation !== 'generate-and-hire' || template === undefined
      || selection.names.some(value => !template.names.includes(value))
      || (['skills', 'traits', 'goals'] as const).some(key => selection[key].some(value => !template[key].includes(value)))) {
      deny('SIM_HIRE_APPROVAL_SELECTION', 'Approval must select only values from its original installed finite Persona template')
    }
  }
  return parsed
}

/**
 * Enforce every current validated hiring policy and retain the exact single-case resolution basis.
 * @param state - Actual Native state at reserve or commit, independently revalidated at both operations.
 * @param intent - Exact original hiring business identity.
 * @param plan - Actual accepted finite hiring plan; another request's plan cannot consume approval.
 * @param reserved - Original reservation proof at commit; omission denotes the first reserve admission.
 * @returns all required passed approvals in deterministic norm order, or an empty list for an unregulated hire.
 */
export function requireHireApproval(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan,
  reserved?: readonly SimulationHireApprovalBasis[]): readonly SimulationHireApprovalBasis[] {
  const owned = world(state), request = intent.requestId === undefined ? undefined : lookup(owned.requests, intent.requestId)
  if (!isDeepStrictEqual(intent.pin, WORLD_GENERATE_AND_HIRE_PIN) && !isDeepStrictEqual(intent.pin, WORLD_HIRE_EXISTING_PIN)) {
    deny('SIM_HIRE_APPROVAL_INVALID', 'Approval enforcement requires its exact installed hiring operation')
  }
  if (!isDeepStrictEqual(lookup(owned.intents, intent.id), intent) || request?.intentId !== intent.id
    || !isDeepStrictEqual(lookup(owned.plans, plan.id), plan) || plan.requestId !== request.id || plan.status !== 'accepted'
    || plan.proposal.resolution.kind !== 'apply') {
    deny('SIM_HIRE_APPROVAL_INVALID', 'Hiring enforcement requires its exact original accepted case and plan')
  }
  const existing = intent.pin.domain === 'organization' && intent.pin.operation === 'hire-existing' && intent.pin.version === '1'
  const requested = existing ? simulationWorldHireExistingPayloadSchema.parse(intent.payload)
    : simulationWorldHirePayloadSchema.parse(intent.payload)
  const selected = existing ? undefined : simulationWorldHirePlanPayloadSchema.parse(plan.proposal.resolution.payload)
  const policies = effectiveNorms(state, intent.scopeEntityId, state.time, state.revision)
    .filter(value => value.enforcement.kind === 'validated')
    .sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1)
  if (reserved !== undefined && !isDeepStrictEqual(reserved.map(value => value.norm),
    policies.map(value => ({ id: value.id, version: value.version })))) {
    deny('SIM_HIRE_APPROVAL_STALE', 'Hiring commit lost its original set of effective policy versions')
  }
  const proofs: SimulationHireApprovalBasis[] = []
  for (const policy of policies) {
    if (policy.enforcement.kind !== 'validated') {
      deny('SIM_HIRE_APPROVAL_INVALID', 'Effective validated policy lacks its installed hiring admission checker')
    }
    if (!policy.enforcement.params.positionIds.includes(requested.positionEntityId)) {
      deny('SIM_HIRE_APPROVAL_INVALID', 'Hiring position is outside the authoritative policy allowlist')
    }
    const candidates = Object.values(owned.governance.proposals).filter(value => value.target.kind === 'hire-approval'
      && value.target.approval.intentId === intent.id).sort((a, b) => a.sequence - b.sequence)
    const proposal = candidates.find(value => value.target.kind === 'hire-approval'
      && isDeepStrictEqual(value.target.approval.norm, { id: policy.id, version: policy.version })
      && Object.values(owned.governance.resolutions).some(resolution => resolution.proposalId === value.id
        && resolution.outcome === 'passed'))
    if (proposal?.target.kind !== 'hire-approval') {
      const old = candidates.some(value => value.target.kind === 'hire-approval' && value.target.approval.norm.id === policy.id
        && value.target.approval.norm.version !== policy.version)
      deny(old ? 'SIM_HIRE_APPROVAL_STALE' : 'SIM_HIRE_APPROVAL_REQUIRED', 'Hiring requires its original committee approval under the current policy')
    }
    const approved = validateHireApprovalTarget(state, proposal.target.approval, proposal.committeeId, proposal.scopeId)
    const resolution = Object.values(owned.governance.resolutions).find(value => value.proposalId === proposal.id)
    if (resolution?.outcome !== 'passed' || resolution.bodyHash !== proposal.bodyHash || resolution.proposalRevision !== proposal.revision
      || proposal.body !== hireApprovalBody(approved) || approved.requestId !== request.id
      || approved.requestHash !== request.payloadHash) {
      deny('SIM_HIRE_APPROVAL_INVALID', 'Hiring approval lost its same-case original document and passed independent resolution')
    }
    const selection = approved.selection
    if (existing) {
      if (selection.kind !== 'existing-person' || !isDeepStrictEqual(plan.proposal.resolution.payload, intent.payload)) {
        deny('SIM_HIRE_APPROVAL_SELECTION', 'Existing hire must preserve the committee-approved original person and request')
      }
    } else if (selection.kind !== 'finite-template' || selected === undefined
      || selected.templateId !== selection.templateId || selected.templateVersion !== selection.templateVersion
      || !selection.names.includes(selected.persona.name)
      || (['skills', 'traits', 'goals'] as const).some(key => selected.persona[key].some(value => !selection[key].includes(value)))) {
      deny('SIM_HIRE_APPROVAL_SELECTION', 'Actual hiring Persona differs from the committee-approved finite selection')
    }
    proofs.push(simulationHireApprovalBasisSchema.parse({ proposalId: proposal.id, proposalHash: proposal.bodyHash,
      resolutionId: resolution.id, resolutionHash: resolution.hash, norm: { id: policy.id, version: policy.version } }))
  }
  if (reserved !== undefined && !isDeepStrictEqual(reserved, proofs)) {
    deny('SIM_HIRE_APPROVAL_STALE', 'Hiring commit must retain the same original enforced norm and approval basis as its reservation')
  }
  return proofs
}

function originalProposal(state: SimulationSnapshot, intent: SimulationWorldIntent) {
  const owned = world(state), request = intent.requestId === undefined ? undefined : lookup(owned.requests, intent.requestId)
  const proposal = request === undefined ? undefined : Object.values(owned.governance.proposals)
    .find(value => value.source.operationId === request.operationId)
  if (proposal?.target.kind !== 'hire-approval' || proposal.proposer !== intent.requesterEntityId
    || !isDeepStrictEqual(simulationHireApprovalProposalInputSchema.parse(intent.payload),
      simulationHireApprovalProposalInputSchema.parse(request?.proposal.payload))) {
    deny('SIM_HIRE_APPROVAL_INVALID', 'Approval acknowledgement requires its exact original accepted proposal')
  }
  return proposal
}

/** Pure installed single-hire approval proposal logic; existing independent votes and deterministic close remain authoritative. */
export class HireApprovalNativeWorldDomain implements NativeWorldDomain {
  personnelSubjects(intent: SimulationWorldIntent): readonly SimulationEntityId[] {
    const { selection } = simulationHireApprovalProposalInputSchema.parse(intent.payload).target.approval
    return selection.kind === 'existing-person' ? [selection.personId] : []
  }

  readonly definition = WORLD_GOVERNANCE_HIRE_APPROVAL_DEFINITION
  readonly ref = WORLD_GOVERNANCE_HIRE_APPROVAL_PIN.implementationRef
  readonly generation = WORLD_GOVERNANCE_HIRE_APPROVAL_PIN.generation
  /** Closed Native proposal acceptance freezes members from actual current committee relations. */
  readonly acceptedResponsibility = 'governance-proposal' as const

  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    if (request.expectedTime !== null || request.evidence.length !== 0) {
      deny('SIM_HIRE_APPROVAL_INVALID', 'Approval proposal is admitted at its actual decision boundary without supplemental authority claims')
    }
    const payload = simulationHireApprovalProposalInputSchema.parse(request.payload)
    const owned = world(state)
    const originalIntent = Object.values(owned.intents).find(value => value.pin.domain === request.domain
      && value.pin.operation === request.operation && value.pin.version === request.version && value.businessKey === request.businessKey)
    if (originalIntent?.requestId !== undefined) {
      const original = originalProposal(state, originalIntent)
      if (original.proposer !== actorId || !isDeepStrictEqual(originalIntent.payload, z.json().parse(payload))) {
        deny('SIM_HIRE_APPROVAL_INVALID', 'Approval acknowledgement differs from its original requester or content')
      }
      return { scopeEntityId: original.scopeId, targetEntityId: original.committeeId,
        description: original.body, payload: z.json().parse(payload) }
    }
    const target = validateHireApprovalTarget(state, payload.target.approval, payload.committeeId, payload.scopeId)
    if (payload.body !== hireApprovalBody(target)) deny('SIM_HIRE_APPROVAL_INVALID', 'Approval document must contain its complete exact single-hire purpose')
    return { scopeEntityId: payload.scopeId, targetEntityId: payload.committeeId,
      description: payload.body, payload: z.json().parse(payload) }
  }

  goalContext(state: SimulationSnapshot, actorId: SimulationEntityId) {
    const owned = world(state), grants = currentWorldOperationGrants(state, actorId, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN)
      .map(({ grant }) => grant)
    const opportunities = grants.flatMap(grant => effectiveNorms(state, grant.scopeEntityId, state.time, state.revision)
      .filter(value => value.enforcement.kind === 'validated' && value.enforcement.params.committeeId === grant.targetEntityId)
      .flatMap((norm) => {
        if (norm.enforcement.kind !== 'validated') return []
        const enforcement = norm.enforcement
        const members = Object.values(state.relations).filter(value => value.relation === 'committee-member'
          && value.scope === grant.scopeEntityId && value.object === grant.targetEntityId && BigInt(value.validFrom) <= BigInt(state.time)
          && (value.validUntil === null || BigInt(state.time) < BigInt(value.validUntil))).map(value => value.subject)
        return Object.values(owned.requests).filter(value => value.status === 'open' && value.pin.domain === 'organization'
          && ['generate-and-hire', 'hire-existing'].includes(value.pin.operation) && value.pin.version === '1')
          .flatMap((request) => {
            const intent = lookup(owned.intents, request.intentId)
            if (intent?.scopeEntityId !== grant.scopeEntityId) return []
            const existing = intent.pin.operation === 'hire-existing'
            const requested = existing ? simulationWorldHireExistingPayloadSchema.parse(intent.payload)
              : simulationWorldHirePayloadSchema.parse(intent.payload)
            if (!enforcement.params.positionIds.includes(requested.positionEntityId)) return []
            const candidate = 'personId' in requested ? lookup(state.entities, requested.personId) : undefined
            const selections = existing ? candidate === undefined ? [] : [{ kind: 'existing-person' as const,
              personId: candidate.id, entityRevision: candidate.revision, profileHash: businessFingerprint(candidate.profile) }]
              : owned.definition.templates.map(template => ({ kind: 'finite-template' as const,
                templateId: template.id, templateVersion: template.version, names: template.names,
                skills: template.skills, traits: template.traits, goals: template.goals }))
            return selections.map(selection => ({ committeeId: grant.targetEntityId, scopeId: grant.scopeEntityId,
              committeeMembers: members, target: simulationHireApprovalTargetSchema.parse({ intentId: intent.id,
                requestId: request.id, requestHash: request.payloadHash, scopeId: intent.scopeEntityId,
                positionId: requested.positionEntityId, norm: { id: norm.id, version: norm.version }, quantity: 1,
                selection }) }))
          })
      }))
    return z.json().parse({ kind: 'hire-approval-opportunities', opportunities,
      committees: frozenCommitteeProposalPolicies(state, actorId, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN) })
  }

  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    return z.json().parse({ proposal: originalProposal(state, intent) })
  }

  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    originalProposal(state, intent)
    if (resolution.kind === 'apply') simulationGovernanceAcknowledgeSchema.parse(resolution.payload)
  }

  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const proposal = originalProposal(state, intent)
    return simulationWorldReadSetSchema.parse([{ kind: 'proposal', id: proposal.id, hash: proposal.bodyHash }])
  }

  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    if (plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(payload, plan.proposal.resolution.payload)) {
      deny('SIM_HIRE_APPROVAL_INVALID', 'Approval acknowledgement must preserve its original accepted apply payload')
    }
    simulationGovernanceAcknowledgeSchema.parse(payload)
    return { changes: [], resultPayload: z.json().parse({ proposalId: originalProposal(state, intent).id }) }
  }
}
