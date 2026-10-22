/** Strict browser-safe governance records; Native derives identity and determines outcomes. */
import { z } from 'zod'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simulationDecisionIdSchema, simulationOperationIdSchema } from './business.ts'
import { simulationEntityBindingSchema, simulationWriterEpochSchema } from './writer.ts'
import { simulationEventIdSchema } from './event-identities.ts'
import { simTimeSchema } from './time.ts'
import { worldNormIdSchema, worldProposalIdSchema, worldResolutionIdSchema } from './world-domain.ts'
import type { WorldVoteId } from './world-governance-types.ts'
import type { SimulationGovernanceProposal, SimulationGovernanceVote, SimulationGovernanceState } from './world-governance-types.ts'
import type { SimulationSnapshot } from './types.ts'
import type { WorldProposalId } from './world-domain-types.ts'
import { simulationHireApprovalTargetSchema } from './world-hire-approval.ts'
import type { WorldNormVersion } from './world-norms-types.ts'

const text = z.string().min(1)
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
/** Original one-person/one-proposal vote identity assigned by Native. */
export const worldVoteIdSchema = text.transform(value => value as WorldVoteId)
/** Fixed installed deterministic voting semantics; versions never change an accepted proposal. */
export const simulationGovernanceRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unanimity') }),
  z.strictObject({ kind: z.literal('absolute-threshold'), yes: revision }),
])
/** Closed proposal purpose; enacting an institution and approving one original hire are separate outcomes. */
export const simulationGovernanceTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('norm'), norm: z.strictObject({ id: worldNormIdSchema,
    version: z.string().regex(/^[1-9][0-9]*$/).transform(value => value as WorldNormVersion) }) }),
  z.strictObject({ kind: z.literal('hire-approval'), approval: simulationHireApprovalTargetSchema }),
])
/** Frozen combination of original committee decisions; step references never follow replacement proposals. */
export const simulationReviewRouteSchema = z.strictObject({ id: text.max(256), revision, hash, definitionHash: hash,
  mode: z.enum(['and', 'or', 'ordered']), bodyHash: hash,
  membershipPolicy: z.literal('frozen'), deadline: simTimeSchema,
  steps: z.array(z.strictObject({ id: text.max(256), proposalId: worldProposalIdSchema,
    resolutionId: worldResolutionIdSchema.nullable(), resolutionHash: hash.nullable(),
    dependsOn: z.array(text.max(256)).max(32) })).min(1).max(32),
}).superRefine((route, ctx) => {
  if (route.steps.some(step => (step.resolutionId === null) !== (step.resolutionHash === null)))
    ctx.addIssue({ code: 'custom', message: 'A route resolution reference must be complete or explicitly pending' })
  const ids = new Set(route.steps.map(step => step.id))
  if (ids.size !== route.steps.length || new Set(route.steps.map(step => step.proposalId)).size !== route.steps.length)
    ctx.addIssue({ code: 'custom', message: 'Review route steps and proposals must be distinct' })
  const visited = new Set<string>(), active = new Set<string>()
  function visit(id: string): boolean {
    if (active.has(id) || !ids.has(id)) return false
    if (visited.has(id)) return true
    active.add(id)
    const step = route.steps.find(value => value.id === id)
    if (step === undefined || new Set(step.dependsOn).size !== step.dependsOn.length || !step.dependsOn.every(visit)) return false
    active.delete(id); visited.add(id); return true
  }
  if (!route.steps.every(step => visit(step.id))) ctx.addIssue({ code: 'custom', message: 'Review route has missing steps or cyclic dependencies' })
})
const proposalInputFields = {
  reviewRoute: simulationReviewRouteSchema.optional(),
  committeeId: simulationEntityIdSchema,
  scopeId: simulationEntityIdSchema,
  body: text,
  target: simulationGovernanceTargetSchema,
  policyRef: z.literal('clocky.governance/1'),
  rule: simulationGovernanceRuleSchema,
  quorum: revision,
  deadline: simTimeSchema,
}
/** Model-proposed body excludes an electorate, proposer, hash, epoch and authorization conclusion. */
export const simulationGovernanceProposalInputSchema = z.strictObject(proposalInputFields)
/** Original normative proposal; single-hire approvals require their separately installed operation. */
export const simulationGovernanceNormProposalInputSchema = simulationGovernanceProposalInputSchema.extend({
  target: z.strictObject({ kind: z.literal('norm'), norm: z.strictObject({ id: worldNormIdSchema,
    version: z.string().regex(/^[1-9][0-9]*$/).transform(value => value as WorldNormVersion) }) }),
})
/** Exact frozen version and original text reference required in a vote. */
export const simulationGovernanceProposalRefSchema = z.strictObject({ proposalId: worldProposalIdSchema,
  proposalRevision: revision, bodyHash: hash })
