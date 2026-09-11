/** Activation proof admission and retained timestamps through durable recovery. @module */

import { describe, expect, it } from 'vitest'
import { activationBindingSnapshotSchema } from '@clocky/clocky-team'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, taskCreatorActivationId, taskCreatorId,
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
  })
}
