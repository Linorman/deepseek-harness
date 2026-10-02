/** Strict immutable registration journal; no world state is persisted in this directory. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import { simulationProductRunIdSchema } from './schema.ts'
import type { SimulationProductImport, SimulationProductRecord } from './registration-types.ts'

/** Deployment registrations cannot name arbitrary unvalidated run specs. */
export const simulationProductImportSchema = z.object({ id: simulationProductRunIdSchema,
  name: z.string().trim().min(1), provider: z.string().trim().min(1), spec: simulationRunSpecSchema,
  ownerPrincipalId: z.string().min(1).transform(productPrincipalId),
}).strict() satisfies z.ZodType<SimulationProductImport>

/** Every persisted import carries its immutable registration timestamp. */
export const simulationProductRecordSchema = simulationProductImportSchema.extend({
  registeredAt: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<SimulationProductRecord>

/** One directory append owns one registration and its initial identity. */
export const directoryEntrySchema = z.object({ kind: z.literal('run/registered'), record: simulationProductRecordSchema }).strict()

/**
 * Fold a parsed durable registration and reject identity/spec or ownership duplication.
 * @param records - Retained directory state before this append.
 * @param input - Durable untrusted registration entry.
 * @returns the replaced immutable registration map.
 */
export function foldDirectoryEntry(
  records: ReadonlyMap<string, SimulationProductRecord>, input: unknown,
): Map<string, SimulationProductRecord> {
  const { record } = directoryEntrySchema.parse(input)
  if (records.has(record.id)) throw new Error('Simulation product directory repeats a registration identity')
  for (const retained of records.values()) {
    if (retained.provider === record.provider && retained.spec.runId === record.spec.runId) {
      throw new Error('Simulation product directory repeats a provider/run ownership key')
    }
  }
  const next = new Map(records)
  next.set(record.id, Object.freeze(structuredClone(record)))
  return next
}

/**
 * Compare a trusted configured import with a retained immutable registration.
 * @param record - Journal-derived registration.
 * @param input - Deployment-configured registration fields.
 * @returns whether configuration still describes the exact registered ownership and spec.
 */
export function sameImport(record: SimulationProductRecord, input: SimulationProductImport): boolean {
  const { registeredAt: _registeredAt, ...fields } = record
  return isDeepStrictEqual(fields, input)
}
