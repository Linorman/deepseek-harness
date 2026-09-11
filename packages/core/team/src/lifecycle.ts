/** Pure closed-lifecycle transition checks for durable Team records. @module @clocky/clocky-team/lifecycle */

import type { ActivationStatus, ChannelPhase, ParticipantPhase, TeamGoalPhase, TeamPhase, TeamTaskPhase } from './types.ts'

/**
 * Assert one activation residency edge accepted by the durable Team journal.
 * A replacement activation uses a new id; an offline epoch cannot restart.
 * @param previous - Prior durable residency status, or `undefined` before binding.
 * @param next - Candidate next residency status.
 */
export function assertActivationStatusTransition(previous: ActivationStatus | undefined, next: ActivationStatus): void {
  assertTransition('activation', previous, next, {
    undefined: ['starting', 'running', 'idle'],
    starting: ['running', 'idle', 'stopping', 'offline'],
    running: ['idle', 'stopping', 'offline'],
    idle: ['running', 'stopping', 'offline'],
    stopping: ['offline'],
    offline: [],
  })
}

/**
 * Assert one Team lifecycle edge accepted by the durable journal.
 * @param previous - Prior durable phase, or `undefined` before creation.
 * @param next - Candidate next durable phase.
 */
export function assertTeamPhaseTransition(previous: TeamPhase | undefined, next: TeamPhase): void {
  assertTransition('Team', previous, next, {
    undefined: ['provisioning'],
    provisioning: ['active', 'quiescing', 'stalled'],
    active: ['quiescing', 'stalled'],
    quiescing: ['completed', 'stalled', 'failed', 'cancelled'],
    stalled: ['active', 'quiescing'],
    completed: [],
    failed: [],
    cancelled: [],
  })
}

/**
 * Assert one Team objective lifecycle edge accepted by the durable journal.
 * A completed objective cannot be reopened; Team cancellation and failure
 * remain Team lifecycle facts rather than objective phases.
 * @param previous - Prior objective phase, or `undefined` before Team creation.
 * @param next - Candidate next objective phase.
 */
export function assertTeamGoalPhaseTransition(previous: TeamGoalPhase | undefined, next: TeamGoalPhase): void {
  assertTransition('Team goal', previous, next, {
    undefined: ['active'],
    active: ['paused', 'blocked', 'complete'],
    paused: ['active', 'blocked', 'complete'],
    blocked: ['active', 'paused', 'complete'],
    complete: [],
  })
}

/**
 * Assert one participant membership edge accepted by the Team journal.
 * @param previous - Prior durable phase, or `undefined` before invitation.
 * @param next - Candidate next durable phase.
 */
export function assertParticipantPhaseTransition(previous: ParticipantPhase | undefined, next: ParticipantPhase): void {
  assertTransition('participant', previous, next, {
    undefined: ['invited'],
    invited: ['provisioning', 'left'],
    provisioning: ['active', 'failed', 'left'],
    active: ['left', 'failed'],
    left: [],
    failed: [],
  })
}

/**
 * Assert one channel lifecycle edge accepted by the channel WAL.
 * @param previous - Prior durable phase, or `undefined` before the pending record.
 * @param next - Candidate next durable phase.
 */
export function assertChannelPhaseTransition(previous: ChannelPhase | undefined, next: ChannelPhase): void {
  assertTransition('channel', previous, next, {
    undefined: ['pending'],
    pending: ['active', 'closing', 'expired', 'failed'],
    active: ['closing', 'expired', 'failed'],
    closing: ['closed', 'expired', 'failed'],
    closed: [],
    expired: [],
    failed: [],
  })
}

/**
 * Assert one task lifecycle edge accepted by the Team journal.
 * @param previous - Prior durable phase, or `undefined` before creation.
 * @param next - Candidate next durable phase.
 */
export function assertTeamTaskPhaseTransition(previous: TeamTaskPhase | undefined, next: TeamTaskPhase): void {
  assertTransition('task', previous, next, {
    undefined: ['pending'],
    pending: ['assigned', 'cancelled', 'deleted'],
    assigned: ['pending', 'running', 'failed', 'cancelled', 'deleted'],
    running: ['pending', 'review', 'completed', 'failed', 'cancelled', 'deleted'],
    review: ['pending', 'completed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
    deleted: [],
  })
}

/** Validate one edge against a closed transition table. */
function assertTransition<T extends string>(
  subject: string,
  previous: T | undefined,
  next: T,
  transitions: Record<T | 'undefined', readonly T[]>,
): void {
  const permitted = transitions[previous ?? 'undefined']
  if (!permitted.includes(next)) {
    throw new Error(`${subject} lifecycle rejects ${previous ?? 'initial'} -> ${next}`)
  }
}
