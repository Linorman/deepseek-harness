/** Team-local resource settlement required by terminal journal and checkpoint projections. @module */

import { describe, expect, it } from 'vitest'
import { retainedChildFinalFixture, consultChannelAdapter, FULL_TRANSCRIPT_VIEW_POLICY } from './durable-child-final-fixtures.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, goal, goalChanged, participant, participantChanged, task, taskChanged, taskCreatorActivationId,
  taskCreatorId, taskCreatorSessionId, taskId, taskLease, teamId, teamPhase } from './fixtures.ts'

type TerminalPhase = 'completed' | 'failed' | 'cancelled'

function closureRecords(phase: TerminalPhase, final?: ReturnType<typeof retainedChildFinalFixture>) {
  const kind = phase === 'completed' ? 'complete' : phase === 'failed' ? 'fail' : 'cancel'
  const actor = { kind: 'system', name: 'team-run' }
  const reason = { code: 'RUN_SETTLED', message: 'The run settled.' }
  const closure = { teamId, kind, actor, reason, idempotencyKey: 'terminal-key', requestedAt: kind === 'cancel' ? 31 : 29,
    ...kind === 'complete' ? { finalChannelId: 'final-channel', finalEnvelopeId: 'final-a' } : {} }
  return [
    ...kind === 'complete' ? [goalChanged({ goal: goal({ phase: 'complete', revision: 2 }), createdAt: 28 })] : [],
    ...kind === 'cancel' ? [{ type: 'team/cancellation', createdAt: 29,
      cancellation: { teamId, actor, reason, idempotencyKey: 'terminal-key', requestedAt: 29 } }]
      : [{ type: 'team/closure', closure, createdAt: 29 }],
    { type: 'team/phase', phase: 'quiescing', createdAt: 30 },
    ...kind === 'cancel' ? [{ type: 'team/closure', closure, createdAt: 31 }] : [],
    ...final === undefined ? [] : [final.admission],
    { type: 'team/phase', phase, createdAt: 32 },
  ]
}

