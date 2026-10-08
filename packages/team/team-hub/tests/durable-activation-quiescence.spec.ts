/** Activation proof admission and retained timestamps through durable recovery. @module */

import { describe, expect, it, vi } from 'vitest'
import { activationBindingSnapshotSchema } from '@clocky/clocky-team'
import type { TeamSystemActivationProof, TeamSystemActivationProofSource } from '@clocky/clocky-team'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, fenceTestActivation, participant, participantChanged, quiesceTestActivation,
  task, taskChanged, taskLease, taskCreatorActivationId, taskCreatorId, otherParticipantId, updateTestActivationStatus,
  taskCreatorSessionId, teamId, teamPhase } from './fixtures.ts'

function activeParticipant() {
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const records = [createdTeam(), teamPhase(),
    participantChanged({ participant: member, createdAt: 12 }),
    participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...member, phase: 'active' }, createdAt: 14 })]
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process' }
  return { records, binding }
}

function quiescedPrefix() {
  const f = activeParticipant()
  const active = [...f.records, { type: 'activation/changed', binding: f.binding, createdAt: 15 }]
  const proof = { ...f.binding, activation: { ...f.binding.activation, status: 'offline' },
    quiescedAt: 16, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] }
  const records = [...active, { type: 'activation/changed', binding: proof, createdAt: 16 }]
  return { active, proof, records, checkpoint: checkpointFor(records) }
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable activation quiescence (${backend})`, () => {
    it('rejects initial proof-bearing bindings even when their individual binding schema is valid', async () => {
      const { records, binding } = activeParticipant()
      const valid = await recover(backend, records, checkpointFor(records))
      expect((await valid.teams.getTeam({ teamId })).activations).toEqual([])
      const recovery = { kind: 'sdk-local-cold-replace', version: 1, runtimeProvider: 'sdk', profile: 'local-sdk-v1',
        agent: { provider: 'mock', model: 'mock', maxTokens: 32 },
        process: { hostId: 'host-a', pid: 42, started: 'start-a', processGroupId: 42 } }
      const candidates = [
        { ...binding, activation: { ...binding.activation, status: 'offline' },
          quiescedAt: 15, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] },
        ...['stopping', 'offline'].map(status => ({ ...binding, provider: 'sdk', recovery,
          activation: { ...binding.activation, status }, fencedAt: 15 })),
      ]
      for (const candidate of candidates) {
        expect(activationBindingSnapshotSchema.safeParse(JSON.parse(JSON.stringify(candidate))).success).toBe(true)
        const invalid = await recover(backend, [...records, { type: 'activation/changed', binding: candidate, createdAt: 15 }])
        const reading = invalid.teams.getTeam({ teamId })
        await expect(reading).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
        await expect(reading).rejects.toThrow('cannot publish a quiescence proof')
      }
    })

    it('rejects new quiescence timestamps that differ from their journal record', async () => {
      const f = quiescedPrefix()
      const valid = await recover(backend, f.records, f.checkpoint)
      expect((await valid.teams.getTeam({ teamId })).activations).toEqual([f.proof])
      for (const quiescedAt of [15, 17]) {
        const binding = { ...f.proof, quiescedAt }
        expect(activationBindingSnapshotSchema.safeParse(binding).success).toBe(true)
        const invalid = await recover(backend, [...f.active, { type: 'activation/changed', binding, createdAt: 16 }])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('invalid quiescence proof')
      }
    })

    it('rejects missing quiescence fields or a resident proof at the actual journal parser', async () => {
      const f = quiescedPrefix()
      const variants = [
        { ...f.proof, activation: { ...f.proof.activation, status: 'running' } },
        { ...f.proof, quiescenceSource: undefined },
        { ...f.proof, quiescedWakeChannelIds: undefined },
      ]
      for (const binding of variants) {
        const invalid = await recover(backend, [...f.active, { type: 'activation/changed', binding, createdAt: 16 }])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('journal contains an invalid record')
      }
    })

    it('preserves an admitted proof against later changes and complete proof removal', async () => {
      const f = quiescedPrefix()
      const variants = [
        { ...f.proof, quiescedAt: 17 },
        { ...f.proof, quiescenceSource: 'fenced' },
        { ...f.proof, quiescedWakeChannelIds: ['another-wake'] },
        { ...f.proof, quiescedAt: undefined, quiescenceSource: undefined, quiescedWakeChannelIds: undefined },
      ]
      for (const binding of variants) {
        expect(activationBindingSnapshotSchema.safeParse(JSON.parse(JSON.stringify(binding))).success).toBe(true)
        const invalid = await recover(backend, [...f.records, { type: 'activation/changed', binding, createdAt: 17 }],
          f.checkpoint, teamId, [], f.records.length - 1)
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('immutable binding fields')
      }
    })

    it.each([9, 17])('falls back from a checkpoint with quiescence time %i outside its Team lifetime', async (quiescedAt) => {
      const f = quiescedPrefix()
      const binding = { ...f.proof, quiescedAt }
      expect(activationBindingSnapshotSchema.safeParse(binding).success).toBe(true)
      const restored = await recover(backend, f.records, { ...f.checkpoint, activations: [binding] })
      expect((await restored.teams.getTeam({ teamId })).activations).toEqual([f.proof])
    })

    it.each([['fenced', 'expired'], ['quiesced', 'expired'], ['quiesced', 'live']] as const)
    ('retires a %s activation with a %s task lease', async (source, age) => {
      const f = activeParticipant()
      const initial = task({ createdAt: 16 })
      const lease = taskLease({ participantId: taskCreatorId, activationId: taskCreatorActivationId,
        assignedAt: 17, renewedAt: 17, durationMs: age === 'expired' ? 2 : 10, expiresAt: age === 'expired' ? 19 : 27 })
      const assigned = task({ ...initial, phase: 'assigned', revision: 2, attemptCount: 1, lease })
      const running = task({ ...assigned, phase: 'running', revision: 3, lease: { ...lease, startedAt: 18 } })
      const records = [...f.records, { type: 'activation/changed', binding: f.binding, createdAt: 15 },
        taskChanged({ task: initial, createdAt: 16 }), taskChanged({ task: assigned, createdAt: 17 }),
        taskChanged({ task: running, createdAt: 18 })]
      const ctx = await recover(backend, records)
      const before = await ctx.teams.getTeam({ teamId })
      const input = { teamId, activationId: taskCreatorActivationId, participantId: taskCreatorId,
        sessionId: taskCreatorSessionId, provider: 'in-process', expectedCursor: before.team.cursor }
      const clock = age === 'live' ? vi.spyOn(Date, 'now').mockReturnValue(20) : undefined
      let settled!: Awaited<ReturnType<typeof fenceTestActivation>>
      try { settled = source === 'fenced' ? await fenceTestActivation(ctx, input) : await quiesceTestActivation(ctx, input) }
      finally { clock?.mockRestore() }
      expect(settled.activations[0]).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: source })
      expect(settled.tasks[0]?.attemptHistory[0]?.outcome).toMatchObject({ kind: age === 'expired' ? 'lease-expired' : 'released' })
      expect(settled.tasks[0]?.lease).toBeUndefined()
      const retry = { ...input, expectedCursor: settled.team.cursor }
      const repeated = source === 'fenced' ? await fenceTestActivation(ctx, retry) : await quiesceTestActivation(ctx, retry)
      expect(repeated.team.cursor).toBe(settled.team.cursor)
      expect(repeated.tasks).toEqual(settled.tasks)
    })

    it('records a live Simulation writer retirement as a failed task attempt', async () => {
      const f = activeParticipant()
      const initial = task({ createdAt: 16, createCommand: { creator: { kind: 'simulation', teamId,
        participantId: taskCreatorId, runId: 'simulation', operationId: 'simulation-task-operation' },
      idempotencyKey: JSON.stringify(['simulation-task', 'simulation', 'simulation-task-operation']) } })
      const lease = taskLease({ participantId: taskCreatorId, activationId: taskCreatorActivationId,
        assignedAt: 17, renewedAt: 17, durationMs: 10, expiresAt: 27 })
      const assigned = task({ ...initial, phase: 'assigned', revision: 2, attemptCount: 1, lease })
      const running = task({ ...assigned, phase: 'running', revision: 3, lease: { ...lease, startedAt: 18 } })
      const records = [createdTeam({ rules: { simulationRunId: 'simulation', activationLifecycleOwner: 'simulation/owner' } }),
        ...f.records.slice(1), { type: 'activation/changed', binding: f.binding, createdAt: 15 },
        taskChanged({ task: initial, createdAt: 16 }), taskChanged({ task: assigned, createdAt: 17 }),
        taskChanged({ task: running, createdAt: 18 })]
      const ctx = await recover(backend, records)
      const before = await ctx.teams.getTeam({ teamId })
      const clock = vi.spyOn(Date, 'now').mockReturnValue(20)
      let settled!: Awaited<ReturnType<typeof quiesceTestActivation>>
      try { settled = await quiesceTestActivation(ctx, { teamId, activationId: taskCreatorActivationId,
        participantId: taskCreatorId, sessionId: taskCreatorSessionId, provider: 'in-process',
        expectedCursor: before.team.cursor }) }
      finally { clock.mockRestore() }
      expect(settled.activations[0]).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'quiesced' })
      expect(settled.tasks[0]?.attemptHistory[0]?.outcome).toMatchObject({ kind: 'failed', failure: { code: 'SIM_WRITER_RETIRED' } })
    })

    it('rejects a controller status proof whose participant differs from the durable binding', async () => {
      const f = activeParticipant()
      const ctx = await recover(backend, [...f.records, { type: 'activation/changed', binding: f.binding, createdAt: 15 }])
      const before = await ctx.teams.getTeam({ teamId })
      const input = { teamId, activationId: taskCreatorActivationId, expectedCursor: before.team.cursor, status: 'running' as const }
      const proof = Object.freeze({}) as TeamSystemActivationProof
      const source: TeamSystemActivationProofSource = { name: 'team-activation-controller',
        resolveActivationProof: candidate => candidate === proof ? {
          kind: 'activation-controller-status', ...input, participantId: otherParticipantId,
          sessionId: taskCreatorSessionId, provider: 'in-process',
        } : undefined }
      const unregister = ctx.teams.registerSystemActivationProofSource(source)
      try {
        await expect(ctx.teams.updateActivationStatus({ actor: proof, ...input }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        expect((await ctx.teams.getTeam({ teamId })).team.cursor).toBe(before.team.cursor)
        expect((await ctx.teams.getActivation({ teamId, activationId: taskCreatorActivationId })).activation.status).toBe('idle')
      } finally { unregister() }
    })

    it.each(['resident', 'offline-without-proof', 'fenced'] as const)
    ('rejects a recovery cleanup proof for a %s activation', async (phase) => {
      const f = activeParticipant()
      const ctx = await recover(backend, [...f.records, { type: 'activation/changed', binding: f.binding, createdAt: 15 }])
      const initial = await ctx.teams.getTeam({ teamId })
      const selected = { teamId, activationId: taskCreatorActivationId, participantId: taskCreatorId,
        sessionId: taskCreatorSessionId, provider: 'in-process', expectedCursor: initial.team.cursor }
      if (phase === 'offline-without-proof') await updateTestActivationStatus(ctx, { teamId,
        activationId: taskCreatorActivationId, expectedCursor: initial.team.cursor, status: 'offline' })
      if (phase === 'fenced') await fenceTestActivation(ctx, selected)
      const before = await ctx.teams.getTeam({ teamId })
      const bindingBefore = await ctx.teams.getActivation({ teamId, activationId: taskCreatorActivationId })
      const input = { teamId, activationId: taskCreatorActivationId, participantId: taskCreatorId,
        sessionId: taskCreatorSessionId, provider: 'in-process', expectedCursor: before.team.cursor }
      const proof = Object.freeze({}) as TeamSystemActivationProof
      const source: TeamSystemActivationProofSource = { name: 'team-activation-recovery',
        resolveActivationProof: candidate => candidate === proof ? { kind: 'activation-recovery-quiesce', ...input } : undefined }
      const unregister = ctx.teams.registerSystemActivationProofSource(source)
      try {
        await expect(ctx.teams.quiesceActivation({ actor: proof, ...input }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        expect((await ctx.teams.getTeam({ teamId })).team.cursor).toBe(before.team.cursor)
        expect(await ctx.teams.getActivation({ teamId, activationId: taskCreatorActivationId })).toEqual(bindingBefore)
      } finally { unregister() }
    })
  })
}
