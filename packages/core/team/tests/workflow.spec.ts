import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import {
  teamWorkflowPlanSchema,
  validateTeamWorkflowPlan,
} from '../src/index.ts'
import type { TeamWorkflowCondition, TeamWorkflowPlan, TeamWorkflowTarget } from '../src/index.ts'

/** Build the smallest valid declarative plan used by validation cases. */
function plan(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    name: 'validation-plan',
    tasks: [
      {
        id: 'first',
        subject: 'First task',
        description: 'Perform the first task.',
        blockedBy: [],
        requiredCapabilities: ['worker'],
        priority: 0,
        readScopes: [],
        writeScopes: [],
        workspaceMode: 'shared',
        budget: {},
        reviewPolicy: { kind: 'none' },
        maxAttempts: 1,
      },
      {
        id: 'second',
        subject: 'Second task',
        description: 'Perform the second task.',
        blockedBy: ['first'],
        requiredCapabilities: ['worker'],
        priority: 0,
        readScopes: [],
        writeScopes: [],
        workspaceMode: 'shared',
        budget: {},
        reviewPolicy: { kind: 'none' },
        maxAttempts: 1,
      },
    ],
    bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 },
    channel: {
      participantRoles: ['coordinator', 'worker'],
      graph: {
        initial: { kind: 'participant', role: 'coordinator' },
        transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }],
        maxTurns: 1,
      },
    },
    result: { kind: 'task-results', taskTemplateIds: ['first', 'second'] },
    ...overrides,
  }
}

/** Valid parsed input for exercising semantic checks through the exported validator. */
function typedPlan(): TeamWorkflowPlan {
  return teamWorkflowPlanSchema.parse(plan())
}

/** Complete first template with one caller-selected semantic variation. */
function withTask(input: TeamWorkflowPlan, changes: Partial<TeamWorkflowPlan['tasks'][number]>): TeamWorkflowPlan {
  return { ...input, tasks: [{ ...input.tasks[0]!, ...changes }, ...input.tasks.slice(1)] }
}