function fixture(review = false, terminalTaskPhase: 'cancelled' | 'completed' | 'failed' = 'cancelled', withFinal = false) {
  const final = withFinal ? retainedChildFinalFixture(taskCreatorId, taskCreatorSessionId) : undefined
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process' }
  const roster = [createdTeam({ parentTeamId: 'parent-team', parentTaskId: 'parent-task', depth: 1, maxTeamDepth: 2 }), teamPhase(),
    participantChanged({ participant: member, createdAt: 12 }),
    participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 }),
    ...final?.memberRecords ?? [],
    { type: 'activation/changed', binding, createdAt: 15 }]
  const plan = { id: 'plan-a', teamId, revision: 1, phase: 'compiling', taskBindings: [], idempotencyKey: 'plan-key',
    actor: { teamId, participantId: taskCreatorId, activationId: taskCreatorActivationId,
      sessionId: taskCreatorSessionId, provider: 'in-process' },
    plan: { version: 1, name: 'Deferred review', tasks: [{ id: 'review', subject: 'Review', description: 'Review the result.',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 }],
    bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
    channel: { participantRoles: ['coordinator', 'human'], graph: { initial: { kind: 'participant', role: 'coordinator' },
      transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
    result: { kind: 'task-results', taskTemplateIds: ['review'] } } }
  const compiling = [...roster, { type: 'workflow-plan/changed', plan, createdAt: 16 }]
  const pendingTask = task({ maxAttempts: 1, reviewPolicy: review ? { kind: 'participant', reviewerId: taskCreatorId } : { kind: 'none' } })
  const pending = [...compiling, taskChanged({ task: pendingTask, createdAt: 17 })]
  const lease = taskLease({ participantId: taskCreatorId, activationId: taskCreatorActivationId,
    assignedAt: 18, renewedAt: 18, durationMs: 100, expiresAt: 118 })
  const assignedTask = task({ ...pendingTask, revision: 2, phase: 'assigned', attemptCount: 1, lease })
  const assigned = [...pending, taskChanged({ task: assignedTask, createdAt: 18 })]
  const runningTask = task({ ...assignedTask, revision: 3, phase: 'running', lease: { ...lease, startedAt: 19 } })
  const running = [...assigned, taskChanged({ task: runningTask, createdAt: 19 })]
  const allocation = { id: 'allocation-a', teamId, revision: 1, taskId, attemptId: lease.attemptId,
    assignedRevision: lease.assignedRevision, participantId: taskCreatorId, activationId: taskCreatorActivationId,
    sessionId: taskCreatorSessionId, provider: 'workspace-shared', mode: 'shared', lifecycle: 'reserved', reservedAt: 20, updatedAt: 20 }
  const allocated = [...running, { type: 'workspace-allocation/changed', allocation, createdAt: 20 }]
  const attempt = { id: lease.attemptId, teamId, taskId, ordinal: lease.ordinal, participantId: taskCreatorId,
    activationId: taskCreatorActivationId, assignedAt: 18, startedAt: 19, leaseExpiresAt: 118, settledAt: 21,
    outcome: terminalTaskPhase === 'completed' ? { kind: 'completed', result: { summary: 'The task finished.' } }
      : terminalTaskPhase === 'failed' ? { kind: 'failed', failure: { code: 'FAILED', message: 'The task failed.' } }
        : { kind: 'cancelled' } }
  const settledTask = task({ ...runningTask, revision: 4, phase: terminalTaskPhase, lease: undefined, attemptHistory: [attempt] })
  const releaseRequested = { ...allocation, revision: 2, lifecycle: 'release-requested', releaseRequestedAt: 22, updatedAt: 22 }
  const released = { ...releaseRequested, revision: 3, lifecycle: 'released', releasedAt: 23, updatedAt: 23 }
  const failedPlan = { ...plan, revision: 2, phase: 'failed', failure: { code: 'COMPILE_FAILED', message: 'The compiler stopped.' } }
  const sample = { id: 'sample-a', teamId, participantId: taskCreatorId, sessionId: taskCreatorSessionId,
    provider: 'mock', model: 'model', turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 3 }, observedAt: 25 }
  const usage = { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 1, costUnits: 0, updatedAt: 25 }
  const charge = { id: 'charge-a', sourceTeamId: teamId, parentTaskId: 'parent-task', originTeamId: teamId, sourceSampleId: sample.id,
    participantId: taskCreatorId, sessionId: taskCreatorSessionId, provider: 'mock', model: 'model', turn: 1, step: 1,
    usage: sample.usage, observedAt: 25 }
  const chargePending = [...allocated, taskChanged({ task: settledTask, createdAt: 21 }),
    { type: 'workspace-allocation/changed', allocation: releaseRequested, createdAt: 22 },
    { type: 'workspace-allocation/changed', allocation: released, createdAt: 23 },
    { type: 'workflow-plan/changed', plan: failedPlan, createdAt: 24 },
    { type: 'usage/changed', sample, usage, createdAt: 25 },
    { type: 'usage/parent-charge-pending', charge, createdAt: 25 }]
  const quiesced = { ...binding, activation: { ...binding.activation, status: 'offline' },
    quiescedAt: 27, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] }
  const settled = [...chargePending, { type: 'usage/parent-charge-settled', chargeId: charge.id, createdAt: 26 },
    ...final === undefined ? [] : [final.attachment, final.bindingRecord],
    { type: 'activation/changed', binding: quiesced, createdAt: 27 }]
  checkpointFor(settled)
  return { roster, compiling, pending, assigned, running, allocated, chargePending, settled,
    binding, quiesced, allocation, released, failedPlan, charge, runningTask, attempt, final }
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable terminal resources (${backend})`, () => {
    for (const phase of ['completed', 'failed', 'cancelled'] as const) {
      it(`rejects unresolved Team resources at the ${phase} journal marker`, async () => {
        const f = fixture(false, 'cancelled', phase === 'completed')
        const missingProof = [...f.roster, { type: 'activation/changed', createdAt: 16,
          binding: { ...f.binding, activation: { ...f.binding.activation, status: 'offline' } } }]
        const cases = [
          { prefix: f.pending, message: 'unfinished task' }, { prefix: f.assigned, message: 'unfinished task' },
          { prefix: f.running, message: 'unfinished task' }, { prefix: f.allocated, message: 'unreleased workspace allocation' },
          { prefix: f.roster, message: 'without complete quiescence' }, { prefix: missingProof, message: 'without complete quiescence' },
          { prefix: f.chargePending, message: 'unsettled parent usage charges' }, { prefix: f.compiling, message: 'unfinished workflow plan' },
        ]
        for (const { prefix, message } of cases) {
          const prepared = [...prefix, ...f.final === undefined ? [] : [f.final.attachment, f.final.bindingRecord]]
          checkpointFor(prepared)
          const rows = [...prepared, ...closureRecords(phase, f.final)]
          const ctx = await recover(backend, rows, undefined, teamId, f.final === undefined ? [] : [f.final.channel],
            rows.length - 1, f.final === undefined ? [] : [f.final.parentTeam])
          if (f.final !== undefined) { ctx.teams.registerAdapter(consultChannelAdapter); ctx.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY) }
          await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow(message)
        }
      })

      it(`recovers settled ${phase} journals and rejects damaged terminal checkpoints`, async () => {
        const f = fixture(false, 'cancelled', phase === 'completed')
        const rows = [...f.settled, ...closureRecords(phase, f.final)]
        const checkpoint = checkpointFor(rows)
        const channels = f.final === undefined ? [] : [f.final.channel]
        const relatedTeams = f.final === undefined ? [] : [f.final.parentTeam]
        const valid = await recover(backend, rows, checkpoint, teamId, channels, rows.length - 1, relatedTeams)
        if (f.final !== undefined) { valid.teams.registerAdapter(consultChannelAdapter); valid.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY) }
        expect((await valid.teams.getTeam({ teamId })).team.phase).toBe(phase)
        const variants = [
          { ...checkpoint, tasks: [...checkpoint.tasks, task({ id: 'late-task' })] },
          { ...checkpoint, activations: [...checkpoint.activations, { ...f.binding,
            activation: { ...f.binding.activation, id: 'new-epoch' } }] },
          { ...checkpoint, activations: [{ ...f.quiesced, quiescedAt: undefined,
            quiescenceSource: undefined, quiescedWakeChannelIds: undefined }] },
          { ...checkpoint, workspaceAllocations: [{ ...f.released, lifecycle: 'reserved' }] },
          { ...checkpoint, pendingParentCharges: [f.charge] },
          { ...checkpoint, workflowPlans: [{ ...f.failedPlan, phase: 'compiling', failure: undefined }] },
        ]
        for (const value of variants) {
          // The marker exposes fallback even when the damaged field, such as parent charges, is private.
          const ctx = await recover(backend, rows, { ...value, rules: { ...value.rules, checkpointMarker: true } }, teamId, channels, rows.length - 1, relatedTeams)
          if (f.final !== undefined) { ctx.teams.registerAdapter(consultChannelAdapter); ctx.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY) }
          expect(await ctx.teams.getTeam({ teamId })).toEqual(await valid.teams.getTeam({ teamId }))
        }
      })
    }

    it('rejects new epochs, tasks and workflow work after the terminal marker', async () => {
      const f = fixture()
      const human = participant({ id: 'human-author', kind: 'human' })
      const prefix = [...f.settled.slice(0, 5),
        participantChanged({ participant: human, createdAt: 14 }),
        participantChanged({ participant: { ...human, phase: 'provisioning' }, createdAt: 14 }),
        participantChanged({ participant: { ...human, phase: 'active' }, createdAt: 14 }),
        ...f.settled.slice(5), ...closureRecords('cancelled')]
      checkpointFor(prefix)
      const lateTask = task({ id: 'late-human-task', createCommand: {
        creator: { teamId, participantId: human.id }, idempotencyKey: 'late-human-task-key',
      } })
      const lateRecords = [
        taskChanged({ task: lateTask, createdAt: 33 }),
        { type: 'activation/changed', binding: { ...f.binding, activation: { ...f.binding.activation, id: 'late-epoch' } }, createdAt: 33 },
        { type: 'workflow-plan/changed', plan: { ...f.failedPlan, id: 'late-plan', idempotencyKey: 'late-plan-key',
          phase: 'compiling', revision: 1, failure: undefined }, createdAt: 33 },
      ]
      const messages = ['unfinished task', 'without complete quiescence', 'unfinished workflow plan']
      for (const [index, record] of lateRecords.entries()) {
        const ctx = await recover(backend, [...prefix, record])
        await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow(messages[index])
      }
    })

    it('rejects cleanup records that create or reactivate resources after failure intent', async () => {
      const f = fixture()
      const cancelled = task({ revision: 2, phase: 'cancelled', maxAttempts: 1 })
      const cases = [
        { prefix: f.pending, record: taskChanged({ task: { ...cancelled, id: 'unknown-cleanup-task' }, createdAt: 31 }),
          message: 'cannot create or reopen task' },
        { prefix: f.pending, record: taskChanged({ task: task({ revision: 2, maxAttempts: 1 }), createdAt: 31 }),
          message: 'cannot create or reopen task' },
        { prefix: f.allocated, record: { type: 'workspace-allocation/changed', createdAt: 31,
          allocation: { ...f.allocation, id: 'unknown-cleanup-allocation', revision: 2, lifecycle: 'release-requested',
            releaseRequestedAt: 31, updatedAt: 31 } }, message: 'cannot create or reactivate workspace allocation' },
        { prefix: f.allocated, record: { type: 'workspace-allocation/changed', createdAt: 31,
          allocation: { ...f.allocation, revision: 2, lifecycle: 'active', activatedAt: 31, updatedAt: 31 } },
        message: 'cannot create or reactivate workspace allocation' },
        { prefix: f.roster, record: { type: 'activation/changed', createdAt: 31,
          binding: { ...f.binding, activation: { ...f.binding.activation, id: 'unknown-cleanup-epoch', status: 'stopping' } } },
        message: 'cannot create or reactivate activation' },
        { prefix: f.roster, record: { type: 'activation/changed', createdAt: 31,
          binding: { ...f.binding, activation: { ...f.binding.activation, status: 'running' } } },
        message: 'cannot create or reactivate activation' },
        { prefix: f.compiling, record: { type: 'workflow-plan/changed', createdAt: 31,
          plan: { ...f.failedPlan, id: 'unknown-cleanup-plan' } }, message: 'cannot create or reopen workflow plan' },
        { prefix: [...f.compiling, { type: 'channel/attached', channelId: 'late-workflow-binding', createdAt: 17 }],
          record: { type: 'workflow-plan/changed', createdAt: 31,
            plan: { ...f.failedPlan, phase: 'compiling', failure: undefined, channelId: 'late-workflow-binding' } },
          message: 'cannot create or reopen workflow plan' },
      ]
      for (const { prefix, record, message } of cases) {
        const closing = [...prefix, ...closureRecords('failed').slice(0, -1)]
        checkpointFor(closing)
        const ctx = await recover(backend, [...closing, record])
        await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow(message)
      }
    })

    it('keeps preservation, release and exact quiescence legal while failure cleanup settles', async () => {
      const f = fixture()
      const closing = [...f.allocated, ...closureRecords('failed').slice(0, -1)]
      const preserved = { ...f.allocation, revision: 2, lifecycle: 'preserved', preservedAt: 31, updatedAt: 31,
        preservationReason: { code: 'RETRY_RELEASE', message: 'The owner will retry release.' } }
      const releaseRequested = { ...preserved, revision: 3, lifecycle: 'release-requested', releaseRequestedAt: 32, updatedAt: 32 }
      const released = { ...releaseRequested, revision: 4, lifecycle: 'released', releasedAt: 33, updatedAt: 33 }
      const stoppedTask = task({ ...f.runningTask, revision: 4, phase: 'cancelled', lease: undefined,
        attemptHistory: [{ ...f.attempt, settledAt: 34, outcome: { kind: 'released' } }] })
      const quiesced = { ...f.quiesced, quiescedAt: 34 }
      const records = [...closing,
        { type: 'workspace-allocation/changed', allocation: preserved, createdAt: 31 },
        { type: 'activation/changed', binding: { ...f.binding, activation: { ...f.binding.activation, status: 'stopping' } }, createdAt: 31 },
        { type: 'workspace-allocation/changed', allocation: releaseRequested, createdAt: 32 },
        { type: 'workspace-allocation/changed', allocation: released, createdAt: 33 },
        taskChanged({ task: stoppedTask, createdAt: 34 }),
        { type: 'activation/changed', binding: quiesced, createdAt: 34 },
        { type: 'workflow-plan/changed', plan: f.failedPlan, createdAt: 35 },
        { type: 'team/phase', phase: 'failed', createdAt: 36 },
      ]
      const ctx = await recover(backend, records, checkpointFor(records))
      const state = await ctx.teams.getTeam({ teamId })
      expect(state.team.phase).toBe('failed')
      expect(state.tasks[0]?.phase).toBe('cancelled')
      expect(state.workspaceAllocations).toEqual([released])
      expect(state.activations).toEqual([quiesced])
    })

    it('retains completed, failed and deleted task facts after Team settlement', async () => {
      for (const phase of ['completed', 'failed'] as const) {
        const f = fixture(false, phase)
        const rows = [...f.settled, ...closureRecords('failed')]
        const ctx = await recover(backend, rows, checkpointFor(rows))
        expect((await ctx.teams.getTeam({ teamId })).tasks[0]?.phase).toBe(phase)
      }
      const f = fixture()
      const deleted = task({ id: 'deleted-task' })
      const rows = [...f.settled.slice(0, 6), taskChanged({ task: deleted, createdAt: 15 }),
        taskChanged({ task: { ...deleted, revision: 2, phase: 'deleted' }, createdAt: 16 }),
        ...f.settled.slice(6), ...closureRecords('failed')]
      const ctx = await recover(backend, rows, checkpointFor(rows))
      expect((await ctx.teams.getTeam({ teamId })).tasks.find(candidate => candidate.id === deleted.id)?.phase).toBe('deleted')
    })

    it('rejects an outstanding review and each unreleased allocation lifecycle', async () => {
      const f = fixture(true)
      const reviewTask = task({ ...f.runningTask, revision: 4, phase: 'review', lease: undefined,
        attemptHistory: [{ ...f.attempt, outcome: { kind: 'completed', result: { summary: 'Ready for review.' } } }] })
      const review = [...f.running, taskChanged({ task: reviewTask, createdAt: 21 })]
      const variants = [review, ...[
        { ...f.allocation, lifecycle: 'active', activatedAt: 21 },
        { ...f.allocation, lifecycle: 'release-requested', releaseRequestedAt: 21 },
        { ...f.allocation, lifecycle: 'preserved', preservedAt: 21,
          preservationReason: { code: 'RETAINED', message: 'Release is not confirmed.' } },
      ].map(allocation => [...f.allocated, { type: 'workspace-allocation/changed',
        allocation: { ...allocation, revision: 2, updatedAt: 21 }, createdAt: 21 }])]
      for (const prefix of variants) {
        checkpointFor(prefix)
        const ctx = await recover(backend, [...prefix, ...closureRecords('failed')])
        await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      }
    })
  })
}
