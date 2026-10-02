/** Strict wire diagnosis parsing has no shared Error classes, runtime owners or private cause inspection. */
import { z } from 'zod'
import type { TeamId, ChannelId, ParticipantId } from '@clocky/clocky-team/types'
import type { SessionId } from '@clocky/clocky-session/types'
import type { SimulationEntityId, SimulationCheckpointId } from './identities.ts'
import type { SimulationCheckpointDiagnostic } from './checkpoint-diagnostics-types.ts'

/** Validate finite public categories and one exact canonical reference; additional payload refuses. */
export const simulationCheckpointDiagnosticSchema = z.strictObject({
  stage: z.enum(['collect', 'validate', 'restore', 'retire', 'publish']),
  code: z.enum(['source-unavailable', 'source-moved', 'history-incomplete', 'binding-mismatch', 'owner-conflict',
    'owner-not-quiescent', 'unsupported-ownership', 'manifest-mismatch', 'version-mismatch', 'cancelled', 'unavailable']),
  subject: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('run') }),
    z.strictObject({ kind: z.literal('checkpoint'),
      checkpointId: z.string().min(1).transform(value => value as SimulationCheckpointId) }),
    z.strictObject({ kind: z.literal('team'), teamId: z.string().min(1).transform(value => value as TeamId) }),
    z.strictObject({ kind: z.literal('channel'), teamId: z.string().min(1).transform(value => value as TeamId),
      channelId: z.string().min(1).transform(value => value as ChannelId) }),
    z.strictObject({ kind: z.literal('session'),
      sessionId: z.string().min(1).transform(value => value as SessionId),
      teamId: z.string().min(1).transform(value => value as TeamId),
      participantId: z.string().min(1).transform(value => value as ParticipantId) }),
    z.strictObject({ kind: z.literal('entity'), entityId: z.string().min(1).transform(value => value as SimulationEntityId) }),
  ]),
  cleanup: z.literal('unconfirmed').optional(),
}) satisfies z.ZodType<SimulationCheckpointDiagnostic>
