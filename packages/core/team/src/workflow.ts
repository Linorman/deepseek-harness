/** Pure validation and deterministic ordering for declarative Team workflows. @module @clocky/clocky-team/workflow */

import type {
  TeamWorkflowCondition,
  TeamWorkflowGraph,
  TeamWorkflowPlan,
  TeamWorkflowTarget,
  TeamWorkflowTaskTemplate,
  TeamWorkflowTaskTemplateId,
  TeamWorkflowTransition,
} from './types.ts'

const CONDITION_PATH = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/u

/**
 * Validate one complete workflow plan and return its stable topological task
 * order. The input order breaks ties, so every Consumer creates the same
 * durable task sequence after a retry or restart.
 * @param plan - parsed JSON workflow plan.
 * @returns task templates in deterministic dependency order.
 * @throws when the plan contains an invalid graph, bound, extension reference, or result projection.
 */
export function validateTeamWorkflowPlan(plan: TeamWorkflowPlan): readonly TeamWorkflowTaskTemplate[] {
  requireText(plan.name, 'workflow plan name')
  if (plan.tasks.length === 0) throw new Error('workflow plan must contain at least one task')
  const taskIds = new Set<TeamWorkflowTaskTemplateId>()
  for (const [index, task] of plan.tasks.entries()) {
    requireText(task.id, `workflow task ${index} id`)
    if (taskIds.has(task.id)) throw new Error(`workflow plan repeats task template '${task.id}'`)
    taskIds.add(task.id)
    requireText(task.subject, `workflow task '${task.id}' subject`)
    requireText(task.description, `workflow task '${task.id}' description`)
    assertDistinct(task.blockedBy, `workflow task '${task.id}' dependencies`)
    assertDistinct(task.requiredCapabilities, `workflow task '${task.id}' required capabilities`)
    assertDistinct(task.readScopes, `workflow task '${task.id}' read scopes`)
    assertDistinct(task.writeScopes, `workflow task '${task.id}' write scopes`)
    if (task.reviewPolicy.kind === 'participant') requireText(task.reviewPolicy.reviewerRole, `workflow task '${task.id}' reviewer role`)
    for (const dependency of task.blockedBy) {
      if (!taskIds.has(dependency) && !plan.tasks.some(candidate => candidate.id === dependency)) {
        throw new Error(`workflow task '${task.id}' references unknown dependency '${dependency}'`)
      }
      if (dependency === task.id) throw new Error(`workflow task '${task.id}' cannot depend on itself`)
    }
  }

  const maxTasks = positiveInteger(plan.bounds.maxTasks, 'workflow plan maxTasks')
  const maxParallelism = positiveInteger(plan.bounds.maxParallelism, 'workflow plan maxParallelism')
  const maxTotalAttempts = positiveInteger(plan.bounds.maxTotalAttempts, 'workflow plan maxTotalAttempts')
  if (plan.tasks.length > maxTasks) throw new Error(`workflow plan contains ${String(plan.tasks.length)} tasks but maxTasks is ${String(maxTasks)}`)
  if (maxParallelism > maxTasks) throw new Error('workflow plan maxParallelism must not exceed maxTasks')
  let minimumAttempts = 0
  for (const task of plan.tasks) {
    minimumAttempts = safeAdd(minimumAttempts, positiveInteger(task.maxAttempts, `workflow task '${task.id}' maxAttempts`))
  }
  if (minimumAttempts > maxTotalAttempts) {
    throw new Error(`workflow plan maxTotalAttempts ${String(maxTotalAttempts)} is below its task attempt minimum ${String(minimumAttempts)}`)
  }

  const roleSet = new Set<string>()
  if (plan.channel.participantRoles.length < 2) throw new Error('workflow channel requires at least two participant roles')
  for (const role of plan.channel.participantRoles) {
    requireText(role, 'workflow channel participant role')
    if (roleSet.has(role)) throw new Error(`workflow channel repeats participant role '${role}'`)
    roleSet.add(role)
  }
  validateGraph(plan.channel.graph, roleSet)
  for (const task of plan.tasks) {
    if (task.reviewPolicy.kind === 'participant' && !roleSet.has(task.reviewPolicy.reviewerRole)) {
      throw new Error(`workflow task '${task.id}' reviewer role '${task.reviewPolicy.reviewerRole}' is not a channel participant role`)
    }
  }

  const resultIds = plan.result.taskTemplateIds
  assertDistinct(resultIds, 'workflow result task templates')
  if (resultIds.length === 0) throw new Error('workflow result projection must select at least one task')
  for (const taskId of resultIds) {
    if (!taskIds.has(taskId)) throw new Error(`workflow result projection references unknown task template '${taskId}'`)
  }

  return topologicalOrder(plan.tasks)
}

/**
 * Return a deterministic topological order, preserving source order for ready nodes.
 * Validation fixes every task and dependency id before this synchronous traversal;
 * the private maps retain all entries until ordering completes.
 */
