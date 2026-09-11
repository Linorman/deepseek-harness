/** Human task creation identity across durable membership and task records. @module */

import { describe, expect, it } from 'vitest'
import type { ParticipantSnapshot } from '@clocky/clocky-team'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, task, taskChanged, teamId, teamPhase } from './fixtures.ts'

function activeMemberRecords(member: ParticipantSnapshot, createdAt: number) {
  return [participantChanged({ participant: member, createdAt }),
    participantChanged({ participant: { ...member, phase: 'provisioning' }, createdAt: createdAt + 1 }),
    participantChanged({ participant: { ...member, phase: 'active' }, createdAt: createdAt + 2 })]
}

function human(id: string) {
  return participant({ id, kind: 'human', role: 'human',
    owner: { kind: 'product-principal', principalId: `principal-${id}` } })
}

function humanTask(id: string, creator: ParticipantSnapshot, idempotencyKey: string) {
  return task({ id, createCommand: { creator: { teamId, participantId: creator.id }, idempotencyKey } })
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable human task creator (${backend})`, () => {
    it('requires an initial human creator to reference a retained human participant', async () => {
      const creator = human('human-author')
      const agent = participant({ id: 'agent-member', role: 'worker' })
      const prefix = [createdTeam(), teamPhase(), ...activeMemberRecords(creator, 12), ...activeMemberRecords(agent, 15)]
      const initial = humanTask('human-task', creator, 'human-create-a')
      const rows = [...prefix, taskChanged({ task: initial, createdAt: 18 })]
      const checkpoint = checkpointFor(rows)
      const valid = await recover(backend, rows, checkpoint)
      expect((await valid.teams.getTeam({ teamId })).tasks).toEqual([initial])

      for (const participantId of ['missing-human', agent.id]) {
        const altered = { ...initial, createCommand: { ...initial.createCommand, creator: { teamId, participantId } } }
        const invalid = await recover(backend, [...prefix, { type: 'task/changed', task: altered, createdAt: 18 }])
        await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('invalid human task-creation command relation')
        const restored = await recover(backend, rows, { ...checkpoint, tasks: [altered] })
        expect((await restored.teams.getTeam({ teamId })).tasks).toEqual([initial])
      }
    })

    it('retains a departed historical human creator but refuses new tasks attributed to that participant', async () => {
      const creator = human('human-author')
      const initial = humanTask('retained-task', creator, 'historical-human-create')
      const prefix = [createdTeam(), teamPhase(), ...activeMemberRecords(creator, 12),
        taskChanged({ task: initial, createdAt: 15 }),
        participantChanged({ participant: { ...creator, phase: 'left' }, createdAt: 16 })]
      const checkpoint = checkpointFor(prefix)
      const edited = task({ ...initial, revision: 2, subject: 'Keep the original human attribution' })
      const rows = [...prefix, taskChanged({ task: edited, createdAt: 17 })]
      for (const data of [undefined, checkpoint]) {
        const valid = await recover(backend, rows, data, teamId, [], prefix.length - 1)
        const state = await valid.teams.getTeam({ teamId })
        expect(state.tasks).toEqual([edited])
        expect(state.participants.find(member => member.id === creator.id)?.phase).toBe('left')
      }
      const unauthorized = humanTask('new-task', creator, 'new-human-create')
      const invalid = await recover(backend, [...rows, taskChanged({ task: unauthorized, createdAt: 18 })])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('invalid human task-creation command relation')
    })

    it('rejects one human creation command assigned to two task identities and restores distinct checkpoint keys', async () => {
      const creator = human('human-author')
      const first = humanTask('task-a', creator, 'human-create-a')
      const second = humanTask('task-b', creator, 'human-create-b')
      const prefix = [createdTeam(), teamPhase(), ...activeMemberRecords(creator, 12),
        taskChanged({ task: first, createdAt: 15 })]
      const rows = [...prefix, taskChanged({ task: second, createdAt: 16 })]
      const checkpoint = checkpointFor(rows)
      const valid = await recover(backend, rows, checkpoint)
      expect((await valid.teams.getTeam({ teamId })).tasks).toEqual([first, second])

      const repeated = { ...second, createCommand: first.createCommand }
      const invalid = await recover(backend, [...prefix, { type: 'task/changed', task: repeated, createdAt: 16 }])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow('repeats a task-creation command')
      const restored = await recover(backend, rows, { ...checkpoint, tasks: [first, repeated] })
      expect((await restored.teams.getTeam({ teamId })).tasks).toEqual([first, second])
    })

    it('keeps identical creation keys distinct when their human participant attribution differs', async () => {
      const firstCreator = human('human-author-a')
      const secondCreator = human('human-author-b')
      const first = humanTask('task-a', firstCreator, 'shared-command-key')
      const second = humanTask('task-b', secondCreator, 'shared-command-key')
      const rows = [createdTeam(), teamPhase(), ...activeMemberRecords(firstCreator, 12),
        ...activeMemberRecords(secondCreator, 15), taskChanged({ task: first, createdAt: 18 }),
        taskChanged({ task: second, createdAt: 19 })]
      const valid = await recover(backend, rows, checkpointFor(rows))
      expect((await valid.teams.getTeam({ teamId })).tasks).toEqual([first, second])
    })
  })
}
