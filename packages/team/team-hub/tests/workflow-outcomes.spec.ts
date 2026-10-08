import { describe, expect, it } from 'vitest'
import { teamTaskIdSchema } from '@clocky/clocky-team'
import type { TeamTaskId, TeamTaskSnapshot, TeamWorkflowPlanSnapshot, TeamWorkflowTaskTemplateId } from '@clocky/clocky-team'
import type { TeamProjection } from '../src/types.ts'
import { workflowOutcomeRecords, workflowTerminalOutcome } from '../src/workflow-outcomes.ts'
import { task as fixtureTask } from './fixtures.ts'

const workflowId = 'workflow-outcome' as TeamWorkflowPlanSnapshot['id']
const firstId = teamTaskIdSchema.parse('workflow-first')
const secondId = teamTaskIdSchema.parse('workflow-second')
const firstTemplate = 'first' as TeamWorkflowTaskTemplateId
const secondTemplate = 'second' as TeamWorkflowTaskTemplateId

function plan(selected: readonly TeamWorkflowTaskTemplateId[] = [firstTemplate, secondTemplate]): TeamWorkflowPlanSnapshot {
  // This pure projection uses the binding and result selection, not admission-only plan fields.
  return { id: workflowId, revision: 1, phase: 'ready',
    taskBindings: [{ templateId: firstTemplate, taskId: firstId }, { templateId: secondTemplate, taskId: secondId }],
    plan: { tasks: [{ id: firstTemplate }, { id: secondTemplate }],
      result: { kind: 'task-results', taskTemplateIds: selected } },
  } as unknown as TeamWorkflowPlanSnapshot
}

function task(id: TeamTaskId, phase: TeamTaskSnapshot['phase'], extra: Partial<TeamTaskSnapshot> = {}): TeamTaskSnapshot {
  return { ...fixtureTask({ id }), phase, ...extra }
}

function projection(tasks: readonly TeamTaskSnapshot[], plans: readonly TeamWorkflowPlanSnapshot[] = []): TeamProjection {
  return { team: { updatedAt: 50 }, tasks: new Map(tasks.map(item => [item.id, item])),
    workflowPlans: new Map(plans.map(item => [item.id, item])) } as unknown as TeamProjection
}

describe('workflow terminal outcome', () => {
  it('waits for complete binding and required terminal result evidence', () => {
    const current = plan()
    const completed = task(firstId, 'completed', { attemptHistory: [{ outcome: {
      kind: 'completed', result: { summary: 'Finished' },
    } } as never] })
    const pending = task(secondId, 'pending')
    expect(workflowTerminalOutcome({ ...current, taskBindings: [current.taskBindings[0]!] },
      new Map([[firstId, completed]]))).toBeUndefined()
    expect(workflowTerminalOutcome(current, new Map([[firstId, completed]]))).toBeUndefined()
    expect(workflowTerminalOutcome(current, new Map([[firstId, completed], [secondId, pending]]))).toBeUndefined()
    expect(workflowTerminalOutcome(plan(['missing' as TeamWorkflowTaskTemplateId]),
      new Map([[firstId, completed], [secondId, task(secondId, 'cancelled')]]))).toBeUndefined()
    expect(workflowTerminalOutcome(current, new Map([[firstId, task(firstId, 'completed')],
      [secondId, task(secondId, 'cancelled')]]))).toBeUndefined()
  })

  it('returns selected results in template order while failed and cancelled tasks decide the aggregate phase', () => {
    const completed = task(firstId, 'completed', { attemptHistory: [{ outcome: {
      kind: 'completed', result: { summary: 'Finished' },
    } } as never] })
    const failed = task(secondId, 'failed', { attemptHistory: [{ outcome: {
      kind: 'failed', failure: { code: 'FAILED', message: 'Worker failed' },
    } } as never] })
    const selected = plan([secondTemplate, firstTemplate])
    const outcome = workflowTerminalOutcome(selected, new Map([[firstId, completed], [secondId, failed]]))
    expect(outcome).toMatchObject({ phase: 'failed', failure: { code: 'WORKFLOW_TASK_FAILED' },
      result: { tasks: [{ templateId: secondTemplate, phase: 'failed', failure: { code: 'FAILED' } },
        { templateId: firstTemplate, phase: 'completed', result: { summary: 'Finished' } }] } })
    expect(workflowTerminalOutcome(selected, new Map([[firstId, completed], [secondId, task(secondId, 'failed')]]))
      ?.result.tasks[0]).not.toHaveProperty('failure')
    const cancelled = task(secondId, 'cancelled', { blockedByOutcome: {
      taskId: firstId, revision: 2, phase: 'failed',
    } })
    const cancelledOutcome = workflowTerminalOutcome(selected, new Map([[firstId, completed], [secondId, cancelled]]))
    expect(cancelledOutcome?.phase).toBe('cancelled')
    expect(cancelledOutcome?.result.tasks[0]).toMatchObject({ phase: 'cancelled', blockedByOutcome: { taskId: firstId } })
    expect(workflowTerminalOutcome(selected, new Map([[firstId, completed], [secondId, task(secondId, 'deleted')]]))
      ?.phase).toBe('cancelled')
    expect(workflowTerminalOutcome(plan([]), new Map([[firstId, completed], [secondId, completed]]))?.phase)
      .toBe('completed')
  })
})

