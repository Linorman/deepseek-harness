import type { SimulationCommand, SimulationCommandKey, SimulationCommandState } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'

/** Command retention and original-result operations shared by the Simulation task dialogs. */
export interface CommandProps {
  commands: Readonly<Record<string, SimulationCommandState>>
  retain: (command: SimulationCommand, version: number) => SimulationCommandKey
  submit: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  query: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  t: (key: Key) => string
}

/**
 * Preserve the original command identity while its request has not settled.
 * @param record - The command's current request observation.
 * @returns Whether callers must keep the original identity for query or retry.
 */
export function commandUnresolved(record: SimulationCommandState | undefined): boolean {
  return record !== undefined && (record.pending || record.unknown || record.receipt === undefined
    || record.receipt.value.status === 'accepted')
}
