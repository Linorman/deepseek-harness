import { projectWorkflowInspection } from '@clocky/clocky-team/selection'
/** Selected workflow result membership through journal parsing and checkpoint recovery. @module */

import { describe, expect, it } from 'vitest'
import { teamWorkflowPlanSnapshotSchema, teamWorkflowInspectionSchema, teamWorkflowPlanIdSchema } from '@clocky/clocky-team'
import { teamProjectionFromData } from '../src/fold.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, task, taskChanged, taskCreatorActivationId,
  taskCreatorId, taskCreatorSessionId, teamId, teamPhase } from './fixtures.ts'

function selectedWorkflow() {
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const actor = { teamId, participantId: taskCreatorId, activationId: taskCreatorActivationId,
    sessionId: taskCreatorSessionId, provider: 'in-process' }
  const template = { id: 'review', subject: 'Review', description: 'Inspect the result.', blockedBy: [],
    requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {},
    reviewPolicy: { kind: 'none' }, maxAttempts: 1 }
  const plan = { id: 'selected-workflow', teamId, revision: 1, phase: 'compiling', taskBindings: [], actor,
    idempotencyKey: 'selection-key', plan: { version: 1, name: 'Review', tasks: [template],
      bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
      channel: { participantRoles: ['coordinator', 'human'], graph: { initial: { kind: 'participant', role: 'coordinator' },
        transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
      result: { kind: 'task-results', taskTemplateIds: ['review'] } } }
  const created = task({ ...template, id: 'selected-task', workflowPlanId: plan.id, workflowTemplateId: template.id })
  const bound = { ...plan, revision: 2, taskBindings: [{ templateId: template.id, taskId: created.id }] }
  const ready = { ...bound, revision: 3, phase: 'ready', channelId: 'selection-channel' }
  const prefix = [createdTeam(), teamPhase(), participantChanged({ participant: member, createdAt: 12 }),
    participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 }),
    { type: 'activation/changed', createdAt: 15,
      binding: { activation: { id: actor.activationId, teamId, participantId: actor.participantId, status: 'idle' },
        sessionId: actor.sessionId, provider: actor.provider } },
    { type: 'workflow-plan/changed', plan, createdAt: 16 }, taskChanged({ task: created, createdAt: 17 }),
    { type: 'workflow-plan/changed', plan: bound, createdAt: 18 },
    { type: 'channel/attached', channelId: ready.channelId, createdAt: 19 },
    { type: 'workflow-plan/changed', plan: ready, createdAt: 20 },
    taskChanged({ task: { ...created, revision: 2, phase: 'cancelled' }, createdAt: 21 })]
  const selected = { templateId: template.id, taskId: created.id, phase: 'cancelled' }
  const completed = { ...ready, phase: 'cancelled', revision: 4, result: { kind: 'task-results', tasks: [selected] } }
  const record = { type: 'workflow-plan/changed', plan: completed, createdAt: 22 }
  const records = [...prefix, record]
  return { prefix, selected, completed, record, records, checkpoint: checkpointFor(records) }
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable workflow selection (${backend})`, () => {
    it('reads current workflow tasks through bounded inspection without full plan/result bodies', async () => {
      const f = selectedWorkflow()
      const ctx = await recover(backend, f.records)
      const plan = teamWorkflowPlanSnapshotSchema.parse(f.completed)
      const inspected = await ctx.teams.inspectWorkflowPlan({ teamId, planId: plan.id, limit: 1 })
      expect(inspected.record).toMatchObject({ id: plan.id, revision: 4, resultTaskCount: 1 })
      expect(inspected.items[0]).toMatchObject({ templateId: 'review', taskId: 'selected-task' })
      expect(inspected.record).not.toHaveProperty('plan')
      expect(inspected.record).not.toHaveProperty('result')
      expect(teamWorkflowInspectionSchema.parse(inspected)).toEqual(inspected)
      await expect(ctx.teams.inspectWorkflowPlan({ teamId, planId: plan.id, expectedRevision: 1 }))
        .rejects.toMatchObject({ code: 'TEAM_WORKFLOW_PLAN_INVALID' })
      await expect(ctx.teams.inspectWorkflowPlan({ teamId, planId: teamWorkflowPlanIdSchema.parse('missing') }))
        .rejects.toMatchObject({ code: 'TEAM_WORKFLOW_PLAN_NOT_FOUND' })
    })

    it('accepts a checkpoint containing exactly the selected result', async () => {
      const f = selectedWorkflow()
      const ctx = await recover(backend, f.records, { ...f.checkpoint, rules: { ...f.checkpoint.rules, selectedResult: true } })
      const state = await ctx.teams.getTeam({ teamId })
      expect(state.workflowPlans).toEqual([f.completed])
      expect(state.rules).toHaveProperty('selectedResult', true)
    })

    it('rejects an omitted selected template in the journal parser and ignores its checkpoint', async () => {
      const f = selectedWorkflow()
      const damaged = { ...f.completed, result: { ...f.completed.result,
        tasks: [{ ...f.selected, templateId: 'unselected-template' }] } }
      const invalid = await recover(backend, [...f.prefix, { ...f.record, plan: damaged }])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({
        code: 'TEAM_JOURNAL_MALFORMED', message: `Team '${teamId}' journal contains an invalid record`,
        cause: { issues: [{ message: "workflow result omits 'review'" }] },
      })
      const restored = await recover(backend, f.records, { ...f.checkpoint,
        workflowPlans: [damaged], rules: { ...f.checkpoint.rules, selectedResult: true } })
      const state = await restored.teams.getTeam({ teamId })
      expect(state.workflowPlans).toEqual([f.completed])
      expect(state.rules).not.toHaveProperty('selectedResult')
    })

    it('rejects an extra result by count after parsing and ignores its checkpoint', async () => {
      const f = selectedWorkflow()
      const damaged = { ...f.completed, result: { ...f.completed.result,
        tasks: [f.selected, { ...f.selected, templateId: 'unselected-template', taskId: 'unselected-task' }] } }
      const parsed = teamWorkflowPlanSnapshotSchema.parse(JSON.parse(JSON.stringify(damaged)))
      const diagnostic = `workflow plan '${f.completed.id}' result has an unexpected task count`
      expect(() => teamProjectionFromData({ ...f.checkpoint, workflowPlans: [parsed] })).toThrow(diagnostic)
      const invalid = await recover(backend, [...f.prefix, { ...f.record, plan: damaged }])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow(diagnostic)
      const restored = await recover(backend, f.records, { ...f.checkpoint,
        workflowPlans: [damaged], rules: { ...f.checkpoint.rules, selectedResult: true } })
      const state = await restored.teams.getTeam({ teamId })
      expect(state.workflowPlans).toEqual([f.completed])
      expect(state.rules).not.toHaveProperty('selectedResult')
    })
  })
}

it('does not inspect task instructions, protocol graphs or result bodies when projecting a workflow', () => {
  const plan = teamWorkflowPlanSnapshotSchema.parse(selectedWorkflow().completed)
  const template = plan.plan.tasks[0]!
  Object.defineProperty(template, 'description', { enumerable: true, get: () => { throw new Error('Instructions were read') } })
  Object.defineProperty(plan.plan, 'channel', { enumerable: true, get: () => { throw new Error('Protocol graph was read') } })
  Object.defineProperty(plan.result!.tasks, '0', { enumerable: true, get: () => { throw new Error('Result body was read') } })
  const input = { teamId, planId: plan.id, afterCursor: -1, limit: 1 }
  const result = projectWorkflowInspection(plan, 22, input, 16, 2048)
  expect(result).toMatchObject({ ok: true, value: { record: { resultTaskCount: 1 }, total: 1 } })
  expect(projectWorkflowInspection(plan, 22, { ...input, expectedRevision: 99 }, 16, 2048)).toEqual({ ok: false, reason: 'revision' })
  expect(projectWorkflowInspection(plan, 22, { ...input, planId: teamWorkflowPlanIdSchema.parse('foreign') }, 16, 2048)).toEqual({ ok: false, reason: 'owner' })
  expect(projectWorkflowInspection(plan, 22, input, 16, 1)).toEqual({ ok: false, reason: 'metadata' })
})

it('pins workflow windows and rejects omitted or inconsistent continuation metadata', () => {
  const plan = teamWorkflowPlanSnapshotSchema.parse(selectedWorkflow().completed)
  const input = { teamId, planId: plan.id, afterCursor: -1, limit: 1 }
  const result = projectWorkflowInspection(plan, 22, input, 16, 2048)
  if (!result.ok) throw new Error('Workflow did not fit')
  for (const patch of [{ total: 2 }, { nextCursor: 0 }, { scanned: 0 }, { total: 0 }]) {
    expect(teamWorkflowInspectionSchema.safeParse({ ...result.value, ...patch }).success).toBe(false)
  }
  const exhausted = projectWorkflowInspection(plan, 22, { ...input, afterCursor: 10 }, 16, 2048)
  expect(exhausted).toMatchObject({ ok: true, value: { items: [], scanned: 0 } })
})

it('pages large workflow DAGs under a total byte limit and keeps off-page dependency bindings', () => {
  const base = teamWorkflowPlanSnapshotSchema.parse(selectedWorkflow().completed)
  const template = base.plan.tasks[0]!
  const tasks = Array.from({ length: 40 }, (_, index) => ({ ...template, id: `template-${index}` as typeof template.id,
    subject: `Task ${index}`, description: 'instructions '.repeat(10000).trim(), blockedBy: index === 0 ? [] : ['template-0' as typeof template.id] }))
  const { result: _result, ...withoutResult } = base
  const plan = teamWorkflowPlanSnapshotSchema.parse({ ...withoutResult, phase: 'compiling',
    plan: { ...base.plan, tasks, bounds: { maxTasks: 40, maxParallelism: 1, maxTotalAttempts: 40 },
      result: { kind: 'task-results', taskTemplateIds: ['template-0'] } },
    taskBindings: tasks.map((task, index) => ({ templateId: task.id, taskId: `bound-${index}` })),
  })
  const ids: string[] = []
  let afterCursor = -1
  for (;;) {
    const result = projectWorkflowInspection(plan, 22, { teamId, planId: plan.id, afterCursor, limit: 7 }, 32, 1800)
    if (!result.ok) throw new Error(result.reason)
    expect(Buffer.byteLength(JSON.stringify(result.value))).toBeLessThanOrEqual(1800)
    expect(teamWorkflowInspectionSchema.parse(result.value)).toEqual(result.value)
    for (const item of result.value.items) {
      ids.push(item.templateId)
      if (item.templateId !== 'template-0') expect(item.blockedBy).toMatchObject([{ templateId: 'template-0', taskId: 'bound-0' }])
    }
    if (result.value.nextCursor === undefined) break
    afterCursor = result.value.nextCursor
  }
  expect(ids).toEqual(tasks.map(task => task.id))
})

it('rejects oversized workflow metadata and indivisible task references', () => {
  const base = teamWorkflowPlanSnapshotSchema.parse(selectedWorkflow().completed)
  const input = { teamId, planId: base.id, afterCursor: -1, limit: 1 }
  expect(projectWorkflowInspection({ ...base, plan: { ...base.plan, name: 'x'.repeat(3000) } }, 22, input, 16, 2048))
    .toEqual({ ok: false, reason: 'metadata' })
  const id = 'x'.repeat(3000)
  const { result: _result, ...withoutResult } = base
  const large = teamWorkflowPlanSnapshotSchema.parse({ ...withoutResult, phase: 'compiling', taskBindings: [],
    plan: { ...base.plan, tasks: [{ ...base.plan.tasks[0], id }], result: { kind: 'task-results', taskTemplateIds: [id] } } })
  expect(projectWorkflowInspection(large, 22, input, 16, 2048)).toEqual({ ok: false, reason: 'row' })
})

it('preserves lifecycle reasons and includes lookup work when a byte-limited page stops', () => {
  const base = teamWorkflowPlanSnapshotSchema.parse(selectedWorkflow().completed)
  const { result: _result, ...withoutResult } = base
  const input = { teamId, planId: base.id, afterCursor: -1, limit: 1 }
  expect(projectWorkflowInspection({ ...withoutResult, phase: 'failed', failure: { code: 'FAILED', message: 'Compilation failed' } },
    22, input, 32, 2048)).toMatchObject({ ok: true, value: { record: { failure: { code: 'FAILED' } } } })
  expect(projectWorkflowInspection({ ...base, cancellation: { code: 'CANCELLED', message: 'Stopped' } },
    22, input, 32, 2048)).toMatchObject({ ok: true, value: { record: { cancellation: { code: 'CANCELLED' } } } })
  const template = base.plan.tasks[0]!
  const tasks = Array.from({ length: 4 }, (_, index) => ({ ...template, id: `template-${index}`,
    subject: `Task ${index}`, blockedBy: index === 0 ? [] : [`template-${index - 1}`] }))
  const plan = teamWorkflowPlanSnapshotSchema.parse({ ...withoutResult, phase: 'compiling',
    plan: { ...base.plan, tasks, bounds: { maxTasks: 4, maxParallelism: 1, maxTotalAttempts: 4 },
      result: { kind: 'task-results', taskTemplateIds: ['template-0'] } },
    taskBindings: tasks.map((task, index) => ({ templateId: task.id, taskId: `bound-${index}` })),
  })
  const single = projectWorkflowInspection(plan, 22, { ...input, afterCursor: 1 }, 32, 2048)
  if (!single.ok) throw new Error('Single workflow row did not fit')
  const bytes = Buffer.byteLength(JSON.stringify(single.value))
  expect(projectWorkflowInspection(plan, 22, { ...input, afterCursor: 1, limit: 2 }, 32, bytes))
    .toEqual({ ok: false, reason: 'metadata' })
  const bounded = projectWorkflowInspection(plan, 22, { ...input, afterCursor: 1, limit: 2 }, 32, bytes + 20)
  expect(bounded).toMatchObject({ ok: true, value: { nextCursor: 2, items: [{ templateId: 'template-2' }] } })
  if (bounded.ok) expect(bounded.value.items).toHaveLength(1)
})
