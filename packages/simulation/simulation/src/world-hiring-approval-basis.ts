/** Dependency-free original committee approval basis shared by hiring and conserved financial holds. */
import { z } from 'zod'
import type { WorldNormId, WorldProposalId, WorldResolutionId } from './world-domain-types.ts'
import type { WorldNormVersion } from './world-norms-types.ts'
const text = z.string().min(1)
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
/** Exact retained passed resolution and original enforced norm, without operation or scheduler dependencies. */
export const simulationHireApprovalBasisSchema = z.strictObject({
  proposalId: text.transform(value => value as WorldProposalId), proposalHash: hash,
  resolutionId: text.transform(value => value as WorldResolutionId), resolutionHash: hash,
  norm: z.strictObject({ id: text.transform(value => value as WorldNormId),
    version: z.string().regex(/^[1-9][0-9]*$/).transform(value => value as WorldNormVersion) }),
})
