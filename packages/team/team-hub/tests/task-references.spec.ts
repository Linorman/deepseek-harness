/** Exact reference projections retain the durable map's tombstones on both storage owners. */
import { expect, it } from 'vitest'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, teamPhase, participant, participantChanged, task, taskChanged, teamId,
  taskCreatorId, taskCreatorActivationId, taskCreatorSessionId } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('reads only requested task status with revision and byte fences (%s)', async (backend) => {
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process' }
  const first = task({ id: 'reference-live', createdAt: 20, subject: 'Live selected dependency', description: 'Private task instruction' })
  const deleted = task({ id: 'reference-deleted', createdAt: 21, subject: 'Deleted selected dependency' })
  const records = [createdTeam(), teamPhase(),
    ...(['invited', 'provisioning', 'active'] as const).map((phase, index) => participantChanged({ participant: { ...member, phase }, createdAt: 12 + index })),
    { type: 'activation/changed', binding, createdAt: 15 },
    taskChanged({ task: first, createdAt: 20 }), taskChanged({ task: deleted, createdAt: 21 }),
    taskChanged({ task: { ...deleted, phase: 'deleted', revision: 2 }, createdAt: 22 })]
  const ctx = await recover(backend, records, undefined, teamId, [], records.length - 1, [], { recoveryPageSize: 1 })
  const before = await ctx.teams.getTeam({ teamId })
  const taskIds = [first.id, deleted.id, 'foreign-task' as never, 'missing-task' as never]
  const result = await ctx.teams.resolveTaskReferences({ teamId, taskIds })
  expect(result.items).toMatchObject([{ taskId: first.id, state: 'resolved', phase: 'pending' }])
  expect(result.nextCursor).toBe(1)
  const tombstone = await ctx.teams.resolveTaskReferences({ teamId, taskIds, afterCursor: 1, expectedTeamCursor: result.teamCursor })
  expect(tombstone.items).toMatchObject([{ taskId: deleted.id, state: 'resolved', phase: 'deleted', revision: 2 }])
  const unavailable = await ctx.teams.resolveTaskReferences({ teamId, taskIds, afterCursor: 2, expectedTeamCursor: result.teamCursor })
  expect(unavailable.items).toEqual([{ taskId: 'foreign-task', state: 'unavailable' }])
  expect(JSON.stringify(result)).not.toContain('Private task instruction')
  expect(await ctx.teams.getTeam({ teamId })).toEqual(before)
  expect(Object.isFrozen(result)).toBe(true)
  await expect(ctx.teams.resolveTaskReferences({ teamId, taskIds, expectedTeamCursor: result.teamCursor - 1 }))
    .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
  await expect(ctx.teams.resolveTaskReferences({ teamId, taskIds: ['x'.repeat(20000) as never] }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
})
