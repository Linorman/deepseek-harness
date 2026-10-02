/** Pending responsibilities projected from validated Team facts under the provider serializer. */
import { TeamError } from './error.ts'
import { teamTextSummary } from './display-text.ts'
import type { TeamAttentionCounts, TeamAttentionItem, TeamAttentionHandling, TeamAttentionPage, TeamAttentionPosition,
  TeamAttentionReadInput, ParticipantSnapshot, TeamHumanActionSnapshot, TeamSnapshot, TeamStallReason, TeamTaskSnapshot } from './types.ts'
import type { ActivationBindingSnapshot } from './types.ts'

/** Authoritative collections; histories and action bodies are not copied into list rows. */
export interface TeamAttentionSource {
  readonly team: TeamSnapshot
  readonly tasks: ReadonlyMap<TeamTaskSnapshot['id'], TeamTaskSnapshot>
  readonly humanActions: ReadonlyMap<TeamHumanActionSnapshot['id'], TeamHumanActionSnapshot>
  readonly activations: ReadonlyMap<ActivationBindingSnapshot['activation']['id'], ActivationBindingSnapshot>
  readonly rules: { readonly simulationRunId?: unknown }
}

/** Count pending responsibilities without relying on pagination or principal inbox retention.
 * @param source - Complete current Team collections; absence of actions means unavailable counts.
 * @returns complete counts, or undefined when the provider supplies no action collection.
 */
export function teamAttentionCounts(source: {
  readonly team: Pick<TeamSnapshot, 'phase'>
  readonly tasks: ReadonlyMap<unknown, Pick<TeamTaskSnapshot, 'phase' | 'delegation'>>
  readonly humanActions?: ReadonlyMap<unknown, Pick<TeamHumanActionSnapshot, 'phase'>> | undefined
}): TeamAttentionCounts | undefined {
  if (source.humanActions === undefined) return undefined
  let recovery = source.team.phase === 'stalled' ? 1 : 0
  let reviews = 0
  for (const task of source.tasks.values()) {
    if (task.phase === 'review') reviews++
    if (task.phase !== 'deleted' && task.delegation?.phase === 'stalled') recovery++
  }
  let humanActions = 0
  for (const action of source.humanActions.values()) if (action.phase === 'pending') humanActions++
  return { recovery, humanActions, reviews, total: recovery + humanActions + reviews }
}

/** Read the stable pending order and one bounded page without performing any operation.
 * @param source - Validated current Team projection under its serializer.
 * @param input - Parsed Team, continuation and requested limit.
 * @param limits - Provider-resolved row and complete UTF-8 response allowances.
 * @param human - Current active human whose exact proof authorized this read.
 * @param parentInspection - Whether authority belongs to a canonical ancestor rather than this Team.
 * @returns byte-bounded summaries and authoritative counts; moved or forged continuations reject.
 */
export function projectTeamAttention(source: TeamAttentionSource, input: TeamAttentionReadInput,
  limits: { readonly limit: number; readonly textBytes: number; readonly bytes: number },
  human: ParticipantSnapshot, parentInspection: boolean): TeamAttentionPage {
  const { team } = source
  if (input.teamId !== team.id) throw new TeamError('Pending items belong to another Team', 'TEAM_INVALID_ARGUMENT')
  const cursor = input.cursor
  if (cursor !== undefined && (cursor.teamId !== team.id || cursor.teamCursor !== team.cursor)) {
    throw new TeamError('Pending items changed; refresh from the first page', 'TEAM_CURSOR_CONFLICT')
  }
  const common = parentInspection ? waiting('parent-inspection')
    : source.rules.simulationRunId !== undefined ? waiting('simulation-managed')
      : team.closure !== undefined || team.cancellation !== undefined ? waiting('closure-in-progress') : undefined
  const active = common ?? (team.phase !== 'active' ? waiting('team-inactive') : undefined)
  const allowed = (operation: 'activate' | 'task-mutate'): TeamAttentionHandling =>
    human.authorityGrant?.operations.includes(operation) ? { kind: 'actionable' } : waiting('not-authorized')
  const entries: { readonly position: TeamAttentionPosition; readonly row: () => TeamAttentionItem }[] = []
  if (team.phase === 'stalled') {
    // Team parsing requires a stall reason; projection does not invent one from runtime errors.
    const reason = team.stallReason as TeamStallReason
    const position = { kind: 'team-recovery' as const, id: team.id, createdAt: team.createdAt }
    entries.push({ position, row: () => ({ ...position, handling: common ?? allowed('activate'),
      reason: { code: reason.code, message: teamTextSummary(reason.message, limits.textBytes) } }) })
  }
  for (const task of source.tasks.values()) {
    if (task.phase !== 'deleted' && task.delegation?.phase === 'stalled') {
      const delegation = task.delegation
      const position = { kind: 'task-recovery' as const, id: task.id, createdAt: task.createdAt }
      entries.push({ position, row: () => ({ ...position, revision: task.revision,
        subject: teamTextSummary(task.subject, limits.textBytes), delegationId: delegation.id,
        handling: common ?? waiting('recovery-owner-required'),
        ...delegation.childTeamId === undefined ? {} : { childTeamId: delegation.childTeamId },
        ...delegation.failure === undefined ? {} : { reason: { code: delegation.failure.code,
          message: teamTextSummary(delegation.failure.message, limits.textBytes) } } }) })
    }
    if (task.phase === 'review') {
      // Task parsing requires a participant review policy while the task awaits review.
      const reviewerId = (task.reviewPolicy as Extract<TeamTaskSnapshot['reviewPolicy'], { kind: 'participant' }>).reviewerId
      const position = { kind: 'task-review' as const, id: task.id, createdAt: task.createdAt }
      entries.push({ position, row: () => ({ ...position, revision: task.revision,
        subject: teamTextSummary(task.subject, limits.textBytes), reviewerId,
        handling: active ?? (reviewerId !== human.id ? waiting('reviewer-required') : allowed('task-mutate')) }) })
    }
  }
  for (const action of source.humanActions.values()) {
    if (action.phase !== 'pending') continue
    const position = { kind: 'human-action' as const, id: action.id, createdAt: action.createdAt }
    entries.push({ position, row: () => ({ ...position, actionKind: action.kind, updatedAt: action.updatedAt,
      handling: humanActionHandling(source, action, human, parentInspection) }) })
  }
  entries.sort((a, b) => compareTeamAttentionPosition(a.position, b.position))
  const start = cursor === undefined ? 0
    : entries.findIndex(entry => compareTeamAttentionPosition(entry.position, cursor.position) === 0) + 1
  if (cursor !== undefined && start === 0) {
    throw new TeamError('Pending continuation does not identify a retained item', 'TEAM_INVALID_ARGUMENT')
  }
  const counts = teamAttentionCounts(source) as TeamAttentionCounts
  const rows: TeamAttentionItem[] = []
  const page = (): TeamAttentionPage => {
    const last = entries[start + rows.length - 1]
    return { teamId: team.id, teamCursor: team.cursor, counts, items: rows,
      ...last !== undefined && start + rows.length < entries.length ? { nextCursor: {
        teamId: team.id, teamCursor: team.cursor, order: 'attention-priority-time-id-v1' as const, position: last.position,
      } } : {} }
  }
  const size = (): number => new TextEncoder().encode(JSON.stringify(page())).byteLength
  for (const entry of entries.slice(start, start + limits.limit)) {
    rows.push(entry.row())
    if (size() > limits.bytes) {
      rows.pop()
      if (rows.length === 0) throw new TeamError('Pending item exceeds the response allowance', 'TEAM_CHANNEL_BACKPRESSURE')
      break
    }
  }
  if (size() > limits.bytes) throw new TeamError('Pending page exceeds the response allowance', 'TEAM_CHANNEL_BACKPRESSURE')
  return page()
}

