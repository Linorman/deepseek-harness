/** Exhaustive Native quota classification shared by every structural execution adapter. */
import type { SimulationWorldLimit } from '@clocky/clocky-simulation'
import type { SimulationWorldDriveResult } from './types.ts'

const stops = {
  position: 'position-capacity', entities: 'entity-capacity', participants: 'identity-capacity',
  channels: 'channel-capacity', bytes: 'world-byte-limit', requests: 'world-request-limit', commands: 'world-command-limit',
  plans: 'plan-budget', births: 'world-birth-limit', expansions: 'world-expansion-limit', mutations: 'world-mutation-limit',
} as const satisfies Record<SimulationWorldLimit, SimulationWorldDriveResult['reason']>

/**
 * Preserve the actual Native quota identity at the product driver boundary.
 * @param limit - Exact typed Native refusal; diagnostic text does not affect classification.
 * @returns the corresponding stable driver stop.
 */
export function worldLimitStop(limit: SimulationWorldLimit): SimulationWorldDriveResult['reason'] {
  return stops[limit]
}
