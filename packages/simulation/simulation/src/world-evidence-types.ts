/** Evidence identities and retained records; Native owns responder admission and source visibility. */
import type { Branded } from '@clocky/clocky-brand'
import type { z } from 'zod'
import type { simulationWorldEvidenceFieldSchema, simulationWorldEvidenceAnswerSchema, simulationWorldEvidenceAskSchema,
  simulationWorldEvidenceSupplySchema, simulationWorldEvidenceChallengeSchema,
  simulationWorldEvidenceRevisionSchema } from './world-evidence.ts'

/** Native-assigned identity of one original missing-evidence challenge. */
export type WorldEvidenceChallengeId = Branded<'SimulationWorldEvidenceChallengeId'>
/** Native-assigned immutable evidence answer revision identity. */
export type WorldEvidenceRevisionId = Branded<'SimulationWorldEvidenceRevisionId'>
/** Installed domain field identity; a code alone grants no ability to answer or read evidence. */
export type WorldEvidenceFieldCode = Branded<'SimulationWorldEvidenceFieldCode'>
/** Installed text-answer field and its reader-facing description. */
export type SimulationWorldEvidenceField = z.infer<typeof simulationWorldEvidenceFieldSchema>
/** Original text answer and the exact source references whose visibility Native verifies. */
export type SimulationWorldEvidenceAnswer = z.infer<typeof simulationWorldEvidenceAnswerSchema>
/** Model-proposed bounded request for missing fields, without responder selection. */
export type SimulationWorldEvidenceAsk = z.infer<typeof simulationWorldEvidenceAskSchema>
/** Model-proposed answers to an exact original challenge and input revision. */
export type SimulationWorldEvidenceSupply = z.infer<typeof simulationWorldEvidenceSupplySchema>
/** Native-owned challenge, immutable source and terminal settlement evidence. */
export type SimulationWorldEvidenceChallenge = z.infer<typeof simulationWorldEvidenceChallengeSchema>
/** Immutable Native-accepted text answers and original actor provenance. */
export type SimulationWorldEvidenceRevision = z.infer<typeof simulationWorldEvidenceRevisionSchema>
/** Original challenge and answer history; terminal records are retained rather than replaced. */
export interface SimulationWorldEvidenceState {
  /** Challenges indexed by their Native identity. */
  readonly challenges: Readonly<Record<WorldEvidenceChallengeId, SimulationWorldEvidenceChallenge>>
  /** Accepted input revisions indexed by their immutable Native identity. */
  readonly revisions: Readonly<Record<WorldEvidenceRevisionId, SimulationWorldEvidenceRevision>>
}