/** Determine current handling from authoritative request, task and human facts.
 * @param source - Current Team projection under the serializer.
 * @param action - Retained Team request.
 * @param human - Active human that authorized this read.
 * @param parentInspection - Whether the human belongs to an ancestor.
 * @returns current reason or handling allowance; it never authorizes the later write.
 */
export function humanActionHandling(source: TeamAttentionSource, action: TeamHumanActionSnapshot,
  human: ParticipantSnapshot, parentInspection: boolean): TeamAttentionHandling {
  if (action.phase !== 'pending') return waiting('already-processed')
  if (parentInspection) return waiting('parent-inspection')
  if (source.rules.simulationRunId !== undefined) return waiting('simulation-managed')
  if (source.team.closure !== undefined || source.team.cancellation !== undefined) return waiting('closure-in-progress')
  if (source.team.phase !== 'active') return waiting('team-inactive')
  if (action.response !== undefined) return waiting('response-accepted')
  const task = action.taskId === undefined ? undefined : source.tasks.get(action.taskId)
  const binding = task?.lease?.activationId === undefined ? undefined : source.activations.get(task.lease.activationId)
  if (action.taskId !== undefined && (task?.lease?.attemptId !== action.attemptId
    || task?.lease?.participantId !== action.participantId || binding?.sessionId !== action.sessionId)) return waiting('source-changed')
  return human.authorityGrant?.operations.includes('human-action') ? { kind: 'actionable' } : waiting('not-authorized')
}

/** Current inability to handle a readable responsibility. */
function waiting(reason: Extract<TeamAttentionHandling, { kind: 'waiting' }>['reason']): TeamAttentionHandling {
  return { kind: 'waiting', reason }
}

/** Compare pending positions with fixed priority, real creation time and opaque identity.
 * @param left - First validated position.
 * @param right - Second validated position.
 * @returns negative, zero or positive according to canonical ordering.
 */
export function compareTeamAttentionPosition(left: TeamAttentionPosition, right: TeamAttentionPosition): number {
  return rank(left.kind) - rank(right.kind) || left.createdAt - right.createdAt
    || lexical(left.id, right.id) || lexical(left.kind, right.kind)
}

/** Canonical codepoint ordering does not depend on the Host's locale. */
function lexical(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }

/** Recovery and unknown-outcome reconciliation precede human input and review. */
function rank(kind: TeamAttentionPosition['kind']): number {
  switch (kind) {
    case 'team-recovery': case 'task-recovery': return 0
    case 'human-action': return 1
    case 'task-review': return 2
    /* v8 ignore next -- closed kinds are parsed before projection; extending them fails the assertNever type check. */
    default: return assertNever(kind)
  }
}

/** Closed kinds require an ordering decision when extended. */
/* v8 ignore next -- the closed ordering switch handles every parsed kind. */
function assertNever(value: never): never { throw new Error(`Unknown pending item kind: ${String(value)}`) }
