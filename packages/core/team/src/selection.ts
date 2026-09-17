export { projectMemberInspection } from './member-inspection.ts'
import { teamTextSummary as textSummary } from './display-text.ts'
export { projectWorkflowInspection } from './workflow-inspection.ts'
import type { JsonObject, TeamUsageSnapshot, TeamHumanActionSnapshot } from './types.ts'
export { projectTaskInspection, withoutPrivateTaskArtifacts } from './task-inspection.ts'
export type { TeamTaskInspectionProjection } from './task-inspection.ts'
import type { TeamBrowseSpec, TeamBrowsePage, TeamTaskSummary, TeamMemberSummary, TeamWorkflowSummary, TeamWorkflowPlanId, TeamWorkflowPlanSnapshot } from './types.ts'
/** Bounded Team display projections, separate from complete runtime replay state. */
import type {
  ActivationBindingSnapshot, ActivationId, ChannelId, ParticipantId, ParticipantSnapshot,
  TeamMemberSessionSnapshot, TeamSelectionSnapshot, TeamSnapshot, TeamTaskId, TeamTaskSnapshot,
} from './types.ts'

/** Collection views needed for bounded selection; implementations retain their own replay state. */
export interface TeamSelectionSource {
  readonly budgets?: JsonObject
  readonly usage?: TeamUsageSnapshot
  readonly humanActions?: ReadonlyMap<unknown, Pick<TeamHumanActionSnapshot, 'phase'>>
  readonly team: TeamSnapshot
  readonly participants: ReadonlyMap<ParticipantId, ParticipantSnapshot>
  readonly activations: ReadonlyMap<ActivationId, ActivationBindingSnapshot>
  readonly tasks: ReadonlyMap<TeamTaskId, Pick<TeamTaskSnapshot, 'phase'>>
  readonly channelIds: ReadonlySet<ChannelId>
  readonly workflowPlans: { readonly size: number }
}

/** Bounded projection or an explicit oversized structural field; ids are never truncated. */
export type TeamSelectionProjection =
  | { readonly ok: true; readonly value: TeamSelectionSnapshot }
  | { readonly ok: false; readonly reason: 'identity' | 'metadata' }

const utf8 = new TextEncoder()

/** Project current identity, coordinator binding and counts without materializing history arrays.
 * @param projection - Authoritative in-memory Team state under its serializer.
 * @param maxTextBytes - UTF-8 allowance for each display field.
 * @param maxBytes - Allowance for the complete emitted JSON value, including metadata.
 * @param includeMetadata - Include exact scalar metadata when it fits the same response allowance.
 * @returns bounded first-selection data or the structural size failure.
 */
