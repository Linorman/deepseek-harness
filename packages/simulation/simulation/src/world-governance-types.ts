/** Immutable committee proposal, independent vote and deterministic resolution contracts. */
import type { Branded } from '@clocky/clocky-brand'
import type { z } from 'zod'
import type { simulationGovernanceProposalInputSchema, simulationGovernanceProposalSchema,
  simulationGovernanceVoteInputSchema, simulationGovernanceVoteSchema, simulationGovernanceResolutionSchema,
  simulationGovernanceProposalRefSchema, simulationGovernanceDelegationSchema } from './world-governance.ts'
import type { WorldProposalId, WorldResolutionId } from './world-domain-types.ts'

/** Stable Native vote identity; its proposal and voter form the business uniqueness key. */
export type WorldVoteId = Branded<'SimulationWorldVoteId'>
/** Proposed institution text and fixed voting rules; Native derives proposer and electorate. */
export type SimulationGovernanceProposalInput = z.infer<typeof simulationGovernanceProposalInputSchema>
/** Complete frozen proposal whose electorate does not follow later membership changes. */
export type SimulationGovernanceProposal = z.infer<typeof simulationGovernanceProposalSchema>
/** Model vote body; caller identity, epoch and Session evidence cannot be supplied. */
export type SimulationGovernanceVoteInput = z.infer<typeof simulationGovernanceVoteInputSchema>
/** One original independent vote with exact accepted-decision provenance. */
export type SimulationGovernanceVote = z.infer<typeof simulationGovernanceVoteSchema>
/** Original determined outcome; passing alone does not enact the proposed norm. */
export type SimulationGovernanceResolution = z.infer<typeof simulationGovernanceResolutionSchema>
/** Exact proposal material selected by Native before a voter consumes its prepared view. */
export type SimulationGovernanceProposalRef = z.infer<typeof simulationGovernanceProposalRefSchema>
/** Sole Native governance projection; there is no independent writable committee database. */
export interface SimulationGovernanceState {
  /** Explicit grant/revocation history; missing means no proxy authority was granted. */
  /** Immutable pre-ballot route definitions; approval proofs cannot change their required steps. */
  readonly routes?: Readonly<Record<string, import('./world-governance.ts').SimulationReviewRouteDefinition>>
  readonly delegations?: readonly z.infer<typeof simulationGovernanceDelegationSchema>[]

  /** Immutable proposals keyed by their stable Native identity. */
  readonly proposals: Readonly<Record<WorldProposalId, SimulationGovernanceProposal>>
  /** Original votes keyed by proposal and voter-derived vote identity. */
  readonly votes: Readonly<Record<WorldVoteId, SimulationGovernanceVote>>
  /** Sole resolution for each proposal; retries return this original. */
  readonly resolutions: Readonly<Record<WorldResolutionId, SimulationGovernanceResolution>>
}