/** Exact original proposal text retained inside the consumed world-context JSON block. */
export const simulationGovernanceProposalMaterialSchema = z.strictObject({ kind: z.literal('governance-proposal'),
  ...simulationGovernanceProposalRefSchema.shape, ...proposalInputFields,
  electorate: z.array(simulationEntityIdSchema).min(1) })

/**
 * Project the frozen document into independently selected voter material.
 * @param proposal - Authoritative immutable proposal permitted for this reader.
 * @returns exact original reference and text; no vote or permission conclusion is implied.
 */
export function governanceProposalMaterial(proposal: SimulationGovernanceProposal):
z.infer<typeof simulationGovernanceProposalMaterialSchema> {
  return { ...proposal.reviewRoute === undefined ? {} : { reviewRoute: proposal.reviewRoute }, kind: 'governance-proposal', proposalId: proposal.id, proposalRevision: proposal.revision,
    bodyHash: proposal.bodyHash, body: proposal.body, target: proposal.target, committeeId: proposal.committeeId,
    scopeId: proposal.scopeId, policyRef: proposal.policyRef, rule: proposal.rule, quorum: proposal.quorum,
    deadline: proposal.deadline, electorate: proposal.electorate.map(value => value.entityId) }
}
/** Native source of an independent contribution, never accepted from model arguments. */
export const simulationGovernanceDecisionSourceSchema = z.strictObject({
  decisionId: simulationDecisionIdSchema,
  operationId: simulationOperationIdSchema,
  epoch: simulationWriterEpochSchema,
  binding: simulationEntityBindingSchema,
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  inputId: text,
})
/** Original body, electorate and rules at proposal admission. */
export const simulationGovernanceProposalSchema = z.strictObject({ ...proposalInputFields,
  id: worldProposalIdSchema, revision: z.literal(1), bodyHash: hash,
  proposer: simulationEntityIdSchema, source: simulationGovernanceDecisionSourceSchema,
  electorate: z.array(z.strictObject({ entityId: simulationEntityIdSchema,
    binding: simulationEntityBindingSchema,
    membership: z.strictObject({ id: simulationRelationIdSchema, revision,
      validFrom: simTimeSchema, validUntil: simTimeSchema.nullable() })
      .refine(value => value.validUntil === null || BigInt(value.validUntil) > BigInt(value.validFrom),
        'Committee membership must have a nonempty half-open interval'),
  })).min(1).refine(values => new Set(values.map(value => value.entityId)).size === values.length,
    'Committee electorate must contain distinct actors'),
  time: simTimeSchema, sequence: revision,
}).refine(value => value.quorum <= value.electorate.length
  && (value.rule.kind !== 'absolute-threshold' || value.rule.yes <= value.electorate.length),
'Voting quorum and threshold must be attainable by the frozen electorate')
/** One immutable choice; changing text or choice requires a new proposal. */
export const simulationGovernanceVoteInputSchema = z.strictObject({
  ...simulationGovernanceProposalRefSchema.shape, choice: z.enum(['yes', 'no', 'abstain']),
  delegationId: text.optional(),
})
/** A principal can explicitly grant or revoke one exact proposal's ballot authority. */
export const simulationGovernanceDelegationInputSchema = z.strictObject({ ...simulationGovernanceProposalRefSchema.shape,
  delegateId: simulationEntityIdSchema, expiresAt: simTimeSchema, revoked: z.boolean() })