export function projectTeamSelection(
  projection: TeamSelectionSource, maxTextBytes: number, maxBytes: number, includeMetadata = false,
): TeamSelectionProjection {
  const team = projection.team
  maxTextBytes = Math.min(maxTextBytes, maxBytes)
  let count = 0
  let activeCount = 0
  let candidate: ParticipantSnapshot | undefined
  let active: ParticipantSnapshot | undefined
  for (const member of projection.participants.values()) {
    if (member.role !== 'coordinator') continue
    candidate = member
    count += 1
    if (member.phase === 'active') { active = member; activeCount += 1 }
  }
  const selectedCount = activeCount === 0 ? count : activeCount
  const member = selectedCount === 1 ? activeCount === 0 ? candidate : active : undefined
  let coordinator: TeamSelectionSnapshot['coordinator']
  if (member === undefined) {
    coordinator = { kind: 'unavailable', reason: selectedCount === 0 ? 'missing-participant' : 'ambiguous-participant' }
  } else if (member.kind !== 'local-agent' && member.kind !== 'remote-agent') {
    coordinator = { kind: 'unavailable', reason: 'not-agent' }
  } else {
    let binding
    for (const value of projection.activations.values()) if (value.activation.participantId === member.id) binding = value
    const pending = member.activationReservation
    if (pending !== undefined && pending.releasedAt === undefined && binding?.reservationId !== pending.id) {
      coordinator = { kind: 'unavailable', reason: 'starting' }
    } else if (binding === undefined) coordinator = { kind: 'unavailable', reason: 'missing-binding' }
    else coordinator = { kind: 'bound', name: textSummary(member.displayName, maxTextBytes), participantKind: member.kind, participantPhase: member.phase,
      binding: { activation: { ...binding.activation }, sessionId: binding.sessionId, provider: binding.provider } }
  }
  const tasks: Record<keyof TeamSelectionSnapshot['counts']['tasks'], number> = {
    pending: 0, assigned: 0, running: 0, review: 0, completed: 0, failed: 0, cancelled: 0, deleted: 0,
  }
  for (const task of projection.tasks.values()) tasks[task.phase] += 1
  let pendingHumanActionCount = 0
  if (projection.humanActions !== undefined) {
    for (const action of projection.humanActions.values()) if (action.phase === 'pending') pendingHumanActionCount += 1
  }
  const value: TeamSelectionSnapshot = {
    team: { id: team.id, depth: team.depth, maxTeamDepth: team.maxTeamDepth, phase: team.phase,
      cursor: team.cursor, createdAt: team.createdAt, updatedAt: team.updatedAt,
      ...team.parentTeamId === undefined ? {} : { parentTeamId: team.parentTeamId },
      ...team.parentTaskId === undefined ? {} : { parentTaskId: team.parentTaskId },
      ...team.workspacePath === undefined ? {} : { workspacePath: team.workspacePath },
      ...team.archivedAt === undefined ? {} : { archivedAt: team.archivedAt } },
    goal: { revision: team.goal.revision, phase: team.goal.phase, objective: textSummary(team.goal.objective, maxTextBytes) },
    coordinator,
    ...team.cancellation === undefined ? {} : { cancellation: { reason: textSummary(team.cancellation.reason.message, maxTextBytes) } },
    ...projection.humanActions === undefined ? {} : { pendingHumanActionCount: pendingHumanActionCount },
    ...team.stallReason === undefined ? {} : { stallReason: {
      code: team.stallReason.code, message: textSummary(team.stallReason.message, maxTextBytes),
    } },
    ...team.closure === undefined ? {} : { closureKind: team.closure.kind },
    counts: { participants: projection.participants.size, activations: projection.activations.size,
      tasks, channels: projection.channelIds.size, workflowPlans: projection.workflowPlans.size },
  }
  const structuralStrings = [team.id, team.parentTeamId, team.parentTaskId, team.workspacePath, team.stallReason?.code,
    ...coordinator.kind === 'bound' ? [coordinator.binding.provider, coordinator.binding.sessionId,
      coordinator.binding.activation.id, coordinator.binding.activation.teamId, coordinator.binding.activation.participantId] : []]
  if (structuralStrings.some(text => text !== undefined && text.length > maxBytes)) {
    return { ok: false, reason: 'identity' }
  }
  if (includeMetadata) {
    const metadata: NonNullable<TeamSelectionSnapshot['metadata']> = projection.budgets === undefined
      ? { kind: 'unavailable', reason: 'not-provided' }
      : { kind: 'available', goal: team.goal, budgets: projection.budgets,
        ...projection.usage === undefined ? {} : { usage: projection.usage } }
    const complete = { ...value, metadata }
    if (utf8.encode(JSON.stringify(complete)).byteLength <= maxBytes) return { ok: true, value: structuredClone(complete) }
    const bounded = { ...value, metadata: { kind: 'unavailable' as const, reason: 'too-large' as const } }
    return utf8.encode(JSON.stringify(bounded)).byteLength <= maxBytes ? { ok: true, value: bounded } : { ok: false, reason: 'metadata' }
  }
  if (utf8.encode(JSON.stringify(value)).byteLength > maxBytes) {
    return { ok: false, reason: 'metadata' }
  }
  return { ok: true, value }
}

/** Bounded member lookup outcome; missing membership never falls back to another Team. */
export type TeamMemberSessionProjection =
  | { readonly ok: true; readonly value: TeamMemberSessionSnapshot }
  | { readonly ok: false; readonly reason: 'missing-participant' | 'missing-binding' | 'too-large' }

