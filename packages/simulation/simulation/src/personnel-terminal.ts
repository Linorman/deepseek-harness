/** Original terminal Team task observations discharge only their matching Native external-target reference. */
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { teamIdSchema, teamTaskIdSchema, participantIdSchema } from '@clocky/clocky-team/schema'
import { simulationRunIdSchema } from './schema.ts'
import { simulationOperationIdSchema } from './business.ts'

const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Metadata from an actual lease-free terminal task under the canonical held Team cut; no task or Session text is included. */
export const personnelTaskTerminalEvidenceSchema = z.strictObject({ teamId: teamIdSchema, taskId: teamTaskIdSchema,
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  phase: z.enum(['completed', 'failed', 'cancelled', 'deleted']), runId: simulationRunIdSchema,
  operationId: simulationOperationIdSchema, creatorParticipantId: participantIdSchema, idempotencyKey: z.string().min(1),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/), teamCursor: cursor })
/** Immutable original terminal task source, independently bound to its Native creation receipt. */
export type PersonnelTaskTerminalEvidence = z.infer<typeof personnelTaskTerminalEvidenceSchema>

/**
 * Bind the original empty foreign-duty cut and its exact terminal task observations as one immutable source fingerprint.
 * @param team - Canonical observed source cursor and complete ordered Channel vector.
 * @param terminalTasks - Strict metadata obtained from the held original Team source.
 * @returns canonical integrity hash; it does not manufacture the runtime-only owner authority.
 */
export function personnelTerminalSourceFingerprint(
  team: Extract<import('./personnel-obligations.ts').PersonnelObligationReport['coverage']['team'], { kind: 'observed' }>,
  terminalTasks: readonly PersonnelTaskTerminalEvidence[]): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({ teamId: team.teamId, participantId: team.participantId,
    cursor: team.cursor, channels: team.channels, items: [], complete: true, terminalTasks })).digest('hex')}`
}
