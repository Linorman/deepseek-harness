/** Installed governance request parsers; independent contributions are retained by Native at acceptance. */
import { z } from 'zod'
import { simulationWorldDomainPinSchema, worldProposalIdSchema } from './world-domain.ts'
import { simulationGovernanceNormProposalInputSchema, simulationGovernanceVoteInputSchema, simulationGovernanceDelegationInputSchema, simulationReviewRouteDefinitionInputSchema, worldVoteIdSchema } from './world-governance.ts'

/** Exact installed frozen proposal operation. */
export const WORLD_GOVERNANCE_PROPOSE_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({
  domain: 'governance', operation: 'propose-norm', version: '1', schemaRef: 'clocky.governance.propose-norm/schema/4',
  implementationRef: 'clocky.governance.propose-norm/native/4', generation: 3,
}))
/** Exact installed independent vote operation. */
export const WORLD_GOVERNANCE_VOTE_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({
  domain: 'governance', operation: 'vote', version: '1', schemaRef: 'clocky.governance.vote/schema/3',
  implementationRef: 'clocky.governance.vote/native/5', generation: 4,
}))
/** A director can acknowledge the original contribution; it cannot change its text or vote. */
export const simulationGovernanceAcknowledgeSchema = z.strictObject({ kind: z.literal('acknowledge') })
/** Safe proposal acknowledgement preserves only its stable record reference. */
export const simulationGovernanceProposalResultSchema = z.union([
  z.strictObject({ proposalId: worldProposalIdSchema }), z.strictObject({}),
])
/** Safe vote acknowledgement cannot replace its original independently recorded choice. */
export const simulationGovernanceVoteResultSchema = z.union([
  z.strictObject({ proposalId: worldProposalIdSchema, voteId: worldVoteIdSchema }), z.strictObject({}),
])
/** Shared exact proposal metadata for Native, tools, SDK and execution adapters. */
export const WORLD_GOVERNANCE_PROPOSE_DEFINITION = Object.freeze({ domain: 'governance', operation: 'propose-norm', version: '1',
  schemaRef: WORLD_GOVERNANCE_PROPOSE_PIN.schemaRef,
  schemas: Object.freeze({ request: simulationGovernanceNormProposalInputSchema, plan: simulationGovernanceAcknowledgeSchema,
    result: simulationGovernanceProposalResultSchema, mutation: simulationGovernanceAcknowledgeSchema }) })
/** Shared exact independent vote metadata; identity is supplied solely by Native acceptance. */
export const WORLD_GOVERNANCE_VOTE_DEFINITION = Object.freeze({ domain: 'governance', operation: 'vote', version: '1',
  schemaRef: WORLD_GOVERNANCE_VOTE_PIN.schemaRef,
  schemas: Object.freeze({ request: simulationGovernanceVoteInputSchema, plan: simulationGovernanceAcknowledgeSchema,
    result: simulationGovernanceVoteResultSchema, mutation: simulationGovernanceAcknowledgeSchema }) })

/** Exact installed principal-owned proxy permission operation. */
export const WORLD_GOVERNANCE_DELEGATE_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({
  domain: 'governance', operation: 'delegate-vote', version: '1', schemaRef: 'clocky.governance.delegate-vote/schema/1',
  implementationRef: 'clocky.governance.delegate-vote/native/1', generation: 1,
}))
/** Grant/revoke inputs retain exact proposal scope and never confer material-reading permissions. */
export const WORLD_GOVERNANCE_DELEGATE_DEFINITION = Object.freeze({ domain: 'governance', operation: 'delegate-vote', version: '1',
  schemaRef: WORLD_GOVERNANCE_DELEGATE_PIN.schemaRef,
  schemas: Object.freeze({ request: simulationGovernanceDelegationInputSchema, plan: simulationGovernanceAcknowledgeSchema,
    result: z.strictObject({}), mutation: simulationGovernanceAcknowledgeSchema }) })

/** Original route-definition artifact; creation precedes every referenced ballot. */
export const WORLD_GOVERNANCE_ROUTE_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({
  domain: 'governance', operation: 'define-review-route', version: '1', schemaRef: 'clocky.governance.review-route/schema/1',
  implementationRef: 'clocky.governance.review-route/native/1', generation: 1,
}))
/** Shared parser for a prospective immutable combination; outcomes remain independently Native-derived. */
export const WORLD_GOVERNANCE_ROUTE_DEFINITION = Object.freeze({ domain: 'governance', operation: 'define-review-route', version: '1',
  schemaRef: WORLD_GOVERNANCE_ROUTE_PIN.schemaRef,
  schemas: Object.freeze({ request: simulationReviewRouteDefinitionInputSchema, plan: simulationGovernanceAcknowledgeSchema,
    result: z.strictObject({}), mutation: simulationGovernanceAcknowledgeSchema }) })
