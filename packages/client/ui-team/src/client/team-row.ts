/** Pure helpers for the sidebar's Team rows: titles, status, recency, and order. */

import type { AgentStatus } from '@clocky/clocky-client-ui-primitives'
import type { TeamTaskListState } from '@clocky/clocky-client-runtime/client'

type TeamPhase = TeamTaskListState['items'][number]['phase']

/** Longest derived short title before it is cut with an ellipsis. */
const SHORT_TITLE_MAX = 40
/** Shortest leading clause accepted as a title; shorter clauses keep reading. */
const SHORT_TITLE_MIN = 2

/**
 * Derive a short title from a Team objective: the leading clause up to the
 * first sentence or clause break, capped in length. The full objective stays
 * available to callers for tooltips and the page header.
 * @param objective - full objective text.
 * @returns the short title.
 */
export function deriveShortTitle(objective: string): string {
  const text = objective.replace(/\s+/g, ' ').trim()
  const breakAt = /[：:。.!?！？\n；;]/.exec(text)
  // Terminal punctuation alone is not a clause break: the objective is already one clause.
  const rest = breakAt === null ? '' : text.slice(breakAt.index + 1).trim()
  const clause = breakAt !== null && breakAt.index >= SHORT_TITLE_MIN && rest.length > 0 ? text.slice(0, breakAt.index).trim() : text
  const chars = Array.from(clause)
  return chars.length > SHORT_TITLE_MAX ? `${chars.slice(0, SHORT_TITLE_MAX - 1).join('')}…` : clause
}

/**
 * Map a durable Team phase onto the shared agent-state vocabulary.
 * @param phase - Team lifecycle phase.
 * @returns the status whose color and glyph represent it.
 */
export function teamStatus(phase: TeamPhase): AgentStatus {
  switch (phase) {
    case 'provisioning': return 'waiting'
    case 'active': return 'running'
    case 'quiescing': return 'running'
    case 'stalled': return 'blocked'
    case 'completed': return 'done'
    case 'failed': return 'failed'
    case 'cancelled': return 'idle'
    default: {
      const unreachable: never = phase
      throw new Error(`unknown Team phase ${String(unreachable)}`)
    }
  }
}

/** A relative-time phrase: a locale key plus its count. */
export interface RelativeTime {
  key: 'time.justNow' | 'time.minutes' | 'time.hours' | 'time.days'
  count: number
}

/**
 * Bucket elapsed time into a coarse phrase.
 * @param at - epoch milliseconds of the event.
 * @param now - current epoch milliseconds.
 * @returns the phrase key and count.
 */
export function relativeTime(at: number, now: number): RelativeTime {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return { key: 'time.justNow', count: 0 }
  if (minutes < 60) return { key: 'time.minutes', count: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { key: 'time.hours', count: hours }
  return { key: 'time.days', count: Math.floor(hours / 24) }
}

/**
 * Order Teams for display: most recently changed first, with the id as a
 * stable tie-break so equal timestamps never reorder between renders.
 * @param teams - Teams in discovery order.
 * @returns a new array in display order.
 */
export function sortTeams<T extends { readonly id: string; readonly updatedAt?: number | undefined }>(teams: readonly T[]): T[] {
  return [...teams].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Execution readiness states reported for Team members. */
type ReadinessState = import('@clocky/clocky-client-runtime/client').TeamMemberReadinessRecord['state']

/**
 * Map a member's execution readiness onto the shared agent-state vocabulary.
 * @param state - observed readiness, or undefined when unobserved.
 * @returns the status whose color and glyph represent it.
 */
export function memberStatus(state: ReadinessState | undefined): AgentStatus {
  switch (state) {
    case undefined: return 'idle'
    case 'busy': return 'running'
    case 'starting': case 'stopping': case 'capacity-wait': return 'waiting'
    case 'recovery-required': return 'needs-you'
    case 'route-unavailable': return 'blocked'
    case 'ready': case 'resident': case 'not-applicable': return 'idle'
    default: {
      const unreachable: never = state
      throw new Error(`unknown readiness state ${String(unreachable)}`)
    }
  }
}
