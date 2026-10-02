import { textParts } from './context-details.ts'
/** Project journal envelopes from replay-validated history; bodies need explicit run-wide historical access. */
import type { SimulationRunObservation } from '@clocky/clocky-simulation'
import type { SimulationProductRecordsInput, SimulationProductRecordItem } from './records-types.ts'
import type { SimulationProductText } from './types.ts'

/**
 * Select retained journal events without inferring events from the current world projection.
 * @param input - Validated original-sequence and kind filters.
 * @param records - Provider-validated journal in canonical sequence order.
 * @param text - Bounded public metadata projection.
 * @param allowed - Separate whole-run historical-content permission.
 * @param maxPartBytes - Deployment Unicode-safe part bound.
 * @returns record count and ordered text parts; the owner bounds the complete public response.
 */
export function recordRows(input: SimulationProductRecordsInput, records: NonNullable<SimulationRunObservation['records']>,
  text: (value: string) => SimulationProductText, allowed: boolean, maxPartBytes: number): {
  totalRecords: number
  items: Iterable<SimulationProductRecordItem>
} {
  const selected = records.filter(entry => (input.sequence === undefined || entry.sequence === input.sequence)
    && (input.kind === undefined || object(entry.value)?.kind === input.kind))
  function* rows(): Generator<SimulationProductRecordItem> {
    for (const entry of selected) {
      const record = object(entry.value)
      if (typeof record?.kind !== 'string') throw new Error('Validated Simulation journal has no record kind')
      const change = object(record.change) ?? object(record.command)
      const base = { sequence: entry.sequence, kind: text(record.kind),
        ...typeof change?.kind === 'string' ? { action: text(change.kind) } : {} }
      if (!allowed || input.mode === 'metadata') { yield { ...base, body: { status: 'withheld' } }; continue }
      const original = JSON.stringify(entry.value)
      let parts = 0
      for (const _part of textParts(original, maxPartBytes)) parts++
      let part = 0
      for (const value of textParts(original, maxPartBytes)) {
        yield { ...base, body: { status: 'text', text: value, part: part++, parts } }
      }
    }
  }
  return { totalRecords: selected.length, items: rows() }
}
function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
