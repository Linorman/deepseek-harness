/** Strict evidence protocol structure; Native verifies actual actors, deadlines, attempts and readable references. */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import { simulationContextReferenceSchema } from './context-reference.ts'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationEntityBindingSchema, simulationWriterEpochSchema } from './writer.ts'
import { simTimeSchema } from './time.ts'
import type { WorldRequestId, WorldPlanId } from './world-types.ts'
import type { WorldEvidenceChallengeId, WorldEvidenceRevisionId, WorldEvidenceFieldCode } from './world-evidence-types.ts'

const text = z.string().min(1)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positive = count.positive()
const requestId = text.transform(value => value as WorldRequestId)
const planId = text.transform(value => value as WorldPlanId)
const operationId = text.transform(value => value as Branded<'SimulationOperationId'>)
const decisionId = text.transform(value => value as Branded<'SimulationDecisionId'>)
/** Original Native challenge identity, never allocated by a supplied answer. */
export const worldEvidenceChallengeIdSchema = text.transform(value => value as WorldEvidenceChallengeId)
/** Immutable Native answer revision identity. */
export const worldEvidenceRevisionIdSchema = text.transform(value => value as WorldEvidenceRevisionId)
/** Exact installed field code; unknown codes are rejected by the Native domain owner. */
export const worldEvidenceFieldCodeSchema = text.transform(value => value as WorldEvidenceFieldCode)

/** Domain-owned field definition; arbitrary object patches are not an answer format. */
export const simulationWorldEvidenceFieldSchema = z.strictObject({
  /** Stable installed domain field identity. */
  code: worldEvidenceFieldCodeSchema,
  /** Original description shown to the authorized responder. */
  description: text,
})
/** One text answer with explicit original source references, whose visibility Native rechecks. */
export const simulationWorldEvidenceAnswerSchema = z.strictObject({
  /** Field selected from this challenge's original declared fields. */
  field: worldEvidenceFieldCodeSchema,
  /** Original nonempty response text, never an executable or generic JSON patch. */
  text,
  /** Sources actually visible in the answering decision; Native validates their provenance. */
  references: z.array(simulationContextReferenceSchema),
})
const answers = z.array(simulationWorldEvidenceAnswerSchema).min(1)
  .refine(values => new Set(values.map(value => value.field)).size === values.length, 'Answer fields must be distinct')
const fields = z.array(simulationWorldEvidenceFieldSchema).min(1)
  .refine(values => new Set(values.map(value => value.code)).size === values.length, 'Challenge fields must be distinct')
const source = z.strictObject({
  /** Actual accepted decision that created this retained record. */
  decisionId,
  /** Original expanded operation identity within that decision. */
  operationId,
  /** Actual writer epoch, not a model-selected role or session. */
  epoch: simulationWriterEpochSchema,
  /** Original canonical Team, Participant and Session binding. */
  binding: simulationEntityBindingSchema,
})

/** Missing-evidence resolution; Native fixes responders to the original requester. */
export const simulationWorldEvidenceAskSchema = z.strictObject({
  /** Closed resolution discriminator. */
  kind: z.literal('awaiting-evidence'),
  /** Nonempty distinct installed fields required for the next input revision. */
  missingFields: z.array(worldEvidenceFieldCodeSchema).min(1)
    .refine(values => new Set(values).size === values.length, 'Missing fields must be distinct'),
  /** Canonical simulated deadline; Native verifies it against the current clock. */
  deadline: simTimeSchema,
  /** Positive safe attempt bound, enforced by the Native owner. */
  maxAttempts: positive,
  /** Original rationale for requesting these fields. */
  rationale: text,
})
/** An answer can name only its original challenge; Native derives actual actor and Session authority. */
export const simulationWorldEvidenceSupplySchema = z.strictObject({
  /** Closed model-action discriminator. */
  kind: z.literal('world/evidence'),
  /** Original business case awaiting evidence. */
  requestId,
  /** Exact retained challenge being answered. */
  challengeId: worldEvidenceChallengeIdSchema,
  /** Original input revision observed by the responding decision. */
  expectedInputRevision: count,
  /** Nonempty distinct text answers with source references. */
  answers,
})
/** Original retained challenge; terminal sequence must follow its creation. */
export const simulationWorldEvidenceChallengeSchema = z.strictObject({
  /** Native challenge identity. */
  id: worldEvidenceChallengeIdSchema,
  /** Original business case. */
  requestId,
  /** Accepted plan that requested missing evidence. */
  planId,
  /** Input revision on which that plan was based. */
  inputRevision: count,
  /** Positive ordinal of this evidence round. */
  round: positive,
  /** Frozen installed descriptions of the required fields. */
  fields,
  /** Original Native-selected responders; the model cannot provide this list. */
  responders: z.array(simulationEntityIdSchema).min(1)
    .refine(values => new Set(values).size === values.length, 'Responders must be distinct'),
  /** Original canonical simulated expiry time. */
  deadline: simTimeSchema,
  /** Original positive safe attempt bound. */
  maxAttempts: positive,
  /** Durable notification responsibility for this challenge. */
  notificationOperationId: operationId,
  /** Actual decision, operation, writer epoch and canonical binding. */
  source,
  /** Positive creation sequence in the Native journal. */
  sequence: positive,
  /** Retained challenge disposition; terminal states cannot regain awaiting authority. */
  status: z.enum(['awaiting', 'answered', 'expired', 'exhausted', 'cancelled']),
  /** Required for terminal states and strictly later than creation. */
  settledSequence: positive.optional(),
  /** Present only for an answered challenge and identifies its accepted revision. */
  responseRevisionId: worldEvidenceRevisionIdSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.status === 'awaiting' ? value.settledSequence !== undefined
    : value.settledSequence === undefined || value.settledSequence <= value.sequence)
    ctx.addIssue({ code: 'custom', path: ['settledSequence'], message: 'Challenge settlement must follow creation and match status' })
  if ((value.status === 'answered') !== (value.responseRevisionId !== undefined))
    ctx.addIssue({ code: 'custom', path: ['responseRevisionId'], message: 'Only answered challenges retain an answer revision' })
})
/** Immutable accepted answers; ownership and reference visibility are verified before Native append. */
export const simulationWorldEvidenceRevisionSchema = z.strictObject({
  /** Native immutable answer identity. */
  id: worldEvidenceRevisionIdSchema,
  /** Original business case. */
  requestId,
  /** Original challenge this revision answers. */
  challengeId: worldEvidenceChallengeIdSchema,
  /** Positive successor input revision assigned by Native. */
  revision: positive,
  /** Original accepted text and source references. */
  answers,
  /** Actual decision provenance, including the authenticated actor. */
  source: source.extend({
    /** Actual responding actor; never copied from a model argument. */
    actorId: simulationEntityIdSchema,
  }),
  /** Durable notification responsibility for the accepted revision. */
  notificationOperationId: operationId,
  /** Original positive Native acceptance sequence. */
  sequence: positive,
  /** Original canonical simulated acceptance time. */
  time: simTimeSchema,
  /** SHA-256 commitment to the original accepted revision input. */
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
})
