/** Simulation operation attribution survives creator activation retirement. @module */
import { describe, expect, it } from 'vitest'
import { teamSystemTaskControlScopeSchema } from '@clocky/clocky-team'
import type { TeamSystemTaskControlProof } from '@clocky/clocky-team'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, task, taskChanged, teamId, teamPhase } from './fixtures.ts'

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable Simulation task creator (${backend})`, () => {
    it.each(['phase', 'cancellation', 'closure'] as const)('reconciles committed tasks but refuses new tasks after a retained %s', async (stop) => {
      const member = participant({ id: 'simulation-member', role: 'worker' })
      const initial = task({ id: 'simulation-task', createCommand: { creator: { kind: 'simulation', teamId,
        participantId: member.id, runId: 'simulation', operationId: 'accepted-operation' },
      idempotencyKey: JSON.stringify(['simulation-task', 'simulation', 'accepted-operation']) } })
      const intent = { teamId, idempotencyKey: 'stop-task-admission', actor: { kind: 'system', name: 'team-run' },
        reason: { code: 'STOP', message: 'Stop accepting work' }, requestedAt: 16 }
      const stopped = stop === 'phase' ? teamPhase({ phase: 'quiescing', createdAt: 16 })
        : stop === 'cancellation' ? { type: 'team/cancellation', createdAt: 16, cancellation: intent }
          : { type: 'team/closure', createdAt: 16, closure: { ...intent, kind: 'fail' } }
      const ctx = await recover(backend, [
        createdTeam({ rules: { simulationRunId: 'simulation', activationLifecycleOwner: 'simulation/owner' } }), teamPhase(),
        participantChanged({ participant: member, createdAt: 12 }),
        participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
        participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 }),
        taskChanged({ task: initial, createdAt: 15 }), stopped,
      ])
      const proof = Object.freeze({}) as TeamSystemTaskControlProof
      const input = { teamId, createCommand: { idempotencyKey: initial.createCommand.idempotencyKey },
        subject: initial.subject, description: initial.description, blockedBy: initial.blockedBy,
        requiredCapabilities: initial.requiredCapabilities, priority: initial.priority, readScopes: initial.readScopes,
        writeScopes: initial.writeScopes, workspaceMode: initial.workspaceMode, budget: initial.budget,
        reviewPolicy: initial.reviewPolicy, maxAttempts: initial.maxAttempts }
      let scope = teamSystemTaskControlScopeSchema.parse({ kind: 'simulation-task-create', runId: 'simulation',
        operationId: 'accepted-operation', lifecycleOwner: 'simulation/owner', participantId: member.id, publishAllowed: true, input })
      ctx.teams.registerSystemTaskControlProofSource({ name: 'simulation-team',
        resolveTaskControlProof: candidate => candidate === proof ? scope : undefined })
      const before = await ctx.teams.getTeam({ teamId })
      expect(await ctx.teams.createSimulationTask({ ...input, actor: proof, expectedCursor: 0 })).toEqual(initial)
      const fresh = { ...input, createCommand: { idempotencyKey: JSON.stringify(['simulation-task', 'simulation', 'new-operation']) } }
      scope = teamSystemTaskControlScopeSchema.parse({ ...scope, operationId: 'new-operation', input: fresh })
      if (scope.kind !== 'simulation-task-create') throw new Error('Fixture task scope missing')
      await expect(ctx.teams.createSimulationTask({ ...scope.input, actor: proof, expectedCursor: before.team.cursor }))
        .rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
      expect(await ctx.teams.getTeam({ teamId })).toEqual(before)
    })

    it('retains operation attribution without an activation and rejects a foreign run or repeated command', async () => {
      const member = participant({ id: 'simulation-member', role: 'worker' })
      const prefix = [createdTeam({ rules: { simulationRunId: 'simulation', activationLifecycleOwner: 'simulation/owner' } }), teamPhase(),
        participantChanged({ participant: member, createdAt: 12 }),
        participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
        participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 })]
      const initial = task({ id: 'simulation-task', createCommand: { creator: { kind: 'simulation', teamId,
        participantId: member.id, runId: 'simulation', operationId: 'accepted-operation' },
      idempotencyKey: JSON.stringify(['simulation-task', 'simulation', 'accepted-operation']) } })
      const closing = await recover(backend, [...prefix, teamPhase({ phase: 'quiescing', createdAt: 15 }),
        taskChanged({ task: initial, createdAt: 16 })])
      await expect(closing.teams.getTeam({ teamId })).rejects.toThrow(/invalid Simulation creation relation/)
      const cancelled = await recover(backend, [...prefix, { type: 'team/cancellation', createdAt: 15,
        cancellation: { teamId, idempotencyKey: 'cancel-task-admission', actor: { kind: 'system', name: 'team-run' },
          reason: { code: 'CANCEL', message: 'Stop accepting work' }, requestedAt: 15 } },
      taskChanged({ task: initial, createdAt: 16 })])
      await expect(cancelled.teams.getTeam({ teamId })).rejects.toThrow(/invalid Simulation creation relation/)
      const rows = [...prefix, taskChanged({ task: initial, createdAt: 15 }),
        participantChanged({ participant: { ...member, phase: 'left' }, createdAt: 16 })]
      for (const checkpoint of [undefined, checkpointFor(rows)]) {
        const restored = await recover(backend, rows, checkpoint)
        expect((await restored.teams.getTeam({ teamId })).tasks).toEqual([initial])
      }
      const repeated = task({ ...initial, id: 'duplicate-task' })
      const duplicate = await recover(backend, [...prefix, taskChanged({ task: initial, createdAt: 15 }),
        taskChanged({ task: repeated, createdAt: 16 })])
      await expect(duplicate.teams.getTeam({ teamId })).rejects.toThrow(/repeats a task-creation command/)
      const foreign = task({ ...initial, createCommand: { creator: { ...initial.createCommand.creator, runId: 'foreign' },
        idempotencyKey: JSON.stringify(['simulation-task', 'foreign', 'accepted-operation']) } })
      const invalid = await recover(backend, [...prefix, taskChanged({ task: foreign, createdAt: 15 })])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow(/invalid Simulation creation relation/)
    })
  })
}
