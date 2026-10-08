/** Workspace allocation ownership and lifecycle validation from durable records. @module */

import { describe, expect, it } from 'vitest'
import { teamWorkspaceAllocationActivateInputSchema, teamWorkspaceAllocationLossInputSchema,
  teamWorkspaceAllocationPreserveInputSchema, teamWorkspaceAllocationReleaseInputSchema,
  teamWorkspaceAllocationReleaseRequestInputSchema, teamWorkspaceAllocationReserveInputSchema,
  teamWorkspaceObservationInputSchema } from '@clocky/clocky-team'
import { teamProjectionFromData } from '../src/fold.ts'
import { teamProjectionDataSchema } from '../src/schema.ts'
import type { TeamTaskSnapshot, TeamWorkspaceAllocationSnapshot, TeamWorkspaceObservationInput, TeamSystemWorkspaceAllocationProof,
  TeamSystemWorkspaceAllocationScope } from '@clocky/clocky-team'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, otherTaskId, participant, participantChanged, task as baseTask, taskChanged, taskCreatorActivationId, taskCreatorId,
  taskCreatorSessionId, taskId, taskLease, teamId, teamPhase } from './fixtures.ts'

function task(overrides: Record<string, unknown> = {}) { return baseTask({ createdAt: 16, ...overrides }) }

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
      const pending = task({ id: otherTaskId, createdAt: 19 })
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

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable workspace loss and observations (${backend})`, () => {
    it('rejects a second allocation for the same retained task attempt', async () => {
      const { records, allocation } = runningTaskPrefix()
      const next = { ...allocation, id: 'allocation-duplicate', reservedAt: 20, updatedAt: 20 }
      const ctx = await recover(backend, [...records, changed(allocation, 19), changed(next, 20)])
      await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow('repeats task attempt')
    })

    it.each(['loss removed', 'confirmed loss changed', 'lost world reactivated', 'release time outside transition'])('rejects %s', async (variant) => {
      const { records, allocation } = runningTaskPrefix()
      const executionWorld = { kind: 'e2b', id: 'sandbox' }
      const reserved = { ...allocation, executionWorld }
      const loss = { executionWorld, reason: 'sandbox-expired', terminationProven: true, artifacts: [], observedAt: 20 }
      const unavailable = { ...reserved, revision: 2, lifecycle: 'unavailable', loss, updatedAt: 20 }
      const baseline = [...records, changed(reserved, 19), changed(unavailable, 20)]
      checkpointFor(baseline)
      const next = { ...unavailable, revision: 3, lifecycle: 'release-requested', releaseRequestedAt: 21, updatedAt: 21 }
      const damaged = variant === 'loss removed' ? { ...next, loss: undefined }
        : variant === 'confirmed loss changed' ? { ...next, loss: { ...loss, observedAt: 21 } }
          : variant === 'lost world reactivated' ? { ...next, lifecycle: 'active', activatedAt: 21 }
            : { ...next, lifecycle: 'preserved', preservedAt: 21, preservationReason: { code: 'preserve', message: 'Keep artifacts' } }
      const ctx = await recover(backend, [...baseline, changed(damaged, 21)])
      const message = variant === 'loss removed' || variant === 'confirmed loss changed' ? 'discarded its confirmed loss'
        : variant === 'lost world reactivated' ? 'cannot reactivate a lost execution world' : 'changed release intent'
      await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow(message)
    })

    it('keeps provider-retained loss artifacts through later loss observations', async () => {
      const { records, allocation } = runningTaskPrefix()
      const executionWorld = { kind: 'e2b', id: 'sandbox' }
      const reserved = { ...allocation, executionWorld }
      const loss = { executionWorld, reason: 'manifest-missing', terminationProven: false,
        artifacts: [{ id: 'log', provider: 'workspace-local', kind: 'log', uri: 'log:1', sourceAttemptId: allocation.attemptId, visibility: 'team' }],
        observedAt: 20 }
      const unavailable = { ...reserved, revision: 2, lifecycle: 'unavailable', loss, updatedAt: 20 }
      const baseline = [...records, changed(reserved, 19), changed(unavailable, 20)]
      checkpointFor(baseline)
      const ctx = await recover(backend, [...baseline, changed({ ...unavailable, revision: 3,
        loss: { ...loss, artifacts: [], observedAt: 21 }, updatedAt: 21 }, 21)])
      await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow('discarded its confirmed loss or retained artifacts')
    })

    it('replays exact observation facts and refuses missing allocation or forged projection fields', async () => {
      const { records, allocation } = runningTaskPrefix()
      const observation = baselineObservation(allocation)
      const row = { type: 'workspace/observed', observation, createdAt: 20 }
      const baseline = [...records, changed(allocation, 19)]
      checkpointFor([...baseline, row])
      for (const patch of [{ allocationId: 'missing' }, { truncated: true }, { taskId: otherTaskId }]) {
        const ctx = await recover(backend, [...baseline, { ...row, observation: { ...observation, ...patch } }])
        await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow('allocationId' in patch
          ? 'Workspace observation has no owning allocation or task' : 'Workspace observation does not match its allocation, window or scope')
      }
      const valid = await recover(backend, [...baseline, row])
      expect((await valid.teams.getTeam({ teamId })).workspaceAllocations[0]?.observation).toEqual(observation)
    })
  })
}

/** Complete provider baseline with Hub-derived attempt provenance. */
function baselineObservation(allocation: ReturnType<typeof runningTaskPrefix>['allocation']) {
  return { teamId, allocationId: allocation.id, expectedRevision: 1, id: 'scan', stage: 'baseline', base: null,
    baselineAvailable: true, final: { digest: `sha256:${'a'.repeat(64)}`, complete: true, startedAt: 19, finishedAt: 20,
      scannedEntries: 0, hashedBytes: 0, knownOmittedEntries: 0, incompleteReasons: [] },
    paths: [], omittedPaths: 0, taskId, attemptId: allocation.attemptId, truncated: false, observedAt: 20 }
}

it.each(['json', 'sqlite'] as const)('records a provider baseline and classifies one later scan from the retained attempt (%s)', async (backend) => {
  const { records, allocation } = runningTaskPrefix()
  const ctx = await recover(backend, [...records, changed(allocation, 19)])
  const scopes = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()
  ctx.teams.registerSystemWorkspaceAllocationProofSource({ name: 'team-workspace-observation/workspace-local',
    resolveWorkspaceAllocationProof: proof => scopes.get(proof) })
  const observe = async (input: TeamWorkspaceObservationInput) => {
    const proof = Object.freeze({}) as TeamSystemWorkspaceAllocationProof
    scopes.set(proof, { kind: 'workspace-observe', ...input })
    try { return await ctx.teams.recordWorkspaceObservation({ ...input, actor: proof }) }
    finally { scopes.delete(proof) }
  }
  const { taskId: _task, attemptId: _attempt, truncated: _truncated, observedAt: _at, ...raw } = baselineObservation(allocation)
  const baselineInput = teamWorkspaceObservationInputSchema.parse(raw)
  const baseline = await observe(baselineInput)
  expect(baseline).toMatchObject({ id: 'scan', taskId, attemptId: allocation.attemptId,
    stage: 'baseline', paths: [], truncated: false })
  const beforeRetry = await ctx.teams.getTeam({ teamId })
  expect(await observe(baselineInput)).toEqual(baseline)
  expect(await ctx.teams.getTeam({ teamId })).toEqual(beforeRetry)

  const periodicInput = teamWorkspaceObservationInputSchema.parse({ ...baselineInput, id: 'scan-2',
    previousObservationId: baseline.id, stage: 'periodic', base: baseline.final,
    final: { ...baseline.final, startedAt: 21, finishedAt: 22 }, paths: [
      { path: 'packages/team/result.txt', change: 'modified' },
      { path: 'unowned.txt', change: 'modified' },
    ] })
  const periodic = await observe(periodicInput)
  expect(periodic.paths).toEqual([
    { path: 'packages/team/result.txt', change: 'modified', classification: 'declared' },
    { path: 'unowned.txt', change: 'modified', classification: 'undeclared' },
  ])
  expect((await ctx.teams.getTeam({ teamId })).workspaceAllocations[0]?.observation).toEqual(periodic)
  await expect(observe({ ...periodicInput, paths: [{ path: 'other.txt', change: 'modified' }] }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
})

it.each(['sandbox-expired', 'manifest-missing'] as const)(
  'retains an exact %s execution-world loss and stalls only when termination is unconfirmed', async (reason) => {
    const { records, allocation } = runningTaskPrefix()
    const executionWorld = { kind: 'e2b', id: 'sandbox-world' }
    const reserved = { ...allocation, executionWorld }
    const ctx = await recover('json', [...records, changed(reserved, 19)])
    const scopes = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()
    ctx.teams.registerSystemWorkspaceAllocationProofSource({ name: 'team-agent-client-workspace-local',
      resolveWorkspaceAllocationProof: proof => scopes.get(proof) })
    const state = await ctx.teams.getTeam({ teamId })
    const input = teamWorkspaceAllocationLossInputSchema.parse({ teamId, allocationId: reserved.id,
      expectedCursor: state.team.cursor, expectedRevision: reserved.revision,
      loss: { executionWorld, reason, terminationProven: reason === 'sandbox-expired',
        artifacts: [{ id: 'retained-log', provider: 'workspace-local', kind: 'log', uri: 'log:retained',
          sourceAttemptId: allocation.attemptId, visibility: 'team' }] } })
    const foreignProof = Object.freeze({}) as TeamSystemWorkspaceAllocationProof
    ctx.teams.registerSystemWorkspaceAllocationProofSource({ name: 'unrelated-workspace-owner',
      resolveWorkspaceAllocationProof: proof => proof === foreignProof
        ? { kind: 'workspace-allocation-loss', ...input } : undefined })
    await expect(ctx.teams.recordWorkspaceAllocationLoss({ ...input, actor: foreignProof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    for (const artifact of [
      { id: 'no-provider', kind: 'log', uri: 'log:missing-provider', sourceAttemptId: allocation.attemptId, visibility: 'team' },
      { id: 'wrong-attempt', provider: 'workspace-local', kind: 'log', uri: 'log:wrong-attempt',
        sourceAttemptId: 'different-attempt', visibility: 'team' },
    ]) {
      const rejected = teamWorkspaceAllocationLossInputSchema.parse({ ...input,
        loss: { ...input.loss, artifacts: [artifact] } })
      const invalidProof = Object.freeze({}) as TeamSystemWorkspaceAllocationProof
      scopes.set(invalidProof, { kind: 'workspace-allocation-loss', ...rejected })
      await expect(ctx.teams.recordWorkspaceAllocationLoss({ ...rejected, actor: invalidProof }))
        .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    }
    expect(await ctx.teams.getTeam({ teamId })).toEqual(state)
    const proof = Object.freeze({}) as TeamSystemWorkspaceAllocationProof
    scopes.set(proof, { kind: 'workspace-allocation-loss', ...input })
    const unavailable = await ctx.teams.recordWorkspaceAllocationLoss({ ...input, actor: proof })
    expect(unavailable).toMatchObject({ lifecycle: 'unavailable', loss: input.loss })
    expect((await ctx.teams.getTeam({ teamId })).team.phase).toBe(reason === 'sandbox-expired' ? 'active' : 'stalled')
    const beforeRetry = await ctx.teams.getTeam({ teamId })
    expect(await ctx.teams.recordWorkspaceAllocationLoss({ ...input, actor: proof })).toEqual(unavailable)
    expect(await ctx.teams.getTeam({ teamId })).toEqual(beforeRetry)
    const changedLoss = teamWorkspaceAllocationLossInputSchema.parse({ ...input,
      expectedCursor: beforeRetry.team.cursor, expectedRevision: unavailable.revision,
      loss: { ...input.loss, artifacts: [] } })
    const changedProof = Object.freeze({}) as TeamSystemWorkspaceAllocationProof
    scopes.set(changedProof, { kind: 'workspace-allocation-loss', ...changedLoss })
    await expect(ctx.teams.recordWorkspaceAllocationLoss({ ...changedLoss, actor: changedProof }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect((await ctx.teams.getTeam({ teamId })).workspaceAllocations[0]?.loss?.artifacts)
      .toEqual(input.loss.artifacts)
    scopes.delete(proof)
    await expect(ctx.teams.recordWorkspaceAllocationLoss({ ...input, actor: proof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  },
)

it('admits recovery-owned execution-world loss only after a durable release request', async () => {
  const { records, allocation } = runningTaskPrefix()
  const executionWorld = { kind: 'e2b', id: 'recovery-world' }
  const reserved = { ...allocation, executionWorld }
  const active = { ...reserved, revision: 2, lifecycle: 'active', activatedAt: 20, updatedAt: 20 }
  const releasing = { ...active, revision: 3, lifecycle: 'release-requested', releaseRequestedAt: 21, updatedAt: 21 }
  const ctx = await recover('json', [...records, changed(reserved, 19), changed(active, 20), changed(releasing, 21)])
  const state = await ctx.teams.getTeam({ teamId })
  const input = teamWorkspaceAllocationLossInputSchema.parse({ teamId, allocationId: reserved.id,
    expectedCursor: state.team.cursor, expectedRevision: releasing.revision,
    loss: { executionWorld, reason: 'manifest-missing', terminationProven: false, artifacts: [] } })
  const proof = Object.freeze({}) as TeamSystemWorkspaceAllocationProof
  ctx.teams.registerSystemWorkspaceAllocationProofSource({ name: 'team-workspace-recovery',
    resolveWorkspaceAllocationProof: candidate => candidate === proof
      ? { kind: 'workspace-allocation-loss', ...input } : undefined })
  const unavailable = await ctx.teams.recordWorkspaceAllocationLoss({ ...input, actor: proof })
  expect(unavailable).toMatchObject({ lifecycle: 'unavailable', loss: input.loss })
  expect((await ctx.teams.getTeam({ teamId })).team).toMatchObject({ phase: 'stalled',
    stallReason: { code: 'WORKSPACE_LOSS_UNCONFIRMED' } })
})

it.each(['json', 'sqlite'] as const)('replays only the original workspace reservation metadata (%s)', async (backend) => {
  const { records, allocation, running } = runningTaskPrefix()
  const ctx = await recover(backend, [...records, changed(allocation, 19)])
  const scopes = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()
  ctx.teams.registerSystemWorkspaceAllocationProofSource({ name: 'team-workspace-shared',
    resolveWorkspaceAllocationProof: proof => scopes.get(proof) })
  const state = await ctx.teams.getTeam({ teamId })
  const input = teamWorkspaceAllocationReserveInputSchema.parse({ teamId, expectedCursor: state.team.cursor,
    taskId: running.id, expectedTaskRevision: running.revision, attemptId: allocation.attemptId,
    allocation: { id: allocation.id, provider: allocation.provider, mode: allocation.mode,
      assignedRevision: allocation.assignedRevision, participantId: allocation.participantId,
      activationId: allocation.activationId, sessionId: allocation.sessionId, baseVersion: allocation.baseVersion } })
  const proof = Object.freeze({}) as TeamSystemWorkspaceAllocationProof
  scopes.set(proof, { kind: 'workspace-allocation-reserve', ...input })
  expect(await ctx.teams.reserveWorkspaceAllocation({ ...input, actor: proof })).toEqual(allocation)
  expect(await ctx.teams.getTeam({ teamId })).toEqual(state)
  const changedInput = teamWorkspaceAllocationReserveInputSchema.parse({ ...input,
    allocation: { ...input.allocation, baseVersion: 'different-base' } })
  const changedProof = Object.freeze({}) as TeamSystemWorkspaceAllocationProof
  scopes.set(changedProof, { kind: 'workspace-allocation-reserve', ...changedInput })
  await expect(ctx.teams.reserveWorkspaceAllocation({ ...changedInput, actor: changedProof }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
})

it.each(['json', 'sqlite'] as const)('replays each exact workspace allocation lifecycle transition without another write (%s)', async (backend) => {
  const { records, allocation } = runningTaskPrefix()
  const ctx = await recover(backend, [...records, changed(allocation, 19)])
  const scopes = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()
  ctx.teams.registerSystemWorkspaceAllocationProofSource({ name: 'team-workspace-shared',
    resolveWorkspaceAllocationProof: proof => scopes.get(proof) })
  const replay = async (scope: TeamSystemWorkspaceAllocationScope,
    run: (actor: TeamSystemWorkspaceAllocationProof) => Promise<TeamWorkspaceAllocationSnapshot>) => {
    const proof = Object.freeze({}) as TeamSystemWorkspaceAllocationProof
    scopes.set(proof, scope)
    const first = await run(proof)
    const state = await ctx.teams.getTeam({ teamId })
    expect(await run(proof)).toEqual(first)
    expect(await ctx.teams.getTeam({ teamId })).toEqual(state)
    scopes.delete(proof)
    return first
  }
  let state = await ctx.teams.getTeam({ teamId })
  const activate = teamWorkspaceAllocationActivateInputSchema.parse({ teamId, allocationId: allocation.id,
    expectedCursor: state.team.cursor, expectedRevision: allocation.revision })
  const active = await replay({ kind: 'workspace-allocation-activate', ...activate }, async actor =>
    await ctx.teams.activateWorkspaceAllocation({ actor, ...activate }))
  state = await ctx.teams.getTeam({ teamId })
  const preserve = teamWorkspaceAllocationPreserveInputSchema.parse({ teamId, allocationId: allocation.id,
    expectedCursor: state.team.cursor, expectedRevision: active.revision,
    reason: { code: 'PROVIDER_UNAVAILABLE', message: 'Physical cleanup is not confirmed.' } })
  const preserved = await replay({ kind: 'workspace-allocation-preserve', ...preserve }, async actor =>
    await ctx.teams.preserveWorkspaceAllocation({ actor, ...preserve }))
  state = await ctx.teams.getTeam({ teamId })
  const request = teamWorkspaceAllocationReleaseRequestInputSchema.parse({ teamId, allocationId: allocation.id,
    expectedCursor: state.team.cursor, expectedRevision: preserved.revision })
  const releasing = await replay({ kind: 'workspace-allocation-release-request', ...request }, async actor =>
    await ctx.teams.requestWorkspaceAllocationRelease({ actor, ...request }))
  state = await ctx.teams.getTeam({ teamId })
  const release = teamWorkspaceAllocationReleaseInputSchema.parse({ teamId, allocationId: allocation.id,
    expectedCursor: state.team.cursor, expectedRevision: releasing.revision })
  const released = await replay({ kind: 'workspace-allocation-release', ...release }, async actor =>
    await ctx.teams.confirmWorkspaceAllocationRelease({ actor, ...release }))
  expect(released).toMatchObject({ lifecycle: 'released', revision: allocation.revision + 4 })
})

it.each(['json', 'sqlite'] as const)('admits only release observations during closure and preserves observation identity (%s)', async (backend) => {
  const { records, allocation } = runningTaskPrefix()
  const observation = baselineObservation(allocation)
  const observed = [...records, changed(allocation, 19), { type: 'workspace/observed', observation, createdAt: 20 }]
  checkpointFor(observed)
  const rewritten = { ...allocation, revision: 2, lifecycle: 'active', activatedAt: 21, updatedAt: 21,
    observation: { ...observation, truncated: true } }
  const invalidLifecycle = await recover(backend, [...observed, changed(rewritten, 21)])
  await expect(invalidLifecycle.teams.getTeam({ teamId })).rejects.toThrow('Workspace lifecycle cannot rewrite its observation')
  const closing = [...observed, { type: 'team/closure', createdAt: 21, closure: { teamId, kind: 'fail', idempotencyKey: 'close',
    actor: { kind: 'system', name: 'owner' }, reason: { code: 'failed', message: 'Run failed' }, requestedAt: 21 } },
  { type: 'team/phase', phase: 'quiescing', createdAt: 21 }]
  const next = { ...observation, id: 'scan-2', previousObservationId: observation.id, base: observation.final,
    final: { ...observation.final, startedAt: 21, finishedAt: 22 }, observedAt: 22 }
  const periodic = await recover(backend, [...closing, { type: 'workspace/observed', observation: { ...next, stage: 'periodic' }, createdAt: 22 }])
  await expect(periodic.teams.getTeam({ teamId })).rejects.toThrow('Closure cleanup only admits release workspace observations')
  const release = { ...next, stage: 'release' }
  const valid = await recover(backend, [...closing, { type: 'workspace/observed', observation: release, createdAt: 22 }])
  expect((await valid.teams.getTeam({ teamId })).workspaceAllocations[0]?.observation).toEqual(release)
})

it.each(['json', 'sqlite'] as const)('settles task cancellation only after workspace and pending human responsibility (%s)', async (backend) => {
  const { records, allocation, running, binding } = runningTaskPrefix()
  const cancellation = { requestedRevision: running.revision, requestedBy: taskCreatorId, requestedAt: 20,
    target: { kind: 'attempt', attemptId: allocation.attemptId, participantId: taskCreatorId, activationId: taskCreatorActivationId } }
  const cancelling = task({ ...running, revision: 4, cancellation })
  const initialAction = { id: 'cancel-question', teamId, kind: 'question', phase: 'pending', participantId: taskCreatorId,
    sessionId: taskCreatorSessionId, sourceId: 'rpc-cancel', details: {}, createdAt: 19, updatedAt: 19,
    taskId, attemptId: allocation.attemptId }
  const prefix = [...records, changed(allocation, 19), { type: 'human-action/changed', action: initialAction, createdAt: 19 },
    taskChanged({ task: cancelling, createdAt: 20 })]
  checkpointFor(prefix)
  const released = { ...allocation, revision: 3, lifecycle: 'released', releaseRequestedAt: 20, releasedAt: 21, updatedAt: 21 }
  const workspaceRows = [changed({ ...allocation, revision: 2, lifecycle: 'release-requested', releaseRequestedAt: 20, updatedAt: 20 }, 20),
    changed(released, 21)]
  const settled = task({ ...settledTask(running), revision: 5, phase: 'cancelled', cancellation,
    attemptHistory: settledTask(running).attemptHistory.map(attempt => ({ ...attempt, settledAt: 21 })) })
  const settlement = taskChanged({ task: settled, createdAt: 21 })
  const offline = { type: 'activation/changed', createdAt: 21, binding: { ...binding,
    activation: { ...binding.activation, status: 'offline' }, quiescedAt: 21, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] } }
  const early = await recover(backend, [...prefix, settlement, offline])
  await expect(early.teams.getTeam({ teamId })).rejects.toThrow('settled cancellation before workspace release')
  const unanswered = await recover(backend, [...prefix, ...workspaceRows, settlement, offline])
  await expect(unanswered.teams.getTeam({ teamId })).rejects.toThrow('cancelled with a pending human action')
  const answered = { ...initialAction, phase: 'cancelled', outcome: { reason: 'Task cancelled' }, updatedAt: 21 }
  const rows = [...prefix, ...workspaceRows, { type: 'human-action/changed', action: answered, createdAt: 21 }, settlement, offline]
  const checkpoint = checkpointFor(rows)
  const valid = await recover(backend, rows, checkpoint)
  expect((await valid.teams.getTeam({ teamId })).tasks[0]?.phase).toBe('cancelled')
  const missingRequester = teamProjectionDataSchema.parse({ ...checkpoint,
    tasks: [{ ...settled, cancellation: { ...cancellation, requestedBy: 'unknown' } }] })
  expect(() => teamProjectionFromData(missingRequester)).toThrow('cancellation references an unknown requesting participant')
  const heldWorkspace = teamProjectionDataSchema.parse({ ...checkpoint,
    workspaceAllocations: [{ ...released, lifecycle: 'release-requested', releasedAt: undefined }] })
  expect(() => teamProjectionFromData(heldWorkspace)).toThrow('cancelled before workspace release')
})

it.each(['json', 'sqlite'] as const)('retains cancellation and exact quiescence when its attempt lease expires (%s)', async (backend) => {
  const { records, running, binding } = runningTaskPrefix()
  const lease = running.lease!
  const cancellation = { requestedRevision: running.revision, requestedBy: taskCreatorId, requestedAt: 20,
    target: { kind: 'attempt', attemptId: lease.attemptId, participantId: taskCreatorId, activationId: taskCreatorActivationId } }
  const cancelling = task({ ...running, revision: 4, cancellation })
  const settled = task({ ...settledTask(running), revision: 5, phase: 'cancelled', cancellation,
    attemptHistory: settledTask(running).attemptHistory.map(attempt => ({
      ...attempt, settledAt: lease.expiresAt, outcome: { kind: 'lease-expired' },
    })) })
  const offline = { type: 'activation/changed', createdAt: lease.expiresAt, binding: { ...binding,
    activation: { ...binding.activation, status: 'offline' }, quiescedAt: lease.expiresAt, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] } }
  const rows = [...records, taskChanged({ task: cancelling, createdAt: 20 }),
    taskChanged({ task: settled, createdAt: lease.expiresAt }), offline]
  const checkpoint = checkpointFor(rows)
  const ctx = await recover(backend, rows, checkpoint)
  expect((await ctx.teams.getTeam({ teamId })).tasks[0]).toMatchObject({ phase: 'cancelled',
    attemptHistory: [{ outcome: { kind: 'lease-expired' } }] })
})

it.each(['json', 'sqlite'] as const)('preserves a lost workspace without inventing release intent (%s)', async (backend) => {
  const { records, allocation } = runningTaskPrefix()
  const executionWorld = { kind: 'e2b', id: 'sandbox' }
  const reserved = { ...allocation, executionWorld }
  const unavailable = { ...reserved, revision: 2, lifecycle: 'unavailable', updatedAt: 20,
    loss: { executionWorld, reason: 'manifest-missing', terminationProven: false, artifacts: [], observedAt: 20 } }
  const preserved = { ...unavailable, revision: 3, lifecycle: 'preserved', updatedAt: 21, preservedAt: 21,
    preservationReason: { code: 'lost', message: 'Retain provider recovery facts' } }
  const rows = [...records, changed(reserved, 19), changed(unavailable, 20), changed(preserved, 21)]
  const ctx = await recover(backend, rows, checkpointFor(rows))
  expect((await ctx.teams.getTeam({ teamId })).workspaceAllocations).toEqual([preserved])
})

it.each(['json', 'sqlite'] as const)('accepts loss of an existing workspace after closure but refuses a new lost allocation (%s)', async (backend) => {
  const { records, allocation } = runningTaskPrefix()
  const executionWorld = { kind: 'e2b', id: 'closure-loss-world' }
  const reserved = { ...allocation, executionWorld }
  const closing = [...records, changed(reserved, 19), { type: 'team/closure', createdAt: 20,
    closure: { teamId, kind: 'fail', idempotencyKey: 'close-before-loss', actor: { kind: 'system', name: 'owner' },
      reason: { code: 'RUN_FAILED', message: 'Close the Team' }, requestedAt: 20 } },
  { type: 'team/phase', phase: 'quiescing', createdAt: 20 }]
  const unavailable = { ...reserved, revision: 2, lifecycle: 'unavailable', updatedAt: 21,
    loss: { executionWorld, reason: 'sandbox-expired', terminationProven: true, artifacts: [], observedAt: 21 } }
  const rows = [...closing, changed(unavailable, 21)]
  const ctx = await recover(backend, rows, checkpointFor(rows))
  expect((await ctx.teams.getTeam({ teamId })).workspaceAllocations).toEqual([unavailable])
  const invalid = await recover(backend, [...closing, changed({ ...unavailable, id: 'new-allocation', revision: 1 }, 21)])
  await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('closure cleanup cannot create or reactivate workspace allocation')
})

it.each(['json', 'sqlite'] as const)('pairs task release with exact controller quiescence after logical offline (%s)', async (backend) => {
  const { records, running, binding } = runningTaskPrefix()
  const offline = { ...binding, activation: { ...binding.activation, status: 'offline' } }
  const before = [...records, { type: 'activation/changed', binding: offline, createdAt: 19 }]
  const settled = settledTask(running)
  const final = { ...settled, attemptHistory: settled.attemptHistory.map(value => ({ ...value, retirement: { source: 'quiesced' as const } })) }
  const proof = { ...offline, quiescedAt: 20, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] }
  const rows = [...before, taskChanged({ task: final, createdAt: 20 }), { type: 'activation/changed', binding: proof, createdAt: 20 }]
  const valid = await recover(backend, rows, checkpointFor(rows))
  const state = await valid.teams.getTeam({ teamId })
  expect(state.tasks[0]?.attemptHistory[0]?.retirement).toEqual({ source: 'quiesced' })
  expect(state.activations).toEqual([proof])
  const missing = await recover(backend, rows.slice(0, -1))
  await expect(missing.teams.getTeam({ teamId })).rejects.toThrow(/retirement evidence has no matching controller quiescence/)
  const foreign = await recover(backend, [...before, taskChanged({ task: final, createdAt: 20 }),
    { type: 'activation/changed', binding: { ...proof, quiescenceSource: 'fenced' }, createdAt: 20 }])
  await expect(foreign.teams.getTeam({ teamId })).rejects.toThrow(/retirement evidence has no matching controller quiescence/)
})
