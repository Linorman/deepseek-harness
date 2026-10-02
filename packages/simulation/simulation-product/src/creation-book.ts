/** Immutable product allocations and preparation attempts, kept independently of native world history. */
import { z } from 'zod'
import { simulationCreationCommandSchema } from './creation-schema.ts'
import { simulationProductCommandIdSchema, simulationProductRequestReceiptSchema } from './administration-schema.ts'
import type { SimulationCreationBook } from './creation-types.ts'
import { simulationCheckpointDiagnosticSchema } from '@clocky/clocky-simulation/checkpoint-diagnostics-schema'

/** Append-only accepted command and one terminal outcome; no native phase or effect is copied here. */
export const simulationCreationEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('command/accepted'), command: simulationCreationCommandSchema }),
  z.strictObject({ kind: z.literal('command/completed'), commandId: simulationProductCommandIdSchema }),
  z.strictObject({ kind: z.literal('command/failed'), commandId: simulationProductCommandIdSchema,
    failure: z.enum(['preparation-required', 'recovery-required', 'unavailable', 'checkpoint-failed', 'restore-failed', 'review-failed',
      'retry-operation-failed', 'cancel-task-failed']), diagnostic: simulationCheckpointDiagnosticSchema.optional() }),
])
/**
 * Replay one strict administration record while retaining original creation and terminal request identities.
 * @param state - Prior complete creation projection.
 * @param input - Untrusted durable append.
 * @returns detached replacement maps; duplicate identities, terminal rewrites and cross-principal preparation reject.
 */
export function foldCreationEntry(state: SimulationCreationBook, input: unknown): SimulationCreationBook {
  const entry = simulationCreationEntrySchema.parse(input)
  const commands = new Map(state.commands)
  const creations = new Map(state.creations)
  switch (entry.kind) {
    case 'command/accepted': {
      const command = entry.command
      if (command.receipt.status !== 'accepted' || commands.has(command.receipt.commandId)) {
        throw new Error('Simulation administration command repeats or has no original accepted state')
      }
      if (command.kind === 'create') {
        if (creations.has(command.receipt.runId)) throw new Error('Simulation creation repeats a run ownership identity')
        creations.set(command.receipt.runId, Object.freeze(structuredClone(command.creation)))
      } else {
        const creation = creations.get(command.receipt.runId)
        if (creation === undefined || creation.record.ownerPrincipalId !== command.ownerPrincipalId) {
          throw new Error('Simulation preparation has no owned original creation')
        }
      }
      commands.set(command.receipt.commandId, Object.freeze(structuredClone(command)))
      break
    }
    case 'command/completed':
    case 'command/failed': {
      const prior = commands.get(entry.commandId)
      if (prior?.receipt.status !== 'accepted') throw new Error('Simulation administration terminal result has no pending request')
      const receipt = simulationProductRequestReceiptSchema.parse({ ...prior.receipt,
        status: entry.kind === 'command/completed' ? 'completed' as const : 'failed' as const,
        ...entry.kind === 'command/failed' ? { failure: entry.failure,
          ...entry.diagnostic === undefined ? {} : { diagnostic: entry.diagnostic } } : {} })
      commands.set(entry.commandId, Object.freeze({ ...prior, receipt }))
      break
    }
    /* v8 ignore next -- the strict durable parser owns this closed entry union. */
    default: return assertNever(entry)
  }
  return { commands, creations }
}
/** A parser-owned closed entry cannot introduce another runtime variant. */
/* v8 ignore next -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never { throw new Error(`Unknown Simulation creation entry: ${String(value)}`) }