function topologicalOrder(tasks: readonly TeamWorkflowTaskTemplate[]): readonly TeamWorkflowTaskTemplate[] {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const remaining = new Map<TeamWorkflowTaskTemplateId, number>(
    tasks.map(task => [task.id, task.blockedBy.length]),
  )
  const dependents = new Map<TeamWorkflowTaskTemplateId, TeamWorkflowTaskTemplateId[]>()
  for (const task of tasks) {
    for (const dependency of task.blockedBy) {
      const list = dependents.get(dependency) ?? []
      list.push(task.id)
      dependents.set(dependency, list)
    }
  }
  const ready = tasks.filter(task => remaining.get(task.id) === 0).map(task => task.id)
  const result: TeamWorkflowTaskTemplate[] = []
  while (ready.length > 0) {
    const id = ready.shift() as TeamWorkflowTaskTemplateId
    const task = byId.get(id) as TeamWorkflowTaskTemplate
    result.push(task)
    for (const dependent of dependents.get(id) ?? []) {
      const count = remaining.get(dependent) as number
      const next = count - 1
      remaining.set(dependent, next)
      if (next === 0) {
        const sourceIndex = tasks.findIndex(candidate => candidate.id === dependent)
        const insertion = ready.findIndex(candidate => tasks.findIndex(item => item.id === candidate) > sourceIndex)
        if (insertion < 0) ready.push(dependent)
        else ready.splice(insertion, 0, dependent)
      }
    }
  }
  if (result.length !== tasks.length) throw new Error('workflow task dependencies contain a cycle')
  return result
}

/** Validate the graph grammar and every role target without resolving extensions. */
function validateGraph(graph: TeamWorkflowGraph, roles: ReadonlySet<string>): void {
  positiveInteger(graph.maxTurns, 'workflow graph maxTurns')
  validateTarget(graph.initial, roles, 'workflow graph initial target', true)
  for (const [index, transition] of graph.transitions.entries()) validateTransition(transition, roles, index)
  if (graph.defaultTarget !== undefined) validateTarget(graph.defaultTarget, roles, 'workflow graph default target', false)
}

/** Validate one ordered workflow transition. */
function validateTransition(transition: TeamWorkflowTransition, roles: ReadonlySet<string>, index: number): void {
  validateCondition(transition.condition, `workflow transition ${index} condition`)
  validateTarget(transition.target, roles, `workflow transition ${index} target`, false)
}

/** Validate one condition and its versioned extension reference. */
function validateCondition(condition: TeamWorkflowCondition, label: string): void {
  switch (condition.kind) {
    case 'always':
      return
    case 'envelope-kind':
      requireText(condition.value, `${label} value`)
      return
    case 'payload-present':
    case 'payload-equals':
      validatePath(condition.path, label)
      return
    case 'extension':
      validateExtension(condition.name, condition.version, `${label} extension`)
      return
    /* v8 ignore next 2 -- The closed condition union is exhaustive; JSON rejects unknown kinds before semantic validation. */
    default:
      return assertNever(condition, label)
  }
}

/** Validate one target and its role or extension identity. */
function validateTarget(target: TeamWorkflowTarget, roles: ReadonlySet<string>, label: string, initial: boolean): void {
  switch (target.kind) {
    case 'participant':
      requireText(target.role, `${label} role`)
      if (!roles.has(target.role)) throw new Error(`${label} names unknown participant role '${target.role}'`)
      return
    case 'round-robin':
    case 'stay':
    case 'return-to-initiator':
      return
    case 'terminate':
      if (initial) throw new Error(`${label} cannot terminate before the first Envelope`)
      return
    case 'extension':
      validateExtension(target.name, target.version, `${label} extension`)
      return
    /* v8 ignore next 2 -- The closed target union is exhaustive; JSON rejects unknown kinds before semantic validation. */
    default:
      return assertNever(target, label)
  }
}

/** Validate a versioned workflow extension identity without consulting a deployment registry. */
function validateExtension(name: string, version: number, label: string): void {
  requireText(name, `${label} name`)
  if (!Number.isSafeInteger(version) || version < 1) throw new Error(`${label} version must be a positive safe integer`)
}

/** Validate a payload path used by a built-in workflow condition. */
function validatePath(path: string, label: string): void {
  requireText(path, `${label} path`)
  if (!CONDITION_PATH.test(path)) throw new Error(`${label} path is invalid`)
}

/** Require one normalized non-empty text value. */
function requireText(value: string, label: string): void {
  if (value.length === 0 || value.trim() !== value) throw new Error(`${label} must be non-empty and normalized`)
}

/** Reject duplicate labels in one ordered plan collection. */
function assertDistinct(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must not contain duplicates`)
  for (const value of values) requireText(value, label)
}

/** Validate one positive bounded integer. */
function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`)
  return value
}

/** Add two plan bounds without crossing the JSON-safe integer range. */
function safeAdd(left: number, right: number): number {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw new Error('workflow plan bounds exceed the safe integer range')
  return result
}

/** Make an exhaustive failure visible if a closed workflow union changes. */
/* v8 ignore next 3 -- Only exhaustive closed-union defaults call this helper; JSON parsers reject unknown kinds. */
function assertNever(value: never, label: string): never {
  throw new Error(`unknown ${label} kind '${String(value)}'`)
}
