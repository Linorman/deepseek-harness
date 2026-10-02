/** Exact Team attribution for post-commit projection events. */
import type { TeamEvent, TeamId } from './types.ts'

/** Resolve a projection event's authoritative Team identity.
 * @param event - Validated committed projection event.
 * @returns Team which owns its durable facts.
 */
export function teamEventOwnerId(event: TeamEvent): TeamId {
  switch (event.type) {
    case 'team/created': case 'team/changed': return event.team.id
    case 'goal/changed': return event.goal.teamId
    case 'participant/changed': return event.participant.teamId
    case 'activation/changed': return event.binding.activation.teamId
    case 'participant-interrupt/changed': return event.interrupt.target.teamId
    case 'human-action/changed': return event.action.teamId
    case 'workflow-plan/changed': return event.plan.teamId
    case 'task/changed': return event.task.teamId
    case 'workspace/observed': return event.observation.teamId
    case 'workspace-allocation/changed': return event.allocation.teamId
    case 'usage/changed': case 'policy/denied': return event.teamId
    default: return assertNever(event)
  }
}

/** Require ownership for any newly declared event variant. */
function assertNever(value: never): never {
  throw new Error(`Unhandled Team event: ${String(value)}`)
}
