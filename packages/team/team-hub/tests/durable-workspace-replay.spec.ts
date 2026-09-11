/** Workspace allocation ownership and lifecycle validation from durable records. @module */

import { describe, expect, it } from 'vitest'
import type { TeamTaskSnapshot } from '@clocky/clocky-team'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, otherTaskId, participant, participantChanged, task, taskChanged, taskCreatorActivationId, taskCreatorId,
  taskCreatorSessionId, taskId, taskLease, teamId, teamPhase } from './fixtures.ts'

function runningTaskPrefix(wakeChannelId?: string) {
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process' }
  const lease = taskLease({ participantId: taskCreatorId, activationId: taskCreatorActivationId,
    assignedAt: 17, renewedAt: 17, expiresAt: 27,
    ...wakeChannelId === undefined ? {} : { wakeChannelId },
  })
  const running = task({ phase: 'running', revision: 3, attemptCount: 1, lease: { ...lease, startedAt: 18 } })
  const records = [createdTeam(), teamPhase(),
    participantChanged({ participant: member, createdAt: 12 }),
    participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 }),
    { type: 'activation/changed', binding, createdAt: 15 },
    ...wakeChannelId === undefined ? [] : [{ type: 'channel/attached', channelId: wakeChannelId, createdAt: 15 }],
    taskChanged({ createdAt: 16 }),
    taskChanged({ task: task({ phase: 'assigned', revision: 2, attemptCount: 1, lease }), createdAt: 17 }),
    taskChanged({ task: running, createdAt: 18 }),
  ]
  checkpointFor(records)
  const allocation = { id: 'allocation-a', revision: 1, teamId, taskId, attemptId: lease.attemptId,
    assignedRevision: lease.assignedRevision, participantId: taskCreatorId, activationId: taskCreatorActivationId,
    sessionId: taskCreatorSessionId, provider: 'workspace-local', mode: 'shared', baseVersion: 'base-a',
    lifecycle: 'reserved', reservedAt: 19, updatedAt: 19 }
  return { records, allocation, running, binding }
}

function settledTask(running: TeamTaskSnapshot, kind: 'released' | 'cancelled' = 'released') {
  const lease = running.lease
  if (lease === undefined) throw new Error('settlement fixture requires a current lease')
  return task({ ...running, revision: running.revision + 1, lease: undefined,
    phase: kind === 'released' ? 'pending' : 'cancelled', attemptHistory: [{
      id: lease.attemptId, teamId, taskId: running.id, ordinal: lease.ordinal, participantId: lease.participantId,
      activationId: lease.activationId, assignedAt: lease.assignedAt, startedAt: lease.startedAt,
      wakeChannelId: lease.wakeChannelId, leaseExpiresAt: lease.expiresAt, settledAt: 20, outcome: { kind },
    }],
  })
}

