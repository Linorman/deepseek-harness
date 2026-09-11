/** Workflow plan revisions and task bindings recovered from actual serialized logs. @module */

import { describe, expect, it } from 'vitest'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, task, taskChanged, taskCreatorActivationId, taskCreatorId,
  taskCreatorSessionId, taskLease, teamId, teamPhase } from './fixtures.ts'

function changed(plan: object, createdAt: number) {
  return { type: 'workflow-plan/changed', plan, createdAt }
}

function workflow(withDependency = false) {
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const actor = { teamId, participantId: taskCreatorId, activationId: taskCreatorActivationId,
    sessionId: taskCreatorSessionId, provider: 'in-process' }
  const prefix = [createdTeam(), teamPhase(),
    participantChanged({ participant: member, createdAt: 12 }),
    participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 }),
    { type: 'activation/changed', createdAt: 15, binding: {
      activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
      sessionId: taskCreatorSessionId, provider: 'in-process',
    } },
  ]
  const plan = { id: 'workflow-a', teamId, revision: 1, phase: 'compiling', taskBindings: [], actor,
    idempotencyKey: 'workflow-key', plan: { version: 1, name: 'Review and summarize',
      tasks: ['review', 'summary'].map(id => ({ id, subject: id, description: 'Inspect the result.', blockedBy: withDependency && id === 'summary' ? ['review'] : [],
        requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {},
        reviewPolicy: { kind: 'none' }, maxAttempts: 1 })),
      bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 },
      channel: { participantRoles: ['coordinator', 'human'], graph: { initial: { kind: 'participant', role: 'coordinator' },
        transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
      result: { kind: 'task-results', taskTemplateIds: ['review', 'summary'] },
    } }
  const [aTemplate, bTemplate] = plan.plan.tasks
  if (aTemplate === undefined || bTemplate === undefined) throw new Error('workflow fixture requires two templates')
  const { id: aTemplateId, ...aFields } = aTemplate
  const { id: bTemplateId, ...bFields } = bTemplate
  const a = task({ ...aFields, id: 'task-review', workflowPlanId: plan.id, workflowTemplateId: aTemplateId })
  const b = task({ ...bFields, blockedBy: withDependency ? [a.id] : [], id: 'task-summary', workflowPlanId: plan.id, workflowTemplateId: bTemplateId })
  const partial = { ...plan, revision: 2, taskBindings: [{ templateId: 'review', taskId: a.id }] }
  const bound = { ...partial, revision: 3, taskBindings: [...partial.taskBindings, { templateId: 'summary', taskId: b.id }] }
  const ready = { ...bound, revision: 4, phase: 'ready', channelId: 'workflow-channel' }
  const partialRows = [...prefix, changed(plan, 16), taskChanged({ task: a, createdAt: 17 }), changed(partial, 18)]
  const readyRows = [...partialRows, taskChanged({ task: b, createdAt: 19 }), changed(bound, 20),
    { type: 'channel/attached', channelId: ready.channelId, createdAt: 21 }, changed(ready, 22)]
  checkpointFor(readyRows)
  return { prefix, plan, a, b, partial, partialRows, ready, readyRows }
}

