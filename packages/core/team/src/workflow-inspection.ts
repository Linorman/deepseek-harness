/** Bounded workflow inspection without copying a complete plan or task result history. */
import { teamTextSummary } from './display-text.ts'
import type { TeamWorkflowInspectSpec, TeamWorkflowInspection, TeamWorkflowInspectionTask, TeamWorkflowInspectionTaskRef,
  TeamWorkflowPlanSnapshot, TeamWorkflowTaskTemplate } from './types.ts'

/** An exact workflow window or a scope, revision or byte-capacity failure. */
export type WorkflowInspectionProjection =
  | { readonly ok: true; readonly value: TeamWorkflowInspection }
  | { readonly ok: false; readonly reason: 'owner' | 'revision' | 'metadata' | 'row' }

/** Read task labels and bindings at a single workflow revision.
 * @param plan - Authoritative retained plan under the Team serializer.
 * @param teamCursor - Current Team cursor.
 * @param request - Resolved row window and optional revision fence.
 * @param maxTextBytes - Display-prefix allowance.
 * @param maxBytes - Complete response byte allowance.
 * @returns one detached window; lookup work is reported in scanned.
 */
export function projectWorkflowInspection(plan: TeamWorkflowPlanSnapshot, teamCursor: number,
  request: TeamWorkflowInspectSpec, maxTextBytes: number, maxBytes: number): WorkflowInspectionProjection {
  if (plan.teamId !== request.teamId || plan.id !== request.planId) return { ok: false, reason: 'owner' }
  if (request.expectedRevision !== undefined && request.expectedRevision !== plan.revision) return { ok: false, reason: 'revision' }
  const record = { id: plan.id, teamId: plan.teamId, revision: plan.revision, phase: plan.phase,
    name: plan.plan.name, bounds: plan.plan.bounds,
    ...plan.failure === undefined ? {} : { failure: plan.failure },
    ...plan.cancellation === undefined ? {} : { cancellation: plan.cancellation },
    ...plan.result === undefined ? {} : { resultTaskCount: plan.result.tasks.length } }
  const value: { -readonly [K in keyof TeamWorkflowInspection]: TeamWorkflowInspection[K] } = {
    record, teamCursor, startCursor: request.afterCursor, total: plan.plan.tasks.length, scanned: 0, items: [],
  }
  const utf8 = new TextEncoder()
  const fits = () => utf8.encode(JSON.stringify(value)).byteLength <= maxBytes
  if ([plan.id, plan.teamId, record.name, record.failure?.code, record.failure?.message,
    record.cancellation?.code, record.cancellation?.message].some(text => text !== undefined && text.length > maxBytes) || !fits()) {
    return { ok: false, reason: 'metadata' }
  }
  const reference = (template: TeamWorkflowTaskTemplate): TeamWorkflowInspectionTaskRef => {
    let taskId
    for (const binding of plan.taskBindings) {
      value.scanned += 1
      if (binding.templateId === template.id) { taskId = binding.taskId; break }
    }
    return { templateId: template.id, subject: teamTextSummary(template.subject, Math.min(maxTextBytes, maxBytes)),
      ...taskId === undefined ? {} : { taskId } }
  }
  const items: TeamWorkflowInspectionTask[] = []
  value.items = items
  for (let index = request.afterCursor + 1; index < plan.plan.tasks.length; index++) {
    if (items.length === request.limit) { value.nextCursor = index - 1; break }
    const template = plan.plan.tasks[index]
    // v8 ignore next -- the durable parser validates dense arrays and plan templates are immutable during this serialized read.
    if (template === undefined) throw new Error('Workflow template is missing at its retained index')
    value.scanned += 1
    const blockedBy: TeamWorkflowInspectionTaskRef[] = []
    const row = { ...reference(template), blockedBy }
    items.push(row)
    if (index < plan.plan.tasks.length - 1) value.nextCursor = index
    else delete value.nextCursor
    let oversized = row.templateId.length > maxBytes || (row.taskId?.length ?? 0) > maxBytes || !fits()
    for (const id of template.blockedBy) {
      if (oversized) break
      let dependency
      for (const candidate of plan.plan.tasks) {
        value.scanned += 1
        if (candidate.id === id) { dependency = candidate; break }
      }
      // v8 ignore next -- the immutable durable plan has already passed dependency validation.
      if (dependency === undefined) throw new Error('Workflow dependency is missing from its plan')
      const dependencyRef = reference(dependency)
      blockedBy.push(dependencyRef)
      oversized = dependencyRef.templateId.length > maxBytes || (dependencyRef.taskId?.length ?? 0) > maxBytes || !fits()
    }
    if (oversized) {
      items.pop()
      if (items.length === 0) return { ok: false, reason: 'row' }
      value.nextCursor = index - 1
      if (!fits()) return { ok: false, reason: 'metadata' }
      break
    }
  }
  return { ok: true, value: structuredClone(value) }
}