/** Native derives principal and source from an independent accepted decision, preserving revocation history. */
export const simulationGovernanceDelegationSchema = z.strictObject({ ...simulationGovernanceDelegationInputSchema.shape,
  id: text, principal: simulationEntityIdSchema, source: simulationGovernanceDecisionSourceSchema,
  time: simTimeSchema, sequence: revision, hash })
/** Actual actor and canonical Session source retained at accepted vote admission. */
export const simulationGovernanceVoteSchema = z.strictObject({ ...simulationGovernanceVoteInputSchema.shape,
  id: worldVoteIdSchema, voter: simulationEntityIdSchema, source: simulationGovernanceDecisionSourceSchema,
  time: simTimeSchema, sequence: revision, hash,
})
/** Sole computed resolution and its exact pending wake identity; enactment is a separate mutation. */
export const simulationGovernanceResolutionSchema = z.strictObject({
  ...simulationGovernanceProposalRefSchema.shape,
  id: worldResolutionIdSchema,
  outcome: z.enum(['passed', 'failed']),
  closure: z.enum(['all-voted', 'determined', 'deadline']),
  votes: z.array(z.strictObject({ id: worldVoteIdSchema, hash })),
  counts: z.strictObject({ yes: z.number().int().nonnegative(), no: z.number().int().nonnegative(),
    abstain: z.number().int().nonnegative(), missing: z.number().int().nonnegative() }),
  wakeId: simulationEventIdSchema,
  time: simTimeSchema, sequence: revision, hash,
})

/**
 * Compute the fixed governance rule from original independently accepted ballots.
 * @param proposal - Native-frozen rule, quorum and electorate; membership changes cannot alter these values.
 * @param votes - Canonical distinct ballots for this proposal, already validated by their Native owner.
 * @returns exact counts, current outcome and an early closure only when remaining legal votes cannot change it.
 */
export function governanceVoteTally(proposal: Pick<SimulationGovernanceProposal, 'rule' | 'quorum' | 'electorate'>,
  votes: readonly Pick<SimulationGovernanceVote, 'choice'>[]): {
  readonly counts: { readonly yes: number; readonly no: number; readonly abstain: number; readonly missing: number }
  readonly outcome: 'passed' | 'failed'
  readonly earlyClosure: 'all-voted' | 'determined' | undefined
} {
  const counts = { yes: 0, no: 0, abstain: 0, missing: proposal.electorate.length - votes.length }
  for (const vote of votes) counts[vote.choice]++
  const threshold = proposal.rule.kind === 'unanimity' ? proposal.electorate.length : proposal.rule.yes
  const passes = (yes: number, submitted: number) => submitted >= proposal.quorum && yes >= threshold
  const passed = passes(counts.yes, votes.length)
  return { counts, outcome: passed ? 'passed' : 'failed', earlyClosure: counts.missing === 0 ? 'all-voted'
    : passed || !passes(counts.yes + counts.missing, proposal.electorate.length) ? 'determined' : undefined }
}

/**
 * Inspect whether productive scheduling may close one original proposal before its deadline.
 * @param state - Authoritative Native prefix; paused reads and unsettled windows never qualify.
 * @param governance - Original governance projection from that same Native prefix.
 * @param proposalId - Exact immutable proposal whose original votes are counted.
 * @returns the Native early-closure reason, or undefined without mutation or inference; deadline closure keeps its scheduler owner.
 */
export function governanceEarlyClosure(state: Pick<SimulationSnapshot, 'phase' | 'activeWindowId' | 'time'>,
  governance: SimulationGovernanceState, proposalId: WorldProposalId): 'all-voted' | 'determined' | undefined {
  if (state.phase !== 'running' || state.activeWindowId !== undefined) return undefined
  const proposal = Object.hasOwn(governance.proposals, proposalId) ? governance.proposals[proposalId] : undefined
  if (proposal === undefined || BigInt(state.time) >= BigInt(proposal.deadline)
    || Object.values(governance.resolutions).some(value => value.proposalId === proposalId)) return undefined
  return governanceVoteTally(proposal, Object.values(governance.votes).filter(value => value.proposalId === proposalId)).earlyClosure
}

