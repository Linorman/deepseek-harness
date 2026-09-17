/** Bounded task records and indexed history pages for product inspection.
 * Private artifact references remain in the authoritative task, never in this read projection.
 * @module @clocky/clocky-team/task-inspection
 */
import type {
  TaskAttemptIntegrationResult, TaskAttemptResult, TaskAttemptSnapshot, TeamTaskInspection, TeamTaskInspectSpec,
  TeamTaskReviewDecision, TeamTaskSnapshot,
} from './types.ts'

/** Inspection result or a typed owner, revision, or response-capacity failure. */
export type TeamTaskInspectionProjection =
  | { readonly ok: true; readonly value: TeamTaskInspection }
  | { readonly ok: false; readonly reason: 'owner' | 'revision' | 'metadata' | 'row' }

const utf8 = new TextEncoder()

/** Project one task without copying histories outside the selected page.
 * @param task - Authoritative task under its owning Team serializer.
 * @param teamCursor - Current Team journal watermark.
 * @param request - Resolved task selection, revision and page limits.
 * @param maxBytes - Complete UTF-8 JSON response allowance, including wrappers and continuation.
 * @returns detached public inspection data or the exact refusal; array cursors do not scan the preceding prefix.
 */
export function projectTaskInspection(task: TeamTaskSnapshot, teamCursor: number,
  request: TeamTaskInspectSpec, maxBytes: number): TeamTaskInspectionProjection {
  if (task.id !== request.taskId || task.teamId !== request.teamId) return { ok: false, reason: 'owner' }
  if (request.expectedRevision !== undefined && request.expectedRevision !== task.revision) return { ok: false, reason: 'revision' }
  const header = { teamId: task.teamId, taskId: task.id, teamCursor, revision: task.revision }
  let history: readonly TaskAttemptSnapshot[] | readonly TeamTaskReviewDecision[]
  switch (request.section) {
    case 'record': {
      const { attemptHistory, reviewHistory, ...record } = task
      const value = { ...header, section: 'record' as const, task: record,
        history: { attempts: attemptHistory.length, reviews: reviewHistory.length } }
      return detached(value, maxBytes, 'metadata')
    }
    case 'attempts': history = task.attemptHistory; break
    case 'reviews': history = task.reviewHistory; break
    // v8 ignore next -- the closed request schema rejects every other section before projection.
    default: return assertNever(request)
  }
  const metadata = { ...header, section: request.section, startCursor: request.afterCursor, total: history.length }
  const items: Array<TaskAttemptSnapshot | TeamTaskReviewDecision> = []
  // The section selects one immutable array, so each page contains exactly one row type.
  const page = (scanned: number, nextCursor?: number): TeamTaskInspection => ({ ...metadata, items, scanned,
    ...nextCursor === undefined ? {} : { nextCursor } }) as TeamTaskInspection
  if (!fits(page(0), maxBytes)) return { ok: false, reason: 'metadata' }
  let scanned = 0
  let position = Math.min(request.afterCursor + 1, history.length)
  for (; position < history.length && items.length < request.limit; position++) {
    // Parsed history arrays are dense, and position is within the selected array.
    const row = history[position] as (typeof history)[number]
    scanned++
    items.push('outcome' in row ? publicAttempt(row) : row)
    if (!fits(page(scanned, position < history.length - 1 ? position : undefined), maxBytes)) {
      items.pop()
      if (items.length === 0) return { ok: false, reason: 'row' }
      return detached(page(scanned, position - 1), maxBytes, 'metadata')
    }
  }
  return detached(page(scanned, position < history.length ? position - 1 : undefined), maxBytes, 'metadata')
}

/** Only completed attempts carry artifact-bearing result data. */
function publicAttempt(attempt: TaskAttemptSnapshot): TaskAttemptSnapshot {
  switch (attempt.outcome.kind) {
    case 'completed': return { ...attempt, outcome: { ...attempt.outcome, result: withoutPrivateTaskArtifacts(attempt.outcome.result) } }
    case 'released': case 'lease-expired': case 'failed': case 'cancelled': return attempt
    // v8 ignore next -- durable attempt parsing admits only the closed outcome union.
    default: return assertNever(attempt.outcome)
  }
}

/** Remove private artifact references from a result and its optional integration metadata.
 * @param result - Complete authoritative result retained by the task.
 * @returns a public metadata projection; the original result remains unchanged.
 */
export function withoutPrivateTaskArtifacts(result: TaskAttemptResult): TaskAttemptResult {
  return { ...result,
    ...result.artifacts === undefined ? {} : { artifacts: result.artifacts.filter(artifact => artifact.visibility !== 'private') },
    ...result.integration === undefined ? {} : { integration: publicIntegration(result.integration) },
  }
}

/** A private proposal must be omitted before spreading the remaining integration metadata. */
function publicIntegration(integration: TaskAttemptIntegrationResult): TaskAttemptIntegrationResult {
  const { proposalArtifact, ...rest } = integration
  return { ...rest,
    ...proposalArtifact === undefined || proposalArtifact.visibility === 'private' ? {} : { proposalArtifact },
    ...integration.artifacts === undefined ? {} : { artifacts: integration.artifacts.filter(artifact => artifact.visibility !== 'private') },
  }
}

/** The complete emitted value, rather than its individual rows, determines capacity. */
function fits(value: TeamTaskInspection, maxBytes: number): boolean {
  return utf8.encode(JSON.stringify(value)).byteLength <= maxBytes
}

/** Clone only a result proven to fit, so callers cannot mutate the authoritative task. */
function detached(value: TeamTaskInspection, maxBytes: number, reason: 'metadata' | 'row'): TeamTaskInspectionProjection {
  return fits(value, maxBytes) ? { ok: true, value: structuredClone(value) } : { ok: false, reason }
}

/** Reject a future section or outcome until its inspection policy is explicit. */
/* v8 ignore next 3 -- both call sites are exhaustive over validated closed discriminants. */
function assertNever(value: never): never {
  throw new Error(`Unhandled task inspection variant: ${String(value)}`)
}
