/**
 * Function plugin registering the version-one persistent task-assignment
 * Team-channel adapter.
 *
 * @module @clocky/clocky-team-channel-task-assignment
 */

import type { Context } from '@clocky/cordis'
import { taskAssignmentChannelAdapter } from './task-assignment.ts'

export {
  TASK_ASSIGNMENT_ASSIGNEE_ROLE,
  TASK_ASSIGNMENT_CHANNEL_ADAPTER,
  TASK_ASSIGNMENT_CHANNEL_TYPE,
  TASK_ASSIGNMENT_CHANNEL_VERSION,
  TASK_ASSIGNMENT_ENVELOPE_KIND,
  parseTaskAssignmentChannelManifest,
  parseTaskAssignmentEnvelope,
  taskAssignmentChannelAdapter,
} from './task-assignment.ts'
export type {
  TaskAssignmentChannelLimits,
  TaskAssignmentChannelManifest,
  TaskAssignmentEnvelope,
  TaskAssignmentEnvelopePayload,
} from './task-assignment.ts'

/** Cordis plugin name. */
export const name = 'team-channel-task-assignment'
/** The Team adapter registry must exist before this protocol registers. */
export const inject = ['teams']

/**
 * Register the task-assignment version-one adapter on the Team runtime. The
 * runtime scopes the registration to this plugin fiber.
 * @param ctx - context carrying the Team runtime adapter registry.
 */
export function apply(ctx: Context): void {
  ctx.teams.registerAdapter(taskAssignmentChannelAdapter)
}
