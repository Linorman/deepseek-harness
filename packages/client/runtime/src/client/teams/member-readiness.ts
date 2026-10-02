/** Read exactly the displayed member set, replacing it atomically after bounded continuation reads. */
import type { IApiClient, RpcResult } from '@clocky/clocky-client-connection/client'
import type { TeamMemberReadinessInput, TeamMemberReadinessState, TeamMemberReadinessValue, TeamMemberReadinessRecord } from '../contract/team-tasks.ts'
import { TeamObservation } from './team-observation.ts'

/** One visible member set has an independent observation lifetime. */
export class MemberReadiness extends TeamObservation<TeamMemberReadinessInput, TeamMemberReadinessValue> {
  /**
   * @param api - Authenticated Host transport.
   * @param publish - Runtime-owned readiness publisher.
   */
  constructor(api: IApiClient, publish: (state: TeamMemberReadinessState | undefined) => void) {
    super(async (input, signal) => await readMembers(api, input, signal), publish)
  }
}

/** Follow only the finite requested identity set; never enumerate additional members. */
async function readMembers(api: IApiClient, input: TeamMemberReadinessInput,
  signal: AbortSignal): Promise<RpcResult<TeamMemberReadinessValue>> {
  const items: TeamMemberReadinessRecord[] = []
  let afterCursor = 0
  let expectedTeamCursor: number | undefined
  while (true) {
    signal.throwIfAborted()
    const response = await api.teams.memberReadiness({ ...input, afterCursor,
      ...expectedTeamCursor === undefined ? {} : { expectedTeamCursor } }, signal)
    if (!response.result.ok) return response.result
    const page = response.result.value
    if (page.teamId !== input.teamId || expectedTeamCursor !== undefined && page.teamCursor !== expectedTeamCursor
      || page.items.some((item, index) => item.participantId !== input.participantIds[afterCursor + index])
      || page.items.length === 0 && afterCursor < input.participantIds.length
      || page.nextCursor !== undefined
        && (page.nextCursor !== afterCursor + page.items.length || page.nextCursor >= input.participantIds.length)
      || page.nextCursor === undefined && afterCursor + page.items.length !== input.participantIds.length) {
      throw new Error('Member readiness page does not match the requested identities and revision')
    }
    expectedTeamCursor = page.teamCursor
    items.push(...page.items.map(item => ({ ...item, observationId: page.observationId, observedAt: page.observedAt })))
    if (page.nextCursor === undefined) return { ok: true, value: { teamId: input.teamId, teamCursor: page.teamCursor, items } }
    afterCursor = page.nextCursor
  }
}
