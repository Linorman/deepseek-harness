/** Task authoring observations reuse the runtime's authenticated observation lifetime. */
import type { IApiClient } from '@clocky/clocky-client-connection/client'
import type { TeamTaskCapabilitiesInput, TeamTaskCapabilitiesState, TeamTaskCapabilitiesValue } from '../contract/team-tasks.ts'
import { TeamObservation } from './team-observation.ts'

/** One form's capability query; the shared owner handles polling, cancellation and reconnection. */
export class TaskCapabilities extends TeamObservation<TeamTaskCapabilitiesInput, TeamTaskCapabilitiesValue> {
  /**
   * @param api - Authenticated Host transport.
   * @param publish - Runtime-owned observation publisher.
   */
  constructor(api: IApiClient, publish: (state: TeamTaskCapabilitiesState | undefined) => void) {
    super(async (input, signal) => (await api.teams.capabilities(input, signal)).result, publish)
  }
}