function changed(allocation: object, createdAt: number) {
  return { type: 'workspace-allocation/changed', allocation, createdAt }
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable allocation replay (${backend})`, () => {
    it('retains preserved allocation ownership while resuming and releasing its exact attempt', async () => {
      const { records, allocation } = runningTaskPrefix()
      const preserved = { ...allocation, revision: 2, lifecycle: 'preserved', preservedAt: 20, updatedAt: 20,
        preservationReason: { code: 'PROVIDER_UNAVAILABLE', message: 'The provider cannot confirm release.' } }
      const active = { ...preserved, revision: 3, lifecycle: 'active', activatedAt: 21, updatedAt: 21 }
      const releasing = { ...active, revision: 4, lifecycle: 'release-requested', releaseRequestedAt: 22, updatedAt: 22 }
      const released = { ...releasing, revision: 5, lifecycle: 'released', releasedAt: 23, updatedAt: 23 }
      const rows = [...records, changed(allocation, 19), changed(preserved, 20), changed(active, 21),
        changed(releasing, 22), changed(released, 23)]
      const ctx = await recover(backend, rows, checkpointFor(rows))
      expect((await ctx.teams.getTeam({ teamId })).workspaceAllocations).toEqual([released])
      const reopened = await recover(backend, [...rows, changed({ ...released, revision: 6, lifecycle: 'active', activatedAt: 24, updatedAt: 24 }, 24)])
      await expect(reopened.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
    })

    it('refuses reservation identities or timestamps that do not belong to the current running attempt', async () => {
      const { records, allocation } = runningTaskPrefix()
      const changes = [
        { teamId: 'foreign-team' }, { taskId: 'missing-task' }, { attemptId: 'missing-attempt' },
        { participantId: 'foreign-participant' }, { activationId: 'foreign-activation' }, { sessionId: 'foreign-session' },
        { assignedRevision: 3 }, { mode: 'worktree' }, { revision: 2 }, { reservedAt: 18 },
      ]
      for (const fields of changes) {
        const ctx = await recover(backend, [...records, changed({ ...allocation, ...fields }, 19)])
        await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      }
      const assigned = await recover(backend, [...records.slice(0, -1), changed({ ...allocation, reservedAt: 18, updatedAt: 18 }, 18)])
      await expect(assigned.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
    })

    it('rejects duplicate allocation attempts and changes to admitted provider ownership', async () => {
      const { records, allocation } = runningTaskPrefix()
      const prefix = [...records, changed(allocation, 19)]
      const duplicate = await recover(backend, [...prefix,
        changed({ ...allocation, id: 'allocation-b', reservedAt: 20, updatedAt: 20 }, 20)])
      await expect(duplicate.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      for (const fields of [{ provider: 'other-provider' }, { baseVersion: 'other-base' }, { taskId: 'other-task' },
        { attemptId: 'other-attempt' }, { assignedRevision: 3 }, { participantId: 'other-participant' },
        { activationId: 'other-activation' }, { sessionId: 'other-session' }, { mode: 'worktree' }, { reservedAt: 18 }]) {
        const invalid = await recover(backend, [...prefix, changed({ ...allocation, revision: 2, lifecycle: 'active', activatedAt: 20,
          updatedAt: 20, ...fields }, 20)])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      }
    })

    it('rejects lifecycle jumps and operation timestamps that differ from their journal record', async () => {
      const { records, allocation } = runningTaskPrefix()
      const prefix = [...records, changed(allocation, 19)]
      const bad = [
        { ...allocation, revision: 3, lifecycle: 'active', activatedAt: 20, updatedAt: 20 },
        { ...allocation, revision: 2, lifecycle: 'released', releasedAt: 20, updatedAt: 20 },
        { ...allocation, revision: 2, lifecycle: 'active', activatedAt: 19, updatedAt: 20 },
        { ...allocation, revision: 2, lifecycle: 'release-requested', releaseRequestedAt: 19, updatedAt: 20 },
        { ...allocation, revision: 2, lifecycle: 'preserved', preservedAt: 19, updatedAt: 20,
          preservationReason: { code: 'RETAIN', message: 'Keep the allocation.' } },
      ]
      for (const value of bad) {
        const ctx = await recover(backend, [...prefix, changed(value, 20)])
        await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      }
      const releasing = { ...allocation, revision: 2, lifecycle: 'release-requested', releaseRequestedAt: 20, updatedAt: 20 }
      const invalid = await recover(backend, [...prefix, changed(releasing, 20),
        changed({ ...releasing, revision: 3, lifecycle: 'released', releasedAt: 20, updatedAt: 21 }, 21)])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
    })

    it('rejects absent creation commands and one-sided workflow fields from stored task JSON', async () => {
      const { records, running } = runningTaskPrefix()
      const checkpoint = checkpointFor(records)
      const variants = [
        { ...running, createCommand: undefined },
        { ...running, workflowPlanId: 'workflow-without-template' },
        { ...running, workflowTemplateId: 'template-without-plan' },
      ]
      for (const value of variants) {
        const invalid = await recover(backend, [...records, { type: 'task/changed', task: value, createdAt: 19 }])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
        const restored = await recover(backend, records, { ...checkpoint, tasks: [value] })
        expect((await restored.teams.getTeam({ teamId })).tasks).toEqual([running])
      }
    })

    it('keeps usage attached to a live or settled task attempt and its actual Session', async () => {
      const { records, running } = runningTaskPrefix()
      const settled = settledTask(running)
      const historyRows = [...records, taskChanged({ task: settled, createdAt: 20 })]
      const sample = { id: 'usage-a', teamId, participantId: taskCreatorId, sessionId: taskCreatorSessionId,
        provider: 'mock', model: 'model', turn: 1, step: 1, taskId, attemptId: running.lease?.attemptId,
        usage: { inputTokens: 2, outputTokens: 3 }, costUnits: 1, observedAt: 21 }
      const usage = { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0,
        turns: 1, costUnits: 1, updatedAt: 21 }
      const accepted = { type: 'usage/changed', sample, usage, createdAt: 21 }
      for (const prefix of [records, historyRows]) {
        const rows = [...prefix, accepted]
        const valid = await recover(backend, rows, checkpointFor(rows))
        expect((await valid.teams.getTeam({ teamId })).usage).toEqual(usage)
      }
      for (const fields of [{ taskId: 'missing-task' }, { attemptId: 'missing-attempt' }, { sessionId: 'foreign-session' }]) {
        const invalid = await recover(backend, [...historyRows, { ...accepted, sample: { ...sample, ...fields } }])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      }
    })

    it('rejects quiescence that retains a live task lease or a non-quiescence outcome', async () => {
      const { records, running, binding } = runningTaskPrefix()
      const proof = { ...binding, activation: { ...binding.activation, status: 'offline' },
        quiescedAt: 20, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] }
      const live = await recover(backend, [...records, { type: 'activation/changed', binding: proof, createdAt: 20 }])
      await expect(live.teams.getTeam({ teamId })).rejects.toThrow('retains an active task lease')
      const cancelled = settledTask(running, 'cancelled')
      const cancelledRows = [...records, taskChanged({ task: cancelled, createdAt: 20 })]
      checkpointFor(cancelledRows)
      const invalid = await recover(backend, [...cancelledRows, { type: 'activation/changed', binding: proof, createdAt: 20 }])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('non-quiescence task outcome')
      const releasedRows = [...records, taskChanged({ task: settledTask(running), createdAt: 20 }),
        { type: 'activation/changed', binding: proof, createdAt: 20 }]
      const valid = await recover(backend, releasedRows, checkpointFor(releasedRows))
      expect((await valid.teams.getTeam({ teamId })).activations).toEqual([proof])
    })

    it('recovers the exact historical wake after rejecting mismatched quiescence and detached checkpoints', async () => {
      const { records, running, binding } = runningTaskPrefix('task-wake')
      const settled = settledTask(running)
      const rows = [...records, taskChanged({ task: settled, createdAt: 20 })]
      const checkpoint = checkpointFor(rows)
      const proof = { ...binding, activation: { ...binding.activation, status: 'offline' },
        quiescedAt: 20, quiescenceSource: 'quiesced', quiescedWakeChannelIds: ['other-wake'] }
      const wrong = await recover(backend, [...rows, { type: 'activation/changed', binding: proof, createdAt: 20 }])
      await expect(wrong.teams.getTeam({ teamId })).rejects.toThrow('does not match its released task wakes')
      const restored = await recover(backend, rows, { ...checkpoint, channelIds: [] })
      expect((await restored.teams.getTeam({ teamId })).channelIds).toEqual(['task-wake'])
    })

    it('rejects shared or unattached current wakes and restores distinct checkpoint leases', async () => {
      const { records, running } = runningTaskPrefix('wake-a')
      const lease = taskLease({ attemptId: 'attempt-b', participantId: taskCreatorId,
        activationId: taskCreatorActivationId, assignedAt: 20, renewedAt: 20, expiresAt: 30,
        wakeChannelId: 'wake-b' })
      const pending = task({ id: otherTaskId })
      const assigned = task({ ...pending, phase: 'assigned', revision: 2, attemptCount: 1, lease })
      const prefix = [...records, { type: 'channel/attached', channelId: 'wake-b', createdAt: 19 },
        taskChanged({ task: pending, createdAt: 19 })]
      checkpointFor(prefix)
      const rows = [...prefix, taskChanged({ task: assigned, createdAt: 20 })]
      const checkpoint = checkpointFor(rows)
      const valid = await recover(backend, rows, checkpoint)
      expect((await valid.teams.getTeam({ teamId })).tasks).toEqual([running, assigned])

      for (const wakeChannelId of ['wake-a', 'unattached-wake']) {
        const conflicting = { ...assigned, lease: { ...lease, wakeChannelId } }
        const invalid = await recover(backend, [...prefix, { type: 'task/changed', task: conflicting, createdAt: 20 }])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('invalid new lease transition')
        const restored = await recover(backend, rows, { ...checkpoint, tasks: [running, conflicting] })
        expect((await restored.teams.getTeam({ teamId })).tasks).toEqual([running, assigned])
      }
    })

    it('retains historical creators and exact wake cleanup after quiescence and checkpoint recovery', async () => {
      const { records, running, binding } = runningTaskPrefix('task-wake')
      const released = settledTask(running)
      const proof = { ...binding, activation: { ...binding.activation, status: 'offline' },
        quiescedAt: 20, quiescenceSource: 'quiesced', quiescedWakeChannelIds: ['task-wake'] }
      const prefix = [...records, taskChanged({ task: released, createdAt: 20 }),
        { type: 'activation/changed', binding: proof, createdAt: 20 }]
      const checkpoint = checkpointFor(prefix)
      const edited = task({ ...released, revision: released.revision + 1, subject: 'Resume after reassignment' })
      const rows = [...prefix, taskChanged({ task: edited, createdAt: 21 })]
      for (const data of [undefined, checkpoint]) {
        const valid = await recover(backend, rows, data, teamId, [], prefix.length - 1)
        const state = await valid.teams.getTeam({ teamId })
        expect(state.tasks).toEqual([edited])
        expect(state.activations).toEqual([proof])
      }

      for (const quiescedWakeChannelIds of [undefined, [], ['other-wake']]) {
        const restored = await recover(backend, rows, { ...checkpoint,
          activations: [{ ...proof, quiescedWakeChannelIds }],
        }, teamId, [], prefix.length - 1)
        const state = await restored.teams.getTeam({ teamId })
        expect(state.tasks).toEqual([edited])
        expect(state.activations).toEqual([proof])
      }
      const detached = await recover(backend, rows, { ...checkpoint, channelIds: [] }, teamId, [], prefix.length - 1)
      const state = await detached.teams.getTeam({ teamId })
      expect(state.channelIds).toEqual(['task-wake'])
      expect(state.activations).toEqual([proof])
      expect(state.tasks).toEqual([edited])
    })

    it('excludes earlier task settlements from a subsequent quiescence wake proof', async () => {
      const { records, running, binding } = runningTaskPrefix('earlier-wake')
      const released = settledTask(running)
      const prefix = [...records, taskChanged({ task: released, createdAt: 20 })]
      checkpointFor(prefix)
      const proof = { ...binding, activation: { ...binding.activation, status: 'offline' },
        quiescedAt: 21, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] }
      const rows = [...prefix, { type: 'activation/changed', binding: proof, createdAt: 21 }]
      const checkpoint = checkpointFor(rows)
      const valid = await recover(backend, rows, checkpoint)
      const state = await valid.teams.getTeam({ teamId })
      expect(state.tasks).toEqual([released])
      expect(state.activations).toEqual([proof])
      expect(state.channelIds).toEqual(['earlier-wake'])

      const repeated = { ...proof, quiescedWakeChannelIds: ['earlier-wake'] }
      const invalid = await recover(backend, [...prefix, { type: 'activation/changed', binding: repeated, createdAt: 21 }])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('does not match its released task wakes')
      const restored = await recover(backend, rows, { ...checkpoint, activations: [repeated] })
      expect((await restored.teams.getTeam({ teamId })).activations).toEqual([proof])
    })

    it('falls back from duplicate and foreign allocation checkpoint relations to the original journal', async () => {
      const { records, allocation } = runningTaskPrefix()
      const rows = [...records, changed(allocation, 19)]
      const data = checkpointFor(rows)
      for (const allocations of [[allocation, allocation], [allocation, { ...allocation, id: 'allocation-b' }],
        [{ ...allocation, sessionId: 'foreign-session' }], [{ ...allocation, taskId: 'missing-task' }]]) {
        const ctx = await recover(backend, rows, { ...data, workspaceAllocations: allocations })
        expect((await ctx.teams.getTeam({ teamId })).workspaceAllocations).toEqual([allocation])
      }
    })
  })
}
