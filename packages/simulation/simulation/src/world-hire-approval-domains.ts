/** A separately installed proposal operation for one real hiring case, using the existing independent vote protocol. */
import { z } from 'zod'
import { simulationWorldDomainPinSchema } from './world-domain.ts'
import { simulationGovernanceProposalInputSchema } from './world-governance.ts'
import { simulationHireApprovalTargetSchema } from './world-hire-approval.ts'
import { simulationGovernanceAcknowledgeSchema, simulationGovernanceProposalResultSchema } from './world-governance-domains.ts'

/** Strict original proposal input; a normative target cannot impersonate an approval for a hire. */
export const simulationHireApprovalProposalInputSchema = simulationGovernanceProposalInputSchema.extend({
  target: z.strictObject({ kind: z.literal('hire-approval'), approval: simulationHireApprovalTargetSchema }),
})
/** Exact installed operation and implementation; requesters cannot select another artifact or generation. */
export const WORLD_GOVERNANCE_HIRE_APPROVAL_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({
  domain: 'governance', operation: 'propose-hire-approval', version: '1',
  schemaRef: 'clocky.governance.propose-hire-approval/schema/2',
  implementationRef: 'clocky.governance.propose-hire-approval/native/2', generation: 1,
}))
/** Shared strict parser registration; Native records actual committee members at accepted request admission. */
export const WORLD_GOVERNANCE_HIRE_APPROVAL_DEFINITION = Object.freeze({
  domain: 'governance', operation: 'propose-hire-approval', version: '1', schemaRef: WORLD_GOVERNANCE_HIRE_APPROVAL_PIN.schemaRef,
  schemas: Object.freeze({ request: simulationHireApprovalProposalInputSchema, plan: simulationGovernanceAcknowledgeSchema,
    result: simulationGovernanceProposalResultSchema, mutation: simulationGovernanceAcknowledgeSchema }),
})
