/** Closed safe actor responsibility projection; task bodies and provider configuration never enter this material. */
import { z } from 'zod'
import { channelIdSchema } from '@clocky/clocky-team'
import { simulationEventIdSchema } from './event-identities.ts'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationRunIdSchema, simulationChannelKeySchema } from './schema.ts'
import { simTimeSchema } from './time.ts'
import { simulationInteractionIdSchema, simulationCommitmentIdSchema } from './interaction.ts'
import { simulationOperationIdSchema, simulationFulfillmentSchema } from './business.ts'

const revision = z.number().int().positive()
const selection = z.enum(['active', 'current-wake'])
/** Entire required block, attributed to its actual Native preparation prefix and current actor. */
export const simulationBusinessContextSchema = z.strictObject({
  kind: z.literal('simulation-business-context'), version: z.literal(1), actorId: simulationEntityIdSchema,
  coverage: z.literal('active-and-current-wake-only'),
  source: z.strictObject({ kind: z.literal('run-event'), runId: simulationRunIdSchema, sequence: revision }),
  decisionSnapshotRevision: z.number().int().nonnegative(), currentWakeId: simulationEventIdSchema.optional(),
  interactions: z.array(z.strictObject({ id: simulationInteractionIdSchema, revision, selection,
    requester: simulationEntityIdSchema, assignee: simulationEntityIdSchema, description: z.string().min(1),
    replyBy: simTimeSchema.nullable(), completeBy: simTimeSchema.nullable(), fulfillment: simulationFulfillmentSchema,
    reply: z.enum(['pending', 'accepted', 'rejected', 'deferred']), execution: z.enum(['pending', 'completed', 'cancelled', 'task']),
    createdBy: simulationOperationIdSchema, deferUntil: simTimeSchema.optional(), replyExpiredAt: simTimeSchema.optional(),
    reason: z.string().optional(), commitmentId: simulationCommitmentIdSchema.optional(),
    resultOperationId: simulationOperationIdSchema.optional(),
  })),
  commitments: z.array(z.strictObject({ id: simulationCommitmentIdSchema, revision, selection,
    interactionId: simulationInteractionIdSchema, debtor: simulationEntityIdSchema, creditor: simulationEntityIdSchema,
    phase: z.enum(['open', 'fulfilled', 'cancelled']), createdBy: simulationOperationIdSchema,
    evidence: z.array(simulationOperationIdSchema), breachedAt: simTimeSchema.optional(), fulfilledAt: simTimeSchema.optional(),
  })),
  routes: z.array(z.strictObject({ channelId: channelIdSchema, key: simulationChannelKeySchema,
    confirmation: z.literal('native-confirmed-membership'), members: z.array(simulationEntityIdSchema).min(2) })),
}).superRefine((value, ctx) => {
  const deny = (message: string) => { ctx.addIssue({ code: 'custom', message }) }
  if (value.source.sequence !== value.decisionSnapshotRevision) deny('Business source must be the original decision snapshot')
  if ([...value.interactions, ...value.commitments].some(item => item.selection === 'current-wake') && value.currentWakeId === undefined)
    deny('Terminal responsibilities require their actual current wake')
  if (value.interactions.length === 0 && value.commitments.length === 0) deny('Empty responsibility material has no route authority')
  if (value.interactions.some(item => item.requester !== value.actorId && item.assignee !== value.actorId)
    || value.commitments.some(item => item.debtor !== value.actorId && item.creditor !== value.actorId)) deny('Only actual business parties receive this material')
  for (const obligation of value.commitments) {
    const interaction = value.interactions.find(item => item.id === obligation.interactionId)
    if (interaction === undefined || interaction.requester !== obligation.creditor || interaction.assignee !== obligation.debtor
      || interaction.commitmentId !== obligation.id) deny('Commitments require their exact party interaction')
    if ((obligation.phase === 'open') !== (obligation.selection === 'active')) deny('Commitment coverage must preserve its actual phase')
  }
  if (value.routes.some(route => !route.members.includes(value.actorId) || new Set(route.members).size !== route.members.length))
    deny('Native routes require their actual distinct member actor')
  for (const items of [value.interactions, value.commitments]) if (new Set(items.map(item => item.id)).size !== items.length)
    deny('Responsibility identities must be distinct')
  if (new Set(value.routes.map(route => route.key)).size !== value.routes.length
    || new Set(value.routes.map(route => route.channelId)).size !== value.routes.length) deny('Native routes must be distinct')
})
/** Complete bounded scope material; coverage never claims to include arbitrary historical responsibilities. */
export type SimulationBusinessContext = z.infer<typeof simulationBusinessContextSchema>
