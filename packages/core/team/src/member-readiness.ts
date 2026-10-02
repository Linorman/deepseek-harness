import { TeamError } from './error.ts'
/** Readiness combines current durable facts with observations from their live execution owners. */
import type {
  ActivationBindingSnapshot, ParticipantSnapshot, TeamId, TeamMemberExecutionSources, TeamMemberReadiness,
  TeamMemberReadinessReason,
} from './types.ts'

/** Facts retained only during an authenticated readiness query. */
export interface MemberReadinessFacts {
  readonly teamId: TeamId
  readonly participant: ParticipantSnapshot
  readonly latest?: ActivationBindingSnapshot | undefined
  readonly unquiesced: boolean
  readonly pendingReservation: boolean
  readonly activeAttempts: number
  readonly activationCapacity: boolean
  readonly concurrencyCapacity: boolean
  readonly teamAccepting: boolean
  readonly simulationManaged: boolean
}

/** Describe readiness without starting, fencing or recovering an execution.
 * @param facts - Current Hub-owned membership, binding and budget facts.
 * @param sources - Current owner observations; no historical role inference.
 * @returns independent participation and execution states with stable explanations.
 */
export function memberReadiness(facts: MemberReadinessFacts, sources: TeamMemberExecutionSources): TeamMemberReadiness {
  const member = facts.participant
  if (member.teamId !== facts.teamId) throw new TeamError('Member is not in the selected Team', 'TEAM_PARTICIPANT_NOT_FOUND')
  const reasons: TeamMemberReadinessReason[] = []
  const result = (state: TeamMemberReadiness['state']): TeamMemberReadiness => ({ participantId: member.id,
    participation: member.phase, state, reasons, ...sources.route === undefined ? {} : { configuration: sources.route.configuration } })
  const participating = member.phase === 'active'
  if (!participating) {
    reasons.push('not-participating')
    if (!facts.unquiesced && !facts.pendingReservation && (sources.activation === undefined || sources.activation.state === 'starting')) {
      return result('not-applicable')
    }
  }
  if (member.kind === 'human') { reasons.push('human'); return result('not-applicable') }
  if (facts.simulationManaged) { reasons.push('simulation-managed'); return result('not-applicable') }
  if (member.kind === 'service') { reasons.push('service-managed'); return result('not-applicable') }
  if (!facts.teamAccepting) reasons.push('team-inactive')
  if (sources.route !== undefined) reasons.push(...sources.route.reasons)
  const live = sources.activation
  if (live !== undefined) {
    switch (live.state) {
      case 'recovery-required': reasons.push('old-writer'); return result('recovery-required')
      case 'stopping': reasons.push('stopping'); return result('stopping')
      case 'starting': return result('starting')
      case 'attached': {
        const latest = facts.latest
        if (latest === undefined || live.activationId !== latest.activation.id) {
          reasons.push('old-writer'); return result('recovery-required')
        }
        const status = latest.activation.status
        switch (status) {
          case 'starting': return result('starting')
          case 'stopping': reasons.push('stopping'); return result('stopping')
          case 'offline': reasons.push('old-writer'); return result('recovery-required')
          case 'running': return result('busy')
          case 'idle':
            if (facts.activeAttempts > 0) return result('busy')
            if (!facts.concurrencyCapacity) { reasons.push('concurrency-capacity'); return result('capacity-wait') }
            return result('resident')
            /* v8 ignore next -- activation status is a validated closed union. */
          default: return assertNever(status)
        }
      }
      /* v8 ignore next -- lifecycle owners use the closed same-process observation type. */
      default: return assertNever(live.state)
    }
  }
  if (facts.unquiesced || facts.pendingReservation) { reasons.push('old-writer'); return result('recovery-required') }
  if (!participating || !facts.teamAccepting) return result('not-applicable')
  if (sources.route === undefined) reasons.push('route-unavailable')
  if (!facts.activationCapacity) reasons.push('activation-capacity')
  if (!facts.concurrencyCapacity) reasons.push('concurrency-capacity')
  if (sources.route === undefined || sources.route.reasons.some(reason => reason !== 'pool-capacity')) return result('route-unavailable')
  if (!facts.activationCapacity || !facts.concurrencyCapacity || sources.route.reasons.includes('pool-capacity')) return result('capacity-wait')
  return result('ready')
}

/** Reject a new lifecycle state until its readiness meaning is defined. */
/* v8 ignore next 3 -- callers exhaust validated or same-process closed discriminants. */
function assertNever(value: never): never {
  throw new Error(`Unknown member execution state: ${String(value)}`)
}