/** Stable invariant failures; trusted diagnostics do not grant model authority. */
export class SimulationGovernanceError extends Error {
  /**
   * @param code - Violated governance admission or immutable record relationship.
   * @param message - Trusted diagnostic for the owner.
   */
  constructor(readonly code: 'SIM_GOVERNANCE_SOURCE' | 'SIM_GOVERNANCE_PROPOSAL' | 'SIM_GOVERNANCE_ELECTORATE'
    | 'SIM_GOVERNANCE_VOTE' | 'SIM_GOVERNANCE_TIME' | 'SIM_GOVERNANCE_CLOSED'
    | 'SIM_GOVERNANCE_PENDING' | 'SIM_GOVERNANCE_INTEGRITY', message: string) {
    super(message)
    this.name = 'SimulationGovernanceError'
  }
}

/** A route is fixed before its committee ballots; each step names one already frozen, still-unvoted proposal. */
export const simulationReviewRouteDefinitionInputSchema = z.strictObject({
  id: text.max(256), revision: z.literal(1), mode: z.enum(['and', 'or', 'ordered']), bodyHash: hash,
  membershipPolicy: z.literal('frozen'), deadline: simTimeSchema,
  steps: z.array(z.strictObject({ id: text.max(256), proposalId: worldProposalIdSchema,
    proposalRevision: revision, dependsOn: z.array(text.max(256)).max(32) })).min(1).max(32),
}).superRefine((route, ctx) => {
  const ids = new Set(route.steps.map(value => value.id))
  if (ids.size !== route.steps.length || new Set(route.steps.map(value => value.proposalId)).size !== route.steps.length)
    ctx.addIssue({ code: 'custom', message: 'Route steps and original proposals must be distinct' })
  const completed = new Set<string>(), active = new Set<string>()
  const visit = (id: string): boolean => {
    if (active.has(id) || !ids.has(id)) return false
    if (completed.has(id)) return true
    active.add(id)
    const step = route.steps.find(value => value.id === id)
    if (step === undefined || new Set(step.dependsOn).size !== step.dependsOn.length || !step.dependsOn.every(visit)) return false
    active.delete(id); completed.add(id); return true
  }
  if (!route.steps.every(step => visit(step.id))) ctx.addIssue({ code: 'custom', message: 'Route dependencies are missing or cyclic' })
})
/** Native-owned definition freezes the full electorate, rule and deadline from every actual proposal before voting. */
export const simulationReviewRouteDefinitionSchema = z.strictObject({ ...simulationReviewRouteDefinitionInputSchema.shape,
  proposals: z.array(simulationGovernanceProposalSchema).min(1).max(32), proposer: simulationEntityIdSchema,
  source: simulationGovernanceDecisionSourceSchema, time: simTimeSchema, sequence: revision, hash })
/** Exact immutable route creation command. */
export type SimulationReviewRouteDefinitionInput = z.infer<typeof simulationReviewRouteDefinitionInputSchema>
/** Original pre-ballot route authority retained by Native. */
export type SimulationReviewRouteDefinition = z.infer<typeof simulationReviewRouteDefinitionSchema>
/** Expose a route's voting contract without another actor's private Session or operation identifiers.
 * @param route - Original Native route definition.
 * @returns reconstructable public proposal material and immutable route hash.
 */
export function governanceRouteMaterial(route: SimulationReviewRouteDefinition): {
  id: string
  revision: number
  hash: string
  mode: 'and' | 'or' | 'ordered'
  membershipPolicy: 'frozen'
  deadline: string
  bodyHash: string
  steps: { id: string; dependsOn: string[]; proposal: ReturnType<typeof governanceProposalMaterial> }[]
} {
  return { id: route.id, revision: route.revision, hash: route.hash, mode: route.mode, membershipPolicy: route.membershipPolicy,
    deadline: route.deadline, bodyHash: route.bodyHash, steps: route.steps.map((step) => {
      const proposal = route.proposals.find(value => value.id === step.proposalId)
      if (proposal === undefined) throw new Error('Review route lost its original frozen proposal')
      return { id: step.id, dependsOn: step.dependsOn, proposal: governanceProposalMaterial(proposal) }
    }) }
}