describe('workflow dependent task propagation', () => {
  it('leaves compiling plans and ready plans with unfinished tasks untouched', () => {
    const pending = task(firstId, 'pending')
    expect(workflowOutcomeRecords(projection([pending], [{ ...plan([]), phase: 'compiling' }]))).toEqual([])
    expect(workflowOutcomeRecords(projection([pending, task(secondId, 'pending')], [plan([])]))).toEqual([])
  })

  it('cancels unstarted workflow dependents in order and settles the ready plan', () => {
    const failed = task(firstId, 'failed', { workflowPlanId: workflowId })
    const pending = task(secondId, 'pending', { workflowPlanId: workflowId, blockedBy: [firstId] })
    const records = workflowOutcomeRecords(projection([pending, failed], [plan([])]))
    expect(records).toMatchObject([
      { type: 'task/changed', task: { id: secondId, phase: 'cancelled', blockedByOutcome: { taskId: firstId } } },
      { type: 'workflow-plan/changed', plan: { phase: 'failed', failure: { code: 'WORKFLOW_TASK_FAILED' } } },
    ])
  })

  it.each(['cancelled', 'deleted'] as const)('propagates a %s prerequisite through a ready workflow', (phase) => {
    const blocker = task(firstId, phase, { workflowPlanId: workflowId })
    const pending = task(secondId, 'pending', { workflowPlanId: workflowId, blockedBy: [firstId] })
    const records = workflowOutcomeRecords(projection([pending, blocker], [plan([])]))
    expect(records[0]).toMatchObject({ type: 'task/changed', task: {
      id: secondId, phase: 'cancelled', blockedByOutcome: { taskId: firstId, phase },
    } })
  })

  it('cancels nested child reservations after a deleted prerequisite', () => {
    const blocker = task(firstId, 'deleted')
    const childExecution: TeamTaskSnapshot['execution'] = { kind: 'child-team', templateId: 'fixture', templateVersion: 1,
      authorityGrant: { operations: [], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} }, budget: {} }
    const child = task(secondId, 'pending', { execution: childExecution, blockedBy: [firstId],
      delegation: { phase: 'requested' } as TeamTaskSnapshot['delegation'] })
    const nestedId = teamTaskIdSchema.parse('workflow-nested')
    const nested = task(nestedId, 'pending', { execution: childExecution, blockedBy: [secondId],
      delegation: { phase: 'requested' } as TeamTaskSnapshot['delegation'] })
    const records = workflowOutcomeRecords(projection([nested, child, blocker]))
    expect(records).toMatchObject([
      { type: 'task/changed', task: { id: secondId, phase: 'cancelled',
        delegation: { phase: 'cancelled', updatedAt: 50 } } },
      { type: 'task/changed', task: { id: nestedId, phase: 'cancelled',
        blockedByOutcome: { taskId: secondId } } },
    ])
  })
})