/** Resolve the latest published binding of an exact member, including offline epochs.
 * @param source - authoritative member and activation collections of the selected Team.
 * @param participantId - exact retained member identity.
 * @param maxBytes - total UTF-8 JSON allowance for the returned binding.
 * @returns bounded binding or explicit absence/size failure, without starting an Agent.
 */
export function projectMemberSession(
  source: Pick<TeamSelectionSource, 'participants' | 'activations'>,
  participantId: ParticipantId,
  maxBytes: number,
): TeamMemberSessionProjection {
  if (!source.participants.has(participantId)) return { ok: false, reason: 'missing-participant' }
  let binding: ActivationBindingSnapshot | undefined
  for (const candidate of source.activations.values()) {
    if (candidate.activation.participantId === participantId) binding = candidate
  }
  if (binding === undefined) return { ok: false, reason: 'missing-binding' }
  const value = { activation: { ...binding.activation }, sessionId: binding.sessionId, provider: binding.provider }
  if ([value.activation.id, value.activation.teamId, value.activation.participantId, value.sessionId, value.provider]
    .some(text => text.length > maxBytes) || utf8.encode(JSON.stringify(value)).byteLength > maxBytes) {
    return { ok: false, reason: 'too-large' }
  }
  return { ok: true, value }
}

/** Authoritative maps needed by summary collection readers. */
export interface TeamBrowseSource {
  readonly team: TeamSnapshot
  readonly participants: ReadonlyMap<ParticipantId, ParticipantSnapshot>
  readonly tasks: ReadonlyMap<TeamTaskId, TeamTaskSnapshot>
  readonly workflowPlans: ReadonlyMap<TeamWorkflowPlanId, TeamWorkflowPlanSnapshot>
}

/** A complete bounded page or an explicit failure to fit one indivisible row. */
export type TeamBrowseProjection =
  | { readonly ok: true; readonly value: TeamBrowsePage }
  | { readonly ok: false; readonly reason: 'owner' | 'metadata' | 'row' }

/** Project a byte- and row-limited response without copying execution history.
 * @param source - authoritative Team collections under their serializer.
 * @param request - exact Team, collection, ordinal cursor and resolved row limit.
 * @param maxTextBytes - UTF-8 allowance for each displayed text prefix.
 * @param maxBytes - UTF-8 allowance for the complete response, including cursors.
 * @returns summaries or an explicit oversized-row/metadata/ownership failure. Ordinal prefix work is reported as scanned.
 */
export function projectTeamBrowse(
  source: TeamBrowseSource, request: TeamBrowseSpec, maxTextBytes: number, maxBytes: number,
): TeamBrowseProjection {
  if (source.team.id !== request.teamId) return { ok: false, reason: 'owner' }
  const textLimit = Math.min(maxTextBytes, maxBytes)
  switch (request.kind) {
    case 'tasks': return browseRows(source.tasks, source.team, request, maxBytes, (task): TeamTaskSummary => {
      const ownerId = task.lease?.participantId ?? task.attemptHistory.at(-1)?.participantId
      return { id: task.id, teamId: task.teamId, revision: task.revision, phase: task.phase,
        subject: textSummary(task.subject, textLimit), executionKind: task.execution.kind,
        ...ownerId === undefined ? {} : { ownerId },
        ...task.reviewPolicy.kind === 'participant' ? { reviewerId: task.reviewPolicy.reviewerId } : {},
        ...task.delegation?.childTeamId === undefined ? {} : { childTeamId: task.delegation.childTeamId },
        ...task.workflowPlanId === undefined ? {} : { workflowPlanId: task.workflowPlanId },
        priority: task.priority, attemptCount: task.attemptCount, maxAttempts: task.maxAttempts,
        dependencyCount: task.blockedBy.length, reviewCount: task.reviewHistory.length,
        hasLease: task.lease !== undefined, cancellationRequested: task.cancellation !== undefined }
    })
    case 'members': return browseRows(source.participants, source.team, request, maxBytes, (member): TeamMemberSummary => ({
      id: member.id, teamId: member.teamId, kind: member.kind, phase: member.phase,
      displayName: textSummary(member.displayName, textLimit), role: member.role,
      capabilityCount: member.capabilities.length,
    }))
    case 'workflowPlans': return browseRows(source.workflowPlans, source.team, request, maxBytes, (workflow): TeamWorkflowSummary => ({
      id: workflow.id, teamId: workflow.teamId, revision: workflow.revision, phase: workflow.phase,
      name: textSummary(workflow.plan.name, textLimit), taskCount: workflow.plan.tasks.length,
      boundTaskCount: workflow.taskBindings.length,
      ...workflow.channelId === undefined ? {} : { channelId: workflow.channelId },
    }))
    default: return assertNever(request.kind)
  }
}

