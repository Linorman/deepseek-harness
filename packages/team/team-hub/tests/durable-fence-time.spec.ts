/** Closure-owned activation fence times recovered through actual durable backends. @module */

import { describe, expect, it } from 'vitest'
import { activationBindingSnapshotSchema } from '@clocky/clocky-team'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, fenceTestActivation, participant, participantChanged, task, taskChanged,
  taskCreatorActivationId, taskCreatorId, taskCreatorSessionId, taskId, taskLease, teamId, teamPhase } from './fixtures.ts'

function stoppingAllocation(kind: 'fail' | 'cancel') {
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'sdk', recovery: {
      kind: 'sdk-local-cold-replace', version: 1, runtimeProvider: 'sdk', profile: 'local-sdk-v1',
      agent: { provider: 'mock', model: 'mock', maxTokens: 32 },
      process: { hostId: 'host-a', pid: 42, started: 'start-a', processGroupId: 42 },
    } }
  const lease = taskLease({ participantId: taskCreatorId, activationId: taskCreatorActivationId,
    assignedAt: 17, renewedAt: 17, expiresAt: 27 })
  const initial = task()
  const created = task({ ...initial, createCommand: { ...initial.createCommand,
    creator: { teamId, participantId: taskCreatorId, activationId: taskCreatorActivationId,
      sessionId: taskCreatorSessionId, provider: 'sdk' } } })
  const assigned = task({ ...created, phase: 'assigned', revision: 2, attemptCount: 1, lease })
  const running = task({ ...assigned, phase: 'running', revision: 3, lease: { ...lease, startedAt: 18 } })
  const allocation = { id: 'fence-allocation', revision: 1, teamId, taskId, attemptId: lease.attemptId,
    assignedRevision: lease.assignedRevision, participantId: taskCreatorId, activationId: taskCreatorActivationId,
    sessionId: taskCreatorSessionId, provider: 'workspace-local', mode: 'shared', baseVersion: 'base-a',
    lifecycle: 'reserved', reservedAt: 19, updatedAt: 19 }
  const intent = { teamId, actor: { kind: 'system', name: 'team-run' },
    reason: { code: 'STOP', message: 'The run must stop.' }, idempotencyKey: 'fence-intent', requestedAt: 20 }
  const stopping = { ...binding, activation: { ...binding.activation, status: 'stopping' } }
  const records = [createdTeam(), teamPhase(),
    participantChanged({ participant: member, createdAt: 12 }),
    participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 }),
    { type: 'activation/changed', binding, createdAt: 15 }, taskChanged({ task: created, createdAt: 16 }),
    taskChanged({ task: assigned, createdAt: 17 }),
    taskChanged({ task: running, createdAt: 18 }),
    { type: 'workspace-allocation/changed', allocation, createdAt: 19 },
    kind === 'cancel' ? { type: 'team/cancellation', cancellation: intent, createdAt: 20 }
      : { type: 'team/closure', closure: { ...intent, kind }, createdAt: 20 },
    { type: 'team/phase', phase: 'quiescing', createdAt: 21 },
    { type: 'activation/changed', binding: stopping, createdAt: 22 }]
  return { records, stopping, allocation, running, lease, intent }
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable fence time (${backend})`, () => {
    it('accepts a cancellation fence before the later terminal cancellation closure', async () => {
      const f = stoppingAllocation('cancel')
      const fenced = { ...f.stopping, fencedAt: 23 }
      const releasing = { ...f.allocation, revision: 2, lifecycle: 'release-requested', releaseRequestedAt: 23, updatedAt: 23 }
      const released = { ...releasing, revision: 3, lifecycle: 'released', releasedAt: 24, updatedAt: 24 }
      const settled = task({ ...f.running, phase: 'cancelled', revision: 4, lease: undefined,
        attemptHistory: [{ id: f.lease.attemptId, teamId, taskId, ordinal: f.lease.ordinal,
          participantId: taskCreatorId, activationId: taskCreatorActivationId, assignedAt: 17, startedAt: 18,
          leaseExpiresAt: 27, settledAt: 25, outcome: { kind: 'released' } }] })
      const offline = { ...fenced, activation: { ...fenced.activation, status: 'offline' },
        quiescedAt: 25, quiescenceSource: 'fenced', quiescedWakeChannelIds: [] }
      const records = [...f.records, { type: 'activation/changed', binding: fenced, createdAt: 23 },
        { type: 'workspace-allocation/changed', allocation: releasing, createdAt: 23 },
        { type: 'workspace-allocation/changed', allocation: released, createdAt: 24 },
        taskChanged({ task: settled, createdAt: 25 }), { type: 'activation/changed', binding: offline, createdAt: 25 },
        { type: 'team/closure', closure: { ...f.intent, kind: 'cancel', requestedAt: 26 }, createdAt: 26 },
        { type: 'team/phase', phase: 'cancelled', createdAt: 27 }]
      const checkpoint = checkpointFor(records)
      // This valid rules marker distinguishes checkpoint acceptance from fallback to the same journal facts.
      const ctx = await recover(backend, records, { ...checkpoint, rules: { ...checkpoint.rules, retainedFence: true } })
      const state = await ctx.teams.getTeam({ teamId })
      expect(state.rules).toHaveProperty('retainedFence', true)
      expect(state.activations).toEqual([offline])
      expect(state.team.cancellation?.requestedAt).toBeLessThan(offline.fencedAt)
      expect(state.team.closure?.requestedAt).toBeGreaterThan(offline.fencedAt)
    })

    for (const kind of ['fail', 'cancel'] as const) {
      it(`records a new ${kind} fence on an already stopping epoch with a live allocation`, async () => {
        const f = stoppingAllocation(kind)
        const ctx = await recover(backend, f.records)
        const before = await ctx.teams.getTeam({ teamId })
        // The registered source exercises Hub proof admission; no fixture descriptor proves process termination.
        const fenced = await fenceTestActivation(ctx, { teamId, participantId: taskCreatorId,
          activationId: taskCreatorActivationId, sessionId: taskCreatorSessionId, provider: 'sdk',
          expectedCursor: before.team.cursor })
        expect(fenced.activations[0]).toMatchObject({ activation: { status: 'stopping' }, fencedAt: fenced.team.updatedAt })
        expect(fenced.workspaceAllocations[0]).toMatchObject({ lifecycle: 'release-requested', revision: 2 })
        expect(fenced.activations[0]?.quiescedAt).toBeUndefined()
      })

      it.each([9, 19])(`restores a ${kind} fence checkpoint that predates its Team or intent at %i`, async (fencedAt) => {
        const f = stoppingAllocation(kind)
        const fenced = { ...f.stopping, fencedAt: 23 }
        const records = [...f.records, { type: 'activation/changed', binding: fenced, createdAt: 23 },
          { type: 'workspace-allocation/changed', allocation: { ...f.allocation, revision: 2,
            lifecycle: 'release-requested', releaseRequestedAt: 23, updatedAt: 23 }, createdAt: 23 }]
        const checkpoint = checkpointFor(records)
        const damaged = { ...fenced, fencedAt }
        expect(activationBindingSnapshotSchema.safeParse(damaged).success).toBe(true)
        const ctx = await recover(backend, records, { ...checkpoint, activations: [damaged] })
        expect((await ctx.teams.getTeam({ teamId })).activations).toEqual([fenced])
      })
    }
  })
}