function settledWorkflow(firstKind: 'completed' | 'failed') {
  const { a, b, ready, readyRows } = workflow()
  const rows: unknown[] = [...readyRows]
  const results = []
  for (const [index, initial] of [a, b].entries()) {
    const assignedAt = 23 + index * 3
    const lease = taskLease({ attemptId: `workflow-result-${index}`, participantId: taskCreatorId,
      activationId: taskCreatorActivationId, assignedAt, renewedAt: assignedAt, expiresAt: assignedAt + 10 })
    const assigned = task({ ...initial, revision: 2, phase: 'assigned', attemptCount: 1, lease })
    const running = task({ ...assigned, revision: 3, phase: 'running', lease: { ...lease, startedAt: assignedAt + 1 } })
    const kind = index === 0 ? firstKind : 'completed'
    const outcome = kind === 'completed'
      ? { kind: 'completed' as const, result: { summary: `Accepted task result ${index}.`, evidence: ['Retained attempt evidence.'] } }
      : { kind: 'failed' as const, failure: { code: 'WORK_FAILED', message: 'The admitted task attempt failed.' } }
    const settled = task({ ...running, revision: 4, phase: kind, lease: undefined,
      attemptHistory: [{ id: lease.attemptId, teamId, taskId: initial.id, ordinal: lease.ordinal,
        participantId: taskCreatorId, activationId: taskCreatorActivationId, assignedAt,
        startedAt: assignedAt + 1, leaseExpiresAt: lease.expiresAt, settledAt: assignedAt + 2, outcome }] })
    rows.push(taskChanged({ task: assigned, createdAt: assignedAt }), taskChanged({ task: running, createdAt: assignedAt + 1 }),
      taskChanged({ task: settled, createdAt: assignedAt + 2 }))
    const binding = ready.taskBindings.find(value => value.taskId === initial.id)
    if (binding === undefined) throw new Error('settled workflow task requires its admitted template binding')
    results.push({ templateId: binding.templateId, taskId: initial.id, phase: kind,
      ...outcome.kind === 'completed' ? { result: outcome.result } : { failure: outcome.failure } })
  }
  const completed = { ...ready, phase: firstKind, revision: 5, result: { kind: 'task-results', tasks: results },
    ...firstKind === 'failed' ? { failure: { code: 'WORKFLOW_TASK_FAILED', message: 'Workflow task failed.' } } : {} }
  checkpointFor([...rows, changed(completed, 29)])
  return { prefix: rows, completed }
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable workflow replay (${backend})`, () => {
    it('preserves partial compiling bindings and ignores duplicate or foreign checkpoint plans', async () => {
      const { partialRows, partial } = workflow()
      const data = checkpointFor(partialRows)
      const valid = await recover(backend, partialRows, data)
      expect((await valid.teams.getTeam({ teamId })).workflowPlans).toEqual([partial])
      for (const plans of [[partial, partial], [{ ...partial, teamId: 'foreign-team', actor: { ...partial.actor, teamId: 'foreign-team' } }],
        [{ ...partial, actor: { ...partial.actor, sessionId: 'foreign-session' } }]]) {
        const ctx = await recover(backend, partialRows, { ...data, workflowPlans: plans })
        expect((await ctx.teams.getTeam({ teamId })).workflowPlans).toEqual([partial])
      }
    })

    it('pages workflow plans at the Hub source boundary in admission order', async () => {
      const { readyRows, plan } = workflow()
      const second = { ...plan, id: 'workflow-b', idempotencyKey: 'workflow-key-b' }
      const rows = [...readyRows, changed(second, 23)]
      const ctx = await recover(backend, rows, checkpointFor(rows))
      const first = await ctx.teams.listWorkflowPlansPage({ teamId, afterCursor: -1, limit: 1 })
      expect(first.items.map(item => item.id)).toEqual(['workflow-a'])
      expect(first.nextCursor).toBe(0)
      const secondPage = await ctx.teams.listWorkflowPlansPage({ teamId, afterCursor: first.nextCursor!, limit: 1 })
      expect(secondPage.items.map(item => item.id)).toEqual(['workflow-b'])
      expect(secondPage.nextCursor).toBeUndefined()
    })

    it('rejects intrinsic workflow damage at serialized journal and checkpoint parsing', async () => {
      const { ready, readyRows } = workflow()
      const first = ready.taskBindings[0]
      const second = ready.taskBindings[1]
      if (first === undefined || second === undefined) throw new Error('workflow fixture requires two bindings')
      const variants = [
        { ...ready, plan: { ...ready.plan, tasks: [] } },
        { ...ready, taskBindings: [{ ...first, templateId: 'unknown-template' }, second] },
        { ...ready, taskBindings: [first, { ...second, templateId: first.templateId }] },
        { ...ready, taskBindings: [first, { ...second, taskId: first.taskId }] },
        { ...ready, taskBindings: [first] },
        { ...ready, phase: 'completed' },
      ]
      const checkpoint = checkpointFor(readyRows)
      for (const value of variants) {
        const invalid = await recover(backend, [...readyRows, changed({ ...value, revision: 5 }, 23)])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
        const restored = await recover(backend, readyRows, { ...checkpoint, workflowPlans: [value] })
        expect((await restored.teams.getTeam({ teamId })).workflowPlans).toEqual([ready])
      }
    })

    it('requires a ready checkpoint channel while preserving optional historical authors', async () => {
      const { prefix, plan, ready, readyRows } = workflow()
      const restored = await recover(backend, readyRows, {
        ...checkpointFor(readyRows), workflowPlans: [{ ...ready, channelId: undefined }],
      })
      expect((await restored.teams.getTeam({ teamId })).workflowPlans).toEqual([ready])
      const historical = { ...plan, actor: undefined }
      const accepted = await recover(backend, [...prefix, changed(historical, 16)])
      expect((await accepted.teams.getTeam({ teamId })).workflowPlans?.[0]?.actor).toBeUndefined()
    })

    it('rejects initial, immutable, revision and phase changes that lack their durable predecessors', async () => {
      const { prefix, plan, partial, partialRows, ready, readyRows } = workflow()
      const cancelled = { ...ready, revision: 5, phase: 'cancelled' }
      const rows = [
        [...prefix, changed({ ...plan, teamId: 'foreign-team', actor: undefined }, 16)],
        [...prefix, changed({ ...plan, revision: 2 }, 16)],
        [...prefix, changed({ ...plan, actor: { ...plan.actor, provider: 'foreign-provider' } }, 16)],
        [...partialRows, changed({ ...partial, revision: 4 }, 19)],
        [...partialRows, changed({ ...partial, revision: 3, idempotencyKey: 'changed-key' }, 19)],
        [...partialRows, changed({ ...partial, revision: 3 }, 19)],
        [...readyRows, changed({ ...ready, revision: 5, phase: 'compiling' }, 23)],
        [...readyRows, changed(cancelled, 23), changed({ ...cancelled, revision: 6 }, 24)],
      ]
      for (const records of rows) {
        const ctx = await recover(backend, records)
        await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      }
    })

    it('rejects serialized task bindings outside their admitted workflow', async () => {
      const { prefix, plan, a } = workflow()
      const values = [
        { ...a, workflowPlanId: 'missing-plan' },
        { ...a, workflowTemplateId: 'missing-template' },
        { ...a, proposedOwnerId: taskCreatorId },
      ]
      for (const value of values) {
        const ctx = await recover(backend, [...prefix, changed(plan, 16), { type: 'task/changed', task: value, createdAt: 17 }])
        await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      }
    })

    it('keeps a ready plan quiescing until its terminal workflow result is durable', async () => {
      const { a, b, ready, readyRows } = workflow()
      const prefix = [...readyRows,
        taskChanged({ task: { ...a, revision: 2, phase: 'cancelled' }, createdAt: 23 }),
        taskChanged({ task: { ...b, revision: 2, phase: 'cancelled' }, createdAt: 24 }),
        { type: 'activation/changed', createdAt: 25, binding: {
          activation: { id: ready.actor.activationId, teamId, participantId: ready.actor.participantId, status: 'offline' },
          sessionId: ready.actor.sessionId, provider: ready.actor.provider,
          quiescedAt: 25, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [],
        } },
        { type: 'team/closure', createdAt: 26, closure: { teamId, kind: 'fail', idempotencyKey: 'unfinished-workflow',
          actor: { kind: 'system', name: 'team-run' }, reason: { code: 'FAILED', message: 'The run stopped.' }, requestedAt: 26 } },
        { type: 'team/phase', phase: 'quiescing', createdAt: 27 },
      ]
      const checkpoint = checkpointFor(prefix)
      const invalid = await recover(backend, [...prefix, { type: 'team/phase', phase: 'failed', createdAt: 28 }])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('unfinished workflow plan')
      const restored = await recover(backend, prefix, { ...checkpoint, team: { ...checkpoint.team, phase: 'failed' } })
      const state = await restored.teams.getTeam({ teamId })
      expect(state.team.phase).toBe('quiescing')
      expect(state.workflowPlans).toEqual([ready])
    })

    it('retains terminal result references to the exact durable task phases', async () => {
      const { a, b, ready, readyRows } = workflow()
      const cancelledRows = [...readyRows,
        taskChanged({ task: { ...a, revision: 2, phase: 'cancelled' }, createdAt: 23 }),
        taskChanged({ task: { ...b, revision: 2, phase: 'cancelled' }, createdAt: 24 }),
      ]
      const results = [{ templateId: 'review', taskId: a.id, phase: 'cancelled' },
        { templateId: 'summary', taskId: b.id, phase: 'cancelled' }]
      const completed = { ...ready, revision: 5, phase: 'cancelled', result: { kind: 'task-results', tasks: results } }
      const rows = [...cancelledRows, changed(completed, 25)]
      const valid = await recover(backend, rows, checkpointFor(rows))
      expect((await valid.teams.getTeam({ teamId })).workflowPlans).toEqual([completed])
      const variants = [
        [{ ...results[0], taskId: b.id }, results[1]],
        [{ ...results[0], phase: 'deleted' }, results[1]],
        [...results, { templateId: 'extra-template', taskId: 'extra-task', phase: 'cancelled' }],
      ]
      for (const tasks of variants) {
        const ctx = await recover(backend, [...cancelledRows, changed({ ...completed, result: { ...completed.result, tasks } }, 25)])
        await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      }
    })

    for (const kind of ['completed', 'failed'] as const) {
      it(`rejects a workflow projection that rewrites its ${kind} task outcome`, async () => {
        const { prefix, completed } = settledWorkflow(kind)
        const first = completed.result.tasks[0]
        if (first === undefined) throw new Error('workflow result fixture requires its first task')
        const altered = kind === 'completed'
          ? { ...first, result: { summary: 'This result was never accepted for the task.' } }
          : { ...first, failure: { code: 'WORK_FAILED', message: 'This failure was never accepted for the task.' } }
        const corrupt = { ...completed, result: { ...completed.result, tasks: [altered, ...completed.result.tasks.slice(1)] } }
        const invalid = await recover(backend, [...prefix, changed(corrupt, 29)])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('does not match')
        const rows = [...prefix, changed(completed, 29)]
        const checkpoint = checkpointFor(rows)
        const restored = await recover(backend, rows, { ...checkpoint, workflowPlans: [corrupt] })
        expect((await restored.teams.getTeam({ teamId })).workflowPlans).toEqual([completed])
      })
    }

    it('preserves the optional failure detail in a terminal task-result projection', async () => {
      const { prefix, completed } = settledWorkflow('failed')
      const first = completed.result.tasks[0]
      if (first === undefined) throw new Error('workflow result fixture requires a failed task')
      const withoutFailure = { ...completed, result: { ...completed.result,
        tasks: [{ templateId: first.templateId, taskId: first.taskId, phase: 'failed' }, ...completed.result.tasks.slice(1)] } }
      const rows = [...prefix, changed(withoutFailure, 29)]
      const reader = await recover(backend, rows, checkpointFor(rows))
      expect((await reader.teams.getTeam({ teamId })).workflowPlans).toEqual([withoutFailure])
    })

    it('recovers causal dependency cancellation and rejects a forged prerequisite or revision', async () => {
      const { a, b, ready, readyRows } = workflow(true)
      const cancelled = { ...a, revision: 2, phase: 'cancelled' }
      const cause = { taskId: a.id, revision: 2, phase: 'cancelled' }
      const dependent = { ...b, revision: 2, phase: 'cancelled', blockedByOutcome: cause }
      const prefix = [...readyRows, taskChanged({ task: cancelled, createdAt: 23 })]
      const rows = [...prefix, taskChanged({ task: dependent, createdAt: 24 })]
      const checkpoint = checkpointFor(rows)
      for (const storedCheckpoint of [undefined, checkpoint]) {
        const reader = await recover(backend, rows, storedCheckpoint)
        expect((await reader.teams.getTeam({ teamId })).tasks.find(task => task.id === b.id))
          .toMatchObject({ phase: 'cancelled', attemptCount: 0, blockedByOutcome: cause })
      }
      for (const invalidCause of [{ ...cause, revision: 1 }, { ...cause, phase: 'failed' }, { ...cause, taskId: b.id }]) {
        const corrupt = { ...dependent, blockedByOutcome: invalidCause }
        const reader = await recover(backend, [...prefix, { type: 'task/changed', task: corrupt, createdAt: 24 }])
        await expect(reader.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
        const restored = await recover(backend, rows, { ...checkpoint,
          tasks: checkpoint.tasks.map(task => task.id === b.id ? { ...task, blockedByOutcome: invalidCause } : task) })
        expect((await restored.teams.getTeam({ teamId })).tasks.find(task => task.id === b.id))
          .toMatchObject({ blockedByOutcome: cause })
      }
      const result = { kind: 'task-results', tasks: [
        { templateId: 'review', taskId: a.id, phase: 'cancelled' },
        { templateId: 'summary', taskId: b.id, phase: 'cancelled', blockedByOutcome: cause },
      ] }
      const terminal = { ...ready, revision: 5, phase: 'cancelled', result }
      const valid = await recover(backend, [...rows, changed(terminal, 25)])
      expect((await valid.teams.getTeam({ teamId })).workflowPlans).toEqual([terminal])
      expect((await valid.teams.getTeam({ teamId })).participants.every(member => member.stats?.failedAttempts === 0)).toBe(true)
      const corruptResult = { ...result, tasks: result.tasks.map(row => ({ ...row, blockedByOutcome: undefined })) }
      const invalid = await recover(backend, [...rows, changed({ ...terminal, result: corruptResult }, 25)])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('dependency cause does not match')
    })

    it('preserves admitted bindings when a later revision also adds a resource', async () => {
      const { a, partial, partialRows, ready, readyRows } = workflow()
      const attached = { type: 'channel/attached', channelId: 'workflow-channel', createdAt: 19 }
      const alternate = task({ ...a, id: 'alternate-review', createCommand: {
        ...a.createCommand, idempotencyKey: 'alternate-review-key',
      } })
      const variants = [
        [attached, changed({ ...partial, revision: 3, channelId: 'workflow-channel', taskBindings: [] }, 20)],
        [attached, taskChanged({ task: alternate, createdAt: 20 }), changed({ ...partial, revision: 3,
          channelId: 'workflow-channel', taskBindings: [{ templateId: 'review', taskId: alternate.id }] }, 21)],
      ]
      for (const suffix of variants) {
        const rows = [...partialRows, ...suffix]
        for (const checkpoint of [undefined, checkpointFor(partialRows)]) {
          const ctx = await recover(backend, rows, checkpoint, teamId, [], partialRows.length - 1)
          await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow('changed its admitted task binding')
        }
      }
      for (const channelId of [undefined, 'different-channel']) {
        const rows = [...readyRows, { type: 'channel/attached', channelId: 'different-channel', createdAt: 23 },
          changed({ ...ready, revision: 5, phase: 'cancelled', channelId }, 24)]
        for (const checkpoint of [undefined, checkpointFor(readyRows)]) {
          const ctx = await recover(backend, rows, checkpoint, teamId, [], readyRows.length - 1)
          await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow('changed its admitted channel binding')
        }
      }
    })
  })
}
