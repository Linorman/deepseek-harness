/** Hub error mapping for the browser-safe bounded Team projection. */
import { TeamError } from '@clocky/clocky-team'
import type { TeamSelectionSnapshot } from '@clocky/clocky-team'
import { projectTeamSelection } from '@clocky/clocky-team/selection'
import type { TeamProjection } from './types.ts'

/** Project selection data under the Team serializer.
 * @param projection - authoritative Team state.
 * @param maxTextBytes - UTF-8 allowance for each display field.
 * @param maxBytes - allowance for the complete emitted JSON value.
 * @param includeMetadata - Include bounded scalar metadata when requested.
 * @returns selection data; oversized structural metadata rejects with backpressure.
 */
export function teamSelection(
  projection: TeamProjection, maxTextBytes: number, maxBytes: number, includeMetadata = false,
): TeamSelectionSnapshot {
  const result = projectTeamSelection(projection, maxTextBytes, maxBytes, includeMetadata)
  if (!result.ok) throw new TeamError(`Team selection ${result.reason} exceeds maxSelectionBytes`, 'TEAM_CHANNEL_BACKPRESSURE')
  return result.value
}