type BrowseRow = TeamTaskSummary | TeamMemberSummary | TeamWorkflowSummary

/** Include the next look-ahead and continuation metadata before admitting each row. */
function browseRows<Id, Value>(values: ReadonlyMap<Id, Value>, team: TeamSnapshot, request: TeamBrowseSpec,
  maxBytes: number, project: (value: Value) => BrowseRow): TeamBrowseProjection {
  const items: BrowseRow[] = []
  const header = { kind: request.kind, teamId: team.id, teamCursor: team.cursor, total: values.size }
  if (team.id.length > maxBytes) return { ok: false, reason: 'metadata' }
  const empty = { ...header, scanned: 0, items: [] } as TeamBrowsePage
  if (utf8.encode(JSON.stringify(empty)).byteLength > maxBytes) return { ok: false, reason: 'metadata' }
  if (request.afterCursor >= values.size - 1) return { ok: true, value: empty }
  let itemBytes = 0
  const pageBytes = (position: number) => utf8.encode(JSON.stringify({ ...header,
    scanned: Math.min(position + 2, values.size), items: [],
    ...position < values.size - 1 ? { nextCursor: position } : {},
  })).byteLength
  let position = -1
  let scanned = 0
  let nextCursor: number | undefined
  for (const value of values.values()) {
    position += 1
    scanned += 1
    if (position <= request.afterCursor) continue
    if (items.length >= request.limit) { nextCursor = position - 1; break }
    const row = project(value)
    if (row.teamId !== team.id) return { ok: false, reason: 'owner' }
    const oversizedIdentity = Object.values(row).some(value => typeof value === 'string' && value.length > maxBytes)
    const rowBytes = oversizedIdentity ? maxBytes + 1 : utf8.encode(JSON.stringify(row)).byteLength
    const separatorBytes = items.length === 0 ? 0 : 1
    if (pageBytes(position) + itemBytes + separatorBytes + rowBytes > maxBytes) {
      if (items.length === 0) return { ok: false, reason: 'row' }
      nextCursor = position - 1
      break
    }
    itemBytes += separatorBytes + rowBytes
    items.push(row)
  }
  // The closed kind switch supplies exactly one projector; rows never mix collection types.
  const page = { ...header, scanned, items, ...nextCursor === undefined ? {} : { nextCursor } } as TeamBrowsePage
  return { ok: true, value: page }
}

/** Reject an unhandled future collection tag at its exhaustive projection switch. */
function assertNever(value: never): never {
  throw new Error(`Unhandled Team browse collection: ${String(value)}`)
}

/** Project one exact human action under the provider's response byte allowance.
 * @param action - Authoritative action selected by its map key, or absent.
 * @param maxBytes - Maximum UTF-8 JSON response bytes.
 * @returns a detached current action or an explicit missing/oversized result.
 */
export function projectHumanAction(action: TeamHumanActionSnapshot | undefined, maxBytes: number):
  { readonly ok: true; readonly value: TeamHumanActionSnapshot } | { readonly ok: false; readonly reason: 'missing' | 'too-large' } {
  if (action === undefined) return { ok: false, reason: 'missing' }
  if (utf8.encode(JSON.stringify(action)).byteLength > maxBytes) return { ok: false, reason: 'too-large' }
  return { ok: true, value: structuredClone(action) }
}