describe('TeamWorkflowPlan validation', () => {
  it('returns a stable topological order while preserving source-order ties', () => {
    const parsed = teamWorkflowPlanSchema.parse(plan({
      tasks: [
        {
          ...plan().tasks[1],
          blockedBy: [],
        },
        plan().tasks[0],
      ],
      result: { kind: 'task-results', taskTemplateIds: ['first'] },
      bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 },
    }))
    expect(validateTeamWorkflowPlan(parsed).map(task => task.id)).toEqual(['second', 'first'])
  })

  it.each([
    ['a cycle', {
      tasks: [
        { ...plan().tasks[0], blockedBy: ['second'] },
        plan().tasks[1],
      ],
    }],
    ['an unknown dependency', { tasks: [{ ...plan().tasks[0], blockedBy: ['missing'] }, plan().tasks[1]] }],
    ['a result reference', { result: { kind: 'task-results', taskTemplateIds: ['missing'] } }],
    ['an excessive parallel bound', { bounds: { maxTasks: 2, maxParallelism: 3, maxTotalAttempts: 2 } }],
  ])('rejects %s before durable admission', (_label, overrides) => {
    expect(() => teamWorkflowPlanSchema.parse(plan(overrides))).toThrow()
  })

  it('retains versioned extension refs as JSON and validates their graph shape', () => {
    const parsed = teamWorkflowPlanSchema.parse(plan({
      channel: {
        participantRoles: ['coordinator', 'worker'],
        graph: {
          initial: { kind: 'participant', role: 'coordinator' },
          transitions: [{
            condition: { kind: 'extension', name: 'decision', version: 2, config: { mode: 'strict' } },
            target: { kind: 'extension', name: 'router', version: 4, config: null },
          }],
          defaultTarget: { kind: 'terminate' },
          maxTurns: 3,
        },
      },
    }))
    expect(parsed.channel.graph.transitions[0]?.condition).toEqual({
      kind: 'extension', name: 'decision', version: 2, config: { mode: 'strict' },
    })
  })

  it('keeps generated acyclic chains topologically ordered for every bounded task count', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 12 }), (count) => {
      const chain = Array.from({ length: count }, (_, index) => ({
        id: `task-${String(index)}`,
        subject: `Task ${String(index)}`,
        description: `Run task ${String(index)}.`,
        blockedBy: index === 0 ? [] : [`task-${String(index - 1)}`],
        requiredCapabilities: ['worker'],
        priority: 0,
        readScopes: [],
        writeScopes: [],
        workspaceMode: 'shared',
        budget: {},
        reviewPolicy: { kind: 'none' },
        maxAttempts: 1,
      })).reverse()
      const parsed = teamWorkflowPlanSchema.parse(plan({
        tasks: chain,
        bounds: { maxTasks: count, maxParallelism: 1, maxTotalAttempts: count },
        result: { kind: 'task-results', taskTemplateIds: chain.map(task => task.id) },
      }))
      const expected = Array.from({ length: count }, (_, index) => `task-${String(index)}`)
      expect(validateTeamWorkflowPlan(parsed).map(task => task.id)).toEqual(expected)
    }), { numRuns: 40 })
  })

  it.each<{
    readonly name: string
    readonly update: (input: TeamWorkflowPlan) => TeamWorkflowPlan
    readonly reason: string
  }>([
    { name: 'empty name', update: input => ({ ...input, name: '' }), reason: 'must be non-empty and normalized' },
    { name: 'unnormalized name', update: input => ({ ...input, name: ' workflow' }), reason: 'must be non-empty and normalized' },
    { name: 'empty tasks', update: input => ({ ...input, tasks: [] }), reason: 'at least one task' },
    { name: 'duplicate task ids', update: input => ({ ...input, tasks: [input.tasks[0]!, input.tasks[0]!] }), reason: 'repeats task template' },
    { name: 'self dependency', update: input => withTask(input, { blockedBy: [input.tasks[0]!.id] }), reason: 'cannot depend on itself' },
    { name: 'unknown dependency', update: input => withTask(input, { blockedBy: ['missing' as never] }), reason: 'unknown dependency' },
    { name: 'duplicate dependencies', update: input => ({ ...input, tasks: [input.tasks[0]!, {
      ...input.tasks[1]!, blockedBy: [input.tasks[0]!.id, input.tasks[0]!.id],
    }] }), reason: 'dependencies must not contain duplicates' },
    { name: 'duplicate capabilities', update: input => withTask(input, { requiredCapabilities: ['worker', 'worker'] }), reason: 'required capabilities must not contain duplicates' },
    { name: 'empty read scope', update: input => withTask(input, { readScopes: [''] }), reason: 'read scopes must be non-empty' },
    { name: 'duplicate write scopes', update: input => withTask(input, { writeScopes: ['src', 'src'] }), reason: 'write scopes must not contain duplicates' },
    { name: 'zero task bound', update: input => ({ ...input, bounds: { ...input.bounds, maxTasks: 0 } }), reason: 'maxTasks must be a positive safe integer' },
    { name: 'fractional parallelism', update: input => ({ ...input, bounds: { ...input.bounds, maxParallelism: 1.5 } }), reason: 'maxParallelism must be a positive safe integer' },
    { name: 'too many tasks', update: input => ({ ...input, bounds: { ...input.bounds, maxTasks: 1 } }), reason: 'contains 2 tasks but maxTasks is 1' },
    { name: 'excessive parallelism', update: input => ({ ...input, bounds: { ...input.bounds, maxParallelism: 3 } }), reason: 'maxParallelism must not exceed maxTasks' },
    { name: 'insufficient total attempts', update: input => ({ ...input, bounds: { ...input.bounds, maxTotalAttempts: 1 } }), reason: 'below its task attempt minimum' },
    { name: 'zero task attempts', update: input => withTask(input, { maxAttempts: 0 }), reason: 'maxAttempts must be a positive safe integer' },
    { name: 'overflowing total attempts', update: input => ({
      ...withTask(input, { maxAttempts: Number.MAX_SAFE_INTEGER }),
      bounds: { ...input.bounds, maxTotalAttempts: Number.MAX_SAFE_INTEGER },
    }), reason: 'bounds exceed the safe integer range' },
    { name: 'one role', update: input => ({ ...input, channel: { ...input.channel, participantRoles: ['coordinator'] } }), reason: 'at least two participant roles' },
    { name: 'duplicate roles', update: input => ({ ...input, channel: { ...input.channel, participantRoles: ['coordinator', 'coordinator'] } }), reason: 'repeats participant role' },
    { name: 'unknown reviewer role', update: input => withTask(input, { reviewPolicy: { kind: 'participant', reviewerRole: 'reviewer' } }), reason: 'is not a channel participant role' },
    { name: 'empty result selection', update: input => ({ ...input, result: { ...input.result, taskTemplateIds: [] } }), reason: 'at least one task' },
    { name: 'duplicate result selection', update: input => ({ ...input, result: {
      ...input.result, taskTemplateIds: [input.tasks[0]!.id, input.tasks[0]!.id],
    } }), reason: 'result task templates must not contain duplicates' },
  ])('rejects $name through the semantic validator', ({ update, reason }) => {
    const input = update(typedPlan())
    expect(() => validateTeamWorkflowPlan(input)).toThrow(reason)
    expect(teamWorkflowPlanSchema.safeParse(input).success).toBe(false)
  })

  it('keeps source-order priority when a dependency unlocks before an already-ready task', () => {
    const input = typedPlan()
    const first = input.tasks[0]!
    const second = input.tasks[1]!
    const third = { ...first, id: 'third' as never, blockedBy: [first.id, second.id] }
    const fourth = { ...first, id: 'fourth' as never }
    const arranged = { ...input, tasks: [third, first, second, fourth],
      bounds: { maxTasks: 4, maxParallelism: 2, maxTotalAttempts: 4 } }
    expect(validateTeamWorkflowPlan(arranged).map(task => task.id)).toEqual([first.id, second.id, third.id, fourth.id])
  })

  it('resolves a declared reviewer role without changing task order', () => {
    const input = withTask(typedPlan(), { reviewPolicy: { kind: 'participant', reviewerRole: 'coordinator' } })
    expect(validateTeamWorkflowPlan(input)).toEqual(input.tasks)
  })

  it.each<TeamWorkflowCondition>([
    { kind: 'always' },
    { kind: 'envelope-kind', value: 'answer' },
    { kind: 'payload-present', path: 'result.output' },
    { kind: 'payload-equals', path: 'result.code', value: 'ok' },
    { kind: 'extension', name: 'decision', version: 1, config: null },
  ])('accepts the $kind graph condition', (condition) => {
    const input = typedPlan()
    const changed = { ...input, channel: { ...input.channel, graph: {
      ...input.channel.graph, transitions: [{ condition, target: { kind: 'terminate' as const } }],
    } } }
    expect(validateTeamWorkflowPlan(changed)).toEqual(input.tasks)
    expect(teamWorkflowPlanSchema.parse(changed)).toEqual(changed)
  })

  it.each<TeamWorkflowTarget>([
    { kind: 'participant', role: 'worker' },
    { kind: 'round-robin' },
    { kind: 'stay' },
    { kind: 'return-to-initiator' },
    { kind: 'terminate' },
    { kind: 'extension', name: 'router', version: 2, config: {} },
  ])('accepts the $kind transition target', (target) => {
    const input = typedPlan()
    const changed = { ...input, channel: { ...input.channel, graph: {
      ...input.channel.graph, transitions: [{ condition: { kind: 'always' as const }, target }], defaultTarget: target,
    } } }
    expect(validateTeamWorkflowPlan(changed)).toEqual(input.tasks)
    expect(teamWorkflowPlanSchema.parse(changed)).toEqual(changed)
  })

  it.each<{
    readonly name: string
    readonly graph: Partial<TeamWorkflowPlan['channel']['graph']>
    readonly reason: string
  }>([
    { name: 'unknown role', graph: { initial: { kind: 'participant', role: 'absent' } }, reason: 'names unknown participant role' },
    { name: 'immediate termination', graph: { initial: { kind: 'terminate' } }, reason: 'cannot terminate before the first Envelope' },
    { name: 'zero graph turns', graph: { maxTurns: 0 }, reason: 'maxTurns must be a positive safe integer' },
    { name: 'zero extension version', graph: { initial: { kind: 'extension', name: 'router', version: 0, config: {} } }, reason: 'version must be a positive safe integer' },
    { name: 'fractional extension version', graph: { defaultTarget: { kind: 'extension', name: 'router', version: 1.5, config: {} } }, reason: 'version must be a positive safe integer' },
    { name: 'invalid condition path', graph: { transitions: [{
      condition: { kind: 'payload-present', path: 'result..value' }, target: { kind: 'terminate' },
    }] }, reason: 'path is invalid' },
  ])('rejects $name in the graph', ({ graph, reason }) => {
    const input = typedPlan()
    expect(() => validateTeamWorkflowPlan({ ...input, channel: {
      ...input.channel, graph: { ...input.channel.graph, ...graph },
    } })).toThrow(reason)
  })

  it.each(['condition', 'target'] as const)('rejects an unknown JSON %s kind before semantic validation', (field) => {
    const input = plan()
    const transition = { condition: { kind: 'always' }, target: { kind: 'terminate' }, [field]: { kind: 'unregistered-json-kind' } }
    expect(teamWorkflowPlanSchema.safeParse({ ...input, channel: { ...input.channel, graph: {
      ...input.channel.graph, transitions: [transition],
    } } })).toMatchObject({ success: false, error: { issues: [
      { code: 'invalid_union', path: ['channel', 'graph', 'transitions', 0, field, 'kind'] },
    ] } })
  })

})
