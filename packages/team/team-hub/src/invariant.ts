/**
 * Runtime relationship checks for Team-Hub post-commit notifications.
 * @module @clocky/clocky-team-hub/invariant
 */

import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import type { InvariantFailure, InvariantInstaller } from '@clocky/clocky-invariants'
import type { ChannelEvent, TeamEvent } from '@clocky/clocky-team'
import { channelRecordCursor } from './fold.ts'
import { TeamHub } from './index.ts'

const PACKAGE_NAME = '@clocky/clocky-team-hub'

/** Cordis companion plugin name. */
export const name = 'team-hub-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Check that every post-commit notification refers to a current Hub projection.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('team/changed', (event: TeamEvent) => {
    const hub = ctx.get('teams')
    if (!(hub instanceof TeamHub)) return
    const teamId = teamIdForEvent(event)
    const current = hub.inspectLoadedTeam(teamId)
    if (current === undefined) return fail(`team/changed for '${teamId}' emitted without a loaded Team projection`)
    if (current.team.id !== teamId) return fail(`team/changed for '${teamId}' disagrees with the loaded Team identity`)
    switch (event.type) {
      case 'team/created':
      case 'team/changed':
        if (current.team.cursor < event.team.cursor || current.team.goal.revision !== event.team.goal.revision) {
          return fail(`team/changed for '${teamId}' is ahead of or differs from the loaded Team projection`)
        }
        return
      case 'goal/changed':
        if (current.team.cursor < event.cursor
          || current.team.goal.revision < event.goal.revision
          || current.team.goal.teamId !== event.goal.teamId) {
          return fail(`goal event for '${teamId}' is absent from the loaded Team projection`)
        }
        return
      case 'participant/changed': {
        const participant = current.participants.find(item => item.id === event.participant.id)
        if (participant === undefined || participant.phase !== event.participant.phase || current.team.cursor < event.cursor) {
          return fail(`participant event '${event.participant.id}' is absent from the loaded Team projection`)
        }
        return
      }
      case 'task/changed': {
        const task = current.tasks.find(item => item.id === event.task.id)
        if (task === undefined || task.revision < event.task.revision || current.team.cursor < event.cursor) {
          return fail(`task event '${event.task.id}' is absent from the loaded Team projection`)
        }
        return
      }
      case 'workspace/observed': {
        const allocation = current.workspaceAllocations.find(item => item.id === event.observation.allocationId)
        if (allocation?.observation?.observedAt !== event.observation.observedAt || current.team.cursor < event.cursor) {
          return fail(`workspace observation '${event.observation.id}' is absent from its allocation projection`)
        }
        return
      }
      case 'workspace-allocation/changed': {
        const allocation = current.workspaceAllocations.find(item => item.id === event.allocation.id)
        if (allocation === undefined
          || allocation.revision < event.allocation.revision
          || allocation.lifecycle !== event.allocation.lifecycle
          || current.team.cursor < event.cursor) {
          return fail(`workspace allocation '${event.allocation.id}' is absent from the loaded Team projection`)
        }
        return
      }
      case 'activation/changed': {
        const binding = current.activations.find(item => item.activation.id === event.binding.activation.id)
        if (binding === undefined
          || binding.activation.teamId !== event.binding.activation.teamId
          || binding.activation.participantId !== event.binding.activation.participantId
          || binding.activation.status !== event.binding.activation.status
          || binding.sessionId !== event.binding.sessionId
          || binding.provider !== event.binding.provider
          || !isDeepStrictEqual(binding.recovery, event.binding.recovery)
          || current.team.cursor < event.cursor) {
          return fail(`activation event '${event.binding.activation.id}' is absent from the loaded Team projection`)
        }
        return
      }
      case 'participant-interrupt/changed': {
        const interrupt = hub.inspectLoadedParticipantInterrupt(teamId, event.interrupt.id)
        if (interrupt === undefined
          || interrupt.acknowledgedAt !== event.interrupt.acknowledgedAt
          || current.team.cursor < event.cursor) {
          return fail(`participant interrupt '${event.interrupt.id}' is absent from the loaded Team projection`)
        }
        return
      }
      case 'human-action/changed': {
        const action = current.humanActions?.find(item => item.id === event.action.id)
        if (action === undefined
          || action.phase !== event.action.phase
          || current.team.cursor < event.cursor) {
          return fail(`human action '${event.action.id}' is absent from the loaded Team projection`)
        }
        return
      }
      case 'usage/changed':
        if (current.team.cursor < event.cursor || current.usage?.updatedAt !== event.usage.updatedAt) {
          return fail(`usage event for '${teamId}' is absent from the loaded Team projection`)
        }
        return
      case 'workflow-plan/changed': {
        const plan = current.workflowPlans?.find(item => item.id === event.plan.id)
        if (plan === undefined || plan.revision < event.plan.revision || current.team.cursor < event.cursor) {
          return fail(`workflow plan '${event.plan.id}' is absent from the loaded Team projection`)
        }
        return
      }
      case 'policy/denied':
        if (current.team.cursor < event.cursor) return fail(`policy denial for '${teamId}' is ahead of the loaded Team projection`)
        return
      /* v8 ignore next 2 -- TeamEvent is closed and all event forms are handled above. */
      default:
        event satisfies never
    }
  }, { global: true })
  ctx.on('channel/changed', (event: ChannelEvent) => {
    const hub = ctx.get('teams')
    // v8 ignore next -- a companion may load before its optional Team provider, which is covered by its composition spec.
    if (!(hub instanceof TeamHub)) return
    const current = hub.inspectLoadedChannel(event.channelId)
    if (current === undefined || current.manifest.id !== event.channelId || current.cursor < channelRecordCursor(event.record)) {
      return fail(`channel/changed '${event.channelId}' emitted without its loaded channel projection`)
    }
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

/** Resolve the owning Team identity from each post-commit notification form. */
function teamIdForEvent(event: TeamEvent) {
  switch (event.type) {
    case 'team/created':
    case 'team/changed':
      return event.team.id
    case 'goal/changed':
      return event.goal.teamId
    case 'participant/changed':
      return event.participant.teamId
    case 'task/changed':
      return event.task.teamId
    case 'workspace/observed':
      return event.observation.teamId
    case 'workspace-allocation/changed':
      return event.allocation.teamId
    case 'activation/changed':
      return event.binding.activation.teamId
    case 'participant-interrupt/changed':
      return event.interrupt.target.teamId
    case 'human-action/changed':
      return event.action.teamId
    case 'usage/changed':
    case 'policy/denied':
      return event.teamId
    case 'workflow-plan/changed':
      return event.plan.teamId
    /* v8 ignore next 2 -- TeamEvent is a closed alias; teamEventSchema rejects unknown wire kinds. */
    default:
      return assertNever(event)
  }
}

/** Keep the Team notification union exhaustive. */
/* v8 ignore next 3 -- Only statically exhaustive TeamEvent defaults call this helper. */
function assertNever(value: never): never {
  throw new TypeError(`unknown Team event: ${String(value)}`)
}
