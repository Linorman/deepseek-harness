/** Selected workflow result membership through journal parsing and checkpoint recovery. @module */

import { describe, expect, it } from 'vitest'
import { teamWorkflowPlanSnapshotSchema } from '@clocky/clocky-team'
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
