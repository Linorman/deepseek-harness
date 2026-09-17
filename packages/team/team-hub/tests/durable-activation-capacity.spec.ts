/** Stored startup capacity must agree with participant identities and published epochs. */
import { describe, expect, it } from 'vitest'
import { liveActivationCapacity } from '@clocky/clocky-team'
import { teamProjectionFromData } from '../src/fold.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, taskCreatorActivationId, taskCreatorId,
  taskCreatorSessionId, teamId, teamPhase } from './fixtures.ts'

function fixture() {
  const member = participant({ id: taskCreatorId, role: 'coordinator', phase: 'active' })
  const reservation = { id: 'startup-capacity', provider: 'in-process', sessionId: taskCreatorSessionId, reservedAt: 15 }
  const prefix = [createdTeam({ budgets: { maxLiveActivations: 1 } }), teamPhase(),
    ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
      participantChanged({ participant: { ...member, phase }, createdAt: 12 + index })),
    participantChanged({ participant: { ...member, activationReservation: reservation }, createdAt: 15 }),
  ]
  const binding = { activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
    sessionId: taskCreatorSessionId, provider: 'in-process', reservationId: reservation.id }
  return { member, reservation, prefix, binding,
    bound: [...prefix, { type: 'activation/changed', binding, createdAt: 16 }] }
}

describe('durable startup capacity', () => {
  it('rejects checkpoint loss of admission identity and tighter ceilings than occupied capacity', () => {
    const f = fixture()
    const valid = checkpointFor(f.bound)
    expect(() => teamProjectionFromData(valid)).not.toThrow()
    expect(() => teamProjectionFromData({ ...valid, participants: [f.member] })).toThrow(/startup identity/)
    expect(() => teamProjectionFromData({ ...valid, budgets: { maxLiveActivations: 0 } })).toThrow(/exceed/)
  })

  it.each(['json', 'sqlite'] as const)('restores reservations once, and rejects binding or release without exact ownership (%s)', async (backend) => {
    const f = fixture()
    const ctx = await recover(backend, f.bound)
    const state = await ctx.teams.getTeam({ teamId })
    expect(liveActivationCapacity(state.participants, state.activations, state.tasks)).toBe(1)
    for (const reservationId of [undefined, 'foreign-startup']) {
      const binding = { ...f.binding, reservationId }
      const invalid = await recover(backend, [...f.prefix, { type: 'activation/changed', binding, createdAt: 16 }])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
    }
    const released = await recover(backend, [...f.bound, participantChanged({
      participant: { ...f.member, activationReservation: { ...f.reservation, releasedAt: 17 } }, createdAt: 17,
    })])
    await expect(released.teams.getTeam({ teamId })).rejects.toThrow(/Bound startup/)
  })

  it.each(['json', 'sqlite'] as const)('rejects two Participants sharing one startup identity (%s)', async (backend) => {
    const f = fixture()
    const member = participant({ id: 'second-capacity-worker' })
    const rows = [createdTeam({ budgets: { maxLiveActivations: 2 } }), ...f.prefix.slice(1),
      ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
        participantChanged({ participant: { ...member, phase }, createdAt: 16 + index })),
      participantChanged({ participant: { ...member, phase: 'active',
        activationReservation: { ...f.reservation, reservedAt: 19 } }, createdAt: 19 }),
    ]
    const invalid = await recover(backend, rows)
    await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow(/share one startup/)
  })
})
