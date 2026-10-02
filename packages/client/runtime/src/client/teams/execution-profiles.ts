/** Authenticated deployment-profile observations for member registration. */
import type { IApiClient } from '@clocky/clocky-client-connection/client'
import type { TeamExecutionProfilesInput, TeamExecutionProfilesState, TeamExecutionProfilesValue } from '../contract/team-tasks.ts'
import { TeamObservation } from './team-observation.ts'

/** Each form observes one bounded catalog page and its independently selected profile. */
export class ExecutionProfiles extends TeamObservation<TeamExecutionProfilesInput, TeamExecutionProfilesValue> {
  /**
   * @param api - Authenticated Host transport.
   * @param publish - Runtime-owned catalog publisher.
   */
  constructor(api: IApiClient, publish: (state: TeamExecutionProfilesState | undefined) => void) {
    super(async (input, signal) => {
      const result = (await api.teams.executionProfiles(input, signal)).result
      if (result.ok && (result.value.kind !== input.kind
        || result.value.selected !== undefined && result.value.selected.id !== input.selectedId)) {
        throw new Error('Execution profiles do not match the requested member kind and selection')
      }
      return result
    }, publish)
  }
}
